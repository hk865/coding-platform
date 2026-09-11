# Runtime State

`run-state.ts` 定义
`Run`、`Turn`、`RunState`、transcript、ToolBatch、usage、状态与终态结构，并为所有值提供 strict
schema。

`createInitialRunState()` 生成空运行快照，`deriveRunPhase()` 根据事实派生当前阶段，
`validateRunStateInvariants()` 检查 sequence、活动 Turn、未结算 ToolCall、终态与 outcome 的组合。

State 是可序列化快照，不包含 AbortSignal、Provider
SDK、数据库连接或执行逻辑。状态变化只能通过 Reducer 应用 AgentEvent。
