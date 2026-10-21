/**
 * Slice 2B L11/L17: the read-only task-state timeline ("time stripe", entry
 * BE4). It folds only already-stored time points into per-Task segments; it
 * never reads the Kernel, never backfills, never writes and never invents a
 * time. Every point is marked `approximate: true`.
 *
 * Reads (exactly L11's list): the Goal's Plan revisions once (ordered by
 * `acceptedAt`), then per page-task the Runs by task, the verification rounds
 * by task and the anomaly anchors by task; per Run its requeue by key and its
 * control intents by the `s2b-control-by-run` equality index; then one
 * `eventAt(since)` per round that has one. Every storage read counts against
 * `ACTIVITY_READ_RECORD_CAP` (L17) and each page uses the 2A L7 stable window.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { AggregateRef, GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { EvidenceOutcome } from '../../../contracts/evidence.js';
import type { Disposition, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../../contracts/plan.js';
import { ACTIVITY_READ_RECORD_CAP } from '../../../contracts/run-activity.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import { decodeControlIntentSnapshot, S2B_CONTROL_BY_RUN_LOOKUP } from '../persistence/control-record-codecs.js';
import { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';
import {
  decodeVerificationRoundSnapshot, VERIFICATION_ROUND_BY_TASK_LOOKUP,
} from '../persistence/evidence-record-codecs.js';
import {
  decodePlanRevisionSnapshot, planRevisionRefKey, S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
} from '../persistence/plan-record-codecs.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { decodeTaskRequeueSnapshot, taskRequeueRefKey } from '../tasks/claim-record-codecs.js';
import { RUN_BY_TASK_INDEX } from '../tasks/plan-readers.js';
import { decodeSessionAnomalyAnchor } from '../tasks/session-anomaly-codecs.js';
import { SESSION_ANOMALY_BY_TASK_LOOKUP } from '../model/session-facts-contracts.js';
import { isPausedInterrupted } from '../state/run-machine.js';
import { storeFailureToRejection } from './goal-conflicts.js';
import {
  Budget, CapacityError, readEqualityAll, readOneKeyed, readOrderedAll,
} from './activity-read-helpers.js';
import {
  ACTIVITY_WINDOW_MAX_ATTEMPTS, readStableActivityWindow,
} from './activity-stable-window.js';

// --------------------------------------------------------------------------
// Public view types (spec §2 "WorkGraph views")
// --------------------------------------------------------------------------

export type HistoricalTaskStateV1 =
  | 'not_in_plan' | 'unknown' | 'pending' | 'running' | 'awaiting_check' | 'verifying' | 'satisfied' | 'check_failed'
  | 'check_incomplete' | 'run_failed' | 'run_cancelled' | 'interrupted' | 'interrupted_pending_check' | 'paused'
  | 'waiting_reply' | 'outcome_unknown' | 'deferred' | 'cancelled' | 'superseded';

export type TaskStatePointKindV1 = 'plan_appear' | 'disposition' | 'requeue' | 'run_start' | 'pause' | 'resume'
  | 'run_end' | 'anomaly' | 'check_start' | 'check_end';

export type TaskStateSegmentV1 = {
  from: string | null; to: string | null; state: HistoricalTaskStateV1;
  point: { kind: TaskStatePointKindV1; at: string; source: AggregateRef } | null;
};

export type TaskStateTimelinePageV1 = {
  goalRef: GoalRef; approximate: true;
  tasks: {
    taskId: string; segments: TaskStateSegmentV1[];
    untimedPoints: { kind: TaskStatePointKindV1; source: AggregateRef }[];
  }[];
  next: string | null;
};

export interface TaskTimelineReadPort {
  readTaskStateTimeline(ctx: CoreCallContext, input: { goalRef: GoalRef; cursor: string | null; limit: number }):
    Promise<ReadResult<TaskStateTimelinePageV1>>;
}

export type TaskTimelineDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'> & RecordLookupPort & RecordOrderedLookupPort;
  /** P4: tests inject a smaller cap; production never passes another value. */
  readRecordCap?: number;
};

// --------------------------------------------------------------------------
// Page limits and canonical keys
// --------------------------------------------------------------------------

