-- Migration 0022 (Rescue 4): per-article provisioning work units.
--
-- Defect (live prod e2e): the generate_15_homepage_articles +
-- generate_or_assign_article_images provisioning steps each looped ALL N
-- items inside a SINGLE step invocation (each generateStarterArticle ~60-120s,
-- each generateFeatureImage ~120s). That O(N) work blew the Cloudflare Workers
-- per-invocation CPU/wall budget and the step died partway (prod stalled at
-- 12/15 articles), leaving the job parked 'running' forever. Re-running the
-- step regenerated the whole plan and redid the AI work (non-idempotent).
--
-- Fix: materialize the starter-article plan ONCE into a durable work-unit
-- table, then advance ONE unit per step invocation. Each step picks the next
-- 'pending' unit, does ONE unit of AI work, marks it 'done' (or 'failed' after
-- a bounded number of attempts), and reports in_progress until none remain.
-- This makes each invocation O(1) — it fits any article count (15/35/100)
-- within the per-invocation budget — and idempotent: a unit already 'done' is
-- skipped before any AI call, so a killed/retried step never redoes work.
--
-- Schema:
--   (site_id, unit_index) PRIMARY KEY  — one row per planned starter article;
--   slug/title/summary                 — the materialized plan item;
--   text_status  ('pending'|'done'|'failed')  — article-body generation state;
--   image_status ('pending'|'done'|'failed')  — feature-image generation state;
--   article_id                         — the articles row created for this unit
--                                        (NULL until text generation lands it);
--   attempt_count + last_error         — bounded-retry bookkeeping per unit;
--   created_at / updated_at            — unixepoch() timestamps.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + the materialize step's INSERT OR
-- IGNORE (under the (site_id, unit_index) PRIMARY KEY) make both the migration
-- and the per-site materialize re-apply-safe.
--
-- Lease/staleness choice: the cron driver (driveInProgressProvisioning) leases
-- a job via the EXISTING site_creation_jobs.updated_at column (bumped on every
-- unit) and an updated_at-staleness threshold (~120s), so two cron ticks never
-- double-drive the same job. We deliberately add NO lease_until column here:
-- ALTER TABLE ADD COLUMN is not idempotent in D1 (and this repo has no
-- conditional column-add pattern — see migrations 0019/0014, plain ADD COLUMN),
-- so reusing updated_at staleness is the lowest-risk option per the brief.
CREATE TABLE IF NOT EXISTS provisioning_article_units (
  site_id TEXT NOT NULL,
  unit_index INTEGER NOT NULL,
  slug TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  text_status TEXT NOT NULL DEFAULT 'pending',
  image_status TEXT NOT NULL DEFAULT 'pending',
  article_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (site_id, unit_index)
);

-- The two hot lookups the steps run every invocation: "next pending text unit
-- for this site" and "next pending image unit for this site" (ORDER BY
-- unit_index LIMIT 1). A composite index on (site_id, <status>) keeps each
-- O(1) regardless of article count.
CREATE INDEX IF NOT EXISTS idx_provisioning_article_units_site_text
  ON provisioning_article_units (site_id, text_status);
CREATE INDEX IF NOT EXISTS idx_provisioning_article_units_site_image
  ON provisioning_article_units (site_id, image_status);
