/**
 * Slice 2B L9/L10/L17 and Slice 6A L16: the ONE read-only activity projector for
 * the calendar and for the per-Run and per-Query activity views.
 *
 * It reads the stored activity records (`RunActivity`, `QueryActivity`,
 * `ActivityRecording`) and the already-stored time points (Run/QueryRun
 * start/end, round `since` via `eventAt`). It never reads the Kernel, never
 * backfills, never writes, and never recomputes a running Run's or Query's
 * activity. Every storage read is counted against `ACTIVITY_READ_RECORD_CAP`;
 * the read window is a 2A L7 stable window (at most four attempts, all moving ->
 * `unavailable`). Any read failure fails the whole read; partial numbers are
 * never reported as complete.
 *
 * The calendar's scope is a Goal (as before) or a whole workspace. Work activity
 * and Query activity meet in the same cells: Query steps are included in
 * `steps` and broken out as `querySteps`, and Queries add no task entry because a
 * Query is not work on a Task. A cell's task entries merge by `(goalId, taskId)`
 * so two Goals' same task id never collide in a workspace scope.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { QueryJobSnapshot, QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import type {
  ActivityRecordingSnapshot, ActivityTotalsV1, QueryActivitySnapshot, RunActivitySnapshot,
  RunActivityUnknownReason, RunModelUsageV1,
} from '../../../contracts/run-activity.js';
import { ACTIVITY_READ_RECORD_CAP } from '../../../contracts/run-activity.js';
import type {
  EncodedRecord, GoalRecordTransactionPort,
} from '../../record-store/ports.js';
import type {
  RecordLookupPort, RecordOrderedLookupPort,
} from '../../record-store/lookup-ports.js';
import { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';
import {
  decodeVerificationRoundSnapshot,
  S2B_ROUND_BY_GOAL_LOOKUP,
} from '../persistence/evidence-record-codecs.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { queryActivityRefOf } from '../model/query-activity-plan.js';
import { QUERY_OPEN_BY_WORKSPACE_INDEX } from '../model/request-contracts.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import {
  decodeQueryActivitySnapshot,
  queryActivityRefKey,
} from '../persistence/query-activity-codecs.js';
import {
  decodeActivityRecordingSnapshot,
  decodeRunActivitySnapshot,
  runActivityRefKey,
  S2B_RUN_ACTIVITY_BY_GOAL_LAST_LOOKUP,
} from '../tasks/run-activity-codecs.js';
import {
  readGoalsByWorkspaceCreated,
  RUN_BY_WORKSPACE_STATUS_INDEX,
  S2B_RUN_BY_GOAL_ENDED_LOOKUP,
  S2B_RUN_BY_WORKSPACE_ENDED_LOOKUP,
} from '../tasks/plan-readers.js';
import {
  decodeQueryJobSnapshot,
  decodeQueryRunSnapshotRecord,
  S6_QUERY_RUN_BY_WORKSPACE_ENDED_LOOKUP,
} from '../queries/query-record-codecs.js';
import {
  decodeSessionRecord,
  sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import { storeFailureToRejection } from './goal-conflicts.js';
import {
  activityViewOf, Budget, CapacityError, claimingSessionOf, classifyMissingActivity, gateInfoOf,
  isQuarterInstant, missingQueryActivityGoalOf, queryActivityViewOf, queryExecutingSession, queryMissingActivityFacts,
  queryMissingActivityViewOf,
  readEqualityAll, readOneKeyed, readOrderedAll, runMissingActivityFacts, runMissingActivityViewOf, scanOrdered,
} from './activity-read-helpers.js';
import {
  ACTIVITY_WINDOW_MAX_ATTEMPTS, readStableActivityWindow,
} from './activity-stable-window.js';

// --------------------------------------------------------------------------
// Public view types (spec §2 "WorkGraph views")
// --------------------------------------------------------------------------

export type ActivityUncountedReason = RunActivityUnknownReason | 'not_backfilled' | 'not_recorded' | 'no_recording_epoch';

/** Slice 6A L16: one Query's activity, written out rather than intersecting the Work view. */
export type QueryActivityViewV1 = {
  queryRunRef: QueryRunRef; status: 'counted' | 'not_entered' | 'in_progress' | 'unknown';
  reason: ActivityUncountedReason | 'recorded_late' | null; error: boolean;
  totals: ActivityTotalsV1 | null;
  changedFiles: { definite: number; possible: number; possiblyIncomplete: boolean } | null;
  usage: (RunModelUsageV1['totals'] & { complete: boolean }) | null;
  recordedBy: 'query_end' | 'backfill' | null;
  recordedAt: string | null;
  countedThroughTurnEnd: boolean | null;
  unresolvedCalls: number | null;
  sessionRef: SessionRef | null;
  askedSessionRef: SessionRef | null;
  goalId: string | null;
};

export type ActivityCellV1 = {
  localDate: string; localHour: number | null;
  startAt: string; endAt: string; future: boolean;
  steps: number; querySteps: number; edits: number; editsUnknown: number; checks: number;
  uncountedRuns: number; inProgressRuns: number; uncountedQueries: number; inProgressQueries: number;
  complete: boolean;
  tasks: { taskId: string; goalId: string | null; steps: number; edits: number; checks: number }[]; moreTasks: number;
  sessions: SessionRef[]; moreSessions: number;
};

/** The calendar's scope: one Goal, or every kind of activity in `ctx.workspaceId`. */
export type ActivityCalendarScope =
  | { kind: 'goal'; goalRef: GoalRef }
  | { kind: 'workspace' };

/** One kind's calendar coverage; the Work coverage and `coverage.queries` carry the same fields. */
export type ActivityCalendarCoverageV1 = {
  runsCounted: number; runsRecordedLate: number; runsNotEntered: number; runsInProgress: number;
  runsUncounted: { reason: ActivityUncountedReason; count: number }[]; runsUnplaced: number; checksUnplaced: number;
  runsSessionUnknown: number | null;
  checksGateUnplaced: number | null;
};

export type ActivityCalendarV1 = {
  goalRef: GoalRef | null; from: string; to: string; granularity: 'hour' | 'day'; timeZone: string; now: string;
  cells: ActivityCellV1[];
  totals: { steps: number; querySteps: number; edits: number; editsUnknown: number; checks: number; complete: boolean };
  coverage: ActivityCalendarCoverageV1 & { queries: ActivityCalendarCoverageV1 };
  recordingSince: string | null;
  checksAttribution: 'round_start';
};

export type RunActivityViewV1 = {
  runRef: RunRef; status: 'counted' | 'not_entered' | 'in_progress' | 'unknown';
  reason: ActivityUncountedReason | 'recorded_late' | null; error: boolean;
  totals: ActivityTotalsV1 | null;
  changedFiles: { definite: number; possible: number; possiblyIncomplete: boolean } | null;
  usage: (RunModelUsageV1['totals'] & { complete: boolean }) | null;
  recordedBy: 'run_end' | 'backfill' | null;
  recordedAt: string | null;
  countedThroughTurnEnd: boolean | null;
  unresolvedCalls: number | null;
};

