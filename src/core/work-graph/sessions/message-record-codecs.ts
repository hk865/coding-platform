/**
 * SessionMessage record/event codecs and lookup declarations.
 *
 * The WorkGraph owns this closed schemaId list; the RecordStore only selects a
 * codec from the aggregateType of the full ref and applies mechanical CAS,
 * claims, cursor binding and one transaction. This file performs no I/O, no
 * admission, no fold and no transaction.
 *
 * Frozen rules enforced here:
 *   - `SessionMessage@1` has the FULL `SessionMessageRef` as its canonical key
 *     and its body revision must equal the encoded record revision. Text is
 *     never inlined: only the body `ArtifactRef` is persisted.
 *   - `SessionMessageSent@1` / `SessionMessageRead@1` /
 *     `SessionMessageResponded@1` save the complete returned message metadata
 *     plus the real command actor/identity, so an idempotent replay can restore
 *     the ORIGINAL receipt through `eventAt` without re-deriving current state.
 *   - the two recipient lookup indexes are registered with the record codec;
 *     no hand-written SQL table or second index exists.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import { canonicalJson, canonicalOf, type JsonValue } from '../../../contracts/fingerprint.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import { DecisionSubjectShape } from '../../../contracts/goal-decisions.js';
import { MAX_AUTO_REWORK_LIMIT } from '../../../contracts/task-requeue.js';
import { defineShape, f, type InferShape } from '../../../contracts/data-format.js';
import {
  QueryJobRefShape, QueryRunRefShape, RunRefShape, SessionMessageRefShape, TaskTripleShape,
} from '../../../contracts/data-format-refs.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import {
  hasOnlyKeys, invalid, isPos, isRecord, nonEmpty, type UnknownRecord,
} from '../../../contracts/validation/common.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { parseJsonObject } from '../../record-store/record-codec.js';
import { dispatchBasisProblem } from '../model/message-payload.js';
import { checkArtifactRef, checkPlainSessionRef, checkSessionBody, isNonZeroPlatformCursor, isPlatformCursor } from './session-record-codecs.js';
import type { Slice1EventHeaderV1 } from './lifecycle-record-codecs.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { ArchiveStepRefV1 } from '../../../contracts/core/session-archive.js';
import { SESSION_REPLY_BY_HANDLER_LOOKUP } from '../model/session-facts-contracts.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import type { NoticeOriginWireV1 } from '../persistence/decision-record-codecs.js';
import { aggregateRefProblem } from '../persistence/decision-record-codecs.js';
import { encodeEventEnvelope } from '../persistence/event-envelope.js';
import { createEventCodec } from '../persistence/event-codec-factory.js';

/** Encoding selector for the persisted message record. */
export const SESSION_MESSAGE_SCHEMA_ID = 'SessionMessage@1';

/** Replay event selectors. Each event restores its original receipt. */
export const SESSION_MESSAGE_SENT_EVENT_TYPE = 'SessionMessageSent';
export const SESSION_MESSAGE_READ_EVENT_TYPE = 'SessionMessageRead';
export const SESSION_MESSAGE_RESPONDED_EVENT_TYPE = 'SessionMessageResponded';
export const SESSION_MESSAGE_DERIVATION_EVENT_TYPE = 'SessionMessageConsultationDerived';
export const SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE = 'SessionMessageInputAccepted';
/** Slice 5 replay event selectors (SPEC §2.3, §2.8). */
export const SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE = 'SessionMessageDecisionAnswered';
export const SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE = 'SessionMessageDecisionApplied';
/** Persisted lifecycle events; every one carries the full message snapshot. */
export const SESSION_MESSAGE_WITHDRAWN_EVENT_TYPE = 'SessionMessageWithdrawn';
export const SESSION_MESSAGE_RELEASE_DECIDED_EVENT_TYPE = 'SessionMessageReleaseDecided';
export const SESSION_MESSAGE_RELEASED_EVENT_TYPE = 'SessionMessageReleased';
export const SESSION_MESSAGE_APPLIED_EVENT_TYPE = 'SessionMessageApplied';
export const SESSION_MESSAGE_EXPIRED_EVENT_TYPE = 'SessionMessageExpired';
export const SESSION_MESSAGE_EVENT_SCHEMA_VERSION = 1;
/** Slice 1 §2.9: the wait-disposal replay event written by the mailbox owner. */
export const ARCHIVE_WAIT_DISPOSED_EVENT_TYPE = 'ArchiveWaitDisposed';

/** Registered lookup index names (`core/record-store/lookup-ports.ts`). */
export const SESSION_MESSAGE_BY_RECIPIENT_LOOKUP = 'session-message-by-recipient';
export const SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP = 'session-message-by-recipient-status';
/** The sender Work Run outbox index: complete scope + the nested RunRef. A host
 * sender has no `sender.runRef`, so its missing scalar paths are null and never
 * become a candidate of a concrete Run query. */
export const SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP = 'session-message-by-sender-run';
export const SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP = 'session-message-by-sender-session';
/** A secretary round's message root, ordered by the record's own creation time. */
export const SESSION_MESSAGE_BY_REQUEST_ROOT_LOOKUP = 'session-message-by-request-root';
/** Slice 5 decision indexes on the SAME SessionMessage aggregate codec (SPEC §2.5). */
export const S5_USER_MESSAGE_BY_GOAL = 's5-user-message-by-goal';
export const S5_MESSAGE_BY_WORKSPACE_STATUS = 's5-message-by-workspace-status';
export const S5_DECISION_ANSWER_BY_SOURCE = 's5-decision-answer-by-source';
/** Slice 2A L2: messages addressed to the user in one workspace. */
export const S2A_USER_MESSAGES_LOOKUP = 's2a-user-messages';
/** K3 L28: every decision answer of one source kind for one Goal (the UR7b index). */
export const K3_DECISION_ANSWER_BY_SOURCE_GOAL_LOOKUP = 'k3-decision-answer-by-source-goal';
/** Approved release candidates of one workspace, oldest approval first. */
export const S7A2_RELEASE_BY_WORKSPACE_LOOKUP = 's7a2-release-by-workspace';
/** The same, narrowed to one Goal. */
export const S7A2_RELEASE_BY_GOAL_LOOKUP = 's7a2-release-by-goal';
/** One source goal's person interventions in creation order (7a:619). */
export const S7A2_COPY_INTERVENTION_BY_GOAL_LOOKUP = 's7a2-copy-intervention-by-goal';
/** §3.3 item 3: one sender Session's released/open waits, oldest first. */
export const S7B_WAITS_BY_SENDER_SESSION_LOOKUP = 's7b-waits-by-sender-session';
/** §3.7 item 4: due waits of one workspace, earliest deadline first. */
export const S7B_DUE_WAITS_LOOKUP = 's7b-due-waits';

/**
 * Slice 5 notification origin wire (SPEC §2.5 line 289). The single
 * declaration lives in `persistence/rework-codecs.ts` and the single
 * `decodeNoticeOrigin` export lives in `persistence/decision-record-codecs.ts`
 * (A7); this module re-exports both for its historical importers. These are
 * OPTIONAL top-level wire fields, NOT part of the public `SessionMessage` DTO:
 * the record validator accepts them and `encodeSessionMessageRecord` writes
 * them through its optional `origin` parameter.
 */
export type { NoticeOriginWireV1 } from '../persistence/decision-record-codecs.js';
export { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';

/**
 * Fixed body contentType for the canonical JSON envelope:
 * `{schemaVersion:1, projectId, workspaceId, messageId, part, sender, text}`.
 * `scope+messageId+part` prevents independent messages from wrongly sharing
 * the first provenance record.
 */
export const SESSION_MESSAGE_CONTENT_TYPE = 'application/vnd.coding-platform.session-message+json';

/** Non-empty UTF-8 text, at most 16 KiB. Over-bound input returns `capacity`. */
export const SESSION_MESSAGE_MAX_TEXT_BYTES = 16 * 1024;

/** One recipient and one recipient+status candidate index (frozen paths). */
export const SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  { name: SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP, aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'sender.sessionRef.sessionId'] },
  {
    name: SESSION_MESSAGE_BY_RECIPIENT_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'recipient.sessionId'],
  },
  {
    name: SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'recipient.sessionId', 'status'],
  },
  {
    name: SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'sender.runRef.goalId', 'sender.runRef.runId'],
  },
  {
    name: SESSION_REPLY_BY_HANDLER_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'replyHandler.sessionRef.sessionId'],
  },
  {
    name: SESSION_MESSAGE_BY_REQUEST_ROOT_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['requestRoot.projectId', 'requestRoot.workspaceId', 'requestRoot.queryJobId'],
    orderBy: { path: 'createdAt', valueType: 'text' },
  },
];

/**
 * Slice 5 additive indexes (SPEC §2.5 table, lines 280-282), registered on the
 * SAME original SessionMessage aggregate codec — never a second registration.
 * Kept separate from `SESSION_MESSAGE_LOOKUP_INDEXES` so the frozen historical
 * constant (and its exact-shape test) stays byte-compatible.
 */
export const S5_SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  {
    name: S5_USER_MESSAGE_BY_GOAL,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'recipient.kind', 'goalRef.goalId'],
  },
  {
    name: S5_MESSAGE_BY_WORKSPACE_STATUS,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'status'],
  },
  {
    name: S5_DECISION_ANSWER_BY_SOURCE,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'decision.source.kind', 'decision.source.key'],
  },
];

/**
 * K3 L28 additive indexes: `k3-decision-answer-by-source-goal` lets the start-up
 * and UR7b reader find every card answer of one source kind in one Goal without
 * the slice-5 complete-source key. Kept separate so the frozen slice-5 constant
 * and its exact-shape test stay byte-compatible.
 */
