/**
 * Slice 2B row 2B-44 (entry BE1r, L4/L8; the backfill vs late-evidence race) — a
 * human range backfill is selected for a Run whose startup reconcile could not
 * read the Kernel (RUN-20(ii), `unknown('kernel_unreadable')`); its RunActivity
 * write is stopped at the RecordStore boundary; the late tool result then lets
 * RUN-21 book the complete `counted` end first; releasing the backfill gets
 * L8's `record_changed` and never overwrites the RUN-21 record.
 *
 * Fixture (built only through public calls; follows
 * `tests/runtime/S2B-45-inprocess-run21-activity.test.ts` and
 * `tests/runtime/A2-reconcile-runtime.test.ts:268-318`):
 * - one real Runtime over `createS2BRuntimeStoreFixture` (memory) drives the real
 *   Turn with `blockingTool` (copied unchanged in `S2B-runtime-tools-support.ts`)
 *   held in flight;
 * - the restart's Kernel-storage probe is injected `missing` through
 *   `withProbeMissing` (`S2B-be1r2-support.ts`) → RUN-20(ii);
 * - the Kernel storage recovers; the human range backfill is built on the same
 *   store (`createRunActivityService` + `createActivityBackfill`) and its
 *   `commit` is held at the RecordStore boundary by `createPausingRecords`;
 * - releasing the tool lets RUN-21 book the late terminal in process on the
 *   recovered Runtime; the backfill then reports `skipped` / `record_changed`.
 *
 * Assertions go through `readRunActivities` (L10). Read failures are never
 * turned into 0 or empty (rule 3).
 */
import { afterEach, expect, it } from 'vitest';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import type { HostInstanceFacts } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunActivityService } from '../../src/core/work-graph/tasks/run-activity-service.js';
import { createActivityBackfill } from '../../src/business/workflow/activity-backfill.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { B2_AT } from '../helpers/B2-runtime-fixture.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { blockingTool } from '../helpers/S2B-runtime-tools-support.js';
import { createPausingRecords, restartedHostOver, withProbeMissing } from '../helpers/S2B-be1r2-support.js';
import { S2B_SLOW_TIMEOUT_MS } from '../helpers/S2B-be1-platform-fixture.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

const HOST_1: HostInstanceFacts = { hostInstanceId: 's2b-44-host-1', lease: 'owned' };
const HOST_2: HostInstanceFacts = { hostInstanceId: 's2b-44-host-2', lease: 'owned' };
const BACKFILL_AT = '2026-09-26T02:00:00.000Z';
const RUN21_AT = '2026-09-26T03:00:00.000Z';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

/** Install one controlled Kernel tool through the real public seam (as A2/R4). */
function withTool(kernel: RuntimeExecutionDependencies['kernel'], tool: ToolDefinition): RuntimeExecutionDependencies['kernel'] {
  return {
    ...kernel,
    runCodingAgent: (options) => kernel.runCodingAgent({ ...options,
      config: { ...options.config, tools: { ...options.config.tools, enabledNames: [...options.config.tools.enabledNames, tool.name] } },
      additionalTools: (workspace) => [...(options.additionalTools?.(workspace) ?? []), tool] }),
  };
}

function controlsOn(fx: S2BRuntimeStoreFixture) {
  let seq = 0;
  return createRunControlService({
    records: fx.claimFixture.records,
    authority: createMaterialRecordReaders(fx.claimFixture.records).authority,
    reads: createRunStateReader({ records: fx.claimFixture.records }),
    now: () => B2_AT,
    eventId: () => `s2b-44-control-event-${++seq}`,
  });
}

const humanHost = (fixture: S2BRuntimeStoreFixture): CoreCallContext => {
  const actor = { kind: 'human' as const, id: 's2b-44-operator' };
  return { ...fixture.ctx, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId, actor } };
};

it('2B-44 (BE1r): a backfill stopped at the RecordStore boundary loses to RUN-21 and reports skipped/record_changed', async () => {
  const toolName = 's2b-44-late-tool';
  const entered = deferred();
  const release = deferred();
  const fx = await createS2BRuntimeStoreFixture({
    additionalSchemas: CONTROL_RECORD_SCHEMAS,
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 's2b-44-late-call', name: toolName, args: {} }] },
      { kind: 'text', text: 'S2B 2B-44 text the old process never reaches' },
    ],
  });
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const crashed = createAgentRuntime({ ...deps, controls,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await crashed.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 's2b-44-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = crashed.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-44-driver', requestId: 's2b-44-start' });
  try {
    await entered.promise;
    // The restart's probe cannot read the mapped Kernel store: RUN-20(ii).
    const fault = { missing: true };
    const second = restartedHostOver(fx, HOST_2, controls, withProbeMissing(fx.deps.kernelStores, fault));
    expect(await second.reconcile()).toMatchObject({ row: 'W-14', status: 'reconciled' });
    const unknown = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
    expect(unknown.status).toBe('ready');
    if (unknown.status !== 'ready') return;
    expect(unknown.value[0]).toMatchObject({
      runRef: fx.claim.runRef, status: 'unknown', reason: 'kernel_unreadable', recordedBy: 'run_end',
    });

    // The Kernel storage recovers; the human range backfill is built on the same
    // store and its RunActivity write is held at the RecordStore boundary.
    fault.missing = false;
    const paused = createPausingRecords(fx.records);
    const backfillActivity = createRunActivityService({ records: paused.records,
      now: () => BACKFILL_AT, eventId: () => 's2b-44-backfill-event' });
    const backfill = createActivityBackfill({
      runtime: { countRunActivity: (ctx, input) => fx.runtime.port.countRunActivity!(ctx, input) },
      activity: backfillActivity, now: () => BACKFILL_AT, batchRuns: 1,
    });
    paused.arm();
    const pending = backfill.backfillActivityRange(humanHost(fx), {
      workspace: fx.scope, from: '2026-09-25T00:00:00.000Z', to: '2026-09-27T00:00:00.000Z', cursor: null,
    });
    await paused.entered;

    // The old process's late tool result: its next model admission is refused,
    // its Turn ends with that failure and it books nothing.
    release.resolve();
    await running;

    // RUN-21 in process on the recovered Runtime books the late terminal first.
    fx.setNow(RUN21_AT);
    const runtime = createAgentRuntime({ ...second.deps, controls });
    const observed = await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
    expect(observed).toMatchObject({ status: 'ready', value: { run: { status: 'ended',
      reconciliation: { basis: { kind: 'live_clean' }, observation: { kind: 'runtime_terminal' } } } } });

    // Releasing the backfill's commit now loses to the RUN-21 revision.
    paused.release();
    const batch = await pending;
    expect(batch.status).toBe('ready');
    if (batch.status !== 'ready') return;
    expect(batch.value.processed).toEqual([
      { kind: 'run', runRef: fx.claim.runRef, outcome: 'skipped', reason: 'record_changed' },
    ]);

    const final = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
    expect(final.status).toBe('ready');
    if (final.status !== 'ready') return;
    expect(final.value[0]).toMatchObject({
      runRef: fx.claim.runRef, status: 'counted', recordedBy: 'run_end',
      countedThroughTurnEnd: true, unresolvedCalls: 0, recordedAt: RUN21_AT,
    });
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, S2B_SLOW_TIMEOUT_MS);
