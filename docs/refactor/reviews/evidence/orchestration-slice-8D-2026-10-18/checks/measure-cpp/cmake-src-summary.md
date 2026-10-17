# CMake 3.30.5 源码（cmake-src）上的 C/C++ 轻型 `#include` 扫描实测

2026-10-17，Claude 子 agent 量的。数据库里 1,064 个编译单元三种模式全跑完，没有抽样。没有构建、安装或下载任何东西，用户的项目一个字节都没改。

## 先说结论（只说数据）

- **真实代码上的假失败**（CMake 能编译，所以 light 模式标成失败的全是假的；主文件在源码树里的 1,053 个编译单元，读到 1,969 个文件）：
  - R0：0
  - R1：1,450（74%）
  - R2：12（全是 `#error`）
  - R2lex：0
  - R3：0
- **注入真错误的检出率**（30 个目标，错误放在文件自然的位置）：
  - R0：light 模式 0/30，light-bodies 模式 1/30。原因是每个编译单元前 1–5 条 `#include` 里就有一条找不到，R0 把之后的错误全部原谅。
  - R2 和 R2lex：只检出“没收尾的 `#if`”，10 个全中，大括号和函数体里的错一个也没检出。
  - R1：22 个目标不注入也已经失败，所以说不出它检出了什么。
  - 函数体里的乱码在 `SkipFunctionBodies` 下完全看不见：409 次编译单元运行，0 次报错。
- **错误不影响边。** 50 个注入案例 × 2 种模式 = 100 次运行，目标文件发出的边和没注入时逐条相同。
- **系统头文件缺失，边几乎不变。** 构建目录可见时（场景 B），light 模式和真编译只差 22 条指令：
  - 1 条是由系统宏决定的条件分支；
  - 21 条是 clang 的“尖括号找不到、改用引号规则找到”造成的**错边**。真编译器没有这种退路。
- **构建目录不在工作区，是边差别的主要来源**（场景 A，CMake 的默认情况）：
  - 745 处指令没解析；
  - 509 处指令级的边和真编译不同（A 场景一共差 529 处，另外 20 处是上一条说的错边）。原因是 `curl_config.h`、`cmConfigure.h` 这类 configure 生成的头文件读不到，靠它们的宏决定的分支走向就变了。
- **时间。** 单进程 45.7 秒做完 1,053 个编译单元：每个编译单元 p50 26 ms，最长 157 ms；进程内存 72 MB 涨到 118 MB。20 秒超时和崩溃都是 0 次。

## 怎么量的

**项目和数据库。** 来自准备代理的报告：
- 源码：`~/dsh-work/measure-cpp/downloads/cmake-3.30.5/cmake-3.30.5`
- 构建目录（在源码树外）：`~/dsh-work/measure-cpp/build/cmake-3.30.5`
- `compile_commands.json` 有 1,064 条

**两个场景。**
- **A（主场景，接近生产）：** 根目录是源码树。虚拟文件系统里的文件按生产的规则选（`cpp-source-index.ts:7-9`：扩展名 `.c .cc .cpp .cxx .C .h .hh .hpp .hxx .inc .ipp .inl .tcc .def` 加上不带扩展名的；去掉含 NUL 的和超过 2 MiB 的），共 5,168 个、30.8 MB：
  - 5,055 个按扩展名；
  - 113 个不带扩展名；
  - 1 个二进制文件排除。

  根目录外的 `-I` 去掉并记录。11 个主文件在构建目录里的编译单元（6 个测试驱动或 ret0/ret1 文件）记为 `outside_root`，不解析。
- **B（对照）：** 根目录是 `~/dsh-work/measure-cpp`，文件清单是源码树加构建树，共 5,249 个文件（构建树多 42 个源文件和 39 个不带扩展名的文件）。这时 configure 生成的头文件看得见，只剩系统头文件缺失。

**三种模式。** 都用原型 `scripts/light_include_scan.py`，这个场景没有改过它。
- `light`：
  - 选项：`DetailedPreprocessingRecord|Incomplete|SkipFunctionBodies|KeepGoing`；
  - 参数：`-w -ferror-limit=0 -fno-modules -fno-implicit-modules -fsyntax-only -nostdinc -nostdinc++ -ivfsoverlay <vfs>`。
- `light-bodies`：同上，但不跳过函数体。
- `reference`：不跳过函数体，有系统头文件，不用虚拟文件系统，根目录外的 `-I` 保留，另加 `-idirafter /usr/lib/gcc/x86_64-linux-gnu/13/include`。reference 在 A、B 两个根目录下都是 1,064/1,064 成功，项目文件里的错误为 0，可以当作“真编译”。

**规则。** 规则和头文件判定照原型 `evaluate_rules.py`：读到某个头文件的编译单元中，只要有一个没让它失败，它就是 parsed；全部让它失败才是 failed；没有编译单元读到就是 skipped。另外加了一个变体 **R0file**（脚本 `cmsrc_analyze.py`）：只看同一个文件里、这条错误之前有没有找不到的 `#include`，不跨头文件。

**并发和内存。** 每次运行 3 个工作进程，每次都先检查可用内存大于 2 GB，再用 `systemd-run ... MemoryMax=4G` 运行。

**运行清单。** 墙钟时间都是 3 个工作进程下的。

| 运行 | 编译单元 | 结果 | 墙钟时间 |
|---|---|---|---|
| light-A | 1,064 | ok 1,053，outside_root 11 | 24.3 s |
| light-bodies-A | 1,064 | 同上 | 23.2 s |
| reference（根 = 源码树） | 1,064 | ok 1,064 | 117.8 s |
| light-B / light-bodies-B | 1,064 | ok 1,064 | 22.8 s / 25.6 s |
| reference（根 = 源码 + 构建） | 1,064 | ok 1,064 | 101.3 s |
| light-A，单进程不回收 | 1,064 | ok 1,053 | 45.7 s |
| 注入：50 个案例 × 2 种模式 | 981 次编译单元运行 / 模式 | 全 ok | 约 115 s |

## b) 假失败

**数字从哪来。** 对 light-A、light-bodies-A、light-B 每条规则数 failed 的文件，分成四类：
- 主文件：数据库里的源文件；
- 头文件：扩展名 `.h .hh .hpp .hxx .h++ .inl .ipp .tcc .txx .inc .def`；
- 不带扩展名的：`Utilities/std/cm/*`，18 个；
- 其他源文件：没进数据库、但被别的文件包含的 `.c`。

读到的文件：light-A 有 1,046 个主文件、903 个头文件、18 个不带扩展名的、2 个其他源文件，共 1,969 个。

