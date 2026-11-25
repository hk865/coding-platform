/**
 * P6F F1 (`p6f-rulings.md` F1; P6 diagnosis E05): the Goal loop's adviser suggestion (`pick-suggest:<task>:<plan>`,
 * "Task <t> has no suitable member; create one executor line for this task (...)", needsReply, default wake) asks the
 * adviser for `create_member`.
 * - F1-a, the P6 shape: the adviser line is inside its cold-start coarse_split exploration round, which never carries
 *   `create_member` (121-114, `adviserMemberRound`), when the suggestion is sent. That round is not fed the letter;
 *   after it ends a round that carries `create_member` reads it, builds the executor line, and the next pass claims
 *   the Task with that line. Red on base: the exploration round takes the letter at its next safe point (only a round
 *   without the reply tool leaves a needsReply letter queued) and no later round opens for it.
 * - F1-b, the fallback: the suggestion's own round (it carries `create_member`) answers text only and ends, no line.
 *   The next pass must not wait on `suggestion_committed` again; whichever step it takes (the Host pick card or one
 *   more suggestion; the builder's choice, not asserted), the Task gets a line and the pass after claims it.
 *   Red on base: that pass answers `waiting` with `suggestion_committed` (`workflow.ts:3012-3018`).
 * - F1-c, the lead's edge on the fallback: the suggestion's round itself asked for this Task's member (an
 *   `every_step` Goal turns its `create_member` into a member card) and the person refused the card. The next pass
 *   neither takes the Host pick nor asks again: it waits with the hand-written reason below, the Goal keeps its one
 *   member card and gains no line. Named mutation: the fallback ignores the round's own request -> `host_pick_member`
 *   at the reason assertion.
 * Host inputs (A8): F1-a's adviser grant adds `respond_session_message` (the real adviser grant has it; without it
 * every round of the line leaves the letter queued) and an input consumer for the adviser's Query profile, so a woken
 * round can open. Public steps only; reads are public routes or the model boundary (`scripted.requests`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { advanceUntil, answer } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { awaitPlanningAnswer, heartbeatUntil } from '../helpers/IV-host-fixture.js';
import { consumerOf, openPLOverlapWorld } from '../helpers/PL-forms-fixture.js';
import type { S6AHostWorld, S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan } from '../helpers/S6B1-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { jsonOf, withConfiguredHost } from '../helpers/S7C-member-fixture.js';
import { openS7D2ColdStartWorld } from '../helpers/S7D2-coldstart-world.js';
import { advance } from '../scenarios/support/common.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

/** The suggestion's fixed words (the ADVQ Q1 literal, `S7C-L1-pick.test.ts:149`). */
const SUGGESTION = 'has no suitable member; create one executor line for this task';
const says = (request: ModelRequest): boolean => JSON.stringify(request.messages).includes(SUGGESTION);
const names = (request: ModelRequest): string[] => request.tools.map(tool => tool.name);
const select = (goal: GoalRef, flowId: string, taskId: string): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef: goal, flowId, sessionHint: null, kind: 'select_work', taskId });
const member = (callId: string, task: TaskTriple): S6AReply[] => [{ kind: 'calls', calls: [{ callId,
  name: 'create_member', args: { duty: 'executor', scope: { kind: 'task', task }, reason: callId } }] },
{ kind: 'text', text: `${callId} done` }];
const sessionIds = async (world: S6AHostWorld): Promise<Set<string>> =>
  new Set((await world.listSessions()).map(card => card.record.ref.sessionId));
/** Performs exactly one step (`input` is a `perform`) and answers its committed suggestion; no pass follows it. */
async function performSuggestion(world: S6AHostWorld, input: WorkflowAdvanceInput) {
  const receipt = (await advance(world.ag2b, input)).receipt;
  if (receipt?.kind !== 'suggest_member' || receipt.result.status !== 'committed') {
    throw new Error(`no committed suggestion: ${JSON.stringify(receipt)}`);
  }
  return receipt.result.value;
}

