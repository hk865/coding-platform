/** Host collaboration driver: start, stop and the read-only driver poll (P1) for one Workflow advance. */

import type {
  BootstrapExecutionQueryProfile,
  CoreScope,
  WorkflowAdvanceBody,
  WorkflowDriverReadResponse,
  WorkflowDriverStartBody,
  WorkflowDriverStartResponse,
  WorkflowDriverStopResponse,
} from '../../../app/core-http-types.js';
import { callCore, outcomeProblem, outcomeRejectionReason, payloadOf } from '../../api/http.js';
import { startPoll, stopPoll } from '../../api/refresh.js';
import type { ExecutionRun, ScopeState } from '../../state/scope-state.js';
import { record } from '../../state/values.js';
import { bootstrap, renderScopeIfSelected } from '../../state/workbench.js';
import { driveRun, executionCall } from './run.js';

/** The Goal this execution/scope works under; on a reload it falls back to the
 * selected/typed Goal so a read-only driver read still works by goal. */
export function collaborationGoalRef(scope: ScopeState, run: ExecutionRun): NonNullable<ExecutionRun['goalRef']> | null {
  // The CURRENT explicit Goal choice (typed form or selected Goal) owns the
  // panel; the previous execution run is only a fallback. This is what lets a
  // user switch Goals without the old handle's response writing back.
  const target = run.scope ?? scope.config.scope;
  const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || '';
  if (goalId.length > 0) return { aggregateType: 'Goal', projectId: target.projectId, goalId };
  return run.goalRef;
}

export function collaborationIsActive(snapshot: WorkflowDriverReadResponse): boolean {
  if (snapshot.status !== 'ready') return false;
  const value = snapshot.value.state;
  // `waiting` means the owner already returned and the loop drained; only an
  // explicit later continue may start the next bounded advance.
  return value === 'running' || value === 'waiting_for_reply' || value === 'stopping';
}

/** Read the official Goal/TaskGraph once when a collaboration handle first
 * reaches `completed`; the UI never treats its own flag as formal completion. */
async function syncCollaborationFacts(
  scope: ScopeState, target: CoreScope, goalRef: NonNullable<ExecutionRun['goalRef']>, epoch: number,
): Promise<void> {
  const key = `${target.projectId}\u0000${target.workspaceId}\u0000${goalRef.goalId}`;
  if (scope.collaborationSyncedGoal === key) return;
  const goalRead = await callCore('goals/read', { scope: target, input: goalRef });
  const tasksRead = await callCore('tasks/query', { scope: target, input: { goalRef } });
  // A late response for an OLD Goal must not sync its official graph into a
  // newer panel, and only two successful reads mark the Goal synced.
  if (scope.collaborationEpoch !== epoch) return;
  const currentSelected = collaborationGoalRef(scope, scope.execution);
  if (currentSelected === null || currentSelected.goalId !== goalRef.goalId) return;
  const goalPayload = goalRead.kind === 'response' ? payloadOf(goalRead) : null;
  const tasksPayload = tasksRead.kind === 'response' ? payloadOf(tasksRead) : null;
  const goalOk = goalPayload !== null && record(goalPayload).status === 'ready';
  const tasksOk = tasksPayload !== null && record(tasksPayload).status === 'ready';
  if (goalOk) scope.goalRead = goalPayload;
  if (tasksOk) { scope.taskGraph = tasksPayload; scope.taskGraphGoalId = goalRef.goalId; }
  if (goalOk && tasksOk) scope.collaborationSyncedGoal = key;
  renderScopeIfSelected(scope);
}

/** Same-scope trusted Query profile ids, one per role. An ambiguous role keeps
 * only the user's explicitly selected profile; the Host re-matches the exact
 * recipient role and reports an honest wait when no unique profile exists. */
function collaborationProfileIds(scope: ScopeState, target: CoreScope): string[] {
  const profiles = bootstrap()?.execution.queryProfiles ?? [];
  const matching = profiles.filter(profile => profile.scope.projectId === target.projectId
    && profile.scope.workspaceId === target.workspaceId);
  const groups = new Map<string, BootstrapExecutionQueryProfile[]>();
  for (const profile of matching) {
    const key = JSON.stringify(profile.sessionRole);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [profile]); else group.push(profile);
  }
  const ids: string[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) { ids.push(group[0]!.id); continue; }
    const selected = group.find(profile => profile.id === scope.executionProfileId);
    if (selected !== undefined) ids.push(selected.id);
  }
  return ids;
}

export function beginCollaborationPoll(
  scope: ScopeState, target: CoreScope, goalRef: NonNullable<ExecutionRun['goalRef']>,
): void {
  const epoch = scope.collaborationEpoch + 1;
  scope.collaborationEpoch = epoch;
  stopPoll(scope.collaborationPoll);
  // One read now; then on driver notices for this Goal (the 1000 ms poll is the fallback).
  scope.collaborationPoll = startPoll(1000, () => readCollaboration(scope, target, goalRef, epoch),
    { kind: 'driver', scope: target, goalId: goalRef.goalId }, { immediate: true });
}

