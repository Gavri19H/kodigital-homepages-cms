#!/usr/bin/env bash
# T13.AC: 4 admin sites endpoints registered (GET/POST /sites + GET/PATCH /sites/:id).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T13] $desc"; else echo "FAIL [T13] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/admin/api.ts"
check "admin/api.ts exists" test -f "$F"
check "adminApi.get('/sites')" grep -qE "adminApi\\.get\\(\"/sites\"" "$F"
check "adminApi.post('/sites')" grep -qE "adminApi\\.post\\(\"/sites\"" "$F"
check "adminApi.get('/sites/:id')" grep -qE "adminApi\\.get\\(\"/sites/:id\"" "$F"
check "adminApi.patch('/sites/:id')" grep -qE "adminApi\\.patch\\(\"/sites/:id\"" "$F"
check "site_creation_jobs insert reference" grep -qrE "INSERT INTO site_creation_jobs|site_creation_jobs" "$REPO_ROOT/api/src/admin/sites-handlers.ts"
check "assertNotProtectedDomain called" grep -qE "assertNotProtectedDomain" "$REPO_ROOT/api/src/admin/sites-handlers.ts"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
