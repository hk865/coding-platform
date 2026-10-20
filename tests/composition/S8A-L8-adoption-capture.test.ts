/**
 * L8 A-04 rows 1-3 (book §3): the real Host automatic-capture driver over a
 * real temporary workspace, the public architecture ports and both stores.
 *
 * Every observation, request and catalog record is produced by the platform:
 * the test only creates the Project/Workspace through the public writers, calls
 * the real `createAutoCaptureDriver` as `src/app/host.ts` does, and drives the
 * public `adoptInitialArchitecture` / `reviseArchitectureCatalog` operations.
 * Expected values are hand-computed from the two files written below.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createAutoCaptureDriver, type AutoCaptureDriver } from '../../src/app/auto-capture-driver.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const at = '2026-10-18T00:00:00.000Z';
const operator = { kind: 'human' as const, id: 's8a-l8-operator' };
const systemActor = { kind: 'system' as const, id: 's8a-l8-auto-capture' };
/** Two files: one inside `src`, one outside every module path. */
const FILES: Record<string, string> = {
  'src/a.ts': 'export const a = 1;\n',
  'notes.md': '# Notes\n',
};
const directories: string[] = [];
const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
type TriggerEvent = { kind: 'catalog_adopted' | 'catalog_revised' | 'check_passed'; projectId: string };
type Fixture = {
  platform: Platform;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  driver: AutoCaptureDriver;
  events: TriggerEvent[];
  close(): Promise<void>;
};

const BACKENDS = ['memory', 'sqlite'] as const;
type Backend = (typeof BACKENDS)[number];

/** The same fixture and literals run on both stores the book names. */
async function fixture(backend: Backend, projectId: string, files: Record<string, string>): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 's8a-l8-adoption-capture-'));
  directories.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  const workspaceId = 'main';
  const scope: WorkspaceScope = { projectId, workspaceId };
  const knownActors = new Set([operator.id, systemActor.id]);
  const host: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === projectId && requested.workspaceId === workspaceId
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
    },
    async authorize(bound, requested) {
      const permitted = bound.projectId === projectId && bound.workspaceId === workspaceId &&
        bound.principal.kind === 'host' && knownActors.has(bound.principal.actor.id) &&
        bound.materialReader.kind === 'host' && knownActors.has(bound.materialReader.actor.id) &&
        requested.projectId === projectId && requested.workspaceId === workspaceId;
      return permitted
        ? { status: 'ready', value: { subjectKey: 's8a-l8-observer',
            permissionRevision: 's8a-l8-adoption-capture-v1',
            allowsRead: (path: string) => Object.prototype.hasOwnProperty.call(files, path) } }
        : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' };
    },
  };
  // The mutable sink exists BEFORE the driver, exactly as host.ts does it.
  let sink: ((event: TriggerEvent) => void) | undefined;
  const platform = await createTargetPlatform({
    storage: backend === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory },
    workspace: host,
    now: () => at,
    architectureSource: { provider: 'typescript', configPath: null },
    onArchitectureCaptureTrigger: event => { sink?.(event); },
  });
  const ctx: CoreCallContext = { projectId, workspaceId,
    principal: { kind: 'host', actor: operator },
    materialReader: { kind: 'host', projectId, workspaceId, actor: operator },
    signal: new AbortController().signal };
  const projectRef = { aggregateType: 'Project' as const, projectId };
  const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', ...scope };
  const created = await platform.projects.createProject(ctx, { meta: {
    requestId: projectId + '-create-project', expected: [{ ref: projectRef, revision: 0 }],
  }, input: { projectId } });
  expect(created).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(ctx, { meta: {
    requestId: projectId + '-register-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }],
  }, input: { workspace: scope } });
  expect(registered).toMatchObject({ status: 'committed' });
  const driver = createAutoCaptureDriver({
    architecture: platform.architecture,
    catalog: platform.architecture,
    boundWorkspaces: () => [scope],
    actor: systemActor,
  });
  const events: TriggerEvent[] = [];
  sink = event => { events.push(event); driver.projectChanged(event.projectId, event.kind); };
  return {
    platform, ctx, scope, driver, events,
    async close() { await driver.close(); await platform.close(); },
  };
}