| 规则 | light-A 主/头/无扩展名/其他 | 合计 | light-bodies-A 合计 | light-B（源码树 + 构建树） |
|---|---|---|---|---|
| R0 | 0 / 0 / 0 / 0 | **0** | 0 | 0 |
| R1 | 766 / 665 / 18 / 1 | **1,450（73.6%）** | 1,627（936 / 671 / 18 / 2） | 1,500（源码树 1,485，构建树 15） |
| R2 | 6 / 6 / 0 / 0 | **12** | 12 | 4（1 / 3） |
| R2lex | 0 | **0** | 0 | 0 |
| R3 | 0 | **0** | 0 | 0 |
| R0file | 271 / 148 / 11 / 0 | **430（21.8%）** | 511 | 421 |

### 背后的诊断

**全部错误。** light-A 在项目文件里报出 981,278 条不是“找不到头文件”的错误，分布在 1,016 个编译单元：
- Semantic Issue：930,143；
- Parse Issue：49,990；
- User-Defined Issue（`#error`）：1,145；
- Lexical or Preprocessor Issue：**0**（找不到头文件那一类除外）。

**找头文件的诊断：**
- `missing`：82,403；
- `angled_recovered`：3,859；
- `typo_recovered`：0；
- `macro_unexpanded`：0。

**R1 失败文件的第一条原因（按文件计）：**
- `unknown type name 'X'`：434
- `use of undeclared identifier 'X'`：375
- `no type named 'X' in namespace 'X'`：249
- `no template named 'X' in namespace 'X'`：101
- `no member named 'X' in namespace 'X'`：87
- `redefinition of 'X'`：48

全是系统类型（`size_t`、`std::*`）没有定义的连锁反应。例子：
1. `Source/CPack/cmCPackLog.h:47 unknown type name 'size_t'`
2. `Source/CPack/IFW/cmCPackIFWCommon.h:31 use of undeclared identifier 'std'`
3. `Source/CPack/IFW/cmCPackIFWCommon.cxx:23 no type named 'string' in namespace 'std'`
4. `Source/CPack/IFW/cmCPackIFWGenerator.cxx:55 no template named 'vector' in namespace 'std'`
5. `Source/cmAddTestCommand.cxx:14 no member named 'vector' in namespace 'std'`

**R2 的 12 个全是 `#error`，被缺失的系统宏或 configure 宏触发：**
1. `Utilities/cmcurl/lib/curl_setup.h:515 "too small curl_off_t"`
2. `Utilities/cmexpat/lib/internal.h:122 Compiler did not define ULONG_MAX for us`
3. `Utilities/cmlibarchive/libarchive/archive_platform.h:167 No suitable 32-bit unsigned integer type found for this platform`
4. `Utilities/cmlibarchive/libarchive/archive_read_disk_posix.c:106 fchdir function required.`
5. `Utilities/cmlibarchive/libarchive/archive_write_disk_set_standard_lookup.c:161 No way to perform gid lookups on this platform`

另外 7 个：
- `curl_setup_once.h:167`（sread）
- `nonblock.c:82`
- `select.c:36`
- `transfer.c:56`
- `url.c:59`
- `archive_digest_private.h:34`（"Should have include config.h first!"）
- `cmliblzma/common/sysdefs.h:67`（UINT32_C）

B 场景剩 4 个：`vtls/openssl.c:124 "OPENSSL_VERSION_NUMBER not defined"`、`internal.h:122`、`archive_platform.h:167`、`sysdefs.h:67`。

**R0file 的 430 个**多是一个头文件用了包含它的文件已经引进的类型：
- `unknown type name`：246
- `use of undeclared identifier`：40
- `function cannot return function type`：40
- `redefinition`：27
- `field ... declared as a function`：26

例子：
1. `Source/cmDebuggerSourceBreakpoint.cxx:7 unknown type name 'int64_t'`
2. `Source/CTest/cmCTestReadCustomFilesCommand.cxx:10 use of undeclared identifier 'std'`
3. `Utilities/cmcurl/lib/bufq.c:43 function cannot return function type 'size_t'`
4. `Source/cmAddCompileDefinitionsCommand.cxx:8 redefinition of 'cmAddCompileDefinitionsCommand'`
5. `Utilities/cmcurl/lib/bufq.h:37 field 'dlen' declared as a function`

“之前”不跨头文件算，就会大量误判。

### R0 为什么一个都没判失败（脚本 `cmsrc_analyze.py`，逐个编译单元统计）

**“之前”怎么定义。** 用原型的位置键：从主文件到这个位置，沿途每条 `#include` 的偏移（最外层在前），后面接这个位置自己的偏移，按列表逐项比较。包含链取 `clang_getInclusions` 里每个文件第一次进入的那一条。

**场景 A：**
- 1,053 个编译单元里，1,046 个至少有一条找不到的 `#include`。剩下 7 个没有，这 7 个也都没有错误。
- 第一条找不到的，在 853 个编译单元里是构建目录里 configure 生成的头文件：
  - `cmConfigure.h`：384
  - `config.h`：215
  - `curl_config.h`：168
  - `cmsys/Configure.h`：42
- 在另外 193 个里是系统头文件：`stdio.h` 23、`string` 21、`stddef.h` 20……
- 914 个编译单元里，第一条找不到的在某个头文件里，不在主文件里。
- 它在这个编译单元按预处理顺序排的 `#include` 里位置是：中位数第 1 条（从 0 数），p90 第 2 条，最多第 5 条；92 个编译单元里就是第 0 条。
- 1,016 个有错误的编译单元，**全部**错误都在第一条找不到之后，所以 R0 让 0 个文件失败。

**按位置排和按诊断发出的顺序排：** 约 98 万条错误里两种顺序**没有一处不同**。自测里那种先发出后面的错误、再回头报前面的情况，在 CMake 上没有出现。

**场景 B：**
- 第一条找不到的全是系统头文件，位置中位数第 4 条，p90 第 6 条，最多第 47 条。
- 1,030 个有错误的编译单元里，有 2 个出现了在任何找不到的 `#include` 之前的错误：
  - `Utilities/std/cm/bits/fs_path.cxx`：一条 missing 都没有，错误在 `cm/filesystem:40`。
  - `Source/cmCommands.cxx`：错误在 `cm/memory:22`，排在第一条找不到之前。

  两处都是 `<filesystem>`、`<memory>` 这类尖括号引用被 clang 按引号规则找到了 `cm/` 下的同名文件（见 d）。缺了系统头文件，但没有报成 missing。
