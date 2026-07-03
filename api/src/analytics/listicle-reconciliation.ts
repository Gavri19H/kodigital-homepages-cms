// §31.6 daily reconciliation — SKELETON (honest scope, Phase 7).
//
// Target report: beacon-accepted (204) count vs Athena-landed count vs
// CH-ingested count per site/day, variance-alerted. What is MEASURABLE
// TODAY (pre-Phase-8 — no Athena/ClickHouse read path exists in this worker
// yet):
//   * accepted counts    — a KV daily counter this module owns, incremented
//     at 204-time by /api/lst/track and by the /lc resolver for its
//     server-emitted offer_click (so "accepted" covers BOTH ingest paths).
//   * dead-letter counts — D1 `listicle_event_dead_letter` rows for the day.
//   * athena_landed / ch_ingested — NULL + reason (never a fake zero). The
//     Phase-8 mirror-sync lands the read path; the counters accumulate NOW
//     so day-one of Phase 8 has history to reconcile against.
//
// KV-counter honesty (documented): KV has no atomic increment — the
// read-modify-write below can lose concurrent updates and same-key writes
// are rate-limited (~1/s). The counter is therefore APPROXIMATE under
// concurrency; it exists to surface ORDER-OF-MAGNITUDE variance (the §31.6
// alert), not penny-accurate counts. Phase 8 can move it to a D1 row or a
// Durable Object if tighter bounds are needed.
//
// Cron contract: index.ts calls listicleDailyReconciliation(env) every
// minute inside its own try/catch; the function self-gates to 00:05 UTC
// (one firing per day) and reports on YESTERDAY (UTC). Fail-open: any
// internal error logs and returns null — the cron never breaks.

import type { Env } from "../env";

const COUNTER_PREFIX = "lst_rcpt:";
const COUNTER_TTL_SECONDS = 7 * 24 * 3600; // 7 days of accumulation

function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function listicleAcceptCounterKey(date: string, siteId: string): string {
  return `${COUNTER_PREFIX}${date}:${siteId === "" ? "unknown" : siteId}`;
}

// Best-effort daily accept counter (see the honesty note above). Never throws.
export async function bumpListicleDailyAcceptCounter(
  env: Env,
  siteId: string,
  count: number,
  at: Date,
): Promise<void> {
  if (count <= 0) return;
  try {
    const key = listicleAcceptCounterKey(utcDate(at), siteId);
    const current = await env.CACHE.get(key);
    const parsed = current === null ? 0 : parseInt(current, 10);
    const next = (Number.isFinite(parsed) ? parsed : 0) + count;
    await env.CACHE.put(key, String(next), { expirationTtl: COUNTER_TTL_SECONDS });
  } catch {
    // counting must never break ingest
  }
}

export interface ListicleReconciliationReport {
  t: "lst_reconciliation";
  date: string;
  accepted_by_site: Record<string, number>;
  accepted_total: number;
  dead_letter_rows: number;
  athena_landed: null;
  ch_ingested: null;
  null_reasons: { athena_landed: string; ch_ingested: string };
  variance: "UNMEASURABLE_PRE_PHASE8";
}

// The report body for one UTC date. Exported for tests + the Phase-8 cron.
export async function buildListicleReconciliationReport(
  env: Env,
  date: string,
): Promise<ListicleReconciliationReport> {
  const acceptedBySite: Record<string, number> = {};
  let acceptedTotal = 0;
  const prefix = `${COUNTER_PREFIX}${date}:`;
  const listing = await env.CACHE.list({ prefix });
  for (const key of listing.keys) {
    const value = await env.CACHE.get(key.name);
    const parsed = value === null ? 0 : parseInt(value, 10);
    const count = Number.isFinite(parsed) ? parsed : 0;
    acceptedBySite[key.name.slice(prefix.length)] = count;
    acceptedTotal += count;
  }

  // Day bounds in epoch SECONDS (listicle_event_dead_letter.received_at is
  // unixepoch()).
  const dayStart = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
  const dayEnd = dayStart + 24 * 3600;
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM listicle_event_dead_letter WHERE received_at >= ? AND received_at < ?",
  )
    .bind(dayStart, dayEnd)
    .first<{ n: number }>();

  return {
    t: "lst_reconciliation",
    date,
    accepted_by_site: acceptedBySite,
    accepted_total: acceptedTotal,
    dead_letter_rows: row?.n ?? 0,
    athena_landed: null,
    ch_ingested: null,
    null_reasons: {
      athena_landed: "no Athena read path in the worker until Phase 8 (mirror sync)",
      ch_ingested: "ClickHouse ingest lands in Phase 8",
    },
    variance: "UNMEASURABLE_PRE_PHASE8",
  };
}

// Cron entry (index.ts, every minute). Gates itself to 00:05 UTC so the
// report fires exactly once per day; `opts` exists for tests/backfills.
export async function listicleDailyReconciliation(
  env: Env,
  opts?: { now?: Date; force?: boolean },
): Promise<ListicleReconciliationReport | null> {
  try {
    const now = opts?.now ?? new Date();
    const force = opts?.force === true;
    if (!force && !(now.getUTCHours() === 0 && now.getUTCMinutes() === 5)) return null;
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    const report = await buildListicleReconciliationReport(env, utcDate(yesterday));
    console.log(JSON.stringify(report));
    return report;
  } catch (err) {
    // fail-open: reconciliation must never break the cron.
    const message = err instanceof Error ? err.message : "unknown";
    console.error(`[lst-reconciliation] failed: ${message.substring(0, 300)}`);
    return null;
  }
}
