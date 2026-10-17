# Decision-78 light scan: runtime-dependency measurement (workflow wf_1c80e58f-d34, 10-17 18:00-19:15)

Written by the lead from the workflow return value; the subagents could not write report files.

## Synthesis

**project**

measure-runtime 综合（libuv、ros2/demos、Django、SLAM 副本、Python 原型）

**reportPath**

没有写入 D:/cc-lead-notes/impl/s8d/measure-runtime/report.md：子 agent 规则不允许写报告类 .md 文件，四个测量 agent 也都被拒了。综合报告的全文就在本输出的 summary、keyNumbers、ruleIssues、proposals 四个字段里，请调用方存到这个路径。只有 ros2-demos/check.md 已经落盘；其余项目只有数据文件，在 D:/cc-lead-notes/impl/s8d/measure-runtime/{libuv/data,libuv/check-data,ros2-demos,django,slam,prototype}/。脚本在 D:/cc-lead-notes/impl/s8d/measure-runtime/scripts/，原始输出在 WSL 的 ~/dsh-work/measure-runtime/results/。

**summary**

合起来看了四个项目的实测和各自的独立复核：libuv 1.48.0（C 库）、ros2/demos jazzy（ROS 2，C++ 加 Python）、Django 5.1.15（Python）和用户 SLAM 工作区的副本。Python 原型另外做了校验：A-20、A-21 加上自写的 17 例，24 例全过。全程只读：C/C++ 只配置不构建，没有安装或运行任何项目代码。

一、轻型扫描本身站得住。
- C/C++：新增 519 个编译单元，0 个误判；项目内的边和 GCC 真编译逐条相同（libuv 475 条，ros2/demos 90 条）。连同之前量的 CMake 和 SLAM，四个项目都是 0 误判。
- Python：Django 2,788 个文件，和 CPython 自己的查找器逐条一致。唯一失败的文件是 Django 故意写错的。

二、运行时依赖确实抓不到，缺多少看项目类型。
- libuv：缺在文件层，到目录层只多 4 对；只在别的平台编译的 105 个文件缺得更多。
- Django：按字符串加载的，大多在目录层已经连着。目录层完全没连线的 107 对里，84 对是 locale formats 这一种。
- ROS 2：运行时这一层就是架构。ros2/demos 的 117 对通信文件里，114 对和图毫无关系，21 个包之间 0 条边。SLAM 35 对运行时文件对，没有一对连上。
- 这些依赖大多能静态读出来，适合以后做成单独的引用种类。

三、最要紧的规则问题：colcon 每个包一份编译数据库，草稿会让 C/C++ 整门失败，用户自己的项目也是这样；合并成一份以后 0 误判。其余多是原因字面量和措辞。

**keyNumbers**

【说明】“边”指扫描连出的依赖；“没解析”指读到了、但对不到项目里文件的引用；“R2lex”是第三稿定的规则：只有预处理类错误才让文件失败。

【1 测了什么】
- libuv 1.48.0：dist.libuv.org 的官方包，1,314,877 字节，513 个成员，SHA-256 7f1db8ac…59fb（没有和官方摘要比对）。
  - CMake 只配置，约 4 秒；数据库 445 条，得到 441 个编译单元；认领 354 个文件（.c 316 个、.h 38 个）。
  - 试了三种布局：构建目录在源码树外、在被忽略的 build/ 里、工作区不在 git 里。
  - 对照：libclang 带系统头文件跑一遍，GCC 13 `-E -H` 跑一遍。复核用 GCC `-E -dI` 加自己写的解析。
- ros2/demos jazzy：git 克隆，commit 37e25e0d，361 个文件，2.74 MB。
  - 16 个 ament_cmake 包逐个只配置。15 个数据库合并后 176 条，去重得 78 个编译单元。
  - 认领 C/C++ 108 个、Python 69 个。复核用自己写的文本解析器加 GCC `-M -MG`。
- Django 5.1.15：PyPI 的 sdist，10,719,662 字节，SHA-256 46a356b5…eb947，和 PyPI 一致；只解开。
  - 认领 2,788 个 .py：django/ 880、tests/ 1,905、docs/ 3。
  - 复核：用 CPython 的 PathFinder 全量重算，另有一个独立写的 §11.3 解析器。
- SLAM：用上次留下的副本，没有下载，也没有构建。130 个文件，其中 C/C++ 67 个、Python 10 个；4 份数据库合并，23 个编译单元。
- Python 原型：24 例 0 不符。
  - A-20：12 条边、8 条没解析、22 个文件。
  - 和 CPython find_spec 对照，只有 .pyi 不同，这是规则有意的。
  - 冒烟：dist-packages 8,532 个文件，25.2 秒，262 MB，0 失败。
- 运行时清单：用正则加 ast 静态清点，没有运行任何代码。每个项目由另一个 Claude 子 agent 用自己的脚本复核，并手读抽查 10 处。

【2 轻型扫描（项目｜认领｜parsed/failed/skipped｜边｜没解析｜对照｜时间）】
- libuv C/C++｜354｜249/0/105｜475｜613（null 612，尖括号退路 1）｜和 GCC 逐条相同，441/441 个单元读到的文件一致｜约 4.5–5.5 秒，90 MB
- ros2/demos C/C++（合并后）｜108｜107/0/1｜90｜595，全是 null｜685 处指令和 GCC 的差别为 0｜0.29 秒，89 MB
- ros2/demos C/C++（照草稿原文）｜整门 failed，原因“有多个编译数据库”（15 份）｜0 条边
- ros2/demos Python 整仓｜69｜69/0/0｜0｜252，全是 null｜复核逐条相同｜0.04 秒
- SLAM C/C++（合并后）｜67｜23 个单元全部 ok｜86｜179（按 (文件, 说明符) 数；按行数是 180）｜复核逐条相同｜0.39 秒
- SLAM Python｜10｜10/0/0｜0｜73，全是 null｜相同｜0.06 秒，17 MB
- Django Python｜2,788｜2,787/1/0｜8,369｜2,500｜和 CPython PathFinder 逐条一致｜3.0–3.5 秒，74 MB

R2lex：
- libuv 预处理类错误 0，语义错误 71,384；换成 Windows、Darwin 目标又扫了 258 次，也是 0。
- ros2/demos 0；SLAM 重跑 0。
- 这一轮没有新做注入。

C/C++ 的其他结果：
- libuv 的 105 个 skipped：71 个只在别的平台编译，34 个是单独的子项目 docs/code。借参数补扫：Linux 目标 +196 条边（1.2 秒），Windows +200，Darwin +197，并集 201。
- libuv 和真编译走的分支不同的有 270 处，在 23 个文件里；含 `#include` 的只有 thread.c:40–42，目标是系统头文件。项目内的边 0 处不同。
- 三个项目里不认识的编译参数都是 0 个。

Python 没解析的分类：
- Django：标准库 2,278、第三方 194、只在运行时 sys.path 下的项目文件 23、其他 5。
- ros2/demos：包内的绝对导入 4 条，因为包目录不是查找根。
- 单个包当根时出现误导原因“命名空间包，没有文件”：ros2/demos 5 处，SLAM 3 处。

【3 运行时依赖（次数｜能静态定下来的｜和轻型图毫无关系的）】
- libuv：
  - 测试登记表（X 宏）：586 处，全部对上，192 对文件。文件层 0 条边；目录层都在 test/ 里，已经连着。
  - 按名字起子进程：46 处，21 个名字，8 对文件；目录层已经连着。
  - 数据文件：字面量 10 处，指向 test/fixtures 下 4 个文件。
  - 动态加载：真正加载的 9 处（算上 GetModuleHandle 是 15 处），dlsym 30 处。目标都是系统库、系统符号或 argv。
  - CMake 链接：3 对目标。
  - 加起来，目录层只多 4 对：(test, test/fixtures)、(test, src/unix)、docs/code/plugin 自己、(docs/src, docs/src/sphinx-plugins)。
  - 作为对照：只在别的平台编译的文件带来约 199 对引用、34 个新目录对，而轻型扫描本身只有 13 个目录对。
- ros2/demos：
  - 通信（话题、服务、动作、参数）：103 处调用。名字同文件就能定的 87 处，跨文件 12 处，只有运行时才知道 4 处。
  - 通信文件对 117 对（复核补了 3 对）：直接的边 0，有向路径 0，毫无关系 114 对；跨语言 50 对，跨包 71 对。launch 确认一起跑的 9 对。
  - launch：54 个动作，46 个节点动作全是字面量，对到文件 43 个，0 条边；另有 ExecuteProcess 7 个。
  - 入口点：25 个，全部对到文件，0 条边。
  - 组件：登记 36 处，没有边指进来；生成的入口 29 个；class_loader 8 处（库路径来自 argv）；pluginlib 0。
  - rosidl 生成的接口：引用 17 处，对到 5 个接口文件，0 条边。
  - CMake 自己的目标之间链接 10 条，4 条没有任何相连。package.xml 的包依赖 6 对，0 条边。
  - 21 个包之间 0 条边。
- SLAM：
  - 端点 34 处：字面量 28、f-string 1、经参数 5、定不下来 0。
  - 运行时文件对 35 对：话题 13、launch 16、参数文件 6、TF 1。再加 shell、rviz、URDF 是 42 对。有边的 0 对，在轻型图里连通的 0 对。这个 0 是结构上必然的：两端都是 C/C++ 的一对也没有。
  - 有关系的包对 12 对，有边的 4 对。项目代码之间按名字配上的 4 对里，真会一起运行的只有 2 对。
  - 顺带读出的事实（算不算问题由用户判断）：Phase A 有两处发布同一对 TF，LIVMapper.cpp:1626 和 ground_truth_tf_broadcaster.py:63；rover.yaml 和 avia.yaml 各有 3 个键没有代码读；7 个文件没有任何地方引用；package.xml:17 依赖不存在的 fast_livo；system() 执行的 colmap_output.sh 不在项目里。
- Django：
  - importlib/`__import__`：75 处，字面量 27 处（全在 tests/），用配置的根对上 6 处；django/ 里的 43 处全不是字面量。import_string 44 处，django/ 里的 41 处全不是字面量。
  - 点号字符串：1,337 处，对上 1,281 处，合成 715 对。其中文件边 58、同目录 152、目录边 154、只有反向目录边 19、哪层都不连 296。哪层都不连的 296 对里 286 对在 tests/；抽查 30 处，28 处对。
  - 迁移依赖：110 对，文件边 0。
  - 按目录约定发现的模块，没有入边的个数/总数：commands 23/34、contrib 的 migrations 23/23、apps.py 13/15、locale formats 84/84。
  - 模板：extends/include 178 处，其中 96 处有多个候选。
  - 结构：django/ 里 388 个文件（44%）没有内部入边，分成 218 个靠运行时接线、135 个包标记 `__init__.py`、35 个给用户代码用的 API。
  - 加载方→被加载方 253 对：文件边 10 对；目录层完全没连线的 107 对（42%，其中 84 对是 locale formats）；组件层新出现的 4 对。
- 原型冒烟（dist-packages）：字面量的动态导入 255 处，其中 101 对 (from, to) 是静态边里没有的。os.path 13 处、six.moves 18 处被判成“是模块，不是包”。

【4 复核的分歧，采用哪个数（都取复核的数，结论不变）】
- libuv：
  - 登记表 576→586：我自己也数了，test-list.h 521 行加 benchmark-list.h 65 行。文件对 192。
  - 动态加载 15 处里有 6 处是 GetModuleHandle，真正加载的是 9 处。
  - 环境变量：只算 src 是 5 处，全口径是 21 处。
  - 数据库条目：207 个出现 2 次、4 个出现 3 次、19 个出现 1 次。
  - “约 169 组”复现不出来，只引用 270 处、23 个文件。
  - 时间上界改成 5.5 秒。
- ros2/demos：
  - 通信文件对 114→117，毫无关系 111→114。补上的是 async_param_client.py:28 到 parameter_blackboard.cpp:34，和 2 个 /statistics 隐式发布者。
  - 调用处配对 165→161。
  - 参考模式时间 172→157.8 秒（按 78 个去重单元）。
  - 工作区外的查找目录：数全部 176 条是 76 个，只数解析的单元是 55 个。
  - “3,651 条”没有核到。
- SLAM：没解析 180→179；35 对→42 对（加上另外三类）。
- Django：
  - 加载对 281→253：去掉 settings.py-tpl 的 20 对，和写得太宽的 models 规则的 8 对；structure.json 里能看到这两类。
  - 目录层完全没连线 48%→42%；组件层新增 6→4 对。
  - @receiver 33→24 处；只靠函数里 import 得到的文件对 216→188；第三方名字 30→29 个。
  - 点号字符串的绝对数随定义变：窄定义下 488 对、188 对无边，占 38.5%（原定义 41.4%），比例稳定。

【没量到】
- 用的是原型，没走生产执行器。只在 Python 3.12 上跑。
- 四个项目里 pluginlib 都是 0 处。
- 没量用 Django 写的应用项目。
- Django 的 sdist 不是 git 仓库，决定 77 的 git 清单那一支没走到。
- 运行时清单是启发式的；“会不会一起运行”是手判的。
- 这一轮没有做注入。

**ruleIssues**

