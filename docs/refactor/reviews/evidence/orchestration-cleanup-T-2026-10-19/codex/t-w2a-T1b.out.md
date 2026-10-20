以下“仍会通过”均为静态控制流推导，未运行测试或变异测试。

| 编号 | 类别 | 位置（file:line） | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| T1b-01 | 会出错 | `tests/work-graph/A2-control-service.test.ts:331` | T1-003 | cancelled 分支只检查 busy 和 Goal 仍为 cancelled；零提交检查仅留在 paused 分支（`:294`）。若 resume 先修改 Run/写入 Intent，再返回 busy，当前断言仍通过。原 cancelled/not-entered 组合也消失了，基线两种 Goal 状态均检查零写入（`.lead-ref/base/tests/work-graph/A2-control-service.test.ts:334`）。 | 恢复独立的 cancelled/not-entered 子例及零提交断言；保留真实 entered 分支，并对各拒绝分支增加委托计数及拒绝前后公开 Run/控制状态相等检查。 |
| T1b-02 | 违规 | `tests/work-graph/B2-execution-result.test.ts:94` | T1-013 | 三个历史位置的期望改取 `startedHistory` 和 Runtime 请求里的 `history`，来源见同文件 `:54`、`:78`；取代基线字面量 2/4/4。实际请求获准用于重放，不是位置正确性的答案（`.lead-ref/books/t-items-T1.md:103`；`.lead-ref/books/t-book.md:83`）。 | 按固定真实脚本的事件序列手算三个位置，写独立字面量及推导注释；观察到的请求只用于重放。 |
| T1b-03 | 违规 | `tests/work-graph/K3-16-second-unfinished-proposal.test.ts:111` | T1-020 | 迁入断言改成 `round:2`（`:116`），而冻结动作明确要求迁入 `round:1`，刷新没有更改此要求（`.lead-ref/books/t-items-T1.md:132`、`:136`）。目标已有 review round，不能据此改变源断言后宣布合并完成。 | 恢复源首轮 unfinished 用例及 `round:1` 断言；将该合并子项标为 BLOCKED，待 lead 冻结等价迁移路径。 |
| T1b-04 | 会出错 | `tests/work-graph/R4b-session-boundaries.test.ts:135` | T1-029 | 登记回执跨 Workspace 重放被换成 `createSession(inB, workspaceA)`，会先在 Runtime 外层 scope 检查返回 forbidden（`src/core/agent-runtime/session-operations.ts:578`）。即使 `recordSessionCreated` 错误向 B 泄露 A 的登记回执，该测试仍通过。原例确实重放登记请求（`.lead-ref/base/tests/work-graph/R4b-session-boundaries.test.ts:83`）。 | 用原样委托包装捕获 Runtime 在 A 提交的真实登记请求，再向 B 的 `recordSessionCreated` 重放该原请求；保留登记 forbidden 和操作读取 not_found 断言。 |
| T1b-05 | 违规 | `tests/work-graph/R4b-session-boundaries.test.ts:225` | T1-029 | 仍创建 1000 个陪衬 Session。条目明确第一条只建被链接的 Session，并说明带 target 的查询不经过所声称的目录扫描边界（`.lead-ref/books/t-items-T1.md:175`、`:176`）。 | 删除陪衬循环，保留目标 Session、真实链接及发现断言；测试名称改为实际覆盖的 target 查询行为。 |
| T1b-06 | 会出错 | `tests/work-graph/R4b-session-directory.test.ts:281` | T1-031 | 按不存在的 Task 过滤 Session 后断言空列表，不能证明 Session 未创建。若入口留下没有 WorkLink 的孤立 Session，再返回拒绝，查询仍为空。基线直接读取真实 plannedSessionRef 并断言 not_found（`.lead-ref/base/tests/work-graph/R4b-session-directory.test.ts:272`）。 | 在真实 Runtime 流程中原样委托观察 admission 返回的 plannedSessionRef；拒绝后公开读取该 Session，恢复 not_found 断言。 |
| T1b-07 | 违规 | `tests/work-graph/S2C-node-detail-anomalies.test.ts:86` | T1-040 | 所谓真实转换仍调用手写事实的 helper：自行登记 Kernel Session（`tests/helpers/S2C-D-node-support.ts:300`）、手写 entered/history（`tests/helpers/S2C-L-runs-support.ts:145`、`:160`）、手写归档文件观察及固定 digest 替身（`tests/helpers/S2C-D-node-support.ts:392`、`:433`）。101 锚点也沿用这条路径（测试 `:150`）。刷新明确要求真实暂停、重启、归档和接续（`.lead-ref/books/t-items-T1.md:276`），回复的 done 不成立（`.lead-ref/replies/t-reply-T1.md:38`）。 | 接入已冻结的真实 Host 暂停→重启接管→归档→另一 Session 接续流程；101 个锚点同样由真实流程产生，成功页原样委托，仅第二页注入失败。 |
| T1b-08 | 会出错 | `tests/work-graph/S4C2-goal-triggers.test.ts:285` | T1-054 | 3a 的 Plan/Reduction 时间相同，版本也不能区分来源（`:74`、`:290`、`:296`）；3d 的 archive/rework 又共用同一时间（`:500`、`:502`）。若 reader 用 `plan.acceptedAt` 代替 `reducedAt`、用 Plan revision 代替 Reduction revision，或混用 archive/rework 时间，当前数据仍通过。基线刻意使用不同时间和版本（`.lead-ref/base/tests/work-graph/S4C2-goal-triggers.test.ts:36`、`:117`）。 | 用真实步骤恢复可区分的 Plan/Reduction 版本及各来源时间，并写独立手算期望；无法公开达到的原断言保留为 BLOCKED，不得压成同值。 |
| T1b-09 | 违规 | `tests/work-graph/S4C2-goal-triggers.test.ts:499` | T1-054 | 时间期望来自 requeue 返回值（`:402`），计划键和时间来自 `graph.value.plan`（`:501`）。这违反独立字面期望要求（`.lead-ref/books/t-book.md:83`），公开返回值可用于身份传递，不等于可用作业务期望。 | 由注入时钟及计划采用次数手算时间、计划键，写字面量与说明；只对随机身份使用真实返回值。 |
| T1b-10 | 会出错 | `tests/work-graph/W1-future-plan.test.ts:524` | T1-062 | 原 Run/Lease/Reduction 字节不变断言被 execution/TaskRow 相等替换（基线 `:368`、`:443`；当前 `:524`、`:525`）。若只改 B 的采用错误重写 C 的 Reduction revision/reducedAt，却保留 satisfied，TaskRow 比较仍通过；该投影不含这些字段（`src/core/work-graph/model/plan-contracts.ts:89`）。刷新明确要求保留此 BLOCKED 子段（`.lead-ref/books/t-items-T1.md:452`），不能报 done（`.lead-ref/replies/t-reply-T1.md:59`）。 | 恢复没有等价公开读取的原字节断言及所需 helper，保留已完成的真实流程转换；该子段具名记录 BLOCKED，条目报 partial。 |
| T1b-11 | 违规 | `tests/scenarios/support/S3-host.ts:241` | T2-051、T2-052 | 初始化直接 `proposePlan(planDraft(oldRef))→apply`，随后运行 tA（`:315`），跳过指定的真实 Answer 产计划步骤。书面改正明确要求 ArtifactRef 在真实 Answer 产生并一次采用的计划中声明（`.lead-ref/books/t-items-T1.md:558`），完成后才能抽共享初始化（`:568`）。 | 在共享初始化中完成真实 Query/Answer 产初始计划并采用一次，再运行独立回复的 tA、用真实 RunRef 保存 Artifact；保持计划 revision 1 和后续 send 脚本。 |
| T1b-12 | 违规 | `tests/work-graph/S4C2-U3.test.ts:29`；`tests/work-graph/R4b-session-directory.test.ts:267` | T1-053、T1-031 | 两条明确构造错误回执组合、错误 Task 目标的拒绝行，仍位于普通分组（U3 `:83`；directory `:271`）。A6 要求放入 `describe('rejects: …')`（`.lead-ref/books/test-rule-sheet-v1.md:45`）。 | 将这两条拒绝行分别放入具名 `rejects:` 分组，保留真实前置、拒绝及公开不变断言。 |
| T1b-13 | 违规 | `tests/scenarios/A7-control.test.ts:451`；`tests/work-graph/S2C-lines-tiers.test.ts:155` | T1-005、T1-037 | 合并目标名称没有保留源规格号：RUN-14 只出现在目标注释 `:496`；2C-12 (9) 在目标名称中消失。源名称见 `.lead-ref/base/tests/work-graph/A2-control-service.test.ts:277`、`.lead-ref/base/tests/work-graph/S2C-lines-attention.test.ts:216`；规则要求规格号保留在目标测试名中（`.lead-ref/books/t-book.md:62`）。 | 分别在两个目标测试名称补入 RUN-14、2C-12 (9)，保留现有目标规格号和断言。 |

