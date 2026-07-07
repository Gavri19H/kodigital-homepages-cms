// LeadGen auction FX normalization (contract 07 §18.4 + 09 §29 currency
// normalization). Bids are USD-normalized via `leadgen_fx_rates`
// (0038: date, currency, usd_rate, PK(date,currency)) BEFORE winner logic so
// a mixed-currency auction compares like-for-like.
//
// CONVENTION (reused VERBATIM from the listicles FX table, src/listicles/fx.ts):
// `usd_rate` is USD per ONE unit of the native currency, so
// `usd = amount * usd_rate`. The base currency USD therefore has usd_rate = 1
// and is treated as an IDENTITY even without a seeded row (a USD bid always
// normalizes, rate source or not). The lookup prefers the exact (date,currency)
// row, then the most recent rate for that currency ON OR BEFORE the date.
//
// MISSING-RATE FALLBACK (the auction-critical decision — 07 §18.4 / 09 §29):
// `normalizeToUsd` NEVER fabricates a USD figure and NEVER throws into the
// auction. A currency with no known rate returns a TYPED `status:"no_rate"`
// with `usd:null` (mirroring the listicles `computeRevenueUsd` honesty: no rate
// ⇒ null ⇒ backfill, never an invented number). The auction-facing
// `normalizeCarrierBidsToUsd` then maps each unconvertible bid onto a definite
// non-negative USD number under a DOCUMENTED, caller-selectable policy — the
// default `"zero"` collapses an unconvertible bid to 0, which 07 §18.4 already
// treats as `no_bid` (excluded from avg/sum), so a native-currency number can
// never wrongly out-bid a real USD bid. A caller that prefers the
// "assume native == USD" reading passes `onMissingRate:"passthrough"`. Every
// carrier carries its `fx_status` so Stage B records it in explainability.
//
// Pure/deterministic given the DB rows; parameterized SQL only; the rate is
// guarded (`typeof number` + `Number.isFinite`) before use.
//
// P13 EXTENSION (contract 08 §25 provider revenue + 09 §29 reconciliation):
// the revenue pipeline reuses the SAME leadgen_fx_rates table + the SAME
// lookupFxRate below, adding `computeRevenueUsd` (revenue × rate, null when
// unconvertible) and the §29 daily `refreshFxRates` seeder. All auction FX
// exports above are unchanged.

import type { Env } from "../env";

export const BASE_CURRENCY = "USD";

// Normalize a currency code the way both FX tables key on it: trimmed +
// uppercased. A blank/absent currency is treated as the USD identity.
function normCurrency(currency: string | null | undefined): string {
  return (typeof currency === "string" ? currency : "").trim().toUpperCase();
}

// Today (UTC yyyy-mm-dd) — the default rate date, matching the listicles
// refreshFxRates date discipline (the FX table PK is (date, currency)).
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export type FxNormalizationStatus =
  | "usd_identity" // currency is USD (or blank) → rate 1, no lookup
  | "rate_applied" // a known usd_rate was found and applied
  | "no_rate" // no rate for this (date,currency) → usd null (backfill/decide)
  | "invalid_amount"; // amount was non-finite/negative → usd null

// The typed FX result. `usd` is null exactly when the bid is unconvertible
// (`no_rate` / `invalid_amount`) — never a fabricated figure.
export interface FxNormalization {
  currency: string;
  amount: number;
  rate: number | null;
  usd: number | null;
  status: FxNormalizationStatus;
}

// The USD-per-unit rate for (date, currency): exact (date,currency) row first,
// else the most recent rate for that currency ON OR BEFORE the date (late/
// missing-day lookups reuse the last known rate), else null. Parameterized
// SQL; the rate column is guarded before it is trusted. Never throws — a DB
// error degrades to null (unknown rate), never into the auction.
export async function lookupFxRate(
  db: D1Database,
  date: string,
  currency: string,
): Promise<number | null> {
  const cur = normCurrency(currency);
  if (cur === "" || cur === BASE_CURRENCY) return 1;
  try {
    const exact = await db
      .prepare("SELECT usd_rate FROM leadgen_fx_rates WHERE date = ? AND currency = ? LIMIT 1")
      .bind(date, cur)
      .first<{ usd_rate: number }>();
    if (exact !== null && typeof exact.usd_rate === "number" && Number.isFinite(exact.usd_rate)) {
      return exact.usd_rate;
    }
    const prior = await db
      .prepare(
        "SELECT usd_rate FROM leadgen_fx_rates WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1",
      )
      .bind(cur, date)
      .first<{ usd_rate: number }>();
    if (prior !== null && typeof prior.usd_rate === "number" && Number.isFinite(prior.usd_rate)) {
      return prior.usd_rate;
    }
    return null;
  } catch {
    // A lookup failure is an UNKNOWN rate for the auction's purposes — the
    // caller decides (zero / passthrough). Never a throw into the pipeline.
    return null;
  }
}

