本次只读检查了 F 区清单中的 **110 个辅助文件**，并搜索整个 `tests/` 树核对引用和调用方；没有写文件、运行测试或构建，也没有访问网络。共列 **52 项候选**。其中 13 个文件全文阅读，97 个文件按导出、构造流程、直接写入和调用方定向阅读；具体覆盖范围列在报告末尾，不能把略读文件视为已完成逐行审计。

以下统一约定：

- **D79**：`docs/refactor/HANDOFF.md:565-570`、`:584-597`。旧开发格式不再兼容；手写事实改走公开步骤；删除必须有依据。`legacy_template` 明确排除在旧格式清理之外。
- **E0**：用 `rg` 在整个 `tests/` 树搜索符号及文件引用，确认没有消费者；F-03～F-14 所列符号均只有定义处命中。F-01、F-02 另有内部引用或注释引用，已单独追踪。这里删除的是无人使用的辅助代码，**不删除任何测试用例或断言**。
- **P0，现有公开初始化流程**：`src/core/work-graph/configuration/project-bootstrap-service.ts:528` 的 `createProject`、`:601` 的 `registerWorkspace`、`:699` 的 `installCompletionPolicy`、`:812` 的 `activateCompletionPolicy`；架构采用入口是 `src/core/work-graph/architecture/catalog-service.ts:454`。已有完整使用示例：`tests/helpers/S1-workflow-archive-fixture.ts:304-337`。
- **P1，现有公开执行流程**：`src/core/work-graph/tasks/claim-service.ts:886` 的 `claimTask`；`src/core/work-graph/tasks/execution-entry-service.ts:1343`、`:1574`、`:1673` 的授权、开始进入、记录已进入；结果写入示例为 `tests/helpers/S2C-L-runs-support.ts:184-203` 的 `recordRunResult`。
- 估计行数只计算 **F 区辅助文件**中删除或改写的行，不包括其他区域的调用方测试。复制夹具合并计在 F-15～F-19；共用底座的事实改写另计，避免把同一份副本重复计算。数字是工作量估计，不是净删行承诺。`keep-note` 尚不能确定改动范围，计 0。
- “规格行＝是”表示调用方包含冻结规格行；合并、转换必须保留其场景、断言和后端组合。旧格式专用规格行按 D79 的明确变更处理。

