# Goal View Interface：Goal 创建切片

```yaml
status: draft
updated: 2026-09-05
slice: 创建 Goal → 持久化 → 投影显示
participants: HumanCollaboration, ReadModelIndex
```

## Purpose

2026-09-05 [设计复核](../design/human-framework-role-review.md)：本契约仅覆盖 Goal 创建查询，尚不覆盖统一状态图、语义解释、需求／架构协作或其一致性契约。

本 Interface 固定 Goal 查询结果和 read-after-write freshness 语义。调用者可以用写入返回的
`commitCursor` 判断投影是否追上，而不读取 canonical store、猜测等待时间或回显提交请求。

本契约返回事实投影及其 freshness，不执行代码静态分析或 Agent 语义验证。ContextCompiler 可在查询授权范围内消费
这种视图，并结合其它材料编译任务 Context；正式状态推进仍由 Control 对 canonical state 校验。

## Interface

完整协作的扩展行为见 [运行时协作 Interface](runtime-collaboration.md)。以下类型仍限定于 CreateGoal 首切片；新增角色／消息／运行或报告查询必须显式扩展 schema，不把本切片类型直接用作完整协作类型。

```ts
type GoalViewQuery = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  atLeastCursor?: CommitCursor;
};

type GoalView = {
  goalId: string;
  projectId: string;
  workspaceId: string;
  objective: string;
  desiredState: "active";
  activePlanRevision: null;
  aggregateRevision: 1;
  sourceCursor: CommitCursor;
};

type GoalViewResult =
  | { status: "ready"; goal: GoalView; observedCursor: CommitCursor }
  | {
      status: "not_ready";
      requiredCursor: CommitCursor;
      observedCursor: CommitCursor | null;
    }
  | { status: "not_found"; observedCursor: CommitCursor | null };

type ProjectionReceipt = {
  throughCursor: CommitCursor | null;
  appliedEventIds: string[];
};
```

`not_found` 只表示投影已经达到 `atLeastCursor`（若提供）但没有匹配 Goal；否则必须返回
`not_ready`。`observedCursor` 是 ReadModelIndex 已连续处理到的位置；`sourceCursor` 只记录当前 Goal 行
最后一次被哪个 Event 改变，不能单独证明整个投影的 freshness。

## Hidden Implementation

本文件没有 Implementation。等待、轮询或订阅策略属于 `HumanCollaboration`；索引、checkpoint、重建与
projection storage 属于 `ReadModelIndex`。

## Dependencies

- `CommitCursor` 与 `commitCursor` 使用 [Command/Event Interface](command-event.md) 的同一 opaque type；
- ReadModelIndex 的输入页使用 [StateLedger Interface](state-ledger.md) 中唯一的 `EventPage`；
- 不依赖数据库 schema、transport、UI framework 或 canonical snapshot 类型。

## Invariants

### Global

- Goal View 是 Event 的可重建投影，不拥有业务状态；
- freshness 由 cursor 证明，不由时间延迟或进程内调用顺序推断；
- View 字段只能来自已提交 Event。

### Local

- `ready.observedCursor` 必须已经连续覆盖查询的 `atLeastCursor`；
- `ready.goal.sourceCursor` 不得晚于 `ready.observedCursor`，但可以早于 `atLeastCursor`；
- `ready.goal` 的 projectId、workspaceId 与 goalId 必须逐项等于 query；
- `(projectId, workspaceId, goalId)` 是查询键；不得仅按 `workspaceId` 或 `goalId` 命中其他 Project 的行；
- 达不到 `atLeastCursor` 时，即使索引中暂时没有 Goal，也只能返回 `not_ready`；
- `GoalCreated@1` 投影出的 `activePlanRevision` 必须为 `null`；
- 同一 Event 重放不改变 Goal View，也不重复报告 applied Event。

## Test seam

以固定 GoalCreated/EventPage fixture 驱动任意 ReadModelIndex Adapter，再只通过 `goal` 查询。契约测试覆盖
cursor 落后、刚好追上、追上后不存在、ready、重复 Event、从空索引重建，以及两个 Project 复用相同
`workspaceId/goalId` 时仍精确隔离。

## Explicitly not responsible

- 不定义 Goal 创建 Command、业务 guard 或 canonical state；
- 不定义 Plan、Task、Run、Todo 或完整 Dashboard；
- 不承诺同步投影或特定等待时长。

## Context load