1. §11.4“有多个编译数据库就整门失败”挡住了能完全做对的情形。ros2/demos 按 colcon 布局有 15 份数据库（colcon-probe.txt），C/C++ 整门 failed、0 条边。合并成一份以后：78 个单元 0 失败，90 条边，和 GCC 逐处相同。用户 SLAM 是同样的结构（4 份），合并后 86 条边；真实的 colcon 布局下，跨包的查找目录在 install/，还会再丢 9 条。草稿把这条记成已知限制，可它让 4 个项目里的 2 个（含用户自己的）C/C++ 一条边都没有。
2. §11.4 的提示“工作区里有 CMakeLists.txt”没说是根上还是任何一层。ros2/demos 和 SLAM 的根上都没有。给的命令 cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON 对 colcon 不对：colcon 要用 --cmake-args，照做以后每个包一份数据库，又落到上一条。SLAM 用户的构建命令都不导出数据库（README.md:151、docs/commands.md:29–40、docker/Dockerfile:108）。
3. 尖括号退路找到的是写这条指令的文件自己时，原因“尖括号引用只能按引号规则找到”会误导。例子：libuv include/uv/errno.h:25 的 #include <errno.h>，441 个单元里 429 个出现；真编译指向 /usr/include/errno.h。CMake 的 26 处里也有 14 处是这样。不连边是对的，原因建议记 null。
4. notes 的“近似：只读工作区里 git 不忽略的头文件”在不在 git 里的工作区说错了。libuv 的布局 C 里 build/ 进了材料，多认领了一个 CMakeCCompilerId.c（skipped）。有 cmConfigure.h 这类生成头文件的项目，边也会变。
5. §11.4 写了“施工时实测”被忽略数据库的 git 命令，现在已经量了。git 2.43.0 上不加 --directory 能列出 build/compile_commands.json；加了只返回 build/。规格应写明不加。
6. -idirafter：第四稿说照用，又说原型的表原样搬，而原型把它放在忽略表里。第五稿已经改成挪到照用，不用再动。
7. C/C++ 没写“自己到自己不记边”，Python 写了。libuv 唯一的自指来自退路；故意包含自己的 X 宏文件没量到。
8. “忽略了 <n> 个工作区外的查找目录”的 n 怎么算没写明。ros2/demos 数全部 176 条是 76 个，只数解析的 78 个单元是 55 个。
9. 两条 note 或原因不算错，但把不同的东西混在一起了：(1) ros2/demos 的“88 个编译单元的主文件不在观测的文件里”= rosidl 生成的 59 个 + 组件入口 node_main 29 个，后者是 launch 和组件类之间唯一的连接；(2) libuv 的“没有编译单元包含它”105 个 = 只在别的平台编译的 71 个 + 独立子项目 docs/code 34 个。
10. §11.3 会把外部包读成“命名空间包，没有文件”。单个包当根时，包里的 launch/ 目录挡住了 ROS 的 launch 包：ros2/demos 5 处（lifecycle_py/launch/lifecycle_demo_launch.py:15、topic_monitor/launch/depth_demo_launch.py:17 等），SLAM 3 处。同一批文件里 import launch.actions 却是 null，前后不一致。第四、五稿的结果相同。
11. §11.3 的查找根只来自根上的配置。ROS ament_python 每个包有自己的 setup.py，整仓扫时包内的绝对导入没解析、原因 null，看起来像外部包。ros2/demos 有 4 处：quality_of_service_demo_py 下 deadline、incompatible_qos、lifespan、liveliness 四个 .py 里的 common_nodes。
12. 运行时才有的查找根，规则表达不了。Django 的 tests/runtests.py 当脚本跑，tests/ 就是 sys.path[0]，所以有 17 条项目内引用没解析；extend_sys_path 和 docs/conf.py 又带来 6 条。把 tests/ 加成全局根会多 19 条边，其中 2 条是错的：docs → tests/sphinx 遮住了真正的 Sphinx。
13. 没解析的原因只有 null，分不清标准库、第三方和“项目文件、只在运行时的根下”。Django 2,500 条里，标准库 2,278 条、第三方 194 条、项目文件 23 条。规则没错，但读的人分不开。
14. 观测模式里“include、exclude、ignore”没说是哪张表的。Django 的 pyproject.toml 有 [tool.setuptools.packages.find] include = ["django*"]。照今天的代码只看 pyright 那张表，notes 是 []；读成任何地方的 include，就会多一条 note。
15. 原型发现的 Python 措辞问题，都还没定：(1) 相对导入要不要用“和标准库重名”那条；(2) 相对导入的“点号全名”写成 .mm 还是 rel.mm，dist-packages 里有 9 处实例；(3) 只有 __init__.pyi 的起点目录，前后说法不一致；(4) 结尾带 / 的根（src/）被当成空段去掉，引用静默变成没解析，“含 ..”按子串还是按段也没写；(5) 没有 Python 文件时遇到坏配置，Python 要不要 failed；(6) package-dir 空包名那一项的值不是字符串时，没有对应的字面量。
16. pyrightconfig.json 里写了注释或结尾逗号（JSONC，pyright 本身接受）时，整门 Python 失败（X4h 例）。观测里的代价比 python_index 大。
17. 运行时往 sys.modules 塞的子模块（os.path 13 处）和 meta path importer（six.moves 18 处）被判成“是模块，不是包”，读起来像代码写错了。静态上这样判没错。
18. complete 容易读错。SLAM 的 Python 覆盖是 parsed 10/10、complete true，边却是 0；而这 10 个文件经话题、launch、参数文件全都连着。规则没错，工具说明里缺一句话。

**proposals**

1. (a) 冻结前要定：多个编译数据库。【选项 A】同一个被忽略的构建根下、一层一个子目录的数据库（build/<包>/compile_commands.json）按路径排序拼接，照现有规则去重，note 记“合并了 <n> 个编译数据库”。依据：ros2/demos 78 个单元 0 失败，90 条边和 GCC 相同；SLAM 86 条边。可以另加一条 install/<包>/include → src/<包>/include 的映射，补回 SLAM 那 9 条。成本是我的粗估，没有量过：选数据库那一步加一个分支、一个 note 字面量和两三个夹具。【选项 B】不改。把原因拆成两句：有 package.xml 或 colcon 结构时，提示 colcon build --cmake-args -DCMAKE_EXPORT_COMPILE_COMMANDS=ON，并说明多份目前不支持；已知限制里点名“两个 ROS 项目 C/C++ 都是 0 条边”。
2. (a) 冻结前要定，都便宜：写明 CMake 提示里的“工作区里有”是根上还是任何一层；尖括号退路找到自己时，原因记 null（libuv 429 个单元，CMake 26 处里 14 处）；不在 git 里的工作区，那条近似 note 要改措辞或加条件（libuv 布局 C）；被忽略数据库的 git 命令写明不加 --directory（git 2.43.0 实测）；C/C++ 补上“自己到自己不记边”，三门语言统一；写明“工作区外的查找目录”的 n 怎么算（76 还是 55）。
3. (a) 冻结前要定：Python 命名空间的原因。【选项 A】把标准库那条例外推广：第一段只找到命名空间部分、要的名字又找不到时，原因记 null，或者新加一个字面量“命名空间目录，可能是同名的外部包”；“命名空间包，没有文件”只留给第二段以后。A-20 的 ns、nsuser.py 两例要跟着重算。【选项 B】不改，写进已知限制。依据：ros2/demos 5 处、SLAM 3 处，from launch import 和 import launch.actions 前后不一致。
4. (a) 冻结前要定，都是 Python 措辞，便宜，各补一句：include、exclude、ignore 指 [tool.pyright] 或 pyrightconfig.json 里的（Django 的例子）；“和标准库重名”只用于绝对导入；相对导入的点号全名定一种写法；只有 __init__.pyi 的起点目录算正规包；先去掉根结尾的 /，“..”按段算；写明没有 Python 文件时坏配置怎么办；package-dir 空包名的值不是字符串时，当作用不了的根。JSONC 二选一：读（去掉注释和结尾逗号再解析），或者写进已知限制。
5. (a) 可选，若做要在冻结前：加一个原因字面量“标准库”（第一段在 sys.stdlib_module_names 里时）。成本几乎为零，草稿已经用这个列表；Django 2,500 条没解析里有 2,278 条能分出来。要改 §11.5 的原因表和 A-20 的期望。
6. (b) 现在写进工具说明，不进每次的 notes：边只来自 import 和 #include。下面这些都不算边：ROS 的话题、服务、动作、参数、TF、launch 起的进程、组件、class_loader、pluginlib、rosidl 生成的接口、CMake 链接、package.xml 依赖；Django 的设置和点号字符串、按目录约定加载的模块、模板、迁移依赖；C 里的 dlopen、测试登记表、按名字起子进程、数据文件。附上数：ros2/demos 117 对通信文件里 114 对毫无关系，21 个包之间 0 条边；SLAM 35 对，0 对连上；Django 目录层完全没连线的 107/253 对；libuv 目录层只多 4 对。另写一句：complete 只说明解析覆盖完整，不说明没有依赖（SLAM 的例子）。
7. (b) 现在写进已知限制：(1) C/C++ 只按一个平台读。libuv 有 71 个文件、约 199 对引用、34 个目录对没进图，src/win 整个是孤点。(2) 嵌套的独立 CMake 项目进不了根数据库（libuv docs/code 的 34 个文件）；把它也配置了，会变成多份数据库。(3) 永远按 clang 的预定义宏读。(4) 不 include 自己头文件的 .cpp 在图上是孤点（SLAM utils.cpp）；ROS 接口头和 rosidl 生成的头文件读作没解析。(5) Python 的几种：运行时才有的查找根（脚本所在目录、改 sys.path）；多包仓库只读根上的配置；没有扩展名的脚本不认领；sys.modules 和 meta path importer；名字不是字面量的 importlib；中间的 __init__.py 不加边，Django 有 135 个包标记成了孤点，44% 的边指向 __init__.py。(6) §11.7 的“R2lex 只在两个项目上量过”改成四个（CMake、SLAM、libuv、ros2/demos），并写明这一轮没有新做注入，libuv 另加了 Windows、Darwin 目标 258 次扫描，0 误判。
8. (b) 可选的新 note 字面量（要改 §11.5 的 notes 列表，由 lead 定；不做的话只写进工具说明）：“<n> 个源文件没有编译单元”，libuv 是 86 个，让人一眼看出有平台或子项目没进图；“<n> 处动态导入的名字不是字面量”，Django 库里 importlib 43 处、import_string 41 处。
9. (c) 以后做，价值最大：ROS 通信图，作为单独的关系种类（要先有 §11.7 的“引用的种类字段”）。依据：名字能静态定下来的，ros2/demos 99/103，SLAM 34/34；文件对分别是 117 和 35。难点：同名端点多（chatter 有 7 个发布方、8 个订阅方，跨 4 个包），launch 确认一起跑的只有 9 对；SLAM 4 对里只有 2 对真会一起运行。轻型 C/C++ 扫描用了 SkipFunctionBodies，看不到函数体里的 create_* 调用，要另做一遍词法或 tree-sitter 扫描。话题名应当做节点，不直接连成文件对；还要带上 launch 的上下文和参数默认值。成本粗估是中到大：新扫描、名字解析、读 launch、新种类的存法和展示。没有量过。
10. (c) 以后做，便宜到中等：(1) rosidl 接口映射，<包>/msg|srv|action/<snake>.hpp 和 <包>.msg 对到接口文件。ros2/demos 17 处、5 个接口文件，会出现第一批跨包边；规则确定，报告估“几十行”。(2) package.xml 的依赖作为包之间的关系，读 XML 就行。ros2/demos 6 对；SLAM 有关系的 12 对里 8 对没边。(3) launch 和入口点对到文件：ast 读 .launch.py 的字面量，解析 XML、YAML，读 setup.py、setup.cfg、pyproject 的入口点。ros2/demos launch 43/46、入口点 25/25，SLAM 16/16。CMake 里用变量拼名字的，要靠 File API 或生成的 node_main。
11. (c) 以后做，中等，依赖 agent 先跑配置（决定 78-3）：CMake 链接图。compile_commands.json 里没有链接信息，要在配置前放 CMake File API codemodel-v2 的 query 文件。也可以先从数据库条目的 output 字段把编译单元分到目标，不用另跑（libuv 有 5 个目标）。依据：libuv 3 对目标，test→src/unix 缺；ros2/demos 10 条里 4 条不相连；SLAM 的 ament_target_dependencies。
12. (c) pluginlib XML：四个项目里都是 0 处，价值估不出来。要量得另找一个用 pluginlib 的项目，下载要先经用户同意。
13. (c) 不建议做：字面量的 importlib、import_string 边。成本极低，原型的 --literal-dynamic 已经能做，同一遍 ast 就行；但 Django 库里 0 处字面量，测试里 27 处只对上 6 处。dist-packages 冒烟有 255 处、101 对新的，价值看项目。
14. (c) 以后做，中等偏小：字符串路径引用作为单独的引用种类。包括 Django 的设置、INSTALLED_APPS、include()、字面量的 import_string、AppConfig.name、迁移的 dependencies。依据：1,337 处合成 715 对，296 对哪层都不连，抽查 28/30 对；但其中 286 对在测试里，django 库内部只有 10 对。价值主要在用 Django 写的应用项目，这次没量。要有上下文白名单和“顶层绑定”核对，挡住 logger 名、216 处 mock.patch 目标这类同形字符串。
15. (c) 只按框架开关做，或者不做：(1) 框架约定加载（commands、migrations、templatetags、apps.py、admin.py、locale formats）。Django 目录层 107 对里 84 对来自 locale formats 这一种。(2) Django 模板的 {% load/extends/include %}：142 处里 96 处有多个候选，谁生效要读设置。
16. (c) 以后做：(1) 第二遍扫没被读到的源文件，借邻近单元的参数、换平台目标，边标成近似。libuv：Linux 目标 +196 条（1.2 秒），三个平台并集 201 条；风险是分支走错。(2) 字面量的文件路径引用，包括数据文件、参数 YAML 和代码的对应。libuv 10 处全对，SLAM 参数 6 对。参数必须按“装载它的节点”配对，直接按名字配会出假对：话题 23 对对 13 对，参数 7 对对 6 对。(3) Python 多包仓库：把有 setup.py、setup.cfg 或 package.xml 的目录作查找根，ros2/demos 能补 4 条边。(4) 按子目录补查找根，由 agent 填：Django 的 tests/ 只给 tests/ 用，补回 17 条边，又没有那 2 条错边。
17. (c) 只记，不做成通用规则：libuv 的 X 宏测试登记表 586 处、按名字起子进程 46 处，要符号级配对，留给查源码的重型分析器；dlopen 和 class_loader 的库路径来自 argv；topic_monitor 的话题名来自命令行和正则匹配；回调和定时器的登记在同一个文件里闭合。规模上，libuv 有 211 个源文件因为两套参数各扫两次，约 48% 的时间是重复的，这个规模不用改。

## Python prototype

**project**

python-prototype

**reportPath**

D:/cc-lead-notes/impl/s8d/measure-runtime/prototype/README.md

**summary**

写了 Python 轻型 import 扫描原型 D:/cc-lead-notes/impl/s8d/measure-runtime/scripts/light_import_scan.py（只用标准库，WSL 的 Python 3.12.3）。它照草稿 4 §11.3 做了这些：选配置看存在、按配置分开的查找根顺序、观测模式的两种 notes、配置错误字面量、ast.parse 和失败原因、CPython 的逐级查找、from/相对导入/自边、去重。另加 --literal-dynamic，把字面量的 import_module/__import__ 单独报出来，不算边。

校验：A-20 恰好 12 条边、8 条没解析，原因逐条和草稿一致，files 22；A-21 六例全对，含根的顺序那例。另有我先手算期望值的 X1–X6 共 18 例，合计 24 例全过。另用 CPython 的 find_spec 在自己写的夹具上核对绝对名字，结论一致；只有 .pyi 不同，这是规则有意的。我故意给错期望，检查脚本能报出不符。

