#!/usr/bin/env bash
set -euo pipefail

target=${1:-} mode=${2:-} previous= tmp=
stage=prepare started=$SECONDS stage_result=ok
fail() { echo "$*" >&2; exit 1; }
report() { printf 'STAGE %s %s %d\n' "$stage" "$1" "$((SECONDS - started))"; }
next_stage() { report "$stage_result"; stage=$1; started=$SECONDS; stage_result=ok; }
deploy_versions() { npx wrangler versions deploy "$@" -y --env "$target"; }

rollback() {
  local rc=0 elapsed
  deploy_versions "$previous@100%" || rc=1
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
  trap - EXIT
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
  python3 - "$1" "$stage_host" "$worker" "$tmp" "$previous" "$new" <<'PY'
import csv
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlsplit

action, stage_host, worker, tmp, previous, new = sys.argv[1:]
batch = Path(tmp, "urls")
probe = ["bash", "scripts/perf/edge-probe.sh", str(batch), "1"]

def endpoint(url, tenant):
    parts = urlsplit(url)
    if not tenant or parts.hostname != tenant or parts.scheme not in ("http", "https") or any(c.isspace() for c in url):
        raise ValueError(f"Invalid URL for tenant {tenant}: {url!r}")
    return parts._replace(scheme="https", netloc=stage_host).geturl() if stage_host else url

def samples(tenant, urls, env, version):
    result = subprocess.run([*probe, "--override", f'{worker}="{version}"'],
                            env=env, stdout=subprocess.PIPE, text=True)
    if result.returncode:
        print(result.stdout, file=sys.stderr)
        sys.exit(f"{tenant}: probe of {version} exited {result.returncode}")
    rows = {}
    for row in csv.reader(result.stdout.splitlines(), delimiter="\t"):
        if not row or row[:3] == ["url", "run", "status"]:
            continue
        if len(row) != 9 or row[1] != "1" or row[0] not in urls or row[0] in rows:
            sys.exit(f"{tenant}: unexpected probe row {row!r}")
        url, _, status, _, cache = row[:5]
        if not re.fullmatch("[1-4][0-9]{2}", status):
            sys.exit(f"{tenant}: {url} returned status {status}")
        rows[url] = (status, cache.upper())
    if rows.keys() != urls.keys():
        sys.exit(f"{tenant}: missing probe results for {sorted(urls.keys() - rows.keys())}")
    return rows

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
        group = tenant if stage_host or action == "warm" else "production"
        groups.setdefault(group, {})[endpoint(url, tenant)] = None
if not groups:
    sys.exit("Empty probe URL list")

all_hit = warm_ok = True
for tenant, urls in groups.items():
    header = f"x-perfstage-host: {tenant}" if stage_host else ""
    env = {**os.environ, "EDGE_PROBE_EXTRA_HEADER": header}
    if action == "warm":
        if not warm(tenant, urls, header, env):
            warm_ok = False
        continue
    batch.write_text("\n".join(urls) + "\n")
    old = samples(tenant, urls, env, previous)
    for attempt in (1, 2):
        candidate = samples(tenant, urls, env, new)
        for url, (status, cache) in candidate.items():
            if status != old[url][0]:
                sys.exit(f"{tenant}: status mismatch for {url}, previous={old[url][0]} new={status}")
            if attempt == 2 and cache != "HIT":
                print(f"{tenant}: second request for {url} returned x-edge-cache={cache!r}", file=sys.stderr)
                all_hit = False
if action == "check":
    print("HIT" if all_hit else "MISS")
elif not warm_ok:
    sys.exit(1)
PY
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
misses=0
# Anchor each check to the split so probe time does not accumulate between checks.
for (( minute=1; minute<=minutes; minute++ )); do
  delay=$((started + minute * 60 - SECONDS))
  if (( delay > 0 )); then sleep "$delay"; fi
  outcome=$(probe_tenants check)
  if [[ $outcome == HIT ]]; then misses=0; else misses=$((misses + 1)); fi
  (( misses < 3 )) || fail "Three consecutive checks with a second-pass cache miss"
done

next_stage promote
deploy_versions "$new@100%"
next_stage warm
probe_tenants warm || stage_result=fail
if [[ $mode == rehearsal ]]; then
  next_stage rollback
  echo "Forcing rehearsal rollback to $previous"
  rollback
  next_stage redeploy
  deploy_versions "$new@100%"
fi
