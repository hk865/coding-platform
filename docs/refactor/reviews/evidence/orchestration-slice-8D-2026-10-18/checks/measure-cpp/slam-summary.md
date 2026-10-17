# SLAM 工作区：轻型 include 扫描实测（2026-10-17）

项目是用户的 ROS 2 工作区副本 `~/dsh-work/measure-cpp/copies/slam-ros2-ws`（130 个文件，git 不忽略的全部文件：129 个跟踪的 + 1 个未跟踪的 README，所以没传 `--file-list`），编译数据库 `build/slam-ros2-ws/compile_commands.json`，23 个编译单元。原始输出都在 `~/dsh-work/measure-cpp/results/slam/`。这次没有下载、没有构建、没有跑 CMake，也没有碰 `~/projects`（参考模式下 libclang 按数据库里的 `-isystem` 只读了 `~/projects/third_party/sophus/include`）。

## 先看结论

1. **轻模式下 R0 几乎等于 R3。** 23 个编译单元全都在很靠前的位置有一条找不到的系统头文件。按预处理先后算，R0 只还管得到 13,421 行里的 265 行（2.0%），56 个读到的文件里有 30 个一行都管不到。所以 R0 的假失败是 0，30 个注入的错误也只抓到 1 个。
2. **R1 不能用。** 轻模式下 56 个读到的文件里有 53 个算失败（21 个主文件、32 个头文件），全是因为缺系统头文件引起的连锁错误。注入以后 30 个目标都“失败”，但其中 28 个注入前就已经失败了。
3. **R2 是唯一既不误判、又能抓到东西的规则。** 假失败 0。它抓到了全部 10 个未闭合的 `#if`，但括号错误（0/10）和函数体里的乱码（0/10）一个都没抓到。R2lex 和 R2 的数字完全一样，这个项目里没有 `#error`。
4. **跳过函数体以后，函数体里的错误完全看不到。** 轻模式下 10 个往函数体里塞乱码的目标，连一条新诊断都没有。Codex 的判断成立。
5. **边的数量不受近似影响。** 轻模式和参考模式都是 86 条项目内的边，逐条一致。按指令比，只有一处不同：`LIVMapper.h:19` 的 `__has_include`，两边走了不同的分支，但两个目标都在项目外。函数体里的 `#include` 一个也没有（共 266 条）。通过宏写的 include 也是 0 条。
6. **按现在适配器的参数过滤，23 个编译单元全部会失败。** 照第三稿“不认识的参数只让这个编译单元失败”的写法，这个项目的 C/C++ 一个文件也解析不了。按原型的“忽略并记下”表，0 个不认识。
7. **时间和内存都很宽裕。** 轻模式每个编译单元 p50 约 7 ms、最慢 67 ms，进程峰值约 93 MB，20 秒和 300 秒的限时绰绰有余。补充测量里有一处要注意：如果换成真实的 colcon 布局（跨包的查找目录指向被 git 忽略的 `install/`），86 条边会丢 9 条。

## 0. 做法

- **扫描器：** `scripts/light_include_scan.py`，即上一个 agent 写的原型，libclang 18 经 ctypes 调用。这次我只加了一个模式 `reference-raw`，改完重跑了自测，仍是 0 处不符。各模式如下：
  - `light`：草稿的设置。选项 DetailedPreprocessingRecord、Incomplete、SkipFunctionBodies、KeepGoing，参数加 `-w -ferror-limit=0 -nostdinc -nostdinc++`；虚拟文件系统只放根目录下的 130 个文件（fallthrough false）；工作区外的查找目录去掉并记下。
  - `light-bodies`：同上，但不跳过函数体。
  - `reference`：看得到系统头文件、不用虚拟文件系统；工作区外的目录保留；用 `-idirafter` 加上 GCC 13 的内建头文件目录，因为本机没装 clang 自己的。
  - `reference-raw`：`reference` 再把原型“忽略并记下”的参数原样传进去（`-fopenmp`、`-march=native`、`-m*` 等），这是 libclang 能做到的最接近真编译的一档。
- **规则：** 用 `evaluate_rules.py` 里的 R0、R1、R2、R2lex、R3，定义照任务书。R0 的“之前”按预处理顺序的键来比，键是从主文件起每层 `#include` 的偏移，加上本行的偏移。另加一条探索用的 R4：错误落在本文件，类别是 Lexical or Preprocessor、User-Defined 或 Parse Issue，不算找不到文件那一类。头文件的状态：有一个编译单元读到它且不判它失败，就算 parsed；读到它的编译单元都判它失败，算 failed；没有编译单元读到，算 skipped。
- **假失败：** 这份代码在装齐依赖时能编过，所以轻模式里判为失败的文件全部算假失败。

## a) 跑了什么

23 个编译单元全跑了，不用抽样。每一次都只开 1 个 worker，在 `systemd-run --user --scope -p MemoryMax=4G` 下运行，跑之前 WSL 可用内存在 8.7–14 GB 之间。

| 运行 | 内容 | 用时（扫描器内部） |
|---|---|---|
| `scan.ndjson` | light、light-bodies、reference、reference-raw 各 23 个 | 0.25 s、0.31 s、67.3 s、55.3 s |
| `find.ndjson` | light、light-bodies，改用 `clang_findIncludesInFile` 取指令 | 0.33 s、0.46 s |
| `strict.ndjson` | light 加 `--strict-args`（不认识的参数就不解析） | 0.31 s，23 个全部 ok，原型的表没有拒绝任何参数 |
| `rep1-3`、`repfind1-3` | light、light-bodies 各重复 3 次（量时间） | light 0.32–0.35 s，light-bodies 0.50–0.51 s |
| `jobs3.ndjson` | 3 个 worker：light、reference | 0.32 s、27.0 s |
| `walltime` | 整个进程的墙钟（Python 启动、建虚拟文件系统、worker 启动、23 个单元） | 0.42 s |
| `colcon.ndjson` | colcon 布局模拟（见补充 1） | 0.32 s |
| `inject/` | 40 个注入目标 × light、light-bodies、reference-raw，共 93 × 3 次单元运行 | light 两档合计 14.5 s，reference-raw 约 527 s |

