# 契约使用审计：哪些声明可以缩减（2026-09-11）

**问题**：`src/contracts` 115 个文件里的契约声明，是否全都能在其它源码中找到消费者？哪些确实可以缩减？

**方法**（可复现，脚本即本目录 [`audit.mjs`](audit.mjs)）：
用 TypeScript 编译器 API 逐条解析 115 个契约文件的每条 `export` 声明，再把全仓（`src`、`tests`、`scripts`，含 `src/ui` 的 TS）的引用分桶：

- ①普通 `import { X as Y }`（解析 `.js` → `.ts` 说明符，按 `propertyName` 取原名）；
- ②内联 `import("./x.js").X` 类型引用；
- ③同文件内的标识符读取（排除声明名自身、属性签名与成员访问）。

只出现在 `evidence/**/*.json`（历史清点记录）、注释或字符串常量里的名字**不计**为消费者。

**基线**：1465 条导出声明（与上一轮 `export-pruning/consumers-after.json` 登记的 1463 条一致，差 2 条为本轮新增文件）。
本页只登记事实与可选缩减项，不改变产品语义、持久字段、HTTP 形状；正式准入政策仍在 Control/StateLedger。

## 1. 全部导出声明的消费者分布

| 分类 | 条数 | 占比 | 含义 |
| --- | --- | --- | --- |
| A. `src/contracts` 之外的源码直接导入 | 1172 | 80.0% | 真实跨 Module 消费，保留 |
| B. 仅被其它契约文件导入（`modules.ts` 等聚合面） | 111 | 7.6% | 契约内部组合，保留 |
| C. 仅被 `tests/`、`scripts/` 消费 | 18 | 1.2% | 测试与校验链消费 |
| D. 无任何导入，但声明文件内部自己读 | 108 | 7.4% | 定义是真的，**export 关键字多余** |
| E. 无任何导入，且声明文件内部也不读 | 56 | 3.8% | **定义没有读者** |

结论：**96.2%**（A+B+C+D = 1409 条）在仓库里有真实读取点。可缩减的是 D 与 E 两类，共 164 条（11.2%）：
D 类只该去掉导出关键字（约 1141 行从"导出面"移出，定义保留）；E 类共 56 条、197 行可删。

**可直接动的最小集合**：E 类 56 条中，**43 条在任何文档、工单、源码里都没有出处**（8 个零调用函数、31 个无读者常量、
4 个无出处类型/接口），删除它们不会与任何规范冲突；另外 13 条有文档出处，见 1.4，须先决定接通还是登记为未实现。

E 类的构成（按声明种类）：

| 种类 | 条数 | 说明 |
| --- | --- | --- |
| `export function` | 8 | 全仓零调用，见 1.1 |
| `export const` | 31 | 上限常量与 schema 版本号，无读取者，见 1.2 |
| `export type` | 9 | 其中 3 条是纯别名（`CodeGraphSnapshot = CodeGraphSnapshotV1`、`CommandEnvelope`、`RoleResponsibilitySpecV1`），6 条是无人引用的结果/视图类型 |
| `export interface` | 8 | 已声明、从未接线的 port，见 1.3 |

### 1.1 E 类里有 8 个函数是"零调用"

不只是没有 import，而是全仓（含自身文件、`tests`、`scripts`）**从未被调用**：
`architectureDeltaRef`、`migrationPlanConsistent`、`reductionPhaseOf`、`handoffPacketBody`、
`workspaceCapabilityFingerprintInput`、`commandIdentityEqual`、`validateContinuationCheckRequest`、`validateGoalViewQuery`。

### 1.2 E 类里有 31 个常量没有任何读取者

其中约 20 个是"上限"常量：`CONTROL_INTENT_MAX_REASONS`、`PLAN_CHANGE_MAX_REASONS`、`COMPLETED_WORK_MAX_SOURCES`、
`QUERY_JOB_MAX_SOURCES`、`WORKSPACE_LEASE_MAX_ACTIVE_READ_LEASES` 等。对照真实被执行的同类常量——
`INSPECTION_MAX_OPTIONS`、`HANDOFF_MAX_COMPLETED`、`EVIDENCE_SUMMARY_MAX_BYTES` 由 `validation/*.ts` 导入并参与判断——
这些常量没有任何读取者。即：**契约声明了上限、实现没有执行该上限**。
这是本次审计发现的真实缺口，需人判断"补执行点"还是"删声明"，不能长期留着一份没有读者的承诺。

