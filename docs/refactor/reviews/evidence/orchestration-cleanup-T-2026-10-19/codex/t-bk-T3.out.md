改完再施工

已逐条核对 T3-001～T3-106。全程只读，未修改文件，未运行测试或构建，未做 Git 写入或联网。环境没有 `rg`，引用检索使用了 PowerShell 的 `Select-String`。

下文“规则表”指 `docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md`。

**2. 需要修改的条目**

| 编号 | 问题 | 证据（`file:line`） | 改法 |
|---|---|---|---|
| T3-003 | 要新建共享夹具，却没有确定文件名，也没有相应白名单项。 | 动作：`.lead-ref/books/t-items-T3.md:20`；两份实现：`tests/app/A2-runtime-capabilities.test.ts:60`、`tests/app/K-R-runtime-capabilities.test.ts:39`；白名单 helper 区：`.lead-ref/books/t-files-T3.txt:59`。 | 将目标固定为 `tests/helpers/runtime-capabilities-fixture.ts`，加入白名单；两文件共用其中的目录、Host 启动及 capabilities 读取方法，保留各自的 scope、adapter、名称、时钟和清理行为。 |
| T3-008 | “测试名或注释”有两种落法，其中只写注释违反总书。 | 条目：`.lead-ref/books/t-items-T3.md:55`；总书要求规格编号进入目标测试名：`.lead-ref/books/t-book.md:44`。 | 改成：“目标测试名同时保留 RL-44 和 RL-34，并注明工作台命令页覆盖；不得仅写入注释。” |
| T3-009 | 真实图转换不能照留原来的全部期望。原例假定没有架构基线；真实 Plan 采用需要架构，真实 reader 会把基线摘要并入 revision。另外，如果用同一世界的两次 Plan 修订制造变化，revision 变化也会计数。 | 原期望：`tests/app/S0-attention-edge-label.test.ts:71`、`:79`、`:90`；无架构不能采用：`tests/composition/R5a-project-bootstrap-platform.test.ts:162`；真实 revision：`src/core/work-graph/views/graph-context-reader.ts:1711`；revision 参与变化计数：`src/app/attention-observer.ts:238`。 | 补齐真实 Project、Workspace、Goal、政策和架构前置；S0-01 的 revision 改为固定输入独立算出的完整 `plan:p1|arch:…`。S0-02、S0-03 每次扫描分别建立独立世界，使用相同标识、基线和状态，仅改变指定的 requires 字段，保留 `changedElements:2、edges:2、nodes:0、statuses:0`。 |
| T3-018 | “L8-8 全都覆盖了”不准确。来源检查没有旧观测时 `current === null`，并精确比较错误原因；目标先建立旧观测，原因只做包含匹配。只加 forbidden 变体不足以搬完来源断言。 | 来源：`tests/app/S8A-L8-capture-start.test.ts:225`、`:229`、`:263`、`:267`；目标：`tests/work-graph/S8A-L8-observation-state.test.ts:675`、`:684`、`:699`、`:708`。 | L8-7、L8-8 均补入“没有旧观测”的来源变体；分别保留 forbidden 拒绝和抛错映射的完整 code、精确 reason、requestSeq、pending、failed 及 `current:null`。现有保留旧观测变体继续保留，之后删除两个来源用例。 |
| T3-019 | 来源独有的不止调用计数，还有三种取消结果下“尚无观测仍为 null”。目标三例均先建立旧观测。 | 来源：`tests/app/S8A-L8-capture-start.test.ts:313`、`:350`、`:351`、`:352`；目标前置：`tests/work-graph/S8A-L8-observation-state.test.ts:721`、`:749`、`:775`。 | L8-9、L8-10、L8-11 各加入无旧观测变体；搬入 `current:null` 和 `failure=0、capture=0、state=1` 三个调用计数断言，保留目标原有旧观测断言，再删除来源三例。 |
| T3-029 | 核实理由仍留下“带过去或明确放弃”的未决选择。真实崩溃目标没有覆盖“先 busy，恢复 Goal 后同一 requestId 成功”。 | 未决文字：`.lead-ref/books/t-items-T3.md:204`；来源 busy、恢复和重放：`tests/business/K3-41-release-hold.test.ts:322`、`:328`、`:336`；目标直接重放成功：同文件 `:438`。 | 将目标参数化为“真实崩溃”和“Goal 暂停后恢复”两种前置。暂停分支先断言同一释放请求得到 requeue busy，再恢复 Goal，用同一 requestId 断言 hold 重放、requeue 首次提交及仅一个 continuation。删除来源中的崩溃替身表述，不删除这条行为。 |
| T3-030 | 拟抽取的 `waitForSettledDriver` 使用睡眠轮询；新写共享 helper 必须遵守规则表，不能原样搬走。 | `tests/business/K3-46-review-advance-failures.test.ts:315`、`:326`；另一份：`tests/business/K3-UR7-crr-failed-set.test.ts:86`；规则表 `:80`；现有通知接口：`src/app/collaboration-driver.ts:144`。 | 抽取时把等待改为：创建 driver 时安装 `onChange` 通知，等待通知后通过 `driver.read` 检查终态；保留首次立即读取，删除两份 `setTimeout` 轮询。两文件的 driver 创建及等待调用一起迁移。 |
| T3-033 | 指定把 owner 返回值直接作为完整期望，与规则表 F8、总书转换规则冲突。 | 动作：`.lead-ref/books/t-items-T3.md:230`；原测试要检查完整回执：`tests/business/K3-review-workflow-rows.test.ts:937`、`:948`；规则表 `:78`；总书 `.lead-ref/books/t-book.md:50`。 | 真实 settle 路径保留。根据固定输入和确定的调用序列独立列出完整 `expectedOwnerResult`，分别比较 owner 结果和 `receipt.result`；包装仍原样返回真实 owner 结果，不以捕获的返回值充当唯一期望。保留 `next:select_work`。 |
| T3-034 | 原样抽取会把三处假 Goal settings 带入新 helper；第三处 messages 还是 Map 替身，不是真实读取委托。 | 假 settings：`tests/business/K3-review-workflow-rows.test.ts:982`、`:1074`、`:1263`；Map 读取：同文件 `:1274`；已有真实 settings 和 mailbox：`tests/helpers/K3-review-card-fixture.ts:277`、`:297`；规则表 `:35`、`:68`；总书 `:65`。 | 共用 helper 的 `goalSettings` 固定接 `world.goalSettings`；把 world 已创建的真实 mailbox 暴露出来，`messages` 接真实 mailbox，删除 `byMessageId` 替身。保留 consumerId 和真实 apply 结果的观察回调。 |
| T3-037 | 明确要求把 install/adopt 返回的 digest 当期望，违反本轮独立期望规则。 | 条目：`.lead-ref/books/t-items-T3.md:259`；被替换断言：`tests/composition/R3c-R4b-platform.test.ts:144`、`:145`；规则表 `:78`。 | 使用固定政策、基线输入及请求标识，独立列出预期 ref 和 contentDigest；install/adopt 返回值只用于后续公开调用的引用传递，不用于替代这两条断言的期望。 |
| T3-045 | 合并目标会被 T3-046 整块删除；两条不能同时照做。 | T3-045 目标：`.lead-ref/books/t-items-T3.md:314`；T3-046 删除范围和“compact 文件不动”：同文件 `:321`；被保留的来源：`tests/data/S8D-compact-snapshot.test.ts:76`；将被删除的目标：`tests/data/S8D-observed-v2-codecs.test.ts:279`。 | 将 T3-045 标为“由 T3-046 统一处理，不单独施工”；保留 compact-snapshot 的 76–82 行，统一按 T3-046 删除 codecs 的 261–301 行。 |
| T3-051 | 公开图只有二元边，无法接住多个来源用例的三元说明符及脚本协议断言；“保留或至少保留 143 行”也没有冻结唯一动作。具体实例见下表。 | 公开形状：`tests/helpers/S8D-platform-fixture.ts:69`；条目：`.lead-ref/books/t-items-T3.md:356`；同组 T3-068 已据此保留 Python 协议断言：同文件 `:477`。 | 按下面逐例边界保留脚本协议用例；只有可由公开图完整表达的其余用例执行合并。脚本 `(i)` 固定完整保留 130–147 行，删去“至少保留”的分支。 |
| T3-060 | 合并说明、嵌套数据库、固定 target 三例也有公开图看不到的三元边或单元列表；缺 libclang 的公开目标只检查统一失败原因，接不住脚本消息及没有 ready 的断言。嵌套数据库两边的相对路径输入也不相同。 | 脚本：`tests/data/S8D-cpp-import-graph-script.test.ts:385`、`:387`、`:395`、`:399`、`:401`、`:477`、`:527`、`:528`；嵌套公开输入：`tests/data/S8D-A23-cpp-config.test.ts:106`；libclang 公开结果：`tests/data/S8D-language-providers.test.ts:236`。 | 保留脚本 377–389、391–403、472–478、521–529 四例及其协议断言；其余指定 A-23 用例继续合并。删除“这些例均同输入、同原因、可整例删除”的描述。 |
| T3-062 | 三份夹具合并需要改另外两份来源文件，白名单只列了 S8D 那份。新文件名也应固定，不能继续写“如”。 | 三份实现：`tests/data/S8D-language-providers.test.ts:33`、`tests/data/S8A-file-graph.test.ts:33`、`tests/data/S8E-A25-strict-capture.test.ts:35`；条目：`.lead-ref/books/t-items-T3.md:433`；新 helper 已列白名单：`.lead-ref/books/t-files-T3.txt:87`。 | 固定目标为 `tests/helpers/workspace-tools-fixture.ts`；补入另外两个来源文件。共用实现保留 denied、fileGraph、capture limits、sourceAnalyzers 及各包装方法的现有差异。 |
| T3-063 | 必须增强的合并目标不在白名单；这属于新增输入和断言，不能用删导入例外处理。 | 条目：`.lead-ref/books/t-items-T3.md:440`；目标 entries 和断言：`tests/data/S8E-A07-git-inventory.test.ts:14`、`:28`。 | 把 `tests/data/S8E-A07-git-inventory.test.ts` 加入 T3 白名单；先完成跟踪后删除文件、跟踪符号链接两种输入和排除断言，再删来源。将“否则保留”改为未完成则 BLOCKED。 |
| T3-064 | 只补 `.git/config` 并保持 nodes 不变，仍没搬完来源断言：不检查它进入 skipped 的错误路径，也不检查 `build/compile_commands.json` 本身作为普通文件保留。“out/build 的源文件进图”不是这个断言。 | 来源文件列表与 skipped：`tests/data/S8D-observation-inventory.test.ts:156`、`:163`、`:164`；目标仅检查 nodes、inventory：`tests/data/S8E-A08-skip-list.test.ts:26`；skipped 转 issues：`src/core/workspace/capture.ts:330`；nodes 只取成功读取的 files：同文件 `:449`。 | 目标 entries 同时加入 `.git/config`、`a/keep.ts`、来源相同的 `build/compile_commands.json`；精确断言三个保留文件路径，并断言所有 language issues 合并后为空。删除“page.nodes 不变”和仅靠 out/build 源文件间接覆盖的说明。 |
| T3-076 | 新建工作区读取层夹具没有确定文件名，也未列白名单。 | 动作：`.lead-ref/books/t-items-T3.md:531`；两份实现：`tests/data/S8E-A26-git-classification.test.ts:71`、`tests/data/S8D-observation-inventory.test.ts:55`。 | 固定目标为 `tests/helpers/observation-source-fixture.ts` 并加入白名单；统一 tempRoot、git、write、context、bindingsFor、projectAccessOf、observe，参数保留 scope、actor、workspaceRevision 和 allowsRead，统一释放真实 access。 |
| T3-096 | 四个调用点在 T1 白名单上，而且 T1-066 已分配同一转换；T3 不能并行重复编辑。 | 四个调用：`tests/work-graph/W2-agent-whiteboard.test.ts:192`、`:213`、`:385`、`:465`；第五个：`tests/work-graph/A2-disposition-change.test.ts:599`；重复任务：`.lead-ref/books/t-items-T1.md:460`；归属：`.lead-ref/books/t-files-T1.txt:72`。 | W2-agent-whiteboard 的四处转换继续归 T1-066；T3-096 只负责 A2 的第五处和 helper 清理。写明：T1-066 的四处转换已合入后，T3 才删除接口、实现和返回字段；不让两个组同时修改 W2-agent-whiteboard。 |
| T3-103 | “更省事的替代”仍然返回手造 DTO，而且与真实 reader 不等价：有 starting/running Run、没有 activity 时，真实结果仍然是不完整。 | 替代方案：`.lead-ref/books/t-items-T3.md:720`；旧 stub：`tests/helpers/executed-files-stub.ts:24`；真实判定：`src/core/work-graph/tasks/goal-executed-files-reader.ts:175`、`:203`；规则表 `:68`。 | 删除替代方案，只使用 `createGoalExecutedFilesReader`。保留逐个检查冲突卡的要求，期望按真实 Run/activity 前置独立计算，不能统一改成 `available/[]/false`。 |
| T3-103 | 注册 schema 加类型转换还不够。三个下游 fixture 的 forwarding port 实际没有 `lookupOrdered`；上层 `observeRecords` 只继续转发，类型断言不会补出方法。 | 缺方法：`tests/helpers/S5-goal-settings-support.ts:189`、`tests/helpers/S5R2-c-support.ts:226`、`tests/helpers/S5R2-d-support.ts:256`；上层转发：`tests/helpers/S5-decision-fixture.ts:245`；真实 reader 调用：`src/core/work-graph/tasks/goal-executed-files-reader.ts:133`。 | 明确要求真实后端的 `lookupOrdered` 穿过每层 forwarding port。将三个复制工厂的合并与 TP-103、TP-105、TP-106 协同处理，最终统一使用具有真实有序读取能力的共用工厂；禁止仅用 `as S5OrderedRecords` 消除类型错误。 |
| T3-103 | 13 个调用文件中有 11 个不在 T3 白名单，后端注册还涉及额外工厂文件；当前白名单不能完成转换。 | 调用和工厂逐文件见下一节；TP 的共用工厂合并：`.lead-ref/books/t-items-TP.md:704`；总书例外只允许编译所需的删导入/使用：`.lead-ref/books/t-book.md:31`。 | 无其他组归属的调用文件补入 T3；已有 TP/T1 归属的修改并入其现有任务。冻结每个文件的唯一负责人及接口交付顺序，所有调用方和 schema/转发链迁移完成后才删除 stub。 |
| T3-105 | 换真实 Runtime 后仍要求“假 advanceWork”，没有消除 Workflow 替身；原 harness 还会手造 completed、consultation 返回值。 | 动作：`.lead-ref/books/t-items-T3.md:734`；手造结果：`tests/runtime/S5-user-message-tools.test.ts:314`、`:341`、`:358`、`:364`；规则表 `:35`、`:68`。 | 使用真实 Workflow 的 advanceWork 和 consumeConsultation；测试包装只计数、设闸并原样返回真实结果。user 分支由真实 `send_user_message` 产生等待；Session 正对照由真实 `send_session_message` 产生咨询。不得保留 `completedAdvance` 和手造 consultation 结果。 |
| T3-105 | “pump 与 consumer 断言不变”与规则表冲突：当前等待靠睡眠，零变化断言读数据库快照。 | 睡眠：`tests/runtime/S5-user-message-tools.test.ts:388`、`:395`；存储快照：同文件 `:409`、`:432`；规则表 `:76`、`:80`。 | 保留消费次数、Query 次数、unsupported 和完成状态这些行为断言；等待改为真实调用闸门及 driver 通知。零变化改为公开消息、Session、Goal 状态前后相等，并用真实提交端口的委托计数检查没有提交，不再读 storeSnapshot。 |
| T3-106 | `claimTask → enter/recordRunResult` 不是规则表允许的执行前置；`enter()` 和手填终态正是明确禁止的形式。 | 动作：`.lead-ref/books/t-items-T3.md:741`；规则表 `:64`、`:66`；当前裸记录构造：`tests/work-graph/A2-disposition-change.test.ts:190`、`:617`。 | 可达分支统一改为 claimTask → Runtime.prepareExecution → Runtime.startRun，由脚本模型结束或真实故障产生终态；人工停止通过 submitControl 及真实 Runtime 处理；满足任务通过真实检查和 completeTask。不得用 enter、terminalObservation 或手填 recordRunResult 代替。 |
| T3-106 | `keep-note` 与总书直接冲突，不能把无法公开到达的状态继续作为可施工转换。真实重领会同时产生新 Run，不能保持原 guard 4 重读文字。 | keep-note：`.lead-ref/books/t-items-T3.md:741`；总书 `.lead-ref/books/t-book.md:52`；结束释放：`src/core/work-graph/state/attempt-machine.ts:807`；新 claim 写新 Run：`src/core/work-graph/tasks/claim-service.ts:1212`、`:1239`；原竞态断言：`tests/work-graph/A2-disposition-change.test.ts:494`、`:507`。 | 将 447–448 的“已结束却持 Lease”行及 479–508 的 reholdLease 竞态明确标为 BLOCKED，停止向 DSH 下达 keep-note 施工指令；不得靠保留造态或修改守卫文字使转换通过。其处置必须由 lead 冻结后重新下发。 |
| T3-106 | “449–450 见 A1-17”指错条目，不能据此处理缺 Lease 的旧数据行。 | 被指行：`tests/work-graph/A2-disposition-change.test.ts:449`；引用：`.lead-ref/books/t-items-T3.md:741`；实际 A1-17 是 B2-09 的 readTaskClosure 转换：`.lead-ref/books/t-items-TP.md:962`。 | 删除这个交叉引用，把 449–450 明确加入本条 BLOCKED 清单，说明缺少适用的已冻结处置；不得套用 TP-142 的动作。 |