冒烟：本机现成的 dist-packages（不是下载的项目），8,532 个文件单进程 25.2 秒、最大常驻 262 MB，0 失败。运行时机制的实例：os.path、six.moves 共 31 处被判成“是模块，不是包”。动态字面量 255 处，其中 101 对 (from,to) 是静态边里没有的。

规则上看到 8 处可疑或有歧义的地方，见 ruleIssues。

**keyNumbers**

校验 24 例 / 0 不符（A-20 1 例、A-21 6 例、自加 X 17 例）。A-20：edges 12、unresolved 8、files 22、parsed 22。A-21-1：files 5、parsed 4、2 条边。CPython 对照：20 个名字中 .py 的结论全部一致，3 个只有 .pyi 的名字按规则有意不同。冒烟 /usr/lib/python3.12：581 个文件、1.63 秒、45 MB、2,309 条边、701 条没解析（13 条 os.path）、字面量动态 6 处、非字面量 39 处。冒烟 /usr/lib/python3/dist-packages：8,532 个文件、25.2 秒、262 MB、原始引用 106,928、去重后边 38,477、没解析 18,873（null 18,855；six 相关 18）、单文件最慢 0.21 秒、超过 20 秒的 0 个、列表外异常 0 次；字面量动态 255 处，163 处解析到文件，103 对 (from,to) 中 101 对静态边里没有；非字面量 152 处。按这个速度，120 秒的整门语言限时约够 4 万个文件（NDJSON 往返的开销没量）。

**ruleIssues**

