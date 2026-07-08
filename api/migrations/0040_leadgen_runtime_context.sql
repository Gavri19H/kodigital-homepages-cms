-- 0040_leadgen_runtime_context.sql
-- LeadGen CMS Operational Fix Contract v2.4 — runtime macro-context snapshot — 04 §4.6 (R2/R8)
-- Additive only. Redacted snapshot (session/traffic/offer-scoped macros ONLY — the engine's
-- SNAPSHOT_MACRO_KEYS whitelist carries no computed keys; NO raw ip/ua —
-- request-scoped values are re-derived at click time).

ALTER TABLE leadgen_auction_result_log ADD COLUMN macro_context_json TEXT NOT NULL DEFAULT '{}';
