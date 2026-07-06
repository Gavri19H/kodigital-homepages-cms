-- =============================================================================
-- LeadGen CMS — Athena DDL (v2.3 FINAL). Database: leadgen. Substitute __BUCKET__.
-- Final executable schema — no delta comments, no deprecated snippets. One
-- Firehose stream, three record_kind values. No banned product name in source.
-- =============================================================================
CREATE DATABASE IF NOT EXISTS leadgen;

CREATE EXTERNAL TABLE IF NOT EXISTS leadgen.events (
  record_kind string,
  event_id string, event_type string, timestamp bigint, received_at bigint,
  session_id string, page_view_id string, funnel_attempt_id string, site_id string,
  quote_id string, quote_name string,
  funnel_id string, funnel_name string, funnel_variant_id string,
  funnel_ab_test_id string, funnel_ab_test_revision int, assignment_bucket int, assignment_reason string,
  section_order_hash string,
  section_id string, section_name string, section_index int,
  question_id string, question_key string, answer_id string,
  answer_value_normalized string, answer_value_raw string,
  answer_source string,                 -- default_applied | user_selected | user_confirmed_default
  continue_mode string, continued_to_next_section boolean,
  section_mapping_version int, answer_mapping_version string,
  auction_config_id string, auction_config_version string, auction_type string, winner_logic string,
  auction_instance_id string, auction_request_id string, provider_request_id string,
  auction_result_id string, banner_render_id string,
  offer_id string, offer_name string, placement_id string, payload_schema_version string,
  response_parser_version int, offer_type string, provider string,
  carrier_key string, carrier_key_source string, carrier_name string, carrier_position int,
  bid_value double, bid_currency string, bid_source string,
  carrier_filtered_reason string, provider_error_reason string, auction_unfilled_reason string,
  click_id string, conversion_id string, revenue double, booking_trigger string,
  utm_source string, utm_medium string, utm_content string, traffic_source string, placement string,
  cpc string, fbc string, fbclid string, sub1 string, sub2 string, sub3 string, sub4 string, sub5 string,
  device string, os string, os_version string, browser string, browser_version string,
  country string, state string, city string, zip string, ip string, ua string,
  url string, referer string, language string,
  is_bot boolean, is_internal boolean, is_preview boolean, traffic_quality_flag string
)
PARTITIONED BY (dt string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ('ignore.malformed.json'='true')
LOCATION 's3://__BUCKET__/leadgen/events/'
TBLPROPERTIES ('projection.enabled'='true','projection.dt.type'='date','projection.dt.format'='yyyy/MM/dd','projection.dt.range'='2026/07/01,NOW','projection.dt.interval'='1','projection.dt.interval.unit'='DAYS','storage.location.template'='s3://__BUCKET__/leadgen/events/${dt}');

CREATE EXTERNAL TABLE IF NOT EXISTS leadgen.sessions (
  record_kind string, session_id string, first_seen bigint, last_seen bigint, page_view_id string,
  funnel_attempt_id string, site_id string, landing_url string, quote_id string, funnel_id string, funnel_variant_id string,
  traffic_source string, utm_source string, utm_medium string, utm_content string, placement string,
  cpc string, fbclid string, fbc string, sub1 string, sub2 string, sub3 string, sub4 string, sub5 string,
  device string, os string, os_version string, browser string, browser_version string,
  country string, state string, city string, zip string, ip string, ua string, url string, referer string, language string,
  is_bot boolean, is_internal boolean, is_preview boolean, traffic_quality_flag string
)
PARTITIONED BY (dt string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ('ignore.malformed.json'='true')
LOCATION 's3://__BUCKET__/leadgen/events/'
TBLPROPERTIES ('projection.enabled'='true','projection.dt.type'='date','projection.dt.format'='yyyy/MM/dd','projection.dt.range'='2026/07/01,NOW','projection.dt.interval'='1','projection.dt.interval.unit'='DAYS','storage.location.template'='s3://__BUCKET__/leadgen/events/${dt}');

CREATE EXTERNAL TABLE IF NOT EXISTS leadgen.dead_letter_records (
  record_kind string, event_id string, reason string, payload_json string, received_at bigint
)
PARTITIONED BY (dt string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ('ignore.malformed.json'='true')
LOCATION 's3://__BUCKET__/leadgen/events/'
TBLPROPERTIES ('projection.enabled'='true','projection.dt.type'='date','projection.dt.format'='yyyy/MM/dd','projection.dt.range'='2026/07/01,NOW','projection.dt.interval'='1','projection.dt.interval.unit'='DAYS','storage.location.template'='s3://__BUCKET__/leadgen/events/${dt}');

CREATE OR REPLACE VIEW leadgen.events_only   AS SELECT * FROM leadgen.events   WHERE record_kind='event';
CREATE OR REPLACE VIEW leadgen.sessions_only AS SELECT * FROM leadgen.sessions WHERE record_kind='session';
CREATE OR REPLACE VIEW leadgen.events_clean  AS SELECT * FROM leadgen.events   WHERE record_kind='event'   AND traffic_quality_flag='clean';
CREATE OR REPLACE VIEW leadgen.sessions_clean AS SELECT * FROM leadgen.sessions WHERE record_kind='session' AND traffic_quality_flag='clean';