1. 相对导入要不要用“和标准库重名”这条，草稿有歧义。原文是“`from .a.b import n`：在起点目录里找 `a`，之后同 `import a.b`，再照 `from X import n`”；照字面，包里有个没 `__init__.py` 的 json/ 目录时，`from .json import y` 会得到 `命名空间目录和标准库重名`。可相对导入的名字是带包名的，标准库遮不住它。原型只对绝对名字的第一段用这条（X2 例）。建议写明“只用于绝对导入”。
2. 相对导入里的“点号全名”没定写法。原文是“原因 `<到这一段为止的点号全名> 是模块，不是包`（如 `a.b 是模块，不是包`）”，相对导入时可以写成带点的写法 `.mm`，也可以写成绝对名 `rel.mm`。原型用带点的写法。dist-packages 里真遇到了 `.packages.six 是模块，不是包`、`..packages.six 是模块，不是包`，共 9 处。
3. 只有 `__init__.pyi` 的起点目录前后不一致。原文是“`from . import n` 的 `X` 就是起点目录（有 `__init__.py` 时是正规包，否则当只有这一个目录的命名空间包）”；但查找规则里 `d/n/__init__.pyi` 算正规包，模块名那句也写的是 `__init__.py(i)`。原型把 `__init__.pyi` 也当正规包（X2 例 stubpkg/m.py → stubpkg/__init__.pyi）。照字面读的话，这里会变成没解析、原因“命名空间包，没有文件”。
4. 结尾带 `/` 的根会被去掉，这条规则可疑。原文是“用不了的查找根去掉、写进 notes：绝对路径；含 `..`、`\`、`:`、`$`、`~`、`*`、`?` 或空段”。`extraPaths: ["src/"]` 在 pyright 里能用，这里因为有空段被去掉，经它的引用全部静默变成没解析，只多一条 note（X2 例的 `lib/`）。今天的代码 python-source-query.py:29 也这样拒。另外“含 `..`”到底是按子串还是按段算没写明；原型照今天的代码按段算。
5. `pyrightconfig.json` 是 JSONC 的问题。草稿把 JSON 解析不了定为 `配置错误：pyrightconfig.json 解析不了`，整门语言失败、一条边都没有；可 pyright 本身接受注释和结尾逗号（X4h 例）。真实项目里有写注释的。
6. 运行时塞进 sys.modules 的子模块会被判成“是模块，不是包”：`import os.path`（13 处）、vendored six 的 `from six.moves import …`（18 处）。静态上这个原因没错，但运行时这些导入都成功，原因文字读起来像代码写错了。规则没给已知限制。
7. 没有 Python 文件时遇到坏配置，草稿没说怎么办：根上有一个解析不了的 pyproject.toml、却没有认领的 .py 时，Python 要不要 `failed`（files 0）。原型照样读配置、照样失败。
8. `[tool.setuptools] package-dir` 里空包名那一项的值不是字符串时（如 `{"" = 1}`），草稿没有对应的字面量。原型把它当成用不了的根，note 里写它的 JSON。

**proposals**

1. 已知限制加一条：运行时才出现的导入抓不到，包括往 sys.modules 塞子模块（os.path）、装 meta path importer（six.moves）、importlib.import_module/__import__ 的名字不是字面量、插件和 entry point、运行时改 sys.path（如 Django 的 tests/runtests.py 把 tests/ 放上 sys.path，测试里 `from model_forms.models import …` 这种绝对导入）。
2. 已知限制加一条（按规则推出，没实测）：多包仓库只读根上的配置。每个子目录一个 setup.py/pyproject.toml 的仓库（如 ROS 2 ament_python 包 `demo_nodes_py/demo_nodes_py/…`）里，包内的绝对导入从根 '.' 找下去，第一段会落到外层的命名空间目录，多半没解析（原因 null）。
3. 没有扩展名的 Python 脚本不被认领（如 bin/ 下带 shebang 的脚本），里面的导入看不到，写进工具说明。
4. 给生产的测试加一例带 BOM 的 .py：内核的 TextDecoder 会去掉 BOM，所以今天没事；但 ast.parse 遇到带 U+FEFF 的字符串会报 `SyntaxError: invalid non-printable character U+FEFF`，执行器或内核哪天改了，这一例能抓住。
5. 去掉根之前先去掉结尾的 `/`（ruleIssue 4），或者在 note 里写明是因为写法被去掉的。
6. 决定一下要不要读 JSONC 形式的 pyrightconfig.json，例如去掉注释和结尾逗号再 json.loads；不读的话写进已知限制。
7. 给测运行时依赖的 agent 用：静态边和 dynamic.sites 用 edgePairsNotInStaticEdges 比，就是“只在运行时出现”的那部分。Django 这类项目还有点号路径字符串的依赖（INSTALLED_APPS、MIDDLEWARE、import_string('a.b.C')、include('app.urls')），原型不收，要量的话由测量 agent 另写（需要时可以照 resolve_import 的规则对到文件）。
8. 原型是单进程、在进程内跑的，dist-packages 8,532 个文件 25 秒。生产要经 §11.5 的执行器逐文件发 start/done，合入前按 §11.7 用真实执行器在一个真实 Python 项目上再量一次时间。

## libuv — measurement

**project**

libuv

**reportPath**

D:/cc-lead-notes/impl/s8d/measure-runtime/libuv/report.md（没写入：子 agent 环境不让写报告文件。全文在这次回复的正文里，请调用方存到这个路径。数据在同目录的 data/，脚本在 D:/cc-lead-notes/impl/s8d/measure-runtime/scripts/）

**summary**

量了 libuv 1.48.0：官方包 SHA-256 7f1db8ac…59fb，没和官方摘要比对；只配置不构建，445 条数据库条目、441 个编译单元。按第四稿规则跑原型，三种布局；再和 libclang+系统头文件、GCC 13 的 gcc -E -H 对照，并清点运行时依赖。
结果：认领 354 个，249 parsed、0 failed、105 skipped；边 475 条，和真编译逐条相同；441 个单元读到的项目文件都和 GCC 一致。R2lex 零误判（预处理类 0，语义 71,384）。
平台判断多，但读哪些头文件由目标自带的宏决定；约 169 组分支因缺系统头文件走得不同，只有 1 组含 #include，目标是系统头文件。真正丢的是只在别的平台编译的 71 个文件，加单独子项目 docs/code 的 34 个，约 199 对引用、34 个目录对，src/win 整个是孤点；借邻近参数再扫一遍补回 196 条。
运行时依赖（登记表 576、起子进程 46、数据文件 10、链接 3 对、dlopen/dlsym 45）在模块层几乎都连着，缺在文件层。
规格问题：退路找到自己时原因误导、notes 的 git 说法、git 命令不能加 --directory、-idirafter 和原型的表不一致。

**keyNumbers**

- 下载 1,314,877 字节、513 个成员。
- 配置约 4 秒；数据库 445 条，230 个源文件，211 个各出现 2 次，4 个出现 3 次。
- 编译单元 441（去重去掉 4 条，主文件不在材料里 0）。
- 认领 354 个（.c 316 / .h 38，106,135 行）。
- A、B 两种布局：parsed 249 / failed 0 / skipped 105。C 布局：认领 355、skipped 106，多出 CMakeCCompilerId.c。
- 边 475；A、B、C 三种布局逐条相同。
- 没解析 613：null 612（全是系统头文件，58 种，带引号的 0）；尖括号退路 1；宏 0；拼写 0。
- notes 只有 1 条近似说明；不认识的参数 0。
- 项目文件里的诊断：语义 71,384、语法 28、预处理 0；引用诊断：找不到 12,872、退路 432；445 条里 435 条有非引用错误。
- light 时间：p50 10–12 ms，p95 12.7–15.1 ms，最长 15.6–30.2 ms；共 4.5–5.4 s；进程峰值 89.6 MB。
- reference：p50 44.9 ms，共 20.4 s。gcc -E -H：共 10.5 s。
- 和真编译对照：
  - 项目指令 1,089 对 1,090；
  - 项目内的边 475 = 475；
  - 指令差 2 处：errno.h:25 退路（429 个单元）、thread.c:41（系统头，2 个单元）；
  - 读集合不同的单元：0/441（对 reference）、0/441（对 gcc）；
  - 跳过区间不同 270（145+125），约 169 组、23 个文件，含 #include 的 1 组。
- 只在别的平台编译的 71 个：src/win 33、src/unix 29、include/uv 7、test 2；另有 docs/code 34。
  - 按文本数的 #include 204 行 → 199 对，其中 124 对的目标在别处 parsed；
  - 新的目录对 34 个；轻型扫描本身只有 13 个目录对。
- 平台实验：linux +196 边（读到 97/105 个文件，0 失败，1.2 s）、win +200、darwin +197，并集 201。
- 运行时清单：
  - dl_load 15（字面量 11，项目内 1）；dl_sym 30（28，1）；
  - 登记表 576（对上 553，189 对文件，文件对已有边 0，目录对已有边 553）；
  - 起子进程 46（21 个名字，8 对文件，目录对都已有边）；
  - 数据文件 10（4 个目标，0 对已连）；
  - 链接 3 对目标（test→src/unix 缺）；生成头文件 0；回调 18；环境变量 5；Python 1；ROS 类 0。
  - 真正带来新目录对的约 4 种。
- 失败、超时、崩溃：0。

**ruleIssues**

1. 尖括号退路的原因在“退路找到的是写这条指令的文件自己”时会误导。include/uv/errno.h:25 #include <errno.h>：441 个编译单元里有 429 个出这条诊断，真编译指向 /usr/include/errno.h。第四稿记 `尖括号引用只能按引号规则找到`，看起来像项目靠引号规则，其实只是系统头文件没读到。CMake 的 26 处里 14 处也是这样（CMake 自带 libuv 的 uv/errno.h，417 个单元）。不连边是对的；建议这种情形原因记 null。
2. notes 的 `近似：只读工作区里 git 不忽略的头文件` 在不在 git 里的工作区说错了。实测布局 C（不在 git 里，build/ 在工作区里）：按第十节的跳过名单，build/ 进了材料，构建目录里的文件也被读到，多出一个认领的 CMakeCCompilerId.c，它是 skipped。libuv 没有生成的头文件，所以边没变；有 cmConfigure.h 这类文件的项目会变。
3. §11.4 的“施工时实测”：git 2.43.0 上，`git ls-files --others --ignored --exclude-standard -z -- ':(glob)**/compile_commands.json'` 能列出被 /build/ 忽略的 build/compile_commands.json；加 --directory 时只返回 `build/`。规格要写明不加 --directory。
4. -idirafter 不一致：第四稿把它列进“照用”，又说参数表“照实测原型 light_include_scan.py:70–151 原样搬”。原型其实把 -idirafter 放在忽略表（include-paths 一类，带 1 个值），照用表里没有它；lead 新加的几项里也没写。三个实测项目都没用到，要施工前定。
5. C/C++ 没写“自己到自己不记边”，Python（§11.3）写了。libuv 里唯一的自指来自退路，第 1 条能处理；故意包含自己的文件（X 宏）没有量到。建议三种语言统一。
6. 原因 `没有编译单元包含它` 不算错，但含义混在一起：libuv 的 105 个 skipped 里，71 个是只在别的平台编译的源文件和头文件，34 个是没进根数据库的单独 CMake 子项目 docs/code。读观测的人分不出哪些是平台或子项目没进图。
7. 〔推算，没跑〕docs/code/CMakeLists.txt 自己设了 CMAKE_EXPORT_COMPILE_COMMANDS ON。用户也配置它的话，工作区里会有两个不在根上的数据库，照第四稿整门 C/C++ 失败，原因 `有多个编译数据库`。已知限制只写了 colcon/catkin，应该加上嵌套的独立 CMake 项目。

**proposals**

1. 实测确认，可以补进 §11.4：(1) R2lex 的零误判现在来自 3 个项目。libuv 441 个单元，预处理类错误 0，语义 71,384；换 Windows、Darwin 目标的 258 次扫描也是 0。(2) 默认 x86_64-pc-linux-gnu 目标下，441 个单元读到的项目文件和 GCC 的 gcc -E -H 完全一致。(3) 条件编译：约 169 组分支走得和真编译不同，只有 1 组含 #include（src/unix/thread.c:40–42，__GLIBC__ 下的 <gnu/libc-version.h>，目标是系统头文件），项目内的边 0 处不同。(4) 没有生成的头文件时，构建目录在外、在被忽略的 build/、不在 git 里三种布局，边逐条相同。
2. 已知限制，写进工具说明：只按一个平台读。只在别的平台编译的文件是 skipped，它们的引用不进图。libuv：71 个文件、约 199 对引用、34 个目录对，src/win 整个目录没有边。
3. 已知限制：嵌套的独立 CMake 项目（例子、第三方子项目）会产生第二个数据库，和 colcon 同类，整门语言是 `有多个编译数据库`。也写明：没进根数据库的子项目，文件都是 skipped，原因 `没有编译单元包含它`。
4. 已知限制：轻型扫描永远按 clang 的预定义宏读（__clang__、__has_feature），和用 gcc 的真编译可能走不同的分支。libuv 的 src/unix/internal.h:45–47 就是这种写法，这次内层条件为假，没有差别。
5. notes（可选）：加一条只数源文件的，例如 `<n> 个源文件（.c/.cc/.cpp/.cxx）没有编译单元`（libuv 是 86 个），让 agent 一眼知道有平台或子项目没进图。
6. 以后做：第二遍扫没被读到的源文件。借同一顶层目录里一个编译单元的参数，用默认目标，或按文件名猜的平台目标，边标成近似，notes 写一句。libuv 实测：Linux 目标补回 196 条边、读到 97/105 个文件、0 个失败、1.2 秒；Windows 目标 +200；Darwin +197；并集 201，按文本估计是 199。风险：借来的参数可能让分支走错。
7. 以后做：按构建目标的“链接到”关系。数据库每条的 output（CMakeFiles/<目标>.dir/…）不用另跑就能把编译单元分到目标（libuv 有 5 个目标）。目标之间的链接要 CMake File API 的 codemodel-v2：配置前放 query 文件，由 agent 用命令工具跑。libuv 是 3 对，这样 test→src/unix 就连上了；现在模块层只经 include/uv.h 间接相连，test→src 只靠 3 个白盒测试的 #include "../src/*.c"。
8. 以后做：字面量文件路径。一个字符串按工作区根或所在目录能对到一个存在的工作区文件，就记一条“引用文件”关系。libuv：10 处对到 4 个 test/fixtures 文件，全对，例如 test/test-fs.c:2996、test/test-dlerror.c:28。用词法记号就能做；要防常见名字和格式串的误报。
9. 只记，不做成通用规则：X 宏测试登记表（576 处，*_ENTRY 对 *_IMPL，都在 test/ 内，目录对都已连着）、按名字起子进程（46 处，test-spawn.c:249 到 run-tests.c:130 的分派）。这两种要符号级配对，留给查源码的重型分析器。dlopen/dlsym 共 45 处：真实目标都是系统库、系统符号或用户输入；指进项目的只有 docs/code/plugin/main.c:24/30（initialize 定义在 hello.c:3），库的路径来自 argv，静态定不下来。uv_dlopen 是给用户用的 API。
10. Python 按字符串加载的模块：docs/src/conf.py:41 sys.path.insert 加 :51 extensions=['manpage']，指向 docs/src/sphinx-plugins/manpage.py。Python 的轻型扫描看不到这条，和 Django settings 的点号路径同类，建议一起定，以后再做。
11. 规模观察：211 个源文件因为共享库、静态库两种参数各扫两次，两次的指令和跳过区间逐个相同，约 48% 的时间是重复的。按第四稿这是对的，这个规模（约 5 秒）不用改；更大的项目再考虑按（文件内容、相关宏）缓存。

## libuv — independent check

**project**

libuv

**summary**

同意报告的结论。我用自己的方法重算：GCC 13 的 -E -dI（带系统头，441 个单元，8.7 s；解析和找头文件是我自己写的，13,994 次进入头文件都和 GCC 一致）得到项目内的边 475 条，和轻型扫描逐条相同。项目指令 1,089 对 1,090，只差 thread.c:41；没解析 613（null 612、退路 1、58 种、带引号 0）；读到的文件不同的单元 0/441；A、B、C 三种布局逐条相同；失败、超时、崩溃都是 0，项目文件里的预处理错误也是 0；手读 33 条边、15 条没解析，全对；重跑一次原型，结果相同。没编译的 105 个和平台实验（+196/+200/+197，并集 201）对上。运行时：登记表我数出 586 条（报告 576）；起子进程 46/21/8、数据文件 10/4、链接 3 对相符；这些依赖在文件层一对边都没有，在目录层只新增 4 个目录对；手读 12 处，除 ## 拼出的名字外，分类都一致。check.md 没写（子 agent 不允许写报告 .md），数据在 libuv/check-data/。

**discrepancies**

1. 数据库重复的写法不准：报告写“211 个各出现 2 次，4 个出现 3 次”，实际是 207 个出现 2 次、4 个出现 3 次、19 个出现 1 次（211 是出现不止一次的总数），207×2+4×3+19=445。230 个源文件、去重去掉 4 条、剩 441 个单元都对上。
2. 登记表少数了，也少配了：报告是 576 条、对上 553、189 对文件。我数出 586 条，多出来的是 test/benchmark-list.h 里 10 条 BENCHMARK_HELPER（例如 :96 ping_pongs→tcp4_echo_server）。报告里 23 个“没对上”的名字（ping_udp1/10/100、udp_pummel_*、udp_timed_pummel_*）是 benchmark-ping-udp.c:160 和 benchmark-udp-pummel.c:223 的 X(...) 宏用 ## 拼出来的，读源码就能定下，所以 586 条全部对上，共 192 对文件。这些对落在的目录对都是 (test,test)，已经有边，结论不变。
3. dl_load 是口径问题，不是错：15 处里有 6 处是 GetModuleHandleA（拿已经加载的模块，不是加载，例如 src/win/winapi.c:58）。真正加载的调用是 9 处（dlopen、uv_dlopen、LoadLibraryExW/A），字面量 11 = 5 + 6。项目内 1 处（test/test-dlerror.c:40 通过局部变量指向 test/fixtures/load_error.node）对上。dl_sym 30 处对上；报告的 28 个字面量里算进了 src/unix/fsevents.c:541 宏里 #symbol 字符串化的那一处。
4. 数据文件：test/test-fs.c:3000 还有一处字面量 "test/fixtures" 指向目录本身，报告没计。按文件计 10 处、4 个目标，和报告一致。
5. 环境变量 5 处只算了 src/ 里窄字符的 getenv/uv_os_getenv。把 test/ 的 14 处（例如 test/runner.c:241 UV_TEST_TIMEOUT_MULTIPLIER、test/run-tests.c:202 ENV_TEST）和 src/win/process.c:997、:1006 的 GetEnvironmentVariableW(L"PATH") 算上，共 21 处。这些都不指向项目里的文件，不影响结论，但报告应写明口径。
6. 跳过区间“约 169 组”复现不出来：270（145+125）和 23 个文件对上，但原脚本 uv_branchdiff.py 没有定义怎么分组；我把同一文件里重叠的区间合并，得到 81 组。含 #include 的组里，真正分支不同的只有 src/unix/thread.c:40–42，和报告一致。另外 include/uv/errno.h 22–477 整段也不同，原因是轻型扫描走尖括号退路、errno.h 包含了自己，第二次进入时被守卫的部分整段跳过。这不是分支差别，也不影响边。
7. 时间上界偏低：B 布局 441 个单元合计 5.51 s（445 条记录合计 5.55 s），高于报告“共 4.5–5.4 s”的上界。另外，A-light 和 rep2 用 /usr/bin/time 测的墙钟是 3.74 s 和 2.55 s，反而小于单进程按单元合计的 5.45 s 和 4.50 s，说明这台 WSL 上 /usr/bin/time 的墙钟不可信（报告没有引用这个数）。我的重跑：脚本自报 5.42 s，按单元合计 4.85 s，p50 10.7 ms，p95 14.2 ms，最长 25.1 ms，进程最大内存 90,824 KB。
8. 新目录对“约 4 种”要说清：实际有 5 种运行时类别带来新目录对（dl_load、dl_sym、数据文件、CMake 链接、Python），但 dl_load 和数据文件落在同一对 (test, test/fixtures)，去重后是 4 个新目录对：(test, test/fixtures)，那个目录里只有数据文件；(test, src/unix)，来自链接；(docs/code/plugin, docs/code/plugin)，因为 docs/code 根本没编译，按文本数 include 也会出现这一对；(docs/src, docs/src/sphinx-plugins)，来自 conf.py:51 extensions 加上 :41 的 sys.path.insert。
9. 没量的：配置约 4 秒没有重跑（不需要再执行项目内容）；没有重新下载，只对现有的包核了 SHA-256 7f1db8ac…59fb、1,314,877 字节、513 个成员。用 GCC 复核时我只跑了 gcc -E -dI 预处理，没有编译、链接或执行；量测那边当时跑的是 gcc -E -H。

**agree**: True

## ros2-demos — measurement

**project**

ros2-demos

**reportPath**

D:/cc-lead-notes/impl/s8d/measure-runtime/ros2-demos/report.md（没有写入：子 agent 环境拒绝写报告文件，全文在本次回复正文里，请调用方保存到这个路径。同目录已有 light-eval-ref.txt、python-scan.txt、runtime-inventory.txt、runtime-inventory-auto.txt、summary.json、configure-OFF.tsv、colcon-probe.txt、download.log）

**summary**

量了 ros2/demos jazzy（commit 37e25e0d，361 个文件）。16 个 ament_cmake 包逐个只配置不构建，全部成功：兄弟包由 /opt/ros/jazzy 里的同一版本满足，所以没有要跳过的包。15 个数据库合并后，用 C/C++ 原型套第四、五稿规则；Python 原型整仓扫一次、每个包再单独扫一次；最后静态清点话题、服务、动作、launch、组件、class_loader、CMake 链接、rosidl 生成代码和入口点。C/C++：78 个编译单元 0 失败，107/108 个文件 parsed，90 条边和带系统头文件的真编译逐处相同；合计 0.29 秒，真编译 172 秒。但不合并时照草稿整门 failed，原因“有多个编译数据库”（colcon 布局下有 15 个）。Python：整仓 0 条边；包内 4 条导入因为包目录不是查找根而没解析。这个项目的结构几乎都在运行时依赖里：按名字配对的 114 对通信文件 0 对有边，111 对连共享头文件都没有；launch 确认一起跑的 9 对 0 对有边；43 条 launch→节点、25 个入口点、17 处生成接口引用、6 对 package.xml 包依赖全都没有边；21 个包之间 0 条边。名字 103 处里 87 处同文件就能静态得到，12 处要跨文件，4 处只有运行时才知道。pluginlib 0 处。

**keyNumbers**

下载：1 次，ros2/demos jazzy 37e25e0d，361 个文件，不含 .git 2.74 MB，克隆 1.3 秒。配置：16 个包全 rc=0（每个 1.3–9.2 秒），15 个数据库；合并后 176 条：源码 88 条，构建目录 88 条（rosidl 59 + 组件入口 29）；去重 10 条后 78 个编译单元。C/C++：认领 108 个，parsed 107、skipped 1（allocator_tutorial_custom.cpp，只在 Clang<16 时编译）、failed 0；边 90，跨包 0，其中 38 条指向 visibility_control.h；没解析 595，原因全 null：标准库 294、ROS 262、OpenCV 19、libc 5、工作区 rosidl 生成 15、项目头文件 0；尖括号退路、拼写纠正、include 跟宏都是 0；notes 3 条（88 个主文件不在观测文件里、忽略 76 个工作区外目录、近似）；不认识的参数 0。时间：轻型合计 288 毫秒，p50 3.6 毫秒、最长 5.7 毫秒，进程 0.55 秒，常驻 89 MB；参考模式项目内合计 172 秒，p50 1.99 秒，常驻 336 MB。对比：685 处指令差 0，边 90 对 90，未改原型输出相同（3,651 条）。Python：整仓 69 个文件，0 边，252 没解析（ROS 188、标准库 39、第三方 19、工作区包不在查找根下 4、生成接口 2），0.038 秒；单扫 qos 包得 4 边；命名空间误导原因 5 处；importlib 0。运行时：通信调用 103 处（C++ 74、Py 29）；名字来源：字面量 68、同文件常量 5、同文件构造参数 14、跨文件 12、运行时 4；隐式端点 16；名字 43 个，调用处配对 165；通信文件对 114（跨语言 50，跨包 71），有边 0，没有任何路径 111，共享非 visibility 头文件 3；launch 确认 9 对，有边 0。launch：22 个文件 54 个动作，节点动作 46 个全字面量，对到文件 43，有边 0，同包 30。组件：RCLCPP_COMPONENTS_REGISTER_NODE 36 处（指向它们的边 0），生成入口 29，class_loader 8 处在 2 个文件，dlopen 0，pluginlib 0。CMake：自己目标间链接 10 条，有引用路径 6，没有 4（linktime_composition）。rosidl 引用：C/C++ 15 + Python 2，对到 5 个接口文件，有边 0。入口点 25，有边 0。package.xml 包间依赖 6 对，有边 0。colcon 布局探测到 15 个数据库。运行时类别 9 类，有 8 类带来轻型扫描没有的信息（回调登记只在文件内闭合）。

**ruleIssues**

1. §11.4 的“有多个时 failed，原因 有多个编译数据库”：colcon/ament 工作区的标准布局就是每个包一个数据库。在本项目的 colcon 布局副本上，草稿的探测命令 git ls-files --others --ignored --exclude-standard -- ':(glob)**/compile_commands.json' 找到 15 个（colcon-probe.txt），C/C++ 整门失败。而把它们合成一个以后，78 个编译单元 0 失败，边和带系统头文件的真编译逐处相同（685 处指令差 0），合计 0.29 秒。这条限制挡住的是一个能完全做对的情形；用户自己的 SLAM 工作区也是这种结构。
2. §11.4“工作区里有 CMakeLists.txt 时”有歧义：ros2/demos 根上没有，16 个都在子目录。照提示 cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON 或 colcon --cmake-args 生成，得到的是每个包一个数据库，下一步就落到上一条的失败。
3. §11.3 的查找根只从根上的配置来，没有配置时是 . 和 src。ROS ament_python 包把 setup.cfg、setup.py 放在包目录，整仓扫时包内的绝对导入全部没解析，原因 null：quality_of_service_demo/rclpy/quality_of_service_demo_py/{deadline,incompatible_qos,lifespan,liveliness}.py 的 quality_of_service_demo_py.common_nodes，共 4 处；单独扫这个包就是 4 条边。原因 null 让人误以为是外部包。
4. §11.3 的“命名空间包，没有文件”只对标准库同名做了特例。单独扫一个 ROS 包时，包自己的 launch/ 目录里放着 .py，没有 __init__.py，于是 from launch import LaunchDescription 读作“命名空间包，没有文件”：lifecycle_py/launch/lifecycle_demo_launch.py:15、lifecycle_py/test/test_lifecycle.py、topic_monitor/launch/depth_demo_launch.py:17 等，共 5 处。真实 CPython 里 launch 是 /opt/ros 下的正规包，正规包优先于命名空间部分。同一批文件里 import launch.actions 却是原因 null，前后不一致。第四、五稿对这一句的结果相同。
5. §11.4 的 note“<n> 个编译单元的主文件不在观测的文件里”在本项目是 88，把两种很不一样的东西算在一起：59 条是 rosidl 生成的源文件；29 条是 rclcpp_components 生成的可执行入口 node_main_<exe>.cpp，正是 launch 的 executable= 和源码里组件类之间唯一的连接。不算错，但看 note 的人不知道漏的是什么（是否细分交 lead 定，倾向写进已知限制）。
6. 没有发现问题、作为第三个项目佐证的：R2lex 0 误判（参考模式里 3 条 config_logger.hpp 找不到，是因为只配置没生成，也不让文件失败）；参数表不认识 0 个（-Wpedantic、-std=gnu99 都照用）；去重正确去掉 10 条（common_nodes.cpp、utils.cpp 各编译 6 次）；默认目标加上后结果不变；工作区外的 76 个目录忽略后项目内的边 0 丢失；skipped 原因“没有编译单元包含它”正确。

**proposals**

1. 已知限制（写进工具说明，不进每次的 notes）：ROS 2 和类似框架的进程间依赖都不是边，包括话题、服务、动作、参数和生命周期服务，launch 启动的节点，组件、class_loader、pluginlib 的加载，CMake 链接，rosidl 从 .msg、.srv、.action 生成的头文件和模块。在 ros2/demos 上：114 对按名字通信的文件、43 条 launch→节点、25 个入口点、17 处生成接口引用都没连上，21 个包之间 0 条边。
2. 数据库：若暂不改，已知限制里点名“colcon 工作区默认是每个包一个数据库”，并给出合并办法（实测完全正确）。若改：多个数据库都在同一个被忽略的构建根下、一层一个子目录时（build/<包>/compile_commands.json），按路径排序拼接，照现有规则去重，note 记“合并了 <n> 个编译数据库”；CMake 那句提示改成“根上或子目录有 CMakeLists.txt”，有 package.xml 时提示要合并。
3. Python 命名空间原因：第一段只找到命名空间部分、而且要的名字在里面找不到时，读作没解析、原因 null；或者把标准库那条推广成“只找到同名的命名空间目录”。这样 from launch import … 和 import launch.actions 一致。这种情形写进已知限制：单包工作区里有和外部包同名的 launch/、test/、config/ 目录。
4. Python 多包仓库（以后做）：把有 setup.py、setup.cfg 或 ament_python package.xml 的目录加作查找根；或者对“第一段是工作区里某个有 __init__.py 的目录、但不在查找根下”的没解析给原因“工作区里的包不在查找根下”。本项目能补 4 条边。
5. 以后可以静态抓 1：rosidl 接口映射。头文件 <包>/<msg|srv|action>/<snake>.hpp（还有 .h 和 __struct.hpp 等变体）、Python 的 <包>.msg|srv|action，在 <包> 是工作区里有 package.xml 的包、对应的驼峰 .msg/.srv/.action 存在时连边。规则确定，几十行。本项目补 17 处、5 个接口文件，并且出现第一批跨包边（pendulum_control→pendulum_msgs，action_tutorials_cpp/_py→interfaces）。
6. 以后可以静态抓 2：入口点和 launch。setup.py（ast 读字面量）、setup.cfg、pyproject [project.scripts] 的 module:func 对到模块文件（25/25）。launch.py 用 ast 读关键字参数的字面量，XML、YAML 照格式读，(包, 可执行或插件) 经入口点、字面量的 add_executable 或 rclcpp_components_register_node(PLUGIN … EXECUTABLE …)、RCLCPP_COMPONENTS_REGISTER_NODE(类) 对到源文件，本项目对上 43/46。CMake 里用变量和函数拼名字的，要靠配置后的 File API 或生成的 node_main_*.cpp。
7. 以后可以静态抓 3：ROS 通信图，作为一种新的关系种类（需要 §11.7 的“引用的种类字段”）：话题、服务、动作名是节点，提供方和使用方连到它，不要直接连成文件对。名字取字面量、同文件常量或同文件构造参数，本项目得 87/103；跟到另一个文件的构造调用再得 12 处。注意：轻型 C/C++ 扫描用了 SkipFunctionBodies，看不到函数体里的 create_* 调用，要另做一遍只读调用的文本或词法扫描。同名端点很多（chatter 7 发 8 收，跨 4 个包），launch 同时启动的才是确定配对（9 对）。
8. 以后可以静态抓 4：package.xml 的 depend、exec_depend 作为包级关系（6 对，读 XML 即可）。CMake 目标间的链接要配置后读 File API（compile_commands.json 没有链接信息），可以和决定 78-3 的“agent 先跑配置、给扫描填参数”放在一起考虑；本项目自己目标间的链接有 4/10 没有引用边。
9. 抓不到也不必抓的，只写进说明：dlopen_composition 从 argv 读库路径；topic_monitor 按正则匹配运行时发现的话题、按命令行参数拼话题名；回调和定时器登记（在同一个文件里闭合）。pluginlib 本项目 0 处，要另找项目量。

## ros2-demos — independent check

**project**

ros2-demos

**summary**

报告的关键数字都复算出来了。C/C++ 用自己的文本解析器加 GCC -M 两种办法核：边 90 条，和原型逐条相同；没解析 595 条；parsed 107、skipped 1、failed 0；78 个单元读到的文件和 GCC 完全一致。Python 自己按 CPython 规则写了解析器，0 边、252 没解析、qos 包 4 边、命名空间误导 5 处都逐条对上。运行时部分：通信调用 103 处、名字 43 个、文件对 114 和报告逐对相同，其中有边 0、完全没有路径 111；launch 54 个动作、对到文件 43 对，入口点 25，组件登记 36 处，CMake 自己目标间链接 10 条（6 条经头文件相连），这些也都对。抽 10 处重新分类，全部一致。另外找到漏项：一个 Python 到 C++ 的参数服务依赖，以及 2 个 /statistics 隐式发布者，补上后文件对 117、完全无路径 114。还有几处口径问题（165 对、172 秒、76 个目录），都不改变结论。check.md 已写到 D:/cc-lead-notes/impl/s8d/measure-runtime/ros2-demos/check.md。

**discrepancies**

1. 漏了一个跨语言、跨包的运行时依赖：demo_nodes_py/demo_nodes_py/parameters/async_param_client.py:28 的 AsyncParameterClient(node, 'parameter_blackboard') 是字面量，连到 C++ 节点 demo_nodes_cpp/src/parameters/parameter_blackboard.cpp:34。报告的“参数客户端 6 处”只收了 C++ 里连自己节点的那几处。这一对没有轻型边。
2. 漏了 2 个隐式发布者：display_topic_statistics.cpp:96-97 打开了话题统计，imu_talker_listener_nodes.cpp:81 和 string_talker_listener_nodes.cpp:70 的订阅会在 /statistics 上发布，topic_statistics_listener.cpp:36 订阅它（报告里是 0 个提供者对 1 个消费者）。补上以后通信文件对从 114 到 116，连同第 1 条一共 117 对，其中完全没有路径的 114 对。
3. topic_monitor 的 7 个 ExecuteProcess 没算进节点动作。它们用字面量参数启动 data_publisher，所以 data_publisher.py:91 那个“只有运行时才知道”的话题名，大半能从 launch 文件推出来。
4. “调用处配对 165”里含 4 对类型不同的（qos_overrides_chatter 2 对，topic_statistics_chatter 2 对），真正通信的是 161 对；文件对 114 已经去掉了这 4 对，两个数的口径不一致。
5. 参考模式“项目内合计 172 秒”算进了 10 条重复条目；按 78 个去重单元是 157.8 秒，p50 1.99 秒不变。轻型的 288 毫秒按的是 78 个单元。
6. notes 里“忽略了 76 个工作区外的查找目录”数的是全部 176 条条目，包括 88 条不解析的；只算解析的 78 个单元是 55 个。草稿 §11.4 没写明算哪一种。
7. “工作区 rosidl 生成 15”这个标签不准：只做了 configure，真编译时 13 条由 /opt/ros/jazzy 里装好的同名包供给，2 条（logging_demo/srv/config_logger.hpp）哪里都没有。数字本身是对的。
8. 定时器回调 34 处只数了 C++，Python 还有 13 处 create_timer。这一类只作记录。
9. matched_event_detect.py:102 和 :123 两处的名字来自构造参数，报告记成了同文件常量。名字来源的合计不变，配对也不变。
10. 报告里“未改原型输出相同（3,651 条）”的口径没找到。我核到的是两版输出的包含记录都是 971 条，边集合和没解析集合也都相同。

**agree**: True

## slam — measurement

**project**

slam

**reportPath**

D:/cc-lead-notes/impl/s8d/measure-runtime/slam/ —— report.md 没有写成：Write 工具拒绝了（“Subagents should return findings as text, not write report files”），我没有绕过去。报告正文放在本次返回的 summary、keyNumbers、ruleIssues、proposals 四个字段里。这个目录里只有数据文件：summary-numbers.json、graph-view.json、py-scan.json

**summary**

测的是用户 SLAM 工作区上次留下的副本：没有下载、没有构建，也没碰 ~/projects。轻型扫描：C/C++ 重跑一次得 86 条边，和上次逐条一致。Python 10 个文件（7 个节点脚本、3 个 launch）全部解析成功，边 0 条；73 条没解析的引用全是外部的（标准库 18 条，ROS 和第三方 55 条），动态导入 0 处。130 个文件里有边的只有 55 个，全是 C/C++；fast_livo2_nav、tb3_fastlivo 两个包在图上完全孤立。运行时依赖：话题/服务/动作的端点 34 处，字面量 28 处，f-string 套字面量列表 1 处，经参数 5 处，定不下来的 0 处。静态能读出的运行时文件对 35 对（话题 13、launch 16、参数文件 6、TF 重复发布 1），其中有轻型扫描边的 0 对。有关系的包对 12 对，有边的 4 对。dlopen、pluginlib、组件、importlib、自定义消息都是 0。按名字配上的 4 对项目代码里，只有 2 对两边真会一起运行。顺带读出几件事：Phase A 有两处发布同一对 TF；两份参数 YAML 各有 3 个键没有代码读；7 个文件没有任何 launch、CMake 或脚本引用。按第四稿的规则，用户平时的 colcon 构建要么不生成编译数据库，要么每包一份，C/C++ 整门失败，这 86 条也出不来。

**keyNumbers**

文件：副本共 130 个；C/C++ 67 个（有边 55 个），Python 10 个（节点脚本 7、.launch.py 3），YAML 9、URDF/SDF 4、rviz 2、CMake 8、package.xml 6、shell 4、md 15、其他 5。按包看“有边/总数”：vikit_common 29/44，fast_livo2_core 20/26，vikit_ros 5/7，fast_livo2_ros 1/10，fast_livo2_nav 0/8，tb3_fastlivo 0/16，根目录 0/19。
轻型扫描：C/C++ light 模式 23 个编译单元全部 ok，墙钟 0.39 s；边 86 条，和 measure-cpp 那次逐条一致；没解析 180 条，其中 14 条是 ROS 接口头（<包>/msg|srv/…）。跨包的边：fast_livo2_core→vikit_common 9、vikit_ros→vikit_common 6、fast_livo2_core→vikit_ros 1、fast_livo2_ros→fast_livo2_core 1。Python：parsed 10/10，没有配置，查找根只有 '.'，原始引用 89 条，边 0 条，没解析 73 条（原因全是 null；标准库 18、外部 55），字面量和非字面量的动态导入都是 0，嵌套的 import 0；扫描内部 0.025 s，进程墙钟 0.06 s，峰值 RSS 17 MB。根换成单个包时：3 个包各多出 1 条原因为“命名空间包，没有文件”的 `from launch import …`。
没解析的原因分布：C/C++ 180 条全 null，Python 73 条全 null（根是单个包时 3 条为“命名空间包，没有文件”）。失败：0 个文件失败，0 次超时，0 次崩溃。
运行时端点：C++ create_publisher 16（全是字面量），create_subscription 5（字面量 1，经参数 4），定时器 1，TF sendTransform 3（帧名是字面量 2、定不下来 1），参数客户端 1，popen 1，system 2，std::bind 回调 6，getParam 70，getRemoteParam 13，ROOT_DIR/DEBUG_FILE_DIR 19 行（往 Log/ 写输出 16、宏定义 1、赋值 1、执行不存在的脚本 1）。Python create_publisher 4（字面量 3，经参数 1），create_subscription 7（全是字面量），服务客户端 1（f-string 展开成 3 个名字），动作客户端 1，TF 1，open 1（路径不是字面量）。配置一侧：桥接表 7 条，Nav2 YAML 3 条话题参数，launch 里的 remap 3 处。dlopen/LoadLibrary 0，pluginlib 0，rclcpp_components 0，importlib/__import__ 0，entry points 0，项目自己的 .msg/.srv/.action/.idl 0，configure_file 0，URDF/SDF 里的 gz 插件 10 处（全在外部）。
launch：Node 18 个（指向项目文件的 4 个，落到 3 个文件；外部 14 个），IncludeLaunchDescription 2 个（项目 1、外部 1），参数文件引用 13 处（7 份不同的 YAML），ExecuteProcess 1 个；launch 指向项目文件去重后 16 对，全能静态对上。
运行时文件对（去重、不分方向）35 对：话题 13、launch 16、参数 6、TF 1，涉及 23 个文件；其中有轻型扫描边的 0 对，在轻型图里连通的 0 对。话题的端点对 20 对，项目代码之间 4 对（两边真会一起运行的 2 对）。包对：有关系的 12 对，有轻型扫描边的 4 对，没边的 8 对；package.xml 里依赖自己包的 9 对，另有 1 处依赖不存在的包 fast_livo。参数 YAML 共 61 键，代码里声明了 58 个，3 个没有代码读；相机 YAML 12 键，12 个都经 vikit 的 getRemoteParam 读。
脚本：D:/cc-lead-notes/impl/s8d/measure-runtime/scripts/slam-01-pyscan.sh、slam-02-pyscan-subroots.sh、slam_runtime_inventory.py、slam_graph_view.py、slam_summary_numbers.py（另外复用了 light_import_scan.py、light_include_scan.py）。原始输出在 WSL 的 ~/dsh-work/measure-runtime/results/slam/（runtime-inventory.json 165 KB、cpp-light.ndjson、py-scan*.json、graph-view.json、summary-numbers.json）。

**ruleIssues**

1. §11.4 编译数据库的选法（第四稿、第五稿相同）：用户平时的构建方式下，C/C++ 一条边也出不来，失败原因里的提示对 colcon 也不对。证据：副本里没有 compile_commands.json；用户的构建命令都不导出（README.md:151、docs/commands.md:29–40、docker/Dockerfile:108、ros2_ws/src/tb3_fastlivo/scripts/auto_test.sh:153）。照规则，这时原因是“没有 compile_commands.json”；“工作区里有 CMakeLists.txt”时换成 cmake 那句。可这个工作区的 6 个 CMakeLists.txt 都在 ros2_ws/src/<包>/ 下，根上一个没有，“工作区里有”指根上还是任何一层，规则没说。就算按任何一层算，给的命令 cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON 对 colcon 工作区也不对：colcon 要用 --cmake-args 加这个参数，生成的是 ros2_ws/build/<包>/compile_commands.json，每包一份（有 C++ 的包至少 4 份），规则会判“有多个编译数据库”，整门语言 failed。实测的 86 条边，来自 measure-cpp/scripts/merge_db.py 把 4 份拼成一份，拼起来以后 0 误判；真实 colcon 布局下跨包的查找目录在被忽略的 install/，还会再丢 9 条（measure-cpp/slam-summary.md 补充 1）。第四稿已把这一条记为已知限制、放进以后做；但对用户自己的项目，它让 C/C++ 整门出不来，不是边角情况。
2. §11.3 第一段只对到命名空间目录时，会把外部包读成“命名空间包，没有文件”。证据：把根设成 tb3_fastlivo、fast_livo2_nav、fast_livo2_ros 中的任何一个包（用户只打开一个 ROS 包的情况），包里的 launch/ 就成了顶层目录，launch/mapping.launch.py、launch/slam_nav_bringup.launch.py、launch/mapping_aviz.launch.py 里的 `from launch import LaunchDescription` 原因都是“命名空间包，没有文件”（3 条，results/slam/py-scan-pkg-*.json）。真实运行时，launch 是 ROS 的正规包（/opt/ros/jazzy/lib/python3.12/site-packages/launch/__init__.py）。按 CPython 的规则，命名空间部分只有在整条 sys.path 上都找不到正规包或模块时才生效，排在后面的外部正规包会赢；而轻型扫描看不到外部包。草稿只给标准库开了例外（“命名空间目录和标准库重名”），对第三方包和 ROS 包没有。根是整个副本、ros2_ws/ 或 ros2_ws/src/ 时不出现这种情况（73 条原因全是 null）。
3. §11.3 的查找根里没有“脚本所在目录”，这一条存疑，这个项目里没有实例。ROS 的 Python 节点是当脚本跑的（CMake install(PROGRAMS)、ros2 run、auto_test.sh:204 的 python3 路径），运行时 sys.path[0] 是脚本所在目录，脚本 import 同目录的另一个文件是能成功的；轻型扫描只用配置算出的根，会把这种引用读成没解析。这个项目的 7 个脚本里一处也没有（73 条 import 全指向外部），漏掉的边是 0。所以只建议记为已知限制；ros2/demos 那份报告可能会有实例。
4. §11.5 的 complete 在这个项目上容易被读错，规则本身没错，问题在说明。证据：Python 覆盖是 edges supported、parsed 10/10、complete: true，边却是 0 条，而这 10 个文件之间通过话题、launch、参数文件全都连着（35 对运行时文件对里，有轻型扫描边的 0 对）。complete 只管解析覆盖，但工具说明里没有一句话告诉 agent 和用户“import 以外的连线不算边”，用户很容易读成“Python 部分没有依赖”。
5. §11.4 的文件层会出现孤点，规则按定义是对的，需要记一条已知限制。证据：fast_livo2_core/src/utils.cpp 不 include 自己的头文件 utils/utils.h，图上一条边也没有。它定义的 convertToIntVectorSafe（声明在 utils.h:15，定义在 utils.cpp:7）在 voxel_map.cpp:554、:631 被调用，两者只靠同一个 CMake 目标连在一起（fast_livo2_core/CMakeLists.txt:57–66）。

**proposals**

1. 已知限制，写进工具说明，不进每次观测的 notes：“边只来自 import 和 #include。ROS 的话题、服务、动作、TF、参数文件、launch 起的进程、CMake 的链接、package.xml 的依赖都不算边；.launch.py 只看它自己的 import。”可以附上用户 SLAM 工作区的数：运行时文件对 35 对，有边的 0 对；有关系的包对 12 对，有边的 4 对。
2. 关于规则问题 1（colcon 多份数据库），两种做法任选：(a) 把“多份数据库合并”提前到这两段里做：按出现顺序拼接各份的条目，(主文件, 过滤后的参数) 相同的去重，也就是 merge_db.py 的做法，实测 23 个编译单元 0 误判、86 条边；另把 install/<包>/include/X 映射回 src/<包>/include/X（依据是 CMake 的 install(DIRECTORY include/ DESTINATION include)），这样能补回真实 colcon 布局下丢掉的 9 条。(b) 至少把原因拆成两句，并写清“工作区里有”指根上：根上有 CMakeLists.txt 时给 cmake 的命令；有 package.xml 或 ros2_ws/src 这种结构时，给 colcon build --cmake-args -DCMAKE_EXPORT_COMPILE_COMMANDS=ON，并说明那样会生成多份数据库、目前还不支持。
3. 关于规则问题 2（命名空间目录和外部包同名），建议把标准库那条例外推广：第一段只找到命名空间部分、后面又没对到任何文件时，原因写 null，或者新加一个字面量，例如“命名空间目录，可能是外部包”；“命名空间包，没有文件”只留给第二段及以后，那时已经能确定是在项目自己的包里。A-20 里的 ns、nsuser.py 两例要跟着重算。不改规则的话，至少写进已知限制。
4. 再记三条已知限制：按脚本运行的 Python（ROS 的 install(PROGRAMS)、python3 路径）import 同目录的文件，会读作没解析；没 include 自己头文件的 .cpp 在图上是孤点，定义和声明之间不连边；ROS 接口头（<包>/msg|srv|action/…）和系统头文件一样读作没解析，项目自己的 .msg 文件不和生成的头连边。
5. 以后可以加的静态层 1，ROS 通信：不执行代码。C++ 识别 create_publisher/create_subscription/create_service/create_client 和 rclcpp_action::create_*：可以在现有 libclang 遍历里加，前提是不跳过函数体，也可以用正则或 tree-sitter 单独扫。Python 用 ast 识别 create_*、ActionClient、ActionServer。参数来的名字取 declare_parameter 的默认值，再取 launch 传进去的 YAML 里的值；然后按 launch 的 remap、命名空间改名，最后按名字配对。SLAM 上 34 处端点的名字全能定下来，配出 13 对文件。必须带上 launch 的上下文（谁被起、哪个阶段），给每条连线标“确定”或“只是名字对上”：项目代码之间按名字配上的 4 对里，只有 2 对两边真会一起运行（lidar_converter.py 和 decompress_images.py 没有任何 launch 起它们）。宜做成单独的一层，不混进 import 的边。
6. 以后可以加的静态层 2，launch 到文件：用 ast 读 .launch.py，XML、YAML 格式的 launch 用解析器读。get_package_share_directory("字面量") 加 os.path.join 可以直接求值；包名对到工作区里的 package.xml；share 下的路径对到 CMake install(DIRECTORY … DESTINATION share/${PROJECT_NAME})；可执行文件名对到 add_executable 或 install(PROGRAMS)，ament_python 的包对 setup.py 的 entry_points。SLAM 上 16 对全部能对上。IfCondition、PythonExpression 这类条件只能读出默认值。
7. 以后可以加的静态层 3，参数文件对代码：把 YAML 里 ros__parameters 以下的键，和代码里 declare_parameter、get_parameter 的字面量名字对起来。项目自己写的读参数助手要另外认，例如这里的 vikit getParam、getRemoteParam。SLAM 上配出 6 对，还顺带找出 3 个没有代码读的键。
8. 以后可以加的静态层 4，包之间的关系：package.xml 的 <depend> 系列，加上 CMake 的 ament_target_dependencies、target_link_libraries（文本解析，或者 configure 之后用 CMake File API）。按路径链接 install/ 里的库要按路径猜包名，例如 fast_livo2_core/CMakeLists.txt:112–113。SLAM 上有关系的包对能从 4 对补到 12 对。另外两个小的：TF 坐标系可以读 sendTransform 附近的 frame_id/child_frame_id 和 static_transform_publisher 的参数，SLAM 上 4 个发布点、1 对重复发布；ROS 接口头 <包>/msg/foo_bar.hpp 可以按 rosidl 的命名规则对回 <包>/msg/FooBar.msg，SLAM 上是 0 处。
9. 给用户的具体结果，都是静态读出来的事实，算不算问题由用户判断。(1) Phase A 下两个进程都发布 TF camera_init→base_footprint：fast_livo2_core/src/LIVMapper.cpp:1626，和 fast_livo2_nav/scripts/ground_truth_tf_broadcaster.py:63（帧名在 :52–53）；slam_nav_bringup.launch.py:97–98 的注释说 Phase B 关掉后者是为了避免 TF 冲突。(2) tb3_fastlivo/config/rover.yaml 的 :53 imu.b_acc_cov、:54 imu.b_gyr_cov、:57 lio.max_iterations 没有代码读；代码读的是 lio.min_iterations（voxel_map.cpp:50、:65），读进来存在 max_iterations_ 里。fast_livo2_ros/config/avia.yaml 的 :50、:51、:54 也一样。(3) 下面这些文件没有任何 launch、CMake 或脚本引用：lidar_converter.py（也没装）、decompress_images.py（mapping_aviz.launch.py:75–76 说已改用 image_transport republish）、lifecycle_transition.py、tb3.yaml、tb3_waffle_gz.urdf.xacro、tb3_world.sdf、octomap_only.rviz。(4) tb3_fastlivo/package.xml:17 依赖 fast_livo，工作区里没有这个包。(5) LIVMapper.cpp:245–255 用 system() 执行 ROOT_DIR/scripts/colmap_output.sh，这个文件不在项目里。(6) 跨节点读参数：LIVMapper.cpp:204 传进节点名字面量 "parameter_blackboard"，经 camera_loader.cpp:21 和 params_helper.h:115 的 SyncParametersClient，去读外部节点 parameter_blackboard 上的参数；这个节点在 mapping.launch.py:126 起，加载 camera_tb3.yaml。
10. 用户在架构图上会看到和看不到什么：能看到的只有 C++ 库一层层怎么编起来的，86 条边、4 对包：vikit_common 被 vikit_ros 和 fast_livo2_core 用，fast_livo2_core 用 vikit_ros 的相机加载，fast_livo2_ros/src/main.cpp 只连到 LIVMapper.h。前提是编译数据库能用，见规则问题 1。看不到的是整条运行链：Gazebo 桥接 →（/livox/lidar、/livox/imu、/camera/image_color）→ fastlivo_mapping →（/cloud_registered）→ pointcloud_to_octomap.py →（/cloud_in_converted）→ octomap_server；fastlivo_mapping 的 /aft_mapped_to_init 给 Nav2 和 auto_mapping_route.py；mapping_controller.py 发 /cmd_vel 给桥接；哪个 launch 起了哪些进程、用了哪份参数。7 个 Python 节点、3 个 launch、9 份 YAML、URDF/SDF、rviz 在图上全是孤点，Python 覆盖却显示 complete: true。
11. 这次实测的局限：只有一个很小的 ROS 2 项目（23 个编译单元、10 个 Python 文件），节点都用绝对话题名，没有命名空间、组件、插件 XML，所以这几类全是 0，不能代表别的 ROS 项目，要看 ros2/demos 那份。运行时清单是我写的正则加 ast，没有跑 ros2 launch --print，也没起任何节点；remap 的方向、“两边是否真会一起运行”是我手工判的。C/C++ 的失败规则、注入和时间都没重量，用的是 measure-cpp 的数字。用户真实仓库里有没有 ros2_ws/build/*/compile_commands.json，我没去看：规定不能碰 ~/projects。

## slam — independent check

**project**

slam

**summary**

复核 slam：我在同一份副本上用自己写的脚本重算，没有下载任何东西，关键数都对得上。C/C++ 用纯文本解析器重算，86 条边和原型逐条相同，跨包边也相同。没解析的引用按 (from, 说明符) 去重是 179 条；报告写 180，是按“文件:行”数的。Python 的数全部相同：10 个文件、原始引用 89 条、没解析 73 条（标准库 18、外部 55）、0 条边。运行时各类计数也都复现：C++ 发布 16、订阅 5、TF 3，getParam 70，launch 里的 Node 18 个等。抽 10 处手工重新分类，全部一致。35 对、涉及 23 个文件、0 对有轻型边或在轻型图里连通，我都复现了。但这在结构上是必然的：两端都是 C/C++ 的一对也没有，有 19 对两端都不在轻型图里。另有 7 对（shell、rviz、URDF）没有算进去，算上共 42 对，仍是 0 条边。原型重跑一次，23/23 都 ok，0 个文件失败。check.md 没有写（子 agent 不能写报告文件），复核正文在本次返回里。

**discrepancies**

1. 没解析的个数口径不同：报告写 180 条，那是按“文件:行”数的；照 §11.5 按 (from, 说明符) 去重是 179 条。差的 1 条是 IMU_Processing.h 在第 17 行和第 22 行各写了一次 `#include <fstream>`。
2. 我用自己写的纯文本解析器重算（走所有条件分支，不用 libclang）：边 86 条，和原型逐条相同；跨包边 9/6/1/1 也相同；有边的 C/C++ 文件 55 个，按包是 vikit_common 29/44、fast_livo2_core 20/26、vikit_ros 5/7、fast_livo2_ros 1/10，其余为 0，都相同。没解析的我算出 181 条，比原型多 2 条，两条都在不生效的分支里：LIVMapper.h:20 的 `<cv_bridge/cv_bridge.hpp>`（`__has_include` 那一支），以及 vision.cpp 里 ARM 分支的 `<arm_neon.h>`。180 条没解析的引用里，没有一个说明符的路径结尾或文件名能对上项目里的文件，所以没有因为去掉工作区外查找目录而丢掉的项目内边。ROS 接口头 14 处，全是外部包。
3. “35 对”是 4 类相加得 36 对、再去重得到的。重复的一对是 slam_nav_bringup.launch.py ↔ pointcloud_to_octomap.py：它既是 launch 起执行文件的关系，又经 octomap 的 remap 成为 /cloud_in_converted 的话题关系。报告没有写出这一步。
4. 35 对只算了话题、launch、参数、TF 四类。照同样的静态读法，还有 7 对没算，其中 shell 3 对、rviz 2 对、URDF 2 对：auto_test.sh 分别到 mapping_controller.py（:204）、auto_mapping_route.py（:260）、slam_nav_bringup.launch.py（:163、:247）；fast_livo2.rviz、octomap_only.rviz 订阅的话题对到 LIVMapper.cpp 的发布；rover_4wd_gz.urdf.xacro（:227/:258/:269/:300）和 tb3_waffle_gz.urdf.xacro 的 gz 话题对到 gz_bridge.yaml。这 7 对也都没有轻型扫描边。算上它们共 42 对，结论不变。
5. “35 对里有轻型边的 0 对、在轻型图里连通的 0 对”我复核成立。不过这在结构上是必然的：35 对里两端都是 C/C++ 的一对也没有。19 对两端都不在轻型图里，因为 Python 的 10 个文件 0 条边，YAML 和 launch 文件不参加 include 扫描；另外 16 对只有一端（LIVMapper.cpp、voxel_map.cpp、camera_loader.cpp、main.cpp）在轻型图里。这个项目里 pluginlib、rclcpp_components、dlopen 都是 0，所以这次没有测到“C++ 之间存在、include 看不见的运行时依赖”这种情形；这要靠 ros2/demos 那一份来测。
6. 静态话题图里有按自带配置不会生效的端点。LIVMapper.cpp:278 订阅 /ground_truth/odometry，只在 common.use_gps 为真时才建；rover.yaml 和 avia.yaml 都没设这个参数，默认是 false。:271 和 :273 两个订阅二选一，由 preprocess.lidar_type 决定：rover.yaml:32 是 0，走 :273；avia.yaml:29 是 1，走 :271。项目代码之间的 4 对里有两对不会真跑：lidar_converter.py 不在 install(PROGRAMS) 里（tb3_fastlivo/CMakeLists.txt:11–14），它订阅的 /livox/lidar_raw 也没人发；decompress_images.py 已被 mapping_aviz.launch.py:77 的 image_transport republish 取代。所以真会一起运行的是 2 对，和报告一致。
7. 这些数对配对的定义很敏感。我第一遍按名字直接配对，得到话题文件对 23、参数对 7，原因有三：一是把 rover/avia/tb3.yaml 里 LIVMapper 自己的 *_topic 参数当成了外部节点的话题端点；二是把 octomap_server.yaml 的 frame_id 和 mapping_controller.py 声明的 frame_id 参数配成了一对，其实两个节点毫不相干；三是没有按节点分开 nav2_params.yaml，两处 odom_topic 和代价地图里的 /livox/lidar 被合并掉了。改成“参数文件只和装载它的节点的代码配对；外部节点的话题键按节点分开”以后，才得到 13 和 6。报告的数用的就是这种按节点的读法，但没有把规则写出来。以后实现时如果按名字直配，就会出假对。
8. 报告概要里的定时器只写了 C++ 的 1 个，漏了 Python 的 create_timer（mapping_controller.py:235）。原始清单里有这一条，只是概要没写。
9. getParam 70 复核成立。口径是调用点：camera_loader.cpp 66 处、params_helper.h 4 处，不算模板定义和字符串里的词。如果按这个词出现的次数数，是 77。参数 YAML：rover.yaml 和 avia.yaml 各 61 个键，代码声明了 58 个（LIVMapper.cpp 47、voxel_map.cpp 11），没有代码读的 3 个是 imu.b_acc_cov、imu.b_gyr_cov、lio.max_iterations；两份相机 YAML 各 12 个键，12 个都经 camera_loader.cpp 的 getRemoteParam 读。远端节点名 "parameter_blackboard" 在 LIVMapper.cpp:204 是字面量，隔一层调用传进来。
10. 把单个包当根时，3 个包各多出 1 条原因为“命名空间包，没有文件”的引用，我复核相同。不过这条引用实际要的是 ROS 的外部包 launch，只是被包里的 launch/ 目录挡住了。原因字面量会让人以为问题出在项目里的目录上；没有因此连出错边，只是提示有误导。可以考虑：第一段只找到命名空间部分、后面的名字在里面又找不到时，原因写成“可能是同名的外部包”。
11. 包对的关系我复核相同：有关系的 12 对，有轻型边的 4 对，没边的 8 对；package.xml 里依赖自己包的有 9 处，另有 tb3_fastlivo/package.xml:17 依赖不存在的 fast_livo。补充一点：这 8 对里有 3 对只能从运行时关系看出来，package.xml 和 CMake 里都没写，是 core–nav、core–tb3、ros–tb3。另外 5 对写在 package.xml 或 CMake 里但没有 include 边，比如 fastlivo_mapping 的 ament_target_dependencies 里有 vikit_common 和 vikit_ros，而 main.cpp 并不包含 vikit 的头文件。
12. 失败和时间：我把原型重跑了一次，23 个编译单元全部 ok，86 条边和原来一致。项目文件里属于 Lexical or Preprocessor 类、严重度 Error 及以上、又不是“找不到文件”的诊断，一条也没有，所以“0 个文件失败”成立。Python 的 10 个文件用 3.12 的 ast.parse 全部解析通过。超时和崩溃都是 0。时间上：C/C++ 扫描器内部 0.35 s，进程墙钟 0.44 s，峰值 RSS 约 90 MB；Python 进程墙钟 0.07 s（跑了 3 次），峰值 17 MB，两次输出完全一样。和报告的 0.39 s、0.06 s 在同一量级。
13. 【说明，不是差异】按要求本该写 check.md，但我没有写：子 agent 不能写报告文件，测量方之前写 report.md 也被 Write 工具拒绝了。复核正文就在本次返回里。数字写成了数据文件 D:/cc-lead-notes/impl/s8d/measure-runtime/slam/check-numbers.json。我自己写的脚本：D:/cc-lead-notes/impl/s8d/measure-runtime/scripts/check_slam_include.py、check_slam_py.py、check_slam_runtime.py、check_slam_view.py、check_slam_sample.py、check_slam_numbers.py。原始输出在 WSL 的 ~/dsh-work/measure-runtime/results/slam-check/（include-check.json、py-check.json、runtime-check.json、sample.txt，还有两份原型重跑的输出）。我没有下载、构建或安装任何东西，也没有写入 ~/projects。

