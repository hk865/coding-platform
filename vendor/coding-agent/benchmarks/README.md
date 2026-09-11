# Benchmarks

Benchmark 子系统在隔离 workspace 中执行版本化 coding
task，并用 Agent 不可见的 evaluator 生成结构化成绩。它可以调用产品 Composition，但生产 App/Core 不依赖 Benchmark。

```text
Task Package → Harness → isolated workspace → Agent/Replay
                                      │
                               hidden evaluator
                                      │
                       result + trace + diff + logs
```

- `tasks/`：task metadata、用户 instruction、base/oracle/near-miss 和 hidden evaluator。
- `harness/`：preflight、单 trial 执行、真实 Agent/Replay 与汇总。
- `schemas/`：任务、trial、run summary 和 Provider smoke 的 strict schema。
- `results/`：默认不提交的运行产物格式。

```bash
npm run benchmark:validate
npm run benchmark:baseline:replay
npm run benchmark:baseline:real -- --provider <openai|deepseek> --model <model-id>
```

Replay 只验证 Harness/evaluator。真实模型基线必须绑定干净且可追溯的 Git
commit、固定 Provider/model/预算和可用的 bubblewrap 环境。
