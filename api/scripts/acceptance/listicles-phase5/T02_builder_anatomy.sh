#!/usr/bin/env bash
# Phase5.AC (§8/§11/§15.4/§15.5/§15.6/§23/§30.2/§30.6): the Article-builder
# page anatomy — base card + versions rail (Σ=100 indicator, one-control
# marker, start/stop), per-Version editor incl. the §30.2 byline editor,
# Pages builder (3 modes, Section picker, per-page Σ, rule editor with
# tag-input sets + hour/daypart ranges, exactly-one-fallback, Validate
# rules), the §15.5 conflict-matrix renderer, the §15.6/§30.7 immutability
# dialog surfaced where the 409s fire, and the §30.6 Version preview (force
# Version/candidate, simulate dims, CTA density, desktop/mobile).
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

PAGE="$REPO_ROOT/api/src/admin/listicles/ui-article-builder.ts"

# --- base + states (§8/§11/§23) -----------------------------------------------
check "base card: Site*/name/slug with field-keyed error slots" \
  bash -c "grep -q 'lst-a-site' '$PAGE' && grep -q 'lst-a-slug' '$PAGE' && grep -q 'fieldError(\"site_id\")' '$PAGE' && grep -q 'fieldError(\"slug\")' '$PAGE'"
check "§8 dirty guards (beforeunload + discard confirm)" \
  bash -c "grep -q 'beforeunload' '$PAGE' && grep -q 'Discard unsaved builder changes' '$PAGE'"
check "control Version auto-created on create (§11 copy on the new page)" \
  grep -q 'auto-creates its control Version' "$PAGE"

# --- versions rail (§11/§15.8) ---------------------------------------------------
check "rail: A/B this Article + add-version(fork) + start/stop" \
  bash -c "grep -q 'lst-ab-create' '$PAGE' && grep -q 'lst-add-version' '$PAGE' && grep -q 'lst-exp-start' '$PAGE' && grep -q 'lst-exp-stop' '$PAGE'"
check "rail: Σ indicator green ONLY at 100" \
  bash -c "grep -q 'lst-sigma-ok' '$PAGE' && grep -q \"sum === 100 ? 'lst-sigma-ok' : 'lst-sigma-bad'\" '$PAGE'"
check "rail: exactly-one-control marker (radio group)" \
  grep -q "name = 'lst-exp-control'" "$PAGE"

# --- version editor + §30.2 byline -------------------------------------------------
check "version fields: headline*/intro*/hero card/layout select" \
  bash -c "grep -q 'lst-v-headline' '$PAGE' && grep -q 'lst-v-intro' '$PAGE' && grep -q 'renderHeroImageCard' '$PAGE' && grep -q 'lst-v-layout' '$PAGE'"
check "byline editor: enabled toggle + author + avatar-via-media + label + updated label/date" \
  bash -c "grep -q 'lst-b-enabled' '$PAGE' && grep -q 'lst-b-author' '$PAGE' && grep -q 'lst-b-avatar-file' '$PAGE' && grep -q 'lst-b-updated-date' '$PAGE' && grep -q \"placeholder=\\\"Advertorial\\\"\" '$PAGE'"
check "byline avatar uploads through POST /admin/media" \
  bash -c "grep -q \"fetch('/admin/media'\" '$PAGE'"

# --- pages builder (§11/§15.4/§23) ---------------------------------------------------
check "pages: add/remove/reorder recompute page_index" \
  bash -c "grep -q 'lst-page-add' '$PAGE' && grep -q 'reindexPages' '$PAGE' && grep -q 'movePage' '$PAGE'"
check "selection modes single|ab_test|rule_based per page" \
  bash -c "grep -q \"'single', 'ab_test', 'rule_based'\" '$PAGE'"
check "Section picker: search over the sections list API, name + headline rows" \
  bash -c "grep -q 'lst-section-picker' '$PAGE' && grep -q '/api/admin/listicles/sections?status=active' '$PAGE' && grep -q 'headline_text' '$PAGE'"
