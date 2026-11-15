/**
 * G6F G3 (decision 121-131, `g6f-rulings.md` 补充裁定 F3a): in an initialized project, a no-goal request's goal card
 * is confirmed and an idea of the same round selected; the plan round's `submit_plan_round` becomes the NEW Goal's
 * request candidate, which a person adopts. World: the S6C request-candidate world (the S6A Host world with its
 * request driver, `initializeProject`); scripted secretary answers; public routes only; memory only (S3).
 *
 * Red today at the candidate wait: the Host's plan-turn table drops the round on the submit-time `job.job.goalId`
 * (null; host.ts:1431-1435, :1453) and the answer step refuses it the same way (initial-plan-answer.ts:346).
 * Mutation: the plan-turn path keeps using the submit-time goalId -> no candidate -> red.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { answeredRound, initializeProject, secretaryAnswer, threeIdeas } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { plToolPlanOf } from '../helpers/PL-workflow-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { firstPlan } from '../helpers/S7B-V-fixture.js';
import { waitFor } from './harness.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('G6F G3: a confirmed goal card and a selected idea give the new Goal its plan candidate', () => {
  it('G3: confirm-draft, select-idea, submit_plan_round -> plans/request-candidate of the new Goal -> plans/apply', async () => {
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
    worlds.push(world);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const first = await answeredRound(world, { session: a, answer: secretaryAnswer({ body: 'G6F G3 ideas',
      ideas: threeIdeas('g6f-g3'), goalCardDrafts: [{ objective: 'G6F G3 new Goal', completion: ['G6F G3 done'],
        autonomy: 'after_plan_confirmation', screening: null }] }),
    submit: { commandId: 'g6f-g3-request', goalId: null, text: 'G6F G3 new work', continues: null, recipient: a } });
    const answered = (await world.readRequest(first.requestRoot)).rounds
      .find(round => round.ref.queryJobId === first.round.queryJobId);
    expect(answered).toMatchObject({ goalCardDrafts: [expect.anything()], ideas: [{}, {}, {}] });
    const goal = committed<GoalConfirmDraftReceiptV1>(await world.post('goals/confirm-draft', plain(S6A_SCOPE, {
      commandId: 'g6f-g3-confirm', round: first.round, index: answered!.goalCardDrafts[0]!.index })), 'the card').goal.ref;

    const plan = (JSON.parse(firstPlan({ label: 'g6f-g3', taskId: 'g6f-g3-work', role: S6A_WORK_ROLE.templateId })) as
      { plan: Parameters<typeof plToolPlanOf>[0] }).plan;
    await world.scripted.script(a, [{ kind: 'calls', calls: [{ callId: 'g6f-g3-plan', name: 'submit_plan_round',
      args: { answerKind: 'plan', summary: 'G6F G3 summary', plan: plToolPlanOf(plan) } }] }]);
    const selected = await world.selectIdea({ commandId: 'g6f-g3-select', round: first.round, index: 0 });
    if (selected.status !== 'queued') throw new Error(`G3: the selection was refused: ${JSON.stringify(selected)}`);
    await world.waitForRequest(first.requestRoot, view => view.rounds.some(round =>
      round.ref.queryJobId === selected.followupRound.queryJobId && round.status === 'ended'), 'the plan round');
    expect((await world.scripted.requests(a)).at(-1)!.tools.map(tool => tool.name)).toContain('submit_plan_round');

    const read = await waitFor(async () => ready<{ head: PlanProposal | null }>(await world.post(
      'plans/request-candidate', plain(S6A_SCOPE, { goalRef: goal, requestRef: first.requestRoot })),
    'plans/request-candidate'), value => value.head !== null, 'the new Goal\'s request candidate');
    expect(read.head).toMatchObject({ goalRef: goal, requestRef: first.requestRoot, basedOn: null });
    const goalRead = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, goal)), 'goal');
    const adopted = await world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: read.head!.ref,
      expectedProposalRevision: read.head!.revision, decisionRefs: [] }, 'g6f-g3-apply',
    [{ ref: goal, revision: goalRead.goal.revision }]));
    expect(adopted.body).toMatchObject({ status: 'committed', value: { planRevision: 1 } });
  }, 180_000);
});
