#!/usr/bin/env bash
# T22.AC: Site-aware Pages tab — Site filter + Page-type filter + Global template badge.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T22] $desc"; else echo "FAIL [T22] $desc"; FAIL=1; fi
}
LIST="$REPO_ROOT/api/src/admin/views/pages.ts"
ED="$REPO_ROOT/api/src/admin/views/page-editor.ts"
check "pages.ts exists" test -f "$LIST"
check "page-editor.ts exists" test -f "$ED"
check 'pages data-filter="site"' grep -q 'data-filter="site"' "$LIST"
check 'pages data-filter="page_type"' grep -q 'data-filter="page_type"' "$LIST"
check "Global template badge" grep -q "Global template" "$ED"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
