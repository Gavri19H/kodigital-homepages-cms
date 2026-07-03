// Listicles CH → D1 analytics mirror sync (design contract §18 + §30.7).
//
// The every-minute cron calls syncListicleAnalytics(env) (index.ts) inside its
// OWN try/catch. For a bounded rolling window (today + yesterday UTC by
// default) we read each of the five CH daily target tables (FINAL) over the
// HTTP interface and idempotently UPSERT the rows into the matching D1 mirror
// with the EXACT §18 `ON CONFLICT … DO UPDATE` shape. A manual
// rebuildRange(env, from, to) backfills a wider window.
//
// Isolation: each of the five tables runs in its own try/catch — one table's
// CH/D1 failure never sinks the others. Fail-open: absent CH secrets ⇒ a
// logged, structured no-op (like the Firehose path + the Phase-7 stream).
//
// The PORTED pattern (kodigital-dashboard/lib/ch-d1-mirror.ts): CH query with
// FINAL → coerce/skip-bad rows → chunked batched writes. Rewritten fresh here
// with the §18 ON CONFLICT upsert (not INSERT OR REPLACE) so the mirror's own
// synced_at column semantics + PKs are honored exactly as migration 0033 wrote
// them.

import type { Env } from "../env";
import {
  createListicleChClient,
  type CreateChClientOptions,
  type ListicleChClient,
} from "./clickhouse";

// D1: 100-binding limit per prepared statement; every upsert row below binds
// ≤ 24 params (well under). We batch ≤ 80 rows per d1.batch() call (≤ 100
// rows / row bind-count keeps every batch safely inside D1's limits — §hard-rules).
const D1_BATCH_ROWS = 80;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ColumnKind = "text" | "int" | "real";

interface ColumnMap {
  d1: string;   // D1 mirror column (migration 0033)
  ch: string;   // CH daily-table column (infra/listicles/clickhouse-ddl.sql)
  kind: ColumnKind;
}

interface MirrorSpec {
  name: string;         // short label for the summary
  chTable: string;      // CH daily target
  d1Table: string;      // D1 mirror table
  columns: ColumnMap[]; // bound INSERT columns (synced_at is a literal unixepoch())
  pk: string[];         // D1 PK columns (ON CONFLICT target)
  notNull: string[];    // D1 columns that must be non-empty — skip garbage rows
}

