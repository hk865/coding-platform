/**
 * Slice 5 WorkGraph model ports, dependency seams and read DTOs
 * (spec §2.6, §2.8, §3.3, §4.1, §4.2, §4.5).
 *
 * This file declares only the narrow contracts the owners and the read model
 * share; the implementations live in their owner modules.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { ArtifactRef } from '../../../contracts/artifact.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import { renderTemplate } from '../../../contracts/prompts/render-template.js';
import type { PromptTextsV1 } from '../../../contracts/prompts/prompt-set.js';
import type { RegisteredCommandCheck } from '../../../contracts/verification.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type {
  DecisionApplicationReceiptV1,
  DecisionApplicationV1,
  DecisionHostSenderV1,
  SessionMessageRef,
  UserMessageResponseV1,
} from '../../../contracts/core/session-message.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1, TaskTriple } from '../../../contracts/dispatch.js';
import type { ActionRequestBlockerV1, NodeActionRequestV1, TaskClaimTargetBlockerV1 } from '../../../contracts/work-line.js';
import type {
  DecisionActionV1,
  DecisionAnnotationV1,
  DecisionChangeProofV1,
  DecisionObjectV1,
  DecisionOptionV1,
  DecisionSelectionV1,
  DecisionSourceV1,
  DecisionSubjectV1,
  GoalAutonomyV1,
  GoalFootprintV1,
  GoalSettingsV1,
  NoticeCategoryV1,
  NoticePositionV1,
  UserDecisionBodyV1,
} from '../../../contracts/goal-decisions.js';
import type { DispatchBasisV1, GoalRef, GoalSnapshot, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { NoteKind } from '../../../contracts/note.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import type { TaskRequeueRef } from '../../../contracts/task-requeue.js';
import type { VerificationRoundRef } from '../../../contracts/verification.js';
import type { ToolCommitLookup } from '../../../contracts/unknown-call-review.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type {
  CommitCursorBinding, EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, RecordGuard, UniqueClaimChange,
} from '../../record-store/ports.js';
import type { MessageQueryAnswerSender, MessageSender, SessionMailboxPort, SessionMessage,
  SessionMessageEventV1 } from './communication-contracts.js';
import type { MaterialPort } from './material-contracts.js';
import type { NoteDecisionApplicationInputV1, NoteDispositionResult } from './note-contracts.js';
import type { PlanProposal, PlanProposalRef, RequestCandidateImpactV1 } from './plan-contracts.js';
import type { GraphWrite } from './task-contracts.js';
import type {
  MessageAppliedChangeV1, MessageExpiredChangeV1, MessageGuardContext, MessageWithdrawnChangeV1, SessionMessageChange,
} from '../state/message-machine.js';
import type { ActionRequestDecisionVerdictV1 } from '../state/action-request.js';

// ------------------------------------------------------------------------ //
// First-slice seams (spec §2.6)                                             //
// ------------------------------------------------------------------------ //

export interface GoalExecutedFilesPort {
  readGoalExecutedFiles(ctx: CoreCallContext, input: {
    goalRef: GoalRef; atLeastCursor?: CommitCursor;
  }): Promise<ReadResult<{
    availability: 'available' | 'not_available';
    files: { runRef: RunRef; path: string; certainty: 'definite' | 'possible' }[];
    possiblyIncomplete: boolean;
    guards: readonly RecordGuard[];
    sourceCursor: CommitCursor | null;
  }>>;
}

/** DESIGN §1.2 (decision 121-10): one Goal's conflict footprint (planned and executed), the conflict read's own
 *  `readGoalFootprint`; the conflict card's source check reads it so the card and its answer see one footprint. */
