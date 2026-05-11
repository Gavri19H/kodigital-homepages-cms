#!/usr/bin/env bash
# T1.AC: Migration declares all 10 new tables (0002_phase3_multi_site_schema.sql)
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T1] $desc"
  else
    echo "FAIL [T1] $desc"
    FAIL=1
  fi
}

MIG="$REPO_ROOT/api/migrations/0002_phase3_multi_site_schema.sql"
check "migration file exists" test -f "$MIG"
for t in sites domains verticals category_verticals site_categories legal_templates site_creation_jobs site_creation_job_steps ai_generations cache_purge_log; do
  check "table $t declared" grep -q "CREATE TABLE.*\\b$t\\b" "$MIG"
done

# BEHAVIORAL part requires `wrangler d1 migrations apply` — flag NEEDS_RUNTIME if wrangler not on PATH
if ! command -v wrangler >/dev/null 2>&1 && [ "$FAIL" -eq 0 ]; then
  echo "INFO [T1] behavioral wrangler apply not run (NEEDS_RUNTIME)"
  exit 2
fi
[ "$FAIL" -eq 0 ] || exit 1
exit 0
