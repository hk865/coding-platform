/**
 * K3 row K3-43 (一)(二) at the owner level (L11/D3): the race between an
 * ordinary continuation claim (a `requeueRef` claim, TASK-03) and the direct
 * "I'll handle it" (`holdReview`, UCR-15), both orders.
 *
 * The record is the real auto-settled record of the shared public steps
 * (`createK3NeedsDecisionRecord(..., { autoSettled: true })`: a real claimed
 * Run entered by the production Runtime, the scripted model's one `read` call
 * held by §5.1's stand-in, the production Host RUN-20/RUN-22 read of that
 * Kernel Turn, and the Runtime's own end), the continuation is the real
 * `requeueTask` owner and the claim/hold are their real owners. The only
 * injected state is the commit interleaving: a records wrapper runs the other
 * side's whole owner call between the target's reads and its commit — the same
 * two-service approach as K3-43 (三)(四). No record is hand-encoded. The Host
 * recognition path draws the record on both backends (the world's one store).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import {
  createUnknownCallReviewService, type UnknownCallReviewTaskProjectionReader,
} from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { readCanonicalTaskFacts, readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import {
  createK3NeedsDecisionRecord, openK3ReviewCardWorld, type K3ReviewCardWorld,
} from '../helpers/K3-review-card-fixture.js';
import { GOAL_B, PLAN_B2, WORKSPACE, WORKSPACE_REVISION } from '../helpers/S5-decision-fixture.js';
import { readToolSeam, shellSeam } from '../helpers/K3-tool-seams.js';
import { withBackendOrderedLookup } from '../helpers/ordered-lookup-forward.js';

// The auto-settled record is a REAL Run whose one read-only call is held by the
// §5.1 blocking seam; the mock is per test file, so this file owns it.
const readSeams = vi.hoisted(() => ({
  readToolSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').readToolSeam,
  shellSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').shellSeam,
}));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js')>();
  return { ...actual,
    createReadToolDefinition: (workspace: Parameters<typeof actual.createReadToolDefinition>[0]) =>
      readSeams.readToolSeam.enabled ? readSeams.readToolSeam.definition() : actual.createReadToolDefinition(workspace) };
});
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]) =>
    readSeams.shellSeam.definition(actual.createShellToolDefinition, sandboxArg) };
});
readSeams.readToolSeam = readToolSeam;
readSeams.shellSeam = shellSeam;

type B2Records = TaskClaimFixture['records'];

type Fixture = {
  world: K3ReviewCardWorld;
  base: TaskClaimFixture;
  ctx: K3ReviewCardWorld['fixture']['ctx'];
  records: B2Records;
  reads: ReturnType<typeof createRunStateReader>;
  close(): Promise<void>;
};

/** The real S5/K3 world: its owners read the same records the public steps wrote. */
async function ownerFixture(kind: 'memory' | 'sqlite'): Promise<Fixture> {
  // The shared Host recognition path shares the world's one backend (SQLite on
  // disk or the fixture's one in-memory backend) with the platform Host.
  const world = await openK3ReviewCardWorld(kind);
  return { world, base: world.fixture.b2.base, ctx: world.fixture.ctx, records: world.records,
    reads: createRunStateReader({ records: world.records }), close: () => world.close() };
}

/** The same `readCanonicalTaskFacts` window the claim service guards with. */
function projectionOver(records: B2Records): UnknownCallReviewTaskProjectionReader {
  return async (_ctx, task) => {
    const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return window;
    if (window.plan === null) return { status: 'rejected', code: 'not_found', reason: 'the Goal has no active plan' };
    return await readCanonicalTaskFacts(records, goalRef, window.plan, task.taskId);
  };
}

/** The real read-only record: a complete inventory auto-settles it `resolved`. */
async function settledRecord(f: Fixture, label: string): Promise<UnknownCallReviewV1> {
  const record = await createK3NeedsDecisionRecord(f.world, 'k3-20-a', { autoSettled: true });
  expect(record, JSON.stringify(record)).toMatchObject({ revision: 1, status: 'resolved',
    inventory: 'complete', disposition: null, activeRound: null, decisionReasons: [] });
  expect(record.items).toHaveLength(1);
  expect(record.items[0]).toMatchObject({ alias: 1, toolName: 'read', kind: 'read_only',
    observed: { verdict: 'no_review_needed', by: 'platform' } });
  return record;
}

