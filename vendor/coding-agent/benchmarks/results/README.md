# Benchmark Results

`results/` 是 Harness 的 artifact 根，单次运行默认不提交：

```text
<run-id>/
├── summary.json
└── <task-id>-trial-<n>/
    ├── result.json
    ├── trace.jsonl
    ├── diff.json
    └── evaluator.log
```

`result.json` 保存任务 digest、Agent commit、Provider/model/options、预算、环境、结果类别、资源
用量和 artifact 引用；`summary.json` 聚合各类别计数与 `resolvedAt1`。

Artifact 必须通过 `benchmarks/schemas` 校验。CI replay artifact 证明 Harness 可重复，不应与真实
模型能力成绩混用；正文、reasoning、密钥和完整敏感工具参数不进入摘要。
