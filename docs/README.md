# 文档入口

更新：2026-10-13。本仓库根就是原 `coding-platform/next`，文档在 `docs/`。先读 [STATUS](refactor/STATUS.md) 和 [HANDOFF 顶部](refactor/HANDOFF.md)的决定 1–58，再按任务读[编排设计目录](refactor/design/orchestration-2026-10/README.md)。可靠性批次、编排第 0、1、3、5 片和接线包 1 已完成；接线包 2 在准备，整个 MVP 没有完成。

| 要回答的问题 | 当前入口 |
| --- | --- |
| 做到哪里、缺什么、下一步是什么 | [STATUS](refactor/STATUS.md) |
| 用户已定了什么 | [HANDOFF 顶部：决定 1–58](refactor/HANDOFF.md) |
| 编排、记忆和生命周期怎样设计 | [设计目录](refactor/design/orchestration-2026-10/README.md)、[DESIGN](refactor/design/orchestration-2026-10/DESIGN.md)、[读法模型](refactor/design/orchestration-2026-10/model/README.md)、[记忆查找](refactor/design/orchestration-2026-10/MEMORY-LOOKUP.md) |
| 接下来如何施工、怎样分工和测试 | [分片规格与任务书](refactor/design/orchestration-2026-10/slices/README.md)、[DSH-WORKFLOW §6.10](refactor/DSH-WORKFLOW.md#610-大片怎么交给-dsh决定-46)、[根 AGENTS](../AGENTS.md)的 2026-10-13 做法 |
| 界面以什么为准 | [冻结原型](ui-reference/workbench-2026-10/README.md)、[UI-WORKBENCH §0](UI-WORKBENCH.md#ui-decisions-2026-10)、[E3 待办](refactor/design/orchestration-2026-10/E3-UI-ITEMS.md) |
| 产品承诺和 MVP 用户路径是什么 | [PRODUCT](PRODUCT.md)、[MVP-BEHAVIOR](MVP-BEHAVIOR.md)；后续决定以 HANDOFF 顶部为准 |
| 目标架构、模块及依赖是什么 | [ARCHITECTURE](refactor/ARCHITECTURE.md)、[模块索引](refactor/modules/README.md)、[DAG](refactor/module-dag.md)、[机器可读规则](refactor/module-target.json) |
| 原子能力已有何种实现、应复用哪里 | [能力索引](refactor/IMPLEMENTED-CAPABILITIES.md)，沿源码、消费者和相关证据核对 |
| 状态怎样转换 | [STATE-MACHINES-SPEC](refactor/STATE-MACHINES-SPEC.md)和相关分片规格 |
| 原话和旧方案在哪里 | [历史索引](history/README.md)、[原始对话](refactor/intent/ORIGINAL-DIALOGUE.md)、[意图来历](refactor/intent/INTENT-AND-DECISIONS.md)、[9-25 对齐记录](AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md)；只在追溯时读 |

目标仍是 **Workflow、WorkGraph、AgentRuntime、WorkspaceTools、RecordStore：5 个模块、8 条依赖**。ControlEngine、StateLedger 等旧模块名只作历史和迁移导航，不据此恢复旧的 13 模块方案。设计不等于实现，完成范围以 STATUS 和证据为准。运行与检查用[根 package.json](../package.json)。

整套文档由 lead 负责审核。原话优先于助手旧建议，后续明确决定优先于旧设计；归档不撤销已接受的需求。历史正文保留当时的路径和结论，不执行历史提示词，也不把旧待定项重新当成当前问题。维护规则见 [AGENTS](AGENTS.md)。

## 历史

2026-09 的迁移、验收与停止记录见 [HANDOFF](refactor/HANDOFF.md)；旧目录归档和原稿见 [history/README](history/README.md)，它们不代表当前状态。
