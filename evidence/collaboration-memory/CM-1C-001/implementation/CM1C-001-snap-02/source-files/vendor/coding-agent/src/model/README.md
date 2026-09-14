# Model

`model` 把厂商网络协议适配为 Core 的
`ModelClientPort`。鉴权、SDK 类型、请求字段和厂商错误在此层终止，Runtime 只看到 `ModelRequest` 与
`ModelEvent`。

## 结构

- `providers/openai/`：OpenAI Responses API。
- `providers/deepseek/`：DeepSeek Chat Completions/SSE。
- `providers/registry/`：静态 Provider 描述符、秘密声明与 factory。
- `providers/provider-support.ts`：共享错误与流式映射辅助。

Provider 由 Composition 显式选择，不做自动路由或 fallback。确定性测试使用 fixture/contract；真实网络只用于受控 smoke 和 Benchmark。
