import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { ConsumedWaitV1, RunRef } from '../../../contracts/dispatch.js';
import type { JsonValue } from '../../../contracts/fingerprint.js';
import { interventionPlanningQueryRefs, type QueryJobAnswerRef, type QueryRunRef } from '../../../contracts/query-job.js';
import type { RecordGuard } from '../../record-store/ports.js';
import type {
  MessageQueryRoundSender, MessageSender, MessageWorkRunSender, SessionMessage, SessionMessageRespondInputV1,
} from '../model/communication-contracts.js';
import type { SessionMessageCommitCompanions, SessionMessageWriteCommandV1 } from '../model/decision-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { WriteCommand } from '../persistence/command-executor.js';
import type { MessageGuardContext, MessageResponseSlotV1 } from '../state/message-machine.js';
import type { QueryRoundV1 } from '../model/query-round-contracts.js';
import type { AuthOutcome, MailboxContext, Unknown, WithdrawFacts, WithdrawDecision, Owned, QueryAnswerFacts } from './mailbox-types.js';
import { sameActorIdentity as sameActor } from '../../../contracts/actor-equality.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { canonicalJson, canonicalOf, sha256Hex } from '../../../contracts/fingerprint.js';
import { isPos as isPositiveInt, isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import { deriveSessionInputId, waitConsumedClaimKey } from '../model/communication-contracts.js';
import { normalizeRespondMessageInput } from '../model/message-payload.js';
import { executeWriteCommand } from '../persistence/command-executor.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { SESSION_MESSAGE_MAX_TEXT_BYTES, isSystemRoundSender } from '../sessions/message-record-codecs.js';
import { effectiveReplyHandler, inputObserverProblem, nextSessionMessageRecord, replyStillBoundToWait,
  waitFactsOfRecord } from '../state/message-machine.js';
import { ownsInbox, readMessage } from './mailbox-access.js';
import { isUserRecipient, mapReadResult, internalHostContext, ownContext, ownWrite, normalizeText, normalizeMessageRef, scopeOfMessageRef, guardRejection, principalRefusal, pinsOf, judge, refusalOf, sameSessionRefAs, senderIdentityOf, identityKeyOf, fingerprintOf, eventIdOf, loadMessage, loadMessageForWrite, acceptedMessage } from './mailbox-common.js';
import { readFreshWorkRunFacts, readWorkRunIdentity, deriveWorkRunSender, authorizeNewWorkRunAction, loadQueryJob, loadQueryRun, readQueryAnswerFacts, interventionSourceFormallyEnded, nonRequestQueryRound, requiredQueryRound, queryWorkspaceOfMessage, decisionAnswerQueryOf } from './mailbox-identity.js';
import { canonicalRefKey } from '../persistence/record-codecs.js';
import { replayMessage, refuse, writeMessage, prepareSessionMessage, messageWriteResult, withdrawnResult } from './mailbox-write.js';

// ---- respondMessage -----------------------------------------------------

type RespondArm = { reject: true; reason: string; text?: never } | { text: string; reject?: never; reason?: never };

/** The respond payload with its one message pin (T's ONE respond payload model). */
function respondInputOf(request: SessionMessageRespondInputV1): { ok: true; value: {
  requestId: string; expected: Extract<ReturnType<typeof ownWrite>, { ok: true }>['expected'];
  messageRef: SessionMessageRef; arm: RespondArm;
} } | { ok: false; rejection: CoreRejection } {
  const write = ownWrite(request);
  if (!write.ok) return write;
  const raw = write.input as unknown as Unknown | null | undefined;
  if (!isObject(raw)) return { ok: false, rejection: reject('invalid', 'respondMessage requires an input object') };
  // T's ONE respond payload model: the version is the single message pin in
  // `meta.expected` (never a body key), so the normalized value is decoded
  // with it and the fingerprint payload keeps only `{messageRef, ...body}`.
  const pin = write.expected.length === 1 && isObject(write.expected[0])
    ? write.expected[0] as unknown as Unknown : null;
  const normalized = normalizeRespondMessageInput({
    ...raw, expectedRevision: pin === null ? undefined : pin['revision'],
  });
  if (normalized.status === 'not_found') return { ok: false, rejection: reject('not_found', 'the requested record does not exist') };
  if (normalized.status === 'not_ready') return { ok: false, rejection: reject('incomplete', 'the response payload is not readable') };
  if (normalized.status === 'rejected') return { ok: false, rejection: normalized };
  const value = normalized.value;
  const arm: RespondArm = 'reject' in value
    ? { reject: true as const, reason: value.reason }
    : { text: value.text };
  return { ok: true, value: { requestId: write.requestId, expected: write.expected, messageRef: value.messageRef, arm } };
}

export async function respondMessage(mailbox: MailboxContext, ctx: CoreCallContext, request: SessionMessageRespondInputV1): Promise<WriteResult<SessionMessage>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  // `query_run` 调用方先查回执再解析：问答轮写它自己的文字回复，解析不出的照旧拒。
  if (owned.principal.kind === 'query_run') {
    return respondAsQueryRound(mailbox, owned, owned.principal.queryRunRef, request);
  }
  if (owned.principal.kind !== 'work_run') return principalRefusal(owned.principal, { type: 'message_responded', via: 'text' });
  if (owned.signal.aborted) return reject('cancelled', 'the response was cancelled before validation');
  const input = respondInputOf(request);
  if (!input.ok) return input.rejection;
  const { messageRef, arm } = input.value;
  const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
  if (!identity.ok) return identity.rejection;
  // Rule W/M4: the message is in the sending line's workspace; the Run identity stays the Run's.
  const scopeProblem = scopeOfMessageRef(owned, messageRef, identity.session.workspaceId);
  if (scopeProblem !== null) return scopeProblem;
  const pins = pinsOf(input.value.expected, messageRef);
  if (!pins.ok) return pins.rejection;
  // The reason is the refusal's reply body; a `response` part is always held to the ordinary 16 KiB.
  const saved = normalizeText(arm.reject === true ? arm.reason : arm.text, SESSION_MESSAGE_MAX_TEXT_BYTES);
  if (!saved.ok) return saved.rejection;

  const derived = deriveWorkRunSender(mailbox, identity);
  if (!derived.ok) return derived.rejection;
  const sender = derived.sender;
  const senderIdentity = senderIdentityOf(sender);
  const identityKey = identityKeyOf('respond', owned, senderIdentity, input.value.requestId);
  const fingerprint = fingerprintOf('respond', owned, senderIdentity, { messageRef, ...arm }, input.value.expected);
  if (owned.signal.aborted) return reject('cancelled', 'the response was cancelled before the idempotency lookup');
  const existing = await mailbox.records.lookupCommit({ identityKey, fingerprint });
  if (existing.status === 'ready') return replayMessage(mailbox, existing.value);
  if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);
  const authorized = await authorizeNewWorkRunAction(mailbox, {
    owned, principal: owned.principal, operationToolName: 'respond_session_message',
  });
  return commitTextResponse(mailbox, owned, { requestId: input.value.requestId, messageRef, arm, text: saved.text,
    pins: pins.pins, sender, identityKey, fingerprint, authorized });
}

