#!/usr/bin/env bash
# Phase8.AC T02 (§18/§30.7/§31.6/§24): the CH client + mirror-sync exist and
# are wired — the every-minute cron calls syncListicleAnalytics isolated, the
# §18 ON CONFLICT upsert + ≤80 chunk + DEV-6 offer_id→offer_public_id map are
# present, the rebuild-range + link-instance routes are registered, the CH
# secrets are typed in env.ts (NOT in wrangler.toml), the reconciliation reads
# ch_ingested from CH, and the apply doc documents the curl + wrangler secrets.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T02] $desc"; else echo "FAIL [T02] $desc"; FAIL=1; fi
}

CH="$REPO_ROOT/api/src/listicles/clickhouse.ts"
SYNC="$REPO_ROOT/api/src/listicles/mirror-sync.ts"
INDEX="$REPO_ROOT/api/src/index.ts"
ENVTS="$REPO_ROOT/api/src/env.ts"
ROUTER="$REPO_ROOT/api/src/admin/listicles/router.ts"
HANDLERS="$REPO_ROOT/api/src/admin/listicles/analytics-admin-handlers.ts"
RECON="$REPO_ROOT/api/src/analytics/listicle-reconciliation.ts"
WRANGLER="$REPO_ROOT/api/wrangler.toml"
APPLY="$REPO_ROOT/infra/listicles/clickhouse-apply.md"

# --- CH client (§17/§18) -----------------------------------------------------
check "clickhouse.ts exists" test -f "$CH"
check "CH client: createListicleChClient + chCredentialsConfigured exported" \
  bash -c "grep -q 'export function createListicleChClient' '$CH' && grep -q 'export function chCredentialsConfigured' '$CH'"
check "CH client: X-ClickHouse-User/Key headers + FORMAT JSONEachRow" \
  bash -c "grep -q 'X-ClickHouse-User' '$CH' && grep -q 'X-ClickHouse-Key' '$CH' && grep -q 'FORMAT JSONEachRow' '$CH'"
check "CH client: FINAL-aware + 64-bit ints as numbers settings" \
  bash -c "grep -q 'do_not_merge_across_partitions_select_final' '$CH' && grep -q 'output_format_json_quote_64bit_integers' '$CH'"
check "CH client: reads CH_URL/CH_USER/CH_PASSWORD + no-op on missing creds" \
  bash -c "grep -q 'CH_URL' '$CH' && grep -q 'CH_USER' '$CH' && grep -q 'CH_PASSWORD' '$CH' && grep -q 'configured: false' '$CH'"

# --- mirror-sync (§18) -------------------------------------------------------
check "mirror-sync.ts exists" test -f "$SYNC"
check "exports syncListicleAnalytics + rebuildRange + readChCleanEventCount" \
  bash -c "grep -q 'export async function syncListicleAnalytics' '$SYNC' && grep -q 'export async function rebuildRange' '$SYNC' && grep -q 'export async function readChCleanEventCount' '$SYNC'"
check "§18 idempotent upsert: ON CONFLICT … DO UPDATE + unixepoch()" \
  bash -c "grep -q 'ON CONFLICT' '$SYNC' && grep -q 'DO UPDATE SET' '$SYNC' && grep -q 'unixepoch()' '$SYNC'"
check "the five D1 mirrors are the sync targets" \
  bash -c "grep -q 'listicle_analytics_offer' '$SYNC' && grep -q 'listicle_analytics_section' '$SYNC' && grep -q 'listicle_analytics_article' '$SYNC' && grep -q 'listicle_analytics_drilldown' '$SYNC' && grep -q 'listicle_analytics_link_instance' '$SYNC'"
check "reads the five CH daily tables FINAL" \
  bash -c "grep -q 'lst_offer_daily' '$SYNC' && grep -q 'lst_section_daily' '$SYNC' && grep -q 'lst_article_daily' '$SYNC' && grep -q 'lst_drilldown_daily' '$SYNC' && grep -q 'lst_link_instance_daily' '$SYNC' && grep -q 'FINAL' '$SYNC'"
