/**
 * Slice 2B L4/L8: the WorkGraph owner of the `RunActivity` write and the
 * backfill candidate read.
 *
 * `recordRunActivity` is the backfill write (L8): it builds or replaces the one
 * `RunActivity` record of a Run and emits `RunActivityRecorded`. It never
 * changes a Run, Task or Attempt (decision 20) and never calls a model. The
 * end-of-Run commits write the same record through `planRunActivity` (L5), in
 * the SAME commit as the Run transition and with no extra event.
 *
 * `ensureActivityRecording` creates the workspace's `ActivityRecording` once
 * and opens the Query epoch (L16) when an older record has none;
 * `listActivityBackfillCandidates` scans one workspace's ended Runs by
 * `endedAt` (new index `s2b-run-by-workspace-ended`) and answers which need a
 * tally (L8). Every storage read failure is returned, never turned into an
 * empty candidate list (rule 3).
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { QueryJobRef, QueryJobSnapshot, QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  ACTIVITY_AUTO_RETRY_REASONS, ACTIVITY_READ_RECORD_CAP, RUN_ACTIVITY_RULE_VERSION,
  provenNotEnteredKernel,
} from '../../../contracts/run-activity.js';
import type {
  ActivityRecordingRef, ActivityRecordingSnapshot, QueryActivitySnapshot, RunActivityFactsV1, RunActivityRef,
  RunActivitySnapshot,
} from '../../../contracts/run-activity.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import { dispatchOutboxRefKey, decodeDispatchOutboxEntry } from './claim-record-codecs.js';
import type { EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreFailure } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GraphWrite } from '../model/task-contracts.js';
import { decideActivityOutcome, type ActivityWriteOutcome } from '../state/activity-replacement.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { planQueryActivityWrite, queryActivityRefOf, queryActivitySourceOf } from '../model/query-activity-plan.js';
import {
  decodeQueryActivitySnapshot, encodeQueryActivityRecordedEvent, encodeQueryActivitySnapshot,
  queryActivityRecordedEventFromEvent, queryActivityRefKey, QUERY_ACTIVITY_EVENT_SCHEMA_VERSION,
  QUERY_ACTIVITY_RECORDED_EVENT_TYPE, type QueryActivityRecordedEventV1,
} from '../persistence/query-activity-codecs.js';
import {
  decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord, queryRunRefFromValue, S6_QUERY_RUN_BY_WORKSPACE_ENDED_LOOKUP,
} from '../queries/query-record-codecs.js';
import { S2B_RUN_BY_WORKSPACE_ENDED_LOOKUP } from './plan-readers.js';
import {
  RUN_ACTIVITY_RECORDED_EVENT_TYPE, RUN_ACTIVITY_EVENT_SCHEMA_VERSION,
  ACTIVITY_RECORDING_STARTED_EVENT_TYPE, activityRecordingRefKey, activityRecordingStartedEventFromEvent,
  decodeActivityRecordingSnapshot, decodeRunActivitySnapshot, encodeActivityRecordingSnapshot,
  encodeActivityRecordingStartedEvent, encodeRunActivityRecordedEvent, encodeRunActivitySnapshot,
  runActivityRecordedEventFromEvent, runActivityRefKey, type ActivityRecordingStartedEventV1,
  type RunActivityRecordedEventV1,
} from './run-activity-codecs.js';

/**
 * L8/L16: one backfill candidate. A Work Run and a QueryRun are both keyed by
 * the full ref; `activityRevision` is the candidate's current record revision
 * (null when it has none yet) and rides the write as the candidate's CAS pin.
 */
export type ActivityBackfillCandidate =
  | { kind: 'run'; runRef: RunRef; activityRevision: number | null }
  | { kind: 'query'; queryRunRef: QueryRunRef; activityRevision: number | null };

/** L16: the merged scan position. `run` sorts before `query` at one instant. */
export type ActivityBackfillCursor = { order: string; kind: 'run' | 'query'; refKey: string };

/** The merged list order's position: one end instant, one kind and one record key. */
export type ActivityBackfillPosition = { endedAt: string; kind: 'run' | 'query'; refKey: string };

/**
 * L16's merged order: `endedAt` descending (the 2B scan reads newest first),
 * then the kind rank ascending (a Work Run before a Query at one instant), then
 * the record key ascending. This is the list order and the cursor order.
 */
export function compareActivityBackfillCandidates(
  left: ActivityBackfillPosition, right: ActivityBackfillPosition,
): number {
  if (left.endedAt !== right.endedAt) return left.endedAt > right.endedAt ? -1 : 1;
  const leftRank = left.kind === 'run' ? 0 : 1;
  const rightRank = right.kind === 'run' ? 0 : 1;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.refKey === right.refKey) return 0;
  return left.refKey < right.refKey ? -1 : 1;
}

/** Sort the merged candidate list by the one L16 order. */
export function orderActivityBackfillCandidates<T extends ActivityBackfillPosition>(candidates: readonly T[]): T[] {
  return [...candidates].sort(compareActivityBackfillCandidates);
}

/**
 * Whether a candidate comes strictly after the cursor in the merged order, so
 * a page that resumes at the cursor never revisits it.
 */
export function activityBackfillCandidateAfter(
  candidate: ActivityBackfillPosition, cursor: ActivityBackfillCursor,
): boolean {
  return compareActivityBackfillCandidates(candidate,
    { endedAt: cursor.order, kind: cursor.kind, refKey: cursor.refKey }) > 0;
}

/** The cursor position of one candidate. */
export function activityBackfillCursorOf(candidate: ActivityBackfillPosition): ActivityBackfillCursor {
  return { order: candidate.endedAt, kind: candidate.kind, refKey: candidate.refKey };
}

export type ActivityBackfillCandidatePage = {
  candidates: ActivityBackfillCandidate[];
  next: ActivityBackfillCursor | null;
  /** R1: the commit cursor the candidate scan read at, so a request id is unique across Host lifetimes. */
  cursor: string | null;
};

export interface RunActivityPort {
  recordRunActivity(ctx: CoreCallContext, request: GraphWrite<{
    runRef: RunRef; facts: RunActivityFactsV1; expectedActivityRevision?: number | null;
  }>): Promise<WriteResult<{ outcome: 'created' | 'replaced' | 'unchanged'; snapshot: RunActivitySnapshot }>>;
  recordQueryActivity(ctx: CoreCallContext, request: GraphWrite<{
    queryRunRef: QueryRunRef; facts: RunActivityFactsV1; expectedActivityRevision?: number | null;
  }>): Promise<WriteResult<{ outcome: 'created' | 'replaced' | 'unchanged'; snapshot: QueryActivitySnapshot }>>;
  ensureActivityRecording(ctx: CoreCallContext, request: GraphWrite<{ workspace: WorkspaceScope }>):
    Promise<WriteResult<ActivityRecordingSnapshot>>;
  listActivityBackfillCandidates(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; mode: 'recent' | 'range'; from: string; to: string;
    after: ActivityBackfillCursor | null; limit: number;
  }): Promise<ReadResult<ActivityBackfillCandidatePage>>;
}