所有运行里没有超时、崩溃或 null TU：主扫描 23/23 都是 ok，注入的 279 次单元运行也全是 ok。

## b) 假失败（轻模式全部算假的）

读到的文件共 56 个：23 个主文件、33 个头文件。下表是判为 failed 的个数，写成“主文件 + 头文件”：

| 规则 | light | light-bodies | reference | reference-raw |
|---|---|---|---|---|
| R0 | **0** | 0 | 1 + 0 | 0 |
| R1 | **21 + 32 = 53** | 23 + 32 = 55 | 3 + 2 = 5 | 2 + 2 = 4 |
| R2 | **0** | 0 | 0 | 0 |
| R2lex | 0 | 0 | 0 | 0 |
| R3 | 0 | 0 | 0 | 0 |
| R4（探索） | 9 + 19 = 28 | 15 + 20 = 35 | 0 | 0 |

- **参考模式里的失败是怎么来的：**
  - `reference` 的 R0 判了 `IMU_Processing.cpp`，原因是 `omp_get_wtime` 未声明。原型把 `-fopenmp` 去掉了，`_OPENMP` 没定义，Eigen 就不包含 `omp.h`。`reference-raw` 把这个参数传进去以后，这 6 条错误都没了（IMU_Processing.cpp 3 条、preprocess.cpp 3 条）。
  - `reference-raw` 剩下的 4 个 R1 失败都是因为本机没有 `livox_ros_driver2`：`LIVMapper.h`、`preprocess.h`、`LIVMapper.cpp`、`preprocess.cpp`。
- **轻模式错误的构成：** 项目文件里的错误诊断按每个编译单元出现一次算，共 3,689 条：Semantic 3,391 条、Parse 298 条。另有 562 条“找不到文件”，不计入。
- **出现最多的错误文字（light，引号里的名字替换成 X）：**
  - use of undeclared identifier 'X'：1,474
  - unknown type name 'X'：1,158
  - no template named 'X'：355
  - expected 'X'：108
  - no template named 'X' in namespace 'X'：105
  - 'X' is not a class, namespace, or enumeration：84
  - expected namespace name：77
- **53 个 R1 失败文件各自的第一条原因：**
  - 未声明的标识符：20
  - expected namespace name：16（都是 `using namespace Eigen;` 之类，对应的头文件不在）
  - 未知类型名：8
  - no template named：3
  - out-of-line definition 对不上声明：3
  - 其他：3
- **R4 的 28 个失败文件各自的第一条原因：**
  - expected namespace name：16
  - expected ')'：4
  - expected class name：2
  - function-style cast：2
  - 其他：4，其中包括 1 条 `expected unqualified-id`，和下面 K1b 注入产生的文字一样
- **5 个例子（light）：**
  1. `ros2_ws/src/vikit_common/include/vikit/math_utils.h:19` expected namespace name [Parse Issue]：`using namespace Eigen;`，而 `<Eigen/Core>` 不在。
  2. `ros2_ws/src/vikit_common/include/vikit/aligned_mem.h:49` unknown type name 'size_t' [Semantic]。
  3. `ros2_ws/src/fast_livo2_core/include/fast_livo2_core/core/LIVMapper.h:33` use of undeclared identifier 'rclcpp' [Semantic]。
  4. `ros2_ws/src/vikit_common/src/pinhole_camera.cpp:20` out-of-line definition of 'PinholeCamera' does not match any declaration [Semantic]：连锁错误，类里那条声明的 Eigen 参数类型已经丢了。
  5. `ros2_ws/src/fast_livo2_core/include/fast_livo2_core/utils/types.h:12` expected unqualified-id [Parse]：这条只有 R4 会判。
- **找不到文件这条诊断本身（Codex 第一点）：** 562 条全是 `missing`：因为开了 KeepGoing，严重度都是 3（Error），类别都是 Lexical or Preprocessor Issue，落在 56 个文件里的 48 个。如果 R1、R2 不排除它，光这一条就会让 48 个文件失败。`angled_recovered`、`typo_recovered`、`macro_unexpanded` 这次都是 0。
- **R0 为什么是 0：** 按每个编译单元第一条没解析的 include 的键，算出每个文件还有哪一段在它之前；头文件取各编译单元里最短的那一段（脚本 `r0_coverage.py`）。
  - light：13,421 行里管得到 265 行（2.0%），30 个文件一行都管不到；管得到的部分基本只是文件开头的注释和 include 保护。
  - reference、reference-raw：管得到 9,597 行（71.5%），只有 livox 那一条让 7 个文件完全管不到。
  - R0 按“位置”和按“诊断发出顺序”判出的结果，四个模式里都没有不一致。

## c) 注入真错误

做法（脚本 `inject_prepare.py`、`inject_run.py`、`inject_analyze.py`）：

- **不动原文件。** 每个目标在 `results/slam/inject/<id>/ws` 有一份完整副本，只改一个文件；配一份子数据库，只含读到这个文件的编译单元，路径改到这份副本。
- **选目标：** 15 个主文件是按路径排好的 23 个里，取位置 round(i·22/14)。15 个头文件里：
  - K2 的 5 个，从 33 个读到的头文件中有函数体的 22 个里等距取；
  - 其余 10 个，从剩下的头文件里等距取，K1、K3 轮流。
