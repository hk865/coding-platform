# ros2/demos 实测的独立复核（复核人：Claude 子 agent，2026-10-17）

被核的是 ros2-demos 实测的关键数字（报告正文没落盘，我拿到的是调用方转来的数字清单）。树没有重新下载，用的是同一份 `~/dsh-work/measure-runtime/src/ros2-demos`（37e25e0d，工作树干净，git 不忽略的文件 361 个）和同一套 configure 目录。

**结论：关键数字全部复算得出，结论成立。** C/C++ 的 90 条边、595 条没解析，用两种和原型不同的办法（自己写的文本解析器 + GCC 预处理器的真依赖表）都对上；Python 的 0 边 / 252 没解析 / 单扫 qos 包 4 边逐条对上；通信调用 103 处、名字 43 个、文件对 114、其中有边 0、没有任何路径 111 都对上。找到 9 处差异或遗漏，都不改变“轻型扫描基本不覆盖运行时依赖”这个结论，其中两处漏掉的运行时依赖反而让结论更强（见第 3 节）。

## 1. 方法（全是我自己写的脚本，没用测量 agent 的脚本）

脚本在 `D:/cc-lead-notes/impl/s8d/measure-runtime/scripts/`，原始输出在 WSL 的 `~/dsh-work/measure-runtime/results/ros2-demos-check/`。所有 Python 都是 `python3 -I`，工作目录在下载目录外。没有构建、没有运行项目代码；只跑了 GCC 的依赖列表（`-M -MG`，只做预处理、不出目标文件）和原型本身（被测对象）。

| 脚本 | 做什么 |
|---|---|
| `check_ros2-demos_db.py` | 直接读 15 个包各自的 `compile_commands.json`（不用合并后的那份），数条目、主文件位置、重复、所有编译参数名 |
| `check_ros2-demos_inc.py` | 自己写的 `#include` 文本解析器：去注释，按 GCC 的查找顺序（含系统目录）解析每条指令，只往工作区文件里走；和原型的 light 输出逐条比 |
| `check_ros2-demos_gcc.py` | 每个编译单元用它自己的编译器和参数跑 `-M -MG`，拿 GCC 真读到的工作区文件和我的文本解析逐单元比 |
| `check_ros2-demos_py.py` | 自己按草稿 §11.3 写的 CPython 规则解析器（ast），整仓和 5 个 ament_python 包各跑一次，和原型逐条比 |
| `check_ros2-demos_comm.py` + `check_ros2-demos_hand.json` | 通信调用（话题、服务、动作）清点、名字来源分类、按名字配对、和轻型图比连通；非字面量的名字是我读代码后自己填的表，没抄 `r2_hand_names.json` |
| `check_ros2-demos_launch.py` | launch 动作、入口点、组件登记、生成的 node_main；可执行文件到源文件的对应只用 configure 产物（`rclcpp_components/node_main_*.cpp` 和编译数据库的 `output` 路径） |
| `check_ros2-demos_cmakelink.py` | 从 CMake 生成的 `CMakeFiles/<目标>.dir/link.txt` 读自己目标之间的链接（不用 File API） |
| `check_ros2-demos_proto.py` | 原型重跑两次（打过补丁的 r2 版和 measure-cpp 里没改的原版），比输出、算耗时 |

## 2. 逐项核对

