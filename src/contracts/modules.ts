/**
 * Module interfaces for P1-00 participants.
 * Authority: modules/control/control-engine.md, modules/interaction/human-collaboration.md.
 * P1-00 extension: ControlEngine.bootstrap (versioned addition; submit shape unchanged).
 * P1-02 extension: ControlEngine.install / activate / applyPlan (versioned
 * additions; submit & bootstrap shapes unchanged). Governance and Plan
 * command types come from ./governance.js and ./plan.js.
 */
import type {
  ActorRef,
  CommandReceipt,
  CommitCursor,
  CreateGoalCommand,
} from "./command-event.js";
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "./bootstrap.js";
import type { GoalViewQuery, GoalViewResult } from "./goal-view.js";
import type {
  GovernanceActivateCommand,
  GovernanceActivateReceipt,
  GovernanceInstallCommand,
  GovernanceInstallReceipt,
} from "./governance.js";
import type { ApplyPlanRevisionCommand, PlanRevisionReceipt } from "./plan.js";
import type {
  DispatchClaimCommand,
  DispatchClaimReceipt,
  DispatchReadinessQuery,
  DispatchReadinessResult,
  DispatchStartCommand,
  DispatchStartReceipt,
  RunFactCommand,
  RunFactReceipt,
} from "./dispatch.js";
import type { SubmitEvidenceCommand, SubmitEvidenceReceipt } from "./evidence.js";
import type { ReduceTaskCommand, ReduceTaskReceipt } from "./reduction.js";
import type { ReduceGoalCommand, ReduceGoalReceipt } from "./goal-phase.js";
import type {
  ClaimReplacementCommand,
  ClaimReplacementReceipt,
  RecordHandoffCommand,
  RecordHandoffReceipt,
} from "./handoff.js";
import type {
  AcquireReadLeaseReceipt,
  AcquireWorkspaceReadLeaseCommand,
  AcquireWorkspaceWriteLeaseCommand,
  AcquireWriteLeaseReceipt,
  ReleaseLeaseReceipt,
  ReleaseWorkspaceLeaseCommand,
} from "./workspace-lease.js";
import type { RecordIntegrationResultCommand, RecordIntegrationResultReceipt } from "./integration.js";
import type { RecordPatchCommand, RecordPatchReceipt } from "./patch.js";
import type {
  BindWorkContextCommand,
  BindWorkContextReceipt,
  LinkWorkRunCommand,
  LinkWorkRunReceipt,
  RecordContinuationCommand,
  RecordContinuationReceipt,
  RecordExecutionNoteCommand,
  RecordExecutionNoteReceipt,
} from "./context-continuity.js";
import type {
  RecordArchitectureDecisionBriefCommand,
  RecordArchitectureDecisionBriefReceipt,
  RecordArchitectureFindingCommand,
  RecordArchitectureFindingReceipt,
  RecordArchitectureInspectionCommand,
  RecordArchitectureInspectionReceipt,
  RecordCandidateBaselineProposalCommand,
  RecordCandidateBaselineProposalReceipt,
} from "./architecture-inspection.js";
import type { RecordSafePointAckCommand, RecordSafePointAckReceipt, SubmitControlCommand, SubmitControlReceipt } from "./control-intent.js";
import type { CloseQueryJobCommand, CloseQueryJobReceipt, RecordQueryAnswerCommand, RecordQueryAnswerReceipt, SubmitQueryJobCommand, SubmitQueryJobReceipt } from "./query-job.js";
import type { ApplyPlanChangeCommand, ApplyPlanChangeReceipt, RecordPlanChangeProposalCommand, RecordPlanChangeProposalReceipt, RecordUserDecisionCommand, RecordUserDecisionReceipt } from "./goal-change.js";

export type CreateGoalRequest = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  objective: string;
  actor: ActorRef;
  idempotencyKey: string;
};

export type UserFacingRejectionCode =
  | "invalid_request"
  | "scope_not_found"
  | "conflict"
  | "temporarily_unavailable";

