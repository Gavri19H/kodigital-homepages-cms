#!/usr/bin/env bash
# Phase6.AC T02 (§30.1/§30.3/DEV-13): measured-token conformance — the
# stylesheet DERIVES from tokens.ts (tokens-to-css core + the evidence-backed
# measured-values transcriptions); no stale-baseline `#ce2e35` literal exists
# outside the drift register (tokens.ts) and the pre-Phase-6 modules that
# legitimately consume baseline token fields; the DEV-13 live values appear
# only via the structured drift-override module.
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

LST_DIR="$REPO_ROOT/api/src/public/listicle"
STYLES="$LST_DIR/layouts/default/styles.ts"
MEASURED="$LST_DIR/layouts/default/measured-values.ts"
TOKENS="$LST_DIR/layouts/default/tokens.ts"
TOKENS_CSS="$LST_DIR/layouts/default/tokens-to-css.ts"
COMPONENTS="$LST_DIR/layouts/default/components.ts"
RENDER="$LST_DIR/render.ts"

# --- styles derive from tokens ---------------------------------------------------
check "styles.ts builds ON the tokens-to-css core (defaultLayoutSectionCss + tokenGroupCss)" \
  bash -c "grep -q 'defaultLayoutSectionCss' '$STYLES' && grep -q 'tokenGroupCss' '$STYLES'"
check "tokens-to-css exports the group mapper for styles.ts (additive extension)" \
  bash -c "grep -q 'export function tokenGroupCss' '$TOKENS_CSS'"
check "every drift value flows through measured-values.ts (evidence-backed), never inline" \
  bash -c "grep -q 'DRIFT_OVERRIDES_2026_07_03' '$STYLES' && grep -q 'measuredDriftRegister2026_07_03' '$MEASURED'"

# --- no legacy literals outside the drift register --------------------------------
# tokens.ts CARRIES #ce2e35 (the §30.1 baseline the drift register keeps, per
# DEV-13 "baseline NOT overwritten"). No NEW Phase-6 module may hardcode it.
check "no #ce2e35 in styles.ts / components.ts / measured-values.ts / render.ts / serve.ts / registry" \
  bash -c "! grep -l 'ce2e35' '$STYLES' '$COMPONENTS' '$MEASURED' '$RENDER' '$LST_DIR/serve.ts' '$LST_DIR/layouts/registry.ts' 2>/dev/null | grep -q ."
check "tokens.ts still records the baseline in the drift register (both values kept)" \
  bash -c "grep -q 'ce2e35' '$TOKENS' && grep -q 'e0072b' '$TOKENS'"

# --- the measured (new) values win ------------------------------------------------
check "live header #e0072b + Inter stack + hero radius 8px ride the drift overrides" \
  bash -c "grep -q '#e0072b' '$MEASURED' && grep -q 'Inter, Arial, Helvetica, sans-serif' '$MEASURED' && grep -q '\"8px\"' '$MEASURED'"
check "measured groups referenced from tokens (divider/disclosure panel/badge/footer)" \
  bash -c "grep -q 'sectionWrapper.measured' '$MEASURED' && grep -q 'disclosureInteraction.measured' '$MEASURED' && grep -q 'numberBadge' '$MEASURED' && grep -q 'footer.measured' '$MEASURED'"
check "hard-derived values carry evidence substrings checked against tokens prose" \
  bash -c "grep -q 'evidence:' '$MEASURED' && grep -q 'resolveTokenPath' '$MEASURED'"

# --- §30.3 locked editing / host immunity ------------------------------------------
check "no brand-token override path touches the listicle stylesheet (host theme cannot override)" \
  bash -c "! grep -q 'renderBrandTokensStyle' '$RENDER' && ! grep -q 'brand_tokens' '$RENDER'"
check "the ONLY per-host swap is the logo (site settings), documented + implemented" \
  bash -c "grep -q 'ONLY per-host brand swap' '$COMPONENTS' && grep -q 'logo_media_id' '$LST_DIR/serve.ts'"

# --- vitest-level conformance suites exist -----------------------------------------
check "unit suites: measured-values evidence + registry + styles conformance" \
  bash -c "test -f '$REPO_ROOT/api/test/listicles-measured-values.test.ts' && test -f '$REPO_ROOT/api/test/listicles-registry.test.ts'"

exit $FAIL
