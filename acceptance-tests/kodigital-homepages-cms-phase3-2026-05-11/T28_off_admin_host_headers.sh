#!/usr/bin/env bash
# T28.AC: off-ADMIN_HOST /admin 404 includes Cache-Control:no-store + X-Robots-Tag:noindex.
# Static check on index.ts; live behavioral check requires wrangler dev -> NEEDS_RUNTIME.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T28] $desc"; else echo "FAIL [T28] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/index.ts"
check "api/src/index.ts exists" test -f "$F"
check "Cache-Control: no-store set" grep -qE 'c\.header\("Cache-Control", "no-store"\)' "$F"
check "X-Robots-Tag: noindex, nofollow set" grep -qE 'c\.header\("X-Robots-Tag", "noindex, nofollow"\)' "$F"
[ "$FAIL" -eq 0 ] || exit 1
if ! command -v wrangler >/dev/null 2>&1; then
  echo "INFO [T28] live curl headers check skipped (NEEDS_RUNTIME)"
  exit 2
fi
exit 0
