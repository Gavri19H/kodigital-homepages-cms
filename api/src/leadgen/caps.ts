// Synchronous Offer cap counters (contract 04 §10.6) over
// `leadgen_offer_cap_counters` — the exact 0036 DDL shape:
//   PK (offer_id, cap_date), timezone TEXT, click_count, conversion_count.
//
// Caps are enforced SYNCHRONOUSLY before an Offer joins the auction /
// before a static redirect (§10.6). The counter row is per Offer per
// CALENDAR DAY in the Offer's cap_timezone (`cap_date`, YYYY-MM-DD) —
// mirrors the listicles cap-counter pattern (01 §3 reuse table: "same
// shape"). `cap_count_by` (clicks|conversions, DDL CHECK) picks WHICH of
// the two counters both gates and increments.
//
// All clocks are injectable (`now: Date`) for deterministic tests; all SQL
// is .bind() parameterized; the increment is a single atomic UPSERT (no
// read-modify-write race).

import type { LeadgenCapCountBy, LeadgenOfferRow } from "../admin/leadgen/db-types";

// The Offer columns the cap machinery needs (a projection of the §7.1 Row).
export type LeadgenCapOffer = Pick<
  LeadgenOfferRow,
  | "id"
  | "cap_enabled"
  | "cap_amount"
  | "cap_timezone"
  | "cap_count_by"
  | "cap_fallback_offer_id"
  | "cap_fallback_url"
>;

// One day's counter state for an Offer (zeros when no row exists yet).
export interface LeadgenCapStatus {
  cap_date: string;
  timezone: string;
  click_count: number;
  conversion_count: number;
}

// ---------------------------------------------------------------------------
// Period-key derivation
// ---------------------------------------------------------------------------

// The cap period key: the calendar date (YYYY-MM-DD) of `at` in the Offer's
// cap_timezone. en-CA formats as YYYY-MM-DD directly; an invalid/absent
// timezone falls back to UTC (same fallback the listicles counter uses —
// caps must keep counting even if a bad tz string ever reaches a row).
export function capPeriodKey(timezone: string | null | undefined, at: Date): string {
  const tz = typeof timezone === "string" && timezone.trim() !== "" ? timezone.trim() : "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

// The effective count_by: the DDL allows NULL (cap disabled); a live cap
// without an explicit choice gates on clicks (the §10.6 primary flow).
function effectiveCountBy(offer: LeadgenCapOffer): LeadgenCapCountBy {
  return offer.cap_count_by === "conversions" ? "conversions" : "clicks";
}

// ---------------------------------------------------------------------------
// D1 read + atomic increment
// ---------------------------------------------------------------------------

// Read the Offer's counter row for the CURRENT period. Always returns a
// status (zeros when no row exists) so capExceeded stays a pure function of
// (status, offer) — the §10.6 gate is `readCapStatus` → `capExceeded`.
export async function readCapStatus(
  db: D1Database,
  offer: LeadgenCapOffer,
  now: Date = new Date(),
): Promise<LeadgenCapStatus> {
  const capDate = capPeriodKey(offer.cap_timezone, now);
  const tz = offer.cap_timezone ?? "UTC";
  const row = await db
    .prepare(
      "SELECT cap_date, timezone, click_count, conversion_count FROM leadgen_offer_cap_counters WHERE offer_id = ? AND cap_date = ?",
    )
    .bind(offer.id, capDate)
    .first<{ cap_date: string; timezone: string; click_count: number; conversion_count: number }>();
  if (row === null || row === undefined) {
    return { cap_date: capDate, timezone: tz, click_count: 0, conversion_count: 0 };
  }
  return {
    cap_date: row.cap_date,
    timezone: row.timezone,
    click_count: row.click_count,
    conversion_count: row.conversion_count,
  };
}

// Atomically bump the Offer's counter for the current period — a single
// INSERT ... ON CONFLICT(offer_id, cap_date) DO UPDATE statement (the
// listicles §9.3 baseline; no read-modify-write race). Which column bumps
// follows the Offer's cap_count_by: a clicks-capped Offer counts clicks, a
// conversions-capped Offer counts conversions.
export async function incrementCap(
  db: D1Database,
  offer: LeadgenCapOffer,
  now: Date = new Date(),
): Promise<void> {
  const capDate = capPeriodKey(offer.cap_timezone, now);
  const tz =
    typeof offer.cap_timezone === "string" && offer.cap_timezone.trim() !== ""
      ? offer.cap_timezone.trim()
      : "UTC";
  const column = effectiveCountBy(offer) === "conversions" ? "conversion_count" : "click_count";
  // `column` is derived from the CHECK-constrained enum above — never from
  // request input — so interpolating the COLUMN NAME is safe; all VALUES
  // stay .bind() parameterized.
  await db
    .prepare(
      `INSERT INTO leadgen_offer_cap_counters (offer_id, cap_date, timezone, click_count, conversion_count, updated_at)
       VALUES (?, ?, ?, ${column === "click_count" ? 1 : 0}, ${column === "conversion_count" ? 1 : 0}, unixepoch())
       ON CONFLICT(offer_id, cap_date)
       DO UPDATE SET ${column} = ${column} + 1, updated_at = unixepoch()`,
    )
    .bind(offer.id, capDate, tz)
    .run();
}

// ---------------------------------------------------------------------------
// Pure cap checks + fallback resolution
// ---------------------------------------------------------------------------

// True when the Offer's cap is reached for the period `status` describes:
// cap_enabled + a positive cap_amount + the count_by-selected counter at or
// past the cap. Disabled caps / missing amounts never gate.
export function capExceeded(status: LeadgenCapStatus, offer: LeadgenCapOffer): boolean {
  if (offer.cap_enabled !== 1) return false;
  const capAmount = offer.cap_amount;
  if (typeof capAmount !== "number" || capAmount <= 0) return false;
  const count =
    effectiveCountBy(offer) === "conversions" ? status.conversion_count : status.click_count;
  return count >= capAmount;
}

// §10.6 on-cap resolution order: cap_fallback_offer_id → cap_fallback_url →
// drop. Typed so the auction/static-redirect layers switch on `kind`
// (fallback-offer existence/liveness is the caller's DB check).
export type LeadgenCapFallback =
  | { kind: "fallback_offer"; offer_id: number }
  | { kind: "fallback_url"; url: string }
  | { kind: "drop" };

export function resolveCapFallback(offer: LeadgenCapOffer): LeadgenCapFallback {
  if (typeof offer.cap_fallback_offer_id === "number" && offer.cap_fallback_offer_id > 0) {
    return { kind: "fallback_offer", offer_id: offer.cap_fallback_offer_id };
  }
  if (typeof offer.cap_fallback_url === "string" && offer.cap_fallback_url.trim() !== "") {
    return { kind: "fallback_url", url: offer.cap_fallback_url.trim() };
  }
  return { kind: "drop" };
}