// Normalize one native-currency amount to USD (07 §18.4). USD (or blank)
// currency → identity (rate 1). A known rate → amount × rate. No rate → typed
// `no_rate` with usd null (never fabricated). A non-finite/negative amount →
// `invalid_amount` with usd null. Deterministic; never throws.
export async function normalizeToUsd(
  db: D1Database,
  amount: number,
  currency: string | null | undefined,
  date?: string,
): Promise<FxNormalization> {
  const cur = normCurrency(currency) || BASE_CURRENCY;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return { currency: cur, amount: 0, rate: null, usd: null, status: "invalid_amount" };
  }
  if (cur === BASE_CURRENCY) {
    return { currency: BASE_CURRENCY, amount, rate: 1, usd: amount, status: "usd_identity" };
  }
  const rate = await lookupFxRate(db, date ?? todayUtc(), cur);
  if (rate === null) {
    return { currency: cur, amount, rate: null, usd: null, status: "no_rate" };
  }
  const usd = amount * rate;
  return {
    currency: cur,
    amount,
    rate,
    usd: Number.isFinite(usd) ? usd : null,
    status: Number.isFinite(usd) ? "rate_applied" : "no_rate",
  };
}

// A carrier's native bid to normalize (parse.ts has already collapsed any
// zero/invalid/missing bid to 0 per 07 §18.4).
export interface CarrierBidInput {
  carrier_key: string;
  offer_public_id: string;
  bid: number;
  bid_currency?: string | null;
}

// The carrier with a DEFINITE non-negative USD bid for auction-core, plus the
// typed FX provenance (fx_status / fx_rate) for explainability (§19.2 / §29
// dedicated fields — never encoded in answer_value_normalized).
export interface NormalizedCarrierBid extends CarrierBidInput {
  usd_bid: number;
  fx_status: FxNormalizationStatus;
  fx_rate: number | null;
}

export interface NormalizeBidsOptions {
  // The rate date (FX PK). Defaults to today (UTC). One auction run should pass
  // a single date so every bid normalizes against the same rate day.
  date?: string;
  // Policy for an unconvertible bid (no_rate / invalid_amount):
  //   "zero" (DEFAULT) → usd_bid 0 (07 §18.4 no_bid — excluded from avg/sum),
  //   "passthrough"    → usd_bid = the native amount (assume already-USD).
  onMissingRate?: "zero" | "passthrough";
}

