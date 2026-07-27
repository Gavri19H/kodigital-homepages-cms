-- 0054_leadgen_analytics_routing_dims.sql
-- LeadGen Rework §8.7 — "routed_to_funnel and feed_name join the drilldown
-- dimensions." Adds both as columns on leadgen_analytics_quote_drilldown (the
-- §15.6 per-quote breakdown mirror quotes-handlers.ts's quoteAnalyticsHandler
-- reads) so the admin analytics query leg can GROUP BY them exactly like the
-- existing site_id/traffic_source/device/state dimensions.
--
-- CHECK/PK change ⇒ FULL-TABLE RECREATION (d1-database-safety.md): the new
-- columns join the PRIMARY KEY (they are dimension columns exactly like the
-- 8 already there — a row is keyed by the FULL dimension tuple, matching how
-- site_id/traffic_source/device/state already participate in the PK). CREATE
-- new -> INSERT OR IGNORE (existing rows backfill both new columns to '') ->
-- DROP old -> RENAME. No named indexes exist on the original table beyond the
-- inline PRIMARY KEY's own auto-index (verified: migrations/0037 is the only
-- migration referencing this table, one CREATE TABLE, no CREATE INDEX) — none
-- to re-verify.
--
-- CUTOVER-SAFETY COMPAT INDEX (added post-review; empirically verified, not
-- guessed): during the merge->deploy window the ALREADY-DEPLOYED worker keeps
-- running src/leadgen/mirror-sync.ts's buildUpsertSql() for this mirror
-- UNCHANGED (this migration deliberately does not touch that file — see the
-- SCOPE NOTE below), which issues
--   INSERT INTO leadgen_analytics_quote_drilldown (<the ORIGINAL 11 dims + 6
--   metrics>, synced_at) VALUES (...) ON CONFLICT(<the ORIGINAL 11 dims>) DO
--   UPDATE SET ...
-- i.e. an ON CONFLICT target naming ONLY the pre-0054 11-column PK, with NO
-- WHERE clause. Reproduced directly (import MIRRORS + buildUpsertSql from
-- mirror-sync.ts, apply this migration to a scratch node:sqlite DB, run the
-- real generated SQL verbatim): SQLite requires an ON CONFLICT target to
-- match an EXISTING unique constraint's column set EXACTLY (a strict subset
-- of the new 13-column PK does not match, even though every value the old
-- code supplies would legally satisfy it) -- confirmed the old upsert THROWS
-- "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint" on
-- every single call, 100% of the time, not merely a degraded/graceful
-- aggregation into the '' bucket as first assumed -- a hard cutover-breaking
-- regression for this one mirror table (mirrorOne's per-table try/catch
-- contains it to just this table's sync, but it is a hard stop, not a
-- degrade). A partial unique index scoped to WHERE routed_to_funnel = '' AND
-- feed_name = '' does NOT fix it either (also verified): SQLite only matches
-- an ON CONFLICT target against a partial index when the INSERT statement's
-- OWN ON CONFLICT clause repeats that same WHERE condition, and the
-- already-deployed code (frozen for the window) has no such clause. The only
-- fix available without touching already-deployed code is a FULL (non-partial)
-- UNIQUE index on exactly the original 11 columns, so the old upsert's
-- ON CONFLICT target resolves against IT instead of the new 13-column PK.
-- Backfilled rows can never violate it (they were unique on these exact 11
-- columns already -- it WAS their PK before this migration, verified against
-- migrations/0037's original PRIMARY KEY clause verbatim). Its practical
-- effect today is a no-op (mirror-sync.ts is this table's ONLY writer and
-- does not yet populate routed_to_funnel/feed_name at all, so every current
-- row already carries '' for both -- the 11-col and 13-col identities
-- coincide for 100% of existing/near-term data).
--
-- >>> REMOVAL OBLIGATION for whichever follow-up round updates mirror-sync.ts's
-- >>> MirrorSpec (adds routed_to_funnel/feed_name to its pk+columns, once ops
-- >>> has applied the ClickHouse DDL): that SAME change MUST drop this index
-- >>> (DROP INDEX uq_leadgen_quote_drilldown_legacy_upsert;) in the SAME
-- >>> migration. Leaving both alive together would make the NEW 13-column-aware
-- >>> upsert ALSO subject to this 11-column UNIQUE constraint as an unnamed,
-- >>> un-upsertable side constraint, so the FIRST time two distinct
-- >>> routed_to_funnel values ever share an otherwise-identical 11-dimension
-- >>> combo (exactly the case §8.7 exists to distinguish), that insert would
-- >>> hard-fail with a UNIQUE constraint violation instead of coexisting.
--
-- SCOPE NOTE (reported to the conductor, not silently overreached): this
-- migration is SAFE and Worker-owned (D1 schema only). It does NOT extend
-- src/leadgen/mirror-sync.ts's CH-column SELECT list for this mirror, and does
-- NOT touch infra/leadgen/clickhouse-ddl.sql (the CH lg_events_raw /
-- lg_quote_drilldown_daily materialized view, explicitly documented in
-- infra/leadgen/clickhouse-apply.md as "ops-owned... performed outside the
-- Worker deploy" against a PRODUCTION ClickHouse cluster SHARED with
-- listicles) — verified those CH tables carry neither column today, so
-- extending mirror-sync.ts's MirrorSpec for this table before that DDL is
-- applied would make lg_quote_drilldown_daily's SELECT fail with an "unknown
-- identifier" CH error on every sync attempt (mirrorOne's per-table try/catch
-- contains the blast radius to this one mirror, but it would go from
-- succeeding to failing on every cron tick the moment this code deploys) —
-- exactly the kind of production-behavior mutation this program reserves for
-- explicit owner/ops action, not a subagent's unilateral judgment call. These
-- two new columns are therefore populated as '' (never NULL, matching every
-- other TEXT dimension column's DEFAULT below) until BOTH (a) ops applies the
-- CH DDL and (b) a follow-up change extends mirror-sync.ts's MirrorSpec — the
-- query/UI legs this program's contract asks for read '' as "no routing rule
-- matched" today (honest — never fabricated), turning into real values the
-- moment those two follow-ups land, with zero further code changes.

CREATE TABLE leadgen_analytics_quote_drilldown_new (
  quote_public_id TEXT NOT NULL, funnel_id TEXT NOT NULL DEFAULT '', funnel_variant_id TEXT DEFAULT '',
  site_id TEXT DEFAULT '', traffic_source TEXT DEFAULT '', device TEXT DEFAULT '', state TEXT DEFAULT '',
  routed_to_funnel TEXT DEFAULT '', feed_name TEXT DEFAULT '',
  section_public_id TEXT DEFAULT '', section_index INTEGER, question_key TEXT DEFAULT '', answer_value_normalized TEXT DEFAULT '',
  date TEXT NOT NULL, views INTEGER, continued INTEGER, clicks INTEGER, conversions INTEGER, revenue REAL, synced_at INTEGER,
  PRIMARY KEY (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, device, state, routed_to_funnel, feed_name, section_public_id, question_key, answer_value_normalized, date)
);

-- Cutover-safety compat index (see the note above) — lets the ALREADY-DEPLOYED
-- worker's unchanged mirror-sync.ts upsert (ON CONFLICT over exactly these 11
-- columns, no WHERE clause) keep resolving during the merge->deploy window.
-- MUST be dropped by the same follow-up that adds routed_to_funnel/feed_name
-- to mirror-sync.ts's MirrorSpec.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leadgen_quote_drilldown_legacy_upsert
  ON leadgen_analytics_quote_drilldown_new
  (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, device, state, section_public_id, question_key, answer_value_normalized, date);

INSERT OR IGNORE INTO leadgen_analytics_quote_drilldown_new
  (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, device, state,
   routed_to_funnel, feed_name, section_public_id, section_index, question_key, answer_value_normalized,
   date, views, continued, clicks, conversions, revenue, synced_at)
SELECT quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, device, state,
       '', '', section_public_id, section_index, question_key, answer_value_normalized,
       date, views, continued, clicks, conversions, revenue, synced_at
FROM leadgen_analytics_quote_drilldown;

DROP TABLE leadgen_analytics_quote_drilldown;

ALTER TABLE leadgen_analytics_quote_drilldown_new RENAME TO leadgen_analytics_quote_drilldown;
