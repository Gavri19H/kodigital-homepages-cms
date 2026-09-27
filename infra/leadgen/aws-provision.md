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

## ClickHouse (provisioned 2026-09-27, same approval)

- **Tables:** every object in `clickhouse-ddl.sql` applied to the shared
  ClickHouse Cloud service (`default` database, alongside the dashboard's and
  the listicles' tables): 13 tables + 10 refreshable views, all refreshing
  without error. The DDL had never been applied and had one defect —
  `lg_answer_distribution_daily_mv` read `continued_to_next_section`, which
  `lg_events_raw` did not define, so the view failed to create; the column is
  now in the DDL (both vendored copies) and was added live with
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
- **Login:** `kodigital_cms_runtime` (one login per role, like move-club's
  `*_runtime` users). SELECT on `default.lg_*` + `default.lst_*`; INSERT on
  exactly the six raw tables the Worker writes (`lg_events_raw`, `lg_sessions`,
  `lg_revenue_raw`, `lst_events_raw`, `lst_sessions`, `lst_revenue_raw`).
  Verified refused (code 497) on the dashboard's `auction_events`, on
  move-club, and on writing a daily table. Its URL/user/password live only in
  `~/.config/kodigital-cms/ch-worker.env` (0600) and, once installed, in the
  Worker secrets `CH_URL` / `CH_USER` / `CH_PASSWORD`.
- **Loader:** `api/src/analytics/event-loader.ts` on the every-minute cron —
  the "external Athena→CH ingest" this doc used to list as missing. It reads
  the S3 files directly (the Worker's AWS user has read-only
  `cms-event-loader-s3-read` on `leadgen/events/*` + `listicles/events/*`
  only) and records each loaded file in D1 `analytics_event_files` (0059).
- **Proof:** the loader run from a workstation with the Worker's own AWS
  identity and the new login loaded the two real files (LeadGen 2 events +
  1 session, listicles 1 + 1); two minutes later `lg_quote_daily` showed the
  quote's visit, `lg_section_daily` its section view with 0 user answers, and
  `lst_article_daily` the article view.

## Undo

`aws firehose delete-delivery-stream --delivery-stream-name leadgen-events`,
`aws iam delete-user-policy --user-name kodigital-dashboard-athena --policy-name leadgen-events-firehose-put`,
`DROP DATABASE leadgen CASCADE` (Athena; external tables — S3 objects stay),
`aws iam delete-user-policy --user-name kodigital-dashboard-athena --policy-name cms-event-loader-s3-read`,
`DROP USER kodigital_cms_runtime` (ClickHouse).