check "ab_test: per-candidate traffic % + per-page Σ badge + stable ab_test_id display" \
  bash -c "grep -q 'lst-cand-alloc-input' '$PAGE' && grep -q 'data-page-sigma' '$PAGE' && grep -q 'ab_test_id:' '$PAGE'"
check "rule editor: priority int + §15.4 set dims as TAG inputs + hour/daypart ranges" \
  bash -c "grep -q 'lst-rule-priority' '$PAGE' && grep -q 'makeTagInput' '$PAGE' && grep -q 'lst-rule-add-dim' '$PAGE' && grep -q 'daypart' '$PAGE'"
check "rule_based: exactly-one-fallback toggle (radio per page)" \
  bash -c "grep -q 'lst-cand-fallback' '$PAGE' && grep -q \"'lst-fallback-' + page.page_index\" '$PAGE'"
check "Validate rules → POST /pages/:id/validate" \
  bash -c "grep -q 'lst-rule-validate' '$PAGE' && grep -q '/validate' '$PAGE'"

# --- §15.5 conflict matrix -------------------------------------------------------------
check "matrix renderer: candidates × dimensions grid, hit cells highlighted, blocking red / warning amber" \
  bash -c "grep -q 'lstConflictMatrix' '$PAGE' && grep -q 'lst-mx-hit' '$PAGE' && grep -q 'lst-mx-blocking' '$PAGE' && grep -q 'lst-mx-warning' '$PAGE'"
check "the SAME matrix renders when the SAVE is blocked (fields arrays → matrix)" \
  grep -q 'renderConflictPayload' "$PAGE"

# --- §15.6/§30.7 case c surfaced at the 409s ---------------------------------------------
check "immutability dialog: fork vs new-revision choice + explicit experiment join" \
  bash -c "grep -q 'lst-immutable-modal' '$PAGE' && grep -q 'lst-imm-fork' '$PAGE' && grep -q 'lst-imm-revision' '$PAGE' && grep -q 'lst-imm-join' '$PAGE'"
check "join checkbox gated on DRAFT-experiment membership; standalone copy otherwise" \
  bash -c "grep -q 'forkJoinAvailable' '$PAGE' && grep -q 'lst-imm-standalone-note' '$PAGE' && grep -q 'standalone DRAFT Version' '$PAGE'"
check "dialog opens exactly on running_version_immutable / published_version_immutable" \
  bash -c "grep -q \"res.body.error === 'running_version_immutable'\" '$PAGE' && grep -q \"'published_version_immutable'\" '$PAGE'"

# --- §30.6 Version preview ----------------------------------------------------------------
check "preview: force Version select + per-page force candidates + simulate dims + hour" \
  bash -c "grep -q 'lst-pv-version' '$PAGE' && grep -q 'data-pv-force-page' '$PAGE' && grep -q 'data-pv-dim' '$PAGE' && grep -q 'lst-pv-hour' '$PAGE'"
check "preview: per-page CTA-density readout" \
  bash -c "grep -q 'lst-pv-density' '$PAGE' && grep -q 'cta_density' '$PAGE'"
check "preview: sandboxed srcdoc iframe + desktop/mobile toggle" \
  bash -c "grep -q 'sandbox=\"\"' '$PAGE' && grep -q 'lst-preview-mobile' '$PAGE'"
check "§31.0 honesty declared on-page (content-accurate, parity gated)" \
  grep -q 'pixel parity is gated on the §31.0 reference captures' "$PAGE"

# --- read-only structure + publish (§11 actions) ----------------------------------------------
check "View structure renders the §7.1 tree read-only" \
  bash -c "grep -q 'lst-view-structure' '$PAGE' && grep -q '/structure' '$PAGE' && grep -q 'lst-structure-tree' '$PAGE'"
check "Publish re-validates server-side and renders field-keyed errors" \
  bash -c "grep -q 'lst-article-publish' '$PAGE' && grep -q '/publish' '$PAGE'"

exit $FAIL
