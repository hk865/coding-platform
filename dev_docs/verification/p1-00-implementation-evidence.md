# P1-00 Implementation evidence

```yaml
ticket: P1-00 (Executable contract pack)
date: 2026-09-05
status: implementation verified — acceptance evidence for P1-00 only
scope: 有限授权：仅 P1-00；不代表 P0/P1 已验收通过，不自动推进 P1-01
product_root: /home/han001/projects/agents/agent_platform
ticket: ../../planning/proposed/P1-foundation/tickets/00-contract-pack.md
handoff: <product root> IMPLEMENTATION-HANDOFF.md
```

## 结论

P1-00 三项输出全部落地并通过可执行验证：版本化 bootstrap 契约（fixture/manifest/命令）、多 Scope CreateGoal 契约 schema（可运行时校验）、InMemory harness 与 tracer bullet（bootstrap → CreateGoal → Ledger → EventPage → ReadModel → GoalView 全真机路径）。**本文件只证明 P1-00；P0-06 仍为 in_review，P1 DAG 仍为 proposed 阶段。**

## 已执行命令与结果

| 命令（product_root） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS，0 errors；strict NodeNext + exactOptionalPropertyTypes |
| `pnpm vitest run`（全量） | 11 files / 117 tests PASS（含集成 7 条） |
| `pnpm vitest run tests/contracts` | 28 PASS（fingerprint/JCS、validation、fixtures、cursor） |
| `pnpm vitest run tests/ledger` | 27 PASS（契约套件 16 + 边界 11，InMemoryLedger） |
| `pnpm vitest run tests/control` | 22 PASS（ControlEngine submit + bootstrap，替身隔离） |
| `pnpm vitest run tests/read-model tests/interaction` | 33 PASS（GoalView 契约套件 11 + 实现/交互 22） |
| `pnpm vitest run tests/integration` | 7 PASS（真机 tracer bullet，无 fake） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 checks PASS |

## Acceptance 逐项对照（P1-00）

| # | Acceptance 项 | 证据（测试/产物） |
| --- | --- | --- |
| 1 | Fixture/Manifest：schema version、非空 entries、规范化 source digest、bootstrap revision | `src/contracts/bootstrap.ts`（digest=bootstrapSourceDigest，JCS+SHA-256）、`README…/contracts/fixtures.test.ts`、integration `verifyBootstrapManifest` |
| 2 | MVP fixture：≥2 隔离 Project/Workspace；两 Project 复用同一本地 workspaceId；完整作用域 | `src/contracts/fixtures/bootstrap-fixture-v1.ts`（proj-alpha/proj-beta × ws-shared）、`fixtures.test.ts` |
| 3 | fixture/manifest 不携带 governance revision 或 active ref | `fixtures.test.ts`（正则断言无 governance/completionPolicy/architectureBaseline/activeRef）、integration assertion |
| 4 | bootstrap 仅空库；经受支持契约原子产生 Project/Workspace + 可审计 Event/Manifest | 契约套件 bootstrap 组、integration test 1（manifest 快照、4 条审计事件、原子） |
| 5 | entry 缺失/重复/消化不匹配 → 零写入拒绝 | `validation.ts`（empty_entries/duplicate_identity/incomplete_scope/digest_mismatch）、control-engine 映射、integration“rejections 零写” |
| 6 | 同 digest 重放幂等；非空库/异 digest/未知 schema → 确定性拒绝 | 套件（replay→committed replayed / not_empty / idempotency_conflict）、integration test 6、validation（unknown_schema_version） |
| 7 | CreateGoal 只引用已初始化 Project/Workspace；同本地 goalId+幂等键跨 Project 独立 | control-engine 22 用例、integration test 2/4（scope_not_found）、套件跨 Project 隔离 |
| 8 | CreateGoal 契约 schema 版本化且可运行时校验 | `command-event.ts`（schemaVersion:1 literal）、`validation.ts`、`validation.test.ts` |
| 9 | InMemory 两完整作用域确定性 Goal snapshot+GoalView；`(projectId, workspaceId, goalId)` 不串 scope | integration test 2（深等断言：committed Event/Snapshot == 契约 builder）+ `verifyGoalViewIsolation`（同本地 id 仅命中本 project 行；异 project 键 not_found） |
| 10 | 初始 activePlanRevision=null；不产生 Plan/Task/Run/outbox | `goal-fixtures.ts`（outboxIntents=[]）、integration（activePlanRevision null、GoalCreated only×2） |
| 11 | expected revision/CAS、幂等键、事件顺序、read cursor 可执行契约测试 | 套件（CAS conflict+currentVersions、replay 原 outcome、EventPage 无跳漏、cursor 单调）、`cursor.test.ts`（非字典序） |
| 12 | 输出为后续 Adapter 必须满足的 Interface；不声称生产 Adapter 已存在 | 契约套件为参数化 adapter suite（`defineStateLedgerContractSuite`/`defineGoalViewContractSuite`）；无 SQLite/生产 adapter 代码；IMPLEMENTATION-HANDOFF 明确 |

## 契约语义基线（已冻结并记录）

- 幂等：**同 identity+fingerprint 必定重放**（返回首次 eventIds/revisions/cursor，易变 id 不入库）；同 identity 异 fingerprint → idempotency_conflict；异 identity → CAS。ledger 不做“内容↔fingerprint”校验（fingerprint 由 Control 计算）。
- Bootstrap：仅空库首次初始化；幂等判定先于空库检查；manifest 经 BootstrapManifest aggregate 持久化（ref.manifestId = sourceDigest）。
- Cursor：opaque、单调递增；仅 ReadModelIndex 与 ledger adapter 可经 compareCommitCursor 使用。
- 错误语义：CreateGoal：invalid/not_found/revision_conflict/idempotency_conflict/unavailable；用户面映射 invalid_request/scope_not_found/conflict/temporarily_unavailable；投影 not_ready≠not_found 由 cursor 覆盖证明。
- 扩展记录：接口文档（state-ledger/command-event/control-engine）附录均已同步；`validate-docs.mjs` 12/12。

## 汇合方式

- 三路并行：lane-a/lane-b/lane-c 隔离 worktree（分支），提交 `31f61ef`（A）、`6c88e3d`（B）、`b05ac82`（C），integrator 合并入 main；集成路径用真实模块（`src/ledger|control|read-model|interaction` + `src/harness`），未使用任何 fake。
- integrator 修复的共享套件缺陷：test5 eventIds 长度、test12 异 identity、test9 先落记录、新增“同 identity+fingerprint 异 eventId → 重放”用例、GoalView 套件两处断言、集成断言 crossB 键错误；并按文档语义裁决删除 ledger 内容↔fingerprint 守卫。

## 未解问题与后续

- 无阻断项。P1-01 需要另行授权（本证据不构成自动推进依据）。
- 生产 Adapter（SQLite）与 IPC transport 不在本票范围；接口已由契约套件固定。
- 推送／部署未发生；remote origin 已配置未推送（需用户授权）。