**agree**: True

## django — measurement

**project**

django

**reportPath**

没有写成 D:/cc-lead-notes/impl/s8d/measure-runtime/django/report.md：harness 不让子 agent 写 .md 报告（Write 返回“Subagents should return findings as text”），报告内容放在本输出的各个字段里。摘要数据在 D:/cc-lead-notes/impl/s8d/measure-runtime/django/：scan-summary.json、classify-root.json、crosscheck-root.json、crosscheck-testsroot.json、crosscheck-sensitivity.json、runtime-inventory.json、structure.json、wiring-sample.txt、scan-time-1..3.txt。脚本是 D:/cc-lead-notes/impl/s8d/measure-runtime/scripts/ 下的 dj_*.py 和 dj-0*.sh。原始输出在 WSL 的 ~/dsh-work/measure-runtime/results/django/。下载的源码在 ~/dsh-work/measure-runtime/src/django/tree/django-5.1.15/。

**summary**

测的是 Django 5.1.15：PyPI 上的 sdist，10,719,662 字节，SHA-256 与 PyPI 一致，只解开、不安装。
扫描结果：用原型按第四稿扫了 2,788 个 .py（文件头现在是第五稿，§11.3 的改动在 Django 上碰不到）。选中 pyproject.toml，查找根只有“.”，notes 为空。解析成功 2,787 个，失败 1 个，是 Django 故意放的语法错误文件。边 8,369 条。没解析 2,500 条：标准库 2,278、第三方 194、只在运行时 sys.path 下的项目文件 23，其余 5 条。一遍约 3 秒，占 74 MB。
核对：用 CPython 自己的查找器把全部引用独立重算一遍，边和没解析逐条一致；另随机各抽 30 条手查，全对。
运行时依赖：Django 库里 importlib 43 处、import_string 41 处，名字都不是字面量，所以收字面量 importlib 加不出一条边。决定加载谁的是这几类：
- 点号字符串：1,337 处，合成 715 对文件，其中 469 对既无边又不同目录；抽查 30 处，28 处对；
- 目录约定（commands、migrations、templatetags 等）；
- 模板；
- 迁移依赖：110 对，没有一对有边。
结构：django/ 下 44% 的文件没有内部入边。281 对“加载方→被加载方”里只有 10 对有边；到目录层，98 对只有反方向的边，134 对完全没有边。

