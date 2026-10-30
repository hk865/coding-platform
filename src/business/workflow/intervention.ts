import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { GoalSnapshot } from '../../contracts/ledger.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { TaskClaim } from '../../contracts/core/task-claim.js';
import type { PlanRevisionSnapshot, RuntimeTask } from '../../contracts/plan.js';
import type { TaskRow } from '../../core/work-graph/model/plan-contracts.js';
import type { SessionCard } from '../../core/work-graph/model/session-contracts.js';
import { asRejection } from './consultation.js';
import type { HandleInterventionResultV1, WorkflowDependencies } from './ports.js';
import { ownContext, type Base, type Owned } from './workflow.js';
export type InterventionDependencies = {
  /** createWorkflow's own deps object, by reference, never spread (the task-gate rule, book `:258`). */
  workflow: Pick<WorkflowDependencies, 'consultations' | 'plans' | 'sessions' | 'sessionFacts'>;
  /** The one ordinary claim builder, passed by createWorkflow (`buildClaimOperation`, workflow.ts:1041). */
  claimIntervention(owned: Owned, base: Base, goal: GoalSnapshot, plan: PlanRevisionSnapshot,
    task: RuntimeTask, row: TaskRow, session: SessionCard, messageRef: SessionMessageRef):
    Promise<{ claim: TaskClaim } | CoreRejection>;
};
export type InterventionHandler = {
  handleIntervention(ctx: CoreCallContext, input: { messageRef: SessionMessageRef }): Promise<HandleInterventionResultV1>;
};
export function createInterventionHandler(deps: InterventionDependencies): InterventionHandler {
  const { consultations, plans, sessions, sessionFacts } = deps.workflow;
  return {
    async handleIntervention(ctx, input) {
      const owned = ownContext(ctx);
      if ('rejection' in owned) return owned.rejection;
      if (consultations === undefined || sessionFacts === undefined || plans.queryGoalDisplay === undefined) {
        return { status: 'rejected', code: 'unsupported',
          reason: 'the intervention handler needs the mailbox, the Session facts and the Goal display' };
      }
      const read = await consultations.messages.readMessage(owned.ctx, input.messageRef);
      if (read.status !== 'ready') return asRejection(read, 'the intervention message');
      const message = read.value;
      if (message.ref.projectId !== owned.projectId || message.ref.workspaceId !== owned.workspaceId) {
        return { status: 'rejected', code: 'forbidden',
          reason: 'the intervention message is outside the bound project/workspace' };
      }
      if ('kind' in message.recipient) {
        return { status: 'rejected', code: 'unsupported', reason: 'a user-recipient message is not a line' };
      }
      // The line is the recipient Session; the named Task wins over the line's newest Work Task. A message
      // without `taskRef` is allowed: its effective line is the Session below (book `:445`; 7b1rd-07). The
      // allowed sender is L's dispatch gate (person or `action_request`, SR9 L3); this handler does not restate it.
      const line = message.recipient;
      const facts = await sessionFacts.readSessionFacts(owned.ctx, line);
      if (facts.status !== 'ready') return asRejection(facts, 'the intervention line facts');
      const addressed = message.taskRef ?? facts.value.latestWork?.task ?? null;
      if (addressed === null) return { status: 'queued', reason: 'no_task' };
      const goal = await plans.queryGoal(owned.ctx,
        { aggregateType: 'Goal', projectId: addressed.projectId, goalId: addressed.goalId });
      if (goal.status !== 'ready') return asRejection(goal, 'the message Goal');
      // SMK3b (97-9; v3.4 B-01): a Host restart's pending GoalInterruption is resolved only when a person starts the
      // Goal driver (onStarted fires for a Goal-scoped start only, A/collaboration-driver.ts:1064). A Task-scoped
      // intervention start must not run under it, whoever sent the message (B-36); the message stays queued.
      const display = await plans.queryGoalDisplay(owned.ctx, { goalRef: goal.value.goal.ref });
      if (display.status !== 'ready') return asRejection(display, 'the Goal display');
      if (display.value.display.causes.some((cause) => 'interruption' in cause)) {
        return { status: 'rejected', code: 'busy',
          reason: 'a Host restart interrupted the Goal; a person continues it by starting the Goal' };
      }
      const graph = await plans.queryTaskGraph(owned.ctx, { goalRef: goal.value.goal.ref });
      if (graph.status !== 'ready') return asRejection(graph, 'the Task graph');
      const task = graph.value.plan.tasks.find((candidate) => candidate.taskId === addressed.taskId);
      const row = graph.value.tasks.find((candidate) => candidate.ref.taskId === addressed.taskId);
      // Unfinished = active and not satisfied; the open wait is deliberately not consulted (D-04).
      if (task === undefined || row === undefined || row.disposition !== 'active'
        || row.effectivePhase === 'satisfied') return { status: 'queued', reason: 'no_task' };
      const card = await sessions.readSession(owned.ctx,
        { projectId: line.projectId, sessionId: line.sessionId });
      if (card.status !== 'ready') return asRejection(card, 'the intervention Session');
      const base: Base = { goalRef: goal.value.goal.ref, flowId: '', sessionHint: line,
        actor: owned.actor, taskId: addressed.taskId, failedCardRefs: [], releaseSkip: new Set<string>() };
      const claimed = await deps.claimIntervention(owned, base, goal.value.goal, graph.value.plan,
        task, row, card.value, input.messageRef);
      if ('status' in claimed) return claimed;       // CoreRejection; its `status` is 'rejected'
      return { status: 'claimed', branch: 'existing_task', claim: claimed.claim };
    },
  };
}
