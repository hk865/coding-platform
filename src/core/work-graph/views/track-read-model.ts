/**
 * Slice 2B L12: the read-only track-bar projector.
 *
 * A track bar is an interval: a Run, a verification round, or a query. This
 * reader overlaps the requested `[from, to)` window (ends at/after `from`,
 * starts before `to`, plus still-open work), pages each source segment by its
 * own index, and never sorts the whole window in memory. It never reads the
 * Kernel, never writes and never backfills; every storage read counts against
 * `ACTIVITY_READ_RECORD_CAP` and the whole read is a 2A L7 stable window (at
 * most four attempts, a moving window -> `unavailable`).
 *
 * The page is read bounded. Segments are scanned in L12's order
 * (`runs_ended`, `runs_open`, `rounds_ended`, `rounds_open`, `queries`); each
 * underlying index is read only until the page's `limit` is full, and `next` is
 * a segment-plus-index-position cursor that resumes exactly after the last
 * emitted bar. `unplaced`, `hostRestarts` and every bar's enrichment are
 * derived only from the rows that page's scan actually read.
 *
 * The factory returns only `readTrackBars`; the coordinator merges it with
 * `createActivityReadModel` into the one spec-§2 `ActivityReadPort`.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ControlIntentRef, ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { VerificationRoundRef, RoundSnapshot } from '../../../contracts/verification.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  ACTIVITY_READ_RECORD_CAP,
  provenNotEnteredKernel,
  type ActivityRecordingSnapshot,
} from '../../../contracts/run-activity.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';
import {
  decodeVerificationRoundSnapshot,
  S2B_ROUND_BY_GOAL_FINALIZED_LOOKUP,
  VERIFICATION_ROUND_BY_STATUS_LOOKUP,
} from '../persistence/evidence-record-codecs.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { decodeControlIntentSnapshot, S2B_CONTROL_BY_RUN_LOOKUP } from '../persistence/control-record-codecs.js';
import { decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord, S2B_QUERY_RUN_BY_SESSION_ENDED_LOOKUP } from '../queries/query-record-codecs.js';
import { SESSION_BY_PROVENANCE_LOOKUP } from '../model/session-facts-contracts.js';
import {
  decodeSessionRecord,
  sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import {
  decodeTaskRequeueSnapshot,
  taskRequeueRefKey,
} from '../tasks/claim-record-codecs.js';
import {
  decodeActivityRecordingSnapshot,
  decodeRunActivitySnapshot,
  runActivityRefKey,
} from '../tasks/run-activity-codecs.js';
import { RUN_BY_TASK_INDEX, RUN_BY_WORKSPACE_STATUS_INDEX, S2B_RUN_BY_GOAL_ENDED_LOOKUP } from '../tasks/plan-readers.js';
import { isPausedInterrupted } from '../state/run-machine.js';
import { runErrorOf } from '../state/task-failure.js';
import { reworkActorClassOf } from '../../../contracts/task-requeue.js';
import { storeFailureToRejection } from './goal-conflicts.js';
import {
  activityViewOf, Budget, CapacityError, claimingSessionOf, emptyView, gateInfoOf,
  isQuarterInstant, readEqualityAll, readOneKeyed, readWatermark,
} from './activity-read-helpers.js';
import type { ActivityUncountedReason, RunActivityViewV1 } from './activity-read-model.js';

// --------------------------------------------------------------------------
// Public view types (spec §2 `TrackBarV1`, `TrackBarsPageV1`)
// --------------------------------------------------------------------------

export type TrackRunBarV1 = {
  kind: 'run'; runRef: RunRef; taskId: string; sessionRef: SessionRef | null;
  startAt: string; endAt: string | null;
  result: 'running' | 'completed' | 'failed' | 'budget_exhausted' | 'cancelled' | 'paused'
    | 'interrupted' | 'outcome_unknown' | 'yielded';
  reason: string | null;
  pauses: { from: string; to: string | null; intentRef: ControlIntentRef }[];
  attempt: { attemptId: string; via: 'first' | 'same_attempt' | 'requeue' | 'wait_continuation';
    requeue: { actorClass: string; automaticCount: number | null; reason: string } | null };
  previous: RunRef | null;
  activity: RunActivityViewV1;
};

export type TrackCheckBarV1 = {
  kind: 'check'; roundRef: VerificationRoundRef; taskId: string;
  sessionRef: SessionRef | null; ownerSessionRefs: SessionRef[] | null;
  startAt: string; endAt: string | null;
  result: 'open' | 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  ordinal: number; checksBegun: number; previous: VerificationRoundRef | null;
};

export type TrackQueryBarV1 = {
  kind: 'query'; queryRunRef: QueryRunRef; sessionRef: SessionRef; askedSessionRef: SessionRef | null;
  via: 'turn' | 'consultation'; startAt: string; endAt: string | null;
  result: 'running' | NonNullable<QueryRunSnapshot['run']['outcome']> | 'unknown';
};

export type TrackBarV1 = TrackRunBarV1 | TrackCheckBarV1 | TrackQueryBarV1;

export type TrackBarsPageV1 = {
  goalRef: GoalRef; from: string; to: string; bars: TrackBarV1[]; next: string | null;
  hostRestarts: { at: string; approximate: true }[];
  queriesIncluded: boolean;
  unplaced: { runs: number; rounds: number; gateRounds: number };
};

/** The track half of spec §2 `ActivityReadPort`; the coordinator merges the two factories. */
export interface TrackReadPort {
  readTrackBars(ctx: CoreCallContext, input: {
    goalRef: GoalRef; from: string; to: string;
    cursor: string | null; limit: number; sessionRefs?: SessionRef[];
  }): Promise<ReadResult<TrackBarsPageV1>>;
}

export type TrackReadModelDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'> & RecordLookupPort & RecordOrderedLookupPort;
  /** P4: tests inject a smaller cap; production never passes another value. */
  readRecordCap?: number;
  /** Test-only clock seam; production reads `new Date()`. */
  now?: () => string;
};

const WINDOW_MAX_ATTEMPTS = 4;
const PAGE_LIMIT = 200;
/**
 * The readonly-copy provenance lookup is paged too, so a `limit: 2` page
 * never reads every later copy before it can stop. Each page is small because
 * most Sessions have very few readonly copies; the cursor keeps the page's
 * position so the next call resumes inside it.
 */
const COPY_PROVENANCE_PAGE_LIMIT = 8;
const SESSION_REF_LIMIT = 33;
const TRACK_LIMIT_MAX = 500;
const REASON_MAX_CHARS = 500;

/** L12's segment order. A page is ordered by segment, not by start time. */
const SEGMENTS = [
  'runs_ended', 'runs_open:starting', 'runs_open:running', 'rounds_ended', 'rounds_open',
  'queries',
] as const;
type SegmentId = (typeof SEGMENTS)[number];

