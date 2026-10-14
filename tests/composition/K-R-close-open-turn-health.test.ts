/**
 * Group R fix round: the L4 health check and the retryable platform-read
 * mapping of `RuntimeExecutionPort.closeOpenTurn` (spec L4 lines 98-101 and
 * lines 109-113; L7 lines 128-137; L8 lines 176-181; §9 M2).
 *
 * Entry (D13): a real public-flow RUN-24 Session/Run (`buildRun24KernelOpen`)
 * over a real owned-lease composition root. The Run and Session facts are read
 * from the public routes; only the two read-fault overrides (the point of the
 * L8/L7 rows) are boundary instrumentation, and they replace the REAL read with
 * a `rejected` result. Test 1 additionally opens a fresh Kernel Turn on the
 * mapped Session through the public `SqliteStores` boundary (the same surface
 * the D4 test uses), so its `available + active Kernel head` state is real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { buildRun24KernelOpen, ownedRuntimeRoot, scenarioFiles } from '../helpers/K-t1-support.js';
import { K_AT, K_CONFIG, K_WORKSPACE } from '../helpers/K-session-support.js';
import { cleanupScenarios, hostCtx, type Platform } from '../scenarios/harness.js';

// M2/D5: the Kernel's closure seams are read at call time over a real Runtime.
const kernelCapabilities = vi.hoisted(() => ({ closeOpenTurn: true, readTurnBounds: true }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const module = { ...actual } as Record<string, unknown>;
  for (const name of ['closeOpenTurn', 'readTurnBounds'] as const) {
    Object.defineProperty(module, name, { enumerable: true, configurable: true,
      get: () => (kernelCapabilities[name] ? actual[name] : undefined) });
  }
  return module;
});
afterEach(() => { kernelCapabilities.closeOpenTurn = true; kernelCapabilities.readTurnBounds = true; });
afterEach(cleanupScenarios);

type Rejected = Extract<ReadResult<unknown>, { status: 'rejected' }>;

/**
 * Open a fresh Kernel Turn on an existing Session through the public
 * `SqliteStores.append` surface (the boundary; no platform record is invented),
 * so the Session head names an active Run again.
 */
async function openFreshKernelTurn(database: string, sessionId: string, runId: string): Promise<void> {
  const store = await kernel.SqliteStores.open(join(database, 'kernel.sqlite'));
  try {
    const signal = new AbortController().signal;
    const header = await store.get(sessionId, { signal });
    await store.append(sessionId, header.revision, [{
      recordId: `turn:${runId}`, recordType: 'turn.started', schemaVersion: 1 as const, recordedAt: K_AT,
      payload: { run: { schemaVersion: 1 as const, runId, turn: { turnId: `${runId}-turn`,
        userMessage: { schemaVersion: 1 as const, messageId: `${runId}-user`, role: 'user' as const,
          content: 'a fresh Turn opened at the Kernel boundary' } }, createdAt: K_AT },
      config: K_CONFIG, workspace: K_WORKSPACE },
    }], { signal });
  } finally {
    await store.close();
  }
}

/**
 * The real Runtime over the owned root's own owners, with ONLY one platform read
 * replaced by a `rejected` result (the L8/L7 read-fault rows). `executions`,
 * `sessions.findSessions`, `kernelStores`, `plans` and the Kernel module are the
 * real ones from the same composition root.
 */
function runtimeOverReal(input: {
  platform: Platform; session: SessionRecord;
  readExecution?: RuntimeExecutionDependencies['executions']['readExecution'];
  readSession?: RuntimeExecutionDependencies['sessions']['readSession'];
}): NonNullable<ReturnType<typeof createAgentRuntime>['port']['closeOpenTurn']> {
  const deps = {
    executions: input.readExecution === undefined ? input.platform.executions
      : { readExecution: input.readExecution },
    sessions: {
      readSession: input.readSession ?? input.platform.sessions.readSession.bind(input.platform.sessions),
      findSessions: input.platform.sessions.findSessions.bind(input.platform.sessions),
    },
    kernelStores: input.platform.kernelStores,
    kernel,
    turnClosure: { recordSessionHealth: (async () => ({ status: 'observed' as const, session: input.session })) as never,
      lease: 'owned' as const },
    plans: input.platform.plans,
    now: () => K_AT, newId: () => 'krh-id',
  } as unknown as RuntimeExecutionDependencies;
  const runtime = createAgentRuntime(deps);
  const close = runtime.port.closeOpenTurn;
  if (close === undefined) throw new Error('closeOpenTurn must be published when turnClosure is injected');
  return close;
}

async function realSessionOf(platform: Platform, sessionRef: { projectId: string; sessionId: string }): Promise<SessionRecord> {
  const card = await platform.sessions.readSession(hostCtx(), sessionRef);
  if (card.status !== 'ready') throw new Error(`the real Session card must be readable: ${JSON.stringify(card)}`);
  return card.value.record;
}