export const K3_SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  {
    name: K3_DECISION_ANSWER_BY_SOURCE_GOAL_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'decision.source.kind', 'decision.source.subject.goalRef.goalId'],
  },
];

/**
 * Slice 2A L2 additive index (SPEC §1.1): the messages addressed to a user in a
 * workspace, registered on the SAME SessionMessage aggregate codec.
 */
export const S2A_SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  {
    name: S2A_USER_MESSAGES_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'recipient.kind'],
  },
];

export const S7A2_RELEASE_CANDIDATE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  { name: S7A2_RELEASE_BY_WORKSPACE_LOOKUP, aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'release'],
    orderBy: { path: 'approvedAt', valueType: 'text' } },
  { name: S7A2_RELEASE_BY_GOAL_LOOKUP, aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'release', 'goalRef.goalId'],
    orderBy: { path: 'approvedAt', valueType: 'text' } },
];

/** Additive index, registered on the SAME SessionMessage aggregate codec. */
export const S7A2_COPY_SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  { name: S7A2_COPY_INTERVENTION_BY_GOAL_LOOKUP, aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'goalRef.goalId', 'sender.actor.kind'],
    orderBy: { path: 'createdAt', valueType: 'text' } },
];

export const S7B_SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  { name: S7B_WAITS_BY_SENDER_SESSION_LOOKUP, aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'sender.sessionRef.sessionId', 'intent'], orderBy: { path: 'since', valueType: 'text' } },
  { name: S7B_DUE_WAITS_LOOKUP, aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'release', 'intent'], orderBy: { path: 'deadline', valueType: 'text' } },
];

// --------------------------------------------------------------------------
// Event bodies (stable replay carriers)
// --------------------------------------------------------------------------
// Declared in `model/communication-contracts.ts` so the model-layer write
// facade can name the union without a `model -> sessions` import; re-exported
// here for every existing importer (slice 5, SPEC §2.8).
export type {
  SessionMessageSentEventV1,
  SessionMessageReadEventV1,
  SessionMessageConsultationDerivedEventV1,
  SessionMessageInputAcceptedEventV1,
  SessionMessageRespondedEventV1,
  SessionMessageDecisionAnsweredEventV1,
  SessionMessageDecisionAppliedEventV1,
  SessionMessageWithdrawnEventV1,
  SessionMessageReleaseDecidedEventV1,
  SessionMessageReleasedEventV1,
  SessionMessageAppliedEventV1,
  SessionMessageExpiredEventV1,
  SessionMessageEventV1,
} from '../model/communication-contracts.js';
import type {
  SessionMessageSentEventV1,
  SessionMessageReadEventV1,
  SessionMessageConsultationDerivedEventV1,
  SessionMessageInputAcceptedEventV1,
  SessionMessageRespondedEventV1,
  SessionMessageDecisionAnsweredEventV1,
  SessionMessageDecisionAppliedEventV1,
  SessionMessageWithdrawnEventV1,
  SessionMessageReleaseDecidedEventV1,
  SessionMessageReleasedEventV1,
  SessionMessageAppliedEventV1,
  SessionMessageExpiredEventV1,
  SessionMessageEventV1,
} from '../model/communication-contracts.js';

/** Slice 1 (spec §2.9): one wait disposal. The header comes from the lifecycle
 * codec; the changed source Session makes its revision participate in the
 * actual guard. */
export type ArchiveWaitDisposedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'ArchiveWaitDisposed'; message: SessionMessage;
  source: SessionRecord; archiveStep: ArchiveStepRefV1;
};

/** §3.9 item 2: the old message's `transferredTo` update; the new message is in the same commit's Sent event. */
export const SESSION_MESSAGE_FORWARDED_EVENT_TYPE = 'SessionMessageForwarded';
/** §3.9 item 5: the person's `waits/dispose` record update (cancel or transfer). */
export const SESSION_MESSAGE_WAIT_DISPOSED_EVENT_TYPE = 'SessionMessageWaitDisposed';

export type SessionMessageForwardedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'SessionMessageForwarded'; message: SessionMessage; originalRef: SessionMessageRef;
};
export type SessionMessageWaitDisposedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'SessionMessageWaitDisposed'; message: SessionMessage;
  disposition: { mode: 'cancel' | 'transfer'; to: SessionRef | null };
};

// --------------------------------------------------------------------------
// Pure shape helpers
// --------------------------------------------------------------------------

/** `null` = the check passed; a string is the precise rejection reason. */
export type Problem = string | null;

/**
 * The seventeen lifecycle fields this shape can describe. `pins` and
 * `applicationProof` are NOT here: `pointerRevision: number | 'none'` and the
 * open `AggregateRef` of `effect.ref` are outside its closed kinds, so they keep
 * the named pure checks below. One fragment serves the record and the event's
 * full snapshot.
 */
export const SessionMessageFieldsShape = defineShape({ name: 'SessionMessageFields', fields: {
  taskRef: f.nullable(f.ref(TaskTripleShape)),
  requestRoot: f.nullable(f.ref(QueryJobRefShape)),
  followupOf: f.nullable(f.ref(SessionMessageRefShape)),
  deadline: f.nullable(f.isoTime()),
  deadlineMs: f.nullable(f.finite({ min: 0, minExclusive: true })),
  release: f.nullable(f.enumOf(['awaiting', 'approved', 'released', 'denied'] as const)),
  delivery: f.enumOf(['queued', 'delivered'] as const),
  deliveryEvidence: f.nullable(f.object({
    executionRef: f.union('aggregateType', { Run: RunRefShape.fields, QueryRun: QueryRunRefShape.fields }),
    acceptedAt: f.isoTime(),
  })),
  expiredAt: f.nullable(f.isoTime()),
  withdrawnAt: f.nullable(f.isoTime()),
  waitCancelledAt: f.nullable(f.isoTime()),
  transferredTo: f.nullable(f.ref(SessionMessageRefShape)),
  originalRef: f.nullable(f.ref(SessionMessageRefShape)),
  appliedAt: f.nullable(f.isoTime()),
  rejectedAt: f.nullable(f.isoTime()),
  approvedAt: f.nullable(f.isoTime()),
  approvalRevision: f.nullable(f.integer({ min: 1 })),
} });

/**
 * Checks the fragment's own keys; a missing required field reads
 * `<shape>.<field> is missing`. The four local types assert that the shape's
 * inferred type equals the record's picked fields.
 */
function messageFieldsProblem(body: UnknownRecord): Problem {
  type SessionMessageFields = InferShape<(typeof SessionMessageFieldsShape)['fields']>;
  type PickSessionMessageFields = Pick<SessionMessage,
    'taskRef' | 'requestRoot' | 'followupOf' | 'deadline' | 'deadlineMs' | 'release' | 'delivery'
    | 'deliveryEvidence' | 'expiredAt' | 'withdrawnAt' | 'waitCancelledAt' | 'transferredTo' | 'originalRef'
    | 'appliedAt' | 'rejectedAt' | 'approvedAt' | 'approvalRevision'>;
  type MustHold<T extends true> = T;
  type FieldsMatchRecord = MustHold<
    [SessionMessageFields, PickSessionMessageFields] extends [PickSessionMessageFields, SessionMessageFields] ? true : false
  >;
  const fields: UnknownRecord = {};
  for (const key of Object.keys(SessionMessageFieldsShape.fields)) {
    if (Object.hasOwn(body, key)) fields[key] = body[key];
  }
  return checkShape(SessionMessageFieldsShape, fields, 'stored');
}

const APPLICATION_PROOF_EFFECT_KINDS: readonly string[] = [
  'claim_created', 'proposal_created', 'requeue', 'recheck', 'member_created',
];

/**
 * `pins` is `DispatchBasisV1 | null` (`null` means none); a non-null basis is
 * checked by the payload model's one basis check.
 */
function messagePinsProblem(value: unknown): Problem {
  if (value === null) return null;
  const problem = dispatchBasisProblem(value);
  return problem === null ? null : `message pins ${problem}`;
}

/**
 * `applicationProof` carries the open `AggregateRef` of its effect, so its `ref`
 * is validated by the ONE aggregate-ref check (never a tag-only copy). The
 * release-decision owner validates the proof's party and deep decision rules;
 * this codec fixes only the slot.
 */
export function applicationProofProblem(value: unknown): Problem {
  if (value === null) return null;
  if (!isRecord(value) || !hasOnlyKeys(value, ['receipt', 'effect']) || Object.keys(value).length !== 2) {
    return 'application proof must carry exactly receipt and effect';
  }
  const receipt = value['receipt'];
  if (!isRecord(receipt) || !hasOnlyKeys(receipt, ['identityKey', 'fingerprint', 'cursor'])
    || Object.keys(receipt).length !== 3 || !nonEmpty(receipt['identityKey'])
    || !nonEmpty(receipt['fingerprint']) || !isPlatformCursor(receipt['cursor'])) {
    return 'application proof receipt must carry identityKey, fingerprint and a platform cursor';
  }
  const effect = value['effect'];
  if (!isRecord(effect) || !hasOnlyKeys(effect, ['kind', 'ref']) || Object.keys(effect).length !== 2) {
    return 'application proof effect must carry exactly kind and ref';
  }
  const kind = effect['kind'];
  if (typeof kind !== 'string' || !APPLICATION_PROOF_EFFECT_KINDS.includes(kind)) {
    return 'application proof effect kind is not recognized';
  }
  const refProblem = aggregateRefProblem(effect['ref']);
  if (refProblem !== null) return `application proof effect ref: ${refProblem}`;
  return null;
}

