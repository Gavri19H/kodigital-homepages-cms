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
if [[ $mode == rehearsal ]]; then minutes=3; fi
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

def endpoint(url, tenant):
    parts = urlsplit(url)
    if not tenant or parts.hostname != tenant or parts.scheme not in ("http", "https") or any(c.isspace() for c in url):
        raise ValueError(f"Invalid URL for tenant {tenant}: {url!r}")
    return parts._replace(scheme="https", netloc=stage_host).geturl() if stage_host else url

def pinned_headers(tenant, version):
    headers = ["-H", f'Cloudflare-Workers-Version-Overrides: {worker}="{version}"']
    if stage_host:
        headers.extend(["-H", f"x-perfstage-host: {tenant}"])
    return headers

def tick_hosts(groups):
    for tenant in groups:
        tick_url = endpoint(f"https://{tenant}/__edge/tick", tenant)
        status = subprocess.check_output(["curl", "-qsS", "--max-time", "10", "-X", "POST",
                                          *pinned_headers(tenant, new), "-o", os.devnull,
                                          "-w", "%{http_code}", "--", tick_url], text=True)
        if status != "202":
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
    output = subprocess.check_output(["curl", "-qsS", "--compressed", "--max-time", "30", "--globoff",
                                      "-A", browser, "-b", f"ko_sid={sid}", *pinned_headers(tenant, version),
                                      "-w", "\n%{http_code}\t%header{x-edge-cache}", "--", url])
    body, fields = output.rsplit(b"\n", 1)
    status, cache = fields.decode("ascii").split("\t", 1)
    if not re.fullmatch("[1-5][0-9]{2}", status):
        raise ValueError(f"{tenant}: {url} returned invalid status {status!r}")
    parser = PageTitle()
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    return (int(status), parser.title), cache.strip().upper()

def check_url(tenant, url, sid):
    old, _ = sample(tenant, url, previous, sid)
    first, _ = sample(tenant, url, new, sid)
    second, cache = sample(tenant, url, new, sid)
    matches = old == first == second
    if not matches:
        print(f"{tenant} {url}: status/title mismatch: old={old!r}, new={first!r}, repeat={second!r}", file=sys.stderr)
    if cache != "HIT":
        print(f"{tenant} {url}: second request returned x-edge-cache={cache!r}", file=sys.stderr)
    return (first[0] >= 500) + (second[0] >= 500), matches, cache == "HIT"

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
            all_hit = True
            for key, check in checks.items():
                server_errors, matches, hit = check.result()
                errors += server_errors
                all_hit &= hit
                mismatches[key] = 0 if matches else mismatches[key] + 1
            print(f"Minute {minute}: new-version 5xx={errors}, parity mismatches={sum(n > 0 for n in mismatches.values())}", flush=True)
            error_minutes = error_minutes + 1 if errors else 0
            miss_minutes = 0 if all_hit else miss_minutes + 1
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

if action == "check":
    check_split(groups)
elif action == "tick":
    tick_hosts(groups)
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
next_stage check
probe_tenants check

next_stage promote
deploy_versions "$new@100%"
probe_tenants tick
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
