# MCP

`src/mcp` 是未来 Model Context
Protocol 接入的隔离层，当前只有架构边界，没有运行时代码，也不会连接 Server。

预期依赖方向为：

```text
App Composition → MCP Connection → MCP Client → MCP Adapter
                                             ├── internal ToolDefinition
                                             └── Context data
```

MCP
SDK 类型不得进入 Core。远端 Tool 必须经过现有 ToolRegistry、Permission、Approval 与 Sandbox；Resource/Prompt 只能映射为带来源的 Context。凭据、能力发现、断线、重连和未知副作用需要在实现前由 ADR 冻结。
