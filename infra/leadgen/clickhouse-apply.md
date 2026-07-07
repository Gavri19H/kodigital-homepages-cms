# LeadGen ClickHouse + Athena — ops-owned apply (contract 08 §23/§24)

The LeadGen analytics pipeline is **Athena → ClickHouse → D1**. The Worker only
**reads** ClickHouse (to fill the 9 `leadgen_analytics_*` D1 mirrors) and never
writes it. Applying the DDL and running the Athena→CH ingest are **ops-owned**
steps performed outside the Worker deploy.

Files in this directory (vendored verbatim from the approved contract SSOT
`docs/leadgen/contract/infra/`; keep byte-identical):

- `clickhouse-ddl.sql` — `lg_events_raw`, `lg_sessions`, `lg_revenue_raw`,
  `lg_revenue_attributed` (+ its refresh MV), and the 9 daily target tables +
  their `REFRESH EVERY 2 MINUTE ... TO` materialized views: `lg_offer_daily`,
  `lg_section_daily`, `lg_answer_distribution_daily`, `lg_quote_daily`,
  `lg_quote_drilldown_daily`, `lg_auction_daily`, `lg_auction_drilldown_daily`,
  `lg_carrier_daily`, `lg_provider_diagnostics_daily`.
- `athena-ddl.sql` — the Athena external-table / view definitions the Firehose
  `leadgen-events` stream lands into, feeding the CH ingest.

## Apply the ClickHouse DDL (ops)

Run against the shared ClickHouse instance (the same instance the listicles
`lg_`-sibling `lst_` tables live on — LeadGen adds only `lg_*` objects):

```sh
clickhouse-client --host "$CH_HOST" --user "$CH_USER" --password "$CH_PASSWORD" \
  --multiquery < infra/leadgen/clickhouse-ddl.sql
```

Conventions the DDL follows (do not alter): `ReplacingMergeTree`,
`PARTITION BY toYYYYMM(dt)`, `LowCardinality`, explicit `AS` aliases,
`clean`-only default aggregation (`traffic_quality_flag='clean'`), ratios
computed at read (NULLIF). Column names are the dashboard-join contract and are
STABLE (`traffic_source/utm_*/placement/click_id/offer_id`).

## Worker secrets (wrangler-encrypted — NEVER in wrangler.toml/.env/committed files)

The Worker's CH read client (`api/src/leadgen/clickhouse.ts`) reuses the shared
CH connection secrets:

- `CH_URL` — ClickHouse HTTP endpoint.
- `CH_USER`
- `CH_PASSWORD`

Set them as encrypted Worker secrets (Dashboard or `wrangler secret put`).
**Absent any of the three ⇒ the mirror sync is a structured no-op** — the
every-minute cron logs a skip and writes nothing; nothing breaks.

## Sync behavior (Worker — automatic)

`syncLeadgenAnalytics(env)` runs on the every-minute `scheduled` cron
(`api/src/index.ts`), isolated in its own try/catch and fail-open. It reads each
`lg_*_daily` (`FINAL`, bounded rolling window) and `ON CONFLICT DO UPDATE`
upserts into the matching `leadgen_analytics_*` D1 mirror (batch ≤ 80 rows;
`offer_id`→`offer_public_id`, `auction_config_id`→`auction_public_id`, etc.).
A wider manual backfill is available at
`POST /api/admin/leadgen/analytics/rebuild-range { from, to }` (admin-gated).

## OQ-3 — the ingest is ops-owned (mirror rows BLOCKED-on-external until it runs)

Until ops (a) applies this DDL and (b) runs the Athena→CH ingest that populates
`lg_events_raw`/`lg_revenue_raw` from the Firehose `leadgen-events` stream, the
`lg_*_daily` MVs are empty and the D1 mirrors stay at zero rows. The Worker code
+ tests are green (mocked CH + seeded D1 prove the sync); the **live** mirror
numbers are BLOCKED-on-external and are not claimed PASS until the feed runs.
Revenue tables (`lg_revenue_raw`/`lg_revenue_attributed`) light up with Phase 13.
