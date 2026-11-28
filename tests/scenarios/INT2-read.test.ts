/// <reference lib="dom" />
/**
 * INT2 read rows (int2-rulings §3.2, RD-1..RD-8): a Goal's main page carries the request that built it (甲),
 * the Goal-sourced requests still waiting for a Goal (乙), the old goal/pre rows and the complete `pendingSourceRequests`
 * count, with one global `(since desc, rootKey desc)` order and continuation. Every prior state is a public route
 * through the real Host (`openS6B3World`, `intOpenCompletedGoal`, `openBKDWorld`, `intStartNewGoalFromLine`); no store
 * is read and no record is built.
 *
 * State in this tree: R2 and the read model are landed, so RD-1/2/3/5/6/7 are green; at this tree's base only RD-4 was
 * red (the same `satisfyBKDGoal` fixture error as R2-3). RD-8 moved to `tests/ui/E3P-4c-plan.test.ts:79` (the two-page
 * Plan filter) and `tests/scenarios/INT2-c4.test.ts` (the C4 chain), so this file keeps seven rows.
 *
 * Named mutations (not run: the whitelist is tests-only):
 * - RD-1 page cards stop narrowing to the page's Goal: the other Goal's own card appears on this page. The second
 *   route of the same request (甲) is its 双绑定 row, so both pages carry the root while only one is the effective Goal.
 * - RD-2 乙 is not merged.
 * - RD-3 the 乙 scan drops `effectiveGoalId === null`: the confirmed request stays on the ended Goal's page.
 * - RD-4 the 乙 scan accepts only `COMPLETED` Goals (an `ACCEPTED_PARTIAL` Goal gets no source row).
 * - RD-5 only the `goal` slot is read from the cursor on (the second page misses the 甲 row).
 * - RD-6 an over-limit 乙 scan returns the truncated rows instead of `unavailable`.
 * - RD-7 `pendingSourceRequests` becomes `rows.length` / `step.shown.length` (the cursor page then says 1, not 21).
 */
