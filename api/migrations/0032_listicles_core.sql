-- 0032_listicles_core.sql
-- Listicles CMS — core schema (Design Contract v1.2.2 §6 + §30.7).
-- Contract names this migration 0031; repo numbering moved past it when
-- 0031_restore_subtitle_contract.sql landed on main (PR #61), so the
-- listicles migrations ship as 0032/0033/0034. Mapping recorded in
-- docs/listicles/traceability.md.
-- Additive only: new listicle_-namespaced tables, zero changes to existing
-- tables/routes/caches.

-- GLOBAL: Offers (no site_id)
CREATE TABLE IF NOT EXISTS listicle_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                 -- {offer_id} macro + analytics key
  offer_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  activity TEXT NOT NULL,
  vertical TEXT NOT NULL,
  tag TEXT,
  conversion_tracking_method TEXT NOT NULL
    CHECK (conversion_tracking_method IN ('s2s_postback','browser_side_pixel','script')),
  offer_url_template TEXT NOT NULL,
  payout_method TEXT NOT NULL CHECK (payout_method IN ('in_site','offsite')),
  payout_currency TEXT,                            -- required iff in_site (app-validated)
  payout_value REAL,                               -- required iff in_site
  cap_enabled INTEGER NOT NULL DEFAULT 0,
  cap_amount INTEGER, cap_timezone TEXT,
  cap_count_by TEXT CHECK (cap_count_by IN ('clicks','conversions')),
  cap_fallback_offer_id INTEGER REFERENCES listicle_offers(id),  -- redirect target when capped
  cap_fallback_url TEXT,                           -- or a static fallback URL
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_listicle_offers_status   ON listicle_offers(status);
CREATE INDEX IF NOT EXISTS idx_listicle_offers_vertical ON listicle_offers(vertical, activity);

-- GLOBAL: Sections
CREATE TABLE IF NOT EXISTS listicle_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  section_name TEXT NOT NULL,
  headline_text TEXT NOT NULL,
  headline_offer_id INTEGER REFERENCES listicle_offers(id),   -- nullable; clickable headline
  image_json TEXT,                                 -- {type,media_id?,url?,ai_prompt?}
  content_json TEXT NOT NULL,                      -- block document
  content_html TEXT,
  ai_settings_json TEXT,
  content_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Derived attribution index (rebuilt on every Section save).
-- link_role CHECK carries the six v1.2 roles (§30.7 widens the v1.0 three).
CREATE TABLE IF NOT EXISTS listicle_section_offers (
  section_id INTEGER NOT NULL REFERENCES listicle_sections(id) ON DELETE CASCADE,
  offer_id   INTEGER NOT NULL REFERENCES listicle_offers(id),
  link_role  TEXT NOT NULL CHECK (link_role IN
    ('headline','inline','linked_image','button','choice_button','final_text_cta')),
  occurrences INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (section_id, offer_id, link_role)
);
CREATE INDEX IF NOT EXISTS idx_listicle_secoffers_offer ON listicle_section_offers(offer_id);

-- Per-placement governed link instances (§30.7). listicle_section_offers is a
-- derived summary rebuilt from these rows on Section save.
CREATE TABLE IF NOT EXISTS listicle_section_link_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,             -- == link_instance_id ("lnk_…")
  section_id INTEGER NOT NULL REFERENCES listicle_sections(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL REFERENCES listicle_offers(id),
  block_id TEXT NOT NULL,                     -- content_json block id ("__headline__" for headline links)
  link_role TEXT NOT NULL CHECK (link_role IN
    ('headline','inline','linked_image','button','choice_button','final_text_cta')),
  position_index INTEGER NOT NULL DEFAULT 0,
  anchor_text TEXT, anchor_text_hash TEXT,
  button_style_id TEXT, button_group_id TEXT, analytics_label TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_listicle_linkinst_section ON listicle_section_link_instances(section_id);
CREATE INDEX IF NOT EXISTS idx_listicle_linkinst_offer   ON listicle_section_link_instances(offer_id);

-- PER-SITE: Articles — STABLE BASE ONLY (identity + URL). Content lives on versions.
CREATE TABLE IF NOT EXISTS listicle_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  site_id TEXT NOT NULL,                            -- sites.id is TEXT (migration 0002) — §28 Q2 resolved
  slug TEXT NOT NULL,                               -- the public URL
  article_name TEXT NOT NULL,                       -- internal
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','scheduled','archived')),
  active_experiment_id INTEGER,                     -- 0..1 running article-level A/B
  published_at INTEGER, scheduled_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (site_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_listicle_articles_site ON listicle_articles(site_id, status, published_at);

-- Article-level A/B experiment (0..1 active per Article)
CREATE TABLE IF NOT EXISTS listicle_article_experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,             -- == article_experiment_id
  article_id INTEGER NOT NULL REFERENCES listicle_articles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','stopped')),
  started_at INTEGER, stopped_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Enforce at most ONE running experiment per Article (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_listicle_experiment_running
  ON listicle_article_experiments(article_id) WHERE status = 'running';

-- Article VERSIONS — the A/B'd whole-article content. public_id == lander_v.
CREATE TABLE IF NOT EXISTS listicle_article_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,             -- "ver_…" == lander_v == article_version_id
  article_id INTEGER NOT NULL REFERENCES listicle_articles(id) ON DELETE CASCADE,
  experiment_id INTEGER REFERENCES listicle_article_experiments(id) ON DELETE SET NULL,
  variant_label TEXT NOT NULL DEFAULT 'A',    -- article_variant_label
  is_control INTEGER NOT NULL DEFAULT 1,
  traffic_allocation INTEGER NOT NULL DEFAULT 100,  -- per-experiment Σ == 100
  headline TEXT NOT NULL,                     -- per-version public content
  intro_paragraph TEXT NOT NULL,
  hero_media_id INTEGER REFERENCES media(id), hero_media_url TEXT,
  layout_style_id TEXT NOT NULL DEFAULT 'default',
  byline_json TEXT,                            -- v1.2 ArticleVersionByline (§30.2): author/avatar/label/updated
  ai_settings_json TEXT,
  content_version INTEGER NOT NULL DEFAULT 1,  -- == article_version_revision; running versions IMMUTABLE →
                                               -- meaningful edits FORK a new version (new lander_v); part of cache key (§15.6)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_listicle_versions_article ON listicle_article_versions(article_id, status);

-- Pages (ordered positions inside a VERSION) + selection mode
CREATE TABLE IF NOT EXISTS listicle_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  article_version_id INTEGER NOT NULL REFERENCES listicle_article_versions(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  selection_mode TEXT NOT NULL DEFAULT 'single'
    CHECK (selection_mode IN ('single','ab_test','rule_based')),
  ab_test_id TEXT,                                 -- set when ab_test
  rule_set_id TEXT,                                -- set when rule_based (== page_rule_set_id)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (article_version_id, page_index)
);

-- Section CANDIDATES per Page (A/B variant OR rule target).
-- NB: candidates hold NO rule_id — rules FK to candidates, ONE direction only.
CREATE TABLE IF NOT EXISTS listicle_page_section_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,             -- == page_candidate_id (section_variant_id = backward-compat alias)
  page_id INTEGER NOT NULL REFERENCES listicle_pages(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES listicle_sections(id),
  label TEXT NOT NULL DEFAULT 'A',
  traffic_allocation INTEGER,                      -- ab_test only; per-page Σ == 100 (NULL otherwise)
  is_fallback INTEGER NOT NULL DEFAULT 0,          -- rule_based only: exactly one catch-all per page
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (page_id, section_id)
);
CREATE INDEX IF NOT EXISTS idx_listicle_cand_section ON listicle_page_section_candidates(section_id);

-- Rules for rule_based candidates (audience targeting + conflict guard source).
-- Fallback candidates have NO rule row (is_fallback lives on the candidate).
CREATE TABLE IF NOT EXISTS listicle_page_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,             -- == page_rule_id
  page_id INTEGER NOT NULL REFERENCES listicle_pages(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL UNIQUE REFERENCES listicle_page_section_candidates(id) ON DELETE CASCADE,  -- 1 rule per candidate; ONLY link direction
  priority INTEGER NOT NULL DEFAULT 100,       -- the only priority (rule-level)
  conditions_json TEXT NOT NULL,               -- typed: {"sets":{…},"ranges":{"hour":[s,e]}|"daypart":[…]} (§15.4)
  conditions_hash TEXT NOT NULL,               -- == matched_rule_json_hash in analytics
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_listicle_rules_page ON listicle_page_rules(page_id, priority);

-- Real-time Offer cap counters (§9) — resolver reads/increments synchronously
CREATE TABLE IF NOT EXISTS listicle_offer_cap_counters (
  offer_id INTEGER NOT NULL REFERENCES listicle_offers(id) ON DELETE CASCADE,
  cap_date TEXT NOT NULL,                          -- 'YYYY-MM-DD' in the offer's cap_timezone
  timezone TEXT NOT NULL,
  click_count INTEGER NOT NULL DEFAULT 0,
  conversion_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (offer_id, cap_date)
);
