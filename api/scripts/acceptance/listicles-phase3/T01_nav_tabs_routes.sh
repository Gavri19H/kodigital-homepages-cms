#!/usr/bin/env bash
# Phase3.AC (§4/§25): the Listicles nav entry + icon exist in the admin
# layout (right after Pages), the shared renderListiclesTabs helper renders
# the three sub-tabs, the UI shell routes are registered (incl. the
# /admin/listicles → /admin/listicles/offers 302), and the sub-router is
# mounted from admin/router.ts behind the same accessAuth gate.
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

LAYOUT="$REPO_ROOT/api/src/admin/templates/layout.ts"
UI="$REPO_ROOT/api/src/admin/listicles/ui.ts"
SHARED="$REPO_ROOT/api/src/admin/listicles/ui-shared.ts"
ROUTER="$REPO_ROOT/api/src/admin/router.ts"

# --- nav entry + icon (§4: insert after Pages; ICON_LISTICLES) ---------------
check "layout.ts defines ICON_LISTICLES" \
  grep -q 'const ICON_LISTICLES' "$LAYOUT"
check "NAV_ENTRIES has the /admin/listicles entry" \
  grep -q '{ href: "/admin/listicles", label: "Listicles", icon: ICON_LISTICLES }' "$LAYOUT"
check "Listicles entry sits directly after Pages" \
  grep -A1 '"/admin/pages", label: "Pages"' "$LAYOUT" | grep -q '"/admin/listicles"'

# --- sub-tab bar (§4: renderListiclesTabs(active)) ---------------------------
check "renderListiclesTabs helper exists" \
  grep -q 'export function renderListiclesTabs' "$SHARED"
for tab in offers sections articles; do
  check "sub-tab /admin/listicles/$tab rendered by the tabs helper" \
    grep -q "/admin/listicles/$tab" "$SHARED"
done

# --- shell routes (§4) --------------------------------------------------------
check "GET /admin/listicles registered" \
  grep -q '"/admin/listicles"' "$UI"
check "bare route 302-redirects to the offers tab" \
  grep -q 'c.redirect("/admin/listicles/offers", 302)' "$UI"
for tab in offers sections articles; do
  check "GET /admin/listicles/$tab registered" \
    grep -q "listicleUi.get(\"/admin/listicles/$tab\"" "$UI"
done

# --- mount wiring (accessAuth-gated like adminUi) -----------------------------
check "admin/router.ts imports the listicles UI router" \
  grep -q "import { listicleUi } from './listicles/ui'" "$ROUTER"
check "admin/router.ts mounts the listicles UI router" \
  grep -q 'admin.route("/", listicleUi)' "$ROUTER"

# --- Phase 4/5 deferral: no dead editor shell routes (§27) --------------------
check "no /new|/:id/edit shell routes registered this phase" \
  bash -c "! grep -Eq 'listicles/(sections|articles)/(new|:id)' '$UI'"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
