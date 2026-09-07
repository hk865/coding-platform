# P0 Documentation Evidence

```yaml
status: current
updated: 2026-09-04
scope: P0-01..P0-05 文档产物与复验依据
validator: ./validate-docs.mjs
```

本文是 P0 文档类 Ticket 的 Evidence 索引。它记录已形成的文档产物、可重复的结构检查和人工可复核依据，不改变 Ticket、Phase 或产品状态。P0-06 的用户裁决不在本文件的覆盖范围内。

## 复验入口

从项目根目录运行：

```text
node dev_docs/verification/validate-docs.mjs
```

校验器只使用 Node.js 标准库，检查当前 Markdown 本地链接、P0/P1 状态门禁、兼容路由元数据、Architecture ModuleDependencyDAG、P1 Ticket DAG 与 Artifact 闭包、Release Gate 对齐、P0 归档 payload digest、P0 Evidence 引用以及残留 patch 备份文件。语义验收仍以各 Ticket 的 Acceptance 和下列人工可复核产物为准。

## P0-01

Ticket：[Archive source](../planning/active/P0/tickets/01-archive-source.md)

### 文档产物

- [Archive index](../archive/INDEX.md)；
- [v0.3 archive note](../archive/v0.3-2026-09-04/ARCHIVE-NOTE.md)；
- 下表列出的不可变来源快照。

### 验证依据

- Archive note 明确枚举 6 个原始 payload：改写前的 README、CONTEXT、产品定义、总体架构、任务完成规则和 P0 计划；ARCHIVE-NOTE 是快照说明，不计入原始 payload；
- Archive index 将快照标为历史来源，并明确排除默认 Agent Context；
- 2026-09-04 对下列文件逐个执行 SHA-256，形成可复核内容标识。

### 归档清单与 SHA-256

| 归档文件                                                                                          | SHA-256                                                          |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [README.md](../archive/v0.3-2026-09-04/README.md)                                                 | b6ca0aed1b6f9845fdad45f55bc0f2910868439563edf2b47e2c1508e732afba |
| [CONTEXT.md](../archive/v0.3-2026-09-04/CONTEXT.md)                                               | ef3b30a748f6721574014ddfa84b8319458b81c34c631af92f7fe1f8e718cabd |
| [产品定义.md](../archive/v0.3-2026-09-04/dev_docs/product/产品定义.md)                            | ce6a68235ea4bd535f31edd41dce7d73679b3b7a4493ec5f4a36050c4f760526 |
| [总体架构.md](../archive/v0.3-2026-09-04/dev_docs/design/总体架构.md)                             | 80f6ccd73bc4e6d185f67154a022a32bc36f2f0964f8eb22ce34d4da051b4b4d |
| [任务图与完成判定.md](../archive/v0.3-2026-09-04/dev_docs/design/任务图与完成判定.md)             | 4c9bc4bb9be84b78bd99bc8a2a8487b89a9eeb11fa1322508d91920d32f19848 |
| [P0-产品定义与总体架构.md](../archive/v0.3-2026-09-04/dev_docs/planning/P0-产品定义与总体架构.md) | 861bf2046e0ba200807d433e9d125507ee26f5d489e2b75da309356bbdcd6338 |

## P0-02

Ticket：[Rewrite maps](../planning/active/P0/tickets/02-rewrite-maps.md)

### 文档产物

- [README](../../README.md)、[AGENTS](../../AGENTS.md)、[PRODUCT](../../PRODUCT.md)、[CONTEXT](../../CONTEXT.md) 与 [ARCHITECTURE](../../ARCHITECTURE.md)；
- [用户需求原文](../product/用户需求原文.md)、[Completion Policy](../interfaces/completion-policy.md) 与 [工作入口和系统结构图](../design/agent-entry-and-system-map.md)；
- 支撑导航：[Roadmap](../planning/ROADMAP.md)、[P0 DAG](../planning/active/P0/DAG.md) 与 [Decision index](../decisions/INDEX.md)；
- 四个兼容路由：[产品定义](../product/产品定义.md)、[总体架构](../design/总体架构.md)、[任务图与完成判定](../design/任务图与完成判定.md) 与 [旧 P0 路径](../planning/P0-产品定义与总体架构.md)。

