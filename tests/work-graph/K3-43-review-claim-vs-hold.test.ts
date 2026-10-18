/**
 * K3 row K3-43 (三)(四) at the owner level (L11/D3): the race between a review
 * claim (TASK-03r) and the direct "I'll handle it" (`holdReview`, UCR-15), both
 * orders, and `releaseHold` while a round is active.
 *
 * The record is the real `pending_review` record of the ONE shared public step
 * (`createK3PendingReview`: real claim/prepare/Runtime start with §5.1's shell
 * stand-in, the production Host RUN-20/RUN-22 read of that Kernel Turn, then
 * the Runtime's own end). The review claim is the real TASK-03r claim owner
 * over that record's Task and the hold is the real UCR-15 owner over the real
 * `readCanonicalTaskFacts` reader. A stale caller pin is the only injected
 * state; nothing is hand-encoded. The shared Host recognition path draws the
 * record on both backends (the world's one store, memory or SQLite).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { readCanonicalTaskFacts, readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import {
  createK3PendingReview, openK3ReviewCardWorld, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { GOAL_B, PLAN_B2, WORKSPACE, WORKSPACE_REVISION } from '../helpers/S5-decision-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the real Run's one call uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

type Fixture = {
  world: K3ReviewCardWorld;
  base: TaskClaimFixture;
  records: K3ReviewCardWorld['records'];
  close(): Promise<void>;
};

/** The real S5/K3 world: its owners read the same records the public steps wrote. */
async function ownerFixture(kind: 'memory' | 'sqlite'): Promise<Fixture> {
  // The shared Host recognition path shares the world's one backend (SQLite on
  // disk or the fixture's one in-memory backend) with the platform Host.
  const world = await openK3ReviewCardWorld(kind);
  return { world, base: world.fixture.b2.base, records: world.records, close: () => world.close() };
}

/** The ONE real pending record: one blocked shell call through the shared steps. */
async function pendingRecord(f: Fixture, label: string): Promise<UnknownCallReviewV1> {
  const record = await createK3PendingReview(f.world, {
    taskId: 'k3-20-a', label, callId: 'call-1', command: 'echo hi',
  });
  expect(record, JSON.stringify(record)).toMatchObject({ revision: 1, status: 'pending_review',
    inventory: 'complete', activeRound: null, disposition: null });
  expect(record.items).toHaveLength(1);
  expect(record.items[0]).toMatchObject({ alias: 1, toolName: 'shell', kind: 'process',
    observed: { verdict: 'pending', by: null } });
  return record;
}

/**
 * The TASK-03r request for this record's Task: the real goal/Workspace/Session
 * pins are read from the store; the review pin is the caller's stale or fresh
 * revision under test.
 */
