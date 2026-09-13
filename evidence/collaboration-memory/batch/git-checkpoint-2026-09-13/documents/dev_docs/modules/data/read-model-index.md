# ReadModelIndex Module：Goal 创建切片

> 当前代码与接线评价见 [模块审计](../../../human/module-status.md) 的对应条目。本页保留职责、Interface 要求及明确标注的首切片约定；旧切片状态不能代替当前实现结论。


```yaml
status: draft
updated: 2026-09-11
slice: 创建 Goal → 持久化 → 投影显示
plane: Data
```

## Purpose

2026-09-05 [设计复核](../../design/human-framework-role-review.md)：当前投影范围不足以覆盖统一图文界面；状态图、解释依据和 freshness 配对需复核。

`ReadModelIndex` 把已提交 Event 转换为面向查询的 Goal View，并显式暴露投影 cursor。它隐藏索引、重建、
去重和查询布局，使展示调用者无需读取 canonical store 或重放 Event。

ReadModelIndex 属于 Data Plane 的查询侧，消费者可以是 UI 或获授权的 ContextCompiler；后者按角色／任务选择材料，
本 Module 维护可复用查询投影。投影的 schema／cursor 检查仅保证输入和视图处理完整性，代码规范检查、测试、语义 Review
由验证流程负责。当前首切片仍只提供下述 Goal 查询，不提前创建完整 Dashboard 或 ContextCompiler 的所有查询。

## Interface

角色、Run 与报告引用的查询扩展遵循 [运行时协作 Interface](../../interfaces/runtime-collaboration.md)。投影新事件需要显式 schema；旧 GoalView 形状不隐式扩张。外层入口须验证查询权限，本 Module 继续执行完整 scope 隔离。

```ts
interface ReadModelIndex {
  advance(page: EventPage): Promise<ProjectionReceipt>;
  goal(query: GoalViewQuery): Promise<GoalViewResult>;
}
```

首切片的 `GoalView` 只包含 `goalId、projectId、workspaceId、objective、desiredState、activePlanRevision、
aggregateRevision、sourceCursor`。查询结果为 `ready | not_ready | not_found`；`not_ready` 表示尚未达到
`atLeastCursor`，不是业务状态。

## Hidden Implementation

Implementation 隐藏：`GoalCreated` projection handler、cursor checkpoint、去重、按 Project/Workspace 的索引、
projection storage、catch-up 和 rebuild。后续新增 View 不扩大调用者对这些流程的认知负担。

## Dependencies

- Event/cursor 使用[Command/Event Interface](../../interfaces/command-event.md)，EventPage 使用
  [StateLedger Interface](../../interfaces/state-ledger.md)，并实现
  [Goal View Interface](../../interfaces/goal-view.md)；
