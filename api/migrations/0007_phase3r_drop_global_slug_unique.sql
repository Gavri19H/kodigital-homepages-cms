-- 0007_phase3r_drop_global_slug_unique.sql
-- Phase 3 retry (MQAFIX-3) -- remove the legacy Phase-1 column-level
-- UNIQUE constraint from articles.slug and pages.slug so the per-site
-- (site_id, slug) UNIQUE indexes (idx_articles_site_slug_unique +
-- idx_pages_site_slug_unique, declared in 0002/0005) become the SOLE
-- slug uniqueness constraint on those two tables.
--
-- Why this rebuild is needed:
--   * Migration 0001 declared the slug column on articles and pages
--     as `TEXT NOT NULL`-with-an-inline-UNIQUE-keyword. That
--     column-level UNIQUE creates a hidden
--     sqlite_autoindex_articles_1 / sqlite_autoindex_pages_1
--     auto-index which enforces GLOBAL slug uniqueness across every
--     row in the table -- regardless of site_id. Two sites can no
--     longer independently hold the same slug (e.g. every site needs
--     its own "about" page, every site can have a "hello-world"
--     article), which is the wrong behaviour for the multi-tenant
--     Phase-3 design.
--   * Migrations 0002/0005 added the per-site composite UNIQUE indexes
--     (site_id, slug) on top of the legacy column-level UNIQUE so the
--     application boundary (assertSlugUniquePerSite in tenant-guards.ts)
--     could start enforcing tenant-scoped slug uniqueness. The legacy
--     auto-index was intentionally left in place at that point because
--     SQLite has no ALTER TABLE DROP CONSTRAINT and the column-level
--     UNIQUE cannot be removed in place.
--   * 0007 is that deferred follow-up: a CREATE-INSERT-DROP-RENAME
--     table rebuild (the same D1-safe pattern 0003 used to restructure
--     site_settings) that drops the legacy auto-index by dropping the
--     legacy table itself, then re-creates the per-site UNIQUE indexes
--     on the rebuilt tables so tenant-scoped slug uniqueness keeps
--     working.
--
-- D1 / SQLite mechanics:
--   * SQLite drops every index attached to a table when the table is
--     dropped, including the hidden sqlite_autoindex_*. The named
--     indexes the read paths rely on (idx_articles_*, idx_pages_*)
--     therefore need to be re-created against the rebuilt tables.
--   * D1 migrations run with foreign key enforcement off by default
--     (matching SQLite's `PRAGMA foreign_keys=OFF` default), so the
--     FKs that point AT articles(id) from article_versions(article_id)
--     and article_tags(article_id) are not enforced during the drop
--     -- the same way the existing 0003 CREATE-INSERT-DROP-RENAME on
--     site_settings worked without explicit PRAGMA toggling. Once the
--     rename completes, the same id PRIMARY KEY values are back in
--     place under the original table name, so existing referencing
--     rows remain logically consistent.

-- ==================================================================
-- ARTICLES -- rebuild without the column-level UNIQUE on slug
-- ==================================================================

-- 1) Target shape: identical column list to the post-0002 articles
--    table (15 Phase-1 columns + 6 Phase-3 ALTER columns) but slug is
--    declared `TEXT NOT NULL` (no inline UNIQUE keyword). All other
--    column types, NOT NULL flags, DEFAULTs, CHECK constraints, and
--    FK REFERENCES are preserved verbatim.
CREATE TABLE articles_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_html TEXT,
  category_id INTEGER REFERENCES categories(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','scheduled','archived')),
  published_at INTEGER,
  scheduled_at INTEGER,
  author_name TEXT,
  featured_image_id INTEGER REFERENCES media(id),
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_trending INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  site_id TEXT REFERENCES sites(id),
  homepage_section TEXT NOT NULL DEFAULT 'none',
  homepage_rank INTEGER,
  seo_title TEXT,
  seo_description TEXT,
  ai_generation_id TEXT REFERENCES ai_generations(id)
);

-- 2) Copy every row from the legacy articles table into the new
--    shape. The explicit column list (rather than `SELECT *`) makes
--    this migration robust against a future schema add that races
--    ahead of the rename.
INSERT INTO articles_new (
  id, slug, title, content_json, content_html, category_id, status,
  published_at, scheduled_at, author_name, featured_image_id,
  is_featured, is_trending, created_at, updated_at,
  site_id, homepage_section, homepage_rank, seo_title, seo_description,
  ai_generation_id
)
SELECT
  id, slug, title, content_json, content_html, category_id, status,
  published_at, scheduled_at, author_name, featured_image_id,
  is_featured, is_trending, created_at, updated_at,
  site_id, homepage_section, homepage_rank, seo_title, seo_description,
  ai_generation_id
