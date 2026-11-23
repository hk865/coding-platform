/**
 * C1 SessionMailbox public DTOs and narrow port.
 *
 * The mailbox is addressed by the EXISTING `SessionRef`; it adds no permanent
 * Agent, no mailbox middleware, no business manager and no second history store.
 * A SessionMessage is a received statement, not a task obligation:
 *   - a busy Session still receives durable mail;
 *   - an archived Session keeps its inbox and history;
 *   - receiving never wakes, preempts, changes lifecycle/occupancy, or creates
 *     a task dependency;
 *   - a pending inbox item does NOT prevent explicit archival.
 *
 * Sender identity is never self-reported by JSON: host senders carry a trusted
 * human/system actor and work-run senders are re-checked against the formal
 * WG11/claim facts by the service. A `MessageBody` carries only bounded text and
 * explicitly does NOT grant current-source/evidence applicability.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { MessageDeliveryStateV1, MessageReadDispositionV1, SendRejectionV1,
  MessageAnsweredByV1, MessageEntryV1, SessionMessageSendFields, SessionMessageRef,
  DecisionHostSenderV1 } from '../../../contracts/core/session-message.js';
import { INTERVENTION_CLOSING_REASONS, interventionClosingNoticeRequestId, PLATFORM_NOTICE_ACTOR,
  type InterventionClosingReasonV1 } from '../../../contracts/core/session-message.js';
import type { ArchiveStepRefV1 } from '../../../contracts/core/session-archive.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { SystemRoundV1 } from '../../../contracts/plan-round.js';
import type { MessageBody, SessionMessageReadPageV1, SessionMessageReadV1 } from '../../../contracts/mailbox.js';
import type { QueryJobAnswerRef, QueryJobRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type {
  DecisionSourceV1, NoticePositionV1,
} from '../../../contracts/goal-decisions.js';
import type { TaskRequeueRef } from '../../../contracts/task-requeue.js';
import type { VerificationRoundRef } from '../../../contracts/verification.js';
import { canonicalJson, canonicalKey, sha256Hex } from '../../../contracts/fingerprint.js';
import type { RecordLookupPort, RecordOrderedLookupPage, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordCommitIdentityPort } from '../../record-store/ports.js';
import type { RoleBindingFactsPort } from './configuration-contracts.js';
import type { ToolCommitLookup, ToolCommitLookupResult } from '../../../contracts/unknown-call-review.js';
import type { MessageDutiesFactsPort } from './decision-contracts.js';
import type { DispatchBasisFactsPort } from './dispatch-basis-contracts.js';
import type { MaterialPort } from './material-contracts.js';
import type { SessionDirectoryPort, SessionPage, SessionPageRequest } from './session-contracts.js';
import type { GraphWrite } from './task-contracts.js';
import type { QueryRoundPort, QueryRoundV1 } from './query-round-contracts.js';
import type { SecretaryQueryRunPort } from './secretary-query-run-contracts.js';
import type { RecipientExecutionsPort, DeliveryEligibilityFactsV1 } from './session-facts-contracts.js';
import type { ExecutionEntryDependencies } from './execution-entry-contracts.js';
import type { ExecutionReadPort } from './execution-read-contracts.js';
import { effectiveReplyHandler, isWaitMessage, messageFactsOfRecord, waitFactsOfRecord, waitStateOf,
  type DeliveryFactsV1 } from '../state/message-machine.js';
import { sameRef } from '../state/ref-equality.js';
import type {
  MessageAcceptedInput, MessageQueryAnswerSenderRecord, MessageQueryRoundSenderRecord, MessageSecretaryRoundSenderRecord,
  MessageWorkRunSenderRecord,
  SessionMessageRecord, SessionMessageStatus,
} from '../state/message-machine.js';

export type {
  MessageAcceptedInput, MessageConsultationDerivation, MessageResponseRecord as MessageResponse,
} from '../state/message-machine.js';

/** C's DTOs, named here so every model caller keeps one import site (Q7A1-02). */
export type { MessageDeliveryStateV1, MessageReadDispositionV1 };

/** Trusted host actor: a real human/system identity, never fabricated per recipient.
 * Compatibility alias: the shared declaration lives in `contracts/core/session-message.ts`. */
export type MessageHostSender = DecisionHostSenderV1;

export type MessageWorkRunSender = MessageWorkRunSenderRecord;

export type MessageSender = MessageHostSender | MessageWorkRunSender | MessageSecretaryRoundSender | MessageQueryRoundSender;

