# Tool Schemas

`tool-schemas.ts` 定义外层工具插件契约：`ToolDefinition`、`ToolHandler`、effect class、所需Sandbox
capability、操作摘要、超时、输出上限和独立只读标志。

`validateToolDefinition()` 校验名称和元数据，并禁止非 read-only 工具声明并行安全。Core 的 `ToolCall`
/ `ToolResult` 仍由 `ToolExecutorPort` 拥有；本模块不负责注册、调度、审批或具体工具逻辑。
