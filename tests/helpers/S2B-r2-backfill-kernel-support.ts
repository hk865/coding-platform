/**
 * Slice 2B round-2 Group B helper: real Kernel-history Runs for the backfill.
 *
 * What it builds and through which public calls:
 *   - one real SQLite RecordStore + Kernel store through
 *     `createS2BRuntimeStoreFixture` (real goals/plans/sessions/claims, the real
 *     Runtime and the frozen Kernel with a local scripted model);
 *   - the driver Runs through the real `RuntimeExecutionPort`
 *     (`prepareExecution` + `startRun`), so every Run has a real position record
 *     and a real Kernel Turn the backfill's `countRunActivity` can read;
 *   - the workspace `ActivityRecording` and the backfill writes only through the
 *     public `createRunActivityService` / `createActivityBackfill` (or the app
 *     Host in the test);
 *   - a `reopen()`ed secondary connection (SQLite) so a test can assert through
 *     the public activity reads while an app Host owns the directory.
 *
 * The driver Runs must be built while the test's test-only "counting off" module
 * double is on (spec §7/F34) so their end commits carry no `activity`; the test
 * toggles the double, this helper only drives the real Runtime. No model call
 * reaches the network.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_TOKEN_PLACEHOLDER } from '../../src/app/core-http-types.js';
import { PLATFORM_TOKEN_META_NAME } from './host-page.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { createRunActivityService } from '../../src/core/work-graph/tasks/run-activity-service.js';
import {
  createActivityBackfill, type ActivityBackfillOperations,
} from '../../src/business/workflow/activity-backfill.js';
import type { LocalWorkbenchHost } from '../../src/app/host.js';
import {
  createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture,
} from './S2B-runtime-store-fixture.js';
import type { ScriptedReply } from './B2-runtime-fixture.js';

/** The one real workspace file every scripted `read` call opens. */
const READ_PATH = 'b2-read.txt';

/**
 * A tiny static page whose only job is to expose this Host instance's temporary
 * bearer token, so a test can drive the real Host HTTP route. It lives under the
 * required scratch directory and contains only the placeholder the server
 * substitutes.
 */
const HOST_PUBLIC_DIR = fileURLToPath(new URL('../../.dsh-scratch/s2b-r2-kernel-host-public/', import.meta.url));

/** One driver Run on the fixture's first/second work task, ended at `at`. */
export type KernelBackfillRunSpec = { at: string; calls: number };

export type KernelBackfillFixture = {
  fx: S2BRuntimeStoreFixture;
  runs: { ref: RunRef; taskId: string; calls: number; at: string }[];
  scope: WorkspaceScope;
  goalRef: GoalRef;
  directory: string;
  /** The Workflow operations over the live store and the real Runtime `countRunActivity`. */
  backfill(options: { now: () => string; batchRuns?: number; maxPages?: number }): ActivityBackfillOperations;
  /** The public activity reads over the live (secondary) store. */
  reads(): S2BRuntimeStoreFixture['activity'];
};

/**
 * Drives `specs[0]` on the fixture's pre-claimed first task and `specs[1]` (if
 * present) on the second task, then reopens the SQLite store for reads. The
 * caller must set its counting-off double on before calling.
 */
