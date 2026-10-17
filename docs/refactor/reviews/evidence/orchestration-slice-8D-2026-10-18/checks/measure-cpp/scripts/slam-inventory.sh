#!/usr/bin/env bash
# Merge the per-package databases, then build the argument inventory and the textual include inventory.
set -eu
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
B=$HOME/dsh-work/measure-cpp/build/slam-ros2-ws
COPY=$HOME/dsh-work/measure-cpp/copies/slam-ros2-ws
R=$HOME/dsh-work/measure-cpp/results/slam-ros2-ws
mkdir -p "$R"
cd "$R"
python3 -I $S/merge_db.py "$B/compile_commands.json" \
  "$B/vikit_common/compile_commands.json" "$B/vikit_ros/compile_commands.json" \
  "$B/fast_livo2_core/compile_commands.json" "$B/fast_livo2_ros/compile_commands.json"
python3 -I $S/flags_inventory.py "$B/compile_commands.json" "$COPY" /mnt/d/cc-lead-notes/impl/s8d/measure-cpp/flags-slam.tsv
python3 -I $S/include_scan.py "$B/compile_commands.json" "$COPY" "$R/include-scan.json" \
  /usr/include/c++/13 /usr/include/x86_64-linux-gnu/c++/13 /usr/include/c++/13/backward \
  /usr/lib/gcc/x86_64-linux-gnu/13/include /usr/local/include /usr/include/x86_64-linux-gnu /usr/include
ls -la "$B/compile_commands.json" "$R"
