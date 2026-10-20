/**
 * L8 (book rulings 2–3; K2-01, K2-02, S12): the start observation-state read.
 *
 * The start snapshot (`readAutoCapture`) is the documented exception: a failure
 * leaves the request pending. The `observationState` read that follows is NOT a
 * silent exit: a non-cancel failure or throw goes to the SAME `failAutoCapture`
 * exit with the start snapshot's revision guard; a cancellation writes nothing.
 * The failure write runs on the running round's own `controller.signal`, never a
 * fresh controller.
 *
 * Every prior state is reached the way production reaches it: the real
 * `createTargetPlatform`, a real workspace on disk, the real public
 * Project/Workspace writers and the real `createAutoCaptureDriver`. The only
 * wrappers are the rule sheet's A3 (hold or count, then return the real result)
 * and A2 (a real dependency fails once at a named point). The later owner rows
 * add rework-3 row A's cancellation precedence (B-1, B-2, B-3; P05–P09): the
 * real service runs on the real records port with A2/A3 faults at read, lookup,
 * commit and event-restore boundaries, always reached by the Driver's own body.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { EncodedDomainEvent, GoalRecordTransactionPort, RecordBatchRead, StoreCommitReceipt,
  StoreResult } from '../../src/core/record-store/ports.js';
import * as architectureServiceModule from '../../src/core/work-graph/architecture/architecture-service.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createAutoCaptureDriver, type AutoCaptureDriver } from '../../src/app/auto-capture-driver.js';
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

type Backend = 'memory' | 'sqlite';
type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;

const operator = { kind: 'human' as const, id: 's8a-l8-start-operator' };
const systemActor = { kind: 'system' as const, id: 's8a-l8-start-auto-capture' };
const knownActors = new Set([operator.id, systemActor.id]);
const PROJECT_ID = 's8a-l8-start-project';
const A: WorkspaceScope = { projectId: PROJECT_ID, workspaceId: 'a' };
const FILES = { 'src/a.ts': 'export const a = 1;\n', 'notes.md': '# Notes A\n' };

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => { setTimeout(resolve, milliseconds); });

function contextOf(scope: WorkspaceScope): CoreCallContext {
  return { projectId: scope.projectId, workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: operator },
    materialReader: { kind: 'host', ...scope, actor: operator },
    signal: new AbortController().signal };
}

/**
 * A2/A3 faults on the REAL records port (`readMany`, `lookupCommit`, `commit`).
 * A fault wrapper either delegates the real call unchanged, holds it at a gate
 * the test controls, or fails once at that named point. Nothing is stored or
 * returned that the real store did not produce, except that explicit failure.
 */
type Records = GoalRecordTransactionPort & RecordLookupPort;
type CommittedReceipt = Extract<StoreCommitReceipt, { status: 'committed' }>;
type RecordsFaults = {
  readMany?: (next: () => Promise<StoreResult<RecordBatchRead>>, call: number) => Promise<StoreResult<RecordBatchRead>>;
  lookupCommit?: (next: () => Promise<StoreResult<CommittedReceipt>>, call: number) => Promise<StoreResult<CommittedReceipt>>;
  commit?: (next: () => Promise<StoreCommitReceipt>, call: number) => Promise<StoreCommitReceipt>;
  eventAt?: (next: () => Promise<StoreResult<{ cursor: CommitCursor; event: EncodedDomainEvent }>>, call: number)
    => Promise<StoreResult<{ cursor: CommitCursor; event: EncodedDomainEvent }>>;
};

function withRecordFaults(records: Records, faults: RecordsFaults): Records {
  let readManyCall = 0;
  let lookupCommitCall = 0;
  let commitCall = 0;
  let eventAtCall = 0;
  const wrapped: Records = {
    ...records,
    readMany(refKeys) {
      const call = readManyCall;
      readManyCall += 1;
      const next = () => records.readMany(refKeys);
      return faults.readMany === undefined ? next() : faults.readMany(next, call);
    },
    lookupCommit(input) {
      const call = lookupCommitCall;
      lookupCommitCall += 1;
      const next = () => records.lookupCommit(input);
      return faults.lookupCommit === undefined ? next() : faults.lookupCommit(next, call);
    },
    commit(input) {
      const call = commitCall;
      commitCall += 1;
      const next = () => records.commit(input);
      return faults.commit === undefined ? next() : faults.commit(next, call);
    },
    eventAt(cursor) {
      const call = eventAtCall;
      eventAtCall += 1;
      const next = () => records.eventAt(cursor);
      return faults.eventAt === undefined ? next() : faults.eventAt(next, call);
    },
  };
  return wrapped;
}

