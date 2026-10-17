#!/usr/bin/env bash
# Read-only: file list of ros2_ws/src, dependency availability in WSL, existing colcon build flags.
set -u
R=~/projects/slam-ros2-livo2-gazebo-control
echo "=== ros2_ws/src files (no .git) ==="
find $R/ros2_ws/src -type f -printf '%s\t%P\n' | sort -k2 | head -200
echo
echo "=== deps ==="
ls /opt/ros 2>&1
which cmake ninja make gcc g++ clang clang++ 2>&1
cmake --version 2>&1 | head -1
ls -d /usr/include/eigen3 /usr/include/pcl* /usr/include/opencv4 /usr/include/boost /usr/local/include/sophus /usr/include/sophus /usr/local/include/livox* /usr/include/yaml-cpp /usr/include/glog /usr/include/gflags /usr/include/c++/* 2>&1
ls /usr/lib/x86_64-linux-gnu/cmake 2>/dev/null | head -50
ls /usr/share/cmake* -d 2>&1
ls /usr/lib/cmake 2>/dev/null | head
find ~/projects/third_party -maxdepth 4 | head -30
ls ~/miniforge3 ~/mambaforge ~/conda 2>&1 | head
echo "=== Ros_learn_ws existing build: flags.make ==="
find ~/projects/slam/Ros_learn_ws/build -maxdepth 5 \( -name flags.make -o -name CMakeCache.txt -o -name compile_commands.json \) 2>/dev/null | head -20
