/**
 * INT2 R2 rows (int2-rulings §3.1): an ordinary input-box sentence on a COMPLETED or ACCEPTED_PARTIAL Goal opens a
 * Goal-less request whose root sources that Goal, the Goal keeps its phase and completion, the same command replays
 * on the same root, and the secretary is told the main conversation (not the line) while an ended Goal was selected.
 *
 * State in this tree: R2 production is landed, so all six rows are green; at this tree's base only R2-3 was red (its
 * prior state used `satisfyBKDGoal`, which completes the Goal and makes the partial acceptance fail).
 * Named mutations (not run: the whitelist is tests-only): R2-1 `terminal.value.completed` -> `false`;
 * R2-2 `if (terminal.value.completed)` -> `if (true)`; R2-3 `completed` -> `goalListPhaseOf === 'COMPLETED'`;
 * R2-4 the fingerprint drops the original `goalId` (the explicit `goalId: null` then replays instead of conflicting);
 * R2-5 the source sentence always uses the line wording, or `initialDrafts` is added to `semantic_query`;
 * R2-6 it always uses the main-conversation wording.
 */
import { afterEach, expect, it } from 'vitest';
import type { MainPageV1 } from '../../src/core/work-graph/views/main-surface-read-model.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { acceptPartial, driveBKDWork, openBKDWorld } from '../helpers/BKD-world.js';
import { heartbeatUntil } from '../helpers/IV-host-fixture.js';
import { roundStatus, secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import {
  intAdoptFirstPlan, intOpenCompletedGoal, intStartNewGoalFromLine, intUserInputs,
} from '../helpers/INT-world.js';
import {
  int2GoalCompletion, int2GoalPhase, int2RequestView, int2SubmitEndedGoalRequest,
} from '../helpers/INT2-world.js';
import { openPLWorkflowWorld } from '../helpers/PL-workflow-fixture.js';

const TEXT = '再加一个导出';
const NEW_SOURCE = 'This request was made in the main conversation while an ended goal was selected';
const OLD_SOURCE = 'This request came from a message on the line';
/** `secretary.initialDrafts` (`strings.json:494`): the sentence only the `initial_coordination` format adds. */
const COLD_START = 'This request has no goal yet, so a plan answer needs at least one "goalCardDrafts" entry';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

it('INT2-R2-1 an ordinary input on a completed Goal opens a goal-less request sourced to it', async () => {
  // Green today: the request is goal-less with this Goal as its source.
  const { world, goal } = await intOpenCompletedGoal('int2-r2-1');
  closers.push(world.close);
  const completionBefore = await int2GoalCompletion(world, goal);
  const submitted = await int2SubmitEndedGoalRequest(world, { commandId: 'int2-r2-1', goal, text: TEXT });
  expect(submitted.status, 'the submit is queued').toBe('queued');
  const view = await int2RequestView(world, submitted.requestRoot);
  expect(view.rounds.find(round => round.ref.queryJobId === submitted.round.queryJobId)?.status,
    'the new round is queued').toBe('queued');
  expect(view.goalId, 'the request has no Goal').toBeNull();
  expect(view.effectiveGoalId, 'and no effective Goal').toBeNull();
  expect(view.source, 'the source is the ended Goal with no message').toEqual({ goalRef: goal, messageRef: null });
  expect(await int2GoalPhase(world, goal), 'the Goal is still COMPLETED').toBe('COMPLETED');
  expect(await int2GoalCompletion(world, goal), 'the Goal completion did not move').toEqual(completionBefore);
}, 180_000);

it('INT2-R2-2 a request on an unfinished Goal still hangs on that Goal', async () => {
  // Green today (guard): an open Goal still owns its ordinary input. Mutation: `if (terminal.value.completed)` -> `if (true)`.
  const opened = await openPLWorkflowWorld({ label: 'int2-r2-2' });
  closers.push(opened.close);
  await intAdoptFirstPlan(opened.world, opened.goal, { label: 'int2-r2-2', taskId: 'int2-r2-2-task' });
  const submitted = await int2SubmitEndedGoalRequest(opened.world,
    { commandId: 'int2-r2-2', goal: opened.goal, text: TEXT });
  const view = await int2RequestView(opened.world, submitted.requestRoot);
  expect(view.goalId, 'the request hangs on the open Goal').toBe(opened.goal.goalId);
  expect(view.source, 'and carries no source').toBeUndefined();
}, 180_000);

it('INT2-R2-3 a partially accepted Goal reroutes the same way', async () => {
  // Green today: ACCEPTED_PARTIAL still reroutes; the fixture now builds the partial state through PA-01.
  // BK-D PA-01's prior state: only `t-a` is done; `t-b` stays unclaimed so the partial acceptance commits.
  const bkd = await openBKDWorld('memory');
  closers.push(bkd.close);
  await driveBKDWork(bkd, 't-a');
  expect(await acceptPartial(bkd, { rationale: 't-b 先不做：外部接口没开放', requestId: 'int2-r2-3-accept' }),
    'the partial acceptance commits on the accepted part').toMatchObject({
    status: 'committed', value: { phase: 'ACCEPTED_PARTIAL' } });
  const completionBefore = await int2GoalCompletion(bkd.world, bkd.goal);
  const submitted = await int2SubmitEndedGoalRequest(bkd.world, { commandId: 'int2-r2-3', goal: bkd.goal, text: TEXT });
  const view = await int2RequestView(bkd.world, submitted.requestRoot);
  expect(view.goalId, 'the request has no Goal').toBeNull();
  expect(view.effectiveGoalId, 'and no effective Goal').toBeNull();
  expect(view.source, 'the source is the partially accepted Goal with no message')
    .toEqual({ goalRef: bkd.goal, messageRef: null });
  expect(await int2GoalPhase(bkd.world, bkd.goal), 'the Goal is still ACCEPTED_PARTIAL').toBe('ACCEPTED_PARTIAL');
  expect(await int2GoalCompletion(bkd.world, bkd.goal), 'the Goal completion did not move').toEqual(completionBefore);
}, 180_000);

it('INT2-R2-4 replaying the same submit returns the same goal-less root, listed once, and a changed body conflicts', async () => {
  // Green today: the no-goal view lists the rerouted root once; the added explicit-null submit conflicts.
  const { world, goal } = await intOpenCompletedGoal('int2-r2-4');
  closers.push(world.close);
  const first = await int2SubmitEndedGoalRequest(world, { commandId: 'int2-r2-4', goal, text: TEXT });
  const replay = await int2SubmitEndedGoalRequest(world, { commandId: 'int2-r2-4', goal, text: TEXT });
  expect(replay.requestRoot, 'the replay hits the same root').toEqual(first.requestRoot);
  // Same command id and text, but the explicit null Goal is a different command body: the stored fingerprint keeps
  // the original Goal, so this is a conflict, never a replay of the first receipt.
  expect(await world.submit({ commandId: 'int2-r2-4', goalId: null, text: TEXT, continues: null, recipient: null }),
    'an explicit goalId:null is a different fingerprint').toMatchObject({
    status: 'rejected', code: 'idempotency_conflict' });
  const page = ready<MainPageV1>(await world.post('main/read', plain(S6A_SCOPE, { goalId: null, cursor: null })),
    'main/read');
  expect(page.requests.filter(entry => entry.requestRoot.queryJobId === first.requestRoot.queryJobId),
    'the root is listed once in the no-goal view').toHaveLength(1);
}, 180_000);

it('INT2-R2-5 the secretary round says it came from the main conversation and gives ideas first', async () => {
  // Green today: the source sentence and its Goal label are in the governed input.
  const { world, goal, secretary } = await intOpenCompletedGoal('int2-r2-5');
  closers.push(world.close);
  const submitted = await int2SubmitEndedGoalRequest(world, { commandId: 'int2-r2-5', goal, text: TEXT });
  await world.scripted.script(secretary, [{ kind: 'text', text: secretaryAnswer({ body: 'INT2 R2-5 ideas',
    ideas: [{ title: 'INT2 R2-5 idea 1', detail: 'INT2 R2-5 detail 1' },
      { title: 'INT2 R2-5 idea 2', detail: 'INT2 R2-5 detail 2' }], goalCardDrafts: [] }) }]);
  if ((await claimWithSecretaryProfile(world, submitted.round, secretary, 'int2-r2-5-claim'))['status'] !== 'committed') {
    throw new Error('INT2-R2-5: the secretary did not claim the round');
  }
  const prepared = await prepareAttempt(world, submitted.round, 'int2-r2-5-prepare');
  if ((await start(world, prepared, 'int2-r2-5-start'))['status'] !== 'ready') {
    throw new Error('INT2-R2-5: the round did not start');
  }
  await heartbeatUntil(world, () => int2RequestView(world, submitted.requestRoot),
    view => roundStatus(view, submitted.round) === 'ended');
  const view = await int2RequestView(world, submitted.requestRoot);
  const round = view.rounds.find(entry => entry.ref.queryJobId === submitted.round.queryJobId);
  const input = intUserInputs(await world.scripted.requests(secretary)).at(-1) ?? '';
  const sourceLine = input.split('\n').find(line => line.startsWith(NEW_SOURCE)) ?? '';
  expect(sourceLine, 'the main-conversation source sentence names the source Goal').toContain(goal.goalId);
  expect(input, 'not the line wording').not.toContain(OLD_SOURCE);
  expect(round?.ideas, 'the two ideas are saved on the round').toHaveLength(2);
  expect(input, 'the governed round is not the cold-start format').not.toContain(COLD_START);
  expect(round?.goalCardDrafts, 'no Goal card in an ideas round').toEqual([]);
}, 180_000);

it('INT2-R2-6 a message on the line still uses the line wording', async () => {
  // Green today (guard): the line message keeps the old source sentence. Mutation: always the new wording.
  const { world, goal, secretary, workedLine } = await intOpenCompletedGoal('int2-r2-6');
  closers.push(world.close);
  await intStartNewGoalFromLine(world, { id: 'int2-r2-6', line: workedLine, goal, secretary,
    label: 'int2-r2-6', taskId: 'int2-r2-6-task' });
  const input = intUserInputs(await world.scripted.requests(secretary)).at(-1) ?? '';
  expect(input, 'the line wording').toContain(OLD_SOURCE);
  expect(input, 'no main-conversation wording').not.toContain(NEW_SOURCE);
}, 180_000);
