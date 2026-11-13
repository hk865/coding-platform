/**
 * K3 layering at the owner level (HANDOFF 121-109/121-110): the rules the
 * acceptance rows cannot reach before the adviser round exists. The record is
 * the real blocked-Run record (`createK3PendingReview`) settled by the real
 * owner with `adviserAvailable: true` (review_unavailable: an adviser-layer
 * reason). The ONLY replaced port is the Query read (`queries`) that serves
 * the adviser round's ended Query and its answer text, written with the
 * contract's own `unknownCallAdviceAnswerText`; the Session duty read is its
 * port double too, because this world has no Session directory. O8's record is
 * V5's second-Run chain; the original command read always fails (A2).
 *
 * Named mutations (each row red on the named change):
 *   O1 `adviserAnswerApplied` builds the disposition with source `card` -> red;
 *      the receipt lookup removed -> the replay writes again, red.
 *   O2 the `subject.revision !== current.revision` check removed -> applied, red.
 *   O3 the T02 digest comparison removed -> the every-step card is written, red.
 *   O5 the `choice === 'escalate'` branch removed -> rejected as an unknown choice, red;
 *      an escalate suggestion offered as follow_suggestion -> red.
 *   O6 rule 4 of `unknownCallReviewRouteOf` removed -> `adviser`, red.
 *   O7 the pin compared after the status check again -> invalid, red.
 *   O8 the original commands read before the route is judged again -> unavailable, red.
 *   R1 the duty check removed -> applied, red.
 *   R2 the "Query not ended" check removed -> invalid NO_ACCEPTED_ANSWER, red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  unknownCallAdviceAnswerText, unknownCallAdviceGoalBasisDigest, type UnknownCallAdviceV1,
} from '../../src/contracts/unknown-call-advice.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { unknownCallReviewRouteOf } from '../../src/core/work-graph/state/unknown-call-review.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { goalDecisionBasis } from '../../src/core/work-graph/tasks/goal-basis.js';
import {
  createK3PendingReview, openK3ReviewCardWorld, readK3Review, readK3ReviewCard, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { blockedRecordWithClaim, requeueBlockedRecord } from '../helpers/B2-crr-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const WORLDS: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of WORLDS.splice(0)) await world.close();
});

const ADVISER_REQUEST = 'ucr-adviser-round-1';
const RERUN: UnknownCallAdviceV1 = { phase: 'disposition', choice: 'rerun_as_is', escalationKind: null,
  rationale: '构建命令可以安全重跑', plain: '这一步可以直接重做。' };

type Served = { revision?: number; digest?: string; ended?: boolean; duty?: string; advice?: UnknownCallAdviceV1 };

/** The owner over the world's records; `serve` decides what the adviser round's Query shows. */
function adviserOwner(world: K3ReviewCardWorld, serve: () => Served & { record: UnknownCallReviewV1; goalDigest: string }) {
  let sequence = 0;
  return createUnknownCallReviewService({
    records: world.records, lookups: world.records, reads: createRunStateReader({ records: world.records }),
    queries: {
      readQueryJob: async (_ctx, ref) => {
        const served = serve();
        // The round's own system message, so the Query is the one this requestId asked.
        const message = systemRoundMessageRef({ projectId: ref.projectId, workspaceId: ref.workspaceId }, ADVISER_REQUEST);
        if (message.status !== 'ready') throw new Error('message ref');
        return { status: 'ready', value: { job: { job: {
          // A running Query has no answer yet; the answerRef comes with `answered`.
          status: served.ended === false ? 'running' : 'answered', goalId: served.record.ref.goalId,
          answerRefs: served.ended === false ? [] : [{ answerId: 'adviser-answer' }],
          intent: { execution: { kind: 'intervention_planning', sourceMessageRef: message.value } },
        } }, run: { run: { executionState: { sessionRef: { projectId: ref.projectId, sessionId: 'adviser-session' } } } } } } as never;
      },
      readQueryAnswer: async () => {
        const served = serve();
        return { status: 'ready', value: { answer: { answer: unknownCallAdviceAnswerText({
          reviewRef: served.record.ref, revision: served.revision ?? served.record.revision, phase: 'disposition',
          goalBasisDigest: served.digest ?? served.goalDigest }, served.advice ?? RERUN) } } } as never;
      },
    },
    sessionDuty: {
      readSession: async () => ({ status: 'ready', value: { record: { role: { kind: 'adviser-role' } } } }) as never,
      dutyOfRole: async () => ({ status: 'ready', value: (serve().duty ?? 'adviser') as never }),
    },
    // The adviser round was sent: its receipt names the same message the Query above was asked by.
    messages: { readHostSendMessageRef: async (_ctx, input) => systemRoundMessageRef(input.scope, input.requestId) },
    // A2: the original command read always fails, so no row here applies a skip.
    readKernelCommandFacts: async () => ({ status: 'rejected', code: 'unavailable', reason: 'the Kernel store is not readable' }),
    readWorkspace: { readWorkspace: async () => ({ status: 'rejected', code: 'not_found', reason: 'no package.json' }) },
    now: () => world.fixture.now(),
    eventId: () => `k3l1-owner-event-${String(++sequence)}`,
  });
}

