#!/bin/bash
# verifier: own scanner, reference mode (system headers visible, outside -I kept), all TUs, 3 chunks in parallel, resumable
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
SRC=$W/downloads/cmake-3.30.5/cmake-3.30.5
DB=$W/build/cmake-3.30.5/compile_commands.json
R=$W/results/verify-cmsrc
AVAIL=$(free -m | awk '/Mem:/{print $7}'); echo "available MB $AVAIL"
if [ "$AVAIL" -lt 2000 ]; then echo STOP; exit 3; fi
for c in 0 1 2; do
  IDX=$(python3 -I -c 'import sys; c=int(sys.argv[1]); print(",".join(str(k) for k in range(1064) if k % 3 == c))' $c)
  systemd-run --user --scope -q --unit=vf-fullref-$c-$$ -p MemoryMax=4G \
    timeout 540 python3 -I $S/vf_scan.py --db "$DB" --root "$SRC" --file-list "$W/results/cmake-src/vfs-files-A.txt" \
    --mode ref --out "$R/fullref-$c.ndjson" --indices "$IDX" --tag fullref &
done
wait
cat "$R"/fullref-[012].ndjson | wc -l
