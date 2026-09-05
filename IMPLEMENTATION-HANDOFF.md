# IMPLEMENTATION-HANDOFF — Agent Platform 产品代码根

```yaml
ticket_id: P1-01
status: implementation verified (limited authorization, 2026-09-05 — P1-01 only)
updated: 2026-09-05
authorized_by: user (limited authorization note recorded in ticket 01 + this file)
next: STOP — P1-01 done; P1-02 requires separate authorization; P1-01 acceptance does NOT mark P1 done
evidence: /mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/verification/p1-01-implementation-evidence.md
```

---

## P1-01 当前票据与共享契约基线

- Ticket：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/01-goal-persisted-and-visible.md`（P1-01，status 按阶段守卫保持 proposed；授权与实施记录追加在票尾）
- 上游 P1-00 验收证据：`dev_docs/verification/p1-00-implementation-evidence.md`（12 项 Acceptance 对照 + 命令输出；仅证明 P1-00）
- P1-00 契约基线（**冻结复用，不重写**）：`src/contracts/**`（ledger/bootstrap/events/command-event/goal-view/modules/validation/fingerprint/opaque）、`src/contracts/fixtures/**`（共享 fixture 与 fold 契约 builder）、`src/contracts/testing/**`（一致测试替身 + 确定性 deps）、`tests/contract-suite/**`（参数化 StateLedger / GoalView 契约套件——**SQLite Adapter 的验收门槛**）
- P1-00 语义基线照旧（幂等=同 identity+fingerprint 必重放；异 fingerprint=conflict；CAS=异 identity；bootstrap 仅空库+重放优先；freshness=not_found 仅当覆盖 atLeastCursor；投影停滞抛 ProjectionStallError）

## P1-01 契约与存储语义（本票冻结）

1. **SQLite 驱动选型：Node 24 内置 `node:sqlite`（DatabaseSync）**——零新增运行时依赖；已在 Node v24.18.0 验证可用；`@types/node@24.13.3` 提供类型。备选 better-sqlite3 **不采用**（引入 native 构建与依赖，收益为零）。
2. **单文件库/临时目录策略**：ledger 一个 SQLite 文件（默认 `ledger.sqlite`），read model 一个独立文件（默认 `readmodel.sqlite`），同置于一个临时目录（默认 `fs.mkdtemp(os.tmpdir())`）；默认 journal（回滚日志）保证单文件、无 -wal/-shm 残留。只允许经 `control.bootstrap/control.submit` + `ledger.commit` 写入，产品层无其它插入路径（直接 INSERT 由验收以“产品 src 无裸露插入 + adapter 仅暴露 load/commit/events”证明）。
3. **“重启”语义**：状态只存在 SQLite 文件里；**restart = `close()`（显式关闭连接，实例随后拒绝使用）→ 同一文件路径上的全新实例**。不会携带任何进程内状态；“reopen”仅是 harness 层便利。
4. **两条供给路径（差异固定）**：
   - canonical snapshot：重启后 `ledger.load(ref)` **直接从持久快照表加载**；StateLedger **从不 fold Event、从不重建/修复 canonical snapshot**（与 P1-00 接口 Invariant 一致）；
   - ReadModel：重启后用**全新** ReadModelIndex **从持久 EventPage 重放重建**（增量投影与重建逐字段一致，见契约套件 rebuild 用例 + tests/restart）。canonical 永远不会来自 View，View 永远是 Event 投影。
5. **原子性 = 单个 SQLite 事务**：一次 `commit` 的 Event 插入 + snapshot upsert + 幂等记录落库只在一个 `BEGIN IMMEDIATE … COMMIT` 内完成；任何错误 → `ROLLBACK` → 无部分写入（“只写 Event / 只写 snapshot / 只写幂等记录”的中间态不可达）。
6. **故障注入映射**：契约套件 `createWithFault` = 适配器 `beforeWrite` 钩子（与 InMemoryLedger 同名同语义），在事务内、全部校验 + 幂等/CAS 判定通过后、首次 SQL 写之前触发；抛错 → `ROLLBACK` → `commit()` **reject**。存储级错误同样回滚并传播异常（不吞错返回 unavailable；unavailable 仍是接口保留码）。
7. **全局 cursor**：持久单调计数（事件行 ID），`makeCommitCursor(seq)`/`seqOfCommitCursor` 继续作为唯一编码；重启后从库内 max+1 继续，绝不回退或重排。
8. **Bootstrap 空库判定**：ledger 空 = events/snapshots/idempotency 三表均无行（不相干的自建表不影响）；幂等判定先于空库判定（重放优先）。

## P1-01 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| SqliteStateLedger Adapter | `src/sqlite-ledger/sqlite-ledger.ts` | `SqliteStateLedgerOptions{path, beforeWrite?}`、`class SqliteStateLedger implements StateLedger`（+extra `close()`、`dbPath`）、`createSqliteStateLedger(options)` |
| SqliteReadModelIndex Adapter | `src/sqlite-read-model/sqlite-read-model-index.ts` | `SqliteReadModelIndexOptions{path}`、`class SqliteReadModelIndex implements ReadModelIndex`（+extra `close()`、`dbPath`）、`createSqliteReadModelIndex(options)` |
| 持久化 harness | `src/harness/persistent-harness.ts` | `createPersistentSqliteHarness(options?)`、`PersistentSqliteHarness{ledger,readModel,control,collaboration,bootstrap,advanceProjection,observedCursor,close,reopen({readModelFile?}),cleanup,dir,ledgerPath,readModelPath}`；`src/harness/index.ts` 已 re-export |
| 重启路径 fixtures/断言 | `tests/restart/restart-fixtures.ts`、`tests/restart/restart-assertions.ts` | `runBootstrapAndCreateGoals`、`capturePreRestart`、`verifySnapshotLoadPath`、`verifyRebuildViews` |
| 集成骨架（可暂红，自适应器落地后自动启用） | `tests/restart/persistent-restart.test.ts`、`tests/restart/evidence/p1-01-evidence.test.ts` | skipIf 探针：适配器未实现时 SKIP，实现后真实运行 |

## 三路并行（P1-01，隔离 worktree → main 合并）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A SqliteStateLedger | `p1-01-lane-a` @ `/home/han001/projects/agents/agent_platform-p1-01-a`（7997345、2861ff3；merge 4dc0e10） | StateLedger 全语义 + 契约套件（含故障注入回滚）通过 | `src/sqlite-ledger/**`、`tests/sqlite-ledger/**` | ✅ 17/17 |
| B SqliteReadModelIndex | `p1-01-lane-b` @ `/home/han001/projects/agents/agent_platform-p1-01-b`（311942f；merge a187da0） | ReadModelIndex 全语义 + GoalView 契约套件通过、重建等价 | `src/sqlite-read-model/**`、`tests/sqlite-read-model/**` | ✅ 16/16 |
| C 持久化 harness + 重启证据 | `p1-01-lane-c` @ `/home/han001/projects/agents/agent_platform-p1-01-c`（a99d8d4；merge 3f861bc） | file harness、双路径 fixture/断言、证据收集、集成骨架完善 | `src/harness/persistent-harness.ts`、`tests/restart/**` | ✅ 2/2（适配器落地后自动启用） |

integrator 维护：package/lock/tsconfig/vitest、`src/contracts/**`、`src/harness/index.ts`、`tests/integration/**`、文档与状态记录、集成协调。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结入口签名（如有缺口：提交建议给 integrator，由 integrator 统一改基线并通知消费者）。

## 已执行命令及结果（最终）

| 命令（product root） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS，0 errors |
| `pnpm vitest run` | **18 files / 158 tests PASS**（P1-00 基线 117 + P1-01 新增 41：SQLite 双套件 27、重启双路径 2、p1-01 集成 6、p1-01 断言/证据相关 6） |
| `pnpm vitest run tests/sqlite-ledger` | 17 PASS（共享套件 16 + 文件库重启 1） |
| `pnpm vitest run tests/sqlite-read-model` | 16 PASS（共享套件 11 + 文件库重建等价 5） |
| `pnpm vitest run tests/restart` | 2 PASS（探针自动启用：双路径 + 证据采集） |
| `pnpm vitest run tests/integration/p1-01.integration.test.ts` | 6 PASS（真实适配器，无 fake） |
| `pnpm vitest run tests/restart/evidence/p1-01-evidence.test.ts` | 1 PASS（`P1-01-EVIDENCE` JSON 证据块，可重复） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 PASS |
| 静态 grep：src 中 `sqlite-ledger`/`sqlite-read-model` 之外的原始 SQL 与 `node:sqlite` 消费者 | 0 / 0 |

## 未解问题 / 设计理由

- 无阻断项。设计理由见上方“P1-01 契约与存储语义”（驱动选型、单文件策略、重启语义、事务边界、故障注入映射）。
- 已知预留：`beforeWrite` 与 InMemoryLedger 同名（统一故障注入 seam）；unavailable 保留给选择该语义的 Adapter；read model 与 ledger 分离文件（投影可删可重建，canonical 不受影响）。

## 验收证据与下一步

- P1-01 Acceptance 逐项对照（16 项）与命令输出、重启证据块摘要：[p1-01-implementation-evidence.md]（文档根 dev_docs/verification/）
- 本票 Implementation record：01-goal-persisted-and-visible.md（status 保持 proposed，符合阶段守卫）
- 集成阶段 integrator 修复：p1-01 集成测试 2 处（重放 cursor 断言用 alpha 原值 c5；ledger 读取移到 close 之前）；无产品代码缺陷回退。

**停止**。P1-01 完成（有限授权内）。不自动推进 P1-02；P1 DAG 仍为 proposed；推送/部署未发生（remote 未推送，需用户授权）。

---

## P1-00 历史记录（已完成，保留备查）

P1-00 于 2026-09-05 完成（有限授权），验收证据：`dev_docs/verification/p1-00-implementation-evidence.md`。当时三路：lane-a（InMemoryLedger）、lane-b（ControlEngine）、lane-c（ReadModelIndex + HumanCollaboration），隔离 worktree → main 合并；最终 `pnpm typecheck` PASS、`pnpm vitest run` 11 files/117 tests PASS、validate-docs 12/12。契约与语义基线见上方“P1-00 语义基线照旧”与接口文档 P1-00 扩展记录。
