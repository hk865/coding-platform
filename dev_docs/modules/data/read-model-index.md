# ReadModelIndex Module：Goal 创建切片

```yaml
status: draft
updated: 2026-09-06
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
- 不依赖 ControlEngine 或 HumanCollaboration Implementation。

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

## Context 生命周期与协作扩展

P1-16／17 投影工作接续和历史来源；P1-15 展示议题、待决与通知／刷新状态。报告文字不变成完成事实。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。
