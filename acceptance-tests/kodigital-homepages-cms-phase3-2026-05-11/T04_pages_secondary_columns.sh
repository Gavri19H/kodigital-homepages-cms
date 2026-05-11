#!/usr/bin/env bash
# T4.AC: ALTERs add site_id to pages/media/tags/redirects and page_type to pages.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T4] $desc"; else echo "FAIL [T4] $desc"; FAIL=1; fi
}
MIG="$REPO_ROOT/api/migrations/0002_phase3_multi_site_schema.sql"
check "migration exists" test -f "$MIG"
for tbl in pages media tags redirects; do
  check "$tbl ADD COLUMN site_id" grep -qE "ALTER TABLE $tbl ADD COLUMN site_id\\b" "$MIG"
done
check "pages ADD COLUMN page_type DEFAULT 'generic'" grep -qE "ALTER TABLE pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'generic'" "$MIG"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
