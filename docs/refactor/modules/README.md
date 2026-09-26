# 目标模块与迁移入口

2026-09-24 实施位置：下表 `src/...` 均相对独立目标工程 `coding-platform/next`。详细模块文档描述完整目标，不代表本批已实现全部 Port；当前实际支持范围、复用符号与证据见[已实现能力索引](../IMPLEMENTED-CAPABILITIES.md)，最新验收见[HANDOFF](../HANDOFF.md)；[干净迁移记录](../reviews/next-clean-migration-2026-09-24.md)仅保留对应历史范围。旧 `coding-platform/src` 保留作参考，后续不默认向旧装配增加包装。

2026-09-23。当前目标由数据结构、原子操作与状态机推导，取代之前固定13模块的方案。目标不是实际源码已完成声明。

| 目标Module | 文档 | 目标代码目录 | 提供能力 |
| --- | --- | --- | --- |
| Workflow | [业务流程](business/workflow.md) | `src/business/workflow/` | 目标／计划／Session选择／检查和返工策略 |
| WorkGraph | [工作结构](core/work-graph.md) | `src/core/work-graph/` | 专用工作结构、原子状态操作、图与历史引用查询 |
| AgentRuntime | [执行适配](core/agent-runtime.md) | `src/core/agent-runtime/` | Kernel执行／控制／观察、会话历史桥接 |
| WorkspaceTools | [工作区工具](core/workspace.md) | `src/core/workspace/` | 文件／Git／AST／符号／来源一致性 |
| RecordStore | [持久适配](core/record-store.md) | `src/core/record-store/` | 条件事务、正文、事件和索引持久化 |

本目录五篇目标模块页已展开为文件级骨架：自身目的与不变量、目标文件树、逐文件职责/导出/读写、完整主要Port、内部算法与事务、失败恢复、旧实现迁移、消费者接线和验收。每篇直接重述自身必须遵守的关键语义，避免只写“见前文”。Module不等于每个类、数据结构或工具。

[核心数据文档](../CORE-DATA-OPERATIONS.md)统一对象语义，[状态机](../ORCHESTRATION-STATE-MACHINES.md)统一转移，[共同契约](../skeleton/CONTRACTS.md)统一跨模块身份/结果；模块页定义具体请求与实现归属。首次接手看[HANDOFF](../HANDOFF.md)，跨模块施工看[贯通流程](../skeleton/END-TO-END.md)。代码块均为目标设计，不表示文件已经创建或通过类型检查。

产品与意图防漂移：修改模块时同时查看[当前PRODUCT](../../PRODUCT.md)、[架构](../ARCHITECTURE.md)、[原始对话](../intent/ORIGINAL-DIALOGUE.md)的相关发言及当前决定。并行能力按[并行接口与图](../PARALLEL-COLLABORATION.md)实现；模块划分和锁范围不是同一件事。

## 旧模块去向

| 旧名 | 迁移目的地 |
| --- | --- |
| HumanCollaboration | Workflow |
| PlanCompiler | Workflow规划流程；WorkGraph候选与采用操作 |
| ControlEngine | WorkGraph规则与正式变更 |
| DispatchEngine | AgentRuntime执行机制；Workflow选择策略 |
| VerificationEngine | Workflow检查流程；WorkGraph证据与汇合；AgentRuntime实际审阅执行 |
| ArchitectureReconciler | WorkGraph图比较与候选操作 |
| AgentLifecycle（旧稿新增、未实现） | Workflow策略；WorkGraph目录与状态；AgentRuntime实际处置 |
| WorkerRuntime | AgentRuntime |
| StateLedger | RecordStore事务；WorkGraph领域判据 |
| ArtifactVault | RecordStore正文；WorkGraph适用性 |
| ReadModelIndex | WorkGraph领域索引；RecordStore持久适配 |
| ContextCompiler | Workflow选材需求；WorkGraph精确读取／整理；AgentRuntime格式适配 |
| WorkspaceReader | WorkspaceTools |

共同实现、旧消费者与删除条件见[承载与迁移表](ownership-map.md)。旧目录下的13篇同名文档改为迁移导航，原全文保存在[快照](../archive/2026-09-23-before-core-design/modules/README.md)，不再作为第二套当前目标。

规范沿用[质量要求](../CODE-QUALITY-GUIDELINES.md)。状态与实测证据见[实施方案](../IMPLEMENTATION-PLAN.md)。源码owner逐批更新，不把文档5模块冒充源码已迁移。
