/**
 * K3-15 (四)(五) routes and the L21 ruling-4 `release-hold` response.
 *
 * The two human routes run over the REAL frozen `CORE_ROUTE_SPECS` table,
 * `parseCoreRouteRequest`, `dispatchCoreRoute` and
 * `createPlatformCoreRouteBindings`; the review owner, the claim/reconcile
 * owners and the Task projection are the real services over the real
 * RecordStore. The platform groups these routes do not touch are inert stubs so
 * the assembled binding table still type-checks; no assertion reads a stub.
 *
 * The records are reached through the shared public steps only, on memory and
 * SQLite (`openK3ReviewCardWorld(kind)`): the `pending_review` record is the real
 * blocked Run the Host recognition path produced (`createK3PendingReview`), the
 * claimed-but-unentered round is the real TASK-03r claim, and the auto-settled
 * record is the real read-only Run (`world.createRecord(..., { autoSettled:
 * true })`). No draft, item, event or record is built here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewRef, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import {
  createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest,
  type CoreRoutePlatform,
} from '../../src/app/core-routes.js';
import type { CoreRouteSuffix, UnknownCallReviewReleaseHoldValue } from '../../src/app/core-http-types.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  createK3PendingReview, openK3ReviewCardWorld, readK3Review,
  type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { GOAL_B, PLAN_B2 } from '../helpers/S5-decision-fixture.js';
import { readToolSeam, shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-ins hoisted per test file: the real blocked record Run uses the
// `shell` stand-in and the auto-settled record Run the `read` one. The Run's
// call is the Kernel's real fact; the seam only holds it in flight.
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
  bindings: ReturnType<typeof createPlatformCoreRouteBindings>;
};

/** A platform where every group a route does not use answers an inert stub. */
function routePlatform(groups: Partial<Record<keyof CoreRoutePlatform, unknown>>): CoreRoutePlatform {
  const stub = new Proxy({}, { get: () => async () => ({
    status: 'rejected' as const, code: 'unsupported' as const, reason: 'the K3-15 route test stub is not a real owner',
  }) });
  return new Proxy(groups, { get: (target, key) => key in target ? Reflect.get(target, key) : stub }) as unknown as CoreRoutePlatform;
}

async function fixture(kind: 'memory' | 'sqlite'): Promise<Fixture> {
  const world = await openK3ReviewCardWorld(kind);
  const reads = createRunStateReader({ records: world.records });
  let seq = 0;
  const requeues = createTaskRequeueService({ records: world.records, reads,
    workspaceHost: { async resolveRoot() {
      return { status: 'ready' as const, value: { root: world.fixture.base.directory, workspaceRevision: 1 } };
    } },
    source: { async captureDigest() { return { status: 'ready' as const, sourceDigest: 'a'.repeat(64) }; } },
    materials: { async storeArtifact() { throw new Error('no note'); }, async openArtifact() { throw new Error('no artifact'); } },
    messages: { async readMessage() { return { status: 'not_found' as const }; } },
    now: () => world.fixture.now(), eventId: () => `k3-15-routes-requeue-event-${String(++seq)}` });
  const bindings = createPlatformCoreRouteBindings(routePlatform({
    claims: { requeueTask: requeues.requeueTask },
    executions: reads,
    plans: world.fixture.b2.base.plans,
    unknownCallReviews: world.reviews,
  }));
  return { world, reviews: world.reviews, bindings };
}

/** TASK-03r: the real claim owner writes the record's `activeRound` (no entry yet). */
async function claimUnenteredRound(world: K3ReviewCardWorld, record: UnknownCallReviewV1): Promise<RunRef> {
  const session = await world.fixture.createS5Session(`k3-15-routes-review-${record.ref.runId}`);
  const claim = await world.fixture.claimRun({ requestId: `k3-15-routes-claim-${record.ref.runId}`,
    goalRef: GOAL_B, planRef: PLAN_B2, taskId: record.task.taskId, sessionRef: session,
    review: { reviewRef: record.ref, expectedRevision: record.revision, phase: 'review' } });
  return claim.runRef;
}

function scopeOf(world: K3ReviewCardWorld) {
  return { projectId: world.fixture.base.scope.projectId, workspaceId: world.fixture.base.scope.workspaceId };
}

function call(f: Fixture, suffix: CoreRouteSuffix, body: unknown, ctx: CoreCallContext = f.world.fixture.ctx): Promise<unknown> {
  const parsed = parseCoreRouteRequest(suffix, body);
  if (!parsed.ok) throw new Error(`parse: ${JSON.stringify(parsed.rejection)}`);
  return dispatchCoreRoute(f.bindings, suffix, ctx, parsed);
}

