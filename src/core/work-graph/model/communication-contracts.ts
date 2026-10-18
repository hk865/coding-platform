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
import type { SessionMessageIntentFields, SessionMessageRef,
  DecisionHostSenderV1 } from '../../../contracts/core/session-message.js';
import type { ArchiveStepRefV1 } from '../../../contracts/core/session-archive.js';
import type { RunRef, SourceRefV1 } from '../../../contracts/dispatch.js';
import type { QueryJobAnswerRef, QueryRunRef } from '../../../contracts/query-job.js';
import { canonicalJson, sha256Hex } from '../../../contracts/fingerprint.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RoleBindingFactsPort } from './configuration-contracts.js';
import type { ToolCommitLookup } from '../../../contracts/unknown-call-review.js';
import type { MessageDutiesFactsPort } from './decision-contracts.js';
import type { MaterialPort } from './material-contracts.js';
import type { GraphWrite, SessionDirectoryPort, SessionPage, SessionPageRequest } from './session-contracts.js';
import type { ExecutionEntryDependencies } from './execution-entry-contracts.js';
import type { ExecutionReadPort } from './execution-read-contracts.js';
import type {
  MessageQueryAnswerSenderRecord, MessageWorkRunSenderRecord,
  SessionMessageRecord, SessionMessageStatus as SessionMessageStatusRecord,
} from '../state/message-machine.js';

export type {
  MessageAcceptedInput, MessageConsultationDerivation, MessageResponseRecord as MessageResponse,
} from '../state/message-machine.js';

/** Trusted host actor: a real human/system identity, never fabricated per recipient.
 * Compatibility alias: the shared declaration lives in `contracts/core/session-message.ts`. */
export type MessageHostSender = DecisionHostSenderV1;

export type MessageWorkRunSender = MessageWorkRunSenderRecord;

export type MessageSender = MessageHostSender | MessageWorkRunSender;

/** The stable identity of one persisted source part; shared by Kernel supply and mailbox consumption. */
export function deriveSessionInputId(messageRef: SessionMessageRef, part: 'message' | 'response'): string {
  return 'session-input:' + sha256Hex(canonicalJson({ ref: messageRef, part } as never));
}

export type MessageQueryAnswerSender = MessageQueryAnswerSenderRecord;

export type SessionMessageStatus = SessionMessageStatusRecord;

export type SessionMessage = SessionMessageRecord;

/** Slice 1 §2.5: a read-only source item for a reply that reached a retired line. */
export type UndeliveredReplyV1 = {
  kind: 'retired_reply'; messageRef: SessionMessageRef; sourceSessionRef: SessionRef;
  responseRef: ArtifactRef; respondedAt: string; hasContinuation: boolean;
  requiresUserRecipient: boolean; // 无 continuation 为 true。
  /** Wiring package 2 (spec §2.3): the bound entry/reply commit cursors, or absent on legacy data. */
  unavailableSince?: CommitCursor;
  responseSince?: CommitCursor;
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
  | SessionMessageDecisionAppliedEventV1;

/** One keyset page shared by the inbox and the sender-Run outbox. */
export type SessionMessagePage = {
  items: SessionMessage[];
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
    request: GraphWrite<{ recipient: SessionRef; text: string; replyMode?: 'wait' } & SessionMessageIntentFields>,
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
  ): Promise<ReadResult<SessionMessagePage>>;
  ackMessage(
    ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef }>,
  ): Promise<WriteResult<SessionMessage>>;
  respondMessage(
    ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef; text: string }>,
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
      part: 'message' | 'response';
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
};
