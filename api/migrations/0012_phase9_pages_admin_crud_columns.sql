-- T29 ([B8] Pages port + CRUD): admin pages CRUD columns.
--
-- The ported admin Pages form and the JSON CRUD endpoints
-- (POST /api/admin/pages, PATCH /api/admin/pages/:id) read and write
-- three columns the post-0007 pages table does not have:
--
--   * display_order   -- footer/listing sort key. The legacy admin pages
--                        list orders by display_order ASC and the legacy
--                        form exposes a "Display Order" input; the T29
--                        contract requires a show_in_footer/display_order
--                        round-trip through the new endpoints.
--   * seo_title       -- already SELECTed by admin/data.ts getAdminPage
--                        (the page edit form's SEO card), so the column
--                        must exist for the edit route to work against a
--                        real database.
--   * seo_description -- same as seo_title.
--
-- Plain ALTER TABLE ... ADD COLUMN with constant defaults: no CHECK or
-- UNIQUE changes, so no table recreation is needed (contrast 0007).
-- Existing rows get display_order=0 (the legacy default) and NULL SEO
-- fields.

ALTER TABLE pages ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pages ADD COLUMN seo_title TEXT;
ALTER TABLE pages ADD COLUMN seo_description TEXT;