逐条结果如下；OK 表示本片未发现偏离，包括按刷新要求保留的 partial。

- T1-003: T1b-01
- T1-004: OK（`tests/app/A2-continuation-projection.test.ts:109`；`tests/scenarios/A7-control.test.ts:520`）
- T1-005: T1b-13
- T1-012: OK（`tests/helpers/B2-12-recognition-fixture.ts:1`；`.lead-ref/parts/T1b.diff:1027`）
- T1-013: T1b-02
- T1-014: OK（`tests/work-graph/C1-session-mailbox.test.ts:336`）
- T1-015: OK（`tests/work-graph/C1-session-mailbox.test.ts:128`；`.lead-ref/parts/T1b.diff:1250`）
- T1-019: OK（`tests/work-graph/K3-15-disposition-effects.test.ts:199`）
- T1-020: T1b-03
- T1-025: OK（`tests/work-graph/R3a-goal-replay-boundaries.test.ts:90`、`:96`；`tests/work-graph/R3c-plan-adoption.test.ts:127`）
- T1-026: OK（`tests/composition/R3e-completion-platform.test.ts:31`、`:129`）
- T1-028: OK（`.lead-ref/parts/T1b.diff:1767`、`:1788`、`:1819`）
- T1-029: T1b-04, T1b-05
- T1-030: OK（`tests/work-graph/R4b-session-boundaries.test.ts:166`）
- T1-031: T1b-06, T1b-12
- T1-032: OK（`.lead-ref/parts/T1b.diff:2476`、`:2503`、`:2524`）
- T1-037: T1b-13
- T1-040: T1b-07
- T1-042: OK（`tests/work-graph/S4A-note-write.test.ts:525`、`:553`）
- T1-043: OK（`tests/work-graph/S4A-note-write.test.ts:699`）
- T1-046: OK（`tests/work-graph/S8A-catalog-version-time.test.ts:21`、`:59`）
- T1-047: OK（`tests/work-graph/S4B-note-anchor-status.test.ts:122`）
- T1-048: OK（`tests/work-graph/S4B-note-budget-check.test.ts:127`、`:139`）
- T1-049: OK（`tests/work-graph/S4C2-D-rows.test.ts:34`、`:277`）
- T1-050: OK（`tests/work-graph/S4C-resolution-order.test.ts:96`、`:118`）
- T1-053: T1b-12
- T1-054: T1b-08, T1b-09
- T1-055: OK（`tests/work-graph/S4C2-project-set-shared.test.ts:159`；`.lead-ref/parts/T1b.diff:3845`）
- T1-058: OK（`tests/work-graph/S8A-file-layer.test.ts:91`）
- T1-059: OK（`tests/work-graph/S4C-note-path-ownership.test.ts:13`、`:17`、`:22`、`:27`）
- T1-062: T1b-10
- T1-063: OK（`.lead-ref/parts/T1b.diff:4604`）
- T1-064: OK（`.lead-ref/parts/T1b.diff:4757`）
- T1-065: OK（`.lead-ref/parts/T1b.diff:4757`；`.lead-ref/books/t-items-T1.md:479`）
- T1-066: OK（`tests/work-graph/W2-agent-whiteboard.test.ts:192`、`:215`、`:387`、`:468`）
- T1-069: OK（`tests/work-graph/material-readers.test.ts:1`；`.lead-ref/parts/T1b.diff:4986`）
- T2-003: OK（`.lead-ref/parts/T1b.diff:300`、`:320`）
- T2-021: OK（`tests/runtime/K3-review-preparation.test.ts:168`、`:176`）
- T2-050: OK（`tests/helpers/S2C-K-scenario-support.ts:159`；`.lead-ref/parts/T1b.diff:332`）
- T2-051: T1b-11
- T2-052: T1b-11
- T2-059: OK（`tests/scenarios/S2C-K-unknown-outcome.test.ts:45`、`:67`；`.lead-ref/parts/T1b.diff:782`）
- T3-090: OK（`.lead-ref/parts/T1b.diff:274`）
- T3-096: OK，本片四个调用点已转换（`tests/work-graph/W2-agent-whiteboard.test.ts:192`、`:215`、`:387`、`:468`）

