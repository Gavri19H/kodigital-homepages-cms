-- 0039_leadgen_conversion_dedupe.sql
-- LeadGen CMS v2.3.7 FINAL (APPROVED — READY TO BUILD) — conversion dedupe — §7.7
-- Additive only. Renumber to head+1.. at build time.

CREATE TABLE IF NOT EXISTS leadgen_conversion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, click_id TEXT NOT NULL, dedupe_key TEXT NOT NULL,
  offer_public_id TEXT, source TEXT NOT NULL DEFAULT 'in_site', revenue REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
  booked_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE (click_id, dedupe_key)
);