// --------------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------------

/** R4: a record outside the caller's bound project/workspace must not leak. */
class ForbiddenError extends Error {
  constructor(readonly reason: string) { super(reason); }
}

type OrderedPage = Awaited<ReturnType<RecordOrderedLookupPort['lookupOrdered']>>;
type EqualityPage = Awaited<ReturnType<RecordLookupPort['lookup']>>;

function canonicalKey(value: unknown): string {
  return canonicalJson(value as JsonValue);
}
function sessionKey(session: SessionRef): string {
  return `${session.projectId}/${session.sessionId}`;
}
function byteOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// --------------------------------------------------------------------------
// L12 page cursor
// --------------------------------------------------------------------------

/**
 * The query segment's nested position: the asked-Session index, which of its
 * three sub-streams (`own_ended`, the running occupant, the readonly copies),
 * and the keyset position inside an ordered sub-stream. `o`/`k` are the
 * exclusive `(order, refKey)` after the last emitted bar; `occ` marks a
 * single-record occupant stream already consumed.
 */
type QueryCursor = {
  a: number;
  p: 'own_ended' | 'own_occ' | 'copies';
  c: string | null;
  p2: 'copy_ended' | 'copy_occ' | null;
  o: string | null;
  k: string | null;
  occ: boolean;
  /** The provenance page token (`after`) that contained `c`, so a resumed page re-reads only that page. */
  ca: string | null;
};

type TrackCursor = { s: SegmentId; o: string | null; k: string | null; q: QueryCursor | null };

function encodeCursor(cursor: TrackCursor): string {
  return `track:${canonicalJson(cursor as unknown as JsonValue)}`;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function decodeQueryCursor(value: unknown): QueryCursor | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const a = record['a'];
  const p = record['p'];
  const c = record['c'];
  const p2 = record['p2'];
  const o = record['o'];
  const k = record['k'];
  const occ = record['occ'];
  const ca = record['ca'];
  if (!Number.isSafeInteger(a) || (a as number) < 0) return null;
  if (p !== 'own_ended' && p !== 'own_occ' && p !== 'copies') return null;
  if (!isStringOrNull(c) || !isStringOrNull(o) || !isStringOrNull(k)) return null;
  if (p2 !== null && p2 !== 'copy_ended' && p2 !== 'copy_occ') return null;
  if (typeof occ !== 'boolean') return null;
  if (!isStringOrNull(ca)) return null;
  return { a: a as number, p, c, p2, o, k, occ, ca };
}

function decodeCursor(cursor: string): TrackCursor | null {
  if (!cursor.startsWith('track:')) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(cursor.slice('track:'.length)); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const s = record['s'];
  const o = record['o'];
  const k = record['k'];
  const q = record['q'];
  if (typeof s !== 'string' || !(SEGMENTS as readonly string[]).includes(s)) return null;
  if (!isStringOrNull(o) || !isStringOrNull(k)) return null;
  let query: QueryCursor | null = null;
  if (q !== undefined && q !== null) {
    query = decodeQueryCursor(q);
    if (query === null) return null;
  }
  if (s !== 'queries' && query !== null) return null;
  return { s: s as SegmentId, o, k, q: query };
}

function activityRefKey(runRef: RunRef): string {
  return runActivityRefKey({ aggregateType: 'RunActivity', projectId: runRef.projectId,
    goalId: runRef.goalId, runId: runRef.runId });
}

// --------------------------------------------------------------------------
// Segment readers
// --------------------------------------------------------------------------

type SegmentContext = {
  records: TrackReadModelDependencies['records'];
  budget: Budget;
  goalRef: GoalRef;
  workspaceId: string;
  from: string;
  to: string;
  toMs: number;
  bySession: Set<string> | null;
  sessionRefs: readonly SessionRef[] | null;
  since: string | null;
};

/** The metadata a bounded page's scan produced. */
type PageOut = {
  bars: TrackBarV1[];
  hostRestarts: string[];
  unplacedRuns: number;
  unplacedRounds: number;
  gateRounds: number;
};

/**
 * One segment's bounded scan. `filled` means the page reached `limit`; `done`
 * means the segment had no candidate after the last row read, so a filled page
 * may `next` straight to the following segment.
 */
type ScanOutcome = { filled: boolean; done: boolean; cursor: TrackCursor | null };

async function readActivityRecording(
  records: TrackReadModelDependencies['records'],
  projectId: string,
  workspaceId: string,
  budget: Budget,
): Promise<ActivityRecordingSnapshot | null> {
  const key = canonicalKey({ aggregateType: 'ActivityRecording', projectId, workspaceId });
  const record = await readOneKeyed(records, key, budget);
  if (record === undefined) return null;
  const decoded = decodeActivityRecordingSnapshot(record);
  if (decoded.status !== 'decoded') throw rejected('unavailable', `ActivityRecording ${record.refKey}: ${decoded.reason}`);
  return decoded.value;
}

async function activityViewFor(
  ctx: SegmentContext,
  run: RunSnapshot,
): Promise<RunActivityViewV1> {
  const record = await readOneKeyed(ctx.records, activityRefKey(run.ref), ctx.budget);
  if (record !== undefined) {
    const decoded = decodeRunActivitySnapshot(record);
    if (decoded.status !== 'decoded') throw rejected('unavailable', `RunActivity record ${record.refKey}: ${decoded.reason}`);
    return activityViewOf(decoded.value, ctx.since);
  }
  if (run.status === 'starting' || run.status === 'running') return emptyView(run.ref, 'in_progress', null, false);
  // The ONE shared L7 predicate (V2 authorization only, ended Runs only,
  // no position record). Starting/running Runs were handled above.
  if (provenNotEnteredKernel(run, ctx.since)) {
    return { runRef: run.ref, status: 'not_entered', reason: null, error: false,
      totals: { steps: 0, edits: 0, editsUnknown: 0 },
      changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false }, usage: null,
      recordedBy: null, recordedAt: null, countedThroughTurnEnd: null, unresolvedCalls: null };
  }
  const reason: ActivityUncountedReason = ctx.since === null ? 'no_recording_epoch'
    : run.endedAt !== null && run.endedAt >= ctx.since ? 'not_recorded' : 'not_backfilled';
  return emptyView(run.ref, 'unknown', reason, reason === 'not_recorded');
}

type RequeueInfo = { actorClass: string; automaticCount: number | null; reason: string };