export interface GoalFootprintReadPort {
  readGoalFootprint(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<GoalFootprintV1>>;
}

export interface MessageDutiesFactsPort {
  readMessageDutiesFacts(ctx: CoreCallContext, input: {
    sessionRef: SessionRef; roleBinding: RoleBindingRefV1;
  }): Promise<ReadResult<{
    duties: PlatformDutyV1[]; readOnlyCopy: boolean; independentReview: boolean;
    guards: readonly RecordGuard[];
  }>>;
}

export interface CandidateRequestFactsPort {
  readCandidateRequestFacts(ctx: CoreCallContext, input: {
    requestRef: QueryJobRef; goalRef: GoalRef;
    /** Abandonment only (lead 11-27): a withdrawn source message still names the Query's source. Withdrawal
     *  changes whether the source is still there, not that it was this request's source. */
    withdrawnSourceCounts?: boolean;
  }): Promise<ReadResult<{
    root: boolean; initiatedByOperator: boolean;
    currentSecretary: SessionRef | null; guards: readonly RecordGuard[];
    /** The narrow branch's proof: the admitted `intervention_planning` Query's source message, or null. */
    interventionSource: SessionMessageRef | null;
    /** The part frozen on that Query's source (`decision_answer` only for a card-answer round). */
    interventionSourcePart?: 'decision_answer';
  }>>;
}

// ------------------------------------------------------------------------ //
// Notice display token and position comparison (spec §2.8)                  //
// ------------------------------------------------------------------------ //

/**
 * wire = base64url(UTF8(canonicalJson(payload))) + '.' + lowercase HMAC-SHA256 hex.
 *
 * `issuer` names the read that issued the token: the decision queue (`queue`)
 * or the main conversation's read (`main`). A Goal-filtered queue page computes
 * its `seenThrough` over that Goal's notices only, so it may pass a notice of
 * another Goal it never showed; the main read computes it over the workspace's
 * full member set and never does (slice-6-SPEC L6). `markNoticesSeen` reads it.
 */
export type NoticeDisplayTokenPayloadV1 = {
  schemaVersion: 1; workspace: WorkspaceScope; operator: ActorRef;
  issuer: 'queue' | 'main';
  goalRef: GoalRef | null; categories: NoticeCategoryV1[];
  sourceCursor: CommitCursor; queryCursor: string | null;
  returnedKeys: string[];
  seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
};

export interface NoticeDisplayTokenPort {
  issue(payload: NoticeDisplayTokenPayloadV1): string;
  verify(token: string): NoticeDisplayTokenPayloadV1 | null;
}

export interface NoticePositionComparatorPort {
  compare(a: NoticePositionV1, b: NoticePositionV1): -1 | 0 | 1;
}

/** The derived read fact of one formal Goal decision cause, never a new GoalPhase schema. */
export type GoalDecisionCauseReadV1 = {
  source: DecisionSourceV1;
  code: string; taskRef: TaskTriple | null; runRef: RunRef | null;
  /** The cause's own stored time: the selected failure Run's `endedAt`, or the restart cause's `detectedAt`; null when the cause stores none. */
  openedAt: string | null;
  action: DecisionActionV1 | null;
  objects: DecisionObjectV1[]; options: DecisionOptionV1[];
  /** R2：只在 no_new_basis / auto_rework_cap_reached 原因上，且这一轮没过的都是别的目标或初始化装的项目检查：这些检查的 id。 */
  withdrawableChecks?: readonly string[];
};

// ------------------------------------------------------------------------ //
// Owner dependencies and the write facade (spec §3.3)                       //
// ------------------------------------------------------------------------ //

export type S5RecordPort = GoalRecordTransactionPort & RecordLookupPort;

/**
 * 2A L11/P1: one queue window attempt's shared source cache. The read model
 * creates one per attempt and passes it to every source; a source assembles its
 * whole collection once per attempt and serves its pages from it. The object is
 * dropped with the attempt, so nothing is cached across calls.
 */
export type DecisionSourceAttempt = { readonly cache: Map<string, unknown> };
/**
 * R-窗 (ruling 9): the reason a card source answers (code `source_stale`) when a record it checks inside the queue
 * window moved since its `prepareWindow` read the knowledge files; the queue retries the window.
 */
export const DECISION_WINDOW_MOVED_REASON = 'decision_window_moved';

export type DecisionOwnerBaseDependencies = {
  records: S5RecordPort; now: () => string; newId: () => string;
  operatorActor?: Extract<ActorRef, { kind: 'human' | 'system' }>;
};

export type GoalSettingsServiceDependencies = DecisionOwnerBaseDependencies;

export type WorkspaceDecisionSettingsDependencies = DecisionOwnerBaseDependencies & {
  displayTokens: NoticeDisplayTokenPort;
  positions: NoticePositionComparatorPort;
};

export type DecisionMessageServiceDependencies = DecisionOwnerBaseDependencies & {
  messages: SessionMailboxPort;
  materials: Pick<MaterialPort, 'openArtifact'>;
  messageWrites: MessageWriteOwnerPort; // 原 mailbox 私有写/body helper 的具名共享门面
  sources: DecisionSourceFactsPort;
};

export interface MessageWriteOwnerPort {
  storeBody(ctx: CoreCallContext, input: {
    messageRef: SessionMessageRef; part: 'message' | 'response';
    sender: MessageSender | MessageQueryAnswerSender | DecisionHostSenderV1;
    text: string;
  }): Promise<ReadResult<{ bodyRef: ArtifactRef; sourceRef: SourceRefV1 }>>;
  persist(ctx: CoreCallContext, request: GraphWrite<{
    before: SessionMessage | null; next: SessionMessage;
    event: SessionMessageEventV1;
    guards: readonly RecordGuard[];
    claims: readonly UniqueClaimChange[];
  }> & { identityKey: string; fingerprint: string }): Promise<WriteResult<SessionMessage>>;
}

export type SessionMessageCommitCompanions = {
  records: readonly EncodedRecord[];
  events: readonly EncodedDomainEvent[];
  guards: readonly RecordGuard[];
  claims: readonly UniqueClaimChange[];
  commitCursorBindings?: readonly CommitCursorBinding[];
  ledgerHorizon?: CommitCursor | null;
};

/** The event envelope the facade cannot invent: the command carries it. */
export type SessionMessageWriteEnvelopeV1 = {
  messageRef: SessionMessageRef;
  /** The record this call read; its `revision` is the accepted CAS version. */
  before: SessionMessage;
  expectedRevision: number;
  event: {
    eventId: string; occurredAt: string; requestId: string;
    projectId: string; workspaceId: string; actor: MessageSender;
  };
};

export type SessionMessageWriteCommandV1 =
  | (SessionMessageWriteEnvelopeV1 & { operation: 'message.withdraw'; change: MessageWithdrawnChangeV1 })
  | (SessionMessageWriteEnvelopeV1 & { operation: 'message.apply'; change: MessageAppliedChangeV1 })
  | (SessionMessageWriteEnvelopeV1 & { operation: 'message.recordExpiry'; change: MessageExpiredChangeV1 })
  | (SessionMessageWriteEnvelopeV1 & {
      operation: 'message.inputAccepted';
      /** The machine's own `input_accepted` change (`message-machine.ts:1726`). */
      change: Extract<SessionMessageChange, { kind: 'input_accepted' }>;
      /** The real execution facts `judge` needs; the machine refuses empty facts (`message-machine.ts:952`). */
      inputAccepted: NonNullable<MessageGuardContext['inputAccepted']>;
    });

/** The fragment's shape, declared in model so the port never imports persistence. */
export type SessionMessageCommitFragment = {
  records: readonly EncodedRecord[];
  events: readonly EncodedDomainEvent[];
  guards: readonly RecordGuard[];
  claims: readonly UniqueClaimChange[];
  commitCursorBindings?: readonly CommitCursorBinding[];
  ledgerHorizon?: CommitCursor | null;
};

export interface MessageCommandWritePort extends MessageWriteOwnerPort {
  prepare(ctx: CoreCallContext, command: SessionMessageWriteCommandV1,
    companions: SessionMessageCommitCompanions): Promise<SessionMessageCommitFragment | CoreRejection>;
  /** The old path widened; `companions` is optional so `decision-service.ts` keeps compiling. */
  persist(ctx: CoreCallContext, request: GraphWrite<{
    before: SessionMessage | null; next: SessionMessage; event: SessionMessageEventV1;
    guards: readonly RecordGuard[]; claims: readonly UniqueClaimChange[];
    companions?: SessionMessageCommitCompanions;
    commitCursorBindings?: readonly CommitCursorBinding[];
    ledgerHorizon?: CommitCursor | null;
  }> & { identityKey: string; fingerprint: string }): Promise<WriteResult<SessionMessage>>;
}

export interface DecisionSourceFactsPort {
  readSource(ctx: CoreCallContext, source: DecisionSourceV1):
    Promise<ReadResult<{ source: DecisionSourceV1; goal: GoalSnapshot | null;
      objects: DecisionObjectV1[]; options: DecisionOptionV1[];
      guards: readonly RecordGuard[]; closed: boolean;
      allowedReaderSessionRefs: SessionRef[] }>>;
  readApplication(ctx: CoreCallContext, input: {
    answer: SessionMessage; receipt: DecisionApplicationReceiptV1;
  }): Promise<ReadResult<DecisionApplicationV1>>;
}

// ------------------------------------------------------------------------ //
// Note-card decision port (spec §2; lead ruling: port in the model)         //
// ------------------------------------------------------------------------ //
//
// The notes owner implements this port; communication may consume it but must
// never import `notes/`. §2's `NoteDecisionCardV1` cannot carry the card's
// pins/objects/options, so `NoteDecisionCardFactsV1` augments it (see report:
// UNSPECIFIED).

export type NoteDecisionCardV1 = { cardId: string; source: 'note_review'; noteId: string; version: number; kind: NoteKind;
  optionIds: ('accept' | 'reject' | 'supersede' | 'coexist')[]; summary: string;
  pointer: { noteId: string | null; revision: number | null } | null };
export type NoteDecisionCardFactsV1 = NoteDecisionCardV1 & {
  /**
   * The note head's own goal. A goal-less note is the project's card, so the
   * null member is a real card too; the reader's subject check decides which
   * subject may answer it.
   */
  goalId: string | null;
  /** The note facts already read the head; carry its time to the card. */
  openedAt: string;
  pins: VersionPin[]; objects: DecisionObjectV1[]; options: DecisionOptionV1[] };
export type NoteDecisionClosedReasonV1 = 'goal_cancelled' | 'source_resolved';
export interface NoteDecisionSourcePort {
  /**
   * R-窗 (ruling 9): before the queue fixes its window, the pending notes of these Goals (a cancelled one shows no
   * card and is skipped) and, with `project`, of the project, and their targets, are overlaid with their files into
   * `attempt`.
   */
  prepareNoteDecisions(ctx: CoreCallContext, input: { goals: readonly GoalSnapshot[]; project: boolean;
    attempt: DecisionSourceAttempt }): Promise<ReadResult<void>>;
  readNoteDecisions(ctx: CoreCallContext, input: { subject: DecisionSubjectV1; attempt?: DecisionSourceAttempt }):
    Promise<ReadResult<NoteDecisionCardFactsV1[]>>;
  /**
   * One pinned note. `subject` is the pinned head's own subject (its Goal, or the project for a goal-less head)
   * whenever the head is still pending at the pinned version, with an open card and with a closed reason alike;
   * it is `null` only with the stale signal (`card` and `closedReason` both null). A reader checks it against the
   * requested subject before it looks at the card or the closed reason.
   */
  readNoteDecision(ctx: CoreCallContext, input: { pin: { noteId: string; version: number } }):
    Promise<ReadResult<{ card: NoteDecisionCardFactsV1 | null; closedReason: NoteDecisionClosedReasonV1 | null;
      subject: DecisionSubjectV1 | null; openedAt: string | null }>>;
  applyNoteDecision(ctx: CoreCallContext, input: NoteDecisionApplicationInputV1): Promise<NoteDispositionResult>;
}

// ------------------------------------------------------------------------ //
// Owner ports (spec §3.3, §4.1)                                             //
// ------------------------------------------------------------------------ //

export interface GoalSettingsPort {
  readGoalSettings(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<{ goal: GoalSnapshot; settings: GoalSettingsV1 }>>;
  setGoalSettings(ctx: CoreCallContext, request: GraphWrite<{
    goalRef: GoalRef; autonomy: GoalAutonomyV1; waitForGoalRef: GoalRef | null;
  }>): Promise<WriteResult<GoalSnapshot>>;
  reorderGoals(ctx: CoreCallContext, request: GraphWrite<{
    workspace: WorkspaceScope; goalOrder: GoalRef[];
    decisionMessageRef?: SessionMessageRef;
  }>): Promise<WriteResult<{ goals: GoalSnapshot[] }>>;
  resolveGoalConflict(ctx: CoreCallContext, request: GraphWrite<{
    source: DecisionSourceV1;
    selection: Extract<DecisionSelectionV1,
      { kind: 'conflict_wait' | 'conflict_order' | 'conflict_parallel' }>;
    decisionMessageRef: SessionMessageRef;
  }>): Promise<WriteResult<{ goals: GoalSnapshot[] }>>;
}

// Five values of `GoalDisplayPhase`; `null` means the row needs `goals/display`.
export type GoalListPhaseV1 = 'PLANNING' | 'PAUSED' | 'CANCELLED' | 'COMPLETED' | 'ACCEPTED_PARTIAL';

/** One `goals/list` row: the narrow settings/display facts, not a second Goal snapshot. */
export type GoalListRowV1 = {
  ref: GoalRef; revision: number; since: CommitCursor;
  /** "目标 n" in the project's creation order; null when that read is incomplete. */
  ordinal: number | null;
  objective: string; desiredState: GoalSnapshot['desiredState']; desiredStateRevision: number;
  order: number; autonomy: GoalSettingsV1['autonomy']; waitForGoalRef: GoalRef | null;
  activePlanRevision: PlanRevisionRef | null;
  display: { phase: GoalListPhaseV1 | null };
  /**
   * The COMPLETED Goal this Goal's work was added after: a person spoke new work on that Goal's line and this Goal was
   * confirmed from the request (`tasks/goal-origin.ts`); null for every other Goal. The completed Goal's own "added
   * after" side is the same list read the other way.
   */
  followsCompletedGoal: GoalRef | null;
};

/** The whole workspace's Goals in one stable window; no page cursor. */
export type GoalListReadV1 = { goals: GoalListRowV1[]; sourceCursor: CommitCursor | null };

export interface GoalListReadPort {
  readGoalList(ctx: CoreCallContext, input: { workspace: WorkspaceScope }): Promise<ReadResult<GoalListReadV1>>;
}

export interface DecisionMessagePort {
  sendUserMessage(ctx: CoreCallContext, request: GraphWrite<{
    goalRef: GoalRef; intent: 'notify' | 'decision_request'; text: string;
    needsReply: boolean; waitAfterSend: boolean;
    options: DecisionOptionV1[]; objects: DecisionObjectV1[];
    forwardedFrom?: SessionMessageRef;
  }>): Promise<WriteResult<SessionMessage>>;
  answerDecision(ctx: CoreCallContext, request: GraphWrite<{
    source: DecisionSourceV1; selection: DecisionSelectionV1;
    text: string; annotations: DecisionAnnotationV1[];
  }>): Promise<WriteResult<SessionMessage>>;
  readDecisionAnswer(ctx: CoreCallContext, input: { source: DecisionSourceV1 }):
    Promise<ReadResult<{ message: SessionMessage | null;
      body: UserDecisionBodyV1 | null }>>;
  recordDecisionApplication(ctx: CoreCallContext, request: GraphWrite<{
    messageRef: SessionMessageRef; receipt: DecisionApplicationReceiptV1;
  }>): Promise<WriteResult<SessionMessage>>;
  /** K3 L4: the read-only committed-receipt lookup for `record_decision_application`. */
  lookupToolCommit?: ToolCommitLookup;
}

export interface RequestCandidatePort {
  readRequestCandidate(ctx: CoreCallContext, input: {
    goalRef: GoalRef; requestRef: QueryJobRef;
  }): Promise<ReadResult<{ head: PlanProposal | null;
    status: 'candidate' | 'stale' | 'closed' | null;
    closedReason: 'goal_cancelled' | null;
    /** S7: the mechanical marks of this candidate against its `basedOn`; `{marks:[]}` without a source. */
    impact: RequestCandidateImpactV1;
    /** S7: the request's previous candidate (the record whose `notAdopted.replacedBy` names the head). */
    previous: { proposalRef: PlanProposalRef; revision: number } | null }>>;
  abandonPlanProposal(ctx: CoreCallContext, request: GraphWrite<{
    proposalRef: PlanProposalRef;
  }>): Promise<WriteResult<PlanProposal>>;
}

export interface WorkspaceDecisionSettingsPort {
  markNoticesSeen(ctx: CoreCallContext, request: GraphWrite<{
    workspace: WorkspaceScope; displayToken: string;
    seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
  }>): Promise<WriteResult<WorkspaceSnapshot>>;
}

// ------------------------------------------------------------------------ //
// Read model DTOs (spec §4.1)                                               //
// ------------------------------------------------------------------------ //

export type DecisionCardStateV1 =
  | 'waiting_answer' | 'answered_pending_application' | 'applied'
  | 'answered_no_application' | 'closed';

/**
 * §2.8: the `action_release` card's facts beside the shared card shape. It is
 * the same request view the task detail shows (`NodeActionRequestV1`), plus the
 * card key, the stored intake verdict and the live blockers the read can name.
 */
export type ActionReleaseCardViewV1 = NodeActionRequestV1 & {
  /** The card's own stable key; equal to `DecisionCardV1.cardKey`. */
  cardKey: string;
  /** The stored intake verdict: `needs_decision` on a card, the automatic arms otherwise. */
  decisionVerdict: ActionRequestDecisionVerdictV1;
  blockedBy: ActionRequestBlockerV1[];
  /**
   * §2.8: whether the Task can be claimed now, from the same target-loop judgment the task detail projects. False
   * with an empty `blockedBy` still means not claimable: the six skips that only set the verdict name no blocker.
   * Null when no request-side blocker stands and the target-loop judgment is not read (no port, or a stop card).
   */
  claimableNow: boolean | null;
  /** A waiting dispatch card does NOT block a claim; a waiting stop card does ("answer the card first"). */
  claimsBlockedByCard: boolean;
  /**
   * The target loop's gate/node/line judgment (§2.8); `not_read` is the old read when no port is wired, and the
   * standing value on a stop card, which reads its own record instead of the dispatch judgment.
   */
  targetLoopBlockers: 'not_read' | { blockers: TaskClaimTargetBlockerV1[] };
  /**
   * §2.8: the plan the claiming Run actually read (`outcome.run` → `Run.planRef`), beside the intake
   * `planVersion`; null when nothing claimed the Task or the Run is not readable.
   */
  claimedPlanRef: PlanRevisionRef | null;
};

/**
 * §2.8: one Task's claim judgment from the target loop — the module gate, node occupancy, line busy and the resulting
 * claimable verdict. The Workflow keeps the one judgment (`workflow.ts`'s selection path); this port is how the card
 * source and the task detail read it without importing `business/workflow`. Absent, both keep `not_read`.
 */
export type TaskClaimJudgmentV1 = {
  /** The target loop's own three causes; empty when none of them stands. */
  blockers: TaskClaimTargetBlockerV1[];
  /** The target loop's verdict for this Task now (it may be false for a cause outside the three named ones). */
  claimable: boolean;
};

export interface TaskClaimabilityPort {
  readTaskClaimability(ctx: CoreCallContext, input: { goalRef: GoalRef; task: TaskTriple }):
    Promise<ReadResult<TaskClaimJudgmentV1>>;
}

export type DecisionCardV1 = {
  cardKey: string; source: DecisionSourceV1;
  state: DecisionCardStateV1;
  subject: DecisionSubjectV1; senderSessionRef: SessionRef | null;
  requestRef: QueryJobRef | null;
  objects: DecisionObjectV1[]; options: DecisionOptionV1[];
  answerMessageRef: SessionMessageRef | null;
  answer: UserMessageResponseV1 | null;
  application: DecisionApplicationV1 | null;
  candidateStatus: 'candidate' | 'stale' | null;
  staleReason: string | null;
  closedReason: 'goal_cancelled' | 'source_resolved' | null;
  /** The card's own stored fact time; null when the source has none. */
  openedAt: string | null;
  /** 卡的来源 pins 里那一个 Task 设计；没有或不止一个写 null。 */
  taskRef: TaskTriple | null;
  /** 卡的来源 pins 里那一个 Run；没有或不止一个写 null。 */
  runRef: RunRef | null;
  readOnly: boolean;
  actions: ('answer' | 'ask_secretary' | 'apply' | 'record_application'
    | 'adopt' | 'regenerate' | 'abandon' | 'adopt_architecture'
    | 'adopt_completion_policy')[];
  /** §2.8: the `action_release` card's request view; absent on every other source kind. */
  actionRelease?: ActionReleaseCardViewV1;
  /** R-M8: on the coarse-split `structural_proposal` card, the rounds its approval leaves; absent on every other card. */
  roundsAfterApproval?: number;
  /** 121-136 A4: present only on a `candidate` card whose plan brings checks — the candidate's stored checks (id,
   *  kind, command, the Tasks they apply to); the person's adoption installs the ones not installed yet. */
  proposedChecks?: readonly RegisteredCommandCheck[];
  /** R2（lead 11-18）：只在 `goal_cause` 卡上——原因是 no_new_basis 或 auto_rework_cap_reached，这一轮没过的都是这个工作区设置里装的、
   *  不是这个目标的计划带来的命令检查：这些检查的 id。动作“撤回检查并重新核验”：逐条设置路由 `checks/withdraw`
   *  （`{ scope, checkId }`，scope 是目标的工作区），再对这个 Task 的链头轮 `verification/reverify`（链头和它的 pin 是 Task 行
   *  `failure.round` 的 `roundRef`、`revision`）。撤回后配置变了，重新核验不会再判 no_new_basis；只点“重新入队”不行，返工的键里没有配置。 */
  withdrawableChecks?: readonly string[];
};

/** The side of the wait the notice names. `waiting` = the line whose wait is stranded; `recipient` = the line it waits on. */
export type DisconnectSideV1 = 'waiting' | 'recipient';

/** The stored facts of one disconnect row (the view's projection input, carried verbatim on the notice item). */
export type DisconnectFactV1 = {
  /** `disconnect:<canonicalKey({sessionRef, at})>`: `at` is `archivedAt`, or the bound `unavailableSince` cursor. */
  operationKey: string;
  occurredAt: string;
  messageRef: SessionMessageRef;
  side: DisconnectSideV1;
  /** The Session that is gone (archived or retired). */
  party: SessionRef;
  /** The other communication side of the same wait; `null` for an undelivered message or a person recipient. */
  counterparty: SessionRef | null;
  successor: SessionRef | null;
  goalRef: GoalRef | null;
  /** The copy Goal pin of an unforwarded copied intervention (the pending item); `null` on a disconnect row. */
  copyGoal: { ref: GoalRef; revision: number } | null;
  /** D-54: a retired line's bound `unavailableSince`; an archived line's stranded-message `since`. */
  position: CommitCursor;
};

export type NoticeItemV1 = {
  itemKey: string; category: NoticeCategoryV1; subject: DecisionSubjectV1;
  position: NoticePositionV1; summary: string; objects: DecisionObjectV1[];
  /** R-F1: the disconnect row's structured fact, carried verbatim; absent on every other category. */
  disconnect?: DisconnectFactV1;
  /** L16（决定 55）：只加在触发返工的那一轮有 `resourceCapHit` 的条目上；别的条目不带这个字段。 */
  actions?: readonly { kind: 'raise_memory_cap' }[];
  /** KC-1 G3 (ruling 4-10): the notice's own kind, only on the three knowledge notices; every other item omits it. */
  noticeKind?: 'knowledge_write_unconfirmed' | 'knowledge_reverted' | 'knowledge_conflict'
    /** G8B B1g：批检查的请知悉。 */
    | 'check_approved' | 'check_to_person';
  rework: null | {
    operation: 'requeue' | 'reverify'; actorClass: 'system' | 'agent';
    taskRef: TaskTriple; count: number; cap: number | null; reason: string;
    sourceRef: TaskRequeueRef | VerificationRoundRef;
    /** The triggering fact's own stored time (the requeue's or the round's `requestedAt`). */
    requestedAt: string;
    /** The Task's counted reworks across both arms (requeue `autoCount` + reverify `chain.autoCount`); an automatic
     *  recovery on either arm is excluded. */
    taskCount: number;
    /** This item's own arm counts: `automation.counted` for a requeue, `exemption === 'none'` for a reverify. */
    counted: boolean;
  };
  /**
   * 4C-2 U9: a folded line's member set. Present only on a grouped line that
   * folded more than one source item; an own-line item carries no `members`
   * (a line's members are the item itself).
   */
  members?: { itemKey: string; position: NoticePositionV1 }[];
  /** 4C-2 U9: the note class the pure grouping reads; absent means own-line. */
  noteClass?: 'user_affected' | 'structural' | 'scribe_result';
};

export type DecisionSourcePageV1<T> = {
  availability: 'available' | 'not_available'; items: T[];
  nextCursor: string | null; sourceCursor: CommitCursor | null;
};

export type DecisionQueueReadV1 = {
  waitingAnswer: DecisionCardV1[];
  answeredPendingApplication: DecisionCardV1[];
  history: DecisionCardV1[];
  notices: NoticeItemV1[];
  counts: { waitingAnswer: number; answeredPendingApplication: number;
    notices: Partial<Record<NoticeCategoryV1, number>> };
  countsComplete: boolean;
  nextCursor: string | null; sourceCursor: CommitCursor;
  seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
  displayToken: string | null;
  capabilities: { source: DecisionSourceV1['kind'] | NoticeCategoryV1;
    availability: 'available' | 'not_available' | 'read_failed';
    /** 只在 read_failed 上：这一种第一次读失败的原因（原样）。 */
    reason?: string }[];
};

export type GoalConflictReadV1 = {
  cards: DecisionCardV1[];
  labels: { goalRef: GoalRef; otherGoalRef: GoalRef;
    text: string; selfPlanRef: PlanRevisionRef | null;
    otherPlanRef: PlanRevisionRef | null }[];
  footprintCompleteness: { goalRef: GoalRef;
    executedFiles: 'available' | 'not_available';
    possiblyIncomplete: boolean; unmappedFiles: string[] }[];
  sourceCursor: CommitCursor;
};

export interface DecisionReadPort {
  queryDecisionQueue(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; goalRef?: GoalRef;
    sections: ('waiting_answer' | 'answered_pending_application' | 'history' | 'notices')[];
    categories?: NoticeCategoryV1[];
    /** ISO-8601 with `Z` or an explicit offset, millisecond precision; `since` inclusive, `until` exclusive;
     *  a null `openedAt` is outside any bounded read. */
    since?: string; until?: string;
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
  }): Promise<ReadResult<DecisionQueueReadV1>>;
  readDecisionCard(ctx: CoreCallContext, input: {
    source: DecisionSourceV1;
  }): Promise<ReadResult<DecisionCardV1>>;
  queryGoalConflicts(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; atLeastCursor?: CommitCursor;
  }): Promise<ReadResult<GoalConflictReadV1>>;
}

