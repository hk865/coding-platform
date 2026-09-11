# Benchmark Tasks

每个任务是独立、版本化的评测包：

```text
<task-id>/
├── task.yaml
├── instruction.md
├── workspace/{base,oracle,near-miss}/
└── hidden_tests/evaluate.*
```

当前 canary 覆盖 TypeScript 零值、Python slug、Node
Bearer 鉴权和恢复 exactly-once。base 必须稳定失败，oracle 必须重复通过，near-miss 必须被隐藏测试抓住；变更路径不得超出任务策略。

模型只看到 instruction 与 base 的隔离副本。oracle 和 hidden evaluator 不复制到 Agent
workspace，也不能出现在提示或 trace 中。
