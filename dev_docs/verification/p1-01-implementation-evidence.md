# P1-01 Implementation evidence

```yaml
ticket: P1-01 (Goal persisted and visible — SQLite persistence slice)
date: 2026-09-05
status: implementation verified — acceptance evidence for P1-01 only
scope: 有限授权：仅 P1-01；不代表 P0/P1 已验收通过，不自动推进 P1-02
product_root: /home/han001/projects/agents/agent_platform
handoff: <product root> IMPLEMENTATION-HANDOFF.md
ticket: ../../planning/proposed/P1-foundation/tickets/01-goal-persisted-and-visible.md
```

## 结论

P1-01 两项输出全部落地并通过可执行验证：**SQLite StateLedger Adapter**（load/commit/events、goal-create|bootstrap、CAS、幂等、EventPage、持久全局 cursor、单事务原子性、beforeWrite 故障注入=回滚）与 **SQLite ReadModelIndex Adapter**（advance/goal、持久 checkpoint/去重/全键视图、重建等价、ProjectionStallError），并以**文件库 harness 证明进程重启路径**：bootstrap → CreateGoal → SQLite commit → close → reopen → ① canonical GoalSnapshot 从持久库直接 load、② 全新 ReadModel 从持久 EventPage 重放重建 → **两作用域 GoalView 与重启前逐字段一致**（证据块见下）。**本文件只证明 P1-01；P1 DAG 仍为 proposed 阶段，P1-02 未开始。**

## 已执行命令与结果

| 命令（product_root） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS，0 errors（strict NodeNext + exactOptionalPropertyTypes） |
| `pnpm vitest run`（全量） | **18 files / 158 tests PASS**（基线 P1-00 117 + 本票 41：SQLite 套件 27 + 重启双路径 2 + 集成 6 + …） |
| `pnpm vitest run tests/sqlite-ledger` | 17 PASS（共享 StateLedger 契约套件 16，含故障注入回滚变体；文件库重启 1） |
| `pnpm vitest run tests/sqlite-read-model` | 16 PASS（共享 GoalView 契约套件 11；文件库重建等价 5） |
| `pnpm vitest run tests/restart` | 2 PASS（自适应器后自动启用：restart 双路径 + evidence 采集） |
| `pnpm vitest run tests/integration/p1-01.integration.test.ts` | 6 PASS（真实 SQLite Adapter 全路径，无 fake） |
| `pnpm vitest run tests/restart/evidence/p1-01-evidence.test.ts` | 1 PASS，stdout 打印 `P1-01-EVIDENCE` JSON 证据块（可重复命令） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 checks PASS |

静态证据（grep，product_root/src）：
- 原始 SQL 写语句（INSERT/UPDATE/DELETE/CREATE TABLE）出现文件数：**0**（排除 `src/sqlite-ledger/`、`src/sqlite-read-model/` 后）——命令与展示 Adapter（harness/control/interaction）**不直接访问 SQLite 表**；
- `node:sqlite` 消费者排除两个 Adapter 目录后：**0** 个文件——持久化完全封装在 Adapter 内。

## Acceptance 逐项对照（P1-01）