- catch-up/rebuild 只调用 [`StateLedger.events`](./state-ledger.md#interface)；
- projection storage 是内部 Seam；
- 只读政策解释复用 ControlEngine 的 PolicyExplanationPort；不提交 Control 命令，不依赖 HumanCollaboration。

## Invariants

### Global

- Read Model 是可删除、可由 Event 重建的派生状态，不是 canonical state；
- Read Model 不接受业务 Command，也不能产生或修改 Domain Event；
- 每个 View 都携带生成它的 source cursor/revision。

### Local

- `GoalCreated@1` 只能产生一个相同 revision 的 Goal View；
- 重复 Event 无副作用；Event 缺口、乱序或未知 schema version 必须停止推进并报告，不能静默跳过；
- 只有 `observedCursor` 已覆盖 `atLeastCursor` 后仍无 Goal 才能返回 `not_found`；未覆盖时返回
  `not_ready`；
- Goal 行的 `sourceCursor` 记录最后一次改变该行的 Event；全局 freshness 只看 `observedCursor`；
- Goal View 的存取 key 是 `(projectId, workspaceId, goalId)`；不同 Project 复用本地 ID 时必须保持独立；
- 从空索引重建的 View 与增量投影逐字段一致；
- objective 只来自 Event，不从 UI request 或 CommandReceipt 旁路填充。

## Test seam

通过固定 EventPage fixture 驱动 `advance`，再仅通过 `goal` 断言结果。覆盖首次投影、重复、缺口、乱序、
未知版本、read-after-write cursor、重建等价、删除索引后恢复，以及跨 Project 同名本地 ID 隔离；不直接
断言内部表结构。

## Explicitly not responsible

- 不校验 CreateGoal guard 或推进 canonical Goal state；
- 不处理自然语言、用户权限或 UI 渲染；
- 不调度 Worker、生成 Evidence 或存储完整 Artifact；
- 不承诺与 StateLedger 同事务更新，调用者必须使用 cursor 处理延迟。

## Context load

默认只装载：本文件、[Command/Event Interface](../../interfaces/command-event.md)、
[StateLedger Interface](../../interfaces/state-ledger.md)、
[Goal View Interface](../../interfaces/goal-view.md)、当前 Ticket，以及仅在调用时装载
[`StateLedger.events`](./state-ledger.md#interface) 的 Interface 小节。展示集成时只额外装载
[`HumanCollaboration.Interface`](../interaction/human-collaboration.md#interface)；不装载 Control Implementation、
完整 Event 历史、总体架构或无关 View 文档。
## P1-02 extension record：Plan / Task 投影

2026-09-05 [P1-02](../../planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md) 版本化扩展：advance 处理 5 个新 v1 事件（goal 行在 PlanRevisionAccepted 后刷新 activePlanRevision；Plan Graph / Task Detail 行由事件 payload 重建）；planGraph/taskDetail 查询复用 cursor freshness；未实现投影的已知事件整页停止（unsupported_event_type），绝不部分应用。

## P1-03 extension record：dispatch / run 投影

2026-09-05 [P1-03](../../planning/proposed/P1-foundation/tickets/03-fake-run-visible.md) 版本化扩展：advance 处理 4 个新 v1 事件（TaskClaimed / RunStarted / RunEventRecorded / RunOutcomeUnknown），重建 activeAgent 与 TaskDetailView.run；freshness 沿用 opaque cursor；已知事件无 handler 仍整页停止（unsupported_event_type），绝不部分应用。
## P1-04 extension record：evidence / reduction 投影

2026-09-05 [P1-04](../../planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md) 版本化扩展：advance 处理 EvidenceAdmitted / TaskReductionUpdated，task-detail 验证视图（有效集/过期/越界仅展示）；projection stall 规则不变。
## P1-05 extension record：goal phase 投影

2026-09-06 [P1-05](../../planning/proposed/P1-foundation/tickets/05-goal-phase-reduction.md) 版本化扩展：advance 处理 GoalPhaseUpdated，goalStatus / goalTimeline 查询（key=(projectId, goalId)）；ModuleProgress/StageProgress 只展示，绝不作为 reducer 输入。
## P1-06 extension record：handoff provenance 投影

2026-09-06 [P1-06](../../planning/proposed/P1-foundation/tickets/06-handoff-a-to-b.md) 版本化扩展：advance 处理 HandoffRecorded / ReplacementClaimed，handoffProvenance 时间线重建（等价/全键隔离/freshness）。
## P1-07 extension record：lease / conflict / patch 投影

2026-09-06 [P1-07](../../planning/proposed/P1-foundation/tickets/07-parallel-readers-single-writer.md) 版本化扩展：advance 处理 6 个新 v1 事件（WorkspaceReadLeaseGranted/Released、WorkspaceWriteLeaseGranted/Released、IntegrationJoined、PatchRecorded），writerLease / integrationConflicts / workspacePatches 三视图（只展示）；isHandledEventType 与 handler 同 commit（KNOWN 同步）、未知事件仍整页停止；断言前先 advanceProjection。

## P1-18 extension record：material-access 授权行

2026-09-08 版本化扩展：advance 处理 `MaterialAccessGranted`，每个不可变授权产生一行（内存数组／SQLite `material_access_grant_rows`），新增 `materialAccessGrants(query)` 查询（projectId 必填，可再按 workspaceId、goalId、materialDigest、readerRunId 过滤，返回有界的最近记录集合）。

该视图只供展示；宿主权限解析已切换到下述 materialAccessCandidates 精确查询。读者一致性、材料一致性、声明基线与签发者权威由 Vault 自己判定；视图本身不授权、不判断完成、不写状态。授权行跨重开保留，空索引重放同一事件得到相同行。
## Context 生命周期与协作扩展

P1-16／17 投影工作接续和历史来源；P1-15 展示议题、待决与通知／刷新状态。报告文字不变成完成事实。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。

2026-09-08：内存与 SQLite completedWorkView 共同按当前计划的 TaskReduction satisfied 或 Goal COMPLETED 筛选；未知结束资格保守排除，重开结果一致。保留原始工作记录，不以 Run 结束或存在笔记代替正式完成。

## RW-09 extension record：时间线的计划变更原因（2026-09-10）

`TimelineEntry` 增加两个字段，两套后端同语义：`refs.planId`（这条 `plan_accepted` 讲的是哪一份计划）与可选的 `change`（`reason`／`actor`／`goalRevision`／`activePlanId`／`supersededPlanIds`）。

为什么在投影里补：`PlanRevisionAccepted` 事件本身不带变更原因，原因在**同一个提交批次**的 `GoalRevisionRecorded` 事件里（`change.reason` 逐字落账：人的决定受理是 `user-decision-accepted`，ControlEngine 的自动受理是 `autonomous-rework:<proposalId>`）。投影按到达顺序折叠，`plan_accepted` 先到，因此 `applyP111` 在折叠 `GoalRevisionRecorded` 时按「目标 + 生效计划 id」回头把 `change` 写进已存在的条目——不新造条目、不改写 summary、不解析 id 形状。计划的**初始**受理没有 `GoalRevisionRecorded`，那条条目不带 `change`，含义是"这不是一次计划变更受理"，不是"原因未知"。

消费方：工作台「动态」按 `change.actor.kind` 标注系统自动受理／人的决定，并把 `change.reason` 逐字显示；「计划变更」视图经 `/api/real/plan-changes/view` 消费既有的 `planChangeView`，不新增投影。两套读模型的一致性由 `tests/read-model/plan-change-timeline.test.ts` 对同一段事件逐字段比对。

## 2026-09-09 材料授权边界修复

materialAccessGrants(query) 保留最多 256 条的展示用途。新增 materialAccessCandidates({reader, material}) 供宿主解析：按完整 Run/QueryRun 身份及 contentType/digest/sizeBytes 返回全部精确候选，不能在权限和版本筛选前截断；不改变授权决定仍由 Vault 作出的职责。

内存和 SQLite Adapter 同时实现，两个宿主均切到该查询。SQLite 在 SQL 中预筛项目／runId 后遍历并校验完整身份与材料；当前没有新的专用索引，大规模查询性能仍可优化，但不得用隐藏截断换取性能。重开／投影重建仍读取原有授权行，无存储迁移。
## 当前源码边界（2026-09-11）

GovernanceViewPort 的实现 `src/data/read-model-index/governance-view.ts` 按需读取已提交治理事件与 canonical active/revision，组织当前生效内容、操作者及缺口。它不另存 active 权威、不提交治理命令；app/governance 只委托查询并适配人类命令与回执。此前治理查询留在 Host 的例外已结束，原文保存在本次 history；不需要出现第二消费者才将查询归 Module。

内存与SQLite实现继续消费同一已提交Event语义，给出明确scope/cursor。两者注入同一PolicyExplanationPort解释证据和变更，不复制Control算法，也不把解释改写为正式reduction。InitialPlanningView组织规划展示；原ScopeCatalog属于canonical目录发现，按StateLedger边界迁出。两种后端尚有重复投影/View规则，属于本Module内部维护债，不能说已全部消除。

跨 Module 的精确入口与失败/持久兼容规则见 [当前 Module 边界](../../interfaces/module-boundaries.md)。此源码映射不代替整体功能验收。

VR-02 的 `reviewer-projection.ts` 共享正式Work/Result/协议投影与解释材料，两种后端都展示独立Reviewer Run，并保留原TaskLease来源。Evidence解释调用Control同一纯Reviewer资格函数，采用新协议后旧satisfied缓存不能直接成为完成说明；投影无状态提交权。准确边界见[独立审阅](../../interfaces/independent-review.md)，本批已按[VR-02验收](../../verification/2026-09-09-independent-review/acceptance.md)确认限定能力；其余旧投影重复仍是模块内维护债。

phase标签保留最后已提交的归约事件，不与协议采用原子刷新；adoption checkpoint未成功时，标签和已经失效的旧Reviewer资格解释可能暂不一致。当前资格仍需完整守卫，不能把旧标签当作完成或执行权限。

CM-M06-001：communication-view.ts提供两种Ledger共用的事件重建投影，最多200页×1000；序列缺口、读取失败或未追上atLeastCursor返回not_ready。等待按Goal筛选，积压/最近80条时间线明确为当前工作区范围；正式运行终态复用isTerminalRuntimeEvent。 精确语义见[运行时协作](../../interfaces/runtime-collaboration.md)，M06 snap-01 已独立验收，准确边界见模块状态。


CM-1B-001（实施中、未冻结验收）：MemoryViewIndex 只读 StateLedger 当前 collection 与 revision，不建立第二份记忆存储或推测已生效状态。 契约见[记忆维护与回应选材](../../interfaces/memory-maintenance.md)。
