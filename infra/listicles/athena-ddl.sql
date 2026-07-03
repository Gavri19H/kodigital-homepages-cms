-- Listicles CMS — Athena DDL (design contract §16 + §30.7 + §31.9).
-- Database: listicles (Glue). Run AFTER infra/listicles/aws-provision.md
-- creates the Firehose stream; substitute __BUCKET__ with the shared
-- homepage-events bucket name.
--
-- Record-kind mechanics: the worker writes THREE record kinds to ONE stream
-- (prefix listicles/events/), each JSON object stamped with
--   record_kind = 'event' | 'session' | 'dead_letter'.
-- The OpenX JSON SerDe returns NULL for keys a record does not carry, so
-- events and sessions coexist in one S3 location; every table/view below
-- selects its kind with a record_kind predicate. (If the stream was created
-- with the OPTIONAL dynamic-partitioning variant — see aws-provision.md §1 —
-- point each LOCATION at its physical prefix and drop the predicate.)
--
-- Partition projection mirrors the standard Firehose key layout
-- (YYYY/MM/DD/HH). If homepage.events does not use projection, the
-- TBLPROPERTIES projection block can be removed — the tables then scan the
-- whole prefix (correctness unchanged).

-- ---------------------------------------------------------------------------
-- listicles.events — one row per tracking event (§16 columns 1:1)
-- ---------------------------------------------------------------------------
CREATE EXTERNAL TABLE IF NOT EXISTS listicles.events (
  record_kind               string,
  -- identity/context
  session_id                string,
  event_id                  string,
  event_type                string,
  timestamp                 bigint,
  received_at               bigint,
  site_id                   string,
  article_id                string,
  article_name              string,
  article_url               string,
  lander_v                  string,
  -- placement
  article_version_id        string,
  article_version_revision  int,
  article_experiment_id     string,
  article_variant_id        string,
  article_variant_label     string,
  article_split_percentage  double,
  page                      string,
  page_index                int,
  page_selection_mode       string,
  section_id                string,
  section_name              string,
  page_candidate_id         string,
  ab_test_id                string,
  ab_split_percentage       double,
  page_rule_set_id          string,
  page_rule_id              string,
  page_rule_priority        int,
  selection_reason          string,
  matched_rule_json_hash    string,
  offer_id                  string,
  offer_name                string,
  click_id                  string,
  -- §30.7 link-instance dims
  link_instance_id          string,
  section_block_id          string,
  link_role                 string,
  link_position_index       int,
  button_style_id           string,
  button_group_id           string,
  anchor_text_hash          string,
  analytics_label           string,
  -- acquisition
  utm_source                string,
  utm_medium                string,
  utm_content               string,
  traffic_source            string,
  placement                 string,
  cpc                       string,
  fbc                       string,
  fbclid                    string,
  sub1                      string,
  sub2                      string,
  sub3                      string,
  sub4                      string,
  sub5                      string,
  -- client/geo
  device                    string,
  os                        string,
  os_version                string,
  browser                   string,
  browser_version           string,
  country                   string,
  state                     string,
  city                      string,
  ip                        string,
  ua                        string,
  url                       string,
  referer                   string,
  language                  string,
  -- §31.9
  page_view_id              string,
  is_bot                    boolean,
  is_internal               boolean,
  is_preview                boolean,
  traffic_quality_flag      string
)
PARTITIONED BY (dt string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ('ignore.malformed.json' = 'true')
LOCATION 's3://__BUCKET__/listicles/events/'
TBLPROPERTIES (
  'projection.enabled' = 'true',
  'projection.dt.type' = 'date',
  'projection.dt.format' = 'yyyy/MM/dd',
  'projection.dt.range' = '2026/07/01,NOW',
  'projection.dt.interval' = '1',
  'projection.dt.interval.unit' = 'DAYS',
  'storage.location.template' = 's3://__BUCKET__/listicles/events/${dt}'
);

-- ---------------------------------------------------------------------------
-- listicles.sessions — one row per page_view-minted session record (§16)
-- Same S3 location; discriminated by record_kind = 'session'.
-- ---------------------------------------------------------------------------
CREATE EXTERNAL TABLE IF NOT EXISTS listicles.sessions (
  record_kind               string,
  session_id                string,
  first_seen                bigint,
  last_seen                 bigint,
  site_id                   string,
  landing_url               string,
  article_id                string,
  lander_v                  string,
  article_version_id        string,
  traffic_source            string,
  utm_source                string,
  utm_medium                string,
  utm_content               string,
  placement                 string,
  cpc                       string,
  fbclid                    string,
  fbc                       string,
  device                    string,
  os                        string,
  os_version                string,
  browser                   string,
  browser_version           string,
  country                   string,
  state                     string,
  city                      string,
  ip                        string,
  ua                        string,
  url                       string,
  referer                   string,
  language                  string,
  -- §31.9
  page_view_id              string,
  is_bot                    boolean,
  is_internal               boolean,
  is_preview                boolean,
  traffic_quality_flag      string
)
PARTITIONED BY (dt string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ('ignore.malformed.json' = 'true')
LOCATION 's3://__BUCKET__/listicles/events/'
TBLPROPERTIES (
  'projection.enabled' = 'true',
  'projection.dt.type' = 'date',
  'projection.dt.format' = 'yyyy/MM/dd',
  'projection.dt.range' = '2026/07/01,NOW',
  'projection.dt.interval' = '1',
  'projection.dt.interval.unit' = 'DAYS',
  'storage.location.template' = 's3://__BUCKET__/listicles/events/${dt}'
);

-- ---------------------------------------------------------------------------
-- App-level dead-letter audit records (§31.6; D1
-- listicle_event_dead_letter is the authoritative queryable copy).
-- ---------------------------------------------------------------------------
CREATE EXTERNAL TABLE IF NOT EXISTS listicles.dead_letter_records (
  record_kind  string,
  event_id     string,
  reason       string,
  payload_json string,
  received_at  bigint
)
PARTITIONED BY (dt string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ('ignore.malformed.json' = 'true')
LOCATION 's3://__BUCKET__/listicles/events/'
TBLPROPERTIES (
  'projection.enabled' = 'true',
  'projection.dt.type' = 'date',
  'projection.dt.format' = 'yyyy/MM/dd',
  'projection.dt.range' = '2026/07/01,NOW',
  'projection.dt.interval' = '1',
  'projection.dt.interval.unit' = 'DAYS',
  'storage.location.template' = 's3://__BUCKET__/listicles/events/${dt}'
);

-- ---------------------------------------------------------------------------
-- record_kind filter mechanics — the canonical query surfaces.
-- Every consumer (Phase-8 ClickHouse ingest, ad-hoc analysis, the §31.6
-- reconciliation count) MUST filter record_kind; the *_clean views also
-- apply the §31.8 default-analytics exclusion (raw tables stay the audit
-- view — "a raw unfiltered view is retained").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW listicles.events_only AS
SELECT * FROM listicles.events
WHERE record_kind = 'event';

CREATE OR REPLACE VIEW listicles.sessions_only AS
SELECT * FROM listicles.sessions
WHERE record_kind = 'session';

CREATE OR REPLACE VIEW listicles.events_clean AS
SELECT * FROM listicles.events
WHERE record_kind = 'event'
  AND traffic_quality_flag = 'clean';

CREATE OR REPLACE VIEW listicles.sessions_clean AS
SELECT * FROM listicles.sessions
WHERE record_kind = 'session'
  AND traffic_quality_flag = 'clean';

-- §31.6 reconciliation (Phase 8 wires this count back into the worker):
--   SELECT site_id, count(*) AS athena_landed
--   FROM listicles.events_only
--   WHERE dt = date_format(date_add('day', -1, current_date), '%Y/%m/%d')
--   GROUP BY site_id;