/**
 * The calendar, per-Run and per-Query activity reads. Spec §2 also places
 * `readTrackBars` on this port; the track owner (`views/track-read-model.ts`,
 * `createTrackReadModel`) contributes it, and this file deliberately does not
 * import that module so the two factories stay independent. The coordinator
 * merges the two halves into the one `ActivityReadPort` at integration.
 */
export interface ActivityReadPort {
  readActivityCalendar(ctx: CoreCallContext, input: {
    scope: ActivityCalendarScope; from: string; to: string;
    granularity: 'hour' | 'day'; timeZone: string; sessionRefs?: SessionRef[];
  }): Promise<ReadResult<ActivityCalendarV1>>;
  readRunActivities(ctx: CoreCallContext, input: { runRefs: RunRef[] }): Promise<ReadResult<RunActivityViewV1[]>>;
  readQueryActivities(ctx: CoreCallContext, input: { refs: QueryRunRef[] }):
    Promise<ReadResult<QueryActivityViewV1[]>>;
}

export type ActivityReadModelDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'> & RecordLookupPort & RecordOrderedLookupPort;
  /** P4: tests inject a smaller cap; production never passes another value. */
  readRecordCap?: number;
  /** Test-only clock seam; the composition always supplies one. */
  now: () => string;
};

const HOUR_MS = 60 * 60 * 1000;
const QUARTER_MS = 15 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOUR_SPAN_LIMIT_MS = 15 * DAY_MS;
const DAY_SPAN_LIMIT_MS = 400 * DAY_MS;
const SESSION_REF_LIMIT = 33;
/** Both activity reads accept 1–200 references per call. */
const ACTIVITY_REF_LIMIT = 200;
/** The calendar's fourth step stops one hour before `from` (commit-order skew). */
const ROUND_STOP_SKEW_MS = HOUR_MS;
/**
 * L9 step 4 scans rounds one row at a time so the early stop never reads, or
 * counts against `ACTIVITY_READ_RECORD_CAP`, rounds older than `from - 1h`.
 */
const ROUND_READ_PAGE_LIMIT = 1;

function knownTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** The local wall-clock date and hour of one instant under an IANA zone. */
function localPartsOf(ms: number, timeZone: string): { localDate: string; localHour: number } {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(ms));
  let year = ''; let month = ''; let day = ''; let hour = '00';
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
    else if (part.type === 'hour') hour = part.value === '24' ? '00' : part.value;
  }
  return { localDate: `${year}-${month}-${day}`, localHour: Number(hour) };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// --------------------------------------------------------------------------
// Calendar input validation
// --------------------------------------------------------------------------

type CalendarInput = {
  scope: ActivityCalendarScope; from: string; to: string;
  granularity: 'hour' | 'day'; timeZone: string; sessionRefs?: SessionRef[];
};

