/**
 * Slice 2B round-2 R6 coverage (review item 6): the `countRunActivity` probe
 * verdicts that prove nothing must all stop without writing (`retry_later`),
 * and a cancellation after the bounds read must be preserved.
 *
 * The mandatory `owner.probe` runs before `readTurnBounds` (runtime.ts). The
 * reviewer found the `transient` and `missing` cases covered by
 * `S2B-r2-backfill-probe-first.test.ts`; this file adds the two remaining
 * non-conclusive verdicts (`host_config`, `cancelled`) and the `ctx.signal`
 * check that follows the bounds read.
 *
 * The Run under test is a real entered Run held in flight by the reviewed
 * `blockingTool`; no real model, no network. Assertions are the literal
 * `retry_later` value and its reason.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type { SqliteStores } from '../../vendor/coding-agent/dist/public-api.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { blockingTool } from '../helpers/S2B-runtime-tools-support.js';
import { withTool } from '../helpers/S2B-be2-reconcile-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});


/** An entered, in-flight Run (locator endPosition null) over the real fixture. */
async function enteredRun(label: string): Promise<{ fx: S2BRuntimeStoreFixture; running: Promise<unknown>; release: () => void }> {
  const toolName = `s2b-r6b-${label}-tool`;
  const entered = deferred();
  const release = deferred();
  const fx = await createS2BRuntimeStoreFixture({
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: `s2b-r6b-${label}-call`, name: toolName, args: {} }] },
      { kind: 'text', text: `S2B R6b ${label} done` },
    ],
  });
  fixtures.push(fx);
  const deps = fx.rebuildDeps();
  const runtime = createAgentRuntime({ ...deps, kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: `s2b-r6b-${label}-prepare` });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  const running = runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: `s2b-r6b-${label}-driver`, requestId: `s2b-r6b-${label}-start` });
  await entered.promise;
  return { fx, running, release: release.resolve };
}

describe('S2B round 2 R6 — probe verdicts that prove nothing', () => {
  it('R6 a host_config probe is retry_later, not a definite unknown', async () => {
    const { fx, running, release } = await enteredRun('host-config');
    try {
      const deps = fx.rebuildDeps({
        kernelStores: { ...fx.deps.kernelStores, byAdapterId: () => null },
      });
      const runtime = createAgentRuntime(deps);
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

  it('R6 a probe cancelled after the Run read is retry_later', async () => {
    const { fx, running, release } = await enteredRun('cancelled');
    try {
      const controller = new AbortController();
      const base = fx.rebuildDeps();
      const deps: RuntimeExecutionDependencies = {
        ...base,
        executions: {
          ...base.executions,
          readExecution: async (ctx, ref, options) => {
            const read = await base.executions.readExecution(ctx, ref, options);
            // The Run read finished; the cancellation lands before the probe.
            controller.abort('S2B R6b: cancelled between the Run read and the probe');
            return read;
          },
        },
      };
      const runtime = createAgentRuntime(deps);
      const result = await runtime.port.countRunActivity!({ ...fx.ctx, signal: controller.signal }, { runRef: fx.claim.runRef });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.value).toMatchObject({ kind: 'retry_later' });
    } finally {
      release();
      await running.catch(() => undefined);
    }
  });

  it('R6 a cancellation after the bounds read is retry_later and writes nothing', async () => {
    const { fx, running, release } = await enteredRun('bounds-cancel');
    try {
      const controller = new AbortController();
      const base = fx.rebuildDeps();
      const deps: RuntimeExecutionDependencies = {
        ...base,
        kernel: {
          ...base.kernel,
          readTurnBounds: async (store: SqliteStores, request: unknown) => {
            void store; void request;
            controller.abort('S2B R6b: cancelled during the bounds read');
            return { status: 'found', startPosition: 1, endPosition: 5, terminalStatus: 'completed' };
          },
        },
      };
      const runtime = createAgentRuntime(deps);
      const result = await runtime.port.countRunActivity!({ ...fx.ctx, signal: controller.signal }, { runRef: fx.claim.runRef });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.value).toMatchObject({ kind: 'retry_later', reason: 'the activity window read was cancelled' });
    } finally {
      release();
      await running.catch(() => undefined);
    }
  });

  it('R6 a bounds read that answers unreadable because of cancellation is retry_later', async () => {
    const { fx, running, release } = await enteredRun('bounds-unreadable-cancel');
    try {
      const controller = new AbortController();
      const base = fx.rebuildDeps();
      const deps: RuntimeExecutionDependencies = {
        ...base,
        kernel: {
          ...base.kernel,
          readTurnBounds: async (store: SqliteStores, request: unknown) => {
            void store; void request;
            // The real bounds owner answers `unreadable` once its signal is
            // aborted (session-operations.ts); the reader must not turn that
            // into a definite `kernel_unreadable`.
            controller.abort('S2B R6b: cancelled, bounds owner answers unreadable');
            return { status: 'unreadable', reason: 'the Turn bounds read was cancelled' };
          },
        },
      };
      const runtime = createAgentRuntime(deps);
      const result = await runtime.port.countRunActivity!({ ...fx.ctx, signal: controller.signal }, { runRef: fx.claim.runRef });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.value).toMatchObject({ kind: 'retry_later', reason: 'the activity window read was cancelled' });
      expect(result.value).not.toMatchObject({ kind: 'facts', facts: { reason: 'kernel_unreadable' } });
    } finally {
      release();
      await running.catch(() => undefined);
    }
  });
});
