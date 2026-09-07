# P1-14 共享基线计划（2026-09-07，供下一窗口实施）

> 状态：**计划草案**（P1-13 已验收；本窗口到点前仅完成评估）。正式冻结语义将写入产品根 IMPLEMENTATION-HANDOFF.md 的 P1-14 段。

## 1. 范围（ticket 14-baseline-activation.md）

ArchitectureReconciler 确认 P1-12 candidate proposal 的 source baseline 仍 = Project 当前 active baseline → 从 proposal+精确 source
**确定性物化** immutable candidate baseline（content-addressed ref == proposal.expectedCandidateDigest）→ P1-11 authority path 产生
**精确** ArchitectureChangeDecision（subject/outcome/actor/authority/authorizedTarget/from ref/candidate ref）→ VerificationEngine 在
candidate+当前 Workspace revision 上生成 MigrationGateTask（不允许隐式 rebase）→ 三者同时成立 + Project CAS → 移动 ArchitectureBaseline
active ref；任一步 source 变化 → 整组标 STALE 不激活；既有 Plan pin 不变（只有显式 PlanRebase/新 PlanRevision 重算）；不重写旧 FAIL/
Finding/Decision/Evidence；视图解释"谁授权/迁移证据/未 rebase 计划"。

## 2. 关键架构发现（2026-09-07 评估）

- **P1-02 已有完整基线机制**：immutable ArchitectureBaselineRevision（install）+ per-kind active ref（activate，CAS=Project@N+active@k）
  ——P1-14 的"BaselineActivation"语义 = **在新基线 revision 上运行既有 activate**（不新建激活机制），P1-14 新增的是演化工件聚合与编排：
  ①CandidateArchitectureBaseline（物化快照；ref digest == proposal.expectedCandidateDigest）②ArchitectureChangeDecision
  （**独立决策聚合**，不是 P1-11 UserDecision 重载——P1-11 的 UserDecision 只服务 goal/plan change；P1-14 决策绑定 from/candidate refs）
  ③MigrationPlan/MigrationGateTask（gate Evidence 由 VerificationEngine 新端口产生；PASS 条件 = candidate+当前 workspace revision）
  ④BaselineActivation 记录（编排记录聚合：decision+gate+from→to+activatedAt；activation 动作本身复用 P1-02 activate）。
- **三个最小 Interface 首次冻结**：HumanCollaboration.ArchitectureDecisionPort、ArchitectureReconciler.BaselineEvolutionPort、
  VerificationEngine.MigrationGatePort（版本化 v1；不扩张 P1-12 inspection/code-graph 端口）。
- **STALE 语义**（关键不变量）：所有工件携带 source ref；任一阶段（提案→物化→决策→gate→激活）Project active baseline 移动 →
  对应工件标 STALE、不激活；必须从新 active ref 重新提案、重新裁决、重新验证。工件间 ref 链：proposal.sourcePlanRef?
  不——proposal.sourceBaselinePin → candidate.parent(source) → decision.from → migrationPlan.from → activation 前 current active 全相等。

## 3. 共享基线构建清单（integrator）

1. contracts（新文件 src/contracts/baseline-evolution.ts）：
   CandidateArchitectureBaseline（schemaVersion/ref[content-addressed]/parentSourcePin/content[规范化]/materializedAt）+
   ArchitectureChangeDecision（subject{fromPin,candidateRef}/outcome{accept|reject|defer}/actor/authority/
   authorizedTarget{fromPin,candidateDigest}/summary）+ MigrationPlan（defaultPin/candidateRef/affectedPlanRefs[pin 固定列表]/
   migrationEvidenceRefs/boundary[not an implicit rebase]）+ MigrationGateTask（gateId/planRef/candidateRef/workspaceRevision/
   status{pending|pass|fail|stale}/gateEvidenceRefs）+ BaselineActivation（activationId/decisionRef/gateRef/fromPin/toPin/
   activatedAt）+ 事件+fingerprints+上限常量+视图（baseline-change-view query/result）；
2. 3 个端口（modules.ts 版本化追加）：HumanCollaboration.submitArchitectureChangeDecision/…、
   ArchitectureReconciler.materializeCandidate/…、VerificationEngine.runMigrationGate/…；
3. ledger：3-4 个新 commitKind（candidate-materialize/decision-record/gate-record/activation-record）；
   P1-02 的 baseline activate 直接复用（无新 commitKind for activation——activation 记录是演化工件）。
4. fixtures + stubs + harness（options）+ 契约套件（9 组 verification 名照票）+ restart/integration 骨架；
5. 三路并行建议：A=materialize+decision（控制/编排）；B=migration gate（VerificationEngine 端口+迁移计划计算）；
   C=activation+stale 语义+视图（双适配器投影 + baseline-change-view + restart）。

## 4. 主要风险

- STALE 语义的面最广（任何一步移动 active 都触发——需要跨工件 ref 链一致性校验）；
- migration gate 的"不允许隐式 rebase"判定（gate 失败必须显式呈现差异，不能静默消除）；
- P1-11 authority path 与 P1-14 决策的边界（P1-11 授权路径只作为"路径已存在"证据，不预授权 P1-14 candidate——决策聚合必须独立记录）；
- 视图与既有 Plan pin 的联查（planChangeView/consolePlanMatrix 消费新视图的交叉引用）。

## 5. 窗口计划

- 下一窗口：建 P1-14 共享基线 → 3 lanes（A 编排/B gate/C 视图）→ 合并验收 → 证据/票尾 → **G5（13+14）** → P1-15（最后一张）→ G3（07+15）→ MVP 评议 → stop_condition (a)。