实现 Goal 查询或展示时默认只装载：本文件、当前 Ticket，以及
[`HumanCollaboration.Interface`](../modules/interaction/human-collaboration.md#interface) 或
[`ReadModelIndex.Interface`](../modules/data/read-model-index.md#interface) 中与当前角色直接相关的一节。
只有实现 cursor/event 适配时再读取 [Command/Event Interface](command-event.md)与
[StateLedger Interface](state-ledger.md)。
## P1-04 extension record：task-detail 验证视图

2026-09-05 [P1-04](../planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md) 版本化扩展（Plan Graph / Task Detail 形状不变——**绝不把报告文字投影为正式完成状态**）：

- ReadModelIndex 增加 taskVerification 查询（契约见 src/contracts/verification-view.ts）：key=(projectId, goalId, taskId)；只从 EvidenceAdmitted/TaskReductionUpdated 事件重建；每条 EvidenceBindingView 的 applicability 由纯函数按视图“当前锚”（=最新 TaskReduction.currentAnchor；无归约前为 null 且 applicability=null）派生；freshness 复用 opaque CommitCursor（not_ready≠not_found）；投影停滞（已知 v1 事件无 handler）仍整页停止（unsupported_event_type），不静默跳过；
- 契约测试：tests/contract-suite/{evidence,verification}.contract.suite.ts + tests/read-model|sqlite-read-model/p1-04-verification-projection（InMemory + SQLite 共用同套件）。
## P1-02 extension record：Plan Graph / Task Detail 与 active plan

2026-09-05 [P1-02](../planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md) 版本化扩展：

- GoalView.activePlanRevision 由固定 null 扩展为 PlanRevisionRef | null（GoalCreated@1 仍投影 null；PlanRevisionAccepted 事件刷新该行与 sourceCursor）；
- ReadModelIndex 增加 planGraph / taskDetail 查询（契约见 src/contracts/plan-view.ts）；freshness 复用 opaque CommitCursor 语义：not_ready != not_found；查询键为全键 (projectId, goalId[, taskId])；
- ProjectionStallReason 增加 unsupported_event_type：已知 v1 事件类型但无投影 handler 时整页停止，绝不部分应用或静默跳过；
- 契约测试：tests/contract-suite/plan.contract.suite.ts（InMemory + SQLite 共用同套件）。
## P1-05 extension record：goal phase status / timeline 视图

2026-09-05 [P1-05](../planning/proposed/P1-foundation/tickets/05-goal-phase-reduction.md) 版本化扩展（GoalView 形状不变）：

- ReadModelIndex 增加 goalStatus 与 goalTimeline 查询（契约见 src/contracts/goal-phase-view.ts）：key=(projectId, goalId)；只从 GoalPhaseUpdated 事件重建（ready 分支的视图字段名是 `goal`，不是 `status`）；goalTimeline 按事件顺序追加；freshness 复用 opaque CommitCursor（not_ready≠not_found；无 atLeastCursor 且无行 → not_ready）；
- **ModuleProgress/StageProgress 只作为投影展示，绝不作为 Goal reducer 输入**（防投影回环——Goal phase 只从 canonical 事实归约）；
- 契约测试：tests/contract-suite/goal-phase.contract.suite.ts（InMemory + SQLite 共用同套件）+ tests/read-model|sqlite-read-model/p1-05-goal-phase-projection。

## P1-03 extension record：ActiveAgent / TaskDetail run 视图

2026-09-05 [P1-03](../planning/proposed/P1-foundation/tickets/03-fake-run-visible.md) 版本化扩展（GoalView 形状不变）：ReadModelIndex 增加 activeAgent（key=projectId+goalId+taskId）与 TaskDetailView.run（TaskRunState）查询，均只从 TaskClaimed / RunStarted / RunEventRecorded / RunOutcomeUnknown 事件重建；freshness 复用 opaque CommitCursor（not_ready≠not_found）。契约见 src/contracts/active-agent.ts。

## P1-06 extension record：handoff provenance 视图

2026-09-06 [P1-06](../planning/proposed/P1-foundation/tickets/06-handoff-a-to-b.md) 版本化扩展：ReadModelIndex 增加 handoffProvenance（key=projectId+goalId+taskId；packet_recorded / replacement_claimed / evidence_admitted 有序时间线，outcomeUnknownPreserved 标记）。契约见 src/contracts/handoff-view.ts。

## P1-07 extension record：lease / conflict / patch 视图

2026-09-06 [P1-07](../planning/proposed/P1-foundation/tickets/07-parallel-readers-single-writer.md) 版本化扩展：ReadModelIndex 增加 writerLease（key=projectId+workspaceId）、integrationConflicts（key=projectId+goalId+taskId；conflictKey 首记录权威、迟到 duplicate 标记、escalation 标记）、workspacePatches（key=projectId+workspaceId）三视图，只展示不判定。契约见 src/contracts/workspace-views.ts。