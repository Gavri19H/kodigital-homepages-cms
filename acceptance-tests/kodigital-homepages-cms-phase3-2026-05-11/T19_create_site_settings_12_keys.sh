#!/usr/bin/env bash
# T19.AC: create_site_settings step seeds 12 setting keys.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T19] $desc"; else echo "FAIL [T19] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/site-provisioning/steps.ts"
check "steps.ts exists" test -f "$F"
for k in site_name logo_media_id tagline site_description brand_tokens_json \
         robots_txt_content ads_txt_content custom_head_html custom_footer_html \
         newsletter_settings_json contact_email privacy_email; do
  check "setting key '$k' present" grep -qE "'$k'" "$F"
done
check "seedDefaultSiteSettings function" grep -qE "seedDefaultSiteSettings" "$F"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
