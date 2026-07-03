// Phase-8 analytics admin handlers:
//   * POST /api/admin/listicles/analytics/rebuild-range  — manual §18 backfill
//   * GET  /api/admin/listicles/articles/:id/link-instances — §30.7 per-CTA read
//
// Both mount under /api/admin/listicles/* → already behind the Cloudflare
// Access gate + the ADMIN_HOST 404 wall (§24), same as every other listicles
// admin route. The rebuild endpoint is the deliverable for manual backfill;
// the link-instance read lights up the §30.7 mirror the Phase-2 endpoints did
// not yet surface ("compare performance by exact CTA/link placement", §30.9).

import type { AdminContext } from "./shared";
import { parseDateRange } from "./shared";
import { resolveArticleRow } from "./articles-handlers";
import { rebuildRange } from "../../listicles/mirror-sync";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Guard: the manual backfill may go wider than the 2-day cron window, but not
// unbounded (cost control per §18 / docs/storage-cost-model.md).
const MAX_RANGE_DAYS = 400;

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

// POST /api/admin/listicles/analytics/rebuild-range  { from, to }
// Runs the §18 CH→D1 mirror sync over an explicit [from,to] window and returns
// the structured summary (rows per mirror + isolated per-table errors).
export async function rebuildAnalyticsRangeHandler(c: AdminContext): Promise<Response> {
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

  const summary = await rebuildRange(c.env, from, to);
  // 200 with the honest summary — configured:false (no CH secrets) is a valid
  // no-op result the operator can see, not a 5xx.
  return c.json({ rebuild: summary });
}

interface LinkInstanceRow {
  link_instance_id: string;
  section_public_id: string;
  offer_public_id: string;
  article_version_id: string;
  article_version_revision: number;
  page_index: number;
  page_candidate_id: string;
  link_role: string;
  section_block_id: string | null;
  link_position_index: number | null;
  button_style_id: string | null;
  button_group_id: string | null;
  analytics_label: string | null;
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

// GET /api/admin/listicles/articles/:id/link-instances?from&to
// The §30.7 per-CTA breakdown: which exact link/button placement drove
// clicks/conversions/revenue, with read-time NULLIF ratios. Empty mirror ⇒
// empty list, never a 500.
export async function articleLinkInstancesHandler(c: AdminContext): Promise<Response> {
  const article = await resolveArticleRow(c.env.DB, c.req.param("id") ?? "");
  if (article === null) return c.json({ error: "Not Found" }, 404);
  const range = parseDateRange(c);
  if ("error" in range) {
    return c.json({ error: "Validation failed", fields: { range: range.error } }, 400);
  }

  const rows = await c.env.DB.prepare(
    `SELECT link_instance_id, section_public_id, offer_public_id,
            article_version_id, article_version_revision, page_index, page_candidate_id,
            link_role, section_block_id, link_position_index,
            button_style_id, button_group_id, analytics_label,
            SUM(impressions) AS impressions, SUM(clicks) AS clicks,
            SUM(unique_clicks) AS unique_clicks, SUM(conversions) AS conversions,
            SUM(revenue) AS revenue,
            CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0) AS ctr,
            CAST(SUM(conversions) AS REAL) / NULLIF(SUM(clicks), 0) AS cvr,
            SUM(revenue) / NULLIF(SUM(clicks), 0) AS rpc,
            SUM(revenue) / NULLIF(SUM(impressions), 0) * 1000 AS rpm
     FROM listicle_analytics_link_instance
     WHERE article_public_id = ? AND date BETWEEN ? AND ?
     GROUP BY link_instance_id, section_public_id, offer_public_id,
              article_version_id, article_version_revision, page_index, page_candidate_id,
              link_role, section_block_id, link_position_index,
              button_style_id, button_group_id, analytics_label
     ORDER BY SUM(revenue) DESC, SUM(clicks) DESC, link_instance_id ASC`,
  )
    .bind(article.public_id, range.from, range.to)
    .all<LinkInstanceRow>();

  const link_instances = (rows.results ?? []).map((r) => ({
    link_instance_id: r.link_instance_id,
    section_public_id: r.section_public_id,
    offer_public_id: r.offer_public_id,
    article_version_id: r.article_version_id,
    article_version_revision: r.article_version_revision,
    page_index: r.page_index,
    page_candidate_id: r.page_candidate_id,
    link_role: r.link_role,
    section_block_id: r.section_block_id ?? "",
    link_position_index: r.link_position_index ?? 0,
    button_style_id: r.button_style_id ?? "",
    button_group_id: r.button_group_id ?? "",
    analytics_label: r.analytics_label ?? "",
    impressions: r.impressions ?? 0,
    clicks: r.clicks ?? 0,
    unique_clicks: r.unique_clicks ?? 0,
    conversions: r.conversions ?? 0,
    revenue: r.revenue ?? 0,
    ctr: r.ctr ?? 0,
    cvr: r.cvr ?? 0,
    rpc: r.rpc ?? 0,
    rpm: r.rpm ?? 0,
  }));

  return c.json({ link_instances: { from: range.from, to: range.to, items: link_instances } });
}
