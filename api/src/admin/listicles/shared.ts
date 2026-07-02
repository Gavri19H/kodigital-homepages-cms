// Shared plumbing for the /api/admin/listicles/* JSON handlers.
//
// Envelope conventions (contract §7.1, matching the existing admin JSON API):
//   success  → the resource ({ offer }, { offers, paging }, …)
//   failure  → { error, fields? } with a 4xx status
// SQL: parameterized .bind() only; numeric defaults use ?? (never ||);
// IN(?) lists are chunked ≤ 80 binds (D1 100-binding limit).

import type { Context } from "hono";
import type { Env } from "../../env";

export type AdminContext = Context<{ Bindings: Env }>;

export interface Paging {
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
  has_prev: boolean;
}

// Mirrors the /api/admin/ai-generations pager: page >= 1, page_size 1-100
// (default 25).
export function parsePaging(c: AdminContext): { page: number; pageSize: number; offset: number } {
  const pageRaw = parseInt(c.req.query("page") ?? "1", 10);
  const sizeRaw = parseInt(c.req.query("page_size") ?? "25", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw > 0 && sizeRaw <= 100 ? sizeRaw : 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function buildPaging(page: number, pageSize: number, total: number): Paging {
  return {
    page,
    page_size: pageSize,
    total,
    has_next: (page - 1) * pageSize + pageSize < total,
    has_prev: page > 1,
  };
}

// Escape LIKE wildcards in user-supplied search text; every LIKE clause in
// this module pairs with ESCAPE '\'.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function readJsonBody(c: AdminContext): Promise<Record<string, unknown> | null> {
  try {
    const body = (await c.req.json()) as unknown;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// :id route params accept EITHER the internal numeric id (repo convention)
// or the stable public id (off_…/sec_…/art_…/ver_…/pg_… — what analytics and
// events carry), so admin tooling can deep-link from either identity.
export function idSelector(idParam: string): { column: "id" | "public_id"; value: number | string } | null {
  const trimmed = idParam.trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed)) {
    const id = parseInt(trimmed, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return { column: "id", value: id };
  }
  return { column: "public_id", value: trimmed };
}

// Split ids for IN(?) lists into ≤80-bind chunks (D1 100-binding limit).
export function chunk<T>(items: readonly T[], size = 80): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function placeholders(count: number): string {
  return new Array<string>(count).fill("?").join(",");
}

// ---------------------------------------------------------------------------
// Analytics date ranges (§18 ranged reads)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface DateRange {
  from: string;
  to: string;
}

// ?from&to (YYYY-MM-DD). Default window: the last 30 days (UTC) — an
// authored default; the admin UI always sends an explicit range.
export function parseDateRange(c: AdminContext): DateRange | { error: string } {
  const now = new Date();
  const defaultTo = utcDateString(now);
  const defaultFrom = utcDateString(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  const from = c.req.query("from") ?? defaultFrom;
  const to = c.req.query("to") ?? defaultTo;
  if (!DATE_RE.test(from)) return { error: "from must be YYYY-MM-DD" };
  if (!DATE_RE.test(to)) return { error: "to must be YYYY-MM-DD" };
  if (from > to) return { error: "from must be <= to" };
  return { from, to };
}

export interface MetricTotals {
  impressions: number;
  clicks: number;
  unique_clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;
  cvr: number;
  rpc: number;
  rpm: number;
}

interface MetricRow {
  impressions: number | null;
  clicks: number | null;
  unique_clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  ctr: number | null;
  cvr: number | null;
  rpc: number | null;
  rpm: number | null;
}

// The §18 ranged-sum read with NULLIF-guarded read-time ratios. An empty
// mirror yields a single all-NULL row — normalized to zeros, never a 500.
const METRIC_SELECT = `
  SUM(impressions) AS impressions, SUM(clicks) AS clicks,
  SUM(unique_clicks) AS unique_clicks, SUM(conversions) AS conversions,
  SUM(revenue) AS revenue,
  CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0) AS ctr,
  CAST(SUM(conversions) AS REAL) / NULLIF(SUM(clicks), 0) AS cvr,
  SUM(revenue) / NULLIF(SUM(clicks), 0) AS rpc,
  SUM(revenue) / NULLIF(SUM(impressions), 0) * 1000 AS rpm`;

export function normalizeMetricRow(row: MetricRow | null): MetricTotals {
  return {
    impressions: row?.impressions ?? 0,
    clicks: row?.clicks ?? 0,
    unique_clicks: row?.unique_clicks ?? 0,
    conversions: row?.conversions ?? 0,
    revenue: row?.revenue ?? 0,
    ctr: row?.ctr ?? 0,
    cvr: row?.cvr ?? 0,
    rpc: row?.rpc ?? 0,
    rpm: row?.rpm ?? 0,
  };
}

// Ranged entity metrics from one of the D1 mirror tables (§18). `table` and
// `keyColumn` are fixed literals supplied by the callers below — user input
// only ever travels through .bind().
export async function readEntityMetrics(
  db: D1Database,
  table: "listicle_analytics_offer" | "listicle_analytics_section",
  keyColumn: "offer_public_id" | "section_public_id",
  publicId: string,
  range: DateRange,
): Promise<MetricTotals> {
  const row = await db
    .prepare(
      `SELECT ${METRIC_SELECT} FROM ${table} WHERE ${keyColumn} = ? AND date BETWEEN ? AND ?`,
    )
    .bind(publicId, range.from, range.to)
    .first<MetricRow>();
  return normalizeMetricRow(row ?? null);
}

export { METRIC_SELECT };
