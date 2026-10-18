/**
 * K3 row K3-15 (四)(五) at the owner level (L21): the direct "I'll handle it"
 * (`holdReview`, UCR-15) during a running review round and on an auto-settled
 * record, plus `releaseHold` (UCR-14) and its D3 guards.
 *
 * Every record is reached through the shared public steps over the real
 * RecordStore, on memory and SQLite (`openK3ReviewCardWorld(kind)`): the
 * `pending_review` record
 * is the real blocked Run the Host recognition path produced
 * (`createK3PendingReview`), its round is the real TASK-03r claim, and the
 * auto-settled record is the real read-only Run
 * (`world.createRecord(..., { autoSettled: true })`). No record, item, draft or
 * event is hand-encoded. Expected values are the spec's literal ones.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewRef, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import {
  createUnknownCallReviewService,
} from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import {
  readCanonicalTaskFacts, readGoalPlanWindow,
} from '../../src/core/work-graph/tasks/plan-readers.js';
import {
  createK3PendingReview, openK3ReviewCardWorld, readK3Review,
  type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { GOAL_B, PLAN_B2, WORKSPACE } from '../helpers/S5-decision-fixture.js';
import { readToolSeam, shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-ins hoisted per test file: the real blocked record Run uses the
// `shell` stand-in and the auto-settled record Run the `read` one.
const seams = vi.hoisted(() => ({
  shellSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').shellSeam,
  readToolSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').readToolSeam,
}));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    seams.shellSeam.definition(actual.createShellToolDefinition, sandboxArg) };
});
vi.mock('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js')>();
  return { ...actual,
    createReadToolDefinition: (workspace: Parameters<typeof actual.createReadToolDefinition>[0]) =>
      seams.readToolSeam.enabled ? seams.readToolSeam.definition() : actual.createReadToolDefinition(workspace) };
});
seams.shellSeam = shellSeam;
seams.readToolSeam = readToolSeam;

type Fixture = {
  world: K3ReviewCardWorld;
  reviews: K3ReviewCardWorld['reviews'];
  records: K3ReviewCardWorld['records'];
};

async function ownerFixture(kind: 'memory' | 'sqlite'): Promise<Fixture> {
  // The Host recognition path opens the world's own backend: SQLite shares the
  // fixture directory's ledger/body store, memory shares the world's ONE store.
  const world = await openK3ReviewCardWorld(kind);
  return { world, reviews: world.reviews, records: world.records };
}

/** TASK-03r: the real claim owner writes UCR-03's activeRound in the same commit. */
async function reviewClaim(world: K3ReviewCardWorld, record: UnknownCallReviewV1): Promise<RunRef> {
  const session = await world.fixture.createS5Session(`k3-15-hold-review-${record.ref.runId}`);
  const claim = await world.fixture.claimRun({ requestId: `k3-15-hold-claim-${record.ref.runId}`,
    goalRef: GOAL_B, planRef: PLAN_B2, taskId: record.task.taskId, sessionRef: session,
    review: { reviewRef: record.ref, expectedRevision: record.revision, phase: 'review' } });
  return claim.runRef;
}

/** The current Workspace revision as the claim pins read it. */
async function workspaceRevision(world: K3ReviewCardWorld): Promise<number> {
  const read = await world.records.readMany([canonicalJson(WORKSPACE)]);
  if (read.status !== 'ready') throw new Error(`the Workspace is not readable: ${JSON.stringify(read)}`);
  const record = read.value.records[0];
  if (record === undefined) throw new Error('the Workspace snapshot is missing');
  return (JSON.parse(record.json) as { revision: number }).revision;
}

const fixtures: Fixture[] = [];
afterEach(async () => {
  shellSeam.release();
  readToolSeam.release();
  for (const fixture of fixtures.splice(0)) await fixture.world.close();
});