| 项目 | 报告 | 我的复算 | 结论 |
|---|---|---|---|
| 配置 | 16 包 rc=0，15 个数据库 | 16 个日志都有 `Generating done`、0 个 `CMake Error`；15 个数据库（dummy_robot_bringup 没有 C/C++）；构建目录里 0 个 `.o/.so/.a`，确实只 configure | 对 |
| 数据库条目 | 176：源码 88、构建目录 88（rosidl 59 + 组件入口 29），去重 10 → 78 | 176；源码 88、构建目录 88（rosidl 59、node_main 29）；10 条重复全在 `quality_of_service_demo/rclcpp/src/common_nodes.cpp`、`utils.cpp`（各 6 条，参数相同）→ 78。合并库和逐包库逐条相同 | 对 |
| 不认识的参数 | 0 | 全部参数名只有 `-isystem -W -D -I -o -c -std -fPIC`，都在照用或忽略表里 | 对 |
| 认领 / parsed / skipped / failed | 108 / 107 / 1 / 0 | 108 / 107 / 1（`demo_nodes_cpp/src/topics/allocator_tutorial_custom.cpp`）/ 0；GCC 也确认没有单元读到它。原因核过：`demo_nodes_cpp/CMakeLists.txt:42` 只在 Clang<16 时用它，这里是 GCC 13 | 对 |
| 边 | 90，跨包 0，38 条指向 visibility_control.h | 文本解析 90 条（文件、行、目标）三元组和原型**逐条相同**；90 个文件对；目录对 13；跨包 0；指向 visibility_control.h 38 | 对 |
| 每单元读到的工作区文件 | — | GCC `-M` 和我的文本解析 78/78 个单元完全相同 | 两种独立办法一致 |
| 指令总数 | 685 | 文本 689 处 = 685 + 4 处 `#ifdef _WIN32` 里的（`image_tools/src/burger.cpp:16`、`intra_process_demo/include/image_pipeline/common.hpp:19`、`quality_of_service_demo/rclcpp/src/utils.cpp:23-24`），预处理本来就不读，原型不报是对的 | 对 |
| 没解析 | 595：标准库 294、ROS 262、OpenCV 19、libc 5、工作区 rosidl 生成 15、项目头文件 0 | 595 和原型逐条相同；按真实路径：标准库 294、`/opt/ros/jazzy` 275、OpenCV 19、系统/libc 5、找不到 2。275 = 262 + 13：15 条点名工作区接口包的，13 条真编译时由 `/opt/ros/jazzy` 里装好的同名包供给，2 条（`logging_demo/srv/config_logger.hpp`，`logging_demo/include/logging_demo/logger_config_component.hpp:20`、`logging_demo/src/logger_config_component.cpp:21`）哪里都没有（只在构建时生成） | 数对，标签见差异 7 |
| 尖括号退路 / 拼写纠正 / include 跟宏 | 0 / 0 / 0 | 原型输出里没有 `angled`、`did you mean`；尖括号没解析的在包含者旁边都不存在；没有宏写的 include | 对 |
| 15 条 rosidl 引用对到的接口文件 | 5 | Fibonacci.action 2 条、ConfigLogger.srv 2、JointCommand.msg 5、JointState.msg 4、RttestResults.msg 2 → 5 个文件；Python 另 2 条 `action_tutorials_interfaces.action` | 对 |
| notes | 3 条，含“忽略了 76 个工作区外的查找目录” | 76 是全部 176 条数据库条目的去重目录数；只算真正解析的 78 个单元是 55 | 口径见差异 6 |
| 轻型耗时 | 合计 288 ms，p50 3.6，最长 5.7；进程 0.55 s，常驻 89 MB | 我重跑两次：r2 版合计 230 ms、p50 2.8、最长 4.7、进程 0.48 s、89 MB；原版 235 ms、p50 2.9、最长 5.2、0.60 s、89 MB。边和没解析和测量结果逐条相同 | 同一量级，对 |
| 参考模式耗时 | 项目内合计 172 s，p50 1.99 s，336 MB | 我没重跑参考模式（用 GCC 做真值）；从它的输出算：172 s 是 88 条源码条目（含 10 条重复）的和，78 个去重单元是 157.8 s，p50 1.99 s | 口径见差异 5 |
| 补丁版 vs 原版 | 输出相同（3,651 条） | 两版的包含记录都是 971 条（去重 846），边和没解析集合相同；“3,651 条”是什么口径我没找到 | 结论对，数字口径没核到 |
| Python 整仓 | 69 文件，0 边，252 没解析，原因全 null；importlib 0 | 69 / 0 / 252 / 全 null，和原型逐条相同；整仓没有 `import_module`、`__import__` 调用；函数里的导入只有 `topic_monitor/topic_monitor/scripts/topic_monitor.py:395` | 对 |
| Python 没解析的分类 | ROS 188、标准库 39、第三方 19、工作区包不在查找根下 4、生成接口 2 | 按装在哪里：`/opt/ros/jazzy` 的 site-packages 194（= 188 + 4 + 2，因为这几个 demo 包在 jazzy 里也装了）、标准库 39、dist-packages 19；那 6 条是 4 条 `quality_of_service_demo_py.common_nodes`（deadline/incompatible_qos/lifespan/liveliness.py）和 2 条 `action_tutorials_interfaces.action` | 对 |
| Python 单包 | qos 包 4 边；命名空间误导 5 处 | 5 个包逐条和原型相同；qos 4 边；`launch` 读成本地 `launch/` 目录的命名空间包：lifecycle_py 2 处、topic_monitor 3 处 | 对 |
| 通信调用 | 103（C++ 74，Py 29） | 103（C++ 74，Py 29）；角色分布逐项相同。注意 Python 有 1 处是 `create_lifecycle_publisher`（`lifecycle_py/lifecycle_py/talker.py:74`），只搜 `create_publisher` 会漏 | 对 |
| 名字来源 | 字面量 68、同文件常量 5、同文件构造参数 14、跨文件 12、运行时 4 | 字面量 68、同文件常量 3、同文件构造参数 16、跨文件 12、运行时/可改默认值 4 | 合计一样，分类差 2 处，见差异 9 |
| 隐式端点 | 16 | 16（两个 lc_talker 各 5 个服务 + 1 个 transition_event 话题，两个 LoggerServiceNode 各 2 个服务） | 对，但漏了 2 个，见差异 2 |
| 名字 / 调用处配对 | 43 / 165 | 43 / 161；多出的 4 对正是报告自己列的 4 对类型不同的 | 差异 4 |
| 通信文件对 | 114（跨语言 50，跨包 71），有边 0，有向路径 0，共享非 visibility 头文件 3，没有任何路径 111 | 文件对集合和报告逐对相同；跨语言 50、同包 43、跨包 71、同目录 43；直接边 0、有向路径 0、共享非 visibility 头文件 3、没有任何路径 111；不同目录的对里，所在目录之间有轻型边的 0 | 对 |
| launch | 22 文件 54 动作（py 34、xml 12、yaml 8），节点动作 46 全字面量，对到文件 43，外部 3，有边 0，同包 30 | 全部相同；对应方式也相同（组件类 2、生成的组件入口 20、CMake 可执行目标源文件 20、外部包 3、console_scripts 1）；launch 确认的通信对 9 | 对 |
| 组件 | 登记 36 处（指向它们的边 0），生成入口 29，class_loader 8 处 / 2 文件，dlopen 0，pluginlib 0 | 36 处在 36 个文件，没有一个文件有进来的边；29 个 node_main 的类名全部找到登记文件；class_loader 4 + 4（`composition/src/dlopen_composition.cpp:39,48,49,52`、`linktime_composition.cpp:36,53,54,57`）；dlopen 只出现在 README 和一行注释；pluginlib 0 | 对 |
| CMake 自己目标间链接 | 10，有引用路径 6，没有 4（linktime_composition） | link.txt 里自己目标的链接共 71，其中 61 条有一边只有生成代码（rosidl），两边都有工作区源文件的 10 条，6 条经头文件相连（`composition/include/composition/*_component.hpp`、`logging_demo/include/logging_demo/logger_*_component.hpp`），4 条 `linktime_composition -> {talker,listener,server,client}_component` 不相连 | 对 |
| 入口点 | 25，有边 0 | 25，全部对到文件，setup.py 到目标 0 边 | 对 |
| package.xml 包间依赖 | 6 对，有边 0 | 6 对，相同；轻型图里跨包边本来就是 0 | 对 |

