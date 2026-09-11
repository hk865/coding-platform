# Permission

`DefaultPermissionPolicy` 对 `ToolOperation` 做路径/cwd 规范化和策略计算，返回带摘要的
`allow`、`deny` 或 `ask`。

读取类操作可按配置直接允许；workspace 写入和进程操作通常要求审批；绝对路径、逃逸、受保护路径和不合法资源直接拒绝。`normalizeWorkspacePath()`
提供统一的相对路径语义。

Policy 不信任模型自行保证安全，也不访问 RunState 或执行工具。需要人工确认的决策交给
`ApprovalCoordinator`，真正隔离由 Sandbox 强制。
