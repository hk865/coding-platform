/** DRV §5.1 D-F3b: a real review-only `UnknownCallReview` commit wakes the parked Goal through the Host's `goal_waits` wiring (`host.ts:832-851`), and a real second `advanceWork` proves it. */
// Named mutation: remove `'UnknownCallReview'` from `GOAL_WAIT_WAKE_AGGREGATE_TYPES` → the loop stops subscribing, the queue is never woken, and the advance count stays at the parked pass.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { CollaborationDriver, CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import { createCollaborationDriver } from '../../src/app/collaboration-driver.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { WorkflowPort } from '../../src/business/workflow/ports.js';
import {
  observeRecordCommits, type RecordCommitNotice, type RecordCommitObserver,
} from '../../src/composition/commit-observer.js';
import {
  createGoalWaitQueue, createGoalWaitRebuild, createGoalWaitWakes, GOAL_WAITS_QUEUE,
  GOAL_WAIT_WAKE_AGGREGATE_TYPES, WAKE_LIMIT, type GoalWaitRegistries,
} from '../../src/app/goal-wait-wakes.js';
import { createWakeLoop, type WakeLoop } from '../../src/app/wake-loop.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { parkedOnBasis } from '../helpers/DRV-fixture.js';
import { openRealRunHarness, type K3_35RealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  createK3PendingReview, openK3ReviewCardWorld, settleK3Review, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';
import { waitFor } from './harness.js';

// The blocking `shell` stand-in (K3 §5.1): the reviewed Run stays in flight.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
const loops: WakeLoop[] = [];
const drivers: CollaborationDriver[] = [];
type HeldRun = { harness: K3_35RealRunHarness; started?: Promise<unknown> };
const heldRuns: HeldRun[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const held of heldRuns.splice(0)) {
    if (held.started !== undefined) await held.started.catch(() => undefined);
    await held.harness.closeUnion();
  }
  for (const driver of drivers.splice(0)) await driver.close().catch(() => undefined);
  for (const loop of loops.splice(0)) await loop.close();
  for (const world of worlds.splice(0)) await world.close();
});

