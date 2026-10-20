/**
 * L8 (A-04) concurrency and close rows with a controllable gate.
 *
 * The gate is a real injected dependency the platform already takes:
 * `createTargetPlatform`'s `workspace: WorkspaceHostBindings`. Its
 * `resolveRoot` awaits a per-workspace promise the test resolves, so a capture
 * is held at the exact point where it would touch the workspace root. A second
 * A3 wrapper around the REAL `createObservedArchitecture` factory counts each
 * `workspace.captureObservation` from ENTER to RETURN, so the high-water mark
 * covers the whole capture, not only the `resolveRoot` gate (T24). No
 * `setImmediate` timing, no 900-file scan and no hand-written fact: the test
 * only creates Project/Workspace through the public writers, calls the real
 * `createAutoCaptureDriver` exactly as `src/app/host.ts` does, wires the
 * platform's real `onArchitectureCaptureTrigger` to that driver through a
 * mutable sink, and reads the one public `architecture/observation-state`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import * as architectureServiceModule from '../../src/core/work-graph/architecture/architecture-service.js';
import { createAutoCaptureDriver, type AutoCaptureDriver } from '../../src/app/auto-capture-driver.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

type Backend = 'memory' | 'sqlite';
type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
type TriggerEvent = { kind: 'catalog_adopted' | 'catalog_revised' | 'check_passed'; projectId: string };

const operator = { kind: 'human' as const, id: 's8a-l8-gate-operator' };
const systemActor = { kind: 'system' as const, id: 's8a-l8-gate-auto-capture' };
const knownActors = new Set([operator.id, systemActor.id]);
const PROJECT_ID = 's8a-l8-gate-project';
const A: WorkspaceScope = { projectId: PROJECT_ID, workspaceId: 'a' };
const B: WorkspaceScope = { projectId: PROJECT_ID, workspaceId: 'b' };
/** Identical trees on purpose: the chunk body carries the project/workspace
 * scope (K1), so the content-addressed store no longer collides across them. */
const FILES: Record<string, string> = {
  'src/index.ts': 'export const value = 1;\n',
  'notes.md': '# Notes\n',
};

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

type WorkspaceId = 'a' | 'b';

/**
 * A3 delegate wrapper around the REAL `createObservedArchitecture` factory: it
 * counts every real `workspace.captureObservation` from ENTER to RETURN and
 * returns the real result unchanged. `resolveRoot` alone under-counts, because
 * a capture keeps working after the root is resolved (T24).
 */
type CaptureActivity = {
  /** Captures inside the whole `captureObservation` call right now / at most. */
  active: number;
  maxActive: number;
  entered: Record<WorkspaceId, number>;
  /** Resolves when the first real `captureObservation` of that workspace enters. */
  enteredOnce: Record<WorkspaceId, Promise<void>>;
  /** A3: real `releaseCapture` calls per workspace, counted before delegating. */
  releaseCalls: Record<WorkspaceId, number>;
  /** A3: holds the real `captureObservation` AFTER its real result returned. */
  afterCapture: ((id: WorkspaceId) => Promise<void>) | null;
  /** A3: holds the real `releaseCapture` before delegating. */
  releaseGate: ((id: WorkspaceId) => Promise<void>) | null;
  /** A2: one-shot throw at the real `verifyCapture`; returns true to throw. */
  failVerifyOnce: ((id: WorkspaceId) => boolean) | null;
  restore(): void;
};

