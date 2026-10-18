import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import type { DecisionApplicationReceiptV1 } from '../../contracts/core/session-message.js';
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../contracts/core/results.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskBudgetV1 } from '../../contracts/dispatch.js';
import type { DecisionSourceV1 } from '../../contracts/goal-decisions.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { PlatformDutyV1 } from '../../contracts/platform-duty.js';
import type { GoalTaskPort } from '../../core/work-graph/model/task-contracts.js';
import type { PlanTaskPort } from '../../core/work-graph/model/plan-contracts.js';
import type { GraphWrite, SessionDirectoryPort } from '../../core/work-graph/model/session-contracts.js';
import type {
  LegacySessionProvenancePort, SessionFactsPort, SessionResponsibilityBasisPort,
} from '../../core/work-graph/model/session-facts-contracts.js';
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
import type { SessionMailboxPort } from '../../core/work-graph/model/communication-contracts.js';
import type {
  DecisionMessagePort, DecisionReadPort, DecisionSourceFactsPort, GoalExecutedFilesPort,
  GoalSettingsPort, MessageDutiesFactsPort,
} from '../../core/work-graph/model/decision-contracts.js';
import type { ProjectRegistrationPort } from '../../core/work-graph/configuration/project-bootstrap-contracts.js';
import type { QueryExecutionRecord, QueryJobPort } from '../../core/work-graph/queries/contracts.js';
import type { SessionArchivePort } from './session-archive.js';
import type { SessionMaintenancePort } from './session-maintenance.js';
import type { DecisionApplicationAdapter } from './decision-actions.js';
import type { RunActivityPort } from '../../core/work-graph/tasks/run-activity-service.js';
import type { ActivityBackfillBatchV1, ActivityBackfillInput, ActivityBackfillRangeInput,
  ConsultationInput, ConsultationResult, InitialPlanningGoalInput, InitialPlanningGoalInputResult,
  N0GoalInput, ResolveDecisionInputV1, ResolveDecisionReadV1, WorkflowAdvanceInput, WorkflowAdvanceInternal, WorkflowAdvanceResult, WorkflowCloseEventReader } from './contracts.js';

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
  runtime: RuntimeExecutionPort;
  evidence: EvidencePort;
  checks: RegisteredCheckRunner;
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
   * Slice 1 E14 (§2.2): the SAME legacy-provenance reader the Session directory
   * uses; maintenance derives and backfills provenance-null Sessions of the
   * current page. Optional; without it no legacy evidence is resolved.
   */
  legacyProvenance?: LegacySessionProvenancePort;
  /**
   * Slice 1 §4.1 step 7: the trusted mailbox seam used to dispose an archive
   * wait (reply-handler transfer then wait cancel). Optional so old narrow
   * doubles stay type-compatible; without it an ordinary wait archive is
   * explicitly unsupported.
   */
  messages?: SessionMailboxPort;
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
  decisionSources?: DecisionSourceFactsPort;
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
 * `handleGoalInput` keeps its N0 shape/unsupported behaviour and adds the two
 * narrow R5b.4 initial-planning inputs. `advanceWork` is the finite R5c.1
 * advancement entry; each `perform` calls at most one owner.
 */
export interface WorkflowPort {
  handleGoalInput(ctx: CoreCallContext, input: N0GoalInput | InitialPlanningGoalInput): Promise<InitialPlanningGoalInputResult>;
  advanceWork(ctx: CoreCallContext, input: WorkflowAdvanceInput, internal?: WorkflowAdvanceInternal): Promise<WorkflowAdvanceResult>;
  /**
   * Explicitly process ONE received message: reuse the saved deterministic
   * Query/Answer first, otherwise run the finite submit/claim/prepare/start
   * chain and attach the formal Answer to the original message. No polling,
   * scheduler or background loop; absence keeps every existing Workflow
   * behavior and the type-compatible fixtures.
   */
  consumeConsultation?(ctx: CoreCallContext, input: ConsultationInput): Promise<ConsultationResult>;
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