- **三种错误各 10 个**（主文件 5 个、头文件 5 个）：
  - K1：在最后一条生效的 `#include` 后面加一行 `}`。
  - K2：在第一个函数体的 `{` 后面加 ` ) ] injected garbage tokens ; `，位置用 libclang 找。
  - K3：在 K1 同样的位置加一行 `#if 1`。
  - 另做 10 个 K1b（补充）：在 K1 的同样位置加一行 `{`。
- **判定：** 注入后目标文件是 failed，就算“抓到”。“新抓到”指注入前它是 parsed。

**汇总（30 个，抓到 / 其中新抓到）：**

| 规则 | light K1 | light K2 | light K3 | light 合计 | light-bodies 合计 | reference-raw 合计 |
|---|---|---|---|---|---|---|
| R0 | 0 | 0 | 1 | **1 / 1** | 1 / 1 | 25 / 25（K1 10、K2 8、K3 7） |
| R1 | 10 | 10 | 10 | 30 / **2** | 30 / 0 | 30 / 29 |
| R2 | 0 | 0 | 10 | **10 / 10** | 10 / 10 | 10 / 10 |
| R2lex | 0 | 0 | 10 | 10 / 10 | 10 / 10 | 10 / 10 |
| R3 | 0 | 0 | 0 | 0 | 0 | 0 |
| R4（探索） | 10 | 5（都是注入前就失败） | 10 | 25 / 10 | 30 / 9 | 30 / 30 |

K1b 的 10 个：
- light：R0 0、R1 10（新抓到 1）、R2 0、R3 0、R4 10（新抓到 8）；
- light-bodies：R4 新抓到 6；
- reference-raw：R0 10、R1 10。

没有哪个注入让别的文件新失败。

**clang 给出的诊断：**
- **K1：** 注入那一行报 `extraneous closing brace ('}')`，类别 Parse Issue。
- **K1b：** 报 `expected unqualified-id`，类别 Parse Issue。这条文字在轻模式的假失败里出现了 11 次。
- **K2：** light 10/10 一条新诊断都没有。light-bodies 和 reference-raw 都报 `expected expression`，类别 Parse Issue。
- **K3：** 报 `unterminated conditional directive`，类别 Lexical or Preprocessor Issue，位置在最外层还没闭合的条件指令。有 include 保护的头文件，就落在保护用的 `#ifndef` 行，例如 `output_helper.h:10`、`frame.h:13`。
- `extraneous closing brace`、`unterminated conditional directive`、`expected expression` 这三种文字，在轻模式的基线里都是 0 次。
- R0 唯一抓到的是 t29（`output_helper.h` 的 K3）。它的错误落在第 10 行的保护上，而这个文件第一条没解析的 include 在第 13 行，错误在前面。其余 29 个，都在更早的位置有一条找不到的系统头文件。
- reference-raw 下 R0 漏掉的 5 个（t02、t05、t17、t19、t27）也一样：在至少一个编译单元里，`preprocess.h:17` 那条找不到的 livox 头文件排在它前面。

**每个目标的结果**（每格依次是 R0/R1/R2/R2lex/R3/R4；`p` 是 parsed，`F` 是 failed，`p>F` 是由 parsed 变成 failed）：

| 目标 | 文件（读到它的编译单元数） | light | light-bodies | reference-raw |
|---|---|---|---|---|
| t00 K1 主 | IMU_Processing.cpp (1) | p F p p p p>F | p F p p p F | p>F p>F p p p p>F |
| t01 K2 主 | frame.cpp (1) | p F p p p p | p F p p p p>F | p>F p>F p p p p>F |
| t02 K3 主 | preprocess.cpp (1) | p F p>F p>F p F | p F p>F p>F p F | p F p>F p>F p p>F |
| t03 K1 主 | vio.cpp (1) | p F p p p F | p F p p p F | p>F p>F p p p p>F |
| t04 K2 主 | visual_point.cpp (1) | p F p p p p | p F p p p F | p>F p>F p p p p>F |
| t05 K3 主 | main.cpp (1) | p p>F p>F p>F p p>F | p F p>F p>F p p>F | p p>F p>F p>F p p>F |
| t06 K1 主 | atan_camera.cpp (1) | p F p p p p>F | p F p p p p>F | p>F p>F p p p p>F |
| t07 K2 主 | homography.cpp (1) | p F p p p F | p F p p p F | p>F p>F p p p p>F |
| t08 K3 主 | math_utils.cpp (1) | p F p>F p>F p F | p F p>F p>F p F | p>F p>F p>F p>F p p>F |
| t09 K1 主 | omni_camera.cpp (1) | p F p p p p>F | p F p p p p>F | p>F p>F p p p p>F |
| t10 K2 主 | pinhole_camera.cpp (1) | p F p p p p | p F p p p F | p>F p>F p p p p>F |
| t11 K3 主 | polynomial_camera.cpp (1) | p F p>F p>F p p>F | p F p>F p>F p p>F | p>F p>F p>F p>F p p>F |
| t12 K1 主 | user_input_thread.cpp (1) | p p>F p p p p>F | p F p p p F | p>F p>F p p p p>F |
| t13 K2 主 | vision.cpp (1) | p F p p p p | p F p p p F | p>F p>F p p p p>F |
| t14 K3 主 | output_helper.cpp (1) | p F p>F p>F p F | p F p>F p>F p F | p>F p>F p>F p>F p p>F |
| t15 K2 头 | common_lib.h (8) | p F p p p F | p F p p p F | p>F p>F p p p p>F |
| t16 K2 头 | voxel_map.h (4) | p F p p p F | p F p p p F | p>F p>F p p p p>F |
| t17 K2 头 | atan_camera.h (3) | p F p p p F | p F p p p F | p p>F p p p p>F |
| t18 K2 头 | pinhole_camera.h (6) | p F p p p F | p F p p p F | p>F p>F p p p p>F |
| t19 K2 头 | params_helper.h (2) | p F p p p p | p F p p p F | p p>F p p p p>F |
| t20 K1 头 | IMU_Processing.h (3) | p F p p p p>F | p F p p p p>F | p>F p>F p p p p>F |
| t21 K3 头 | frame.h (5) | p F p>F p>F p F | p F p>F p>F p F | p>F p>F p>F p>F p p>F |
| t22 K1 头 | visual_point.h (5) | p F p p p F | p F p p p F | p>F p>F p p p p>F |
| t23 K3 头 | types.h (8) | p F p>F p>F p F | p F p>F p>F p F | p>F p>F p>F p>F p p>F |
| t24 K1 头 | aligned_mem.h (6) | p F p p p p>F | p F p p p p>F | p>F p>F p p p p>F |
| t25 K3 头 | img_align.h (1) | p F p>F p>F p F | p F p>F p>F p F | p>F p>F p>F p>F p p>F |
| t26 K1 头 | nlls_solver_impl.hpp (1) | p F p p p p>F | p F p p p p>F | p>F p>F p p p p>F |
| t27 K3 头 | polynomial_camera.h (3) | p F p>F p>F p F | p F p>F p>F p F | p p>F p>F p>F p p>F |
| t28 K1 头 | user_input_thread.h (1) | p F p p p p>F | p F p p p p>F | p>F p>F p p p p>F |
| t29 K3 头 | output_helper.h (1) | p>F F p>F p>F p F | p>F F p>F p>F p F | p>F p>F p>F p>F p p>F |