function validateCalendarInput(ctx: CoreCallContext, input: CalendarInput): CoreRejection | null {
  // The scope is a union the caller sends; a missing or unknown discriminator is
  // a malformed request, not a permission decision.
  const scope = (input as { scope?: unknown }).scope as
    { kind?: unknown; goalRef?: GoalRef } | null | undefined;
  if (scope === null || typeof scope !== 'object' || (scope.kind !== 'goal' && scope.kind !== 'workspace')) {
    return rejected('invalid', 'scope must be a goal or workspace scope');
  }
  if (scope.kind === 'goal') {
    const goalRef = scope.goalRef;
    if (goalRef === null || typeof goalRef !== 'object'
      || goalRef.aggregateType !== 'Goal' || goalRef.projectId !== ctx.projectId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the requested goal is outside the bound call scope' };
    }
  }
  if (input.granularity !== 'hour' && input.granularity !== 'day') return rejected('invalid', 'granularity must be hour or day');
  if (!knownTimeZone(input.timeZone)) return rejected('invalid', `unknown IANA time zone: ${String(input.timeZone)}`);
  if (!isQuarterInstant(input.from)) return rejected('invalid', 'from must be a UTC quarter boundary ending in Z');
  if (!isQuarterInstant(input.to)) return rejected('invalid', 'to must be a UTC quarter boundary ending in Z');
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  if (fromMs >= toMs) return rejected('invalid', 'from must be before to');
  const span = toMs - fromMs;
  if (input.granularity === 'hour' && span > HOUR_SPAN_LIMIT_MS) {
    return rejected('invalid', 'an hour-granularity window may span at most 15 days');
  }
  if (input.granularity === 'day' && span > DAY_SPAN_LIMIT_MS) {
    return rejected('invalid', 'a day-granularity window may span at most 400 days');
  }
  if (input.sessionRefs !== undefined) {
    if (!Array.isArray(input.sessionRefs) || input.sessionRefs.length > SESSION_REF_LIMIT) {
      return rejected('invalid', `sessionRefs may carry at most ${String(SESSION_REF_LIMIT)} references`);
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Calendar window
// --------------------------------------------------------------------------

/** The pure merge key of one task entry: the Goal is part of the identity in both scopes. */
export function calendarTaskKey(goalId: string | null, taskId: string): string {
  return JSON.stringify([goalId, taskId]);
}

/**
 * A cell is complete only when neither kind has an uncounted or in-progress item
 * in it (the Work rule extended to Query activity).
 */
export function calendarCellComplete(input: {
  uncountedRuns: number; inProgressRuns: number; uncountedQueries: number; inProgressQueries: number;
}): boolean {
  return input.uncountedRuns === 0 && input.inProgressRuns === 0
    && input.uncountedQueries === 0 && input.inProgressQueries === 0;
}

type CellBuilder = {
  localDate: string; localHour: number | null;
  startAt: string; endAt: string;
  steps: number; querySteps: number; edits: number; editsUnknown: number; checks: number;
  uncountedRuns: number; inProgressRuns: number; uncountedQueries: number; inProgressQueries: number;
  tasks: Map<string, { taskId: string; goalId: string | null; steps: number; edits: number; checks: number }>;
  sessions: Map<string, SessionRef>;
};

type CalendarWindow = ActivityCalendarV1;

function queryJobRefForRun(ref: QueryRunRef): import('../../../contracts/query-job.js').QueryJobRef {
  return { aggregateType: 'QueryJob', projectId: ref.projectId, workspaceId: ref.workspaceId,
    queryJobId: ref.queryJobId };
}

function sortedReasons(map: Map<ActivityUncountedReason, number>): { reason: ActivityUncountedReason; count: number }[] {
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0);
}

async function readCalendarWindow(
  deps: ActivityReadModelDependencies,
  ctx: CoreCallContext,
  input: CalendarInput,
  now: string,
  budget: Budget,
): Promise<ReadResult<CalendarWindow>> {
  const records = deps.records;
  const scope = input.scope;
  const goalRef = scope.kind === 'goal' ? scope.goalRef : null;
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  const nowMs = Date.parse(now);
  const bySession = input.sessionRefs === undefined ? null : new Set(input.sessionRefs.map(sessionKey));
  let workspaceId: string;
  if (scope.kind === 'goal') {
    // R4: the Goal names its own workspace; the caller is bound to `ctx.workspaceId`.
    // A same-project reference to another workspace is `forbidden` before any of
    // that workspace's records is used.
    workspaceId = await goalWorkspaceId(records, scope.goalRef, budget);
    if (workspaceId !== ctx.workspaceId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the goal belongs to another workspace' };
    }
  } else {
    // A workspace scope needs no Goal read; the bound workspace is the scope.
    if (ctx.workspaceId === undefined) {
      return { status: 'rejected', code: 'forbidden', reason: 'a workspace scope requires a bound call workspace' };
    }
    workspaceId = ctx.workspaceId;
  }
  const recording = await activityRecordingOf(records, ctx.projectId, workspaceId, budget);
  const since = recording === null ? null : recording.since;
  const querySince = recording === null ? null : recording.querySince;

  // Every cell intersecting [from, to); DST gaps simply have no quarters.
  const cells = new Map<string, CellBuilder>();
  const ensureCell = (ms: number): CellBuilder => {
    const local = localPartsOf(ms, input.timeZone);
    const localHour = input.granularity === 'hour' ? local.localHour : null;
    const key = `${local.localDate}#${localHour === null ? '' : String(localHour)}`;
    let cell = cells.get(key);
    if (cell === undefined) {
      cell = { localDate: local.localDate, localHour, startAt: iso(ms), endAt: iso(ms),
        steps: 0, querySteps: 0, edits: 0, editsUnknown: 0, checks: 0,
        uncountedRuns: 0, inProgressRuns: 0, uncountedQueries: 0, inProgressQueries: 0,
        tasks: new Map(), sessions: new Map() };
      cells.set(key, cell);
    }
    return cell;
  };
  for (let quarter = fromMs; quarter < toMs; quarter += QUARTER_MS) {
    const cell = ensureCell(quarter);
    if (quarter < Date.parse(cell.startAt)) cell.startAt = iso(quarter);
    const end = Math.min(quarter + QUARTER_MS, toMs);
    if (end > Date.parse(cell.endAt)) cell.endAt = iso(end);
  }
  /** Marks one uncounted/in-progress Run or Query on each cell its interval touches. */
  const markSpan = (
    field: 'uncountedRuns' | 'inProgressRuns' | 'uncountedQueries' | 'inProgressQueries',
    startMs: number, endMs: number, inclusive = false,
  ): void => {
    const lo = Math.max(startMs, fromMs);
    const hi = Math.min(endMs, toMs);
    if (hi < lo) return;
    const touched = new Set<string>();
    const bump = (quarter: number): void => {
      const cell = ensureCell(quarter);
      const key = `${cell.localDate}#${cell.localHour === null ? '' : String(cell.localHour)}`;
      if (touched.has(key)) return;
      touched.add(key);
      cell[field] += 1;
    };
    // L9 step 1: an inclusive span is the closed interval
    // `[startAt, lastAt]`. When clamping leaves a zero-width `[lo, lo]` but the
    // original span was non-zero, the inclusive endpoint still lies inside
    // `[from, to)` and marks the cell that contains it (e.g. `[09:00, 10:00]`
    // read with `from = 10:00` marks the 10:00 cell). A genuinely zero-length
    // span marks the same cell, a half-open interval marks nothing, and a `hi`
    // clamped to the exclusive window end is never marked.
    if (hi === lo) {
      if (inclusive && endMs >= fromMs && endMs < toMs) bump(endMs);
      return;
    }
    // An inclusive span is the closed interval `[startAt, lastAt]`, so a
    // span whose `lastAt` is exactly on a quarter boundary also marks the cell
    // at that boundary. A half-open span stops before `hi`, and a `hi` clamped
    // to the exclusive window end is never marked.
    const startQuarter = Math.floor(lo / QUARTER_MS) * QUARTER_MS;
    for (let quarter = startQuarter; quarter < toMs; quarter += QUARTER_MS) {
      if (quarter < fromMs) continue;
      if (inclusive ? quarter > hi : quarter >= hi) break;
      bump(quarter);
    }
  };
  const addTask = (
    cell: CellBuilder, goalId: string | null, taskId: string, steps: number, edits: number, checks: number,
  ): void => {
    const key = calendarTaskKey(goalId, taskId);
    const task = cell.tasks.get(key) ?? { taskId, goalId, steps: 0, edits: 0, checks: 0 };
    task.steps += steps; task.edits += edits; task.checks += checks;
    cell.tasks.set(key, task);
  };

  const runsUncounted = new Map<ActivityUncountedReason, number>();
  const addRunUncounted = (reason: ActivityUncountedReason): void => {
    runsUncounted.set(reason, (runsUncounted.get(reason) ?? 0) + 1);
  };
  const queriesUncounted = new Map<ActivityUncountedReason, number>();
  const addQueryUncounted = (reason: ActivityUncountedReason): void => {
    queriesUncounted.set(reason, (queriesUncounted.get(reason) ?? 0) + 1);
  };
  let runsCounted = 0;
  let runsRecordedLate = 0;
  let runsNotEntered = 0;
  let runsInProgress = 0;
  let runsUnplaced = 0;
  let checksUnplaced = 0;
  let runsSessionUnknown = 0;
  let checksGateUnplaced = 0;
  let queriesCounted = 0;
  let queriesRecordedLate = 0;
  let queriesNotEntered = 0;
  let queriesInProgress = 0;
  let queriesUnplaced = 0;
  let queriesSessionUnknown = 0;

  /** Counts one stored Work activity record into the cells, or refuses a foreign one. */
  const countStoredRunActivity = (activity: RunActivitySnapshot): CoreRejection | null => {
    const firstAt = activity.span.firstAt;
    const lastAt = activity.span.lastAt;
    // The ordered Work index is bounded by `lastAt`; a workspace-scope read
    // reaches the record through the Run's end instead, so both bounds are
    // applied here explicitly.
    if (lastAt < input.from) return null;
    const inWindow = firstAt === null ? lastAt < input.to : firstAt < input.to;
    if (!inWindow) return null;
    const session = activity.sessionRef;
    if (bySession !== null) {
      if (session === null) { runsSessionUnknown += 1; return null; }
      if (!bySession.has(sessionKey(session))) return null;
    }
    if (activity.facts.status === 'unknown') {
      addRunUncounted(activity.facts.reason);
      if (firstAt === null) runsUnplaced += 1;
      else markSpan('uncountedRuns', Date.parse(firstAt), Date.parse(lastAt), true);
      return null;
    }
    if (since !== null && activity.recordedBy === 'backfill' && activity.runEndedAt >= since) {
      runsRecordedLate += 1;
    }
    runsCounted += 1;
    if (activity.facts.overflow !== null) runsUnplaced += 1;
    for (const quarter of activity.facts.quarters) {
      const atMs = Date.parse(quarter.at);
      if (atMs < fromMs || atMs >= toMs) continue;
      const cell = ensureCell(atMs);
      cell.steps += quarter.steps; cell.edits += quarter.edits; cell.editsUnknown += quarter.editsUnknown;
      if (session !== null) {
        // R4: a returned SessionRef must be in the bound project (SessionRef
        // carries no workspaceId, so the project is the strongest scope it has).
        if (session.projectId !== ctx.projectId) {
          return { status: 'rejected', code: 'forbidden', reason: 'the Run activity Session is outside the bound call scope' };
        }
        cell.sessions.set(sessionKey(session), session);
      }
      addTask(cell, activity.runRef.goalId, activity.taskId, quarter.steps, quarter.edits, 0);
    }
    return null;
  };

  /**
   * L7: a Run with no RunActivity record is never 0 unless it provably never
   * entered. The classification itself is the shared `classifyMissingActivity`;
   * this hook only says where a calendar puts each outcome.
   */
  const classifyMissingRunActivity = (run: RunSnapshot, recordingSince: string | null): void => {
    const classification = classifyMissingActivity(runMissingActivityFacts(run, recordingSince));
    if (classification.kind === 'not_entered') { runsNotEntered += 1; return; }
    if (classification.kind === 'in_progress') {
      runsInProgress += 1;
      if (run.startedAt !== null) markSpan('inProgressRuns', Date.parse(run.startedAt), Math.max(nowMs, fromMs));
      return;
    }
    addRunUncounted(classification.reason);
    if (run.startedAt === null) { runsUnplaced += 1; return; }
    if (run.endedAt === null) return;
    markSpan('uncountedRuns', Date.parse(run.startedAt), Date.parse(run.endedAt), true);
  };

  /**
   * L9 step 4: one Goal's verification rounds, read by start (`since`)
   * descending, their begun checks put in the round start's cell on the
   * round's task and Goal. Every Goal a read covers shares the cells, the
   * budget and the attribution caches.
   */
  const stopAt = fromMs - ROUND_STOP_SKEW_MS;
  const subjectSessionCache = new Map<string, SessionRef | null>();
  const gateSessionCache = new Map<string, { owners: SessionRef[]; gate: boolean }>();
  const countGoalChecks = async (checkedGoal: GoalRef): Promise<void> => {
    for await (const record of scanOrdered(records, {
      index: S2B_ROUND_BY_GOAL_LOOKUP,
      values: [checkedGoal.projectId, workspaceId, checkedGoal.goalId],
      direction: 'desc',
    }, ROUND_READ_PAGE_LIMIT, budget)) {
      const origin = decodeNoticeOrigin(record);
      if (origin.status !== 'decoded') throw rejected('unavailable', `round origin ${record.refKey}: ${origin.reason}`);
      const cursor = origin.value.since;
      if (cursor === undefined || cursor === null) throw rejected('unavailable', `round ${record.refKey} is missing its since cursor`);
      const at = await records.eventAt(cursor);
      if (at.status !== 'ready') throw at;
      budget.spend(1);
      const startedAt = at.value.event.occurredAt;
      const startedMs = Date.parse(startedAt);
      if (startedMs < stopAt) break;
      const decoded = decodeVerificationRoundSnapshot(record);
      if (decoded.status !== 'decoded') throw rejected('unavailable', `round ${record.refKey}: ${decoded.reason}`);
      if (startedMs < fromMs || startedMs >= toMs) continue;
      await attributeRound(decoded.value, record, startedMs, {
        records, budget, goalRef: checkedGoal, workspaceId, bySession,
        subjectSessionCache, gateSessionCache,
        onChecks: (taskId, checks, sessions, gateUnplaced) => {
          // L9 step 4: a gate check with no open responsible Session is not in a
          // `sessionRefs`-filtered cell at all; it is only counted in
          // `checksGateUnplaced`. Without `sessionRefs` the gate is always placed.
          if (gateUnplaced) { checksGateUnplaced += checks; return; }
          const cell = ensureCell(startedMs);
          cell.checks += checks;
          for (const session of sessions) cell.sessions.set(sessionKey(session), session);
          addTask(cell, checkedGoal.goalId, taskId, 0, 0, checks);
        },
      });
    }
  };

  if (goalRef !== null) {
    // ---- 1. RunActivity records by Goal (ordered by span.lastAt) ------------
    const activityRecords = await readOrderedAll(records, {
      index: S2B_RUN_ACTIVITY_BY_GOAL_LAST_LOOKUP,
      values: [goalRef.projectId, goalRef.goalId],
      direction: 'asc', bound: { value: input.from, inclusive: true },
    }, budget);
    const recordActivityRunIds = new Set<string>();
    for (const record of activityRecords) {
      const decoded = decodeRunActivitySnapshot(record);
      if (decoded.status !== 'decoded') throw rejected('unavailable', `RunActivity record ${record.refKey}: ${decoded.reason}`);
      const activity = decoded.value;
      // R4: a record (and the Session it carries) must belong to the bound
      // workspace/project; a foreign record is never returned.
      if (activity.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Run activity belongs to another workspace' };
      }
      recordActivityRunIds.add(activity.runRef.runId);
      const problem = countStoredRunActivity(activity);
      if (problem !== null) return problem;
    }

    // ---- 2. Ended Runs without a record (L7 classification) ---------------
    const endedRuns = await readOrderedAll(records, {
      index: S2B_RUN_BY_GOAL_ENDED_LOOKUP,
      values: [goalRef.projectId, goalRef.goalId],
      direction: 'asc', bound: { value: input.from, inclusive: true },
    }, budget);
    const classified = new Set<string>();
    for (const record of endedRuns) {
      const runDecoded = decodeRun(record);
      if (!runDecoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${runDecoded.reason}`);
      const run = runDecoded.value;
      if (run.ref.goalId !== goalRef.goalId) continue;
      const startedAt = run.startedAt;
      if (!(startedAt !== null ? startedAt < input.to : (run.endedAt !== null && run.endedAt < input.to))) continue;
      if (recordActivityRunIds.has(run.ref.runId)) continue;
      classified.add(run.ref.runId);
      const existing = await readOneKeyed(records, runActivityRefKey(runActivityRefOf(run.ref)), budget);
      if (existing === undefined) {
        // L9 input + L17: Run placement filters by the claiming Session, and a
        // Session-resolution failure propagates as a read failure.
        if (bySession !== null) {
          const session = await claimingSessionOf(records, run, budget);
          if (!bySession.has(sessionKey(session))) continue;
        }
        classifyMissingRunActivity(run, since);
        continue;
      }
      // L9 step 2: every Run that has an activity record is SKIPPED here,
      // regardless of step 1's set. The ordered step already counted the records
      // inside its window; a record whose `span.lastAt` is before `from` is
      // outside this window and must not be counted by this fallback either.
      continue;
    }

    // ---- 3. Open Runs still in flight ------------------------------------
    const openRuns: RunSnapshot[] = [];
    for (const status of ['starting', 'running'] as const) {
      const rows = await readEqualityAll(records, RUN_BY_WORKSPACE_STATUS_INDEX,
        [goalRef.projectId, workspaceId, status], budget);
      for (const record of rows) {
        const decoded = decodeRun(record);
        if (!decoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${decoded.reason}`);
        if (decoded.value.ref.goalId === goalRef.goalId) openRuns.push(decoded.value);
      }
    }
    for (const run of openRuns) {
      if (classified.has(run.ref.runId)) continue;
      const session = await claimingSessionOf(records, run, budget);
      if (bySession !== null && !bySession.has(sessionKey(session))) {
        continue;
      }
      runsInProgress += 1;
      if (run.startedAt === null) continue;
      markSpan('inProgressRuns', Date.parse(run.startedAt), Math.max(nowMs, fromMs));
    }

    // ---- 4. Verification rounds by Goal ------------------------------------
    await countGoalChecks(goalRef);
  } else {
    // ---- Workspace scope: every ended Run of the workspace, any Goal ----
    const endedRuns = await readOrderedAll(records, {
      index: S2B_RUN_BY_WORKSPACE_ENDED_LOOKUP,
      values: [ctx.projectId, workspaceId],
      direction: 'asc', bound: { value: input.from, inclusive: true },
    }, budget);
    const classified = new Set<string>();
    for (const record of endedRuns) {
      const runDecoded = decodeRun(record);
      if (!runDecoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${runDecoded.reason}`);
      const run = runDecoded.value;
      const startedAt = run.startedAt;
      if (!(startedAt !== null ? startedAt < input.to : (run.endedAt !== null && run.endedAt < input.to))) continue;
      classified.add(run.ref.runId);
      const existing = await readOneKeyed(records, runActivityRefKey(runActivityRefOf(run.ref)), budget);
      if (existing !== undefined) {
        const decoded = decodeRunActivitySnapshot(existing);
        if (decoded.status !== 'decoded') throw rejected('unavailable', `RunActivity record ${existing.refKey}: ${decoded.reason}`);
        if (decoded.value.workspaceId !== ctx.workspaceId) {
          return { status: 'rejected', code: 'forbidden', reason: 'the Run activity belongs to another workspace' };
        }
        if (decoded.value.runRef.goalId !== run.ref.goalId) continue;
        const problem = countStoredRunActivity(decoded.value);
        if (problem !== null) return problem;
        continue;
      }
      if (bySession !== null) {
        const session = await claimingSessionOf(records, run, budget);
        if (!bySession.has(sessionKey(session))) continue;
      }
      classifyMissingRunActivity(run, since);
    }

    // ---- Open Runs of the workspace --------------------------------
    for (const status of ['starting', 'running'] as const) {
      const rows = await readEqualityAll(records, RUN_BY_WORKSPACE_STATUS_INDEX,
        [ctx.projectId, workspaceId, status], budget);
      for (const record of rows) {
        const decoded = decodeRun(record);
        if (!decoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${decoded.reason}`);
        const run = decoded.value;
        if (classified.has(run.ref.runId)) continue;
        const session = await claimingSessionOf(records, run, budget);
        if (bySession !== null && !bySession.has(sessionKey(session))) continue;
        runsInProgress += 1;
        if (run.startedAt === null) continue;
        markSpan('inProgressRuns', Date.parse(run.startedAt), Math.max(nowMs, fromMs));
      }
    }

    // ---- Verification rounds of every Goal of the workspace --------------
    const goals = await readGoalsByWorkspaceCreated(records, { projectId: ctx.projectId, workspaceId });
    if (goals.status !== 'ready') throw goals;
    budget.spend(goals.goals.length);
    for (const goal of goals.goals) await countGoalChecks(goal.ref);
  }

  // ---- Query activity (L16): the workspace's Queries, Goal filter per scope ----
  // An ended QueryRun comes from the workspace's ended index. An unfinished one
  // has no end to be indexed by, so it comes from the open-Job index (request
  // rounds and plain Queries alike) through its Job's current Run. One read
  // counts one Query once, by its full QueryRunRef.
  const queryCandidates = new Map<string, { run: QueryRunSnapshot; job: QueryJobSnapshot | null }>();
  const endedQueryRuns = await readOrderedAll(records, {
    index: S6_QUERY_RUN_BY_WORKSPACE_ENDED_LOOKUP,
    values: [ctx.projectId, workspaceId],
    direction: 'asc', bound: { value: input.from, inclusive: true },
  }, budget);
  for (const record of endedQueryRuns) {
    const runDecoded = decodeQueryRunSnapshotRecord(record);
    if (runDecoded.status !== 'decoded') throw rejected('unavailable', `QueryRun record ${record.refKey}: ${runDecoded.reason}`);
    const run = runDecoded.value;
    if (run.ref.projectId !== ctx.projectId || run.ref.workspaceId !== workspaceId) continue;
    const runKey = canonicalKey(run.ref);
    if (!queryCandidates.has(runKey)) queryCandidates.set(runKey, { run, job: null });
  }
  for (const requestMark of ['request', 'none'] as const) {
    for (const status of ['pending', 'running'] as const) {
      const openJobs = await readOrderedAll(records, {
        index: QUERY_OPEN_BY_WORKSPACE_INDEX,
        values: [ctx.projectId, workspaceId, requestMark, status],
        direction: 'asc',
      }, budget);
      for (const record of openJobs) {
        const jobDecoded = decodeQueryJobSnapshot(record);
        if (jobDecoded.status !== 'decoded') throw rejected('unavailable', `QueryJob record ${record.refKey}: ${jobDecoded.reason}`);
        const job = jobDecoded.value;
        const runRef = job.job.runRef;
        if (runRef === null) continue;
        const runKey = canonicalKey(runRef);
        if (queryCandidates.has(runKey)) continue;
        const runRecord = await readOneKeyed(records, runKey, budget);
        if (runRecord === undefined) throw rejected('unavailable', `the QueryRun ${runRef.runId} of an open QueryJob is missing`);
        const runDecoded = decodeQueryRunSnapshotRecord(runRecord);
        if (runDecoded.status !== 'decoded') throw rejected('unavailable', `QueryRun record ${runRecord.refKey}: ${runDecoded.reason}`);
        queryCandidates.set(runKey, { run: runDecoded.value, job });
      }
    }
  }
  for (const { run, job: openJob } of queryCandidates.values()) {

    const activityRecord = await readOneKeyed(records, queryActivityRefKey(queryActivityRefOf(run.ref)), budget);
    let activity: QueryActivitySnapshot | null = null;
    if (activityRecord !== undefined) {
      const decoded = decodeQueryActivitySnapshot(activityRecord);
      if (decoded.status !== 'decoded') throw rejected('unavailable', `QueryActivity record ${activityRecord.refKey}: ${decoded.reason}`);
      if (decoded.value.ref.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Query activity belongs to another workspace' };
      }
      activity = decoded.value;
    }

    const executing = activity === null ? queryExecutingSession(run) : activity.sessionRef;
    const asked = activity === null ? null : activity.askedSessionRef;
    let effectiveGoalId: string | null = activity === null ? null : activity.goalId;
    if (activity === null && goalRef !== null) {
      // A Query that never wrote a record still names its Goal on its Job and
      // Run (`missingQueryActivityGoalOf`).
      let job = openJob;
      if (job === null) {
        const jobRecord = await readOneKeyed(records, canonicalKey(queryJobRefForRun(run.ref)), budget);
        if (jobRecord === undefined) {
          throw rejected('unavailable', `the QueryJob ${run.ref.queryJobId} is missing`);
        }
        const jobDecoded = decodeQueryJobSnapshot(jobRecord);
        if (jobDecoded.status !== 'decoded') throw rejected('unavailable', `QueryJob record ${jobRecord.refKey}: ${jobDecoded.reason}`);
        job = jobDecoded.value;
      }
      effectiveGoalId = missingQueryActivityGoalOf(job, run);
    }

    // The Goal calendar filters every Query by its Goal, a consultation copy
    // too; the copy's exception is the track's (`queryOwnScanOf`).
    if (goalRef !== null && effectiveGoalId !== goalRef.goalId) continue;
    let placement: SessionRef | null;
    if (bySession !== null) {
      placement = asked ?? executing;
      if (placement === null) { queriesSessionUnknown += 1; continue; }
      if (!bySession.has(sessionKey(placement))) continue;
    } else {
      // Without a line filter the executing Session is the cell's line.
      placement = executing;
    }

    if (activity !== null) {
      // The Query index is bounded by the QueryRun's own end, not by the
      // record's span, so both Work-side window bounds are applied here.
      if (activity.span.lastAt < input.from) continue;
      if (!(activity.span.firstAt === null
        ? activity.span.lastAt < input.to
        : activity.span.firstAt < input.to)) continue;
      // The status and any late projection come from the one shared
      // `queryActivityViewOf`; the calendar only places its facts.
      const view = queryActivityViewOf(activity, querySince);
      if (view.status === 'unknown') {
        addQueryUncounted(view.reason);
        if (activity.span.firstAt === null) queriesUnplaced += 1;
        else markSpan('uncountedQueries', Date.parse(activity.span.firstAt), Date.parse(activity.span.lastAt), true);
        continue;
      }
      if (view.reason === 'recorded_late') queriesRecordedLate += 1;
      queriesCounted += 1;
      if (activity.facts.status === 'counted') {
        if (activity.facts.overflow !== null) queriesUnplaced += 1;
        for (const quarter of activity.facts.quarters) {
          const atMs = Date.parse(quarter.at);
          if (atMs < fromMs || atMs >= toMs) continue;
          const cell = ensureCell(atMs);
          cell.steps += quarter.steps;
          cell.querySteps += quarter.steps;
          if (placement !== null) cell.sessions.set(sessionKey(placement), placement);
        }
      }
      continue;
    }

    const startedAt = run.run.startedAt;
    const endedAt = run.run.endedAt;
    const inWindow = startedAt !== null ? startedAt < input.to : (endedAt !== null && endedAt < input.to);
    if (!inWindow) continue;
    const classification = classifyMissingActivity(queryMissingActivityFacts(run, querySince));
    if (classification.kind === 'not_entered') { queriesNotEntered += 1; continue; }
    if (classification.kind === 'in_progress') {
      queriesInProgress += 1;
      if (startedAt !== null) markSpan('inProgressQueries', Date.parse(startedAt), Math.max(nowMs, fromMs));
      continue;
    }
    addQueryUncounted(classification.reason);
    // A QueryRun with no start or end instant has no interval to mark.
    if (startedAt === null || endedAt === null) { queriesUnplaced += 1; continue; }
    markSpan('uncountedQueries', Date.parse(startedAt), Date.parse(endedAt), true);
  }

  // ---- R4: resolve every returned SessionRef; enforce the bound workspace.
  // The per-read cache keeps one Session record read per distinct reference,
  // charged to the same storage-read budget.
  const sessionWorkspaceCache = new Set<string>();
  for (const cell of cells.values()) {
    for (const session of cell.sessions.values()) {
      const key = sessionKey(session);
      if (sessionWorkspaceCache.has(key)) continue;
      if (session.projectId !== ctx.projectId) {
        return { status: 'rejected', code: 'forbidden',
          reason: `Session ${key} is outside the bound call scope` };
      }
      const record = await readOneKeyed(records, sessionAggregateRefKey({ aggregateType: 'Session',
        projectId: session.projectId, sessionId: session.sessionId }), budget);
      if (record !== undefined) {
        const decoded = decodeSessionRecord(record);
        if (decoded.status !== 'decoded') throw rejected('unavailable', `Session ${record.refKey}: ${decoded.reason}`);
        if (decoded.value.workspaceId !== ctx.workspaceId) {
          return { status: 'rejected', code: 'forbidden',
            reason: `Session ${key} is outside the bound workspace` };
        }
      }
      sessionWorkspaceCache.add(key);
    }
  }

  // ---- Materialize cells -------------------------------------------------
  const materialized: ActivityCellV1[] = [...cells.values()]
    .sort((left, right) => left.localDate === right.localDate
      ? (left.localHour ?? 0) - (right.localHour ?? 0)
      : (left.localDate < right.localDate ? -1 : 1))
    .map((cell) => {
      const ranked = [...cell.tasks.values()]
        .map((totals) => ({ taskId: totals.taskId, goalId: totals.goalId,
          steps: totals.steps, edits: totals.edits, checks: totals.checks }))
        .sort((left, right) => {
          const leftWeight = left.steps + left.edits + left.checks;
          const rightWeight = right.steps + right.edits + right.checks;
          if (leftWeight !== rightWeight) return rightWeight - leftWeight;
          if (left.taskId !== right.taskId) return left.taskId < right.taskId ? -1 : 1;
          return (left.goalId ?? '') < (right.goalId ?? '') ? -1 : (left.goalId ?? '') > (right.goalId ?? '') ? 1 : 0;
        });
      const sessions = [...cell.sessions.values()]
        .sort((left, right) => left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0);
      return {
        localDate: cell.localDate, localHour: cell.localHour,
        startAt: cell.startAt, endAt: cell.endAt, future: Date.parse(cell.startAt) > nowMs,
        steps: cell.steps, querySteps: cell.querySteps,
        edits: cell.edits, editsUnknown: cell.editsUnknown, checks: cell.checks,
        uncountedRuns: cell.uncountedRuns, inProgressRuns: cell.inProgressRuns,
        uncountedQueries: cell.uncountedQueries, inProgressQueries: cell.inProgressQueries,
        complete: calendarCellComplete(cell),
        tasks: ranked.slice(0, 3), moreTasks: Math.max(0, ranked.length - 3),
        sessions: sessions.slice(0, 10), moreSessions: Math.max(0, sessions.length - 10),
      };
    });

  const totals = materialized.reduce((sum, cell) => ({
    steps: sum.steps + cell.steps, querySteps: sum.querySteps + cell.querySteps,
    edits: sum.edits + cell.edits,
    editsUnknown: sum.editsUnknown + cell.editsUnknown, checks: sum.checks + cell.checks,
  }), { steps: 0, querySteps: 0, edits: 0, editsUnknown: 0, checks: 0 });
  const uncountedTotal = [...runsUncounted.values()].reduce((sum, count) => sum + count, 0);
  const queriesUncountedTotal = [...queriesUncounted.values()].reduce((sum, count) => sum + count, 0);
  const queriesComplete = queriesUncountedTotal === 0 && queriesInProgress === 0 && queriesUnplaced === 0
    && (bySession === null || queriesSessionUnknown === 0);
  const complete = uncountedTotal === 0 && runsInProgress === 0 && runsUnplaced === 0 && checksUnplaced === 0
    && runsSessionUnknown === 0 && queriesComplete;
  const coverage: ActivityCalendarV1['coverage'] = {
    runsCounted, runsRecordedLate, runsNotEntered, runsInProgress,
    runsUncounted: sortedReasons(runsUncounted),
    runsUnplaced, checksUnplaced,
    runsSessionUnknown: bySession === null ? null : runsSessionUnknown,
    checksGateUnplaced: bySession === null ? null : checksGateUnplaced,
    // The Work coverage's fields with the Query counts; a Query has no checks.
    queries: {
      runsCounted: queriesCounted, runsRecordedLate: queriesRecordedLate, runsNotEntered: queriesNotEntered,
      runsInProgress: queriesInProgress, runsUncounted: sortedReasons(queriesUncounted),
      runsUnplaced: queriesUnplaced, checksUnplaced: 0,
      runsSessionUnknown: bySession === null ? null : queriesSessionUnknown,
      checksGateUnplaced: bySession === null ? null : 0,
    },
  };
  return { status: 'ready', value: {
    goalRef, from: input.from, to: input.to, granularity: input.granularity,
    timeZone: input.timeZone, now, cells: materialized,
    totals: { ...totals, complete }, coverage,
    recordingSince: since, checksAttribution: 'round_start',
  } };
}