/** The trusted secretary sender the mailbox writes; every identity field comes from the resolver, never input. */
export type MessageSecretaryRoundSender = MessageSecretaryRoundSenderRecord;

/** 问答轮（非秘书请求轮）自己发信、回复时的发件人：身份全由问答轮解析得出；不带 `answerRef`，和正式答复分开。 */
export type MessageQueryRoundSender = MessageQueryRoundSenderRecord;

/** The stable identity of one persisted source part; shared by Kernel supply and mailbox consumption. */
export function deriveSessionInputId(
  messageRef: SessionMessageRef, part: 'message' | 'response' | 'expiry',
): string {
  if (part === 'expiry') return 'expiry:' + canonicalKey(messageRef);
  return 'session-input:' + sha256Hex(canonicalJson({ ref: messageRef, part } as never));
}

/**
 * The ONE conversion to the delivery predicate's facts: the consumption facts of the record, the caller's
 * eligibility facts, and the part's own delivery/wait facts. Query admission and the consumable-Sessions view call
 * this one copy; no caller restates the delivered/accepted or wait rules.
 */
export function consultationFacts(message: SessionMessage, part: 'message' | 'response',
  extra: DeliveryEligibilityFactsV1, target: SessionRef | null): DeliveryFactsV1 {
  const accepted = (id: string) => (message.acceptedInputs ?? []).some((entry) => entry.inputId === id);
  const base = { consumption: messageFactsOfRecord(message), ...extra };
  // A saved reply is the message's consumption fact too: an answered message stops being offered even when the
  // recipient's execution never recorded `input_accepted` (the association is the formal reply, not a delivery).
  if (part === 'message') {
    return { ...base, part, delivered: message.response !== null || accepted(deriveSessionInputId(message.ref, 'message')) };
  }
  const state = waitStateOf(message, waitFactsOfRecord(message));
  const handler = effectiveReplyHandler(message);
  return { ...base, part, accepted: accepted(deriveSessionInputId(message.ref, 'response')),
    wait: !isWaitMessage(message) ? { kind: 'none' }
      : state.state === 'consumed' ? { kind: 'consumed' }
      : handler !== null && sameRef(handler, target) ? { kind: 'unconsumed', boundHere: true }
      : { kind: 'unconsumed', boundHere: false } };
}

/**
 * The Goal a message's one intervention-planning Query belongs to: the Goal the message names (its `goalRef`, else
 * its `taskRef`'s Goal). The Query lives in that Goal's workspace, so every reader finds it from the message alone;
 * `null` keeps the Query in the message's own workspace.
 */
export function interventionGoalRefOf(message: SessionMessage): GoalRef | null {
  return message.goalRef ?? (message.taskRef === null ? null
    : { aggregateType: 'Goal', projectId: message.taskRef.projectId, goalId: message.taskRef.goalId });
}

/** The one wait-consumed unique slot; the acceptance claim's key and the reader's key are the same. */
export function waitConsumedClaimKey(messageRef: SessionMessageRef): string {
  return 'wait-consumed:' + canonicalKey(messageRef);
}

export type MessageQueryAnswerSender = MessageQueryAnswerSenderRecord;

export type { SessionMessageStatus };

export type SessionMessage = SessionMessageRecord;

/**
 * R7A1-01: the derivation's input is its OWN structure, so `7a1-ports` typechecks before the record's delivery fields
 * exist. A `SessionMessage` is assignable to it; `MessageAcceptedInput` is the file's existing type.
 */
export type MessageDeliveryFactsV1 = {
  ref: SessionMessageRef;
  status: SessionMessageStatus;
  acceptedInputs?: readonly MessageAcceptedInput[];
  withdrawnAt: string | null;
  /** The saved reply slot; a formal response blocks both delivery and withdrawal. */
  response: SessionMessageRecord['response'];
  /** `copy` marks a question consumed by its copy identity, never by the original line. */
  answeredBy: MessageAnsweredByV1;
};
/**
 * The ONE derivation's result: delivery and disposition always come from the same call (R7A1-09). Acceptance and a
 * formal reply are separate facts, so neither is folded into the delivery state.
 */
export type MessageDeliveryDerivationV1 = {
  delivery: MessageDeliveryStateV1;
  disposition: MessageReadDispositionV1;
  /** Kernel already accepted the message (an `acceptedInputs` message part). */
  accepted: boolean;
  /** A formal reply is already saved, whether or not Kernel accepted the original input. */
  responded: boolean;
  /** The original line may still deliver it: not withdrawn, neither accepted nor answered, and not a copy question. */
  deliverable: boolean;
  /** The sender may still withdraw it: not withdrawn, neither accepted nor answered (a copy question is still withdrawable). */
  withdrawable: boolean;
};

