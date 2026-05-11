#!/usr/bin/env bash
# T15.AC: 9 admin.get literals + /admin/domains route + Domains nav link.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T15] $desc"; else echo "FAIL [T15] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/admin/router.ts"
check "admin/router.ts exists" test -f "$F"
ADMIN_GET=$(grep -cE 'admin\.get\("/admin' "$F" || true)
check "at least 9 admin.get('/admin... literals (got $ADMIN_GET)" test "$ADMIN_GET" -ge 9
check "/admin/domains route present" grep -qE 'admin\.get\("/admin/domains"' "$F"
check "renderDomainsView referenced" grep -q "renderDomainsView" "$F"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
