#!/usr/bin/env bash
# Read-only inspection of the user's SLAM projects (no du, no cat of big trees).
set -u
free -m
echo "=== top level ~/projects ==="
ls -la ~/projects 2>&1 | head -40
for root in ~/projects/slam ~/projects/slam-ros2-livo2-gazebo-control; do
  echo
  echo "=== $root maxdepth 2 ==="
  find "$root" -maxdepth 2 -mindepth 1 \( -type d -o -type f \) 2>/dev/null | head -80
  echo "--- CMakeLists.txt (maxdepth 6) ---"
  find "$root" -maxdepth 6 -name CMakeLists.txt -not -path '*/build/*' -not -path '*/devel/*' -not -path '*/install/*' 2>/dev/null | head -80
  echo "--- package.xml (maxdepth 6) ---"
  find "$root" -maxdepth 6 -name package.xml 2>/dev/null | head -60
done
