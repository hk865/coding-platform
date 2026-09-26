# 本轮架构重构入口

> **当前已验收子集：** [next R4c.1 Task原子领取](reviews/next-r4c-claim-2026-09-24.md)，独立副本60文件/**422项PASS**，类型/构建/模块边界通过；保留前序Session、角色、observed图与模型循环连续历史能力。当前施工方式见[DSH-WORKFLOW §3](DSH-WORKFLOW.md)：Astra架构/接口 → DSH骨架与测试 → Astra审核冻结 → DSH实现 → Astra审阅 → 隔离测试。

2026-09-24。按用户确定的顺序推进：数据结构与原子行为 → 编排状态机 → 模块划分 → 实现迁移。当前目标不再沿用固定的 13 模块／38 边前提。

**首次接手先读 [HANDOFF](HANDOFF.md) 与[独立目标工程迁移与验收](reviews/next-clean-migration-2026-09-24.md)。** 它概括用户目的、当前实现、文档层次、最小阅读包和施工顺序。审阅详细设计从[骨架总览](skeleton/README.md)进入；无需先加载全部历史。

文档总体入口见 [docs/README](../README.md)。9 月 22 日之前的文件已按修改时间移入[历史目录](../history/README.md)，PRODUCT 原稿和 Prompt 5 调查只作为历史需求/事实基线；当前产品已校准恢复为[docs/PRODUCT](../PRODUCT.md)。设计/实现须共同核对产品、架构、相关模块及用户原话，不能只按某一页或旧源码决定。

| 阅读目的 | 正文 |
| --- | --- |
| MVP 用户行为、首通与完整产品验收 | [MVP-BEHAVIOR](../MVP-BEHAVIOR.md) |
| 当前原子能力、源码复用入口与未接通项 | [IMPLEMENTED-CAPABILITIES](IMPLEMENTED-CAPABILITIES.md) |
| DSH 骨架/测试 → 主审冻结 → DSH 实现 → 主审及隔离验收 | [DSH-EXECUTION-HARNESS](DSH-EXECUTION-HARNESS.md) |
| 当前产品与用户意图一致性 | [PRODUCT](../PRODUCT.md)、[产品审阅](reviews/product-intent-review.md) |
| 并行协作接口、实际缺口、资源反馈与开发图 | [PARALLEL-COLLABORATION](PARALLEL-COLLABORATION.md) |
| 首批并行实现范围与文件分工（实现已落盘，未作 Git 提交） | [DSH-PARALLEL-IMPLEMENTATION](tasks/DSH-PARALLEL-IMPLEMENTATION.md) |
| R3b 材料功能与迁移欠账 | [功能验收](reviews/R3b-sol-dsh-acceptance.md)、[消费者退出清单](reviews/R3b-material-consumer-inventory.md) |
| next 当前规模与剩余工作 | [最新验收](reviews/next-a1-graph-session-2026-09-25.md)、[完整路径计划](IMPLEMENTATION-PLAN.md)；[原工程历史测量](reviews/code-size-and-complexity-2026-09-24-final.md) |
| R3a / R4a 已通过返修验收与证据 | [最终验收](reviews/R3a-R4a-sol-dsh-acceptance.md)、[原失败快照](reviews/R3a-R4a-independent-acceptance.md) |
| 静态图解：管理数据的结构、原子读写和编排状态机 | [CORE-STRUCTURES-AND-ORCHESTRATION](CORE-STRUCTURES-AND-ORCHESTRATION.md) |
| 用户原话、草图及当前设计决定 | [意图与决定](intent/INTENT-AND-DECISIONS.md)、[原始对话](intent/ORIGINAL-DIALOGUE.md) |
| 关键源码文件、完整主要接口及模块内部逻辑 | [详细骨架](skeleton/README.md)、[共同契约](skeleton/CONTRACTS.md)、[模块索引](modules/README.md) |
| Host装配、真实贯通流程和UI改动 | [END-TO-END](skeleton/END-TO-END.md) |
| 对象、结构、工具输入输出、约束与更新 | [CORE-DATA-OPERATIONS](CORE-DATA-OPERATIONS.md) |
| 合法转移、业务选择、执行、副作用与恢复 | [ORCHESTRATION-STATE-MACHINES](ORCHESTRATION-STATE-MACHINES.md) |
| 总体责任与目标模块 | [ARCHITECTURE](ARCHITECTURE.md) |
| 模块公开能力和旧代码归属 | [模块索引](modules/README.md) |
| 允许依赖及反向依赖禁区 | [module-dag](module-dag.md) |
| 分批迁移、兼容退出、实际进度与证据 | [IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) |
| 代码质量与验收口径 | [CODE-QUALITY-GUIDELINES](CODE-QUALITY-GUIDELINES.md) |
| 本次骨架交付检查与仍待实现的前提 | [交接核对](reviews/skeleton-handoff-review.md) |
| 之前方案与调查证据 | [迁移前快照](archive/2026-09-23-before-core-design/README.md)、[模块必要性审阅](reviews/module-necessity-review.md) |

目标设计与当前实现分开记录。`coding-platform/next` 已真实建立，后续 R2–R6 默认在该独立工程实施；原 `coding-platform/src` 只读，用于行为对照和实现参考。五个目标目录均已存在：Workspace、Goal、material、body 与 Store 实现已迁入；Workflow及AgentRuntime执行入口仍unsupported；AgentRuntime已迁入工具循环/来源组件并接通Session创建/历史，完整目标契约尚未全部转为运行实现，UI 未迁。前序R3c材料reader/index已完成迁入；本批初始Plan子集通过，但整个R3c尚未关闭。 运行入口为 [next/package.json](../../package.json)。旧业务消费者在新 Workflow/UI 切换前继续使用旧产品，旧目录待最终切换后删除；新工程无需接回旧系统。

以下为原工程历史验收，保留其当时结果，不作为 next 平台完成证明：R3a Goal Store/WG真实链与R4a Kernel公开扩展已完成 Sol / dsh 返修并通过[独立验收](reviews/R3a-R4a-sol-dsh-acceptance.md)；R2e.1已通过[独立验收](reviews/R2e-1-sol-dsh-acceptance.md)；R3b材料功能及Host/真实Run接线已通过[验收](reviews/R3b-sol-dsh-acceptance.md)，两条legacy reader临时依赖尚待收口。Kernel扩展存在不代表平台连续Session或范围并行已交付，原生compact当前仍不支持。完整知识库／长期专家、全部UI联动和所有模块迁移尚未完成。
