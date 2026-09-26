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
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1 } from '../../../contracts/dispatch.js';
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

/**
 * A reply lives in the ORIGINAL message's single response slot. It never
 * produces a second inbox message and never fabricates a sender Session.
 */
export type MessageResponse = {
  sender: MessageWorkRunSender;
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
    request: GraphWrite<{ recipient: SessionRef; text: string }>,
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
  ): Promise<ReadResult<{ items: SessionMessage[]; nextCursor: string | null; sourceCursor: CommitCursor }>>;
  ackMessage(
    ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef }>,
  ): Promise<WriteResult<SessionMessage>>;
  respondMessage(
    ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef; text: string }>,
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
