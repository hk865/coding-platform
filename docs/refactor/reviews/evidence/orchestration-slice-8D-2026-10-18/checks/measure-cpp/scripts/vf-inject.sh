#!/bin/bash
# verifier: own injected-error cases in light and light-bodies mode (VFS override; the source tree is not written)
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
SRC=$W/downloads/cmake-3.30.5/cmake-3.30.5
DB=$W/build/cmake-3.30.5/compile_commands.json
LIST=$W/results/cmake-src/vfs-files-A.txt
R=$W/results/verify-cmsrc
O=$R/inject
mkdir -p "$O"
AVAIL=$(free -m | awk '/Mem:/{print $7}'); echo "available MB $AVAIL"
if [ "$AVAIL" -lt 2000 ]; then echo STOP; exit 3; fi
python3 -I $S/vf_inject.py prepare "$SRC" "$R/full-light.ndjson" "$O" | tee "$O/prepare.txt"
ALL=$(grep '^INDICES' "$O/prepare.txt" | cut -d' ' -f2)
run() { systemd-run --user --scope -q --unit=vf-inj-$1-$$-$RANDOM -p MemoryMax=4G timeout 300 python3 -I $S/vf_scan.py --db "$DB" --root "$SRC" --file-list "$LIST" "${@:2}"; }
run base --mode bodies --out "$O/base-bodies.ndjson" --indices "$ALL" --tag base
python3 -I - "$O/plan.json" > "$O/cases.txt" <<'PY'
import json, sys
for p in json.load(open(sys.argv[1])):
    print(p['id'], p['file'], p['copy'], ','.join(map(str, p['tus'])))
PY
while read -r ID F COPY TUS; do
  for MODE in light bodies; do
    run "$ID-$MODE" --mode $MODE --out "$O/$ID/$MODE.ndjson" --indices "$TUS" --override "$F=$COPY" --tag inj
  done
done < "$O/cases.txt"
python3 -I $S/vf_inject.py report "$O" "$R/full-light.ndjson" "$O/base-bodies.ndjson" > "$O/report.json"
echo done