/** V5's chain: the Task's second Run is interrupted again, so its record's streak is second_consecutive. */
async function secondConsecutive(world: K3ReviewCardWorld): Promise<UnknownCallReviewV1> {
  const first = await blockedRecordWithClaim(world, 'k3-20-a', 'k3l1-o8-a', [{ callId: 'k3l1-o8-a', command: 'echo a' }]);
  const requeue = await requeueBlockedRecord(world, first.claim, 'K3L-1 O8 second Run');
  return (await blockedRecordWithClaim(world, 'k3-20-a', 'k3l1-o8-b', [{ callId: 'k3l1-o8-b', command: 'echo b' }],
    { requeue: requeue.ref, dispose: false })).record;
}

/** The real pending record settled into `awaiting_advice`, and the Goal digest the packet would carry. */
async function awaitingAdvice(kind: 'memory' | 'sqlite', served: Served = {}, secondRun = false) {
  // The first Run's skip (the second-Run chain) reads its real command through the world's own owner.
  const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: secondRun });
  WORLDS.push(world);
  const pending = secondRun ? await secondConsecutive(world)
    : await createK3PendingReview(world, { command: 'npm run build', callId: `k3l1-owner-${kind}` });
  const state = { record: pending, goalDigest: '', ...served };
  const owner = adviserOwner(world, () => state);
  const settled = await owner.settleReview(world.fixture.ctx, { input: { reviewRef: pending.ref,
    cause: 'review_unavailable', adviserAvailable: true },
  meta: { requestId: 'k3l1-settle', expected: [{ ref: pending.ref, revision: pending.revision }] } } as never);
  if (settled.status !== 'committed') throw new Error(`settle: ${JSON.stringify(settled)}`);
  state.record = settled.value;
  const goalRef = { aggregateType: 'Goal' as const, projectId: pending.ref.projectId, goalId: pending.ref.goalId };
  const goal = await world.fixture.b2.base.plans.queryGoal(world.fixture.ctx, goalRef);
  if (goal.status !== 'ready') throw new Error('goal read');
  state.goalDigest = unknownCallAdviceGoalBasisDigest(goalDecisionBasis(goal.value.goal));
  const apply = (requestId = 'k3l1-apply') => owner.applyAdviserAnswer(world.fixture.ctx, { input: {
    reviewRef: pending.ref, requestId: ADVISER_REQUEST, phase: 'disposition' },
  meta: { requestId, expected: [{ ref: pending.ref, revision: state.record.revision }] } } as never);
  return { world, state, goalRef, goal: goal.value.goal, apply };
}

