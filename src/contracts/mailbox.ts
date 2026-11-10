/**
 * The persisted message record and the mailbox reads that carry it (the single
 * declaration). WorkGraph's `state/message-machine.ts` and
 * `model/communication-contracts.ts` re-export them; the UI reads one
 * message's view, body and page through these shapes.
 */
import type { ArtifactRef } from './artifact.js';
import type { ActorRef, CommitCursor } from './command-event.js';
import type { SessionRef } from './core/identity.js';
import type {
  ApplicationProofV1, DecisionApplicationV1, DecisionMessageMetadataV1, MessageDeliveryStateV1,
  MessageReadDispositionV1, MessageRecipient, MessageReleaseV1, SessionMessageIntentV1, SessionMessageRef,
  UserMessageResponseV1,
} from './core/session-message.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1, TaskTriple } from './dispatch.js';
import type { MessageReleaseBlockV1 } from './goal-decisions.js';
import type { DispatchBasisV1, GoalRef } from './ledger.js';
import type { QueryJobAnswerRef, QueryJobRef, QueryRunRef } from './query-job.js';

/** Trusted Host sender: a real human/system identity, never fabricated per recipient. */
export type MessageHostSenderRecord = {
  kind: 'host';
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
};

/**
 * Formal work-run sender. `sessionRef`/`runRef`/`roleBinding`/`generation` must
 * all match the persisted claim and the live Run/Session facts; none of them is
 * taken from model JSON.
 */
export type MessageWorkRunSenderRecord = {
  kind: 'work_run';
  sessionRef: SessionRef;
  runRef: RunRef;
  roleBinding: RoleBindingRefV1;
  generation: number;
};

/**
 * Formal Query Answer sender. It is DERIVED by the mailbox from the settled
 * official Query Job/Run/Answer, never supplied by a caller: `sessionRef` is the
 * original recipient, `queryRunRef`/`answerRef` are the persisted facts and
 * `generation` is the claimed Session generation that produced the Answer.
 */
export type MessageQueryAnswerSenderRecord = {
  kind: 'query_run';
  sessionRef: SessionRef;
  queryRunRef: QueryRunRef;
  answerRef: QueryJobAnswerRef;
  generation: number;
};

/**
 * A reply lives in the ORIGINAL message's single response slot. It never
 * produces a second inbox message and never fabricates a sender Session. The
 * original message `sender` stays restricted to host/work_run/secretary_round;
 * only the response slot additionally accepts the derived `query_run` Answer
 * source. The response slot is written once.
 */
export type MessageResponseRecord = {
  sender: MessageWorkRunSenderRecord | MessageQueryAnswerSenderRecord;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  respondedAt: string;
  /** A refusal reply; present only with `reason`, absent (never `undefined`) on a plain reply. */
  reject?: MessageResponseRejectV1['reject'];
  reason?: MessageResponseRejectV1['reason'];
};

/** The record's stored delivery value only; the derived triple lives in C. */
export type MessageDeliveryV1 = 'queued' | 'delivered';
export type MessageDeliveryEvidenceV1 = { executionRef: RunRef | QueryRunRef; acceptedAt: string };

/**
 * The standalone secretary sender record: a running secretary round. Its
 * identity comes from the resolver, never from input, and the message `sender`
 * union admits it beside host and work_run.
 */
export type MessageSecretaryRoundSenderRecord = {
  kind: 'secretary_round';
  sessionRef: SessionRef;
  queryRunRef: QueryRunRef;      // the resolver's `run`, never `round`
  requestRoot: QueryJobRef;      // equal to the resolver's requestRoot
  generation: number;            // the resolver's `sessionGeneration`
};

/** The reject branch of the single response slot; a plain reply has neither key. */
export type MessageResponseRejectV1 = { reject: true; reason: string };
export type SessionMessageStatus = 'pending' | 'read' | 'responded';

/**
 * Narrow Host-side confirmation, written ONLY from a committed Kernel
 * `run.input_accepted` fact: which original source part entered which
 * execution. It is the durable cross-Turn consumption relation, never a
 * caller-supplied processed flag. Append-only.
 */
export type MessageAcceptedInput = {
  inputId: string;
  part: 'message' | 'response' | 'expiry';
  executionRef: RunRef | QueryRunRef;
  kernel: { adapterId: string; kernelSessionId: string; runId: string; turnId: string; position: number };
  acceptedAt: string;
  /** A-08: `input_accepted` for a Work execution, `query_entered` for a secretary's frozen input. */
  evidence: 'input_accepted' | 'query_entered';
  /** The acceptance that consumes the wait; a `message` part never does. */
  consumesWait: boolean;
};

