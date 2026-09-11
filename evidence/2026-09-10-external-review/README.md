# 2026-09-10 外部独立审查证据

本目录由未参与实现的审查 Agent 生成，**只读核对产品源码，未修改任何产品源码**。

| 文件 | 内容 | 复现命令 |
| --- | --- | --- |
| `independent-checks.mjs` / `independent-checks.json` | 独立重算：candidate-04 逐文件身份与摘要、18 份日志摘要、87 项变化集、三处 DAG 一致性、全仓/浏览器统计 | `node evidence/2026-09-10-external-review/independent-checks.mjs` |
| `lease-refusal.test.ts` / `vitest-lease.config.mjs` / `lease-refusal.log` | 用产品自身 `LeasedWorkerRuntime` 证明：读租约被拒时抛错且不调用 `rejectBeforeStart`（对照用例证明该机制本身可达） | `node .local/linux-test-tools/node_modules/vitest/vitest.mjs run --config evidence/2026-09-10-external-review/vitest-lease.config.mjs` |

审查报告正文在文档根 `dev_docs/verification/2026-09-10-external-review/report.md`。
本目录不替代既有 evidence/2026-09-09-independent-review/ 的验收证据，也不改写任何历史日志。
