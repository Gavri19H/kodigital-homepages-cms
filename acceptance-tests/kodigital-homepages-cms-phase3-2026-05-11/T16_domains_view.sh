#!/usr/bin/env bash
# T16.AC: Domains view + New Site modal with Domain/Vertical/Activity fields.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T16] $desc"; else echo "FAIL [T16] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/admin/views/domains.ts"
check "domains.ts view exists" test -f "$F"
check 'body data-area="domains"' grep -qE 'data-area=\"domains\"' "$F"
check "New Site button" grep -q "New Site" "$F"
check "Vertical column/option" grep -q "Vertical" "$F"
check "Activity column/option" grep -q "Activity" "$F"
check "open-new-site-modal trigger" grep -q "open-new-site-modal" "$F"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
