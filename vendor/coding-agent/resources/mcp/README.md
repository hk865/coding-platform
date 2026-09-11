# MCP Resources

这是未来 MCP
Server 配置、能力描述和协议 fixture 的预留资源目录。当前应用不从这里加载任何内容，也不连接 MCP
Server。

启用这条路径时，资源应先经过独立 schema 和凭据过滤，再交给 `src/mcp`
的连接与适配层；远端 Tool 仍须注册为内部 `ToolDefinition`，经过 Permission、Approval 和 Sandbox。MCP
Resource/Prompt 只能映射为受来源标记的 Context 数据，不能把远端元数据当作安全声明。
