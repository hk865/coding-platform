# Tool Batch Policy Port

`ToolBatchPolicy` 把模型一次返回的 ToolCall 划分为有序执行组。`SerialToolBatchPolicy`
是 Core 默认值，每个调用独立串行。

外层 `RegistryToolBatchPolicy` 只有在所有工具都声明为可信、独立的 read-only 工具时，才会返回
`parallel_read_only`
组；任何写操作、进程操作或未知工具都会保持串行。Policy 只规划 callId，不执行工具。