describe('K3-15 (四) owner direct hold during a running round', () => {
  it.each(['memory', 'sqlite'] as const)('K3-15 (四) %s: hold resolves and holds the record, keeps activeRound, replays, and refuses a new hold', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    const created = await createK3PendingReview(f.world, {
      label: 'k3-15-hold', callId: 'k3-15-hold-call-1', command: 'echo hi',
    });
    expect(created).toMatchObject({ status: 'pending_review', revision: 1 });
    const roundRef = await reviewClaim(f.world, created);
    const reviewRef: UnknownCallReviewRef = created.ref;
    const afterClaim = await f.reviews.readReview(f.world.fixture.ctx, { ref: reviewRef });
    expect(afterClaim, JSON.stringify(afterClaim)).toMatchObject({ status: 'ready', value: {
      revision: 2, status: 'pending_review',
      activeRound: { runRef: roundRef, phase: 'review', round: 1, stateEntry: 1, startedRevision: 1 } } });
    const expected = [{ ref: reviewRef, revision: 2 }];
    const holdRequest = { input: { reviewRef, text: null },
      meta: { requestId: 'k3-15-hold-direct', expected } };
    const held = await f.reviews.holdReview(f.world.fixture.ctx, holdRequest);
    expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed', replayed: false, value: {
      revision: 3, status: 'resolved', activeRound: { phase: 'review', round: 1 },
      disposition: { choice: 'handle_myself', source: 'direct', answerMessageRef: null,
        targets: [created.items[0]?.callId], hold: 'held',
        appliedBy: { kind: 'human', id: 'operator' } } } });

    // UCR-14/D3: the round is still active, so "continue" is busy.
    const release = await f.reviews.releaseHold(f.world.fixture.ctx, { input: { reviewRef },
      meta: { requestId: 'k3-15-release-busy', expected: [{ ref: reviewRef, revision: 3 }] } });
    expect(release).toMatchObject({ status: 'rejected', code: 'busy', reason: '核对轮还没收尾' });

    // The same request replays the original receipt.
    const replay = await f.reviews.holdReview(f.world.fixture.ctx, holdRequest);
    expect(replay).toEqual({ ...held, replayed: true });

    // A NEW request while held is busy.
    const again = await f.reviews.holdReview(f.world.fixture.ctx, { input: { reviewRef, text: null },
      meta: { requestId: 'k3-15-hold-again', expected: [{ ref: reviewRef, revision: 3 }] } });
    expect(again).toMatchObject({ status: 'rejected', code: 'busy', reason: '已经在等你处理' });
  });
});