export type RunActivityServiceDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany' | 'lookupCommit' | 'commit' | 'eventAt'>
    & RecordLookupPort & RecordOrderedLookupPort;
  now(): string;
  eventId(): string;
  /** P4 injection points; production never passes them. */
  readRecordCap?: number;
  batchRuns?: number;
};

export type RunActivityWriteOutcome = ActivityWriteOutcome;
export type QueryActivityWriteOutcome = ActivityWriteOutcome;

// --------------------------------------------------------------------------
// Small pure helpers (shared shape with the other WorkGraph services)
// --------------------------------------------------------------------------

type HostActor = { kind: 'human' | 'system'; id: string };
type Trusted = { scope: WorkspaceScope; actor: HostActor };

function reject(code: CoreError, reason: string): CoreRejection {
  return rejected(code, reason);
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }

function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'revision_conflict': return reject('revision_conflict', failure.reason);
    case 'unique_conflict': return reject('busy', failure.reason);
    case 'idempotency_conflict': return reject('idempotency_conflict', failure.reason);
    case 'not_found': return reject('not_found', failure.reason);
    case 'invalid': return invalid(failure.reason);
    default: return unavailable(failure.reason);
  }
}

function trustedContext(ctx: CoreCallContext): { ok: true; value: Trusted } | { ok: false; rejection: CoreRejection } {
  const bound = ctx as unknown as { projectId?: unknown; workspaceId?: unknown; principal?: unknown; signal?: unknown };
  if (!nonEmpty(bound.projectId) || !nonEmpty(bound.workspaceId)) {
    return { ok: false, rejection: forbidden('an activity call requires a bound project/workspace context') };
  }
  const principal = bound.principal;
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return { ok: false, rejection: forbidden('an activity write requires a trusted Host principal') };
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: forbidden('an activity write requires a trusted Host actor') };
  }
  return { ok: true, value: { scope: { projectId: bound.projectId, workspaceId: bound.workspaceId },
    actor: { kind: actor['kind'], id: actor['id'] } } };
}

function parseRunRef(value: unknown): RunRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'Run' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) return null;
  return { aggregateType: 'Run', projectId: value['projectId'], goalId: value['goalId'], runId: value['runId'] };
}

/**
 * The candidate's CAS pin: absent, null (expect no record) or a positive revision. The
 * one reader both backfill writes use, so the two never drift.
 */
function expectedActivityRevisionOf(value: unknown): { ok: true; revision: number | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, revision: undefined };
  if (value === null) return { ok: true, revision: null };
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) return { ok: true, revision: value };
  return { ok: false };
}

/**
 * Whether the record still has the revision the candidate was selected at, so
 * a write that another writer overtook is refused, not applied over it. No pin
 * always matches; a pin of null expects no record yet. Both backfill writes
 * test their pin here.
 */
function activityRevisionMatches(expected: number | null | undefined, current: number | null): boolean {
  return expected === undefined || expected === current;
}

function identityKeyOf(prefix: string, actor: HostActor, scope: WorkspaceScope, requestId: string): string {
  return sha256Hex(canonicalJson({ kind: prefix, actor: { kind: actor.kind, id: actor.id },
    projectId: scope.projectId, workspaceId: scope.workspaceId, requestId } as unknown as JsonValue));
}
function fingerprintOf(value: unknown): string {
  return sha256Hex(canonicalJson(value as JsonValue));
}

// --------------------------------------------------------------------------
// L4: RunActivitySnapshot adapter over the shared replacement rule
// --------------------------------------------------------------------------

/**
 * The rule itself lives in `state/activity-replacement.ts` and takes the two
 * facts values. This wrapper is the only adaptation: `existing === null ?
 * null : existing.facts` keeps "no record" distinct from a present record
 * (whose `facts` the type always has); `existing?.facts ?? null` would widen
 * "no record" to "no facts".
 */
export function decideRunActivityOutcome(
  existing: RunActivitySnapshot | null,
  incoming: RunActivityFactsV1,
  endCommit: boolean,
): RunActivityWriteOutcome {
  return decideActivityOutcome(existing === null ? null : existing.facts, incoming, endCommit);
}

/**
 * Build the record a write would store, and its L4 outcome. The caller writes
 * only when the outcome is not `unchanged`. `revision` continues the existing
 * record's sequence, so a replace is a CAS-able new revision.
 */
export function planRunActivity(input: {
  existing: RunActivitySnapshot | null;
  ref: RunActivityRef;
  runRef: RunRef;
  taskId: string;
  workspaceId: string;
  sessionRef: SessionRef | null;
  runEndedAt: string;
  runStartedAt: string | null;
  facts: RunActivityFactsV1;
  recordedBy: 'run_end' | 'backfill';
  recordedAt: string;
  endCommit: boolean;
}): { outcome: RunActivityWriteOutcome; snapshot: RunActivitySnapshot } {
  const outcome = decideRunActivityOutcome(input.existing, input.facts, input.endCommit);
  if (outcome === 'unchanged' && input.existing !== null) return { outcome, snapshot: input.existing };
  const span = input.facts.status === 'counted'
    ? { firstAt: input.facts.window.turnStartedAt, lastAt: input.facts.window.lastRecordAt, basis: 'kernel' as const }
    : { firstAt: input.runStartedAt, lastAt: input.runEndedAt, basis: 'run_times' as const };
  const snapshot: RunActivitySnapshot = {
    ref: input.ref, revision: (input.existing?.revision ?? 0) + 1, schemaVersion: 1,
    runRef: input.runRef, taskId: input.taskId, workspaceId: input.workspaceId, sessionRef: input.sessionRef,
    runEndedAt: input.runEndedAt, recordedBy: input.recordedBy, recordedAt: input.recordedAt,
    facts: input.facts, span,
  };
  return { outcome, snapshot };
}

/** The RunActivity ref of one Run. */
export function runActivityRefOf(run: Pick<RunSnapshot, 'ref'>): RunActivityRef {
  return { aggregateType: 'RunActivity', projectId: run.ref.projectId, goalId: run.ref.goalId, runId: run.ref.runId };
}

/**
 * L5: build the RunActivity record an END commit appends, reading the current
 * record and applying L4. `record === null` means the commit writes nothing
 * (L4 rows 4 and 7). The end commit appends the record with NO extra event.
 */
