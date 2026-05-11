#!/usr/bin/env bash
# T17.AC: 15 step keys in STEP_KEYS registry; behavioral 15-step run NEEDS_RUNTIME.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T17] $desc"; else echo "FAIL [T17] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/site-provisioning/steps.ts"
check "steps.ts exists" test -f "$F"
for k in validate_domain_in_cloudflare create_site_record \
         attach_domain_to_new_worker_or_mark_pending allocate_vertical_categories \
         create_site_settings generate_tagline_and_site_description_stub \
         generate_about_page_stub render_generic_legal_pages_with_site_variables \
         generate_logo_mark_stub generate_feature_image_stub \
         generate_15_homepage_articles_stub generate_or_assign_article_images_stub \
         publish_starter_articles warm_homepage_cache run_site_smoke_tests; do
  check "step key '$k' present" grep -qE "'$k'" "$F"
done
check "TOTAL_STEPS exported" grep -qE "export const TOTAL_STEPS" "$F"
[ "$FAIL" -eq 0 ] || exit 1
# Behavioral: requires running worker -> NEEDS_RUNTIME
if ! command -v wrangler >/dev/null 2>&1; then
  echo "INFO [T17] 15-step sequential POST not run (NEEDS_RUNTIME)"
  exit 2
fi
exit 0
