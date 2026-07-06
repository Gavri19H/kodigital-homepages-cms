-- 0037_leadgen_analytics_mirror.sql
-- LeadGen CMS v2.3.7 FINAL (APPROVED — READY TO BUILD) — 9 analytics mirrors — §7.5
-- Additive only. Renumber to head+1.. at build time.

CREATE TABLE IF NOT EXISTS leadgen_analytics_offer (
  offer_public_id TEXT NOT NULL, date TEXT NOT NULL,
  offer_impressions INTEGER NOT NULL DEFAULT 0,   -- deduped (auction_instance_id, offer_id) (§6.4)
  clicks INTEGER NOT NULL DEFAULT 0, unique_clicks INTEGER NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0, synced_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (offer_public_id, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_section (
  section_public_id TEXT NOT NULL, date TEXT NOT NULL,
  views INTEGER, clicks INTEGER, continued INTEGER, validation_errors INTEGER,
  default_applied INTEGER, user_confirmed_default INTEGER, user_selected INTEGER,
  time_on_section_ms_sum INTEGER, dropoffs INTEGER, synced_at INTEGER,
  PRIMARY KEY (section_public_id, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_answer_distribution (
  section_public_id TEXT NOT NULL, question_key TEXT NOT NULL, answer_value_normalized TEXT NOT NULL,
  answer_source TEXT NOT NULL DEFAULT 'user_selected' CHECK (answer_source IN ('default_applied','user_selected','user_confirmed_default')),
  date TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, continued_count INTEGER NOT NULL DEFAULT 0, synced_at INTEGER,
  PRIMARY KEY (section_public_id, question_key, answer_value_normalized, answer_source, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_quote (
  quote_public_id TEXT NOT NULL, funnel_id TEXT NOT NULL DEFAULT '', funnel_name TEXT DEFAULT '',
  funnel_variant_id TEXT DEFAULT '', funnel_ab_test_id TEXT DEFAULT '', variant_label TEXT DEFAULT '',
  site_id TEXT DEFAULT '', traffic_source TEXT DEFAULT '', date TEXT NOT NULL,
  visits INTEGER, unique_visits INTEGER, bounces INTEGER, completions INTEGER,
  clicks INTEGER, conversions INTEGER, unfilled INTEGER, revenue REAL, synced_at INTEGER,
  PRIMARY KEY (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_quote_drilldown (
  quote_public_id TEXT NOT NULL, funnel_id TEXT NOT NULL DEFAULT '', funnel_variant_id TEXT DEFAULT '',
  site_id TEXT DEFAULT '', traffic_source TEXT DEFAULT '', device TEXT DEFAULT '', state TEXT DEFAULT '',
  section_public_id TEXT DEFAULT '', section_index INTEGER, question_key TEXT DEFAULT '', answer_value_normalized TEXT DEFAULT '',
  date TEXT NOT NULL, views INTEGER, continued INTEGER, clicks INTEGER, conversions INTEGER, revenue REAL, synced_at INTEGER,
  PRIMARY KEY (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, device, state, section_public_id, question_key, answer_value_normalized, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_auction (
  auction_public_id TEXT NOT NULL, date TEXT NOT NULL,
  auctions INTEGER, filled_auctions INTEGER, unfilled_auctions INTEGER,   -- auctions = countDistinct(auction_instance_id)
  offer_impressions INTEGER, carrier_impressions INTEGER, carrier_clicks INTEGER,
  bid_value_sum REAL, eligible_bid_count INTEGER,
  timeouts INTEGER, below_floor INTEGER, malformed INTEGER, no_bid INTEGER, provider_errors INTEGER,
  latency_ms_sum INTEGER, revenue REAL, synced_at INTEGER,
  PRIMARY KEY (auction_public_id, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_auction_drilldown (
  auction_public_id TEXT NOT NULL, offer_public_id TEXT DEFAULT '', carrier_key TEXT DEFAULT '',
  device TEXT DEFAULT '', state TEXT DEFAULT '', date TEXT NOT NULL,
  offer_impressions INTEGER, carrier_impressions INTEGER, clicks INTEGER, conversions INTEGER, bid_value_sum REAL, revenue REAL,
  carrier_filtered_reason TEXT DEFAULT '', provider_error_reason TEXT DEFAULT '', auction_unfilled_reason TEXT DEFAULT '', synced_at INTEGER,
  PRIMARY KEY (auction_public_id, offer_public_id, carrier_key, device, state, carrier_filtered_reason, provider_error_reason, auction_unfilled_reason, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_carrier (
  auction_public_id TEXT NOT NULL, offer_public_id TEXT NOT NULL, carrier_key TEXT NOT NULL, carrier_name TEXT DEFAULT '', date TEXT NOT NULL,
  carrier_impressions INTEGER, clicks INTEGER, unique_clicks INTEGER, conversions INTEGER, bid_value_sum REAL, revenue REAL, synced_at INTEGER,
  PRIMARY KEY (auction_public_id, offer_public_id, carrier_key, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_provider_diagnostics (
  offer_public_id TEXT NOT NULL, auction_public_id TEXT DEFAULT '', date TEXT NOT NULL,
  requests INTEGER, responses INTEGER, timeouts INTEGER, errors INTEGER, no_bid INTEGER, below_floor INTEGER,
  latency_ms_sum INTEGER, provider_error_reason TEXT DEFAULT '', synced_at INTEGER,
  PRIMARY KEY (offer_public_id, auction_public_id, provider_error_reason, date)
);