export type CreateGoalResult =
  | { status: "persisted"; goalId: string; commitCursor: CommitCursor }
  | { status: "rejected"; code: UserFacingRejectionCode };

export interface ControlEngine {
  /** Goal create slice: unchanged shape. */
  submit(command: CreateGoalCommand): Promise<CommandReceipt>;
  /** P1-00 bootstrap extension: versioned addition to the interface. */
  bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt>;
  /** Register one explicitly mounted workspace through Control's canonical write face. */
  registerWorkspace(command: import("./workspace-registration.js").RegisterWorkspaceCommand): Promise<import("./ledger.js").LedgerCommitReceipt>;
  /** install an immutable governance revision (policy or baseline). */
  install(command: GovernanceInstallCommand): Promise<GovernanceInstallReceipt>;
  /** CAS-activate an installed revision as the Project's per-kind active ref. */
  activate(command: GovernanceActivateCommand): Promise<GovernanceActivateReceipt>;
  /** accept a hand-authored PlanRevision for an existing Goal. */
  applyPlan(command: ApplyPlanRevisionCommand): Promise<PlanRevisionReceipt>;
  /** read-only eligibility evaluation (zero writes). */
  dispatchReadiness(query: DispatchReadinessQuery): Promise<DispatchReadinessResult>;
  /** unique claim — durable outbox intent + lease + attempt + run (atomic). */
  claimTask(command: DispatchClaimCommand): Promise<DispatchClaimReceipt>;
  /** record the bounded envelope and mark the outbox intent started (CAS). */
  startRun(command: DispatchStartCommand): Promise<DispatchStartReceipt>;
  /** ingest one runtime fact — no regress, crash != outcome_unknown. */
  runFact(command: RunFactCommand): Promise<RunFactReceipt>;
  /** admit ONE immutable evidence record + binding anchor (atomic; full idempotency). */
  submitEvidence(command: SubmitEvidenceCommand): Promise<SubmitEvidenceReceipt>;
  /** deterministic Task/Gate reduction — the ONLY writer of the canonical
   * TaskReduction phase (never Goal phase — P1-05). */
  reduceTask(command: ReduceTaskCommand): Promise<ReduceTaskReceipt>;
  /** deterministic Goal phase reduction — the ONLY writer of the canonical
   * GoalPhase (never a Task phase; P1-06+ mechanisms are NOT implemented here). */
  reduceGoal(command: ReduceGoalCommand): Promise<ReduceGoalReceipt>;
  /** register a bounded HandoffPacket (body-first; immutable aggregate). */
  recordHandoff(command: RecordHandoffCommand): Promise<RecordHandoffReceipt>;
  /** replacement claim — B's NEW attempt/run lifecycle for the SAME Task
   * (lease CAS; only after A ended or A's lease expired; no Goal/phase writes). */
  claimReplacement(command: ClaimReplacementCommand): Promise<ClaimReplacementReceipt>;
  /** shared/overlapping read lease acquisition (read-read never conflicts). */
  acquireWorkspaceReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt>;
  /** exclusive write lease (index CAS — invariant #7, one writer per workspace). */
  acquireWorkspaceWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt>;
  /** holder-only lease release (no cancel/preempt — P1-10). */
  releaseWorkspaceLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt>;
  /** evidence join record (explicit conflict preservation; never overwrite). */
  recordIntegrationResult(command: RecordIntegrationResultCommand): Promise<RecordIntegrationResultReceipt>;
  /** record ONE patch artifact (body-first) + workspace revision advance + lease release (atomic). */
  recordPatch(command: RecordPatchCommand): Promise<RecordPatchReceipt>;
  /** bind the durable work identity (one per (projectId, workspaceId, workId)). */
  bindWorkContext(command: BindWorkContextCommand): Promise<BindWorkContextReceipt>;
  /** link a run to the work binding (bounded; work responsibility crosses runs). */
  linkWorkRun(command: LinkWorkRunCommand): Promise<LinkWorkRunReceipt>;
  /** register ONE immutable ExecutionNote (body-first; idempotent; no transcript). */
  recordExecutionNote(command: RecordExecutionNoteCommand): Promise<RecordExecutionNoteReceipt>;
  /** record the OBSERVED continuation path (capability declaration is never fabricated). */
  recordContinuation(command: RecordContinuationCommand): Promise<RecordContinuationReceipt>;
  /**
   * 任务工作身份的**权威只读解析**（零写入、无新聚合、无第二份事实）。
   * 按 (projectId, workspaceId, goalId, taskId) 找该任务已存在的 task 工作身份；
   * 同一任务在账本里存在多条身份时（RW-13 之前留下的历史不一致）给出确定性唯一答案：
   * 显式声明的身份优先于推导兜底身份，同为显式时取账本顺序最早的一条（不改名、不删除）。
   * 读不完整（超过扫描上限）返回 unavailable——调用方必须失败，不得凭推导 id 硬写新身份。
   */
  resolveTaskWorkIdentity(query: import("./task-work-identity.js").TaskWorkIdentityQuery): Promise<import("./task-work-identity.js").TaskWorkIdentityResolution>;
  /** record one immutable architecture inspection (pin-only baseline; CAS@0). */
  recordArchitectureInspection(command: RecordArchitectureInspectionCommand): Promise<RecordArchitectureInspectionReceipt>;
  /** record one immutable architecture finding (may have deltaRef: null — never fake a raw delta). */
  recordArchitectureFinding(command: RecordArchitectureFindingCommand): Promise<RecordArchitectureFindingReceipt>;
  /** record one immutable architecture decision brief (material/ambiguous findings). */
  recordArchitectureDecisionBrief(command: RecordArchitectureDecisionBriefCommand): Promise<RecordArchitectureDecisionBriefReceipt>;
  /** record one immutable candidate baseline proposal (deterministic digest; P1-14 consumes). */
  recordCandidateBaselineProposal(command: RecordCandidateBaselineProposalCommand): Promise<RecordCandidateBaselineProposalReceipt>;
  /** submit one durable control intent (desired state FIRST — no side effect until runtime ack). */
  submitControl(command: SubmitControlCommand): Promise<SubmitControlReceipt>;
  /** record one safe-point acknowledgement (append to the intent; CAS@N). */
  recordSafePointAck(command: RecordSafePointAckCommand): Promise<RecordSafePointAckReceipt>;
  /** claim a pending query with CAS before invoking its runtime. */
  startQueryJob(command: import("./query-job.js").StartQueryJobCommand): Promise<import("./query-job.js").StartQueryJobReceipt>;
  /** submit one non-blocking QueryJob (durable job+run first; source run untouched). */
  submitQueryJob(command: SubmitQueryJobCommand): Promise<SubmitQueryJobReceipt>;
  /** record one bounded query answer (rounds <= 4; sources + stale marker). */
  recordQueryAnswer(command: RecordQueryAnswerCommand): Promise<RecordQueryAnswerReceipt>;
  /** close a query job (timeout/gap/failed/stale_source; observable; no source-phase write). */
  closeQueryJob(command: CloseQueryJobCommand): Promise<CloseQueryJobReceipt>;
  /** record one immutable plan-change proposal (Planner proposes only). */
  recordPlanChangeProposal(command: RecordPlanChangeProposalCommand): Promise<RecordPlanChangeProposalReceipt>;
  /** record one immutable user decision (authority-target exact; zero write unless accepted). */
  recordUserDecision(command: RecordUserDecisionCommand): Promise<RecordUserDecisionReceipt>;
  /** apply an ACCEPTED decision -> new PlanRevision + GoalRevision + Goal CAS (atomic). */
  applyPlanChange(command: ApplyPlanChangeCommand): Promise<ApplyPlanChangeReceipt>;
  /**
   * RW-04（ADR 0003 D1-4/D1-5）：返工提案的自动受理——触发源是已提交的验证结论、
   * 改动落在 inScopeRework、自动化预算未耗尽、人没有拒绝过这条问题，四条同时满足才
   * 以 system 身份落账（提案 + 决定）并复用 applyPlanChange 做 CAS 应用；
   * 任一不满足返回 needs_human_decision 且零写入。
   */
  acceptReworkProposal(request: import('./rework/acceptance.js').ReworkAcceptanceRequestV1): Promise<import('./rework/acceptance.js').ReworkAcceptanceReceiptV1>;
  /** install an immutable ArchitectureEvolutionPolicy revision (never auto-activates). */
  installArchitectureEvolutionPolicy(command: import("./architecture-evolution-policy.js").InstallArchitectureEvolutionPolicyRevisionCommand): Promise<import("./architecture-evolution-policy.js").ArchitectureEvolutionPolicyInstallReceipt>;
  /** CAS-activate the project ArchitectureEvolutionPolicy active ref (per-kind independent). */
  activateArchitectureEvolutionPolicy(command: import("./architecture-evolution-policy.js").ActivateProjectArchitectureEvolutionPolicyCommand): Promise<import("./architecture-evolution-policy.js").ArchitectureEvolutionPolicyActivateReceipt>;
  /** record one allowlisted remediation plan patch (verdict recomputed; CAS@0). */
  submitRemediationPlanPatch(command: import("./remediation.js").SubmitRemediationPlanPatchCommand): Promise<import("./remediation.js").SubmitRemediationPlanPatchReceipt>;
  /** create ONE effective RemediationTask per dedup key (double-submit dedups). */
  createRemediationTask(command: import("./remediation.js").CreateRemediationTaskCommand): Promise<import("./remediation.js").CreateRemediationTaskReceipt>;
  /** advance a RemediationTask (writing/verifying/resolved/failed/blocked; CAS@N). */
  advanceRemediationTask(command: import("./remediation.js").AdvanceRemediationTaskCommand): Promise<import("./remediation.js").AdvanceRemediationTaskReceipt>;
  /** deterministically materialize the candidate baseline from a P1-12 proposal + exact source. */
  materializeCandidateBaseline(command: import("./baseline-evolution.js").MaterializeCandidateBaselineCommand): Promise<import("./baseline-evolution.js").MaterializeCandidateBaselineReceipt>;
  /** record one immutable architecture-change decision (exact candidate target). */
  recordArchitectureChangeDecision(command: import("./baseline-evolution.js").RecordArchitectureChangeDecisionCommand): Promise<import("./baseline-evolution.js").RecordArchitectureChangeDecisionReceipt>;
  /** record one migration gate result (candidate + current workspace revision). */
  recordMigrationGate(command: import("./baseline-evolution.js").RecordMigrationGateCommand): Promise<import("./baseline-evolution.js").RecordMigrationGateReceipt>;
  /** record the CAS-guarded baseline activation (ref chain + gate PASS + decision accept). */
  recordBaselineActivation(command: import("./baseline-evolution.js").RecordBaselineActivationCommand): Promise<import("./baseline-evolution.js").RecordBaselineActivationReceipt>;
  /** record one initial-design proposal (ambiguity + >=2 options). */
  recordInitialDesignProposal(command: import("./human-role-collaboration.js").RecordInitialDesignProposalCommand): Promise<import("./human-role-collaboration.js").RecordInitialDesignProposalReceipt>;
  /** record one exact initial-design decision (bound to proposal digest). */
  recordInitialDesignDecision(command: import("./human-role-collaboration.js").RecordInitialDesignDecisionCommand): Promise<import("./human-role-collaboration.js").RecordInitialDesignDecisionReceipt>;
  /** install a budgeted immutable coordination policy (never auto-activates). */
  installCoordinationPolicy(command: import("./human-role-collaboration.js").InstallCoordinationPolicyCommand): Promise<import("./human-role-collaboration.js").InstallCoordinationPolicyReceipt>;
  /** CAS-activate the project coordination policy active ref. */
  activateCoordinationPolicy(command: import("./human-role-collaboration.js").ActivateCoordinationPolicyCommand): Promise<import("./human-role-collaboration.js").ActivateCoordinationPolicyReceipt>;
  /**
   * RW-11（ADR 0003 D4-1）：安装一份不可改写的角色规格 revision（CAS@0，绝不自动生效）。
   * 角色规格决定这个角色能拿哪些工具、必须读哪些材料、必须产出什么、何时退出；
   * 它是第五个治理种类，走与 P1-02／P1-15 相同的 install/activate/CAS 路径，不新增 Module。
   */
  installRoleSpec(command: import("./role-spec.js").InstallRoleSpecRevisionCommand): Promise<import("./role-spec.js").InstallRoleSpecRevisionReceipt>;
  /** CAS 激活某个角色在本项目上的生效规格引用（每个角色一份，互相独立）。 */
  activateRoleSpec(command: import("./role-spec.js").ActivateRoleSpecRevisionCommand): Promise<import("./role-spec.js").ActivateRoleSpecRevisionReceipt>;
  /** register ONE immutable cross-principal material read grant (version-bound). */
  grantMaterialAccess(command: import("./material-access.js").GrantMaterialAccessCommand): Promise<import("./material-access.js").GrantMaterialAccessReceipt>;
  revokeMaterialAccess(command: import("./material-access.js").RevokeMaterialAccessCommand): Promise<import("./material-access.js").RevokeMaterialAccessReceipt>;
}