export async function planRunActivityForCommit(
  records: Pick<GoalRecordTransactionPort, 'readMany'>,
  input: {
    activity: RunActivityFactsV1;
    run: RunSnapshot;
    runEndedAt: string;
    sessionRef: SessionRef | null;
    recordedBy: 'run_end' | 'backfill';
    recordedAt: string;
    endCommit: boolean;
  },
): Promise<{ ok: true; record: EncodedRecord | null; snapshot: RunActivitySnapshot; refKey: string; existingRevision: number | null }
  | { ok: false; rejection: CoreRejection }> {
  const run = input.run;
  const ref = runActivityRefOf(run);
  const key = runActivityRefKey(ref);
  let existing: RunActivitySnapshot | null = null;
  try {
    const read = await records.readMany([key]);
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record !== undefined) {
      const decoded = decodeRunActivitySnapshot(record);
      if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the RunActivity is damaged: ${decoded.reason}`) };
      existing = decoded.value;
    }
  } catch (error) {
    return { ok: false, rejection: unavailable(String(error instanceof Error ? error.message : error)) };
  }
  const planned = planRunActivity({ existing, ref, runRef: run.ref, taskId: run.task.taskId,
    workspaceId: run.workspaceSnapshot.workspaceId, sessionRef: input.sessionRef, runEndedAt: input.runEndedAt,
    runStartedAt: run.startedAt, facts: input.activity, recordedBy: input.recordedBy,
    recordedAt: input.recordedAt, endCommit: input.endCommit });
  return { ok: true, record: planned.outcome === 'unchanged' ? null : encodeRunActivitySnapshot(planned.snapshot),
    snapshot: planned.snapshot, refKey: key, existingRevision: existing?.revision ?? null };
}

/** A storage read that must fail the whole scan, never turn into an empty page. */
class UnavailableRead {
  constructor(readonly reason: string) {}
}

type RunInstantItem = {
  kind: 'run'; endedAt: string; refKey: string; ref: RunActivityRef; run: RunSnapshot;
};
type QueryInstantItem = {
  kind: 'query'; endedAt: string; refKey: string; ref: import('../../../contracts/run-activity.js').QueryActivityRef;
  run: QueryRunSnapshot;
};
type InstantItem = RunInstantItem | QueryInstantItem;

/** One ended-index record as a merged-list entry, decoded once; null for a record with no end instant. */
function instantItemOf(kind: 'run' | 'query', record: EncodedRecord): InstantItem | null {
  if (kind === 'run') {
    const decoded = decodeRun(record);
    if (!decoded.ok) throw new UnavailableRead(`a Run of the workspace is damaged: ${decoded.reason}`);
    const run = decoded.value;
    if (run.endedAt === null) return null;
    const item: RunInstantItem = { kind: 'run', endedAt: run.endedAt, refKey: record.refKey, ref: runActivityRefOf(run), run };
    return item;
  }
  const decoded = decodeQueryRunSnapshotRecord(record);
  if (decoded.status !== 'decoded') {
    throw new UnavailableRead(`a QueryRun of the workspace is damaged: ${decoded.reason}`);
  }
  const run = decoded.value;
  if (run.run.endedAt === null) return null;
  const item: QueryInstantItem = { kind: 'query', endedAt: run.run.endedAt, refKey: record.refKey,
    ref: queryActivityRefOf(run.ref), run };
  return item;
}

function runActivityRecordOf(record: EncodedRecord | undefined): RunActivitySnapshot | null | UnavailableRead {
  if (record === undefined) return null;
  const decoded = decodeRunActivitySnapshot(record);
  if (decoded.status !== 'decoded') return new UnavailableRead(`a RunActivity is damaged: ${decoded.reason}`);
  return decoded.value;
}

function queryActivityRecordOf(record: EncodedRecord | undefined): QueryActivitySnapshot | null | UnavailableRead {
  if (record === undefined) return null;
  const decoded = decodeQueryActivitySnapshot(record);
  if (decoded.status !== 'decoded') return new UnavailableRead(`a QueryActivity is damaged: ${decoded.reason}`);
  return decoded.value;
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createRunActivityService(deps: RunActivityServiceDependencies): RunActivityPort {
  const { records } = deps;

  async function readRun(runRef: RunRef): Promise<{ ok: true; run: RunSnapshot } | { ok: false; rejection: CoreRejection }> {
    const key = canonicalJson(runRef as unknown as JsonValue);
    let read;
    try { read = await records.readMany([key]); } catch (error) { return { ok: false, rejection: unavailable(String(error instanceof Error ? error.message : error)) }; }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) return { ok: false, rejection: reject('not_found', `Run ${runRef.runId} does not exist`) };
    const decoded = decodeRun(record);
    if (!decoded.ok) return { ok: false, rejection: unavailable(`the Run is damaged: ${decoded.reason}`) };
    return { ok: true, run: decoded.value };
  }

  async function readActivity(ref: RunActivityRef): Promise<{ ok: true; record: EncodedRecord | null; snapshot: RunActivitySnapshot | null } | { ok: false; rejection: CoreRejection }> {
    const key = runActivityRefKey(ref);
    let read;
    try { read = await records.readMany([key]); } catch (error) { return { ok: false, rejection: unavailable(String(error instanceof Error ? error.message : error)) }; }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key) ?? null;
    if (record === null) return { ok: true, record: null, snapshot: null };
    const decoded = decodeRunActivitySnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the RunActivity is damaged: ${decoded.reason}`) };
    return { ok: true, record, snapshot: decoded.value };
  }

  /**
   * L17: the locator's Session first, else the dispatch claim's Session, else
   * `null` when no dispatch record exists (a legitimate old execution, F15).
   * A dispatch read that fails (`not ready`) or throws, and a dispatch record
   * that does not decode, is RETURNED as a rejection: L17's last bullet says any
   * read failure fails the read, so it must never be written as `sessionRef:
   * null`, which would fabricate "old execution" (rule 3).
   */
  async function sessionRefOf(run: RunSnapshot):
    Promise<{ ok: true; sessionRef: SessionRef | null } | { ok: false; rejection: CoreRejection }> {
    const locator = run.executionHistory;
    if (locator !== undefined) {
      return { ok: true, sessionRef: { projectId: locator.sessionRef.projectId, sessionId: locator.sessionRef.sessionId } };
    }
    const key = dispatchOutboxRefKey({ aggregateType: 'DispatchOutboxEntry', projectId: run.ref.projectId,
      goalId: run.ref.goalId, taskId: run.task.taskId, attemptId: run.attemptId });
    let read;
    try { read = await records.readMany([key]); } catch (error) {
      return { ok: false, rejection: unavailable(String(error instanceof Error ? error.message : error)) };
    }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) return { ok: true, sessionRef: null };
    const decoded = decodeDispatchOutboxEntry(record);
    if (decoded.status !== 'decoded') {
      return { ok: false, rejection: unavailable(`the dispatch claim is damaged: ${decoded.reason}`) };
    }
    return { ok: true, sessionRef: { projectId: decoded.value.claim.sessionRef.projectId,
      sessionId: decoded.value.claim.sessionRef.sessionId } };
  }

  /** The one event a replay receipt must name, read back at its cursor. */
  async function eventOfActivityReceipt(
    receipt: { cursor: import('../../../contracts/command-event.js').CommitCursor; eventIds: string[] }, label: string,
  ): Promise<{ ok: true; event: import('../../record-store/ports.js').EncodedDomainEvent }
    | { ok: false; rejection: CoreRejection }> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return { ok: false, rejection: unavailable(`the recorded ${label} receipt does not name exactly one event`) };
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return { ok: false, rejection: mapStoreFailure(at) };
    if (String(at.value.cursor) !== String(receipt.cursor)) {
      return { ok: false, rejection: unavailable(`the recorded ${label} cursor disagrees with the receipt`) };
    }
    return { ok: true, event: at.value.event };
  }

  async function replayRunActivity(
    receipt: { cursor: import('../../../contracts/command-event.js').CommitCursor; eventIds: string[] },
  ): Promise<WriteResult<{ outcome: RunActivityWriteOutcome; snapshot: RunActivitySnapshot }>> {
    const found = await eventOfActivityReceipt(receipt, 'RunActivity');
    if (!found.ok) return found.rejection;
    const decoded = runActivityRecordedEventFromEvent(found.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded RunActivity event is not decodable: ${decoded.reason}`);
    return { status: 'committed', value: { outcome: 'created', snapshot: decoded.value.runActivity }, replayed: true, cursor: receipt.cursor };
  }

  async function replayQueryActivity(
    receipt: { cursor: import('../../../contracts/command-event.js').CommitCursor; eventIds: string[] },
  ): Promise<WriteResult<{ outcome: QueryActivityWriteOutcome; snapshot: QueryActivitySnapshot }>> {
    const found = await eventOfActivityReceipt(receipt, 'QueryActivity');
    if (!found.ok) return found.rejection;
    const decoded = queryActivityRecordedEventFromEvent(found.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded QueryActivity event is not decodable: ${decoded.reason}`);
    return { status: 'committed', value: { outcome: 'created', snapshot: decoded.value.queryActivity }, replayed: true, cursor: receipt.cursor };
  }

  async function recordRunActivity(
    ctx: CoreCallContext,
    request: GraphWrite<{ runRef: RunRef; facts: RunActivityFactsV1; expectedActivityRevision?: number | null }>,
  ): Promise<WriteResult<{ outcome: RunActivityWriteOutcome; snapshot: RunActivitySnapshot }>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted.value;
    const raw = request as unknown as { input?: unknown; meta?: unknown } | null | undefined;
    if (raw === null || raw === undefined || !isRecord(raw.input) || !isRecord(raw.meta) || !nonEmpty(raw.meta['requestId'])) {
      return invalid('recordRunActivity requires an input and a meta.requestId');
    }
    const runRef = parseRunRef(raw.input['runRef']);
    if (runRef === null) return invalid('recordRunActivity requires a complete RunRef');
    if (runRef.projectId !== scope.projectId) return forbidden('the Run belongs to another project');
    const facts = raw.input['facts'] as RunActivityFactsV1 | undefined;
    if (!isRecord(facts) || (facts.status !== 'counted' && facts.status !== 'unknown')) {
      return invalid('recordRunActivity requires RunActivityFactsV1');
    }
    // R13: the optional CAS-pin the backfill captured at candidate selection. It
    // distinguishes "another writer advanced the record after selection" from an
    // ordinary unchanged retry.
    const pin = expectedActivityRevisionOf(raw.input['expectedActivityRevision']);
    if (!pin.ok) return invalid('expectedActivityRevision must be a positive integer or null');
    const expectedActivityRevision = pin.revision;
    const runRead = await readRun(runRef);
    if (!runRead.ok) return runRead.rejection;
    const run = runRead.run;
    if (run.workspaceSnapshot.workspaceId !== scope.workspaceId) return forbidden('the Run belongs to another workspace');
    if (run.status !== 'ended' || run.endedAt === null) return invalid('recordRunActivity requires an ended Run with an endedAt');
    const ref = runActivityRefOf(run);
    const input = { runRef, facts };
    const identity = identityKeyOf('s2b-run-activity', actor, scope, raw.meta['requestId'] as string);
    const fingerprint = fingerprintOf({ kind: 's2b-run-activity', actor: { kind: actor.kind, id: actor.id },
      input, expected: [{ ref: runRef, revision: run.revision }] });
    const priorLookup = await records.lookupCommit({ identityKey: identity, fingerprint });
    if (priorLookup.status === 'ready') return replayRunActivity(priorLookup.value);
    if (priorLookup.code !== 'not_found') return mapStoreFailure(priorLookup);
    const existing = await readActivity(ref);
    if (!existing.ok) return existing.rejection;
    const currentRevision = existing.record === null ? null : existing.record.revision;
    if (!activityRevisionMatches(expectedActivityRevision, currentRevision)) {
      return reject('revision_conflict',
        `the RunActivity revision changed from ${String(expectedActivityRevision)} to ${String(currentRevision)}`);
    }
    const sessionLookup = await sessionRefOf(run);
    if (!sessionLookup.ok) return sessionLookup.rejection;
    const sessionRef = sessionLookup.sessionRef;
    const planned = planRunActivity({ existing: existing.snapshot, ref, runRef, taskId: run.task.taskId,
      workspaceId: run.workspaceSnapshot.workspaceId, sessionRef, runEndedAt: run.endedAt, runStartedAt: run.startedAt,
      facts, recordedBy: 'backfill', recordedAt: deps.now(), endCommit: false });
    if (planned.outcome === 'unchanged') {
      return { status: 'committed', value: { outcome: 'unchanged', snapshot: planned.snapshot }, replayed: true,
        cursor: '' as unknown as CommitCursor };
    }
    const record = encodeRunActivitySnapshot(planned.snapshot);
    const event: RunActivityRecordedEventV1 = { eventId: deps.eventId(), eventType: RUN_ACTIVITY_RECORDED_EVENT_TYPE,
      schemaVersion: RUN_ACTIVITY_EVENT_SCHEMA_VERSION, occurredAt: planned.snapshot.recordedAt,
      projectId: scope.projectId, workspaceId: scope.workspaceId, runActivity: planned.snapshot };
    const guards: RecordGuard[] = [{ refKey: record.refKey,
      expectedRevision: existing.record === null ? null : existing.record.revision }];
    const prepared: PreparedCommit = { identityKey: identity, fingerprint, guards, records: [record], claims: [],
      indexGuards: [], indexChanges: [], events: [encodeRunActivityRecordedEvent(event)] };
    if (ctx.signal?.aborted) return reject('cancelled', 'the activity write was cancelled before commit');
    const receipt = await records.commit(prepared);
    if (receipt.status !== 'committed') return mapStoreFailure(receipt);
    if (receipt.replayed) return replayRunActivity(receipt);
    return { status: 'committed', value: { outcome: planned.outcome, snapshot: planned.snapshot }, replayed: false, cursor: receipt.cursor };
  }

  async function readQueryRun(queryRunRef: QueryRunRef):
    Promise<{ ok: true; record: EncodedRecord; run: QueryRunSnapshot } | { ok: false; rejection: CoreRejection }> {
    const key = canonicalJson(queryRunRef as unknown as JsonValue);
    let read;
    try { read = await records.readMany([key]); } catch (error) {
      return { ok: false, rejection: unavailable(String(error instanceof Error ? error.message : error)) };
    }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) return { ok: false, rejection: reject('not_found', `QueryRun ${queryRunRef.runId} does not exist`) };
    const decoded = decodeQueryRunSnapshotRecord(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the QueryRun is damaged: ${decoded.reason}`) };
    return { ok: true, record, run: decoded.value };
  }

  async function readQueryJobForActivity(queryJobRef: QueryJobRef):
    Promise<{ ok: true; job: QueryJobSnapshot } | { ok: false; rejection: CoreRejection }> {
    const key = canonicalJson(queryJobRef as unknown as JsonValue);
    let read;
    try { read = await records.readMany([key]); } catch (error) {
      return { ok: false, rejection: unavailable(String(error instanceof Error ? error.message : error)) };
    }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) return { ok: false, rejection: reject('not_found', `QueryJob ${queryJobRef.queryJobId} does not exist`) };
    const decoded = decodeQueryJobSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the QueryJob is damaged: ${decoded.reason}`) };
    return { ok: true, job: decoded.value };
  }

  async function readQueryActivity(ref: import('../../../contracts/run-activity.js').QueryActivityRef): Promise<
    { ok: true; record: EncodedRecord | null; snapshot: QueryActivitySnapshot | null }
    | { ok: false; rejection: CoreRejection }> {
    const key = queryActivityRefKey(ref);
    let read;
    try { read = await records.readMany([key]); } catch (error) {
      return { ok: false, rejection: unavailable(String(error instanceof Error ? error.message : error)) };
    }
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key) ?? null;
    if (record === null) return { ok: true, record: null, snapshot: null };
    const decoded = decodeQueryActivitySnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the QueryActivity is damaged: ${decoded.reason}`) };
    return { ok: true, record, snapshot: decoded.value };
  }

  /**
   * L16's backfill write of one Query's tally. It is the same rule as
   * `recordRunActivity`: one identity per request, a CAS pin from candidate
   * selection, the shared replacement plan with `endCommit: false`, and a replay
   * of the recorded event. The record's goal and Sessions are the Query's own
   * persisted facts, never a caller's.
   */
  async function recordQueryActivity(
    ctx: CoreCallContext,
    request: GraphWrite<{ queryRunRef: QueryRunRef; facts: RunActivityFactsV1; expectedActivityRevision?: number | null }>,
  ): Promise<WriteResult<{ outcome: QueryActivityWriteOutcome; snapshot: QueryActivitySnapshot }>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted.value;
    const raw = request as unknown as { input?: unknown; meta?: unknown } | null | undefined;
    if (raw === null || raw === undefined || !isRecord(raw.input) || !isRecord(raw.meta) || !nonEmpty(raw.meta['requestId'])) {
      return invalid('recordQueryActivity requires an input and a meta.requestId');
    }
    const queryRunRef = queryRunRefFromValue(raw.input['queryRunRef']);
    if (queryRunRef === null) return invalid('recordQueryActivity requires a complete QueryRunRef');
    if (queryRunRef.projectId !== scope.projectId) return forbidden('the Query belongs to another project');
    const facts = raw.input['facts'] as RunActivityFactsV1 | undefined;
    if (!isRecord(facts) || (facts.status !== 'counted' && facts.status !== 'unknown')) {
      return invalid('recordQueryActivity requires RunActivityFactsV1');
    }
    const pin = expectedActivityRevisionOf(raw.input['expectedActivityRevision']);
    if (!pin.ok) return invalid('expectedActivityRevision must be a positive integer or null');
    const expectedActivityRevision = pin.revision;
    const runRead = await readQueryRun(queryRunRef);
    if (!runRead.ok) return runRead.rejection;
    const run = runRead.run;
    if (queryRunRef.workspaceId !== scope.workspaceId) return forbidden('the Query belongs to another workspace');
    if (run.run.endedAt === null) {
      return invalid('recordQueryActivity requires an ended QueryRun with an endedAt');
    }
    const jobRead = await readQueryJobForActivity({ aggregateType: 'QueryJob', projectId: queryRunRef.projectId,
      workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId });
    if (!jobRead.ok) return jobRead.rejection;
    // The goal and the two Sessions come from the one reading the closing
    // write uses, so both writers name the same ones.
    const source = queryActivitySourceOf(jobRead.job, run);
    if (!source.ok) return invalid(source.reason);
    const ref = queryActivityRefOf(queryRunRef);
    const input = { queryRunRef, facts };
    const identity = identityKeyOf('s6-query-activity-backfill', actor, scope, raw.meta['requestId'] as string);
    const fingerprint = fingerprintOf({ kind: 's6-query-activity-backfill', actor: { kind: actor.kind, id: actor.id },
      input, expected: [{ ref: queryRunRef, revision: run.revision }] });
    const priorLookup = await records.lookupCommit({ identityKey: identity, fingerprint });
    if (priorLookup.status === 'ready') return replayQueryActivity(priorLookup.value);
    if (priorLookup.code !== 'not_found') return mapStoreFailure(priorLookup);
    const existing = await readQueryActivity(ref);
    if (!existing.ok) return existing.rejection;
    const currentRevision = existing.record === null ? null : existing.record.revision;
    if (!activityRevisionMatches(expectedActivityRevision, currentRevision)) {
      return reject('revision_conflict',
        `the QueryActivity revision changed from ${String(expectedActivityRevision)} to ${String(currentRevision)}`);
    }
    const planned = planQueryActivityWrite(existing.snapshot, facts, {
      queryRunRef, ...source.source, queryEndedAt: run.run.endedAt, queryStartedAt: run.run.startedAt,
      recordedBy: 'backfill', recordedAt: deps.now(), endCommit: false,
    });
    if (planned.outcome === 'unchanged') {
      return { status: 'committed', value: { outcome: 'unchanged', snapshot: planned.snapshot }, replayed: true,
        cursor: '' as unknown as CommitCursor };
    }
    const record = encodeQueryActivitySnapshot(planned.snapshot);
    const event: QueryActivityRecordedEventV1 = { eventId: deps.eventId(),
      eventType: QUERY_ACTIVITY_RECORDED_EVENT_TYPE, schemaVersion: QUERY_ACTIVITY_EVENT_SCHEMA_VERSION,
      occurredAt: planned.snapshot.recordedAt, projectId: scope.projectId, workspaceId: scope.workspaceId,
      queryActivity: planned.snapshot };
    const guards: RecordGuard[] = [{ refKey: record.refKey,
      expectedRevision: existing.record === null ? null : existing.record.revision }];
    const prepared: PreparedCommit = { identityKey: identity, fingerprint, guards, records: [record], claims: [],
      indexGuards: [], indexChanges: [], events: [encodeQueryActivityRecordedEvent(event)] };
    if (ctx.signal?.aborted) return reject('cancelled', 'the activity write was cancelled before commit');
    const receipt = await records.commit(prepared);
    if (receipt.status !== 'committed') return mapStoreFailure(receipt);
    if (receipt.replayed) return replayQueryActivity(receipt);
    return { status: 'committed', value: { outcome: planned.outcome, snapshot: planned.snapshot }, replayed: false,
      cursor: receipt.cursor };
  }

  async function replayActivityRecording(
    receipt: { cursor: import('../../../contracts/command-event.js').CommitCursor; eventIds: string[] },
  ): Promise<WriteResult<ActivityRecordingSnapshot>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return unavailable('the recorded ActivityRecording receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (String(at.value.cursor) !== String(receipt.cursor)) return unavailable('the recorded ActivityRecording cursor disagrees with the receipt');
    const decoded = activityRecordingStartedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded ActivityRecording event is not decodable: ${decoded.reason}`);
    return { status: 'committed', value: decoded.value.activityRecording, replayed: true, cursor: receipt.cursor };
  }

  async function ensureActivityRecording(
    ctx: CoreCallContext,
    request: GraphWrite<{ workspace: WorkspaceScope }>,
  ): Promise<WriteResult<ActivityRecordingSnapshot>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor } = trusted.value;
    const raw = request as unknown as { input?: unknown; meta?: unknown } | null | undefined;
    if (raw === null || raw === undefined || !isRecord(raw.input) || !isRecord(raw.meta) || !nonEmpty(raw.meta['requestId'])) {
      return invalid('ensureActivityRecording requires an input and a meta.requestId');
    }
    const workspace = raw.input['workspace'];
    if (!isRecord(workspace) || !nonEmpty(workspace['projectId']) || !nonEmpty(workspace['workspaceId'])) {
      return invalid('ensureActivityRecording requires a WorkspaceScope');
    }
    if (workspace['projectId'] !== scope.projectId || workspace['workspaceId'] !== scope.workspaceId) {
      return forbidden('the workspace belongs to another scope');
    }
    const ref: ActivityRecordingRef = { aggregateType: 'ActivityRecording', projectId: scope.projectId, workspaceId: scope.workspaceId };
    const key = activityRecordingRefKey(ref);
    const existingRead = await records.readMany([key]);
    if (existingRead.status !== 'ready') return mapStoreFailure(existingRead);
    const existing = existingRead.value.records.find((candidate) => candidate.refKey === key);
    if (existing !== undefined) {
      const decoded = decodeActivityRecordingSnapshot(existing);
      if (decoded.status !== 'decoded') return unavailable(`the ActivityRecording is damaged: ${decoded.reason}`);
      const current: WriteResult<ActivityRecordingSnapshot> = { status: 'committed', value: decoded.value, replayed: true,
        cursor: existingRead.value.readThrough ?? ('' as unknown as CommitCursor) };
      // A record whose creating commit opened both epochs (revision 1 with a
      // `querySince`) never had a Query epoch commit: that commit needs
      // `querySince: null` and writes revision + 1. No epoch receipt can exist,
      // so it answers without a receipt lookup (every Host start reaches here).
      if (decoded.value.revision === 1 && decoded.value.querySince !== null) return current;
      // L16: an epoch created before Query recording existed gets its Query
      // epoch in ONE commit of its own; `since` and the Work epoch stay as they
      // are. The identity and fingerprint carry only the request (never the
      // revision read or the clock), and the receipt is looked up before the
      // record's current value or the clock is consulted, so a retry of that
      // commit replays its own receipt instead of answering the current record.
      const epochIdentity = identityKeyOf('s2b-activity-recording-query-since', actor, scope, raw.meta['requestId'] as string);
      const epochFingerprint = fingerprintOf({ kind: 's2b-activity-recording-query-since',
        actor: { kind: actor.kind, id: actor.id }, ref });
      const epochLookup = await records.lookupCommit({ identityKey: epochIdentity, fingerprint: epochFingerprint });
      if (epochLookup.status === 'ready') return replayActivityRecording(epochLookup.value);
      if (epochLookup.code !== 'not_found') return mapStoreFailure(epochLookup);
      if (decoded.value.querySince !== null) return current;
      const now = deps.now();
      const snapshot: ActivityRecordingSnapshot = { ...decoded.value, revision: decoded.value.revision + 1, querySince: now };
      const epochEvent: ActivityRecordingStartedEventV1 = { eventId: deps.eventId(), eventType: ACTIVITY_RECORDING_STARTED_EVENT_TYPE,
        schemaVersion: RUN_ACTIVITY_EVENT_SCHEMA_VERSION, occurredAt: now,
        projectId: scope.projectId, workspaceId: scope.workspaceId, activityRecording: snapshot };
      // The compare-and-swap still guards the revision this call read.
      const epochPrepared: PreparedCommit = { identityKey: epochIdentity, fingerprint: epochFingerprint,
        guards: [{ refKey: key, expectedRevision: decoded.value.revision }],
        records: [encodeActivityRecordingSnapshot(snapshot)], claims: [], indexGuards: [], indexChanges: [],
        events: [encodeActivityRecordingStartedEvent(epochEvent)] };
      if (ctx.signal?.aborted) return reject('cancelled', 'the query activity epoch was cancelled before commit');
      let epochReceipt;
      try {
        epochReceipt = await records.commit(epochPrepared);
      } catch (error) {
        // A commit that threw may still have landed: its own receipt answers,
        // found by the same identity and fingerprint; it is never committed again.
        const recovered = await records.lookupCommit({ identityKey: epochIdentity, fingerprint: epochFingerprint });
        if (recovered.status === 'ready') return replayActivityRecording(recovered.value);
        return unavailable(`the query activity epoch commit failed: ${String(error instanceof Error ? error.message : error)}`);
      }
      if (epochReceipt.status !== 'committed') return mapStoreFailure(epochReceipt);
      if (epochReceipt.replayed) return replayActivityRecording(epochReceipt);
      return { status: 'committed', value: snapshot, replayed: false, cursor: epochReceipt.cursor };
    }
    const identity = identityKeyOf('s2b-activity-recording', actor, scope, raw.meta['requestId'] as string);
    const fingerprint = fingerprintOf({ kind: 's2b-activity-recording', actor: { kind: actor.kind, id: actor.id }, ref });
    const priorLookup = await records.lookupCommit({ identityKey: identity, fingerprint });
    if (priorLookup.status === 'ready') return replayActivityRecording(priorLookup.value);
    if (priorLookup.code !== 'not_found') return mapStoreFailure(priorLookup);
    // L16: the first commit of a workspace opens both epochs from one clock read.
    const now = deps.now();
    const snapshot: ActivityRecordingSnapshot = { ref, revision: 1, schemaVersion: 1, since: now, querySince: now };
    const event: ActivityRecordingStartedEventV1 = { eventId: deps.eventId(), eventType: ACTIVITY_RECORDING_STARTED_EVENT_TYPE,
      schemaVersion: RUN_ACTIVITY_EVENT_SCHEMA_VERSION, occurredAt: now,
      projectId: scope.projectId, workspaceId: scope.workspaceId, activityRecording: snapshot };
    const prepared: PreparedCommit = { identityKey: identity, fingerprint,
      guards: [{ refKey: key, expectedRevision: null }], records: [encodeActivityRecordingSnapshot(snapshot)], claims: [],
      indexGuards: [], indexChanges: [], events: [encodeActivityRecordingStartedEvent(event)] };
    if (ctx.signal?.aborted) return reject('cancelled', 'the activity recording was cancelled before commit');
    const receipt = await records.commit(prepared);
    if (receipt.status !== 'committed') return mapStoreFailure(receipt);
    if (receipt.replayed) return replayActivityRecording(receipt);
    return { status: 'committed', value: snapshot, replayed: false, cursor: receipt.cursor };
  }

  async function listActivityBackfillCandidates(
    ctx: CoreCallContext,
    input: { workspace: WorkspaceScope; mode: 'recent' | 'range'; from: string; to: string;
      after: ActivityBackfillCursor | null; limit: number },
  ): Promise<ReadResult<ActivityBackfillCandidatePage>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope } = trusted.value;
    const raw = input as unknown as Record<string, unknown> | null | undefined;
    if (raw === null || raw === undefined || !isRecord(raw['workspace'])) {
      return invalid('listActivityBackfillCandidates requires a workspace');
    }
    const workspace = raw['workspace'] as WorkspaceScope;
    if (workspace.projectId !== scope.projectId || workspace.workspaceId !== scope.workspaceId) {
      return forbidden('the workspace belongs to another scope');
    }
    if (!nonEmpty(raw['from']) || !nonEmpty(raw['to'])) return invalid('listActivityBackfillCandidates requires from and to');
    const mode = raw['mode'];
    if (mode !== 'recent' && mode !== 'range') return invalid("mode must be 'recent' or 'range'");
    const limit = raw['limit'];
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) return invalid('limit must be a positive integer');
    const cap = deps.readRecordCap ?? ACTIVITY_READ_RECORD_CAP;
    const afterRaw = raw['after'];
    const after: ActivityBackfillCursor | null = isRecord(afterRaw) && nonEmpty(afterRaw['order'])
      && nonEmpty(afterRaw['refKey']) && (afterRaw['kind'] === 'run' || afterRaw['kind'] === 'query')
      ? { order: afterRaw['order'] as string, kind: afterRaw['kind'] as 'run' | 'query',
        refKey: afterRaw['refKey'] as string }
      : null;
    const recentOnly = mode === 'recent';

    // One epoch read for the workspace: the Work `since` exclusion and R1's
    // commit cursor.
    const epochKey = activityRecordingRefKey({ aggregateType: 'ActivityRecording', projectId: scope.projectId,
      workspaceId: scope.workspaceId });
    const epochRead = await records.readMany([epochKey]);
    if (epochRead.status !== 'ready') return mapStoreFailure(epochRead);
    let scanCursor: string | null = null;
    if (epochRead.value.readThrough !== null && epochRead.value.readThrough !== undefined) {
      scanCursor = String(epochRead.value.readThrough);
    }
    const epochRecord = epochRead.value.records.find(candidate => candidate.refKey === epochKey);
    let since: string | null = null;
    if (epochRecord !== undefined) {
      const decoded = decodeActivityRecordingSnapshot(epochRecord);
      if (decoded.status !== 'decoded') return unavailable(`the ActivityRecording is damaged: ${decoded.reason}`);
      since = decoded.value.since;
    }

    // The two ended indexes, each in index order (newest first), merged by the
    // one order. L8's read cap bounds the index records one call reads, each
    // counted once when its page is read. Until the call has checked its first
    // position after the cursor every page it needs is read, so each call moves
    // on; after that a page is read only while the budget lasts. The records
    // already read are checked before the scan stops on the budget, and `next`
    // is then the last position checked: only an index with nothing more, or
    // an entry older than `from`, ends the scan.
    let scanned = 0;
    let checked = false;
    type Instant = { at: string; items: InstantItem[] };
    function streamOf(kind: 'run' | 'query', upper: { value: string; inclusive: boolean }) {
      let keyset: { order: string | number; refKey: string } | null = null;
      let more = true;
      let buffer: InstantItem[] = [];
      let lookahead: InstantItem | null = null;
      /** The next entry in index order: null at the end, 'spent' when it needs a page past the budget. */
      async function nextItem(): Promise<InstantItem | null | 'spent'> {
        for (;;) {
          const head = buffer.shift();
          if (head !== undefined) return head;
          if (!more) return null;
          if (checked && scanned >= cap) return 'spent';
          let page;
          try {
            page = await records.lookupOrdered({
              index: kind === 'run' ? S2B_RUN_BY_WORKSPACE_ENDED_LOOKUP : S6_QUERY_RUN_BY_WORKSPACE_ENDED_LOOKUP,
              values: [scope.projectId, scope.workspaceId], direction: 'desc', bound: upper,
              ...(keyset === null ? {} : { after: keyset }), limit: 100,
            });
          } catch (error) {
            throw new UnavailableRead(String(error instanceof Error ? error.message : error));
          }
          if (page.status !== 'ready') throw new UnavailableRead(page.reason);
          if (page.value.readThrough !== null && page.value.readThrough !== undefined) {
            scanCursor = String(page.value.readThrough);
          }
          scanned += page.value.records.length;
          buffer = page.value.records.flatMap(record => instantItemOf(kind, record) ?? []);
          // The index names the keyset after this page, or null when nothing follows.
          keyset = page.value.next;
          more = keyset !== null;
        }
      }
      return {
        /**
         * The stream's next whole instant (every entry with that end instant):
         * null when none is left in the window, 'spent' when completing it
         * needs a page past the budget.
         */
        async readInstant(): Promise<Instant | null | 'spent'> {
          const first = lookahead ?? await nextItem();
          lookahead = null;
          if (first === null || first === 'spent') return first;
          if (first.endedAt < input.from) { more = false; buffer = []; return null; }
          const items = [first];
          for (;;) {
            const next = await nextItem();
            if (next === 'spent') return 'spent';
            if (next === null || next.endedAt !== first.endedAt) { lookahead = next; break; }
            items.push(next);
          }
          return { at: first.endedAt, items };
        },
      };
    }

    // The request's `to` stays the exclusive upper bound; a cursor below it
    // starts the read at the cursor's own instant instead, so that instant's
    // ties can be ordered again and the entries up to the cursor dropped.
    const upper = after === null || after.order >= input.to
      ? { value: input.to, inclusive: false } : { value: after.order, inclusive: true };
    const runStream = streamOf('run', upper);
    const queryStream = streamOf('query', upper);
    const candidates: ActivityBackfillCandidate[] = [];
    let last: ActivityBackfillCursor | null = null;
    let exhausted = false;
    try {
      let runInstant = await runStream.readInstant();
      let queryInstant = await queryStream.readInstant();
      scan: for (;;) {
        if (runInstant === 'spent' || queryInstant === 'spent') break;
        // The next instant is whichever stream head comes first in the one order.
        const runAt = runInstant?.at ?? null;
        const queryAt = queryInstant?.at ?? null;
        const at = runAt === null ? queryAt : queryAt === null ? runAt
          : compareActivityBackfillCandidates({ endedAt: runAt, kind: 'run', refKey: '' },
            { endedAt: queryAt, kind: 'query', refKey: '' }) <= 0 ? runAt : queryAt;
        if (at === null) { exhausted = true; break; }
        // The instant is whole, so its order is the one L16 order; the entries
        // up to the cursor were checked by an earlier call.
        const ordered = orderActivityBackfillCandidates<InstantItem>([
          ...(runInstant?.at === at ? runInstant.items : []),
          ...(queryInstant?.at === at ? queryInstant.items : []),
        ]).filter(item => after === null || activityBackfillCandidateAfter(item, after));
        if (ordered.length > 0) {
          // One activity-key read for the instant's entries after the cursor.
          const activityKeys = ordered.map(item => item.kind === 'run'
            ? runActivityRefKey(item.ref) : queryActivityRefKey(item.ref));
          const activities = await records.readMany([...new Set(activityKeys)]);
          if (activities.status !== 'ready') return mapStoreFailure(activities);
          if (activities.value.readThrough !== null && activities.value.readThrough !== undefined) {
            scanCursor = String(activities.value.readThrough);
          }
          const byKey = new Map(activities.value.records.map(record => [record.refKey, record]));
          for (const item of ordered) {
            checked = true;
            last = activityBackfillCursorOf(item);
            let candidate: ActivityBackfillCandidate | null;
            if (item.kind === 'run') {
              const snapshot = runActivityRecordOf(byKey.get(runActivityRefKey(item.ref)));
              if (snapshot instanceof UnavailableRead) return unavailable(snapshot.reason);
              candidate = isBackfillCandidate(item.run, snapshot, since, recentOnly)
                ? { kind: 'run', runRef: item.run.ref, activityRevision: snapshot?.revision ?? null } : null;
            } else {
              const snapshot = queryActivityRecordOf(byKey.get(queryActivityRefKey(item.ref)));
              if (snapshot instanceof UnavailableRead) return unavailable(snapshot.reason);
              candidate = isQueryBackfillCandidate(item.run, snapshot, recentOnly)
                ? { kind: 'query', queryRunRef: item.run.ref, activityRevision: snapshot?.revision ?? null } : null;
            }
            if (candidate !== null) {
              candidates.push(candidate);
              // A full page returns at once; the next instant is not read.
              if (candidates.length >= limit) break scan;
            }
          }
        }
        if (runInstant?.at === at) runInstant = await runStream.readInstant();
        if (queryInstant?.at === at) queryInstant = await queryStream.readInstant();
      }
    } catch (error) {
      if (error instanceof UnavailableRead) return unavailable(error.reason);
      return unavailable(String(error instanceof Error ? error.message : error));
    }
    return { status: 'ready', value: { candidates, next: exhausted ? null : last, cursor: scanCursor } };
  }
  return { recordRunActivity, recordQueryActivity, ensureActivityRecording, listActivityBackfillCandidates };
}

