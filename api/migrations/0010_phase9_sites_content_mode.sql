-- 0010_phase9_sites_content_mode.sql
-- Phase 9 (CMS rescue 2): add sites.content_mode — records whether a
-- site's content is produced by the AI pipeline ('ai') or hand-authored
-- by an operator ('manual').
--
-- Contract (mission field_contract, canonical_name=content_mode):
--   TEXT NOT NULL DEFAULT 'ai' CHECK (content_mode IN ('ai','manual'))
-- Consumers: api/src/site-provisioning/steps.ts (update_launch_readiness
-- writes the field into launch_readiness) and
-- api/src/admin/templates/domains.ts (badge display).
--
-- ADD COLUMN with an inline column-level CHECK is legal in SQLite/D1 —
-- the full-table-recreation requirement (d1-database-safety) applies to
-- CHANGING an existing CHECK constraint, not to adding a new column.
-- NOT NULL is satisfied for pre-existing rows by the non-null DEFAULT,
-- and DEFAULT 'ai' matches the current behaviour of every existing site
-- (all were provisioned through the AI content pipeline).

ALTER TABLE sites ADD COLUMN content_mode TEXT NOT NULL DEFAULT 'ai' CHECK (content_mode IN ('ai','manual'));