function checksBegun(round: { checks: readonly { invocationId: string | null }[] }): number {
  return round.checks.filter((check) => check.invocationId !== null).length;
}

function runActivityRefOf(runRef: RunRef): RunActivitySnapshot['ref'] {
  return { aggregateType: 'RunActivity', projectId: runRef.projectId, goalId: runRef.goalId, runId: runRef.runId };
}

function sessionKey(session: SessionRef): string {
  return `${session.projectId}/${session.sessionId}`;
}

async function goalWorkspaceId(
  records: ActivityReadModelDependencies['records'],
  goalRef: GoalRef,
  budget: Budget,
): Promise<string> {
  const record = await readOneKeyed(records, canonicalKey(goalRef), budget);
  if (record === undefined) throw rejected('unavailable', `the Goal ${goalRef.goalId} is missing`);
  const decoded = decodeGoalSnapshot(record);
  if (decoded.status !== 'decoded') throw rejected('unavailable', `the Goal ${goalRef.goalId}: ${decoded.reason}`);
  return decoded.value.workspaceRef.workspaceId;
}

async function activityRecordingOf(
  records: ActivityReadModelDependencies['records'],
  projectId: string,
  workspaceId: string,
  budget: Budget,
): Promise<ActivityRecordingSnapshot | null> {
  const record = await readOneKeyed(records,
    canonicalKey({ aggregateType: 'ActivityRecording', projectId, workspaceId }), budget);
  if (record === undefined) return null;
  const decoded = decodeActivityRecordingSnapshot(record);
  if (decoded.status !== 'decoded') throw rejected('unavailable', `ActivityRecording ${record.refKey}: ${decoded.reason}`);
  return decoded.value;
}

