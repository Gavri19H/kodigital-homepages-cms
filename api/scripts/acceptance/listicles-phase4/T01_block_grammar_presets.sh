#!/usr/bin/env bash
# Phase4.AC (§12/§30.5): the listicle block grammar is registered — the
# governed block types (button / choice_button_group / final_text_cta /
# linked_image / spacer), the §12 list markers + curated colour tokens +
# emoji set, the §30.7 governed-anchor attribute bundle + rel, NO stored
# /lc URLs, and all 17 §30.5 reference presets each carrying a layout_binding.
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

GRAMMAR="$REPO_ROOT/api/src/editor/listicle-blocks.ts"
EDITOR="$REPO_ROOT/api/src/editor/editor-scripts.ts"
EXTRACT="$REPO_ROOT/api/src/listicles/link-instances.ts"
VALIDATE="$REPO_ROOT/api/src/listicles/validation.ts"
TOKENS_CSS="$REPO_ROOT/api/src/public/listicle/layouts/default/tokens-to-css.ts"

# --- §12 block additions -------------------------------------------------------
for type in button choice_button_group final_text_cta linked_image spacer; do
  check "block type registered: $type" grep -q "\"$type\"" "$GRAMMAR"
done
for marker in disc dash ordered check emoji; do
  check "list marker: $marker" bash -c "grep -q '\"$marker\"' '$GRAMMAR'"
done
check "curated text colours derive from the §30.1 tokens" \
  grep -q "LISTICLE_TEXT_COLORS" "$GRAMMAR"
check "curated highlights present" grep -q "LISTICLE_HIGHLIGHTS" "$GRAMMAR"
check "curated emoji set present (no npm dep)" grep -q "LISTICLE_EMOJI_SET" "$GRAMMAR"

# --- §30.7 governed anchor bundle ---------------------------------------------
check "governed rel constant" grep -q 'sponsored nofollow noopener' "$GRAMMAR"
for attr in data-offer data-link-instance data-block-id data-link-role; do
  check "governed attr emitted: $attr" grep -q "$attr" "$GRAMMAR"
done
check "NO /lc URL is stored by the grammar (§12: live renderer mints it)" \
  bash -c "! grep -q '\"/lc/' '$GRAMMAR'"

# --- §30.5 presets ---------------------------------------------------------------
check "17 reference presets registered" \
  bash -c "[ \"\$(grep -c 'key: \"reference-' '$GRAMMAR')\" -eq 17 ]"
for preset in "Reference Section Heading" "Reference Linked Section Heading" \
  "Reference Linked Image" "Reference Paragraph" "Reference Strong Text" \
  "Reference Inline Offer Link" "Reference Qualification Heading" \
  "Reference Step Text" "Reference Question Prompt" \
  "Reference Choice Button Group" "Reference Choice Button" \
  "Reference Checkmark List" "Reference Bullet List" \
  "Reference Disclaimer Paragraph" "Reference Final Text CTA" \
  "Reference Legal Disclosure" "Reference Spacer / Gap"; do
  check "preset: $preset" grep -q "$preset" "$GRAMMAR"
done
check "every preset carries a layout_binding" \
  bash -c "[ \"\$(grep -c 'layout_binding: \"default\.' '$GRAMMAR')\" -ge 17 ]"
check "choice items pin style_id reference-choice-button (§30.5)" \
  grep -q 'reference-choice-button' "$GRAMMAR"

# --- extractor picks up the §30.5 shapes -----------------------------------------
check "extractor: linked_image role" grep -q '"linked_image"' "$EXTRACT"
check "extractor: enrichment writes lnk_ ids back (applyLinkInstances)" \
  grep -q "applyLinkInstances" "$EXTRACT"
check "validation: choice group items must be offer-bound" \
  grep -q "choice button" "$VALIDATE"
check "validation: ungoverned anchors block the save" \
  grep -q "ANCHOR_WITHOUT_OFFER_RE" "$VALIDATE"

# --- client editor extension (shared machinery, not a fork) ----------------------
check "client editor: listicle option gates the extension" \
  grep -q "options.listicle" "$EDITOR"
check "client editor: choice-group edit surface" \
  grep -q "renderLstChoiceGroupContent" "$EDITOR"
check "client editor: governed elements model for the inventory" \
  grep -q "getGovernedElements" "$EDITOR"

# --- tokensToCss util (§30.6 preview core, Phase-6 reusable) ---------------------
check "tokensToCss util exists under layouts/default" test -f "$TOKENS_CSS"
check "tokensToCss scopes under [data-layout=default]" \
  grep -q 'data-layout="default' "$TOKENS_CSS"

exit $FAIL
