/**
 * Slice 8 L8 (task A): the automatic-capture request record, the failure write,
 * the start snapshot's previous ref / watermark and the one public observation
 * state (book rulings 3, 7 and 8; spec §1 L8, §5.2 A-04).
 *
 * Every fact is produced by the platform itself:
 *
 * - the Project and Workspace come from the public `createProjectBootstrapServices`
 *   owners (never a hand-committed record or event);
 * - every request record is written by the service when the REAL
 *   `createAutoCaptureDriver` accepts `workspaceRegistered` / `projectChanged`,
 *   and the fixture forwards `projectChanged` only from a REAL, non-replayed
 *   `adoptInitialArchitecture` / `reviseArchitectureCatalog` commit, exactly as
 *   `create-platform.ts`'s own wrapper does (a delegating helper around the real
 *   commit result, not an invented notification);
 * - every observation is a REAL capture of a temporary workspace;
 * - a failed capture is produced by MOVING the workspace root away (the real
 *   access path then rejects); the test never writes a failure record;
 * - the capture gate wraps the real `captureObservation`, so the driver's start
 *   snapshot can be proven by identity, watermark and the stale failure guard.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { ArchitectureSourceMapping } from '../../src/contracts/architecture-source.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { PersistedSourceCaptureRef } from '../../src/contracts/core/source.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { AUTO_CAPTURE_ACTOR, createAutoCaptureDriver, type AutoCaptureDriver } from '../../src/app/auto-capture-driver.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { createObservedArchitecture } from '../../src/core/work-graph/architecture/architecture-service.js';
import type { ArchitectureCatalogPort } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import { OBSERVED_ARCHITECTURE_RECORD_SCHEMAS } from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { WorkspaceToolsPort } from '../../src/core/workspace/ports.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';

const projectId = 's8a-l8-observation';
const workspaceId = 'main';
const workspace: WorkspaceScope = { projectId, workspaceId };
const at = '2026-10-18T00:00:00.000Z';
const actor = { kind: 'human' as const, id: 's8a-l8-reader' };
const context: CoreCallContext = {
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
};
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };

const directories: string[] = [];
const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(value => { resolve = value; });
  return { promise, resolve };
}

/** The book's capture gate: holds the real `captureObservation` at the chosen
 * call index. Everything the service records is still the platform's own fact. */
function gatedTools(tools: WorkspaceToolsPort, holds: readonly Promise<void>[],
  entered: (index: number) => void,
  settled?: (index: number, rejected: boolean) => Promise<void>): WorkspaceToolsPort {
  let index = 0;
  return { ...tools, async captureObservation(ctx, input) {
    const current = index;
    index += 1;
    entered(current);
    const hold = holds[current];
    if (hold !== undefined) await hold;
    const result = await tools.captureObservation(ctx, input);
    if (settled !== undefined) await settled(current, result.status === 'rejected');
    return result;
  } };
}

