# Tool Executor Port

`tool-executor-port.ts` 拥有模型无关的 `ToolCall`、`ToolResult`、结构化 output、effects、错误分类和
`ToolExecutorPort`。

结果分为
`success`、`error`、`cancelled`，并始终绑定原 callId。Effects 明确区分无副作用、已确认副作用和可能已发生但结果未知的副作用；恢复逻辑据此决定是否允许继续。
`assertToolResultMatchesCall()` 防止错误关联。

Registry、Permission、Approval、Sandbox 和具体 handler 都属于 `src/tools` 及其依赖，不进入本 Port。
