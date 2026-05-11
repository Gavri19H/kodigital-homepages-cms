#!/usr/bin/env bash
# T11.AC: tenant-guards module has 8 required exports.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T11] $desc"; else echo "FAIL [T11] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/site/tenant-guards.ts"
check "tenant-guards.ts exists" test -f "$F"
for sym in requireSiteIdForArticleInput assertSlugUniquePerSite assertTenantBoundary \
           validateCategoryForSite resolvePageScope resolveSettingsScope \
           assertSiteCanMutateContent assertMediaBelongsToSiteOrGlobal; do
  check "exports $sym" grep -qE "^export (function |async function |const |class )$sym\\b" "$F"
done
check "exports TenantBoundaryViolation class" grep -qE "^export class TenantBoundaryViolation\\b" "$F"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
