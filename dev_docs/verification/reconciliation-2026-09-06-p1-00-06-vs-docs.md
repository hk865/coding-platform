# 对账审查报告：P1-00..P1-06 实现 × 当前开发文档（含 P1-07 暴露根因）

```yaml
status: decision-applied-2026-09-06（用户已决定；R-02/03/04/06/07/08 文档修订已执行，见 §7；未提交；R-05 待开发授权）
date: 2026-09-06
scope: P1-00..P1-06 实现 × 当前开发文档对账（含 P1-07 暴露的根因线索）
reviewer: session-2211c5ce-a3da-44a2-a1a1-d4feb689d458（DeepSeek harness 对账会话；按任务书未派发子 agent（后经用户授权并行复核）、未改 Ticket、未 push；本报告为唯一写入文件）
product_code_ref: 404ab28（产品根 main HEAD，工作树干净，P1-07 已合并）
doc_ref: fec674e（doc 仓库 HEAD）+ 09-06 文档同步的未提交工作树（38 个已修改 + 11 个未跟踪，含 interfaces/context-lifecycle.md、tickets 16/17、2026-09-06-context-orchestration-sync.md、p1-06-implementation-evidence.md 等）。对账基线 = 工作树现行内容（授权同步尚未提交，行号以工作树为准）
methods: 只读 read/grep/git show/log；pnpm typecheck PASS；pnpm vitest run 7 文件 47 用例 + 6 文件 66 用例（P1-03/06/07 契约套件、P1-07 双适配器/集成/重启）+ 4 文件 52 用例（P1-04/05 契约套件回归）全部 PASS；node dev_docs/verification/validate-docs.mjs 13/13 PASS；未跑全量 722、未跑任何写操作命令
```

---

## 1. 摘要

实现侧无必须改代码才能解除的确定性语义冲突。唯一高严重度问题（R-01，P1-03 依赖满足判定读不可变 plan 快照）**根因在 P1-03 旧实现**，但已被 P1-07 的 loadLivePlan 缓解，并经 workspace 契约套件 A1/A6 在验收路径内以测试背书（Reader TaskReduction SATISFIED 后 IntegrationTask 才可 claim；12/12 × 双适配器实测）；残余问题为「语义来源未收编登记 + 冻结面文档未注明」的登记欠账（R-08），不是运行时功能缺失。其余 6 条线索（startRun 幂等键、taskRevision 整数校验、release expectedRevision=1、P107 bootstrap fixture、A5b 过期时钟、workspace-reader 关系）**全部经一手代码证据确认已修复或无冲突**，其中四项已登记于 P1-07 evidence §4/§5。

计数：确定性语义冲突/实现缺陷 **1**（R-01，高，已缓解、待收编）；文档残留/表述偏差 **5**（R-02 中、R-03 中、R-04 中、R-05 低、R-06 低）；登记欠账 **1 组**（R-07，覆盖 9 个文档 + R-08 附带 1 项收编登记）；线索证伪 **0**；线索确认已修复/无冲突 **7/11**（线索 2/3/4/5/6/11 全确认；线索 1 机制确认+严重度修正；线索 10 部分确认并转 R-02）。

---

## 2. 逐项冲突矩阵

### R-01（高）｜P1-03 依赖满足死锁：eligibility 读不可变 plan 快照的声明 phase

- **类型**：(b) 根因在旧实现的缺陷（主），叠加 P1-03 冻结语义未指明满足真相源的文档欠账（辅，见 R-08）。
- **一手证据**：
  - src/contracts/dispatch.ts:517-535：evaluateTaskEligibility 对 dependsOn 每条边取 plan.tasks 内 phase（:524 dep?.phase ?? missing），要求 === satisfied；facts.plan 来自 ledger load 的 PlanRevisionSnapshot（src/contracts/plan.ts:226，纯数据、接受时固定、无后续写路径）。
  - 满足的唯一写者 = P1-04 的 reduceTask（TaskReduction 聚合；src/control/task-reducer.ts:3-17,166-176；dispatch-facts.ts:1-13 头注释 the ONLY writer of satisfaction is P1-04 reduceTask; the plan snapshot stays immutable）。因此无覆盖时带 dependsOn 的 work task 永久 deps_unsatisfied。
  - 缓解：src/control/dispatch-facts.ts:31-60 loadLivePlan（TaskReduction phase 覆盖派生）+ 接入 src/control/readiness.ts:71,97 与 src/control/claim.ts:87,115（evaluateDispatchReadiness/claimTask 签名未变、零写）。
  - 引入历史：git log --follow src/control/dispatch-facts.ts 仅 61fe3f5、14886d8 两条（均属 P1-07）；git show 61fe3f5 --stat = 5 文件 75 行（dispatch-facts +60、readiness、workspace-fixtures、validation）——overlay 是 P1-07 新增，不属于 P1-03 交付面。
  - 负面证据：tests/control/dispatch-readiness.test.ts:121 对 DISPATCH_DEPENDENT_TASK_ID（dep=task-run-adaptor；fixture 两者 phase 均 pending，src/contracts/fixtures/dispatch-fixtures.ts:77-93,195-200）断言 deps_unsatisfied——纯快照下依赖永不满足。
  - 正面证据：tests/contract-suite/workspace.contract.suite.ts:486-502（A6）：reduceTask(READER_A/B) committed 后 runP107Task(INTEGRATION)（dependsOn=两 Reader，workspace-fixtures.ts:271-274）claim 返回 committed——只有 loadLivePlan 的 live phase 覆盖才能满足；本审查实测 A1-A8/V1（12/12 × 2）全绿。
  - P1-03 自身验收面：fixture 唯一 eligible task 无 dependsOn（dispatch-fixtures.ts:131 taskIds:[DISPATCH_ELIGIBLE_TASK_ID]），**P1-03 交付时依赖链未被端到端演示**；缺陷在其范围内不可见，首次显形于 P1-07 合法串链。
