/**
 * INT2 C4 rows (补充裁定 C4, 11-27; C4-2 test world 11-28): the R2 chain after the person picks an idea, from the
 * card round to the first candidate. Only public entries: `requests/submit` as the row's prior state,
 * `requests/select-idea`, `goals/confirm-draft`, `main/read`, `plans/request-candidate`, and the Host's own round
 * lifecycle. C4-1 drives that lifecycle by hand; C4-2 opens its world with `requestDriver: 'on'` (as
 * `G6F-new-goal-plan-round.test.ts:30` does) and lets the driver claim/prepare/start every round, because the Host
 * writes a request candidate only when the request driver is on (`host.ts:1691`, `host.ts:2036`).
 *
 * Both rows are green on this tree today (`s97dint2s2` + the INT2B2 production): C4-1's selected-idea follow-up is a
 * secretary round that answers the Goal card, and the confirm queues one planning round on the same root whose
 * `submit_plan_round` answer becomes the new Goal's request candidate.
 */
import { afterEach, expect, it } from 'vitest';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { intOpenCompletedGoal } from '../helpers/INT-world.js';
import {
  int2AnswerWithGoalCard, int2ReadPage, int2SubmitEndedGoalRequest,
} from '../helpers/INT2-world.js';
import { plToolPlanOf } from '../helpers/PL-workflow-fixture.js';
import { roundStatus, secretaryAnswer, submitRound } from '../helpers/S6A-history-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { firstPlan } from '../helpers/S7B-V-fixture.js';
import { waitFor } from './harness.js';

const TEXT = '再加一个导出';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

/** R2-1's ended Goal, the idea answer and the selected follow-up; used by C4-1. */
async function openSelectedIdea(label: string) {
  const { world, goal, secretary } = await intOpenCompletedGoal(label);
  closers.push(world.close);
  const submitted = await int2SubmitEndedGoalRequest(world, { commandId: label, goal, text: TEXT });
  await int2AnswerWithGoalCard(world, { label: `${label}-ideas`, submitted, secretary, ideas: true, card: false });
  const selected = await world.selectIdea({ commandId: `${label}-select`, round: submitted.round, index: 0 });
  if (selected.status !== 'queued') throw new Error(`INT2 ${label}: the idea selection was refused: ${JSON.stringify(selected)}`);
  return { world, secretary, submitted, followup: selected.followupRound };
}

it('INT2-C4-1 after an idea is selected the next round answers a Goal card and the confirmation creates a Goal', async () => {
  // Green today on this tree: the follow-up is a secretary round that answers the Goal card.
  // Mutation: `r2AwaitingCard` never holds (the `planTurn` rule stays for the selected-idea follow-up): the card is
  // dropped, so the confirmation has nothing and this row reds at `answered 0 Goal cards`.
  const { world, secretary, submitted, followup } = await openSelectedIdea('int2-c4-1');
  const { cardIndex, newGoal } = await int2AnswerWithGoalCard(world, {
    label: 'int2-c4-1-card', submitted, secretary, round: followup,
    confirm: { commandId: 'int2-c4-1-confirm' },
  });
  expect(cardIndex, 'the follow-up round saved one Goal card').not.toBeNull();
  expect(newGoal, 'confirming it creates the new Goal').not.toBeNull();
  if (newGoal === null) throw new Error('INT2-C4-1: the confirmation created no Goal');
  const page = await int2ReadPage(world, { goalId: newGoal.goalId });
  const row = page.requests.find(entry => entry.requestRoot.queryJobId === submitted.requestRoot.queryJobId);
  const confirmed = row?.rounds.find(round => round.ref.queryJobId === followup.queryJobId)
    ?.goalCardDrafts.find(draft => draft.index === cardIndex);
  expect(confirmed?.confirmedGoalRef, 'the saved card names the Goal the confirmation created').toEqual(newGoal);
}, 180_000);

