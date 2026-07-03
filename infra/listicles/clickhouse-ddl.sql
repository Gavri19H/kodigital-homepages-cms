-- =============================================================================
-- Listicles CMS — ClickHouse aggregation DDL (design contract §17 + §30.7 + §31.8)
-- Target: CH Cloud, database per CH_DATABASE, HTTP interface, user `default`.
-- =============================================================================
--
-- CONDUCTOR HANDOFF — APPLY INSTRUCTIONS
-- --------------------------------------
-- Apply this file MANUALLY to CH Cloud over the HTTP interface (the CMS worker
-- NEVER runs DDL — it only READs the target tables to fill the D1 mirrors).
-- Every statement is `IF NOT EXISTS`, so re-applying is safe/idempotent.
-- ClickHouse's HTTP endpoint runs ONE statement per request, so send each
-- statement separately. Example (see infra/listicles/clickhouse-apply.md for
-- the full recipe incl. splitting on `;`):
--
--   curl -sS "$CH_URL/?database=$CH_DATABASE" \
--     -H "X-ClickHouse-User: default" -H "X-ClickHouse-Key: $CH_PASSWORD" \
--     --data-binary @- <<'SQL'
--   CREATE TABLE IF NOT EXISTS lst_events_raw ( ... ) ...;
--   SQL
--
-- Then set the three worker SECRETS (CH_URL / CH_USER / CH_PASSWORD) — see the
-- apply doc — and the every-minute cron's syncListicleAnalytics(env) starts
-- filling the five listicle_analytics_* D1 mirrors.
--
-- CONVENTIONS (ported from kodigital-dashboard/schema-clickhouse.sql):
--   * raw ingest → `REFRESH EVERY N MINUTE ... TO <target>` MV → ReplacingMergeTree
--   * `PARTITION BY toYYYYMM(dt)` · `LowCardinality(String)` on low-card dims
--   * ratios (ctr/cvr/rpc/rpm/pps/rule_match_rate) are computed at READ time
--     (D1 NULLIF), NEVER stored (§18)
--   * every default-analytics MV filters `traffic_quality_flag = 'clean'` (§31.8)
--
-- RECORD_KIND / RAW-TABLE FEEDING ASSUMPTION (DEV-14 + infra/listicles/athena-ddl.sql)
-- ----------------------------------------------------------------------------------
-- The worker writes THREE record kinds to ONE Firehose stream (`listicle-events`),
-- each JSON object stamped `record_kind = 'event' | 'session' | 'dead_letter'`
-- (DEV-14). Athena discriminates them with a `record_kind` predicate
-- (listicles.events_only / sessions_only / *_clean views — athena-ddl.sql).
--
-- These CH tables are the AGGREGATION target. They are fed by the EXTERNAL
-- Athena→CH ingestion job (data/ops own it, exactly like homepage-events →
-- Athena — this repo does not run it). The ASSUMPTION this DDL is built on:
--   * `lst_events_raw`   ← Athena `listicles.events_only`   (record_kind='event')
--   * `lst_sessions`     ← Athena `listicles.sessions_only` (record_kind='session')
--   * `lst_revenue_raw`  ← the §19 provider-revenue shipper (D1 → CH; Phase 9)
-- i.e. the ops job SPLITS the single record_kind stream into the two raw CH
-- tables by record_kind (events vs sessions land in SEPARATE CH tables here —
-- CH does not carry `record_kind`; the split happens at ingest). If ops instead
-- lands everything in one CH table with a record_kind column, add a
-- `WHERE record_kind='event'` predicate to the MVs below (correctness identical).
--
-- HONEST RESIDUAL: no rows exist in these tables until that external pipeline
-- runs. The CMS mirror-sync + its tests are proven against SEEDED D1 mirrors +
-- a MOCKED CH client, not live CH data.
-- =============================================================================


-- =============================================================================
-- §17.1 — Raw ingest + session dimension table
-- =============================================================================

