#!/usr/bin/env bash
# Read-only: count C/C++ files per candidate tree and look for existing compile databases.
set -u
count() {
  local d="$1"
  local c=$(find "$d" \( -name build -o -name devel -o -name install -o -name log -o -name .git \) -prune -o -type f \( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' -o -name '*.c' \) -print 2>/dev/null | wc -l)
  local h=$(find "$d" \( -name build -o -name devel -o -name install -o -name log -o -name .git \) -prune -o -type f \( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' -o -name '*.ipp' -o -name '*.tpp' \) -print 2>/dev/null | wc -l)
  local sz=$(find "$d" \( -name build -o -name devel -o -name install -o -name log -o -name .git \) -prune -o -type f -printf '%s\n' 2>/dev/null | awk '{s+=$1} END {printf "%.1f MB", s/1048576}')
  echo "$d : sources=$c headers=$h size(excluding build/devel/install/log/.git)=$sz"
}
S=~/projects/slam
R=~/projects/slam-ros2-livo2-gazebo-control
count $S/livox_ros_driver_for_R2LIVE-main
count $S/Ros_learn_ws/FAST-LIVO2-main
count $S/Ros_learn_ws/src
for p in $S/Ros_learn_ws/src/*; do count "$p"; done
count $S/Ros_learn_ws/drive_bridge
count $S/Ros_learn_ws/simulation_model
count $R/ros2_ws/src
for p in $R/ros2_ws/src/*; do count "$p"; done
echo
echo "=== Ros_learn_ws top + build/install/log heads ==="
ls -la $S/Ros_learn_ws
ls -la $S/Ros_learn_ws/build 2>&1 | head
ls -la $S/Ros_learn_ws/src 2>&1 | head -20
echo "=== existing compile_commands.json (maxdepth 5) ==="
find $S $R -maxdepth 5 -name compile_commands.json -not -path '*/data/*' 2>/dev/null
echo "=== ros2_ws dirs ==="
ls -la $R/ros2_ws $R/ros2_ws/src
echo "=== third_party ==="
find ~/projects/third_party -maxdepth 2 2>/dev/null | head -20
echo "=== drive_bridge / simulation_model ==="
find $S/Ros_learn_ws/drive_bridge $S/Ros_learn_ws/simulation_model -maxdepth 2 2>/dev/null | head -40
echo "=== git status of trees (read-only rev-parse) ==="
for d in $S $S/Ros_learn_ws $S/Ros_learn_ws/FAST-LIVO2-main $R; do [ -e "$d/.git" ] && echo "$d is git repo"; done