/** The ONE derivation (M-2's body); the two view reads, the work line and the withdraw check take this result. */
export function deriveMessageDelivery(
  message: MessageDeliveryFactsV1,
  recipientLine: { archived: boolean; retired: boolean },
): MessageDeliveryDerivationV1 {
  const acceptedInput = message.acceptedInputs?.find((input) => input.part === 'message');
  const accepted = acceptedInput !== undefined;
  const responded = message.response !== null;
  const copyQuestion = message.answeredBy === 'copy';
  const withdrawn = message.withdrawnAt !== null;
  const deliverable = !withdrawn && !accepted && !responded && !copyQuestion;
  const withdrawable = !withdrawn && !accepted && !responded;
  let delivery: MessageDeliveryStateV1;
  if (acceptedInput !== undefined) {
    delivery = {
      delivery: 'delivered',
      deliveredTo: { executionRef: acceptedInput.executionRef, acceptedAt: acceptedInput.acceptedAt },
      evidence: 'accepted',
      undeliveredReason: null,
    };
  } else if (recipientLine.archived || recipientLine.retired) {
    delivery = {
      delivery: 'undelivered',
      deliveredTo: null,
      evidence: null,
      // Archived wins when both are true (the read rule names archived before retired).
      undeliveredReason: recipientLine.archived ? 'recipient_archived' : 'recipient_retired',
    };
  } else {
    delivery = { delivery: 'queued', deliveredTo: null, evidence: null, undeliveredReason: null };
  }

  let disposition: MessageReadDispositionV1;
  if (message.withdrawnAt !== null) {
    disposition = { kind: 'withdrawn' };
  } else if (delivery.delivery === 'delivered') {
    disposition = { kind: 'delivered', evidence: delivery.evidence! };
  } else if (delivery.delivery === 'undelivered') {
    disposition = { kind: 'undelivered', reason: delivery.undeliveredReason! };
  } else if (responded) {
    disposition = { kind: 'answered' };
  } else if (copyQuestion) {
    disposition = { kind: 'copy' };
  } else {
    disposition = { kind: 'offerable' };
  }
  return { delivery, disposition, accepted, responded, deliverable, withdrawable };
}

/**
 * One round's fixed closing notice, proved by the notice writer's own source-and-part identity. A round writes at
 * most one reason, so the finite reason set (or the one `reason` a caller names) is one lookup keyed by the same
 * request id the send used. The write goes out under the fixed platform identity on the source's workspace, so the
 * receipt is read under that same identity and workspace — never the caller's operator actor or scan scope. This is
 * the ONE receipt read; `plan-readers.ts`'s `roundSettled`, the two mailbox views and `workflow.closingNotice` all
 * take it. Only the Host reads its own receipt; a non-Host context keeps `readHostSendMessageRef`'s own rejection.
 */
export async function readClosingNotice(
  readHostSendMessageRef: HostSendMessageRefRead | undefined,
  ctx: CoreCallContext,
  input: {
    sourceMessageRef: SessionMessageRef; part: 'message' | 'decision_answer';
    reason?: InterventionClosingReasonV1;
  },
): Promise<ReadResult<boolean>> {
  if (readHostSendMessageRef === undefined) return { status: 'ready', value: false };
  const source = input.sourceMessageRef;
  const noticeCtx: CoreCallContext = ctx.principal.kind !== 'host' ? ctx : {
    ...ctx, projectId: source.projectId, workspaceId: source.workspaceId,
    principal: { kind: 'host', actor: { ...PLATFORM_NOTICE_ACTOR } },
    materialReader: { kind: 'host', projectId: source.projectId, workspaceId: source.workspaceId,
      actor: { ...PLATFORM_NOTICE_ACTOR } },
  };
  const scope: WorkspaceScope = { projectId: source.projectId, workspaceId: source.workspaceId };
  const reasons = input.reason === undefined ? INTERVENTION_CLOSING_REASONS : [input.reason];
  for (const reason of reasons) {
    const requestId = interventionClosingNoticeRequestId(source, reason, input.part);
    const found = await readHostSendMessageRef(noticeCtx, { requestId, scope });
    if (found.status === 'ready') return { status: 'ready', value: true };
    if (found.status !== 'not_found') return found;
  }
  return { status: 'ready', value: false };
}

