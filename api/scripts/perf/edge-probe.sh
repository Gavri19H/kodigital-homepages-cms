#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

usage() {
  printf '%s\n' "Usage: edge-probe.sh <url-file> <runs> [--override '<worker>=\"<version-id>\"'] [--warm]" >&2
  exit 2
}

median_ttfb() {
  local seconds micros pos middle_sum count=$#
  local -a ordered=()
  # Curl reports seconds to the microsecond. Sort integer microseconds in Bash.
  for seconds in "$@"; do
    printf -v micros '%.0f' "${seconds}e6"
    pos=${#ordered[@]}
    while (( pos > 0 )) && (( ordered[pos - 1] > micros )); do
      ordered[pos]=${ordered[pos - 1]}
      pos=$((pos - 1))
    done
    ordered[pos]=$micros
  done
  middle_sum=$((ordered[(count - 1) / 2] + ordered[count / 2]))
  micros=$((middle_sum / 2))
  printf '%d.%06d' "$((micros / 1000000))" "$((micros % 1000000))"
  if (( middle_sum % 2 )); then printf '5'; fi
}

(( $# >= 2 )) || usage
url_file=$1
runs=$2
shift 2
warm=0
user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
curl_args=(-q -s -o /dev/null --show-error --max-time 30 --globoff --proto '=http,https'
           -A "$user_agent" -H 'Accept-Encoding: br')
while (( $# )); do
  case "$1" in
    --override)
      [[ -n ${2:-} ]] || usage
      curl_args+=(-H "Cloudflare-Workers-Version-Overrides: $2")
      shift 2 ;;
    --warm) warm=1; shift ;;
    *) usage ;;
  esac
done
if [[ -n ${EDGE_PROBE_EXTRA_HEADER:-} ]]; then
  extra_headers=$EDGE_PROBE_EXTRA_HEADER
  while [[ $extra_headers == *' || '* ]]; do
    curl_args+=(-H "${extra_headers%%' || '*}")
    extra_headers=${extra_headers#*' || '}
  done
  curl_args+=(-H "$extra_headers")
fi
if ! exec 3< "$url_file"; then
  if (( warm )); then exit 0; fi
  exit 1
fi
if (( ! warm )); then
  [[ $runs =~ ^[1-9][0-9]*$ ]] || usage
  printf 'url\trun\tstatus\tttfb_s\tx-edge-cache\tcf-cache-status\tage\tcolo\tbytes\tserver_timing\tconnect_s\ttls_s\n'
fi

shopt -s nocasematch
failed=0
summaries=()
while read -r -u 3 url || [[ -n $url ]]; do
  url=${url%$'\r'}
  [[ -n $url ]] || continue
  if (( warm )); then
    curl "${curl_args[@]}" -- "$url" || true
    continue
  fi

  samples=()
  hits=0
  for ((run = 1; run <= runs; run++)); do
    # Dump headers to stdout with the write-out fields on the last line.
    if ! response=$(curl "${curl_args[@]}" -D - -w $'\n%{time_starttransfer}\t%{http_code}\t%{size_download}\t%{time_connect}\t%{time_appconnect}' -- "$url"); then
      failed=1
    fi
    IFS=$'\t' read -r ttfb status bytes connect tls <<< "${response##*$'\n'}"
    status=${status:-000}
    headers=${response%$'\n'*}
    # A proxy CONNECT or interim 103 can precede the measured response.
    headers=${headers##*$'\nHTTP/'}
    edge_cache='' cf_cache='' age='' colo='' server_timing=''
    in_server_timing=0
    while IFS= read -r line; do
      if [[ $line =~ ^Server-Timing:[[:blank:]]*(.*)$ ]]; then
        server_timing+="${server_timing:+, }${BASH_REMATCH[1]%$'\r'}"
        in_server_timing=1
        continue
      fi
      if (( in_server_timing )) && [[ $line == [[:blank:]]* ]]; then
        server_timing+=" ${line%$'\r'}"
        continue
      fi
      in_server_timing=0
      [[ $line =~ ^([^:]+):[[:blank:]]*([^[:space:]]+) ]] || continue
      value=${BASH_REMATCH[2]}
      case "${BASH_REMATCH[1]}" in
        x-edge-cache) edge_cache=$value ;;
        cf-cache-status) cf_cache=$value ;;
        age) age=$value ;;
        cf-ray) if [[ $value == *-* ]]; then colo=${value##*-}; fi ;;
      esac
    done <<< "$headers"
    printf '%s\t%d\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$url" "$run" "$status" "${ttfb:-0.000000}" "$edge_cache" "$cf_cache" "$age" "$colo" "${bytes:-0}" \
      "${server_timing//$'\t'/ }" "${connect:-0.000000}" "${tls:-0.000000}"
    if (( 10#$status >= 500 )); then failed=1; fi
    if [[ ${edge_cache:-$cf_cache} == HIT ]]; then hits=$((hits + 1)); fi
    if (( run >= 2 )) && [[ $status != 000 ]]; then samples+=("$ttfb"); fi
  done
  median=n/a
  if (( ${#samples[@]} )); then median=$(median_ttfb "${samples[@]}"); fi
  printf -v summary '%s\t%s\t%d\t%d' "$url" "$median" "$hits" "$runs"
  summaries+=("$summary")
done

if (( warm )); then exit 0; fi
if (( ${#summaries[@]} == 0 )); then
  printf 'No URLs in %s\n' "$url_file" >&2
  exit 1
fi
# Keep stdout rectangular so it can be saved directly as the TSV artifact.
printf 'url\tmedian_ttfb_s(runs>=2)\thits\truns\n' >&2
printf '%s\n' "${summaries[@]}" >&2
exit "$failed"
