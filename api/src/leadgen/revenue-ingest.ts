// LeadGen provider-revenue ingestion + §25 booking rules (contract 08 §25 +
// 09 §29/§30). The shared revenue-side D1/KV writers the postback route
// (/lg/pb/:provider), the browser pixel (/lg/px), and the in-site conversion
// beacon call — the ROUTES are a later stage; this module is the PURE LOGIC.
//
//   * getOfferByPublicId   — the Offer's booking/cap columns by {offer_id}.
//   * insertRevenueRaw     — the §25 leadgen_revenue_raw staging row (source +
//                            booking_trigger satisfy the 0038 CHECKs);
//                            business-critical → the caller AWAITS it.
//   * queueRevenueUnmatched— §29 pending queue when a postback's click_id has no
//                            matching click yet (re-matched 72h → unattributed).
//   * recordInSitePayout   — §25/§27 in-site conversion booking with DURABLE
//                            replay idempotency via leadgen_conversion_log
//                            (click_id, dedupe_key) UNIQUE (0039). A replay is a
//                            no-op; the conversion cap bumps EXACTLY ONCE (reuses
//                            caps.ts incrementCap — never a re-implemented count).
//   * recordPostbackLog    — §29/§30.3 postback dedupe via leadgen_postback_log
//                            (provider, external_txn_id) UNIQUE (0038) + a REDACTED
//                            payload column + an AES-GCM debug_ref KV blob (absent
//                            key ⇒ NULL ref — the P10 pattern, no re-implemented
//                            crypto). A replay is a no-op.
//   * resolveBookingTrigger / decideBooking — the §25 booking-rule helpers.
//   * isConversionCapped   — §25 conversion-cap predicate.
//
// D1 discipline (.claude/rules/d1-database-safety): every write is .bind()
// parameterized on FIXED-literal table/column names; the cap counter is caps.ts's
// atomic UPSERT; the in-site booking is a single db.batch (transactional);
// business-critical writes are awaited; `??` (not `||`) guards numeric defaults.

import type { Env } from "../env";
import {
  DEBUG_BLOB_TTL_SECONDS,
  DEBUG_ENCRYPTION_SECRET_NAME,
  DEBUG_REF_PREFIX,
  encryptDebugBlob,
  randomHex,
} from "../admin/leadgen/payload-builder-handlers";
import type {
  LeadgenCapCountBy,
  LeadgenOfferStatus,
  LeadgenOfferType,
  LeadgenTrackingMethod,
} from "../admin/leadgen/db-types";
import { readEnvSecret } from "../env";
import { incrementCap } from "./caps";
import { redactPii } from "./redact";

// The 0038 leadgen_revenue_raw.source CHECK set. Exported so callers pass a
// compile-checked literal, never a free string that could violate the CHECK.
export type RevenueSource = "s2s_postback" | "api" | "script" | "in_site";
// The 0038 leadgen_revenue_raw.booking_trigger CHECK set (§25).
export type BookingTrigger = "click" | "conversion";

// The Offer columns the revenue path needs (a projection of the §7.1 Row) — a
// structural superset of caps.ts's LeadgenCapOffer, so it drops straight into
// incrementCap / isConversionCapped without a re-shape.
export interface OfferRevenueRow {
  id: number;
  public_id: string;
  offer_type: LeadgenOfferType;
  conversion_tracking_method: LeadgenTrackingMethod;
  cap_enabled: number;
  cap_amount: number | null;
  cap_timezone: string | null;
  cap_count_by: LeadgenCapCountBy | null;
  cap_fallback_offer_id: number | null;
  cap_fallback_url: string | null;
  status: LeadgenOfferStatus;
}

