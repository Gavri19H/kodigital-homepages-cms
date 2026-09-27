-- Ledger for the S3 -> ClickHouse event loader (src/analytics/event-loader.ts).
--
-- The LeadGen and Listicles Firehose streams write newline-delimited JSON
-- files to S3 (homepage-events bucket, leadgen/events/ + listicles/events/,
-- dt=YYYY-MM-DD/hr=HH/). Nothing ever loaded those files into the ClickHouse
-- raw tables (lg_events_raw / lg_sessions / lst_events_raw / lst_sessions) that
-- every analytics view reads, so every admin analytics mirror stayed at zero
-- rows. The loader runs on the every-minute cron and records each file it has
-- loaded here, so each run only fetches new files.
--
-- Correctness does NOT depend on this table: the ClickHouse raw tables are
-- ReplacingMergeTree and every view reads them FINAL, so a file loaded twice
-- collapses to the same rows. The ledger keeps the per-run work bounded and
-- gives an auditable per-file record (rows loaded, rows skipped, when).
CREATE TABLE IF NOT EXISTS analytics_event_files (
  stream          TEXT NOT NULL,              -- 'leadgen' | 'listicles'
  object_key      TEXT NOT NULL,              -- full S3 key
  dt              TEXT NOT NULL,              -- the key's dt= partition (YYYY-MM-DD)
  events_loaded   INTEGER NOT NULL DEFAULT 0,
  sessions_loaded INTEGER NOT NULL DEFAULT 0,
  records_skipped INTEGER NOT NULL DEFAULT 0, -- malformed / dead_letter / missing identity
  loaded_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (stream, object_key)
);
CREATE INDEX IF NOT EXISTS idx_analytics_event_files_stream_dt ON analytics_event_files (stream, dt);
