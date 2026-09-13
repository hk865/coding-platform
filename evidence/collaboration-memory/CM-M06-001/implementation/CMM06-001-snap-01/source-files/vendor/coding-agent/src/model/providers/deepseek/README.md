# DeepSeek Provider

`DeepSeekModelClient` 使用 DeepSeek 官方 endpoint 的 OpenAI 兼容 Chat Completions/SSE，实现
`ModelClientPort`。

## 协议映射

- 将 `ModelMessage` 和内部工具 schema 转为 Chat Completions messages/function tools。
- 聚合分片 ToolCall name/arguments，并映射 text、usage、finish reason、错误和取消。
- 将流式 `reasoning_content` 映射为
  `reasoning_delta`，并在 assistant 消息中保存完整内容，使 ToolResult 后的下一轮请求能按 DeepSeek
  thinking 协议回传。
- 模型侧 schema 使用跨 Provider 保守子集，执行前仍由原始 Zod schema 严格验证。

Provider ID 为 `deepseek`，秘密名由 Registry 声明为
`DEEPSEEK_API_KEY`。模型、thinking 和输出预算来自 App 配置；本模块不做重试、fallback、工具执行或权限判断。
