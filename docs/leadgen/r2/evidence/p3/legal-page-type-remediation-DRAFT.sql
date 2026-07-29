-- =====================================================================
-- DRAFT — AWAITING OWNER APPROVAL. DO NOT EXECUTE AGAINST PRODUCTION.
-- =====================================================================
-- This file is a DRAFT remediation proposal written by the R2 P3
-- flake-fix slice. It has NOT been run anywhere except a local dev D1
-- (see "MEASURED LOCALLY" below). Rows already typed 'legal' in
-- production are PRODUCTION DATA; retyping them is a migration and an
-- OWNER decision. Nothing here has been, or may be, executed with
-- --remote by an implementer.
--
-- WHY THIS EXISTS
--   api/src/site-provisioning/legal-renderer.ts used to insert EVERY
--   provisioned legal page with the literal page_type 'legal':
--       VALUES (?, ?, ?, ?, ?, 'published', 'legal', 1, 'legal')
--   even though api/src/admin/pages-crud-handlers.ts already exports the
--   vocabulary that tells the four canonical legal pages apart
--   (privacy-policy, terms, do-not-sell, contact — PAGE_TYPE_VALUES:46 /
--   LEGAL_PAGE_TYPES:59). With all four provisioned rows in ONE bucket,
--   api/src/leadgen/branding.ts resolvePickedLegalPageLinks's page_type
--   fallback leg (first-wins by show_in_footer DESC, display_order ASC,
--   id ASC) served whichever row was inserted FIRST to every pick that
--   reached it — four distinct operator picks all serving
--   /privacy-policy. Legal links are a compliance surface
--   (SOURCE-OF-TRUTH.md A.2: "links to legal pages (from the 'pages'
--   tab) that the user is choosing").
--
-- THE CODE FIX IS ALREADY IN (this file is only for EXISTING rows)
--   legal-renderer.ts now binds page_type per page via
--   legalPageTypeForSlug(slug) (canonical slug -> its own type, anything
--   else -> 'legal'). The statement's ON CONFLICT(site_id, slug) DO
--   UPDATE SET ... page_type = excluded.page_type clause means any site
--   that is provisioned AGAIN self-heals with no SQL at all: the upsert
--   rewrites the stale row in place (proved locally by
--   api/test/leadgen-p3-provisioning-legal-page-type.test.ts, "a site
--   already carrying the stale 'legal' rows SELF-HEALS on its next
--   provisioning run (same row ids, ON CONFLICT DO UPDATE)").
--   So the owner's real choice is:
--     (a) do nothing — sites self-heal on their next provisioning run;
--     (b) re-run provisioning for the affected sites (no SQL);
--     (c) run this backfill once, to fix them without re-provisioning.
--
-- BLAST RADIUS / SAFETY
--   * every statement is idempotent (re-running changes 0 rows);
--   * SCOPE A (default, below) touches ONLY rows the provisioner itself
--     wrote: template = 'legal' AND the renderer's own content_json
--     marker ('"kind":"legal_template_rendered"'). Operator-authored
--     pages are NOT touched;
--   * site_id IS NOT NULL keeps GLOBAL legal templates (site_id NULL)
--     out of scope — pages-crud-handlers.ts allows those to be 'legal';
--   * page_type has no CHECK constraint (migration 0002:255 adds it as
--     TEXT NOT NULL DEFAULT 'generic'), and all four target values are
--     already in PAGE_TYPE_VALUES, so no constraint work is needed;
--   * no row is inserted or deleted — UPDATE only;
--   * pages(site_id, slug) is UNIQUE (0007 idx_pages_site_slug_unique),
--     so each statement below touches at most one row per site.
--
-- HOW TO PREVIEW BEFORE WRITING (run the SELECTs first, per environment)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. PREFLIGHT — how many rows each statement would touch. Read-only.
-- ---------------------------------------------------------------------
SELECT slug,
       COUNT(*) AS rows_to_retype
  FROM pages
 WHERE site_id IS NOT NULL
   AND page_type = 'legal'
   AND template = 'legal'
   AND content_json LIKE '%"kind":"legal_template_rendered"%'
   AND slug IN ('privacy-policy', 'terms', 'do-not-sell', 'contact')
 GROUP BY slug
 ORDER BY slug;

-- Sites that currently hold MORE THAN ONE published 'legal' row (the
-- ambiguity the resolver's fallback leg cannot resolve). This count is
-- what the remediation is meant to drive down.
SELECT site_id,
       COUNT(*) AS published_legal_rows
  FROM pages
 WHERE site_id IS NOT NULL
   AND page_type = 'legal'
   AND status = 'published'
 GROUP BY site_id
HAVING COUNT(*) > 1
 ORDER BY published_legal_rows DESC;

-- ---------------------------------------------------------------------
-- 1. SCOPE A (RECOMMENDED) — retype ONLY provisioner-written rows.
--    Idempotent: the WHERE clause excludes rows already retyped.
-- ---------------------------------------------------------------------
UPDATE pages
   SET page_type = 'privacy-policy',
       updated_at = unixepoch()
 WHERE site_id IS NOT NULL
   AND slug = 'privacy-policy'
   AND page_type = 'legal'
   AND template = 'legal'
   AND content_json LIKE '%"kind":"legal_template_rendered"%';

UPDATE pages
   SET page_type = 'terms',
       updated_at = unixepoch()
 WHERE site_id IS NOT NULL
   AND slug = 'terms'
   AND page_type = 'legal'
   AND template = 'legal'
   AND content_json LIKE '%"kind":"legal_template_rendered"%';

UPDATE pages
   SET page_type = 'do-not-sell',
       updated_at = unixepoch()
 WHERE site_id IS NOT NULL
   AND slug = 'do-not-sell'
   AND page_type = 'legal'
   AND template = 'legal'
   AND content_json LIKE '%"kind":"legal_template_rendered"%';

UPDATE pages
   SET page_type = 'contact',
       updated_at = unixepoch()
 WHERE site_id IS NOT NULL
   AND slug = 'contact'
   AND page_type = 'legal'
   AND template = 'legal'
   AND content_json LIKE '%"kind":"legal_template_rendered"%';

-- ---------------------------------------------------------------------
-- 2. SCOPE B (OWNER DECISION, NOT RECOMMENDED BY DEFAULT) — also retype
--    operator-authored pages that happen to use a canonical slug with
--    page_type 'legal'. Left COMMENTED OUT: it edits pages a human
--    authored, which is a different consent question from repairing the
--    provisioner's own output.
-- ---------------------------------------------------------------------
-- UPDATE pages
--    SET page_type = slug,
--        updated_at = unixepoch()
--  WHERE site_id IS NOT NULL
--    AND page_type = 'legal'
--    AND slug IN ('privacy-policy', 'terms', 'do-not-sell', 'contact');

-- ---------------------------------------------------------------------
-- 3. POST-CHECK — after SCOPE A, this must return ZERO rows.
-- ---------------------------------------------------------------------
SELECT id, site_id, slug, page_type
  FROM pages
 WHERE site_id IS NOT NULL
   AND page_type = 'legal'
   AND template = 'legal'
   AND content_json LIKE '%"kind":"legal_template_rendered"%'
   AND slug IN ('privacy-policy', 'terms', 'do-not-sell', 'contact')
 ORDER BY site_id, slug;

-- ---------------------------------------------------------------------
-- 4. ROLLBACK (returns the provisioned rows to their pre-remediation
--    page_type). Same scope predicate, reversed target.
-- ---------------------------------------------------------------------
-- UPDATE pages
--    SET page_type = 'legal',
--        updated_at = unixepoch()
--  WHERE site_id IS NOT NULL
--    AND template = 'legal'
--    AND content_json LIKE '%"kind":"legal_template_rendered"%'
--    AND page_type IN ('privacy-policy', 'terms', 'do-not-sell', 'contact');

-- =====================================================================
-- MEASURED LOCALLY (dev D1 only — .wrangler/state/v3/d1, never --remote)
-- =====================================================================
-- Environment: this worktree's dev D1
--   (api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite) after
--   `npm run db:reset:local` + the R2 P3 footer gesture spec on both
--   engines. Measurement ran against a `.backup` COPY of that file in the
--   session scratchpad, never against production, never with --remote.
--
-- Local state as found (fix already in the code, so the provisioner had
-- already written canonical types through the real product):
--   provisioned legal rows (template='legal' + the renderer's
--   content_json marker)                                  = 48
--   of which still page_type='legal'                      =  0
--
-- To exercise this file, the copy was put BACK into the pre-fix shape
-- (all 48 provisioned rows set to page_type='legal'), then this file was
-- executed verbatim with sqlite3:
--   PREFLIGHT (section 0), rows each statement would touch:
--     contact        -> 12
--     do-not-sell    -> 12
--     privacy-policy -> 12
--     terms          -> 12   (48 rows total, across 12 local sites)
--   sites holding >1 published 'legal' row, before        = 12
--   after SCOPE A                                         =  8
--     (the 8 remaining are the gesture spec's own operator-authored
--      'legal' pages — deliberately OUT of SCOPE A, see SCOPE B)
--   provisioned rows now canonically typed                = 48
--   provisioned rows still 'legal'                        =  0
--   section 3 POST-CHECK                                  =  0 rows
--   IDEMPOTENCE: the whole file re-executed, then one SCOPE A statement
--     re-run on its own -> changes() = 0
--
-- On THIS local data SCOPE A would touch 48 rows across 12 sites. The
-- production number is unknown to this slice and MUST be re-measured with
-- section 0 by whoever the owner authorises to run it.
