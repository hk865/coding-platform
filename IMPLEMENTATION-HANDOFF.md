# IMPLEMENTATION-HANDOFF — Agent Platform 产品代码根

```yaml
ticket_id: P1-06
status: implementation in progress (limited authorization, 2026-09-06 — P1-06 only); shared baseline built on P1-05 commit d1c6595; 3 lanes dispatched for control/context/read-model implementations; acceptance evidence at dev_docs/verification/p1-06-implementation-evidence.md (pending)
updated: 2026-09-06
authorized_by: user (limited authorization for P1-06 only; P1-06 is NOT P1 acceptance, P1-07/15 NOT auto-started; G2 (Continuity) waits P1-05 + P1-06)
next: after P1-06 acceptance STOP — do NOT auto-start P1-15/other tickets (G2 needs 05+06; next window triggered by user/process)
evidence: /mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/verification/p1-06-implementation-evidence.md (at acceptance); upstream baseline: P1-05 commit d1c6595 (64 files/539 tests)
merge_surface_note: P1-06 was built in ISOLATED worktree agent_platform-p1-06 (branch p1-06-int, derived from d1c6595) AFTER the P1-05 parallel session finished. The earlier P1-05 x P1-06 text-level conflict (both sessions appending to events.ts / ledger.ts / validation.ts from the 5a278cb baseline) was resolved mechanically ("双方皆保留、版本化追加"), verified byte-fidelity of P1-05 parts, and documented as a control-plane lesson in dev_docs/logs/conflict-reports/README.md (see the integration report for the tagged conflict record).
```

```yaml
ticket_id: P1-05
status: implementation verified (limited authorization, 2026-09-05 — P1-05 only); lanes A/B implemented (subagent infra failed mid-run -> integrator takeover, recorded below) and merged; lane C validated (no changes needed); full acceptance evidence in dev_docs/verification/p1-05-implementation-evidence.md
updated: 2026-09-05
authorized_by: user (limited authorization for P1-05 only, per P1-04 precedent; P1-05 is NOT P1 acceptance, P1-07/08 NOT auto-started)
next: STOP after P1-05 acceptance — do NOT auto-start P1-07/08 (DAG: 05 验收后才出现 07/08 并行窗口); P1-06 parallel session paused by user (its worktree agent_platform-p1-06 branch p1-06-int is at its own baseline; merge surface: events/ledger/validation.ts — coordinate at merge)
evidence: /mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/verification/p1-05-implementation-evidence.md (at acceptance); P1-04 upstream baseline: commit 5a278cb
```

---

## P1-06 当前票据与共享契约基线