/**
 * The FIXED isolated A′ derivation recorded on the original request BEFORE the
 * Query is submitted. A retry reuses it even if the source advanced, so the
 * first derivation source/boundary is the replayable formal fact. A null
 * throughPosition is the explicit empty baseline, distinct from a non-empty one.
 * The first writer wins.
 */
export type MessageConsultationDerivation = {
  childSessionRef: SessionRef;
  sourceSessionRef: SessionRef;
  sourceKernel: { adapterId: string; kernelSessionId: string };
  throughPosition: number | null;
};
/**
 * Persisted message. `revision` starts at 1 (send CAS@0) and is the CAS unit for
 * ack/respond. `bodyRef` is the only durable body address; text is never inlined
 * in the message record.
 *
 * Every lifecycle field from `taskRef` on is required. A field with no producer
 * yet keeps the initial value the constructor writes (`null`, or
 * `delivery: 'queued'`), never an absent key.
 */
export type SessionMessageRecord = {
  ref: SessionMessageRef;
  schemaVersion: 1;
  revision: number;
  sender: MessageHostSenderRecord | MessageWorkRunSenderRecord | MessageSecretaryRoundSenderRecord;
  recipient: MessageRecipient;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  createdAt: string;
  status: SessionMessageStatus;
  readAt: string | null;
  response: MessageResponseRecord | UserMessageResponseV1 | null;
  /**
   * Wiring package 2 (spec §2.3, L10): the commit cursor of the FIRST saved
   * response. `null` is the pending placeholder written by
   * `nextSessionMessageRecord` on a work_run message's first reply and bound in
   * the same mailbox commit; it is absent on non-work_run senders and on a
   * work_run message that has never been replied to.
   */
  responseSince?: CommitCursor | null;
  /** The owning Goal; required, `null` when the message has none. */
  goalRef: GoalRef | null;
  /** Slice 5: decision metadata, only on a user decision request or synthetic answer. */
  decision?: DecisionMessageMetadataV1;
  /** Slice 5: the recorded application of the user's answer, when requirements demanded one. */
  application?: DecisionApplicationV1 | null;
  /** Explicit communication intent; absent keeps the historical notify default. */
  intent?: SessionMessageIntentV1;
  /** The sender expects a semantic reply (independent of whether it waits now). */
  needsReply?: boolean;
  /** The sender chose to yield execution after the message is durably saved. */
  waitAfterSend?: boolean;
  acceptedInputs?: MessageAcceptedInput[];
  consultationDerivation?: MessageConsultationDerivation;
  /**
   * Slice 1 §2.5: the effective reply handler for this wait. Absent and null
   * both mean the original `sender.sessionRef` still handles it.
   */
  replyHandler?: {
    sessionRef: SessionRef;
    /** The archive that moved the handler; absent on a person's `waits/dispose` transfer. */
    archiveSessionRef?: SessionRef;
    archiveRequestId?: string;
    changedAt: string;
  } | null;
  /** Slice 1 §2.5: the recorded disposal of this wait during an archive; absent and null mean none. */
  archiveWaitDisposition?: {
    kind: 'cancel' | 'transfer';
    runRef: RunRef;
    archiveSessionRef: SessionRef;
    archiveRequestId: string;
    recordedAt: string;
  } | null;
  taskRef: TaskTriple | null;
  requestRoot: QueryJobRef | null;
  followupOf: SessionMessageRef | null;
  deadline: string | null;
  deadlineMs: number | null;
  release: MessageReleaseV1 | null;
  delivery: MessageDeliveryV1;
  deliveryEvidence: MessageDeliveryEvidenceV1 | null;
  expiredAt: string | null;
  withdrawnAt: string | null;
  waitCancelledAt: string | null;
  transferredTo: SessionMessageRef | null;
  originalRef: SessionMessageRef | null;
  appliedAt: string | null;
  rejectedAt: string | null;
  approvedAt: string | null;
  approvalRevision: number | null;
  applicationProof: ApplicationProofV1 | null;
  pins: DispatchBasisV1 | null;
};

/**
 * The full mailbox read: the record, the derived delivery triple and the
 * disposition as three separate fields; the stored `delivery` on the record is never overloaded.
 */
export type SessionMessageReadV1 = {
  message: SessionMessageRecord;
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