## d) 边

- **include 指令：** 项目文件里共 266 条（按“文件:行”去重）。
  - light：86 条落到项目文件，180 条没解析。
  - reference-raw：86 条落到项目文件，179 条落到工作区外，1 条没解析（livox）。
- **项目内的边：** light、light-bodies、reference、reference-raw 都是 86 条（按 from、to 去重），逐条一致。
- **light 的 180 条没解析：**
  - 全是尖括号，引号的 0 条，经宏的 0 条，`#include MACRO` 没展开的诊断 0 条；
  - 不同的名字 67 个，不同的“文件+名字” 179 对；
  - 没有一个名字和项目里某个文件的路径结尾对得上，也就是没有因为查找目录被去掉而丢的项目内边；
  - 出现最多的：`<opencv2/opencv.hpp>` 12、`<stdio.h>` 11、`<string>` 11、`<math.h>` 10、`<Eigen/Core>` 9。
- **light 和参考模式在指令上的不同**，按任务书的分类：

| 分类 | 项目内的边 | 指令（含项目外） | 例子 |
|---|---|---|---|
| 由系统宏决定的条件分支 | 0 | 0 | `vision.cpp:10` 的 `#if __SSE2__` 两边都包含 `emmintrin.h`，因为 `__SSE2__` 是目标平台自带的宏，`-nostdinc` 下也有定义；`arm_neon.h` 两边都不生效 |
| `__has_include` | 0 | 1 对 | `LIVMapper.h:19`：light 走 `#else`，记下没解析的 `<cv_bridge/cv_bridge.h>`（第 22 行）；参考模式走 `#if`，包含工作区外的 `<cv_bridge/cv_bridge.hpp>`（第 20 行） |
| 在函数体里 | 0 | 0 | — |
| 找不到头文件 | 0 | 178 条同一指令由“没解析”变成“工作区外” | 都是系统库、第三方库和 ROS 的头文件 |
| 其他 | 0 | 0 | — |

- **函数体里的 `#include`：** light-bodies 和 reference 下，266 条全都不在函数体里。light 跳过了函数体，所以 266 条都只能记作“不知道”：跳过的函数体没有定义，它的范围只到声明为止。
- **reference 和 reference-raw 比：** 项目文件里的指令一点不差；每个编译单元平均进入的工作区外文件从 988.6 个增加到 1,059.0 个，比如 Eigen 在 `_OPENMP` 有定义时会包含 `omp.h`。

## e) 时间和内存

每个编译单元的耗时，单位 ms，从发出任务到收到结果，包括进程间传递；百分位按最近秩算：

| 模式 | 来源 | 个数 | p50 | p95 | p99 | 最大 | 合计 |
|---|---|---|---|---|---|---|---|
| light | 主扫描 | 23 | 6.6 | 15.0 | 24.8 | 24.8 | 179 |
| light | 重复 3 次合起来 | 69 | 7.9 | 25.1 | 33.5 | 33.5 | 每次 231–245 |
| light-bodies | 主扫描 | 23 | 6.0 | 29.5 | 38.2 | 38.2 | 249 |
| light-bodies | 重复 3 次合起来 | 69 | 10.2 | 47.9 | 66.7 | 66.7 | 每次 384–402 |
| reference | 主扫描 | 23 | 1,627 | 7,067 | 7,489 | 7,489 | 67,228 |
| reference-raw | 主扫描 | 23 | 1,535 | 5,005 | 5,967 | 5,967 | 55,155 |

- **时间主要花在 libclang 的解析上。** light 每次运行 23 个单元的解析合计 125–131 ms。按草稿的方式从最外层遍历取指令，每次合计 12.5–13.9 ms；改用 `clang_findIncludesInFile`，合计 6.2–6.8 ms。两种做法在这里都可以忽略。reference 的遍历平均每个单元 38 ms，约占它解析时间的 1.4%。
- **内存（每个 worker 的峰值 VmHWM）：**
  - light 93,112 KB，light-bodies 95,664 KB；worker 空闲时约 74 MB，每个单元最多再加约 19 MB；
  - reference 736,912 KB，reference-raw 757,560 KB；
  - 3 个 worker 的 reference：每个 worker 峰值最高 736,924 KB，墙钟 27.0 s，单个 worker 是 67.3 s，快 2.5 倍；
  - 3 个 worker 的 light 墙钟 0.32 s，没变快，启动开销占了大头。