## 3. 差异和遗漏

1. **漏了一个跨语言、跨包的运行时依赖。** `demo_nodes_py/demo_nodes_py/parameters/async_param_client.py:28` 写的是 `AsyncParameterClient(node, 'parameter_blackboard')`，字面量，连的是 C++ 节点 `demo_nodes_cpp/src/parameters/parameter_blackboard.cpp:34`（节点名 `"parameter_blackboard"`）的参数服务；同一文件 `:31-32` 的报错信息还写着要先 `ros2 run demo_nodes_cpp parameter_blackboard`。报告的“参数客户端 6 处”只收了 C++ 里连自己节点的 6 处，这一处没收。这一对没有任何轻型边。
2. **漏了 2 个隐式发布者。** `topic_statistics_demo/src/display_topic_statistics.cpp:96-97` 给订阅打开了话题统计，`imu_talker_listener_nodes.cpp:81`、`string_talker_listener_nodes.cpp:70` 的订阅会在 `/statistics` 上发统计消息，`topic_statistics_listener.cpp:36` 订阅它。报告里 `statistics` 是 0 个提供者 / 1 个消费者。补上以后通信文件对 114 → 116，多出的 2 对都没有轻型路径；连同第 1 条一共 117 对，没有任何路径的 114 对。
3. **topic_monitor 的 7 个 `ExecuteProcess`** 没算进节点动作。`topic_monitor/launch/fragmentation_demo_launch.py:25-36`、`reliability_demo_launch.py:25-28`、`depth_demo_launch.py:27` 用字面量参数（`small`、`medium`、`sensor --best-effort` 等）启动 `data_publisher`，所以 `topic_monitor/topic_monitor/scripts/data_publisher.py:91` 那处“只有运行时才知道（命令行参数）”的话题名，其实大半能从 launch 文件的字面量推出来（`small_data` 等）。不影响有边 0 的结论。
4. **“调用处配对 165”含了 4 对类型不同的。** 去掉报告自己列出的 4 对类型不一致（`qos_overrides_chatter` 2 对、`topic_statistics_chatter` 2 对）是 161；文件对 114 已经去掉了它们，两个数口径不一致。
5. **参考模式的“项目内合计 172 秒”算了 10 条重复条目。** 78 个去重单元是 157.8 s（p50 1.99 s 不变）。轻型的 288 ms 是 78 个单元的，两边比的时候应该都用 78 个。
6. **“忽略了 76 个工作区外的查找目录”数的是全部 176 条条目**，含 88 条主文件不在观测文件里、根本不解析的；只数解析的 78 个单元是 55。草稿 §11.4 只说“整门语言里去重以后的目录个数”，没说算不算不解析的单元，建议规格写明。
7. **“工作区 rosidl 生成 15”这个标签按“真编译找到的地方”说不准。** 这次只 configure：13 条真编译时由 `/opt/ros/jazzy` 里装好的同名包供给，2 条哪里都没有。数字对，标签应写成“点名工作区接口包的生成头文件”。
8. **回调登记只数了 C++。** “定时器回调 34”全是 C++；Python 还有 13 处 `create_timer`。这一类本来只作记录，不影响结论。
9. **名字来源有 2 处分类不同。** `demo_nodes_py/demo_nodes_py/events/matched_event_detect.py:102`、`:123` 用的是 `self.__topic_name`，值来自构造参数（`:98`、`:119` 赋值，`:143-144` 传字面量变量），我归为同文件构造参数，报告归为同文件常量。名字一样，配对不变。

