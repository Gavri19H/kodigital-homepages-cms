-- 0043_leadgen_routing_rules.sql
-- LeadGen Round-4 P4a (operator decision D-2, reference-faithful funnel routing).
--
-- Adds the reference's core action -- CONDITION-DRIVEN routing to a funnel
-- NAME/variant ("rules of which funnel name each user sees", Image42) -- which
-- the §15.5 model lacked: leadgen_funnel_rules.rule_type was CHECK-constrained
-- to six section/offer/eligibility types (0036:188), never a funnel-level
-- route. Extending a CHECK constraint in SQLite is NOT an in-place ALTER, so
-- per .claude/rules/d1-database-safety.md the change is a FULL-TABLE
-- RECREATION: CREATE new (with the extended CHECK + the rule-model-v2 additive
-- columns) -> INSERT OR IGNORE SELECT the existing rows -> DROP old -> RENAME.
--
-- SAFETY of the DROP/RENAME (verified before authoring):
--   * NO other table has a FK REFERENCES leadgen_funnel_rules (grep over
--     api/migrations: zero inbound references) -- dropping it orphans nothing.
--   * The original table carried NO named indexes (grep "CREATE INDEX" over
--     0036: none on leadgen_funnel_rules) -- so there are NONE to recreate
--     (the d1-safety "verify indexes recreated" step resolves to a no-op here,
--     documented explicitly rather than silently).
--   * Explicit `id` values are carried in the INSERT so primary keys are
--     PRESERVED (any future rule-id reference stays valid) and AUTOINCREMENT
--     continues from the same high-water mark.
--   * INSERT OR IGNORE (not plain INSERT) matches the d1-safety ritual: a
--     re-run over an already-migrated shape is a no-op rather than a UNIQUE
--     violation.
--   * Existing rows keep their stored conditions_hash byte-for-byte (it is
--     copied, never recomputed here -- the admin recomputes it only on a
--     subsequent EDIT, per the plan).
--
-- Additive columns (rule model v2 / the D-2 routing action):
--   target_funnel_variant_id  -- the route_funnel_variant destination (a
--                                sibling variant of the same funnel).
--   value_multiplier          -- the reference's FB Multiplier; the highest-
--                                priority MATCHED routing rule's value REPLACES
--                                the base S2S multiplier for that conversion.
--   checkpoint_page           -- the AUTO-DERIVED evaluation page (max page
--                                index over the pages where every condition
--                                answer-field is known; NULL == entry-attribute
--                                -only rule, evaluated at entry). The RUNTIME
--                                re-derives fresh from the live pages (drift-
--                                proof); this persisted value is the admin
--                                builder's cached "auto-checkpoint" display +
--                                the conflict-flag key.
--   match_mode                -- reserved for the ANY/ALL group composition
--                                surfaced by the P4b builder ('all' default in
--                                the §21.4 evaluator when NULL).
--   rule_name                 -- the operator-facing name (Image42).
--   status                    -- 'active' | 'disabled' (the reference's
--                                Active/Disabled toggle; distinct from the
--                                legacy `enabled` int, which stays for the six
--                                pre-existing rule types).

CREATE TABLE leadgen_funnel_rules_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgfr_…"
  variant_id INTEGER NOT NULL REFERENCES leadgen_funnel_variants(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('redirect_direct_offer','skip_section','show_section','eligibility','disqualification','auction_entry','route_funnel_variant')),
  conditions_json TEXT NOT NULL, conditions_hash TEXT NOT NULL,
  target_offer_id INTEGER REFERENCES leadgen_offers(id),          -- normal redirect target (issue 11)
  target_section_id INTEGER REFERENCES leadgen_sections(id),
  redirect_url TEXT, redirect_url_allowlisted INTEGER NOT NULL DEFAULT 0,   -- raw URL only when allowlisted
  priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Round-4 P4a rule-model-v2 additive columns (all NULLABLE / defaulted so the
  -- INSERT of pre-existing rows leaves them unset -- behavior-preserving):
  target_funnel_variant_id INTEGER REFERENCES leadgen_funnel_variants(id),
  value_multiplier REAL,
  checkpoint_page INTEGER,
  match_mode TEXT,
  rule_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

INSERT OR IGNORE INTO leadgen_funnel_rules_new
  (id, public_id, variant_id, rule_type, conditions_json, conditions_hash,
   target_offer_id, target_section_id, redirect_url, redirect_url_allowlisted,
   priority, enabled, created_at)
SELECT id, public_id, variant_id, rule_type, conditions_json, conditions_hash,
       target_offer_id, target_section_id, redirect_url, redirect_url_allowlisted,
       priority, enabled, created_at
FROM leadgen_funnel_rules;

DROP TABLE leadgen_funnel_rules;

ALTER TABLE leadgen_funnel_rules_new RENAME TO leadgen_funnel_rules;

-- Priority-ordered read of a variant's routing rules is the hot path (entry
-- resolution + checkpoint evaluation); index it (a NEW index, the recreated
-- table had none).
CREATE INDEX IF NOT EXISTS idx_lg_funnel_rules_variant_type
  ON leadgen_funnel_rules(variant_id, rule_type, priority);

-- The SERVER-recorded routing OUTCOME, keyed by attempt. This is the SINGLE
-- source of truth the /lg/auction variant re-derivation (via the re-issued
-- signed binding) and the S2S value_multiplier graft read -- NEVER a client
-- echo (roast MAJOR-3 / minor-7). One row per attempt: written when a routing
-- rule matches (entry plane at /lg/attempt, or checkpoint plane at
-- /lg/checkpoint). Its PRESENCE is the ≤1-hop guard for the checkpoint plane
-- (a second checkpoint switch is refused once a row exists).
CREATE TABLE IF NOT EXISTS leadgen_routing_outcomes (
  funnel_attempt_id TEXT PRIMARY KEY,            -- "att_…" (attempt.ts mintFunnelAttemptId)
  session_id TEXT NOT NULL,
  routed_from_variant TEXT NOT NULL,             -- lgn_ (the entry variant)
  routed_to_variant TEXT NOT NULL,               -- lgn_ (the served/switched target)
  matched_rule_hash TEXT NOT NULL,               -- conditions_hash -> assignment_reason='routing_rule:<hash>'
  value_multiplier REAL,                         -- the matched rule's multiplier (NULL -> S2S base applies)
  plane TEXT NOT NULL CHECK (plane IN ('entry','checkpoint')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_lg_routing_outcomes_session
  ON leadgen_routing_outcomes(session_id);