- **超时、崩溃（20 秒限时）：** 所有模式都是 0。
- **推到 2,000 个编译单元、1 个 worker：**
  - light 按平均每单元 7.8–10.4 ms，约 16–21 s，另加约 0.1 s 进程启动；
  - light-bodies 按 10.8–17.1 ms，约 22–34 s；
  - reference 按 2.92 s，约 97 分钟；reference-raw 按 2.40 s，约 80 分钟。
- **20 秒和 300 秒是否合适：**
  - 轻模式下最慢的一个单元 67 ms，20 秒约是它的 300 倍；按平均每单元 10.4 ms，300 秒能跑约 28,800 个编译单元。
  - 但这个项目每个单元平均只读进 7.4 个项目文件，工作区外的文件一个也不读，所以单个单元很便宜。上限该定多少，最好以 CMake（1,064 个单元）的实测为准。
  - 反过来，如果要读系统头文件（参考模式那样），每个单元 2.4–2.9 s，300 秒大约在第 100–125 个单元就用完了。

## f) 头文件

工作区里认领的 C/C++ 文件共 67 个：26 个源文件、41 个头文件。

- **读到的：** 23 个编译单元一共读到 33 个头文件。
- **没有编译单元读到的 8 个**（照草稿是 `没有编译单元包含它`）：
  - `fast_livo2_core/livox_ros_driver/CustomMsg.h`、`CustomPoint.h`（ROS 1 的旧消息）
  - `vikit/blender_utils.h`、`file_reader.h`、`file_reader_types.h`、`patch_score.h`、`ringbuffer.h`、`sample.h`
- **3 个测试源文件**（`vikit_common/test/*.cpp`）不在数据库里，也是 skipped。

各规则下的 parsed / failed / skipped（light）：

| 规则 | 头文件 | 主文件（23） |
|---|---|---|
| R0、R2、R2lex、R3 | 33 / 0 / 8 | 23 / 0 / 0 |
| R1 | 1 / 32 / 8（parsed 的只有 `utils/color.h`，里面只有宏） | 2 / 21 / 0（parsed 的是 `main.cpp`、`user_input_thread.cpp`） |
| R4 | 14 / 19 / 8 | 14 / 9 / 0 |

light-bodies 只有两处不同：R1 的主文件 0 / 23 / 0，R4 的头文件 13 / 20 / 8、主文件 8 / 15 / 0。

## g) 编译参数

**现在的过滤**（`cpp-source-query.py` 的 `compile_unit()`，脚本 `slam_args.py` 照着原样再写了一遍，只记录、不抛错）：

- **23 个编译单元每一个都有它不认识的参数。** 照草稿“不认识的参数让这个编译单元失败”，结果是 23/23 全部失败。不认识的参数和出现的编译单元数：
  - `-march=native` 20、`-funroll-loops` 20
  - `-mmmx`、`-msse`、`-msse2`、`-msse3`、`-mssse3` 各 12
  - `-fomit-frame-pointer`、`-fno-signed-zeros`、`-fno-math-errno` 各 12
  - `-fopenmp` 11
- **按包看有三种组合：**
  - vikit_common 的 12 个单元：10 个参数；
  - fast_livo2_core 的 8 个：`-fopenmp -funroll-loops -march=native`；
  - vikit_ros 的 2 个和 fast_livo2_ros 的 1 个：只有 `-fopenmp`。
- **另外三类拒绝，23 个单元全都有：**
  - 编译目录在工作区外；
  - 工作区外的 `-isystem`：64 个不同的值；
  - 工作区外的 `-I`：1 个值，`/usr/include/opencv4`。
- **每个参数会改哪些预定义宏：** 用空文件在 libclang 18 下逐个参数比对（脚本 `probe_macros.py`），没加参数时共 453 个预定义宏。

| 参数 | 预定义宏的变化 |
|---|---|
| `-O3` | 加 `__OPTIMIZE__`，去 `__NO_INLINE__` |
| `-fPIC` | 去 `__PIE__`、`__pie__` |
| `-pthread` | 加 `_REENTRANT` |
| `-std=c++17`（对比 gnu++17） | 加 `__STRICT_ANSI__`，去 `linux`、`unix` 等 4 个 |
| `-march=native` | 本机加 44 个（`__AVX2__`、`__FMA__`、`__BMI2__` 等），去 3 个；**结果随扫描的机器变** |
| `-msse3` | 加 `__SSE3__` |
| `-mssse3` | 加 `__SSE3__`、`__SSSE3__` |
| `-mmmx`、`-msse`、`-msse2` | 不变（x86-64 默认就有） |
| `-fopenmp` | 加 `_OPENMP` |
| `-fno-math-errno` | 加 `__NO_MATH_ERRNO__`（原型的表把它标成“无影响”，这一处错了） |
| `-fexceptions`、`-funroll-loops`、`-fomit-frame-pointer`、`-fno-signed-zeros`、`-Wno-*` | 不变 |

**建议的表**（只列这个数据库里出现的参数；更完整的原型表用 `light_include_scan.py --print-arg-table` 打印）：

