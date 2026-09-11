# Runtime Events

`agent-events.ts` 定义版本化 `AgentEvent` 联合类型和
`EventMeta`。事件覆盖 Run/Turn 生命周期、模型请求、ToolCall 批次、工具结果、usage、暂停、失败、取消和完成。

`validateTransition()` 相对当前 `RunState`
校验 runId、连续 sequence、operationId、派生阶段和终止不可变性。Event 只描述已发生事实，不执行行为；Model 厂商事件先由 Runtime 归一化，再转换成 AgentEvent。