T3-051 必须逐处保留的边界如下。这里每一行对应一处来源用例，不能只保留一个通用协议例来替代这些不同输入。

| 来源实例 | 公开目标接不住的断言及证据 | 固定改法 |
|---|---|---|
| `(a)` | engine、版本、units、三元边及 end：`tests/data/S8D-cpp-import-graph-script.test.ts:78`、`:82`、`:85`。 | 保留脚本 73–86 行。 |
| `(b)` | 包含原写法 `"h.h"` 的三元边：同文件 `:98`。 | 保留脚本 88–100 行。 |
| `(c)` | 包含原写法 `"x.h"` 的三元边：同文件 `:108`。 | 保留脚本 102–109 行。 |
| `(f)` | 函数体内 include 的三元边：同文件 `:117`。 | 保留脚本 111–118 行。 |
| `(i)` | units、start 顺序、两个单元各自结果和三元边：同文件 `:141`、`:142`、`:143`、`:144`、`:145`、`:146`。 | 完整保留脚本 130–147 行，不缩成仅 143 行。 |
| 去重例 | units 与连续的 done 编号：同文件 `:190`、`:191`、`:192`。 | 保留脚本 185–193 行。 |
| `(d)` | 保留宏原词 `HDR` 的三元边：同文件 `:219`。 | 保留脚本 213–221 行。 |
| macro comment／`(p)` | 注释后的宏原词 `HDR`：同文件 `:229`。 | 保留脚本 223–231 行。 |
| 400 字节／`(r)` | 长注释之后仍保留宏原词 `HDR`：同文件 `:251`。 | 保留脚本 242–253 行。 |
| `(e)` | ready 的实际编译单元列表：同文件 `:301`。 | 保留脚本 296–305 行。 |
| `(m)` | 原写法 `"uv/errno.h"` 的三元边：同文件 `:330`。 | 保留脚本 318–332 行。 |
| `(k)` | ready 单元顺序及 `"used.hpp"` 三元边：同文件 `:347`、`:352`。 | 保留脚本 334–354 行。 |
| `(l)` | 原写法 `"bad.hpp"` 的三元边：同文件 `:365`。 | 保留脚本 356–366 行。 |

