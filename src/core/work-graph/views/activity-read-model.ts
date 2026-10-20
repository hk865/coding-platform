/**
 * Slice 2B L9/L10/L17: the ONE read-only activity projector for the calendar
 * and per-Run activity views.
 *
 * It reads only the two new records (`RunActivity`, `ActivityRecording`) and the
 * already-stored time points (Run start/end, round `since` via `eventAt`). It
 * never reads the Kernel, never backfills, never writes, and never recomputes a
 * running Run's activity. Every storage read is counted against
 * `ACTIVITY_READ_RECORD_CAP`; the read window is a 2A L7 stable window (at most
 * four attempts, all moving -> `unavailable`). Any read failure fails the whole
 * read; partial numbers are never reported as complete.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  ActivityRecordingSnapshot, ActivityTotalsV1, RunActivitySnapshot,
  RunActivityUnknownReason, RunModelUsageV1,
} from '../../../contracts/run-activity.js';
import { ACTIVITY_READ_RECORD_CAP, provenNotEnteredKernel } from '../../../contracts/run-activity.js';
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
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import {
  decodeActivityRecordingSnapshot,
  decodeRunActivitySnapshot,
  runActivityRefKey,
  S2B_RUN_ACTIVITY_BY_GOAL_LAST_LOOKUP,
} from '../tasks/run-activity-codecs.js';
import {
  RUN_BY_WORKSPACE_STATUS_INDEX,
  S2B_RUN_BY_GOAL_ENDED_LOOKUP,
} from '../tasks/plan-readers.js';
import {
  decodeSessionRecord,
  sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import { storeFailureToRejection } from './goal-conflicts.js';
import {
  activityViewOf, Budget, CapacityError, claimingSessionOf, emptyView, gateInfoOf,
  isQuarterInstant, readEqualityAll, readOneKeyed, readOrderedAll, readWatermark, scanOrdered,
} from './activity-read-helpers.js';

// --------------------------------------------------------------------------
// Public view types (spec §2 "WorkGraph views")
// --------------------------------------------------------------------------

export type ActivityUncountedReason = RunActivityUnknownReason | 'not_backfilled' | 'not_recorded' | 'no_recording_epoch';

export type ActivityCellV1 = {
  localDate: string; localHour: number | null;
  startAt: string; endAt: string; future: boolean;
  steps: number; edits: number; editsUnknown: number; checks: number;
  uncountedRuns: number; inProgressRuns: number; complete: boolean;
  tasks: { taskId: string; steps: number; edits: number; checks: number }[]; moreTasks: number;
  sessions: SessionRef[]; moreSessions: number;
};

export type ActivityCalendarV1 = {
  goalRef: GoalRef; from: string; to: string; granularity: 'hour' | 'day'; timeZone: string; now: string;
  cells: ActivityCellV1[];
  totals: { steps: number; edits: number; editsUnknown: number; checks: number; complete: boolean };
  coverage: {
    runsCounted: number; runsRecordedLate: number; runsNotEntered: number; runsInProgress: number;
    runsUncounted: { reason: ActivityUncountedReason; count: number }[]; runsUnplaced: number; checksUnplaced: number;
    runsSessionUnknown: number | null;
    checksGateUnplaced: number | null;
  };
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
 * The calendar and per-Run activity reads. Spec §2 also places `readTrackBars`
 * on this port; the track owner (`views/track-read-model.ts`,
 * `createTrackReadModel`) contributes it, and this file deliberately does not
 * import that module so the two factories stay independent. The coordinator
 * merges the two halves into the one `ActivityReadPort` at integration.
 */
export interface ActivityReadPort {
  readActivityCalendar(ctx: CoreCallContext, input: {
    goalRef: GoalRef; from: string; to: string;
    granularity: 'hour' | 'day'; timeZone: string; sessionRefs?: SessionRef[];
  }): Promise<ReadResult<ActivityCalendarV1>>;
  readRunActivities(ctx: CoreCallContext, input: { runRefs: RunRef[] }): Promise<ReadResult<RunActivityViewV1[]>>;
}

