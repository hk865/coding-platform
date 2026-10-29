/**
 * L8 (E) rows K5-01/K5-02 and T19: a REAL Host close while one capture runs and
 * another waits, then a REAL Host start on the same SQLite database.
 *
 * The only test-side handle is an A3 delegate gate around the real
 * `createObservedArchitecture` factory: it records each real
 * `workspace.captureObservation` call and the caller's original signal, holds
 * the first workspace at a gate, then returns the real call's result unchanged.
 * There is no `lightScan` fault and no hand-written request/observation; the
 * Host, its driver and its routes are the production ones.
 *
 * K5 is SQLite only: a memory Host cannot be reopened on the same facts. Row D
 * adds a separate scenario on BOTH backends where B really ENTERS
 * `captureObservation` in the first Host and the second Host binds only A:
 * memory shares the world's one real record backend through the A4 factory
 * wrapper, and the world closes that physical backend at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import type { WorkbenchWorkspaceConfig } from '../../src/app/host.js';
import {
  aborted, cleanupTemporary, completed, corePost, createSharedMemoryBackend, graphWrite,
  installCaptureGate, makeWorkspace, observationPoint, projectRef, scopeOf, setupPublicDir,
  startHost, waitState, workspaceConfig, workspaceRef,
  type Backend, type CaptureGate, type ObservationStorage, type SharedMemoryBackend,
} from './support/S8A-L8-host.js';
import { writeAutomationSettings } from '../helpers/A2-restart-fixture.js';

beforeAll(async () => { await setupPublicDir(); });
afterAll(async () => { await cleanupTemporary(); });

const PROJECT_ID = 'l8-close-restart-project';
const A = scopeOf(PROJECT_ID, 'a');
const B = scopeOf(PROJECT_ID, 'b');

/** Create the one project through the route; both workspaces join it. */
async function createProject(started: { base: string; token: string }, scope: CoreScope): Promise<void> {
  const response = await corePost(started.base, 'projects/create', started.token,
    graphWrite(scope, { projectId: scope.projectId }, `l8-close-restart-project:${scope.projectId}`,
      [{ ref: projectRef(scope), revision: 0 }]));
  expect(await response.json()).toMatchObject({ status: 'committed' });
}

/** Register one configured workspace through the route; the Host triggers its capture. */
async function registerWorkspace(started: { base: string; token: string }, scope: CoreScope): Promise<void> {
  const response = await corePost(started.base, 'workspaces/register', started.token,
    graphWrite(scope, { workspace: scope },
      `l8-close-restart-workspace:${scope.projectId}:${scope.workspaceId}`,
      [{ ref: projectRef(scope), revision: 1 }, { ref: workspaceRef(scope), revision: 0 }]));
  expect(await response.json()).toMatchObject({ status: 'committed' });
}

type ClosedScenario = {
  database: string;
  configs: WorkbenchWorkspaceConfig[];
  afterClose: Record<string, ArchitectureObservationStateV1>;
};

/**
 * Shared setup of K5-01: a real SQLite Host where A runs (held in the gate) and
 * B is accepted and queued, then `host.close()` and a public read.
 */