const SOURCE_KINDS: readonly string[] = ['plan-revision', 'workspace', 'governance', 'artifact', 'memory'];

export function checkSessionMessageRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])) {
    return 'message ref must be a complete SessionMessageRef';
  }
  if (value['aggregateType'] !== 'SessionMessage' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['messageId'])) {
    return 'message ref is not a valid SessionMessageRef';
  }
  return null;
}

export function checkSourceRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'refId', 'revision', 'digest'])) {
    return 'message source carries unknown fields';
  }
  if (!SOURCE_KINDS.includes(String(value['kind']))) return 'message source kind is not recognized';
  if (!nonEmpty(value['refId']) || !nonEmpty(value['revision'])) return 'message source requires refId and revision';
  if (value['digest'] !== undefined && !nonEmpty(value['digest'])) {
    return 'message source digest must be a non-empty string when present';
  }
  return null;
}

export function checkRoleBindingRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ['schemaVersion', 'bindingId', 'templateId', 'templateRevision', 'bindingVersion', 'policyRevision'])) {
    return 'role binding carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'role binding schemaVersion must be 1';
  if (!nonEmpty(value['bindingId']) || !nonEmpty(value['templateId']) || !nonEmpty(value['templateRevision'])
    || !isPos(value['bindingVersion']) || !nonEmpty(value['policyRevision'])) {
    return 'role binding is incomplete';
  }
  return null;
}

function checkRunRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])) {
    return 'message sender run ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'Run' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'message sender run ref is not a valid RunRef';
  }
  return null;
}

export function checkMessageSender(value: unknown): Problem {
  if (!isRecord(value)) return 'message sender must be an object';
  if (value['kind'] === 'host') {
    if (!hasOnlyKeys(value, ['kind', 'actor'])) return 'host sender carries unknown fields';
    const actor = value['actor'];
    if (!isRecord(actor) || !hasOnlyKeys(actor, ['kind', 'id'])) return 'host sender actor carries unknown fields';
    if ((actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
      return 'host sender actor must be a real human/system identity';
    }
    return null;
  }
  if (value['kind'] === 'work_run') {
    if (!hasOnlyKeys(value, ['kind', 'sessionRef', 'runRef', 'roleBinding', 'generation'])) {
      return 'work_run sender carries unknown fields';
    }
    const session = checkPlainSessionRef(value['sessionRef']);
    if (session !== null) return `work_run sender session: ${session}`;
    const run = checkRunRef(value['runRef']);
    if (run !== null) return `work_run sender run: ${run}`;
    const binding = checkRoleBindingRef(value['roleBinding']);
    if (binding !== null) return `work_run sender role: ${binding}`;
    if (!isPos(value['generation'])) return 'work_run sender generation must be a positive integer';
    return null;
  }
  if (value['kind'] === 'secretary_round') {
    if (!hasOnlyKeys(value, ['kind', 'sessionRef', 'queryRunRef', 'requestRoot', 'generation'])) {
      return 'secretary_round sender carries unknown fields';
    }
    const session = checkPlainSessionRef(value['sessionRef']);
    if (session !== null) return `secretary_round sender session: ${session}`;
    const run = checkQueryRunRef(value['queryRunRef']);
    if (run !== null) return `secretary_round sender run: ${run}`;
    const requestRoot = checkShape(QueryJobRefShape, value['requestRoot'], 'stored');
    if (requestRoot !== null) return `secretary_round sender requestRoot: ${requestRoot}`;
    if (!isPos(value['generation'])) return 'secretary_round sender generation must be a positive integer';
    return null;
  }
  return 'message sender kind must be host, work_run or secretary_round';
}

function checkQueryRunRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'runId'])) {
    return 'query_run sender run ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'QueryRun' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['queryJobId']) || !nonEmpty(value['runId'])) {
    return 'query_run sender run ref is not a valid QueryRunRef';
  }
  return null;
}

function checkQueryAnswerRef(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'answerId'])) {
    return 'query_run sender answer ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'QueryJobAnswer' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['queryJobId']) || !nonEmpty(value['answerId'])) {
    return 'query_run sender answer ref is not a valid QueryJobAnswerRef';
  }
  return null;
}

/** The derived formal Query Answer sender. It is never a caller-supplied text
 * author: every identity field is a persisted Query fact. */
export function checkQueryAnswerSender(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ['kind', 'sessionRef', 'queryRunRef', 'answerRef', 'generation'])) {
    return 'query_run sender carries unknown fields';
  }
  if (value['kind'] !== 'query_run') return 'query_run sender kind must be query_run';
  const session = checkPlainSessionRef(value['sessionRef']);
  if (session !== null) return `query_run sender session: ${session}`;
  const run = checkQueryRunRef(value['queryRunRef']);
  if (run !== null) return `query_run sender run: ${run}`;
  const answer = checkQueryAnswerRef(value['answerRef']);
  if (answer !== null) return `query_run sender answer: ${answer}`;
  if (!isPos(value['generation'])) return 'query_run sender generation must be a positive integer';
  return null;
}

/** A response slot accepts the original work_run reply or the derived
 * query_run Answer reply. The message `sender` itself stays host/work_run. */
export function checkResponseSender(value: unknown): Problem {
  if (!isRecord(value)) return 'message response sender must be an object';
  if (value['kind'] === 'query_run') return checkQueryAnswerSender(value);
  const workRun = checkMessageSender(value);
  if (workRun !== null) return workRun;
  if (value['kind'] !== 'work_run') return 'message response sender must be a work_run or query_run sender';
  return null;
}

// --------------------------------------------------------------------------
// Slice 5 additive shapes (SPEC §2.3): user recipient, goalRef, decision
// metadata, application and the widened user response. Pure shape checks only.
// --------------------------------------------------------------------------

function checkGoalRefShape(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId'])) {
    return 'goal ref must be a GoalRef';
  }
  if (value['aggregateType'] !== 'Goal' || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])) {
    return 'goal ref is not a valid GoalRef';
  }
  return null;
}

function checkWorkspaceRefShape(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId'])) {
    return 'workspace ref must be a WorkspaceRef';
  }
  if (value['aggregateType'] !== 'Workspace' || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) {
    return 'workspace ref is not a valid WorkspaceRef';
  }
  return null;
}

function checkPlanRevisionRefShape(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'planId'])) {
    return 'plan revision ref must be a PlanRevisionRef';
  }
  if (value['aggregateType'] !== 'PlanRevision' || !nonEmpty(value['projectId']) || !nonEmpty(value['planId'])) {
    return 'plan revision ref is not a valid PlanRevisionRef';
  }
  return null;
}

function checkVersionPinShape(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['ref', 'revision'])) return 'version pin must carry ref and revision';
  const refProblem = aggregateRefProblem(value['ref']);
  if (refProblem !== null) return refProblem;
  const revision = value['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return 'version pin revision must be a non-negative integer';
  }
  return null;
}

function checkVersionPinList(value: unknown): Problem {
  if (!Array.isArray(value)) return 'version pins must be an array';
  for (const pin of value) {
    const problem = checkVersionPinShape(pin);
    if (problem !== null) return problem;
  }
  return null;
}

function checkGoalSettingsShape(value: unknown): Problem {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'autonomy', 'order', 'waitForGoalRef', 'parallelRisks'])) {
    return 'goal settings carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'goal settings schemaVersion must be 1';
  if (value['autonomy'] !== 'every_step' && value['autonomy'] !== 'after_plan_confirmation') {
    return 'goal settings autonomy is not recognized';
  }
  const order = value['order'];
  if (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0) {
    return 'goal settings order must be a non-negative integer';
  }
  if (value['waitForGoalRef'] !== null) {
    const wait = checkGoalRefShape(value['waitForGoalRef']);
    if (wait !== null) return `goal settings waitForGoalRef: ${wait}`;
  }
  const risks = value['parallelRisks'];
  if (!Array.isArray(risks)) return 'goal settings parallelRisks must be an array';
  for (const risk of risks) {
    if (!isRecord(risk) || !hasOnlyKeys(risk, ['otherGoalRef', 'selfPlanRef', 'otherPlanRef'])) {
      return 'goal settings parallel risk carries unknown fields';
    }
    const other = checkGoalRefShape(risk['otherGoalRef']);
    if (other !== null) return `goal settings parallel risk otherGoalRef: ${other}`;
    for (const key of ['selfPlanRef', 'otherPlanRef']) {
      if (risk[key] !== null) {
        const plan = checkPlanRevisionRefShape(risk[key]);
        if (plan !== null) return `goal settings parallel risk ${key}: ${plan}`;
      }
    }
  }
  return null;
}

function checkGoalDecisionBasisShape(value: unknown): Problem {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['goalRef', 'workspaceRef', 'objective', 'activePlanRef', 'settings'])) {
    return 'goal decision basis carries unknown fields';
  }
  const goal = checkGoalRefShape(value['goalRef']);
  if (goal !== null) return `goal decision basis goalRef: ${goal}`;
  const workspace = checkWorkspaceRefShape(value['workspaceRef']);
  if (workspace !== null) return `goal decision basis workspaceRef: ${workspace}`;
  if (!nonEmpty(value['objective'])) return 'goal decision basis requires objective';
  if (value['activePlanRef'] !== null) {
    const plan = checkPlanRevisionRefShape(value['activePlanRef']);
    if (plan !== null) return `goal decision basis activePlanRef: ${plan}`;
  }
  const settings = checkGoalSettingsShape(value['settings']);
  if (settings !== null) return `goal decision basis settings: ${settings}`;
  return null;
}