export async function openKernelBackfillRuns(
  specs: readonly KernelBackfillRunSpec[],
): Promise<KernelBackfillFixture> {
  if (specs.length === 0 || specs.length > 2) throw new Error('S2B round-2 kernel backfill supports one or two Runs');
  const replies: ScriptedReply[] = [];
  for (const [index, spec] of specs.entries()) {
    replies.push({ kind: 'calls', calls: Array.from({ length: spec.calls }, (_value, call) => ({
      callId: `s2b-r2-kernel-${String(index)}-${String(call)}`, name: 'read', args: { path: READ_PATH } })) });
    replies.push({ kind: 'text', text: `S2B round-2 kernel Run ${String(index)} done` });
  }
  const fx = await createS2BRuntimeStoreFixture({ kind: 'sqlite', scriptedReplies: replies });
  const runs: KernelBackfillFixture['runs'] = [];
  for (const [index, spec] of specs.entries()) {
    const target = index === 0
      ? { runRef: fx.claim.runRef, taskId: fx.claim.task.taskId }
      : await claimSecond(fx);
    fx.allowRun(target.runRef);
    fx.setNow(spec.at);
    const prepared = await fx.runtime.port.prepareExecution(fx.ctx, {
      runRef: target.runRef, requestId: `s2b-r2-kernel-${String(index)}-prepare` });
    if (prepared.status !== 'ready') throw new Error(`S2B round-2 prepare failed: ${JSON.stringify(prepared)}`);
    const started = await fx.runtime.port.startRun(fx.ctx, { prepared: prepared.value,
      consumerId: `s2b-r2-kernel-${String(index)}-driver`, requestId: `s2b-r2-kernel-${String(index)}-start` });
    if (started.status !== 'ready') throw new Error(`S2B round-2 start failed: ${JSON.stringify(started)}`);
    runs.push({ ref: target.runRef, taskId: target.taskId, calls: spec.calls, at: spec.at });
  }
  await fx.reopen();
  let seq = 0;
  const fixture: KernelBackfillFixture = {
    fx, runs, scope: fx.scope, goalRef: fx.claimFixture.goalRef, directory: fx.directory,
    backfill(options) {
      const activity = createRunActivityService({ records: fx.records, now: options.now,
        eventId: () => `s2b-r2-kernel-activity-${++seq}` });
      return createActivityBackfill({
        runtime: { countRunActivity: (ctx, input) => fx.runtime.port.countRunActivity!(ctx, input) },
        activity, now: options.now,
        ...(options.batchRuns === undefined ? {} : { batchRuns: options.batchRuns }),
        ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
      });
    },
    reads() { return fx.activity; },
  };
  return fixture;
}

/** Claims the fixture's second work task into the first Session (the DAG edge is not a claim gate). */
async function claimSecond(fx: S2BRuntimeStoreFixture): Promise<{ runRef: RunRef; taskId: string }> {
  const taskId = fx.claimFixture.tasks.second.taskId;
  const request = await fx.claimFixture.buildRequest({ input: { taskId, sessionRef: fx.claim.sessionRef } });
  const claimed = await fx.claimFixture.service.claimTask(fx.ctx, request);
  if (claimed.status !== 'committed') throw new Error(`S2B round-2 second claim failed: ${JSON.stringify(claimed)}`);
  return { runRef: claimed.value.runRef, taskId };
}

/** The app Host over the same directory, leased by `actorId` at `now`. */
export async function startKernelBackfillHost(
  fixture: KernelBackfillFixture, now: () => string, actorId = 's2b-r2-kernel-host',
): Promise<LocalWorkbenchHost> {
  const hostModule = await import('../../src/app/host.js');
  // The Host owns one random per-instance token; the placeholder page lets a
  // test learn it through the real page and then call the real route.
  await mkdir(HOST_PUBLIC_DIR, { recursive: true });
  await writeFile(join(HOST_PUBLIC_DIR, 'index.html'),
    `<!doctype html><meta name="${PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  // PC-2 ruling 2: the prompt directory lives under the settings directory, so
  // the settings directory must be outside the workspace root.
  const settingsDirectory = await mkdtemp(join(tmpdir(), 's2b-r2-kernel-settings-'));
  const host = await hostModule.createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: fixture.directory },
    actor: { kind: 'human', id: actorId },
    workspaces: [{ scope: { projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId },
      name: 'S2B round-2 kernel backfill host', root: fixture.directory, workspaceRevision: 1, readPrefixes: ['.'] }],
    kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
      workspace: fixture.scope, databasePath: join(fixture.directory, 'kernel.sqlite') }] },
    settings: { settingsDirectory },
    now,
    publicDir: HOST_PUBLIC_DIR,
  });
  const close = host.close.bind(host);
  return {
    ...host,
    close: async () => {
      try { await close(); }
      finally { await rm(settingsDirectory, { recursive: true, force: true }); }
    },
  };
}