-- one row per tracked event (from Athena listicles events) — kept lean
CREATE TABLE IF NOT EXISTS lst_events_raw (
  event_id String, session_id String,
  event_type LowCardinality(String),           -- page_view/page_reach/section_impression/offer_impression/offer_click/conversion
  dt Date, ts DateTime,
  site_id String, article_id String, lander_v String,
  article_version_id String DEFAULT '', article_version_revision UInt32 DEFAULT 1, article_experiment_id String DEFAULT '',
  article_variant_id String DEFAULT '', article_split UInt8 DEFAULT 0,
  page_index UInt16 DEFAULT 0,
  page_selection_mode LowCardinality(String) DEFAULT 'single',
  section_id String DEFAULT '', page_candidate_id String DEFAULT '',   -- section_variant_id = backward-compat alias
  ab_test_id String DEFAULT '', ab_split UInt8 DEFAULT 0,
  page_rule_set_id String DEFAULT '', page_rule_id String DEFAULT '', selection_reason LowCardinality(String) DEFAULT '',
  matched_rule_json_hash String DEFAULT '',
  link_instance_id String DEFAULT '', section_block_id String DEFAULT '', link_role LowCardinality(String) DEFAULT '',   -- v1.2 per-CTA
  link_position_index UInt16 DEFAULT 0, button_style_id String DEFAULT '', button_group_id String DEFAULT '', anchor_text_hash String DEFAULT '', analytics_label String DEFAULT '',
  page_view_id String DEFAULT '',                       -- v1.2.2 impression dedupe key
  is_bot UInt8 DEFAULT 0, is_internal UInt8 DEFAULT 0, is_preview UInt8 DEFAULT 0, traffic_quality_flag LowCardinality(String) DEFAULT 'clean',   -- v1.2.2
  offer_id String DEFAULT '', click_id String DEFAULT '',
  traffic_source LowCardinality(String) DEFAULT '', placement String DEFAULT '',
  utm_source String DEFAULT '', utm_medium String DEFAULT '', utm_content String DEFAULT '',
  device LowCardinality(String) DEFAULT '', os LowCardinality(String) DEFAULT '',
  country LowCardinality(String) DEFAULT '', state LowCardinality(String) DEFAULT '',
  value Float64 DEFAULT 0, ver UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(ver) PARTITION BY toYYYYMM(dt)
ORDER BY (dt, event_type, article_id, article_version_id, page_index, page_candidate_id, offer_id, event_id);

-- full acquisition/client dimensions live ONCE per session (events join by session_id — keeps event rows lean)
CREATE TABLE IF NOT EXISTS lst_sessions (
  session_id String, dt Date, site_id String, article_id String, lander_v String, landing_url String,
  traffic_source LowCardinality(String) DEFAULT '', placement String DEFAULT '',
  utm_source String DEFAULT '', utm_medium String DEFAULT '', utm_content String DEFAULT '',
  cpc Float64 DEFAULT 0, fbc String DEFAULT '', fbclid String DEFAULT '',
  sub1 String DEFAULT '', sub2 String DEFAULT '', sub3 String DEFAULT '', sub4 String DEFAULT '', sub5 String DEFAULT '',
  device LowCardinality(String) DEFAULT '', os LowCardinality(String) DEFAULT '', os_version String DEFAULT '',
  browser LowCardinality(String) DEFAULT '', browser_version String DEFAULT '',
  country LowCardinality(String) DEFAULT '', state LowCardinality(String) DEFAULT '', city String DEFAULT '',
  ip String DEFAULT '', ua String DEFAULT '', referer String DEFAULT '', url String DEFAULT '',
  language LowCardinality(String) DEFAULT '', ver UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(ver) PARTITION BY toYYYYMM(dt) ORDER BY (session_id);

-- provider revenue / conversions (from postback/API/script — §19), matched by click_id
CREATE TABLE IF NOT EXISTS lst_revenue_raw (
  dt Date, click_id String, offer_id String DEFAULT '',
  source LowCardinality(String),               -- 's2s_postback' | 'api' | 'script' | 'in_site'
  conversions UInt64 DEFAULT 0, revenue Float64 DEFAULT 0,
  currency LowCardinality(String) DEFAULT 'USD', synced_at DateTime DEFAULT now(),
  ver UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(ver) PARTITION BY toYYYYMM(dt) ORDER BY (dt, click_id, offer_id, source);


-- =============================================================================
-- §17.2 — Revenue attribution (inherits full click context via the click_id join)
-- Carries article_version_id/revision, page, section, candidate, ab_test, rule,
-- offer + the §30.7 link-instance dims through to every daily target.
-- §31.8: revenue analytics EXCLUDE non-clean traffic → the offer_click side is
-- filtered `traffic_quality_flag = 'clean'` (attributes revenue to clean clicks only).
-- =============================================================================

CREATE TABLE IF NOT EXISTS lst_revenue_attributed (
  dt Date, article_id String, article_version_id String, article_version_revision UInt32,
  page_index UInt16, section_id String, page_candidate_id String,
  ab_test_id String, page_rule_id String, offer_id String,
  link_instance_id String, section_block_id String, link_role LowCardinality(String), link_position_index UInt16,
  button_style_id String, button_group_id String, anchor_text_hash String, analytics_label String,
  source LowCardinality(String),
  conversions UInt64 DEFAULT 0, revenue Float64 DEFAULT 0, synced_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt)
ORDER BY (dt, article_id, article_version_id, article_version_revision, page_index, section_id, page_candidate_id,
          offer_id, link_instance_id, section_block_id, link_role, link_position_index,
          button_style_id, button_group_id, anchor_text_hash, analytics_label, ab_test_id, page_rule_id, source);

-- Every projected column is EXPLICITLY aliased AS its target-table column name.
-- A `REFRESH … TO <target>` MV names output columns by the projection
-- expression, so a bare `c.offer_id` would emit an output column literally
-- named `c.offer_id` (ClickHouse keeps the derived-table qualifier) → the
-- target has no such column → THERE_IS_NO_COLUMN rejection. The AS aliases
-- force output names == target columns.
CREATE MATERIALIZED VIEW IF NOT EXISTS lst_revenue_attributed_mv
REFRESH EVERY 2 MINUTE TO lst_revenue_attributed AS
SELECT c.dt AS dt, c.article_id AS article_id, c.article_version_id AS article_version_id, c.article_version_revision AS article_version_revision, c.page_index AS page_index, c.section_id AS section_id, c.page_candidate_id AS page_candidate_id,
       c.ab_test_id AS ab_test_id, c.page_rule_id AS page_rule_id, c.offer_id AS offer_id,
       c.link_instance_id AS link_instance_id, c.section_block_id AS section_block_id, c.link_role AS link_role, c.link_position_index AS link_position_index,
       c.button_style_id AS button_style_id, c.button_group_id AS button_group_id, c.anchor_text_hash AS anchor_text_hash, c.analytics_label AS analytics_label, r.source AS source,
       SUM(r.conversions) AS conversions, SUM(r.revenue) AS revenue, now() AS synced_at
FROM lst_revenue_raw AS r FINAL
JOIN (SELECT click_id, dt, article_id, article_version_id, article_version_revision, page_index, section_id, page_candidate_id,
              ab_test_id, page_rule_id, offer_id,
              link_instance_id, section_block_id, link_role, link_position_index,
              button_style_id, button_group_id, anchor_text_hash, analytics_label
       FROM lst_events_raw FINAL WHERE event_type = 'offer_click' AND traffic_quality_flag = 'clean') AS c
  ON r.click_id = c.click_id
GROUP BY c.dt, c.article_id, c.article_version_id, c.article_version_revision, c.page_index, c.section_id, c.page_candidate_id,
         c.ab_test_id, c.page_rule_id, c.offer_id,
         c.link_instance_id, c.section_block_id, c.link_role, c.link_position_index,
         c.button_style_id, c.button_group_id, c.anchor_text_hash, c.analytics_label, r.source;


-- =============================================================================
-- §17.3 — Daily targets (offer/section/article/drilldown/link_instance)
-- Counting rules (§17.3): offer impressions = count(offer_impression);
-- section/article/drilldown impressions = count(section_impression);
-- clicks = count(offer_click); unique_clicks = uniqExact(session_id) among clicks;
-- total_visits = count(page_view); unique_visits = uniqExact(session_id) among page_views;
-- rule drilldown matched/fallback = uniqExactIf(session_id, selection_reason=…).
-- Every MV: REFRESH EVERY 2 MINUTE, LEFT JOIN pre-aggregated revenue_attributed,
-- filter traffic_quality_flag='clean' (§31.8). Ratios computed at read (§18).
-- =============================================================================

-- --- Offer daily (§17.3 verbatim; clean filter added per §31.8) --------------
-- offer_id here is the Offer PUBLIC id (`off_…`) the event carries; the D1
-- mirror column is `offer_public_id` — the sync maps offer_id → offer_public_id (DEV-6).
CREATE TABLE IF NOT EXISTS lst_offer_daily (
  offer_id String, dt Date,
  impressions UInt64, clicks UInt64, unique_clicks UInt64, conversions UInt64,
  revenue Float64, synced_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (offer_id, dt);

CREATE MATERIALIZED VIEW IF NOT EXISTS lst_offer_daily_mv
REFRESH EVERY 2 MINUTE TO lst_offer_daily AS
SELECT e.offer_id AS offer_id, e.dt AS dt,
  sumIf(1, e.event_type='offer_impression') AS impressions,   -- per-Offer visibility, NOT section_impression
  sumIf(1, e.event_type='offer_click')      AS clicks,
  uniqExactIf(e.session_id, e.event_type='offer_click') AS unique_clicks,
  COALESCE(r.conversions,0) AS conversions, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lst_events_raw AS e FINAL
LEFT JOIN (SELECT offer_id, dt, SUM(conversions) conversions, SUM(revenue) revenue
            FROM lst_revenue_attributed FINAL GROUP BY offer_id, dt) AS r
  ON e.offer_id = r.offer_id AND e.dt = r.dt
WHERE notEmpty(e.offer_id) AND e.traffic_quality_flag = 'clean'   -- non-empty ids only (never = '') — WHERE follows the JOIN
GROUP BY e.offer_id, e.dt, r.conversions, r.revenue;

-- --- Section daily (section_impression-based) --------------------------------
CREATE TABLE IF NOT EXISTS lst_section_daily (
  section_id String, dt Date,
  impressions UInt64, clicks UInt64, unique_clicks UInt64, conversions UInt64,
  revenue Float64, synced_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (section_id, dt);

CREATE MATERIALIZED VIEW IF NOT EXISTS lst_section_daily_mv
REFRESH EVERY 2 MINUTE TO lst_section_daily AS
SELECT e.section_id AS section_id, e.dt AS dt,
  sumIf(1, e.event_type='section_impression') AS impressions,
  sumIf(1, e.event_type='offer_click')        AS clicks,
  uniqExactIf(e.session_id, e.event_type='offer_click') AS unique_clicks,
  COALESCE(r.conversions,0) AS conversions, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lst_events_raw AS e FINAL
LEFT JOIN (SELECT section_id, dt, SUM(conversions) conversions, SUM(revenue) revenue
            FROM lst_revenue_attributed FINAL GROUP BY section_id, dt) AS r
  ON e.section_id = r.section_id AND e.dt = r.dt
WHERE notEmpty(e.section_id) AND e.traffic_quality_flag = 'clean'
GROUP BY e.section_id, e.dt, r.conversions, r.revenue;

-- --- Article daily (+ total_visits / unique_visits; keyed article+version+revision) ---
CREATE TABLE IF NOT EXISTS lst_article_daily (
  article_id String, article_version_id String, article_version_revision UInt32,
  article_experiment_id String DEFAULT '', article_split UInt8 DEFAULT 0, dt Date,
  total_visits UInt64, unique_visits UInt64, impressions UInt64,
  clicks UInt64, unique_clicks UInt64, conversions UInt64, revenue Float64, synced_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt)
ORDER BY (article_id, article_version_id, article_version_revision, dt);

CREATE MATERIALIZED VIEW IF NOT EXISTS lst_article_daily_mv
REFRESH EVERY 2 MINUTE TO lst_article_daily AS
SELECT e.article_id AS article_id, e.article_version_id AS article_version_id, e.article_version_revision AS article_version_revision, e.article_experiment_id AS article_experiment_id, e.article_split AS article_split, e.dt AS dt,
  sumIf(1, e.event_type='page_view')          AS total_visits,
  uniqExactIf(e.session_id, e.event_type='page_view') AS unique_visits,
  sumIf(1, e.event_type='section_impression') AS impressions,
  sumIf(1, e.event_type='offer_click')        AS clicks,
  uniqExactIf(e.session_id, e.event_type='offer_click') AS unique_clicks,
  COALESCE(r.conversions,0) AS conversions, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lst_events_raw AS e FINAL
LEFT JOIN (SELECT article_id, article_version_id, article_version_revision, dt,
                  SUM(conversions) conversions, SUM(revenue) revenue
            FROM lst_revenue_attributed FINAL
            GROUP BY article_id, article_version_id, article_version_revision, dt) AS r
  ON e.article_id = r.article_id AND e.article_version_id = r.article_version_id
     AND e.article_version_revision = r.article_version_revision AND e.dt = r.dt
WHERE notEmpty(e.article_id) AND e.traffic_quality_flag = 'clean'
GROUP BY e.article_id, e.article_version_id, e.article_version_revision, e.article_experiment_id, e.article_split, e.dt,
         r.conversions, r.revenue;

-- --- Drilldown daily (+ selection_mode/ab_test/rule dims + matched/fallback sessions) ---
CREATE TABLE IF NOT EXISTS lst_drilldown_daily (
  article_id String, article_version_id String, article_version_revision UInt32,
  article_experiment_id String DEFAULT '', article_split UInt8 DEFAULT 0,
  page_index UInt16, page_selection_mode LowCardinality(String) DEFAULT 'single',
  section_id String, page_candidate_id String,
  ab_test_id String DEFAULT '', ab_split UInt8 DEFAULT 0,
  page_rule_set_id String DEFAULT '', page_rule_id String DEFAULT '',
  selection_reason LowCardinality(String) DEFAULT '', matched_rule_json_hash String DEFAULT '', dt Date,
  impressions UInt64, clicks UInt64, unique_clicks UInt64, conversions UInt64, revenue Float64,
  visits UInt64, matched_sessions UInt64, fallback_sessions UInt64, synced_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt)
ORDER BY (article_id, article_version_id, article_version_revision, page_index, page_candidate_id, dt);

CREATE MATERIALIZED VIEW IF NOT EXISTS lst_drilldown_daily_mv
REFRESH EVERY 2 MINUTE TO lst_drilldown_daily AS
SELECT e.article_id AS article_id, e.article_version_id AS article_version_id, e.article_version_revision AS article_version_revision, e.article_experiment_id AS article_experiment_id, e.article_split AS article_split,
  e.page_index AS page_index, e.page_selection_mode AS page_selection_mode, e.section_id AS section_id, e.page_candidate_id AS page_candidate_id,
  e.ab_test_id AS ab_test_id, e.ab_split AS ab_split, e.page_rule_set_id AS page_rule_set_id, e.page_rule_id AS page_rule_id, e.selection_reason AS selection_reason, e.matched_rule_json_hash AS matched_rule_json_hash, e.dt AS dt,
  sumIf(1, e.event_type='section_impression') AS impressions,
  sumIf(1, e.event_type='offer_click')        AS clicks,
  uniqExactIf(e.session_id, e.event_type='offer_click') AS unique_clicks,
  sumIf(1, e.event_type='page_view')          AS visits,
  uniqExactIf(e.session_id, e.selection_reason='rule_match') AS matched_sessions,
  uniqExactIf(e.session_id, e.selection_reason='fallback')   AS fallback_sessions,
  COALESCE(r.conversions,0) AS conversions, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lst_events_raw AS e FINAL
LEFT JOIN (SELECT article_id, article_version_id, article_version_revision, page_index, page_candidate_id, dt,
                  SUM(conversions) conversions, SUM(revenue) revenue
            FROM lst_revenue_attributed FINAL
            GROUP BY article_id, article_version_id, article_version_revision, page_index, page_candidate_id, dt) AS r
  ON e.article_id = r.article_id AND e.article_version_id = r.article_version_id
     AND e.article_version_revision = r.article_version_revision AND e.page_index = r.page_index
     AND e.page_candidate_id = r.page_candidate_id AND e.dt = r.dt
WHERE notEmpty(e.article_id) AND e.traffic_quality_flag = 'clean'
GROUP BY e.article_id, e.article_version_id, e.article_version_revision, e.article_experiment_id, e.article_split,
         e.page_index, e.page_selection_mode, e.section_id, e.page_candidate_id,
         e.ab_test_id, e.ab_split, e.page_rule_set_id, e.page_rule_id, e.selection_reason, e.matched_rule_json_hash, e.dt,
         r.conversions, r.revenue;

-- --- Link-instance daily (§30.7 grain: exact per-CTA placement) --------------
-- offer_id → mirror offer_public_id (DEV-6). Impressions = offer_impression
-- (specific governed link visible, §16).
CREATE TABLE IF NOT EXISTS lst_link_instance_daily (
  link_instance_id String, section_id String, offer_id String,
  article_id String, article_version_id String, article_version_revision UInt32,
  page_index UInt16, page_candidate_id String,
  page_selection_mode LowCardinality(String) DEFAULT 'single', page_rule_id String DEFAULT '',
  selection_reason LowCardinality(String) DEFAULT '', section_block_id String DEFAULT '',
  link_role LowCardinality(String) DEFAULT '', link_position_index UInt16 DEFAULT 0,
  button_style_id String DEFAULT '', button_group_id String DEFAULT '',
  anchor_text_hash String DEFAULT '', analytics_label String DEFAULT '', dt Date,
  impressions UInt64, clicks UInt64, unique_clicks UInt64, conversions UInt64, revenue Float64,
  synced_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt)
ORDER BY (link_instance_id, article_id, article_version_id, article_version_revision, page_index, page_candidate_id, dt);

CREATE MATERIALIZED VIEW IF NOT EXISTS lst_link_instance_daily_mv
REFRESH EVERY 2 MINUTE TO lst_link_instance_daily AS
SELECT e.link_instance_id AS link_instance_id, e.section_id AS section_id, e.offer_id AS offer_id, e.article_id AS article_id, e.article_version_id AS article_version_id, e.article_version_revision AS article_version_revision,
  e.page_index AS page_index, e.page_candidate_id AS page_candidate_id, e.page_selection_mode AS page_selection_mode, e.page_rule_id AS page_rule_id, e.selection_reason AS selection_reason,
  e.section_block_id AS section_block_id, e.link_role AS link_role, e.link_position_index AS link_position_index, e.button_style_id AS button_style_id, e.button_group_id AS button_group_id,
  e.anchor_text_hash AS anchor_text_hash, e.analytics_label AS analytics_label, e.dt AS dt,
  sumIf(1, e.event_type='offer_impression') AS impressions,
  sumIf(1, e.event_type='offer_click')      AS clicks,
  uniqExactIf(e.session_id, e.event_type='offer_click') AS unique_clicks,
  COALESCE(r.conversions,0) AS conversions, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lst_events_raw AS e FINAL
LEFT JOIN (SELECT link_instance_id, article_id, article_version_id, article_version_revision, page_index, page_candidate_id, dt,
                  SUM(conversions) conversions, SUM(revenue) revenue
            FROM lst_revenue_attributed FINAL
            GROUP BY link_instance_id, article_id, article_version_id, article_version_revision, page_index, page_candidate_id, dt) AS r
  ON e.link_instance_id = r.link_instance_id AND e.article_id = r.article_id
     AND e.article_version_id = r.article_version_id AND e.article_version_revision = r.article_version_revision
     AND e.page_index = r.page_index AND e.page_candidate_id = r.page_candidate_id AND e.dt = r.dt
WHERE notEmpty(e.link_instance_id) AND e.traffic_quality_flag = 'clean'
GROUP BY e.link_instance_id, e.section_id, e.offer_id, e.article_id, e.article_version_id, e.article_version_revision,
         e.page_index, e.page_candidate_id, e.page_selection_mode, e.page_rule_id, e.selection_reason,
         e.section_block_id, e.link_role, e.link_position_index, e.button_style_id, e.button_group_id,
         e.anchor_text_hash, e.analytics_label, e.dt, r.conversions, r.revenue;

-- =============================================================================
-- End of §17 schema. Dashboard-compatibility note (§18): listicle events carry
-- traffic_source / utm_* / placement / click_id, and these CH column names are
-- STABLE — never rename them; the campaign dashboard joins listicle revenue/
-- clicks to its media-buying spend on the same keys. Keep public_id stable.
-- =============================================================================
