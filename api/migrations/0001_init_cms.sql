-- 0001_init_cms.sql
-- Phase 1 initial CMS schema for kodigital-homepages-cms (D1: kodigital-homepages-cms-db).
-- Multi-tenant scoping is intentionally deferred to Phase 2; every per-tenant
-- table is annotated with `TODO Phase 2: site_id` so the upcoming migration
-- knows where to add the discriminator column + composite indexes.

-- Order matters only for readability — SQLite does not enforce FK target
-- existence at CREATE TABLE time. We create dependency targets first.

-- TODO Phase 2: site_id (taxonomy is per-tenant)
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  featured_image_id INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  article_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- TODO Phase 2: site_id (media folder is per-tenant; storage_key stays global in R2)
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  alt_text TEXT,
  folder TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_media_folder ON media(folder);

-- TODO Phase 2: site_id (single-tenant rows in Phase 1)
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
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
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_articles_status_published ON articles(status, published_at);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id, status, published_at);
CREATE INDEX IF NOT EXISTS idx_articles_featured ON articles(is_featured);
CREATE INDEX IF NOT EXISTS idx_articles_trending ON articles(is_trending);

-- TODO Phase 2: site_id (revision history scoped per tenant via parent article)
CREATE TABLE IF NOT EXISTS article_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT,
  change_summary TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(article_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_article_versions_article ON article_versions(article_id);

-- TODO Phase 2: site_id (tags scoped per tenant)
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  article_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS article_tags (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag_id);

-- TODO Phase 2: site_id (pages live per tenant)
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_html TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  template TEXT NOT NULL DEFAULT 'default',
  show_in_footer INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);

-- TODO Phase 2: site_id (redirects scoped per tenant host)
CREATE TABLE IF NOT EXISTS redirects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL UNIQUE,
  destination_path TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 301 CHECK (status_code IN (301,302)),
  is_active INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0
);

-- TODO Phase 2: site_id (settings stored per tenant)
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- TODO Phase 2: site_id (prompt presets scoped per tenant)
CREATE TABLE IF NOT EXISTS prompt_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  prompt_template TEXT NOT NULL,
  category TEXT,
  variables TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0
);

-- TODO Phase 2: site_id (opt-out hash bound to tenant cookie domain)
CREATE TABLE IF NOT EXISTS privacy_opt_outs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier_hash TEXT NOT NULL UNIQUE,
  opted_out INTEGER NOT NULL DEFAULT 1,
  ip_country TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