type FixtureOptions = {
  files?: Record<string, string>;
};

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(kind: 'memory' | 'sqlite', options: FixtureOptions = {}) {
  const files = options.files ?? { 'src/a.ts': 'export const a = 1;\n' };
  const directory = await mkdtemp(join(tmpdir(), 's8a-l8-observation-'));
  directories.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  const allowed = new Set(Object.keys(files));
  const write = async (path: string, body: string): Promise<void> => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
    allowed.add(path);
  };
  for (const [path, body] of Object.entries(files)) await write(path, body);

  const knownActors = new Set([actor.id, AUTO_CAPTURE_ACTOR.id]);
  const access = createWorkspaceAccessFactory({
    resolveRoot: async requested => requested.projectId === projectId && requested.workspaceId === workspaceId
      ? { status: 'ready', value: { root, workspaceRevision: 1 } }
      : { status: 'rejected', code: 'not_found', reason: 'unknown workspace' },
    authorize: async (ctx, requested) => ctx.projectId === projectId && ctx.workspaceId === workspaceId &&
      requested.projectId === projectId && requested.workspaceId === workspaceId &&
      ctx.principal.kind === 'host' && knownActors.has(ctx.principal.actor.id) &&
      ctx.materialReader.kind === 'host' && knownActors.has(ctx.materialReader.actor.id)
      ? { status: 'ready', value: { subjectKey: canonicalJson(['host', ctx.principal.actor.id]),
        permissionRevision: 's8a-l8-observation-v1', allowsRead: (name: string) => allowed.has(name) } }
      : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' },
  });
  const handle = createWorkspaceTools({ access, now: () => at, limits: DEFAULT_WORKSPACE_LIMITS });

  const schemas: RecordBackendSchemas = {
    records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
      ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records],
    events: [...GOAL_RECORD_SCHEMAS.events, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.events,
      ...ARCHITECTURE_CATALOG_SCHEMAS.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
    lookups: [...(OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.lookups ?? []),
      ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [])],
  };
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(directory, 'ledger.sqlite'), schemas });
  const bodies: RawArtifactStorePort & { close?: () => Promise<void> } = kind === 'memory'
    ? new RawArtifactBodyStore() : createSqliteRawArtifactStore(join(directory, 'bodies.sqlite'));

  // The REAL public writers: no record or event is hand-built.
  const bootstrap = createProjectBootstrapServices({ records: backend.records, now: () => at,
    eventId: () => randomUUID() });
  const created = await bootstrap.projects.createProject(context, {
    input: { projectId }, meta: { requestId: 's8a-l8-create-project',
      expected: [{ ref: projectRef, revision: 0 }] },
  });
  if (created.status !== 'committed') throw Error('Project creation failed: ' + JSON.stringify(created));
  const registered = await bootstrap.projects.registerWorkspace(context, {
    input: { workspace }, meta: { requestId: 's8a-l8-register-workspace',
      expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] },
  });
  if (registered.status !== 'committed') throw Error('Workspace registration failed: ' + JSON.stringify(registered));

  const records = backend.records as unknown as GoalRecordTransactionPort & RecordLookupPort;
  const deps = (overrides: { workspace?: WorkspaceToolsPort; records?: typeof records;
    bodies?: RawArtifactStorePort } = {}) => ({
    workspace: overrides.workspace ?? handle.tools,
    access, bodies: overrides.bodies ?? bodies, records: overrides.records ?? records,
    source: { provider: 'typescript' as const, configPath: null as string | null },
  });
  const plain = createObservedArchitecture(deps());
  const catalog = createArchitectureCatalogService({ records });
  // The composition root's real trigger wrapper (create-platform.ts:1194–1211):
  // after a NON-REPLAYED committed adoption/revision it notifies the Host's one
  // driver, and the callback's own failure never changes the commit result.
  // This fixture builds the real catalog owner directly, so it copies that
  // wrapper here; the notification still follows a real commit result.
  let triggerSink: ((event: {
    kind: 'catalog_adopted' | 'catalog_revised'; projectId: string;
  }) => void) | null = null;
  const fireTrigger = (kind: 'catalog_adopted' | 'catalog_revised'): void => {
    try { triggerSink?.({ kind, projectId }); } catch { /* the caller's commit result is unchanged */ }
  };

  return {
    kind, directory, root, handle, backend, bodies, records, deps, plain, catalog,
    write,
    /** A REAL adoption through the public catalog owner. */
    async adopt(requestId: string) {
      const adopted = await catalog.adoptInitialArchitecture(context, {
        input: { baselineId: 's8a-l8-baseline', description: 'S8A L8 observation test', constraints: [],
          catalog: {
            modules: [{ ref: { projectId, moduleId: 'A' }, name: 'A',
              responsibility: 'Owns src', paths: ['src'], interfaces: [] }],
            dependencies: [], requireDag: true,
          } },
        meta: { requestId, expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
      });
      if (adopted.status !== 'committed') throw Error('catalog adoption failed: ' + JSON.stringify(adopted));
      if (!adopted.replayed) fireTrigger('catalog_adopted');
      return adopted;
    },
    /** A REAL later revision: read the current baseline pin publicly, then
     * revise through the public owner with the same Host pins. */
    async revise(requestId: string) {
      const current = await catalog.readArchitectureRevision(context, { selection: { kind: 'current' } });
      if (current.status !== 'ready' || current.value.catalog === null) {
        throw Error('catalog revision read failed: ' + JSON.stringify(current));
      }
      const revised = await catalog.reviseArchitectureCatalog(context, {
        input: {
          basedOn: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest },
          catalog: {
            ...current.value.catalog.catalog,
            modules: current.value.catalog.catalog.modules.map(module => ({
              ...module,
              responsibility: module.responsibility + ' [' + requestId + ']',
            })),
          },
          reason: 'S8A L8 observation test revision',
        },
        meta: { requestId, expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
      });
      if (revised.status !== 'committed') throw Error('catalog revision failed: ' + JSON.stringify(revised));
      if (!revised.replayed) fireTrigger('catalog_revised');
      return revised;
    },
    /** Wire the real Host driver to the fixture's post-commit sink. */
    wireDriver(next: AutoCaptureDriver): AutoCaptureDriver {
      triggerSink = event => { next.projectChanged(event.projectId, event.kind); };
      return next;
    },
    async close() {
      await handle.close();
      await backend.close();
      await bodies.close?.();
    },
  };
}

function makeDriver(fx: Fixture, architecture: ReturnType<typeof createObservedArchitecture>,
  architectureCatalog: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>):
  AutoCaptureDriver {
  return fx.wireDriver(createAutoCaptureDriver({
    architecture,
    catalog: architectureCatalog,
    boundWorkspaces: () => [workspace],
    actor: AUTO_CAPTURE_ACTOR,
  }));
}

async function observationState(fx: Fixture): Promise<ArchitectureObservationStateV1> {
  const read = await fx.plain.observationState(context, { workspace });
  if (read.status !== 'ready') throw Error('observationState was not ready: ' + JSON.stringify(read));
  return read.value;
}

/** A REAL public manual capture producing the old current observation before
 * the driver starts. */
