/**
 * C1 SessionMailbox public DTOs and narrow port (Stage 1 frozen direction).
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
import type { SessionMessageIntentFields, SessionMessageIntentV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1 } from '../../../contracts/dispatch.js';
import type { QueryJobAnswerRef, QueryRunRef } from '../../../contracts/query-job.js';
import { canonicalJson, sha256Hex } from '../../../contracts/fingerprint.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RoleBindingFactsPort } from '../configuration/contracts.js';
import type { MaterialPort } from '../materials/contracts.js';
import type { GraphWrite, SessionDirectoryPort } from '../sessions/contracts.js';
import type { ExecutionEntryDependencies } from '../tasks/execution-entry-contracts.js';
import type { ExecutionReadPort } from '../tasks/execution-read-contracts.js';

/** Trusted host actor: a real human/system identity, never fabricated per recipient. */
export type MessageHostSender = {
  kind: 'host';
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
};

/**
 * Formal work-run sender. `sessionRef`/`runRef`/`roleBinding`/`generation` must
 * all match the persisted claim and the live Run/Session facts; none of them is
 * taken from model JSON.
 */
export type MessageWorkRunSender = {
  kind: 'work_run';
  sessionRef: SessionRef;
  runRef: RunRef;
  roleBinding: RoleBindingRefV1;
  generation: number;
};

export type MessageSender = MessageHostSender | MessageWorkRunSender;

/** The stable identity of one persisted source part; shared by Kernel supply and mailbox consumption. */
export function deriveSessionInputId(messageRef: SessionMessageRef, part: 'message' | 'response'): string {
  return 'session-input:' + sha256Hex(canonicalJson({ ref: messageRef, part } as never));
}

/**
 * Formal Query Answer sender. It is DERIVED by the mailbox from the settled
 * official Query Job/Run/Answer, never supplied by a caller: `sessionRef` is the
 * original recipient, `queryRunRef`/`answerRef` are the persisted facts and
 * `generation` is the claimed Session generation that produced the Answer.
 */
export type MessageQueryAnswerSender = {
  kind: 'query_run';
  sessionRef: SessionRef;
  queryRunRef: QueryRunRef;
  answerRef: QueryJobAnswerRef;
  generation: number;
};

/**
 * A reply lives in the ORIGINAL message's single response slot. It never
 * produces a second inbox message and never fabricates a sender Session. The
 * original message `sender` stays restricted to host/work_run; only the
 * response slot additionally accepts the derived `query_run` Answer source.
 */
export type MessageResponse = {
  sender: MessageWorkRunSender | MessageQueryAnswerSender;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  respondedAt: string;
};

export type SessionMessageStatus = 'pending' | 'read' | 'responded';

/**
 * Persisted message. `revision` starts at 1 (send CAS@0) and is the CAS unit for
 * ack/respond. `bodyRef` is the only durable body address; text is never inlined
 * in the message record.
 */
export type SessionMessage = {
  ref: SessionMessageRef;
  schemaVersion: 1;
  revision: number;
  sender: MessageSender;
  recipient: SessionRef;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  createdAt: string;
  status: SessionMessageStatus;
  readAt: string | null;
  response: MessageResponse | null;
  /**
   * Optional explicit reply expectation. ABSENT is the entire historical
   * fire-and-forget behavior; the ONLY accepted legacy value is `'wait'`, which is
   * normalized to `needsReply`/`waitAfterSend`. It is persisted with the message
   * so a reopened Host still sees the original ask.
   */
  replyMode?: 'wait';
  /** Explicit communication intent; absent keeps the historical notify default. */
  intent?: SessionMessageIntentV1;
  /** The sender expects a semantic reply (independent of whether it waits now). */
  needsReply?: boolean;
  /** The sender chose to yield execution after the message is durably saved. */
  waitAfterSend?: boolean;
  /**
   * The FIXED isolated A′ derivation recorded on the original request BEFORE the
   * Query is submitted. A retry reuses it even if the source advanced, so the
   * first derivation source/boundary is the replayable formal fact. A null
   * throughPosition is the explicit empty baseline, distinct from a non-empty one.
   */
  /**
   * Narrow Host-side confirmation, written ONLY from a committed Kernel
   * `run.input_accepted` fact: which original source part entered which
   * execution. It is the durable cross-Turn consumption relation, never a
   * caller-supplied processed flag.
   */
  acceptedInputs?: {
    inputId: string;
    part: 'message' | 'response';
    executionRef: RunRef | QueryRunRef;
    kernel: { adapterId: string; kernelSessionId: string; runId: string; turnId: string; position: number };
    acceptedAt: string;
  }[];
  consultationDerivation?: {
    childSessionRef: SessionRef;
    sourceSessionRef: SessionRef;
    sourceKernel: { adapterId: string; kernelSessionId: string };
    throughPosition: number | null;
  };
};

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
   * C2 fresh Host/Role admission (Stage 1 seam). When absent, a NEW work_run
   * mailbox write is explicitly `unsupported`; the original receipt replay, the
   * Host operations and the historical identity reads keep their existing
   * contract. The dependencies are the same WorkGraph `bodies` /
   * `authorizeConfiguration` the B2 entry lane already owns; a second admission
   * algorithm is never built here.
   */
  runtimeAdmission?: Pick<ExecutionEntryDependencies, 'bodies' | 'authorizeConfiguration'>;
  systemActor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  now(): string;
  newId(): string;
};
