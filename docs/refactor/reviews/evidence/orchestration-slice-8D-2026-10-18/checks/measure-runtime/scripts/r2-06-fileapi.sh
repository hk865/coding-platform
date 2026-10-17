#!/usr/bin/env bash
# ros2/demos: a second CONFIGURE ONLY pass (same flags as r2-02, separate build dirs) with a CMake File API
# codemodel-v2 query, to read each package's own targets, their sources and their link dependencies exactly.
set -uo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
S="$ROOT/src/ros2-demos"
B="$ROOT/build/ros2-demos-fileapi"
R="$ROOT/results/ros2-demos"
BWRAP="$HOME/.local/opt/bubblewrap/usr/bin/bwrap"
mkdir -p "$B" "$R/configure-logs-fileapi"
cd "$ROOT"
set +u
source /opt/ros/jazzy/setup.bash
set -u
PKGS=$(cd "$S" && find . -name package.xml -not -path './.git/*' | sort | while read -r p; do
  if grep -q '<build_type>ament_cmake</build_type>' "$p"; then dirname "$p" | sed 's|^\./||'; fi; done)
for rel in $PKGS; do
  name=$(sed -n 's|.*<name>\([^<]*\)</name>.*|\1|p' "$S/$rel/package.xml" | head -1)
  avail=$(free -m | awk '/^Mem:/ {print $7}')
  if [ "$avail" -le 2000 ]; then echo "available $avail MB <= 2000, stop before $name"; exit 5; fi
  if [ -d "$B/$name/.cmake/api/v1/reply" ]; then echo "$name done"; continue; fi
  mkdir -p "$B/$name/.cmake/api/v1/query"
  : > "$B/$name/.cmake/api/v1/query/codemodel-v2"
  systemd-run --user --scope -q --unit="r2-fapi-$name-$$" -p MemoryMax=6G \
    timeout 300 "$BWRAP" --dev-bind / / --unshare-net -- \
    cmake -S "$S/$rel" -B "$B/$name" -G "Unix Makefiles" \
      -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_INSTALL_PREFIX="$B/install/$name" -DBUILD_TESTING=OFF \
      > "$R/configure-logs-fileapi/$name.log" 2>&1
  echo "$name rc=$? reply=$(ls "$B/$name/.cmake/api/v1/reply" 2>/dev/null | wc -l)"
done