async function manualCapture(fx: Fixture, requestId: string): Promise<PersistedSourceCaptureRef> {
  const manual = await fx.plain.captureSourceChanges(context, captureRequest(requestId));
  if (manual.status !== 'committed') throw Error('manual capture failed: ' + JSON.stringify(manual));
  return manual.value;
}

/** A3: delegates every call to the REAL records port, holds the chosen
 * readMany/lookupCommit at a gate the test controls, then returns the real
 * result unchanged. No stored value is replaced or synthesized. */
function recordsGate(fx: Fixture): {
  records: Fixture['records'];
  entered: Promise<void>;
  release: () => void;
  holdReadMany: (index: number) => void;
  holdNextReadMany: () => void;
  holdNextLookupCommit: () => void;
} {
  const entered = deferred();
  const release = deferred();
  let readIndex = 0;
  let lookupIndex = 0;
  let readTarget: number | null = null;
  let lookupTarget: number | null = null;
  const records = {
    ...fx.records,
    async readMany(refKeys: readonly string[]) {
      const index = readIndex;
      readIndex += 1;
      if (readTarget === index) {
        readTarget = null;
        entered.resolve();
        await release.promise;
      }
      return fx.records.readMany(refKeys);
    },
    async lookupCommit(input: { identityKey: string; fingerprint: string }) {
      const index = lookupIndex;
      lookupIndex += 1;
      if (lookupTarget === index) {
        lookupTarget = null;
        entered.resolve();
        await release.promise;
      }
      return fx.records.lookupCommit(input);
    },
  } as unknown as Fixture['records'];
  return {
    records, entered: entered.promise, release: release.resolve,
    holdReadMany: index => { readTarget = index; },
    holdNextReadMany: () => { readTarget = readIndex; },
    holdNextLookupCommit: () => { lookupTarget = lookupIndex; },
  };
}

/** A3 + A2: run the real `observationState` on a gated records port, hold its
 * chosen `readMany`, abort the caller's signal, then release. */
async function cancelledObservationState(fx: Fixture, holdReadMany: number) {
  const gate = recordsGate(fx);
  const service = createObservedArchitecture(fx.deps({ records: gate.records }));
  const controller = new AbortController();
  gate.holdReadMany(holdReadMany);
  const pending = service.observationState({ ...context, signal: controller.signal }, { workspace });
  await gate.entered;
  controller.abort();
  gate.release();
  return pending;
}

/** A3 + A2: run the real `readReminderFacts` on a gated records port, hold its
 * chosen `readMany`, abort the caller's signal, then release. */
async function cancelledReminderFacts(fx: Fixture, holdReadMany: number) {
  const gate = recordsGate(fx);
  const service = createObservedArchitecture(fx.deps({ records: gate.records }));
  const controller = new AbortController();
  gate.holdReadMany(holdReadMany);
  const pending = service.readReminderFacts({ ...context, signal: controller.signal },
    { workspace, catalog: null });
  await gate.entered;
  controller.abort();
  gate.release();
  return pending;
}

/** Two REAL public captures so the current pointer has a previous observation
 * (observationState's current and previous record reads both run). */
async function twoObservations(fx: Fixture): Promise<void> {
  await manualCapture(fx, 'p08-first');
  await manualCapture(fx, 'p08-second');
  const state = await observationState(fx);
  if (state.current === null || state.previous === null) {
    throw Error('the fixture did not produce a current and previous observation: ' + JSON.stringify(state));
  }
}

/** Bounded polling on the ONE public read; no test-only hook. */
async function waitForState(fx: Fixture,
  predicate: (state: ArchitectureObservationStateV1) => boolean, label: string):
  Promise<ArchitectureObservationStateV1> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const state = await observationState(fx);
    if (predicate(state)) return state;
    if (Date.now() >= deadline) throw Error('timed out waiting for ' + label + ': ' + JSON.stringify(state));
    await sleep(10);
  }
}

const succeeded = (requestSeq: number) => (state: ArchitectureObservationStateV1): boolean =>
  state.autoCapture !== null && state.autoCapture.requestSeq === requestSeq && state.autoCapture.pending === false;
const failed = (requestSeq: number) => (state: ArchitectureObservationStateV1): boolean =>
  state.autoCapture !== null && state.autoCapture.requestSeq === requestSeq && state.autoCapture.status === 'failed';
const accepted = (requestSeq: number) => (state: ArchitectureObservationStateV1): boolean =>
  state.autoCapture !== null && state.autoCapture.requestSeq === requestSeq;

/** A2/A3 wrapper around the REAL public start read. The first call either
 * returns the real ready result after a controlled hold, returns an explicit
 * unavailable rejection once, or throws once; the driver still produces every
 * request and failure record itself. */
