#!/usr/bin/env bash
# T26.AC: public middleware injects SiteContext + admin host returns 404.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T26] $desc"; else echo "FAIL [T26] $desc"; FAIL=1; fi
}
M="$REPO_ROOT/api/src/public/middleware.ts"
R="$REPO_ROOT/api/src/public/router.ts"
check "public/middleware.ts exists" test -f "$M"
check "public/router.ts exists" test -f "$R"
check "publicSiteContextMiddleware exported" grep -qE "^export async function publicSiteContextMiddleware" "$M"
check "router uses publicSiteContextMiddleware" grep -q "publicSiteContextMiddleware" "$R"
check "router returns 404 on missing site" grep -q "Not Found" "$R"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
