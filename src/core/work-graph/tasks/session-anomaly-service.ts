/**
 * Slice 1 §3.3: the anomaly-anchor write/read owner. One anchor per Run; the
 * anchor is immutable. Listing is served by the two lookup indexes; the Task
 * archive label/next is derived by the pure state function.
 *
 * `recordSessionAnomaly` is keyed by the immutable archive step plus the
 * complete RunRef: a durable request's recorded receipt locates the request,
 * the anchor record (guarded absent) fixes the Run identity, and a repeat call
 * — even with another request id after the final archive cleared R — replays
 * the ORIGINAL `SessionAnomalyRecorded` through the anchor's own receipt and
 * `deriveArchiveStepCommitIdentityV1(step='anchor')`, never the current
 * watermark (spec §2.6).
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalJson, sameJson as sameRef, type JsonValue } from '../../../contracts/fingerprint.js';
import { isRecord, nonEmpty, parseObject as parseJsonObject } from '../../../contracts/validation/common.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { ArchiveStepRefV1, SessionArchiveRequestV1 } from '../../../contracts/core/session-archive.js';
import { deriveArchiveStepCommitIdentityV1 } from '../../../contracts/core/session-archive.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import {
  type ArchiveChangedFilesV1, type SessionAnomalyAnchorRef, type SessionAnomalyAnchorV1, type SessionAnomalyViewV1,
} from '../../../contracts/session-anomaly.js';
import type { TaskReworkRefusalCode } from '../../../contracts/task-requeue.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../record-store/lookup-ports.js';
import type {
  GoalRecordTransactionPort, PreparedCommit, RecordGuard,
} from '../../record-store/ports.js';
import type { SessionFactsPort } from '../model/session-facts-contracts.js';
import {
  SESSION_ANOMALY_BY_GOAL_LOOKUP, SESSION_ANOMALY_BY_TASK_LOOKUP,
} from '../model/session-facts-contracts.js';
import type { SessionPage, SessionPageRequest } from '../model/session-contracts.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { sessionArchiveChangedEventFromEvent } from '../sessions/lifecycle-record-codecs.js';
import { decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import {
  deriveSessionAnomalyView, deriveTaskArchiveState, transitionSessionAnomaly,
  type TaskArchiveNextV1,
} from '../state/session-anomaly.js';
import { runUnresolvedBlocker } from '../state/run-machine.js';
import { planRevisionRefKey } from '../persistence/plan-record-codecs.js';
import { evaluateEligibility } from './eligibility.js';
import { mapStoreFailure } from './execution-entry-service.js';
import {
  readCanonicalTaskFacts, readGoal, readPlan, laterCursor, RUN_BY_TASK_INDEX,
  type CanonicalTaskFacts, type Rejected, type TaskFactRecordPort,
} from './plan-readers.js';
import {
  SESSION_ANOMALY_EVENT_SCHEMA_VERSION, SESSION_ANOMALY_RECORDED_EVENT_TYPE, archiveChangedFilesProblem,
  decodeSessionAnomalyAnchor, encodeSessionAnomalyAnchor, encodeSessionAnomalyRecordedEvent,
  sessionAnomalyRecordedEventFromEvent, sessionAnomalyRefKey,
  type SessionAnomalyRecordedEventV1,
} from './session-anomaly-codecs.js';

export interface SessionAnomalyPort {
  recordSessionAnomaly(ctx: CoreCallContext, input: { step: ArchiveStepRefV1; files: ArchiveChangedFilesV1 }):
    Promise<WriteResult<SessionAnomalyAnchorV1>>;
  listSessionAnomalies(ctx: CoreCallContext, input: {
    goalRef: GoalRef; taskId?: string; page: SessionPageRequest;
  }): Promise<ReadResult<SessionPage<SessionAnomalyViewV1>>>;
  readTaskArchiveState(ctx: CoreCallContext, task: TaskTriple): Promise<ReadResult<{
    pending: SessionAnomalyViewV1[]; label: '中断，待核对' | null;
    next: { kind: 'dispatch' } | { kind: 'human_continue' }
      | { kind: 'goal_stopped'; desiredState: 'paused' | 'cancelled' }
      | { kind: 'rework_blocked'; code: TaskReworkRefusalCode } | null;
  }>>;
}

export type SessionAnomalyStores = {
  records: GoalRecordTransactionPort;
  lookups: RecordLookupPort;
  sessionFacts: SessionFactsPort;
  now(): string;
};

/** §2.8: an internal fact scan is 100 records per page, at most 25 pages. */
const LOOKUP_PAGE_LIMIT = 100;
const LOOKUP_MAX_PAGES = 25;
const PAGE_LIMIT_MAX = 100;
/** §2.8/§3.4: the claim proof of the subject Run pages the Session-execution index. */
const SESSION_EXECUTION_PAGE_LIMIT = 100;
const SESSION_EXECUTION_MAX_PAGES = 25;

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function reject(code: CoreError, reason: string): CoreRejection {
  return rejected(code, reason);
}
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function incomplete(reason: string): CoreRejection { return reject('incomplete', reason); }
function mapReader(failure: Rejected): CoreRejection { return reject(failure.code, failure.reason); }
function plainSessionRef(ref: { projectId: string; sessionId: string }): SessionRef {
  return { projectId: ref.projectId, sessionId: ref.sessionId };
}

