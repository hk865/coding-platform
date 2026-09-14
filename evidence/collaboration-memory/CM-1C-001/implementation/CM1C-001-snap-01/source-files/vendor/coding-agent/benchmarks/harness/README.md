# Benchmark Harness

Harness 由几个职责分离的入口组成：

- `cli.mjs`：`preflight` 与 `baseline --mode base|oracle|near-miss|agent` 命令。
- `benchmark-harness.mjs`：任务发现、隔离复制、预算/超时、evaluator 和 artifact 编排。
- `agent-runner.mjs`：通过正式 App Composition 运行真实模型与真实 Sandbox。
- `real-baseline.mjs`：Git/环境门禁和多任务真实基线。
- `provider-smoke.mjs`：通过 Provider Registry 验证短文本与不执行的 ToolCall。

Preflight 要求 base unresolved、oracle 重复 resolved、near-miss unresolved。单 trial 固定输出
`result.json`、`trace.jsonl`、`diff.json` 和 `evaluator.log`，失败分类统一为
`resolved`、`unresolved`、`agent_error`、`timeout`、`environment_error`、 `evaluator_error` 或
`policy_violation`。

Agent workspace 只得到 instruction 与 base 内容；oracle、hidden
evaluator、密钥和其他 trial 始终留在 Harness 边界外。