| 编号 | 类别 | 位置；测试或辅助函数名 | 证据 | 建议 | 被谁覆盖／删除依据 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---:|:---:|:---:|
| F-01 | 辅助 | `tests/helpers/WP2-duties-fixture.ts:34,44-49,64-220`；`openWP2DutiesFixture` 及专属依赖 | 全树只有本文件定义、内部调用和返回类型引用；实际调用方 `tests/work-graph/WP2-message-duties.test.ts:26` 只导入 `wp2LegacyDuty`、`wp2RoleContent`。`installWP2Role` 仅被无人调用的工厂使用（`:74,110`）。 | `delete`，只删死工厂及专属依赖 | 不删测试；保留本文件 `:33,37-42,51-62` 的现用常量及两个函数。 | 164 | 否 | 高 |
| F-02 | 辅助 | `tests/helpers/K3-proposal-round.ts:898-921`；`K3AwaitingApprovalState`、`reachK3AwaitingApproval` | 全树无调用；名称在文件头 `:40,54` 仅为示例。函数只是串接已有的提议、结束 Run、结算流程（`:913-915`）。 | `delete` | 无消费者，不删规格测试；保留实际使用的下层流程。 | 24 | 否 | 高 |
| F-03 | 辅助 | `tests/helpers/B2-crr-world.ts:226-238`；`runSnapshotOf` | E0。`:228` 声称为 `K3-UR7-crr-failed-set` 保留，但全树没有该函数的使用处。 | `delete` | 无消费者；不删测试。 | 13 | 否 | 高 |
| F-04 | 辅助 | `tests/helpers/RL-resource-caps-support.ts:33-34,140-142,236-239` | E0：`RL_PROBE_MEMORY_BYTES`、`RL_PROBE_TASKS_MAX`、`appendLine`、`unitLoadState` 均无消费者。 | `delete` | 无消费者；不删 RL 规格行。保留仍被使用的 `systemctlUserShow`（`:232`）。 | 9 | 否 | 高 |
| F-05 | 辅助 | `tests/helpers/S1-runtime-scenario-fixture.ts:59`；`S1_T1` | E0。 | `delete` | 无消费者；不删测试。 | 1 | 否 | 高 |
| F-06 | 辅助 | `tests/helpers/S2B-r2-calendar-reverify-support.ts:149`；`CalendarReverifyContext` | E0。 | `delete` | 无消费者；不删测试。 | 1 | 否 | 高 |
| F-07 | 辅助 | `tests/helpers/S2C-D-node-support.ts:630-636`；`incompleteAnomalies` | E0。注释称服务于 2C-28，但没有调用。 | `delete` | 无消费者；不删 2C-28，也不据此删除“不完整计数”行为。 | 7 | 否 | 高 |
| F-08 | 辅助 | `tests/helpers/S2C-K-scenario-support.ts:33,127-129,172-174` | E0：`LinePageRead`、`sessionRefOf`、`lineWrite` 无消费者。 | `delete` | 无消费者；保留文件内实际使用的行读取和维护流程。 | 7 | 否 | 高 |
| F-09 | 辅助 | `tests/helpers/S2C-K2-scenario-support.ts:35-37`；`sessionRefOfCard` | E0。 | `delete` | 无消费者；不删测试。 | 3 | 否 | 高 |
| F-10 | 辅助 | `tests/helpers/S4C2-note-card-fixture.ts:42-43`；`S4C2_FILE_A/B` | E0。 | `delete` | 无消费者；不删注记卡规格行。 | 2 | 否 | 高 |
| F-11 | 辅助 | `tests/helpers/W2-whiteboard-fixture.ts:77-79`；`W2AgentApplyRequest` | E0。 | `delete` | 无消费者；不删 W2 测试。 | 3 | 否 | 高 |
| F-12 | 辅助 | `tests/helpers/WP1-handover-fixture.ts:437,508,518,529,564` | E0：五个返回类型别名 `InterruptedHandoverFixture`、`RoleMismatchHandoverFixture`、`ReusablePredecessorFixture`、`ArchivedPredecessorFixture`、`RetiredContinuationFixture` 无使用处。对应工厂仍有用。 | `delete`，只删五个类型别名 | 无消费者；保留对应工厂及测试。 | 5 | 否 | 高 |
| F-13 | 辅助 | `tests/helpers/WP2-platform-support.ts:866-868`；`goalSettingsWith` | E0。 | `delete` | 无消费者；不删测试。 | 3 | 否 | 高 |
| F-14 | 辅助 | `tests/helpers/orchestration-fixture.ts:146-148`；`isYielded` | E0。 | `delete` | 无消费者；不删 yielded 业务覆盖。 | 3 | 否 | 高 |
| F-15 | 辅助 | `tests/helpers/S5-goal-settings-support.ts:1-10,169-789`；`openS5GoalSettingsFixture` | 文件头明确说明复制 S5 工厂；对照 `tests/helpers/S5-decision-fixture.ts:459-1060`，重复搭建存储、服务、Session、Run、Query、候选和消息。差异是采用真实目录，以及 B@5→采用@6→暂停@7（本文件 `:5-8,271-281`）。 | `merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture` | 保留 SS11/SS12/SS15 的暂停检查点和真实目录；通过初始化选项表达差异，不删除用例。 | 500 | 是 | 高 |
| F-16 | 辅助 | `tests/helpers/S5R2-c-support.ts:1-9,206-828`；`openS5R2CompletionFixture` | 文件头明确是 `S5-goal-settings-support` 副本，只改采用前策略与 requirement kind 为 static。后面的 `assembleS5R2C` 从 `:831` 开始，是本组独有部分。 | `merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture` | 与 F-15 共用初始化；保留 static 前提及 `:831` 之后的 C 组流程，不能把 static 改回 test。 | 650 | 是 | 高 |
| F-17 | 辅助 | `tests/helpers/S5R2-d-support.ts:1-7,236-841`；`openS5RuntimeFixture` | 文件头明确因原工厂不能配置进入时工具而复制；区别是在进入前授予两个计划工具。`orderedDriver` 等独有辅助从 `:844` 开始。 | `merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture` | 保留进入前授权差异和 `:844-952` 的 driver；不能改为进入后篡改授权。 | 550 | 是 | 高 |
| F-18 | 辅助 | `tests/helpers/S1-workflow-archive-fixture.ts:160-791`；内嵌 claim/B2 工厂 | 与 `tests/helpers/task-claim-fixture.ts:160-453`、`tests/helpers/B2-execution-fixture.ts:104-331` 重复了 claim、准备、进入和读取结构；S1 另有审计存储、可控时钟、公开初始化（`:304-337`）和逐 claim 的 Kernel 身份（`:740-746`）。 | `merge-into:tests/helpers/B2-execution-fixture.ts::createB2ExecutionFixture` | 提取共同底座，保留 S1 审计、时钟和独立 Kernel 身份。不可直接用仍手写初始化的旧底座替换。 | 350 | 是 | 中 |
| F-19 | 辅助 | `tests/helpers/S2B-runtime-store-fixture.ts:1-25,106-251`；`createS2BRuntimeStoreFixture` | `:15` 明说复制 `B2-runtime-fixture` 的构造；对照 `tests/helpers/B2-runtime-fixture.ts:168-310`。区别是公开 live store、重开后的绑定及活动读取。 | `merge-into:tests/helpers/B2-runtime-fixture.ts::createB2RuntimeFixture` | 保留 live store、SQLite reopen 和派生 reader；只抽共同 runtime 构造。 | 100 | 是 | 中 |
| F-20 | 过时 | `tests/helpers/SP-storage-migration-fixture.ts:1-31`；`addLegacyFtsArtifacts` | 专门造旧 `next_fts_meta` 和 `next_fts_%`。唯一调用是 `tests/record-store/SP-text-scan.test.ts:400-435`，`SP-12 … 4B-era file upgrade-compatibility check`。 | `delete` | 行为已不属保留范围：D79，尤其 `HANDOFF.md:566`“不写迁移”。当前索引重建/失效覆盖保留，如该测试文件 `:375-398`。 | 31 | 是 | 高 |
| F-21 | 过时 | `tests/helpers/S1-session-facts-fixture.ts:204-231`；`createLegacySession` | 手造无 provenance 的旧 accepted operation，故意绕过当前 admission，`:229` 断言 provenance 为 null。调用方包括 `tests/work-graph/S1-provenance.test.ts:214,292` 和 `S1-dispatch-guards.test.ts:151-153` 的 SV58。 | `delete` | 旧操作补读/推导路径按 D79 退出；保留同文件 `:181-202` 的当前公开 Session 创建流程。 | 28 | 是 | 高 |
| F-22 | 过时 | `tests/helpers/S2C-L-line-support.ts:466-477,710-712`；`createLegacySession` | 直接写无 provenance 的 Session；用于 D1 数据集和 `tests/work-graph/S2C-lines-page.test.ts:394-418` 的“2C-18 … legacy Session”。后者还手造旧 QueryRun（`:403-413`）。 | `delete`，仅旧 Session 分支 | 旧 provenance 缺失行为按 D79 退出。D1 其他工作线拓扑、当前 Work/Query 执行列表覆盖保留。 | 12 | 是 | 高 |
| F-23 | 过时 | `tests/helpers/graph-session-fixture.ts:403-417`；`seedLegacyArchitectureBaseline` | 写没有 catalog 的 baseline。专用用例 `tests/work-graph/A1-architecture-catalog.test.ts:169-177` 断言 `catalog:null`；另被 `:190` 的健康读取及 `A1-independent-review.test.ts:66` 的竞争前提借用。 | `delete`，先迁移非旧格式调用方 | 专用旧格式行为按 D79 退出；健康读取和竞争前提改用公开 `adopt`。当前采用/读取覆盖如 `A1-architecture-catalog.test.ts:195-207` 保留。 | 15 | 否 | 高 |
| F-24 | 过时 | `tests/helpers/S5-queue-support.ts:284-298,384,400`；`legacyNoticeWire` | 截获真实提交后删 `since`、`noticeAutomationCap` 和 cursor binding。调用方 `tests/work-graph/S5-notices.test.ts:271-284` 的 NR08 专测旧上限未知。 | `delete`，同时去掉旧格式选项 | 旧通知格式按 D79 退出；当前 reverify 历史与计数覆盖 `S5-notices.test.ts:258-269` 的 NR07 保留。 | 15 | 是 | 高 |
| F-25 | 过时 | `tests/helpers/S2A-notices-support.ts:95-132`；`legacyRequeueRecords/legacyRequeueItemKeys` | 克隆 requeue、改 task/run 身份，并省略 `since`。`tests/work-graph/S2A-notices-rework.test.ts:37-64` 的 QA-11 专测旧记录排序及分页。 | `delete` | 旧无游标 requeue 格式按 D79 退出；当前 requeue 生成路径 `S2A-notices-support.ts:134-164` 及真实提交排序仍保留。 | 38 | 是 | 高 |
| F-26 | 过时 | `tests/helpers/S2B-activity-fixture.ts:250-266`；`openLegacyRound` | 先真实开轮次，再删除 `since`。调用方 `tests/work-graph/S2B-activity-calendar.test.ts:235-241` 将旧轮次混入正常 checks 聚合测试。 | `delete`，仅删旧轮次准备和对应断言 | 旧格式按 D79 退出；同一测试 `:221-233,249` 的当前轮次 checks 聚合必须保留。 | 17 | 是 | 高 |
| F-27 | 过时 | `tests/helpers/S2B-track-fixture.ts:836-851,880-881`；`stripRoundKey` | 删除 `since/finalizedAt`；唯一对应场景为 `tests/work-graph/S2B-30-track-bars.test.ts:188-207`，断言两种旧轮次计入 unplaced。 | `delete` | 旧轮次兼容按 D79 退出；当前轮次轨道及真实无 owner 的 gate 行 `S2B-30-track-bars.test.ts:209` 起保留。 | 16 | 是 | 高 |
| F-28 | 过时 | `tests/helpers/S2B-task-timeline-fixture.ts:648-679,824-825`；`seedRoundRaw` | 直接造没有 `since`、可缺 `finalizedAt` 的轮次。调用方 `tests/work-graph/S2B-33-task-timeline-pagination.test.ts:106-109` 明确构造 pre-2B 轮次。 | `delete` | 旧格式按 D79 退出；当前公开轮次路径 `S2B-task-timeline-fixture.ts:826-831` 和 `S2B-32-task-timeline-fold.test.ts:207-223` 保留。 | 32 | 是 | 高 |
| F-29 | 手写事实 | `tests/helpers/task-claim-fixture.ts:198-234`；scope/governance 初始化 | 手写 Project、Workspace、策略、active pointers 和无 catalog baseline。P0 已存在；S1 的对应底座已经公开初始化（`S1-workflow-archive-fixture.ts:304-337`）。 | `convert:createProject→registerWorkspace→install/activateCompletionPolicy→adoptInitialArchitecture` | 保留所有 claim 行为；用当前 catalog baseline，并逐项保持输入、版本前提。 | 37 | 是 | 高 |
| F-30 | 手写事实 | `tests/helpers/graph-session-fixture.ts:322-351`；scope/policy seed | 直接提交 Project、Workspace、策略和 active pointer；这些均有 P0 生产入口。 | `convert:createProject→registerWorkspace→install/activateCompletionPolicy` | 保留 A1 架构和 Session 测试；不要预先采用架构，影响“尚无 baseline”前提。 | 30 | 否 | 高 |
| F-31 | 手写事实 | `tests/helpers/graph-session-fixture.ts:433-469`；`seedAcceptedTask` | 手写 Goal、accepted Plan 和 active pointer；架构 pin 还是虚构 digest（`:441-447`）。已有公开创建/提议/采用示例：`tests/helpers/task-claim-fixture.ts:274-310`。 | `convert:createGoal→proposePlan→applyPlanChange` | 保留 `tests/work-graph/A1-session-lifecycle.test.ts:132-152` 等任务责任/归档场景。 | 37 | 否 | 高 |
| F-32 | 手写事实 | `tests/helpers/graph-session-fixture.ts:472-481`；`overwriteSession` | `A1-session-lifecycle.test.ts:137-142` 用它凭空设置 execution occupancy 再清空；业务目标是验证忙碌归档和未解除责任。P1 可产生真实占用和释放。 | `convert:claimTask→公开进入/结束流程` | 保留 `A1-session-lifecycle.test.ts:132-152` 的 busy、责任未解除、解除后归档断言。 | 10 | 否 | 高 |
| F-33 | 手写事实 | `tests/helpers/C1-mailbox-fixture.ts:103-110,121-167`；`createC1Harness` | 先伪造 running/entered 授权，再补 manifest、input binding 和授权 digest。P1 已有入口；`tests/helpers/B2-execution-fixture.ts:274-305` 已串起真实进入流程。 | `convert:准备manifest→authorizeRuntimeEntry→beginRuntimeEntry→recordExecutionEntered` | 保留 C1 mailbox 行为，包括 `C1-session-mailbox.test.ts:128-170` 和 `:336-352`；后续任意改写另见 F-52。 | 55 | 否 | 高 |
| F-34 | 手写事实 | `tests/helpers/B2-runtime-fixture.ts:198`；另见 `S2B-runtime-store-fixture.ts:137` | 安装角色后直接改已有 Session.role。`tests/helpers/task-claim-fixture.ts:318-331` 的 `createSession` 已接受角色；`S2B-be1-platform-fixture.ts:219` 已这样使用。此处是初始化问题，不能称为运行中热切换。 | `convert:createSession(role_spec pin)→claimTask` | 保留 runtime 测试；在创建时绑定角色。副本随 F-19 合并，不重复计行。 | 1 | 是 | 高 |
| F-35 | 手写事实 | `tests/helpers/S5-decision-fixture.ts:539-574`；基础 scope/governance/Goals | 原始提交 Project/Workspace、策略/旧 baseline、三个 Goal；副本对应 `S5-goal-settings-support.ts:252-287`、`S5R2-c-support.ts:289-324`、`S5R2-d-support.ts:319-350`。 | `convert:P0初始化→createGoal→公开设置/控制步骤达到冻结检查点` | 保留 S5 的 Goal@7、Workspace@3 等规格前提；不得把期望改成读取当前值。 | 36 | 是 | 中 |
| F-36 | 手写事实 | `tests/helpers/S5-decision-fixture.ts:810-826`；U1/U2 候选 | 直接写 proposal、request-head claim 和 `PlanProposalRecorded`。现有 `proposePlan` 支持 `requestRef/replaces`：`src/core/work-graph/tasks/plan-service.ts:1479-1528`。副本见 `S5-goal-settings-support.ts:540`、`S5R2-c-support.ts:577`、`S5R2-d-support.ts:589`。 | `convert:proposePlan(requestRef)` | 保留每请求唯一 head、候选来源与后续采用行为；通过真实 QueryJob 前提调用。 | 17 | 是 | 高 |
| F-37 | 手写事实 | `tests/helpers/S5-decision-fixture.ts:828-910`；pending/answered 决策消息 | 直接编码消息、sent/responded 事实。公开入口为 `mailbox-service.ts:3328` 的 `sendUserMessage`、`decision-service.ts:677` 的 `answerDecision`；已有 `tests/helpers/S5-user-message-support.ts:43-77,93-107` 示例。 | `convert:sendUserMessage→answerDecision` | 保留消息卡、答复、来源 pin 与应用行为；三份副本随 F-15～F-17 收拢。 | 83 | 是 | 高 |
| F-38 | 手写事实 | `tests/helpers/S2A-notices-support.ts:146-164`；`openManyTaskWorld` 策略准备 | 注释理由是共享 fixture 未注册 bootstrap schemas，并非没有生产入口；P0 已具备安装/激活策略方法。 | `convert:注册bootstrap schemas→installCompletionPolicy→activateCompletionPolicy` | 保留 QA-10 等真实 requeue 场景；不能以当前夹具缺 schema 为永久绕过理由。 | 19 | 是 | 高 |
| F-39 | 手写事实 | `tests/helpers/S2A-notices-workspace2-fixture.ts:88-112`；第二 Workspace/策略 | 直接 seed W2 scope 和 static policy；P0 已有 registerWorkspace、安装/激活策略入口。 | `convert:registerWorkspace→installCompletionPolicy→activateCompletionPolicy` | 保留跨 Workspace 通知隔离及原有预期。 | 25 | 是 | 高 |
| F-40 | 手写事实 | `tests/helpers/S5-queue-support.ts:274-275,304-314` | `openUninitializedQueue` 手写 Workspace@3；`noticeWork` 手写策略和 active pointer。创建 Goal 已走公开入口（`:278`），前置事实也可用 P0。 | `convert:P0 scope/策略流程` | 保留 DQ03 的“未初始化队列”及 noticeWork 场景；不能顺便采用架构或计划。 | 13 | 是 | 高 |
| F-41 | 手写事实 | `tests/helpers/S2B-task-timeline-fixture.ts:599-631,699-715`；`seedRunRaw` | yielded 和无 requeue 的后继分支直接造 Run，避开真实 wait/continuation。当前公开结果接口支持 continuation：`tests/helpers/S2C-L-runs-support.ts:184-203`；真实咨询流程见 `S1-workflow-archive-fixture.ts:980` 起。 | `convert:真实消息等待→recordRunResult(yielded,continuation)→claimTask续接` | 保留 yielded/后继时间线场景；必须实际建立等待消息和续接关系，不能只换成另一种 raw seed。 | 33 | 是 | 中 |
| F-42 | 手写事实 | `tests/helpers/S2B-task-timeline-fixture.ts:634-646,781-787`；`seedControlRaw` | 注释称进入前控制需要例外；但 `tests/helpers/S2B-r2-timeline-public-flows.ts:75-145` 已提供真实 claim、进入前 pause/resume 和之后 entry。 | `convert:claimRun→submitNotEnteredControl→enterClaim` | 保留 `tests/work-graph/S2B-32-task-timeline-fold.test.ts:226-233` 的“pause→paused、resume→pending、entry→running”规格行。 | 13 | 是 | 高 |
| F-43 | 手写事实 | `tests/helpers/W2-whiteboard-fixture.ts:329-359`；`seedAgentCandidate` | 手写 candidate、provenance 和事件；同文件 `:292-299` 已有两个 Run 的真实 `proposePlan` 包装。调用方分别测自身采用、别的 Run、重放及提交后取消（`W2-agent-whiteboard.test.ts:189,208,383,463`）。 | `convert:proposeAsWorkRun/proposeAsSecondWorkRun` | 保留上述四类行为及断言；使用真实返回的 proposal 身份。 | 31 | 否 | 高 |
| F-44 | 手写事实 | `tests/helpers/S2B-activity-fixture.ts:301-324`；`seedLegacyActivity` | 手写无 locator/dispatch 的旧 Run。除旧 session-null 场景外，还被当前 backfill 测试当填充数据：`tests/app/S2B-r2-backfill-done-cursor.test.ts:84`。 | `convert:真实claim/entry/result→writeActivity` | 保留 backfill 游标/扫描界限测试；旧无定位 Run 分支按 D79 移除，不能连同当前 backfill 用例一起删。 | 24 | 是 | 高 |
| F-45 | 手写事实 | `tests/helpers/S2C-X-scale-fixture.ts:411-452` | 克隆 29 个 picker Run，改 `anomalyAnchorRefs`；再复制 2,999 个历史 Run。注释承认 public claim/fail/requeue 路径存在，只因构造成本而例外。 | `convert:公开claim/prepare/entry/result及requeue循环` | 保留 30 anchors、3,000 Run 的规模和读成本断言；准备阶段成本需施工时实测，不能减少数据量代替转换。 | 42 | 是 | 中 |
| F-46 | 手写事实 | `tests/helpers/task-claim-fixture.ts:408-430`；`seedRun/overwriteSession` | 通用入口同时服务正常历史和不可达数据：`R4c-task-claim-boundaries.test.ts:98-103` 还把 plan 改成不存在的旧 plan；`R4c-execution-read.test.ts:423` 给 gate 写 Run；`R4c-execution-history-index.test.ts:915-917` 写 gate/不存在的任务。 | `keep-note` | 正常 Run 可走 P1；gate/不存在任务、任意 Session 改写没有“同状态”的合法公开造法。不能整函数机械替换，也不能批量删调用方。 | 0 | 是 | 高 |
| F-47 | 过时 | `tests/helpers/S2B-r2-activity-support.ts:40-73`；`seedActivityRun` 的 V1 使用方 | `tests/work-graph/S2B-r2-never-entered.test.ts:23-37` 专测 V1 authorization；但 helper 还服务当前 V2/位置事实及 cap 场景。真实 authorized-only 流程在该 helper `:75` 起。 | `keep-note` | V1 专用行按 D79 清理；helper 本身不是 V1 专用，不能整删。R5 当前格式规则保留。 | 0 | 是 | 高 |
| F-48 | 过时 | `tests/helpers/S2B-r2-track-support.ts:42-82`；`seedRawRunVariant` 的 V1 使用方 | `tests/work-graph/S2B-r2-r5-not-entered.test.ts:36-52` 专测 V1；同 helper 又用于无授权、有位置、当前 V2 等组合（该测试 `:54-92`）。 | `keep-note` | V1 专用行按 D79 清理；当前 R5 行及真实无法确认进入的情形不能因共享 helper 而一起删。 | 0 | 是 | 高 |
| F-49 | 只为篡改 | `tests/helpers/graph-session-fixture.ts:419-431`；`seedTamperedArchitectureBaseline` | 故意写与正文不符的 digest。调用方为 `A1-session-lifecycle.test.ts:112-120` 和 `A1-architecture-catalog.test.ts:179-193` 的 corrupt 子段。不是外部输入解码或真实存储故障。 | `delete`，只删篡改 helper 和相应子场景 | 保留范围由 `AGENTS.md:33` 排除。混合用例中的 missing pointer、健康读取仍保留；真实存储故障测试 `A1-architecture-catalog.test.ts:210` 起也保留。 | 13 | 否 | 高 |
| F-50 | 只为篡改 | `tests/helpers/S2B-r3-r4-support.ts:21-46`；`cloneSessionInWorkspace` | 复制 Session，仅改身份和 workspace，再让本 Workspace 的 Run 指向它；调用方 `tests/work-graph/S2B-r4-session-workspace.test.ts:44-86`。生产 `claim-service.ts:1025` 会拒绝外 Workspace Session，无法用正常 claim 产生同一关系。 | `keep-note` | 这是数据库拼接才出现的关系，但调用方是 R4 规格保护。需 lead 将 `AGENTS.md:33` 与冻结 R4 行对齐后再决定删/改；不能假称已有等价公开造法。 | 0 | 是 | 高 |
| F-51 | 手写事实 | `tests/helpers/B2-runtime-fixture.ts:192-196`；其他 coordination matrix seed 见证据 | 同类还有 `C2-runtime-platform-fixture.ts:106`、`K-readonly-work-support.ts:80`、`S2B-be1-platform-fixture.ts:208`、`S2B-runtime-store-fixture.ts:135`、`WP2-platform-support.ts:579`。全 `src/` 搜索未找到安装/激活 CoordinationPolicy 的公开入口；`configuration-contracts.ts:15-28` 只提供 RoleSpec 安装/激活和 binding 解析。 | `keep-note` | 当前未找到公开生产步骤，**不提出转换**，也不为本次清理新增产品接口。WP2 死工厂里的同类 seed 随 F-01 删除。 | 0 | 是 | 中 |
| F-52 | 手写事实 | `tests/helpers/C1-mailbox-fixture.ts:199-220`；`commitRun/commitSession` | 混合用途：真实终态/释放占用可走 P1；但 `C1-session-mailbox.test.ts:139-167` 会反向改 running、去 envelope、改授权 phase/generation。`:371` 的并发释放则应改真实结果提交；`:355-364` 另直接伪造 lease successor。 | `keep-note` | 先分调用方：结束及竞争用真实 owner；不可能状态按 `AGENTS.md:33` 单独裁定。不能把整个 mailbox 授权测试当作旧测试删除。 | 0 | 否 | 高 |

