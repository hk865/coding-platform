import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type { ArchiveStepRefV1, ArchiveWaitChoiceV1 } from '../../../contracts/core/session-archive.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { EncodedDomainEvent, EncodedRecord, PreparedCommit, RecordGuard, StoreResult } from '../../record-store/ports.js';
import type { SessionMailboxDependencies, SessionMessage } from '../model/communication-contracts.js';
import type { SessionArchiveChangedEventV1 } from '../sessions/lifecycle-record-codecs.js';
import type { MessageGuardContext } from '../state/message-machine.js';
import type { MailboxContext, Owned, Accepted, MessageEventEnvelope, Receipt, DurableArchiveRequestRead, StoredArchiveRequestRead, WaitRunRead } from './mailbox-types.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { deriveArchiveStepCommitIdentityV1 } from '../../../contracts/core/session-archive.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import { isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { SESSION_ARCHIVE_REQUESTED_EVENT, sessionArchiveChangedEventFromEvent } from '../sessions/lifecycle-record-codecs.js';
import { encodeArchiveWaitDisposedEvent, encodeSessionMessageRecord, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import { checkPlainSessionRef, decodeSessionRecord, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import { messageMachineStateOf, nextSessionMessageRecord } from '../state/message-machine.js';
import { readBatch } from '../tasks/plan-readers.js';
import { preservedNoticeOrigin, ownContext, judge, presenceOf, mapBatchFailure, loadMessageForWrite, acceptedMessage } from './mailbox-common.js';
import { replayMessage, recheckAfterMiss, refuse, messageCommitPlan } from './mailbox-write.js';

// --------------------------------------------------------------------------
// Request normalization
// --------------------------------------------------------------------------

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
 * Slice 1 §4.5 step 7, 7B §3.9 item 6: the step names its own choice and nothing else. `reply_handler` is the
 * transfer's step; `wait_cancel` is the cancel's. Any other step is the existing `null` mapping, never written as a
 * cancel for a transfer, so the wait a transfer moves stays open/answered and the handler consumes it.
 */
function waitChoiceForStep(wait: ArchiveWaitChoiceV1 | null, step: ArchiveStepRefV1): ArchiveWaitChoiceV1 | null {
  if (wait === null) return null;
  if (step.step === 'reply_handler') return wait.kind === 'transfer' ? wait : null;
  return wait.kind === 'cancel' ? wait : null;
}

/** Slice 1 S1-MSG-01: the target Session is same-workspace, active, not retired/archiving and not a readonly copy. */
export function replyTargetEligible(owned: Owned, target: SessionRecord): boolean {
  const provenance = target.provenance ?? null;
  return target.workspaceId === owned.workspaceId
    && target.lifecycle === 'active'
    && target.health !== 'unavailable'
    && (target.archiveRequest ?? null) === null
    && (provenance === null || provenance.kind !== 'readonly_copy');
}

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

// ---- disposeArchiveWait (S1-MSG-01/02) ----------------------------------

/** §3.4: the durable R is read first, so a replay never needs the current record. */
async function readDurableArchiveRequest(mailbox: MailboxContext, owned: Owned, step: ArchiveStepRefV1): Promise<DurableArchiveRequestRead> {
  const key = sessionAggregateRefKey(plainSessionRefToAggregate(step.sessionRef));
  const read = await readBatch(mailbox.records, [key]);
  if (read.status !== 'ready') return { ok: false, rejection: mapBatchFailure(mailbox, read) };
  const presence = presenceOf(mailbox, read.batch, key);
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

/**
 * §2.3/D10: recover the immutable ORIGINAL request through the step's stored
 * `requestReceipt` (lookupCommit → eventAt of the SessionArchiveRequested
 * event), exactly as the sessions owner does for SV56. This never depends on
 * the current Session record, so a committed internal `reply_handler` /
 * `wait_cancel` step can still replay after the final archive cleared R.
 */
async function loadStoredArchiveRequest(mailbox: MailboxContext, owned: Owned, step: ArchiveStepRefV1): Promise<StoredArchiveRequestRead> {
  let found: StoreResult<Receipt>;
  try {
    found = await mailbox.records.lookupCommit({
      identityKey: step.requestReceipt.identityKey, fingerprint: step.requestReceipt.fingerprint,
    });
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the archive request receipt could not be read') };
  }
  if (found.status !== 'ready') {
    if (found.code === 'not_found') return { ok: false, rejection: reject('not_found', 'the archive request receipt was not found') };
    return { ok: false, rejection: sessionStoreFailureToRejection(found) };
  }
  let at: StoreResult<{ cursor: CommitCursor; event: EncodedDomainEvent }>;
  try {
    at = await mailbox.records.eventAt(found.value.cursor);
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the archive request event could not be read') };
  }
  if (at.status !== 'ready') return { ok: false, rejection: sessionStoreFailureToRejection(at) };
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

/** The exact original wait Run and its CAS revision from one read window. */
async function readWaitRun(mailbox: MailboxContext, owned: Owned, runRef: RunRef): Promise<WaitRunRead> {
  const refKey = canonicalOf(runRef);
  if (refKey === null) return { ok: false, rejection: reject('invalid', 'archive_input_invalid: the wait RunRef is not canonicalizable JSON') };
  const read = await readBatch(mailbox.records, [refKey]);
  if (read.status !== 'ready') return { ok: false, rejection: mapBatchFailure(mailbox, read) };
  const presence = presenceOf(mailbox, read.batch, refKey);
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
async function writeArchiveWaitDisposal(mailbox: MailboxContext, args: {
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
  const preserved = await preservedNoticeOrigin(mailbox.records, sessionMessageRefKey(message.ref));
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
    receipt = await mailbox.records.commit(prepared);
  } catch {
    const restored = await recheckAfterMiss(mailbox, args.identityKey, args.fingerprint);
    return restored ?? reject('unavailable', 'the wait disposal commit failed before completing');
  }
  if (receipt.status !== 'committed') {
    const restored = await recheckAfterMiss(mailbox, args.identityKey, args.fingerprint);
    return restored ?? sessionStoreFailureToRejection(receipt);
  }
  if (receipt.replayed) return replayMessage(mailbox, receipt);
  return { status: 'committed', value: message, replayed: false, cursor: receipt.cursor };
}

export async function disposeArchiveWait(mailbox: MailboxContext, ctx: CoreCallContext, step: ArchiveStepRefV1): Promise<WriteResult<SessionMessage>> {
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
  const stored = await loadStoredArchiveRequest(mailbox, owned, ownedStep);
  if (!stored.ok) return stored.rejection;
  const request = stored.request;
  let identity: { identityKey: string; fingerprint: string; eventId: string };
  try {
    identity = deriveArchiveStepCommitIdentityV1(
      { projectId: owned.projectId, workspaceId: owned.workspaceId }, request, ownedStep);
  } catch {
    return reject('invalid', 'archive_input_invalid: the archive step does not belong to the stored archive request');
  }
  const existing = await mailbox.records.lookupCommit({ identityKey: identity.identityKey, fingerprint: identity.fingerprint });
  if (existing.status === 'ready') return replayMessage(mailbox, existing.value);
  if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);

  // A NEW commit still needs the matching CURRENT request on the Session.
  const durable = await readDurableArchiveRequest(mailbox, owned, ownedStep);
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
  const messageRead = await loadMessageForWrite(mailbox, owned, choice.messageRef);
  if (!messageRead.ok) return messageRead.rejection;
  const message = messageRead.message;
  const runRead = await readWaitRun(mailbox, owned, choice.runRef);
  if (!runRead.ok) return runRead.rejection;
  const run = runRead.run;

  let target: SessionRecord | null = null;
  if (ownedStep.step === 'reply_handler') {
    if (choice.kind !== 'transfer') {
      return reject('invalid', 'archive_input_invalid: the reply-handler step needs a transfer choice');
    }
    const targetKey = sessionAggregateRefKey(plainSessionRefToAggregate(choice.to));
    const targetRead = await readBatch(mailbox.records, [targetKey]);
    if (targetRead.status !== 'ready') return mapBatchFailure(mailbox, targetRead);
    const presence = presenceOf(mailbox, targetRead.batch, targetKey);
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
  const now = mailbox.deps.now();
  if (!nonEmpty(now)) return reject('invalid', 'the injected clock is not a legal instant');
  const archiveWaitFacts: NonNullable<MessageGuardContext['archiveWait']> = {
    choice, archiveSessionRef: ownedStep.sessionRef, archiveRequestId: request.requestId, now,
    requestMatches: true, waitMatches, targetEligible, responseAccepted,
  };
  const { decided, ctx: messageCtx } = judge(owned.principal, message, { type: 'archive_wait_disposed' }, { archiveWait: archiveWaitFacts });
  if (!decided.ok) return refuse(mailbox, decided, messageCtx, identity.identityKey, identity.fingerprint);
  const current = acceptedMessage(message);
  const guards: RecordGuard[] = [{ refKey: runRead.refKey, expectedRevision: runRead.revision }];
  if (target !== null) {
    guards.push({ refKey: sessionAggregateRefKey(target.ref), expectedRevision: target.revision });
  }
  return writeArchiveWaitDisposal(mailbox, {
    owned, identityKey: identity.identityKey, fingerprint: identity.fingerprint, eventId: identity.eventId,
    now, message: current, accepted: decided, source, archiveStep: ownedStep, choice, guards,
  });
}

