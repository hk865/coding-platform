/**
 * K3L-1 acceptance V1–V3 and V5–V7 (k3l1-start-rulings-1112 item 5): an unknown-call record goes to the adviser
 * first and reaches the person only on an escalation cause. Every record is the public K3 chain over
 * `openK3ReviewCardWorld` (memory); cards come from the review card source, V1 reads the decision queue.
 * Shapes as the builder's thin contract (k3l1-contract §2): `settleReview` takes `input.adviserAvailable`; the record
 * carries `escalation.cause`; `escalateReview(ctx, { input: { reviewRef, cause, suggestion }, meta })` is written
 * under the Workflow automation actor, `suggestion` being an `UnknownCallAdviceV1`
 * (`{ phase, choice, escalationKind, rationale, plain }`) or null; the follow_suggestion option is the card's first option.
 * A1 (after the named-mutation run): an approval-phase suggestion never puts follow_suggestion on the approval card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { UnknownCallAdviceV1 } from '../../src/contracts/unknown-call-advice.js';
import type { UnknownCallEscalationCauseV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { blockedRecordWithClaim, requeueBlockedRecord } from '../helpers/B2-crr-world.js';
import {
  claimK3ReviewRound, createK3PendingReview, endK3RunCompleted, openK3ReviewCardWorld, reachK3AwaitingProposal,
  readK3ReviewCard, recordK3Conclusion, settleK3Review, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]) =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

const TECHNICAL = ['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself'];
const options = (labels: string[]) => TECHNICAL.map((id, index) => ({ id, label: labels[index] }));
const todayOptions = options(['照原样重跑', '换个稳妥的跑法再跑', '跳过，当作已做', '我来处理']);
const secondLayerOptions = options(['照原样重跑', '换个稳妥的跑法再跑', '跳过，当作已做', '先暂停这项任务']);

async function openWorld(realKernelCommandFacts = false): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld('memory', { realKernelCommandFacts });
  worlds.push(world);
  return world;
}

async function settled(world: K3ReviewCardWorld, adviserAvailable: boolean,
  how: 'partial' | 'unavailable' = 'unavailable', command?: string): Promise<UnknownCallReviewV1> {
  const pending = await createK3PendingReview(world, command === undefined ? {} : { command });
  if (how === 'unavailable') return await settleK3Review(world, pending, { cause: 'review_unavailable', adviserAvailable });
  const round = await claimK3ReviewRound(world, pending);
  const concluded = await recordK3Conclusion(world, round, { item: 1, verdict: 'partial', evidence: 'half of it ran',
    crashSuspicion: { verdict: 'unlikely', evidence: 'no crash trace' } });
  await endK3RunCompleted(world, round.claim);
  return await settleK3Review(world, concluded, { adviserAvailable });
}

async function waitingCards(world: K3ReviewCardWorld): Promise<DecisionCardV1[]> {
  const read = await world.readModel.queryDecisionQueue(world.fixture.ctx, { workspace: WORKSPACE_SCOPE,
    sections: ['waiting_answer'], page: { limit: 100 } });
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  return read.value.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
}

const liveCard = async (world: K3ReviewCardWorld, record: UnknownCallReviewV1) =>
  (await readK3ReviewCard(world, record)).card;
const optionsOf = (card: DecisionCardV1) => card.options.map(({ id, label }) => ({ id, label }));
const firstLine = (card: DecisionCardV1) => (card.objects[0]?.label ?? '').split('\n')[0];

async function escalate(world: K3ReviewCardWorld, record: UnknownCallReviewV1, cause: UnknownCallEscalationCauseV1,
  suggestion: UnknownCallAdviceV1 | null) {
  return await world.reviews.escalateReview({ ...world.fixture.ctx,
    principal: { kind: 'host', actor: { ...WORKFLOW_AUTOMATION_ACTOR } } }, {
    input: { reviewRef: record.ref, cause, suggestion },
    meta: { requestId: `k3l1-escalate-${cause}`, expected: [{ ref: record.ref, revision: record.revision }] } });
}

async function setEveryStep(world: K3ReviewCardWorld): Promise<void> {
  const goal = await world.fixture.b2.base.plans.queryGoal(world.fixture.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal is not readable: ${JSON.stringify(goal)}`);
  const result = await world.goalSettings.setGoalSettings(world.fixture.ctx, { input: {
    goalRef: GOAL_B, autonomy: 'every_step', waitForGoalRef: null,
  }, meta: { requestId: 'k3l1-every-step', expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (result.status !== 'committed') throw new Error(`every_step was not set: ${JSON.stringify(result)}`);
}

describe('K3L-1 the adviser first, the person second', () => {
  // V1 mutation: routeOf sends a first partial to the person although an adviser exists; red today: :93 (the record is needs_decision)
  it('V1: a first partial with an adviser waits for advice and puts no card in the queue', async () => {
    const world = await openWorld();
    const record = await settled(world, true, 'partial');
    expect(record.status).toBe('awaiting_advice');
    expect(await waitingCards(world)).toEqual([]);
  }, 120_000);

  // V2 mutation: settleReview writes no escalation{no_adviser} and keeps today's card; red today: :101 (no escalation), the first-line check :110 is red on its own
  it('V2: with no adviser the partial reaches the person with no_adviser, the pause label and one plain first line', async () => {
    const world = await openWorld();
    const record = await settled(world, false, 'partial');
    expect(record).toMatchObject({ status: 'needs_decision', decisionReasons: ['partial'],
      escalation: { cause: 'no_adviser' } });
    const card = await liveCard(world, record);
    expect(optionsOf(card)).toEqual(secondLayerOptions);
    const other = await liveCard(world, await settled(world, false, 'unavailable', 'echo another command'));
    await setEveryStep(world);
    const person = await liveCard(world, await settled(world, true));
    expect(firstLine(card)).not.toContain('npm run build');
    expect(firstLine(card)).toBe(firstLine(other));
    expect(firstLine(card)).not.toBe(firstLine(person));
  }, 120_000);

  // V3 mutation (adviser true): routeOf sends every_step to the adviser; (adviser false): no_adviser is written on a person-route record; green today
  it.each([true, false])('V3 (adviser %s): every_step goes straight to the person with today\'s four options', async adviser => {
    const world = await openWorld();
    await setEveryStep(world);
    const record = await settled(world, adviser);
    expect(record).toMatchObject({ status: 'needs_decision' });
    expect(record.escalation ?? null).toBeNull();
    expect(optionsOf(await liveCard(world, record))).toEqual(todayOptions);
  }, 120_000);

  // V5 mutation: follow_suggestion is applied as the first option, not as the suggested one; red today: :132 (the record is needs_decision)
  it('V5: a second consecutive interruption asks the adviser first, then the person follows the suggestion once', async () => {
    const world = await openWorld(true);
    const first = await blockedRecordWithClaim(world, 'k3-20-a', 'k3l1-v5-a', [{ callId: 'k3l1-v5-a', command: 'echo a' }]);
    const requeue = await requeueBlockedRecord(world, first.claim, 'K3L-1 V5 second Run');
    const second = await blockedRecordWithClaim(world, 'k3-20-a', 'k3l1-v5-b',
      [{ callId: 'k3l1-v5-b', command: 'echo b' }], { requeue: requeue.ref, dispose: false });
    expect(second.record.streak.priorUnknownProcess).toBe(true);
    const advised = await settleK3Review(world, second.record, { cause: 'review_unavailable', adviserAvailable: true });
    expect(advised.status).toBe('awaiting_advice');
    const escalated = await escalate(world, advised, 'second_consecutive',
      { phase: 'disposition', choice: 'skip_as_done', escalationKind: null, rationale: 'b already ran',
        plain: '这一步其实已经做完了' });
    expect(escalated).toMatchObject({ status: 'committed', value: { status: 'needs_decision',
      escalation: { cause: 'second_consecutive' } } });
    if (escalated.status !== 'committed') return;
    const card = await liveCard(world, escalated.value);
    expect(card.options.map(option => option.id)).toEqual(['follow_suggestion', ...TECHNICAL]);
    expect(card.options[0]?.label).toMatch(/^照建议/);
    expect(card.options[4]?.label).toBe('先暂停这项任务');
    const follow = { input: { source: card.source, selection: { kind: 'option' as const, optionId: 'follow_suggestion' },
      text: '', annotations: [] }, meta: { requestId: 'k3l1-v5-follow', expected: card.source.pins } };
    const followed = await world.decisionActions.resolveDecision(world.fixture.ctx, follow);
    expect(followed).toMatchObject({ status: 'ready', value: { state: 'applied', action: { status: 'committed',
      replayed: false, value: { status: 'resolved', disposition: { choice: 'skip_as_done', source: 'card',
        appliedBy: world.fixture.operatorActor } } } } });
    if (followed.status !== 'ready') return;
    const replayed = await world.decisionActions.resolveDecision(world.fixture.ctx, follow);
    expect(replayed).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (replayed.status !== 'ready') return;
    expect(replayed.value.action).toEqual({ ...followed.value.action, replayed: true });
    expect(await world.decisionActions.resolveDecision(world.fixture.ctx, { ...follow, input: { ...follow.input,
      selection: { kind: 'option' as const, optionId: 'skip_as_done' } } })).toMatchObject({ status: 'rejected' });
  }, 180_000);

  // V6 mutation: the "I'll handle it" states leave out awaiting_advice; red today: :162 (the record is needs_decision)
  it('V6: "I\'ll handle it" applies while the record waits for advice', async () => {
    const world = await openWorld();
    const record = await settled(world, true);
    expect(record.status).toBe('awaiting_advice');
    const held = await world.reviews.holdReview(world.fixture.ctx, { input: { reviewRef: record.ref, text: null },
      meta: { requestId: 'k3l1-v6-hold', expected: [{ ref: record.ref, revision: record.revision }] } });
    expect(held).toMatchObject({ status: 'committed', value: { revision: record.revision + 1, status: 'resolved',
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } } });
  }, 120_000);

  // V7 mutation: an escalation without a suggestion still offers follow_suggestion; red today: :172 (escalateReview is not a function)
  it('V7: a failed adviser round reaches the person with no follow_suggestion', async () => {
    const world = await openWorld();
    const escalated = await escalate(world, await settled(world, true), 'adviser_failed', null);
    expect(escalated).toMatchObject({ status: 'committed', value: { status: 'needs_decision',
      escalation: { cause: 'adviser_failed' } } });
    if (escalated.status !== 'committed') return;
    expect(optionsOf(await liveCard(world, escalated.value))).toEqual(secondLayerOptions);
  }, 120_000);

  // K3L-1 (k3l1mut ①) mutation: the approval card adds follow_suggestion when the record carries a suggestion -> red
  it('A1: an approval that reaches the person with the adviser\'s approve as the suggestion is still only approve / decline', async () => {
    const world = await openWorld(true);
    const reached = await reachK3AwaitingProposal(world);
    await endK3RunCompleted(world, reached.claim);
    const advised = await settleK3Review(world, reached.proposalRecord, { adviserAvailable: true });
    expect(advised).toMatchObject({ status: 'awaiting_advice', advice: { phase: 'approval' } });
    const escalated = await escalate(world, advised, 'second_consecutive', { phase: 'approval', choice: 'approve',
      escalationKind: null, rationale: 'the safer method only reads', plain: '这个方案可以照做' });
    expect(escalated).toMatchObject({ status: 'committed', value: { status: 'awaiting_approval',
      escalation: { cause: 'second_consecutive', suggestion: { phase: 'approval', choice: 'approve' } } } });
    if (escalated.status !== 'committed') return;
    expect((await liveCard(world, escalated.value)).options.map(option => option.id)).toEqual(['approve', 'decline']);
  }, 180_000);
});
