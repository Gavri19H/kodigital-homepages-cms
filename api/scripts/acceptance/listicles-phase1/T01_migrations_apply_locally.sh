#!/usr/bin/env bash
# Phase1.AC: the three listicle migrations exist with unique numbering and apply
# cleanly to a local D1 (contract §6 / §27 Phase 1).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T01] $desc"
  else
    echo "FAIL [T01] $desc"
    FAIL=1
  fi
}

MIG_DIR="$REPO_ROOT/api/migrations"
for f in 0032_listicles_core.sql 0033_listicles_analytics_mirror.sql 0034_listicles_revenue_infra.sql; do
  check "migration $f exists" test -f "$MIG_DIR/$f"
done

# numbering continuity: exactly one file per prefix 0032/0033/0034
for n in 0032 0033 0034; do
  COUNT=$(ls "$MIG_DIR" | grep -c "^${n}_")
  check "exactly one migration numbered $n (found $COUNT)" test "$COUNT" -eq 1
done

[ "$FAIL" -eq 0 ] || exit 1

# BEHAVIORAL: apply to local D1 + count listicle_ tables (22 expected: 11+5+6)
if ! command -v npx >/dev/null 2>&1 || [ ! -d "$REPO_ROOT/api/node_modules" ]; then
  echo "INFO [T01] behavioral wrangler apply not run (NEEDS_RUNTIME)"
  exit 2
fi
cd "$REPO_ROOT/api" || exit 1
if ! npx wrangler d1 migrations apply kodigital-homepages-cms-db --local >/dev/null 2>&1; then
  echo "FAIL [T01] wrangler d1 migrations apply --local"
  exit 1
fi
echo "PASS [T01] wrangler d1 migrations apply --local"
TABLES=$(npx wrangler d1 execute kodigital-homepages-cms-db --local --json \
  --command "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name LIKE 'listicle_%'" 2>/dev/null \
  | grep -o '"c": *[0-9]*' | grep -o '[0-9]*' | head -1)
if [ "${TABLES:-0}" -eq 22 ]; then
  echo "PASS [T01] 22 listicle_ tables exist in local D1"
else
  echo "FAIL [T01] expected 22 listicle_ tables, found ${TABLES:-0}"
  exit 1
fi
exit 0
