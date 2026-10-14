/**
 * Group R, row KA-12 (spec §5.2 KA-12; L4 steps 1-5, L8; §9 M1/M2/M3): the
 * Runtime `closeOpenTurn` operation and the four definite-failure causes that
 * make the Workflow fall back to a new Session.
 *
 * Entry: `RuntimeExecutionPort.closeOpenTurn` on the public Runtime port. The
 * Session and Kernel store are the real Kernel store built through the public
 * `SqliteStores`/`KernelSessionFixture` surface; the platform records and the
 * Host binding are trusted test doubles. No database read verifies the result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createKernelStoreRegistry, type KernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { buildRun24KernelOpen, ownedRuntimeRoot, scenarioFiles } from '../helpers/K-t1-support.js';
import { hostCtx } from '../scenarios/harness.js';
import { K_AT, KernelSessionFixture, openTempKernelStore, type TempKernelStore } from '../helpers/K-session-support.js';

// M2/D5: the Kernel's two closure seams are read at call time, so a test can
// switch each one independently over a real Runtime. The other cases keep both
// available and are unaffected.
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

const P = 'kr12-project', G = 'kr12-goal', T = 'kr12-task', W = 'kr12-workspace';
const SESSION_ID = 'kr12-session';
const ADAPTER = 'kr12-kernel';
const SCOPE = { projectId: P, workspaceId: W };
const sessionRef: SessionRef = { projectId: P, sessionId: SESSION_ID };
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const requeueRef: TaskRequeueRef = { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId: 'run-A' };
const ctx: CoreCallContext = { projectId: P, workspaceId: W, principal: { kind: 'host', actor: { kind: 'human', id: 'kr12-op' } },
  materialReader: { kind: 'host', projectId: P, workspaceId: W, actor: { kind: 'human', id: 'kr12-op' } },
  signal: new AbortController().signal };

const opened: TempKernelStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((item) => item.cleanup()));
  vi.restoreAllMocks();
});

/** An `unavailable/kernel_turn_open` Work Session with one open Turn for `run-A`. */
async function openWorkSession(): Promise<{ fixture: KernelSessionFixture; databasePath: string }> {
  const temp = await openTempKernelStore('kr12-');
  opened.push(temp);
  const fixture = await KernelSessionFixture.create(temp.store, SESSION_ID);
  await fixture.startTurn({ runId: 'run-A', turnId: 'turn-A', input: 'the dangling question' });
  await fixture.event('run.started', {});
  return { fixture, databasePath: temp.databasePath };
}

function sessionRecord(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ref: { aggregateType: 'Session', projectId: P, sessionId: SESSION_ID }, revision: 3,
    kernel: { adapterId: ADAPTER, kernelSessionId: SESSION_ID },
    lifecycle: 'active', health: 'unavailable', healthConclusion: 'kernel_turn_open',
    role: { kind: 'role_spec', pin: { ref: { aggregateType: 'RoleSpecRevision', projectId: P, roleId: 'builder', revision: 1 }, digest: 'd' } },
    workspaceId: W, lastExecutionRef: runRef('run-A'), occupancy: null, historyCursor: null,
    createdAt: K_AT, archivedAt: null, ...over,
  } as unknown as SessionRecord;
}

/** RUN-19: crashed, interrupted_clean, no pause intent. */
function run19(): TaskExecutionRecord {
  return {
    run: {
      ref: runRef('run-A'), revision: 4, schemaVersion: 1, task: { projectId: P, goalId: G, taskId: T }, attemptId: 'attempt-A',
      planRef: { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' },
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 't', templateRevision: '1', bindingVersion: 1, policyRevision: 'p' },
      budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 1 },
      status: 'ended', outcome: 'crashed', exitCode: null, lastEventSeq: 3, lastRuntimeEventId: 'rt', lastFactEventId: 'ev',
      envelope: null, startedAt: K_AT, endedAt: K_AT,
      executionHistory: { schemaVersion: 1, sessionRef, kernel: { adapterId: ADAPTER, kernelSessionId: SESSION_ID, runId: 'run-A', turnId: 'turn-A' },
        startPosition: 2, observedThroughPosition: 3, endPosition: null },
      reconciliation: { status: 'done', observation: { kind: 'interrupted_clean', event: {} as never, lastPosition: 3,
        kernelPaused: false, pausedIntentRef: null }, basis: { kind: 'host_instance_takeover', hostInstanceId: 'h' }, recordedAt: K_AT },
    } as unknown as RunSnapshot,
    attempt: { ref: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: 'attempt-A' } },
    outbox: { claim: { sessionRef } },
  } as unknown as TaskExecutionRecord;
}