| # | Acceptance 项 | 证据（测试/产物） |
| --- | --- | --- |
| 1 | bootstrap 仅空 SQLite Ledger；只能经受支持 contract 写入；禁止直接插入表 | 套件 bootstrap-not_empty 用例；集成 t1（新文件 bootstrap committed；异 identity→not_empty + 零写入）；静态 grep 0 原始 SQL；Adapter 公共面仅 load/commit/events(+close) |
| 2 | ≥2 Project/Workspace 完整 identity、fixture schema version、source digest、bootstrap revision 持久化 | 证据块 manifest {schemaVersion:1, sourceDigest:26badb1e…, bootstrapRevision:1, entries:2}；集成 t1 `verifyBootstrapManifest`；套件 manifest 快照 load 用例 |
| 3 | 两 Project 复用相同本地 workspaceId/goalId 与 idempotency key；全作用域隔离 | 共享 fixture（proj-alpha/proj-beta × ws-shared × goal-1 × 同 key）；集成 t2 深等 + Goal/视图互异；套件跨 Project 隔离、GoalView 套件跨 scope 隔离用例 |
| 4 | 同 manifest 重放幂等；非空库/异 digest/旧 expected revision 拒绝且无部分写入 | 套件 replay→replayed、not_empty、digest_mismatch、CAS revision_conflict；集成 t1（replay 原 outcome、异 identity→not_empty 零写入） |
| 5 | 重启后 canonical Goal 只从持久 GoalSnapshot load；不 fold/修复 | 重启测试路径 (a)：reopen 后 load 与重启前 deep equal（证据块 canonicalSnapshotLoad.matches=true ×2）；Adapter 实现无 Event fold 路径 |
| 6 | GoalView 由 ReadModelIndex 消费持久 EventPage rebuild，与重启前一致 | 重启测试路径 (b)：reopen({readModelFile:readmodel-rebuilt.sqlite}) 排空 EventPage→视图与重启前 toEqual（证据块 eventRebuildView.matches=true ×2） |
| 7 | 重启后可验证相同 WorkspaceBootstrapManifest | `verifySnapshotLoadPath`：BootstrapManifest 快照经 manifestFromSnapshot 与重启前 manifest toEqual |
| 8 | CreateGoalCommand 引用已初始化 Project/Workspace；不接受未初始化 identity | 集成 t2（未知 project/workspace→scope_not_found）；Control 引擎既有 22 用例 |
| 9 | Event 与 current state 单事务提交；expected revision/CAS 生效 | 集成原子性用例（bootstrap 与 goal-create 各自注入故障：抛错→reject，events/snapshot/幂等零写入；解除→恢复正常提交）；套件 CAS 用例；套件故障注入用例 |
| 10 | SQLite Ledger/View Adapter 通过 P1-00 共享 contract fixtures；不改变 Interface | `tests/sqlite-ledger/sqlite-ledger.contract.test.ts`、`tests/sqlite-read-model/sqlite-read-model-index.contract.test.ts` 直接接线同一 `defineStateLedgerContractSuite`/`defineGoalViewContractSuite`（与 InMemory 完全相同，无单独调参）；冻结入口 implements StateLedger/ReadModelIndex |
| 11 | bootstrap/CreateGoal/restart 不创建或推断 governance revision/active ref | `verifyBootstrapManifest` 正则断言（无 governance/completionPolicy/architectureBaseline/activeRef）；事件类型全集断言 |
| 12 | 同 scope 重复 idempotency key 不创建第二个 Goal；跨 Project 同名 key 不判重 | 集成 t2（重放→同 commitCursor、同 key 异 payload→conflict；alpha/beta 同 key 各自独立持久）；套件 goal-create 重放/异 fingerprint/跨 Project 用例 |
| 13 | 重启后两作用域 loaded revision 与 rebuilt GoalView 分别与重启前一致；查询不返回另一范围 | 重启双路径（两 scope，pre/post）；证据块 observedCursor before=after=c6；集成 t5；absent scope 仍 absent |
| 14 | 不产生隐式 Plan、Task、Run、Todo 或 dispatch side effect | 集成 t6（事件类型集合 = {GoalCreated, ProjectBootstrapped, WorkspaceBootstrapped}）；所有 LedgerCommit.outboxIntents=[] |
| 15 | 命令与展示 Adapter 不直接访问 SQLite 表 | 静态证据（0 原始 SQL / 0 node:sqlite 消费者，排除两个 Adapter 目录）；集成路径仅经 HumanCollaboration/ControlEngine 接口 |
| 16 | 无运行时 Project/Workspace 创建路径 | 仅 `WorkspaceBootstrap` 命令产生 Project/Workspace 快照与事件（bootstrap contract）；无其它创建入口 |

## 重启路径证据块（可重复命令：`pnpm vitest run tests/restart/evidence/p1-01-evidence.test.ts`）

```json
{
  "commitCursors": { "bootstrap": "c0000000004", "alpha": "c0000000005", "beta": "c0000000006" },
  "manifest": { "schemaVersion": 1, "sourceDigest": "26badb1e84f539c2efd17bec0eb8302820b2045f5e678975bfb89df84012a142", "bootstrapRevision": 1, "entries": 2 },
  "cursor": { "observedBeforeRestart": "c0000000006", "rebuiltObservedAfter": "c0000000006" },
  "canonicalSnapshotLoad": { "alpha": { "matches": true }, "beta": { "matches": true } },
  "eventRebuildView": { "alpha": { "matches": true }, "beta": { "matches": true } }
}
```