### 1.3 E 类里有 8 个从未接线的 port

`ControlIntentPort`、`ControlCommandPort`、`InitialDesignPort`、`UnifiedStatusPort`、`CoordinationPolicyPort`、
`ArchitectureDecisionPort`、`RoleSpecPort`、`ReviewReadModelPort`。其中 `UnifiedStatusPort` 只在一处测试字符串里
（`"HumanCollaboration.UnifiedStatusPort"`）被当作名字提到，没有任何类型消费者。

### 1.4 文档交叉核对：56 条里 13 条有规范/工单出处

把 E 类 56 个名字拿去比对文档根的全部 `.md`（规范、Interface、归档、ticket）：

| 有文档出处（13 条） | 出处 |
| --- | --- |
| `CommandEnvelope` | `dev_docs/interfaces/command-event.md`（**当前接口文档**） |
| `ControlIntentPort`、`ControlCommandPort` | `tickets/10-lifecycle-controls-safe-steer.md` |
| `InitialDesignPort`、`UnifiedStatusPort`、`CoordinationPolicyPort` | `tickets/15-human-role-collaboration.md` |
| `ArchitectureDecisionPort`、`migrationPlanConsistent` | `tickets/14-baseline-activation.md` + 归档交接 |
| `CodeGraphSnapshot`、`WorkspaceSelectionRoute`、`CONSOLE_EVIDENCE_SUMMARY_MAX_BYTES`、`HANDOFF_CONTROL_MAX_REPORT_BYTES`、`REVIEW_SUMMARY_MAX_BYTES` | 归档交接与 P1-08/P1-12 证据 |

**其余 43 条在任何文档里都不存在**——它们既没有源码读者，也没有规范出处。
因此缩减应当分两步：43 条无出处者可直接清理；13 条有出处者属于"声明过、未接线"，
要么按 ticket 接通，要么在 `module-status.md` 的义务里明确登记为未实现，再决定去留。

### 1.5 与上一轮记录的关系

上一轮 `export-pruning/consumers-after.json` 已记录 152 条 `consumers: []`，但该轮明确"未断言剩余导出全部必要"，
只完成"删除 9 个无消费者声明、54 个仅文件内使用取消 export"。本页把 E 类 56 条逐条定位到行号，
并补上 D 类（文件内自用）与"函数零调用 / 常量零执行"两层区分。

## 2. E 类：56 条无任何读者的声明（可删）

