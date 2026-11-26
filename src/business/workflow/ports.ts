import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import type { DecisionApplicationReceiptV1 } from '../../contracts/core/session-message.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../contracts/core/identity.js';
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
import type { CheckCapabilityV1, RegisteredCommandCheck, RoundSnapshot } from '../../contracts/verification.js';
import type { FailingCheckOutputV1 } from '../../contracts/check-output.js';
import type { NotifyProjectInputV1, ProjectNoticeV1 } from '../../contracts/role-lines.js';
import type { GoalTaskPort } from '../../core/work-graph/model/task-contracts.js';
import type { ActionRequestPort, ClaimHoldPort } from '../../core/work-graph/model/action-request-contracts.js';
import type { TaskRow } from '../../core/work-graph/model/plan-contracts.js';
import type {
  PlanProposal, PlanProposalRef, PlanServicePort, PlanTaskPort,
} from '../../core/work-graph/model/plan-contracts.js';
import type { GraphWrite } from '../../core/work-graph/model/task-contracts.js';
import type { AbandonedCandidateTailsV1, LatestAgentCandidateV1 } from '../../core/work-graph/tasks/plan-readers.js';
import type { CandidateChainEndDeps } from '../../core/work-graph/tasks/plan-lineage.js';
import type { RequestFactsPort } from '../../core/work-graph/tasks/request-facts.js';
import type { GoalOriginV1 } from '../../core/work-graph/tasks/goal-origin.js';
import type { StandardChangeFactsV1 } from '../../core/work-graph/views/decision-read-model.js';
import type { TaskInputUpstreamPort } from '../../core/work-graph/model/context-input-contracts.js';
import type { HoldBlockerV1 } from '../../core/work-graph/state/task-claim-hold.js';
import type { SessionDirectoryPort } from '../../core/work-graph/model/session-contracts.js';
import type {
  SessionFactsPort, SessionResponsibilityBasisPort,
} from '../../core/work-graph/model/session-facts-contracts.js';
import type { DeliveryEligibilityFactsV1 } from '../../core/work-graph/model/session-facts-contracts.js';
import type { SessionLifecyclePort } from '../../core/work-graph/sessions/lifecycle-contracts.js';
import type { SessionResponsibilityPort } from '../../core/work-graph/sessions/session-responsibility-service.js';
import type { SessionAnomalyPort } from '../../core/work-graph/tasks/session-anomaly-service.js';
import type { GoalAdviserQueuePort } from '../../core/work-graph/tasks/goal-adviser-queue-service.js';
import type { ResponsibilityRecipientPort } from '../../core/work-graph/tasks/responsibility-recipient.js';
import type { RunControlPort } from '../../core/work-graph/tasks/control-contracts.js';
import type { TaskClaimPort } from '../../core/work-graph/model/claim-contracts.js';
import type { TaskNodeCommitPort } from '../../core/work-graph/model/task-node-commit-contracts.js';
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
  GoalSettingsPort, MessageDutiesFactsPort, RequestCandidatePort, TaskClaimJudgmentV1,
} from '../../core/work-graph/model/decision-contracts.js';
import type { ProjectRegistrationPort } from '../../core/work-graph/configuration/project-bootstrap-contracts.js';
import type { QueryExecutionRecord, QueryJobPort } from '../../core/work-graph/queries/contracts.js';
import type { SessionArchivePort } from './session-archive.js';
import type { SessionHandoffWorkflowPort } from '../../core/work-graph/model/session-handoff-contracts.js';
import type { SessionMaintenancePort } from './session-maintenance.js';
import type { DecisionApplicationAdapter } from './decision-actions.js';
import type { RunActivityPort } from '../../core/work-graph/tasks/run-activity-service.js';
import type { RoleLineMaintenancePort } from '../../core/work-graph/sessions/role-line-maintenance.js';
import type { DeviationInputV1 } from '../../contracts/plan-deviation.js';
import type { RequestSubmitPort } from './request-intake.js';
import type { ActivityBackfillBatchV1, ActivityBackfillInput, ActivityBackfillRangeInput,
  ConsultationInput, ConsultationResult, InitialPlanningGoalInput, InitialPlanningGoalInputResult,
  RedriveAnswerV1, ResolveDecisionInputV1, ResolveDecisionReadV1, WorkflowAdvanceInput, WorkflowAdvanceInternal, WorkflowAdvanceResult, WorkflowCloseEventReader, WorkflowWaitsReadV1 } from './contracts.js';
