// LeadGen CH → D1 analytics mirror sync (design contract 08 §23/§24, §7.5).
//
// The every-minute cron calls syncLeadgenAnalytics(env) inside its OWN
// try/catch. For a bounded rolling window (today + yesterday UTC by default) we
// read each of the nine CH `lg_*_daily` materialized views (FINAL) over the
// HTTP interface and idempotently UPSERT the rows into the matching D1
// `leadgen_analytics_*` mirror with the exact `ON CONFLICT … DO UPDATE` shape
// migration 0037 declared. A manual rebuildLeadgenAnalyticsRange(env, from, to)
// backfills a wider window.
//
// These are the analytics tables the leadgen admin already READS
// (offers-handlers.ts / auctions-handlers.ts); this module is the WRITE side
// that fills them.
//
// Isolation: each of the nine tables runs in its own try/catch — one table's
// CH/D1 failure never sinks the others. Fail-open: absent CH secrets ⇒ a
// logged, structured no-op; syncLeadgenAnalytics never throws.

import type { Env } from "../env";
import {
  createLeadgenChClient,
  type CreateChClientOptions,
  type LeadgenChClient,
} from "./clickhouse";

// D1: 100-binding limit PER PREPARED STATEMENT. Every upsert row below binds
// ≤ its column count (max 17) — well under 100. We batch ≤ 80 single-row
// statements per db.batch() call (never one giant multi-row statement).
export const D1_BATCH_ROWS = 80;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ColumnKind = "text" | "int" | "real";

export interface ColumnMap {
  d1: string;   // D1 mirror column (migration 0037)
  ch: string;   // CH `lg_*_daily` MV column (infra/clickhouse-ddl.sql)
  kind: ColumnKind;
}

export interface MirrorSpec {
  name: string;         // short label for the summary
  chTable: string;      // CH daily target (lg_*_daily)
  d1Table: string;      // D1 mirror table (leadgen_analytics_*)
  columns: ColumnMap[]; // bound INSERT columns (synced_at is a literal unixepoch())
  pk: string[];         // D1 PK columns (ON CONFLICT target)
  notNull: string[];    // identity columns that must be non-empty — skip garbage rows
}

