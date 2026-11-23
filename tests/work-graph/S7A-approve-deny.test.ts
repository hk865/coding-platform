/** X-approve-deny (§2.5, §3.3, §5.5; P2 §6 S7A-approve-deny:66): the `action_release` card's `ActionRequest` batch
 * and deny through `decisions/queue` + `decisions/answer`, never through `messages/release`. */
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionRequestRef } from '../../src/contracts/action-request.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  holdS7AQueryRound, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

const actionArms = [
  { allow: true, optionId: 'approve', state: 'open' },
  { allow: false, optionId: 'deny', state: 'denied' },
] as const;

// The source is the generic `DecisionSourceV1` (kind, key, subject, pins); the request ref is the card's own
// `actionRelease.ref` (P2 §2.8 动作卡读).
type ActionReleaseCard = { cardKey: string; source: { kind: string; pins: unknown[] }; state: string;
  actionRelease?: { ref: ActionRequestRef } };

async function actionReleaseCard(world: S6AHostWorld, goal: GoalRef): Promise<ActionReleaseCard | undefined> {
  const answer = await world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef: goal, sections: ['waiting_answer'], page: { limit: 20 },
  }));
  const body = answer.body as { status?: string; value?: { waitingAnswer?: ActionReleaseCard[] } };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`X-approve-deny: decisions/queue is not ready: ${JSON.stringify(answer)}`);
  }
  return body.value.waitingAnswer?.find(card => card.source.kind === 'action_release');
}

describe('X-approve-deny: the person\'s two action-release arms', () => {
  it.each(actionArms)('$optionId answers the action_release card and moves its ActionRequest once', async (arm) => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const { goal, plan } = await seedS7AGoalPlan(world, { pointer: 'x-ad-card' });
    await setS7AAutonomy(world, goal, 'every_step');
    const task = plan.tasks.find(candidate => candidate.taskKind === 'work');
    if (task === undefined) throw new Error('X-approve-deny: the seeded plan has no work task');
    // The real secretary round asks to dispatch; `every_step` makes the request wait for the person's card.
    const requested = await holdS7AQueryRound(world, { label: 'x-ad-card', goalId: goal.goalId },
      async context => world.platform.actionRequests.requestDispatch(context, {
        input: { taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId: task.taskId },
          reason: 'the person decides this dispatch' },
        meta: { requestId: `x-ad-dispatch-${arm.optionId}`, expected: [] },
      }));
    expect(requested).toMatchObject({ status: 'needs_decision' });
    if (!('actionRef' in requested)) throw new Error(`the dispatch was not accepted: ${JSON.stringify(requested)}`);
    const card = await actionReleaseCard(world, goal);
    // The card producer is G2's; today `decisions/queue` carries no `action_release` card, so the row stops here.
    if (card === undefined) throw new Error('X-approve-deny: no action_release card in decisions/queue yet');
    const requestRef = card.actionRelease?.ref;
    if (requestRef === undefined) throw new Error('X-approve-deny: the action_release card carries no request view');
    const answered = await world.post('decisions/answer', graphWrite(S6A_SCOPE, {
      source: card.source, selection: { kind: 'option', optionId: arm.optionId }, text: '', annotations: [],
    }, `x-ad-answer-${arm.optionId}`, card.source.pins));
    // `decisions/answer` answers with the resolve read (`ResolveDecisionReadV1`), its answer committed.
    expect(answered.body).toMatchObject({ status: 'ready', value: { answer: { status: 'committed' } } });
    const request = await world.platform.actionRequests.readRequest(world.humanContext(),
      { ref: requestRef });
    expect(request).toMatchObject({ status: 'ready', value: { state: arm.state,
      answerRef: expect.objectContaining({ aggregateType: 'SessionMessage' }) } });
    expect(requested.actionRef).toEqual(requestRef);
  });
});