| 文件 | 行 | 导出名 | 声明 |
| --- | --- | --- | --- |
| architecture-evolution-policy.ts | 21 | `ARCHITECTURE_EVOLUTION_POLICY_MAX_ALLOWLIST_ENTRIES` | `export const ARCHITECTURE_EVOLUTION_POLICY_MAX_ALLOWLIST_ENTRIES = 64;` |
| architecture-evolution-policy.ts | 22 | `ARCHITECTURE_EVOLUTION_POLICY_MAX_DRIFT_BUDGET` | `export const ARCHITECTURE_EVOLUTION_POLICY_MAX_DRIFT_BUDGET = 12;` |
| architecture-evolution-policy.ts | 23 | `ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_MAX_BYTES` | `export const ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_MAX_BYTES = 32 * 10` |
| architecture-evolution-policy.ts | 215 | `ProjectArchitectureEvolutionPolicyActiveResolution` | `export type ProjectArchitectureEvolutionPolicyActiveResolution =` |
| architecture-inspection.ts | 57 | `INSPECTION_MAX_AFFECTED_REFS` | `export const INSPECTION_MAX_AFFECTED_REFS = 32;` |
| architecture-inspection.ts | 60 | `INSPECTION_SNAPSHOT_MAX_BYTES` | `export const INSPECTION_SNAPSHOT_MAX_BYTES = 256 * 1024;` |
| architecture-inspection.ts | 63 | `INSPECTION_PROPOSAL_MAX_BYTES` | `export const INSPECTION_PROPOSAL_MAX_BYTES = 32 * 1024;` |
| architecture-inspection.ts | 109 | `architectureDeltaRef` | `export function architectureDeltaRef(delta: ArchitectureDeltaV1): Arti` |
| architecture-inspection.ts | 190 | `CodeGraphSnapshot` | `export type CodeGraphSnapshot = CodeGraphSnapshotV1;` |
| baseline-evolution.ts | 35 | `BASELINE_EVOLUTION_MIGRATION_SUMMARY_MAX_BYTES` | `export const BASELINE_EVOLUTION_MIGRATION_SUMMARY_MAX_BYTES = 4096;` |
| baseline-evolution.ts | 36 | `BASELINE_EVOLUTION_MAX_AFFECTED_PLANS` | `export const BASELINE_EVOLUTION_MAX_AFFECTED_PLANS = 64;` |
| baseline-evolution.ts | 37 | `BASELINE_EVOLUTION_MAX_GATE_EVIDENCE` | `export const BASELINE_EVOLUTION_MAX_GATE_EVIDENCE = 16;` |
| baseline-evolution.ts | 261 | `migrationPlanConsistent` | `export function migrationPlanConsistent(plan: MigrationPlanV1, gate: M` |
| baseline-evolution.ts | 287 | `ArchitectureDecisionPort` | `export interface ArchitectureDecisionPort {` |
| bootstrap.ts | 131 | `BootstrapManifestId` | `export type BootstrapManifestId = Opaque<string, "BootstrapManifestId"` |
| command-event.ts | 39 | `CommandEnvelope` | `export type CommandEnvelope = CreateGoalCommand;` |
| command-event.ts | 130 | `commandIdentityEqual` | `export function commandIdentityEqual(a: CommandIdentity, b: CommandIde` |
| completed-work-context.ts | 56 | `COMPLETED_WORK_MAX_RELATED_REFS` | `export const COMPLETED_WORK_MAX_RELATED_REFS = 32;` |
| completed-work-context.ts | 58 | `COMPLETED_WORK_MAX_SOURCES` | `export const COMPLETED_WORK_MAX_SOURCES = 64;` |
| completed-work-context.ts | 59 | `COMPLETED_WORK_SELECTION_MAX_BYTES` | `export const COMPLETED_WORK_SELECTION_MAX_BYTES = 64 * 1024;` |
| completed-work-context.ts | 60 | `COMPLETED_WORK_BUNDLE_MAX_BYTES` | `export const COMPLETED_WORK_BUNDLE_MAX_BYTES = 256 * 1024;` |
| completed-work-context.ts | 139 | `ExecutionMemorySelectionV1` | `export type ExecutionMemorySelectionV1 = {` |
| console-views.ts | 99 | `CONSOLE_EVIDENCE_SUMMARY_MAX_BYTES` | `export const CONSOLE_EVIDENCE_SUMMARY_MAX_BYTES = 4096;` |
| console-views.ts | 136 | `WorkspaceSelectionRoute` | `export type WorkspaceSelectionRoute = {` |
| context-continuity.ts | 40 | `EXECUTION_NOTE_BODY_MAX_BYTES` | `export const EXECUTION_NOTE_BODY_MAX_BYTES = 64 * 1024;` |
| control-intent.ts | 46 | `CONTROL_INTENT_MAX_REASONS` | `export const CONTROL_INTENT_MAX_REASONS = 8;` |
| control-intent.ts | 47 | `CONTROL_STEER_PAYLOAD_MAX_BYTES` | `export const CONTROL_STEER_PAYLOAD_MAX_BYTES = 16 * 1024;` |
| control-intent.ts | 49 | `CONTROL_INTENT_SUMMARY_MAX_BYTES` | `export const CONTROL_INTENT_SUMMARY_MAX_BYTES = 1024;` |
| control-intent.ts | 50 | `CONTROL_TIMELINE_MAX_ENTRIES` | `export const CONTROL_TIMELINE_MAX_ENTRIES = 64;` |
| control-intent.ts | 285 | `ControlIntentPort` | `export interface ControlIntentPort {` |
| control-intent.ts | 293 | `ControlCommandPort` | `export interface ControlCommandPort {` |
| goal-change.ts | 18 | `PLAN_CHANGE_MAX_REASONS` | `export const PLAN_CHANGE_MAX_REASONS = 16;` |
| goal-change.ts | 19 | `PLAN_CHANGE_PROPOSAL_MAX_BYTES` | `export const PLAN_CHANGE_PROPOSAL_MAX_BYTES = 32 * 1024;` |
| goal-change.ts | 26 | `PLAN_CHANGE_DECISION_SUMMARY_MAX_BYTES` | `export const PLAN_CHANGE_DECISION_SUMMARY_MAX_BYTES = 4096;` |
| goal-phase.ts | 102 | `GOAL_PHASE_REASON_CODES` | `export const GOAL_PHASE_REASON_CODES: readonly GoalPhaseReasonCode[] =` |
| handoff-control.ts | 25 | `HANDOFF_CONTROL_MAX_REPORT_BYTES` | `export const HANDOFF_CONTROL_MAX_REPORT_BYTES = 32 * 1024;` |
| handoff.ts | 190 | `handoffPacketBody` | `export function handoffPacketBody(packet: HandoffPacketV1): string {` |
| human-role-collaboration.ts | 196 | `InitialDesignPort` | `export interface InitialDesignPort {` |
| human-role-collaboration.ts | 203 | `UnifiedStatusPort` | `export interface UnifiedStatusPort {` |
| human-role-collaboration.ts | 208 | `CoordinationPolicyPort` | `export interface CoordinationPolicyPort {` |
| query-job.ts | 35 | `QUERY_JOB_MAX_SOURCES` | `export const QUERY_JOB_MAX_SOURCES = 64;` |
| read-model.ts | 5 | `ReviewReadModelPort` | `export interface ReviewReadModelPort {` |
| reduction.ts | 217 | `reductionPhaseOf` | `export function reductionPhaseOf(phase: TaskReductionPhase): Phase {` |
| remediation.ts | 30 | `REMEDIATION_MAX_PATCH_CHANGED_PATHS` | `export const REMEDIATION_MAX_PATCH_CHANGED_PATHS = 64;` |
| remediation.ts | 31 | `REMEDIATION_PATCH_SUMMARY_MAX_BYTES` | `export const REMEDIATION_PATCH_SUMMARY_MAX_BYTES = 4096;` |
| review-context.ts | 25 | `REVIEW_SUMMARY_MAX_BYTES` | `export const REVIEW_SUMMARY_MAX_BYTES = 4096;` |
| role-spec.ts | 62 | `RoleResponsibilitySpecV1` | `export type RoleResponsibilitySpecV1 = RoleResponsibilityV1;` |
| role-spec.ts | 254 | `RoleSpecPort` | `export interface RoleSpecPort {` |
| validation/context.ts | 364 | `validateContinuationCheckRequest` | `export function validateContinuationCheckRequest(value: unknown): Vali` |
| validation/goal.ts | 56 | `validateGoalViewQuery` | `export function validateGoalViewQuery(value: unknown): ValidationIssue` |
| verification.ts | 32 | `CHANGE_SCOPE_SUMMARY_MAX_BYTES` | `export const CHANGE_SCOPE_SUMMARY_MAX_BYTES = 2048;` |
| work-context-port.ts | 58 | `WorkContextBundleV1` | `export type WorkContextBundleV1 = {` |
| workspace-capability.ts | 14 | `WORKSPACE_CAPABILITY_SCHEMA_VERSION` | `export const WORKSPACE_CAPABILITY_SCHEMA_VERSION = 1 as const;` |
| workspace-capability.ts | 64 | `workspaceCapabilityFingerprintInput` | `export function workspaceCapabilityFingerprintInput(caps: WorkspaceCap` |
| workspace-lease.ts | 47 | `WORKSPACE_LEASE_MAX_ACTIVE_READ_LEASES` | `export const WORKSPACE_LEASE_MAX_ACTIVE_READ_LEASES = 256;` |
| workspace-lease.ts | 503 | `WorkspaceLeaseDomainEvent` | `export type WorkspaceLeaseDomainEvent =` |

