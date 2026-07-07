// LeadGen §25 provider-postback + §27 browser-pixel ingest routes (contract 08
// §25/§26/§27 + 09 §29/§30). Phase 13 Stage B — the PUBLIC revenue intake
// surface. Both handlers call the Stage-A pure-logic modules
// (leadgen/revenue-ingest.ts, leadgen/s2s-dispatch.ts, leadgen/fx.ts); NONE of
// the booking / dedupe / FX / redaction logic is re-implemented here.
//
//   * ingestProviderPostback (§25 s2s_postback, POST+GET /lg/pb/:provider):
//       token-gate (LEADGEN_PB_TOKEN_<PROVIDER>, absent ⇒ 401) → parse body/query
//       → recordPostbackLog ((provider,external_txn_id) dedupe; a replay is a
//       200 no-op) → decideBooking → on book: revenue_usd via FX, then a
//       CH-resolvable click books to leadgen_revenue_raw + fires the §26 S2S
//       pixel, else lands in the §29 unmatched queue. NEVER 500s into a provider.
//   * ingestBrowserPixel (§27 browser_side_pixel, GET /lg/px/:token):
//       :token = the Offer public_id → recordInSitePayout (durable
//       (click_id,dedupe_key) idempotency + cap-on-clean), books only on CLEAN
//       traffic (P11 predicate), fires the §26 S2S pixel once on a newly-booked
//       conversion (conversion_id = the dedupe_key — the shared KV dedupe key
//       (platform,click_id,event_name,conversion_id) makes the pixel + a server
//       postback for the SAME conversion notify the platform at most once), and
//       ALWAYS returns a 1x1 transparent GIF (never throws).
//
// D1/secret discipline (.claude/rules/d1-database-safety + 09 §30.2): every
// write is a Stage-A awaited .bind() writer; JSON.parse is in a try/catch;
// secrets resolve via readEnvSecret and are NEVER logged or reflected; the
// inbound token + common auth aliases are stripped from the payload before it
// is persisted (redacted) by recordPostbackLog.

import type { Env } from "../../env";
import { readEnvSecret } from "../../env";
import {
  decideBooking,
  getOfferByPublicId,
  insertRevenueRaw,
  queueRevenueUnmatched,
  recordInSitePayout,
  recordPostbackLog,
  type BookingDecision,
} from "../../leadgen/revenue-ingest";
import {
  dispatchMatchedConversionS2S,
  resolveClickContextFromCh,
} from "../../leadgen/s2s-dispatch";
import { computeRevenueUsd } from "../../leadgen/fx";
import { computeTrafficQuality, readCfSignals } from "../../analytics/listicle-quality";
import type { LeadgenChClient } from "../../leadgen/clickhouse";

// Test seams (production leaves them undefined → real behavior): a CH client for
// click-context resolution, and the outbound S2S fetch (so a test can observe
// the pixel fire without a live network). NEVER expands the public wire surface.
export interface IngestOptions {
  now?: Date;
  chClient?: LeadgenChClient;
  s2sFetch?: typeof fetch;
}

// ---------------------------------------------------------------------------
// no-store response helpers (§4.3: /lg/pb + /lg/px are no-store)
// ---------------------------------------------------------------------------

function jsonNoStore(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// A 1x1 transparent GIF (43 bytes) — the pixel's always-safe body (§27). Decoded
// once at module load; a Response never mutates the source buffer.
const TRANSPARENT_GIF: Uint8Array = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (ch) => ch.charCodeAt(0),
);