/**
 * 问答轮回复它收到的信：回复人是本轮 Session、QueryRun 和代数（不带 `answerRef`，正式答复另走 MSG-06）；
 * 收件人才能回（`ownsInbox`）；守本轮读到的 QueryRun 和 Session 版本和消息 CAS。身份只认字面 QueryRun，
 * 先查回执再解析；秘书请求轮也走这一口回普通来信（`allowRequestRound`），解析不出的照今天拒。回复槽归谁写
 * （这一轮的来源由这一轮的结论回）不在这里判。
 */
async function respondAsQueryRound(mailbox: MailboxContext, owned: Owned, queryRunRef: QueryRunRef,
  request: SessionMessageRespondInputV1):
  Promise<WriteResult<SessionMessage>> {
  if (owned.signal.aborted) return reject('cancelled', 'the response was cancelled before validation');
  const input = respondInputOf(request);
  if (!input.ok) return input.rejection;
  const { messageRef, arm } = input.value;
  const pins = pinsOf(input.value.expected, messageRef);
  if (!pins.ok) return pins.rejection;
  const saved = normalizeText(arm.reject === true ? arm.reason : arm.text, SESSION_MESSAGE_MAX_TEXT_BYTES);
  if (!saved.ok) return saved.rejection;
  const senderIdentity = { kind: 'query_run', queryRunRef: { ...queryRunRef } };
  const identityKey = identityKeyOf('respond', owned, senderIdentity, input.value.requestId);
  const fingerprint = fingerprintOf('respond', owned, senderIdentity, { messageRef, ...arm }, input.value.expected);
  if (owned.signal.aborted) return reject('cancelled', 'the response was cancelled before the idempotency lookup');
  const existing = await mailbox.records.lookupCommit({ identityKey, fingerprint });
  if (existing.status === 'ready') return replayMessage(mailbox, existing.value);
  if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);
  const routed = await nonRequestQueryRound(mailbox, owned, { allowRequestRound: true });
  if (!routed.ok) return routed.rejection;
  const round = routed.round;
  if (round === null) return principalRefusal(owned.principal, { type: 'message_responded', via: 'text' });
  // 副本不冒充原线，永不回复。
  if (round.readOnlyCopy) return reject('forbidden', 'a read-only copy never replies to a Session message');
  // C23: an independent reviewer never replies; its own send right is notify-only.
  if (round.duty === 'reviewer') return reject('forbidden', '独立审阅只发请知悉');
  // 问答轮收到的信在线的工作区（规则 W）。
  const scopeProblem = scopeOfMessageRef(owned, messageRef, round.lineWorkspaceId);
  if (scopeProblem !== null) return scopeProblem;
  const sender: MessageQueryRoundSender = { kind: 'query_run', sessionRef: { ...round.session },
    queryRunRef: { ...round.run }, generation: round.sessionGeneration };
  return commitTextResponse(mailbox, owned, { requestId: input.value.requestId, messageRef, arm, text: saved.text,
    pins: pins.pins, sender, identityKey, fingerprint, authorized: null, extraGuards: round.guards });
}

