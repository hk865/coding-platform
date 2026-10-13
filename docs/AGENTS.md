# 文档工作入口

更新：2026-10-13。本文件只约束 `docs/` 的阅读和维护，不改变产品或源码架构。仓库根就是施工工程；旧证据里的绝对路径和 scope 按[根 AGENTS](../AGENTS.md)第 2 条映射。

先读 [README](README.md) → [STATUS](refactor/STATUS.md)（当前状态）→ [HANDOFF 顶部](refactor/HANDOFF.md)（决定 1–51）→ [编排设计目录](refactor/design/orchestration-2026-10/README.md)。按任务读对应分片，界面工作读[冻结原型](ui-reference/workbench-2026-10/README.md)和 [UI-WORKBENCH §0](UI-WORKBENCH.md#ui-decisions-2026-10)。

- 整套文档由 lead 长期负责并逐行审阅；Codex 起草后交 lead 核对。每批验收后，lead 更新 STATUS、受影响的能力条目、规格和证据；HANDOFF 的决定和历史保留原义，不为更新进度改写历史。
- 用户后续明确决定优先；助手旧建议不是用户决定，旧实现限制不能覆盖产品目标。按任务共同核对 PRODUCT、MVP-BEHAVIOR、编排设计、架构、对应模块和相关用户原话。发现矛盾列出具体出处，已有决定能解决的按决定同步，新的产品取舍交用户定。
- 施工与审查先核对相关分片规格、[能力索引](refactor/IMPLEMENTED-CAPABILITIES.md)及源码、真实消费者和测试。能力索引用来定位复用，不替代设计或 STATUS；不因单次 Run 接通就宣布完整生命周期或 MVP 完成。
- 当前目标是 5 模块／8 边，依赖以 [module-target.json](refactor/module-target.json) 为准。旧模块导航页只解释旧方案去向，本仓库没有那些旧实现。
- [9-25 对齐记录](AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md)、[编号原话](agent-platform-user-replies-numbered.md)、[意图归纳](refactor/intent/INTENT-AND-DECISIONS.md)和旧实施计划只在追溯来历时读；当前编排依据是 HANDOFF 顶部和设计目录。
- `history/`、`refactor/archive/` 保存历史原稿；`refactor/intent/ORIGINAL-DIALOGUE.md` 及 JSON 保存原话。历史 PRODUCT 和 Prompt 5 调查仍是需求来源和定位线索；归档不撤销已接受需求，也不让旧结论覆盖后续决定。
- 同工作区按实际范围多 Agent 并行仍是产品目标；按决定 49，相关任务先由参谋等定接口约定再并行，派工核对版本，实际冲突由正式检查与返工处理。当前规则读 DESIGN，不把旧并行协议当施工指令。
- 后续产品增量或源码调查写当前文档并链接原稿。移动文档时更新当前引用，历史正文的路径和链接保留当时写法；用归档说明定位。修改日期本身不能证明设计权威或源码完成状态。

## 历史

2026-09 的独立提取、迁移与限定验收见 [HANDOFF 历史记录](refactor/HANDOFF.md)；当时的停止、恢复和目录说明不作为当前指令。
