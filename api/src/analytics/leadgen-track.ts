// POST /lg/track — the LeadGen beacon ingest (design contract 08 §22.1 /
// §22.5, privacy §30.3).
//
// Stage-A ships the HANDLER LOGIC (this router). Route MOUNTING onto the public
// router (host-independent, before the site-context middleware — the same
// stance as the homepage/listicles beacons so the /:slug catch-all can never
// swallow it) is Stage B, together with the wrangler [vars] entry for
// LEADGEN_EVENTS_FIREHOSE_STREAM.
//
// Contract (§22.5): fire-and-forget; accepts ONE event object or {events:[…]}
// (or a bare array) capped per request; ALWAYS 204 with an empty body — no
// reflection of any client byte; a malformed body / unknown type / KV or D1
// hiccup can never error the beacon. Public + UNAUTHENTICATED; the response is
// no-store.
//
// Pipeline per event (mirrors analytics/listicle-track.ts):
//   1. shape/type validation — event_type ∈ the §22.3 types; non-object or
//      oversized (> MAX_LEADGEN_EVENT_BYTES) → DEAD-LETTER (§22.5: a D1
//      `leadgen_event_dead_letter` row (migration 0038) + a
//      record_kind="dead_letter" audit record on the stream when configured).
//   2. server enrichment (OVERRIDES client claims for server-owned columns):
//      ip / ua / device / os / os_version / browser / browser_version, geo
//      country/state/city from request.cf, received_at, timestamp clamp,
//      quality flags (§22.2 is_bot/is_internal/is_preview/traffic_quality_flag).
//      Raw answer PII stays SUPPRESSED (§30.3) — leadgenEventFromPayload forces
//      answer_value_raw empty unless an audited allow-flag is set (never here).
//   3. §22.5 idempotency: event_id (client-minted; server mints one if absent —
//      documented: such an event cannot be replay-deduped). A short-TTL KV
//      seen-set drops immediate replays BEFORE Firehose.
//   4. privacy: Sec-GPC:1 or a ko_optout=1 cookie drops the batch silently.
//   5. sessions (§22.1/§22.3): every accepted `quote_view` also emits a
//      `leadgen.sessions` record (record_kind="session") to the SAME stream.
//   6. emit via emitLeadgenRecords — FAIL-OPEN, a structured no-op until the
//      stream var + AWS creds exist. A Firehose delivery error is swallowed by
//      emitLeadgenRecords and never breaks the 204 (§22.5 dead-letter posture).

import { Hono } from "hono";
import type { Env } from "../env";
import {
  LEADGEN_EVENT_TYPES,
  blankLeadgenEvent,
  emitLeadgenRecords,
  leadgenEventFromPayload,
  leadgenSessionFromQuoteView,
  type LeadgenEvent,
  type LeadgenDeadLetterRecord,
  type LeadgenStreamRecord,
} from "./leadgen-events";
import {
  readCfSignals,
  parseClientUa,
  geoFromCf,
  computeTrafficQuality,
} from "./listicle-quality";

const ALLOWED_TYPES: ReadonlySet<string> = new Set(LEADGEN_EVENT_TYPES);

// Max events accepted per request (§22.5 batched beacon).
export const MAX_LEADGEN_EVENTS_PER_REQUEST = 20;

// Oversized-event bound (a full §22.2 record is <4KB nominal; 16KB leaves
// generous headroom while keeping a hostile payload out of Firehose).
export const MAX_LEADGEN_EVENT_BYTES = 16 * 1024;