/** A real workspace on disk plus the real platform for one scope. */
async function openPlatform(backend: Backend, faults?: RecordsFaults): Promise<Platform> {
  const directory = await mkdtemp(join(tmpdir(), 's8a-l8-start-'));
  temporary.push(directory);
  const root = join(directory, 'workspace');
  for (const [path, body] of Object.entries(FILES)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, body);
  }
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*.ts'],
  }));
  const host: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === PROJECT_ID && requested.workspaceId === 'a'
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'not_found', reason: 'unknown workspace' };
    },
    async authorize(bound, requested) {
      const permitted = bound.projectId === PROJECT_ID && bound.workspaceId === 'a' &&
        requested.projectId === PROJECT_ID && requested.workspaceId === 'a' &&
        bound.principal.kind === 'host' && knownActors.has(bound.principal.actor.id) &&
        bound.materialReader.kind === 'host' && knownActors.has(bound.materialReader.actor.id);
      return permitted
        ? { status: 'ready', value: { subjectKey: 's8a-l8-start-observer',
            permissionRevision: 's8a-l8-start-v1', allowsRead: () => true } }
        : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' };
    },
  };
  const original = architectureServiceModule.createObservedArchitecture;
  const spy = faults === undefined ? null
    : vi.spyOn(architectureServiceModule, 'createObservedArchitecture').mockImplementation(deps => original({
      ...deps,
      ...(faults === undefined ? {} : { records: withRecordFaults(deps.records, faults) }),
    }));
  let platform: Platform;
  try {
    platform = await createTargetPlatform({
      storage: backend === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory },
      workspace: host,
      architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    });
  } finally {
    spy?.mockRestore();
  }
  // The real public writers produce Project/Workspace; no record is encoded.
  const projectRef = { aggregateType: 'Project' as const, projectId: PROJECT_ID };
  const created = await platform.projects.createProject(contextOf(A), { meta: {
    requestId: `${PROJECT_ID}-create-project`, expected: [{ ref: projectRef, revision: 0 }],
  }, input: { projectId: PROJECT_ID } });
  expect(created).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(contextOf(A), { meta: {
    requestId: `${A.workspaceId}-register-workspace`,
    expected: [{ ref: projectRef, revision: 1 },
      { ref: { aggregateType: 'Workspace' as const, ...A }, revision: 0 }],
  }, input: { workspace: A } });
  expect(registered).toMatchObject({ status: 'committed' });
  return platform;
}

function driverFor(platform: Platform,
  overrides: Partial<Platform['architecture']> = {}): AutoCaptureDriver {
  const architecture: Platform['architecture'] = { ...platform.architecture, ...overrides };
  return createAutoCaptureDriver({
    architecture,
    catalog: platform.architecture,
    boundWorkspaces: () => [A],
    actor: systemActor,
  });
}

async function waitFor(platform: Platform, scope: WorkspaceScope,
  predicate: (state: ArchitectureObservationStateV1) => boolean, timeoutMs = 10_000): Promise<ArchitectureObservationStateV1> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const read = await platform.architecture.observationState(contextOf(scope), { workspace: scope });
    if (read.status !== 'ready') throw Error('observation-state was not ready: ' + JSON.stringify(read));
    if (predicate(read.value)) return read.value;
    if (Date.now() >= deadline) throw Error('observation-state did not reach the expected state: ' + JSON.stringify(read.value));
    await sleep(10);
  }
}

