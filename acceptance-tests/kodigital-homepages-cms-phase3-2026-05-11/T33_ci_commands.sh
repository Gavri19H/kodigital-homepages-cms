#!/usr/bin/env bash
# T33.AC: 5 verify scripts exist in api/package.json (typecheck, test, verify:no-legacy-prod-refs, verify:infra, verify:worker-config).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T33] $desc"; else echo "FAIL [T33] $desc"; FAIL=1; fi
}
PKG="$REPO_ROOT/api/package.json"
check "api/package.json exists" test -f "$PKG"
for s in typecheck test verify:no-legacy-prod-refs verify:infra verify:worker-config; do
  check "package.json script '$s'" grep -qE "\"$s\"[[:space:]]*:" "$PKG"
done
[ "$FAIL" -eq 0 ] || exit 1
# Behavioral: actually running the 5 commands requires node_modules/network. Use NEEDS_RUNTIME if npm missing.
if ! command -v npm >/dev/null 2>&1; then
  echo "INFO [T33] npm not on PATH; CI run skipped (NEEDS_RUNTIME)"
  exit 2
fi
exit 0
