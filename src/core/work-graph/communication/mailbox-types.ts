import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CorePrincipal, MaterialReader } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { DecisionHostSenderV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { SessionArchiveRequestV1 } from '../../../contracts/core/session-archive.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import type { MessageQueryAnswerSender, MessageSender, SessionMailboxDependencies, SessionMailboxPort, SessionMessage, SessionMessageCommandPort, SessionMessageStatus } from '../model/communication-contracts.js';
import type { RecipientOpenExecutionsV1 } from '../model/session-facts-contracts.js';
import type { DecisionMessagePort, MessageCommandWritePort, SessionMessageCommitCompanions } from '../model/decision-contracts.js';
import type { EncodedDomainEvent, RecordGuard, UniqueClaimChange } from '../../record-store/ports.js';
import type { TaskClaimOutbox } from '../model/claim-contracts.js';
import type { TaskExecutionRecord } from '../model/execution-read-contracts.js';
import type { MessageEffect, MessageGuardContext, MessageTransition, SessionMessageEventType, MessageWithdrawnChangeV1, MessageReleaseDecidedChangeV1 } from '../state/message-machine.js';

export type Unknown = Record<string, unknown>;

/**
 * `ownContext` admits these principals. A `query_run` principal is only the
 * literal caller here; its round is resolved after a receipt miss (send) or on
 * every read, never in `ownContext`.
 */
export type MailboxPrincipal = Extract<CorePrincipal, { kind: 'host' | 'work_run' | 'query_run' }>;

export type WorkRunPrincipal = Extract<CorePrincipal, { kind: 'work_run' }>;

export type HostActor = Extract<CorePrincipal, { kind: 'host' }>['actor'];

export type SessionMessageStore = SessionMailboxDependencies['records'];

export type MessageCommitReceipt = Extract<Awaited<ReturnType<SessionMessageStore['commit']>>, { status: 'committed' }>;

export type PreparedSessionMessageWrite = {
  owned: { projectId: string; workspaceId: string; signal: AbortSignal };
  identityKey: string;
  fingerprint: string;
  message: SessionMessage;
  event: EncodedDomainEvent;
  /** The ACCEPTED message pin of the caller; `null` = the message must not exist yet. */
  messageRevision: number | null;
  guards: readonly RecordGuard[];
  claims: readonly UniqueClaimChange[];
  /** The companion contribution of the same fact (a counter, a Session activity): records first, then this message. */
  companions?: SessionMessageCommitCompanions;
  cancelledReason: string;
  commitFailureReason: string;
};

export type WithdrawFacts = {
  message: SessionMessage;
  open: RecipientOpenExecutionsV1;
  guards: readonly RecordGuard[];
  actor: MessageSender;
};

export type WithdrawDecision = {
  before: SessionMessage;
  change: MessageWithdrawnChangeV1;
  at: string;
  actor: MessageSender;
  guards: readonly RecordGuard[];
  horizon: CommitCursor;
};

export type ReleaseFacts = { message: SessionMessage; actor: MessageSender };

export type ReleaseDecision = {
  before: SessionMessage;
  change: MessageReleaseDecidedChangeV1;
  at: string;
  actor: MessageSender;
};

// --------------------------------------------------------------------------
// Trusted call context
// --------------------------------------------------------------------------

export type Owned = {
  ok: true;
  projectId: string;
  workspaceId: string;
  principal: MailboxPrincipal;
  reader: MaterialReader;
  signal: AbortSignal;
};

export type OwnedContext = Owned | { ok: false; rejection: CoreRejection };

/**
 * The project/workspace scope `identityKeyOf`/`fingerprintOf` bind. The real
 * owner methods pass their `Owned` context; the L4 lookup passes the original
 * Run's `origin` so the identity matches what that Run actually committed.
 */
export type MailboxScope = { projectId: string; workspaceId: string };

export type OwnedWrite<T> = {
  ok: true;
  input: T;
  requestId: string;
  expected: readonly VersionPin[];
} | { ok: false; rejection: CoreRejection };

export type Refused = Extract<MessageTransition, { ok: false }>;

export type Accepted = Extract<MessageTransition, { ok: true }>;

/** A synchronously snapshotted `atLeastCursor`: its comparable sequence and the raw cursor. */
export type AtLeastCursor = { seq: number; cursor: CommitCursor };

export type MessageCommitPlan = {
  /** `store_body`: stored and verified BEFORE the commit, outside the transaction. */
  body: Extract<MessageEffect, { kind: 'store_body' }> | null;
  /** `append_event`: the event appended in the commit. */
  eventType: SessionMessageEventType;
  /** `guard_message`: `null` = the message must not exist yet (send CAS@0). */
  messageRevision: number | null;
  /** `guard_work_run_facts`: the admission's Run, Session, Lease and role guards join the commit. */
  workRunFacts: boolean;
};

/** The fields every SessionMessage event carries between its type and its actor, in today's key order. */
export type MessageEventEnvelope = { schemaVersion: 1; occurredAt: string; projectId: string; workspaceId: string; requestId: string };

export type InboxCursorV1 = {
  v: 1;
  projectId: string;
  workspaceId: string;
  recipient: SessionRef;
  status: SessionMessageStatus | null;
  callerKey: string;
  after: string;
};

export type OutboxCursorV1 = {
  v: 1;
  projectId: string;
  workspaceId: string;
  senderRun?: RunRef;
  senderSession?: SessionRef;
  callerKey: string;
  after: string;
};

export type SecretaryOutboxCursorV1 = {
  v: 1;
  projectId: string;
  workspaceId: string;
  requestRoot: QueryJobRef;
  callerKey: string;
  after: string;
};

export type ReplyCursorV1 = {
  v: 1;
  kind: 'routed' | 'undelivered';
  projectId: string;
  workspaceId: string;
  sessionId: string;
  callerKey: string;
  after: string;
};

/**
 * The full result `createSessionMailbox` provides: the frozen full command port
 * (`SessionMessageCommandPort`: the two sender-read methods and the two view
 * reads on top of the historical narrow `SessionMailboxPort`), the two methods
 * that are always present and the slice-5 user-send owner
 * (`DecisionMessagePort.sendUserMessage`). The user address never enters the
 * legacy `SessionRef` `sendMessage` admission.
 */
export type SessionMailboxWithUserSend = SessionMessageCommandPort
  & Required<Pick<SessionMailboxPort, 'respondFromQueryAnswer' | 'readOutbox'>>
  & Pick<DecisionMessagePort, 'sendUserMessage'>;

export type MessageBodySender = MessageSender | MessageQueryAnswerSender | DecisionHostSenderV1;

export type FactsOutcome = { ok: true; record: TaskExecutionRecord } | { ok: false; rejection: CoreRejection };

export type IdentityOutcome =
  | { ok: true; run: RunSnapshot; claim: TaskClaimOutbox['claim']; session: SessionRecord }
  | { ok: false; rejection: CoreRejection };

export type AuthOutcome = { ok: true; guards: RecordGuard[] } | { ok: false; rejection: CoreRejection };

export type QueryRecordRead<T> = ReadResult<T>;

export type QueryAnswerFacts = {
  verdict: NonNullable<MessageGuardContext['queryAnswer']>;
  bodyBounded: boolean;
  text: string;
  /** The formal Answer body's ORIGINAL source. */
  answerSource: ArtifactRef['source'];
  /** The derived query_run sender; null while a fact the machine refuses on is missing. */
  sender: MessageQueryAnswerSender | null;
};

export type BodyOutcome = { ok: true; ref: ArtifactRef } | { ok: false; rejection: CoreRejection };

export type Receipt = Extract<Awaited<ReturnType<SessionMailboxDependencies['records']['commit']>>, { status: 'committed' }>;

/** `store_body`'s input: the message the body belongs to, its text, and a formal Answer's ORIGINAL source (`null` = the current Workspace). */
export type BodyInput = { messageRef: SessionMessageRef; text: string; answerSource: ArtifactRef['source'] | null };

/** An accepted write's own inputs; the machine's effects decide the rest (`writeMessage`). */
export type MessageWrite = {
  owned: Owned;
  identityKey: string;
  fingerprint: string;
  requestId: string;
  /** The command identity: the event actor and a stored body's sender. */
  actor: MessageSender | MessageQueryAnswerSender;
  /** The fresh work_run admission; its guards join the commit on `guard_work_run_facts`. */
  admission: AuthOutcome | null;
  /** The reason of the cancellation check right before the commit. */
  cancelled: string;
  /** Slice 5 read-fact guards (duties, Goal) the user-message row joins to its one commit. */
  extraGuards?: readonly RecordGuard[];
  /** The acceptance's own `wait-consumed` claim; empty for every other write. */
  claims?: readonly UniqueClaimChange[];
  /**
   * A refusal reply's `rejectedAt` is the commit's own clock instant, the same
   * fact the change carries; the machine state holds only that the slot is
   * taken, so the owner's instant overlays the accepted state before the
   * canonical comparison. A send's release and pins are the machine's own
   * accepted state (`sendRelease`), so they need no overlay.
   */
  acceptedRejectedAt?: true;
  /**
   * The companion contribution of this same fact, planned at the commit's one
   * clock instant: a released `action_request`'s counter, a released non-notify
   * message's Session activity. Planned before the record so a deadline that
   * overflows is refused before anything is written.
   */
  companions?: (at: string) => Promise<
    { ok: true; value: SessionMessageCommitCompanions } | { ok: false; rejection: CoreRejection }>;
} & (
  /** `write_message`: the record the machine's constructor builds at the write's clock instant, around the stored body. */
  | { body: BodyInput; record: (at: string, bodyRef: ArtifactRef) => SessionMessage }
  | { body: null; record: (at: string) => SessionMessage }
);

export type ReadRight = { ok: true; allowed: boolean } | { ok: false; rejection: CoreRejection };

export type InboxPage = {
  items: SessionMessage[]; cursors: CommitCursor[]; nextCursor: string | null;
  sourceCursor: CommitCursor; recipient: SessionRef;
};

export type DurableArchiveRequestRead =
  | { ok: true; session: SessionRecord; request: SessionArchiveRequestV1; revision: number }
  | { ok: false; rejection: CoreRejection };

export type StoredArchiveRequestRead =
  | { ok: true; request: SessionArchiveRequestV1 }
  | { ok: false; rejection: CoreRejection };

export type WaitRunRead =
  | { ok: true; run: RunSnapshot; revision: number; refKey: string }
  | { ok: false; rejection: CoreRejection };

export type MailboxContext = {
  readonly deps: SessionMailboxDependencies;
  readonly records: SessionMailboxDependencies['records'];
  readonly messageWrites: MessageCommandWritePort;
};