- 结果 R0 照样是 0 个文件失败，因为读到这两个头文件的其他编译单元没有让它们失败。

## c) 注入真错误（不改磁盘上的文件）

**怎么注入。** 改过的副本放在 `results/cmake-src/inject/<案例>/`。专门复制了一份扫描器 `cmsrc_inject_scan.py`，加了两个只给实测用的参数：
- `--vfs-override REL=PATH`：在虚拟文件系统里用副本顶替原路径；
- `--tu-indices`：只跑读到目标的那些编译单元。

其余和原型相同。共享的 `light_include_scan.py` 没改，另一个代理在同一个目录里给它加了 `reference-raw` 模式，我没有动它。

**选目标。** 步长固定、确定可重复（`cmsrc_inject.py select`）：
- **15 个主文件：** 1,046 个主文件按路径排序，从第 34 个起每隔 69 个取一个。
- **15 个头文件：** light-A 读到的 903 个头文件按路径排序，从第 30 个起每隔 60 个取一个。
- 三种错误轮流分配，各 10 个。
- “函数体”类的目标要真有函数体，用 libclang 解析读到它的、路径排第一的编译单元来找。没有函数体就顺延到下一个，顺延记录：
  - `cmAlgorithms.h` 跳过 5 个；
  - `cmWindowsRegistry.h` 跳过 3 个；
  - `siphash.h` 跳过 53 个；
  - `heap-inl.h` 跳过 4 个；
  - `vtls.c` 跳过 1 个。
- 头文件被多少个编译单元读到：从 1 到 258 不等。`cmAlgorithms.h` 258、jsoncpp `config.h` 157、`cmGlobalGenerator.h` 131、lzma `index_hash.h` 70、`mem.h` 24，其余 1–12。

**三种错误：**
- **大括号：** 在文件最后一条 `#include` 那一行之后插入一行 `}`（`index_hash.h` 没有 `#include`，插在第 1 行）。
- **函数体：** 在第一个函数体的 `{` 后面插入 `= = 42 garbage ;`。
- **没收尾的 `#if`：** 在最后一条 `#include` 之后插入一行 `#if 1`，后面不写 `#endif`。

另外做了 20 个附加案例：大括号和 `#if` 各 10 个，插在**第 1 行**，用来看 R0 对错误位置有多敏感。

**怎么算“检出”。** 注入后这个文件在该规则下 failed，并且没注入时不是 failed。“已失败”指没注入就已经 failed，说明不了什么。基线取 light-A、light-bodies-A 里同一批编译单元的结果（`cmsrc_inject.py report`）。

### 主要 30 个案例，各规则检出 / 已失败 / 没检出

| 规则 | light | light-bodies |
|---|---|---|
| R0 | **0** / 0 / 30 | **1** / 0 / 29 |
| R1 | 5 / **22** / 3 | 4 / **26** / 0 |
| R2 | 10 / 0 / 20 | 10 / 0 / 20 |
| R2lex | **10** / 0 / 20 | **10** / 0 / 20 |
| R3 | 0 / 0 / 30 | 0 / 0 / 30 |
| R0file | 8 / 4 / 18 | 7 / 7 / 16 |

**按错误种类（light 模式）：**
- **大括号（10 个）：** R0 0；R2/R2lex 0；R1 检出 2、已失败 8；R0file 检出 2、已失败 2。
- **函数体（10 个）：** 没有一条规则检出。R1 已失败 7、没检出 3。注入的错误在 light 模式下**根本不出现**：读到这 10 个目标的编译单元运行共 409 次，新错误 0 次。
- **`#if`（10 个）：** R2 和 R2lex 10/10；R1 检出 3、已失败 7；R0file 检出 6、已失败 1。

light-bodies 模式：
- 函数体错误在 409/409 次运行里都出现了。
- 但 R0 只检出 1 个：`Tests/FindPackageModeMakefileTest/foo.cpp`，它只包含一个项目内的头文件，没有找不到的 `#include`。

**插在第 1 行的 20 个（light）：**
- R0 检出 10，正好是全部 10 个主文件，头文件 0 个。读到头文件的编译单元在包含它之前已经碰到找不到的 `#include`。例如 jsoncpp `config.h` 有 157 个编译单元读到，154 个原谅了这个错误；而头文件要所有编译单元都让它失败才算 failed。
- R2 和 R2lex 检出 10，正好是 10 个 `#if`。
- R1 检出 5、已失败 15。
- R0file 检出 17、已失败 3。

逐个案例的表在 `cmake-src-inject-report.txt`。

**注入的错误不改变边**（`cmsrc_inject_edges.py`）：注入点之后的行号统一加 1 再比较，50 个案例 × 2 种模式共 100 次运行，目标文件发出的边和基线**逐条相同**。

## d) 边

### light-A 的边

- 项目内的边：8,309 对（文件 → 文件），按指令算 8,325 条。
- 项目文件里的 `#include` 指令：12,961 处，其中 8,325 处解析到项目内。
- 在至少一个编译单元里没解析的：4,636 处。

**没解析的，按写法（处 / 不同写法数）：**
- 尖括号：3,930 / 130
- 引号：650 / 24
- 跟宏：56 / 19

**没解析的，按头文件实际在哪：**
- 尖括号，本机系统头文件：3,889
- 引号，构建目录里 configure 生成的：649
- 跟宏，构建目录里的：56
- 尖括号，构建目录里的：40
- 尖括号，本机哪里都没有：1
- 引号，本机系统头文件：1

注：准备阶段用正则把所有分支都算进去，得到“本机哪里都没有”的写法 246 个；只看生效分支，实际只有 1 处。

**对照：**
- **reference：** 8,241 对边、8,254 条指令级的边；5,197 处解析到源码树外（系统头文件和构建目录）；没解析的 0 处。
- **light-B：** 9,049 对，B 根目录下的 reference 是 9,028 对。没解析的 4,478 处，全是系统头文件（尖括号 4,477 处、引号 1 处，共 157 个写法）。

### 跟宏的 `#include`

共 56 处，全是 `Source/kwsys` 里的 `#include KWSYS_HEADER(x)`。libclang 给出了宏展开后的名字，也照常解析：
- B 场景和 reference：56/56 都解析到了；
- A 场景：0/56，因为目标都是构建目录里的 `cmsys/*.h`；
- `expected "FILENAME"`（宏没定义）一处都没有。

草稿里“`#include` 后面跟宏的读作没解析”这条，在 B 场景会丢掉 56 条正确的边。准备阶段数到的 `PLATFORM_CONFIG_H` 123 处都在不生效的分支里。

