-- =============================================================================
-- LeadGen CMS — ClickHouse DDL (v2.3 FINAL). CH Cloud, HTTP interface.
-- Final executable schema — actual columns (no delta comments, no deprecated
-- snippets). ReplacingMergeTree + REFRESH EVERY 2 MINUTE MVs; clean-only default;
-- ratios computed at read (D1 NULLIF). Reasons are real columns; below_floor is
-- carrier_filtered_reason='below_floor' (never encoded in answer_value_normalized).
-- No banned product name in source.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lg_events_raw (
  event_id String, session_id String, event_type LowCardinality(String), dt Date, ts DateTime,
  page_view_id String DEFAULT '', funnel_attempt_id String DEFAULT '', site_id String DEFAULT '',
  quote_id String DEFAULT '', funnel_id String DEFAULT '', funnel_name String DEFAULT '', funnel_variant_id String DEFAULT '',
  funnel_ab_test_id String DEFAULT '', funnel_ab_test_revision UInt32 DEFAULT 0, assignment_bucket UInt16 DEFAULT 0,
  section_order_hash String DEFAULT '', section_id String DEFAULT '', section_index UInt16 DEFAULT 0,
  question_key String DEFAULT '', answer_value_normalized String DEFAULT '',
  answer_source LowCardinality(String) DEFAULT 'user_selected', continue_mode LowCardinality(String) DEFAULT '',
  section_mapping_version UInt32 DEFAULT 0, answer_mapping_version String DEFAULT '',
  auction_config_id String DEFAULT '', auction_config_version String DEFAULT '', auction_type LowCardinality(String) DEFAULT '', winner_logic LowCardinality(String) DEFAULT '',
  auction_instance_id String DEFAULT '', auction_request_id String DEFAULT '', provider_request_id String DEFAULT '',
  auction_result_id String DEFAULT '', banner_render_id String DEFAULT '',
  offer_id String DEFAULT '', placement_id String DEFAULT '', payload_schema_version String DEFAULT '', response_parser_version UInt32 DEFAULT 0,
  offer_type LowCardinality(String) DEFAULT '', provider LowCardinality(String) DEFAULT '',
  carrier_key String DEFAULT '', carrier_key_source LowCardinality(String) DEFAULT '', carrier_name String DEFAULT '', carrier_position UInt16 DEFAULT 0,
  bid_value Float64 DEFAULT 0, bid_currency LowCardinality(String) DEFAULT 'USD', bid_source LowCardinality(String) DEFAULT '',
  carrier_filtered_reason LowCardinality(String) DEFAULT '', provider_error_reason LowCardinality(String) DEFAULT '', auction_unfilled_reason LowCardinality(String) DEFAULT '',
  click_id String DEFAULT '', conversion_id String DEFAULT '', revenue Float64 DEFAULT 0, booking_trigger LowCardinality(String) DEFAULT '',
  traffic_source LowCardinality(String) DEFAULT '', placement String DEFAULT '', utm_source String DEFAULT '', utm_medium String DEFAULT '', utm_content String DEFAULT '',
  device LowCardinality(String) DEFAULT '', os LowCardinality(String) DEFAULT '', country LowCardinality(String) DEFAULT '', state LowCardinality(String) DEFAULT '',
  is_bot UInt8 DEFAULT 0, is_internal UInt8 DEFAULT 0, is_preview UInt8 DEFAULT 0, traffic_quality_flag LowCardinality(String) DEFAULT 'clean',
  value Float64 DEFAULT 0, ver UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(ver) PARTITION BY toYYYYMM(dt)
ORDER BY (dt, event_type, quote_id, funnel_id, funnel_variant_id, auction_instance_id, offer_id, carrier_key, event_id);

CREATE TABLE IF NOT EXISTS lg_sessions (
  session_id String, dt Date, funnel_attempt_id String DEFAULT '', site_id String, quote_id String DEFAULT '', funnel_id String DEFAULT '', funnel_variant_id String DEFAULT '',
  landing_url String DEFAULT '', traffic_source LowCardinality(String) DEFAULT '', placement String DEFAULT '', utm_source String DEFAULT '', utm_medium String DEFAULT '', utm_content String DEFAULT '',
  cpc Float64 DEFAULT 0, fbc String DEFAULT '', fbclid String DEFAULT '', device LowCardinality(String) DEFAULT '', os LowCardinality(String) DEFAULT '',
  country LowCardinality(String) DEFAULT '', state LowCardinality(String) DEFAULT '', city String DEFAULT '', ip String DEFAULT '', ua String DEFAULT '', referer String DEFAULT '', language LowCardinality(String) DEFAULT '',
  ver UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(ver) PARTITION BY toYYYYMM(dt) ORDER BY (session_id);

CREATE TABLE IF NOT EXISTS lg_revenue_raw (
  dt Date, click_id String, offer_id String DEFAULT '', source LowCardinality(String),
  booking_trigger LowCardinality(String) DEFAULT 'conversion', conversions UInt64 DEFAULT 0, revenue Float64 DEFAULT 0,
  currency LowCardinality(String) DEFAULT 'USD', synced_at DateTime DEFAULT now(), ver UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(ver) PARTITION BY toYYYYMM(dt) ORDER BY (dt, click_id, offer_id, source);

-- Revenue attributed via clean offer_click join by click_id.
CREATE TABLE IF NOT EXISTS lg_revenue_attributed (
  dt Date, quote_id String, funnel_id String, funnel_variant_id String, auction_instance_id String, auction_config_id String,
  offer_id String, carrier_key String, traffic_source String, source LowCardinality(String),
  conversions UInt64 DEFAULT 0, revenue Float64 DEFAULT 0, synced_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt)
ORDER BY (dt, quote_id, funnel_id, funnel_variant_id, auction_config_id, offer_id, carrier_key, traffic_source, source);
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_revenue_attributed_mv REFRESH EVERY 2 MINUTE TO lg_revenue_attributed AS
SELECT c.dt AS dt, c.quote_id AS quote_id, c.funnel_id AS funnel_id, c.funnel_variant_id AS funnel_variant_id, c.auction_instance_id AS auction_instance_id, c.auction_config_id AS auction_config_id,
  c.offer_id AS offer_id, c.carrier_key AS carrier_key, c.traffic_source AS traffic_source, r.source AS source,
  SUM(r.conversions) AS conversions, SUM(r.revenue) AS revenue, now() AS synced_at
FROM lg_revenue_raw AS r FINAL
JOIN (SELECT click_id, dt, quote_id, funnel_id, funnel_variant_id, auction_instance_id, auction_config_id, offer_id, carrier_key, traffic_source
      FROM lg_events_raw FINAL WHERE event_type IN ('offer_click','carrier_click') AND traffic_quality_flag='clean') AS c
  ON r.click_id = c.click_id
GROUP BY c.dt, c.quote_id, c.funnel_id, c.funnel_variant_id, c.auction_instance_id, c.auction_config_id, c.offer_id, c.carrier_key, c.traffic_source, r.source;

-- Offer daily (offer_impression = one per (auction_instance_id, offer_id); event already deduped at emit).
CREATE TABLE IF NOT EXISTS lg_offer_daily (offer_id String, dt Date, offer_impressions UInt64, clicks UInt64, unique_clicks UInt64, conversions UInt64, revenue Float64, synced_at DateTime DEFAULT now()) ENGINE=ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (offer_id, dt);
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_offer_daily_mv REFRESH EVERY 2 MINUTE TO lg_offer_daily AS
SELECT e.offer_id AS offer_id, e.dt AS dt, sumIf(1,e.event_type='offer_impression') AS offer_impressions,
  sumIf(1,e.event_type IN ('offer_click','carrier_click')) AS clicks, uniqExactIf(e.session_id,e.event_type IN ('offer_click','carrier_click')) AS unique_clicks,
  COALESCE(r.conversions,0) AS conversions, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lg_events_raw AS e FINAL LEFT JOIN (SELECT offer_id,dt,SUM(conversions) conversions,SUM(revenue) revenue FROM lg_revenue_attributed FINAL GROUP BY offer_id,dt) AS r ON e.offer_id=r.offer_id AND e.dt=r.dt
WHERE notEmpty(e.offer_id) AND e.traffic_quality_flag='clean' GROUP BY e.offer_id,e.dt,r.conversions,r.revenue;

-- Section daily + answer distribution (3-way answer_source, continued_count).
CREATE TABLE IF NOT EXISTS lg_section_daily (section_id String, dt Date, views UInt64, clicks UInt64, continued UInt64, validation_errors UInt64, default_applied UInt64, user_confirmed_default UInt64, user_selected UInt64, dropoffs UInt64, synced_at DateTime DEFAULT now()) ENGINE=ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (section_id,dt);
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_section_daily_mv REFRESH EVERY 2 MINUTE TO lg_section_daily AS
SELECT e.section_id AS section_id, e.dt AS dt, sumIf(1,e.event_type='section_view') AS views, sumIf(1,e.event_type='answer_click') AS clicks,
  uniqExactIf(e.session_id,e.event_type='section_continue') AS continued, sumIf(1,e.event_type='validation_error') AS validation_errors,
  sumIf(1,e.answer_source='default_applied') AS default_applied, sumIf(1,e.answer_source='user_confirmed_default') AS user_confirmed_default, sumIf(1,e.answer_source='user_selected') AS user_selected,
  (uniqExactIf(e.session_id,e.event_type='section_view')-uniqExactIf(e.session_id,e.event_type='section_continue')) AS dropoffs, now() AS synced_at
FROM lg_events_raw AS e FINAL WHERE notEmpty(e.section_id) AND e.traffic_quality_flag='clean' GROUP BY e.section_id,e.dt;

CREATE TABLE IF NOT EXISTS lg_answer_distribution_daily (section_id String, question_key String, answer_value_normalized String, answer_source LowCardinality(String), dt Date, count UInt64, continued_count UInt64, synced_at DateTime DEFAULT now()) ENGINE=ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (section_id,question_key,answer_value_normalized,answer_source,dt);
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_answer_distribution_daily_mv REFRESH EVERY 2 MINUTE TO lg_answer_distribution_daily AS
SELECT e.section_id AS section_id, e.question_key AS question_key, e.answer_value_normalized AS answer_value_normalized, e.answer_source AS answer_source, e.dt AS dt,
  sumIf(1,e.event_type='answer_click') AS count, uniqExactIf(e.session_id,e.event_type='answer_click' AND e.continued_to_next_section) AS continued_count, now() AS synced_at
FROM lg_events_raw AS e FINAL WHERE e.event_type='answer_click' AND notEmpty(e.question_key) AND e.traffic_quality_flag='clean' GROUP BY e.section_id,e.question_key,e.answer_value_normalized,e.answer_source,e.dt;

-- Quote daily + drilldown (group by stable funnel_id, drill into funnel_variant_id).
CREATE TABLE IF NOT EXISTS lg_quote_daily (quote_id String, funnel_id String, funnel_variant_id String, funnel_ab_test_id String DEFAULT '', site_id String DEFAULT '', traffic_source LowCardinality(String) DEFAULT '', dt Date, visits UInt64, unique_visits UInt64, bounces UInt64, completions UInt64, clicks UInt64, conversions UInt64, unfilled UInt64, revenue Float64, synced_at DateTime DEFAULT now()) ENGINE=ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (quote_id,funnel_id,funnel_variant_id,site_id,traffic_source,dt);
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_quote_daily_mv REFRESH EVERY 2 MINUTE TO lg_quote_daily AS
SELECT e.quote_id AS quote_id, e.funnel_id AS funnel_id, e.funnel_variant_id AS funnel_variant_id, e.funnel_ab_test_id AS funnel_ab_test_id, e.site_id AS site_id, e.traffic_source AS traffic_source, e.dt AS dt,
  sumIf(1,e.event_type='quote_view') AS visits, uniqExactIf(e.session_id,e.event_type='quote_view') AS unique_visits,
  (uniqExactIf(e.session_id,e.event_type='quote_view')-uniqExactIf(e.session_id,e.event_type='section_continue')) AS bounces,
  uniqExactIf(e.session_id,e.event_type='auction_start') AS completions, sumIf(1,e.event_type IN ('offer_click','carrier_click')) AS clicks,
  COALESCE(r.conversions,0) AS conversions, uniqExactIf(e.session_id,e.event_type='auction_unfilled') AS unfilled, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lg_events_raw AS e FINAL LEFT JOIN (SELECT quote_id,funnel_id,funnel_variant_id,dt,SUM(conversions) conversions,SUM(revenue) revenue FROM lg_revenue_attributed FINAL GROUP BY quote_id,funnel_id,funnel_variant_id,dt) AS r ON e.quote_id=r.quote_id AND e.funnel_id=r.funnel_id AND e.funnel_variant_id=r.funnel_variant_id AND e.dt=r.dt
WHERE notEmpty(e.quote_id) AND e.traffic_quality_flag='clean' GROUP BY e.quote_id,e.funnel_id,e.funnel_variant_id,e.funnel_ab_test_id,e.site_id,e.traffic_source,e.dt,r.conversions,r.revenue;

CREATE TABLE IF NOT EXISTS lg_quote_drilldown_daily (quote_id String, funnel_id String, funnel_variant_id String, site_id String DEFAULT '', traffic_source LowCardinality(String) DEFAULT '', device LowCardinality(String) DEFAULT '', state LowCardinality(String) DEFAULT '', section_id String DEFAULT '', section_index UInt16 DEFAULT 0, question_key String DEFAULT '', answer_value_normalized String DEFAULT '', dt Date, views UInt64, continued UInt64, clicks UInt64, conversions UInt64, revenue Float64, synced_at DateTime DEFAULT now()) ENGINE=ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (quote_id,funnel_id,funnel_variant_id,site_id,traffic_source,device,state,section_id,question_key,answer_value_normalized,dt);
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_quote_drilldown_daily_mv REFRESH EVERY 2 MINUTE TO lg_quote_drilldown_daily AS
SELECT e.quote_id AS quote_id, e.funnel_id AS funnel_id, e.funnel_variant_id AS funnel_variant_id, e.site_id AS site_id, e.traffic_source AS traffic_source, e.device AS device, e.state AS state,
  e.section_id AS section_id, e.section_index AS section_index, e.question_key AS question_key, e.answer_value_normalized AS answer_value_normalized, e.dt AS dt,
  sumIf(1,e.event_type='section_view') AS views, uniqExactIf(e.session_id,e.event_type='section_continue') AS continued, sumIf(1,e.event_type IN ('offer_click','carrier_click')) AS clicks, 0 AS conversions, 0 AS revenue, now() AS synced_at
FROM lg_events_raw AS e FINAL WHERE notEmpty(e.quote_id) AND e.traffic_quality_flag='clean'
GROUP BY e.quote_id,e.funnel_id,e.funnel_variant_id,e.site_id,e.traffic_source,e.device,e.state,e.section_id,e.section_index,e.question_key,e.answer_value_normalized,e.dt;

-- Auction daily (auctions = uniqExact(auction_instance_id)); below_floor via carrier_filtered_reason.
CREATE TABLE IF NOT EXISTS lg_auction_daily (auction_config_id String, dt Date, auctions UInt64, filled_auctions UInt64, unfilled_auctions UInt64, offer_impressions UInt64, carrier_impressions UInt64, carrier_clicks UInt64, bid_value_sum Float64, eligible_bid_count UInt64, timeouts UInt64, below_floor UInt64, malformed UInt64, no_bid UInt64, provider_errors UInt64, latency_ms_sum UInt64, revenue Float64, synced_at DateTime DEFAULT now()) ENGINE=ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (auction_config_id,dt);
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_auction_daily_mv REFRESH EVERY 2 MINUTE TO lg_auction_daily AS
SELECT e.auction_config_id AS auction_config_id, e.dt AS dt,
  uniqExactIf(e.auction_instance_id,e.event_type='auction_start') AS auctions,
  uniqExactIf(e.auction_instance_id,e.event_type='auction_filled') AS filled_auctions,
  uniqExactIf(e.auction_instance_id,e.event_type='auction_unfilled') AS unfilled_auctions,
  sumIf(1,e.event_type='offer_impression') AS offer_impressions, sumIf(1,e.event_type='carrier_impression') AS carrier_impressions, sumIf(1,e.event_type='carrier_click') AS carrier_clicks,
  sumIf(e.bid_value,e.event_type='auction_carrier_eligible') AS bid_value_sum, sumIf(1,e.event_type='auction_carrier_eligible') AS eligible_bid_count,
  sumIf(1,e.event_type='auction_offer_timeout') AS timeouts, sumIf(1,e.event_type='auction_carrier_filtered' AND e.carrier_filtered_reason='below_floor') AS below_floor,
  sumIf(1,e.event_type='auction_offer_error') AS malformed, sumIf(1,e.event_type='auction_offer_response' AND e.bid_value=0) AS no_bid, sumIf(1,e.event_type='auction_offer_error') AS provider_errors,
  toUInt64(sumIf(e.value,e.event_type='auction_offer_response')) AS latency_ms_sum, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lg_events_raw AS e FINAL LEFT JOIN (SELECT auction_config_id,dt,SUM(revenue) revenue FROM lg_revenue_attributed FINAL GROUP BY auction_config_id,dt) AS r ON e.auction_config_id=r.auction_config_id AND e.dt=r.dt
WHERE notEmpty(e.auction_config_id) AND e.traffic_quality_flag='clean' GROUP BY e.auction_config_id,e.dt,r.revenue;

CREATE TABLE IF NOT EXISTS lg_auction_drilldown_daily (auction_config_id String, offer_id String DEFAULT '', carrier_key String DEFAULT '', device LowCardinality(String) DEFAULT '', state LowCardinality(String) DEFAULT '', carrier_filtered_reason LowCardinality(String) DEFAULT '', provider_error_reason LowCardinality(String) DEFAULT '', auction_unfilled_reason LowCardinality(String) DEFAULT '', dt Date, offer_impressions UInt64, carrier_impressions UInt64, clicks UInt64, conversions UInt64, bid_value_sum Float64, revenue Float64, synced_at DateTime DEFAULT now()) ENGINE=ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (auction_config_id,offer_id,carrier_key,device,state,carrier_filtered_reason,provider_error_reason,auction_unfilled_reason,dt);
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_auction_drilldown_daily_mv REFRESH EVERY 2 MINUTE TO lg_auction_drilldown_daily AS
SELECT e.auction_config_id AS auction_config_id, e.offer_id AS offer_id, e.carrier_key AS carrier_key, e.device AS device, e.state AS state,
  e.carrier_filtered_reason AS carrier_filtered_reason, e.provider_error_reason AS provider_error_reason, e.auction_unfilled_reason AS auction_unfilled_reason, e.dt AS dt,
  sumIf(1,e.event_type='offer_impression') AS offer_impressions, sumIf(1,e.event_type='carrier_impression') AS carrier_impressions, sumIf(1,e.event_type='carrier_click') AS clicks, 0 AS conversions, sumIf(e.bid_value,e.event_type='auction_carrier_eligible') AS bid_value_sum, 0 AS revenue, now() AS synced_at
FROM lg_events_raw AS e FINAL WHERE notEmpty(e.auction_config_id) AND e.traffic_quality_flag='clean'
GROUP BY e.auction_config_id,e.offer_id,e.carrier_key,e.device,e.state,e.carrier_filtered_reason,e.provider_error_reason,e.auction_unfilled_reason,e.dt;

CREATE TABLE IF NOT EXISTS lg_carrier_daily (auction_config_id String, offer_id String, carrier_key String, carrier_name String DEFAULT '', dt Date, carrier_impressions UInt64, clicks UInt64, unique_clicks UInt64, conversions UInt64, bid_value_sum Float64, revenue Float64, synced_at DateTime DEFAULT now()) ENGINE=ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (auction_config_id,offer_id,carrier_key,dt);
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_carrier_daily_mv REFRESH EVERY 2 MINUTE TO lg_carrier_daily AS
SELECT e.auction_config_id AS auction_config_id, e.offer_id AS offer_id, e.carrier_key AS carrier_key, any(e.carrier_name) AS carrier_name, e.dt AS dt,
  sumIf(1,e.event_type='carrier_impression') AS carrier_impressions, sumIf(1,e.event_type='carrier_click') AS clicks, uniqExactIf(e.session_id,e.event_type='carrier_click') AS unique_clicks,
  COALESCE(r.conversions,0) AS conversions, sumIf(e.bid_value,e.event_type='carrier_impression') AS bid_value_sum, COALESCE(r.revenue,0) AS revenue, now() AS synced_at
FROM lg_events_raw AS e FINAL LEFT JOIN (SELECT auction_config_id,offer_id,carrier_key,dt,SUM(conversions) conversions,SUM(revenue) revenue FROM lg_revenue_attributed FINAL GROUP BY auction_config_id,offer_id,carrier_key,dt) AS r ON e.auction_config_id=r.auction_config_id AND e.offer_id=r.offer_id AND e.carrier_key=r.carrier_key AND e.dt=r.dt
WHERE notEmpty(e.carrier_key) AND e.traffic_quality_flag='clean' GROUP BY e.auction_config_id,e.offer_id,e.carrier_key,e.dt,r.conversions,r.revenue;

CREATE TABLE IF NOT EXISTS lg_provider_diagnostics_daily (offer_id String, auction_config_id String DEFAULT '', provider_error_reason LowCardinality(String) DEFAULT '', dt Date, requests UInt64, responses UInt64, timeouts UInt64, errors UInt64, no_bid UInt64, below_floor UInt64, latency_ms_sum UInt64, synced_at DateTime DEFAULT now()) ENGINE=ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (offer_id,auction_config_id,provider_error_reason,dt);
CREATE MATERIALIZED VIEW IF NOT EXISTS lg_provider_diagnostics_daily_mv REFRESH EVERY 2 MINUTE TO lg_provider_diagnostics_daily AS
SELECT e.offer_id AS offer_id, e.auction_config_id AS auction_config_id, e.provider_error_reason AS provider_error_reason, e.dt AS dt,
  sumIf(1,e.event_type='auction_offer_request') AS requests, sumIf(1,e.event_type='auction_offer_response') AS responses, sumIf(1,e.event_type='auction_offer_timeout') AS timeouts, sumIf(1,e.event_type='auction_offer_error') AS errors,
  sumIf(1,e.event_type='auction_offer_response' AND e.bid_value=0) AS no_bid, sumIf(1,e.event_type='auction_carrier_filtered' AND e.carrier_filtered_reason='below_floor') AS below_floor,
  toUInt64(sumIf(e.value,e.event_type='auction_offer_response')) AS latency_ms_sum, now() AS synced_at
FROM lg_events_raw AS e FINAL WHERE notEmpty(e.offer_id) AND e.traffic_quality_flag='clean' GROUP BY e.offer_id,e.auction_config_id,e.provider_error_reason,e.dt;
-- Stable dashboard join keys (traffic_source/utm_*/placement/click_id/offer_id) — never rename.
