/**
 * The deviation-facts I/O owner (`slice-PL-SPEC.md` §7.5, rulings §3).
 *
 * It reads the Goal and its active Plan, pages the public execution list, reads
 * the Run activities in 200-ref batches and reuses the existing aggregation
 * (`stageReadingOf`) for the Task totals. The shared paging/batching also
 * serves the stage notice (P8 removes that private copy). An empty Run set
 * calls no activity read; any read failure stays a failure and is never
 * returned as an empty Task fact.
 *
 * `changedFiles` comes from the one `GoalExecutedFilesPort`, so the deviation
 * body names real paths without widening the activity HTTP view or storing a
 * second snapshot.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanLoopLimitsV1 } from '../../../contracts/plan-loop-limits.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { LineReadingV1, RunUsageReadingV1 } from '../../../contracts/run-activity.js';
import type { GoalExecutedFilesPort } from '../model/decision-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { TaskRow } from '../model/plan-contracts.js';
import { stageReadingOf } from '../model/plan-loop-readings.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { readGoal, readPlan } from './plan-readers.js';
import type {
  DeviationChangedFilesV1, DeviationInputV1, DeviationTaskFactsV1,
} from '../../../contracts/plan-deviation.js';

/** §10.5: one `listExecutions` page is at most 100 items. */
export const DEVIATION_RUN_PAGE_LIMIT = 100;
/** §10.5: one activity read takes at most 200 RunRefs. */
export const DEVIATION_ACTIVITY_BATCH = 200;

/**
 * The narrow activity seam this owner consumes. It is structural on purpose:
 * `tasks/` may not import `views/`, and the real `ActivityReadPort` satisfies it.
 */
export type DeviationActivityReadingV1 = { usage: RunUsageReadingV1; lines: LineReadingV1 };
export type DeviationActivityReadPort = {
  readRunActivities(ctx: CoreCallContext, input: { runRefs: RunRef[] }):
    Promise<ReadResult<readonly { runRef: RunRef; readings: DeviationActivityReadingV1 }[]>>;
};

/** The public reads the facts reader composes; no second store read. */
export type DeviationFactsDependencies = {
  records: GoalRecordTransactionPort;
  runs: { listExecutions: NonNullable<ExecutionReadPort['listExecutions']> };
  activities: DeviationActivityReadPort;
  files: Pick<GoalExecutedFilesPort, 'readGoalExecutedFiles'>;
  /** The Host's effective §10.3 value, read per round (never frozen at construction). */
  limits: () => PlanLoopLimitsV1;
};

/** One Task's Runs in execution order with their plan revisions and activity readings. */
export type TaskRunActivityReadV1 = {
  runs: { runRef: RunRef; planRevision: number }[];
  readings: DeviationActivityReadingV1[];
};

function unavailable(reason: string): CoreRejection {
  return { status: 'rejected', code: 'unavailable', reason };
}

/**
 * §10.5/§13.2.4: page `listExecutions` to the end, then read the activities in
 * batches of at most 200. The returned `readings` stay aligned with `runs`.
 * Failures are returned unchanged; an empty Run set never calls the activity
 * read.
 */