// The five mirrors. offer_id → offer_public_id (DEV-6) shows up in OFFER +
// LINK_INSTANCE. Columns the CH raw schema does NOT carry are intentionally
// omitted so the mirror keeps its column default (documented per mirror):
//   * article.article_variant_label — not in lst_events_raw (stays '')
//   * drilldown.page_rule_priority  — not in lst_events_raw (stays NULL)
const MIRRORS: MirrorSpec[] = [
  {
    name: "offer",
    chTable: "lst_offer_daily",
    d1Table: "listicle_analytics_offer",
    pk: ["offer_public_id", "date"],
    notNull: ["offer_public_id", "date"],
    columns: [
      { d1: "offer_public_id", ch: "offer_id", kind: "text" }, // DEV-6
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "impressions", ch: "impressions", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "unique_clicks", ch: "unique_clicks", kind: "int" },
      { d1: "conversions", ch: "conversions", kind: "int" },
      { d1: "revenue", ch: "revenue", kind: "real" },
    ],
  },
  {
    name: "section",
    chTable: "lst_section_daily",
    d1Table: "listicle_analytics_section",
    pk: ["section_public_id", "date"],
    notNull: ["section_public_id", "date"],
    columns: [
      { d1: "section_public_id", ch: "section_id", kind: "text" },
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "impressions", ch: "impressions", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "unique_clicks", ch: "unique_clicks", kind: "int" },
      { d1: "conversions", ch: "conversions", kind: "int" },
      { d1: "revenue", ch: "revenue", kind: "real" },
    ],
  },
  {
    name: "article",
    chTable: "lst_article_daily",
    d1Table: "listicle_analytics_article",
    pk: ["article_public_id", "article_version_id", "article_version_revision", "date"],
    notNull: ["article_public_id", "date"],
    columns: [
      { d1: "article_public_id", ch: "article_id", kind: "text" },
      { d1: "article_version_id", ch: "article_version_id", kind: "text" },
      { d1: "article_version_revision", ch: "article_version_revision", kind: "int" },
      { d1: "article_experiment_id", ch: "article_experiment_id", kind: "text" },
      { d1: "article_split_percentage", ch: "article_split", kind: "int" },
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "total_visits", ch: "total_visits", kind: "int" },
      { d1: "unique_visits", ch: "unique_visits", kind: "int" },
      { d1: "impressions", ch: "impressions", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "unique_clicks", ch: "unique_clicks", kind: "int" },
      { d1: "conversions", ch: "conversions", kind: "int" },
      { d1: "revenue", ch: "revenue", kind: "real" },
    ],
  },
  {
    name: "drilldown",
    chTable: "lst_drilldown_daily",
    d1Table: "listicle_analytics_drilldown",
    pk: [
      "article_public_id", "article_version_id", "article_version_revision",
      "page_index", "page_candidate_id", "date",
    ],
    notNull: ["article_public_id", "date"],
    columns: [
      { d1: "article_public_id", ch: "article_id", kind: "text" },
      { d1: "article_version_id", ch: "article_version_id", kind: "text" },
      { d1: "article_version_revision", ch: "article_version_revision", kind: "int" },
      { d1: "article_experiment_id", ch: "article_experiment_id", kind: "text" },
      { d1: "article_split_percentage", ch: "article_split", kind: "int" },
      { d1: "page_index", ch: "page_index", kind: "int" },
      { d1: "page_selection_mode", ch: "page_selection_mode", kind: "text" },
      { d1: "section_public_id", ch: "section_id", kind: "text" },
      { d1: "page_candidate_id", ch: "page_candidate_id", kind: "text" },
      { d1: "ab_test_id", ch: "ab_test_id", kind: "text" },
      { d1: "page_rule_set_id", ch: "page_rule_set_id", kind: "text" },
      { d1: "page_rule_id", ch: "page_rule_id", kind: "text" },
      { d1: "selection_reason", ch: "selection_reason", kind: "text" },
      { d1: "matched_rule_json_hash", ch: "matched_rule_json_hash", kind: "text" },
      { d1: "traffic_allocation", ch: "ab_split", kind: "int" }, // page-level allocation
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "impressions", ch: "impressions", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "unique_clicks", ch: "unique_clicks", kind: "int" },
      { d1: "conversions", ch: "conversions", kind: "int" },
      { d1: "revenue", ch: "revenue", kind: "real" },
      { d1: "visits", ch: "visits", kind: "int" },
      { d1: "matched_sessions", ch: "matched_sessions", kind: "int" },
      { d1: "fallback_sessions", ch: "fallback_sessions", kind: "int" },
    ],
  },
  {
    name: "link_instance",
    chTable: "lst_link_instance_daily",
    d1Table: "listicle_analytics_link_instance",
    pk: [
      "link_instance_id", "article_public_id", "article_version_id",
      "article_version_revision", "page_index", "page_candidate_id", "date",
    ],
    notNull: ["link_instance_id", "article_public_id", "date"],
    columns: [
      { d1: "link_instance_id", ch: "link_instance_id", kind: "text" },
      { d1: "section_public_id", ch: "section_id", kind: "text" },
      { d1: "offer_public_id", ch: "offer_id", kind: "text" }, // DEV-6
      { d1: "article_public_id", ch: "article_id", kind: "text" },
      { d1: "article_version_id", ch: "article_version_id", kind: "text" },
      { d1: "article_version_revision", ch: "article_version_revision", kind: "int" },
      { d1: "page_index", ch: "page_index", kind: "int" },
      { d1: "page_candidate_id", ch: "page_candidate_id", kind: "text" },
      { d1: "page_selection_mode", ch: "page_selection_mode", kind: "text" },
      { d1: "page_rule_id", ch: "page_rule_id", kind: "text" },
      { d1: "selection_reason", ch: "selection_reason", kind: "text" },
      { d1: "section_block_id", ch: "section_block_id", kind: "text" },
      { d1: "link_role", ch: "link_role", kind: "text" },
      { d1: "link_position_index", ch: "link_position_index", kind: "int" },
      { d1: "button_style_id", ch: "button_style_id", kind: "text" },
      { d1: "button_group_id", ch: "button_group_id", kind: "text" },
      { d1: "anchor_text_hash", ch: "anchor_text_hash", kind: "text" },
      { d1: "analytics_label", ch: "analytics_label", kind: "text" },
      { d1: "date", ch: "dt", kind: "text" },
      { d1: "impressions", ch: "impressions", kind: "int" },
      { d1: "clicks", ch: "clicks", kind: "int" },
      { d1: "unique_clicks", ch: "unique_clicks", kind: "int" },
      { d1: "conversions", ch: "conversions", kind: "int" },
      { d1: "revenue", ch: "revenue", kind: "real" },
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
  configured: boolean;   // false ⇒ CH secrets absent (no-op)
  skipped?: string;      // reason when configured=false
  mirrors: MirrorTableResult[];
  total_rows: number;
  errors: string[];      // one entry per failed table
}

export interface SyncOptions extends CreateChClientOptions {
  /** Injectable CH client (tests). Defaults to createListicleChClient(env). */
  client?: ListicleChClient;
  /** Injectable clock for the rolling window (tests). */
  now?: Date;
}

// ---- coercion (CH JSONEachRow → D1 bind values) ----------------------------

function coerce(kind: ColumnKind, v: unknown): string | number {
  if (kind === "text") return v === undefined || v === null ? "" : String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return kind === "int" ? Math.trunc(n) : n;
}

// Build the exact §18 upsert once per mirror.
//   INSERT INTO <t> (<cols>, synced_at) VALUES (?,…,?, unixepoch())
//   ON CONFLICT(<pk>) DO UPDATE SET <nonPk>=excluded.<nonPk>, synced_at=excluded.synced_at
function buildUpsertSql(spec: MirrorSpec): string {
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

function chSelect(spec: MirrorSpec): string {
  const chCols = Array.from(new Set(spec.columns.map((c) => c.ch)));
  // dt is a Date column — the window predicate follows §18 (bounded rolling
  // window). FINAL collapses the ReplacingMergeTree to the latest row per grain.
  return (
    `SELECT ${chCols.join(", ")} FROM ${spec.chTable} FINAL ` +
    `WHERE dt BETWEEN toDate({from}) AND toDate({to})`
  );
}

function rowIsValid(spec: MirrorSpec, mapped: Record<string, string | number>): boolean {
  for (const col of spec.notNull) {
    const v = mapped[col];
    if (v === undefined || v === null || v === "") return false;
  }
  return true;
}

// Mirror ONE table. Own error containment: returns a result with `error` set,
// never throws (the caller aggregates).
async function mirrorOne(
  db: D1Database,
  client: ListicleChClient,
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
    console.error("[lst-mirror-sync] table failed", { mirror: spec.d1Table, error: msg.slice(0, 300) });
    return { table: spec.chTable, mirror: spec.d1Table, rows: 0, error: msg.slice(0, 300) };
  }
}

/**
 * Manual backfill: mirror every CH daily table for [from, to] (inclusive,
 * YYYY-MM-DD UTC). Each table is isolated. Fail-open on absent CH secrets.
 */
export async function rebuildRange(
  env: Env,
  from: string,
  to: string,
  opts?: SyncOptions,
): Promise<SyncSummary> {
  // Normalize/validate the window (swap if reversed).
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

  const client = opts?.client ?? createListicleChClient(env, opts);
  if (!client.configured) {
    console.log("[lst-mirror-sync] no-op: CH credentials absent", { from: lo, to: hi });
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
 * The every-minute cron entry (§18): mirror the bounded rolling window
 * today + yesterday (UTC). Never throws — the caller (index.ts) still wraps it.
 */
export async function syncListicleAnalytics(env: Env, opts?: SyncOptions): Promise<SyncSummary> {
  const now = opts?.now ?? new Date();
  const to = utcDate(now);
  const from = utcDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return rebuildRange(env, from, to, opts);
}

export interface ChIngestedCount {
  count: number | null;
  reason?: string;
}

/**
 * §31.6 reconciliation input: distinct CLEAN CH events for one UTC date
 * (uniqExact(event_id) — the idempotency key, dedup-correct without a costly
 * FINAL scan; §31.8 clean-only). NULL + reason when unconfigured / on error
 * (never a fake zero).
 */
export async function readChCleanEventCount(
  env: Env,
  date: string,
  opts?: SyncOptions,
): Promise<ChIngestedCount> {
  const client = opts?.client ?? createListicleChClient(env, opts);
  if (!client.configured) {
    return { count: null, reason: "CH credentials absent (CH_URL/CH_USER/CH_PASSWORD)" };
  }
  if (!DATE_RE.test(date)) return { count: null, reason: "invalid date (expected YYYY-MM-DD)" };
  try {
    const { rows } = await client.query<{ n: number | string }>(
      "SELECT uniqExact(event_id) AS n FROM lst_events_raw " +
        "WHERE dt = toDate({date}) AND traffic_quality_flag = 'clean'",
      { date },
    );
    const n = Number(rows[0]?.n ?? 0);
    return { count: Number.isFinite(n) ? n : 0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { count: null, reason: `CH query failed: ${msg.slice(0, 200)}` };
  }
}

function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}
