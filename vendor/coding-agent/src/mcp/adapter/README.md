# MCP Adapter

这是 MCP 协议值到内部能力的预留映射层，当前没有实现。

未来 Adapter 应把远端 Tool 转成普通
`ToolDefinition`，把 Resource/Prompt 转成受来源标记的 Context 值，并把协议错误归一为稳定内部错误。它不能相信远端自报的安全等级，也不能绕过 Registry、Permission、Approval、Sandbox 或 Runtime 事件协议。

MCP SDK 类型应在此层终止，不出现在 Core Port。
