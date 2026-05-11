#!/usr/bin/env bash
# T3.AC: articles ALTER adds site_id, homepage_section ('none'), homepage_rank, seo_title, seo_description, ai_generation_id
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T3] $desc"; else echo "FAIL [T3] $desc"; FAIL=1; fi
}
MIG="$REPO_ROOT/api/migrations/0002_phase3_multi_site_schema.sql"
check "migration exists" test -f "$MIG"
for col in site_id homepage_section homepage_rank seo_title seo_description ai_generation_id; do
  check "articles.$col ALTER present" grep -qE "ALTER TABLE articles ADD COLUMN $col\\b" "$MIG"
done
check "homepage_section default 'none'" grep -q "homepage_section TEXT NOT NULL DEFAULT 'none'" "$MIG"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
