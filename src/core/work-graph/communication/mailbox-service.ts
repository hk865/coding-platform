/**
 * C1 SessionMailbox service.
 *
 * A SessionMessage is a durable, received statement; it is NOT a task
 * obligation, wait or execution claim. Sending never wakes, preempts or changes
 * a Session/Task; a busy/archived Session still receives mail and a pending
 * inbox item never blocks explicit archival.
 *
 * Trusted identity (never from model JSON):
 *   - `ctx` is a trusted Host/tool-adapter binding. Every mutable input is
 *     snapshotted synchronously before the first await; the original AbortSignal
 *     is kept by reference. Host and work_run scopes are re-checked here.
 *   - A work_run sender is re-derived from the persisted WG11/claim facts on the
 *     ONE real ledger; `agentPrincipal.workId` is never used as a Session.
 *   - A NEW work_run action additionally requires a real running, non-terminal
 *     Run, the exact Session occupancy/lease owner and generation, a B2 V2
 *     `phase:'entered'` authorization with `sessionGeneration === claim.generation`
 *     and a Session-matching kernel binding, a non-null envelope whose
 *     Run/Role/workspace agree and which authorizes the operation tool, and the
 *     existing Role resolver ceiling. A replay restores the ORIGINAL receipt
 *     first and is never re-judged against the current world.
 *
 * Body storage (MaterialPort only, never inlined text):
 *   - a canonical JSON envelope is stored with `scope+messageId+part`; the
 *     internal system Host is used ONLY as the platform body executor. It never
 *     replaces the real command actor/sender.
 *   - a message is published only after the body is stored, read back and
 *     verified inside one PreparedCommit with the event/idempotency receipt.
 *
 * Reads use the registered recipient lookup and a realtime keyset; they never
 * scan all events, never ack and never bind a cursor to the whole-ledger
 * watermark.
 *
 * Every write is decided by the pure message machine (`state/message-machine.ts`,
 * STATE-MACHINES-SPEC §10 MSG-01..09). The request checks that name the
 * receipt identity and the receipt lookup still come first, each read happens
 * where it always did (an earlier refusal skips the later reads), and the
 * machine's effects become the body store before the commit and the one
 * commit's record, event and CAS guards. Status, readAt, response,
 * acceptedInputs and the derivation are written only by the machine's record
 * constructors (§14.1).
 */
import type { ArtifactRecord, ArtifactRef } from '../../../contracts/artifact.js';
import { sameActorIdentity as sameActor } from '../../../contracts/actor-equality.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import { canonicalJson, canonicalOf, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { principalIdentity, type CoreCallContext, type CorePrincipal, type MaterialReader } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import { QueryJobRefShape, QueryRunRefShape } from '../../../contracts/data-format-refs.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { DecisionHostSenderV1, MessageRecipient, MessageReleaseV1, SendRejectionV1, SessionMessageIntentV1,
  SessionMessageRef, UserMessageRecipientV1, DecisionMessageMetadataV1 } from '../../../contracts/core/session-message.js';
import type { DispatchBasisV1, GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { DecisionChangeProofV1, DecisionObjectV1, DecisionOptionV1,
  GoalAutonomyV1, GoalDecisionBasisV1, MessageReleaseBlockV1 } from '../../../contracts/goal-decisions.js';
import { decisionSourceKey } from '../../../contracts/goal-decisions.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import {
  deriveArchiveStepCommitIdentityV1, type ArchiveStepRefV1, type ArchiveWaitChoiceV1,
  type SessionArchiveRequestV1,
} from '../../../contracts/core/session-archive.js';
import type { PreparedTaskManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { isNonNeg as isNonNegativeInt, isPos as isPositiveInt, isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import type { ExecutionAuthorizationV2, RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { ToolCommitLookup, ToolCommitLookupInput, ToolCommitLookupResult } from '../../../contracts/unknown-call-review.js';
import {
  ackSessionMessageRequest, respondSessionMessageRequest, sendSessionMessageRequest, sendUserMessageRequest,
  toolCommitLookupResult, toolCommitLookupUnknownTool, toolCommitRequestId,
  type SessionMessageSendInput, type SendUserMessageInput,
} from '../model/tool-commit-arguments.js';
import { consultationQueryRefs } from '../../../contracts/query-job.js';
import type { QueryJobAnswerRef, QueryJobAnswerSnapshot, QueryJobRef, QueryJobSnapshot, QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { MessageQueryAnswerSender, MessageSender, MessageWorkRunSender, SendMessageResultV1, SessionMailboxDependencies, SessionMailboxPort, SessionMessage, SessionMessageCommandPort, SessionMessageOutboxPageV1, SessionMessageReadPageV1, SessionMessageReadV1, SessionMessageRespondInputV1, SessionMessageSendInputV1, SessionMessageStatus, UndeliveredReplyV1 } from '../model/communication-contracts.js';
import { deriveMessageDelivery, deriveSessionInputId } from '../model/communication-contracts.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../../contracts/ledger.js';
import { canonicalRefKey, decodeGoalSnapshot, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { decodePlanRevisionSnapshot } from '../persistence/plan-record-codecs.js';
import { decodeEvidenceSnapshot } from '../persistence/evidence-record-codecs.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { checkPlainSessionRef, decodeSessionRecord, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import {
  SESSION_ARCHIVE_REQUESTED_EVENT, sessionArchiveChangedEventFromEvent, type SessionArchiveChangedEventV1,
} from '../sessions/lifecycle-record-codecs.js';
import type { SessionCard, SessionPage, SessionPageRequest } from '../model/session-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import { SESSION_BY_PROVENANCE_LOOKUP, SESSION_REPLY_BY_HANDLER_LOOKUP } from '../model/session-facts-contracts.js';
import type { RecipientOpenExecutionsV1 } from '../model/session-facts-contracts.js';
import type { DecisionMessagePort, MessageCommandWritePort, SessionMessageCommitCompanions, SessionMessageCommitFragment, SessionMessageWriteCommandV1 } from '../model/decision-contracts.js';
import {
  executeWriteCommand, type CommandResult, type CommittedReceipt, type Keys, type WriteCommand,
} from '../persistence/command-executor.js';
import type { GoalRecordTransactionPort, RecordBatchRead, EncodedDomainEvent, EncodedRecord, CommitCursorBinding, PreparedCommit, RecordGuard, StoreFailure, StoreResult, UniqueClaimChange } from '../../record-store/ports.js';
import type { RecordLookupRequest } from '../../record-store/lookup-ports.js';
import type { TaskClaimOutbox } from '../model/claim-contracts.js';
import type { TaskExecutionRecord } from '../model/execution-read-contracts.js';
import { decodeDispatchOutboxEntry, dispatchOutboxRefKey } from '../tasks/claim-record-codecs.js';
import { readStoredManifest, recheckHostRoleAdmission } from '../tasks/execution-entry-service.js';
import { readBatch, type ReadBatch } from '../tasks/plan-readers.js';
import { messageReleaseBlockEligible } from '../tasks/message-release-card.js';
import { releaseCandidateBlockedReason } from './message-release.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import {
  SESSION_MESSAGE_BY_RECIPIENT_LOOKUP, SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP,
  SESSION_MESSAGE_BY_REQUEST_ROOT_LOOKUP,
  SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP, SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP,
  SESSION_MESSAGE_CONTENT_TYPE, SESSION_MESSAGE_MAX_TEXT_BYTES,
  archiveWaitDisposedEventFromEvent, checkSessionMessageRef, decodeSessionMessageRecord,
  encodeArchiveWaitDisposedEvent, encodeSessionMessageReadEvent, encodeSessionMessageRecord, encodeSessionMessageRespondedEvent,
  encodeSessionMessageSentEvent, sessionMessageFromEvent, sessionMessageRefKey,
  encodeSessionMessageConsultationDerivedEvent, encodeSessionMessageInputAcceptedEvent,
  encodeSessionMessageDecisionAnsweredEvent, encodeSessionMessageDecisionAppliedEvent,
  encodeSessionMessageWithdrawnEvent, encodeSessionMessageReleaseDecidedEvent, encodeSessionMessageReleasedEvent,
  encodeSessionMessageAppliedEvent,
  type SessionMessageEventV1,
} from '../sessions/message-record-codecs.js';
import { decodeStoredMessageBody, decodeStoredUserDecisionBody, isUserDecisionAnswerPart } from '../sessions/message-body-envelope.js';
import { decodeNoticeOrigin, type NoticeOriginWireV1 } from '../persistence/decision-record-codecs.js';
import {
  decodeQueryJobAnswerSnapshot, decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord,
} from '../queries/query-record-codecs.js';
import {
  bindMessageResponseCursor, createSessionMessageRecord, inputObserverProblem, messageMachineStateOf, messagePinProblem, messagePrincipalProblem,
  messageRecipientProjectProblem, messageSendFlagsProblem, nextSessionMessageRecord, transitionMessage,
  type MessageEffect, type MessageEvent, type MessageGuardContext, type MessageTransition, type QueryAnswerBinding,
  type SessionMessageEventType, type MessageWithdrawnChangeV1, type MessageReleaseDecidedChangeV1,
} from '../state/message-machine.js';
import { unreachable, type Rejected } from '../state/transition.js';
import { canSendUserMessage, decisionActionPolicy } from '../state/decision-policy.js';
import { firstDispatch, nextDispatch } from '../state/dispatch-counter.js';
import { dispatchCounterCodec } from '../persistence/dispatch-counter-codecs.js';
import { activityGuardOf, planSessionActivityAdvance } from '../sessions/session-activity.js';
import { normalizeRespondMessageInput, normalizeSendMessageInput } from '../model/message-payload.js';
import { mergeGuards } from '../persistence/record-guards.js';
import type { DispatchBasisFactsV1 } from '../model/dispatch-basis-contracts.js';
import type { SecretaryQueryRunV1 } from '../model/secretary-query-run-contracts.js';

type Unknown = Record<string, unknown>;
/**
 * `ownContext` admits these principals. A `query_run` principal is only the
 * literal caller here; its round is resolved after a receipt miss (send) or on
 * every read, never in `ownContext`.
 */
export type MailboxPrincipal = Extract<CorePrincipal, { kind: 'host' | 'work_run' | 'query_run' }>;
type WorkRunPrincipal = Extract<CorePrincipal, { kind: 'work_run' }>;
type HostActor = Extract<CorePrincipal, { kind: 'host' }>['actor'];

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

/**
 * The historical mailbox paths here address a Session. This pure discriminator
 * narrows the `SessionRef | UserMessageRecipientV1` union without changing any
 * Session behaviour.
 */
function isUserRecipient(recipient: MessageRecipient): recipient is UserMessageRecipientV1 {
  return 'kind' in recipient && recipient.kind === 'user';
}
function isRunRef(value: unknown): boolean {
  return isObject(value) && value['aggregateType'] === 'Run'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}
function isGoalRef(value: unknown): boolean {
  return isObject(value) && value['aggregateType'] === 'Goal'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']);
}
function isRoleBindingRef(value: unknown): boolean {
  return isObject(value) && value['schemaVersion'] === 1
    && nonEmpty(value['bindingId']) && nonEmpty(value['templateId']) && nonEmpty(value['templateRevision'])
    && isPositiveInt(value['bindingVersion']) && nonEmpty(value['policyRevision']);
}
/** The Session store-failure map; a `unique_conflict` also carries a claim slot, not a version pin. */
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  return sessionStoreFailureToRejection({
    code: failure.code,
    reason: failure.reason,
    ...(failure.code === 'revision_conflict' ? { current: failure.current } : {}),
  });
}
export function mapReadResult<T>(result: ReadResult<T>): ReadResult<T> | CoreRejection {
  if (result.status === 'not_found') return reject('not_found', 'the requested record does not exist');
  if (result.status === 'not_ready') return reject('incomplete', 'the requested record is not readable at the required watermark');
  return result.status === 'ready' ? result : result;
}

/**
 * The one read of a single message by its ref. A read cancelled before the store read, a thrown read, a store
 * failure, a record the store neither returned nor reported missing, and a damaged record each give their own
 * rejection; `not_found` only when the store reports the key missing.
 */
export async function readSessionMessageRecord(
  records: Pick<SessionMessageStore, 'readMany'>, signal: AbortSignal, ref: SessionMessageRef,
): Promise<ReadResult<SessionMessage>> {
  if (signal.aborted) return reject('cancelled', 'the message read was cancelled before the store read');
  const key = sessionMessageRefKey(ref);
  let read: StoreResult<RecordBatchRead>;
  try {
    read = await records.readMany([key]);
  } catch {
    return reject('unavailable', 'the message record could not be read');
  }
  if (read.status !== 'ready') return mapStoreFailure(read);
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    return read.value.missing.includes(key)
      ? { status: 'not_found' }
      : reject('unavailable', 'the record store neither returned nor reported missing the message');
  }
  const decoded = decodeSessionMessageRecord(record);
  if (decoded.status !== 'decoded') return reject('unavailable', `the message record is damaged: ${decoded.reason}`);
  return { status: 'ready', value: decoded.value };
}

/**
 * SPEC §2.5: a later update copies the original wire origin (`since`), never
 * re-binds it. Every current writer binds `since` at creation, so a record
 * without one is damaged, never silently re-encoded without a position.
 */
async function preservedNoticeOrigin(records: SessionMailboxDependencies['records'], refKey: string): Promise<
  { ok: true; value: NoticeOriginWireV1 } | { ok: false; rejection: CoreRejection }> {
  let read: StoreResult<RecordBatchRead>;
  try {
    read = await records.readMany([refKey]);
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the notice origin could not be read') };
  }
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find((candidate) => candidate.refKey === refKey);
  if (record === undefined) return { ok: false, rejection: reject('unavailable', 'the updated record is missing') };
  const decoded = decodeNoticeOrigin(record);
  if (decoded.status !== 'decoded') {
    return { ok: false, rejection: reject('unavailable', `the notice origin is damaged: ${decoded.reason}`) };
  }
  if (decoded.value.since === undefined) {
    return { ok: false, rejection: reject('unavailable', 'the notice origin has no stored creation position') };
  }
  const origin: NoticeOriginWireV1 = { since: decoded.value.since };
  if (decoded.value.noticeAutomationCap !== undefined) origin.noticeAutomationCap = decoded.value.noticeAutomationCap;
  return { ok: true, value: origin };
}

// --------------------------------------------------------------------------
// The ONE SessionMessage writer (SPEC §3.3 line 684)
// --------------------------------------------------------------------------
//
// The original `sendMessage`/`respond*`/`ack`/`sendUserMessage` path and the
// `MessageWriteOwnerPort.persist` facade share exactly this commit
// tail: the decoded receipt replay, the creation/update origin, the message
// CAS (from the caller's ACCEPTED pin, never a re-read `before.revision`), the
// single PreparedCommit and the receipt re-check. Body storage stays outside
// the commit on both paths.

type SessionMessageStore = SessionMailboxDependencies['records'];
type MessageCommitReceipt = Extract<Awaited<ReturnType<SessionMessageStore['commit']>>, { status: 'committed' }>;

/** §3.3 line 627: the original event's value and cursor, restored before any new business read. */
async function replaySessionMessageReceipt(
  records: SessionMessageStore,
  receipt: MessageCommitReceipt,
): Promise<WriteResult<SessionMessage>> {
  // Companion events come first and the one message snapshot is LAST: the receipt
  // names a non-empty list, and `receipt.cursor` is that last event.
  const lastEventId = receipt.eventIds.at(-1);
  if (lastEventId === undefined || !nonEmpty(lastEventId)) {
    return reject('unavailable', 'the mailbox receipt does not name a last event');
  }
  let located: StoreResult<{ cursor: CommitCursor; event: EncodedDomainEvent }>;
  try {
    located = await records.eventAt(receipt.cursor);
  } catch {
    return reject('unavailable', 'the recorded mailbox event could not be read');
  }
  if (located.status !== 'ready') return mapStoreFailure(located);
  if (String(located.value.cursor) !== String(receipt.cursor)) {
    return reject('unavailable', 'the recorded mailbox event cursor disagrees with the receipt');
  }
  if (located.value.event.eventId !== lastEventId) {
    return reject('unavailable', 'the recorded mailbox event id disagrees with the receipt');
  }
  // Slice 1 §2.9: the wait-disposal replay event carries the changed message
  // under its own field.
  const disposal = located.value.event.eventType === 'ArchiveWaitDisposed';
  const decoded = disposal
    ? archiveWaitDisposedEventFromEvent(located.value.event)
    : sessionMessageFromEvent(located.value.event);
  if (decoded.status !== 'decoded') {
    return reject('unavailable', `the recorded mailbox event is not decodable: ${decoded.reason}`);
  }
  const message = disposal
    ? (decoded.value as { message: SessionMessage }).message
    : decoded.value as SessionMessage;
  const version = receipt.versions.find((entry) => entry.refKey === sessionMessageRefKey(message.ref));
  if (version === undefined || version.revision !== message.revision) {
    return reject('unavailable', 'the recorded mailbox event disagrees with the receipt revision');
  }
  // Spec §2.3 L11-1: the replay returns the first result's bound reply position.
  return { status: 'committed', value: bindMessageResponseCursor(message, receipt.cursor), replayed: true, cursor: receipt.cursor };
}

/** Receipt-miss recovery uses only the same identity; it never re-runs business. */
async function recheckSessionMessageReceipt(
  records: SessionMessageStore,
  identityKey: string,
  fingerprint: string,
): Promise<WriteResult<SessionMessage> | null> {
  let again: StoreResult<MessageCommitReceipt>;
  try {
    again = await records.lookupCommit({ identityKey, fingerprint });
  } catch {
    return reject('unavailable', 'the mailbox idempotency receipt could not be re-checked');
  }
  if (again.status === 'ready') return replaySessionMessageReceipt(records, again.value);
  if (again.code !== 'not_found') return mapStoreFailure(again);
  return null;
}

type PreparedSessionMessageWrite = {
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

/** A companion contribution's own validation; absent normalizes to no contribution. */
function companionContributionOf(raw: unknown):
  { ok: true; value: SessionMessageCommitCompanions | undefined } | { ok: false; rejection: CoreRejection } {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!isObject(raw)) return { ok: false, rejection: reject('invalid', 'the commit companions must be an object') };
  for (const key of ['records', 'events', 'guards', 'claims', 'commitCursorBindings'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) {
      return { ok: false, rejection: reject('invalid', `the commit companions' ${key} must be an array`) };
    }
  }
  return { ok: true, value: raw as unknown as SessionMessageCommitCompanions };
}

/**
 * The one snapshot event a lifecycle command appends. The command names its
 * operation, envelope and change; the event type and the message are the
 * operation's. A release writes the change's own proof (a direct release's
 * change carries `null`; a trusted caller's decision change carries its proof).
 */
function lifecycleEventOf(command: SessionMessageWriteCommandV1, message: SessionMessage): EncodedDomainEvent {
  const envelope = command.event;
  const base = {
    eventId: envelope.eventId, schemaVersion: 1 as const, occurredAt: envelope.occurredAt,
    projectId: envelope.projectId, workspaceId: envelope.workspaceId,
    requestId: envelope.requestId, actor: envelope.actor, message,
  };
  switch (command.operation) {
    case 'message.withdraw': return encodeSessionMessageWithdrawnEvent({ ...base, eventType: 'SessionMessageWithdrawn' });
    case 'message.release':
      return encodeSessionMessageReleaseDecidedEvent({ ...base, eventType: 'SessionMessageReleaseDecided',
        proof: command.change.proof });
    case 'message.releaseApproved': return encodeSessionMessageReleasedEvent({ ...base, eventType: 'SessionMessageReleased' });
    case 'message.apply': return encodeSessionMessageAppliedEvent({ ...base, eventType: 'SessionMessageApplied' });
    default: return unreachable(command, 'message write operation');
  }
}

/** The machine event each lifecycle operation's change corresponds to. */
function lifecycleMachineEventOf(command: SessionMessageWriteCommandV1): MessageEvent {
  switch (command.operation) {
    case 'message.withdraw': return { type: 'message_withdrawn' };
    case 'message.release': return { type: 'message_release_decided', allow: command.change.allow };
    case 'message.releaseApproved': return { type: 'message_released' };
    case 'message.apply': return { type: 'message_applied' };
    default: return unreachable(command, 'message write operation');
  }
}

/**
 * The one non-committing prepared fragment for a lifecycle command. It reads
 * the notice origin, builds the next record through the machine's constructor,
 * asserts the result is the state the machine accepted (the change's own times
 * are the owner's facts, like a send's release), and encodes the message record
 * and its one snapshot event last. It never looks up a receipt and never
 * commits.
 */
async function prepareSessionMessage(
  records: SessionMessageStore,
  owned: Owned,
  command: SessionMessageWriteCommandV1,
  companions: SessionMessageCommitCompanions,
): Promise<SessionMessageCommitFragment | CoreRejection> {
  const refKey = sessionMessageRefKey(command.before.ref);
  const preserved = await preservedNoticeOrigin(records, refKey);
  if (!preserved.ok) return preserved.rejection;
  let next: SessionMessage;
  try {
    next = nextSessionMessageRecord(command.before,
      command.change as unknown as Parameters<typeof nextSessionMessageRecord>[1]);
  } catch {
    return reject('revision_conflict', 'the message changed since this command read it');
  }
  const { decided } = judge(owned.principal, command.before, lifecycleMachineEventOf(command), {});
  if (!decided.ok) return reject('revision_conflict', 'the message state no longer accepts this command');
  let accepted = decided.next as Record<string, unknown>;
  if (command.operation === 'message.withdraw') {
    accepted = { ...accepted, withdrawnAt: command.change.withdrawnAt };
  } else if (command.operation === 'message.apply') {
    accepted = { ...accepted, appliedAt: command.change.appliedAt };
  } else if (command.operation === 'message.release' && command.change.allow) {
    // The machine's change carries only the release and the approval revision;
    // the same commit's record also writes the change's approval time.
    accepted = { ...accepted, approvedAt: command.change.approvedAt };
  } else if (command.operation === 'message.releaseApproved') {
    accepted = { ...accepted, pins: command.change.pins };
  }
  if (canonicalOf(messageMachineStateOf(next)) !== canonicalOf(accepted as unknown as JsonValue)) {
    return reject('revision_conflict', 'the prepared message is not the state the machine accepted');
  }
  const bindings = companions.commitCursorBindings ?? [];
  const merged = mergeGuards([...companions.guards, { refKey, expectedRevision: command.expectedRevision }]);
  if (!merged.ok) return merged.rejection;
  return {
    records: [...companions.records, encodeSessionMessageRecord(next, preserved.value)],
    events: [...companions.events, lifecycleEventOf(command, next)],
    guards: merged.guards,
    claims: [...companions.claims],
    ...(bindings.length === 0 ? {} : { commitCursorBindings: bindings }),
    ...(companions.ledgerHorizon === undefined ? {} : { ledgerHorizon: companions.ledgerHorizon }),
  };
}

/** The receipt's message version must be the decoded event's own revision. */
export function messageVersionAgainstReceipt(decoded: SessionMessage, receipt: CommittedReceipt, keys: Keys): string | null {
  if (receipt.identityKey !== keys.identityKey) return 'the receipt identity does not match';
  const version = receipt.versions.find((entry) => entry.refKey === sessionMessageRefKey(decoded.ref));
  return version !== undefined && version.revision === decoded.revision
    ? null : 'the receipt message version does not match';
}

const withdrawnResult = {
  eventType: 'SessionMessageWithdrawn' as const,
  schemaVersion: 1 as const,
  decode: sessionMessageFromEvent,
  validate: messageVersionAgainstReceipt,
  project: (decoded: SessionMessage, _cursor: CommitCursor) => decoded,
};

/** An approval or denial restores its own snapshot event exactly like a withdrawal's. */
export const releaseDecidedResult = {
  eventType: 'SessionMessageReleaseDecided' as const,
  schemaVersion: 1 as const,
  decode: sessionMessageFromEvent,
  validate: messageVersionAgainstReceipt,
  project: (decoded: SessionMessage, _cursor: CommitCursor) => decoded,
};

/** The one constructor of a release decision's change; a direct call passes no proof. */
export function releaseDecidedChange(
  message: SessionMessage, allow: boolean, at: string, proof: DecisionChangeProofV1 | null,
): MessageReleaseDecidedChangeV1 {
  // Exactly one arm: a denial carries no approval fact at all, and a direct
  // call never writes the trusted entry's proof.
  return allow
    ? {
      kind: 'release_decided', allow: true, approvedAt: at,
      approvalRevision: message.revision + 1, release: 'approved', proof,
    }
    : {
      kind: 'release_decided', allow: false, approvedAt: null,
      approvalRevision: null, release: 'denied', proof,
    };
}

/** The executor's public result: one shell, never its refusal wrapper or internal cause. */
export function messageWriteResult(result: CommandResult<SessionMessage, CoreRejection>): WriteResult<SessionMessage> {
  if (result.status === 'committed') return result;
  if (result.status === 'refused') return result.refusal;
  return {
    status: 'rejected', code: result.code, reason: result.reason,
    ...(result.current === undefined ? {} : { current: result.current }),
  };
}

type WithdrawFacts = {
  message: SessionMessage;
  open: RecipientOpenExecutionsV1;
  guards: readonly RecordGuard[];
  actor: MessageSender;
};
type WithdrawDecision = {
  before: SessionMessage;
  change: MessageWithdrawnChangeV1;
  at: string;
  actor: MessageSender;
  guards: readonly RecordGuard[];
  horizon: CommitCursor;
};

type ReleaseFacts = { message: SessionMessage; actor: MessageSender };
type ReleaseDecision = {
  before: SessionMessage;
  change: MessageReleaseDecidedChangeV1;
  at: string;
  actor: MessageSender;
};

/** The one commit tail both writer paths use. */
async function commitPreparedSessionMessage(
  records: SessionMessageStore,
  spec: PreparedSessionMessageWrite,
): Promise<WriteResult<SessionMessage>> {
  const refKey = sessionMessageRefKey(spec.message.ref);
  let origin: NoticeOriginWireV1 | undefined;
  let bindings: CommitCursorBinding[] = [];
  if (spec.messageRevision === null) {
    origin = { since: null };
    bindings = [{ refKey, field: 'since' }];
  } else {
    const preserved = await preservedNoticeOrigin(records, refKey);
    if (!preserved.ok) return preserved.rejection;
    origin = preserved.value;
    // Spec §2.3 P02: the first response on a work_run message writes the
    // explicit pending reply placeholder; this same commit binds it.
    if (spec.message.responseSince === null) {
      bindings = [...bindings, { refKey, field: 'responseSince' }];
    }
  }
  const accepted: RecordGuard = { refKey, expectedRevision: spec.messageRevision };
  // Book §3.11: the companion contribution comes first — its records, its events,
  // its guards, its claims and its cursor bindings — and this message's record and
  // its one snapshot event are the tail. The three binding inputs are merged by
  // (refKey, field) and deduplicated; the tail is never replaced.
  const companions = spec.companions;
  const companionBindings = companions?.commitCursorBindings ?? [];
  const allBindings = [...companionBindings, ...bindings];
  const mergedBindings = allBindings.filter((binding, index) => allBindings.findIndex(
    (candidate) => candidate.refKey === binding.refKey && candidate.field === binding.field) === index);
  const merged = mergeGuards([accepted, ...(companions?.guards ?? []), ...spec.guards]);
  if (!merged.ok) return merged.rejection;
  const prepared: PreparedCommit = {
    identityKey: spec.identityKey,
    fingerprint: spec.fingerprint,
    guards: merged.guards,
    records: [...(companions?.records ?? []), encodeSessionMessageRecord(spec.message, origin)],
    claims: [...(companions?.claims ?? []), ...spec.claims],
    indexGuards: [],
    indexChanges: [],
    events: [...(companions?.events ?? []), spec.event],
    ...(mergedBindings.length === 0 ? {} : { commitCursorBindings: mergedBindings }),
    ...(companions?.ledgerHorizon === undefined ? {} : { ledgerHorizon: companions.ledgerHorizon }),
  };
  if (spec.owned.signal.aborted) return reject('cancelled', spec.cancelledReason);
  let receipt: Awaited<ReturnType<SessionMessageStore['commit']>>;
  try {
    receipt = await records.commit(prepared);
  } catch {
    const restored = await recheckSessionMessageReceipt(records, spec.identityKey, spec.fingerprint);
    return restored ?? reject('unavailable', spec.commitFailureReason);
  }
  if (receipt.status !== 'committed') {
    const restored = await recheckSessionMessageReceipt(records, spec.identityKey, spec.fingerprint);
    return restored ?? mapStoreFailure(receipt);
  }
  if (receipt.replayed) return replaySessionMessageReceipt(records, receipt);
  return { status: 'committed', value: bindMessageResponseCursor(spec.message, receipt.cursor), replayed: false, cursor: receipt.cursor };
}

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
 * The context the resolver and the request-owner read see: the cloned,
 * validated identity and the original bound signal. The caller's original
 * object is never read again after `ownContext`.
 */
function isolatedContext(owned: Owned): CoreCallContext {
  return {
    projectId: owned.projectId,
    workspaceId: owned.workspaceId,
    principal: structuredClone(owned.principal),
    materialReader: structuredClone(owned.reader),
    signal: owned.signal,
  };
}

/**
 * The project/workspace scope `identityKeyOf`/`fingerprintOf` bind. The real
 * owner methods pass their `Owned` context; the L4 lookup passes the original
 * Run's `origin` so the identity matches what that Run actually committed.
 */
type MailboxScope = { projectId: string; workspaceId: string };

export function ownContext(ctx: CoreCallContext): OwnedContext {
  const raw = ctx as unknown as Unknown | null | undefined;
  if (raw === null || raw === undefined) return { ok: false, rejection: reject('invalid', 'a mailbox call requires a bound call context') };
  const projectId = raw['projectId'];
  const workspaceId = raw['workspaceId'];
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) {
    return { ok: false, rejection: reject('forbidden', 'a mailbox call requires a bound project/workspace context') };
  }
  const signal = raw['signal'];
  if (!isObject(signal) || typeof signal['aborted'] !== 'boolean' || typeof signal['addEventListener'] !== 'function') {
    return { ok: false, rejection: reject('forbidden', 'a mailbox call requires the bound AbortSignal') };
  }
  let principal: unknown;
  let reader: unknown;
  try {
    principal = structuredClone(raw['principal']);
    reader = structuredClone(raw['materialReader']);
  } catch {
    return { ok: false, rejection: reject('invalid', 'the call context identity cannot be isolated from the caller') };
  }
  if (!isObject(principal)) return { ok: false, rejection: reject('forbidden', 'a mailbox call requires a trusted principal') };
  if (principal['kind'] === 'query_run') {
    // The literal principal is the identity material; no resolver, round or
    // authority read happens here. The ref's shape and its bound scope are
    // checked, nothing more.
    const refProblem = checkShape(QueryRunRefShape, principal['queryRunRef'], 'stored');
    if (refProblem !== null) return { ok: false, rejection: reject('invalid', `a query_run mailbox call requires a complete QueryRunRef: ${refProblem}`) };
    const queryRunRef = principal['queryRunRef'] as QueryRunRef;
    if (queryRunRef.projectId !== projectId || queryRunRef.workspaceId !== workspaceId) {
      return { ok: false, rejection: reject('forbidden', 'the QueryRun belongs to another project/workspace') };
    }
    return {
      ok: true, projectId, workspaceId,
      principal: principal as unknown as MailboxPrincipal,
      reader: reader as unknown as MaterialReader,
      signal: signal as unknown as AbortSignal,
    };
  }
  if (principal['kind'] === 'host') {
    const actor = principal['actor'];
    if (!isObject(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
      return { ok: false, rejection: reject('forbidden', 'a Host mailbox call requires a trusted human/system actor') };
    }
    if (!isObject(reader) || reader['kind'] !== 'host' || reader['projectId'] !== projectId
      || reader['workspaceId'] !== workspaceId || !sameActor(reader['actor'], actor)) {
      return { ok: false, rejection: reject('forbidden', 'the Host material reader is not the same trusted scope') };
    }
    return {
      ok: true, projectId, workspaceId,
      principal: principal as unknown as MailboxPrincipal,
      reader: reader as unknown as MaterialReader,
      signal: signal as unknown as AbortSignal,
    };
  }
  if (principal['kind'] === 'work_run') {
    const runRef = principal['runRef'];
    if (!isRunRef(runRef)) return { ok: false, rejection: reject('invalid', 'a work_run mailbox call requires a complete RunRef') };
    if ((runRef as Unknown)['projectId'] !== projectId) {
      return { ok: false, rejection: reject('forbidden', 'the work_run Run belongs to another project') };
    }
    if (!isRoleBindingRef(principal['roleBinding'])) {
      return { ok: false, rejection: reject('invalid', 'the work_run role binding is not a RoleBindingRefV1') };
    }
    if (!isObject(reader) || reader['kind'] !== 'run' || !isRunRef(reader['requester'])
      || canonicalOf(reader['requester']) !== canonicalOf(runRef)) {
      return { ok: false, rejection: reject('forbidden', 'the work_run material reader does not name the caller Run') };
    }
    return {
      ok: true, projectId, workspaceId,
      principal: principal as unknown as MailboxPrincipal,
      reader: reader as unknown as MaterialReader,
      signal: signal as unknown as AbortSignal,
    };
  }
  return { ok: false, rejection: reject('forbidden', 'the mailbox principal kind is not recognized') };
}

type OwnedWrite<T> = {
  ok: true;
  input: T;
  requestId: string;
  expected: readonly VersionPin[];
} | { ok: false; rejection: CoreRejection };

function ownWrite<T>(request: GraphWrite<T>): OwnedWrite<T> {
  const raw = request as unknown as Unknown | null | undefined;
  if (raw === null || raw === undefined) return { ok: false, rejection: reject('invalid', 'a mailbox write requires a request object') };
  const meta = raw['meta'];
  if (!isObject(meta) || !nonEmpty(meta['requestId']) || !Array.isArray(meta['expected'])) {
    return { ok: false, rejection: reject('invalid', 'a mailbox write requires meta.requestId and meta.expected') };
  }
  try {
    return {
      ok: true,
      input: structuredClone(raw['input']) as T,
      requestId: meta['requestId'],
      expected: structuredClone(meta['expected']) as VersionPin[],
    };
  } catch {
    return { ok: false, rejection: reject('invalid', 'the mailbox request cannot be isolated from the caller') };
  }
}

// --------------------------------------------------------------------------
// Request normalization
// --------------------------------------------------------------------------

/** Send/respond text, kept on purpose: its capacity reason names the codec bound the machine cannot (`textBodyProblem`). */
function normalizeText(raw: unknown): { ok: true; text: string } | { ok: false; rejection: CoreRejection } {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, rejection: reject('invalid', 'message text must be a non-empty string') };
  if (Buffer.byteLength(raw, 'utf8') > SESSION_MESSAGE_MAX_TEXT_BYTES) {
    return { ok: false, rejection: reject('capacity', `message text exceeds ${SESSION_MESSAGE_MAX_TEXT_BYTES} UTF-8 bytes`) };
  }
  return { ok: true, text: raw };
}

