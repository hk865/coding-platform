# 文档工作入口

> 独立仓库说明（2026-09-27）：本仓库根即原 `coding-platform/next`，文档位于 `docs/`；当前继续入口见根 `CONTINUE.md` 与 `AGENTS.md`。旧证据、任务书中的绝对路径和 scope 只描述当时工作区，不能直接执行。用户已从独立 main 恢复；有界审计与本轮真实模型验收收口记录见 refactor/HANDOFF.md，真实模型限定验收后已按用户要求停止，尚未宣告整个 MVP 完成。

2026-09-24：后续施工位置为 `coding-platform/next` 独立目标工程；同时读[用户纠偏](refactor/intent/2026-09-24-TARGET-PROJECT.md)与[迁移验收](refactor/reviews/next-completed-migration-2026-09-24.md)。原工程验收与新工程能力分别记录，不能把旧接口残留继续解释为目标依赖。

先读 [README](README.md)，当前重构接手读 [refactor/HANDOFF](refactor/HANDOFF.md)。本文件只约束此 `docs/` 的阅读和维护，不改变产品或源码架构。

- 设计、实现和审阅必须共同核对 `PRODUCT.md`、`refactor/ARCHITECTURE.md`、`refactor/modules/` 对应模块、`refactor/intent/ORIGINAL-DIALOGUE.md` 的相关用户发言，并查看 `refactor/intent/2026-09-23-PARALLEL-AND-PRODUCT.md` 与 `refactor/intent/2026-09-24-DSH-HARNESS.md` 的最新补充。后续明确纠正优先；助手旧建议不是用户决定，旧实现限制不能覆盖产品目标。发现矛盾先给出具体出处，已有授权能解决的直接同步，新的产品取舍再问用户。
- 当前采用的意图：`refactor/intent/INTENT-AND-DECISIONS.md`；目标架构、模块和依赖：`refactor/ARCHITECTURE.md`、`refactor/modules/README.md`、`refactor/module-dag.md`、`refactor/module-target.json`。
- 实施前读 `refactor/IMPLEMENTED-CAPABILITIES.md` 的总览与相关能力，再沿源码、真实消费者和测试核对复用。该页是当前能力索引，不替代目标设计；每批主审验收后更新受影响条目，骨架审核时检查是否重复已有实现。
- 双图、Agent、生命周期与编排的跨模块工作同时核对 `AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md`、`agent-platform-user-replies-numbered.md` 及 `refactor/IMPLEMENTATION-PLAN.md` 的完整路径表。对齐稿原始“待源码对账”不等于源码缺失结论；生产者、消费者、状态/索引更新与用户路径分别验收，不能只因单次 Run 接通便宣布完整生命周期完成。
- 当前目标是 5 模块／8 边。旧模块名的导航页用于迁移，不是另一套目标。源码现状必须查实际代码与逐批验收，不能由文档目录存在推断完成。
- `history/`、`refactor/archive/` 保存历史原稿；`intent/ORIGINAL-DIALOGUE.md` 与 JSON 保存原话；标注“历史评审”的报告只解释当时版本。默认查当前设计时不把这些材料混入目标依据，需要追溯具体问题时再读取。
- `PRODUCT.md` 已经按用户意图重新整理为当前产品入口；原稿仍完整保留在历史，不是直接搬回旧正文。同工作区按实际范围多 Agent 并行是必须支持的目标，数据工具检查、Agent决策/修正，不以全工作区单writer或独立worktree强制限制。详细契约见 `refactor/PARALLEL-COLLABORATION.md`。
- 历史 PRODUCT 和 Prompt 5 `source-analysis.md` 已移到 `history/before-2026-09-22/`。它们仍是需求来源和调查线索；归档不撤销已接受需求，也不让旧结论自动覆盖当前决定。
- 后续产品增量或源码调查写当前文档，并链接原稿；不为更新进度重写历史。移动文档时同步当前入口和相关引用，保留可核对的原路径与摘要。
- 修改日期是本次用户要求的归档依据，不是判断设计权威或源码状态的充分依据。保留原始对话和归档正文的当时路径；定位迁移后的历史文件使用归档清单。
