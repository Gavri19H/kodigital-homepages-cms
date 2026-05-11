#!/usr/bin/env bash
# T30.AC: 3 integration test files exist and assert protected-domain rejection / idempotency / 404 headers.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T30] $desc"; else echo "FAIL [T30] $desc"; FAIL=1; fi
}
DIR="$REPO_ROOT/api/test"
check "admin-domains.test.ts exists" test -f "$DIR/admin-domains.test.ts"
check "admin-sites-create.test.ts exists" test -f "$DIR/admin-sites-create.test.ts"
check "off-admin-host-404-headers.test.ts exists" test -f "$DIR/off-admin-host-404-headers.test.ts"
check "protected-domain rejection asserted" grep -qE "theiwise|protected.*domain|protected-domain" "$DIR/admin-sites-create.test.ts"
check "idempotency_key asserted" grep -qE "idempotency_key|Idempotency-Key" "$DIR/admin-sites-create.test.ts"
check "no-store header asserted in off-admin-host tests" grep -qE "no-store" "$DIR/off-admin-host-404-headers.test.ts"
check "X-Robots-Tag asserted" grep -qiE "X-Robots-Tag|x-robots-tag" "$DIR/off-admin-host-404-headers.test.ts"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