**3. 白名单补项与归属冲突**

下表列出当前 T3 白名单之外、完成上述动作所涉及的文件。有其他组归属的文件不能直接加入 T3 造成并行重叠，应把对应修改并入该组任务并记录依赖。

| 文件及依据 | 哪个条目 | 在另一组白名单上？ |
|---|---|---|
| `tests/helpers/runtime-capabilities-fixture.ts`，新文件由 `.lead-ref/books/t-items-T3.md:20` 要求 | T3-003 | 否 |
| `tests/data/S8A-file-graph.test.ts:33` | T3-062 | 否 |
| `tests/data/S8E-A25-strict-capture.test.ts:35` | T3-062 | 否 |
| `tests/data/S8E-A07-git-inventory.test.ts:21` | T3-063 | 否 |
| `tests/helpers/observation-source-fixture.ts`，新文件由 `.lead-ref/books/t-items-T3.md:531` 要求 | T3-076 | 否 |
| `tests/work-graph/W2-agent-whiteboard.test.ts:192` | T3-096 | **T1**，`.lead-ref/books/t-files-T1.txt:72`；按前述改法由 T1-066 完成 |
| `tests/helpers/S2A-window-fixture.ts:48` | T3-103 | 否 |
| `tests/helpers/S5-application-support.ts:109` | T3-103 | 否 |
| `tests/helpers/S5R2-b-support.ts:82` | T3-103 | 否 |
| `tests/helpers/S5R2-c-support.ts:937`，工厂转发另见 `:226` | T3-103 | **TP**，`.lead-ref/books/t-files-TP.txt:154` |
| `tests/runtime/K3-B3-cancellation-cancelled.test.ts:185` | T3-103 | 否 |
| `tests/scenarios/K3-20-review-card-paging.test.ts:297` | T3-103 | 否 |
| `tests/work-graph/K3-26-unknown-call-review-storage.test.ts:344` | T3-103 | **T1**，`.lead-ref/books/t-files-T1.txt:22` |
| `tests/work-graph/S5-decision-queue.test.ts:43` | T3-103 | 否 |
| `tests/work-graph/S5-goal-settings.test.ts:331` | T3-103 | 否 |
| `tests/work-graph/S5-notices.test.ts:56` | T3-103 | **TP**，`.lead-ref/books/t-files-TP.txt:218` |
| `tests/work-graph/WP2-context-extensions.test.ts:209` | T3-103 | **T1**，`.lead-ref/books/t-files-T1.txt:73` |
| `tests/helpers/S5-decision-fixture.ts:440`、`:463`，共用后端注册 | T3-103 | **TP**，`.lead-ref/books/t-files-TP.txt:150` |
| `tests/helpers/S5-goal-settings-support.ts:173`、`:189`，当前独立工厂和转发 | T3-103 | **TP**，`.lead-ref/books/t-files-TP.txt:151`；归并时处理 |
| `tests/helpers/S5R2-d-support.ts:240`、`:256`，当前独立工厂和转发 | T3-103 | **TP**，`.lead-ref/books/t-files-TP.txt:155`；归并时处理 |

