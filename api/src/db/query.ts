// D1 query wrapper that captures D1Result.meta cost + region metadata for
// kodigital-homepages-cms Phase-7 SEO cost-observability stories.
//
// Cloudflare D1 returns a D1Meta block on every prepared-statement execution:
//   { duration, rows_read, rows_written, last_row_id, changes,
//     served_by_region?, served_by_colo?, served_by_primary?, ... }
//
// The Phase-7 cost-estimate + db:explain-* stories need a single typed entry
// point that surfaces ONLY the fields we care about (rows_read, rows_written,
// duration, served_by_region) so callers can log per-route cost without
// re-shaping the raw D1Meta object at every call site.
//
// SQL discipline (same as src/db/index.ts): every query is built with
// `db.prepare(<static SQL>).bind(...)` — NO template-literal interpolation.
// The convenience overload queryWithMetrics(db, sql, ...bindArgs) enforces
// the prepare→bind shape so callers cannot drift into f-string SQL.

// Public, narrow projection of D1Meta. We intentionally do NOT re-export the
// full D1Meta interface so callers cannot accidentally couple to the
// less-stable served_by_primary / changed_db / timings fields.
export interface D1QueryMetrics {
  rows_read: number;
  rows_written: number;
  duration: number;
  served_by_region?: string;
}

export interface D1QueryResult<T = unknown> {
  results: T[];
  meta: D1QueryMetrics;
}

// Pure helper: normalize a raw D1Meta object (or undefined/null) into our
// typed D1QueryMetrics shape. Defaults rows_read / rows_written / duration to
// 0 when the meta block is missing or partial — keeps cost-aggregation math
// safe for callers that sum metrics across many queries.
export function extractMetrics(meta: D1Meta | undefined | null): D1QueryMetrics {
  const m = (meta ?? {}) as Partial<{
    rows_read: number;
    rows_written: number;
    duration: number;
    served_by_region: string;
  }>;
  const out: D1QueryMetrics = {
    rows_read: typeof m.rows_read === "number" ? m.rows_read : 0,
    rows_written: typeof m.rows_written === "number" ? m.rows_written : 0,
    duration: typeof m.duration === "number" ? m.duration : 0,
  };
  if (typeof m.served_by_region === "string" && m.served_by_region.length > 0) {
    out.served_by_region = m.served_by_region;
  }
  return out;
}

// Primary entry point: run prepared.all() and return rows + metrics.
//
// We use D1PreparedStatement.all() (rather than .first() or .run()) so we
// always get back the full results array + meta block. For SELECT-with-single-
// row patterns the caller can read results[0]; for SELECT-with-many-rows the
// caller iterates results. INSERT/UPDATE/DELETE callers should prefer
// .run() directly — this wrapper is the canonical SELECT-from-D1 path.
export async function executeWithMetrics<T = unknown>(
  stmt: D1PreparedStatement,
): Promise<D1QueryResult<T>> {
  const result = await stmt.all<T>();
  const meta = extractMetrics(result.meta as D1Meta | undefined);
  return { results: (result.results ?? []) as T[], meta };
}

// Convenience overload: prepare + bind + execute in one call. Callers pass a
// static SQL string + positional bind args (NEVER string-interpolated). The
// SQL argument is passed through verbatim — any interpolation would have to
// happen at the call site, which the codebase-wide D1 audit catches.
export async function queryWithMetrics<T = unknown>(
  db: D1Database,
  sql: string,
  ...bindArgs: unknown[]
): Promise<D1QueryResult<T>> {
  const prepared = db.prepare(sql).bind(...bindArgs);
  return executeWithMetrics<T>(prepared);
}