与表格对应的 JSON：

```json
[
  {
    "id": "F-01",
    "category": "helper",
    "file": "tests/helpers/WP2-duties-fixture.ts",
    "lines": "34,44-49,64-220",
    "tests": ["openWP2DutiesFixture", "installWP2Role"],
    "evidence": "全 tests 树无外部消费者；工厂仅有定义和返回类型引用，installWP2Role 只在死工厂内调用。tests/work-graph/WP2-message-duties.test.ts:26 只导入 wp2LegacyDuty/wp2RoleContent。",
    "action": "delete",
    "covered_by": "不删除测试；保留 tests/helpers/WP2-duties-fixture.ts:33,37-42,51-62 的现用代码。",
    "est_lines": 164,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-02",
    "category": "helper",
    "file": "tests/helpers/K3-proposal-round.ts",
    "lines": "898-921",
    "tests": ["K3AwaitingApprovalState", "reachK3AwaitingApproval"],
    "evidence": "全 tests 树无调用；本文件:40,54 仅注释示例，:913-915 串接已有下层流程。",
    "action": "delete",
    "covered_by": "无消费者；不删除 K3 规格行，保留实际使用的提议、结束和结算辅助函数。",
    "est_lines": 24,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-03",
    "category": "helper",
    "file": "tests/helpers/B2-crr-world.ts",
    "lines": "226-238",
    "tests": ["runSnapshotOf"],
    "evidence": "rg 全 tests 树只有定义命中；:228 所称 K3-UR7 使用方没有实际引用。",
    "action": "delete",
    "covered_by": "无消费者；不删除测试用例或断言。",
    "est_lines": 13,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-04",
    "category": "helper",
    "file": "tests/helpers/RL-resource-caps-support.ts",
    "lines": "33-34,140-142,236-239",
    "tests": ["RL_PROBE_MEMORY_BYTES", "RL_PROBE_TASKS_MAX", "appendLine", "unitLoadState"],
    "evidence": "rg 全 tests 树所列符号均只有定义命中。",
    "action": "delete",
    "covered_by": "无消费者；不删 RL 规格行，保留 :232 的现用 systemctlUserShow。",
    "est_lines": 9,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-05",
    "category": "helper",
    "file": "tests/helpers/S1-runtime-scenario-fixture.ts",
    "lines": "59",
    "tests": ["S1_T1"],
    "evidence": "rg 全 tests 树只有定义命中。",
    "action": "delete",
    "covered_by": "无消费者；不删除测试用例或断言。",
    "est_lines": 1,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-06",
    "category": "helper",
    "file": "tests/helpers/S2B-r2-calendar-reverify-support.ts",
    "lines": "149",
    "tests": ["CalendarReverifyContext"],
    "evidence": "rg 全 tests 树只有定义命中。",
    "action": "delete",
    "covered_by": "无消费者；不删除测试用例或断言。",
    "est_lines": 1,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-07",
    "category": "helper",
    "file": "tests/helpers/S2C-D-node-support.ts",
    "lines": "630-636",
    "tests": ["incompleteAnomalies"],
    "evidence": "rg 全 tests 树只有定义命中；没有注释所称的 2C-28 调用。",
    "action": "delete",
    "covered_by": "无消费者；不删除 2C-28 或不完整计数行为。",
    "est_lines": 7,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-08",
    "category": "helper",
    "file": "tests/helpers/S2C-K-scenario-support.ts",
    "lines": "33,127-129,172-174",
    "tests": ["LinePageRead", "sessionRefOf", "lineWrite"],
    "evidence": "rg 全 tests 树所列符号均只有定义命中。",
    "action": "delete",
    "covered_by": "无消费者；保留现用行读取和维护流程。",
    "est_lines": 7,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-09",
    "category": "helper",
    "file": "tests/helpers/S2C-K2-scenario-support.ts",
    "lines": "35-37",
    "tests": ["sessionRefOfCard"],
    "evidence": "rg 全 tests 树只有定义命中。",
    "action": "delete",
    "covered_by": "无消费者；不删除测试用例或断言。",
    "est_lines": 3,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-10",
    "category": "helper",
    "file": "tests/helpers/S4C2-note-card-fixture.ts",
    "lines": "42-43",
    "tests": ["S4C2_FILE_A", "S4C2_FILE_B"],
    "evidence": "rg 全 tests 树所列符号均只有定义命中。",
    "action": "delete",
    "covered_by": "无消费者；不删除注记卡规格行。",
    "est_lines": 2,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-11",
    "category": "helper",
    "file": "tests/helpers/W2-whiteboard-fixture.ts",
    "lines": "77-79",
    "tests": ["W2AgentApplyRequest"],
    "evidence": "rg 全 tests 树只有定义命中。",
    "action": "delete",
    "covered_by": "无消费者；不删除 W2 测试。",
    "est_lines": 3,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-12",
    "category": "helper",
    "file": "tests/helpers/WP1-handover-fixture.ts",
    "lines": "437,508,518,529,564",
    "tests": ["InterruptedHandoverFixture", "RoleMismatchHandoverFixture", "ReusablePredecessorFixture", "ArchivedPredecessorFixture", "RetiredContinuationFixture"],
    "evidence": "rg 全 tests 树五个类型别名均只有定义命中；对应工厂仍在使用。",
    "action": "delete",
    "covered_by": "只删无消费者的类型别名；保留工厂和测试。",
    "est_lines": 5,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-13",
    "category": "helper",
    "file": "tests/helpers/WP2-platform-support.ts",
    "lines": "866-868",
    "tests": ["goalSettingsWith"],
    "evidence": "rg 全 tests 树只有定义命中。",
    "action": "delete",
    "covered_by": "无消费者；不删除测试用例或断言。",
    "est_lines": 3,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-14",
    "category": "helper",
    "file": "tests/helpers/orchestration-fixture.ts",
    "lines": "146-148",
    "tests": ["isYielded"],
    "evidence": "rg 全 tests 树只有定义命中。",
    "action": "delete",
    "covered_by": "无消费者；不删除 yielded 业务覆盖。",
    "est_lines": 3,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-15",
    "category": "helper",
    "file": "tests/helpers/S5-goal-settings-support.ts",
    "lines": "1-10,169-789",
    "tests": ["openS5GoalSettingsFixture", "SS11", "SS12", "SS15"],
    "evidence": "文件头承认复制；与 tests/helpers/S5-decision-fixture.ts:459-1060 重复构造。独有差异为真实 catalog 和 B@5→采用@6→暂停@7，见本文件:5-8,271-281。",
    "action": "merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture",
    "covered_by": "保留 SS11/SS12/SS15 的暂停检查点与目录前提；通过初始化选项保留差异，不删测试。",
    "est_lines": 500,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-16",
    "category": "helper",
    "file": "tests/helpers/S5R2-c-support.ts",
    "lines": "1-9,206-828",
    "tests": ["openS5R2CompletionFixture", "R2C08"],
    "evidence": ":1-9 明确复制 S5-goal-settings 工厂，仅改变采用前 static 策略。独有 assembleS5R2C 从:831开始。",
    "action": "merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture",
    "covered_by": "与 F-15 共用初始化；保留 static 前提和 :831 之后的 C 组流程。",
    "est_lines": 650,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-17",
    "category": "helper",
    "file": "tests/helpers/S5R2-d-support.ts",
    "lines": "1-7,236-841",
    "tests": ["openS5RuntimeFixture"],
    "evidence": ":1-7 明确复制 S5 工厂，只为在真实进入之前授予 propose_future_plan/apply_future_plan；独有 driver 从:844开始。",
    "action": "merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture",
    "covered_by": "保留进入前授权差异和 :844-952 的 driver；不改为进入后覆写授权。",
    "est_lines": 550,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-18",
    "category": "helper",
    "file": "tests/helpers/S1-workflow-archive-fixture.ts",
    "lines": "160-791",
    "tests": ["createTaskClaimFixture", "createB2ExecutionFixture"],
    "evidence": "与 tests/helpers/task-claim-fixture.ts:160-453、tests/helpers/B2-execution-fixture.ts:104-331 重复 claim/prepare/entry 构造；本文件:304-337 的公开初始化、审计时钟及:740-746逐 claim Kernel 身份必须保留。",
    "action": "merge-into:tests/helpers/B2-execution-fixture.ts::createB2ExecutionFixture",
    "covered_by": "提取共同底座，保留 S1 审计、时钟、公开初始化和独立 Kernel 身份。",
    "est_lines": 350,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "F-19",
    "category": "helper",
    "file": "tests/helpers/S2B-runtime-store-fixture.ts",
    "lines": "1-25,106-251",
    "tests": ["createS2BRuntimeStoreFixture"],
    "evidence": ":15 明确复制 runtime 构造；对照 tests/helpers/B2-runtime-fixture.ts:168-310。独有需求为 live store、reopen 和活动读取绑定。",
    "action": "merge-into:tests/helpers/B2-runtime-fixture.ts::createB2RuntimeFixture",
    "covered_by": "保留 live store、SQLite reopen、派生 reader；仅抽共同 runtime 构造。",
    "est_lines": 100,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "F-20",
    "category": "stale",
    "file": "tests/helpers/SP-storage-migration-fixture.ts",
    "lines": "1-31",
    "tests": ["addLegacyFtsArtifacts", "SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports)"],
    "evidence": "仅造旧 next_fts_meta/next_fts_%；唯一调用为 tests/record-store/SP-text-scan.test.ts:400-435。",
    "action": "delete",
    "covered_by": "旧迁移行为按 docs/refactor/HANDOFF.md:565-570 退出；当前索引重建/失效覆盖 tests/record-store/SP-text-scan.test.ts:375-398 保留。",
    "est_lines": 31,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-21",
    "category": "stale",
    "file": "tests/helpers/S1-session-facts-fixture.ts",
    "lines": "204-231",
    "tests": ["createLegacySession", "S1 legacy Session provenance reader", "SV58 a legacy copy with fixed saved message derivation is forbidden before Query claim"],
    "evidence": "绕过当前 admission，写无 provenance 的旧 accepted operation；调用见 tests/work-graph/S1-provenance.test.ts:214,292 和 tests/work-graph/S1-dispatch-guards.test.ts:151-153。",
    "action": "delete",
    "covered_by": "旧格式按 docs/refactor/HANDOFF.md:565-570 退出；保留 tests/helpers/S1-session-facts-fixture.ts:181-202 的公开创建流程。",
    "est_lines": 28,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-22",
    "category": "stale",
    "file": "tests/helpers/S2C-L-line-support.ts",
    "lines": "466-477,710-712",
    "tests": ["createLegacySession", "2C-18 executions list only the indexed Work claims and QueryRuns on a legacy Session"],
    "evidence": "直接写无 provenance Session；调用见 tests/work-graph/S2C-lines-page.test.ts:394-418，该用例:403-413还手造旧 QueryRun。",
    "action": "delete",
    "covered_by": "旧格式按 docs/refactor/HANDOFF.md:565-570 退出；保留 D1 其余拓扑和当前 Work/Query 列表覆盖。",
    "est_lines": 12,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-23",
    "category": "stale",
    "file": "tests/helpers/graph-session-fixture.ts",
    "lines": "403-417",
    "tests": ["seedLegacyArchitectureBaseline", "reads a historical baseline as catalog:null instead of guessing an empty catalog"],
    "evidence": "旧 baseline 无 catalog；专用断言在 tests/work-graph/A1-architecture-catalog.test.ts:169-177。非旧格式借用点在该文件:190及 tests/work-graph/A1-independent-review.test.ts:66。",
    "action": "delete",
    "covered_by": "旧格式按 docs/refactor/HANDOFF.md:565-570 退出；先把健康/竞争前提迁到公开 adopt，保留 A1-architecture-catalog.test.ts:195-207 的当前读取覆盖。",
    "est_lines": 15,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-24",
    "category": "stale",
    "file": "tests/helpers/S5-queue-support.ts",
    "lines": "284-298,384,400",
    "tests": ["legacyNoticeWire", "NR08 legacy reverify retains an unknown cap after the current policy cap changes"],
    "evidence": "删 since、noticeAutomationCap 和 cursor binding；旧行为调用在 tests/work-graph/S5-notices.test.ts:271-284。",
    "action": "delete",
    "covered_by": "旧格式按 docs/refactor/HANDOFF.md:565-570 退出；保留 tests/work-graph/S5-notices.test.ts:258-269 的 NR07 当前历史/计数覆盖。",
    "est_lines": 15,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-25",
    "category": "stale",
    "file": "tests/helpers/S2A-notices-support.ts",
    "lines": "95-132",
    "tests": ["legacyRequeueRecords", "legacyRequeueItemKeys", "QA-11 legacy requeues without since order by occurredAt before the commit-position requeues"],
    "evidence": "克隆 requeue 并省略 since；旧排序/分页断言见 tests/work-graph/S2A-notices-rework.test.ts:37-64。",
    "action": "delete",
    "covered_by": "旧格式按 docs/refactor/HANDOFF.md:565-570 退出；保留本文件:134-164起的真实 requeue 流程及当前提交排序。",
    "est_lines": 38,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-26",
    "category": "stale",
    "file": "tests/helpers/S2B-activity-fixture.ts",
    "lines": "250-266",
    "tests": ["openLegacyRound"],
    "evidence": "真实开轮次后删除 since；混入 tests/work-graph/S2B-activity-calendar.test.ts:235-241 的正常 checks 聚合场景。",
    "action": "delete",
    "covered_by": "旧格式按 docs/refactor/HANDOFF.md:565-570 退出；同一测试:221-233,249的当前轮次聚合保留，只删旧分支。",
    "est_lines": 17,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-27",
    "category": "stale",
    "file": "tests/helpers/S2B-track-fixture.ts",
    "lines": "836-851,880-881",
    "tests": ["stripRoundKey", "2B-30 legacy rounds without since and pre-2B finalized rounds without finalizedAt are only counted in unplaced.rounds"],
    "evidence": "删 since/finalizedAt；调用及断言在 tests/work-graph/S2B-30-track-bars.test.ts:188-207。",
    "action": "delete",
    "covered_by": "旧格式按 docs/refactor/HANDOFF.md:565-570 退出；该测试文件:209起当前 gate 无 owner 情形保留。",
    "est_lines": 16,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-28",
    "category": "stale",
    "file": "tests/helpers/S2B-task-timeline-fixture.ts",
    "lines": "648-679,824-825",
    "tests": ["seedRoundRaw"],
    "evidence": "造没有 since/finalizedAt 的旧轮次；调用见 tests/work-graph/S2B-33-task-timeline-pagination.test.ts:106-109。",
    "action": "delete",
    "covered_by": "旧格式按 docs/refactor/HANDOFF.md:565-570 退出；保留本文件:826-831的当前路径和 tests/work-graph/S2B-32-task-timeline-fold.test.ts:207-223。",
    "est_lines": 32,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-29",
    "category": "handwritten",
    "file": "tests/helpers/task-claim-fixture.ts",
    "lines": "198-234",
    "tests": ["createTaskClaimFixture scope/governance bootstrap"],
    "evidence": "手写 scope、策略、active pointers 和旧 baseline；公开入口在 project-bootstrap-service.ts:528,601,699,812及catalog-service.ts:454，已有示例 tests/helpers/S1-workflow-archive-fixture.ts:304-337。",
    "action": "convert:createProject→registerWorkspace→install/activateCompletionPolicy→adoptInitialArchitecture",
    "covered_by": "保留全部 claim 行为及其版本前提；采用当前 catalog baseline。",
    "est_lines": 37,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-30",
    "category": "handwritten",
    "file": "tests/helpers/graph-session-fixture.ts",
    "lines": "322-351",
    "tests": ["createGraphSessionFixture scope/policy bootstrap"],
    "evidence": "直接提交 Project/Workspace/CompletionPolicy/active pointer；P0公开入口已存在。",
    "action": "convert:createProject→registerWorkspace→install/activateCompletionPolicy",
    "covered_by": "保留 A1 场景，尤其尚无 baseline 前提；不要在初始化时额外采用架构。",
    "est_lines": 30,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-31",
    "category": "handwritten",
    "file": "tests/helpers/graph-session-fixture.ts",
    "lines": "433-469",
    "tests": ["seedAcceptedTask", "archive rejects occupancy and an unresolved responsible Task obligation"],
    "evidence": "手写 Goal/accepted Plan/pointer，:441-447使用虚构架构 pin；公开示例见 tests/helpers/task-claim-fixture.ts:274-310。",
    "action": "convert:createGoal→proposePlan→applyPlanChange",
    "covered_by": "保留 tests/work-graph/A1-session-lifecycle.test.ts:132-152 等责任/归档行为。",
    "est_lines": 37,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-32",
    "category": "handwritten",
    "file": "tests/helpers/graph-session-fixture.ts",
    "lines": "472-481",
    "tests": ["overwriteSession", "archive rejects occupancy and an unresolved responsible Task obligation"],
    "evidence": "tests/work-graph/A1-session-lifecycle.test.ts:137-142凭空设置/清除 occupancy；真实 claim 和结果流程可产生占用/释放。",
    "action": "convert:claimTask→公开进入/结束流程",
    "covered_by": "保留 tests/work-graph/A1-session-lifecycle.test.ts:132-152 的 busy、责任与成功归档断言。",
    "est_lines": 10,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-33",
    "category": "handwritten",
    "file": "tests/helpers/C1-mailbox-fixture.ts",
    "lines": "103-110,121-167",
    "tests": ["createC1Harness"],
    "evidence": "伪造 entered 授权，再补 manifest/inputBinding/digest；已有真实进入示例 tests/helpers/B2-execution-fixture.ts:274-305。",
    "action": "convert:准备manifest→authorizeRuntimeEntry→beginRuntimeEntry→recordExecutionEntered",
    "covered_by": "保留 tests/work-graph/C1-session-mailbox.test.ts:128-170,336-352 的 mailbox 行为；任意改写调用方另见 F-52。",
    "est_lines": 55,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-34",
    "category": "handwritten",
    "file": "tests/helpers/B2-runtime-fixture.ts",
    "lines": "198",
    "tests": ["createB2RuntimeFixture"],
    "evidence": "直接改 Session.role；同类在 tests/helpers/S2B-runtime-store-fixture.ts:137。tests/helpers/task-claim-fixture.ts:318-331已支持创建时传角色，S2B-be1-platform-fixture.ts:219已有使用。",
    "action": "convert:createSession(role_spec pin)→claimTask",
    "covered_by": "保留 runtime 场景；副本由 F-19合并，不重复计行。这里是初始化，不是运行中热切换。",
    "est_lines": 1,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-35",
    "category": "handwritten",
    "file": "tests/helpers/S5-decision-fixture.ts",
    "lines": "539-574",
    "tests": ["openS5DecisionFixture bootstrap"],
    "evidence": "手写 scope/governance/Goals；副本在 S5-goal-settings-support.ts:252-287、S5R2-c-support.ts:289-324、S5R2-d-support.ts:319-350。",
    "action": "convert:P0初始化→createGoal→公开设置/控制步骤达到冻结检查点",
    "covered_by": "保留 Goal@7、Workspace@3 等冻结前提；不能把期望值改成读取当前值。",
    "est_lines": 36,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "F-36",
    "category": "handwritten",
    "file": "tests/helpers/S5-decision-fixture.ts",
    "lines": "810-826",
    "tests": ["U1/U2 candidate bootstrap"],
    "evidence": "手写 proposal/request-head claim/event；src/core/work-graph/tasks/plan-service.ts:1479-1528已支持requestRef/replaces。副本见 S5-goal-settings-support.ts:540、S5R2-c-support.ts:577、S5R2-d-support.ts:589。",
    "action": "convert:proposePlan(requestRef)",
    "covered_by": "保留每请求唯一 head、来源和采用行为；使用真实 QueryJob 前提。",
    "est_lines": 17,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-37",
    "category": "handwritten",
    "file": "tests/helpers/S5-decision-fixture.ts",
    "lines": "828-910",
    "tests": ["pending/answered decision message bootstrap"],
    "evidence": "手写消息及 sent/responded 事实；公开入口在 src/core/work-graph/communication/mailbox-service.ts:3328和decision-service.ts:677；示例 tests/helpers/S5-user-message-support.ts:43-77,93-107。",
    "action": "convert:sendUserMessage→answerDecision",
    "covered_by": "保留消息卡、答复、来源 pins 和应用行为；副本随 F-15至F-17收拢。",
    "est_lines": 83,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-38",
    "category": "handwritten",
    "file": "tests/helpers/S2A-notices-support.ts",
    "lines": "146-164",
    "tests": ["openManyTaskWorld", "QA-10"],
    "evidence": "注释明确仅因共享夹具未注册 bootstrap schemas 而 raw seed；生产安装/激活策略入口已存在。",
    "action": "convert:注册bootstrap schemas→installCompletionPolicy→activateCompletionPolicy",
    "covered_by": "保留 QA-10 等真实 requeue 场景。",
    "est_lines": 19,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-39",
    "category": "handwritten",
    "file": "tests/helpers/S2A-notices-workspace2-fixture.ts",
    "lines": "88-112",
    "tests": ["W2 scope/static policy bootstrap"],
    "evidence": "直接写第二 Workspace 和策略；P0 registerWorkspace/installCompletionPolicy/activateCompletionPolicy 均已存在。",
    "action": "convert:registerWorkspace→installCompletionPolicy→activateCompletionPolicy",
    "covered_by": "保留跨 Workspace 通知隔离及原有预期。",
    "est_lines": 25,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-40",
    "category": "handwritten",
    "file": "tests/helpers/S5-queue-support.ts",
    "lines": "274-275,304-314",
    "tests": ["openUninitializedQueue", "noticeWork", "DQ03"],
    "evidence": "手写 Workspace@3、策略和 active pointer；:278已公开创建Goal，其他前置事实也有P0入口。",
    "action": "convert:P0 scope/策略流程",
    "covered_by": "保留 DQ03 未初始化队列及 noticeWork 场景；不额外采用架构或计划。",
    "est_lines": 13,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-41",
    "category": "handwritten",
    "file": "tests/helpers/S2B-task-timeline-fixture.ts",
    "lines": "599-631,699-715",
    "tests": ["seedRunRaw", "yielded/successor timeline setup"],
    "evidence": "yielded及无requeue后继直接造Run；公开结果支持continuation，见 tests/helpers/S2C-L-runs-support.ts:184-203；真实咨询流程见 S1-workflow-archive-fixture.ts:980起。",
    "action": "convert:真实消息等待→recordRunResult(yielded,continuation)→claimTask续接",
    "covered_by": "保留 yielded/后继时间线；实际建立等待消息和续接关系。",
    "est_lines": 33,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "F-42",
    "category": "handwritten",
    "file": "tests/helpers/S2B-task-timeline-fixture.ts",
    "lines": "634-646,781-787",
    "tests": ["seedControlRaw", "2B-32 fold order (a): a pause before entry -> paused, a resume -> pending, entry -> running"],
    "evidence": "直接造进入前控制事实；tests/helpers/S2B-r2-timeline-public-flows.ts:75-145已有真实claim、进入前控制、entry流程。",
    "action": "convert:claimRun→submitNotEnteredControl→enterClaim",
    "covered_by": "保留 tests/work-graph/S2B-32-task-timeline-fold.test.ts:226-233 的冻结折叠规则。",
    "est_lines": 13,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-43",
    "category": "handwritten",
    "file": "tests/helpers/W2-whiteboard-fixture.ts",
    "lines": "329-359",
    "tests": ["seedAgentCandidate", "Agent apply adopts its own sourced candidate and preserves unchanged task basis", "a candidate sourced from another Run cannot be adopted by this Run", "exact apply replays its original receipt after terminal/revocation; changed Plan/Proposal pins conflict", "a signal aborted after the actual commit preserves that invocation committed result"],
    "evidence": "手写candidate/provenance/event；同文件:292-299已有两个Run的真实propose包装。调用方 tests/work-graph/W2-agent-whiteboard.test.ts:189,208,383,463。",
    "action": "convert:proposeAsWorkRun/proposeAsSecondWorkRun",
    "covered_by": "保留四类现有行为和断言，使用真实返回的proposal身份。",
    "est_lines": 31,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-44",
    "category": "handwritten",
    "file": "tests/helpers/S2B-activity-fixture.ts",
    "lines": "301-324",
    "tests": ["seedLegacyActivity"],
    "evidence": "手写无locator/dispatch旧Run；当前backfill测试也借用它填数据，见 tests/app/S2B-r2-backfill-done-cursor.test.ts:84。",
    "action": "convert:真实claim/entry/result→writeActivity",
    "covered_by": "保留backfill游标/扫描界限测试；仅旧无定位Run分支按 docs/refactor/HANDOFF.md:565-570退出。",
    "est_lines": 24,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-45",
    "category": "handwritten",
    "file": "tests/helpers/S2C-X-scale-fixture.ts",
    "lines": "411-452",
    "tests": ["29 picker Runs and 2999 historical Runs setup"],
    "evidence": "克隆Run及anomalyAnchorRefs；注释:412-415,443-447说明公开流程存在，仅以构造成本为例外理由。",
    "action": "convert:公开claim/prepare/entry/result及requeue循环",
    "covered_by": "保留30 anchors、3000 Run的规模与读成本断言；构造成本施工时实测。",
    "est_lines": 42,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "F-46",
    "category": "handwritten",
    "file": "tests/helpers/task-claim-fixture.ts",
    "lines": "408-430",
    "tests": ["seedRun", "overwriteSession"],
    "evidence": "混合正常及不可达数据；tests/work-graph/R4c-task-claim-boundaries.test.ts:98-103改不存在的Plan，R4c-execution-read.test.ts:423和R4c-execution-history-index.test.ts:915-917写gate/不存在任务Run。",
    "action": "keep-note",
    "covered_by": "正常状态可走P1；gate/不存在任务及任意Session改写无同状态合法公开造法，需逐调用方裁定。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-47",
    "category": "stale",
    "file": "tests/helpers/S2B-r2-activity-support.ts",
    "lines": "40-73",
    "tests": ["seedActivityRun", "R5 a V1 authorization phase authorized does not prove non-entry"],
    "evidence": "V1专用调用见 tests/work-graph/S2B-r2-never-entered.test.ts:23-37；helper亦被当前V2/位置/cap场景使用；真实authorized-only流程在helper:75起。",
    "action": "keep-note",
    "covered_by": "V1行按 docs/refactor/HANDOFF.md:565-570清理；不能整删共享helper或当前R5行。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-48",
    "category": "stale",
    "file": "tests/helpers/S2B-r2-track-support.ts",
    "lines": "42-82",
    "tests": ["seedRawRunVariant", "R5 V1 authorization case"],
    "evidence": "V1调用在 tests/work-graph/S2B-r2-r5-not-entered.test.ts:36-52；:54-92另有无授权、位置及当前V2组合。",
    "action": "keep-note",
    "covered_by": "V1行按 docs/refactor/HANDOFF.md:565-570清理；保留当前R5及真实无法确认进入的情形。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-49",
    "category": "tamper",
    "file": "tests/helpers/graph-session-fixture.ts",
    "lines": "419-431",
    "tests": ["seedTamperedArchitectureBaseline", "refuses to follow a digest-inconsistent catalog record", "distinguishes a missing pointer, a digest-inconsistent record and a readable revision"],
    "evidence": "故意存入正文不符digest；调用见 tests/work-graph/A1-session-lifecycle.test.ts:112-120和A1-architecture-catalog.test.ts:179-193。",
    "action": "delete",
    "covered_by": "AGENTS.md:33排除仅数据库篡改触发的防御测试；保留混合用例的missing/healthy部分及A1-architecture-catalog.test.ts:210起的真实存储故障。",
    "est_lines": 13,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "F-50",
    "category": "tamper",
    "file": "tests/helpers/S2B-r3-r4-support.ts",
    "lines": "21-46",
    "tests": ["cloneSessionInWorkspace", "R4 foreign-session workspace cases"],
    "evidence": "克隆Session改workspace再拼接Run；调用 tests/work-graph/S2B-r4-session-workspace.test.ts:44-86。src/core/work-graph/tasks/claim-service.ts:1025拒绝外Workspace Session。",
    "action": "keep-note",
    "covered_by": "无同关系公开造法；需lead对齐AGENTS.md:33与冻结R4行，暂不删规格覆盖。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "F-51",
    "category": "handwritten",
    "file": "tests/helpers/B2-runtime-fixture.ts",
    "lines": "192-196",
    "tests": ["CoordinationPolicy matrix seeds"],
    "evidence": "同类在C2-runtime-platform-fixture.ts:106、K-readonly-work-support.ts:80、S2B-be1-platform-fixture.ts:208、S2B-runtime-store-fixture.ts:135、WP2-platform-support.ts:579。全src未找到CoordinationPolicy安装/激活公开入口；src/core/work-graph/model/configuration-contracts.ts:15-28仅有RoleSpec写入与binding解析。",
    "action": "keep-note",
    "covered_by": "未找到公开生产步骤，不提出转换或新增接口；死WP2工厂中的seed随F-01删除。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "F-52",
    "category": "handwritten",
    "file": "tests/helpers/C1-mailbox-fixture.ts",
    "lines": "199-220",
    "tests": ["commitRun", "commitSession"],
    "evidence": "tests/work-graph/C1-session-mailbox.test.ts:139-167反向改Run/envelope/authorization；:371模拟竞争释放；:355-364另伪造lease successor。真实终态/释放有P1流程，任意损坏状态没有。",
    "action": "keep-note",
    "covered_by": "逐调用方区分：结束和竞争改真实owner，不可能状态按AGENTS.md:33裁定；保留mailbox授权业务覆盖。",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "高"
  }
]
```