| 分类 | 参数 | 后面带几个值 | 出现次数 / 不同值的个数 / 编译单元数 | 理由 |
|---|---|---|---|---|
| 照用 | `-I` | 1（这里全是连写） | 56 / 9 / 23 | 头文件查找；工作区外的值另按“工作区外的查找目录”处理 |
| 照用 | `-isystem` | 1（这里全是分开写） | 696 / 66 / 23 | 同上；工作区内 2 个，工作区外 64 个 |
| 照用 | `-D` | 1（这里全是连写） | 313 / 33 / 23 | 宏 |
| 照用 | `-std=c++17`、`-std=gnu++17` | 0 | 14、21 个单元 | 语言；12 个单元两个都写，以后写的 gnu++17 为准 |
| 照用（适配器已经保留） | `-O3`、`-fPIC`、`-pthread`、`-fexceptions` | 0 | 22、23、11、11 个单元 | 前三个改预定义宏 |
| 照用（建议新加） | `-fopenmp` | 0 | 11 个单元 | 加 `_OPENMP`；参考模式里它决定 Eigen 包不包含 `omp.h` |
| 照用（建议新加） | `-mmmx`、`-msse`、`-msse2`、`-msse3`、`-mssse3` | 0 | 每个单元重复 4–8 次，12 个单元 | 确定地加 `__SSE3__`、`__SSSE3__`，libclang 接受 |
| 照用（建议新加） | `-fno-math-errno` | 0 | 12 个单元 | 加 `__NO_MATH_ERRNO__` |
| 忽略并记下 | `-o` | 1 | 23 | 只管输出 |
| 忽略并记下 | `-c` | 0 | 23 | 只管输出 |
| 忽略并记下 | `-march=native` | 0 | 32 次、20 个单元 | 宏随机器变，照用会让结果不可重复；可能翻转 `#if __AVX2__` 这类分支，这个项目里没有这种分支 |
| 忽略并记下 | `-funroll-loops`、`-fomit-frame-pointer`、`-fno-signed-zeros` | 0 | 20、12、12 个单元 | 只影响生成的代码，实测不改宏 |
| 忽略（适配器已经保留） | `-Wno-unused-variable`、`-Wno-unused-but-set-variable`、`-Wno-unknown-pragmas` | 0 | 各 12 个单元 | 只影响警告，`-w` 会盖过它们 |
| 不认识 → 这个编译单元失败 | 其他所有参数 | — | 这个数据库里 0 个 | — |

“照用（建议新加）”这三行也可以改放进“忽略并记下”，标上“会改宏”。实测在 libclang 下把它们全部照用（reference-raw），23 个单元都正常，项目文件里的指令一条没变。

**工作区外的查找目录和编译目录：**
- 这个数据库里的路径都是绝对路径，所以编译目录在工作区外不影响任何查找。
- 去掉工作区外的 `-I`、`-isystem` 以后，项目内的边一条没丢（light 86 条，参考模式也是 86 条）。
- 例外见补充 1：真实的 colcon 布局下，跨包目录在工作区里面，但被 git 忽略了。

## 补充 1：真实的 colcon 布局会丢边

- **做法：** 把通过 ament 从别的包得到、而且没写 `..` 的查找目录，从 `src/<包>/...` 改成 `install/<包>/...`（脚本 `slam_colcon_db.py`）。共改了 13 处，5 个不同的值。`install/` 不在虚拟文件系统里，和真实情况一致：它被 git 忽略。
- **结果：** 边从 86 条变成 77 条，丢了 9 条，全是 fast_livo2_core 指向 vikit_common 的头文件。例如 `vio.h:21 -> vikit/math_utils.h`、`frame.cpp:19 -> vikit/performance_monitor.h`。
- **原因：** 手写了 `..` 的目录（`../vikit_ros/include` 等）不受影响。fast_livo2_core 能找到 vikit_common 的头文件，只是靠 ament 给的那个目录。

## 补充 2：按文件数括号（不是草稿里的候选，只供参考）

- **做法：** 去掉注释、字符串、字符常量和原始字符串以后，数每个文件的 `{` 和 `}`，没生效的分支也算在内（脚本 `brace_balance.py`）。
- **结果：** 67 个认领文件里，没配平的是 0 个。注入的 K1 和 K1b 共 20 个目标，20 个都没配平；K2、K3 的 20 个都配平。
- **含义：** 这种检查和系统头文件在不在无关。和 R2 合起来，在轻模式下能抓到 K1、K3 的 20/20，K1b 也 10/10，这个项目里没有假失败；K2 仍然 0/10。它在别的代码上会不会误判（有的代码在不同分支里放的括号数不一样），要在 CMake 上再看。

## 局限

- **数据库不是真实构建出来的。** 跨包的配置是替身，指向源码目录；本机没有 livox；3 个测试源文件不在数据库里。
- **参考模式不完全等于真编译。** 本机没有 clang 自己的内建头文件，参考模式用的是 GCC 13 的。GCC 的 `xmmintrin.h` 等文件里会报错：23 个编译单元里有 20 个各报 112–123 条，另外 3 个是 0；每个单元只列了前 20 条。这些错误都不落在项目文件里，但参考模式只是近似。reference 也去掉了 `-fopenmp`，所以 reference-raw 更接近真编译。
- **注入有偏向。** K1、K3 都插在最后一条 `#include` 后面，K2 插在第一个函数体里；错误的位置决定了 R0 能不能看到它。真实的错误大多在 include 之后，所以这个偏向不利于 R0 的情况其实更常见。
- **R4 和括号检查都是探索用的，不在任务书的候选里。**
- **项目很小：** 23 个编译单元、56 个读到的文件。时间的外推和 R2 的“0 假失败”都要拿 CMake 的结果来核对。

## 文件

- **我写的脚本**（`D:/cc-lead-notes/impl/s8d/measure-cpp/scripts/`）：
  - 运行：`slam-scan.sh`（各次运行）、`slam-inject.sh`、`inject_prepare.py`、`inject_run.py`
  - 分析：`inject_analyze.py`、`slam_analyze.py`、`r0_coverage.py`
  - 参数和宏：`slam_args.py`、`probe_macros.py`
  - 补充：`slam_colcon_db.py`、`brace_balance.py`
  - 调试用：`slam_peek.py`
