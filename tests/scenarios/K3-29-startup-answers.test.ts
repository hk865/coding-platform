/**
 * K3-29 / L28 step 6b (c) kinds 3 and 4: the start-up reconcile hands an
 * active Goal over because its current review card already has a real answer
 * (kind 3) or because the Goal has an unapplied answer handed over by the
 * answer index (kind 4, M2).
 *
 * Everything the reconcile reads here is real: the `needs_decision` record is
 * made by the real RUN-20/RUN-22 owners (`openK3ReviewCardWorld`), the card by
 * the real review-card source, the answers by the real decision-message owner
 * over the same store, and the review reads are the real
 * `UnknownCallReviewService` (`listReviews`, `listUnappliedAnswers`) plus the
 * real `readDecisionAnswer`. No record, card or answer is hand-encoded.
 *
 * Kind 4 is built through the real `resolveDecision` (①, ② and a failed ③)
 * and then a real direct hold: the record is no longer `open`, so only the
 * answer index can hand it over. The ② receipt is the real `applyDisposition`
 * commit; the ③ failure is the fixture's injected commit fault, never a
 * hand-encoded receipt.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { runStartupReconcile, type StartupReconcilePlatform } from '../../src/app/startup-reconcile.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { UnknownCallReviewReadPort } from '../../src/core/work-graph/model/unknown-call-review-contracts.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { GOAL_B, WORKSPACE_SCOPE, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the real Run's one call uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const HOST = 'k3-29-answers-host';

type CardRecord = { ref: UnknownCallReviewRef; revision: number };

/** The canonical source key of the record's CURRENT card (L18 identity). */
function answeredSource(record: CardRecord): DecisionSourceV1 {
  return { kind: 'unknown_call_review',
    key: decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision }),
    subject: { kind: 'goal', goalRef: GOAL_B }, pins: [] };
}

/** The real card source read by key; the answer uses its exact captured source. */
async function cardOf(world: K3ReviewCardWorld, record: CardRecord) {
  const read = await world.readModel.readDecisionCard(world.fixture.ctx, { source: answeredSource(record) });
  if (read.status !== 'ready') throw new Error(`the review card is not readable: ${JSON.stringify(read)}`);
  expect(read.value.state).toBe('waiting_answer');
  return read.value;
}

/** The real ① answer through the decision-message owner. */
async function answerCard(world: K3ReviewCardWorld, record: CardRecord) {
  const f = world.fixture;
  const card = await cardOf(world, record);
  const answered = await world.decisions.answerDecision(f.ctx, { input: { source: card.source,
    selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '', annotations: [] },
    meta: { requestId: `k3-29-answer-${record.ref.runId}`, expected: card.source.pins } });
  expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'committed' });
  if (answered.status !== 'committed') throw new Error('the answer must commit');
  return { card, answer: answered.value };
}

/** The fixture's real Goal, read through the same owner the reconcile reads. */
async function goalOf(f: S5DecisionFixture): Promise<GoalSnapshot> {
  const read = await f.b2.base.plans.queryGoal(f.ctx, GOAL_B);
  if (read.status !== 'ready') throw new Error(`the Goal is not readable: ${JSON.stringify(read)}`);
  return read.value.goal;
}

function untouched<T extends object>(name: string): T {
  return new Proxy({}, { get: (_target, member) => () => {
    throw new Error(`${name}.${String(member)} must not be called`);
  } }) as T;
}
const nothing = async () => ({ status: 'ready' as const, value: { records: [], damaged: [] } });

async function reconcile(f: S5DecisionFixture, world: K3ReviewCardWorld,
  listUnappliedAnswers?: UnknownCallReviewReadPort['listUnappliedAnswers']) {
  const platform: StartupReconcilePlatform = {
    sessions: { findSessions: async () => ({ status: 'ready',
      value: { items: [], nextCursor: null, sourceCursor: 'k3-29-answers' } }) as never },
    executions: untouched('executions'),
    controls: untouched('controls'),
    plans: { queryTaskGraph: f.b2.base.plans.queryTaskGraph.bind(f.b2.base.plans) },
    reconcile: { ...untouched<StartupReconcilePlatform['reconcile']>('reconcile'),
      reviews: { listReviews: world.reviews.listReviews.bind(world.reviews),
        listUnappliedAnswers: listUnappliedAnswers ?? world.reviews.listUnappliedAnswers.bind(world.reviews),
        readDecisionAnswer: world.decisions.readDecisionAnswer.bind(world.decisions) },
      candidates: { listRuns: nothing, listUnknownRuns: nothing, listQueuedControlRuns: nothing,
        listOpenRounds: nothing,
        listGoals: async () => ({ status: 'ready', value: { records: [await goalOf(f)], damaged: [] } }) } },
  };
  return await runStartupReconcile({ platform, hostInstanceId: HOST, scopes: [f.base.scope],
    context: () => f.ctx as CoreCallContext,
    fanOut: async () => { throw new Error('an unchanged active Goal needs no fan-out pass'); } });
}

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

