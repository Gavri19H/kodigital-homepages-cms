#!/usr/bin/env bash
# T7.AC: idx_settings_site_key created on (site_id, key).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T7] $desc"; else echo "FAIL [T7] $desc"; FAIL=1; fi
}
MIG="$REPO_ROOT/api/migrations/0003_phase3_site_settings_restructure.sql"
check "migration exists" test -f "$MIG"
check "idx_settings_site_key on (site_id, key)" grep -qE "CREATE INDEX IF NOT EXISTS idx_settings_site_key ON site_settings\\(site_id, key\\)" "$MIG"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