> 口径说明：`type X = Y` 形式（如 `CodeGraphSnapshot = CodeGraphSnapshotV1`）是重复别名，删除不影响任何读者；
> `interface` 形式的孤立 port（如 `ReviewReadModelPort`、`ControlIntentPort`）是"已声明、从未接线"的接口，
> 删除前应确认它不属于下一步待接的能力（本页只登记事实）。

## 3. D 类：108 条仅文件内自用的声明（去掉 export 关键字即可）

这些定义仍被自己文件使用，删除会破坏编译；正确动作是收缩导出面——它们让"公共契约"看起来比实际大 7.4%。

| 文件 | 行 | 导出名 |
| --- | --- | --- |
| architecture-context.ts | 7 | `ArchitectureInspectionMaterials` |
| architecture-evolution-policy.ts | 25 | `ArchitectureEvolutionPolicyScopeKind` |
| architecture-evolution-policy.ts | 27 | `ArchitectureEvolutionPolicyAllowlistEntryV1` |
| architecture-inspection.ts | 161 | `CodeGraphIndexCapabilities` |
| architecture-inspection.ts | 196 | `DeltaChangeKind` |
| architecture-inspection.ts | 197 | `DeltaChangeLevel` |
| architecture-inspection.ts | 233 | `ArchitectureFindingSource` |
| architecture-inspection.ts | 249 | `ArchitectureFindingRisk` |
| architecture-inspection.ts | 250 | `ArchitectureFindingConfidence` |
| architecture-inspection.ts | 277 | `ArchitectureDecisionBriefOption` |
| architecture-inspection.ts | 327 | `candidateProposalPayload` |
| architecture-inspection.ts | 348 | `InspectionSource` |
| architecture-inspection.ts | 401 | `RecordArchitectureInspectionRejectionCode` |
| architecture-inspection.ts | 425 | `RecordArchitectureFindingRejectionCode` |
| architecture-inspection.ts | 449 | `RecordArchitectureDecisionBriefRejectionCode` |
| architecture-inspection.ts | 473 | `RecordCandidateBaselineProposalRejectionCode` |
| baseline-evolution.ts | 121 | `MigrationGateStatus` |
| bootstrap.ts | 155 | `DEFAULT_BOOTSTRAP_ACTOR` |
| bootstrap.ts | 160 | `BuildBootstrapCommandDeps` |
| commands/architecture.ts | 6 | `BuildArchitectureCommandDeps` |
| commands/context.ts | 14 | `BuildBindWorkContextDeps` |
| commands/context.ts | 57 | `BuildLinkWorkRunDeps` |
| commands/dispatch.ts | 6 | `BuildDispatchClaimDeps` |
| commands/dispatch.ts | 22 | `BuildRunFactDeps` |
| commands/evidence.ts | 10 | `BuildEvidenceDeps` |
| commands/evidence.ts | 27 | `BuildSubmitEvidenceDeps` |
| commands/evidence.ts | 36 | `BuildReduceTaskDeps` |
| commands/goal-phase.ts | 4 | `BuildReduceGoalDeps` |
| commands/goal.ts | 4 | `CreateGoalScope` |
| commands/goal.ts | 12 | `BuildCreateGoalDeps` |
| commands/plan.ts | 5 | `BuildApplyPlanDeps` |
| commands/workspace.ts | 7 | `BuildAcquireReadDeps` |
| commands/workspace.ts | 21 | `BuildAcquireWriteDeps` |
| commands/workspace.ts | 36 | `BuildReleaseDeps` |
| commands/workspace.ts | 49 | `BuildRecordPatchDeps` |
| commands/workspace.ts | 59 | `WorkspaceCommandActor` |
| completed-work-context.ts | 62 | `CompletedWorkRelatedRef` |
| completed-work-context.ts | 99 | `CompletedWorkApplicability` |
| console-views.ts | 80 | `ConsoleExplanationStatus` |
| console-views.ts | 457 | `TimelineChangeFact` |
| control-intent.ts | 73 | `ControlTargetScope` |
| control-intent.ts | 171 | `SubmitControlRejectionCode` |
| control-intent.ts | 197 | `RecordSafePointAckRejectionCode` |
| events.ts | 61 | `DomainEventV1` |
| evidence.ts | 79 | `EvidenceSourceV1` |
| evidence.ts | 87 | `EvidenceSummaryV1` |
| evidence.ts | 175 | `RequirementKey` |
| evidence.ts | 213 | `SubmitEvidenceRejectionCode` |
| exploration-session.ts | 70 | `ExplorationSessionView` |
| exploration.ts | 9 | `ExplorationTask` |
| fingerprint.ts | 15 | `JsonPrimitive` |
| fingerprint.ts | 18 | `CanonicalJsonError` |
| goal-phase.ts | 56 | `GOAL_PHASES` |
| goal-phase.ts | 189 | `GoalChangePendingFact` |
| goal-phase.ts | 194 | `GoalDecisionNeedFact` |
| goal-phase.ts | 331 | `ReduceGoalRejectionCode` |
| goal-view.ts | 67 | `ProjectionStallReason` |
| handoff.ts | 107 | `HandoffSourceV1` |
| handoff.ts | 127 | `HandoffCompletedItemV1` |
| handoff.ts | 134 | `HandoffUnresolvedKind` |
| handoff.ts | 142 | `HandoffUnresolvedItemV1` |
| handoff.ts | 297 | `RecordHandoffRejectionCode` |
| handoff.ts | 342 | `ClaimReplacementRejectionCode` |
| history-materials.ts | 6 | `HistoryMaterialRead` |
| human-role-collaboration.ts | 43 | `InitialDesignOptionV1` |
| human-role-collaboration.ts | 213 | `Result` |
| integration.ts | 210 | `RecordIntegrationResultRejectionCode` |
| operator-planning.ts | 4 | `PublicExplorationPlan` |
| patch.ts | 40 | `PatchCheckOutcome` |
| patch.ts | 150 | `RecordPatchRejectionCode` |
| reduction.ts | 56 | `TaskReductionCauseCode` |
| reduction.ts | 153 | `ReduceTaskRejectionCode` |
| reduction.ts | 216 | `Phase` |
| remediation.ts | 95 | `RemediationTaskResultV1` |
| remediation.ts | 177 | `SubmitRemediationPlanPatchRejectionCode` |
| remediation.ts | 182 | `CreateRemediationTaskRejectionCode` |
| remediation.ts | 187 | `AdvanceRemediationTaskRejectionCode` |
| review-context.ts | 101 | `ReviewManifestV1` |
| role-material-channels.ts | 51 | `RoleSourceIndexEntryV1` |
| role-material-channels.ts | 53 | `RoleSourceIndexExcerptV1` |
| role-spec.ts | 44 | `RoleResponsibilityV1` |
| role-spec.ts | 63 | `RoleMaterialRequirementV1` |
| role-spec.ts | 64 | `RoleOutputRequirementV1` |
| role-spec.ts | 66 | `RoleSpecPermissionsV1` |
| role-spec.ts | 78 | `RoleSpecBudgetV1` |
| role-spec.ts | 85 | `RoleSpecExitV1` |
| runtime-preparation.ts | 19 | `PreparedRunStatus` |
| task-work-identity.ts | 32 | `WORK_IDENTITY_MAX_CHAIN_HOPS` |
| validation/architecture.ts | 86 | `validateArchitectureFinding` |
| validation/architecture.ts | 136 | `validateArchitectureDecisionBrief` |
| validation/architecture.ts | 180 | `validateArchitectureCandidateProposal` |
| validation/bootstrap.ts | 8 | `validateBootstrapEntries` |
| validation/common.ts | 4 | `ValidationIssueCode` |
| validation/context.ts | 67 | `validateExecutionNote` |
| validation/context.ts | 163 | `validateContextContinuationResult` |
| validation/evidence.ts | 8 | `validateEvidenceSource` |
| validation/evidence.ts | 49 | `validateEvidenceCoverage` |
| validation/governance.ts | 7 | `validateCompletionPolicyContent` |
| validation/governance.ts | 236 | `validateArchitectureEvolutionPolicyFixture` |
| validation/role.ts | 16 | `validateRoleSpecContent` |
| validation/role.ts | 162 | `validateRoleSpecPin` |
| work-context-port.ts | 84 | `WorkContextRejectionCode` |
| workspace-capability.ts | 16 | `WorkspaceCapabilitySource` |
| workspace-lease.ts | 53 | `ConflictScopeKind` |
| workspace-lease.ts | 75 | `isPathLikeScopeKind` |
| workspace-lease.ts | 233 | `WorkspaceWriteLeaseV1` |
| workspace-views.ts | 30 | `WorkspaceLeaseViewWriteEntry` |
| workspace-views.ts | 44 | `WorkspaceLeaseViewReadEntry` |