async function reviewClaimRequest(f: Fixture, record: UnknownCallReviewV1, expectedRevision: number, label: string) {
  const session = await f.world.fixture.createS5Session(`k3-43-review-${label}`);
  const goal = await f.base.plans.queryGoal(f.world.fixture.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal must read: ${JSON.stringify(goal)}`);
  const card = await f.base.sessionsPort.readSession(f.world.fixture.ctx, session);
  if (card.status !== 'ready') throw new Error(`the Session must read: ${JSON.stringify(card)}`);
  return { input: { goalRef: GOAL_B, planRef: PLAN_B2, taskId: record.task.taskId, sessionRef: session,
    roleBinding: f.base.roleBinding, budget: f.base.budget,
    review: { reviewRef: record.ref, expectedRevision, phase: 'review' as const } },
  meta: { requestId: `k3-43-review-${label}`, expected: [
    { ref: GOAL_B, revision: goal.value.goal.revision },
    { ref: WORKSPACE, revision: WORKSPACE_REVISION },
    { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision },
  ] } };
}

async function reviewRuns(f: Fixture, record: UnknownCallReviewV1): Promise<number> {
  const window = await readGoalPlanWindow(f.records, GOAL_B);
  if (window.status !== 'ready' || window.plan === null) throw new Error(`the Plan must read: ${JSON.stringify(window)}`);
  const facts = await readCanonicalTaskFacts(f.records, GOAL_B, window.plan, record.task.taskId);
  if (facts.status !== 'ready') throw new Error('the projection must read');
  return (facts.value.runsByTaskId.get(record.task.taskId) ?? [])
    .filter(run => run.purpose?.kind === 'unknown_call_review').length;
}

const fixtures: Fixture[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

describe('K3-43 (三) review claim versus hold', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-43 (三) %s: hold first, then the review claim loses on the record revision and creates no Run', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    const record = await pendingRecord(f, 'k3-43-review-hold-first');
    const held = await f.world.reviews.holdReview(f.world.fixture.ctx, { input: { reviewRef: record.ref, text: null },
      meta: { requestId: 'k3-43-hold-first', expected: [{ ref: record.ref, revision: 1 }] } });
    expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed',
      value: { revision: 2, status: 'resolved', activeRound: null,
        disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } } });
    const before = await reviewRuns(f, record);
    const claim = await f.base.makeService(f.records).claimTask(f.world.fixture.ctx,
      await reviewClaimRequest(f, record, 1, 'hold-first'));
    expect(claim).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await reviewRuns(f, record)).toBe(before);
    expect(await f.world.reviews.readReview(f.world.fixture.ctx, { ref: record.ref }))
      .toMatchObject({ status: 'ready', value: { revision: 2, activeRound: null } });
  });

  it.each(['memory', 'sqlite'] as const)(
    'K3-43 (三) %s: the review claim wins, a stale hold loses, and a re-read hold commits with the round active', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    const record = await pendingRecord(f, 'k3-43-review-claim-first');
    const claimed = await f.base.makeService(f.records).claimTask(f.world.fixture.ctx,
      await reviewClaimRequest(f, record, 1, 'claim-first'));
    expect(claimed, JSON.stringify(claimed)).toMatchObject({ status: 'committed', replayed: false });

    // The caller's stale read (revision 1) loses; nothing is written.
    const stale = await f.world.reviews.holdReview(f.world.fixture.ctx, { input: { reviewRef: record.ref, text: null },
      meta: { requestId: 'k3-43-hold-stale', expected: [{ ref: record.ref, revision: 1 }] } });
    expect(stale).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await f.world.reviews.readReview(f.world.fixture.ctx, { ref: record.ref })).toMatchObject({ status: 'ready', value: {
      revision: 2, status: 'pending_review', disposition: null,
      activeRound: { phase: 'review', round: 1 } } });

    // The re-read revision 2 hold commits; the running round stays active (UR3h).
    const reHeld = await f.world.reviews.holdReview(f.world.fixture.ctx, { input: { reviewRef: record.ref, text: null },
      meta: { requestId: 'k3-43-hold-retry', expected: [{ ref: record.ref, revision: 2 }] } });
    expect(reHeld, JSON.stringify(reHeld)).toMatchObject({ status: 'committed', value: {
      revision: 3, status: 'resolved', activeRound: { phase: 'review', round: 1 },
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } } });
    });
});

describe('K3-43 (四) release-hold while a round is active', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-43 (四) %s: releaseHold is busy with the round-not-settled text', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    const record = await pendingRecord(f, 'k3-43-release-hold');
    await f.base.makeService(f.records).claimTask(f.world.fixture.ctx,
      await reviewClaimRequest(f, record, 1, 'release-hold'));
    const held = await f.world.reviews.holdReview(f.world.fixture.ctx, { input: { reviewRef: record.ref, text: null },
      meta: { requestId: 'k3-43-hold', expected: [{ ref: record.ref, revision: 2 }] } });
    expect(held).toMatchObject({ status: 'committed', value: { activeRound: { round: 1 } } });
    const release = await f.world.reviews.releaseHold(f.world.fixture.ctx, { input: { reviewRef: record.ref },
      meta: { requestId: 'k3-43-release', expected: [{ ref: record.ref, revision: 3 }] } });
    expect(release).toMatchObject({ status: 'rejected', code: 'busy', reason: '核对轮还没收尾' });
    });
});

