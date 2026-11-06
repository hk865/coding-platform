/**
 * UI1 goals-list: the whole-workspace Goal list read (`goals/list`).
 *
 * One stable `a2-goal-by-workspace` window enumerates every Goal of the
 * workspace (cancelled and completed included, no paging), the project's
 * creation order gives each row its "目标 n", and the existing terminal-state
 * reader gives the four display phases this read can answer. A phase that
 * needs the active Plan's Tasks (`display.phase: null`) is left to
 * `goals/display`; this read never calls that owner.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import type { EncodedRecord } from '../../record-store/ports.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  GoalListPhaseV1,
  GoalListReadPort,
  GoalListReadV1,
  GoalListRowV1,
} from '../model/decision-contracts.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { lookupAll, type LookupBatch } from '../persistence/lookup-all.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { GOAL_BY_WORKSPACE_INDEX, readGoalOrdinals } from '../tasks/plan-readers.js';
import {
  readGoalTerminalState, workspaceScopeProblem, type DecisionReadRecordsPort, type GoalTerminalState,
} from './goal-conflicts.js';

/** §2 "上限/游标": the whole-window cap (25 pages x 200 rows), never a half page. */
const DEFAULT_MAX_ITEMS = 25 * 200;

export type GoalListReadDependencies = {
  records: DecisionReadRecordsPort;
  /** The page width of the Goal-list lookup; absent keeps lookupAll's default 200. */
  pageLimit?: number;
  /** The whole-window cap; absent keeps the 5,000-row window. */
  maxItems?: number;
};

/** Builds the `goals/list` read; the factory itself never throws. */
export function createGoalListReadModel(deps: GoalListReadDependencies): GoalListReadPort {
  const maxItems = deps.maxItems ?? DEFAULT_MAX_ITEMS;
  return {
    async readGoalList(ctx, input) {
      return readGoalList(deps, maxItems, ctx, input);
    },
  };
}

async function readGoalList(
  deps: GoalListReadDependencies,
  maxItems: number,
  ctx: CoreCallContext,
  input: { workspace: WorkspaceScope },
): Promise<ReadResult<GoalListReadV1>> {
  // §1: the route input is a complete workspace; no cursor and no limit.
  if (!isRecord(input) || !isRecord(input.workspace)
    || !nonEmpty(input.workspace.projectId) || !nonEmpty(input.workspace.workspaceId)) {
    return { status: 'rejected', code: 'invalid', reason: 'readGoalList requires a complete workspace' };
  }
  const context = ctx as unknown as { projectId?: unknown } | null | undefined;
  if (context === null || context === undefined || !nonEmpty(context.projectId)) {
    return { status: 'rejected', code: 'forbidden', reason: 'a project-bound call context is required' };
  }
  // §2: an explicit workspace is compared with the bound scope before any record read.
  const outside = workspaceScopeProblem(ctx, input.workspace);
  if (outside !== null) return outside;

  // §2: one complete, stable lookup window; a failed store read keeps its code/reason.
  let batch: LookupBatch<EncodedRecord>;
  try {
    batch = await lookupAll(deps.records, GOAL_BY_WORKSPACE_INDEX,
      [input.workspace.projectId, input.workspace.workspaceId],
      deps.pageLimit === undefined ? undefined : { pageLimit: deps.pageLimit });
  } catch (error) {
    return storeFailureToRejection(error);
  }
  // §2 "上限/游标": over the window is `capacity`; a partial list is never published.
  if (batch.items.length > maxItems) {
    return { status: 'rejected', code: 'capacity',
      reason: `the workspace Goal list exceeds the ${maxItems} record read window` };
  }

  // §2: a corrupt record or an index value outside the requested workspace is
  // damage, not a row to skip (the read never drops a Goal silently).
  const goals: GoalSnapshot[] = [];
  for (const record of batch.items) {
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') {
      return { status: 'rejected', code: 'unavailable',
        reason: `a workspace Goal is corrupt: ${decoded.reason}` };
    }
    const goal = decoded.value;
    if (goal.ref.projectId !== input.workspace.projectId
      || goal.workspaceRef.workspaceId !== input.workspace.workspaceId) {
      return { status: 'rejected', code: 'unavailable',
        reason: `the workspace Goal index returned ${record.refKey} outside its workspace` };
    }
    goals.push(goal);
  }

  // §2: one project-wide creation-order read; an incomplete read makes the whole
  // `ordinal` column null, never a number shifted to the list position.
  const ordinals = await readGoalOrdinals(deps.records, input.workspace.projectId);

  const rows: GoalListRowV1[] = [];
  for (const goal of goals) {
    const terminal = await readGoalTerminalState(deps.records, goal);
    if (terminal.status !== 'ready') return terminal;
    rows.push(goalListRowOf(goal, ordinals, terminal.value));
  }
  // §2: order ascending, then creation cursor, then Goal id.
  rows.sort((left, right) => left.order !== right.order ? left.order - right.order
    : left.since !== right.since ? (left.since < right.since ? -1 : 1)
    : left.ref.goalId < right.ref.goalId ? -1 : left.ref.goalId > right.ref.goalId ? 1 : 0);
  return { status: 'ready', value: { goals: rows, sourceCursor: batch.watermark } };
}

/** §1: the narrow row; settings and display facts only, never a second snapshot shape. */
function goalListRowOf(
  goal: GoalSnapshot,
  ordinals: Map<string, number> | null,
  terminal: GoalTerminalState,
): GoalListRowV1 {
  return {
    ref: { ...goal.ref },
    revision: goal.revision,
    since: goal.since,
    ordinal: ordinals === null ? null : (ordinals.get(goal.ref.goalId) ?? null),
    objective: goal.objective,
    desiredState: goal.desiredState,
    desiredStateRevision: goal.desiredStateRevision,
    order: goal.settings.order,
    autonomy: goal.settings.autonomy,
    waitForGoalRef: goal.settings.waitForGoalRef === null ? null : { ...goal.settings.waitForGoalRef },
    activePlanRevision: goal.activePlanRevision === null ? null : { ...goal.activePlanRevision },
    display: { phase: goalListPhaseOf(goal, terminal) },
  };
}

/** §2 "display.phase 真值表", in the same priority order as `reduceGoalDisplay`. */
function goalListPhaseOf(goal: GoalSnapshot, terminal: GoalTerminalState): GoalListPhaseV1 | null {
  if (terminal.cancelled) return 'CANCELLED';
  if (terminal.completed) return 'COMPLETED';
  if (goal.desiredState === 'paused') return 'PAUSED';
  if (goal.activePlanRevision === null) return 'PLANNING';
  return null;
}