/**
 * The mailbox read's `no_answer` slice of `readClosingNotice`: a message view may only carry the fact for the Host
 * (the only principal that may read its own send receipt), so every other reader keeps its older view without the
 * fact instead of failing the whole message read. The receipt rule itself is `readClosingNotice`'s one copy.
 */
export async function readNoAnswerClosingNotice(
  readHostSendMessageRef: HostSendMessageRefRead | undefined,
  ctx: CoreCallContext,
  source: SessionMessageRef,
  part: 'message' | 'decision_answer' = 'message',
): Promise<ReadResult<boolean>> {
  if (ctx.principal.kind !== 'host') return { status: 'ready', value: false };
  return readClosingNotice(readHostSendMessageRef, ctx,
    { sourceMessageRef: source, part, reason: 'no_answer' });
}

/** Slice 1 §2.5: a read-only source item for a reply that reached a retired line. */
export type UndeliveredReplyV1 = {
  kind: 'retired_reply'; messageRef: SessionMessageRef; sourceSessionRef: SessionRef;
  responseRef: ArtifactRef; respondedAt: string; hasContinuation: boolean;
  requiresUserRecipient: boolean; // 无 continuation 为 true。
  /** Wiring package 2 (spec §2.3): the bound entry/reply commit cursors. */
  unavailableSince: CommitCursor;
  responseSince: CommitCursor;
};

/**
 * Persisted SessionMessage event bodies (stable replay carriers). Declared here,
 * in `model`, rather than in `sessions/`, so the `model`-layer write facade
 * (`decision-contracts.ts` `MessageWriteOwnerPort.persist`) can name the event
 * union without a `model -> sessions` import (module-target allows
 * `model -> state` only). `sessions/message-record-codecs.ts` re-exports them.
 */
type MessageSessionEventBaseV1 = {
  eventId: string;
  schemaVersion: 1;
  occurredAt: string;
  projectId: string;
  workspaceId: string;
  requestId: string;
  actor: MessageSender;
  message: SessionMessage;
};

export type SessionMessageSentEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageSent' };
export type SessionMessageConsultationDerivedEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageConsultationDerived' };
export type SessionMessageInputAcceptedEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageInputAccepted' };
export type SessionMessageRespondedEventV1 = Omit<MessageSessionEventBaseV1, 'actor'> & {
  eventType: 'SessionMessageResponded';
  /** The formal responder identity: a work_run or a derived query_run Answer. */
  actor: MessageSender | MessageQueryAnswerSender;
};
/** Slice 5: a synthetic (non-message) decision was answered. */
export type SessionMessageDecisionAnsweredEventV1 = Omit<MessageSessionEventBaseV1, 'actor'> & {
  eventType: 'SessionMessageDecisionAnswered';
  actor: MessageHostSender;
};
/** Slice 5: the application of an answered decision was recorded. */
export type SessionMessageDecisionAppliedEventV1 = Omit<MessageSessionEventBaseV1, 'actor'> & {
  eventType: 'SessionMessageDecisionApplied';
  actor: ActorRef;
};
export type SessionMessageEventV1 =
  | SessionMessageSentEventV1
  | SessionMessageRespondedEventV1
  | SessionMessageConsultationDerivedEventV1
  | SessionMessageInputAcceptedEventV1
  | SessionMessageDecisionAnsweredEventV1
  | SessionMessageDecisionAppliedEventV1
  | SessionMessageExpiredEventV1
  | SessionMessageLifecycleEventV1;

export type SessionMessageWithdrawnEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageWithdrawn' };
export type SessionMessageAppliedEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageApplied' };
export type SessionMessageExpiredEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageExpired' };
export type SessionMessageLifecycleEventV1 = SessionMessageWithdrawnEventV1 | SessionMessageAppliedEventV1;

/** One keyset page shared by the inbox and the sender-Run outbox. */
export type SessionMessagePage = {
  items: SessionMessage[];
  /** The message's own `since`, aligned with `items` (a response uses the message's `responseSince`). */
  cursors: readonly CommitCursor[];
  nextCursor: string | null;
  sourceCursor: CommitCursor;
};

/** The outbox keeps `items` as the record page; the page carries no per-item release block. */
export type SessionMessageOutboxPageV1 = SessionMessagePage;

export type SendMessageResultV1 =
  (Extract<WriteResult<SessionMessage>, { status: 'committed' }> & { sendStatus: 'sent' | 'awaiting_release' })
  | SendRejectionV1;