function startStateRead(
  architecture: ReturnType<typeof createObservedArchitecture>,
  behavior: 'ready' | 'rejected' | 'throw',
  entered?: () => void, release?: Promise<void>,
): ReturnType<typeof createObservedArchitecture> {
  let calls = 0;
  return { ...architecture, async observationState(ctx, input) {
    if (calls > 0) return architecture.observationState(ctx, input);
    calls += 1;
    // The cancelled-ready row returns the REAL read result: start it with the
    // driver's own context before the hold, so cancellation happens mid-call.
    const real = behavior === 'ready' ? architecture.observationState(ctx, input) : null;
    entered?.();
    if (release !== undefined) await release;
    if (behavior === 'rejected') {
      return { status: 'rejected' as const, code: 'unavailable' as const,
        reason: 'injected observation-state rejection' };
    }
    if (behavior === 'throw') throw Error('injected observation-state throw');
    return real!;
  } };
}

const captureRequest = (requestId: string, mappings: ArchitectureSourceMapping[] = [],
  previous?: PersistedSourceCaptureRef | null) => ({
  input: { workspace, mappings,
    ...(previous === undefined ? {} : { previous }) },
  meta: { requestId, expected: [] as const },
});

const BACKENDS = ['memory', 'sqlite'] as const;

describe('L8 automatic capture and observation state through public steps', () => {
  it.each(BACKENDS)('L8-1 %s: a real trigger captures, the start snapshot previous ref replays as its identity, and the watermark is the request seq', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      driver = makeDriver(fx, fx.plain, fx.catalog);
      // 1. No adoption: the legal empty module layer. The REAL registration
      // trigger writes request 1 and captures.
      driver.workspaceRegistered(workspace);
      const first = await waitForState(fx, succeeded(1), 'first capture');
      expect(first.current).not.toBeNull();
      expect(first.previous).toBeNull();
      expect(first.previousPersistedRef).toBeNull();
      expect(first.autoCapture).toMatchObject({ requestSeq: 1, trigger: 'workspace_registered',
        status: 'requested', failure: null, pending: false });
      const firstRef = first.current!.captureRef;
      const firstPersisted = first.current!.persistedRef;

      // A real source change, then a REAL first adoption causes the second
      // trigger; no notification is sent without a new registration or commit.
      await fx.write('src/b.ts', 'export const b = 2;\n');
      const adopted = await fx.adopt('l8-1-adopt');
      expect(adopted.replayed).toBe(false);
      const second = await waitForState(fx, succeeded(2), 'second capture');
      expect(second.current).not.toBeNull();
      expect(second.current!.captureRef).not.toEqual(firstRef);
      // Book item C: the second capture's start snapshot was the first
      // observation, so `previous` is the first persisted ref.
      expect(second.previous).toEqual(firstRef);
      expect(second.previousPersistedRef).toEqual(firstPersisted);
      expect(second.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'catalog_adopted',
        pending: false });
    } finally {
      await driver?.close();
      await fx.close();
    }
  });

  it.each(BACKENDS)('L8-2 %s: a moved-away root fails the real capture, keeps it pending and the last observation, and the restored retry clears it', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      driver = makeDriver(fx, fx.plain, fx.catalog);
      driver.workspaceRegistered(workspace);
      const first = await waitForState(fx, succeeded(1), 'first capture');
      const firstRef = first.current!.captureRef;

      // Fault injection: the real bindings still name this root, so the real
      // capture rejects at the sandbox; the test writes no failure record. A
      // REAL first adoption commits while the root is away and is the trigger.
      const away = fx.root + '-away';
      await rename(fx.root, away);
      const adopted = await fx.adopt('l8-2-adopt');
      expect(adopted.replayed).toBe(false);
      const failure = await waitForState(fx, failed(2), 'failed capture');
      expect(failure.autoCapture).toMatchObject({
        requestSeq: 2, status: 'failed', pending: true, trigger: 'catalog_adopted',
      });
      expect(failure.autoCapture!.failure).not.toBeNull();
      expect(failure.autoCapture!.failure!.code).toBe('unavailable');
      expect(failure.autoCapture!.failure!.reason).toContain('workspace root unavailable');
      // The failed capture writes no observation: the last successful one stays.
      expect(failure.current).toEqual(first.current);
      expect(failure.previous).toBeNull();

      // A REAL catalog revision is the retry trigger after the root returns.
      await rename(away, fx.root);
      const revised = await fx.revise('l8-2-revise');
      expect(revised.replayed).toBe(false);
      const retried = await waitForState(fx, succeeded(3), 'retried capture');
      expect(retried.current).not.toBeNull();
      expect(retried.current!.captureRef).not.toEqual(firstRef);
      expect(retried.previous).toEqual(firstRef);
      expect(retried.autoCapture).toMatchObject({ requestSeq: 3, status: 'requested',
        trigger: 'catalog_revised', failure: null, pending: false });
    } finally {
      if (driver !== undefined) await driver.close();
      await rename(fx.root + '-away', fx.root).catch(() => undefined);
      await fx.close();
    }
  });

  it.each(BACKENDS)('L8-3 %s: an older start snapshot cannot write failed over a newer pending request; that request then succeeds', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      // The "old observation" is a REAL public manual capture.
      const manual = await fx.plain.captureSourceChanges(context, captureRequest('l8-3-old-observation'));
      expect(manual).toMatchObject({ status: 'committed', replayed: false });
      if (manual.status !== 'committed') return;
      const oldRef = { aggregateType: 'ObservedArchitecture' as const, projectId,
        workspaceId, captureId: manual.value.capture.captureId };

      // Capture seq 1 is held INSIDE captureObservation, after its start
      // snapshot, previous ref and watermark were fixed.
      const releases = [deferred(), deferred()];
      const arrivals = [deferred(), deferred()];
      const away = fx.root + '-away';
      let rootAway = false;
      const gated = createObservedArchitecture(fx.deps({
        workspace: gatedTools(fx.handle.tools, releases.map(release => release.promise),
          index => arrivals[index]?.resolve(),
          // Restore only AFTER seq 1's real capture failed on the moved root.
          // Seq 2 also opens the root to load its `previous` observation before
          // it reaches the gate, so it must see the restored root.
          async (index, rejected) => {
            if (index === 0 && rejected && rootAway) {
              await rename(away, fx.root);
              rootAway = false;
            }
          }),
      }));
      driver = makeDriver(fx, gated, fx.catalog);
      driver.workspaceRegistered(workspace);
      await arrivals[0]!.promise;

      // A REAL first adoption while seq 1 runs writes request seq 2 and queues
      // one more capture; this row has not adopted yet.
      const adopted = await fx.adopt('l8-3-adopt');
      expect(adopted.replayed).toBe(false);
      const acceptedSecond = await waitForState(fx, accepted(2), 'second request acceptance');
      expect(acceptedSecond.autoCapture).toMatchObject({ requestSeq: 2, status: 'requested', pending: true });

      // Seq 1 now fails against the moved root; its failure write is guarded by
      // the START snapshot's revision (1), while the record is at revision 2.
      await rename(fx.root, away);
      rootAway = true;
      releases[0]!.resolve();
      await arrivals[1]!.promise;
      const refused = await observationState(fx);
      expect(refused.autoCapture).toMatchObject({ requestSeq: 2, status: 'requested',
        failure: null, pending: true });
      expect(refused.current!.captureRef).toEqual(oldRef);

      // The gate restored the root after seq 1 failed; let seq 2 run.
      expect(rootAway).toBe(false);
      releases[1]!.resolve();
      const final = await waitForState(fx, succeeded(2), 'second capture');
      expect(final.current).not.toBeNull();
      expect(final.current!.captureRef).not.toEqual(oldRef);
      expect(final.previous).toEqual(oldRef);
      expect(final.previousPersistedRef).toEqual(manual.value);
      expect(final.autoCapture).toMatchObject({ requestSeq: 2, status: 'requested',
        trigger: 'catalog_adopted', failure: null, pending: false });
      // The public state is the only watermark oracle: request 2 is satisfied
      // and the second capture is the current observation.
      const settled = await observationState(fx);
      expect(settled.autoCapture).toMatchObject({ requestSeq: 2, failure: null, pending: false });
      expect(settled.current!.captureRef).toEqual(final.current!.captureRef);
      expect(settled.previous).toEqual(oldRef);
    } finally {
      await driver?.close();
      await rename(fx.root + '-away', fx.root).catch(() => undefined);
      await fx.close();
    }
  });

  it.each(BACKENDS)('L8-4 %s: a real adoption triggers projectChanged with its mappings, and a rejected or thrown catalog read takes the failure exit', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      let catalogFault: 'rejected' | 'throw' | null = null;
      const catalog = {
        async readArchitectureRevision(...args: Parameters<Fixture['catalog']['readArchitectureRevision']>) {
          if (catalogFault === 'rejected') {
            catalogFault = null;
            return { status: 'rejected' as const, code: 'unavailable' as const,
              reason: 'injected catalog rejection' };
          }
          if (catalogFault === 'throw') {
            catalogFault = null;
            throw Error('injected catalog throw');
          }
          return fx.catalog.readArchitectureRevision(...args);
        },
      };
      driver = makeDriver(fx, fx.plain, catalog);
      driver.workspaceRegistered(workspace);
      const first = await waitForState(fx, succeeded(1), 'first capture');

      // The real adoption's commit result is forwarded; the driver's
      // `projectChanged` is therefore fed by the commit wrapper, not invented.
      const adopted = await fx.adopt('l8-4-adopt');
      expect(adopted.replayed).toBe(false);
      const second = await waitForState(fx, succeeded(2), 'adoption capture');
      expect(second.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'catalog_adopted',
        pending: false });
      expect(second.previous).toEqual(first.current!.captureRef);

      // A rejected catalog read at capture start: the SAME failure exit, guarded
      // by the start snapshot's revision. A REAL revision is the trigger.
      catalogFault = 'rejected';
      let revision = await fx.revise('l8-4-revise-rejected');
      expect(revision.replayed).toBe(false);
      const rejected = await waitForState(fx, failed(3), 'catalog-rejected failure');
      expect(rejected.autoCapture).toMatchObject({ requestSeq: 3, status: 'failed', pending: true,
        trigger: 'catalog_revised' });
      expect(rejected.autoCapture!.failure).toEqual({ code: 'unavailable',
        reason: 'injected catalog rejection' });
      expect(rejected.current!.captureRef).toEqual(second.current!.captureRef);

      // The next REAL revision retries with the real catalog.
      revision = await fx.revise('l8-4-revise-retry');
      expect(revision.replayed).toBe(false);
      const retried = await waitForState(fx, succeeded(4), 'retry after catalog rejection');
      expect(retried.current!.captureRef).not.toEqual(second.current!.captureRef);
      expect(retried.autoCapture).toMatchObject({ requestSeq: 4, trigger: 'catalog_revised',
        pending: false });

      // A thrown catalog read also reaches the failure exit with its own reason.
      catalogFault = 'throw';
      revision = await fx.revise('l8-4-revise-thrown');
      expect(revision.replayed).toBe(false);
      const thrown = await waitForState(fx, failed(5), 'catalog-thrown failure');
      expect(thrown.autoCapture).toMatchObject({ requestSeq: 5, status: 'failed', pending: true,
        trigger: 'catalog_revised' });
      expect(thrown.autoCapture!.failure).toEqual({ code: 'unavailable',
        reason: 'injected catalog throw' });
      expect(thrown.current!.captureRef).toEqual(retried.current!.captureRef);
    } finally {
      await driver?.close();
      await fx.close();
    }
  });

  it.each(BACKENDS)('L8-5 %s: a manual capture that starts first and commits after an automatic one keeps the higher watermark', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      const manualRelease = deferred();
      const autoRelease = deferred();
      autoRelease.resolve();
      const manualArrived = deferred();
      const service = createObservedArchitecture(fx.deps({
        workspace: gatedTools(fx.handle.tools, [manualRelease.promise, autoRelease.promise],
          index => { if (index === 0) manualArrived.resolve(); }),
      }));
      driver = makeDriver(fx, service, fx.catalog);

      // The manual capture starts first, with no request record, so its start
      // watermark is 0; it waits inside the real capture.
      const manual = service.captureSourceChanges(context, captureRequest('l8-5-manual'));
      await manualArrived.promise;

      // A real trigger during the manual capture: request 1, and its automatic
      // capture commits first (satisfiedRequestSeq 1).
      driver.workspaceRegistered(workspace);
      const automatic = await waitForState(fx, succeeded(1), 'automatic capture');
      const automaticRef = automatic.current!.captureRef;

      manualRelease.resolve();
      const manualResult = await manual;
      expect(manualResult).toMatchObject({ status: 'committed', replayed: false });
      if (manualResult.status !== 'committed') return;
      const manualRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: manualResult.value.capture.captureId };

      const final = await observationState(fx);
      expect(final.current!.captureRef).toEqual(manualRef);
      expect(final.previous).toEqual(automaticRef);
      // The manual capture started at 0 and commits last; the public state
      // keeps request 1 satisfied and names both observations.
      expect(final.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested', pending: false });
    } finally {
      await driver?.close();
      await fx.close();
    }
  });

  it.each(BACKENDS)('L8-7 %s: a rejected start observation-state read takes the shared failure exit under the start revision', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      const old = await manualCapture(fx, 'l8-7-old');
      const oldRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: old.capture.captureId };
      const architecture = startStateRead(fx.plain, 'rejected');
      driver = makeDriver(fx, architecture, fx.catalog);
      driver.workspaceRegistered(workspace);
      const failure = await waitForState(fx, failed(1), 'start-state rejection failure');
      expect(failure.autoCapture).toMatchObject({ requestSeq: 1, status: 'failed', pending: true,
        trigger: 'workspace_registered', failure: { code: 'unavailable' } });
      expect(failure.autoCapture!.failure!.reason).toContain('injected observation-state rejection');
      // The failure is guarded by the start revision (it committed) and the old
      // current observation is untouched.
      expect(failure.current!.captureRef).toEqual(oldRef);
      expect(failure.previous).toBeNull();
    } finally {
      await driver?.close();
      await fx.close();
    }
  });

  it.each(BACKENDS)('L8-8 %s: a thrown start observation-state read also takes the shared failure exit', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      const old = await manualCapture(fx, 'l8-8-old');
      const oldRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: old.capture.captureId };
      const architecture = startStateRead(fx.plain, 'throw');
      driver = makeDriver(fx, architecture, fx.catalog);
      driver.workspaceRegistered(workspace);
      const failure = await waitForState(fx, failed(1), 'start-state throw failure');
      expect(failure.autoCapture).toMatchObject({ requestSeq: 1, status: 'failed', pending: true,
        trigger: 'workspace_registered', failure: { code: 'unavailable' } });
      expect(failure.autoCapture!.failure!.reason).toContain('injected observation-state throw');
      expect(failure.current!.captureRef).toEqual(oldRef);
      expect(failure.previous).toBeNull();
    } finally {
      await driver?.close();
      await fx.close();
    }
  });

  it.each(BACKENDS)('L8-9 %s: a close during a held start read that returns a failure writes no failed request and keeps the old observation', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      const old = await manualCapture(fx, 'l8-9-old');
      const oldRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: old.capture.captureId };
      const entered = deferred();
      const release = deferred();
      const architecture = startStateRead(fx.plain, 'rejected', () => entered.resolve(), release.promise);
      driver = makeDriver(fx, architecture, fx.catalog);
      driver.workspaceRegistered(workspace);
      await entered.promise;
      // The close aborts the running capture while the start read is held; the
      // released result is a failure, which a cancellation must not record.
      const closing = driver.close();
      release.resolve();
      await closing;
      const state = await observationState(fx);
      expect(state.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested',
        failure: null, pending: true });
      expect(state.current!.captureRef).toEqual(oldRef);
    } finally {
      await driver?.close();
      await fx.close();
    }
  });

  it.each(BACKENDS)('L8-10 %s: a close during a held start read that throws writes no failed request and keeps the old observation', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      const old = await manualCapture(fx, 'l8-10-old');
      const oldRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: old.capture.captureId };
      const entered = deferred();
      const release = deferred();
      const architecture = startStateRead(fx.plain, 'throw', () => entered.resolve(), release.promise);
      driver = makeDriver(fx, architecture, fx.catalog);
      driver.workspaceRegistered(workspace);
      await entered.promise;
      const closing = driver.close();
      release.resolve();
      await closing;
      const state = await observationState(fx);
      expect(state.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested',
        failure: null, pending: true });
      expect(state.current!.captureRef).toEqual(oldRef);
    } finally {
      await driver?.close();
      await fx.close();
    }
  });

  it.each(BACKENDS)('L8-11 %s: a close during a held start read that returns ready writes no failed request and keeps the old observation', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      const old = await manualCapture(fx, 'l8-11-old');
      const oldRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: old.capture.captureId };
      const entered = deferred();
      const release = deferred();
      const architecture = startStateRead(fx.plain, 'ready', () => entered.resolve(), release.promise);
      driver = makeDriver(fx, architecture, fx.catalog);
      driver.workspaceRegistered(workspace);
      await entered.promise;
      const closing = driver.close();
      release.resolve();
      await closing;
      const state = await observationState(fx);
      expect(state.autoCapture).toMatchObject({ requestSeq: 1, status: 'requested',
        failure: null, pending: true });
      expect(state.current!.captureRef).toEqual(oldRef);
      expect(state.previous).toBeNull();
    } finally {
      await driver?.close();
      await fx.close();
    }
  });

  it.each(BACKENDS)('L8-12 %s: T29 a first round that succeeds leaves an already-accepted second real trigger pending until round 2 completes', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      const releases = [deferred(), deferred()];
      const arrivals = [deferred(), deferred()];
      const gated = createObservedArchitecture(fx.deps({
        workspace: gatedTools(fx.handle.tools, releases.map(release => release.promise),
          index => arrivals[index]?.resolve()),
      }));
      driver = makeDriver(fx, gated, fx.catalog);

      // Round 1 runs inside the real capture; a REAL first adoption is the
      // second trigger while round 1 is still in flight.
      driver.workspaceRegistered(workspace);
      await arrivals[0]!.promise;
      const adopted = await fx.adopt('l8-12-adopt');
      expect(adopted.replayed).toBe(false);
      const queued = await waitForState(fx, accepted(2), 'second trigger acceptance');
      expect(queued.autoCapture).toMatchObject({ requestSeq: 2, status: 'requested',
        trigger: 'catalog_adopted', failure: null, pending: true });

      // Round 1 SUCCEEDS while request 2 is already pending: the success must
      // not clear or overwrite the accepted second request.
      releases[0]!.resolve();
      const afterFirst = await waitForState(fx,
        state => state.current !== null && state.previous === null && state.autoCapture?.requestSeq === 2,
        'round 1 success with round 2 pending');
      expect(afterFirst.autoCapture).toMatchObject({ requestSeq: 2, status: 'requested',
        failure: null, pending: true });
      const firstRef = afterFirst.current!.captureRef;

      // Round 2 is held inside the real capture too, so its pending state is
      // proven by a real entered barrier, never by a sleep.
      await arrivals[1]!.promise;
      const duringSecond = await observationState(fx);
      expect(duringSecond.autoCapture).toMatchObject({ requestSeq: 2, pending: true });
      expect(duringSecond.current!.captureRef).toEqual(firstRef);

      releases[1]!.resolve();
      const final = await waitForState(fx, succeeded(2), 'round 2 completion');
      expect(final.current!.captureRef).not.toEqual(firstRef);
      expect(final.previous).toEqual(firstRef);
      expect(final.autoCapture).toMatchObject({ requestSeq: 2, status: 'requested',
        failure: null, pending: false });
    } finally {
      await driver?.close();
      await fx.close();
    }
  });

  it.each(BACKENDS)('P06 %s: a close during the held failure snapshot read writes no failed record', async kind => {
    const fx = await fixture(kind);
    let driver: AutoCaptureDriver | undefined;
    try {
      // The real root is moved away, so the real capture rejects and the driver
      // enters the failure write. The records gate is armed after that
      // rejection, so the next records read is the failure owner's start
      // snapshot read.
      const away = fx.root + '-away';
      await rename(fx.root, away);
      const gate = recordsGate(fx);
      const gatedWorkspace = gatedTools(fx.handle.tools, [], () => undefined,
        async (index, rejected) => { if (index === 0 && rejected) gate.holdNextReadMany(); });
      const service = createObservedArchitecture(fx.deps({ records: gate.records, workspace: gatedWorkspace }));
      driver = makeDriver(fx, service, fx.catalog);
      driver.workspaceRegistered(workspace);
      await gate.entered;
      // The Host close aborts the running round while the snapshot read is in
      // flight; its real result arrives after the abort.
      const closing = driver.close();
      gate.release();
      await closing;
      const record = await fx.plain.readAutoCapture(context, { workspace });
      if (record.status !== 'ready') throw Error('the public record read failed: ' + JSON.stringify(record));
      expect(record.value).toMatchObject({ requestSeq: 1, status: 'requested', failure: null });
    } finally {
      await driver?.close();
      await rename(fx.root + '-away', fx.root).catch(() => undefined);
      await fx.close();
    }
  });

  it.each(BACKENDS)('P07 %s: a cancelled record read returns cancelled, never ready', async kind => {
    const fx = await fixture(kind);
    try {
      const gate = recordsGate(fx);
      const service = createObservedArchitecture(fx.deps({ records: gate.records }));
      const controller = new AbortController();
      gate.holdReadMany(0);
      const pending = service.readAutoCapture({ ...context, signal: controller.signal }, { workspace });
      await gate.entered;
      controller.abort();
      gate.release();
      const result = await pending;
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await fx.close(); }
  });
  it.each(BACKENDS)('P08 %s: a cancellation during the observation-state basis read returns cancelled, never ready', async kind => {
    const fx = await fixture(kind);
    try {
      await twoObservations(fx);
      // readMany 0 = the current pointer; 1 = the request record inside the basis.
      const result = await cancelledObservationState(fx, 0);
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await fx.close(); }
  });

  it.each(BACKENDS)('P08 %s: a cancellation during the current observation record read returns cancelled, never ready', async kind => {
    const fx = await fixture(kind);
    try {
      await twoObservations(fx);
      // readMany 2 = the current observation record (after pointer and request).
      const result = await cancelledObservationState(fx, 2);
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await fx.close(); }
  });

  it.each(BACKENDS)('P08 %s: a cancellation during the previous observation record read returns cancelled, never ready', async kind => {
    const fx = await fixture(kind);
    try {
      await twoObservations(fx);
      // readMany 3 = the previous observation record.
      const result = await cancelledObservationState(fx, 3);
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await fx.close(); }
  });
  it.each(BACKENDS)('P09 %s: a cancelled early capture replay returns cancelled and leaves the current observation unchanged', async kind => {
    const fx = await fixture(kind);
    try {
      await manualCapture(fx, 'p09-capture');
      const before = await observationState(fx);
      expect(before.current).not.toBeNull();

      // Replay the SAME public command. A3 holds the real idempotency lookup;
      // the caller's signal is aborted while it is in flight, then the real
      // committed receipt is restored. Only a post-await check can stop it.
      const gate = recordsGate(fx);
      const service = createObservedArchitecture(fx.deps({ records: gate.records }));
      const controller = new AbortController();
      gate.holdNextLookupCommit();
      const pending = service.captureSourceChanges({ ...context, signal: controller.signal },
        captureRequest('p09-capture'));
      await gate.entered;
      controller.abort();
      gate.release();
      const result = await pending;
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });

      const after = await observationState(fx);
      expect(after).toEqual(before);
    } finally { await fx.close(); }
  });
  it.each(BACKENDS)('K3-08 %s: a cancellation during the reminder basis read returns cancelled, never ready', async kind => {
    const fx = await fixture(kind);
    try {
      // No observation pointer: the request read is the LAST await of the basis,
      // and no later load/open can turn the abort into a cancellation for us.
      // readMany 0 = the (absent) current pointer; 1 = the request record.
      const result = await cancelledReminderFacts(fx, 1);
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await fx.close(); }
  });

  it.each(BACKENDS)('K3-09 %s: a cancellation during the latest reminder observation load returns cancelled, never ready', async kind => {
    const fx = await fixture(kind);
    try {
      // One observation and no previous: the latest record read is the LAST
      // await of the call, so only the post-load check can cancel it.
      await manualCapture(fx, 'k3-09-capture');
      // readMany 0 = pointer; 1 = request; 2 = the latest loadObservation record.
      const result = await cancelledReminderFacts(fx, 2);
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await fx.close(); }
  });

  it.each(BACKENDS)('K3-10 %s: a cancellation during the previous reminder observation load returns cancelled, never ready', async kind => {
    const fx = await fixture(kind);
    try {
      await twoObservations(fx);
      // readMany 3 = the previous loadObservation record read; the ready return
      // follows it directly once both loads are done.
      const result = await cancelledReminderFacts(fx, 3);
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await fx.close(); }
  });
});

// Keep the tmp-directory cleanup outside each test so a moved root cannot leak.
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
