#!/usr/bin/env bash
# T12.AC: db helpers accept siteId and bind site_id into prepared statements.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T12] $desc"; else echo "FAIL [T12] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/db/index.ts"
check "db/index.ts exists" test -f "$F"
check "module declares siteId option" grep -qE "siteId\\?:" "$F"
check "binds site_id in articles helpers" grep -q "AND site_id = ?" "$F"
check "binds site_id in media helper" grep -q "site_id = ? OR site_id IS NULL" "$F"
check "categories helper joins site" grep -q "s.id AS site_id FROM categories" "$F"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
