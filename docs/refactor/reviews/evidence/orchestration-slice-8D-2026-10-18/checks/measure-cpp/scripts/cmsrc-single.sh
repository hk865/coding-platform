#!/bin/bash
# cmake-src: light mode, ONE worker, no recycling (production runs one process per language): wall time and RSS growth.
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
SRC=$W/downloads/cmake-3.30.5/cmake-3.30.5
BLD=$W/build/cmake-3.30.5
R=$W/results/cmake-src
AVAIL=$(free -m | awk '/Mem:/{print $7}'); echo "available MB $AVAIL"
if [ "$AVAIL" -lt 2000 ]; then echo "STOP"; exit 3; fi
cd "$R"
rm -f "$R/light-A-single.ndjson"
/usr/bin/time -v systemd-run --user --scope -q --unit=cmsrc-single-$$ -p MemoryMax=4G \
  timeout 560 python3 -I $S/light_include_scan.py --db "$BLD/compile_commands.json" --root "$SRC" \
  --mode light --out "$R/light-A-single.ndjson" --file-list "$R/vfs-files-A.txt" --timeout 20 --jobs 1 --recycle 100000 2> "$R/light-A-single.time.txt"
tail -25 "$R/light-A-single.time.txt" | grep -E "Elapsed|Maximum resident" || true
python3 -I -c '
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1])]
ok=[r for r in rows if r.get("status")=="ok"]
ok.sort(key=lambda r: r["tu_index"])
b=[r["rss_before_kb"]//1024 for r in ok]
p=[r["peak_rss_kb"]//1024 for r in ok]
print("TUs", len(ok), "rss_before MB first/at100/at500/last/max", b[0], b[min(99,len(b)-1)], b[min(499,len(b)-1)], b[-1], max(b), "peak max", max(p))
print("sum elapsed s", round(sum(r["elapsed_ms"] for r in rows if "elapsed_ms" in r)/1000,1), "sum worker s", round(sum(r["worker_ms"] for r in ok)/1000,1))
' "$R/light-A-single.ndjson"
