## 完成：R3c material readers 三处窄修复

**唯一写入文件**：`coding-platform/next/src/core/work-graph/materials/record-readers.ts`（12:56；其余 12:52/12:54 的 4 个文件是 Lead 提供的 Store provider/测试，未改）。无 git 操作、无依赖安装、无 tests/config/contracts/接口改动。

### 修复内容
1. **keyset 游标推进（UTF-8/SQLite BINARY）**：复用 Store 共享判据 `compareRefKeys`（`record-store/lookup-index.ts`），在读取下一页之前检查 `after === undefined || compareRefKeys(next, after) > 0`；重复或下降游标一律 `unavailable`，并保留同次调用内的 `seenCursors` 重复保护。回归测试要求的“第二页返回下降游标即在第三页前失败”成立：`lookups === 2`。
2. **`isActorRef` 补全 Agent 契约**：`kind:'agent'` 现要求 `.runRef` 为完整 `RunRef`（`aggregateType:'Run'` + projectId/goalId/runId）；`human`/`system` 仅要求 kind+id（语义不变）。持久化撤权中缺 `runRef` 的 agent actor 会在编码/提交边界被拒（`code:'invalid'`），已由两条新回归验证。
3. **注释边界如实化**：删除“No Ledger/ReadModel implementation can be injected”这一不可静态保证的断言。文件头与 factory 注释改为：唯一注入依赖是 RecordStore record port、不查全局/不动态 import 其它 provider；参数是结构类型，本文件无法静态阻止调用者传别的对象——实际边界是生产装配只传目标 `backend.records`（readMany/lookup），实现也只调用它。

### 实测命令与结果（全部通过）
| 命令 | 结果 |
|---|---|
| `python3 tools/dsh-refactor/check.py next-material-readers` | **11 passed / 11**（exit 0）：原 8 条真实 provider 场景（4 场景 × memory/sqlite）+ 下降游标 1 条 + Agent 撤权 actor 注册 2 条 |
| `python3 tools/dsh-refactor/check.py next-types` | **exit 0**，无错误 |
| `python3 tools/dsh-refactor/check.py next-architecture` | **next source boundaries: OK**；观测边 `WorkGraph -> RecordStore`、`WorkGraph -> WorkspaceTools`、`Workflow -> WorkGraph`，均在允许集内 |

### 限制
无遗留未闭合项。仅为一条准确性说明：factory 参数是结构类型，静态上无法阻止任意对象注入；这正是注释现在如实描述的内容，生产装配只传目标 `backend.records`。