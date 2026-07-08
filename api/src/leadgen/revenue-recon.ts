// LeadGen §29 revenue reconciliation & maintenance + the every-minute /
// self-gated-daily revenue cron (the P12-deferred cron). runLeadgenRevenueCron
// is called from index.ts scheduled() in its OWN isolated try/catch (WIRING is
// a later stage). Each sub-task is individually isolated + fail-open — a cron
// must never break, and absent CH secrets degrade to a structured no-op.
//
//   EVERY MINUTE
//     * shipRevenueRawToCh   — §29 D1→CH shipper: NEW leadgen_revenue_raw rows
//       (synced_to_ch_at IS NULL) → CH lg_revenue_raw (offer_public_id →
//       offer_id), then stamp synced_to_ch_at.
//     * reMatchUnmatchedSweep— §29: pending leadgen_revenue_unmatched rows < 72h
//       re-matched against CH clean offer_click; matched → 'matched'; > 72h →
//       'unattributed'.
//   DAILY (self-gated 00:07 UTC)
//     * refreshFxRates            — §29 FX table (fx.ts; USD identity + honest no-op).
//     * triggerAttributionBackfill— §29 late-revenue backfill (CH attribution MV refresh).
//     * dailyProviderReconciliation— §29 provider-total vs ingested-total variance.
//     * ingestProviderReports     — §25 script/API channel framework (no-op stub).
//
// CH ARCHITECTURE SEAM (§23): the LeadGen CH client (leadgen/clickhouse.ts) is
// READ-ONLY by design — "External Athena→CH ingest (ops-owned). Worker only
// reads CH to fill D1 mirrors." It exposes `query` but NOT the `insert`/`command`
// write path the Listicles CH client has. shipRevenueRawToCh /
// triggerAttributionBackfill therefore FEATURE-DETECT an optional write path
// (LeadgenChWriteClient): with the read-only production client they return a
// structured no-op (the durable money record stays in D1 leadgen_revenue_raw;
// CH revenue is populated by the SAME external pipeline as lg_events_raw). Tests
// inject a write-capable client to prove the ship/refresh logic.

import type { Env } from "../env";
import {
  createLeadgenChClient,
  type CreateChClientOptions,
  type LeadgenChClient,
} from "./clickhouse";
import { refreshFxRates, type FxRefreshSummary } from "./fx";
import {
  blankLeadgenEvent,
  emitLeadgenRecords,
  type LeadgenEvent,
} from "../analytics/leadgen-events";
import { ulid } from "./ids";

const UNMATCHED_WINDOW_MS = 72 * 3600 * 1000; // §29 72h re-match window
const SHIP_BATCH = 200; // revenue_raw rows shipped per run
const REMATCH_BATCH = 200; // pending rows re-matched per run
const CH_IN_CHUNK = 100; // click_ids per CH IN() query
const D1_BIND_CHUNK = 80; // .claude/rules/d1-database-safety: ≤80 binds / stmt
export const ATTRIBUTION_MV = "lg_revenue_attributed_mv";

// The read-only CH client (leadgen/clickhouse.ts) OPTIONALLY extended with the
// write path the revenue shipper/backfill need. The production client satisfies
// this type (the extra members are optional + absent); a test injects a client
// that implements them. See the CH ARCHITECTURE SEAM note above.
export interface LeadgenChWriteClient extends LeadgenChClient {
  insert?(
    table: string,
    rows: ReadonlyArray<Record<string, unknown>>,
  ): Promise<{ inserted: number; configured: boolean }>;
  command?(sql: string): Promise<{ ok: boolean; configured: boolean }>;
}

export interface RevenueCronOptions extends CreateChClientOptions {
  client?: LeadgenChWriteClient;
  now?: Date;
  force?: boolean; // run the daily-gated tasks regardless of the clock (tests)
  seededRates?: Readonly<Record<string, number>>;
  // The scheduled handler's ExecutionContext — carries the m3 revenue_received
  // Firehose emission (emitLeadgenRecords rides ctx.waitUntil). Absent (legacy
  // callers/harnesses) ⇒ a no-op-waitUntil context; emission stays fail-open.
  ctx?: ExecutionContext;
}

// The runtime-routes safeExecutionCtx idiom: a no-op ExecutionContext for
// callers without one (unit harnesses / legacy invocations) — the emission's
// promise floats with its own .catch, never blocking or throwing.
function noopExecutionCtx(): ExecutionContext {
  return {
    waitUntil(): void {
      /* no-op outside workerd */
    },
    passThroughOnException(): void {
      /* no-op */
    },
  } as unknown as ExecutionContext;
}