function checkGoalControlRebaseShape(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['captured', 'actualBefore', 'basis'])) {
    return 'goal control rebase carries unknown fields';
  }
  const captured = checkVersionPinShape(value['captured']);
  if (captured !== null) return `goal control rebase captured: ${captured}`;
  const actual = checkVersionPinShape(value['actualBefore']);
  if (actual !== null) return `goal control rebase actualBefore: ${actual}`;
  const basis = checkGoalDecisionBasisShape(value['basis']);
  if (basis !== null) return `goal control rebase basis: ${basis}`;
  return null;
}

function checkDecisionAnnotationShape(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['objectKey', 'text'])) {
    return 'decision annotation carries unknown fields';
  }
  if (!nonEmpty(value['objectKey']) || typeof value['text'] !== 'string') {
    return 'decision annotation requires objectKey and text';
  }
  return null;
}

function checkDecisionObjectShape(value: unknown): Problem {
  if (!isRecord(value)) return 'decision object must be an object';
  if (value['kind'] === 'aggregate') {
    if (!hasOnlyKeys(value, ['kind', 'pin', 'label'])) return 'aggregate decision object carries unknown fields';
    const pin = checkVersionPinShape(value['pin']);
    if (pin !== null) return `aggregate decision object pin: ${pin}`;
    if (!nonEmpty(value['label'])) return 'aggregate decision object requires label';
    return null;
  }
  if (value['kind'] === 'file') {
    if (!hasOnlyKeys(value, ['kind', 'workspace', 'path', 'digest', 'label'])) {
      return 'file decision object carries unknown fields';
    }
    const workspace = value['workspace'];
    if (!isRecord(workspace) || !hasOnlyKeys(workspace, ['projectId', 'workspaceId'])
      || !nonEmpty(workspace['projectId']) || !nonEmpty(workspace['workspaceId'])) {
      return 'file decision object workspace must be a WorkspaceScope';
    }
    if (!nonEmpty(value['path']) || !nonEmpty(value['label'])) return 'file decision object requires path and label';
    if (value['digest'] !== null && !nonEmpty(value['digest'])) {
      return 'file decision object digest must be null or a non-empty string';
    }
    return null;
  }
  return 'decision object kind is not recognized';
}

function checkDecisionOptionShape(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'label', 'effect'])) {
    return 'decision option carries unknown fields';
  }
  if (!nonEmpty(value['id']) || !nonEmpty(value['label'])) return 'decision option requires id and label';
  if (value['effect'] !== 'apply' && value['effect'] !== 'reject' && value['effect'] !== 'defer') {
    return 'decision option effect is not recognized';
  }
  return null;
}

const DECISION_SOURCE_KINDS: readonly string[] = [
  'message', 'goal_cause', 'candidate', 'note_review', 'planning_question', 'goal_conflict', 'message_release',
  'unknown_call_review', 'command_rerun_request',
];

function checkDecisionSourceShape(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'key', 'subject', 'pins', 'goalBases'])) {
    return 'decision source carries unknown fields';
  }
  if (!DECISION_SOURCE_KINDS.includes(String(value['kind']))) return 'decision source kind is not recognized';
  if (!nonEmpty(value['key'])) return 'decision source requires a non-empty key';
  const subject = checkShape(DecisionSubjectShape, { subject: value['subject'] }, 'stored');
  if (subject !== null) return `decision source subject: ${subject}`;
  const pins = checkVersionPinList(value['pins']);
  if (pins !== null) return `decision source pins: ${pins}`;
  const bases = value['goalBases'];
  if (bases !== undefined) {
    if (!Array.isArray(bases)) return 'decision source goalBases must be an array';
    for (const basis of bases) {
      const problem = checkGoalDecisionBasisShape(basis);
      if (problem !== null) return `decision source goalBases: ${problem}`;
    }
  }
  return null;
}

function checkDecisionSelectionShape(value: unknown): Problem {
  if (!isRecord(value)) return 'decision selection must be an object';
  switch (value['kind']) {
    case 'option':
      if (!hasOnlyKeys(value, ['kind', 'optionId']) || !nonEmpty(value['optionId'])) {
        return 'option decision selection requires optionId';
      }
      return null;
    case 'other':
      return hasOnlyKeys(value, ['kind']) ? null : 'other decision selection carries unknown fields';
    case 'conflict_wait':
    case 'conflict_parallel': {
      if (!hasOnlyKeys(value, ['kind', 'earlier', 'later'])) return 'conflict decision selection carries unknown fields';
      const earlier = checkGoalRefShape(value['earlier']);
      if (earlier !== null) return `conflict decision selection earlier: ${earlier}`;
      const later = checkGoalRefShape(value['later']);
      if (later !== null) return `conflict decision selection later: ${later}`;
      return null;
    }
    case 'conflict_order': {
      if (!hasOnlyKeys(value, ['kind', 'goalOrder'])) return 'conflict order selection carries unknown fields';
      const order = value['goalOrder'];
      if (!Array.isArray(order)) return 'conflict order selection goalOrder must be an array';
      for (const goal of order) {
        const problem = checkGoalRefShape(goal);
        if (problem !== null) return `conflict order selection goalOrder: ${problem}`;
      }
      return null;
    }
    default:
      return 'decision selection kind is not recognized';
  }
}

function checkActorRefShape(value: unknown): Problem {
  if (!isRecord(value)) return 'actor must be an object';
  if (value['kind'] === 'human' || value['kind'] === 'system') {
    if (!hasOnlyKeys(value, ['kind', 'id'])) return 'actor carries unknown fields';
    return nonEmpty(value['id']) ? null : 'actor requires a non-empty id';
  }
  if (value['kind'] === 'agent') {
    if (!hasOnlyKeys(value, ['kind', 'id', 'runRef'])) return 'agent actor carries unknown fields';
    if (!nonEmpty(value['id'])) return 'agent actor requires a non-empty id';
    return checkRunRef(value['runRef']);
  }
  return 'actor kind is not recognized';
}

function checkDecisionMessageMetadataShape(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ['schemaVersion', 'source', 'objects', 'options', 'syntheticAnswer', 'forwardedFrom'])) {
    return 'decision metadata carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'decision metadata schemaVersion must be 1';
  const source = checkDecisionSourceShape(value['source']);
  if (source !== null) return `decision metadata source: ${source}`;
  const objects = value['objects'];
  if (!Array.isArray(objects)) return 'decision metadata objects must be an array';
  for (const object of objects) {
    const problem = checkDecisionObjectShape(object);
    if (problem !== null) return `decision metadata objects: ${problem}`;
  }
  const options = value['options'];
  if (!Array.isArray(options)) return 'decision metadata options must be an array';
  for (const option of options) {
    const problem = checkDecisionOptionShape(option);
    if (problem !== null) return `decision metadata options: ${problem}`;
  }
  if (typeof value['syntheticAnswer'] !== 'boolean') return 'decision metadata syntheticAnswer must be boolean';
  if (value['forwardedFrom'] !== null) {
    const forwarded = checkSessionMessageRef(value['forwardedFrom']);
    if (forwarded !== null) return `decision metadata forwardedFrom: ${forwarded}`;
  }
  return null;
}

function checkDecisionApplicationShape(value: unknown): Problem {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'actor', 'appliedAt', 'receipt', 'changes', 'basisRebases'])) {
    return 'decision application carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'decision application schemaVersion must be 1';
  const actor = checkActorRefShape(value['actor']);
  if (actor !== null) return `decision application actor: ${actor}`;
  if (!nonEmpty(value['appliedAt'])) return 'decision application requires appliedAt';
  const receipt = value['receipt'];
  if (!isRecord(receipt) || !hasOnlyKeys(receipt, ['identityKey', 'fingerprint', 'cursor'])
    || !nonEmpty(receipt['identityKey']) || !nonEmpty(receipt['fingerprint']) || !isPlatformCursor(receipt['cursor'])) {
    return 'decision application receipt is incomplete';
  }
  const changes = value['changes'];
  if (!Array.isArray(changes)) return 'decision application changes must be an array';
  for (const change of changes) {
    if (!isRecord(change) || !hasOnlyKeys(change, ['before', 'after'])) {
      return 'decision application change carries unknown fields';
    }
    const before = checkVersionPinShape(change['before']);
    if (before !== null) return `decision application change before: ${before}`;
    const after = checkVersionPinShape(change['after']);
    if (after !== null) return `decision application change after: ${after}`;
  }
  const rebases = value['basisRebases'];
  if (rebases !== undefined) {
    if (!Array.isArray(rebases)) return 'decision application basisRebases must be an array';
    for (const rebase of rebases) {
      const problem = checkGoalControlRebaseShape(rebase);
      if (problem !== null) return `decision application basisRebases: ${problem}`;
    }
  }
  return null;
}

/** A user recipient is a workspace address, never a fabricated Session. */
function checkMessageRecipientShape(value: unknown): Problem {
  if (isRecord(value) && value['kind'] === 'user') {
    if (!hasOnlyKeys(value, ['kind', 'projectId', 'workspaceId'])) return 'user recipient carries unknown fields';
    if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) {
      return 'user recipient requires projectId and workspaceId';
    }
    return null;
  }
  return checkPlainSessionRef(value);
}