/**
 * KLS-2 ruling 9 (R-window): the current architecture comes from the knowledge
 * files, and a stable ledger window reads only records. So the conflicts'
 * architecture is read BEFORE a window is fixed, right after the revision of
 * the current catalog pointer record (`activeRefKey`); the window re-reads that
 * pointer, and a different revision is a moved window. A `null` architecture
 * and revision: no catalog adopted.
 */
export type ConflictArchitectureRead = {
  architecture: AdoptedArchitecture | null;
  catalogPointerRevision: number | null;
};

/**
 * R-window (ruling 9, F-30): what one queue window reads from the knowledge
 * files, read before the window is fixed: the conflicts' architecture (`null`
 * when the queue reads no conflicts) and, in `attempt`, what the card sources'
 * `prepareWindow` read for the subjects, listed once. Internal only.
 * `readFailed` (121-146): a card source whose read failed in this preparation
 * (the 2a-1 read-back gate refused the conflicts' architecture: a bad file, a
 * duplicate id, a dangling reference; or a source's own `prepareWindow`). The
 * queue reads without that source and marks it `read_failed`; a write in flight
 * and a cancelled read still fail the whole queue.
 */
export type DecisionQueuePreparation = {
  architecture: ConflictArchitectureRead | null;
  readFailed: { source: DecisionSourceV1['kind']; reason: string }[];
  attempt: DecisionSourceAttempt;
};
/**
 * R-window for a reader whose own ledger window wraps the queue read
 * (lines/list, the context's paged queue): it prepares the queue before ITS
 * window and hands the preparation, failed or not, to every queue page. Such a
 * queue read makes ONE attempt (stack review 2): a window that moved comes back
 * `moved`, and the caller prepares again and reads its whole own window, at
 * most `WINDOW_MAX_ATTEMPTS` times. On the caller's last attempt a moved window
 * is the queue's own `unavailable`. Internal only; no route reaches it.
 */