function normalizeMessageRef(raw: unknown): { ok: true; ref: SessionMessageRef } | { ok: false; reason: string } {
  const problem = checkSessionMessageRef(raw);
  if (problem !== null) return { ok: false, reason: problem };
  return { ok: true, ref: structuredClone(raw) as SessionMessageRef };
}

function scopeOfMessageRef(owned: Owned, ref: SessionMessageRef): CoreRejection | null {
  if (ref.projectId !== owned.projectId || ref.workspaceId !== owned.workspaceId) {
    return reject('invalid', 'the message ref is outside the bound project/workspace');
  }
  return null;
}

/**
 * Slice 1 §2.9/§3.4: an internal archive wait-disposal step. It accepts no
 * `GraphWrite` meta: the commit identity is derived from the durable archive
 * request, and only the two disposal steps are accepted here.
 */
function normalizeArchiveStep(raw: unknown): { ok: true; step: ArchiveStepRefV1 } | { ok: false; rejection: CoreRejection } {
  if (!isObject(raw)) return { ok: false, rejection: reject('invalid', 'archive_input_invalid: a wait disposal requires an ArchiveStepRefV1') };
  if (Object.keys(raw).some((key) => !['sessionRef', 'archiveRequestId', 'requestReceipt', 'step', 'subjectKey'].includes(key))) {
    return { ok: false, rejection: reject('invalid', 'archive_input_invalid: the archive step carries unknown fields') };
  }
  const sessionProblem = checkPlainSessionRef(raw['sessionRef']);
  if (sessionProblem !== null) return { ok: false, rejection: reject('invalid', `archive_input_invalid: ${sessionProblem}`) };
  const name = raw['step'];
  if (name !== 'reply_handler' && name !== 'wait_cancel') {
    return { ok: false, rejection: reject('invalid', 'archive_input_invalid: the archive step is not a wait disposal') };
  }
  const receipt = raw['requestReceipt'];
  if (!isObject(receipt) || Object.keys(receipt).some((key) => key !== 'identityKey' && key !== 'fingerprint')
    || !nonEmpty(receipt['identityKey']) || !nonEmpty(receipt['fingerprint'])) {
    return { ok: false, rejection: reject('invalid', 'archive_input_invalid: the archive step needs the original request receipt') };
  }
  if (!nonEmpty(raw['archiveRequestId'])) {
    return { ok: false, rejection: reject('invalid', 'archive_input_invalid: the archive step needs an archiveRequestId') };
  }
  if (!nonEmpty(raw['subjectKey'])) {
    return { ok: false, rejection: reject('invalid', 'archive_input_invalid: the archive step needs a subjectKey') };
  }
  try {
    return { ok: true, step: structuredClone(raw) as unknown as ArchiveStepRefV1 };
  } catch {
    return { ok: false, rejection: reject('invalid', 'archive_input_invalid: the archive step cannot be isolated from the caller') };
  }
}

/**
 * Slice 1 §4.5 step 7: the wait choice a step records. `reply_handler` is the
 * transfer's first step; `wait_cancel` records a cancel for BOTH a transfer and
 * a cancel request (it cancels the original yielded wait, keeping any handler).
 */
function waitChoiceForStep(wait: ArchiveWaitChoiceV1 | null, step: ArchiveStepRefV1): ArchiveWaitChoiceV1 | null {
  if (wait === null) return null;
  if (step.step === 'reply_handler') return wait.kind === 'transfer' ? wait : null;
  return { kind: 'cancel', runRef: wait.runRef, messageRef: wait.messageRef };
}

/** Slice 1 S1-MSG-01: the target Session is same-workspace, active, not retired/archiving and not a readonly copy. */
function replyTargetEligible(owned: Owned, target: SessionRecord): boolean {
  const provenance = target.provenance ?? null;
  return target.workspaceId === owned.workspaceId
    && target.lifecycle === 'active'
    && target.health !== 'unavailable'
    && (target.archiveRequest ?? null) === null
    && (provenance === null || provenance.kind !== 'readonly_copy');
}

// --------------------------------------------------------------------------
// Message machine calls (STATE-MACHINES-SPEC §10)
// --------------------------------------------------------------------------

type Refused = Extract<MessageTransition, { ok: false }>;
type Accepted = Extract<MessageTransition, { ok: true }>;

/** A machine guard's refusal as today's rejection (§1.2: code and reason kept); `null` when it holds. */
function guardRejection(problem: Rejected | null): CoreRejection | null {
  return problem === null || problem.ok ? null : reject(problem.code, problem.detail);
}

/** The row's first guard refusing a write's principal; the write compares the kind itself only to narrow its principal. */
function principalRefusal(principal: MailboxPrincipal, event: Parameters<typeof messagePrincipalProblem>[0]): CoreRejection {
  const rejection = guardRejection(messagePrincipalProblem(event, principal.kind === 'query_run' ? 'other' : principal.kind));
  if (rejection === null) throw new Error(`the message machine admits the ${principal.kind} principal this write refused`);
  return rejection;
}

/**
 * The one version pin of ack, respond, MSG-06 and MSG-09: the machine's pin
 * guard, asked with the request before the receipt lookup. The row asks the
 * same facts again.
 */
function pinsOf(expected: readonly VersionPin[], ref: SessionMessageRef):
  { ok: true; pins: MessageGuardContext['pins'] } | { ok: false; rejection: CoreRejection } {
  const pin = expected.length === 1 && isObject(expected[0]) ? expected[0] as unknown as Unknown : null;
  const pins = {
    count: expected.length,
    matchesMessage: pin !== null && canonicalOf(pin['ref']) === canonicalOf(ref),
    revision: pin !== null && isPositiveInt(pin['revision']) ? pin['revision'] : null,
  };
  const rejection = guardRejection(messagePinProblem(pins));
  return rejection === null ? { ok: true, pins } : { ok: false, rejection };
}

/**
 * §10.1: the machine's verdict on the message read (`null` = absent), asked
 * with the caller principal and only the facts this write read or authorized.
 */
export function judge(principal: MailboxPrincipal, message: SessionMessage | null, event: MessageEvent,
  facts: Partial<Omit<MessageGuardContext, 'principal'>>): { decided: MessageTransition; ctx: MessageGuardContext } {
  const ctx: MessageGuardContext = {
    // The machine's send row only distinguishes the fresh work_run admission;
    // a resolved secretary send is a trusted non-work sender, like a Host.
    principal: principal.kind === 'work_run' ? 'work_run' : 'host',
    workRunAuthorization: null,
    callerIsRecipient: null,
    recipientScope: null,
    sendFlags: null,
    pins: { count: 0, matchesMessage: false, revision: null },
    bodyBounded: null,
    queryAnswer: null,
    inputAccepted: null,
    consumedWait: null,
    ...facts,
  };
  return { decided: transitionMessage(messageMachineStateOf(message), event, ctx), ctx };
}

/** The fresh work_run admission's own rejection when the refusal is its verdict (the machine passes it through). */
function admissionRefusalOf(refused: Refused, ctx: MessageGuardContext): CoreRejection | null {
  const admission = ctx.workRunAuthorization;
  if (admission === null || admission === 'ok') return null;
  return refused.reason === 'guard_failed' && refused.code === admission.code && refused.detail === admission.reason
    ? admission : null;
}

/** A machine refusal as the rejection today's service returned; a refused admission is its own rejection. */
export function refusalOf(refused: Refused, ctx: MessageGuardContext): CoreRejection {
  return admissionRefusalOf(refused, ctx) ?? reject(refused.code, refused.detail);
}

/** The three dispatch values are equal only when all three agree. */
export function sameBasis(left: DispatchBasisV1, right: DispatchBasisV1): boolean {
  return left.planRevision === right.planRevision
    && left.pointerRevision === right.pointerRevision
    && left.dispatchSequence === right.dispatchSequence;
}

/** The one consistent read's values plus its own cursor; the caller re-reads at it. */
export function dispatchCurrentOf(facts: DispatchBasisFactsV1): DispatchBasisV1 & { readCursor: CommitCursor } {
  return { ...facts.values, readCursor: facts.readCursor };
}

/** The version pins of the two records whose revisions the read knows: the Goal and the counter. */
export function basisPinsOf(facts: DispatchBasisFactsV1): VersionPin[] {
  const pins: VersionPin[] = [{ ref: structuredClone(facts.goal.ref), revision: facts.goal.revision }];
  if (facts.counter.record !== null) {
    pins.push({ ref: structuredClone(facts.counter.record.ref), revision: facts.counter.record.revision });
  }
  return pins;
}

/**
 * The companions of a message the same commit RELEASES (send's direct release and `releaseApproved`); the caller
 * calls it only then. Send's three conditions, word for word:
 * - the deadline `at + deadlineMs` is frozen, with the overflow refusal, when `deadlineMs !== null`
 *   (send `:2796–:2804`, whose other condition `release === 'released'` is the call condition);
 * - the counter +1 and the facts' guards are added when `intent === 'action_request' && basis !== null` (`:2807`);
 * - the recipient's activity advance is added when `intent !== 'notify'` (`:2817`).
 * The record order and the guard order are send's: counter record and guard, basis guards, activity record and guard.
 */
export async function releasedMessageCompanions(
  records: Pick<GoalRecordTransactionPort, 'readMany'>,
  input: {
    at: string;
    messageRef: SessionMessageRef;
    recipient: SessionRef;
    intent: SessionMessageIntentV1 | null;
    deadlineMs: number | null;
    basis: DispatchBasisFactsV1 | null;
  },
): Promise<
  | { ok: true; value: { records: EncodedRecord[]; guards: RecordGuard[]; deadline: string | null } }
  | { ok: false; rejection: CoreRejection }> {
  const { at, messageRef, recipient, intent, deadlineMs, basis } = input;
  const companionRecords: EncodedRecord[] = [];
  const companionGuards: RecordGuard[] = [];
  let deadline: string | null = null;
  if (deadlineMs !== null) {
    // The instant is representable iff the Date is; a fractional duration is
    // legal, an out-of-range one is refused before anything is written.
    const frozen = new Date(Date.parse(at) + deadlineMs);
    if (!Number.isFinite(frozen.getTime())) {
      return { ok: false, rejection: reject('invalid', 'the inquiry deadline overflows the representable instant') };
    }
    deadline = frozen.toISOString();
  }
  // A released action_request counts itself and carries the facts' guards; its
  // pins are the values before that +1.
  if (intent === 'action_request' && basis !== null) {
    const counted = basis.counter.record === null
      ? firstDispatch(basis.goal.ref, messageRef)
      : nextDispatch(basis.counter.record, messageRef);
    companionRecords.push(dispatchCounterCodec.encode(counted.record));
    companionGuards.push({ refKey: basis.counter.refKey, expectedRevision: counted.expectedRevision });
    companionGuards.push(...basis.guards);
  }
  // A released non-notify message advances the recipient Session; a notify,
  // a read and a replay never do.
  if (intent !== 'notify') {
    const planned = await planSessionActivityAdvance(records, {
      sessionRef: recipient, at, kind: 'input', source: messageRef,
    });
    if (!planned.ok) return { ok: false, rejection: planned.rejection };
    companionRecords.push(planned.record);
    companionGuards.push(activityGuardOf(planned.guard));
  }
  return { ok: true, value: { records: companionRecords, guards: companionGuards, deadline } };
}

/**
 * After a commit conflict whose `current` names one of `refKeys`, one more consistent read projects the
 * three values (send `:2843–:2865`). Any other conflict, or a failed re-read, returns `written` unchanged.
 */
export async function basisConflictCurrent<T extends WriteResult<unknown>>(
  written: T,
  refKeys: ReadonlySet<string>,
  readAgain: () => Promise<ReadResult<DispatchBasisFactsV1>>,
): Promise<T | SendRejectionV1> {
  if (written.status !== 'rejected' || written.code !== 'revision_conflict') return written;
  const named = (written.current ?? []).some((pin) => {
    const refKey = canonicalOf(pin.ref);
    return refKey !== null && refKeys.has(refKey);
  });
  if (!named) return written;
  let again: ReadResult<DispatchBasisFactsV1>;
  try {
    again = await readAgain();
  } catch {
    return written;
  }
  if (again.status !== 'ready') return written;
  return {
    ...reject('revision_conflict', 'the dispatch basis moved while the send committed', basisPinsOf(again.value)),
    dispatchCurrent: dispatchCurrentOf(again.value),
  };
}

const MIN_CURSOR: CommitCursor = makeCommitCursor(1);

function cursorSequence(cursor: unknown): number | null {
  if (typeof cursor !== 'string') return null;
  try {
    return seqOfCommitCursor(cursor as CommitCursor);
  } catch {
    return null;
  }
}

/** A synchronously snapshotted `atLeastCursor`: its comparable sequence and the raw cursor. */
type AtLeastCursor = { seq: number; cursor: CommitCursor };

/**
 * The mailbox reads' watermark rule, moved unchanged from the closure (`:1405–:1434`, `lr7` 4): a page must have
 * observed `atLeast`, and a null read-through reports the minimum (`not_ready`, `observed: null`). R's candidate read
 * calls it with `atLeast` undefined.
 */
export function readProgress(
  readThrough: CommitCursor | null,
  atLeast: AtLeastCursor | undefined,
): { ok: true; readThrough: CommitCursor } | { ok: false; result: ReadResult<never> } {
  if (atLeast !== undefined) {
    const observed = readThrough === null ? null : cursorSequence(readThrough);
    if (observed === null || observed < atLeast.seq) {
      return {
        ok: false,
        result: {
          status: 'not_ready',
          observed: readThrough === null ? null : { kind: 'platform', cursor: readThrough },
          required: { kind: 'platform', cursor: atLeast.cursor },
        },
      };
    }
  }
  if (readThrough === null) {
    return {
      ok: false,
      result: { status: 'not_ready', observed: null, required: { kind: 'platform', cursor: MIN_CURSOR } },
    };
  }
  return { ok: true, readThrough };
}

/** The Session a message's sender is, when its sender kind names one. */
function messageSenderSessionOf(message: SessionMessage): SessionRef | null {
  if (message.sender.kind === 'work_run' || message.sender.kind === 'secretary_round') {
    return { projectId: message.sender.sessionRef.projectId, sessionId: message.sender.sessionRef.sessionId };
  }
  return null;
}

function sameSessionRefAs(left: SessionRef | null, right: SessionRef | null): boolean {
  return left !== null && right !== null
    && left.projectId === right.projectId && left.sessionId === right.sessionId;
}

/** `followupOf`: an existing message between the same two Sessions, either direction. */
function followupConnects(message: SessionMessage, sender: MessageSender, recipient: SessionRef): boolean {
  const addressed = message.recipient;
  if (isUserRecipient(addressed)) return false;
  const to: SessionRef = { projectId: addressed.projectId, sessionId: addressed.sessionId };
  const from = messageSenderSessionOf(message);
  if (sender.kind === 'work_run' || sender.kind === 'secretary_round') {
    return (sameSessionRefAs(from, sender.sessionRef) && sameSessionRefAs(to, recipient))
      || (sameSessionRefAs(from, recipient) && sameSessionRefAs(to, sender.sessionRef));
  }
  // A Host sender has no Session of its own: the follow-up is between the
  // recipient and the message's other Session.
  return sameSessionRefAs(from, recipient) || sameSessionRefAs(to, recipient);
}

/**
 * MSG-06's consultation binding in today's check order. A derived A′ answer is
 * answered by the CHILD Session, while the original message recipient (source
 * A) stays the formal source: the two are never conflated and the derivation
 * must name that exact source.
 */
function consultationBindingOf(job: QueryJobSnapshot, run: QueryRunSnapshot, messageRef: SessionMessageRef, recipient: SessionRef): {
  binding: QueryAnswerBinding; answererSession: SessionRef | null;
} {
  const execution = job.job.intent.execution;
  const consultation = execution.consultation;
  if (execution.kind !== 'semantic_query' || consultation === undefined) {
    return { binding: 'other_message', answererSession: null };
  }
  if (canonicalOf(consultation.messageRef) !== canonicalOf(messageRef)) return { binding: 'other_message', answererSession: null };
  if (canonicalOf(consultation.recipient) !== canonicalOf(recipient)) return { binding: 'other_recipient', answererSession: null };
  const derivation = consultation.derivation;
  if (derivation !== undefined && canonicalOf(derivation.sourceSessionRef) !== canonicalOf(recipient)) {
    return { binding: 'other_derivation_source', answererSession: null };
  }
  const answererSession = derivation === undefined
    ? recipient
    : { projectId: derivation.childSessionRef.projectId, sessionId: derivation.childSessionRef.sessionId };
  const refs = consultationQueryRefs(consultation.messageRef);
  if (refs.queryJobRef.queryJobId !== job.job.queryJobId || refs.queryRunRef.runId !== run.run.runId) {
    return { binding: 'other_query_identity', answererSession };
  }
  return { binding: 'matches', answererSession };
}

/** An accepted MSG-03..09 change names an existing message (an absent one is `not_found`). */
function acceptedMessage(message: SessionMessage | null): SessionMessage {
  if (message === null) throw new Error('the message machine accepted a change of an absent message');
  return message;
}

type MessageCommitPlan = {
  /** `store_body`: stored and verified BEFORE the commit, outside the transaction. */
  body: Extract<MessageEffect, { kind: 'store_body' }> | null;
  /** `append_event`: the event appended in the commit. */
  eventType: SessionMessageEventType;
  /** `guard_message`: `null` = the message must not exist yet (send CAS@0). */
  messageRevision: number | null;
  /** `guard_work_run_facts`: the admission's Run, Session, Lease and role guards join the commit. */
  workRunFacts: boolean;
};

/**
 * An accepted write's effects (§10.3). `write_message` is the record the write
 * builds with the machine's constructor, which must be the machine's `next`.
 */
function messageCommitPlan(effects: readonly MessageEffect[]): MessageCommitPlan {
  let body: MessageCommitPlan['body'] = null;
  let eventType: SessionMessageEventType | null = null;
  let messageRevision: number | null | undefined;
  let workRunFacts = false;
  let written = false;
  for (const effect of effects) {
    switch (effect.kind) {
      case 'store_body':
        body = effect;
        break;
      case 'write_message':
        written = true;
        break;
      case 'append_event':
        eventType = effect.eventType;
        break;
      case 'guard_message':
        messageRevision = effect.expectedRevision;
        break;
      case 'guard_work_run_facts':
        workRunFacts = true;
        break;
      default:
        return unreachable(effect, 'message effect');
    }
  }
  if (!written || eventType === null || messageRevision === undefined) {
    throw new Error('an accepted message write names its record, its event and its message CAS');
  }
  return { body, eventType, messageRevision, workRunFacts };
}

/** The fields every SessionMessage event carries between its type and its actor, in today's key order. */
type MessageEventEnvelope = { schemaVersion: 1; occurredAt: string; projectId: string; workspaceId: string; requestId: string };

/**
 * Slice 1 §2.9: the wait-disposal replay event carries the changed message
 * and source Session plus the exact step. It has no actor/requestId; the
 * commit identity (and the original operator) come from the durable request.
 * Every other message event is encoded by the one writer's `encodePersistEvent`;
 * this is the only event outside it, because the disposal commit also writes
 * the source Session.
 */
function encodeArchiveWaitDisposalEvent(eventId: string, envelope: MessageEventEnvelope, message: SessionMessage,
  disposal: { source: SessionRecord; archiveStep: ArchiveStepRefV1 }): EncodedDomainEvent {
  return encodeArchiveWaitDisposedEvent({
    eventId, eventType: 'ArchiveWaitDisposed',
    schemaVersion: envelope.schemaVersion, occurredAt: envelope.occurredAt,
    projectId: envelope.projectId, workspaceId: envelope.workspaceId,
    message, source: disposal.source, archiveStep: disposal.archiveStep,
  });
}

// --------------------------------------------------------------------------
// Identity, messageId and fingerprints
// --------------------------------------------------------------------------

function senderIdentityOf(sender: MessageSender | MessageQueryAnswerSender): Unknown {
  if (sender.kind === 'host') return { kind: 'host', actor: { ...sender.actor } };
  if (sender.kind === 'work_run') {
    return {
      kind: 'work_run',
      sessionRef: { ...sender.sessionRef },
      runRef: { ...sender.runRef },
      generation: sender.generation,
    };
  }
  if (sender.kind === 'secretary_round') return { kind: 'query_run', queryRunRef: { ...sender.queryRunRef } };
  return {
    kind: 'query_run',
    sessionRef: { ...sender.sessionRef },
    queryRunRef: { ...sender.queryRunRef },
    answerRef: { ...sender.answerRef },
    generation: sender.generation,
  };
}

function identityKeyOf(operation: string, scope: MailboxScope, senderIdentity: Unknown, requestId: string): string {
  return `session-message-${operation}:` + sha256Hex(canonicalJson({
    operation, projectId: scope.projectId, workspaceId: scope.workspaceId, sender: senderIdentity, requestId,
  } as unknown as JsonValue));
}

function fingerprintOf(operation: string, scope: MailboxScope, senderIdentity: Unknown, payload: Unknown, expected: readonly VersionPin[]): string {
  const pins = [...expected]
    .map((pin) => ({ ref: pin.ref, revision: pin.revision }))
    .sort((left, right) => {
      const leftKey = canonicalOf(left.ref) ?? '';
      const rightKey = canonicalOf(right.ref) ?? '';
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return sha256Hex(canonicalJson({
    operation, projectId: scope.projectId, workspaceId: scope.workspaceId, sender: senderIdentity, payload, expected: pins,
  } as unknown as JsonValue));
}

function messageIdOf(owned: Owned, senderIdentity: Unknown, requestId: string): string {
  return 'session-message-' + sha256Hex(canonicalJson({
    projectId: owned.projectId, workspaceId: owned.workspaceId, sender: senderIdentity, requestId,
  } as unknown as JsonValue));
}

/**
 * K3 L4: the Run record's `origin.sessionRef` is a `SessionAggregateRef`
 * (`aggregateType: 'Session'`), while the live `sendMessage` bound a plain
 * `SessionRef`; the Run ref keeps its `Run` tag on both sides. Normalize the
 * two refs so the rebuilt request id, sender identity and scope hash exactly
 * the identity the original Run committed.
 */
function normalizedLookupOrigin(origin: ToolCommitLookupInput['origin']): ToolCommitLookupInput['origin'] {
  return {
    runRef: { aggregateType: 'Run', projectId: origin.runRef.projectId, goalId: origin.runRef.goalId, runId: origin.runRef.runId },
    sessionRef: { projectId: origin.sessionRef.projectId, sessionId: origin.sessionRef.sessionId },
    generation: origin.generation,
    workspaceId: origin.workspaceId,
  };
}

/** Each event's id under its write identity. */
const EVENT_ID_SUFFIX: Record<SessionMessageEventType, string> = {
  SessionMessageSent: 'sent',
  SessionMessageRead: 'read',
  SessionMessageResponded: 'responded',
  SessionMessageConsultationDerived: 'consultation-derived',
  SessionMessageInputAccepted: 'input-accepted',
  ArchiveWaitDisposed: 'archive-wait-disposed',
  SessionMessageDecisionAnswered: 'decision-answered',
  SessionMessageDecisionApplied: 'decision-applied',
  SessionMessageWithdrawn: 'withdrawn',
  SessionMessageReleaseDecided: 'release-decided',
  SessionMessageReleased: 'released',
  SessionMessageApplied: 'applied',
};

export function eventIdOf(identityKey: string, eventType: SessionMessageEventType): string {
  return sha256Hex(`${identityKey}|${EVENT_ID_SUFFIX[eventType]}`);
}

// --------------------------------------------------------------------------
// Inbox cursor: binds scope, recipient, filter, caller and the after key only.
// --------------------------------------------------------------------------

type InboxCursorV1 = {
  v: 1;
  projectId: string;
  workspaceId: string;
  recipient: SessionRef;
  status: SessionMessageStatus | null;
  callerKey: string;
  after: string;
};

function encodeInboxCursor(cursor: InboxCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeInboxCursor(raw: string): InboxCursorV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed['v'] !== 1) return null;
  const { projectId, workspaceId, recipient, status, callerKey, after } = parsed;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || !nonEmpty(callerKey) || !nonEmpty(after)) return null;
  if (!isObject(recipient) || !nonEmpty(recipient['projectId']) || !nonEmpty(recipient['sessionId'])) return null;
  if (!(status === null || status === 'pending' || status === 'read' || status === 'responded')) return null;
  return {
    v: 1, projectId, workspaceId,
    recipient: { projectId: recipient['projectId'], sessionId: recipient['sessionId'] },
    status, callerKey, after,
  };
}

// --------------------------------------------------------------------------
// Outbox cursor: binds scope, the exact sender Run, the caller and the after
// key only. It is a SEPARATE cursor namespace from the inbox.
// --------------------------------------------------------------------------

type OutboxCursorV1 = {
  v: 1;
  projectId: string;
  workspaceId: string;
  senderRun?: RunRef;
  senderSession?: SessionRef;
  callerKey: string;
  after: string;
};

function encodeOutboxCursor(cursor: OutboxCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeOutboxCursor(raw: string): OutboxCursorV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed['v'] !== 1) return null;
  const { projectId, workspaceId, senderRun, senderSession, callerKey, after } = parsed;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || !nonEmpty(callerKey) || !nonEmpty(after)) return null;
  if ((senderRun === undefined) === (senderSession === undefined)) return null;
  if (senderRun !== undefined && !isRunRef(senderRun)) return null;
  if (senderSession !== undefined && checkPlainSessionRef(senderSession) !== null) return null;
  return { v: 1, projectId, workspaceId, callerKey, after,
    ...(senderRun === undefined ? { senderSession: senderSession as SessionRef } : { senderRun: senderRun as RunRef }) };

}

// --------------------------------------------------------------------------
// Secretary outbox cursor: a FOURTH keyset namespace. It binds the scope, the
// resolved request root, the caller and the after key; a Host/work_run cursor
// never satisfies it.
// --------------------------------------------------------------------------

type SecretaryOutboxCursorV1 = {
  v: 1;
  projectId: string;
  workspaceId: string;
  requestRoot: QueryJobRef;
  callerKey: string;
  after: string;
};

function encodeSecretaryOutboxCursor(cursor: SecretaryOutboxCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeSecretaryOutboxCursor(raw: string): SecretaryOutboxCursorV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed['v'] !== 1) return null;
  const { projectId, workspaceId, requestRoot, callerKey, after } = parsed;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || !nonEmpty(callerKey) || !nonEmpty(after)) return null;
  if (checkShape(QueryJobRefShape, requestRoot, 'stored') !== null) return null;
  return { v: 1, projectId, workspaceId, requestRoot: requestRoot as QueryJobRef, callerKey, after };
}

