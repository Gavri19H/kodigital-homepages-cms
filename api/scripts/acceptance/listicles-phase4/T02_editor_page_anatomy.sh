#!/usr/bin/env bash
# Phase4.AC (§4/§10/§13/§30.6): the Section editor page + routes exist —
# /sections/new + /:id/edit registered (the Phase-3 disabled button became a
# live link), the §10 anatomy (name / image via the reused media+AI card /
# clickable headline / AI presets / rich editor), the §13 Offer picker as the
# ONLY link mechanism (no URL field in the section editor; "＋ New Offer"
# inline; recently-used pinned; keyboard nav), the §30.6 CTA/Link Inventory
# (bulk replace / duplicate / move / jump) and the token-styled preview with
# the desktop/mobile toggle + preview endpoint.
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

UI="$REPO_ROOT/api/src/admin/listicles/ui.ts"
LISTS="$REPO_ROOT/api/src/admin/listicles/ui-lists.ts"
PAGE="$REPO_ROOT/api/src/admin/listicles/ui-section-editor.ts"
PICKER="$REPO_ROOT/api/src/admin/listicles/ui-offer-picker.ts"
OFFERS="$REPO_ROOT/api/src/admin/listicles/ui-offers.ts"
ROUTER="$REPO_ROOT/api/src/admin/listicles/router.ts"
PREVIEW="$REPO_ROOT/api/src/admin/listicles/section-preview.ts"
HANDLERS="$REPO_ROOT/api/src/admin/listicles/sections-handlers.ts"

# --- §4 routes: /new + /:id/edit (Sections only this phase) --------------------
check "route: GET /admin/listicles/sections/new" \
  grep -q '"/admin/listicles/sections/new"' "$UI"
check "route: GET /admin/listicles/sections/:id/edit" \
  grep -q '"/admin/listicles/sections/:id/edit"' "$UI"
check "sections list: live + Create Section link (Phase-3 disabled button replaced)" \
  grep -q 'href="/admin/listicles/sections/new"' "$LISTS"
check "sections list: Edit row action links to the editor" \
  bash -c "grep -q 'sections/\${s.id}/edit' '$LISTS'"
check "articles Create stays disabled until Phase 5" \
  bash -c "grep -q 'title=\"Article builder ships in Phase 5\"' '$LISTS'"

# --- §10 create structure --------------------------------------------------------
check "field: section_name" grep -q 'lst-section-name' "$PAGE"
check "image: reused hero-image machinery (upload/GIF/AI), relabeled" \
  grep -q 'renderHeroImageCard' "$PAGE"
check "headline text + clickable toggle" grep -q 'lst-headline-clickable' "$PAGE"
check "headline offer chip" grep -q 'lst-headline-chip' "$PAGE"
check "AI presets section (ai_settings)" grep -q 'lst-ai-preset' "$PAGE"
check "rich content editor mount (the SHARED editor)" \
  grep -q 'renderBlockEditorField' "$PAGE"
check "editor boots with the listicle configuration" \
  grep -q 'listicleEditorClientConfig' "$PAGE"
check "save drives the Phase-2 sections API" \
  bash -c "grep -q '/api/admin/listicles/sections' '$PAGE'"
check "§8 dirty guards (beforeunload + cancel confirm)" \
  bash -c "grep -q 'beforeunload' '$PAGE' && grep -q 'Discard unsaved section changes' '$PAGE'"

# --- §13 Offer picker: the single link mechanism, no URL field -------------------
check "picker component exists" test -f "$PICKER"
check "picker: debounced /offers/search (active ≤50)" \
  bash -c "grep -q '/api/admin/listicles/offers/search' '$PICKER'"
check "picker: recently-used pinned via localStorage" \
  bash -c "grep -q 'lst_recent_offers' '$PICKER' && grep -q 'Recently used' '$PICKER'"
check "picker: ＋ New Offer opens the Create-Offer modal inline" \
  grep -q 'lstOfferModal.openCreate' "$PICKER"
check "picker: created offer returns pre-selected (saved hook)" \
  bash -c "grep -q '_lstOfferModalOnSaved' '$PICKER' && grep -q '_lstOfferModalOnSaved' '$OFFERS'"
check "picker: keyboard nav (ArrowDown/ArrowUp/Enter/Escape)" \
  bash -c "grep -q 'ArrowDown' '$PICKER' && grep -q 'ArrowUp' '$PICKER' && grep -q \"'Enter'\" '$PICKER' && grep -q 'Escape' '$PICKER'"
check "no URL input in the section editor markup (offer modal aside)" \
  bash -c "! grep -q 'type=\"url\"' '$PAGE' && ! grep -q 'type=\"url\"' '$PICKER'"
check "the DOM-level no-URL-field assertion is pinned by a test" \
  grep -q 'no free-text URL field' "$REPO_ROOT/api/test/listicles-section-editor-page.test.ts"

# --- §30.6 CTA/Link Inventory + preview -------------------------------------------
check "inventory panel present" grep -q 'lst-inv-body' "$PAGE"
check "inventory: bulk replace across the Section" grep -q 'lst-bulk-replace' "$PAGE"
check "inventory actions: duplicate / move / jump" \
  bash -c "grep -q \"'dup'\" '$PAGE' && grep -q \"'up'\" '$PAGE' && grep -q \"'jump'\" '$PAGE'"
check "preview iframe + desktop/mobile toggle" \
  bash -c "grep -q 'lst-section-preview' '$PAGE' && grep -q 'lst-preview-mobile' '$PAGE'"
check "preview endpoint registered (POST /sections/preview)" \
  bash -c "grep -q '\"/sections/preview\"' '$ROUTER' && grep -q 'previewSectionHandler' '$HANDLERS'"
check "preview renders inside the token-derived SectionWrapper" \
  bash -c "grep -q 'defaultLayoutSectionCss' '$PREVIEW' && grep -q 'lst-section' '$PREVIEW'"

exit $FAIL