import type { ConsultationFactsPort } from '../../core/work-graph/queries/platform-facts.js';
import type { MemberRequestPortV1 } from '../../core/work-graph/tasks/member-service.js';
import type { OverlapGatePort } from '../../core/work-graph/tasks/overlap-gates.js';
import type { PickReadsV1 } from './session-chooser.js';
import type { systemRoundSendInput } from './plan-round.js';
import type { CommandReviewDeps } from './command-review.js';
import type { InterventionClosingReasonV1 } from './intervention.js';
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
  /**
   * S1: the request-candidate head read the plan-turn entry replaces. Optional
   * so every old narrow double stays type-compatible; the real composition
   * installs it, and without it only `proposeFromPlanTurn` answers `unsupported`.
   */
  requestCandidates?: Pick<RequestCandidatePort, 'readRequestCandidate'>;
  /**
   * S1: the request's own round order, which the plan-turn entry compares with the head's source
   * round before it replaces the head. Optional like `requestCandidates`; the real composition
   * installs the same request-facts owner the Host and the Query preparation read.
   */
  requests?: Pick<RequestFactsPort, 'readRequest'>;
  /**
   * Node-level review (121-45): the `every_step` gate's read of pending nodes and live work. Optional so the old
   * narrow doubles stay type-compatible and select as before; the real composition always installs it.
   */
  nodeCommits?: Pick<TaskNodeCommitPort, 'readNodeRows'>;
  sessions: SessionDirectoryPort;
  claims: TaskClaimPort;
  executions: ExecutionReadPort;
  runtime: Pick<RuntimeExecutionPort,
    'createSession' | 'readCompletedBoundary' | 'prepareExecution' | 'startRun' | 'observeRun'
    | 'prepareQuery' | 'startQuery' | 'observeQuery' | 'closeOpenTurn' | 'countRunActivity'
    | 'countQueryActivity'
    | 'reviewCapability' | 'deliverControl' | 'readArchiveChangedFiles' | 'cancelQuery'>;
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
  /**
   * PL §7.1.1 `stop` 偏差的第五项：一轮里没过的登记检查的命令原文、出处和输出。组合根绑接续说明用的同一处读
   * （WorkGraph 的 `failingCheckOutputsOf`）。没接（旧的窄替身）就不加这一项，不是空结果。
   */
  readFailingCheckOutputs?: (round: RoundSnapshot) => Promise<FailingCheckOutputV1[]>;
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
  /** L33: the project's one adviser-allocation entry; a composition without it keeps the old no-adviser wait. */
  goalAdviserQueue?: Pick<GoalAdviserQueuePort, 'allocate'>;
  /** 7D2 O4b: the one L35 recipient read of the platform's adviser sends and where that line lives; absent keeps the old workspace duty read. */
  recipients?: ResponsibilityRecipientPort;
  /**
   * 121-112: the scribe's long-command review close-out (`applyCommandReview`): the person's notice and the Host's
   * "look again". Absent, a scribe review round's answer is not applied (`unsupported`).
   */
  commandReview?: CommandReviewDeps;
  /**
   * G8B B1：平台自动采用带新检查的计划时批检查要读写的两样：工作区已装的检查（组合根的 `readInstalledCheckList`）、
   * 主对话里的请知悉（项目通知的唯一写入）。没接上就照 G8A 交人。
   */
  checkApproval?: {
    installedChecks(scope: WorkspaceScope): Promise<ReadResult<readonly RegisteredCommandCheck[] | null>>;
    notifyProject(input: NotifyProjectInputV1): Promise<WriteResult<ProjectNoticeV1>>;
    /** lead 11-17 裁定 4：按身份读已写的请知悉（没有是 `null`）。 */
    readNotice(input: Pick<NotifyProjectInputV1, 'projectRef' | 'subject' | 'kind' | 'operation'>):
      Promise<ReadResult<ProjectNoticeV1 | null>>;
    /** lead 11-17 裁定 1：收尾按固定请求号查本轮自己的采用回执（Plan owner 的重放规则，只读）。 */
    lookupPlanChange: PlanServicePort['lookupPlanChange'];
  };
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
  /** §3.13 item 2: the one L46 upstream read. Absent keeps the block table to the Plan's own DAG edges, so every old
   *  composition and narrow double behaves as today (the legacy exact-artifact branch is the only one it feeds). */
  taskInputs?: TaskInputUpstreamPort;
  /** §3.14 item 2: P's copy forwarder, the one P port shape (`Promise<CoreRejection | null>`); a non-null result
   *  blocks the selection. Absent skips the trigger (the original no-trigger behavior). */
  copyForwarding?: (ctx: CoreCallContext, input: { goalRef: GoalRef }) =>
    Promise<CoreRejection | null>;
  /** Where a Goal came from (`tasks/goal-origin.ts`): the line Task choice hands the first plan's tasks to the line
   *  the person spoke on. Optional: a narrow double has no such fact and chooses as usual. */
  goalOrigin?: (ctx: CoreCallContext, goalRef: GoalRef) => Promise<ReadResult<GoalOriginV1 | null>>;
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
   * 7D2 O2: the adviser/scribe maintenance page (too long, too slow, the split) and the retained-cap reclaim it
   * extends. `maintainSessions` runs its one page after the Session page; absent, maintenance is unchanged.
   */
  roleLines?: RoleLineMaintenancePort;
  /**
   * K3 (L7/L11/L12/L16, §3.4): the SAME UnknownCallReview owner the routes and
   * the Runtime publish. The Workflow reads the selected Run's record before
   * `automaticRequeue` (fail-closed on an unreadable key) and performs the
   * `settle_review` step through `settleReview`. Optional so every existing
   * narrow double keeps its historical selection; without it the UR gate is a
   * `pass` and the owner guards still decide.
   */
  unknownCallReviews?: UnknownCallReviewPort & UnknownCallReviewReadPort;
  /**
   * 暂缓领取的读口（同一个暂缓 owner 的 `readHold`）：`requeue_task` 在门上先看书记原因，held 就等、不写（2.6）。
   * `readEffectiveClaimBlocker` 是 claim-service 的同一个只读组合（读记录 + 领取 owner 的失效判断 + 卡位），
   * 目标循环在首领、接续和返工的领取前用它；两个都可选，没接时门和目标循环照旧跳过暂缓判断。
   */
  claimHolds?: Pick<ClaimHoldPort, 'readHold' | 'placeScribeStop' | 'release'> & {
    readEffectiveClaimBlocker?: (ctx: CoreCallContext, input: { taskRef: TaskTriple }) =>
      Promise<{ status: 'ready'; blocker: HoldBlockerV1 | null } | CoreRejection>;
  };
  /**
   * 派活请求 owner 的两个口（2.5）：目标循环每次选择读一次本目标的派活请求（`open` 和待批 `pending`，按受理先后），
   * 只把 `open` 点名的任务排在候选最前（每个候选照旧走同一段判断）；任务已不可服务时用全部记录找 `pending`/`open`
   * 的请求，用 `settle` 记 `void`。可选：没接时按今天的顺序、没有可选请求。
   */
  actionRequests?: Pick<ActionRequestPort, 'listOpenDispatches' | 'settle'>;
  /** P's chooser reads (`session-chooser.ts`); the composition supplies the activity, goal-Run and pre-claim
   *  authorization facts. Absent keeps today's order and no authorization filter. */
  pick?: PickReadsV1;
  /** N's module-overlap gate owner: the open/note steps and the gate read. */
  overlap?: OverlapGatePort;
  /** M's member request seam (the no-adviser `host_pick` step, its item-5 commit read, and the read of the member
   *  requests a suggestion's round made before the loop asks the person itself). */
  members?: Pick<MemberRequestPortV1, 'requestMember' | 'readMemberRequestCommit' | 'readRoundMemberRequests'>;
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
  latestAgentCandidate?: (goalRef: GoalRef) => Promise<ReadResult<LatestAgentCandidateV1>>;
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
  /** A12: the Goal's trusted candidate successor relation (plan readers); absent follows formal replacements only. */
  candidateSuccessorsOf?: CandidateChainEndDeps['successors'];
  /** A12: the Goal's abandoned chain tails, whose open M the Goal loop replies with the tail's Answer; absent skips. */
  abandonedCandidateTailsOf?: (goalRef: GoalRef) => Promise<ReadResult<AbandonedCandidateTailsV1>>;
  /** The taskbook probe: exactly `TaskbookExportReadPort['read']`, implemented by P6. */
  exportBooks?: TaskbookExportReadPort['read'];
  readCandidateCard?: (goalRef: GoalRef, proposalRef: PlanProposalRef) => Promise<ReadResult<{
    card: DecisionCardV1;
    diagnosis: readonly PlanDiagnosisFindingV1[] | null;
    exactReview: ReadResult<PlanReviewReadV1>;
    exportRead: TaskbookExportReadV1;
    /** G8B B5：候选降低或改变关口标准的读（三种，见 `CandidateCardFactsV1.standardChange`）。 */
    standardChange: ReadResult<StandardChangeFactsV1 | null>;
  }>>;
};

