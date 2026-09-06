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
  /** P1-02: install an immutable governance revision (policy or baseline). */
  install(command: GovernanceInstallCommand): Promise<GovernanceInstallReceipt>;
  /** P1-02: CAS-activate an installed revision as the Project's per-kind active ref. */
  activate(command: GovernanceActivateCommand): Promise<GovernanceActivateReceipt>;
  /** P1-02: accept a hand-authored PlanRevision for an existing Goal. */
  applyPlan(command: ApplyPlanRevisionCommand): Promise<PlanRevisionReceipt>;
  /** P1-03: read-only eligibility evaluation (zero writes). */
  dispatchReadiness(query: DispatchReadinessQuery): Promise<DispatchReadinessResult>;
  /** P1-03: unique claim — durable outbox intent + lease + attempt + run (atomic). */
  claimTask(command: DispatchClaimCommand): Promise<DispatchClaimReceipt>;
  /** P1-03: record the bounded envelope and mark the outbox intent started (CAS). */
  startRun(command: DispatchStartCommand): Promise<DispatchStartReceipt>;
  /** P1-03: ingest one runtime fact — no regress, crash != outcome_unknown. */
  runFact(command: RunFactCommand): Promise<RunFactReceipt>;
  /** P1-04: admit ONE immutable evidence record + binding anchor (atomic; full idempotency). */
  submitEvidence(command: SubmitEvidenceCommand): Promise<SubmitEvidenceReceipt>;
  /** P1-04: deterministic Task/Gate reduction — the ONLY writer of the canonical
   * TaskReduction phase (never Goal phase — P1-05). */
  reduceTask(command: ReduceTaskCommand): Promise<ReduceTaskReceipt>;
  /** P1-05: deterministic Goal phase reduction — the ONLY writer of the canonical
   * GoalPhase (never a Task phase; P1-06+ mechanisms are NOT implemented here). */
  reduceGoal(command: ReduceGoalCommand): Promise<ReduceGoalReceipt>;
  /** P1-06: register a bounded HandoffPacket (body-first; immutable aggregate). */
  recordHandoff(command: RecordHandoffCommand): Promise<RecordHandoffReceipt>;
  /** P1-06: replacement claim — B's NEW attempt/run lifecycle for the SAME Task
   * (lease CAS; only after A ended or A's lease expired; no Goal/phase writes). */
  claimReplacement(command: ClaimReplacementCommand): Promise<ClaimReplacementReceipt>;
  /** P1-07: shared/overlapping read lease acquisition (read-read never conflicts). */
  acquireWorkspaceReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt>;
  /** P1-07: exclusive write lease (index CAS — invariant #7, one writer per workspace). */
  acquireWorkspaceWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt>;
  /** P1-07: holder-only lease release (no cancel/preempt — P1-10). */
  releaseWorkspaceLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt>;
  /** P1-07: evidence join record (explicit conflict preservation; never overwrite). */
  recordIntegrationResult(command: RecordIntegrationResultCommand): Promise<RecordIntegrationResultReceipt>;
  /** P1-07: record ONE patch artifact (body-first) + workspace revision advance + lease release (atomic). */
  recordPatch(command: RecordPatchCommand): Promise<RecordPatchReceipt>;
  /** P1-16: bind the durable work identity (one per (projectId, workspaceId, workId)). */
  bindWorkContext(command: BindWorkContextCommand): Promise<BindWorkContextReceipt>;
  /** P1-16: link a run to the work binding (bounded; work responsibility crosses runs). */
  linkWorkRun(command: LinkWorkRunCommand): Promise<LinkWorkRunReceipt>;
  /** P1-16: register ONE immutable ExecutionNote (body-first; idempotent; no transcript). */
  recordExecutionNote(command: RecordExecutionNoteCommand): Promise<RecordExecutionNoteReceipt>;
  /** P1-16: record the OBSERVED continuation path (capability declaration is never fabricated). */
  recordContinuation(command: RecordContinuationCommand): Promise<RecordContinuationReceipt>;
  /** P1-12: record one immutable architecture inspection (pin-only baseline; CAS@0). */
  recordArchitectureInspection(command: RecordArchitectureInspectionCommand): Promise<RecordArchitectureInspectionReceipt>;
  /** P1-12: record one immutable architecture finding (may have deltaRef: null — never fake a raw delta). */
  recordArchitectureFinding(command: RecordArchitectureFindingCommand): Promise<RecordArchitectureFindingReceipt>;
  /** P1-12: record one immutable architecture decision brief (material/ambiguous findings). */
  recordArchitectureDecisionBrief(command: RecordArchitectureDecisionBriefCommand): Promise<RecordArchitectureDecisionBriefReceipt>;
  /** P1-12: record one immutable candidate baseline proposal (deterministic digest; P1-14 consumes). */
  recordCandidateBaselineProposal(command: RecordCandidateBaselineProposalCommand): Promise<RecordCandidateBaselineProposalReceipt>;
  /** P1-10: submit one durable control intent (desired state FIRST — no side effect until runtime ack). */
  submitControl(command: SubmitControlCommand): Promise<SubmitControlReceipt>;
  /** P1-10: record one safe-point acknowledgement (append to the intent; CAS@N). */
  recordSafePointAck(command: RecordSafePointAckCommand): Promise<RecordSafePointAckReceipt>;
  /** P1-09: submit one non-blocking QueryJob (durable job+run first; source run untouched). */
  submitQueryJob(command: SubmitQueryJobCommand): Promise<SubmitQueryJobReceipt>;
  /** P1-09: record one bounded query answer (rounds <= 4; sources + stale marker). */
  recordQueryAnswer(command: RecordQueryAnswerCommand): Promise<RecordQueryAnswerReceipt>;
  /** P1-09: close a query job (timeout/gap/failed/stale_source; observable; no source-phase write). */
  closeQueryJob(command: CloseQueryJobCommand): Promise<CloseQueryJobReceipt>;
  /** P1-11: record one immutable plan-change proposal (Planner proposes only). */
  recordPlanChangeProposal(command: RecordPlanChangeProposalCommand): Promise<RecordPlanChangeProposalReceipt>;
  /** P1-11: record one immutable user decision (authority-target exact; zero write unless accepted). */
  recordUserDecision(command: RecordUserDecisionCommand): Promise<RecordUserDecisionReceipt>;
  /** P1-11: apply an ACCEPTED decision -> new PlanRevision + GoalRevision + Goal CAS (atomic). */
  applyPlanChange(command: ApplyPlanChangeCommand): Promise<ApplyPlanChangeReceipt>;
  /** P1-13: install an immutable ArchitectureEvolutionPolicy revision (never auto-activates). */
  installArchitectureEvolutionPolicy(command: import("./architecture-evolution-policy.js").InstallArchitectureEvolutionPolicyRevisionCommand): Promise<import("./architecture-evolution-policy.js").ArchitectureEvolutionPolicyInstallReceipt>;
  /** P1-13: CAS-activate the project ArchitectureEvolutionPolicy active ref (per-kind independent). */
  activateArchitectureEvolutionPolicy(command: import("./architecture-evolution-policy.js").ActivateProjectArchitectureEvolutionPolicyCommand): Promise<import("./architecture-evolution-policy.js").ArchitectureEvolutionPolicyActivateReceipt>;
  /** P1-13: record one allowlisted remediation plan patch (verdict recomputed; CAS@0). */
  submitRemediationPlanPatch(command: import("./remediation.js").SubmitRemediationPlanPatchCommand): Promise<import("./remediation.js").SubmitRemediationPlanPatchReceipt>;
  /** P1-13: create ONE effective RemediationTask per dedup key (double-submit dedups). */
  createRemediationTask(command: import("./remediation.js").CreateRemediationTaskCommand): Promise<import("./remediation.js").CreateRemediationTaskReceipt>;
  /** P1-13: advance a RemediationTask (writing/verifying/resolved/failed/blocked; CAS@N). */
  advanceRemediationTask(command: import("./remediation.js").AdvanceRemediationTaskCommand): Promise<import("./remediation.js").AdvanceRemediationTaskReceipt>;
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
   * P1-11 versioned goal-change group (HumanCollaboration.GoalChangePort —
   * first QUIET freeze for PlanCompiler.PlanProposalPort /
   * ContextCompiler.PlanningContextPort; later planning/change tickets may
   * only consume these versions or submit an explicit version upgrade).
   * amend: submit a bounded AmendGoalRequest; the compiler produces a bounded
   * proposal+impact (never mutates) which Control RECORDS immutably.
   */
  amend(request: import("./goal-change.js").AmendGoalRequestV1): Promise<{ status: "accepted"; proposalRef: import("./goal-change.js").PlanProposalSnapshot["ref"] } | { status: "needs_material"; gaps: string[] } | { status: "rejected"; code: string; message: string }>;
  decide(command: import("./goal-change.js").RecordUserDecisionCommand): Promise<import("./goal-change.js").RecordUserDecisionReceipt>;
  applyChange(command: import("./goal-change.js").ApplyPlanChangeCommand): Promise<import("./goal-change.js").ApplyPlanChangeReceipt>;
}