async function requeueInfoOf(
  records: TrackReadModelDependencies['records'],
  run: RunSnapshot,
  budget: Budget,
): Promise<RequeueInfo | null> {
  const requeueRef = run.requeueRef;
  if (requeueRef === undefined || requeueRef === null) return null;
  const record = await readOneKeyed(records, taskRequeueRefKey(requeueRef), budget);
  if (record === undefined) return null;
  const decoded = decodeTaskRequeueSnapshot(record);
  if (decoded.status !== 'decoded') throw rejected('unavailable', `TaskRequeue ${record.refKey}: ${decoded.reason}`);
  const value = decoded.value;
  return {
    actorClass: reworkActorClassOf(null, value.requestedBy) ?? value.requestedBy.kind,
    automaticCount: value.automation.automatic ? value.automation.autoCount : null,
    reason: value.reason,
  };
}

function runBarResult(run: RunSnapshot): TrackRunBarV1['result'] {
  if (run.status === 'starting' || run.status === 'running') return 'running';
  switch (run.outcome) {
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'budget_exhausted': return 'budget_exhausted';
    case 'cancelled': return 'cancelled';
    case 'crashed': return isPausedInterrupted(run) ? 'paused' : 'interrupted';
    case 'outcome_unknown': return 'outcome_unknown';
    case 'yielded': return 'yielded';
    default: return 'interrupted';
  }
}

async function pausesOf(
  records: TrackReadModelDependencies['records'],
  run: RunSnapshot,
  budget: Budget,
): Promise<TrackRunBarV1['pauses']> {
  const refs = await readEqualityAll(records, S2B_CONTROL_BY_RUN_LOOKUP,
    [run.ref.projectId, run.workspaceSnapshot.workspaceId, run.ref.goalId, run.ref.runId], budget);
  const events: { kind: 'paused' | 'resumed'; at: string; ref: ControlIntentRef }[] = [];
  for (const record of refs) {
    const decoded = decodeControlIntentSnapshot(record);
    if (decoded.status !== 'decoded') throw rejected('unavailable', `ControlIntent ${record.refKey}: ${decoded.reason}`);
    const intent: ControlIntentSnapshotV1 = decoded.value;
    if (intent.status !== 'applied') continue;
    const observation = intent.observation;
    if (observation.kind !== 'paused' && observation.kind !== 'resumed') continue;
    events.push({ kind: observation.kind, at: observation.observedAt, ref: intent.ref });
  }
  events.sort((left, right) => byteOrder(left.at, right.at));
  const built: TrackRunBarV1['pauses'] = [];
  let open: { from: string; intentRef: ControlIntentRef } | null = null;
  for (const event of events) {
    if (event.kind === 'paused') {
      if (open === null) open = { from: event.at, intentRef: event.ref };
    } else if (open !== null) {
      built.push({ from: open.from, to: event.at, intentRef: open.intentRef });
      open = null;
    }
  }
  if (open !== null) built.push({ from: open.from, to: run.endedAt, intentRef: open.intentRef });
  const startedMs = run.startedAt === null ? null : Date.parse(run.startedAt);
  const endedMs = run.endedAt === null ? null : Date.parse(run.endedAt);
  return built
    .filter((pause) => {
      const fromMs = Date.parse(pause.from);
      if (startedMs !== null && fromMs < startedMs) return false;
      if (endedMs !== null && fromMs > endedMs) return false;
      return true;
    })
    .map((pause) => ({
      from: pause.from,
      to: endedMs !== null && pause.to !== null && Date.parse(pause.to) > endedMs ? run.endedAt : pause.to,
      intentRef: pause.intentRef,
    }));
}

async function taskRunsOf(
  records: TrackReadModelDependencies['records'],
  goalRef: GoalRef,
  taskId: string,
  cache: Map<string, RunSnapshot[]>,
  budget: Budget,
): Promise<RunSnapshot[]> {
  const cached = cache.get(taskId);
  if (cached !== undefined) return cached;
  const rows = await readEqualityAll(records, RUN_BY_TASK_INDEX, [goalRef.projectId, goalRef.goalId, taskId], budget);
  const runs: RunSnapshot[] = [];
  for (const record of rows) {
    const decoded = decodeRun(record);
    if (!decoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${decoded.reason}`);
    runs.push(decoded.value);
  }
  runs.sort((left, right) => {
    const leftAt = left.startedAt ?? '';
    const rightAt = right.startedAt ?? '';
    if (leftAt !== rightAt) return byteOrder(leftAt, rightAt);
    return byteOrder(left.ref.runId, right.ref.runId);
  });
  cache.set(taskId, runs);
  return runs;
}

function runReasonOf(run: RunSnapshot): string | null {
  const reason = runErrorOf(run, null).error;
  if (reason === null) return null;
  return reason.length > REASON_MAX_CHARS ? reason.slice(0, REASON_MAX_CHARS) : reason;
}

function runBarOf(
  run: RunSnapshot,
  sessionRef: SessionRef | null,
  pauses: TrackRunBarV1['pauses'],
  attempt: TrackRunBarV1['attempt'],
  previous: RunRef | null,
  activity: RunActivityViewV1,
): TrackRunBarV1 {
  return { kind: 'run', runRef: run.ref, taskId: run.task.taskId, sessionRef,
    startAt: run.startedAt as string, endAt: run.endedAt,
    result: runBarResult(run), reason: runReasonOf(run), pauses, attempt, previous, activity };
}

async function runBarWith(
  records: TrackReadModelDependencies['records'],
  ctx: SegmentContext,
  run: RunSnapshot,
  sessionRef: SessionRef | null,
  cache: Map<string, RunSnapshot[]>,
  budget: Budget,
): Promise<TrackRunBarV1> {
  const taskRuns = await taskRunsOf(records, ctx.goalRef, run.task.taskId, cache, budget);
  const index = taskRuns.findIndex((candidate) => candidate.ref.runId === run.ref.runId);
  const previous = index > 0 ? taskRuns[index - 1]!.ref : null;
  const priorSameAttempt = index > 0 && taskRuns[index - 1]!.attemptId === run.attemptId;
  const via: TrackRunBarV1['attempt']['via'] = run.requeueRef !== undefined && run.requeueRef !== null
    ? 'requeue'
    : run.consumedWait !== undefined && run.consumedWait !== null
      ? 'wait_continuation'
      : priorSameAttempt ? 'same_attempt' : 'first';
  const requeue = await requeueInfoOf(records, run, budget);
  const pauses = await pausesOf(records, run, budget);
  const activity = await activityViewFor(ctx, run);
  return runBarOf(run, sessionRef, pauses, { attemptId: run.attemptId, via, requeue }, previous, activity);
}

async function scanRunsEnded(
  ctx: SegmentContext,
  start: TrackCursor | null,
  need: number,
  out: PageOut,
  seen: Set<string>,
  cache: Map<string, RunSnapshot[]>,
): Promise<ScanOutcome> {
  const { records, budget, goalRef, from, to } = ctx;
  const before = out.bars.length;
  let after: { order: string | number; refKey: string } | undefined =
    start !== null && start.o !== null && start.k !== null ? { order: start.o, refKey: start.k } : undefined;
  for (;;) {
    const remaining = need - (out.bars.length - before);
    const page: OrderedPage = await records.lookupOrdered({
      index: S2B_RUN_BY_GOAL_ENDED_LOOKUP, values: [goalRef.projectId, goalRef.goalId],
      direction: 'asc', bound: { value: from, inclusive: true },
      ...(after === undefined ? {} : { after }),
      limit: Math.max(1, Math.min(PAGE_LIMIT, remaining)),
    });
    if (page.status !== 'ready') throw page;
    budget.spend(page.value.records.length);
    const rows = page.value.records;
    for (let index = 0; index < rows.length; index += 1) {
      const record = rows[index]!;
      const decoded = decodeRun(record);
      if (!decoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${decoded.reason}`);
      const run = decoded.value;
      if (run.ref.goalId !== goalRef.goalId) continue;
      // R4: never return data owned by another workspace of the same project.
      if (run.workspaceSnapshot.workspaceId !== ctx.workspaceId) {
        throw new ForbiddenError(`Run ${record.refKey} is outside the bound workspace`);
      }
      if (seen.has(run.ref.runId)) continue;
      seen.add(run.ref.runId);
      if (run.reconciliation?.basis.kind === 'host_instance_takeover') out.hostRestarts.push(run.reconciliation.recordedAt);
      let emitted = false;
      if (run.startedAt !== null && run.startedAt < to) {
        const sessionRef = await claimingSessionOf(records, run, budget);
        if (ctx.bySession !== null && !ctx.bySession.has(sessionKey(sessionRef))) continue;
        out.bars.push(await runBarWith(records, ctx, run, sessionRef, cache, budget));
        emitted = true;
      } else if (run.startedAt === null && run.endedAt !== null && run.endedAt < to) {
        out.unplacedRuns += 1;
      }
      if (emitted && out.bars.length - before >= need) {
        const exhausted = index === rows.length - 1 && page.value.next === null;
        return { filled: true, done: exhausted,
          cursor: { s: 'runs_ended', o: run.endedAt, k: record.refKey, q: null } };
      }
    }
    if (page.value.next === null) return { filled: false, done: true, cursor: null };
    after = page.value.next;
  }
}

