# Model Providers

每个 Provider 实现同一个 `ModelClientPort`，负责：

1. 把模型无关的消息和工具规格映射为厂商请求。
2. 把流式文本、reasoning、ToolCall、usage 和终止状态映射为 `ModelEvent`。
3. 传递 AbortSignal，并将网络/协议错误归一为稳定错误。

`registry/` 静态注册 `openai` 与
`deepseek`。Provider 不能执行 ToolCall、决定 Permission、推进 RunState 或注入厂商 hosted
tools；生产工具集合由 App 的 ToolRegistry 冻结。
