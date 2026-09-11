# Tool System

Tool 系统把模型生成的 `ToolCall` 转成受控副作用，并实现 Core 的 `ToolExecutorPort`。

```text
ToolCall → ToolDispatcher
           ├── Registry + argument schema
           ├── PermissionPolicy
           ├── ApprovalCoordinator（按需）
           ├── Sandbox capability
           └── ToolHandler → ToolResult + effects
```

`schemas/` 定义插件元数据，`registry/` 冻结工具集合并导出模型规格，`dispatcher/`
强制统一安全链，`builtin/` 提供
`read/check/edit/shell`。任何工具都不应暴露绕过 Dispatcher 的生产执行入口。