/** One round's checks: the task, the attributed Sessions, and the gate fallthrough. */
async function attributeRound(
  round: import('../../../contracts/verification.js').RoundSnapshot,
  record: EncodedRecord,
  startedMs: number,
  deps: {
    records: ActivityReadModelDependencies['records'];
    budget: Budget;
    goalRef: GoalRef;
    workspaceId: string;
    bySession: Set<string> | null;
    subjectSessionCache: Map<string, SessionRef | null>;
    gateSessionCache: Map<string, { owners: SessionRef[]; gate: boolean }>;
    onChecks: (taskId: string, checks: number, sessions: SessionRef[], gateUnplaced: boolean) => void;
  },
): Promise<void> {
  void record; void startedMs;
  const begun = checksBegun(round);
  const subjectKey = canonicalKey(round.subjectRunRef);
  const session = await subjectSessionCached(deps.records, deps.subjectSessionCache, round.subjectRunRef, deps.budget);
  const gate = await gateInfoOf(deps.records, deps.goalRef, round, deps.budget, deps.gateSessionCache);
  // The shared gate read returns the owners unsorted; the calendar orders them
  // by `sessionId`.
  const owners = gate.gate
    ? [...gate.owners].sort((left, right) => left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0)
    : gate.owners;
  if (deps.bySession === null) {
    deps.onChecks(round.subject.taskId, begun, session === null ? [] : [session], false);
    return;
  }
  if (gate.gate) {
    if (owners.length === 0) { deps.onChecks(round.subject.taskId, begun, [], true); return; }
    if (!owners.some((owner) => deps.bySession!.has(sessionKey(owner)))) return;
    deps.onChecks(round.subject.taskId, begun, owners, false);
    return;
  }
  void subjectKey;
  if (session === null || !deps.bySession.has(sessionKey(session))) return;
  deps.onChecks(round.subject.taskId, begun, [session], false);
}