const PAGE_LIMIT = 200;

function canonicalKey(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

// --------------------------------------------------------------------------
// Points and folding (L11)
// --------------------------------------------------------------------------

const KIND_ORDER: readonly TaskStatePointKindV1[] = [
  'plan_appear', 'requeue', 'run_start', 'pause', 'resume', 'run_end', 'anomaly',
  'check_start', 'check_end', 'disposition',
];
const KIND_RANK = new Map<TaskStatePointKindV1, number>(KIND_ORDER.map((kind, index) => [kind, index]));

type TaskPoint = {
  kind: TaskStatePointKindV1;
  at: string | null;
  source: AggregateRef;
  /** `pause`/`resume`: the observed control's Run; `run_end`: the ended Run. */
  run?: RunSnapshot;
  /** `disposition`: the version's disposition for the task. */
  disposition?: Disposition;
  /** `check_end`: the round's stored outcome. */
  roundOutcome?: EvidenceOutcome | null;
};

type UntimedPoint = { kind: TaskStatePointKindV1; source: AggregateRef };

/** L11 run_end mapping (crashed + `isPausedInterrupted` is `paused`). */
function stateAfterRunEnd(run: RunSnapshot): HistoricalTaskStateV1 {
  switch (run.outcome) {
    case 'completed': return 'awaiting_check';
    case 'failed': case 'budget_exhausted': return 'run_failed';
    case 'cancelled': return 'run_cancelled';
    case 'crashed': return isPausedInterrupted(run) ? 'paused' : 'interrupted';
    case 'outcome_unknown': return 'outcome_unknown';
    case 'yielded': return 'waiting_reply';
    default: return 'interrupted';
  }
}

/** L11 `check_end` mapping. */
function stateAfterCheckEnd(outcome: EvidenceOutcome | null | undefined): HistoricalTaskStateV1 | null {
  switch (outcome) {
    case 'PASS': return 'satisfied';
    case 'FAIL': return 'check_failed';
    case 'INCONCLUSIVE': return 'check_incomplete';
    default: return null;
  }
}

function displayStateOf(
  base: HistoricalTaskStateV1 | null,
  anomalyOpen: boolean,
  disposition: Disposition,
  fallback: HistoricalTaskStateV1,
): HistoricalTaskStateV1 {
  if (disposition !== 'active') return disposition;
  if (anomalyOpen) return 'interrupted_pending_check';
  return base ?? fallback;
}

function sortTimed(points: readonly TaskPoint[]): (TaskPoint & { at: string })[] {
  return points
    .filter((point): point is TaskPoint & { at: string } => point.at !== null)
    .sort((left, right) => {
      if (left.at !== right.at) return left.at < right.at ? -1 : 1;
      return (KIND_RANK.get(left.kind) ?? 0) - (KIND_RANK.get(right.kind) ?? 0);
    });
}

/**
 * L11 fold: one point at a time changes `base`, `anomalyOpen` and
 * `disposition`; a new segment opens only when the displayed state changes.
 */
function foldPoints(
  points: readonly TaskPoint[],
  untimed: readonly UntimedPoint[],
  planUnreadable: boolean,
): { segments: TaskStateSegmentV1[]; untimedPoints: UntimedPoint[] } {
  const timed = sortTimed(points);
  const fallback: HistoricalTaskStateV1 = planUnreadable ? 'unknown' : 'not_in_plan';
  const segments: TaskStateSegmentV1[] = [];
  let from: string | null = null;
  let state: HistoricalTaskStateV1 = fallback;
  let point: TaskStateSegmentV1['point'] = null;

  let base: HistoricalTaskStateV1 | null = null;
  let anomalyOpen = false;
  let disposition: Disposition = 'active';

  for (const timedPoint of timed) {
    switch (timedPoint.kind) {
      case 'plan_appear': base = 'pending'; break;
      case 'disposition':
        disposition = timedPoint.disposition ?? 'active';
        if (disposition === 'active') base = 'pending';
        break;
      case 'requeue': base = 'pending'; break;
      case 'run_start': base = 'running'; anomalyOpen = false; break;
      case 'pause': {
        const run = timedPoint.run;
        if (run !== undefined && run.endedAt !== null && timedPoint.at >= run.endedAt) break;
        base = 'paused';
        break;
      }
      case 'resume': {
        const run = timedPoint.run;
        if (run !== undefined && run.endedAt !== null && timedPoint.at >= run.endedAt) break;
        if (run === undefined || run.startedAt === null || timedPoint.at < run.startedAt) base = 'pending';
        else base = 'running';
        break;
      }
      case 'run_end': {
        if (timedPoint.run !== undefined && timedPoint.run.outcome !== null) base = stateAfterRunEnd(timedPoint.run);
        break;
      }
      case 'anomaly': anomalyOpen = true; break;
      case 'check_start': base = 'verifying'; break;
      case 'check_end': {
        const next = stateAfterCheckEnd(timedPoint.roundOutcome);
        if (next !== null) base = next;
        break;
      }
      default: break;
    }
    const nextState = displayStateOf(base, anomalyOpen, disposition, fallback);
    if (nextState !== state) {
      // Close the segment that was open, then open the new one at this point.
      segments.push({ from, to: timedPoint.at, state, point });
      from = timedPoint.at;
      state = nextState;
      point = { kind: timedPoint.kind, at: timedPoint.at, source: timedPoint.source };
    }
  }
  segments.push({ from, to: null, state, point });
  return { segments, untimedPoints: [...untimed] };
}

// --------------------------------------------------------------------------
// Per-task point assembly
// --------------------------------------------------------------------------

type TaskPoints = {
  points: TaskPoint[];
  untimed: UntimedPoint[];
};

type PlanContext = {
  plans: readonly PlanRevisionSnapshot[];
  byRefKey: Map<string, PlanRevisionSnapshot>;
  /** Any readable revision failed to decode, so the earliest appearance is unknowable. */
  unreadable: boolean;
  current: PlanRevisionSnapshot;
};

function planAppearOf(
  task: RuntimeTask,
  plans: readonly PlanRevisionSnapshot[],
  runs: readonly RunSnapshot[],
): { at: string | null; source: PlanRevisionRef } | null {
  const earliest = plans.find((plan) => plan.tasks.some((candidate) => candidate.taskId === task.taskId));
  if (earliest === undefined) return null;
  let at = earliest.acceptedAt;
  for (const run of runs) {
    if (run.startedAt !== null && run.startedAt < at) at = run.startedAt;
  }
  return { at, source: earliest.ref };
}

function dispositionPointsOf(
  task: RuntimeTask,
  plans: readonly PlanRevisionSnapshot[],
  current: PlanRevisionSnapshot | null,
): { points: TaskPoint[]; untimed: UntimedPoint[] } {
  const points: TaskPoint[] = [];
  const untimed: UntimedPoint[] = [];
  const seen = new Set<string>();
  for (const plan of plans) {
    for (const entry of plan.dispositionRecord?.entries ?? []) {
      if (entry.taskId !== task.taskId) continue;
      const setInKey = planRevisionRefKey(entry.setIn);
      if (seen.has(setInKey)) continue;
      seen.add(setInKey);
      const setIn = plans.find((candidate) => planRevisionRefKey(candidate.ref) === setInKey);
      if (setIn === undefined) {
        untimed.push({ kind: 'disposition', source: entry.setIn });
        continue;
      }
      points.push({ kind: 'disposition', at: setIn.acceptedAt, source: setIn.ref, disposition: entry.to });
    }
  }
  if (seen.size === 0 && current !== null) {
    const definition = current.tasks.find((candidate) => candidate.taskId === task.taskId);
    if (definition !== undefined && definition.disposition !== 'active') {
      points.push({
        kind: 'disposition', at: current.acceptedAt, source: current.ref, disposition: definition.disposition,
      });
    }
  }
  return { points, untimed };
}

async function readTaskPoints(
  deps: TaskTimelineDependencies,
  goal: GoalSnapshot,
  plan: PlanContext,
  task: RuntimeTask,
  budget: Budget,
): Promise<TaskPoints> {
  const records = deps.records;
  const projectId = goal.ref.projectId;
  const goalId = goal.ref.goalId;
  const workspaceId = goal.workspaceRef.workspaceId;
  const points: TaskPoint[] = [];
  const untimed: UntimedPoint[] = [];

  // Runs by task (L11: read to the end once; start/end and entry intervals reuse it).
  const runRecords = await readEqualityAll(records, RUN_BY_TASK_INDEX, [projectId, goalId, task.taskId], budget);
  const runs: RunSnapshot[] = [];
  for (const record of runRecords) {
    const decoded = decodeRun(record);
    if (!decoded.ok) throw rejected('unavailable', `Run record ${record.refKey}: ${decoded.reason}`);
    if (decoded.value.task.taskId !== task.taskId) continue;
    runs.push(decoded.value);
  }
  runs.sort((left, right) => left.ref.runId < right.ref.runId ? -1 : left.ref.runId > right.ref.runId ? 1 : 0);

  // Verification rounds by task.
  const roundRecords = await readEqualityAll(records, VERIFICATION_ROUND_BY_TASK_LOOKUP,
    [projectId, workspaceId, goalId, task.taskId], budget);
  const rounds: { record: EncodedRecord; round: RoundSnapshot; since: CommitCursor; finalizedAt: string | null }[] = [];
  for (const record of roundRecords) {
    const decoded = decodeVerificationRoundSnapshot(record);
    if (decoded.status !== 'decoded') throw rejected('unavailable', `round ${record.refKey}: ${decoded.reason}`);
    const origin = decodeNoticeOrigin(record);
    if (origin.status !== 'decoded') throw rejected('unavailable', `round origin ${record.refKey}: ${origin.reason}`);
    const since = origin.value.since;
    if (since === undefined || since === null) {
      throw rejected('unavailable', `round ${record.refKey} is missing its since cursor`);
    }
    rounds.push({
      record, round: decoded.value, since,
      finalizedAt: origin.value.finalizedAt === undefined ? null : origin.value.finalizedAt,
    });
  }

  // Anomaly anchors by task.
  const anomalyRecords = await readEqualityAll(records, SESSION_ANOMALY_BY_TASK_LOOKUP,
    [projectId, workspaceId, goalId, task.taskId], budget);
  for (const record of anomalyRecords) {
    const decoded = decodeSessionAnomalyAnchor(record);
    if (decoded.status !== 'decoded') throw rejected('unavailable', `anomaly ${record.refKey}: ${decoded.reason}`);
    if (decoded.value.task.taskId !== task.taskId) continue;
    points.push({ kind: 'anomaly', at: decoded.value.recordedAt, source: decoded.value.ref });
  }

  // plan_appear (earliest Plan revision containing the task, or the earliest run).
  if (plan.unreadable) {
    untimed.push({ kind: 'plan_appear', source: plan.current.ref });
  } else {
    const appear = planAppearOf(task, plan.plans, runs);
    if (appear !== null && appear.at !== null) {
      points.push({ kind: 'plan_appear', at: appear.at, source: appear.source });
    } else if (appear !== null) {
      untimed.push({ kind: 'plan_appear', source: appear.source });
    }
  }

  // disposition entries.
  const dispositions = dispositionPointsOf(task, plan.plans, plan.current);
  points.push(...dispositions.points);
  untimed.push(...dispositions.untimed);

  // Per Run: start/end, pause/resume intents, and the requeue keyed by afterRunId.
  for (const run of runs) {
    if (run.startedAt === null) untimed.push({ kind: 'run_start', source: run.ref });
    else points.push({ kind: 'run_start', at: run.startedAt, source: run.ref, run });
    if (run.endedAt !== null && run.outcome !== null) {
      points.push({ kind: 'run_end', at: run.endedAt, source: run.ref, run });
    }
    const requeueRecord = await readOneKeyed(records,
      taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId, goalId, taskId: task.taskId, afterRunId: run.ref.runId }),
      budget);
    if (requeueRecord !== undefined) {
      const decoded = decodeTaskRequeueSnapshot(requeueRecord);
      if (decoded.status !== 'decoded') throw rejected('unavailable', `requeue ${requeueRecord.refKey}: ${decoded.reason}`);
      if (decoded.value.afterRunRef.runId === run.ref.runId) {
        points.push({ kind: 'requeue', at: decoded.value.requestedAt, source: decoded.value.ref });
      }
    }
    const controlRecords = await readEqualityAll(records, S2B_CONTROL_BY_RUN_LOOKUP,
      [projectId, workspaceId, goalId, run.ref.runId], budget);
    for (const record of controlRecords) {
      const decoded = decodeControlIntentSnapshot(record);
      if (decoded.status !== 'decoded') throw rejected('unavailable', `control intent ${record.refKey}: ${decoded.reason}`);
      const intent = decoded.value;
      if (intent.status !== 'applied') continue;
      if (intent.runRef.runId !== run.ref.runId) continue;
      if (intent.observation.kind === 'paused') {
        points.push({ kind: 'pause', at: intent.observation.observedAt, source: intent.ref, run });
      } else if (intent.observation.kind === 'resumed') {
        points.push({ kind: 'resume', at: intent.observation.observedAt, source: intent.ref, run });
      }
    }
  }

  // Per round: check_start (`since` via `eventAt`) / check_end (`finalizedAt`).
  for (const entry of rounds) {
    const { round } = entry;
    const at = await records.eventAt(entry.since!);
    if (at.status !== 'ready') throw at;
    budget.spend(1);
    points.push({ kind: 'check_start', at: at.value.event.occurredAt, source: round.ref });
    if (round.status === 'finalized') {
      points.push({ kind: 'check_end', at: entry.finalizedAt!, source: round.ref, roundOutcome: round.outcome });
    }
  }

  return { points, untimed };
}

