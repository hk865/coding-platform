```yaml
ticket_id: 窗口 3 — P1-11（共享基线 8c42367 已提交：965 passed / 24 skipped 探针组；lanes A/B/C 待派发）
status: P1-09 ✅ (验收后最新 main；965/989 基线)、P1-10 ✅、P1-16 ✅ (fa9389d)、P1-12 ✅ (4ecc517)、P1-17 ✅；G1/G2 PASS 在档；P1-11 共享基线完成，B lanes 实施中
updated: 2026-09-07
authorized_by: user (continuous authorization: complete P1-09..P1-17 and drive G1..G5 + MVP review; stop only on stop_condition (a) all done / (b) architecture tradeoff / (c) architecture-granularity confirmation; GitHub push still needs user authorization) + user 2026-09-07 阶段时限 = 09:00 CST 硬性到点（先落干净检查点再报告）；分工纠正：实现/修复由 B lanes 承担，integrator 只做共享基线/合并/集成验收/共享面修正
next: P1-11 lanes A（control）+ B（compilers）+ C（dual-adapter projection）并行；合并后 integrator 验收（typecheck/双套件/真实 SQLite/restart 等价/validate-docs/证据块）；P1-11 验收后 → P1-13 基线（13 只依赖 12 = 已验收，可并行建）+ P1-14（等 11+12）；gates: G4 waits 09+11, G5 waits 13+14, G3 waits 07+15
evidence: P1-11 acceptance evidence will live in dev_docs/verification/p1-11-implementation-evidence.md
shared_baseline: P1-11 = 8c42367（前置 main 含 P1-09 实现 2c01536 等；typecheck 0；全量 140 files / 989 tests：965 PASS + 24 skip（P1-11 探针组 5 files）——零回归）
parallel_scope: P1-11 三 lane（A/B/C 独立 worktree，自 8c42367）；lane 均隔离；重启+集成由 integrator 执行
merge_surface_note: P1-11 只版本化追加——ControlEngine +3（recordPlanChangeProposal/recordUserDecision/applyPlanChange）、HumanCollaboration.GoalChangePort +3（amend/decide/applyChange）、ReadModelIndex.planChangeView、3 个新 commitKind（plan-change-proposal-record/user-decision-record/goal-change-apply）、4 个新事件（PlanProposalRecorded/UserDecisionRecorded/GoalRevisionRecorded/PlanRevisionSuperseded；apply fold 三事件：PlanRevisionAccepted → PlanRevisionSuperseded → GoalRevisionRecorded）——零改动 P1-00..P1-10 冻结形状；新 planId 聚合 @0（P1-02 PlanRevision 不可变语义 → 新 revision = 新 planId 聚合），task 集合在 P1-11 不可变
```

---

## P1-11 当前票据与共享契约基线（并行窗口 3 — lanes A/B/C 实施中）

- Ticket："/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/11-goal-plan-change-revision.md"（P1-11，status 按阶段守卫保持 proposed；Implementation record 验收后追加票尾）
- 上游基线：产品根 main（P1-09 实现 2c01536；P1-08 7664d91 上游验收）。**P1-11 共享基线 = 8c42367**（契约/纯函数/fixtures/接口/双适配器 stub/compiler stub/harness 接线/契约套件/restart/集成骨架；全量 965 PASS + 24 skip 探针组，零回归）。
- **P0-06 复核影响（已核对 2026-09-06 同步记录）**：本票把 UserDecision 路径保留为未委托变更候选；委托策略路径需单独明确契约后同步（不在本票）。
- **三个最小 Interface 首次冻结**：HumanCollaboration.GoalChangePort、PlanCompiler.PlanProposalPort、ContextCompiler.PlanningContextPort（全部版本化 v1；后续规划/变更票只能消费或显式升级）。
- **Lane 跟踪**：A（control）B（compilers）C（projection）——见三路并行表。

## P1-11 契约与存储语义（冻结）

1. **AmendGoalRequest（有界、永不变更）**：goalRef + 可选 planRef + objectiveDelta（change|clarify|restore；newObjective 可 null=仅阐明）+ obligationDeltas（≤64；add|change|remove，各带 justification）+ requestedByRunRef? + actor；编译器永不写 canonical state。
2. **PlanProposal/PlanPatch/ChangeImpactAnalysis（编译器产物）**：proposal 绑定 sourceGoalRef/sourcePlanRef/sourcePlanRevision；patch 带 objective 全文 + obligationDeltas + taskHierarchy(可 null) + 显式 inScope/outOfScope；impact 含 affectedWorks（≤64，workRef+refreshRequired+reason）/staleAssumptions/materialsToRefresh/independentWork；alternatives（≤8）。**任务集合在本票不可变**：新 revision 的任务集 = source 任务集（patch 只有 hierarchy 可调）。
3. **planProposalDigest（纯、冻结）** = sha256(canonicalJson({projectId, workspaceId, sourceGoalRef, sourcePlanRef, sourcePlanRevision, patch, impact}))；decisionTargetFor(proposal) = {goalId, newObjective: patch.objective, sourcePlanDigest}——authorizedTarget 必须与之精确匹配。
4. **UserDecision（不可变聚合，CAS@0）**：subject{goalRef,sourcePlanRef,sourcePlanRevision} + outcome(accept|reject|defer) + actor + authority{strategy:user|delegated; delegator; policyVersion} + authorizedTarget + summary(≤4096B)；record 只登记（零 active-revision 副作用）。
5. **applyPlanChange 守卫链（全部零写入至通过；顺序冻结）**：schema/形状 → proposal_not_found → decision_not_found → decision_not_accepted(outcome≠accept) → decision_target_mismatch（subject/authority 形状或 authorizedTarget != decisionTargetFor(proposal)）→ draft_mismatch（objective ≠ authorizedTarget.newObjective ≠ patch.objective；planRevision != source+1；义务 delta 一致性（change 只改 title、remove 必须缺失、add 必须新 id + title==newText、未动义务必须逐字节一致）；task 一致性引用）→ source_stale（proposal.sourcePlanRef ≠ goal 当前 activePlanRevision）→ 与 P1-02 相同的 guard 重跑（applyPlanGuardIssues 复用：非空+映射+VR+结构合法）→ guards_failed → 原子 commit。
6. **goal-change-apply fold（冻结）**：events=[PlanRevisionAccepted(new plan), PlanRevisionSuperseded(supersededRef=source, activeRef=new, decisionRef), GoalRevisionRecorded(change)]；snapshots=[PlanRevisionSnapshot(new), GoalRevisionSnapshot, GoalSnapshot(revision+1, activePlanRevision=new)]；expectedVersions=[Goal@expected, PlanRevision@0(new planId)]；P1-02 PlanRevision 聚合不可变 → **新 revision 必须是新 planId 聚合**（fixture：plan-mvp-1-v2）。
7. **Read/展示**：ReadModelIndex.planChangeView（key=canonicalJson({projectId,workspaceId,goalId})）组装 proposals/decisions/revisions + **computeTaskDispositions（纯函数，view 时计算）**：keep（任务+义务签名不变）/reverify（义务/VR 签名变化）/replace（移除且有唯一同 key 新任务）/cancel（移除无独一替代）/resume（不变且被 P1-10 safe-point 暂停）；pausedTaskIds 来自 P1-10 control intent 视图。freshness opaque cursor；只展示不判定。
8. **证据适用性重算**：旧证据（anchor=source plan ref）保留在 ledger；新 binding 下 evidenceApplicability（P1-04 纯函数）对 新 currentAnchor（new planRef + same pins）→ OUT_OF_SCOPE（planRef 变化）；绝不改写旧证据。
9. **边界**：不做委托策略（P0-06 注明）、不做 P1-14/15 的验证决定闭环；Planner/HumanCollaboration 不能直接激活 revision（只有 ControlEngine.applyPlanChange）；拒绝/延后不改变 active revision；全量幂等沿用 ledger。

## P1-11 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| 契约/纯函数 | src/contracts/goal-change.ts | 7 契约（AmendGoalRequest/PlanPatch/ChangeImpactAnalysis/PlanProposal/UserDecision/GoalRevision/PlanRevisionSupersededEvent）+ 3 snapshots/refs + 3 命令/回执 + 3 事件 + fingerprints + planChangeScopeKey/planProposalDigest/decisionTargetFor/computeTaskDispositions/draftConsistencyIssues（纯）+ PlanChangeViewQuery/Result + 上限常量 + 3 个端口（GoalChangePort/PlanProposalPort/PlanningContextPort） |
| 端口/接口扩展 | src/contracts/{modules,goal-view}.ts | ControlEngine +3、HumanCollaboration.GoalChangePort +3（amend/decide/applyChange）、ReadModelIndex.planChangeView |
| ledger/validation | src/contracts/{ledger,ledger-validation,events}.ts | 3 commitKind + validateProposal/Decision/ApplyCommit（双适配器共用；apply fold 事件=[PlanRevisionAccepted,PlanRevisionSuperseded,GoalRevisionRecorded]）+ 4 事件入 KNOWN/union |
| fixtures | src/contracts/fixtures/goal-change-fixtures.ts | P111_* 常量、buildAmendGoalRequestV1/PlanPatchV1/ChangeImpactAnalysisV1/PlanProposalV1/UserDecisionV1/GoalRevisionV1/NewPlanDraft + 3 命令 builder + 3 fold builder（含 buildGoalChangeApplyCommit） |
| Control 入口 | src/control/goal-change.ts | GoalChangeEngineImpl（stub→lane A）；control-engine.ts 仅委托 |
| 编译器 | src/control/plan-compiler.ts、src/context/planning-context-compiler.ts | PlanCompilerImpl（deps 冻结：ledger/readModel/now）、PlanningContextCompilerImpl（deps 冻结：ledger/vault/contextCompiler/readModel/now）——stub→lane B |
| 读模型 | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts | planChangeView stub + applyP111 钩子（lane C 填分支 + isHandledEventType 4 事件） |
| harness | src/harness/{in-memory,persistent}-harness.ts | planProposal/planningContext 默认接线（deps 注入）+ recordPlanChangeProposal/recordUserDecision/applyPlanChange/planChangeView/planProposalRequest/assemblePlanningContext/amend 直通 + options {planProposal?, planningContext?} |
| 契约套件 | tests/contract-suite/{p1-11-harness,goal-change.contract.suite}.ts | P1_11TestHarness/FACTORY、runP111ChangeScenario（bootstrap+goal+governance+applyPlan→proposal→decision→apply→view）、defineGoalChangeContractSuite（验收 + 7 组 verification；lanes 未落地自动 skip） |
| 重启骨架 | tests/restart/p1-11-restart-fixtures/test/evidence | isP111Ready() 探针；实现落地后自动启用 |
| 集成接线 | tests/integration/p1-11.* | 双适配器套件接线（skipIf 探针）+ 真实 SQLite 全路径 + 重启等价 |