/**
 * A Session reference as it arrives on the anomaly port. The plain `SessionRef`
 * shape and a full `SessionAggregateRef` (which additionally carries
 * `aggregateType: 'Session'`) both name the same Session; normalize to the
 * plain `{projectId,sessionId}` so identity, the commit and the stored anchor
 * never depend on which one the caller held (mirrors
 * `sessions/session-lifecycle.ts:normalizeSessionRef`). A ref that lacks either
 * id, or names another aggregate type, is refused.
 */
function normalizeSessionRef(value: unknown): { ok: true; ref: SessionRef } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: 'sessionRef must be an object' };
  if (value['aggregateType'] !== undefined && value['aggregateType'] !== 'Session') {
    return { ok: false, reason: 'sessionRef aggregateType must be Session' };
  }
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return { ok: false, reason: 'sessionRef requires projectId and sessionId' };
  }
  return { ok: true, ref: { projectId: value['projectId'], sessionId: value['sessionId'] } };
}

type Trusted = { scope: { projectId: string; workspaceId: string }; actor: { kind: 'human' | 'system'; id: string } };

function trustedContext(ctx: CoreCallContext): { ok: true; value: Trusted } | { ok: false; rejection: CoreRejection } {
  const bound = ctx as unknown as { projectId?: unknown; workspaceId?: unknown; principal?: unknown; signal?: unknown };
  if (!nonEmpty(bound.projectId) || !nonEmpty(bound.workspaceId)) {
    return { ok: false, rejection: reject('forbidden', 'an anomaly call requires a bound project/workspace context') };
  }
  const principal = bound.principal;
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return { ok: false, rejection: reject('forbidden', 'an anomaly write requires a trusted Host principal') };
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: reject('forbidden', 'an anomaly write requires a trusted Host actor') };
  }
  const signal = bound.signal;
  if (!isRecord(signal) || typeof signal['aborted'] !== 'boolean') {
    return { ok: false, rejection: reject('forbidden', 'an anomaly call requires the bound AbortSignal') };
  }
  return { ok: true, value: {
    scope: { projectId: bound.projectId, workspaceId: bound.workspaceId },
    actor: { kind: actor['kind'], id: actor['id'] },
  } };
}

function parseRunRef(value: unknown): RunRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'Run' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) return null;
  return { aggregateType: 'Run', projectId: value['projectId'], goalId: value['goalId'], runId: value['runId'] };
}
function parseSubjectRunRef(subjectKey: string): RunRef | null {
  let parsed: unknown;
  try { parsed = JSON.parse(subjectKey); } catch { return null; }
  return parseRunRef(parsed);
}
function receiptProblem(value: unknown): string | null {
  if (!isRecord(value) || !nonEmpty(value['identityKey']) || !nonEmpty(value['fingerprint'])) {
    return 'the archive step requires a requestReceipt {identityKey,fingerprint}';
  }
  return null;
}

// --------------------------------------------------------------------------
// Canonical Session / request reads
// --------------------------------------------------------------------------

