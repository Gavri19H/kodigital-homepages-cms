# LeadGen tracking — AWS provisioning (Firehose `leadgen-events` → S3 → Athena)

**Provisioned 2026-09-27 (owner-approved).** Before this, LeadGen's analytics
stream had never existed in AWS. Every `/lg/track`, `/lg/auction` and `/lg/lc`
event batch the Worker sent was refused with Firehose `AccessDeniedException`
(2,480 in the 7 days of Workers Logs retention, the oldest already failing),
S3 held nothing under `leadgen/`, there was no Glue database `leadgen`, and all
nine `leadgen_analytics_*` D1 mirrors had 0 rows.

Everything mirrors the LIVE `listicle-events` stream (itself a copy of
`homepage-events`), read with `DescribeDeliveryStream`, not the older
`infra/listicles/aws-provision.md` defaults.

## What exists now

| Item | Value |
|---|---|
| Stream | `leadgen-events`, DirectPut, us-east-1, ACTIVE |
| Bucket | `homepage-events-589426401114` (shared with homepage + listicles) |
| Prefix | `leadgen/events/dt=!{timestamp:yyyy-MM-dd}/hr=!{timestamp:HH}/` |
| Error prefix | `leadgen/dead-letter/firehose/!{firehose:error-output-type}/dt=!{timestamp:yyyy-MM-dd}/` |
| Buffering / compression | 5 MB / 60 s, UNCOMPRESSED (as listicle-events) |
| Delivery role | `homepage-firehose-role` (its S3 policy already covers the whole bucket) |
| Producer permission | inline policy `leadgen-events-firehose-put` on IAM user `kodigital-dashboard-athena` (the Worker's `AWS_ACCESS_KEY_ID`): `firehose:PutRecord` + `firehose:PutRecordBatch` on this stream only. Separate policy, so `homepage-events-firehose-put` is untouched and the grant is removable on its own. |
| Athena | Glue DB `leadgen`: `events`, `sessions`, `dead_letter_records` + views `events_only`, `sessions_only`, `events_clean`, `sessions_clean`, created from `athena-ddl.sql` with `__BUCKET__` substituted, workgroup `primary`, results to `s3://ko-stats/athena-query-outputlogs/` |

## The layout correction

`athena-ddl.sql` previously projected `dt` as `yyyy/MM/dd` under
`leadgen/events/${dt}` — Firehose's default prefix, which none of these
streams use. Tables built from it would have matched zero objects. It now
mirrors `homepage.events`: `dt` (`yyyy-MM-dd`) + `hr` (two-digit 0–23) over
`leadgen/events/dt=${dt}/hr=${hr}`.

## Proof it runs (2026-09-27)

A real visit to `moneylantern.com/lg/business-loans?utm_source=qa_probe` →
object `leadgen/events/dt=2026-09-27/hr=10/leadgen-events-1-2026-09-27-10-33-20-…`
(3 records) → Athena `leadgen.events_only` returned its `quote_view` +
`section_view`, `leadgen.sessions_only` its session.

## Not provisioned here (still open)

- **Athena → ClickHouse ingest** (`lg_events_raw` / `lg_sessions`,
  `clickhouse-apply.md` "ops-owned"). It does not exist in this repo or in the
  dashboard repo. Until it does, the `lg_*_daily` MVs and the nine D1 mirrors
  stay empty.
- **Worker ClickHouse secrets** `CH_URL` / `CH_USER` / `CH_PASSWORD` are not set
  in production, so the every-minute mirror sync is a structured no-op.

## Undo

`aws firehose delete-delivery-stream --delivery-stream-name leadgen-events`,
`aws iam delete-user-policy --user-name kodigital-dashboard-athena --policy-name leadgen-events-firehose-put`,
`DROP DATABASE leadgen CASCADE` (Athena; external tables — S3 objects stay).