export type PreparedDecisionQueue = {
  read: ReadResult<DecisionQueuePreparation>;
  /** The caller's last attempt: a window that moved answers `unavailable`, not `moved`. */
  last: boolean;
};
export type DecisionQueueWindowMoved = { status: 'moved' };
export interface DecisionQueuePreparedReader {
  /** The preparation for queue reads of this workspace, Goal and sections (their pages share it). */
  prepareDecisionQueue(ctx: CoreCallContext,
    input: Pick<Parameters<DecisionReadPort['queryDecisionQueue']>[1], 'workspace' | 'goalRef' | 'sections'>):
    Promise<ReadResult<DecisionQueuePreparation>>;
  queryDecisionQueuePrepared(ctx: CoreCallContext, input: Parameters<DecisionReadPort['queryDecisionQueue']>[1],
    prepared: PreparedDecisionQueue): Promise<ReadResult<DecisionQueueReadV1> | DecisionQueueWindowMoved>;
}

// ------------------------------------------------------------------------ //
// Source readers (spec §4.2)                                                //
// ------------------------------------------------------------------------ //

export interface DecisionCardSourcePort {
  kind: DecisionSourceV1['kind'];
  /**
   * The subjects the source serves. `goal`: the queue reads it once per Goal in scope; `project`: once for the bound
   * project when the read is not filtered to one Goal, also with zero Goals.
   */
  serves: readonly DecisionSubjectV1['kind'][];
  /**
   * No `goalRef` asks a project-serving source for the bound project's cards; a source answers an empty page for a
   * subject it does not serve.
   */
  readPage(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; goalRef?: GoalRef;
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor; attempt?: DecisionSourceAttempt };
  }): Promise<ReadResult<DecisionSourcePageV1<DecisionCardV1>>>;
  /**
   * R-窗 (ruling 9): a source that shows knowledge files reads them here, before the queue fixes its ledger
   * window, into `attempt`, for the subjects the window will read (`goals`; the project when `project`); inside the
   * window it reads only records and checks them against what it read here.
   */
  prepareWindow?(ctx: CoreCallContext, input: { workspace: WorkspaceScope; goals: readonly GoalSnapshot[];
    project: boolean; attempt: DecisionSourceAttempt }): Promise<ReadResult<void>>;
  /** Optional direct read of one source key (spec §4.2). */
  readByKey?(ctx: CoreCallContext, input: { workspace: WorkspaceScope; source: DecisionSourceV1 }):
    Promise<ReadResult<DecisionCardV1 | null>>;
}

