#!/usr/bin/env bash
# Copy the user's ROS 2 workspace repository (minus .git) into the measurement area; check ROS package availability.
set -eu
SRC=~/projects/slam-ros2-livo2-gazebo-control
DST=~/dsh-work/measure-cpp/copies/slam-ros2-ws
mkdir -p ~/dsh-work/measure-cpp/{downloads,copies,build,results,fixtures}
if [ -e "$DST" ]; then echo "copy already exists: $DST"; else
  mkdir -p "$DST"
  # read-only on the source: tar reads, extraction happens only under $DST
  tar -C "$SRC" --exclude=./.git -cf - . | tar -C "$DST" -xf -
fi
echo "=== git ls-files vs copy (read-only git query on the user's repo) ==="
git -C "$SRC" ls-files | wc -l
git -C "$SRC" status --porcelain --ignored 2>/dev/null | head -20
find "$DST" -type f | wc -l
find "$DST" -type f -printf '%s\n' | awk '{s+=$1} END {printf "copy size %.2f MB\n", s/1048576}'
echo "=== ROS packages needed ==="
for p in ament_cmake rclcpp geometry_msgs nav_msgs sensor_msgs visualization_msgs pcl_ros pcl_conversions tf2 tf2_ros tf2_geometry_msgs livox_ros_driver2 cv_bridge image_transport rosidl_default_generators rosidl_default_runtime cmake_modules; do
  if [ -d /opt/ros/jazzy/share/$p ]; then echo "present $p"; else echo "MISSING $p"; fi
done
find / -xdev -maxdepth 6 -type d -name 'livox_ros_driver2*' 2>/dev/null | grep -v '^/proc' | head
ls /usr/lib/x86_64-linux-gnu/cmake | grep -i -E 'fmt|opencv|pcl|eigen|sophus' ; ls /usr/share | grep -i -E 'eigen|pcl' ; ls /usr/lib/cmake | grep -i -E 'fmt|opencv|pcl|eigen'
ls -d /usr/lib/x86_64-linux-gnu/cmake/opencv4 /usr/lib/x86_64-linux-gnu/cmake/pcl /usr/share/eigen3/cmake /usr/lib/x86_64-linux-gnu/cmake/fmt 2>&1
echo "=== can we cut the network for configure? ==="
unshare -rn sh -c 'ip -o link 2>/dev/null | wc -l; echo userns-netns-ok' 2>&1
which rsync ninja 2>&1
