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
 * `ensureActivityRecording` creates the workspace's `ActivityRecording` once;
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
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  ACTIVITY_AUTO_RETRY_REASONS, ACTIVITY_READ_RECORD_CAP, RUN_ACTIVITY_RULE_VERSION,
  provenNotEnteredKernel,
} from '../../../contracts/run-activity.js';
import type {
  ActivityRecordingRef, ActivityRecordingSnapshot, RunActivityFactsV1, RunActivityRef, RunActivitySnapshot,
} from '../../../contracts/run-activity.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import { dispatchOutboxRefKey, decodeDispatchOutboxEntry } from './claim-record-codecs.js';
import type { EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreFailure } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GraphWrite } from '../model/task-contracts.js';
import { decideActivityOutcome, type ActivityWriteOutcome } from '../state/activity-replacement.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { S2B_RUN_BY_WORKSPACE_ENDED_LOOKUP } from './plan-readers.js';
import {
  RUN_ACTIVITY_RECORDED_EVENT_TYPE, RUN_ACTIVITY_EVENT_SCHEMA_VERSION,
  ACTIVITY_RECORDING_STARTED_EVENT_TYPE, activityRecordingRefKey, activityRecordingStartedEventFromEvent,
  decodeActivityRecordingSnapshot, decodeRunActivitySnapshot, encodeActivityRecordingSnapshot,
  encodeActivityRecordingStartedEvent, encodeRunActivityRecordedEvent, encodeRunActivitySnapshot,
  runActivityRecordedEventFromEvent, runActivityRefKey, type ActivityRecordingStartedEventV1,
  type RunActivityRecordedEventV1,
} from './run-activity-codecs.js';

