# AgentLifecycle：旧模块迁移入口

2026-09-23。旧 13 模块设计已由[当前架构](../../ARCHITECTURE.md)替代。旧稿曾计划新增本模块，实际源码尚无独立实现。新设计按策略、记录和执行拆分承担，不再新增这一层包装。

本模块的目标职责移交至：[Workflow](../business/workflow.md)、[WorkGraph](../core/work-graph.md)、[AgentRuntime](../core/agent-runtime.md)。逐项复用、重写、删除及退出条件见[迁移表](../ownership-map.md)与[实施方案](../../IMPLEMENTATION-PLAN.md)；数据操作和状态转换分别以[核心设计](../../CORE-DATA-OPERATIONS.md)、[状态机](../../ORCHESTRATION-STATE-MACHINES.md)为准。

[2026-09-23 改版前完整原稿](../../archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md)供历史评审和旧源码定位使用，不再作为本轮目标接口、依赖或模块数量的依据。
