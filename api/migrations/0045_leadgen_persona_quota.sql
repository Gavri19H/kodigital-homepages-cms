-- 0045_leadgen_persona_quota.sql
-- LeadGen Round-4 P5c adversarial-review fix (MAJOR-2): the per-site monthly
-- AI-persona-image generation quota moves off a KV read-check-then-later-
-- write counter (a check-then-act race: N concurrent requests all read the
-- SAME pre-spend `used` value, all pass the cap, all spend — the cap the
-- endpoint exists to enforce does not hold) onto this D1 table, gated by a
-- SINGLE atomic UPDATE statement (D1/SQLite serializes writes to a row) so
-- "check the cap" and "reserve a slot" happen as one indivisible operation —
-- see admin/leadgen/assets-handlers.ts's claimPersonaQuotaSlot.
--
-- Composite PK (site_id, period_ym) mirrors the existing
-- leadgen_offer_cap_counters idiom (PRIMARY KEY (offer_id, cap_date),
-- migration 0036) — one counter row per site per calendar period, looked up
-- and claimed by the SAME two-column key every time.
CREATE TABLE IF NOT EXISTS leadgen_persona_quota (
  site_id TEXT NOT NULL,
  period_ym TEXT NOT NULL,                    -- UTC 'YYYYMM', e.g. '202607'
  used INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (site_id, period_ym)
);
