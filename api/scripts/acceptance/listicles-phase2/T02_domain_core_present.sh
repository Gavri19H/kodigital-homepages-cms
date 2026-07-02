#!/usr/bin/env bash
# Phase2.AC: the listicles domain core exists — ids (9 prefixes), macro
# registry ({clickid} normalization), rules (interval intersection + the
# §15.5 "Rule conflict" payload), validation, link instances (§30.7
# "__headline__" row).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T02] $desc"
  else
    echo "FAIL [T02] $desc"
    FAIL=1
  fi
}

CORE="$REPO_ROOT/api/src/listicles"

for f in ids.ts macros.ts validation.ts rules.ts link-instances.ts; do
  check "domain module $f exists" test -f "$CORE/$f"
done

# ids.ts: all nine public-id prefixes (§5 + §30.7).
for p in off_ sec_ art_ exp_ ver_ pg_ cand_ rule_ lnk_; do
  check "id prefix $p declared" grep -q "\"$p\"" "$CORE/ids.ts"
done
check "self-contained ULID (crypto.getRandomValues, no npm dep)" \
  grep -q "crypto.getRandomValues" "$CORE/ids.ts"

# macros.ts: the {clickid} → {click_id} normalization alias (§9.4).
check "{clickid} alias declared" grep -q 'clickid: "click_id"' "$CORE/macros.ts"
check "normalizeTemplate exported" grep -q "export function normalizeTemplate" "$CORE/macros.ts"
check "findUnknownMacros exported" grep -q "export function findUnknownMacros" "$CORE/macros.ts"
check "validateOfferUrlTemplate exported" grep -q "export function validateOfferUrlTemplate" "$CORE/macros.ts"

# rules.ts: interval intersection + the §15.5 blocking payload.
check "interval intersection fn present" grep -q "export function intersectIntervals" "$CORE/rules.ts"
check "\"Rule conflict\" payload key present" grep -q '"Rule conflict"' "$CORE/rules.ts"
check "conditionsHash (== matched_rule_json_hash) present" grep -q "export async function conditionsHash" "$CORE/rules.ts"

# validation.ts: the §23 validator set.
for fn in validateOffer validateSection validateArticle validateVersion validatePage; do
  check "validator $fn exported" grep -q "export function $fn" "$CORE/validation.ts"
done

# link-instances.ts: the §30.7 reserved headline block id.
check "__headline__ reserved block id present" grep -q '"__headline__"' "$CORE/link-instances.ts"
check "section_offers rebuild statements present" \
  grep -q "listicle_section_offers" "$CORE/link-instances.ts"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
