-- Auction → Rules: traffic share + offer waterfalls.
--
-- OWNER 2026-10-01 (Ido via Guy): "The current situation doesn't allow
-- (1) setting any rule dictated by a given amount of traffic; (2) applying a
-- specific offer waterfall as an action" — e.g. 50% of traffic sees Fundera
-- first (Tier 1) if they meet its rules, else AmONE (Tier 2), else Tier 3
-- (several offers, an offerwall). Owner rulings: a lower tier's provider is
-- called ONLY if the tier above says no; the visitor sees ONLY the tier that
-- qualified; the waterfalls of an auction split the traffic like an A/B test.
--
-- 1. traffic_share_pct — the share of visitors a rule applies to (session
--    sticky). NULL = all traffic, so every existing rule behaves as before.
-- 2. action 'waterfall' + tiers_json — {"tiers":[{"offer_ids":[5]},...]}.
-- `action` is a CHECK enum, so the table is rebuilt (CREATE new → copy →
-- DROP → RENAME). No table references leadgen_auction_rules; every existing
-- row is copied unchanged.
-- 3. leadgen_auction_result_log.waterfall_json — which path and tier served
--    the visitor (NULL when no waterfall ran).
PRAGMA defer_foreign_keys = true;

CREATE TABLE leadgen_auction_rules_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgar_…"
  auction_id INTEGER NOT NULL REFERENCES leadgen_auctions(id) ON DELETE CASCADE,
  rule_level TEXT NOT NULL CHECK (rule_level IN ('offer','carrier')),
  target_offer_id INTEGER REFERENCES leadgen_offers(id),
  action TEXT NOT NULL CHECK (action IN ('include_only','exclude','allow_list','block_list','waterfall')),
  conditions_json TEXT NOT NULL, conditions_hash TEXT NOT NULL,
  carrier_match_json TEXT, strictly_override INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  traffic_share_pct REAL CHECK (traffic_share_pct IS NULL OR (traffic_share_pct > 0 AND traffic_share_pct <= 100)),
  tiers_json TEXT
);

INSERT INTO leadgen_auction_rules_new
  (id, public_id, auction_id, rule_level, target_offer_id, action, conditions_json, conditions_hash,
   carrier_match_json, strictly_override, priority, enabled, created_at)
SELECT id, public_id, auction_id, rule_level, target_offer_id, action, conditions_json, conditions_hash,
       carrier_match_json, strictly_override, priority, enabled, created_at
FROM leadgen_auction_rules;

DROP TABLE leadgen_auction_rules;
ALTER TABLE leadgen_auction_rules_new RENAME TO leadgen_auction_rules;
CREATE INDEX IF NOT EXISTS idx_leadgen_auctionrules_auction ON leadgen_auction_rules(auction_id, rule_level, priority);

ALTER TABLE leadgen_auction_result_log ADD COLUMN waterfall_json TEXT;
