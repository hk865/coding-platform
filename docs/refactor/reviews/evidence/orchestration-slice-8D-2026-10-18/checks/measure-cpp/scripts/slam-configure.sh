#!/usr/bin/env bash
# CMake configure (no build, no install, network cut with unshare -n) of the copied ROS 2 workspace
# packages in colcon's dependency order, exporting compile_commands.json per package.
# Workspace siblings are not built or installed, so each downstream find_package(<sibling>) is served by
# a stand-in config written here (the parameters an agent would supply in place of colcon's install/ tree).
# livox_ros_driver2 is absent from this machine: its stand-in exports no include directory.
COPY=$HOME/dsh-work/measure-cpp/copies/slam-ros2-ws
SRC=$COPY/ros2_ws/src
B=$HOME/dsh-work/measure-cpp/build/slam-ros2-ws
STUB=$B/stub-prefix
LOG=$B/configure-logs
mkdir -p "$B" "$STUB" "$LOG"
SOPHUS_DIR=$HOME/projects/third_party/sophus/share/sophus/cmake

avail=$(free -m | awk '/^Mem:/ {print $7}')
echo "available MB: $avail"
if [ "$avail" -le 2000 ]; then echo "not enough memory, stop"; exit 2; fi

# ---- stand-in configs -------------------------------------------------------
mkstub() { mkdir -p "$STUB/share/$1/cmake"; cat > "$STUB/share/$1/cmake/$1Config.cmake"; }

mkstub vikit_common <<EOF
# STAND-IN (measurement): what install/vikit_common would export (ament_export_include_directories(include)),
# pointed at the source include directory of the copy instead of an install tree.
set(vikit_common_FOUND TRUE)
set(vikit_common_INCLUDE_DIRS "$SRC/vikit_common/include")
set(vikit_common_LIBRARIES "")
set(vikit_common_DEFINITIONS "")
EOF

mkstub vikit_ros <<EOF
# STAND-IN (measurement): install/vikit_ros exports include/ and ament_export_dependencies(...).
set(vikit_ros_FOUND TRUE)
set(vikit_ros_INCLUDE_DIRS "$SRC/vikit_ros/include")
set(vikit_ros_LIBRARIES "")
set(vikit_ros_DEFINITIONS "")
foreach(_d rosidl_default_runtime rclcpp visualization_msgs tf2_ros tf2 Eigen3 tf2_geometry_msgs vikit_common)
  if(NOT \${_d}_FOUND)
    find_package(\${_d} QUIET REQUIRED)
  endif()
  if(NOT "\${\${_d}_TARGETS}" STREQUAL "")
    list(APPEND vikit_ros_LIBRARIES \${\${_d}_TARGETS})
  else()
    list(APPEND vikit_ros_INCLUDE_DIRS \${\${_d}_INCLUDE_DIRS})
    list(APPEND vikit_ros_LIBRARIES \${\${_d}_LIBRARIES})
    list(APPEND vikit_ros_DEFINITIONS \${\${_d}_DEFINITIONS})
  endif()
endforeach()
EOF

mkstub livox_ros_driver2 <<EOF
# STAND-IN (measurement): livox_ros_driver2 is not on this machine. No include directory is exported,
# so <livox_ros_driver2/msg/custom_msg.hpp> stays unresolved.
set(livox_ros_driver2_FOUND TRUE)
set(livox_ros_driver2_INCLUDE_DIRS "")
set(livox_ros_driver2_LIBRARIES "")
set(livox_ros_driver2_DEFINITIONS "")
EOF

mkstub fast_livo2_core <<EOF
# STAND-IN (measurement): install/fast_livo2_core exports the target fast_livo2_core::fast_livo2_core
# (ament_export_targets) with INSTALL_INTERFACE include/fast_livo2_core plus the SYSTEM PUBLIC include dirs,
# and ament_export_dependencies(deps). The install include dir is mapped to the copy's source dir.
set(fast_livo2_core_FOUND TRUE)
find_package(Eigen3 QUIET REQUIRED)
find_package(PCL QUIET REQUIRED)
find_package(OpenCV QUIET REQUIRED)
find_package(Sophus QUIET REQUIRED)
if(NOT Sophus_INCLUDE_DIRS AND TARGET Sophus::Sophus)
  get_target_property(Sophus_INCLUDE_DIRS Sophus::Sophus INTERFACE_INCLUDE_DIRECTORIES)
endif()
if(NOT TARGET fast_livo2_core::fast_livo2_core)
  add_library(fast_livo2_core::fast_livo2_core INTERFACE IMPORTED)
  set(_sys \${EIGEN3_INCLUDE_DIR} \${PCL_INCLUDE_DIRS} \${OpenCV_INCLUDE_DIRS} \${Sophus_INCLUDE_DIRS})
  set(_inc "$SRC/fast_livo2_core/include/fast_livo2_core" \${_sys})
  set(_link "")
  foreach(_d rclcpp geometry_msgs nav_msgs sensor_msgs visualization_msgs cv_bridge image_transport pcl_ros pcl_conversions tf2_ros livox_ros_driver2 vikit_common)
    if(NOT \${_d}_FOUND)
      find_package(\${_d} QUIET REQUIRED)
    endif()
    if(NOT "\${\${_d}_TARGETS}" STREQUAL "")
      list(APPEND _link \${\${_d}_TARGETS})
    else()
      list(APPEND _inc \${\${_d}_INCLUDE_DIRS})
    endif()
  endforeach()
  set_target_properties(fast_livo2_core::fast_livo2_core PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES "\${_inc}"
    INTERFACE_SYSTEM_INCLUDE_DIRECTORIES "\${_sys}"
    INTERFACE_LINK_LIBRARIES "\${_link}")
endif()
set(fast_livo2_core_TARGETS fast_livo2_core::fast_livo2_core)
set(fast_livo2_core_INCLUDE_DIRS "")
set(fast_livo2_core_LIBRARIES "")
EOF

# ---- configure in dependency order ----------------------------------------
set +u
source /opt/ros/jazzy/setup.bash
echo "ROS_DISTRO=$ROS_DISTRO"
for pkg in vikit_common vikit_ros fast_livo2_core fast_livo2_ros; do
  if [ -f "$B/$pkg/compile_commands.json" ]; then echo "$pkg already configured"; continue; fi
  avail=$(free -m | awk '/^Mem:/ {print $7}')
  if [ "$avail" -le 2000 ]; then echo "available $avail MB <= 2000, stop before $pkg"; exit 2; fi
  start=$(date +%s.%N)
  systemd-run --user --scope -q --unit=s8d-slam-cfg-$pkg-$$ -p MemoryMax=4G \
    timeout 300 unshare -rn \
    cmake -S "$SRC/$pkg" -B "$B/$pkg" -G "Unix Makefiles" \
      -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
      -DCMAKE_PREFIX_PATH="$STUB;/opt/ros/jazzy" \
      -DCMAKE_INSTALL_PREFIX="$B/install/$pkg" \
      -DSophus_DIR="$SOPHUS_DIR" \
      -DBUILD_TESTING=OFF \
      > "$LOG/$pkg.log" 2>&1
  rc=$?
  end=$(date +%s.%N)
  awk -v p="$pkg" -v r="$rc" -v s="$start" -v e="$end" 'BEGIN {printf "%s configure rc=%s seconds=%.1f\n", p, r, e - s}'
  tail -5 "$LOG/$pkg.log"
done
ls -la "$B"/*/compile_commands.json
