# P1-07 Implementation Evidence — Parallel Readers + single Writer

```yaml
ticket: P1-07
status: implementation verified (limited authorization, 2026-09-06 — P1-07 only); 3 lanes merged; DAG 07 edges satisfied (T05→T07→T12, T07→T15, T07→G3); G3 (Role Collaboration) waits P1-07 + P1-15 evidence
baseline: P1-06 commit f3a6a71 (76 files/641 tests); P1-07 shared baseline commit a155f15 (frozen contracts + fixtures + stubs + suite skeleton; upstream 641 zero-regress); final product-root merge commit 14886d8
doc_authority: /mnt/d/1.project/software/agent_learn/agent_dev/agent_platform
git: local main = 14886d8 (NOT pushed to GitHub origin main — push 需用户授权，P1-04/05/06 先例)
p1_03_frozen_proof: git diff f3a6a71 14886d8 -- src/contracts/{dispatch,evidence,reduction,goal-phase,goal-phase-view,handoff,handoff-context,handoff-control,handoff-view,plan,ports,task-envelope}.ts = 0 行（形状零改动；行为级 versioned additions 仅在 src/control/{claim,readiness,dispatch-engine}.ts 与契约文件尾部版本化追加，见 §5）
```

## 1. 验收对照（ticket 07 Acceptance，8/8 满足）

| # | Acceptance | 证据 |
| --- | --- | --- |
| 1 | 两个 Reader 的 Run 时间实际重叠，各自独立 Attempt/Context/预算/来源 | 契约套件 A1/A2（ParallelProbeRuntime 记录启动/消费序；driveParallel 全部 start() 先于全部 pollFreshEvents()；窗口 A[10,40]/B[20,50] 真实重叠；outbox intent 断言 attemptId/runId 独立、budget/tools 各自声明）；driveParallel = 切片内全部 intent 并发 assemble→startRun→runtime.start（Promise.all），再并发 consume |
| 2 | 同 Stage 或不同 Stage 不产生隐式先后，只有显式 RuntimeExecutionDAG depends_on 阻塞 | A1/A2：两 Reader 均无 depends_on → 无隐式序；契约套件 5 A8b/全场景：IntegrationTask 仅在显式 depends_on 的 Reader SATISFIED（live phase）后 claim；阻塞只由 executionDag 边产生（deps_unsatisfied 只因声明边） |
| 3 | Reader 不能修改目标 Workspace，输出只作为 Evidence/Artifact/Handoff | A3 + read-only-capability-enforcement：reader run（envelope.tools=["read"]）→ capabilitiesFor → workspaceWrite=false → acquireWriteLease → capability_readonly（零写入，视图无 writeLease）；unsupported capability → capability_unsupported（绝不静默降级）；读-读永不互斥（同 scope 双读租约共存）；读-写相交 → read_lease_conflict |
| 4 | Evidence 冲突不被后到结果覆盖，IntegrationTask 必须解释或升级 | A4 + evidence-conflict-test：detectEvidenceConflicts 纯函数（同 coverage+同 tuple+双 APPLICABLE+outcome 不同+run 不同 → 1 conflict）；conflicts 无解释无 escalate → conflict_unresolved；有解释 → committed 且纪录保持；后到相同 conflictKey → conflict_duplicate（首记录权威，视图只展示）；escalate=true 需 conflicts 非空（否则 invalid） |
| 5 | 同一 conflict scope 同时最多一个有效 Writer lease | A5 + competing-writer-lease-test：两 Writer（任务 WRITER + 可选 WRITER_B）并发 acquire → 至多一个 committed，败者 write_lease_conflict（索引 CAS；零写入）；读回 index 单 active、视图 active；scope 越权 → scope_not_declared；非 holder release → not_holder；幂等 replayed |
| 6 | Writer 使用已接受 Reader 输出，返回 patch/commit、changed paths、检查结果和 Workspace revision | A6 + patch 守卫：recordPatch 守卫序（run ended → plan/taskRevision → 活动写 lease + holder → changedPaths ⊆ scope（scope_mismatch）→ before == canonical（stale_workspace）→ input 存在（input_not_found）+APPLICABLE（input_not_accepted））→ 单原子 commit（PatchRecorded + Workspace N→N+1 CAS + WriteLeaseReleased(patch-record) + index 清空）；patch 视图含 changedPaths/checkResults/usedInputEvidenceRefs/workspaceRevision |
| 7 | GoalGateTask 全量检查通过后 Goal 才可完成，失败事实仍可追溯 | A7：全场景（并行读者→join→唯一 writer→patch→canonical N+1 全量再验证→gate 证据→reduceGoal）→ goalStatus COMPLETED；A7b：gate 证据 FAIL → 永非 COMPLETED（FAILED + 原因可追溯：goalTimeline、TaskReduction load、taskVerification）；不重写 P1-05 reducer（只读复用） |
| 8 | （2026-09-06 扩展）多工作包角色 Context 与权限隔离；协调者退出不撤销独立 Worker 的合法 lease | A8：worker + 协调者各自合法读 lease；协调者释放自己的 → worker lease 仍 admissible、视图仍 active、非 holder 不能释放（not_holder）；语义路由归 P1-15，本票验证运行隔离 |

