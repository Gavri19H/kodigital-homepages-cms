// Listicles §19 (script/API channel) + §31.7 (provider revenue reconciliation
// & backfill) — the scheduled revenue maintenance run, wired into index.ts
// scheduled() in its OWN isolated try/catch alongside the existing syncs.
//
// runListicleRevenueCron(env) does, each in its own try/catch (one failure
// never sinks the others; the whole thing is fail-open — a cron must never
// break):
//   EVERY MINUTE
//     * shipRevenueRawToCh   — §19 D1→CH shipper: NEW listicle_revenue_raw rows
//       (synced_to_ch_at IS NULL) → CH lst_revenue_raw, mapping
//       offer_public_id → offer_id (DEV-6), then stamp synced_to_ch_at.
//     * reMatchUnmatchedSweep — §31.7: pending unmatched rows < 72h re-matched
//       against CH offer_click (clean); matched → status='matched'; rows past
//       72h → status='unattributed'.
//   DAILY (self-gated 00:07 UTC — off the reconciliation's 00:05)
//     * refreshFxRates            — §31.7 FX table (fx.ts; USD identity + honest
//       no-op without a source).
//     * triggerAttributionBackfill — §31.7 late-revenue backfill: SYSTEM REFRESH
//       the CH attribution MV (it also auto-refreshes every 2 min).
//     * dailyProviderReconciliation — §31.7 provider-total vs ingested-total
//       variance flag (honest about what's measurable without a provider report).
//     * ingestProviderReports     — §19 script/API channel framework (no-op stub
//       until a provider API/report source is configured).
//
// What the click_id re-match runs AGAINST (documented): CH lst_events_raw
// offer_click rows (traffic_quality_flag='clean'), populated by the external
// Athena→CH pipeline (DEV-14) — there is NO D1 click log in this repo. HONEST
// RESIDUAL: absent CH config, re-match is a no-op and pending rows age out to
// 'unattributed' at 72h; the durable revenue_raw row is unaffected and the CH
// attribution MV re-attributes automatically once the click lands.

import type { Env } from "../env";
import {
  createListicleChClient,
  type ListicleChClient,
  type CreateChClientOptions,
} from "./clickhouse";
import { refreshFxRates, type FxRefreshSummary } from "./fx";

const UNMATCHED_WINDOW_MS = 72 * 3600 * 1000; // §31.7 72h re-match window
const SHIP_BATCH = 200;                        // revenue_raw rows shipped per run
const REMATCH_BATCH = 200;                     // pending rows re-matched per run
const CH_IN_CHUNK = 100;                       // click_ids per CH IN() query
const D1_BIND_CHUNK = 80;                      // §hard-rules: ≤80 binds / stmt
export const ATTRIBUTION_MV = "lst_revenue_attributed_mv";

export interface RevenueCronOptions extends CreateChClientOptions {
  client?: ListicleChClient;
  now?: Date;
  force?: boolean; // run the daily-gated tasks regardless of the clock (tests)
  seededRates?: Readonly<Record<string, number>>;
}

// --- §19 D1 → CH revenue shipper --------------------------------------------

export interface ShipResult {
  configured: boolean;
  shipped: number;
  reason?: string;
}

interface RevenueRawRow {
  id: number;
  dt: string;
  click_id: string;
  offer_public_id: string | null;
  source: string;
  conversions: number;
  revenue: number;
  currency: string;
}