（完整块含 pre/post 快照与视图对象；文件名是临时目录，不跨机器复现；内容确定性。）

## 技术决策（记录于产品根 HANDOFF “P1-01 契约与存储语义”）

- 驱动：Node 24 内置 `node:sqlite`（DatabaseSync），零依赖；better-sqlite3 不采用。
- 单文件库/临时目录：ledger 与 read model 各一文件，同置于 mkdtemp 临时目录；默认回滚日志，单文件无 -wal/-shm。
- 重启语义：`close()` 关连接 → 同路径新实例；无进程内状态延续。
- 两条供给路径：canonical 从快照表 load（StateLedger 不 fold）；View 由全新 ReadModel 从持久 EventPage 重放重建。
- 原子性：单 `BEGIN IMMEDIATE…COMMIT`（events+snapshots+幂等记录）；beforeWrite 事务内故障注入 → ROLLBACK → reject；存储错误同样回滚并传播。
- cursor：事件行 ID 持久单调；makeCommitCursor/seqOfCommitCursor 唯一编码；重启后 max+1 继续。

## 汇合方式

- 三路并行（隔离 worktree）：lane A `src/sqlite-ledger/**`+`tests/sqlite-ledger/**`（提交 7997345、2861ff3）；lane B `src/sqlite-read-model/**`+`tests/sqlite-read-model/**`（311942f）；lane C `src/harness/persistent-harness.ts`+`tests/restart/**`（a99d8d4，在 integrator 骨架上）；integrator 合并 4dc0e10/a187da0/3f861bc，并新增 `tests/integration/p1-01.integration.test.ts`（6 用例，真实 adapter，无 fake）。
- 集成阶段修复（integrator）：integration 重启用例两处断言/顺序错误（重放 cursor 应为 alpha 原 c5 而非 observedCursor c6；ledger 读取须在 close 之前）。
- 骨架自动启用：`tests/restart` 的 skipIf 探针在适配器实现后自动变为真实运行（本次 2/2 PASS），无 fake 顶替。

## 未解问题与后续

- 无阻断项。已知取舍：证据块 `files` 含 mkdtemp 临时路径（内容确定性、路径非字节稳定）；`verifyRebuildViews` 要求先 advanceProjection（注释已说明）；unavailable 保留码未被本适配器使用（存储错误按异常传播）。
- 推送／部署未发生；remote 已配置未推送（需用户授权）。
- **停止**：P1-01 完成（有限授权内）。P1-02 需另行授权；本文件不构成 P1 验收，也不自动推进任何后续票（含 DAG 上 04 之后的 05/06 并行窗口）。


## Integrator cross-check (2026-09-05, 独立复查)

派发者（integrator）在另一会话完成后进行独立复查，命令均为本人实际执行：

- `pnpm typecheck`：PASS，0 errors（产品根）；
- `pnpm vitest run`（全量）：**18 files / 158 tests PASS**（含 restart 双路径、sqlite 套件、p1-01 集成 6 条），与证据所述一致；
- `node dev_docs/verification/validate-docs.mjs`：12/12 PASS；
- `git diff b300ef7 -- tests/contract-suite/`：空——共享契约套件自 P1-00 后**未被修改**，SQLite Adapter 与 InMemory 走同一套件（`tests/sqlite-ledger/sqlite-ledger.contract.test.ts`、`tests/sqlite-read-model/sqlite-read-model-index.contract.test.ts` 原样接线）；
- package.json / tsconfig / vitest.config 与 P1-00 基线**无差异**（零新增依赖，使用 Node 24 内置 node:sqlite）；
- 实现抽查：ledger 单事务 BEGIN IMMEDIATE→COMMIT/ROLLBACK、beforeWrite 故障注入落于首条 SQL 写之前、幂等表 identity_key 主键（仅 identity+fingerprint 判定）、全局 cursor 经 AUTOINCREMENT 跨重启持久、bootstrap 空库检查覆盖 events/snapshots/idempotency 三者；read-model 持久 checkpoint/去重、三类 ProjectionStallError、重建等价；persistent harness 为真实 SQLite 模块 + close()/reopen() 语义（关闭后拒绝使用）；集成测试仅用真实模块（无 fake），事件类型集合/无 governance 正则断言在位；
- 结论：证据声明与实现一致；工作树干净（0 未提交）；未发现伪造或削弱验收。

