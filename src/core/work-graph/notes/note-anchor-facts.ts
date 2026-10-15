/**
 * Slice 4A round 2 item 7: the narrow anchor-facts reader.
 *
 * The note write/read gate needs goal, stage and task facts. It must NOT go
 * through the general Plan service: that service authorizes a `work_run`
 * against the Run's own goal (`plan-service.ts` `authorizeGoal`) and refuses a
 * project scribe reading another goal's plan, which L2a class 3 / N-20 allow
 * only after the notes-side caller gate and scope admission have decided.
 *
 * This reader goes straight to the tasks-side records readers
 * (`readGoalPlanWindow`, `readPlan`), mirroring `readCatalogModuleFacts`. It
 * requires the Goal to be in the call-context project and — when the context is
 * workspace-bound — its workspace (forbidden otherwise), and it propagates
 * `not_found` and read failures distinctly, never as absence.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { ArchitectureBaselinePin } from '../../../contracts/governance.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { readGoal, readGoalPlanWindow, readPlan } from '../tasks/plan-readers.js';

/** The facts of one plan revision the anchor gate needs. */
export type AnchorGoalPlanFacts = {
  planRevision: number;
  stageIds: string[];
  tasks: { taskId: string; disposition: string }[];
};

export type AnchorGoalFacts = {
  /** Always true on a ready read: a missing Goal is `not_found`, never `exists: false`. */
  exists: true;
  /** The Goal's current accepted plan; `null` when the Goal exists with no active plan. */
  current: AnchorGoalPlanFacts | null;
  /** The Run-bound plan (item 6), present only for the agent's own goal. */
  bound?: AnchorGoalPlanFacts;
  /**
   * The architecture baseline of the basis plan: the bound plan's when there is
   * one, else the current plan's; `null` when neither plan exists.
   */
  effectiveArchitectureBaseline: ArchitectureBaselinePin | null;
};

function factsOf(plan: PlanRevisionSnapshot): AnchorGoalPlanFacts {
  return {
    planRevision: plan.planRevision,
    stageIds: plan.stages.map(stage => stage.stageId),
    tasks: plan.tasks.map(task => ({ taskId: task.taskId, disposition: task.disposition })),
  };
}

export async function readAnchorGoalFacts(
  records: GoalRecordTransactionPort,
  ctx: CoreCallContext,
  goalId: string,
  boundPlanRef?: PlanRevisionRef | null,
): Promise<ReadResult<AnchorGoalFacts>> {
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
  // Distinguish a missing Goal from a missing active PlanRevision: the window
  // returns the plan read's rejection unchanged, so a `not_found` window is not
  // evidence that the Goal itself is absent.
  const goalRead = await readGoal(records, goalRef);
  if (goalRead.status !== 'ready') {
    return goalRead.code === 'not_found' ? { status: 'not_found' } : goalRead;
  }
  const window = await readGoalPlanWindow(records, goalRef);
  if (window.status !== 'ready') {
    // The Goal exists, so a failed window read (e.g. a dangling active plan) is
    // an availability failure, never absence.
    return { status: 'rejected', code: 'unavailable', reason: window.reason };
  }
  if (window.goal.ref.projectId !== ctx.projectId) {
    return { status: 'rejected', code: 'forbidden', reason: 'the goal is outside the call context project' };
  }
  if (ctx.workspaceId !== undefined && window.goal.workspaceRef.workspaceId !== ctx.workspaceId) {
    return { status: 'rejected', code: 'forbidden', reason: 'the goal is outside the call context workspace' };
  }
  let bound: AnchorGoalPlanFacts | undefined;
  let boundBaseline: ArchitectureBaselinePin | null = null;
  if (boundPlanRef !== undefined && boundPlanRef !== null) {
    const boundRead = await readPlan(records, boundPlanRef);
    // A bound plan whose record is missing is a broken binding, not "no goal".
    if (boundRead.status === 'rejected' && boundRead.code === 'not_found') {
      return { status: 'rejected', code: 'unavailable', reason: `the bound plan ${boundPlanRef.planId} does not exist` };
    }
    if (boundRead.status !== 'ready') return boundRead;
    bound = factsOf(boundRead.plan);
    boundBaseline = boundRead.plan.effectiveArchitectureBaseline;
  }
  return { status: 'ready', value: {
    exists: true,
    current: window.plan === null ? null : factsOf(window.plan),
    ...(bound === undefined ? {} : { bound }),
    effectiveArchitectureBaseline: boundBaseline ?? window.plan?.effectiveArchitectureBaseline ?? null,
  } };
}
