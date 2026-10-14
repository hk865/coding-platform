# 架构与编排文档入口

更新：2026-10-13。先读 [STATUS](STATUS.md)（当前状态、缺口、下一步）和 [HANDOFF 顶部](HANDOFF.md)（决定 1–58），再读[编排设计目录](design/orchestration-2026-10/README.md)。可靠性批次已完成；编排第 0、1、3、5 片、接线包 1、接线包 2（bb924854）和 K 片 A/B 已合入；2A 已冻结、正在施工；整个 MVP 没有完成（当前状态以 [STATUS](STATUS.md) 为准）。

施工按决定 36、43、44、46 和 2026-10-13 的做法：lead 写规格、规则、冻结与验收，负责全部文档；Codex 写夹具、只读审查和推送；DSH 在用户确认的测试入口逐条按 TDD 写用例和实现。详见[根 AGENTS](../../AGENTS.md)第 5 条和[分片入口](design/orchestration-2026-10/slices/README.md)。

| 阅读目的 | 正文 |
| --- | --- |
| 当前状态、验收边界、下一步 | [STATUS](STATUS.md) |
| 用户决定与批次历史 | [HANDOFF](HANDOFF.md) |
| 编排、记忆、生命周期与分片依赖 | [DESIGN](design/orchestration-2026-10/DESIGN.md)、[读法模型](design/orchestration-2026-10/model/README.md)、[记忆查找](design/orchestration-2026-10/MEMORY-LOOKUP.md) |
| 施工规格与任务书 | [slices](design/orchestration-2026-10/slices/README.md)、[DSH-WORKFLOW §1、§6](DSH-WORKFLOW.md) |
| 界面基线与 E3 待办 | [冻结原型](../ui-reference/workbench-2026-10/README.md)、[UI-WORKBENCH §0](../UI-WORKBENCH.md#ui-decisions-2026-10)、[E3-UI-ITEMS](design/orchestration-2026-10/E3-UI-ITEMS.md) |
| 产品承诺和 MVP 行为 | [PRODUCT](../PRODUCT.md)、[MVP-BEHAVIOR](../MVP-BEHAVIOR.md)；后续决定见 HANDOFF 顶部 |
| 已有能力及源码复用入口 | [IMPLEMENTED-CAPABILITIES](IMPLEMENTED-CAPABILITIES.md) |
| 状态转换规则 | [STATE-MACHINES-SPEC](STATE-MACHINES-SPEC.md)和各片规格 |
| 模块责任与依赖 | [ARCHITECTURE](ARCHITECTURE.md)、[modules](modules/README.md)、[module-dag](module-dag.md)、[module-target.json](module-target.json) |
| 数据与接口参考 | [CORE-DATA-OPERATIONS](CORE-DATA-OPERATIONS.md)、[共同契约](skeleton/CONTRACTS.md)；实现范围沿源码核对 |
| 代码质量 | [CODE-QUALITY-GUIDELINES](CODE-QUALITY-GUIDELINES.md) |
| 用户原话与旧方案来历 | [原始对话](intent/ORIGINAL-DIALOGUE.md)、[意图归纳](intent/INTENT-AND-DECISIONS.md)、[历史索引](../history/README.md) |

目标设计与当前实现分别记录。仓库根是独立工程，运行与检查用[根 package.json](../../package.json)，不再按旧 R2–R6 迁移安排施工。文档总入口和维护规则见 [docs/README](../README.md)及 [docs/AGENTS](../AGENTS.md)。

## 历史

旧 R 批次、迁移、DSH harness 和限定验收的经过见 [HANDOFF 历史记录](HANDOFF.md)；旧任务书见 [tasks/README](tasks/README.md)，不作为当前派发指令。