- **文档条款引用**：ticket 03 Acceptance #1（tickets/03:70）；HANDOFF「P1-03 契约与存储语义（冻结）」§3（IMPLEMENTATION-HANDOFF.md:279）；ARCHITECTURE 不变量 #8（ARCHITECTURE.md:252）；PRODUCT 成功标准（PRODUCT.md:132）。
- **判定**：与 #8 / PRODUCT:132 **无语义矛盾**（两者按「实时满足/未满足」表述；overlay 后行为一致：FAILed/verifying/blocked 依赖确定性拒绝，见 p1-07 evidence §1#2 与 conflict-plan 变体）。真正的冲突面是 **P1-03 冻结契约文本（HANDOFF §3 / ticket 03 #1）未定义 satisfied 的真相源** → 新消费者（P1-08 状态台风险最高）若绕过 readiness/claim 直接消费 evaluateTaskEligibility 会复现死锁。
- **当前状态**：缓解已落地（P1-07，测试背书）；收编登记未做（R-08）。
- **修复选项与权衡**：
  1. **（推荐）把 live-phase 判定收编为 P1-03 标准 facts 语义并登记**：零代码改动；HANDOFF P1-03 §3 追加一行（dep 满足 = TaskReduction live phase 为准；plan 快照 phase 为声明值；P1-07 起由 dispatch-facts.loadLivePlan 派生，readiness/claim 均接入）；ticket 03 按「只追加」加一行交叉引用；R-07 的 P1-03 记录写死该句；p1-03 evidence 末尾加 P1-07 补充审查注记。理由：签名未变、零风险、防 P1-08 误解。
  2. **版本化升级 DispatchReadinessFacts**（v2 合类型携带 live phase + 未知版本拒绝）：显式化，但改 P1-03 冻结形状、全部消费者（P1-08/09/10、双适配器）需升级，成本高；仅在 P1-08 发现 facts 载荷需要显式 live phase 时再做。
  3. 其他（已否决）：让 reduceTask 回写 plan 快照或接受时重投影——违反 PlanRevisionSnapshot 不可变与 P1-04 唯一写者不变量（ARCHITECTURE #12、dispatch-facts.ts 头注释）。
- **归属建议**：选项 1 → 文档修订任务（09-06 同步收尾或新建只读登记步骤），不动 Ticket 状态；选项 2 → P1-08 消费时由该票 integrator 决定。

### R-02（中）｜ARCHITECTURE Module Registry / runtime-collaboration：公开快照归属写成 DispatchEngine，实现归属 P1-06 的 WorkerRuntime 控制面

- **类型**：(c) 表述级偏差（文档标注 extension draft，不算漏实现）。
- **一手证据**：ARCHITECTURE.md:161 Registry 行「DispatchEngine … drive/accept；snapshot(query) 公开快照 | extension draft」；runtime-collaboration.md:46 同款「DispatchEngine | drive(trigger) / accept(runtimeEvent)；snapshot(query) → report / unsupported / stale / rejected」。实现面：src/contracts/ports.ts:70-72 DispatchPort **只有 drive(trigger)**；公开 Run 快照 = src/contracts/handoff-control.ts:75-77 HandoffControlPort（control + snapshot），noHiddenContextRead: true（handoff-control.ts:45,57；实现 src/runtime/handoff-control-adapter.ts:88,132,138-151,175），P1-06 首次冻结（p1-06-implementation-evidence.md:17,62）。此外 accept(event) 亦不存在于 DispatchPort（运行事实由 ControlEngine.runFact 受理）。
- **对照**：runtime-collaboration.md:48 与 worker-runtime.md:15 已正确写 WorkerRuntime「新增可选 snapshot(query)…只暴露公开报告」——问题只在 DispatchEngine 行。
- **修复选项**：改 Registry 行为「drive(trigger)；公开运行快照经 WorkerRuntime.HandoffControlPort.snapshot（P1-06 冻结，noHiddenContextRead）与 ReadModel 视图；运行事实受理属 ControlEngine」；或行尾加「（快照查询面由 P1-08 首个消费者定型）」。推荐前者（真相已知，不必再等）。
- **归属**：文档修订任务。

