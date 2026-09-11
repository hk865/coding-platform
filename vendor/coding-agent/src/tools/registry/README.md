# Tool Registry

`ToolRegistry` 注册并校验 `ToolDefinition`，拒绝重复名称；`freeze(enabledNames)` 生成不可变
`ToolRegistrySnapshot`，之后不允许继续注册。

Snapshot 按名称导出 Provider 可用的 `ModelToolSpec`，并把 Zod JSON
schema 归一为跨 Provider 保守子集；运行时参数仍使用原始 Zod schema。

`RegistryToolBatchPolicy` 仅在整个批次都是 `independentReadOnly`
时并行，否则按模型顺序串行。Registry 不执行工具或做权限判断。
