#!/usr/bin/env bash
# T10.AC: site-context module exports SiteContext + 4 functions.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T10] $desc"; else echo "FAIL [T10] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/site/site-context.ts"
check "site-context.ts exists" test -f "$F"
check "exports SiteContext interface/type" grep -qE "^export (interface|type) SiteContext\\b" "$F"
check "exports isAdminHost" grep -qE "^export function isAdminHost\\(" "$F"
check "exports assertPublicSiteHostNotAdminHost" grep -qE "^export function assertPublicSiteHostNotAdminHost\\(" "$F"
check "exports resolveSiteByHostname" grep -qE "^export async function resolveSiteByHostname\\(" "$F"
check "exports resolveSiteContextFromRequest" grep -qE "^export async function resolveSiteContextFromRequest\\(" "$F"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