### 函数体里的 `#include`

整个项目只有 1 处：`Utilities/cmzlib/inflate.c:285 #include "inffixed.h"`。light 模式（跳过函数体）照样记下了它，和 light-bodies、reference 一样。light 和 light-bodies 的边**零差别**。

### light-A 和 reference 的差别

只在 light 里的指令级边 300 条，只在 reference 里的 229 条；按“文件对”算分别是 296 对和 228 对。

分类方法：原型 `evaluate_rules.classify` 先分一类，再拿 B 场景对照。构建目录看得见以后差别还在的，归给系统头文件；差别消失的，归给构建目录。

| 类别 | 只在 light | 只在 reference | 例子 |
|---|---|---|---|
| 由 configure 宏决定的条件分支（B 场景下消失） | 280 | 209 | `Utilities/cmcurl/lib/altsvc.c:31 -> .../curl/curl.h`（只在 light）；`Source/cmMakefile.cxx:73 -> Source/cmDebuggerAdapter.h`（只在 reference） |
| 包含它的文件只经 configure 分支读到（B 场景下消失） | — | 20 | `Utilities/cm3p/bzlib.h:10 -> Utilities/cmbzip2/bzlib.h`，以及 curl `vtls/*.h`、`curl_ntlm_core.h` |
| 尖括号改按引号规则找到的错边（B 场景下仍在） | 20 | — | `Utilities/cmlibuv/include/uv/errno.h:25 <errno.h> -> 自己`；`Utilities/std/cm/optional:13 <optional> -> 自己` |
| 由系统宏决定的条件分支 | 0（A）/ **1（B）** | 0 | B：`cmlibarchive/libarchive/archive_hmac_private.h:85 -> archive_openssl_hmac_private.h`，条件是 `#if OPENSSL_VERSION_NUMBER >= 0x30000000L`，这个宏在 `<openssl/opensslv.h>` 里 |
| `__has_include` | 0 | 0 | |
| 在函数体里 | 0 | 0 | |
| 头文件找不到（构建目录里的 configure 生成物） | A 场景 745 处没解析（引号 649、尖括号 40、跟宏 56），reference 把它们解析到构建目录 | | |

**条件里出现最多的宏：**
- 只在 light：`CURL_DISABLE_SMTP` 58、`CURL_DISABLE_IMAP` 57、`CURL_DISABLE_POP3` 26、`CURL_DISABLE_TFTP` 19、`USE_HYPER` 17、`CMake_HAVE_CXX_FILESYSTEM` 11、`HAVE_SOCKETPAIR` 7、`HAVE_ZLIB_H` 6。
- 只在 reference：`USE_NGHTTP2` 46、`USE_CURL_NTLM_CORE` 32、`USE_OPENSSL` 31、`USE_NTLM` 27、`USE_QUICHE` 21、`HAVE_ZLIB_H` 17、`CMake_ENABLE_DEBUGGER` 5。

**B 场景和 reference 只差 22 条指令：** 1 条系统宏分支，21 条尖括号改按引号规则找到的错边；只在 reference 的 0 条。

**尖括号改按引号规则找到。** clang 对找不到的 `<x>` 会再按引号规则在包含它的文件所在目录里找一遍，找到就照常包含，同时报一条 Lexical 类的 Error：`'x' file not found with <angled> include; use "quotes" instead`。GCC 没有这个退路，所以这样找到的边在真编译里都不存在。
- A 场景：26 处不同的指令（3,859 条诊断），**全部和 reference 不同**。14 处解析到文件自己（例如 `cm/memory:10 <memory> -> cm/memory`），12 处解析到和系统头文件同名的兄弟文件（例如 `cm/memory:14 <type_traits> -> cm/type_traits`）。
- B 场景：21 处，其中 15 处指向自己。

这类诊断还会把缺失的系统头文件藏起来，不算作 missing，影响 R0（见 b 里 B 场景那 2 个编译单元）。

## e) 时间和内存

| 模式 | 每个编译单元 p50 / p95 / p99 / 最长（ms） | 合计 | 每进程峰值内存 | 超时 / 崩溃（20 s） |
|---|---|---|---|---|
| light，单进程不回收 | 26.1 / 111.7 / 131.1 / 156.5 | 43.4 s（墙钟 45.7 s） | 72 MB 起，第 100 个编译单元 98 MB，第 500 个 100 MB，最后 118 MB；峰值 120 MB | 0 / 0 |
| light，3 进程 | 42.7 / 177.9 / 217.1 / 286.4 | 68.5 s（墙钟 24.3 s） | 116 MB | 0 / 0 |
| light-bodies，3 进程 | 41.7 / 172.8 / 210.6 / 279.6 | 65.6 s（墙钟 23.2 s） | 120 MB | 0 / 0 |
| reference，3 进程 | 86.0 / 1,233.5 / 1,583.5 / 1,917.3 | 351.2 s（墙钟 117.8 s） | 266 MB | 0 / 0 |

- 时间是父进程从发出到收到的时间，含进程间通信。3 进程时每个编译单元的时间比单进程长约 60%，是互相争抢造成的。
- 单进程里，解析 p50 20.5 ms、最长 67.6 ms；收集 p50 3.6 ms、最长 53 ms（大部分花在取每个编译单元约 1,000 条错误上）；访问游标合计 1.3 s。
- 跳过函数体在这里省得不多：A 场景 light 合计 68.5 s、light-bodies 65.6 s（反而略快，属于波动）；B 场景 64.2 s 对 72.4 s，light-bodies 多 13%。
- 一个编译单元平均读到 20 个项目文件，最多 152 个。

**推到 2,000 个编译单元（单进程，按平均 41.2 ms 算）：** light 约 82 秒；按 3 进程的单个编译单元时间算约 130 秒。reference 约 660 秒。

**20 秒和 300 秒合不合适：**
- light 最长 0.16–0.29 秒，20 秒的余量在 70 倍以上，只会拦住真卡死的。
- 300 秒按这里的速度大约能做 6,900 个这种规模的编译单元。
- 没量的：生产执行器要经标准输入送 5,168 个文件（30.8 MB），还要搭虚拟文件系统，这部分时间不在上面的数字里。

## f) 头文件

**按评估脚本的扩展名清单，源码树里认领的文件 5,059 个：**
- 1,046 个主文件；
- 1,621 个头文件；
- 2,392 个没进数据库的源文件。

**light-A 下的状态（parsed / failed / skipped）：**

