#!/usr/bin/env bash
# Phase3.AC (§8/§9/§9.4/§13): the Offers page template carries the full §9
# anatomy — management columns, analytics columns (after-paint hydration
# hooks), row actions, the Create/Edit modal with every §9 field, the
# {clickid}→{click_id} normalization feedback, the conditional reveals, the
# /offers/search-fed fallback picker, the 409 "Archive instead" flow, the
# beforeunload dirty guard — and the 32 §9.4 macro chips come from the
# canonical registry (source-of-truth import + count check).
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

OFFERS="$REPO_ROOT/api/src/admin/listicles/ui-offers.ts"
SHARED="$REPO_ROOT/api/src/admin/listicles/ui-shared.ts"
MACROS="$REPO_ROOT/api/src/listicles/macros.ts"

# --- §9 management columns ----------------------------------------------------
for col in "Offer name" "Provider" "Vertical" "Activity" "Tracking method" "Payout" "Cap" "Status"; do
  check "management column: $col" grep -q ">$col</th>" "$OFFERS"
done

# --- §9 analytics columns (wire metric names, hydrated after paint) ----------
for metric in impressions clicks unique_clicks conversions ctr cvr revenue rpc rpm; do
  check "analytics metric: $metric" \
    bash -c "grep -q '\"$metric\"' '$SHARED'"
done
check "analytics cells render skeleton shimmer placeholders (§8 loading)" \
  grep -q 'class="skel"' "$SHARED"
check "offers table hydrates from the offers analytics endpoint" \
  grep -q 'data-analytics-url-prefix="/api/admin/listicles/offers/"' "$OFFERS"

# --- §9 row actions -----------------------------------------------------------
check "row action: Edit" grep -q 'data-offer-edit' "$OFFERS"
check "row action: Delete (409-guarded)" grep -q 'data-offer-delete' "$OFFERS"
check "row action: View attribution to Sections" grep -q 'data-offer-attribution' "$OFFERS"
check "row action: Analytics" grep -q 'data-lst-analytics-action' "$OFFERS"

# --- §9 modal fields ------------------------------------------------------------
for field in offer_name provider activity vertical tag conversion_tracking_method \
             offer_url_template payout_method payout_currency payout_value \
             cap_enabled cap_amount cap_timezone cap_count_by \
             cap_fallback_offer_id cap_fallback_url; do
  check "modal field: $field" grep -q "name=\"$field\"" "$OFFERS"
done
check "tracking methods are the §9 trio" \
  bash -c "grep -q 'S2S postback' '$OFFERS' && grep -q 'Browser-side pixel' '$OFFERS' && grep -q 'script: \"Script\"' '$OFFERS'"
check "In-site conditional reveal container" grep -q 'id="offer-payout-conditional"' "$OFFERS"
check "cap conditional reveal container" grep -q 'id="offer-cap-conditional"' "$OFFERS"
check "fallback picker is fed by /offers/search (§13)" \
  grep -q '/api/admin/listicles/offers/search' "$OFFERS"

# --- §9.4 macro chips: 32 canonical tokens from the registry ------------------
check "chips render from the canonical registry import" \
  grep -q 'CANONICAL_MACROS' "$OFFERS"
COUNT=$(grep -c '^  "' "$MACROS" || true)
check "canonical registry holds exactly 32 tokens (got: $COUNT)" \
  test "$COUNT" -eq 32
check "chip markup uses data-macro insertion hooks" \
  grep -q 'class="macro-chip" data-macro=' "$OFFERS"
check "{clickid} → {click_id} normalization feedback present" \
  grep -q 'normalized to {click_id} on save' "$OFFERS"

# --- §8 UI states --------------------------------------------------------------
check "empty state + CTA" grep -q 'No offers yet.' "$OFFERS"
check "Saving… state" grep -q "setStatus('Saving" "$OFFERS"
check "inline validation + aria-live" \
  bash -c "grep -q 'aria-live=\"polite\"' '$OFFERS' && grep -q 'data-error-for' '$OFFERS'"
check "error toast + inline em-dash + retry (shared hydration)" \
  bash -c "grep -q 'lst-retry' '$SHARED' && grep -q 'Failed to load analytics' '$SHARED'"
check "409 usage dialog + Archive instead" \
  bash -c "grep -q 'Archive instead' '$OFFERS' && grep -q '409' '$OFFERS'"
check "beforeunload dirty guard" grep -q 'beforeunload' "$OFFERS"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
