/**
 * Typed filter builder for dynamic WHERE clauses.
 * Pure function — errors propagate to caller's existing error handler.
 * Ported from the legacy admin. Clause fragments are FIXED literals with
 * ? placeholders; user values only ever travel through params/.bind().
 */

export interface FilterCondition {
  /** Whether to include this condition */
  when: boolean;
  /** SQL clause fragment with ? placeholders (e.g., 'status = ?' or 'is_active = 1') */
  clause: string;
  /** Bind parameters for ? placeholders in this clause */
  params: (string | number)[];
}

/**
 * Build a WHERE clause from an array of filter conditions.
 * Only includes conditions where `when` is true.
 * Returns the combined clause string and flat params array.
 */
export function buildWhereClause(
  filters: FilterCondition[]
): { clause: string; params: (string | number)[] } {
  const active = filters.filter((f) => f.when);
  if (active.length === 0) {
    return { clause: "1=1", params: [] };
  }
  const clause = active.map((f) => f.clause).join(" AND ");
  const params = active.flatMap((f) => f.params);
  return { clause, params };
}