function installCaptureActivity(): CaptureActivity {
  const entered: Record<WorkspaceId, number> = { a: 0, b: 0 };
  const resolveEntered: Record<WorkspaceId, () => void> = { a: () => {}, b: () => {} };
  const enteredOnce: Record<WorkspaceId, Promise<void>> = {
    a: new Promise<void>(resolve => { resolveEntered.a = resolve; }),
    b: new Promise<void>(resolve => { resolveEntered.b = resolve; }),
  };
  const activity: CaptureActivity = {
    active: 0, maxActive: 0, entered, enteredOnce, releaseCalls: { a: 0, b: 0 },
    afterCapture: null, releaseGate: null, failVerifyOnce: null, restore: () => {},
  };
  const original = architectureServiceModule.createObservedArchitecture;
  const spy = vi.spyOn(architectureServiceModule, 'createObservedArchitecture').mockImplementation(deps => {
    const workspace = deps.workspace;
    const gated = {
      ...workspace,
      async captureObservation(ctx: CoreCallContext, input: Parameters<typeof workspace.captureObservation>[1]) {
        const id: WorkspaceId | null = ctx.workspaceId === 'a' ? 'a' : ctx.workspaceId === 'b' ? 'b' : null;
        if (id !== null) {
          activity.entered[id] += 1;
          resolveEntered[id]();
        }
        activity.active += 1;
        activity.maxActive = Math.max(activity.maxActive, activity.active);
        try {
          const result = await workspace.captureObservation(ctx, input);
          // P1: the gate sits AFTER the real result, so a ready capture is held
          // at exactly the boundary where the owner's abort check decides.
          if (id !== null && activity.afterCapture !== null) await activity.afterCapture(id);
          return result;
        } finally {
          activity.active -= 1;
        }
      },
      async releaseCapture(ctx: CoreCallContext, ref: Parameters<typeof workspace.releaseCapture>[1]) {
        const id: WorkspaceId | null = ctx.workspaceId === 'a' ? 'a' : ctx.workspaceId === 'b' ? 'b' : null;
        if (id !== null) activity.releaseCalls[id] += 1;
        if (id !== null && activity.releaseGate !== null) await activity.releaseGate(id);
        return workspace.releaseCapture(ctx, ref);
      },
      async verifyCapture(ctx: CoreCallContext, ref: Parameters<typeof workspace.verifyCapture>[1]) {
        const id: WorkspaceId | null = ctx.workspaceId === 'a' ? 'a' : ctx.workspaceId === 'b' ? 'b' : null;
        if (id !== null && activity.failVerifyOnce !== null && activity.failVerifyOnce(id)) {
          throw new Error('injected verify failure');
        }
        return workspace.verifyCapture(ctx, ref);
      },
    };
    return original({ ...deps, workspace: gated });
  });
  activity.restore = () => spy.mockRestore();
  return activity;
}

/** One per-workspace gate: `resolveRoot` awaits it before returning the root. */
type Gate = {
  entered: number;
  /** Resolves when the first real `resolveRoot` call for this workspace enters. */
  enteredOnce: Promise<void>;
  /** Counts this entry and waits while the gate is held. */
  enter(): Promise<void>;
  release(): void;
};
function createGate(): Gate {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  let resolveEntered!: () => void;
  const enteredOnce = new Promise<void>(done => { resolveEntered = done; });
  const gate: Gate = {
    entered: 0,
    enteredOnce,
    async enter() {
      gate.entered += 1;
      resolveEntered();
      await promise;
    },
    release: () => resolve(),
  };
  return gate;
}

type Opened = {
  platform: Platform;
  driver: AutoCaptureDriver;
  directory: string;
  gates: { a: Gate; b: Gate };
  activity: CaptureActivity;
};

function contextOf(scope: WorkspaceScope): CoreCallContext {
  return { projectId: scope.projectId, workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: operator },
    materialReader: { kind: 'host', ...scope, actor: operator },
    signal: new AbortController().signal };
}

/** Create the platform with a gated Host binding; held gates stay unresolved. */
async function openPlatform(backend: Backend,
  input: { held?: readonly ('a' | 'b')[]; bound?: readonly WorkspaceScope[] } = {}): Promise<Opened> {
  const directory = await mkdtemp(join(tmpdir(), 's8a-l8-gate-'));
  temporary.push(directory);
  const roots: Record<'a' | 'b', string> = { a: join(directory, 'workspace-a'), b: join(directory, 'workspace-b') };
  for (const id of ['a', 'b'] as const) {
    for (const [path, body] of Object.entries(FILES)) {
      const absolute = join(roots[id], path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, body);
    }
  }
  // Installed BEFORE the platform factory runs, so every capture is wrapped.
  const activity = installCaptureActivity();
  const gates = { a: createGate(), b: createGate() };
  const held = new Set(input.held ?? []);
  for (const id of ['a', 'b'] as const) if (!held.has(id)) gates[id].release();
  const host: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      if (requested.projectId !== PROJECT_ID || (requested.workspaceId !== 'a' && requested.workspaceId !== 'b')) {
        return { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
      }
      const id = requested.workspaceId;
      await gates[id].enter();
      return { status: 'ready', value: { root: roots[id], workspaceRevision: 1 } };
    },
    async authorize(bound, requested) {
      const permitted = bound.projectId === PROJECT_ID && bound.workspaceId === requested.workspaceId &&
        requested.projectId === PROJECT_ID && (requested.workspaceId === 'a' || requested.workspaceId === 'b') &&
        bound.principal.kind === 'host' && knownActors.has(bound.principal.actor.id) &&
        bound.materialReader.kind === 'host' && knownActors.has(bound.materialReader.actor.id);
      return permitted
        ? { status: 'ready', value: { subjectKey: 's8a-l8-gate-observer',
            permissionRevision: 's8a-l8-gate-v1', allowsRead: () => true } }
        : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' };
    },
  };
  // The mutable sink exists BEFORE the driver, exactly as host.ts does it.
  let sink: ((event: TriggerEvent) => void) | undefined;
  const platform = await createTargetPlatform({
    storage: backend === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory },
    workspace: host,
    architectureSource: { provider: 'typescript', configPath: null },
    onArchitectureCaptureTrigger: event => { sink?.(event); },
  });
  const driver = createAutoCaptureDriver({
    architecture: platform.architecture,
    catalog: platform.architecture,
    boundWorkspaces: () => input.bound ?? [A, B],
    actor: systemActor,
  });
  sink = event => { driver.projectChanged(event.projectId, event.kind); };
  return { platform, driver, directory, gates, activity };
}

