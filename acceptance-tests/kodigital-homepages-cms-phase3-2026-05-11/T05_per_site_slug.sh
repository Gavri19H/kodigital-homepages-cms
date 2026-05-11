#!/usr/bin/env bash
# T5.AC: per-site UNIQUE indexes on articles.slug and pages.slug.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T5] $desc"; else echo "FAIL [T5] $desc"; FAIL=1; fi
}
MIG="$REPO_ROOT/api/migrations/0002_phase3_multi_site_schema.sql"
check "migration exists" test -f "$MIG"
check "articles per-site slug UNIQUE" grep -qE "CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_site_slug_unique ON articles\\(site_id, slug\\)" "$MIG"
check "pages per-site slug UNIQUE" grep -qE "CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_site_slug_unique ON pages\\(site_id, slug\\)" "$MIG"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