/**
 * L8's rule for a record that already exists, the same for a Work Run and a
 * Query: a record of an older rule version is redone; a counted one is never
 * recounted; an unknown one is retried by the human range backfill always and
 * by the automatic one only for the auto-retry reasons.
 */
function shouldBackfillRecordedActivity(facts: RunActivityFactsV1, recentOnly: boolean): boolean {
  if (facts.ruleVersion < RUN_ACTIVITY_RULE_VERSION) return true;
  if (facts.status === 'counted') return false;
  if (!recentOnly) return true;
  return (ACTIVITY_AUTO_RETRY_REASONS as readonly string[]).includes(facts.reason);
}

/**
 * L8 candidate rules. `snapshot === null` means no record yet. The shared L7
 * predicate decides "never entered, so no record is expected"; every other Run
 * without a locator is an old/missing execution and stays a candidate (2B-42),
 * so the human range backfill can write its `unknown('no_history_locator')`.
 */
function isBackfillCandidate(run: RunSnapshot, snapshot: RunActivitySnapshot | null, since: string | null, recentOnly: boolean): boolean {
  if (snapshot === null) return !provenNotEnteredKernel(run, since);
  return shouldBackfillRecordedActivity(snapshot.facts, recentOnly);
}

/**
 * L16's Query candidate rules, the Work rules applied to a QueryRun. A Query
 * that never entered the Kernel has no record to fill (`not_entered` on the
 * read side), so it is not a candidate. An entered, ended Query without a
 * record is one whenever it ended: one that ended before the Query epoch reads
 * `not_backfilled` and, once backfilled, as normal (R-16). A record that exists
 * follows the Work rule.
 */
function isQueryBackfillCandidate(
  run: QueryRunSnapshot, snapshot: QueryActivitySnapshot | null, recentOnly: boolean,
): boolean {
  const state = run.run.executionState;
  if (state === undefined || state.entry === null || run.run.outcome === 'not_entered') return false;
  if (run.run.endedAt === null) return false;
  if (snapshot === null) return true;
  return shouldBackfillRecordedActivity(snapshot.facts, recentOnly);
}
