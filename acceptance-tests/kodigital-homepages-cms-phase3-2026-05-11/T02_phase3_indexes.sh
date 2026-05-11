#!/usr/bin/env bash
# T2.AC: All required composite indexes declared in 0002 (>=13 idx_* names).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T2] $desc"; else echo "FAIL [T2] $desc"; FAIL=1; fi
}
MIG="$REPO_ROOT/api/migrations/0002_phase3_multi_site_schema.sql"
check "migration exists" test -f "$MIG"
COUNT=$(grep -cE "^CREATE (UNIQUE )?INDEX[[:space:]]+IF NOT EXISTS[[:space:]]+idx_" "$MIG" || true)
check "at least 13 idx_* indexes in 0002 (got $COUNT)" test "$COUNT" -ge 13
for idx in idx_articles_site_status_pub idx_articles_site_category_status_pub \
           idx_articles_site_featured idx_articles_site_trending \
           idx_articles_site_homepage_section idx_pages_site_slug \
           idx_pages_site_type idx_settings_site_key idx_domains_hostname \
           idx_site_categories_site_order idx_category_verticals_vertical \
           idx_media_site idx_tags_site_slug; do
  check "index $idx declared" grep -q "$idx" "$MIG"
done
[ "$FAIL" -eq 0 ] || exit 1
exit 0
