/**
 * Slice 2B round-2 R9 (review item 9): the backfill must not report `done` while
 * candidates remain after its read cap (TP-072/TP-091).
 *
 * What it builds and through which public calls:
 *   - a real activity Goal whose initial Plan has 103 work Tasks, adopted
 *     through the real Plan service (`openS2BActivityFixture` with the
 *     `workTaskIds` option), then each Task is claimed through the real
 *     `TaskClaimPort`;
 *   - every Run is prepared and started by the shared real Runtime helper
 *     (`createS2BRuntimeSteps`), observed inside its model gate (the same
 *     Runtime's `observeRun`, so the non-terminal reduction cache exists), and
 *     then ended with one A2 whole-history activity read failure injected only
 *     at the end's re-read. The Run still ends, with a retryable
 *     `unknown('history_read_failed')` activity fact in the same commit;
 *   - the middle 101 candidates are really backfilled first (real
 *     `countRunActivity`, real `recordRunActivity`, `recordedBy: 'backfill'`),
 *     leaving only the newest and oldest candidates;
 *   - the backfill under test then scans newest-first with `readRecordCap: 3`
 *     and `batchRuns: 1` over the REAL Runtime `countRunActivity`.
 *
 * One index page is 100 records; the 101 counted middle Runs force the
 * batch-full probe to stop with a continuation (`next`) before the oldest
 * candidate. The first call must NOT be `done` and must point at that
 * continuation; the second call, using it, reaches the oldest candidate.
 * Assertions go through the Workflow return and the public `readRunActivities`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import {
  createKernelStoreRegistry, type KernelStoreRegistry,
} from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunActivityService } from '../../src/core/work-graph/tasks/run-activity-service.js';
import { createActivityBackfill } from '../../src/business/workflow/activity-backfill.js';
import { createS2BRuntimeSteps, type S2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import {
  openS2BActivityFixture, viewOf, type S2BActivityFixture,
} from '../helpers/S2B-activity-fixture.js';

const T0 = Date.parse('2026-10-20T00:00:00.000Z');
const atMin = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
/** The index page is 100 records; 101 counted Runs force the scan past one page. */
const COUNTED_RUNS = 101;
const WORK_TASKS = Array.from({ length: COUNTED_RUNS + 2 }, (_, index) => `work-${String(index + 1)}`);
const NEWEST_TASK = WORK_TASKS[0]!;
const OLDEST_TASK = WORK_TASKS[WORK_TASKS.length - 1]!;
const MIDDLE_TASKS = WORK_TASKS.slice(1, -1);
/** Newest candidate, then the counted stretch, then the oldest candidate. */
const NEWEST_END = atMin(-60);
const OLDEST_END = atMin(-200);
const MIDDLE_END = (index: number): string => atMin(-61 - index);

let fixture: S2BActivityFixture | null = null;
let steps: S2BRuntimeSteps | null = null;
afterEach(async () => {
  await steps?.close();
  await fixture?.close();
  steps = null; fixture = null;
});

type Injection = {
  /** Fail the next whole-history read that starts just after `afterPosition`. */
  arm(afterPosition: number): void;
  stores: KernelStoreRegistry;
};

/**
 * A2: a delegating Kernel-store wrapper. It opens/uses the real store and only
 * replaces `read` for the one armed whole-history activity window; every other
 * read (and every read after the throw) returns the real result unchanged.
 */
async function failingActivityReads(f: S2BActivityFixture): Promise<Injection> {
  const registry = await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel',
    storeKey: 'r4c-claim-kernel-store', workspace: f.b2.base.scope,
    databasePath: `${f.b2.base.directory}/kernel.sqlite` }] });
  let afterPosition: number | null = null;
  return {
    arm: (after) => { afterPosition = after; },
    stores: {
      forWorkspace: (workspace) => registry.forWorkspace(workspace),
      byAdapterId: (adapterId) => registry.byAdapterId(adapterId),
      async withStore(adapterId, use) {
        return registry.withStore(adapterId, async (store) => {
          if (afterPosition === null) return use(store);
          const original = store.read.bind(store);
          (store as unknown as { read: typeof original }).read = async (sessionId, after, limit, options) => {
            if (afterPosition !== null && after === afterPosition && limit > 1) {
              afterPosition = null;
              throw new Error('S2B A2: the whole-history activity re-read failed once');
            }
            return original(sessionId, after, limit, options);
          };
          return use(store);
        });
      },
    },
  };
}

/**
 * Claim one Task, prepare/start its real Run, observe it inside the model gate,
 * then release the reply with the armed A2 failure so the end commits
 * `unknown('history_read_failed')` while the Run still ends.
 */