| 规则 | 头文件（1,621） | 主文件（1,046） | 不带扩展名、被读到的（18） |
|---|---|---|---|
| R0 | 903 / 0 / 718 | 1,046 / 0 / 0 | 18 / 0 |
| R1 | 238 / 665 / 718 | 280 / 766 / 0 | 0 / 18 |
| R2 | 897 / 6 / 718 | 1,040 / 6 / 0 | 18 / 0 |
| R2lex | 903 / 0 / 718 | 1,046 / 0 / 0 | 18 / 0 |
| R3 | 903 / 0 / 718 | 1,046 / 0 / 0 | 18 / 0 |
| R0file | 755 / 148 / 718 | 775 / 271 / 0 | 7 / 11 |

**没有编译单元读到的头文件：718 个。** 多数在 Tests 和关掉的组件里：
- `Tests/RunCMake` 147、`Tests/QtAutogen` 129、`Help/guide` 28、`Utilities/cmcurl` 26
- `Tests/CMakeCommands` 22、`Source/CursesDialog` 19、`Utilities/cmlibuv` 18、`Source/CPack` 18
- `Tests/ExportImport` 18、`Source/QtDialog` 14

所有编译单元都做完了，所以这 718 个的原因都应是“没有编译单元包含它”。没进数据库的 2,392 个源文件里，只有 2 个被读到，其余 2,390 个 skipped。

**和 reference 比：** reference 读到 918 个头文件。
- 只有 reference 读到的 18 个：curl `vtls/*.h`、`curl_ntlm_core.h`、`cm3p/bzlib.h`、`lzma.h`、`zstd.h`、`archive_openssl_evp_private.h`。都是 configure 宏打开的分支。
- 只有 light 读到的 3 个：curl `stdcheaders.h`、`arpa_telnet.h`、libarchive `archive_crc32.h`。

## g) 编译参数

**现在的过滤（`cpp-source-query.py:159-206`）在这个数据库上：**
- 当作不认识而拒绝的只有 **`-w`**，504 个编译单元（47%）用了它。按草稿“不认识的让编译单元失败”，这 504 个都会失败；而 light 模式自己就会加 `-w`。
- 另外，2,444 处指向构建目录的 `-I` 被当作外部路径拒绝，1,064 个编译单元每个都有。

**根目录外的查找目录，两个候选的实测：**
- **忽略并记下：** 1,053 个编译单元都能解析（另外 11 个的主文件本身在构建目录里）；745 处指令没解析；529 条指令级的边和真编译不同，其中 509 条由构建目录引起。数字见上面 d 的 A 场景。
- **让编译单元失败：** 1,064/1,064 个编译单元失败。

**原型过滤在这个数据库上的结果（12 种写法，每个编译单元都算到）：**
- 照用：`-D`（4,101 处）、根目录内的 `-I`（3,294 处）、`-isystem`（2,044 处，两个目录都在源码树里）、`-std=`（973 处）、`-O3`（1,064 处）、`-Wno-format` 和 `-Wno-format-security`（各 7 处）、`-fPIC`（1 处）。
- 忽略并记下：`-o`（带 1 个值，1,064 处）、`-c`（0 个值，1,064 处）、`-w`（0 个值，504 处）、根目录外的 `-I`（带 1 个值，2,444 处）。
- 不认识的：**0**。
- 数据库里没有的：`-include`、`-imacros`、`-iquote`、`-x`、`-MD/-MF`、响应文件、`-Xclang`。

### 建议的参数表

括号里是后面带几个值。完整清单可以用 `light_include_scan.py --print-arg-table` 打出来。

**照用。** 会改变找头文件的结果或预定义宏：
- 路径类：`-I`（1，或者直接连写）、`-isystem`（1）、`-iquote`（1）、`-idirafter`（1）、`-include`（1）、`-imacros`（1）。路径在工作区里就照用；在工作区外就忽略并记下，只有经它才找得到的头文件读作没解析。
- 宏和语言：`-D`、`-U`（1，或者连写）；`-std=`（0）；`-x`（1，只接受 c 或 c++）；`-target`、`--target`（1）和 `--target=`（0）。
- 改变预定义宏的：`-O0/1/2/3/s/z/g`（0，影响 `__OPTIMIZE__`）；`-m32`、`-m64`、`-pthread`；`-fPIC`、`-fpic`、`-fPIE`、`-fpie`（影响 `__PIC__`）；`-f(no-)exceptions`、`-f(no-)rtti`；`-funsigned-char`、`-fsigned-char`、`-fshort-wchar`；`-fms-extensions`、`-fms-compatibility`、`-fno-builtin`；`-nostdinc`、`-nostdinc++`。以上都是 0。

**忽略并写进 `notes`。** 对只读 `#include` 的扫描没有影响：
- 输出和依赖文件：`-o`、`-MF`、`-MT`、`-MQ`（1）；`-c`、`-MD`、`-MMD`、`-MP`、`-pipe`（0）。
- 诊断和调试：`-w`、`-W<任意>`、`-g<任意>`（0）。
- 链接：`-L`（1，或者连写）、`-l<库>`、`-Wl,`、`-Xlinker`（1）。
- 只影响代码生成、诊断显示的 `-f...`（0）。
- `--sysroot`、`-isysroot`（1，或者连写）：只改系统头文件的查找位置，而系统头文件本来就由 `-nostdinc` 关掉了。

另有一组可能改宏、但用 libclang 照用不安全或不需要的，比如 `-march=`、`-m<指令集>`、`-fopenmp`、`-ffast-math`。CMake 里没有这些，SLAM 那份实测更有代表性。

**其他一律让这个编译单元失败。** 按草稿“不用拒绝名单”的原则，`-Xclang`、`-Wp,`、`-Xpreprocessor`、`-fplugin`、`-fpass-plugin`、响应文件 `@` 等都落进这一类。

## 对第三稿可能有用的几处事实

1. **规则在这个项目上的权衡。** 假失败 / 检出：
   - R0：0 / 0–1（30 个里）
   - R1：1,450 / 说不清（22 个已失败）
   - R2：12（都是 `#error`）/ 10（只有 `#if`）
   - R2lex：0 / 10（只有 `#if`）
   - R3：0 / 0
   - R0file：430 / 8

   大括号和函数体里的错，不管注入在什么位置，都不改变边。没收尾的 `#if` 是唯一会被检出、也可能改变边的一类：这次注入的是 `#if 1`，边没变；换成 `#if 0`，后面的引用就会消失。