export interface DecisionNoticeSourcePort {
  category: NoticeCategoryV1;
  readPage(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; goalRef?: GoalRef;
    after?: NoticePositionV1;
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor; attempt?: DecisionSourceAttempt };
  }): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>>;
}

// The concrete `readGoalDecisionCauses`, `readPlanningQuestions` and
// `readInitialPlanAnswerFacts` readers live in `tasks/` (SPEC §4.2, file list
// F27/F28) because they perform persisted reads; the model layer only declares
// the ports above. `PlanTaskPort.readInitialPlanAnswerFacts` is the seam.

// ------------------------------------------------------------------------ //
// Finite decision resolution DTOs (spec §4.5)                               //
// ------------------------------------------------------------------------ //

export type ResolveDecisionInputV1 = {
  source: DecisionSourceV1; selection: DecisionSelectionV1;
  text: string; annotations: DecisionAnnotationV1[];
};

export type ResolveDecisionActionV1 =
  | WriteResult<{ goals: GoalSnapshot[] }> | WriteResult<SessionMessage>
  | NoteDispositionResult | CoreRejection | null;

export type ResolveDecisionReadV1 = {
  answer: WriteResult<SessionMessage>;
  action: ResolveDecisionActionV1;
  application: WriteResult<SessionMessage> | CoreRejection | null;
  state: 'answered' | 'applied' | 'awaiting_resume' | 'application_not_recorded';
};

