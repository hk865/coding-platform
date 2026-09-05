# IMPLEMENTATION-HANDOFF — Agent Platform 产品代码根

```yaml
ticket_id: P1-00
status: implementation verified (limited authorization, 2026-09-05) — P1-00 only
updated: 2026-09-05
next: STOP — P1-01 requires separate authorization
evidence: /mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/verification/p1-00-implementation-evidence.md
```

## 当前票据与共享契约基线

- Ticket：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/00-contract-pack.md`（P1-00，status 仍按阶段守卫为 proposed；Authorization/Implementation record 已写入）
- 规范与接口权威：文档根 `dev_docs/interfaces/**`、`dev_docs/modules/**`（P1-00 扩展记录已同步至 state-ledger.md / command-event.md / control-engine.md 附录）
- 共享契约基线（已冻结）：
  - `src/contracts/command-event.ts` — Command/Event、fingerprint（JCS+SHA-256，NFC+unicode trim）、identity 相等 `(projectId, actor.kind, actor.id, idempotencyKey)`
  - `src/contracts/ledger.ts` — Ref/Snapshot/LedgerCommit(goal-create | bootstrap)/Receipt(含 not_empty)/EventPage/StateLedger；CommitCursor opaque（仅 ledger adapter 与 ReadModelIndex 可经 compareCommitCursor 比较）
  - `src/contracts/bootstrap.ts` — bootstrap 命令/fixture/manifest/事件/Receipt/BootstrapManifest aggregate（manifestId=sourceDigest）
  - `src/contracts/goal-view.ts` — GoalView/GoalViewResult/ProjectionStallError/ReadModelIndex
  - `src/contracts/modules.ts` — ControlEngine（submit + bootstrap 扩展）、HumanCollaboration
  - `src/contracts/validation.ts` — 确定性运行时校验；`src/contracts/fixtures/**` 共享 fixture 与 fold 契约数学（builder）；`src/contracts/testing/**` 一致测试替身
  - `tests/contract-suite/**` — StateLedger / GoalView 共享契约套件（每个 Adapter 必须通过）

### 冻结语义（接口文档附录 + 套件强制）

1. 幂等：**同 identity+fingerprint ⇒ 必定重放**（返回首次 eventIds/aggregateRevisions/commitCursor，易变 id 一律不入库）；同 identity 异 fingerprint ⇒ idempotency_conflict；异 identity ⇒ CAS（revision_conflict）。ledger 不做内容↔fingerprint 校验。
2. bootstrap：仅空库首次初始化；幂等判定先于空库检查；非空库不同 identity ⇒ not_empty；manifest 经 BootstrapManifest snapshot 持久化并可重建。
3. Goal 创建：expectedRevision 0、完整 Ref、唯一 GoalCreated+GoalSnapshot@1、activePlanRevision=null、零 outbox。
4. freshness：not_found 仅当投影已覆盖 atLeastCursor 且无行；否则 not_ready（含无 atLeastCursor 且无行）；ready.observedCursor 必须覆盖 atLeastCursor。
5. 投影停滞（缺口/乱序/未知版本）⇒ 抛 ProjectionStallError，不部分应用、不静默跳过。

## 三路并行（隔离 worktree → main 合并）

| Lane | 分支/提交 | 产物 | 状态 |
| --- | --- | --- | --- |
| A StateLedger | lane-a `31f61ef` | `src/ledger/in-memory-ledger.ts`（InMemoryLedger + createInMemoryLedger，beforeWrite 故障注入）；`tests/ledger`（契约套件 16 + 边界 11） | ✅ 27/27 |
| B ControlEngine | lane-b `6c88e3d` | `src/control/control-engine.ts`（submit + bootstrap）；`tests/control` 22 用例表驱动 | ✅ 22/22 |
| C ReadModel+HumanCollab | lane-c `b05ac82` | `src/read-model/read-model-index.ts`、`src/interaction/human-collaboration.ts`；`tests/read-model|interaction`（套件 11 + 22） | ✅ 33/33 |

integrator 维护：package/lock/tsconfig/vitest、contracts、fixtures、suites、testing、`src/harness`、`tests/integration`、文档同步、集成协调（套件修正 6 处、语义裁决 2 处、产物证据）。

## 集成与验收（真实模块，无 fake）

- 完整路径：bootstrap → CreateGoal → InMemoryLedger → EventPage → ReadModelIndex → GoalView（`src/harness/in-memory-harness.ts` 接线真实 A/B/C 模块）。
- 跨模块契约强断言：确定性 deps 下，Control 提交的 Event/Snapshot 与共享 builder 深相等（evt-0005/0006、cmd-0001/0002 已锁定）。
- 集成断言：双 Scope 复用本地 id/goalId/key 的隔离、重放幂等、同键异载荷 conflict、rejections 零写入、bootstrap 重放/not_empty、freshness not_ready→ready。

## 已执行命令及结果（最终）

| 命令（product root） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS，0 errors |
| `pnpm vitest run` | 11 files / 117 tests PASS |
| `pnpm vitest run tests/integration` | 7 PASS（tracer bullet） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 PASS |

## 验收证据

- P1-00 Acceptance 逐项对照与命令输出：[p1-00-implementation-evidence.md]（文档根 dev_docs/verification/）
- 本票 Implementation record：00-contract-pack.md

## 未解问题 / 设计理由

- 无阻断项。已知取舍（已记录）：
  - Goal 已存在不短路：由 ledger 幂等+CAS 原子判定（重放 vs revision_conflict），文档语义要求；
  - currentVersions 优先取 goal ref 的 revision（引用 aggregate 变化时提供有用信息）；
  - bootstrap identity 无 projectId（BootstrapCommandIdentity），因 bootstrap 跨多 Project；
  - 集成/契约证据为内存路径；生产 Adapter（SQLite）/transport 不在本票范围。
- 已知修复记录：套件 test5(eventIds)、test9(先落记录+真异 fingerprint)、test12(异 identity)、新增“异 eventId 重放”用例；GoalView 套件两处断言；集成断言 crossB 键错误；integrator 读写截断事故（suite 尾部）已恢复并审计其它文件。

## 远端

- `origin = git@github.com:hk865/coding-platform.git`（仅本地配置，未推送；推送需用户授权）。

## 下一步

- **停止**。P1-00 完成（有限授权内）；P1-01 需另行授权；业务/文档明确不自动推进。