// --------------------------------------------------------------------------
// Reply cursor: binds scope, the exact source/handler Session, the kind and the
// caller to the after key. It is a THIRD keyset namespace (inbox/outbox/reply).
// --------------------------------------------------------------------------

type ReplyCursorV1 = {
  v: 1;
  kind: 'routed' | 'undelivered';
  projectId: string;
  workspaceId: string;
  sessionId: string;
  callerKey: string;
  after: string;
};

function encodeReplyCursor(cursor: ReplyCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeReplyCursor(raw: string): ReplyCursorV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed['v'] !== 1) return null;
  const { kind, projectId, workspaceId, sessionId, callerKey, after } = parsed;
  if (kind !== 'routed' && kind !== 'undelivered') return null;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || !nonEmpty(sessionId) || !nonEmpty(callerKey) || !nonEmpty(after)) return null;
  return { v: 1, kind, projectId, workspaceId, sessionId, callerKey, after };
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// One body-storage implementation (SPEC §3.3 line 684)
// --------------------------------------------------------------------------
//
// The original send/respond path (`storePlannedBody`) and the write-owner
// facade (`createMessageWriteOwner.storeBody`) share THIS one implementation.
// Each caller keeps its ORIGINAL operation identity (the `bodyRequestId` it
// passes), so the C1/C2 receipts and bytes are unchanged.

type MessageBodySender = MessageSender | MessageQueryAnswerSender | DecisionHostSenderV1;

/** The internal platform body executor; never the command actor. */
function hostWriterContext(deps: SessionMailboxDependencies, owned: Owned): CoreCallContext {
  const actor: HostActor = { kind: deps.systemActor.kind, id: deps.systemActor.id };
  return {
    projectId: owned.projectId,
    workspaceId: owned.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: owned.projectId, workspaceId: owned.workspaceId, actor: { ...actor } },
    signal: owned.signal,
  };
}

/** The current Workspace source revision a generic body is bound to. */
async function readCurrentWorkspaceSource(records: SessionMailboxDependencies['records'], owned: Owned): Promise<
  { ok: true; value: ArtifactRef['source'] } | { ok: false; rejection: CoreRejection }> {
  const key = canonicalRefKey({ aggregateType: 'Workspace', projectId: owned.projectId, workspaceId: owned.workspaceId });
  let read: StoreResult<RecordBatchRead>;
  try {
    read = await records.readMany([key]);
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the workspace source revision could not be read') };
  }
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) return { ok: false, rejection: reject('unavailable', 'the workspace source record is missing') };
  const decoded = decodeWorkspaceSnapshot(record);
  if (decoded.status !== 'decoded') {
    return { ok: false, rejection: reject('unavailable', `the workspace source record is damaged: ${decoded.reason}`) };
  }
  return { ok: true, value: { kind: 'workspace', refId: owned.workspaceId, revision: String(decoded.value.revision) } };
}

async function verifyStoredMessageBody(deps: SessionMailboxDependencies, owned: Owned, ref: ArtifactRef,
  expectedBody: string, expectedSource?: ArtifactRef['source']): Promise<{ ok: true } | { ok: false; rejection: CoreRejection }> {
  if (ref.contentType !== SESSION_MESSAGE_CONTENT_TYPE) {
    return { ok: false, rejection: reject('unavailable', 'the stored message body contentType disagrees with the expected envelope') };
  }
  if (expectedSource !== undefined) {
    // A formal Query answer reply keeps the ACTUAL source of the verified
    // Answer body (possibly an earlier workspace revision); the generic
    // current-workspace check must not rewrite that provenance.
    if (canonicalOf(ref.source) !== canonicalOf(expectedSource)) {
      return { ok: false, rejection: reject('unavailable', 'the stored message body provenance is not the verified Query answer source') };
    }
  } else if (ref.source.kind !== 'workspace' || ref.source.refId !== owned.workspaceId || !nonEmpty(ref.source.revision)) {
    // The original body provenance is authoritative: it must be a legal
    // workspace source for THIS workspace. It need not be the CURRENT revision,
    // because a deduplicated body keeps its first writer's source.
    return { ok: false, rejection: reject('unavailable', 'the stored message body provenance is not a legal source for this workspace') };
  }
  if (ref.sizeBytes !== Buffer.byteLength(expectedBody, 'utf8')) {
    return { ok: false, rejection: reject('unavailable', 'the stored message body size disagrees with the expected envelope') };
  }
  const systemCtx = hostWriterContext(deps, owned);
  if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the message body verification was cancelled') };
  let opened: ReadResult<ArtifactRecord>;
  try {
    opened = await deps.materials.openArtifact(systemCtx, { ref, usage: 'historical_explanation' });
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the stored message body could not be read back') };
  }
  if (opened.status === 'not_found') return { ok: false, rejection: reject('unavailable', 'the stored message body is missing') };
  if (opened.status !== 'ready') return { ok: false, rejection: mapReadResult(opened) as CoreRejection };
  const stored = opened.value;
  // A full ref equality already includes its source; the second comparison is
  // pure duplication. The body, source and provenance checks stay.
  if (canonicalOf(stored.ref) !== canonicalOf(ref)) {
    return { ok: false, rejection: reject('unavailable', 'the stored message body ref is not the requested ref') };
  }
  if (stored.body !== expectedBody) {
    return { ok: false, rejection: reject('unavailable', 'the stored message body does not match the canonical scoped envelope') };
  }
  if (!stored.sourceRefs.some((candidate) => canonicalOf(candidate) === canonicalOf(ref.source))) {
    return { ok: false, rejection: reject('unavailable', 'the stored message body source disagrees with its own ref') };
  }
  return { ok: true };
}

/** Store + verify one bounded body envelope with the current workspace provenance. */
async function storeScopedMessageBody(deps: SessionMailboxDependencies, args: {
  owned: Owned;
  sender: MessageBodySender;
  part: 'message' | 'response';
  messageRef: SessionMessageRef;
  text: string;
  sourceRef: ArtifactRef['source'];
  /** When set, the saved body provenance must equal this exact source instead
   * of the generic current-workspace check. Used ONLY for a formal Query
   * answer reply, whose original source may be an earlier workspace revision. */
  expectedSource?: ArtifactRef['source'];
  bodyRequestId: string;
}): Promise<ReadResult<{ bodyRef: ArtifactRef; sourceRef: ArtifactRef['source'] }>> {
  const { owned, sender, part, messageRef, text, sourceRef, expectedSource, bodyRequestId } = args;
  const envelope: Unknown = {
    schemaVersion: 1, projectId: messageRef.projectId, workspaceId: messageRef.workspaceId,
    messageId: messageRef.messageId, part, sender, text,
  };
  let body: string;
  try {
    body = canonicalJson(envelope as unknown as JsonValue);
  } catch {
    return reject('invalid', 'the message body envelope is not canonicalizable JSON');
  }
  const systemCtx = hostWriterContext(deps, owned);
  if (owned.signal.aborted) return reject('cancelled', 'the message body store was cancelled');
  let stored: Awaited<ReturnType<SessionMailboxDependencies['materials']['storeArtifact']>>;
  try {
    stored = await deps.materials.storeArtifact(systemCtx, {
      contentType: SESSION_MESSAGE_CONTENT_TYPE,
      body,
      sources: [sourceRef],
      origin: {
        kind: 'platform_operation', projectId: owned.projectId, workspaceId: owned.workspaceId,
        requestId: bodyRequestId, actor: { kind: deps.systemActor.kind, id: deps.systemActor.id },
      },
    });
  } catch {
    return reject('unavailable', 'the message body store failed before completing');
  }
  if (stored.status !== 'stored') {
    const code: CoreError = stored.code === 'size_exceeded' ? 'capacity' : stored.code === 'missing_source' ? 'invalid' : stored.code;
    return reject(code, `the message body was not stored: ${stored.reason}`);
  }
  const verified = await verifyStoredMessageBody(deps, owned, stored.ref, body, expectedSource);
  if (!verified.ok) return verified.rejection;
  return { status: 'ready', value: { bodyRef: stored.ref, sourceRef: stored.ref.source } };
}