export type SessionMessageSendInputV1 = GraphWrite<{
  recipient: SessionRef;
  text: string;
  needsReply?: boolean;
  waitAfterSend?: boolean;
  /** The sender chooses; the owner writes `true` when the caller omits it. */
  wake?: boolean;
  /** `copy` only for the consultation question; the owner writes `line` otherwise. */
  answeredBy?: MessageAnsweredByV1;
  /** Only the direct-intervention Host entry supplies it; model input is never read. */
  entry?: MessageEntryV1;
  taskRef?: TaskTriple;
  followupOf?: SessionMessageRef;
  deadlineMs?: number;
  goalRef?: GoalRef;
}>;

export type SessionMessageRespondInputV1 = GraphWrite<
  { messageRef: SessionMessageRef } & ({ text: string } | { reject: true; reason: string })
>;

/** The mailbox reads (`SessionMessageReadV1`, its page and `MessageBody`) are declared once in `contracts/mailbox.ts`. */
export type { MessageBody, SessionMessageReadPageV1, SessionMessageReadV1 };

/** The Host send's own `requestId`, scope and exact arguments; never a Run origin. */
export type HostSendCommitLookupInput = {
  requestId: string; scope: { projectId: string; workspaceId: string };
  toolName: 'send_session_message'; arguments: unknown;
};
/** The read-only Host-send committed-receipt lookup, answered from the original send's identity. */
export type HostSendCommitLookup = (ctx: CoreCallContext, input: HostSendCommitLookupInput) =>
  Promise<ToolCommitLookupResult>;
/**
 * The Host send's real message ref, replayed from its own committed receipt (identity: the sender's `scope`, the
 * caller's Host actor and `requestId`). The message lives in the recipient line's workspace, which may differ from
 * the sender's; `not_found` is "never sent".
 */
export type HostSendMessageRefRead = (ctx: CoreCallContext, input: { requestId: string; scope: WorkspaceScope }) =>
  Promise<ReadResult<SessionMessageRef>>;

/**
 * The Host system outbox: the Host's own record of one rework-notice delivery.
 * `position` is the notice source's own position (the projection's
 * `NoticeItemV1.position`), never a message id, a send cursor or a page cursor.
 */
export type HostOutboxSourceV1 =
  | { kind: 'requeue'; ref: TaskRequeueRef; position: NoticePositionV1 }
  | { kind: 'round'; ref: VerificationRoundRef; position: NoticePositionV1 };
/** The outbox record's own paging position ONLY; never the source position. */
export type HostOutboxPageV1 = { cursor: CommitCursor; ordinal: number };
export type HostOutboxMessageItemV1 = {
  source: HostOutboxSourceV1;
  branch: 'notify_only' | 'adviser_delivery';
  /** The saved send (`input` + `meta.requestId`), written BEFORE the send. The committed send is found by
   *  `request.meta.requestId`; no `message` ref and no `delivered` flag are written after the send. */
  request: SessionMessageSendInputV1;
};
export type HostOutboxCardItemV1 = {
  source: HostOutboxSourceV1;
  branch: 'no_adviser_card';
  /** The full derived source, saved BEFORE the card read; recovery re-reads it by `key`. */
  cardSource: DecisionSourceV1;
};
/** The record stores one branch item; the read DTO adds `page` to every branch (no `Omit` over a union). */
export type HostOutboxStoredItemV1 = HostOutboxMessageItemV1 | HostOutboxCardItemV1;
export type HostOutboxItemV1 =
  | (HostOutboxMessageItemV1 & { page: HostOutboxPageV1 })
  | (HostOutboxCardItemV1 & { page: HostOutboxPageV1 });
/** The store's exclusive ordered keyset: commit cursor plus canonical record key. */
export type HostOutboxKeysetV1 = NonNullable<RecordOrderedLookupPage['next']>;

/**
 * The persisted record (one per delivery). The Store binds `since` to this
 * record's own commit cursor (`commitCursorFields: ['since']`). `ordinal` is the
 * per-cursor item index (0-based, in commit order), written by the appender. The
 * pair `(since, ordinal)` is the PAGE position only.
 */
export type SessionMessageHostOutboxV1 = {
  ref: HostSystemOutboxRef; schemaVersion: 1; revision: number;
  workspace: WorkspaceScope;
  item: HostOutboxStoredItemV1;
  ordinal: number;
  since: CommitCursor;
};
export type HostSystemOutboxRef = { aggregateType: 'HostSystemOutbox'; projectId: string;
  workspaceId: string; outboxId: string };