describe('K3-29 step 6b (c) kind 3: an answered current card', () => {
  it.each(['memory', 'sqlite'] as const)('K3-29 (%s): a real ① answer hands the needs_decision Goal over with its Task id; unanswered, it is not handed over', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const f = world.fixture;
    const record = await world.createRecord('k3-20-a');
    // The real blocked Run leaves revision 1 `pending_review`; the real
    // `settleReview{review_unavailable}` commit is revision 2.
    expect(record).toMatchObject({ status: 'needs_decision', revision: 2, open: 'yes' });

    const before = await reconcile(f, world);
    expect(before.reviews).toHaveLength(1);
    expect(before.redriveGoals).toEqual([]);
    expect(before.problems).toEqual([]);

    const { answer } = await answerCard(world, record);
    expect(answer.decision).toMatchObject({ syntheticAnswer: true });
    // The real reader sees the answer of exactly this current revision.
    const seen = await world.decisions.readDecisionAnswer(f.ctx, { source: answeredSource(record) });
    expect(seen).toMatchObject({ status: 'ready', value: { message: { ref: answer.ref } } });
    // ① only: the answer index has no ② receipt yet, so kind 4 lists nothing.
    expect(await world.reviews.listUnappliedAnswers(f.ctx, { goalRef: GOAL_B })).toMatchObject({
      status: 'ready', value: { answers: [] } });

    const after = await reconcile(f, world);
    expect(after.reviews).toHaveLength(1);
    expect(after.redriveGoals).toEqual([{
      goalRef: GOAL_B, scope: { ...WORKSPACE_SCOPE }, taskIds: ['k3-20-a'],
    }]);
    expect(after.problems).toEqual([]);
  });
});

describe('K3-29 step 6b (c) kind 4: the answers handed over by the index', () => {
  it.each(['memory', 'sqlite'] as const)('K3-29 (%s): a real ② commit with a failed ③ is handed over by its own reviewRef after a direct hold closes the record', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const f = world.fixture;
    const record = await world.createRecord('k3-20-b');
    // `resolveDecision` answers ① itself (a second answer to the same card is a
    // real `revision_conflict`), then runs ② and the injected ③ failure.
    const card = await cardOf(world, record);

    world.failNextApplicationCommit();
    const resolved = await world.decisionActions.resolveDecision(f.ctx, { input: { source: card.source,
      selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '', annotations: [] },
      meta: { requestId: 'k3-29-apply', expected: card.source.pins } });
    expect(resolved, JSON.stringify(resolved)).toMatchObject({ status: 'ready', value: {
      state: 'application_not_recorded', application: { status: 'rejected' } } });
    if (resolved.status !== 'ready') return;
    expect(resolved.value.answer, JSON.stringify(resolved.value.answer)).toMatchObject({ status: 'committed' });
    if (resolved.value.answer.status !== 'committed') return;
    const answerRef = resolved.value.answer.value.ref;

    const applied = await world.reviews.readReview(f.ctx, { ref: record.ref });
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ready', value: {
      status: 'resolved', disposition: { choice: 'rerun_as_is' } } });
    if (applied.status !== 'ready') return;
    // A real direct hold replaces the disposition (`answerMessageRef: null`) and
    // closes the record: kind 3 can no longer select it.
    const held = await world.reviews.holdReview(f.ctx, { input: { reviewRef: record.ref, text: null },
      meta: { requestId: 'k3-29-answers-hold', expected: [
        { ref: record.ref, revision: applied.value.revision }] } });
    expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed', value: {
      status: 'resolved', open: 'no', disposition: { choice: 'handle_myself', answerMessageRef: null } } });

    // The REAL index over the REAL ② receipt still lists the earlier answer.
    const indexed = await world.reviews.listUnappliedAnswers(f.ctx, { goalRef: GOAL_B });
    expect(indexed, JSON.stringify(indexed)).toMatchObject({ status: 'ready', value: { answers: [{
      answerMessageRef: answerRef, reviewRef: record.ref, phase: 'disposition' }] } });

    const seen: unknown[] = [];
    const realList = world.reviews.listUnappliedAnswers.bind(world.reviews);
    const listUnappliedAnswers: UnknownCallReviewReadPort['listUnappliedAnswers'] =
      async (ctx, input) => { seen.push(input); return await realList(ctx, input); };
    const report = await reconcile(f, world, listUnappliedAnswers);
    expect(seen).toEqual([{ goalRef: GOAL_B }]);
    expect(report.reviews).toEqual([]);
    expect(report.redriveGoals).toEqual([{
      goalRef: GOAL_B, scope: { ...WORKSPACE_SCOPE }, taskIds: [],
      answers: [{ kind: 'unknown_call_review', reviewRef: record.ref, answerMessageRef: answerRef }],
    }]);
    expect(report.problems).toEqual([]);
  });
});