export function createSessionMailbox(deps: SessionMailboxDependencies): SessionMailboxWithUserSend {
  const records = deps.records;
  // SPEC §3.3 line 684: the original send/respond/ack/user-send paths commit
  // through the SAME `createMessageWriteOwner` facade the decision service uses
  // (`writeMessage` below is only the body+record builder that calls it), so
  // there is one writer, one replay and one CAS rule for every SessionMessage.
  const messageWrites = createMessageWriteOwner(deps);

  function internalHostContext(owned: Owned): CoreCallContext {
    return hostWriterContext(deps, owned);
  }

  /**
   * The page-base checks every paginated mailbox read shares, in order: the page
   * object, no extra fields, an integer limit 1..100. Each read supplies its own
   * exact texts; the raw cursor values are snapshotted here, synchronously.
   */
  function pageProblem(page: unknown, texts: {
    requiresObject: string;
    extraFields: string;
    limit: string;
  }): { ok: true; limit: number; rawCursor: unknown; rawAtLeast: unknown }
    | { ok: false; rejection: CoreRejection } {
    if (!isObject(page)) return { ok: false, rejection: reject('invalid', texts.requiresObject) };
    if (Object.keys(page).some((key) => key !== 'limit' && key !== 'cursor' && key !== 'atLeastCursor')) {
      return { ok: false, rejection: reject('invalid', texts.extraFields) };
    }
    const limit = page['limit'];
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return { ok: false, rejection: reject('invalid', texts.limit) };
    }
    return { ok: true, limit, rawCursor: page['cursor'], rawAtLeast: page['atLeastCursor'] };
  }

  /** Parses the snapshotted `atLeastCursor`; its invalid text is the same for all four reads. */
  function atLeastCursorOf(rawAtLeast: unknown):
  { ok: true; atLeast: AtLeastCursor | undefined } | { ok: false; rejection: CoreRejection } {
    if (rawAtLeast === undefined) return { ok: true, atLeast: undefined };
    const seq = cursorSequence(rawAtLeast);
    if (seq === null) return { ok: false, rejection: reject('invalid', 'atLeastCursor is not a ledger commit cursor') };
    return { ok: true, atLeast: { seq, cursor: rawAtLeast as CommitCursor } };
  }

  // ---- exact Run/outbox/Session identity (historical reads) ---------------

  type FactsOutcome = { ok: true; record: TaskExecutionRecord } | { ok: false; rejection: CoreRejection };

  /** The fresh full WG11 snapshot a NEW work_run write needs. */
  async function readFreshWorkRunFacts(owned: Owned, runRef: WorkRunPrincipal['runRef']): Promise<FactsOutcome> {
    if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox write was cancelled before locating the Run') };
    let result: ReadResult<TaskExecutionRecord>;
    try {
      result = await deps.executions.readExecution(internalHostContext(owned), runRef);
    } catch {
      return { ok: false, rejection: reject('unavailable', 'the formal execution facts could not be read') };
    }
    if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox write was cancelled during the execution read') };
    if (result.status === 'ready') return { ok: true, record: result.value };
    if (result.status === 'not_found') return { ok: false, rejection: reject('not_found', 'the formal execution Run does not exist') };
    if (result.status === 'not_ready') return { ok: false, rejection: reject('incomplete', 'the formal execution Run is not readable at the required watermark') };
    return { ok: false, rejection: result };
  }

  type IdentityOutcome =
    | { ok: true; run: RunSnapshot; claim: TaskClaimOutbox['claim']; session: SessionRecord }
    | { ok: false; rejection: CoreRejection };

  function presenceOf(batch: ReadBatch, key: string): 'present' | 'missing' | 'unaccounted' {
    if (batch.present.has(key)) return 'present';
    if (batch.missing.has(key)) return 'missing';
    return 'unaccounted';
  }
  function mapBatchFailure(result: { code: CoreError; reason: string }): CoreRejection {
    return reject(result.code, result.reason);
  }

  /**
   * Historical identity loader: exactly the Run, its claim-linked outbox and the
   * Session those name. It deliberately does NOT read the Plan, TaskAttempt or
   * TaskLease, so an unrelated missing/faulty record can never block reading a
   * committed message. It proves the complete RunRef, the original Role binding,
   * the claim/attempt/Session association, the workspace and the reader/requester
   * (the latter already bound by `ownContext`) from one final consistent window.
   * It is a read-only identity proof, never a current write permit.
   */
  async function readWorkRunIdentity(owned: Owned, principal: WorkRunPrincipal, runRef: WorkRunPrincipal['runRef']): Promise<IdentityOutcome> {
    const runKey = canonicalOf(runRef);
    if (runKey === null) return { ok: false, rejection: reject('invalid', 'the Run ref is not canonicalizable JSON') };
    for (let round = 0; round < 4; round += 1) {
      if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox read was cancelled before locating the Run') };
      const runRead = await readBatch(records, [runKey]);
      if (runRead.status !== 'ready') return { ok: false, rejection: mapBatchFailure(runRead) };
      const runPresence = presenceOf(runRead.batch, runKey);
      if (runPresence === 'missing') return { ok: false, rejection: reject('not_found', 'the formal execution Run does not exist') };
      if (runPresence === 'unaccounted') return { ok: false, rejection: reject('unavailable', 'the Run key was neither returned nor reported missing') };
      const runDecoded = decodeRun(runRead.batch.present.get(runKey) as EncodedRecord);
      if (!runDecoded.ok) return { ok: false, rejection: reject('unavailable', `the Run is damaged: ${runDecoded.reason}`) };
      const discovered = runDecoded.value;
      const outboxKey = dispatchOutboxRefKey({
        aggregateType: 'DispatchOutboxEntry', projectId: discovered.task.projectId,
        goalId: discovered.task.goalId, taskId: discovered.task.taskId, attemptId: discovered.attemptId,
      });
      const outboxRead = await readBatch(records, [outboxKey]);
      if (outboxRead.status !== 'ready') return { ok: false, rejection: mapBatchFailure(outboxRead) };
      const outboxPresence = presenceOf(outboxRead.batch, outboxKey);
      if (outboxPresence === 'unaccounted') return { ok: false, rejection: reject('unavailable', 'the claim outbox was neither returned nor reported missing') };
      if (outboxPresence === 'missing') return { ok: false, rejection: reject('incomplete', 'the claim-linked dispatch outbox is missing') };
      const linked = decodeDispatchOutboxEntry(outboxRead.batch.present.get(outboxKey) as EncodedRecord);
      if (linked.status !== 'decoded') return { ok: false, rejection: reject('unavailable', `the dispatch outbox is damaged: ${linked.reason}`) };
      const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(linked.value.claim.sessionRef));

      const finalKeys = [...new Set([runKey, outboxKey, sessionKey])];
      const finalRead = await readBatch(records, finalKeys);
      if (finalRead.status !== 'ready') return { ok: false, rejection: mapBatchFailure(finalRead) };
      for (const key of finalKeys) {
        if (presenceOf(finalRead.batch, key) === 'unaccounted') {
          return { ok: false, rejection: reject('unavailable', 'a requested identity key was neither returned nor reported missing') };
        }
      }
      if (presenceOf(finalRead.batch, runKey) === 'missing') return { ok: false, rejection: reject('not_found', 'the formal execution Run does not exist') };
      if (presenceOf(finalRead.batch, outboxKey) === 'missing') return { ok: false, rejection: reject('incomplete', 'the claim-linked dispatch outbox is missing') };
      if (presenceOf(finalRead.batch, sessionKey) === 'missing') return { ok: false, rejection: reject('incomplete', 'the claim-linked Session is missing') };
      const finalRunDecoded = decodeRun(finalRead.batch.present.get(runKey) as EncodedRecord);
      if (!finalRunDecoded.ok) return { ok: false, rejection: reject('unavailable', `the Run is damaged: ${finalRunDecoded.reason}`) };
      const finalRun = finalRunDecoded.value;
      const finalLinked = decodeDispatchOutboxEntry(finalRead.batch.present.get(outboxKey) as EncodedRecord);
      if (finalLinked.status !== 'decoded') return { ok: false, rejection: reject('unavailable', `the dispatch outbox is damaged: ${finalLinked.reason}`) };
      const finalOutbox = finalLinked.value;
      const finalSessionDecoded = decodeSessionRecord(finalRead.batch.present.get(sessionKey) as EncodedRecord);
      if (finalSessionDecoded.status !== 'decoded') return { ok: false, rejection: reject('unavailable', `the Session is damaged: ${finalSessionDecoded.reason}`) };
      const session = finalSessionDecoded.value;

      const finalOutboxKey = dispatchOutboxRefKey({
        aggregateType: 'DispatchOutboxEntry', projectId: finalRun.task.projectId,
        goalId: finalRun.task.goalId, taskId: finalRun.task.taskId, attemptId: finalRun.attemptId,
      });
      const finalSessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(finalOutbox.claim.sessionRef));
      if (finalOutboxKey !== outboxKey || finalSessionKey !== sessionKey) continue;

      if (canonicalOf(finalRun.ref) !== runKey) return { ok: false, rejection: reject('unavailable', 'the Run ref is not the requested key') };
      // The trusted principal's ORIGINAL binding identity must be the persisted
      // Run binding. A later Role-matrix revocation is deliberately NOT evaluated
      // here, so a committed receipt/read is never erased by a governance change.
      if (canonicalOf(principal.roleBinding) !== canonicalOf(finalRun.roleBinding)) {
        return { ok: false, rejection: reject('forbidden', 'the caller role binding is not the persisted Run role binding') };
      }
      if (finalRun.task.projectId !== owned.projectId) return { ok: false, rejection: reject('forbidden', 'the Run belongs to another project') };
      const claim = finalOutbox.claim;
      if (canonicalOf(claim.runRef) !== runKey) return { ok: false, rejection: reject('unavailable', 'the claim names another Run') };
      if (canonicalOf(claim.attemptRef) !== canonicalOf({
        aggregateType: 'TaskAttempt', projectId: finalRun.task.projectId, goalId: finalRun.task.goalId,
        taskId: finalRun.task.taskId, attemptId: finalRun.attemptId,
      })) return { ok: false, rejection: reject('unavailable', 'the claim names another Attempt than the Run') };
      if (claim.workspaceId !== owned.workspaceId || finalRun.workspaceSnapshot.workspaceId !== owned.workspaceId
        || session.workspaceId !== owned.workspaceId) {
        return { ok: false, rejection: reject('forbidden', 'the Run/claim/Session workspace is not the bound workspace') };
      }
      if (canonicalOf(session.ref) !== sessionKey) return { ok: false, rejection: reject('unavailable', 'the Session ref is not the claimed key') };
      if (claim.sessionRef.projectId !== session.ref.projectId || claim.sessionRef.sessionId !== session.ref.sessionId) {
        return { ok: false, rejection: reject('unavailable', 'the claim Session mapping changed') };
      }
      return { ok: true, run: finalRun, claim, session };
    }
    return { ok: false, rejection: reject('busy', 'the execution identity references changed in every final read window') };
  }

  function deriveWorkRunSender(identity: { run: RunSnapshot; claim: TaskClaimOutbox['claim'] }): { ok: true; sender: MessageWorkRunSender } | { ok: false; rejection: CoreRejection } {
    const claim = identity.claim;
    if (!isPositiveInt(claim.generation)) return { ok: false, rejection: reject('unavailable', 'the claim generation is not readable') };
    if (!isObject(identity.run.roleBinding)) return { ok: false, rejection: reject('unavailable', 'the Run role binding is not readable') };
    const sender: MessageWorkRunSender = {
      kind: 'work_run',
      sessionRef: { projectId: claim.sessionRef.projectId, sessionId: claim.sessionRef.sessionId },
      runRef: { aggregateType: 'Run', projectId: identity.run.ref.projectId, goalId: identity.run.ref.goalId, runId: identity.run.ref.runId },
      roleBinding: {
        schemaVersion: 1,
        bindingId: identity.run.roleBinding.bindingId,
        templateId: identity.run.roleBinding.templateId,
        templateRevision: identity.run.roleBinding.templateRevision,
        bindingVersion: identity.run.roleBinding.bindingVersion,
        policyRevision: identity.run.roleBinding.policyRevision,
      },
      generation: claim.generation,
    };
    return { ok: true, sender };
  }

  // ---- new work_run action authorization ----------------------------------

  type AuthOutcome = { ok: true; guards: RecordGuard[] } | { ok: false; rejection: CoreRejection };

  /** The saved manifest must describe exactly the same formal claim/envelope/Session. */
  function manifestAgainstRun(manifest: PreparedTaskManifestV1, record: TaskExecutionRecord, bodyDigest: string,
    authorization: ExecutionAuthorizationV2): CoreRejection | null {
    const { run, outbox, session } = record;
    if (canonicalOf(manifest.claim) !== canonicalOf(outbox.claim)) return reject('forbidden', 'the saved manifest claim disagrees with the persisted claim');
    if (canonicalOf(manifest.roleBinding) !== canonicalOf(run.roleBinding)) return reject('forbidden', 'the saved manifest role binding disagrees with the Run');
    if (canonicalOf(manifest.workspaceSnapshot) !== canonicalOf(run.workspaceSnapshot)) return reject('forbidden', 'the saved manifest workspace snapshot disagrees with the Run');
    if (canonicalOf(manifest.budget) !== canonicalOf(run.budget)) return reject('forbidden', 'the saved manifest budget disagrees with the Run');
    if (canonicalOf(manifest.sessionRole) !== canonicalOf(session.role)) return reject('forbidden', 'the saved manifest session role disagrees with the Session');
    const envelope = run.envelope;
    if (envelope === null) return reject('forbidden', 'the Run has no saved prepared envelope');
    if (canonicalOf(manifest.permissions) !== canonicalOf(envelope.permissions)) return reject('forbidden', 'the saved manifest permissions disagree with the Run envelope');
    const inputBinding = run.inputBinding;
    if (inputBinding === undefined) return reject('forbidden', 'the Run has no persisted input binding');
    if (bodyDigest !== inputBinding.manifestDigest) {
      return reject('forbidden', 'the saved manifest body digest disagrees with the Run input binding');
    }
    if (manifest.inputDigest !== inputBinding.inputDigest) return reject('forbidden', 'the saved manifest input digest disagrees with the Run input binding');
    if (manifest.inputDigest !== authorization.inputDigest) return reject('forbidden', 'the saved manifest input digest disagrees with the Run entry binding');
    return null;
  }

  async function authorizeNewWorkRunAction(args: {
    owned: Owned;
    principal: WorkRunPrincipal;
    operationToolName: string;
  }): Promise<AuthOutcome> {
    const { owned, principal, operationToolName } = args;
    // A NEW work_run write needs the fresh Host/Role admission dependency. Without
    // it the write is explicitly unsupported and can never fall back to the weaker
    // envelope-only authorization. Replay already returned above, so historical
    // receipts stay readable.
    const admission = deps.runtimeAdmission;
    if (admission === undefined) {
      return { ok: false, rejection: reject('unsupported', 'a new work_run mailbox write requires the fresh Host admission dependency') };
    }
    // Fresh write: re-read the full WG11 snapshot (the stable identity loader's
    // snapshot is never reused here) and re-check the current world.
    const fresh = await readFreshWorkRunFacts(owned, principal.runRef);
    if (!fresh.ok) return { ok: false, rejection: fresh.rejection };
    const record = fresh.record;
    const { run, session, lease, outbox } = record;
    const claim = outbox.claim;
    if (canonicalOf(principal.roleBinding) !== canonicalOf(run.roleBinding)) {
      return { ok: false, rejection: reject('forbidden', 'the caller role binding is not the Run role binding') };
    }
    if (run.status !== 'running') return { ok: false, rejection: reject('forbidden', 'the Run is not running') };
    if (run.outcome !== null) return { ok: false, rejection: reject('forbidden', 'the Run is already terminal') };
    if (session.lifecycle !== 'active') return { ok: false, rejection: reject('forbidden', 'the sender Session is not active') };
    const occupancy = session.occupancy;
    if (occupancy === null || occupancy.kind !== 'execution'
      || canonicalOf(occupancy.executionRef) !== canonicalOf(run.ref)
      || occupancy.generation !== claim.generation) {
      return { ok: false, rejection: reject('forbidden', 'the sender Session is not occupied by this exact Run generation') };
    }
    if (lease === null) {
      return { ok: false, rejection: reject('forbidden', 'the TaskLease is not held by this exact Run and attempt') };
    }
    if (canonicalOf(claim.runRef) !== canonicalOf(run.ref)
      || canonicalOf(claim.attemptRef) !== canonicalOf({
        aggregateType: 'TaskAttempt', projectId: run.ref.projectId, goalId: run.ref.goalId,
        taskId: run.task.taskId, attemptId: run.attemptId,
      })
      || claim.sessionRef.projectId !== session.ref.projectId
      || claim.sessionRef.sessionId !== session.ref.sessionId
      || claim.generation !== occupancy.generation) {
      return { ok: false, rejection: reject('forbidden', 'the claim does not match the Run, attempt and Session') };
    }
    const authorization = run.executionAuthorization;
    if (authorization?.phase !== 'entered' || authorization.sessionGeneration !== claim.generation) {
      return { ok: false, rejection: reject('forbidden', 'the Run has not entered with this Session generation') };
    }
    if (authorization.kernel === null
      || authorization.kernel.adapterId !== session.kernel.adapterId
      || authorization.kernel.kernelSessionId !== session.kernel.kernelSessionId) {
      return { ok: false, rejection: reject('forbidden', 'the entered kernel binding does not match the Session mapping') };
    }
    const envelope = run.envelope;
    if (envelope === null || envelope === undefined) {
      return { ok: false, rejection: reject('forbidden', 'a new mailbox action requires a bound envelope') };
    }
    if (canonicalOf(envelope.runRef) !== canonicalOf(run.ref)
      || canonicalOf(envelope.attemptRef) !== canonicalOf(claim.attemptRef)
      || canonicalOf(envelope.planRef) !== canonicalOf(run.planRef)
      || canonicalOf(envelope.roleBinding) !== canonicalOf(run.roleBinding)
      || envelope.projectId !== owned.projectId
      || envelope.workspaceId !== owned.workspaceId
      || envelope.goalId !== run.ref.goalId
      || envelope.taskId !== run.task.taskId
      || !envelope.permissions.tools.includes(operationToolName)) {
      return { ok: false, rejection: reject('forbidden', 'the envelope does not authorize this mailbox operation for this Run') };
    }
    if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox action was cancelled before the stored manifest read') };
    // The SAME verified Run envelope carries the exact prepared manifest; this is
    // the one manifest parser (no second body parser) and the one Host/Role
    // re-check (no second Role parser). The operation grant comes from the
    // manifest permissions the Host/Role re-check just accepted.
    let stored;
    try {
      stored = await readStoredManifest({ bodies: admission.bodies }, run);
    } catch {
      return { ok: false, rejection: reject('unavailable', 'the saved prepared manifest could not be read') };
    }
    if (!stored.ok) return { ok: false, rejection: stored.rejection };
    const manifest = stored.value.manifest;
    const manifestProblem = manifestAgainstRun(manifest, record, stored.value.bodyDigest, authorization);
    if (manifestProblem !== null) return { ok: false, rejection: manifestProblem };
    if (!manifest.permissions.tools.includes(operationToolName)) {
      return { ok: false, rejection: reject('forbidden', `the current Host/Role grant does not include ${operationToolName}`) };
    }
    if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox action was cancelled before role resolution') };
    let hostRole;
    try {
      hostRole = await recheckHostRoleAdmission(
        { roles: deps.roles, authorizeConfiguration: admission.authorizeConfiguration },
        internalHostContext(owned),
        {
          run, manifestRole: manifest.role, sessionRole: session.role, roleBinding: run.roleBinding,
          permissions: manifest.permissions, hostTemplate: manifest.hostTemplate,
          configurationRevision: manifest.hostConfigurationRevision,
        },
      );
    } catch {
      return { ok: false, rejection: reject('unavailable', 'the current Host/Role admission could not be verified') };
    }
    if (!hostRole.ok) return { ok: false, rejection: hostRole.rejection };
    if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox action was cancelled during role resolution') };
    const runKey = canonicalOf(run.ref) ?? '';
    const sessionKey = canonicalOf(session.ref) ?? '';
    const leaseKey = canonicalOf(lease.ref) ?? '';
    const merged = mergeGuards([
      { refKey: runKey, expectedRevision: run.revision },
      { refKey: sessionKey, expectedRevision: session.revision },
      { refKey: leaseKey, expectedRevision: lease.revision },
      ...hostRole.value.roleFacts.guards,
    ]);
    if (!merged.ok) return { ok: false, rejection: merged.rejection };
    return { ok: true, guards: merged.guards };
  }

  // ---- canonical reads ----------------------------------------------------

  async function loadMessage(owned: Owned, ref: SessionMessageRef): Promise<ReadResult<SessionMessage>> {
    return readSessionMessageRecord(records, owned.signal, ref);
  }

  /** A write's message read: absent is the machine's `not_found`; any other failure keeps today's rejection. */
  async function loadMessageForWrite(owned: Owned, ref: SessionMessageRef): Promise<
    { ok: true; message: SessionMessage | null } | { ok: false; rejection: CoreRejection }> {
    const loaded = await loadMessage(owned, ref);
    if (loaded.status === 'ready') return { ok: true, message: loaded.value };
    if (loaded.status === 'not_found') return { ok: true, message: null };
    return { ok: false, rejection: mapReadResult(loaded) as CoreRejection };
  }

  /**
   * The recipient line's two read-time facts (R7A1-09): `archived` is the
   * Session's lifecycle and `retired` its unavailable health. A `{kind:'user'}`
   * recipient has no Session line; an absent or unreadable one is the read's
   * failure, never a pair of false values.
   */
  async function recipientLineFacts(owned: Owned, recipient: MessageRecipient): Promise<
    { ok: true; value: { archived: boolean; retired: boolean } } | { ok: false; rejection: CoreRejection }> {
    if (isUserRecipient(recipient)) return { ok: true, value: { archived: false, retired: false } };
    if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the recipient Session read was cancelled') };
    let read: ReadResult<SessionCard>;
    try {
      read = await deps.sessions.readSession(internalHostContext(owned), {
        projectId: recipient.projectId, sessionId: recipient.sessionId,
      });
    } catch {
      return { ok: false, rejection: reject('unavailable', 'the recipient Session could not be read') };
    }
    if (read.status === 'not_found') {
      return { ok: false, rejection: reject('not_found', 'the recipient Session does not exist') };
    }
    if (read.status !== 'ready') return { ok: false, rejection: mapReadResult(read) as CoreRejection };
    return { ok: true, value: {
      archived: read.value.record.lifecycle === 'archived',
      retired: read.value.record.health === 'unavailable',
    } };
  }

  async function readWorkspaceSource(owned: Owned): Promise<{ ok: true; value: ArtifactRef['source'] } | { ok: false; rejection: CoreRejection }> {
    return readCurrentWorkspaceSource(records, owned);
  }

  // ---- slice-5 user-send helpers ------------------------------------------

  async function loadGoal(owned: Owned, ref: GoalRef): Promise<ReadResult<GoalSnapshot>> {
    if (owned.signal.aborted) return reject('cancelled', 'the Goal read was cancelled');
    const key = canonicalOf(ref);
    if (key === null) return reject('invalid', 'the Goal ref is not canonicalizable JSON');
    let read: StoreResult<RecordBatchRead>;
    try {
      read = await records.readMany([key]);
    } catch {
      return reject('unavailable', 'the Goal record could not be read');
    }
    if (read.status !== 'ready') return mapStoreFailure(read);
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) {
      return read.value.missing.includes(key)
        ? { status: 'not_found' }
        : reject('unavailable', 'the record store neither returned nor reported missing the Goal');
    }
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') return reject('unavailable', `the Goal record is damaged: ${decoded.reason}`);
    return { status: 'ready', value: decoded.value };
  }

  function goalBasis(goal: GoalSnapshot): GoalDecisionBasisV1 {
    return {
      goalRef: structuredClone(goal.ref),
      workspaceRef: structuredClone(goal.workspaceRef),
      objective: goal.objective,
      activePlanRef: structuredClone(goal.activePlanRevision),
      settings: structuredClone(goal.settings),
    };
  }

  /**
   * §3.3 line 614: the aggregate objects' required pins. Every aggregate was
   * shape-validated by `verifyDecisionObjectWorkspaces` before this extraction,
   * so a malformed pin is never silently dropped here.
   */
  function aggregateObjectPins(objects: readonly DecisionObjectV1[]): VersionPin[] {
    const pins: VersionPin[] = [];
    for (const object of objects) {
      if (isObject(object) && object['kind'] === 'aggregate') {
        pins.push(structuredClone((object as Unknown)['pin']) as unknown as VersionPin);
      }
    }
    return pins;
  }

  /**
   * SPEC §3.3 line 614: every allowed decision object kind must ESTABLISH its
   * owning Workspace. A `file` object carries its Workspace directly; a kind
   * that names none is refused as `invalid`, and a Workspace other than the
   * bound one as `forbidden`. `aggregate` objects are established through the
   * pin their kind carries by `verifyDecisionObjectPins`.
   */
  function verifyDecisionObjectWorkspaces(owned: Owned, objects: readonly DecisionObjectV1[]): CoreRejection | null {
    for (const object of objects) {
      if (!isObject(object)) return reject('invalid', 'a decision object is not an object');
      const kind = object['kind'];
      if (kind === 'aggregate') {
        // §3.3 line 614: an aggregate object establishes its owning Workspace
        // through its pin, so the pin is mandatory. A missing or malformed pin
        // is refused as `invalid` BEFORE any pin extraction or body effect,
        // never dropped for the store codec to reject after body storage.
        const pin = object['pin'];
        if (!isObject(pin) || !isObject(pin['ref']) || !isPositiveInt(pin['revision'])) {
          return reject('invalid', 'an aggregate decision object does not carry a complete version pin');
        }
        continue;
      }
      if (kind !== 'file') {
        return reject('invalid', 'a decision object of this kind does not establish its owning Workspace');
      }
      const workspace = object['workspace'];
      if (!isObject(workspace)) {
        return reject('invalid', 'a file decision object does not establish its owning Workspace');
      }
      const projectId = workspace['projectId'];
      const workspaceId = workspace['workspaceId'];
      if (typeof projectId !== 'string' || projectId.length === 0
        || typeof workspaceId !== 'string' || workspaceId.length === 0) {
        return reject('invalid', 'a file decision object does not establish its owning Workspace');
      }
      if (projectId !== owned.projectId || workspaceId !== owned.workspaceId) {
        return reject('forbidden', 'a file decision object belongs to another Workspace');
      }
    }
    return null;
  }

  function dedupePins(pins: readonly VersionPin[]): VersionPin[] {
    const byKey = new Map<string, VersionPin>();
    for (const pin of pins) {
      const key = canonicalOf(pin.ref);
      if (key !== null) byKey.set(key, pin);
    }
    return [...byKey.values()];
  }

  /** §3.3 line 614: the owning Goal a goal-scoped object ref names, or null. */
  function goalRefOfDecisionObject(ref: Record<string, unknown>): GoalRef | null {
    const projectId = ref['projectId'];
    if (typeof projectId !== 'string' || projectId.length === 0) return null;
    const goalId = ref['goalId'];
    if (typeof goalId !== 'string' || goalId.length === 0) return null;
    return { aggregateType: 'Goal', projectId, goalId };
  }

  /** §3.3 line 614: read the owning Goal and return its REAL Workspace. */
  async function owningGoalWorkspace(owned: Owned, goalRef: GoalRef): Promise<
    { ok: true; workspace: WorkspaceScope } | { ok: false; rejection: CoreRejection }> {
    const goal = await loadGoal(owned, goalRef);
    if (goal.status === 'ready') return { ok: true, workspace: goal.value.workspaceRef };
    if (goal.status === 'not_found') {
      return { ok: false, rejection: reject('not_found', 'a decision object owning Goal does not exist') };
    }
    return { ok: false, rejection: mapReadResult(goal) as CoreRejection };
  }

  async function readDecisionObjectRecord(key: string): Promise<
    { ok: true; record: EncodedRecord } | { ok: false; rejection: CoreRejection }> {
    let read: StoreResult<RecordBatchRead>;
    try {
      read = await records.readMany([key]);
    } catch {
      return { ok: false, rejection: reject('unavailable', 'a decision object could not be read') };
    }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) {
      return read.value.missing.includes(key)
        ? { ok: false, rejection: reject('not_found', 'a decision object does not exist') }
        : { ok: false, rejection: reject('unavailable', 'the record store neither returned nor reported missing the decision object') };
    }
    return { ok: true, record };
  }

  /**
   * SPEC §3.3 line 614: a decision request's object pins are REAL facts, not
   * caller claims. Before any foreign record is read, a ref that carries another
   * project/Workspace is refused. Every allowed kind must then ESTABLISH its
   * owning Workspace — directly from its ref, through the Goal its `goalId`
   * names, or through the owning Goal named by its own record (Goal,
   * PlanRevision, Evidence). A kind whose Workspace cannot be established is
   * refused as `invalid`, never accepted. Only a same-Workspace object that
   * reads at the pin's exact revision joins the source metadata and the guards.
   */
  async function verifyDecisionObjectPins(owned: Owned, pins: readonly VersionPin[]): Promise<CoreRejection | null> {
    for (const pin of pins) {
      if (!isObject(pin) || !isObject(pin.ref) || !isPositiveInt(pin.revision)) {
        return reject('invalid', 'a decision object pin is not a complete positive-integer version pin');
      }
      const ref = pin.ref as unknown as Record<string, unknown>;
      const projectId = ref['projectId'];
      const workspaceId = ref['workspaceId'];
      if (typeof projectId === 'string' && projectId.length > 0 && projectId !== owned.projectId) {
        return reject('forbidden', 'a decision object pin belongs to another project');
      }
      if (typeof workspaceId === 'string' && workspaceId.length > 0 && workspaceId !== owned.workspaceId) {
        return reject('forbidden', 'a decision object pin belongs to another Workspace');
      }
      const key = canonicalOf(pin.ref);
      if (key === null) return reject('invalid', 'a decision object pin ref is not canonicalizable JSON');
      const aggregateType = ref['aggregateType'];
      const directWorkspace = typeof workspaceId === 'string' && workspaceId.length > 0;
      let record: EncodedRecord | null = null;
      let goalRef: GoalRef | null = null;
      if (!directWorkspace) {
        goalRef = goalRefOfDecisionObject(ref);
        if (goalRef !== null && aggregateType !== 'Goal') {
          const owner = await owningGoalWorkspace(owned, goalRef);
          if (!owner.ok) return owner.rejection;
          if (owner.workspace.projectId !== owned.projectId
            || owner.workspace.workspaceId !== owned.workspaceId) {
            return reject('forbidden', 'a decision object belongs to another Workspace Goal');
          }
        } else if (aggregateType === 'Goal' || aggregateType === 'PlanRevision' || aggregateType === 'Evidence') {
          const loaded = await readDecisionObjectRecord(key);
          if (!loaded.ok) return loaded.rejection;
          record = loaded.record;
          if (aggregateType === 'Goal') {
            const decoded = decodeGoalSnapshot(record);
            if (decoded.status !== 'decoded') {
              return reject('unavailable', `the decision object Goal is damaged: ${decoded.reason}`);
            }
            if (decoded.value.workspaceRef.projectId !== owned.projectId
              || decoded.value.workspaceRef.workspaceId !== owned.workspaceId) {
              return reject('forbidden', 'a decision object Goal belongs to another Workspace');
            }
          } else if (aggregateType === 'PlanRevision') {
            const decoded = decodePlanRevisionSnapshot(record);
            if (decoded.status !== 'decoded') {
              return reject('unavailable', `the decision object PlanRevision is damaged: ${decoded.reason}`);
            }
            goalRef = decoded.value.goalRef;
          } else {
            const decoded = decodeEvidenceSnapshot(record);
            if (decoded.status !== 'decoded') {
              return reject('unavailable', `the decision object Evidence is damaged: ${decoded.reason}`);
            }
            const subject = decoded.value.evidence.subject;
            goalRef = { aggregateType: 'Goal', projectId: subject.projectId, goalId: subject.goalId };
          }
          if (aggregateType !== 'Goal') {
            const owner = await owningGoalWorkspace(owned, goalRef as GoalRef);
            if (!owner.ok) return owner.rejection;
            if (owner.workspace.projectId !== owned.projectId
              || owner.workspace.workspaceId !== owned.workspaceId) {
              return reject('forbidden', 'a decision object belongs to another Workspace Goal');
            }
          }
        } else {
          return reject('invalid', 'a decision object of this kind does not establish its owning Workspace');
        }
      }
      if (record === null) {
        const loaded = await readDecisionObjectRecord(key);
        if (!loaded.ok) return loaded.rejection;
        record = loaded.record;
      }
      if (record.revision !== pin.revision) {
        return reject('revision_conflict', 'a decision object changed since it was read', [pin]);
      }
    }
    return null;
  }

  function validOptionObjects(options: readonly DecisionOptionV1[], objects: readonly DecisionObjectV1[]): boolean {
    if (!Array.isArray(options) || options.length < 2 || options.length > 4) return false;
    if (!Array.isArray(objects) || objects.length > 32) return false;
    const ids = new Set<string>();
    for (const option of options) {
      if (!isObject(option) || !nonEmpty(option['id']) || typeof option['label'] !== 'string') return false;
      if (option['effect'] !== 'apply' && option['effect'] !== 'reject' && option['effect'] !== 'defer') return false;
      if (Buffer.byteLength(String(option['id']), 'utf8') > 64 || Buffer.byteLength(String(option['label']), 'utf8') > 512) return false;
      if (ids.has(String(option['id']))) return false;
      ids.add(String(option['id']));
    }
    return true;
  }

  /** The `user_message_sent` facts (spec §3.1 S5-MSG-01) are built inline. */

  // ---- official Query answer reads (read-only, codec-owned) ----------------

  type QueryRecordRead<T> = ReadResult<T>;

  async function readEncoded(key: string): Promise<{ ok: true; record: EncodedRecord } | { ok: false; failure: CoreRejection | { missing: true } }> {
    let read: StoreResult<RecordBatchRead>;
    try {
      read = await records.readMany([key]);
    } catch {
      return { ok: false, failure: reject('unavailable', 'the Query record could not be read') };
    }
    if (read.status !== 'ready') return { ok: false, failure: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) {
      return { ok: false, failure: read.value.missing.includes(key) ? { missing: true } : reject('unavailable', 'the record store neither returned nor reported missing the Query record') };
    }
    return { ok: true, record };
  }

  async function loadQueryJob(owned: Owned, ref: QueryJobRef): Promise<QueryRecordRead<QueryJobSnapshot>> {
    if (owned.signal.aborted) return reject('cancelled', 'the QueryJob read was cancelled');
    const key = canonicalOf(ref);
    if (key === null) return reject('invalid', 'the QueryJob ref is not canonicalizable JSON');
    const read = await readEncoded(key);
    if (!read.ok) return 'missing' in read.failure ? { status: 'not_found' } : read.failure;
    const decoded = decodeQueryJobSnapshot(read.record);
    if (decoded.status !== 'decoded') return reject('unavailable', `the QueryJob snapshot is damaged: ${decoded.reason}`);
    return { status: 'ready', value: decoded.value };
  }

  async function loadQueryRun(owned: Owned, ref: QueryRunRef): Promise<QueryRecordRead<QueryRunSnapshot>> {
    if (owned.signal.aborted) return reject('cancelled', 'the QueryRun read was cancelled');
    const key = canonicalOf(ref);
    if (key === null) return reject('invalid', 'the QueryRun ref is not canonicalizable JSON');
    const read = await readEncoded(key);
    if (!read.ok) return 'missing' in read.failure ? { status: 'not_found' } : read.failure;
    const decoded = decodeQueryRunSnapshotRecord(read.record);
    if (decoded.status !== 'decoded') return reject('unavailable', `the QueryRun snapshot is damaged: ${decoded.reason}`);
    return { status: 'ready', value: decoded.value };
  }

  async function loadQueryAnswer(owned: Owned, ref: QueryJobAnswerRef): Promise<QueryRecordRead<QueryJobAnswerSnapshot>> {
    if (owned.signal.aborted) return reject('cancelled', 'the QueryJobAnswer read was cancelled');
    const key = canonicalOf(ref);
    if (key === null) return reject('invalid', 'the QueryJobAnswer ref is not canonicalizable JSON');
    const read = await readEncoded(key);
    if (!read.ok) return 'missing' in read.failure ? { status: 'not_found' } : read.failure;
    const decoded = decodeQueryJobAnswerSnapshot(read.record);
    if (decoded.status !== 'decoded') return reject('unavailable', `the QueryJobAnswer snapshot is damaged: ${decoded.reason}`);
    return { status: 'ready', value: decoded.value };
  }

  type QueryAnswerFacts = {
    verdict: NonNullable<MessageGuardContext['queryAnswer']>;
    bodyBounded: boolean;
    text: string;
    /** The formal Answer body's ORIGINAL source. */
    answerSource: ArtifactRef['source'];
    /** The derived query_run sender; null while a fact the machine refuses on is missing. */
    sender: MessageQueryAnswerSender | null;
  };

  /**
   * MSG-06's facts, read in today's order: the Answer, its QueryJob and its
   * QueryRun (a failed read keeps today's rejection). The body and the
   * `query_run` sender come from the settled Answer/Job/Run, never from caller
   * text or caller identity.
   */
  async function readQueryAnswerFacts(owned: Owned, message: SessionMessage, answerRef: QueryJobAnswerRef): Promise<
    { ok: true; facts: QueryAnswerFacts } | { ok: false; rejection: CoreRejection }> {
    const answerRead = await loadQueryAnswer(owned, answerRef);
    if (answerRead.status !== 'ready') return { ok: false, rejection: mapReadResult(answerRead) as CoreRejection };
    const answer = answerRead.value;
    const jobRead = await loadQueryJob(owned, answer.answer.queryJobRef);
    if (jobRead.status !== 'ready') return { ok: false, rejection: mapReadResult(jobRead) as CoreRejection };
    const job = jobRead.value;
    const runRead = await loadQueryRun(owned, answer.answer.runRef);
    if (runRead.status !== 'ready') return { ok: false, rejection: mapReadResult(runRead) as CoreRejection };
    const run = runRead.value;

    const messageRecipient = message.recipient;
    if (isUserRecipient(messageRecipient)) {
      // Slice 5: a user-recipient decision card is answered through the decision
      // owner, never by associating a formal Query Answer with it.
      return { ok: false, rejection: reject('invalid', 'a user-recipient message cannot be answered by a Query Answer association') };
    }
    const recipient = { projectId: messageRecipient.projectId, sessionId: messageRecipient.sessionId };
    const { binding, answererSession } = consultationBindingOf(job, run, message.ref, recipient);
    const state = run.run.executionState;
    const settlement: QueryAnswerFacts['verdict']['run'] = state === undefined || state.phase !== 'settled' ? 'not_settled'
      : run.run.status !== 'answered' || run.run.outcome !== 'answered' ? 'not_answered' : 'settled_answered';
    const generation = state?.sessionGeneration;
    const text = answer.answer.answer;
    return {
      ok: true,
      facts: {
        verdict: {
          binding,
          jobAnsweredWithAnswer: job.job.status === 'answered'
            && job.job.answerRefs.some((candidate) => canonicalOf(candidate) === canonicalOf(answerRef)),
          run: settlement,
          answeringSessionIsClaimSession: state !== undefined && answererSession !== null
            && state.sessionRef.projectId === answererSession.projectId && state.sessionRef.sessionId === answererSession.sessionId,
          answerOfRun: canonicalOf(answer.answer.runRef) === canonicalOf(run.ref),
          sessionGenerationReadable: isPositiveInt(generation),
        },
        bodyBounded: typeof text === 'string' && text.length > 0 && Buffer.byteLength(text, 'utf8') <= SESSION_MESSAGE_MAX_TEXT_BYTES,
        text,
        answerSource: answer.answer.bodyRef.source,
        sender: answererSession === null || !isPositiveInt(generation) ? null : {
          kind: 'query_run',
          sessionRef: { projectId: answererSession.projectId, sessionId: answererSession.sessionId },
          queryRunRef: { ...answer.answer.runRef },
          answerRef: { ...answerRef },
          generation,
        },
      },
    };
  }

  // ---- body storage -------------------------------------------------------

  type BodyOutcome = { ok: true; ref: ArtifactRef } | { ok: false; rejection: CoreRejection };

  /**
   * The original send/respond body effect: a thin adapter over the ONE shared
   * implementation (`storeScopedMessageBody`, SPEC §3.3 line 684). The caller's
   * `bodyRequestId` keeps the original operation identity, so the C1/C2 receipts
   * and bytes are unchanged.
   */
  async function storeMessageBody(args: {
    owned: Owned;
    sender: MessageSender | MessageQueryAnswerSender;
    part: 'message' | 'response';
    messageRef: SessionMessageRef;
    text: string;
    sourceRef: ArtifactRef['source'];
    /** When set, the saved body provenance must equal this exact source instead
     * of the generic current-workspace check. Used ONLY for a formal Query
     * answer reply, whose original source may be an earlier workspace revision. */
    expectedSource?: ArtifactRef['source'];
    bodyRequestId: string;
  }): Promise<BodyOutcome> {
    const stored = await storeScopedMessageBody(deps, args);
    if (stored.status !== 'ready') return { ok: false, rejection: mapReadResult(stored) as CoreRejection };
    return { ok: true, ref: stored.value.bodyRef };
  }

  /**
   * The `store_body` effect: a workspace body takes the current Workspace
   * source; a formal Answer body keeps the Answer's ORIGINAL source, so a later
   * current Workspace revision never impersonates the answer-time evidence.
   */
  async function storePlannedBody(body: NonNullable<MessageCommitPlan['body']>, input: BodyInput, write: MessageWrite): Promise<BodyOutcome> {
    const { owned, actor: sender } = write;
    const { messageRef, text, answerSource } = input;
    const bodyRequestId = `session-message-body:${sha256Hex(`${write.identityKey}|${body.part}`)}`;
    if (body.source === 'answer') {
      if (answerSource === null) throw new Error('a formal Answer body keeps the Answer source');
      return storeMessageBody({
        owned, sender, part: body.part, messageRef, text, sourceRef: answerSource, expectedSource: answerSource, bodyRequestId,
      });
    }
    const source = await readWorkspaceSource(owned);
    if (!source.ok) return { ok: false, rejection: source.rejection };
    return storeMessageBody({ owned, sender, part: body.part, messageRef, text, sourceRef: source.value, bodyRequestId });
  }

  // ---- replay -------------------------------------------------------------

  type Receipt = Extract<Awaited<ReturnType<SessionMailboxDependencies['records']['commit']>>, { status: 'committed' }>;

  async function replayMessage(receipt: Receipt): Promise<WriteResult<SessionMessage>> {
    return replaySessionMessageReceipt(records, receipt);
  }

  /** Receipt-miss recovery uses only the same identity; it never re-runs business. */
  async function recheckAfterMiss(identityKey: string, fingerprint: string): Promise<WriteResult<SessionMessage> | null> {
    return recheckSessionMessageReceipt(records, identityKey, fingerprint);
  }

  /**
   * A machine refusal, after today's same-identity receipt re-check
   * (`recheckAfterMiss`) where today's service made one, because a concurrent
   * request of this identity may have committed after the first lookup missed:
   * a refused fresh admission, and an `invalid` refusal of an existing message's
   * own state (already read, responded or derived; the inputId already
   * accepted). An absent message and a recipient, Query, Kernel or Session
   * mismatch are refused directly. A stale pin is not a machine refusal: as
   * today, only the commit's message CAS catches it (`writeMessage`).
   */
  async function refuse(refused: Refused, ctx: MessageGuardContext, identityKey: string, fingerprint: string): Promise<WriteResult<SessionMessage>> {
    if (admissionRefusalOf(refused, ctx) !== null || refused.code === 'invalid') {
      const restored = await recheckAfterMiss(identityKey, fingerprint);
      if (restored !== null) return restored;
    }
    return refusalOf(refused, ctx);
  }

  // ---- accepted writes ----------------------------------------------------

  /** `store_body`'s input: the message the body belongs to, its text, and a formal Answer's ORIGINAL source (`null` = the current Workspace). */
  type BodyInput = { messageRef: SessionMessageRef; text: string; answerSource: ArtifactRef['source'] | null };

  /** An accepted write's own inputs; the machine's effects decide the rest (`writeMessage`). */
  type MessageWrite = {
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

  /**
   * An accepted write (§10.3) in today's order: the `store_body` effect before
   * the commit and outside its transaction, the clock, the write's record (the
   * machine's `next`), the `append_event` event, the cancellation check, then
   * ONE commit guarded by `guard_message` and, on `guard_work_run_facts`, the
   * fresh admission's Run, Session, Lease and role guards.
   */
  async function writeMessage(accepted: Accepted, write: MessageWrite): Promise<WriteResult<SessionMessage>> {
    const { owned, identityKey, fingerprint } = write;
    const plan = messageCommitPlan(accepted.effects);
    let record: (at: string) => SessionMessage;
    if (write.body === null || plan.body === null) {
      if (write.body !== null || plan.body !== null) throw new Error('a mailbox write stores its body exactly when the machine names store_body');
      record = write.record;
    } else {
      const stored = await storePlannedBody(plan.body, write.body, write);
      if (!stored.ok) return stored.rejection;
      const withBody = write.record;
      record = (at) => withBody(at, stored.ref);
    }
    const at = deps.now();
    if (!nonEmpty(at)) return reject('invalid', 'the injected clock is not a legal instant');
    let companions: SessionMessageCommitCompanions | undefined;
    if (write.companions !== undefined) {
      const planned = await write.companions(at);
      if (!planned.ok) return planned.rejection;
      companions = planned.value;
    }
    const message = record(at);
    let acceptedState = accepted.next;
    if (write.acceptedRejectedAt === true) {
      if (acceptedState.status === 'absent') throw new Error('a refusal cannot change an absent message');
      acceptedState = { ...acceptedState, rejectedAt: at };
    }
    if (canonicalOf(messageMachineStateOf(message)) !== canonicalOf(acceptedState)) {
      throw new Error('the written SessionMessage is not the state the message machine accepted');
    }
    const event = {
      eventId: eventIdOf(identityKey, plan.eventType),
      eventType: plan.eventType, schemaVersion: 1, occurredAt: at,
      projectId: owned.projectId, workspaceId: owned.workspaceId, requestId: write.requestId,
      actor: write.actor, message,
    } as unknown as SessionMessageEventV1;
    if (owned.signal.aborted) return reject('cancelled', write.cancelled);
    const guards: RecordGuard[] = [];
    if (plan.workRunFacts) {
      if (write.admission === null || !write.admission.ok) throw new Error('only an admitted work_run write guards its admission facts');
      guards.push(...write.admission.guards);
    }
    guards.push(...(write.extraGuards ?? []));
    // §3.3 line 684: the ONE writer. `persist` re-checks the same identity
    // receipt, binds the origin, compiles the accepted message pin into the
    // CAS and encodes the event through the same codec as the original path.
    const persistCtx: CoreCallContext = {
      projectId: owned.projectId, workspaceId: owned.workspaceId,
      principal: structuredClone(owned.principal), materialReader: structuredClone(owned.reader), signal: owned.signal,
    };
    return messageWrites.persist(persistCtx, {
      input: {
        // Only the null-ness is read by `persist` (create vs update); the CAS
        // itself is the accepted pin below, never this record's revision.
        before: plan.messageRevision === null ? null : message,
        next: message, event, guards, claims: [],
        ...(companions === undefined ? {} : { companions }),
      },
      meta: {
        requestId: write.requestId,
        expected: plan.messageRevision === null ? [] : [{ ref: message.ref, revision: plan.messageRevision }],
      },
      identityKey,
      fingerprint,
    });
  }

  // ---- read authority -----------------------------------------------------

  /**
   * Slice 1 §2.5: the effective reply handler of a wait. A recorded `replyHandler`
   * wins; otherwise the original `work_run` or secretary sender Session handles
   * the reply. A Host-sent message has no effective handler.
   */
  function effectiveReplyHandler(message: SessionMessage): SessionRef | null {
    const handler = message.replyHandler ?? null;
    if (handler !== null) return handler.sessionRef;
    return message.sender.kind === 'work_run' || message.sender.kind === 'secretary_round'
      ? message.sender.sessionRef : null;
  }

  /**
   * The one secretary-round resolution: the resolver runs after a receipt miss
   * (or on every read) and the resolved round must be exactly the literal
   * QueryRun caller and scope. Each entry keeps its own required injections and
   * business authorization, and the withdraw shares the session-project check.
   */
  async function resolveSecretaryRound(owned: Owned):
  Promise<{ ok: true; round: SecretaryQueryRunV1 } | { ok: false; rejection: CoreRejection }> {
    if (owned.principal.kind !== 'query_run') {
      return { ok: false, rejection: reject('forbidden', 'the secretary round requires a query_run caller') };
    }
    if (deps.secretaryRounds === undefined) {
      return { ok: false, rejection: reject('unsupported', 'the secretary round is not configured') };
    }
    let resolved: { status: 'ready'; value: SecretaryQueryRunV1 } | CoreRejection;
    try {
      resolved = await deps.secretaryRounds.resolveSecretaryQueryRun(isolatedContext(owned));
    } catch {
      return { ok: false, rejection: reject('unavailable', 'the secretary round could not be resolved') };
    }
    if (resolved.status !== 'ready') return { ok: false, rejection: resolved };
    const round = resolved.value;
    if (canonicalOf(round.run) !== canonicalOf(owned.principal.queryRunRef)
      || round.scope.projectId !== owned.projectId || round.scope.workspaceId !== owned.workspaceId
      || round.session.projectId !== owned.projectId) {
      return { ok: false, rejection: reject('forbidden', 'the resolved round is not this QueryRun caller') };
    }
    return { ok: true, round };
  }

  /**
   * The one secretary read admission: the resolver runs on every `query_run`
   * read (there is no receipt to miss), and its Session is the reader. It reads
   * no message, no owner and no outbox.
   */
  async function secretaryReader(owned: Owned): Promise<
    { ok: true; round: SecretaryQueryRunV1; reader: SessionRef } | { ok: false; rejection: CoreRejection }
  > {
    if (owned.principal.kind !== 'query_run') {
      return { ok: false, rejection: reject('forbidden', 'the secretary reader requires a query_run caller') };
    }
    if (deps.secretaryRounds === undefined || deps.requestOwners === undefined
      || deps.recipientExecutions === undefined) {
      return { ok: false, rejection: reject('unsupported', 'the secretary mailbox read is not configured') };
    }
    const resolved = await resolveSecretaryRound(owned);
    if (!resolved.ok) return resolved;
    return { ok: true, round: resolved.round, reader: { ...resolved.round.session } };
  }

  type ReadRight = { ok: true; allowed: boolean } | { ok: false; rejection: CoreRejection };

  /**
   * The one single-message read right. Steps 1–4 establish a right without any
   * read; only a secretary-sent message with a request root and no established
   * right consults the request's owner. `ready(null)` and `not_found` add no
   * right; any other failure is `unavailable`; a failure never erases an
   * already established right.
   */
  async function canReadMessage(owned: Owned, reader: SessionRef, message: SessionMessage): Promise<ReadRight> {
    const recipient = message.recipient;
    if (!isUserRecipient(recipient)
      && recipient.projectId === reader.projectId && recipient.sessionId === reader.sessionId) {
      return { ok: true, allowed: true };
    }
    if (message.sender.kind === 'work_run' && sameSessionRefAs(message.sender.sessionRef, reader)) {
      return { ok: true, allowed: true };
    }
    if (message.sender.kind === 'secretary_round' && sameSessionRefAs(message.sender.sessionRef, reader)) {
      return { ok: true, allowed: true };
    }
    // Slice 1 §2.5: the effective reply handler may read the original message
    // and its response body, but this never widens ack/respond rights (those
    // still use `ownsInbox`, i.e. the original recipient).
    const handler = message.replyHandler ?? null;
    if (handler !== null && sameSessionRefAs(handler.sessionRef, reader)) return { ok: true, allowed: true };
    if (message.sender.kind !== 'secretary_round' || message.requestRoot === null) {
      return { ok: true, allowed: false };
    }
    if (deps.requestOwners === undefined) {
      return { ok: false, rejection: reject('unsupported', 'the request-owner read is not configured') };
    }
    let owner: ReadResult<SessionRef | null>;
    try {
      owner = await deps.requestOwners.ownerOf(isolatedContext(owned), { requestRoot: message.requestRoot });
    } catch {
      return { ok: false, rejection: reject('unavailable', 'the request owner could not be read') };
    }
    if (owner.status === 'not_found') return { ok: true, allowed: false };
    if (owner.status !== 'ready') {
      return { ok: false, rejection: reject('unavailable', 'the request owner could not be read') };
    }
    if (owner.value === null) return { ok: true, allowed: false };
    return { ok: true, allowed: canonicalOf(owner.value) === canonicalOf(reader) };
  }

  function ownsInbox(sessionRef: SessionRef, message: SessionMessage): boolean {
    const recipient = message.recipient;
    return !isUserRecipient(recipient)
      && recipient.projectId === sessionRef.projectId
      && recipient.sessionId === sessionRef.sessionId;
  }

  /**
   * The one single-message read right shared by `readMessage`, `readMessageBody`
   * and `readMessageView` (R7A1-09): a Host inside its workspace, a Work Run
   * through its own derived sender, or a secretary round through its resolved
   * Session; the per-message check is `canReadMessage`. `null` means allowed.
   */
  async function messageReadRight(owned: Owned, message: SessionMessage,
    secretary: { round: SecretaryQueryRunV1; reader: SessionRef } | null): Promise<CoreRejection | null> {
    if (owned.principal.kind === 'host') return null;
    let reader: SessionRef;
    if (owned.principal.kind === 'query_run') {
      if (secretary === null) return reject('forbidden', 'the secretary read was not resolved');
      reader = secretary.reader;
    } else {
      const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
      if (!identity.ok) return identity.rejection;
      const derived = deriveWorkRunSender(identity);
      if (!derived.ok) return derived.rejection;
      reader = derived.sender.sessionRef;
    }
    const right = await canReadMessage(owned, reader, message);
    if (!right.ok) return right.rejection;
    return right.allowed ? null : reject('forbidden', 'this message is not addressed to or sent by the caller Session');
  }

  // ---- sendMessage --------------------------------------------------------

  /**
   * The send's own result: the one commit's outcome plus the release state it
   * wrote (`awaiting_release` exactly when the stored `release` is `'awaiting'`).
   * A rejection already carries the frozen `SendRejectionV1` shape.
   */
  function sendStatusOf(result: WriteResult<SessionMessage>): SendMessageResultV1 {
    if (result.status !== 'committed') return result;
    return { ...result, sendStatus: result.value.release === 'awaiting' ? 'awaiting_release' : 'sent' };
  }

  async function refuseSend<T extends CoreRejection>(rejection: T, identityKey: string, fingerprint: string): Promise<SendMessageResultV1> {
    const restored = await recheckAfterMiss(identityKey, fingerprint);
    return restored === null ? rejection : sendStatusOf(restored);
  }

  async function sendMessage(ctx: CoreCallContext, request: SessionMessageSendInputV1): Promise<SendMessageResultV1> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before validation');
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    // T's ONE normalizer replaces the inline shape checks: the recipient, the ten
    // payload fields and their defaults. It reads no Goal, Run or Session.
    const normalized = normalizeSendMessageInput(write.input);
    if (normalized.status === 'rejected') return normalized;
    if (normalized.status !== 'ready') return reject('invalid', 'the send input could not be normalized');
    const send = normalized.value;
    const text = normalizeText(send.text);
    if (!text.ok) return text.rejection;
    const projectRejection = guardRejection(messageRecipientProjectProblem(send.recipient.projectId === owned.projectId));
    if (projectRejection !== null) return projectRejection;
    const sendFlags: NonNullable<MessageGuardContext['sendFlags']> = {
      needsReply: send.needsReply, waitAfterSend: send.waitAfterSend, pinCount: write.expected.length,
    };
    const flagRejection = guardRejection(messageSendFlagsProblem(sendFlags));
    if (flagRejection !== null) return flagRejection;

    // The stable sender facts: Host => the same trusted actor; a work Run => the
    // persisted claim and Run; a `query_run` principal => only its literal
    // `queryRunRef` (the round is resolved after the receipt miss). The identity
    // and the fingerprint never read the resolver.
    let sender: MessageSender | null = null;
    let senderIdentity: Unknown;
    let workRunPrincipal: WorkRunPrincipal | null = null;
    let secretaryRound: SecretaryQueryRunV1 | null = null;
    if (owned.principal.kind === 'host') {
      sender = { kind: 'host', actor: { ...owned.principal.actor } };
      senderIdentity = senderIdentityOf(sender);
    } else if (owned.principal.kind === 'work_run') {
      const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
      if (!identity.ok) return identity.rejection;
      const derived = deriveWorkRunSender(identity);
      if (!derived.ok) return derived.rejection;
      sender = derived.sender;
      workRunPrincipal = owned.principal;
      senderIdentity = senderIdentityOf(sender);
    } else {
      senderIdentity = { kind: 'query_run', queryRunRef: { ...owned.principal.queryRunRef } };
    }

    // The identity and the fingerprint are fixed from the stable facts and the
    // WHOLE normalized payload (all ten fields, the explicit nulls included): a
    // changed field under the same identity is `idempotency_conflict`, never a
    // silent re-send.
    const identityKey = identityKeyOf('send', owned, senderIdentity, write.requestId);
    const fingerprint = fingerprintOf('send', owned, senderIdentity, send as unknown as Unknown, write.expected);

    // Receipt first: a replay restores the original result from the original
    // event, before any admission and without re-reading the world.
    if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the idempotency lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return sendStatusOf(await replayMessage(existing.value));
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    // The secretary's one admission, only after the receipt miss: the resolved
    // round must be this QueryRun, in this scope, and it supplies the persisted
    // sender and the trusted goal. A NEW secretary path needs all three
    // injections; it never reads open executions.
    if (owned.principal.kind === 'query_run') {
      if (deps.secretaryRounds === undefined || deps.requestOwners === undefined
        || deps.recipientExecutions === undefined) {
        return reject('unsupported', 'the secretary send is not configured');
      }
      const resolved = await resolveSecretaryRound(owned);
      if (!resolved.ok) {
        // A business refusal (no stored round, not entered, not a secretary
        // round) may be stale: a concurrent same-identity send can have committed
        // after this send's lookup missed, so restore its receipt. A read failure
        // stays the read failure.
        return resolved.rejection.code === 'forbidden'
          ? refuseSend(resolved.rejection, identityKey, fingerprint) : resolved.rejection;
      }
      const round = resolved.round;
      secretaryRound = round;
      sender = {
        kind: 'secretary_round',
        sessionRef: { ...round.session },
        queryRunRef: { ...round.run },
        requestRoot: { ...round.requestRoot },
        generation: round.sessionGeneration,
      };
    }
    if (sender === null) throw new Error('a send reached admission without its trusted sender facts');
    const committedSender: MessageSender = sender;

    // MSG-02's fresh admission comes before the target Session read; a refused
    // admission never reads the target (the machine asks the admission first).
    let authorized: AuthOutcome | null = null;
    if (workRunPrincipal !== null) {
      authorized = await authorizeNewWorkRunAction({
        owned, principal: workRunPrincipal, operationToolName: 'send_session_message',
      });
      // The trusted duties facts refuse the two senders that are never senders:
      // a read-only copy and an independent reviewer. The adapter is the only
      // source; when it is not bound the historical paths stay unchanged.
      if (authorized.ok && deps.duties !== undefined && sender.kind === 'work_run') {
        if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the duties read');
        const duties = await deps.duties.readMessageDutiesFacts(internalHostContext(owned), {
          sessionRef: sender.sessionRef, roleBinding: sender.roleBinding,
        });
        if (duties.status !== 'ready') return duties.status === 'rejected' ? duties : mapReadResult(duties) as CoreRejection;
        if (duties.value.readOnlyCopy) return refuseSend(reject('forbidden', 'a read-only copy never sends a Session message'), identityKey, fingerprint);
        if (duties.value.independentReview) return refuseSend(reject('forbidden', 'an independent reviewer never sends a Session message'), identityKey, fingerprint);
      }
    }

    // The target Session must exist in the same project/workspace. busy/archived
    // never blocks durable mail.
    let recipientScope: MessageGuardContext['recipientScope'] = null;
    if (authorized === null || authorized.ok) {
      if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the target Session read');
      const target = await deps.sessions.readSession(internalHostContext(owned), send.recipient);
      if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled during the target Session read');
      if (target.status !== 'ready' && target.status !== 'not_found') return mapReadResult(target) as CoreRejection;
      recipientScope = target.status === 'not_found' ? null
        : target.value.record.ref.projectId === owned.projectId && target.value.record.workspaceId === owned.workspaceId
          ? 'same_workspace' : 'other_workspace';
    }

    // MSG-01/02. The messageId derives from the send identity, so the record is
    // not read: an existing one is caught by the create CAS@0. A refused
    // admission first restores this identity's receipt if a concurrent identical
    // request committed after the lookup missed (`refuse`).
    const sendFacts: Partial<Omit<MessageGuardContext, 'principal'>> = {
      workRunAuthorization: authorized === null ? null : authorized.ok ? 'ok' : authorized.rejection,
      recipientScope,
      sendFlags,
    };
    const { decided, ctx: messageCtx } = judge(owned.principal, null, { type: 'message_sent' }, sendFacts);
    if (!decided.ok) return refuseSend(refusalOf(decided, messageCtx), identityKey, fingerprint);

    // The Goal comes from the sender's trusted facts: a work Run's Task goal, the
    // secretary round's `effectiveGoalId` (never its `goals` batch), the person's
    // own `goalRef` input. An input that disagrees with the trusted fact is
    // `invalid`, never a silent override.
    let trustedGoal: GoalRef | null = null;
    if (sender.kind === 'host') {
      if (send.goalRef !== null) trustedGoal = structuredClone(send.goalRef);
    } else if (sender.kind === 'work_run') {
      trustedGoal = { aggregateType: 'Goal', projectId: owned.projectId, goalId: sender.runRef.goalId };
      if (send.goalRef !== null
        && (send.goalRef.projectId !== trustedGoal.projectId || send.goalRef.goalId !== trustedGoal.goalId)) {
        return refuseSend(reject('invalid', 'the send goalRef disagrees with the sender Session\'s trusted Goal'), identityKey, fingerprint);
      }
    } else {
      const effectiveGoalId = secretaryRound === null ? null : secretaryRound.effectiveGoalId;
      trustedGoal = effectiveGoalId === null
        ? null : { aggregateType: 'Goal', projectId: owned.projectId, goalId: effectiveGoalId };
      if (send.goalRef !== null && (trustedGoal === null
        || send.goalRef.projectId !== trustedGoal.projectId || send.goalRef.goalId !== trustedGoal.goalId)) {
        return refuseSend(reject('invalid', 'the send goalRef disagrees with the sender round\'s effective Goal'), identityKey, fingerprint);
      }
    }
    // `taskRef` is a full Task triple of that Goal, and `followupOf` an existing
    // message between these two Sessions: one error each, no message written.
    if (send.taskRef !== null) {
      if (trustedGoal === null || send.taskRef.projectId !== trustedGoal.projectId
        || send.taskRef.goalId !== trustedGoal.goalId) {
        return refuseSend(reject('invalid', 'the send taskRef is not a Task of the message\'s Goal'), identityKey, fingerprint);
      }
    }
    if (send.followupOf !== null) {
      if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the follow-up read');
      const followed = await loadMessage(owned, send.followupOf);
      if (followed.status === 'not_found') return refuseSend(reject('invalid', 'the followupOf message does not exist'), identityKey, fingerprint);
      if (followed.status !== 'ready') return mapReadResult(followed) as CoreRejection;
      if (!followupConnects(followed.value, sender, send.recipient)) {
        return refuseSend(reject('invalid', 'the followupOf message is not between these two Sessions'), identityKey, fingerprint);
      }
    }

    // Only an autonomy-controlled, goal-bearing `action_request` uses the one
    // facts read; every other send never reads it. A read failure is the failure
    // and its guards are the facts' own.
    let basis: DispatchBasisFactsV1 | null = null;
    if (send.intent === 'action_request' && sender.kind !== 'host') {
      if (trustedGoal === null) return refuseSend(reject('invalid', 'an agent action_request requires the Goal it belongs to'), identityKey, fingerprint);
      if (send.expected === null) return refuseSend(reject('invalid', 'a goal-bearing action_request requires the expected basis'), identityKey, fingerprint);
      if (deps.dispatchBasis === undefined) {
        return refuseSend(reject('unsupported', 'the dispatch basis read is not configured for a new action_request'), identityKey, fingerprint);
      }
      if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the dispatch facts read');
      const facts = await deps.dispatchBasis.readDispatchFacts(internalHostContext(owned), { goalRef: trustedGoal });
      if (facts.status !== 'ready') return facts.status === 'rejected' ? facts : mapReadResult(facts) as CoreRejection;
      if (facts.value.plan === null) return refuseSend(reject('invalid', 'an action_request requires the Goal\'s active Plan'), identityKey, fingerprint);
      basis = facts.value;
      // A three-version mismatch is the stage's own read: its values and cursor,
      // and the current versions the caller has to re-read.
      if (!sameBasis(basis.values, send.expected)) {
        return refuseSend({
          ...reject('revision_conflict', 'the dispatch basis moved since it was read', basisPinsOf(basis)),
          dispatchCurrent: dispatchCurrentOf(basis),
        }, identityKey, fingerprint);
      }
    }

    // The action_request's own guard keys: a commit conflict on one of them is
    // the three-version window's, and only that one gets the post-miss read.
    const basisRefKeys = new Set((basis?.guards ?? []).map((guard) => guard.refKey));

    // Book §3.3 / §2.1 steps 8-11: a send is the record CONSTRUCTOR's create, and
    // its release is this path's own fact. A person's send keeps `release: null`.
    // A notify is always released and never counts or advances the Session. An
    // agent's inquiry or action_request takes the Goal's autonomy through the one
    // shared policy: 「每步确认」 awaits the person, the automatic level releases.
    // An inquiry freezes its duration; an `action_request` reads the basis above.
    let release: MessageReleaseV1 | null = null;
    let pins: DispatchBasisV1 | null = null;
    let goalGuard: RecordGuard | null = null;
    // The Goal facts the release was decided on travel to the state original,
    // which owns direct-release eligibility (`desiredState === 'active'`).
    let releaseGoal: { desiredState: 'active' | 'paused' | 'cancelled'; revision: number } | null = null;
    // Every inquiry freezes its duration (the input's, else the injected
    // default); the record stores `deadlineMs` and only a RELEASED inquiry stores
    // the instant. A missing injection is `unsupported`, never an invented one.
    let deadlineMs: number | null = null;
    if (send.intent === 'inquiry') {
      const duration = send.deadlineMs ?? deps.defaultInquiryDeadlineMs;
      // A NEW inquiry without a duration is `unsupported`: no silent "no deadline".
      if (duration === undefined) return refuseSend(reject('unsupported', 'the inquiry deadline duration is not configured'), identityKey, fingerprint);
      deadlineMs = duration;
    }
    if (sender.kind !== 'host' && send.intent !== null) {
      if (trustedGoal === null) {
        // A no-goal notify or inquiry is released directly; no Goal, no
        // counter and no pins. Any other agent intent still needs its Goal.
        if (send.intent !== 'notify' && send.intent !== 'inquiry') {
          return refuseSend(reject('invalid', `an agent ${send.intent} requires the Goal it belongs to`), identityKey, fingerprint);
        }
        release = 'released';
      } else {
        // An action_request reuses the ONE facts read's Goal; every other
        // goal-bearing send reads the Goal here and guards that same revision.
        let autonomy: GoalAutonomyV1;
        if (send.intent === 'action_request') {
          if (basis === null) throw new Error('an action_request release needs its dispatch facts');
          autonomy = basis.goal.settings.autonomy;
          releaseGoal = { desiredState: basis.goal.desiredState, revision: basis.goal.revision };
          goalGuard = { refKey: canonicalRefKey(basis.goal.ref), expectedRevision: basis.goal.revision };
        } else {
          if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the Goal read');
          const goal = await loadGoal(owned, trustedGoal);
          if (goal.status !== 'ready') return mapReadResult(goal) as CoreRejection;
          autonomy = goal.value.settings.autonomy;
          releaseGoal = { desiredState: goal.value.desiredState, revision: goal.value.revision };
          goalGuard = { refKey: canonicalRefKey(goal.value.ref), expectedRevision: goal.value.revision };
        }
        if (send.intent === 'notify') {
          // Notify is always released: it skips the counter and the activity
          // advance, never the Goal read or its guard.
          release = 'released';
        } else {
          const verdict = decisionActionPolicy({
            autonomy,
            action: send.intent === 'inquiry' ? 'secretary_inquiry' : 'secretary_action',
            actorClass: 'agent', countedNext: null, cap: 0,
          });
          release = verdict === 'needs_decision' ? 'awaiting' : 'released';
          if (send.intent === 'action_request') {
            // A released action_request pins the facts read BEFORE the counter +1; an
            // awaiting one pins the sender's own expected basis.
            pins = release === 'awaiting' ? send.expected : (basis === null ? null : basis.values);
          }
        }
      }
    }

    const messageRef: SessionMessageRef = {
      aggregateType: 'SessionMessage', projectId: owned.projectId, workspaceId: owned.workspaceId,
      messageId: messageIdOf(owned, senderIdentity, write.requestId),
    };
    // The release is decided above; the machine's accepted state carries it, so
    // the canonical comparison at commit needs no overlay (§3.4 invariant 1).
    // Its normal refusals (a direct release on a non-active Goal) are a result,
    // never an exception, and recover the same identity's receipt like the first
    // judge's refusals.
    const { decided: sent, ctx: sentCtx } = judge(owned.principal, null, { type: 'message_sent' },
      { ...sendFacts, sendRelease: { release, pins, goal: releaseGoal } });
    if (!sent.ok) return refuseSend(refusalOf(sent, sentCtx), identityKey, fingerprint);
    // The released inquiry's deadline is frozen at the commit's one clock instant;
    // an overflow is refused before anything is written.
    let frozenDeadline: string | null = null;
    const companions = async (at: string) => {
      if (release !== 'released') {
        return { ok: true as const,
          value: { records: [], events: [], guards: goalGuard === null ? [] : [goalGuard], claims: [] } };
      }
      const released = await releasedMessageCompanions(records, {
        at, messageRef, recipient: send.recipient, intent: send.intent, deadlineMs, basis,
      });
      if (!released.ok) return released;
      frozenDeadline = released.value.deadline;
      return {
        ok: true as const,
        value: {
          records: released.value.records,
          events: [],
          guards: goalGuard === null ? released.value.guards : [goalGuard, ...released.value.guards],
          claims: [],
        },
      };
    };

    const written = await writeMessage(sent, {
      owned, identityKey, fingerprint, requestId: write.requestId, actor: committedSender, admission: authorized,
      cancelled: 'the send was cancelled before commit',
      companions,
      body: { messageRef, text: text.text, answerSource: null },
      record: (createdAt, bodyRef) => createSessionMessageRecord({
        ref: messageRef, sender: committedSender, recipient: send.recipient, bodyRef, sourceRef: bodyRef.source, createdAt,
        intent: send.intent, needsReply: send.needsReply, waitAfterSend: send.waitAfterSend,
        goalRef: trustedGoal === null ? null : structuredClone(trustedGoal),
        taskRef: send.taskRef === null ? null : structuredClone(send.taskRef),
        followupOf: send.followupOf === null ? null : structuredClone(send.followupOf),
        requestRoot: secretaryRound === null ? null : { ...secretaryRound.requestRoot },
        release, pins, deadlineMs, deadline: frozenDeadline,
      }),
    });
    // The writer already re-checked this identity's receipt (a replay would have
    // returned committed). Only a three-version guard conflict reads the basis
    // once more; an activity-only or message conflict is never re-projected, and
    // this one extra read's failure returns the original written rejection.
    if (written.status === 'rejected' && written.code === 'revision_conflict'
      && basis !== null && trustedGoal !== null && deps.dispatchBasis !== undefined) {
      const dispatchBasis = deps.dispatchBasis;
      return sendStatusOf(await basisConflictCurrent(written, basisRefKeys,
        () => dispatchBasis.readDispatchFacts(internalHostContext(owned), { goalRef: trustedGoal })));
    }
    return sendStatusOf(written);
  }

  // ---- readMessage --------------------------------------------------------

  async function readMessage(ctx: CoreCallContext, ref: SessionMessageRef): Promise<ReadResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    // A read has no receipt to miss: a `query_run` caller's round is resolved on
    // every read, before any record read.
    let secretary: { round: SecretaryQueryRunV1; reader: SessionRef } | null = null;
    if (owned.principal.kind === 'query_run') {
      const reading = await secretaryReader(owned);
      if (!reading.ok) return reading.rejection;
      secretary = reading;
    }
    const normalized = normalizeMessageRef(ref);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
    if (scopeProblem !== null) return scopeProblem;
    const loaded = await loadMessage(owned, normalized.ref);
    if (loaded.status !== 'ready') return loaded;
    const right = await messageReadRight(owned, loaded.value, secretary);
    if (right !== null) return right;
    return loaded;
  }

  // ---- readMessageBody ----------------------------------------------------

  async function readMessageBody(ctx: CoreCallContext, input: { messageRef: SessionMessageRef; part: 'message' | 'response' }): Promise<ReadResult<import('../model/communication-contracts.js').MessageBody>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    let secretary: { round: SecretaryQueryRunV1; reader: SessionRef } | null = null;
    if (owned.principal.kind === 'query_run') {
      const reading = await secretaryReader(owned);
      if (!reading.ok) return reading.rejection;
      secretary = reading;
    }
    let raw: Unknown;
    try {
      raw = structuredClone(input) as unknown as Unknown;
    } catch {
      return reject('invalid', 'readMessageBody input cannot be isolated from the caller');
    }
    if (!isObject(raw)) return reject('invalid', 'readMessageBody requires an input object');
    if (Object.keys(raw).some((key) => key !== 'messageRef' && key !== 'part')) {
      return reject('invalid', 'readMessageBody does not accept extra fields');
    }
    const part = raw['part'];
    if (part !== 'message' && part !== 'response') return reject('invalid', 'readMessageBody part must be message or response');
    const normalized = normalizeMessageRef(raw['messageRef']);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
    if (scopeProblem !== null) return scopeProblem;
    const loaded = await loadMessage(owned, normalized.ref);
    if (loaded.status !== 'ready') return loaded;
    const message = loaded.value;
    const right = await messageReadRight(owned, message, secretary);
    if (right !== null) return right;
    const bodyRef = part === 'message' ? message.bodyRef : message.response?.bodyRef;
    const sourceRef = part === 'message' ? message.sourceRef : message.response?.sourceRef;
    if (bodyRef === undefined || sourceRef === undefined) return { status: 'not_found' };
    if (canonicalOf(bodyRef.source) !== canonicalOf(sourceRef)) {
      return reject('unavailable', 'the message body ref source disagrees with the message source');
    }
    if (owned.signal.aborted) return reject('cancelled', 'the message body read was cancelled before the material read');
    let opened: ReadResult<import('../../../contracts/artifact.js').ArtifactRecord>;
    try {
      opened = await deps.materials.openArtifact(internalHostContext(owned), { ref: bodyRef, usage: 'historical_explanation' });
    } catch {
      return reject('unavailable', 'the message body could not be opened');
    }
    if (opened.status === 'not_found') return reject('unavailable', 'the message body is missing');
    if (opened.status !== 'ready') return mapReadResult(opened) as CoreRejection;
    const decoded = isUserDecisionAnswerPart(message, part)
      ? decodeStoredUserDecisionBody(message, part, opened.value)
      : decodeStoredMessageBody(message, part, opened.value);
    if ('reason' in decoded) return reject('unavailable', decoded.reason);
    return {
      status: 'ready',
      value: { messageRef: message.ref, part, text: decoded.text, sourceRef, usage: 'message' },
    };
  }

  // ---- readInbox ----------------------------------------------------------

  type InboxPage = {
    items: SessionMessage[]; nextCursor: string | null; sourceCursor: CommitCursor; recipient: SessionRef;
  };

  /**
   * `readInbox`'s own body (input validation, keyset cursor, `atLeastCursor`,
   * page limit, recipient/filter binding and recipient-bound authorization),
   * shared with `readInboxView` so the two can never drift.
   */
  async function readInboxPage(owned: Owned, input: {
    recipient: SessionRef;
    status?: SessionMessageStatus;
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
  }): Promise<ReadResult<InboxPage>> {
    const raw = input as unknown as Unknown | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'readInbox requires an input object');
    if (Object.keys(raw).some((key) => key !== 'recipient' && key !== 'status' && key !== 'page')) {
      return reject('invalid', 'readInbox does not accept extra fields');
    }
    const recipientProblem = checkPlainSessionRef(raw['recipient']);
    if (recipientProblem !== null) return reject('invalid', `readInbox recipient: ${recipientProblem}`);
    const recipient = structuredClone(raw['recipient']) as SessionRef;
    if (recipient.projectId !== owned.projectId) return reject('forbidden', 'the inbox recipient belongs to another project');
    const status = raw['status'];
    if (status !== undefined && status !== 'pending' && status !== 'read' && status !== 'responded') {
      return reject('invalid', 'the inbox status filter is not recognized');
    }
    const page = pageProblem(raw['page'], {
      requiresObject: 'readInbox requires a page object',
      extraFields: 'readInbox page does not accept extra fields',
      limit: 'readInbox limit must be an integer between 1 and 100',
    });
    if (!page.ok) return page.rejection;
    // Snapshot the complete page synchronously. No later await may re-read a
    // caller-mutable `page`; the decoded cursor below is the accepted one.
    if (page.rawCursor !== undefined && !nonEmpty(page.rawCursor)) {
      return reject('invalid', 'the inbox cursor must be a non-empty string');
    }
    let decodedCursor: InboxCursorV1 | null = null;
    if (page.rawCursor !== undefined) {
      decodedCursor = decodeInboxCursor(page.rawCursor);
      if (decodedCursor === null) return reject('invalid', 'the inbox cursor is not a valid continuation token');
      if (decodedCursor.projectId !== owned.projectId || decodedCursor.workspaceId !== owned.workspaceId
        || canonicalOf(decodedCursor.recipient) !== canonicalOf(recipient)
        || (decodedCursor.status ?? null) !== (status ?? null)) {
        return reject('invalid', 'the inbox cursor belongs to another scope, recipient or filter');
      }
    }
    const atLeast = atLeastCursorOf(page.rawAtLeast);
    if (!atLeast.ok) return atLeast.rejection;
    const after = decodedCursor?.after;

    let secretary: { round: SecretaryQueryRunV1; reader: SessionRef } | null = null;
    if (owned.principal.kind === 'query_run') {
      const reading = await secretaryReader(owned);
      if (!reading.ok) return reading.rejection;
      secretary = reading;
    }
    let callerKey: string;
    if (owned.principal.kind === 'host') {
      callerKey = canonicalOf({ kind: 'host', actor: { ...owned.principal.actor } }) ?? '';
    } else if (owned.principal.kind === 'work_run') {
      const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
      if (!identity.ok) return identity.rejection;
      const sessionRef: SessionRef = {
        projectId: identity.claim.sessionRef.projectId,
        sessionId: identity.claim.sessionRef.sessionId,
      };
      if (sessionRef.projectId !== recipient.projectId || sessionRef.sessionId !== recipient.sessionId) {
        return reject('forbidden', 'a work_run inbox is limited to its own formal Session');
      }
      callerKey = canonicalOf({ kind: 'work_run', sessionRef, runRef: identity.run.ref }) ?? '';
    } else {
      if (secretary === null) return reject('forbidden', 'the secretary inbox was not resolved');
      if (!sameSessionRefAs(secretary.reader, recipient)) {
        return reject('forbidden', 'a query_run inbox is limited to the resolved round Session');
      }
      callerKey = canonicalOf({ kind: 'query_run', sessionRef: secretary.reader,
        queryRunRef: secretary.round.run }) ?? '';
    }
    // Bind the ALREADY-DECODED snapshot to the trusted caller.
    if (decodedCursor !== null && decodedCursor.callerKey !== callerKey) {
      return reject('invalid', 'the inbox cursor does not belong to the current caller');
    }

    const filtered = status !== undefined;
    const request: RecordLookupRequest = {
      index: filtered ? SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP : SESSION_MESSAGE_BY_RECIPIENT_LOOKUP,
      values: filtered
        ? [owned.projectId, owned.workspaceId, recipient.sessionId, status]
        : [owned.projectId, owned.workspaceId, recipient.sessionId],
      limit: page.limit,
      ...(after === undefined ? {} : { after }),
    };
    let pageResult: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
    try {
      pageResult = await records.lookup(request);
    } catch {
      return reject('unavailable', 'the inbox lookup failed');
    }
    if (pageResult.status !== 'ready') return mapStoreFailure(pageResult);
    const progress = readProgress(pageResult.value.readThrough, atLeast.atLeast);
    if (!progress.ok) return progress.result;
    const readThrough = progress.readThrough;
    const items: SessionMessage[] = [];
    for (const record of pageResult.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return reject('unavailable', `an inbox candidate is damaged: ${decoded.reason}`);
      const message = decoded.value;
      const candidateRecipient = message.recipient;
      if (sessionMessageRefKey(message.ref) !== record.refKey
        || message.ref.projectId !== owned.projectId
        || message.ref.workspaceId !== owned.workspaceId
        || isUserRecipient(candidateRecipient)
        || candidateRecipient.projectId !== owned.projectId
        || candidateRecipient.sessionId !== recipient.sessionId
        || (status !== undefined && message.status !== status)) {
        return reject('unavailable', 'an inbox candidate disagrees with the requested recipient or filter');
      }
      items.push(message);
    }
    const nextCursor = pageResult.value.next === null ? null : encodeInboxCursor({
      v: 1,
      projectId: owned.projectId,
      workspaceId: owned.workspaceId,
      recipient,
      status: status ?? null,
      callerKey,
      after: pageResult.value.next,
    });
    return { status: 'ready', value: { items, nextCursor, sourceCursor: readThrough, recipient } };
  }

  async function readInbox(ctx: CoreCallContext, input: {
    recipient: SessionRef;
    status?: SessionMessageStatus;
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
  }): Promise<ReadResult<{ items: SessionMessage[]; nextCursor: string | null; sourceCursor: CommitCursor }>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const page = await readInboxPage(owned, input);
    if (page.status !== 'ready') return page;
    const { items, nextCursor, sourceCursor } = page.value;
    return { status: 'ready', value: { items, nextCursor, sourceCursor } };
  }

  async function readInboxView(ctx: CoreCallContext, input: {
    recipient: SessionRef;
    status?: SessionMessageStatus;
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
  }): Promise<ReadResult<SessionMessageReadPageV1>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const page = await readInboxPage(owned, input);
    if (page.status !== 'ready') return page;
    const { items, nextCursor, sourceCursor, recipient } = page.value;
    if (items.length === 0) return { status: 'ready', value: { items: [], nextCursor, sourceCursor } };
    const line = await recipientLineFacts(owned, recipient);
    if (!line.ok) return line.rejection;
    return { status: 'ready', value: {
      items: items.map((message) => ({ message, ...deriveMessageDelivery(message, line.value), releaseBlock: null })),
      nextCursor, sourceCursor,
    } };
  }

  // ---- readOutbox ---------------------------------------------------------

  /**
   * Read messages SENT BY one exact Work Run or Session. It mirrors `readInbox`'s
   * keyset/atLeast contract over registered indexes: a Host caller may read its
   * workspace, a work_run caller only its own Run or Session. It never
   * acks, wakes or reorders a Session and never scans all Sessions.
   */
  async function readOutbox(ctx: CoreCallContext, input: {
    senderRun?: RunRef;
    senderSession?: SessionRef;
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
  }): Promise<ReadResult<SessionMessageOutboxPageV1>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const raw = input as unknown as Unknown | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'readOutbox requires an input object');
    if (Object.keys(raw).some((key) => key !== 'senderRun' && key !== 'senderSession' && key !== 'page')) {
      return reject('invalid', 'readOutbox does not accept extra fields');
    }
    if ((raw['senderRun'] === undefined) === (raw['senderSession'] === undefined))
      return reject('invalid', 'readOutbox requires exactly one sender Run or Session');
    if (raw['senderRun'] !== undefined && !isRunRef(raw['senderRun'])) return reject('invalid', 'readOutbox requires a complete RunRef');
    if (raw['senderSession'] !== undefined && checkPlainSessionRef(raw['senderSession']) !== null)
      return reject('invalid', 'readOutbox requires a complete SessionRef');
    const senderRun = raw['senderRun'] === undefined ? undefined : structuredClone(raw['senderRun']) as RunRef;
    const senderSession = raw['senderSession'] === undefined ? undefined : structuredClone(raw['senderSession']) as SessionRef;
    if ((senderRun ?? senderSession)!.projectId !== owned.projectId) return reject('forbidden', 'the outbox sender belongs to another project');
    const page = pageProblem(raw['page'], {
      requiresObject: 'readOutbox requires a page object',
      extraFields: 'readOutbox page does not accept extra fields',
      limit: 'readOutbox limit must be an integer between 1 and 100',
    });
    if (!page.ok) return page.rejection;
    if (page.rawCursor !== undefined && !nonEmpty(page.rawCursor)) {
      return reject('invalid', 'the outbox cursor must be a non-empty string');
    }
    const atLeast = atLeastCursorOf(page.rawAtLeast);
    if (!atLeast.ok) return atLeast.rejection;

    // A secretary's outbox is the request root's messages, not a Run/Session
    // index range: the resolver supplies the root and the sending Session, and
    // the request-root index pages it. Host/work_run semantics stay below.
    if (owned.principal.kind === 'query_run') {
      const reading = await secretaryReader(owned);
      if (!reading.ok) return reading.rejection;
      if (senderRun !== undefined) return reject('invalid', 'a secretary outbox read requires senderSession');
      const session = senderSession as SessionRef;
      if (!sameSessionRefAs(session, reading.reader)) {
        return reject('forbidden', 'a secretary outbox read is limited to the resolved round Session');
      }
      const callerKey = canonicalOf({ kind: 'query_run', sessionRef: reading.reader,
        queryRunRef: reading.round.run }) ?? '';
      let cursor: SecretaryOutboxCursorV1 | null = null;
      if (page.rawCursor !== undefined) {
        cursor = decodeSecretaryOutboxCursor(page.rawCursor);
        if (cursor === null) return reject('invalid', 'the outbox cursor is not a valid continuation token');
        if (cursor.projectId !== owned.projectId || cursor.workspaceId !== owned.workspaceId
          || canonicalOf(cursor.requestRoot) !== canonicalOf(reading.round.requestRoot)
          || cursor.callerKey !== callerKey) {
          return reject('invalid', 'the outbox cursor belongs to another scope, request root or caller');
        }
      }
      const request: RecordLookupRequest = {
        index: SESSION_MESSAGE_BY_REQUEST_ROOT_LOOKUP,
        values: [owned.projectId, owned.workspaceId, reading.round.requestRoot.queryJobId],
        limit: page.limit,
        ...(cursor === null ? {} : { after: cursor.after }),
      };
      let result: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
      try {
        result = await records.lookup(request);
      } catch {
        return reject('unavailable', 'the outbox lookup failed');
      }
      if (result.status !== 'ready') return mapStoreFailure(result);
      const progress = readProgress(result.value.readThrough, atLeast.atLeast);
      if (!progress.ok) return progress.result;
      const items: SessionMessage[] = [];
      for (const record of result.value.records) {
        const decoded = decodeSessionMessageRecord(record);
        if (decoded.status !== 'decoded') return reject('unavailable', `an outbox candidate is damaged: ${decoded.reason}`);
        const message = decoded.value;
        if (sessionMessageRefKey(message.ref) !== record.refKey
          || message.ref.projectId !== owned.projectId || message.ref.workspaceId !== owned.workspaceId
          || message.requestRoot === null
          || canonicalOf(message.requestRoot) !== canonicalOf(reading.round.requestRoot)
          || message.sender.kind !== 'secretary_round'
          || canonicalOf(message.sender.requestRoot) !== canonicalOf(reading.round.requestRoot)) {
          return reject('unavailable', 'an outbox candidate disagrees with the resolved request root');
        }
        items.push(message);
      }
      const nextCursor = result.value.next === null ? null : encodeSecretaryOutboxCursor({
        v: 1, projectId: owned.projectId, workspaceId: owned.workspaceId,
        requestRoot: { ...reading.round.requestRoot }, callerKey, after: result.value.next,
      });
      const releaseBlocks: (MessageReleaseBlockV1 | null)[] = [];
      for (const message of items) {
        const block = await releaseBlockOf(owned, message);
        if (block.status !== 'ready') return block;
        releaseBlocks.push(block.value);
      }
      return { status: 'ready', value: { items, releaseBlocks, nextCursor, sourceCursor: progress.readThrough } };
    }

    let decodedCursor: OutboxCursorV1 | null = null;
    if (page.rawCursor !== undefined) {
      decodedCursor = decodeOutboxCursor(page.rawCursor);
      if (decodedCursor === null) return reject('invalid', 'the outbox cursor is not a valid continuation token');
      if (decodedCursor.projectId !== owned.projectId || decodedCursor.workspaceId !== owned.workspaceId
        || canonicalOf(decodedCursor.senderRun ?? decodedCursor.senderSession) !== canonicalOf(senderRun ?? senderSession)) {
        return reject('invalid', 'the outbox cursor belongs to another scope or sender Run');
      }
    }
    const after = decodedCursor?.after;

    let callerKey: string;
    if (owned.principal.kind === 'host') {
      callerKey = canonicalOf({ kind: 'host', actor: { ...owned.principal.actor } }) ?? '';
    } else if (owned.principal.kind === 'work_run') {
      const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
      if (!identity.ok) return identity.rejection;
      if (senderRun !== undefined ? canonicalOf(identity.run.ref) !== canonicalOf(senderRun)
        : canonicalOf(identity.claim.sessionRef) !== canonicalOf(senderSession)) {
        return reject('forbidden', 'a work_run outbox read is limited to its own Run or Session');
      }
      callerKey = canonicalOf({ kind: 'work_run', sessionRef: identity.claim.sessionRef, runRef: identity.run.ref }) ?? '';
    } else {
      return reject('forbidden', 'the mailbox reader principal is not supported');
    }
    if (decodedCursor !== null && decodedCursor.callerKey !== callerKey) {
      return reject('invalid', 'the outbox cursor does not belong to the current caller');
    }

    const request: RecordLookupRequest = {
      index: senderRun === undefined ? SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP : SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP,
      values: senderRun === undefined ? [owned.projectId, owned.workspaceId, senderSession!.sessionId]
        : [owned.projectId, owned.workspaceId, senderRun.goalId, senderRun.runId],
      limit: page.limit,
      ...(after === undefined ? {} : { after }),
    };
    let pageResult: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
    try {
      pageResult = await records.lookup(request);
    } catch {
      return reject('unavailable', 'the outbox lookup failed');
    }
    if (pageResult.status !== 'ready') return mapStoreFailure(pageResult);
    const progress = readProgress(pageResult.value.readThrough, atLeast.atLeast);
    if (!progress.ok) return progress.result;
    const readThrough = progress.readThrough;
    const items: SessionMessage[] = [];
    for (const record of pageResult.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return reject('unavailable', `an outbox candidate is damaged: ${decoded.reason}`);
      const message = decoded.value;
      if (sessionMessageRefKey(message.ref) !== record.refKey || message.ref.projectId !== owned.projectId
        || message.ref.workspaceId !== owned.workspaceId) return reject('unavailable', 'an outbox candidate disagrees with the requested sender Run');
      // The person reads the Session's whole outbox, including what its
      // secretary round sent; a work_run keeps only its own work_run messages.
      if (senderRun === undefined && message.sender.kind === 'secretary_round'
        && canonicalOf(message.sender.sessionRef) === canonicalOf(senderSession)) {
        if (owned.principal.kind === 'host') items.push(message);
        continue;
      }
      if (message.sender.kind !== 'work_run' || (senderRun === undefined
        ? canonicalOf(message.sender.sessionRef) !== canonicalOf(senderSession)
        : canonicalOf(message.sender.runRef) !== canonicalOf(senderRun))) {
        return reject('unavailable', 'an outbox candidate disagrees with the requested sender Run');
      }
      items.push(message);
    }
    const nextCursor = pageResult.value.next === null ? null : encodeOutboxCursor({
      v: 1,
      projectId: owned.projectId,
      workspaceId: owned.workspaceId,
      ...(senderRun === undefined ? { senderSession: senderSession! } : { senderRun }),
      callerKey,
      after: pageResult.value.next,
    });
    const releaseBlocks: (MessageReleaseBlockV1 | null)[] = [];
    for (const message of items) {
      const block = await releaseBlockOf(owned, message);
      if (block.status !== 'ready') return block;
      releaseBlocks.push(block.value);
    }
    return { status: 'ready', value: { items, releaseBlocks, nextCursor, sourceCursor: readThrough } };
  }

  // ---- ackMessage ---------------------------------------------------------

  async function ackMessage(ctx: CoreCallContext, request: GraphWrite<{ messageRef: SessionMessageRef }>): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.principal.kind !== 'work_run') return principalRefusal(owned.principal, { type: 'message_read' });
    if (owned.signal.aborted) return reject('cancelled', 'the acknowledgement was cancelled before validation');
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    const raw = write.input as unknown as Unknown | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'ackMessage requires an input object');
    const normalized = normalizeMessageRef(raw['messageRef']);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
    if (scopeProblem !== null) return scopeProblem;
    const pins = pinsOf(write.expected, normalized.ref);
    if (!pins.ok) return pins.rejection;

    const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    const derived = deriveWorkRunSender(identity);
    if (!derived.ok) return derived.rejection;
    const sender = derived.sender;
    const senderIdentity = senderIdentityOf(sender);
    const identityKey = identityKeyOf('ack', owned, senderIdentity, write.requestId);
    const fingerprint = fingerprintOf('ack', owned, senderIdentity, { messageRef: normalized.ref }, write.expected);
    if (owned.signal.aborted) return reject('cancelled', 'the acknowledgement was cancelled before the idempotency lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    const authorized = await authorizeNewWorkRunAction({
      owned, principal: owned.principal, operationToolName: 'ack_session_message',
    });
    // MSG-03. A refused admission never reads the message (the machine asks the
    // admission before the record).
    const read = authorized.ok ? await loadMessageForWrite(owned, normalized.ref) : { ok: true as const, message: null };
    if (!read.ok) return read.rejection;
    const message = read.message;
    const { decided, ctx: messageCtx } = judge(owned.principal, message, { type: 'message_read' }, {
      workRunAuthorization: authorized.ok ? 'ok' : authorized.rejection,
      callerIsRecipient: message === null ? null : ownsInbox(sender.sessionRef, message),
      pins: pins.pins,
    });
    // A same-identity request may have committed this exact acknowledgement
    // while this call sat between its first receipt miss and the message read:
    // its receipt is restored (`refuse`); a genuine different request
    // keeps the domain rejection and never commits a second time.
    if (!decided.ok) return refuse(decided, messageCtx, identityKey, fingerprint);
    const current = acceptedMessage(message);
    return writeMessage(decided, {
      owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: authorized,
      cancelled: 'the acknowledgement was cancelled before commit',
      body: null,
      record: (readAt) => nextSessionMessageRecord(current, { kind: 'read', readAt }),
    });
  }

  // ---- respondMessage -----------------------------------------------------

  async function respondMessage(ctx: CoreCallContext, request: SessionMessageRespondInputV1): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.principal.kind !== 'work_run') return principalRefusal(owned.principal, { type: 'message_responded', via: 'text' });
    if (owned.signal.aborted) return reject('cancelled', 'the response was cancelled before validation');
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    const raw = write.input as unknown as Unknown | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'respondMessage requires an input object');
    // T's ONE respond payload model: the version is the single message pin in
    // `meta.expected` (never a body key), so the normalized value is decoded
    // with it and the fingerprint payload keeps only `{messageRef, ...body}`.
    const pin = write.expected.length === 1 && isObject(write.expected[0])
      ? write.expected[0] as unknown as Unknown : null;
    const normalized = normalizeRespondMessageInput({
      ...raw, expectedRevision: pin === null ? undefined : pin['revision'],
    });
    if (normalized.status === 'not_found') return reject('not_found', 'the requested record does not exist');
    if (normalized.status === 'not_ready') return reject('incomplete', 'the response payload is not readable');
    if (normalized.status === 'rejected') return normalized;
    const value = normalized.value;
    const messageRef = value.messageRef;
    const arm = 'reject' in value
      ? { reject: true as const, reason: value.reason }
      : { text: value.text };
    const scopeProblem = scopeOfMessageRef(owned, messageRef);
    if (scopeProblem !== null) return scopeProblem;
    const pins = pinsOf(write.expected, messageRef);
    if (!pins.ok) return pins.rejection;
    // The reason is the refusal's reply body, held to the same bound as text.
    const saved = normalizeText(arm.reject === true ? arm.reason : arm.text);
    if (!saved.ok) return saved.rejection;

    const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    const derived = deriveWorkRunSender(identity);
    if (!derived.ok) return derived.rejection;
    const sender = derived.sender;
    const senderIdentity = senderIdentityOf(sender);
    const identityKey = identityKeyOf('respond', owned, senderIdentity, write.requestId);
    const fingerprint = fingerprintOf('respond', owned, senderIdentity, { messageRef, ...arm }, write.expected);
    if (owned.signal.aborted) return reject('cancelled', 'the response was cancelled before the idempotency lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    const authorized = await authorizeNewWorkRunAction({
      owned, principal: owned.principal, operationToolName: 'respond_session_message',
    });
    // MSG-04/05. A refused admission never reads the message.
    const read = authorized.ok ? await loadMessageForWrite(owned, messageRef) : { ok: true as const, message: null };
    if (!read.ok) return read.rejection;
    const message = read.message;
    const { decided, ctx: messageCtx } = judge(owned.principal, message,
      arm.reject === true
        ? { type: 'message_responded', via: 'text', rejected: true }
        : { type: 'message_responded', via: 'text' }, {
      workRunAuthorization: authorized.ok ? 'ok' : authorized.rejection,
      callerIsRecipient: message === null ? null : ownsInbox(sender.sessionRef, message),
      pins: pins.pins,
      bodyBounded: true, // `normalizeText` held with the request
    });
    // See the acknowledgement: this exact identity's committed receipt is
    // restored instead of a second, conflicting rejection.
    if (!decided.ok) return refuse(decided, messageCtx, identityKey, fingerprint);
    const current = acceptedMessage(message);
    return writeMessage(decided, {
      owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: authorized,
      cancelled: 'the response was cancelled before commit',
      body: { messageRef: current.ref, text: saved.text, answerSource: null },
      ...(arm.reject === true ? { acceptedRejectedAt: true as const } : {}),
      // A refusal and an application share one first-wins slot; the time is
      // this commit's own instant.
      record: (respondedAt, bodyRef) => arm.reject === true
        ? nextSessionMessageRecord(current, { kind: 'responded', rejectedAt: respondedAt,
            response: { sender, bodyRef, sourceRef: bodyRef.source, respondedAt, reject: true, reason: arm.reason } })
        : nextSessionMessageRecord(current, { kind: 'responded', rejectedAt: null,
            response: { sender, bodyRef, sourceRef: bodyRef.source, respondedAt } }),
    });
  }

  // ---- respondFromQueryAnswer (Host-only association) ---------------------

  /**
   * Associate an ALREADY-SAVED formal Query Answer with the original message's
   * single response slot. The body and the `query_run` sender are read from the
   * settled Answer/Job/Run, never from caller text or caller identity. The
   * scope, consultation binding, deterministic message identity, original
   * recipient and actual claimed Session generation are all re-checked before
   * the one CAS response write.
   */
  async function respondFromQueryAnswer(
    ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef; answerRef: QueryJobAnswerRef }>,
  ): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.principal.kind !== 'host') return principalRefusal(owned.principal, { type: 'message_responded', via: 'query_answer' });
    if (owned.signal.aborted) return reject('cancelled', 'the answer association was cancelled before validation');
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    const raw = write.input as unknown as Unknown | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'respondFromQueryAnswer requires an input object');
    if (Object.keys(raw).some((key) => key !== 'messageRef' && key !== 'answerRef')) {
      return reject('invalid', 'respondFromQueryAnswer does not accept extra fields');
    }
    const normalized = normalizeMessageRef(raw['messageRef']);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
    if (scopeProblem !== null) return scopeProblem;
    const rawAnswer = raw['answerRef'];
    if (!isObject(rawAnswer) || rawAnswer['aggregateType'] !== 'QueryJobAnswer'
      || !nonEmpty(rawAnswer['projectId']) || !nonEmpty(rawAnswer['workspaceId'])
      || !nonEmpty(rawAnswer['queryJobId']) || !nonEmpty(rawAnswer['answerId'])
      || Object.keys(rawAnswer).some((key) => !['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'answerId'].includes(key))) {
      return reject('invalid', 'respondFromQueryAnswer requires a complete QueryJobAnswerRef');
    }
    let answerRef: QueryJobAnswerRef;
    try { answerRef = structuredClone(rawAnswer) as unknown as QueryJobAnswerRef; }
    catch { return reject('invalid', 'the answer ref cannot be isolated from the caller'); }
    if (answerRef.projectId !== owned.projectId || answerRef.workspaceId !== owned.workspaceId) {
      return reject('forbidden', 'the Query answer ref is outside the bound project/workspace');
    }
    const pins = pinsOf(write.expected, normalized.ref);
    if (!pins.ok) return pins.rejection;

    // MSG-06. The Query facts are read only for an existing message (an absent
    // one is refused first). The binding, the settled Query facts and the body
    // bound refuse before the receipt lookup, which needs the derived sender.
    const read = await loadMessageForWrite(owned, normalized.ref);
    if (!read.ok) return read.rejection;
    const message = read.message;
    let facts: QueryAnswerFacts | null = null;
    if (message !== null) {
      const gathered = await readQueryAnswerFacts(owned, message, answerRef);
      if (!gathered.ok) return gathered.rejection;
      facts = gathered.facts;
    }
    const { decided, ctx: messageCtx } = judge(owned.principal, message, { type: 'message_responded', via: 'query_answer' }, {
      pins: pins.pins,
      queryAnswer: facts === null ? null : facts.verdict,
      bodyBounded: facts === null ? null : facts.bodyBounded,
    });
    if (!decided.ok && (message === null || decided.reason === 'guard_failed')) return refusalOf(decided, messageCtx);
    if (message === null || facts === null || facts.sender === null) {
      throw new Error('MSG-06 passed its Query guards without the derived query_run sender');
    }

    const sender = facts.sender;
    const senderIdentity = senderIdentityOf(sender);
    const identityKey = identityKeyOf('respond_from_query_answer', owned, senderIdentity, write.requestId);
    const fingerprint = fingerprintOf('respond_from_query_answer', owned, senderIdentity,
      { messageRef: message.ref, answerRef }, write.expected);
    if (owned.signal.aborted) return reject('cancelled', 'the answer association was cancelled before the idempotency lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    // The single response slot (first come with MSG-04/05) is judged after the
    // lookup, so this identity's committed receipt replays; the pin is the
    // commit's message CAS.
    if (!decided.ok) return refuse(decided, messageCtx, identityKey, fingerprint);
    return writeMessage(decided, {
      owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: null,
      cancelled: 'the answer association was cancelled before commit',
      body: { messageRef: message.ref, text: facts.text, answerSource: facts.answerSource },
      record: (respondedAt, bodyRef) => nextSessionMessageRecord(message, {
        kind: 'responded', response: { sender, bodyRef, sourceRef: bodyRef.source, respondedAt }, rejectedAt: null,
      }),
    });
  }

  // ---- recordConsultationDerivation (Host-only fixed A′ fact) -------------

  async function recordConsultationDerivation(
    ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef; derivation: NonNullable<SessionMessage['consultationDerivation']> }>,
  ): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.principal.kind !== 'host') return principalRefusal(owned.principal, { type: 'consultation_derived' });
    if (owned.signal.aborted) return reject('cancelled', 'the derivation record was cancelled before validation');
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    const raw = write.input as unknown;
    if (!isObject(raw)) return reject('invalid', 'recordConsultationDerivation requires an input object');
    if (Object.keys(raw).some(key => key !== 'messageRef' && key !== 'derivation')) {
      return reject('invalid', 'recordConsultationDerivation does not accept extra fields');
    }
    const normalized = normalizeMessageRef(raw['messageRef']);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
    if (scopeProblem !== null) return scopeProblem;
    const derivation = raw['derivation'];
    if (!isObject(derivation)) return reject('invalid', 'recordConsultationDerivation requires a derivation object');
    const pins = pinsOf(write.expected, normalized.ref);
    if (!pins.ok) return pins.rejection;
    const sender: MessageSender = { kind: 'host', actor: { ...owned.principal.actor } };
    const identityKey = identityKeyOf('consultation-derivation', owned, senderIdentityOf(sender), write.requestId);
    const fingerprint = fingerprintOf('consultation-derivation', owned, senderIdentityOf(sender),
      { messageRef: normalized.ref, derivation }, write.expected);
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    // MSG-09: the first derivation wins; its shape is the codec's at commit.
    const read = await loadMessageForWrite(owned, normalized.ref);
    if (!read.ok) return read.rejection;
    const message = read.message;
    const { decided, ctx: messageCtx } = judge(owned.principal, message, { type: 'consultation_derived' }, { pins: pins.pins });
    if (!decided.ok) return refuse(decided, messageCtx, identityKey, fingerprint);
    const current = acceptedMessage(message);
    return writeMessage(decided, {
      owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: null,
      cancelled: 'the derivation record was cancelled before commit',
      body: null,
      record: () => nextSessionMessageRecord(current, {
        kind: 'consultation_derived', derivation: derivation as NonNullable<SessionMessage['consultationDerivation']>,
      }),
    });
  }

  // ---- recordInputAccepted (Runtime observer confirmation) ---------------

  async function recordInputAccepted(
    ctx: CoreCallContext,
    request: GraphWrite<{
      messageRef: SessionMessageRef;
      part: 'message' | 'response';
      executionRef: RunRef | QueryRunRef;
      executionSessionRef?: SessionRef;
      kernel: { adapterId: string; kernelSessionId: string; runId: string; turnId: string; position: number };
    }>,
  ): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.signal.aborted) return reject('cancelled', 'the input acceptance was cancelled before validation');
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    const raw = write.input as unknown;
    if (!isObject(raw)) return reject('invalid', 'recordInputAccepted requires an input object');
    if (Object.keys(raw).some(key => !['messageRef', 'part', 'executionRef', 'executionSessionRef', 'kernel'].includes(key))) {
      return reject('invalid', 'recordInputAccepted does not accept extra fields');
    }

    const normalized = normalizeMessageRef(raw['messageRef']);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
    if (scopeProblem !== null) return scopeProblem;
    const part = raw['part'];
    if (part !== 'message' && part !== 'response') return reject('invalid', 'recordInputAccepted part must be message or response');
    const executionRef = raw['executionRef'];
    if (!isObject(executionRef) || !['Run', 'QueryRun'].includes(String(executionRef['aggregateType']))) {
      return reject('forbidden', 'the accepted input execution must be a RunRef or QueryRunRef');
    }
    const observerOwnsExecution = owned.principal.kind !== 'work_run' || canonicalOf(executionRef) === canonicalOf(owned.principal.runRef);
    const observerRejection = guardRejection(inputObserverProblem(observerOwnsExecution));
    if (observerRejection !== null) return observerRejection;
    if (executionRef['projectId'] !== owned.projectId) {
      return reject('forbidden', 'the accepted input execution is outside the project');
    }
    const kernel = raw['kernel'];
    if (!isObject(kernel) || Object.keys(kernel).some(key => !['adapterId', 'kernelSessionId', 'runId', 'turnId', 'position'].includes(key))
      || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId'])
      || !nonEmpty(kernel['runId']) || !nonEmpty(kernel['turnId'])
      || !isPositiveInt(kernel['position'])) {
      return reject('invalid', 'recordInputAccepted requires a complete Kernel event identity');
    }
    const sender: MessageSender = { kind: 'host', actor: { ...deps.systemActor } };
    const senderIdentity = senderIdentityOf(sender);
    const identityKey = `input-accepted:${sha256Hex(canonicalJson({ messageRef: normalized.ref, part, executionRef, kernel } as unknown as JsonValue))}`;
    const fingerprint = fingerprintOf('input-accepted', owned, senderIdentity,
      { messageRef: normalized.ref, part, executionRef, kernel }, []);
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    // MSG-07/08. The execution facts are read only for an existing message (an
    // absent one is refused first); their read failures keep today's rejections.
    const read = await loadMessageForWrite(owned, normalized.ref);
    if (!read.ok) return read.rejection;
    const message = read.message;
    const inputId = deriveSessionInputId(normalized.ref, part);
    let facts: MessageGuardContext['inputAccepted'] = null;
    if (message !== null) {
      let actualSession: SessionRef;
      let actualKernel: { adapterId: string; kernelSessionId: string; runId: string; turnId: string } | null | undefined;
      if (executionRef['aggregateType'] === 'Run') {
        const runFacts = await readFreshWorkRunFacts(owned, executionRef as unknown as RunRef);
        if (!runFacts.ok) return runFacts.rejection;
        actualSession = { projectId: runFacts.record.outbox.claim.sessionRef.projectId, sessionId: runFacts.record.outbox.claim.sessionRef.sessionId };
        const authorization = runFacts.record.run.executionAuthorization;
        actualKernel = runFacts.record.run.executionHistory?.kernel ?? authorization?.kernel;
      } else {
        if (executionRef['workspaceId'] !== owned.workspaceId) return reject('forbidden', 'Query execution is outside the workspace');
        const queryFacts = await loadQueryRun(owned, executionRef as unknown as QueryRunRef);
        if (queryFacts.status !== 'ready') return mapReadResult(queryFacts) as CoreRejection;
        const state = queryFacts.value.run.executionState;
        if (state === undefined) return reject('unavailable', 'Query has no execution identity');
        actualSession = { projectId: state.sessionRef.projectId, sessionId: state.sessionRef.sessionId };
        actualKernel = state.entry?.kernel;
      }
      // The same original event is identified independently of observing
      // actor/revision: an entry of another executionRef or Kernel position is
      // another event's; this event's own entry is the machine's duplicate.
      const accepted = (message.acceptedInputs ?? []).find(entry => entry.inputId === inputId);
      facts = {
        observerOwnsExecution,
        kernelMatches: actualKernel !== undefined && actualKernel !== null
          && actualKernel.adapterId === kernel['adapterId'] && actualKernel.kernelSessionId === kernel['kernelSessionId']
          && actualKernel.runId === kernel['runId'] && actualKernel.turnId === kernel['turnId'],
        claimedSessionMatches: raw['executionSessionRef'] === undefined
          || canonicalOf(raw['executionSessionRef']) === canonicalOf(actualSession),
        executionSessionMatches: part === 'response'
          ? effectiveReplyHandler(message) !== null
            && canonicalOf(effectiveReplyHandler(message)) === canonicalOf(actualSession)
          : canonicalOf(message.recipient) === canonicalOf(actualSession),
        inputIdTakenByOtherEvent: accepted !== undefined
          && (canonicalOf(accepted.executionRef) !== canonicalOf(executionRef) || canonicalOf(accepted.kernel) !== canonicalOf(kernel)),
      };
    }
    const { decided, ctx: messageCtx } = judge(owned.principal, message, { type: 'input_accepted', part, inputId }, { inputAccepted: facts });
    // Only the inputId uniqueness refusals (`invalid`: another event's entry, or
    // this event's own without its receipt) re-check the receipt first.
    if (!decided.ok) return refuse(decided, messageCtx, identityKey, fingerprint);
    const current = acceptedMessage(message);
    return writeMessage(decided, {
      owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: null,
      cancelled: 'the input acceptance was cancelled before commit',
      body: null,
      record: (acceptedAt) => nextSessionMessageRecord(current, {
        kind: 'input_accepted',
        input: {
          inputId, part, executionRef: executionRef as RunRef | QueryRunRef,
          kernel: kernel as NonNullable<SessionMessage['acceptedInputs']>[number]['kernel'], acceptedAt,
        },
      }),
    });
  }

  // ---- disposeArchiveWait (S1-MSG-01/02) ----------------------------------

  type DurableArchiveRequestRead =
    | { ok: true; session: SessionRecord; request: SessionArchiveRequestV1; revision: number }
    | { ok: false; rejection: CoreRejection };

  /** §3.4: the durable R is read first, so a replay never needs the current record. */
  async function readDurableArchiveRequest(owned: Owned, step: ArchiveStepRefV1): Promise<DurableArchiveRequestRead> {
    const key = sessionAggregateRefKey(plainSessionRefToAggregate(step.sessionRef));
    const read = await readBatch(records, [key]);
    if (read.status !== 'ready') return { ok: false, rejection: mapBatchFailure(read) };
    const presence = presenceOf(read.batch, key);
    if (presence === 'missing') return { ok: false, rejection: reject('not_found', 'the archive source Session does not exist') };
    if (presence === 'unaccounted') return { ok: false, rejection: reject('unavailable', 'the archive source Session was neither returned nor reported missing') };
    const record = read.batch.present.get(key) as EncodedRecord;
    const decoded = decodeSessionRecord(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: reject('unavailable', `the archive source Session is damaged: ${decoded.reason}`) };
    const session = decoded.value;
    const request = session.archiveRequest ?? null;
    if (request === null || request.requestId !== step.archiveRequestId
      || step.requestReceipt.identityKey !== request.receipt.identityKey
      || step.requestReceipt.fingerprint !== request.receipt.fingerprint) {
      return { ok: false, rejection: reject('invalid', 'archive_disposal_required: the Session has no matching pending archive request') };
    }
    return { ok: true, session, request, revision: record.revision };
  }

  type StoredArchiveRequestRead =
    | { ok: true; request: SessionArchiveRequestV1 }
    | { ok: false; rejection: CoreRejection };

  /**
   * §2.3/D10: recover the immutable ORIGINAL request through the step's stored
   * `requestReceipt` (lookupCommit → eventAt of the SessionArchiveRequested
   * event), exactly as the sessions owner does for SV56. This never depends on
   * the current Session record, so a committed internal `reply_handler` /
   * `wait_cancel` step can still replay after the final archive cleared R.
   */
  async function loadStoredArchiveRequest(owned: Owned, step: ArchiveStepRefV1): Promise<StoredArchiveRequestRead> {
    let found: StoreResult<Receipt>;
    try {
      found = await records.lookupCommit({
        identityKey: step.requestReceipt.identityKey, fingerprint: step.requestReceipt.fingerprint,
      });
    } catch {
      return { ok: false, rejection: reject('unavailable', 'the archive request receipt could not be read') };
    }
    if (found.status !== 'ready') {
      if (found.code === 'not_found') return { ok: false, rejection: reject('not_found', 'the archive request receipt was not found') };
      return { ok: false, rejection: mapStoreFailure(found) };
    }
    let at: StoreResult<{ cursor: CommitCursor; event: EncodedDomainEvent }>;
    try {
      at = await records.eventAt(found.value.cursor);
    } catch {
      return { ok: false, rejection: reject('unavailable', 'the archive request event could not be read') };
    }
    if (at.status !== 'ready') return { ok: false, rejection: mapStoreFailure(at) };
    if (String(at.value.cursor) !== String(found.value.cursor)) {
      return { ok: false, rejection: reject('unavailable', 'the archive request cursor disagrees with its receipt') };
    }
    const decoded = sessionArchiveChangedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') {
      return { ok: false, rejection: reject('unavailable', `the archive request event is not decodable: ${decoded.reason}`) };
    }
    const event: SessionArchiveChangedEventV1 = decoded.value;
    if (event.eventType !== SESSION_ARCHIVE_REQUESTED_EVENT) {
      return { ok: false, rejection: reject('unavailable', 'the recorded archive event is not a request') };
    }
    if (!found.value.eventIds.includes(event.eventId)) {
      return { ok: false, rejection: reject('unavailable', 'the archive request event id disagrees with its receipt') };
    }
    if (event.projectId !== owned.projectId || event.workspaceId !== owned.workspaceId) {
      return { ok: false, rejection: reject('unavailable', 'the archive request event belongs to another scope') };
    }
    if (event.archiveRequestId !== step.archiveRequestId) {
      return { ok: false, rejection: reject('unavailable', 'the archive step names another request') };
    }
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(step.sessionRef));
    if (canonicalOf(event.session.ref) !== sessionKey) {
      return { ok: false, rejection: reject('unavailable', 'the archive request event belongs to another Session') };
    }
    const request = event.session.archiveRequest;
    if (request === null || request === undefined) {
      return { ok: false, rejection: reject('unavailable', 'the archive request event carries no request') };
    }
    if (canonicalOf(request.receipt) !== canonicalOf(step.requestReceipt)) {
      return { ok: false, rejection: reject('unavailable', 'the archive step receipt disagrees with the stored request') };
    }
    return { ok: true, request };
  }

  type WaitRunRead =
    | { ok: true; run: RunSnapshot; revision: number; refKey: string }
    | { ok: false; rejection: CoreRejection };

  /** The exact original wait Run and its CAS revision from one read window. */
  async function readWaitRun(owned: Owned, runRef: RunRef): Promise<WaitRunRead> {
    const refKey = canonicalOf(runRef);
    if (refKey === null) return { ok: false, rejection: reject('invalid', 'archive_input_invalid: the wait RunRef is not canonicalizable JSON') };
    const read = await readBatch(records, [refKey]);
    if (read.status !== 'ready') return { ok: false, rejection: mapBatchFailure(read) };
    const presence = presenceOf(read.batch, refKey);
    if (presence === 'missing') return { ok: false, rejection: reject('not_found', 'the original wait Run does not exist') };
    if (presence === 'unaccounted') return { ok: false, rejection: reject('unavailable', 'the original wait Run was neither returned nor reported missing') };
    const record = read.batch.present.get(refKey) as EncodedRecord;
    const decoded = decodeRun(record);
    if (!decoded.ok) return { ok: false, rejection: reject('unavailable', `the original wait Run is damaged: ${decoded.reason}`) };
    return { ok: true, run: decoded.value, revision: record.revision, refKey };
  }

  /**
   * S1-MSG-01/02: write the changed message and the bumped source Session in ONE
   * commit with the message, Run and both Session CAS guards. The event is the
   * codec-owned `ArchiveWaitDisposed` replay carrier.
   */
  async function writeArchiveWaitDisposal(args: {
    owned: Owned; identityKey: string; fingerprint: string; eventId: string; now: string;
    message: SessionMessage; accepted: Accepted; source: SessionRecord;
    archiveStep: ArchiveStepRefV1; choice: ArchiveWaitChoiceV1; guards: readonly RecordGuard[];
  }): Promise<WriteResult<SessionMessage>> {
    const plan = messageCommitPlan(args.accepted.effects);
    if (plan.eventType !== 'ArchiveWaitDisposed') throw new Error('the wait-disposal machine did not name its event');
    if (!nonEmpty(args.now)) return reject('invalid', 'the injected clock is not a legal instant');
    const message = nextSessionMessageRecord(args.message, {
      kind: 'archive_wait_disposed', choice: args.choice, archiveSessionRef: args.archiveStep.sessionRef,
      archiveRequestId: args.archiveStep.archiveRequestId, now: args.now,
    });
    if (canonicalOf(messageMachineStateOf(message)) !== canonicalOf(args.accepted.next)) {
      throw new Error('the written SessionMessage is not the state the message machine accepted');
    }
    const source: SessionRecord = { ...args.source, revision: args.source.revision + 1 };
    // Slice 2A L5: the disposal rewrites the message, so it copies the stored
    // creation origin (`since`) exactly like every other update. Re-encoding
    // without it silently re-sorted the message as a legacy notice.
    const preserved = await preservedNoticeOrigin(records, sessionMessageRefKey(message.ref));
    if (!preserved.ok) return preserved.rejection;
    const event = encodeArchiveWaitDisposalEvent(args.eventId, {
      schemaVersion: 1, occurredAt: args.now, projectId: args.owned.projectId,
      workspaceId: args.owned.workspaceId, requestId: '',
    }, message, { source, archiveStep: args.archiveStep });
    if (args.owned.signal.aborted) return reject('cancelled', 'the wait disposal was cancelled before commit');
    const guards: RecordGuard[] = [
      { refKey: sessionMessageRefKey(message.ref), expectedRevision: plan.messageRevision as number },
      { refKey: sessionAggregateRefKey(source.ref), expectedRevision: args.source.revision },
      ...args.guards,
    ];
    const merged = mergeGuards(guards);
    if (!merged.ok) return merged.rejection;
    const prepared: PreparedCommit = {
      identityKey: args.identityKey, fingerprint: args.fingerprint, guards: merged.guards,
      records: [encodeSessionMessageRecord(message, preserved.value), encodeSessionRecord(source)],
      claims: [], indexGuards: [], indexChanges: [], events: [event],
    };
    let receipt: Awaited<ReturnType<SessionMailboxDependencies['records']['commit']>>;
    try {
      receipt = await records.commit(prepared);
    } catch {
      const restored = await recheckAfterMiss(args.identityKey, args.fingerprint);
      return restored ?? reject('unavailable', 'the wait disposal commit failed before completing');
    }
    if (receipt.status !== 'committed') {
      const restored = await recheckAfterMiss(args.identityKey, args.fingerprint);
      return restored ?? mapStoreFailure(receipt);
    }
    if (receipt.replayed) return replayMessage(receipt);
    return { status: 'committed', value: message, replayed: false, cursor: receipt.cursor };
  }

  async function disposeArchiveWait(ctx: CoreCallContext, step: ArchiveStepRefV1): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    // §3.4/S1-MSG-01: only the trusted Host/Workflow may dispose an archive wait.
    if (owned.principal.kind !== 'host') {
      return reject('forbidden', 'archive_host_only: only the trusted Host may dispose an archive wait');
    }
    if (owned.signal.aborted) return reject('cancelled', 'the wait disposal was cancelled before validation');
    const normalized = normalizeArchiveStep(step as unknown);
    if (!normalized.ok) return normalized.rejection;
    const ownedStep = normalized.step;
    if (ownedStep.sessionRef.projectId !== owned.projectId) {
      return reject('forbidden', 'archive_scope: the archive step names a Session outside the bound project');
    }
    const stored = await loadStoredArchiveRequest(owned, ownedStep);
    if (!stored.ok) return stored.rejection;
    const request = stored.request;
    let identity: { identityKey: string; fingerprint: string; eventId: string };
    try {
      identity = deriveArchiveStepCommitIdentityV1(
        { projectId: owned.projectId, workspaceId: owned.workspaceId }, request, ownedStep);
    } catch {
      return reject('invalid', 'archive_input_invalid: the archive step does not belong to the stored archive request');
    }
    const existing = await records.lookupCommit({ identityKey: identity.identityKey, fingerprint: identity.fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    // A NEW commit still needs the matching CURRENT request on the Session.
    const durable = await readDurableArchiveRequest(owned, ownedStep);
    if (!durable.ok) return durable.rejection;
    const source = durable.session;
    if (source.ref.projectId !== owned.projectId || source.workspaceId !== owned.workspaceId) {
      return reject('forbidden', 'archive_scope: the archive source Session is outside the bound scope');
    }

    const choice = waitChoiceForStep(request.wait ?? null, ownedStep);
    if (choice === null) {
      return reject('invalid', 'archive_input_invalid: the archive request has no wait choice for this step');
    }
    // §2.3 fixed subjectKey: transfer names the message, cancel names the Run.
    const subject = ownedStep.step === 'reply_handler' ? canonicalOf(choice.messageRef) : canonicalOf(choice.runRef);
    if (subject === null || ownedStep.subjectKey !== subject) {
      return reject('invalid', 'archive_input_invalid: the archive step subjectKey does not match the original wait');
    }
    const messageRead = await loadMessageForWrite(owned, choice.messageRef);
    if (!messageRead.ok) return messageRead.rejection;
    const message = messageRead.message;
    const runRead = await readWaitRun(owned, choice.runRef);
    if (!runRead.ok) return runRead.rejection;
    const run = runRead.run;

    let target: SessionRecord | null = null;
    if (ownedStep.step === 'reply_handler') {
      if (choice.kind !== 'transfer') {
        return reject('invalid', 'archive_input_invalid: the reply-handler step needs a transfer choice');
      }
      const targetKey = sessionAggregateRefKey(plainSessionRefToAggregate(choice.to));
      const targetRead = await readBatch(records, [targetKey]);
      if (targetRead.status !== 'ready') return mapBatchFailure(targetRead);
      const presence = presenceOf(targetRead.batch, targetKey);
      if (presence === 'missing') return reject('unavailable', 'the reply-handler target Session does not exist');
      if (presence === 'unaccounted') return reject('unavailable', 'the reply-handler target Session was neither returned nor reported missing');
      const decoded = decodeSessionRecord(targetRead.batch.present.get(targetKey) as EncodedRecord);
      if (decoded.status !== 'decoded') return reject('unavailable', `the reply-handler target Session is damaged: ${decoded.reason}`);
      target = decoded.value;
      if (target.ref.projectId !== owned.projectId) {
        return reject('forbidden', 'archive_scope: the reply-handler target is outside the bound project');
      }
    }

    const waitMatches = message !== null
      && message.ref.projectId === owned.projectId && message.ref.workspaceId === owned.workspaceId
      && canonicalOf(message.ref) === canonicalOf(choice.messageRef)
      && message.sender.kind === 'work_run'
      && canonicalOf(message.sender.runRef) === canonicalOf(choice.runRef)
      && canonicalOf(message.sender.sessionRef) === canonicalOf(ownedStep.sessionRef)
      && run.outcome === 'yielded'
      && run.continuation !== undefined
      && canonicalOf(run.continuation.messageRef) === canonicalOf(choice.messageRef);
    const responseAccepted = message !== null && (message.acceptedInputs ?? []).some((entry) => entry.part === 'response');
    const targetEligible = ownedStep.step === 'reply_handler'
      ? target !== null && replyTargetEligible(owned, target)
      : true;
    const now = deps.now();
    if (!nonEmpty(now)) return reject('invalid', 'the injected clock is not a legal instant');
    const archiveWaitFacts: NonNullable<MessageGuardContext['archiveWait']> = {
      choice, archiveSessionRef: ownedStep.sessionRef, archiveRequestId: request.requestId, now,
      requestMatches: true, waitMatches, targetEligible, responseAccepted,
    };
    const { decided, ctx: messageCtx } = judge(owned.principal, message, { type: 'archive_wait_disposed' }, { archiveWait: archiveWaitFacts });
    if (!decided.ok) return refuse(decided, messageCtx, identity.identityKey, identity.fingerprint);
    const current = acceptedMessage(message);
    const guards: RecordGuard[] = [{ refKey: runRead.refKey, expectedRevision: runRead.revision }];
    if (target !== null) {
      guards.push({ refKey: sessionAggregateRefKey(target.ref), expectedRevision: target.revision });
    }
    return writeArchiveWaitDisposal({
      owned, identityKey: identity.identityKey, fingerprint: identity.fingerprint, eventId: identity.eventId,
      now, message: current, accepted: decided, source, archiveStep: ownedStep, choice, guards,
    });
  }

  // ---- readRoutedReplies / readUndeliveredReplies (slice 1 §2.5) ----------

  /** A work_run reads only its own Session; a Host reads within its workspace. */
  async function replyCallerKey(owned: Owned, session: SessionRef, what: string):
  Promise<{ ok: true; key: string } | { ok: false; rejection: CoreRejection }> {
    if (owned.principal.kind === 'host') {
      return { ok: true, key: canonicalOf({ kind: 'host', actor: { ...owned.principal.actor } }) ?? '' };
    }
    if (owned.principal.kind === 'work_run') {
      const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
      if (!identity.ok) return { ok: false, rejection: identity.rejection };
      if (canonicalOf(identity.claim.sessionRef) !== canonicalOf(session)) {
        return { ok: false, rejection: reject('forbidden', `a work_run ${what} read is limited to its own Session`) };
      }
      return { ok: true, key: canonicalOf({ kind: 'work_run', sessionRef: identity.claim.sessionRef, runRef: identity.run.ref }) ?? '' };
    }
    return { ok: false, rejection: reject('forbidden', 'the mailbox reader principal is not supported') };
  }

  async function readRoutedReplies(
    ctx: CoreCallContext, input: { handler: SessionRef; page: SessionPageRequest },
  ): Promise<ReadResult<SessionPage<SessionMessage>>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const raw = input as unknown as Unknown;
    if (!isObject(raw)) return reject('invalid', 'readRoutedReplies requires an input object');
    if (Object.keys(raw).some((key) => key !== 'handler' && key !== 'page')) {
      return reject('invalid', 'readRoutedReplies does not accept extra fields');
    }
    const handlerProblem = checkPlainSessionRef(raw['handler']);
    if (handlerProblem !== null) return reject('invalid', `readRoutedReplies handler: ${handlerProblem}`);
    const handler = structuredClone(raw['handler']) as SessionRef;
    if (handler.projectId !== owned.projectId) return reject('forbidden', 'the reply handler belongs to another project');
    const page = pageProblem(raw['page'], {
      requiresObject: 'the reply page must be an object',
      extraFields: 'the reply page does not accept extra fields',
      limit: 'the reply limit must be an integer between 1 and 100',
    });
    if (!page.ok) return page.rejection;
    const caller = await replyCallerKey(owned, handler, 'routed-replies');
    if (!caller.ok) return caller.rejection;
    if (page.rawCursor !== undefined && !nonEmpty(page.rawCursor)) {
      return reject('invalid', 'the reply cursor must be a non-empty string');
    }
    let decodedCursor: ReplyCursorV1 | null = null;
    if (page.rawCursor !== undefined) {
      decodedCursor = decodeReplyCursor(page.rawCursor);
      if (decodedCursor === null) return reject('invalid', 'the reply cursor is not a valid continuation token');
      if (decodedCursor.kind !== 'routed' || decodedCursor.projectId !== owned.projectId
        || decodedCursor.workspaceId !== owned.workspaceId || decodedCursor.sessionId !== handler.sessionId) {
        return reject('invalid', 'the reply cursor belongs to another scope or handler');
      }
    }
    const atLeast = atLeastCursorOf(page.rawAtLeast);
    if (!atLeast.ok) return atLeast.rejection;
    if (decodedCursor !== null && decodedCursor.callerKey !== caller.key) {
      return reject('invalid', 'the reply cursor does not belong to the current caller');
    }
    const after = decodedCursor?.after;
    const request: RecordLookupRequest = {
      index: SESSION_REPLY_BY_HANDLER_LOOKUP,
      values: [owned.projectId, owned.workspaceId, handler.sessionId],
      limit: page.limit,
      ...(after === undefined ? {} : { after }),
    };
    let pageResult: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
    try {
      pageResult = await records.lookup(request);
    } catch {
      return reject('unavailable', 'the routed-reply lookup failed');
    }
    if (pageResult.status !== 'ready') return mapStoreFailure(pageResult);
    const progress = readProgress(pageResult.value.readThrough, atLeast.atLeast);
    if (!progress.ok) return progress.result;
    const readThrough = progress.readThrough;
    const items: SessionMessage[] = [];
    for (const record of pageResult.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return reject('unavailable', `a routed-reply candidate is damaged: ${decoded.reason}`);
      const message = decoded.value;
      const handlerRef = message.replyHandler ?? null;
      if (sessionMessageRefKey(message.ref) !== record.refKey
        || message.ref.projectId !== owned.projectId || message.ref.workspaceId !== owned.workspaceId
        || handlerRef === null || canonicalOf(handlerRef.sessionRef) !== canonicalOf(handler)) {
        return reject('unavailable', 'a routed-reply candidate disagrees with the requested handler');
      }
      items.push(message);
    }
    const nextCursor = pageResult.value.next === null ? null : encodeReplyCursor({
      v: 1, kind: 'routed', projectId: owned.projectId, workspaceId: owned.workspaceId,
      sessionId: handler.sessionId, callerKey: caller.key, after: pageResult.value.next,
    });
    return { status: 'ready', value: { items, nextCursor, sourceCursor: readThrough } };
  }

  async function readUndeliveredReplies(
    ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest },
  ): Promise<ReadResult<SessionPage<UndeliveredReplyV1>>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const raw = input as unknown as Unknown;
    if (!isObject(raw)) return reject('invalid', 'readUndeliveredReplies requires an input object');
    if (Object.keys(raw).some((key) => key !== 'sessionRef' && key !== 'page')) {
      return reject('invalid', 'readUndeliveredReplies does not accept extra fields');
    }
    const sessionProblem = checkPlainSessionRef(raw['sessionRef']);
    if (sessionProblem !== null) return reject('invalid', `readUndeliveredReplies sessionRef: ${sessionProblem}`);
    const sessionRef = structuredClone(raw['sessionRef']) as SessionRef;
    if (sessionRef.projectId !== owned.projectId) return reject('forbidden', 'the reply source belongs to another project');
    const page = pageProblem(raw['page'], {
      requiresObject: 'the reply page must be an object',
      extraFields: 'the reply page does not accept extra fields',
      limit: 'the reply limit must be an integer between 1 and 100',
    });
    if (!page.ok) return page.rejection;
    const caller = await replyCallerKey(owned, sessionRef, 'undelivered-replies');
    if (!caller.ok) return caller.rejection;
    if (page.rawCursor !== undefined && !nonEmpty(page.rawCursor)) {
      return reject('invalid', 'the reply cursor must be a non-empty string');
    }
    let decodedCursor: ReplyCursorV1 | null = null;
    if (page.rawCursor !== undefined) {
      decodedCursor = decodeReplyCursor(page.rawCursor);
      if (decodedCursor === null) return reject('invalid', 'the reply cursor is not a valid continuation token');
      if (decodedCursor.kind !== 'undelivered' || decodedCursor.projectId !== owned.projectId
        || decodedCursor.workspaceId !== owned.workspaceId || decodedCursor.sessionId !== sessionRef.sessionId) {
        return reject('invalid', 'the reply cursor belongs to another scope or source Session');
      }
    }
    const atLeast = atLeastCursorOf(page.rawAtLeast);
    if (!atLeast.ok) return atLeast.rejection;
    if (decodedCursor !== null && decodedCursor.callerKey !== caller.key) {
      return reject('invalid', 'the reply cursor does not belong to the current caller');
    }
    const after = decodedCursor?.after;
    // The source Session's retirement is the durable fact; without it nothing is
    // an undelivered reply. The read is otherwise pure and never acks.
    const sourceKey = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
    const sourceRead = await readBatch(records, [sourceKey]);
    if (sourceRead.status !== 'ready') return mapBatchFailure(sourceRead);
    const sourcePresence = presenceOf(sourceRead.batch, sourceKey);
    if (sourcePresence === 'missing') return reject('not_found', 'the undelivered-reply source Session does not exist');
    if (sourcePresence === 'unaccounted') return reject('unavailable', 'the source Session was neither returned nor reported missing');
    const sourceDecoded = decodeSessionRecord(sourceRead.batch.present.get(sourceKey) as EncodedRecord);
    if (sourceDecoded.status !== 'decoded') return reject('unavailable', `the source Session is damaged: ${sourceDecoded.reason}`);
    const retired = sourceDecoded.value.health === 'unavailable';
    let hasContinuation = false;
    if (retired) {
      let continuationRead: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
      try {
        continuationRead = await records.lookup({
          index: SESSION_BY_PROVENANCE_LOOKUP,
          values: [owned.projectId, owned.workspaceId, sessionRef.sessionId],
          limit: 1,
        });
      } catch {
        return reject('unavailable', 'the Session continuation lookup failed');
      }
      if (continuationRead.status !== 'ready') return mapStoreFailure(continuationRead);
      hasContinuation = continuationRead.value.records.length > 0;
    }
    const request: RecordLookupRequest = {
      index: SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP,
      values: [owned.projectId, owned.workspaceId, sessionRef.sessionId],
      limit: page.limit,
      ...(after === undefined ? {} : { after }),
    };
    let pageResult: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
    try {
      pageResult = await records.lookup(request);
    } catch {
      return reject('unavailable', 'the undelivered-reply lookup failed');
    }
    if (pageResult.status !== 'ready') return mapStoreFailure(pageResult);
    const progress = readProgress(pageResult.value.readThrough, atLeast.atLeast);
    if (!progress.ok) return progress.result;
    const readThrough = progress.readThrough;
    const items: UndeliveredReplyV1[] = [];
    for (const record of pageResult.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return reject('unavailable', `an undelivered-reply candidate is damaged: ${decoded.reason}`);
      const message = decoded.value;
      if (sessionMessageRefKey(message.ref) !== record.refKey || message.ref.projectId !== owned.projectId
        || message.ref.workspaceId !== owned.workspaceId || message.sender.kind !== 'work_run'
        || canonicalOf(message.sender.sessionRef) !== canonicalOf(sessionRef)) {
        return reject('unavailable', 'an undelivered-reply candidate disagrees with the requested source Session');
      }
      if (!retired || message.response === null) continue;
      const response = message.response;
      // A reply already used by an execution is delivered, never undelivered.
      if ((message.acceptedInputs ?? []).some((entry) => entry.part === 'response')) continue;
      const unavailableSince = sourceDecoded.value.unavailableSince;
      const responseSince = message.responseSince;
      // Spec §2.3/L7: a retired source and a replied work_run message always
      // carry their bound positions; a missing one is damaged, never a DTO
      // without the field.
      if (unavailableSince === undefined || unavailableSince === null) {
        return reject('unavailable', 'an undelivered-reply source Session has no entry position');
      }
      if (responseSince === undefined || responseSince === null) {
        return reject('unavailable', 'an undelivered-reply message has no reply position');
      }
      items.push({
        kind: 'retired_reply', messageRef: message.ref, sourceSessionRef: sessionRef,
        responseRef: response.bodyRef, respondedAt: response.respondedAt,
        hasContinuation, requiresUserRecipient: !hasContinuation,
        unavailableSince, responseSince,
      });
    }
    const nextCursor = pageResult.value.next === null ? null : encodeReplyCursor({
      v: 1, kind: 'undelivered', projectId: owned.projectId, workspaceId: owned.workspaceId,
      sessionId: sessionRef.sessionId, callerKey: caller.key, after: pageResult.value.next,
    });
    return { status: 'ready', value: { items, nextCursor, sourceCursor: readThrough } };
  }

  // ---- sendUserMessage (slice 5 user-send owner) --------------------------

  /**
   * The slice-5 user-message owner (SPEC §3.3 table line 614, row S5-MSG-01).
   * The user is not a Session: the recipient is the bound workspace's user
   * address and this method never enters the legacy `sendMessage` admission.
   * The sender identity/duties always come from the trusted context and the
   * configured duties adapter, never from the input.
   */
  async function sendUserMessage(ctx: CoreCallContext, request: GraphWrite<{
    goalRef: GoalRef; intent: 'notify' | 'decision_request'; text: string;
    needsReply: boolean; waitAfterSend: boolean;
    options: DecisionOptionV1[]; objects: DecisionObjectV1[];
    forwardedFrom?: SessionMessageRef;
  }>): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.signal.aborted) return reject('cancelled', 'the user send was cancelled before validation');
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    const raw = write.input as unknown as Unknown | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'sendUserMessage requires an input object');

    const rawGoal = raw['goalRef'];
    if (!isGoalRef(rawGoal)) return reject('invalid', 'sendUserMessage requires a complete GoalRef');
    const goalRef = structuredClone(rawGoal) as unknown as GoalRef;
    if (goalRef.projectId !== owned.projectId) return reject('forbidden', 'the user message Goal is outside the bound project');

    const intent = raw['intent'];
    if (intent !== 'notify' && intent !== 'decision_request') {
      return reject('invalid', 'the user message intent must be notify or decision_request');
    }
    const text = normalizeText(raw['text']);
    if (!text.ok) return text.rejection;
    const needsReply = raw['needsReply'];
    const waitAfterSend = raw['waitAfterSend'];
    if (typeof needsReply !== 'boolean' || typeof waitAfterSend !== 'boolean') {
      return reject('invalid', 'sendUserMessage requires boolean needsReply and waitAfterSend');
    }
    if (waitAfterSend && !needsReply) return reject('invalid', 'waitAfterSend requires needsReply');
    if (intent === 'decision_request' && !needsReply) {
      return reject('invalid', 'a decision_request must expect a reply');
    }
    const rawOptions = raw['options'];
    const rawObjects = raw['objects'];
    if (!Array.isArray(rawOptions) || !Array.isArray(rawObjects)) {
      return reject('invalid', 'sendUserMessage requires option and object arrays');
    }
    let options: DecisionOptionV1[];
    let objects: DecisionObjectV1[];
    const forwardedFrom = raw['forwardedFrom'];
    try {
      options = structuredClone(rawOptions) as DecisionOptionV1[];
      objects = structuredClone(rawObjects) as DecisionObjectV1[];
      if (forwardedFrom !== undefined) structuredClone(forwardedFrom);
    } catch {
      return reject('invalid', 'the user message decision inputs cannot be isolated from the caller');
    }
    if (forwardedFrom !== undefined && checkSessionMessageRef(forwardedFrom) !== null) {
      return reject('invalid', 'the forwardedFrom ref must be a complete SessionMessageRef');
    }

    let sender: MessageSender;
    let workRunPrincipal: WorkRunPrincipal | null = null;
    if (owned.principal.kind === 'host') {
      sender = { kind: 'host', actor: { ...owned.principal.actor } };
    } else if (owned.principal.kind === 'work_run') {
      const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
      if (!identity.ok) return identity.rejection;
      const derived = deriveWorkRunSender(identity);
      if (!derived.ok) return derived.rejection;
      sender = derived.sender;
      workRunPrincipal = owned.principal;
    } else {
      return reject('unsupported', 'the user-message sender principal is not supported');
    }
    if (sender.kind === 'work_run'
      && (sender.runRef.projectId !== goalRef.projectId || sender.runRef.goalId !== goalRef.goalId)) {
      return reject('forbidden', 'the user message Goal is not the sender Run Goal');
    }

    const senderIdentity = senderIdentityOf(sender);
    const messageRef: SessionMessageRef = {
      aggregateType: 'SessionMessage', projectId: owned.projectId, workspaceId: owned.workspaceId,
      messageId: messageIdOf(owned, senderIdentity, write.requestId),
    };
    const identityKey = identityKeyOf('user-send', owned, senderIdentity, write.requestId);
    const fingerprint = fingerprintOf('user-send', owned, senderIdentity, {
      goalRef, intent, text: text.text, needsReply, waitAfterSend, options, objects,
      ...(forwardedFrom === undefined ? {} : { forwardedFrom }),
    }, write.expected);
    if (owned.signal.aborted) return reject('cancelled', 'the user send was cancelled before the idempotency lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    // S5-MSG-01: the legacy work_run admission still runs; a refused admission
    // never reads the Goal or the duties facts.
    let authorized: AuthOutcome | null = null;
    if (workRunPrincipal !== null) {
      authorized = await authorizeNewWorkRunAction({ owned, principal: workRunPrincipal, operationToolName: 'send_user_message' });
    }
    // D3: the trusted duties seam is the ONLY duties source. Absent => unsupported.
    if (sender.kind !== 'work_run') {
      return reject('unsupported', 'a user message must be sent by a trusted Session');
    }
    if (deps.duties === undefined) {
      return reject('unsupported', 'the trusted duties adapter is not configured for a new user message');
    }
    if (owned.signal.aborted) return reject('cancelled', 'the user send was cancelled before the duties read');
    const facts = await deps.duties.readMessageDutiesFacts(internalHostContext(owned), {
      sessionRef: sender.sessionRef, roleBinding: sender.roleBinding,
    });
    if (facts.status !== 'ready') {
      if (facts.status === 'rejected') return facts;
      return mapReadResult(facts) as CoreRejection;
    }
    const duties = facts.value;
    const dutiesAllowSend = canSendUserMessage({
      duties: duties.duties, readOnlyCopy: duties.readOnlyCopy, independentReview: duties.independentReview, intent,
    });

    // S5-MSG-01: the real owning Goal of the recipient user workspace.
    if (owned.signal.aborted) return reject('cancelled', 'the user send was cancelled before the Goal read');
    const goalRead = await loadGoal(owned, goalRef);
    if (goalRead.status !== 'ready') return mapReadResult(goalRead) as CoreRejection;
    const goal = goalRead.value;
    if (goal.workspaceRef.projectId !== owned.projectId || goal.workspaceRef.workspaceId !== owned.workspaceId) {
      return reject('forbidden', 'the user message Goal is outside the bound workspace');
    }
    for (const pin of write.expected) {
      if (canonicalOf(pin.ref) === canonicalOf(goal.ref) && pin.revision !== goal.revision) {
        return reject('revision_conflict', 'the Goal revision changed since it was read', [pin]);
      }
    }

    // S5-MSG-01 decision parameters; only a decision_request carries metadata.
    let decisionMetadata: DecisionMessageMetadataV1 | null = null;
    let decisionObjectPins: VersionPin[] = [];
    if (intent === 'decision_request') {
      if (!validOptionObjects(options, objects)) {
        return reject('invalid', 'the decision request options or objects are invalid');
      }
      // §3.3 line 614: establish every object kind's owning Workspace first.
      const objectWorkspaceProblem = verifyDecisionObjectWorkspaces(owned, objects);
      if (objectWorkspaceProblem !== null) return objectWorkspaceProblem;
      // §3.3 line 614: read every real source object before state and guard it.
      decisionObjectPins = aggregateObjectPins(objects);
      const objectProblem = await verifyDecisionObjectPins(owned, decisionObjectPins);
      if (objectProblem !== null) return objectProblem;
      const sourcePins = dedupePins([{ ref: structuredClone(goal.ref), revision: goal.revision }, ...decisionObjectPins])
        .filter((pin) => canonicalOf(pin.ref) !== canonicalOf(messageRef));
      const source = {
        kind: 'message' as const,
        key: decisionSourceKey({ kind: 'message', messageRef }),
        subject: { kind: 'goal' as const, goalRef: structuredClone(goalRef) },
        pins: sourcePins,
        goalBases: [goalBasis(goal)],
      };
      const metadata: DecisionMessageMetadataV1 = {
        schemaVersion: 1, source, objects, options, syntheticAnswer: false,
        forwardedFrom: forwardedFrom === undefined ? null : structuredClone(forwardedFrom) as SessionMessageRef,
      };
      if (Buffer.byteLength(source.key, 'utf8') > 8192
        || Buffer.byteLength(canonicalJson(metadata as never), 'utf8') > 64 * 1024) {
        return reject('capacity', 'the decision message metadata exceeds its bound');
      }
      decisionMetadata = metadata;
    } else if (options.length > 0 || objects.length > 0) {
      return reject('invalid', 'a notify user message carries no options or objects');
    }

    const userRecipient: MessageRecipient = { kind: 'user', projectId: owned.projectId, workspaceId: owned.workspaceId };
    const { decided, ctx: messageCtx } = judge(owned.principal, null, { type: 'message_sent' }, {
      recipientScope: 'same_workspace',
      sendFlags: { needsReply, waitAfterSend, pinCount: 0 },
      userSend: { goalScopeMatches: true, dutiesAllowSend, decisionParamsValid: true },
      workRunAuthorization: authorized === null ? null : authorized.ok ? 'ok' : authorized.rejection,
      // A person's send keeps no release (§3.3), the same fact its record carries.
      sendRelease: { release: null, pins: null },
    });
    if (!decided.ok) return refuse(decided, messageCtx, identityKey, fingerprint);

    const extraGuards: RecordGuard[] = [...duties.guards,
      { refKey: canonicalRefKey(goal.ref), expectedRevision: goal.revision }];
    for (const pin of decisionObjectPins) {
      const refKey = canonicalOf(pin.ref);
      if (refKey !== null) extraGuards.push({ refKey, expectedRevision: pin.revision });
    }
    for (const pin of write.expected) {
      const refKey = canonicalOf(pin.ref);
      if (refKey !== null && isPositiveInt(pin.revision)) extraGuards.push({ refKey, expectedRevision: pin.revision });
    }
    return writeMessage(decided, {
      owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: authorized,
      cancelled: 'the user send was cancelled before commit',
      body: { messageRef, text: text.text, answerSource: null },
      extraGuards,
      record: (createdAt, bodyRef) => createSessionMessageRecord({
        ref: messageRef, sender, recipient: userRecipient, bodyRef, sourceRef: bodyRef.source, createdAt,
        intent, needsReply, waitAfterSend,
        goalRef: structuredClone(goalRef),
        ...(decisionMetadata === null ? {} : { decision: decisionMetadata }),
      }),
    });
  }

  // ---- L4 lookupToolCommit -------------------------------------------------

  /**
   * K3 L4: the sender identity the original Run recorded, rebuilt from the
   * trusted `origin` (the Run record's provenance) rather than from the ctx of
   * the reconcile caller. `senderIdentityOf` ignores the Role binding, so the
   * four `origin` fields reproduce exactly what `sendMessage` committed.
   */
  function workRunSenderIdentityOf(origin: ToolCommitLookupInput['origin']): Unknown {
    return {
      kind: 'work_run',
      sessionRef: { projectId: origin.sessionRef.projectId, sessionId: origin.sessionRef.sessionId },
      runRef: { aggregateType: 'Run', projectId: origin.runRef.projectId, goalId: origin.runRef.goalId, runId: origin.runRef.runId },
      generation: origin.generation,
    };
  }

  /**
   * K3 L4: the read-only committed-receipt lookup for the four row-4 mailbox
   * tools. It reuses the SAME pure "arguments -> owner request" functions and
   * the SAME module-level identity/fingerprint helpers as the real owner
   * methods, then asks `lookupCommit`; it never writes and never opens a body.
   */
  const lookupToolCommit: ToolCommitLookup = async (
    ctx: CoreCallContext, input: ToolCommitLookupInput,
  ): Promise<ToolCommitLookupResult> => {
    const owned = ownContext(ctx);
    if (!owned.ok) return { status: 'undetermined', reason: owned.rejection.reason };
    const args = input.arguments;
    if (!isObject(args)) return { status: 'undetermined', reason: 'invalid_arguments' };
    // K3 L4: rebuild the whole lookup identity from the ORIGINAL Run's
    // provenance, not from the reconcile caller's ctx/principal.
    const origin = normalizedLookupOrigin(input.origin);
    const requestId = toolCommitRequestId({ ...input, origin });
    let operation: string;
    let payload: Unknown;
    let expected: readonly VersionPin[];
    try {
      switch (input.toolName) {
        case 'send_session_message': {
          const request = sendSessionMessageRequest(args as unknown as SessionMessageSendInput, requestId);
          // The one normalized payload is the fingerprint's payload on both the
          // write and this lookup, so the same arguments hash identically.
          const normalized = normalizeSendMessageInput(request.input);
          if (normalized.status !== 'ready') throw new Error('invalid_arguments');
          operation = 'send';
          expected = request.meta.expected;
          payload = normalized.value;
          break;
        }
        case 'ack_session_message': {
          const input2 = args as unknown as { messageRef: SessionMessageRef; expectedRevision: number };
          const request = ackSessionMessageRequest(input2, requestId);
          operation = 'ack';
          expected = request.meta.expected;
          payload = { messageRef: request.input.messageRef };
          break;
        }
        case 'respond_session_message': {
          const normalized = normalizeRespondMessageInput(args);
          if (normalized.status !== 'ready') throw new Error('invalid_arguments');
          const request = respondSessionMessageRequest(normalized.value, requestId);
          operation = 'respond';
          expected = request.meta.expected;
          payload = request.input;
          break;
        }
        case 'send_user_message': {
          const request = sendUserMessageRequest(args as unknown as SendUserMessageInput, requestId);
          operation = 'user-send';
          expected = request.meta.expected;
          const wire = request.input;
          payload = {
            goalRef: wire.goalRef, intent: wire.intent, text: wire.text,
            needsReply: wire.needsReply, waitAfterSend: wire.waitAfterSend,
            options: wire.options, objects: wire.objects,
            ...(wire.forwardedFrom === undefined ? {} : { forwardedFrom: wire.forwardedFrom }),
          };
          break;
        }
        default:
          return toolCommitLookupUnknownTool(input.toolName);
      }
    } catch {
      return { status: 'undetermined', reason: 'invalid_arguments' };
    }
    // K3 L4: the committed row belongs to the ORIGINAL Run, so both the sender
    // identity and the identity/fingerprint scope come from `input.origin` (the
    // Run record's provenance). A Host reconcile ctx must not substitute the
    // Host principal's identity here.
    const senderIdentity = workRunSenderIdentityOf(origin);
    const scope: MailboxScope = { projectId: origin.runRef.projectId, workspaceId: origin.workspaceId };
    const identityKey = identityKeyOf(operation, scope, senderIdentity, requestId);
    const fingerprint = fingerprintOf(operation, scope, senderIdentity, payload, expected);
    let lookup: Awaited<ReturnType<typeof records.lookupCommit>>;
    try {
      lookup = await records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return { status: 'undetermined', reason: 'the mailbox receipt lookup failed' };
    }
    return toolCommitLookupResult(lookup);
  };

  // ---- message.withdraw ---------------------------------------------------

  /**
   * The withdraw's facts: the message, the caller's trusted sender facts (and,
   * for a Work Run, the fresh admission guards), and the recipient line's one
   * consistent open-execution read. The message's own state refusal is the
   * machine's, decided by `decideWithdraw`.
   */
  async function readWithdrawFacts(owned: Owned, ref: SessionMessageRef):
  Promise<{ status: 'ready'; facts: WithdrawFacts } | CoreRejection> {
    const loaded = await loadMessage(owned, ref);
    if (loaded.status === 'not_found') return reject('not_found', 'the message does not exist');
    if (loaded.status !== 'ready') {
      return loaded.status === 'rejected' ? loaded : mapReadResult(loaded) as CoreRejection;
    }
    const message = loaded.value;
    let actor: MessageSender;
    let guards: readonly RecordGuard[] = [];
    if (owned.principal.kind === 'host') {
      actor = { kind: 'host', actor: { ...owned.principal.actor } };
      // A Host system sender may withdraw only a message it sent itself; a
      // person may withdraw any message of this workspace.
      if (owned.principal.actor.kind === 'system'
        && (message.sender.kind !== 'host' || !sameActor(message.sender.actor, owned.principal.actor))) {
        return reject('forbidden', 'a Host system sender may withdraw only its own message');
      }
    } else if (owned.principal.kind === 'query_run') {
      // The secretary withdraws only a message of the same resolved round.
      if (deps.secretaryRounds === undefined) {
        return reject('unsupported', 'the secretary withdraw is not configured');
      }
      const resolved = await resolveSecretaryRound(owned);
      if (!resolved.ok) return resolved.rejection;
      const round = resolved.round;
      if (message.sender.kind !== 'secretary_round'
        || canonicalOf(message.sender.queryRunRef) !== canonicalOf(round.run)
        || !sameSessionRefAs(message.sender.sessionRef, round.session)) {
        return reject('forbidden', 'a secretary may withdraw only a message of its own resolved round');
      }
      actor = message.sender;
    } else {
      const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
      if (!identity.ok) return identity.rejection;
      const derived = deriveWorkRunSender(identity);
      if (!derived.ok) return derived.rejection;
      const authorized = await authorizeNewWorkRunAction({
        owned, principal: owned.principal, operationToolName: 'send_session_message',
      });
      if (!authorized.ok) return authorized.rejection;
      if (message.sender.kind !== 'work_run'
        || !sameSessionRefAs(message.sender.sessionRef, derived.sender.sessionRef)) {
        return reject('forbidden', 'a Work Run may withdraw only a message of its own Session');
      }
      actor = derived.sender;
      guards = authorized.guards;
    }

    const recipientExecutions = deps.recipientExecutions;
    if (recipientExecutions === undefined) {
      return reject('unsupported', 'the recipient execution read is not configured');
    }
    const recipient = message.recipient;
    if (isUserRecipient(recipient)) {
      return reject('invalid', 'a message to the person has no recipient execution line');
    }
    const sessionRef: SessionRef = { projectId: recipient.projectId, sessionId: recipient.sessionId };
    const open = await recipientExecutions.readRecipientOpenExecutions(isolatedContext(owned),
      { sessionRef, messageRef: ref });
    if (open.status !== 'ready') {
      return open.status === 'rejected' ? open : mapReadResult(open) as CoreRejection;
    }
    return { status: 'ready', facts: { message, open: open.value, guards, actor } };
  }

  /** The machine decides every withdrawal refusal; the owner supplies the one clock. */
  function decideWithdraw(owned: Owned, facts: WithdrawFacts):
  { refuse: CoreRejection } | { decision: WithdrawDecision } {
    const { decided, ctx } = judge(owned.principal, facts.message, { type: 'message_withdrawn' }, {});
    if (!decided.ok) return { refuse: refusalOf(decided, ctx) };
    // A live offer is the recipient line's refusal, decided after the state so a
    // delivered message is `invalid`, never masked by the open execution.
    if (facts.open.executions.length > 0) {
      return { refuse: reject('unavailable', 'the recipient has an open execution that could have been offered this message') };
    }
    const at = deps.now();
    if (!nonEmpty(at)) return { refuse: reject('invalid', 'the injected clock is not a legal instant') };
    return {
      decision: {
        before: facts.message,
        change: { kind: 'withdrawn', withdrawnAt: at },
        at,
        actor: facts.actor,
        guards: facts.guards,
        horizon: facts.open.readCursor,
      },
    };
  }

  // ---- message.release -----------------------------------------------------

  /**
   * The approve/deny facts: the message and the person's own actor. Only the
   * Host human actor is a person; the awaiting-only state refusal is the
   * machine's, decided by `decideRelease`.
   */
  async function readReleaseFacts(owned: Owned, ref: SessionMessageRef):
  Promise<{ status: 'ready'; facts: ReleaseFacts } | CoreRejection> {
    const loaded = await loadMessage(owned, ref);
    if (loaded.status === 'not_found') return reject('not_found', 'the message does not exist');
    if (loaded.status !== 'ready') {
      return loaded.status === 'rejected' ? loaded : mapReadResult(loaded) as CoreRejection;
    }
    if (owned.principal.kind !== 'host' || owned.principal.actor.kind !== 'human') {
      return reject('forbidden', 'only the person may approve or deny a release');
    }
    return {
      status: 'ready',
      facts: {
        message: loaded.value,
        actor: { kind: 'host', actor: { ...owned.principal.actor } },
      },
    };
  }

  /** The machine decides the awaiting-only admission; the owner supplies the one clock. */
  function decideRelease(owned: Owned, facts: ReleaseFacts, allow: boolean):
  { refuse: CoreRejection } | { decision: ReleaseDecision } {
    const { decided, ctx } = judge(owned.principal, facts.message,
      { type: 'message_release_decided', allow }, {});
    if (!decided.ok) return { refuse: refusalOf(decided, ctx) };
    const at = deps.now();
    if (!nonEmpty(at)) return { refuse: reject('invalid', 'the injected clock is not a legal instant') };
    return {
      decision: {
        before: facts.message, change: releaseDecidedChange(facts.message, allow, at, null),
        at, actor: facts.actor,
      },
    };
  }

  async function withdrawMessage(ctx: CoreCallContext, request: GraphWrite<{ messageRef: SessionMessageRef }>):
  Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    const rawRef = (write.input as unknown as { messageRef?: unknown } | null | undefined)?.messageRef;
    const normalized = normalizeMessageRef(rawRef);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const ref = normalized.ref;
    const scopeProblem = scopeOfMessageRef(owned, ref);
    if (scopeProblem !== null) return scopeProblem;

    const withdrawCommand: WriteCommand<WithdrawFacts, WithdrawDecision, CoreRejection, SessionMessage, SessionMessage> = {
      operation: 'message.withdraw',
      scope: { projectId: owned.projectId, workspaceId: owned.workspaceId },
      principal: principalIdentity(owned.principal),
      commandId: write.requestId,
      fingerprintInput: { messageRef: ref },
      read: () => readWithdrawFacts(owned, ref),
      decide: (facts) => decideWithdraw(owned, facts),
      build: async (decision, keys) => {
        const command: SessionMessageWriteCommandV1 = {
          operation: 'message.withdraw',
          messageRef: decision.before.ref,
          before: decision.before,
          expectedRevision: decision.before.revision,
          event: {
            eventId: eventIdOf(keys.identityKey, 'SessionMessageWithdrawn'),
            occurredAt: decision.at,
            requestId: write.requestId,
            projectId: owned.projectId,
            workspaceId: owned.workspaceId,
            actor: decision.actor,
          },
          change: decision.change,
        };
        const companions: SessionMessageCommitCompanions = {
          records: [], events: [], guards: decision.guards, claims: [], ledgerHorizon: decision.horizon,
        };
        return prepareSessionMessage(records, owned, command, companions);
      },
      result: withdrawnResult,
    };
    return messageWriteResult(await executeWriteCommand(records, withdrawCommand));
  }
  async function releaseMessage(ctx: CoreCallContext,
    request: GraphWrite<{ messageRef: SessionMessageRef; allow: boolean }>): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    const raw = write.input as unknown as { messageRef?: unknown; allow?: unknown } | null | undefined;
    const normalized = normalizeMessageRef(raw?.messageRef);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const ref = normalized.ref;
    const scopeProblem = scopeOfMessageRef(owned, ref);
    if (scopeProblem !== null) return scopeProblem;
    const allow = raw?.allow;
    if (typeof allow !== 'boolean') return reject('invalid', 'releaseMessage requires allow to be a boolean');

    const releaseCommand: WriteCommand<ReleaseFacts, ReleaseDecision, CoreRejection,
      SessionMessage, SessionMessage> = {
      operation: 'message.release',
      scope: { projectId: owned.projectId, workspaceId: owned.workspaceId },
      principal: principalIdentity(owned.principal),
      commandId: write.requestId,
      fingerprintInput: { messageRef: ref, allow },
      read: () => readReleaseFacts(owned, ref),
      decide: (facts) => decideRelease(owned, facts, allow),
      build: async (decision, keys) => {
        const command: SessionMessageWriteCommandV1 = {
          operation: 'message.release',
          messageRef: decision.before.ref,
          before: decision.before,
          expectedRevision: decision.before.revision,
          event: {
            eventId: eventIdOf(keys.identityKey, 'SessionMessageReleaseDecided'),
            occurredAt: decision.at,
            requestId: write.requestId,
            projectId: owned.projectId,
            workspaceId: owned.workspaceId,
            actor: decision.actor,
          },
          change: decision.change,
        };
        // No version check, no counter: the message CAS, identity and replay are
        // the only guards, and the approval revision is this commit's revision.
        const companions: SessionMessageCommitCompanions = {
          records: [], events: [], guards: [], claims: [],
        };
        return prepareSessionMessage(records, owned, command, companions);
      },
      result: releaseDecidedResult,
    };
    return messageWriteResult(await executeWriteCommand(records, releaseCommand));
  }
  async function readMessageView(ctx: CoreCallContext, ref: SessionMessageRef): Promise<ReadResult<SessionMessageReadV1>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    let secretary: { round: SecretaryQueryRunV1; reader: SessionRef } | null = null;
    if (owned.principal.kind === 'query_run') {
      const reading = await secretaryReader(owned);
      if (!reading.ok) return reading.rejection;
      secretary = reading;
    }
    const normalized = normalizeMessageRef(ref);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
    if (scopeProblem !== null) return scopeProblem;
    const loaded = await loadMessage(owned, normalized.ref);
    if (loaded.status !== 'ready') return loaded;
    const right = await messageReadRight(owned, loaded.value, secretary);
    if (right !== null) return right;
    const line = await recipientLineFacts(owned, loaded.value.recipient);
    if (!line.ok) return line.rejection;
    const block = await releaseBlockOf(owned, loaded.value);
    if (block.status !== 'ready') return block;
    return { status: 'ready', value: { message: loaded.value, ...deriveMessageDelivery(loaded.value, line.value), releaseBlock: block.value } };
  }

  /**
   * §3.8 item 4: the derived block of one message, `null` unless it is an approved, not withdrawn, not released
   * message. Reading derives it and writes nothing (`book :393–:394`).
   */
  async function releaseBlockOf(owned: Owned, message: SessionMessage):
    Promise<ReadResult<MessageReleaseBlockV1 | null>> {
    if (!messageReleaseBlockEligible(message)) return { status: 'ready', value: null };
    if (deps.dispatchBasis === undefined) {
      return reject('unsupported', 'the release block needs the dispatch basis read');
    }
    const basis = await deps.dispatchBasis.readDispatchFacts(internalHostContext(owned),
      { goalRef: message.goalRef! });
    if (basis.status !== 'ready') return mapReadResult(basis) as CoreRejection;
    return { status: 'ready', value: {
      blockedReason: releaseCandidateBlockedReason(message,
        { desiredState: basis.value.goal.desiredState, currentValues: basis.value.values }),
      current: dispatchCurrentOf(basis.value),
    } };
  }

  return { sendMessage, readMessage, readMessageBody, readInbox, readOutbox, ackMessage, respondMessage, respondFromQueryAnswer, recordConsultationDerivation, recordInputAccepted, sendUserMessage,
    disposeArchiveWait, readUndeliveredReplies, readRoutedReplies, lookupToolCommit,
    withdrawMessage, releaseMessage, readMessageView, readInboxView };
}