FROM articles;

-- 3) Drop the legacy articles table. This also drops the hidden
--    sqlite_autoindex_articles_1 (from the legacy column-level UNIQUE
--    on slug) and every named index that was attached to the legacy
--    table -- idx_articles_status_published, idx_articles_category,
--    idx_articles_featured, idx_articles_trending,
--    idx_articles_site_status_pub,
--    idx_articles_site_category_status_pub,
--    idx_articles_site_featured, idx_articles_site_trending,
--    idx_articles_site_homepage_section, idx_articles_site_slug_unique
--    -- all of which are recreated against the new table below.
DROP TABLE articles;

-- 4) Rename the new table into place. After this statement the live
--    table name is `articles` and its slug column carries no global
--    UNIQUE constraint.
ALTER TABLE articles_new RENAME TO articles;

-- 5) Recreate every index that hung off the legacy articles table.
--    Phase-1 covering indexes (from 0001):
CREATE INDEX IF NOT EXISTS idx_articles_status_published ON articles(status, published_at);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id, status, published_at);
CREATE INDEX IF NOT EXISTS idx_articles_featured ON articles(is_featured);
CREATE INDEX IF NOT EXISTS idx_articles_trending ON articles(is_trending);
--    Phase-3 site-scoped covering indexes (from 0002):
CREATE INDEX IF NOT EXISTS idx_articles_site_status_pub ON articles(site_id, status, published_at);
CREATE INDEX IF NOT EXISTS idx_articles_site_category_status_pub ON articles(site_id, category_id, status, published_at);
CREATE INDEX IF NOT EXISTS idx_articles_site_featured ON articles(site_id, is_featured);
CREATE INDEX IF NOT EXISTS idx_articles_site_trending ON articles(site_id, is_trending);
CREATE INDEX IF NOT EXISTS idx_articles_site_homepage_section ON articles(site_id, homepage_section, homepage_rank);
--    Per-site UNIQUE -- the now-sole slug uniqueness constraint on
--    articles. Two sites can independently hold the same slug; a
--    duplicate (site_id, slug) collides via this index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_site_slug_unique ON articles(site_id, slug);

-- ==================================================================
-- PAGES -- rebuild without the column-level UNIQUE on slug
-- ==================================================================

-- 1) Target shape: identical column list to the post-0002 pages
--    table (10 Phase-1 columns + 3 Phase-3 ALTER columns) but slug is
--    `TEXT NOT NULL` (no inline UNIQUE keyword).
CREATE TABLE pages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_html TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  template TEXT NOT NULL DEFAULT 'default',
  show_in_footer INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  site_id TEXT REFERENCES sites(id),
  page_type TEXT NOT NULL DEFAULT 'generic',
  ai_generation_id TEXT REFERENCES ai_generations(id)
);

-- 2) Copy every row from the legacy pages table into the new shape.
INSERT INTO pages_new (
  id, slug, title, content_json, content_html, status, template,
  show_in_footer, created_at, updated_at,
  site_id, page_type, ai_generation_id
)
SELECT
  id, slug, title, content_json, content_html, status, template,
  show_in_footer, created_at, updated_at,
  site_id, page_type, ai_generation_id
FROM pages;

-- 3) Drop the legacy pages table. This also drops the hidden
--    sqlite_autoindex_pages_1 (from the legacy column-level UNIQUE
--    on slug) and the named indexes idx_pages_status,
--    idx_pages_site_slug, idx_pages_site_type, idx_pages_site_slug_unique
--    -- all of which are recreated against the new table below.
DROP TABLE pages;

-- 4) Rename the new table into place. After this statement the live
--    table name is `pages` and its slug column carries no global
--    UNIQUE constraint.
ALTER TABLE pages_new RENAME TO pages;

-- 5) Recreate every index that hung off the legacy pages table.
--    Phase-1 status covering index (from 0001):
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
--    Phase-3 site-scoped covering indexes (from 0002):
CREATE INDEX IF NOT EXISTS idx_pages_site_slug ON pages(site_id, slug);
CREATE INDEX IF NOT EXISTS idx_pages_site_type ON pages(site_id, page_type);
--    Per-site UNIQUE -- the now-sole slug uniqueness constraint on
--    pages. Two sites can independently hold the same slug
--    (every site gets its own "about", "privacy-policy", etc.);
--    a duplicate (site_id, slug) collides via this index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_site_slug_unique ON pages(site_id, slug);
