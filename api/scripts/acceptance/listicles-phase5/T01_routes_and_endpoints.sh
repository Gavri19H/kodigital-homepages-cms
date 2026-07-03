#!/usr/bin/env bash
# Phase5.AC (§7.1/§11/§15.6/§30.6/§30.7/DEV-9/DEV-10): the Phase-5 server
# surface exists — fork + new-revision + version preview + experiment
# start/stop routes registered; GET /articles gained ?search=; PUT
# /versions/:id accepts the §30.2 byline; the builder shell routes replaced
# the Phase-3 disabled Articles Create button.
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

ROUTER="$REPO_ROOT/api/src/admin/listicles/router.ts"
UI="$REPO_ROOT/api/src/admin/listicles/ui.ts"
LISTS="$REPO_ROOT/api/src/admin/listicles/ui-lists.ts"
ARTICLES="$REPO_ROOT/api/src/admin/listicles/articles-handlers.ts"
VERSIONS="$REPO_ROOT/api/src/admin/listicles/versions-handlers.ts"
FORK="$REPO_ROOT/api/src/admin/listicles/version-fork.ts"
PREVIEW="$REPO_ROOT/api/src/admin/listicles/version-preview.ts"
VALIDATION="$REPO_ROOT/api/src/listicles/validation.ts"

# --- §15.6 case c: fork -------------------------------------------------------
check "route: POST /versions/:id/fork" \
  bash -c "grep -q '\"/versions/:id/fork\"' '$ROUTER' && grep -q 'forkVersionHandler' '$ROUTER'"
check "fork clones to a NEW lander_v with content_version reset to 1" \
  bash -c "grep -q 'content_version, status)' '$FORK' && grep -q \", 1, 'active')\" '$FORK'"
check "fork deep-copies pages + candidates + rules + byline" \
  bash -c "grep -q 'INSERT INTO listicle_pages' '$FORK' && grep -q 'INSERT INTO listicle_page_section_candidates' '$FORK' && grep -q 'INSERT INTO listicle_page_rules' '$FORK' && grep -q 'byline_json' '$FORK'"
check "fork joins an experiment ONLY on explicit request" \
  bash -c "grep -q 'join_experiment' '$FORK'"
check "fork join is DRAFT-only (§15.8: running Σ/arm-set locked; stopped is history) → 409" \
  bash -c "grep -q 'experiment_not_joinable' '$FORK' && grep -q 'status !== \"draft\"' '$FORK'"
check "explicit duplicate variant_label → 400 on fork AND start (auto-advance stays)" \
  bash -c "grep -q 'already used by another Version' '$FORK' && grep -q 'nextVariantLabel' '$FORK' && grep -q 'duplicate variant_label' '$ARTICLES'"

# --- §30.7 case c: explicit new revision period --------------------------------
check "route: POST /versions/:id/new-revision" \
  bash -c "grep -q '\"/versions/:id/new-revision\"' '$ROUTER' && grep -q 'newRevisionVersionHandler' '$ROUTER'"
check "new-revision reuses the SAME atomic save core as PUT (mode switch)" \
  bash -c "grep -q 'applyVersionSave(c, version, body, \"new_revision\")' '$VERSIONS' && grep -q 'applyVersionSave(c, version, body, \"put\")' '$VERSIONS'"
check "new-revision ALWAYS bumps content_version" \
  bash -c "grep -q 'mode === \"new_revision\"' '$VERSIONS' && grep -q 'version.content_version + 1' '$VERSIONS'"
check "plain PUT still 409s running_version_immutable" \
  grep -q 'running_version_immutable' "$VERSIONS"
check "published gate treats a LAYOUT change as behavioral (§30.7 case c names layout)" \
  bash -c "grep -q 'layoutChanged' '$VERSIONS' && grep -q 'treeChanged || layoutChanged' '$VERSIONS'"

# --- §30.6 Version preview ------------------------------------------------------
check "route: POST /versions/:id/preview" \
  bash -c "grep -q '\"/versions/:id/preview\"' '$ROUTER' && grep -q 'versionPreviewHandler' '$ROUTER'"
check "preview reuses the REAL rule evaluation semantics (rules.ts)" \
  bash -c "grep -q 'evaluateRules' '$PREVIEW' && grep -q 'parseConditions' '$PREVIEW'"
check "preview CTA density reads the §30.7 ledger" \
  grep -q 'listicle_section_link_instances' "$PREVIEW"
check "preview renders through the token stylesheets (no hand-written measured CSS)" \
  bash -c "grep -q 'defaultLayoutSectionCss' '$PREVIEW' && grep -q 'defaultListicleLayoutTokens' '$PREVIEW'"

# --- experiment lifecycle (§5.3) -------------------------------------------------
check "routes: POST /experiments/:id/start + /stop" \
  bash -c "grep -q '\"/experiments/:id/start\"' '$ROUTER' && grep -q '\"/experiments/:id/stop\"' '$ROUTER'"
check "draft create supported (builder path); §5.2 active pointer stays running-only" \
  bash -c "grep -q \"createStatus === \\\"running\\\"\" '$ARTICLES' && grep -q \"status = 'draft'\" '$ARTICLES'"
check "start validates Σ==100 + exactly one control over the merged state" \
  bash -c "grep -q 'must total 100' '$ARTICLES' && grep -q 'exactly one control version is required' '$ARTICLES'"

# --- DEV-10: ?search= on GET /articles --------------------------------------------
check "articles list accepts ?search= (name/slug LIKE, escaped)" \
  bash -c "grep -q 'a.article_name LIKE ? ESCAPE' '$ARTICLES' && grep -q 'a.slug LIKE ? ESCAPE' '$ARTICLES'"

# --- §30.2 byline on the version save ----------------------------------------------
check "PUT /versions/:id persists byline_json" \
  bash -c "grep -q 'byline_json = ?' '$VERSIONS' && grep -q 'validateByline' '$VERSIONS'"
check "validateByline enforces the §30.2 shape (enabled ⇒ author_name; label default Advertorial; unknown keys rejected)" \
  bash -c "grep -q 'validateByline' '$VALIDATION' && grep -q '\"Advertorial\"' '$VALIDATION' && grep -q 'unknown byline field' '$VALIDATION'"

# --- builder shell routes (§4/§11) ---------------------------------------------------
check "route: GET /admin/listicles/articles/new" \
  grep -q '"/admin/listicles/articles/new"' "$UI"
check "route: GET /admin/listicles/articles/:id/edit" \
  grep -q '"/admin/listicles/articles/:id/edit"' "$UI"
check "articles list: LIVE Create link (Phase-3 disabled button replaced)" \
  bash -c "grep -q 'href=\"/admin/listicles/articles/new\"' '$LISTS' && ! grep -q 'Article builder ships in Phase 5' '$LISTS'"
check "articles list: search box + Edit row action deep-linking by art_ public id" \
  bash -c "grep -q 'Search articles' '$LISTS' && grep -q 'articles/\${escapeHtml(a.public_id)}/edit' '$LISTS'"

exit $FAIL
