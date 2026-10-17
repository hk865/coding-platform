#!/usr/bin/env bash
# ros2/demos: CMake CONFIGURE ONLY (no build) of every ament_cmake package, each separately, ROS jazzy sourced,
# build dirs outside the source, network unshared (bwrap), MemoryMax=6G, 300 s each.
# Sibling packages are NOT built; /opt/ros/jazzy already contains the released demos packages (same 0.33.11), so a
# find_package(<sibling>) is served by the underlay (normal ROS overlay situation). Recorded per package.
set -uo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
S="$ROOT/src/ros2-demos"
B="$ROOT/build/ros2-demos"
R="$ROOT/results/ros2-demos"
BWRAP="$HOME/.local/opt/bubblewrap/usr/bin/bwrap"
TESTING="${1:-OFF}"
[ "$TESTING" = ON ] && B="$ROOT/build/ros2-demos-testing"
mkdir -p "$B" "$R/configure-logs-$TESTING"
cd "$ROOT"
set +u
source /opt/ros/jazzy/setup.bash
set -u
echo "ROS_DISTRO=$ROS_DISTRO BUILD_TESTING=$TESTING"
PKGS=$(cd "$S" && find . -name package.xml -not -path './.git/*' | sort | while read -r p; do
  if grep -q '<build_type>ament_cmake</build_type>' "$p"; then dirname "$p" | sed 's|^\./||'; fi; done)
for rel in $PKGS; do
  name=$(sed -n 's|.*<name>\([^<]*\)</name>.*|\1|p' "$S/$rel/package.xml" | head -1)
  avail=$(free -m | awk '/^Mem:/ {print $7}')
  if [ "$avail" -le 2000 ]; then echo "available $avail MB <= 2000, stop before $name"; exit 5; fi
  if [ -f "$B/$name/compile_commands.json" ]; then echo "$name already configured"; continue; fi
  start=$(date +%s.%N)
  systemd-run --user --scope -q --unit="r2-cfg-$name-$$" -p MemoryMax=6G \
    timeout 300 "$BWRAP" --dev-bind / / --unshare-net -- \
    cmake -S "$S/$rel" -B "$B/$name" -G "Unix Makefiles" \
      -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
      -DCMAKE_INSTALL_PREFIX="$B/install/$name" \
      -DBUILD_TESTING="$TESTING" \
      > "$R/configure-logs-$TESTING/$name.log" 2>&1
  rc=$?
  end=$(date +%s.%N)
  n=NA; [ -f "$B/$name/compile_commands.json" ] && n=$(python3 -I -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$B/$name/compile_commands.json")
  awk -v p="$name" -v d="$rel" -v r="$rc" -v s="$start" -v e="$end" -v n="$n" 'BEGIN {printf "%s\t%s\trc=%s\tseconds=%.1f\tentries=%s\n", p, d, r, e - s, n}' | tee -a "$R/configure-$TESTING.tsv"
  if [ "$rc" != 0 ]; then grep -E 'CMake Error|Could not find|not found' "$R/configure-logs-$TESTING/$name.log" | head -5; fi
done
