# DispatchEngine Module

```yaml
status: draft
updated: 2026-09-06
plane: Control
```

## Purpose

把持久派发意图落实成有权限、有预算、可恢复的 Worker Run，并回交运行事实。

## Interface

候选操作：`drive(trigger) / accept(event) / snapshot(query)`。共享字段、拒绝与状态语义唯一来源为 [运行时协作契约](../../interfaces/runtime-collaboration.md)，本页不复制 wire schema。首个消费者：P1-03；06/07/09/10 分别扩展换手、写 lease、查询和控制；设计已展开不代表契约已冻结或实现。

## Dependencies

ControlEngine、ContextCompiler、WorkerRuntime、ArtifactVault。长期调用关系以 [ModuleDependencyDAG](../../../ARCHITECTURE.md#moduledependencydag) 为准；运行时事件反馈不是反向源码依赖。

## Hidden Implementation

领取与启动间的恢复、运行事件关联、正文保存、公开快照适配。启动身份可重放，未知副作用留待对账。

## Test seam

通过上述 Interface 注入依赖 Adapter，验证：竞争领取、启动前崩溃、重复／迟到事件、过期绑定、不可用快照和安全退出。 不以内部表或私有方法作为唯一测试入口。

## Context load

实现或扩展本 Module 时读取本页、当前 Ticket 与直接消费的 [运行时协作契约](../../interfaces/runtime-collaboration.md) 小节；初始协商及图文集成另读 [初始设计与统一展示](../../interfaces/human-design-status.md)。原始对话和完整历史按需追溯，不默认装入 Run。

## Extension records

- **P1-03（首个消费者，冻结）**：DispatchPort = `drive(trigger)`（唯一入口；outbox-before-side-effect：加载 pending → assemble → startRun 提交 → 之后才调用 runtime.start）；实现见 src/control/dispatch-engine.ts。
- **P1-06**：换手面 driveHandoff（src/control/handoff-drive.ts）；normal drive 在扫描前跳过带 ReplacementAttempt 的意图（scanned 语义）。
- **P1-07**：WorkspaceDrivePort.driveParallel（版本化新增，不改 P1-03 DispatchPort；切片内全部 intent 并发 assemble→startRun→runtime.start，再并发 consume；run-scoped 幂等键）；公开快照查询面见 [WorkerRuntime](../execution/worker-runtime.md)（HandoffControlPort.snapshot，P1-06 冻结）。

## Context 生命周期与协作扩展

P1-16 落实继续／转交意图及能力降级；P1-15 路由议题和决定，确认受影响工作材料刷新后接续，旧 Run 不能覆盖新状态。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。
