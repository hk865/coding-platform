# IMPLEMENTATION-HANDOFF — Agent Platform 产品代码根

```yaml
ticket_id: P1-02
status: implementation in progress (limited authorization, 2026-09-05 — P1-02 only)
updated: 2026-09-05
authorized_by: user (limited authorization note recorded in ticket 02 + this file)
next: STOP after P1-02 acceptance — do NOT auto-start P1-03
evidence: /mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/verification/p1-02-implementation-evidence.md
```

---

## P1-02 当前票据与共享契约基线

- Ticket：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md`（P1-02，status 按阶段守卫保持 proposed；有限授权与实施记录已追加票尾）
- 上游 P1-00/P1-01 验收证据：`dev_docs/verification/p1-00-implementation-evidence.md`、`p1-01-implementation-evidence.md`（仅证明各自票据）
- P1-00/P1-01 契约基线（**冻结复用，不重写**）：`src/contracts/**`、`src/contracts/fixtures/**`、`src/contracts/testing/**`、`tests/contract-suite/state-ledger.contract.suite.ts`+`goal-view.contract.suite.ts`（既有套件零修改）、`src/ledger|control|read-model|interaction|sqlite-ledger|sqlite-read-model`、`src/harness/**`、`tests/restart/**`、`tests/integration/**`
- P0-06 复核影响（AGENTS.md 要求）：`human-framework-role-review.md` 结论与本票无冲突（初始 Baseline fixture 只验证安装机制；角色完成权不绑定名称；本票不派发/不判定完成/不创建 ArchitectureEvolutionPolicy）。doc 与票据 Acceptance 无冲突；如后续发现差异：以票据 Acceptance 为准并上报 integrator 统一协调接口文档修订。

## P1-02 契约与存储语义（冻结）

1. **LedgerCommit 扩展方式**：新增三个 commitKind（`governance-install` / `governance-activate` / `plan-revision`），全部 schemaVersion 1、project-scoped CommandIdentity、`outboxIntents: []`；沿用 P1-00 先例做版本化记录，**不改变既有 v1 goal-create/bootstrap 语义**（既有契约套件零修改通过）。
2. **Immutable governance revision**：identity = (projectId, policyId|baselineId, revision)；`contentDigest = JCS+SHA-256({schemaVersion, identity, revision, content})`；revision 不可覆写（install 以 expected revision 0 做 CAS；同 identity+fingerprint 重放=committed/replayed；同 identity 异 fingerprint=idempotency_conflict；不同身份再装同 identity/revision=revision_conflict 零写入）；ref 形式为 `{aggregateType, projectId, id, revision}`，解析必须 identity/revision/digest 三元精确匹配（`resolveCompletionPolicyRevision` / `resolveProjectCompletionPolicy` 等只读 helper，无默认、无内置内容）。
3. **Activation 语义**：只接受已安装的精确 target ref（pin=ref+digest 三元）；以 expected **Project revision** 做 CAS（expectedVersions 含 Project@expected），并同时以按 kind 独立的 active aggregate revision 做 CAS（首次 0→1，后续 k→k+1）；悬空→`not_found`、digest mismatch→`digest_mismatch`、竞争更新→`revision_conflict`，一律**不移动 active ref（零写入）**；CompletionPolicy 与 ArchitectureBaseline active ref 各自独立（P1-02 **不要求/不创建** ArchitectureEvolutionPolicy active ref）。
4. **缺省语义**：fixture 缺失/无效→install `invalid` 拒绝且**不使用内置内容**；没有任何默认 completion policy / architecture baseline（无 active ref 时 Plan 解析即 `unresolved_governance_ref` 零写入拒绝）；Plan 无法从 canonical active refs 解析完整匹配即零写入拒绝，**不用内置 fallback**。
5. **PlanRevision 结构**：`PlanStage`；`RuntimeTask` 四正交维度 requirementLevel/taskKind/disposition/phase + scope（goal|stage|module）；`GateTask` = taskKind=gate 的 RuntimeTask（同一任务集合，不重复计数）；`AcceptanceObligation`（requirementLevel + taskIds + compiled VerificationRequirements）；`VerificationRequirement`（requirementLevel + kind∈policy.requirementKinds）；`TaskHierarchy`（parent_of）；`RuntimeExecutionDAG`（depends_on，每条硬依赖带 requires{kind,label}，无环）；`PlanRevisionSnapshot`（固定精确 pin：effectiveCompletionPolicy/effectiveArchitectureBaseline；goalRef；acceptedAt；结构快照）；`PlanValidationError`。
6. **Guard 顺序**（全部零写入）：1) schema 校验（validation.ts）→ 2) 引用解析（Goal 存在；active CompletionPolicy/ArchitectureBaseline 三元匹配）→ 3) 非空 guard（≥1 required executable Task；≥1 active required GoalGateTask（required+gate+active+scope=goal）；≥1 required AcceptanceObligation；每个 required executable Task 映射 ≥1 required obligation；每个 required obligation 映射 ≥1 本计划内 work/gate Task；每个 required obligation 编译出 ≥ policy.minimumRequiredRequirementsPerObligation 个 required VerificationRequirement 且 kind ∈ policy.requirementKinds）→ 4) 结构合法：parent_of 只进 TaskHierarchy、depends_on 只进 RuntimeExecutionDAG（互不混入）、无悬空 Task/Stage/边引用、无自依赖、无环 → 5) 原子提交（CAS：Goal@expectedRevision + PlanRevision@0）。空集合、缺 GoalGateTask、悬空边、环、CAS 窗口变化一律零写入拒绝。
7. **Pin 不可变**：Project default active ref 后续移动（再激活新 revision）**不改变**既有 Plan pin；改变 pin 只能创建新 PlanRevision/PlanRebase（本票无该命令）。
8. **View**：`PlanGraphViewQuery/Result`（key=(projectId, goalId)）、`TaskDetailViewQuery/Result`（key=(projectId, goalId, taskId)）；freshness 沿用 opaque `CommitCursor` 语义（`not_ready` ≠ `not_found`；not_found 仅在 observedCursor 已覆盖 atLeastCursor 且无行）；已知 v1 事件但无投影 handler→`ProjectionStallError(unsupported_event_type)` 整页停止。
9. **重启等价**：install/activation/applyPlan 全部经 SQLite 单事务；重启后（close→reopen 同文件）canonical ref 解析（identity/revision/digest）、plan pin、Plan Graph/Task Detail（全新实例重放持久 EventPage）、active revision 逐字段一致；禁止任何 fake 或内存状态延续。
10. **边界**：本票不派发 Task、不创建 Run/TaskAttempt/AgentRun、不产生 dispatch outbox、不做 Goal 归约；Stage 不自动生成依赖；completed/satisfied 判定留给后续票。

## P1-02 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| governance 契约/夹具 | src/contracts/governance.ts、src/contracts/fixtures/governance-fixtures.ts | fixture（COMPLETION_POLICY_FIXTURE_V1、ARCHITECTURE_BASELINE_FIXTURE_V1）、pin/revision 类型、Install/Activate 命令与 receipt、governanceContentDigest、fingerprint、只读 resolution helper |
| plan 契约/夹具 | src/contracts/plan.ts、src/contracts/fixtures/plan-fixtures.ts、src/contracts/plan-view.ts | PlanRevision 全结构、ApplyPlanRevisionCommand、PlanRevisionReceipt、PlanValidationError、HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1、buildApplyPlanCommand、buildPlanLedgerCommit、PlanGraphView/TaskDetailView |
| validation 扩展 | src/contracts/validation.ts | validate{CompletionPolicy,ArchitectureBaseline}Fixture、validateInstall*/Activate*/ApplyPlan*Command、validatePlanRevisionDraft |
| leder commit 校验 | src/contracts/ledger-validation.ts | validateGovernanceInstall/Activate/PlanRevisionCommit（InMemory+SQLite 共用） |
| Control 入口 | src/control/governance-install.ts、governance-activate.ts、plan-acceptance.ts | installGovernanceRevision(deps,cmd)/activateGovernance(deps,cmd)/applyPlanRevision(deps,cmd)（stub→lane 填充；control-engine.ts 仅委托） |
| harness | src/harness/{in-memory,persistent}-harness.ts | install/activate/applyPlan/planGraph/taskDetail 直通；其余不变 |
| 契约套件 | tests/contract-suite/{p1-02-harness,governance.contract.suite,plan.contract.suite}.ts | defineGovernanceContractSuite/definePlanContractSuite(factory) |
| 重启骨架 | tests/restart/p1-02-restart-fixtures.ts、p1-02-restart.test.ts、evidence/p1-02-evidence.test.ts | skipIf 探针 isP102Ready()；实现落地后自动启用 |