async function closeHostWithRunningAndQueued(gate: CaptureGate): Promise<ClosedScenario> {
  const rootA = await makeWorkspace();
  const rootB = await makeWorkspace();
  const configs = [workspaceConfig(A, rootA), workspaceConfig(B, rootB)];
  let database = '';
  const first = await startHost({ backend: 'sqlite', workspaces: configs });
  try {
    await createProject(first, A);
    await registerWorkspace(first, A);
    // The gate's own real entry promise, not a timed poll of its entries.
    const aEntry = await gate.entered(A.workspaceId);
    await registerWorkspace(first, B);
    const aRunning = await waitState(first.base, first.token, A,
      state => state.autoCapture?.requestSeq === 1);
    expect(aRunning.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
    expect(aRunning.current).toBeNull();
    const bQueued = await waitState(first.base, first.token, B,
      state => state.autoCapture?.requestSeq === 1);
    expect(bQueued.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
    expect(bQueued.current).toBeNull();
    // B's capture never entered: A still holds the one Host-wide slot.
    expect(gate.entries.filter(entry => entry.workspaceId === B.workspaceId)).toHaveLength(0);
    // The original signal's abort listener is attached BEFORE the close, so a
    // synchronous abort cannot be missed; no timed poll of `signal.aborted`.
    const signalAborted = aborted(aEntry.signal);
    const closing = first.host.close();
    await signalAborted;
    expect(aEntry.signal.aborted).toBe(true);
    gate.open();
    await closing;
    database = first.database;
  } finally {
    gate.open();
    await first.host.close().catch(() => undefined);
  }
  const afterClose = await observationPoint({ backend: 'sqlite', database }, configs, [A, B]);
  return { database, configs, afterClose };
}

describe('L8 real Host close and restart (sqlite)', () => {
  it('K5-01/K5-02: A running and B queued stay pending across close, and a new Host retries each once (sqlite)', async () => {
    const gate = installCaptureGate([A.workspaceId]);
    try {
      const closed = await closeHostWithRunningAndQueued(gate);
      // K5-01: both requests stayed requested/pending with no current observation
      // (A was cancelled; B never started), read through the public state.
      const aAfterClose = closed.afterClose[A.workspaceId]!;
      const bAfterClose = closed.afterClose[B.workspaceId]!;
      expect(aAfterClose.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
      expect(aAfterClose.current).toBeNull();
      expect(bAfterClose.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
      expect(bAfterClose.current).toBeNull();
      expect(gate.entries.filter(entry => entry.workspaceId === B.workspaceId)).toHaveLength(0);

      // K5-02: a NEW real Host on the same SQLite database and the same
      // workspaces retries both through its own start, once each.
      const restarted = await startHost({
        backend: 'sqlite', workspaces: closed.configs, database: closed.database,
      });
      try {
        const aDone = await waitState(restarted.base, restarted.token, A, completed);
        const bDone = await waitState(restarted.base, restarted.token, B, completed);
        expect(aDone.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'startup_retry', pending: false });
        expect(bDone.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'startup_retry', pending: false });
        expect(aDone.current).not.toBeNull();
        expect(bDone.current).not.toBeNull();
        // Both gates opened: each workspace's real capture ran on the new Host.
        expect(gate.entries.filter(entry => entry.workspaceId === A.workspaceId).length).toBeGreaterThan(1);
        expect(gate.entries.filter(entry => entry.workspaceId === B.workspaceId).length).toBeGreaterThan(0);
      } finally {
        await restarted.host.close();
      }
    } finally {
      gate.open();
      gate.restore();
    }
  }, 120_000);

  it('SMK3B-3c: an off restart retries no pending capture and leaves A and B at requestSeq 1 (sqlite)', async () => {
    const gate = installCaptureGate([A.workspaceId]);
    try {
      const closed = await closeHostWithRunningAndQueued(gate);
      // §1 off: start only reconciles. The real Host reads this setting beside the
      // ledger before it decides whether to retry the captures left pending.
      await writeAutomationSettings(closed.database,
        { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' });
      // A new real Host on the same files, then its awaited close: the close is
      // the barrier for anything the start's own listen and page fetch detached.
      const restarted = await startHost({
        backend: 'sqlite', workspaces: closed.configs, database: closed.database,
      });
      await restarted.host.close();
      const afterRestart = await observationPoint(
        { backend: 'sqlite', database: closed.database }, closed.configs, [A, B]);
      expect(afterRestart[A.workspaceId]!.autoCapture).toMatchObject({ requestSeq: 1, pending: true });
      expect(afterRestart[B.workspaceId]!.autoCapture).toMatchObject({ requestSeq: 1, pending: true });
      // The gate's real entries stay A ×1 and B ×0: no capture was even attempted.
      expect(gate.entries.filter(entry => entry.workspaceId === A.workspaceId)).toHaveLength(1);
      expect(gate.entries.filter(entry => entry.workspaceId === B.workspaceId)).toHaveLength(0);
    } finally {
      gate.open();
      gate.restore();
    }
  });

  it("T19: a restarted Host that binds only A does not retry B's pending request (sqlite)", async () => {
    const gate = installCaptureGate([A.workspaceId]);
    try {
      const closed = await closeHostWithRunningAndQueued(gate);
      const bBeforeRestart = closed.afterClose[B.workspaceId]!;
      expect(bBeforeRestart.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
      expect(bBeforeRestart.current).toBeNull();
      const bEntriesBefore = gate.entries.filter(entry => entry.workspaceId === B.workspaceId).length;

      // The real Host startup boundary: this Host binds only A. Waiting for A's
      // completed startup retry is the completion barrier for the whole retry pass.
      const restarted = await startHost({
        backend: 'sqlite', database: closed.database,
        workspaces: [closed.configs.find(config => config.scope.workspaceId === A.workspaceId)!],
      });
      try {
        const aDone = await waitState(restarted.base, restarted.token, A, completed);
        expect(aDone.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'startup_retry', pending: false });
        expect(aDone.current).not.toBeNull();
      } finally {
        await restarted.host.close();
      }

      // B was not bound in that Host: its request was neither rewritten nor started.
      const afterRestart = await observationPoint({ backend: 'sqlite', database: closed.database }, closed.configs, [B]);
      const bAfterRestart = afterRestart[B.workspaceId]!;
      expect(bAfterRestart.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
      expect(bAfterRestart.current).toBeNull();
      expect(gate.entries.filter(entry => entry.workspaceId === B.workspaceId)).toHaveLength(bEntriesBefore);
    } finally {
      gate.open();
      gate.restore();
    }
  }, 120_000);
});

type EnteredScenario = {
  storage: ObservationStorage;
  database: string;
  configs: WorkbenchWorkspaceConfig[];
  /** B's real captureObservation entries after the first Host closed. */
  bEntriesBefore: number;
};

/**
 * Row D setup: B is registered first and really ENTERS `captureObservation`
 * (held at the gate), A's request is accepted and queued behind B, then the
 * real `host.close()` aborts B's original signal. B stays pending, A stays
 * queued. On memory both Hosts share the world's one real record backend.
 */
async function closeWithBEntered(backend: Backend, gate: CaptureGate,
  shared: SharedMemoryBackend): Promise<EnteredScenario> {
  const rootA = await makeWorkspace();
  const rootB = await makeWorkspace();
  const configs = [workspaceConfig(A, rootA), workspaceConfig(B, rootB)];
  const first = await startHost({
    backend, workspaces: configs,
    ...(backend === 'memory' ? { sharedMemoryBackend: shared } : {}),
  });
  try {
    await createProject(first, A);
    // B first: its real capture enters the gate and is held there, so the close
    // cancels a capture that really ran (the old `bEnteredBeforeRetry > 0`).
    await registerWorkspace(first, B);
    const bEntry = await gate.entered(B.workspaceId);
    // A is a real accepted request, queued behind B's one Host-wide slot.
    await registerWorkspace(first, A);
    const aQueued = await waitState(first.base, first.token, A,
      state => state.autoCapture?.requestSeq === 1);
    expect(aQueued.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
    expect(aQueued.current).toBeNull();
    // Attach the abort listener before the close: never poll the signal.
    const signalAborted = aborted(bEntry.signal);
    const closing = first.host.close();
    await signalAborted;
    expect(bEntry.signal.aborted).toBe(true);
    gate.open();
    await closing;
    const bEntriesBefore = gate.entries.filter(entry => entry.workspaceId === B.workspaceId).length;
    expect(bEntriesBefore).toBeGreaterThan(0);
    return {
      storage: backend === 'sqlite'
        ? { backend: 'sqlite', database: first.database }
        : { backend: 'memory', sharedMemoryBackend: shared },
      database: first.database,
      configs,
      bEntriesBefore,
    };
  } finally {
    gate.open();
    await first.host.close().catch(() => undefined);
  }
}

describe.each(['memory', 'sqlite'] as const)('L8 real Host close and restart, B entered [%s]', backend => {
  it("T18/T19: B entered the first Host and a restarted Host binding only A leaves B's request untouched", async () => {
    const gate = installCaptureGate([B.workspaceId]);
    const shared = createSharedMemoryBackend();
    try {
      const closed = await closeWithBEntered(backend, gate, shared);
      // After the close both requests are still requested/pending: B's captured
      // run was cancelled by the abort and A never started.
      const afterClose = await observationPoint(closed.storage, closed.configs, [A, B]);
      expect(afterClose[A.workspaceId]!.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
      expect(afterClose[A.workspaceId]!.current).toBeNull();
      expect(afterClose[B.workspaceId]!.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
      expect(afterClose[B.workspaceId]!.current).toBeNull();

      // The second real Host binds only A. A's completed start-up retry is the
      // completion boundary for the whole start-up retry pass.
      const restarted = await startHost({
        backend, database: closed.database,
        workspaces: [closed.configs.find(config => config.scope.workspaceId === A.workspaceId)!],
        ...(backend === 'memory' ? { sharedMemoryBackend: shared } : {}),
      });
      try {
        const aDone = await waitState(restarted.base, restarted.token, A, completed);
        expect(aDone.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'startup_retry', pending: false });
        expect(aDone.current).not.toBeNull();
      } finally {
        await restarted.host.close();
      }

      // B was not bound: its request was neither rewritten nor started, and its
      // real captureObservation entry count did not rise.
      const afterRestart = await observationPoint(closed.storage, closed.configs, [A, B]);
      const bAfterRestart = afterRestart[B.workspaceId]!;
      expect(bAfterRestart.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
      expect(bAfterRestart.current).toBeNull();
      expect(afterRestart[A.workspaceId]!.autoCapture).toMatchObject({ requestSeq: 2, pending: false });
      expect(gate.entries.filter(entry => entry.workspaceId === B.workspaceId)).toHaveLength(closed.bEntriesBefore);
    } finally {
      gate.open();
      gate.restore();
      await shared.close();
    }
  });
});
