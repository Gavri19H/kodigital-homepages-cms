-- 0038_leadgen_revenue_infra.sql
-- LeadGen CMS v2.3.7 FINAL (APPROVED — READY TO BUILD) — revenue infra — §7.6
-- Additive only. Renumber to head+1.. at build time.

CREATE TABLE IF NOT EXISTS leadgen_media_platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 0,
  postback_url_template TEXT NOT NULL, auth_secret_ref TEXT, event_name TEXT DEFAULT 'Purchase',
  value_multiplier REAL NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS leadgen_postback_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, external_txn_id TEXT NOT NULL,
  click_id TEXT, offer_public_id TEXT, event_ts INTEGER, payload_redacted_json TEXT, debug_ref TEXT,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE (provider, external_txn_id)
);
CREATE INDEX IF NOT EXISTS idx_leadgen_pblog_click ON leadgen_postback_log(click_id);
CREATE TABLE IF NOT EXISTS leadgen_revenue_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT, dt TEXT NOT NULL, click_id TEXT NOT NULL, offer_public_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('s2s_postback','api','script','in_site')),
  booking_trigger TEXT NOT NULL DEFAULT 'conversion' CHECK (booking_trigger IN ('click','conversion')),
  conversions INTEGER NOT NULL DEFAULT 0, revenue REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
  received_at INTEGER NOT NULL DEFAULT (unixepoch()), synced_to_ch_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_leadgen_revraw_unsynced ON leadgen_revenue_raw(synced_to_ch_at) WHERE synced_to_ch_at IS NULL;
CREATE TABLE IF NOT EXISTS leadgen_revenue_unmatched (
  id INTEGER PRIMARY KEY AUTOINCREMENT, click_id TEXT NOT NULL, provider TEXT NOT NULL, external_txn_id TEXT,
  revenue REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD', revenue_usd REAL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','unattributed'))
);
CREATE TABLE IF NOT EXISTS leadgen_event_dead_letter (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, payload_json TEXT NOT NULL, reason TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS leadgen_fx_rates (date TEXT NOT NULL, currency TEXT NOT NULL, usd_rate REAL NOT NULL, PRIMARY KEY (date, currency));
