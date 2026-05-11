#!/usr/bin/env bash
# T6.AC: 0003 uses CREATE TABLE new -> INSERT OR IGNORE -> DROP -> RENAME.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T6] $desc"; else echo "FAIL [T6] $desc"; FAIL=1; fi
}
MIG="$REPO_ROOT/api/migrations/0003_phase3_site_settings_restructure.sql"
check "migration exists" test -f "$MIG"
check "CREATE TABLE site_settings_new" grep -qE "^CREATE TABLE site_settings_new \\(" "$MIG"
check "INSERT OR IGNORE INTO site_settings_new" grep -qE "^INSERT OR IGNORE INTO site_settings_new" "$MIG"
check "DROP TABLE site_settings" grep -qE "^DROP TABLE site_settings;" "$MIG"
check "RENAME site_settings_new -> site_settings" grep -qE "^ALTER TABLE site_settings_new RENAME TO site_settings;" "$MIG"
check "UNIQUE(site_id, key)" grep -q "UNIQUE(site_id, key)" "$MIG"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