另外提醒一句（报告的数字里有，不是差异）：这次 C/C++ 的 90 条边是把 15 个包的数据库合并成一份测的。按草稿 §11.4，colcon 布局有 15 个数据库，观测会整门语言 `failed`（`有多个编译数据库`），实际得到的 C/C++ 边是 0。

## 4. 随机抽 10 处运行时位置，按读代码重新分类

从报告的通信调用、launch 动作和其他运行时位置共 260 处里用种子 20261017 随机抽 10 处，逐处读源码：

| # | 位置 | 我的分类 | 名字/目标能不能从字面量定 | 对到项目里的文件 | 已有轻型边？ | 和报告 |
|---|---|---|---|---|---|---|
| 1 | `composition/src/dlopen_composition.cpp:52` | class_loader 按库名实例化 | 不能：库来自 `argv`（`:42-45`） | 任何组件库，源码里定不了 | 无 | 一致 |
| 2 | `demo_nodes_cpp/src/logging/use_logger_service.cpp:61` | 服务客户端 `LoggerServiceNode/set_logger_levels` | 能：同文件构造参数 `"LoggerServiceNode"`（`:135`、`:138`）+ 字面量后缀 | 提供者是同文件 `:37` 的隐式日志服务，以及 `use_logger_service.py:38` | 无（跨语言对） | 一致 |
| 3 | `dummy_robot/dummy_robot_bringup/launch/dummy_robot_bringup_launch.py:24` | 包共享目录查找 `FindPackageShare` | 能：字面量包名 | `dummy_robot/dummy_robot_bringup/launch/single_rrbot.urdf`（`:25`），不是代码文件 | 无 | 一致 |
| 4 | `quality_of_service_demo/rclpy/quality_of_service_demo_py/qos_overrides_listener.py:30` | 订阅 `qos_overrides_chatter`（String） | 能：字面量 | `qos_overrides_talker.py:31`；C++ 的 `qos_overrides_talker.cpp:98` 是 Image，类型不同不通信 | 无 | 一致 |
| 5 | `intra_process_demo/include/image_pipeline/watermark_node.hpp:45` | 发布，名字是构造参数 `output` | 能：跨文件构造参数，3 处调用都是 `"watermarked_image"`（`watermark_node.cpp:25`、`image_pipeline_all_in_one.cpp:37`、`image_pipeline_with_two_image_view.cpp:38`） | `image_view_node.hpp:41` | 无直接边；两者都被同一个 .cpp 包含、共享 `common.hpp`（算在“共享非 visibility 头文件 3”里） | 一致 |
| 6 | `pendulum_control/src/pendulum_demo.cpp:211` | 定时器回调 | 回调是同一函数里的局部 lambda | 文件内闭合 | 不需要 | 一致 |
| 7 | `composition/CMakeLists.txt:46` | CMake 组件登记 `composition::Listener` | 能：字面量类名 | `composition/src/listener_component.cpp`（`RCLCPP_COMPONENTS_REGISTER_NODE` 在 `:55`） | 无（CMake 不扫） | 一致 |
| 8 | `quality_of_service_demo/rclpy/quality_of_service_demo_py/common_nodes.py:35` | 发布，名字是构造参数 | 能：跨文件，4 个调用文件各一个字面量（`deadline.py:50`、`incompatible_qos.py:117`、`lifespan.py:53`、`liveliness.py:60`） | 同名订阅在同文件 `:118`；`qos_deadline_chatter` 等和 C++ 的 `common_nodes.cpp` 跨语言相连 | 单扫 qos 包时 4 个调用文件到它有导入边；整仓扫描 0 边；和 C++ 那边无 | 一致 |
| 9 | `lifecycle/src/lifecycle_talker.cpp:118` | 定时器回调，lambda 调 `this->publish()` | — | 文件内闭合 | 不需要 | 一致 |
| 10 | 构建目录 `quality_of_service_demo_cpp/rclcpp_components/node_main_message_lost_talker.cpp` | 生成的组件入口：`libmessage_lost.so` + `quality_of_service_demo::MessageLostTalker` | 能：生成文件里是字面量，也能从 `quality_of_service_demo/rclcpp/CMakeLists.txt:59-61` 推出 | `quality_of_service_demo/rclcpp/src/message_lost_talker.cpp` | 无（生成文件在构建目录，不在材料里） | 一致 |