分类合计如下。重复搭建的 fixture 归入 `helper`；没有把它们冒充“两个业务测试断言完全相同”的 `duplicate`。本区也没有提出依据不足的 `trivial` 删除。

| 类别 | 项数 | 估计删除或改写行数 |
|---|---:|---:|
| stale／过时 | 11 | 204 |
| duplicate／重复业务测试 | 0 | 0 |
| trivial／琐碎 | 0 | 0 |
| handwritten／手写事实 | 20 | 506 |
| tamper／只为篡改 | 2 | 13 |
| helper／辅助 | 19 | 2,395 |
| **总计** | **52** | **3,118** |

覆盖记录：下列 **13 个文件全文阅读**，路径均以 `tests/helpers/` 为前缀。

```text
C1-mailbox-fixture.ts
K-boundary-facts-support.ts
K-legacy-reader-support.ts
K-session-support.ts
S2A-planning-fixture.ts
S2B-kernel-records-fixture.ts
S2B-r2-activity-support.ts
S2B-r2-timeline-public-flows.ts
S2B-r2-track-support.ts
S2B-r3-r4-support.ts
S2C-K2-scenario-support.ts
SP-storage-migration-fixture.ts
WP2-duties-fixture.ts
```

以下 **97 个文件为定向阅读／略读**：检查了文件职责、导出及全树引用、构造与直接写入命中；对候选段落及相关调用方展开阅读。没有声称已逐行检查其中所有委托、故障注入和类型定义。