/** The user answer's response slot: trusted Host sender plus the answer decision. */
function checkUserMessageResponse(value: UnknownRecord): Problem {
  if (!hasOnlyKeys(value, ['sender', 'bodyRef', 'sourceRef', 'respondedAt', 'decision'])) {
    return 'user message response carries unknown fields';
  }
  const sender = checkMessageSender(value['sender']);
  if (sender !== null) return `user message response sender: ${sender}`;
  if (!isRecord(value['sender']) || value['sender']['kind'] !== 'host') {
    return 'user message response sender must be the trusted Host identity';
  }
  const body = checkArtifactRef(value['bodyRef']);
  if (body !== null) return `user message response body: ${body}`;
  const source = checkSourceRef(value['sourceRef']);
  if (source !== null) return `user message response source: ${source}`;
  if (!nonEmpty(value['respondedAt'])) return 'user message response requires respondedAt';
  const decision = value['decision'];
  if (!isRecord(decision)
    || !hasOnlyKeys(decision, ['selection', 'source', 'annotations', 'requiresApplication'])) {
    return 'user message response decision carries unknown fields';
  }
  const selection = checkDecisionSelectionShape(decision['selection']);
  if (selection !== null) return `user message response selection: ${selection}`;
  const decisionSource = checkDecisionSourceShape(decision['source']);
  if (decisionSource !== null) return `user message response decision source: ${decisionSource}`;
  const annotations = decision['annotations'];
  if (!Array.isArray(annotations)) return 'user message response annotations must be an array';
  for (const annotation of annotations) {
    const problem = checkDecisionAnnotationShape(annotation);
    if (problem !== null) return `user message response annotations: ${problem}`;
  }
  if (typeof decision['requiresApplication'] !== 'boolean') {
    return 'user message response requiresApplication must be boolean';
  }
  return null;
}

function checkMessageResponse(value: unknown): Problem {
  // Slice 5: the presence of `decision` selects the widened user-answer variant.
  if (isRecord(value) && 'decision' in value) return checkUserMessageResponse(value);
  if (!isRecord(value) || !hasOnlyKeys(value, ['sender', 'bodyRef', 'sourceRef', 'respondedAt', 'reject', 'reason'])) {
    return 'message response carries unknown fields';
  }
  const sender = checkResponseSender(value['sender']);
  if (sender !== null) return `message response sender: ${sender}`;
  const body = checkArtifactRef(value['bodyRef']);
  if (body !== null) return `message response body: ${body}`;
  const source = checkSourceRef(value['sourceRef']);
  if (source !== null) return `message response source: ${source}`;
  if (!nonEmpty(value['respondedAt'])) return 'message response requires respondedAt';
  // The refusal branch is the pair; a plain reply has neither key (never one alone).
  const hasReject = Object.hasOwn(value, 'reject');
  const hasReason = Object.hasOwn(value, 'reason');
  if (hasReject !== hasReason) return 'message response reject and reason must be present together';
  if (hasReject) {
    if (value['reject'] !== true) return 'message response reject must be true';
    if (!nonEmpty(value['reason'])) return 'message response reason must be a non-empty string';
  }
  return null;
}

const MESSAGE_KEYS: readonly string[] = [
  'ref', 'schemaVersion', 'revision', 'sender', 'recipient', 'bodyRef', 'sourceRef',
  'createdAt', 'status', 'readAt', 'response',
  'intent', 'needsReply', 'waitAfterSend', 'consultationDerivation', 'acceptedInputs',
  'replyHandler', 'archiveWaitDisposition',
  // Slice 5 additive fields (SPEC §2.3, §2.5).
  'goalRef', 'decision', 'application', 'since', 'noticeAutomationCap',
  // Wiring package 2 (spec §2.3 P02): the first-response commit position.
  'responseSince',
  // Lifecycle fields; appended so the historical key order stays intact.
  'taskRef', 'requestRoot', 'followupOf', 'deadline', 'deadlineMs', 'release', 'delivery',
  'deliveryEvidence', 'expiredAt', 'withdrawnAt', 'waitCancelledAt', 'transferredTo', 'originalRef',
  'appliedAt', 'rejectedAt', 'approvedAt', 'approvalRevision', 'applicationProof', 'pins',
];

/** Slice 1 §2.5: the effective reply handler of a wait; absent reads as null. A person's transfer carries no archive pair. */
function checkReplyHandler(value: unknown, path: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['sessionRef', 'archiveSessionRef', 'archiveRequestId', 'changedAt'])) {
    return `${path} carries unknown fields`;
  }
  const session = checkPlainSessionRef(value['sessionRef']);
  if (session !== null) return `${path}.sessionRef: ${session}`;
  const archiveSession = value['archiveSessionRef'];
  if (archiveSession !== undefined) {
    const problem = checkPlainSessionRef(archiveSession);
    if (problem !== null) return `${path}.archiveSessionRef: ${problem}`;
  }
  const archiveRequestId = value['archiveRequestId'];
  if (archiveRequestId !== undefined && !nonEmpty(archiveRequestId)) {
    return `${path}.archiveRequestId is required when present`;
  }
  if (!nonEmpty(value['changedAt'])) return `${path}.changedAt is required`;
  return null;
}

/** Slice 1 §2.5: the recorded disposal of a wait during an archive; absent reads as null. */
function checkArchiveWaitDisposition(value: unknown, path: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'runRef', 'archiveSessionRef', 'archiveRequestId', 'recordedAt'])) {
    return `${path} carries unknown fields`;
  }
  if (value['kind'] !== 'cancel' && value['kind'] !== 'transfer') return `${path}.kind is not recognized`;
  const run = checkRunRef(value['runRef']);
  if (run !== null) return `${path}.runRef: ${run}`;
  const archiveSession = checkPlainSessionRef(value['archiveSessionRef']);
  if (archiveSession !== null) return `${path}.archiveSessionRef: ${archiveSession}`;
  if (!nonEmpty(value['archiveRequestId'])) return `${path}.archiveRequestId is required`;
  if (!nonEmpty(value['recordedAt'])) return `${path}.recordedAt is required`;
  return null;
}