describe('L4 health and the retryable platform-read mapping', () => {
  it('L4 step 4: an available Session whose Kernel head still names an active Run is refused(health), not mismatch', async () => {
    const { root, database, publicDir } = await scenarioFiles('krh-l4');
    const state = await buildRun24KernelOpen({ root, database, publicDir, prefix: 'krh-l4' });
    try {
      // Settle the Session health to `available` by closing its real dangling Turn.
      const closer = await ownedRuntimeRoot(root, database);
      try {
        const close = closer.runtime.closeOpenTurn;
        if (close === undefined) throw new Error('the owned root must publish closeOpenTurn');
        expect(await close(hostCtx(), { sessionRef: state.sessionRef, afterRunRef: state.runRef, requeueRef: state.requeueRef }))
          .toEqual({ status: 'closed', health: 'available' });
      } finally {
        await closer.close();
      }
      // Open a fresh real Kernel Turn on the mapped Session at the boundary.
      await openFreshKernelTurn(database, state.sessionRef.sessionId, 'krh-l4-forced-run');
      const platform = await ownedRuntimeRoot(root, database);
      try {
        const card = await realSessionOf(platform, state.sessionRef);
        expect(card, 'the platform health settled to available').toMatchObject({ health: 'available', lifecycle: 'active' });
        const close = platform.runtime.closeOpenTurn;
        if (close === undefined) throw new Error('the owned root must publish closeOpenTurn');
        expect(await close(hostCtx(), { sessionRef: state.sessionRef, afterRunRef: state.runRef, requeueRef: state.requeueRef }))
          .toEqual({ status: 'refused', reason: 'health' });
      } finally {
        await platform.close();
      }
    } finally {
      await state.release();
    }
  }, 300_000);

  it('L8/L7: a retryable platform readExecution rejection is the retryable transient, never the definite unreadable fallback', async () => {
    const { root, database, publicDir } = await scenarioFiles('krh-rexec');
    const state = await buildRun24KernelOpen({ root, database, publicDir, prefix: 'krh-rexec' });
    const platform = await ownedRuntimeRoot(root, database);
    try {
      const real = await platform.executions.readExecution(hostCtx(), state.runRef);
      expect(real.status, 'the real Run record the override replaces must be readable').toBe('ready');
      const close = runtimeOverReal({ platform, session: await realSessionOf(platform, state.sessionRef),
        readExecution: async () => ({ status: 'rejected', code: 'unavailable',
          reason: 'the ledger is briefly unavailable' }) as Rejected });
      expect(await close(hostCtx(), { sessionRef: state.sessionRef, afterRunRef: state.runRef, requeueRef: state.requeueRef }))
        .toMatchObject({ status: 'transient' });
    } finally {
      await platform.close();
      await state.release();
    }
  }, 300_000);

  it('L8/L7: a cancelled platform readSession rejection is the retryable transient, never the definite unreadable fallback', async () => {
    const { root, database, publicDir } = await scenarioFiles('krh-rsess');
    const state = await buildRun24KernelOpen({ root, database, publicDir, prefix: 'krh-rsess' });
    const platform = await ownedRuntimeRoot(root, database);
    try {
      const card = await realSessionOf(platform, state.sessionRef);
      expect(card, 'the real Session card the override replaces must be readable').toMatchObject({ lifecycle: 'active' });
      const close = runtimeOverReal({ platform, session: card,
        readSession: async () => ({ status: 'rejected', code: 'cancelled',
          reason: 'the Session read was cancelled' }) as Rejected });
      expect(await close(hostCtx(), { sessionRef: state.sessionRef, afterRunRef: state.runRef, requeueRef: state.requeueRef }))
        .toMatchObject({ status: 'transient' });
    } finally {
      await platform.close();
      await state.release();
    }
  }, 300_000);

  it('M2/D5: readTurnBounds is read at call time, so a getter switched on between two calls closes the Turn after the first answers unsupported', async () => {
    const { root, database, publicDir } = await scenarioFiles('krh-d5');
    const state = await buildRun24KernelOpen({ root, database, publicDir, prefix: 'krh-d5' });
    kernelCapabilities.readTurnBounds = false;
    const platform = await ownedRuntimeRoot(root, database);
    try {
      const close = platform.runtime.closeOpenTurn;
      if (close === undefined) throw new Error('the owned root must publish closeOpenTurn');
      const first = await close(hostCtx(), { sessionRef: state.sessionRef, afterRunRef: state.runRef,
        requeueRef: state.requeueRef });
      kernelCapabilities.readTurnBounds = true;
      const second = await close(hostCtx(), { sessionRef: state.sessionRef, afterRunRef: state.runRef,
        requeueRef: state.requeueRef });
      expect([first.status, second.status]).toEqual(['unsupported', 'closed']);
    } finally {
      await platform.close();
      await state.release();
      kernelCapabilities.readTurnBounds = true;
    }
  }, 300_000);
});