// ------------------------------------------------------------------------ //
// New decision write-event bodies (spec §2.8)                              //
// ------------------------------------------------------------------------ //
//
// These are pure declarations, exactly like
// `configuration/project-bootstrap-record-codecs.ts::ProjectBootstrapEventBody`:
// every event carries the actor/request identity plus the EXACT value written by
// the same commit, so a receipt replay restores the original result instead of
// guessing it from the current record. `payload.proof` is the §2.8 change proof
// (null when the event proves no content change, e.g. a no-op notice cursor).
// The encoders/decoders live in `persistence/decision-record-codecs.ts`.

export type DecisionWriteEventBaseV1<T> = {
  eventId: string; schemaVersion: 1; occurredAt: string;
  identityKey: string; fingerprint: string;
  projectId: string; workspaceId: string; actor: ActorRef; requestId: string;
  payload: { value: T; proof: DecisionChangeProofV1 | null };
};

/** `GoalSettingsChanged@1`: one Goal's settings, or a whole reordered workspace. */
export type GoalSettingsChangedEventV1 = DecisionWriteEventBaseV1<
  GoalSnapshot | { goals: GoalSnapshot[] }
> & { eventType: 'GoalSettingsChanged' };

/** `WorkspaceNoticeSeenChanged@1`: the exact Workspace snapshot the mark wrote. */
export type WorkspaceNoticeSeenChangedEventV1 = DecisionWriteEventBaseV1<WorkspaceSnapshot>
  & { eventType: 'WorkspaceNoticeSeenChanged' };

/**
 * §2.3: the one `user-decision-response` composer. Both the card-answer round's
 * stored question and the line's busy-point input render the same template with
 * the same formal body, so an edit to that template cannot fork the two texts.
 * The submit has no execution's frozen texts yet and passes the platform pack;
 * the busy point passes its execution's frozen set to this same function.
 */
export function composeDecisionResponseInput(
  texts: PromptTextsV1, body: UserDecisionBodyV1, toolNames: readonly string[],
): string {
  return renderTemplate(texts, 'user-decision-response', { bodyJson: canonicalJson(body) }, toolNames).text;
}