/**
 * C1 narrow mailbox port. Reads never ack and never change status; ack/respond
 * are the only status transitions and each carries exactly one SessionMessage
 * revision pin in its `GraphWrite`.
 */
export interface SessionMailboxPort {
  sendMessage(
    ctx: CoreCallContext,
    request: GraphWrite<{ recipient: SessionRef; text: string } & SessionMessageSendFields>,
  ): Promise<WriteResult<SessionMessage>>;
  readMessage(ctx: CoreCallContext, ref: SessionMessageRef): Promise<ReadResult<SessionMessage>>;
  readMessageBody(
    ctx: CoreCallContext,
    input: { messageRef: SessionMessageRef; part: 'message' | 'response' },
  ): Promise<ReadResult<MessageBody>>;
  readInbox(
    ctx: CoreCallContext,
    input: {
      recipient: SessionRef;
      status?: SessionMessageStatus;
      page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
    },
  ): Promise<ReadResult<SessionMessagePage>>;
  /**
   * Select exactly one original sender Run or Session, using the SAME keyset
   * page shape as `readInbox`. A work_run caller may read its own Run or Session;
   * a Host caller reads within its workspace. Reading never acknowledges or wakes.
   */
  readOutbox?(
    ctx: CoreCallContext,
    input: {
      senderRun?: RunRef;
      senderSession?: SessionRef;
      page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
    },
  ): Promise<ReadResult<SessionMessageOutboxPageV1>>;
  /**
   * The caller's own trusted `query_run` round, through the mailbox's ONE
   * resolver (a secretary request round included); null for every other
   * principal. The decision reader proves the caller's real Session with it and
   * reads no message.
   */
  readQueryRound(ctx: CoreCallContext): Promise<ReadResult<QueryRoundV1 | null>>;
  /** Trusted Host only: the Host system sender's own outbox, in `since` order. No other principal is admitted. */
  readHostSystemOutbox(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; after: HostOutboxKeysetV1 | null; limit: number;
  }): Promise<ReadResult<{ items: HostOutboxItemV1[]; next: HostOutboxKeysetV1 | null }>>;
  /**
   * Trusted Host only: append ONE saved delivery item as one record commit. The
   * caller gets the Store's real write result, so an uncommitted append never
   * leads to a send or an advance; there is no update path and no `delivered`
   * flag. A retry of the same `(source.position, branch)` names the same record
   * and replays its receipt instead of writing a second item.
   */
  appendHostSystemOutbox(
    ctx: CoreCallContext,
    request: GraphWrite<{ workspace: WorkspaceScope; item: HostOutboxStoredItemV1 }>,
  ): Promise<WriteResult<SessionMessageHostOutboxV1>>;
  /**
   * Host-only association of an ALREADY-SAVED formal Query Answer with the
   * original message's single response slot. It accepts no free text and no
   * caller identity: the body and the `query_run` sender are read from the
   * settled Answer/Job/Run. Absence keeps every existing mailbox behavior.
   */
  respondFromQueryAnswer?(
    ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef; answerRef: QueryJobAnswerRef }>,
  ): Promise<WriteResult<SessionMessage>>;
  /**
   * Host-only CAS recording of the fixed A′ derivation on the ORIGINAL request
   * message. The first recorded derivation wins and every retry reuses it, so the
   * child and its source prefix are not re-decided by a later attempt.
   */
  /**
   * Narrow Host/Runtime confirmation that one original source part really entered
   * an execution (committed Kernel run.input_accepted). Never a caller-supplied
   * processed flag and never called before the required sink commit.
   */
  recordInputAccepted?(
    ctx: CoreCallContext,
    request: GraphWrite<{
      messageRef: SessionMessageRef;
      part: 'message' | 'response' | 'expiry';
      executionRef: RunRef | QueryRunRef;
      executionSessionRef?: SessionRef;
      kernel: { adapterId: string; kernelSessionId: string; runId: string; turnId: string; position: number };
    }>,
  ): Promise<WriteResult<SessionMessage>>;
  recordConsultationDerivation?(
    ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef; derivation: NonNullable<SessionMessage['consultationDerivation']> }>,
  ): Promise<WriteResult<SessionMessage>>;
  /** Slice 1 §3.3: transfer or cancel the original yielded wait of a pending archive step. */
  disposeArchiveWait?(ctx: CoreCallContext, step: ArchiveStepRefV1): Promise<WriteResult<SessionMessage>>;
  /** Slice 1 §2.5: read-only source items for replies that reached a retired line. */
  readUndeliveredReplies?(
    ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest },
  ): Promise<ReadResult<SessionPage<UndeliveredReplyV1>>>;
  /**
   * §2.3/1.2, trusted Host only: one keyset page of this workspace's copy questions with no reply and not withdrawn.
   * `after` is the previous page's `next` (null from the start); a null `next` is the end of the set.
   */
  readPendingCopyQuestions?(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; after: string | null; limit: number;
  }): Promise<ReadResult<{ items: SessionMessage[]; next: string | null }>>;
  /** Slice 1 §2.5: the messages whose effective reply handler is this Session. */
  readRoutedReplies?(
    ctx: CoreCallContext, input: { handler: SessionRef; page: SessionPageRequest },
  ): Promise<ReadResult<SessionPage<SessionMessage>>>;
  /**
   * K3 L4: the read-only committed-receipt lookup for the mailbox tools
   * (`send_session_message`, `respond_session_message`, `notify_person`,
   * `ask_person`, `ask_copy`, `withdraw_session_message`). It never writes and
   * never reads a business fact.
   */
  lookupToolCommit?: ToolCommitLookup;
  /** The Host send's own identity-only committed-receipt read (`send_session_message`); never the current recipient. */
  lookupHostSendCommit?: HostSendCommitLookup;
  /** Where a Host send landed (its receipt's message ref): the one way a sender finds its own sent message. */
  readHostSendMessageRef?: HostSendMessageRefRead;
}
/** The full command port; the historical `SessionMailboxPort` stays the narrow read/old-write port. */
export interface SessionMessageCommandPort extends SessionMailboxPort {
  /**
   * Design 2.3 (an answer reaches the line once): whether an answered agent `ask_person` card's answer is already
   * taken by its own card-answer round (the deterministic `decision_answer` Query exists). The Work safe-point and
   * Query supplies skip such an answer; the acceptance commit guards the same Query key absent. The card is read with
   * the caller's own read admission (`readMessage`); a message that is not an agent card is `false`.
   */
  readDecisionAnswerTaken(ctx: CoreCallContext, input: { messageRef: SessionMessageRef }): Promise<ReadResult<boolean>>;
  sendMessage(ctx: CoreCallContext, request: SessionMessageSendInputV1): Promise<SendMessageResultV1>;
  respondMessage(ctx: CoreCallContext, request: SessionMessageRespondInputV1): Promise<WriteResult<SessionMessage>>;
  withdrawMessage(ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef }>): Promise<WriteResult<SessionMessage>>;
  /** One message with its derived delivery and disposition; never a second derivation. */
  readMessageView(ctx: CoreCallContext, ref: SessionMessageRef): Promise<ReadResult<SessionMessageReadV1>>;
  /** The inbox page with the same derived fields; `status` and the page keys are the record read's. */
  readInboxView(ctx: CoreCallContext, input: {
    recipient: SessionRef;
    status?: SessionMessageStatus;
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
  }): Promise<ReadResult<SessionMessageReadPageV1>>;
}

