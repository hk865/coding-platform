# Benchmark Schemas

`benchmark-schema.mjs` 是任务与结果 artifact 的运行时边界：

- `benchmarkTaskSchema`：版本、语言、领域、base revision、环境、预算、网络和 evaluator。
- `benchmarkTrialResultSchema`：结果分类、Agent/model 元数据、资源用量和 artifact 引用。
- `benchmarkRunSummarySchema`：分类计数与 `resolvedAt1`。
- `provider-smoke-schema.mjs`：脱敏 Provider 文本/ToolCall smoke 证据。

`task.yaml` 使用 JSON-compatible YAML；schema 拒绝绝对路径、`..`
逃逸、未知字段和不一致的结果计数。Harness 在读写边界都调用这些 schema，而不是信任磁盘 JSON。