/** Bounded public poll: no hand-made observation state is ever read. */
async function waitForCapture(fx: Fixture, requestSeq: number): Promise<ArchitectureObservationStateV1> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const read = await fx.platform.architecture.observationState(fx.ctx, { workspace: fx.scope });
    expect(read).toMatchObject({ status: 'ready' });
    if (read.status !== 'ready') throw Error('observationState was not ready');
    const state = read.value;
    if (state.autoCapture !== null && state.autoCapture.requestSeq === requestSeq &&
        state.autoCapture.pending === false) return state;
    if (Date.now() >= deadline) {
      throw Error('timed out waiting for capture request ' + requestSeq + ': ' + JSON.stringify(state));
    }
    await sleep(10);
  }
}

const MODULE_A = (projectId: string, responsibility: string) => ({
  ref: { projectId, moduleId: 'A' }, name: 'A',
  responsibility, paths: ['src'], interfaces: [],
});

describe.each(BACKENDS)('L8 A-04 adoption capture through the Host driver [%s]', backend => {
  it('captures registration, first adoption and revision once each, starts none on a replay, and compares the first empty module layer', async () => {
    const projectId = 's8a-l8-adoption-capture';
    const fx = await fixture(backend, projectId, FILES);
    try {
      // 1. Registration captures the file layer only: no catalog yet, so the
      // driver passes `[]` and no module node can exist.
      fx.driver.workspaceRegistered(fx.scope);
      const first = await waitForCapture(fx, 1);
      expect(first.previous).toBeNull();
      expect(first.current).not.toBeNull();
      expect(first.autoCapture).toMatchObject({
        requestSeq: 1, trigger: 'workspace_registered', pending: false,
        status: 'requested', failure: null,
      });
      const firstCaptureRef = first.current!.captureRef;
      expect(firstCaptureRef).toMatchObject({ aggregateType: 'ObservedArchitecture', projectId, workspaceId: 'main' });
      expect(fx.events).toEqual([]);

      // The public state carries the persisted ref `queryArchitecture` selects
      // (`src/contracts/architecture-observation.ts:54`), so the old capture is
      // selected from the public read and no capture replay is needed.
      const emptyModuleLayer = await fx.platform.architecture.queryArchitecture(fx.ctx, {
        selection: { kind: 'observed', capture: first.current!.persistedRef },
        depth: 0, relations: ['dependency'], page: { limit: 100 },
      });
      expect(emptyModuleLayer).toMatchObject({ status: 'ready' });
      if (emptyModuleLayer.status !== 'ready') return;
      expect(emptyModuleLayer.value.nodes.filter(node => node.kind === 'module')).toEqual([]);
      // The module-level graph is empty; the separate file layer still holds
      // both real files, so the capture did observe the workspace.
      const fileLayer = await fx.platform.architecture.listFiles(fx.ctx,
        { captureRef: firstCaptureRef, cursor: null });
      expect(fileLayer).toMatchObject({ status: 'ready' });
      if (fileLayer.status !== 'ready') return;
      expect(fileLayer.value.nodes.map(node => node.path)).toEqual(['notes.md', 'src/a.ts']);

      // 2. First formal adoption (module A = src) yields exactly one more capture.
      const expectedScope = [
        { ref: { aggregateType: 'Project' as const, projectId }, revision: 1 },
        { ref: { aggregateType: 'Workspace' as const, projectId, workspaceId: 'main' }, revision: 1 },
      ];
      const adoptRequest = (() => {
        const input = { baselineId: projectId + '-baseline', description: 'Module A owns src',
          constraints: [], catalog: { requireDag: true, dependencies: [], modules: [MODULE_A(projectId, 'The src subtree')] } };
        return { meta: { requestId: projectId + '-adopt', expected: expectedScope }, input };
      })();
      const adopted = await fx.platform.architecture.adoptInitialArchitecture(fx.ctx, adoptRequest);
      expect(adopted).toMatchObject({ status: 'committed', replayed: false });
      expect(fx.events).toEqual([{ kind: 'catalog_adopted', projectId }]);
      const second = await waitForCapture(fx, 2);
      expect(second.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'catalog_adopted', pending: false });
      expect(second.previous).toEqual(firstCaptureRef);
      const secondCaptureRef = second.current!.captureRef;
      expect(secondCaptureRef.captureId).not.toBe(firstCaptureRef.captureId);

      // 3. One valid revision yields exactly one more capture.
      const beforeRevision = await fx.platform.architecture.readArchitectureRevision(fx.ctx,
        { selection: { kind: 'current' } });
      expect(beforeRevision).toMatchObject({ status: 'ready' });
      if (beforeRevision.status !== 'ready' || beforeRevision.value.catalog === null) {
        throw Error('the adopted catalog is unavailable');
      }
      const revised = await fx.platform.architecture.reviseArchitectureCatalog(fx.ctx, {
        meta: { requestId: projectId + '-revise', expected: expectedScope },
        input: {
          basedOn: { ref: beforeRevision.value.baseline.ref, digest: beforeRevision.value.baseline.contentDigest },
          catalog: { requireDag: true, dependencies: [],
            modules: [MODULE_A(projectId, 'The src subtree after the revision')] },
          reason: 'Sharpen the module responsibility',
        },
      });
      expect(revised).toMatchObject({ status: 'committed', replayed: false });
      expect(fx.events).toEqual([{ kind: 'catalog_adopted', projectId }, { kind: 'catalog_revised', projectId }]);
      const third = await waitForCapture(fx, 3);
      expect(third.autoCapture).toMatchObject({ requestSeq: 3, trigger: 'catalog_revised', pending: false });
      const thirdCaptureRef = third.current!.captureRef;

      // 4. The SAME adoption input and requestId replays and starts no capture.
      const replayed = await fx.platform.architecture.adoptInitialArchitecture(fx.ctx, adoptRequest);
      expect(replayed).toMatchObject({ status: 'committed', replayed: true });
      // A replayed commit fires no trigger and the sink is synchronous, so the
      // events and the public state are asserted immediately.
      expect(fx.events).toHaveLength(2);
      const afterReplay = await fx.platform.architecture.observationState(fx.ctx, { workspace: fx.scope });
      expect(afterReplay).toMatchObject({ status: 'ready' });
      if (afterReplay.status !== 'ready') return;
      expect(afterReplay.value.autoCapture).toMatchObject({ requestSeq: 3, pending: false });
      expect(afterReplay.value.current!.captureRef).toEqual(thirdCaptureRef);

      // 5. Compare the FIRST (module-less) observation with the CURRENT catalog:
      // only `notes.md` is outside `src`; `src/a.ts` is covered and imports nothing.
      const later = await fx.platform.architecture.readArchitectureRevision(fx.ctx,
        { selection: { kind: 'current' } });
      expect(later).toMatchObject({ status: 'ready' });
      if (later.status !== 'ready' || later.value.catalog === null) throw Error('the revised catalog is unavailable');
      const pin: ArchitectureCatalogPinV1 = {
        catalogRef: later.value.catalog.ref,
        baseline: { ref: later.value.baseline.ref, digest: later.value.baseline.contentDigest },
      };
      const comparison = await fx.platform.architecture.compareFormalObserved(fx.ctx,
        { catalog: pin, captureRef: firstCaptureRef });
      expect(comparison).toMatchObject({ status: 'ready', value: { noVerdict: true } });
      if (comparison.status !== 'ready') return;
      expect(comparison.value.findings).toHaveLength(1);
      const ungrouped = comparison.value.findings.filter(finding => finding.kind === 'ungrouped');
      expect(ungrouped.map(finding => finding.path)).toEqual(['notes.md']);
      expect(ungrouped[0]?.moduleRef).toBeNull();
    } finally { await fx.close(); }
  });
});