## 四路并行（P1-02，隔离 worktree → main 合并）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A install/activate | `p1-02-lane-a` @ `/home/han001/projects/agents/agent_platform-p1-02-a` | 完全实现 install（schema→digest→immutable 持久化→幂等→zero-write 映射）与 activate（精确 target→CAS→active ref 独立；悬空/digest/CAS 失败零写入） | src/control/governance-install.ts、src/control/governance-activate.ts、tests/control/governance-*.test.ts | ⏳ |
| B ApplyPlanRevision | `p1-02-lane-b` @ `/home/han001/projects/agents/agent_platform-p1-02-b` | 完全实现 applyPlan（guard 顺序 1→5，非空+映射+VR 编译+无环，pin 固定，幂等/CAS 映射） | src/control/plan-acceptance.ts、tests/control/plan-acceptance.test.ts | ⏳ |
| C ReadModel 投影 | `p1-02-lane-c` @ `/home/han001/projects/agents/agent_platform-p1-02-c` | PlanGraph/TaskDetail/GoalView(activePlanRevision) 双 Adapter 投影+查询+重建等价+隔离+stall | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts、tests/read-model/**、tests/sqlite-read-model/** | ⏳ |
| D 持久化 harness + 重启证据 | `p1-02-lane-d` @ `/home/han001/projects/agents/agent_platform-p1-02-d` | 完成重启路径（bootstrap→install×2→activate×2→CreateGoal→applyPlan→close→reopen→canonical refs/pins/views 一致）+证据收集 | tests/restart/p1-02-restart-fixtures.ts、p1-02-restart.test.ts、evidence/p1-02-evidence.test.ts | ⏳ |

integrator 维护：package/lock/tsconfig/vitest、src/contracts/**（公共 schema/接口/共享 fixture）、src/ledger/**、src/sqlite-ledger/**、src/control/control-engine.ts、src/harness/**、tests/contract-suite/**、tests/integration/**、文档与状态记录。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结签名（如有缺口：提交具体建议给 integrator 统一修改基线并通知消费者）。

## P1-02 已执行命令及结果（阶段 1 共享基线）

| 命令（product root） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS 0 errors（含新契约/夹具/套件/骨架） |
| `pnpm vitest run`（全量） | 18 files / 158 tests PASS（既有零回归；P1-02 套件未接线，待 lane 落地） |
| 静态 grep：既有套件改动 | 无（git diff 仅新增文件 + 版本化扩展） |

## 下一步 / 未解问题

- 四路 lane 并行编码（A/B/C/D），然后 integrator 合并、接线契约套件（InMemory+SQLite）、写 tests/integration/p1-02.integration.test.ts（真实 Adapter 全路径，无 fake）并逐项核对 19 项 Acceptance；
- 已知设计决定：install/activate 以 project 作用域建模（每个 Project 安装自己的 revision 副本并建立自己的 active ref；fixture 内容全局一致，policyId/baselineId 为 identity）；activation CAS 同时含 Project 与按 kind active aggregate 两条 expected（比单纯 Project CAS 更强，防止同类并发覆盖）；HumanCollaboration 用户级 applyPlan 入口留给 P1-08/15；
- 未解：无阻断项。P1-02 完成前不推进 P1-03；推送/部署未发生（需用户授权）。

---

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

## P1-01 已执行命令及结果（最终）

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

## P1-01 未解问题 / 设计理由

- 无阻断项。设计理由见上方“P1-01 契约与存储语义”（驱动选型、单文件策略、重启语义、事务边界、故障注入映射）。
- 已知预留：`beforeWrite` 与 InMemoryLedger 同名（统一故障注入 seam）；unavailable 保留给选择该语义的 Adapter；read model 与 ledger 分离文件（投影可删可重建，canonical 不受影响）。

## P1-01 验收证据与下一步

- P1-01 Acceptance 逐项对照（16 项）与命令输出、重启证据块摘要：[p1-01-implementation-evidence.md]（文档根 dev_docs/verification/）
- 本票 Implementation record：01-goal-persisted-and-visible.md（status 保持 proposed，符合阶段守卫）
- 集成阶段 integrator 修复：p1-01 集成测试 2 处（重放 cursor 断言用 alpha 原值 c5；ledger 读取移到 close 之前）；无产品代码缺陷回退。

**停止**。P1-01 完成（有限授权内）。不自动推进 P1-02；P1 DAG 仍为 proposed；推送/部署未发生（remote 未推送，需用户授权）。

---

## P1-00 历史记录（已完成，保留备查）

P1-00 于 2026-09-05 完成（有限授权），验收证据：`dev_docs/verification/p1-00-implementation-evidence.md`。当时三路：lane-a（InMemoryLedger）、lane-b（ControlEngine）、lane-c（ReadModelIndex + HumanCollaboration），隔离 worktree → main 合并；最终 `pnpm typecheck` PASS、`pnpm vitest run` 11 files/117 tests PASS、validate-docs 12/12。契约与语义基线见上方“P1-00 语义基线照旧”与接口文档 P1-00 扩展记录。