## 三路并行（P1-11，隔离 worktree → main 合并；从 d5a51ba 派生）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A control | agent_platform-p1-11-a @ p1-11-lane-a | GoalChangeEngineImpl 完整实现（记录两命令守卫+apply 守卫链 proposal→decision→target→draft→source_stale→P1-02 guards→原子 fold+映射）+ 负例/幂等/隔离单测 | src/control/goal-change.ts、tests/control/goal-change.test.ts | ⏳ 实施中（subagent a7134fc3） |
| B compilers | agent_platform-p1-11-b @ p1-11-lane-b | PlanCompilerImpl.request（有界 proposal+impact，零写）+ PlanningContextCompilerImpl.assemblePlanningContext（委托 ContextCompiler 预算/缺口/越权）+ 单测 | src/control/plan-compiler.ts、src/context/planning-context-compiler.ts、tests/control/plan-compiler.test.ts、tests/context/planning-context-compiler.test.ts | ⏳ 实施中（subagent 3bd68486） |
| C projection | agent_platform-p1-11-c @ p1-11-lane-c | planChangeView 双适配器（proposals/decisions/revisions/plan snapshots 行 + 组装 dispositions + isHandledEventType 4 事件同 commit）+ 重建/重启等价 + 隔离单测 | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts（P1-11 区域）、tests/read-model/p1-11-plan-change.test.ts、tests/sqlite-read-model/p1-11-plan-change.test.ts | ⏳ 实施中（subagent 5f57f476） |

---

## P1-12 当前票据与共享契约基线（并行窗口 1b）

- Ticket："/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/12-codegraph-finding-decision-brief.md"（P1-12，status 按阶段守卫保持 proposed；Implementation record 将在验收后追加票尾）
- 上游基线：产品根 commit 7664d91（P1-08 验收；本地 main 未推送 GitHub——推送需用户授权）。**P1-12 共享基线 = commit e150447**（= 7664d91 + P1-16 基线 a597eaf + 本票 contract/port/fixture/harness/套件/restart/集成骨架；既有 768 测试零回归实测，8 files/42 tests 因 isP112Ready()=false 自动 skip 属预期）。
- **冻结复用、不重写**：P1-00…P1-11 全部契约/夹具/套件/适配器/harness 零修改通过；P1-02 的 governance/plan pin 形状只被消费（p112BaselinePin 由 ARCHITECTURE_BASELINE_FIXTURE_V1 + architectureBaselinePinFor 派生）；P1-05/04 reducer 不修改。
- **P0-06 复核影响（已核对）**：2026-09-06 同步记录明确——P1-12 接受无 raw Delta 的问题来源（报告型 finding 合法、禁止伪造 delta）；P1-14 验证决定/迁移/主动上报最小路径。
- **三个最小 Interface 首次冻结**：WorkspaceReader.ReadPort（src/contracts/workspace-read.ts）、ArchitectureReconciler.InspectionPort（src/contracts/architecture-reconciler.ts）、VerificationEngine.CodeGraphPort（同文件）——P1-13/14 只消费这些版本；6 个契约：ArchitectureInspectionIntent/CodeGraphSnapshot/ArchitectureDelta/ArchitectureFinding/ArchitectureDecisionBrief/CandidateBaselineProposal。
- **Lane 跟踪**：lane A（inspect pipeline：workspace reader + code-graph port + reconciler，subagent e44ac9f9）与 lane B（4 record commands + brief/proposal 投影，subagent e075e034）在隔离 worktree agent_platform-p1-12-a/b（分支 p1-12-lane-a/b，自 e150447）。合并后 integrator 执行重启硬化 + 集成 + 证据块。

## P1-12 契约与存储语义（冻结）

1. **pin-only baseline**：inspection 意图携带 planRef + ArchitectureBaselinePin（ref+digest）；reconciler 只沿 pin 加载 digest/revision 匹配的 immutable baseline（ledger.load）——**不读 Project active ref、无内置 baseline**；pin 缺失/dangling → fail_closed(baseline_unresolved)，digest 不匹配 → fail_closed(baseline_digest_mismatch)，均为零写入并带可解释诊断，**绝不生成伪 Delta/Finding**。
2. **CodeGraphSnapshot（revision-bound）**：绑定 workspaceRevision/planRef/baselinePin/gitRef(commitHash+treeDigest)/nodes(≤512)/edges(≤1024)/indexCapabilities{hasCodeGraph, degradesToText, graphRevision}/bodyRef；无图能力必须显式（hasCodeGraph=false + 降级标注），不得编造关系。阅读约定：WorkspaceReader 注册表 sourceRevision 0 = pin 基准态（fixture-graph registry），>=1 = 当前态；调用方版本与当前不符 → stale（重新取材）。
3. **ArchitectureDelta（纯机械）**：computeArchitectureDelta(before, after) 纯函数——node/edge 按 structuralKey 求差集，changes 只含 added/removed/modified/moved + before/afterDigest；noVerdict: true 显式保证；相同输入 → 相同 Delta（canonicalJson 相等）。
4. **ArchitectureFinding**：source ∈ workspace_delta|interface_report|performance|permission|runtime_evidence；**deltaRef: null 合法（report 型）**——禁止伪造 raw Delta；category/risk/confidence + sources(≤16)/affectedRefs/recommendation；material/ambiguous 布尔；summary ≤4096B；JSON ≤16KiB。
5. **ArchitectureDecisionBrief**：material/ambiguous finding 必须产生；绑定 source baseline pin + findingRefs + 原始理由(≤8) + 影响(modules/interfaces/plans) + 选项(≤8，含 optionId/风险/延后影响/递延后果) + bodyRef。
6. **CandidateBaselineProposal**：从精确 sourceBaselinePin + 选中 delta/option + normalizedContent 确定性派生；proposalDigest = sha256(canonicalJson(payload))（record 时重算验证，不一致 → digest_mismatch 零写入）；expectedCandidateDigest 供 P1-14 物化比对。
7. **Record 命令/守卫**：inspection/finding/brief/proposal 四个不可变聚合（CAS@0）+ 全量幂等；pin 解析缺失 → not_found，digest 不匹配 → baseline_mismatch；每命令一个原子 commit（fold-equality 用共享 fixture builder）。
8. **事件/投影**：4 个新 v1 事件（ArchitectureInspectionRecorded/FindingRecorded/BriefRecorded/ProposalRecorded；DomainEvent/KNOWN 同一基线；handler+isHandledEventType 各 lane 同 commit）；ReadModel 视图 architectureInspectionView（key=canonicalJson(完整 ref)；inspections+findings（LANE-A）+briefs+proposals（LANE-B）；只展示不判定；freshness opaque cursor）。
9. **边界**：**本票不产生 RemediationTask、migration Gate 或 BaselineActivation 副作用**；Worker/Reviewer 无权修改 baseline、不能把自己的 CompletionClaim 作为新 baseline；不物化 candidate、不移动 active ref；改动接口/契约的人工协商由 P1-14/15 消费（不形成反向依赖）。

## P1-12 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| 契约/纯函数 | src/contracts/architecture-inspection.ts | 6 契约值类型 + 4 refs + 4 命令/回执 + 4 事件 + 4 snapshot + fingerprints + computeArchitectureDelta（纯）+ candidateProposalDigest（纯）+ 视图 Query/Result + 上限常量 |
| 端口 | src/contracts/workspace-read.ts、architecture-reconciler.ts | WorkspaceReadPort/CodeGraphReadQueryV1/ResultV1；InspectionPort/InspectResultV1；CodeGraphPort/CodeGraphQueryV1/ResultV1 |
| ledger/validation 扩展 | src/contracts/{ledger,ledger-validation,validation,events,modules,goal-view,index}.ts | 4 commitKind + 4 validateXxxCommit（双适配器共用）+ intent/finding/brief/proposal/4 命令校验器 + DomainEvent/KNOWN + ControlEngine 4 个版本化新增 + ReadModelIndex.architectureInspectionView |
| fixtures | src/contracts/fixtures/architecture-fixtures.ts | P112_* 常量、p112BaselinePin、P112 基准/当前图、delta/report finding、brief、proposal（确定性 digest）、buildP112InspectionIntent/Snapshot、4 命令 builder + 4 ledger-fold builder |
| Control 入口 | src/control/architecture-inspection.ts | ArchitectureInspectionEngineImpl（stub→lane B）；control-engine.ts 仅委托 |
| Reconciler/reader/seam | src/control/architecture-reconciler.ts、src/data/workspace-reader-adapter.ts、src/verification/code-graph-port.ts | ArchitectureReconcilerImpl（stub→lane A）；FakeWorkspaceReaderAdapter（stub→lane A）；CodeGraphPortImpl（stub→lane A） |
| harness | src/harness/{in-memory,persistent}-harness.ts | workspaceReader/codeGraph/inspection 默认接线 + recordArchitectureInspection/finding/decisionBrief/candidateProposal + architectureInspectionView + workspaceRead/codeGraphQuery/inspect 直通 + options {workspaceReader?, codeGraph?, inspection?} |
| 契约套件 | tests/contract-suite/{p1-12-harness,architecture.contract.suite}.ts | P1_12TestHarness/FACTORY、runP112InspectionScenario、defineArchitectureInspectionContractSuite（InMemory+SQLite 同套件；Acceptance + 7 组 verification；restart 组为集成级） |
| 重启骨架 | tests/restart/p1-12-restart-fixtures.ts、p1-12-restart.test.ts、evidence/p1-12-evidence.test.ts | isP112Ready() 探针；实现落地后自动启用 |
| 集成接线 | tests/integration/p1-12.contract-suite.inmemory|sqlite.test.ts、p1-12.integration.test.ts | 双适配器套件接线（skipIf 探针）+ 真实 SQLite 全路径 + 重启等价 |

