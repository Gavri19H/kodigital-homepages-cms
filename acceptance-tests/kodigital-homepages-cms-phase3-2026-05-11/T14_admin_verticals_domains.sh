#!/usr/bin/env bash
# T14.AC: 3 endpoints (GET /verticals, GET /domains, PATCH /domains/:id).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T14] $desc"; else echo "FAIL [T14] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/admin/api.ts"
check "admin/api.ts exists" test -f "$F"
check "adminApi.get('/verticals')" grep -qE "adminApi\\.get\\(\"/verticals\"" "$F"
check "adminApi.get('/domains')" grep -qE "adminApi\\.get\\(\"/domains\"" "$F"
check "adminApi.patch('/domains/:id')" grep -qE "adminApi\\.patch\\(\"/domains/:id\"" "$F"
# Seed 8 vertical slugs referenced
for slug in home finance travel health parenting food tech lifestyle; do
  check "verticals seed migration contains '$slug'" grep -qE "'$slug'" "$REPO_ROOT/api/migrations/0004_phase3_seed_verticals_and_legal_templates.sql"
done
[ "$FAIL" -eq 0 ] || exit 1
exit 0
