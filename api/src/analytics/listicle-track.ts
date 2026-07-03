// POST /api/lst/track — the listicle beacon ingest (design contract §16 /
// §24 / §31.4 / §31.6 / §31.8).
//
// Registered on the public router BEFORE publicSiteContextMiddleware (host-
// independent, like /favicon.ico) so the /:slug catch-all can never swallow
// it and no tenant lookup runs on the beacon hot path — the same stance as
// the homepage analyticsRouter, which stays byte-untouched.
//
// Contract (§24): fire-and-forget; accepts ONE event object or
// {events:[…]} capped at 20/request; ALWAYS 204 with an empty body — no
// reflection of any client byte; a malformed body / unknown type / KV or D1
// hiccup can never error the beacon.
//
// Pipeline per event:
//   1. shape/type validation — event_type ∈ the 6 §16 types; non-object or
//      oversized (> MAX_EVENT_BYTES) → DEAD-LETTER (§31.6: D1
//      `listicle_event_dead_letter` row + a record_kind="dead_letter" audit
//      record on the stream when configured).
//   2. server enrichment (OVERRIDES client claims for server-owned columns):
//      ip / ua / device / os / os_version / browser / browser_version, geo
//      country/state/city from request.cf, received_at, timestamp clamp,
//      §31.8 quality flags (ivt signals + ko_internal cookie + preview URL).
//   3. §31.6 idempotency: event_id (client-minted UUID; server mints one if
//      absent — documented: such an event cannot be replay-deduped). A
//      short-TTL KV seen-set (env.CACHE, 10 min) drops immediate replays
//      BEFORE Firehose; ClickHouse's ReplacingMergeTree by event_id stays
//      the authoritative dedupe (Phase 8).
//   4. privacy: Sec-GPC:1 or a ko_optout=1 cookie drops the event silently
//      (§24 "honour opt-out before emitting events"; the D1
//      privacy_opt_outs table has no identifier scheme wired in this repo —
//      documented residual, same posture as the homepage pipeline).
//   5. sessions (§16): every accepted page_view also emits a
//      `listicles.sessions` record (record_kind="session") to the SAME
//      stream — the Athena DDL discriminates on record_kind.
//   6. emit via emitListicleRecords (no-op until the stream exists) + bump
//      the §31.6 daily accept counter.

import { Hono } from "hono";
import type { Env } from "../env";
import {
  LISTICLE_EVENT_TYPES,
  blankListicleEvent,
  emitListicleRecords,
  type ListicleEvent,
  type ListicleSessionRecord,
  type ListicleDeadLetterRecord,
  type ListicleStreamRecord,
} from "./listicle-events";
import {
  readCfSignals,
  parseClientUa,
  geoFromCf,
  computeTrafficQuality,
} from "./listicle-quality";
import { bumpListicleDailyAcceptCounter } from "./listicle-reconciliation";

const ALLOWED_TYPES: ReadonlySet<string> = new Set(LISTICLE_EVENT_TYPES);

// Max events accepted per request (§24 "capped events/request").
export const MAX_LISTICLE_EVENTS_PER_REQUEST = 20;

// Oversized-event bound (authored: a full §16 record is <4KB nominal; 16KB
// leaves generous headroom while keeping a hostile payload out of Firehose).
export const MAX_LISTICLE_EVENT_BYTES = 16 * 1024;

// KV seen-set TTL — "short-TTL … drops immediate replays" (§31.6). 10 min
// covers the §31.6 client retry-queue backoff horizon.
export const LISTICLE_SEEN_TTL_SECONDS = 600;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// NIT-1: the oversized-event bound is in BYTES, so measure UTF-8 byte length
// (not `.length` UTF-16 code units — a multibyte payload under the byte cap
// could exceed it in code units and vice-versa). One shared encoder.
const LST_TEXT_ENCODER = new TextEncoder();
function byteLength(s: string): number {
  return LST_TEXT_ENCODER.encode(s).length;
}
// Byte-safe truncation for the stored dead-letter payload (decode is
// non-fatal, so a split multibyte sequence at the cap becomes U+FFFD rather
// than throwing).
function truncateToBytes(s: string, maxBytes: number): string {
  const bytes = LST_TEXT_ENCODER.encode(s);
  if (bytes.length <= maxBytes) return s;
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes.subarray(0, maxBytes));
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Clamp the client timestamp: accepted when it is a finite epoch-ms within
// ±24h of now (queued §31.6 retries legitimately arrive late); anything else
// takes the server clock.
function clampTimestamp(raw: unknown, now: number): number {
  const n = asNumberOrNull(raw);
  if (n === null) return now;
  const dayMs = 24 * 3600 * 1000;
  if (n < now - dayMs || n > now + dayMs) return now;
  return n;
}

function genUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cookieHas(cookieHeader: string | null, pair: string): boolean {
  if (cookieHeader === null || cookieHeader === "") return false;
  return cookieHeader.split(";").some((part) => part.trim() === pair);
}

// Copy the client-claimed §16 columns onto a blank event. Server-owned
// columns (ip/ua/device/os/…/geo/received_at/flags) are stamped AFTER this,
// overriding any client claim.
function eventFromPayload(payload: Record<string, unknown>, now: number): ListicleEvent {
  const e = blankListicleEvent(asString(payload.event_type), now);
  e.session_id = asString(payload.session_id);
  e.event_id = asString(payload.event_id);
  e.timestamp = clampTimestamp(payload.timestamp, now);
  e.site_id = asString(payload.site_id);
  e.article_id = asString(payload.article_id);
  e.article_name = asString(payload.article_name);
  e.article_url = asString(payload.article_url);
  e.lander_v = asString(payload.lander_v);
  e.article_version_id = asString(payload.article_version_id) || e.lander_v;
  const revision = asNumberOrNull(payload.article_version_revision);
  e.article_version_revision = revision === null ? 0 : revision;
  e.article_experiment_id = asString(payload.article_experiment_id);
  e.article_variant_id = asString(payload.article_variant_id);
  e.article_variant_label = asString(payload.article_variant_label);
  e.article_split_percentage = asNumberOrNull(payload.article_split_percentage);
  e.page = asString(payload.page);
  e.page_index = asNumberOrNull(payload.page_index);
  e.page_selection_mode = asString(payload.page_selection_mode);
  e.section_id = asString(payload.section_id);
  e.section_name = asString(payload.section_name);
  e.page_candidate_id = asString(payload.page_candidate_id);
  e.ab_test_id = asString(payload.ab_test_id);
  e.ab_split_percentage = asNumberOrNull(payload.ab_split_percentage);
  e.page_rule_set_id = asString(payload.page_rule_set_id);
  e.page_rule_id = asString(payload.page_rule_id);
  e.page_rule_priority = asNumberOrNull(payload.page_rule_priority);
  e.selection_reason = asString(payload.selection_reason);
  e.matched_rule_json_hash = asString(payload.matched_rule_json_hash);
  e.offer_id = asString(payload.offer_id);
  e.offer_name = asString(payload.offer_name);
  e.click_id = asString(payload.click_id);
  e.link_instance_id = asString(payload.link_instance_id);
  e.section_block_id = asString(payload.section_block_id);
  e.link_role = asString(payload.link_role);
  e.link_position_index = asNumberOrNull(payload.link_position_index);
  e.button_style_id = asString(payload.button_style_id);
  e.button_group_id = asString(payload.button_group_id);
  e.anchor_text_hash = asString(payload.anchor_text_hash);
  e.analytics_label = asString(payload.analytics_label);
  e.utm_source = asString(payload.utm_source);
  e.utm_medium = asString(payload.utm_medium);
  e.utm_content = asString(payload.utm_content);
  e.traffic_source = asString(payload.traffic_source);
  e.placement = asString(payload.placement);
  e.cpc = asString(payload.cpc);
  e.fbc = asString(payload.fbc);
  e.fbclid = asString(payload.fbclid);
  e.sub1 = asString(payload.sub1);
  e.sub2 = asString(payload.sub2);
  e.sub3 = asString(payload.sub3);
  e.sub4 = asString(payload.sub4);
  e.sub5 = asString(payload.sub5);
  e.url = asString(payload.url);
  e.referer = asString(payload.referer);
  e.language = asString(payload.language);
  e.page_view_id = asString(payload.page_view_id);
  return e;
}

