-- 0067_articles_vertical.sql
-- X01 Part C (owner, 22 Nov 2026): an Article can have its own vertical.
--
--   articles.vertical_id
--       NULL  = "Same as site": the Article uses its Site's vertical
--               (sites.vertical_slug). Every existing Article keeps NULL, so
--               nothing changes for them and no backfill is needed (the plan
--               forbids filling it on live Articles with a script).
--       N     = the Article's own vertical (verticals.id). The admin's
--               "Vertical" field and the Articles "Set vertical" action write
--               it; the AI writer's {{vertical}} and the Articles "All
--               verticals" filter read it first, then fall back to the Site's.
--
-- No ON DELETE rule: DELETE /api/admin/verticals/:id refuses while any Article
-- (or Site) still uses the vertical, so a dangling id cannot be made.
-- Plain additive ADD COLUMN (nullable, no default), safe on D1/SQLite; the D1
-- migration ledger applies it exactly once.

ALTER TABLE articles ADD COLUMN vertical_id INTEGER REFERENCES verticals(id);

-- The Verticals screen's "in use" count, the delete guard and the Articles
-- vertical filter all look Articles up by vertical_id.
CREATE INDEX IF NOT EXISTS idx_articles_vertical_id ON articles(vertical_id);