describe('DRV goal driver queue: D-F3b', () => {
  it('D-F3b a real UnknownCallReview commit wakes the parked Goal through the goal_waits queue', async () => {
    // The world's ONE records backend is observed before any owner is built; the
    // observer keeps the real commit head for the driver's read watermark.
    let head: CommitCursor | null = null;
    let loop: WakeLoop | undefined;
    const observer: RecordCommitObserver = {
      started(value) { if (value !== null && value !== 'unknown') head = value; },
      committed(notice: RecordCommitNotice) { head = notice.cursor; loop?.committed(notice); },
    };
    const observed = deferred<K3ReviewCardWorld['records']>();
    const world = await openK3ReviewCardWorld('memory', {
      wrapRecords: (records) => {
        void observeRecordCommits({ records, close: async () => undefined }, observer)
          .then(backend => { observed.resolve(backend.records as K3ReviewCardWorld['records']); });
        const proxy = {
          ...records,
          async commit(input: Parameters<typeof records.commit>[0]) {
            return await (await observed.promise).commit(input);
          },
        };
        return proxy as K3ReviewCardWorld['records'];
      },
    });
    worlds.push(world);
    await observed.promise;

    // Every review Task gets its real blocked Run and an outstanding review, so
    // the Goal-scope decision has no eligible claim and must park on the review
    // wait it really read.
    const reviews = [];
    for (const [index, taskId] of world.tasks.entries()) {
      reviews.push(await createK3PendingReview(world, { taskId, label: `drv-f3b-${String(index)}`,
        callId: `drv-f3b-call-${String(index)}`, command: 'printf DRV_F3B' }));
    }

    // The base world's second claim enters through the SAME real harness: the
    // production prepare and the Runtime's own `startRun`, held on its shell
    // call so the Goal's selection sees a running Run and asks the Runtime to
    // recover nothing. The last armed shell is this one.
    const harness = await openRealRunHarness(world);
    const heldEntry: HeldRun = { harness };
    heldRuns.push(heldEntry);
    const held = await harness.prepareAndStart(world.fixture.claimRB, {
      model: createScriptedModel([
        { kind: 'calls', calls: [{ callId: 'drv-f3b-claim-rb', name: 'shell',
          args: { command: 'printf DRV_F3B_CLAIM' } }] },
        { kind: 'text', text: 'drv-f3b claim' },
      ]),
      tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
    });
    heldEntry.started = held.started;

    const platform = await world.openPlatform();

    // The Host's own wiring: one registry per scope shared by the queue and the
    // driver, the loop over the real commit notices, and `wake` = the driver's.
    const waits = createGoalWaitWakes();
    const registries: GoalWaitRegistries = { all: () => [{ scope: WORKSPACE_SCOPE, waits }] };
    const wakeLoop = createWakeLoop({ driving: () => true });
    loop = wakeLoop;
    loops.push(wakeLoop);
    // One delegating wrapper counts the driver's real advances (rule sheet A3).
    let advances = 0;
    const realAdvance = platform.workflow.advanceWork.bind(platform.workflow);
    const workflow: WorkflowPort = { ...platform.workflow,
      async advanceWork(ctx, input, internal) {
        advances += 1;
        return await realAdvance(ctx, input, internal);
      } };
    // The Host's exact dependency bag (`host.ts:790-801`): the real ports by
    // property, the public mailbox, and no spread of the whole platform.
    const driver = createCollaborationDriver({
      workflow,
      runtime: platform.runtime,
      sessions: platform.sessions,
      executions: platform.executions,
      mailbox: platform.messages,
      controls: platform.controls,
      profiles: [],
      goalWaits: () => waits,
      observedCursor: () => head,
    });
    drivers.push(driver);
    // A3: the rebuild's two candidate reads are the platform's own published
    // reads; the counters prove the start-up recovery really ran them.
    let candidateReads = 0;
    let acceptedReads = 0;
    const queue = createGoalWaitQueue({ registries,
      wake: async (_scope, goalRef) => driver.wake(world.fixture.ctx, goalRef),
      ctx: () => world.fixture.ctx,
      readMarkerQueries: async () => ({ status: 'ready', value: { items: [], nextCursor: null } }),
      startMarkerQuery: async () => undefined,
      l5PriorityOf: async () => 2,
      // The Host's restart composition over the same real reads (`host.ts:842`).
      // The platform has no installed automation policy, so the Host default
      // (`resumeOnStartup: 'ask'`) holds a pending restart interruption.
      rebuild: createGoalWaitRebuild({
        ctx: () => world.fixture.ctx,
        sessions: platform.sessions,
        facts: platform.sessionFacts,
        released: platform.messageRelease,
        // PL L-05: the same platform's published candidate reads and its real
        // message/Query/Plan owners, not empty or `not_found` stand-ins.
        planCandidates: (...args) => {
          candidateReads += 1;
          return platform.planReaders.planCandidates(...args);
        },
        acceptedCandidatesOf: (...args) => {
          acceptedReads += 1;
          return platform.planReaders.acceptedCandidatesOf(...args);
        },
        messages: platform.messages,
        queries: platform.queries,
        plans: platform.plans,
        held: async (ctx, goalRef) => {
          const read = await platform.plans.queryGoalDisplay!(ctx, { goalRef });
          if (read.status !== 'ready') {
            throw new Error(`the D-F3b Goal display read is not ready: ${JSON.stringify(read)}`);
          }
          return read.value.display.causes.some(cause => 'interruption' in cause);
        },
      }) });
    wakeLoop.register(GOAL_WAITS_QUEUE, queue, {
      aggregateTypes: GOAL_WAIT_WAKE_AGGREGATE_TYPES, maxItems: WAKE_LIMIT,
    });
    await wakeLoop.start([WORKSPACE_SCOPE], { resumeOnStartup: true });
    // The real start-up recovery read both candidate facts; no placeholder answered.
    expect(candidateReads).toBeGreaterThan(0);
    expect(acceptedReads).toBeGreaterThan(0);

    const started = ready<CollaborationSnapshot>(await driver.start(world.fixture.ctx, { advance: {
      schemaVersion: 1, goalRef: GOAL_B, flowId: 'drv-f3b', sessionHint: null, kind: 'select_work',
    }, queryProfileIds: [] }), 'the D-F3b driver start');
    expect(started.state).toBe('running');
    const parked = await waitFor(async () => ready<CollaborationSnapshot>(
      await driver.read(world.fixture.ctx, { goalRef: GOAL_B }), 'the D-F3b driver read'),
    parkedOnBasis, 'D-F3b the parked Goal wait basis');
    // The real basis names what the review waits actually read.
    const basis = (parked.last as unknown as { value?: { waitBasis?: { recordKinds?: readonly string[] } } } | null)
      ?.value?.waitBasis;
    expect(basis?.recordKinds).toEqual(expect.arrayContaining(['UnknownCallReview', 'Goal']));
    const before = advances;

    // The real review-only change: the review owner settles the first record the
    // same way `createK3NeedsDecisionRecord` does, committing only its change.
    await settleK3Review(world, reviews[0]!, { cause: 'review_unavailable' });
    // The notice reaches the Host's queue; the queue's wake makes the driver run
    // its decision pass again. No test call to `wake` exists.
    await expect.poll(() => advances, { timeout: 30_000, interval: 50 }).toBeGreaterThan(before);

    // Let the held claim Run end, then close its real harness (K3-35:794).
    shellSeam.release();
    await held.started.catch(() => undefined);
    await harness.closeUnion();
    heldRuns.splice(heldRuns.indexOf(heldEntry), 1);
  }, 180_000);
});
