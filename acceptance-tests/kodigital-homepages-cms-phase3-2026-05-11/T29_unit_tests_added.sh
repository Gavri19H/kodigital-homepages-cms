#!/usr/bin/env bash
# T29.AC: 4 new test files with >=8 describe/it scopes covering Part-16 cases.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T29] $desc"; else echo "FAIL [T29] $desc"; FAIL=1; fi
}
DIR="$REPO_ROOT/api/test"
for f in site-context.test.ts tenant-guards.test.ts site-provisioning-dry-run.test.ts legal-template-render.test.ts; do
  check "test file $f exists" test -f "$DIR/$f"
done
TOTAL=0
for f in site-context.test.ts tenant-guards.test.ts site-provisioning-dry-run.test.ts legal-template-render.test.ts; do
  N=$(grep -cE '^[[:space:]]*(describe|it|test)\(' "$DIR/$f" || true)
  TOTAL=$((TOTAL + N))
done
check "combined describe/it/test count >=8 (got $TOTAL)" test "$TOTAL" -ge 8
[ "$FAIL" -eq 0 ] || exit 1
exit 0
