#!/usr/bin/env bash
# Compare process RAM and GPU while Liquid Glass is on vs off (macOS).
# Usage:
#   1. Open AIR Office desktop on Home with rails visible.
#   2. Leave Liquid Glass & Transparency ON, scroll a little, then:
#        bash tools/measure-glass-cost.sh glass-on
#   3. Turn the switch OFF (or use Intel-Mac default), wait ~2s, scroll the same way:
#        bash tools/measure-glass-cost.sh glass-off
# Compare the two JSON summaries under _temp/.
#
# GPU mirrors the Windows script: device utilization while scrolling, plus GART
# used bytes and a one-shot Electron Helper IOAccelerator footprint. No sudo.

set -euo pipefail
LABEL="${1:?label required, e.g. glass-on or glass-off}"
SECONDS_SAMPLE="${2:-5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/_temp"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/glass-cost-${LABEL}.json"

main_pids() {
  pgrep -f 'AIR Office.app/Contents/MacOS/AIR Office|Electron.app/Contents/MacOS/Electron( |$)' 2>/dev/null || true
}

helper_pids() {
  pgrep -f 'Electron Helper|AIR Office Helper' 2>/dev/null || true
}

sum_rss_kb() {
  local total=0 rss pid
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || true)
    [[ -n "$rss" ]] || continue
    total=$((total + rss))
  done < <(main_pids; helper_pids)
  echo "$total"
}

# Prints: utilPct  gartUsedBytes
sample_gpu_ioreg() {
  ioreg -r -d 1 -c IOAccelerator 2>/dev/null \
    | rg -o '"(Device Utilization %|gartUsedBytes)"=[0-9.]+' \
    | python3 -c '
import sys
util = 0.0
gart = 0.0
for line in sys.stdin:
    if "Device Utilization %" in line:
        util = max(util, float(line.split("=", 1)[1]))
    elif "gartUsedBytes" in line:
        gart = max(gart, float(line.split("=", 1)[1]))
print("%s\t%s" % (util, gart))
'
}

sample_gpu_footprint_mb() {
  local total_kb=0 pid line
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    while IFS= read -r line; do
      total_kb=$((total_kb + $(python3 -c '
import re,sys
m=re.match(r"\s*([0-9]+)\s*(KB|MB|GB)\b", sys.argv[1] or "")
if not m: print(0); raise SystemExit
n=int(m.group(1)); u=m.group(2)
print(n if u=="KB" else n*1024 if u=="MB" else n*1024*1024)
' "$line")))
    done < <(footprint -p "$pid" 2>/dev/null | rg 'IOAccelerator' || true)
  done < <(helper_pids)
  python3 -c "print(round($total_kb/1024, 1))"
}

rss_samples=()
util_samples=()
gart_samples=()
end=$((SECONDS + SECONDS_SAMPLE))
while (( SECONDS < end )); do
  rss_samples+=("$(sum_rss_kb)")
  IFS=$'\t' read -r util gart < <(sample_gpu_ioreg) || true
  util_samples+=("${util:-0}")
  gart_samples+=("${gart:-0}")
  sleep 0.4
done
ioaccel_mb="$(sample_gpu_footprint_mb)"

python3 - "$OUT_FILE" "$LABEL" "$SECONDS_SAMPLE" "$ioaccel_mb" \
  --rss "${rss_samples[@]}" \
  --util "${util_samples[@]}" \
  --gart "${gart_samples[@]}" <<'PY'
import json, sys, statistics
from datetime import datetime

args = sys.argv[1:]
out, label, seconds, ioaccel = args[0], args[1], int(args[2]), float(args[3])
buckets = {"rss": [], "util": [], "gart": []}
mode = None
for token in args[4:]:
    if token.startswith("--"):
        mode = token[2:]
        continue
    buckets[mode].append(float(token))

def mb_from_kb(vals):
    return [round(v / 1024, 1) for v in vals]

def mb_from_bytes(vals):
    return [round(v / (1024 * 1024), 1) for v in vals]

def summarize(vals, transform=None, places=1):
    if not vals:
        return {"avg": None, "max": None, "min": None, "samples": []}
    series = transform(vals) if transform else [round(v, places) for v in vals]
    return {
        "avg": round(statistics.mean(series), places),
        "max": round(max(series), places),
        "min": round(min(series), places),
        "samples": series,
    }

rss = summarize(buckets["rss"], mb_from_kb)
payload = {
    "label": label,
    "capturedAt": datetime.now().isoformat(timespec="seconds"),
    "seconds": seconds,
    "airOffice": {
        "workingSetMB_avg": rss["avg"],
        "workingSetMB_max": rss["max"],
        "workingSetMB_min": rss["min"],
        "samples": rss["samples"],
        "gpuHelperIOAcceleratorMB": ioaccel,
    },
    "gpu": {
        "deviceUtilPct": summarize(buckets["util"], places=2),
        "gartUsedMB": summarize(buckets["gart"], mb_from_bytes),
    },
    "note": "macOS: Electron+Helper RSS; Iris Device Utilization % + GART (ioreg); one-shot Helper IOAccelerator footprint. Scroll during the sample — same role as Windows GPU Engine util.",
}
open(out, "w", encoding="utf-8").write(json.dumps(payload, indent=2) + "\n")
print(out)
print(json.dumps(payload, indent=2))
PY
