#!/usr/bin/env bash
# ros2/demos: Python light import scan (prototype, --literal-dynamic).
#  ws    : the whole repository as one workspace (what the observation would see), git file list
#  pkg-* : each ament_python package directory as its own workspace (what an agent opening one package would see)
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
WS="$ROOT/src/ros2-demos"
SC=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
R="$ROOT/results/ros2-demos"
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$AVAIL"
if [ "$AVAIL" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
cd "$R"
run() { # name workspace filelist
  systemd-run --user --scope -q --unit="r2-py-$1-$$" -p MemoryMax=6G \
    /usr/bin/time -f "$1 wall_s=%e max_rss_kb=%M" python3 -I "$SC/light_import_scan.py" "$2" --file-list "$3" --literal-dynamic --out "$R/py-$1.json" --pretty
}
run ws "$WS" "$R/git-not-ignored.z"
for d in action_tutorials/action_tutorials_py demo_nodes_py lifecycle_py quality_of_service_demo/rclpy topic_monitor; do
  n=$(basename "$d"); [ "$n" = rclpy ] && n=qos_rclpy
  git -c core.fsmonitor=false -C "$WS/$d" ls-files -z --cached --others --exclude-standard > "$R/pkg-$n.z"
  run "pkg-$n" "$WS/$d" "$R/pkg-$n.z"
done
