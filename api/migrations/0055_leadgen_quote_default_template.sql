-- 0055_leadgen_quote_default_template.sql
-- LeadGen R2 fixing mission · P2 D5 (contract §7 D5; owner ruling on SOURCE-OF-
-- TRUTH A.1 #11-D / ADJ-B2: "the user should be able to define the 'default'
-- template, but to A/B test different templates" — "Set as default" was global
-- across every quote; the owner ruled a PER-QUOTE default via a NEW dedicated
-- table, with the existing leadgen_frame_templates.is_default staying as the
-- cross-quote FALLBACK when a quote has no override of its own).
--
-- One row per quote that has set an override (PRIMARY KEY quote_public_id — at
-- most one per quote, upserted by the Templates tab's "Set as default"). This
-- is a CREATE-TIME seed for NEW funnels (resolveDefaultFrameTemplateId) and the
-- FINAL serve-time fallback (resolveSavedFrameTemplateDefaultsFor /
-- loadSavedFrameTemplateDefaults) — it never re-templates an existing funnel
-- and never overrides an explicit variant/funnel frame_template_id.
--
-- Backfill is idempotent + conditional (INSERT OR IGNORE on the PK): every
-- EXISTING quote gets a row seeded from whatever is_default template is live
-- at migration time, so a quote created before this migration behaves exactly
-- as it did the day before (its "per-quote default" == the global default it
-- already inherited) — re-running this file is a no-op the second time.
CREATE TABLE IF NOT EXISTS leadgen_quote_default_template (
  quote_public_id TEXT PRIMARY KEY,
  frame_template_id INTEGER REFERENCES leadgen_frame_templates(id)
);

INSERT OR IGNORE INTO leadgen_quote_default_template (quote_public_id, frame_template_id)
SELECT q.public_id, (SELECT id FROM leadgen_frame_templates WHERE is_default = 1)
FROM leadgen_quotes q;
