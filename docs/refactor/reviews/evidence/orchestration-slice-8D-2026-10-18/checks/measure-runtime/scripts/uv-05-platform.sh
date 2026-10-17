#!/usr/bin/env bash
# Platform experiment: light-scan the never-compiled .c files with borrowed arguments, under the default Linux target
# and under forced Windows / Darwin targets; draft 4 rules applied by uv_eval_d4.py.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
WS="$ROOT/src/libuv/libuv-v1.48.0"
SC=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
R="$ROOT/results/libuv"
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$AVAIL"
if [ "$AVAIL" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
cd "$R"
python3 -I "$SC/uv_platform_db.py" "$ROOT/build/libuv-out/compile_commands.json" "$WS" "$R/A-eval.json" "$R/P.db.json"
for T in linux:x86_64-pc-linux-gnu win:x86_64-pc-windows-msvc darwin:x86_64-apple-darwin; do
  N=${T%%:*}; TRIPLE=${T#*:}
  rm -f "$R/P-$N.ndjson"
  systemd-run --user --scope -q --unit="uv-plat-$N-$$" -p MemoryMax=6G \
    timeout 600 python3 -I "$SC/uv_light_include_scan.py" --db "$R/P.db.json" --root "$WS" --mode light \
    --out "$R/P-$N.ndjson" --file-list "$R/A.vfs.txt" --timeout 20 --jobs 1 --force-target "$TRIPLE" | tail -c 300
  echo
  python3 -I "$SC/uv_eval_d4.py" --db "$R/P.db.json" --root "$WS" --claimed "$R/A.claimed.txt" --vfs "$R/A.vfs.txt" \
    --light "$R/P-$N.ndjson" --out "$R/P-$N-eval.json" --text "$R/P-$N-eval.txt" --label "P-$N" | head -8
done
