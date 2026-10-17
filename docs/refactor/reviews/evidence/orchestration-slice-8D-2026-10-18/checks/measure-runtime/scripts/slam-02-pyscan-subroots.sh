#!/usr/bin/env bash
# Python light scan with the workspace root set to one ROS package (as when a user opens a single package):
# shows what happens when a local directory (launch/) has the same name as an external package (ROS `launch`).
set -uo pipefail
S=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
SRC="$HOME/dsh-work/measure-cpp/copies/slam-ros2-ws/ros2_ws/src"
OUT="$HOME/dsh-work/measure-runtime/results/slam"
cd /
for p in tb3_fastlivo fast_livo2_nav fast_livo2_ros; do
  python3 -I "$S/light_import_scan.py" "$SRC/$p" --literal-dynamic --pretty --out "$OUT/py-scan-pkg-$p.json"
done
# also ros2_ws/ and ros2_ws/src/ as roots
python3 -I "$S/light_import_scan.py" "$HOME/dsh-work/measure-cpp/copies/slam-ros2-ws/ros2_ws" --pretty --out "$OUT/py-scan-ros2_ws.json"
python3 -I "$S/light_import_scan.py" "$SRC" --pretty --out "$OUT/py-scan-src.json"