// The nine mirrors. The `*_id` → `*_public_id` rename (§24) applies wherever the
// D1 schema exposes a public id but the CH MV emits the raw id:
//   offer_id → offer_public_id, section_id → section_public_id,
//   quote_id → quote_public_id, auction_config_id → auction_public_id.
// D1 columns the CH MVs do NOT carry are intentionally omitted so the mirror
// keeps its column default (documented per mirror):
//   * section.time_on_section_ms_sum — not emitted by lg_section_daily (stays NULL)
//   * quote.funnel_name              — not emitted by lg_quote_daily   (stays '')
//   * quote.variant_label            — not emitted by lg_quote_daily   (stays '')
export const MIRRORS: MirrorSpec[] = [
  {
    name: "offer",
    chTable: "lg_offer_daily",
    d1Table: "leadgen_analytics_offer",
    pk: ["offer_public_id", "date"],
    notNull: ["offer_public_id"],
    columns: [
      { d1: "offer_public_id", ch: "offer_id", kind: "text" }, // §24 rename
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "offer_impressions", ch: "offer_impressions", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "unique_clicks", ch: "unique_clicks", kind: "int" },
      { d1: "conversions", ch: "conversions", kind: "int" },
      { d1: "revenue", ch: "revenue", kind: "real" },
    ],
  },
  {
    name: "section",
    chTable: "lg_section_daily",
    d1Table: "leadgen_analytics_section",
    pk: ["section_public_id", "date"],
    notNull: ["section_public_id"],
    columns: [
      { d1: "section_public_id", ch: "section_id", kind: "text" }, // §24 rename
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "views", ch: "views", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "continued", ch: "continued", kind: "int" },
      { d1: "validation_errors", ch: "validation_errors", kind: "int" },
      { d1: "default_applied", ch: "default_applied", kind: "int" },
      { d1: "user_confirmed_default", ch: "user_confirmed_default", kind: "int" },
      { d1: "user_selected", ch: "user_selected", kind: "int" },
      // time_on_section_ms_sum: no CH source — omitted (stays NULL).
      { d1: "dropoffs", ch: "dropoffs", kind: "int" },
    ],
  },
  {
    name: "answer_distribution",
    chTable: "lg_answer_distribution_daily",
    d1Table: "leadgen_analytics_answer_distribution",
    pk: ["section_public_id", "question_key", "answer_value_normalized", "answer_source", "date"],
    notNull: ["section_public_id", "question_key"],
    columns: [
      { d1: "section_public_id", ch: "section_id", kind: "text" }, // §24 rename
      { d1: "question_key", ch: "question_key", kind: "text" },
      { d1: "answer_value_normalized", ch: "answer_value_normalized", kind: "text" },
      { d1: "answer_source", ch: "answer_source", kind: "text" },
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "count", ch: "count", kind: "int" },
      { d1: "continued_count", ch: "continued_count", kind: "int" },
    ],
  },
  {
    name: "quote",
    chTable: "lg_quote_daily",
    d1Table: "leadgen_analytics_quote",
    pk: ["quote_public_id", "funnel_id", "funnel_variant_id", "site_id", "traffic_source", "date"],
    notNull: ["quote_public_id"],
    columns: [
      { d1: "quote_public_id", ch: "quote_id", kind: "text" }, // §24 rename
      { d1: "funnel_id", ch: "funnel_id", kind: "text" },
      // funnel_name: no CH source — omitted (stays '').
      { d1: "funnel_variant_id", ch: "funnel_variant_id", kind: "text" },
      { d1: "funnel_ab_test_id", ch: "funnel_ab_test_id", kind: "text" },
      // variant_label: no CH source — omitted (stays '').
      { d1: "site_id", ch: "site_id", kind: "text" },
      { d1: "traffic_source", ch: "traffic_source", kind: "text" },
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "visits", ch: "visits", kind: "int" },
      { d1: "unique_visits", ch: "unique_visits", kind: "int" },
      { d1: "bounces", ch: "bounces", kind: "int" },
      { d1: "completions", ch: "completions", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "conversions", ch: "conversions", kind: "int" },
      { d1: "unfilled", ch: "unfilled", kind: "int" },
      { d1: "revenue", ch: "revenue", kind: "real" },
    ],
  },
  {
    name: "quote_drilldown",
    chTable: "lg_quote_drilldown_daily",
    d1Table: "leadgen_analytics_quote_drilldown",
    pk: [
      "quote_public_id", "funnel_id", "funnel_variant_id", "site_id", "traffic_source",
      "device", "state", "section_public_id", "question_key", "answer_value_normalized", "date",
    ],
    notNull: ["quote_public_id"],
    columns: [
      { d1: "quote_public_id", ch: "quote_id", kind: "text" }, // §24 rename
      { d1: "funnel_id", ch: "funnel_id", kind: "text" },
      { d1: "funnel_variant_id", ch: "funnel_variant_id", kind: "text" },
      { d1: "site_id", ch: "site_id", kind: "text" },
      { d1: "traffic_source", ch: "traffic_source", kind: "text" },
      { d1: "device", ch: "device", kind: "text" },
      { d1: "state", ch: "state", kind: "text" },
      { d1: "section_public_id", ch: "section_id", kind: "text" }, // §24 rename
      { d1: "section_index", ch: "section_index", kind: "int" },
      { d1: "question_key", ch: "question_key", kind: "text" },
      { d1: "answer_value_normalized", ch: "answer_value_normalized", kind: "text" },
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "views", ch: "views", kind: "int" },
      { d1: "continued", ch: "continued", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "conversions", ch: "conversions", kind: "int" },
      { d1: "revenue", ch: "revenue", kind: "real" },
    ],
  },
  {
    name: "auction",
    chTable: "lg_auction_daily",
    d1Table: "leadgen_analytics_auction",
    pk: ["auction_public_id", "date"],
    notNull: ["auction_public_id"],
    columns: [
      { d1: "auction_public_id", ch: "auction_config_id", kind: "text" }, // §24 rename
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "auctions", ch: "auctions", kind: "int" },
      { d1: "filled_auctions", ch: "filled_auctions", kind: "int" },
      { d1: "unfilled_auctions", ch: "unfilled_auctions", kind: "int" },
      { d1: "offer_impressions", ch: "offer_impressions", kind: "int" },
      { d1: "carrier_impressions", ch: "carrier_impressions", kind: "int" },
      { d1: "carrier_clicks", ch: "carrier_clicks", kind: "int" },
      { d1: "bid_value_sum", ch: "bid_value_sum", kind: "real" },
      { d1: "eligible_bid_count", ch: "eligible_bid_count", kind: "int" },
      { d1: "timeouts", ch: "timeouts", kind: "int" },
      { d1: "below_floor", ch: "below_floor", kind: "int" },
      { d1: "malformed", ch: "malformed", kind: "int" },
      { d1: "no_bid", ch: "no_bid", kind: "int" },
      { d1: "provider_errors", ch: "provider_errors", kind: "int" },
      { d1: "latency_ms_sum", ch: "latency_ms_sum", kind: "int" },
      { d1: "revenue", ch: "revenue", kind: "real" },
    ],
  },
  {
    name: "auction_drilldown",
    chTable: "lg_auction_drilldown_daily",
    d1Table: "leadgen_analytics_auction_drilldown",
    pk: [
      "auction_public_id", "offer_public_id", "carrier_key", "device", "state",
      "carrier_filtered_reason", "provider_error_reason", "auction_unfilled_reason", "date",
    ],
    notNull: ["auction_public_id"],
    columns: [
      { d1: "auction_public_id", ch: "auction_config_id", kind: "text" }, // §24 rename
      { d1: "offer_public_id", ch: "offer_id", kind: "text" }, // §24 rename
      { d1: "carrier_key", ch: "carrier_key", kind: "text" },
      { d1: "device", ch: "device", kind: "text" },
      { d1: "state", ch: "state", kind: "text" },
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "offer_impressions", ch: "offer_impressions", kind: "int" },
      { d1: "carrier_impressions", ch: "carrier_impressions", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "conversions", ch: "conversions", kind: "int" },
      { d1: "bid_value_sum", ch: "bid_value_sum", kind: "real" },
      { d1: "revenue", ch: "revenue", kind: "real" },
      { d1: "carrier_filtered_reason", ch: "carrier_filtered_reason", kind: "text" },
      { d1: "provider_error_reason", ch: "provider_error_reason", kind: "text" },
      { d1: "auction_unfilled_reason", ch: "auction_unfilled_reason", kind: "text" },
    ],
  },
  {
    name: "carrier",
    chTable: "lg_carrier_daily",
    d1Table: "leadgen_analytics_carrier",
    pk: ["auction_public_id", "offer_public_id", "carrier_key", "date"],
    notNull: ["auction_public_id", "carrier_key"],
    columns: [
      { d1: "auction_public_id", ch: "auction_config_id", kind: "text" }, // §24 rename
      { d1: "offer_public_id", ch: "offer_id", kind: "text" }, // §24 rename
      { d1: "carrier_key", ch: "carrier_key", kind: "text" },
      { d1: "carrier_name", ch: "carrier_name", kind: "text" },
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "carrier_impressions", ch: "carrier_impressions", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "unique_clicks", ch: "unique_clicks", kind: "int" },
      { d1: "conversions", ch: "conversions", kind: "int" },
      { d1: "bid_value_sum", ch: "bid_value_sum", kind: "real" },
      { d1: "revenue", ch: "revenue", kind: "real" },
    ],
  },
  {
    name: "provider_diagnostics",
    chTable: "lg_provider_diagnostics_daily",
    d1Table: "leadgen_analytics_provider_diagnostics",
    pk: ["offer_public_id", "auction_public_id", "provider_error_reason", "date"],
    notNull: ["offer_public_id"],
    columns: [
      { d1: "offer_public_id", ch: "offer_id", kind: "text" }, // §24 rename
      { d1: "auction_public_id", ch: "auction_config_id", kind: "text" }, // §24 rename
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "requests", ch: "requests", kind: "int" },
      { d1: "responses", ch: "responses", kind: "int" },
      { d1: "timeouts", ch: "timeouts", kind: "int" },
      { d1: "errors", ch: "errors", kind: "int" },
      { d1: "no_bid", ch: "no_bid", kind: "int" },
      { d1: "below_floor", ch: "below_floor", kind: "int" },
      { d1: "latency_ms_sum", ch: "latency_ms_sum", kind: "int" },
      { d1: "provider_error_reason", ch: "provider_error_reason", kind: "text" },
    ],
  },
];