### R-03（中）｜G2 定义过期残留：4 处仍写「G2 等待 P1-05 + P1-06」

- **类型**：(c) 文档过期残留。
- **一手证据**（工作树 grep）：1) dev_docs/planning/proposed/P1-foundation/tickets/06-handoff-a-to-b.md:92「…（G2 需 05+06 双验收）」；2) dev_docs/verification/p1-06-implementation-evidence.md:5「G2 (Continuity) waits P1-05 + P1-06 evidence」；3) 同文件 :68「**G2（Continuity）等待 P1-05 + P1-06 双验收**——已具备。」；4) 产品根 IMPLEMENTATION-HANDOFF.md:133「**G2（Continuity）等待 P1-05 + P1-06 双验收——双方证据已齐**。」
- **现状权威**：DAG.md:128「G2 Continuity | P1-05 + P1-06 + P1-16」、DAG.md:143「G2 保留原 05／06 证据并增加 16」；ARCHITECTURE.md:333、ROADMAP.md:78、mvp-scenario.md:57（含 P1-16）均正确、无残留。
- **判定**：确认 4 处需改。建议按「保留历史记录 + 追加一行」处理：ticket 06 / p1-06 evidence / HANDOFF 各追加「按 09-06 DAG，G2 = P1-05 + P1-06 + P1-16；本票完成 06 侧证据（05 侧已由 P1-05 交付，16 侧为新增后置边界）」，不改写原句。
- **归属**：文档修订任务；改后重跑 validate-docs.mjs（release_gates 校验）。

### R-04（中/低）｜PRODUCT:145「A→B 接续及写入隔离仍需验证」过期（含 :77 次级）

- **类型**：(c) 文档过期残留（时间线竞态：PRODUCT 修订于 P1-06 验收 commit 之前）。
- **一手证据**：PRODUCT.md:145 原句；A→B 接续已由 P1-06 验收（p1-06-implementation-evidence.md §1 6/6、forced-context-rollover/run-crash-recovery/stale-packet/late-result-rejection 四组、双适配器 25/25×2、真实 SQLite 1/1、重启 1/1）；写入隔离/唯一 Writer 已由 P1-07 验收（p1-07-implementation-evidence.md §1 #5/#6/#8 + competing-writer-lease-test、A5/A5b、12/12×2 实测）；G3 现状 = P1-07 + P1-15（DAG.md:129），且 15 经 17 消费完成工作继承（DAG.md:47-49,141）。PRODUCT.md:77「同一 checkout 的写入安全仍需验证」＝框架面已由不变量 #7 + WorkspaceWriteLeaseIndex CAS + A5 层验证；**真实 checkout 写入仍属 P1-12/13**。
- **建议改句**：「A→B 接续已由 P1-06 验收（6/6）；唯一 Writer／写隔离已由 P1-07 验收（competing-writer-lease + GoalGate 全量检查；框架面——真实 checkout 写入由 P1-12/13 验证）；G3（角色协作）仍需 P1-15 整合并经 P1-17 消费完成工作继承；旧『双只读并行』不单独代表 G3 门禁，阶段批准另行记录。」
- **归属**：文档修订任务（PRODUCT owner，参照 dev_docs/document-ownership.md）。

### R-05（低）｜产品测试注释残留：dispatch-readiness.test.ts「baseline inconsistency to reconcile」

- **类型**：(c) 表述残留（产品代码侧注释，非行为问题）。
- **证据**：tests/control/dispatch-readiness.test.ts:124-127 注释称契约套件只列 task_kind_not_work；实际套件 tests/contract-suite/dispatch.contract.suite.ts:59 已断言 [task_kind_not_work, deps_unsatisfied]（与单测一致，本审查实测 15/15 PASS），注释过期。
- **建议**：删除/改一行（归属：下一 integrator 或下次授权内顺手；属产品代码，需在授权内处理）。

### R-06（低）｜2026-09-06 sync 文档「本次修改文件」含 ticket 07，与实际工作树不符