**keyNumbers**

- **下载：** Django 5.1.15 sdist，10,719,662 B，sha256 46a356b5…eb947（与 PyPI 一致）。解开后 6,834 个文件。认领的 .py 2,788 个（django/ 880、tests/ 1,905、docs/ 3），.pyi 0 个，跳过 0 个，符号链接 0 个。
- **配置：** 根上有 pyproject.toml 和 setup.cfg，选 pyproject.toml，查找根只有“.”，notes 为空。
- **扫描：** parsed 2,787，failed 1（tests/test_runner_apps/tagged/tests_syntax_error.py:11，`SyntaxError: invalid decimal literal`，Django 故意写的）。原始引用 17,646 条。
- **边 8,369：** django→django 3,006、tests→django 4,562、tests→tests 800、docs→django 1；同一 (文件, 说明符) 既有边又有没解析的 0 处。
- **没解析 2,500：** 原因 null 2,499，“相对导入越过了顶层包” 1（测试数据）。分类：
  - 标准库 2,278；
  - 第三方 194（30 个名字）；
  - 测试里故意写的不存在名字 3；
  - 只在运行时的 sys.path 下才有的项目文件 23：tests/ 是 sys.path[0] 的 17 条，加 extend_sys_path 或 docs/conf.py 的 6 条；
  - `__main__` 1；
  - 越过顶层包 1。