## 三路并行（P1-12，隔离 worktree → main 合并；从 e150447 派生）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A inspect pipeline | agent_platform-p1-12-a @ p1-12-lane-a（commit 1a0f017） | FakeWorkspaceReaderAdapter（图注册表/stale/unsupported）+ CodeGraphPortImpl + ArchitectureReconcilerImpl.inspect（pin-only fail-closed、确定性 delta、report-source 无伪 delta、经 Control 记录、零 baseline 副作用）+ 对应单测 | src/data/workspace-reader-adapter.ts、src/verification/code-graph-port.ts、src/control/architecture-reconciler.ts、tests/control/architecture-reconciler.test.ts、tests/data/workspace-reader-adapter.test.ts、tests/verification/code-graph-port.test.ts | ✅ 完成（v2 be979175；23/23 + 791 passed 零回归；口头头建议已记：deltaRef 为 fixture 引用而非真正 vault delta——P1-13/14 物化前由 integrator 复核） |
| B record + projection | agent_platform-p1-12-b @ p1-12-lane-b | 4 record commands（守卫序+fold-equality+幂等；proposal digest 重算）+ architectureInspectionView 的 brief/proposal 部分 **+ read-model LANE-A 区域（inspection+finding 投影；覆盖缺口归本 lane，send_message d287405e）**（in-memory+sqlite，isHandledEventType 同 commit）+ 对应单测 | src/control/architecture-inspection.ts、src/read-model/read-model-index.ts（LANE-A + LANE-B 区域）、src/sqlite-read-model/sqlite-read-model-index.ts（LANE-A + LANE-B 区域）、tests/control/architecture-inspection.test.ts、tests/read-model/p1-12-brief-proposal-projection.test.ts、tests/sqlite-read-model/p1-12-brief-proposal-projection.test.ts | ⚠️ 首派 e075e034 6 轮零写入被中断；重派 v2（7e2d7ef7）+ 覆盖缺口已并入 |
| C 重启证据 + 集成 | (integrator 合并后执行) | isP112Ready 探针硬化 + restart 逐字段一致 + 真实 SQLite 全路径集成 + 双适配器视图一致性 + P1-12-EVIDENCE 块 | tests/restart/p1-12-*、tests/integration/p1-12.* | ⏳ 待 lane A/B 合并 |

---

## P1-16 当前票据与共享契约基线（并行窗口 1a — lane A/B 实施中；本段自 8aa395a 起保持，P1-16 原文未改动）

- Ticket："/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/16-context-continuity.md"（P1-16，status 按阶段守卫保持 `proposed`；Implementation record 将在验收后追加票尾）
- 上游基线：产品根 commit `7664d91`（P1-08 验收：97 files/768 tests PASS、12/12 Acceptance、7/7 verification、validate-docs 13/13；本地 main 未推送 GitHub——推送需用户授权）。**P1-16 共享基线 = commit `a597eaf`**（= 7664d91 + 本票新增 contract/port/fixture/harness/套件/restart/集成骨架；既有 768 测试零回归实测——97 files/768 tests PASS，5 files/37 tests 因 isP116Ready()=false 自动 skip 属预期）。
- **冻结复用、不重写**：P1-00…P1-08 全部契约/夹具/套件/适配器/harness 零修改通过；P1-03 冻结的 Run/TaskAttempt/TaskLease/lease 形状不修改；P1-06 的 HandoffPacket/ReplacementAttempt 只被消费不重写；P1-05 goal reducer / P1-04 完成策略不修改。
- **P0-06 复核影响（已核对）**：`dev_docs/verification/2026-09-06-context-orchestration-sync.md` 明确——同工作连续性与真实内核能力由 16 验证（P1-03/06 仅有原最小派发/换手证据）；P1-09/10 消费其产物；G2 = 05+06+16。
- **三个最小 Interface 首次冻结**：`ControlEngine.WorkRecordPort`（src/contracts/context-continuity.ts）、`ContextCompiler.WorkContextPort`（src/contracts/work-context-port.ts）、`WorkerRuntime.ContextContinuationPort`（src/contracts/context-continuation-port.ts）——已建、版本化（v1）；3 个契约：WorkContextBinding、ExecutionNote、ContextContinuationResult。上游 Artifact refs：P1-06（404ab28 现状；HandoffPacket/ReplacementAttempt）、P1-08（7664d91）、P1-03 冻结 Run/lease/attempt 形状；本票自产 artifact：versioned-context-continuity-contract、durable-execution-notes、context-continuity-evidence。
- **Lane 跟踪**：lane A（WorkRecord control + binding/notes 投影，subagent b46eeaeb-fe69-440e-b711-fb70210577ef）与 lane B（WorkContext assemble + continuation runtime 面 + continuation 投影，subagent 9ff178e2-f433-4253-a112-44e0400f699a）；隔离 worktree `agent_platform-p1-16-a` / `agent_platform-p1-16-b`（分支 p1-16-lane-a / p1-16-lane-b，自 a597eaf）。合并后 integrator 执行：isP116Ready 探针硬化 + restart 逐字段一致 + 真实 SQLite 全路径集成 + 证据块 + 真实内核连续性证据。

## P1-16 契约与存储语义（冻结）

1. **WorkContextBinding = 持久工作身份**：每 (projectId, workspaceId, workId) 恰好一个绑定聚合（BindWorkContextCommand @0→1，不可覆盖；同 identity+fingerprint 重放 → committed/replayed；同 workId 异身份 → revision_conflict 零写入）。绑定字段 = workId/workspaceId/projectId/workKind（task|coordination|query|review|integration）/goalId/taskId（可 null）/planRef+planRevision（可 null）/roleBindingRef/initialRunRef/linkedRunRefs（≤ WORK_CONTEXT_MAX_RUN_LINKS=32，初始=initialRun）/status:"active"/createdAt。**Run≠工作**：多次模型/工具反馈（一个 Run 内多事实）与跨 Run 换手都保持同一绑定；ContextBundle 是组装结果，独立概念。
2. **WorkRunLinked（追加链路）**：LinkWorkRunCommand（binding @N→N+1，CAS）；run 已 link → already_linked 零写入；绑定不存在 → not_found；run 不存在 → not_found；超 32 → links_exceeded；幂等与 CAS 均走 ledger 全量 idempotency。
3. **ExecutionNote（不可变、有界、正文先落库）**：EXECUTION_NOTE_MAX_BYTES=16KiB；noteId 唯一；字段=runRef（作者 run）+attemptRef(null|)+roleBindingRef+kind（key_choice|checkpoint|frontier|risk|unresolved|result）+summary(≤1024B)+reason(≤4096B)+alternatives(≤8)+sourceRefs(≤64, kinds evidence|artifact|run|handoff|decision|event)+applicableVersions（planRef/planRevision/workspaceRevision/governanceRevision）+verification（unverified|verified|contradicted + evidenceRefs）+bodyRef+noFullTranscript:true+createdAt。**正文先入 ArtifactVault（body-first）**：调用方先 put（canonicalJson(note)），Control 只登记引用；登记失败只留未采纳 Artifact。严格未知字段拒绝（transcript 直接 invalid）。缺少最终总结时已登记记录仍可恢复（崩溃语义）。
4. **ContextContinuationResult（登记观察到的接续路径）**：status ∈ restored_original | took_over | unsupported | rejected；字段=requestedByRunRef（可 null）/capabilitySource（runtime|adapter）/originalRunRef/takeoverRunRef/resumedFromRunRef/unsupportedCapabilities/rejectionCode/summary(≤4096B)/recordedAt。**显式声明，不伪装原进程存在**：unsupported 列出缺失能力（如 session_restore）；capability 声明来自运行时适配器（capabilitySource），Control 不虚构。
5. **WorkRecordPort 守卫序（零写入）**：shape 校验 → invalid；Project/Workspace/Binding/Run 存在性 → not_found；note 作者 run ∈ 绑定 linkedRunRefs → run_not_in_work；重复 link → already_linked；上限 → links_exceeded；每命令一个原子 commit（fold-equality 用共享 fixture builder）+ 全量 ledger 幂等。**不改 Goal/Task phase；不改 CompletionPolicy**；旧 lease/迟到运行事实沿用 P1-03 guard 语义；P1-04 评审隔离不被接续上下文覆盖。
6. **WorkContextPort.assembleWorkContext（有界选材，永不启动模型）**：request 校验 → invalid_request；绑定/run 归属/scope ⊆ declaredPermissions → work_not_found / forbidden_tool_or_scope；材料/预算/版本缺口 → needs_material{gaps, selectedRefs}（binding 缺失、vault 不可用、budget_exhausted、scope_forbidden）；组装有界 Bundle（binding 事实 + 按 noteKinds/maxNotes 选 notes（历史/陈旧以 historical 标志保留，不是当前事实）+ 最新 continuation + 选材来源），body-first vault.put（owner=requestedByRunRef）→ ready(bundleRef, manifest{selected/truncated/gaps/freshness/totalBytes})；manifest 明示截断/缺失；同输入 → 同 bundleRef（内容寻址）。
7. **ContextContinuationPort（显式能力/结果）**：capabilities(request) → supported({sessionRestore, contextResume, takeoverRun, maxContextBytes, maxResumeBytes}) | unsupported | rejected；FakeRuntimeAdapter 诚实声明（Fake: sessionRestore=false/contextResume=true/takeoverRun=true）；**不得假定 Fake 能力等同真实内核**——真实 coding-agent 适配路径做一次多轮+接续验证并保留能力降级证据（Acceptance 第 7 项；Fake 契约测试不能替代）。
8. **事件/投影**：4 个新 v1 事件（全在 DomainEvent/KNOWN 同一基线落地；handler + isHandledEventType 各 lane 同一 commit）；ReadModel 投影 workContext 视图：key=canonicalJson(完整 ref)，binding+notes（LANE-A）+ continuations（LANE-B）；freshness opaque cursor（not_ready≠not_found）；只展示不判定；重启等价（close→reopen 同文件逐字段一致 + observedCursor 一致；isP116Ready() 探针——lane 未落地时自动 skip，绝不假实现）。
9. **边界**：不做 P1-17（完成后历史继承）、P1-09（QueryJob——只记录接续观察）、P1-10（暂停/恢复控制）；不实现新 Work Agent/MemoryStore/Context Plane；不改 P1-03/05/06/08 冻结形状；无 Findings/Decision。

