# P0-04：First-slice contract pack

```yaml
status: completed
updated: 2026-09-04
kind: design-ticket
evidence_refs:
  - ../../../../verification/p0-documentation-evidence.md#p0-04
```

## Blocked by

- [P0-03 Module DAG](./03-module-dag.md) — 已满足。

## What it delivers

定义 P1 首个 tracer bullet 必须冻结的最小 contract pack。该 slice 先用版本化 bootstrap source 建立至少两个隔离的 Project/Workspace，再在每个完整作用域各创建一个 Goal；每条 CreateGoal 命令仍只创建一个 Goal。它们经 Control、StateLedger 和 ReadModelIndex，在重启后仍显示各自且不串范围的 GoalView；它不隐式创建 Plan、Task 或 Run，也不等待 Planner、Worker 或完整 Web UI。

## Module / Interface refs

- [HumanCollaboration Interface](../../../../modules/interaction/human-collaboration.md#interface)；
- [ControlEngine Interface](../../../../modules/control/control-engine.md#interface)；
- [StateLedger Interface](../../../../modules/data/state-ledger.md#interface)；
- [ReadModelIndex Interface](../../../../modules/data/read-model-index.md#interface)；
- [Command/Event contract](../../../../interfaces/command-event.md)：
  `CreateGoalCommand / CommandReceipt / GoalCreatedEvent`；
- [State Ledger contract](../../../../interfaces/state-ledger.md)：
  `GoalSnapshot / LedgerCommit / LedgerCommitReceipt / EventPage`；
- [Goal View contract](../../../../interfaces/goal-view.md)：
  `GoalViewQuery / GoalViewResult / ProjectionReceipt`。

Task、PlanRevision、Dispatch 与 Verification contract 在出现第一个真实消费者时追加，不作为首个 slice 的占位类型。

## Acceptance

- Command、Ledger、EventPage 与 GoalView 类型闭合，参与 Module 只引用这一组契约；
- `activePlanRevision = null` 以及“不隐式创建 Plan、Task、Run、dispatch outbox”已写成可证伪不变量；
- expected revision/CAS、idempotency identity/fingerprint 和 cursor freshness 语义已明确；
- InMemory 与 SQLite Ledger 的共同 contract test seam 已定义，但实现证据留给 P1；
- contract 不提前暴露 reducer、SQLite schema、模型 prompt 或未来 Runtime 内部状态。