/** The one line the directory gained since `before`, then the next pass's claim of `task` with it. */
async function expectNewLineClaims(world: S6AHostWorld, before: Set<string>, task: TaskTriple): Promise<void> {
  const added = (await world.listSessions()).filter(card => !before.has(card.record.ref.sessionId));
  expect(added.map(card => card.links.some(link => link.until === null && link.ref.relation === 'responsible'
    && JSON.stringify(link.ref.target) === JSON.stringify({ kind: 'task', ref: task })))).toEqual([true]);
  const next = await advance(world.ag2b, select({ aggregateType: 'Goal', projectId: task.projectId,
    goalId: task.goalId }, 'p6f-f1-claim', task.taskId));
  expect(next.next).toMatchObject({ kind: 'perform', operation: { kind: 'claim_task', request: { input: {
    sessionRef: { projectId: task.projectId, sessionId: added[0]!.record.ref.sessionId } } } } });
}

describe('P6F F1: the line-building suggestion reaches a round that can build the line', () => {
  it('F1-a: a coarse_split round without create_member leaves the letter; the next round builds the line', async () => {
    const cold = await withConfiguredHost(() => openS7D2ColdStartWorld({ backend: 'memory',
      extraHostOptions: { inputConsumers: [consumerOf('c1-adviser-query-profile', 'p6f-f1a')] } }),
    original => async options => {
      const binding = options.runtimeConfiguration?.bindings.find(entry => entry.id === 'c1-adviser-query-binding');
      if (binding === undefined) throw new Error('F1-a: the cold-start adviser binding is absent');
      binding.grant = { ...binding.grant, tools: [...binding.grant.tools, 'respond_session_message'] };
      return await original(options);
    });
    closers.push(() => cold.close());
    const host = cold.host;
    const adviser: S6ASession = cold.lines.adviser;
    await cold.initialize(); // scripts the adviser's coarse round: the coarse proposal call, then text
    await cold.waitForPhase('route');
    await cold.setAdviserOpen(await cold.adviserHolders() + 1, 'p6f-f1a-limits');
    const held = await host.gates.modelRequest(adviser);
    await cold.submitContinuation('split', 'p6f-f1a-split');
    const first = await held.reached;
    expect(names(first)).not.toContain('create_member'); // the busy round is the P6 one: no create_member

    // A Goal with one Work task whose Role has no line; the opening adviser answers for it (goals/adviser-queue).
    const goal = (await cold.main.createGoal('p6f-f1a', 'P6F F1-a goal')).ref;
    const task = (await adoptS6BPlan(cold.main, goal,
      { label: 'p6f-f1a', taskIds: ['p6f-f1a-work'], role: S6A_WORK_ROLE.templateId })).tasks[0]!;
    const queue = valueOf<{ revision: number }>((await host.post('goals/adviser-queue', plain(S6A_SCOPE, {}))).body,
      'ready', 'the adviser queue');
    valueOf((await host.post('goals/adviser-queue/assign', graphWrite(S6A_SCOPE, { goalRef: goal,
      adviser: adviser.ref, expectedRevision: queue.revision }, 'p6f-f1a-adviser'))).body, 'committed', 'the assignment');
    const sent = await performSuggestion(host, await advanceUntil(host.ag2b, select(goal, 'p6f-f1a', task.taskId),
      'suggest_member'));
    expect(sent.recipient).toEqual(adviser.ref);
    await host.scripted.script(adviser, member('p6f-f1a-member', task));
    const before = await sessionIds(host);
    held.release();

    await cold.waitFor('the coarse round served both requests', async () =>
      (await host.scripted.requests(adviser)).length >= 2);
    const coarse = (await host.scripted.requests(adviser)).slice(0, 2);
    expect(coarse.map(says)).toEqual([false, false]); // F1 (1): not fed into the round without create_member
    const served = await heartbeatUntil(host, () => host.scripted.requests(adviser),
      requests => requests.some(request => request.messages.some(message =>
        message.role === 'tool' && message.callId === 'p6f-f1a-member')), 40);
    expect(served.length).toBeGreaterThan(2); // the next round on the line opened after the coarse round ended
    expect(names(served[2]!)).toContain('create_member');
    expect(says(served[2]!)).toBe(true);
    expect(jsonOf(served, 'p6f-f1a-member')).toMatchObject({ status: 'created' });
    await expectNewLineClaims(host, before, task);
  }, 300_000);

  it('F1-b: a suggestion round that built no line does not leave the Goal waiting on suggestion_committed', async () => {
    const opened = await openPLOverlapWorld({ firstRun: 'deferred' });
    closers.push(() => opened.close());
    const target = opened.world;
    const host = target.world, m2 = target.tasks[1]!;
    const input = select(target.goal, 'p6f-f1b', m2.taskId);
    const sent = await performSuggestion(host, await advanceUntil(host.ag2b, input, 'suggest_member'));
    await opened.script(opened.adviser, [{ kind: 'text', text: 'P6F F1-b: read, no line built' }]);
    expect((await awaitPlanningAnswer(host, sent.ref))?.job.job.status).toBe('answered');
    // The round could build (it carried create_member); it ended without a line.
    expect((await host.scripted.requests(opened.adviser)).map(names).flat()).toContain('create_member');
    const before = await sessionIds(host);

    const step = await advance(host.ag2b, input);
    expect(step.next, JSON.stringify(step)).toMatchObject({ kind: 'perform' }); // F1 (2): not an endless wait
    const operation = step.next?.kind === 'perform' ? step.next.operation.kind : null;
    expect(['host_pick_member', 'suggest_member']).toContain(operation);
    if (operation === 'host_pick_member') {
      await advance(host.ag2b, step.next!); // the Host pick's member card (shown at every autonomy)
      const waiting = (await target.main.readCards(target.goal)).filter(card =>
        card.source.kind === 'member_creation' && card.state === 'waiting_answer');
      expect(waiting).toHaveLength(1);
      const card = valueOf<DecisionCardV1>(await target.main.route('decisions/card', { source: waiting[0]!.source }),
        'ready', 'the member card');
      expect(await answer(host.ag2b, 'decisions/answer', graphWrite(S6A_SCOPE, { source: card.source,
        selection: { kind: 'option', optionId: 'approve' }, text: 'P6F F1-b approve', annotations: [] },
      'p6f-f1b-approve', card.source.pins))).toMatchObject({ status: 'ready', value: { answer: { status: 'committed' } } });
    } else {
      const again = await performSuggestion(host, step.next!);
      await opened.script(opened.adviser, member('p6f-f1b-member', m2));
      expect((await awaitPlanningAnswer(host, again.ref))?.job.job.status).toBe('answered');
    }
    await expectNewLineClaims(host, before, m2);
  });

  it('F1-c: the suggestion round asked for this member and the person refused its card: no Host pick, no second card', async () => {
    const opened = await openPLOverlapWorld({ firstRun: 'deferred' });
    closers.push(() => opened.close());
    const target = opened.world;
    const host = target.world, m2 = target.tasks[1]!;
    const input = select(target.goal, 'p6f-f1c', m2.taskId);
    const sent = await performSuggestion(host, await advanceUntil(host.ag2b, input, 'suggest_member'));
    // Every step needs the person, so the round's own create_member becomes a member card, not a line.
    await setS7AAutonomy(host, target.goal, 'every_step');
    await opened.script(opened.adviser, member('p6f-f1c-member', m2));
    expect((await awaitPlanningAnswer(host, sent.ref))?.job.job.status).toBe('answered');
    const memberCards = async () => (await target.main.readCards(target.goal))
      .filter(card => card.source.kind === 'member_creation');
    const [asked] = await memberCards();
    expect([asked?.state, (await memberCards()).length]).toEqual(['waiting_answer', 1]);
    const card = valueOf<DecisionCardV1>(await target.main.route('decisions/card', { source: asked!.source }),
      'ready', 'the member card');
    expect(await answer(host.ag2b, 'decisions/answer', graphWrite(S6A_SCOPE, { source: card.source,
      selection: { kind: 'option', optionId: 'reject' }, text: 'P6F F1-c reject', annotations: [] },
    'p6f-f1c-reject', card.source.pins))).toMatchObject({ status: 'ready', value: { answer: { status: 'committed' } } });
    const before = await sessionIds(host);

    // Hand-written: the round's own request stands (the person refused it), so the loop neither picks nor asks again.
    expect(await advance(host.ag2b, input)).toMatchObject({ state: 'waiting', next: null, receipt: null,
      reason: 'member_creation: the suggestion round asked for this member; no second request' });
    const cards = await memberCards();
    expect([cards.length, cards.filter(entry => entry.state === 'waiting_answer').length]).toEqual([1, 0]);
    expect(await sessionIds(host)).toEqual(before);
  });
});
