-- 0005_phase3_fix_missing_indexes.sql
-- HOTFIX after 0002 partial-apply failure on production D1.
--
-- 0002_phase3_multi_site_schema.sql aborted at the (mis-ordered)
--   CREATE INDEX IF NOT EXISTS idx_settings_site_key ON site_settings(site_id, key);
-- statement (site_settings still had the legacy (key, value) shape until 0003's
-- CREATE-INSERT-DROP-RENAME added site_id). When that index creation raised
-- "no such column: site_id", D1 stopped executing the rest of 0002, leaving
-- the next 7 statements unapplied:
--
--   - idx_domains_hostname             (public middleware hostname → site_id, T26)
--   - idx_site_categories_site_order   (Categories tab nav, public nav)
--   - idx_category_verticals_vertical  (New Site modal vertical → category seed, T19)
--   - idx_media_site                   (Media tab site filter, T25)
--   - idx_tags_site_slug               (Tags tab site filter + per-site slug lookup, T25)
--   - idx_articles_site_slug_unique    (T5 UNIQUE: per-site article slug uniqueness)
--   - idx_pages_site_slug_unique       (T5 UNIQUE: per-site page slug uniqueness)
--
-- The two UNIQUE indexes are correctness-bearing (T5 acceptance criterion);
-- the five non-unique indexes are read-path performance covering indexes.
-- 0002 has been patched in repo to remove the bad CREATE INDEX line (now
-- created in 0003 after the site_settings restructure), so a fresh-start
-- deploy applies 0002 cleanly and never reaches the partial state that
-- triggered this hotfix.
--
-- All statements use CREATE INDEX IF NOT EXISTS so this migration is safe
-- to re-apply on any D1 that may have managed to create a subset already
-- (e.g. local dev D1 where applies happened in a different order, or a
-- future fresh-start prod where 0002 already covered these).

-- ------------------------------------------------------------------
-- T26 — hostname → site_id resolution for the public middleware
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_domains_hostname ON domains(hostname);

-- ------------------------------------------------------------------
-- per-site category nav ordering (Categories tab / public nav)
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_site_categories_site_order ON site_categories(site_id, display_order);

-- ------------------------------------------------------------------
-- reverse lookup: list categories belonging to a vertical
-- (used by the New Site modal's vertical → category seeding step T19)
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_category_verticals_vertical ON category_verticals(vertical_id, display_order);

-- ------------------------------------------------------------------
-- media + tags filtered by site_id (Media tab / Tags tab — T25)
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_media_site ON media(site_id);
CREATE INDEX IF NOT EXISTS idx_tags_site_slug ON tags(site_id, slug);

-- ==================================================================
-- T5 — per-site UNIQUE slug constraints for articles and pages
-- ------------------------------------------------------------------
-- Correctness-bearing: without these, two sites can hold the same slug
-- at the SQLite layer (the legacy Phase-1 column-level UNIQUE is
-- different — it would conflict across sites, which is the wrong
-- behaviour for multi-tenant). The column-level UNIQUE removal is
-- deferred to a follow-up CREATE-INSERT-DROP-RENAME migration; until
-- then, these composite UNIQUE indexes enforce tenant-scoped slug
-- uniqueness at the application boundary.
-- ==================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_site_slug_unique ON articles(site_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_site_slug_unique ON pages(site_id, slug);