describe('K3L-1 adviser answers at the owner', () => {
  it.each(['memory', 'sqlite'] as const)('K3L1-O1 %s: the adviser\'s rerun is applied once with source adviser; the same answer replays', async kind => {
    const { world, state, apply } = await awaitingAdvice(kind);
    expect(state.record).toMatchObject({ status: 'awaiting_advice', advice: { phase: 'disposition', answer: null } });
    const first = await apply();
    expect(first).toMatchObject({ status: 'committed', replayed: false, value: {
      status: 'resolved', revision: state.record.revision + 1, advice: { phase: 'disposition', answer: RERUN },
      disposition: { choice: 'rerun_as_is', source: 'adviser', answerMessageRef: null, text: '构建命令可以安全重跑' },
    } });
    expect(await apply('k3l1-apply-retry')).toMatchObject({ status: 'committed', replayed: true,
      value: { revision: state.record.revision + 1 } });
    expect((await readK3Review(world, state.record)).revision).toBe(state.record.revision + 1);
  });

  it('K3L1-O2: an answer frozen at an older revision is a revision_conflict and writes nothing', async () => {
    const { world, state, apply } = await awaitingAdvice('memory');
    Object.assign(state, { revision: state.record.revision - 1 });
    expect(await apply()).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await readK3Review(world, state.record)).toMatchObject({ status: 'awaiting_advice', revision: state.record.revision });
  });

  it('K3L1-O7: after the person holds the record, the answer pinned to the older revision is a revision_conflict and writes nothing', async () => {
    const { world, state, apply } = await awaitingAdvice('memory');
    const held = await world.reviews.holdReview(world.fixture.ctx, { input: { reviewRef: state.record.ref, text: null },
      meta: { requestId: 'k3l1-o7-hold', expected: [{ ref: state.record.ref, revision: state.record.revision }] } });
    expect(held).toMatchObject({ status: 'committed', value: { status: 'resolved', revision: state.record.revision + 1 } });
    expect(await apply()).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await readK3Review(world, state.record)).toMatchObject({ status: 'resolved', revision: state.record.revision + 1 });
  });

  it('K3L1-O8: the original command read fails; the second consecutive interruption still reaches the person with the adviser\'s skip as the suggestion', async () => {
    const skip: UnknownCallAdviceV1 = { phase: 'disposition', choice: 'skip_as_done', escalationKind: null,
      rationale: 'b 已经跑完了', plain: '这一步其实已经做完了。' };
    const { state, apply } = await awaitingAdvice('memory', { advice: skip }, true);
    expect(state.record).toMatchObject({ status: 'awaiting_advice', streak: { priorUnknownProcess: true } });
    expect(await apply()).toMatchObject({ status: 'committed', value: { status: 'needs_decision', disposition: null,
      escalation: { cause: 'second_consecutive', suggestion: skip } } });
  }, 180_000);

  it('K3L1-O3 (T02): the Goal set to every step after the answer froze is other Goal content; the answer is a revision_conflict and writes nothing', async () => {
    const { world, state, goalRef, goal, apply } = await awaitingAdvice('memory');
    const set = await world.goalSettings.setGoalSettings(world.fixture.ctx, { input: {
      goalRef, autonomy: 'every_step', waitForGoalRef: null,
    }, meta: { requestId: 'k3l1-every-step', expected: [{ ref: goalRef, revision: goal.revision }] } });
    expect(set.status).toBe('committed');
    expect(await apply()).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      reason: 'the Goal content changed since the answer captured it' });
    expect(await readK3Review(world, state.record)).toMatchObject({ status: 'awaiting_advice', revision: state.record.revision });
  });

  it('K3L1-O5: the adviser escalates -> the second-layer card with the adviser\'s sentence and no follow_suggestion', async () => {
    const escalate: UnknownCallAdviceV1 = { phase: 'disposition', choice: 'escalate', escalationKind: 'product_tradeoff',
      rationale: '要不要保留旧数据是产品取舍', plain: '旧数据要不要保留，需要你来定。' };
    const { world, apply } = await awaitingAdvice('memory', { advice: escalate });
    const result = await apply();
    expect(result).toMatchObject({ status: 'committed', value: { status: 'needs_decision', disposition: null,
      escalation: { cause: 'adviser_escalated', suggestion: escalate } } });
    if (result.status !== 'committed') throw new Error('apply');
    const { card } = await readK3ReviewCard(world, result.value);
    expect(card.options.map(option => option.id)).not.toContain('follow_suggestion');
    expect(card.objects[0]!.label.split('\n')).toEqual(['任务中断时有一步操作不知道做完没有，参谋认为这件事要你来定。',
      '参谋说（产品取舍）：旧数据要不要保留，需要你来定。']);
  });

  it('K3L1-O6 (pure): the route table — the streak causes go to the adviser first, a person\'s proposal back to the person', () => {
    const streak = { priorAutoCleanup: true, priorUnknownProcess: true, resetRunRef: null };
    const base = { reasons: ['partial'] as const, autonomy: 'after_plan_confirmation' as const, dispositionSource: null };
    expect(unknownCallReviewRouteOf({ ...base, streak: { ...streak, priorAdvised: true }, adviserAvailable: true }))
      .toEqual({ to: 'adviser_then_person', cause: 'advised_failed_again' });
    expect(unknownCallReviewRouteOf({ ...base, streak, adviserAvailable: false }))
      .toEqual({ to: 'person', cause: 'second_consecutive' });
    expect(unknownCallReviewRouteOf({ ...base, reasons: ['partial', 'proposal_declined'], streak: { ...streak,
      priorUnknownProcess: false }, adviserAvailable: true, dispositionSource: 'card' }))
      .toEqual({ to: 'person', cause: null, escalation: 'keep' });
    expect(unknownCallReviewRouteOf({ ...base, reasons: ['partial', 'proposal_declined'], streak: { ...streak,
      priorUnknownProcess: false }, adviserAvailable: true, dispositionSource: 'adviser' })).toEqual({ to: 'adviser' });
  });
});

describe('rejects: adviser answers that are not the adviser\'s', () => {
  it('K3L1-R1: an answer from a Session whose duty is not adviser is forbidden and writes nothing', async () => {
    const { world, state, apply } = await awaitingAdvice('memory', { duty: 'executor' });
    expect(await apply()).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await readK3Review(world, state.record)).toMatchObject({ status: 'awaiting_advice', revision: state.record.revision });
  });

  it('K3L1-R2: a Query that has not ended is incomplete and writes nothing', async () => {
    const { world, state, apply } = await awaitingAdvice('memory', { ended: false });
    expect(await apply()).toMatchObject({ status: 'rejected', code: 'incomplete' });
    expect(await readK3Review(world, state.record)).toMatchObject({ status: 'awaiting_advice', revision: state.record.revision });
  });
});