- **证据**：2026-09-06-context-orchestration-sync.md:63 列 tickets/07；git status 显示 07 相对 HEAD fec674e **未修改**（其 09-06 内容已含于 fec674e「P1-07: implementation evidence + ticket record」，含 G3=07+15 语句）。
- **判定**：无行为影响，sync 清单表述不精确。建议下一文档修订注明「（P1-07 记录已随 fec674e 提交，此处同步核对）」或删除该行。

### R-07（中）｜「只追加扩展归属」登记欠账：9 个 interfaces/modules 文档缺 P1-03/05/06/07 extension records

- **类型**：(d) 登记欠账（已实现能力未在对应接口/模块页登录；09-06 同步明确「P1-03／06 只追加扩展归属、其余按各票范围同步」，未完成）。
- **逐文件（缺失记录标题 / 建议内容要点 / 建议插入锚点）**：

| # | 文件 | 缺失记录 | 建议内容要点（标题+事实+契约文件路径指针，不复制 wire schema） | 建议锚点 |
| --- | --- | --- | --- | --- |
| 1 | dev_docs/interfaces/command-event.md | P1-03 | 4 事件（TaskClaimed / RunStarted / RunEventRecorded / RunOutcomeUnknown）+ 3 commitKinds（dispatch-claim / dispatch-start / run-fact）+ claim/start/runFact 命令 + outbox 语义（intentId===attemptId、pending/started/done、与事件同原子提交）+ 迟到/重复/冲突拒绝（per-run sequence）——指针 src/contracts/dispatch.ts、ledger-validation.ts | 「## P1-04 extension record」（:189）之前 |
| 2 | 同上 | P1-06 | HandoffRecorded / ReplacementClaimed 事件 + handoff-record / replacement-claim commitKinds + recordHandoff / claimReplacement 命令；packet 无 transcript（noFullTranscript）+ 公开快照 noHiddenContextRead——指针 src/contracts/handoff.ts、handoff-control.ts | P1-04 记录后（按票序在 P1-05 :203 之后亦可） |
| 3 | 同上 | P1-07 | 6 事件（WorkspaceReadLeaseGranted/Released、WorkspaceWriteLeaseGranted/Released、IntegrationJoined、PatchRecorded）+ 6 commitKinds + acquire/release/recordIntegrationResult/recordPatch 命令——指针 src/contracts/workspace-lease.ts、integration.ts、patch.ts | 文件尾部（P1-05 记录后） |
| 4 | dev_docs/interfaces/state-ledger.md | P1-03/06/07 | 对应 commitKinds + 新生聚合（TaskLease/TaskAttempt/Run/outbox；HandoffPacket/ReplacementAttempt/HandoffProvenance；Lease/Index/PatchRecord/IntegrationResult）+ Workspace 单调 CAS 与「patch 登记原子推进 revision」注记 | 既有 P1-05 record（:193）后逐一追加 |
| 5 | dev_docs/interfaces/goal-view.md | P1-03/06/07 | P1-03：ActiveAgentView + TaskDetailView.run 由事件重建（src/contracts/active-agent.ts）；P1-06：handoff provenance timeline（src/contracts/handoff-view.ts）；P1-07：writerLease / integrationConflicts / workspacePatches 三视图（src/contracts/workspace-views.ts，只展示、不判定） | P1-05 record（:124）后 |
| 6 | dev_docs/modules/control/control-engine.md | P1-03/05/06/07 | P1-03：dispatchReadiness/claimTask/startRun/runFact 入口；P1-05：reduceGoal + goalPhase*；P1-06：recordHandoff/claimReplacement；P1-07：acquireReadLease/acquireWriteLease/releaseWorkspaceLease/recordIntegrationResult/recordPatch——均「实现分派独立入口文件、ControlEngineImpl 仅委托」 | 「## Context 生命周期与协作扩展」（:114）之前 |
| 7 | dev_docs/modules/data/read-model-index.md | P1-03/04/05/06/07 | P1-03：ActiveAgent/TaskDetail.run 投影 + unsupported_event_type 整页停止；P1-04：EvidenceAdmitted/TaskReductionUpdated 投影；P1-05：GoalPhaseUpdated → goalStatus/goalTimeline；P1-06：handoff provenance 投影；P1-07：6 事件 3 视图 + isHandledEventType 与 handler 同 commit、断言前 advanceProjection | :90-92 P1-02 record 后 |
| 8 | dev_docs/modules/data/state-ledger.md | P1-03/06/07 | 同 #4（模块页侧） | P1-02 record（:86-88）后 |
| 9 | dev_docs/modules/control/dispatch-engine.md | P1-03/06/07 | 本页无 extension record 结构；建议新增「## Extension records」：P1-03 冻结 DispatchPort.drive（唯一入口）；P1-06 换手面 driveHandoff + 替换意图扫描前跳过（scanned 语义）；P1-07 WorkspaceDrivePort.driveParallel（版本化新增，不改 P1-03 DispatchPort）；候选操作表保留但注明「快照面见 WorkerRuntime」（呼应 R-02） | 「## Interface」（:13-15）后 |
| 10 | dev_docs/modules/execution/worker-runtime.md | P1-03/06/07 | P1-03 RunPort 冻结（capabilities/start/events；replayable / supportsSnapshot=false 诚实声明）；P1-06 HandoffControlPort（control/snapshot，noHiddenContextRead）；P1-07 WorkspaceCapabilityPort（capabilitiesFor → ready/unsupported/rejected，绝不静默降级） | 「## Interface」（:13-15）后 |