import { afterEach, expect, it } from 'vitest';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import { compareCursors } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { ag2bChecksConfiguration, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { acceptPartial, driveBKDWork, openBKDWorld } from '../helpers/BKD-world.js';
import { intOpenCompletedGoal, intStartNewGoalFromLine } from '../helpers/INT-world.js';
import {
  int2AnswerWithGoalCard, int2CardGoalIds, int2GoalPhase, int2ReadPage, int2RequestView,
  int2SubmitEndedGoalRequest,
} from '../helpers/INT2-world.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { holdS6B3DraftAnswer, openS6B3World, releaseS6B3DraftAnswer } from '../helpers/S6B3-fixture.js';
import { setS7D1Open } from '../helpers/S7D1-allocation-world.js';
import { asRecord } from '../helpers/S6A-memory-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { heartbeatUntil } from '../helpers/IV-host-fixture.js';

const TEXT = '再加一个导出';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

it('INT2-RD-1 the request that made two Goals is on both pages, once, and a card belongs to its own Goal', async () => {
  // Green today: both pages carry the root, the second through its binding; the own-card half is added below.
  // The first page's one row (pre dedupe) is green today. Mutation: delete 甲, delete the rootKey dedupe, or stop
  // narrowing page cards to the page's Goal (the effective Goal's own card then leaks onto the other page).
  const world = await openS6B3World({ backend: 'memory' });
  closers.push(world.close);
  const held = await holdS6B3DraftAnswer(world, { scope: world.mainScope, label: 'int2-rd-1', drafts: 2 });
  expect((await releaseS6B3DraftAnswer(world, held)).drafts, 'the answer carries two cards').toHaveLength(2);
  const confirmCard = async (index: number) => committed<GoalConfirmDraftReceiptV1>(
    await world.host.post('goals/confirm-draft', plain(world.mainScope, {
      commandId: `int2-rd-1-confirm-${String(index)}`, round: held.round, index,
    })), `the card ${String(index)}`);
  const first = (await confirmCard(0)).goal.ref;
  const second = (await confirmCard(1)).goal.ref;
  expect(new Set([first.goalId, second.goalId]).size, 'the two cards made two Goals').toBe(2);

  const rootId = held.request.requestRoot.queryJobId;
  const firstPage = await int2ReadPage(world.host, { goalId: first.goalId });
  const secondPage = await int2ReadPage(world.host, { goalId: second.goalId });
  expect(firstPage.requests.filter(row => row.requestRoot.queryJobId === rootId),
    'the first-created Goal shows the creating request once (pre and 甲 deduped)').toHaveLength(1);
  expect(secondPage.requests.filter(row => row.requestRoot.queryJobId === rootId),
    'the second Goal shows the same request once through its binding').toHaveLength(1);

  // The request has one effective Goal; the other Goal still carries it as the request that made it (甲). An own card
  // on the effective Goal (an independent candidate, `plans/propose` with `requestRef: null`) must stay off the other
  // page: `pageCards` narrows the Goal-owned half to the page's Goal.
  const effective = firstPage.requests.find(row => row.requestRoot.queryJobId === rootId)?.effectiveGoalId;
  if (effective === undefined || effective === null) {
    throw new Error('INT2-RD-1: one of the two Goals is the request\'s effective Goal');
  }
  const own = effective === first.goalId ? first : second;
  const other = effective === first.goalId ? second : first;
  await s6aCardsWorkspace(world.host, S6A_SCOPE).proposeCandidate({
    label: 'int2-rd-1-own', goal: own, request: null,
  });
  const ownPage = await int2ReadPage(world.host, { goalId: own.goalId });
  const otherPage = await int2ReadPage(world.host, { goalId: other.goalId });
  const ownCards = ownPage.cards.filter(card => card.subject.kind === 'goal'
    && card.subject.goalRef.goalId === own.goalId && card.requestRef === null).map(card => card.cardKey);
  expect(ownCards.length, 'the effective Goal lists its own card').toBeGreaterThan(0);
  const otherKeys = otherPage.cards.map(card => card.cardKey);
  for (const key of ownCards) {
    expect(otherKeys, 'the other Goal does not carry the effective Goal\'s own card').not.toContain(key);
  }
}, 180_000);

it('INT2-RD-2 an ended Goal\'s page carries its unconfirmed source request', async () => {
  // Green today: the ended Goal's page carries the unconfirmed source request with `effectiveGoalId:null`.
  // This row keeps the request unconfirmed, so it catches only a missing 乙 merge; RD-3 owns the owned-goal filter.
  // Mutation: drop 乙.
  const { world, goal, secretary } = await intOpenCompletedGoal('int2-rd-2');
  closers.push(world.close);
  const submitted = await int2SubmitEndedGoalRequest(world, { commandId: 'int2-rd-2', goal, text: TEXT });
  await int2AnswerWithGoalCard(world, { label: 'int2-rd-2', submitted, secretary });
  const page = await int2ReadPage(world, { goalId: goal.goalId });
  const row = page.requests.find(entry => entry.requestRoot.queryJobId === submitted.requestRoot.queryJobId);
  expect(row, 'the first page carries the source request').toBeDefined();
  expect(row?.effectiveGoalId, 'the request is still unassigned').toBeNull();
  expect(row?.source, 'the request names the ended Goal and no message').toEqual({ goalRef: goal, messageRef: null });
}, 180_000);

it('INT2-RD-3 after confirmation the request belongs only to the new Goal', async () => {
  // Green today: after confirmation Goal 1 drops the request and the new Goal keeps it once.
  // Mutation: the 乙 scan drops its `effectiveGoalId === null` filter, so the confirmed request stays on Goal 1's page.
  // The card ownership mutation lives in RD-1's 双绑定 world.
  const { world, goal, secretary } = await intOpenCompletedGoal('int2-rd-3');
  closers.push(world.close);
  const submitted = await int2SubmitEndedGoalRequest(world, { commandId: 'int2-rd-3', goal, text: TEXT });
  const { newGoal } = await int2AnswerWithGoalCard(world, { label: 'int2-rd-3', submitted, secretary,
    confirm: { commandId: 'int2-rd-3-confirm' } });
  if (newGoal === null) throw new Error('INT2-RD-3: the card made no Goal');
  const goalPage = await int2ReadPage(world, { goalId: goal.goalId });
  expect(goalPage.requests.find(entry => entry.requestRoot.queryJobId === submitted.requestRoot.queryJobId),
    'Goal 1 no longer lists the confirmed request').toBeUndefined();
  const newPage = await int2ReadPage(world, { goalId: newGoal.goalId });
  expect(newPage.requests.map(row => row.requestRoot.queryJobId), 'the new Goal lists exactly its creating request')
    .toEqual([submitted.requestRoot.queryJobId]);
  expect(newPage.requests[0]?.effectiveGoalId, 'as a 甲 row the request now belongs to the new Goal')
    .toBe(newGoal.goalId);
  const newOwners = int2CardGoalIds(newPage);
  expect(newOwners.every(owner => owner === null || owner === newGoal.goalId),
    'every new-page card is the new Goal\'s, or the project\'s').toBe(true);
  expect(newOwners, 'no card of the new page belongs to Goal 1').not.toContain(goal.goalId);
  expect(int2CardGoalIds(goalPage), 'Goal 1 keeps no card of the new Goal').not.toContain(newGoal.goalId);
}, 180_000);

it('INT2-RD-4 a partially accepted Goal reads the same way', async () => {
  // Green today: the ACCEPTED_PARTIAL Goal reads the source row, then drops it after confirmation.
  // BK-D PA-01's prior state: only `t-a` is done; `t-b` stays unclaimed so the partial acceptance commits.
  // Mutation: the 乙 scan accepts only COMPLETED Goals (the partially accepted Goal gets no source row).
  const bkd = await openBKDWorld('memory');
  closers.push(bkd.close);
  await driveBKDWork(bkd, 't-a');
  expect(await acceptPartial(bkd, { rationale: 't-b 先不做：外部接口没开放', requestId: 'int2-rd-4-accept' }),
    'the partial acceptance commits on the accepted part').toMatchObject({
    status: 'committed', value: { phase: 'ACCEPTED_PARTIAL' } });
  const secretary = await bkd.world.createSecretary('int2-rd-4-secretary');
  const limits = ready<{ revision: number }>(await bkd.world.post('projects/role-limits',
    plain(S6A_SCOPE, { projectRef: { projectId: S6A_SCOPE.projectId } })), 'projects/role-limits');
  await setS7D1Open(bkd.world, 'secretary', 4, limits.revision, 'int2-rd-4-open');
  const submitted = await int2SubmitEndedGoalRequest(bkd.world, { commandId: 'int2-rd-4', goal: bkd.goal, text: TEXT });

  const before = (await int2ReadPage(bkd.world, { goalId: bkd.goal.goalId })).requests
    .find(entry => entry.requestRoot.queryJobId === submitted.requestRoot.queryJobId);
  expect(before?.effectiveGoalId, 'the unconfirmed request is unassigned').toBeNull();
  expect(before?.source, 'and sources the partially accepted Goal').toEqual({ goalRef: bkd.goal, messageRef: null });

  const { newGoal } = await int2AnswerWithGoalCard(bkd.world, { label: 'int2-rd-4', submitted, secretary,
    confirm: { commandId: 'int2-rd-4-confirm' } });
  if (newGoal === null) throw new Error('INT2-RD-4: the card made no Goal');
  const goalPage = await int2ReadPage(bkd.world, { goalId: bkd.goal.goalId });
  expect(goalPage.requests.find(entry => entry.requestRoot.queryJobId === submitted.requestRoot.queryJobId),
    'the partially accepted Goal no longer lists the confirmed request').toBeUndefined();
  const newPage = await int2ReadPage(bkd.world, { goalId: newGoal.goalId });
  expect(newPage.requests.map(row => row.requestRoot.queryJobId), 'the new Goal lists its creating request')
    .toEqual([submitted.requestRoot.queryJobId]);
  const newOwners = int2CardGoalIds(newPage);
  expect(newOwners.every(owner => owner === null || owner === newGoal.goalId),
    'every new-page card is the new Goal\'s, or the project\'s').toBe(true);
  expect(newOwners, 'no card of the new page belongs to the partially accepted Goal').not.toContain(bkd.goal.goalId);
  expect(int2CardGoalIds(goalPage), 'the partially accepted Goal keeps no card of the new Goal')
    .not.toContain(newGoal.goalId);
}, 180_000);

it('INT2-RD-5 the three reachable routes page without a repeat or a miss', async () => {
  // Green today: the page reads the source and 甲 routes; the second page must carry the 甲 row.
  // Mutation: only the `goal` slot is read from the cursor on (the second page misses the 甲 `bound` row). The other
  // `after` mutation (the cursor phase only) needs a page that ends in `pre`; `tests/app/S6A-main-read.test.ts:208-241`
  // is that existing pre continuation, because `pre` exists only when the selected Goal is the workspace's first.
  // This page's reachable routes are `source` (newest), `goal`, `bound` (oldest); the last shown row is a `goal` row.
  const { world, goal: ended, secretary, workedLine } = await intOpenCompletedGoal('int2-rd-5');
  closers.push(world.close);
  // A card-confirmed Goal's first plan starts its driver; the world's own Work line answers that auto-started Run, and
  // the real Workflow completes the Goal once the run verifies. The 21 own requests go in while the Goal is still open.
  world.platform.registerCheckConfiguration({ configuration: ag2bChecksConfiguration({
    actor: world.ag2b.actor, command: 'true' }) });
  const lineCard = await world.readSession(workedLine);
  await world.scripted.script({ label: workedLine.sessionId, ref: workedLine, aggregateRef: lineCard.record.ref,
    role: lineCard.record.role, createdAt: lineCard.record.createdAt }, [{ kind: 'text', text: 'INT2 RD-5 work' }]);
  const created = await intStartNewGoalFromLine(world, { id: 'int2-rd-5', line: workedLine, goal: ended,
    secretary, label: 'int2-rd-5', taskId: 'int2-rd-5-task' });
  const goal = created.newGoal;
  const own: QueryJobRef[] = [];
  for (let index = 0; index < 21; index += 1) {
    const queued = await world.submit({ commandId: `int2-rd-5-own-${String(index)}`, goalId: goal.goalId,
      text: `INT2 RD-5 own ${String(index)}`, continues: null });
    if (queued.status !== 'queued') throw new Error(`INT2-RD-5: own submit ${String(index)} was refused`);
    own.push(queued.requestRoot);
  }
  await heartbeatUntil(world, () => int2GoalPhase(world, goal), phase => phase === 'COMPLETED', 60);
  const source = await int2SubmitEndedGoalRequest(world, { commandId: 'int2-rd-5-source', goal, text: TEXT });

  const firstPage = await int2ReadPage(world, { goalId: goal.goalId });
  expect(firstPage.requests, 'the first page is full').toHaveLength(20);
  expect(firstPage.next, 'and continues').not.toBeNull();
  // The continuation names the last shown row's phase; with this world's `since` order that row is a `goal` row, so
  // the frozen `'source'` literal is not constructible (F2 records the mismatch).
  const lastShown = firstPage.requests.at(-1)!;
  const phaseOf = (root: QueryJobRef) => root.queryJobId === source.requestRoot.queryJobId ? 'source'
    : root.queryJobId === created.root.queryJobId ? 'bound' : 'goal';
  expect(firstPage.next?.phase, 'the cursor names the last shown row\'s phase')
    .toBe(phaseOf(lastShown.requestRoot));
  const secondPage = await int2ReadPage(world, { goalId: goal.goalId, cursor: firstPage.next });
  const shown = [...firstPage.requests, ...secondPage.requests];
  expect(shown, 'two pages cover all three reachable routes').toHaveLength(23);
  expect([...new Set(shown.map(row => phaseOf(row.requestRoot)))].sort(), 'the shown rows name goal, bound and source')
    .toEqual(['bound', 'goal', 'source']);
  expect(new Set(shown.map(row => row.requestRoot.queryJobId)).size, 'no root repeats').toBe(23);
  const expected = [...own.map(root => root.queryJobId), source.requestRoot.queryJobId, created.root.queryJobId];
  expect(shown.map(row => row.requestRoot.queryJobId).sort(), 'every expected root is shown').toEqual(expected.sort());
  const sinces = [];
  for (const row of shown) sinces.push((await int2RequestView(world, row.requestRoot)).rounds[0]!.since);
  for (let index = 1; index < sinces.length; index += 1) {
    expect(compareCursors(sinces[index - 1]!, sinces[index]!), 'the two pages are one (since desc) order')
      .toBeGreaterThan(0);
  }
}, 180_000);

it('INT2-RD-6 more than 400 source roots reject the page instead of truncating it', async () => {
  // Green today: the read scans the no-goal slot and rejects over the 400 bound.
  // Mutation: an over-limit scan returns the truncated rows instead of `unavailable`.
  const { world, goal } = await intOpenCompletedGoal('int2-rd-6');
  closers.push(world.close);
  for (let index = 0; index < 401; index += 1) {
    const answer = asRecord((await world.post('requests/submit', plain(S6A_SCOPE, {
      commandId: `int2-rd-6-${String(index)}`, goalId: null, text: `INT2 RD-6 ${String(index)}`,
      continues: null, recipient: null, references: [],
    }))).body);
    if (answer['status'] !== 'queued') {
      throw new Error(`INT2-RD-6: the goal-less submit ${String(index)} was refused: ${JSON.stringify(answer)}`);
    }
  }
  const answer = asRecord((await world.post('main/read', plain(S6A_SCOPE,
    { goalId: goal.goalId, cursor: null }))).body);
  expect(answer['status'], 'the page is rejected, not silently cut').toBe('rejected');
  expect(answer['code'], 'because it cannot read all source roots').toBe('unavailable');
  expect(String(answer['reason']), 'and names the 400 bound').toContain('400');
}, 180_000);

it('INT2-RD-7 a full first page and its continuation still count all 21 source requests', async () => {
  // Green today: the 21 source rows and `pendingSourceRequests` are read; the cursor page must still say 21.
  // Mutation: `pendingSourceRequests` becomes `rows.length` / `step.shown.length`: with no cursor that is 21, but on the
  // cursor page the filtered rows are 1, so the second read must still say 21.
  const { world, goal } = await intOpenCompletedGoal('int2-rd-7');
  closers.push(world.close);
  for (let index = 0; index < 21; index += 1) {
    await int2SubmitEndedGoalRequest(world, { commandId: `int2-rd-7-${String(index)}`, goal,
      text: `INT2 RD-7 ${String(index)}` });
  }
  const page = await int2ReadPage(world, { goalId: goal.goalId });
  expect(page.requests, 'the first page is full').toHaveLength(20);
  expect(page.next, 'and continues').not.toBeNull();
  expect(page.pendingSourceRequests, 'the count is the whole 21, not the shown page (the task map reads this field)')
    .toBe(21);
  const second = await int2ReadPage(world, { goalId: goal.goalId, cursor: page.next });
  expect(second.requests, 'the continuation carries the last source row').toHaveLength(1);
  expect(second.pendingSourceRequests, 'the cursor page still counts all 21, not its one filtered row')
    .toBe(21);
  const shown = [...page.requests, ...second.requests];
  expect(shown, 'the two pages hold all 21 source requests').toHaveLength(21);
  expect(new Set(shown.map(row => row.requestRoot.queryJobId)).size, 'no root repeats').toBe(21);
}, 180_000);