describe('K3-15 (五) owner hold on an auto-settled record', () => {
  it.each(['memory', 'sqlite'] as const)('K3-15 (五) %s: hold stops the settled record, release unholds, and the continuation requeue claim passes', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    // The real read-only Run settles its complete inventory `resolved` at creation.
    const record = await f.world.createRecord('k3-20-a', { autoSettled: true });
    const reviewRef: UnknownCallReviewRef = record.ref;
    expect(record).toMatchObject({ revision: 1, status: 'resolved', decisionReasons: [], activeRound: null,
      disposition: null });

    // A human requeue after the original Run: the continuation exists but is
    // not yet claimed.
    const ctx = f.world.fixture.ctx;
    const goal = await f.world.fixture.b2.base.plans.queryGoal(ctx, GOAL_B);
    expect(goal.status).toBe('ready');
    if (goal.status !== 'ready') throw new Error('the Goal must be readable');
    const reads = createRunStateReader({ records: f.records });
    const execution = await reads.readExecution(ctx, record.runRef);
    if (execution.status !== 'ready') throw new Error(`the original Run must read: ${JSON.stringify(execution)}`);
    let seq = 0;
    const requeues = createTaskRequeueService({
      records: f.records, reads,
      workspaceHost: { async resolveRoot() {
        return { status: 'ready', value: { root: f.world.fixture.base.directory, workspaceRevision: 1 } };
      } },
      source: { async captureDigest() { return { status: 'ready', sourceDigest: 'a'.repeat(64) }; } },
      materials: { async storeArtifact() { throw new Error('the requeue carries no note'); },
        async openArtifact() { throw new Error('the requeue reads no artifact'); } },
      messages: { async readMessage() { return { status: 'not_found' }; } },
      now: () => f.world.fixture.now(), eventId: () => `k3-15-requeue-event-${String(++seq)}` });
    const requeued = await requeues.requeueTask(ctx, {
      input: { taskRef: record.task, afterRunRef: record.runRef, reason: 'continue after the crash' },
      meta: { requestId: 'k3-15-human-requeue', expected: [
        { ref: GOAL_B, revision: goal.value.goal.revision },
        { ref: record.runRef, revision: execution.value.run.revision },
      ] } });
    expect(requeued, JSON.stringify(requeued)).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error('the requeue must commit');
    const requeueRef = requeued.value.requeue.ref;

    // L21 UCR-15 from `resolved` needs the original Run still selected.
    const window = await readGoalPlanWindow(f.records, GOAL_B);
    if (window.status !== 'ready' || window.plan === null) throw new Error('the Goal/Plan must read');
    const beforeHold = await readCanonicalTaskFacts(f.records, GOAL_B, window.plan, record.task.taskId);
    expect(beforeHold.status).toBe('ready');
    if (beforeHold.status !== 'ready') throw new Error('the projection must read');
    expect(beforeHold.value.byTaskId.get(record.task.taskId)?.execution).toEqual(record.runRef);

    const held = await f.reviews.holdReview(ctx, { input: { reviewRef, text: 'I will take this' },
      meta: { requestId: 'k3-15-hold-settled', expected: [{ ref: reviewRef, revision: 1 }] } });
    expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed', replayed: false, value: {
      revision: 2, status: 'resolved', activeRound: null,
      disposition: { choice: 'handle_myself', source: 'direct', answerMessageRef: null, hold: 'held',
        text: 'I will take this' } } });
    // The record fact the AV-4c / L11 gate consumes.
    const projected = await readCanonicalTaskFacts(f.records, GOAL_B, window.plan, record.task.taskId);
    expect(projected).toMatchObject({ status: 'ready' });
    if (projected.status !== 'ready') return;
    expect(projected.value.byTaskId.get(record.task.taskId)?.unknownCallReview)
      .toMatchObject({ status: 'resolved', hold: 'held' });

    // L11/D3: while held, the pending continuation claim is refused.
    const session = await f.world.fixture.createS5Session('k3-15-hold-continuation');
    const sessionCard = await f.world.fixture.b2.base.sessionsPort.readSession(ctx, session);
    if (sessionCard.status !== 'ready') throw new Error('the continuation Session must read');
    const claimRequest = async (requestId: string) => ({
      input: { goalRef: GOAL_B, planRef: PLAN_B2, taskId: record.task.taskId, sessionRef: session,
        roleBinding: execution.value.run.roleBinding, budget: execution.value.run.budget, requeueRef },
      meta: { requestId, expected: [
        { ref: GOAL_B, revision: goal.value.goal.revision },
        { ref: WORKSPACE, revision: await workspaceRevision(f.world) },
        { ref: plainSessionRefToAggregate(session), revision: sessionCard.value.record.revision },
      ] },
    });
    expect(await f.world.fixture.b2.base.service.claimTask(ctx, await claimRequest('k3-15-continuation-blocked')))
      .toMatchObject({ status: 'rejected', code: 'busy', reason: 'unknown_call_review_held' });

    const released = await f.reviews.releaseHold(ctx, { input: { reviewRef },
      meta: { requestId: 'k3-15-release-settled', expected: [{ ref: reviewRef, revision: 2 }] } });
    expect(released, JSON.stringify(released)).toMatchObject({ status: 'committed', replayed: false, value: {
      revision: 3, status: 'resolved', disposition: { choice: 'handle_myself', hold: 'released' } } });

    // The ordinary continuation claim passes after the release.
    const claimed = await f.world.fixture.b2.base.service.claimTask(ctx,
      await claimRequest('k3-15-continuation-claim'));
    expect(claimed, JSON.stringify(claimed)).toMatchObject({ status: 'committed', replayed: false });
  });
});

describe('K3-15 owner hold requires the D3 projection reader', () => {
  it.each(['memory', 'sqlite'] as const)('K3-15 (四) %s: without the task projection the hold is unavailable and nothing is written', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    const record = await f.world.createRecord('k3-20-a', { autoSettled: true });
    const reviewRef: UnknownCallReviewRef = record.ref;
    let commits = 0;
    const reviewed = createUnknownCallReviewService({ records: {
      ...f.records, commit(input) { commits += 1; return f.records.commit(input); } },
      reads: createRunStateReader({ records: f.records }),
      readReviewDisplays: async () => ({ status: 'ready', value: new Map([[1, 'full']]) }),
      now: () => f.world.fixture.now(), eventId: () => 'k3-15-no-projection-event' });
    const result = await reviewed.holdReview(f.world.fixture.ctx, { input: { reviewRef, text: null },
      meta: { requestId: 'k3-15-no-projection', expected: [{ ref: reviewRef, revision: 1 }] } });
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(commits).toBe(0);
  });
});
