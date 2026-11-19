-- =============================================================================
-- F11 · LeadGen ClickHouse change: count redirect clicks apart from visitor
-- clicks. ONE-TIME and ADD-ONLY. WRITTEN, NOT APPLIED.
--
-- APPLY ONLY WITH THE OWNER'S GO (Ido) AND GUY'S OK, once, just before the
-- F11 deploy (backlog/CONTRACT-F11.md task 16). ClickHouse is production.
-- Nothing in the Worker, the tests or CI runs this file.
--
-- What it does, and nothing else:
--   1. lg_events_raw gets a new column, click_source. It is empty by default,
--      so every past click reads as a visitor click. The S3 loader
--      (api/src/analytics/event-loader.ts) fills columns by name from the live
--      table, so from now on each click arrives with its click_source.
--   2. lg_offer_daily gets a new column, redirect_clicks (0 by default).
--   3. lg_offer_daily_mv is re-created with ONE added line: it also adds up
--      the redirect clicks. Every other line stays exactly as it is.
--   No row is changed or deleted. "clicks" keeps counting every click.
--
-- BEFORE RUNNING IT:
--   a. Read the live view, and keep everything else in it the same:
--        SHOW CREATE TABLE lg_offer_daily_mv
--      Compare it with step 3 below (the same text as the repo's
--      docs/leadgen/contract/infra/clickhouse-ddl.sql). If the live view
--      differs in anything other than the added redirect_clicks line, STOP:
--      use the live text plus only that one line, and update the repo file to
--      match. Keep a copy of the live text (it is the way back).
--   b. See which of the two columns already exist (the statements below are
--      safe to re-run either way):
--        SELECT table, name, type FROM system.columns
--        WHERE database = currentDatabase()
--          AND ((table = 'lg_events_raw' AND name = 'click_source')
--            OR (table = 'lg_offer_daily' AND name = 'redirect_clicks'))
--
-- Why re-creating the view loses nothing: lg_offer_daily_mv is a refreshable
-- view (REFRESH EVERY 2 MINUTE ... TO lg_offer_daily). Each refresh rebuilds
-- lg_offer_daily from lg_events_raw; the view itself holds no rows. While it
-- is gone, lg_offer_daily keeps its last numbers, and the new view refreshes
-- as soon as it is created. This is how the earlier live view fixes were made
-- (infra/leadgen/aws-provision.md, "Wrap-around fix").
--
-- Order matters: steps 1 and 2 first (the new view reads click_source and
-- writes redirect_clicks), then step 3. Then deploy (ClickHouse first, so no
-- redirect mark is lost; the D1 stats copy works either way).
--
-- AFTER RUNNING IT (read-only checks, about 3 minutes later):
--   -- every day: redirect clicks are a part of clicks, never more
--   SELECT count() FROM lg_offer_daily FINAL WHERE redirect_clicks > clicks   -- expect 0
--   -- the last 14 days are unchanged (compare with the same query run before step 1)
--   SELECT offer_id, sum(offer_impressions), sum(clicks), sum(revenue)
--   FROM lg_offer_daily FINAL WHERE dt >= today() - 14 GROUP BY offer_id ORDER BY offer_id
--
-- Way back (also only with the owner's go): re-create lg_offer_daily_mv from
-- the live text kept in step a. The two new columns can stay: they hold
-- empty / 0 values and nothing breaks with them.
-- =============================================================================

-- Step 1
ALTER TABLE lg_events_raw ADD COLUMN IF NOT EXISTS click_source LowCardinality(String) DEFAULT '' AFTER booking_trigger;

-- Step 2
ALTER TABLE lg_offer_daily ADD COLUMN IF NOT EXISTS redirect_clicks UInt64 DEFAULT 0 AFTER unique_clicks;

-- Step 3 (the only new line is the one that ends "AS redirect_clicks")
DROP VIEW IF EXISTS lg_offer_daily_mv;
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_offer_daily_mv REFRESH EVERY 2 MINUTE TO lg_offer_daily AS
SELECT e.offer_id AS offer_id, e.dt AS dt, sumIf(1,e.event_type='offer_impression') AS offer_impressions,
  sumIf(1,e.event_type IN ('offer_click','carrier_click')) AS clicks, uniqExactIf(e.session_id,e.event_type IN ('offer_click','carrier_click')) AS unique_clicks,
  sumIf(1,e.event_type IN ('offer_click','carrier_click') AND e.click_source='redirect') AS redirect_clicks,
  COALESCE(r.conversions,0) AS conversions, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lg_events_raw AS e FINAL LEFT JOIN (SELECT offer_id,dt,SUM(conversions) conversions,SUM(revenue) revenue FROM lg_revenue_attributed FINAL GROUP BY offer_id,dt) AS r ON e.offer_id=r.offer_id AND e.dt=r.dt
WHERE notEmpty(e.offer_id) AND e.traffic_quality_flag='clean' GROUP BY e.offer_id,e.dt,r.conversions,r.revenue;