/** The request's owner Session, read through the existing owner read's facts; never sent by the caller. */
export interface RequestOwnerReadPort {
  ownerOf(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }):
    Promise<ReadResult<SessionRef | null>>;
}

/**
 * Trusted service dependencies. `systemActor` is fixed by the composition root
 * and is used ONLY to execute platform body storage/reads; it never replaces the
 * real mailbox command actor/sender. `roles` is the existing facts seam so the
 * observed role guards can join the same Store transaction instead of a
 * transaction-external boolean check.
 */
export type SessionMailboxDependencies = {
  /** The same store serves `lookup` and the Host system outbox's ordered `since` index. */
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  sessions: SessionDirectoryPort;
  executions: ExecutionReadPort;
  roles: RoleBindingFactsPort;
  materials: MaterialPort;
  /**
   * C2 fresh Host/Role admission. When absent, a NEW work_run
   * mailbox write is explicitly `unsupported`; the original receipt replay, the
   * Host operations and the historical identity reads keep their existing
   * contract. The dependencies are the same WorkGraph `bodies` /
   * `authorizeConfiguration` the B2 entry lane already owns; a second admission
   * algorithm is never built here.
   */
  runtimeAdmission?: Pick<ExecutionEntryDependencies, 'bodies' | 'authorizeConfiguration'>;
  /**
   * [lead S5-T3-D3] Slice 5 §2.6 / S5-AU-04: the trusted duties seam
   * (`configuration/message-duties-adapter.ts` in the composition). The
   * mailbox reads the sender's duties ONLY from here, never from caller/model
   * JSON. Absent: a NEW user-recipient send is `unsupported`; every old
   * Session→Session path is unchanged and never reads it.
   */
  duties?: MessageDutiesFactsPort;
  systemActor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  now(): string;
  newId(): string;
  /** Injected by the composition root: 86,400,000 ms. Absent: a NEW inquiry send is `unsupported`; old paths unchanged. */
  defaultInquiryDeadlineMs?: number;
  /** The one resolver; called only after a receipt miss; absent: a NEW secretary path is `unsupported`. */
  secretaryRounds?: SecretaryQueryRunPort;
  /** 问答轮身份（`tasks/query-round.ts`），`query_run` 调用方的唯一身份读：发信、回复、撤回收任何已进入的问答轮（请求轮
   *  也算），读箱只收非请求轮、请求轮走秘书读者；发信解析不出就是解析器的拒绝，没有第二条路。 */
  queryRounds: QueryRoundPort;
  /** The request's owner read (model's `RequestOwnerReadPort`, satisfied by `W/tasks/request-facts.ts`);
   * absent: a NEW secretary path is `unsupported`; the owner is never guessed from the sending secretary. */
  requestOwners?: RequestOwnerReadPort;
  /** The withdraw's one open-execution read; absent: withdraw is `unsupported`. */
  recipientExecutions?: RecipientExecutionsPort;
  /** The three-version facts read (D's `createDispatchBasisReader`); absent: a NEW autonomy-controlled, goal-bearing
   *  `action_request` is `unsupported`; every other path is unchanged and never reads it. */
  dispatchBasis?: DispatchBasisFactsPort;
  /** The store object's identity-only commit read; absent: the Host-send receipt lookup is `undetermined`. */
  commitIdentities?: Pick<RecordCommitIdentityPort, 'readCommitByIdentity'>;
  /** Design 5.1: the root's one `overlapNoteOf` read (the Query owner's `OverlapNoteReadPort`); a non-null value is the
   *  gate whose saved `noteRequest.messageRef` is this message. Absent: no message is read as a gate note here. */
  gateNotes?: { readGateNote(ctx: CoreCallContext, message: SessionMessage): Promise<ReadResult<object | null>> };
  /** Design 2.2/2.6: the root's one trusted-system-round read; a `host:plan-round` letter keeps the system reply slot
   *  only when it is the round's own sent message. Absent: the fixed sender alone decides, as before. */
  systemRounds?: SystemRoundSourceReadPort;
};