export interface MirrorTableResult {
  table: string;   // the CH daily table read
  mirror: string;  // the D1 mirror written
  rows: number;    // rows upserted
  error?: string;  // isolated failure (this table only)
}

export interface SyncSummary {
  window: { from: string; to: string };
  configured: boolean;   // false ⇒ CH secrets absent / sync aborted (no-op)
  skipped?: string;      // reason when configured=false
  mirrors: MirrorTableResult[];
  total_rows: number;
  errors: string[];      // one entry per failed table
}

export interface SyncOptions extends CreateChClientOptions {
  /** Injectable CH client (tests). Defaults to createLeadgenChClient(env). */
  client?: LeadgenChClient;
  /** Injectable clock for the rolling window (tests). */
  now?: Date;
}

// ---- coercion (CH JSONEachRow → D1 bind values) ----------------------------

// text → String (null/undefined ⇒ ""); int → truncated finite number (bad ⇒ 0);
// real → finite number (bad ⇒ 0). `?? 0`-equivalent: a real 0 is preserved.
export function coerce(kind: ColumnKind, v: unknown): string | number {
  if (kind === "text") return v === undefined || v === null ? "" : String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return kind === "int" ? Math.trunc(n) : n;
}

// Build the exact §24 upsert once per mirror.
//   INSERT INTO <t> (<cols>, synced_at) VALUES (?,…,?, unixepoch())
//   ON CONFLICT(<pk>) DO UPDATE SET <nonPk>=excluded.<nonPk>, synced_at=excluded.synced_at
// Table + column names are FIXED literals from the spec — never request/row data.
export function buildUpsertSql(spec: MirrorSpec): string {
  const cols = spec.columns.map((c) => c.d1);
  const valuePlaceholders = cols.map(() => "?").join(", ");
  const nonPk = cols.filter((c) => !spec.pk.includes(c));
  const setClause = [
    ...nonPk.map((c) => `${c}=excluded.${c}`),
    "synced_at=excluded.synced_at",
  ].join(", ");
  return (
    `INSERT INTO ${spec.d1Table} (${cols.join(", ")}, synced_at) ` +
    `VALUES (${valuePlaceholders}, unixepoch()) ` +
    `ON CONFLICT(${spec.pk.join(", ")}) DO UPDATE SET ${setClause}`
  );
}

