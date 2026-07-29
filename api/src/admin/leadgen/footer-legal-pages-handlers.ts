// R2 P3 S3b — element J's Pages-fed legal-links picker (fix-contract §5.4
// item 2 / §7 D2). Read-only: the AUTHORING-time picker's data source for
// one REFERENCE site — the pages that site's own /admin/pages plane offers
// as legal-link candidates (page_type ∈ LEGAL_PAGE_TYPES and/or
// show_in_footer=1, non-archived — leadgen/branding.ts listPickableLegalPages,
// itself reusing pages-crud-handlers.ts's exported LEGAL_PAGE_TYPES so the
// two never drift apart).
//
// Resolution of a SAVED pick set against the SERVING site (which may differ
// from the reference site an operator authored against) happens at serve
// time in leadgen/branding.ts (resolvePickedLegalPageLinks) — this endpoint
// only powers the picker UI's candidate list; it is not part of the render
// path.
//
// Mounted under /api/admin/leadgen (router.ts) — same accessAuth gate as
// every other leadgen admin route.

import { listPickableLegalPages } from "../../leadgen/branding";
import type { AdminContext } from "./offers-handlers";

// GET /sites/:site_id/legal-pages — mirrors the existing
// GET /sites/:site_id/branding shape/precedent (frame-handlers.ts
// getSiteBrandingHandler): read-only, 404 on an unknown site_id.
export async function listSiteLegalPagesHandler(c: AdminContext): Promise<Response> {
  const siteId = (c.req.param("site_id") ?? "").trim();
  if (siteId === "") return c.json({ error: "Not Found" }, 404);

  const site = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ? LIMIT 1")
    .bind(siteId)
    .first<{ id: string }>();
  if (site === null || site === undefined) return c.json({ error: "Not Found" }, 404);

  const pages = await listPickableLegalPages(c.env.DB, siteId);
  return c.json({ site_id: siteId, pages });
}