check "≤80-row chunk (D1 100-binding limit)" grep -q "D1_BATCH_ROWS = 80" "$SYNC"
check "DEV-6 offer_id → offer_public_id mapping" \
  bash -c "grep -q 'd1: \"offer_public_id\", ch: \"offer_id\"' '$SYNC'"
check "per-table error isolation (own try/catch) + fail-open no-op" \
  bash -c "grep -q 'configured: false' '$SYNC' && grep -q 'errors' '$SYNC'"
check "rolling window today+yesterday (24h back)" grep -q "24 \* 60 \* 60 \* 1000" "$SYNC"

# --- cron wiring (index.ts) --------------------------------------------------
check "index.ts imports syncListicleAnalytics" grep -q "import { syncListicleAnalytics }" "$INDEX"
check "index.ts scheduled() calls syncListicleAnalytics(env) in its own try/catch" \
  bash -c "grep -q 'await syncListicleAnalytics(env)' '$INDEX' && grep -q 'mirror sync must never break' '$INDEX'"
check "homepage/publish crons still present (byte-untouched siblings)" \
  bash -c "grep -q 'processScheduledArticles' '$INDEX' && grep -q 'driveInProgressProvisioning' '$INDEX' && grep -q 'listicleDailyReconciliation' '$INDEX'"

# --- secret typing (env.ts) — NOT in wrangler.toml ---------------------------
check "env.ts types CH_URL/CH_USER/CH_PASSWORD as optional secrets" \
  bash -c "grep -q 'CH_URL?: string' '$ENVTS' && grep -q 'CH_USER?: string' '$ENVTS' && grep -q 'CH_PASSWORD?: string' '$ENVTS'"
check "CH secrets are NOT in wrangler.toml (encrypted-secret discipline)" \
  bash -c "! grep -Eq 'CH_URL|CH_USER|CH_PASSWORD' '$WRANGLER'"

# --- rebuild-range + link-instance routes ------------------------------------
check "analytics-admin-handlers.ts exists" test -f "$HANDLERS"
check "rebuild-range route registered" \
  bash -c "grep -q '/analytics/rebuild-range' '$ROUTER' && grep -q 'rebuildAnalyticsRangeHandler' '$ROUTER'"
check "link-instance read route registered (§30.7)" \
  bash -c "grep -q '/articles/:id/link-instances' '$ROUTER' && grep -q 'articleLinkInstancesHandler' '$ROUTER'"
check "rebuild-range handler calls rebuildRange" grep -q "rebuildRange(c.env" "$HANDLERS"
check "link-instance read uses NULLIF read-time ratios" \
  bash -c "grep -q 'NULLIF' '$HANDLERS' && grep -q 'listicle_analytics_link_instance' '$HANDLERS'"

# --- reconciliation ch_ingested wiring (§31.6) -------------------------------
check "reconciliation reads ch_ingested via readChCleanEventCount" \
  bash -c "grep -q 'readChCleanEventCount' '$RECON' && grep -q 'ch_ingested' '$RECON'"
check "athena_landed stays honest NULL (external pipeline owns Athena)" \
  bash -c "grep -q 'athena_landed' '$RECON' && grep -q 'external' '$RECON'"

# --- apply doc ---------------------------------------------------------------
check "clickhouse-apply.md exists" test -f "$APPLY"
check "apply doc: curl over CH HTTP with X-ClickHouse headers + --data-binary" \
  bash -c "grep -q 'X-ClickHouse-User' '$APPLY' && grep -q 'X-ClickHouse-Key' '$APPLY' && grep -q -- '--data-binary' '$APPLY'"
check "apply doc: the 3 secrets + wrangler secret put deploy.yml step" \
  bash -c "grep -q 'CH_URL' '$APPLY' && grep -q 'CH_PASSWORD' '$APPLY' && grep -q 'wrangler secret put' '$APPLY'"

exit $FAIL
