/** INT U3 rows (§4.7): a named Goal wins over the newest Work Goal; without a name the newest Work decides. */
import { afterEach, expect, it } from 'vitest';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { runsOf } from '../helpers/DRV-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { completeS7BGoal, firstPlan } from '../helpers/S7B-V-fixture.js';
import { runS7BWait } from '../helpers/S7B-fixture.js';
import { adoptS6BPlan } from '../helpers/S6B1-fixture.js';
import { intAwaitNoGoalRequest, intAwaitPlanning, intOpenWaitWorld, intSendPerson } from '../helpers/INT-world.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

it('INT-N1 a Goal named on the line page wins over the newest Work Goal in the same workspace', async () => {
  const world = await intOpenWaitWorld('int-n1');
  closers.push(world.close);
  const wait = await runS7BWait(world, { label: 'int-n1' });
  const other = (await s6aCardsWorkspace(world, S6A_SCOPE).createGoal('int-n1-b', 'INT N1 other Goal')).ref;
  await world.scripted.script(wait.sender, [{ kind: 'text', text: firstPlan({ label: 'int-n1',
    taskId: 'int-n1-task', role: S6A_WORK_ROLE.templateId }) }]);
  const before = (await runsOf(world, wait.goal, wait.tasks[0]!.taskId)).length;

  const message = await intSendPerson(world, { id: 'n1', recipient: wait.sender.ref,
    text: 'INT-N1 plan the other Goal', goal: other });
  const planning = await intAwaitPlanning(world, message.ref, 16);
  expect(planning?.job.job.goalId, 'the named Goal opens its planning Query').toBe(other.goalId);
  expect((await runsOf(world, wait.goal, wait.tasks[0]!.taskId)).length, 'no new Run on the old Goal\'s Task')
    .toBe(before);
}, 180_000);

it('INT-N2 a completed Goal named on the line page is the new request\'s source', async () => {
  const world = await intOpenWaitWorld('int-n2');
  closers.push(world.close);
  const wait = await runS7BWait(world, { label: 'int-n2' });
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const other = (await main.createGoal('int-n2-b', 'INT N2 completed Goal')).ref;
  await adoptS6BPlan(main, other, { label: 'int-n2-b', taskIds: ['int-n2-b-work'], role: S6A_WORK_ROLE.templateId });
  await completeS7BGoal({ world, goalRef: other });

  const message = await intSendPerson(world, { id: 'n2', recipient: wait.sender.ref,
    text: 'INT-N2 more work on the completed Goal', goal: other });
  const page = await intAwaitNoGoalRequest(world, view => view.source?.goalRef.goalId === other.goalId
    && view.source.messageRef?.messageId === message.ref.messageId, 16);
  const request = page.requests.find(view => view.source?.goalRef.goalId === other.goalId
    && view.source.messageRef?.messageId === message.ref.messageId);
  if (request === undefined) throw new Error('INT-N2: the goal-less view lists no new-goal request');
  const detail = ready<RequestCoreViewV1>(await world.post('requests/read',
    plain(S6A_SCOPE, { requestRoot: request.requestRoot })), 'requests/read');
  expect(detail.source?.goalRef, 'the request names the completed Goal').toEqual(other);
  expect(detail.source?.messageRef, 'the request keeps the original message').toEqual(message.ref);
}, 180_000);

it('INT-N3 without a named Goal the line still claims its newest Work Task', async () => {
  const world = await intOpenWaitWorld('int-n3');
  closers.push(world.close);
  const wait = await runS7BWait(world, { label: 'int-n3' });
  await s6aCardsWorkspace(world, S6A_SCOPE).createGoal('int-n3-b', 'INT N3 other Goal');
  const prior = await runsOf(world, wait.goal, wait.tasks[0]!.taskId);
  const seen = new Set(prior.map(item => item.run.ref.runId));

  const message = await intSendPerson(world, { id: 'n3', recipient: wait.sender.ref, text: 'INT-N3 continue' });
  const planning = await intAwaitPlanning(world, message.ref, 8);
  expect(planning, 'no planning Query is opened for an unnamed Goal').toBeNull();
  const fresh = (await runsOf(world, wait.goal, wait.tasks[0]!.taskId))
    .filter(item => !seen.has(item.run.ref.runId));
  expect(fresh, 'the old Task gets the one new Run').toHaveLength(1);
  const claimed = fresh[0]!;
  expect(claimed.outbox.claim.sessionRef, 'the Run is claimed by the line with the newest Work')
    .toEqual(wait.sender.ref);
  expect(claimed.run.consumedWait, 'the claim consumes this person message as the intervention wait')
    .toEqual({ kind: 'intervention', messageRef: message.ref });
}, 180_000);
