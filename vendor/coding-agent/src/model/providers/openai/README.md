# OpenAI Provider

`OpenAIModelClient` 使用官方 SDK 的 Responses API 实现 `ModelClientPort`。

它把 `ModelRequest` 映射为 Responses input、function tool schema 和输出上限，并把流式文本、function
call 参数、usage、completed、truncated、error 与 cancelled 归一为
`ModelEvent`。AbortSignal 直接传到网络边界，厂商异常经共享支持模块转成稳定错误。

Provider ID 为 `openai`，秘密名由 Registry 声明为
`OPENAI_API_KEY`。本模块不决定 Runtime 重试、工具权限或 Run 终态，也不会把 SDK 类型暴露给 Core。
