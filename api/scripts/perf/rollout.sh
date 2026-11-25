#!/usr/bin/env bash
set -euo pipefail

target=${1:-} mode=${2:-} previous= tmp= probe_pid=
stage=prepare started=$SECONDS stage_result=ok
fail() { echo "$*" >&2; exit 1; }
report() { printf 'STAGE %s %s %d\n' "$stage" "$1" "$((SECONDS - started))"; }
next_stage() { report "$stage_result"; stage=$1; started=$SECONDS; stage_result=ok; }
deploy_versions() { npx wrangler versions deploy "$@" -y --env "$target"; }

rollback() {
  trap '' HUP INT TERM
  local rc=1 elapsed attempt
  for attempt in 1 2 3; do
    if deploy_versions "$previous@100%"; then rc=0; break; fi
    echo "Rollback attempt $attempt of 3 failed" >&2
  done
  if (( rc )); then echo "ROLLBACK_FAILED: could not restore $previous at 100% in $target" >&2; fi
  elapsed=$((SECONDS - started))
  printf 'ROLLBACK_SECONDS=%d\n' "$elapsed"
  if (( elapsed >= 60 )); then
    echo "Rollback missed the under-one-minute target" >&2
    return 1
  fi
  return "$rc"
}

finish() {
  local rc=$?
  trap '' HUP INT TERM
  trap - EXIT
  if [[ -n $probe_pid ]]; then kill -TERM "$probe_pid" 2>/dev/null || true; fi
  if (( rc )); then
    report fail
    echo "Release failed during $stage (exit $rc)" >&2
    if [[ -n $previous && $stage != rollback ]]; then
      stage=rollback started=$SECONDS
      if rollback; then report ok; else report fail; fi
    fi
    rc=1
  else
    report "$stage_result"
  fi
  if [[ -n $tmp ]]; then rm -rf -- "$tmp"; fi
  exit "$rc"
}
trap finish EXIT
trap 'fail "Release interrupted"' HUP INT TERM

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
[[ $# == 2 ]] || fail "Usage: rollout.sh <production|perfstage> <gradual|rehearsal>"
worker=kodigital-homepages-cms-worker
minutes=30
case "$target/$mode" in
  production/gradual) ;;
  perfstage/gradual|perfstage/rehearsal) worker+=-perfstage ;;
  *) fail "Invalid release $target/$mode (rehearsal requires perfstage)" ;;