/**
 * The shared body/persist facade over the mailbox's private helpers
 * (SPEC §3.3 line 684): `storeBody`/`persist` keep the original
 * `storeMessageBody`/`writeMessage`/receipt rules, while the public
 * `SessionMailboxPort` gains no internal method. Both callers
 * (`sendMessage`/`respond*` and `createDecisionMessageService`) share this one
 * instance.
 */
export function createMessageWriteOwner(deps: SessionMailboxDependencies): MessageCommandWritePort {
  const records = deps.records;
  type WriteReceipt = Extract<Awaited<ReturnType<SessionMailboxDependencies['records']['commit']>>, { status: 'committed' }>;

  function encodePersistEvent(event: SessionMessageEventV1): EncodedDomainEvent {
    switch (event.eventType) {
      case 'SessionMessageSent': return encodeSessionMessageSentEvent(event);
      case 'SessionMessageRead': return encodeSessionMessageReadEvent(event);
      case 'SessionMessageResponded': return encodeSessionMessageRespondedEvent(event);
      case 'SessionMessageConsultationDerived': return encodeSessionMessageConsultationDerivedEvent(event);
      case 'SessionMessageInputAccepted': return encodeSessionMessageInputAcceptedEvent(event);
      case 'SessionMessageDecisionAnswered': return encodeSessionMessageDecisionAnsweredEvent(event);
      case 'SessionMessageDecisionApplied': return encodeSessionMessageDecisionAppliedEvent(event);
      case 'SessionMessageWithdrawn': return encodeSessionMessageWithdrawnEvent(event);
      case 'SessionMessageReleaseDecided': return encodeSessionMessageReleaseDecidedEvent(event);
      case 'SessionMessageReleased': return encodeSessionMessageReleasedEvent(event);
      case 'SessionMessageApplied': return encodeSessionMessageAppliedEvent(event);
      default: return unreachable(event, 'message event');
    }
  }

  async function replayReceipt(receipt: WriteReceipt): Promise<WriteResult<SessionMessage>> {
    return replaySessionMessageReceipt(records, receipt);
  }

  return {
    async storeBody(ctx, input): Promise<ReadResult<{ bodyRef: ArtifactRef; sourceRef: ArtifactRef['source'] }>> {
      const owned = ownContext(ctx);
      if (!owned.ok) return owned.rejection;
      const raw = input as unknown as Unknown | null | undefined;
      if (!isObject(raw)) return reject('invalid', 'storeBody requires an input object');
      const normalized = normalizeMessageRef(raw['messageRef']);
      if (!normalized.ok) return reject('invalid', normalized.reason);
      const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
      if (scopeProblem !== null) return scopeProblem;
      const part = raw['part'];
      if (part !== 'message' && part !== 'response') return reject('invalid', 'storeBody part must be message or response');
      const text = raw['text'];
      if (typeof text !== 'string' || text.length === 0) return reject('invalid', 'storeBody text must be a non-empty string');
      if (Buffer.byteLength(text, 'utf8') > SESSION_MESSAGE_MAX_TEXT_BYTES) {
        return reject('capacity', `message text exceeds ${SESSION_MESSAGE_MAX_TEXT_BYTES} UTF-8 bytes`);
      }
      const sender = raw['sender'];
      if (!isObject(sender) || !nonEmpty(sender['kind'])) return reject('invalid', 'storeBody requires a sender');
      const source = await readCurrentWorkspaceSource(records, owned);
      if (!source.ok) return source.rejection;
      return storeScopedMessageBody(deps, {
        owned, sender: sender as unknown as MessageBodySender, part, messageRef: normalized.ref, text,
        sourceRef: source.value,
        // The facade keeps its own original operation identity.
        bodyRequestId: `session-message-body:${sha256Hex(`${normalized.ref.messageId}|${part}`)}`,
      });
    },

    /**
     * The R2 prepared commit's one fragment: the command's message built by the
     * state machine, its one snapshot event, the command's admitted CAS and the
     * companions — companion records and events FIRST, this message last. It never
     * looks up a receipt, never commits and is safe to call again on a retry. A
     * change the machine refuses is `revision_conflict`, never a crash.
     */
    async prepare(ctx, command, companions): Promise<SessionMessageCommitFragment | CoreRejection> {
      const owned = ownContext(ctx);
      if (!owned.ok) return owned.rejection;
      const raw = command as unknown as Unknown | null | undefined;
      if (!isObject(raw)) return reject('invalid', 'prepare requires a command object');
      const before = raw['before'] as SessionMessage | null;
      if (before === null || typeof before !== 'object' || !isObject(before.ref)) {
        return reject('invalid', 'prepare requires the message the command read');
      }
      const expectedRevision = raw['expectedRevision'];
      if (!isPositiveInt(expectedRevision)) return reject('invalid', 'prepare requires the admitted message revision');
      const operation = raw['operation'];
      if (operation !== 'message.withdraw' && operation !== 'message.release'
        && operation !== 'message.releaseApproved' && operation !== 'message.apply') {
        return reject('invalid', 'prepare does not know this message write operation');
      }
      const change = raw['change'];
      if (!isObject(change) || !nonEmpty(change['kind'])) return reject('invalid', 'prepare requires the command\'s change');
      const event = raw['event'];
      if (!isObject(event) || !nonEmpty(event['eventId']) || !nonEmpty(event['occurredAt'])
        || !nonEmpty(event['requestId']) || !isObject(event['actor'])) {
        return reject('invalid', 'prepare requires the command\'s event envelope');
      }
      const contribution = companionContributionOf(companions);
      if (!contribution.ok) return contribution.rejection;
      const contributed = contribution.value
        ?? { records: [], events: [], guards: [], claims: [] };
      return prepareSessionMessage(records, owned,
        raw as unknown as SessionMessageWriteCommandV1, contributed);
    },

    async persist(ctx, request): Promise<WriteResult<SessionMessage>> {
      const owned = ownContext(ctx);
      if (!owned.ok) return owned.rejection;
      const raw = request as unknown as Unknown | null | undefined;
      if (!isObject(raw)) return reject('invalid', 'persist requires a request object');
      const meta = raw['meta'];
      if (!isObject(meta) || !nonEmpty(meta['requestId']) || !Array.isArray(meta['expected'])) {
        return reject('invalid', 'persist requires meta.requestId and meta.expected');
      }
      const input = raw['input'];
      if (!isObject(input)) return reject('invalid', 'persist requires an input object');
      const identityKey = raw['identityKey'];
      const fingerprint = raw['fingerprint'];
      if (!nonEmpty(identityKey) || !nonEmpty(fingerprint)) {
        return reject('invalid', 'persist requires the entry identityKey and fingerprint');
      }
      const existing = await records.lookupCommit({ identityKey, fingerprint });
      if (existing.status === 'ready') return replayReceipt(existing.value);
      if (existing.code !== 'not_found') return mapStoreFailure(existing);

      const next = input['next'] as SessionMessage;
      if (!isObject(next) || !isObject(next.ref)) return reject('invalid', 'persist requires the next SessionMessage');
      const before = (input['before'] ?? null) as SessionMessage | null;
      const event = input['event'] as SessionMessageEventV1;
      if (!isObject(event) || !nonEmpty(event.eventType)) return reject('invalid', 'persist requires the appended event');
      const guards: RecordGuard[] = Array.isArray(input['guards']) ? input['guards'] as RecordGuard[] : [];
      const claims: UniqueClaimChange[] = Array.isArray(input['claims']) ? input['claims'] as UniqueClaimChange[] : [];
      const companions = companionContributionOf(input['companions']);
      if (!companions.ok) return companions.rejection;
      // Persist only concatenates the top-level bindings and the companions';
      // the commit tail dedupes all three sources (these two and the message's
      // own bindings) once, so this layer keeps no second dedupe.
      const bound = [...(Array.isArray(input['commitCursorBindings']) ? input['commitCursorBindings'] : []) as CommitCursorBinding[],
        ...(companions.value?.commitCursorBindings ?? [])];
      const contributed = { ...(companions.value ?? { records: [], events: [], guards: [], claims: [] }),
        ...(bound.length === 0 ? {} : { commitCursorBindings: bound }),
        ...(input['ledgerHorizon'] !== undefined ? { ledgerHorizon: input['ledgerHorizon'] as CommitCursor | null }
          : companions.value?.ledgerHorizon === undefined ? {} : { ledgerHorizon: companions.value.ledgerHorizon }) };

      // §3.3 line 625 / §8.2: the caller's ACCEPTED pins become the commit
      // guards. The message's own pin is the CAS — never a re-read
      // `before.revision`, so a stale accepted pin is a real revision_conflict.
      const expectedRaw = meta['expected'];
      if (!Array.isArray(expectedRaw)) return reject('invalid', 'persist requires an expected pin array');
      const nextRefKey = sessionMessageRefKey(next.ref);
      const acceptedGuards: RecordGuard[] = [];
      const messagePins: VersionPin[] = [];
      for (const pin of expectedRaw as VersionPin[]) {
        // §2.1: a non-stored aggregate's absence pin is revision 0; the message
        // pin itself (the CAS) must still be a real stored revision.
        if (!isObject(pin) || !isObject(pin.ref) || !isNonNegativeInt(pin.revision)) {
          return reject('invalid', 'persist requires complete, non-negative-integer version pins');
        }
        const refKey = canonicalOf(pin.ref);
        if (refKey === null) return reject('invalid', 'a persist version pin ref is not canonicalizable JSON');
        if (refKey === nextRefKey) {
          if (!isPositiveInt(pin.revision)) {
            return reject('invalid', 'the accepted message pin must be a positive integer');
          }
          messagePins.push(pin);
          continue;
        }
        // §2.1: a revision-0 absence pin (virtual Task focus) has no stored
        // record schema and must never become a Store guard.
        if (pin.revision === 0) continue;
        acceptedGuards.push({ refKey, expectedRevision: pin.revision });
      }
      if (messagePins.length > 1) return reject('invalid', 'persist names the message pin more than once');
      const isCreate = before === null || before === undefined;
      if (isCreate) {
        if (messagePins.length > 0) return reject('invalid', 'persist must not pin a message that does not exist yet');
      } else if (messagePins.length !== 1) {
        return reject('invalid', 'persist requires exactly the accepted message pin for an update');
      }
      return commitPreparedSessionMessage(records, {
        owned, identityKey, fingerprint, message: next, event: encodePersistEvent(event),
        messageRevision: isCreate ? null : messagePins[0]!.revision,
        guards: [...guards, ...acceptedGuards], claims,
        companions: contributed,
        cancelledReason: 'the message write was cancelled before commit',
        commitFailureReason: 'the message commit failed before completing',
      });
    },
  };
}
