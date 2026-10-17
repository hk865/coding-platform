#!/usr/bin/env bash
# libuv: run the (patched) prototype.  usage: uv-04-scan.sh LAYOUT MODE NAME [extra scanner args...]
#   LAYOUT A: root = source tree, db = out-of-tree build dir;  B: root = workspace copy, db = its ignored build/
set -euo pipefail
LAYOUT=$1; MODE=$2; NAME=$3; shift 3
ROOT="$HOME/dsh-work/measure-runtime"
SC=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
R="$ROOT/results/libuv"
if [ "$LAYOUT" = A ]; then
  WS="$ROOT/src/libuv/libuv-v1.48.0"; DB="$ROOT/build/libuv-out/compile_commands.json"
else
  WS="$ROOT/work/libuv-B"; DB="$WS/build/compile_commands.json"
fi
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$AVAIL"
if [ "$AVAIL" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
cd "$R"
rm -f "$R/$NAME.ndjson"
START=$(date +%s.%N)
systemd-run --user --scope -q --unit="uv-scan-$NAME-$$" -p MemoryMax=6G \
  /usr/bin/time -v -o "$R/$NAME.time.txt" \
  timeout 900 python3 -I "$SC/uv_light_include_scan.py" --db "$DB" --root "$WS" --mode "$MODE" \
  --out "$R/$NAME.ndjson" --file-list "$R/$LAYOUT.vfs.txt" --timeout 20 --jobs 1 "$@"
END=$(date +%s.%N)
python3 -I -c 'import sys; print("wall_s=%.2f" % (float(sys.argv[2]) - float(sys.argv[1])))' "$START" "$END"
grep -E 'Elapsed|Maximum resident' "$R/$NAME.time.txt"