/**
 * The exact owners the explicit-consultation consumer composes. The mailbox
 * half is read-only except for the ONE Host-only `respondFromQueryAnswer`
 * association; the Query half is the accepted pending/claim/answer port.
 */
export type ConsultationConsumerDependencies = {
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody' | 'readHostSendMessageRef'>
    & Required<Pick<SessionMailboxPort, 'respondFromQueryAnswer' | 'recordConsultationDerivation'>>;
  queries: QueryJobPort;
  projects: ProjectRegistrationPort;
};

/**
 * `handleGoalInput` accepts the two narrow R5b.4 initial-planning inputs and
 * rejects an unknown kind as unsupported. `advanceWork` is the finite R5c.1
 * advancement entry; each `perform` calls at most one owner.
 */
/** The person's public `queries/ask` input: the line head, the question and the idempotency id. */
export type LineAskInputV1 = {
  sessionRef: SessionRef;
  question: string;
  commandId: string;
};

/** The Host binding fills the read-only Query profile after reading the line, then hands this command to the Workflow. */
export type LineAskCommandV1 = LineAskInputV1 & {
  roleBinding: RoleBindingRefV1;
  runtimeBudget: RuntimeBudget;
  budget: QueryJobIntentV1['budget'];
  consumerId: string;
};

