-- 0034_listicles_revenue_infra.sql
-- Listicles CMS — revenue / platform / data-quality infrastructure
-- (Design Contract v1.2.2 §19 + §20 + §31.7 + §31.9; contract slot "0033",
-- shifted +1 — see docs/listicles/traceability.md).
-- Where the contract specifies column lists without full DDL
-- (postback_log, revenue_raw, revenue_unmatched, event_dead_letter, fx_rates),
-- this file adds only primary keys, the §31.7-mandated dedupe UNIQUE, and
-- received/sync timestamps; every such authored detail is logged in the
-- traceability register.

-- §20: outbound S2S dispatcher config — one row per media platform.
CREATE TABLE IF NOT EXISTS listicle_media_platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL UNIQUE,             -- 'facebook','newsbreak','taboola','outbrain','google'
  enabled INTEGER NOT NULL DEFAULT 0,
  postback_url_template TEXT NOT NULL,       -- with {macros}: {fbc},{fbclid},{click_id},{value},{currency}
  auth_secret_ref TEXT,                      -- name of the wrangler secret holding the token
  event_name TEXT DEFAULT 'Purchase',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- §19/§31.7: inbound postback dedupe log. Replays of the same
-- (provider, external_txn_id) are no-ops enforced by the UNIQUE constraint.
CREATE TABLE IF NOT EXISTS listicle_postback_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  external_txn_id TEXT NOT NULL,
  click_id TEXT,
  offer_public_id TEXT,
  event_ts INTEGER,
  payload_json TEXT,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (provider, external_txn_id)
);
CREATE INDEX IF NOT EXISTS idx_listicle_pblog_click ON listicle_postback_log(click_id);

-- §19: D1 staging for provider revenue/conversions; the analytics sync ships
-- NEW rows (synced_to_ch_at IS NULL) to ClickHouse lst_revenue_raw, then stamps them.
CREATE TABLE IF NOT EXISTS listicle_revenue_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dt TEXT NOT NULL,                          -- 'YYYY-MM-DD' (UTC — §31.7)
  click_id TEXT NOT NULL,
  offer_public_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('s2s_postback','api','script','in_site')),
  conversions INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  synced_to_ch_at INTEGER                    -- NULL until shipped to CH
);
CREATE INDEX IF NOT EXISTS idx_listicle_revraw_unsynced ON listicle_revenue_raw(synced_to_ch_at) WHERE synced_to_ch_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_listicle_revraw_click ON listicle_revenue_raw(click_id);

-- §31.7/§31.9: postbacks whose click_id has no matching offer_click yet;
-- re-matched for 72h, then reported unattributed.
CREATE TABLE IF NOT EXISTS listicle_revenue_unmatched (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  click_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_txn_id TEXT,
  revenue REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  revenue_usd REAL,                          -- normalized via listicle_fx_rates
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','matched','unattributed'))
);
CREATE INDEX IF NOT EXISTS idx_listicle_revunmatched_status ON listicle_revenue_unmatched(status, received_at);

-- §31.6/§31.9: events that failed durable delivery/ingest (mirrors the S3
-- dead-letter prefix listicles/dead-letter/).
CREATE TABLE IF NOT EXISTS listicle_event_dead_letter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_listicle_deadletter_event ON listicle_event_dead_letter(event_id);

-- §31.7/§31.9: daily FX table for revenue_usd normalization.
CREATE TABLE IF NOT EXISTS listicle_fx_rates (
  date TEXT NOT NULL,                        -- 'YYYY-MM-DD'
  currency TEXT NOT NULL,
  usd_rate REAL NOT NULL,
  PRIMARY KEY (date, currency)
);