2. **“之前”的定义。** 跨头文件按包含链的偏移排序，在约 98 万条错误上和诊断发出的顺序没有一处不同。实际起作用的是：第一条找不到的 `#include` 在每个编译单元的前 1–5 条里，所以 R0 等于不判失败。
3. **R2lex 在 CMake 上没有遇到的风险。** 如果有 `#if __GLIBC_PREREQ(2,17)` 这类用到系统头文件里函数式宏的条件，缺了系统头文件会报 Lexical 类错误，R2lex 就会出现假失败。CMake 的生效分支里没出现这种情况。
4. **尖括号改按引号规则找到。** 应读作没解析，不连边；如果保留 R0，也应把它算作找不到。A 场景 26 处、B 场景 21 处，全是错边。
5. **跟宏的 `#include`。** libclang 能解析就该连边。草稿“一律读作没解析”在 B 场景会丢 56 条正确的边。
6. **跳过函数体。** 不丢边：整个项目唯一一处函数体里的 `#include` 照样记下，light 和 light-bodies 的边零差别。也省不了多少时间（0–13%）。代价是函数体里的错误完全看不见。

## 文件

**数据。** 放在 `D:/cc-lead-notes/impl/s8d/measure-cpp/`：
- `cmake-src-analysis.json`：各模式的规则、边、差别、时间和参数；
- `cmake-src-eval-A.txt`：原型评估器的输出；
- `cmake-src-inject-plan.json`、`cmake-src-inject-report.json`、`cmake-src-inject-report.txt`：注入的计划和逐个案例的结果。

**原始输出（WSL）。** 在 `~/dsh-work/measure-cpp/results/cmake-src/`，约 3.0 GB：
- 每次运行的 NDJSON：`light-A`、`lbodies-A`、`ref-A`、`light-B`、`lbodies-B`、`ref-B`、`light-A-single`；
- 虚拟文件系统和文件清单：`vfs-files-A.txt`、`vfs-files-B.txt`；
- `analysis-A-B.json`、`reach-light-A.json`；
- `inject/`：50 个案例的副本和压缩后的输出，以及基线。

**脚本。** 在 `D:/cc-lead-notes/impl/s8d/measure-cpp/scripts/`：
- 运行：`cmsrc-00-setup.sh`、`vfs_filelist.py`、`cmsrc-run.sh`、`cmsrc-single.sh`；
- 分析：`cmsrc-eval.sh`、`cmsrc-analyze.sh`、`cmsrc_analyze.py`、`cmsrc_probe.py`；
- 注入：`cmsrc-inject.sh`、`cmsrc_inject.py`、`cmsrc_inject_scan.py`、`cmsrc_inject_edges.py`。

## 复核

2026-10-17，另一个 Claude 子 agent 做的对抗性复核。

### 怎么复核的

- **自己的扫描器。** `scripts/vf_scan.py` 只用 ctypes 和 libclang 18，没有复用 `light_include_scan.py`，也没有用 `evaluate_rules.py`。
  - 边用 `clang_findIncludesInFile` 取。原型用的是 `clang_visitChildren`。
  - “之前”算了两种：一种是自己按 `clang_getInclusions` 算的位置键，另一种是诊断发出的顺序。
  - 规则和参数分类都是自己写的，在 `vf_compare.py`、`vf_aggregate.py`、`vf_inject.py`、`vf_args.py` 里。
- **样本。** 数据库按 `file` 排序，从第 26 个起每隔 53 个取一个，共 20 个。数据库下标是 993、938、583、614、806、827、714、741、763、1004、46、106、159、216、392、445、498、360、527、282。
  - light、bodies、ref 三种模式都跑了。
  - 每个编译单元都和代理的原始 NDJSON 逐个比较。
- **全量。** 单进程跑全量只要约 45 秒，所以又把 1,064 个编译单元全跑了三遍：A 场景 light、B 场景 light、reference。这三遍用来核总数。
- **注入。**
  - 照代理的做法，自己做了 8 个案例的副本（V1–V8）。
  - 另加 3 个代理没做的探针（P1–P3）。
  - 代理的 50 个副本也逐个核对过。
- **文件位置。** 原始输出在 WSL 的 `~/dsh-work/measure-cpp/results/verify-cmsrc/`，脚本在 `scripts/vf_*.py` 和 `scripts/vf-*.sh`。

### 总表

| # | 说法 | 结论 |
|---|---|---|
| 1 | 假失败：R0 0、R1 1,450、R2 12、R2lex 0、R3 0（另 R0file 430；B 场景 R1 1,500、R2 4） | 确认（全量逐数相同）；“假”的标准有保留 |
| 2 | R0 判 0 个，是因为第一条找不到的 `#include` 在前 1–5 条 | 确认 |
| 3 | 按位置排和按发出顺序排，约 98 万条错误没有一处不同 | 数字确认，但这个对比证明不了两种顺序一般一致 |
| 4 | “之前”取每个文件第一次进入时的包含链；B 场景第一条找不到的最多排在第 47 条 | 定义有缺陷；47 是这个缺陷造成的，应为 9 |
| 5 | 注入检出（R0 light 0/30 等） | 确认（8 个案例 × 2 种模式，16 格全同；50 个副本都对） |
| 6 | 错误不影响边 | 只对这三种注入成立，不能推广 |
| 7 | 函数体里的错误在 `SkipFunctionBodies` 下看不见 | 确认 |
| 8 | 边的数字，light-A 和 reference 差 300 + 229 条 | 确认；d 节表里 20 应为 26 |
| 9 | B 场景和 reference 只差 22 条指令 | 确认 |
| 10 | reference 可以当作真编译 | 项目文件里确认；系统头文件里有错误，也不是 gcc |
| 11 | 时间和内存 | 数量级确认 |
| 12 | 参数清单，以及“现在的过滤只拒绝 `-w`” | 数字确认；遗漏了 512 个编译单元的上限 |
| 13 | 源码树里有 1,621 个头文件，718 个 skipped | 小出入：按生产的扩展名清单是 1,618 和 715 |

### 逐条

**1. 假失败：确认，但“假”的标准有保留。**

我自己的全量（A 场景，light）：

| 规则 | 失败的文件（主 / 头 / 无扩展名 / 其他） |
|---|---|
| R0 | 0（按位置和按发出顺序都是 0） |
| R1 | 1,450（766 / 665 / 18 / 1） |
| R2 | 12（6 / 6 / 0 / 0） |
| R2lex | 0 |
| R3 | 0 |
| R0file | 430（271 / 148 / 11 / 0） |

- 读到的文件 1,969 个，和代理相同。
- R2 的 12 个文件和代理列的逐一相同，全是 `#error`。
- B 场景：R0 0、R1 1,500、R2 4、R0file 421，也和代理相同。
- 20 个样本：我从代理的原始诊断算出每个编译单元里每个文件的 R0、R1、R2、R2lex，和我自己扫描的结果没有一处不同。

