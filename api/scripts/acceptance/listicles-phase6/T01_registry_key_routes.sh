#!/usr/bin/env bash
# Phase6.AC T01 (§7.2/§14/§15.2/§22/§22.2/§22.4): the Phase-6 public render
# surface exists — §14 registry verbatim, listicleKey additive in
# cache-keys.ts, the /:slug listicle branch + /lst-cand route on the shared
# public router, the §15.2 edge sticky pick + §31.2 hash, the §22.2 fan-out
# wired into sections save + the publish TODO replaced.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T01] $desc"
  else
    echo "FAIL [T01] $desc"
    FAIL=1
  fi
}

REGISTRY="$REPO_ROOT/api/src/public/listicle/layouts/registry.ts"
COMPONENTS="$REPO_ROOT/api/src/public/listicle/layouts/default/components.ts"
STYLES="$REPO_ROOT/api/src/public/listicle/layouts/default/styles.ts"
KEYS="$REPO_ROOT/api/src/cache/cache-keys.ts"
ROUTER="$REPO_ROOT/api/src/public/router.ts"
SERVE="$REPO_ROOT/api/src/public/listicle/serve.ts"
RENDER="$REPO_ROOT/api/src/public/listicle/render.ts"
ABHASH="$REPO_ROOT/api/src/public/listicle/ab-hash.ts"
PICK="$REPO_ROOT/api/src/public/listicle/experiment-pick.ts"
GOV="$REPO_ROOT/api/src/public/listicle/governed-url.ts"
FANOUT="$REPO_ROOT/api/src/listicles/invalidate.ts"
SECTIONS="$REPO_ROOT/api/src/admin/listicles/sections-handlers.ts"
ARTICLES="$REPO_ROOT/api/src/admin/listicles/articles-handlers.ts"

# --- §14 layout registry (verbatim) -------------------------------------------
check "ListicleLayout interface: id/name/cssVars/renderShell/renderPage/renderSection" \
  bash -c "grep -q 'export interface ListicleLayout' '$REGISTRY' && grep -q 'cssVars: Record<string, string>' '$REGISTRY' && grep -q 'renderShell(vm' '$REGISTRY' && grep -q 'renderPage(page' '$REGISTRY' && grep -q 'renderSection(sectionHtml' '$REGISTRY'"
check "LAYOUTS + getLayout with unknown-id → default" \
  bash -c "grep -q 'export const LAYOUTS' '$REGISTRY' && grep -q 'export function getLayout' '$REGISTRY' && grep -q 'LAYOUTS\[id\] ?? LAYOUTS\[\"default\"\]' '$REGISTRY'"
check "default layout components implement the §30.2 tree (header/byline/hero/sections/legal/footer)" \
  bash -c "grep -q 'renderListicleHeader' '$COMPONENTS' && grep -q 'renderHostLogo' '$COMPONENTS' && grep -q 'lst-disclosure-panel' '$COMPONENTS' && grep -q 'renderLegalDisclosureBlock' '$COMPONENTS' && grep -q 'renderListicleFooter' '$COMPONENTS'"
check "O3 fix: the inter-section rhythm is a REAL <hr class=lst-divider> element" \
  bash -c "grep -q '<hr class=\"lst-divider\">' '$COMPONENTS' && grep -q 'lst-divider{border:0' '$STYLES'"

# --- §22 cache key (additive) --------------------------------------------------
check "listicleKey: html:{site_id}:/{slug}:{lander_v}:{content_version}:{template_version}" \
  bash -c "grep -q 'export function listicleKey' '$KEYS' && grep -q 'listicleCandidateKey' '$KEYS'"
check "existing key formatters untouched (htmlKey/articleKey/pageKey/categoryKey all present)" \
  bash -c "grep -q 'export function htmlKey' '$KEYS' && grep -q 'export function articleKey' '$KEYS' && grep -q 'export function pageKey' '$KEYS' && grep -q 'export function categoryKey' '$KEYS'"

# --- §7.2 routes (public router branch — minimal diff) --------------------------
check "the /:slug catch-all branches to tryServePublishedListicle BEFORE servePage" \
  bash -c "grep -q 'tryServePublishedListicle' '$ROUTER'"
check "GET /lst-cand/:cid registered (cached per-candidate fragment, §22.4)" \
  bash -c "grep -q '\"/lst-cand/:cid\"' '$ROUTER' && grep -q 'serveListicleCandidate' '$ROUTER'"
check "published-only gate + draft/scheduled/archived fallthrough" \
  bash -c "grep -q \"status !== .published.\" '$SERVE'"