// Offer booking/cap columns by public_id (the {offer_id} macro / analytics key).
// No status filter — a conversion attributes to the Offer it names even if the
// operator later paused it; the caller inspects `status` if it cares.
export async function getOfferByPublicId(
  db: D1Database,
  publicId: string,
): Promise<OfferRevenueRow | null> {
  if (publicId === "") return null;
  const row = await db
    .prepare(
      `SELECT id, public_id, offer_type, conversion_tracking_method,
              cap_enabled, cap_amount, cap_timezone, cap_count_by,
              cap_fallback_offer_id, cap_fallback_url, status
       FROM leadgen_offers WHERE public_id = ? LIMIT 1`,
    )
    .bind(publicId)
    .first<OfferRevenueRow>();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// §25 booking rules
// ---------------------------------------------------------------------------

export type BookingSignal = "click" | "conversion";

export interface BookingRuleInput {
  offer_type: LeadgenOfferType;
  signal: BookingSignal; // the event that arrived
  source: RevenueSource; // the channel it arrived on
  // §25: a CPC Offer books on CLICK only when EXPLICITLY configured to (a
  // per-click CPC feed). Default false → CPC waits for a conversion signal.
  cpc_books_on_click?: boolean;
}

export interface BookingDecision {
  book: boolean;
  booking_trigger: BookingTrigger; // the value STAMPED on leadgen_revenue_raw
  reason: string;
}

// §25 the offer_type's configured booking_trigger (the value a booked row is
// STAMPED with). CPC books on CLICK only when explicitly click-booked; every
// other case (CPC-default, CPL/CPA/CPI) books on CONVERSION.
export function resolveBookingTrigger(
  offerType: LeadgenOfferType,
  opts?: { cpc_books_on_click?: boolean },
): BookingTrigger {
  return offerType === "cpc" && opts?.cpc_books_on_click === true ? "click" : "conversion";
}

// §25 the full booking decision for an arriving signal:
//   * source='in_site'  → ALWAYS books (immediately, via the deduped in-site
//     conversion log), stamped 'conversion';
//   * a CLICK signal     → books ONLY for a click-booked CPC Offer (never
//     CPL/CPA/CPI, never a conversion-triggered CPC);
//   * a CONVERSION signal→ books for a conversion-triggered Offer (never a
//     click-booked CPC Offer, which already booked at click).
export function decideBooking(input: BookingRuleInput): BookingDecision {
  const trigger = resolveBookingTrigger(input.offer_type, {
    cpc_books_on_click: input.cpc_books_on_click,
  });
  if (input.source === "in_site") {
    return { book: true, booking_trigger: "conversion", reason: "in_site conversion books immediately (deduped)" };
  }
  if (input.signal === "click") {
    return trigger === "click"
      ? { book: true, booking_trigger: "click", reason: "CPC explicitly configured to book on click" }
      : { book: false, booking_trigger: trigger, reason: "a click never books a conversion-triggered offer" };
  }
  return trigger === "conversion"
    ? { book: true, booking_trigger: "conversion", reason: "conversion books a conversion-triggered offer" }
    : { book: false, booking_trigger: trigger, reason: "a conversion does not re-book a click-booked CPC offer" };
}

// §25 conversion-cap predicate: cap enabled AND counting conversions.
export function isConversionCapped(
  offer: Pick<OfferRevenueRow, "cap_enabled" | "cap_count_by">,
): boolean {
  return offer.cap_enabled === 1 && offer.cap_count_by === "conversions";
}

// ---------------------------------------------------------------------------
// §25 leadgen_revenue_raw staging + §29 unmatched queue
// ---------------------------------------------------------------------------

export interface RevenueRawInput {
  dt: string; // 'YYYY-MM-DD' UTC (§29)
  click_id: string; // NOT NULL in 0038
  offer_public_id: string | null;
  source: RevenueSource;
  booking_trigger: BookingTrigger;
  conversions: number;
  revenue: number;
  currency: string;
}

// §25 staging insert. Business-critical → the caller AWAITS it. Postback-path
// idempotency is enforced UPSTREAM by recordPostbackLog's (provider,
// external_txn_id) UNIQUE gate, so a replayed postback never reaches here.
export async function insertRevenueRaw(db: D1Database, input: RevenueRawInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO leadgen_revenue_raw
         (dt, click_id, offer_public_id, source, booking_trigger, conversions, revenue, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.dt,
      input.click_id,
      input.offer_public_id,
      input.source,
      input.booking_trigger,
      input.conversions,
      input.revenue,
      input.currency,
    )
    .run();
}

export interface RevenueUnmatchedInput {
  click_id: string;
  provider: string;
  external_txn_id: string | null;
  revenue: number;
  currency: string;
  revenue_usd: number | null; // §29 normalized; NULL when no FX rate is known
}

// §29 pending queue. Recorded when a postback's click_id has no matching click
// at ingest time; the sweep re-matches for 72h, then marks it unattributed.
// Business-critical → awaited.
export async function queueRevenueUnmatched(
  db: D1Database,
  input: RevenueUnmatchedInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO leadgen_revenue_unmatched
         (click_id, provider, external_txn_id, revenue, currency, revenue_usd, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .bind(
      input.click_id,
      input.provider,
      input.external_txn_id,
      input.revenue,
      input.currency,
      input.revenue_usd,
    )
    .run();
}

// ---------------------------------------------------------------------------
// §25/§27 in-site conversion booking (durable replay idempotency)
// ---------------------------------------------------------------------------

export interface InSitePayoutOutcome {
  recorded: boolean;
  reason?: string;
  revenue?: number;
  currency?: string;
  capIncremented?: boolean;
  deduped?: boolean; // true ⇒ a replay of an already-booked conversion (no-op)
}

// §25/§27 in-site conversion booking. Unlike the Listicles model (a static
// Offer payout_value column), LeadGen Offers carry NO payout columns — the
// conversion VALUE + currency come from the conversion EVENT (the pixel's
// value_source / posted value) and are staged verbatim (leadgen_conversion_log
// carries revenue/currency). Any offer_type may book an in-site conversion
// (§25: source='in_site' books immediately), so there is no payout_method gate.
//
// Atomicity: the revenue INSERT…SELECT is gated on the conversion_log row NOT
// yet existing, and the log INSERT OR IGNORE records the booking — BOTH in ONE
// db.batch (transactional). The revenue insert runs FIRST so its NOT-EXISTS
// sees the PRE-batch log state; UNIQUE(click_id, dedupe_key) is the
// authoritative guard, so a replay inserts 0 revenue rows. The cap bump fires
// ONLY when revenue was newly booked, on CLEAN traffic (§29 preview/simulate
// never books), reusing caps.ts incrementCap (never a re-implemented counter).
// An empty click_id (revenue_raw.click_id NOT NULL) or an empty dedupeKey (§29
// "no stable dedupe key ⇒ never booked") is refused — money is never written on
// an ephemeral identity. Never throws into the caller for a logic decision.
export async function recordInSitePayout(
  db: D1Database,
  offer: OfferRevenueRow,
  clickId: string,
  dedupeKey: string,
  dtUtc: string,
  revenue: number,
  currency: string,
  clean: boolean,
  now: Date,
): Promise<InSitePayoutOutcome> {
  if (clickId === "") {
    return { recorded: false, reason: "no click_id on in-site conversion" };
  }
  if (dedupeKey === "") {
    return { recorded: false, reason: "no booking key (underivable dedupe identity)" };
  }
  if (!clean) {
    // §29: preview / simulate / bot / internal (non-clean) traffic NEVER books
    // revenue. Enforced at the money-writer itself (defense-in-depth) so no
    // caller can book dirty revenue by forgetting to gate — the /lg/px route
    // also gates on clean, but the writer is the authoritative refusal.
    return { recorded: false, reason: "non-clean traffic never books revenue (§29)" };
  }
  const value =
    typeof revenue === "number" && Number.isFinite(revenue) && revenue >= 0 ? revenue : 0;
  const cur = (typeof currency === "string" ? currency : "").trim() || "USD";

  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO leadgen_revenue_raw
           (dt, click_id, offer_public_id, source, booking_trigger, conversions, revenue, currency)
         SELECT ?, ?, ?, 'in_site', 'conversion', 1, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM leadgen_conversion_log WHERE click_id = ? AND dedupe_key = ?)`,
      )
      .bind(dtUtc, clickId, offer.public_id, value, cur, clickId, dedupeKey),
    db
      .prepare(
        `INSERT OR IGNORE INTO leadgen_conversion_log
           (click_id, dedupe_key, offer_public_id, source, revenue, currency)
         VALUES (?, ?, ?, 'in_site', ?, ?)`,
      )
      .bind(clickId, dedupeKey, offer.public_id, value, cur),
  ]);

  const revenueInserted =
    ((results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) === 1;
  if (!revenueInserted) {
    // Already booked (replay) — the batch inserted 0 revenue rows. No cap bump.
    return {
      recorded: false,
      reason: "duplicate conversion (already booked)",
      deduped: true,
      revenue: value,
      currency: cur,
    };
  }

  let capIncremented = false;
  if (clean && isConversionCapped(offer)) {
    // Reuse the caps.ts atomic UPSERT — a conversion-capped Offer bumps
    // conversion_count (effectiveCountBy picks the column). Never re-counted.
    await incrementCap(db, offer, now);
    capIncremented = true;
  }
  return { recorded: true, revenue: value, currency: cur, capIncremented, deduped: false };
}

// ---------------------------------------------------------------------------
// §29/§30.3 postback log — (provider, external_txn_id) dedupe + PII redaction
// ---------------------------------------------------------------------------

export interface PostbackLogInput {
  provider: string;
  external_txn_id: string;
  click_id: string | null;
  offer_public_id: string | null;
  event_ts: number | null;
  // The parsed inbound postback payload (post-JSON.parse). Stored REDACTED in
  // the admin-visible column; the FULL copy lives only in the encrypted KV blob.
  payload: unknown;
}

export interface PostbackLogOutcome {
  recorded: boolean; // false ⇒ duplicate (provider, external_txn_id) — replay no-op
  debug_ref: string | null;
  reason?: string;
}

// §29 provider-postback dedupe + §30.3 PII/secret redaction. The
// (provider, external_txn_id) UNIQUE (0038) makes a replay a NO-OP (no second
// row, so no double-booking downstream). The admin-visible payload_redacted_json
// has every PII scalar SHA-256 hashed (reused redactPii); the FULL payload is
// written ONLY as an AES-GCM debug_ref KV blob under LEADGEN_DEBUG_ENCRYPTION_KEY
// (the P10 pattern — absent key ⇒ debug_ref stays NULL, never raw PII in D1).
// The blob is minted ONLY for a newly-recorded row (no orphan blob on a replay),
// and is best-effort (a KV/crypto hiccup degrades debug_ref to NULL, never
// throws). An empty external_txn_id is undedupable and refused (0038 NOT NULL).
export async function recordPostbackLog(
  env: Env,
  input: PostbackLogInput,
  opts?: { now?: Date },
): Promise<PostbackLogOutcome> {
  void opts;
  if (input.provider === "" || input.external_txn_id === "") {
    return { recorded: false, debug_ref: null, reason: "no provider/external_txn_id (undedupable postback)" };
  }

  let payloadRedactedJson = "{}";
  try {
    payloadRedactedJson = JSON.stringify(redactPii(input.payload) ?? {});
  } catch {
    // redactPii never throws, but JSON.stringify on an exotic value might —
    // fall back to a fixed redaction marker rather than store raw / crash.
    payloadRedactedJson = JSON.stringify("[REDACTED]");
  }

  const insertRes = await env.DB.prepare(
    `INSERT OR IGNORE INTO leadgen_postback_log
       (provider, external_txn_id, click_id, offer_public_id, event_ts, payload_redacted_json, debug_ref)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  )
    .bind(
      input.provider,
      input.external_txn_id,
      input.click_id,
      input.offer_public_id,
      input.event_ts,
      payloadRedactedJson,
    )
    .run();

  const newlyRecorded =
    ((insertRes as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) === 1;
  if (!newlyRecorded) {
    return { recorded: false, debug_ref: null, reason: "duplicate postback (provider, external_txn_id)" };
  }

  // Mint the encrypted debug_ref only for the genuinely-recorded row. Absent the
  // encryption secret ⇒ NO blob, debug_ref stays NULL (§30.3). Best-effort.
  let debugRef: string | null = null;
  const encryptionSecret = readEnvSecret(env, DEBUG_ENCRYPTION_SECRET_NAME);
  if (encryptionSecret !== undefined) {
    try {
      const ref = `${DEBUG_REF_PREFIX}${randomHex(16)}`;
      const blob = JSON.stringify(input.payload ?? null);
      await env.CACHE.put(ref, await encryptDebugBlob(encryptionSecret, blob), {
        expirationTtl: DEBUG_BLOB_TTL_SECONDS,
      });
      await env.DB.prepare(
        "UPDATE leadgen_postback_log SET debug_ref = ? WHERE provider = ? AND external_txn_id = ?",
      )
        .bind(ref, input.provider, input.external_txn_id)
        .run();
      debugRef = ref;
    } catch {
      // KV / crypto hiccup: the redacted row already persisted; the forensic
      // blob is a best-effort aid — degrade debug_ref to NULL, never throw.
      debugRef = null;
    }
  }
  return { recorded: true, debug_ref: debugRef };
}