export function checkSessionMessageBody(body: UnknownRecord, requireBoundResponseSince = false): Problem {
  if (!hasOnlyKeys(body, MESSAGE_KEYS)) return 'SessionMessage record carries unknown fields';
  const ref = checkSessionMessageRef(body['ref']);
  if (ref !== null) return ref;
  if (body['schemaVersion'] !== 1) return 'SessionMessage schemaVersion must be 1';
  if (!isPos(body['revision'])) return 'SessionMessage revision must be a positive integer';
  const sender = checkMessageSender(body['sender']);
  if (sender !== null) return `SessionMessage sender: ${sender}`;
  const recipient = checkMessageRecipientShape(body['recipient']);
  if (recipient !== null) return `SessionMessage recipient: ${recipient}`;
  const bodyRef = checkArtifactRef(body['bodyRef']);
  if (bodyRef !== null) return `SessionMessage body: ${bodyRef}`;
  const source = checkSourceRef(body['sourceRef']);
  if (source !== null) return `SessionMessage source: ${source}`;
  if (!nonEmpty(body['createdAt'])) return 'SessionMessage requires createdAt';
  const status = body['status'];
  if (status !== 'pending' && status !== 'read' && status !== 'responded') {
    return 'SessionMessage status is not recognized';
  }
  const readAt = body['readAt'];
  if (!(readAt === null || nonEmpty(readAt))) return 'SessionMessage readAt must be null or a non-empty string';
  const intent = body['intent'];
  if (intent !== undefined && intent !== 'notify' && intent !== 'inquiry'
    && intent !== 'action_request' && intent !== 'decision_request') {
    return 'SessionMessage intent is not recognized';
  }
  if (body['needsReply'] !== undefined && typeof body['needsReply'] !== 'boolean') return 'SessionMessage needsReply must be boolean';
  if (body['waitAfterSend'] !== undefined && typeof body['waitAfterSend'] !== 'boolean') return 'SessionMessage waitAfterSend must be boolean';
  if (body['waitAfterSend'] === true && body['needsReply'] === false) {
    return 'SessionMessage waitAfterSend cannot be set while needsReply is false';
  }
  const acceptedInputs = body['acceptedInputs'];
  if (acceptedInputs !== undefined) {
    if (!Array.isArray(acceptedInputs)) return 'SessionMessage acceptedInputs must be an array';
    for (const entry of acceptedInputs) {
      if (!isRecord(entry) || !hasOnlyKeys(entry, ['inputId', 'part', 'executionRef', 'kernel', 'acceptedAt', 'evidence', 'consumesWait'])) {
        return 'SessionMessage acceptedInputs entry carries unknown fields';
      }
      if (!nonEmpty(entry['inputId'])
        || (entry['part'] !== 'message' && entry['part'] !== 'response' && entry['part'] !== 'expiry')) {
        return 'SessionMessage acceptedInputs entry identity is invalid';
      }
      if (entry['evidence'] !== 'input_accepted' && entry['evidence'] !== 'query_entered') {
        return 'SessionMessage acceptedInputs evidence is invalid';
      }
      if (typeof entry['consumesWait'] !== 'boolean') return 'SessionMessage acceptedInputs consumesWait must be boolean';
      const executionRef = entry['executionRef'];
      if (!isRecord(executionRef) || !['Run', 'QueryRun'].includes(String(executionRef['aggregateType']))) {
        return 'SessionMessage acceptedInputs executionRef must be a RunRef or QueryRunRef';
      }
      const kernel = entry['kernel'];
      if (!isRecord(kernel) || !hasOnlyKeys(kernel, ['adapterId', 'kernelSessionId', 'runId', 'turnId', 'position'])
        || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId']) || !nonEmpty(kernel['runId'])
        || !nonEmpty(kernel['turnId']) || !isPos(kernel['position'])) {
        return 'SessionMessage acceptedInputs kernel identity is incomplete';
      }
      if (!nonEmpty(entry['acceptedAt'])) return 'SessionMessage acceptedInputs acceptedAt is required';
    }
  }
  const derivation = body['consultationDerivation'];
  if (derivation !== undefined) {
    if (!isRecord(derivation)
      || !hasOnlyKeys(derivation, ['childSessionRef', 'sourceSessionRef', 'sourceKernel', 'throughPosition'])) {
      return 'SessionMessage consultationDerivation carries unknown fields';
    }
    const child = derivation['childSessionRef'];
    const source = derivation['sourceSessionRef'];
    if (checkPlainSessionRef(child) !== null || checkPlainSessionRef(source) !== null) {
      return 'SessionMessage consultationDerivation Session refs are incomplete';
    }
    const kernel = derivation['sourceKernel'];
    if (!isRecord(kernel) || !hasOnlyKeys(kernel, ['adapterId', 'kernelSessionId'])
      || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId'])) {
      return 'SessionMessage consultationDerivation sourceKernel is incomplete';
    }
    const through = derivation['throughPosition'];
    if (!(through === null || (typeof through === 'number' && Number.isSafeInteger(through) && through >= 1))) {
      return 'SessionMessage consultationDerivation throughPosition is invalid';
    }
  }
  const response = body['response'];
  if (response !== null) {
    const responseProblem = checkMessageResponse(response);
    if (responseProblem !== null) return `SessionMessage response: ${responseProblem}`;
  }
  const replyHandler = body['replyHandler'];
  if (replyHandler !== undefined && replyHandler !== null) {
    const problem = checkReplyHandler(replyHandler, 'SessionMessage.replyHandler');
    if (problem !== null) return problem;
    if (isRecord(body['ref']) && isRecord(replyHandler)
      && (replyHandler['sessionRef'] as Record<string, unknown>)['projectId'] !== body['ref']['projectId']) {
      return 'SessionMessage replyHandler belongs to another project';
    }
  }
  const archiveWaitDisposition = body['archiveWaitDisposition'];
  if (archiveWaitDisposition !== undefined && archiveWaitDisposition !== null) {
    const problem = checkArchiveWaitDisposition(archiveWaitDisposition, 'SessionMessage.archiveWaitDisposition');
    if (problem !== null) return problem;
    if (isRecord(body['ref']) && isRecord(archiveWaitDisposition)
      && (archiveWaitDisposition['archiveSessionRef'] as Record<string, unknown>)['projectId'] !== body['ref']['projectId']) {
      return 'SessionMessage archiveWaitDisposition belongs to another project';
    }
  }
  // Slice 5 additive fields (SPEC §2.3): `goalRef` is REQUIRED and null is legal.
  if (!Object.hasOwn(body, 'goalRef')) return 'SessionMessage.goalRef is missing';
  const goalRef = body['goalRef'];
  if (goalRef !== null) {
    const goalRefProblem = checkGoalRefShape(goalRef);
    if (goalRefProblem !== null) return `SessionMessage goalRef: ${goalRefProblem}`;
  }
  const decision = body['decision'];
  if (decision !== undefined) {
    const decisionProblem = checkDecisionMessageMetadataShape(decision);
    if (decisionProblem !== null) return `SessionMessage decision: ${decisionProblem}`;
  }
  const application = body['application'];
  if (application !== undefined && application !== null) {
    const applicationProblem = checkDecisionApplicationShape(application);
    if (applicationProblem !== null) return `SessionMessage application: ${applicationProblem}`;
  }
  const since = body['since'];
  if (since !== undefined && since !== null && !isPlatformCursor(since)) {
    return 'SessionMessage since must be null or a ledger commit cursor';
  }
  // Wiring package 2 (spec §2.3 P02): a saved reply position is either absent
  // (other senders / legacy) or a real platform cursor; the explicit `null`
  // placeholder is legal only in an EVENT body, bound by the same commit.
  const responseSince = body['responseSince'];
  if (responseSince !== undefined) {
    if (responseSince === null) {
      if (requireBoundResponseSince) return 'SessionMessage responseSince must be bound to a real commit cursor';
    } else if (!isNonZeroPlatformCursor(responseSince)) {
      return 'SessionMessage responseSince must be a nonzero ledger commit cursor';
    }
    const senderValue = body['sender'];
    if (!isRecord(senderValue)
      || (senderValue['kind'] !== 'work_run' && senderValue['kind'] !== 'secretary_round')) {
      return 'SessionMessage responseSince requires a work_run or secretary_round sender';
    }
    if (body['response'] === null) return 'SessionMessage responseSince requires a saved response';
  }
  const noticeAutomationCap = body['noticeAutomationCap'];
  if (noticeAutomationCap !== undefined
    && (typeof noticeAutomationCap !== 'number' || !Number.isSafeInteger(noticeAutomationCap)
      || noticeAutomationCap < 0 || noticeAutomationCap > MAX_AUTO_REWORK_LIMIT)) {
    return `SessionMessage noticeAutomationCap must be an integer between 0 and ${MAX_AUTO_REWORK_LIMIT}`;
  }
  // The fragment checks only its own keys; the two open fields keep named checks.
  const fieldsProblem = messageFieldsProblem(body);
  if (fieldsProblem !== null) return `SessionMessage fields: ${fieldsProblem}`;
  if (!Object.hasOwn(body, 'pins')) return 'SessionMessage.pins is missing';
  const pinsProblem = messagePinsProblem(body['pins']);
  if (pinsProblem !== null) return `SessionMessage pins: ${pinsProblem}`;
  if (!Object.hasOwn(body, 'applicationProof')) return 'SessionMessage.applicationProof is missing';
  const proofProblem = applicationProofProblem(body['applicationProof']);
  if (proofProblem !== null) return `SessionMessage applicationProof: ${proofProblem}`;
  // The status/readAt/response triple is monotone and consistent.
  if (status === 'pending' && (readAt !== null || response !== null)) {
    return 'a pending message must be unread and unanswered';
  }
  if (status === 'read' && (readAt === null || response !== null)) {
    return 'a read message must carry readAt and no response';
  }
  if (status === 'responded' && response === null) {
    return 'a responded message must carry a response';
  }
  if (isRecord(body['ref']) && isRecord(body['recipient'])
    && body['recipient']['projectId'] !== body['ref']['projectId']) {
    return 'SessionMessage recipient belongs to another project';
  }
  return null;
}

const EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'requestId', 'actor', 'message',
];
/** Only the release decision carries the proof; every other event must not. */
const EVENT_PROOF_KEYS: readonly string[] = [...EVENT_KEYS, 'proof'];

function checkEventBody(body: UnknownRecord, eventType: string): Problem {
  const allowedKeys = eventType === SESSION_MESSAGE_RELEASE_DECIDED_EVENT_TYPE ? EVENT_PROOF_KEYS : EVENT_KEYS;
  if (!hasOnlyKeys(body, allowedKeys)) return `${eventType} carries unknown fields`;
  if (eventType === SESSION_MESSAGE_RELEASE_DECIDED_EVENT_TYPE) {
    if (!Object.hasOwn(body, 'proof')) return `${eventType} requires proof`;
    const proof = body['proof'];
    // The release-decision owner validates the proof's contents; the codec only fixes the slot.
    if (proof !== null && !isRecord(proof)) return `${eventType} proof must be null or an object`;
  }
  if (body['eventType'] !== eventType) return `${eventType} eventType disagrees with the envelope`;
  if (body['schemaVersion'] !== SESSION_MESSAGE_EVENT_SCHEMA_VERSION) {
    return `${eventType} schemaVersion must be ${SESSION_MESSAGE_EVENT_SCHEMA_VERSION}`;
  }
  if (!nonEmpty(body['eventId']) || !nonEmpty(body['occurredAt'])) return `${eventType} envelope is incomplete`;
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId']) || !nonEmpty(body['requestId'])) {
    return `${eventType} requires projectId, workspaceId and requestId`;
  }
  // A Host actor on SessionMessageResponded is shape-checked as a
  // Host sender here and admitted below only for a user decision card answer.
  const actor = eventType === SESSION_MESSAGE_RESPONDED_EVENT_TYPE
    ? (isRecord(body['actor']) && body['actor']['kind'] === 'host'
      ? checkMessageSender(body['actor'])
      : checkResponseSender(body['actor']))
    : eventType === SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE
      ? checkActorRefShape(body['actor'])
      : checkMessageSender(body['actor']);
  if (actor !== null) return `${eventType} actor: ${actor}`;
  const message = body['message'];
  if (!isRecord(message)) return `${eventType} requires the complete message`;
  const messageProblem = checkSessionMessageBody(message);
  if (messageProblem !== null) return `${eventType} message: ${messageProblem}`;
  if (!isRecord(message['ref'])) return `${eventType} message ref is invalid`;
  if (message['ref']['projectId'] !== body['projectId'] || message['ref']['workspaceId'] !== body['workspaceId']) {
    return `${eventType} message scope disagrees with the event scope`;
  }
  if (eventType === SESSION_MESSAGE_SENT_EVENT_TYPE
    && canonicalOf(body['actor']) !== canonicalOf(message['sender'])) {
    return 'SessionMessageSent actor must be the message sender';
  }
  if (eventType === SESSION_MESSAGE_READ_EVENT_TYPE
    && (!isRecord(body['actor']) || body['actor']['kind'] !== 'work_run')) {
    return `${eventType} actor must be the formal work_run command identity`;
  }
  if (eventType === SESSION_MESSAGE_DERIVATION_EVENT_TYPE
    && (!isRecord(body['actor']) || body['actor']['kind'] !== 'host')) {
    return `${eventType} actor must be the trusted Host identity`;
  }
  if (eventType === SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE
    && (!isRecord(body['actor']) || (body['actor']['kind'] !== 'work_run' && body['actor']['kind'] !== 'host'))) {
    return `${eventType} actor must be the observing Host or executing work_run identity`;
  }
  if (eventType === SESSION_MESSAGE_RESPONDED_EVENT_TYPE) {
    const actorKind = isRecord(body['actor']) ? body['actor']['kind'] : undefined;
    // Slice 5 §2.3: the configured operator
    // answering a user decision card writes the original single response slot
    // with `SessionMessageResponded`; its actor is the trusted Host. Only a
    // user-recipient message whose response carries the decision metadata
    // admits it; every old Session reply keeps the work_run/query_run rule.
    const userDecisionAnswer = actorKind === 'host'
      && isRecord(message['recipient']) && message['recipient']['kind'] === 'user'
      && isRecord(message['response']) && isRecord(message['response']['decision']);
    if (actorKind !== 'work_run' && actorKind !== 'query_run' && !userDecisionAnswer) {
      return `${eventType} actor must be the formal work_run or query_run command identity, or the trusted Host answering a user decision`;
    }
  }
  if (eventType === SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE
    && (!isRecord(body['actor']) || body['actor']['kind'] !== 'host')) {
    return `${eventType} actor must be the trusted Host identity`;
  }
  return null;
}