esac
if [[ $mode == rehearsal ]]; then minutes=12; fi
[[ -r scripts/perf/edge-probe.sh && -s scripts/perf/urls.txt ]] || fail "Missing probe or URL list"
stage_host=
if [[ $target == perfstage ]]; then
  stage_host=$(python3 -c 'import tomllib
with open("wrangler.toml", "rb") as config:
    print(tomllib.load(config)["env"]["perfstage"]["vars"]["ADMIN_HOST"])')
  [[ $stage_host =~ ^$worker\.[a-z0-9-]+\.workers\.dev$ ]] || fail "Unexpected perfstage workers.dev host: $stage_host"
fi

# Keep tenant identity when several public URLs map to the same workers.dev path.
probe_tenants() {
  # A signal interrupts Bash's wait builtin immediately, including while the
  # monitor is sleeping between checks. The EXIT trap can then start rollback.
  local rc=0
  python3 - "$1" "$stage_host" "$worker" "$tmp" "$previous" "$new" "$minutes" <<'PY' &
import os
import re
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, wait
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

action, stage_host, worker, tmp, previous, new, minutes = sys.argv[1:]
batch = Path(tmp, "urls")
probe = ["bash", "scripts/perf/edge-probe.sh", str(batch), "1"]
browser = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
poll_seconds = float(os.environ.get("ROLLOUT_POLL_SECONDS", 2))
propagation_timeout = float(os.environ.get("ROLLOUT_PROPAGATION_TIMEOUT_SECONDS", 120))
tick_args = ["--max-time", "10", "-X", "POST", "-o", os.devnull]

def endpoint(url, tenant):
    parts = urlsplit(url)
    if not tenant or parts.hostname != tenant or parts.scheme not in ("http", "https") or any(c.isspace() for c in url):
        raise ValueError(f"Invalid URL for tenant {tenant}: {url!r}")
    return parts._replace(scheme="https", netloc=stage_host).geturl() if stage_host else url

def request_headers(tenant, pin):
    headers = []
    if pin is not None:
        headers.extend(["-H", f'Cloudflare-Workers-Version-Overrides: {worker}="{pin}"'])
    if stage_host:
        headers.extend(["-H", f"x-perfstage-host: {tenant}"])
    return headers

def worker_request(tenant, url, pin, args, timeout=None):
    output = subprocess.check_output(["curl", "-qsS", *args, *request_headers(tenant, pin),
                                      "-w", "\n%{http_code}\t%header{x-worker-version}\t%header{x-edge-cache}\t%header{cf-ray}",
                                      "--", url], timeout=timeout)
    body, fields = output.rsplit(b"\n", 1)
    status, served, cache, ray = fields.decode("ascii").split("\t")
    if not re.fullmatch("[1-5][0-9]{2}", status):
        raise ValueError(f"{tenant}: {url} returned invalid status {status!r}")
    colo = ray.strip().rsplit("-", 1)[-1] if "-" in ray else ""
    return int(status), served.strip(), cache.strip().upper(), colo, body

def checked_request(tenant, url, version, args):
    for attempt in range(1, 6):
        status, served, cache, colo, body = worker_request(tenant, url, version, args)
        # The previous Worker can predate the header. Cloudflare can also return a 5xx
        # before the new Worker sends headers, so let that status reach the check.
        if served == version or (not served and (version == previous or status >= 500)):
            return status, cache, colo, body
        if attempt < 5:
            time.sleep(poll_seconds)
    sys.exit(f"{tenant}: {url} expected Worker {version} after 5 tries, "
             f"got x-worker-version={served or '<missing>'} (HTTP {status})")

def propagate(groups, pin):
    started = time.monotonic()
    deadline = started + propagation_timeout

    def poll(tenant):
        url = endpoint(f"https://{tenant}/__edge/tick", tenant)
        streak = 0
        last = "no response"
        while (remaining := deadline - time.monotonic()) > 0:
            try:
                status, served, *_ = worker_request(tenant, url, pin, tick_args, timeout=remaining)
                last = f"HTTP {status}, x-worker-version={served or '<missing>'}"
                if status >= 500 and (served == new or (pin == new and not served)):
                    sys.exit(f"{tenant}: new-version tick returned {status}, expected 202")
                streak = streak + 1 if status == 202 and served == new else 0
            except subprocess.CalledProcessError as error:
                last = f"curl exited {error.returncode}"
                streak = 0
            except subprocess.TimeoutExpired:
                last = "tick timed out"
                break
            now = time.monotonic()
            if now > deadline:
                break
            if streak == 3:
                print(f"PROPAGATED {tenant} {int(now - started)}", flush=True)
                return
            time.sleep(min(poll_seconds, deadline - now))
        sys.exit(f"{tenant}: propagation timed out after {propagation_timeout:g}s waiting for "
                 f"3 consecutive 202 responses from {new} (last: {last})")

    with ThreadPoolExecutor(max_workers=len(groups)) as pool:
        list(pool.map(poll, groups))

def tick_hosts(groups):
    for tenant in groups:
        tick_url = endpoint(f"https://{tenant}/__edge/tick", tenant)
        status, *_ = checked_request(tenant, tick_url, new, tick_args)
        if status != 202:
            sys.exit(f"{tenant}: new-version tick returned {status}, expected 202")

class PageTitle(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title" and self.title is None:
            self.title = ""
            self.in_title = True

    def handle_data(self, data):
        if self.in_title:
            self.title += data

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

def sample(tenant, url, version, sid):
    status, cache, colo, body = checked_request(tenant, url, version, [
        "--compressed", "--max-time", "30", "--globoff", "-A", browser, "-b", f"ko_sid={sid}",
    ])
    parser = PageTitle()
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    return (status, parser.title), cache, colo

def check_url(tenant, url, sid):
    old, _, _ = sample(tenant, url, previous, sid)
    first, _, first_colo = sample(tenant, url, new, sid)
    colos = [first_colo]
    errors = int(first[0] >= 500)
    matches = True
    # Check the second request, then allow three more if the location keeps changing.
    for _ in range(4):
        # A hedged MISS can reach the visitor while the cache tiers are still filling.
        time.sleep(1.5)
        repeat, cache, colo = sample(tenant, url, new, sid)
        errors += repeat[0] >= 500
        if matches and (old != first or old != repeat):
            matches = False
            print(f"{tenant} {url}: status/title mismatch: old={old!r}, new={first!r}, repeat={repeat!r}", file=sys.stderr)
        if colo and colo == colos[-1]:
            hit = cache == "HIT"
            if not hit:
                print(f"{tenant} {url}: second request returned x-edge-cache={cache!r} "
                      f"(colo {colos[-1]}→{colo})", file=sys.stderr)
            return errors, matches, hit
        colos.append(colo)
    observed = ",".join(colo or "<missing>" for colo in colos)
    print(f"{tenant} {url}: no same-colo pair (colos {observed})", file=sys.stderr)
    return errors, matches, None

def check_split(groups):
    # Share one visitor identity across both versions for sticky experiments.
    sid = str(uuid.uuid4())
    mismatches = {(tenant, url): 0 for tenant, urls in groups.items() for url in urls}
    error_minutes = miss_minutes = 0
    next_tick = time.monotonic()
    with ThreadPoolExecutor(max_workers=8) as pool:
        for minute in range(1, int(minutes) + 1):
            tick_hosts(groups)
            next_tick += 60
            checks = {key: pool.submit(check_url, *key, sid) for key in mismatches}
            pending = checks.values()
            while pending:
                _, pending = wait(pending, timeout=max(0, next_tick - time.monotonic()))
                if pending:
                    tick_hosts(groups)
                    next_tick += 60
            errors = 0
            same_colo_hits = []
            for key, check in checks.items():
                server_errors, matches, hit = check.result()
                errors += server_errors
                if hit is not None:
                    same_colo_hits.append(hit)
                mismatches[key] = 0 if matches else mismatches[key] + 1
            print(f"Minute {minute}: new-version 5xx={errors}, parity mismatches={sum(n > 0 for n in mismatches.values())}", flush=True)
            error_minutes = error_minutes + 1 if errors else 0
            miss_minutes = 0 if same_colo_hits and all(same_colo_hits) else miss_minutes + 1
            if error_minutes >= 2:
                sys.exit("Two consecutive checks with new-version 5xx responses")
            for (tenant, url), streak in mismatches.items():
                if streak >= 3:
                    sys.exit(f"{tenant} {url}: three consecutive status/title mismatches")
            if miss_minutes >= 3:
                sys.exit("Three consecutive checks with a second-pass cache miss")
            # Keep the split for the whole last minute. The promotion tick is
            # then eligible even if the final probes all returned immediately.
            time.sleep(max(0, next_tick - time.monotonic()))

def warm(tenant, urls, header, env):
    sitemap = endpoint(f"https://{tenant}/sitemap.xml", tenant)
    urls[sitemap] = None
    errors = []
    try:
        headers = ["-H", header] if header else []
        xml = subprocess.check_output(["curl", "-qfsS", "--max-time", "60", *headers, "--", sitemap])
        locations = ET.fromstring(xml).findall("{*}url/{*}loc")
        if not locations:
            raise ValueError("sitemap contains no URLs")
        for loc in locations:
            try:
                urls[endpoint((loc.text or "").strip(), tenant)] = None
            except ValueError as error:
                errors.append(str(error))
    except (OSError, subprocess.CalledProcessError, ET.ParseError, LookupError, ValueError) as error:
        errors.append(str(error))
    batch.write_text("\n".join(urls) + "\n")
    if subprocess.run([*probe, "--warm"], env=env).returncode:
        errors.append("warm probe failed")
    for error in errors:
        print(f"{tenant}: best-effort warm-up: {error}", file=sys.stderr)
    return not errors

groups = {}
for line in Path("scripts/perf/urls.txt").read_text().splitlines():
    url = line.strip()
    if url and not url.startswith("#"):
        tenant = urlsplit(url).hostname
        groups.setdefault(tenant, {})[endpoint(url, tenant)] = None
if not groups:
    sys.exit("Empty probe URL list")

if action == "propagate":
    propagate(groups, new)
elif action == "propagate-unpinned":
    propagate(groups, None)
elif action == "check":
    check_split(groups)
elif action == "warm":
    warm_ok = True
    for tenant, urls in groups.items():
        header = f"x-perfstage-host: {tenant}" if stage_host else ""
        env = {**os.environ, "EDGE_PROBE_EXTRA_HEADER": header}
        if not warm(tenant, urls, header, env):
            warm_ok = False
    if not warm_ok:
        sys.exit(1)
PY
  probe_pid=$!
  wait "$probe_pid" || rc=$?
  probe_pid=
  return "$rc"
}

tmp=$(mktemp -d)
next_stage previous
npx wrangler deployments list --json --env "$target" > "$tmp/deployments.json"
previous=$(jq -er 'last.versions | map(select(.percentage > 0)) | select(length == 1 and .[0].percentage == 100)
  | .[0].version_id | strings | select(length > 0)' "$tmp/deployments.json") || fail "Expected one active version at 100% in $target"
printf 'PREVIOUS_VERSION=%s\n' "$previous"

next_stage upload
WRANGLER_OUTPUT_FILE_PATH="$tmp/upload.jsonl" npx wrangler versions upload --env "$target"
new=$(jq -ser 'map(select(.type == "version-upload")) | select(length == 1)
  | .[0].version_id | strings | select(length > 0)' "$tmp/upload.jsonl") || fail "Missing uploaded version ID"
[[ $new != "$previous" ]] || fail "Upload returned the active version ID"
printf 'NEW_VERSION=%s\n' "$new"

next_stage split
deploy_versions "$new@10%" "$previous@90%"
next_stage propagate
probe_tenants propagate
next_stage check
probe_tenants check

next_stage promote
deploy_versions "$new@100%"
next_stage propagate
probe_tenants propagate-unpinned
next_stage warm
probe_tenants warm || stage_result=fail
if [[ $mode == rehearsal ]]; then
  next_stage rollback
  echo "Forcing rehearsal rollback to $previous"
  rollback
  trap 'fail "Release interrupted"' HUP INT TERM
  next_stage redeploy
  deploy_versions "$new@100%"
fi