async function endUnrecorded(
  f: S2BActivityFixture, runtimeSteps: S2BRuntimeSteps, injection: Injection,
  taskId: string, startedAt: string, endedAt: string,
): Promise<RunRef> {
  // Each Run gets its own real Session and Kernel Session, so a fresh turn
  // starts at position 2 and the armed A2 read is unambiguous.
  const sessionRef = await f.b2.base.createSession(`s2b-r9-session-${taskId}`);
  const claim = await f.claimWork(taskId, sessionRef);
  const handle = await runtimeSteps.start(claim, {
    at: startedAt, replies: [{ kind: 'text', text: `S2B R9 ${taskId} finished` }],
  });
  await handle.entered;
  const read = await createRunStateReader({ records: f.records }).readExecution(f.ctx, claim.runRef);
  if (read.status !== 'ready') throw new Error(`the R9 Run read failed: ${JSON.stringify(read)}`);
  const startPosition = read.value.run.executionHistory?.startPosition;
  if (startPosition === undefined) throw new Error('the R9 Run has no execution history locator');
  // The non-terminal observation establishes the reduction cache the end reuses.
  const observed = await runtimeSteps.runtime.port.observeRun(f.ctx, { runRef: claim.runRef });
  if (observed.status !== 'ready' || observed.value.run.status !== 'running') {
    throw new Error(`the R9 gate observation was not ready: ${JSON.stringify(observed)}`);
  }
  injection.arm(startPosition - 1);
  await runtimeSteps.finish(handle, endedAt, 'completed');
  return claim.runRef;
}

describe('S2B round 2 R9 — the backfill keeps the scan continuation', () => {
  it('R9 the batch-full probe keeps a non-null continuation instead of declaring done', async () => {
    fixture = await openS2BActivityFixture('memory', { workTaskIds: WORK_TASKS });
    const f = fixture;
    await f.ensureRecording(atMin(-300));

    const injection = await failingActivityReads(f);
    let clock = atMin(0);
    let seq = 0;
    const runtimeSteps = await createS2BRuntimeSteps({
      base: f.b2.base, bodies: f.b2.bodies, ctx: f.ctx, directory: f.b2.base.directory,
      scope: f.b2.base.scope, now: () => clock, setClock: (at) => { clock = at; },
      eventId: () => `s2b-r9-event-${++seq}`, newId: () => `s2b-r9-id-${++seq}`,
      consumerId: 's2b-r9-runtime', kernelStores: injection.stores,
    });
    steps = runtimeSteps;

    // 1. The middle 101 real ends: each commits a retryable `unknown` candidate.
    const middle: RunRef[] = [];
    for (const [index, taskId] of MIDDLE_TASKS.entries()) {
      middle.push(await endUnrecorded(f, runtimeSteps, injection, taskId,
        atMin(-200), MIDDLE_END(index)));
    }
    // 2. Restore reads (each A2 failure is spent) and backfill the middle 101 for
    //    real; their counted facts then form the stretch between the candidates.
    expect(middle).toHaveLength(COUNTED_RUNS);
    const countRunActivity = runtimeSteps.runtime.port.countRunActivity;
    if (countRunActivity === undefined) throw new Error('the real Runtime does not publish countRunActivity');
    const middleBackfill = createActivityBackfill({
      runtime: { countRunActivity: countRunActivity.bind(runtimeSteps.runtime.port) },
      activity: f.activity, now: () => atMin(0), batchRuns: COUNTED_RUNS,
    });
    const countedMiddle = await middleBackfill.backfillActivityRange(f.ctx, {
      workspace: f.b2.base.scope, from: atMin(-161), to: atMin(-60), cursor: null,
    });
    expect(countedMiddle.status).toBe('ready');
    if (countedMiddle.status !== 'ready') return;
    expect(countedMiddle.value.processed).toHaveLength(COUNTED_RUNS);
    expect(countedMiddle.value.processed.every(batch => batch.outcome === 'counted')).toBe(true);
    expect(countedMiddle.value.done).toBe(true);
    expect(countedMiddle.value.next).toBeNull();

    // 3. The two real end candidates, newest and oldest.
    const firstCandidate = await endUnrecorded(f, runtimeSteps, injection, NEWEST_TASK,
      atMin(-200), NEWEST_END);
    const missing = await endUnrecorded(f, runtimeSteps, injection, OLDEST_TASK,
      atMin(-200), OLDEST_END);

    // The corrected R-6 shape: a candidate is a real end whose activity is a
    // retryable `unknown`, not a Run without any activity record.
    expect(viewOf(await f.readRuns([firstCandidate]), firstCandidate.runId)).toMatchObject({
      status: 'unknown', reason: 'history_read_failed',
    });
    expect(viewOf(await f.readRuns([missing]), missing.runId)).toMatchObject({
      status: 'unknown', reason: 'history_read_failed',
    });

    // The candidate under test: real service, real Runtime count, one page cap.
    const activity = createRunActivityService({ records: f.records, now: () => atMin(0),
      eventId: () => `s2b-r9-activity-event-${++seq}`, readRecordCap: 3 });
    const backfill = createActivityBackfill({
      runtime: { countRunActivity: countRunActivity.bind(runtimeSteps.runtime.port) },
      activity, now: () => atMin(0), batchRuns: 1,
    });

    const first = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.value.processed).toEqual([{ kind: 'run', runRef: firstCandidate, outcome: 'counted', reason: null }]);
    expect(first.value.done).toBe(false);
    expect(first.value.next).not.toBeNull();

    const second = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: first.value.next });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    expect(second.value.processed).toEqual([{ kind: 'run', runRef: missing, outcome: 'counted', reason: null }]);
    expect(second.value.done).toBe(true);
    expect(second.value.next).toBeNull();

    expect(viewOf(await f.readRuns([missing]), missing.runId)).toMatchObject({
      status: 'counted', recordedBy: 'backfill',
    });
    expect(viewOf(await f.readRuns([firstCandidate]), firstCandidate.runId)).toMatchObject({
      status: 'counted', recordedBy: 'backfill',
    });
  }, 60_000);
});
