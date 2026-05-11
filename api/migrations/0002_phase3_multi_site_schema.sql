-- 0002_phase3_multi_site_schema.sql
-- Phase 3 — multi-site core tables for kodigital-homepages-cms (D1: kodigital-homepages-cms-db).
-- Adds the 10 tables that turn the Phase 1/1.5 single-site CMS into a multi-tenant
-- CMS: sites + domains + verticals + per-site categorisation, legal templates,
-- the 15-step provisioning job log, AI generation receipts, and a cache-purge
-- audit table that records every CF mutation (real or dry-run).
--
-- Order matters because some tables FK-reference others created later in the
-- same migration — verticals → sites → domains/site_creation_jobs → child
-- tables. SQLite parses FKs at CREATE TABLE time but only enforces them at
-- INSERT time, so forward references are tolerated within a single migration
-- file as long as the target table exists by the time data lands.

-- ------------------------------------------------------------------
-- verticals — global lookup of editorial verticals (8 rows seeded in 0004)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verticals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ------------------------------------------------------------------
-- sites — root tenant record. id is a short opaque string (e.g. 'st_abcdef')
-- so tenant IDs are URL-stable across environments and survive a re-seed.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  vertical_slug TEXT NOT NULL REFERENCES verticals(slug),
  activity TEXT NOT NULL DEFAULT 'main' CHECK (activity IN ('main')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','provisioning','active','disabled','failed')),
  settings_version INTEGER NOT NULL DEFAULT 1,
  last_provisioned_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ------------------------------------------------------------------
-- domains — hostnames attached to a site (1 canonical + N aliases).
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'canonical' CHECK (kind IN ('canonical','alias')),
  is_primary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled','failed')),
  ssl_status TEXT,
  cf_route_id TEXT,
  attached_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ------------------------------------------------------------------
-- category_verticals — many-to-many between categories and verticals so a
-- single category (e.g. "Healthy Meals") can surface across health+food+parenting.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS category_verticals (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  vertical_id INTEGER NOT NULL REFERENCES verticals(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, vertical_id)
);

-- ------------------------------------------------------------------
-- site_categories — per-site allocation of categories (filtered by the
-- vertical(s) selected at site creation time).
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_categories (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, category_id)
);

-- ------------------------------------------------------------------
-- legal_templates — global, mustache-style templates rendered per-site
-- during provisioning (privacy-policy, terms, do-not-sell, contact).
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content_html TEXT,
  content_json TEXT,
  content_md TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  effective_date INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ------------------------------------------------------------------
-- site_creation_jobs — the durable record that drives the 15-step
-- provisioning runner. idempotency_key prevents double-submit from the
-- New Site modal.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_creation_jobs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  current_step TEXT,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 15,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ------------------------------------------------------------------
-- site_creation_job_steps — per-step execution log (one row per step_key
-- per job; attempt_count increments on retry).
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_creation_job_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES site_creation_jobs(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','completed_dry_run','failed','skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  input TEXT,
  output TEXT,
  error TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(job_id, step_key)
);

-- ------------------------------------------------------------------
-- ai_generations — receipts for every generated text/image/logo asset.
-- Phase 3 only emits 'stub' rows (no real OpenAI traffic); the table is
-- in place so Phase 4 can swap stubs for real generations without a
-- schema migration.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text','image','logo')),
  model TEXT,
  prompt TEXT,
  response TEXT,
  status TEXT NOT NULL DEFAULT 'stub' CHECK (status IN ('stub','completed','failed')),
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ------------------------------------------------------------------
-- cache_purge_log — every cache-mutation attempt (real OR dry-run). The
-- dry_run + allow_route_mutation flags are persisted so a postmortem can
-- prove no real CF call escaped during a dry-run iteration.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cache_purge_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
  hostname TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','completed','completed_dry_run','failed')),
  dry_run INTEGER NOT NULL DEFAULT 1,
  allow_route_mutation INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  response TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
