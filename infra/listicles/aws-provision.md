# Listicles tracking — AWS provisioning (Firehose `listicle-events` → S3 → Athena)

Design contract §16 / §28 Q3 / §31.6. **Executed by the conductor (aws-mcp /
console)** — the worker code is already deployed-ready and **NO-OPs until this
stream exists** (exactly like the homepage pipeline when creds are absent:
`emitListicleRecords` returns `{status:"noop"}` when
`LISTICLE_EVENTS_FIREHOSE_STREAM` / AWS creds are unset or the PutRecordBatch
fails — a missing stream can never break a page or a click).

Everything mirrors the existing `homepage-events` pipeline: same AWS account,
same region (`us-east-1`, wrangler.toml `AWS_REGION`), same access-key pair
(the worker secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are REUSED —
no new secret), same S3 bucket, same newline-delimited-JSON record format
(`api/src/analytics/firehose.ts` appends `\n` per record and both pipelines
share that function).

## 0. Facts the worker side already pins

| Item | Value |
|---|---|
| Stream name | `listicle-events` (wrangler.toml `LISTICLE_EVENTS_FIREHOSE_STREAM`, all 3 env blocks) |
| Record format | one JSON object per record + trailing `\n` (PutRecordBatch, base64) |
| Record kinds | every record carries `record_kind`: `"event"` \| `"session"` \| `"dead_letter"` — the discriminator the Athena DDL selects on (see athena-ddl.sql) |
| Region | `us-east-1` |
| Producer IAM action needed | `firehose:PutRecordBatch` on the new stream, for the SAME IAM user the homepage stream uses |

## 1. S3 layout (same bucket as `homepage-events`)

Let `$BUCKET` = the bucket the `homepage-events` stream delivers to (look it
up: `aws firehose describe-delivery-stream --delivery-stream-name
homepage-events --query
"DeliveryStreamDescription.Destinations[0].ExtendedS3DestinationDescription.{Bucket:BucketARN,Prefix:Prefix,Err:ErrorOutputPrefix,Buffer:BufferingHints,Role:RoleARN}"`).

| Purpose | Prefix |
|---|---|
| Delivered records (events + sessions + app-level dead-letter audit records, discriminated by `record_kind`) | `listicles/events/` |
| Firehose-level failures (ErrorOutputPrefix) | `listicles/dead-letter/firehose/` |

**Dead-letter layering (authored, documented):** §31.6's "dead-letter S3
prefix `listicles/dead-letter/`" is implemented on two levels:
1. **App-level** invalid/oversized events → a D1 `listicle_event_dead_letter`
   row (authoritative, queryable) **plus** a `record_kind:"dead_letter"`
   audit record on this same stream (so S3 retains the raw payload). The
   Athena `listicles.events`/`sessions` tables filter on `record_kind`, so
   dead-letters never pollute analytics.
2. **Firehose-level** delivery/processing failures → the stream's
   `ErrorOutputPrefix` = `listicles/dead-letter/firehose/`.
Physically routing app-level dead-letters to their own prefix would require
Firehose dynamic partitioning, whose 64 MB minimum buffer contradicts
"buffering like the homepage stream" — if you prefer physical separation,
enable dynamic partitioning on `.record_kind` instead and set the prefix to
`listicles/!{partitionKeyFromQuery:record_kind}/` (then point the Athena
tables at `listicles/event/` + `listicles/session/` and drop the
`record_kind` predicate). The DDL as shipped assumes the simple (homepage-
like) fixed prefix.

## 2. Create the delivery stream

Reuse the homepage stream's delivery role (`$ROLE_ARN` from step 1's
describe call) — it already grants S3 write on `$BUCKET`; the bucket-key
prefix is not constrained by the standard firehose role policy. If the role
policy pins `homepage/*` prefixes, clone the role and widen the `Resource`
to `arn:aws:s3:::$BUCKET/listicles/*` as well.