- **改动的脚本：** `light_include_scan.py` 加了 `reference-raw` 模式，改完自测 0 处不符。
- **原始输出**（`~/dsh-work/measure-cpp/results/slam/`）：
  - 扫描结果：`scan.ndjson`（4 个模式，92 行）、`find.ndjson`、`strict.ndjson`、`rep1-3.ndjson`、`repfind1-3.ndjson`、`jobs3.ndjson`、`walltime.ndjson`
  - colcon 模拟：`colcon.ndjson`、`compile_commands.colcon-sim.json`
  - 分析结果：`eval.json`、`eval.txt`、`analysis.json`、`args.json`、`r0-coverage-*.txt`
  - 注入：`inject/`（40 份副本、`manifest.json`，73 MB）、`inject-eval.json`、`inject-eval.txt`
- **宏探测用的空文件：** `~/dsh-work/measure-cpp/fixtures/macroprobe/empty.cpp`。

## 复核（对抗性复核，2026-10-17）

**做法。** 自己写的扫描和规则判定，不用 `light_include_scan.py`、`evaluate_rules.py`：`scripts/verify_slam.py`（自己的 ctypes 绑定、参数过滤、虚拟文件系统；位置用 `clang_getFileLocation`，不是原型用的展开位置；边取编译单元最外层的 `InclusionDirective`）、`scripts/verify_analyze.py`（R0–R3 自己算；另加 R0emit = 按诊断发出顺序算“之前”，R0lit = 不排除“找不到文件”那条诊断本身）、`verify_misc.py`、`verify_ext.py`、`verify_argcounts.py`、`verify-run.sh`。原始输出在 `~/dsh-work/measure-cpp/results/slam-verify/`（`analysis.txt` 是全部数字）；两个自造的小项目在 `fixtures/verify-macros/`、`fixtures/verify-bodyinc/`。每次重活之前 WSL 可用内存 12.9–13.5 GB，都在 `systemd-run --user --scope -p MemoryMax=4G` 下跑。
- **抽样：** 23 个编译单元没法“每隔 N 个取一个”取出 20 个，所以按路径排好后取位置 round(i·22/19)，i = 0..19；没取到的是 `utils.cpp`、`homography.cpp`、`robust_cost.cpp`。轻模式跑一遍只要 0.2 秒，所以 23 个也全跑了，用来核对总数。参考模式只跑了 `reference-raw`，23 个全跑。
- **注入：** 40 个目标在 light、light-bodies 下全部重跑，并核对每份副本：和原文件比只有那一个文件不同、改动在说好的那一行、没有多出来的文件。其中 11 个逐个看了诊断（t00、t01、t02、t05、t12、t15、t20、t21、t29、t30、t35），3 个另跑了 reference-raw（t02、t21、t29）。

**逐条结论**

1. **轻模式下 R0 几乎等于 R3：成立，但要加一条限定。**
   - 失败数：轻模式下 R0 判失败的文件，抽样 20 个是 0，全部 23 个也是 0。
   - 第一条找不到的 include：每个编译单元都在第 2–21 行，例如 `atan_camera.cpp:9 <stdio.h>`、`so3_math.h:4 <Eigen/Core>`、`IMU_Processing.h:16 <Eigen/Eigen>`。
   - 管得到的行：我算出 13,380 行里 279 行（2.1%），56 个文件里 29 个一行都管不到；报告是 265 / 13,421 行（2.0%）、30 个。差别来自数行的方式，结论不变。
   - 注入：R0 抓到 1/30，只有 t29。这个数复核一致。
   - **限定：** 这唯一的 1 个取决于“之前”怎么定义。按位置（include 链上的偏移）比，t29 算抓到；按诊断发出的先后比（R0emit），30 个一个都抓不到。原因是 `unterminated conditional directive` 落在第 10 行的保护上，却要到文件末尾才发出来，比第 13 行那条“找不到文件”还晚。报告说位置和发出顺序“没有不一致”，这只对没注入的代码成立。
   - **Codex 第一点要实测，这里补上：** 如果 R0 不排除“找不到文件”那条诊断本身（R0lit），轻模式基线会多出 10 个主文件 + 3 个头文件 = 13 个假失败。报告没给这个数。
2. **R1 不能用：成立。**
   - 轻模式下判失败 21 + 32 = 53 个，light-bodies 23 + 32 = 55 个；抽样 20 个里是 18 + 31 = 49 个。
   - 判 parsed 的正好是报告说的三个：`utils/color.h`、`main.cpp`、`user_input_thread.cpp`。
   - 注入：30/30 判失败，其中新抓到 2 个（t05、t12）；K1b 10/10，新抓到 1 个。和报告一致。
3. **R2 不误判、能抓到东西：成立；但“0 个假失败”还不能推到别的项目。**
   - 假失败：light、light-bodies、reference-raw 下都是 0。
   - 注入（light 和 light-bodies 都一样）：K3 抓到 10/10，而且都是新抓到的；K1、K2、K1b 都是 0。R2lex 和 R2 一样。
   - 这个项目里没有 `#error`。别的代码里，如果 `#error` 放在由系统头文件的宏决定的 `#if` 里，没有系统头文件时可能被触发，R2（算 User-Defined）会因此误判，R2lex 不会。这要在 CMake 上看。
4. **跳过函数体以后看不到函数体里的错误：成立，但只限语法和语义错误。**
   - 轻模式下 K2 一条新诊断都没有（t01、t15 逐个看过；light-bodies 下 t15 的 8 个编译单元各报一条 `expected expression`）。
   - 补测（`fixtures/verify-bodyinc`）：开了 SkipFunctionBodies，普通函数、模板函数、成员函数体里的 `#include` 照样记下，并且进入了那个文件；函数体里找不到的 include 照样报错；函数体里没闭合的 `#if` 也照样报 `unterminated conditional directive`。
   - 所以规格 §11.4 那条【待实测：SkipFunctionBodies 下函数体里的 #include 是否照样记下】的答案是“照样记下”。这个项目函数体里的 include 是 0 条，测不出这一点；报告只答了“没有”，没有答这个问题。