function gifNoStore(): Response {
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------------------
// small field extractors (post-parse; never throw)
// ---------------------------------------------------------------------------

function str(p: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const v = p[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

// { present, value } so an ABSENT revenue (reject) is distinct from an explicit
// 0 (a valid lead conversion).
function num(p: Record<string, unknown>, keys: readonly string[]): { present: boolean; value: number } {
  for (const key of keys) {
    const v = p[key];
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return { present: true, value: n };
  }
  return { present: false, value: 0 };
}

function tsNum(p: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const v = p[key];
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// UTC day for the revenue row (§29). Derived from the provider event_ts when
// present (auto-detects epoch seconds vs ms), else the receive time.
function utcDateFromEventTs(eventTs: number | null, now: Date): string {
  if (eventTs !== null && Number.isFinite(eventTs) && eventTs > 0) {
    const ms = eventTs < 1e11 ? eventTs * 1000 : eventTs; // < 1e11 ⇒ epoch seconds
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return now.toISOString().slice(0, 10);
}

// The presented postback token: X-Postback-Token header, OR Authorization:
// Bearer <token>, OR ?token=<token>. Trimmed; empty when none present.
function readPresentedToken(req: Request, url: URL): string {
  const header = req.headers.get("X-Postback-Token");
  if (header !== null && header.trim() !== "") return header.trim();
  const auth = req.headers.get("Authorization");
  if (auth !== null) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m !== null) return (m[1] ?? "").trim();
  }
  return (url.searchParams.get("token") ?? "").trim();
}

// The auth fields stripped from the persisted (redacted) payload copy so a
// shared secret never lands at rest (§30.2), even the ?token= query param.
const AUTH_FIELDS: readonly string[] = [
  "token",
  "auth",
  "auth_token",
  "secret",
  "sig",
  "signature",
  "key",
  "apikey",
  "api_key",
];

// ---------------------------------------------------------------------------
// §25 provider postback — POST/GET /lg/pb/:provider
// ---------------------------------------------------------------------------

export async function ingestProviderPostback(
  env: Env,
  ctx: ExecutionContext,
  provider: string,
  req: Request,
  opts?: IngestOptions,
): Promise<Response> {
  const now = opts?.now ?? new Date();
  const prov = provider.trim().toLowerCase();
  const url = new URL(req.url);

  // (a) TOKEN GATE (§30.2). Absent per-provider secret ⇒ 401 (never silently
  // accepted). Presented token from header / Bearer / ?token=; exact === compare.
  const expected = readEnvSecret(env, `LEADGEN_PB_TOKEN_${prov.toUpperCase()}`);
  if (expected === undefined) return jsonNoStore({ error: "unauthorized" }, 401);
  const presented = readPresentedToken(req, url);
  if (presented === "" || presented !== expected) return jsonNoStore({ error: "unauthorized" }, 401);

  // (b) PARSE the POST JSON body (corrupt ⇒ 400, never a throw) merged over the
  // query params (a GET-style provider carries everything in the query).
  const payload: Record<string, unknown> = {};
  for (const [k, v] of url.searchParams) payload[k] = v;
  if (req.method === "POST") {
    let text = "";
    try {
      text = await req.text();
    } catch {
      text = "";
    }
    if (text.trim() !== "") {
      try {
        const body = JSON.parse(text) as unknown;
        if (body !== null && typeof body === "object" && !Array.isArray(body)) {
          Object.assign(payload, body as Record<string, unknown>);
        } else {
          return jsonNoStore({ error: "invalid JSON body" }, 400);
        }
      } catch {
        return jsonNoStore({ error: "invalid JSON body" }, 400);
      }
    }
  }

  const externalTxnId = str(payload, ["external_txn_id", "txn_id", "transaction_id"]);
  const clickId = str(payload, ["click_id", "clickid", "cid"]);
  const offerPublicId = str(payload, ["offer_public_id", "offer_id", "offer"]);
  const revenue = num(payload, ["revenue", "payout", "amount", "value"]);
  const currencyRaw = str(payload, ["currency", "cur"]);
  const eventTs = tsNum(payload, ["event_ts", "ts", "timestamp"]);

  // §24/§29 strict validation (field NAMES only — never reflect a value): a
  // dedupe key (external_txn_id) + a click_id (revenue_raw.click_id NOT NULL) +
  // a finite non-negative revenue are required; currency is a 3-alpha ISO code.
  const fields: Record<string, string> = {};
  if (externalTxnId === "") fields.external_txn_id = "required";
  if (clickId === "") fields.click_id = "required";
  if (!revenue.present) fields.revenue = "required";
  else if (!Number.isFinite(revenue.value) || revenue.value < 0) fields.revenue = "must be a number >= 0";
  if (currencyRaw !== "" && !/^[A-Za-z]{3}$/.test(currencyRaw)) fields.currency = "must be a 3-letter ISO code";
  if (Object.keys(fields).length > 0) return jsonNoStore({ error: "invalid payload", fields }, 400);

  const currency = (currencyRaw || "USD").toUpperCase();
  const dt = utcDateFromEventTs(eventTs, now);

  // Strip auth material from the persisted (redacted) payload copy (§30.2).
  const logPayload: Record<string, unknown> = { ...payload };
  for (const field of AUTH_FIELDS) delete logPayload[field];

  // (f) NEVER 500 into the provider: every post-validation step is wrapped so a
  // storage hiccup returns a controlled 200 (the durable postback_log + §29
  // daily reconciliation are the backstop), never an unhandled 500.
  try {
    // (c) DEDUPE via leadgen_postback_log (provider, external_txn_id). A replay
    // (or an undedupable row) is recorded=false ⇒ an idempotent 200 no-op, no
    // second revenue row.
    const log = await recordPostbackLog(
      env,
      {
        provider: prov,
        external_txn_id: externalTxnId,
        click_id: clickId,
        offer_public_id: offerPublicId === "" ? null : offerPublicId,
        event_ts: eventTs,
        payload: logPayload,
      },
      { now },
    );
    if (!log.recorded) return jsonNoStore({ status: "duplicate" }, 200);

    // (d) BOOKING RULE (§25). A resolvable Offer drives decideBooking; an
    // unresolved Offer defaults to booking on conversion (a postback IS a
    // conversion signal — every conversion-triggered offer_type books, only an
    // explicitly click-booked CPC would not, which needs the Offer to detect).
    const offer = offerPublicId !== "" ? await getOfferByPublicId(env.DB, offerPublicId) : null;
    const decision: BookingDecision =
      offer !== null
        ? decideBooking({ offer_type: offer.offer_type, signal: "conversion", source: "s2s_postback" })
        : { book: true, booking_trigger: "conversion", reason: "postback conversion (offer unresolved) books on conversion" };

    if (decision.book) {
      const revenueUsd = await computeRevenueUsd(env.DB, dt, currency, revenue.value);
      // (d)/(e) A CH-resolvable click attributes NOW (leadgen_revenue_raw) + fires
      // the §26 S2S pixel; an unresolvable click (CH absent, or the click has not
      // landed) lands in the §29 unmatched queue (re-matched 72h) and fires no S2S.
      const clickCtx = await resolveClickContextFromCh(
        env,
        clickId,
        opts?.chClient !== undefined ? { client: opts.chClient } : undefined,
      );
      if (clickCtx !== null) {
        await insertRevenueRaw(env.DB, {
          dt,
          click_id: clickId,
          offer_public_id: offerPublicId === "" ? null : offerPublicId,
          source: "s2s_postback",
          booking_trigger: decision.booking_trigger,
          conversions: 1,
          revenue: revenue.value,
          currency,
        });
        await dispatchMatchedConversionS2S(
          env,
          ctx,
          env.DB,
          clickCtx,
          { revenue: revenue.value, currency, conversion_id: externalTxnId },
          { now: now.getTime(), ...(opts?.s2sFetch !== undefined ? { fetchImpl: opts.s2sFetch } : {}) },
        );
      } else {
        await queueRevenueUnmatched(env.DB, {
          click_id: clickId,
          provider: prov,
          external_txn_id: externalTxnId,
          revenue: revenue.value,
          currency,
          revenue_usd: revenueUsd,
        });
      }
    }
  } catch (err) {
    // §25 posture: a provider is NEVER handed a 500. Log server-side (no PII)
    // and ack; the postback_log row + §29 reconciliation surface any residual.
    console.error(`[lg-pb] ${prov} ingest error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    return jsonNoStore({ status: "accepted" }, 200);
  }

  return jsonNoStore({ status: "accepted" }, 200);
}

// ---------------------------------------------------------------------------
// §27 browser-side pixel — GET /lg/px/:token
// ---------------------------------------------------------------------------

export async function ingestBrowserPixel(
  env: Env,
  ctx: ExecutionContext,
  token: string,
  req: Request,
  opts?: IngestOptions,
): Promise<Response> {
  const now = opts?.now ?? new Date();
  try {
    // :token resolves to the Offer public_id. A missing/unknown Offer ⇒ a safe
    // GIF with NO booking (never an oracle, never a throw).
    const offerPid = token.trim();
    const offer = offerPid !== "" ? await getOfferByPublicId(env.DB, offerPid) : null;
    if (offer === null) return gifNoStore();

    const url = new URL(req.url);
    const clickId = (url.searchParams.get("click_id") ?? "").trim();
    const conversionId = (url.searchParams.get("conversion_id") ?? "").trim(); // → dedupe_key
    const valueRaw = url.searchParams.get("value");
    const parsedValue = valueRaw === null ? NaN : Number(valueRaw);
    const value = Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
    const currency = ((url.searchParams.get("currency") ?? "").trim() || "USD").toUpperCase();

    // §29 CLEAN-only booking (P11 predicate reused verbatim): preview / bot /
    // internal traffic is flagged and NEVER books revenue.
    const quality = computeTrafficQuality({
      cf: readCfSignals(req),
      userAgent: req.headers.get("User-Agent"),
      cookieHeader: req.headers.get("Cookie"),
      urls: [url.href, req.headers.get("Referer") ?? ""],
    });
    const clean = quality.traffic_quality_flag === "clean";

    if (clean && clickId !== "" && conversionId !== "") {
      const dtUtc = now.toISOString().slice(0, 10);
      // §25/§27 durable (click_id,dedupe_key) idempotency; the cap bumps EXACTLY
      // once on a newly-created booking, on clean traffic.
      const outcome = await recordInSitePayout(env.DB, offer, clickId, conversionId, dtUtc, value, currency, clean, now);
      if (outcome.recorded && outcome.deduped !== true) {
        // §26 fire the outbound S2S pixel ONCE on the newly-booked conversion.
        // conversion_id = the dedupe_key: the shared KV key
        // (platform,click_id,event_name,conversion_id) makes the pixel + a server
        // postback for the SAME conversion notify the platform at most once.
        const clickCtx = await resolveClickContextFromCh(
          env,
          clickId,
          opts?.chClient !== undefined ? { client: opts.chClient } : undefined,
        );
        if (clickCtx !== null) {
          await dispatchMatchedConversionS2S(
            env,
            ctx,
            env.DB,
            clickCtx,
            { revenue: value, currency, conversion_id: conversionId },
            { now: now.getTime(), ...(opts?.s2sFetch !== undefined ? { fetchImpl: opts.s2sFetch } : {}) },
          );
        }
      }
    }
  } catch (err) {
    // §27: the pixel NEVER throws into the browser — always a GIF.
    console.error(`[lg-px] pixel error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
  }
  return gifNoStore();
}
