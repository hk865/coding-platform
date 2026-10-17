#!/usr/bin/env bash
# libuv 1.48.0: configure ONLY (no build), default options, build dir outside the source, network unshared.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
S="$ROOT/src/libuv/libuv-v1.48.0"
B="$ROOT/build/libuv-out"
R="$ROOT/results/libuv"
BWRAP="$HOME/.local/opt/bubblewrap/usr/bin/bwrap"
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$AVAIL"
if [ "$AVAIL" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
if [ -e "$B" ] && [ -n "$(ls -A "$B" 2>/dev/null)" ]; then echo "ABORT: build dir not empty: $B"; exit 2; fi
mkdir -p "$B" "$R"
cd "$ROOT"
START=$(date +%s.%N)
set +e
systemd-run --user --scope -q --unit="uv-configure-$$" -p MemoryMax=6G \
  "$BWRAP" --dev-bind / / --unshare-net -- \
  cmake -S "$S" -B "$B" -DCMAKE_EXPORT_COMPILE_COMMANDS=ON > "$R/configure.log" 2>&1
RC=$?
set -e
END=$(date +%s.%N)
echo "configure_rc=$RC"
python3 -I -c 'import sys; print("configure_wall_s=%.2f" % (float(sys.argv[2]) - float(sys.argv[1])))' "$START" "$END"
tail -8 "$R/configure.log"
ls -la "$B/compile_commands.json"
python3 -I -c 'import json,sys,collections; db=json.load(open(sys.argv[1])); print("entries",len(db)); print("distinct files",len({e["file"] for e in db})); print("compilers",collections.Counter((e.get("command") or " ".join(e.get("arguments",[]))).split()[0] for e in db))' "$B/compile_commands.json"
find "$B" -type f \( -name '*.h' -o -name '*.c' \) | sed "s|$B/||"
