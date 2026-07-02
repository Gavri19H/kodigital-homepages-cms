#!/usr/bin/env bash
# Phase1.AC: 0032 declares all 11 core tables (contract §6 + §30.7).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
MIG="$REPO_ROOT/api/migrations/0032_listicles_core.sql"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T02] $desc"
  else
    echo "FAIL [T02] $desc"
    FAIL=1
  fi
}

check "migration file exists" test -f "$MIG"
for t in listicle_offers listicle_sections listicle_section_offers listicle_section_link_instances \
         listicle_articles listicle_article_experiments listicle_article_versions listicle_pages \
         listicle_page_section_candidates listicle_page_rules listicle_offer_cap_counters; do
  check "table $t declared" grep -q "CREATE TABLE IF NOT EXISTS $t\b" "$MIG"
done
COUNT=$(grep -c "^CREATE TABLE IF NOT EXISTS listicle_" "$MIG")
check "exactly 11 CREATE TABLE statements (found $COUNT)" test "$COUNT" -eq 11

[ "$FAIL" -eq 0 ] || exit 1
exit 0