/** Read-only driver projection bound to one poll/goal EPOCH. A network failure
 * keeps the last snapshot; a response for an older Goal can never overwrite the
 * current panel or clear a newer timer, and the Host driver is never cancelled. */
export async function readCollaboration(
  scope: ScopeState, target: CoreScope, goalRef: NonNullable<ExecutionRun['goalRef']>, epoch: number,
): Promise<void> {
  const activeTaskId = scope.execution.taskId;
  const outcome = await callCore('workflow/driver-read', { scope: target, input: { goalRef, ...(activeTaskId === null ? {} : { taskId: activeTaskId }) } });
  if (scope.collaborationEpoch !== epoch) return;
  if (outcome.kind !== 'response') return;
  const payload = payloadOf(outcome) as WorkflowDriverReadResponse;
  if (payload.status !== 'ready' && payload.status !== 'not_found') return;
  scope.collaboration = { goalRef, result: payload };
  const run = scope.execution;
  if (run.goalRef !== null && run.goalRef.goalId === goalRef.goalId && payload.status === 'ready') {
    run.phase = payload.value.state;
    if (payload.value.last !== null) run.advance = payload.value.last;
  }
  if (payload.status === 'ready' && payload.value.state === 'completed') {
    void syncCollaborationFacts(scope, target, goalRef, epoch);
  }
  if (!collaborationIsActive(payload) && scope.collaborationPoll !== null) {
    stopPoll(scope.collaborationPoll);
    scope.collaborationPoll = null;
  }
  renderScopeIfSelected(scope);
}

/** Start (or replay) the Host driver for one exact Workflow advance through the
 * page's normal request cache, so a network retry replays the SAME driver-start
 * payload instead of rebuilding a flow or reusing the old Query driver. */
export async function startCollaboration(
  scope: ScopeState, run: ExecutionRun, target: CoreScope, advance: WorkflowAdvanceBody['input'],
): Promise<void> {
  const goalRef = collaborationGoalRef(scope, run);
  if (goalRef === null) { run.error = '请先选择或创建目标。'; renderScopeIfSelected(scope); return; }
  run.goalRef = goalRef;
  const request: WorkflowDriverStartBody = { scope: target, input: {
    advance: advance as WorkflowAdvanceBody['input'],
    queryProfileIds: collaborationProfileIds(scope, target),
  } };
  const epoch = scope.collaborationEpoch + 1;
  scope.collaborationEpoch = epoch;
  await driveRun(scope, run, async (current, active) => {
    const outcome = await executionCall(current, active, 'workflow/driver-start', request);
    const problem = outcomeProblem(outcome);
    if (problem !== null) { active.error = problem; return; }
    const payload = payloadOf(outcome) as WorkflowDriverStartResponse;
    if (payload.status !== 'ready') {
      active.error = outcomeRejectionReason(payload);
      active.phase = 'rejected';
      return;
    }
    active.phase = payload.value.state;
    active.resumeIntent = null;
    if (payload.value.last !== null) active.advance = payload.value.last;
    // The user may have switched Goals while this start was in flight: the old
    // Goal must never write the new panel or own its timer.
    if (scope.collaborationEpoch !== epoch) return;
    scope.collaboration = { goalRef, result: { status: 'ready', value: payload.value } };
    beginCollaborationPoll(scope, target, goalRef);
  });
}

/** Ask the Host driver to stop; the page only reads afterwards and never writes
 * a fabricated 'cancelled'. */
export async function stopCollaboration(scope: ScopeState): Promise<void> {
  const run = scope.execution;
  const goalRef = collaborationGoalRef(scope, run) ?? scope.collaboration?.goalRef ?? null;
  if (goalRef === null) { scope.error = '没有可停止的协同推进句柄。'; renderScopeIfSelected(scope); return; }
  const target = run.scope ?? scope.config.scope;
  const epoch = scope.collaborationEpoch;
  run.running = true;
  renderScopeIfSelected(scope);
  try {
    const outcome = await callCore('workflow/driver-stop', { scope: target, input: { goalRef, ...(run.taskId === null ? {} : { taskId: run.taskId }) } });
    const problem = outcomeProblem(outcome);
    if (problem !== null) { run.error = problem; return; }
    const payload = payloadOf(outcome) as WorkflowDriverStopResponse;
    if (payload.status === 'ready' || payload.status === 'not_found') {
      if (scope.collaborationEpoch !== epoch) return;
      scope.collaboration = { goalRef, result: payload };
      beginCollaborationPoll(scope, target, goalRef);
    } else {
      run.error = outcomeRejectionReason(payload);
    }
  } finally {
    run.running = false;
    renderScopeIfSelected(scope);
  }
}