/**
 * Design 2.2/2.6 (`p2-frozen.md:150`): the root's one trusted-system-round read of a stored message
 * (`tasks/plan-lineage.ts` `trustedSystemRoundOfMessage`); a non-null value is the round whose own source it is.
 */
export type SystemRoundSourceReadPort = {
  readSystemRoundSource(ctx: CoreCallContext, message: SessionMessage): Promise<ReadResult<SystemRoundV1 | null>>;
};

/** `messages/forward` (L(3), `book-7b.md:942`); `copyGoalRef` is the copy branch (§3.9 item 1, B-03). */
export type ForwardMessageInputV1 = {
  commandId: string; messageRef: SessionMessageRef; to: SessionRef; copyGoalRef?: GoalRef | null;
};
/** `waits/dispose` (§3.9 item 5); `to` is required exactly for `transfer`. */
export type DisposeWaitInputV1 = {
  commandId: string; messageRef: SessionMessageRef; mode: 'cancel' | 'transfer'; to?: SessionRef;
};
/**
 * `forwarded` is the one commit; `existing` is the same-destination second command (§3.9 item 2: "the existing
 * result") and carries no cursor because it wrote nothing. A refusal is a CoreRejection.
 */
export type ForwardMessageResultV1 =
  | { status: 'forwarded'; message: SessionMessage; replayed: boolean; cursor: CommitCursor }
  | { status: 'existing'; message: SessionMessage }
  | CoreRejection;

export interface MessageForwardingPort {
  forwardMessage(ctx: CoreCallContext, input: ForwardMessageInputV1): Promise<ForwardMessageResultV1>;
  /** P's trusted entry: no person check, the copy branch only. */
  forwardCopiedIntervention(ctx: CoreCallContext,
    input: ForwardMessageInputV1 & { copyGoalRef: GoalRef }): Promise<ForwardMessageResultV1>;
  disposeWait(ctx: CoreCallContext, input: DisposeWaitInputV1): Promise<WriteResult<SessionMessage>>;
}