- **时间和内存：** 三遍分别 3.48、3.14、2.99 秒（墙钟 3.0–3.5 秒），最大常驻 74 MB；最慢单文件 0.083 秒；超过 20 秒的文件 0 个。三遍结果完全相同。
- **CPython 对照：** 用 PathFinder 全量重算，边 8,369/8,369、没解析 2,500/2,500 一致。灵敏度检查：把 tests/ 也当根时差 19 条。手查边 30/30、没解析 30/30（27 条标准库、3 条第三方）全对；和项目有关的 38 条没解析逐条看过。子模块被包属性遮住的真实分歧 0 处；第四、五稿有差别的写法 0 处。
- **动态导入：** importlib/`__import__` 共 75 处：字面量 27 处（全在 tests/），用“.”根对上 6 处、加 tests/ 根对上 15 处；非字面量 46 处，其中 django/ 41 处；另有 2 处名字是字面量但 package 不是。django/ 里的 43 处全部不是字面量。import_string 44 处：django/ 41 处全不是字面量，tests/ 3 处是字面量。
- **点号字符串（接线上下文）：** 1,337 处（django/ 88），对上 1,281 处（其中 662 处只在 tests/ 根下对上），去重 715 对：文件边 58、反向边 2、同目录 152、目录边 154、只有反向目录边 19、无任何边 296、自己指自己 34。抽查 28/30 准确。
  - django/ 自己 70 对：文件边 2、同目录 26、目录边 12、只有反向目录边 17、无任何边 10、自己 3。
  - global_settings.py 的 24 处点名 17 个文件，一条文件边都没有。
  - settings.py-tpl 有 27 处，对上 24 处，指向 20 个目标。
- **不算依赖的同形字符串：** logger 名 23 处、mock.patch 目标 216 处、断言等其他 923 处。
- **app_label.Model：** 395 处，对上 203 处，去重 81 对：文件边 28、无任何边 35。
- **迁移依赖：** 135 项（字面量 133），对上 115 项，去重 110 对：文件边 0、同目录 100、无任何边 10。
- **按约定发现的模块**（django/ 里，没有任何入边的数 / 总数）：commands 23/34、contrib 的 migrations 23/23、templatetags 4/12、apps.py 13/15、admin.py 3/5、db 后端 base.py 1/6、locale formats 84/84。
- **模板：** `{% load %}` 80 处 117 个库名，全部对上，django/ 模板→templatetags 88 对；extends/include 178 处，对上 142 处，其中 96 处有多个候选；Python 里写的模板名 598 处（django/ 104 处，对上 99 处）。
- **其他：**
  - 入口 1 个（[project.scripts]）；
  - 改 sys.path 33 处，另有 tests/ 当 sys.path[0] 这一处隐式的；
  - ctypes 8 处（字面量 3）；
  - 函数里的 import 482 句，轻型扫描都收了（只靠它们的文件对 216 对）；
  - TYPE_CHECKING 0 处，模块级 `__getattr__` 1 处；
  - `.connect(` 187 处、`@receiver` 33 处、`register(…)` 346 处。
- **结构：** django/ 880 个文件，内部边 3,006 条，其中 971 条（32%）指向 `__init__.py`；全部边里 3,719 条（44%）指向 `__init__.py`。
  - 枢纽：conf/`__init__` 163、core/exceptions 157、utils/functional 112、db/models/`__init__` 108。
  - 没有内部入边 388 个（44%），算上 tests/ 的边也有 314 个。这 388 个里，运行时接线能解释 218 个，包标记 `__init__.py` 135 个，给用户代码用的 API 或只在用户设置里点名的 35 个。
  - 281 对“加载方→被加载方”：有文件边（方向不论）10 对。目录层：同目录 26、同向目录边 13、只有反向 98、完全没有边 134（48%）。组件层（42 个组件）：新的只有 6 对，只有反向的 106 对。
- **核对脚本自身耗时：** 运行时清单脚本约 8–10 秒，占 667 MB。

**ruleIssues**

1. §11.3 的对法没有发现错。证据：dj_crosscheck.py 用 CPython 的 importlib.machinery.PathFinder 独立重算全部引用（每一级显式给目录、只传最后一段名字、不执行任何 __init__.py），8,369 条边、2,500 条没解析和原型逐条一致；“from X import n 时 X/__init__.py 把 n 绑成别的东西”的真实分歧 0 处（14 个候选都是包自己导入同一个子模块，例如 django/db/models/__init__.py:2 from django.db.models import signals）；第四、五稿不同的 from <命名空间包> import 在 Django 里 0 处。失败原因 'SyntaxError: invalid decimal literal'（tests/test_runner_apps/tagged/tests_syntax_error.py:11）是 Python 3.12 给的，换版本文字会变，§11.3 已允许。
2. “不用、写进 notes”里的 include、exclude、ignore 没写是哪张表的，有歧义。证据：Django 的 pyproject.toml 有 [tool.setuptools.packages.find] include = ["django*"]。今天的代码 scripts/python-source-query.py:60 只在 pyright 表里看这三个字段，原型照代码，notes 是 []。施工时若读成“任何地方的 include”，会多出一条 'pyproject.toml 里观测不用的字段：include'。建议写明“[tool.pyright]（或 pyrightconfig.json）的”。
3. 只在运行时才有的查找根，规则里表达不了；硬加成全局根又会出错。证据：Django 配置里没有任何查找根，而 tests/runtests.py 是当脚本启动的，tests/ 就是 sys.path[0]。因此 17 条项目内的引用读作没解析，例如 tests/i18n/test_extraction.py:11 from admin_scripts.tests import …、tests/select_for_update/tests.py:5。另有 6 条来自 extend_sys_path（tests/proxy_model_inheritance/tests.py:25/:28）和 docs/conf.py:32 的 sys.path.append。把 tests/ 当全局第二个根试过（dj_scan_variant.py）：多出 19 条边，17 条对，2 条错——docs/conf.py→tests/sphinx/__init__.py、docs/_ext/djangodocs.py→tests/sphinx/__init__.py，因为测试目录 tests/sphinx 遮住了真正的 Sphinx。
4. 没解析的原因只有 null，分不清标准库、第三方和“项目文件、只在运行时的根下”。证据：2,500 条里标准库 2,278 条（91%），第三方 194 条，项目在运行时根下的 23 条，原因全是 null；正式比较和 agent 都分不开。草稿没有写错，但按 L7，几乎每个 Python 模块的缺失依赖都会成为 unknown（§11.7 已经记为已知限制）。
5. 下面两条是设计如此的效果，不是错，但应写进工具说明。(1) 中间各级的 __init__.py 不加边：django/ 里 135 个包标记 __init__.py 成了孤立节点，例如 84 个 django/conf/locale/<语言>/__init__.py；而 CPython 每导入一个子模块都会先执行它们。(2) 从包导入名字时，边指向包的 __init__.py（决定 78-2）：内部边 971/3,006（32%）、全部边 3,719/8,369（44%）落在 __init__.py 上，门面包成了枢纽（django/db/models/__init__.py 有 108 个导入者）。
6. 原型自己的小细节，不影响规格：--literal-dynamic 把 import_module(".management", app_config.name) 记成“字面量处”，原因是“动态：package 不是字面量”（django/core/management/commands/flush.py:48、migrate.py:110）。统计时应算作非字面量；本报告已经这样算了。