T3-103 另外两个直接调用方已经在本组：`tests/app/S5-decision-routes.test.ts:223`、`tests/helpers/K3-review-card-fixture.ts:329`。连同上表的 11 个，13 个直接调用文件已全部核对。

T3 没有 `src/` 下的 change/delete 动作；run 文件也明确排除生产文件，因此不存在本组应迁移的生产符号调用方。相关约束见 `.lead-ref/books/t-run-T3.md:5`、`:11`。本次仍检查了 helper 删除、取消导出及替换的引用。

**4. 必须共同落地或明确顺序的条目**

| 条目 | 顺序或共同施工要求 | 依据 |
|---|---|---|
| 002、003 | 同一文件负责人处理：共享 Host 夹具抽取后，002 的保存、关闭、重开路径必须使用最终夹具。 | `.lead-ref/books/t-items-T3.md:13`、`:20` |
| 011、012、087 | 011、012 同改 S2B-41；012 和 087 同改共享 support。先固定共享入口，再接真实 closeOpenTurn。 | `.lead-ref/books/t-items-T3.md:76`、`:83`、`:608` |
| 018、019、020 | 先把失败、取消断言完整迁到 observation-state，再删除来源；020 的无用注入参数清理由同一来源文件负责人完成。 | `.lead-ref/books/t-items-T3.md:125`、`:132`、`:139` |
| 028、030、031、103 | 028、030 共改 K3-review-card-fixture；030、031 共改 K3-46/UR7；103 又改该共享夹具的 reader。必须指定唯一文件负责人，不能分别覆盖。 | `.lead-ref/books/t-items-T3.md:195`、`:209`、`:216`；`tests/helpers/K3-review-card-fixture.ts:329` |
| 032、033、034 | 同一文件负责人合并处理；032 删除一行组，033 替换 receipt 行，034 收拢剩余 Workflow 构造。保留仍在使用的 untouched。 | `.lead-ref/books/t-items-T3.md:223`、`:230`、`:231`、`:237` |
| 041、042 | 先完成两段公开转换，最后才删除共用 raw schemas、seed event 和 ledgerPath；不能在 041 后提前删掉 042 尚在使用的内容。 | `.lead-ref/books/t-items-T3.md:287`；`tests/composition/W1-future-plan-platform.test.ts:186` |
| 045、046 | 按前述修订统一归 046，不能再执行原 045。 | `.lead-ref/books/t-items-T3.md:314`、`:321` |
| 047～051 | 047～050 是 051 总括范围内的具体子例，按一份源用例清单执行一次；先冻结上述协议保留边界。 | `.lead-ref/books/t-items-T3.md:328`、`:335`、`:342`、`:349`、`:356` |
| 052～060 | 052～059 是 060 总括范围内的具体子例；057、058 还是同一源 `it` 的两半，必须一起迁完才能删除。 | `.lead-ref/books/t-items-T3.md:419`；`tests/data/S8D-cpp-import-graph-script.test.ts:451`、`:457` |
| 060、062 | 同改 language-providers，由同一文件负责人处理；修订后 060 保留脚本 libclang 协议例。 | `.lead-ref/books/t-items-T3.md:419`、`:435` |
| 063、064、065、076 | 先冻结各来源用例去向及断言，再抽取剩余 inventory 测试需要的读取夹具；不能按旧行号重复删除。 | `.lead-ref/books/t-items-T3.md:440`、`:447`、`:454`、`:531` |
| 069～074 | 071 是 069、070、072、073、074 的总括，不是额外五次迁移；157–164 必须保留，vendor 的 reason:null 只补一次。 | `.lead-ref/books/t-items-T3.md:496`；`tests/data/S8D-python-import-graph-script.test.ts:157`、`:171` |
| 079、084 | 先给 runK3ReviewRound 加 planRef 并接通 079，再完成同文件导出收口；保留新调用仍需的函数。 | `.lead-ref/books/t-items-T3.md:552`、`:587`；`tests/helpers/K3-proposal-round.ts:810` |
| 080、081、082 | 必须同一批：先改两个 importer 和转出口，再删旧转出文件及常量。 | `.lead-ref/books/t-items-T3.md:559`、`:566`、`:573` |
| 095、096、106、T1-066 | W2 helper 由唯一负责人维护；T1 四个调用及 A2 第五个调用迁完后，才删 seedAgentCandidate。106 的其余 BLOCKED 行不应阻止单独完成这个已明确的调用替换。 | `.lead-ref/books/t-items-T3.md:671`；`.lead-ref/books/t-items-T1.md:462`；`tests/work-graph/A2-disposition-change.test.ts:599` |
| 103 与 TP/T1 接线 | 共用工厂、schema、有序转发及全部调用方先完成，最后删除 stub。TP 的复制工厂合并必须与此共享最终接口。 | `.lead-ref/books/t-items-TP.md:690`、`:704`、`:711`；`tests/helpers/executed-files-stub.ts:21` |
| 102、105 | 共用 WP2-platform-support 的文件负责人；105 若增加 fixture 能力，102 的导出收口按最终调用关系进行。 | `.lead-ref/books/t-items-T3.md:713`、`:734` |