export async function shipRevenueRawToCh(env: Env, opts?: RevenueCronOptions): Promise<ShipResult> {
  const client = opts?.client ?? createListicleChClient(env, opts);
  if (!client.configured || typeof client.insert !== "function") {
    return { configured: false, shipped: 0, reason: "CH credentials absent or write path unavailable" };
  }
  const res = await env.DB.prepare(
    `SELECT id, dt, click_id, offer_public_id, source, conversions, revenue, currency
     FROM listicle_revenue_raw WHERE synced_to_ch_at IS NULL
     ORDER BY id ASC LIMIT ?`,
  )
    .bind(SHIP_BATCH)
    .all<RevenueRawRow>();
  const rows = res.results ?? [];
  if (rows.length === 0) return { configured: true, shipped: 0 };

  // DEV-6: the D1 staging column is offer_public_id; CH lst_revenue_raw keeps
  // offer_id — map explicitly here.
  const chRows = rows.map((r) => ({
    dt: r.dt,
    click_id: r.click_id,
    offer_id: r.offer_public_id ?? "",
    source: r.source,
    conversions: r.conversions,
    revenue: r.revenue,
    currency: r.currency,
  }));
  await client.insert("lst_revenue_raw", chRows);

  // Stamp synced_to_ch_at on exactly the rows we shipped (≤80 ids / statement).
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += D1_BIND_CHUNK) {
    const chunk = ids.slice(i, i + D1_BIND_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE listicle_revenue_raw SET synced_to_ch_at = unixepoch() WHERE id IN (${placeholders})`,
    )
      .bind(...chunk)
      .run();
  }
  return { configured: true, shipped: rows.length };
}

// --- §31.7 unmatched re-match sweep -----------------------------------------

export interface SweepResult {
  configured: boolean;
  matched: number;
  aged_out: number;
  scanned: number;
  reason?: string;
}

// Which of these click_ids have a CLEAN offer_click in CH? Returns the matched
// subset. Chunked IN() queries; empty when unconfigured.
async function matchedClickIdsInCh(
  client: ListicleChClient,
  clickIds: string[],
): Promise<Set<string>> {
  const matched = new Set<string>();
  for (let i = 0; i < clickIds.length; i += CH_IN_CHUNK) {
    const chunk = clickIds.slice(i, i + CH_IN_CHUNK);
    const params: Record<string, string | number> = {};
    const names: string[] = [];
    chunk.forEach((cid, idx) => {
      const key = `c${idx}`;
      params[key] = cid;
      names.push(`{${key}}`);
    });
    const { rows } = await client.query<{ click_id: string }>(
      `SELECT DISTINCT click_id FROM lst_events_raw ` +
        `WHERE event_type = 'offer_click' AND traffic_quality_flag = 'clean' ` +
        `AND click_id IN (${names.join(", ")})`,
      params,
    );
    for (const r of rows) if ((r.click_id ?? "") !== "") matched.add(String(r.click_id));
  }
  return matched;
}

export async function reMatchUnmatchedSweep(env: Env, opts?: RevenueCronOptions): Promise<SweepResult> {
  const now = opts?.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const windowStart = nowSec - Math.floor(UNMATCHED_WINDOW_MS / 1000);

  // Age-out FIRST: pending rows older than 72h → unattributed (cheap, always
  // runs, CH-independent — the §31.7 "after the window → unattributed").
  let agedOut = 0;
  try {
    const r = await env.DB.prepare(
      "UPDATE listicle_revenue_unmatched SET status = 'unattributed' WHERE status = 'pending' AND received_at < ?",
    )
      .bind(windowStart)
      .run();
    agedOut = (r.meta as { changes?: number } | undefined)?.changes ?? 0;
  } catch {
    /* best-effort */
  }

  const client = opts?.client ?? createListicleChClient(env, opts);
  if (!client.configured) {
    return { configured: false, matched: 0, aged_out: agedOut, scanned: 0, reason: "CH credentials absent" };
  }

  // Re-match the in-window pending rows against CH clean offer_clicks.
  const res = await env.DB.prepare(
    `SELECT id, click_id FROM listicle_revenue_unmatched
     WHERE status = 'pending' AND received_at >= ?
     ORDER BY received_at ASC LIMIT ?`,
  )
    .bind(windowStart, REMATCH_BATCH)
    .all<{ id: number; click_id: string }>();
  const pending = res.results ?? [];
  if (pending.length === 0) return { configured: true, matched: 0, aged_out: agedOut, scanned: 0 };

  const clickIds = Array.from(new Set(pending.map((p) => p.click_id).filter((c) => c !== "")));
  const matchedSet = await matchedClickIdsInCh(client, clickIds);

  // Promote matched rows to status='matched'. NOTE (no-double-count): the
  // revenue_raw row was already staged at postback ingest; the CH attribution
  // MV performs the actual (re)attribution once the click lands — this sweep
  // only advances the unmatched row's STATUS (never re-inserts revenue_raw).
  const matchedIds = pending.filter((p) => matchedSet.has(p.click_id)).map((p) => p.id);
  let matched = 0;
  for (let i = 0; i < matchedIds.length; i += D1_BIND_CHUNK) {
    const chunk = matchedIds.slice(i, i + D1_BIND_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const r = await env.DB.prepare(
      `UPDATE listicle_revenue_unmatched SET status = 'matched' WHERE id IN (${placeholders})`,
    )
      .bind(...chunk)
      .run();
    matched += (r.meta as { changes?: number } | undefined)?.changes ?? chunk.length;
  }
  return { configured: true, matched, aged_out: agedOut, scanned: pending.length };
}

// --- §31.7 late-revenue backfill (CH attribution MV re-materialization) -----

export interface BackfillResult {
  configured: boolean;
  refreshed: boolean;
  note: string;
}

export async function triggerAttributionBackfill(env: Env, opts?: RevenueCronOptions): Promise<BackfillResult> {
  const client = opts?.client ?? createListicleChClient(env, opts);
  if (!client.configured || typeof client.command !== "function") {
    return {
      configured: false,
      refreshed: false,
      note: "CH unconfigured — the attribution MV auto-refreshes every 2 min once CH is live",
    };
  }
  // The MV is a REFRESH … EVERY 2 MINUTE view over the FULL lst_revenue_raw, so
  // late postbacks re-attach automatically on the next cycle; this explicit
  // refresh forces immediate re-materialization (the §31.7 trailing-7d window is
  // inherently covered because the MV re-reads all of revenue_raw each cycle).
  try {
    await client.command(`SYSTEM REFRESH VIEW ${ATTRIBUTION_MV}`);
    return { configured: true, refreshed: true, note: "explicit SYSTEM REFRESH VIEW issued" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { configured: true, refreshed: false, note: `refresh failed (auto-refresh still active): ${msg.slice(0, 160)}` };
  }
}

// --- §31.7 daily provider-total reconciliation ------------------------------

export interface ProviderReconRecord {
  provider: string;
  date: string;
  ingested_postback_count: number;
  provider_report_total: number | null; // no provider-report source wired → null
  variance: number | null;
  variance_flag: string;
}

export interface ProviderReconReport {
  t: "lst_provider_reconciliation";
  date: string;
  ingested_s2s_revenue: number;       // per-day SUM(revenue) of s2s_postback rows
  providers: ProviderReconRecord[];
  null_reasons: { provider_report_total: string };
}

// Reconcile per provider for one UTC date. What IS measurable: the postback
// COUNT per provider (listicle_postback_log) + the day's total s2s revenue
// (listicle_revenue_raw). What is NOT (honest): the provider's OWN reported
// total — no provider-report source is wired (and revenue_raw carries no
// provider column, DEV-6), so provider_report_total is NULL + reason and the
// variance is flagged unmeasurable rather than faked.
export async function dailyProviderReconciliation(
  env: Env,
  date: string,
): Promise<ProviderReconReport> {
  const dayStart = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
  const dayEnd = dayStart + 24 * 3600;

  const provRows = await env.DB.prepare(
    `SELECT provider, COUNT(*) AS n FROM listicle_postback_log
     WHERE received_at >= ? AND received_at < ? GROUP BY provider ORDER BY provider ASC`,
  )
    .bind(dayStart, dayEnd)
    .all<{ provider: string; n: number }>();

  const revRow = await env.DB.prepare(
    "SELECT COALESCE(SUM(revenue), 0) AS total FROM listicle_revenue_raw WHERE source = 's2s_postback' AND dt = ?",
  )
    .bind(date)
    .first<{ total: number }>();

  const providers: ProviderReconRecord[] = (provRows.results ?? []).map((r) => ({
    provider: r.provider,
    date,
    ingested_postback_count: r.n,
    provider_report_total: null,
    variance: null,
    variance_flag: "NO_PROVIDER_REPORT_SOURCE",
  }));

  return {
    t: "lst_provider_reconciliation",
    date,
    ingested_s2s_revenue: revRow?.total ?? 0,
    providers,
    null_reasons: {
      provider_report_total:
        "no provider-report source configured (and revenue_raw carries no provider column, DEV-6); " +
        "wire a provider report/API adapter (ingestProviderReports) to compute per-provider variance",
    },
  };
}

// --- §19 script / API channel (framework + stub) ----------------------------

export interface ProviderReportAdapter {
  name: string;
  /** True only when THIS adapter's provider API/report source secret is set. */
  configured(env: Env): boolean;
  /** Pull + normalize provider rows to revenue_raw shape (unused until configured). */
  fetchRows(env: Env, date: string): Promise<Array<{ click_id: string; external_txn_id: string; revenue: number; currency: string; offer_public_id: string | null }>>;
}

// A documented stub: the shape a real report/API adapter takes. It reports
// configured=false always (no provider API secret is wired in this repo), so
// ingestProviderReports is an honest structured no-op — the framework awaits a
// configured provider, it does not pretend to have one.
export const stubReportAdapter: ProviderReportAdapter = {
  name: "stub",
  configured() {
    return false;
  },
  async fetchRows() {
    return [];
  },
};

export const PROVIDER_REPORT_ADAPTERS: readonly ProviderReportAdapter[] = [stubReportAdapter];

export interface IngestReportsResult {
  t: "lst_provider_report_ingest";
  date: string;
  configured_adapters: string[];
  ingested: number;
  note: string;
}

// §19 script/API channel: for each CONFIGURED report adapter, pull its rows and
// stage them as source='script' revenue_raw (matched on click_id, or a sub
// mapping the adapter performs). No adapter is configured in this repo → a
// structured no-op (honest: it is a framework awaiting a provider source).
export async function ingestProviderReports(
  env: Env,
  opts?: { now?: Date; adapters?: readonly ProviderReportAdapter[] },
): Promise<IngestReportsResult> {
  const now = opts?.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const adapters = opts?.adapters ?? PROVIDER_REPORT_ADAPTERS;
  const configured = adapters.filter((a) => a.configured(env));
  let ingested = 0;
  for (const adapter of configured) {
    try {
      const rows = await adapter.fetchRows(env, date);
      for (const row of rows) {
        if (row.click_id === "") continue; // revenue_raw.click_id NOT NULL
        await env.DB.prepare(
          `INSERT INTO listicle_revenue_raw (dt, click_id, offer_public_id, source, conversions, revenue, currency)
           VALUES (?, ?, ?, 'script', 1, ?, ?)`,
        )
          .bind(date, row.click_id, row.offer_public_id, row.revenue, row.currency)
          .run();
        ingested += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[lst-report-ingest] adapter ${adapter.name} failed: ${msg.slice(0, 200)}`);
    }
  }
  return {
    t: "lst_provider_report_ingest",
    date,
    configured_adapters: configured.map((a) => a.name),
    ingested,
    note:
      configured.length === 0
        ? "no provider report/API adapter configured — framework awaiting a source (honest no-op)"
        : "ingested from configured provider report adapters",
  };
}