async function scanRunsOpenStatus(
  ctx: SegmentContext,
  status: 'starting' | 'running',
  start: TrackCursor | null,
  need: number,
  out: PageOut,
  seen: Set<string>,
  cache: Map<string, RunSnapshot[]>,
): Promise<ScanOutcome> {
  const { records, budget, goalRef } = ctx;
  const segment: SegmentId = status === 'starting' ? 'runs_open:starting' : 'runs_open:running';
  const before = out.bars.length;
  let after: string | undefined = start !== null && start.k !== null ? start.k : undefined;
  for (;;) {
    const remaining = need - (out.bars.length - before);
    const page: EqualityPage = await records.lookup({
      index: RUN_BY_WORKSPACE_STATUS_INDEX, values: [goalRef.projectId, ctx.workspaceId, status],
      limit: Math.max(1, Math.min(PAGE_LIMIT, remaining)),
      ...(after === undefined ? {} : { after }),
    });
    if (page.status !== 'ready') throw page;
    budget.spend(page.value.records.length);
    const rows = page.value.records;
    for (let index = 0; index < rows.length; index += 1) {
      const record = rows[index]!;
      const decoded = decodeRun(record);
      if (!decoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${decoded.reason}`);
      const run = decoded.value;
      if (run.ref.goalId !== goalRef.goalId) continue;
      if (run.workspaceSnapshot.workspaceId !== ctx.workspaceId) {
        throw new ForbiddenError(`Run ${record.refKey} is outside the bound workspace`);
      }
      if (seen.has(run.ref.runId)) continue;
      seen.add(run.ref.runId);
      if (run.reconciliation?.basis.kind === 'host_instance_takeover') out.hostRestarts.push(run.reconciliation.recordedAt);
      let emitted = false;
      // An open Run keeps its overlap; the track draws it to `now` (no end).
      if (run.startedAt !== null && run.startedAt < ctx.to) {
        const sessionRef = await claimingSessionOf(records, run, budget);
        if (ctx.bySession !== null && !ctx.bySession.has(sessionKey(sessionRef))) continue;
        out.bars.push(await runBarWith(records, ctx, run, sessionRef, cache, budget));
        emitted = true;
      } else if (run.startedAt === null) {
        out.unplacedRuns += 1;
      }
      if (emitted && out.bars.length - before >= need) {
        const exhausted = index === rows.length - 1 && page.value.next === null;
        return { filled: true, done: exhausted, cursor: { s: segment, o: null, k: record.refKey, q: null } };
      }
    }
    if (page.value.next === null) return { filled: false, done: true, cursor: null };
    after = page.value.next;
  }
}

type CheckAttribution = { session: SessionRef | null; owners: SessionRef[] | null; gate: boolean };

async function subjectSessionOf(
  records: TrackReadModelDependencies['records'],
  workspaceId: string,
  cache: Map<string, SessionRef | null>,
  runRef: RunRef,
  budget: Budget,
): Promise<SessionRef | null> {
  const key = canonicalKey(runRef);
  if (cache.has(key)) return cache.get(key) ?? null;
  const record = await readOneKeyed(records, key, budget);
  let session: SessionRef | null = null;
  if (record !== undefined) {
    const decoded = decodeRun(record);
    if (!decoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${decoded.reason}`);
    if (decoded.value.workspaceSnapshot.workspaceId !== workspaceId) {
      throw new ForbiddenError(`Run ${record.refKey} is outside the bound workspace`);
    }
    session = await claimingSessionOf(records, decoded.value, budget);
  }
  cache.set(key, session);
  return session;
}

async function gateOwnersOf(
  records: TrackReadModelDependencies['records'],
  goalRef: GoalRef,
  round: RoundSnapshot,
  cache: Map<string, { owners: SessionRef[]; gate: boolean }>,
  budget: Budget,
): Promise<{ owners: SessionRef[]; gate: boolean }> {
  const info = await gateInfoOf(records, goalRef, round, budget, cache);
  // The shared gate read returns the owners unsorted; the track orders them by
  // the canonical key (byte order) of each SessionRef.
  return info.gate
    ? { owners: [...info.owners].sort((left, right) => byteOrder(canonicalKey(left), canonicalKey(right))), gate: true }
    : info;
}

function checksBegun(round: RoundSnapshot): number {
  return round.checks.filter((check) => check.invocationId !== null).length;
}

function checkBarOf(
  round: RoundSnapshot,
  startAt: string,
  endAt: string | null,
  result: TrackCheckBarV1['result'],
  attribution: CheckAttribution,
): TrackCheckBarV1 {
  return { kind: 'check', roundRef: round.ref, taskId: round.subject.taskId,
    sessionRef: attribution.session, ownerSessionRefs: attribution.owners,
    startAt, endAt, result, ordinal: round.chain?.ordinal ?? 1,
    checksBegun: checksBegun(round), previous: round.chain?.predecessorRoundRef ?? null };
}

async function readCheckStart(
  ctx: SegmentContext,
  record: EncodedRecord,
): Promise<{ since: CommitCursor; finalizedAt: string | null; round: RoundSnapshot }> {
  const origin = decodeNoticeOrigin(record);
  if (origin.status !== 'decoded') throw rejected('unavailable', `round origin ${record.refKey}: ${origin.reason}`);
  const since = origin.value.since;
  if (since === undefined || since === null) {
    throw rejected('unavailable', `round ${record.refKey} is missing its since cursor`);
  }
  const decoded = decodeVerificationRoundSnapshot(record);
  if (decoded.status !== 'decoded') throw rejected('unavailable', `round ${record.refKey}: ${decoded.reason}`);
  return { since, finalizedAt: origin.value.finalizedAt ?? null, round: decoded.value };
}

async function checkAttribution(
  ctx: SegmentContext,
  round: RoundSnapshot,
  subjectCache: Map<string, SessionRef | null>,
  gateCache: Map<string, { owners: SessionRef[]; gate: boolean }>,
): Promise<CheckAttribution> {
  const gate = await gateOwnersOf(ctx.records, ctx.goalRef, round, gateCache, ctx.budget);
  const subjectSession = await subjectSessionOf(ctx.records, ctx.workspaceId, subjectCache, round.subjectRunRef, ctx.budget);
  if (!gate.gate) return { session: subjectSession, owners: null, gate: false };
  return { session: gate.owners.length === 1 ? gate.owners[0]! : null, owners: gate.owners, gate: true };
}

async function checkVisible(ctx: SegmentContext, attr: CheckAttribution): Promise<boolean> {
  if (ctx.bySession === null) return true;
  if (attr.gate) {
    if ((attr.owners ?? []).length === 0) return false;
    return (attr.owners ?? []).some((owner) => ctx.bySession!.has(sessionKey(owner)));
  }
  return attr.session !== null && ctx.bySession.has(sessionKey(attr.session));
}

async function scanRoundsEnded(
  ctx: SegmentContext,
  start: TrackCursor | null,
  need: number,
  out: PageOut,
  seenRounds: Set<string>,
  subjectCache: Map<string, SessionRef | null>,
  gateCache: Map<string, { owners: SessionRef[]; gate: boolean }>,
): Promise<ScanOutcome> {
  const { records, budget, goalRef, workspaceId } = ctx;
  const before = out.bars.length;
  let after: { order: string | number; refKey: string } | undefined =
    start !== null && start.o !== null && start.k !== null ? { order: start.o, refKey: start.k } : undefined;
  for (;;) {
    const remaining = need - (out.bars.length - before);
    const page: OrderedPage = await records.lookupOrdered({
      index: S2B_ROUND_BY_GOAL_FINALIZED_LOOKUP, values: [goalRef.projectId, workspaceId, goalRef.goalId],
      direction: 'asc', bound: { value: ctx.from, inclusive: true },
      ...(after === undefined ? {} : { after }),
      limit: Math.max(1, Math.min(PAGE_LIMIT, remaining)),
    });
    if (page.status !== 'ready') throw page;
    budget.spend(page.value.records.length);
    const rows = page.value.records;
    for (let index = 0; index < rows.length; index += 1) {
      const record = rows[index]!;
      const parsed = await readCheckStart(ctx, record);
      seenRounds.add(record.refKey);
      const event = await records.eventAt(parsed.since!);
      if (event.status !== 'ready') throw event;
      budget.spend(1);
      if (Date.parse(event.value.event.occurredAt) >= ctx.toMs) continue;
      const attr = await checkAttribution(ctx, parsed.round, subjectCache, gateCache);
      if (ctx.bySession !== null && attr.gate && (attr.owners ?? []).length === 0) { out.gateRounds += 1; continue; }
      if (!await checkVisible(ctx, attr)) continue;
      out.bars.push(checkBarOf(parsed.round, event.value.event.occurredAt, parsed.finalizedAt,
        parsed.round.outcome ?? 'INCONCLUSIVE', attr));
      if (out.bars.length - before >= need) {
        const exhausted = index === rows.length - 1 && page.value.next === null;
        return { filled: true, done: exhausted,
          cursor: { s: 'rounds_ended', o: parsed.finalizedAt, k: record.refKey, q: null } };
      }
    }
    if (page.value.next === null) return { filled: false, done: true, cursor: null };
    after = page.value.next;
  }
}

async function scanRoundsOpen(
  ctx: SegmentContext,
  start: TrackCursor | null,
  need: number,
  out: PageOut,
  seenRounds: Set<string>,
  subjectCache: Map<string, SessionRef | null>,
  gateCache: Map<string, { owners: SessionRef[]; gate: boolean }>,
): Promise<ScanOutcome> {
  const { records, budget, goalRef, workspaceId } = ctx;
  const before = out.bars.length;
  let after: string | undefined = start !== null && start.k !== null ? start.k : undefined;
  for (;;) {
    const remaining = need - (out.bars.length - before);
    const page: EqualityPage = await records.lookup({
      index: VERIFICATION_ROUND_BY_STATUS_LOOKUP, values: [goalRef.projectId, workspaceId, 'open'],
      limit: Math.max(1, Math.min(PAGE_LIMIT, remaining)),
      ...(after === undefined ? {} : { after }),
    });
    if (page.status !== 'ready') throw page;
    budget.spend(page.value.records.length);
    const rows = page.value.records;
    for (let index = 0; index < rows.length; index += 1) {
      const record = rows[index]!;
      if (seenRounds.has(record.refKey)) continue;
      const parsed = await readCheckStart(ctx, record);
      if (parsed.round.ref.goalId !== goalRef.goalId) continue;
      const event = await records.eventAt(parsed.since!);
      if (event.status !== 'ready') throw event;
      budget.spend(1);
      if (Date.parse(event.value.event.occurredAt) >= ctx.toMs) continue;
      const attr = await checkAttribution(ctx, parsed.round, subjectCache, gateCache);
      if (ctx.bySession !== null && attr.gate && (attr.owners ?? []).length === 0) { out.gateRounds += 1; continue; }
      if (!await checkVisible(ctx, attr)) continue;
      out.bars.push(checkBarOf(parsed.round, event.value.event.occurredAt, null, 'open', attr));
      if (out.bars.length - before >= need) {
        const exhausted = index === rows.length - 1 && page.value.next === null;
        return { filled: true, done: exhausted, cursor: { s: 'rounds_open', o: null, k: record.refKey, q: null } };
      }
    }
    if (page.value.next === null) return { filled: false, done: true, cursor: null };
    after = page.value.next;
  }
}

type QueryCopy = { ref: SessionRef; from: SessionRef; key: string };

async function scanQueries(
  ctx: SegmentContext,
  start: TrackCursor | null,
  need: number,
  out: PageOut,
): Promise<ScanOutcome> {
  const { records, budget, goalRef, workspaceId, from, to } = ctx;
  const refs = ctx.sessionRefs;
  if (refs === null) return { filled: false, done: true, cursor: null };
  const before = out.bars.length;
  const q0 = start?.q ?? null;
  const seen = new Set<string>();

  const jobGoalIdOf = async (queryRun: QueryRunSnapshot): Promise<string | null> => {
    const record = await readOneKeyed(records, canonicalKey(queryRun.run.queryJobRef), budget);
    if (record === undefined) return null;
    const decoded = decodeQueryJobSnapshot(record);
    if (decoded.status !== 'decoded') throw rejected('unavailable', `QueryJob ${record.refKey}: ${decoded.reason}`);
    return decoded.value.job.goalId;
  };

  const pushQuery = async (
    queryRun: QueryRunSnapshot, sessionRef: SessionRef, askedSessionRef: SessionRef | null,
    via: 'turn' | 'consultation',
  ): Promise<boolean> => {
    if (queryRun.run.startedAt === null || queryRun.run.startedAt >= to) return false;
    const key = canonicalKey(queryRun.ref);
    if (seen.has(key)) return false;
    if (await jobGoalIdOf(queryRun) !== goalRef.goalId) return false;
    seen.add(key);
    out.bars.push({ kind: 'query', queryRunRef: queryRun.ref, sessionRef, askedSessionRef, via,
      startAt: queryRun.run.startedAt, endAt: queryRun.run.endedAt,
      result: queryRun.run.endedAt === null ? 'running' : queryRun.run.outcome ?? 'unknown' });
    return true;
  };

  const scanOrderedOwn = async (
    session: SessionRef, startAfter: { order: string | number; refKey: string } | undefined,
  ): Promise<QueryRunSnapshot | null> => {
    let after = startAfter;
    for (;;) {
      const remaining = need - (out.bars.length - before);
      const page: OrderedPage = await records.lookupOrdered({
        index: S2B_QUERY_RUN_BY_SESSION_ENDED_LOOKUP,
        values: [goalRef.projectId, workspaceId, session.sessionId],
        direction: 'asc', bound: { value: from, inclusive: true },
        ...(after === undefined ? {} : { after }),
        limit: Math.max(1, Math.min(PAGE_LIMIT, remaining)),
      });
      if (page.status !== 'ready') throw page;
      budget.spend(page.value.records.length);
      for (const record of page.value.records) {
        const decoded = decodeQueryRunSnapshotRecord(record);
        if (decoded.status !== 'decoded') throw rejected('unavailable', `QueryRun ${record.refKey}: ${decoded.reason}`);
        const emitted = await pushQuery(decoded.value, session, null, 'turn');
        if (emitted && out.bars.length - before >= need) return decoded.value;
      }
      if (page.value.next === null) return null;
      after = page.value.next;
    }
  };

  const occupantQueryOf = async (session: SessionRef): Promise<QueryRunSnapshot | null> => {
    const askedRecord = await readOneKeyed(records, sessionAggregateRefKey({
      aggregateType: 'Session', projectId: goalRef.projectId, sessionId: session.sessionId }), budget);
    if (askedRecord === undefined) return null;
    const decoded = decodeSessionRecord(askedRecord);
    if (decoded.status !== 'decoded') throw rejected('unavailable', `Session ${askedRecord.refKey}: ${decoded.reason}`);
    // R4: a Session record outside the bound workspace must not leak.
    if (decoded.value.workspaceId !== workspaceId) {
      throw new ForbiddenError(`Session ${askedRecord.refKey} is outside the bound workspace`);
    }
    const occupant = decoded.value.occupancy;
    if (occupant === null || occupant.kind !== 'execution' || occupant.executionRef.aggregateType !== 'QueryRun') return null;
    const record = await readOneKeyed(records, canonicalKey(occupant.executionRef), budget);
    if (record === undefined) return null;
    const running = decodeQueryRunSnapshotRecord(record);
    if (running.status !== 'decoded') throw rejected('unavailable', `QueryRun ${record.refKey}: ${running.reason}`);
    return running.value;
  };

  /**
   * One page of readonly copies of `session`, with the token to fetch the
   * next page. The caller stops as soon as the requested bars are filled, so a
   * `limit: 2` page never reads every later copy.
   */
  const copiesPageOf = async (
    session: SessionRef, after: string | undefined,
  ): Promise<{ copies: QueryCopy[]; next: string | null }> => {
    const page = await records.lookup({
      index: SESSION_BY_PROVENANCE_LOOKUP,
      values: [goalRef.projectId, workspaceId, session.sessionId],
      limit: COPY_PROVENANCE_PAGE_LIMIT,
      ...(after === undefined ? {} : { after }),
    });
    if (page.status !== 'ready') throw page;
    budget.spend(page.value.records.length);
    const copies: QueryCopy[] = [];
    for (const copyRecord of page.value.records) {
      const decoded = decodeSessionRecord(copyRecord);
      if (decoded.status !== 'decoded') throw rejected('unavailable', `Session ${copyRecord.refKey}: ${decoded.reason}`);
      if (decoded.value.workspaceId !== workspaceId) {
        throw new ForbiddenError(`Session ${copyRecord.refKey} is outside the bound workspace`);
      }
      const provenance = decoded.value.provenance;
      if (provenance === undefined || provenance === null || provenance.kind !== 'readonly_copy') continue;
      copies.push({ ref: { projectId: decoded.value.ref.projectId, sessionId: decoded.value.ref.sessionId },
        from: provenance.from, key: canonicalKey(decoded.value.ref) });
    }
    return { copies, next: page.value.next };
  };

  for (let a = q0?.a ?? 0; a < refs.length; a += 1) {
    const asked = refs[a]!;
    const resumeP = q0 !== null && q0.a === a ? q0.p : 'own_ended';

    if (resumeP === 'own_ended') {
      const startAfter = q0 !== null && q0.a === a && q0.o !== null && q0.k !== null
        ? { order: q0.o, refKey: q0.k } : undefined;
      const filling = await scanOrderedOwn(asked, startAfter);
      if (filling !== null) {
        return { filled: true, done: false, cursor: { s: 'queries', o: null, k: null, q: {
          a, p: 'own_ended', c: null, p2: null, o: filling.run.endedAt,
          k: canonicalKey(filling.ref), occ: false, ca: null } } };
      }
    }

    if (resumeP === 'own_ended' || resumeP === 'own_occ') {
      const occDone = resumeP === 'own_occ' && q0!.occ;
      if (!occDone) {
        const occupant = await occupantQueryOf(asked);
        if (occupant !== null) {
          const emitted = await pushQuery(occupant, asked, null, 'turn');
          if (emitted && out.bars.length - before >= need) {
            return { filled: true, done: false, cursor: { s: 'queries', o: null, k: null, q: {
              a, p: 'own_occ', c: null, p2: null, o: null, k: null, occ: true, ca: null } } };
          }
        }
      }
    }

    // Paged readonly-copy provenance. `copiesAfter` is the token of the
    // page currently being read; it is carried in the cursor (`ca`) so a
    // resumed page re-reads only the page that held `c`.
    let copiesAfter: string | undefined =
      resumeP === 'copies' && q0 !== null && q0.ca !== null ? q0.ca : undefined;
    let resumeCopyKey: string | null = resumeP === 'copies' && q0 !== null ? q0.c : null;
    for (;;) {
      const pageCopies = await copiesPageOf(asked, copiesAfter);
      const copies = pageCopies.copies;
      let startCopy = 0;
      if (resumeCopyKey !== null) {
        const found = copies.findIndex((copy) => copy.key === resumeCopyKey);
        startCopy = found >= 0 ? found : 0;
        resumeCopyKey = null;
      }
      for (let ci = startCopy; ci < copies.length; ci += 1) {
        const copy = copies[ci]!;
        const copyResume = resumeP === 'copies' && q0 !== null && q0.c === copy.key ? q0.p2 : null;

        if (copyResume === null || copyResume === 'copy_ended') {
          const startAfter: { order: string | number; refKey: string } | undefined =
            copyResume === 'copy_ended' && q0!.o !== null && q0!.k !== null
              ? { order: q0!.o, refKey: q0!.k } : undefined;
          // The consultation bar is drawn on the asked Session, so reuse the own
          // ordered reader but rewrite the attribution via a small inline scan.
          let after = startAfter;
          let filledQuery: QueryRunSnapshot | null = null;
          for (;;) {
            const remaining = need - (out.bars.length - before);
            const page: OrderedPage = await records.lookupOrdered({
              index: S2B_QUERY_RUN_BY_SESSION_ENDED_LOOKUP,
              values: [goalRef.projectId, workspaceId, copy.ref.sessionId],
              direction: 'asc', bound: { value: from, inclusive: true },
              ...(after === undefined ? {} : { after }),
              limit: Math.max(1, Math.min(PAGE_LIMIT, remaining)),
            });
            if (page.status !== 'ready') throw page;
            budget.spend(page.value.records.length);
            for (const record of page.value.records) {
              const decoded = decodeQueryRunSnapshotRecord(record);
              if (decoded.status !== 'decoded') throw rejected('unavailable', `QueryRun ${record.refKey}: ${decoded.reason}`);
              const emitted = await pushQuery(decoded.value, copy.ref, copy.from, 'consultation');
              if (emitted && out.bars.length - before >= need) { filledQuery = decoded.value; break; }
            }
            if (filledQuery !== null || page.value.next === null) break;
            after = page.value.next;
          }
          if (filledQuery !== null) {
            return { filled: true, done: false, cursor: { s: 'queries', o: null, k: null, q: {
              a, p: 'copies', c: copy.key, p2: 'copy_ended', o: filledQuery.run.endedAt,
              k: canonicalKey(filledQuery.ref), occ: false, ca: copiesAfter ?? null } } };
          }
        }

        if (copyResume === null || copyResume === 'copy_ended' || copyResume === 'copy_occ') {
          const occDone = copyResume === 'copy_occ' && q0!.occ;
          if (!occDone) {
            const occupant = await occupantQueryOf(copy.ref);
            if (occupant !== null) {
              const emitted = await pushQuery(occupant, copy.ref, copy.from, 'consultation');
              if (emitted && out.bars.length - before >= need) {
                return { filled: true, done: false, cursor: { s: 'queries', o: null, k: null, q: {
                  a, p: 'copies', c: copy.key, p2: 'copy_occ', o: null, k: null, occ: true, ca: copiesAfter ?? null } } };
              }
            }
          }
        }
      }
      if (pageCopies.next === null) break;
      copiesAfter = pageCopies.next;
    }
  }
  return { filled: false, done: true, cursor: null };
}

async function scanSegment(
  segment: SegmentId,
  ctx: SegmentContext,
  start: TrackCursor | null,
  need: number,
  out: PageOut,
  seenRuns: Set<string>,
  seenRounds: Set<string>,
  cache: Map<string, RunSnapshot[]>,
  subjectCache: Map<string, SessionRef | null>,
  gateCache: Map<string, { owners: SessionRef[]; gate: boolean }>,
): Promise<ScanOutcome> {
  switch (segment) {
    case 'runs_ended':
      return scanRunsEnded(ctx, start, need, out, seenRuns, cache);
    case 'runs_open:starting':
      return scanRunsOpenStatus(ctx, 'starting', start, need, out, seenRuns, cache);
    case 'runs_open:running':
      return scanRunsOpenStatus(ctx, 'running', start, need, out, seenRuns, cache);
    case 'rounds_ended':
      return scanRoundsEnded(ctx, start, need, out, seenRounds, subjectCache, gateCache);
    case 'rounds_open':
      return scanRoundsOpen(ctx, start, need, out, seenRounds, subjectCache, gateCache);
    case 'queries':
      return scanQueries(ctx, start, need, out);
  }
}

// --------------------------------------------------------------------------
// Window
// --------------------------------------------------------------------------

async function goalWorkspaceId(
  records: TrackReadModelDependencies['records'],
  goalRef: GoalRef,
  budget: Budget,
): Promise<string> {
  const record = await readOneKeyed(records, canonicalKey(goalRef), budget);
  if (record === undefined) throw rejected('unavailable', `the Goal ${goalRef.goalId} is missing`);
  const decoded = decodeGoalSnapshot(record);
  if (decoded.status !== 'decoded') throw rejected('unavailable', `the Goal ${goalRef.goalId}: ${decoded.reason}`);
  return decoded.value.workspaceRef.workspaceId;
}

type TrackBarsInput = {
  goalRef: GoalRef; from: string; to: string;
  cursor: string | null; limit: number; sessionRefs?: SessionRef[];
};

function validateTrackInput(ctx: CoreCallContext, input: TrackBarsInput): CoreRejection | null {
  if (input.goalRef === null || typeof input.goalRef !== 'object'
    || input.goalRef.aggregateType !== 'Goal' || input.goalRef.projectId !== ctx.projectId) {
    return { status: 'rejected', code: 'forbidden', reason: 'the requested goal is outside the bound call scope' };
  }
  if (!isQuarterInstant(input.from)) return rejected('invalid', 'from must be a UTC quarter boundary ending in Z');
  if (!isQuarterInstant(input.to)) return rejected('invalid', 'to must be a UTC quarter boundary ending in Z');
  if (Date.parse(input.from) >= Date.parse(input.to)) return rejected('invalid', 'from must be before to');
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > TRACK_LIMIT_MAX) {
    return rejected('invalid', `limit must be an integer between 1 and ${String(TRACK_LIMIT_MAX)}`);
  }
  if (input.cursor !== null && (typeof input.cursor !== 'string' || decodeCursor(input.cursor) === null)) {
    return rejected('invalid', 'cursor is not a track-bars page cursor');
  }
  if (input.sessionRefs !== undefined) {
    if (!Array.isArray(input.sessionRefs) || input.sessionRefs.length > SESSION_REF_LIMIT) {
      return rejected('invalid', `sessionRefs may carry at most ${String(SESSION_REF_LIMIT)} references`);
    }
  }
  return null;
}