**proposals**

1. 已知限制（写进工具说明，不进每次的 notes），共六条。(a) 名字由数据决定的动态加载不进边：Django 库里 importlib/__import__ 43 处、import_string 41 处，全部不是字面量，例如 django/core/management/__init__.py:48、django/db/utils.py:113、django/contrib/sessions/middleware.py:15。(b) 按目录约定发现的模块常常没有入边，“没有入边”不等于没用：django/ 里 commands 23/34、contrib 的 migrations 23/23、apps.py 13/15、locale formats 84/84 没有入边。(c) 模板等非 Python 文件里的引用不进边：{% load %} 80 处、extends/include 178 处，Python 里写的模板名 598 处。(d) 运行时改 sys.path 带来的查找根不进，包括“脚本所在目录就是 sys.path[0]”。(e) ctypes 加载的本机库不进：8 处，例如 django/contrib/gis/gdal/libgdal.py:69。(f) 包标记 __init__.py 成孤立节点、门面包成枢纽（见规则问题第 5 条）。
2. 不建议在观测里收字面量的 importlib。Django 库里 0 处；测试里 27 处，用配置的根只对上 6 处，加 tests/ 根也只对上 15 处。原型的 --literal-dynamic 留作测量工具就够了。
3. 可以考虑加一个原因字面量“标准库”：第一段在 sys.stdlib_module_names 里时给它。§11.3 已经用这个列表判“命名空间目录和标准库重名”，成本几乎为零，能把 Django 的 2,500 条没解析里 2,278 条和真正对不上的分开。要改 §11.5 的原因表和 A-20 的期望，请 lead 定。
4. 以后可以把“字符串路径引用”当一种单独的引用种类静态地抓（接决定 78 “引用的种类字段”那条“以后做”）。抓什么：大写设置的赋值、override_settings/modify_settings 的参数、BACKEND/ENGINE/NAME/loaders/context_processors/libraries/MIGRATION_MODULES 的字典值、include()/import_string()/import_module() 的字面量参数、AppConfig.name。怎么对：按 §11.3 对到模块，或对到“模块 + 它顶层绑定的名字”。Django 上的量：1,337 处，对上 1,281 处，合成 715 对，其中 469 对现在既无边又不同目录；抽查 30 处 28 处对。成本是同一次语法树遍历加查表。必须有上下文白名单和“顶层绑定”核对，否则 logger 名（23 处）、salt、写进生成代码的文字（inspectdb.py:16 db_module）会混进来。项目模板 settings.py-tpl 不是 .py，要另认。
5. 迁移依赖（Migration.dependencies 的字面量元组）可以算作字符串引用的一种：Django 上 133 项，对上 115 项，110 对里现在 0 对有边。跨应用的例子：django/contrib/flatpages/migrations/0001_initial.py:6 → django/contrib/sites/migrations/0001_initial.py。
6. 框架约定加载（commands、migrations、templatetags、apps.py、admin.py、locale formats）靠目录名就能列出，但这是 Django 专属的知识。建议只在“以后做”里写一句“框架约定（可选、按框架开关）”，不进这两段。Django 模板的 {% load/extends/include %} 用正则就能抓，但 142 处 extends/include 里有 96 处有多个同名候选，谁生效要读设置，不建议现在做。
7. 运行时查找根：以后让 agent 按子目录补查找根，思路同决定 78-3 给 C/C++ 填参数；补的根只对那个子目录下的文件生效。在 Django 上就是“tests/ 只给 tests/ 下的文件用”，能补回 17 条边，又不会出现 docs→tests/sphinx 那 2 条假边。也可以读 pytest 的 [tool.pytest.ini_options] pythonpath 这类静态写下的路径，但 Django 没用 pytest，这一条没在 Django 上量过。
8. 可选：在 notes 里加一句计数式的近似说明，例如 '<n> 处动态导入的名字不是字面量'（Django 是 69 处 importlib 加 41 处 import_string），让读的人知道图不完整。这是新的字面量，要改 §11.5 的 notes 列表；也可以只写进工具说明。请 lead 定。
9. 这次测不了或只是近似的部分，供 lead 判断：没有真的运行 Django 去记录实际导入，因为规则不允许执行下载的代码；“接线”上下文分组、app_label 表（对上 51%）、模板目录都是启发式的；用的是原型，没走 §11.5 的执行器，生产执行器要另量；只在 Python 3.12 上跑；sdist 不是 git 仓库，决定 77 的 git 清单那一支没走到。

## django — independent check

**project**

django

**summary**

报告的主要数字都复现了，判为一致；分歧集中在少数口径上。我按第五稿 §11.3 自己写了一个解析器（不用原型和对方的脚本），在同一份 Django 5.1.15 上全量重算：认领 2,788 个文件，解析 2,787 个；唯一失败是 tests_syntax_error.py:11，Django 故意写的；原始引用 17,646 条，边 8,369 条，没解析 2,500 条。和原型逐条比，边、没解析、原因都是 0 差别；加上 tests/ 根后是 8,388/2,481，也是 0 差别。没解析的分类、动态导入 75 处（27/46/2）、import_string 44 处、接线点号字符串 1,337 处去重 715 对及七类分布、django/ 内部 70 对、约定模块 7 项、结构数（3,006、971、388、314、218/135/35）都复现了。原型重跑一遍 3.28 秒、74 MB，结果相同。抽查 10 个运行时站点，10 个都对。主要分歧：281 对加载关系里，20 对来自 settings.py-tpl（模板文件，不是 .py），8 对来自写得太宽的 models 规则；去掉后目录层无边是 107/253（42%），不是 48%，其中 84 对是 locale formats 这一种机制，组件层新增只有 4 对。另有几处口径问题：216 对 vs 188 对、@receiver 实为 24 处、迁移的 135 项里含 replaces 21 项、第三方名字是 29 个。check.md 没有写，因为子 agent 不允许写 .md 报告，内容都在本输出里。

**discrepancies**

1. check.md 没有写：系统规则不允许子 agent 写 .md 报告（量的那个 agent 也碰到同一条），核对内容都放在本输出里。我的脚本在 D:/cc-lead-notes/impl/s8d/measure-runtime/scripts/，文件名是 check_django_edges.py、check_django_unres.py、check_django_runtime.py、check_django_extra.py、check_django_struct2.py。原始输出在 WSL 的 ~/dsh-work/measure-runtime/results/django/check/。用的是同一棵树，没有重新下载。
2. 加载方→被加载方的 281 对里有 28 对不该算。(1) 20 对来自 django/conf/project_template/project_name/settings.py-tpl：这是模板文件，不是 .py，轻型扫描本来就不读，它所在的目录也没有任何边。(2) 8 对来自写得太宽的“models 模块”规则，它匹配到的这些文件都不是 AppConfig.import_models 加载的：django/db/models/__init__.py、django/forms/models.py、django/db/migrations/operations/models.py、django/contrib/gis/db/models/__init__.py，以及 gis 下 base、oracle、postgis、spatialite 四个后端的 models.py。真正的 app models 只有 7 个，都是“有 apps.py 的目录”。去掉这 28 对后剩 253 对：文件边 10 对、同目录 26 对、同向目录边 13 对、只有反向目录边 97 对，目录层完全没有边 107 对。107/253 是 42%，不是报告的 134/281（48%）。这 107 对里 84 对是同一种机制：locale formats，由 django/utils/formats.py 加载 django/conf/locale/<lang>/formats.py。其余是 templatetags 12 对、点号字符串 10 对、dummy 后端 1 对。组件层新出现的是 4 对，不是 6 对；只有反向的是 80 对，不是 106 对。
3. 函数里的 import：216 对是函数里的 import 产生的全部文件对，不是报告说的“只靠它们的”。只能靠函数里 import 得到的文件对是 188 对，其中 django/ 内部 158 对。轻型扫描都收这些，所以结论不变。
4. “@receiver 33 处”的口径不对：33 是名字叫 receiver 的调用总数。真正的 @receiver 装饰器有 24 处，另外 9 处是别的 receiver(...) 调用，例如 django/dispatch/dispatcher.py:189 和 :306 是在调用接收者，不是注册。
5. “迁移依赖 135 项”其实是三种写法加在一起：dependencies 113 项（含 swappable 2 项、__first__ 一类 4 项）、replaces 21 项、run_before 1 项。所以叫“迁移依赖”不准。我只看 */migrations/*.py 里的 dependencies，用自己的跨 app 解析，得到 98 对：文件边 0、同目录 83、无任何边 13。报告是 110 对：同目录 100、无任何边 10。差别来自跨 app 标签的解析方法不同。“迁移文件之间从不互相 import、文件边是 0”这一点两边一致。
6. 第三方 194 条引用对得上，但名字是 29 个，不是 30 个。classify 输出里的 30 个名字含 3 个测试故意写的不存在名字：DoesNotExist、non_existent、a_package_name_that_does_not_exist。另外要加上 redis 和 jinja2：它们被同名的项目文件挡住，例如 django/core/cache/backends/redis.py 和 django/template/backends/jinja2.py。我自己的分类是：标准库 2,278；没有对应项目文件的非标准库 184；有同名项目文件的 18（第三方同名 11、__main__ 1、运行时 sys.path 下的项目文件 6）；只有把 tests/ 当根才对得上的 19（tests/ 17 条，加上 docs/ 的 sphinx 2 条，这 2 条其实是第三方）；越过顶层包 1。重新组合后与报告的 2,278 / 194 / 3 / 23 / 1 / 1 一致。
7. 模板 {% load %}：我在全树用自己的正则数，去掉 docs/ 后是 78 处、115 个库名（django/ 57 处 88 个，tests/ 21 处 27 个）。报告是 80 处、117 个，差 2 处，没有追查是哪两处（两边认定模板目录的范围不同）。extends/include 178 处两边一致（django/ 118 处，tests/ 60 处）。Python 里写的模板名 598 处我没有复核。
8. “接线上下文”的点号字符串，绝对数取决于怎么定义接线上下文。用报告自己的站点表，我用自己的解析和连接判定重算，这些数逐项一致：1,337 处，对上 1,281 处，其中 662 处只有加 tests/ 根才对上，去重 715 对，七类分布 58/2/152/154/19/296/34，django/ 内部 70 对。我另用一条更窄的规则：只收大写设置名的值，include/import_string/import_module/get_callable/load_backend 的参数，以及 AppConfig 的 name/default_auto_field/compiler_module。这样得到 1,171 处，对上 934 处，去重 488 对，其中无任何边 188 对（38.5%，报告是 41.4%）；django/ 内部 47 对，无任何边 6 对（报告是 70 对、10 对）。比例上的结论稳定，绝对数不稳定。
9. 报告没有拆开 296 对“无任何边”。拆开后：tests→tests 145 对（其中 144 对只有把 tests/ 当根才对得上），tests→django 141 对，django→django 10 对。另外 137 对的目标是 __init__.py。例如 INSTALLED_APPS 里写 'django.contrib.auth'，运行时实际还会加载 apps.py 和 models.py，把目标记成 __init__.py 只是近似。所以“296 对新信息”里有 286 对在测试代码里。
10. global_settings.py 的 24 处点名 17 个文件、文件边为 0，这几个数都对。但 global_settings.py 本身一条 import 都没有，出边是 0，所以“一条文件边都没有”是这个文件本来就这样，说明不了轻型扫描漏了什么。这 17 对里 16 对是只有反向目录边：目标所在的目录 import 了 django/conf。
11. 运行时接线能解释的 218 个文件，我用自己的原因表重算也是 218 个；剩下的 __init__.py 135 个、其他 35 个也一致。补两点：(1) 218 个里有 15 个只有 tests/ 里的点号字符串能解释。报告的“dotted string in tests/ 29”是按排序取第一条原因来计的，口径不同。(2) 那 35 个“给用户代码用、只在用户设置里点名”的文件里，有 4 个 django/contrib/gis/db/backends/{mysql,oracle,postgis,spatialite}/base.py，它们其实也是 load_backend 按 ENGINE 加载的。只是报告的 db 后端规则只看 django/db/backends/，没有算到它们。
12. ctypes 8 处（字面量 3 处）是对的。我先用粗规则数到 10 处，多出的 django/template/defaulttags.py:1091 和 :1097 是模板标签库的 find_library，不是 ctypes。sys.path 我数到 34 处，多出的 django/test/utils.py:771 是 extend_sys_path 在 finally 里恢复 sys.path 的赋值，和报告的 :767 在同一个函数里，不算分歧。
13. 抽查 10 个运行时站点：目标文件和连接类别 10/10 正确，其中 8 个在 tests/，和总体以 tests/ 为主一致。tests/sites_tests/tests.py:78 是 modify_settings(INSTALLED_APPS={"remove": "django.contrib.sites"})，意思是去掉这个 app，算成依赖不贴切。django/ 内部 10 对“无任何边”我逐条看过，都是真实的运行时接线，例如 django/test/utils.py:858 → django/template/backends/django.py，django/views/debug.py:29 → django/templatetags/i18n.py，django/contrib/gis/apps.py:7 → django/db/models/__init__.py。但 django/db/utils.py:150 指向的是 django/db/backends/dummy/__init__.py，运行时真正加载的是 dummy/base.py。

**agree**: True
