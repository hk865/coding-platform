/** R3c shared rule seam for queryReadyTasks and future R4c claim admission. */
import type { TaskEligibility, TaskIneligibilityReason } from '../../../contracts/dispatch.js';
import type { Phase, PlanRevisionSnapshot } from '../../../contracts/plan.js';

/** Fully read canonical task state. Budget, role, Session and resource checks
 * are added by R4c claim; queryReadyTasks never fabricates those inputs. */
export type TaskStateEligibilityFacts = {
  plan: PlanRevisionSnapshot;
  goalDesiredState: 'active';
  taskId: string;
  effectivePhases: ReadonlyMap<string, Phase>;
  lease: { status: 'free' } | { status: 'leased'; holderRunId: string };
};

/**
 * Task-state eligibility rule (the R3c query slice only).
 *
 * It interprets the CURRENT formal reduction (`effectivePhases`) plus the
 * already-read lease fact. It deliberately does NOT read or invent token
 * budget, deadline, role binding, Session occupancy or resource capacity:
 * those are R4c claim-admission inputs, and a display candidate is never a
 * dispatch/start authorization.
 *
 * A hard `executionDag.dependsOn` edge is NOT a candidate gate here: the exact
 * required input is verified when it is actually consumed (`readTaskInput`),
 * never by the predecessor Task's whole completion. An absent phase for THIS
 * task is incomplete state (`task_state_incomplete`), never a default
 * `pending`.
 */
export function evaluateEligibility(facts: TaskStateEligibilityFacts): TaskEligibility {
  const reasons: TaskIneligibilityReason[] = [];
  if (facts.goalDesiredState !== 'active') {
    reasons.push({ code: 'goal_not_active', message: 'goal desiredState is not active' });
  }
  const task = facts.plan.tasks.find((candidate) => candidate.taskId === facts.taskId);
  if (task === undefined) {
    reasons.push({ code: 'task_not_found', taskId: facts.taskId,
      message: 'task is not part of the accepted plan' });
    return { eligible: false, reasons };
  }
  if (task.taskKind !== 'work') {
    reasons.push({ code: 'task_kind_not_work', taskId: task.taskId, taskKind: task.taskKind,
      message: 'only work tasks are dispatched; gate tasks are reduced by evidence' });
  }
  if (task.disposition !== 'active') {
    reasons.push({ code: 'task_not_active', taskId: task.taskId, disposition: task.disposition,
      message: 'task disposition is not active' });
  }
  const phase = facts.effectivePhases.get(task.taskId);
  if (phase === undefined) {
    reasons.push({ code: 'task_state_incomplete', taskId: task.taskId,
      message: 'the canonical phase for this task was not read' });
  } else if (phase === 'blocked') {
    reasons.push({ code: 'task_phase_not_dispatchable', taskId: task.taskId, phase, blocked: true,
      message: 'task is blocked' });
  } else if (phase !== 'pending' && phase !== 'ready') {
    reasons.push({ code: 'task_phase_not_dispatchable', taskId: task.taskId, phase, blocked: false,
      message: 'task phase is not dispatchable (pending|ready)' });
  }
  if (facts.lease.status === 'leased') {
    reasons.push({ code: 'resource_unavailable', taskId: task.taskId, detail: 'leased',
      message: 'task already has an active lease (holder run ' + facts.lease.holderRunId + ')' });
  }
  return reasons.length === 0 ? { eligible: true, reasons: [] } : { eligible: false, reasons };
}
