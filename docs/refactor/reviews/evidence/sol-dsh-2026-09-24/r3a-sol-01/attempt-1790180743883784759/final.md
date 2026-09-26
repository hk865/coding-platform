R3a 原 Session 第二轮完成，报告已更新到 `/tmp/dsh-output/implementation.md`。

## 本轮修改（累计仍在 4 个授权文件内）

**raw batch 输入隔离** — `src/core/work-graph/persistence/legacy-adapter.ts`：
- `ownBatch` 改为 `structuredClone` 成功才返回克隆并继续；失败返回 `null`，`commitLegacyGoalCreate` 在**首个 await、任何 lookup/read/写之前**直接返回既有 `invalid_commit`（L109–126）。
- 未用 JSON stringify/深拷贝替身，未新增字段校验，未改正常 raw batch 的验证→幂等→编译→单一 Store 事务顺序，也未改错误码映射；旧库重放路径不变。

**注释修正** — `src/core/work-graph/tasks/task-service.ts` L86–102：不再声称 `structuredClone` 会因循环引用失败，明确 cycles 可克隆、拒绝原因是函数等不可结构化克隆值，并注明该步骤不引入新的 JSON 校验规则。

## 检查结果（Node24、单 worker、无共享 cache）

| 检查 | 结果 |
| --- | --- |
| `r3a`（24 项，含新增 raw batch 用例） | **24/24，exit 0** |
| `r3a-regression` | **108/108（9 文件），exit 0** |
| `platform-types` | **exit 0** |
| `platform-architecture` | **exit 0**，`issues: []` |

上一轮的 3 项回归失败全部消除（Sol 的夹具更新 + `EVIDENCE_OUTPUT_DIR` 私有输出生效）。lane 快照差异**恰好等于 4 个授权文件**；RAT-03 原库 SHA-256 不变；独立测试哈希已记录在报告 §6。

未改测试/配置/机械 helper，未 build，未跑付费模型。以上均为本 lane 自检，**独立验收由主 Agent 负责**。