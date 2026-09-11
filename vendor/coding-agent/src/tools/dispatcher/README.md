# Tool Dispatcher

`ToolDispatcher` 实现 `ToolExecutorPort`，并为所有 ToolCall 强制同一执行顺序：

1. 校验 call 与工具参数，解析冻结 Registry。
2. 生成 `ToolOperation`，执行 Permission。
3. 检查所需 Sandbox capability。
4. 对 `ask` 决策进行审批前对账、指纹绑定和审批后 revision 复核。
5. 用派生 AbortSignal 和工具超时调用 handler。
6. 校验 callId、结果 schema、输出大小和 effects。

未知工具、拒绝、取消、超时和执行失败映射为稳定 `ToolResult`。Dispatcher 不读取或推进 RunState。