10 处全部和报告一致。

## 5. “运行时依赖里有多少是轻型图里没有的信息”

按我自己的数复算（括号里是补上第 3 节漏项以后）：

- 通信：114 个文件对（117），直接边 0，有向路径 0；3 对只是共同读一个非 visibility 头文件（`image_tools/src/cam2image.cpp` 和 `showimage.cpp` 共享 `cv_mat_sensor_msgs_image_type_adapter.hpp`、`policy_maps.hpp`；`intra_process_demo` 的 `camera_node.hpp`、`image_view_node.hpp` 和 `watermark_node.hpp` 共享 `common.hpp`），这也不是它们之间的依赖边；其余 111 对（114）和轻型图毫无关系。跨包的 71 对，所在包之间轻型边是 0（整张轻型图本来就没有跨包边）。
- launch：43 个 launch 文件到目标文件的对，0 条边（launch 的 XML/YAML 不扫，.py 只导入外部的 `launch`、`launch_ros`）。
- 入口点 25 对、组件登记 36 个文件、生成入口 29 个、package.xml 包间依赖 6 对、rosidl 引用 17 条（对到 5 个接口文件）：都是 0 条边。
- CMake 自己目标间的链接 10 条：6 条两边经头文件相连，4 条（`linktime_composition`）完全没有。
- 回调登记：只在文件内闭合，不带来文件之间的新信息。

所以报告“9 类里 8 类带来轻型扫描没有的信息”成立；按文件对数，几乎全部是新信息。

## 6. 没核到的

- 报告正文没有落盘，我只核了调用方转来的数字清单；正文里别的数字没看到。
- 参考模式（libclang 带系统头文件）没有重跑，耗时只从它的输出复算；真值改用 GCC 预处理器。
- Python 扫描的耗时（0.038 s）没有重测。
- “未改原型输出相同（3,651 条）”里 3,651 的口径没找到；我核到的是两版输出的包含记录（971 条）、边和没解析集合都相同。