/** Create Project/A and Project/B through the public platform writers. */
async function seed(platform: Platform): Promise<void> {
  const projectRef = { aggregateType: 'Project' as const, projectId: PROJECT_ID };
  const created = await platform.projects.createProject(contextOf(A), { meta: {
    requestId: PROJECT_ID + '-create-project', expected: [{ ref: projectRef, revision: 0 }],
  }, input: { projectId: PROJECT_ID } });
  expect(created).toMatchObject({ status: 'committed' });
  for (const scope of [A, B]) {
    const registered = await platform.projects.registerWorkspace(contextOf(scope), { meta: {
      requestId: scope.workspaceId + '-register-workspace',
      expected: [{ ref: projectRef, revision: 1 },
        { ref: { aggregateType: 'Workspace' as const, ...scope }, revision: 0 }],
    }, input: { workspace: scope } });
    expect(registered).toMatchObject({ status: 'committed' });
  }
}

/** The two pins an adoption/revision of A expects after `seed`. */
const scopePins = (scope: WorkspaceScope) => [
  { ref: { aggregateType: 'Project' as const, projectId: scope.projectId }, revision: 1 },
  { ref: { aggregateType: 'Workspace' as const, ...scope }, revision: 1 },
];

const catalogWith = (projectId: string, responsibility: string) => ({
  requireDag: true, dependencies: [],
  modules: [{ ref: { projectId, moduleId: 'A' }, name: 'A', responsibility, paths: ['src'], interfaces: [] }],
});

/** A real first adoption; the platform's own trigger reaches the driver sink. */
async function adoptCatalog(platform: Platform, scope: WorkspaceScope): Promise<void> {
  const adopted = await platform.architecture.adoptInitialArchitecture(contextOf(scope), {
    meta: { requestId: scope.projectId + '-adopt', expected: scopePins(scope) },
    input: { baselineId: scope.projectId + '-baseline', description: 'Module A owns src',
      constraints: [], catalog: catalogWith(scope.projectId, 'The src subtree') },
  });
  expect(adopted).toMatchObject({ status: 'committed', replayed: false });
}

/** A real revision of the adopted catalog; it is the control trigger. */
async function reviseCatalog(platform: Platform, scope: WorkspaceScope): Promise<void> {
  const current = await platform.architecture.readArchitectureRevision(contextOf(scope),
    { selection: { kind: 'current' } });
  expect(current).toMatchObject({ status: 'ready' });
  if (current.status !== 'ready' || current.value.catalog === null) throw Error('the adopted catalog is unavailable');
  const revised = await platform.architecture.reviseArchitectureCatalog(contextOf(scope), {
    meta: { requestId: scope.projectId + '-revise', expected: scopePins(scope) },
    input: {
      basedOn: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest },
      catalog: catalogWith(scope.projectId, 'The src subtree after the revision'),
      reason: 'Sharpen the module responsibility',
    },
  });
  expect(revised).toMatchObject({ status: 'committed', replayed: false });
}

/** Bounded polling on the one public read; no test-only hook. */
async function waitFor(platform: Platform, scope: WorkspaceScope,
  predicate: (state: ArchitectureObservationStateV1) => boolean, timeoutMs = 15_000): Promise<ArchitectureObservationStateV1> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const read = await platform.architecture.observationState(contextOf(scope), { workspace: scope });
    if (read.status !== 'ready') throw Error('observation-state was not ready: ' + JSON.stringify(read));
    if (predicate(read.value)) return read.value;
    if (Date.now() >= deadline) throw Error('observation-state did not reach the expected state: ' + JSON.stringify(read.value));
    await sleep(10);
  }
}