export async function readTaskRunActivities(
  deps: Pick<DeviationFactsDependencies, 'runs' | 'activities'>,
  ctx: CoreCallContext,
  goalRef: GoalRef,
  taskId: string,
): Promise<ReadResult<TaskRunActivityReadV1>> {
  const runs: TaskRunActivityReadV1['runs'] = [];
  let afterCursor: string | null = null;
  for (;;) {
    let page: Awaited<ReturnType<DeviationFactsDependencies['runs']['listExecutions']>>;
    try {
      page = await deps.runs.listExecutions(ctx, {
        goalRef, taskId, page: { afterCursor, limit: DEVIATION_RUN_PAGE_LIMIT },
      });
    } catch (error) {
      return storeFailureToRejection(error as { code: string; reason: string });
    }
    if (page.status !== 'ready') return page;
    for (const item of page.value.items) {
      runs.push({ runRef: item.run.ref, planRevision: item.plan.planRevision });
    }
    if (page.value.nextCursor === null) break;
    afterCursor = page.value.nextCursor;
  }
  if (runs.length === 0) return { status: 'ready', value: { runs, readings: [] } };

  const viewByRef = new Map<string, { runRef: RunRef; readings: DeviationActivityReadingV1 }>();
  for (let index = 0; index < runs.length; index += DEVIATION_ACTIVITY_BATCH) {
    const batch = runs.slice(index, index + DEVIATION_ACTIVITY_BATCH).map((run) => run.runRef);
    let read: Awaited<ReturnType<DeviationFactsDependencies['activities']['readRunActivities']>>;
    try {
      read = await deps.activities.readRunActivities(ctx, { runRefs: batch });
    } catch (error) {
      return storeFailureToRejection(error as { code: string; reason: string });
    }
    if (read.status !== 'ready') return read;
    for (const view of read.value) viewByRef.set(canonicalKey(view.runRef), view);
  }
  const readings: TaskRunActivityReadV1['readings'] = [];
  for (const run of runs) {
    const view = viewByRef.get(canonicalKey(run.runRef));
    if (view === undefined) return unavailable(`Run activity ${canonicalKey(run.runRef)} is missing`);
    readings.push(view.readings);
  }
  return { status: 'ready', value: { runs, readings } };
}

/** The files of this Task's Runs, projected from the one executed-files read. */
function changedFilesOf(
  rows: readonly { runRef: RunRef; path: string; certainty: 'definite' | 'possible' }[],
  runRefs: readonly RunRef[],
  possiblyIncomplete: boolean,
): DeviationChangedFilesV1 | null {
  if (runRefs.length === 0) return null;
  const ids = new Set(runRefs.map((ref) => ref.runId));
  const definite: string[] = [];
  const possible: string[] = [];
  let seen = false;
  for (const row of rows) {
    if (!ids.has(row.runRef.runId)) continue;
    seen = true;
    (row.certainty === 'definite' ? definite : possible).push(row.path);
  }
  if (!seen) return null;
  return { definite, possible, possiblyIncomplete };
}

async function taskFactsOf(
  deps: DeviationFactsDependencies,
  ctx: CoreCallContext,
  goalRef: GoalRef,
  plan: PlanRevisionSnapshot,
  rows: ReadonlyMap<string, TaskRow>,
  files: { rows: { runRef: RunRef; path: string; certainty: 'definite' | 'possible' }[];
    possiblyIncomplete: boolean } | null,
): Promise<{ ok: true; tasks: DeviationTaskFactsV1[] } | { ok: false; rejection: CoreRejection }> {
  const tasks: DeviationTaskFactsV1[] = [];
  for (const definition of plan.tasks) {
    const row = rows.get(definition.taskId);
    const runs = await readTaskRunActivities(deps, ctx, goalRef, definition.taskId);
    if (runs.status !== 'ready') {
      return { ok: false, rejection: runs.status === 'rejected'
        ? runs
        : unavailable(`the executions of task ${definition.taskId} are not readable (${runs.status})`) };
    }
    const estimate = definition.disposition === 'cancelled' || definition.disposition === 'superseded'
      ? 0 : definition.estimatedLines;
    const reading = stageReadingOf([{
      ...(estimate === undefined ? {} : { estimatedLines: estimate }),
      readings: runs.value.readings,
    }]);
    const failure = row?.failure;
    const active = row?.disposition ?? definition.disposition;
    // A hard stop names its own Run when that Run is in the execution list; the
    // same revision it ran under is the trigger. Otherwise the selected Run is
    // the Task's last lease holder (`row.execution`, chosen by the canonical
    // reader), never the execution page's last item: that page is ordered by
    // the random Run id.
    const hard = failure?.runRef ?? null;
    const hardRun = hard === null
      ? undefined : runs.value.runs.find((run) => run.runRef.runId === hard.runId);
    const selected = row?.execution ?? null;
    const selectedRun = selected === null
      ? undefined : runs.value.runs.find((run) => run.runRef.runId === selected.runId);
    const trigger = hardRun ?? selectedRun;
    tasks.push({
      taskId: definition.taskId,
      disposition: active,
      ...(definition.sizeClass === undefined ? {} : { sizeClass: definition.sizeClass }),
      ...(definition.estimatedLines === undefined ? {} : { estimatedLines: definition.estimatedLines }),
      ...(definition.stageId === undefined ? {} : { stageId: definition.stageId }),
      failure: failure ?? null,
      usage: reading.usage,
      lines: reading.lines,
      changedFiles: files === null ? null : changedFilesOf(
        files.rows, runs.value.runs.map((run) => run.runRef), files.possiblyIncomplete),
      trigger: trigger === undefined ? null : { runRef: trigger.runRef, planRevision: trigger.planRevision },
    });
  }
  return { ok: true, tasks };
}

