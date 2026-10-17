#!/usr/bin/env bash
# Configure the downloaded CMake 3.30.5 source out of tree (no build), network unshared.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-cpp"
S="$ROOT/downloads/cmake-3.30.5/cmake-3.30.5"
B="$ROOT/build/cmake-3.30.5"
R="$ROOT/results/cmake-3.30.5"
BWRAP="$HOME/.local/opt/bubblewrap/usr/bin/bwrap"
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$AVAIL"
if [ "$AVAIL" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
if [ -e "$B" ] && [ -n "$(ls -A "$B" 2>/dev/null)" ]; then echo "ABORT: build dir not empty: $B"; exit 2; fi
mkdir -p "$B" "$R"
UNIT="measure-cmake-configure-$$"
START=$(date +%s.%N)
set +e
systemd-run --user --scope -q --unit="$UNIT" -p MemoryMax=4G \
  /usr/bin/time -v -o "$R/configure.time.txt" \
  "$BWRAP" --dev-bind / / --unshare-net -- \
  cmake -S "$S" -B "$B" -G "Unix Makefiles" \
    -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_TESTING=ON \
    -DFETCHCONTENT_FULLY_DISCONNECTED=ON \
    -DCMAKE_USE_SYSTEM_LIBRARIES=OFF \
    -DBUILD_CursesDialog=OFF \
    -DBUILD_QtDialog=OFF \
  > "$R/configure.log" 2>&1
RC=$?
set -e
END=$(date +%s.%N)
echo "configure_rc=$RC"
python3 -I -c 'import sys; print("configure_wall_s=%.2f" % (float(sys.argv[2]) - float(sys.argv[1])))' "$START" "$END"
grep -E 'Elapsed|Maximum resident|User time|System time' "$R/configure.time.txt" || true
tail -15 "$R/configure.log"
ls -la "$B" | head -30
ls -la "$B/compile_commands.json" 2>&1