const satisfied = (state: ArchitectureObservationStateV1): boolean =>
  state.current !== null && state.autoCapture !== null && state.autoCapture.pending === false;

describe.each(['memory', 'sqlite'] as const)('L8 automatic capture gate [%s]', backend => {
  it('two workspaces are captured one after the other, never both at once', async () => {
    const opened = await openPlatform(backend, { held: ['a', 'b'] });
    const { platform, driver, gates, activity } = opened;
    try {
      await seed(platform);
      driver.workspaceRegistered(A);
      // A has really entered its whole captureObservation, held at resolveRoot.
      await activity.enteredOnce.a;
      // B is a real accepted trigger while A holds the one Host-wide slot. Wait
      // for its request to be publicly accepted before releasing A (T24).
      driver.workspaceRegistered(B);
      const bQueued = await waitFor(platform, B, state => state.autoCapture?.requestSeq === 1);
      expect(bQueued.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
      expect(bQueued.current).toBeNull();
      expect(gates.b.entered).toBe(0);
      expect(activity.entered.b).toBe(0);
      gates.a.release();
      const aState = await waitFor(platform, A, satisfied);
      expect(aState.autoCapture).toMatchObject({ requestSeq: 1, trigger: 'workspace_registered', pending: false });
      // B has now really ENTERED its own captureObservation; only here does the
      // whole-capture high-water mark prove the two captures never overlapped.
      await activity.enteredOnce.b;
      expect(activity.maxActive).toBe(1);
      expect(gates.a.entered).toBeGreaterThan(0);
      gates.b.release();
      const bState = await waitFor(platform, B, satisfied);
      expect(bState.autoCapture).toMatchObject({ requestSeq: 1, trigger: 'workspace_registered', pending: false });
      expect(aState.current).not.toBeNull();
      expect(bState.current).not.toBeNull();
      expect(activity.maxActive).toBe(1);
    } finally {
      gates.a.release(); gates.b.release();
      await driver.close();
      await platform.close();
      activity.restore();
    }
  }, 60_000);

  it('a trigger merged while its workspace waits writes no second request', async () => {
    const opened = await openPlatform(backend, { held: ['a', 'b'], bound: [A] });
    const { platform, driver, gates, activity } = opened;
    try {
      await seed(platform);
      // B blocks the single Host slot, so A is a WAITING queue entry when the
      // second trigger for A arrives; that trigger must merge, not write.
      driver.workspaceRegistered(B);
      await gates.b.enteredOnce;
      driver.workspaceRegistered(A);
      const waiting = await waitFor(platform, A, state => state.autoCapture?.requestSeq === 1);
      expect(waiting.autoCapture).toMatchObject({ requestSeq: 1, trigger: 'workspace_registered', pending: true });
      expect(waiting.current).toBeNull();
      expect(gates.a.entered).toBe(0);
      // The different, REAL accepted trigger: a first formal adoption scans the
      // bound workspaces (only [A] here) and finds A already waiting.
      await adoptCatalog(platform, A);
      const merged = await waitFor(platform, A, () => true);
      expect(merged.autoCapture).toMatchObject({ requestSeq: 1, trigger: 'workspace_registered', pending: true });
      gates.b.release();
      await waitFor(platform, B, satisfied);
      await gates.a.enteredOnce;
      gates.a.release();
      const done = await waitFor(platform, A, satisfied);
      expect(done.autoCapture).toMatchObject({ requestSeq: 1, pending: false });
      expect(done.current).not.toBeNull();
      expect(done.previous).toBeNull();
      // Control: a REAL catalog revision does write a request once A is not
      // waiting, so "requestSeq stayed 1 above" means merged, not ignored.
      await reviseCatalog(platform, A);
      const afterIdleTrigger = await waitFor(platform, A, state =>
        state.autoCapture?.requestSeq === 2 && state.autoCapture.pending === false);
      expect(afterIdleTrigger.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'catalog_revised', pending: false });
    } finally {
      gates.a.release(); gates.b.release();
      await driver.close();
      await platform.close();
      activity.restore();
    }
  }, 60_000);

  it(`close while a second capture is queued leaves it unstarted and pending (${backend})`, async () => {
    const { gates, aAfterClose, bAfterClose, bEntered } = await closeWithQueuedSecondCapture(backend);
    expect(bEntered).toBe(0);
    expect(gates.a.entered).toBeGreaterThan(0);
    expect(gates.b.entered).toBe(0);
    expect(aAfterClose.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
    expect(aAfterClose.current).toBeNull();
    expect(bAfterClose.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
    expect(bAfterClose.current).toBeNull();
  }, 60_000);
});

/**
 * P1/P2: the manual `architecture/capture` public body (no `requestSeq`) on the
 * real platform. The A3 gate holds the REAL `captureObservation` after it
 * returned ready (P1) or the REAL `releaseCapture` (P2); the only A2 fault is
 * one real `verifyCapture` throw. The owner, not the HTTP layer, is asserted.
 */
describe.each(['memory', 'sqlite'] as const)('L8 capture return cancellation [%s]', backend => {
  const body = (requestId: string) => ({ input: { workspace: A, mappings: [], previous: null },
    meta: { requestId, expected: [] } });

  it('P1 a ready capture cancelled at its return is released and reports cancelled', async () => {
    const opened = await openPlatform(backend);
    const { platform, driver, activity } = opened;
    try {
      await seed(platform);
      const before = await platform.architecture.observationState(contextOf(A), { workspace: A });
      expect(before).toMatchObject({ status: 'ready', value: { current: null } });
      const atReturn = createGate();
      activity.afterCapture = async id => { if (id === 'a') await atReturn.enter(); };
      const controller = new AbortController();
      const pending = platform.architecture.captureSourceChanges(
        { ...contextOf(A), signal: controller.signal }, body('p1-cancelled-at-return'));
      await atReturn.enteredOnce;
      controller.abort();
      atReturn.release();
      await expect(pending).resolves.toMatchObject({ status: 'rejected', code: 'cancelled' });
      // The retained capture is released exactly once, not pinned by the cancel.
      expect(activity.releaseCalls.a).toBe(1);
      const after = await platform.architecture.observationState(contextOf(A), { workspace: A });
      expect(after).toMatchObject({ status: 'ready', value: { current: null } });
    } finally {
      activity.afterCapture = null;
      await driver.close();
      await platform.close();
      activity.restore();
    }
  });

  it('P2 cleanup cannot turn an earlier throw into cancelled', async () => {
    const opened = await openPlatform(backend);
    const { platform, driver, activity } = opened;
    try {
      await seed(platform);
      const inRelease = createGate();
      let verifyCalls = 0;
      activity.failVerifyOnce = id => id === 'a' && ++verifyCalls === 1;
      activity.releaseGate = async id => { if (id === 'a') await inRelease.enter(); };
      const controller = new AbortController();
      const pending = platform.architecture.captureSourceChanges(
        { ...contextOf(A), signal: controller.signal }, body('p2-cleanup-error'));
      // The real verify threw while the signal was NOT set; the cleanup is held.
      await inRelease.enteredOnce;
      controller.abort();
      inRelease.release();
      await expect(pending).rejects.toThrow('injected verify failure');
      expect(activity.releaseCalls.a).toBe(1);
    } finally {
      activity.failVerifyOnce = null;
      activity.releaseGate = null;
      await driver.close();
      await platform.close();
      activity.restore();
    }
  });
});

type CloseScenario = {
  gates: { a: Gate; b: Gate };
  /** Gate entries for B at the moment close() was called, before it could run. */
  bEntered: number;
  aAfterClose: ArchitectureObservationStateV1;
  bAfterClose: ArchitectureObservationStateV1;
};

/** Row 3 proper: hold A mid-capture, queue B, close, then release A. */
async function closeWithQueuedSecondCapture(backend: Backend): Promise<CloseScenario> {
  const { platform, driver, gates, activity } = await openPlatform(backend, { held: ['a'] });
  try {
    await seed(platform);
    driver.workspaceRegistered(A);
    await gates.a.enteredOnce;
    driver.workspaceRegistered(B);
    const queued = await waitFor(platform, B, state => state.autoCapture?.requestSeq === 1);
    expect(queued.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: true });
    expect(queued.current).toBeNull();
    // The proof that B has not started BEFORE the close: its gated root was
    // never resolved, and A still holds the one running slot.
    const bEntered = gates.b.entered;
    expect(bEntered).toBe(0);
    const closing = driver.close();
    gates.a.release();
    await closing;
    // The close must not have started B: no root resolution, no observation.
    expect(gates.b.entered).toBe(0);
    const aAfterClose = await waitFor(platform, A, () => true);
    const bAfterClose = await waitFor(platform, B, () => true);
    return { gates, bEntered, aAfterClose, bAfterClose };
  } finally {
    gates.a.release(); gates.b.release();
    await driver.close();
    await platform.close();
    activity.restore();
  }
}
