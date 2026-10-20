已按 `.lead-ref/t-common.md` 完成 E2 只读盘点：**119 个文件，27,765 行；37 项发现**。未写文件，未运行测试或构建，未联网。

建议分为：**2 项删除旧兼容测试、24 项合并、5 项转换夹具、6 项保留待裁定**。估计涉及现有测试代码 **406 行**，不是净删减量。`keep-note` 均计 0 行；转换可能增加公开步骤所需代码。

以下是交给 lead 的候选报告。旧兼容删除应与生产分支清理同步；规格行合并须保留行号追踪。所有 memory／SQLite 双后端参数化继续保留，依据 `docs/refactor/HANDOFF.md:683`。

为控制表格宽度，表内测试名称采用可定位的短称；JSON 保留完整测试名及合并目标。公开初始化步骤已经存在，证据为 `tests/composition/R5a-project-bootstrap-platform.test.ts:107-175`：`projects.createProject` → `projects.registerWorkspace` → `completionPolicies.installCompletionPolicy` → `completionPolicies.activateCompletionPolicy` → `architecture.adoptInitialArchitecture`。下文称为“公开初始化链”。

| 编号 | 类别 | 位置、测试名 | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---|---:|---|---|
| E2-01 | 过时 | `tests/data/R3b-materials-contract.test.ts:63-86`；reopens the original artifacts table… | 直接插入缺少 `origin` 的旧记录，再要求读出 legacy owner，并跨重开保留。生产兼容分支仍在 `src/core/record-store/body-codec.ts:206-212`。 | `delete`；与旧解码分支同步清理 | 旧格式兼容已由 `docs/refactor/HANDOFF.md:565-570` 取消。当前 origin 的首写所有者测试保留在同文件 `:45-60`；它不替代 SQLite 后端测试。 | 24 | 否 | 高 |
| E2-02 | 过时 | `tests/data/R3b-materials-contract.test.ts:151-156`；does not infer a Host-readable scope from a legacy record without an owner | 前态只能由 legacy、无 owner 的记录构造；当前写入口明确拒绝 legacy origin，见 `src/core/record-store/body-codec.ts:196`。 | `delete`；与 legacy 读取清理同步 | 旧兼容行为按 `docs/refactor/HANDOFF.md:565-570` 取消；当前 Host 历史读取及作用域拒绝仍由同文件 `:132-141` 覆盖。 | 6 | 否 | 高 |
| E2-03 | 过时候选 | `tests/business/A2-workflow-result-mapping.test.ts:108`；finalize_checks…中的 legacy PASS 行 | 当前定稿折叠有 gaps 就得 INCONCLUSIVE，见 `src/core/work-graph/state/verification-machine.ts:882`；但冻结规格仍明确保留 legacy PASS 解释，见 `docs/refactor/STATE-MACHINES-SPEC.md:2846`、`:5595`。 | `keep-note`；lead 先统一决定 79 与 VD-4 的规格口径 | 同文件 `:106-107` 保留 FAIL／INCONCLUSIVE 正常映射；`tests/state/task-machine.test.ts:321` 等另有 legacy 行，需跨区协调。 | 0 | 是，关联 VD-4 | 中 |
| E2-04 | 只为篡改候选 | `tests/data/R3b-body-boundaries.test.ts:44-65`；rejects a valid body row…under a different content key | 自制 `ArtifactBodyRows` 对请求键返回另一个合法正文，并让 `putIfAbsent` 返回同一个错键行。不是公开写入流程产生的状态。 | `keep-note`；先裁定错键存储损坏是否属于保留的存储完整性边界 | 未找到可替代这两个 `corrupt` 断言的公开业务测试；不能据“用了 mock”直接删除。 | 0 | 否 | 中 |
| E2-05 | 只为篡改候选 | `tests/data/R3b-body-boundaries.test.ts:67-77`；rejects a row that claims two conflicting owner authorities | 同一行的 canonical origin 与兼容 `ownerRunRef` 被故意写成不同 owner；当前规范化写入会产生一致值，见 `src/core/record-store/body-codec.ts:163-170`，防御读取在 `:215-216`。 | `keep-note`；与兼容 owner 字段去留一起裁定 | 没有正常公开步骤产生该矛盾前态；尚无删除所需的替代覆盖或明确废止条款。 | 0 | 否 | 中 |
| E2-06 | 只为篡改候选 | `tests/data/R3b-materials-contract.test.ts:92-105`；rejects newly forged legacy origins…的 SQLite 后半段 | `:101` 用 SQL 改正文、保留原摘要，`:104` 要求 `corrupt`。同一测试前半段 `:90-91` 是真实写入口非法输入检查，性质不同。 | `keep-note`；分开裁定正文损坏检查；保留前半段输入边界 | 未证明摘要损坏仅可能来自人为篡改，不能当成已有业务覆盖而删掉。 | 0 | 否 | 中 |
| E2-07 | 手写事实 | `tests/composition/A1-graph-session-platform.test.ts:41-56,61`；creates before a baseline…archive and reopen | `encodeProjectSnapshot`／`encodeWorkspaceSnapshot` 加自造 `TrustedScopeSeeded` 直接提交。 | `convert:projects.createProject → projects.registerWorkspace` | 同文件第二个测试已在 `:233-241` 使用这两个公开入口；保留第一个测试的无 baseline、发现、归档及历史断言。 | 17 | 否 | 高 |
| E2-08 | 手写事实 | `tests/composition/R3c-R4b-platform.test.ts:32-54,68-85,92-94`；wires one durable Goal/Plan/Session graph… | 手造 policy、baseline、两个 active 指针，再与 Project／Workspace 一起 raw commit。 | `convert:公开初始化链` | `tests/composition/R5a-project-bootstrap-platform.test.ts:107-175` 已验证这些入口存在；原 Goal／Plan／Session 重开断言保留。 | 44 | 否 | 高 |
| E2-09 | 手写事实 | `tests/composition/R3d-R3g-platform.test.ts:82-93`；keeps role pins and both observed architecture versions… | 直接提交编码的 Project／Workspace 和自造 scope event。 | `convert:projects.createProject → projects.registerWorkspace` | `tests/composition/R5a-project-bootstrap-platform.test.ts:107-120`；原 role pin、观测版本及 replay 不重抓的断言保留。 | 12 | 否 | 高 |
| E2-10 | 手写事实 | `tests/composition/W1-future-plan-platform.test.ts:58-95,133-136`；scenario 6/restart + W1 success…的初始化 | 手造治理记录、active 指针、scope event 和 SQLite seed。与后面的运行状态 seed 分开处理。 | `convert:公开初始化链` | `tests/composition/R5a-project-bootstrap-platform.test.ts:107-175`；保留 scenario 6／W1 业务覆盖。 | 42 | 是 | 高 |
| E2-11 | 手写事实 | `tests/composition/W2-future-intent-platform.test.ts:54-83,116-127`；real composition: an initial plan_only Plan… | 与 W1 相同的治理／scope 直接写入；随后才走真实 plan_only 流程。 | `convert:公开初始化链` | `tests/composition/R5a-project-bootstrap-platform.test.ts:107-175`；保留 plan_only 采用和 SQLite 重开断言。 | 42 | 否 | 高 |
| E2-12 | 手写事实 | `tests/composition/W1-future-plan-platform.test.ts:173-197`；scenario 6/restart + W1 success…的 later Plan／running Run 前态 | 直接写第二版 Plan、Goal 指针及 `status: 'running'` 的 Run，没有通过真实领取、准备、启动链；随后 `:202-218` 据此检查运行中任务、旧 Plan 和 ready 队列。 | `keep-note`；Plan 部分可改 `proposePlan → applyPlanChange`，但尚未确认整个“重开后仍 running”前态的等价公开步骤 | 计划公开采用例见 `tests/composition/R5a-project-bootstrap-platform.test.ts:134-179`；不能把公开启动方法存在当作已证明重开语义等价。 | 0 | 是 | 高 |
| E2-13 | 重复 | `tests/data/S8D-compact-snapshot.test.ts:76-82`；keeps the first 500 sorted lines… | 两处均构造 502 行，断言保留前 500 行、追加一条“余 2 条”。后者从 mapper 入口覆盖。 | `merge-into:tests/data/S8D-observed-v2-codecs.test.ts::cuts at 500 lines and appends exactly one line with the removed count` | 目标 `:279-286`，同值断言在 `:283-285`。 | 7 | 否 | 高 |
| E2-14 | 重复 | `tests/data/S8D-compact-snapshot.test.ts:84-96`；cuts at 64 KiB… | 两处均为 400×200 字符、326 行、65,525 字节、余 74 条。原测试另有“含摘要总字节超过上限”的显式断言。 | `merge-into:tests/data/S8D-observed-v2-codecs.test.ts::cuts at 64 KiB of the kept lines joined by a newline and reports the exact remainder`；迁入原 `:94` 断言 | 目标 `:288-300`，同值断言 `:296-299`。不动原文件 `:71-74` 的去重、排序、空输入检查。 | 13 | 否 | 高 |
| E2-15 | 重复 | `tests/composition/S8A-L8-pass-capture.test.ts:380-403`；row 2: the public finalizeChecks PASS… | row 3 的首次调用已经走同一公开 finalize，断言非 replay PASS，并调用同一个 `assertPassCapture`，还多验一次通知。 | `merge-into:tests/composition/S8A-L8-pass-capture.test.ts::row 3: the same finalize request replays and changes no capture state`；合并后保留 row 2、3 规格映射 | 目标 `:405-443`，首调用覆盖 `:422-428`，共享捕获断言 `:344-353`。两后端均保留。 | 24 | 是 | 高 |
| E2-16 | 重复 | `tests/data/S8D-python-import-graph-script.test.ts:130-134`；A-20 does not record the pkg/__init__.py self edge… | 单独重跑同一 A20 输入，只检查 self edge／对应 unresolved 不存在；公开测试精确断言完整边集合和 unresolved 集合。 | `merge-into:tests/data/S8D-A20-python-imports.test.ts::A-20 resolves Python imports against the configuration roots exactly` | 目标 `:137-149`，集合等值在 `:146-149`。保留原脚本综合案例 `:95-128` 的协议及 specifier 检查。 | 5 | 是 | 高 |
| E2-17 | 重复 | `tests/data/S8D-python-import-graph-script.test.ts:140-147`；A-21 reads JSONC… | 同一 JSONC 配置、相同两条边、空 notes、同一个 bad.py SyntaxError。 | `merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 accepts JSONC pyrightconfig.json with comments, a trailing comma and a trailing slash root` | 目标 `:191-205`，断言 `:196-201`；保留双后端。 | 8 | 是 | 高 |
| E2-18 | 重复 | `tests/data/S8D-python-import-graph-script.test.ts:149-155`；A-21 records unused pyright fields… | 同一 pythonVersion 配置，notes、两条边、SyntaxError 三组断言相同。 | `merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 notes the unused pyproject pythonVersion, fails bad.py and keeps the other edges` | 目标 `:64-79`，断言 `:69-75`。 | 7 | 是 | 高 |
| E2-19 | 重复，含独有边界 | `tests/data/S8D-python-import-graph-script.test.ts:157-164`；A-21 fails on extraPaths as a string… | 业务错误文本、无边已被公开测试覆盖；脚本还断言无 ready、精确 failed 消息包、statuses 为空。 | `keep-note`；保留为配置失败协议样例，不整段合并掉 | `tests/data/S8D-A21-python-config.test.ts:95-108` 覆盖业务结果，但没有直接检查 NDJSON 消息包互斥。 | 0 | 是 | 高 |
| E2-20 | 重复 | `tests/data/S8D-python-import-graph-script.test.ts:166-172`；A-21 notes a vendor root… | 同配置、不可用 vendor note、仅 a→b、d.py 的 c unresolved；公开测试目前仅比较 unresolved 二元组。 | `merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 notes an unusable vendor root and leaves its imports unresolved`；迁入 `reason: null` 断言 | 目标 `:110-126`，断言 `:115-122`。 | 7 | 是 | 高 |
| E2-21 | 重复 | `tests/data/S8D-python-import-graph-script.test.ts:174-180`；A-21 fails on extends… | 同一 extends 配置、同一语言失败文本、无边。配置失败消息包形状继续由 E2-19 保留。 | `merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 fails the language when pyrightconfig.json extends another configuration` | 目标 `:157-170`，断言 `:162-166`。 | 7 | 是 | 高 |
| E2-22 | 重复 | `tests/data/S8D-python-import-graph-script.test.ts:182-189`；A-21 keeps the configuration root order… | 同时存在 a/m.py、b/m.py；两处均要求 x.py 解析到 a/m.py。 | `merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 uses the setuptools find.where root before the pyright extraPaths root` | 目标 `:172-189`，断言 `:182-185`。不删原脚本文件 `:200-217` 的 python_index 独立入口案例。 | 8 | 是 | 高 |
| E2-23 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:120-128`；A-22 (h) inactive branch | 同一 `#if 0` include，不产生边／unresolved；公开测试还检查 x.h 未被解析的原因。 | `merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (h): a disabled conditional branch contributes no edge` | 目标 `:174-190`，断言 `:182-189`。 | 9 | 是 | 高 |
| E2-24 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:307-316`；A-22 (g) outside lookup directory | 同一 `-I/outside`、忽略目录计数、无边、带引号且 reason=null 的 unresolved。 | `merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (g): ignores an outside lookup directory and notes it` | 目标 `:156-172`，断言 `:164-171`。 | 10 | 是 | 高 |
| E2-25 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:368-375`；A-22 (j) main file not observed | 两处均含 gen/x.cpp 未观测编译单元，要求精确计数 note，同时正常单元可解析。 | `merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (j): notes a unit whose main file is not observed` | 目标 `:247-265`，断言 `:258-264`；公开案例还保留正常 include 边。 | 8 | 是 | 高 |
| E2-26 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:233-240`；A-22 block comment before an include specifier… | 完全相同的 `#include /*c*/ "missing.h"`，unresolved 的引号和 null reason 相同；脚本另有 parsed 状态断言。 | `merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (q): a block comment before a quoted include keeps the quotes`；迁入 parsed 覆盖断言 | 目标 `:389-398`，现有断言 `:396-397`。 | 8 | 是 | 高 |
| E2-27 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:204-211`；A-23 maps absolute in-workspace files… | 编译数据库 directory 在工作区外、file 为工作区内绝对路径，两处均要求成功解析且没有该路径的错误 note。 | `merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 path: an outside directory with an absolute workspace main file still parses` | 目标 `:285-299`，断言 `:293-298`；公开层额外的“近似” note 是层级附加信息。 | 8 | 是 | 高 |
| E2-28 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:405-415`；A-23 fails a unit on -Xclang… | 同一 main.cpp／b.cpp 两单元；main 以精确参数错误失败，b 解析成功。 | `merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: -Xclang fails only its own unit while the other parses` | 目标 `:216-234`，断言 `:227-233`。不据此移除其他单元事件顺序测试。 | 11 | 是 | 高 |
| E2-29 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:417-423`；A-23 fails a unit on -load… | 同一 `-load x`，错误只列参数、不带值。 | `merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: a bare -load names the parameter without its value` | 目标 `:236-251`，断言 `:244-250`。 | 7 | 是 | 高 |
| E2-30 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:425-432`；A-23 notes -march=native… | 相同参数列表，均要求只提示忽略 march，正常解析，不把 -o 的值当位置参数。 | `merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: -march=native is ignored with a note while -o and -c are not listed` | 目标 `:253-267`，断言 `:261-266`。 | 8 | 是 | 高 |
| E2-31 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:434-441`；A-23 unreadable forced include | 同一不可读强制包含文件，精确“忽略 1 个” note，主文件仍解析。 | `merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: an unreadable forced include is ignored with a count note` | 目标 `:269-283`，断言 `:277-282`。 | 8 | 是 | 高 |
| E2-32 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:443-449`；A-23 rejects compiler wrappers… | 同一个 ccache 包装器，同一个“不认识的编译器：ccache”失败。 | `merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 compiler: ccache is refused by file name` | 目标 `:301-316`，断言 `:309-315`。 | 7 | 是 | 高 |
| E2-33 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:452-456`；A-23 splits a command…的成功半段 | 同一 `c++ -DX=1 -c main.cpp`，都要求正常解析。 | `merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 command: a POSIX-split command line parses` | 目标 `:318-332`，断言 `:325-330`。 | 5 | 是 | 高 |
| E2-34 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:457-461`；A-23 splits a command…的失败半段 | 同一未闭合单引号，均要求“编译命令拆不开”。与 E2-33 行区间不重计。 | `merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 command: an unclosed quote fails the unit` | 目标 `:333-347`，断言 `:340-346`。 | 5 | 是 | 高 |
| E2-35 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:464-470`；A-23 fails an extra positional argument | 相同额外位置参数 other.cpp、相同参数拒绝文本；脚本输入还实际提供了 other.cpp 文件。 | `merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: an extra positional is refused`；合并时保留 other.cpp 存在这一前态 | 目标 `:349-364`，断言 `:357-363`。 | 7 | 是 | 中 |
| E2-36 | 重复 | `tests/data/S8D-cpp-import-graph-script.test.ts:502-519`；binary database；unreadable root database…两个测试 | 都要求 binary source；第二个另要求坏根数据库不回退。公开测试已有坏根与另一个数据库并存的场景。 | `merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 database: an unreadable root database wins and fails the language`；保留可用备用库前态 | 目标 `:172-186`，断言 `:180-185`；原两测试实际代码共 17 行，不计中间空行。 | 17 | 是 | 高 |
| E2-37 | 重复 | `tests/data/S8D-python-import-graph-script.test.ts:219-233`；python_index takes the analyzers directory…Jedi is missing | 两处都创建不含 Jedi 的空 ZIP，要求精确错误带自定义目录下 analyzers.zip；工具回归另检查外层 success 和默认目录可工作。 | `merge-into:tests/data/S8D-exploration-regressions.test.ts::python_index returns success with the missing-Jedi message for an empty archive and stays sourced without a directory` | 目标 `:89-122`，同值断言 `:106-109`；实参传递另有 `tests/data/python-source-index.test.ts:221-235`。合并时保留脚本零退出码要求。 | 15 | 否 | 中 |

Python／C++ 的上述公开覆盖确实经过 `captureSourceChanges`、`listFiles`、`compareFormalObserved`，不是把脚本结果直接换个 helper 名称：见 `tests/helpers/S8D-platform-fixture.ts:233-280`。E2-14、20、26、35、36、37 都注明了合并时必须保留的额外断言或前态，因此行数按“涉及原测试的行”计算，不承诺整段直接删除。

```json
[
  {
    "id": "E2-01",
    "category": "stale",
    "file": "tests/data/R3b-materials-contract.test.ts",
    "lines": [[63, 86]],
    "tests": ["reopens the original artifacts table and reads legacy first-owner provenance"],
    "evidence": "测试在72-73行直接插入缺origin的旧记录，77-84行要求legacy读取及重开；兼容实现仍在src/core/record-store/body-codec.ts:206-212。docs/refactor/HANDOFF.md:565-570取消发布前旧格式兼容。",
    "action": "delete",
    "covered_by": "旧兼容行为已由docs/refactor/HANDOFF.md:565-570取消，须与生产分支同步清理。当前origin首写所有者覆盖：tests/data/R3b-materials-contract.test.ts:45-60::keeps the first owner, source and ref on duplicate memory puts without leaking mutable records；不以此替代SQLite后端覆盖。",
    "est_lines": 24,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E2-02",
    "category": "stale",
    "file": "tests/data/R3b-materials-contract.test.ts",
    "lines": [[151, 156]],
    "tests": ["does not infer a Host-readable scope from a legacy record without an owner"],
    "evidence": "152行构造legacy且ownerRunRef=null；当前写入拒绝legacy，见src/core/record-store/body-codec.ts:196。旧格式读取保留与docs/refactor/HANDOFF.md:565-570冲突。",
    "action": "delete",
    "covered_by": "旧兼容行为已由docs/refactor/HANDOFF.md:565-570取消。当前作用域拒绝覆盖：tests/data/R3b-materials-contract.test.ts:132-141::allows a trustworthy Host historical read without a fabricated Run and rejects scope or actor mismatch。",
    "est_lines": 6,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E2-03",
    "category": "stale",
    "file": "tests/business/A2-workflow-result-mapping.test.ts",
    "lines": [[108, 108]],
    "tests": ["finalize_checks: a %s round goes back to select_work with the receipt kept [a legacy PASS with gaps]"],
    "evidence": "当前折叠在src/core/work-graph/state/verification-machine.ts:882不会生成PASS带gaps；但docs/refactor/STATE-MACHINES-SPEC.md:2846及5595仍明确要求legacy解释。需与docs/refactor/HANDOFF.md:565-570统一。",
    "action": "keep-note",
    "covered_by": "正常FAIL和INCONCLUSIVE映射在同文件106-107行；legacy状态规格行还见tests/state/task-machine.test.ts:321。跨区清理前不删除本行。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "E2-04",
    "category": "tamper",
    "file": "tests/data/R3b-body-boundaries.test.ts",
    "lines": [[44, 65]],
    "tests": ["rejects a valid body row stored or returned under a different content key"],
    "evidence": "52-60行让自制ArtifactBodyRows在请求键下返回另一个合法正文，63-64行要求read和put均返回corrupt；不是公开写入步骤产生的前态。",
    "action": "keep-note",
    "covered_by": "未找到替代这两个错键完整性断言的公开业务测试；需lead裁定存储损坏边界是否保留。",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E2-05",
    "category": "tamper",
    "file": "tests/data/R3b-body-boundaries.test.ts",
    "lines": [[67, 77]],
    "tests": ["rejects a row that claims two conflicting owner authorities"],
    "evidence": "70行故意令ownerRunRef与origin.owner冲突；当前写入在src/core/record-store/body-codec.ts:163-170生成一致值，215-216行读取防御拒绝矛盾。",
    "action": "keep-note",
    "covered_by": "没有正常公开步骤产生该前态；兼容owner字段尚未裁定删除，也没有可替代测试。",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E2-06",
    "category": "tamper",
    "file": "tests/data/R3b-materials-contract.test.ts",
    "lines": [[92, 105]],
    "tests": ["rejects newly forged legacy origins and reports damaged SQLite bodies as corrupt [SQLite corruption portion]"],
    "evidence": "101行SQL改正文而保留旧摘要，104行断言corrupt。90-91行的非法公开写入输入检查不属于本候选。",
    "action": "keep-note",
    "covered_by": "尚未证明正文摘要不一致只能由人为篡改触发；未找到可替代完整性覆盖。保留90-91行输入边界。",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E2-07",
    "category": "handwritten",
    "file": "tests/composition/A1-graph-session-platform.test.ts",
    "lines": [[41, 56], [61, 61]],
    "tests": ["creates before a baseline, discovers module-linked Sessions, and preserves identity/history through archive and reopen"],
    "evidence": "49-54行编码Project/Workspace并提交自造TrustedScopeSeeded；同文件233-241行已经使用公开项目、工作区创建入口。",
    "action": "convert:projects.createProject → projects.registerWorkspace",
    "covered_by": "现有公开步骤：tests/composition/A1-graph-session-platform.test.ts:233-241；保留原测试的Session发现、归档、重开及历史断言。",
    "est_lines": 17,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E2-08",
    "category": "handwritten",
    "file": "tests/composition/R3c-R4b-platform.test.ts",
    "lines": [[32, 54], [68, 85], [92, 94]],
    "tests": ["wires one durable Goal/Plan/Session graph and reopens the same Kernel Session"],
    "evidence": "41-54行手造治理记录，77-85行构造Project/Workspace/governance提交，93行raw commit。",
    "action": "convert:projects.createProject → projects.registerWorkspace → completionPolicies.installCompletionPolicy → completionPolicies.activateCompletionPolicy → architecture.adoptInitialArchitecture",
    "covered_by": "全部入口今天已存在，见tests/composition/R5a-project-bootstrap-platform.test.ts:107-175；原Goal/Plan/Session重开测试保留。",
    "est_lines": 44,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E2-09",
    "category": "handwritten",
    "file": "tests/composition/R3d-R3g-platform.test.ts",
    "lines": [[82, 93]],
    "tests": ["keeps role pins and both observed architecture versions after restart without replay recapture"],
    "evidence": "87-92行直接提交编码Project/Workspace和自造TrustedCompositionScopeSeeded事件。",
    "action": "convert:projects.createProject → projects.registerWorkspace",
    "covered_by": "现有公开入口见tests/composition/R5a-project-bootstrap-platform.test.ts:107-120；保留role pins、两个观测版本和replay不重抓断言。",
    "est_lines": 12,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E2-10",
    "category": "handwritten",
    "file": "tests/composition/W1-future-plan-platform.test.ts",
    "lines": [[58, 95], [133, 136]],
    "tests": ["scenario 6/restart + W1 success: real SQLite adopt -> replay -> later revision -> reopen replay [bootstrap]"],
    "evidence": "65-95行手造治理记录、active指针及scope事件，135行直接写SQLite；与173-197行running Run前态分开处理。",
    "action": "convert:projects.createProject → projects.registerWorkspace → completionPolicies.installCompletionPolicy → completionPolicies.activateCompletionPolicy → architecture.adoptInitialArchitecture",
    "covered_by": "现有公开入口见tests/composition/R5a-project-bootstrap-platform.test.ts:107-175；保留scenario 6及W1规格覆盖。",
    "est_lines": 42,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-11",
    "category": "handwritten",
    "file": "tests/composition/W2-future-intent-platform.test.ts",
    "lines": [[54, 83], [116, 127]],
    "tests": ["real composition: an initial plan_only Plan adopts and survives a SQLite reopen"],
    "evidence": "61-83行手造治理与scope schema，119-126行提交编码Project/Workspace及governance。",
    "action": "convert:projects.createProject → projects.registerWorkspace → completionPolicies.installCompletionPolicy → completionPolicies.activateCompletionPolicy → architecture.adoptInitialArchitecture",
    "covered_by": "现有公开入口见tests/composition/R5a-project-bootstrap-platform.test.ts:107-175；保留plan_only采用和SQLite重开覆盖。",
    "est_lines": 42,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E2-12",
    "category": "handwritten",
    "file": "tests/composition/W1-future-plan-platform.test.ts",
    "lines": [[173, 197]],
    "tests": ["scenario 6/restart + W1 success: real SQLite adopt -> replay -> later revision -> reopen replay [later Plan and running Run]"],
    "evidence": "175-185行手造后续Plan、Goal指针及running Run，189-195行直接写入；202-218行依赖该状态判断running、旧Plan历史及ready任务。尚未证明整个跨重开前态有等价公开步骤。",
    "action": "keep-note",
    "covered_by": "Plan采用的公开步骤已存在，见tests/composition/R5a-project-bootstrap-platform.test.ts:134-179；running Run跨重开部分尚未确认等价公开构造，不能据此承诺转换。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-13",
    "category": "duplicate",
    "file": "tests/data/S8D-compact-snapshot.test.ts",
    "lines": [[76, 82]],
    "tests": ["keeps the first 500 sorted lines and reports the exact number of removed lines"],
    "evidence": "两处均为502行、保留前500行、追加余2条摘要；mapper入口相同断言见tests/data/S8D-observed-v2-codecs.test.ts:283-285。",
    "action": "merge-into:tests/data/S8D-observed-v2-codecs.test.ts::cuts at 500 lines and appends exactly one line with the removed count",
    "covered_by": "tests/data/S8D-observed-v2-codecs.test.ts:279-286::cuts at 500 lines and appends exactly one line with the removed count",
    "est_lines": 7,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E2-14",
    "category": "duplicate",
    "file": "tests/data/S8D-compact-snapshot.test.ts",
    "lines": [[84, 96]],
    "tests": ["cuts at 64 KiB of the kept lines and does not count the summary line against that cap"],
    "evidence": "两处均构造400条200字符行，断言326行、65525字节、余74条；目标断言在tests/data/S8D-observed-v2-codecs.test.ts:296-299。须迁入本测试94行含摘要后总字节超过上限的断言。",
    "action": "merge-into:tests/data/S8D-observed-v2-codecs.test.ts::cuts at 64 KiB of the kept lines joined by a newline and reports the exact remainder",
    "covered_by": "tests/data/S8D-observed-v2-codecs.test.ts:288-300::cuts at 64 KiB of the kept lines joined by a newline and reports the exact remainder",
    "est_lines": 13,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E2-15",
    "category": "duplicate",
    "file": "tests/composition/S8A-L8-pass-capture.test.ts",
    "lines": [[380, 403]],
    "tests": ["row 2: the public finalizeChecks PASS starts one automatic capture"],
    "evidence": "row 3在422-428行已完成同一公开finalize、非replay PASS及assertPassCapture，另检查通知恰增一次；共同捕获断言在344-353行。合并后必须保留row 2/3规格映射和双后端。",
    "action": "merge-into:tests/composition/S8A-L8-pass-capture.test.ts::row 3: the same finalize request replays and changes no capture state",
    "covered_by": "tests/composition/S8A-L8-pass-capture.test.ts:405-443::row 3: the same finalize request replays and changes no capture state",
    "est_lines": 24,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-16",
    "category": "duplicate",
    "file": "tests/data/S8D-python-import-graph-script.test.ts",
    "lines": [[130, 134]],
    "tests": ["A-20 does not record the pkg/__init__.py self edge or an unresolved for that pair"],
    "evidence": "同一A20输入的self edge及对应unresolved缺席，已由公开测试146-149行完整集合等值覆盖。保留本文件95-128行协议及specifier独有检查。",
    "action": "merge-into:tests/data/S8D-A20-python-imports.test.ts::A-20 resolves Python imports against the configuration roots exactly",
    "covered_by": "tests/data/S8D-A20-python-imports.test.ts:137-149::A-20 resolves Python imports against the configuration roots exactly",
    "est_lines": 5,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-17",
    "category": "duplicate",
    "file": "tests/data/S8D-python-import-graph-script.test.ts",
    "lines": [[140, 147]],
    "tests": ["A-21 reads JSONC pyrightconfig.json and keeps lib as a root after trailing slashes"],
    "evidence": "相同JSONC配置、两条边、空notes、bad.py SyntaxError；公开测试同值断言在tests/data/S8D-A21-python-config.test.ts:196-201。",
    "action": "merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 accepts JSONC pyrightconfig.json with comments, a trailing comma and a trailing slash root",
    "covered_by": "tests/data/S8D-A21-python-config.test.ts:191-205::A-21 accepts JSONC pyrightconfig.json with comments, a trailing comma and a trailing slash root",
    "est_lines": 8,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-18",
    "category": "duplicate",
    "file": "tests/data/S8D-python-import-graph-script.test.ts",
    "lines": [[149, 155]],
    "tests": ["A-21 records unused pyright fields in notes and the bad.py SyntaxError reason"],
    "evidence": "相同pythonVersion配置、notes、两条边及SyntaxError；公开测试同值断言在tests/data/S8D-A21-python-config.test.ts:69-75。",
    "action": "merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 notes the unused pyproject pythonVersion, fails bad.py and keeps the other edges",
    "covered_by": "tests/data/S8D-A21-python-config.test.ts:64-79::A-21 notes the unused pyproject pythonVersion, fails bad.py and keeps the other edges",
    "est_lines": 7,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-19",
    "category": "duplicate",
    "file": "tests/data/S8D-python-import-graph-script.test.ts",
    "lines": [[157, 164]],
    "tests": ["A-21 fails on extraPaths as a string with the frozen configuration literal"],
    "evidence": "错误原因和无边已由公开入口覆盖，但160-163行还检查ready缺席、failed消息包形状及statuses为空，是脚本协议边界。",
    "action": "keep-note",
    "covered_by": "业务部分由tests/data/S8D-A21-python-config.test.ts:95-108::A-21 fails the language when pyproject extraPaths is not a string list覆盖；该公开测试不直接检查NDJSON消息包。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-20",
    "category": "duplicate",
    "file": "tests/data/S8D-python-import-graph-script.test.ts",
    "lines": [[166, 172]],
    "tests": ["A-21 notes a vendor root with no claimed Python files and leaves d.py c unresolved"],
    "evidence": "相同vendor配置、note、a到b边及d.py的c未解析；目标115-122行已有业务断言，但只比较unresolved二元组，须迁入reason:null。",
    "action": "merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 notes an unusable vendor root and leaves its imports unresolved",
    "covered_by": "tests/data/S8D-A21-python-config.test.ts:110-126::A-21 notes an unusable vendor root and leaves its imports unresolved",
    "est_lines": 7,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-21",
    "category": "duplicate",
    "file": "tests/data/S8D-python-import-graph-script.test.ts",
    "lines": [[174, 180]],
    "tests": ["A-21 fails on extends with the frozen configuration literal"],
    "evidence": "相同extends输入、语言失败原因及无边，公开断言在tests/data/S8D-A21-python-config.test.ts:162-166；配置失败消息包边界由本文件157-164行保留。",
    "action": "merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 fails the language when pyrightconfig.json extends another configuration",
    "covered_by": "tests/data/S8D-A21-python-config.test.ts:157-170::A-21 fails the language when pyrightconfig.json extends another configuration",
    "est_lines": 7,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-22",
    "category": "duplicate",
    "file": "tests/data/S8D-python-import-graph-script.test.ts",
    "lines": [[182, 189]],
    "tests": ["A-21 keeps the configuration root order: packages.find where before pyright extraPaths"],
    "evidence": "相同a/m.py和b/m.py竞争输入，两处均要求x.py解析到a/m.py；目标182-185行断言。原文件200-217行python_index入口测试不在合并范围。",
    "action": "merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 uses the setuptools find.where root before the pyright extraPaths root",
    "covered_by": "tests/data/S8D-A21-python-config.test.ts:172-189::A-21 uses the setuptools find.where root before the pyright extraPaths root",
    "est_lines": 8,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-23",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[120, 128]],
    "tests": ["A-22 (h) records no edge for an include in an inactive branch"],
    "evidence": "相同#if 0 include，均无边和unresolved；公开测试182-189行另有parsed计数及未包含头文件原因。",
    "action": "merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (h): a disabled conditional branch contributes no edge",
    "covered_by": "tests/data/S8D-A22-cpp-imports.test.ts:174-190::A-22 (h): a disabled conditional branch contributes no edge",
    "est_lines": 9,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-24",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[307, 316]],
    "tests": ["A-22 (g) drops an include directory outside the workspace and records it once"],
    "evidence": "相同-I/outside输入、忽略目录计数、parsed、无边及带引号reason:null的unresolved；公开同值断言164-171行。",
    "action": "merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (g): ignores an outside lookup directory and notes it",
    "covered_by": "tests/data/S8D-A22-cpp-imports.test.ts:156-172::A-22 (g): ignores an outside lookup directory and notes it",
    "est_lines": 10,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-25",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[368, 375]],
    "tests": ["A-22 (j) counts a database entry whose main file is not observed"],
    "evidence": "两处均有未观测gen/x.cpp单元，要求精确计数note且正常单元解析；公开测试258-264行还保留正常include边。",
    "action": "merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (j): notes a unit whose main file is not observed",
    "covered_by": "tests/data/S8D-A22-cpp-imports.test.ts:247-265::A-22 (j): notes a unit whose main file is not observed",
    "est_lines": 8,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-26",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[233, 240]],
    "tests": ["A-22 block comment before an include specifier keeps the written delimiters"],
    "evidence": "相同带块注释的missing.h include，公开测试396-397行断言相同引号和null原因；须将脚本238行parsed要求迁入目标coverage断言。",
    "action": "merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (q): a block comment before a quoted include keeps the quotes",
    "covered_by": "tests/data/S8D-A22-cpp-imports.test.ts:389-398::A-22 (q): a block comment before a quoted include keeps the quotes",
    "est_lines": 8,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-27",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[204, 211]],
    "tests": ["A-23 maps absolute in-workspace files while the database directory stays outside"],
    "evidence": "相同业务边界：工作区外directory、工作区内绝对file，成功解析且无路径错误note；公开同值覆盖293-298行，另加provider近似说明。",
    "action": "merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 path: an outside directory with an absolute workspace main file still parses",
    "covered_by": "tests/data/S8D-A23-cpp-config.test.ts:285-299::A-23 path: an outside directory with an absolute workspace main file still parses",
    "est_lines": 8,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-28",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[405, 415]],
    "tests": ["A-23 fails a unit on -Xclang and keeps the other unit parsed"],
    "evidence": "相同main.cpp/b.cpp两个单元，main以-Xclang精确原因失败，b成功；公开测试227-233行覆盖。此项不替代其他脚本单元事件顺序检查。",
    "action": "merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: -Xclang fails only its own unit while the other parses",
    "covered_by": "tests/data/S8D-A23-cpp-config.test.ts:216-234::A-23 argument: -Xclang fails only its own unit while the other parses",
    "est_lines": 11,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-29",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[417, 423]],
    "tests": ["A-23 fails a unit on -load and reports the spelling without its value"],
    "evidence": "相同-load x输入和仅列参数名的失败文本；公开测试244-250行覆盖。",
    "action": "merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: a bare -load names the parameter without its value",
    "covered_by": "tests/data/S8D-A23-cpp-config.test.ts:236-251::A-23 argument: a bare -load names the parameter without its value",
    "est_lines": 7,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-30",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[425, 432]],
    "tests": ["A-23 notes -march=native and ignores -o with its value"],
    "evidence": "同参数列表，均只提示忽略march，正常解析且-o值未误判为位置参数；公开测试261-266行覆盖。",
    "action": "merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: -march=native is ignored with a note while -o and -c are not listed",
    "covered_by": "tests/data/S8D-A23-cpp-config.test.ts:253-267::A-23 argument: -march=native is ignored with a note while -o and -c are not listed",
    "est_lines": 8,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-31",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[434, 441]],
    "tests": ["A-23 notes an unreadable forced include but still parses the unit"],
    "evidence": "同一不可读强制包含文件、精确忽略1个note、主文件仍解析；公开测试277-282行覆盖。",
    "action": "merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: an unreadable forced include is ignored with a count note",
    "covered_by": "tests/data/S8D-A23-cpp-config.test.ts:269-283::A-23 argument: an unreadable forced include is ignored with a count note",
    "est_lines": 8,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-32",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[443, 449]],
    "tests": ["A-23 rejects compiler wrappers by their file name"],
    "evidence": "相同ccache编译器包装器与精确拒绝原因；公开测试309-315行覆盖。",
    "action": "merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 compiler: ccache is refused by file name",
    "covered_by": "tests/data/S8D-A23-cpp-config.test.ts:301-316::A-23 compiler: ccache is refused by file name",
    "est_lines": 7,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-33",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[452, 456]],
    "tests": ["A-23 splits a command and fails one it cannot split [successful command]"],
    "evidence": "相同c++ -DX=1 -c main.cpp命令和parsed结果；公开测试325-330行覆盖。",
    "action": "merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 command: a POSIX-split command line parses",
    "covered_by": "tests/data/S8D-A23-cpp-config.test.ts:318-332::A-23 command: a POSIX-split command line parses",
    "est_lines": 5,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-34",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[457, 461]],
    "tests": ["A-23 splits a command and fails one it cannot split [unclosed quote]"],
    "evidence": "相同未闭合单引号和编译命令拆不开文本；公开测试340-346行覆盖。与E2-33行区间不重计。",
    "action": "merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 command: an unclosed quote fails the unit",
    "covered_by": "tests/data/S8D-A23-cpp-config.test.ts:333-347::A-23 command: an unclosed quote fails the unit",
    "est_lines": 5,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-35",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[464, 470]],
    "tests": ["A-23 fails an extra positional argument"],
    "evidence": "同一额外位置参数和拒绝原因，公开测试357-363行覆盖；脚本466行实际提供other.cpp，合并时应保留该前态。",
    "action": "merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: an extra positional is refused",
    "covered_by": "tests/data/S8D-A23-cpp-config.test.ts:349-364::A-23 argument: an extra positional is refused",
    "est_lines": 7,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "E2-36",
    "category": "duplicate",
    "file": "tests/data/S8D-cpp-import-graph-script.test.ts",
    "lines": [[502, 508], [510, 519]],
    "tests": [
      "A-23 reports a binary database with the read failure",
      "A-23 reports the unreadable root database instead of switching to another one"
    ],
    "evidence": "两例均要求binary source错误，第二例另要求坏根不回退；公开测试172-186行已有坏根及备用数据库场景。合并时保留备用库可用的前态；计17行，不计中间空行。",
    "action": "merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 database: an unreadable root database wins and fails the language",
    "covered_by": "tests/data/S8D-A23-cpp-config.test.ts:172-186::A-23 database: an unreadable root database wins and fails the language",
    "est_lines": 17,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E2-37",
    "category": "duplicate",
    "file": "tests/data/S8D-python-import-graph-script.test.ts",
    "lines": [[219, 233]],
    "tests": ["python_index takes the analyzers directory from argv[1] and names <dir>/analyzers.zip when Jedi is missing"],
    "evidence": "两处都构造缺Jedi的空ZIP并要求错误文本包含自定义目录下analyzers.zip；工具回归106-109行同值断言，另验证默认目录。合并时保留脚本零退出码要求。",
    "action": "merge-into:tests/data/S8D-exploration-regressions.test.ts::python_index returns success with the missing-Jedi message for an empty archive and stays sourced without a directory",
    "covered_by": "tests/data/S8D-exploration-regressions.test.ts:89-122::python_index returns success with the missing-Jedi message for an empty archive and stays sourced without a directory；实参传递另见tests/data/python-source-index.test.ts:221-235::passes -S and the analyzers directory as the first script argument。",
    "est_lines": 15,
    "spec_row": false,
    "confidence": "中"
  }
]
```

**分类合计**

| 类别 | 项数 | 涉及现有行数 |
|---|---:|---:|
| stale／过时及过时候选 | 3 | 30 |
| duplicate／重复及部分重复 | 25 | 219 |
| trivial／琐碎 | 0 | 0 |
| handwritten／手写事实 | 6 | 157 |
| tamper／只为篡改候选 | 3 | 0 |
| helper／辅助 | 0 | 0 |
| **合计** | **37** | **406** |

按动作计：`delete` 2 项／30 行，`merge-into` 24 项／219 行，`convert` 5 项／157 行，`keep-note` 6 项／0 行。这里没有把小函数测试自动算作琐碎，也没有把双后端重复执行算作重复测试。

**覆盖说明**

完整读取 **17 个文件**：

- `tests/business/`：`A2-workflow-result-mapping.test.ts`、`S1-task-order.test.ts`、`S4C2-U6.test.ts`、`WP1-start-refusal.test.ts`。
- `tests/data/`：`R3b-body-boundaries.test.ts`、`R3b-material-admission-boundaries.test.ts`、`R3b-material-await-boundaries.test.ts`、`R3b-materials-contract.test.ts`、`S8D-A20-python-imports.test.ts`、`S8D-A21-python-config.test.ts`、`S8D-A22-cpp-imports.test.ts`、`S8D-A23-cpp-config.test.ts`、`S8D-compact-snapshot.test.ts`、`S8D-cpp-import-graph-script.test.ts`、`S8D-platform-fixture.test.ts`、`S8D-python-import-graph-script.test.ts`、`S8E-A25-strict-capture.test.ts`。

其余 **102 个文件为扫读**：读取测试名、前置构造、关键调用及断言；有候选的部分进一步展开。精确范围是 `.lead-ref/t-area-E2.txt` 的 119 项减去上述 17 项，具体如下。

`tests/business/`，18 个：

```text
A2-workflow-auto-rework.test.ts
A2-workflow-disposition.test.ts
A2-workflow-reverify.test.ts
K3-15-ur3h.test.ts
K3-17-goal-guard.test.ts
K3-41-release-hold.test.ts
K3-44-crr-recovery.test.ts
K3-46-review-advance-failures.test.ts
K3-UR7-crr-failed-set.test.ts
K3-review-workflow-rows.test.ts
R5b-initial-planning-workflow.test.ts
R5c-workflow.test.ts
S1-archive-flow.test.ts
S1-session-maintenance.test.ts
S5-decision-workflow.test.ts
S5R2-automation-cards.test.ts
S5R2-settings-replay.test.ts
WP1-continuation-handover.test.ts
```

`tests/composition/`，43 个：

```text
A1-graph-session-platform.test.ts
A2-reconcile-classifier-platform.test.ts
A2-requeue-platform.test.ts
A2-reverify-platform.test.ts
A2-verification-chain-platform.test.ts
AG1-session-discovery.test.ts
B2-runtime-platform.test.ts
C1-M1-platform.test.ts
C2-runtime-platform.test.ts
K-R-close-open-turn-health.test.ts
K-R-close-open-turn.test.ts
K-R-observers-kernel-closed.test.ts
K-R-previous-turn-bounds.test.ts
K3-R1-close-open-turn.test.ts
R3c-R4b-platform.test.ts
R3d-R3g-platform.test.ts
R3e-command-check-platform.test.ts
R3e-completion-platform.test.ts
R4-control-platform.test.ts
R4-control-runtime-platform.test.ts
R4c-history-platform.test.ts
R5a-project-bootstrap-platform.test.ts
R5b-query-job-platform.test.ts
R5c-workflow-platform.test.ts
S2B-39-run17-activity.test.ts
S2B-40-run20iii-activity.test.ts
S2B-be1-counting-failure.test.ts
S2B-be1-cross-hour.test.ts
S2B-be1-five-tools.test.ts
S2B-be1-step-boundaries.test.ts
S2B-be1-usage.test.ts
S2B-be1s-shell.test.ts
S4C2-platform.test.ts
S8A-AE1-formal-comparison.test.ts
S8A-AE1-observation.test.ts
S8A-L8-adoption-capture.test.ts
S8A-L8-capture-mappings.test.ts
S8A-L8-pass-capture.test.ts
S8D-A06-multilingual.test.ts
S8D-A11-python-failure.test.ts
W1-future-plan-platform.test.ts
W2-future-intent-platform.test.ts
WP1-session-duty.test.ts
```

`tests/data/`，41 个：

```text
R2e-git-operations.test.ts
R2e-text-boundaries.test.ts
S8A-file-graph.test.ts
S8D-A17-ts-light-scan.test.ts
S8D-A18-ts-light-scan.test.ts
S8D-A19-ts-light-scan.test.ts
S8D-A24-runner.test.ts
S8D-capture-error.test.ts
S8D-exploration-regressions.test.ts
S8D-formal-unresolved-reason.test.ts
S8D-language-providers.test.ts
S8D-observation-inventory.test.ts
S8D-observed-v2-codecs.test.ts
S8E-A07-git-inventory.test.ts
S8E-A08-skip-list.test.ts
S8E-A09-scale.test.ts
S8E-A11-lightscan-fault.test.ts
S8E-A12-file-chunks.test.ts
S8E-A13-edge-cap.test.ts
S8E-A14-narrowed-grant.test.ts
S8E-A15-previous-observation.test.ts
S8E-A23-ignored-databases.test.ts
S8E-A26-git-classification.test.ts
S8E-A27-ts-light-scan-contract.test.ts
S8E-A28-chunk-contract.test.ts
S8E-file-fault-module-layer.test.ts
S8E-old-format-rejection.test.ts
analysis-runner.test.ts
candidate-workspace-reader.test.ts
cpp-source-index.test.ts
project-source-index.test.ts
project-source-snapshot.test.ts
python-source-index.test.ts
source-index.test.ts
typescript-source-query.test.ts
typescript-source-reuse.test.ts
workspace-capture-access.test.ts
workspace-capture-architecture.test.ts
workspace-capture.test.ts
workspace-path-boundary.test.ts
workspace-text-operations.test.ts
```

重复项已在整个 `tests/` 树按相关入口、夹具和期望值交叉检索；环境没有 `rg`，使用只读文件遍历和字符串／正则搜索。**遍历完成不等于 27,765 行全部逐行精读，也不等于运行覆盖率证明。**

**保留项、跨区依赖及未决事项**

- **不要把拒绝旧格式的测试当成旧格式兼容。** `tests/data/S8E-old-format-rejection.test.ts:54-86` 先证明当前格式可读，再拒绝旧 shape，符合决定 79；不列删除。
- **不要整文件删除脚本测试。** Python 综合例仍检查逐文件状态、消息及 resolved specifier，见 `tests/data/S8D-python-import-graph-script.test.ts:95-128`；递归深度案例在 `:191-198`。C++ 还有单元消息顺序、恢复位置、去重编号及书写说明符等独有检查，见 `tests/data/S8D-cpp-import-graph-script.test.ts:130-147`、`:172-193`、`:242-294`；配置矩阵 `:480-500` 也不只包含公开测试已覆盖的两种错误。
- **不要把正常边界输入错误当成数据库篡改。** Git 配置损坏分类测试检查实际 Git 诊断，见 `tests/data/S8E-A26-git-classification.test.ts:122-154`；子进程失败／读取失败测试见 `tests/data/analysis-runner.test.ts:196-249`。它们没有列入 tamper 候选。
- **共享夹具要交 F 区一起处理，不在 E2 重计行数。** `tests/helpers/task-claim-fixture.ts:198-234` 直接写 scope／governance，`:258-270` 还提供 `commitRaw`；E2 使用者包括 `tests/business/R5c-workflow.test.ts:33`、`tests/composition/C1-M1-platform.test.ts:9`、`tests/composition/R4-control-platform.test.ts:20`、`tests/composition/R4c-history-platform.test.ts:7`。初始化部分已有公开替代步骤，但不能据此删除整个共享夹具。
- **S5 共享夹具还有更复杂的手写前态。** `tests/helpers/S5-decision-fixture.ts:517-574` 构造 scope／治理／Goal 状态，`:810-825` 构造候选，`:866-910` 构造消息／回答事实；E2 使用者见 `tests/business/S5-decision-workflow.test.ts:42`、`tests/business/S5R2-automation-cards.test.ts:14`、`tests/business/S5R2-settings-replay.test.ts:9`。本次没有证明这些固定修订号、候选来源及回答链都存在等价公开构造，因此交 F／lead 核实，不虚报可转换行数。
- **N0 与 R5b 当前初始规划链要分开。** 被决定 85-4 点名的 N0 分支仍在 `src/business/workflow/workflow.ts:812-818`；E2 的实际调用在 `tests/business/R5b-initial-planning-workflow.test.ts:292,311`，走 planning answer／adoption，并在 `:320-359` 验证正式完成、执行次数和历史。不能因 N0 被列入 T，就删除这条业务链。
- **`legacy_template` 不是过时依据。** 当前仍使用该配置，决定明确保留，见 `docs/refactor/HANDOFF.md:597`。本报告也没有建议删除 `tests/architecture/` 检查。
- 需要 lead 明确裁定的主要事项是 **E2-03 的 VD-4 规格冲突、E2-04～06 的存储完整性边界、E2-12 的运行中跨重开前态**。没有为这些未决项计入可删行数。