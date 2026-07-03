// Listicles §19 / §9.3 / §31.7 / §31.8 — shared revenue-side D1 writers used by
// BOTH the inbound provider postback (public/listicle/postback.ts) and the
// browser `conversion` beacon (analytics/listicle-track.ts):
//   * insertRevenueRaw       — the §19 staging row (source ∈ CHECK set),
//                              business-critical → AWAITED (never fire-and-forget).
//   * queueRevenueUnmatched  — §31.7 pending queue when a postback's click_id has
//                              no matching offer_click yet (re-matched for 72h).
//   * bumpCapConversions     — §9.3 conversion-cap counter (+1), CLEAN traffic
//                              only (§31.8), keyed on the offer's cap_timezone date.
//   * recordInSitePayout     — §9.3/§19 in-site payout: a conversion on an
//                              `in_site` offer stages payout_value/currency as
//                              source='in_site' (no external postback) + cap bump.
//
// D1 discipline (.claude/rules/d1-database-safety): every write is .bind()
// parameterized; the cap counter is a single atomic INSERT … ON CONFLICT DO
// UPDATE (no read-modify-write race); business-critical writes are awaited.

import { dateInTimezone } from "../analytics/listicle-quality";

// The revenue_raw.source CHECK set (migration 0034). Exported so callers pass a
// compile-checked literal, never a free string.
export type RevenueSource = "s2s_postback" | "api" | "script" | "in_site";

export interface OfferRevenueRow {
  id: number;
  public_id: string;
  payout_method: string;             // 'in_site' | 'offsite'
  payout_value: number | null;
  payout_currency: string | null;
  cap_enabled: number;
  cap_amount: number | null;
  cap_timezone: string | null;
  cap_count_by: string | null;       // 'clicks' | 'conversions' | null
  status: string;                    // 'active' | 'paused' | 'archived'
}

// Offer payout + cap columns by public_id (the {offer_id} macro / analytics
// key). No status filter — a conversion attributes to the offer it names even
// if the operator later paused it; the caller inspects `status` if it cares.
export async function getOfferByPublicId(
  db: D1Database,
  publicId: string,
): Promise<OfferRevenueRow | null> {
  if (publicId === "") return null;
  const row = await db
    .prepare(
      `SELECT id, public_id, payout_method, payout_value, payout_currency,
              cap_enabled, cap_amount, cap_timezone, cap_count_by, status
       FROM listicle_offers WHERE public_id = ? LIMIT 1`,
    )
    .bind(publicId)
    .first<OfferRevenueRow>();
  return row ?? null;
}

export interface RevenueRawInput {
  dt: string;                 // 'YYYY-MM-DD' UTC (§31.7)
  click_id: string;           // NOT NULL in 0034
  offer_public_id: string | null;
  source: RevenueSource;
  conversions: number;
  revenue: number;
  currency: string;
}