// Normalize a whole carrier set's bids to USD (07 §18.4 "bids USD-normalized …
// BEFORE winner logic"). Deterministic, parameterized, never throws. Rates are
// cached per distinct (date,currency) within the batch so N carriers in one
// currency cost ONE query (keeps well under the D1 statement/binding limits).
export async function normalizeCarrierBidsToUsd(
  db: D1Database,
  carriers: readonly CarrierBidInput[],
  opts?: NormalizeBidsOptions,
): Promise<NormalizedCarrierBid[]> {
  const date = opts?.date ?? todayUtc();
  const onMissingRate = opts?.onMissingRate ?? "zero";
  // Cache the RATE (number | null) per distinct currency for this date. USD is
  // the identity; a currency present many times is looked up once.
  const rateCache = new Map<string, number | null>();

  const out: NormalizedCarrierBid[] = [];
  for (const carrier of carriers) {
    const cur = normCurrency(carrier.bid_currency) || BASE_CURRENCY;
    const bidValid =
      typeof carrier.bid === "number" && Number.isFinite(carrier.bid) && carrier.bid >= 0;

    let rate: number | null;
    if (cur === BASE_CURRENCY) {
      rate = 1;
    } else if (rateCache.has(cur)) {
      rate = rateCache.get(cur) ?? null;
    } else {
      rate = await lookupFxRate(db, date, cur);
      rateCache.set(cur, rate);
    }

    let fx_status: FxNormalizationStatus;
    let usd: number | null;
    if (!bidValid) {
      fx_status = "invalid_amount";
      usd = null;
    } else if (cur === BASE_CURRENCY) {
      fx_status = "usd_identity";
      usd = carrier.bid;
    } else if (rate === null) {
      fx_status = "no_rate";
      usd = null;
    } else {
      const product = carrier.bid * rate;
      usd = Number.isFinite(product) ? product : null;
      fx_status = usd === null ? "no_rate" : "rate_applied";
    }

    // Unconvertible → the documented policy. "zero" collapses to 0 (no_bid);
    // "passthrough" keeps the native bid (only meaningful when bidValid).
    const usd_bid =
      usd !== null
        ? usd
        : onMissingRate === "passthrough" && bidValid
          ? carrier.bid
          : 0;

    out.push({
      carrier_key: carrier.carrier_key,
      offer_public_id: carrier.offer_public_id,
      bid: carrier.bid,
      bid_currency: carrier.bid_currency ?? null,
      usd_bid,
      fx_status,
      fx_rate: cur === BASE_CURRENCY ? 1 : rate,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Revenue-side FX (08 §25 provider revenue + 09 §29 currency normalization)
// ---------------------------------------------------------------------------

// revenue_usd for (date, currency, revenue) via the SAME lookupFxRate above
// (exact-date → most-recent-on-or-before → null). null ⇒ NO known rate — the
// caller stores native revenue + NULL revenue_usd and flags it for backfill
// (§29), NEVER a fabricated USD figure. USD (or blank) is the identity (rate 1).
// Deterministic; never throws (lookupFxRate degrades a DB error to null).
export async function computeRevenueUsd(
  db: D1Database,
  date: string,
  currency: string,
  revenue: number,
): Promise<number | null> {
  if (typeof revenue !== "number" || !Number.isFinite(revenue)) return null;
  const rate = await lookupFxRate(db, date, currency);
  if (rate === null) return null;
  const usd = revenue * rate;
  return Number.isFinite(usd) ? usd : null;
}

// The typed summary refreshFxRates returns. The leadgen-namespaced `t` keeps it
// distinct from any listicles refresh in a shared log stream (§30.5 namespace).
export interface FxRefreshSummary {
  t: "lg_fx_refresh";
  date: string;
  seeded: number; // rows upserted this run
  source: "identity_only" | "seeded_rates";
  note: string;
}

// §29 daily FX refresh. Idempotent (INSERT OR IGNORE on the (date,currency) PK
// so a re-run never clobbers a rate already recorded for the day). Seeds the
// USD identity always; applies any `seededRates` the caller injects (a static
// seed table or a future FX-API adapter — the single extension point). NEVER
// throws (the cron wraps it too). FX-SOURCE HONESTY: this repo wires no live FX
// provider secret, so absent `seededRates` it seeds ONLY the USD identity and
// names the missing source — a non-USD postback with no seeded rate stores NULL
// revenue_usd until a rate lands, never an invented number.
export async function refreshFxRates(
  env: Env,
  opts?: { now?: Date; seededRates?: Readonly<Record<string, number>> },
): Promise<FxRefreshSummary> {
  const now = opts?.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const rates: Record<string, number> = { [BASE_CURRENCY]: 1, ...(opts?.seededRates ?? {}) };
  let seeded = 0;
  for (const [currencyRaw, rate] of Object.entries(rates)) {
    const currency = normCurrency(currencyRaw);
    if (currency === "" || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) continue;
    try {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO leadgen_fx_rates (date, currency, usd_rate) VALUES (?, ?, ?)",
      )
        .bind(date, currency, rate)
        .run();
      seeded += 1;
    } catch {
      // FX seeding is best-effort; a write hiccup never breaks the cron.
    }
  }
  const hasSeed = opts?.seededRates !== undefined && Object.keys(opts.seededRates).length > 0;
  return {
    t: "lg_fx_refresh",
    date,
    seeded,
    source: hasSeed ? "seeded_rates" : "identity_only",
    note: hasSeed
      ? "seeded USD identity + injected static/adapter rates"
      : "USD identity only — no live FX-rate source configured (non-USD revenue stores NULL revenue_usd until a rate is seeded)",
  };
}
