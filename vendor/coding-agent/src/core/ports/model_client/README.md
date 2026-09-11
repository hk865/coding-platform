# Model Client Port

`model-client-port.ts` 隔离 Runtime 与模型厂商协议，拥有 `ModelRequest`、`ModelMessage`、
`ModelToolSpec`、`ModelEvent`、usage、错误和 `ModelClientPort`。

Provider 以异步流返回 text/reasoning delta、ToolCall、usage 和唯一终止事件。
`validateModelEventSequence()` 检查 requestId、事件顺序、唯一终止、ToolCall 聚合与协议错误；
`model-stream-consumer.ts` 再把合法流归并为一次模型结果。

OpenAI/DeepSeek SDK 类型、鉴权和网络异常只存在于 `src/model`，不能泄漏到此 Port。