## 2. 五组 verification 对照

| verification | 对应测试 |
| --- | --- |
| real-run-overlap-measurement | A1/A2（+ lane B tests/control/workspace-drive.test.ts 3 用例）：probe 启动/消费序 + 窗口重叠 + maxIntents 扫描边界 + runtime_error 路径 |
| read-only-capability-enforcement | A3 + lane A tests/control/workspace-lease.test.ts（capability_readonly/scope_exceeds_capability/workspace_mismatch/unsupported）+ tests/runtime/workspace-capability-adapter.test.ts 13 用例（能力 = 支持矩阵 ∩ envelope.permissions.tools；reader 永不能升级写） |
| competing-writer-lease-test | A5/A5b + lane A 单测（write_lease_conflict/expiry-vacate/already_released/not_holder/幂等）+ 折叠校验 validateWorkspaceWriteLeaseAcquireCommit（双适配器共用） |
| evidence-conflict-test | A4 + lane B tests/control/integration-join.test.ts 6 用例（unresolved/duplicate/run/stale/input 守卫）+ detectEvidenceConflicts 纯函数 G0b |
| goal-gate-full-check | A7/A7b + runP107FullScenario（isP107Ready 探针运行同一路径）+ tests/integration/p1-07.integration.test.ts（真实 SQLite 全路径 + 重启等价，逐字段一致） |

## 3. 已执行命令及结果（product root，提交 14886d8）

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS 0 errors |
| `pnpm vitest run`（全量） | **88 files / 722 tests PASS**（P1-00…06 基线 641 零回归 + P1-07 新增 81：lane A 26 + lane B 9 + lane C 19 + 契约套件 24 + 集成/重启/证据 3） |
| tests/integration/p1-07.contract-suite.inmemory.test.ts | **12/12 PASS**（isP107Ready 探针自动启用） |
| tests/integration/p1-07.contract-suite.sqlite.test.ts | **12/12 PASS**（同一套件定义，无调参） |
| tests/integration/p1-07.integration.test.ts | **1/1 PASS**（真实 SQLite 全路径 + 重启等价） |
| tests/restart/p1-07-restart.test.ts | **1/1 PASS**（探针自动启用；lease/index/PatchRecord/IntegrationResult/Workspace 快照 + 三视图重建逐字段一致 + observedCursor 一致） |
| tests/restart/evidence/p1-07-evidence.test.ts | **1/1 PASS**（P1-07-EVIDENCE JSON 证据块，可重复） |
| P1-03/04/05/06 双套件（回归） | 全部 36+16+25×2 等基线测试零回归（含在全量 722 内） |
| `node dev_docs/verification/validate-docs.mjs` | **13/13 PASS** |
| 冻结形状只读比对 | `git diff f3a6a71 14886d8 -- src/contracts/{dispatch,evidence,reduction,goal-phase,goal-phase-view,handoff,handoff-context,handoff-control,handoff-view,plan,ports,task-envelope}.ts` = **0 行** |

## 4. 三路实现与合并