/** The ordinary TASK-03 request for the record's Task; the pins are the store's real ones. */
async function continuationRequest(f: Fixture, record: UnknownCallReviewV1, requestId: string,
  requeueRef?: TaskRequeueRef) {
  const session = await f.world.fixture.createS5Session(requestId);
  const goal = await f.base.plans.queryGoal(f.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal must read: ${JSON.stringify(goal)}`);
  const card = await f.base.sessionsPort.readSession(f.ctx, session);
  if (card.status !== 'ready') throw new Error(`the Session must read: ${JSON.stringify(card)}`);
  return { input: { goalRef: GOAL_B, planRef: PLAN_B2, taskId: record.task.taskId, sessionRef: session,
    roleBinding: f.base.roleBinding, budget: f.base.budget,
    ...(requeueRef === undefined ? {} : { requeueRef }) },
  meta: { requestId, expected: [
    { ref: GOAL_B, revision: goal.value.goal.revision },
    { ref: WORKSPACE, revision: WORKSPACE_REVISION },
    { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision },
  ] } };
}

/** The public requeue of the settled record's ended Run (TASK-03's basis). */
async function requeueAfterOrigin(f: Fixture, record: UnknownCallReviewV1): Promise<{ ref: TaskRequeueRef }> {
  const goal = await f.base.plans.queryGoal(f.ctx, GOAL_B);
  expect(goal.status).toBe('ready');
  if (goal.status !== 'ready') throw new Error('the Goal must be readable');
  const run = await f.reads.readExecution(f.ctx, record.runRef);
  if (run.status !== 'ready') throw new Error(`the record's Run must read: ${JSON.stringify(run)}`);
  const workspace = { async resolveRoot() {
    return { status: 'ready' as const,
      value: { root: f.world.fixture.base.directory, workspaceRevision: WORKSPACE_REVISION } };
  } };
  const sourceReader = new VerificationWorkspaceReader();
  let seq = 0;
  const requeues = createTaskRequeueService({
    records: f.records, reads: createRunStateReader({ records: f.records }), workspaceHost: workspace,
    source: { captureDigest: (root: string) => sourceReader.captureDigest(root) },
    materials: { async storeArtifact() { throw new Error('the requeue carries no note'); },
      async openArtifact() { throw new Error('the requeue reads no artifact'); } },
    messages: { async readMessage() { return { status: 'not_found' as const }; } },
    now: () => '2026-10-08T00:00:00.000Z',
    eventId: () => `k3-43-continuation-requeue-event-${String(++seq)}`,
  });
  const requeued = await requeues.requeueTask(f.ctx, {
    input: { taskRef: record.task, afterRunRef: record.runRef, reason: 'continue after the crash' },
    meta: { requestId: `k3-43-continuation-requeue-${record.runRef.runId}`, expected: [
      { ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: record.runRef, revision: run.value.run.revision },
    ] } });
  expect(requeued, JSON.stringify(requeued)).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error('the requeue must commit');
  return requeued.value.requeue;
}

/**
 * The commit interleaving: the target (the service built over this port) reads
 * everything, then the other side's WHOLE owner call commits, then the target's
 * own commit is handed to the real store. The target's stale guards decide.
 */
function interleaved(records: B2Records, otherSide: () => Promise<void>): B2Records {
  let fired = false;
  return withBackendOrderedLookup({
    readMany: refKeys => records.readMany(refKeys),
    lookupCommit: input => records.lookupCommit(input),
    eventAt: cursor => records.eventAt(cursor),
    lookup: request => records.lookup(request),
    async commit(batch) {
      if (!fired) {
        fired = true;
        await otherSide();
      }
      return records.commit(batch);
    },
  }, records);
}

async function runsOf(f: Fixture, record: UnknownCallReviewV1) {
  const window = await readGoalPlanWindow(f.records, GOAL_B);
  if (window.status !== 'ready' || window.plan === null) throw new Error(`the Plan must read: ${JSON.stringify(window)}`);
  const facts = await readCanonicalTaskFacts(f.records, GOAL_B, window.plan, record.task.taskId);
  if (facts.status !== 'ready') throw new Error(`the projection must read: ${JSON.stringify(facts)}`);
  return facts.value.runsByTaskId.get(record.task.taskId) ?? [];
}

const fixtures: Fixture[] = [];
afterEach(async () => {
  readToolSeam.release();
  shellSeam.release();
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

describe('K3-43 (一) continuation claim versus hold: the hold commits first', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-43 (一) %s: the continuation claim loses on the review record revision and creates no Run', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    const record = await settledRecord(f, 'k3-43-continuation');
    const requeue = await requeueAfterOrigin(f, record);

    let held: Awaited<ReturnType<Fixture['world']['reviews']['holdReview']>> | null = null;
    // The claim reads the record@1 and the Task/lease facts before its commit;
    // this hook commits the whole real hold between that read and the commit.
    const claimService = f.base.makeService(interleaved(f.records, async () => {
      held = await f.world.reviews.holdReview(f.ctx, { input: { reviewRef: record.ref, text: null },
        meta: { requestId: 'k3-43-continuation-hold-first', expected: [{ ref: record.ref, revision: 1 }] } });
    }));
    const request = await continuationRequest(f, record, 'k3-43-continuation-claim-hold-first', requeue.ref);
    const claim = await claimService.claimTask(f.ctx, request);

    expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed', value: {
      revision: 2, status: 'resolved', activeRound: null, disposition: { choice: 'handle_myself', hold: 'held' } } });
    expect(claim).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    // No Run was created: the original Run is still the only one.
    expect((await runsOf(f, record)).map(run => run.ref.runId)).toEqual([record.runRef.runId]);
    // The record stays resolved+held.
    expect(await f.world.reviews.readReview(f.ctx, { ref: record.ref })).toMatchObject({ status: 'ready', value: {
      revision: 2, status: 'resolved', activeRound: null,
      disposition: { choice: 'handle_myself', source: 'direct', answerMessageRef: null, hold: 'held' } } });
    });
});