/** RUN-24: crashed, `interrupted_clean`, with the pointer's pause intent. */
function run24(): TaskExecutionRecord {
  const record = run19();
  const run = record.run as unknown as { reconciliation: { observation: Record<string, unknown> } };
  run.reconciliation.observation = { kind: 'interrupted_clean', event: {} as never, lastPosition: 3,
    kernelPaused: true, pausedIntentRef: { aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId: 'pause-1' } };
  return record;
}

/** A Kernel module whose `closeOpenTurn` is a getter over a live switch (M2's call-time seam). */
function gatedKernel(gate: { supported: boolean }): typeof kernel {
  return Object.defineProperty({ ...kernel }, 'closeOpenTurn', { enumerable: true, configurable: true,
    get: () => (gate.supported ? kernel.closeOpenTurn : undefined) }) as typeof kernel;
}

function depsFor(input: {
  registry: KernelStoreRegistry; record: TaskExecutionRecord; session: SessionRecord; kernelModule?: typeof kernel;
  recordSessionHealth?: (ctx: CoreCallContext, request: { sessionRef: SessionRef; probe: { verdict: 'ready'; activeRunId: null } })
    => Promise<{ status: 'observed'; session: SessionRecord }>;
  findSessions?: RuntimeExecutionDependencies['sessions']['findSessions'];
  queryTaskGraph?: RuntimeExecutionDependencies['plans']['queryTaskGraph'];
}): RuntimeExecutionDependencies {
  const recordSessionHealth = input.recordSessionHealth ?? (async () => ({ status: 'observed' as const, session: input.session }));
  return {
    executions: { readExecution: async () => ({ status: 'ready', value: input.record }) },
    sessions: { readSession: async () => ({ status: 'ready', value: { record: input.session, availability: 'idle', links: [], recommendationReasons: [] } }),
      findSessions: input.findSessions ?? (async () => ({ status: 'ready', value: { items: [], nextCursor: null, sourceCursor: {} as never } })) },
    kernelStores: input.registry,
    kernel: input.kernelModule ?? kernel,
    turnClosure: { recordSessionHealth: recordSessionHealth as never, lease: 'owned' as const },
    plans: { queryTaskGraph: input.queryTaskGraph ?? (async () => ({ status: 'not_found' })) },
    now: () => K_AT, newId: () => 'kr12-id',
  } as unknown as RuntimeExecutionDependencies;
}

async function runtimeWith(input: Parameters<typeof depsFor>[0]): Promise<NonNullable<ReturnType<typeof createAgentRuntime>['port']['closeOpenTurn']>> {
  const runtime = createAgentRuntime(depsFor(input));
  const close = runtime.port.closeOpenTurn;
  if (close === undefined) throw new Error('closeOpenTurn must be published when turnClosure is injected');
  return close;
}

