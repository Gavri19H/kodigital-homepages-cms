#!/usr/bin/env bash
set -euo pipefail
src=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'if [[ $? != 0 && -f ${STATE:-}/log ]]; then cat "$STATE/log" >&2; fi; rm -rf -- "$tmp"' EXIT
perf="$tmp/api/scripts/perf"
mkdir -p "$tmp/bin" "$perf"
cp "$src/rollout.sh" "$src/edge-probe.sh" "$perf/"
printf '%s\n' https://a.example/ https://b.example/ > "$perf/urls.txt"
export PATH="$tmp/bin:$PATH" PYTHONPATH="$tmp" ROLLOUT_POLL_SECONDS=.02 ROLLOUT_PROPAGATION_TIMEOUT_SECONDS=5

# Skip the minute waits only in the test's check process. All 30 rounds still run.
cat > "$tmp/sitecustomize.py" <<'PY'
import sys, time
if sys.argv[1:2] == ["check"]:
    sleep = time.sleep
    time.sleep = lambda seconds: sleep(seconds) if seconds < 1 else None
PY
cat > "$tmp/bin/npx" <<'SH'
#!/usr/bin/env bash
set -eu
case "$1 $2 $3" in
  "wrangler deployments list") echo '[{"versions":[{"version_id":"old","percentage":100}]}]' ;;
  "wrangler versions upload") echo '{"type":"version-upload","version_id":"new"}' > "$WRANGLER_OUTPUT_FILE_PATH" ;;
  "wrangler versions deploy")
    [[ $4 != new@10% || $5 == old@90% ]]
    echo "$4" >> "$STATE/deploys" ;;
  *) exit 2 ;;
esac
SH
cat > "$tmp/bin/curl" <<'SH'
#!/usr/bin/env bash
set -eu
version= format= method=GET
while (( $# )); do
  case "$1" in
    -H) case "$2" in
          'Cloudflare-Workers-Version-Overrides: kodigital-homepages-cms-worker="new"') version=new ;;
          'Cloudflare-Workers-Version-Overrides: kodigital-homepages-cms-worker="old"') version=old ;;
          'Cloudflare-Workers-Version-Overrides:'*) exit 2 ;;
        esac; shift ;;
    -X) method=$2; shift ;;
    -w) format=$2; shift ;;
    --) url=$2; break ;;
  esac
  shift
done
host=${url#https://}; host=${host%%/*}
if [[ -z $version && $url != */__edge/tick ]]; then
  [[ -z $format ]] || exit 2
  if [[ $url == */sitemap.xml ]]; then echo "<urlset><url><loc>https://$host/</loc></url></urlset>"; fi
  exit 0
fi
served=$version status=200 cache=HIT
if [[ $url == */__edge/tick ]]; then
  [[ $method == POST && $version != old ]]
  deployment=$(tail -n1 "$STATE/deploys")
  ticks="$STATE/$host.$deployment.${version:-unpinned}"
  n=0
  if [[ -f $ticks ]]; then read -r n < "$ticks"; fi
  echo "$((++n))" > "$ticks"
  status=202 served=new
  if [[ $deployment == new@10% ]]; then
    [[ $version == new ]]
    if (( n <= 3 )); then status=404 served=old
    elif [[ $host == b.example && ( $SCENARIO == never || $n == 6 ) ]]; then served=old
    elif [[ $host == a.example ]]; then
      case "$SCENARIO:$n" in
        delayed:7|delayed:8|delayed:9|delayed:10) status=404 served=old ;;
        broken-tick:7) status=503 ;;
        headerless-check-tick:7|headerless-propagate-tick:4) status=503 served= cache= ;;
      esac
    fi
  elif [[ $deployment == new@100% && -z $version ]]; then
    # A pin already reaches new on the split. Ordinary traffic can still reach old.
    if (( n <= 3 )) || [[ $host == b.example && ( $SCENARIO == never-promoted || $n == 6 ) ]]; then served=old; fi
  fi
else
  if [[ $version == old && $host == a.example ]]; then served=; fi  # Legacy baseline.
  if [[ $host == a.example && $SCENARIO == "wrong-$version" ]]; then
    if [[ $version == new ]]; then served=old; else served=new; fi
    echo "$served" >> "$STATE/wrong"
  fi
  if [[ $host == a.example && $version == new && $SCENARIO == headerless-page ]]; then
    # Each minute starts with a tick. Only its first new-pinned page request fails.
    pages="$STATE/pages.$(<"$STATE/$host.new@10%.new")"
    if [[ ! -e $pages ]]; then status=503 served= cache=; fi
    echo "$status" >> "$pages"
  fi
  printf '<title>same page</title>'
