#!/usr/bin/env bash
# T23.AC: Categories tab renders verticals multi-select with 8 canonical slugs.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T23] $desc"; else echo "FAIL [T23] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/admin/views/categories.ts"
check "categories.ts exists" test -f "$F"
for slug in home finance travel health parenting food tech lifestyle; do
  check "vertical option '$slug'" grep -qE 'value="'"$slug"'"' "$F"
done
check "multiple-select for verticals" grep -qE "multiple.*verticals|verticals.*multiple" "$F"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
