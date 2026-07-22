-- 0048_leadgen_rework_m3_routing.sql
-- LeadGen Rework P1 · M3 (contract §5-M3, §4.3-3..9, F-D; owner decisions D2/D5).
--
-- Moves routing from a per-VARIANT single-action model to a QUOTE-scoped,
-- multi-action model, and recreates the routing-outcome table for entry-plane
-- routing (F-D). Four moving parts, in order:
--   (1) NEW leadgen_quote_routing_rules  (the quote-scoped multi-action rule).
--   (2) D2 row migration: route_funnel_variant rows → the new table, target =
--       the owning funnel of the variant they hung on (behavior-neutral today;
--       re-point via the new rules UI — see the migration report).
--   (3) skip_section/show_section GUARD (see the CONFLICT note below).
--   (4) leadgen_funnel_rules recreated with the CHECK tightened to exactly the
--       four auction-domain types (D5); their UI relocates to the Auction tab
--       in a later phase.
--   (5) leadgen_routing_outcomes recreated per F-D (entry-plane shape).
--
-- ┌── CONFLICT (reported to the conductor; NOT resolved here) ────────────────┐
-- │ Contract §5-M3 also says "skip_section/show_section rows → page slot      │
-- │ rules (mechanical; report)". Code reality makes a faithful 1:1 conversion │
-- │ IMPOSSIBLE:                                                               │
-- │  • slot rules (0042) accept ONLY entry-known condition fields — answer-   │
-- │    field conditions are REJECTED at save (quotes-handlers.ts:330-334);    │
-- │    skip/show rules are per-section navigation over ANSWER fields          │
-- │    (auction/engine.ts:1147 "owned by the P11 client engine").             │
-- │  • a slot rule must resolve to exactly ONE section (default_section_id    │
-- │    REQUIRED, resolver.ts:129-133) — it cannot express "skip".             │
-- │ Rather than INVENT a lossy conversion or SILENTLY drop the rows, this     │
-- │ migration ABORTS if any skip/show row exists, so the data is never lost   │
-- │ and the gap surfaces for a conductor-owned decision. Local/CI/fresh have  │
-- │ zero such rows (seed creates none) so this is a clean no-op there.        │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- Recreation safety (d1-database-safety): D1 runs migrations with
-- foreign_keys=OFF (0007/0008); leadgen_funnel_rules has NO inbound FK; ids are
-- preserved; INSERT OR IGNORE keeps a re-run a no-op. Index inventory of the
-- originals: leadgen_funnel_rules → idx_lg_funnel_rules_variant_type (recreated);
-- leadgen_routing_outcomes → idx_lg_routing_outcomes_session (recreated).