export type ActivityReadModelDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'> & RecordLookupPort & RecordOrderedLookupPort;
  /** P4: tests inject a smaller cap; production never passes another value. */
  readRecordCap?: number;
  /** Test-only clock seam; the composition always supplies one. */
  now: () => string;
};

const WINDOW_MAX_ATTEMPTS = 4;
const HOUR_MS = 60 * 60 * 1000;
const QUARTER_MS = 15 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOUR_SPAN_LIMIT_MS = 15 * DAY_MS;
const DAY_SPAN_LIMIT_MS = 400 * DAY_MS;
const SESSION_REF_LIMIT = 33;
const RUN_REF_LIMIT = 200;
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
  goalRef: GoalRef; from: string; to: string;
  granularity: 'hour' | 'day'; timeZone: string; sessionRefs?: SessionRef[];
};

function validateCalendarInput(ctx: CoreCallContext, input: CalendarInput): CoreRejection | null {
  if (input.goalRef === null || typeof input.goalRef !== 'object'
    || input.goalRef.aggregateType !== 'Goal' || input.goalRef.projectId !== ctx.projectId) {
    return { status: 'rejected', code: 'forbidden', reason: 'the requested goal is outside the bound call scope' };
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

type CellBuilder = {
  localDate: string; localHour: number | null;
  startAt: string; endAt: string;
  steps: number; edits: number; editsUnknown: number; checks: number;
  uncountedRuns: number; inProgressRuns: number;
  tasks: Map<string, { steps: number; edits: number; checks: number }>;
  sessions: Map<string, SessionRef>;
};

type CalendarWindow = ActivityCalendarV1;

async function readCalendarWindow(
  deps: ActivityReadModelDependencies,
  ctx: CoreCallContext,
  input: CalendarInput,
  now: string,
  budget: Budget,
): Promise<ReadResult<CalendarWindow>> {
  const records = deps.records;
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  const nowMs = Date.parse(now);
  const bySession = input.sessionRefs === undefined ? null : new Set(input.sessionRefs.map(sessionKey));
  const workspaceId = await goalWorkspaceId(records, input.goalRef, budget);
  // R4: the Goal names its own workspace; the caller is bound to `ctx.workspaceId`.
  // A same-project reference to another workspace is `forbidden` before any of
  // that workspace's records is used.
  if (workspaceId !== ctx.workspaceId) {
    return { status: 'rejected', code: 'forbidden', reason: 'the goal belongs to another workspace' };
  }
  const recording = await activityRecordingOf(records, input.goalRef.projectId, workspaceId, budget);
  const since = recording === null ? null : recording.since;

  // Every cell intersecting [from, to); DST gaps simply have no quarters.
  const cells = new Map<string, CellBuilder>();
  const ensureCell = (ms: number): CellBuilder => {
    const local = localPartsOf(ms, input.timeZone);
    const localHour = input.granularity === 'hour' ? local.localHour : null;
    const key = `${local.localDate}#${localHour === null ? '' : String(localHour)}`;
    let cell = cells.get(key);
    if (cell === undefined) {
      cell = { localDate: local.localDate, localHour, startAt: iso(ms), endAt: iso(ms),
        steps: 0, edits: 0, editsUnknown: 0, checks: 0, uncountedRuns: 0, inProgressRuns: 0,
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
  /** Marks one uncounted/in-progress run on each cell its interval touches. */
  const markRun = (
    field: 'uncountedRuns' | 'inProgressRuns', startMs: number, endMs: number, inclusive = false,
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
  const addTask = (cell: CellBuilder, taskId: string, steps: number, edits: number, checks: number): void => {
    const task = cell.tasks.get(taskId) ?? { steps: 0, edits: 0, checks: 0 };
    task.steps += steps; task.edits += edits; task.checks += checks;
    cell.tasks.set(taskId, task);
  };

  const runsUncounted = new Map<ActivityUncountedReason, number>();
  const addUncounted = (reason: ActivityUncountedReason): void => {
    runsUncounted.set(reason, (runsUncounted.get(reason) ?? 0) + 1);
  };
  let runsCounted = 0;
  let runsRecordedLate = 0;
  let runsNotEntered = 0;
  let runsInProgress = 0;
  let runsUnplaced = 0;
  const checksUnplaced = 0;
  let runsSessionUnknown = 0;
  let checksGateUnplaced = 0;

  // ---- 1. RunActivity records by Goal (ordered by span.lastAt) ------------
  const activityRecords = await readOrderedAll(records, {
    index: S2B_RUN_ACTIVITY_BY_GOAL_LAST_LOOKUP,
    values: [input.goalRef.projectId, input.goalRef.goalId],
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
    const firstAt = activity.span.firstAt;
    const lastAt = activity.span.lastAt;
    const inWindow = firstAt === null ? lastAt < input.to : firstAt < input.to;
    recordActivityRunIds.add(activity.runRef.runId);
    if (!inWindow) continue;

    const session = activity.sessionRef;
    if (bySession !== null) {
      if (session === null) { runsSessionUnknown += 1; continue; }
      if (!bySession.has(sessionKey(session))) { continue; }
    }
    if (activity.facts.status === 'unknown') {
      addUncounted(activity.facts.reason);
      if (firstAt === null) {
        runsUnplaced += 1;
      } else {
        markRun('uncountedRuns', Date.parse(firstAt), Date.parse(lastAt), true);
      }
      continue;
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
      addTask(cell, activity.taskId, quarter.steps, quarter.edits, 0);
    }
  }

  // ---- 2. Ended Runs without a record (L7 classification) -----------------
  const endedRuns = await readOrderedAll(records, {
    index: S2B_RUN_BY_GOAL_ENDED_LOOKUP,
    values: [input.goalRef.projectId, input.goalRef.goalId],
    direction: 'asc', bound: { value: input.from, inclusive: true },
  }, budget);
  const classified = new Set<string>();
  for (const record of endedRuns) {
    const runDecoded = decodeRun(record);
    if (!runDecoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${runDecoded.reason}`);
    const run = runDecoded.value;
    if (run.ref.goalId !== input.goalRef.goalId) continue;
    const startedAt = run.startedAt;
    if (!(startedAt !== null ? startedAt < input.to : (run.endedAt !== null && run.endedAt < input.to))) continue;
    if (recordActivityRunIds.has(run.ref.runId)) continue;
    classified.add(run.ref.runId);
    const existing = await readOneKeyed(records, runActivityRefKey(runActivityRefOf(run.ref)), budget);
    if (existing === undefined) {
      // L9 input + L17: Run placement filters by the claiming Session, and a
      // Session-resolution failure propagates as a read failure (see
      // activity-read-helpers.ts:180/:187).
      if (bySession !== null) {
        const session = await claimingSessionOf(records, run, budget);
        if (!bySession.has(sessionKey(session))) continue;
      }
      classifyMissingRun(run, since, {
        addUncounted, markRun, notEntered: () => { runsNotEntered += 1; },
        unplaced: () => { runsUnplaced += 1; },
      });
      continue;
    }
    // L9 step 2: every Run that has an activity record is SKIPPED here,
    // regardless of step 1's set. The ordered step already counted the records
    // inside its window; a record whose `span.lastAt` is before `from` is
    // outside this window and must not be counted by this fallback either.
    continue;
  }

  // ---- 3. Open Runs still in flight --------------------------------------
  const openRuns: RunSnapshot[] = [];
  for (const status of ['starting', 'running'] as const) {
    const rows = await readEqualityAll(records, RUN_BY_WORKSPACE_STATUS_INDEX,
      [input.goalRef.projectId, workspaceId, status], budget);
    for (const record of rows) {
      const decoded = decodeRun(record);
      if (!decoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${decoded.reason}`);
      if (decoded.value.ref.goalId === input.goalRef.goalId) openRuns.push(decoded.value);
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
    markRun('inProgressRuns', Date.parse(run.startedAt), Math.max(nowMs, fromMs));
  }

  // ---- 4. Verification rounds by Goal (starts by `since` desc) ------------
  const stopAt = fromMs - ROUND_STOP_SKEW_MS;
  const subjectSessionCache = new Map<string, SessionRef | null>();
  const gateSessionCache = new Map<string, { owners: SessionRef[]; gate: boolean }>();
  for await (const record of scanOrdered(records, {
    index: S2B_ROUND_BY_GOAL_LOOKUP,
    values: [input.goalRef.projectId, workspaceId, input.goalRef.goalId],
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
      records, budget, goalRef: input.goalRef, workspaceId, bySession,
      subjectSessionCache, gateSessionCache,
      onChecks: (taskId, checks, sessions, gateUnplaced) => {
        // L9 step 4: a gate check with no open responsible Session is not in a
        // `sessionRefs`-filtered cell at all; it is only counted in
        // `checksGateUnplaced`. Without `sessionRefs` the gate is always placed.
        if (gateUnplaced) { checksGateUnplaced += checks; return; }
        const cell = ensureCell(startedMs);
        cell.checks += checks;
        for (const session of sessions) cell.sessions.set(sessionKey(session), session);
        addTask(cell, taskId, 0, 0, checks);
      },
    });
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
      const ranked = [...cell.tasks.entries()]
        .map(([taskId, totals]) => ({ taskId, ...totals }))
        .sort((left, right) => {
          const leftWeight = left.steps + left.edits + left.checks;
          const rightWeight = right.steps + right.edits + right.checks;
          if (leftWeight !== rightWeight) return rightWeight - leftWeight;
          return left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0;
        });
      const sessions = [...cell.sessions.values()]
        .sort((left, right) => left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0);
      return {
        localDate: cell.localDate, localHour: cell.localHour,
        startAt: cell.startAt, endAt: cell.endAt, future: Date.parse(cell.startAt) > nowMs,
        steps: cell.steps, edits: cell.edits, editsUnknown: cell.editsUnknown, checks: cell.checks,
        uncountedRuns: cell.uncountedRuns, inProgressRuns: cell.inProgressRuns,
        complete: cell.uncountedRuns === 0 && cell.inProgressRuns === 0,
        tasks: ranked.slice(0, 3), moreTasks: Math.max(0, ranked.length - 3),
        sessions: sessions.slice(0, 10), moreSessions: Math.max(0, sessions.length - 10),
      };
    });

  const totals = materialized.reduce((sum, cell) => ({
    steps: sum.steps + cell.steps, edits: sum.edits + cell.edits,
    editsUnknown: sum.editsUnknown + cell.editsUnknown, checks: sum.checks + cell.checks,
  }), { steps: 0, edits: 0, editsUnknown: 0, checks: 0 });
  const uncountedTotal = [...runsUncounted.values()].reduce((sum, count) => sum + count, 0);
  const complete = uncountedTotal === 0 && runsInProgress === 0 && runsUnplaced === 0 && checksUnplaced === 0
    && runsSessionUnknown === 0;
  const coverage: ActivityCalendarV1['coverage'] = {
    runsCounted, runsRecordedLate, runsNotEntered, runsInProgress,
    runsUncounted: [...runsUncounted.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0),
    runsUnplaced, checksUnplaced,
    runsSessionUnknown: bySession === null ? null : runsSessionUnknown,
    checksGateUnplaced: bySession === null ? null : checksGateUnplaced,
  };
  return { status: 'ready', value: {
    goalRef: input.goalRef, from: input.from, to: input.to, granularity: input.granularity,
    timeZone: input.timeZone, now, cells: materialized,
    totals: { ...totals, complete }, coverage,
    recordingSince: since, checksAttribution: 'round_start',
  } };
}

/** L7: a Run with no RunActivity record is never 0 unless it provably never entered. */
function classifyMissingRun(
  run: RunSnapshot,
  since: string | null,
  hooks: {
    addUncounted: (reason: ActivityUncountedReason) => void;
    markRun: (field: 'uncountedRuns' | 'inProgressRuns', startMs: number, endMs: number, inclusive?: boolean) => void;
    notEntered: () => void;
    unplaced: () => void;
  },
): void {
  const endedAt = run.endedAt;
  if (provenNotEnteredKernel(run, since)) { hooks.notEntered(); return; }
  const reason: ActivityUncountedReason = since === null ? 'no_recording_epoch'
    : endedAt !== null && endedAt >= since ? 'not_recorded' : 'not_backfilled';
  hooks.addUncounted(reason);
  if (run.startedAt === null) { hooks.unplaced(); return; }
  if (endedAt === null) return;
  hooks.markRun('uncountedRuns', Date.parse(run.startedAt), Date.parse(endedAt), true);
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
    if (run === null) {
      views.push(emptyView(runRef, 'unknown', 'no_history_locator', false));
      continue;
    }
    if (run.status === 'starting' || run.status === 'running') {
      views.push(emptyView(runRef, 'in_progress', null, false));
      continue;
    }
    if (provenNotEnteredKernel(run, since)) {
      views.push({ runRef, status: 'not_entered', reason: null, error: false,
        totals: { steps: 0, edits: 0, editsUnknown: 0 },
        changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false }, usage: null,
        recordedBy: null, recordedAt: null, countedThroughTurnEnd: null, unresolvedCalls: null });
      continue;
    }
    const reason: ActivityUncountedReason = since === null ? 'no_recording_epoch'
      : run.endedAt !== null && run.endedAt >= since ? 'not_recorded' : 'not_backfilled';
    views.push(emptyView(runRef, 'unknown', reason, reason === 'not_recorded'));
  }
  return { status: 'ready', value: views };
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createActivityReadModel(
  deps: ActivityReadModelDependencies,
): Pick<ActivityReadPort, 'readActivityCalendar' | 'readRunActivities'> {
  const cap = deps.readRecordCap ?? ACTIVITY_READ_RECORD_CAP;
  const now = deps.now;

  return {
    async readActivityCalendar(ctx, input): Promise<ReadResult<ActivityCalendarV1>> {
      const problem = validateCalendarInput(ctx, input);
      if (problem !== null) return problem;
      const window = `${input.from}..${input.to} (${input.granularity})`;
      for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
        const budget = new Budget(cap);
        try {
          const before = await readWatermark(deps.records);
          if (before.status !== 'ready') return before;
          const result = await readCalendarWindow(deps, ctx, input, now(), budget);
          if (result.status !== 'ready') return result;
          const after = await readWatermark(deps.records);
          if (after.status !== 'ready') return after;
          if (before.value === after.value) return result;
        } catch (error) {
          if (error instanceof CapacityError) {
            return { status: 'rejected', code: 'capacity',
              reason: `the activity read for window ${window} exceeds the storage-read cap of ${String(cap)}` };
          }
          return storeFailureToRejection(error as { code: string; reason: string });
        }
      }
      return rejected('unavailable', `the activity read for window ${window} did not yield one stable read window within ${String(WINDOW_MAX_ATTEMPTS)} attempts`);
    },

    async readRunActivities(ctx, input): Promise<ReadResult<RunActivityViewV1[]>> {
      if (!Array.isArray(input.runRefs) || input.runRefs.length < 1 || input.runRefs.length > RUN_REF_LIMIT) {
        return rejected('invalid', `runRefs must carry between 1 and ${String(RUN_REF_LIMIT)} references`);
      }
      for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
        const budget = new Budget(cap);
        try {
          const before = await readWatermark(deps.records);
          if (before.status !== 'ready') return before;
          const result = await readRunActivitiesWindow(deps, ctx, input, budget);
          if (result.status !== 'ready') return result;
          const after = await readWatermark(deps.records);
          if (after.status !== 'ready') return after;
          if (before.value === after.value) return result;
        } catch (error) {
          if (error instanceof CapacityError) {
            return { status: 'rejected', code: 'capacity',
              reason: `the Run activity read exceeds the storage-read cap of ${String(cap)}` };
          }
          return storeFailureToRejection(error as { code: string; reason: string });
        }
      }
      return rejected('unavailable', `the Run activity read did not yield one stable read window within ${String(WINDOW_MAX_ATTEMPTS)} attempts`);
    },
  };
}
