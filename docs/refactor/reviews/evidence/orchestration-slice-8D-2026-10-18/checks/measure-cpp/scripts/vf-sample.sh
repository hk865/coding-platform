#!/bin/bash
# verifier: deterministic 20-TU sample (sorted by file path, every 53rd from position 26), three modes, own scanner.
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
SRC=$W/downloads/cmake-3.30.5/cmake-3.30.5
DB=$W/build/cmake-3.30.5/compile_commands.json
R=$W/results/verify-cmsrc
mkdir -p "$R"
AVAIL=$(free -m | awk '/Mem:/{print $7}'); echo "available MB $AVAIL"
if [ "$AVAIL" -lt 2000 ]; then echo STOP; exit 3; fi
IDX=$(python3 -I -c '
import json,sys
db=json.load(open(sys.argv[1]))
order=sorted(range(len(db)), key=lambda k:(db[k]["file"],k))
print(",".join(str(order[26+53*j]) for j in range(20)))' "$DB")
echo "sample indices: $IDX"
echo "$IDX" > "$R/sample-indices.txt"
for MODE in light bodies ref; do
  systemd-run --user --scope -q --unit=vf-sample-$MODE-$$ -p MemoryMax=4G \
    timeout 540 python3 -I $S/vf_scan.py --db "$DB" --root "$SRC" --file-list "$W/results/cmake-src/vfs-files-A.txt" \
    --mode $MODE --out "$R/sample-$MODE.ndjson" --indices "$IDX" --tag sample
done
wc -l "$R"/sample-*.ndjson
