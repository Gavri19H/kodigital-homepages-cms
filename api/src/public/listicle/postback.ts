// POST /api/pb/:provider — inbound provider revenue postback (design contract
// §19 intake channel `s2s_postback` + §24 security + §31.7 reconciliation).
//
// Steps (§19/§24, in order):
//   1. resolve the provider adapter (unknown provider → 404, no payload echo);
//   2. verifyToken(provider, token) — per-provider shared secret
//      LISTICLE_PB_TOKEN_<PROVIDER> (env), CONSTANT-TIME compare; bad/missing
//      → 401 (a provider with no configured secret can never be verified);
//   3. rate-limit per provider (KV fixed-window; fail-open on KV error so a
//      real conversion is never dropped by a counting hiccup);
//   4. parse + STRICTLY validate the provider payload (click_id +
//      external_txn_id required, revenue a finite ≥0 number, 3-alpha currency);
//   5. dedupe via listicle_postback_log UNIQUE(provider, external_txn_id) — a
//      replay is an idempotent no-op 200;
//   6. AWAIT the business-critical listicle_revenue_raw insert
//      (source='s2s_postback', conversions=1);
//   7. fast 200. The heavy work — resolving the click's clean offer_click from
//      ClickHouse, the §9.3 conversion-cap increment (CLEAN match only), the
//      §20 outbound S2S pixel, and the §31.7 unmatched-queue on no-match — runs
//      on ctx.waitUntil so the provider gets its 200 immediately.
//
// SECURITY (§24): the response body NEVER reflects a payload byte (fixed status
// strings + field NAMES only); .bind() parameterized SQL; no open redirect.

import { Hono } from "hono";
import type { Env } from "../../env";
import type { WaitUntilContext } from "../../wait-until-context";
import { readEnvSecret } from "../../env";
import {
  queueRevenueUnmatched,
  getOfferByPublicId,
  bumpCapConversions,
  isConversionCapped,
} from "../../listicles/revenue-ingest";
import { computeRevenueUsd } from "../../listicles/fx";
import {
  dispatchMatchedConversionS2S,
  resolveClickContextFromCh,
} from "../../listicles/s2s-dispatch";

// ---------------------------------------------------------------------------
// Provider adapters (§19 "per-provider adapter shape")
// ---------------------------------------------------------------------------

export interface ParsedPostback {
  click_id: string;
  external_txn_id: string;
  revenue: number;
  currency: string;
  event_ts: number | null;
  offer_public_id: string | null;
}

export type AdapterResult =
  | { ok: true; value: ParsedPostback }
  | { ok: false; fields: Record<string, string> };

export interface ProviderAdapter {
  name: string;
  parse(payload: Record<string, unknown>): AdapterResult;
}

function str(p: Record<string, unknown>, key: string): string {
  const v = p[key];
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function firstStr(p: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = str(p, k);
    if (v !== "") return v;
  }
  return "";
}

// Parse a revenue amount from the first present key. Returns { present, value }
// so "absent" (strict-reject) is distinguishable from an explicit 0 (a lead).
function parseRevenue(p: Record<string, unknown>, keys: string[]): { present: boolean; value: number } {
  for (const k of keys) {
    const v = p[k];
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (Number.isFinite(n)) return { present: true, value: n };
    return { present: true, value: NaN }; // present but unparseable → validation fails
  }
  return { present: false, value: 0 };
}

function parseTs(p: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = p[k];
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// Shared strict validation over the extracted candidate (§24 strict payload).
function validateExtracted(candidate: {
  click_id: string;
  external_txn_id: string;
  revenue: { present: boolean; value: number };
  currencyRaw: string;
  event_ts: number | null;
  offer_public_id: string;
}): AdapterResult {
  const fields: Record<string, string> = {};
  if (candidate.click_id === "") fields.click_id = "required";
  if (candidate.external_txn_id === "") fields.external_txn_id = "required";
  if (!candidate.revenue.present) fields.revenue = "required";
  else if (!Number.isFinite(candidate.revenue.value) || candidate.revenue.value < 0) {
    fields.revenue = "must be a number >= 0";
  }
  let currency = candidate.currencyRaw;
  if (currency === "") currency = "USD";
  else if (!/^[A-Za-z]{3}$/.test(currency)) fields.currency = "must be a 3-letter ISO code";
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: {
      click_id: candidate.click_id,
      external_txn_id: candidate.external_txn_id,
      revenue: candidate.revenue.value,
      currency: currency.toUpperCase(),
      event_ts: candidate.event_ts,
      offer_public_id: candidate.offer_public_id === "" ? null : candidate.offer_public_id,
    },
  };
}