describe('K3-43 (二) continuation claim versus hold: the continuation claim commits first', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-43 (二) %s: the stale hold loses on the TaskLease revision and the record is unchanged', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    const record = await settledRecord(f, 'k3-43-continuation-claim-first');
    const requeue = await requeueAfterOrigin(f, record);
    const request = await continuationRequest(f, record, 'k3-43-continuation-claim-first-claim', requeue.ref);

    const claimOutcome: { result: Awaited<ReturnType<Fixture['base']['service']['claimTask']>> | null } = {
      result: null };
    let holdSeq = 0;
    // The hold reads the TaskLease@1 and "the original Run is still the
    // selected Run" facts before its commit; this hook commits the whole real
    // continuation claim between that read and the commit.
    const reviewService = createUnknownCallReviewService({
      records: interleaved(f.records, async () => {
        claimOutcome.result = await f.base.makeService(f.records).claimTask(f.ctx, request);
      }),
      reads: createRunStateReader({ records: f.records }),
      readReviewDisplays: async () => ({ status: 'ready', value: new Map([[1, 'full']]) }),
      taskProjection: projectionOver(f.records),
      now: () => '2026-10-08T00:00:00.000Z', eventId: () => `k3-43-continuation-hold-event-${String(++holdSeq)}`,
    });
    const held = await reviewService.holdReview(f.ctx, { input: { reviewRef: record.ref, text: null },
      meta: { requestId: 'k3-43-continuation-claim-first-hold', expected: [{ ref: record.ref, revision: 1 }] } });

    expect(claimOutcome.result, JSON.stringify(claimOutcome.result)).toMatchObject({ status: 'committed', replayed: false });
    const claimed = claimOutcome.result;
    if (claimed === null || claimed.status !== 'committed') throw new Error('the continuation claim must commit');
    expect(held).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    // The record is untouched.
    expect(await f.world.reviews.readReview(f.ctx, { ref: record.ref })).toMatchObject({ status: 'ready', value: {
      revision: 1, status: 'resolved', disposition: null, activeRound: null } });
    // The claim's Run selected the Task and its lease remains held.
    const window = await readGoalPlanWindow(f.records, GOAL_B);
    if (window.status !== 'ready' || window.plan === null) throw new Error('the Plan must read');
    const facts = await readCanonicalTaskFacts(f.records, GOAL_B, window.plan, record.task.taskId);
    if (facts.status !== 'ready') throw new Error(`the projection must read: ${JSON.stringify(facts)}`);
    expect(facts.value.byTaskId.get(record.task.taskId)?.execution).toEqual(claimed.value.runRef);
    const execution = await f.reads.readExecution(f.ctx, claimed.value.runRef);
    if (execution.status !== 'ready') throw new Error(`the Run must read: ${JSON.stringify(execution)}`);
    expect(execution.value.lease).toMatchObject({ holderRunId: claimed.value.runRef.runId });
    expect(execution.value.lease?.release).toBeUndefined();
    });
});

