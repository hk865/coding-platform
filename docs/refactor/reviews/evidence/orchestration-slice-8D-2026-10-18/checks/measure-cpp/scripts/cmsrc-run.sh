#!/bin/bash
# cmake-src: one resumable batch of light_include_scan.py (at most ~9 minutes).
# usage: cmsrc-run.sh SCENARIO MODE OUTNAME [extra scanner args...]
#   SCENARIO A: root = source tree, VFS = production-like list of the source tree (build tree outside)
#   SCENARIO B: root = ~/dsh-work/measure-cpp, VFS = source + build trees (build headers visible)
set -euo pipefail
SCEN=$1; MODE=$2; NAME=$3; shift 3
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
SRC=$W/downloads/cmake-3.30.5/cmake-3.30.5
BLD=$W/build/cmake-3.30.5
R=$W/results/cmake-src
if [ "$SCEN" = A ]; then ROOT=$SRC; LIST=$R/vfs-files-A.txt; else ROOT=$W; LIST=$R/vfs-files-B.txt; fi
AVAIL=$(free -m | awk '/Mem:/{print $7}')
echo "available MB $AVAIL"
if [ "$AVAIL" -lt 2000 ]; then echo "STOP: available < 2000 MB"; exit 3; fi
UNIT=cmsrc-$NAME-$$-$(date +%s)
cd "$R"
systemd-run --user --scope -q --unit="$UNIT" -p MemoryMax=4G \
  timeout 560 python3 -I $S/light_include_scan.py --db "$BLD/compile_commands.json" --root "$ROOT" \
  --mode "$MODE" --out "$R/$NAME.ndjson" --file-list "$LIST" --timeout 20 --jobs 3 --budget-seconds 500 "$@"
echo "exit $?"
python3 -I -c 'import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
print("rows", len(rows), "distinct", len({(r["mode"],r["tu_index"]) for r in rows}))' "$R/$NAME.ndjson"
