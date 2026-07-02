-- 0033_listicles_analytics_mirror.sql
-- Listicles CMS — five read-only D1 analytics mirror tables
-- (Design Contract v1.2.2 §6 "0032" + §30.7 link-instance mirror; shifted +1
-- because 0031_restore_subtitle_contract.sql already occupies the contract's
-- assumed slot — see docs/listicles/traceability.md).
-- Written ONLY by the ClickHouse→D1 mirror sync (§18); the CMS reads, never writes.

CREATE TABLE IF NOT EXISTS listicle_analytics_offer (
  offer_public_id TEXT NOT NULL, date TEXT NOT NULL,        -- 'YYYY-MM-DD'
  impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
  unique_clicks INTEGER NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0, synced_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (offer_public_id, date)
);

CREATE TABLE IF NOT EXISTS listicle_analytics_section (
  section_public_id TEXT NOT NULL, date TEXT NOT NULL,
  impressions INTEGER, clicks INTEGER, unique_clicks INTEGER, conversions INTEGER,
  revenue REAL, synced_at INTEGER,
  PRIMARY KEY (section_public_id, date)
);

CREATE TABLE IF NOT EXISTS listicle_analytics_article (
  article_public_id TEXT NOT NULL, article_version_id TEXT NOT NULL DEFAULT '',   -- per-version rows (== lander_v)
  article_version_revision INTEGER NOT NULL DEFAULT 1,     -- == version content_version
  article_experiment_id TEXT DEFAULT '', article_variant_label TEXT DEFAULT '',
  article_split_percentage INTEGER, date TEXT NOT NULL,
  total_visits INTEGER, unique_visits INTEGER, impressions INTEGER,
  clicks INTEGER, unique_clicks INTEGER, conversions INTEGER, revenue REAL,
  synced_at INTEGER,
  PRIMARY KEY (article_public_id, article_version_id, article_version_revision, date)
);                                                          -- pps = impressions/total_visits (read-time)

CREATE TABLE IF NOT EXISTS listicle_analytics_drilldown (
  article_public_id TEXT NOT NULL, article_version_id TEXT NOT NULL DEFAULT '',
  article_version_revision INTEGER NOT NULL DEFAULT 1,
  article_experiment_id TEXT DEFAULT '', article_split_percentage INTEGER,
  page_index INTEGER NOT NULL, page_selection_mode TEXT DEFAULT 'single',
  section_public_id TEXT NOT NULL, page_candidate_id TEXT NOT NULL,   -- section_variant_id = backward-compat alias
  ab_test_id TEXT, page_rule_set_id TEXT DEFAULT '', page_rule_id TEXT DEFAULT '', page_rule_priority INTEGER,
  selection_reason TEXT DEFAULT '', matched_rule_json_hash TEXT DEFAULT '',   -- read straight from events
  traffic_allocation INTEGER, date TEXT NOT NULL,
  impressions INTEGER, clicks INTEGER, unique_clicks INTEGER, conversions INTEGER,
  revenue REAL, visits INTEGER, matched_sessions INTEGER, fallback_sessions INTEGER, synced_at INTEGER,
  PRIMARY KEY (article_public_id, article_version_id, article_version_revision, page_index, page_candidate_id, date)
);
CREATE INDEX IF NOT EXISTS idx_lst_drill_article ON listicle_analytics_drilldown(article_public_id, article_version_id, date);

-- v1.2 per-CTA mirror (§30.7): conversions/revenue attributed to the exact
-- link/button placement; revision is part of the PK (v1.2.1).
CREATE TABLE IF NOT EXISTS listicle_analytics_link_instance (
  link_instance_id TEXT NOT NULL, section_public_id TEXT NOT NULL, offer_public_id TEXT NOT NULL,
  article_public_id TEXT NOT NULL, article_version_id TEXT NOT NULL, article_version_revision INTEGER NOT NULL DEFAULT 1,
  page_index INTEGER NOT NULL, page_candidate_id TEXT NOT NULL,
  page_selection_mode TEXT DEFAULT '', page_rule_id TEXT DEFAULT '', selection_reason TEXT DEFAULT '',
  section_block_id TEXT DEFAULT '', link_role TEXT NOT NULL, link_position_index INTEGER DEFAULT 0,
  button_style_id TEXT, button_group_id TEXT, anchor_text_hash TEXT DEFAULT '', analytics_label TEXT DEFAULT '', date TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
  unique_clicks INTEGER NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0, synced_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (link_instance_id, article_public_id, article_version_id, article_version_revision, page_index, page_candidate_id, date)
);