/** The raw archive Session record (revision + workspace/role/archiveRequest facts). */
async function readSessionRecord(records: GoalRecordTransactionPort, ref: SessionRef):
Promise<{ ok: true; session: SessionRecord } | { ok: false; rejection: CoreRejection }> {
  const key = sessionAggregateRefKey(plainSessionRefToAggregate(ref));
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) return { ok: false, rejection: reject('not_found', `Session ${ref.sessionId} does not exist`) };
  const decoded = decodeSessionRecord(record);
  if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the Session is damaged: ${decoded.reason}`) };
  return { ok: true, session: decoded.value };
}

/** The canonical Run named by the step subject (the record key is its canonical ref). */
async function readRunByRef(records: GoalRecordTransactionPort, ref: RunRef):
Promise<{ ok: true; run: RunSnapshot } | { ok: false; rejection: CoreRejection }> {
  const key = canonicalJson(ref as unknown as JsonValue);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) return { ok: false, rejection: reject('not_found', `Run ${ref.runId} does not exist`) };
  const decoded = decodeRun(record);
  if (!decoded.ok) return { ok: false, rejection: unavailable(`the Run is damaged: ${decoded.reason}`) };
  return { ok: true, run: decoded.value };
}

/** The durable request the recorded receipt locates; a null session archiveRequest reads as a missing request. */
async function readArchiveRequestByReceipt(
  records: GoalRecordTransactionPort,
  receipt: { identityKey: string; fingerprint: string },
): Promise<{ ok: true; request: SessionArchiveRequestV1 | null; sessionRef: SessionRef | null }
  | { ok: false; rejection: CoreRejection }> {
  const lookup = await records.lookupCommit({ identityKey: receipt.identityKey, fingerprint: receipt.fingerprint });
  if (lookup.status !== 'ready') {
    if (lookup.code === 'not_found') return { ok: true, request: null, sessionRef: null };
    return { ok: false, rejection: mapStoreFailure(lookup) };
  }
  const at = await records.eventAt(lookup.value.cursor);
  if (at.status !== 'ready') return { ok: false, rejection: mapStoreFailure(at) };
  const decoded = sessionArchiveChangedEventFromEvent(at.value.event);
  if (decoded.status !== 'decoded') {
    return { ok: false, rejection: unavailable(`the recorded archive request event is not decodable: ${decoded.reason}`) };
  }
  return { ok: true, request: decoded.value.session.archiveRequest ?? null,
    sessionRef: plainSessionRef(decoded.value.session.ref) };
}

// --------------------------------------------------------------------------
// Anchor and entered-successor reads
// --------------------------------------------------------------------------

type KeyCollect = { ok: true; refKeys: string[]; readThrough: CommitCursor | null } | { ok: false; rejection: CoreRejection };

async function collectAnchorKeys(lookups: RecordLookupPort, index: string, values: readonly (string | number)[]): Promise<KeyCollect> {
  const refKeys: string[] = [];
  let after: string | undefined;
  let watermark: CommitCursor | null = null;
  for (let page = 0; page < LOOKUP_MAX_PAGES; page += 1) {
    const request: RecordLookupRequest = { index, values, limit: LOOKUP_PAGE_LIMIT,
      ...(after === undefined ? {} : { after }) };
    const result = await lookups.lookup(request);
    if (result.status !== 'ready') {
      if (result.code === 'unsupported') return { ok: false, rejection: incomplete(`session_facts_page_limit: lookup index ${index} is not registered`) };
      if (result.code === 'invalid') return { ok: false, rejection: incomplete(`session_facts_page_limit: lookup index ${index} rejected the request: ${result.reason}`) };
      return { ok: false, rejection: unavailable(`${result.code}: ${result.reason}`) };
    }
    for (const record of result.value.records) refKeys.push(record.refKey);
    watermark = laterCursor(watermark, result.value.readThrough);
    if (result.value.next === null) return { ok: true, refKeys, readThrough: watermark };
    after = result.value.next;
  }
  return { ok: false, rejection: incomplete(`session_facts_page_limit: lookup index ${index} did not terminate within ${String(LOOKUP_MAX_PAGES)} pages`) };
}

type AnchorRead = { anchors: SessionAnomalyAnchorV1[]; guards: RecordGuard[]; readThrough: CommitCursor | null };

async function readTaskAnchorRecords(
  records: GoalRecordTransactionPort,
  lookups: RecordLookupPort,
  goalRef: GoalRef,
  workspaceId: string,
  taskId: string | null,
): Promise<{ ok: true; value: AnchorRead } | { ok: false; rejection: CoreRejection }> {
  const index = taskId === null ? SESSION_ANOMALY_BY_GOAL_LOOKUP : SESSION_ANOMALY_BY_TASK_LOOKUP;
  const values: (string | number)[] = taskId === null
    ? [goalRef.projectId, workspaceId, goalRef.goalId]
    : [goalRef.projectId, workspaceId, goalRef.goalId, taskId];
  const found = await collectAnchorKeys(lookups, index, values);
  if (!found.ok) return found;
  const value: AnchorRead = { anchors: [], guards: [], readThrough: found.readThrough };
  if (found.refKeys.length === 0) return { ok: true, value };
  const read = await records.readMany([...new Set(found.refKeys)]);
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  for (const record of read.value.records) {
    const decoded = decodeSessionAnomalyAnchor(record);
    if (decoded.status !== 'decoded') {
      return { ok: false, rejection: unavailable(`the SessionAnomalyAnchor ${record.refKey} is damaged: ${decoded.reason}`) };
    }
    const anchor = decoded.value;
    if (anchor.workspaceId !== workspaceId || anchor.task.goalId !== goalRef.goalId) continue;
    if (taskId !== null && anchor.task.taskId !== taskId) continue;
    value.anchors.push(anchor);
    value.guards.push({ refKey: record.refKey, expectedRevision: record.revision });
  }
  value.readThrough = laterCursor(value.readThrough, read.value.readThrough);
  return { ok: true, value };
}

type EnteredSuccessor = { runRef: RunRef; sessionRef: SessionRef; enteredAt: string; anchorRefs: readonly SessionAnomalyAnchorRef[] };

/** The later, really entered Runs of one Task whose inputBinding carries anchors (rule 6/T7, §2.7). */
async function readEnteredSuccessors(
  records: GoalRecordTransactionPort,
  lookups: RecordLookupPort,
  task: TaskTriple,
): Promise<{ ok: true; value: EnteredSuccessor[] } | { ok: false; rejection: CoreRejection }> {
  const found = await collectAnchorKeys(lookups, RUN_BY_TASK_INDEX, [task.projectId, task.goalId, task.taskId]);
  if (!found.ok) return found;
  if (found.refKeys.length === 0) return { ok: true, value: [] };
  const read = await records.readMany([...new Set(found.refKeys)]);
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const value: EnteredSuccessor[] = [];
  for (const record of read.value.records) {
    const decoded = decodeRun(record);
    if (!decoded.ok) return { ok: false, rejection: unavailable(`a Run of the Task is damaged: ${decoded.reason}`) };
    const run: RunSnapshot = decoded.value;
    if (run.task.taskId !== task.taskId || run.task.goalId !== task.goalId || run.task.projectId !== task.projectId) continue;
    const anchorRefs = run.inputBinding?.anomalyAnchorRefs;
    if (anchorRefs === undefined || anchorRefs.length === 0) continue;
    const history = run.executionHistory;
    if (history === undefined) continue;
    value.push({ runRef: run.ref, sessionRef: plainSessionRef(history.sessionRef),
      enteredAt: run.startedAt ?? run.endedAt ?? '', anchorRefs });
  }
  return { ok: true, value };
}

function enteredForAnchor(anchor: SessionAnomalyAnchorV1, entered: readonly EnteredSuccessor[]): EnteredSuccessor[] {
  return entered.filter((entry) => entry.anchorRefs.some((ref) => sameRef(ref, anchor.ref)));
}

/**
 * Slice 1 §3.4 `recordSessionAnomaly`: the subject Run must be a real Work
 * claim of THIS Session. The claim is read through the injected Session facts
 * port (the Outbox Session-execution index), never assumed from the anchor's
 * own RunRef; an unfinished bounded scan is `incomplete/session_facts_page_limit:`.
 */
async function readSessionRunClaim(
  sessionFacts: SessionFactsPort,
  ctx: CoreCallContext,
  sessionRef: SessionRef,
  run: RunSnapshot,
): Promise<{ ok: true; owns: boolean } | { ok: false; rejection: CoreRejection }> {
  let cursor: string | undefined;
  for (let page = 0; page < SESSION_EXECUTION_MAX_PAGES; page += 1) {
    const request = { sessionRef, page: cursor === undefined
      ? { limit: SESSION_EXECUTION_PAGE_LIMIT }
      : { limit: SESSION_EXECUTION_PAGE_LIMIT, cursor } };
    const result = await sessionFacts.listSessionExecutions(ctx, request);
    if (result.status !== 'ready') {
      if (result.status === 'rejected') return { ok: false, rejection: result };
      return { ok: false, rejection: incomplete(`session_facts_page_limit: the Work execution scan of Session ${sessionRef.sessionId} did not finish`) };
    }
    for (const claim of result.value.items) {
      if (sameRef(claim.runRef, run.ref)
        && claim.task.projectId === run.task.projectId && claim.task.goalId === run.task.goalId
        && claim.task.taskId === run.task.taskId
        && claim.attemptRef.attemptId === run.attemptId) {
        return { ok: true, owns: true };
      }
    }
    if (result.value.nextCursor === null) return { ok: true, owns: false };
    cursor = result.value.nextCursor;
  }
  return { ok: false, rejection: incomplete(`session_facts_page_limit: the Work execution scan of Session ${sessionRef.sessionId} did not finish`) };
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createSessionAnomalyService(stores: SessionAnomalyStores): SessionAnomalyPort {
  const records = stores.records;
  const lookups = stores.lookups;
  const sessionFacts = stores.sessionFacts;
  /** The canonical task reader needs the SAME backend's candidate index; it
   * reads records and lookups only and must not be handed write operations. */
  const taskFactRecords: TaskFactRecordPort = {
    readMany: (keys) => records.readMany(keys),
    lookup: (input) => lookups.lookup(input),
  };

  /** Replay a recorded `SessionAnomalyRecorded` through the original receipt. */
  async function replayAnchor(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }>,
  ): Promise<WriteResult<SessionAnomalyAnchorV1>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return unavailable('the recorded anchor receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (String(at.value.cursor) !== String(receipt.cursor)) {
      return unavailable('the recorded anchor event cursor disagrees with the receipt');
    }
    const decoded = sessionAnomalyRecordedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') {
      return unavailable(`the recorded anchor event is not decodable: ${decoded.reason}`);
    }
    if (decoded.value.eventId !== receipt.eventIds[0]) {
      return unavailable('the recorded anchor event id disagrees with the receipt');
    }
    return { status: 'committed', value: decoded.value.anchor, replayed: true, cursor: receipt.cursor };
  }

  async function recordSessionAnomaly(
    ctx: CoreCallContext,
    input: { step: ArchiveStepRefV1; files: ArchiveChangedFilesV1 },
  ): Promise<WriteResult<SessionAnomalyAnchorV1>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope } = trusted.value;
    const raw = input as unknown as { step?: unknown; files?: unknown } | null | undefined;
    if (raw === null || raw === undefined || !isRecord(raw.step) || !isRecord(raw.files)) {
      return invalid('recordSessionAnomaly requires a step and its changed files');
    }
    const rawStep = raw.step as unknown as ArchiveStepRefV1;
    if (!isRecord(rawStep.sessionRef) || rawStep.step !== 'anchor' || !nonEmpty(rawStep.archiveRequestId)
      || !nonEmpty(rawStep.subjectKey)) {
      return invalid('recordSessionAnomaly requires an anchor step with a session, request id and subject key');
    }
    // The caller may hold the plain SessionRef or the full SessionAggregateRef;
    // normalize before identity/commit so both name the same Session.
    const normalizedSession = normalizeSessionRef(rawStep.sessionRef);
    if (!normalizedSession.ok) return invalid(`archive_input_invalid: ${normalizedSession.reason}`);
    const step: ArchiveStepRefV1 = { ...rawStep, sessionRef: normalizedSession.ref };
    const stepSession = normalizedSession.ref;
    if (stepSession.projectId !== scope.projectId) return reject('forbidden', 'archive_scope: the anchor belongs to another project');
    const receiptIssue = receiptProblem(step.requestReceipt);
    if (receiptIssue !== null) return invalid(receiptIssue);
    const runRef = parseSubjectRunRef(step.subjectKey);
    if (runRef === null || runRef.projectId !== scope.projectId) {
      return invalid('the anchor subject key must be a complete RunRef in this project');
    }
    const anchorRef: SessionAnomalyAnchorRef = { aggregateType: 'SessionAnomalyAnchor', projectId: runRef.projectId,
      goalId: runRef.goalId, runId: runRef.runId };

    // Existing anchor: a repeat (same or another request) replays the original record.
    const anchorKey = sessionAnomalyRefKey(anchorRef);
    const anchorRead = await records.readMany([anchorKey]);
    if (anchorRead.status !== 'ready') return mapStoreFailure(anchorRead);
    const existingRecord = anchorRead.value.records.find((record) => record.refKey === anchorKey);
    if (existingRecord !== undefined) {
      const decoded = decodeSessionAnomalyAnchor(existingRecord);
      if (decoded.status !== 'decoded') {
        return unavailable(`the existing SessionAnomalyAnchor is damaged: ${decoded.reason}`);
      }
      const existingAnchor = decoded.value;
      // The anchor carries the ORIGINAL request's receipt: rebuild the original
      // step identity and replay its commit, never the current watermark.
      const originalRequestRead = await readArchiveRequestByReceipt(records, existingAnchor.archiveRequestReceipt);
      if (!originalRequestRead.ok) return originalRequestRead.rejection;
      const originalRequest = originalRequestRead.request;
      if (originalRequest === null) return unavailable('the anchor names no readable archive request receipt');
      const originalStep: ArchiveStepRefV1 = { sessionRef: plainSessionRef(existingAnchor.sessionRef),
        archiveRequestId: existingAnchor.archiveRequestId, requestReceipt: existingAnchor.archiveRequestReceipt,
        step: 'anchor', subjectKey: canonicalJson(existingAnchor.runRef as unknown as JsonValue) };
      let identity: { identityKey: string; fingerprint: string };
      try {
        identity = deriveArchiveStepCommitIdentityV1(scope, originalRequest, originalStep);
      } catch (error) {
        return unavailable(`the original anchor step identity is not derivable: ${error instanceof Error ? error.message : String(error)}`);
      }
      const lookup = await records.lookupCommit(identity);
      if (lookup.status !== 'ready') {
        if (lookup.code === 'not_found') return unavailable('the original anchor commit receipt is not readable');
        return mapStoreFailure(lookup);
      }
      return replayAnchor(lookup.value);
    }

    // First write: the step's own receipt must locate a durable request.
    const requestRead = await readArchiveRequestByReceipt(records, step.requestReceipt);
    if (!requestRead.ok) return requestRead.rejection;
    const request = requestRead.request;
    if (request === null) return unavailable('the anchor step names no readable archive request receipt');
    if (request.requestId !== step.archiveRequestId) return invalid('the archive request receipt disagrees with the step request id');
    // The durable request must be the one registered for THIS Session.
    if (requestRead.sessionRef === null || !sameRef(requestRead.sessionRef, stepSession)) {
      return reject('forbidden', 'archive_scope: the archive request belongs to another Session');
    }
    // §3.2/C1: a Work anchor is authorized only by an execution this archive
    // really stopped (`work`) or by a released-occupancy request (`none`). A
    // Query execution never authorizes a Work anchor; it is refused up front.
    if (request.execution.kind === 'query') {
      return invalid('archive_input_invalid: a Query execution cannot authorize a Work anomaly anchor');
    }

    let identity: { identityKey: string; fingerprint: string; eventId: string };
    try {
      identity = deriveArchiveStepCommitIdentityV1(scope, request, step);
    } catch (error) {
      return invalid(`the anchor step does not belong to the archive request: ${error instanceof Error ? error.message : String(error)}`);
    }
    const existingCommit = await records.lookupCommit(identity);
    if (existingCommit.status === 'ready') return replayAnchor(existingCommit.value);
    if (existingCommit.code !== 'not_found') return mapStoreFailure(existingCommit);

    const sessionRead = await readSessionRecord(records, stepSession);
    if (!sessionRead.ok) return sessionRead.rejection;
    const session = sessionRead.session;
    if (session.workspaceId !== scope.workspaceId) return reject('forbidden', 'archive_scope: the Session belongs to another workspace');

    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: runRef.projectId, goalId: runRef.goalId };
    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') return mapReader(goalRead);
    const planRef = goalRead.goal.activePlanRevision;
    if (planRef === null) return incomplete('the Goal has no adopted Plan for the anchor');
    const planRead = await readPlan(records, planRef);
    if (planRead.status !== 'ready') return mapReader(planRead);
    const plan = planRead.plan;
    const runRead = await readRunByRef(records, runRef);
    if (!runRead.ok) return runRead.rejection;
    const run = runRead.run;
    const taskId = run.task.taskId;
    const definitionTask = plan.tasks.find((task) => task.taskId === taskId);
    if (definitionTask === undefined) return reject('not_found', 'the anchor Task is not part of the active Plan');
    const factsRead = await readCanonicalTaskFacts(taskFactRecords, goalRef, plan, taskId);
    if (factsRead.status !== 'ready') return mapReader(factsRead);
    const facts: CanonicalTaskFacts = factsRead.value;
    const canonical = facts.byTaskId.get(taskId);
    if (canonical === undefined) return incomplete('the directed task state was not read');

    // §2.6/§3.4: the changed files are Runtime facts, never authorization; a
    // shape the persistence boundary refuses is refused here as `invalid`.
    const filesProblem = archiveChangedFilesProblem(raw.files);
    if (filesProblem !== null) return invalid(`archive_input_invalid: ${filesProblem}`);
    const files = raw.files as unknown as ArchiveChangedFilesV1;

    // §3.4 recordSessionAnomaly read order: the subject Run must be a real Work
    // claim of THIS Session (read through the injected Session facts port), never
    // assumed from the anchor's own RunRef.
    const claimRead = await readSessionRunClaim(sessionFacts, ctx, stepSession, run);
    if (!claimRead.ok) return claimRead.rejection;

    // S1-ANCHOR-02: a `mode:'retired'` request must also verify the retired
    // facts (retired, no same-line continuation, released occupancy, the current
    // request this step belongs to). A retired caller that does not verify is an
    // invalid request; a non-retired request takes S1-ANCHOR-01.
    // C1: a NEW anchor commit always requires the Session's CURRENT durable R to
    // be exactly this step's request (the receipt replay above is already
    // allowed without it).
    const currentRequestMatches = session.archiveRequest !== null && session.archiveRequest !== undefined
      && session.archiveRequest.requestId === request.requestId
      && sameRef(session.archiveRequest.receipt, request.receipt);
    let retiredFacts = false;
    if (request.mode === 'retired') {
      const sessionFactsRead = await sessionFacts.readSessionFacts(ctx, stepSession);
      if (sessionFactsRead.status !== 'ready') {
        if (sessionFactsRead.status === 'rejected') return sessionFactsRead;
        return incomplete(`session_facts_page_limit: the Session facts of ${stepSession.sessionId} were not read`);
      }
      retiredFacts = session.health === 'unavailable'
        && sessionFactsRead.value.continuations.length === 0
        && session.occupancy === null
        && currentRequestMatches;
    }

    // S1-ANCHOR-01 "R corresponds to the Run/attempt": a work request must name
    // this exact Run and Attempt. A released-occupancy request (`execution:none`)
    // names no Run; its Run correspondence is the claim proof above. Either way
    // the Run must be a real Work claim of this Session.
    const executionMatches = request.execution.kind === 'work'
      ? sameRef(request.execution.runRef, run.ref) && run.attemptId === request.execution.attemptRef.attemptId
        && request.execution.attemptRef.taskId === taskId
      : true;
    const requestMatches = claimRead.owns && executionMatches && currentRequestMatches
      && (request.mode !== 'retired' || retiredFacts);
    const sameScope = session.workspaceId === scope.workspaceId
      && run.workspaceSnapshot.workspaceId === scope.workspaceId
      && run.ref.projectId === scope.projectId && run.ref.goalId === runRef.goalId;
    const stopped = runUnresolvedBlocker(run) === null && run.status === 'ended';
    const taskTerminal = canonical.effectivePhase === 'satisfied'
      || definitionTask.disposition === 'cancelled' || definitionTask.disposition === 'superseded';
    const cause: 'archive_interrupted' | 'retired_archive' = retiredFacts ? 'retired_archive' : 'archive_interrupted';

    const anchorInput = {
      ref: anchorRef, workspaceId: session.workspaceId, task: run.task, planRef: run.planRef,
      lineHead: plainSessionRef(session.ref), sessionRef: plainSessionRef(session.ref), role: session.role,
      runRef: run.ref,
      attemptRef: { aggregateType: 'TaskAttempt' as const, projectId: run.task.projectId, goalId: run.task.goalId,
        taskId: run.task.taskId, attemptId: run.attemptId },
      cause,
      archiveRequestId: request.requestId, archiveRequestReceipt: request.receipt,
      archivedBy: request.requestedBy, recordedAt: stores.now(),
      changedFiles: files,
      resultVerification: 'not_checked' as const,
    };
    const verdict = transitionSessionAnomaly('absent', { kind: 'record', input: anchorInput }, {
      execution: 'work', stopped, taskTerminal, sameScope, requestMatches,
    });
    if (!verdict.ok) return reject(verdict.code, verdict.detail);
    const anchor = verdict.next;
    if (anchor === 'absent' || typeof anchor !== 'object') return unavailable('the anchor machine did not construct a record');

    const guards: RecordGuard[] = [
      { refKey: anchorKey, expectedRevision: null },
      { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(stepSession)), expectedRevision: session.revision },
      { refKey: planRevisionRefKey(plan.ref), expectedRevision: plan.revision },
      ...facts.guards,
    ];
    const event: SessionAnomalyRecordedEventV1 = {
      eventId: identity.eventId, eventType: SESSION_ANOMALY_RECORDED_EVENT_TYPE,
      schemaVersion: SESSION_ANOMALY_EVENT_SCHEMA_VERSION, occurredAt: anchor.recordedAt,
      projectId: scope.projectId, workspaceId: scope.workspaceId, anchor,
    };
    const prepared: PreparedCommit = {
      identityKey: identity.identityKey, fingerprint: identity.fingerprint,
      guards: dedupeGuards(guards), records: [encodeSessionAnomalyAnchor(anchor)], claims: [], indexGuards: [], indexChanges: [],
      events: [encodeSessionAnomalyRecordedEvent(event)],
    };
    if (ctx.signal?.aborted) return reject('cancelled', 'the anchor was cancelled before commit');
    const receipt = await records.commit(prepared);
    if (receipt.status !== 'committed') return mapStoreFailure(receipt);
    if (receipt.replayed) return replayAnchor(receipt);
    return { status: 'committed', value: anchor, replayed: false, cursor: receipt.cursor };
  }

  async function listSessionAnomalies(
    ctx: CoreCallContext,
    input: { goalRef: GoalRef; taskId?: string; page: SessionPageRequest },
  ): Promise<ReadResult<SessionPage<SessionAnomalyViewV1>>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope } = trusted.value;
    const raw = input as unknown as { goalRef?: unknown; taskId?: unknown; page?: unknown } | null | undefined;
    if (!isRecord(raw) || !isRecord(raw.goalRef) || raw.goalRef['aggregateType'] !== 'Goal'
      || !nonEmpty(raw.goalRef['projectId']) || !nonEmpty(raw.goalRef['goalId'])) {
      return invalid('listSessionAnomalies requires a complete GoalRef');
    }
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: raw.goalRef['projectId'], goalId: raw.goalRef['goalId'] };
    if (goalRef.projectId !== scope.projectId) return reject('forbidden', 'the Goal belongs to another project');
    const taskId = raw.taskId === undefined ? null : raw.taskId;
    if (taskId !== null && !nonEmpty(taskId)) return invalid('taskId must be a non-empty string when present');
    if (!isRecord(raw.page)) return invalid('listSessionAnomalies requires a page');
    const limit = raw.page['limit'];
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_LIMIT_MAX) {
      return invalid(`page.limit must be an integer between 1 and ${String(PAGE_LIMIT_MAX)}`);
    }
    const cursor = raw.page['cursor'];
    if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') return invalid('page.cursor must be a string or null');
    let after: string | null = null;
    if (typeof cursor === 'string') {
      const decoded = decodeAnomalyCursor(cursor);
      if (decoded === null) return invalid('page.cursor is not a valid anomaly cursor');
      if (decoded.projectId !== goalRef.projectId || decoded.goalId !== goalRef.goalId
        || decoded.workspaceId !== scope.workspaceId || decoded.taskId !== taskId) {
        return invalid('page.cursor does not belong to this workspace/Goal/Task query');
      }
      after = decoded.after;
    }
    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') return mapReader(goalRead);
    const workspaceId = goalRead.goal.workspaceRef.workspaceId;
    if (workspaceId !== scope.workspaceId) return reject('forbidden', 'the Goal belongs to another workspace');

    const found = await readTaskAnchorRecords(records, lookups, goalRef, workspaceId, taskId);
    if (!found.ok) return found.rejection;
    const ordered = [...found.value.anchors].sort((left, right) => {
      const leftKey = sessionAnomalyRefKey(left.ref);
      const rightKey = sessionAnomalyRefKey(right.ref);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    let start = 0;
    if (after !== null) {
      const at = ordered.findIndex((anchor) => sessionAnomalyRefKey(anchor.ref) === after);
      if (at < 0) return invalid('page.cursor names an anchor outside this query');
      start = at + 1;
    }
    const pageAnchors = ordered.slice(start, start + limit);
    const taskIds = [...new Set(pageAnchors.map((anchor) => anchor.task.taskId))];
    const enteredByTask = new Map<string, EnteredSuccessor[]>();
    for (const id of taskIds) {
      const entered = await readEnteredSuccessors(records, lookups, { projectId: goalRef.projectId, goalId: goalRef.goalId, taskId: id });
      if (!entered.ok) return entered.rejection;
      enteredByTask.set(id, entered.value);
    }
    const items = pageAnchors.map((anchor) =>
      deriveSessionAnomalyView(anchor, enteredForAnchor(anchor, enteredByTask.get(anchor.task.taskId) ?? [])));
    const last = pageAnchors[pageAnchors.length - 1];
    const nextCursor = ordered.length > start + limit && last !== undefined
      ? encodeAnomalyCursor({ projectId: goalRef.projectId, workspaceId, goalId: goalRef.goalId, taskId,
        after: sessionAnomalyRefKey(last.ref) })
      : null;
    const sourceCursor = found.value.readThrough ?? goalRead.readThrough;
    if (sourceCursor === null) return incomplete('the anchor list has no readable ledger watermark');
    return { status: 'ready', value: { items, nextCursor, sourceCursor } };
  }

  async function readTaskArchiveState(
    ctx: CoreCallContext,
    task: TaskTriple,
  ): Promise<ReadResult<{
    pending: SessionAnomalyViewV1[]; label: '中断，待核对' | null; next: TaskArchiveNextV1 | null;
  }>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope } = trusted.value;
    if (!isRecord(task) || !nonEmpty(task.taskId) || !nonEmpty(task.goalId) || !nonEmpty(task.projectId)) {
      return invalid('readTaskArchiveState requires a complete TaskTriple');
    }
    if (task.projectId !== scope.projectId) return reject('forbidden', 'the Task belongs to another project');
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId };
    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') return mapReader(goalRead);
    const workspaceId = goalRead.goal.workspaceRef.workspaceId;
    const planRef = goalRead.goal.activePlanRevision;
    if (planRef === null) return { status: 'ready', value: { pending: [], label: null, next: null } };
    const planRead = await readPlan(records, planRef);
    if (planRead.status !== 'ready') return mapReader(planRead);
    const plan = planRead.plan;
    const definition = plan.tasks.find((candidate) => candidate.taskId === task.taskId);
    if (definition === undefined) return reject('not_found', 'the Task is not part of the active Plan');
    const factsRead = await readCanonicalTaskFacts(taskFactRecords, goalRef, plan, task.taskId);
    if (factsRead.status !== 'ready') return mapReader(factsRead);
    const facts = factsRead.value;
    const canonical = facts.byTaskId.get(task.taskId);
    if (canonical === undefined) return incomplete('the directed task state was not read');
    const found = await readTaskAnchorRecords(records, lookups, goalRef, workspaceId, task.taskId);
    if (!found.ok) return found.rejection;
    const entered = await readEnteredSuccessors(records, lookups, task);
    if (!entered.ok) return entered.rejection;
    const views = found.value.anchors.map((anchor) => deriveSessionAnomalyView(anchor, enteredForAnchor(anchor, entered.value)));
    const selectedRunId = canonical.execution?.runId ?? null;
    const reworkRefusal: TaskReworkRefusalCode | null = selectedRunId === null
      ? null : facts.requeueRefusalsByRunId.get(selectedRunId)?.code ?? null;
    const effectivePhases = new Map<string, (typeof canonical)['effectivePhase']>();
    for (const [id, state] of facts.byTaskId) effectivePhases.set(id, state.effectivePhase);
    const claimable = evaluateEligibility({ plan, goalDesiredState: goalRead.goal.desiredState, taskId: task.taskId,
      effectivePhases, lease: canonical.lease }).eligible;
    return { status: 'ready', value: deriveTaskArchiveState({
      views, goalDesiredState: goalRead.goal.desiredState, phaseCause: canonical.phaseCause,
      reworkRefusal, claimable,
    }) };
  }

  return { recordSessionAnomaly, listSessionAnomalies, readTaskArchiveState };
}

// --------------------------------------------------------------------------
// Small local utilities
// --------------------------------------------------------------------------

function dedupeGuards(guards: readonly RecordGuard[]): RecordGuard[] {
  const byKey = new Map<string, number | null>();
  for (const guard of guards) {
    if (!byKey.has(guard.refKey) || byKey.get(guard.refKey) === guard.expectedRevision) {
      byKey.set(guard.refKey, guard.expectedRevision);
    }
  }
  return [...byKey].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision }));
}

type AnomalyCursor = { projectId: string; workspaceId: string; goalId: string; taskId: string | null; after: string };

function encodeAnomalyCursor(cursor: AnomalyCursor): string {
  return canonicalJson(cursor as unknown as JsonValue);
}
function decodeAnomalyCursor(rawValue: string): AnomalyCursor | null {
  const parsed = parseJsonObject(rawValue);
  if (parsed === null || !nonEmpty(parsed['projectId']) || !nonEmpty(parsed['workspaceId'])
    || !nonEmpty(parsed['goalId']) || !nonEmpty(parsed['after'])) return null;
  const taskId = parsed['taskId'];
  if (taskId !== null && !nonEmpty(taskId)) return null;
  return { projectId: parsed['projectId'], workspaceId: parsed['workspaceId'], goalId: parsed['goalId'],
    taskId: taskId === null ? null : taskId, after: parsed['after'] };
}