/**
 * §2.4: the owner-verified owner of this message's one reply slot. A trusted system round's source, a module-overlap
 * gate's saved note request (design 5.1: settled only by its note round, even before that round exists), a copy
 * question, a user card and a plain source whose deterministic planning Query already exists each keep their
 * own writer; only a message with none of those facts has the generic slot a text reply may fill. The caller's
 * `queryJobRef` is the same ordinary source Query the reply commit guards.
 */
async function replySlotOwnerOf(mailbox: MailboxContext, owned: Owned, message: SessionMessage,
  queryJobRef: ReturnType<typeof interventionPlanningQueryRefs>['queryJobRef']):
Promise<{ ok: true; slot: MessageResponseSlotV1 } | { ok: false; rejection: CoreRejection }> {
  const hostCtx = internalHostContext(mailbox, { ...owned, workspaceId: message.ref.workspaceId });
  // Design 2.2/2.6: the fixed sender only proposes a system round; the shared trusted read decides, so a forward copy
  // of a round's letter has the generic slot of its actual recipient.
  if (isSystemRoundSender(message.sender)) {
    const round = await mailbox.deps.systemRounds?.readSystemRoundSource(hostCtx, message);
    if (round === undefined) return { ok: true, slot: 'system' };
    if (round.status !== 'ready') return { ok: false, rejection: mapReadResult(round) as CoreRejection };
    if (round.value !== null) return { ok: true, slot: 'system' };
  }
  const gateNote = await mailbox.deps.gateNotes?.readGateNote(hostCtx, message);
  if (gateNote !== undefined && gateNote.status !== 'ready') {
    return { ok: false, rejection: mapReadResult(gateNote) as CoreRejection };
  }
  if (gateNote?.status === 'ready' && gateNote.value !== null) return { ok: true, slot: 'system' };
  if (message.answeredBy === 'copy') return { ok: true, slot: 'copy' };
  if (isUserRecipient(message.recipient) && message.decision !== undefined) return { ok: true, slot: 'card' };
  const sourceRead = await loadQueryJob(mailbox, owned, queryJobRef);
  if (sourceRead.status === 'ready') return { ok: true, slot: 'round' };
  if (sourceRead.status !== 'not_found') return { ok: false, rejection: mapReadResult(sourceRead) as CoreRejection };
  return { ok: true, slot: 'generic' };
}

/**
 * MSG-04/05 的读、判、写，做事轮和问答轮共用：准入没过就不读消息；回复人是收件人（`ownsInbox`）才收；
 * 守消息 CAS，加上调用方带来的守卫（做事轮的准入事实由状态机的效果带上，问答轮带它这一读窗的版本）。
 */