it('INT2-C4-2 confirming the card schedules one planning round on the same root, whose answer is the candidate', async () => {
  // Green today on this tree: the request driver ends the planning round, so the Host writes the candidate.
  // Mutation: remove the follow-up scheduling at the confirm exit in `create-platform.ts` (today's pre-C4.2
  // behavior), or change its derived command id so a replay adds a second round; the planning-round wait or the
  // one-planning-round count reds.
  const { world, goal, secretary } = await intOpenCompletedGoal('int2-c4-2', { requestDriver: 'on' });
  closers.push(world.close);
  const plan = (JSON.parse(firstPlan({ label: 'int2-c4-2', taskId: 'int2-c4-2-work',
    role: S6A_WORK_ROLE.templateId })) as { plan: Parameters<typeof plToolPlanOf>[0] }).plan;
  // The driver consumes these in round order: the ideas round, the card round the selection queues, then the
  // planning round the confirmation queues. No claim/prepare/start: the driver owns them.
  await world.scripted.script(secretary, [
    { kind: 'text', text: secretaryAnswer({ body: 'INT2 C4-2 ideas',
      ideas: [{ title: 'INT2 C4-2 idea 1', detail: 'INT2 C4-2 detail 1' },
        { title: 'INT2 C4-2 idea 2', detail: 'INT2 C4-2 detail 2' }], goalCardDrafts: [] }) },
    { kind: 'text', text: secretaryAnswer({ body: 'INT2 C4-2 card', goalCardDrafts: [
      { objective: 'INT2 C4-2 Goal', completion: ['INT2 C4-2 done'],
        autonomy: 'after_plan_confirmation', screening: null }] }) },
    { kind: 'calls', calls: [{ callId: 'int2-c4-2-plan', name: 'submit_plan_round',
      args: { answerKind: 'plan', summary: 'INT2 C4-2 summary', plan: plToolPlanOf(plan) } }] },
  ]);
  // R2's ordinary input on the ended Goal, addressed to the secretary whose queue the driver consumes (the same `@`
  // the G6F/G7 worlds use; the frozen no-recipient body belongs to the rows that claim by hand).
  const submitted = await submitRound(world, { commandId: 'int2-c4-2', goalId: goal.goalId, text: TEXT,
    continues: null, recipient: secretary });
  const ideas = await world.waitForRequest(submitted.requestRoot,
    view => roundStatus(view, submitted.round) === 'ended', 'the ideas round');
  expect(ideas.rounds.find(round => round.ref.queryJobId === submitted.round.queryJobId)?.ideas,
    'the prior round answered the two ideas').toHaveLength(2);
  const selected = await world.selectIdea({ commandId: 'int2-c4-2-select', round: submitted.round, index: 0 });
  if (selected.status !== 'queued') {
    throw new Error(`INT2-C4-2: the idea selection was refused: ${JSON.stringify(selected)}`);
  }
  const followup = selected.followupRound;
  const cardView = await world.waitForRequest(submitted.requestRoot, view => {
    const round = view.rounds.find(entry => entry.ref.queryJobId === followup.queryJobId);
    return round !== undefined && round.status === 'ended' && round.goalCardDrafts.length === 1;
  }, 'the card round');
  const card = cardView.rounds.find(round => round.ref.queryJobId === followup.queryJobId)!.goalCardDrafts[0]!;
  const confirmed = committed<GoalConfirmDraftReceiptV1>(await world.post('goals/confirm-draft', plain(S6A_SCOPE, {
    commandId: 'int2-c4-2-confirm', round: followup, index: card.index,
  })), 'the Goal card');
  const newGoal = confirmed.goal.ref;

  const planned = await world.waitForRequest(submitted.requestRoot, view => view.rounds.some(round =>
    round.kind === 'followup' && round.ref.queryJobId !== submitted.round.queryJobId
    && round.ref.queryJobId !== followup.queryJobId && round.status === 'ended'),
  'the planning round the confirmation schedules');
  const planning = planned.rounds.find(round => round.kind === 'followup'
    && round.ref.queryJobId !== submitted.round.queryJobId && round.ref.queryJobId !== followup.queryJobId);
  if (planning === undefined) throw new Error('INT2-C4-2: the confirmation scheduled no planning round');

  const candidate = await waitFor(async () => ready<{ head: PlanProposal | null }>(await world.post(
    'plans/request-candidate', plain(S6A_SCOPE, { goalRef: newGoal, requestRef: submitted.requestRoot })),
  'plans/request-candidate'), value => value.head !== null, 'the new Goal\'s candidate');
  expect(candidate.head).toMatchObject({ goalRef: newGoal, requestRef: submitted.requestRoot });

  // Replaying the same confirmation command must find the round already scheduled and add no second one.
  const replayed = committed<GoalConfirmDraftReceiptV1>(await world.post('goals/confirm-draft', plain(S6A_SCOPE, {
    commandId: 'int2-c4-2-confirm', round: followup, index: card.index,
  })), 'the replayed Goal card');
  expect(replayed.goal.ref, 'the replay names the same Goal').toEqual(newGoal);
  const after = await world.readRequest(submitted.requestRoot);
  const planningRounds = after.rounds.filter(round => round.kind === 'followup'
    && round.ref.queryJobId !== submitted.round.queryJobId && round.ref.queryJobId !== followup.queryJobId);
  expect(planningRounds.map(round => round.ref.queryJobId), 'one planning round before and after the replay')
    .toEqual([planning.ref.queryJobId]);
}, 180_000);
