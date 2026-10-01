-- Auction → Rules: Tier-level rules (a group of offers).
--
-- OWNER 2026-10-01 (product manager feedback): "Please add 'Tier Level' … to
-- support presenting a whole tier (Offerwall for example) when conditions are
-- met." Owner ruling: the rule itself names its offers; IF the conditions
-- match it shows only those offers, all together (include_only/allow_list),
-- or hides them (exclude/block_list). The offers are stored in tiers_json
-- (0062) as one tier: {"tiers":[{"offer_ids":[13,14]}]}.
-- rule_level is a CHECK enum, so the table is rebuilt again (CREATE new → copy
-- → DROP → RENAME); every existing rule, 0062 columns included, is copied
-- unchanged. No table references leadgen_auction_rules.
PRAGMA defer_foreign_keys = true;

CREATE TABLE leadgen_auction_rules_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgar_…"
  auction_id INTEGER NOT NULL REFERENCES leadgen_auctions(id) ON DELETE CASCADE,
  rule_level TEXT NOT NULL CHECK (rule_level IN ('offer','carrier','tier')),
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
   carrier_match_json, strictly_override, priority, enabled, created_at, traffic_share_pct, tiers_json)
SELECT id, public_id, auction_id, rule_level, target_offer_id, action, conditions_json, conditions_hash,
       carrier_match_json, strictly_override, priority, enabled, created_at, traffic_share_pct, tiers_json
FROM leadgen_auction_rules;

DROP TABLE leadgen_auction_rules;
ALTER TABLE leadgen_auction_rules_new RENAME TO leadgen_auction_rules;
CREATE INDEX IF NOT EXISTS idx_leadgen_auctionrules_auction ON leadgen_auction_rules(auction_id, rule_level, priority);
