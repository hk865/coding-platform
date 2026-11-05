import type { ArtifactRecord, ArtifactRef } from '../../../contracts/artifact.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import { canonicalJson, canonicalOf, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import type { MessageQueryAnswerSender, MessageSender, SessionMailboxDependencies, SessionMessage } from '../model/communication-contracts.js';
import { canonicalRefKey, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type { SessionMessageCommitCompanions, SessionMessageCommitFragment, SessionMessageWriteCommandV1 } from '../model/decision-contracts.js';
import type { CommandResult, CommittedReceipt, Keys } from '../persistence/command-executor.js';
import type { RecordBatchRead, EncodedDomainEvent, CommitCursorBinding, PreparedCommit, RecordGuard, StoreResult } from '../../record-store/ports.js';
import {
  SESSION_MESSAGE_CONTENT_TYPE,
  archiveWaitDisposedEventFromEvent,
  encodeSessionMessageRecord,
  sessionMessageFromEvent, sessionMessageRefKey,
  encodeSessionMessageInputAcceptedEvent,
  encodeSessionMessageWithdrawnEvent, encodeSessionMessageReleaseDecidedEvent, encodeSessionMessageReleasedEvent,
  encodeSessionMessageAppliedEvent,
  encodeSessionMessageExpiredEvent,
  type SessionMessageEventV1,
} from '../sessions/message-record-codecs.js';
import type { NoticeOriginWireV1 } from '../persistence/decision-record-codecs.js';
import {
  bindMessageResponseCursor, messageMachineStateOf, nextSessionMessageRecord,
  type MessageEffect, type MessageEvent, type MessageGuardContext, type SessionMessageEventType,
  type MessageReleaseDecidedChangeV1,
} from '../state/message-machine.js';
import { unreachable } from '../state/transition.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { mapReadResult, preservedNoticeOrigin, judge, admissionRefusalOf, refusalOf, eventIdOf, hostWriterContext } from './mailbox-common.js';
import type {
  MailboxContext, Unknown, SessionMessageStore, MessageCommitReceipt, PreparedSessionMessageWrite,
  Owned, Refused, Accepted, MessageCommitPlan, MessageBodySender, BodyOutcome, Receipt, BodyInput, MessageWrite,
} from './mailbox-types.js';

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

/** §3.3 line 627: the original event's value and cursor, restored before any new business read. */
export async function replaySessionMessageReceipt(
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
  if (located.status !== 'ready') return sessionStoreFailureToRejection(located);
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
  if (again.code !== 'not_found') return sessionStoreFailureToRejection(again);
  return null;
}

/** A companion contribution's own validation; absent normalizes to no contribution. */
export function companionContributionOf(raw: unknown):
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
    case 'message.recordExpiry': return encodeSessionMessageExpiredEvent({ ...base, eventType: 'SessionMessageExpired' });
    case 'message.inputAccepted':
      return encodeSessionMessageInputAcceptedEvent({ ...base, eventType: 'SessionMessageInputAccepted' });
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
    case 'message.recordExpiry': return { type: 'message_expired' };
    case 'message.inputAccepted':
      return { type: 'input_accepted', part: command.change.input.part, inputId: command.change.input.inputId };
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
export async function prepareSessionMessage(
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
  const facts = command.operation === 'message.inputAccepted'
    ? { inputAccepted: command.inputAccepted } : {};
  const { decided } = judge(owned.principal, command.before, lifecycleMachineEventOf(command), facts);
  if (!decided.ok) return reject('revision_conflict', 'the message state no longer accepts this command');
  let accepted = decided.next as Record<string, unknown>;
  if (command.operation === 'message.withdraw') {
    accepted = { ...accepted, withdrawnAt: command.change.withdrawnAt };
  } else if (command.operation === 'message.apply') {
    accepted = { ...accepted, appliedAt: command.change.appliedAt };
  } else if (command.operation === 'message.recordExpiry') {
    accepted = { ...accepted, expiredAt: command.change.expiredAt };
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

export const withdrawnResult = {
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

/** The one commit tail both writer paths use. */
export async function commitPreparedSessionMessage(
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
    return restored ?? sessionStoreFailureToRejection(receipt);
  }
  if (receipt.replayed) return replaySessionMessageReceipt(records, receipt);
  return { status: 'committed', value: bindMessageResponseCursor(spec.message, receipt.cursor), replayed: false, cursor: receipt.cursor };
}

/**
 * An accepted write's effects (§10.3). `write_message` is the record the write
 * builds with the machine's constructor, which must be the machine's `next`.
 */
export function messageCommitPlan(effects: readonly MessageEffect[]): MessageCommitPlan {
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

// --------------------------------------------------------------------------
// One body-storage implementation (SPEC §3.3 line 684)
// --------------------------------------------------------------------------
//
// The original send/respond path (`storePlannedBody`) and the write-owner
// facade (`createMessageWriteOwner.storeBody`) share THIS one implementation.
// Each caller keeps its ORIGINAL operation identity (the `bodyRequestId` it
// passes), so the C1/C2 receipts and bytes are unchanged.

/** The current Workspace source revision a generic body is bound to. */
export async function readCurrentWorkspaceSource(records: SessionMailboxDependencies['records'], owned: Owned): Promise<
  { ok: true; value: ArtifactRef['source'] } | { ok: false; rejection: CoreRejection }> {
  const key = canonicalRefKey({ aggregateType: 'Workspace', projectId: owned.projectId, workspaceId: owned.workspaceId });
  let read: StoreResult<RecordBatchRead>;
  try {
    read = await records.readMany([key]);
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the workspace source revision could not be read') };
  }
  if (read.status !== 'ready') return { ok: false, rejection: sessionStoreFailureToRejection(read) };
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
export async function storeScopedMessageBody(deps: SessionMailboxDependencies, args: {
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

export async function readWorkspaceSource(mailbox: MailboxContext, owned: Owned): Promise<{ ok: true; value: ArtifactRef['source'] } | { ok: false; rejection: CoreRejection }> {
  return readCurrentWorkspaceSource(mailbox.records, owned);
}

// ---- body storage -------------------------------------------------------

/**
 * The original send/respond body effect: a thin adapter over the ONE shared
 * implementation (`storeScopedMessageBody`, SPEC §3.3 line 684). The caller's
 * `bodyRequestId` keeps the original operation identity, so the C1/C2 receipts
 * and bytes are unchanged.
 */
export async function storeMessageBody(mailbox: MailboxContext, args: {
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
  const stored = await storeScopedMessageBody(mailbox.deps, args);
  if (stored.status !== 'ready') return { ok: false, rejection: mapReadResult(stored) as CoreRejection };
  return { ok: true, ref: stored.value.bodyRef };
}

/**
 * The `store_body` effect: a workspace body takes the current Workspace
 * source; a formal Answer body keeps the Answer's ORIGINAL source, so a later
 * current Workspace revision never impersonates the answer-time evidence.
 */
export async function storePlannedBody(mailbox: MailboxContext, body: NonNullable<MessageCommitPlan['body']>, input: BodyInput, write: MessageWrite): Promise<BodyOutcome> {
  const { owned, actor: sender } = write;
  const { messageRef, text, answerSource } = input;
  const bodyRequestId = `session-message-body:${sha256Hex(`${write.identityKey}|${body.part}`)}`;
  if (body.source === 'answer') {
    if (answerSource === null) throw new Error('a formal Answer body keeps the Answer source');
    return storeMessageBody(mailbox, {
      owned, sender, part: body.part, messageRef, text, sourceRef: answerSource, expectedSource: answerSource, bodyRequestId,
    });
  }
  const source = await readWorkspaceSource(mailbox, owned);
  if (!source.ok) return { ok: false, rejection: source.rejection };
  return storeMessageBody(mailbox, { owned, sender, part: body.part, messageRef, text, sourceRef: source.value, bodyRequestId });
}

// ---- replay -------------------------------------------------------------

export async function replayMessage(mailbox: MailboxContext, receipt: Receipt): Promise<WriteResult<SessionMessage>> {
  return replaySessionMessageReceipt(mailbox.records, receipt);
}

/** Receipt-miss recovery uses only the same identity; it never re-runs business. */
export async function recheckAfterMiss(mailbox: MailboxContext, identityKey: string, fingerprint: string): Promise<WriteResult<SessionMessage> | null> {
  return recheckSessionMessageReceipt(mailbox.records, identityKey, fingerprint);
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
export async function refuse(mailbox: MailboxContext, refused: Refused, ctx: MessageGuardContext, identityKey: string, fingerprint: string): Promise<WriteResult<SessionMessage>> {
  if (admissionRefusalOf(refused, ctx) !== null || refused.code === 'invalid') {
    const restored = await recheckAfterMiss(mailbox, identityKey, fingerprint);
    if (restored !== null) return restored;
  }
  return refusalOf(refused, ctx);
}

// ---- accepted writes ----------------------------------------------------

/**
 * An accepted write (§10.3) in today's order: the `store_body` effect before
 * the commit and outside its transaction, the clock, the write's record (the
 * machine's `next`), the `append_event` event, the cancellation check, then
 * ONE commit guarded by `guard_message` and, on `guard_work_run_facts`, the
 * fresh admission's Run, Session, Lease and role guards.
 */
export async function writeMessage(mailbox: MailboxContext, accepted: Accepted, write: MessageWrite): Promise<WriteResult<SessionMessage>> {
  const { owned, identityKey, fingerprint } = write;
  const plan = messageCommitPlan(accepted.effects);
  let record: (at: string) => SessionMessage;
  if (write.body === null || plan.body === null) {
    if (write.body !== null || plan.body !== null) throw new Error('a mailbox write stores its body exactly when the machine names store_body');
    record = write.record;
  } else {
    const stored = await storePlannedBody(mailbox, plan.body, write.body, write);
    if (!stored.ok) return stored.rejection;
    const withBody = write.record;
    record = (at) => withBody(at, stored.ref);
  }
  const at = mailbox.deps.now();
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
    // The event's scope is the message record's own: the registration checks it
    // against `message.ref`, and a cross-workspace Host notify writes its record
    // in the recipient line's workspace.
    projectId: message.ref.projectId, workspaceId: message.ref.workspaceId, requestId: write.requestId,
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
  return mailbox.messageWrites.persist(persistCtx, {
    input: {
      // Only the null-ness is read by `persist` (create vs update); the CAS
      // itself is the accepted pin below, never this record's revision.
      before: plan.messageRevision === null ? null : message,
      next: message, event, guards, claims: write.claims ?? [],
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
