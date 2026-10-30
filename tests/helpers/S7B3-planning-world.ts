/**
 * Q fixture Q1 (fixture spec v2.2 §2.2): the planning world the Q-recipe, V's intervention/restart and CS's
 * prepared-round rows drive. One S6A Host world; goal 1's AG2b plan is adopted and a real person message goes to its
 * no-task line; goal 2 gets a proposed, unapplied plan and its own no-task line. Public steps only; no store read,
 * no hand-made record. `options.backend` defaults to memory; Q2 passes `'sqlite'` for its retired source.
 */
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { AG2B_WORK_TASK_ID, ag2bPlanDraft, graphWrite } from './AG2b-collaboration-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6ASession } from './S6A-request-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { committed, sessionOf } from './S7A-fixture.js';
import { sendS7A2PersonMessage } from './S7A2-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from './S6B1-fixture.js';

export type S7BPlanningWorld = {
  world: S6AHostWorld;
  goalRef: GoalRef;
  messageRef: SessionMessageRef;
  sessionRef: S6ASession;
  noPlanGoalRef: GoalRef;
  noPlanSessionRef: S6ASession;
};

/** Open Q1 (fixture spec v2.2 §2.2 steps 1–5). */
export async function openS7BPlanningWorld(options: { backend?: S6ABackend } = {}):
Promise<S7BPlanningWorld> {
  const world = await openS6AHostWorld({ backend: options.backend ?? 'memory' });
  try {
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, ws, world.goals);
    await adoptS6BPlan(ws, world.goals.first, {
      label: 's7b3-planning', taskIds: [AG2B_WORK_TASK_ID], role: S6A_WORK_ROLE.templateId,
    });
    const line = await sessionOf(world,
      await createS6BLine(ws, { label: 's7b3-planning-line', role: S6A_WORK_ROLE }));
    const sent = await sendS7A2PersonMessage(world, {
      label: 's7b3-planning', recipient: line.ref, goal: world.goals.first,
    });
    const noPlanLine = await sessionOf(world,
      await createS6BLine(ws, { label: 's7b3-no-first-plan-line', role: S6A_WORK_ROLE }));
    committed<unknown>(await ws.post('plans/propose', graphWrite(ws.scope, {
      goalRef: world.goals.second, basedOn: null,
      draft: { ...ag2bPlanDraft(), goalId: world.goals.second.goalId, planId: 's7b3-no-first-plan' },
      reason: { text: 'S7B3 no first plan', sources: [] },
    }, 's7b3-no-first-plan-propose')), 'the no-first-plan proposal');
    return {
      world, goalRef: world.goals.first, messageRef: sent.ref, sessionRef: line,
      noPlanGoalRef: world.goals.second, noPlanSessionRef: noPlanLine,
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}
