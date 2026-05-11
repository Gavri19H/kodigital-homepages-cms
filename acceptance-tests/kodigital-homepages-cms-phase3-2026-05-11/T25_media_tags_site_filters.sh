#!/usr/bin/env bash
# T25.AC: Both media.ts and tags.ts render a Site filter dropdown.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T25] $desc"; else echo "FAIL [T25] $desc"; FAIL=1; fi
}
M="$REPO_ROOT/api/src/admin/views/media.ts"
T="$REPO_ROOT/api/src/admin/views/tags.ts"
check "media.ts exists" test -f "$M"
check "tags.ts exists" test -f "$T"
check 'media data-filter="site"' grep -q 'data-filter="site"' "$M"
check 'tags data-filter="site"' grep -q 'data-filter="site"' "$T"
check "media name=\"site_id\"" grep -q 'name="site_id"' "$M"
check "tags name=\"site_id\"" grep -q 'name="site_id"' "$T"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
