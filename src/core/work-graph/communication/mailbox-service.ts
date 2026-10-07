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
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { CoreCallContext, CorePrincipal, MaterialReader } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { PreparedTaskManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import { consultationQueryRefs } from '../../../contracts/query-job.js';
import type { QueryJobAnswerRef, QueryJobAnswerSnapshot, QueryJobRef, QueryJobSnapshot, QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { MessageQueryAnswerSender, MessageSender, MessageWorkRunSender, SessionMailboxDependencies, SessionMailboxPort, SessionMessage, SessionMessageStatus } from './contracts.js';
import { deriveSessionInputId } from './contracts.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../../contracts/ledger.js';
import { canonicalRefKey, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { checkPlainSessionRef, decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import type { GraphWrite } from '../sessions/contracts.js';
import type { RecordBatchRead, EncodedDomainEvent, EncodedRecord, PreparedCommit, RecordGuard, StoreFailure, StoreResult } from '../../record-store/ports.js';
import type { RecordLookupRequest } from '../../record-store/lookup-ports.js';
import type { TaskClaimOutbox } from '../tasks/claim-contracts.js';
import type { TaskExecutionRecord } from '../tasks/execution-read-contracts.js';
import { decodeDispatchOutboxEntry, dispatchOutboxRefKey } from '../tasks/claim-record-codecs.js';
import { readStoredManifest, recheckHostRoleAdmission } from '../tasks/execution-entry-service.js';
import { readBatch, type ReadBatch } from '../tasks/plan-readers.js';
import { decodeRun } from '../tasks/run-state-service.js';
import {
  SESSION_MESSAGE_BY_RECIPIENT_LOOKUP, SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP,
  SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP, SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP,
  SESSION_MESSAGE_CONTENT_TYPE, SESSION_MESSAGE_MAX_TEXT_BYTES,
  checkMessageSender, checkSessionMessageRef, decodeSessionMessageRecord,
  encodeSessionMessageReadEvent, encodeSessionMessageRecord, encodeSessionMessageRespondedEvent,
  encodeSessionMessageSentEvent, sessionMessageFromEvent, sessionMessageRefKey,
  encodeSessionMessageConsultationDerivedEvent, encodeSessionMessageInputAcceptedEvent, type SessionMessageEventV1,
} from './message-record-codecs.js';
import { decodeStoredMessageBody } from './message-body-envelope.js';
import {
  decodeQueryJobAnswerSnapshot, decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord,
} from '../queries/query-record-codecs.js';
import {
  createSessionMessageRecord, inputObserverProblem, messageMachineStateOf, messagePinProblem, messagePrincipalProblem,
  messageRecipientProjectProblem, messageSendFlagsProblem, nextSessionMessageRecord, transitionMessage,
  type MessageEffect, type MessageEvent, type MessageGuardContext, type MessageTransition, type QueryAnswerBinding,
  type SessionMessageEventType,
} from '../state/message-machine.js';
import { unreachable, type Rejected } from '../state/transition.js';

type Unknown = Record<string, unknown>;
/** `ownContext` admits only these two principals. */
type MailboxPrincipal = Extract<CorePrincipal, { kind: 'host' | 'work_run' }>;
type WorkRunPrincipal = Extract<CorePrincipal, { kind: 'work_run' }>;
type HostActor = Extract<CorePrincipal, { kind: 'host' }>['actor'];

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function isObject(value: unknown): value is Unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
function sameActor(left: unknown, right: unknown): boolean {
  return isObject(left) && isObject(right) && left['kind'] === right['kind'] && left['id'] === right['id'];
}
function isRunRef(value: unknown): boolean {
  return isObject(value) && value['aggregateType'] === 'Run'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}
function isRoleBindingRef(value: unknown): boolean {
  return isObject(value) && value['schemaVersion'] === 1
    && nonEmpty(value['bindingId']) && nonEmpty(value['templateId']) && nonEmpty(value['templateRevision'])
    && isPositiveInt(value['bindingVersion']) && nonEmpty(value['policyRevision']);
}
function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'invalid': return reject('invalid', failure.reason);
    case 'not_found': return reject('not_found', failure.reason);
    case 'idempotency_conflict': return reject('idempotency_conflict', failure.reason);
    case 'revision_conflict': {
      const current: VersionPin[] = [];
      for (const entry of failure.current) {
        if (entry.revision === null) continue;
        try {
          const ref = JSON.parse(entry.refKey) as unknown;
          if (isObject(ref)) current.push({ ref: ref as unknown as VersionPin['ref'], revision: entry.revision });
        } catch { /* an unreadable ref key is not a pin */ }
      }
      return reject('revision_conflict', failure.reason, current.length > 0 ? current : undefined);
    }
    case 'unique_conflict': return reject('revision_conflict', `${failure.reason} (the unique slot is held by another owner)`);
    case 'unsupported': return reject('unsupported', failure.reason);
    case 'corrupt': return reject('unavailable', `the record store reported damage: ${failure.reason}`);
    default: return reject('unavailable', failure.reason);
  }
}
function mapReadResult<T>(result: ReadResult<T>): ReadResult<T> | CoreRejection {
  if (result.status === 'not_found') return reject('not_found', 'the requested record does not exist');
  if (result.status === 'not_ready') return reject('incomplete', 'the requested record is not readable at the required watermark');
  return result.status === 'ready' ? result : result;
}
function dedupeGuards(guards: readonly RecordGuard[]): RecordGuard[] {
  const map = new Map<string, number | null>();
  for (const guard of guards) {
    const previous = map.get(guard.refKey);
    if (previous === undefined || (previous === null && guard.expectedRevision !== null)) {
      map.set(guard.refKey, guard.expectedRevision);
    }
  }
  return [...map].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision }));
}

