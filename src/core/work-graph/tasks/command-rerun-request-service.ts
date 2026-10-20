/**
 * K3 L19a / spec §3.2b: the `CommandRerunRequest` owner.
 *
 * One service publishes the read port, the write port and the read-only
 * `lookupToolCommit` (L4). Every write follows the UCR owner order: trusted
 * context -> `isolateWrite` -> input shape -> request identity/fingerprint ->
 * receipt lookup (replay wins) -> the record(s) this decision needs -> guards ->
 * the pure `state/command-rerun-request.ts` machine -> ONE RecordStore commit
 * carrying exactly one `CommandRerunRequestChanged@1` event.
 *
 * `closed` is derived on read (lead ruling 4): `readRequest` returns a derived
 * copy when the Task is not active, and the next owner operation that touches
 * the request persists CRR-06. Every task-scoped list derives the Task closure
 * exactly ONCE per call; the shell hook's `listTaskRequests` pages the whole
 * set under that ONE read instead of re-reading it per page.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CommandRerunRequestRef, CommandRerunRequestStateV1, CommandRerunRequestV1 } from '../../../contracts/command-rerun-request.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { DecisionChangeProofV1, DecisionSelectionV1, DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type {
  ToolCommitLookup, ToolCommitLookupInput, ToolCommitLookupResult, UnknownCallReviewV1,
} from '../../../contracts/unknown-call-review.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { isPos, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { LookupValue, RecordLookupPage, RecordLookupPort } from '../../record-store/lookup-ports.js';
import { compareRefKeys } from '../../record-store/lookup-index.js';
import type {
  CommandRerunRequestPort, CommandRerunRequestReadPort, CommandRerunRequestReplyV1, TaskClosureReadV1,
} from '../model/command-rerun-request-contracts.js';
import type { BlockedCommandMatchV1, CommandRecognizer } from '../model/command-recognition-contracts.js';
import { readGoal } from './plan-readers.js';
import { isolateWrite, mergeGuards } from './execution-entry-service.js';
import { replayCommittedReceipt } from './receipt-replay.js';
import { pinRevision } from './revision-guard.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { ownerReadStoreFailureToRejection, ownerWriteStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { readOwnerRecord, type OwnerRecordRead } from './owner-record-read.js';
import { commandSha256 } from '../state/command-normalization.js';
import { codePoints, utf8Bytes } from './codec-fields.js';
import { truncateUtf8 } from '../../../contracts/utf8.js';
import {
  newCommandRerunRequest, openRequestForAlias, transitionCommandRerunRequest,
  type CommandRerunRequestContextV1, type CommandRerunRequestEventV1,
} from '../state/command-rerun-request.js';
import {
  commandRerunRequestAnswerIdentityOf, commandRerunRequestRefKey, commandRerunRequestRefOfSource,
  decodeCommandRerunRequest, encodeCommandRerunRequest, encodeCommandRerunRequestChangedEvent,
  commandRerunRequestChangedEventFromEvent,
  COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE, COMMAND_RERUN_REQUEST_EVENT_SCHEMA_VERSION,
  K3_CRR_BY_GOAL_STATE_LOOKUP, K3_CRR_BY_TASK_ALIAS_LOOKUP, K3_CRR_BY_TASK_LOOKUP,
} from './command-rerun-request-codecs.js';
import {
  toolCommitLookupResult, toolCommitLookupUnknownTool, toolCommitRequestId,
} from '../model/tool-commit-arguments.js';
import { decodeSessionMessageRecord, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { goalDecisionBasisMatches } from '../state/goal-settings-machine.js';
import { UNKNOWN_CALL_REVIEW_T02_REASON } from '../../../contracts/unknown-call-review.js';

export type CommandRerunRequestServiceDependencies = {
  records: GoalRecordTransactionPort & Partial<RecordLookupPort>;
  lookups?: RecordLookupPort;
  /** Reads THIS task's UnknownCallReview records, paged to the end (wire to listReviews {goalRef,taskId}). */
  listTaskReviews?: (ctx: CoreCallContext, input: { goalRef: GoalRef; taskId: string }) => Promise<ReadResult<readonly UnknownCallReviewV1[]>>;
  /**
   * The ONE canonical Task-closure reader (satisfied, cancelled, superseded).
   * REQUIRED: there is no "absent means open" default; the composition wires it
   * wherever the owner is built.
   */
  readTaskClosure: (ctx: CoreCallContext, task: TaskTriple) =>
    Promise<ReadResult<{ closed: boolean; cause: 'satisfied' | 'cancelled' | 'superseded' | null }>>;
  /** The ONE recognizer (N's command-recognition.ts); absent -> requestRerun is unavailable. */
  recognize?: CommandRecognizer;
  now: () => string;
  eventId: () => string;
};

export type CommandRerunRequestService = CommandRerunRequestReadPort & CommandRerunRequestPort & {
  lookupToolCommit: ToolCommitLookup;
};

const MAX_PAGE_LIMIT = 200;
const MAX_ALIAS = 32;
const MAX_COMMAND_BYTES = 4_000;
const MAX_REASON_CODE_POINTS = 2_000;
const MAX_FORM_TEXT_BYTES = 512;
const STATES: readonly CommandRerunRequestStateV1[] = [
  'pending', 'allowed', 'used', 'denied', 'denied_final', 'closed',
];

const rejected = rejectedWithCurrent;
function refKeyOf(value: unknown): string {
  return canonicalJson(value as JsonValue);
}
function fourRunFields(runRef: RunRef): Record<string, string> {
  return { aggregateType: 'Run', projectId: runRef.projectId, goalId: runRef.goalId, runId: runRef.runId };
}
function fourRequestFields(ref: CommandRerunRequestRef): Record<string, string> {
  return { aggregateType: 'CommandRerunRequest', projectId: ref.projectId, goalId: ref.goalId,
    taskId: ref.taskId, requestId: ref.requestId };
}
function taskTripleOf(value: unknown): TaskTriple | null {
  if (!isRecord(value) || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])) {
    return null;
  }
  return { projectId: value['projectId'], goalId: value['goalId'], taskId: value['taskId'] };
}
function requestRefProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'CommandRerunRequest'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])
    || !nonEmpty(value['taskId']) || !nonEmpty(value['requestId'])) {
    return 'a complete CommandRerunRequestRef';
  }
  if (!Object.keys(value).every(key => ['aggregateType', 'projectId', 'goalId', 'taskId', 'requestId'].includes(key))) {
    return 'a complete CommandRerunRequestRef without extra fields';
  }
  return null;
}
function runRefProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'Run'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'a complete RunRef';
  }
  return null;
}
function selectionProblem(value: unknown): value is 'allow_rerun' | 'deny' | 'deny_final' {
  return value === 'allow_rerun' || value === 'deny' || value === 'deny_final';
}
function sessionRefComplete(value: unknown): value is SessionMessageRef {
  return isRecord(value) && value['aggregateType'] === 'SessionMessage'
    && nonEmpty(value['projectId']) && nonEmpty(value['workspaceId']) && nonEmpty(value['messageId']);
}
function commandProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'a command string';
  const bytes = utf8Bytes(value);
  if (bytes < 1 || bytes > MAX_COMMAND_BYTES) return `a command of 1..${String(MAX_COMMAND_BYTES)} UTF-8 bytes`;
  return null;
}
function reasonProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'a reason string';
  const points = codePoints(value);
  if (points < 1 || points > MAX_REASON_CODE_POINTS) {
    return `a reason of 1..${String(MAX_REASON_CODE_POINTS)} code points`;
  }
  return null;
}
function rewriteOfProblem(value: unknown): string | null {
  if (!isRecord(value) || !nonEmpty(value['review']) || !isPos(value['alias'])
    || value['alias'] > MAX_ALIAS
    || !Object.keys(value).every(key => key === 'review' || key === 'alias')) {
    return `rewriteOf must be { review: non-empty string, alias: 1..${String(MAX_ALIAS)} }`;
  }
  return null;
}
function systemActorFor(ctx: CoreCallContext): { kind: 'human' | 'system'; id: string } {
  if (ctx.principal.kind === 'host') return { kind: ctx.principal.actor.kind, id: ctx.principal.actor.id };
  if (ctx.principal.kind === 'work_run') {
    return { kind: 'system', id: `command-rerun-request:${ctx.principal.runRef.runId}` };
  }
  return { kind: 'system', id: 'command-rerun-request' };
}

