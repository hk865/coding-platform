#!/bin/bash
# verifier: own scanner over all 1,064 TUs (scenario A, light), one process, resumable; then aggregate.
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
SRC=$W/downloads/cmake-3.30.5/cmake-3.30.5
DB=$W/build/cmake-3.30.5/compile_commands.json
R=$W/results/verify-cmsrc
MODE=${1:-light}
AVAIL=$(free -m | awk '/Mem:/{print $7}'); echo "available MB $AVAIL"
if [ "$AVAIL" -lt 2000 ]; then echo STOP; exit 3; fi
/usr/bin/time -f "wall %e s maxrss %M KB" systemd-run --user --scope -q --unit=vf-full-$MODE-$$ -p MemoryMax=4G \
  timeout 540 python3 -I $S/vf_scan.py --db "$DB" --root "$SRC" --file-list "$W/results/cmake-src/vfs-files-A.txt" \
  --mode $MODE --out "$R/full-$MODE.ndjson" --all --tag full
wc -l "$R/full-$MODE.ndjson"