async function subjectSessionCached(
  records: ActivityReadModelDependencies['records'],
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
    session = await claimingSessionOf(records, decoded.value, budget);
  }
  cache.set(key, session);
  return session;
}

function canonicalKey(value: unknown): string {
  // Refs are plain JSON objects with stable key order; the record key is the
  // canonical JSON of the full ref (contracts/fingerprint.canonicalJson).
  return canonicalJson(value as JsonValue);
}

// --------------------------------------------------------------------------
// readRunActivities (L10)
// --------------------------------------------------------------------------

async function readRunActivitiesWindow(
  deps: ActivityReadModelDependencies,
  ctx: CoreCallContext,
  input: { runRefs: RunRef[] },
  budget: Budget,
): Promise<ReadResult<RunActivityViewV1[]>> {
  const records = deps.records;
  const recordingCache = new Map<string, string | null>();
  const views: RunActivityViewV1[] = [];
  for (const runRef of input.runRefs) {
    if (runRef.projectId !== ctx.projectId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the requested Run is outside the bound call scope' };
    }
    const activityRecord = await readOneKeyed(records, runActivityRefKey(runActivityRefOf(runRef)), budget);
    const runRecord = await readOneKeyed(records, canonicalKey(runRef), budget);
    let run: RunSnapshot | null = null;
    if (runRecord !== undefined) {
      const decoded = decodeRun(runRecord);
      if (!decoded.ok) return rejected('unavailable', `Run record ${runRecord.refKey}: ${decoded.reason}`);
      run = decoded.value;
      // R4: a Run record names its own workspace; the caller is bound to
      // `ctx.workspaceId`. A same-project Run in another workspace is
      // `forbidden` before anything it names is returned.
      if (run.workspaceSnapshot.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Run belongs to another workspace' };
      }
    }
    const workspaceId = run?.workspaceSnapshot.workspaceId;
    let since: string | null = null;
    if (workspaceId !== undefined) {
      if (recordingCache.has(workspaceId)) since = recordingCache.get(workspaceId) ?? null;
      else {
        const recording = await activityRecordingOf(records, runRef.projectId, workspaceId, budget);
        since = recording === null ? null : recording.since;
        recordingCache.set(workspaceId, since);
      }
    }
    if (activityRecord !== undefined) {
      const decoded = decodeRunActivitySnapshot(activityRecord);
      if (decoded.status !== 'decoded') return rejected('unavailable', `RunActivity record ${activityRecord.refKey}: ${decoded.reason}`);
      // R4: the record itself must belong to the bound workspace, even when the
      // Run record is missing or names a different one.
      if (decoded.value.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Run activity belongs to another workspace' };
      }
      views.push(activityViewOf(decoded.value, since));
      continue;
    }
    // A missing record (or a missing Run) is classified by the one shared
    // missing-activity rule; this view only maps its outcome to the public shape.
    views.push(runMissingActivityViewOf(runRef, classifyMissingActivity(runMissingActivityFacts(run, since))));
  }
  return { status: 'ready', value: views };
}