-- === (1) NEW leadgen_quote_routing_rules ====================================
-- Column list is contract-M3 verbatim. `match_mode` mirrors 0043 (nullable
-- TEXT; the §21.4 evaluator defaults to 'all' when NULL). The "≥1 action" save
-- gate is an application check (P3 handler), not a DB CHECK — matching the
-- contract's "Save gate" framing.
CREATE TABLE leadgen_quote_routing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                    -- "lgqr_…"
  quote_id INTEGER NOT NULL REFERENCES leadgen_quotes(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL CHECK (length(rule_name) <= 80),
  priority INTEGER NOT NULL DEFAULT 100,             -- 1 = highest (§4.3-4)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  match_mode TEXT,                                   -- ANY/ALL (§21.4; NULL ⇒ 'all')
  conditions_json TEXT NOT NULL,
  conditions_hash TEXT NOT NULL,                     -- same shape + hash as 0043
  checkpoint_page INTEGER,                           -- cached; runtime re-derives (§4.3-3)
  -- actions (each optional individually; ≥1 required at save, §4.3-9):
  target_funnel_id INTEGER REFERENCES leadgen_funnels(id),
  feed_name TEXT CHECK (feed_name IS NULL OR (length(feed_name) BETWEEN 1 AND 64 AND feed_name NOT GLOB '*[^A-Za-z0-9_-]*')),
  value_multiplier REAL,
  redirect_pct REAL CHECK (redirect_pct IS NULL OR (redirect_pct BETWEEN 0 AND 100)),
  target_offer_id INTEGER REFERENCES leadgen_offers(id),
  redirect_url TEXT,
  redirect_url_allowlisted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Hot path: a quote's rules read priority-ascending during entry/checkpoint
-- evaluation (mirrors 0043's idx_lg_funnel_rules_variant_type).
CREATE INDEX idx_lg_quote_routing_rules_quote
  ON leadgen_quote_routing_rules(quote_id, priority);

-- === (2) D2 row migration: route_funnel_variant → leadgen_quote_routing_rules
-- target_funnel_id = the owning funnel of the variant the rule hung on
-- (variant → funnel_id). quote_id = that funnel's quote. rule_name =
-- 'Migrated rule <old id>'. conditions / multiplier / redirect fields carried
-- intact. priority carried verbatim (existing order); rows inserted ORDER BY
-- old id so new autoincrement ids preserve relative order. status coalesced to
-- a valid value (defensive over unknown prod data). public_id uses the proven
-- 0042 idiom (upper(hex(randomblob(13))) = 26 Crockford-conformant chars ⇒
-- passes isPublicId('...')). feed_name NULL (no feed concept in the old model).
INSERT INTO leadgen_quote_routing_rules
  (public_id, quote_id, rule_name, priority, status, match_mode, conditions_json,
   conditions_hash, checkpoint_page, target_funnel_id, feed_name, value_multiplier,
   redirect_pct, target_offer_id, redirect_url, redirect_url_allowlisted, created_at)
SELECT 'lgqr_' || upper(hex(randomblob(13))),
       f.quote_id,
       'Migrated rule ' || r.id,
       r.priority,
       CASE WHEN r.status IN ('active','disabled') THEN r.status ELSE 'active' END,
       r.match_mode,
       r.conditions_json,
       r.conditions_hash,
       r.checkpoint_page,
       f.id,                                         -- target = owning funnel (behavior-neutral)
       NULL,
       r.value_multiplier,
       r.redirect_pct,
       r.target_offer_id,
       r.redirect_url,
       r.redirect_url_allowlisted,
       r.created_at
FROM leadgen_funnel_rules r
JOIN leadgen_funnel_variants v ON v.id = r.variant_id
JOIN leadgen_funnels f ON f.id = v.funnel_id
WHERE r.rule_type = 'route_funnel_variant'
ORDER BY r.id;

-- === (3) skip_section/show_section GUARD (see CONFLICT note at top) ==========
-- Non-inventing safety: abort the migration if any skip/show rule exists, so
-- the recreation below can NEVER silently drop them (the tightened CHECK would
-- otherwise IGNORE them). CASE→0 trips the CHECK(ok=1). No-op when none exist.
CREATE TABLE _lg_m3_skipshow_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _lg_m3_skipshow_guard (ok)
  SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
  FROM leadgen_funnel_rules WHERE rule_type IN ('skip_section','show_section');
DROP TABLE _lg_m3_skipshow_guard;

-- === (4) leadgen_funnel_rules recreated with the 4-type CHECK (D5) ==========
-- Keeps only eligibility / disqualification / auction_entry / redirect_direct_offer.
-- route_funnel_variant rows were migrated in (2); skip/show are guarded in (3).
-- All columns (incl. the 0043/0044 additive ones) carry over unchanged.
CREATE TABLE leadgen_funnel_rules_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgfr_…"
  variant_id INTEGER NOT NULL REFERENCES leadgen_funnel_variants(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('eligibility','disqualification','auction_entry','redirect_direct_offer')),
  conditions_json TEXT NOT NULL, conditions_hash TEXT NOT NULL,
  target_offer_id INTEGER REFERENCES leadgen_offers(id),
  target_section_id INTEGER REFERENCES leadgen_sections(id),
  redirect_url TEXT, redirect_url_allowlisted INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  target_funnel_variant_id INTEGER REFERENCES leadgen_funnel_variants(id),
  value_multiplier REAL,
  checkpoint_page INTEGER,
  match_mode TEXT,
  rule_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  redirect_pct REAL
);

INSERT OR IGNORE INTO leadgen_funnel_rules_new
  (id, public_id, variant_id, rule_type, conditions_json, conditions_hash,
   target_offer_id, target_section_id, redirect_url, redirect_url_allowlisted,
   priority, enabled, created_at, target_funnel_variant_id, value_multiplier,
   checkpoint_page, match_mode, rule_name, status, redirect_pct)
SELECT id, public_id, variant_id, rule_type, conditions_json, conditions_hash,
       target_offer_id, target_section_id, redirect_url, redirect_url_allowlisted,
       priority, enabled, created_at, target_funnel_variant_id, value_multiplier,
       checkpoint_page, match_mode, rule_name, status, redirect_pct
FROM leadgen_funnel_rules
WHERE rule_type IN ('eligibility','disqualification','auction_entry','redirect_direct_offer');

DROP TABLE leadgen_funnel_rules;

ALTER TABLE leadgen_funnel_rules_new RENAME TO leadgen_funnel_rules;

CREATE INDEX IF NOT EXISTS idx_lg_funnel_rules_variant_type
  ON leadgen_funnel_rules(variant_id, rule_type, priority);

-- === (5) leadgen_routing_outcomes recreated per F-D =========================
-- routed_from_variant → NULLable (entry-plane rows pre-date variant choice).
-- routed_to_variant   → NULLable (filled when the funnel's variant is assigned;
--                        entry-plane routing picks a FUNNEL before any variant
--                        exists — the direct implication of F-D).
-- routed_to_funnel     → NEW, NOT NULL DEFAULT '' (funnel public id). Legacy
--                        rows backfill from the served variant's funnel via
--                        JOIN; underivable (deleted variant) ⇒ '' .
-- feed_name            → NEW, NULLable (M3 feed action + M10 stamp).
-- PK / plane / matched_rule_hash unchanged.
CREATE TABLE leadgen_routing_outcomes_new (
  funnel_attempt_id TEXT PRIMARY KEY,            -- "att_…"
  session_id TEXT NOT NULL,
  routed_from_variant TEXT,                      -- NULLable (was NOT NULL)
  routed_to_variant TEXT,                        -- NULLable (was NOT NULL)
  routed_to_funnel TEXT NOT NULL DEFAULT '',     -- funnel public id (F-D)
  matched_rule_hash TEXT NOT NULL,
  value_multiplier REAL,                         -- matched rule's multiplier (NULL ⇒ S2S base)
  feed_name TEXT,                                -- M3 feed action / M10 stamp
  plane TEXT NOT NULL CHECK (plane IN ('entry','checkpoint')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO leadgen_routing_outcomes_new
  (funnel_attempt_id, session_id, routed_from_variant, routed_to_variant,
   routed_to_funnel, matched_rule_hash, value_multiplier, feed_name, plane, created_at)
SELECT o.funnel_attempt_id, o.session_id, o.routed_from_variant, o.routed_to_variant,
       COALESCE(
         (SELECT f.public_id
            FROM leadgen_funnel_variants v
            JOIN leadgen_funnels f ON f.id = v.funnel_id
           WHERE v.public_id = o.routed_to_variant),
         ''),
       o.matched_rule_hash, o.value_multiplier, NULL, o.plane, o.created_at
FROM leadgen_routing_outcomes o;

DROP TABLE leadgen_routing_outcomes;

ALTER TABLE leadgen_routing_outcomes_new RENAME TO leadgen_routing_outcomes;

CREATE INDEX IF NOT EXISTS idx_lg_routing_outcomes_session
  ON leadgen_routing_outcomes(session_id);