// §16: one listicles.sessions record per accepted page_view (append-only;
// downstream collapses by session_id — the record documents its mechanism
// in analytics/listicle-events.ts).
function sessionFromPageView(e: ListicleEvent): ListicleSessionRecord {
  return {
    record_kind: "session",
    session_id: e.session_id,
    first_seen: e.timestamp,
    last_seen: e.received_at,
    site_id: e.site_id,
    landing_url: e.url,
    article_id: e.article_id,
    lander_v: e.lander_v,
    article_version_id: e.article_version_id,
    traffic_source: e.traffic_source,
    utm_source: e.utm_source,
    utm_medium: e.utm_medium,
    utm_content: e.utm_content,
    placement: e.placement,
    cpc: e.cpc,
    fbclid: e.fbclid,
    fbc: e.fbc,
    device: e.device,
    os: e.os,
    os_version: e.os_version,
    browser: e.browser,
    browser_version: e.browser_version,
    country: e.country,
    state: e.state,
    city: e.city,
    ip: e.ip,
    ua: e.ua,
    url: e.url,
    referer: e.referer,
    language: e.language,
    page_view_id: e.page_view_id,
    is_bot: e.is_bot,
    is_internal: e.is_internal,
    is_preview: e.is_preview,
    traffic_quality_flag: e.traffic_quality_flag,
  };
}

const listicleTrackRouter = new Hono<{ Bindings: Env }>();

// Hono's c.executionCtx GETTER throws where no ExecutionContext exists
// (unit-test harnesses) — the beacon must 204 regardless, so the context is
// captured once behind a no-op fallback.
function safeExecutionCtx(c: { executionCtx: ExecutionContext }): ExecutionContext {
  try {
    return c.executionCtx;
  } catch {
    return {
      waitUntil(): void {
        /* no-op outside workerd */
      },
      passThroughOnException(): void {
        /* no-op */
      },
    } as unknown as ExecutionContext;
  }
}

