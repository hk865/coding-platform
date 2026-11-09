import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { ConsumedWaitV1, RunRef } from '../../../contracts/dispatch.js';
import type { JsonValue } from '../../../contracts/fingerprint.js';
import type { QueryJobAnswerRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { RecordGuard } from '../../record-store/ports.js';
import type { MessageSender, SessionMessage, SessionMessageRespondInputV1 } from '../model/communication-contracts.js';
import type { SessionMessageCommitCompanions, SessionMessageWriteCommandV1 } from '../model/decision-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { TaskExecutionRecord } from '../model/execution-read-contracts.js';
import type { WriteCommand } from '../persistence/command-executor.js';
import type { MessageGuardContext } from '../state/message-machine.js';
import type { MailboxContext, Unknown, WithdrawFacts, WithdrawDecision, ReleaseFacts, ReleaseDecision, Owned, QueryAnswerFacts } from './mailbox-types.js';
import { sameActorIdentity as sameActor } from '../../../contracts/actor-equality.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { canonicalJson, canonicalOf, sha256Hex } from '../../../contracts/fingerprint.js';
import { isPos as isPositiveInt, isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import { deriveSessionInputId, waitConsumedClaimKey } from '../model/communication-contracts.js';
import { normalizeRespondMessageInput } from '../model/message-payload.js';
import { executeWriteCommand } from '../persistence/command-executor.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { SESSION_MESSAGE_MAX_TEXT_BYTES } from '../sessions/message-record-codecs.js';
import { effectiveReplyHandler, inputObserverProblem, nextSessionMessageRecord, waitFactsOfRecord } from '../state/message-machine.js';
import { ownsInbox } from './mailbox-access.js';
import { isUserRecipient, mapReadResult, internalHostContext, ownContext, ownWrite, normalizeText, normalizeMessageRef, scopeOfMessageRef, guardRejection, principalRefusal, pinsOf, judge, refusalOf, sameSessionRefAs, senderIdentityOf, identityKeyOf, fingerprintOf, eventIdOf, loadMessage, loadMessageForWrite, acceptedMessage } from './mailbox-common.js';
import { readFreshWorkRunFacts, readWorkRunIdentity, deriveWorkRunSender, authorizeNewWorkRunAction, loadQueryRun, readQueryAnswerFacts, resolveSecretaryRound, interventionSourceFormallyEnded } from './mailbox-identity.js';
import { replayMessage, refuse, writeMessage, prepareSessionMessage, releaseDecidedChange, messageWriteResult, withdrawnResult, releaseDecidedResult } from './mailbox-write.js';

// ---- ackMessage ---------------------------------------------------------

export async function ackMessage(mailbox: MailboxContext, ctx: CoreCallContext, request: GraphWrite<{ messageRef: SessionMessageRef }>): Promise<WriteResult<SessionMessage>> {
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
  const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
  if (!identity.ok) return identity.rejection;
  // Rule W/M4: the message is in the sending line's workspace; the Run identity stays the Run's.
  const scopeProblem = scopeOfMessageRef(owned, normalized.ref, identity.session.workspaceId);
  if (scopeProblem !== null) return scopeProblem;
  const pins = pinsOf(write.expected, normalized.ref);
  if (!pins.ok) return pins.rejection;

  const derived = deriveWorkRunSender(mailbox, identity);
  if (!derived.ok) return derived.rejection;
  const sender = derived.sender;
  const senderIdentity = senderIdentityOf(sender);
  const identityKey = identityKeyOf('ack', owned, senderIdentity, write.requestId);
  const fingerprint = fingerprintOf('ack', owned, senderIdentity, { messageRef: normalized.ref }, write.expected);
  if (owned.signal.aborted) return reject('cancelled', 'the acknowledgement was cancelled before the idempotency lookup');
  const existing = await mailbox.records.lookupCommit({ identityKey, fingerprint });
  if (existing.status === 'ready') return replayMessage(mailbox, existing.value);
  if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);
  const authorized = await authorizeNewWorkRunAction(mailbox, {
    owned, principal: owned.principal, operationToolName: 'ack_session_message',
  });
  // MSG-03. A refused admission never reads the message (the machine asks the
  // admission before the record).
  const read = authorized.ok ? await loadMessageForWrite(mailbox, owned, normalized.ref) : { ok: true as const, message: null };
  if (!read.ok) return read.rejection;
  const message = read.message;
  const { decided, ctx: messageCtx } = judge(owned.principal, message, { type: 'message_read' }, {
    workRunAuthorization: authorized.ok ? 'ok' : authorized.rejection,
    callerIsRecipient: message === null ? null : ownsInbox(mailbox, sender.sessionRef, message),
    pins: pins.pins,
  });
  // A same-identity request may have committed this exact acknowledgement
  // while this call sat between its first receipt miss and the message read:
  // its receipt is restored (`refuse`); a genuine different request
  // keeps the domain rejection and never commits a second time.
  if (!decided.ok) return refuse(mailbox, decided, messageCtx, identityKey, fingerprint);
  const current = acceptedMessage(message);
  return writeMessage(mailbox, decided, {
    owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: authorized,
    cancelled: 'the acknowledgement was cancelled before commit',
    body: null,
    record: (readAt) => nextSessionMessageRecord(current, { kind: 'read', readAt }),
  });
}

// ---- respondMessage -----------------------------------------------------

export async function respondMessage(mailbox: MailboxContext, ctx: CoreCallContext, request: SessionMessageRespondInputV1): Promise<WriteResult<SessionMessage>> {
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
  const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
  if (!identity.ok) return identity.rejection;
  // Rule W/M4: the message is in the sending line's workspace; the Run identity stays the Run's.
  const scopeProblem = scopeOfMessageRef(owned, messageRef, identity.session.workspaceId);
  if (scopeProblem !== null) return scopeProblem;
  const pins = pinsOf(write.expected, messageRef);
  if (!pins.ok) return pins.rejection;
  // The reason is the refusal's reply body; a `response` part is always held to the ordinary 16 KiB.
  const saved = normalizeText(arm.reject === true ? arm.reason : arm.text, SESSION_MESSAGE_MAX_TEXT_BYTES);
  if (!saved.ok) return saved.rejection;

  const derived = deriveWorkRunSender(mailbox, identity);
  if (!derived.ok) return derived.rejection;
  const sender = derived.sender;
  const senderIdentity = senderIdentityOf(sender);
  const identityKey = identityKeyOf('respond', owned, senderIdentity, write.requestId);
  const fingerprint = fingerprintOf('respond', owned, senderIdentity, { messageRef, ...arm }, write.expected);
  if (owned.signal.aborted) return reject('cancelled', 'the response was cancelled before the idempotency lookup');
  const existing = await mailbox.records.lookupCommit({ identityKey, fingerprint });
  if (existing.status === 'ready') return replayMessage(mailbox, existing.value);
  if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);
  const authorized = await authorizeNewWorkRunAction(mailbox, {
    owned, principal: owned.principal, operationToolName: 'respond_session_message',
  });
  // MSG-04/05. A refused admission never reads the message.
  const read = authorized.ok ? await loadMessageForWrite(mailbox, owned, messageRef) : { ok: true as const, message: null };
  if (!read.ok) return read.rejection;
  const message = read.message;
  const { decided, ctx: messageCtx } = judge(owned.principal, message,
    arm.reject === true
      ? { type: 'message_responded', via: 'text', rejected: true }
      : { type: 'message_responded', via: 'text' }, {
    workRunAuthorization: authorized.ok ? 'ok' : authorized.rejection,
    callerIsRecipient: message === null ? null : ownsInbox(mailbox, sender.sessionRef, message),
    pins: pins.pins,
    bodyBounded: true, // `normalizeText` held with the request
  });
  // See the acknowledgement: this exact identity's committed receipt is
  // restored instead of a second, conflicting rejection.
  if (!decided.ok) return refuse(mailbox, decided, messageCtx, identityKey, fingerprint);
  const current = acceptedMessage(message);
  return writeMessage(mailbox, decided, {
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
export async function respondFromQueryAnswer(mailbox: MailboxContext,
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
  const read = await loadMessageForWrite(mailbox, owned, normalized.ref);
  if (!read.ok) return read.rejection;
  const message = read.message;
  let facts: QueryAnswerFacts | null = null;
  if (message !== null) {
    const gathered = await readQueryAnswerFacts(mailbox, owned, message, answerRef);
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
  const existing = await mailbox.records.lookupCommit({ identityKey, fingerprint });
  if (existing.status === 'ready') return replayMessage(mailbox, existing.value);
  if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);
  // The single response slot (first come with MSG-04/05) is judged after the
  // lookup, so this identity's committed receipt replays; the pin is the
  // commit's message CAS.
  if (!decided.ok) return refuse(mailbox, decided, messageCtx, identityKey, fingerprint);
  return writeMessage(mailbox, decided, {
    owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: null,
    cancelled: 'the answer association was cancelled before commit',
    body: { messageRef: message.ref, text: facts.text, answerSource: facts.answerSource },
    record: (respondedAt, bodyRef) => nextSessionMessageRecord(message, {
      kind: 'responded', response: { sender, bodyRef, sourceRef: bodyRef.source, respondedAt }, rejectedAt: null,
    }),
  });
}

// ---- recordConsultationDerivation (Host-only fixed A′ fact) -------------

export async function recordConsultationDerivation(mailbox: MailboxContext,
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
  const existing = await mailbox.records.lookupCommit({ identityKey, fingerprint });
  if (existing.status === 'ready') return replayMessage(mailbox, existing.value);
  if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);
  // MSG-09: the first derivation wins; its shape is the codec's at commit.
  const read = await loadMessageForWrite(mailbox, owned, normalized.ref);
  if (!read.ok) return read.rejection;
  const message = read.message;
  const { decided, ctx: messageCtx } = judge(owned.principal, message, { type: 'consultation_derived' }, { pins: pins.pins });
  if (!decided.ok) return refuse(mailbox, decided, messageCtx, identityKey, fingerprint);
  const current = acceptedMessage(message);
  return writeMessage(mailbox, decided, {
    owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: null,
    cancelled: 'the derivation record was cancelled before commit',
    body: null,
    record: () => nextSessionMessageRecord(current, {
      kind: 'consultation_derived', derivation: derivation as NonNullable<SessionMessage['consultationDerivation']>,
    }),
  });
}

// ---- recordInputAccepted (Runtime observer confirmation) ---------------

export async function recordInputAccepted(mailbox: MailboxContext,
  ctx: CoreCallContext,
  request: GraphWrite<{
    messageRef: SessionMessageRef;
    part: 'message' | 'response' | 'expiry';
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
  const part = raw['part'];
  if (part !== 'message' && part !== 'response' && part !== 'expiry')
    return reject('invalid', 'recordInputAccepted part must be message, response or expiry');
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
  // Rule W/M4: the accepted input message belongs to the execution Session's workspace; the
  // execution identity stays the Run's. The one fresh Run read also supplies the execution
  // facts below, so it is taken here and reused.
  let messageWorkspaceId = owned.workspaceId;
  let runRecord: TaskExecutionRecord | null = null;
  if (executionRef['aggregateType'] === 'Run') {
    const runFacts = await readFreshWorkRunFacts(mailbox, owned, executionRef as unknown as RunRef);
    if (!runFacts.ok) return runFacts.rejection;
    runRecord = runFacts.record;
    messageWorkspaceId = runRecord.session.workspaceId;
  }
  const scopeProblem = scopeOfMessageRef(owned, normalized.ref, messageWorkspaceId);
  if (scopeProblem !== null) return scopeProblem;
  const kernel = raw['kernel'];
  if (!isObject(kernel) || Object.keys(kernel).some(key => !['adapterId', 'kernelSessionId', 'runId', 'turnId', 'position'].includes(key))
    || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId'])
    || !nonEmpty(kernel['runId']) || !nonEmpty(kernel['turnId'])
    || !isPositiveInt(kernel['position'])) {
    return reject('invalid', 'recordInputAccepted requires a complete Kernel event identity');
  }
  const sender: MessageSender = { kind: 'host', actor: { ...mailbox.deps.systemActor } };
  const senderIdentity = senderIdentityOf(sender);
  const identityKey = `input-accepted:${sha256Hex(canonicalJson({ messageRef: normalized.ref, part, executionRef, kernel } as unknown as JsonValue))}`;
  const fingerprint = fingerprintOf('input-accepted', owned, senderIdentity,
    { messageRef: normalized.ref, part, executionRef, kernel }, []);
  const existing = await mailbox.records.lookupCommit({ identityKey, fingerprint });
  if (existing.status === 'ready') return replayMessage(mailbox, existing.value);
  if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);
  // MSG-07/08. The execution facts are read only for an existing message (an
  // absent one is refused first); their read failures keep today's rejections.
  const read = await loadMessageForWrite(mailbox, owned, normalized.ref);
  if (!read.ok) return read.rejection;
  const message = read.message;
  const inputId = deriveSessionInputId(normalized.ref, part);
  let facts: MessageGuardContext['inputAccepted'] = null;
  let boundHere = false;
  if (message !== null) {
    let actualSession: SessionRef;
    let actualKernel: { adapterId: string; kernelSessionId: string; runId: string; turnId: string } | null | undefined;
    let consumedWait: ConsumedWaitV1 | null = null;
    if (runRecord !== null) {
      actualSession = { projectId: runRecord.outbox.claim.sessionRef.projectId, sessionId: runRecord.outbox.claim.sessionRef.sessionId };
      const authorization = runRecord.run.executionAuthorization;
      actualKernel = runRecord.run.executionHistory?.kernel ?? authorization?.kernel;
      consumedWait = runRecord.run.consumedWait ?? null;
    } else {
      if (executionRef['workspaceId'] !== owned.workspaceId) return reject('forbidden', 'Query execution is outside the workspace');
      const queryFacts = await loadQueryRun(mailbox, owned, executionRef as unknown as QueryRunRef);
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
    const intervention = consumedWait !== null && consumedWait.kind === 'intervention';
    const handlerHere = part === 'response' && !intervention
      && effectiveReplyHandler(message) !== null
      && canonicalOf(effectiveReplyHandler(message)) === canonicalOf(actualSession);
    const waitBoundHere = !intervention && consumedWait !== null
      && (part === 'expiry' ? consumedWait.kind === 'expiry' : consumedWait.kind === 'wait_reply')
      && canonicalOf(consumedWait.messageRef) === canonicalOf(message.ref);
    boundHere = waitBoundHere || handlerHere;
    facts = {
      observerOwnsExecution,
      kernelMatches: actualKernel !== undefined && actualKernel !== null
        && actualKernel.adapterId === kernel['adapterId'] && actualKernel.kernelSessionId === kernel['kernelSessionId']
        && actualKernel.runId === kernel['runId'] && actualKernel.turnId === kernel['turnId'],
      claimedSessionMatches: raw['executionSessionRef'] === undefined
        || canonicalOf(raw['executionSessionRef']) === canonicalOf(actualSession),
      executionSessionMatches: part === 'response'
        ? handlerHere
        : part === 'expiry'
          ? message.sender.kind === 'work_run'
            && canonicalOf(message.sender.sessionRef) === canonicalOf(actualSession)
          : canonicalOf(message.recipient) === canonicalOf(actualSession),
      inputIdTakenByOtherEvent: accepted !== undefined
        && (canonicalOf(accepted.executionRef) !== canonicalOf(executionRef) || canonicalOf(accepted.kernel) !== canonicalOf(kernel)),
    };
  }
  const consumesWait = message !== null && part !== 'message' && boundHere
    && !waitFactsOfRecord(message).consumed;
  const { decided, ctx: messageCtx } = judge(owned.principal, message, { type: 'input_accepted', part, inputId }, { inputAccepted: facts });
  // Only the inputId uniqueness refusals (`invalid`: another event's entry, or
  // this event's own without its receipt) re-check the receipt first.
  if (!decided.ok) return refuse(mailbox, decided, messageCtx, identityKey, fingerprint);
  const current = acceptedMessage(message);
  return writeMessage(mailbox, decided, {
    owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: null,
    cancelled: 'the input acceptance was cancelled before commit',
    body: null,
    record: (acceptedAt) => nextSessionMessageRecord(current, {
      kind: 'input_accepted',
      input: {
        inputId, part, executionRef: executionRef as RunRef | QueryRunRef,
        kernel: kernel as NonNullable<SessionMessage['acceptedInputs']>[number]['kernel'], acceptedAt,
        evidence: 'input_accepted', consumesWait,
      },
    }),
    claims: consumesWait
      ? [{ claimKey: waitConsumedClaimKey(normalized.ref), expectedOwner: null, nextOwner: inputId }]
      : [],
  });
}

// ---- message.withdraw ---------------------------------------------------

/**
 * The withdraw's facts: the message, the caller's trusted sender facts (and,
 * for a Work Run, the fresh admission guards), and the recipient line's one
 * consistent open-execution read. The message's own state refusal is the
 * machine's, decided by `decideWithdraw`.
 */

async function readWithdrawFacts(mailbox: MailboxContext, owned: Owned, ref: SessionMessageRef):
Promise<{ status: 'ready'; facts: WithdrawFacts } | CoreRejection> {
  const loaded = await loadMessage(mailbox, owned, ref);
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
    // person may withdraw any message of this workspace. The one exception is
    // a formally ended, no-answer intervention source on this exact line: the
    // person's planning turn produced nothing to reply, so the stale source is
    // retired (the guards above prove every fact again, never a caller claim).
    if (owned.principal.actor.kind === 'system'
      && (message.sender.kind !== 'host' || !sameActor(message.sender.actor, owned.principal.actor))) {
      const ended = await interventionSourceFormallyEnded(mailbox, owned, message);
      if ('rejection' in ended) return ended.rejection;
      if (!ended.ok) return reject('forbidden', 'a Host system sender may withdraw only its own message');
    }
  } else if (owned.principal.kind === 'query_run') {
    // The secretary withdraws only a message of the same resolved round.
    if (mailbox.deps.secretaryRounds === undefined) {
      return reject('unsupported', 'the secretary withdraw is not configured');
    }
    const resolved = await resolveSecretaryRound(mailbox, owned);
    if (!resolved.ok) return resolved.rejection;
    const round = resolved.round;
    if (message.sender.kind !== 'secretary_round'
      || canonicalOf(message.sender.queryRunRef) !== canonicalOf(round.run)
      || !sameSessionRefAs(message.sender.sessionRef, round.session)) {
      return reject('forbidden', 'a secretary may withdraw only a message of its own resolved round');
    }
    actor = message.sender;
  } else {
    const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    const derived = deriveWorkRunSender(mailbox, identity);
    if (!derived.ok) return derived.rejection;
    const authorized = await authorizeNewWorkRunAction(mailbox, {
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

  const recipientExecutions = mailbox.deps.recipientExecutions;
  if (recipientExecutions === undefined) {
    return reject('unsupported', 'the recipient execution read is not configured');
  }
  const recipient = message.recipient;
  if (isUserRecipient(recipient)) {
    return reject('invalid', 'a message to the person has no recipient execution line');
  }
  const sessionRef: SessionRef = { projectId: recipient.projectId, sessionId: recipient.sessionId };
  // Rule W/M4: the letter lives in the receiving line's workspace; the recipient Session's open
  // executions are read there, not in the Run's workspace. The withdrawal itself stays the
  // caller's (the machine judges `owned.principal`).
  const open = await recipientExecutions.readRecipientOpenExecutions(
    internalHostContext(mailbox, { ...owned, workspaceId: ref.workspaceId }),
    { sessionRef, messageRef: ref });
  if (open.status !== 'ready') {
    return open.status === 'rejected' ? open : mapReadResult(open) as CoreRejection;
  }
  return { status: 'ready', facts: { message, open: open.value, guards, actor } };
}

/** The machine decides every withdrawal refusal; the owner supplies the one clock. */
function decideWithdraw(mailbox: MailboxContext, owned: Owned, facts: WithdrawFacts):
{ refuse: CoreRejection } | { decision: WithdrawDecision } {
  const { decided, ctx } = judge(owned.principal, facts.message, { type: 'message_withdrawn' }, {});
  if (!decided.ok) return { refuse: refusalOf(decided, ctx) };
  // A live offer is the recipient line's refusal, decided after the state so a
  // delivered message is `invalid`, never masked by the open execution.
  if (facts.open.executions.length > 0) {
    return { refuse: reject('unavailable', 'the recipient has an open execution that could have been offered this message') };
  }
  const at = mailbox.deps.now();
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
async function readReleaseFacts(mailbox: MailboxContext, owned: Owned, ref: SessionMessageRef):
Promise<{ status: 'ready'; facts: ReleaseFacts } | CoreRejection> {
  const loaded = await loadMessage(mailbox, owned, ref);
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
function decideRelease(mailbox: MailboxContext, owned: Owned, facts: ReleaseFacts, allow: boolean):
{ refuse: CoreRejection } | { decision: ReleaseDecision } {
  const { decided, ctx } = judge(owned.principal, facts.message,
    { type: 'message_release_decided', allow }, {});
  if (!decided.ok) return { refuse: refusalOf(decided, ctx) };
  const at = mailbox.deps.now();
  if (!nonEmpty(at)) return { refuse: reject('invalid', 'the injected clock is not a legal instant') };
  return {
    decision: {
      before: facts.message, change: releaseDecidedChange(facts.message, allow, at, null),
      at, actor: facts.actor,
    },
  };
}

export async function withdrawMessage(mailbox: MailboxContext, ctx: CoreCallContext, request: GraphWrite<{ messageRef: SessionMessageRef }>):
Promise<WriteResult<SessionMessage>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  const write = ownWrite(request);
  if (!write.ok) return write.rejection;
  const rawRef = (write.input as unknown as { messageRef?: unknown } | null | undefined)?.messageRef;
  const normalized = normalizeMessageRef(rawRef);
  if (!normalized.ok) return reject('invalid', normalized.reason);
  const ref = normalized.ref;
  // Rule W/M4: the message is in the sending line's workspace; the Run identity stays the Run's.
  let messageWorkspaceId = owned.workspaceId;
  if (owned.principal.kind === 'work_run') {
    const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    messageWorkspaceId = identity.session.workspaceId;
  }
  const scopeProblem = scopeOfMessageRef(owned, ref, messageWorkspaceId);
  if (scopeProblem !== null) return scopeProblem;

  const withdrawCommand: WriteCommand<WithdrawFacts, WithdrawDecision, CoreRejection, SessionMessage, SessionMessage> = {
    operation: 'message.withdraw',
    scope: { projectId: owned.projectId, workspaceId: owned.workspaceId },
    principal: principalIdentity(owned.principal),
    commandId: write.requestId,
    fingerprintInput: { messageRef: ref },
    read: () => readWithdrawFacts(mailbox, owned, ref),
    decide: (facts) => decideWithdraw(mailbox, owned, facts),
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
          workspaceId: ref.workspaceId,
          actor: decision.actor,
        },
        change: decision.change,
      };
      const companions: SessionMessageCommitCompanions = {
        records: [], events: [], guards: decision.guards, claims: [], ledgerHorizon: decision.horizon,
      };
      return prepareSessionMessage(mailbox.records, owned, command, companions);
    },
    result: withdrawnResult,
  };
  return messageWriteResult(await executeWriteCommand(mailbox.records, withdrawCommand));
}
export async function releaseMessage(mailbox: MailboxContext, ctx: CoreCallContext,
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
    read: () => readReleaseFacts(mailbox, owned, ref),
    decide: (facts) => decideRelease(mailbox, owned, facts, allow),
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
      return prepareSessionMessage(mailbox.records, owned, command, companions);
    },
    result: releaseDecidedResult,
  };
  return messageWriteResult(await executeWriteCommand(mailbox.records, releaseCommand));
}
