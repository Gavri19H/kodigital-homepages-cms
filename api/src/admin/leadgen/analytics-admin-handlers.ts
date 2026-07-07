// LeadGen §24 analytics admin handler:
//   * POST /api/admin/leadgen/analytics/rebuild-range — manual CH→D1 backfill
//
// Mounts under /api/admin/leadgen/* → already behind the Cloudflare Access gate
// + the index.ts ADMIN_HOST 404 wall (03 §8.1), same as every other leadgen
// admin route. The every-minute cron (index.ts scheduled → syncLeadgenAnalytics)
// syncs a bounded rolling window; this endpoint runs an explicit [from,to]
// window for a wider manual backfill (§24) and returns the structured per-mirror
// summary. `configured:false` (no CH secrets) is an honest no-op result the
// operator can see — never a 5xx.

import type { AdminContext } from "./offers-handlers";
import { rebuildLeadgenAnalyticsRange } from "../../leadgen/mirror-sync";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Bounded like the listicles backfill (cost control per §23/§24): the manual
// window may be wider than the cron's rolling window, but never unbounded.
const MAX_RANGE_DAYS = 400;

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

// POST /api/admin/leadgen/analytics/rebuild-range  { from, to }
// Runs the §24 CH→D1 mirror sync over an explicit [from,to] window and returns
// the structured summary (rows per mirror + isolated per-table errors).
export async function rebuildLeadgenAnalyticsRangeHandler(c: AdminContext): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { from, to } = body as { from?: unknown; to?: unknown };
  if (typeof from !== "string" || !DATE_RE.test(from)) {
    return c.json({ error: "Validation failed", fields: { from: "from must be YYYY-MM-DD" } }, 400);
  }
  if (typeof to !== "string" || !DATE_RE.test(to)) {
    return c.json({ error: "Validation failed", fields: { to: "to must be YYYY-MM-DD" } }, 400);
  }
  if (from > to) {
    return c.json({ error: "Validation failed", fields: { range: "from must be <= to" } }, 400);
  }
  if (dayDiff(from, to) > MAX_RANGE_DAYS) {
    return c.json(
      { error: "Validation failed", fields: { range: `range exceeds ${MAX_RANGE_DAYS} days` } },
      400,
    );
  }

  const summary = await rebuildLeadgenAnalyticsRange(c.env, from, to);
  // 200 with the honest summary — configured:false (no CH secrets) is a valid
  // no-op result the operator can see, not a 5xx.
  return c.json({ rebuild: summary });
}
