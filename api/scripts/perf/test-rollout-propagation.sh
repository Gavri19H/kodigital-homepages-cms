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

# Keep real time while the first slow fill is pending. Skip long waits in the other checks.
cat > "$tmp/sitecustomize.py" <<'PY'
import os, sys, time
if sys.argv[1:2] == ["check"]:
    sleep = time.sleep
    def check_sleep(seconds):
        if seconds < 1 or os.path.exists(os.path.join(os.environ["STATE"], "filling")):
            sleep(seconds)
    time.sleep = check_sleep
PY
cat > "$tmp/bin/npx" <<'SH'
#!/usr/bin/env bash
set -eu
case "$1 $2 $3" in
  "wrangler deployments list") echo '[{"versions":[{"version_id":"old","percentage":100}]}]' ;;
  "wrangler versions upload") echo '{"type":"version-upload","version_id":"new"}' > "$WRANGLER_OUTPUT_FILE_PATH" ;;
  "wrangler versions deploy")
    [[ $4 != new@10% || $5 == old@90% ]] || exit 1
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
served=$version status=200 cache=HIT colo=IAD
if [[ $url == */__edge/tick ]]; then
  [[ $method == POST && $version != old ]] || exit 1
  deployment=$(tail -n1 "$STATE/deploys")
  ticks="$STATE/$host.$deployment.${version:-unpinned}"
  n=0
  if [[ -f $ticks ]]; then read -r n < "$ticks"; fi
  echo "$((++n))" > "$ticks"
  status=202 served=new
  if [[ $deployment == new@10% ]]; then
    [[ $version == new ]] || exit 1
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
  if [[ $SCENARIO == delayed && $host == a.example && $version == new && ! -e $STATE/fill-sampled ]]; then
    if [[ -e $STATE/filling ]]; then
      cache=$(python3 -c 'import sys, time
with open(sys.argv[1]) as started:
    print("HIT" if time.time_ns() - int(started.read()) >= 1_500_000_000 else "MISS")' "$STATE/filling")
      mv "$STATE/filling" "$STATE/fill-sampled"
    else
      python3 -c 'import time; print(time.time_ns())' > "$STATE/filling"
      cache=MISS
    fi
    echo "$cache" >> "$STATE/slow-fill-pair"
  fi
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
  if [[ $version == new && $SCENARIO == colo-* ]]; then
    # Each host has one page. Its check tick identifies this minute's samples.
    pages="$STATE/$host.pages.$(<"$STATE/$host.new@10%.new")"
    n=0
    if [[ -f $pages ]]; then read -r n < "$pages"; fi
    echo "$((++n))" > "$pages"
    case "$SCENARIO/$host" in
      colo-retry/a.example)
        colos=(IAD EWR YYZ DFW DFW)
        if (( n < 5 )); then cache=MISS; fi ;;
      colo-retry/b.example|colo-unstable/*) colos=(IAD EWR IAD EWR IAD) ;;
      colo-miss/*)
        colos=(IAD IAD)
        if [[ $host == a.example ]]; then cache=MISS; fi ;;
    esac
    colo=${colos[n-1]}
  fi
  printf '<title>same page</title>'
fi
format=${format//'%{http_code}'/$status}
format=${format//'%header{x-worker-version}'/$served}
format=${format//'%header{x-edge-cache}'/$cache}
printf -v ray '%016x-%s' "$$" "$colo"
printf '%s' "${format//'%header{cf-ray}'/$ray}"
SH
chmod +x "$tmp/bin/"{curl,npx}

run_case() {
  export SCENARIO=$1 STATE="$tmp/$1"
  mkdir "$STATE"
  bash "$perf/rollout.sh" production gradual > "$STATE/log" 2>&1
}
rolled_back() {
  local before_rollback=${1:-new@10%}
  [[ $(cat "$STATE/deploys") == "$before_rollback"$'\nold@100%' ]] || exit 1
  grep -q '^STAGE rollback ok ' "$STATE/log" || exit 1
}

run_case delayed || exit 1
[[ $(cat "$STATE/deploys") == $'new@10%\nnew@100%' ]] || exit 1
grep -q '^Minute 30: new-version 5xx=0, parity mismatches=0$' "$STATE/log" || exit 1
grep -q '^STAGE warm ok ' "$STATE/log" || exit 1
for host in a.example b.example; do
  ready=6 checks=34  # Four stale replies to the first check tick recover on the fifth try.
  if [[ $host == b.example ]]; then ready=9 checks=30; fi  # A stale 202 resets the propagation streak.
  [[ $(grep -Ec "^PROPAGATED $host [0-9]+$" "$STATE/log") == 2 ]] || exit 1
  [[ $(<"$STATE/$host.new@10%.new") == $((ready + checks)) && $(<"$STATE/$host.new@100%.unpinned") == "$ready" ]] || exit 1
  [[ ! -e $STATE/$host.new@100%.new ]] || exit 1
done
echo 'PASS delayed propagation gated both tenants on pinned split ticks and unpinned promotion ticks and completed 30 checks'
[[ $(<"$STATE/slow-fill-pair") == $'MISS\nHIT' ]] || exit 1
echo 'PASS a slow-filling same-colo MISS was followed by a HIT at least 1.5s later'

! ROLLOUT_PROPAGATION_TIMEOUT_SECONDS=1 run_case never || exit 1
grep -q '^b.example: propagation timed out after 1s ' "$STATE/log" || exit 1
grep -Eq '^STAGE propagate fail [012]$' "$STATE/log" || exit 1
rolled_back || exit 1
echo 'PASS a tenant serving stale ticks timed out on the 1s budget and rolled back'

! ROLLOUT_PROPAGATION_TIMEOUT_SECONDS=1 run_case never-promoted || exit 1
grep -q '^STAGE promote ok ' "$STATE/log" || exit 1
grep -q '^b.example: propagation timed out after 1s ' "$STATE/log" || exit 1
grep -q '^STAGE propagate fail ' "$STATE/log" || exit 1
[[ $(<"$STATE/b.example.new@100%.unpinned") -ge 3 ]] || exit 1
rolled_back $'new@10%\nnew@100%' || exit 1
echo 'PASS a tenant still serving the old version on unpinned ticks after promotion timed out and rolled back'

for pin in new old; do
  ! run_case "wrong-$pin" || exit 1
  [[ $(wc -l < "$STATE/wrong") -eq 5 ]] || exit 1
  grep -q "expected Worker $pin after 5 tries, .* (HTTP 200)" "$STATE/log" || exit 1
  grep -q '^STAGE check fail ' "$STATE/log" || exit 1
  rolled_back || exit 1
  echo "PASS five wrong-version HTTP 200 page samples for the $pin pin triggered rollback"
done

! run_case broken-tick || exit 1
grep -q '^a.example: new-version tick returned 503, expected 202$' "$STATE/log" || exit 1
[[ $(<"$STATE/a.example.new@10%.new") == 7 ]] || exit 1
rolled_back || exit 1
echo 'PASS a verified HTTP 503 tick triggered immediate rollback'

for stage in check propagate; do
  ! run_case "headerless-$stage-tick" || exit 1
  ticks=7
  if [[ $stage == propagate ]]; then ticks=4; fi
  grep -q "^STAGE $stage fail " "$STATE/log" || exit 1
  grep -q '^a.example: new-version tick returned 503, expected 202$' "$STATE/log" || exit 1
  [[ $(<"$STATE/a.example.new@10%.new") == "$ticks" ]] || exit 1
  rolled_back || exit 1
  echo "PASS a new-pinned $stage tick with HTTP 503 and no version header triggered immediate rollback"
done

! run_case headerless-page || exit 1
[[ $(cat "$STATE"/pages.*) == $'503\n200\n503\n200' ]] || exit 1
for minute in 1 2; do
  grep -qx "Minute $minute: new-version 5xx=1, parity mismatches=1" "$STATE/log" || exit 1
done
grep -qx 'Two consecutive checks with new-version 5xx responses' "$STATE/log" || exit 1
rolled_back || exit 1
echo 'PASS two minutes with a headerless HTTP 503 followed by HTTP 200 counted one new-version 5xx each and rolled back'

run_case colo-retry || exit 1
[[ $(cat "$STATE/deploys") == $'new@10%\nnew@100%' ]] || exit 1
grep -Fxq 'Minute 30: new-version 5xx=0, parity mismatches=0' "$STATE/log" || exit 1
[[ $(sort -u "$STATE"/a.example.pages.*) == 5 ]] || exit 1
[[ $(grep -Fxc 'b.example https://b.example/: no same-colo pair (colos IAD,EWR,IAD,EWR,IAD)' "$STATE/log") == 30 ]] || exit 1
! grep -Fq 'second request returned x-edge-cache=' "$STATE/log" || exit 1
echo 'PASS cross-colo misses followed by a same-colo HIT promoted after 30 checks with one unstable URL'

! run_case colo-miss || exit 1
[[ $(grep -Fxc "a.example https://a.example/: second request returned x-edge-cache='MISS' (colo IAD→IAD)" "$STATE/log") == 3 ]] || exit 1
grep -Fxq 'Minute 3: new-version 5xx=0, parity mismatches=0' "$STATE/log" || exit 1
grep -Fxq 'Three consecutive checks with a second-pass cache miss' "$STATE/log" || exit 1
rolled_back || exit 1
echo 'PASS three consecutive same-colo second-request misses rolled back'

! run_case colo-unstable || exit 1
for host in a.example b.example; do
  [[ $(grep -Fxc "$host https://$host/: no same-colo pair (colos IAD,EWR,IAD,EWR,IAD)" "$STATE/log") == 3 ]] || exit 1
done
grep -Fxq 'Minute 3: new-version 5xx=0, parity mismatches=0' "$STATE/log" || exit 1
grep -Fxq 'Three consecutive checks with a second-pass cache miss' "$STATE/log" || exit 1
rolled_back || exit 1
echo 'PASS three consecutive checks with every URL colo-unstable exhausted five samples per URL and rolled back'