export interface HumanCollaboration {
  createGoal(request: CreateGoalRequest): Promise<CreateGoalResult>;
  goalView(query: GoalViewQuery): Promise<GoalViewResult>;
  /**
   * P1-08 versioned console query group (READ-ONLY face — only the
   * ReadModelIndex is consumed; control/runtime write faces are never
   * reachable from these methods; no model call, no lease refresh).
   */
  consolePortfolio(query: import("./console-views.js").PortfolioViewQuery): Promise<import("./console-views.js").PortfolioViewResult>;
  consoleSummary(query: import("./console-views.js").WorkspaceSummaryViewQuery): Promise<import("./console-views.js").WorkspaceSummaryViewResult>;
  consolePlanMatrix(query: import("./console-views.js").PlanMatrixViewQuery): Promise<import("./console-views.js").PlanMatrixViewResult>;
  consoleActiveAgents(query: import("./console-views.js").ActiveAgentsViewQuery): Promise<import("./console-views.js").ActiveAgentsViewResult>;
  consoleTaskEvidence(query: import("./console-views.js").TaskEvidenceViewQuery): Promise<import("./console-views.js").TaskEvidenceViewResult>;
  consoleTimeline(query: import("./console-views.js").TimelineViewQuery): Promise<import("./console-views.js").TimelineViewResult>;
  /**
   * HumanCollaboration goal-change surface. Missing planning material is an
   * explicit result; this interface is the authority for caller-facing shapes.
   * amend: submit a bounded AmendGoalRequest; the compiler produces a bounded
   * proposal+impact (never mutates) which Control RECORDS immutably.
   */
  amend(request: import("./goal-change.js").AmendGoalRequestV1): Promise<{ status: "accepted"; proposalRef: import("./goal-change.js").PlanProposalSnapshot["ref"] } | { status: "needs_material"; gaps: string[] } | { status: "rejected"; code: string; message: string }>;
  decide(command: import("./goal-change.js").RecordUserDecisionCommand): Promise<import("./goal-change.js").RecordUserDecisionReceipt>;
  applyChange(command: import("./goal-change.js").ApplyPlanChangeCommand): Promise<import("./goal-change.js").ApplyPlanChangeReceipt>;
}