| Lane | commit | 内容 | 验证 |
| --- | --- | --- | --- |
| A Workspace lease + capability | 339d3ac（merge bd9bef3） | WorkspaceLeaseEngineImpl（acquire read/write 守卫序 + capability 强制 + 独占 CAS + expiry-vacate + holder-only release；零手写 commit，全走冻结 fold）+ FakeWorkspaceCapabilityAdapter 测试 | 26 单测 PASS |
| B 双 Reader 并行 + IntegrationTask | d379181（merge 7f6fe7e） | WorkspaceDriveEngineImpl.driveParallel（切片过滤 + 替换意图跳过 + 并发启动/并发消费 + run-scoped idempotencyKey）+ recordIntegrationResult（守卫 → detect → 不可覆盖 → 累积 CAS） | 9 单测 PASS |
| C ReadModel 投影 + 重启证据 + Writer/patch | c15b694（merge f5c6cc5） | recordPatch（守卫 1-10 + 原子推进）+ 6 事件双适配器投影（3 视图 + isHandledEventType 同 commit） | 19 单测 PASS |

integrator 修正（统一基线）：①DAG readiness live-phase 覆盖（新 src/control/dispatch-facts.ts：loadLivePlan 以 TaskReduction 派生 phase 覆盖——计划快照不可变是 P1-03 冻结事实，过期判断读实时归约；readiness + claim 均接入，签名不变）；②validateRecordIntegrationResultCommand/validateRecordPatchCommand taskRevision 改为整数校验（契约类型是 number）；③P1-03 dispatch-engine startRun 改为 run-scoped idempotencyKey（P1-03 潜在缺口：多 intent 顺序 drive 会 idempotency_conflict——P1-07 修复并记录）；④release 校验器 expectedRevision=1（活动租约 revision）；⑤P107 场景使用 bootstrap 已建 proj-alpha/ws-shared；⑥冲突用 plan 变体（integration→readerB 边移除——FAIL 任务的依赖阻塞属 DAG 语义，不应违背）；⑦GoalGate 全量检查 = 补丁后 canonical revision 全量再验证（P1-05 reducer 冻结，不重写：re-admit @N+1 + re-reduce k+1）；⑧视图断言前 advanceProjection（投影语义）。

## 5. integrator 裁决/风险记录

- **两个最小 Interface 首次冻结**（DAG interfaces_to_freeze）：DispatchEngine.WorkspaceLeasePort（acquireReadLease/acquireWriteLease/releaseLease）与 WorkerRuntime.WorkspaceCapabilityPort（capabilitiesFor → ready/unsupported/rejected；无能力 → unsupported，绝不静默降级）——以契约套件 + 双适配器接线作为最小 contract test；wire schema 由本票首个消费者冻结。
- **acquire 守卫为身份级**（run 只需存在，不要求非 ended）：lease 是控制令牌（显式 release + 过期），已结束 run 可为其输出补登 lease（冻结语义，HANDOFF 记录）。
- **expiry-vacate**：过期且未释放的写 lease 不阻断新 acquire，但旧 lease 在同一原子提交被释放（releasedBy=null, releasedVia=expiry-vacate）——不是 force-release/抢占（P1-10 无取消/重试）。
- **冲突保留 = conflict_duplicate 不覆盖**：先到 conflictKey 权威；语义路由/人决定闭环 = P1-15（本票只记录 escalate 标记）。
- **视图 holder.roleBinding 为展示占位**（lease grant 事件无 roleBinding 字段；双适配器同常量，重启 JSON 等价保持确定）。
- **P1-03 潜在缺口（本票发现并修复）**：默认 startRun idempotencyKey 复用 → 顺序多 intent drive 冲突；driveParallel 与 P1-03 drive 均改为 run-scoped key。
- **推送**：local main = 14886d8；**未推送** GitHub origin main（需用户授权）。

## 6. 依赖/下一步

- DAG：T05→T07（完成）；T07→T12（CodeGraph 消费本票真实 writer 变更）、T07→T15、T07→G3 —— G3 等待 **P1-07 + P1-15 双验收**（本票只交付 07 侧证据）。
- 本票不自动开始 P1-12/15/其他票；P1-08 并行窗口共用面未发生（按基线记录应对）。
- P1-15 消费本票：IntegrationTaskResult 冲突面 + escalate 标记 + 唯一 Writer patch + 运行隔离事实。