// SELECT the DISTINCT CH source columns FROM the lg_*_daily MV FINAL over a
// bounded rolling window. FINAL collapses the ReplacingMergeTree to the latest
// row per grain; toDate() makes the Date comparison explicit.
export function chSelect(spec: MirrorSpec): string {
  const chCols = Array.from(new Set(spec.columns.map((c) => c.ch)));
  return (
    `SELECT ${chCols.join(", ")} FROM ${spec.chTable} FINAL ` +
    `WHERE dt >= toDate({from}) AND dt <= toDate({to})`
  );
}

// A row is valid when every declared identity column is present + non-empty AND
// the `date` column (part of every mirror PK) is a real YYYY-MM-DD. Drops
// garbage rows (missing a PK / malformed date) before they reach D1.
export function rowIsValid(spec: MirrorSpec, mapped: Record<string, string | number>): boolean {
  for (const col of spec.notNull) {
    const v = mapped[col];
    if (v === undefined || v === null || v === "") return false;
  }
  const d = mapped["date"];
  if (typeof d !== "string" || !DATE_RE.test(d)) return false;
  return true;
}

// Mirror ONE table. Own error containment: returns a result with `error` set,
// never throws (the caller aggregates). Writes are batched ≤ D1_BATCH_ROWS
// single-row statements per db.batch() and awaited (business-critical).
export async function mirrorOne(
  db: D1Database,
  client: LeadgenChClient,
  spec: MirrorSpec,
  from: string,
  to: string,
): Promise<MirrorTableResult> {
  try {
    const { rows } = await client.query<Record<string, unknown>>(chSelect(spec), { from, to });
    // Map + coerce + skip garbage rows.
    const mapped: Array<Record<string, string | number>> = [];
    for (const raw of rows) {
      const rec: Record<string, string | number> = {};
      for (const col of spec.columns) rec[col.d1] = coerce(col.kind, raw[col.ch]);
      if (rowIsValid(spec, rec)) mapped.push(rec);
    }
    if (mapped.length === 0) return { table: spec.chTable, mirror: spec.d1Table, rows: 0 };

    const sql = buildUpsertSql(spec);
    const orderedCols = spec.columns.map((c) => c.d1);
    let written = 0;
    for (let i = 0; i < mapped.length; i += D1_BATCH_ROWS) {
      const chunk = mapped.slice(i, i + D1_BATCH_ROWS);
      const stmts = chunk.map((rec) =>
        db.prepare(sql).bind(...orderedCols.map((c) => rec[c])),
      );
      await db.batch(stmts); // business-critical write — awaited
      written += chunk.length;
    }
    return { table: spec.chTable, mirror: spec.d1Table, rows: written };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[lg-mirror-sync] table failed", { mirror: spec.d1Table, error: msg.slice(0, 300) });
    return { table: spec.chTable, mirror: spec.d1Table, rows: 0, error: msg.slice(0, 300) };
  }
}