// --------------------------------------------------------------------------
// Cursor
// --------------------------------------------------------------------------

type Cursor = { planKey: string; index: number };

function encodeCursor(cursor: Cursor): string {
  return JSON.stringify({ p: cursor.planKey, i: cursor.index });
}

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record['p'] !== 'string' || !Number.isSafeInteger(record['i']) || (record['i'] as number) < 0) return null;
    return { planKey: record['p'], index: record['i'] as number };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Page window
// --------------------------------------------------------------------------

type TimelineInput = { goalRef: GoalRef; cursor: string | null; limit: number };

function validateInput(ctx: CoreCallContext, input: TimelineInput): CoreRejection | null {
  if (input.goalRef.projectId !== ctx.projectId || input.goalRef.goalId.length === 0) {
    return { status: 'rejected', code: 'forbidden', reason: 'the requested Goal is outside the bound call scope' };
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > PAGE_LIMIT) {
    return rejected('invalid', `limit must be an integer between 1 and ${String(PAGE_LIMIT)}`);
  }
  if (input.cursor !== null && typeof input.cursor !== 'string') return rejected('invalid', 'cursor must be a string or null');
  return null;
}

async function readTimelineWindow(
  deps: TaskTimelineDependencies,
  ctx: CoreCallContext,
  input: TimelineInput,
  budget: Budget,
): Promise<ReadResult<TaskStateTimelinePageV1>> {
  const records = deps.records;
  const goalRecord = await readOneKeyed(records, canonicalKey(input.goalRef), budget);
  if (goalRecord === undefined) return { status: 'rejected', code: 'unavailable', reason: `the Goal ${input.goalRef.goalId} is missing` };
  const decodedGoal = decodeGoalSnapshot(goalRecord);
  if (decodedGoal.status !== 'decoded') return rejected('unavailable', `the Goal ${input.goalRef.goalId}: ${decodedGoal.reason}`);
  const goal = decodedGoal.value;
  if (goal.ref.projectId !== input.goalRef.projectId || goal.ref.goalId !== input.goalRef.goalId) {
    return rejected('unavailable', `the Goal record ${goalRecord.refKey} is not the requested Goal`);
  }
  const workspaceId = goal.workspaceRef.workspaceId;
  // R4: the Goal it resolves must be the caller's bound workspace.
  if (workspaceId !== ctx.workspaceId) {
    return { status: 'rejected', code: 'forbidden',
      reason: `the Goal ${input.goalRef.goalId} is outside the bound workspace` };
  }
  const activeKey = goal.activePlanRevision === null ? null : planRevisionRefKey(goal.activePlanRevision);

  // Plan revisions once for this page, ordered by `acceptedAt` (L11).
  const planRecords = await readOrderedAll(records, {
    index: S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
    values: [goal.ref.projectId, goal.ref.goalId], direction: 'asc',
  }, budget);
  const plans: PlanRevisionSnapshot[] = [];
  let unreadable = false;
  for (const record of planRecords) {
    const decoded = decodePlanRevisionSnapshot(record);
    if (decoded.status !== 'decoded') {
      if (activeKey !== null && record.refKey === activeKey) {
        return rejected('unavailable', `the active Plan revision ${record.refKey}: ${decoded.reason}`);
      }
      unreadable = true;
      continue;
    }
    plans.push(decoded.value);
  }
  const byRefKey = new Map<string, PlanRevisionSnapshot>();
  for (const plan of plans) byRefKey.set(planRevisionRefKey(plan.ref), plan);
  const current = activeKey === null ? null : (byRefKey.get(activeKey) ?? null);
  if (activeKey !== null && current === null) {
    return rejected('unavailable', `the active Plan revision ${activeKey} is missing`);
  }

  // Cursor: it carries the current Plan's version (originally read by the first page).
  let startIndex = 0;
  if (input.cursor !== null) {
    const cursor = decodeCursor(input.cursor);
    if (cursor === null) return rejected('invalid', 'the cursor is not a task-timeline cursor');
    if (activeKey === null || cursor.planKey !== activeKey) {
      return rejected('source_stale', 'the Goal\'s active Plan changed between pages; read the timeline from the start');
    }
    startIndex = cursor.index;
  }
  if (current === null) {
    return { status: 'ready', value: { goalRef: input.goalRef, approximate: true, tasks: [], next: null } };
  }

  const tasks = current.tasks;
  if (startIndex > tasks.length) return rejected('invalid', 'the cursor points past the end of the current Plan');
  const pageTasks = tasks.slice(startIndex, startIndex + input.limit);
  const planContext: PlanContext = { plans, byRefKey, unreadable, current };

  const result: TaskStateTimelinePageV1['tasks'] = [];
  for (const task of pageTasks) {
    const taskPoints = await readTaskPoints(deps, goal, planContext, task, budget);
    const folded = foldPoints(taskPoints.points, taskPoints.untimed, unreadable);
    folded.untimedPoints.sort((left, right) =>
      (KIND_RANK.get(left.kind) ?? 0) - (KIND_RANK.get(right.kind) ?? 0));
    result.push({ taskId: task.taskId, segments: folded.segments, untimedPoints: folded.untimedPoints });
  }
  const nextIndex = startIndex + pageTasks.length;
  const next = nextIndex < tasks.length ? encodeCursor({ planKey: activeKey as string, index: nextIndex }) : null;
  return { status: 'ready', value: { goalRef: input.goalRef, approximate: true, tasks: result, next } };
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createTaskStateTimeline(deps: TaskTimelineDependencies): TaskTimelineReadPort {
  const cap = deps.readRecordCap ?? ACTIVITY_READ_RECORD_CAP;
  return {
    async readTaskStateTimeline(ctx, input): Promise<ReadResult<TaskStateTimelinePageV1>> {
      const problem = validateInput(ctx, input);
      if (problem !== null) return problem;
      const window = `goal ${input.goalRef.projectId}/${input.goalRef.goalId} cursor ${input.cursor ?? 'start'} limit ${String(input.limit)}`;
      return readStableActivityWindow({
        records: deps.records,
        cap,
        read: (budget) => readTimelineWindow(deps, ctx, input, budget),
        mapError: (error) => {
          if (error instanceof CapacityError) {
            return { status: 'rejected', code: 'capacity',
              reason: `the task timeline read for ${window} exceeds the storage-read cap of ${String(cap)}` };
          }
          return storeFailureToRejection(error as { code: string; reason: string });
        },
        exhausted: () => rejected('unavailable', `the task timeline read for ${window} did not yield one stable read window within ${String(ACTIVITY_WINDOW_MAX_ATTEMPTS)} attempts`),
      });
    },
  };
}
