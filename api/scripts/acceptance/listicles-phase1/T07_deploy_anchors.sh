#!/usr/bin/env bash
# Phase1.AC: every new migration filename is grep-anchored in deploy.yml
# (repo D1-file rule; contract §27 Phase 1 "migrations apply local+remote").
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
WF="$REPO_ROOT/.github/workflows/deploy.yml"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T07] $desc"
  else
    echo "FAIL [T07] $desc"
    FAIL=1
  fi
}

check "deploy.yml exists" test -f "$WF"
for f in 0032_listicles_core.sql 0033_listicles_analytics_mirror.sql 0034_listicles_revenue_infra.sql; do
  check "anchor for $f" grep -q "$f" "$WF"
done
check "staging migration apply step present" \
  grep -q "wrangler d1 migrations apply kodigital-homepages-cms-db --env staging --remote" "$WF"
check "production migration apply step present" \
  grep -q "wrangler d1 migrations apply kodigital-homepages-cms-db --env production --remote" "$WF"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