/**
 * Manual backfill: mirror every CH daily table for [from, to] (inclusive,
 * YYYY-MM-DD UTC). Each table is isolated. Fail-open on absent CH secrets /
 * an invalid window (structured skip summary, never a throw).
 */
export async function rebuildLeadgenAnalyticsRange(
  env: Env,
  from: string,
  to: string,
  opts?: SyncOptions,
): Promise<SyncSummary> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return {
      window: { from, to },
      configured: false,
      skipped: "invalid date window (expected YYYY-MM-DD)",
      mirrors: [],
      total_rows: 0,
      errors: ["invalid date window"],
    };
  }
  const [lo, hi] = from <= to ? [from, to] : [to, from];

  const client = opts?.client ?? createLeadgenChClient(env, opts);
  if (!client.configured) {
    console.log("[lg-mirror-sync] no-op: CH credentials absent", { from: lo, to: hi });
    return {
      window: { from: lo, to: hi },
      configured: false,
      skipped: "CH credentials absent (CH_URL/CH_USER/CH_PASSWORD)",
      mirrors: [],
      total_rows: 0,
      errors: [],
    };
  }

  const mirrors: MirrorTableResult[] = [];
  for (const spec of MIRRORS) {
    mirrors.push(await mirrorOne(env.DB, client, spec, lo, hi));
  }
  const errors = mirrors.filter((m) => m.error).map((m) => `${m.mirror}: ${m.error}`);
  const total_rows = mirrors.reduce((n, m) => n + m.rows, 0);
  return { window: { from: lo, to: hi }, configured: true, mirrors, total_rows, errors };
}

/**
 * The every-minute cron entry (§23/§24): mirror the bounded rolling window
 * today + yesterday (UTC). NEVER throws — an overall try/catch backs the
 * per-table isolation so one CH/D1 fault can never sink the cron tick.
 */
export async function syncLeadgenAnalytics(env: Env, opts?: SyncOptions): Promise<SyncSummary> {
  const now = opts?.now ?? new Date();
  const to = utcDate(now);
  const from = utcDate(new Date(now.getTime() - DAY_MS));
  try {
    return await rebuildLeadgenAnalyticsRange(env, from, to, opts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[lg-mirror-sync] sync failed", { error: msg.slice(0, 300) });
    return {
      window: { from, to },
      configured: false,
      skipped: `sync failed: ${msg.slice(0, 200)}`,
      mirrors: [],
      total_rows: 0,
      errors: [msg.slice(0, 300)],
    };
  }
}

function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}