// KV seen-set TTL — "short-TTL drops immediate replays" (§22.5). 10 min covers
// the client retry-queue backoff horizon.
export const LEADGEN_SEEN_TTL_SECONDS = 600;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// The oversized-event bound is in BYTES, so measure UTF-8 byte length (not
// `.length` UTF-16 code units). One shared encoder (listicles idiom).
const LG_TEXT_ENCODER = new TextEncoder();
function byteLength(s: string): number {
  return LG_TEXT_ENCODER.encode(s).length;
}
function truncateToBytes(s: string, maxBytes: number): string {
  const bytes = LG_TEXT_ENCODER.encode(s);
  if (bytes.length <= maxBytes) return s;
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(
    bytes.subarray(0, maxBytes),
  );
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

// Hono's c.executionCtx GETTER throws where no ExecutionContext exists (unit-
// test harnesses) — the beacon must 204 regardless, so the context is captured
// once behind a no-op fallback (listicles idiom).
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

const leadgenTrackRouter = new Hono<{ Bindings: Env }>();

leadgenTrackRouter.post("/lg/track", async (c) => {
  const execCtx = safeExecutionCtx(c);
  // Server-side signals, read once per request.
  const ip = c.req.header("cf-connecting-ip") ?? "";
  const ua = c.req.header("user-agent") ?? "";
  const cookieHeader = c.req.header("Cookie") ?? null;
  const cf = readCfSignals(c.req.raw);
  const uaDetails = parseClientUa(ua);
  const geo = geoFromCf(cf);
  const now = Date.now();

  // Privacy (§30.3): a Global Privacy Control signal or the first-party opt-out
  // cookie drops the batch entirely — still 204, still no echo.
  const optedOut =
    c.req.header("Sec-GPC") === "1" || cookieHas(cookieHeader, "ko_optout=1");

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.body(null, 204);
  }

  // One event object OR {events:[…]} OR a bare array — capped.
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

  const capped = incoming.slice(0, MAX_LEADGEN_EVENTS_PER_REQUEST);

  const accepted: LeadgenEvent[] = [];
  const deadLetters: LeadgenDeadLetterRecord[] = [];

  const deadLetter = (eventId: string, payload: unknown, reason: string): void => {
    let json = "";
    try {
      json = JSON.stringify(payload) ?? "";
    } catch {
      json = "[unserializable]";
    }
    json = truncateToBytes(json, MAX_LEADGEN_EVENT_BYTES);
    deadLetters.push({
      record_kind: "dead_letter",
      event_id: eventId === "" ? genUuid() : eventId,
      reason,
      payload_json: json,
      received_at: now,
    });
  };

  for (const item of capped) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      deadLetter("", item, "not_an_object");
      continue;
    }
    const payload = item as Record<string, unknown>;
    const eventType = asString(payload["event_type"]);
    if (!ALLOWED_TYPES.has(eventType)) {
      deadLetter(asString(payload["event_id"]), payload, "invalid_event_type");
      continue;
    }
    let size = 0;
    try {
      size = byteLength(JSON.stringify(payload) ?? "");
    } catch {
      deadLetter(asString(payload["event_id"]), "[unserializable]", "unserializable");
      continue;
    }
    if (size > MAX_LEADGEN_EVENT_BYTES) {
      deadLetter(
        asString(payload["event_id"]),
        { event_id: payload["event_id"], event_type: eventType },
        "oversized",
      );
      continue;
    }

    // Build + enrich (§30.3 raw-PII suppression is enforced inside — no
    // allow-flag here, so answer_value_raw is forced empty).
    const event = leadgenEventFromPayload(payload, now);
    // §22.5: event_id is the idempotency key; a client that failed to mint one
    // gets a server UUID (documented: not replay-dedupable).
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

    // §22.2 quality flags (request signals + the event's own page URL/referer).
    // `tampered` is owned by the §19.1 auction path, not the beacon.
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

  // §22.5 KV seen-set: drop immediate replays pre-Firehose. Best-effort — a KV
  // hiccup accepts the event (downstream ReplacingMergeTree by event_id stays
  // authoritative). Keyed by event_id; page_view_id gives impression dedupe.
  const fresh: LeadgenEvent[] = [];
  for (const event of accepted) {
    let seen = false;
    try {
      const key = `lg_seen:${event.event_id}`;
      seen = (await c.env.CACHE.get(key)) !== null;
      if (!seen) {
        await c.env.CACHE.put(key, "1", { expirationTtl: LEADGEN_SEEN_TTL_SECONDS });
      }
    } catch {
      seen = false;
    }
    if (!seen) fresh.push(event);
  }

  // Sessions ride the same batch (quote_view only, §22.1/§22.3).
  const records: LeadgenStreamRecord[] = [...fresh];
  for (const event of fresh) {
    if (event.event_type === "quote_view") records.push(leadgenSessionFromQuoteView(event));
  }
  for (const dl of deadLetters) records.push(dl);

  // Background work: D1 dead-letter rows (§22.5). Fire-and-forget with its own
  // guard — the 204 never waits on it, a failure never surfaces.
  if (deadLetters.length > 0) {
    const backgroundWork = (async () => {
      for (const dl of deadLetters) {
        try {
          await c.env.DB.prepare(
            "INSERT INTO leadgen_event_dead_letter (event_id, payload_json, reason, received_at) VALUES (?, ?, ?, unixepoch())",
          )
            .bind(dl.event_id, dl.payload_json, dl.reason)
            .run();
        } catch {
          // dead-lettering must never break the beacon
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
  }

  // FAIL-OPEN Firehose dispatch (no-op until the stream var + creds exist).
  emitLeadgenRecords(c.env, execCtx, records);

  return c.body(null, 204);
});

export { leadgenTrackRouter };
export default leadgenTrackRouter;