check "publicHtmlCacheHeaders + ETag + nosniff via the edge-cache pipeline" \
  bash -c "grep -q 'publicHtmlCacheHeaders' '$SERVE' && grep -q 'computeEtag' '$SERVE' && grep -q 'matchesIfNoneMatch' '$SERVE' && grep -q 'putCachedHtml' '$SERVE'"

# --- §15.2 edge sticky pick + §31.2 hash ---------------------------------------
check "FNV-1a 32-bit over UTF-8 sid|test_id → bps 0..9999 (§31.2 verbatim)" \
  bash -c "grep -q '0x811c9dc5' '$ABHASH' && grep -q 'h % 10000' '$ABHASH' && grep -q 'TextEncoder' '$ABHASH'"
check "stickyPick over the running experiment's allocations; ko_sid + ko_ver cookies" \
  bash -c "grep -q 'export function stickyPick' '$PICK' && grep -q 'ko_sid' '$SERVE' && grep -q 'ko_ver' '$SERVE' && grep -q 'SESSION_COOKIE_MAX_AGE_SECONDS = 1800' '$PICK'"

# --- §30.7 governed URLs ---------------------------------------------------------
check "/lc URL builder carries a/lv/p/s/c/m/r + lnk/blk/role + the §31.9 pv placeholder" \
  bash -c "grep -q '\"lnk\"' '$GOV' && grep -q '\"blk\"' '$GOV' && grep -q '\"role\"' '$GOV' && grep -q '\"pv\"' '$GOV' && grep -q '/lc/' '$GOV'"

# --- §22.4 payload guard ---------------------------------------------------------
check "budget constants (~40KB + 50% ratio) + above-fold never lazy" \
  bash -c "grep -q 'LST_CANDIDATE_BUDGET_BYTES = 40 \* 1024' '$RENDER' && grep -q 'LST_CANDIDATE_BUDGET_RATIO = 0.5' '$RENDER' && grep -q 'LST_ABOVE_FOLD_PAGE_COUNT' '$RENDER'"
# Phase-7 supersession: the Phase-6 INTERIM single-default style was
# contractually REPLACED by the §15.3 pre-paint selector (per-user pick);
# the inert-<template> alternates + a declared default remain.
check "hidden candidates ship as inert <template>; single-default now owned by the §15.3 selector (Phase 7)" \
  bash -c "grep -q 'lst-cand-tpl' '$RENDER' && grep -q 'selectorScriptTag()' '$RENDER' && grep -q 'defaultCandidate' '$RENDER'"
check "lazy hydration from GET /lst-cand/:candidate_public_id with reserved dims" \
  bash -c "grep -q 'data-lst-lazy' '$RENDER' && grep -q 'LST_LAZY_CANDIDATE_MIN_HEIGHT_PX' '$RENDER' && grep -q 'XMLHttpRequest' '$RENDER'"

# --- §22.2 fan-out + §7.1 publish wiring ----------------------------------------
check "fan-out walks candidates→pages→versions→articles + bumps Version content_version" \
  bash -c "grep -q 'fanOutSectionInvalidate' '$FANOUT' && grep -q 'content_version = content_version + 1' '$FANOUT'"
check "sections PATCH runs the fan-out on CONTENT change" \
  bash -c "grep -q 'fanOutSectionInvalidate' '$SECTIONS' && grep -q 'if (contentChanged)' '$SECTIONS'"
check "the Phase-2 publish TODO is REPLACED by invalidate + warm" \
  bash -c "grep -q 'invalidateAndWarmOnPublish' '$ARTICLES' && ! grep -q 'TODO(listicles-phase6)' '$ARTICLES'"
check "warm renders shells IN-PROCESS (no outbound fetch) via the live renderer" \
  bash -c "grep -q 'renderListicleShellForVersion' '$FANOUT' && ! grep -q 'fetch(' '$FANOUT'"

# --- §21 + §22.3 head/speed discipline ------------------------------------------
check "head composes renderCustomHead (GA4 path); the homepage beacon is NOT imported" \
  bash -c "grep -q 'renderCustomHead' '$RENDER' && ! grep -qE 'import.*ANALYTICS_TRACKING_SCRIPT' '$RENDER'"
check "hero eager + fetchpriority; other media lazy via responsive-img" \
  bash -c "grep -q '\"eager\"' '$RENDER' && grep -q 'fetchpriority: \"high\"' '$RENDER' && grep -q 'responsiveImg' '$RENDER' && grep -q '\"lazy\"' '$RENDER'"

exit $FAIL
