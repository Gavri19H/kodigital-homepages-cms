#!/usr/bin/env bash
# Phase2.AC: the listicles admin sub-router is mounted from admin/router.ts and
# every §7.1 route is registered (contract §7.1).
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

ADMIN_ROUTER="$REPO_ROOT/api/src/admin/router.ts"
LST_ROUTER="$REPO_ROOT/api/src/admin/listicles/router.ts"

# --- mount wiring -----------------------------------------------------------
check "admin/router.ts imports the listicles sub-router" \
  grep -q 'import listicleApi from "./listicles/router"' "$ADMIN_ROUTER"
check "admin/router.ts mounts the listicles sub-router" \
  grep -q 'admin.route("/", listicleApi)' "$ADMIN_ROUTER"
check "sub-router registers under /api/admin/listicles" \
  grep -q '"/api/admin/listicles"' "$LST_ROUTER"

# --- §7.1 route list (verb + path literal in the sub-router) -----------------
route() {
  local verb="$1" path="$2"
  check "route $verb $path registered" \
    grep -q "routes\.${verb}(\"${path}\"" "$LST_ROUTER"
}

# Offers
route get "/offers"
route post "/offers"
route get "/offers/search"
route get "/offers/:id"
route patch "/offers/:id"
route delete "/offers/:id"
route get "/offers/:id/usage"
route get "/offers/:id/analytics"
# Sections (same verbs + usage/offers/analytics extras)
route get "/sections"
route post "/sections"
route get "/sections/:id"
route patch "/sections/:id"
route delete "/sections/:id"
route get "/sections/:id/usage"
route get "/sections/:id/offers"
route get "/sections/:id/analytics"
# Articles
route get "/articles"
route post "/articles"
route patch "/articles/:id"
route post "/articles/:id/experiments"
route delete "/articles/:id"
route get "/articles/:id/structure"
route get "/articles/:id/analytics"
route get "/articles/:id/drilldown"
route post "/articles/:id/publish"
# Versions / Pages
route put "/versions/:id"
route post "/pages/:id/validate"

# Handler modules exist and export the handlers the router imports.
for f in offers-handlers.ts sections-handlers.ts articles-handlers.ts versions-handlers.ts shared.ts structure.ts; do
  check "handler module $f exists" test -f "$REPO_ROOT/api/src/admin/listicles/$f"
done

[ "$FAIL" -eq 0 ] || exit 1
exit 0
