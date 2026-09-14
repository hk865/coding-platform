# Context Builder

`context-builder.ts` 提供 `buildModelRequest()` 与
`DeterministicContextBuilder`，把已选择的上下文值确定性组装为 `ModelRequest`。

Builder 会校验 ID 唯一性、transcript 中 ToolCall/ToolResult 关联和输入 schema；系统提示按固定分区加入 fragment、Skill 与 Memory，工具规格按名称排序，历史消息保持语义顺序。

它不估算预算、不主动查询 Skill/Memory，也不调用模型。调用方应先通过 `ContextSelectionPolicy`
完成裁剪，再将结果交给 Builder。
