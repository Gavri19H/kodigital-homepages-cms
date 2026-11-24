#!/usr/bin/env bash
# Run from the allowed perfstage admin IP. The fourth argument defaults to ./perfstage-probe.json.
# Fixture example (the sitemap omits categories, listicles and leadgen activations):
# {
#   "second_tenant_host": "other.example", "article": "/article/story", "category": "/category/news",
#   "listicle": "/best-cars", "quote": "/lg/auto", "quote_id": 7, "rule_id": 9,
#   "redirect_location": "/lg/lc/offer_public_id"
# }
# Pick a disabled 100% entry redirect on the test quote that wins for utm_source=perfstage-probe.
# The first 30 published articles for this tenant in GET /articles (including the named article)
# are used for the burst. If that 200-row catalog is insufficient, supply "article_ids" with
# 30 distinct published IDs including the named article. All original titles are read by ID.
# To spread the burst across tenants, supply "burst" with 30 distinct {"host":"example","id":123}
# entries. If it omits the named article, that article is looked up separately in GET /articles.
set -euo pipefail
set -E

check=inputs
pass() { printf 'CHECK %s PASS %s\n' "$check" "$*"; }
fail() { printf 'CHECK %s FAIL %s\n' "$check" "$*" >&2; exit 1; }
trap 'fail "command failed at line $LINENO (exit $?)"' ERR

