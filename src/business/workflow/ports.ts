import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import type { DecisionApplicationReceiptV1 } from '../../contracts/core/session-message.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { RoleConfigurationRef, WorkspaceScope } from '../../contracts/core/identity.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { ReadResult, WriteResult } from '../../contracts/core/results.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../contracts/plan.js';
import type { TaskClaim } from '../../contracts/core/task-claim.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskBudgetV1, TaskTriple } from '../../contracts/dispatch.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import type { DecisionSourceV1 } from '../../contracts/goal-decisions.js';
import type { QueryJobAnswerRef, QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../contracts/query-job.js';
import type { PlatformDutyV1 } from '../../contracts/platform-duty.js';
import type { PlanDiagnosisFindingV1, PlanReviewReadV1 } from '../../contracts/plan-review.js';
import type {
  PlanFixReadV1, PlanningQuestionGroupV1, TaskbookExportReadPort, TaskbookExportReadV1,
} from '../../contracts/plan-round.js';
import type { CheckCapabilityV1 } from '../../contracts/verification.js';
import type { GoalTaskPort } from '../../core/work-graph/model/task-contracts.js';
import type { TaskRow } from '../../core/work-graph/model/plan-contracts.js';
import type { PlanProposal, PlanProposalRef, PlanTaskPort } from '../../core/work-graph/model/plan-contracts.js';
import type { GraphWrite } from '../../core/work-graph/model/task-contracts.js';
import type { TaskInputUpstreamPort } from '../../core/work-graph/model/context-input-contracts.js';
import type { SessionDirectoryPort } from '../../core/work-graph/model/session-contracts.js';
import type {
  SessionFactsPort, SessionResponsibilityBasisPort,
} from '../../core/work-graph/model/session-facts-contracts.js';
import type { DeliveryEligibilityFactsV1 } from '../../core/work-graph/model/session-facts-contracts.js';
import type { SessionLifecyclePort } from '../../core/work-graph/sessions/lifecycle-contracts.js';
import type { SessionResponsibilityPort } from '../../core/work-graph/sessions/session-responsibility-service.js';
import type { SessionAnomalyPort } from '../../core/work-graph/tasks/session-anomaly-service.js';
import type { RunControlPort } from '../../core/work-graph/tasks/control-contracts.js';
import type { TaskClaimPort } from '../../core/work-graph/model/claim-contracts.js';
import type {
  UnknownCallReviewPort, UnknownCallReviewReadPort,
} from '../../core/work-graph/model/unknown-call-review-contracts.js';
import type { ExecutionReadPort } from '../../core/work-graph/model/execution-read-contracts.js';
import type { EvidencePort } from '../../core/work-graph/model/evidence-contracts.js';
import type { RuntimeExecutionPort } from '../../core/agent-runtime/ports.js';
import type { RegisteredCheckRunner } from '../../core/agent-runtime/check-execution.js';
import type { SourceSnapshotReads } from '../../core/work-graph/source-authority-ports.js';
import type { SendMessageResultV1, SessionMailboxPort } from '../../core/work-graph/model/communication-contracts.js';
import type {
  DecisionCardV1, DecisionMessagePort, DecisionReadPort, GoalExecutedFilesPort,
  GoalSettingsPort, MessageDutiesFactsPort, MessageReleaseCandidatesPort, MessageReleasePort,
} from '../../core/work-graph/model/decision-contracts.js';
import type { ProjectRegistrationPort } from '../../core/work-graph/configuration/project-bootstrap-contracts.js';
import type { QueryExecutionRecord, QueryJobPort } from '../../core/work-graph/queries/contracts.js';
import type { SessionArchivePort } from './session-archive.js';
import type { SessionHandoffWorkflowPort } from '../../core/work-graph/model/session-handoff-contracts.js';
import type { SessionMaintenancePort } from './session-maintenance.js';
import type { DecisionApplicationAdapter } from './decision-actions.js';
import type { RunActivityPort } from '../../core/work-graph/tasks/run-activity-service.js';
import type { DeviationInputV1 } from '../../contracts/plan-deviation.js';
import type { RequestSubmitPort } from './request-intake.js';
import type { ActivityBackfillBatchV1, ActivityBackfillInput, ActivityBackfillRangeInput,
  ConsultationInput, ConsultationResult, InitialPlanningGoalInput, InitialPlanningGoalInputResult,
  RedriveAnswerV1, ResolveDecisionInputV1, ResolveDecisionReadV1, WorkflowAdvanceInput, WorkflowAdvanceInternal, WorkflowAdvanceResult, WorkflowCloseEventReader } from './contracts.js';
import type { ConsultationFactsPort } from '../../core/work-graph/queries/platform-facts.js';
import type { MemberRequestPortV1 } from '../../core/work-graph/tasks/member-service.js';
import type { OverlapGatePort } from '../../core/work-graph/tasks/overlap-gates.js';
import type { PickReadsV1 } from './session-chooser.js';
import type { systemRoundSendInput } from './plan-round.js';
import type { RepairActivationService } from '../../core/work-graph/notes/activate-repair.js';

/**
 * Trusted Host advancement policy. It is pure data snapshotted by the
 * composition root; it grants no model/tool/file capability. A missing binding
 * makes only fresh Session/execution selection fail as unsupported and never
 * changes the other platform ports.
 */
export type WorkflowHostConfiguration = {
  consumerId: string;
  bindings: readonly {
    workspace: WorkspaceScope;
    sessionRole: RoleConfigurationRef;
    roleBinding: RoleBindingRefV1;
    budget: TaskBudgetV1;
  }[];
};

/**
 * Slice 1 §2.8: trusted Host archive timing policy. It is pure startup data
 * snapshotted by the composition root; it is not a project settings table and
 * grants no capability. Values must be positive safe integers and
 * `maintenancePageSize` must be 1..100.
 */
export type SessionArchivePolicyV1 = {
  schemaVersion: 1;
  executorArchiveAfterMs: number;
  maintenancePageSize: number;
};

/** Slice 1 §2.8: the frozen default policy (one day; one page of 100). */
export const DEFAULT_SESSION_ARCHIVE_POLICY: SessionArchivePolicyV1 = {
  schemaVersion: 1, executorArchiveAfterMs: 86_400_000, maintenancePageSize: 100,
};

/**
 * Slice 1 §2.8/§3.3: the trusted Host/slice-3 duty resolution seam. It is not
 * model input and never stores a hot-swappable Session duty field. An absent or
 * `unknown` result only disables the one-day executor auto-archive; the retired
 * and copy rules still apply.
 */
export type SessionDutyResolver =
  (role: RoleConfigurationRef, ctx?: CoreCallContext) => Promise<ReadResult<PlatformDutyV1 | 'unknown'>>;

/**
 * One card a pending source holds over a Task (M's and R's reads): the Task it blocks and the formal card source.
 * The Workflow reads the card by that source through the existing `decisionReads` and blocks the Task and its
 * dependents until the card is applied, answered without application, or closed.
 */
export type PendingCardV1 = { task: TaskTriple; source: DecisionSourceV1 };

/** L1's two pending block sources: one Goal's cards whose owning operation/request is still waiting. */
export type PendingCardsPort = (ctx: CoreCallContext, input: { goalRef: GoalRef }) =>
  Promise<ReadResult<readonly PendingCardV1[]>>;

/** PL §3.4/§5.1.4: one pass of the Host's existing Goal-wait queue; not a Workflow dependency field. */
export type GoalWaitDrainPort = (scope: WorkspaceScope) => Promise<void>;

/**
 * The exact owners the Workflow composes. It reads and calls only these ports;
 * it owns no Store, no second database and no model loop. `sourceAuthority` is
 * the already-assembled exact Workspace revision reader used to build the real
 * claim pins.
 */
export type WorkflowDependencies = {
  tasks: GoalTaskPort;
  plans: PlanTaskPort;
  sessions: SessionDirectoryPort;
  claims: TaskClaimPort;
  executions: ExecutionReadPort;
  runtime: Pick<RuntimeExecutionPort,
    'createSession' | 'readCompletedBoundary' | 'prepareExecution' | 'startRun' | 'observeRun'
    | 'prepareQuery' | 'startQuery' | 'observeQuery' | 'closeOpenTurn' | 'countRunActivity'
    | 'countQueryActivity'
    | 'reviewCapability' | 'deliverControl' | 'readArchiveChangedFiles'>;
  evidence: EvidencePort;
  checks: RegisteredCheckRunner;
  repairs?: Pick<RepairActivationService, 'attemptRepairsForGoal'>;
  repairAnswers?: (ctx: CoreCallContext, input: { goalRef: GoalRef }) => Promise<RedriveAnswerV1[]>;
  sourceAuthority: SourceSnapshotReads;
  configuration?: WorkflowHostConfiguration;
  /**
   * Slice 1 §3.3: optional narrow owner/lifecycle/facts/duty seams. The real
   * composition installs all of them; an old narrow double without them leaves
   * only the new archive/maintenance entries unsupported and never changes the
   * existing `advanceWork` behavior.
   */
  sessionLifecycle?: SessionLifecyclePort;
  sessionFacts?: SessionFactsPort;
  responsibilities?: SessionResponsibilityPort;
  sessionAnomalies?: SessionAnomalyPort;
  controls?: RunControlPort;
  /**
   * PL §7.1.4/§7.5: the one deviation facts read the selection and the
   * `goal_cause/no_adviser` source share. The composition binds the SAME owner
   * both read, bound here to this advance's own call context (the card source
   * passes its own). Absent, the deviation arm selects nothing (an old narrow
   * double), never an empty deviation.
   */
  readDeviationFacts?: (ctx: CoreCallContext, goalRef: GoalRef, rows?: readonly TaskRow[]) =>
    Promise<ReadResult<DeviationInputV1>>;
  /** Binds the existing Host `resolveUnknownRun`; never a browser input (§3.3). */
  attestUnknownRun?: (
    ctx: CoreCallContext, request: GraphWrite<{ runRef: RunRef; reason: string }>,
  ) => Promise<WriteResult<RunSnapshot>>;
  /** Binds the existing Host `resolveUnknownQueryRun`; never a browser input. */
  attestUnknownQueryRun?: (
    ctx: CoreCallContext, request: GraphWrite<{ queryRunRef: QueryRunRef; reason: string }>,
  ) => Promise<WriteResult<QueryExecutionRecord>>;
  archivePolicy?: SessionArchivePolicyV1;
  sessionDuty?: SessionDutyResolver;
  /**
   * Slice 1 (L-g, S:597): every new time the Workflow archive/maintenance
   * supplies comes from this injected clock. Without injection the old
   * `new Date().toISOString()` fallback stays.
   */
  now?: () => string;
  /**
   * Slice 1 E2 (§4.2): the trusted terminal Task-time basis maintenance uses
   * for an old close event without `taskBasis.finishedAt`. Optional; without it
   * an unprovable close time is `incomplete` and the Session is not due.
   */
  responsibilityBasis?: SessionResponsibilityBasisPort;
  /**
   * Slice 1 §4.1 step 7: the trusted mailbox seam used to dispose an archive
   * wait (reply-handler transfer then wait cancel). Optional so old narrow
   * doubles stay type-compatible; without it an ordinary wait archive is
   * explicitly unsupported.
   */
  messages?: SessionMailboxPort;
  /** The internal goal-less request the completed-goal branch appends. */
  requestIntake?: Pick<RequestSubmitPort, 'submitInterventionGoal'>;
  /**
   * Book §3.8 item 3 (`book-7a.md:359–:391`): the release owner and the bounded candidate page. L publishes the one
   * object as `platform.messageRelease`. Optional: without it the release step selects nothing and every old
   * composition and fixture keeps its historical selection (`:383–:384`). 〔a-01〕 `applyMessageRelease` is not here:
   * the handed-over answer goes through the one kind chain and G's application row, not through this dependency.
   */
  messageRelease?: Pick<MessageReleasePort, 'releaseApproved'> & MessageReleaseCandidatesPort;
  /** §3.13 item 2: the one L46 upstream read. Absent keeps the block table to the Plan's own DAG edges, so every old
   *  composition and narrow double behaves as today (the legacy exact-artifact branch is the only one it feeds). */
  taskInputs?: TaskInputUpstreamPort;
  /** §3.14 item 2: P's copy forwarder, the one P port shape (`Promise<CoreRejection | null>`); a non-null result
   *  blocks the selection. Absent skips the trigger (the original no-trigger behavior). */
  copyForwarding?: (ctx: CoreCallContext, input: { goalRef: GoalRef }) =>
    Promise<CoreRejection | null>;
  /**
   * §3.15 items 2–4: the one mode decision and bounded collection for a consulted line. Optional so every old
   * composition and narrow double keeps today's boundary-only behavior; CS's composition injects it.
   */
  consultationFacts?: ConsultationFactsPort;
  /**
   * Slice 1 §4.2: the trusted close-event reader used to derive the executor
   * archive `finishedAt` from the terminal responsibility close. Optional; the
   * maintenance step reads the close event first and then the injected
   * `responsibilityBasis`, and an unprovable terminal time is `incomplete` -
   * it never falls back to the last `Run.endedAt`.
   */
  records?: WorkflowCloseEventReader;
  /**
   * Optional explicit-consultation consumer dependencies. They reuse the SAME
   * mailbox/Query/Project owners; without them `consumeConsultation` is
   * explicitly unsupported and every other Workflow behavior is unchanged.
   */
  consultations?: ConsultationConsumerDependencies;
  /**
   * Slice 5 §3.3/§4.5 decision seams. They reuse the SAME settings/message/read
   * owners the composition already builds; every one is optional so an old
   * composition keeps starting and the historical `select_work`/`perform`
   * behavior is unchanged. Without `goalSettings`/`decisionMessages` the new
   * `resolveDecision`/`orderGoalAdvances` surface reports `unsupported`.
   */
  goalSettings?: GoalSettingsPort;
  decisionMessages?: DecisionMessagePort;
  decisionReads?: DecisionReadPort;
  decisionDuties?: MessageDutiesFactsPort;
  goalExecutedFiles?: GoalExecutedFilesPort;
  /**
   * 4C-2 U6: optional per-source-kind decision application adapters. The
   * `note_review` adapter is installed by the composition; absent adapters (and
   * every non-goal_conflict kind) leave `resolveDecision` answering only.
   */
  decisionApplications?: Partial<Record<DecisionSourceV1['kind'], DecisionApplicationAdapter>>;
  /**
   * Slice 5 §4.5: read the formal identity/fingerprint of a settings commit at
   * its returned cursor, so the finite `resolveDecision` coordinator can hand
   * `recordDecisionApplication` the real receipt without knowing an owner-private
   * identity algorithm. Optional; without it an answered conflict stays
   * `application_not_recorded`.
   */
  applicationReceipt?: (ctx: CoreCallContext, cursor: CommitCursor) => Promise<DecisionApplicationReceiptV1 | null>;
  /**
   * Slice 2B L8/P12: the WorkGraph `RunActivity` owner the Workflow backfill
   * uses for its candidate scan and record write. Optional so every existing
   * composition and fixture keeps starting; without it the two backfill
   * operations stay explicitly unsupported.
   */
  runActivity?: RunActivityPort;
  /**
   * K3 (L7/L11/L12/L16, §3.4): the SAME UnknownCallReview owner the routes and
   * the Runtime publish. The Workflow reads the selected Run's record before
   * `automaticRequeue` (fail-closed on an unreadable key) and performs the
   * `settle_review` step through `settleReview`. Optional so every existing
   * narrow double keeps its historical selection; without it the UR gate is a
   * `pass` and the owner guards still decide.
   */
  unknownCallReviews?: UnknownCallReviewPort & UnknownCallReviewReadPort;
  /** P's chooser reads (`session-chooser.ts`); the composition supplies the activity, goal-Run and pre-claim
   *  authorization facts. Absent keeps today's order and no authorization filter. */
  pick?: PickReadsV1;
  /** N's module-overlap gate owner: the open/note steps and the gate read. */
  overlap?: OverlapGatePort;
  /** M's member request seam (the no-adviser `host_pick` step and its item-5 commit read). */
  members?: Pick<MemberRequestPortV1, 'requestMember' | 'readMemberRequestCommit'>;
  /** M's pending `member_creation` cards for the Task block source; the composition adapts
   *  `readPendingMemberCards` into this one shape. */
  pendingMemberCreations?: PendingCardsPort;
  /** R's pending `rework_request` cards for the Task block source. */
  pendingReworkRequests?: PendingCardsPort;
  /** H's pending `handoff_approval` cards for the Task block source: one per handed-over Task of this Goal. */
  pendingHandoffApprovals?: (ctx: CoreCallContext, input: { workspace: WorkspaceScope; goalRef: GoalRef }) =>
    Promise<ReadResult<readonly PendingCardV1[]>>;
  /**
   * PL §3.4/§5.2.5: the one two-argument system-round send. `input` is exactly
   * `systemRoundSendInput`'s parameter shape; `skipped` is the wrapper's own
   * already-committed receipt, not a new message state or a second path. L
   * binds it as `send(ctx, input) => sendSystemRound(ctx, { messages }, input)`.
   */
  send?: (ctx: CoreCallContext, input: Parameters<typeof systemRoundSendInput>[0]) =>
    Promise<SendMessageResultV1 | CoreRejection | { status: 'skipped'; reason: 'already_committed' }>;
  /**
   * PL §6.7.1's seven goal-loop narrow reads and the candidate-card read. Only
   * the types land in P1; the composition injects the real owners. Optional
   * only so every old narrow double stays type-compatible — at run time a
   * missing implementation is `unsupported`, never an empty result.
   * `checks` stays the existing `runRegisteredCheck` runner and is not one of
   * these fields.
   */
  latestAgentCandidate?: (goalRef: GoalRef) => Promise<ReadResult<PlanProposal | null>>;
  completedFixes?: (goalRef: GoalRef, basedOn: PlanRevisionRef | null) => Promise<ReadResult<number>>;
  planFixRead?: (goalRef: GoalRef, proposalRef: PlanProposalRef, revision: number) =>
    Promise<ReadResult<PlanFixReadV1>>;
  planChecks?: (scope: WorkspaceScope) => Promise<ReadResult<readonly CheckCapabilityV1[] | null>>;
  planCandidates?: (scope: WorkspaceScope, ctx: CoreCallContext, goalRef?: GoalRef) => Promise<ReadResult<{
    goals: readonly {
      goalRef: GoalRef;
      pending: { proposalRef: PlanProposalRef; basedOn: PlanRevisionRef | null } | null;
      questionGroups: readonly PlanningQuestionGroupV1[];
      readThrough: CommitCursor | null;
    }[];
  }>>;
  acceptedCandidatesOf?: (goalRef: GoalRef) => Promise<ReadResult<readonly PlanProposal[]>>;
  /** The taskbook probe: exactly `TaskbookExportReadPort['read']`, implemented by P6. */
  exportBooks?: TaskbookExportReadPort['read'];
  readCandidateCard?: (goalRef: GoalRef, proposalRef: PlanProposalRef) => Promise<ReadResult<{
    card: DecisionCardV1;
    diagnosis: readonly PlanDiagnosisFindingV1[] | null;
    exactReview: ReadResult<PlanReviewReadV1>;
    exportRead: TaskbookExportReadV1;
  }>>;
};

/**
 * The exact owners the explicit-consultation consumer composes. The mailbox
 * half is read-only except for the ONE Host-only `respondFromQueryAnswer`
 * association; the Query half is the accepted pending/claim/answer port.
 */
export type ConsultationConsumerDependencies = {
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody'>
    & Required<Pick<SessionMailboxPort, 'respondFromQueryAnswer' | 'recordConsultationDerivation'>>;
  queries: QueryJobPort;
  projects: ProjectRegistrationPort;
};

/**
 * `handleGoalInput` accepts the two narrow R5b.4 initial-planning inputs and
 * rejects an unknown kind as unsupported. `advanceWork` is the finite R5c.1
 * advancement entry; each `perform` calls at most one owner.
 */
export interface WorkflowPort {
  handleGoalInput(ctx: CoreCallContext, input: InitialPlanningGoalInput): Promise<InitialPlanningGoalInputResult>;
  advanceWork(ctx: CoreCallContext, input: WorkflowAdvanceInput, internal?: WorkflowAdvanceInternal): Promise<WorkflowAdvanceResult>;
  /**
   * Explicitly process ONE received message: reuse the saved deterministic
   * Query/Answer first, otherwise run the finite submit/claim/prepare/start
   * chain and attach the formal Answer to the original message. No polling,
   * scheduler or background loop; absence keeps every existing Workflow
   * behavior and the type-compatible fixtures.
   */
  consumeConsultation?(ctx: CoreCallContext, input: ConsultationInput): Promise<ConsultationResult>;
  /** One saved person's or agent's message delivered to the line's existing Task (slice-7-SPEC L11). */
  handleIntervention?(ctx: CoreCallContext, input: InterventionInput): Promise<HandleInterventionResultV1>;
  /** S's `DeliveryEligibilityFactsPort['readDeliveryEligibilityFacts']`: the one fact read L injects into the Query
   *  and Host gates; absent keeps old narrow doubles type-compatible. */
  readDeliveryEligibilityFacts?(ctx: CoreCallContext, input: { messageRef: SessionMessageRef }):
    Promise<ReadResult<DeliveryEligibilityFactsV1>>;
  /**
   * Slice 1 §4.1: the ONE Workflow archive composition entry. Optional so old
   * narrow doubles stay type-compatible; the real composition installs it. An
   * outer `ready` only means the composed result is readable, never archived.
   */
  archiveLine?: SessionArchivePort['archiveLine'];
  continueArchiveLine?: SessionArchivePort['continueArchiveLine'];
  /** Slice 1 §4.2: at most one bounded maintenance page per call. */
  maintainSessions?: SessionMaintenancePort['maintainSessions'];
  /**
   * Slice 6 of the orchestration design: the handoff/archive Workflow owner.
   * Optional so every old
   * narrow double stays type-compatible; the real composition publishes it.
   */
  sessionHandoff?: SessionHandoffWorkflowPort;
  /**
   * Slice 5 §4.5 finite decision coordination: `answerDecision` first, then the
   * structured conflict action (only for an active Goal's conflict card), then
   * `recordDecisionApplication`. Optional so every existing composition and
   * fixture keeps starting; `createWorkflow` implements it as a stub in part 1.
   */
  resolveDecision?(ctx: CoreCallContext, request: GraphWrite<ResolveDecisionInputV1>): Promise<ReadResult<ResolveDecisionReadV1>>;
  /**
   * Slice 5 §4.5 read-only ordering safe point: sorts the already-pending
   * advances by `Goal.settings.order`, then the Goal key, then flowId/taskId,
   * with no scheduler, queue or persisted Host state. Optional for old
   * compositions; `createWorkflow` implements it as a stub in part 1.
   */
  orderGoalAdvances?(ctx: CoreCallContext, input: { advances: WorkflowAdvanceInput[] }): Promise<ReadResult<{ advances: WorkflowAdvanceInput[] }>>;
  /**
   * Slice 2B L8/P12: the automatic Host-start batch over `[now − 14 days, now)`
   * and the human range batch behind `activity/backfill`. Optional for old
   * compositions; `createWorkflow` publishes them when the `runActivity` owner
   * is installed and answers `unsupported` otherwise.
   */
  backfillRecentActivity?(ctx: CoreCallContext, input: ActivityBackfillInput): Promise<ReadResult<ActivityBackfillBatchV1>>;
  backfillActivityRange?(ctx: CoreCallContext, input: ActivityBackfillRangeInput): Promise<ReadResult<ActivityBackfillBatchV1>>;
}

// The frozen entry. The planning branch runs one read-only Query on the line, so the input carries the same
// profile a consultation takes.
export type InterventionInput = {
  messageRef: SessionMessageRef;
  roleBinding: RoleBindingRefV1;
  runtimeBudget: RuntimeBudget;
  budget: QueryJobIntentV1['budget'];
  consumerId: string;
  /** Every ordinary pass is the planning arm; only the closing's second step carries `completion`. */
  completion?: undefined;
} | {
  messageRef: SessionMessageRef;
  /** The Host's second step of a closing: the notice is committed and the formal Answer is associated as the
   *  message's one reply. The association reads no execution profile, so the closing carries none. */
  completion: 'associate_answer';
  /** The closing associates the formal Answer as the original message's reply (§5.6). */
  replyToOriginal?: boolean;
};
/** The stage one handler call reached; the next call continues from the first missing fact. */
export type InterventionPlanningStage = 'query' | 'proposal' | 'adoption';
export type HandleInterventionResultV1 =
  | { status: 'claimed'; branch: 'existing_task' | 'no_task'; claim: TaskClaim }
  | { status: 'progressed'; branch: 'no_task'; stage: InterventionPlanningStage }
  | { status: 'awaiting_decision'; branch: 'no_task'; proposalRef: PlanProposalRef }
  /** The closing's reply step: `reason` names the one fixed Host notice (`questions` sends none) and the original
   *  formal Answer becomes the message's reply. */
  | { status: 'answer_ready'; branch: 'no_task'; answerRef: QueryJobAnswerRef;
    reason: 'answered' | 'invalid_plan' | 'questions' | 'candidate' | 'declined' | 'adopted' }
  /** The closing's withdraw step: the Query is formally ended without an Answer. */
  | { status: 'no_answer'; branch: 'no_task' }
  /** The association step of an `answer_ready` closing: the formal Answer is this message's reply. */
  | { status: 'responded'; branch: 'no_task'; answerRef: QueryJobAnswerRef }
  | { status: 'requested'; branch: 'goal_completed'; requestRef: QueryJobRef }
  | { status: 'queued'; reason: 'no_task' }
  | CoreRejection;