```text
A2-restart-fixture.ts
AG2b-collaboration-fixture.ts
B2-09b-crash.ts
B2-401-world.ts
B2-blocked-runtime.ts
B2-crr-world.ts
B2-execution-fixture.ts
B2-runtime-fixture.ts
C2-runtime-platform-fixture.ts
K-readonly-host-support.ts
K-readonly-work-support.ts
K-t1-support.ts
K3-07-support.ts
K3-35-continuation-fixture.ts
K3-35-prepare.ts
K3-35-required-review-block.ts
K3-35-runtime.ts
K3-blocked-command-fixture.ts
K3-continuation-pure-fixture.ts
K3-crr-fixture.ts
K3-mailbox-seam.ts
K3-mixed-seams.ts
K3-padded-review-record.ts
K3-prefix-claim.ts
K3-proposal-round.ts
K3-real-workspace.ts
K3-review-card-fixture.ts
K3-tool-seams.ts
R3e-evidence-fixture.ts
RL-kernel-sandbox-double.ts
RL-query-fixture.ts
RL-re2-support.ts
RL-resource-caps-support.ts
S1-archive-service-fixture.ts
S1-public-anchor.ts
S1-runtime-scenario-fixture.ts
S1-session-facts-fixture.ts
S1-workflow-archive-fixture.ts
S2A-notices-overbound-fixture.ts
S2A-notices-support.ts
S2A-notices-workspace2-fixture.ts
S2A-queue-fixture.ts
S2A-route-storage-support.ts
S2A-window-fixture.ts
S2B-activity-fixture.ts
S2B-be1-platform-fixture.ts
S2B-be1r-kernel-faults-support.ts
S2B-be1r2-support.ts
S2B-be2-reconcile-support.ts
S2B-counting-off-support.ts
S2B-r2-backfill-kernel-support.ts
S2B-r2-calendar-reverify-support.ts
S2B-runtime-store-fixture.ts
S2B-runtime-tools-support.ts
S2B-task-timeline-fixture.ts
S2B-track-fixture.ts
S2C-D-node-support.ts
S2C-K-scenario-support.ts
S2C-L-check-support.ts
S2C-L-line-support.ts
S2C-L-runs-support.ts
S2C-P-pins-fixture.ts
S2C-X-scale-fixture.ts
S4A-note-fault-fixture.ts
S4A-note-fixture.ts
S4A-note-interleave-fixture.ts
S4A-note-scope-fixture.ts
S4B-memory-fixture.ts
S4B-note-check-fixture.ts
S4B-note-multi-scope-fixture.ts
S4B-text-search-support.ts
S4C-node-notes-fixture.ts
S4C2-note-card-fixture.ts
S5-application-support.ts
S5-decision-fixture.ts
S5-goal-settings-support.ts
S5-queue-support.ts
S5-user-message-support.ts
S5R2-a-support.ts
S5R2-b-support.ts
S5R2-c-support.ts
S5R2-d-support.ts
S8A-L8-prepare.ts
S8A-L8-reminder-world.ts
S8D-platform-fixture.ts
W2-whiteboard-fixture.ts
WP1-entry-fixture.ts
WP1-handover-fixture.ts
WP1-scenario-fixture.ts
WP1-units-fixture.ts
WP2-notices-fixture.ts
WP2-platform-support.ts
change-stream-reader.ts
executed-files-stub.ts
graph-session-fixture.ts
orchestration-fixture.ts
task-claim-fixture.ts
```

