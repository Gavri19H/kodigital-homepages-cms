#!/usr/bin/env bash
# T8.AC: seed inserts all 8 verticals + 4 legal templates.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T8] $desc"; else echo "FAIL [T8] $desc"; FAIL=1; fi
}
MIG="$REPO_ROOT/api/migrations/0004_phase3_seed_verticals_and_legal_templates.sql"
check "seed migration exists" test -f "$MIG"
for slug in home finance travel health parenting food tech lifestyle; do
  check "vertical seed '$slug'" grep -qE "INSERT (OR IGNORE )?INTO verticals.*'$slug'" "$MIG"
done
for slug in privacy-policy terms do-not-sell contact; do
  check "legal template seed '$slug'" grep -qE "INSERT (OR IGNORE )?INTO legal_templates.*'$slug'" "$MIG"
done
[ "$FAIL" -eq 0 ] || exit 1
exit 0
