/**
 * Slice 2B row 2B-45 (entry BE1r, L4/L5; RUN-21 in process) — a `counted` tally
 * that did not reach the Turn end is replaced in process by the late evidence,
 * through `bookLateEvidenceInProcess` on the new Runtime.
 *
 * Fixture (built only through public calls; follows
 * `tests/runtime/A2-reconcile-runtime.test.ts:292` "RUN-21 in process"):
 * - one real Runtime over `createS2BRuntimeStoreFixture` (memory) drives the real
 *   Turn with `blockingTool` (copied unchanged in `S2B-runtime-tools-support.ts`)
 *   held in flight;
 * - a restart (`restartedHost`) reconciles RUN-20(i): `counted`,
 *   `countedThroughTurnEnd: false`, `unresolvedCalls: 1`, one step;
 * - releasing the tool lets the old process end its Turn (it books nothing); the
 *   new Runtime's next `observeRun` books the late terminal as RUN-21
 *   (`live_clean`) and the record becomes `counted` through the Turn end.
 *
 * The read is asserted through `readRunActivities` (L10). Per §9.3 #2 only the
 * reachable replacement is asserted: the Turn end, `unresolvedCalls: 0` and
 * `countedThroughTurnEnd: true`; the old process cannot get a second model
 * reply, so no extra usage/`complete: true` is claimed.
 */
import { afterEach, expect, it } from 'vitest';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import type { HostInstanceFacts } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { B2_AT } from '../helpers/B2-runtime-fixture.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { blockingTool, restartedHost } from '../helpers/S2B-runtime-tools-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

const HOST_1: HostInstanceFacts = { hostInstanceId: 's2b-45-host-1', lease: 'owned' };
const HOST_2: HostInstanceFacts = { hostInstanceId: 's2b-45-host-2', lease: 'owned' };

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
    eventId: () => `s2b-45-control-event-${++seq}`,
  });
}

it('2B-45 (BE1r): in-process RUN-21 replaces an incomplete counted tally with the complete one (steps stay 1)', async () => {
  const toolName = 's2b-45-late-tool';
  const entered = deferred();
  const release = deferred();
  const fx = await createS2BRuntimeStoreFixture({
    additionalSchemas: CONTROL_RECORD_SCHEMAS,
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 's2b-45-late-call', name: toolName, args: {} }] },
      { kind: 'text', text: 'S2B 2B-45 done after the late tool result' },
    ],
  });
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const crashed = createAgentRuntime({ ...deps, controls,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await crashed.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 's2b-45-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = crashed.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-45-driver', requestId: 's2b-45-start' });
  try {
    await entered.promise;
    // Restart while the tool is in flight: RUN-20(i) books an incomplete counted tally.
    const second = restartedHost(fx, HOST_2, controls);
    expect(await second.reconcile()).toMatchObject({ row: 'W-13', status: 'reconciled' });

    const mid = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
    expect(mid.status).toBe('ready');
    if (mid.status !== 'ready') return;
    expect(mid.value).toHaveLength(1);
    expect(mid.value[0]).toMatchObject({
      runRef: fx.claim.runRef, status: 'counted', recordedBy: 'run_end',
      totals: { steps: 1, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: false, unresolvedCalls: 1,
    });
    const midRecordedAt = mid.value[0]!.recordedAt;

    // One observation on the new Runtime: the unknown end is unchanged (no new evidence).
    const runtime = createAgentRuntime({ ...second.deps, controls });
    expect(await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef })).toMatchObject({
      status: 'ready', value: { run: { status: 'ended', outcome: 'outcome_unknown' } } });
    const unchanged = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
    expect(unchanged.status).toBe('ready');
    if (unchanged.status === 'ready') expect(unchanged.value[0]!.recordedAt).toBe(midRecordedAt);

    // The old process's late tool result: its next model admission is refused and
    // its Turn ends without booking anything.
    release.resolve();
    await running;
    const afterOldProcess = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
    expect(afterOldProcess.status).toBe('ready');
    if (afterOldProcess.status === 'ready') expect(afterOldProcess.value[0]!.recordedAt).toBe(midRecordedAt);

    // RUN-21 in process: the late Kernel terminal is booked on the live proof.
    const run21At = '2026-09-26T00:10:00.000Z';
    fx.setNow(run21At);
    const observed = await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
    expect(observed).toMatchObject({ status: 'ready', value: { run: { status: 'ended',
      reconciliation: { basis: { kind: 'live_clean' }, observation: { kind: 'runtime_terminal' } } } } });

    const final = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
    expect(final.status).toBe('ready');
    if (final.status !== 'ready') return;
    expect(final.value).toHaveLength(1);
    expect(final.value[0]).toMatchObject({
      runRef: fx.claim.runRef, status: 'counted', recordedBy: 'run_end',
      totals: { steps: 1, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: true, unresolvedCalls: 0,
      recordedAt: run21At,
    });
    expect(final.value[0]!.recordedAt).not.toBe(midRecordedAt);
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 60_000);