还有以下边界需要 lead 保留在清单中：

- **不能仅因名字带 legacy 删除 Kernel reader 场景。** `tests/helpers/K-legacy-reader-support.ts:4-22,139-146` 建的是当前 Host 的只读 locator 配置；`tests/scenarios/K-W-workflow-close.test.ts:487-517` 验证不可继续写入时回退到新 Session、原历史仍可读；`:524-544` 还使用同一 helper 测 adapter 完全缺席。它是否属于 D79 要退役的旧格式接口，不能只凭名称判断。本报告不建议整文件删除。
- **没有误报动态导入为无消费者。** `tests/helpers/S2B-counting-off-support.ts:16,21` 的函数在 `tests/app/S2B-r2-backfill-real-kernel.test.ts:37-42` 和 `tests/app/S2B-41-decision54-backfill-bound.test.ts:57-62` 动态导入，保留。
- **没有把底层规格输入等同领域事实篡改。** `tests/helpers/S2B-kernel-records-fixture.ts:58,99` 的 tally 输入、`tests/helpers/K-session-support.ts:136-201` 的 Kernel 记录流程，以及 `tests/helpers/K-boundary-facts-support.ts:93-124` 的真实边界事实注入，不能按“用了记录或事件”直接删除。未提出删除架构检查。
- **F-46、F-50、F-52 需要逐调用方裁定。** 正常终态、占用和并发释放可改公开步骤；不存在任务的 Run、外 Workspace 的非法 claim 关系、任意改 generation 等没有等价合法流程。不能统一包装成一个“公开 seed”后宣称问题已解决。
- **F-45 的成本尚未实测。** 现有注释提供了历史例外理由，但本次禁止运行，所以没有验证公开构造 3,000 Run 的耗时，也没有据此建议减小规模。
- **85-4 的 N0 没有形成 F 区删除项。** `docs/refactor/HANDOFF.md:683` 将 N0 Workflow 目标输入归 T；本区可见的 `tests/helpers/A2-restart-fixture.ts:77-78` 使用当前 `selectWork` 形状，不能据此扩大成删除整个 Workflow 入口。

以上是静态库存和处理建议；未通过执行证明转换后的版本检查点、事件顺序或性能等价。