// §19 staging insert. Business-critical → the caller AWAITS it. Idempotency for
// the postback path is enforced UPSTREAM by the listicle_postback_log UNIQUE
// (provider, external_txn_id) gate, so a replayed postback never reaches here.
export async function insertRevenueRaw(db: D1Database, input: RevenueRawInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO listicle_revenue_raw
         (dt, click_id, offer_public_id, source, conversions, revenue, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.dt,
      input.click_id,
      input.offer_public_id,
      input.source,
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
  revenue_usd: number | null; // §31.7 normalized; NULL when no FX rate is known
}

// §31.7 pending queue. Recorded when a postback's click_id has no matching
// offer_click at ingest time; the sweep re-matches for 72h, then marks it
// unattributed. Business-critical → awaited.
export async function queueRevenueUnmatched(db: D1Database, input: RevenueUnmatchedInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO listicle_revenue_unmatched
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

// §9.3 conversion cap counter (+1), atomic upsert keyed (offer_id, cap_date in
// the offer's cap_timezone). Mirror of the /lc resolver's bumpCapClicks but for
// conversion_count. Caller gates on CLEAN traffic (§31.8) + cap_count_by.
export async function bumpCapConversions(
  db: D1Database,
  offer: Pick<OfferRevenueRow, "id" | "cap_timezone">,
  now: Date,
): Promise<void> {
  const tz = offer.cap_timezone ?? "";
  const capDate = dateInTimezone(tz, now);
  await db
    .prepare(
      `INSERT INTO listicle_offer_cap_counters (offer_id, cap_date, timezone, click_count, conversion_count, updated_at)
       VALUES (?, ?, ?, 0, 1, unixepoch())
       ON CONFLICT(offer_id, cap_date)
       DO UPDATE SET conversion_count = conversion_count + 1, updated_at = unixepoch()`,
    )
    .bind(offer.id, capDate, tz === "" ? "UTC" : tz)
    .run();
}

// True when this offer is conversion-capped (cap_enabled + cap_count_by).
export function isConversionCapped(offer: Pick<OfferRevenueRow, "cap_enabled" | "cap_count_by">): boolean {
  return offer.cap_enabled === 1 && offer.cap_count_by === "conversions";
}

export interface InSitePayoutOutcome {
  recorded: boolean;
  reason?: string;
  revenue?: number;
  currency?: string;
  capIncremented?: boolean;
  deduped?: boolean; // true ⇒ a replay of an already-booked conversion (no-op)
}

// §9.3/§19/§31.7 in-site payout on a conversion event, with DURABLE replay
// idempotency (migration 0035 `listicle_conversion_log`). When the offer's
// payout_method is 'in_site', stage the offer's payout_value/payout_currency as
// a source='in_site' revenue_raw row (direct — no external postback) and, for a
// conversion-capped in-site offer on CLEAN traffic, bump conversion_count —
// but EXACTLY ONCE per (click_id, dedupeKey).
//
// `dedupeKey` is the caller-derived stable booking key (client event_id, else a
// deterministic click_id|page_view_id|offer_public_id — see
// deriveConversionBookingKey in listicle-track.ts). An empty key means the
// conversion has no stable identity: it is NEVER booked (§FIX-1c) — money is
// never written on an ephemeral/server-minted key.
//
// Atomicity: the revenue insert is gated on the conversion_log row NOT yet
// existing, and the log insert records the booking — BOTH in ONE db.batch
// (transactional). The revenue INSERT…SELECT runs FIRST so its NOT-EXISTS sees
// the PRE-batch log state; the log INSERT OR IGNORE runs SECOND. D1 serializes
// writes and UNIQUE(click_id, dedupe_key) is the authoritative guard, so a
// replay inserts 0 revenue rows. The cap bump fires only when revenue was newly
// booked. `clean` = the conversion event's §31.8 traffic_quality_flag==='clean'.
export async function recordInSitePayout(
  db: D1Database,
  offer: OfferRevenueRow,
  clickId: string,
  dedupeKey: string,
  dtUtc: string,
  clean: boolean,
  now: Date,
): Promise<InSitePayoutOutcome> {
  if (offer.payout_method !== "in_site") {
    return { recorded: false, reason: "offer is not in_site" };
  }
  if (clickId === "") {
    // revenue_raw.click_id is NOT NULL — an in-site conversion with no click_id
    // cannot be attributed; skip (never a fabricated/empty click_id).
    return { recorded: false, reason: "no click_id on in-site conversion" };
  }
  if (dedupeKey === "") {
    // §FIX-1c: no stable booking key → never book (caller still emits analytics).
    return { recorded: false, reason: "no booking key (underivable dedupe identity)" };
  }
  const value = typeof offer.payout_value === "number" && Number.isFinite(offer.payout_value) ? offer.payout_value : 0;
  const currency = (offer.payout_currency ?? "").trim() || "USD";

  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO listicle_revenue_raw (dt, click_id, offer_public_id, source, conversions, revenue, currency)
         SELECT ?, ?, ?, 'in_site', 1, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM listicle_conversion_log WHERE click_id = ? AND dedupe_key = ?)`,
      )
      .bind(dtUtc, clickId, offer.public_id, value, currency, clickId, dedupeKey),
    db
      .prepare(
        `INSERT OR IGNORE INTO listicle_conversion_log (click_id, dedupe_key, offer_public_id, source, revenue, currency)
         VALUES (?, ?, ?, 'in_site', ?, ?)`,
      )
      .bind(clickId, dedupeKey, offer.public_id, value, currency),
  ]);

  const revenueInserted = ((results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) === 1;
  if (!revenueInserted) {
    // Already booked (replay) — the batch inserted 0 revenue rows. No cap bump.
    return { recorded: false, reason: "duplicate conversion (already booked)", deduped: true, revenue: value, currency };
  }

  let capIncremented = false;
  if (clean && isConversionCapped(offer)) {
    await bumpCapConversions(db, offer, now);
    capIncremented = true;
  }
  return { recorded: true, revenue: value, currency, capIncremented, deduped: false };
}