export interface RunActivityPort {
  recordRunActivity(ctx: CoreCallContext, request: GraphWrite<{
    runRef: RunRef; facts: RunActivityFactsV1; expectedActivityRevision?: number | null;
  }>): Promise<WriteResult<{ outcome: 'created' | 'replaced' | 'unchanged'; snapshot: RunActivitySnapshot }>>;
  ensureActivityRecording(ctx: CoreCallContext, request: GraphWrite<{ workspace: WorkspaceScope }>):
    Promise<WriteResult<ActivityRecordingSnapshot>>;
  listActivityBackfillCandidates(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; mode: 'recent' | 'range'; from: string; to: string;
    after: { order: string; refKey: string } | null; limit: number;
  }): Promise<ReadResult<{
    runRefs: RunRef[];
    next: { order: string; refKey: string } | null;
    /** R1: the commit cursor the candidate scan read at, so a request id is unique across Host lifetimes. */
    cursor: string | null;
    /** R1/R13: the selected Runs' existing `RunActivity` revisions (null when none), parallel to `runRefs`. */
    activityRevisions: readonly (number | null)[];
  }>>;
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

  async function replayRunActivity(
    receipt: { cursor: import('../../../contracts/command-event.js').CommitCursor; eventIds: string[] },
  ): Promise<WriteResult<{ outcome: RunActivityWriteOutcome; snapshot: RunActivitySnapshot }>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return unavailable('the recorded RunActivity receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (String(at.value.cursor) !== String(receipt.cursor)) return unavailable('the recorded RunActivity cursor disagrees with the receipt');
    const decoded = runActivityRecordedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded RunActivity event is not decodable: ${decoded.reason}`);
    return { status: 'committed', value: { outcome: 'created', snapshot: decoded.value.runActivity }, replayed: true, cursor: receipt.cursor };
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
    const expectedRevisionRaw = raw.input['expectedActivityRevision'];
    let expectedActivityRevision: number | null | undefined;
    if (expectedRevisionRaw === undefined) {
      expectedActivityRevision = undefined;
    } else if (expectedRevisionRaw === null) {
      expectedActivityRevision = null;
    } else if (typeof expectedRevisionRaw === 'number' && Number.isSafeInteger(expectedRevisionRaw)
      && expectedRevisionRaw >= 1) {
      expectedActivityRevision = expectedRevisionRaw;
    } else {
      return invalid('expectedActivityRevision must be a positive integer or null');
    }
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
    if (expectedActivityRevision !== undefined) {
      const currentRevision = existing.record === null ? null : existing.record.revision;
      if (currentRevision !== expectedActivityRevision) {
        return reject('revision_conflict',
          `the RunActivity revision changed from ${String(expectedActivityRevision)} to ${String(currentRevision)}`);
      }
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
      return { status: 'committed', value: decoded.value, replayed: true, cursor: existingRead.value.readThrough ?? ('' as unknown as CommitCursor) };
    }
    const identity = identityKeyOf('s2b-activity-recording', actor, scope, raw.meta['requestId'] as string);
    const fingerprint = fingerprintOf({ kind: 's2b-activity-recording', actor: { kind: actor.kind, id: actor.id }, ref });
    const priorLookup = await records.lookupCommit({ identityKey: identity, fingerprint });
    if (priorLookup.status === 'ready') return replayActivityRecording(priorLookup.value);
    if (priorLookup.code !== 'not_found') return mapStoreFailure(priorLookup);
    const snapshot: ActivityRecordingSnapshot = { ref, revision: 1, schemaVersion: 1, since: deps.now() };
    const event: ActivityRecordingStartedEventV1 = { eventId: deps.eventId(), eventType: ACTIVITY_RECORDING_STARTED_EVENT_TYPE,
      schemaVersion: RUN_ACTIVITY_EVENT_SCHEMA_VERSION, occurredAt: snapshot.since,
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
      after: { order: string; refKey: string } | null; limit: number },
  ): Promise<ReadResult<{ runRefs: RunRef[]; next: { order: string; refKey: string } | null;
    cursor: string | null; activityRevisions: readonly (number | null)[] }>> {
    const trusted = trustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope } = trusted.value;
    const raw = input as unknown as Record<string, unknown> | null | undefined;
    if (raw === null || raw === undefined || !isRecord(raw['workspace'])) return invalid('listActivityBackfillCandidates requires a workspace');
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
    const after = isRecord(raw['after']) && nonEmpty(raw['after']['order']) && nonEmpty(raw['after']['refKey'])
      ? { order: raw['after']['order'] as string, refKey: raw['after']['refKey'] as string } : null;

    // One epoch read for the workspace: L7's "no authorization, endedAt >= since" exclusion.
    const epochKey = activityRecordingRefKey({ aggregateType: 'ActivityRecording', projectId: scope.projectId, workspaceId: scope.workspaceId });
    const epochRead = await records.readMany([epochKey]);
    if (epochRead.status !== 'ready') return mapStoreFailure(epochRead);
    // R1: the commit cursor this scan reads at. Every read in one scan observes
    // the same ledger; keeping the latest non-null value gives the submission
    // identity that changes as soon as any write (for example this backfill's
    // first tally) commits.
    let scanCursor: string | null = null;
    if (epochRead.value.readThrough !== null && epochRead.value.readThrough !== undefined) {
      scanCursor = String(epochRead.value.readThrough);
    }
    const epochRecord = epochRead.value.records.find((candidate) => candidate.refKey === epochKey);
    let since: string | null = null;
    if (epochRecord !== undefined) {
      const decoded = decodeActivityRecordingSnapshot(epochRecord);
      if (decoded.status !== 'decoded') return unavailable(`the ActivityRecording is damaged: ${decoded.reason}`);
      since = decoded.value.since;
    }

    const runRefs: RunRef[] = [];
    const activityRevisions: (number | null)[] = [];
    let cursor = after;
    let scanned = 0;
    let next: { order: string; refKey: string } | null = null;
    for (;;) {
      if (runRefs.length >= limit || scanned >= cap) break;
      let page;
      try {
        page = await records.lookupOrdered({ index: S2B_RUN_BY_WORKSPACE_ENDED_LOOKUP,
          values: [scope.projectId, scope.workspaceId], direction: 'desc',
          bound: { value: input.to, inclusive: false }, ...(cursor === null ? {} : { after: cursor }), limit: 100 });
      } catch (error) { return unavailable(String(error instanceof Error ? error.message : error)); }
      if (page.status !== 'ready') return mapStoreFailure(page);
      if (page.value.readThrough !== null && page.value.readThrough !== undefined) {
        scanCursor = String(page.value.readThrough);
      }
      if (page.value.records.length === 0) { next = null; break; }
      // Decode the Run and read each RunActivity in one batch (L8: one key read per candidate).
      const runRecords: { record: EncodedRecord; run: RunSnapshot }[] = [];
      for (const record of page.value.records) {
        const decoded = decodeRun(record);
        if (!decoded.ok) return unavailable(`a Run of the workspace is damaged: ${decoded.reason}`);
        runRecords.push({ record, run: decoded.value });
      }
      const activityKeys = runRecords.map(({ run }) => runActivityRefKey(runActivityRefOf(run)));
      const activities = await records.readMany([...new Set(activityKeys)]);
      if (activities.status !== 'ready') return mapStoreFailure(activities);
      if (activities.value.readThrough !== null && activities.value.readThrough !== undefined) {
        scanCursor = String(activities.value.readThrough);
      }
      const byKey = new Map(activities.value.records.map((record) => [record.refKey, record]));
      let sawEarliest = false;
      let lastInspected: { order: string; refKey: string } | null = null;
      for (const { record, run } of runRecords) {
        scanned += 1;
        const endedAt = run.endedAt;
        if (endedAt === null || endedAt < input.from) { sawEarliest = true; break; }
        if (run.status !== 'ended') continue;
        const activityRecord = byKey.get(runActivityRefKey(runActivityRefOf(run)));
        let snapshot: RunActivitySnapshot | null = null;
        if (activityRecord !== undefined) {
          const decoded = decodeRunActivitySnapshot(activityRecord);
          if (decoded.status !== 'decoded') return unavailable(`a RunActivity is damaged: ${decoded.reason}`);
          snapshot = decoded.value;
        }
        if (isBackfillCandidate(run, snapshot, since, mode === 'recent')) {
          runRefs.push(run.ref);
          activityRevisions.push(snapshot?.revision ?? null);
        }
        lastInspected = { order: endedAt, refKey: record.refKey };
        if (runRefs.length >= limit) break;
      }
      if (sawEarliest) { next = null; break; }
      if (lastInspected !== null) cursor = lastInspected;
      if (page.value.next === null) { next = null; break; }
      next = cursor;
      if (runRefs.length >= limit) break;
    }
    if (runRefs.length >= limit && next === null && cursor !== null) next = cursor;
    return { status: 'ready', value: { runRefs, next, cursor: scanCursor, activityRevisions } };
  }

  return { recordRunActivity, ensureActivityRecording, listActivityBackfillCandidates };
}

/**
 * L8 candidate rules. `snapshot === null` means no record yet. The shared L7
 * predicate decides "never entered, so no record is expected"; every other Run
 * without a locator is an old/missing execution and stays a candidate (2B-42),
 * so the human range backfill can write its `unknown('no_history_locator')`.
 */
function isBackfillCandidate(run: RunSnapshot, snapshot: RunActivitySnapshot | null, since: string | null, recentOnly: boolean): boolean {
  if (snapshot === null) return !provenNotEnteredKernel(run, since);
  const facts = snapshot.facts;
  if (facts.ruleVersion < RUN_ACTIVITY_RULE_VERSION) return true;
  if (facts.status === 'counted') return false;
  if (!recentOnly) return true;
  return (ACTIVITY_AUTO_RETRY_REASONS as readonly string[]).includes(facts.reason);
}