- Ticket：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/06-handoff-a-to-b.md`（P1-06，status 按阶段守卫保持 `proposed`；Implementation record 将在验收后追加票尾；**本票验收 ≠ 整个 P1 验收，P1-15 不自动开始**）
- P1-05 结束基线（upstream 已验收）：产品根 commit `d1c6595`（typecheck 0 errors、64 files/539 tests PASS；已推 GitHub origin main）。**P1-06 共享基线 = 本文件本次更新的 commit**（= d1c6595 + 4 个新契约 + 1 个视图契约 + 2 个 commitKind + 纯函数校验器 + 入口/夹具/套件/重启骨架 + 适配器登记；既有 539 测试零回归——实施前已复跑）。
- **冻结复用、不重写**：P1-00…P1-05 全部契约/夹具/套件/适配器/harness 零修改通过；P1-03 冻结的 TaskLease/TaskAttempt/Run/DispatchOutboxEntry/TaskEnvelope/DispatchIntentV1 形状**不修改**（replacement-claim 只新增 ReplacementAttempt 一个聚合）；P1-05 的 goal-phase/goal-reducer 全部文件不修改（可读对比 `git diff d1c6595..p1-06-int -- src/contracts/goal-phase.ts src/contracts/goal-phase-view.ts src/control/goal-reducer.ts` 为空）。
- **P0-06 复核影响（AGENTS.md 要求，已核对）**：`dev_docs/design/human-framework-role-review.md` 结论与本票无冲突——"某个协调 Run 结束或失败后…新 Run 从状态与有界交接恢复"（= 本票 A→B 换手）；"默认是有界任务、问题、报告、提案和 Handoff；参与者只读取相关上下文"（= HandoffPacket 有界、无 transcript、body-first）；"状态链：工具/Agent 产出 → 框架校验与归约 → 持久状态 → 事实投影"（= run-fact → recordHandoff/claimReplacement → Event → provenance 投影）；"完成权不绑定名称"（B 不因接续而获得完成权——TaskReduction 仍由 P1-04 reducer 归约，本票不写 phase）。本票不做 Goal 归约（P1-05），不做重试/取消（P1-10），不做并行 Reader/唯一 Writer 归约（P1-07），无 Findings/Decision 路径。
- **三个最小 Interface 首次冻结**（DAG interfaces_to_freeze）：`DispatchEngine.HandoffPort`（src/contracts/handoff.ts）、`ContextCompiler.HandoffContextPort`（src/contracts/handoff-context.ts）、`WorkerRuntime.HandoffControlPort`（src/contracts/handoff-control.ts）——已建、版本化（v1）、以契约套件 + 集成接线作为最小 contract test；**三个契约**：HandoffPacket、HandoffContextRequest、ReplacementAttempt（见下方冻结语义与入口表）。

## P1-06 契约与存储语义（冻结）

1. **HandoffPacket 有界形状**：硬上限 `HANDOFF_PACKET_MAX_BYTES = 64KiB`（与 TaskEnvelope 同序；校验器在已知字段检查通过后按 canonical JSON 字节数判 size_exceeded）；必备字段 objective / constraints（≤32）/ completed（≤64，每项 summary ≤4096B + ArtifactRef + EvidenceRefs）/ unresolved（≤64，kind ∈ {missing_material, outcome_unknown, risk, blocked, cancelled, other}）/ evidenceRefs（≤128）/ artifactRefs（≤64）/ workspaceSnapshot / source（runRef(来源 Run) + attemptRef + binding(RoleBindingRefV1) + context(contextBundleRef/contextManifestRef) + runtime(lastEventSeq/terminalEventId/terminalOutcome)）/ bodyRef / taskRevision / planRef / generatedAt。**无 transcript 为显式保证**：schema 无 transcript/思维链字段，且 `validateHandoffPacket` 对**未知顶层字段一律拒绝**（unknown_field——"transcript" 字段直接 invalid），`noFullTranscript: true` 为必填常量字段。**正文先入 ArtifactVault（body-first）**：调用方先 put 正文（ownerRef = 来源 RunRef，沿用 P1-03 open 授权规则），再由 Control.recordHandoff 登记；登记失败只留未采纳 Artifact。**B 的 HandoffContext 从 ledger 的 HandoffPacketSnapshot（有界）取材，不 open A 的 vault 正文**（vault 正文是同有界负载的归档副本）。
2. **ReplacementAttempt**：同一 Task 的**新 Attempt**（新 TaskAttempt@0 + Run@0 + DispatchOutboxEntry@0（intent=DispatchIntentV1，形状不变）+ ReplacementAttempt@0；TaskLease **CAS @N→N+1** 转移 holder 到 B）。**可替换前提（纯函数 evaluateReplacementEligibility，冻结）**：A 的 attempt 已 ended（终端事实/outcome_unknown）**或** A 的 lease 已过期（expiresAt < now）；二者皆否 → `lease_active`（零写入）；无 prior lease → `no_prior_attempt`；packet 未登记 → `packet_not_found`；packet 的 task/planRef/taskRevision 不匹配 → `packet_mismatch`；packet.workspaceRevision ≠ canonical → `stale_packet`（显式，不静默用旧）。结构性规则（goal active/plan accepted/work/disposition/phase/deps/resource）沿用 P1-03 eligibility 语义。**A 的迟到事实**：target A 自己的 ended Run → P1-03 per-run sequence 语义（after_terminal / stale_event / duplicate_event，零写入，**绝不回退**）；B 的 Run/Attempt 是独立聚合，A 的输入在数据结构上不可能接触。**完整幂等**（同 identity+fingerprint → committed/replayed；同 identity 异 fingerprint → idempotency_conflict；异 identity 复用新 attemptId/runId → revision_conflict 零写入）。重试/取消 = P1-10，本票只做"A 结束/故障后 B 接续"。
3. **HandoffContextRequest / Port**：ContextCompiler **版本化扩展**（新文件 src/context/handoff-context-compiler.ts；P1-03 冻结的 assemble(TaskContextRequestV1) **不改写**）。`HandoffContextPort.assemble`（新接口，v1）：request 带 B 的 runRef/attemptRef/roleBinding/declaredPermissions/scope/workspaceSnapshot/budget + **handoffPacketRef**。守卫顺序（全部零写入，除 body-first put）：shape 校验 → packet 存在（packet_not_found）→ packet 与请求同 task/plan（packet_mismatch）→ canonical workspace/plan 解析（缺材料 needs_material）→ **source revision 不匹配 → 显式 stale_workspace_snapshot / stale_packet（绝不静默用旧；调用方重新投影后重试）** → scope ⊆ declared / policyRevision 非空（forbidden_tool_or_scope，旧绑定/越权拒绝）→ 预算/期限（budget_exhausted）→ 组装有界 Bundle（仅取 packet 白名单字段 + 新鲜 plan/workspace 材料摘要；无 transcript）→ body-first vault put（owner=B runRef）→ B 的 TaskEnvelope（**形状冻结复用**，drive/startRun/runtime 路径不变）+ manifest（noFullTranscript: true）。assemble 永不启动 Agent；评审/验证语义 Run 仍走正式 dispatch。
4. **HandoffControlPort**：WorkerRuntime 控制面**最小形状**（v1）：`control({kind:"pause"|"stop", reason, ...})` → accepted(state{status running|paused|stopped, noHiddenContextRead:true}) / rejected(invalid|forbidden|run_not_found|already_stopped)；**无 cancel（P1-10）**；`snapshot(query)` → ready(state + PublicRuntimeReport{lastEventSeq, terminalOutcome, summary, reportRef, noHiddenContextRead:true}) / unsupported / rejected。**只暴露公开报告，拒绝隐藏上下文读取**（noHiddenContextRead 显式字段——RuntimeEvent/manifest 的隐藏部分不进入报告；报告正文 ≤32KiB）。评审/验证语义 Run 仍走正式 dispatch（P1-03 RunPort）；本 port 是控制/快照面。Harness 默认 = src/runtime/handoff-control-adapter.ts（FakeHandoffControlRuntimeAdapter，与 FakeRuntimeAdapter 组合）；契约套件用共享替身 FakeHandoffControlPort。
5. **验证路径可追溯**：reference 链 = HandoffPacket（source.runRef=A、attemptRef=A、evidenceRefs）→ ReplacementAttempt（packetRef + priorRunRef=A + runRef=B）→ B 的 EvidenceAdmitted（source.runRef=B，anchor.planRef/planRevision = 同一 Task revision tuple）。**B 提交后续结果时**，taskVerification 视图同时显示 A/B 两个 Run 来源且同一 anchor tuple（套件断言）；handoffProvenance 时间线显示 packet_recorded → replacement_claimed → evidence_admitted（按事件序，只展示不判定）。**outcome_unknown 在交接与视图保留**（packet unresolved kind=outcome_unknown + provenance.outcomeUnknownPreserved: true），**不自动重试不可逆动作**（套件断言一次替换恰好一条，无额外自动重领）。
6. **事件/视图**：两个新 v1 事件 `HandoffRecorded`（HandoffPacket 聚合创建，aggregateRevision=1——**不进 isActivationEvent**，与本票事件为创建型一致，revision 语义由套件覆盖）+ `ReplacementClaimed`（ReplacementAttempt 聚合，rev=1）；已加入 DomainEvent/KNOWN_EVENT_TYPES（与 P1-05 的 GoalPhaseUpdated 并存，版本化追加）。ReadModel 投影 `handoffProvenance`（key=(projectId, goalId, taskId)；条目 packet_recorded/replacement_claimed/evidence_admitted；freshness 沿用 opaque CommitCursor：not_ready≠not_found；已知 v1 事件无 handler → 仍 unsupported_event_type 整页停止——**KNOWN 列表新增与 isHandledEventType 新增作为同一原子动作**：handler + isHandledEventType 在 lane C 同一 commit 落地）。
7. **重启等价**：handoff-record / replacement-claim 全经 SQLite 单事务（commitKind 各自独立；InMemory/SQLite 共用 ledger-validation 纯校验器）；重启后（close→reopen 同文件、全新实例）HandoffPacket/ReplacementAttempt/TaskLease/B-Run 快照 load 逐字段一致、handoffProvenance 从持久 EventPage 重建逐字段一致、observedCursor 一致（tests/restart/p1-06-*，探针 isP106Ready() 自动启用）。ArtifactVault 正文持久化不在本票——与 P1-03/04 相同只存引用。
8. **边界**：不归约 Goal phase（P1-05）、不写 Task phase（P1-04 reducer 专有）、无 retry/cancel（P1-10）、无 Findings/Decision（P1-11/14）、无并行 Reader 归约（P1-07）；recordHandoff 不 open/不验证 vault 正文内容（只有引用），不做"已保存正文但提交失败"的清理（与 P1-03/04 相同）。

## P1-06 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| handoff 契约/纯函数 | src/contracts/handoff.ts | HandoffPacketV1（有界/noFullTranscript）、HandoffPacketRef/Snapshot、ReplacementAttemptRef/Snapshot、RecordHandoffCommand/Receipt、ClaimReplacementCommand/Receipt、HandoffRecorded/ReplacementClaimed 事件、evaluateReplacementEligibility（纯）、recordHandoffFingerprint/claimReplacementFingerprint、DispatchEngine.HandoffPort（driveHandoff 接口 + 驱动类型） |
| handoff-context 契约 | src/contracts/handoff-context.ts | HandoffContextPort/RequestV1/ResultV1/Manifest（noFullTranscript: true）、拒绝码 |
| handoff-control 契约 | src/contracts/handoff-control.ts | HandoffControlPort/CommandV1/StateV1/SnapshotQuery/PublicRuntimeReportV1（noHiddenContextRead: true）、HANDOFF_CONTROL_MAX_REPORT_BYTES |
| handoff-view 契约 | src/contracts/handoff-view.ts | HandoffProvenanceViewQuery/View/Result、ProvenanceEntry（packet_recorded/replacement_claimed/evidence_admitted）、outcomeUnknownPreserved |
| fixtures | src/contracts/fixtures/handoff-fixtures.ts | P106_PLAN_REVISION_FIXTURE_V1（work task + goal gate；无 dependsOn 于 work）、P106_GOAL/PROJECT/TASK/WORKSPACE、buildHandoffPacketV1/buildRecordHandoffCommand/buildClaimReplacementCommand/buildReplacementClaimLedgerCommit（fold 目标）/p106PlanRef |
| ledger/validation 扩展 | src/contracts/{ledger,ledger-validation,validation,events}.ts、src/contracts/{modules,goal-view}.ts | handoff-record/replacement-claim commitKind + validateHandoffRecordCommit/validateReplacementClaimCommit（双适配器共用）、validateHandoffPacket（严格未知字段+cap）/validateRecordHandoffCommand/validateClaimReplacementCommand/validateHandoffContextRequest/validateHandoffControlCommand/validateHandoffSnapshotQuery + validateDomainEvent 两个分支、DomainEvent/KNOWN + 2 事件、ControlEngine.recordHandoff/claimReplacement、ReadModelIndex.handoffProvenance |
| Control 入口 | src/control/{handoff,replacement-claim,handoff-drive}.ts | recordHandoff/claimReplacement（stub→lane A 填充）；HandoffDriveEngineImpl.driveHandoff（stub→lane A）；control-engine.ts 仅委托；dispatch-engine.ts 增加"替换意图跳过"守卫（P1-06 行为追加，签名不变） |
| Context/控制面 | src/context/handoff-context-compiler.ts、src/runtime/handoff-control-adapter.ts | HandoffContextCompilerImpl.assemble（stub→lane B）；FakeHandoffControlRuntimeAdapter.control/snapshot（stub→lane B） |
| ReadModel | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts | handoffProvenance（stub→lane C；handler + isHandledEventType 同 commit） |
| harness | src/harness/{in-memory,persistent}-harness.ts | handoffContext/handoffControl/handoffDrive 默认接线 + recordHandoff/claimReplacement/handoffProvenance/assembleHandoff 直通；options {handoffContext?, handoffControl?} |
| 契约套件 | tests/contract-suite/{p1-06-harness,handoff.contract.suite}.ts | P1_06TestHarness/FACTORY、prepareP106Scenario、toP1_06Harness、defineHandoffContractSuite（InMemory+SQLite 同套件；10 组：packet 有界/record/纯 eligibility/claim 生命周期/迟到拒绝/context 组装/完整恢复/outcome_unknown/可追溯/控制面） |
| 重启骨架 | tests/restart/p1-06-restart-fixtures.ts、p1-06-restart.test.ts、evidence/p1-06-evidence.test.ts | isP106Ready() 探针；实现落地后自动启用 |
| 集成接线 | tests/integration/p1-06.contract-suite.inmemory|sqlite.test.ts、p1-06.integration.test.ts | 双适配器套件接线（skipIf 探针）+ 真实 SQLite 全路径 + 重启等价 |

## 三路并行（P1-06，隔离 worktree → main 合并；从本基线 commit 派生）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A HandoffPacket + ReplacementAttempt（Control/Process 面） | p1-06-lane-a | recordHandoff/claimReplacement 完整实现（守卫→fold→commit→map；run_not_ended/stale_source/lease_active/packet_* /CAS/幂等零写入）+ HandoffDriveEngineImpl.driveHandoff（替换意图：assemble→startRun→runtime→runFact；outbox 先于副作用） | src/control/handoff.ts、src/control/replacement-claim.ts、src/control/handoff-drive.ts、tests/control/handoff.test.ts、tests/control/replacement-claim.test.ts、tests/control/handoff-drive.test.ts | 🔄 进行中 |
| B HandoffContext + HandoffControl | p1-06-lane-b | HandoffContextCompilerImpl.assemble 完整实现（守卫序/stale 显式/越权/Budget/有界 Bundle body-first/无 transcript）+ FakeHandoffControlRuntimeAdapter（pause/stop + 公开快照） | src/context/handoff-context-compiler.ts、src/runtime/handoff-control-adapter.ts、tests/context/handoff-context-compiler.test.ts、tests/runtime/handoff-control-adapter.test.ts | 🔄 进行中 |
| C ReadModel provenance + 重启证据 | p1-06-lane-c | HandoffRecorded/ReplacementClaimed/EvidenceAdmitted 双适配器投影 + handoffProvenance（重建等价/全键隔离/freshness）+ isHandledEventType 与 handler 同 commit + 重启证据硬化 | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts、tests/read-model/p1-06-handoff-projection.test.ts、tests/sqlite-read-model/p1-06-handoff-projection.test.ts、tests/restart/p1-06-*.ts | 🔄 进行中 |

integrator 维护：package/lock/tsconfig/vitest、`src/contracts/**`（公共 schema/接口/共享 fixture）、`src/ledger/**`、`src/sqlite-ledger/**`、`src/control/control-engine.ts`、`src/harness/**`、`tests/contract-suite/**`、`tests/integration/**`、文档与状态记录。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结签名、**不得修改 P1-05 文件**（如有缺口：提交具体建议给 integrator 统一修改基线并通知消费者）。子 Agent 从实际读文件开始，不等待派发者；允许测试命令：`pnpm vitest run <自身路径>`、`pnpm typecheck`。

## P1-06 已执行命令及结果（共享基线）

| 命令（product root worktree） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS 0 errors（含全部新契约/夹具/套件/入口/接线骨架） |
| `pnpm vitest run`（全量，基线） | **64 files / 539 tests PASS（P1-05 零漂移）+ 53 新测试 skipIf 探针自动跳过**（实现未落地，预期；明细见 p1-06-implementation-evidence.md 验收节） |
| 只读零漂移比对 | `git diff d1c6595..p1-06-int -- src/contracts/goal-phase.ts src/contracts/goal-phase-view.ts src/control/goal-reducer.ts` 为空；`git diff d1c6595..p1-06-int` 仅含 P1-06 追加（10 文件：4 新契约 + events/ledger/validation/ledger-validation + 两适配器 22 行登记 + 后续套件/接线） |

---

## P1-05 历史记录（已完成，保留备查；P1-06 在其上实施，P1-05 原文自下一标题起未改动）


## P1-05 当前票据与共享契约基线

- Ticket：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/05-goal-phase-reduction.md`（P1-05，status 按阶段守卫保持 `proposed`；有限授权与 Implementation record 将在验收后追加票尾；**本票验收 ≠ 整个 P1 验收，P1-07/08 不自动开始**）
- P1-04 结束基线（upstream 已验收）：产品根 commit `5a278cb`（typecheck 0 errors、55 files/486 tests PASS、P1-04 双契约套件 InMemory 18/18 + SQLite 18/18（同一套件定义、无调参）、真实 SQLite 集成 2/2、重启证据 1/1、validate-docs 12/12；已推 GitHub origin main）。**P1-05 共享基线 = 产品根 commit `3256167`**（= 5a278cb + 5 个新契约 + 1 个视图契约 + goal-reduction commitKind + 纯函数 + 入口/夹具/套件/重启骨架；既有 486 测试零回归——实施前已复跑 505 PASS 含 19 个新的 pure reducer 测试）。
- **冻结复用、不重写**：P1-00…P1-04 全部契约/夹具/套件/适配器/harness 零修改通过；P1-04 共享契约套件 + InMemory/SQLite 双 Adapter、in-memory/persistent 双 harness、重启证据、隔离 worktree→main 合并模式全部复用。
- **P0-06 复核影响（AGENTS.md 要求，已核对）**：`dev_docs/design/human-framework-role-review.md` 结论与本票无冲突——"状态链：工具/Agent 产出 → 框架校验与归约 → 持久状态 → 事实投影 → 图形与解释 → 人"（= evidence → TaskReduction → GoalPhase → EventPage → goalStatus/解释）；"控制：schema、权限、幂等、版本与转换规则校验；不重复写入，不以 claim 直接完成"（= 本票全部规则）；"ModuleProgress/StageProgress 是投影，不是 reducer 输入"（§7 已按此执行，防投影回环）；"完成权不绑定名称"（Worker/Reviewer/ReadModel 均不写 Goal phase，只有 Control reduceGoal 归约）。本票不做换手（P1-06）、并行 Reader/唯一 Writer（P1-07）、只读控制台（P1-08）、计划变更/Decision（P1-11/14）；副作用只识别+阻断。
- **三个最小 Interface/契约首次冻结**（DAG interfaces_to_freeze 规则——本票未列出，按"首个真实消费者应显式冻结并记录"执行）：GoalPhase 聚合面（goal-phase.ts，含纯函数 reduceGoalPhase + GoalCompletionGuard + 确定性 explanation 模板）、GoalStatus/Timeline 视图面（goal-phase-view.ts）、ControlEngine.reduceGoal（modules.ts 版本化新增）。dependencies 记录：结算完成策略 §3/§8/§9 为唯一语义来源；若接口文档与票据 Acceptance 冲突——以票据 Acceptance 为准（本屏未发现冲突；已按此原则冻结 wire 字段为可执行契约）。

## P1-05 契约与存储语义（冻结）

1. **Goal phase 存储**：新增 `goal-reduction` commitKind（schemaVersion 1、project-scoped CommandIdentity、`outboxIntents: []`）与 **GoalPhase 聚合**（ref=(projectId, goalId)，与 TaskReduction 对称：保留完整阶段历史）——CAS（`[GoalPhase@(revision-1)]`）、**完整幂等**（同 identity+fingerprint → committed(replayed)，绝不追加；同 identity 异 fingerprint → idempotency_conflict；异 identity 复用 goalId → revision_conflict）、所有拒绝零写入；沿用 P1-00/02/03/04 版本化先例，既有 v1 语义不变（506 基线测试零回归已验证）。**新聚合**理由：与 TaskReduction 对称、保留阶段历史、不动 P1-00/02 冻结的 Goal 快照形状。
2. **四契约**（src/contracts/goal-phase.ts）：`GoalReductionInput`（事实快照：plan 快照或 null、goalActivePlanRevision、desiredState、全部 required/optional TaskReduction 事实（含 planPhase/reductionPhase/effectiveEvidenceIds/runFact）、义务级证据集摘要（required VR/covered/blocking/historicalFail/stale/outOfScope）、副作用、需要人裁决信号（decisions/decisionNeeds/changePending/planning——P1-05 恒空，形状为 P1-11/14 冻结））、`GoalPhase`（封闭 10 值枚举，与 §9 一一对应）、`GoalCompletionExplanation`（schemaVersion 1：phase + headline + items[{code, message, refs}]）、`SideEffectReconciliation`（identify=输入列表、unreconciled 阻断完成；**不做处置**——P1-05 无 disposal 路径，所有 fact reconciled 恒 false）。schemaVersion 1；未知版本拒绝（validation.ts），不静默跳过。
3. **纯函数 `reduceGoalPhase(input)`**（冻结的 10 级表驱动优先级：CANCELLED > CHANGE_PENDING > PAUSED > COMPLETED > ACCEPTED_PARTIAL > PLANNING > RUNNING > NEEDS_DECISION > BLOCKED > FAILED；每种返回恰一个 primary phase；较低优先级命中事实仍作为 attention flags 进入 reasonCodes）：§3 规则（空 Plan/空 required GoalGateTask/空 obligation/空 VR 不能证明完成，fail-closed 进 FAILED；optional 不阻止完成；required 的 deferred/cancelled/blocked/failed 不伪装成完成）；GoalCompletionGuard（§8 公式 = active PlanRevision 非空约束全过 + 全部 required work Task SATISFIED + 全部 required AcceptanceObligation satisfied + 全部 required Module/StageGate SATISFIED + required GoalGate 非空且全 SATISFIED + 无未对账副作用；COMPLETED 只能来自该公式）；parent_of/Module/Stage/完成比例不改 required 集合；no-change 只能由带当前 PASS Evidence 的 AlreadySatisfied required GoalGateTask 表达（空 required goal-gate 集合 → guard 失败，applyPlan 也拒绝缺 active required GoalGate 的 Plan）；输入来源可替换（本轮=plan 枚举+点查，将来=摘要提供者——GoalReductionInput 即 T07 增量优化预留接口）。
4. **判定与解释分离**：`reduceGoalPhase` 产出 (phase, reasonCodes[], refsByCode, guard, sideEffectReconciliation)；`renderGoalCompletionExplanation` 由 reasonCode **确定性模板**渲染（可重放/可比较/可穷举；模板表在 goal-phase.ts REASON_TEMPLATES + refSuffix 确定性 refs 拼接）；语义叙述留 T15。
5. **事件与视图**：`GoalPhaseUpdatedEvent`（每归约一个；payload=goalId + previousPhase + phase + reasonCodes + explanation + sideEffectReconciliation + planRef + reducedAt；aggregateRevision=GoalPhase revision，单调 k）；ReadModel 投影 `goalStatus`（key=(projectId, goalId)，ready.goal… 注意字段名是 `goal` 不是 `status`）+ `goalTimeline`（ordered entries；每 event 一条）；freshness 沿用 opaque CommitCursor（not_ready≠not_found；无 atLeastCursor 且无行 → not_ready）；**ModuleProgress/StageProgress 只投影，绝不作为 reducer 输入**（防投影回环）；已知 v1 事件无 handler → 仍 unsupported_event_type 整页停止。
6. **重启等价**：goal-reduction 单事务；重启后 GoalPhase 快照 load 一致 + goalStatus/goalTimeline 从持久 EventPage 重建逐字段一致 + observedCursor 一致；重放相同事实 → 相同 phase 与解释（tests/restart/p1-05-*，探针 isP105Ready() 自动启用）。
7. **边界**：不做并行 Reader/唯一 Writer（P1-07）、只读控制台（P1-08）、换手（P1-06）、计划变更/Decision（P1-11/14）；副作用只识别+阻断；P1-05 不加裁决机制；**不写 Task phase/Goal 快照**——GoalPhase 是唯一 phase 面（Worker/Reviewer/ReadModel 均不写；taskDetail.phase 保持计划值）。

## P1-05 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| goal-phase 契约/纯函数 | src/contracts/goal-phase.ts | GoalReductionInput/GoalPhase/GoalCompletionExplanation/SideEffectReconciliation、reduceGoalPhase（纯）、evaluateGoalCompletionGuard、reconcileGoalSideEffects、renderGoalCompletionExplanation、GoalPhaseSnapshot/GoalPhaseUpdatedEvent、ReduceGoalCommand/Receipt、reduceGoalFingerprint |
| 视图契约 | src/contracts/goal-phase-view.ts | GoalStatusQuery/GoalStatusView/Result（ready.goal）、GoalTimelineQuery/Entry/Result |
| fixtures | src/contracts/fixtures/goal-phase-fixtures.ts | P105_PLAN_REVISION_FIXTURE_V1（plan-goal-mvp：work+Module/Stage/Goal gate+optional；parentOf；无 dependsOn）、buildReduceGoalCommand/buildGoalPhaseSnapshot/buildGoalReductionLedgerCommit |
| ledger/validation 扩展 | src/contracts/{ledger,ledger-validation,validation,events,modules}.ts | goal-reduction commitKind + validateGoalReductionCommit（双适配器共用）、validateReduceGoalCommand、validateDomainEvent GoalPhaseUpdated 分支 + isActivationEvent、DomainEvent/KNOWN_EVENT_TYPES + GoalPhaseUpdated、ControlEngine.reduceGoal |
| Control 入口 | src/control/goal-reducer.ts | reduceGoal(deps,cmd)（stub→lane A 填充）；buildGoalReductionInput（stub→lane A）；commitGoalReduction/mapReduceGoalReceipt/previousGoalPhase/isGoalPhaseSnapshot（已实现）；control-engine.ts 仅委托 |
| ReadModel | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts | goalStatus/goalTimeline（stub→lane B 填充；isHandledEventType + GoalPhaseUpdated handler 同 lane B） |
| harness | src/harness/{in-memory,persistent}-harness.ts | reduceGoal/goalStatus/goalTimeline 直通（已接线）；options 无新增 |
| 契约套件 | tests/contract-suite/{p1-05-harness,goal-phase.contract.suite}.ts | P1_05TestHarness/FACTORY、prepareP105Scenario、satisfyEverythingP105、defineGoalReductionContractSuite（InMemory+SQLite 同套件） |
| 重启骨架 | tests/restart/p1-05-restart-fixtures.ts、p1-05-restart.test.ts、evidence/p1-05-evidence.test.ts | isP105Ready() 探针；实现落地后自动启用（lane C 硬化） |
| 集成接线 | tests/integration/p1-05.contract-suite.inmemory|sqlite.test.ts、p1-05.integration.test.ts | 双适配器套件接线 + 真实 SQLite 全路径（skipIf 探针） |

## 三路并行（P1-05，隔离 worktree → main 合并；从基线 3256167 派生）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A goal reducer | `p1-05-lane-a` @ /home/han001/projects/agents/agent_platform-p1-05-a | reduceGoalImpl 完整实现（schema→goal/plan 解析→事实收集（TaskReduction/证据集/runFact/副作用/obligation 摘要）→纯 reduceGoalPhase→单事务提交→map）；只对 required 集合归约，绝不写 Task phase/投影 | src/control/goal-reducer.ts、tests/control/goal-reducer.test.ts | ✅ 6/6（commit 36c144c；subagent 失败后 integrator 接管完成；主分支 8a7da9c 已合并） |
| B 视图+事件 | `p1-05-lane-b` @ /home/han001/projects/agents/agent_platform-p1-05-b | GoalPhaseUpdated 投影（goalStatus+goalTimeline）InMemory+SQLite 双适配器、重建等价、全键隔离、freshness；绝不把投影当 reducer 输入 | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts、tests/read-model/p1-05-goal-phase-projection.test.ts、tests/sqlite-read-model/p1-05-goal-phase-projection.test.ts | ✅ 7/7（commit faa97e2；subagent 失败后 integrator 接管完成；主分支 746dfc6 已合并） |
| C 重启证据+集成骨架 | `p1-05-lane-c` @ /home/han001/projects/agents/agent_platform-p1-05-c | 重启路径硬化（同事实重放→同 phase/解释；GoalPhase 快照/视图逐字段一致）、证据收集、集成骨架 | tests/restart/p1-05-*.ts、tests/restart/evidence/p1-05-evidence.test.ts、tests/integration/p1-05.integration.test.ts | ✅ 无改动（integrator 已写骨架；重启 1/1 + 证据 1/1 + 集成 1/1 全部通过——探针自动启用即验证） |

integrator 维护：package/lock/tsconfig/vitest、`src/contracts/**`（公共 schema/接口/共享 fixture）、`src/ledger/**`、`src/sqlite-ledger/**`、`src/control/control-engine.ts`、`src/harness/**`、`tests/contract-suite/**`、`tests/integration/**`、文档与状态记录。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结签名（如有缺口：提交具体建议给 integrator 统一修改基线并通知消费者）。子 Agent 从实际读文件开始，不等待派发者；允许测试命令：`pnpm vitest run <自身路径>`、`pnpm typecheck`。

## P1-05 已执行命令及结果（最终）

| 命令（product root） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS 0 errors（全部契约/夹具/套件/双适配器实现） |
| `pnpm vitest run`（全量，最终） | **64 files / 539 tests PASS**（P1-00…04 基线 486 零回归 + P1-05 新增 53：19 纯 reducer + 双套件 8×2 + 6 lane A + 7 lane B + 2 隔离用例 + 重启 1 + 证据 1 + 集成 1；明细见 p1-05-implementation-evidence.md） |
| `pnpm vitest run tests/integration/p1-05.contract-suite.inmemory.test.ts` | 8/8 PASS |
| `pnpm vitest run tests/integration/p1-05.contract-suite.sqlite.test.ts` | 8/8 PASS（**同一套件定义，无调参**） |
| `pnpm vitest run tests/integration/p1-04.contract-suite.inmemory.test.ts tests/integration/p1-04.contract-suite.sqlite.test.ts` | 18/18 × 2 = 36 PASS（P1-04 套件零回归） |
| `pnpm vitest run tests/integration/p1-05.integration.test.ts` | 1/1 PASS（真实 SQLite：完整路径 + 重启等价） |
| `pnpm vitest run tests/restart/p1-05-restart.test.ts` | 1/1 PASS（探针自动启用；GoalPhase 快照/视图逐字段一致） |
| `pnpm vitest run tests/restart/evidence/p1-05-evidence.test.ts` | 1/1 PASS（P1-05-EVIDENCE JSON 证据块，可重复） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 PASS |

**integrator 裁决记录**：三路子 Agent 均在执行中因基础设施故障中断（未产出、未 commit；B 在内存适配器完成后中断）；用户随后要求三方以独立验收者身份复跑——A/B/C 验收结论均 PASS，其中 **B 发现的真实偏差已修复**（goalStatus/goalTimeline 无 atLeastCursor 缺失键改回 freshness-safe not_ready，not_found 仅在提供且已覆盖 atLeastCursor 时；双适配器 + 套件 + 新增两 Project 同 goalId 真隔离用例；最终全量 539/539）。按 P1-04 先例由 integrator 接管实现（A/B 在各自 worktree 内完成并以 lane commit 合并；C 的骨架由 integrator 编写、无改动）。共享 helper 修正在 main（satisfyEverythingP105 在 outcome_unknown 时断言 work=verifying）。**P1-06 合并面**：并行 session（已暂停）的 worktree `agent_platform-p1-06`（branch `p1-06-int`，未 commit）在 events.ts/ledger.ts/validation.ts 上与 P1-05 同区修改——P1-06 恢复后合入 main 时按'双方皆保留、版本化追加'机械解决该三处冲突；其 typecheck 红（in-memory/sqlite ledger 未加 handoff-record/replacement-claim case）属 Phase 1 未完成态。

---
## P1-04 当前票据与共享契约基线

- Ticket：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md`（P1-04，status 按阶段守卫保持 `proposed`；有限授权与 Implementation record 将在验收后追加票尾；**不把本票记成 P1 已验收，不自动推进 P1-05/06**）
- 上游验收证据（仅证明各自票据）：`dev_docs/verification/p1-00|p1-01|p1-02|p1-03-implementation-evidence.md`；P1-03 结束基线 = 产品根 commit `9722e14`（typecheck 0 errors、44 files/395 tests PASS、P1-03 双套件 15/15 + 集成 2/2 + 重启证据 1/1、validate-docs 12/12）。**P1-04 共享基线 = 本文件首次更新的 commit**（在 `9722e14` 之上：7 个新契约 + 2 个接口冻结 + 入口/夹具/套件骨架；既有 395 测试零回归——实施前已复跑）。
- **冻结复用、不重写**：P1-00…P1-03 全部契约/夹具/套件/适配器/harness（既有测试零修改通过）；`ContextCompilerImpl.assemble(TaskContextRequestV1)` P1-03 冻结签名**不改写**（P1-04 的 ReviewContextPort 是**版本化扩展**，独立文件）。
- **P0-06 复核影响（AGENTS.md 要求，已核对）**：`dev_docs/design/human-framework-role-review.md` 结论与本票无冲突——"框架依证据规则接受结果，集成者同意不单独构成完成条件"（Acceptance 7）、"控制：schema、权限、幂等、版本与转换规则校验；接入静态/运行/语义证据；不重复写入，不以 claim 直接完成"（= 本票全部规则）、"状态链：工具/Agent 产出 → 框架校验与归约 → 持久状态 → 事实投影"（= evidence-intake → reducer → Event → ReadModel）。本票不归约 Goal（P1-05）、不做换手（P1-06）、无用户 Decision 路径；doc 与票据 Acceptance 无冲突，差异以票据 Acceptance 为准（本屏已按此原则冻结 runtime-collaboration/completion-policy 尚未冻结的 wire 字段为可执行契约）。
- **两个最小 Interface 首次冻结**（DAG interfaces_to_freeze）：`VerificationEngine.VerificationPort`（src/contracts/verification.ts）、`ContextCompiler.ReviewContextPort`（src/contracts/review-context.ts）——已建、版本化（v1）、以契约套件 + 集成接线作为最小 contract test；**七个契约**：CompletionClaim（EvidenceV1 kind=claim）、VerificationPlan、Evidence、EvidenceBinding、EffectiveEvidenceSet、ReviewPacket、VerificationResult（见下方冻结语义与入口表）。

## P1-04 契约与存储语义（冻结）

1. **LedgerCommit 扩展方式**：新增两个 commitKind（`evidence-intake` / `verification-result`），schemaVersion 1、project-scoped CommandIdentity、`outboxIntents: []`；沿用 P1-00/02/03 版本化先例，既有 v1 语义不变（395 测试零回归）。**Evidence/TaskEvidenceIndex/TaskReduction 三个新聚合**（完整 ref：EvidenceRef=(projectId,evidenceId)、TaskEvidenceIndexRef/TaskReductionRef=(projectId,goalId,taskId)）。
2. **Evidence 不可变追加**：EvidenceSnapshot 创建即 revision 1，永不改写（改写路径不存在；同 evidenceId 异 identity 的再次提交 = CAS revision_conflict 零写入）。**Evidence 与 binding 锚原子提交**：evidence-intake 单事务携带 [Evidence@0 + TaskEvidenceIndex@(count-1)]；事件 EvidenceAdmitted 是唯一展示/重建来源。TaskEvidenceIndex 按 admission 顺序记录 evidenceIds（revision == count；上限 MAX_EVIDENCE_PER_TASK=512，超出 evidence_limit_exceeded 零写入）。
3. **claim/observation/verdict** 为三种证据 kind：**claim 强制 outcome=INCONCLUSIVE**（自报 ≠ PASS；validator + commit validator 双重强制）；observation/verdict 可为 PASS/FAIL/INCONCLUSIVE；claim/verdict **必须有来源 Run**（正式 dispatch Run 的报告），system/机械 observation 允许 runRef=null（如 Gate 的系统静态检查）。**正文先入 ArtifactVault（body-first）**，Evidence 只保留 ArtifactRef + 有界 summary（≤ EVIDENCE_SUMMARY_MAX_BYTES=4096）；登记失败只留未被采纳的 Artifact。
4. **幂等与 CAS**：claim/verdict/observation 命令**完整幂等**（同 identity+fingerprint → committed(replayed)，绝不重复追加；同 identity 异 fingerprint → idempotency_conflict；异 identity 使用已存在 evidenceId → revision_conflict）。**不要把 P1-03 run-fact 的"无幂等记录"语义复制到 evidence**。reduction 命令同样完整幂等（同 identity+fingerprint 重放；每次归约使用独立 idempotencyKey——P1-00 幂等键纪律）。
5. **EffectivityAnchor = revision tuple**：{planRef, planRevision, workspaceRevision, pinnedCompletionPolicy, pinnedArchitectureBaseline}；**verificationPlanRef 是审计关联，不参与 applicability 判定**（同修订下每次 claim 的 changeScope/检查集不同而 plan digest 不同——属正常可适用证据）。锚随证据不可变；**applicability（APPLICABLE/STALE/OUT_OF_SCOPE）永远是纯函数重算值**（evidenceApplicability/binding 派生），**绝不写回历史**。
6. **applicability 规则（纯函数，冻结）**：① 证据主题任务或覆盖的义务/VR 不在当前计划的该任务集合 → OUT_OF_SCOPE；② anchor.planRef ≠ 当前 planRef → OUT_OF_SCOPE；③ planRef 相同但任一 revision 分量不同（planRevision/workspaceRevision/pins）→ STALE（曾适用，现状已改）；④ 否则 APPLICABLE。旧/迟到来源的证据**可被登记**（报告是事实），但永不错误满足——它的 applicability 决定一切。**摄入只拒绝“硬悬空”（不存在的 obligation/VR）**；已存在但未映射到主体任务的 coverage 一律登记，由纯函数派生 OUT_OF_SCOPE（用户裁决，与“记忆=检索推荐”架构一致；摄入期范围拒绝作为 MVP 后优化——见本文件 P1-04 证据文档裁决记录）。
7. **EffectiveEvidenceSet（纯函数，冻结）**：需求键（obligationId, requirementId）上取 APPLICABLE 且未被合法 supersede 的 PASS；**合法 supersede = 同一 (task, obligation, requirement) + 同一 revision tuple + 更新 admission 的 APPLICABLE PASS**——新 PASS 进入当前有效集，旧 FAIL 永远保留可审计；无更新 PASS 覆盖的 APPLICABLE FAIL/INCONCLUSIVE 阻断该需求（blockingByRequirement）。**claim 是中性声明**：不覆盖、不阻断（claim 只证明"报告了某事"）。
8. **VerificationPlan 编译 = 确定性纯函数**（compileVerificationPlan，内容寻址 planId==planDigest==JCS+SHA-256(输入元组)，无时间戳/无模型调用）：输入 = 任务契约（plan snapshot）+ workspaceRevision + pins + changeScope + semanticChange + risks + 可用检查 ∩ policy.requirementKinds；**缺 pin（快照无有效 pin）→ missing_pin；悬空/未知检查 → unknown_check；policy kinds 无检查覆盖 → no_check_coverage；任务无 required VR → invalid**——确定性失败，**绝不内置默认**。**reviewer 层**：satisfactionPath=「review-packet」除非（semanticChange==none **且** versioned policy 的 fastPathDiffClasses 显式包含 diffClass）→「no-change-fast-path」（checkId=no-change-fast-path，noChangeFastPath 记录 diffClass+reason——**快放证据显式，不得以"看起来没变"当证明**；无语义变化但策略不允许 → 仍 review-packet，不偷偷快放）。
9. **TaskSatisfied 归约（纯函数 reduceTaskVerification，冻结公式）**：任务 ∈ 当前 active PlanRevision 且 disposition=active 且全部 required obligation 的 required VR 被当前 EffectiveEvidenceSet 的 APPLICABLE PASS 覆盖且无可阻断 Applicable FAIL/INCONCLUSIVE 且无未处置 Finding（P1-04 恒空，公式保留）且无未对账 outcome_unknown/高风险副作用 → SATISFIED；否则：阻断 FAIL/INCONCLUSIVE 或 run crashed/exit≠0 → failed（返工）；缺输入（required VR 无任何 Applicable 证据且无历史覆盖）→ blocked；存在 stale/out-of-score 证据或其它未齐 → verifying（binding 显示 STALE；exit=0/claim/verdict 各自单独永不满足——claim 中性、exit=0 中性信号、verdict 只是集合一员）。**Control 归约入口是唯一写 phase 者**（TaskReduction 聚合；写不了 Task 快照/Goal phase——Goal 归约属于 P1-05）。
10. **ReviewPacket 有界**：ReviewContextRequestV1 → assemble → ready(packet+bundleRef+manifest)/needs_material/rejected；ReviewPacket 硬度上限：材料数 ≤ REVIEW_PACKET_MAX_MATERIALS=8、每材料 summary ≤ REVIEW_SUMMARY_MAX_BYTES=4096、packet canonical ≤ REVIEW_PACKET_MAX_BYTES=32KiB、**无完整 transcript**（total.noFullTranscript=true）；正文 bundle 先入 ArtifactVault（body-first）；越权（scope ⊄ declared）、旧 workspace/pin、超预算、超界、semanticChange==none（not_semantic_change——无变化走快放，不给 review packet）→ 结构化拒绝，零写入（除 body-first put）。assemble 永不启动 Reviewer/模型；**评审工作 = 正式 dispatch Run**（P1-03 FakeRuntime 路径），ReviewerPort 只冻结能力替身（mode=dispatch-run、maxPacketBytes=REVIEWER_MAX_PACKET_BYTES、noFullTranscript=true）。
11. **ReadModel**：taskVerification 视图（key=(projectId, goalId, taskId)）只从 EvidenceAdmitted/TaskReductionUpdated 事件重建：evidence（admission 序）+ 每条 EvidenceBindingView（applicability 由纯函数按视图 currentAnchor 重算；currentAnchor 来自最新 TaskReduction 快照——事件重建权威；无归约前为 null）+ effectiveEvidenceIds/blockingEvidenceIds + reduction（phase/causes/planRef/…）。**展示层绝不把报告文字投影为正式完成状态**；TaskDetailView（P1-02 冻结形状）不变（其 phase 仍为计划值；正式归约结果只在 verification 面显示，后续 UI 整合票消费）。freshness 沿用 opaque CommitCursor（not_ready≠not_found）；已知 v1 事件无 handler → unsupported_event_type 整页停止。
12. **重启等价**：evidence-intake/verification-result 全部经 SQLite 单事务；restart（close→reopen 同文件、全新实例）后 Evidence/TaskEvidenceIndex/TaskReduction 快照 load 逐字段一致、taskVerification 从持久 EventPage 重建逐字段一致、observedCursor 一致（tests/restart/p1-04-*，探针自动启用）。（ArtifactVault 正文持久化不在本票——与 P1-03 相同只存引用。）
13. **边界**：不归约 Goal phase（P1-05 的 Goal reducer 与 10 级优先级）、不做换手（P1-06）、无用户 Decision 路径、无 Findings 机制（公式以空输入显式表示）、无重试/取消（P1-10）。P1-04 计划夹具（plan-evidence-mvp）**不给可派发任务加 dependsOn 边**：P1-03 冻结的 eligibility 从计划快照 phase（静态）读依赖满足，DAG 排序派发需后续调度票；Gate 保留 DAG 边（gate 不被派发）。
14. **事务/命令路径**：claim → start → runFacts（P1-03 原路径）；verify(只读编译+检查运行，绝不写 ledger) → body-first 证据材料入 vault → submitEvidence(evidence-intake 单事务) → reduceTask(verification-result 单事务) → advanceProjection；单线程驱动 + CAS 保证唯一 Writer。

## P1-04 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| evidence 契约/夹具 | src/contracts/evidence.ts、fixtures/evidence-fixtures.ts | EvidenceV1/EffectivityAnchorV1/Binding/EffectiveEvidenceSet、SubmitEvidenceCommand/Receipt、fingerprint、EvidenceAdmittedEvent、evidenceApplicability/selectEffectiveEvidenceSet 纯函数、P104_PLAN_REVISION_FIXTURE_V1、COMPLETION_POLICY_FASTPATH_FIXTURE_V1、buildEvidenceIntakeLedgerCommit 等 fold 目标 |
| verification 契约 | src/contracts/verification.ts | VerificationPort/VerificationRequest/Result、VerificationPlanV1、compileVerificationPlan（纯函数）、CheckPort/CheckContext/CheckOutcome、ReviewerPort/ReviewerCapabilities、ChangeScope/Risk/SemanticChangeClassification |
| reduction 契约 | src/contracts/reduction.ts | TaskReductionRef/Snapshot、reduceTaskVerification（纯函数 TaskSatisfied）、ReduceTaskCommand/Receipt、fingerprint、TaskReductionUpdatedEvent |
| review-context 契约 | src/contracts/review-context.ts | ReviewContextPort/Request/Result、ReviewPacketV1（有界）、ReviewManifestV1 |
| verification-view 契约 | src/contracts/verification-view.ts | TaskVerificationViewQuery/View/Result、EvidenceBindingView |
| ledger/validation 扩展 | src/contracts/ledger.ts、ledger-validation.ts、validation.ts、events.ts、governance.ts、modules.ts | 2 个 commitKind 与纯 validator（双适配器共用）、validateSubmitEvidence/ReduceTaskCommand、validateDomainEvent 新事件分支、CompletionPolicyContentV1.fastPathDiffClasses（可选新增，既有 fixture digest 不变）、ControlEngine.submitEvidence/reduceTask |
| Control 入口 | src/control/evidence-intake.ts、task-reducer.ts | submitEvidence(deps,cmd)/reduceTask(deps,cmd)（stub→lane A 填充）；mapEvidenceIntakeReceipt/mapReduceTaskReceipt/buildCurrentEffectivityAnchor（已实现）；control-engine.ts 仅委托 |
| VerificationEngine | src/verification/verification-engine.ts | VerificationEngineImpl(deps, checkPorts, reviewer).verify（stub→lane B 填充）；createVerificationEngine |
| ReviewContext | src/context/review-context-compiler.ts | ReviewContextCompilerImpl(deps)。assemble（stub→lane C 填充）；ContextCompilerImpl 不改 |
| harness | src/harness/{in-memory,persistent}-harness.ts | 默认接线 VerificationEngineImpl(确定性 check providers)+ReviewContextCompilerImpl；submitEvidence/reduceTask/taskVerification/assembleReview 直通；options {checkPorts?, reviewer?, verification?, reviewContext?} |
| 测试替身 | src/contracts/testing/check-providers.double.ts | DeterministicStatic/DynamicCheckProvider（结果按 diffClass 表驱动）、DETERMINISTIC_CHECK_PROVIDERS、FakeReviewerPort/FAKE_REVIEWER_PORT |
| 契约套件 | tests/contract-suite/{p1-04-harness,evidence.contract.suite,verification.contract.suite}.ts | P1_04TestHarness/FACTORY、prepareP104Scenario、defineEvidenceContractSuite/defineVerificationContractSuite（InMemory+SQLite 同套件） |
| 重启骨架 | tests/restart/p1-04-restart-fixtures.ts、p1-04-restart.test.ts、evidence/p1-04-evidence.test.ts | isP104Ready() 探针；实现落地后自动启用 |
| 集成接线 | tests/integration/p1-04.contract-suite.inmemory|sqlite.test.ts、p1-04.integration.test.ts | 双适配器套件接线 + 真实 SQLite 全路径（T1 验收 8 项 + T2 不可独立满足） |

## 四路并行（P1-04，隔离 worktree → main 合并；从本基线 commit 派生）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A evidence intake + reducer | [p1-04-lane-a] @ f10b4de | submitEvidence/reduceTask 完整实现（guard 1-6；Evidence 不可变/CAS/完整幂等/零写入；Worker 不写 phase；outcome_unknown 副作用映射裁决） | src/control/evidence-intake.ts、src/control/task-reducer.ts、tests/control/evidence-intake.test.ts、tests/control/task-reducer.test.ts | ✅ 20/20（主分支 2db3df5 已合并；契约套件自证） |
| B VerificationEngine | `p1-04-lane-b`（从本基线派生） | verify() 完整实现：goal/workspace/plan/pins/policy 解析→纯 compileVerificationPlan→仅 predicate 检查（reviewer 绝不执行）→observations；拒绝表 not_found/dangling_ref/unknown_check/no_check_coverage/budget_exhausted；绝不写 ledger | src/verification/verification-engine.ts、tests/verification/verification-engine.test.ts | ✅ 10/10（commit 9a1adc9；主分支 a6e1e31 已合并；契约套件 verify 断言自证） |
| C ReviewContext + ReviewerPort | `p1-04-lane-c`（从本基线派生） | assemble 完整实现：有界 ReviewPacket（材料/摘要/字节上限、noFullTranscript）、body-first vault put、确定性拒绝（旧 pin out_of_scope/forbidden/stale workspace/budget/not_semantic/超界）零写入；ReviewerPort 用共享替身 | src/context/review-context-compiler.ts、tests/context/review-context-compiler.test.ts | ✅ 4/4（commit e804da3 由 integrator 接管；主分支 f345f4c 已合并；双适配器 ReviewContext 套件 2/2 PASS） |
| D ReadModel 投影 + 重启证据 | [p1-04-lane-d] @ a18e1ad | EvidenceAdmitted/TaskReductionUpdated 双适配器投影 + taskVerification（事件重建等价/全键隔离/not_ready≠not_found/applicability 纯函数重算） | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts、tests/read-model/p1-04-verification-projection.test.ts、tests/sqlite-read-model/p1-04-verification-projection.test.ts | ✅ 16/16（主分支已合并） |

integrator 维护：package/lock/tsconfig/vitest、`src/contracts/**`（公共 schema/接口/共享 fixture）、`src/ledger/**`、`src/sqlite-ledger/**`、`src/control/control-engine.ts`、`src/harness/**`、`tests/contract-suite/**`、`tests/integration/**`、文档与状态记录。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结签名（如有缺口：提交具体建议给 integrator 统一修改基线并通知消费者）。子 Agent 从实际读文件开始，不等待派发者；允许测试命令：`pnpm vitest run <自身路径>`、`pnpm typecheck`。

## P1-04 已执行命令及结果（共享基线）

| 命令（product root） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS 0 errors（含全部新契约/夹具/套件/入口骨架） |
| `pnpm vitest run`（全量） | 55 files / 485 tests PASS（P1-00…03 基线 395 零回归 + P1-04 新增 90；命令明细见 p1-04-implementation-evidence.md） |
| `pnpm vitest run tests/restart/evidence/p1-04-evidence.test.ts` | 1 PASS（P1-04-EVIDENCE JSON 证据块，可重复；探针自动启用） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 PASS |

设计理由摘要（详见上方冻结语义）：Evidence=不可变单次聚合 + 派生 applicability（历史零改写）；evidence-intake 单事务携带 index 保证"证据+绑定锚"原子可见；claim 中性（INCONCLUSIVE+不参与集）——"报告"与"完成"分离；verification-plan=内容寻址纯函数（无模型/无默认）；supersede=需求键+同修订 tuple+后置 PASS；reducer=纯公式（Control 唯一写 phase=TaskReduction；Goal 归约留给 P1-05）；ReviewPacket=显式有界（材料数/summary/packet 字节，无 transcript；body-first）；重启等价=单事务+事件重建；不重写 P1-03 冻结的 TaskContextPort（ReviewContextPort 独立版本化扩展）。

---
## P1-03 历史记录（已完成，保留备查；基线 commit 9722e14）

- Ticket：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/03-fake-run-visible.md`（P1-03，status 按阶段守卫保持 `proposed`；有限授权与 Implementation record 已追加票尾；**不把本票记成 P1 已验收，不自动推进 P1-04**）
- 上游 P1-00/P1-01/P1-02 验收证据：`dev_docs/verification/p1-00|p1-01|p1-02-implementation-evidence.md`（仅证明各自票据）；P1-02 结束基线 = 产品根 commit `bafb0f1`（typecheck 0 errors、29 files/283 tests PASS、validate-docs 12/12）。P1-03 共享基线 = 产品根 commit `27359e1`（= cec6b57 + TaskContextRequest.declaredPermissions；套件细化 c986d2d）；四路 lane（a/b/c/d）从 27359e1 派生并全部合并入 main；lane 上报缺口的 integrator 统一裁决见 evidence 文档 "integrator 裁决记录"
- **冻结复用、不重写**：`src/contracts/**`（P1-00/01/02 部分）、`src/contracts/fixtures/**`、`src/contracts/testing/**`、`tests/contract-suite/state-ledger.*`+`goal-view.*`（既有套件零修改）、`src/ledger|control|read-model|interaction|sqlite-ledger|sqlite-read-model`（P1-02 部分）、`src/harness/**`、`tests/restart/**`、`tests/integration/**`
- P0-06 复核影响（AGENTS.md 要求）：`human-framework-role-review.md` 结论与本票无冲突——复核收敛了角色/记忆方向（协调 vs 执行、短生命周期自由模板、报告需 Control 登记、完成权不绑定名称、outbox-before-side-effect、crash≠outcome_unknown 均在 03 验收内）；本票不创建 CompletionClaim/VerificationPlan、不做 Goal 归约、不把 Run 结束写 `Task.phase=satisfied`。doc 与票据 Acceptance 无冲突；如后续发现差异：以票据 Acceptance 为准并上报 integrator 统一协调接口文档修订（本屏已按此原则冻结 runtime-collaboration 尚未冻结的 wire 字段）。
- 四个最小 Interface 首次冻结（DAG interfaces_to_freeze）：`ArtifactPort`（src/contracts/artifact.ts）、`DispatchPort`（src/contracts/ports.ts）、`TaskContextPort`（src/contracts/task-envelope.ts）、`RunPort`（src/contracts/ports.ts）——已建、版本化（v1）、以契约套件定义 + 集成接线作为最小 contract test；后续票据只消费/显式升级。

## P1-03 契约与存储语义（冻结）

1. **LedgerCommit 扩展方式**：新增三个 commitKind（`dispatch-claim` / `dispatch-start` / `run-fact`），全部 schemaVersion 1、project-scoped CommandIdentity，沿用 P1-00/02 先例做版本化记录，**不改变既有 v1 语义**（既有 283 测试零回归）。`LedgerCommit.outboxIntents` 首次非空：dispatch-claim 的 outboxIntents=[DispatchIntentV1]（与 DispatchOutboxEntrySnapshot.intent 逐字段等价，由 validator 校验）；其余 kind 仍为 []。**outbox 存储语义：outbox 记录以 canonical DispatchOutboxEntry 聚合（ref=projectId+goalId+taskId+attemptId）持久在 Snapshots 表**——与 dispatch 事件/attempt/snapshot 同一原子提交、同一 CAS 窗口、可 load、可重启读取；status 生命周期 pending→started→done（claim / start / 终态 run-fact 各自 CAS 推进）。排序：outboxIntent 先于副作用由 DispatchEngine.drive 保证（加载 pending → assemble → startRun 提交 → 才调用 RunPort.start）。
2. **六个契约**：DispatchIntentV1 / TaskLeaseSnapshot / TaskAttemptSnapshot / RunSnapshot / RuntimeEventV1 / ActiveAgentView（+ TaskDetailView.run: TaskRunState|null）全部 schemaVersion 1；版本化策略 = 新增合类型 + 未知版本拒绝（validation.ts + events.ts KNOWN 列表），与 P1-00/02 相同。**TaskEnvelope 角色模板/绑定版本的最小形状 = RoleBindingRefV1 {bindingId, templateId, templateRevision, bindingVersion, policyRevision}**（runtime-collaboration 的完整 RoleBinding 语义尚无契约；本票只冻结“版本化引用 + 版本一致性 + 声明权限 ⊆ 绑定声明”的最小校验；授权策略注册表留给后续票据，已注明）。
3. **唯一领取语义**：eligibility = 显式 DAG 硬依赖全部满足（dep task phase === "satisfied"）+ goal desiredState active + task disposition active + 无 Blocker（phase≠blocked）+ 资源可用（无 active lease、tokenBudget>0、deadline 未过）+ taskKind=work（gate 由 P1-04 Evidence 归约，不派发）；**CAS/lease = TaskLease@0 的 ledger CAS**（P1-03 每任务只允许一次领取，无重试/re-claim）；两个 Dispatcher 竞争 → 至多一个 lease+Attempt+Run 提交成功，败者 revision_conflict 零写入；幂等重放（同 identity+fingerprint → committed(replayed)）优先于 CAS。
4. **RuntimeEvent 语义**：每 Run 单调 sequence 是唯一去重/排序权威；sequence < run.lastEventSeq → stale_event；== lastEventSeq 且 runtimeEventId 不同 → conflict_event；== 且相同 → duplicate_event（拒绝，零写入，**不再有 ledger 级幂等重放——run-fact commit 不写 idempotency 表**）；Run 已 ended 后任何 fact → after_terminal；全部拒绝不回退 Task/Run revision（P1-03 无 Task 聚合写入，Run revision 只前进）。**crash 与 outcome_unknown 分开投影**：run_crashed → outcome crashed；RunOutcomeUnknown 是显式 RunFact（{kind:"outcome_unknown"}），绝不从 crash/exit 推断成功；**run_completed(exit=0) → outcome completed（run 视角，exitCode 记录），永不写 Task.phase=satisfied**。
5. **FakeRuntimeAdapter 边界**：真实可重放适配器（真实模块 src/runtime/fake-runtime-adapter.ts，可注入），按 FakeRuntimeScriptV1 重放（runRef=envelope.runRef，eventId="rt-<runId>-<seq>"），capabilities 声明 replayable/supportsSnapshot=false/maxEnvelopeBytes=64KiB；只发事件，不判真伪、不写 satisfied、不自动推断 outcome_unknown。TaskEnvelope 硬上限 64KiB（canonical JSON bytes），**不含完整 transcript**（仅有界 bundleRef + sourceRefs）。
6. **ReadModel**：ActiveAgentView（per projectId+goalId+taskId）+ TaskDetailView.run 只从已提交事件重建（TaskClaimed/RunStarted/RunEventRecorded/RunOutcomeUnknown 四个 handler）；freshness 沿用 opaque CommitCursor（not_ready≠not_found）；已知 v1 事件无 handler → ProjectionStallError(unsupported_event_type) 整页停止（未实现前不静默）。**无投影在跳过事件**。
7. **重启等价**：dispatch/claim/start/run-fact 全部经 SQLite 单事务；重启后 outbox、lease、Attempt、Run（close→reopen 同文件、全新实例）逐字段一致；ActiveAgents/TaskDetail 从持久 EventPage 重建逐字段一致；禁止任何 fake 或内存状态延续。
8. **边界**：本票不创建 CompletionClaim/VerificationPlan、不做 Goal 归约、不把 Run 结束满足 Task、不创建重试/取消（P1-10）/换手（P1-06）。TaskEnvelope 正文先经 ArtifactVault 保存（content-addressed，body-first），Control startRun 登记成功后才成为可查询引用（保存后登记失败只留未采纳 Artifact，不显示为已接受事实）。
9. **事务/命令路径**：dispatch 路径 command/流水 = readiness(只读) → claimTask(dispatch-claim commit) → [ContextCompiler.assemble → vault.put] → startRun(dispatch-start commit) → RunPort.start → runFact×N（run-fact commits）；0xC0 顺序仅由 drive 调用方控制（单线程驱动），CAS 保证唯一 Writer。

## P1-03 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| dispatch 契约/夹具 | src/contracts/dispatch.ts、fixtures/dispatch-fixtures.ts | DispatchIntentV1/TaskLease/TaskAttempt/Run 快照与 ref、RuntimeEventV1、eligibility 纯函数 evaluateTaskEligibility、claim/start/runFact 命令与 receipt、指纹、四 domain events（TaskClaimed/RunStarted/RunEventRecorded/RunOutcomeUnknown） |
| artifact/task-envelope/active-agent/ports | src/contracts/artifact.ts、task-envelope.ts、active-agent.ts、ports.ts | ArtifactPort、ArtifactRef（content-address）、TaskContextPort/TaskContextRequest-V1/TaskContextResult、TaskEnvelopeV1（64KiB 上限）、RunPort/RunCapabilities/RunHandle、DispatchPort/dispatchDrive、ActiveAgentView/TaskRunState |
| ledger 扩展 | src/contracts/ledger.ts、ledger-validation.ts、src/ledger/in-memory-ledger.ts、src/sqlite-ledger/sqlite-ledger.ts | 3 个 commitKind、StateLedger.pendingDispatchIntents、3 个纯 commit validator（InMemory+SQLite 共用） |
| validation 扩展 | src/contracts/validation.ts | validateDispatchClaim/Start/RunFactCommand、validateTaskEnvelope(+cap)、validateRuntimeEvent、validateTaskContextRequest、validateContextManifest、validateRoleBindingRef、validateTaskBudget |
| Control 入口 | src/control/readiness.ts、claim.ts、start-run.ts、run-facts.ts、dispatch-engine.ts | evaluateDispatchReadiness(deps,query)/claimTask(deps,cmd)/startRun(deps,cmd)/runFact(deps,cmd)/DispatchEngineImpl.drive（stub→lane 填充；control-engine.ts 仅委托） |
| Runtime/Vault/Context | src/runtime/fake-runtime-adapter.ts、src/vault/artifact-vault.ts、src/context/context-compiler.ts | FakeRuntimeAdapter(script)、ArtifactVault.put/open、ContextCompilerImpl.assemble（stub→lane 填充） |
| harness | src/harness/{in-memory,persistent}-harness.ts | vault/contextCompiler/runtime/dispatchEngine + dispatchReadiness/claimTask/startRun/runFact/activeAgent/drive 直通；options {runtimeScript?} |
| 契约套件 | tests/contract-suite/{p1-03-harness,dispatch.contract.suite,run.contract.suite}.ts | defineDispatchContractSuite/defineRunContractSuite(factory) + prepareDispatchScenario/buildPreparedClaim/buildPreparedEnvelope |
| 重启骨架 | tests/restart/p1-03-restart-fixtures.ts、p1-03-restart.test.ts、evidence/p1-03-evidence.test.ts | skipIf 探针 isP103Ready()；实现落地后自动启用（lane D 硬化） |

## 四路并行（P1-03，隔离 worktree → main 合并；从本基线 commit 派生）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A dispatch/claim | `p1-03-lane-a` @ d92a4fc | readiness 判定与唯一领取 + start + drive（outbox 先于副作用） | src/control/readiness.ts、claim.ts、start-run.ts、dispatch-engine.ts、tests/control/dispatch-*.test.ts | ✅ 23/23 |
| B FakeRuntime + run-facts | `p1-03-lane-b` @ 5387ee6 | FakeRuntimeAdapter + runFact（无回退/crash≠unknown/exit 不写 satisfied） | src/control/run-facts.ts、src/runtime/fake-runtime-adapter.ts、tests/control/run-facts.test.ts、tests/runtime/fake-runtime-adapter.test.ts | ✅ 16/16 |
| C ContextCompiler+Vault | `p1-03-lane-c` @ 913f4a2 | assemble（越权/旧绑定/预算/超界拒绝；正文先入 Vault）+ ArtifactVault | src/context/context-compiler.ts、src/vault/artifact-vault.ts、tests/context/**、tests/vault/** | ✅ 25/25 |
| D ReadModel + 重启证据 | `p1-03-lane-d` @ 6fd0eb8 | ActiveAgent/TaskDetail.run 投影 + 双 Adapter + 重启证据硬化 | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts、tests/read-model/**、tests/sqlite-read-model/**、tests/restart/p1-03-*.ts（含 evidence） | ✅ 14/14（重启探针自动启用） |

integrator 维护：package/lock/tsconfig/vitest、`src/contracts/**`（公共 schema/接口/共享 fixture）、`src/ledger/**`、`src/sqlite-ledger/**`、`src/control/control-engine.ts`、`src/harness/**`、`tests/contract-suite/**`、`tests/integration/**`、文档与状态记录。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结签名（如有缺口：提交具体建议给 integrator 统一修改基线并通知消费者）。

## P1-03 已执行命令及结果（共享基线）

| 命令（product root） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS 0 errors（含新契约/夹具/套件/骨架） |
| `pnpm vitest run`（全量） | **44 files / 395 tests PASS**（P1-00/01/02 基线 283 零回归 + P1-03 新增 112） |
| `pnpm vitest run tests/integration/p1-03.contract-suite.inmemory.test.ts` | 15/15 PASS |
| `pnpm vitest run tests/integration/p1-03.contract-suite.sqlite.test.ts` | 15/15 PASS（同一套件定义，无调参） |
| `pnpm vitest run tests/integration/p1-03.integration.test.ts` | 2/2 PASS（真实 SQLite：drive 全路径 + 并发竞争领取） |
| `pnpm vitest run tests/restart/evidence/p1-03-evidence.test.ts` | 1/1 PASS（`P1-03-EVIDENCE` JSON 证据块，可重复） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 PASS |

设计理由摘要：outbox=canonical 聚合（可 load/可重启/与事件同事务，无第二套机制）；唯一领取=TaskLease CAS@0（ledger 原子性直接给出“至多一个”）；RuntimeEvent 去重=per-run 单调 sequence（零写入拒绝，不回退）；crash≠outcome_unknown（显式 fact）；TaskEnvelope 有界=64KiB+bodyRef（无 transcript）；FakeRuntimeAdapter=真实可重放适配器；事务边界=3 种 commitKind 单事务，run-fact 无 idempotency 记录（语义见上 4）。

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
| A install/activate | `p1-02-lane-a` @ 9700b75（merge 36fcd05） | 完全实现 install（schema→digest→immutable 持久化→幂等→zero-write 映射）与 activate（精确 target→CAS→active ref 独立；悬空/digest/CAS 失败零写入） | src/control/governance-install.ts、src/control/governance-activate.ts、tests/control/governance-*.test.ts | ✅ 23/23 |
| B ApplyPlanRevision | `p1-02-lane-b` @ 3512ae4（merge 1bff90c） | 完全实现 applyPlan（guard 顺序 1→5，非空+映射+VR 编译+无环，pin 固定，幂等/CAS 映射） | src/control/plan-acceptance.ts、tests/control/plan-acceptance.test.ts | ✅ 22/22 |
| C ReadModel 投影 | `p1-02-lane-c` @ 6d50a47（merge a2f2d08） | PlanGraph/TaskDetail/GoalView(activePlanRevision) 双 Adapter 投影+查询+重建等价+隔离+stall | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts、tests/read-model/**、tests/sqlite-read-model/** | ✅ 16/16 |
| D 持久化 harness + 重启证据 | `p1-02-lane-d` @ e009f8b（merge 205ec44） | 完成重启路径（bootstrap→install×2→activate×2→CreateGoal→applyPlan→close→reopen→canonical refs/pins/views 一致）+证据收集 | tests/restart/p1-02-restart-fixtures.ts、p1-02-restart.test.ts、evidence/p1-02-evidence.test.ts | ✅ 探针自动启用 2/2 |

integrator 维护：package/lock/tsconfig/vitest、src/contracts/**（公共 schema/接口/共享 fixture）、src/ledger/**、src/sqlite-ledger/**、src/control/control-engine.ts、src/harness/**、tests/contract-suite/**、tests/integration/**、文档与状态记录。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结签名（如有缺口：提交具体建议给 integrator 统一修改基线并通知消费者）。

## P1-02 已执行命令及结果（最终）

| 命令（product root） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS 0 errors |
| `pnpm vitest run`（全量） | **29 files / 283 tests PASS**（既有 158 零回归 + P1-02 新增 125） |
| `pnpm vitest run tests/integration/p1-02.contract-suite.inmemory.test.ts` | 29 PASS |
| `pnpm vitest run tests/integration/p1-02.contract-suite.sqlite.test.ts` | 29 PASS（同一套件定义，无调参） |
| `pnpm vitest run tests/integration/p1-02.integration.test.ts` | 4 PASS（真实 SQLite 全路径，无 fake） |
| `pnpm vitest run tests/restart/evidence/p1-02-evidence.test.ts` | 1 PASS（`P1-02-EVIDENCE` JSON 证据块，可重复） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 PASS |
| 静态 grep：Adapter 之外原始 SQL / node:sqlite 消费者 | 0 / 0；既有双套件零修改；package/lock/tsconfig/vitest 零差异（零新增依赖） |

## P1-03 下一步 / 未解问题（最终）

- 无阻断项。设计理由见“P1-02 契约与存储语义”（LedgerCommit 扩展、immutable/activation/pin 语义、guard 顺序、事务边界）。
- 已知取舍：① plan-revision validator 将 goalSnapshot.revision 固定为期望+1——P1-02 单次接受语义成立，multi-plan/rebase 属 P1-11 消费者；② PlanRevisionReceipt.revision_conflict 未携带 currentRevision（契约未定义）；③ 幂等键纪律：公共 fixture 默认 idempotencyKey 不区分 command 种类，同一 Project 上不同命令必须显式传独立 key（已三处修正集成；P1-00 幂等语义未变）。
- 验收证据：[p1-02-implementation-evidence.md]（文档根 dev_docs/verification/）；票据 Implementation record：ticket 02（status 保持 proposed，符合阶段守卫）。
- **停止**。P1-02 完成（有限授权内）。不自动推进 P1-03；P1 DAG 仍为 proposed；推送/部署未发生（remote 未推送，需用户授权）。

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
