#!/usr/bin/env bash
# Phase7.AC T02 (§15.3/§22.3/§31.2/§31.4/§31.5/§31.6): the inline ES5 client
# runtime honors the contract — selector reasons + pre-paint style, the
# §31.2 hash twin, pv mint + anchor stamping, the §31.5 thresholds
# (0.5 / 1000ms / 500ms + hidden-tab pause + once-per-(pv,entity)), the
# §31.6 chain (sendBeacon → keepalive fetch → localStorage queue, cap 50,
# backoff, flush on load/visible/online) — and BOTH scripts byte-parse as
# standalone ES5 via `node --check`.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
API_DIR="$REPO_ROOT/api"
RUNTIME="$API_DIR/src/public/listicle/runtime.ts"
RENDER="$API_DIR/src/public/listicle/render.ts"

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

# --- §31.2 twin -----------------------------------------------------------------
check "hash twin: FNV-1a seed + *16777619 shift ladder + bps modulus in the ES5 source" \
  bash -c "grep -q '0x811c9dc5' '$RUNTIME' && grep -q '(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)' '$RUNTIME' && grep -q 'h%10000' '$RUNTIME'"
check "UTF-8 twin handles surrogate pairs + lone-surrogate replacement (TextEncoder parity)" \
  bash -c "grep -q '0xd800' '$RUNTIME' && grep -q '0xfffd' '$RUNTIME'"

# --- §15.3 selector ---------------------------------------------------------------
check "selector: all four selection_reason labels + __LST_CHOSEN + §15.3 pre-paint style write" \
  bash -c "grep -q \"'single_default'\" '$RUNTIME' && grep -q \"'ab_hash'\" '$RUNTIME' && grep -q \"'rule_match'\" '$RUNTIME' && grep -q \"'fallback'\" '$RUNTIME' && grep -q '__LST_CHOSEN' '$RUNTIME' && grep -Eq 'document[.]write' '$RUNTIME'"
check "§31.3: client generates a sid ONLY if _LST_SID/ko_sid absent" \
  bash -c "grep -q \"window._LST_SID||lstReadCookie('ko_sid')\" '$RUNTIME'"
check "materializer stamps chosen templates during parse + repoints lazy placeholders" \
  bash -c "grep -q '__lstMat' '$RUNTIME' && grep -q 'lst-cand-pending' '$RUNTIME' && grep -q '/lst-cand/' '$RUNTIME'"
check "shell wires boot data + per-page materializer calls + beacon tag (render.ts)" \
  bash -c "grep -q '__LST_PAGES' '$RENDER' && grep -q '__lstMat&&window.__lstMat' '$RENDER' && grep -q 'beaconScriptTag()' '$RENDER' && grep -q 'selectorScriptTag()' '$RENDER'"
check "the Phase-6 interim static style is GONE from the renderer" \
  bash -c "! grep -q 'interim-single-default' '$RENDER'"

# --- §31.4 / §31.9 -----------------------------------------------------------------
check "page_view_id minted per view + stamped + pv= written into governed /lc anchors" \
  bash -c "grep -q 'window._LST_PVID=PVID' '$RUNTIME' && grep -q \"pv='+PVID\" '$RUNTIME' && grep -q 'page_view_id:PVID' '$RUNTIME'"

# --- §31.5 thresholds -----------------------------------------------------------------
check "IntersectionObserver threshold 0.5; dwell 1000ms (section) / 500ms (offer)" \
  bash -c "grep -q 'threshold:\\[0,0.5\\]' '$RUNTIME' && grep -q 'intersectionRatio>=0.5' '$RUNTIME' && grep -q ',1000,fireSection' '$RUNTIME' && grep -q ',500,fireOffer' '$RUNTIME'"
check "hidden-tab pause + once per (page_view_id, entity)" \
  bash -c "grep -q 'visibilitychange' '$RUNTIME' && grep -q 'document.hidden' '$RUNTIME' && grep -q 'SENT\\[key\\]=1' '$RUNTIME'"
check "governed anchors observed INDIVIDUALLY (per-anchor entity keys)" \
  bash -c "grep -q \"'off|'\" '$RUNTIME' && grep -q \"'sec|'\" '$RUNTIME'"

# --- §31.6 chain ------------------------------------------------------------------------
check "send chain: sendBeacon → keepalive fetch → localStorage retry queue" \
  bash -c "grep -q 'navigator.sendBeacon' '$RUNTIME' && grep -q 'keepalive:true' '$RUNTIME' && grep -q 'localStorage' '$RUNTIME'"
check "queue cap ~50 + exponential backoff + flush on load/visible/online + event_id per event" \
  bash -c "grep -q 'QMAX=50' '$RUNTIME' && grep -q 'backoffMs' '$RUNTIME' && grep -q \"addEventListener('load',flushQ)\" '$RUNTIME' && grep -q \"addEventListener('online',flushQ)\" '$RUNTIME' && grep -q 'event_id:lstGenId()' '$RUNTIME'"

# --- ES5 byte-parse (node --check on the EXTRACTED script bodies) ----------------------
if ! command -v npx >/dev/null 2>&1; then
  echo "NEEDS_RUNTIME [T02] npx not available for the extraction step"
  exit 2
fi
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
(
  cd "$API_DIR" &&
  npx tsx -e "
    import { listicleSelectorScriptBody, listicleBeaconScriptBody } from './src/public/listicle/runtime';
    import { writeFileSync } from 'node:fs';
    writeFileSync('$TMP_DIR/selector.js', listicleSelectorScriptBody());
    writeFileSync('$TMP_DIR/beacon.js', listicleBeaconScriptBody());
  "
) || { echo "FAIL [T02] runtime extraction"; exit 1; }

for f in selector beacon; do
  check "$f.js parses standalone (node --check)" node --check "$TMP_DIR/$f.js"
  check "$f.js is strict ES5 (no arrows/const/let/async/template literals)" \
    bash -c "! grep -q '=>' '$TMP_DIR/$f.js' && ! grep -qw 'const' '$TMP_DIR/$f.js' && ! grep -qw 'let' '$TMP_DIR/$f.js' && ! grep -qw 'async' '$TMP_DIR/$f.js' && ! grep -q '\\\`' '$TMP_DIR/$f.js'"
done

exit $FAIL
