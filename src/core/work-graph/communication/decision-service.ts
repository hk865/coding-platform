/**
 * Slice 5 §3.3 decision-message owner (F39).
 *
 * It owns the user's answer (`answerDecision`), the recorded application of an
 * answered decision (`recordDecisionApplication`) and the read-back of the
 * answer (`readDecisionAnswer`). The read/write order is the spec's: input and
 * operator first, the original receipt next, then the canonical source read
 * (through `DecisionSourceFactsPort`, never `views`), the Goal/pins and the
 * single response or the synthetic non-message slot, the pure state machine,
 * the body store and ONE message commit. A paused Goal never refuses the
 * answer; no Plan is applied here.
 */
import { sameActorIdentity as sameActor } from '../../../contracts/actor-equality.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext, CorePrincipal } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { MessageRecipient, SessionMessageRef, DecisionApplicationReceiptV1,
  DecisionApplicationV1, UserMessageResponseV1, DecisionHostSenderV1,
  DecisionMessageMetadataV1 } from '../../../contracts/core/session-message.js';
import type { DecisionAnnotationV1, DecisionObjectV1, DecisionOptionV1,
  DecisionSelectionV1, DecisionSourceV1, UserDecisionBodyV1 } from '../../../contracts/goal-decisions.js';
import { canonicalJson, canonicalOf, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { isNonNeg, isPos, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import type { RecordGuard, UniqueClaimChange } from '../../record-store/ports.js';
import type { DecisionMessagePort, DecisionMessageServiceDependencies, S5RecordPort } from '../model/decision-contracts.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import type { SessionMessageEventV1 } from '../model/communication-contracts.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { decodeDispatchOutboxEntry, dispatchOutboxRefKey } from '../tasks/claim-record-codecs.js';
import {
  bindMessageResponseCursor, createSyntheticDecisionAnswerRecord, messageMachineStateOf,
  nextSessionMessageRecord, transitionMessage, type MessageEvent, type MessageGuardContext,
  type MessageTransition, type SessionMessageRecord,
} from '../state/message-machine.js';
import { S5_DECISION_ANSWER_BY_SOURCE, decodeSessionMessageRecord,
  sessionMessageFromEvent, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import { decodeStoredUserDecisionBody, encodeUserDecisionBody } from '../sessions/message-body-envelope.js';
import { decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import { readSavedAnswerReaderSessions } from './decision-source-facts.js';
import type { ToolCommitLookup } from '../../../contracts/unknown-call-review.js';
import {
  recordDecisionApplicationInput, toolCommitLookupResult, toolCommitLookupUnknownTool, toolCommitRequestId,
} from '../model/tool-commit-arguments.js';

// -------------------------------------------------------------------------- //
// Small helpers                                                               //
// -------------------------------------------------------------------------- //

function mapStoreFailure(failure: { code: string; reason: string }): CoreRejection {
  switch (failure.code) {
    case 'not_found': return rejectedWithCurrent('not_found', failure.reason);
    case 'idempotency_conflict': return rejectedWithCurrent('idempotency_conflict', failure.reason);
    case 'revision_conflict': return rejectedWithCurrent('revision_conflict', failure.reason);
    case 'unique_conflict': return rejectedWithCurrent('revision_conflict', `${failure.reason} (the unique slot is held by another owner)`);
    case 'unsupported': return rejectedWithCurrent('unsupported', failure.reason);
    case 'corrupt': return rejectedWithCurrent('unavailable', failure.reason);
    default: return rejectedWithCurrent('unavailable', failure.reason);
  }
}

type ReadOutcome<T> = { ok: true; value: T } | { ok: false; rejection: CoreRejection };
function readOutcome<T>(result: ReadResult<T>): ReadOutcome<T> {
  if (result.status === 'ready') return { ok: true, value: result.value };
  if (result.status === 'not_found') return { ok: false, rejection: rejectedWithCurrent('not_found', 'the requested record does not exist') };
  if (result.status === 'not_ready') return { ok: false, rejection: rejectedWithCurrent('incomplete', 'the requested record is not readable at the required watermark') };
  return { ok: false, rejection: result };
}

type Owned = { projectId: string; workspaceId: string; principal: CorePrincipal; signal: AbortSignal };
function ownScope(ctx: CoreCallContext): Owned | CoreRejection {
  if (!isRecord(ctx) || !nonEmpty(ctx.projectId) || !nonEmpty(ctx.workspaceId)
    || !isRecord(ctx.principal) || !isRecord(ctx.signal)) {
    return rejectedWithCurrent('forbidden', 'the decision owner requires a trusted bound call context');
  }
  return { projectId: ctx.projectId, workspaceId: ctx.workspaceId, principal: ctx.principal, signal: ctx.signal };
}
function isOwned(value: Owned | CoreRejection): value is Owned {
  return 'projectId' in value;
}

function sameSession(left: SessionRef, right: SessionRef): boolean {
  return left.projectId === right.projectId && left.sessionId === right.sessionId;
}

/** The canonical facts `DecisionSourceFactsPort.readSource` returns. */
type SourceFacts = {
  source: DecisionSourceV1;
  goal: GoalSnapshot | null;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  guards: readonly RecordGuard[];
  closed: boolean;
  allowedReaderSessionRefs: SessionRef[];
};

const EVENT_ID_SUFFIX: Record<Parameters<typeof decisionEvent>[0], string> = {
  SessionMessageResponded: 'responded',
  SessionMessageDecisionAnswered: 'decision-answered',
  SessionMessageDecisionApplied: 'decision-applied',
};

function decisionEvent(eventType: 'SessionMessageResponded' | 'SessionMessageDecisionAnswered' | 'SessionMessageDecisionApplied',
  identityKey: string, requestId: string, owned: Owned, occurredAt: string,
  actor: ActorRef | DecisionHostSenderV1, message: SessionMessageRecord): SessionMessageEventV1 {
  const eventId = sha256Hex(`${identityKey}|${EVENT_ID_SUFFIX[eventType]}`);
  return {
    eventId, eventType, schemaVersion: 1, occurredAt,
    projectId: owned.projectId, workspaceId: owned.workspaceId, requestId, actor, message,
  } as SessionMessageEventV1;
}

function sortedPins(pins: readonly VersionPin[]): { ref: VersionPin['ref']; revision: number }[] {
  return [...pins].map((pin) => ({ ref: pin.ref, revision: pin.revision }))
    .sort((left, right) => {
      const leftKey = canonicalOf(left.ref) ?? '';
      const rightKey = canonicalOf(right.ref) ?? '';
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

type MessageIdentity = { kind: 'message'; messageRef: SessionMessageRef };
function messageIdentityOf(source: DecisionSourceV1): MessageIdentity | null {
  if (source.kind !== 'message') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.key);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['kind'] !== 'message' || !isRecord(parsed['messageRef'])) return null;
  return { kind: 'message', messageRef: parsed['messageRef'] as unknown as SessionMessageRef };
}

/**
 * Section F2 / §8.2 line 1366: the EXACT committed identity/fingerprint of a
 * `recordDecisionApplication` call. `recordDecisionApplication` and the
 * read-only `replayDecisionApplication` entry share this one function so an
 * identical retry derives the same idempotency key and restores the original
 * receipt. LB-2: the accepted message pin is the first-execution CAS only and
 * is NEVER part of the fingerprint — after the first commit the message
 * revision moved, so folding the pin in would turn a retry into an
 * `idempotency_conflict` instead of a replay.
 */
function applicationIdentity(scope: { projectId: string; workspaceId: string }, senderIdentity: JsonValue, requestId: string,
  messageRef: SessionMessageRef, receipt: DecisionApplicationReceiptV1): { identityKey: string; fingerprint: string } {
  const operation = 'decision-application';
  const identityKey = `session-message-${operation}:` + sha256Hex(canonicalJson({
    operation, projectId: scope.projectId, workspaceId: scope.workspaceId, sender: senderIdentity, requestId,
  } as unknown as JsonValue));
  const fingerprint = sha256Hex(canonicalJson({
    operation, projectId: scope.projectId, workspaceId: scope.workspaceId, sender: senderIdentity,
    payload: { messageRef, receipt },
  } as unknown as JsonValue));
  return { identityKey, fingerprint };
}

// -------------------------------------------------------------------------- //
// The service                                                                 //
// -------------------------------------------------------------------------- //

/**
 * The decision-message owner. It is exactly the frozen `DecisionMessagePort`
 * subset plus one additive, non-frozen read (`readDecisionMessagePin`) that the
 * `record_decision_application` tool uses to read the real message pin without
 * opening the answer body. The frozen port itself is unchanged.
 */
export type DecisionMessageService = Pick<DecisionMessagePort,
  'answerDecision' | 'recordDecisionApplication' | 'readDecisionAnswer'> & {
    readDecisionMessagePin: (ctx: CoreCallContext, input: { source: DecisionSourceV1 }) =>
      Promise<ReadResult<{ message: SessionMessage | null }>>;
    /**
     * Section F2: the read-only replay entry the `record_decision_application`
     * tool consults before any new business read. It uses the SAME identity and
     * fingerprint as `recordDecisionApplication`, so an identical retry returns
     * the original committed value/cursor (`replayed: true`) even after the
     * answer message revision moved. `replayed: null` is the distinct "no
     * original receipt" outcome. It only performs `lookupCommit` -> `eventAt`
     * and never reads the answer/source facts or writes.
     */
    replayDecisionApplication: (ctx: CoreCallContext, request: {
      input: { messageRef: SessionMessageRef; receipt: DecisionApplicationReceiptV1 };
      meta: { requestId: string };
    }) => Promise<ReadResult<{
      replayed: Extract<WriteResult<SessionMessage>, { status: 'committed' }> | null;
    }>>;
    /** K3 L4: the read-only committed-receipt lookup for `record_decision_application`. */
    lookupToolCommit: ToolCommitLookup;
  };

/** Builds the decision-message owner from the same RecordStore/material/message seam the mailbox uses. */
export function createDecisionMessageService(
  deps: DecisionMessageServiceDependencies,
): DecisionMessageService {
  const records = deps.records;
  type Receipt = Extract<Awaited<ReturnType<S5RecordPort['commit']>>, { status: 'committed' }>;

  function hostSender(): DecisionHostSenderV1 | null {
    return deps.operatorActor === undefined ? null : { kind: 'host', actor: { ...deps.operatorActor } };
  }
  function operatorMatches(owned: Owned): boolean {
    if (deps.operatorActor === undefined || owned.principal.kind !== 'host') return false;
    return sameActor(owned.principal.actor, deps.operatorActor) && !isAutomationActor(owned.principal.actor);
  }
  /** The read-free caller identity for the operation's idempotency key. */
  function callerSenderIdentity(owned: Owned): JsonValue {
    if (owned.principal.kind === 'host') {
      return { kind: 'host', actor: structuredClone(owned.principal.actor) } as unknown as JsonValue;
    }
    if (owned.principal.kind === 'work_run') {
      return { kind: 'agent', runRef: structuredClone(owned.principal.runRef) } as unknown as JsonValue;
    }
    if (owned.principal.kind === 'query_run') {
      return { kind: 'query_run', queryRunRef: structuredClone(owned.principal.queryRunRef) } as unknown as JsonValue;
    }
    return { kind: 'system', id: 'decision-application' } as unknown as JsonValue;
  }

  type CallerActorOutcome = { ok: true; actor: ActorRef | null } | { ok: false; rejection: CoreRejection };

  /**
   * §4.6 line 919 / S5-MSG-04: the SAME persisted associations
   * `plan-write-admission.ts:identifyDelegatedWriter` asserts for a delegated
   * Agent write — the outbox claim names this exact Run, lives in the bound
   * workspace and maps to a real, decodable Session. A mismatched persisted
   * outbox entry must never build an Agent actor id from another Run's claim.
   * Every check returns a read failure / refusal; `null` is a pass.
   */
  async function claimAssociationProblem(
    claim: { runRef: unknown; workspaceId: unknown; sessionRef: unknown },
    run: { ref: unknown }, owned: Owned,
  ): Promise<CoreRejection | null> {
    if (canonicalOf(claim.runRef) !== canonicalOf(run.ref)) {
      return rejectedWithCurrent('unavailable', 'the caller Run outbox association disagrees with the persisted Run');
    }
    if (claim.workspaceId !== owned.workspaceId) {
      return rejectedWithCurrent('forbidden', 'the caller Run outbox is scoped to another workspace');
    }
    const sessionRef = claim.sessionRef;
    if (!isRecord(sessionRef) || !nonEmpty(sessionRef['projectId']) || !nonEmpty(sessionRef['sessionId'])) {
      return rejectedWithCurrent('unavailable', 'the caller Run outbox claim carries no complete Session');
    }
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef as unknown as SessionRef));
    const sessionRead = await readOne(sessionKey);
    if (!sessionRead.ok) return sessionRead.rejection;
    if (sessionRead.record === null) {
      return rejectedWithCurrent('unavailable', 'the caller Run claim Session mapping changed');
    }
    const decoded = decodeSessionRecord(sessionRead.record);
    if (decoded.status !== 'decoded') {
      return rejectedWithCurrent('unavailable', `the caller Run claim Session is damaged: ${decoded.reason}`);
    }
    const session = decoded.value;
    if (session.ref.projectId !== sessionRef['projectId'] || session.ref.sessionId !== sessionRef['sessionId']) {
      return rejectedWithCurrent('unavailable', 'the caller Run claim Session mapping changed');
    }
    if (session.workspaceId !== claim.workspaceId) {
      return rejectedWithCurrent('forbidden', 'the caller Run claim Session is scoped to another workspace');
    }
    return null;
  }

  /**
   * §4.6 line 919 / S5-MSG-04: the real modifier is proven from its formal
   * admission — the same Run/outbox/Role/Session facts the Plan and requeue
   * owners use for an Agent write — never from "it can send a decision". This
   * read runs only after the original receipt lookup missed, so a replayed
   * receipt still returns before any new business read. A read failure is
   * returned, never folded into "not the modifier".
   */
  async function callerActor(owned: Owned): Promise<CallerActorOutcome> {
    if (owned.principal.kind === 'host') return { ok: true, actor: owned.principal.actor };
    if (owned.principal.kind !== 'work_run') return { ok: true, actor: null };
    const runRef = owned.principal.runRef;
    const runKey = canonicalOf(runRef);
    if (runKey === null) return { ok: false, rejection: rejectedWithCurrent('invalid', 'the caller Run ref is not canonicalizable JSON') };
    if (runRef.projectId !== owned.projectId) {
      return { ok: false, rejection: rejectedWithCurrent('forbidden', 'the Agent Run is outside the bound project scope') };
    }
    const runRead = await readOne(runKey);
    if (!runRead.ok) return runRead;
    if (runRead.record === null) return { ok: true, actor: null };
    const decodedRun = decodeRun(runRead.record);
    if (!decodedRun.ok) {
      return { ok: false, rejection: rejectedWithCurrent('unavailable', `the caller Run is damaged: ${decodedRun.reason}`) };
    }
    const run = decodedRun.value;
    if (run.ref.projectId !== owned.projectId || run.task.projectId !== owned.projectId) {
      return { ok: false, rejection: rejectedWithCurrent('forbidden', 'the Agent Run is scoped to another project') };
    }
    if (canonicalOf(run.roleBinding) !== canonicalOf(owned.principal.roleBinding)) {
      return { ok: false, rejection: rejectedWithCurrent('forbidden', 'the work-run Role binding disagrees with the persisted Run') };
    }
    const outboxKey = dispatchOutboxRefKey({
      aggregateType: 'DispatchOutboxEntry', projectId: run.task.projectId,
      goalId: run.task.goalId, taskId: run.task.taskId, attemptId: run.attemptId,
    });
    const outboxRead = await readOne(outboxKey);
    if (!outboxRead.ok) return outboxRead;
    if (outboxRead.record === null) return { ok: true, actor: null };
    const linked = decodeDispatchOutboxEntry(outboxRead.record);
    if (linked.status !== 'decoded') {
      return { ok: false, rejection: rejectedWithCurrent('unavailable', `the caller Run outbox is damaged: ${linked.reason}`) };
    }
    const associationProblem = await claimAssociationProblem(linked.value.claim, run, owned);
    if (associationProblem !== null) return { ok: false, rejection: associationProblem };
    const sessionRef = linked.value.claim.sessionRef;
    return { ok: true, actor: {
      kind: 'agent', id: 'session:' + sha256Hex(canonicalJson(sessionRef as unknown as JsonValue)), runRef: run.ref,
    } };
  }

  function decisionCtx(owned: Owned): CoreCallContext {
    if (owned.principal.kind === 'host') {
      return { projectId: owned.projectId, workspaceId: owned.workspaceId,
        principal: { kind: 'host', actor: { ...owned.principal.actor } },
        materialReader: { kind: 'host', projectId: owned.projectId, workspaceId: owned.workspaceId, actor: { ...owned.principal.actor } },
        signal: owned.signal };
    }
    if (owned.principal.kind === 'work_run') {
      return { projectId: owned.projectId, workspaceId: owned.workspaceId,
        principal: { kind: 'work_run', runRef: owned.principal.runRef, roleBinding: owned.principal.roleBinding },
        materialReader: { kind: 'run', requester: owned.principal.runRef },
        signal: owned.signal };
    }
    return { projectId: owned.projectId, workspaceId: owned.workspaceId,
      principal: { kind: 'host', actor: { kind: 'system', id: 'decision-owner' } },
      materialReader: { kind: 'host', projectId: owned.projectId, workspaceId: owned.workspaceId, actor: { kind: 'system', id: 'decision-owner' } },
      signal: owned.signal };
  }

  async function replayMessage(receipt: Receipt): Promise<WriteResult<SessionMessage>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return rejectedWithCurrent('unavailable', 'the decision receipt does not name exactly one event');
    }
    let located: Awaited<ReturnType<S5RecordPort['eventAt']>>;
    try {
      located = await records.eventAt(receipt.cursor);
    } catch {
      return rejectedWithCurrent('unavailable', 'the recorded decision event could not be read');
    }
    if (located.status !== 'ready') return mapStoreFailure(located);
    if (String(located.value.cursor) !== String(receipt.cursor) || located.value.event.eventId !== receipt.eventIds[0]) {
      return rejectedWithCurrent('unavailable', 'the recorded decision event disagrees with the receipt');
    }
    const decoded = sessionMessageFromEvent(located.value.event);
    if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the recorded event is not a SessionMessage event: ${decoded.reason}`);
    // Spec §2.3 L11: replay restores the first result's bound reply position
    // from the ORIGINAL receipt cursor; the recorded event still carries the
    // explicit pending `null`, so a hit must bind it before returning.
    return { status: 'committed', value: bindMessageResponseCursor(decoded.value, receipt.cursor), replayed: true, cursor: receipt.cursor };
  }

  async function recheckMiss(identityKey: string, fingerprint: string): Promise<WriteResult<SessionMessage> | null> {
    let again: Awaited<ReturnType<S5RecordPort['lookupCommit']>>;
    try {
      again = await records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return rejectedWithCurrent('unavailable', 'the decision receipt could not be re-checked');
    }
    if (again.status === 'ready') return replayMessage(again.value);
    if (again.code !== 'not_found') return mapStoreFailure(again);
    return null;
  }

  async function loadMessage(owned: Owned, ref: SessionMessageRef): Promise<ReadResult<SessionMessage>> {
    const key = canonicalOf(ref);
    if (key === null) return rejectedWithCurrent('invalid', 'the message ref is not canonicalizable JSON');
    if (ref.projectId !== owned.projectId || ref.workspaceId !== owned.workspaceId) {
      return rejectedWithCurrent('forbidden', 'the message ref is outside the bound project/workspace');
    }
    let read: Awaited<ReturnType<S5RecordPort['readMany']>>;
    try {
      read = await records.readMany([key]);
    } catch {
      return rejectedWithCurrent('unavailable', 'the message record could not be read');
    }
    if (read.status !== 'ready') return mapStoreFailure(read);
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) {
      return read.value.missing.includes(key) ? { status: 'not_found' }
        : rejectedWithCurrent('unavailable', 'the message read neither returned nor reported missing the record');
    }
    const decoded = decodeSessionMessageRecord(record);
    if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the message record is damaged: ${decoded.reason}`);
    return { status: 'ready', value: decoded.value };
  }

  // ---- §4.6 agent reader gate: the caller's real Run/Query Session -------

  type SessionOutcome = { ok: true; value: SessionRef | null } | { ok: false; rejection: CoreRejection };

  async function readOne(key: string): Promise<{ ok: true; record: import('../../record-store/ports.js').EncodedRecord | null } | { ok: false; rejection: CoreRejection }> {
    let read: Awaited<ReturnType<S5RecordPort['readMany']>>;
    try {
      read = await records.readMany([key]);
    } catch {
      return { ok: false, rejection: rejectedWithCurrent('unavailable', 'the caller Run/QueryRun could not be read') };
    }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined && !read.value.missing.includes(key)) {
      return { ok: false, rejection: rejectedWithCurrent('unavailable', 'the caller Run/QueryRun read neither returned nor reported missing the record') };
    }
    return { ok: true, record: record ?? null };
  }

  /**
   * A work_run's Session is the claim-linked Session of its real Run. It must
   * assert the SAME persisted Run/outbox/workspace/Session associations as
   * `identifyDelegatedWriter`, never trusting a mismatched outbox entry.
   */
  async function readRunSession(owned: Owned, runRef: RunRef): Promise<SessionOutcome> {
    const runKey = canonicalOf(runRef);
    if (runKey === null) return { ok: false, rejection: rejectedWithCurrent('invalid', 'the caller Run ref is not canonicalizable JSON') };
    if (!isRecord(runRef) || runRef.projectId !== owned.projectId) {
      return { ok: false, rejection: rejectedWithCurrent('forbidden', 'the Agent Run is outside the bound project scope') };
    }
    const runRead = await readOne(runKey);
    if (!runRead.ok) return runRead;
    if (runRead.record === null) return { ok: true, value: null };
    const decoded = decodeRun(runRead.record);
    if (!decoded.ok) return { ok: false, rejection: rejectedWithCurrent('unavailable', `the caller Run is damaged: ${decoded.reason}`) };
    const run = decoded.value;
    const outboxKey = dispatchOutboxRefKey({
      aggregateType: 'DispatchOutboxEntry', projectId: run.task.projectId,
      goalId: run.task.goalId, taskId: run.task.taskId, attemptId: run.attemptId,
    });
    const outboxRead = await readOne(outboxKey);
    if (!outboxRead.ok) return outboxRead;
    if (outboxRead.record === null) return { ok: true, value: null };
    const linked = decodeDispatchOutboxEntry(outboxRead.record);
    if (linked.status !== 'decoded') {
      return { ok: false, rejection: rejectedWithCurrent('unavailable', `the caller Run outbox is damaged: ${linked.reason}`) };
    }
    const associationProblem = await claimAssociationProblem(linked.value.claim, run, owned);
    if (associationProblem !== null) return { ok: false, rejection: associationProblem };
    return { ok: true, value: linked.value.claim.sessionRef };
  }

  async function callerReaderSession(owned: Owned): Promise<SessionOutcome> {
    if (owned.principal.kind === 'work_run') return readRunSession(owned, owned.principal.runRef);
    return { ok: true, value: null };
  }

  /**
   * §4.6 line 915: the saved answer body is a platform-operation artifact, so
   * the material open uses the same internal platform Host reader the mailbox's
   * own body read uses. The caller's real principal is KEPT for the reader gate:
   * only the material open is delegated to the platform executor.
   */
  function materialHostContext(owned: Owned): CoreCallContext {
    const actor = { kind: 'system' as const, id: 'decision-read' };
    return {
      projectId: owned.projectId, workspaceId: owned.workspaceId,
      principal: { kind: 'host', actor },
      materialReader: { kind: 'host', projectId: owned.projectId, workspaceId: owned.workspaceId, actor: { ...actor } },
      signal: owned.signal,
    };
  }

  function messageMachinePins(expected: readonly VersionPin[], ref: SessionMessageRef): NonNullable<MessageGuardContext['pins']> {
    const matching = expected.filter((pin) => canonicalOf(pin.ref) === canonicalOf(ref));
    const pin = matching.length === 1 ? matching[0] : undefined;
    return {
      count: matching.length,
      matchesMessage: pin !== undefined,
      revision: pin !== undefined && isPos(pin.revision) ? pin.revision : null,
    };
  }

  /**
   * K3 L18 / ruling 8: the source kinds whose card requires an option. A
   * text-only answer (`{kind:'other'}`) is `invalid` for them and writes
   * nothing; every other kind keeps the slice-5 rule. B3 adds its kind here.
   */
  const OPTION_REQUIRED_SOURCE_KINDS: ReadonlySet<DecisionSourceV1['kind']> =
    new Set<DecisionSourceV1['kind']>(['unknown_call_review']);

  function validSelection(kind: DecisionSourceV1['kind'], options: readonly DecisionOptionV1[],
    selection: DecisionSelectionV1): boolean {
    if (kind === 'goal_conflict') {
      return selection.kind === 'conflict_wait' || selection.kind === 'conflict_order' || selection.kind === 'conflict_parallel';
    }
    if (selection.kind === 'other') return !OPTION_REQUIRED_SOURCE_KINDS.has(kind);
    if (selection.kind !== 'option') return false;
    return options.some((option) => option.id === selection.optionId);
  }

  /**
   * SPEC §3.3 line 625: the caller's `meta.expected` must be EXACTLY the pin set
   * of the answer (the message card's own pin + the captured source pins, or a
   * non-message card's source pins). Duplicate, foreign, missing or extra pins,
   * or non-positive/decimal revisions, are `invalid`; only then are the accepted
   * pins compiled into the commit guards.
   */
  function pinIdentity(pin: VersionPin): string | null {
    // §2.1: revision 0 is the legal absence pin of a non-stored aggregate (Task).
    if (!isRecord(pin) || !isRecord(pin.ref) || !isNonNeg(pin.revision)) return null;
    const refKey = canonicalOf(pin.ref);
    return refKey === null ? null : `${refKey}#${String(pin.revision)}`;
  }

  function pinInScope(pin: VersionPin, owned: Owned): boolean {
    if (!isRecord(pin.ref)) return false;
    const ref = pin.ref as Record<string, unknown>;
    const projectId = ref['projectId'];
    const workspaceId = ref['workspaceId'];
    if (typeof projectId === 'string' && projectId !== owned.projectId) return false;
    if (typeof workspaceId === 'string' && workspaceId !== owned.workspaceId) return false;
    return true;
  }

  function exactPinSet(actual: readonly VersionPin[], required: readonly VersionPin[], owned: Owned): CoreRejection | null {
    if (actual.length !== required.length) {
      return rejectedWithCurrent('invalid', 'the accepted decision pins are not exactly the captured source pins');
    }
    const left: string[] = [];
    for (const pin of actual) {
      const identity = pinIdentity(pin);
      if (identity === null || !pinInScope(pin, owned)) {
        return rejectedWithCurrent('invalid', 'a decision pin is not a complete same-scope positive-integer version pin');
      }
      left.push(identity);
    }
    const right = required.map((pin) => pinIdentity(pin) ?? '');
    left.sort();
    right.sort();
    if (left.some((value, index) => value !== right[index])) {
      return rejectedWithCurrent('invalid', 'the accepted decision pins are not exactly the captured source pins');
    }
    return null;
  }

  /** §3.3 line 625: an application accepts exactly one pin — the original message pin. */
  function exactMessagePin(actual: readonly VersionPin[], ref: SessionMessageRef, owned: Owned): CoreRejection | null {
    if (actual.length !== 1) {
      return rejectedWithCurrent('invalid', 'an application accepts exactly the original message pin');
    }
    const pin = actual[0]!;
    if (pinIdentity(pin) === null || !pinInScope(pin, owned)
      || canonicalOf(pin.ref) !== canonicalOf(ref) || pin.revision < 1) {
      return rejectedWithCurrent('invalid', 'an application accepts exactly the original message pin');
    }
    return null;
  }

  function annotationsFromObjects(objects: readonly DecisionObjectV1[], annotations: readonly DecisionAnnotationV1[]): boolean {
    const keys = new Set(objects.map((object) => canonicalOf(object)));
    return annotations.every((annotation) => isRecord(annotation) && nonEmpty(annotation.objectKey)
      && typeof annotation.text === 'string' && keys.has(annotation.objectKey));
  }

  function annotationsProblem(annotations: readonly DecisionAnnotationV1[]): CoreRejection | null {
    if (!Array.isArray(annotations) || annotations.length > 32) {
      return rejectedWithCurrent('invalid', 'a user decision answer carries too many annotations');
    }
    let total = 0;
    for (const annotation of annotations) {
      if (!isRecord(annotation) || !nonEmpty(annotation.objectKey) || typeof annotation.text !== 'string') {
        return rejectedWithCurrent('invalid', 'a decision annotation must carry objectKey and text');
      }
      const bytes = Buffer.byteLength(annotation.text, 'utf8');
      if (bytes > 2048) return rejectedWithCurrent('capacity', 'a decision annotation exceeds 2048 UTF-8 bytes');
      total += bytes;
    }
    return total > 16 * 1024 ? rejectedWithCurrent('capacity', 'the decision annotations exceed 16 KiB') : null;
  }

  function requiresApplicationFor(kind: DecisionSourceV1['kind'], options: readonly DecisionOptionV1[],
    selection: DecisionSelectionV1): boolean {
    if (kind === 'goal_conflict' || selection.kind === 'other') return true;
    if (selection.kind !== 'option') return true;
    const option = options.find((candidate) => candidate.id === selection.optionId);
    return option === undefined || option.effect === 'apply';
  }

  function judge(owned: Owned, message: SessionMessage | null, event: MessageEvent,
    facts: Partial<Omit<MessageGuardContext, 'principal'>>): { decided: MessageTransition; ctx: MessageGuardContext } {
    const principal: MessageGuardContext['principal'] = owned.principal.kind === 'host' || owned.principal.kind === 'work_run'
      ? owned.principal.kind : 'other';
    const guardCtx: MessageGuardContext = {
      principal, workRunAuthorization: null, callerIsRecipient: null, recipientScope: null,
      sendFlags: null, pins: { count: 0, matchesMessage: false, revision: null }, bodyBounded: null,
      queryAnswer: null, inputAccepted: null, consumedWait: null, ...facts,
    };
    return { decided: transitionMessage(messageMachineStateOf(message), event, guardCtx), ctx: guardCtx };
  }

  function admissionRefusalOf(refused: Extract<MessageTransition, { ok: false }>,
    messageCtx: MessageGuardContext): CoreRejection | null {
    const admission = messageCtx.workRunAuthorization;
    if (admission === null || admission === 'ok') return null;
    return refused.reason === 'guard_failed' && refused.code === admission.code && refused.detail === admission.reason
      ? admission : null;
  }

  async function refuseDecision(refused: Extract<MessageTransition, { ok: false }>, messageCtx: MessageGuardContext,
    identityKey: string, fingerprint: string): Promise<WriteResult<SessionMessage>> {
    const admission = admissionRefusalOf(refused, messageCtx);
    if (refused.code === 'invalid' || admission !== null) {
      const restored = await recheckMiss(identityKey, fingerprint);
      if (restored !== null) return restored;
    }
    return admission ?? rejectedWithCurrent(refused.code, refused.detail);
  }

  async function findAnswerForSource(owned: Owned, source: DecisionSourceV1): Promise<ReadOutcome<SessionMessage | null>> {
    let page: Awaited<ReturnType<S5RecordPort['lookup']>>;
    try {
      page = await records.lookup({
        index: S5_DECISION_ANSWER_BY_SOURCE,
        values: [owned.projectId, owned.workspaceId, source.kind, source.key],
        limit: 25,
      });
    } catch {
      return { ok: false, rejection: rejectedWithCurrent('unavailable', 'the decision answer index could not be read') };
    }
    if (page.status !== 'ready') return { ok: false, rejection: mapStoreFailure(page) };
    for (const record of page.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      // §4.6: a record that EXISTS but cannot be decoded is a read failure, not
      // an absent answer. Silently skipping it would drop the real saved answer
      // and make the caller fall back to `readSource`, which cannot see the
      // answered source anymore (`not_found` instead of `unavailable`).
      if (decoded.status !== 'decoded') {
        return { ok: false, rejection: rejectedWithCurrent('unavailable', `a decision answer record is damaged: ${decoded.reason}`) };
      }
      const message = decoded.value;
      if (message.decision?.syntheticAnswer !== true || message.status !== 'responded') continue;
      if (message.response !== null && 'decision' in message.response) return { ok: true, value: message };
    }
    return { ok: true, value: null };
  }

  async function persistDecisionMessage(owned: Owned, input: {
    before: SessionMessage | null; next: SessionMessageRecord; event: SessionMessageEventV1;
    guards: readonly RecordGuard[]; claims: readonly UniqueClaimChange[];
    identityKey: string; fingerprint: string; requestId: string; expected: readonly VersionPin[];
  }): Promise<WriteResult<SessionMessage>> {
    return deps.messageWrites.persist(decisionCtx(owned), {
      input: { before: input.before, next: input.next, event: input.event, guards: input.guards, claims: input.claims },
      meta: { requestId: input.requestId, expected: input.expected },
      identityKey: input.identityKey,
      fingerprint: input.fingerprint,
    });
  }

  // ---- answerDecision -----------------------------------------------------

  async function answerDecision(ctx: CoreCallContext, request: {
    input: { source: DecisionSourceV1; selection: DecisionSelectionV1; text: string; annotations: DecisionAnnotationV1[] };
    meta: { requestId: string; expected: VersionPin[] };
  }): Promise<WriteResult<SessionMessage>> {
    const owned = ownScope(ctx);
    if (!isOwned(owned)) return owned;
    const raw = request as unknown as Record<string, unknown> | null | undefined;
    if (!isRecord(raw) || !isRecord(raw['meta']) || !nonEmpty(raw['meta']['requestId'])
      || !Array.isArray(raw['meta']['expected']) || !isRecord(raw['input'])) {
      return rejectedWithCurrent('invalid', 'answerDecision requires an input object and meta.requestId/expected');
    }
    const input = raw['input'];
    const source = input['source'];
    const selection = input['selection'];
    const text = input['text'];
    const annotations = input['annotations'];
    if (!isRecord(source) || !nonEmpty(source['key']) || !nonEmpty(source['kind'])) {
      return rejectedWithCurrent('invalid', 'answerDecision requires a decision source');
    }
    if (!isRecord(selection) || !nonEmpty(selection['kind'])) return rejectedWithCurrent('invalid', 'answerDecision requires a selection');
    const decisionSelection = selection as unknown as DecisionSelectionV1;
    if (typeof text !== 'string') return rejectedWithCurrent('invalid', 'answerDecision requires the answer text');
    if (Buffer.byteLength(text, 'utf8') > 16 * 1024) return rejectedWithCurrent('capacity', 'the answer text exceeds 16384 UTF-8 bytes');
    if (!Array.isArray(annotations)) return rejectedWithCurrent('invalid', 'answerDecision requires the annotation list');
    const annotationProblem = annotationsProblem(annotations as DecisionAnnotationV1[]);
    if (annotationProblem !== null) return annotationProblem;
    if (owned.signal.aborted) return rejectedWithCurrent('cancelled', 'the answer was cancelled before validation');
    const sender = hostSender();
    if (sender === null) return rejectedWithCurrent('unsupported', 'no configured operator can answer a decision card');
    if (!operatorMatches(owned)) return rejectedWithCurrent('forbidden', 'only the configured operator may answer a user decision card');

    const decisionSource = source as unknown as DecisionSourceV1;
    const identity = messageIdentityOf(decisionSource);
    const operation = identity === null ? 'decision-synthetic-answer' : 'decision-answer';
    const senderIdentity = { kind: 'host', actor: { ...sender.actor } };
    const requestId = raw['meta']['requestId'] as string;
    const expected = raw['meta']['expected'] as VersionPin[];
    const identityKey = `session-message-${operation}:` + sha256Hex(canonicalJson({
      operation, projectId: owned.projectId, workspaceId: owned.workspaceId, sender: senderIdentity, requestId,
    } as unknown as JsonValue));
    const fingerprint = sha256Hex(canonicalJson({
      operation, projectId: owned.projectId, workspaceId: owned.workspaceId, sender: senderIdentity,
      payload: { source: decisionSource, selection, text, annotations }, expected: sortedPins(expected),
    } as unknown as JsonValue));
    if (owned.signal.aborted) return rejectedWithCurrent('cancelled', 'the answer was cancelled before the idempotency lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    const factsRead = await deps.sources.readSource(ctx, decisionSource);
    if (factsRead.status !== 'ready') {
      const outcome = readOutcome(factsRead);
      if (!outcome.ok) return outcome.rejection;
      throw new Error('unreachable: a ready source read produced an outcome');
    }
    const facts: SourceFacts = factsRead.value;

    if (identity !== null) {
      return answerMessageCard(owned, sender, decisionSource, decisionSelection, text,
        annotations as DecisionAnnotationV1[], facts, identityKey, fingerprint, requestId, expected);
    }
    return answerSyntheticCard(owned, sender, decisionSource, decisionSelection, text,
      annotations as DecisionAnnotationV1[], facts, identityKey, fingerprint, requestId, expected);
  }

  async function answerMessageCard(owned: Owned, sender: DecisionHostSenderV1, source: DecisionSourceV1,
    selection: DecisionSelectionV1, text: string, annotations: DecisionAnnotationV1[], facts: SourceFacts,
    identityKey: string, fingerprint: string, requestId: string, expected: readonly VersionPin[]): Promise<WriteResult<SessionMessage>> {
    const identity = messageIdentityOf(source);
    if (identity === null) throw new Error('answerMessageCard requires a message source');
    const loaded = readOutcome(await loadMessage(owned, identity.messageRef));
    if (!loaded.ok) return loaded.rejection;
    const message = loaded.value;
    if (message.decision === undefined || message.decision.syntheticAnswer || message.intent !== 'decision_request') {
      return rejectedWithCurrent('invalid', 'the decision source message is not an answerable user decision card');
    }
    // §3.3 line 625: the message card accepts exactly its own current pin plus
    // the captured source pins, and nothing else.
    const pinProblem = exactPinSet(expected,
      [{ ref: message.ref, revision: message.revision }, ...facts.source.pins], owned);
    if (pinProblem !== null) return pinProblem;
    if (!validSelection(source.kind, facts.options, selection)) {
      return rejectedWithCurrent('invalid', 'the answer names neither a stored option nor the explicit other selection');
    }
    if (!annotationsFromObjects(facts.objects, annotations)) {
      return rejectedWithCurrent('invalid', 'an annotation names an object outside the card');
    }
    const pins = messageMachinePins(expected, message.ref);
    const { decided, ctx: messageCtx } = judge(owned, message, { type: 'user_decision_answered' }, {
      decisionAnswer: {
        operatorMatches: true, messagePinMatches: pins.count === 1 && pins.revision === message.revision,
        goalNotCancelled: !facts.closed, selectionValid: true, annotationsFromObjects: true,
        sourceFactsMatch: true, sourceNotUiOnly: true, answerSlotEmpty: true,
      },
      pins,
    });
    if (!decided.ok) return refuseDecision(decided, messageCtx, identityKey, fingerprint);

    const requiresApplication = requiresApplicationFor(source.kind, facts.options, selection);
    const body: UserDecisionBodyV1 = { schemaVersion: 1, kind: 'user_decision_response', selection, text, annotations };
    const stored = readOutcome(await deps.messageWrites.storeBody(decisionCtx(owned), {
      messageRef: message.ref, part: 'response', sender, text: encodeUserDecisionBody(body),
    }));
    if (!stored.ok) return stored.rejection;
    const respondedAt = deps.now();
    const response: UserMessageResponseV1 = {
      sender, bodyRef: stored.value.bodyRef, sourceRef: stored.value.sourceRef, respondedAt,
      decision: { selection, source: facts.source, annotations, requiresApplication },
    };
    const next = nextSessionMessageRecord(message, { kind: 'decision_answered', response });
    return persistDecisionMessage(owned, {
      before: message, next, guards: facts.guards, claims: [],
      event: decisionEvent('SessionMessageResponded', identityKey, requestId, owned, respondedAt, sender, next),
      identityKey, fingerprint, requestId, expected,
    });
  }

  async function answerSyntheticCard(owned: Owned, sender: DecisionHostSenderV1, source: DecisionSourceV1,
    selection: DecisionSelectionV1, text: string, annotations: DecisionAnnotationV1[], facts: SourceFacts,
    identityKey: string, fingerprint: string, requestId: string, expected: readonly VersionPin[]): Promise<WriteResult<SessionMessage>> {
    if (!validSelection(source.kind, facts.options, selection)) {
      return rejectedWithCurrent('invalid', 'the answer names neither a stored option nor the explicit other selection');
    }
    if (!annotationsFromObjects(facts.objects, annotations)) {
      return rejectedWithCurrent('invalid', 'an annotation names an object outside the card');
    }
    // §3.3 line 625: a non-message card accepts exactly its canonical source pins.
    const pinProblem = exactPinSet(expected, facts.source.pins, owned);
    if (pinProblem !== null) return pinProblem;
    const answerLookup = await findAnswerForSource(owned, source);
    if (!answerLookup.ok) return answerLookup.rejection;
    const { decided, ctx: messageCtx } = judge(owned, null, { type: 'synthetic_decision_answered' }, {
      decisionAnswer: {
        operatorMatches: true, messagePinMatches: false, goalNotCancelled: !facts.closed,
        selectionValid: true, annotationsFromObjects: true, sourceFactsMatch: true,
        sourceNotUiOnly: true, answerSlotEmpty: answerLookup.value === null,
      },
    });
    if (!decided.ok) return refuseDecision(decided, messageCtx, identityKey, fingerprint);

    const messageRef: SessionMessageRef = {
      aggregateType: 'SessionMessage', projectId: owned.projectId, workspaceId: owned.workspaceId,
      messageId: 'session-message-' + sha256Hex(canonicalJson({
        projectId: owned.projectId, workspaceId: owned.workspaceId, kind: source.kind, key: source.key,
      } as unknown as JsonValue)),
    };
    const requiresApplication = requiresApplicationFor(source.kind, facts.options, selection);
    const body: UserDecisionBodyV1 = { schemaVersion: 1, kind: 'user_decision_response', selection, text, annotations };
    const bodyText = encodeUserDecisionBody(body);
    const messageStored = readOutcome(await deps.messageWrites.storeBody(decisionCtx(owned), {
      messageRef, part: 'message', sender, text: bodyText,
    }));
    if (!messageStored.ok) return messageStored.rejection;
    const responseStored = readOutcome(await deps.messageWrites.storeBody(decisionCtx(owned), {
      messageRef, part: 'response', sender, text: bodyText,
    }));
    if (!responseStored.ok) return responseStored.rejection;
    const respondedAt = deps.now();
    const decision: DecisionMessageMetadataV1 = {
      schemaVersion: 1, source: facts.source, objects: facts.objects, options: facts.options,
      syntheticAnswer: true, forwardedFrom: null,
    };
    const response: UserMessageResponseV1 = {
      sender, bodyRef: responseStored.value.bodyRef, sourceRef: responseStored.value.sourceRef, respondedAt,
      decision: { selection, source: facts.source, annotations, requiresApplication },
    };
    const recipient: MessageRecipient = { kind: 'user', projectId: owned.projectId, workspaceId: owned.workspaceId };
    const next = createSyntheticDecisionAnswerRecord({
      ref: messageRef, sender, recipient, bodyRef: messageStored.value.bodyRef,
      sourceRef: messageStored.value.sourceRef, createdAt: respondedAt,
      goalRef: facts.goal === null ? null : facts.goal.ref, decision, response,
    });
    // A project card is one card of the whole project (every workspace lists it), so its answer slot is the project's.
    const claimWorkspaceId = facts.source.subject.kind === 'project' ? null : owned.workspaceId;
    const claimKey = 's5-decision-answer:' + canonicalJson({
      projectId: owned.projectId, workspaceId: claimWorkspaceId, kind: source.kind, key: source.key,
    } as unknown as JsonValue);
    return persistDecisionMessage(owned, {
      before: null, next, guards: facts.guards,
      claims: [{ claimKey, expectedOwner: null, nextOwner: sessionMessageRefKey(messageRef) }],
      event: decisionEvent('SessionMessageDecisionAnswered', identityKey, requestId, owned, respondedAt, sender, next),
      identityKey, fingerprint, requestId, expected,
    });
  }

  // ---- readDecisionAnswer -------------------------------------------------

  async function readDecisionAnswer(ctx: CoreCallContext, input: { source: DecisionSourceV1 }): Promise<ReadResult<{
    message: SessionMessage | null; body: UserDecisionBodyV1 | null;
  }>> {
    const resolved = await resolveAuthorizedAnswerMessage(ctx, input);
    if (resolved.status !== 'ready') return resolved;
    // The resolver already bound and validated the same scope; it is re-derived
    // only to build the platform material-reader context below.
    const owned = ownScope(ctx);
    if (!isOwned(owned)) return owned;
    const message = resolved.value.message;
    if (message === null) return { status: 'ready', value: { message: null, body: null } };
    if (message.response === null || !('decision' in message.response)) {
      return { status: 'ready', value: { message, body: null } };
    }
    let opened: Awaited<ReturnType<DecisionMessageServiceDependencies['materials']['openArtifact']>>;
    try {
      opened = await deps.materials.openArtifact(materialHostContext(owned), { ref: message.response.bodyRef, usage: 'historical_explanation' });
    } catch {
      return rejectedWithCurrent('unavailable', 'the saved decision answer body could not be opened');
    }
    if (opened.status === 'not_found') return rejectedWithCurrent('unavailable', 'the saved decision answer body is missing');
    if (opened.status !== 'ready') return opened;
    const decoded = decodeStoredUserDecisionBody(message, 'response', opened.value);
    if ('reason' in decoded) return rejectedWithCurrent('unavailable', decoded.reason);
    return { status: 'ready', value: { message, body: decoded.body } };
  }

  /**
   * §4.6 line 915: resolve the caller-authorized saved answer MESSAGE (its pin
   * and status) WITHOUT opening its body artifact. `readDecisionAnswer` opens
   * the body afterwards; `record_decision_application` only needs the message
   * pin, so a missing answer body must not make it fail `unavailable` when the
   * pin and the formal receipt are fine. The scope, bound-workspace
   * and formal-reader checks are byte-for-byte the readDecisionAnswer gate.
   */
  async function resolveAuthorizedAnswerMessage(ctx: CoreCallContext, input: { source: DecisionSourceV1 }): Promise<ReadResult<{
    message: SessionMessage | null;
  }>> {
    const owned = ownScope(ctx);
    if (!isOwned(owned)) return owned;
    if (!isRecord(input) || !isRecord(input.source) || !nonEmpty(input.source.key)) {
      return rejectedWithCurrent('invalid', 'readDecisionAnswer requires a decision source');
    }
    const source = input.source;
    const identity = messageIdentityOf(source);
    // §4.6 line 915: the bound scope and the formal allowed reader are checked
    // BEFORE any saved answer is returned. A Host user reader is always allowed;
    // an agent caller (work_run) is allowed only when the canonical
    // source names a formal reader Session. §4.6/N6: when an answer was already
    // saved, the reader is proven from the historical facts saved with it (the
    // captured source and its formal proposer/request Session facts), not from
    // the live answerability of the source, so the asking Session can still read
    // the answer it acted on after the candidate/Goal cause resolves. An empty
    // list means no formal proposer/secretary fact, so the agent gets
    // `forbidden` while the user Host can still read.
    let saved: SessionMessage | null | undefined;
    if (owned.principal.kind !== 'host') {
      if (identity !== null) {
        if (identity.messageRef.projectId !== owned.projectId || identity.messageRef.workspaceId !== owned.workspaceId) {
          return rejectedWithCurrent('forbidden', 'the decision source message belongs to another workspace');
        }
        const loaded = readOutcome(await loadMessage(owned, identity.messageRef));
        if (!loaded.ok) return loaded.rejection;
        saved = loaded.value;
      } else {
        const found = await findAnswerForSource(owned, source);
        if (!found.ok) return found.rejection;
        saved = found.value;
      }
      // The saved answer's own captured source is the historical fact; the live
      // source read stays for answering and for an unanswered source.
      let allowed: SessionRef[];
      if (saved !== null && saved.response !== null && 'decision' in saved.response) {
        const historical = readOutcome(await readSavedAnswerReaderSessions(records, saved.response.decision.source,
          { projectId: owned.projectId, workspaceId: owned.workspaceId }));
        if (!historical.ok) return historical.rejection;
        allowed = historical.value;
      } else {
        const factsRead = readOutcome(await deps.sources.readSource(ctx, source));
        if (!factsRead.ok) return factsRead.rejection;
        allowed = factsRead.value.allowedReaderSessionRefs;
      }
      const callerSession = await callerReaderSession(owned);
      if (!callerSession.ok) return callerSession.rejection;
      // §4.6: membership in the formal reader list, not merely a non-empty list.
      if (allowed.length === 0 || callerSession.value === null
        || !allowed.some((candidate) => sameSession(candidate, callerSession.value!))) {
        return rejectedWithCurrent('forbidden', 'the caller has no formal reader Session for this decision source');
      }
    }
    let message: SessionMessage | null;
    if (saved !== undefined) {
      message = saved;
    } else if (identity !== null) {
      const loaded = readOutcome(await loadMessage(owned, identity.messageRef));
      if (!loaded.ok) return loaded.rejection;
      message = loaded.value;
    } else {
      const found = await findAnswerForSource(owned, source);
      if (!found.ok) return found.rejection;
      message = found.value;
    }
    return { status: 'ready', value: { message } };
  }

  /**
   * §4.6 line 915: the additive caller-authorized pin-only read. It
   * applies the exact same scope and formal-reader gate as readDecisionAnswer
   * and returns only the saved answer MESSAGE, so `record_decision_application`
   * can read its real pin even when the body artifact is missing.
   */
  async function readDecisionMessagePin(ctx: CoreCallContext, input: { source: DecisionSourceV1 }): Promise<ReadResult<{
    message: SessionMessage | null;
  }>> {
    return resolveAuthorizedAnswerMessage(ctx, input);
  }

  /**
   * Section F2 (blocker 3, runtime half) / §8.2 line 1366: the ADDITIVE
   * read-only replay entry. It derives the committed identity/fingerprint with
   * the SAME `applicationIdentity` `recordDecisionApplication` uses and asks
   * `lookupCommit` for the original receipt. On a hit it restores the ORIGINAL
   * event value/cursor (`replayMessage`, `replayed: true`); a miss is the
   * distinct `{ replayed: null }` "no original receipt" outcome. It performs NO
   * new business read (no answer message, no source facts) and NEVER writes, so
   * a retry can recover its original result before a new pre-read can fail.
   */
  async function replayDecisionApplication(ctx: CoreCallContext, request: {
    input: { messageRef: SessionMessageRef; receipt: DecisionApplicationReceiptV1 };
    meta: { requestId: string };
  }): Promise<ReadResult<{ replayed: Extract<WriteResult<SessionMessage>, { status: 'committed' }> | null }>> {
    const owned = ownScope(ctx);
    if (!isOwned(owned)) return owned;
    const raw = request as unknown as Record<string, unknown> | null | undefined;
    if (!isRecord(raw) || !isRecord(raw['meta']) || !nonEmpty(raw['meta']['requestId']) || !isRecord(raw['input'])) {
      return rejectedWithCurrent('invalid', 'replayDecisionApplication requires an input object and meta.requestId');
    }
    const input = raw['input'];
    if (!isRecord(input['messageRef']) || !isRecord(input['receipt'])) {
      return rejectedWithCurrent('invalid', 'replayDecisionApplication requires a messageRef and a receipt');
    }
    const messageRef = input['messageRef'] as unknown as SessionMessageRef;
    const receipt = input['receipt'] as unknown as DecisionApplicationReceiptV1;
    if (!nonEmpty(receipt.identityKey) || !nonEmpty(receipt.fingerprint) || !nonEmpty(receipt.cursor)) {
      return rejectedWithCurrent('invalid', 'the decision application receipt is not complete');
    }
    const requestId = raw['meta']['requestId'] as string;
    const senderIdentity = callerSenderIdentity(owned);
    const { identityKey, fingerprint } = applicationIdentity(owned, senderIdentity, requestId, messageRef, receipt);
    if (owned.signal.aborted) return rejectedWithCurrent('cancelled', 'the application replay was cancelled before the idempotency lookup');
    let existing: Awaited<ReturnType<S5RecordPort['lookupCommit']>>;
    try {
      existing = await records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return rejectedWithCurrent('unavailable', 'the decision receipt could not be looked up');
    }
    if (existing.status === 'ready') {
      const replayed = await replayMessage(existing.value);
      return replayed.status === 'committed' ? { status: 'ready', value: { replayed } } : replayed;
    }
    if (existing.code === 'not_found') return { status: 'ready', value: { replayed: null } };
    return mapStoreFailure(existing);
  }

  // ---- recordDecisionApplication ------------------------------------------

  async function recordDecisionApplication(ctx: CoreCallContext, request: {
    input: { messageRef: SessionMessageRef; receipt: DecisionApplicationReceiptV1 };
    meta: { requestId: string; expected: VersionPin[] };
  }): Promise<WriteResult<SessionMessage>> {
    const owned = ownScope(ctx);
    if (!isOwned(owned)) return owned;
    const raw = request as unknown as Record<string, unknown> | null | undefined;
    if (!isRecord(raw) || !isRecord(raw['meta']) || !nonEmpty(raw['meta']['requestId'])
      || !Array.isArray(raw['meta']['expected']) || !isRecord(raw['input'])) {
      return rejectedWithCurrent('invalid', 'recordDecisionApplication requires an input object and meta.requestId/expected');
    }
    const input = raw['input'];
    if (!isRecord(input['messageRef']) || !isRecord(input['receipt'])) {
      return rejectedWithCurrent('invalid', 'recordDecisionApplication requires a messageRef and a receipt');
    }
    const messageRef = input['messageRef'] as unknown as SessionMessageRef;
    const receipt = input['receipt'] as unknown as DecisionApplicationReceiptV1;
    if (!nonEmpty(receipt.identityKey) || !nonEmpty(receipt.fingerprint) || !nonEmpty(receipt.cursor)) {
      return rejectedWithCurrent('invalid', 'the decision application receipt is not complete');
    }
    const requestId = raw['meta']['requestId'] as string;
    const expected = raw['meta']['expected'] as VersionPin[];
    const senderIdentity = callerSenderIdentity(owned);
    // LB-2/§8.2 line 1366: the operation identity (operation, scope, sender,
    // payload) is what a retry must match. The accepted message pin stays the
    // CAS of a first execution (exactMessagePin/persist guards, §3.3 line 625)
    // but is NOT part of the fingerprint: after the first commit the message
    // revision is +1, so folding the pin in would turn an identical retry into
    // `idempotency_conflict` instead of replaying the original receipt. The
    // read-only `replayDecisionApplication` entry shares this exact helper.
    const { identityKey, fingerprint } = applicationIdentity(owned, senderIdentity, requestId, messageRef, receipt);
    if (owned.signal.aborted) return rejectedWithCurrent('cancelled', 'the application record was cancelled before the idempotency lookup');
    const existing = await records.lookupCommit({ identityKey, fingerprint });
    if (existing.status === 'ready') return replayMessage(existing.value);
    if (existing.code !== 'not_found') return mapStoreFailure(existing);

    const loaded = readOutcome(await loadMessage(owned, messageRef));
    if (!loaded.ok) return loaded.rejection;
    const message = loaded.value;
    if (message.response === null || !('decision' in message.response)) {
      return rejectedWithCurrent('invalid', 'the message has no user decision answer to apply');
    }
    // §3.3 line 625: an application accepts exactly the original message pin;
    // that accepted revision — never a re-read `before.revision` — is the CAS.
    const pinProblem = exactMessagePin(expected, message.ref, owned);
    if (pinProblem !== null) return pinProblem;
    const answerDecision = message.response.decision;
    const applicationRead = await deps.sources.readApplication(ctx, { answer: message, receipt });
    const applicationOutcome = readOutcome(applicationRead);
    if (!applicationOutcome.ok) return applicationOutcome.rejection;
    const application = applicationOutcome.value;

    // F4/S5-MSG-04 (spec table line 509, §4.6 line 911): the already-recorded
    // shortcut is a NEW identity's no-op result, so it may run only after the
    // caller passed the modifier/operator admission. A caller that did not pass
    // falls through to the state machine, which refuses `forbidden`. The fresh
    // path keeps the spec guard order (changed-before pins, then admission).
    let actor: ActorRef | null;
    let modifierOrOperator: boolean;
    if (message.application !== undefined && message.application !== null) {
      const caller = await callerActor(owned);
      if (!caller.ok) return caller.rejection;
      actor = caller.actor;
      modifierOrOperator = operatorMatches(owned) || (actor !== null && sameActor(actor, application.actor));
      if (modifierOrOperator) {
        if (canonicalOf(message.application) === canonicalOf(application)) {
          return { status: 'committed', value: message, replayed: false, cursor: receipt.cursor };
        }
        return rejectedWithCurrent('invalid', 'a different application is already recorded for this answer');
      }
    } else {
      const before = changedBeforeMatches(answerDecision.source, application);
      if (before !== true) return before;
      const caller = await callerActor(owned);
      if (!caller.ok) return caller.rejection;
      actor = caller.actor;
      modifierOrOperator = operatorMatches(owned) || (actor !== null && sameActor(actor, application.actor));
    }
    const pins = messageMachinePins(expected, message.ref);
    const { decided, ctx: messageCtx } = judge(owned, message, { type: 'decision_application_recorded' }, {
      decisionApplication: {
        receiptReadable: true, changedBeforeMatchesReceipt: true, receiptAfterMatches: true,
        answerAssociationExists: true, modifierOrOperator, requiresApplication: answerDecision.requiresApplication,
      },
      pins,
    });
    if (!decided.ok) return refuseDecision(decided, messageCtx, identityKey, fingerprint);

    const next = nextSessionMessageRecord(message, { kind: 'decision_applied', application });
    const appliedAt = deps.now();
    const eventActor: ActorRef = actor ?? application.actor;
    return persistDecisionMessage(owned, {
      before: message, next, guards: [], claims: [],
      event: decisionEvent('SessionMessageDecisionApplied', identityKey, requestId, owned, appliedAt, eventActor, next),
      identityKey, fingerprint, requestId, expected,
    });
  }

  /**
   * D8/T02-A: the answer's captured source pins vs the formal receipt's before
   * pins. A changed object matches its captured pin, or a named `basisRebases`
   * entry proves the actual before (`captured` == the answer pin,
   * `actualBefore` == the changed before). The owner already validated the
   * content basis when it recorded the rebase; the reader trusts that formal
   * event proof and never re-derives it from the later Goal content.
   */
  function changedBeforeMatches(source: DecisionSourceV1, application: DecisionApplicationV1): true | CoreRejection {
    const capturedPins = source.pins ?? [];
    const rebases = application.basisRebases ?? [];
    for (const change of application.changes) {
      const refKey = canonicalOf(change.before.ref);
      const captured = capturedPins.find((pin) => canonicalOf(pin.ref) === refKey);
      // D8/§3.3: only a changed aggregate present in the answer's captured
      // source pins is checked. A modified object the answer never captured
      // (SC01 replaces the stale candidate U2 before the adopting change) is
      // recorded as-is and not re-checked.
      if (captured === undefined) continue;
      if (captured.revision === change.before.revision) continue;
      const rebase = rebases.find((candidate) => canonicalOf(candidate.captured.ref) === refKey
        && candidate.captured.revision === captured.revision
        && canonicalOf(candidate.actualBefore.ref) === refKey
        && candidate.actualBefore.revision === change.before.revision);
      if (rebase !== undefined) continue;
      return rejectedWithCurrent('revision_conflict', 'a changed object does not match the captured answer source pin', [captured]);
    }
    return true;
  }

  /**
   * K3 L4 / spec §1: the read-only committed-receipt lookup for
   * `record_decision_application`. It shares `applicationIdentity` (LB-2: the
   * message version pin is never folded into the fingerprint); the workspace and
   * sender both come from the original Run's provenance (`{ kind: 'agent',
   * runRef }`, the same shape `callerSenderIdentity` derives for a `work_run`),
   * never from the calling context. The payload is the Kernel-recorded
   * `{ messageRef, receipt }`.
   */
  const lookupToolCommit: ToolCommitLookup = async (ctx, input) => {
    void ctx;
    if (input.toolName !== 'record_decision_application') return toolCommitLookupUnknownTool(input.toolName);
    const scope = { projectId: input.origin.runRef.projectId, workspaceId: input.origin.workspaceId };
    if (!nonEmpty(scope.projectId) || !nonEmpty(scope.workspaceId)) {
      return { status: 'undetermined', reason: 'invalid_origin' };
    }
    const args = input.arguments;
    if (!isRecord(args) || !isRecord(args['messageRef']) || !isRecord(args['receipt'])) {
      return { status: 'undetermined', reason: 'invalid_arguments' };
    }
    const receipt = args['receipt'] as unknown as DecisionApplicationReceiptV1;
    if (!nonEmpty(receipt.identityKey) || !nonEmpty(receipt.fingerprint) || !nonEmpty(receipt.cursor)) {
      return { status: 'undetermined', reason: 'invalid_arguments' };
    }
    const payload = recordDecisionApplicationInput({
      messageRef: args['messageRef'] as unknown as SessionMessageRef, receipt,
    });
    const requestId = toolCommitRequestId(input);
    const senderIdentity = { kind: 'agent', runRef: structuredClone(input.origin.runRef) } as unknown as JsonValue;
    const { identityKey, fingerprint } = applicationIdentity(scope, senderIdentity, requestId,
      payload.messageRef, payload.receipt);
    let lookup: Awaited<ReturnType<S5RecordPort['lookupCommit']>>;
    try {
      lookup = await records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return { status: 'undetermined', reason: 'the decision receipt lookup failed' };
    }
    return toolCommitLookupResult(lookup);
  };

  return { answerDecision, recordDecisionApplication, readDecisionAnswer, readDecisionMessagePin,
    replayDecisionApplication, lookupToolCommit };
}