**保留。** 代理说这些失败是“假”的，依据是 CMake 能编译。如果换一个依据：这个文件发出的项目内的边，和 reference 一样不一样？

- A 场景读到的 1,969 个文件里，有 86 个和 reference 不一样。原因是 configure 宏决定的分支，以及尖括号改按引号找到。
- 各规则判失败的文件里，边确实错了的：

| 规则 | 判失败的文件 | 其中边确实错了 | 边错了但没判失败 |
|---|---|---|---|
| R0 | 0 | 0 | 86 |
| R2lex | 0 | 0 | 86 |
| R2 | 12 | 1（`curl_setup.h`） | 85 |
| R1 | 1,450 | 48 | 38 |

R1 多抓到的 48 个，代价是把另外 1,402 个边没错的文件也判失败。所以四条规则都保护不了边对不对。边错主要来自读不到构建目录里的头文件和系统头文件，这类情况没有能区分出来的诊断。

**2. R0 为什么判 0 个：确认。**

我按自己的位置键数，第一条找不到的 `#include` 排在第几条（从 0 数）：

| 位置 | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| 编译单元数 | 92 | 826 | 47 | 53 | 24 | 4 |

- 和代理的结果完全相同：中位数 1、p90 2、最多 5。
- 1,046 个编译单元有找不到的 `#include`，1,016 个有错误。错误排在第一条找不到之前的编译单元：0 个。
- 20 个样本里，每个编译单元发出的第一条错误级诊断，就是一条“找不到”。

**3. 两种顺序没有一处不同：数字确认，但这个对比证明不了什么。**

每个编译单元发出的第一条错误级诊断就是“找不到”，所以不管按哪种顺序排，所有错误都排在它后面，两种排法必然一致。这说明不了两种顺序在一般情况下一致。

**4. “之前”的定义有缺陷。B 场景“最多第 47 条”是这个缺陷造成的。**

- **问题。** 同一个项目文件在一个编译单元里被进入不止一次，很常见。A 场景 1,053 个编译单元里有 639 个这样：
  - `uv/errno.h`：417 个编译单元，因为它的 `<errno.h>` 按引号规则找到了自己；
  - `curl_setup.h`：169 个；
  - `curl.h`：113 个；
  - `zstd_deps.h`：24 个；
  - 其余略。

  第二次进入里的指令和错误，都会被记成第一次进入时的位置。
- **47 是怎么来的。** 在 nghttp2 的编译单元里，构建目录的 `config.h` 和 `kwiml/abi.h` 被进入多次。重复进入里的指令被排到前面，又被重复计数：`nghttp2_session.c` 里有 38 个重复的位置。每条指令只算一次，我得到的 B 场景结果是中位数 4、p90 6、最多 9。
- **对 R0 的影响。** 在 CMake 上没有影响：我按发出顺序算，也是 0。
- **对规格的影响。** 这个定义不能原样写进规格。假设一个错误在某个文件的第二次进入里，而第一条找不到排在两次进入之间：这条错误会被误判成“之前没有找不到”。两个改法：用诊断发出的顺序；或者每次进入单独算位置键。

**5. 注入检出：确认。**

8 个案例 × light / bodies 两种模式，共 16 格，和代理的表逐格相同。

| 我的编号 | 代理的案例 | light | bodies |
|---|---|---|---|
| V1 | 00-main-brace-top | R0 检出；R1 不注入就已失败 | 同 light |
| V2 | 07-main-body | 新错误 0，什么都没检出 | R0、R1 检出 |
| V3 | 09-main-brace | 只有 R1 检出 | R1 不注入就已失败 |
| V4 | 14-main-if | R1、R2、R2lex 检出；R0 没有 | 同 light |
| V5 | 15-header-brace | R1 已失败；其余都没检出 | 同 light |
| V6 | 17-header-if | R2、R2lex 检出；R0 没有 | 同 light |
| V7 | 26-header-if-top | R2、R2lex 检出；见下 | 同 light |
| V8 | 28-header-body | 新错误 0 | R1 已失败 |

- V7：157 个编译单元读到这个头文件，R0 只在其中 3 个里让它失败，所以按头文件的规则它不算失败。
- 代理的 50 个注入副本，我逐个和原文件比过：每个都只差描述的那一行或那段乱码，位置也对。

**6. “错误不影响边”：只对这三种注入成立，不能推广。**

我的 8 个案例 × 2 种模式，目标文件的边确实都没变。但这是注入方式决定的：三种错误要么放在最后一条 `#include` 之后，要么是 `#if 1`，要么在函数体里，本来就不可能改变 `#include`。

我加了三个探针：

| 探针 | 注入 | 边 | 检出 |
|---|---|---|---|
| P1 | `Source/cmCurl.h` 第 9 行前插 `/*`，后面没有 `*/` | 4 个编译单元都丢 3 条边（→ `cm/optional`、`cm/string_view`、`cm3p/curl/curl.h`） | R2、R2lex 检出；R0 没检出 |
| P2 | `cmCurl.h` 最后一条 `#include` 前插 `#if 0`，不收尾 | 4/4 丢了 → `cm3p/curl/curl.h` | R2、R2lex 检出；R0 没检出 |
| P3 | 把 `Utilities/cmzlib/compress.c` 的 `#include "zlib.h"` 包进 `#if __GLIBC_PREREQ(2, 17)` … `#endif` | 这条边丢了 | R2lex 检出；R0 也检出（错误排在第一条找不到之前） |

- P3 在 light 下报一条 Lexical 类错误：`function-like macro '__GLIBC_PREREQ' is not defined`。
- 代理把 P3 这类算作 R2lex 的“假失败”风险。确实，真编译不会报错；但 light 的这条边确实丢了。按“这个文件的边不可信”来理解，这是一次真失败。
- 能改变边的错误，正好是 Lexical 类：没收尾的注释、没收尾的条件、条件里用了没定义的函数式宏。这几次 R2lex 都检出了，R0 两次没检出。

**7. 函数体里的错误看不见：确认。**

- V2、V8 在 light 下新错误为 0，在 bodies 下都出现了。
- 代理的 409 是 10 个函数体目标各被多少编译单元读到的总和，算术正确。

**8. 边的数字：确认。d 节表里的一个数有误。**

我的全量 A 场景：