5. **边的数量不受近似影响：成立。**
   - 项目内的边：light、light-bodies、reference-raw 都是 86 条；同样的编译单元下，和报告的集合逐条相同（抽样 82 = 82，全部 86 = 86）。
   - 指令（按文件:行去重）共 266 条：light 下 86 条在项目内、180 条没解析；reference-raw 下 86 条在项目内、179 条在工作区外、1 条没解析。
   - 两边的不同：178 条由“没解析”变成“工作区外”，再加 `LIVMapper.h:20/22` 那一对 `__has_include`。
   - 没解析的名字共 67 个，没有一个和项目里某个文件的路径结尾对得上。
   - 函数体范围里的指令：light-bodies 和 reference-raw 下都是 0 条。
   - 按文字扫 67 个文件，条件里用到编译器或系统宏的只有三处：`__SSE2__` 和 `__ARM_NEON__`（`vision.cpp`、`vision.h`，以及没有编译单元读到的 `patch_score.h`），以及 `LIVMapper.h:19` 的 `__has_include`。`MP_EN` 来自 `-D`。
6. **按现在适配器的过滤 23/23 失败：成立；有一处要补充。**
   - 不认识的参数：我照 `cpp-source-query.py` 的 `compile_unit()` 重写了一遍，23/23 都有。参数名和编译单元数和报告完全一样：`-march=native` 20、`-funroll-loops` 20、六个 `-m*` 和三个 `-f*` 各 12、`-fopenmp` 11。
   - 参数计数和报告一致：
     - `-I`：56 次、9 个不同的值、23 个编译单元，全部连写；
     - `-isystem`：696 次、66 个不同的值、23 个编译单元，全部分开写；工作区内 2 个，工作区外 64 个；
     - `-D`：313 次、33 个不同的值、23 个编译单元；
     - `-march=native`：32 次、20 个编译单元；
     - `-std`：两个都写 12 个、只写 c++17 2 个、只写 gnu++17 9 个。
   - **补充：** 今天的适配器在查参数之前，就会因为“编译目录在工作区外”拒绝 23/23。工作区外的 `-isystem` 和 `-I` 也会拒绝。而且它抛出的异常让整个操作失败，不只是这一个编译单元。
   - 宏探测（`fixtures/verify-macros`，只查了 19 个宏，没有核对“44 个”这个数）：
     - `-fno-math-errno` 加 `__NO_MATH_ERRNO__`，原型的表写成“无影响”，确实错了；
     - `-msse3` 加 `__SSE3__`；`-mssse3` 加 `__SSE3__`、`__SSSE3__`；`-mmmx`、`-msse`、`-msse2` 不变；
     - `-fopenmp` 加 `_OPENMP`；`-O3` 加 `__OPTIMIZE__`、去 `__NO_INLINE__`；`-pthread` 加 `_REENTRANT`；`-fPIC` 去 `__PIE__`；
     - `-std=c++17` 加 `__STRICT_ANSI__`，去 `linux`、`unix`；
     - `-funroll-loops`、`-fomit-frame-pointer`、`-fno-signed-zeros` 不变；
     - `-march=native` 在本机加了 `__AVX__`、`__AVX2__`、`__BMI2__`、`__FMA__`、`__SSE3__`、`__SSSE3__`。
7. **时间和内存很宽裕：数量级成立。**
   - light：在进程内只量解析，每个编译单元 p50 6.4–8.2 ms，最慢 15.7–28.2 ms，23 个合计 161–209 ms；整次 0.20–0.25 s。
   - light-bodies：23 个合计 245 ms。
   - reference-raw：p50 1,481 ms，最慢 5,501 ms，合计 53.0 s。报告是 1,535 ms、5,967 ms、55.2 s。
   - 峰值内存：light 91.6 MB，light-bodies 95.4 MB，reference-raw 765 MB。报告是 93.1、95.7、758 MB。
   - 每个编译单元平均读进 7.43 个项目文件，也和报告一致。
   - colcon 模拟：边从 86 条降到 77 条，丢 9 条，成立。**新发现：** 这种布局下有 11 条指令，在一些编译单元里解析到了，在另一些里没解析。规格要写明这种指令怎么记：只记边，还是边和没解析的引用都记。
   - 所有运行（23 × 4 次基线，80 次注入运行，3 次 reference-raw 注入运行）都没有 null TU、崩溃或超时。所以 R3 的“编译单元整个出不来”这条路，这里一次都没走到。

**测量上的问题**

- **reference-raw 比报告说的更“脏”。** 报告在局限里写 20 个编译单元各报 112–123 条错误，这只是 `reference` 的数。`reference-raw` 下 23 个编译单元里有 17 个，各在 GCC 的 AVX-512 内建头文件（`avx512fintrin.h` 等）里报 4,085–4,090 条错误。原因是 `-march=native` 打开了 AVX-512 的宏，而 GCC 头文件里的内建函数 clang 不认识。项目文件里的结论不受影响（R1 只有 livox 那 4 个文件），但它不能叫“最接近真编译”，只是项目文件这一层接近。
- **“之前”的定义会改变 R0 的结果**，见第 1 条。如果选 R0，要按位置定义，并且写明“没闭合的条件指令落在它开头的那一行”。
- **R0 不排除“找不到文件”诊断本身的后果，报告没量**：13 个假失败，见第 1 条。
- **这个项目天然不利于 R0。** 每个编译单元在第 21 行以内就碰到缺失的系统头文件或第三方头文件，R0 的结果几乎是注定的；R2 的“0 个假失败”也只来自一个生态（ROS 2、Eigen）。两者都要拿 CMake 的结果来核对。
- **注入的位置有偏向，报告已经写了。** 补一句：K3 的错误落在保护行上，在这个头文件第一条没解析的 include（t29 是第 13 行）之前，t29 正是因此才被 R0 抓到。
- **没有发现被推翻的说法。** 只有小的数值差别（R0 管得到的行数、reference 的时间），结论都不变。
