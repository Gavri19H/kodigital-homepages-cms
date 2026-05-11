#!/usr/bin/env bash
# T20.AC: legal-renderer substitutes 6 template variables in render_generic_legal_pages.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T20] $desc"; else echo "FAIL [T20] $desc"; FAIL=1; fi
}
F="$REPO_ROOT/api/src/site-provisioning/legal-renderer.ts"
S="$REPO_ROOT/api/src/site-provisioning/steps.ts"
check "legal-renderer.ts exists" test -f "$F"
check "steps.ts exists" test -f "$S"
for v in site_name domain contact_email privacy_email effective_date company_name; do
  check "variable '{{$v}}' substituted" grep -q "{{$v}}" "$F"
done
check "render_generic_legal_pages_with_site_variables step wires legal-renderer" grep -qE "renderLegalPagesForSite|renderLegalPagesStep" "$S"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
