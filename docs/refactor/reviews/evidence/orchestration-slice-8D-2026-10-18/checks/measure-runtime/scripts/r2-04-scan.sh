#!/usr/bin/env bash
# ros2/demos: run the (uv-patched) C/C++ prototype on the merged database. usage: r2-04-scan.sh MODE NAME [extra args]
set -euo pipefail
MODE=$1; NAME=$2; shift 2
ROOT="$HOME/dsh-work/measure-runtime"
WS="$ROOT/src/ros2-demos"
SC=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
R="$ROOT/results/ros2-demos"
DB="${DB:-$R/compile_commands.merged.json}"
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$AVAIL"
if [ "$AVAIL" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
cd "$R"
rm -f "$R/$NAME.ndjson"
START=$(date +%s.%N)
systemd-run --user --scope -q --unit="r2-scan-$NAME-$$" -p MemoryMax=6G \
  /usr/bin/time -v -o "$R/$NAME.time.txt" \
  timeout 1500 python3 -I "$SC/r2_light_include_scan.py" --db "$DB" --root "$WS" --mode "$MODE" \
  --out "$R/$NAME.ndjson" --file-list "$R/cpp.vfs.txt" --timeout 20 --jobs 1 "$@" | tail -c 600
END=$(date +%s.%N)
echo
python3 -I -c 'import sys; print("wall_s=%.2f" % (float(sys.argv[2]) - float(sys.argv[1])))' "$START" "$END"
grep -E 'Elapsed|Maximum resident' "$R/$NAME.time.txt"