partial 和 BLOCKED 核对如下。

| 条目 | 子段 | DSH 的理由及分类是否成立 | 公开步骤是否可达 |
|---|---|---|---|
| T1-025 | R3a 原始事件 ID/载荷读取 | 成立，属于缺失公开读取入口。原断言保留在 `tests/work-graph/R3a-goal-replay-boundaries.test.ts:96`；`GoalDetail` 只提供 Goal/pendingPlan（`src/core/work-graph/model/plan-contracts.ts:44`），与回复 `:88` 一致。 | Goal 及 Workspace 升版可由 `createGoal→createSession→setLinePins` 到达（测试 `:68`、`:80`、`:90`）；原始事件读取没有等价公开入口。 |
| T1-020 | 将源 round:1 合并到已有 review round 的目标 | 回复称目标路径得到 round:2，这个理由成立（`.lead-ref/replies/t-reply-T1.md:193`；目标测试 `:111`），但不能据此改期望并报 done。 | 源首轮状态可由 `reachK3AwaitingProposal→endK3RunUnfinished→settleK3Review` 到达（`.lead-ref/base/tests/work-graph/K3-16-proposal-round-fixture.test.ts:124`）。当前目标前置不等价，应保留源例并阻塞合并。 |
| T1-040 | 原整项 BLOCKED | 刷新已经解除旧 BLOCKED（`.lead-ref/books/t-items-T1.md:276`）；DSH 的“已完成真实转换”不成立，见 T1b-07。 | 可达：真实 pause、Host restart、`sessions/archive-line`、`tasks/requeue`、另一 Session claim（`tests/scenarios/S2C-K2-paused-archive.test.ts:46`、`:53`、`:66`、`:92`、`:94`）。 |
| T1-054 | 原整项 BLOCKED，以及 3b/e/h | 旧整项 BLOCKED 已被刷新替换；3b/e/h 明确获准删除，不能再按旧改正要求暂留（`.lead-ref/books/t-items-T1.md:394`）。保留部分的问题见 T1b-08、09。 | 3a 的完成链、3c 的连续采用、3d 的 requeue/archive 已有真实步骤（`tests/work-graph/S4C2-goal-triggers.test.ts:288`、`:303`、`:432`）；这不免除独立期望和可区分输入要求。 |
| T1-062 | 原字节/事件断言子段 | 缺失等价公开读取的理由成立，但 DSH 没有保留阻塞子段而报 done（`.lead-ref/books/t-items-T1.md:452`；`.lead-ref/replies/t-reply-T1.md:59`），见 T1b-10。 | 状态可由真实运行、检查及 completeTask 到达；当前 TaskRow 不提供 Reduction 原始内容（`tests/work-graph/W1-future-plan.test.ts:233`、`:291`；`src/core/work-graph/model/plan-contracts.ts:89`）。 |
| T1-062 | scenario 9 的独立 Lease/Reduction、新增任务痕迹 | 最新刷新已批准删除这些不可达子例，不再属于应暂留的 BLOCKED（`.lead-ref/books/t-items-T1.md:452`）。 | 独立 Reduction 会先留下 Run，提前命中 Run 拒绝，不能到达原声称的独立守卫（`.lead-ref/books/t-items-T1.md:447`）；真实 changed-run 拒绝保留在 `tests/work-graph/W1-future-plan.test.ts:723`。 |

