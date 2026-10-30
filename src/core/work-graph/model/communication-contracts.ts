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
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { MessageDeliveryStateV1, MessageReadDispositionV1, MessageReleaseV1, SendRejectionV1,
  SessionMessageIntentFields, SessionMessageIntentV1, SessionMessageRef,
  DecisionHostSenderV1 } from '../../../contracts/core/session-message.js';
import type { ArchiveStepRefV1 } from '../../../contracts/core/session-archive.js';
import type { RunRef, SourceRefV1, TaskTriple } from '../../../contracts/dispatch.js';
import type { QueryJobAnswerRef, QueryJobRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { DispatchBasisV1, GoalRef } from '../../../contracts/ledger.js';
import type { DecisionChangeProofV1, MessageReleaseBlockV1 } from '../../../contracts/goal-decisions.js';
import { canonicalJson, canonicalKey, sha256Hex } from '../../../contracts/fingerprint.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RoleBindingFactsPort } from './configuration-contracts.js';
import type { ToolCommitLookup } from '../../../contracts/unknown-call-review.js';
import type { MessageDutiesFactsPort } from './decision-contracts.js';
import type { DispatchBasisFactsPort } from './dispatch-basis-contracts.js';
import type { MaterialPort } from './material-contracts.js';
import type { SessionDirectoryPort, SessionPage, SessionPageRequest } from './session-contracts.js';
import type { GraphWrite } from './task-contracts.js';
import type { SecretaryQueryRunPort } from './secretary-query-run-contracts.js';
import type { RecipientExecutionsPort, DeliveryEligibilityFactsV1 } from './session-facts-contracts.js';
import type { ExecutionEntryDependencies } from './execution-entry-contracts.js';
import type { ExecutionReadPort } from './execution-read-contracts.js';
import { effectiveReplyHandler, messageFactsOfRecord, waitFactsOfRecord, waitStateOf,
  type DeliveryFactsV1 } from '../state/message-machine.js';
import { sameRef } from '../state/ref-equality.js';
import type {
  MessageAcceptedInput, MessageQueryAnswerSenderRecord, MessageSecretaryRoundSenderRecord, MessageWorkRunSenderRecord,
  SessionMessageRecord, SessionMessageStatus as SessionMessageStatusRecord,
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

export type MessageSender = MessageHostSender | MessageWorkRunSender | MessageSecretaryRoundSender;

/** The trusted secretary sender the mailbox writes; every identity field comes from the resolver, never input. */
export type MessageSecretaryRoundSender = MessageSecretaryRoundSenderRecord;

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
  extra: DeliveryEligibilityFactsV1, target: SessionRef): DeliveryFactsV1 {
  const accepted = (id: string) => (message.acceptedInputs ?? []).some((entry) => entry.inputId === id);
  const base = { consumption: messageFactsOfRecord(message), ...extra };
  if (part === 'message') return { ...base, part, delivered: accepted(deriveSessionInputId(message.ref, 'message')) };
  const state = waitStateOf(message, waitFactsOfRecord(message));
  const handler = effectiveReplyHandler(message);
  return { ...base, part, accepted: accepted(deriveSessionInputId(message.ref, 'response')),
    wait: message.intent !== 'inquiry' || message.waitAfterSend !== true ? { kind: 'none' }
      : state.state === 'consumed' ? { kind: 'consumed' }
      : handler !== null && sameRef(handler, target) ? { kind: 'unconsumed', boundHere: true }
      : { kind: 'unconsumed', boundHere: false } };
}

/** The one wait-consumed unique slot; the acceptance claim's key and the reader's key are the same. */
export function waitConsumedClaimKey(messageRef: SessionMessageRef): string {
  return 'wait-consumed:' + canonicalKey(messageRef);
}

export type MessageQueryAnswerSender = MessageQueryAnswerSenderRecord;

export type SessionMessageStatus = SessionMessageStatusRecord;

export type SessionMessage = SessionMessageRecord;

/**
 * R7A1-01: the derivation's input is its OWN structure, so `7a1-ports` typechecks before M-1 adds `release` and
 * `withdrawnAt` to the record. A `SessionMessage` is assignable to it; `MessageAcceptedInput` is the file's existing
 * type.
 */
export type MessageDeliveryFactsV1 = {
  ref: SessionMessageRef;
  status: SessionMessageStatus;
  acceptedInputs?: readonly MessageAcceptedInput[];
  release: MessageReleaseV1 | null;
  withdrawnAt: string | null;
};
/** The ONE derivation's result: delivery and disposition always come from the same call (R7A1-09). */
export type MessageDeliveryDerivationV1 = {
  delivery: MessageDeliveryStateV1;
  disposition: MessageReadDispositionV1;
};

/** The ONE derivation (M-2's body); the two view reads, the work line and the withdraw check take this result. */
export function deriveMessageDelivery(
  message: MessageDeliveryFactsV1,
  recipientLine: { archived: boolean; retired: boolean },
): MessageDeliveryDerivationV1 {
  const accepted = message.acceptedInputs?.find((input) => input.part === 'message');
  let delivery: MessageDeliveryStateV1;
  if (accepted !== undefined) {
    delivery = {
      delivery: 'delivered',
      deliveredTo: { executionRef: accepted.executionRef, acceptedAt: accepted.acceptedAt },
      evidence: 'accepted',
      undeliveredReason: null,
    };
  } else if (message.status === 'read' || message.status === 'responded') {
    delivery = {
      delivery: 'delivered', deliveredTo: null, evidence: 'legacy_unknown', undeliveredReason: null,
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
  } else if (message.release !== null && message.release !== 'released') {
    disposition = { kind: 'not_released', release: message.release };
  } else if (delivery.delivery === 'delivered') {
    disposition = { kind: 'delivered', evidence: delivery.evidence! };
  } else if (delivery.delivery === 'undelivered') {
    disposition = { kind: 'undelivered', reason: delivery.undeliveredReason! };
  } else {
    disposition = { kind: 'offerable' };
  }
  return { delivery, disposition };
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
export type SessionMessageReadEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageRead' };
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
  | SessionMessageReadEventV1
  | SessionMessageRespondedEventV1
  | SessionMessageConsultationDerivedEventV1
  | SessionMessageInputAcceptedEventV1
  | SessionMessageDecisionAnsweredEventV1
  | SessionMessageDecisionAppliedEventV1
  | SessionMessageExpiredEventV1
  | SessionMessageLifecycleEventV1;

export type SessionMessageWithdrawnEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageWithdrawn' };
/** The release-decided event carries the proof; a direct `messages/release` writes the `null` arm. */
export type SessionMessageReleaseDecidedEventV1 = MessageSessionEventBaseV1 & {
  eventType: 'SessionMessageReleaseDecided';
  proof: DecisionChangeProofV1 | null;
};
export type SessionMessageReleasedEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageReleased' };
export type SessionMessageAppliedEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageApplied' };
export type SessionMessageExpiredEventV1 = MessageSessionEventBaseV1 & { eventType: 'SessionMessageExpired' };
export type SessionMessageLifecycleEventV1 =
  | SessionMessageWithdrawnEventV1 | SessionMessageReleaseDecidedEventV1
  | SessionMessageReleasedEventV1 | SessionMessageAppliedEventV1;

/** One keyset page shared by the inbox and the sender-Run outbox. */
export type SessionMessagePage = {
  items: SessionMessage[];
  /** The message's own `since`, aligned with `items` (a response uses the message's `responseSince`). */
  cursors: readonly CommitCursor[];
  nextCursor: string | null;
  sourceCursor: CommitCursor;
};

/** The outbox keeps `items` as the record page and adds the block beside it, one entry per item in the same order;
 * `null` for a message that is not a candidate. */
export type SessionMessageOutboxPageV1 = SessionMessagePage & {
  releaseBlocks: (MessageReleaseBlockV1 | null)[];
};

export type SendMessageResultV1 =
  (Extract<WriteResult<SessionMessage>, { status: 'committed' }> & { sendStatus: 'sent' | 'awaiting_release' })
  | SendRejectionV1;

export type SessionMessageSendInputV1 = GraphWrite<{
  recipient: SessionRef;
  text: string;
  intent?: SessionMessageIntentV1;
  needsReply?: boolean;
  waitAfterSend?: boolean;
  expected?: DispatchBasisV1;
  taskRef?: TaskTriple;
  followupOf?: SessionMessageRef;
  deadlineMs?: number;
  goalRef?: GoalRef;
}>;

export type SessionMessageRespondInputV1 = GraphWrite<
  { messageRef: SessionMessageRef } & ({ text: string } | { reject: true; reason: string })
>;

/**
 * The full mailbox read: the record, the derived delivery triple and the
 * disposition as three separate fields; the stored `delivery` on the record is never overloaded.
 */
export type SessionMessageReadV1 = {
  message: SessionMessage;
  delivery: MessageDeliveryStateV1;
  disposition: MessageReadDispositionV1;
  /** §3.8 item 4: `null` unless this message is an approved, not withdrawn, not released message. */
  releaseBlock: MessageReleaseBlockV1 | null;
};
/** The view read's page: the same keyset shape as `SessionMessagePage`, items carrying the derived fields. */
export type SessionMessageReadPageV1 = {
  items: SessionMessageReadV1[];
  nextCursor: string | null;
  sourceCursor: CommitCursor;
};

/**
 * Decoded bounded message text. `usage:'message'` records that this is a
 * received statement, NOT a current-source/applicability/evidence grant. It
 * also does not pass on any permission to the artifacts the text mentions.
 */
export type MessageBody = {
  messageRef: SessionMessageRef;
  part: 'message' | 'response';
  text: string;
  sourceRef: SourceRefV1;
  usage: 'message';
};

/**
 * C1 narrow mailbox port. Reads never ack and never change status; ack/respond
 * are the only status transitions and each carries exactly one SessionMessage
 * revision pin in its `GraphWrite`.
 */
export interface SessionMailboxPort {
  sendMessage(
    ctx: CoreCallContext,
    request: GraphWrite<{ recipient: SessionRef; text: string } & SessionMessageIntentFields>,
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
  ackMessage(
    ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef }>,
  ): Promise<WriteResult<SessionMessage>>;
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
  /** Slice 1 §2.5: the messages whose effective reply handler is this Session. */
  readRoutedReplies?(
    ctx: CoreCallContext, input: { handler: SessionRef; page: SessionPageRequest },
  ): Promise<ReadResult<SessionPage<SessionMessage>>>;
  /**
   * K3 L4: the read-only committed-receipt lookup for the row-4 mailbox tools
   * (`send_session_message`, `ack_session_message`, `respond_session_message`,
   * `send_user_message`). It never writes and never reads a business fact.
   */
  lookupToolCommit?: ToolCommitLookup;
}
/** The full command port; the historical `SessionMailboxPort` stays the narrow read/old-write port. */
export interface SessionMessageCommandPort extends SessionMailboxPort {
  sendMessage(ctx: CoreCallContext, request: SessionMessageSendInputV1): Promise<SendMessageResultV1>;
  respondMessage(ctx: CoreCallContext, request: SessionMessageRespondInputV1): Promise<WriteResult<SessionMessage>>;
  withdrawMessage(ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef }>): Promise<WriteResult<SessionMessage>>;
  releaseMessage(ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef; allow: boolean }>): Promise<WriteResult<SessionMessage>>;
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
  records: GoalRecordTransactionPort & RecordLookupPort;
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
  /** The request's owner read (model's `RequestOwnerReadPort`, satisfied by `W/tasks/request-facts.ts`);
   * absent: a NEW secretary path is `unsupported`; the owner is never guessed from the sending secretary. */
  requestOwners?: RequestOwnerReadPort;
  /** The withdraw's one open-execution read; absent: withdraw is `unsupported`. */
  recipientExecutions?: RecipientExecutionsPort;
  /** The three-version facts read (D's `createDispatchBasisReader`); absent: a NEW autonomy-controlled, goal-bearing
   *  `action_request` is `unsupported`; every other path is unchanged and never reads it. */
  dispatchBasis?: DispatchBasisFactsPort;
};
