import { sameActorIdentity as sameActor } from '../../../contracts/actor-equality.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import { canonicalJson, canonicalOf, sha256Hex } from '../../../contracts/fingerprint.js';
import type { JsonValue } from '../../../contracts/fingerprint.js';
import { hostMessageId } from '../../../contracts/plan-round.js';
import type { CoreCallContext, MaterialReader } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import { QueryRunRefShape } from '../../../contracts/data-format-refs.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { MessageRecipient, SessionMessageRef, UserMessageRecipientV1 } from '../../../contracts/core/session-message.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { CoreError, CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { isPos as isPositiveInt, isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import type { QueryRunRef } from '../../../contracts/query-job.js';
import type { MessageQueryAnswerSender, MessageSender, SessionMailboxDependencies, SessionMessage } from '../model/communication-contracts.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type { SessionCard } from '../model/session-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { GoalRecordTransactionPort, RecordBatchRead, StoreResult } from '../../record-store/ports.js';
import type { ReadBatch } from '../tasks/plan-readers.js';
import { checkSessionMessageRef, decodeSessionMessageRecord, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';
import type { NoticeOriginWireV1 } from '../persistence/decision-record-codecs.js';
import { messageMachineStateOf, messagePinProblem, messagePrincipalProblem, transitionMessage } from '../state/message-machine.js';
import type { MessageEvent, MessageGuardContext, MessageTransition, SessionMessageEventType } from '../state/message-machine.js';
import type { Rejected } from '../state/transition.js';
import type { AtLeastCursor, HostActor, MailboxContext, MailboxPrincipal, MailboxScope, Owned, OwnedContext, OwnedWrite, Refused, SessionMessageStore, Unknown } from './mailbox-types.js';

/**
 * The historical mailbox paths here address a Session. This pure discriminator
 * narrows the `SessionRef | UserMessageRecipientV1` union without changing any
 * Session behaviour.
 */
export function isUserRecipient(recipient: MessageRecipient): recipient is UserMessageRecipientV1 {
  return 'kind' in recipient && recipient.kind === 'user';
}

export function isRunRef(value: unknown): boolean {
  return isObject(value) && value['aggregateType'] === 'Run'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}

export function isGoalRef(value: unknown): boolean {
  return isObject(value) && value['aggregateType'] === 'Goal'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']);
}

export function isRoleBindingRef(value: unknown): boolean {
  return isObject(value) && value['schemaVersion'] === 1
    && nonEmpty(value['bindingId']) && nonEmpty(value['templateId']) && nonEmpty(value['templateRevision'])
    && isPositiveInt(value['bindingVersion']) && nonEmpty(value['policyRevision']);
}

export function mapReadResult<T>(result: ReadResult<T>): ReadResult<T> | CoreRejection {
  if (result.status === 'not_found') return reject('not_found', 'the requested record does not exist');
  if (result.status === 'not_ready') return reject('incomplete', 'the requested record is not readable at the required watermark');
  return result.status === 'ready' ? result : result;
}

/**
 * The recipient line's three read-time facts (R7A1-09): `archived` is the lifecycle, `retired` the unavailable
 * health and `archiving` a pending archive request. A user recipient has no line; an absent or unreadable one is the
 * read's failure. One body: the mailbox's two call sites and the forward owner.
 */
export async function recipientLineFacts(deps: { sessions: Pick<SessionMailboxDependencies['sessions'], 'readSession'> },
  ctx: CoreCallContext, recipient: MessageRecipient): Promise<
  { ok: true; value: { archived: boolean; retired: boolean; archiving: boolean } } | { ok: false; rejection: CoreRejection }> {
  if (isUserRecipient(recipient)) return { ok: true, value: { archived: false, retired: false, archiving: false } };
  if (ctx.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the recipient Session read was cancelled') };
  let read: ReadResult<SessionCard>;
  try {
    read = await deps.sessions.readSession(ctx, {
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
    archiving: read.value.record.archiveRequest != null,
  } };
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
  if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
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
export async function preservedNoticeOrigin(records: Pick<GoalRecordTransactionPort, 'readMany'>, refKey: string): Promise<
  { ok: true; value: NoticeOriginWireV1 } | { ok: false; rejection: CoreRejection }> {
  let read: StoreResult<RecordBatchRead>;
  try {
    read = await records.readMany([refKey]);
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the notice origin could not be read') };
  }
  if (read.status !== 'ready') return { ok: false, rejection: sessionStoreFailureToRejection(read) };
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

/**
 * The context the resolver and the request-owner read see: the cloned,
 * validated identity and the original bound signal. The caller's original
 * object is never read again after `ownContext`.
 */
export function isolatedContext(owned: Owned): CoreCallContext {
  return {
    projectId: owned.projectId,
    workspaceId: owned.workspaceId,
    principal: structuredClone(owned.principal),
    materialReader: structuredClone(owned.reader),
    signal: owned.signal,
  };
}

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

export function ownWrite<T>(request: GraphWrite<T>): OwnedWrite<T> {
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

/** Send/respond text, kept on purpose: its capacity reason names the selected codec bound the machine cannot (`textBodyProblem`). */
export function normalizeText(raw: unknown, maxBytes: number): { ok: true; text: string } | { ok: false; rejection: CoreRejection } {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, rejection: reject('invalid', 'message text must be a non-empty string') };
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return { ok: false, rejection: reject('capacity', `message text exceeds ${maxBytes} UTF-8 bytes`) };
  }
  return { ok: true, text: raw };
}

export function normalizeMessageRef(raw: unknown): { ok: true; ref: SessionMessageRef } | { ok: false; reason: string } {
  const problem = checkSessionMessageRef(raw);
  if (problem !== null) return { ok: false, reason: problem };
  return { ok: true, ref: structuredClone(raw) as SessionMessageRef };
}

export function scopeOfMessageRef(owned: Owned, ref: SessionMessageRef): CoreRejection | null {
  if (ref.projectId !== owned.projectId || ref.workspaceId !== owned.workspaceId) {
    return reject('invalid', 'the message ref is outside the bound project/workspace');
  }
  return null;
}

/** A machine guard's refusal as today's rejection (§1.2: code and reason kept); `null` when it holds. */
export function guardRejection(problem: Rejected | null): CoreRejection | null {
  return problem === null || problem.ok ? null : reject(problem.code, problem.detail);
}

/** The row's first guard refusing a write's principal; the write compares the kind itself only to narrow its principal. */
export function principalRefusal(principal: MailboxPrincipal, event: Parameters<typeof messagePrincipalProblem>[0]): CoreRejection {
  const rejection = guardRejection(messagePrincipalProblem(event, principal.kind === 'query_run' ? 'other' : principal.kind));
  if (rejection === null) throw new Error(`the message machine admits the ${principal.kind} principal this write refused`);
  return rejection;
}

/**
 * The one version pin of ack, respond, MSG-06 and MSG-09: the machine's pin
 * guard, asked with the request before the receipt lookup. The row asks the
 * same facts again.
 */
export function pinsOf(expected: readonly VersionPin[], ref: SessionMessageRef):
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
export function admissionRefusalOf(refused: Refused, ctx: MessageGuardContext): CoreRejection | null {
  const admission = ctx.workRunAuthorization;
  if (admission === null || admission === 'ok') return null;
  return refused.reason === 'guard_failed' && refused.code === admission.code && refused.detail === admission.reason
    ? admission : null;
}

/** A machine refusal as the rejection today's service returned; a refused admission is its own rejection. */
export function refusalOf(refused: Refused, ctx: MessageGuardContext): CoreRejection {
  return admissionRefusalOf(refused, ctx) ?? reject(refused.code, refused.detail);
}

export const MIN_CURSOR: CommitCursor = makeCommitCursor(1);

export function cursorSequence(cursor: unknown): number | null {
  if (typeof cursor !== 'string') return null;
  try {
    return seqOfCommitCursor(cursor as CommitCursor);
  } catch {
    return null;
  }
}

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
export function messageSenderSessionOf(message: SessionMessage): SessionRef | null {
  if (message.sender.kind === 'work_run' || message.sender.kind === 'secretary_round') {
    return { projectId: message.sender.sessionRef.projectId, sessionId: message.sender.sessionRef.sessionId };
  }
  return null;
}

export function sameSessionRefAs(left: SessionRef | null, right: SessionRef | null): boolean {
  return left !== null && right !== null
    && left.projectId === right.projectId && left.sessionId === right.sessionId;
}

/** `followupOf`: an existing message between the same two Sessions, either direction. */
export function followupConnects(message: SessionMessage, sender: MessageSender, recipient: SessionRef): boolean {
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

/** An accepted MSG-03..09 change names an existing message (an absent one is `not_found`). */
export function acceptedMessage(message: SessionMessage | null): SessionMessage {
  if (message === null) throw new Error('the message machine accepted a change of an absent message');
  return message;
}

export function senderIdentityOf(sender: MessageSender | MessageQueryAnswerSender): Unknown {
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

export function identityKeyOf(operation: string, scope: MailboxScope, senderIdentity: Unknown, requestId: string): string {
  return `session-message-${operation}:` + sha256Hex(canonicalJson({
    operation, projectId: scope.projectId, workspaceId: scope.workspaceId, sender: senderIdentity, requestId,
  } as unknown as JsonValue));
}

export function fingerprintOf(operation: string, scope: MailboxScope, senderIdentity: Unknown, payload: Unknown, expected: readonly VersionPin[]): string {
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

export function messageIdOf(owned: Owned, senderIdentity: Unknown, requestId: string): string {
  // A Host send's id is P1's one formula (`hostMessageId`); the identity the
  // mailbox already built with `senderIdentityOf` has the same `{kind:'host',
  // actor}` shape, so the hash is never written a second time here.
  const hostActor = isObject(senderIdentity) && senderIdentity['kind'] === 'host' ? senderIdentity['actor'] : null;
  if (isObject(hostActor) && (hostActor['kind'] === 'human' || hostActor['kind'] === 'system') && nonEmpty(hostActor['id'])) {
    const actor = hostActor as { kind: 'human' | 'system'; id: string };
    const id = hostMessageId(owned, actor, requestId);
    if (id.status !== 'ready') throw new Error('the mailbox message id requires a non-empty request id');
    return id.value;
  }
  return 'session-message-' + sha256Hex(canonicalJson({
    projectId: owned.projectId, workspaceId: owned.workspaceId, sender: senderIdentity, requestId,
  } as unknown as JsonValue));
}

/** Each event's id under its write identity. */
export const EVENT_ID_SUFFIX: Record<SessionMessageEventType, string> = {
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
  SessionMessageExpired: 'expired',
  SessionMessageForwarded: 'forwarded',
  SessionMessageWaitDisposed: 'wait-disposed',
};

export function eventIdOf(identityKey: string, eventType: SessionMessageEventType): string {
  return sha256Hex(`${identityKey}|${EVENT_ID_SUFFIX[eventType]}`);
}

/** The internal platform body executor; never the command actor. */
export function hostWriterContext(deps: SessionMailboxDependencies, owned: Owned): CoreCallContext {
  const actor: HostActor = { kind: deps.systemActor.kind, id: deps.systemActor.id };
  return {
    projectId: owned.projectId,
    workspaceId: owned.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: owned.projectId, workspaceId: owned.workspaceId, actor: { ...actor } },
    signal: owned.signal,
  };
}

export function internalHostContext(mailbox: MailboxContext, owned: Owned): CoreCallContext {
  return hostWriterContext(mailbox.deps, owned);
}

/**
 * The page-base checks every paginated mailbox read shares, in order: the page
 * object, no extra fields, an integer limit 1..100. Each read supplies its own
 * exact texts; the raw cursor values are snapshotted here, synchronously.
 */
export function pageProblem(mailbox: MailboxContext, page: unknown, texts: {
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
export function atLeastCursorOf(mailbox: MailboxContext, rawAtLeast: unknown):
{ ok: true; atLeast: AtLeastCursor | undefined } | { ok: false; rejection: CoreRejection } {
  if (rawAtLeast === undefined) return { ok: true, atLeast: undefined };
  const seq = cursorSequence(rawAtLeast);
  if (seq === null) return { ok: false, rejection: reject('invalid', 'atLeastCursor is not a ledger commit cursor') };
  return { ok: true, atLeast: { seq, cursor: rawAtLeast as CommitCursor } };
}

// ---- canonical reads ----------------------------------------------------

export async function loadMessage(mailbox: MailboxContext, owned: Owned, ref: SessionMessageRef): Promise<ReadResult<SessionMessage>> {
  return readSessionMessageRecord(mailbox.records, owned.signal, ref);
}

/** A write's message read: absent is the machine's `not_found`; any other failure keeps today's rejection. */
export async function loadMessageForWrite(mailbox: MailboxContext, owned: Owned, ref: SessionMessageRef): Promise<
  { ok: true; message: SessionMessage | null } | { ok: false; rejection: CoreRejection }> {
  const loaded = await loadMessage(mailbox, owned, ref);
  if (loaded.status === 'ready') return { ok: true, message: loaded.value };
  if (loaded.status === 'not_found') return { ok: true, message: null };
  return { ok: false, rejection: mapReadResult(loaded) as CoreRejection };
}

export function presenceOf(mailbox: MailboxContext, batch: ReadBatch, key: string): 'present' | 'missing' | 'unaccounted' {
  if (batch.present.has(key)) return 'present';
  if (batch.missing.has(key)) return 'missing';
  return 'unaccounted';
}
export function mapBatchFailure(mailbox: MailboxContext, result: { code: CoreError; reason: string }): CoreRejection {
  return reject(result.code, result.reason);
}