### 验证依据

- 当前入口把产品边界、领域词汇、架构、Interface、Roadmap 和历史来源分层路由；
- 四个兼容路径只负责跳转，均声明 status 为 superseded 且 route_only 为 true；
- Completion Policy 明确 ReadModel/Todo 不是 canonical state，Worker/Reviewer 不能直接完成 Task 或 Goal；
- 校验器遍历全部当前 Markdown，验证本地链接与兼容路由元数据。

## P0-03

Ticket：[Plane → deep Module → dependency DAG](../planning/active/P0/tickets/03-module-dag.md)

### 文档产物

- [Module Registry 与 ModuleDependencyDAG](../../ARCHITECTURE.md#module-registry)；
- 首切片 Module：[HumanCollaboration](../modules/interaction/human-collaboration.md)、[ControlEngine](../modules/control/control-engine.md)、[StateLedger](../modules/data/state-ledger.md) 与 [ReadModelIndex](../modules/data/read-model-index.md)；
- 首切片 Interface：[Command/Event](../interfaces/command-event.md)、[State Ledger](../interfaces/state-ledger.md) 与 [Goal View](../interfaces/goal-view.md)；
- 设计依据：[ADR-0002](../decisions/0002-module-dag-and-tracer-bullet-tickets.md)。

### 验证依据

- Architecture Map 分开定义 Plane、Module Interface 与长期源码依赖，并在正文中说明运行时反馈循环不改变源码依赖方向；
- 校验器定位 ModuleDependencyDAG Mermaid block，要求每条普通调用边和 adapter implements 边均可解析，并机械验证源码依赖图无环；
- 首切片 Module 文档通过三份跨 Module Interface 描述 CreateGoal → Ledger → EventPage → GoalView；
- 校验器验证上述当前文档引用均可解析；它不替代对 Module 深度或职责边界的人工评审。

## P0-04

Ticket：[First-slice contract pack](../planning/active/P0/tickets/04-first-slice-contracts.md)

### 文档产物

- [HumanCollaboration](../modules/interaction/human-collaboration.md)、[ControlEngine](../modules/control/control-engine.md)、[StateLedger](../modules/data/state-ledger.md) 与 [ReadModelIndex](../modules/data/read-model-index.md)；
- [Command/Event contract](../interfaces/command-event.md)、[State Ledger contract](../interfaces/state-ledger.md) 与 [Goal View contract](../interfaces/goal-view.md)；
- 下游一致性复核：[P1-00 executable contract pack](../planning/proposed/P1-foundation/tickets/00-contract-pack.md)。

### 验证依据

- 三份 Interface 闭合 CreateGoal command、canonical snapshot/Event commit、EventPage 和 GoalView projection；
- P1-00 只创建 Project/Workspace bootstrap、CreateGoal、Ledger/Event/View 所需 contract 与 fixture；
- P1-00 明确 Goal 初始 activePlanRevision 为空，且不产生 Plan、Task、Run 或 dispatch outbox；
- 校验器验证 P1-00 metadata、Artifact 声明及所有相关本地链接。

## P0-05

Ticket：[Proposed build DAG](../planning/active/P0/tickets/05-proposed-build-dag.md)

### 文档产物

- [P1-foundation DAG](../planning/proposed/P1-foundation/DAG.md)；
- [15 张 P1 tickets](../planning/proposed/P1-foundation/tickets/)；
- [MVP evaluation scenario](../evaluation/mvp-scenario.md)；
- [Roadmap promotion rules](../planning/ROADMAP.md#5-promotion-规则)。

### 验证依据

- 校验器要求 15 张 Ticket 均保持 proposed 与 tracer-bullet-vertical-slice；
- 每张 Ticket 的 blocked_by 必须与 Mermaid ticket edge 完全一致，且图必须无环；
- 每个 input Artifact 必须声明 artifact/source/producer；upstream producer 必须是图祖先并实际输出同名 Artifact，所有 output 名称全局唯一，`interfaces_to_freeze` 的首次所有者也不得重复；
- release_gates 与 mvp_waits_for 必须逐项一致；
- 这些检查只验证候选施工图的结构，不把 P1 提升为 active，也不替代 P0-06 用户门禁。