## P1-16 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| 契约/纯函数 | src/contracts/context-continuity.ts | WorkContextBindingV1/Snapshot、ExecutionNoteV1/Snapshot、ContextContinuationResultV1/Snapshot、4 refs、4 命令+回执、4 事件、fingerprints、WorkRecordPort、WorkContextViewQuery/Result、上限常量、executionNoteBody |
| Context 端口 | src/contracts/work-context-port.ts | WorkContextPort/RequestV1/BundleV1/ManifestV1/Gap/RejectionCode、WORK_CONTEXT_BUNDLE_MAX_BYTES |
| Runtime 端口 | src/contracts/context-continuation-port.ts | ContextContinuationPort、ContinuationCapabilitiesV1、CapabilityResult、CheckV1、ObservationV1 |
| ledger/validation 扩展 | src/contracts/{ledger,ledger-validation,validation,events,modules,goal-view,index}.ts | 4 commitKind + validateXxxCommit（双适配器共用）+ 4 命令/请求/note/result 校验器 + DomainEvent/KNOWN + ControlEngine 4 个版本化新增 + ReadModelIndex.workContext |
| fixtures | src/contracts/fixtures/context-fixtures.ts | P116_* 常量（两 Project 复用同 local ids）、buildWorkContextBindingV1、buildBindWorkContextCommand/buildLinkWorkRunCommand/buildExecutionNoteV1/buildRecordExecutionNoteCommand/buildContextContinuationResultV1/buildRecordContinuationCommand、4 个 ledger-fold builder |
| Control 入口 | src/control/work-record.ts | WorkRecordEngineImpl（stub→lane A）；control-engine.ts 仅委托 |
| Context/运行时面 | src/context/work-context-compiler.ts、src/runtime/context-continuation-adapter.ts | WorkContextCompilerImpl（stub→lane B）；FakeContextContinuationRuntimeAdapter（capabilities 已实现；checkContinuation→lane B） |
| harness | src/harness/{in-memory,persistent}-harness.ts | workContext/contextContinuation 默认接线 + bindWorkContext/linkWorkRun/recordExecutionNote/recordContinuation/workContextView/assembleWorkContext/continuationCapabilities 直通 + options {workContext?, contextContinuation?} |
| 契约套件 | tests/contract-suite/{p1-16-harness,context.continuity.contract.suite}.ts | P1_16TestHarness/FACTORY、runP116ContinuityScenario、defineContextContinuityContractSuite（InMemory+SQLite 同套件；5 组 Acceptance + 5 组 verification） |
| 重启骨架 | tests/restart/p1-16-restart-fixtures.ts、p1-16-restart.test.ts、evidence/p1-16-evidence.test.ts | isP116Ready() 探针；实现落地后自动启用 |
| 集成接线 | tests/integration/p1-16.contract-suite.inmemory|sqlite.test.ts、p1-16.integration.test.ts | 双适配器套件接线（skipIf 探针）+ 真实 SQLite 全路径 + 重启等价 + 真实内核证据块 |

## 三路并行（P1-16，隔离 worktree → main 合并；从 a597eaf 派生）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A WorkRecord control + binding/notes 投影 | agent_platform-p1-16-a @ p1-16-lane-a | bindWorkContext/linkWorkRun/recordExecutionNote/recordContinuation 完整实现（守卫序+fold-equality+幂等映射）+ workContext 视图 binding/notes 部分（in-memory + sqlite，isHandledEventType 同 commit）+ 对应单元测试 | src/control/work-record.ts、src/read-model/read-model-index.ts（LANE-A 区域）、src/sqlite-read-model/sqlite-read-model-index.ts（LANE-A 区域）、tests/control/work-record.test.ts、tests/read-model/p1-16-work-context.test.ts、tests/sqlite-read-model/p1-16-work-context.test.ts | ⏳ 实施中（subagent b46eeaeb） |
| B Context assemble + continuation 面 + continuation 投影 | agent_platform-p1-16-b @ p1-16-lane-b | assembleWorkContext 完整实现（选材/预算/正文先落库/manifest）+ FakeContextContinuationRuntimeAdapter.checkContinuation + workContext 视图 continuation 部分（in-memory + sqlite）+ 对应单元测试 | src/context/work-context-compiler.ts、src/runtime/context-continuation-adapter.ts、src/read-model/read-model-index.ts（LANE-B 区域）、src/sqlite-read-model/sqlite-read-model-index.ts（LANE-B 区域）、tests/context/work-context-compiler.test.ts、tests/runtime/context-continuation-adapter.test.ts、tests/read-model/p1-16-continuation-projection.test.ts、tests/sqlite-read-model/p1-16-continuation-projection.test.ts | ⏳ 实施中（subagent 9ff178e2） |
| C 重启证据 + 集成 + 真实内核 | (integrator 合并后执行) | isP116Ready 探针硬化 + restart 逐字段一致 + 真实 SQLite 全路径集成 + 真实 coding-agent 接续验证（能力降级证据）+ P1-16-EVIDENCE 块 | tests/restart/p1-16-*、tests/integration/p1-16.* | ⏳ 待 lane A/B 合并 |

integrator 维护：package/lock/tsconfig/vitest、`src/contracts/**`、`src/harness/**`、`tests/contract-suite/**`（套件定义文件）、`tests/integration/**`（接线文件）、文档与状态记录、以及两条 lane 的**合并**。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结签名、**不得修改 P1-00…P1-08 文件或 P1-16 共享基线文件**；如有缺口：提交具体建议给 integrator 统一修改基线并通知消费者。允许测试命令：pnpm vitest run <自身路径>、pnpm typecheck。

**P1-16 integrator 合并预案（2026-09-06 更新：lane B 已 commit a1fcab4）**：补充 ⑥ lane B 的 WorkContextCompilerDeps 增加可选 readModel（assembly 从 ReadModelIndex.workContext 视图选材）——harness（in-memory/persistent）需由 integrator 把 readModel 注入 WorkContextCompilerImpl（共享面改动）；⑦ lane B 已完成"组合 workContext() 视图"（读自身 p116BindingRows/p116NoteRows 命名），与 lane A 的投影写入命名不同——合并时统一命名并保留 lane B 的组合方法。
原预案：①read-model 双 lane 均实现 workContext() 方法体（各自绑定+notes 或 continuations 组合）——合并时统一为一个组合实现：binding/notes（LANE-A 投影写入）+ continuations（LANE-B 投影写入）+ 单一 freshness 语义（observedCursor===null → not_ready；binding 缺失 → not_found）；②行存储 map 双份声明（p116Bindings/p116Notes vs p116BindingRows/p116NoteRows）——统一保留一套（视图方法读取与投影写入同名）；③isHandledEventType 同一函数多 hunk → 按并集（WorkContextBound/WorkRunLinked/ExecutionNoteRecorded/ContinuationRecorded 全 4 事件）；④sqlite read-model 同规则；⑤lane worktree 的 node_modules 为未跟踪符号链接，合并排除。均为例行 integrator 裁决，不触发 stop_condition (b)/(c)。

**P1-16 真实内核证据设计（integrator 2026-09-06 复核，kernel_root=/home/han001/projects/agents/coding-agent）**：真实 coding-agent 适配路径证据 = 测试内启动真实 CLI（dist/app/cli/main.js，已构建）headless：`run --cwd <fixture-ws> --config coding-agent.json --non-interactive`（首批可脚本化；kernel e2e 同款做法：本地 OpenAI 兼容 fixture server + env DEEPSEEK_API_KEY=fixture-secret，不开真实网络），随后 `resume --session <id>` 验证原会话**真实恢复/继续**（kernel 支持 run+resume 双路径，session 存于 sessions.sqlite）；适配器的 ContextContinuationPort.checkContinuation 将真实结果映射为 restored_original/took_over/unsupported；证据块记录（session id、output 摘要、session 文件字节、状态码、映射结果）。属"真实内核应用路径 + 模型端点替身"——模型端点替身是缺乏 provider 凭证时的明确降级证据，与"Fake 契约测试不能替代真实内核验证"边界一致；真实 provider 密钥若不可用，此替代方案即能力降级证据。

---

## P1-08 历史记录（已完成，保留备查；P1-16 在其上实施，P1-08 原文自本标题起未改动）

