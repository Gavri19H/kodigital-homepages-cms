# Listicles ClickHouse — apply + secrets (Phase 8, conductor/operator runbook)

The CMS worker **never** runs ClickHouse DDL or `wrangler secret put`. This doc
is the exact recipe for the conductor/operator to (1) apply the CH schema and
(2) set the three worker secrets. The worker only **reads** the CH target
tables to fill the five `listicle_analytics_*` D1 mirrors (§18) and **no-ops
gracefully** until the secrets exist + the external Athena→CH pipeline lands
data.

## 0. What feeds these tables (ownership)

- **DDL** (this repo): `infra/listicles/clickhouse-ddl.sql` — the raw tables,
  the revenue-attribution MV, and the five daily targets + MVs.
- **Ingestion** (data/ops, EXTERNAL — not this repo): the Athena→CH job that
  copies `listicles.events_only` → `lst_events_raw`, `listicles.sessions_only`
  → `lst_sessions`, and the §19 provider-revenue shipper → `lst_revenue_raw`.
  Exactly like `homepage-events → Athena`, this repo does not run it.
- **Read** (this repo, Phase 8): `syncListicleAnalytics(env)` on the
  every-minute cron reads the CH daily tables → upserts the D1 mirrors.

## 1. Apply the DDL over the CH HTTP interface

CH Cloud, user `default`, database `$CH_DATABASE`. Auth via the
`X-ClickHouse-User` / `X-ClickHouse-Key` headers; body via `--data-binary`.
The HTTP endpoint runs ONE statement per request, so split the file on `;`.
Every statement is `IF NOT EXISTS`, so re-applying is safe.

```bash
# Env for this shell (do NOT commit these values):
export CH_URL="https://<your-ch-host>:8443"     # CH Cloud HTTPS endpoint
export CH_USER="default"
export CH_PASSWORD="<the CH Cloud password>"
export CH_DATABASE="<the CH database>"

# Apply every statement in clickhouse-ddl.sql, one request per `;`-terminated
# statement (awk splits on ';' at line ends; comments are ignored by CH):
awk 'BEGIN{RS=";\n"} /[^[:space:]]/ {print $0 ";"}' infra/listicles/clickhouse-ddl.sql \
| while IFS= read -r -d '' _unused 2>/dev/null || true; do :; done  # (see note)

# Simpler + robust: send the whole file statement-by-statement with clickhouse-client
# semantics via HTTP. One-liner per statement:
csplit -s -z -f /tmp/ch_stmt_ infra/listicles/clickhouse-ddl.sql '/;/' '{*}' 2>/dev/null || true
for f in /tmp/ch_stmt_*; do
  sql="$(sed 's/^[[:space:]]*--.*$//' "$f")"
  [ -z "$(printf '%s' "$sql" | tr -d '[:space:];')" ] && continue
  curl -sS --fail-with-body \
    "$CH_URL/?database=$CH_DATABASE" \
    -H "X-ClickHouse-User: $CH_USER" \
    -H "X-ClickHouse-Key: $CH_PASSWORD" \
    --data-binary "$sql" || { echo "FAILED on: $f"; break; }
done
```

Single-statement smoke (verify a target exists after apply):

```bash
curl -sS "$CH_URL/?database=$CH_DATABASE" \
  -H "X-ClickHouse-User: $CH_USER" -H "X-ClickHouse-Key: $CH_PASSWORD" \
  --data-binary "SHOW TABLES LIKE 'lst_%' FORMAT JSONEachRow"
# expect: lst_events_raw, lst_sessions, lst_revenue_raw, lst_revenue_attributed,
#         lst_offer_daily, lst_section_daily, lst_article_daily,
#         lst_drilldown_daily, lst_link_instance_daily (+ the *_mv views)
```

## 2. Set the three worker secrets

All three are **encrypted secrets** — Dashboard/CI only, **never** in
`wrangler.toml [vars]`, `.env`, or any committed file (deploy-safety.md). They
are declared as OPTIONAL fields in `api/src/env.ts` so the worker no-ops when
absent.

| Secret | Value |
|---|---|
| `CH_URL` | the CH Cloud HTTPS endpoint (e.g. `https://<host>:8443`) |
| `CH_USER` | `default` |
| `CH_PASSWORD` | the CH Cloud password |

### 2a. Local dev (`.dev.vars`, gitignored)

```
CH_URL="https://<host>:8443"
CH_USER="default"
CH_PASSWORD="<password>"
```

### 2b. CI / production — GitHub secrets + a deploy.yml `wrangler secret put` step

The conductor sets the GH secrets and adds a secret-push step to
`.github/workflows/deploy.yml` (this repo's worker code does NOT touch it).

```bash
# Store the values as GitHub Actions secrets (per env):
gh secret set CH_URL       --body "https://<host>:8443"
gh secret set CH_USER      --body "default"
gh secret set CH_PASSWORD  --body "<password>"
```

Add (conductor) to the production deploy job in `deploy.yml`, BEFORE
`Deploy to production` and AFTER the D1 migration step:

```yaml
      - name: Push ClickHouse secrets (production)
        run: |
          printf '%s' "${{ secrets.CH_URL }}"      | npx wrangler secret put CH_URL      --env production
          printf '%s' "${{ secrets.CH_USER }}"     | npx wrangler secret put CH_USER     --env production
          printf '%s' "${{ secrets.CH_PASSWORD }}" | npx wrangler secret put CH_PASSWORD --env production
```

(Mirror the same three lines under the staging deploy job with `--env staging`.)

## 3. Verify after deploy

- The every-minute cron logs `[lst-mirror-sync] no-op: CH credentials absent`
  until the secrets land, then rows start appearing in the D1 mirrors.
- Manual backfill (admin, behind CF Access): `POST /api/admin/listicles/analytics/rebuild-range {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}`
  returns a summary `{ rebuild: { configured, mirrors[], total_rows, errors[] } }`.
- The admin analytics columns/drilldown light up once the mirrors have rows
  (no code change — the Phase-2/3/5 read path already renders them).

## 4. Honest residual

No rows exist in CH until the external Athena→CH pipeline runs. The Phase-8
sync + tests are proven against **seeded D1 mirrors + a mocked CH client**, not
live CH data.