- **归属**：文档修订任务（owner 参照 dev_docs/document-ownership.md；均为 interfaces/modules 页，不涉 Ticket 状态）。改后跑 validate-docs.mjs。

### R-08（中）｜P1-03 依赖满足语义未收编登记（R-01 的登记部分）

- **证据**：P1-07 evidence §4①/§5 与 HANDOFF:66① 已登记（「plan 快照不可变是 P1-03 冻结事实……readiness + claim 均接入，签名不变」）——**P1-07 侧已登记**；但 HANDOFF「P1-03 契约与存储语义」§3（:279）、ticket 03、p1-03 evidence 均未注明 → 冻结面消费者（P1-08 起）若只读 P1-03 文本会误解。
- **建议**：按 R-01 选项 1 收编 + 追加登记（含 R-07 #1 记录中的语义句）。
- **归属**：文档修订任务。

---

## 3. 已验证无冲突清单

**ARCHITECTURE 全局不变量 #1–#14 逐条（实现面判定依据简述）**：
1. Planner 只提出提案、ControlEngine 接受——P1-00..07 无 Planner 实现；ControlEngine 为唯一推进入口（control-engine.ts 仅委托各独立入口）✅
2. Worker/Reviewer 只提交事实/Claim——exit=0 不写 Task.phase（run.contract.suite + p1-03 evidence #8 afterTerminalTaskPhaseNotSatisfied）；Claim 证据强制 INCONCLUSIVE（p1-04 evidence §1#7）✅
3. ControlEngine 生成 transition/snapshot+Event、StateLedger 原子提交——buildXxxLedgerCommit + ledger.commit 全路径（claim/start/runFact/reduction/handoff/patch/lease）✅
4. UI/Todo/PlanMatrix/Timeline 是 ReadModel——P1-07 三视图只展示（HANDOFF:33,44；套件 V1 实测）；P1-05 视图重建 ✅
5. 三类 DAG 不互为真相源——文档明示（ARCHITECTURE:232-238）+ validate-docs「ModuleDependencyDAG parseable and acyclic」「ticket metadata matches acyclic Mermaid DAG」✅
6. 执行/Evidence/Handoff/Decision 绑定 revision+来源——EvidenceRef/planRef/runRef/workspaceRevision 全覆盖（p1-04/06/07 套件断言 + P1-06 可追溯组）✅
7. 同 checkout 至多一个 Writer——WorkspaceWriteLeaseIndex CAS（src/control/workspace-lease.ts）+ A5 competing-writer 实测（两家并发 acquire 至多一个 committed，败者零写入）✅
8. GateTask 参与完成归约；只有显式 Runtime dependency 阻塞调度——gate 由 P1-04 Evidence 公式归约（p1-04 evidence #2/#7）；调度仅 dependsOn 边（dispatch.ts:517-535，R-01 缓解后成立）✅
9. required 集合非空——GoalCompletionGuard 非空检查（src/contracts/goal-phase.ts:244 起；completion-policy §3/§8）+ P1-07 A7/A7b 流程含 gate 非空验证 ✅
10. bootstrap 只建 identity/manifest——bootstrap fixture 仅 bootstrap commitKind（src/contracts/fixtures/bootstrap-fixture-v1.ts）；P107 场景复用其 proj-alpha/ws-shared（workspace-fixtures.ts:60-61）✅
11. CompletionPolicy/Baseline 经 install/activation 版本化——src/control/governance-install.ts / governance-activate.ts + HANDOFF P1-02 冻结语义；local fixture 走同一路径（dispatch-readiness.test.ts:76-92）✅
12. PlanRevision 接受时固定 pin——buildPlanLedgerCommit pins（plan-fixtures.ts；dispatch-readiness.test.ts:93-100）✅
13. Baseline 不可改写——一致（CAS@0、无 update 路径）；「candidate source==默认 ref + 显式 Decision + migration Gate」演进前置**未实现**（governance-activate.ts 仅收 identity/revision/digest；全仓库无 ArchitectureEvolutionPolicy 演进路径），属 P1-14 待扩展、**非冲突** ✅（注记）
14. 归档不是当前状态来源——AGENTS.md:52 / CONTEXT 规则；P1-00..07 未以归档为真相源 ✅