// --------------------------------------------------------------------------
// Trusted call context
// --------------------------------------------------------------------------

type Owned = {
  ok: true;
  projectId: string;
  workspaceId: string;
  principal: MailboxPrincipal;
  reader: MaterialReader;
  signal: AbortSignal;
};
type OwnedContext = Owned | { ok: false; rejection: CoreRejection };

function ownContext(ctx: CoreCallContext): OwnedContext {
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
    return { ok: false, rejection: reject('unsupported', 'query_run mailbox access is not supported in this batch') };
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
  const rejection = guardRejection(messagePrincipalProblem(event, principal.kind));
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
function judge(principal: MailboxPrincipal, message: SessionMessage | null, event: MessageEvent,
  facts: Partial<Omit<MessageGuardContext, 'principal'>>): { decided: MessageTransition; ctx: MessageGuardContext } {
  const ctx: MessageGuardContext = {
    principal: principal.kind,
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
function refusalOf(refused: Refused, ctx: MessageGuardContext): CoreRejection {
  return admissionRefusalOf(refused, ctx) ?? reject(refused.code, refused.detail);
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
  const consultation = execution?.consultation;
  if (execution === undefined || execution.kind !== 'semantic_query' || consultation === undefined) {
    return { binding: 'not_consultation', answererSession: null };
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
 * The `append_event` event in today's key order (so the same bytes). Only a
 * `SessionMessageResponded` event may name a derived query_run Answer (MSG-06).
 */
function encodeMessageEvent(eventType: SessionMessageEventType, eventId: string, envelope: MessageEventEnvelope,
  actor: MessageSender | MessageQueryAnswerSender, message: SessionMessage): EncodedDomainEvent {
  if (eventType === 'SessionMessageResponded') {
    return encodeSessionMessageRespondedEvent({ eventId, eventType, ...envelope, actor, message });
  }
  if (actor.kind === 'query_run') throw new Error(`a ${eventType} event cannot name a query_run actor`);
  const event: Exclude<SessionMessageEventV1, { eventType: 'SessionMessageResponded' }> = { eventId, eventType, ...envelope, actor, message };
  switch (event.eventType) {
    case 'SessionMessageSent': return encodeSessionMessageSentEvent(event);
    case 'SessionMessageRead': return encodeSessionMessageReadEvent(event);
    case 'SessionMessageConsultationDerived': return encodeSessionMessageConsultationDerivedEvent(event);
    case 'SessionMessageInputAccepted': return encodeSessionMessageInputAcceptedEvent(event);
    default: return unreachable(event, 'message event');
  }
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
  return {
    kind: 'query_run',
    sessionRef: { ...sender.sessionRef },
    queryRunRef: { ...sender.queryRunRef },
    answerRef: { ...sender.answerRef },
    generation: sender.generation,
  };
}

function identityKeyOf(operation: string, owned: Owned, senderIdentity: Unknown, requestId: string): string {
  return `session-message-${operation}:` + sha256Hex(canonicalJson({
    operation, projectId: owned.projectId, workspaceId: owned.workspaceId, sender: senderIdentity, requestId,
  } as unknown as JsonValue));
}

function fingerprintOf(operation: string, owned: Owned, senderIdentity: Unknown, payload: Unknown, expected: readonly VersionPin[]): string {
  const pins = [...expected]
    .map((pin) => ({ ref: pin.ref, revision: pin.revision }))
    .sort((left, right) => {
      const leftKey = canonicalOf(left.ref) ?? '';
      const rightKey = canonicalOf(right.ref) ?? '';
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return sha256Hex(canonicalJson({
    operation, projectId: owned.projectId, workspaceId: owned.workspaceId, sender: senderIdentity, payload, expected: pins,
  } as unknown as JsonValue));
}

function messageIdOf(owned: Owned, senderIdentity: Unknown, requestId: string): string {
  return 'session-message-' + sha256Hex(canonicalJson({
    projectId: owned.projectId, workspaceId: owned.workspaceId, sender: senderIdentity, requestId,
  } as unknown as JsonValue));
}

/** Each event's id under its write identity. */
const EVENT_ID_SUFFIX: Record<SessionMessageEventType, string> = {
  SessionMessageSent: 'sent',
  SessionMessageRead: 'read',
  SessionMessageResponded: 'responded',
  SessionMessageConsultationDerived: 'consultation-derived',
  SessionMessageInputAccepted: 'input-accepted',
};

function eventIdOf(identityKey: string, eventType: SessionMessageEventType): string {
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
// The factory
// --------------------------------------------------------------------------

export function createSessionMailbox(deps: SessionMailboxDependencies): SessionMailboxPort & Required<Pick<SessionMailboxPort, 'respondFromQueryAnswer' | 'readOutbox'>> {
  const records = deps.records;
  const MIN_CURSOR: CommitCursor = makeCommitCursor(1);

  function internalHostContext(owned: Owned): CoreCallContext {
    const actor: HostActor = { kind: deps.systemActor.kind, id: deps.systemActor.id };
    return {
      projectId: owned.projectId,
      workspaceId: owned.workspaceId,
      principal: { kind: 'host', actor },
      materialReader: { kind: 'host', projectId: owned.projectId, workspaceId: owned.workspaceId, actor: { ...actor } },
      signal: owned.signal,
    };
  }

  function cursorSequence(cursor: unknown): number | null {
    if (typeof cursor !== 'string') return null;
    try {
      return seqOfCommitCursor(cursor as CommitCursor);
    } catch {
      return null;
    }
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
  function manifestAgainstRun(manifest: PreparedTaskManifestV1, record: TaskExecutionRecord, bodyDigest: string): CoreRejection | null {
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
    const authorization = run.executionAuthorization;
    if (authorization === undefined || authorization === null || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2) {
      return reject('forbidden', 'a new mailbox action requires a B2 V2 execution authorization');
    }
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
    if (lease === null || lease.holderRunId !== run.ref.runId || lease.attemptId !== run.attemptId) {
      return { ok: false, rejection: reject('forbidden', 'the TaskLease is not held by this exact Run and attempt') };
    }
    // A released lease keeps its historical holder/attempt IDs; it is not a live
    // owner and can never authorize fresh mail (the original exact receipt still
    // replays because replay returns before this admission check).
    if (lease.release !== undefined) {
      return { ok: false, rejection: reject('forbidden', 'the TaskLease has been released') };
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
    if (authorization === undefined || authorization === null || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2) {
      return { ok: false, rejection: reject('forbidden', 'a new mailbox action requires a B2 V2 execution authorization') };
    }
    if (authorization.phase !== 'entered' || authorization.sessionGeneration !== claim.generation) {
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
    const manifestProblem = manifestAgainstRun(manifest, record, stored.value.bodyDigest);
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
    return {
      ok: true,
      guards: dedupeGuards([
        { refKey: runKey, expectedRevision: run.revision },
        { refKey: sessionKey, expectedRevision: session.revision },
        { refKey: leaseKey, expectedRevision: lease.revision },
        ...hostRole.value.roleFacts.guards,
      ]),
    };
  }

  // ---- canonical reads ----------------------------------------------------

  async function loadMessage(owned: Owned, ref: SessionMessageRef): Promise<ReadResult<SessionMessage>> {
    if (owned.signal.aborted) return reject('cancelled', 'the message read was cancelled before the store read');
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

  /** A write's message read: absent is the machine's `not_found`; any other failure keeps today's rejection. */
  async function loadMessageForWrite(owned: Owned, ref: SessionMessageRef): Promise<
    { ok: true; message: SessionMessage | null } | { ok: false; rejection: CoreRejection }> {
    const loaded = await loadMessage(owned, ref);
    if (loaded.status === 'ready') return { ok: true, message: loaded.value };
    if (loaded.status === 'not_found') return { ok: true, message: null };
    return { ok: false, rejection: mapReadResult(loaded) as CoreRejection };
  }

  async function readWorkspaceSource(owned: Owned): Promise<{ ok: true; value: ArtifactRef['source'] } | { ok: false; rejection: CoreRejection }> {
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
    if (decoded.status !== 'decoded') return { ok: false, rejection: reject('unavailable', `the workspace source record is damaged: ${decoded.reason}`) };
    return { ok: true, value: { kind: 'workspace', refId: owned.workspaceId, revision: String(decoded.value.revision) } };
  }

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

    const recipient = { projectId: message.recipient.projectId, sessionId: message.recipient.sessionId };
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
    const { owned, sender, part, messageRef, text, sourceRef, expectedSource, bodyRequestId } = args;
    const envelope: Unknown = {
      schemaVersion: 1,
      projectId: messageRef.projectId,
      workspaceId: messageRef.workspaceId,
      messageId: messageRef.messageId,
      part,
      sender,
      text,
    };
    let body: string;
    try {
      body = canonicalJson(envelope as unknown as JsonValue);
    } catch {
      return { ok: false, rejection: reject('invalid', 'the message body envelope is not canonicalizable JSON') };
    }
    const systemCtx = internalHostContext(owned);
    if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the message body store was cancelled') };
    let stored: Awaited<ReturnType<SessionMailboxDependencies['materials']['storeArtifact']>>;
    try {
      stored = await deps.materials.storeArtifact(systemCtx, {
        contentType: SESSION_MESSAGE_CONTENT_TYPE,
        body,
        sources: [sourceRef],
        origin: {
          kind: 'platform_operation',
          projectId: owned.projectId,
          workspaceId: owned.workspaceId,
          requestId: bodyRequestId,
          actor: { kind: deps.systemActor.kind, id: deps.systemActor.id },
        },
      });
    } catch {
      return { ok: false, rejection: reject('unavailable', 'the message body store failed before completing') };
    }
    if (stored.status !== 'stored') {
      const code: CoreError = stored.code === 'size_exceeded' ? 'capacity' : stored.code === 'missing_source' ? 'invalid' : stored.code;
      return { ok: false, rejection: reject(code, `the message body was not stored: ${stored.reason}`) };
    }
    // Verify the real stored row before the metadata can be published. A
    // content-addressed store may return an earlier writer's exact ref/source;
    // the message is not source evidence, so the ACTUAL stored provenance is
    // accepted once it is a legal workspace provenance for this workspace.
    const verified = await verifyStoredBody(owned, stored.ref, body, expectedSource);
    if (!verified.ok) return { ok: false, rejection: verified.rejection };
    return { ok: true, ref: stored.ref };
  }

  async function verifyStoredBody(owned: Owned, ref: ArtifactRef, expectedBody: string,
    expectedSource?: ArtifactRef['source']): Promise<{ ok: true } | { ok: false; rejection: CoreRejection }> {
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
    const systemCtx = internalHostContext(owned);
    if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the message body verification was cancelled') };
    let opened: ReadResult<import('../../../contracts/artifact.js').ArtifactRecord>;
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
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return reject('unavailable', 'the mailbox receipt does not name exactly one event');
    }
    let located: StoreResult<{ cursor: CommitCursor; event: import('../../record-store/ports.js').EncodedDomainEvent }>;
    try {
      located = await records.eventAt(receipt.cursor);
    } catch {
      return reject('unavailable', 'the recorded mailbox event could not be read');
    }
    if (located.status !== 'ready') return mapStoreFailure(located);
    if (String(located.value.cursor) !== String(receipt.cursor)) {
      return reject('unavailable', 'the recorded mailbox event cursor disagrees with the receipt');
    }
    if (located.value.event.eventId !== receipt.eventIds[0]) {
      return reject('unavailable', 'the recorded mailbox event id disagrees with the receipt');
    }
    const decoded = sessionMessageFromEvent(located.value.event);
    if (decoded.status !== 'decoded') {
      return reject('unavailable', `the recorded mailbox event is not decodable: ${decoded.reason}`);
    }
    const message = decoded.value;
    const version = receipt.versions.find((entry) => entry.refKey === sessionMessageRefKey(message.ref));
    if (version === undefined || version.revision !== message.revision) {
      return reject('unavailable', 'the recorded mailbox event disagrees with the receipt revision');
    }
    return { status: 'committed', value: message, replayed: true, cursor: receipt.cursor };
  }

  /** Receipt-miss recovery uses only the same identity; it never re-runs business. */
  async function recheckAfterMiss(identityKey: string, fingerprint: string): Promise<WriteResult<SessionMessage> | null> {
    let again: StoreResult<Receipt>;
    try {
      again = await records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return reject('unavailable', 'the mailbox idempotency receipt could not be re-checked');
    }
    if (again.status === 'ready') return replayMessage(again.value);
    if (again.code !== 'not_found') return mapStoreFailure(again);
    return null;
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
    const message = record(at);
    if (canonicalOf(messageMachineStateOf(message)) !== canonicalOf(accepted.next)) {
      throw new Error('the written SessionMessage is not the state the message machine accepted');
    }
    const event = encodeMessageEvent(plan.eventType, eventIdOf(identityKey, plan.eventType), {
      schemaVersion: 1, occurredAt: at, projectId: owned.projectId, workspaceId: owned.workspaceId, requestId: write.requestId,
    }, write.actor, message);
    if (owned.signal.aborted) return reject('cancelled', write.cancelled);
    const guards: RecordGuard[] = [{ refKey: sessionMessageRefKey(message.ref), expectedRevision: plan.messageRevision }];
    if (plan.workRunFacts) {
      if (write.admission === null || !write.admission.ok) throw new Error('only an admitted work_run write guards its admission facts');
      guards.push(...write.admission.guards);
    }
    const prepared: PreparedCommit = {
      identityKey,
      fingerprint,
      guards: dedupeGuards(guards),
      records: [encodeSessionMessageRecord(message)],
      claims: [],
      indexGuards: [],
      indexChanges: [],
      events: [event],
    };
    let receipt: Awaited<ReturnType<SessionMailboxDependencies['records']['commit']>>;
    try {
      receipt = await records.commit(prepared);
    } catch {
      const restored = await recheckAfterMiss(identityKey, fingerprint);
      return restored ?? reject('unavailable', 'the mailbox commit failed before completing');
    }
    if (receipt.status !== 'committed') {
      const restored = await recheckAfterMiss(identityKey, fingerprint);
      return restored ?? mapStoreFailure(receipt);
    }
    if (receipt.replayed) return replayMessage(receipt);
    return { status: 'committed', value: message, replayed: false, cursor: receipt.cursor };
  }

  // ---- read authority -----------------------------------------------------

  function canReadMessage(sessionRef: SessionRef, message: SessionMessage): boolean {
    if (message.recipient.projectId === sessionRef.projectId && message.recipient.sessionId === sessionRef.sessionId) return true;
    return message.sender.kind === 'work_run'
      && message.sender.sessionRef.projectId === sessionRef.projectId
      && message.sender.sessionRef.sessionId === sessionRef.sessionId;
  }

  function ownsInbox(sessionRef: SessionRef, message: SessionMessage): boolean {
    return message.recipient.projectId === sessionRef.projectId && message.recipient.sessionId === sessionRef.sessionId;
  }

  // ---- sendMessage --------------------------------------------------------

  async function sendMessage(ctx: CoreCallContext, request: GraphWrite<{ recipient: SessionRef; text: string; replyMode?: 'wait'; intent?: 'notify' | 'inquiry' | 'action_request'; needsReply?: boolean; waitAfterSend?: boolean }>): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before validation');
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    const raw = write.input as unknown as Unknown | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'sendSessionMessage requires an input object');
    const recipientProblem = checkPlainSessionRef(raw['recipient']);
    if (recipientProblem !== null) return reject('invalid', `send recipient: ${recipientProblem}`);
    const recipient = structuredClone(raw['recipient']) as SessionRef;
    const projectRejection = guardRejection(messageRecipientProjectProblem(recipient.projectId === owned.projectId));
    if (projectRejection !== null) return projectRejection;
    const text = normalizeText(raw['text']);
    if (!text.ok) return text.rejection;
    const replyMode = raw['replyMode'];
    if (replyMode !== undefined && replyMode !== 'wait') {
      return reject('invalid', 'the send replyMode must be omitted or wait');
    }
    // Normalize the legacy `replyMode='wait'` into the explicit intent fields.
    // Omitted fields keep the exact historical fire-and-forget fingerprint.
    const intent = raw['intent'];
    if (intent !== undefined && intent !== 'notify' && intent !== 'inquiry' && intent !== 'action_request') {
      return reject('invalid', 'the send intent must be notify, inquiry or action_request');
    }
    const explicitNeedsReply = raw['needsReply'];
    if (explicitNeedsReply !== undefined && typeof explicitNeedsReply !== 'boolean') {
      return reject('invalid', 'the send needsReply must be a boolean');
    }
    const explicitWaitAfterSend = raw['waitAfterSend'];
    if (explicitWaitAfterSend !== undefined && typeof explicitWaitAfterSend !== 'boolean') {
      return reject('invalid', 'the send waitAfterSend must be a boolean');
    }
    const legacyWait = replyMode === 'wait';
    const waitAfterSend = explicitWaitAfterSend === true || (explicitWaitAfterSend === undefined && legacyWait);
    const needsReply = explicitNeedsReply === true || (explicitNeedsReply === undefined && (legacyWait || waitAfterSend));
    const sendFlags: NonNullable<MessageGuardContext['sendFlags']> = {
      needsReply, waitAfterSend, replyMode: replyMode ?? null, pinCount: write.expected.length,
    };
    const flagRejection = guardRejection(messageSendFlagsProblem(sendFlags));
    if (flagRejection !== null) return flagRejection;

    let sender: MessageSender;
    let workRunPrincipal: WorkRunPrincipal | null = null;
    if (owned.principal.kind === 'host') {
      sender = { kind: 'host', actor: { ...owned.principal.actor } };
    } else {
      const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
      if (!identity.ok) return identity.rejection;
      const derived = deriveWorkRunSender(identity);
      if (!derived.ok) return derived.rejection;
      sender = derived.sender;
      workRunPrincipal = owned.principal;
    }
    const senderIdentity = senderIdentityOf(sender);
    const identityKey = identityKeyOf('send', owned, senderIdentity, write.requestId);
    // The reply expectation is part of the request identity ONLY when it is
    // explicitly present: an omitted replyMode keeps the exact historical
    // fingerprint, so every existing fire-and-forget send replays unchanged.
    const fingerprint = fingerprintOf('send', owned, senderIdentity,
      { recipient, text: text.text,
        ...(replyMode === undefined ? {} : { replyMode }),
        ...(intent === undefined ? {} : { intent }),
        ...(explicitNeedsReply === undefined ? {} : { needsReply: explicitNeedsReply }),
        ...(explicitWaitAfterSend === undefined ? {} : { waitAfterSend: explicitWaitAfterSend }) }, write.expected);

    if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the idempotency lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    // MSG-02's fresh admission comes before the target Session read; a refused
    // admission never reads the target (the machine asks the admission first).
    let authorized: AuthOutcome | null = null;
    if (workRunPrincipal !== null) {
      authorized = await authorizeNewWorkRunAction({
        owned, principal: workRunPrincipal, operationToolName: 'send_session_message',
      });
    }

    // The target Session must exist in the same project/workspace. busy/archived
    // never blocks durable mail.
    let recipientScope: MessageGuardContext['recipientScope'] = null;
    if (authorized === null || authorized.ok) {
      if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the target Session read');
      const target = await deps.sessions.readSession(internalHostContext(owned), recipient);
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
    const { decided, ctx: messageCtx } = judge(owned.principal, null, { type: 'message_sent' }, {
      workRunAuthorization: authorized === null ? null : authorized.ok ? 'ok' : authorized.rejection,
      recipientScope,
      sendFlags,
    });
    if (!decided.ok) return refuse(decided, messageCtx, identityKey, fingerprint);
    const messageRef: SessionMessageRef = {
      aggregateType: 'SessionMessage', projectId: owned.projectId, workspaceId: owned.workspaceId,
      messageId: messageIdOf(owned, senderIdentity, write.requestId),
    };
    return writeMessage(decided, {
      owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: authorized,
      cancelled: 'the send was cancelled before commit',
      body: { messageRef, text: text.text, answerSource: null },
      record: (createdAt, bodyRef) => createSessionMessageRecord({
        ref: messageRef, sender, recipient, bodyRef, sourceRef: bodyRef.source, createdAt,
        replyMode: replyMode ?? null, intent: intent ?? null, needsReply, waitAfterSend,
      }),
    });
  }

  // ---- readMessage --------------------------------------------------------

  async function readMessage(ctx: CoreCallContext, ref: SessionMessageRef): Promise<ReadResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const normalized = normalizeMessageRef(ref);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
    if (scopeProblem !== null) return scopeProblem;
    const loaded = await loadMessage(owned, normalized.ref);
    if (loaded.status !== 'ready') return loaded;
    if (owned.principal.kind === 'host') return loaded;
    if (owned.principal.kind === 'work_run') {
      const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
      if (!identity.ok) return identity.rejection;
      const derived = deriveWorkRunSender(identity);
      if (!derived.ok) return derived.rejection;
      if (!canReadMessage(derived.sender.sessionRef, loaded.value)) {
        return reject('forbidden', 'this message is not addressed to or sent by the caller Session');
      }
      return loaded;
    }
    return reject('forbidden', 'the mailbox reader principal is not supported');
  }

  // ---- readMessageBody ----------------------------------------------------

  async function readMessageBody(ctx: CoreCallContext, input: { messageRef: SessionMessageRef; part: 'message' | 'response' }): Promise<ReadResult<import('./contracts.js').MessageBody>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
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
    if (owned.principal.kind === 'work_run') {
      const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
      if (!identity.ok) return identity.rejection;
      const derived = deriveWorkRunSender(identity);
      if (!derived.ok) return derived.rejection;
      if (!canReadMessage(derived.sender.sessionRef, message)) {
        return reject('forbidden', 'this message is not addressed to or sent by the caller Session');
      }
    } else if (owned.principal.kind !== 'host') {
      return reject('forbidden', 'the mailbox reader principal is not supported');
    }
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
    const decoded = decodeStoredMessageBody(message, part, opened.value);
    if ('reason' in decoded) return reject('unavailable', decoded.reason);
    return {
      status: 'ready',
      value: { messageRef: message.ref, part, text: decoded.text, sourceRef, usage: 'message' },
    };
  }

  // ---- readInbox ----------------------------------------------------------

  async function readInbox(ctx: CoreCallContext, input: {
    recipient: SessionRef;
    status?: SessionMessageStatus;
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
  }): Promise<ReadResult<{ items: SessionMessage[]; nextCursor: string | null; sourceCursor: CommitCursor }>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
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
    const page = raw['page'];
    if (!isObject(page)) return reject('invalid', 'readInbox requires a page object');
    if (Object.keys(page).some((key) => key !== 'limit' && key !== 'cursor' && key !== 'atLeastCursor')) {
      return reject('invalid', 'readInbox page does not accept extra fields');
    }
    const limit = page['limit'];
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reject('invalid', 'readInbox limit must be an integer between 1 and 100');
    }
    // Snapshot the complete page synchronously. No later await may re-read a
    // caller-mutable `page`; the decoded cursor below is the accepted one.
    const rawCursor = page['cursor'];
    const rawAtLeast = page['atLeastCursor'];
    if (rawCursor !== undefined && !nonEmpty(rawCursor)) {
      return reject('invalid', 'the inbox cursor must be a non-empty string');
    }
    let decodedCursor: InboxCursorV1 | null = null;
    if (rawCursor !== undefined) {
      decodedCursor = decodeInboxCursor(rawCursor);
      if (decodedCursor === null) return reject('invalid', 'the inbox cursor is not a valid continuation token');
      if (decodedCursor.projectId !== owned.projectId || decodedCursor.workspaceId !== owned.workspaceId
        || canonicalOf(decodedCursor.recipient) !== canonicalOf(recipient)
        || (decodedCursor.status ?? null) !== (status ?? null)) {
        return reject('invalid', 'the inbox cursor belongs to another scope, recipient or filter');
      }
    }
    let atLeastSeq: number | undefined;
    if (rawAtLeast !== undefined) {
      const parsed = cursorSequence(rawAtLeast);
      if (parsed === null) return reject('invalid', 'atLeastCursor is not a ledger commit cursor');
      atLeastSeq = parsed;
    }
    const after = decodedCursor?.after;

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
      return reject('forbidden', 'the mailbox reader principal is not supported');
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
      limit,
      ...(after === undefined ? {} : { after }),
    };
    let pageResult: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
    try {
      pageResult = await records.lookup(request);
    } catch {
      return reject('unavailable', 'the inbox lookup failed');
    }
    if (pageResult.status !== 'ready') return mapStoreFailure(pageResult);
    const readThrough = pageResult.value.readThrough;
    if (atLeastSeq !== undefined) {
      const observed = readThrough === null ? null : cursorSequence(readThrough);
      if (observed === null || observed < atLeastSeq) {
        return {
          status: 'not_ready',
          observed: readThrough === null ? null : { kind: 'platform', cursor: readThrough },
          required: { kind: 'platform', cursor: rawAtLeast as CommitCursor },
        };
      }
    }
    if (readThrough === null) {
      return { status: 'not_ready', observed: null, required: { kind: 'platform', cursor: MIN_CURSOR } };
    }
    const items: SessionMessage[] = [];
    for (const record of pageResult.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return reject('unavailable', `an inbox candidate is damaged: ${decoded.reason}`);
      const message = decoded.value;
      if (sessionMessageRefKey(message.ref) !== record.refKey
        || message.ref.projectId !== owned.projectId
        || message.ref.workspaceId !== owned.workspaceId
        || message.recipient.projectId !== owned.projectId
        || message.recipient.sessionId !== recipient.sessionId
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
    return { status: 'ready', value: { items, nextCursor, sourceCursor: readThrough } };
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
  }): Promise<ReadResult<{ items: SessionMessage[]; nextCursor: string | null; sourceCursor: CommitCursor }>> {
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
    const page = raw['page'];
    if (!isObject(page)) return reject('invalid', 'readOutbox requires a page object');
    if (Object.keys(page).some((key) => key !== 'limit' && key !== 'cursor' && key !== 'atLeastCursor')) {
      return reject('invalid', 'readOutbox page does not accept extra fields');
    }
    const limit = page['limit'];
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reject('invalid', 'readOutbox limit must be an integer between 1 and 100');
    }
    const rawCursor = page['cursor'];
    const rawAtLeast = page['atLeastCursor'];
    if (rawCursor !== undefined && !nonEmpty(rawCursor)) {
      return reject('invalid', 'the outbox cursor must be a non-empty string');
    }
    let decodedCursor: OutboxCursorV1 | null = null;
    if (rawCursor !== undefined) {
      decodedCursor = decodeOutboxCursor(rawCursor);
      if (decodedCursor === null) return reject('invalid', 'the outbox cursor is not a valid continuation token');
      if (decodedCursor.projectId !== owned.projectId || decodedCursor.workspaceId !== owned.workspaceId
        || canonicalOf(decodedCursor.senderRun ?? decodedCursor.senderSession) !== canonicalOf(senderRun ?? senderSession)) {
        return reject('invalid', 'the outbox cursor belongs to another scope or sender Run');
      }
    }
    let atLeastSeq: number | undefined;
    if (rawAtLeast !== undefined) {
      const parsed = cursorSequence(rawAtLeast);
      if (parsed === null) return reject('invalid', 'atLeastCursor is not a ledger commit cursor');
      atLeastSeq = parsed;
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
      limit,
      ...(after === undefined ? {} : { after }),
    };
    let pageResult: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
    try {
      pageResult = await records.lookup(request);
    } catch {
      return reject('unavailable', 'the outbox lookup failed');
    }
    if (pageResult.status !== 'ready') return mapStoreFailure(pageResult);
    const readThrough = pageResult.value.readThrough;
    if (atLeastSeq !== undefined) {
      const observed = readThrough === null ? null : cursorSequence(readThrough);
      if (observed === null || observed < atLeastSeq) {
        return {
          status: 'not_ready',
          observed: readThrough === null ? null : { kind: 'platform', cursor: readThrough },
          required: { kind: 'platform', cursor: rawAtLeast as CommitCursor },
        };
      }
    }
    if (readThrough === null) {
      return { status: 'not_ready', observed: null, required: { kind: 'platform', cursor: MIN_CURSOR } };
    }
    const items: SessionMessage[] = [];
    for (const record of pageResult.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return reject('unavailable', `an outbox candidate is damaged: ${decoded.reason}`);
      const message = decoded.value;
      if (sessionMessageRefKey(message.ref) !== record.refKey
        || message.ref.projectId !== owned.projectId
        || message.ref.workspaceId !== owned.workspaceId
        || message.sender.kind !== 'work_run'
        || (senderRun === undefined ? canonicalOf(message.sender.sessionRef) !== canonicalOf(senderSession)
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
    return { status: 'ready', value: { items, nextCursor, sourceCursor: readThrough } };
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

  async function respondMessage(ctx: CoreCallContext, request: GraphWrite<{ messageRef: SessionMessageRef; text: string }>): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.principal.kind !== 'work_run') return principalRefusal(owned.principal, { type: 'message_responded', via: 'text' });
    if (owned.signal.aborted) return reject('cancelled', 'the response was cancelled before validation');
    const write = ownWrite(request);
    if (!write.ok) return write.rejection;
    const raw = write.input as unknown as Unknown | null | undefined;
    if (!isObject(raw)) return reject('invalid', 'respondMessage requires an input object');
    const normalized = normalizeMessageRef(raw['messageRef']);
    if (!normalized.ok) return reject('invalid', normalized.reason);
    const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
    if (scopeProblem !== null) return scopeProblem;
    const text = normalizeText(raw['text']);
    if (!text.ok) return text.rejection;
    const pins = pinsOf(write.expected, normalized.ref);
    if (!pins.ok) return pins.rejection;

    const identity = await readWorkRunIdentity(owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    const derived = deriveWorkRunSender(identity);
    if (!derived.ok) return derived.rejection;
    const sender = derived.sender;
    const senderIdentity = senderIdentityOf(sender);
    const identityKey = identityKeyOf('respond', owned, senderIdentity, write.requestId);
    const fingerprint = fingerprintOf('respond', owned, senderIdentity, { messageRef: normalized.ref, text: text.text }, write.expected);
    if (owned.signal.aborted) return reject('cancelled', 'the response was cancelled before the idempotency lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);
    const authorized = await authorizeNewWorkRunAction({
      owned, principal: owned.principal, operationToolName: 'respond_session_message',
    });
    // MSG-04/05. A refused admission never reads the message.
    const read = authorized.ok ? await loadMessageForWrite(owned, normalized.ref) : { ok: true as const, message: null };
    if (!read.ok) return read.rejection;
    const message = read.message;
    const { decided, ctx: messageCtx } = judge(owned.principal, message, { type: 'message_responded', via: 'text' }, {
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
      body: { messageRef: current.ref, text: text.text, answerSource: null },
      record: (respondedAt, bodyRef) => nextSessionMessageRecord(current, {
        kind: 'responded', response: { sender, bodyRef, sourceRef: bodyRef.source, respondedAt },
      }),
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
        kind: 'responded', response: { sender, bodyRef, sourceRef: bodyRef.source, respondedAt },
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
        actualKernel = runFacts.record.run.executionHistory?.kernel
          ?? (authorization !== undefined && 'schemaVersion' in authorization && authorization.schemaVersion === 2 ? authorization.kernel : null);
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
          ? message.sender.kind === 'work_run' && canonicalOf(message.sender.sessionRef) === canonicalOf(actualSession)
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

  return { sendMessage, readMessage, readMessageBody, readInbox, readOutbox, ackMessage, respondMessage, respondFromQueryAnswer, recordConsultationDerivation, recordInputAccepted };
}