function graphWrite(world: K3ReviewCardWorld, input: unknown, requestId: string, expected: unknown[]): unknown {
  return { scope: scopeOf(world), request: { input, meta: { requestId, expected } } };
}

const fixtures: Fixture[] = [];
afterEach(async () => {
  shellSeam.release();
  readToolSeam.release();
  for (const entry of fixtures.splice(0)) await entry.world.close();
});

describe('K3-15 (四)(五) review write routes', () => {
  it.each(['memory', 'sqlite'] as const)('K3-15 (四) %s route: a person holds a claimed-but-unentered round; a member is forbidden; release before settle is busy', async kind => {
    const f = await fixture(kind);
    fixtures.push(f);
    const created = await createK3PendingReview(f.world, {
      label: 'k3-15-routes', callId: 'k3-15-routes-call-1', command: 'echo hi',
    });
    expect(created).toMatchObject({ status: 'pending_review', revision: 1 });
    const reviewRef = created.ref;
    const roundRef = await claimUnenteredRound(f.world, created);
    const record = await readK3Review(f.world, reviewRef);
    expect(record).toMatchObject({ revision: 2, activeRound: { phase: 'review' } });

    // The owner is human-only; a Work-Run caller cannot use the route.
    const memberCtx: CoreCallContext = { ...f.world.fixture.ctx,
      principal: { kind: 'work_run', runRef: created.runRef, roleBinding: f.world.fixture.b2.base.roleBinding },
      materialReader: { kind: 'run', requester: created.runRef } };
    await expect(call(f, 'unknown-call-reviews/hold',
      graphWrite(f.world, { reviewRef, text: null }, 'k3-15-routes-hold-member', [{ ref: reviewRef, revision: 2 }]), memberCtx))
      .rejects.toMatchObject({ rejection: { status: 'rejected', code: 'forbidden',
        reason: 'holdReview is a human operator action' } });

    const held = await call(f, 'unknown-call-reviews/hold',
      graphWrite(f.world, { reviewRef, text: 'I will handle this' }, 'k3-15-routes-hold',
        [{ ref: reviewRef, revision: 2 }])) as WriteResult<UnknownCallReviewV1>;
    expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed', replayed: false, value: {
      revision: 3, status: 'resolved', disposition: { choice: 'handle_myself', source: 'direct', hold: 'held',
        text: 'I will handle this' }, activeRound: { runRef: roundRef } } });

    // UCR-14/D3: release-hold while the round is active is the owner's busy
    // rejection; the route fails with it (it succeeds iff releaseHold did).
    await expect(call(f, 'unknown-call-reviews/release-hold',
      graphWrite(f.world, { reviewRef }, 'k3-15-routes-release-busy', [{ ref: reviewRef, revision: 3 }])))
      .rejects.toMatchObject({ rejection: { status: 'rejected', code: 'busy', reason: '核对轮还没收尾' } });
    expect(await readK3Review(f.world, reviewRef)).toMatchObject({ revision: 3, disposition: { hold: 'held' },
      activeRound: { phase: 'review' } });
  });

  it.each(['memory', 'sqlite'] as const)('K3-15 (五) %s route: release-hold returns { hold, requeue: null } when the original Run is not human-fenced, and replays', async kind => {
    const f = await fixture(kind);
    fixtures.push(f);
    // An empty complete inventory auto-settles: no round, no human fence.
    const record = await f.world.createRecord('k3-20-a', { autoSettled: true });
    const reviewRef: UnknownCallReviewRef = record.ref;
    expect(record).toMatchObject({ revision: 1, status: 'resolved', activeRound: null });
    const held = await call(f, 'unknown-call-reviews/hold',
      graphWrite(f.world, { reviewRef, text: null }, 'k3-15-routes-hold-settled',
        [{ ref: reviewRef, revision: 1 }])) as WriteResult<UnknownCallReviewV1>;
    expect(held).toMatchObject({ status: 'committed', value: { revision: 2, disposition: { hold: 'held' } } });

    const body = graphWrite(f.world, { reviewRef }, 'k3-15-routes-release', [{ ref: reviewRef, revision: 2 }]);
    const released = await call(f, 'unknown-call-reviews/release-hold', body) as WriteResult<UnknownCallReviewReleaseHoldValue>;
    expect(released, JSON.stringify(released)).toMatchObject({ status: 'committed', replayed: false, value: {
      hold: { status: 'committed', replayed: false, value: { revision: 3, disposition: { hold: 'released' } } },
      requeue: null } });

    // The same click replays releaseHold; the requeue side stays null.
    const replay = await call(f, 'unknown-call-reviews/release-hold', body) as WriteResult<UnknownCallReviewReleaseHoldValue>;
    expect(replay).toMatchObject({ status: 'committed', replayed: true, value: {
      hold: { status: 'committed', replayed: true }, requeue: null } });
  });
});