**其他文档面**：
- Plane（ARCHITECTURE:13-74）/ ModuleDependencyDAG（:176-230）与实现归属一致（DispatchEngine→ControlEngine/ContextCompiler/WorkerRuntime/ArtifactVault 与代码依赖相符）；registry 多数行标注 first-slice draft / extension draft，不冒充已冻结；唯一偏差 = R-02 措辞。
- PRODUCT 必须证明 / 非目标 / 成功标准：无冲突；:130-133 与 overlay 后行为一致（实测）。
- completion-policy §5（applicability 纯函数派生、永不写回——p1-04 evidence）、§6（TaskSatisfied 公式 = reduceTaskVerification）、§10（权限边界——Claim 中性、verdict alone blocked：p1-04 evidence #7）：与实现一致，以 P1-04/05 契约套件背书。
- runtime-collaboration：outbox-before-side-effect（dispatch-engine.ts:107-136 + dispatch-drive 单测 + driveParallel 同序）；报告/结论分离（Report≠verdict：runtime-collaboration:72 + P1-04 冻结记录）；重复/迟到/冲突不改变未接受状态（per-run sequence stale/duplicate/after_terminal、conflict_duplicate 首记录权威、revision_conflict 零写入）；语义 Run 走正式 dispatch（P1-07 IntegrationTask = claim/start/runFact 正式派发，套件实测；P1-04 评审面见 §5 未覆盖面）。
- context-lifecycle：旧 lease/迟到反馈/过期版本（replacement-claim lease 守卫 + A late fact after_terminal + A5b expiry-vacate 实测）；FakeRuntime 能力诚实声明（capabilities：replayable、supportsSnapshot=false、WorkspaceCapability unsupported 显式、能力=支持矩阵 ∩ envelope 权限、永不上调）；不支持恢复→不可用或授权新 Run（P1-06 crash recovery = B 新 Run 接续已实现；原会话恢复能力声明归 P1-16，设计面一致）。
- human-design-status：公开快照/noHiddenContextRead 语义在 runtime-collaboration:48 与代码一致；human-design-status 未提及 P1-06 快照（可选项，非冲突）。
- DAG 09-06 增量：16 blocked_by 06、17 blocked_by 16+05、15 消费 06/07/09/14/17、G2=05+06+16、G3=07+15——ticket 16/17 frontmatter 与 mermaid 边一致；tickets 03/04/06 的 09-06 归属段复核通过（03:89-91、04:94-99、06:100-102）；ticket 05 未改（同步明确不动；其 Implementation record 只提 07/08 窗口，无误）。
- AGENTS.md 启动/完成边界：子 Agent 不直接标完成 Ticket/Task/Goal（AGENTS.md:54-56）——P1-07 记录明示 status stays proposed ✅；validate-docs 13/13（含 G3 完整角色切片 + Context 连续性门禁）。
- P1-00/01/02/04/05 冻结契约零改动：p1-07 evidence :9/:48（git diff f3a6a71 14886d8 冻结文件 0 行）+ p1-06 evidence :46（P1-05 专属 0 行）+ 本审查产品工作树干净（git status 空）。

---

## 4. 证伪/修正清单

任务书 11 条线索中 **0 条被证伪**；以下为修正与追加：

1. **线索 1（依赖死锁）**：机制描述确认；但「与 ARCHITECTURE #8／PRODUCT 132 真冲突」**不成立**——#8 与 :132 均按 live 满足/未满足表述、不指定真相源；真正冲突面是 P1-03 冻结契约文本未定义满足真相源（语义欠账，非不变量违约）。严重度维持「高」（根因级），当前运行时已无死锁（A1/A6 实测）。
2. **线索 7（G2 残留）**：确认 4 处（比任务书多确认 HANDOFF:133）；另确认 ARCHITECTURE/ROADMAP/mvp-scenario/DAG 均正确，无需改。
3. **线索 8（PRODUCT 145）**：确认，并追加 PRODUCT:77 次级残留与 G3 准确表述建议（「G3 仍需 P1-15(+17)」）——:145 原句把「G3 完整角色场景已写入 MVP 草案」与门禁混淆。
4. **线索 9（extension records）**：任务书预估「部分只到 P1-02」需精化——command-event/state-ledger/goal-view 到 P1-05（缺 03/06/07）；control-engine 到 P1-04（缺 03/05/06/07）；read-model-index 与 modules/data/state-ledger 仅 P1-02；dispatch-engine / worker-runtime **完全无 extension record 结构**。逐文件见 R-07。
5. **线索 10（ARCHITECTURE 161）**：部分确认——归属错误属实；修正点：accept(event) 同样不存在于 DispatchPort（建议一并措辞）；「待 P1-08 消费时再定」与「立即改稿」两种权衡中推荐立即改稿（真相已知）。
6. **线索 11（workspace-reader）**：确认无冲突，建议一行交叉注记（「P1-07 的 WorkspaceReadLease/WorkspaceCapabilityPort ≠ 本模块 read()；本模块首个消费者仍 P1-12」）。

