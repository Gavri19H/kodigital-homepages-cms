#!/usr/bin/env bash
# Phase1.AC: v1.2 link-instance model — six-role CHECKs, per-placement columns,
# byline_json on versions (contract §30.2 / §30.7).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
MIG="$REPO_ROOT/api/migrations/0032_listicles_core.sql"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T04] $desc"
  else
    echo "FAIL [T04] $desc"
    FAIL=1
  fi
}

SIX_ROLES="'headline','inline','linked_image','button','choice_button','final_text_cta'"
ROLE_COUNT=$(grep -c "$SIX_ROLES" "$MIG")
check "six-role link_role CHECK present twice (section_offers + link_instances), found $ROLE_COUNT" \
  test "$ROLE_COUNT" -eq 2

for col in public_id section_id offer_id block_id link_role position_index anchor_text_hash \
           button_style_id button_group_id analytics_label; do
  LI_BLOCK=$(awk '/CREATE TABLE IF NOT EXISTS listicle_section_link_instances/,/^\);/' "$MIG")
  if printf '%s' "$LI_BLOCK" | grep -q "$col"; then
    echo "PASS [T04] link_instances column $col"
  else
    echo "FAIL [T04] link_instances column $col missing"
    FAIL=1
  fi
done

check "link_instances index on section" grep -q "idx_listicle_linkinst_section" "$MIG"
check "link_instances index on offer" grep -q "idx_listicle_linkinst_offer" "$MIG"
check "versions carry byline_json (§30.2)" grep -q "byline_json TEXT" "$MIG"
check "versions layout_style_id defaults 'default'" \
  grep -q "layout_style_id TEXT NOT NULL DEFAULT 'default'" "$MIG"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
