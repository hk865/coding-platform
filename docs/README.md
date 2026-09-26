# 文档入口

> 独立仓库说明（2026-09-27）：本仓库根即原 `coding-platform/next`，文档位于 `docs/`；当前继续入口见根 `CONTINUE.md` 与 `AGENTS.md`。旧证据、任务书中的绝对路径和 scope 只描述当时工作区，不能直接执行。用户已要求冻结保存，尚未宣告整个 MVP 完成。

更新：2026-09-25。当前重构先读 [HANDOFF](refactor/HANDOFF.md) 和[A1 最新验收](refactor/reviews/next-a1-graph-session-2026-09-25.md)，再按任务读取有关设计和接口。[独立目标工程迁移与验收](refactor/reviews/next-completed-migration-2026-09-24.md)保留迁移基线。

`coding-platform/next` 已建立，后续 R2–R6 默认在此实施；原 `coding-platform/src` 只读参考。五个目标目录存在，Workspace/Goal/material/body/Store 已迁入；AgentRuntime 已补迁工具循环和来源绑定，正式 Workflow/Runtime 入口仍 unsupported，完整目标契约和 UI 尚未交付，reader/index 子项已通过独立验收。运行入口为 [next/package.json](../package.json)。旧产品验收是历史证据；旧消费者待新 Workflow/UI 切换后退出，旧目录在最终切换后删除，不要求新核心接回旧系统。

| 要回答的问题 | 当前入口 |
| --- | --- |
| 工作台如何组织项目、Agent、双图、文件与终端 | [工作台 UI 设计](UI-WORKBENCH.md)：布局、角色卡片、交互与视觉规范 |
| MVP 从目标到结果如何运行、怎样验收 | [MVP 产品行为与端到端验收](MVP-BEHAVIOR.md)：首通与产品 MVP、行为契约、异常与证据 |
| 当前产品承诺是什么 | [PRODUCT](PRODUCT.md)、[本次意图审阅](refactor/reviews/product-intent-review.md) |
| 并行协作有哪些接口、缺口及图示 | [并行协作审阅与结构图](refactor/PARALLEL-COLLABORATION.md) |
| 用户要求与已采用的决定是什么 | [意图与决定](refactor/intent/INTENT-AND-DECISIONS.md) |
| 如何防止只做单次执行而遗漏 Agent 工作路径 | [双图/生命周期对齐记录](AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md)、[编号原话](agent-platform-user-replies-numbered.md)、[完整实施映射](refactor/IMPLEMENTATION-PLAN.md) |
| 目标架构、模块及依赖是什么 | [ARCHITECTURE](refactor/ARCHITECTURE.md)、[模块索引](refactor/modules/README.md)、[DAG](refactor/module-dag.md)、[机器可读目标](refactor/module-target.json) |
| 当前原子能力已有何种实现、DSH 应复用哪里 | [已实现能力索引](refactor/IMPLEMENTED-CAPABILITIES.md)：源码入口、装配状态、调用前提与测试 |
| 数据结构、原子操作、状态机与接口怎样实现 | [结构与编排图解](refactor/CORE-STRUCTURES-AND-ORCHESTRATION.md)、[详细骨架](refactor/skeleton/README.md)、[共同契约](refactor/skeleton/CONTRACTS.md) |
| 源码实际完成到哪里 | [新工程最新结果](refactor/reviews/next-a1-graph-session-2026-09-25.md)、[交接状态](refactor/HANDOFF.md#4-当前完成状态)；[原工程逐批证据](refactor/reviews/implementation-batches.md)只覆盖其历史版本 |
| 接下来如何实施 | [批次计划](refactor/refactor-plan.md)、[当前提示词](refactor-prompts.revised.md)、[dsh 分工](refactor/DSH-WORKFLOW.md) |
| 旧方案、产品原稿和调查记录在哪里 | [历史索引](history/README.md) |

当前目标为 **Workflow、WorkGraph、AgentRuntime、WorkspaceTools、RecordStore：5 个模块、8 条依赖**。ControlEngine、StateLedger、AgentLifecycle 等名称仍出现在旧源码、历史或迁移导航中，不能据此恢复旧的 13 模块方案。目标设计也不代表所有模块已在源码中实现。

本次按文件系统修改时间，将 `docs/` 内严格早于 **2026-09-22 00:00:00（Asia/Shanghai）** 的当前区文档移到历史，9 月 22 日当天的文件保留。已在 `refactor/archive/` 的快照原位保留。修改日期仅用于这次归档；内容属于目标、现状还是历史，以本页入口和文档声明为准。

历史 PRODUCT、人类回复和 Prompt 5 调查保持原文，移档不撤销已经接受的需求。当前采用的意图以意图页和用户后续指令为准，旧调查仅作定位线索。不要执行历史提示词、覆盖历史原稿，或把历史审阅中的待定项重新当成当前未决问题。设计、实现或审阅时须共同核对[当前PRODUCT](PRODUCT.md)、架构、相关模块及[原始对话](refactor/intent/ORIGINAL-DIALOGUE.md)中的相关用户发言；结合[最新补充原话](refactor/intent/2026-09-23-PARALLEL-AND-PRODUCT.md)，不需要每轮全量重读，但不能只按旧实现反推产品。恢复的PRODUCT是校准后新稿，历史原稿未移动或改写。