---

## 5. 未覆盖面与风险

- 未逐行盲读全部模块/接口文档：verification-engine、architecture-reconciler、plan-compiler、artifact-vault、context-compiler、human-collaboration 模块页与 agent-entry 等（对应票未实施或仅设计面）仅核对归属/链接/validate-docs，未做语义逐条比对。
- 未跑全量测试：本审查执行 = pnpm typecheck（PASS 0 错误）+ vitest 7 文件 47 用例（dispatch-drive/readiness/claim、workspace-lease、integration-join、patch-record、handoff-drive）+ 6 文件 66 用例（p1-03/06/07 契约套件 inmemory、p1-07 sqlite 套件 A1-A8/V1、p1-07 集成 1/1、重启 1/1）+ 4 文件 52 用例（P1-04/05 契约套件回归）+ validate-docs 13/13。P1-00/01/02 全量未重跑，以其 evidence 记录与 P1-06/07「零回归」声明为准；全量 88 files/722 tests 未复验。
- 未验证非功能面：安全/审计/可观测性/评价义务（ARCHITECTURE:71）未核对。
- P1-04 评审 Run 走正式 dispatch：已逐行核对并确认（tests/contract-suite/verification.contract.suite.ts:314-349 claim+startRun；evidence.contract.suite.ts:309 verdict 挂 review Run），与 HANDOFF P1-04 冻结语义 #10 一致（见 §6 子 agent A 修正）。
- Git 远端状态未核验：push 状态以各票记录（未推送）为准。
- 文档基线风险：09-06 同步尚未提交——本报告行号基于工作树；若后续提交/回滚，R-02..R-08 锚点可能漂移。
- 真实内核：FakeRuntime 之外的真实 coding-agent 连续性/能力降级属 P1-16 范围，未验证。

## 6. 并行子 agent 复核注记（用户授权并行后追加）

由用户授权启动的两只只读子 agent 并行复核，结果如下（**不改变上述结论判定**；仅对 §3/§4 做补充）：

**子 agent 86b24391（G2/extension records 全库扫描，已完成）**：
- 任务 A：确认 G2/「仍需验证」残留共 **6 处**（tickets/06:92、p1-06 evidence:5,68、PRODUCT:145、PRODUCT:77、IMPL-HANDOFF:133——即本报告 R-03+R-04 全部）；**未发现其他独立门禁残留句**；表述正确者另补正面确认：`mvp-scenario.md:58`（G3 行）、`human-framework-role-review.md:175`（「G3 等待 07 与 15」）、`document-convergence.md:9`。归档 `archive/v0.3-2026-09-04/dev_docs/product/产品定义与总体架构.md:123` 为历史档案（非现行，符合不变量 #14）。
- 任务 B：extension records 审计——`interfaces/runtime-collaboration.md` **仅有一条 P1-04 记录**（:82），其余复核文件（completion-policy、verification-engine、architecture-reconciler、plan-compiler、artifact-vault、context-compiler、human-collaboration）**均无记录结构**（仅「首个消费者 P1-0x」注记）；owner 判定：interfaces（除 completion-policy）与 modules 均为 **Agent 维护/技术审查**，completion-policy 为「Agent 维护、人审阅关键行为」（document-ownership.md:13,15）——R-07 的归属建议与之一致。
- 任务 C：DAG 状态列 00–17 全部 `proposed`；tickets/03:89-91、04:94-99、06:100-102 归属段行号与期望一致。