- Ticket：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/08-status-evidence-console.md`（P1-08，status 按阶段守卫保持 `proposed`；Implementation record 将在验收后追加票尾；**本票验收 ≠ 整个 P1 验收，P1-09/10/15 不自动开始**）
- P1-07 结束基线（upstream 已验收）：产品根 commit `404ab28`（typecheck 0 errors、88 files/722 tests PASS；P1-07 双套件 12/12×2、集成 1/1、重启证据 1/1、validate-docs 13/13；本地 main 未推送 GitHub origin main——推送需用户授权）。**P1-08 共享基线 = 本文件本次更新的 commit**（= 404ab28 + 本票新增 contract/validator/fixture/entry/suite/restart 骨架；既有 722 测试零回归——实施前复跑）。
- **冻结复用、不重写**：P1-00…P1-07 全部契约/夹具/套件/适配器/harness 零修改通过；P1-03/04/05/06/07 冻结形状**零改动，只版本化追加**（console 视图消费既有事件）；**不新增任何 DomainEvent**（KNOWN 列表不变；isHandledEventType 不变——既有类型已全部处理，新增处理分支与既有同 commit）；不改 Goal reducer。
- **P0-06 复核影响（已核对）**：`dev_docs/verification/2026-09-06-context-orchestration-sync.md` 明确——本票只做**只读展示**；主动通知、待决与变更上报归 P1-14/15；控制入口（pause/steer）与 QueryJob 归 P1-10/09；"查询工具是 HumanCollaboration 的候选访问能力，不据此新增独立 Module"（ARCHITECTURE §Plane）；G4 等待 P1-09 + P1-11；08 验收后（与 P1-16 产物一起）09/10 才可并行。
- **7 个 contracts_to_create（wire schema 以本票为准；非 interfaces_to_freeze——DAG 规则下首个真实消费者冻结仍适用，本票即首个消费者）**：PortfolioViewQuery / WorkspaceSummaryView / WorkspaceSelectionRoute / PlanMatrixViewQuery / ActiveAgentsViewQuery / TaskEvidenceViewQuery / TimelineViewQuery。

## P1-08 只读控制台契约与查询语义（冻结）

1. **范围与路由**：控制台 = HumanCollaboration **版本化扩展**（不新增 Module；ARCHITECTURE §Plane——查询工具是 HumanCollaboration 的候选访问能力）。`WorkspaceSelectionRoute = { projectId, workspaceId, goalId? }`——范围切换只改变查询参数，不写 canonical state、不创建隐式"当前 Workspace"事实（无持久化选择；重启后重新选择）。路由/列表/查询结果/缓存键一律 `canonicalJson(完整 ref)`（consoleWorkspaceKey / consoleGoalKey / consoleTaskKey）。
2. **全作用域键与隔离**：所有查询键 = (projectId, workspaceId)（+ 必要 goalId/taskId）；两 Project 可复用相同本地 `workspaceId/goalId` 且**不串读**（multi-project-workspace-isolation-test + same-local-id-scope-test 双适配器；P1-08 fixture 中 run/attempt/evidence 本地 id 也跨 Project 复用）。
3. **七个契约（全部 v1、有界、freshness 沿用 opaque cursor）**：见 src/contracts/console-views.ts——PortfolioViewQuery（至少两个隔离 Project/Workspace，来自版本化 bootstrap manifest 投影，P1-00）；WorkspaceSummaryView（workspace 级摘要：Goal/Task/AgentRun/Evidence/reduction/goalPhase 计数 + TaskReduction/GoalPhase 相位计数，只从既有事件聚合）；PlanMatrixViewQuery（任务×阶段网格：PlanRevisionAccepted 的 planGraph 事实 + TaskReduction 正式 phase 叠加，**正式 phase 与计划声明分列（plannedPhase/livePhase + phaseMismatch）**）；ActiveAgentsViewQuery（范围化活跃 Agent 行：TaskClaimed/RunStarted/run 事实聚合，displayState 含 outcome_unknown/crashed/cancelled 明确标注——"持续/转交/未知结果按来源展示，不伪装完成"）；TaskEvidenceViewQuery（任务 Evidence 详细：证据 id/outcome/source.runRef/coverage/applicability 纯函数重算/summary 摘要——**不 open vault 正文（bodyPolicy:"ref_only"）**；完成结论链接 effectiveEvidenceIds）；TimelineViewQuery（workspace 级有界时间线：goal/task/reduction/evidence/handoff/run 事实混排，每条带 kind + eventId + sourceCursor + refs 链，只展示，last maxEntries 窗口）。
4. **来源配对（displayed phase → revision/cursor）**：每条展示带 sourceCursor/updatedAt/ref；完成结论可追到当前 EffectiveEvidenceSet（P1-04 effectiveEvidenceIds）；解释（reasonCodes/explanation）独立标注 manifest 与 revision——映射 human-design-status 的 pending/ready/stale/unavailable 四态（P1-08 无模型语义解释 → modelExplanation.status 恒为 "unavailable"，确定性 reason codes 在 reduction.causes 并带 sourceCursor）。
5. **正式 vs 报告分离**：TaskReduction/GoalPhase 正式 phase 与 CompletionClaim/verdict/ReviewPacket 报告分种类标明来源（EvidenceFormalMarker：claim/verdict → unverified_report；observation → observed_fact）；"报告明确是 report，不替代正式 phase"。
6. **纯事实查询零模型**：console 查询路径只依赖 ReadModelIndex（HumanCollaborationImpl console 方法为纯委托，不经 control/runtime）；no-model-status-query-test 用探针断言查询期间无 RunPort 调用；不刷新 Worker lease、不启动模型。
7. **只读适配器面**：HumanCollaboration 的 console 扩展只经 ReadModelIndex 接口消费（双适配器）；adapter 不能直接读 SQLite 表（console_* 表只存在于 read-model 库文件；ledger 库文件无 console_* 表——read-only-adapter-test 断言）；ledger.commit/close 等不可达（TrapControlEngine/TrapStateLedger 断言）。
8. **事件与投影**：**不新增任何 DomainEvent**（全部消费既有事件：WorkspaceBootstrapped/GoalCreated/PlanRevisionAccepted/TaskClaimed/RunStarted/RunEventRecorded/RunOutcomeUnknown/EvidenceAdmitted/TaskReductionUpdated/GoalPhaseUpdated/HandoffRecorded/ReplacementClaimed）；KNOWN 与 isHandledEventType **不变**（既有类型已全部处理），新增处理分支经 advance() 的 applyP108Console 钩子与既有 handler 同一 commit 落地。
9. **重启等价**：全部新投影持久化（sqlite read-model 表：console_portfolio/summary/matrix/agent/evidence/timeline，JSON 行 + full-scope key）+ 从持久 EventPage 重建逐字段一致 + observedCursor 一致（isP108Ready() 探针；tests/restart/p1-08-*）；控制台自身无状态可持久化。

**边界**：不做 P1-09（QueryJob/非阻塞模型查询）、P1-10（pause/stop/安全点控制——只展示状态）、P1-11/14/15（目标修改、主动通知、议题/决定闭环——被动展示已存在事实，本票不主动通知）；不改 P1-03/04/05/06/07 冻结形状（零改动，只版本化追加）；不改 Goal reducer；无 Findings；无隐藏 control/QueryJob/Planner side effect（验收 12）。

**显示上限（冻结常量）**：CONSOLE_TIMELINE_MAX_ENTRIES=200、CONSOLE_ACTIVE_AGENTS_MAX_ROWS=100、CONSOLE_MATRIX_MAX_TASKS=512、CONSOLE_EVIDENCE_SUMMARY_MAX_BYTES=4096、CONSOLE_PORTFOLIO_MAX_PROJECTS=64。

## P1-08 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| 查询契约 | src/contracts/console-views.ts | 7 个契约（PortfolioViewQuery/WorkspaceSelectionRoute/PlanMatrixViewQuery/ActiveAgentsViewQuery/TaskEvidenceViewQuery/TimelineViewQuery + WorkspaceSummaryView）+ 视图类型 + 上限常量 + full-scope key 纯函数 + ConsoleExplanationStatus/EvidenceFormalMarker |
| 接口扩展 | src/contracts/{goal-view,modules}.ts | ReadModelIndex +6（consolePortfolio/consoleSummary/consolePlanMatrix/consoleActiveAgents/consoleTaskEvidence/consoleTimeline）；HumanCollaboration +同 6（版本化追加，createGoal/goalView 形状不变） |
| fixtures | src/contracts/fixtures/console-fixtures.ts | P108_* 常量（两 Project 复用同 workspaceId/goalId）、P108_PLAN_REVISION_FIXTURE_V1、p108GoalScope（不同 objective）、buildP108*Command 全组、consoleBoundExpectation/p108TimelineMax、P108 runtime scripts |
| console 实现 | src/interaction/human-collaboration.ts | HumanCollaborationImpl 6 个 console 方法（纯委托 readModel；只读面） |
| 双适配器 | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts | 6 个 query 签名（baseline stub→lane 实现）、applyP108Console 钩子（lane A/B 区域）、sqlite console_* 表 + JSON 行 I/O 助手 |
| harness | src/harness/{in-memory,persistent}-harness.ts | 6 个 console 直通 + options {runtime?} |
| 契约套件 | tests/contract-suite/{p1-08-harness,console.contract.suite}.ts | P1_08TestHarness、runP108TwoProjectScenario（两 Project 全场景）、defineConsoleContractSuite（12 项验收 + 7 组 verification，InMemory+SQLite 同套件） |
| 重启骨架 | tests/restart/p1-08-*（fixtures/test/evidence） | isP108Ready() 探针；实现落地后自动启用 |
| 集成接线 | tests/integration/p1-08.* | 双适配器套件接线（skipIf 探针）+ 真实 SQLite 全路径 + read-only-adapter sqlite 断言 + 重启等价 |

## 三路并行（P1-08，隔离 worktree → main 合并；从本基线 commit 派生）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A Portfolio/Summary + 只读面 | agent_platform-p1-08-a @ p1-08-lane-a（694a14f） | consolePortfolio + consoleSummary 双适配器投影（重建等价、全键隔离、same-local-id、freshness）+ 对应 projection 单元测试 + read-only-adapter/console 只读面核对 | src/read-model/read-model-index.ts（LANE-A 区域）、src/sqlite-read-model/sqlite-read-model-index.ts（LANE-A 区域）、tests/read-model/p1-08-portfolio-summary.test.ts、tests/sqlite-read-model/p1-08-portfolio-summary.test.ts | ✅ 10/10（主分支已合并） |
| B Matrix/Agents/Evidence/Timeline 投影 | agent_platform-p1-08-b @ p1-08-lane-b（3e83a96） | consolePlanMatrix + consoleActiveAgents + consoleTaskEvidence + consoleTimeline 双适配器投影（重建等价、全键隔离、same-local-id、freshness、正式/报告分列、持续/转交/未知按来源展示）+ 对应 projection 单元测试 | src/read-model/read-model-index.ts（LANE-B 区域）、src/sqlite-read-model/sqlite-read-model-index.ts（LANE-B 区域）、tests/read-model/p1-08-matrix-agents-evidence-timeline.test.ts、tests/sqlite-read-model/p1-08-matrix-agents-evidence-timeline.test.ts | ✅ 10/10（主分支已合并） |
| C 重启证据 + 集成 + 端到端 | (integrator 合并后执行) | isP108Ready 探针硬化 + restart 逐字段一致 + 真实 SQLite 全路径集成 + portfolio-list-and-switch/multi-project 隔离/cursor-freshness 端到端核对 + P1-08-EVIDENCE 块（仿 p1-07-evidence） | tests/restart/p1-08-*、tests/integration/p1-08.* | ✅ restart 1/1、集成 1/1、evidence 块已采集 |

integrator 维护：package/lock/tsconfig/vitest、`src/contracts/**`（公共 schema/接口/共享 fixture）、`src/harness/**`、`tests/contract-suite/**`（suite 定义文件）、`tests/integration/**`（接线文件）、文档与状态记录、以及两条 lane 的**合并**（LANE-A/LANE-B 区域互不重叠；唯一冲突 = console-views 常量 import 并集，当场解决了）。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结签名、**不得修改 P1-03/04/05/06/07 文件**、不得修改 isHandledEventType（无新事件类型）；如有缺口：提交具体建议给 integrator 统一修改基线并通知消费者。允许测试命令：`pnpm vitest run <自身路径>`、`pnpm typecheck`。

**P1-08 integrator 补充裁决（验收后记录，见 p1-08-implementation-evidence.md §4）**：①**agentRunCount 语义** = TaskClaimed + ReplacementClaimed（replacement 同样创建新 Agent Run；与 ActiveAgents 行数一致：A=3/B=2；lane A 报告原按纯 TaskClaimed 计数 A=B=2，采纳本裁决并同步其单元测试）；②**replacement run 真实启动**：场景 claimReplacement 后改走 `handoffDrive.driveHandoff`（P1-06 路径；普通 DispatchPort.drive 按守卫跳过 replacement intent），因此 ActiveAgents 的 ongoing 行由真实 RunStarted/RunEventRecorded 事实驱动（lane B 在 ReplacementClaimed 处先行创建行仅作防御）；③**maxEntries 冻结语义** = 正整数上限生效（1→1）；undefined/0/负 → CONSOLE_TIMELINE_MAX_ENTRIES 默认；④**共享 run-id 助手修正**：p108RunOfWork/p108RunOfExtra 由 project 派生场景字面量（proj-alpha→a、proj-beta→b）；⑤**SQLite 扫描**：canonicalJson 键不保证 workspace 前缀顺序，agent 行扫描用整表 + JS 过滤（注释已说明）；⑥**replacement run binding 占位**：ReplacementClaimed/RunStarted 事件不携 roleBinding，展示行用稳定占位（与 P1-07 租约视图同先例，仅展示）。
## P1-07 历史记录（已完成，保留备查；P1-08 在其上实施，P1-07 原文自本标题起未改动）

## P1-07 当前票据与共享契约基线

- Ticket：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/07-parallel-readers-single-writer.md`（P1-07，status 按阶段守卫保持 `proposed`；Implementation record 将在验收后追加票尾；**本票验收 ≠ 整个 P1 验收，P1-12/15 不自动开始**）
- P1-06 结束基线（upstream 已验收）：产品根 commit `f3a6a71`（typecheck 0 errors、76 files/641 tests PASS；P1-06 双套件 25/25×2、集成 1/1、重启证据 1/1、validate-docs 12/12——**本票执行时点文档校验已是 13/13**；本地 main 未推送 GitHub origin main——推送需用户授权，P1-04/05/06 先例）。**P1-07 共享基线 = 本文件本次更新的 commit**（= f3a6a71 + 本票新增 contract/validator/fixture/entry/suite/restart 骨架；既有 641 测试零回归——实施前复跑）。
- **冻结复用、不重写**：P1-00…P1-06 全部契约/夹具/套件/适配器/harness 零修改通过；P1-03 冻结的 TaskLease/TaskAttempt/Run/DispatchOutboxEntry/TaskEnvelope/DispatchIntentV1 形状**不修改**；P1-04 的 Evidence/EvidenceAdmitted/applicability/EffectiveEvidenceSet 与 ReduceTask **不修改**（join 不改变 evidence 归约语义，只提供 join 事实与冲突面）；P1-05 的 goal-phase/goal-reducer 全部文件**不修改**（本票验证 Gate Evidence 路径与 reducer 可用，不重写 reducer）；P1-06 的 handoff/replacement/handoff-control 全部文件**不修改**、只被引用（Reader 输出可作 Handoff 是消费，不是改写）。
- **P0-06 复核影响（AGENTS.md 要求，已核对）**：`dev_docs/design/human-framework-role-review.md` 结论与本票无冲突——"并行、只读和写入权限是执行机制，不能代替角色定义"（= 本票只做权限与并发证据，角色语义归 P1-15）；"同一 checkout 的写入安全仍需验证"（= 不变量 #7 + competing-writer-lease-test）；"多个规划／集成者可分别负责工作包…独立 Worker 不因某个包工头退出而终止"（= 新增第 8 项 Acceptance 的运行隔离）；"双只读并行"不再单独代表 G3 门禁（G3 = 07+15，本票只交付 07 侧证据）。
- **两个最小 Interface 首次冻结**（DAG interfaces_to_freeze）：`DispatchEngine.WorkspaceLeasePort`（src/contracts/workspace-lease.ts：acquireReadLease/acquireWriteLease/releaseLease）与 `WorkerRuntime.WorkspaceCapabilityPort`（src/contracts/workspace-capability.ts：capabilitiesFor → ready/unsupported/rejected）——已建、版本化（v1）、以契约套件 + 集成接线作为最小 contract test；本票同时新建 5 个契约（WorkspaceReadLease、WorkspaceWriteLease、ConflictScope、IntegrationTaskResult、PatchArtifact）与 3 个视图契约 + WorkspaceDrivePort（并行驱动面，版本化新增，不修改 P1-03 DispatchPort）。

## P1-07 契约与存储语义（冻结）

1. **ConflictScope（全键、可组合、相交即冲突）**：`ConflictScopeV1 = { schemaVersion: 1, projectId, workspaceId, kind: "workspace"|"module"|"path"|"task"|"stage"|"goal", id, revision: number|null }`（id = workspaceId | moduleRef | 路径前缀 | taskId | stageId | goalId；revision 为信息性 workspace revision，**不参与 overlap**）。**scopeOverlap(a,b)（纯函数，冻结）**：projectId+workspaceId 相同且（任一方 kind="workspace" → true；kind+id 完全相同 → true；双方为 path-like（module|path）且一方前缀 ⊆ 另一方前缀（a.id===b.id || a.id.startsWith(b.id+"/") || b.id.startsWith(a.id+"/")）→ true；其余 false——不做语义推断，task/stage/goal label 与 path 之间、不同 label 之间不推断为相交）。**scopeKey / conflictScopeKeyFor**（canonical JSON）用于索引与唯一性；**scopeCoveredByWriteScope(scope, declaredWriteScope)**（纯函数）：path-like → 某 entry 是 id 本身或祖先目录（id.startsWith(entry+"/")）；workspace → entry===workspaceId 或 "*"；label kind → 精确匹配。**越权即拒**：Writer lease 的 scope 必须 ⊆ 绑定声明的 writeScope（scope_not_declared，零写入）；**普通读不升级成写**：acquireReadLease 永不给写能力，写 lease 只由 acquireWriteLease 授予且要求 workspaceWrite 能力。
2. **WorkspaceReadLease（共享、可重叠、可重入）**：`WorkspaceReadLeaseV1 = { schemaVersion: 1, leaseId, projectId, workspaceId, scope: ConflictScopeV1, holder: {runRef, attemptRef, roleBinding}, grantedAt, expiresAt: string|null, status: "active"|"released", releasedAt: string|null, releasedBy: "holder"|null }`。读-读永不互斥（同 scope 多 reader 可同时持有；同 run 同 scope 可重入）；读-写相交即冲突：acquire read 时存在**重叠 scope 的 active write lease** → read_lease_conflict（若 write lease 已过期 → 过期即释放语义，见下）；acquire write 时存在**重叠 scope 的 active read lease** → read_lease_conflict。**到期语义（MVP 记录与判定，不做自动回收——P1-10）**：`evaluateLeaseAdmissibility` 视 `status==="active" && (expiresAt===null || expiresAt > now)` 为有效；过期未释放的 lease 不再阻断请求方，但仍是 released-worthy（持有人可 release，返回 already_expired 提示不写状态——只记录）。Reader 输出只允许作为 Evidence、Artifact、Handoff——**任何写接口/命令（acquireWriteLease、recordPatch、recordIntegration 结果里的写声明）在 reader context 被拒绝**（capability_readonly，零写入）——read-only-capability-enforcement。
3. **WorkspaceWriteLease（独占、显式 acquire/release）**：`WorkspaceWriteLeaseV1 = { schemaVersion: 1, leaseId, projectId, workspaceId, scope, holder: {runRef, attemptRef, roleBinding}, grantedAt, expiresAt: string|null, status, releasedAt, releasedBy, patches: PatchRecordRef[], postWriteWorkspaceRevision: number|null }`。**唯一性 = ledger 聚合 CAS**：每个 (project, workspace) 一个 `WorkspaceWriteLeaseIndex` 聚合（{ref, revision, activeLeaseId, activeScope, holderRunRef}）；acquire 以 `index@N→N+1` CAS 且要求 activeLeaseId===null（**同一 checkout 同时至多一个 Writer = 不变量 #7，等价强于 scope 级独占**；competing-writer-lease-test = 两 Writer 并发 acquire 至多一个 committed，败者 `write_lease_conflict` 零写入、可读回）；release 以 index CAS 清空 + WriteLease@2（status=released）。**无重试/抢占/Force-release（P1-10）**；holders 只能释放自己的 lease（not_holder 零写入）；已释放再释放（新 commandId）→ already_released。
4. **能力声明（WorkerRuntime.WorkspaceCapabilityPort）**：`WorkspaceCapabilitiesV1 = { schemaVersion: 1, workspaceId, workspaceRead: boolean, workspaceWrite: boolean, maxWriteScope: ConflictScopeV1|null, source: "runtime"|"declared-permissions" }`；`capabilitiesFor(envelope) → {status:"ready", capabilities} | {status:"unsupported"} | {status:"rejected", reason}`——**无能力 → unsupported，绝不静默降级**（acquire/write guard 收到 unsupported → capability_unsupported 零写入）。能力 = 运行时支持 ∩ envelope.permissions.tools（read→"read"、write→"write"）。**evaluateWorkspaceOperation(capabilities, {kind:"read"|"write", scope}) → allowed | {code: "capability_readonly"|"scope_exceeds_capability"...}**（纯函数，冻结）。FakeWorkspaceCapabilityAdapter（src/runtime/workspace-capability-adapter.ts）按运行时可配支持矩阵声明；reader run（envelope.tools=["read"]）→ workspaceWrite=false。
5. **PatchArtifact（Writer 产出，body-first）**：`PatchArtifactV1 = { schemaVersion: 1, patchId, projectId, workspaceId, goalId, taskId(Writer task), planRef, taskRevision, runRef, attemptRef, roleBinding, kind: "patch"|"commit", title, changedPaths: string[] (≤256), bodyRef: ArtifactRef(body-first — patch/commit 正文入 ArtifactVault，Control 只登记引用，与 P1-03/04/06 一致), beforeWorkspaceRevision, afterWorkspaceRevision, checkResults: {checkId, outcome: PASS|FAIL|INCONCLUSIVE, summary(≤4096B)}[] (≤64), usedInputEvidenceRefs: EvidenceRef[] (≤128 — Writer 使用的**已接受** Reader 输出), generatedAt }`。**登记守卫**（recordPatch）：shape 校验 → writer Run 存在且已 ended（run_not_found / run_not_ended）→ write lease 存在且 active 且 holder.runRef===writer runRef（lease_not_found / not_holder）→ patch.changedPaths 全部 ⊆ lease.scope（scope_mismatch 零写入——patch 不能越出 writer lease）→ **beforeWorkspaceRevision === canonical Workspace revision**（stale_workspace 零写入）→ 原子 commit：`PatchRecorded` + `WorkspaceWriteLeaseReleased` 两事件 + [PatchRecord@1, Workspace@N+1, WriteLease@2(released, postWriteWorkspaceRevision=N+1, patches+=[ref]), WriteLeaseIndex@N+1(activeLeaseId=null)] 快照，expectedVersions [Workspace@N CAS、WriteLease@active、WriteLeaseIndex@active] —— **post-write workspace revision 推进 = canonical 单调 CAS（N→N+1），与 patch 登记同一原子 commit**（本字段已有等价先例：Workspace 聚合 revision 由 ledger CAS 单调推进——核实现场代码后采用"patch 登记原子携带"而非另造推进机制）。显式 release（无 patch 路径）不推进 workspace revision。
6. **IntegrationTaskResult（join；冲突保留不覆盖）**：`IntegrationTaskResultV1 = { schemaVersion: 1, resultId, projectId, workspaceId, goalId, taskId(Integration task), planRef, taskRevision, runRef(integration dispatch Run), attemptRef, workspaceRevision, inputs: IntegrationInputRefV1[] (≤64；{sourceTaskId, sourceRunRef, kind: "evidence"|"artifact"|"handoff", evidenceRef?: EvidenceRef, artifactRef?, handoffPacketRef?}), conflicts: EvidenceConflictRecordV1[] (≤64), gaps: IntegrationGapV1[] (≤32；expected 输入缺失/未接受), explanation: string|null (≤4096B；conflicts 存在时必须非空，除非 escalate — 否则 conflict_unresolved 零写入), escalate: boolean (escalate=true 要求 conflicts 非空，否则 invalid；本票只记录"need escalation"标记，不做 P1-15 语义路由), generatedAt }`。**证据冲突判定 = 纯函数 `detectEvidenceConflicts(joined)`（冻结，机械、无语义推断）**：对每对同 (coverage: obligationId+requirementId, 同 planRevision+workspaceRevision tuple) 的输入 evidence，若 applicability 均 APPLICABLE 且 outcome 不同（PASS/FAIL/INCONCLUSIVE 两两不同）且来源 Run 不同 → 一条 conflict（{conflictId, conflictKey=sha256(canonicalJson({obligationId, requirementId, planRevision, workspaceRevision})), kind:"outcome_disagreement", obligationId, requirementId, planRevision, workspaceRevision, evidence: [{evidenceId, outcome, runRef, applicability}], detectedAt}）。**Control 守卫**（recordIntegration，零写入拒绝）：shape → 集成 Run 存在且 ended → workspace/plan/planRevision 与 canonical 一致（stale_source）→ 每个 input 的 Evidence/Artifact/Handoff 引用在 ledger 存在且（evidence 的 source.runRef === 声明 sourceRunRef）→ 纯函数 join → conflicts 存在但不解释不升级 → conflict_unresolved；→ **不可覆盖**：IntegrationResult 聚合按 (project, goal, task) 累积（rev=记录数，expectedRevision CAS——第一个 join expected 0，后续 expected N 错配 → revision_conflict 零写入）；若新记录的任一 conflictKey 已在聚合记录中出现（同 key 且未变）→ conflict_duplicate 零写入（后到结果不能覆盖；同 identity+fingerprint 重试 → 幂等 replayed）。Join 不改 Evidence/applicability/reduction（P1-04/05 公式原样），只提供 join 事实与冲突面。IntegrationTask 本身 = 正式 dispatch Run（claim/start/runFact 全走 P1-03 路径，envelope sourceRefs 引用 reader 输出）。
7. **事件/视图（6 个新 v1 事件，全部 aggregateRevision 规则见下；进 DomainEvent + KNOWN 与 isHandledEventType 同 commit 原子落地）**：`WorkspaceReadLeaseGranted`（lease@1 + index 快照 N+1）、`WorkspaceReadLeaseReleased`（lease@2 + index N+1）、`WorkspaceWriteLeaseGranted`（lease@1 + index N+1）、`WorkspaceWriteLeaseReleased`（lease@2 + index N+1；patch-record 路径与 PatchRecorded 同 commit）、`IntegrationJoined`（result@N+1；payload 载全部 records 的有界子集——conflict 摘要+explanation/escalate 标记，视图不依赖聚合加载）、`PatchRecorded`（patch@1 + Workspace@N+1；payload 载 PatchArtifactV1 有界字段）。视图（`src/contracts/workspace-views.ts`，ReadModel 只展示不判定）：① writerLease 状态视图（key=(projectId, workspaceId)；active/released + holder/scope/grantedAt/postWriteWorkspaceRevision/patches）；② integrationConflict 视图（key=(projectId, goalId, taskId)；records 有序 + conflictKey 首记录权威 + late duplicate 标记 + escalation 标记）；③ workspacePatch 视图（key=(projectId, workspaceId)；patch 列表 + 当前 workspace revision 推进）。KNOWN 新增与 isHandledEventType 新增同一 commit；未知事件仍 unsupported_event_type 整页停止。
8. **重启等价**：6 个 commitKind 全经 SQLite 单事务（InMemory/SQLite 共用 ledger-validation 纯校验器）；重启后（close→reopen 同文件、全新实例）lease/index/PatchRecord/IntegrationResult/Workspace revision 快照 load 逐字段一致、三视图从持久 EventPage 重建逐字段一致、observedCursor 一致（tests/restart/p1-07-*，探针 isP107Ready() 自动启用）。ArtifactVault 正文持久化不在本票——与 P1-03/04/06 相同只存引用。

## P1-07 已冻结的代码入口（integrator 建立，签名冻结）

| 入口 | 文件 | 冻结表面 |
| --- | --- | --- |
| workspace-lease 契约/纯函数 | src/contracts/workspace-lease.ts | ConflictScopeV1、WorkspaceReadLeaseV1/Snapshot/Ref/IndexRef+Snapshot、WorkspaceWriteLeaseV1/Snapshot/Ref/IndexRef+Snapshot、Acquire/Release 命令+回执、4 事件、LeaseFacts/LeaseIneligibilityReason/LeaseAdmissibility、evaluateLeaseAdmissibility（纯）、scopeOverlap/conflictScopeKeyFor/scopeCoveredByWriteScope（纯）、fingerprints、DispatchEngine.WorkspaceLeasePort（acquireReadLease/acquireWriteLease/releaseLease + LeasePortDeps）、上限常量（输入≤64、冲突≤64、explanation≤4096B） |
| workspace-capability 契约 | src/contracts/workspace-capability.ts | WorkspaceCapabilityPort（capabilitiesFor → ready/unsupported/rejected）、WorkspaceCapabilitiesV1、evaluateWorkspaceOperation（纯） |
| integration 契约 | src/contracts/integration.ts | IntegrationTaskResultV1、IntegrationResultRef/Snapshot、RecordIntegrationResultCommand/Receipt、IntegrationJoinedEvent、EvidenceConflictRecordV1/IntegrationGapV1/IntegrationInputRefV1、detectEvidenceConflicts（纯）、recordIntegrationFingerprint |
| patch 契约 | src/contracts/patch.ts | PatchArtifactV1、PatchRecordRef/Snapshot、RecordPatchCommand/Receipt、PatchRecordedEvent、recordPatchFingerprint、上限常量 |
| 视图契约 | src/contracts/workspace-views.ts | WorkspaceLeaseViewQuery/Result、IntegrationConflictViewQuery/Result、WorkspacePatchViewQuery/Result（只展示） |
| 并行驱动契约 | src/contracts/workspace-drive.ts | WorkspaceDrivePort.driveParallel(trigger) → DispatchDriveResult（版本化新增，不改 P1-03 DispatchPort） |
| fixtures | src/contracts/fixtures/workspace-fixtures.ts | P107_* 常量、P107_PLAN_REVISION_FIXTURE_V1（2 个无 dependsOn work reader + 1 个显式 depends_on 双 readers 的 integration work + 1 个 depends_on integration 的 writer work + 1 个 depends_on writer 的 goal gate；义务/VR 全套），buildP107PlanRef/buildXxxCommand（acquire-read/acquire-write/release/record-integration/record-patch）fold 目标、P107 runtime script 选择器工厂 |
| ledger/validation 扩展 | src/contracts/{ledger,ledger-validation,validation,events,index}.ts、src/contracts/{modules}.ts | 6 commitKind（workspace-read-lease-acquire/release、workspace-write-lease-acquire/release、integration-record、patch-record）+ validateXxxCommit（双适配器共用）+ validateXxxCommand + DomainEvent/KNOWN + 6 事件 + ControlEngine 5 个版本化新增（acquireWorkspaceReadLease/acquireWorkspaceWriteLease/releaseWorkspaceLease/recordIntegrationResult/recordPatch） |
| Control 入口 | src/control/workspace-lease.ts、integration-join.ts、patch-record.ts | WorkspaceLeaseEngineImpl（stub→lane A）、recordIntegrationResult（stub→lane B）、recordPatch（stub→lane C）；control-engine.ts 仅委托 |
| 并行驱动 | src/control/workspace-drive.ts | WorkspaceDriveEngineImpl.driveParallel（stub→lane B；assemble→startRun→runtime.start 全并发开始，之后并发 consume；替换意图跳过；outbox-before-side-effect 不变） |
| 运行时面 | src/runtime/workspace-capability-adapter.ts、src/runtime/fake-runtime-adapter.ts | FakeWorkspaceCapabilityAdapter（stub→lane A；能力声明矩阵；reader run 无写能力）；FakeRuntimeAdapter **扩展**（按 envelope 选脚本 perRunScript 选择器 + 虚拟时钟/运行迹 trace——baseline 已实现，默认行为与 P1-03 逐字节一致） |
| harness | src/harness/{in-memory,persistent}-harness.ts | workspaceLease/workspaceCapability/workspaceDrive 默认接线 + acquireReadLease/acquireWriteLease/releaseLease/recordIntegrationResult/recordPatch/workspaceLeaseView/integrationConflicts/workspacePatches 直通 + options {workspaceCapability?, workspaceLease?, workspaceDrive?, runtime?} |
| 契约套件 | tests/contract-suite/{p1-07-harness,workspace.contract.suite}.ts | P1_07TestHarness/FACTORY、prepareP107Scenario、runP107Reader/runP107Writer 助手、defineWorkspaceContractSuite（InMemory+SQLite 同套件；覆盖 8 项 Acceptance + 5 组 verification） |
| 重启骨架 | tests/restart/p1-07-restart-fixtures.ts、p1-07-restart.test.ts、evidence/p1-07-evidence.test.ts | isP107Ready() 探针；实现落地后自动启用 |
| 集成接线 | tests/integration/p1-07.contract-suite.inmemory|sqlite.test.ts、p1-07.integration.test.ts | 双适配器套件接线（skipIf 探针）+ 真实 SQLite 全路径 + 重启等价 |

## 三路并行（P1-07，隔离 worktree → main 合并；从本基线 commit 派生）

| Lane | 分支/worktree | 职责 | 写入范围（互不重叠） | 状态 |
| --- | --- | --- | --- | --- |
| A Workspace lease + capability（Control/Process 面） | p1-07-lane-a @ 339d3ac | WorkspaceLeaseEngineImpl acquire/release 完整实现（run/workspace/plan 守卫序 → evaluateLeaseAdmissibility → 独占 CAS → fold → commit → 回执映射；幂等零写入；already_released/not_holder/expired）+ FakeWorkspaceCapabilityAdapter（能力声明矩阵；reader run 无写能力；unsupported 显式）+ read-only-capability-enforcement + competing-writer-lease-test + 运行隔离用例（协调者退出不撤销 Worker 合法 lease） | src/control/workspace-lease.ts、src/runtime/workspace-capability-adapter.ts、tests/control/workspace-lease.test.ts、tests/runtime/workspace-capability-adapter.test.ts | ✅ 26/26（主分支已合并） |
| B 双 Reader 并行 + IntegrationTask（Dispatch/Process 面） | p1-07-lane-b @ d379181 | WorkspaceDriveEngineImpl.driveParallel（真实重叠：全部独立 intent 先 assemble→startRun→runtime.start 并发开始，再 Promise.all consume；替换意图跳过；outbox-before-side-effect）+ recordIntegrationResult 完整实现（守卫 → detectEvidenceConflicts → conflict_unresolved → conflict_duplicate 不可覆盖 → CAS 累积）+ real-run-overlap-measurement + evidence-conflict-test + 正式 dispatch 集成 run | src/control/workspace-drive.ts、src/control/integration-join.ts、tests/control/workspace-drive.test.ts、tests/control/integration-join.test.ts | ✅ 9/9（主分支已合并） |
| C ReadModel 投影 + 重启证据 + Writer/patch 端到端 | p1-07-lane-c @ c15b694 | 6 事件双适配器投影（writerLease/integrationConflicts/workspacePatches；重建等价、全键隔离、freshness、只展示）+ isHandledEventType 与 handler 同 commit + recordPatch 完整实现（守卫 → 原子推进 workspace revision CAS + 释放 lease）+ tests/restart/p1-07-*.ts（isP107Ready 探针硬化 + 逐字段一致）+ goal-gate-full-check 端到端 + 契约证据块 | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts、src/control/patch-record.ts、tests/read-model/p1-07-*.test.ts、tests/sqlite-read-model/p1-07-*.test.ts、tests/restart/p1-07-*.ts | ✅ 19/19（主分支已合并） |

integrator 维护：package/lock/tsconfig/vitest、`src/contracts/**`（公共 schema/接口/共享 fixture）、`src/ledger/**`、`src/sqlite-ledger/**`、`src/control/control-engine.ts`、`src/harness/**`、`tests/contract-suite/**`、`tests/integration/**`、文档与状态记录。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结签名、**不得修改 P1-03/04/05/06 文件**（如有缺口：提交具体建议给 integrator 统一修改基线并通知消费者）。子 Agent 从实际读文件开始，不等待派发者；允许测试命令：`pnpm vitest run <自身路径>`、`pnpm typecheck`。

**P1-07 integrator 补充裁决（验收后记录，见 p1-07-implementation-evidence.md §2/§5）**：①DAG readiness 的 plan 不可变是 P1-03 冻结事实——新增 `src/control/dispatch-facts.ts::loadLivePlan`（只读派生：TaskReduction phase 覆盖计划 phase），readiness + claim 签名不变；②taskRevision 契约类型为 number（validator 修正）；③P1-03 drive startRun idempotencyKey 改为 run-scoped（潜在缺口，P1-07 修复）；④release 校验 expectedRevision=1；⑤冲突场景用 plan 变体（FAIL 依赖阻塞属 DAG 正确语义，不应绕过）；⑥GoalGate 全量检查 = patch 后 canonical revision 全量再验证（P1-05 reducer 冻结未改写）；⑦视图为事件投影，断言前 advanceProjection。

---

## P1-06 历史记录（已完成，保留备查；P1-07 在其上实施，P1-06 原文自下一标题起未改动）

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
| A HandoffPacket + ReplacementAttempt（Control/Process 面） | p1-06-lane-a @ 090c3b5 | recordHandoff/claimReplacement 完整实现（守卫→fold→commit→map；run_not_ended/stale_source/lease_active/packet_* /CAS/幂等零写入）+ HandoffDriveEngineImpl.driveHandoff（替换意图：assemble→startRun→runtime→runFact；outbox 先于副作用） | src/control/handoff.ts、src/control/replacement-claim.ts、src/control/handoff-drive.ts、tests/control/handoff.test.ts、tests/control/replacement-claim.test.ts、tests/control/handoff-drive.test.ts | ✅ 20/20（主分支已合并） |
| B HandoffContext + HandoffControl | p1-06-lane-b @ ee4405c | HandoffContextCompilerImpl.assemble 完整实现（守卫序/stale 显式/越权/Budget/有界 Bundle body-first/无 transcript）+ FakeHandoffControlRuntimeAdapter（pause/stop + 公开快照） | src/context/handoff-context-compiler.ts、src/runtime/handoff-control-adapter.ts、tests/context/handoff-context-compiler.test.ts、tests/runtime/handoff-control-adapter.test.ts | ✅ 15/15（主分支已合并） |
| C ReadModel provenance + 重启证据 | p1-06-lane-c @ ebe844c | HandoffRecorded/ReplacementClaimed/EvidenceAdmitted 双适配器投影 + handoffProvenance（重建等价/全键隔离/freshness）+ isHandledEventType 与 handler 同 commit + 重启证据硬化 | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts、tests/read-model/p1-06-handoff-projection.test.ts、tests/sqlite-read-model/p1-06-handoff-projection.test.ts、tests/restart/p1-06-*.ts | ✅ 14/14（主分支已合并） |

integrator 维护：package/lock/tsconfig/vitest、`src/contracts/**`（公共 schema/接口/共享 fixture）、`src/ledger/**`、`src/sqlite-ledger/**`、`src/control/control-engine.ts`、`src/harness/**`、`tests/contract-suite/**`、`tests/integration/**`、文档与状态记录。子 Agent 不得派发其他 Agent、不得修改 Ticket 状态、不得新增依赖、不得改动冻结签名、**不得修改 P1-05 文件**（如有缺口：提交具体建议给 integrator 统一修改基线并通知消费者）。子 Agent 从实际读文件开始，不等待派发者；允许测试命令：`pnpm vitest run <自身路径>`、`pnpm typecheck`。

## P1-06 已执行命令及结果（最终，product root = main @ a9070e5）

| 命令（product root） | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS 0 errors（全部契约/夹具/套件/双适配器实现） |
| `pnpm vitest run`（全量，最终） | **76 files / 641 tests PASS**（P1-00…05 基线 539 零回归 + P1-06 新增 102；明细见 p1-06-implementation-evidence.md） |
| `pnpm vitest run tests/integration/p1-06.contract-suite.inmemory.test.ts` | 25/25 PASS |
| `pnpm vitest run tests/integration/p1-06.contract-suite.sqlite.test.ts` | 25/25 PASS（**同一套件定义，无调参**） |
| `pnpm vitest run tests/integration/p1-04.contract-suite.inmemory.test.ts tests/integration/p1-04.contract-suite.sqlite.test.ts` | 36/36 PASS（P1-04 套件零回归） |
| `pnpm vitest run tests/integration/p1-05.contract-suite.inmemory.test.ts tests/integration/p1-05.contract-suite.sqlite.test.ts` | 16/16 PASS（P1-05 套件零回归） |
| `pnpm vitest run tests/integration/p1-06.integration.test.ts` | 1/1 PASS（真实 SQLite 全路径 + 重启等价） |
| `pnpm vitest run tests/restart/p1-06-restart.test.ts` | 1/1 PASS（探针自动启用；packet/replacement/lease/B-run 逐字段一致） |
| `pnpm vitest run tests/restart/evidence/p1-06-evidence.test.ts` | 1/1 PASS（P1-06-EVIDENCE JSON 证据块，可重复） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 PASS |
| 只读零漂移比对 | `git diff d1c6595 a9070e5 -- src/contracts/goal-phase.ts src/contracts/goal-phase-view.ts src/control/goal-reducer.ts` = 0 行；`P1-06 冲突记录` = dev_docs/logs/conflict-reports/2026-09-06-p105-p106-merge.md（state=closed） |

**integrator 裁决/修正记录**（详见 p1-06-implementation-evidence.md §5）：本票首次冻结三个最小 Interface + 三个契约；packet stale 的三层覆盖（record 拒登记/assemble 显式/纯函数守卫）+ 登记后 stale 的完整路径留 P1-10/后续 workspace 演进；控制面 lastEventSeq 以注入事件数实现（公开报告仍 noHiddenContextRead）；normal drive 替换意图在扫描前跳过（scanned 语义）；两处套件/夹具缺口（fixture digest 归一为 sha256 hex；claim 与 envelope 绑定一致）由 integrator 统一修复。**G2（Continuity）等待 P1-05 + P1-06 双验收——双方证据已齐**。本地 main = a9070e5，**未推送** GitHub origin main（需用户授权）。

**09-06 DAG 注记（追加，不改原记录）**：按 [P1 DAG](dev_docs/planning/proposed/P1-foundation/DAG.md) 09-06 增量，G2（Continuity）= P1-05 + P1-06 + **P1-16**；P1-06 已完成本侧（06）证据，P1-16 交付后 G2 齐。

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
3. **唯一领取语义**：eligibility = 显式 DAG 硬依赖全部满足（dep task phase === "satisfied"）+ goal desiredState active + task disposition active + 无 Blocker（phase≠blocked）+ 资源可用（无 active lease、tokenBudget>0、deadline 未过）+ taskKind=work（gate 由 P1-04 Evidence 归约，不派发）；**CAS/lease = TaskLease@0 的 ledger CAS**（P1-03 每任务只允许一次领取，无重试/re-claim）；两个 Dispatcher 竞争 → 至多一个 lease+Attempt+Run 提交成功，败者 revision_conflict 零写入；幂等重放（同 identity+fingerprint → committed(replayed)）优先于 CAS。**（P1-07 追加注记：plan 快照 task.phase 为声明值；dep 满足以 TaskReduction live phase 为准，由 src/control/dispatch-facts.ts::loadLivePlan 派生并接入 readiness/claim，签名不变——见下节「P1-07 契约与存储语义」①。）**
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