listicleTrackRouter.post("/api/lst/track", async (c) => {
  const execCtx = safeExecutionCtx(c);
  // Server-side signals, read once per request.
  const ip = c.req.header("cf-connecting-ip") ?? "";
  const ua = c.req.header("user-agent") ?? "";
  const cookieHeader = c.req.header("Cookie") ?? null;
  const cf = readCfSignals(c.req.raw);
  const uaDetails = parseClientUa(ua);
  const geo = geoFromCf(cf);
  const now = Date.now();

  // Privacy (§24): a Global Privacy Control signal or the first-party
  // opt-out cookie drops the batch entirely — still 204, still no echo.
  const optedOut = c.req.header("Sec-GPC") === "1" || cookieHas(cookieHeader, "ko_optout=1");

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.body(null, 204);
  }

  // One event object OR {events:[…]} OR a bare array — capped at 20.
  let incoming: unknown[];
  if (Array.isArray(raw)) {
    incoming = raw;
  } else if (
    raw !== null &&
    typeof raw === "object" &&
    Array.isArray((raw as { events?: unknown }).events)
  ) {
    incoming = (raw as { events: unknown[] }).events;
  } else if (raw !== null && typeof raw === "object") {
    incoming = [raw];
  } else {
    return c.body(null, 204);
  }
  if (optedOut) return c.body(null, 204);

  const capped = incoming.slice(0, MAX_LISTICLE_EVENTS_PER_REQUEST);

  const accepted: ListicleEvent[] = [];
  const deadLetters: Array<{ record: ListicleDeadLetterRecord }> = [];

  const deadLetter = (eventId: string, payload: unknown, reason: string): void => {
    let json = "";
    try {
      json = JSON.stringify(payload) ?? "";
    } catch {
      json = "[unserializable]";
    }
    json = truncateToBytes(json, MAX_LISTICLE_EVENT_BYTES);
    deadLetters.push({
      record: {
        record_kind: "dead_letter",
        event_id: eventId === "" ? genUuid() : eventId,
        reason,
        payload_json: json,
        received_at: now,
      },
    });
  };

  for (const item of capped) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      deadLetter("", item, "not_an_object");
      continue;
    }
    const payload = item as Record<string, unknown>;
    const eventType = asString(payload.event_type);
    if (!ALLOWED_TYPES.has(eventType)) {
      deadLetter(asString(payload.event_id), payload, "invalid_event_type");
      continue;
    }
    let size = 0;
    try {
      // NIT-1: compare BYTES against the byte cap, not UTF-16 code units.
      size = byteLength(JSON.stringify(payload) ?? "");
    } catch {
      deadLetter(asString(payload.event_id), "[unserializable]", "unserializable");
      continue;
    }
    if (size > MAX_LISTICLE_EVENT_BYTES) {
      deadLetter(asString(payload.event_id), { event_id: payload.event_id, event_type: eventType }, "oversized");
      continue;
    }

    const event = eventFromPayload(payload, now);
    // §31.6: event_id is the idempotency key; a client that failed to mint
    // one gets a server UUID (documented: not replay-dedupable).
    if (event.event_id === "") event.event_id = genUuid();

    // Server enrichment OVERRIDES the server-owned columns.
    event.received_at = now;
    event.ip = ip;
    event.ua = ua;
    event.device = uaDetails.device;
    event.os = uaDetails.os;
    event.os_version = uaDetails.os_version;
    event.browser = uaDetails.browser;
    event.browser_version = uaDetails.browser_version;
    event.country = geo.country;
    event.state = geo.state;
    event.city = geo.city;

    // §31.8 flags (request signals + the event's own page URL/referer).
    const quality = computeTrafficQuality({
      cf,
      userAgent: ua,
      cookieHeader,
      urls: [event.url, event.referer],
    });
    event.is_bot = quality.is_bot;
    event.is_internal = quality.is_internal;
    event.is_preview = quality.is_preview;
    event.traffic_quality_flag = quality.traffic_quality_flag;

    accepted.push(event);
  }

  // §31.6 KV seen-set: drop immediate replays pre-Firehose. Best-effort —
  // a KV hiccup accepts the event (CH ReplacingMergeTree is authoritative).
  const fresh: ListicleEvent[] = [];
  for (const event of accepted) {
    let seen = false;
    try {
      const key = `lst_seen:${event.event_id}`;
      seen = (await c.env.CACHE.get(key)) !== null;
      if (!seen) {
        await c.env.CACHE.put(key, "1", { expirationTtl: LISTICLE_SEEN_TTL_SECONDS });
      }
    } catch {
      seen = false;
    }
    if (!seen) fresh.push(event);
  }

  // Sessions ride the same batch (page_view only, §16).
  const records: ListicleStreamRecord[] = [...fresh];
  for (const event of fresh) {
    if (event.event_type === "page_view") records.push(sessionFromPageView(event));
  }
  for (const dl of deadLetters) records.push(dl.record);

  // Background work: D1 dead-letter rows + Firehose + the daily counter.
  // All fire-and-forget with their own guards — the 204 never waits on them.
  const backgroundWork = (async () => {
    for (const dl of deadLetters) {
      try {
        await c.env.DB.prepare(
          "INSERT INTO listicle_event_dead_letter (event_id, payload_json, reason, received_at) VALUES (?, ?, ?, unixepoch())",
        )
          .bind(dl.record.event_id, dl.record.payload_json, dl.record.reason)
          .run();
      } catch {
        // dead-lettering must never break the beacon
      }
    }
    if (fresh.length > 0) {
      const bySite = new Map<string, number>();
      for (const event of fresh) {
        bySite.set(event.site_id, (bySite.get(event.site_id) ?? 0) + 1);
      }
      for (const [siteId, count] of bySite) {
        await bumpListicleDailyAcceptCounter(c.env, siteId, count, new Date(now));
      }
    }
  })().catch(() => {
    /* background bookkeeping is best-effort */
  });
  try {
    execCtx.waitUntil(backgroundWork);
  } catch {
    // never the 204's problem
  }

  emitListicleRecords(c.env, execCtx, records);

  return c.body(null, 204);
});

export { listicleTrackRouter };
export default listicleTrackRouter;