```json
[
  {
    "id": "T1b-01",
    "class": "会出错",
    "file": "tests/work-graph/A2-control-service.test.ts",
    "line": 331,
    "item": "T1-003",
    "problem": "cancelled 分支丢失零提交及 Run/Intent 不变检查，且原 cancelled/not-entered 组合消失。若 resume 写入意图或修改 Run 后返回 busy，当前断言仍通过；基线两种 Goal 状态均检查零写入（.lead-ref/base/tests/work-graph/A2-control-service.test.ts:334）。",
    "fix": "恢复独立 cancelled/not-entered 子例及零提交断言；保留真实 entered 分支，并对各拒绝分支增加委托计数和公开 Run/控制状态前后相等检查。"
  },
  {
    "id": "T1b-02",
    "class": "违规",
    "file": "tests/work-graph/B2-execution-result.test.ts",
    "line": 94,
    "item": "T1-013",
    "problem": "历史位置期望取自 startedHistory 和 Runtime 实际请求，替换原字面量；来源见同文件:54、:78，违反 .lead-ref/books/t-book.md:83。",
    "fix": "按固定真实脚本手算三个历史位置，写独立字面量及推导注释；实际请求只用于重放。"
  },
  {
    "id": "T1b-03",
    "class": "违规",
    "file": "tests/work-graph/K3-16-second-unfinished-proposal.test.ts",
    "line": 111,
    "item": "T1-020",
    "problem": "将冻结要求迁入的 round:1 改为 round:2；.lead-ref/books/t-items-T1.md:132、:136 没有授权改变期望。",
    "fix": "恢复源首轮 unfinished 用例及 round:1 断言，将合并子项标为 BLOCKED，等待 lead 冻结等价迁移路径。"
  },
  {
    "id": "T1b-04",
    "class": "会出错",
    "file": "tests/work-graph/R4b-session-boundaries.test.ts",
    "line": 135,
    "item": "T1-029",
    "problem": "跨 Workspace 登记重放改为 createSession(inB, workspaceA)，在 src/core/agent-runtime/session-operations.ts:578 提前拒绝。即使登记入口向 B 泄露 A 的回执，测试仍通过。",
    "fix": "原样委托捕获 Runtime 在 A 提交的真实登记请求，再向 B 的 recordSessionCreated 重放；保留登记 forbidden 和操作读取 not_found。"
  },
  {
    "id": "T1b-05",
    "class": "违规",
    "file": "tests/work-graph/R4b-session-boundaries.test.ts",
    "line": 225,
    "item": "T1-029",
    "problem": "仍创建 1000 个陪衬 Session，违背 .lead-ref/books/t-items-T1.md:175 的限定；带 target 的查询不经过声称的目录扫描边界（书:176）。",
    "fix": "删除陪衬循环，保留目标 Session、链接和发现断言，并将名称改为实际 target 查询行为。"
  },
  {
    "id": "T1b-06",
    "class": "会出错",
    "file": "tests/work-graph/R4b-session-directory.test.ts",
    "line": 281,
    "item": "T1-031",
    "problem": "按错误 Task 过滤得到空列表，不能证明 Session 未创建。若留下无 WorkLink 的孤立 Session 再返回拒绝，当前断言仍通过；基线直接 readSession(plannedSessionRef) 检查 not_found（.lead-ref/base/tests/work-graph/R4b-session-directory.test.ts:272）。",
    "fix": "原样委托观察真实 admission 返回的 plannedSessionRef，Runtime 拒绝后公开读取该 Session 并断言 not_found。"
  },
  {
    "id": "T1b-07",
    "class": "违规",
    "file": "tests/work-graph/S2C-node-detail-anomalies.test.ts",
    "line": 86,
    "item": "T1-040",
    "problem": "转换仍通过 helper 手写 Kernel Session、entered/history、归档观察及固定 digest；证据为 tests/helpers/S2C-D-node-support.ts:300、:392、:433 和 tests/helpers/S2C-L-runs-support.ts:145、:160。101 锚点同样沿用该路径，未完成刷新要求。",
    "fix": "改走真实 Host 暂停、重启接管、归档和另一 Session 接续；101 锚点由真实流程产生，成功页原样委托，仅第二页注入失败。"
  },
  {
    "id": "T1b-08",
    "class": "会出错",
    "file": "tests/work-graph/S4C2-goal-triggers.test.ts",
    "line": 285,
    "item": "T1-054",
    "problem": "Plan/Reduction 的时间和版本不能区分来源，archive/rework 时间也相同（同文件:74、:290、:500）。错误使用 plan.acceptedAt、Plan revision 或混用 archive/rework 时间仍通过；基线使用不同来源值（.lead-ref/base/tests/work-graph/S4C2-goal-triggers.test.ts:36、:117）。",
    "fix": "以真实步骤恢复可区分的版本和各来源时间，写独立手算期望；无法公开达到的原断言保留为 BLOCKED。"
  },
  {
    "id": "T1b-09",
    "class": "违规",
    "file": "tests/work-graph/S4C2-goal-triggers.test.ts",
    "line": 499,
    "item": "T1-054",
    "problem": "触发时间取自 requeue 返回值（同文件:402），计划键和时间取自 graph.value.plan（:501），违反 .lead-ref/books/t-book.md:83 的独立期望要求。",
    "fix": "由注入时钟和采用次数手算时间、计划键，写字面量及说明；只有随机身份使用真实返回值。"
  },
  {
    "id": "T1b-10",
    "class": "会出错",
    "file": "tests/work-graph/W1-future-plan.test.ts",
    "line": 524,
    "item": "T1-062",
    "problem": "删除原 Run/Lease/Reduction 字节不变断言，改比 execution/TaskRow。若采用只改 B 的计划时重写 C 的 Reduction revision/reducedAt，当前投影比较仍通过；TaskRow 不含这些字段（src/core/work-graph/model/plan-contracts.ts:89）。刷新要求保留该 BLOCKED 子段（.lead-ref/books/t-items-T1.md:452）。",
    "fix": "恢复无等价公开读取的原字节断言和所需 helper；保留真实流程转换，将子段具名记录 BLOCKED，条目报 partial。"
  },
  {
    "id": "T1b-11",
    "class": "违规",
    "file": "tests/scenarios/support/S3-host.ts",
    "line": 241,
    "item": "T2-051,T2-052",
    "problem": "直接 proposePlan(planDraft(oldRef)) 后 apply，跳过真实 Answer 产计划步骤；违反 .lead-ref/books/t-items-T1.md:558、:568 的冻结转换链。",
    "fix": "共享初始化先完成真实 Query/Answer 产初始计划并采用一次，再运行独立回复的 tA 并以真实 RunRef 保存 Artifact；保持 revision 1 和后续 send 脚本。"
  },
  {
    "id": "T1b-12",
    "class": "违规",
    "file": "tests/work-graph/S4C2-U3.test.ts",
    "line": 29,
    "item": "T1-053,T1-031",
    "problem": "错误回执组合及错误 Task 目标的拒绝行未放入 rejects 分组；另一处为 tests/work-graph/R4b-session-directory.test.ts:267、:271，违反 .lead-ref/books/test-rule-sheet-v1.md:45。",
    "fix": "将两条拒绝行分别放入具名 describe('rejects: …')，保留真实前置、拒绝及公开不变断言。"
  },
  {
    "id": "T1b-13",
    "class": "违规",
    "file": "tests/work-graph/S2C-lines-tiers.test.ts",
    "line": 155,
    "item": "T1-005,T1-037",
    "problem": "合并目标名丢失源规格号 2C-12 (9)；tests/scenarios/A7-control.test.ts:451 的目标名也未保留 RUN-14，只有:496 注释。违反 .lead-ref/books/t-book.md:62。",
    "fix": "在两个目标测试名称分别补入 2C-12 (9)、RUN-14，保留现有规格号和断言。"
  }
]
```

会出错 5，违规 8，不整洁 0，建议 0