// --- §20 default media-platform seed ----------------------------------------

// Seed Facebook as the first §20 media platform, ENABLED=0 by default so the
// dispatcher fires NOTHING until an operator sets its token + flips enabled=1
// (via the media-platforms admin CRUD). Idempotent (INSERT OR IGNORE on the
// UNIQUE platform) — a re-run never clobbers operator edits. The template is an
// illustrative placeholder (GET pixel shape) the operator replaces with their
// real endpoint. `auth_secret_ref` is the SECRET NAME only, never a token value.
export const SEED_FACEBOOK_TEMPLATE =
  "https://www.facebook.com/tr?ev={event_name}&cd[click_id]={click_id}&cd[fbc]={fbc}&cd[fbclid]={fbclid}&cd[value]={value}&cd[currency]={currency}";

export async function seedDefaultMediaPlatforms(env: Env): Promise<{ seeded: boolean }> {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO listicle_media_platforms
         (platform, enabled, postback_url_template, auth_secret_ref, event_name)
       VALUES ('facebook', 0, ?, 'LISTICLE_S2S_TOKEN_FACEBOOK', 'Purchase')`,
    )
      .bind(SEED_FACEBOOK_TEMPLATE)
      .run();
    return { seeded: true };
  } catch {
    return { seeded: false };
  }
}

// --- the cron entry ---------------------------------------------------------

export interface RevenueCronSummary {
  ship: ShipResult | null;
  sweep: SweepResult | null;
  daily_ran: boolean;
  fx?: FxRefreshSummary | null;
  backfill?: BackfillResult | null;
  reconciliation?: ProviderReconReport | null;
  report_ingest?: IngestReportsResult | null;
}

function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

// Called from index.ts scheduled() in its own try/catch. Each sub-task is
// individually isolated + fail-open. Daily tasks self-gate to 00:07 UTC (off
// the reconciliation's 00:05) unless opts.force.
export async function runListicleRevenueCron(
  env: Env,
  opts?: RevenueCronOptions,
): Promise<RevenueCronSummary> {
  const now = opts?.now ?? new Date();
  const summary: RevenueCronSummary = { ship: null, sweep: null, daily_ran: false };

  try {
    summary.ship = await shipRevenueRawToCh(env, opts);
  } catch (err) {
    console.error(`[lst-revenue-cron] ship failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
  }
  try {
    summary.sweep = await reMatchUnmatchedSweep(env, opts);
  } catch (err) {
    console.error(`[lst-revenue-cron] sweep failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
  }

  const daily = opts?.force === true || (now.getUTCHours() === 0 && now.getUTCMinutes() === 7);
  if (daily) {
    summary.daily_ran = true;
    try {
      await seedDefaultMediaPlatforms(env);
    } catch {
      /* seed is idempotent + best-effort */
    }
    try {
      summary.fx = await refreshFxRates(env, { now, seededRates: opts?.seededRates });
    } catch (err) {
      console.error(`[lst-revenue-cron] fx refresh failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    }
    try {
      summary.backfill = await triggerAttributionBackfill(env, opts);
    } catch (err) {
      console.error(`[lst-revenue-cron] backfill failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    }
    try {
      const yesterday = utcDate(new Date(now.getTime() - 24 * 3600 * 1000));
      summary.reconciliation = await dailyProviderReconciliation(env, yesterday);
      console.log(JSON.stringify(summary.reconciliation));
    } catch (err) {
      console.error(`[lst-revenue-cron] provider recon failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    }
    try {
      summary.report_ingest = await ingestProviderReports(env, { now });
    } catch (err) {
      console.error(`[lst-revenue-cron] report ingest failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    }
  }
  return summary;
}
