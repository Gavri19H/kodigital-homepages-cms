#!/usr/bin/env bash
# Phase1.AC: revenue/platform/data-quality infra (contract §19 / §20 / §31.7 / §31.9).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
MIG="$REPO_ROOT/api/migrations/0034_listicles_revenue_infra.sql"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T06] $desc"
  else
    echo "FAIL [T06] $desc"
    FAIL=1
  fi
}

check "migration file exists" test -f "$MIG"
for t in listicle_media_platforms listicle_postback_log listicle_revenue_raw \
         listicle_revenue_unmatched listicle_event_dead_letter listicle_fx_rates; do
  check "table $t declared" grep -q "CREATE TABLE IF NOT EXISTS $t\b" "$MIG"
done
COUNT=$(grep -c "^CREATE TABLE IF NOT EXISTS listicle_" "$MIG")
check "exactly 6 tables (found $COUNT)" test "$COUNT" -eq 6

check "postback dedupe UNIQUE (provider, external_txn_id) (§31.7)" \
  grep -q "UNIQUE (provider, external_txn_id)" "$MIG"
check "revenue_raw source CHECK matches CH enum (§17.1)" \
  grep -q "CHECK (source IN ('s2s_postback','api','script','in_site'))" "$MIG"
check "revenue_raw new-rows marker (synced_to_ch_at)" \
  grep -q "synced_to_ch_at" "$MIG"
check "unmatched carries revenue_usd (§31.9)" \
  grep -q "revenue_usd" "$MIG"
check "unmatched 72h lifecycle status" \
  grep -q "CHECK (status IN ('pending','matched','unattributed'))" "$MIG"
check "fx_rates PK (date, currency)" \
  grep -q "PRIMARY KEY (date, currency)" "$MIG"
check "media_platforms postback_url_template" \
  grep -q "postback_url_template TEXT NOT NULL" "$MIG"
check "media_platforms auth_secret_ref (secret NAME, not value)" \
  grep -q "auth_secret_ref TEXT" "$MIG"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