**5. 总书和 run 文件的规则问题**

1. **“删除、合并优先，转换最后”不能作为无条件顺序。** 它会让 096、103 先删掉转换仍需要的 helper。应改为“按依赖顺序；消费者迁移和目标覆盖完成后再删除来源；同批接口变更保持完整”。依据：`.lead-ref/books/t-run-T3.md:6`、`.lead-ref/books/t-items-T3.md:671`、`:720`。

2. **白名单例外与实际任务边界没有闭合。** 总书只允许为编译移除外部导入或使用；T3-062、063、096、103 涉及新增前置、断言和真实 reader 接线，不能套用这个例外。应采用上表的文件归属及交付顺序，并在 run 文件中明确这些跨组依赖。依据：`.lead-ref/books/t-book.md:30`、`:31`；`.lead-ref/books/t-run-T3.md:5`。

3. **新 helper 的命名要求没有落实。** 总书只允许点名的新 helper，但 003、076 没有文件名，062 仍写“如”。应把三个目标文件名按本次表格固定。依据：`.lead-ref/books/t-book.md:64`；`.lead-ref/books/t-items-T3.md:20`、`:433`、`:531`。

4. **若按规则表字面执行，普通 Plan 提案输入与禁止的“手造 draft”边界仍有歧义。** A1 禁止 helper 接收 draft，F1 禁止 owner 接受 built draft；而 009、042、096 指定公开 Plan 提议流程，096 指定的 helper 确实接收 `PlanRevisionDraft`。应由 lead 在再次冻结前明确“合法公开命令输入”和“手造派生事实”的边界，并同步这些条目的具体构造要求；不能留给 DSH 自行解释为例外。依据：规则表 `:24`、`:57`；`.lead-ref/books/t-items-T3.md:62`、`:293`、`:671`；`tests/helpers/W2-whiteboard-fixture.ts:292`、`:296`。这项是规则文字问题，本审查没有据此重新裁决这些 Plan 行的保留价值。

