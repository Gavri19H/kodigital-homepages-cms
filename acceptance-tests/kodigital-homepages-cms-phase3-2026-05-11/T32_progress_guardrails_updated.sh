#!/usr/bin/env bash
# T32.AC: GUARDRAILS.md re-states red lines; progress.txt declares Phase 3 milestones.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T32] $desc"; else echo "FAIL [T32] $desc"; FAIL=1; fi
}
check "GUARDRAILS.md exists" test -f "$REPO_ROOT/GUARDRAILS.md"
check "progress.txt exists" test -f "$REPO_ROOT/progress.txt"
check "GUARDRAILS lists hard red-line forbidden refs (count >=6)" \
  bash -c 'COUNT=$(grep -cE "(44c73f76-6ed5-4b26-b442-6c2044326c4d|theiwise.com|a2z-cf-cms-v1-(api|db)|insureprimo|psychic-quiz|rental-booking)" '"$REPO_ROOT/GUARDRAILS.md"' || true); test "$COUNT" -ge 6'
check "progress.txt mentions Phase 3 milestones (count >=3)" \
  bash -c 'COUNT=$(grep -cE "(Phase 3|Session 3|multi-site|provisioning runner)" '"$REPO_ROOT/progress.txt"' || true); test "$COUNT" -ge 3'
[ "$FAIL" -eq 0 ] || exit 1
exit 0