/**
 * §7.5: build the pure table's input from real facts. `rows` is the caller's
 * already-read Task graph (the Workflow loop and the card source both have it);
 * without it only the Plan's own rows contribute and no failure facts exist.
 */
export function createDeviationFactsReader(
  ctx: CoreCallContext,
  deps: DeviationFactsDependencies,
): ReadDeviationFacts {
  return async (goalRef, rows) => {
    if (goalRef.projectId !== ctx.projectId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the Goal belongs to another project' };
    }
    let goalRead: Awaited<ReturnType<typeof readGoal>>;
    try {
      goalRead = await readGoal(deps.records, goalRef);
    } catch (error) {
      return storeFailureToRejection(error as { code: string; reason: string });
    }
    if (goalRead.status !== 'ready') return goalRead;
    const goal = goalRead.goal;
    if (goal.workspaceRef.workspaceId !== ctx.workspaceId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the Goal belongs to another workspace' };
    }
    let plan: PlanRevisionSnapshot | null = null;
    if (goal.activePlanRevision !== null) {
      const planRead = await readPlan(deps.records, goal.activePlanRevision);
      if (planRead.status !== 'ready') return planRead;
      plan = planRead.plan;
    }
    const rowMap = new Map<string, TaskRow>();
    for (const row of rows ?? []) rowMap.set(row.ref.taskId, row);
    if (plan === null) {
      return { status: 'ready', value: {
        goal: { ref: goal.ref, desiredState: goal.desiredState },
        plan: { planRevision: 0, tasks: [] },
        limits: deps.limits(),
      } };
    }
    let files: { rows: { runRef: RunRef; path: string; certainty: 'definite' | 'possible' }[];
      possiblyIncomplete: boolean } | null = null;
    let executed: Awaited<ReturnType<GoalExecutedFilesPort['readGoalExecutedFiles']>>;
    try {
      executed = await deps.files.readGoalExecutedFiles(ctx, { goalRef: goal.ref });
    } catch (error) {
      return storeFailureToRejection(error as { code: string; reason: string });
    }
    if (executed.status !== 'ready') return executed;
    if (executed.value.availability === 'available') {
      files = { rows: executed.value.files, possiblyIncomplete: executed.value.possiblyIncomplete };
    }
    const facts = await taskFactsOf(deps, ctx, goal.ref, plan, rowMap, files);
    if (!facts.ok) return facts.rejection;
    return { status: 'ready', value: {
      goal: { ref: goal.ref, desiredState: goal.desiredState },
      plan: { planRevision: plan.planRevision, tasks: facts.tasks },
      limits: deps.limits(),
    } };
  };
}

/**
 * §7.5: `readDeviationFacts(goalRef, rows?)` — the closed-over call context is
 * the reader's own (the pure seam names the Goal and the optional rows only).
 */
export type ReadDeviationFacts = (
  goalRef: GoalRef,
  rows?: readonly TaskRow[],
) => Promise<ReadResult<DeviationInputV1>>;