5. **条目中的显式例外不能覆盖总书的禁止项。** 008 的“注释即可”、030 的睡眠抽取、033/037 的输出期望、103 的替代 stub、105 的假 Workflow、106 的 keep-note，均需按上表直接修正文案。规则表 A7 当前为空，不能把这些写法当成已点名豁免。依据：规则表 `:52`；`.lead-ref/books/t-book.md:44`、`:48`、`:52`、`:65`。

**6. 同一批需改条目的 JSON**

```json
[
  {
    "id": "T3-003",
    "problem": "共享夹具没有固定文件名，且缺少白名单项。",
    "fix": "固定新文件为 tests/helpers/runtime-capabilities-fixture.ts；抽取 directory/startHost/readCapabilities，保留两调用方的 scope、adapter、名称、时钟和清理行为。",
    "files_add": ["tests/helpers/runtime-capabilities-fixture.ts"]
  },
  {
    "id": "T3-008",
    "problem": "允许只在注释保留 RL-34，与总书要求规格编号进入目标测试名冲突。",
    "fix": "目标测试名同时保留 RL-44 和 RL-34，并注明工作台命令页覆盖；删除“或注释”。",
    "files_add": []
  },
  {
    "id": "T3-009",
    "problem": "真实架构基线会改变 revision；同一世界连续采用 Plan 还会增加 graphChangedElements 的 revision 计数，不能照留原全部期望。",
    "fix": "补齐真实 Project、Workspace、Goal、政策及架构前置；S0-01 使用独立计算的完整 plan:p1|arch:… 期望；S0-02/03 使用标识、基线、状态相同的独立世界，仅改变 requires 字段，保留原四个变化计数。",
    "files_add": []
  },
  {
    "id": "T3-018",
    "problem": "目标先有旧观测且只检查原因子串，未覆盖来源 current:null 和精确原因断言。",
    "fix": "L8-7/L8-8 均加入无旧观测来源变体，搬入完整 code、精确 reason、requestSeq、pending、failed、current:null；保留已有旧观测变体，再删除来源。",
    "files_add": []
  },
  {
    "id": "T3-019",
    "problem": "来源三种取消场景的 current:null 没有被目标旧观测场景覆盖。",
    "fix": "L8-9/L8-10/L8-11 各加入无旧观测变体，保留 current:null 及 failure=0、capture=0、state=1；保留目标原有旧观测断言。",
    "files_add": []
  },
  {
    "id": "T3-029",
    "problem": "busy 后恢复 Goal、同一 requestId 再成功的行为仍是未决取舍。",
    "fix": "目标参数化为真实崩溃和 Goal 暂停后恢复两种前置；暂停分支保留 busy、恢复、同一请求 hold 重放、requeue 首次提交及仅一个 continuation 的断言。",
    "files_add": []
  },
  {
    "id": "T3-030",
    "problem": "拟抽取的 waitForSettledDriver 使用 setTimeout 轮询，违反新 helper 的规则要求。",
    "fix": "创建 driver 时安装 onChange 通知，等待通知后通过 driver.read 检查终态，保留首次立即读取，删除两份睡眠轮询并一起迁移调用点。",
    "files_add": []
  },
  {
    "id": "T3-033",
    "problem": "动作指定把捕获的 owner 输出直接作为完整期望，违反独立期望规则。",
    "fix": "从固定输入和确定调用序列独立列出完整 expectedOwnerResult，分别比较 owner 结果和 receipt.result；包装原样返回真实结果，并保留 next:select_work。",
    "files_add": []
  },
  {
    "id": "T3-034",
    "problem": "原样合并会把假 Goal settings 和 Map messages 替身带入新 helper。",
    "fix": "goalSettings 固定接 world.goalSettings；暴露 world 已创建的真实 mailbox，messages 接该 mailbox，删除 byMessageId 替身；保留 consumerId 和真实 apply 结果观察回调。",
    "files_add": []
  },
  {
    "id": "T3-037",
    "problem": "要求用 install/adopt 返回的 digest 替代独立期望。",
    "fix": "根据固定政策、基线输入和请求标识独立列出预期 ref/contentDigest；返回值只用于后续公开调用的引用传递，不作为这两条断言的期望。",
    "files_add": []
  },
  {
    "id": "T3-045",
    "problem": "合并目标属于 T3-046 要删除的整块，与其保留 compact-snapshot 的动作冲突。",
    "fix": "标为由 T3-046 统一处理、不单独施工；保留 compact-snapshot 的 76–82 行，统一删除 codecs 的 261–301 行。",
    "files_add": []
  },
  {
    "id": "T3-051",
    "problem": "公开二元图不能承接脚本三元说明符、ready units、start/done 编号和协议断言；脚本 i 的保留范围也有两种选择。",
    "fix": "保留脚本 (a)73–86、(b)88–100、(c)102–109、(f)111–118、(i)130–147、去重185–193、(d)213–221、macro comment223–231、长注释242–253、(e)296–305、(m)318–332、(k)334–354、(l)356–366；其余能由公开图完整表达的指定用例继续合并；删除“至少保留143行”的选择。",
    "files_add": []
  },
  {
    "id": "T3-060",
    "problem": "合并、嵌套、固定 target 和缺 libclang 的脚本协议断言没有公开覆盖；嵌套例输入也不相同。",
    "fix": "保留脚本 377–389、391–403、472–478、521–529 四例及协议断言，其余指定 A-23 用例继续合并；删除这四例可整例删除的描述。",
    "files_add": []
  },
  {
    "id": "T3-062",
    "problem": "另外两个来源文件不在白名单，新 helper 名仍是示例。",
    "fix": "固定目标 tests/helpers/workspace-tools-fixture.ts；补入两个来源文件，保留 denied、fileGraph、capture limits、sourceAnalyzers 及包装方法差异。",
    "files_add": [
      "tests/data/S8A-file-graph.test.ts",
      "tests/data/S8E-A25-strict-capture.test.ts"
    ]
  },
  {
    "id": "T3-063",
    "problem": "需要增强的 A07 合并目标不在白名单。",
    "fix": "补入目标文件；先完成跟踪后删除文件、跟踪符号链接两种输入和排除断言，再删来源；未完成则 BLOCKED。",
    "files_add": ["tests/data/S8E-A07-git-inventory.test.ts"]
  },
  {
    "id": "T3-064",
    "problem": "只维持 nodes 不变未覆盖 .git 不进 skipped，也未保留 build/compile_commands.json 本身作为普通文件的断言。",
    "fix": "目标加入 .git/config、a/keep.ts 和来源相同的 build/compile_commands.json，精确断言三个保留文件路径，并断言所有 language issues 合并后为空；删除 page.nodes 不变及间接覆盖说明。",
    "files_add": []
  },
  {
    "id": "T3-076",
    "problem": "工作区读取层共享夹具没有固定文件名和白名单项。",
    "fix": "固定新文件 tests/helpers/observation-source-fixture.ts；统一 tempRoot/git/write/context/bindingsFor/projectAccessOf/observe，保留 scope、actor、workspaceRevision、allowsRead 参数及真实 access 释放。",
    "files_add": ["tests/helpers/observation-source-fixture.ts"]
  },
  {
    "id": "T3-096",
    "problem": "四个调用点属于 T1，且已由 T1-066 分配同一转换。",
    "fix": "四个 W2 调用继续由 T1-066 修改；T3 修改 A2 第五处。T1 转换合入后，T3 才删除 seedAgentCandidate 的接口、实现和返回字段。",
    "files_add": ["tests/work-graph/W2-agent-whiteboard.test.ts"]
  },
  {
    "id": "T3-103",
    "problem": "替代方案仍是手造 DTO；三个下游工厂缺真实 lookupOrdered 转发；11个直接调用文件及额外后端工厂不在 T3 白名单。",
    "fix": "只用真实 reader；通过 TP 的共用工厂合并统一注册 RUN_ACTIVITY_RECORD_SCHEMAS 并完整转发真实 lookupOrdered，禁止仅类型断言。无归属文件补入 T3，TP/T1 文件由现有负责人完成，全部调用方接线完成后才删除 stub；逐个按真实前置检查冲突卡。",
    "files_add": [
      "tests/helpers/S2A-window-fixture.ts",
      "tests/helpers/S5-application-support.ts",
      "tests/helpers/S5R2-b-support.ts",
      "tests/helpers/S5R2-c-support.ts",
      "tests/runtime/K3-B3-cancellation-cancelled.test.ts",
      "tests/scenarios/K3-20-review-card-paging.test.ts",
      "tests/work-graph/K3-26-unknown-call-review-storage.test.ts",
      "tests/work-graph/S5-decision-queue.test.ts",
      "tests/work-graph/S5-goal-settings.test.ts",
      "tests/work-graph/S5-notices.test.ts",
      "tests/work-graph/WP2-context-extensions.test.ts",
      "tests/helpers/S5-decision-fixture.ts",
      "tests/helpers/S5-goal-settings-support.ts",
      "tests/helpers/S5R2-d-support.ts"
    ]
  },
  {
    "id": "T3-105",
    "problem": "转换仍指定假 Workflow，且要求保留的 harness 使用手造结果、睡眠和数据库快照断言。",
    "fix": "接真实 Workflow 的 advanceWork/consumeConsultation，包装只计数、设闸、原样返回；两分支分别由真实 send_user_message/send_session_message 产生状态。等待使用真实闸门和 driver 通知；零变化通过公开读取及真实提交委托计数检查，删除 completedAdvance、手造 consultation 和 storeSnapshot 断言。",
    "files_add": []
  },
  {
    "id": "T3-106",
    "problem": "enter/recordRunResult 前置违反规则；不可达状态的 keep-note 与总书冲突；449–450 引用的 A1-17 是无关条目。",
    "fix": "可达分支使用 claimTask→Runtime.prepareExecution→Runtime.startRun 和真实停止/检查/completeTask；447–448、449–450及479–508明确标为 BLOCKED，删除 keep-note 和错误 A1-17 引用，待 lead 冻结这些行的处置后重新下发，不保留造态也不修改守卫文字求通过。",
    "files_add": []
  }
]
```

`files_add` 表示需要补齐编辑归属的文件；其中已有 TP/T1 归属者按上文交由原负责人处理，不能机械加入 T3 形成重叠。

**7. 检查完成情况**

- **完整核对：T3-001～T3-106，106/106。** 包括来源、命名目标、删除依据、转换入口、引用关系、白名单和相互依赖。
- **只略读：无。**
- **未检查：无。**

未列入问题表的条目，本次未发现独立的代码或范围阻塞；这不替代施工后的构建与测试验收。