// --- §29 D1 → CH revenue shipper --------------------------------------------

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
  booking_trigger: string;
  conversions: number;
  revenue: number;
  currency: string;
}

export async function shipRevenueRawToCh(env: Env, opts?: RevenueCronOptions): Promise<ShipResult> {
  const client: LeadgenChWriteClient = opts?.client ?? createLeadgenChClient(env, opts);
  if (!client.configured || typeof client.insert !== "function") {
    // §23: the production LeadGen CH client is read-only — no worker→CH write
    // path. The durable money record stays in D1 leadgen_revenue_raw; CH revenue
    // is populated by the external Athena→CH pipeline. Honest structured no-op.
    return {
      configured: client.configured,
      shipped: 0,
      reason: "CH write path unavailable (LeadGen CH ingest is ops-owned/external, §23)",
    };
  }
  const res = await env.DB.prepare(
    `SELECT id, dt, click_id, offer_public_id, source, booking_trigger, conversions, revenue, currency
     FROM leadgen_revenue_raw WHERE synced_to_ch_at IS NULL
     ORDER BY id ASC LIMIT ?`,
  )
    .bind(SHIP_BATCH)
    .all<RevenueRawRow>();
  const rows = res.results ?? [];
  if (rows.length === 0) return { configured: true, shipped: 0 };

  // The D1 staging column is offer_public_id; CH lg_revenue_raw keeps offer_id —
  // map explicitly. booking_trigger ships through (§23 lg_revenue_raw carries it).
  const chRows = rows.map((r) => ({
    dt: r.dt,
    click_id: r.click_id,
    offer_id: r.offer_public_id ?? "",
    source: r.source,
    booking_trigger: r.booking_trigger,
    conversions: r.conversions,
    revenue: r.revenue,
    currency: r.currency,
  }));
  await client.insert("lg_revenue_raw", chRows);

  // Stamp synced_to_ch_at on exactly the rows we shipped (≤80 ids / statement).
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += D1_BIND_CHUNK) {
    const chunk = ids.slice(i, i + D1_BIND_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE leadgen_revenue_raw SET synced_to_ch_at = unixepoch() WHERE id IN (${placeholders})`,
    )
      .bind(...chunk)
      .run();
  }
  return { configured: true, shipped: rows.length };
}

// --- §29 unmatched re-match sweep -------------------------------------------

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
  client: LeadgenChClient,
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
      `SELECT DISTINCT click_id FROM lg_events_raw ` +
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
  // runs, CH-independent — §29 "after the window → unattributed").
  let agedOut = 0;
  try {
    const r = await env.DB.prepare(
      "UPDATE leadgen_revenue_unmatched SET status = 'unattributed' WHERE status = 'pending' AND received_at < ?",
    )
      .bind(windowStart)
      .run();
    agedOut = (r.meta as { changes?: number } | undefined)?.changes ?? 0;
  } catch {
    /* best-effort */
  }

  const client: LeadgenChClient = opts?.client ?? createLeadgenChClient(env, opts);
  if (!client.configured) {
    return { configured: false, matched: 0, aged_out: agedOut, scanned: 0, reason: "CH credentials absent" };
  }

  // Re-match the in-window pending rows against CH clean offer_clicks.
  const res = await env.DB.prepare(
    `SELECT id, click_id, provider, external_txn_id, revenue, currency FROM leadgen_revenue_unmatched
     WHERE status = 'pending' AND received_at >= ?
     ORDER BY received_at ASC LIMIT ?`,
  )
    .bind(windowStart, REMATCH_BATCH)
    .all<{
      id: number;
      click_id: string;
      provider: string;
      external_txn_id: string | null;
      revenue: number;
      currency: string;
    }>();
  const pending = res.results ?? [];
  if (pending.length === 0) return { configured: true, matched: 0, aged_out: agedOut, scanned: 0 };

  const clickIds = Array.from(new Set(pending.map((p) => p.click_id).filter((c) => c !== "")));
  const matchedSet = await matchedClickIdsInCh(client, clickIds);

  // Promote matched rows to 'matched'. NO double-count: the revenue_raw row was
  // already staged at ingest; the CH attribution MV performs the actual
  // (re)attribution once the click lands — this sweep only advances STATUS.
  const matchedRows = pending.filter((p) => matchedSet.has(p.click_id));
  const matchedIds = matchedRows.map((p) => p.id);
  let matched = 0;
  for (let i = 0; i < matchedIds.length; i += D1_BIND_CHUNK) {
    const chunk = matchedIds.slice(i, i + D1_BIND_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const r = await env.DB.prepare(
      `UPDATE leadgen_revenue_unmatched SET status = 'matched' WHERE id IN (${placeholders})`,
    )
      .bind(...chunk)
      .run();
    matched += (r.meta as { changes?: number } | undefined)?.changes ?? chunk.length;
  }

  // m3: `revenue_received` fires when a re-match BOOKS (status → matched) —
  // the sweep was the one revenue-booking path without the 10 §10.2 monetized
  // event. Mirrors postback.ts's emitRevenueEvents posture exactly: emission
  // runs AFTER the booking landed, inside its own try/catch, and
  // emitLeadgenRecords itself is a structured no-op without creds/stream —
  // the failure path can never block or unwind the booking.
  if (matchedRows.length > 0) {
    try {
      const events: LeadgenEvent[] = matchedRows.map((row) => {
        const e = blankLeadgenEvent("revenue_received", now.getTime());
        e.event_id = ulid(now.getTime());
        e.click_id = row.click_id;
        e.conversion_id = row.external_txn_id ?? "";
        e.provider = row.provider;
        e.revenue = row.revenue;
        e.bid_currency = row.currency;
        e.booking_trigger = "rematch_sweep";
        return e;
      });
      emitLeadgenRecords(env, opts?.ctx ?? noopExecutionCtx(), events);
    } catch {
      /* fail-open: telemetry never blocks the re-match booking */
    }
  }
  return { configured: true, matched, aged_out: agedOut, scanned: pending.length };
}

// --- §29 late-revenue backfill (CH attribution MV re-materialization) -------

export interface BackfillResult {
  configured: boolean;
  refreshed: boolean;
  note: string;
}

export async function triggerAttributionBackfill(env: Env, opts?: RevenueCronOptions): Promise<BackfillResult> {
  const client: LeadgenChWriteClient = opts?.client ?? createLeadgenChClient(env, opts);
  if (!client.configured || typeof client.command !== "function") {
    return {
      configured: client.configured,
      refreshed: false,
      note: "CH command path unavailable — the attribution MV auto-refreshes every 2 min once CH is live (§23)",
    };
  }
  // The MV is a REFRESH … EVERY 2 MINUTE view over the FULL lg_revenue_raw, so
  // late postbacks re-attach automatically; this explicit refresh forces
  // immediate re-materialization (the §29 trailing window is covered because the
  // MV re-reads all of revenue_raw each cycle).
  try {
    await client.command(`SYSTEM REFRESH VIEW ${ATTRIBUTION_MV}`);
    return { configured: true, refreshed: true, note: "explicit SYSTEM REFRESH VIEW issued" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { configured: true, refreshed: false, note: `refresh failed (auto-refresh still active): ${msg.slice(0, 160)}` };
  }
}

// --- §29 daily provider-total reconciliation --------------------------------

export interface ProviderReconRecord {
  provider: string;
  date: string;
  ingested_postback_count: number;
  provider_report_total: number | null; // no provider-report source wired → null
  variance: number | null;
  variance_flag: string;
}

export interface ProviderReconReport {
  t: "lg_provider_reconciliation";
  date: string;
  ingested_s2s_revenue: number; // per-day SUM(revenue) of s2s_postback rows
  providers: ProviderReconRecord[];
  null_reasons: { provider_report_total: string };
}

// Reconcile per provider for one UTC date (§29). What IS measurable: the
// postback COUNT per provider (leadgen_postback_log) + the day's total s2s
// revenue (leadgen_revenue_raw source='s2s_postback'). What is NOT (honest): the
// provider's OWN reported total — no provider-report source is wired (and
// revenue_raw carries no provider column), so provider_report_total is NULL +
// reason and the variance is flagged unmeasurable rather than faked.
export async function dailyProviderReconciliation(
  env: Env,
  date: string,
): Promise<ProviderReconReport> {
  const dayStart = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
  const dayEnd = dayStart + 24 * 3600;

  const provRows = await env.DB.prepare(
    `SELECT provider, COUNT(*) AS n FROM leadgen_postback_log
     WHERE received_at >= ? AND received_at < ? GROUP BY provider ORDER BY provider ASC`,
  )
    .bind(dayStart, dayEnd)
    .all<{ provider: string; n: number }>();

  const revRow = await env.DB.prepare(
    "SELECT COALESCE(SUM(revenue), 0) AS total FROM leadgen_revenue_raw WHERE source = 's2s_postback' AND dt = ?",
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
    t: "lg_provider_reconciliation",
    date,
    ingested_s2s_revenue: revRow?.total ?? 0,
    providers,
    null_reasons: {
      provider_report_total:
        "no provider-report source configured (and revenue_raw carries no provider column); " +
        "wire a provider report/API adapter (ingestProviderReports) to compute per-provider variance",
    },
  };
}

// --- §25 script / API channel (framework + stub) ----------------------------

export interface ProviderReportAdapter {
  name: string;
  /** True only when THIS adapter's provider API/report source secret is set. */
  configured(env: Env): boolean;
  /** Pull + normalize provider rows to revenue_raw shape (unused until configured). */
  fetchRows(
    env: Env,
    date: string,
  ): Promise<Array<{ click_id: string; external_txn_id: string; revenue: number; currency: string; offer_public_id: string | null }>>;
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
  t: "lg_provider_report_ingest";
  date: string;
  configured_adapters: string[];
  ingested: number;
  note: string;
}

// §25 script/API channel: for each CONFIGURED report adapter, pull its rows and
// stage them as source='script' revenue_raw (booking_trigger='conversion'). No
// adapter is configured in this repo → a structured no-op (honest: a framework
// awaiting a provider source).
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
          `INSERT INTO leadgen_revenue_raw
             (dt, click_id, offer_public_id, source, booking_trigger, conversions, revenue, currency)
           VALUES (?, ?, ?, 'script', 'conversion', 1, ?, ?)`,
        )
          .bind(date, row.click_id, row.offer_public_id, row.revenue, row.currency)
          .run();
        ingested += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[lg-report-ingest] adapter ${adapter.name} failed: ${msg.slice(0, 200)}`);
    }
  }
  return {
    t: "lg_provider_report_ingest",
    date,
    configured_adapters: configured.map((a) => a.name),
    ingested,
    note:
      configured.length === 0
        ? "no provider report/API adapter configured — framework awaiting a source (honest no-op)"
        : "ingested from configured provider report adapters",
  };
}

