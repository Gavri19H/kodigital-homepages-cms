#!/usr/bin/env bash
# Phase1.AC: banned-token guard green with the vendored contract allowlisted;
# contract + layout package vendored with BLOCKER honesty preserved
# (contract §1 guardrail + §30.1 package list + §31.0 honesty note).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T08] $desc"
  else
    echo "FAIL [T08] $desc"
    FAIL=1
  fi
}

D="$REPO_ROOT/docs/listicles"
check "contract vendored" test -f "$D/design-contract-v1.2.2.md"
check "contract carries the v1.2.2 addendum (§31.9)" grep -q "31.9 New/changed schema" "$D/design-contract-v1.2.2.md"
check "layout audit vendored" test -f "$D/reference-layout-audit.md"
check "desktop reference JSON vendored" test -f "$D/reference-layout-desktop.json"
check "mobile reference JSON vendored" test -f "$D/reference-layout-mobile.json"
check "traceability register vendored" test -f "$D/traceability.md"

# §31.0 layout-blocker lifecycle: PR1 vendored these as BLOCKER stubs and asserted
# they stay UNRESOLVED (no fake resolution) through phases 1-5. Phase 6 (#67) then
# MEASURED every blocker from the live reference (§31.0/DEV-13), legitimately
# resolving them (status -> "measured") and filling reference-layout-mobile.json.
# This check now asserts that POST-Phase-6 resolved state: the blockers were closed
# the honest way (measured), not faked. (Stale-assertion backfill — see traceability
# note; the phase-1 suite should have been updated at #67.)
TOK="$REPO_ROOT/api/src/public/listicle/layouts/default/tokens.ts"
check "tokens.ts vendored at the §30.1 path" test -f "$TOK"
check "tokens.ts exports defaultListicleLayoutTokens" grep -q "export const defaultListicleLayoutTokens" "$TOK"
UNRESOLVED=$(grep -c "BLOCKER" "$TOK")
check "tokens.ts has NO unresolved BLOCKER statuses post-Phase-6 (found $UNRESOLVED)" test "$UNRESOLVED" -eq 0
MEASURED=$(grep -c "measured" "$TOK")
check "tokens.ts carries measured statuses/values (found $MEASURED)" test "$MEASURED" -ge 5
# The mobile capture is landed (no residual capture-required stub).
check "mobile reference JSON is measured, not a BLOCKER stub" bash -c "! grep -q 'BLOCKER: capture required' '$D/reference-layout-mobile.json'"

check "guard allowlists the vendored contract" \
  grep -q "docs/listicles/design-contract-v1.2.2.md" "$REPO_ROOT/api/scripts/verify/assert-no-legacy-prod-refs.ts"

[ "$FAIL" -eq 0 ] || exit 1

# BEHAVIORAL: run the guard itself (needs node_modules)
if [ ! -d "$REPO_ROOT/api/node_modules" ]; then
  echo "INFO [T08] guard not executed (NEEDS_RUNTIME: api/node_modules missing)"
  exit 2
fi
cd "$REPO_ROOT/api" || exit 1
if npm run --silent verify:no-legacy-prod-refs >/dev/null 2>&1; then
  echo "PASS [T08] verify:no-legacy-prod-refs green"
else
  echo "FAIL [T08] verify:no-legacy-prod-refs failed"
  exit 1
fi
exit 0
