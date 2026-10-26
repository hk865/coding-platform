# src/business/workflow：业务流程编排层，只选下一步并调用一个核心 owner

## 负责什么，不负责什么

- 负责业务流程：`advanceWork` 按已采纳的 Goal/Plan 选下一步，每次 `perform` 只调用一个 owner，并把 owner 的完整结果作为 `receipt` 交回 Host；另提供初始规划、request intake、归档、维护、决定、咨询、活动回填入口，以及 Host wake loop 驱动的两条请求队列处理器。
- 允许依赖 `WorkGraph`、`AgentRuntime`、`WorkspaceTools` 和 `src/contracts`；不得 import `RecordStore`、`src/app`、`src/composition`。
- 只选择流程意图与顺序；存储、索引、状态机、读取器都在 `src/core/work-graph/`，本层不得重写，也不保存 Workflow 数据库、去重表或第二个控制循环。
- 状态迁移只交给 `src/core/work-graph/state/`，本层不得直接改受保护字段（根 AGENTS 第 9 条）。
- 不负责：Host 路由与接线（`app/`、`composition/`）、记录编解码、Task/Goal 完成裁决（`tasks/completion.ts`）、UI 读模型（`views/`）。

## 文件

- `activity-backfill.ts` — 两个活动回填批次（Host 启动的近期窗口与人工区间），Work Run 与 Query 共用一张合并候选；计数分别走 `countRunActivity`/`countQueryActivity`，写回分别走 `recordRunActivity`/`recordQueryActivity`；缺 Query 一侧的依赖只让 Query 分支答 `unsupported`，Work 分支不变。
- `consultation.ts` — 一条已保存信箱输入 → 一条确定性只读 Query；复用已有 Query/Answer，不重跑发送者的 Work；新的咨询在回复位检查前先过共用消费规则 `messageConsumptionProblem(messageFactsOfRecord(message))`，按 `code`/`reason` 拒绝，已保存的 Query 结果仍先重放，提交时同一条消息 revision 由现有 `consultationMessageGuard` 复核；阶段链交给 `query-stage-driver.ts`。
- `query-stage-driver.ts` — 一条 Query attempt 的唯一阶段链：按 `executionState.phase` 认领请求轮、准备并启动、只观察已开始或 `unknown` 的 attempt，并把每个 owner 的结果映射成 `progressed`/`terminal`/`blocked`。
- `contracts.ts` — Workflow 的调用/步骤/推进/归档/回填 DTO 与 `WorkflowOperation`、`WorkflowAdvanceResult`；交接组合的注入契约 `HandoffWorkflowDependencies`（两个操作 owner、源未完成操作的读口、事实读、子 owner 与 D 的请求端口）也在这里。
- `decision-actions.ts` — 有限决定协调：先提交答案，再做结构化冲突动作，最后记录应用；另有只读 `orderGoalAdvances`。
- `index.ts` — 对外 barrel：`createWorkflow` 与 Workflow 端口/调用契约类型。
- `line-creation.ts` — 带稳定 `commandId` 的工作线创建/重放与只读 `findLine`；容量端口。
- `ports.ts` — `WorkflowPort`、`WorkflowDependencies`、Host 配置、归档策略与职责解析器契约。
- `WorkflowPort.sessionHandoff`（`src/business/workflow/ports.ts:249`）— 6B-2 的可选 late-binding 成员；真实组合在 I1 发布，旧窄替身保持类型兼容。
- `request-intake.ts` — request 命令（submit/route/selectIdea/ask）与未分配 drain：选人、建线或退回 waiting；drain 在每条请求前看调用 signal，已停止就返回已提交的计数。
- `request-round-queue.ts` — 两条请求队列处理器（`request-rounds` 分派开放轮、`unassigned` 跑未分配 drain）及 `settle()`：分页遍历、按 Session 的先飞集合、退避与唤醒都由端口注入，不读记录库。
- `session-handoff.ts` / `secretary-handoff.ts` — 交接与手动归档的 Workflow 组合：`startHandoff`/`continueHandoff`/`advance`/`manualArchive`，在两次 advance 之间只调一个子 owner（`ensureLine`、transfer、D 的 append、`archiveLineInternal`），从不写 RecordStore；秘书专属的覆盖/理解/路由步序只在源 duty 是 secretary 时跑。组合入口是 `createSecretaryHandoffWorkflow`，秘书专属子调用只剩 `appendUnderstanding`（经固定系统 principal 追加理解命令），源 Session 的 duty 判断 `isSecretaryDuty` 在 advance owner 里；阶段停在已提交 before 写的窗口里只带已保存的输入，组合用同一份输入再调原 owner；理解旧代由组合在真实轮次结束后关闭，子 owner 的真实拒绝经冻结的 `refusal` 臂记下 `lastRefusal` 后停止，原拒绝仍原样返回，任何 `ready` 都不当作完成；手动归档的最终条件失败只在 `revision_conflict` 且 reason 带 `archive_condition_failed:` 时，用返回 Session 的真实 revision/request ID 经 `releaseArchiveRequest` 在 `archiveContextOf` 下释放仍挂起的登记，释放失败原样返回，父操作保留保存的 GraphWrite 和登记回执并从 `archiveLineInternal` 的回执继续。
- `session-archive.ts` — 单一 Session 归档组合入口：按不可变归档请求逐步提交，已提交的步骤不撤销；请求里的可信条件原样转发给 Session 生命周期 owner，恢复时沿用存储里的原值。
- `session-maintenance.ts` — 有界单页 Session 维护：读到期事实并按到期归档，不启动任何东西。
- `task-gate.ts` — 任务门与自动 requeue/reverify、自动化确认、gate perform；`createTaskGate` 由 `workflow.ts` 原位装配。
- `task-order.ts` — 按真实 `executionDag.dependsOn` 的稳定 Kahn 软排序，只改选择顺序。
- `workflow.ts` — `advanceWork` 的选择/推进、`handleGoalInput` 与 Workflow 工厂；`ownContext` 做可信上下文绑定。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createWorkflow` | `src/business/workflow/workflow.ts:766` | Workflow 唯一组合工厂：发布 `advanceWork`、`handleGoalInput`、咨询、决定、归档、维护与回填 | 组合根建 Workflow 端口 |
| `createSecretaryHandoffWorkflow` | `src/business/workflow/session-handoff.ts:34` | 交接与手动归档的唯一 Workflow 组合：驱动 advance，两次 advance 之间只调一个子 owner（建线、转移、请求路由、归档），每个父写和子调用都用操作保存的 principal，只有归档子步（登记、回执读和最终读）用平台归档自动化身份 `archiveContextOf`；这个归档申请人是共用的（L9：维护、H 和人的手动归档都以 `workflow:session-archive` 申请），所以归档按 `condition.kind`/`mode` 选，不按申请人 | `createWorkflow` 在注入 `sessionHandoff` 时装配；I1 把它发布成 `workflow.sessionHandoff` |
| `appendUnderstanding` | `src/business/workflow/secretary-handoff.ts:16` | 秘书专属的理解子调用：经固定系统 principal 追加一条已保存的理解命令 | 只由 `createSecretaryHandoffWorkflow` 的步序调用；不要另写系统 principal 或第二条内部命令 |
| `createTaskGate` | `src/business/workflow/task-gate.ts:71` | `select_work`/`perform` 共用的任务门、自动 requeue/reverify、自动化确认与 gate perform；读 `createWorkflow` 的同一个 `deps` 引用，不复制 | `createWorkflow` 原位装配；不要另写门或确认规则 |
| `createLineCreation` | `src/business/workflow/line-creation.ts:84` | 按稳定 `commandId` 先查回已有 Session 创建操作并重放（那个 ref 上不是创建分支就答 `unavailable`），只有新线才查容量，再走真实 `createSession` | 请求选人无候选、崩溃后重试建线 |
| `createAlwaysAdmitCapacity` | `src/business/workflow/line-creation.ts:64` | 默认容量适配器：没有真实上限时全部放行 | 直接平台 fixture；真实 Host 必须换成 `secretaryOpenCap` 适配器 |
| `createRequestIntake` | `src/business/workflow/request-intake.ts:185` | request 的 submit/route/selectIdea/ask 与未分配 drain；重试 submit 先用 `findLine` 查回旧线；drain 在每条请求前看调用 signal，已停止就带着已提交的计数返回 | 请求命令与启动/唤醒 drain |
| `createQueryStageDriver`、`QueryStageDriver` | `src/business/workflow/query-stage-driver.ts:162`、`src/business/workflow/query-stage-driver.ts:49` | 唯一的 Query 阶段链：请求轮在当刻 owner Session 上用给定 profile 认领（`request-claim`/`request-prepare`/`request-start`），普通 Query 用构建 driver 时绑定的 Host consumer id 准备并启动（`consultation-*`），已开始或 `unknown` 的只观察，无变化的观察只报 `blocked`；交接 fence 被持住时不开始新的认领/进入，只报 `blocked`；每个 owner 的结果在一张表里映射成 `progressed`/`terminal`/`blocked`（`capacity` 等固定上限归 `on_change`），请求轮 `terminal` 时调 `onRoundEnded` 让 Host 读阈值 | 请求队列的 `driver` 注入与咨询；不要另写 phase 分派、认领或阶段链 |
| `queryRunEndedWithoutAnswer` | `src/business/workflow/query-stage-driver.ts:87` | 已正式关闭或 `settled`、不会再有 Answer 的 QueryRun 判定 | 咨询与阶段链共用；不要另写终态判断 |
| `createRequestRoundQueues` | `src/business/workflow/request-round-queue.ts:297` | 两条队列处理器：`rounds` 分页读开放轮，分区游标、遍历中已找到的每 Session 最老新轮（各带请求根）以及满 50 次上限后没发出的活尝试和新轮，都随冻结的 continuation 跨 pass 续接（读失败不推进游标；整轮遍历完才用 `compareRequestRounds` 选每 Session 最老轮；全部发出后才报 `wrapped`）；发出前重读该请求的 facts，按此刻的活尝试、owner、可派轮及其 Run 派发，profile 取此刻 owner 的；选定的新轮重读后可派轮、Run 或 owner 已变（drop、改派、claim），它涉及的新旧两个 Session 都不发，整轮遍历从头重读（返回 `more`、不 `wrapped`），所选全部成立的遍历才能 `wrapped`；continuation 里的引用和游标严格解码（完整的 QueryJob/QueryRun/Session 引用和提交游标），否则整个 continuation 读不了；请求已有活尝试就不再给它第二轮；无 profile 就 `end_unbound`，先飞不等待、按 Session 退避（随 advance 的 signal 中止）并在结束时 `settle()`；`unassigned` 每 pass 调一次注入的 drain | Host 的 wake loop 注册两个队列 |
| `REQUEST_ROUNDS_QUEUE`、`REQUEST_UNASSIGNED_QUEUE` | `src/business/workflow/request-round-queue.ts:67`、`src/business/workflow/request-round-queue.ts:69` | 两个队列在 wake loop 里的注册键 | 组合根注册与唤醒；不要另写字面量 |
| `createSessionArchiveService` | `src/business/workflow/session-archive.ts:146` | 登记不可变归档请求后逐步 stop、anchor、responsibility、reply_handler/wait_cancel、requeue、archive，各一个 sub-commit，已提交步骤不撤销 | Host 归档、维护、咨询回执归档 |
| `createSessionMaintenanceService` | `src/business/workflow/session-maintenance.ts:151` | 每次最多一页的有界维护；按到期与真实关闭时间归档 | 启动或推进时跑一页维护 |
| `createDecisionActions` | `src/business/workflow/decision-actions.ts:289` | `resolveDecision` 的三段有限协调与只读 `orderGoalAdvances` | 决定卡作答与 Host 排序 |
| `createCommandRerunRequestApplicationAdapter` | `src/business/workflow/decision-actions.ts:247` | `command_rerun_request` 卡的第②步适配器：按答案派生身份提交，重试重放 | 组合根注册 `command_rerun_request` 应用 |
| `createConsultationConsumer` | `src/business/workflow/consultation.ts:100` | 一条信箱输入 → 一条只读 Query；复用已有答案，必要时归档副本；阶段链经 `createQueryStageDriver` | Host 处理咨询消息 |
| `createActivityBackfill` | `src/business/workflow/activity-backfill.ts:112` | 用 `countRunActivity`/`countQueryActivity` 计数并经 `recordRunActivity`/`recordQueryActivity` 写回填批次，不改 Run/Task/Attempt/Query | 启动自动回填与人工区间回填 |
| `orderTasksByDependency` | `src/business/workflow/task-order.ts:14` | 按 DAG 边的稳定 Kahn 排序，只影响候选尝试顺序 | 选择候选 Task 前的软排序 |
| `DEFAULT_SESSION_ARCHIVE_POLICY` | `src/business/workflow/ports.ts:75` | 冻结默认归档策略：一天、每页 100 | 组合根未显式配置时 |
| `stableSessionCreationIdentity` | `src/core/work-graph/sessions/session-directory.ts:161` | 由同一稳定 `commandId` 派生 Session 创建身份 | 建线与崩溃重试；不要另写身份配方（MH-03、FP-13） |
| `compareRequestRounds` | `src/core/work-graph/queries/request-rounds-read.ts:96` | request round 的稳定先后比较，只取 `ref` 与 `since` 两项 | drain、最老 pending 选择与请求队列候选的排序；不要另写排序 |
| `orderCandidates`、`createSecretarySelection` | `src/core/work-graph/tasks/secretary-selection.ts:119`、`src/core/work-graph/tasks/secretary-selection.ts:464` | 秘书候选的准入子集、busy 分类与稳定排序 | 请求分配；不要另算候选或另写排序 |
| `plainSessionRefToAggregate`、`sessionAggregateRefKey` | `src/core/work-graph/sessions/session-record-codecs.ts:1163`、`src/core/work-graph/sessions/session-record-codecs.ts:1157` | 普通 SessionRef 转聚合引用，并生成规范键 | guard、claim 与引用比较；不要内联序列化 Session 聚合 |
| `oldestPendingRound` | `src/core/work-graph/queries/request-rounds-read.ts:464` | 选最老的 pending 非 routing round；**正本**（只此一份） | intake 转移、未分配遍历、Workflow 计划；不要另写排序（M1-16、M1-18、MH-24） |
| `oldestPending`（私有） | `src/business/workflow/request-intake.ts:161` | 把正本结果投影成 `QueryJobRef` 的私有包装 | 本层 intake/drain 使用；不要在这里重写选轮规则 |
| `sameJson` | `src/contracts/fingerprint.ts:50` | 按规范 JSON 判等（不可编码即不相等）；**正本** | 引用/输入判等；不要另写比较 |
| `rejected`、`rejectedWithCurrent` | `src/contracts/core/rejections.ts:5`、`src/contracts/core/rejections.ts:13` | 领域 rejection 构造器，区分是否保留 `current` | 返回失败；本层 `reject` 只保留 owner 专属文案，不重建结果机器（M1-29） |

## 内部用

- `workflow.ts`：`ownContext`（本层入口共用的可信 Host 上下文绑定）与模块级构造器 `graphWrite`、`prepareStep`、`settleReviewStep`、`cancelReviewRoundStep`、`requeueTaskStep`、`reverifyRoundStep`、`readyValue`、`waiting`（供 `task-gate.ts` 装配）；`activity-backfill.ts`：`ACTIVITY_BACKFILL_BATCH_RUNS`（默认批大小 5）。

## 不要做

- 不要直接 import `RecordStore`、`src/app`、`src/composition`，也不要另写存储、索引、状态机或读取器；本层只选意图，执行与结果交给核心 owner。
- 不要绕过 `src/core/work-graph/state/` 改受保护字段；Session/Goal/Task/Run 的生命周期写入各有 owner（AGENTS 第 9 条）。
- 不要另写 oldest-pending 或容量规则：`oldestPendingRound` 已合成一份正本（`src/core/work-graph/queries/request-rounds-read.ts:464`），本层 `oldestPending` 只是私有包装；`createAlwaysAdmitCapacity` 只是默认，真实 Host 用真实上限（M1-16、M1-18、MH-24、FP-12、MH-12）。
- 不要跳过 `findLine` 直接新建线，也不要假设新建 Session 的 revision 仍是 1；重试先按 `commandId` 查回原行并读当前 revision（MH-03、FP-13）。
- 不要另写 rejection 构造：用 `src/contracts/core/rejections.ts` 的 `rejected`/`rejectedWithCurrent`，本层只保留 owner 专属文案（M1-29）。
- 不要把 `advanceWork` 改成有状态循环、调度器或第二内核：每次只调一个 owner 并保留其完整 receipt；`waiting`/`completed` 必须 `next: null`。
- 不要在 `request-round-queue.ts` 里读记录库或重算规则：它只经注入端口（`rounds`、`facts`、`sessions`、`profiles`、`drain`、`driver`）工作，选轮用 `oldestPendingRound`、Session profile 用 `forSession`、页与退避上限取 `src/core/work-graph/model/request-contracts.ts` 的常量；队列也不做第二个调度器，唤醒只来自 `wake` 与注入的 `settle()`。