// --------------------------------------------------------------------------
// readQueryActivities (L16)
// --------------------------------------------------------------------------

async function readQueryActivitiesWindow(
  deps: ActivityReadModelDependencies,
  ctx: CoreCallContext,
  input: { refs: QueryRunRef[] },
  budget: Budget,
): Promise<ReadResult<QueryActivityViewV1[]>> {
  const records = deps.records;
  const querySinceCache = new Map<string, string | null>();
  /** The workspace's Query epoch, one keyed read per read (L16). */
  const querySinceOf = async (projectId: string, workspaceId: string): Promise<string | null> => {
    if (querySinceCache.has(workspaceId)) return querySinceCache.get(workspaceId) ?? null;
    const recording = await activityRecordingOf(records, projectId, workspaceId, budget);
    const querySince = recording === null ? null : recording.querySince;
    querySinceCache.set(workspaceId, querySince);
    return querySince;
  };
  const views: QueryActivityViewV1[] = [];
  for (const queryRef of input.refs) {
    // A QueryRunRef names its workspace; a ref outside the call scope is refused
    // before any of that workspace's records is used.
    if (queryRef.projectId !== ctx.projectId || queryRef.workspaceId !== ctx.workspaceId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the requested Query is outside the bound call scope' };
    }
    const activityRecord = await readOneKeyed(records, queryActivityRefKey(queryActivityRefOf(queryRef)), budget);
    const runRecord = await readOneKeyed(records, canonicalKey(queryRef), budget);
    // Both records are read by keys built from the checked reference, so they
    // are in the bound workspace.
    let run: QueryRunSnapshot | null = null;
    if (runRecord !== undefined) {
      const decoded = decodeQueryRunSnapshotRecord(runRecord);
      if (decoded.status !== 'decoded') return rejected('unavailable', `QueryRun record ${runRecord.refKey}: ${decoded.reason}`);
      run = decoded.value;
    }
    const querySince = await querySinceOf(queryRef.projectId, queryRef.workspaceId);
    if (activityRecord !== undefined) {
      const decoded = decodeQueryActivitySnapshot(activityRecord);
      if (decoded.status !== 'decoded') return rejected('unavailable', `QueryActivity record ${activityRecord.refKey}: ${decoded.reason}`);
      views.push(queryActivityViewOf(decoded.value, querySince));
      continue;
    }
    // A missing record (or a missing QueryRun) is classified by the one shared
    // missing-activity rule; this view only maps its outcome to the public shape.
    views.push(queryMissingActivityViewOf(queryRef, run === null ? null : queryExecutingSession(run),
      classifyMissingActivity(queryMissingActivityFacts(run, querySince))));
  }
  return { status: 'ready', value: views };
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createActivityReadModel(
  deps: ActivityReadModelDependencies,
): Pick<ActivityReadPort, 'readActivityCalendar' | 'readRunActivities' | 'readQueryActivities'> {
  const cap = deps.readRecordCap ?? ACTIVITY_READ_RECORD_CAP;
  const now = deps.now;

  return {
    async readActivityCalendar(ctx, input): Promise<ReadResult<ActivityCalendarV1>> {
      const problem = validateCalendarInput(ctx, input);
      if (problem !== null) return problem;
      const window = `${input.from}..${input.to} (${input.granularity})`;
      return readStableActivityWindow({
        records: deps.records,
        cap,
        // Deferred on purpose: the executor evaluates this only after a
        // successful "before" watermark, so each retry reads the clock when its
        // own window starts.
        read: (budget) => readCalendarWindow(deps, ctx, input, now(), budget),
        mapError: (error) => {
          if (error instanceof CapacityError) {
            return { status: 'rejected', code: 'capacity',
              reason: `the activity read for window ${window} exceeds the storage-read cap of ${String(cap)}` };
          }
          return storeFailureToRejection(error as { code: string; reason: string });
        },
        exhausted: () => rejected('unavailable', `the activity read for window ${window} did not yield one stable read window within ${String(ACTIVITY_WINDOW_MAX_ATTEMPTS)} attempts`),
      });
    },

    async readRunActivities(ctx, input): Promise<ReadResult<RunActivityViewV1[]>> {
      if (!Array.isArray(input.runRefs) || input.runRefs.length < 1 || input.runRefs.length > ACTIVITY_REF_LIMIT) {
        return rejected('invalid', `runRefs must carry between 1 and ${String(ACTIVITY_REF_LIMIT)} references`);
      }
      return readStableActivityWindow({
        records: deps.records,
        cap,
        read: (budget) => readRunActivitiesWindow(deps, ctx, input, budget),
        mapError: (error) => {
          if (error instanceof CapacityError) {
            return { status: 'rejected', code: 'capacity',
              reason: `the Run activity read exceeds the storage-read cap of ${String(cap)}` };
          }
          return storeFailureToRejection(error as { code: string; reason: string });
        },
        exhausted: () => rejected('unavailable', `the Run activity read did not yield one stable read window within ${String(ACTIVITY_WINDOW_MAX_ATTEMPTS)} attempts`),
      });
    },

    async readQueryActivities(ctx, input): Promise<ReadResult<QueryActivityViewV1[]>> {
      if (!Array.isArray(input.refs) || input.refs.length < 1 || input.refs.length > ACTIVITY_REF_LIMIT) {
        return rejected('invalid', `refs must carry between 1 and ${String(ACTIVITY_REF_LIMIT)} references`);
      }
      return readStableActivityWindow({
        records: deps.records,
        cap,
        read: (budget) => readQueryActivitiesWindow(deps, ctx, input, budget),
        mapError: (error) => {
          if (error instanceof CapacityError) {
            return { status: 'rejected', code: 'capacity',
              reason: `the Query activity read exceeds the storage-read cap of ${String(cap)}` };
          }
          return storeFailureToRejection(error as { code: string; reason: string });
        },
        exhausted: () => rejected('unavailable', `the Query activity read did not yield one stable read window within ${String(ACTIVITY_WINDOW_MAX_ATTEMPTS)} attempts`),
      });
    },
  };
}