## 4. 登记与命名问题（结构本身不动）

- `src/contracts/README.md` 只登记了 115 个文件中的 25 个（21.7%），90 个契约文件在任何 README 中都不出现。
- 命名歧义 3 处：`review-context.ts` vs `reviewer-context.ts`、`verification-context.ts` vs `reviewer-verification.ts`、
  `planning.ts` vs `plan.ts`。
- 目录结构（115 文件，85 个平铺在根）与"无 barrel、消费者直接导入协议文件"的既有约定一致；
  本页不主张重排目录：重排需改 1067 个引用点，收益是导航性而非正确性。

## 5. 未验证与边界

- 只证明"在当前工作树里没有读者"，不证明这些声明不承载设计意图；E 类上限常量需要人裁决。
- 未把 `evidence/**/*.json` 历史清点记录当消费者，故 E 类条目仍会出现在那些文件里。
- 未检查 `src/contracts` 之外的实现是否复制了同样的类型（潜在第二份事实），属另一议题。
- 本轮只做静态引用分析，未跑测试；缩减类改动落地时必须重跑 `pnpm typecheck`、`pnpm test`、`node scripts/check-module-boundaries.mjs`。

## 6. 复现

```bash
node evidence/2026-09-11-contracts-usage-audit/audit.mjs
```
