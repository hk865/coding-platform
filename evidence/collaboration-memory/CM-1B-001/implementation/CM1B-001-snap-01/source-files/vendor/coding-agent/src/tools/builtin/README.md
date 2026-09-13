# Built-in Tools

内置工具由 Composition 创建并注册为 `ToolDefinition`：

| 工具    | effect class      | 底层能力             |
| ------- | ----------------- | -------------------- |
| `read`  | `read_only`       | `WorkspaceSandbox`   |
| `check` | `read_only`       | workspace 一致性基线 |
| `edit`  | `workspace_write` | `WorkspaceSandbox`   |
| `shell` | `process`         | `ProcessSandbox`     |

每个定义包含 Zod 输入、操作摘要、所需 Sandbox
capability、超时、输出上限和 handler。调用始终由 Dispatcher 统一校验与授权。