```bash
aws firehose create-delivery-stream \
  --region us-east-1 \
  --delivery-stream-name listicle-events \
  --delivery-stream-type DirectPut \
  --extended-s3-destination-configuration '{
    "RoleARN": "'"$ROLE_ARN"'",
    "BucketARN": "arn:aws:s3:::'"$BUCKET"'",
    "Prefix": "listicles/events/",
    "ErrorOutputPrefix": "listicles/dead-letter/firehose/",
    "BufferingHints": { "SizeInMBs": 5, "IntervalInSeconds": 300 },
    "CompressionFormat": "GZIP"
  }'
```

- **BufferingHints / CompressionFormat:** set them to WHATEVER the
  `homepage-events` describe call reported ("buffering like the homepage
  stream"); `5 MB / 300 s / GZIP` above are the common defaults — replace
  from the describe output if it differs. If homepage delivers UNCOMPRESSED,
  use `"CompressionFormat": "UNCOMPRESSED"` here too and mirror that choice
  in the Athena DDL (GZIP vs plain is transparent to the JSON SerDe either
  way — `.gz` objects are auto-decompressed).
- Verify: `aws firehose describe-delivery-stream --delivery-stream-name
  listicle-events --query "DeliveryStreamDescription.DeliveryStreamStatus"`
  → `"ACTIVE"`.

## 3. Producer IAM (the worker's access key)

Attach (or extend) the policy of the IAM user whose keys live in the worker
secrets:

```json
{
  "Effect": "Allow",
  "Action": ["firehose:PutRecordBatch", "firehose:PutRecord"],
  "Resource": "arn:aws:firehose:us-east-1:<ACCOUNT_ID>:deliverystream/listicle-events"
}
```

(No worker secret changes — the same `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` sign both streams.)

## 4. Glue database + Athena tables

```bash
aws glue create-database --database-input '{"Name":"listicles"}'
```

Then run every statement in `infra/listicles/athena-ddl.sql` (Athena query
editor or `aws athena start-query-execution`), after substituting
`__BUCKET__` with `$BUCKET`. The DDL creates:
- `listicles.events` — external table over `s3://$BUCKET/listicles/events/`,
  every §16 event column (+ §30.7 link dims + §31.9 quality columns +
  `record_kind`), JSON SerDe, **date partition projection** over Firehose's
  `YYYY/MM/DD/HH` key layout;
- `listicles.sessions` — same location, §16 session columns, `record_kind`
  filtered;
- `listicles.events_clean` / `listicles.sessions_clean` views — the §31.8
  default-analytics surface (non-clean traffic excluded; raw tables remain
  the audit view);
- `listicles.dead_letter_records` — the app-level dead-letter audit records.

**Partition-projection note:** the homepage `homepage.events` table predates
this repo; if it does NOT use partition projection (check
`SHOW CREATE TABLE homepage.events`), the projection block in the DDL can be
dropped wholesale — the tables work unpartitioned (full-prefix scans) and the
projection is a pure cost optimization, not a correctness requirement.

## 5. Smoke test (post-provision)

1. Send one live event through the worker:
   `curl -X POST https://<tenant-host>/api/lst/track -H 'content-type: application/json' -d '{"event_type":"page_view","event_id":"smoke-1","session_id":"smoke","site_id":"smoke-site","url":"https://x/y"}'`
   → expect `204`.
2. Wait one buffering interval (≤5 min), then:
   `SELECT event_id, event_type, record_kind FROM listicles.events WHERE event_id = 'smoke-1';`
   → 1 row. (`SELECT count(*) FROM listicles.sessions` should also show the
   page_view's session record.)
3. Worker-side observability: `wrangler tail` shows
   `[firehose] Sent 2 records, 0 failed` once creds+stream resolve (and the
   structured no-op disappears).

## 6. What stays untouched

`homepage-events`, its S3 prefixes, `homepage.events`, the `/api/track`
route, `analytics/{events,firehose,router,tracking-script}.ts` — all
byte-identical to pre-Phase-7.