**子 agent ba7250b6（广度核对四类面，已完成；以下含本审查对该 agent 结论的一手复核修正）**：
1. **不变量 #9/#11/#12 一致**（#9：goal-phase.ts:262-354 guard 强制 required work/gate/obligation/VR 非空、:480-496 COMPLETED 仅经 guard.hold；#11：governance-install.ts:55-263 source→digest→CAS@rev0、activate.ts:46-209 仅收已安装三元组、gov.ts:545-547 无 default/fallback、local fixture 同一路径；#12：plan-acceptance.ts:349-359,394 + plan-fixtures.ts:221-222 接受时固定 ref+digest pin）。**#13 部分一致**：「不可改写」成立（CAS@0、无 update 路径）；但「candidate source==默认 ref + 显式 Decision + migration Gate」演进前置**无实现**（activate.ts target 仅 identity/revision/digest；全仓库无 ArchitectureEvolutionPolicy/演进路径）——属 P1-14/后续票范围，**作注记而非冲突**（本报告 §3 #13 行相应表述为「契约一致、演进前置未实现」）。
2. **completion-policy §11 seam**：除 parent_of 条目（实测 tests/contracts/goal-phase.test.ts:301，非题给 5 文件——窄口径更正）外，其余条目均有测试背书（空 Plan/空 required 拒绝、旧 PASS→STALE、Claim 自报不写状态、无 active Plan 非 COMPLETED、四态确定性唯一）。
3. **P1-04 Reviewer Run 正式 dispatch——经一手复核修正子 agent 结论**：子 agent 报「不存在（部分）」；本审查逐条核验后发现**一致**——评审工作确实经正式 dispatch Run：tests/contract-suite/verification.contract.suite.ts:314-349（REVIEW 义务 run 经 claimTask + startRun，runRef=run-unknown-1）+ :457（body-first bundle 归 review run）+ tests/contract-suite/evidence.contract.suite.ts:309（verdict 证据 source.runRef = review Run）；VerificationEngine 本身只跑确定性 predicate 检查（src/verification/verification-engine.ts:300 reviewer-layer checks are NOT executed here），ReviewerPort 为冻结能力替身（in-memory/persistent-harness.ts options.reviewer，默认 FakeReviewerPort）——与 HANDOFF P1-04 契约语义 #10「评审工作 = 正式 dispatch Run（P1-03 FakeRuntime 路径），ReviewerPort 只冻结能力替身」完全一致。**非冲突**；补注：真实模型评审内核（FakeRuntime 之外）未在 P1-04 交付，归后续票（P1-15 整合面）。
4. ARCHITECTURE:70-71 均为设计声明，P1-00..07 evidence 无「已实现安全/审计/可观测/评价义务」的冲突表述（p1-04:106 将可观测性延后至 P1-11；p1-00:37、p1-05:38 为 artifact 级审计轨迹）。

**结论**：并行复核未改变 R-01..R-08 判定；新增登记建议仅为 #13 演进前置的注记与 §11 parent_of 测试位置更正，均非冲突。
---

## 7. 文档修订执行记录（2026-09-06，用户授权）

用户批准「以外的方法」——按 R-02..R-08 执行文档修订（R-05 代码注释留待开发授权）。已执行（全部为追加/改句，未 push、未改 Ticket 状态）：

| 项 | 动作 | 文件 |
| --- | --- | --- |
| R-03 | G2 = P1-05 + P1-06 + P1-16 追加注记（保留原记录） | tickets/06-handoff-a-to-b.md（DAG 注记，yaml 块后）、verification/p1-06-implementation-evidence.md（新 §7）、产品根 IMPLEMENTATION-HANDOFF.md:133（追加注记行） |
| R-08 | P1-03 依赖满足 live phase 语义收编登记 | 产品根 IMPLEMENTATION-HANDOFF.md（P1-03 §3 追加注记）、tickets/03-fake-run-visible.md（09-06 归属段追加另注）、verification/p1-03-implementation-evidence.md（新「P1-07 补充审查注记」节） |
| R-02 | 公开快照归属表述修正 | ARCHITECTURE.md:161（Registry 行）、interfaces/runtime-collaboration.md:46（DispatchEngine 行） |
| R-04 | PRODUCT 过期句改写 | PRODUCT.md:145、:77 |
| R-06 | sync 清单表述注记 | verification/2026-09-06-context-orchestration-sync.md:63 |
| R-07 | 补齐 extension records（P1-03/05/06/07） | interfaces/{command-event,state-ledger,goal-view}.md、modules/{control/control-engine,control/dispatch-engine,data/read-model-index,data/state-ledger,execution/worker-runtime}.md |
| 线索 11 | 交叉注记 | modules/data/workspace-reader.md（Interface 段后） |
| 注记 | #13 演进前置未实现（P1-14 待扩展） | 本报告 §3 第 13 条（架构不变量正文未改，保留规范语义） |

执行后校验：`node dev_docs/verification/validate-docs.mjs` → **13/13 PASS**（含 release_gates 对齐、DAG 无环、module registry 路由、G3 完整角色切片、Context 连续性门禁）。

遗留：R-05（tests/control/dispatch-readiness.test.ts:124-127 过时注释）属产品代码，待下次开发授权；未提交（git commit/push 由用户/流程决定）。
