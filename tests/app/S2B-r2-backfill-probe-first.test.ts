/**
 * Slice 2B round-2 R6 (review item 6): `countRunActivity` must probe before it
 * resolves the window's upper bound.
 *
 * The mandatory `owner.probe` is moved ahead of the `readTurnBounds` read, so a
 * missing Host configuration or a transient probe can never surface as a
 * definite `unknown('kernel_unreadable')`; it is `retry_later` and nothing is
 * written. The tests inject the probe and the bounds seam at their public
 * boundaries over the real Runtime/store fixture:
 *   - probe `transient` (a generic failure on `store.get`) AND
 *     `readTurnBounds` throwing => `retry_later`;
 *   - probe `missing` => `unknown('kernel_unreadable')`.
 *
 * The Run under test is a real entered Run (its position record has no
 * `endPosition`, so `countRunActivity` must consult `readTurnBounds`), held in
 * flight by the reviewed `blockingTool`; no real model, no network.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type { SqliteStores } from '../../vendor/coding-agent/dist/public-api.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { blockingTool } from '../helpers/S2B-runtime-tools-support.js';
import { withProbeMissing } from '../helpers/S2B-be1r2-support.js';
import { withTool } from '../helpers/S2B-be2-reconcile-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});


/** A generic (non-StoreError) failure on the probe's `store.get` => verdict `transient`. */
function withProbeTransient(
  base: RuntimeExecutionDependencies['kernelStores'],
): RuntimeExecutionDependencies['kernelStores'] {
  return {
    ...base,
    async withStore<T>(adapterId: string, use: (store: SqliteStores) => Promise<T>): Promise<T> {
      return base.withStore(adapterId, async (store) => {
        const proxy = new Proxy(store, {
          get(target, property, receiver) {
            if (property === 'get') {
              return async () => { throw new Error('S2B R6 injected transient probe failure'); };
            }
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
          },
        });
        return use(proxy as unknown as SqliteStores);
      });
    },
  };
}

/** An entered, in-flight Run (locator endPosition null) over the real fixture. */
async function enteredRun(label: string): Promise<{ fx: S2BRuntimeStoreFixture; running: Promise<unknown>; release: () => void }> {
  const toolName = `s2b-r6-${label}-tool`;
  const entered = deferred();
  const release = deferred();
  const fx = await createS2BRuntimeStoreFixture({
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: `s2b-r6-${label}-call`, name: toolName, args: {} }] },
      { kind: 'text', text: `S2B R6 ${label} done` },
    ],
  });
  fixtures.push(fx);
  const deps = fx.rebuildDeps();
  const runtime = createAgentRuntime({ ...deps, kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: `s2b-r6-${label}-prepare` });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  const running = runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: `s2b-r6-${label}-driver`, requestId: `s2b-r6-${label}-start` });
  await entered.promise;
  return { fx, running, release: release.resolve };
}

describe('S2B round 2 R6 — the backfill probes before it resolves the bound', () => {
  it('R6 a transient probe plus an unreadable bounds read is retry_later, never kernel_unreadable', async () => {
    const { fx, running, release } = await enteredRun('transient');
    try {
      const deps = fx.rebuildDeps({ kernelStores: withProbeTransient(fx.deps.kernelStores) });
      const runtime = createAgentRuntime({ ...deps, kernel: { ...deps.kernel,
        readTurnBounds: () => { throw new Error('S2B R6 injected unreadable bounds read'); } } });
      const result = await runtime.port.countRunActivity!(fx.ctx, { runRef: fx.claim.runRef });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.value).toMatchObject({ kind: 'retry_later' });
      expect(result.value).not.toMatchObject({ kind: 'facts', facts: { reason: 'kernel_unreadable' } });
    } finally {
      release();
      await running.catch(() => undefined);
    }
  });

  it('R6 a missing probe is an explicit unknown(kernel_unreadable)', async () => {
    const { fx, running, release } = await enteredRun('missing');
    try {
      const missing = { missing: true };
      const deps = fx.rebuildDeps({ kernelStores: withProbeMissing(fx.deps.kernelStores, missing) });
      const runtime = createAgentRuntime(deps);
      const result = await runtime.port.countRunActivity!(fx.ctx, { runRef: fx.claim.runRef });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.value).toMatchObject({ kind: 'facts', facts: { status: 'unknown', reason: 'kernel_unreadable' } });
    } finally {
      release();
      await running.catch(() => undefined);
    }
  });
});
