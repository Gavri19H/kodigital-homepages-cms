#!/usr/bin/env bash
# T21.AC: Site-aware Articles tab — Site field + filters + Site-required blocker on editor.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T21] $desc"; else echo "FAIL [T21] $desc"; FAIL=1; fi
}
LIST="$REPO_ROOT/api/src/admin/views/articles.ts"
ED="$REPO_ROOT/api/src/admin/views/article-editor.ts"
check "articles.ts exists" test -f "$LIST"
check "article-editor.ts exists" test -f "$ED"
for f in site vertical category status; do
  check "articles toolbar has data-filter=\"$f\"" grep -q "data-filter=\"$f\"" "$LIST"
done
check 'editor aria-live="polite"' grep -q 'aria-live="polite"' "$ED"
check "editor 'Site is required' message" grep -q "Site is required" "$ED"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