| 项 | light | reference |
|---|---|---|
| 项目内的边（对） | 8,309 | 8,241 |
| 项目内的边（指令） | 8,325 | 8,254 |
| 没解析的 `#include` | 4,636（尖括号 3,930、引号 650、跟宏 56） | 0 |
| 解析到源码树外的 | — | 5,197 |
| 项目文件里的错误 | — | 0 |

- light 里尖括号改按引号找到的有 26 处，跟宏的有 56 处。
- 只在 light 里的边 300 条，只在 reference 里的 229 条。这 229 条的指令在 light 里根本没出现，不是没解析。
- 20 个样本里，我的边和代理的逐条比：3,000 对 3,001。唯一的差别来自我自己的取法，见第 14 条。
- `cmzlib/inflate.c:285 -> inffixed.h` 在跳过函数体时也记下了。
- **表里的数有误。** d 节的表把只在 light 里的 300 条分成“configure 分支 280 + 尖括号改按引号 20”。实际上 26 处尖括号改按引号的指令全部只在 light 里，正文也写的是 26 处。表里少算的 6 处被归进了 280。

**9. B 场景只差 22 条：确认。**

- 我的全量 light-B 和 reference 比，只看源码树里的指令：
  - 只在 light 里的 22 条：21 处尖括号改按引号找到的，加上 `archive_hmac_private.h:85`（`OPENSSL_VERSION_NUMBER` 决定的分支）；
  - 只在 reference 里的：0 条。
- **补充。** 尖括号改按引号找到，还会让编译单元走进一个它本来不会读的文件。例如 `cmext/algorithm` 里的 `<memory>` 找到了 `cmext/memory`，样本里这个编译单元就多出 `cmext/memory:10 -> cm/type_traits`。去重后，这条边在全项目范围内本来也存在；但这种情况会让一个头文件被算成 parsed，而真编译时这个编译单元并不读它。

**10. reference 当作真编译：项目文件里确认，有保留。**

- 项目文件里，错误和找不到的诊断都是 0，这一点确认。
- 但 27 个 zstd 编译单元在 GCC 13 的 `xmmintrin.h` 里报了 2,808 个错误，A、B 两个场景一样。原因是本机没有 libclang 自己的资源头文件，用的是 GCC 的。
- 另外，reference 用的是 clang，不是 gcc。由 `__clang__` 或 `__GNUC__`（clang 报 4）决定的分支，可能和真用 gcc 编译时不同，这次没有核。
- 上面这些错误都是语义错误，不影响预处理，所以 reference 的边仍可用。样本里 `fse_decompress.c` 23 对 23 一致。

**11. 时间和内存：数量级确认。**

- 我的单进程（不经进程间通信，收集的东西也少）：1,064 个编译单元 40–45 秒。
- 解析加收集：p50 29 ms、p95 99 ms、p99 114 ms、最长 136 ms。
- 峰值内存从 93 MB 涨到 103 MB。
- reference 分 3 块并行，每块 134–156 秒。

**12. 参数：数字确认，有一处遗漏。**

我自己数的结果：

| 参数 | 处数 | 说明 |
|---|---|---|
| `-D` | 4,101 | |
| 源码树内的 `-I` | 3,294 | |
| 源码树外的 `-I` | 2,444 | 1,064 个编译单元都有 |
| `-isystem` | 2,044 | 都在源码树内 |
| `-std=` | 973 | |
| `-O3` | 1,064 | |
| `-w` | 504 | 504 个编译单元 |
| `-Wno-format`、`-Wno-format-security` | 各 7 | |
| `-fPIC` | 1 | |
| `-o`、`-c` | 各 1,064 | |

- 编译器和扩展名一致：`cc` 配 `.c`，`c++` 配 `.cxx` 和 `.cpp`。所以 libclang 按扩展名定语言没有问题。
- **遗漏。** 今天的适配器在看参数之前，就会因为数据库超过 512 个编译单元而整次拒绝（`cpp-source-query.py:117-118`）。就算没有这个上限，按参数顺序，它对 1,064 个编译单元先报的都是源码树外的 `-I`，不是 `-w`。“只有 `-w` 不认识”作为一份写法清单是对的。
- **重复条目。** 数据库里有 9 个源文件各出现不止一次，参数相同。规格写的是按去重后编号，所以 A 场景要解析的是 1,046 个编译单元，不是 1,053 个。对时间的影响约 0.7%。

**13. 头文件数：小出入。**

- 按生产的扩展名清单（`cpp-source-index.ts:9`），源码树里的头文件是 1,618 个，不是 1,621 个。
- 多出的 3 个：
  - `Tests/QtAutogen/SameName/object.h++` 和 `object_upper_ext.H`：生产的正则不认这两种扩展名；
  - `test_UTF-16LE.h`：含 NUL，没有进虚拟文件系统。
- 所以“没有编译单元读到”的是 715 个，不是 718 个。
- 规格 §11.5 写的是扩展名“大小写不敏感”，那样 `.H` 也会被认领；但 `cpp-source-index.ts` 现在的正则是大小写敏感的。两边不一致，施工时要定。

**14. 方法上的提示（不是代理的错）。**

用 `clang_findIncludesInFile` 取指令，会漏掉只在同一文件第二次进入时才生效的指令，样本里就漏了 `zstd_deps.h:52`。规格 §11.4 写的“访问最外层的 `InclusionDirective`”（也是代理用的办法）没有这个问题。施工时不要改成 `findIncludesInFile`。

**没有核的：**
- light-bodies 全量的数字（R1 1,627 等）；
- R1 失败原因的分布和例子；
- 3 进程下的时间；
- “函数体里的 `#include` 全项目只有 1 处”里的“只有”。

### 对第三稿的几点看法（复核者的意见）

1. **R0 等于 R3。** 在 CMake 上，R0 实际上就是 R3：没有系统头文件，几乎每个编译单元的前几条 `#include` 里就有一条找不到，之后的错误全被原谅。任何不带系统头文件读的 C/C++ 项目都会这样，因为 `<stdio.h>` 这一类第一条就找不到。所以“之前”的定义写得再精确，R0 也几乎什么都不判。
2. **R2lex 是唯一和“边可能错”对得上的规则。** 它检出的正是能改变 `#include` 的那类错误，在 CMake 上没有假失败。
3. **R2lex 管不了主要的边错。** 主要的边错来自 configure 生成的头文件和系统头文件不在材料里，A 场景有 86 个文件。哪条规则都管不了这部分，只能写成已知限制和 `notes`。
4. **尖括号改按引号找到的边。** 应读作没解析，不连边。它还会让编译单元把那个文件算作“读到了”，所以头文件是不是 parsed 也要排除经它进入的情况。