/**
 * R4: every returned SessionRef is resolved to its Session record and must be
 * in the bound workspace, not merely the bound project. The per-read cache
 * makes repeated references cost one storage read, charged to the same budget.
 */
async function sessionProblemOf(
  bars: readonly TrackBarV1[],
  ctx: CoreCallContext,
  records: TrackReadModelDependencies['records'],
  workspaceId: string,
  budget: Budget,
  cache: Map<string, true>,
): Promise<void> {
  const check = async (ref: SessionRef | null | undefined): Promise<void> => {
    if (ref === null || ref === undefined) return;
    if (ref.projectId !== ctx.projectId) {
      throw new ForbiddenError(`Session ${sessionKey(ref)} is outside the bound call scope`);
    }
    const key = sessionKey(ref);
    if (cache.has(key)) return;
    const record = await readOneKeyed(records, sessionAggregateRefKey({ aggregateType: 'Session',
      projectId: ref.projectId, sessionId: ref.sessionId }), budget);
    if (record !== undefined) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded') throw rejected('unavailable', `Session ${record.refKey}: ${decoded.reason}`);
      if (decoded.value.workspaceId !== workspaceId) {
        throw new ForbiddenError(`Session ${key} is outside the bound workspace`);
      }
    }
    cache.set(key, true);
  };
  for (const bar of bars) {
    if (bar.kind === 'run') await check(bar.sessionRef);
    else if (bar.kind === 'check') {
      await check(bar.sessionRef);
      for (const owner of bar.ownerSessionRefs ?? []) await check(owner);
    } else { await check(bar.sessionRef); await check(bar.askedSessionRef); }
  }
}