// The generic adapter — the neutral re-implementation of the legacy
// report/API import (§19 "Pattern only"). Standard field names with common
// aliases; a new revenue provider that uses this shape needs ONLY a secret +
// a one-line POSTBACK_ADAPTERS alias (no new adapter code).
export const genericAdapter: ProviderAdapter = {
  name: "generic",
  parse(p) {
    return validateExtracted({
      click_id: firstStr(p, ["click_id", "clickid", "cid"]),
      external_txn_id: firstStr(p, ["external_txn_id", "txn_id", "transaction_id"]),
      revenue: parseRevenue(p, ["revenue", "payout", "amount"]),
      currencyRaw: firstStr(p, ["currency", "cur"]),
      event_ts: parseTs(p, ["event_ts", "ts", "timestamp"]),
      offer_public_id: firstStr(p, ["offer_public_id", "offer", "offer_id"]),
    });
  },
};

// A CAPI-style adapter demonstrating a DIFFERENT payload shape + a SUB-MAPPING:
// the click_id arrives in `sub1` (the traffic sub-id round-tripped through the
// platform), the dedupe key is the platform `event_id`, the value is `value`,
// and the timestamp is `event_time` (epoch seconds). Proves the adapter seam
// (§19 "per-provider adapter shape") without any provider-specific token.
export const capiAdapter: ProviderAdapter = {
  name: "capi",
  parse(p) {
    return validateExtracted({
      click_id: firstStr(p, ["sub1", "click_id"]),
      external_txn_id: firstStr(p, ["event_id", "external_txn_id"]),
      revenue: parseRevenue(p, ["value", "revenue"]),
      currencyRaw: firstStr(p, ["currency"]),
      event_ts: parseTs(p, ["event_time", "event_ts"]),
      offer_public_id: firstStr(p, ["offer_public_id", "offer"]),
    });
  },
};

// The provider registry (§19). The :provider path param selects the adapter by
// name; an unregistered provider → 404 (no open ingestion of arbitrary provider
// strings — a §24 posture). Add a provider = add one entry (alias to
// genericAdapter for a standard shape); documented in revenue-secrets.md.
export const POSTBACK_ADAPTERS: Readonly<Record<string, ProviderAdapter>> = {
  generic: genericAdapter,
  capi: capiAdapter,
};

// ---------------------------------------------------------------------------
// Token verification (§24 per-provider shared secret, constant-time)
// ---------------------------------------------------------------------------

// Value-safe, LENGTH-safe token compare (FIX 5): hash BOTH sides to a fixed
// 32-byte SHA-256 digest and compare those. Because both operands are always
// the same fixed length, total compare time never leaks the secret's length
// (nor its prefix — the digest of a near-miss differs uniformly). Falls back to
// a fixed-work byte compare if WebCrypto is somehow unavailable.
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (subtle !== undefined) {
    const [ha, hb] = await Promise.all([
      subtle.digest("SHA-256", enc.encode(a)),
      subtle.digest("SHA-256", enc.encode(b)),
    ]);
    const va = new Uint8Array(ha);
    const vb = new Uint8Array(hb);
    let diff = 0;
    for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!; // both 32 bytes
    return diff === 0;
  }
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// The env secret name for a provider: LISTICLE_PB_TOKEN_<PROVIDER> (uppercased).
export function postbackTokenEnvName(provider: string): string {
  return `LISTICLE_PB_TOKEN_${provider.toUpperCase()}`;
}

export async function verifyPostbackToken(env: Env, provider: string, presented: string): Promise<boolean> {
  const secret = readEnvSecret(env, postbackTokenEnvName(provider));
  if (secret === undefined || presented === "") return false; // unconfigured / missing → cannot verify
  return timingSafeEqualStr(presented, secret);
}

// ---------------------------------------------------------------------------
// Rate limiting (§24 "rate-limited") — per-provider KV fixed-window counter
// ---------------------------------------------------------------------------

// Authored bound: 600 postbacks/provider/minute (10/s sustained) — generous for
// a real provider, a wall against an abusive burst. Fail-OPEN on any KV error:
// a counting hiccup must never drop a legitimate conversion (documented — the
// UNIQUE dedupe still bounds duplicate WRITES).
export const POSTBACK_RATE_LIMIT_PER_MINUTE = 600;