export function createCommandRerunRequestService(
  deps: CommandRerunRequestServiceDependencies,
): CommandRerunRequestService {
  const store = deps.records;
  const lookups: RecordLookupPort | null = deps.lookups
    ?? (typeof (store as Partial<RecordLookupPort>).lookup === 'function' ? store as RecordLookupPort : null);
  const now = deps.now;
  const newEventId = deps.eventId;

  // ---- reads --------------------------------------------------------------

  async function loadRequest(refKey: string): Promise<OwnerRecordRead<CommandRerunRequestV1>> {
    return readOwnerRecord({
      store, refKey, decode: decodeCommandRerunRequest,
      readError: message => rejected('unavailable', `the request could not be read: ${message}`),
    });
  }

  /** Both replays go through the ONE receipt-replay helper. */
  async function replayRequest(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>, { status: 'ready' }>['value'],
    identityKey: string, fingerprint: string,
  ): Promise<WriteResult<CommandRerunRequestV1>> {
    return replayCommittedReceipt({
      receipt,
      eventAt: cursor => store.eventAt(cursor),
      expectedEventType: COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE,
      decode: commandRerunRequestChangedEventFromEvent,
      expected: { identityKey, fingerprint },
      identityKey: decoded => decoded.identityKey,
      fingerprint: decoded => decoded.fingerprint,
      project: decoded => decoded.request,
    });
  }

  /**
   * `forms_added` keeps the record state; `created` is always `requested`.
   * A replayed `pending` names the record's own (waiting) command, never the
   * caller's input, so the tool needs no point read.
   */
  function replyOutcomeOf(decoded: {
    change: string; request: CommandRerunRequestV1;
  }): { status: 'requested'; requestId: string }
    | { status: 'pending'; requestId: string; command: string }
    | { status: 'refused'; reason: 'denied_final' | 'denied_in_this_run' } {
    if (decoded.change === 'created') {
      return { status: 'requested', requestId: decoded.request.ref.requestId };
    }
    switch (decoded.request.state) {
      case 'pending': return { status: 'pending', requestId: decoded.request.ref.requestId,
        command: decoded.request.command };
      case 'denied': return { status: 'refused', reason: 'denied_in_this_run' };
      case 'denied_final': return { status: 'refused', reason: 'denied_final' };
      default: return { status: 'refused', reason: 'denied_in_this_run' };
    }
  }

  async function replayRequestReply(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>, { status: 'ready' }>['value'],
    identityKey: string, fingerprint: string,
  ): Promise<CommandRerunRequestReplyV1> {
    return replayCommittedReceipt({
      receipt,
      eventAt: cursor => store.eventAt(cursor),
      expectedEventType: COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE,
      decode: commandRerunRequestChangedEventFromEvent,
      expected: { identityKey, fingerprint },
      identityKey: decoded => decoded.identityKey,
      fingerprint: decoded => decoded.fingerprint,
      validate: decoded => decoded.change === 'closed'
        ? rejected('busy', 'the Task is not active; a rerun request waits for it to continue')
        : null,
      project: decoded => ({ request: decoded.request, outcome: replyOutcomeOf(decoded) }),
    });
  }

  /** The single request-record commit: exactly one `CommandRerunRequestChanged` event. */
  async function commitRequest(input: {
    identityKey: string; fingerprint: string; requestId: string;
    guards: readonly { refKey: string; expectedRevision: number | null }[];
    next: CommandRerunRequestV1; change: Parameters<typeof encodeCommandRerunRequestChangedEvent>[0]['change'];
    actor: { kind: 'human' | 'system'; id: string }; signal: AbortSignal;
    proof?: DecisionChangeProofV1;
  }): Promise<WriteResult<CommandRerunRequestV1>> {
    const merged = mergeGuards(input.guards);
    if (!merged.ok) return merged.rejection;
    if (input.signal.aborted) return rejected('cancelled', 'the request write was cancelled before commit');
    const occurredAt = now();
    const prepared = {
      identityKey: input.identityKey, fingerprint: input.fingerprint,
      guards: merged.guards, records: [encodeCommandRerunRequest(input.next)], claims: [],
      indexGuards: [] as const, indexChanges: [] as const,
      events: [encodeCommandRerunRequestChangedEvent({
        eventId: newEventId(), eventType: COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE,
        schemaVersion: COMMAND_RERUN_REQUEST_EVENT_SCHEMA_VERSION, occurredAt,
        identityKey: input.identityKey, fingerprint: input.fingerprint, actor: input.actor,
        requestId: input.requestId, change: input.change, request: input.next,
        ...(input.proof === undefined ? {} : { proof: input.proof }),
      })],
    };
    let receipt;
    try {
      receipt = await store.commit(prepared);
    } catch (error) {
      return rejected('unavailable', `the request could not be committed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (receipt.status !== 'committed') return ownerWriteStoreFailureToRejection(receipt);
    if (receipt.replayed) return replayRequest(receipt, input.identityKey, input.fingerprint);
    return { status: 'committed', value: input.next, replayed: false, cursor: receipt.cursor };
  }

  /** CRR-06: persist `closed`; no proof rides on a non-application change. */
  async function persistClosed(
    ctx: CoreCallContext, current: CommandRerunRequestV1, actor: { kind: 'human' | 'system'; id: string },
  ): Promise<WriteResult<CommandRerunRequestV1>> {
    const identityKey = `crr-close:${sha256Hex(canonicalJson({
      requestRef: fourRequestFields(current.ref), revision: current.revision,
    } as never))}`;
    const state: CommandRerunRequestContextV1 = {
      expectedRevision: current.revision, updatedAt: now(), receipt: null,
      cardMatches: true, taskActive: true, sameRun: false,
    };
    const decided = transitionCommandRerunRequest(current, { kind: 'closed', identityKey, fingerprint: identityKey }, state);
    if (!decided.ok) return rejected(decided.code, decided.detail);
    const effect = decided.effects.find(candidate => candidate.kind === 'write_request');
    if (effect === undefined || effect.kind !== 'write_request') {
      return rejected('unavailable', 'the request machine produced no record');
    }
    return commitRequest({
      identityKey, fingerprint: identityKey, requestId: current.ref.requestId,
      guards: [{ refKey: commandRerunRequestRefKey(current.ref), expectedRevision: current.revision }],
      next: effect.request, change: 'closed', actor, signal: ctx.signal,
    });
  }

  /**
   * ONE closure read per operation; the reader is REQUIRED and there is no
   * "absent means open" branch. A thrown read or any non-ready result is
   * `unavailable`, never "still active".
   */
  async function taskClosed(
    ctx: CoreCallContext, task: TaskTriple,
  ): Promise<{ ok: true; closed: boolean } | { ok: false; rejection: CoreRejection }> {
    let read;
    try {
      read = await deps.readTaskClosure(ctx, task);
    } catch (error) {
      if (isRecord(error) && error['status'] === 'rejected' && typeof error['code'] === 'string') {
        return { ok: false, rejection: error as unknown as CoreRejection };
      }
      return { ok: false, rejection: rejected('unavailable',
        `the Task closure could not be read: ${error instanceof Error ? error.message : String(error)}`) };
    }
    if (read.status === 'ready') return { ok: true, closed: read.value.closed };
    if (read.status === 'rejected') return { ok: false, rejection: read };
    const reason = read.status === 'not_found' ? 'the Task is not in the active Plan'
      : 'the Task closure is not readable at the required watermark';
    return { ok: false, rejection: rejected('unavailable', reason) };
  }

  /** The trusted hook-supplied closure's SHAPE; its Task identity is checked against the loaded request. */
  function suppliedClosureProblem(value: unknown): string | null {
    if (!isRecord(value)) return 'the trusted Task closure must be an object';
    const task = value['task'];
    if (!isRecord(task) || !nonEmpty(task['projectId']) || !nonEmpty(task['goalId'])
      || !nonEmpty(task['taskId'])) {
      return 'the trusted Task closure requires a complete Task triple';
    }
    if (typeof value['closed'] !== 'boolean') return 'the trusted Task closure requires closed: boolean';
    return null;
  }

  // ---- listRequests -------------------------------------------------------

  async function listRequests(
    ctx: CoreCallContext,
    input: {
      workspace: WorkspaceScope;
      filter:
        | { goalRef: GoalRef; state: CommandRerunRequestStateV1 }
        | { goalId: string; taskId: string; reviewRunId: string; alias: number }
        | { goalId: string; taskId: string };
      page: { limit: number; cursor?: string };
    },
  ): Promise<ReadResult<{ items: CommandRerunRequestV1[]; nextCursor: string | null; readThrough: CommitCursor | null }>> {
    const raw = input as unknown as Record<string, unknown> | null | undefined;
    if (!isRecord(raw) || !isRecord(raw['workspace'])) return rejected('invalid', 'listRequests requires a workspace');
    const workspace = raw['workspace'];
    if (!nonEmpty(workspace['projectId']) || !nonEmpty(workspace['workspaceId'])) {
      return rejected('invalid', 'listRequests requires a complete WorkspaceScope');
    }
    if (nonEmpty(ctx.projectId) && ctx.projectId !== workspace['projectId']) {
      return rejected('forbidden', 'the request list belongs to another project');
    }
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== workspace['workspaceId']) {
      return rejected('forbidden', 'the request list belongs to another workspace');
    }
    if (!isRecord(raw['page'])) return rejected('invalid', 'listRequests requires a page');
    const limit = raw['page']['limit'];
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
      return rejected('invalid', `page.limit must be an integer between 1 and ${String(MAX_PAGE_LIMIT)}`);
    }
    const cursor = raw['page']['cursor'];
    if (!(cursor === undefined || cursor === null || typeof cursor === 'string')) {
      return rejected('invalid', 'page.cursor must be a string or null');
    }
    if (lookups === null) return rejected('unavailable', 'the request indexes are not wired');
    const filter = raw['filter'];
    if (!isRecord(filter)) return rejected('invalid', 'listRequests requires a filter');
    const projectId = workspace['projectId'] as string;
    const workspaceId = workspace['workspaceId'] as string;
    const cursorValue = typeof cursor === 'string' ? cursor : undefined;

    if (isRecord(filter['goalRef'])) {
      const goalRef = filter['goalRef'];
      if (goalRef['aggregateType'] !== 'Goal' || !nonEmpty(goalRef['projectId']) || !nonEmpty(goalRef['goalId'])) {
        return rejected('invalid', 'listRequests requires a complete GoalRef');
      }
      if (goalRef['projectId'] !== projectId) {
        return rejected('forbidden', 'the Goal belongs to another project');
      }
      const state = filter['state'];
      if (typeof state !== 'string' || !(STATES as readonly string[]).includes(state)) {
        return rejected('invalid', 'listRequests requires a request state');
      }
      // The card source lists RAW records; it derives per card.
      return await onePage(K3_CRR_BY_GOAL_STATE_LOOKUP,
        [projectId, workspaceId, goalRef['goalId'] as string, state], limit, cursorValue, false);
    }

    const goalId = filter['goalId'];
    const taskId = filter['taskId'];
    if (!nonEmpty(goalId) || !nonEmpty(taskId)) {
      return rejected('invalid', 'listRequests requires a goalId and taskId');
    }
    // Derive the Task's closure ONCE per call for every task-scoped form, then
    // return pending/allowed items as `closed` (no write).
    const closure = await taskClosed(ctx, { projectId, goalId: goalId as string, taskId: taskId as string });
    if (!closure.ok) return closure.rejection;
    if (filter['reviewRunId'] !== undefined || filter['alias'] !== undefined) {
      if (!nonEmpty(filter['reviewRunId']) || !isPos(filter['alias'])
        || filter['alias'] > MAX_ALIAS) {
        return rejected('invalid', 'the alias filter requires reviewRunId and alias 1..32');
      }
      // Exactly ONE physical page per call, never a scan to the end.
      return await onePage(K3_CRR_BY_TASK_ALIAS_LOOKUP,
        [projectId, goalId as string, taskId as string, filter['reviewRunId'] as string, filter['alias'] as number],
        limit, cursorValue, closure.closed);
    }
    return await onePage(K3_CRR_BY_TASK_LOOKUP, [projectId, goalId as string, taskId as string],
      limit, cursorValue, closure.closed);
  }

  /**
   * The shell hook's ONE call for a Task.
   * ONE closure read for the whole call, then `k3-crr-by-task` paged to the end
   * — still exactly ONE physical page per page (limit 200), so R = 401 is 3
   * pages — and the closure rides back so the delivery step reuses it. This is
   * an internal read seam; it exposes no input a model or client can supply.
   */
  async function listTaskRequests(
    ctx: CoreCallContext,
    input: { workspace: WorkspaceScope; filter: { goalId: string; taskId: string } },
  ): Promise<ReadResult<{ items: CommandRerunRequestV1[]; closure: TaskClosureReadV1 }>> {
    const raw = input as unknown as Record<string, unknown> | null | undefined;
    if (!isRecord(raw) || !isRecord(raw['workspace'])) return rejected('invalid', 'listTaskRequests requires a workspace');
    const workspace = raw['workspace'];
    if (!nonEmpty(workspace['projectId']) || !nonEmpty(workspace['workspaceId'])) {
      return rejected('invalid', 'listTaskRequests requires a complete WorkspaceScope');
    }
    if (nonEmpty(ctx.projectId) && ctx.projectId !== workspace['projectId']) {
      return rejected('forbidden', 'the request list belongs to another project');
    }
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== workspace['workspaceId']) {
      return rejected('forbidden', 'the request list belongs to another workspace');
    }
    const filter = raw['filter'];
    if (!isRecord(filter) || !nonEmpty(filter['goalId']) || !nonEmpty(filter['taskId'])) {
      return rejected('invalid', 'listTaskRequests requires a goalId and taskId');
    }
    if (lookups === null) return rejected('unavailable', 'the request indexes are not wired');
    const projectId = workspace['projectId'] as string;
    const goalId = filter['goalId'] as string;
    const taskId = filter['taskId'] as string;
    // The ONE closure read for this whole call: every page below reuses it.
    const closure = await taskClosed(ctx, { projectId, goalId, taskId });
    if (!closure.ok) return closure.rejection;
    const items: CommandRerunRequestV1[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; ; page += 1) {
      const read = await onePage(K3_CRR_BY_TASK_LOOKUP, [projectId, goalId, taskId],
        MAX_PAGE_LIMIT, cursor, closure.closed);
      if (read.status !== 'ready') return read;
      items.push(...read.value.items);
      const next = read.value.nextCursor;
      if (next === null) {
        // The closure this call read rides back to the delivery step, which
        // passes it to `consumeAllowance` so the SAME hook call reads it ONCE.
        return { status: 'ready', value: { items,
          closure: { task: { projectId, goalId, taskId }, closed: closure.closed } } };
      }
      if (seenCursors.has(next) || page >= 10_000) {
        return rejected('unavailable', 'the request pages did not advance');
      }
      seenCursors.add(next);
      cursor = next;
    }
  }

  /** One registered index, ONE physical page, then decode/merge/sort/fix the window. */
  async function onePage(
    index: string, values: readonly LookupValue[], limit: number, cursorValue: string | undefined,
    closed: boolean,
  ): Promise<ReadResult<{ items: CommandRerunRequestV1[]; nextCursor: string | null; readThrough: CommitCursor | null }>> {
    if (lookups === null) return rejected('unavailable', 'the request indexes are not wired');
    let page: Awaited<ReturnType<RecordLookupPort['lookup']>>;
    try {
      page = await lookups.lookup({ index, values, limit,
        ...(cursorValue === undefined ? {} : { after: cursorValue }) });
    } catch (error) {
      return rejected('unavailable', `the request list could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (page.status !== 'ready') {
      return page.code === 'invalid'
        ? rejected('invalid', page.reason) : rejected('unavailable', `${page.code}: ${page.reason}`);
    }
    return finishPage(page.value, limit, closed);
  }

  function finishPage(
    page: RecordLookupPage, limit: number, closed = false,
  ): ReadResult<{ items: CommandRerunRequestV1[]; nextCursor: string | null; readThrough: CommitCursor | null }> {
    const readThrough = page.readThrough ?? null;
    const newest = new Map<string, EncodedRecord>();
    for (const record of page.records) {
      const existing = newest.get(record.refKey);
      if (existing === undefined || record.revision > existing.revision) newest.set(record.refKey, record);
    }
    const merged = [...newest.values()].sort((left, right) => compareRefKeys(left.refKey, right.refKey));
    const decoded: CommandRerunRequestV1[] = [];
    for (const record of merged) {
      const value = decodeCommandRerunRequest(record);
      if (value.status !== 'decoded') {
        return rejected('unavailable', `a stored request is not decodable: ${value.reason}`);
      }
      decoded.push(value.value);
    }
    const window = decoded.slice(0, limit);
    const items = closed
      ? window.map(request => request.state === 'pending' || request.state === 'allowed'
        ? { ...request, state: 'closed' as const } : request)
      : window;
    const hasMore = decoded.length > limit || page.next !== null;
    const last = window[window.length - 1];
    return { status: 'ready', value: {
      items,
      nextCursor: hasMore && last !== undefined ? commandRerunRequestRefKey(last.ref) : null,
      readThrough,
    } };
  }

  // ---- requestRerun (CRR-01, CRR-07) --------------------------------------

  function reviewRecordOf(
    reviews: readonly UnknownCallReviewV1[], reviewRunId: string,
  ): UnknownCallReviewV1 | null {
    return reviews.find(record => record.ref.runId === reviewRunId) ?? null;
  }

  function resolveRewriteOf(
    reviews: readonly UnknownCallReviewV1[],
    rewriteOf: { review: string; alias: number },
  ): { ok: true; record: UnknownCallReviewV1; alias: number } | { ok: false; rejection: CoreRejection } {
    const fullRunIds = reviews.map(record => record.ref.runId);
    const exact = reviews.find(record => record.ref.runId === rewriteOf.review);
    const prefixed = rewriteOf.review.length === 8
      ? reviews.filter(record => record.ref.runId.startsWith(rewriteOf.review))
      : [];
    const chosen = exact ?? (prefixed.length === 1 ? prefixed[0] : undefined);
    if (chosen === undefined) {
      if (exact === undefined && prefixed.length > 1) {
        return { ok: false, rejection: rejected('invalid',
          `rewriteOf.review is ambiguous; candidates: ${prefixed.map(record => record.ref.runId).join(', ')}`) };
      }
      return { ok: false, rejection: rejected('invalid',
        `rewriteOf.review is not a review record of this task; runIds: ${fullRunIds.join(', ')}`) };
    }
    if (!chosen.blockedCommands.some(command => command.alias === rewriteOf.alias)) {
      return { ok: false, rejection: rejected('invalid',
        `rewriteOf.alias ${String(rewriteOf.alias)} is not a blocked command of ${chosen.ref.runId}`) };
    }
    return { ok: true, record: chosen, alias: rewriteOf.alias };
  }

  /**
   * ONE read of the Task's request set for the whole request call, by
   * `k3-crr-by-task` in ceil(R/200) pages. Decode/dedupe once and use it for
   * the alias, the refusals and the declared forms.
   */
  async function readTaskRequests(
    workspace: WorkspaceScope, goalId: string, taskId: string,
  ): Promise<ReadResult<CommandRerunRequestV1[]>> {
    if (lookups === null) return rejected('unavailable', 'the request indexes are not wired');
    let batch;
    try {
      batch = await lookupAll<EncodedRecord>(lookups, K3_CRR_BY_TASK_LOOKUP,
        [workspace.projectId, goalId, taskId]);
    } catch (error) {
      const failure = error as { status?: string; code?: string; reason?: string };
      if (failure !== null && typeof failure === 'object' && failure.code !== undefined) {
        return failure.code === 'invalid'
          ? rejected('invalid', failure.reason ?? 'the request list is invalid')
          : rejected('unavailable', failure.reason ?? 'the request list could not be read');
      }
      return rejected('unavailable', `the request list could not be read: ${
        error instanceof Error ? error.message : String(error)}`);
    }
    const newest = new Map<string, CommandRerunRequestV1>();
    for (const record of batch.items) {
      const value = decodeCommandRerunRequest(record);
      if (value.status !== 'decoded') {
        return rejected('unavailable', `a stored request is not decodable: ${value.reason}`);
      }
      if (value.value.task.taskId !== taskId) continue;
      const key = commandRerunRequestRefKey(value.value.ref);
      const existing = newest.get(key);
      if (existing === undefined || value.value.revision > existing.revision) newest.set(key, value.value);
    }
    return { status: 'ready', value: [...newest.values()] };
  }

  function latest(records: readonly CommandRerunRequestV1[]): CommandRerunRequestV1 | null {
    let chosen: CommandRerunRequestV1 | null = null;
    for (const record of records) {
      if (chosen === null || record.revision > chosen.revision) chosen = record;
    }
    return chosen;
  }

  async function appendForm(
    ctx: CoreCallContext, current: CommandRerunRequestV1, form: { sha256: string; text: string },
    identityKey: string, fingerprint: string, sameRun: boolean,
  ): Promise<WriteResult<CommandRerunRequestV1>> {
    const state: CommandRerunRequestContextV1 = {
      expectedRevision: current.revision, updatedAt: now(), receipt: null,
      cardMatches: true, taskActive: true, sameRun,
    };
    const decided = transitionCommandRerunRequest(current, {
      kind: 'forms_added', identityKey, fingerprint, form,
    }, state);
    if (!decided.ok) return rejected(decided.code, decided.detail);
    const effect = decided.effects.find(candidate => candidate.kind === 'write_request');
    if (effect === undefined || effect.kind !== 'write_request') {
      return rejected('unavailable', 'the request machine produced no record');
    }
    return commitRequest({
      identityKey, fingerprint, requestId: current.ref.requestId,
      guards: [{ refKey: commandRerunRequestRefKey(current.ref), expectedRevision: current.revision }],
      next: effect.request, change: 'forms_added', actor: systemActorFor(ctx), signal: ctx.signal,
    });
  }

  async function requestRerun(
    ctx: CoreCallContext,
    request: Parameters<CommandRerunRequestPort['requestRerun']>[1],
  ): Promise<CommandRerunRequestReplyV1> {
    const principal = ctx.principal;
    if (principal.kind !== 'work_run') {
      return rejected('forbidden', 'requestRerun is written by the request_command_rerun tool (a work_run principal)');
    }
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input as unknown as Record<string, unknown>;
    const runProblemText = runRefProblem(input['runRef']);
    if (runProblemText !== null) return rejected('invalid', `requestRerun requires ${runProblemText}`);
    const runRef = input['runRef'] as RunRef;
    if (refKeyOf(runRef) !== refKeyOf(principal.runRef)) {
      return rejected('forbidden', 'requestRerun must be called by the Work Run that requests the rerun');
    }
    const task = taskTripleOf(input['task']);
    if (task === null) return rejected('invalid', 'requestRerun requires a complete TaskTriple');
    if (task.projectId !== runRef.projectId || task.goalId !== runRef.goalId) {
      return rejected('invalid', 'requestRerun task disagrees with the Run scope');
    }
    const commandProblemText = commandProblem(input['command']);
    if (commandProblemText !== null) return rejected('invalid', `requestRerun requires ${commandProblemText}`);
    const reasonProblemText = reasonProblem(input['reason']);
    if (reasonProblemText !== null) return rejected('invalid', `requestRerun requires ${reasonProblemText}`);
    let rewriteOf: { review: string; alias: number } | undefined;
    if (input['rewriteOf'] !== undefined) {
      const problem = rewriteOfProblem(input['rewriteOf']);
      if (problem !== null) return rejected('invalid', problem);
      const raw = input['rewriteOf'] as Record<string, unknown>;
      rewriteOf = { review: raw['review'] as string, alias: raw['alias'] as number };
    }
    const command = input['command'] as string;
    const reason = input['reason'] as string;
    if (ctx.projectId !== runRef.projectId) return rejected('forbidden', 'the Run belongs to another project');
    const identityKey = `crr-request:${owned.requestId}`;
    const fingerprint = sha256Hex(canonicalJson({
      runRef: fourRunFields(runRef), command, reason, rewriteOf: rewriteOf ?? null,
    } as never));
    let existing;
    try {
      existing = await store.lookupCommit({ identityKey, fingerprint });
    } catch (error) {
      return rejected('unavailable',
        `the request receipt could not be looked up: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (existing.status === 'ready') return replayRequestReply(existing.value, identityKey, fingerprint);
    if (existing.code !== 'not_found') return ownerWriteStoreFailureToRejection(existing);

    // The tool adapter passes the trusted prepared Task; no Run read is needed.
    if (ctx.workspaceId === undefined) {
      return rejected('unavailable', 'requestRerun requires the bound workspace');
    }
    const workspaceId = ctx.workspaceId;
    const workspace: WorkspaceScope = { projectId: runRef.projectId, workspaceId };
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: runRef.projectId, goalId: runRef.goalId };

    // ONE read of the Task's request set, before any recognition or alias
    // decision; used for the alias, the refusals and the stored declared forms.
    const taskRequestsRead = await readTaskRequests(workspace, runRef.goalId, task.taskId);
    if (taskRequestsRead.status === 'rejected') return taskRequestsRead;
    if (taskRequestsRead.status !== 'ready') {
      return rejected('unavailable', 'the task request records are not readable');
    }
    const taskRequests = taskRequestsRead.value;

    if (deps.listTaskReviews === undefined) {
      return rejected('unavailable', 'the review-record reader is not wired');
    }
    let reviewRead;
    try {
      reviewRead = await deps.listTaskReviews(ctx, { goalRef, taskId: task.taskId });
    } catch (error) {
      return rejected('unavailable',
        `the task's review records could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (reviewRead.status !== 'ready') {
      return reviewRead.status === 'rejected' ? reviewRead
        : rejected('unavailable', 'the task review records are not readable');
    }
    const reviews = [...reviewRead.value].filter(record =>
      record.task.projectId === task.projectId && record.task.goalId === task.goalId
      && record.task.taskId === task.taskId);

    let rewrite: { record: UnknownCallReviewV1; alias: number } | null = null;
    if (rewriteOf !== undefined) {
      const resolved = resolveRewriteOf(reviews, rewriteOf);
      if (!resolved.ok) return resolved.rejection;
      rewrite = { record: resolved.record, alias: resolved.alias };
    }

    if (deps.recognize === undefined) {
      return rejected('unavailable', 'the command recognizer is not wired');
    }
    let recognizedRead;
    try {
      recognizedRead = await deps.recognize(ctx, { records: reviews, requests: taskRequests,
        command, cwd: '.', maxPackageReads: 2,
        // F-102: the caller declared which record its `rewriteOf` names; the
        // SAME recognition returns that hit when the command really hits it.
        // The shell hook passes no `preferred` and keeps the first hit.
        ...(rewrite === null ? {} : { preferred: {
          reviewRunId: rewrite.record.ref.runId, alias: rewrite.alias } }) });
    } catch (error) {
      return rejected('unavailable',
        `the command could not be recognized: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (recognizedRead.status === 'rejected') return recognizedRead;
    if (recognizedRead.status !== 'ready') {
      return rejected('unavailable', 'the command could not be recognized');
    }
    const recognized: BlockedCommandMatchV1 | null = recognizedRead.value;

    if (recognized !== null && rewrite !== null
      && (recognized.reviewRunId !== rewrite.record.ref.runId || recognized.alias !== rewrite.alias)) {
      return rejected('invalid', 'rewrite_of_mismatch: the command matches another blocked command');
    }
    if (recognized === null && rewrite === null) {
      return { status: 'not_written', outcome: { status: 'not_blocked' } };
    }

    let targetReview: UnknownCallReviewV1;
    let alias: number;
    let match: CommandRerunRequestV1['match'];
    let declared: boolean;
    if (recognized !== null) {
      const review = reviewRecordOf(reviews, recognized.reviewRunId);
      if (review === null) {
        return rejected('invalid', 'the recognised review record is not one of this task\'s records');
      }
      if (!review.blockedCommands.some(entry => entry.alias === recognized.alias)) {
        return rejected('invalid', 'the recognised alias is not a blocked command of its record');
      }
      targetReview = review;
      alias = recognized.alias;
      match = recognized.match;
      declared = false;
    } else {
      if (rewrite === null) return rejected('invalid', 'rewriteOf is required to declare an unrecognised rewrite');
      targetReview = rewrite.record;
      alias = rewrite.alias;
      match = { kind: 'declared' };
      declared = true;
    }

    const aliasRecords = taskRequests.filter(record =>
      record.reviewRef.runId === targetReview.ref.runId && record.alias === alias);

    // CRR-06 / ruling 4: an ended Task closes any open request before anything
    // else; the next operation that touches it persists the derived `closed`.
    const closure = await taskClosed(ctx, task);
    if (!closure.ok) return closure.rejection;
    if (closure.closed) {
      const open = openRequestForAlias(aliasRecords,
        { task, reviewRef: targetReview.ref, alias });
      if (open !== null) {
        const closed = await persistClosed(ctx, open, systemActorFor(ctx));
        if (closed.status === 'rejected') return closed;
      }
      return rejected('busy', 'the Task is not active; a rerun request waits for it to continue');
    }

    const open = openRequestForAlias(aliasRecords,
      { task, reviewRef: targetReview.ref, alias });
    const form = { sha256: commandSha256(command), text: truncateUtf8(command, MAX_FORM_TEXT_BYTES) };
    if (open !== null) {
      if (open.state === 'pending') {
        if (!declared) return { status: 'not_written', outcome: {
          status: 'pending', requestId: open.ref.requestId, command: open.command } };
        const appended = await appendForm(ctx, open, form, identityKey, fingerprint, false);
        if (appended.status === 'rejected') return appended;
        return { status: 'committed', replayed: appended.replayed, cursor: appended.cursor,
          value: { request: appended.value, outcome: {
            status: 'pending', requestId: appended.value.ref.requestId } } };
      }
      // An unused allowance is returned as-is: no write and no form append.
      return { status: 'not_written', outcome: {
        status: 'allowed', requestId: open.ref.requestId, command: open.command } };
    }

    const deniedFinal = latest(aliasRecords.filter(record => record.state === 'denied_final'));
    if (deniedFinal !== null) {
      if (!declared) return { status: 'not_written', outcome: {
        status: 'refused', reason: 'denied_final' } };
      const appended = await appendForm(ctx, deniedFinal, form, identityKey, fingerprint, false);
      if (appended.status === 'rejected') return appended;
      return { status: 'committed', replayed: appended.replayed, cursor: appended.cursor,
        value: { request: appended.value, outcome: {
          status: 'refused', reason: 'denied_final' } } };
    }

    const deniedSameRun = latest(aliasRecords.filter(record =>
      record.state === 'denied' && record.runRef.runId === runRef.runId));
    if (deniedSameRun !== null) {
      if (!declared) return { status: 'not_written', outcome: {
        status: 'refused', reason: 'denied_in_this_run' } };
      const appended = await appendForm(ctx, deniedSameRun, form, identityKey, fingerprint, true);
      if (appended.status === 'rejected') return appended;
      return { status: 'committed', replayed: appended.replayed, cursor: appended.cursor,
        value: { request: appended.value, outcome: {
          status: 'refused', reason: 'denied_in_this_run' } } };
    }

    // CRR-01: create the pending request.
    const createdAt = now();
    const requestRef: CommandRerunRequestRef = {
      aggregateType: 'CommandRerunRequest', projectId: runRef.projectId, goalId: runRef.goalId,
      taskId: task.taskId, requestId: owned.requestId,
    };
    const created = newCommandRerunRequest({
      ref: requestRef, workspaceId, task, reviewRef: structuredClone(targetReview.ref),
      runRef: fourRunFields(runRef) as unknown as RunRef, alias,
      command, commandSha256: commandSha256(command), match, reason, createdAt,
      ...(declared ? { declaredForm: form } : {}),
    });
    if (!created.ok) return rejected(created.code, created.detail);
    const effect = created.effects.find(candidate => candidate.kind === 'write_request');
    if (effect === undefined || effect.kind !== 'write_request') {
      return rejected('unavailable', 'the request machine produced no record');
    }
    const guards: { refKey: string; expectedRevision: number | null }[] = [
      { refKey: commandRerunRequestRefKey(requestRef), expectedRevision: null },
      { refKey: refKeyOf(targetReview.ref), expectedRevision: targetReview.revision },
      ...aliasRecords.map(record => ({
        refKey: commandRerunRequestRefKey(record.ref), expectedRevision: record.revision,
      })),
    ];
    const committed = await commitRequest({
      identityKey, fingerprint, requestId: owned.requestId, guards,
      next: effect.request, change: 'created', actor: systemActorFor(ctx), signal: ctx.signal,
    });
    if (committed.status === 'rejected') return committed;
    return { status: 'committed', replayed: committed.replayed, cursor: committed.cursor,
      value: { request: committed.value, outcome: {
        status: 'requested', requestId: committed.value.ref.requestId } } };
  }

  // ---- applyAnswer (CRR-02, CRR-04, CRR-05) -------------------------------

  /** F-100: the saved synthetic responded answer whose captured source is this card. */
  async function loadAnswerMessage(ref: SessionMessageRef):
  Promise<{ ok: true; value: SessionMessage } | { ok: false; rejection: CoreRejection }> {
    let batch;
    try {
      batch = await store.readMany([sessionMessageRefKey(ref)]);
    } catch (error) {
      return { ok: false, rejection: rejected('unavailable',
        `the answer message could not be read: ${error instanceof Error ? error.message : String(error)}`) };
    }
    if (batch.status !== 'ready') return { ok: false, rejection: ownerReadStoreFailureToRejection(batch) };
    const encoded = batch.value.records.find(record => record.refKey === sessionMessageRefKey(ref));
    if (encoded === undefined) return { ok: false, rejection: rejected('not_found', 'the answer message does not exist') };
    const decoded = decodeSessionMessageRecord(encoded);
    if (decoded.status !== 'decoded') {
      return { ok: false, rejection: rejected('invalid', `the answer message is not decodable: ${decoded.reason}`) };
    }
    return { ok: true, value: decoded.value };
  }

  async function applyAnswer(
    ctx: CoreCallContext,
    request: Parameters<CommandRerunRequestPort['applyAnswer']>[1],
  ): Promise<WriteResult<CommandRerunRequestV1>> {
    if (ctx.principal.kind !== 'host') {
      return rejected('forbidden', 'applyAnswer is written by the Host (the human operator or the Workflow automation)');
    }
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input as unknown as Record<string, unknown>;
    const refProblemText = requestRefProblem(input['requestRef']);
    if (refProblemText !== null) return rejected('invalid', `applyAnswer requires ${refProblemText}`);
    const requestRef = input['requestRef'] as CommandRerunRequestRef;
    const selection = input['selection'];
    if (!selectionProblem(selection)) {
      return rejected('invalid', 'applyAnswer requires allow_rerun, deny or deny_final');
    }
    const answerRef = input['decisionMessageRef'];
    if (!sessionRefComplete(answerRef)) {
      return rejected('invalid', 'applyAnswer requires the answer decisionMessageRef');
    }
    if (ctx.projectId !== requestRef.projectId) return rejected('forbidden', 'the request belongs to another project');
    if (answerRef.projectId !== ctx.projectId
      || (ctx.workspaceId !== undefined && answerRef.workspaceId !== ctx.workspaceId)) {
      return rejected('forbidden', 'the answer message belongs to another workspace');
    }
    const decisionSelection: DecisionSelectionV1 = { kind: 'option', optionId: selection };
    const { identityKey, fingerprint } = commandRerunRequestAnswerIdentityOf(requestRef, decisionSelection, answerRef);
    let existing;
    try {
      existing = await store.lookupCommit({ identityKey, fingerprint });
    } catch (error) {
      return rejected('unavailable',
        `the request receipt could not be looked up: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (existing.status === 'ready') return replayRequest(existing.value, identityKey, fingerprint);
    if (existing.code !== 'not_found') return ownerWriteStoreFailureToRejection(existing);

    // F-100: after the replay lookup, the SAVED synthetic answered answer is the
    // authoritative selection and the Goal content basis this answer captured.
    const answer = await loadAnswerMessage(answerRef);
    if (!answer.ok) return answer.rejection;
    const savedAnswer = answer.value;
    if (savedAnswer.decision?.syntheticAnswer !== true || savedAnswer.status !== 'responded') {
      return rejected('invalid', 'the decisionMessageRef is not a synthetic responded answer');
    }
    if (savedAnswer.response === null || !('decision' in savedAnswer.response)) {
      return rejected('invalid', 'the answer message carries no user decision response');
    }
    const capturedDecision = savedAnswer.response.decision;
    const capturedSource: DecisionSourceV1 = capturedDecision.source;
    const capturedRef = commandRerunRequestRefOfSource(capturedSource);
    if (capturedRef === null || canonicalJson(capturedRef as unknown as JsonValue)
      !== canonicalJson(requestRef as unknown as JsonValue)) {
      return rejected('revision_conflict', 'the answer was taken against another command-rerun-request card');
    }
    if (canonicalJson(capturedDecision.selection as unknown as JsonValue)
      !== canonicalJson(decisionSelection as unknown as JsonValue)) {
      return rejected('invalid', 'the answer selection disagrees with the request selection');
    }

    const refKey = commandRerunRequestRefKey(requestRef);
    const loaded = await loadRequest(refKey);
    if ('rejection' in loaded) return loaded.rejection;
    if ('notFound' in loaded) return rejected('not_found', 'the request record does not exist');
    const current = loaded.value;
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== current.workspaceId) {
      return rejected('forbidden', 'the request belongs to another workspace');
    }
    const hasExpected = owned.expected.length > 0;
    const pinnedRevision = hasExpected ? pinRevision(owned.expected, requestRef) : null;
    if (hasExpected && pinnedRevision === null) {
      return rejected('invalid', 'meta.expected must pin the request ref exactly once');
    }
    const expectedRevision = pinnedRevision ?? current.revision;
    if (expectedRevision !== current.revision) {
      return rejected('revision_conflict', 'the request record moved since the card was answered', [
        { ref: structuredClone(current.ref), revision: current.revision } as unknown as VersionPin,
      ]);
    }
    const capturedPin = (capturedSource.pins ?? []).find(pin =>
      canonicalJson(pin.ref as unknown as JsonValue) === canonicalJson(requestRef as unknown as JsonValue));
    if (capturedPin === undefined || capturedPin.revision !== current.revision) {
      return rejected('revision_conflict', 'the request record moved since the card was answered', [
        { ref: structuredClone(current.ref), revision: current.revision } as unknown as VersionPin,
      ]);
    }
    if (current.state !== 'pending') {
      return rejected('invalid', `an answer is not legal from ${current.state}`);
    }

    const actor = ctx.principal.actor;
    // ONE canonical closure read; a closed Task persists CRR-06 and answers
    // busy, and a read failure is never "still active".
    const closure = await taskClosed(ctx, current.task);
    if (!closure.ok) return closure.rejection;
    if (closure.closed) {
      const closed = await persistClosed(ctx, current, actor);
      if (closed.status === 'rejected') return closed;
      return rejected('busy', 'the Task is not active; the answer waits for it to continue');
    }

    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: current.ref.projectId, goalId: current.ref.goalId };
    const goalRead = await readGoal(store, goalRef);
    if (goalRead.status !== 'ready') return rejected(goalRead.code, goalRead.reason);
    const goal = goalRead.goal;
    if (goal.desiredState !== 'active') {
      return rejected('busy', goal.desiredState === 'paused'
        ? 'the Goal is paused; the answer waits for resume'
        : 'the Goal is not active; the answer waits for resume');
    }
    // F-100 / T02: the answer's captured content basis must still equal the
    // current Goal content; otherwise the answer cannot be applied here.
    const basis = (capturedSource.goalBases ?? [])[0];
    if (basis === undefined || !goalDecisionBasisMatches(basis, goal)) {
      return rejected('revision_conflict', UNKNOWN_CALL_REVIEW_T02_REASON);
    }

    const updatedAt = now();
    const event: CommandRerunRequestEventV1 = selection === 'allow_rerun'
      ? { kind: 'allowed', identityKey, fingerprint, answerMessageRef: structuredClone(answerRef), allowedAt: updatedAt }
      : { kind: selection === 'deny' ? 'denied' : 'denied_final', identityKey, fingerprint,
        answerMessageRef: structuredClone(answerRef) };
    const state: CommandRerunRequestContextV1 = {
      expectedRevision: current.revision, updatedAt, receipt: null,
      cardMatches: true, taskActive: true, sameRun: false,
    };
    const decided = transitionCommandRerunRequest(current, event, state);
    if (!decided.ok) return rejected(decided.code, decided.detail);
    const effect = decided.effects.find(candidate => candidate.kind === 'write_request');
    if (effect === undefined || effect.kind !== 'write_request') {
      return rejected('unavailable', 'the request machine produced no record');
    }
    const proof: DecisionChangeProofV1 = {
      acknowledgementRef: structuredClone(answerRef),
      capturedPins: owned.expected.map(pin => structuredClone(pin)),
      changes: [
        { before: { ref: structuredClone(current.ref), revision: current.revision } as unknown as VersionPin,
          after: { ref: structuredClone(effect.request.ref), revision: effect.request.revision } as unknown as VersionPin },
      ],
      basisRebases: [],
    };
    const change = selection === 'allow_rerun' ? 'allowed' : selection === 'deny' ? 'denied' : 'denied_final';
    return commitRequest({
      identityKey, fingerprint, requestId: owned.requestId,
      guards: [
        { refKey, expectedRevision: current.revision },
        { refKey: refKeyOf(goalRef), expectedRevision: goal.revision },
      ],
      next: effect.request, change, actor, signal: ctx.signal, proof,
    });
  }

  // ---- consumeAllowance (CRR-03) ------------------------------------------

  async function consumeAllowance(
    ctx: CoreCallContext,
    request: Parameters<CommandRerunRequestPort['consumeAllowance']>[1],
    taskClosure?: TaskClosureReadV1,
  ): Promise<WriteResult<CommandRerunRequestV1>> {
    if (ctx.principal.kind !== 'host' && ctx.principal.kind !== 'work_run') {
      return rejected('forbidden', 'consumeAllowance is called by the shell hook');
    }
    const closureProblem = taskClosure === undefined ? null : suppliedClosureProblem(taskClosure);
    if (closureProblem !== null) return rejected('invalid', closureProblem);
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input as unknown as Record<string, unknown>;
    const refProblemText = requestRefProblem(input['requestRef']);
    if (refProblemText !== null) return rejected('invalid', `consumeAllowance requires ${refProblemText}`);
    const requestRef = input['requestRef'] as CommandRerunRequestRef;
    const usedBy = input['usedBy'];
    if (!isRecord(usedBy) || !nonEmpty(usedBy['runId']) || !nonEmpty(usedBy['callId'])
      || !Object.keys(usedBy).every(key => key === 'runId' || key === 'callId')) {
      return rejected('invalid', 'consumeAllowance requires usedBy { runId, callId }');
    }
    const call = { runId: usedBy['runId'] as string, callId: usedBy['callId'] as string };
    if (ctx.projectId !== requestRef.projectId) return rejected('forbidden', 'the request belongs to another project');
    const identityKey = `crr-consume:${sha256Hex(canonicalJson({
      requestRef: fourRequestFields(requestRef), usedBy: call,
    } as never))}`;
    const fingerprint = sha256Hex(canonicalJson({
      requestRef: fourRequestFields(requestRef), usedBy: call,
    } as never));
    let existing;
    try {
      existing = await store.lookupCommit({ identityKey, fingerprint });
    } catch (error) {
      return rejected('unavailable',
        `the request receipt could not be looked up: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (existing.status === 'ready') return replayRequest(existing.value, identityKey, fingerprint);
    if (existing.code !== 'not_found') return ownerWriteStoreFailureToRejection(existing);


    const refKey = commandRerunRequestRefKey(requestRef);
    const loaded = await loadRequest(refKey);
    if ('rejection' in loaded) return loaded.rejection;
    if ('notFound' in loaded) return rejected('not_found', 'the request record does not exist');
    const current = loaded.value;
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== current.workspaceId) {
      return rejected('forbidden', 'the request belongs to another workspace');
    }
    const pinnedRevision = pinRevision(owned.expected, requestRef);
    if (pinnedRevision === null) {
      return rejected('invalid', 'meta.expected must pin the request ref exactly once');
    }
    if (pinnedRevision !== current.revision) {
      return rejected('revision_conflict', 'the request record moved since the allowance was read', [
        { ref: structuredClone(current.ref), revision: current.revision } as unknown as VersionPin,
      ]);
    }
    // The allowance is void once the Task closed; persist CRR-06. The shell
    // hook passes the closure its list read already made, so ONE hook call reads
    // the closure ONCE. It must name THIS request's Task; absent, the owner
    // reads the closure itself — a real read, never a default (direct callers
    // keep their old behavior).
    let closed: boolean;
    if (taskClosure === undefined) {
      const closure = await taskClosed(ctx, current.task);
      if (!closure.ok) return closure.rejection;
      closed = closure.closed;
    } else {
      if (taskClosure.task.projectId !== current.task.projectId
        || taskClosure.task.goalId !== current.task.goalId
        || taskClosure.task.taskId !== current.task.taskId) {
        return rejected('invalid', 'the trusted Task closure names another Task');
      }
      closed = taskClosure.closed;
    }
    if (closed) {
      const closedWrite = await persistClosed(ctx, current, systemActorFor(ctx));
      if (closedWrite.status === 'rejected') return closedWrite;
      return rejected('busy', 'the Task is not active; the allowance is void');
    }
    const updatedAt = now();
    const state: CommandRerunRequestContextV1 = {
      expectedRevision: current.revision, updatedAt, receipt: null,
      cardMatches: true, taskActive: true, sameRun: true,
    };
    const decided = transitionCommandRerunRequest(current, {
      kind: 'used', identityKey, fingerprint, usedAt: updatedAt, usedBy: call,
    }, state);
    if (!decided.ok) return rejected(decided.code, decided.detail);
    const effect = decided.effects.find(candidate => candidate.kind === 'write_request');
    if (effect === undefined || effect.kind !== 'write_request') {
      return rejected('unavailable', 'the request machine produced no record');
    }
    return commitRequest({
      identityKey, fingerprint, requestId: owned.requestId,
      guards: [{ refKey, expectedRevision: current.revision }],
      next: effect.request, change: 'used', actor: systemActorFor(ctx), signal: ctx.signal,
    });
  }

  // ---- readRequest --------------------------------------------------------

  async function readRequest(
    ctx: CoreCallContext,
    input: { ref: CommandRerunRequestRef },
  ): Promise<ReadResult<CommandRerunRequestV1>> {
    if (!isRecord(input)) return rejected('invalid', 'readRequest requires { ref }');
    const refProblemText = requestRefProblem(input.ref);
    if (refProblemText !== null) return rejected('invalid', `readRequest requires ${refProblemText}`);
    const ref = input.ref;
    if (nonEmpty(ctx.projectId) && ctx.projectId !== ref.projectId) {
      return rejected('forbidden', 'the request belongs to another project');
    }
    const refKey = commandRerunRequestRefKey(ref);
    const loaded = await loadRequest(refKey);
    if ('rejection' in loaded) return loaded.rejection;
    if ('notFound' in loaded) return { status: 'not_found' };
    const current = loaded.value;
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== current.workspaceId) {
      return rejected('forbidden', 'the request belongs to another workspace');
    }
    // A closure read failure is `unavailable`, never "valid".
    const closure = await taskClosed(ctx, current.task);
    if (!closure.ok) return closure.rejection;
    if (closure.closed && (current.state === 'pending' || current.state === 'allowed')) {
      return { status: 'ready', value: { ...current, state: 'closed' } };
    }
    return { status: 'ready', value: current };
  }

  // ---- lookupToolCommit (L4) ----------------------------------------------

  async function lookupToolCommit(_ctx: CoreCallContext, input: ToolCommitLookupInput): Promise<ToolCommitLookupResult> {
    if (input.toolName !== 'request_command_rerun') return toolCommitLookupUnknownTool(input.toolName);
    if (!isRecord(input.arguments)) return { status: 'undetermined', reason: 'invalid_arguments' };
    const args = input.arguments;
    const commandText = commandProblem(args['command']);
    if (commandText !== null) return { status: 'undetermined', reason: 'invalid_arguments' };
    const reasonText = reasonProblem(args['reason']);
    if (reasonText !== null) return { status: 'undetermined', reason: 'invalid_arguments' };
    let rewriteOf: { review: string; alias: number } | null = null;
    if (args['rewriteOf'] !== undefined) {
      if (rewriteOfProblem(args['rewriteOf']) !== null) {
        return { status: 'undetermined', reason: 'invalid_arguments' };
      }
      const raw = args['rewriteOf'] as Record<string, unknown>;
      rewriteOf = { review: raw['review'] as string, alias: raw['alias'] as number };
    }
    const requestId = toolCommitRequestId(input);
    const identityKey = `crr-request:${requestId}`;
    const fingerprint = sha256Hex(canonicalJson({
      runRef: fourRunFields(input.origin.runRef), command: args['command'], reason: args['reason'],
      rewriteOf,
    } as never));
    let lookup;
    try {
      lookup = await store.lookupCommit({ identityKey, fingerprint });
    } catch {
      return { status: 'undetermined', reason: 'the request receipt lookup failed' };
    }
    return toolCommitLookupResult(lookup);
  }

  return {
    readRequest,
    listRequests,
    listTaskRequests,
    requestRerun,
    applyAnswer,
    consumeAllowance,
    lookupToolCommit,
  };
}
