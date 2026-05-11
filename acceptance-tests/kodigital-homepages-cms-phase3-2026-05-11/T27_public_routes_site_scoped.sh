#!/usr/bin/env bash
# T27.AC: public routes scope queries by site_id via siteContext.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T27] $desc"; else echo "FAIL [T27] $desc"; FAIL=1; fi
}
R="$REPO_ROOT/api/src/public/router.ts"
F="$REPO_ROOT/api/src/public/feeds.ts"
S="$REPO_ROOT/api/src/public/sitemap.ts"
check "public/router.ts exists" test -f "$R"
check "public/feeds.ts exists" test -f "$F"
check "public/sitemap.ts exists" test -f "$S"
check "router consumes siteContext.siteId" grep -qE 'siteContext\.siteId' "$R"
check "feeds receives siteId/site_id" grep -qE 'siteId|site_id' "$F"
check "sitemap receives siteId/site_id" grep -qE 'siteId|site_id' "$S"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
