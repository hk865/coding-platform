/**
 * R-candidates, pass part (book `:723`; SR3 (a), 〔L5〕, 〔a-12〕): a dispatch request is served by the real action
 * owner and its `action_release` card opens it. P2 §6 (`S7A2-R-candidates-pass:303`) replaced the old message-release
 * selection — `createMessageReleaseOwner` and the `release_message` perform are gone — so the old ledger that wired
 * them is deleted here instead of being kept as a dead second path.
 */
import { afterEach, expect, it } from 'vitest';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  holdS7AQueryRound, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const one of opened.splice(0)) await one.close().catch(() => undefined); });

it('a dispatch request is served by the action owner and its card opens it (memory)', async () => {
  const world = await openS6AHostWorld({ backend: 'memory' });
  opened.push(world);
  const { goal, plan } = await seedS7AGoalPlan(world, { pointer: 's7a2-pass-dispatch' });
  await setS7AAutonomy(world, goal, 'every_step');
  const task = plan.tasks.find(candidate => candidate.taskKind === 'work');
  if (task === undefined) throw new Error('S7A2 pass: the seeded plan has no work task');
  // P2 §6: the secretary's request round asks the real action owner to dispatch; the person's answer goes through
  // the `action_release` card, never `releaseMessage`.
  const requested = await holdS7AQueryRound(world, { label: 's7a2-pass-dispatch', goalId: goal.goalId },
    async context => world.platform.actionRequests.requestDispatch(context, {
      input: { taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId: task.taskId },
        reason: 'S7A2 pass dispatch' },
      meta: { requestId: 's7a2-pass-dispatch', expected: [] },
    }));
  expect(requested).toMatchObject({ status: 'needs_decision' });
  if (!('actionRef' in requested)) throw new Error(`the dispatch was not accepted: ${JSON.stringify(requested)}`);
  const queue = (await world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef: goal, sections: ['waiting_answer'], page: { limit: 20 },
  }))).body as { status?: string; value?: { waitingAnswer?: Array<{ cardKey: string; source: { kind?: string; pins: unknown[] } }> } };
  const card = queue.value?.waitingAnswer?.find(item => item.source.kind === 'action_release');
  // G2's card producer enqueues this item; today the queue carries none, so the row stops here.
  if (queue.status !== 'ready' || card === undefined) throw new Error('S7A2 pass: no action_release card yet');
  const answered = await world.post('decisions/answer', graphWrite(S6A_SCOPE, {
    source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
  }, 's7a2-pass-answer', card.source.pins));
  // `decisions/answer` answers with the resolve read (`ResolveDecisionReadV1`), its answer committed.
  expect(answered.body).toMatchObject({ status: 'ready', value: { answer: { status: 'committed' } } });
  expect(await world.platform.actionRequests.readRequest(world.humanContext(), { ref: requested.actionRef }))
    .toMatchObject({ status: 'ready', value: { state: 'open' } });
});
