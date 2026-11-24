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
        esac; shift ;;
    -X) method=$2; shift ;;
    -w) format=$2; shift ;;
    --) url=$2; break ;;
  esac
  shift
done
host=${url#https://}; host=${host%%/*}
if [[ -z $version ]]; then
  [[ -z $format ]] || exit 2
  if [[ $url == */sitemap.xml ]]; then echo "<urlset><url><loc>https://$host/</loc></url></urlset>"; fi
  exit 0
fi
served=$version status=200
if [[ $url == */__edge/tick ]]; then
  [[ $method == POST && $version == new ]]
  ticks="$STATE/$host.$(tail -n1 "$STATE/deploys")"
  n=0
  if [[ -f $ticks ]]; then read -r n < "$ticks"; fi
  echo "$((++n))" > "$ticks"
  status=202
  if (( n <= 3 )); then status=404 served=old
  elif [[ $host == b.example && ( $SCENARIO == never || $n == 6 ) ]]; then served=old
  elif [[ $host == a.example && $SCENARIO == delayed && $n -ge 7 && $n -le 10 ]]; then status=404 served=old
  elif [[ $host == a.example && $SCENARIO == broken-tick && $n == 7 ]]; then status=503
  fi
else
  if [[ $version == old && $host == a.example ]]; then served=; fi  # Legacy baseline.
  if [[ $host == a.example && $SCENARIO == "wrong-$version" ]]; then
    if [[ $version == new ]]; then served=old; else served=new; fi
    echo "$served" >> "$STATE/wrong"
  fi
  printf '<title>same page</title>'
fi
format=${format//'%{http_code}'/$status}
format=${format//'%header{x-worker-version}'/$served}
printf '%s' "${format//'%header{x-edge-cache}'/HIT}"
SH
chmod +x "$tmp/bin/"{curl,npx}

run_case() {
  export SCENARIO=$1 STATE="$tmp/$1"
  mkdir "$STATE"
  bash "$perf/rollout.sh" production gradual > "$STATE/log" 2>&1
}
rolled_back() {
  [[ $(cat "$STATE/deploys") == $'new@10%\nold@100%' ]] && grep -q '^STAGE rollback ok ' "$STATE/log"
}

run_case delayed
[[ $(cat "$STATE/deploys") == $'new@10%\nnew@100%' ]]
grep -q '^Minute 30: new-version 5xx=0, parity mismatches=0$' "$STATE/log"
grep -q '^STAGE warm ok ' "$STATE/log"
for host in a.example b.example; do
  ready=6 checks=34  # Four stale replies to the first check tick recover on the fifth try.
  if [[ $host == b.example ]]; then ready=9 checks=30; fi  # A stale 202 resets the propagation streak.
  [[ $(grep -Ec "^PROPAGATED $host [0-9]+$" "$STATE/log") == 2 ]]
  [[ $(<"$STATE/$host.new@10%") == $((ready + checks)) && $(<"$STATE/$host.new@100%") == "$ready" ]]
done
echo 'PASS delayed propagation gated both tenants after split and promotion and completed 30 checks'

if ROLLOUT_PROPAGATION_TIMEOUT_SECONDS=1 run_case never; then exit 1; fi
grep -q '^b.example: propagation timed out after 1s ' "$STATE/log"
grep -Eq '^STAGE propagate fail [012]$' "$STATE/log"
rolled_back
echo 'PASS a tenant serving stale ticks timed out on the 1s budget and rolled back'

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
[[ $(<"$STATE/a.example.new@10%") == 7 ]]
rolled_back
echo 'PASS a verified HTTP 503 tick triggered immediate rollback'
