# Shell Tool

`ShellToolHandler` 把 argv、cwd、环境和超时请求交给 `ProcessSandbox`，再将 exit
code、stdout/stderr、截断与取消映射为 `ToolResult`。

该工具的 effect class 为 `process`，要求隔离进程与网络 Sandbox
capability，并通常进入人工审批。命令可能产生无法完全枚举的副作用，因此异常/取消时会保守报告
`possible` effects。bubblewrap 不可用时返回 `sandbox_unavailable`，不降级执行。