[[ $# == 3 || $# == 4 ]] || fail 'usage: perfstage-probe.sh <base-url> <tenant-host> <admin-host-base> [fixture.json]'
base=${1%/}
tenant=$2
admin=${3%/}
fixture=${4:-perfstage-probe.json}
[[ -r "$fixture" ]] || fail "cannot read $fixture (see the fixture example at the top of this script)"
origin='^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'
[[ $base =~ $origin && $admin =~ $origin ]] || fail "expected HTTPS Worker and admin origins"
[[ $tenant =~ ^[a-zA-Z0-9.-]+$ ]] || fail "invalid tenant hostname"
command -v curl >/dev/null && command -v jq >/dev/null || fail "curl and jq are required"
jq -e '
  def id: type == "number" and . > 0 and . == floor;
  def normalized_host: ascii_downcase | sub("\\.$"; "");
  def valid_host: type == "string" and (normalized_host | length <= 253 and
    (split(".") | length > 0 and
      all(.[]; test("\\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\z"))));
  (.second_tenant_host | test("^[a-zA-Z0-9.-]+$")) and
  (.article | test("^/article/[^/?#[:space:]]+$")) and
  (.category | test("^/category/[^/?#[:space:]]+$")) and
  (.listicle | test("^/[^/?#[:space:]]+$")) and
  (.quote | test("^/lg(/[^/?#[:space:]]+)?$")) and
  (.quote_id | (id or (type == "string" and test("^lgq_[a-zA-Z0-9]+$")))) and
  (.rule_id | id) and (.redirect_location | type == "string" and length > 0) and
  (if has("burst") then
    .burst | type == "array" and length == 30 and
    all(.[]; type == "object" and (.host | valid_host) and (.id | id)) and
    (unique_by([(.host | normalized_host), .id]) | length == 30)
  else true end)
' "$fixture" >/dev/null || fail "invalid fixture in $fixture"
other=$(jq -r .second_tenant_host "$fixture")
article=$(jq -r .article "$fixture")
category=$(jq -r .category "$fixture")
listicle=$(jq -r .listicle "$fixture")
quote=$(jq -r .quote "$fixture")
quote_id=$(jq -r .quote_id "$fixture")
rule_id=$(jq -r .rule_id "$fixture")
location=$(jq -r .redirect_location "$fixture")

umask 077
tmp=$(mktemp -d "${TMPDIR:-/tmp}/perfstage-probe.XXXXXXXX")
run_id=${tmp##*.}
ua='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
now_ms() { jq -n 'now * 1000 | floor'; }
seconds() { printf '%d.%03d' "$(($1 / 1000))" "$(($1 % 1000))"; }

# Keep the headers, body and actual status of each transfer together. Never follow redirects.
http() {
  local name=$1 url=$2
  shift 2
  curl -q --silent --show-error --globoff --connect-timeout 5 --max-time 15 --user-agent "$ua" \
    --dump-header "$tmp/$name.headers" --output "$tmp/$name.body" --write-out '%{http_code}' \
    "$@" -- "$url" > "$tmp/$name.code"
}
public_get() {
  local name=$1 host=$2 path=$3
  shift 3
  http "$name" "$base$path" -H "x-perfstage-host: $host" -H 'Accept: text/html' "$@"
}
status_is() {
  local received
  received=$(<"$tmp/$1.code")
  [[ $received == "$2" ]] || fail "$1 returned HTTP $received, expected $2"
}
header() {
  awk -v key="$2" '{
    sub(/\r$/, ""); i = index($0, ":")
    if (tolower(substr($0, 1, i-1)) == key) {
      value = substr($0, i+1); sub(/^[ \t]+/, "", value); print value
    }
  }' "$tmp/$1.headers"
}
response_colo() {
  local ray
  ray=$(header "$1" cf-ray)
  if [[ $ray =~ -([A-Z]{3})[[:blank:]]*$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  else
    printf 'n/a\n'
  fi
}
require_repeat_hit() {
  local warm=$1 name=$2 host=$3 path=$4
  shift 4
  local first colo cache hit_on=n/a extra=0 seen_colos=' '
  local cross_colo_first=n/a saw_new_colo=0
  first=$(response_colo "$warm")
  if [[ -f $tmp/$warm.colos ]]; then
    seen_colos=$(<"$tmp/$warm.colos")
  elif [[ $first != n/a ]]; then
    seen_colos=" $first "
  fi

  while :; do
    public_get "$name" "$host" "$path" "$@"
    status_is "$name" 200
    colo=$(response_colo "$name")
    cache=$(header "$name" x-edge-cache)
    if [[ $colo != n/a ]]; then
      if [[ $seen_colos == *" $colo "* ]]; then
        if [[ $cache == HIT ]]; then hit_on=$colo; fi
        break
      fi
      if [[ $seen_colos != ' ' && $saw_new_colo == 0 ]]; then
        case "$cache" in HIT|MISS) cross_colo_first=$cache ;; esac
        saw_new_colo=1
      fi
      seen_colos+="$colo "
    fi
    if (( extra == 5 )); then break; fi
    extra=$((extra + 1))
  done

  printf 'COLO %s first=%s hit_on=%s extra_requests=%d cross_colo_first=%s\n' \
    "$check" "$first" "$hit_on" "$extra" "$cross_colo_first"
  [[ $hit_on != n/a ]] || fail "$host$path x-edge-cache=${cache:-missing} in $colo, expected a same-colo HIT"
  printf '%s\n' "$seen_colos" > "$tmp/$name.colos"
}
admin_get() {
  http "$1" "$admin/api/admin/$2"
  status_is "$1" 200
}

# Validate the returned row as well as HTTP 200. Use separate files for concurrent PATCHes.
patch_row() {
  local name=$1 route=$2 payload=$3
  http "$name" "$admin/api/admin/$route" -X PATCH -H 'Content-Type: application/json' \
    --data-binary "@$payload" &&
    [[ $(<"$tmp/$name.code") == 200 ]] &&
    jq -e --argjson id "${route##*/}" --slurpfile want "$payload" '
      (.article // .) as $row | $row.id == $id and
      all($want[0] | to_entries[]; $row[.key] == .value)
    ' "$tmp/$name.body" >/dev/null
}
rule_route="leadgen/routing-rules/$rule_id"
restore_row() {
  if patch_row "$@"; then return 0; fi
  # Replaying the same saved fields is safe if the first response was lost.
  sleep 1
  patch_row "$@"
}
restore_rule() {
  restore_row restore-rule "$rule_route" "$tmp/undo/rule.json" && rm "$tmp/undo/rule.json"
}
cleanup() {
  local rc=$? file id restored=0 errors=0
  trap - EXIT ERR
  trap '' HUP INT TERM
  set +e
  # On interruption, settle any in-flight PATCHes before replaying the undo files.
  wait
  if [[ -f $tmp/undo/rule.json ]]; then
    restore_rule || { printf 'CHECK restore-rule FAIL rule %s\n' "$rule_id" >&2; errors=1; }
  fi
  for file in "$tmp"/undo/[0-9]*.json; do
    [[ -f $file ]] || continue
    id=${file##*/}; id=${id%.json}
    if restore_row "restore-$id" "articles/$id" "$file"; then
      rm "$file"
      restored=$((restored + 1))
    else
      printf 'CHECK restore-title FAIL article %s\n' "$id" >&2
      errors=1
    fi
  done
  if (( errors )); then
    printf 'CHECK restore FAIL remaining original PATCH payloads in %s/undo\n' "$tmp" >&2
    exit 1
  fi
  rm -rf "$tmp"
  printf 'CHECK restore PASS %d article titles restored, no pending edits\n' "$restored"
  exit "$rc"
}
trap cleanup EXIT
trap 'fail "interrupted"' HUP INT TERM
mkdir "$tmp/undo"
pass "loaded $fixture"

# The same admin route must authenticate normally and hit the tenant 404 gate under the override.
# This identifies the perfstage-only behavior on the actual mutation origin before any PATCH.
check=perfstage-admin
admin_get auth auth/status
jq -e '.authenticated == true' "$tmp/auth.body" >/dev/null || fail "admin authentication required"
http tenant-auth "$admin/api/admin/auth/status" -H "x-perfstage-host: $tenant"
status_is tenant-auth 404
pass "authenticated admin origin honors the perfstage host override"

check=article-fixtures
admin_get domains domains
site_for_host() {
  jq -er --arg host "$1" '
    [.resource[] | select(.status == "active" and (.hostname | ascii_downcase) == ($host | ascii_downcase))]
    | select(length == 1) | .[0].site_id | select(type == "string" and length > 0)
  ' "$tmp/domains.body"
}
site=$(site_for_host "$tenant") || fail "no active domain for $tenant"
second_site=$(site_for_host "$other") || fail "no active domain for $other"
[[ $site != "$second_site" ]] || fail "both hostnames resolve to site $site"
load_article() {
  local id=$1 article_site=$2
  admin_get row "articles/$id"
  jq -e --argjson id "$id" --arg site "$article_site" '
    .article | select(.id == $id and .site_id == $site and .status == "published" and
      (.slug | type == "string" and length > 0) and (.title | type == "string")) | {site_id,title}
  ' "$tmp/row.body" > "$tmp/original-$id.json" || fail "article $id is not a published article of $article_site"
  row_path=$(jq -r '"/article/" + (.article.slug | @uri)' "$tmp/row.body")
}
explicit_burst=0
if jq -e 'has("burst")' "$fixture" >/dev/null; then
  explicit_burst=1
  jq -r '.burst[] | [.host, (.id | floor)] | @tsv' "$fixture" > "$tmp/burst-entries"
else
  if jq -e 'has("article_ids")' "$fixture" >/dev/null; then
    jq '.article_ids' "$fixture" > "$tmp/ids.json"
  else
    admin_get catalog articles
    jq --arg site "$site" --arg path "$article" '
      [.articles[] | select(.site_id == $site and .status == "published")]
      | sort_by(("/article/" + (.slug | @uri)) != $path) | .[:30] | map(.id)
    ' "$tmp/catalog.body" > "$tmp/ids.json"
  fi
  jq -e 'type == "array" and length == 30 and (unique | length == 30) and
    all(.[]; type == "number" and . > 0 and . == floor)' "$tmp/ids.json" >/dev/null ||
    fail "supply 30 distinct published article_ids from $tenant in $fixture"
  jq -r --arg host "$tenant" '.[] | [$host, .] | @tsv' "$tmp/ids.json" > "$tmp/burst-entries"
fi
ids=() hosts=() paths=() primary=
while IFS=$'\t' read -r host id; do
  article_site=$site
  if (( explicit_burst )); then
    article_site=$(site_for_host "${host%.}") || fail "no active domain for $host"
  fi
  load_article "$id" "$article_site"
  ids+=("$id")
  hosts+=("$host")
  paths+=("$row_path")
  if [[ $article_site == "$site" && $row_path == "$article" ]]; then primary=$id; fi
done < "$tmp/burst-entries"
if (( explicit_burst )); then
  if [[ -z $primary ]]; then
    admin_get catalog articles
    primary=$(jq -er --arg site "$site" --arg path "$article" '
      .articles[] | select(.site_id == $site and .status == "published" and
        ("/article/" + (.slug | @uri)) == $path) | .id
    ' "$tmp/catalog.body") || fail "could not find published $tenant$article in the article catalog"
    load_article "$primary" "$site"
    [[ $row_path == "$article" ]] || fail "article $primary no longer matches $article"
  fi
  pass "30 distinct host and published article pairs"
else
  [[ -n $primary ]] || fail "the selected articles must include $article"
  pass "30 distinct published articles on $tenant"
fi

check=external-snapshot
public_get snapshot "$tenant" /__snap
status_is snapshot 404
pass "HTTP 404"

check_page() {
  local name=$1 host=$2 path=$3 cookies cache_control required response
  check="hit-$name"
  public_get "$name-first" "$host" "$path" --cookie-jar "$tmp/$name.jar"
  status_is "$name-first" 200
  # Replay ko_sid so a running A/B test selects the same cached shell on repeat GETs.
  require_repeat_hit "$name-first" "$name" "$host" "$path" --cookie "$tmp/$name.jar"
  [[ -s "$tmp/$name.body" ]] || fail "$path returned an empty page"
  pass "$host$path repeat GET HIT"
  check="cookies-$name"
  case "$name" in
    listicle|quote)
      cookies=$(header "$name-first" set-cookie)
      local names=(ko_sid)
      if [[ $name == listicle ]]; then names+=(ko_ver ko_ctx); fi
      for required in "${names[@]}"; do
        grep -q "^$required=." <<< "$cookies" || fail "$path missing $required"
      done
      cookies=$(header "$name" set-cookie)
      if grep -q '^ko_sid=' <<< "$cookies"; then fail "$path replaced the returning session"; fi
      if [[ $name == listicle ]]; then
        for required in ko_ver ko_ctx; do
          grep -q "^$required=." <<< "$cookies" || fail "$path HIT missing $required"
        done
      fi
      for response in "$name-first" "$name"; do
        cache_control=$(header "$response" cache-control)
        grep -Eiq '(^|,)[[:space:]]*private[[:space:]]*(,|$)' <<< "$cache_control" ||
          fail "$response Cache-Control=${cache_control:-missing}"
      done
      pass "$path sets ${names[*]} and stays private on HIT"
      ;;
    *)
      for response in "$name-first" "$name"; do
        [[ -z $(header "$response" set-cookie) ]] || fail "$response set a cookie"
      done
      pass "zero Set-Cookie headers on warming and HIT GETs"
      ;;
  esac
}
check_page home "$tenant" /
check_page article "$tenant" "$article"
check_page category "$tenant" "$category"
check_page listicle "$tenant" "$listicle"
check_page quote "$tenant" "$quote"
check_page other-home "$other" /

check=tenant-isolation
require_repeat_hit home revisit "$tenant" /
cmp -s "$tmp/home.body" "$tmp/revisit.body" || fail "first tenant changed after visiting the second tenant"
if cmp -s "$tmp/home.body" "$tmp/other-home.body"; then fail "both tenants returned the same homepage"; fi
pass "$tenant and $other served different homepage bodies from HITs"
check=query-cache
require_repeat_hit article tracking "$tenant" "$article?utm_source=a&fbclid=b"
cmp -s "$tmp/article.body" "$tmp/tracking.body" || fail "$article body changed with tracking parameters"
pass "$article HIT with byte-identical body"

title_payload() {
  jq --arg title "$2" '.title = $title' "$tmp/original-$1.json" > "$3"
}
visible_title() {
  case "$(header "$1" x-edge-cache)" in
    HIT|MISS|EXPIRED|REVALIDATED|UPDATING|STALE) grep -Fq -- ">$2</h1>" "$tmp/$1.body" ;;
    *) return 1 ;;
  esac
}

check=publish-freshness
title="Perfstage publish $run_id"
title_payload "$primary" "$title" "$tmp/publish.json"
ln "$tmp/original-$primary.json" "$tmp/undo/$primary.json"
patch_row publish "articles/$primary" "$tmp/publish.json" || fail "PATCH article $primary failed"
published=$(now_ms)
while :; do
  public_get fresh "$tenant" "$article"
  status_is fresh 200
  elapsed=$(( $(now_ms) - published ))
  if visible_title fresh "$title"; then
    (( elapsed <= 5000 )) || fail "title first visible after $(seconds "$elapsed") s (limit 5 s)"
    break
  fi
  (( elapsed < 5000 )) || fail "title still stale after $(seconds "$elapsed") s (limit 5 s)"
  sleep 0.5
done
pass "$(seconds "$elapsed") s from PATCH acknowledgement to visible title"

check=quote-routing
admin_get rules "leadgen/quotes/$quote_id/routing-rules"
jq -e --argjson id "$rule_id" '
  .items[] | select(.id == $id and .status == "disabled" and .redirect_pct == 100 and
    (.target_offer_id != null or .redirect_url_allowlisted == true)) | {status}
' "$tmp/rules.body" > "$tmp/rule-original.json" || fail "expected a disabled 100% redirect on quote $quote_id"
routing_path="$quote?utm_source=perfstage-probe"
public_get before-rule "$tenant" "$routing_path" --cookie "$tmp/quote.jar"
status_is before-rule 200
# Article invalidation can have evicted the snapshot. Establish a HIT immediately before the edit.
require_repeat_hit before-rule warm-rule "$tenant" "$routing_path" --cookie "$tmp/quote.jar"
ln "$tmp/rule-original.json" "$tmp/undo/rule.json"
printf '%s\n' '{"status":"active"}' > "$tmp/enable.json"
patch_row enable "$rule_route" "$tmp/enable.json" || fail "PATCH rule $rule_id failed"
public_get after-rule "$tenant" "$routing_path" --cookie "$tmp/quote.jar"
status_is after-rule 302
actual=$(header after-rule location)
[[ $actual == "$location" ]] || fail "expected $location, got ${actual:-no Location}"
restore_rule || fail "could not restore rule $rule_id"
pass "next GET returned 302 to $actual, rule $rule_id restored"

check=burst-warm
for i in "${!ids[@]}"; do
  id=${ids[$i]}
  public_get warm-first "${hosts[$i]}" "${paths[$i]}"
  status_is warm-first 200
  require_repeat_hit warm-first warm "${hosts[$i]}" "${paths[$i]}"
  title_payload "$id" "Perfstage burst $run_id article $id" "$tmp/burst-$id.json"
done
pass "30/30 article pages warmed to HIT"

check=burst-writes
pids=()
for i in "${!ids[@]}"; do
  id=${ids[$i]}
  # Host aliases can share one admin row and one original title.
  if [[ ! -f $tmp/undo/$id.json ]]; then ln "$tmp/original-$id.json" "$tmp/undo/$id.json"; fi
  if (( i == 0 )); then started=$(now_ms); fi
  (trap - EXIT ERR; patch_row "write-$i" "articles/$id" "$tmp/burst-$id.json") &
  pids+=("$!")
done
for i in "${!pids[@]}"; do
  wait "${pids[$i]}" || fail "PATCH article ${ids[$i]} failed"
done
elapsed=$(( $(now_ms) - started ))
(( elapsed <= 60000 )) || fail "30 PATCHes took $(seconds "$elapsed") s (limit 60 s)"
pass "30/30 PATCHes acknowledged in $(seconds "$elapsed") s"

check=burst-visible
seen=0
while (( seen < 30 )); do
  for i in "${!ids[@]}"; do
    [[ -f $tmp/seen-$i ]] && continue
    id=${ids[$i]}
    public_get burst-read "${hosts[$i]}" "${paths[$i]}"
    status_is burst-read 200
    elapsed=$(( $(now_ms) - started ))
    (( elapsed <= 120000 )) || fail "$seen/30 visible within 120 s of the first PATCH"
    if visible_title burst-read "Perfstage burst $run_id article $id"; then
      touch "$tmp/seen-$i"
      seen=$((seen + 1))
    fi
  done
  if (( seen < 30 )); then sleep 0.5; fi
done
pass "$seen/30 distinct edited headings visible in $(seconds "$elapsed") s from the first PATCH"
