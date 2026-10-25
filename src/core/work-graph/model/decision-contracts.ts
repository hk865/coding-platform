/**
 * Slice 5 WorkGraph model ports, dependency seams and read DTOs
 * (spec §2.6, §2.8, §3.3, §4.1, §4.2, §4.5).
 *
 * This file declares only the narrow contracts the owners and the read model
 * share; the implementations live in their owner modules.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
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
  GoalSettingsV1,
  NoticeCategoryV1,
  NoticePositionV1,
  UserDecisionBodyV1,
} from '../../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { NoteKind } from '../../../contracts/note.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import type { TaskRequeueRef } from '../../../contracts/task-requeue.js';
import type { VerificationRoundRef } from '../../../contracts/verification.js';
import type { ToolCommitLookup } from '../../../contracts/unknown-call-review.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordGuard, UniqueClaimChange } from '../../record-store/ports.js';
import type { MessageQueryAnswerSender, MessageSender, SessionMailboxPort, SessionMessage,
  SessionMessageEventV1 } from './communication-contracts.js';
import type { MaterialPort } from './material-contracts.js';
import type { NoteDecisionApplicationInputV1, NoteDispositionResult } from './note-contracts.js';
import type { PlanProposal, PlanProposalRef } from './plan-contracts.js';
import type { GraphWrite } from './task-contracts.js';

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
  }): Promise<ReadResult<{
    root: boolean; initiatedByOperator: boolean;
    currentSecretary: SessionRef | null; guards: readonly RecordGuard[];
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
  action: DecisionActionV1 | null;
  objects: DecisionObjectV1[]; options: DecisionOptionV1[];
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
  pins: VersionPin[]; objects: DecisionObjectV1[]; options: DecisionOptionV1[] };
export type NoteDecisionClosedReasonV1 = 'goal_cancelled' | 'source_resolved';
export interface NoteDecisionSourcePort {
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
      subject: DecisionSubjectV1 | null }>>;
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
    closedReason: 'goal_cancelled' | null }>>;
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
  readOnly: boolean;
  actions: ('answer' | 'ask_secretary' | 'apply' | 'record_application'
    | 'adopt' | 'regenerate' | 'abandon' | 'adopt_architecture'
    | 'adopt_completion_policy')[];
};

export type NoticeItemV1 = {
  itemKey: string; category: NoticeCategoryV1; subject: DecisionSubjectV1;
  position: NoticePositionV1; summary: string; objects: DecisionObjectV1[];
  /** L16（决定 55）：只加在触发返工的那一轮有 `resourceCapHit` 的条目上；别的条目不带这个字段。 */
  actions?: readonly { kind: 'raise_memory_cap' }[];
  rework: null | {
    operation: 'requeue' | 'reverify'; actorClass: 'system' | 'agent';
    taskRef: TaskTriple; count: number; cap: number | null; reason: string;
    sourceRef: TaskRequeueRef | VerificationRoundRef;
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
    availability: 'available' | 'not_available' }[];
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
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
  }): Promise<ReadResult<DecisionQueueReadV1>>;
  readDecisionCard(ctx: CoreCallContext, input: {
    source: DecisionSourceV1;
  }): Promise<ReadResult<DecisionCardV1>>;
  queryGoalConflicts(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; atLeastCursor?: CommitCursor;
  }): Promise<ReadResult<GoalConflictReadV1>>;
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
  | WriteResult<{ goals: GoalSnapshot[] }> | NoteDispositionResult | CoreRejection | null;

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