describe.each(['memory', 'sqlite'] as const)('L8 capture start observation-state [%s]', backend => {
  it.each(['not_found', 'not_ready'] as const)(
    'a %s start state read maps to unavailable with a state-read reason', async kind => {
      const platform = await openPlatform(backend);
      const driver = driverFor(platform, {
        async observationState() {
          return kind === 'not_found'
            ? { status: 'not_found' as const }
            : { status: 'not_ready' as const, observed: null,
                required: { kind: 'platform' as const, cursor: 's8a-l8-required' as CommitCursor } };
        },
      });
      try {
        driver.workspaceRegistered(A);
        const failed = await waitFor(platform, A, state => state.autoCapture?.status === 'failed');
        expect(failed.autoCapture).toMatchObject({
          requestSeq: 1, status: 'failed', pending: true,
          failure: { code: 'unavailable', reason: `the start observation state read returned ${kind}` },
        });
        expect(failed.current).toBeNull();
      } finally { await driver.close(); await platform.close(); }
    }, 60_000);

  it('a broken start snapshot read leaves the request pending (documented exception)', async () => {
    const platform = await openPlatform(backend);
    const driver = driverFor(platform, {
      async readAutoCapture() { throw new Error('injected start snapshot throw'); },
    });
    try {
      driver.workspaceRegistered(A);
      const pending = await waitFor(platform, A, state => state.autoCapture?.requestSeq === 1);
      expect(pending.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
      expect(pending.current).toBeNull();
    } finally { await driver.close(); await platform.close(); }
  }, 60_000);

  it('passes the running round signal to the failed-write owner', async () => {
    const platform = await openPlatform(backend);
    let stateSignal: AbortSignal | undefined;
    let failureSignal: AbortSignal | undefined;
    const driver = driverFor(platform, {
      async observationState(ctx) {
        stateSignal = ctx.signal;
        return { status: 'rejected', code: 'unavailable', reason: 'injected start-state failure' };
      },
      async failAutoCapture(ctx, input) {
        failureSignal = ctx.signal;
        return platform.architecture.failAutoCapture(ctx, input);
      },
    });
    try {
      driver.workspaceRegistered(A);
      const failed = await waitFor(platform, A, state => state.autoCapture?.status === 'failed');
      expect(failed.autoCapture).toMatchObject({ status: 'failed', requestSeq: 1, pending: true });
      expect(stateSignal).toBeInstanceOf(AbortSignal);
      // The SAME running round's signal, not a fresh AbortController().
      expect(failureSignal).toBe(stateSignal);
      expect(failureSignal?.aborted).toBe(false);
    } finally { await driver.close(); await platform.close(); }
  }, 60_000);
});

/** A3: one controlled hold. `arm()` targets the next call the wrapper sees;
 * `entered` resolves inside that call; `release()` lets it continue. */
type OneShot = { arm: () => void; entered: Promise<void>; release: () => void; take: () => Promise<void> | null };
function oneShot(): OneShot {
  let armed = false;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  return {
    arm() { armed = true; },
    entered,
    release() { release(); },
    take() {
      if (!armed) return null;
      armed = false;
      enter();
      return held;
    },
  };
}

/** The Driver's own Host system call identity for the owner fault rows. */
function hostContext(scope: WorkspaceScope, signal: AbortSignal): CoreCallContext {
  return createHostCoreCallContext({ scope, actor: systemActor, signal });
}

describe.each(['memory', 'sqlite'] as const)('L8 owner cancellation precedence [%s]', backend => {
  it('readAutoCapture returns cancelled when its read throws after the caller cancelled', async () => {
    const gate = oneShot();
    const platform = await openPlatform(backend, {
      readMany: async next => {
        const held = gate.take();
        if (held !== null) { await held; throw new Error('injected read failure'); }
        return next();
      },
    });
    try {
      const controller = new AbortController();
      gate.arm();
      const pending = platform.architecture.readAutoCapture(hostContext(A, controller.signal), { workspace: A });
      await gate.entered;
      controller.abort();
      gate.release();
      await expect(pending).resolves.toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await platform.close(); }
  });

  it('observationState returns cancelled when its basis read throws after the caller cancelled', async () => {
    const gate = oneShot();
    const platform = await openPlatform(backend, {
      readMany: async next => {
        const held = gate.take();
        if (held !== null) { await held; throw new Error('injected read failure'); }
        return next();
      },
    });
    try {
      const controller = new AbortController();
      gate.arm();
      const pending = platform.architecture.observationState(hostContext(A, controller.signal), { workspace: A });
      await gate.entered;
      controller.abort();
      gate.release();
      await expect(pending).resolves.toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await platform.close(); }
  });
});
