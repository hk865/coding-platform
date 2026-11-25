/**
 * BK-A rows NRQ-1..NRQ-4 (ruling `7d2-bkat` §4): `decisions/queue` derives one `node_review` card for a Goal
 * that has at least one node waiting for the person. Business rows through the real Host, memory backend only
 * (`tests/RULES.md` S3), world `tests/helpers/S7D2-DNR-node-world.ts`; every prior state is a public step and no
 * record is written or database read. Expected values are hand-computed in §4 from `taskNodePending`:
 * `every_step` + a `satisfied` work node that changed one file = pending; `after_plan_confirmation` = not pending.
 *
 * Red on the base tree (7dbkat-base), green when BK-A lands: the queue has no `node_review` source kind yet, so
 * NRQ-1..NRQ-3 fail on the missing card/count. NRQ-4 asserts absence, so it is green on the base tree and red only
 * under its named mutation (`derive-from-rows`), which is the behaviour it guards.
 */
import { describe, expect, it, onTestFinished } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { adoptPLMixedPlan } from '../helpers/PL-consumption-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { setS7AAutonomy } from '../helpers/S7A-fixture.js';
import {
  createFile, dnrCommit, dnrLine, dnrRow, dnrRows, openDNRWorld, runDNRNode, type DNRWorld,
} from '../helpers/S7D2-DNR-node-world.js';

/** One line and one `satisfied` work node that created `path` through the Kernel's real `edit`. */
async function runNodeWithFile(w: DNRWorld, taskId: string, path: string): Promise<void> {
  await runDNRNode(w, await dnrLine(w, `${taskId}-line`, [taskId]), taskId,
    [createFile(`${taskId}-edit`, path, `export const ${taskId.replace(/-/g, '_')} = 1;\n`)]);
}

/** `decisions/queue` scoped to one Goal, `waiting_answer` only (the count read the ruling's §3.4 names). */
async function queueOfGoal(w: DNRWorld, goalRef: GoalRef, limit = 100): Promise<DecisionQueueReadV1> {
  const answer = await w.world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef, sections: ['waiting_answer'], page: { limit },
  }));
  const read = answer.body as ReadResult<DecisionQueueReadV1>;
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

/** The one card kind BK-A adds; `String` because the base tree's union does not carry it yet. */
const nodeReviewCardsOf = (queue: DecisionQueueReadV1): DecisionCardV1[] =>
  queue.waitingAnswer.filter(card => String(card.source.kind) === 'node_review');

