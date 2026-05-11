#!/usr/bin/env bash
# T24.AC: Settings tab requires site selector + PATCH bumps sites.settings_version.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T24] $desc"; else echo "FAIL [T24] $desc"; FAIL=1; fi
}
V="$REPO_ROOT/api/src/admin/views/settings.ts"
A="$REPO_ROOT/api/src/admin/api.ts"
check "settings.ts view exists" test -f "$V"
check "admin/api.ts exists" test -f "$A"
check "settings form binds site_id" grep -q 'name="site_id"' "$V"
check "settings_version SELECT in api" grep -q "settings_version FROM sites" "$A"
check "settings_version UPDATE/increment" grep -qE "settings_version[[:space:]]*=[[:space:]]*\\?|settings_version[[:space:]]*=[[:space:]]*settings_version" "$A"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