async function readTrackBarsWindow(
  deps: TrackReadModelDependencies,
  ctx: CoreCallContext,
  input: TrackBarsInput,
  budget: Budget,
): Promise<ReadResult<TrackBarsPageV1>> {
  const records = deps.records;
  const workspaceId = await goalWorkspaceId(records, input.goalRef, budget);
  // R4: the Goal it resolves must be the caller's bound workspace.
  if (workspaceId !== ctx.workspaceId) {
    return rejected('forbidden', `the Goal ${input.goalRef.goalId} is outside the bound workspace`);
  }
  const recording = await readActivityRecording(records, input.goalRef.projectId, workspaceId, budget);
  const sessionRefs = input.sessionRefs ?? null;
  const segment: SegmentContext = {
    records, budget, goalRef: input.goalRef, workspaceId, from: input.from, to: input.to,
    toMs: Date.parse(input.to),
    bySession: sessionRefs === null ? null : new Set(sessionRefs.map(sessionKey)),
    sessionRefs, since: recording === null ? null : recording.since,
  };

  const cursor = input.cursor === null ? null : decodeCursor(input.cursor);
  const startIndex = cursor === null ? 0 : SEGMENTS.indexOf(cursor.s);
  const out: PageOut = { bars: [], hostRestarts: [], unplacedRuns: 0, unplacedRounds: 0, gateRounds: 0 };
  const seenRuns = new Set<string>();
  const seenRounds = new Set<string>();
  const taskRunCache = new Map<string, RunSnapshot[]>();
  const subjectCache = new Map<string, SessionRef | null>();
  const gateCache = new Map<string, { owners: SessionRef[]; gate: boolean }>();

  let next: string | null = null;
  for (let index = startIndex; index < SEGMENTS.length; index += 1) {
    const segmentId = SEGMENTS[index]!;
    const start = cursor !== null && cursor.s === segmentId ? cursor : null;
    const need = input.limit - out.bars.length;
    if (need <= 0) break;
    const outcome = await scanSegment(segmentId, segment, start, need, out,
      seenRuns, seenRounds, taskRunCache, subjectCache, gateCache);
    if (outcome.filled) {
      if (outcome.done) {
        const following = SEGMENTS[index + 1] ?? null;
        next = following === null ? null : encodeCursor({ s: following, o: null, k: null, q: null });
      } else {
        next = encodeCursor(outcome.cursor!);
      }
      break;
    }
  }

  await sessionProblemOf(out.bars, ctx, records, workspaceId, budget, new Map<string, true>());

  const restarts = [...new Set(out.hostRestarts)].sort(byteOrder)
    .map((at) => ({ at, approximate: true as const }));

  return { status: 'ready', value: {
    goalRef: input.goalRef, from: input.from, to: input.to, bars: out.bars, next,
    hostRestarts: restarts, queriesIncluded: sessionRefs !== null,
    unplaced: { runs: out.unplacedRuns, rounds: out.unplacedRounds, gateRounds: out.gateRounds },
  } };
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createTrackReadModel(deps: TrackReadModelDependencies): Pick<TrackReadPort, 'readTrackBars'> {
  const cap = deps.readRecordCap ?? ACTIVITY_READ_RECORD_CAP;
  return {
    async readTrackBars(ctx, input): Promise<ReadResult<TrackBarsPageV1>> {
      const problem = validateTrackInput(ctx, input);
      if (problem !== null) return problem;
      const window = `${input.from}..${input.to}`;
      for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
        const budget = new Budget(cap);
        try {
          const before = await readWatermark(deps.records);
          if (before.status !== 'ready') return before;
          const result = await readTrackBarsWindow(deps, ctx, input, budget);
          if (result.status !== 'ready') return result;
          const after = await readWatermark(deps.records);
          if (after.status !== 'ready') return after;
          if (before.value === after.value) return result;
        } catch (error) {
          if (error instanceof CapacityError) {
            return { status: 'rejected', code: 'capacity',
              reason: `the track read for window ${window} exceeds the storage-read cap of ${String(cap)}` };
          }
          if (error instanceof ForbiddenError) return rejected('forbidden', error.reason);
          return storeFailureToRejection(error as { code: string; reason: string });
        }
      }
      return rejected('unavailable', `the track read for window ${window} did not yield one stable read window within ${String(WINDOW_MAX_ATTEMPTS)} attempts`);
    },
  };
}