describe('BK-A: node_review cards in the decision queue', () => {
  it('NRQ-1 decisions/queue derives one node_review card from two pending nodes', async () => {
    const w = await openDNRWorld({ label: 'nrq1', autonomy: 'after_plan_confirmation', taskIds: ['nrq1-a', 'nrq1-b'] });
    onTestFinished(() => w.close());
    await runNodeWithFile(w, 'nrq1-a', 'src/nrq1-a.ts');
    await runNodeWithFile(w, 'nrq1-b', 'src/nrq1-b.ts');
    await setS7AAutonomy(w.world, w.goal, 'every_step');
    expect((await dnrRows(w)).pending).toHaveLength(2);

    const queue = await queueOfGoal(w, w.goal);
    const cards = nodeReviewCardsOf(queue);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.state).toBe('waiting_answer');
    expect(card.subject).toEqual({ kind: 'goal', goalRef: w.goal });
    expect(JSON.parse(card.source.key)).toEqual({ kind: 'node_review', goalRef: w.goal });
    expect(card.actions).toEqual([]);
    expect(card.readOnly).toBe(true);
    expect(card.taskRef).toBeNull();
    expect(card.runRef).toBeNull();
    expect(queue.counts.waitingAnswer).toBe(1);

    const detail = (await w.world.post('decisions/card', plain(S6A_SCOPE, { source: card.source })))
      .body as ReadResult<DecisionCardV1>;
    expect(detail.status).toBe('ready');
    if (detail.status !== 'ready') throw new Error('the node_review card must read by its source');
    expect(detail.value.cardKey).toBe(card.cardKey);
    expect(detail.value.state).toBe(card.state);
    expect(detail.value.source.key).toBe(card.source.key);
  });

  it('NRQ-2 the node_review card stays one until the last pending node is reviewed, then disappears', async () => {
    // The NRQ-1 world: the same two pending nodes on one Goal.
    const w = await openDNRWorld({ label: 'nrq2', autonomy: 'after_plan_confirmation', taskIds: ['nrq1-a', 'nrq1-b'] });
    onTestFinished(() => w.close());
    await runNodeWithFile(w, 'nrq1-a', 'src/nrq1-a.ts');
    await runNodeWithFile(w, 'nrq1-b', 'src/nrq1-b.ts');
    await setS7AAutonomy(w.world, w.goal, 'every_step');
    expect((await dnrRows(w)).pending).toHaveLength(2);

    const before = nodeReviewCardsOf(await queueOfGoal(w, w.goal));
    expect(before).toHaveLength(1);
    const beforeKey = before[0]!.source.key;

    await dnrCommit(w, { taskId: 'nrq1-a', requestId: 'nrq2-a-commit' });
    const afterA = await queueOfGoal(w, w.goal);
    expect(nodeReviewCardsOf(afterA)).toHaveLength(1);
    expect(nodeReviewCardsOf(afterA)[0]!.source.key).toBe(beforeKey);
    expect(afterA.counts.waitingAnswer).toBe(1);

    await dnrCommit(w, { taskId: 'nrq1-b', requestId: 'nrq2-b-commit' });
    const afterB = await queueOfGoal(w, w.goal);
    expect(nodeReviewCardsOf(afterB)).toHaveLength(0);
    expect(afterB.counts.waitingAnswer).toBe(0);
  });

  it('NRQ-3 decisions/queue counts the node_review card only under its own Goal', async () => {
    const w = await openDNRWorld({ label: 'nrq3', autonomy: 'after_plan_confirmation', taskIds: ['nrq3-a', 'nrq3-b'] });
    onTestFinished(() => w.close());
    await runNodeWithFile(w, 'nrq3-a', 'src/nrq3-a.ts');
    await runNodeWithFile(w, 'nrq3-b', 'src/nrq3-b.ts');
    await setS7AAutonomy(w.world, w.goal, 'every_step');
    expect((await dnrRows(w)).pending).toHaveLength(2);
    // The second Goal's Plan is adopted but has no Run and no reduction: its only work Task is not pending.
    await adoptPLMixedPlan(w.world, { goal: w.world.goals.second, label: 'nrq3-b',
      tasks: [{ taskId: 'nrq3-b', role: S6A_WORK_ROLE.templateId }] });

    const first = await queueOfGoal(w, w.goal, 1);
    expect(first.counts.waitingAnswer).toBe(1);
    const firstCards = nodeReviewCardsOf(first);
    expect(firstCards).toHaveLength(1);
    expect(firstCards[0]!.subject).toEqual({ kind: 'goal', goalRef: w.goal });

    const second = await queueOfGoal(w, w.world.goals.second, 1);
    expect(second.counts.waitingAnswer).toBe(0);
    expect(nodeReviewCardsOf(second)).toHaveLength(0);
  });

  it('NRQ-4 a node under after_plan_confirmation derives no node_review card', async () => {
    const w = await openDNRWorld({ label: 'nrq4', autonomy: 'after_plan_confirmation', taskIds: ['nrq4-a'] });
    onTestFinished(() => w.close());
    await runNodeWithFile(w, 'nrq4-a', 'src/nrq4-a.ts');
    expect((await dnrRow(w, 'nrq4-a')).pending).toBe(false);

    const queue = await queueOfGoal(w, w.goal);
    expect(nodeReviewCardsOf(queue)).toHaveLength(0);
    expect(queue.counts.waitingAnswer).toBe(0);
  });
});