/** `round` is the deterministic Query of the saved message even while the consumer still waits for its answer. */
export type LineAskResultV1 =
  | { status: 'queued'; round: QueryJobRef }
  | CoreRejection;

/** The facts of one ended request round that may write this request's plan candidate. */
export type PlanTurnFactsV1 = {
  /** The ended round. */
  ref: QueryJobRef;
  /** The round's last formal answer. */
  answerRef: QueryJobAnswerRef;
  /** The request this round belongs to. */
  requestRoot: QueryJobRef;
  /** The Goal id (not the full GoalRef). */
  goalId: string;
  /**
   * A call input, never stored: the start-up reconcile's step 6c only writes a missing candidate. Adopting a small
   * change, asking for its check approval and running its checks stay for the normal driver's next pass (FLK rework
   * ruling 2).
   */
  candidateOnly?: true;
};

/**
 * The one outcome table of the plan-turn entry: `done` wrote (or replayed) the
 * candidate; `skipped` did not write and a non-transient skip is final;
 * `failed` names a real failure the next lifecycle pass may retry.
 */
export type PlanRoundEndResultV1 =
  | { status: 'done' }
  | { status: 'skipped'; reason: string; transient: boolean }
  | { status: 'failed'; reason: string; transient: boolean };

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
  /** The person's `queries/ask`: save one inquiry, then run the same 7B consultation consumer; the profile fields are the Host binding's. */
  askLine?(ctx: CoreCallContext, input: LineAskCommandV1): Promise<LineAskResultV1>;
  /** One saved person's or agent's message delivered to the line's existing Task (slice-7-SPEC L11). */
  handleIntervention?(ctx: CoreCallContext, input: InterventionInput): Promise<HandleInterventionResultV1>;
  /**
   * S1: one ended plan-turn request round becomes this request's candidate. The
   * Host calls it from its own round-end table; the entry reads the saved answer
   * facts and reuses `plans.proposePlan`. Optional so old narrow doubles stay
   * type-compatible; the real composition publishes it.
   */
  proposeFromPlanTurn?(ctx: CoreCallContext, turn: PlanTurnFactsV1): Promise<PlanRoundEndResultV1>;
  /** S's `DeliveryEligibilityFactsPort['readDeliveryEligibilityFacts']`: the one fact read L injects into the Query
   *  and Host gates; absent keeps old narrow doubles type-compatible. */
  readDeliveryEligibilityFacts?(ctx: CoreCallContext, input: { messageRef: SessionMessageRef }):
    Promise<ReadResult<DeliveryEligibilityFactsV1>>;
  /** F06/§2.8: the target loop's one claim judgment (module gate, node occupancy, line busy, claimable) for the
   *  action card and the task detail. Optional so a composition without the target loop keeps `not_read`. */
  readTaskClaimability?(ctx: CoreCallContext, input: { goalRef: GoalRef; task: TaskTriple }):
    Promise<ReadResult<TaskClaimJudgmentV1>>;
  /** D101-3: the L46 wait read — every blocked Task of one Goal with its exact reason, plus the Goal-wide
   *  all-blocked reason and merged basis. Read-only: it never writes a record or opens a Kernel turn. */
  readGoalWaits?(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<WorkflowWaitsReadV1>>;
  /** The one fixed closing notice of a finished round, read by the notice writer's own source-and-part identity;
   *  absent keeps the consumable view's older classification. `reason` narrows the proof to one closing reason (the
   *  formal `no_answer` conclusion); absent proves any reason. */
  closingNotice?(ctx: CoreCallContext, input: {
    sourceMessageRef: SessionMessageRef; part: 'message' | 'decision_answer';
    reason?: InterventionClosingReasonV1;
  }): Promise<ReadResult<boolean>>;
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
  /**
   * An answered agent `ask_person` card's wake names its own frozen source part. It is only a routing fact: the
   * handler re-checks the stored card and takes the card sender's line; every ordinary pass omits it.
   */
  part?: 'decision_answer';
  /** Every ordinary pass is the planning arm; only the closing's second step carries `completion`. */
  completion?: undefined;
} | {
  messageRef: SessionMessageRef;
  /** The Host's second step of a closing: the notice is committed and the formal Answer is associated as the
   *  message's one reply. The association reads no execution profile, so the closing carries none. */
  completion: 'associate_answer';
  /** Which reply slot this step fills: `both` (the ordinary close-out, the default), `source` (only R, the delayed
   *  executor close-out) or `original` (only the executor's original wait M, the adopted/abandoned recovery). */
  replySlot?: 'both' | 'source' | 'original';
} | {
  messageRef: SessionMessageRef;
  /** §2.4: the Host's close-out of a round that already ended, chosen before any execution profile. It settles only
   *  the existing Query by its frozen source part and saved shape (the owed candidate or formal conclusion
   *  included) and returns the closing result; it never opens a new round, claims, adopts or requests a new Goal. */
  completion: 'settle_existing';
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
    reason: 'answered' | 'invalid_plan' | 'questions' | 'candidate' | 'declined' | 'adopted';
    /** A12: `source` when the chain's tail is another round, whose Answer replies M; this closing writes only R. */
    replySlot?: 'source' }
  /** The closing's withdraw step: the Query is formally ended without an Answer. `notStarted` (P6I) is the close
   *  message when the Host ended it on purpose before it entered, so the person is told it never started. */
  | { status: 'no_answer'; branch: 'no_task'; notStarted?: string }
  /** The association step of an `answer_ready` closing: the formal Answer is this message's reply. */
  | { status: 'responded'; branch: 'no_task'; answerRef: QueryJobAnswerRef }
  | { status: 'requested'; branch: 'goal_completed'; requestRef: QueryJobRef }
  | { status: 'queued'; reason: 'no_task' }
  | CoreRejection;
