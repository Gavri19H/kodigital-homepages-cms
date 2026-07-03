// Listicles §31.7 currency normalization — the daily FX table
// `listicle_fx_rates` (migration 0034: date, currency, usd_rate,
// PK(date,currency)).
//
// Convention (authored, documented): `usd_rate` is USD per ONE unit of the
// native currency, so `revenue_usd = revenue * usd_rate`. The base currency
// USD therefore has usd_rate = 1 and is treated as an IDENTITY even without a
// seeded row (a USD postback always normalizes, source or not).
//
// FX-SOURCE HONESTY: this repo has no live FX-rate provider secret wired. The
// daily refresh (refreshFxRates) seeds the USD identity row idempotently and is
// a structured no-op for every other currency — it returns a summary that
// names the missing source rather than inventing a rate. A non-USD postback
// whose (date,currency) has no seeded rate stores native revenue + a NULL
// revenue_usd (flagged for backfill once a rate lands), never a fabricated USD
// figure. The single extension point (`seededRates`) lets an operator inject a
// static/seed table or a future FX-API adapter with no other code change.

import type { Env } from "../env";

export const BASE_CURRENCY = "USD";

function normCurrency(currency: string | null | undefined): string {
  return (typeof currency === "string" ? currency : "").trim().toUpperCase();
}

// The USD-per-unit rate for (date, currency): exact (date,currency) row first,
// else the most recent rate for that currency ON OR BEFORE the date (late
// postbacks reuse the last known rate), else the USD identity, else null
// (unknown — the caller stores native + NULL usd and flags for backfill).
export async function lookupFxRate(
  db: D1Database,
  date: string,
  currency: string,
): Promise<number | null> {
  const cur = normCurrency(currency);
  if (cur === "" || cur === BASE_CURRENCY) return 1;
  const exact = await db
    .prepare("SELECT usd_rate FROM listicle_fx_rates WHERE date = ? AND currency = ? LIMIT 1")
    .bind(date, cur)
    .first<{ usd_rate: number }>();
  if (exact !== null && typeof exact.usd_rate === "number" && Number.isFinite(exact.usd_rate)) {
    return exact.usd_rate;
  }
  const prior = await db
    .prepare(
      "SELECT usd_rate FROM listicle_fx_rates WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1",
    )
    .bind(cur, date)
    .first<{ usd_rate: number }>();
  if (prior !== null && typeof prior.usd_rate === "number" && Number.isFinite(prior.usd_rate)) {
    return prior.usd_rate;
  }
  return null;
}

// revenue_usd for (date, currency, revenue). null ⇒ no known rate (backfill).
export async function computeRevenueUsd(
  db: D1Database,
  date: string,
  currency: string,
  revenue: number,
): Promise<number | null> {
  const rate = await lookupFxRate(db, date, currency);
  if (rate === null) return null;
  const usd = revenue * rate;
  return Number.isFinite(usd) ? usd : null;
}

export interface FxRefreshSummary {
  t: "lst_fx_refresh";
  date: string;
  seeded: number;       // rows upserted this run
  source: "identity_only" | "seeded_rates";
  note: string;
}

// §31.7 daily FX refresh. Idempotent (INSERT OR IGNORE on the (date,currency)
// PK so a re-run never clobbers a rate already recorded for the day). Seeds the
// USD identity always; applies any `seededRates` the caller injects (static
// seed / future FX-API adapter). Never throws — the cron wraps it too.
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
        "INSERT OR IGNORE INTO listicle_fx_rates (date, currency, usd_rate) VALUES (?, ?, ?)",
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
    t: "lst_fx_refresh",
    date,
    seeded,
    source: hasSeed ? "seeded_rates" : "identity_only",
    note: hasSeed
      ? "seeded USD identity + injected static/adapter rates"
      : "USD identity only — no live FX-rate source configured (non-USD revenue stores NULL revenue_usd until a rate is seeded)",
  };
}
