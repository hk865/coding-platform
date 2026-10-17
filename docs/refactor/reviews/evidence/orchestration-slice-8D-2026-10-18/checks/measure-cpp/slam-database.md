# SLAM workspace compile database: how it was made (2026-10-17)

Project: the user's ROS 2 repository `~/projects/slam-ros2-livo2-gazebo-control` (git repo; 129 tracked files + 1 untracked README). Copied without `.git` (130 files, 1.38 MB) to `~/dsh-work/measure-cpp/copies/slam-ros2-ws/`. C/C++ code lives only in `ros2_ws/src/` (6 ament packages, 4 with C++: vikit_common, vikit_ros, fast_livo2_core, fast_livo2_ros).

Database: `~/dsh-work/measure-cpp/build/slam-ros2-ws/compile_commands.json` (23 entries, 23 distinct TUs, keys directory/arguments/file/output). Per-package CMake originals (with `command`) are in `build/slam-ros2-ws/<pkg>/compile_commands.json`.

Steps (scripts in `scripts/`):
1. `slam-configure.sh`: `source /opt/ros/jazzy/setup.bash`, then per package in colcon order `cmake -S <copy>/ros2_ws/src/<pkg> -B build/slam-ros2-ws/<pkg> -G "Unix Makefiles" -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_PREFIX_PATH="<stub-prefix>;/opt/ros/jazzy" -DCMAKE_INSTALL_PREFIX=build/slam-ros2-ws/install/<pkg> -DSophus_DIR=~/projects/third_party/sophus/share/sophus/cmake -DBUILD_TESTING=OFF`, under `systemd-run --user --scope -p MemoryMax=4G timeout 300 unshare -rn` (no network). All four rc=0 (2.6 s, 4.2 s, 70.9 s, 55.7 s; PCL's find_package is the slow part). No build, no install; only CMake's own try_compile checks ran.
2. Stand-in configs in `build/slam-ros2-ws/stub-prefix/share/<pkg>/cmake/` replace colcon's `install/<pkg>` tree, which does not exist because nothing was built: vikit_common, vikit_ros (include dir + the exported ament dependencies), fast_livo2_core (an INTERFACE IMPORTED target `fast_livo2_core::fast_livo2_core` with the source include dir, the SYSTEM dirs and the exported dependencies), livox_ros_driver2 (FOUND, no include dir). These are the "agent-supplied parameters".
3. `merge_db.py`: concatenates the four databases and rewrites `command` as `arguments` with `shlex.split` (no other change).
4. `flags_inventory.py` -> `flags-slam.tsv`; `include_scan.py` -> `~/dsh-work/measure-cpp/results/slam-ros2-ws/include-scan.json` (textual, conditionals not evaluated).

What the database does not express / differs from a real colcon build:
- Cross-package include dirs that come through ament (`vikit_common_INCLUDE_DIRS`, the fast_livo2_core target) point at the copy's `src/<pkg>/include`; a real colcon build points at `install/<pkg>/include` (header copies, git-ignored), as the user's older `Ros_learn_ws` build shows (`-isystem .../install/fast_livo2_core/include`). Dirs written directly in the CMakeLists (`../vikit_ros/include`, `../vikit_common/include`, `../fast_livo2_core/include/fast_livo2_core/core`) are real and contain `..` segments.
- Imported-target dirs become `-isystem` (CMake default), so two in-workspace dirs appear as `-isystem` in fast_livo2_ros.
- livox_ros_driver2 is not on this machine: `<livox_ros_driver2/msg/custom_msg.hpp>` (preprocess.h:17, reached by 3 TUs) has no directory at all; in a real build it is a generated message header under its install tree.
- `directory` is outside the copy (`build/slam-ros2-ws/<pkg>`); colcon would use `<ws>/build/<pkg>` inside the repo (git-ignored). The production adapter refuses every entry on this alone.
- `vikit_common/test/*.cpp` (3 files) belong to no CMake target, so 23 of 26 sources are TUs.
- `-march=native` is recorded as written, not expanded.
- Sophus comes from `~/projects/third_party/sophus/include` (outside the copy, read only).