export async function checkPostbackRateLimit(env: Env, provider: string, now: number): Promise<boolean> {
  try {
    const minute = Math.floor(now / 60000);
    const key = `lst_pb_rl:${provider}:${minute}`;
    const current = await env.CACHE.get(key);
    const count = current === null ? 0 : parseInt(current, 10);
    const n = Number.isFinite(count) ? count : 0;
    if (n >= POSTBACK_RATE_LIMIT_PER_MINUTE) return false;
    await env.CACHE.put(key, String(n + 1), { expirationTtl: 120 });
    return true;
  } catch {
    return true; // fail-open
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Sanitize the :provider path param to a safe registry/env-name token.
// [a-z0-9_] only (uppercased for the env name); anything else → "" (→ 404).
function sanitizeProvider(raw: string | undefined): string {
  const p = (raw ?? "").trim().toLowerCase();
  return /^[a-z0-9_]+$/.test(p) ? p : "";
}

// §31.7 UTC day for the revenue row. Derived from the provider's event_ts when
// present (seconds OR ms — auto-detected), else the receive time.
export function utcDateFromEventTs(eventTs: number | null, now: Date): string {
  if (eventTs !== null && Number.isFinite(eventTs) && eventTs > 0) {
    const ms = eventTs < 1e11 ? eventTs * 1000 : eventTs; // <1e11 ⇒ epoch seconds
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return now.toISOString().slice(0, 10);
}

function safeExecutionCtx(c: { executionCtx: WaitUntilContext }): WaitUntilContext {
  try {
    return c.executionCtx;
  } catch {
    return {
      waitUntil(): void {},
    };
  }
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

const listiclePostbackRouter = new Hono<{ Bindings: Env }>();

listiclePostbackRouter.post("/api/pb/:provider", async (c) => {
  const now = new Date();
  const nowMs = now.getTime();

  const provider = sanitizeProvider(c.req.param("provider"));
  const adapter = provider === "" ? undefined : POSTBACK_ADAPTERS[provider];
  if (adapter === undefined) {
    // §24: unknown provider — no payload echo.
    return c.json({ error: "unknown provider" }, 404);
  }

  // §24 token (header preferred; ?token= accepted for GET-style providers).
  const presented = (c.req.header("X-Postback-Token") ?? c.req.query("token") ?? "").trim();
  if (!(await verifyPostbackToken(c.env, provider, presented))) {
    return c.json({ error: "unauthorized" }, 401);
  }

  if (!(await checkPostbackRateLimit(c.env, provider, nowMs))) {
    return c.json({ error: "rate limited" }, 429);
  }

  // Merge query params with a JSON body (body wins on key overlap). A GET-style
  // provider POSTs with query params; a JSON provider POSTs a body.
  const payload: Record<string, unknown> = { ...c.req.query() };
  try {
    const body = (await c.req.json()) as unknown;
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      Object.assign(payload, body as Record<string, unknown>);
    }
  } catch {
    // no/invalid JSON body — query-param providers are still valid.
  }

  // §24 (FIX 2): the shared secret must live ONLY in a wrangler secret — never
  // at rest. Strip the token (and common auth aliases) from the payload copy
  // BEFORE it is parsed or persisted into listicle_postback_log.payload_json.
  for (const authField of ["token", "auth", "auth_token", "secret", "sig", "signature", "key", "apikey", "api_key"]) {
    delete payload[authField];
  }

  const parsed = adapter.parse(payload);
  if (!parsed.ok) {
    // §24: field NAMES only, never the offending values.
    return c.json({ error: "invalid payload", fields: parsed.fields }, 400);
  }
  const { click_id, external_txn_id, revenue, currency, event_ts, offer_public_id } = parsed.value;

  const db = c.env.DB;

  // §19/§31.7 dedupe: existence check + INSERT, both guarded by the UNIQUE
  // (provider, external_txn_id). A replay is an idempotent no-op 200.
  try {
    const existing = await db
      .prepare("SELECT id FROM listicle_postback_log WHERE provider = ? AND external_txn_id = ? LIMIT 1")
      .bind(provider, external_txn_id)
      .first<{ id: number }>();
    if (existing !== null) {
      return c.json({ status: "duplicate" }, 200);
    }
  } catch {
    // a read hiccup falls through to the INSERT, whose UNIQUE is authoritative.
  }

  const dt = utcDateFromEventTs(event_ts, now);
  let payloadJson = "";
  try {
    payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 8192) payloadJson = payloadJson.slice(0, 8192);
  } catch {
    payloadJson = "";
  }

  // §19 steps (3)+(4) ATOMICALLY (FIX 3): the dedupe-log INSERT and the
  // business-critical revenue_raw INSERT run in ONE transactional db.batch —
  // log FIRST so its UNIQUE(provider, external_txn_id) is the dedupe gate. If
  // the batch fails, NOTHING commits (no half-written dedupe row that would
  // make a provider retry look like a duplicate and silently lose revenue).
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO listicle_postback_log
             (provider, external_txn_id, click_id, offer_public_id, event_ts, payload_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(provider, external_txn_id, click_id, offer_public_id, event_ts, payloadJson),
      db
        .prepare(
          `INSERT INTO listicle_revenue_raw
             (dt, click_id, offer_public_id, source, conversions, revenue, currency)
           VALUES (?, ?, ?, 's2s_postback', 1, ?, ?)`,
        )
        .bind(dt, click_id, offer_public_id, revenue, currency),
    ]);
  } catch {
    // The batch is atomic → on ANY failure nothing committed. Distinguish a
    // concurrent-replay UNIQUE (the row now exists, committed WITH its revenue
    // by the other request → idempotent 200) from a transient error that rolled
    // back (row absent → 503 so the provider RETRIES; revenue is never lost).
    let committedByOther = false;
    try {
      const exists = await db
        .prepare("SELECT id FROM listicle_postback_log WHERE provider = ? AND external_txn_id = ? LIMIT 1")
        .bind(provider, external_txn_id)
        .first<{ id: number }>();
      committedByOther = exists !== null;
    } catch {
      // fall through to retryable
    }
    if (committedByOther) return c.json({ status: "duplicate" }, 200);
    return c.json({ error: "temporarily unavailable" }, 503);
  }

  // Heavy work → ctx.waitUntil (the 200 does not wait on it):
  //   * resolve the clean offer_click from CH (matched vs unmatched);
  //   * matched → §9.3 conversion-cap increment (CLEAN-only, satisfied by the
  //     CH clean filter) + §20 outbound S2S pixel;
  //   * unmatched → §31.7 pending queue (with §31.7 revenue_usd).
  const execCtx = safeExecutionCtx(c);
  const background = (async () => {
    const clickCtx = await resolveClickContextFromCh(c.env, click_id);
    if (clickCtx !== null) {
      // §9.3 conversion cap — the matched offer_click is clean-filtered by CH,
      // so this increment is CLEAN-only by construction.
      const offerPid = offer_public_id ?? (clickCtx.offer_id !== "" ? clickCtx.offer_id : null);
      if (offerPid !== null) {
        try {
          const offer = await getOfferByPublicId(db, offerPid);
          if (offer !== null && isConversionCapped(offer)) {
            await bumpCapConversions(db, offer, now);
          }
        } catch {
          /* cap bookkeeping never blocks the pipeline */
        }
      }
      // §20 outbound S2S back to the media platform that sent the click.
      await dispatchMatchedConversionS2S(c.env, execCtx, db, clickCtx, {
        value: String(revenue),
        currency,
      });
    } else {
      // §31.7 unmatched — CH unconfigured OR the clean offer_click has not
      // landed yet. Queue pending; the sweep re-matches for 72h then marks
      // unattributed. HONEST RESIDUAL: matched S2S/cap on the postback path
      // require CH configured + the click landed (the browser-conversion path
      // is the CH-independent S2S/cap trigger).
      try {
        const revenue_usd = await computeRevenueUsd(db, dt, currency, revenue);
        await queueRevenueUnmatched(db, {
          click_id,
          provider,
          external_txn_id,
          revenue,
          currency,
          revenue_usd,
        });
      } catch {
        /* unmatched bookkeeping is best-effort; revenue_raw is the durable row */
      }
    }
  })().catch(() => {
    /* background work never surfaces as an unhandled rejection */
  });
  try {
    execCtx.waitUntil(background);
  } catch {
    void background;
  }

  return c.json({ status: "accepted" }, 200);
});

export { listiclePostbackRouter };
export default listiclePostbackRouter;