describe('KA-12 Runtime closeOpenTurn fallback causes', () => {
  it('KA-12 answers unsupported when only the legacy Kernel reader is registered', async () => {
    const { databasePath } = await openWorkSession();
    const registry = await createKernelStoreRegistry({ entries: [], legacyEntries: [{ adapterId: ADAPTER, storeKey: 'kr12-legacy',
      databasePath, expectedSessionId: SESSION_ID }] });
    const close = await runtimeWith({ registry, record: run19(), session: sessionRecord() });
    expect(await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef: null })).toMatchObject({ status: 'unsupported' });
  });

  it('KA-12 reads the Kernel closeOpenTurn at call time, so a getter that is switched on between two calls closes the Turn after the first answers unsupported (M2)', async () => {
    const { databasePath } = await openWorkSession();
    const registry = await createKernelStoreRegistry({ entries: [{ adapterId: ADAPTER, storeKey: 'kr12', workspace: SCOPE, databasePath }] });
    const gate = { supported: false };
    const close = await runtimeWith({ registry, record: run19(), session: sessionRecord(), kernelModule: gatedKernel(gate) });
    const first = await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef: null });
    gate.supported = true;
    const second = await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef: null });
    expect([first.status, second.status]).toEqual(['unsupported', 'closed']);
  });

  it('KA-12 refuses continuation_not_authorized when a paused-interrupted requeue cannot prove its requester (L4 step 2, rule 3)', async () => {
    const { databasePath } = await openWorkSession();
    const registry = await createKernelStoreRegistry({ entries: [{ adapterId: ADAPTER, storeKey: 'kr12', workspace: SCOPE, databasePath }] });
    const close = await runtimeWith({ registry, record: run24(), session: sessionRecord() });
    expect(await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef }))
      .toEqual({ status: 'refused', reason: 'continuation_not_authorized' });
  });

  it('KA-12 answers transient and writes nothing when the successor Session enumeration is unusable (L4 step 3, rule 3)', async () => {
    const { databasePath } = await openWorkSession();
    const registry = await createKernelStoreRegistry({ entries: [{ adapterId: ADAPTER, storeKey: 'kr12', workspace: SCOPE, databasePath }] });
    const close = await runtimeWith({ registry, record: run19(), session: sessionRecord(),
      findSessions: async () => ({ status: 'rejected', code: 'unavailable', reason: 'the Session directory is not readable' }) });
    expect(await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef: null }))
      .toMatchObject({ status: 'transient' });
  });

  it('KA-12 refuses handed_over for an archived successor whose handoff provenance points at the Session (L4 step 3)', async () => {
    const { databasePath } = await openWorkSession();
    const registry = await createKernelStoreRegistry({ entries: [{ adapterId: ADAPTER, storeKey: 'kr12', workspace: SCOPE, databasePath }] });
    const successor = sessionRecord({ lifecycle: 'archived', ref: { aggregateType: 'Session', projectId: P, sessionId: 'kr12-successor' },
      provenance: { schemaVersion: 1, kind: 'handoff', from: { projectId: P, sessionId: SESSION_ID } } });
    const close = await runtimeWith({ registry, record: run19(), session: sessionRecord(),
      findSessions: async (_ctx, request) => ({ status: 'ready', value: { items: request.includeArchived === true
        ? [{ record: successor, availability: 'idle' as const, links: [], recommendationReasons: [] }] : [],
        nextCursor: null, sourceCursor: {} as never } }) });
    expect(await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef: null }))
      .toEqual({ status: 'refused', reason: 'handed_over' });
  });

  it('KA-12 answers unreadable when the mapped Kernel database file is missing', async () => {
    const { databasePath } = await openWorkSession();
    const registry = await createKernelStoreRegistry({ entries: [{ adapterId: ADAPTER, storeKey: 'kr12', workspace: SCOPE,
      databasePath: `${databasePath}.absent` }] });
    const close = await runtimeWith({ registry, record: run19(), session: sessionRecord() });
    expect(await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef: null })).toMatchObject({ status: 'unreadable' });
  });

  it('KA-12 answers mismatch when the afterRun Kernel binding disagrees with the Session mapping', async () => {
    const { databasePath } = await openWorkSession();
    const registry = await createKernelStoreRegistry({ entries: [{ adapterId: ADAPTER, storeKey: 'kr12', workspace: SCOPE, databasePath }] });
    const record = run19();
    const run = record.run as unknown as { executionHistory: { kernel: { adapterId: string } } };
    run.executionHistory.kernel.adapterId = 'another-adapter';
    const close = await runtimeWith({ registry, record, session: sessionRecord() });
    expect(await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef: null })).toMatchObject({ status: 'mismatch' });
  });

  it('KA-12 maps the Kernel not_found to mismatch when the Kernel Session holds no Turn of the Run', async () => {
    const temp = await openTempKernelStore('kr12-absent-');
    opened.push(temp);
    await KernelSessionFixture.create(temp.store, SESSION_ID);
    const registry = await createKernelStoreRegistry({ entries: [{ adapterId: ADAPTER, storeKey: 'kr12', workspace: SCOPE,
      databasePath: temp.databasePath }] });
    const close = await runtimeWith({ registry, record: run19(), session: sessionRecord() });
    expect(await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef: null })).toMatchObject({ status: 'mismatch' });
  });

  it('KA-12 closes a RUN-19 Turn, re-probes and returns the health owner the result available', async () => {
    const { databasePath } = await openWorkSession();
    const registry = await createKernelStoreRegistry({ entries: [{ adapterId: ADAPTER, storeKey: 'kr12', workspace: SCOPE, databasePath }] });
    const health = vi.fn(async () => ({ status: 'observed' as const, session: sessionRecord({ health: 'available', healthConclusion: null }) }));
    const close = await runtimeWith({ registry, record: run19(), session: sessionRecord(), recordSessionHealth: health as never });
    expect(await close(ctx, { sessionRef, afterRunRef: runRef('run-A'), requeueRef: null }))
      .toEqual({ status: 'closed', health: 'available' });
  });

  it('KA-12 answers unsupported and writes nothing when the injected Kernel does not publish readTurnBounds (M2, D5)', async () => {
    const { root, database, publicDir } = await scenarioFiles('kr12-d5a');
    const state = await buildRun24KernelOpen({ root, database, publicDir, prefix: 'kr12-d5a' });
    kernelCapabilities.readTurnBounds = false;
    const platform = await ownedRuntimeRoot(root, database);
    try {
      const close = platform.runtime.closeOpenTurn;
      if (close === undefined) throw new Error('the owned root must publish closeOpenTurn');
      const before = await platform.sessions.readSession(hostCtx(), state.sessionRef);
      const result = await close(hostCtx(), { sessionRef: state.sessionRef, afterRunRef: state.runRef,
        requeueRef: state.requeueRef });
      const after = await platform.sessions.readSession(hostCtx(), state.sessionRef);
      expect(result).toMatchObject({ status: 'unsupported' });
      // The Session write port is unchanged: no health and no Kernel write happened.
      expect(after).toEqual(before);
    } finally {
      await platform.close();
      await state.release();
      kernelCapabilities.readTurnBounds = true;
    }
  }, 300_000);

  it('KA-12 answers unsupported and writes nothing when the injected Kernel does not publish closeOpenTurn (M2, D5)', async () => {
    const { root, database, publicDir } = await scenarioFiles('kr12-d5b');
    const state = await buildRun24KernelOpen({ root, database, publicDir, prefix: 'kr12-d5b' });
    kernelCapabilities.closeOpenTurn = false;
    const platform = await ownedRuntimeRoot(root, database);
    try {
      const close = platform.runtime.closeOpenTurn;
      if (close === undefined) throw new Error('the owned root must publish closeOpenTurn');
      const before = await platform.sessions.readSession(hostCtx(), state.sessionRef);
      const result = await close(hostCtx(), { sessionRef: state.sessionRef, afterRunRef: state.runRef,
        requeueRef: state.requeueRef });
      const after = await platform.sessions.readSession(hostCtx(), state.sessionRef);
      expect(result).toMatchObject({ status: 'unsupported' });
      expect(after).toEqual(before);
    } finally {
      await platform.close();
      await state.release();
      kernelCapabilities.closeOpenTurn = true;
    }
  }, 300_000);

  it('KA-12 maps an available Session whose probe reports host_config to the retryable transient, never unsupported (L4, D6)', async () => {
    const { root, database, publicDir } = await scenarioFiles('kr12-d6');
    const state = await buildRun24KernelOpen({ root, database, publicDir, prefix: 'kr12-d6' });
    // First close the real dangling Turn, so the Session health becomes available.
    const closure = await ownedRuntimeRoot(root, database);
    try {
      const close = closure.runtime.closeOpenTurn;
      if (close === undefined) throw new Error('the owned root must publish closeOpenTurn');
      expect(await close(hostCtx(), { sessionRef: state.sessionRef, afterRunRef: state.runRef, requeueRef: state.requeueRef }))
        .toEqual({ status: 'closed', health: 'available' });
    } finally {
      await closure.close();
    }
    // Now no current registration for the adapter: the probe cannot prove the
    // mapping, so the available-Session branch is the retryable transient.
    const unmapped = await ownedRuntimeRoot(root, database, { kernelRegistered: false });
    try {
      const close = unmapped.runtime.closeOpenTurn;
      if (close === undefined) throw new Error('the owned root must publish closeOpenTurn');
      expect(await close(hostCtx(), { sessionRef: state.sessionRef, afterRunRef: state.runRef, requeueRef: state.requeueRef }))
        .toMatchObject({ status: 'transient' });
    } finally {
      await unmapped.close();
      await state.release();
    }
  }, 300_000);

  it('KA-12 does not publish the operation at all when the closure dependency is absent (M1)', () => {
    const bare = { kernelStores: {} as never, kernel } as unknown as RuntimeExecutionDependencies;
    expect(createAgentRuntime(bare).port.closeOpenTurn).toBeUndefined();
  });
});
