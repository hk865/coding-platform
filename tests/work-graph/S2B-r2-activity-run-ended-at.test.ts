/**
 * Slice 2B round-2 fix R10 (review item 10) — the RunActivity snapshot must keep
 * the Run's ORIGINAL `endedAt`; the replacement time is `recordedAt`.
 *
 * RUN-21 deliberately preserves the original Run `endedAt`
 * (`run-machine.ts` `reconciledEndRecord`: `endedAt: end.endedAt ?? run.endedAt`)
 * while the booking commit happens later. The booking goes through the REAL
 * entry writer `recordRunResult` (`run-reconcile.ts:359`), whose R10 line
 * (`execution-entry-service.ts`) builds the RunActivity record.
 *
 * Seam (spec §5.1 BE2c "what is to be committed" write double): the store port
 * the real writer uses is wrapped; every real `commit(prepared)` is inspected,
 * and the `RunActivity@1` record is decoded with the public
 * `decodeRunActivitySnapshot` — no database/record-store read after the fact.
 *
 * Fixture (public calls only, following `tests/app/S2B-be2-late-evidence-activity.test.ts`
 * 2B-14(b)): a `blockingTool` is held in flight; the first restart reconciles
 * RUN-20(i) at `ORIGINAL_END` (the Run's original `endedAt`); releasing the tool
 * lets the old process end its Turn without booking; the next restart books the
 * late terminal as RUN-21 through `recordRunResult` at `REPLACEMENT_AT`.
 */
import { afterEach, expect, it } from 'vitest';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type { RunActivitySnapshot } from '../../src/contracts/run-activity.js';
import {
  RUN_ACTIVITY_SCHEMA_ID, decodeRunActivitySnapshot,
} from '../../src/core/work-graph/persistence/run-activity-codecs.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { blockingTool } from '../helpers/S2B-runtime-tools-support.js';
import {
  BE2_HOST_1, BE2_HOST_2, be2ExtraSchemas, controlsOn, prepare, restartHost, withTool,
} from '../helpers/S2B-be2-reconcile-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

const ORIGINAL_END = '2026-09-26T03:00:00.000Z';
const REPLACEMENT_AT = '2026-09-26T05:00:00.000Z';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

it('R10: the RUN-21 writer keeps the Run original endedAt and records the replacement time', async () => {
  const toolName = 's2b-r10-late-tool';
  const entered = deferred();
  const release = deferred();
  const fx = await createS2BRuntimeStoreFixture({
    additionalSchemas: be2ExtraSchemas(),
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 's2b-r10-call', name: toolName, args: {} }] },
      { kind: 'text', text: 'S2B R10 done after the late tool result' },
    ],
  });
  fixtures.push(fx);

  // §5.1 BE2c write double: capture the RunActivity a real commit writes. The
  // real entry/reconcile writers hold this same port object, so nothing else
  // has to be rebuilt.
  const captured: RunActivitySnapshot[] = [];
  const realCommit = fx.records.commit.bind(fx.records);
  fx.records.commit = async (prepared) => {
    const receipt = await realCommit(prepared);
    if (receipt.status === 'committed') {
      for (const record of prepared.records) {
        if (record.schemaId !== RUN_ACTIVITY_SCHEMA_ID) continue;
        const decoded = decodeRunActivitySnapshot(record);
        if (decoded.status === 'decoded') captured.push(decoded.value);
      }
    }
    return receipt;
  };

  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: BE2_HOST_1, runReconcile: true });
  const runtime = createAgentRuntime({ ...deps, controls,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, runtime, 's2b-r10-prepare');
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 's2b-r10-driver', requestId: 's2b-r10-start' });
  try {
    await entered.promise;
    // RUN-20(i): the incomplete end is booked at ORIGINAL_END, which is the Run's
    // original `endedAt` (a fresh end stamps it with the reconcile instant).
    fx.setNow(ORIGINAL_END);
    expect(await restartHost(fx, BE2_HOST_2, controls).reconcile()).toMatchObject({ row: 'W-13', status: 'reconciled' });

    // The old process's late tool result ends its Turn without booking anything.
    release.resolve();
    await running;

    // RUN-21: the next start books the late terminal through `recordRunResult`.
    fx.setNow(REPLACEMENT_AT);
    expect(await restartHost(fx, BE2_HOST_2, controls).reconcile()).toMatchObject({ row: 'W-15', status: 'reconciled' });

    const run21 = captured.find(snapshot => snapshot.recordedAt === REPLACEMENT_AT);
    expect(run21, JSON.stringify(captured.map(snapshot => ({
      runEndedAt: snapshot.runEndedAt, recordedAt: snapshot.recordedAt })))).toBeDefined();
    if (run21 === undefined) return;
    expect(run21.recordedBy).toBe('run_end');
    expect(run21.runEndedAt, 'the ORIGINAL Run end, not the replacement time').toBe(ORIGINAL_END);
    expect(run21.recordedAt, 'the replacement time').toBe(REPLACEMENT_AT);

    // The reconcile writer (`commitDecided`) is exercised by the RUN-20(i)
    // commit above, but it is NOT a discriminator for R10: a fresh end stamps
    // the Run's `endedAt` to the same instant as the commit, so
    // `nextRun.endedAt === input.nowIso` there. RUN-21 late evidence — the only
    // preserved-`endedAt` path — now goes through `recordRunResult`, whose
    // assertion above is the discriminating one (review round 2, item 10).
    expect(captured.some(snapshot => snapshot.recordedAt === ORIGINAL_END)).toBe(true);
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 60_000);