// --------------------------------------------------------------------------
// Registered validators
// --------------------------------------------------------------------------

const ARCHIVE_WAIT_DISPOSED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId',
  'message', 'source', 'archiveStep',
];
const ARCHIVE_STEP_KINDS: readonly string[] = [
  'stop', 'anchor', 'requeue', 'responsibility', 'reply_handler', 'wait_cancel', 'archive',
];

function checkArchiveStep(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['sessionRef', 'archiveRequestId', 'requestReceipt', 'step', 'subjectKey'])) {
    return 'archiveStep carries unknown fields';
  }
  const session = checkPlainSessionRef(value['sessionRef']);
  if (session !== null) return `archiveStep.sessionRef: ${session}`;
  if (!nonEmpty(value['archiveRequestId'])) return 'archiveStep.archiveRequestId is required';
  const receipt = value['requestReceipt'];
  if (!isRecord(receipt) || !hasOnlyKeys(receipt, ['identityKey', 'fingerprint'])
    || !nonEmpty(receipt['identityKey']) || !nonEmpty(receipt['fingerprint'])) {
    return 'archiveStep.requestReceipt must be {identityKey,fingerprint}';
  }
  if (!ARCHIVE_STEP_KINDS.includes(String(value['step']))) return 'archiveStep.step is not recognized';
  if (!nonEmpty(value['subjectKey'])) return 'archiveStep.subjectKey is required';
  return null;
}

function checkArchiveWaitDisposedBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, ARCHIVE_WAIT_DISPOSED_EVENT_KEYS)) return 'ArchiveWaitDisposed carries unknown fields';
  const messageProblem = eventMessageProblem(body, 'ArchiveWaitDisposed');
  if (messageProblem !== null) return messageProblem;
  const message = body['message'] as UnknownRecord;
  const source = body['source'];
  if (!isRecord(source)) return 'ArchiveWaitDisposed requires the changed source SessionRecord';
  const sourceProblem = checkSessionBody(source);
  if (sourceProblem !== null) return `ArchiveWaitDisposed source: ${sourceProblem}`;
  if (!isRecord(source['ref']) || source['ref']['projectId'] !== body['projectId']
    || source['workspaceId'] !== body['workspaceId']) {
    return 'ArchiveWaitDisposed source disagrees with the event scope';
  }
  const step = checkArchiveStep(body['archiveStep']);
  if (step !== null) return `ArchiveWaitDisposed archiveStep: ${step}`;
  const stepValue = body['archiveStep'] as UnknownRecord;
  const stepSession = stepValue['sessionRef'] as UnknownRecord;
  if (stepSession['sessionId'] !== (source['ref'] as UnknownRecord)['sessionId']) {
    return 'ArchiveWaitDisposed archiveStep does not name the source Session';
  }
  if (stepValue['step'] !== 'reply_handler' && stepValue['step'] !== 'wait_cancel') {
    return 'ArchiveWaitDisposed archiveStep must be reply_handler or wait_cancel';
  }
  if (stepValue['step'] === 'reply_handler') {
    const handler = message['replyHandler'];
    if (!isRecord(handler) || handler['archiveRequestId'] !== stepValue['archiveRequestId']
      || (handler['archiveSessionRef'] as Record<string, unknown>)['sessionId'] !== stepSession['sessionId']) {
      return 'ArchiveWaitDisposed transfer must record the transferred reply handler';
    }
  } else {
    const disposition = message['archiveWaitDisposition'];
    if (!isRecord(disposition) || disposition['kind'] !== 'cancel'
      || disposition['archiveRequestId'] !== stepValue['archiveRequestId']
      || (disposition['archiveSessionRef'] as Record<string, unknown>)['sessionId'] !== stepSession['sessionId']) {
      return 'ArchiveWaitDisposed cancel must record the cancelled wait disposition';
    }
  }
  return null;
}

const SESSION_MESSAGE_FORWARDED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'message', 'originalRef',
];
const SESSION_MESSAGE_WAIT_DISPOSED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'message', 'disposition',
];

/** The event's changed message: full record body, and its scope agrees with the event's. */
function eventMessageProblem(body: UnknownRecord, eventType: string): Problem {
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) {
    return `${eventType} requires projectId and workspaceId`;
  }
  const message = body['message'];
  if (!isRecord(message)) return `${eventType} requires the changed message`;
  const messageProblem = checkSessionMessageBody(message);
  if (messageProblem !== null) return `${eventType} message: ${messageProblem}`;
  if (!isRecord(message['ref']) || message['ref']['projectId'] !== body['projectId']
    || message['ref']['workspaceId'] !== body['workspaceId']) {
    return `${eventType} message scope disagrees with the event scope`;
  }
  return null;
}

function checkSessionMessageForwardedBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, SESSION_MESSAGE_FORWARDED_EVENT_KEYS)) return 'SessionMessageForwarded carries unknown fields';
  const messageProblem = eventMessageProblem(body, 'SessionMessageForwarded');
  if (messageProblem !== null) return messageProblem;
  const originalRef = body['originalRef'];
  const refProblem = checkSessionMessageRef(originalRef);
  if (refProblem !== null) return `SessionMessageForwarded originalRef: ${refProblem}`;
  const message = body['message'] as UnknownRecord;
  if (canonicalOf(originalRef) !== canonicalOf(message['ref'])) {
    return 'SessionMessageForwarded originalRef is not the changed message';
  }
  return null;
}

function checkSessionMessageWaitDisposedBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, SESSION_MESSAGE_WAIT_DISPOSED_EVENT_KEYS)) return 'SessionMessageWaitDisposed carries unknown fields';
  const messageProblem = eventMessageProblem(body, 'SessionMessageWaitDisposed');
  if (messageProblem !== null) return messageProblem;
  const disposition = body['disposition'];
  if (!isRecord(disposition) || !hasOnlyKeys(disposition, ['mode', 'to'])) {
    return 'SessionMessageWaitDisposed disposition must carry mode and to';
  }
  if (disposition['mode'] !== 'cancel' && disposition['mode'] !== 'transfer') {
    return 'SessionMessageWaitDisposed disposition.mode is not recognized';
  }
  if (disposition['mode'] === 'cancel' && disposition['to'] !== null) {
    return 'SessionMessageWaitDisposed cancel must not name a handler';
  }
  if (disposition['mode'] === 'transfer') {
    const toProblem = checkPlainSessionRef(disposition['to']);
    if (toProblem !== null) return `SessionMessageWaitDisposed disposition.to: ${toProblem}`;
  }
  return null;
}

const archiveWaitDisposedCodec = createEventCodec<ArchiveWaitDisposedEventV1>({
  eventType: ARCHIVE_WAIT_DISPOSED_EVENT_TYPE,
  schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
  jsonLabel: 'ArchiveWaitDisposed event',
  bodyProblem: (value) => checkArchiveWaitDisposedBody(value as UnknownRecord),
});
const sessionMessageForwardedCodec = createEventCodec<SessionMessageForwardedEventV1>({
  eventType: SESSION_MESSAGE_FORWARDED_EVENT_TYPE,
  schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
  jsonLabel: 'SessionMessageForwarded event',
  bodyProblem: (value) => checkSessionMessageForwardedBody(value as UnknownRecord),
});
const sessionMessageWaitDisposedCodec = createEventCodec<SessionMessageWaitDisposedEventV1>({
  eventType: SESSION_MESSAGE_WAIT_DISPOSED_EVENT_TYPE,
  schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
  jsonLabel: 'SessionMessageWaitDisposed event',
  bodyProblem: (value) => checkSessionMessageWaitDisposedBody(value as UnknownRecord),
});

// --------------------------------------------------------------------------
// Registered validators
// --------------------------------------------------------------------------

function validateRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== SESSION_MESSAGE_SCHEMA_ID) {
    return invalid(`expected schemaId ${SESSION_MESSAGE_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid(`SessionMessage record json is not an object: ${parsed.reason}`);
  const body = parsed.value;
  if (!isRecord(body['ref']) || !isPos(body['revision']) || body['revision'] !== record.revision) {
    return invalid('SessionMessage record envelope is invalid');
  }
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) {
    return invalid('SessionMessage refKey disagrees with the record body');
  }
  const problem = checkSessionMessageBody(body, true);
  if (problem !== null) return invalid(`SessionMessage record payload is invalid: ${problem}`);
  return { status: 'decoded', value: record };
}

function validateEvent(event: EncodedDomainEvent, eventType: string): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== eventType) return invalid(`expected eventType ${eventType}, got ${event.eventType}`);
  if (event.schemaVersion !== SESSION_MESSAGE_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${SESSION_MESSAGE_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return invalid(`${eventType} envelope is incomplete`);
  const parsed = parseJsonObject(event.json);
  if (parsed.status === 'invalid') return invalid(`${eventType} event json is not an object: ${parsed.reason}`);
  const body = parsed.value;
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return invalid(`${eventType} event envelope disagrees with the event json`);
  }
  const problem = checkEventBody(body, eventType);
  if (problem !== null) return invalid(`${eventType} event payload is invalid: ${problem}`);
  return { status: 'decoded', value: event };
}

// --------------------------------------------------------------------------
// The single registration
// --------------------------------------------------------------------------

export const SESSION_MESSAGE_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    {
      aggregateType: 'SessionMessage',
      schemaId: SESSION_MESSAGE_SCHEMA_ID,
      // Slice 5: the notification origin `since` is bound from the real commit
      // cursor in the same transaction (SPEC §2.5 line 289). Wiring package 2
      // adds the first-response position (spec §2.3 P02).
      commitCursorFields: ['since', 'responseSince'],
      validate: validateRecord,
    },
  ],
  events: [
    { eventType: SESSION_MESSAGE_SENT_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_SENT_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_READ_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_READ_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_RESPONDED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_RESPONDED_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_DERIVATION_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_DERIVATION_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE) },
    archiveWaitDisposedCodec.registration,
    sessionMessageForwardedCodec.registration,
    sessionMessageWaitDisposedCodec.registration,
    { eventType: SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_WITHDRAWN_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_WITHDRAWN_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_RELEASE_DECIDED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_RELEASE_DECIDED_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_RELEASED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_RELEASED_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_APPLIED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_APPLIED_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_EXPIRED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_EXPIRED_EVENT_TYPE) },
  ],
  lookups: [...SESSION_MESSAGE_LOOKUP_INDEXES, ...S5_SESSION_MESSAGE_LOOKUP_INDEXES, ...S2A_SESSION_MESSAGE_LOOKUP_INDEXES,
    ...K3_SESSION_MESSAGE_LOOKUP_INDEXES, ...S7A2_RELEASE_CANDIDATE_LOOKUP_INDEXES,
    ...S7A2_COPY_SESSION_MESSAGE_LOOKUP_INDEXES, ...S7B_SESSION_MESSAGE_LOOKUP_INDEXES],
};

// --------------------------------------------------------------------------
// Canonical keys and encode helpers
// --------------------------------------------------------------------------

/** Full canonical key of a SessionMessage aggregate (never a bare messageId). */
export function sessionMessageRefKey(ref: SessionMessageRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

/** One merged-candidate order: cursor sequence, then message ref key; the ref key breaks ties, so it is stable. */
export function compareSessionInputCandidates(
  left: { message: SessionMessage; cursor: () => CommitCursor },
  right: { message: SessionMessage; cursor: () => CommitCursor },
): number {
  return seqOfCommitCursor(left.cursor()) - seqOfCommitCursor(right.cursor())
    || sessionMessageRefKey(left.message.ref).localeCompare(sessionMessageRefKey(right.message.ref));
}

export function encodeSessionMessageRecord(message: SessionMessage, origin?: NoticeOriginWireV1): EncodedRecord {
  // The public DTO is written byte-for-byte; the optional origin wire fields are
  // merged on top only when the caller supplies them (SPEC §2.5 line 291).
  return {
    refKey: sessionMessageRefKey(message.ref),
    schemaId: SESSION_MESSAGE_SCHEMA_ID,
    revision: message.revision,
    json: JSON.stringify(origin === undefined ? message : { ...message, ...origin }),
  };
}

function encodeMessageEvent(event: SessionMessageEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function encodeSessionMessageSentEvent(event: SessionMessageSentEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageReadEvent(event: SessionMessageReadEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageRespondedEvent(event: SessionMessageRespondedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageConsultationDerivedEvent(event: SessionMessageConsultationDerivedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageInputAcceptedEvent(event: SessionMessageInputAcceptedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageDecisionAnsweredEvent(event: SessionMessageDecisionAnsweredEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageDecisionAppliedEvent(event: SessionMessageDecisionAppliedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageWithdrawnEvent(event: SessionMessageWithdrawnEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageReleaseDecidedEvent(event: SessionMessageReleaseDecidedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageReleasedEvent(event: SessionMessageReleasedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageAppliedEvent(event: SessionMessageAppliedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageExpiredEvent(event: SessionMessageExpiredEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}

export function encodeArchiveWaitDisposedEvent(event: ArchiveWaitDisposedEventV1): EncodedDomainEvent {
  return archiveWaitDisposedCodec.encode(event);
}

export function encodeSessionMessageForwardedEvent(event: SessionMessageForwardedEventV1): EncodedDomainEvent {
  return sessionMessageForwardedCodec.encode(event);
}

export function encodeSessionMessageWaitDisposedEvent(event: SessionMessageWaitDisposedEventV1): EncodedDomainEvent {
  return sessionMessageWaitDisposedCodec.encode(event);
}

// --------------------------------------------------------------------------
// Typed decoders (read/replay path)
// --------------------------------------------------------------------------

export function decodeSessionMessageRecord(record: EncodedRecord): DecodeResult<SessionMessage> {
  const checked = validateRecord(record);
  if (checked.status !== 'decoded') return checked;
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid('SessionMessage record json is not an object');
  // R2 exception: the frozen S1 test `S1-codecs-indexes` SV01 asserts
  // an explicit `null` on a decoded old Message, so this codec keeps the §2.9
  // null default for the two optional wait fields.
  // The origin wire (`since`/`noticeAutomationCap`) is NOT part of the old
  // public DTO; `decodeNoticeOrigin` reads it separately (SPEC §2.5 line 291).
  const wire = { ...parsed.value };
  delete wire['since'];
  delete wire['noticeAutomationCap'];
  const message = wire as unknown as SessionMessage;
  return { status: 'decoded', value: { ...message,
    replyHandler: message.replyHandler ?? null, archiveWaitDisposition: message.archiveWaitDisposition ?? null } };
}

/**
 * Restores the ORIGINAL message of a recorded send/read/respond event. This is
 * the only source a replay may use; it never re-derives current state.
 */
export function sessionMessageFromEvent(event: EncodedDomainEvent): DecodeResult<SessionMessage> {
  const eventType = event.eventType;
  if (eventType !== SESSION_MESSAGE_SENT_EVENT_TYPE && eventType !== SESSION_MESSAGE_READ_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_RESPONDED_EVENT_TYPE && eventType !== SESSION_MESSAGE_DERIVATION_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_WITHDRAWN_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_RELEASE_DECIDED_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_RELEASED_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_APPLIED_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_EXPIRED_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_FORWARDED_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_WAIT_DISPOSED_EVENT_TYPE) {
    return invalid(`eventType ${String(eventType)} is not a SessionMessage event`);
  }
  // §3.9 items 2 and 5: the two forward-owner events carry the changed message under their own payload shape.
  if (eventType === SESSION_MESSAGE_FORWARDED_EVENT_TYPE) {
    const decoded = sessionMessageForwardedEventFromEvent(event);
    return decoded.status === 'decoded' ? { status: 'decoded', value: decoded.value.message } : decoded;
  }
  if (eventType === SESSION_MESSAGE_WAIT_DISPOSED_EVENT_TYPE) {
    const decoded = sessionMessageWaitDisposedEventFromEvent(event);
    return decoded.status === 'decoded' ? { status: 'decoded', value: decoded.value.message } : decoded;
  }
  const checked = validateEvent(event, eventType);
  if (checked.status !== 'decoded') return checked;
  const parsed = parseJsonObject(event.json);
  if (parsed.status === 'invalid') return invalid(`${eventType} event json is not an object`);
  // Rule 1: a replay returns the ORIGINAL event value, so the
  // event payload keeps exactly the keys it was written with; only the record
  // decoder applies the §2.9 null default (SV01). Readers use `?? null`.
  const message = parsed.value['message'] as SessionMessage;
  return { status: 'decoded', value: message };
}

/** The typed release-decision event, with its proof slot (the codec fixes the slot, `:1076–:1087`). */
export function sessionMessageReleaseDecidedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<SessionMessageReleaseDecidedEventV1> {
  const checked = validateEvent(event, SESSION_MESSAGE_RELEASE_DECIDED_EVENT_TYPE);
  if (checked.status !== 'decoded') return checked;
  const parsed = parseJsonObject(event.json);
  if (parsed.status === 'invalid') {
    return invalid(`${SESSION_MESSAGE_RELEASE_DECIDED_EVENT_TYPE} event json is not an object`);
  }
  return { status: 'decoded', value: parsed.value as unknown as SessionMessageReleaseDecidedEventV1 };
}

export function archiveWaitDisposedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<ArchiveWaitDisposedEventV1> {
  const decoded = archiveWaitDisposedCodec.decodeBody(event);
  return decoded.status === 'decoded'
    ? { status: 'decoded', value: decoded.value as unknown as ArchiveWaitDisposedEventV1 }
    : decoded;
}

export function sessionMessageForwardedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<SessionMessageForwardedEventV1> {
  const decoded = sessionMessageForwardedCodec.decodeBody(event);
  return decoded.status === 'decoded'
    ? { status: 'decoded', value: decoded.value as unknown as SessionMessageForwardedEventV1 }
    : decoded;
}

export function sessionMessageWaitDisposedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<SessionMessageWaitDisposedEventV1> {
  const decoded = sessionMessageWaitDisposedCodec.decodeBody(event);
  return decoded.status === 'decoded'
    ? { status: 'decoded', value: decoded.value as unknown as SessionMessageWaitDisposedEventV1 }
    : decoded;
}