async function commitTextResponse(mailbox: MailboxContext, owned: Owned, input: {
  requestId: string; messageRef: SessionMessageRef; arm: RespondArm; text: string; pins: MessageGuardContext['pins'];
  sender: MessageWorkRunSender | MessageQueryRoundSender; identityKey: string; fingerprint: string;
  authorized: AuthOutcome | null; extraGuards?: readonly RecordGuard[];
}): Promise<WriteResult<SessionMessage>> {
  const { arm, sender, identityKey, fingerprint, authorized } = input;
  // MSG-04/05. A refused admission never reads the message.
  const read = authorized === null || authorized.ok
    ? await loadMessageForWrite(mailbox, owned, input.messageRef) : { ok: true as const, message: null };
  if (!read.ok) return read.rejection;
  const message = read.message;
  const current = message === null ? null : acceptedMessage(message);
  // 通用回复守消息版本（persist 的消息 CAS）和这条来源消息的普通来源 Query 不存在：普通来信开轮时
  // 守来源消息版本并确认尚无回复，回复提交守另一侧，两边不会同时成立。
  let ordinarySourceQuery: RecordGuard | null = null;
  let responseSlot: MessageResponseSlotV1 | null = null;
  if (current !== null) {
    const queryWorkspace = await queryWorkspaceOfMessage(mailbox, current);
    if (!queryWorkspace.ok) return queryWorkspace.rejection;
    const sourceQueryRef = interventionPlanningQueryRefs(current.ref, queryWorkspace.workspaceId).queryJobRef;
    ordinarySourceQuery = { refKey: canonicalRefKey(sourceQueryRef), expectedRevision: null };
    // §2.4: the same read names the slot's real owner, so a text reply to a round's source, a copy question, a
    // system-round source or a user card is refused by the machine's own slot rule (and a copy's changed binding is
    // `source_stale`).
    const slotOwner = await replySlotOwnerOf(mailbox, owned, current, sourceQueryRef);
    if (!slotOwner.ok) return slotOwner.rejection;
    responseSlot = slotOwner.slot;
  }
  const { decided, ctx: messageCtx } = judge(owned.principal, message,
    arm.reject === true
      ? { type: 'message_responded', via: 'text', rejected: true }
      : { type: 'message_responded', via: 'text' }, {
    workRunAuthorization: authorized === null ? null : authorized.ok ? 'ok' : authorized.rejection,
    callerIsRecipient: message === null ? null : ownsInbox(mailbox, sender.sessionRef, message),
    pins: input.pins,
    responseSlot,
    bodyBounded: true, // `normalizeText` held with the request
  });
  // See the acknowledgement: this exact identity's committed receipt is
  // restored instead of a second, conflicting rejection.
  if (!decided.ok) return refuse(mailbox, decided, messageCtx, identityKey, fingerprint);
  if (current === null) throw new Error('MSG-04/05 accepted a response to an absent message');
  return writeMessage(mailbox, decided, {
    owned, identityKey, fingerprint, requestId: input.requestId, actor: sender, admission: authorized,
    cancelled: 'the response was cancelled before commit',
    body: { messageRef: current.ref, text: input.text, answerSource: null },
    extraGuards: [...(input.extraGuards ?? []), ...(ordinarySourceQuery === null ? [] : [ordinarySourceQuery])],
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
  // Safety: an answer of another project is never associated. The workspace is not compared: a planning Query lives
  // in the workspace of the Goal its message names, and MSG-06's binding below proves the answer is this message's.
  if (answerRef.projectId !== owned.projectId) {
    return reject('forbidden', 'the Query answer ref is outside the bound project');
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
    // A copy question's changed binding is the guard failure `source_stale`; a line question keeps today's refusal.
    responseSlot: message !== null && message.answeredBy === 'copy' ? 'copy' : null,
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
  // Rule W/M4: the accepted input message belongs to the executing Session's workspace; the
  // execution identity stays the Run's or the Query's. The one fresh execution read also
  // supplies the facts below, so it is taken here and reused.
  let messageWorkspaceId = owned.workspaceId;
  let actualSession: SessionRef;
  let actualKernel: { adapterId: string; kernelSessionId: string; runId: string; turnId: string } | null | undefined;
  let consumedWait: ConsumedWaitV1 | null = null;
  if (executionRef['aggregateType'] === 'Run') {
    const runFacts = await readFreshWorkRunFacts(mailbox, owned, executionRef as unknown as RunRef);
    if (!runFacts.ok) return runFacts.rejection;
    const runRecord = runFacts.record;
    messageWorkspaceId = runRecord.session.workspaceId;
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
    // Rule W/M4: the accepted input message belongs to the claimed Session's
    // workspace, not the Query execution's. The QueryRef keeps its own scope;
    // the persistent claimed Session supplies the message workspace.
    const sessionRead = await mailbox.deps.sessions.readSession(
      internalHostContext(mailbox, owned), actualSession, 'project');
    if (sessionRead.status !== 'ready') return mapReadResult(sessionRead) as CoreRejection;
    messageWorkspaceId = sessionRead.value.record.workspaceId;
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
    // The same original event is identified independently of observing
    // actor/revision: an entry of another executionRef or Kernel position is
    // another event's; this event's own entry is the machine's duplicate.
    const accepted = (message.acceptedInputs ?? []).find(entry => entry.inputId === inputId);
    const intervention = consumedWait !== null && consumedWait.kind === 'intervention';
    // 默认回复处理线只认 work_run/secretary_round；agent `ask_person` 卡的发件线也可以是 query_run，
    // 卡答的接受身份按这条发件线核（`effectiveReplyHandler` 是唯一正本，这里只补它不收的 query_run 发件人）。
    const replyHandler = effectiveReplyHandler(message)
      ?? (message.sender.kind === 'query_run' ? message.sender.sessionRef : null);
    // A reply still bound to its original wait belongs to that wait, never to an intervention; an
    // ordinary asynchronous reply to this line records acceptance alone. The safe-point supply
    // applies the same predicate.
    const handlerHere = part === 'response'
      && replyHandler !== null
      && canonicalOf(replyHandler) === canonicalOf(actualSession)
      && !(intervention && replyStillBoundToWait(message));
    const waitBoundHere = !intervention && consumedWait !== null
      && (part === 'expiry' ? consumedWait.kind === 'expiry' : consumedWait.kind === 'wait_reply')
      && canonicalOf(consumedWait.messageRef) === canonicalOf(message.ref);
    // Only a wait actually bound to this execution, or a transferred wait this handler still owns
    // unconsumed, consumes the wait; an ordinary asynchronous or late reply records acceptance alone.
    boundHere = waitBoundHere || (handlerHere && replyStillBoundToWait(message));
    // A requeue on a line that continues the waiting one carries the Task's yielded wait (its claim admitted this
    // Session on the sender's continuation chain), so the bound wait is this execution's even though another Session
    // sent it. A wait whose reply handler was moved belongs to that handler alone (`handlerHere`).
    const boundUntransferred = waitBoundHere && (message.replyHandler ?? null) === null;
    facts = {
      observerOwnsExecution,
      kernelMatches: actualKernel !== undefined && actualKernel !== null
        && actualKernel.adapterId === kernel['adapterId'] && actualKernel.kernelSessionId === kernel['kernelSessionId']
        && actualKernel.runId === kernel['runId'] && actualKernel.turnId === kernel['turnId'],
      claimedSessionMatches: raw['executionSessionRef'] === undefined
        || canonicalOf(raw['executionSessionRef']) === canonicalOf(actualSession),
      executionSessionMatches: part === 'response'
        ? handlerHere || boundUntransferred
        : part === 'expiry'
          ? (message.sender.kind === 'work_run'
            && canonicalOf(message.sender.sessionRef) === canonicalOf(actualSession)) || boundUntransferred
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
  // 已答 agent `ask_person` 卡的接受提交守它自己的 `decision_answer` Query 还不存在（新 Query 从 revision 1 起，
  // 不能写 revision 0）；平台卡、普通回复不走这一支。
  let extraGuards: RecordGuard[] = [];
  if (part === 'response' && current.response !== null) {
    const cardRound = await decisionAnswerQueryOf(mailbox, current);
    if (!cardRound.ok) return cardRound.rejection;
    if (cardRound.queryJobRef !== null) {
      extraGuards = [{ refKey: canonicalRefKey(cardRound.queryJobRef), expectedRevision: null }];
    }
  }
  return writeMessage(mailbox, decided, {
    owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: null,
    cancelled: 'the input acceptance was cancelled before commit',
    body: null,
    ...(extraGuards.length === 0 ? {} : { extraGuards }),
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

/**
 * Design 2.3 (a card answer reaches the line once): whether an answered agent `ask_person` card's answer is already
 * taken by its own card-answer round. The card is read through the caller's own read admission, then its one
 * card-answer Query by key (`decisionAnswerQueryOf`, the key the acceptance above guards absent). Every read failure
 * is the failure.
 */
export async function readDecisionAnswerTaken(mailbox: MailboxContext, ctx: CoreCallContext,
  input: { messageRef: SessionMessageRef }): Promise<ReadResult<boolean>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  const card = await readMessage(mailbox, ctx, input.messageRef);
  if (card.status !== 'ready') return card;
  const cardRound = await decisionAnswerQueryOf(mailbox, card.value);
  if (!cardRound.ok) return cardRound.rejection;
  if (cardRound.queryJobRef === null) return { status: 'ready', value: false };
  const job = await loadQueryJob(mailbox, owned, cardRound.queryJobRef);
  if (job.status === 'not_found') return { status: 'ready', value: false };
  if (job.status !== 'ready') return mapReadResult(job) as CoreRejection;
  return { status: 'ready', value: true };
}

// ---- message.withdraw ---------------------------------------------------

/**
 * The withdraw's facts: the message, the caller's trusted sender facts (and,
 * for a Work Run, the fresh admission guards), and the recipient line's one
 * consistent open-execution read. The message's own state refusal is the
 * machine's, decided by `decideWithdraw`.
 */

async function readWithdrawFacts(mailbox: MailboxContext, owned: Owned, ref: SessionMessageRef,
  queryRound: QueryRoundV1 | null): Promise<{ status: 'ready'; facts: WithdrawFacts } | CoreRejection> {
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
    // `withdrawMessage` resolved this caller's round through `requiredQueryRound`, so a query_run caller has one.
    const round = queryRound!;
    // A trusted query round withdraws only a message its own line sent, whatever that round's sender kind
    // (`query_run` text or a request round's `secretary_round`). The commit carries this round's versions.
    if (round.readOnlyCopy) {
      return reject('forbidden', 'a read-only copy never withdraws a Session message');
    }
    const sentByLine = (message.sender.kind === 'query_run' || message.sender.kind === 'secretary_round')
      && sameSessionRefAs(message.sender.sessionRef, round.session);
    if (!sentByLine) {
      return reject('forbidden', 'a query round may withdraw only a message of its own line');
    }
    actor = message.sender;
    guards = round.guards;
  } else {
    const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    const derived = deriveWorkRunSender(mailbox, identity);
    if (!derived.ok) return derived.rejection;
    const authorized = await authorizeNewWorkRunAction(mailbox, {
      owned, principal: owned.principal, operationToolName: 'withdraw_session_message',
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
  // A message that needs no reply may cross workspaces and is then written in the recipient line's workspace;
  // its own record, not the sending line's workspace, says where it lives. An agent caller is checked
  // against the project here and against its trusted sending Session after the record is read; the Host
  // person keeps the workspace bound to the call.
  let queryRound: QueryRoundV1 | null = null;
  if (owned.principal.kind === 'query_run') {
    const routed = await requiredQueryRound(mailbox, owned);
    if (!routed.ok) return routed.rejection;
    queryRound = routed.round;
  }
  if (owned.principal.kind === 'host') {
    const scopeProblem = scopeOfMessageRef(owned, ref);
    if (scopeProblem !== null) return scopeProblem;
  } else if (ref.projectId !== owned.projectId) {
    return reject('invalid', 'the message ref is outside the bound project/workspace');
  }

  const withdrawCommand: WriteCommand<WithdrawFacts, WithdrawDecision, CoreRejection, SessionMessage, SessionMessage> = {
    operation: 'message.withdraw',
    scope: { projectId: owned.projectId, workspaceId: owned.workspaceId },
    principal: principalIdentity(owned.principal),
    commandId: write.requestId,
    fingerprintInput: { messageRef: ref },
    read: () => readWithdrawFacts(mailbox, owned, ref, queryRound),
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
