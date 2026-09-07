# P0-03：Plane → deep Module → dependency DAG

```yaml
status: completed
updated: 2026-09-04
kind: design-ticket
evidence_refs:
  - ../../../../verification/p0-documentation-evidence.md#p0-03
```

## Blocked by

- [P0-02 Rewrite maps](./02-rewrite-maps.md) — 已满足。

## What it delivers

将六个 Plane 中的细框收敛为少量深 Module，并用首个 Goal 的路径检查 Interface：用户提交 Goal，Control 持久化，Read Model 展示，Dispatcher 经 RuntimePort 运行，Verification 回交 Evidence，Goal 状态重新投影。

长期架构依赖只表达“调用者需要了解哪个 Interface”；开发 ticket 的先后另见 P1 DAG，二者不得互相推导。

## Module / Interface refs

- [Module Registry](../../../../../ARCHITECTURE.md#module-registry)；
- [ModuleDependencyDAG](../../../../../ARCHITECTURE.md#moduledependencydag)；
- 首切片：[HumanCollaboration](../../../../modules/interaction/human-collaboration.md)、
  [ControlEngine](../../../../modules/control/control-engine.md)、
  [StateLedger](../../../../modules/data/state-ledger.md) 与
  [ReadModelIndex](../../../../modules/data/read-model-index.md)；
- 首切片契约：[Command/Event](../../../../interfaces/command-event.md)、
  [State Ledger](../../../../interfaces/state-ledger.md) 与 [Goal View](../../../../interfaces/goal-view.md)。
- 其余 Module 在对应 P1 Ticket 到达施工前沿时再展开，不预建空 Implementation。

## Acceptance

- Plane 没有被当作可 import 的代码 Module；
- `ControlEngine` 不依赖具体 Runtime、数据库或 UI Adapter；
- event feedback 可以成环，但源码依赖 DAG 无环；
- `CodingAgentAdapter` 与 `FakeRuntimeAdapter` 通过同一 `WorkerRuntime` seam；
- 删除任何深 Module 后，其隐藏复杂度会重新泄漏到多个调用者，而不是只少一层转发。