fi
format=${format//'%{http_code}'/$status}
format=${format//'%header{x-worker-version}'/$served}
printf '%s' "${format//'%header{x-edge-cache}'/$cache}"
SH
chmod +x "$tmp/bin/"{curl,npx}

run_case() {
  export SCENARIO=$1 STATE="$tmp/$1"
  mkdir "$STATE"
  bash "$perf/rollout.sh" production gradual > "$STATE/log" 2>&1
}
rolled_back() {
  local before_rollback=${1:-new@10%}
  [[ $(cat "$STATE/deploys") == "$before_rollback"$'\nold@100%' ]] && grep -q '^STAGE rollback ok ' "$STATE/log"
}

run_case delayed
[[ $(cat "$STATE/deploys") == $'new@10%\nnew@100%' ]]
grep -q '^Minute 30: new-version 5xx=0, parity mismatches=0$' "$STATE/log"
grep -q '^STAGE warm ok ' "$STATE/log"
for host in a.example b.example; do
  ready=6 checks=34  # Four stale replies to the first check tick recover on the fifth try.
  if [[ $host == b.example ]]; then ready=9 checks=30; fi  # A stale 202 resets the propagation streak.
  [[ $(grep -Ec "^PROPAGATED $host [0-9]+$" "$STATE/log") == 2 ]]
  [[ $(<"$STATE/$host.new@10%.new") == $((ready + checks)) && $(<"$STATE/$host.new@100%.unpinned") == "$ready" ]]
  [[ ! -e $STATE/$host.new@100%.new ]]
done
echo 'PASS delayed propagation gated both tenants on pinned split ticks and unpinned promotion ticks and completed 30 checks'

if ROLLOUT_PROPAGATION_TIMEOUT_SECONDS=1 run_case never; then exit 1; fi
grep -q '^b.example: propagation timed out after 1s ' "$STATE/log"
grep -Eq '^STAGE propagate fail [012]$' "$STATE/log"
rolled_back
echo 'PASS a tenant serving stale ticks timed out on the 1s budget and rolled back'

if ROLLOUT_PROPAGATION_TIMEOUT_SECONDS=1 run_case never-promoted; then exit 1; fi
grep -q '^STAGE promote ok ' "$STATE/log"
grep -q '^b.example: propagation timed out after 1s ' "$STATE/log"
grep -q '^STAGE propagate fail ' "$STATE/log"
[[ $(<"$STATE/b.example.new@100%.unpinned") -ge 3 ]]
rolled_back $'new@10%\nnew@100%'
echo 'PASS a tenant still serving the old version on unpinned ticks after promotion timed out and rolled back'

for pin in new old; do
  if run_case "wrong-$pin"; then exit 1; fi
  [[ $(wc -l < "$STATE/wrong") -eq 5 ]]
  grep -q "expected Worker $pin after 5 tries, .* (HTTP 200)" "$STATE/log"
  grep -q '^STAGE check fail ' "$STATE/log"
  rolled_back
  echo "PASS five wrong-version HTTP 200 page samples for the $pin pin triggered rollback"
done

if run_case broken-tick; then exit 1; fi
grep -q '^a.example: new-version tick returned 503, expected 202$' "$STATE/log"
[[ $(<"$STATE/a.example.new@10%.new") == 7 ]]
rolled_back
echo 'PASS a verified HTTP 503 tick triggered immediate rollback'

for stage in check propagate; do
  if run_case "headerless-$stage-tick"; then exit 1; fi
  ticks=7
  if [[ $stage == propagate ]]; then ticks=4; fi
  grep -q "^STAGE $stage fail " "$STATE/log"
  grep -q '^a.example: new-version tick returned 503, expected 202$' "$STATE/log"
  [[ $(<"$STATE/a.example.new@10%.new") == "$ticks" ]]
  rolled_back
  echo "PASS a new-pinned $stage tick with HTTP 503 and no version header triggered immediate rollback"
done

if run_case headerless-page; then exit 1; fi
[[ $(cat "$STATE"/pages.*) == $'503\n200\n503\n200' ]]
for minute in 1 2; do
  grep -qx "Minute $minute: new-version 5xx=1, parity mismatches=1" "$STATE/log"
done
grep -qx 'Two consecutive checks with new-version 5xx responses' "$STATE/log"
rolled_back
echo 'PASS two minutes with a headerless HTTP 503 followed by HTTP 200 counted one new-version 5xx each and rolled back'