// --- §26 default media-platform seed ----------------------------------------

// Seed Facebook as the first §26 media platform, ENABLED=0 by default so the
// dispatcher fires NOTHING until an operator sets its token + flips enabled=1.
// Idempotent (INSERT OR IGNORE on the UNIQUE platform) — a re-run never clobbers
// operator edits. The template is an illustrative placeholder the operator
// replaces; `auth_secret_ref` is the SECRET NAME only, never a token value.
export const SEED_FACEBOOK_TEMPLATE =
  "https://www.facebook.com/tr?ev={event_name}&cd[click_id]={click_id}&cd[fbc]={fbc}&cd[fbclid]={fbclid}&cd[value]={value}&cd[currency]={currency}";

export async function seedDefaultMediaPlatforms(env: Env): Promise<{ seeded: boolean }> {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO leadgen_media_platforms
         (platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier)
       VALUES ('facebook', 0, ?, 'LEADGEN_S2S_TOKEN_FACEBOOK', 'Purchase', 1)`,
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

// The P12-deferred cron. Called from index.ts scheduled() in its own try/catch.
// Each sub-task is individually isolated + fail-open. Daily tasks self-gate to
// 00:07 UTC unless opts.force. ISOLATED: absent CH secrets ⇒ structured no-op;
// any sub-task error is contained (logged), never thrown out of the cron.
export async function runLeadgenRevenueCron(
  env: Env,
  opts?: RevenueCronOptions,
): Promise<RevenueCronSummary> {
  const now = opts?.now ?? new Date();
  const summary: RevenueCronSummary = { ship: null, sweep: null, daily_ran: false };

  try {
    summary.ship = await shipRevenueRawToCh(env, opts);
  } catch (err) {
    console.error(`[lg-revenue-cron] ship failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
  }
  try {
    summary.sweep = await reMatchUnmatchedSweep(env, opts);
  } catch (err) {
    console.error(`[lg-revenue-cron] sweep failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
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
      console.error(`[lg-revenue-cron] fx refresh failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    }
    try {
      summary.backfill = await triggerAttributionBackfill(env, opts);
    } catch (err) {
      console.error(`[lg-revenue-cron] backfill failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    }
    try {
      const yesterday = utcDate(new Date(now.getTime() - 24 * 3600 * 1000));
      summary.reconciliation = await dailyProviderReconciliation(env, yesterday);
      console.log(JSON.stringify(summary.reconciliation));
    } catch (err) {
      console.error(`[lg-revenue-cron] provider recon failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    }
    try {
      summary.report_ingest = await ingestProviderReports(env, { now });
    } catch (err) {
      console.error(`[lg-revenue-cron] report ingest failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    }
  }
  return summary;
}
