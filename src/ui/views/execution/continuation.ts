/** The continuation seam: one public request at a time, continued only along the owner's real `next`. */

import type { CoreScope, InitialPlanningGoalInputResult, WorkflowAdvanceResult } from '../../../app/core-http-types.js';
import { outcomeProblem, outcomeRejectionReason, payloadOf } from '../../api/http.js';
import type { ExecutionIntent, ExecutionRun, ScopeState, WorkflowAdvanceInput } from '../../state/scope-state.js';
import { record } from '../../state/values.js';
import { startCollaboration } from './collaboration.js';
import { planExecutionContinuation } from './render.js';
import { executionCall } from './run.js';

/** One user action per public request: send, display, and continue ONLY when the
 * owner returned ready with a real `next`. A null `next` or a non-ready result
 * is a real stop that keeps the original request. The owner's next input is
 * forwarded untouched. */
export async function drainContinuation(
  scope: ScopeState, run: ExecutionRun, target: CoreScope, seed: ExecutionIntent,
): Promise<void> {
  let intent = seed;
  for (let guard = 0; guard < 64; guard += 1) {
    // The Host owns every formal Workflow advance: the page never sends a
    // browser `workflow/advance` chain, it starts the driver and then reads.
    if (intent.route === 'workflow/advance') {
      await startCollaboration(scope, run, target, intent.input);
      return;
    }
    run.resumeIntent = intent;
    const outcome = await executionCall(scope, run, intent.route, { scope: target, input: intent.input });
    const problem = outcomeProblem(outcome);
    if (problem !== null) { run.error = problem; return; }
    const payload = payloadOf(outcome);
    if (record(payload).status === 'rejected') {
      run.error = outcomeRejectionReason(payload);
      run.phase = 'rejected';
      return;
    }
    if (intent.route === 'workflow/goal-input') {
      run.planning = payload as InitialPlanningGoalInputResult;
      run.planningRequest = { scope: target, input: intent.input };
      if (run.planning.status === 'ready') {
        run.phase = run.planning.value.state;
        const next = run.planning.value.next;
        if (run.planning.value.state === 'proposed' && next !== null && next.kind === 'goal_input')
          run.candidate = run.planning.value.receipt;
      }
    } else {
      // Unreachable for a fresh seed (a workflow/advance intent is handed to the
      // Host at the top of the loop); kept so the type-narrowed branch is total.
      const advanceIntent = intent as { route: 'workflow/advance'; input: WorkflowAdvanceInput };
      run.advance = payload as WorkflowAdvanceResult;
      run.advanceRequest = { scope: target, input: advanceIntent.input };
      if (run.advance.status === 'ready') run.phase = run.advance.value.state;
    }
    const continuation = planExecutionContinuation(
      payload as WorkflowAdvanceResult | InitialPlanningGoalInputResult);
    if (continuation.status !== 'next') {
      // A waiting initial-plan adoption keeps its original public input so a
      // later explicit continue resends THAT request (a new requestId), never a
      // fabricated select_work.
      const readyState = record(payload).status === 'ready' ? record(record(payload).value).state : null;
      const receipt = record(record(record(payload).value).receipt);
      if (receipt.status === 'rejected') run.error = outcomeRejectionReason(receipt);
      run.resumeIntent = intent.route === 'workflow/goal-input' && readyState === 'waiting' ? intent : null;
      return;
    }
    if (continuation.route === 'workflow/goal-input')
      intent = { route: 'workflow/goal-input', input: continuation.input };
    else
      intent = { route: 'workflow/advance', input: continuation.input };
    run.resumeIntent = intent;
    // Planning produces a reviewable candidate, not permission to adopt it.
    // Keep the exact owner-provided next and receipt for explicit adoption.
    if (record(payload).status === 'ready'
      && record(record(payload).value).state === 'proposed'
      && continuation.route === 'workflow/goal-input') {
      run.notice = '规划候选已生成；请审阅后点击“采用并执行”。';
      return;
    }
  }
  // Per-page stop: the not-yet-sent next stays resumable.
  run.notice = '继续执行达到本页步数上限；原 next 已保留，点击“继续执行”发送同一公开请求。';
}
