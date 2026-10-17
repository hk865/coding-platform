#!/usr/bin/env bash
# Read-only: print the workspace's CMakeLists.txt and package.xml deps; existing Ros_learn_ws flags.make.
set -u
R=~/projects/slam-ros2-livo2-gazebo-control/ros2_ws/src
for p in vikit_common vikit_ros fast_livo2_core fast_livo2_ros fast_livo2_nav tb3_fastlivo; do
  echo "################ $p/CMakeLists.txt"
  cat "$R/$p/CMakeLists.txt"
  echo "################ $p/package.xml deps"
  grep -E '<(build_)?depend|<exec_depend|<buildtool_depend|<build_type' "$R/$p/package.xml"
done
echo "################ vikit_commonConfig.cmake.in"
cat $R/vikit_common/vikit_commonConfig.cmake.in
echo "################ Ros_learn_ws flags.make"
cat ~/projects/slam/Ros_learn_ws/build/fast_livo2_core/CMakeFiles/fast_livo2_core.dir/flags.make
cat ~/projects/slam/Ros_learn_ws/build/fast_livo2_ros/CMakeFiles/fastlivo_mapping_node.dir/flags.make
grep -E 'CMAKE_BUILD_TYPE|CMAKE_CXX_COMPILER:|CMAKE_PREFIX_PATH|Sophus_DIR' ~/projects/slam/Ros_learn_ws/build/fast_livo2_core/CMakeCache.txt
