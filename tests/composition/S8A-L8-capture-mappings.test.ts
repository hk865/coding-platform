/**
 * L8 rework 1 item 4 (book item 4, Codex must-fix 4) and accepted suggestion 5:
 * one mapping rule inside the capture, and the persisted ref on the public
 * observation state.
 *
 * Every fact is reached through public `createTargetPlatform` writers and
 * readers over a real temporary workspace on both stores: `createProject`,
 * `registerWorkspace`, `adoptInitialArchitecture`, `captureSourceChanges`,
 * `observationState`, `readAutoCapture`, `failAutoCapture`, `queryArchitecture`
 * and `listFiles`. No record, event or observation is hand-written.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { moduleMappingsOf, type AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const files: Record<string, string> = {
  'src/a.ts': 'export const a = 1;\n',
  'notes.md': '# Notes\n',
};
const operator = { kind: 'human' as const, id: 's8a-l8-mapping-operator' };
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
type Backend = 'memory' | 'sqlite';
const BACKENDS: readonly Backend[] = ['memory', 'sqlite'];

type Fixture = {
  platform: Platform;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
};

async function fixture(backend: Backend, projectId: string): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 's8a-l8-capture-mappings-'));
  directories.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  const workspaceId = 'main';
  const scope: WorkspaceScope = { projectId, workspaceId };
  const host: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === projectId && requested.workspaceId === workspaceId
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
    },
    async authorize(bound, requested) {
      const permitted = bound.projectId === projectId && bound.workspaceId === workspaceId &&
        bound.principal.kind === 'host' && bound.principal.actor.id === operator.id &&
        bound.materialReader.kind === 'host' && bound.materialReader.actor.id === operator.id &&
        requested.projectId === projectId && requested.workspaceId === workspaceId;
      return permitted
        ? { status: 'ready', value: { subjectKey: 's8a-l8-mapping-observer',
            permissionRevision: 's8a-l8-capture-mappings-v1',
            allowsRead: (path: string) => Object.prototype.hasOwnProperty.call(files, path) } }
        : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' };
    },
  };
  const platform = await createTargetPlatform({
    storage: backend === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory },
    workspace: host,
    architectureSource: { provider: 'typescript', configPath: null },
  });
  const ctx: CoreCallContext = { projectId, workspaceId,
    principal: { kind: 'host', actor: operator },
    materialReader: { kind: 'host', projectId, workspaceId, actor: operator },
    signal: new AbortController().signal };
  const projectRef = { aggregateType: 'Project' as const, projectId };
  const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId, workspaceId };
  const created = await platform.projects.createProject(ctx, { meta: {
    requestId: projectId + '-create-project', expected: [{ ref: projectRef, revision: 0 }],
  }, input: { projectId } });
  expect(created).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(ctx, { meta: {
    requestId: projectId + '-register-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }],
  }, input: { workspace: scope } });
  expect(registered).toMatchObject({ status: 'committed' });
  return { platform, ctx, scope };
}

const catalog = (projectId: string): AdoptedArchitecture => ({
  requireDag: true,
  dependencies: [],
  modules: [{ ref: { projectId, moduleId: 'A' }, name: 'A', responsibility: 'The src subtree',
    paths: ['src'], interfaces: [] }],
});

const expectedScope = (projectId: string) => [
  { ref: { aggregateType: 'Project' as const, projectId }, revision: 1 },
  { ref: { aggregateType: 'Workspace' as const, projectId, workspaceId: 'main' }, revision: 1 },
];

describe.each(BACKENDS)('L8 capture mappings and persisted ref [%s]', backend => {
  it('captures without mappings by building them from the active catalog, and explicit mappings still work', async () => {
    const projectId = 's8a-l8-capture-mappings-adopted';
    const fx = await fixture(backend, projectId);
    try {
      const adopted = await fx.platform.architecture.adoptInitialArchitecture(fx.ctx, {
        meta: { requestId: projectId + '-adopt', expected: expectedScope(projectId) },
        input: { baselineId: projectId + '-baseline', description: 'Module A owns src',
          constraints: [], catalog: catalog(projectId) },
      });
      expect(adopted).toMatchObject({ status: 'committed', replayed: false });

      // One capture with NO `mappings` at all: the service must use the ACTIVE
      // catalog (module A = `src`), not an empty layer and not `invalid`.
      const captured = await fx.platform.architecture.captureSourceChanges(fx.ctx, {
        input: { workspace: fx.scope, previous: null },
        meta: { requestId: projectId + '-capture-without-mappings', expected: [] },
      });
      expect(captured).toMatchObject({ status: 'committed', replayed: false });
      if (captured.status !== 'committed') return;
      const queried = await fx.platform.architecture.queryArchitecture(fx.ctx, {
        selection: { kind: 'observed', capture: captured.value },
        depth: 1, relations: ['dependency'], page: { limit: 100 },
      });
      expect(queried).toMatchObject({ status: 'ready' });
      if (queried.status !== 'ready') return;
      const moduleNodes = queried.value.nodes.filter(node => node.kind === 'module');
      // Hand-computed: `moduleMappingsOf` maps module A to `src`, so `module:A` exists.
      expect(moduleNodes.map(node => node.nodeId)).toEqual(['module:A']);

      // The explicit caller route is unchanged: the same catalog built by the one
      // shared `moduleMappingsOf` still commits a module-level graph.
      const revision = await fx.platform.architecture.readArchitectureRevision(fx.ctx,
        { selection: { kind: 'current' } });
      expect(revision).toMatchObject({ status: 'ready' });
      if (revision.status !== 'ready' || revision.value.catalog === null) throw Error('the adopted catalog is unavailable');
      const explicit = await fx.platform.architecture.captureSourceChanges(fx.ctx, {
        input: { workspace: fx.scope, mappings: moduleMappingsOf(revision.value.catalog.catalog), previous: null },
        meta: { requestId: projectId + '-capture-explicit-mappings', expected: [] },
      });
      expect(explicit).toMatchObject({ status: 'committed', replayed: false });
      if (explicit.status !== 'committed') return;
      const explicitQuery = await fx.platform.architecture.queryArchitecture(fx.ctx, {
        selection: { kind: 'observed', capture: explicit.value },
        depth: 1, relations: ['dependency'], page: { limit: 100 },
      });
      expect(explicitQuery).toMatchObject({ status: 'ready' });
      if (explicitQuery.status !== 'ready') return;
      expect(explicitQuery.value.nodes.filter(node => node.kind === 'module').map(node => node.nodeId))
        .toEqual(['module:A']);
    } finally {
      await fx.platform.close();
    }
  });

  it('captures without mappings before any adoption as an empty module layer with the real file layer', async () => {
    const projectId = 's8a-l8-capture-mappings-empty';
    const fx = await fixture(backend, projectId);
    try {
      // No catalog exists at all: the server resolves `[]`, so the module layer
      // is empty while the captured file layer still has both real files.
      const captured = await fx.platform.architecture.captureSourceChanges(fx.ctx, {
        input: { workspace: fx.scope, previous: null },
        meta: { requestId: projectId + '-capture-without-catalog', expected: [] },
      });
      expect(captured).toMatchObject({ status: 'committed', replayed: false });
      if (captured.status !== 'committed') return;
      const queried = await fx.platform.architecture.queryArchitecture(fx.ctx, {
        selection: { kind: 'observed', capture: captured.value },
        depth: 1, relations: ['dependency'], page: { limit: 100 },
      });
      expect(queried).toMatchObject({ status: 'ready' });
      if (queried.status !== 'ready') return;
      expect(queried.value.nodes.filter(node => node.kind === 'module')).toEqual([]);
      const listed = await fx.platform.architecture.listFiles(fx.ctx,
        { captureRef: { aggregateType: 'ObservedArchitecture', projectId: fx.scope.projectId,
          workspaceId: fx.scope.workspaceId, captureId: captured.value.capture.captureId }, cursor: null });
      expect(listed).toMatchObject({ status: 'ready' });
      if (listed.status !== 'ready') return;
      expect(listed.value.nodes.map(node => node.path)).toEqual(['notes.md', 'src/a.ts']);
    } finally {
      await fx.platform.close();
    }
  });

  it('publishes the persisted ref of current and previous, and the persisted ref selects the graph', async () => {
    const projectId = 's8a-l8-capture-persisted-ref';
    const fx = await fixture(backend, projectId);
    try {
      const first = await fx.platform.architecture.captureSourceChanges(fx.ctx, {
        input: { workspace: fx.scope, mappings: [], previous: null },
        meta: { requestId: projectId + '-capture-first', expected: [] },
      });
      expect(first).toMatchObject({ status: 'committed' });
      if (first.status !== 'committed') return;
      const beforeState = await fx.platform.architecture.observationState(fx.ctx, { workspace: fx.scope });
      expect(beforeState).toMatchObject({ status: 'ready' });
      if (beforeState.status !== 'ready') return;
      expect(beforeState.value.current?.captureRef).toEqual({ aggregateType: 'ObservedArchitecture',
        projectId: fx.scope.projectId, workspaceId: fx.scope.workspaceId, captureId: first.value.capture.captureId });
      expect(beforeState.value.current?.persistedRef).toEqual(first.value);
      expect(beforeState.value.previous).toBeNull();
      expect(beforeState.value.previousPersistedRef).toBeNull();
      // The public persisted ref selects the observation directly, with no replay.
      const queried = await fx.platform.architecture.queryArchitecture(fx.ctx, {
        selection: { kind: 'observed', capture: first.value },
        depth: 0, relations: ['dependency'], page: { limit: 100 },
      });
      expect(queried).toMatchObject({ status: 'ready' });

      const second = await fx.platform.architecture.captureSourceChanges(fx.ctx, {
        input: { workspace: fx.scope, mappings: [], previous: null },
        meta: { requestId: projectId + '-capture-second', expected: [] },
      });
      expect(second).toMatchObject({ status: 'committed' });
      if (second.status !== 'committed') return;
      const afterState = await fx.platform.architecture.observationState(fx.ctx, { workspace: fx.scope });
      expect(afterState).toMatchObject({ status: 'ready' });
      if (afterState.status !== 'ready') return;
      expect(afterState.value.current?.captureRef).toEqual({ aggregateType: 'ObservedArchitecture',
        projectId: fx.scope.projectId, workspaceId: fx.scope.workspaceId, captureId: second.value.capture.captureId });
      expect(afterState.value.current?.persistedRef).toEqual(second.value);
      expect(afterState.value.previous).toEqual({ aggregateType: 'ObservedArchitecture',
        projectId: fx.scope.projectId, workspaceId: fx.scope.workspaceId, captureId: first.value.capture.captureId });
      expect(afterState.value.previousPersistedRef).toEqual(first.value);

      // The reminder read loads both observations once already; it must expose
      // the same persisted refs from THOSE loads (no extra record read).
      const facts = await fx.platform.architecture.readReminderFacts(fx.ctx,
        { workspace: fx.scope, catalog: null });
      expect(facts).toMatchObject({ status: 'ready' });
      if (facts.status !== 'ready') return;
      expect(facts.value.state.current?.persistedRef).toEqual(second.value);
      expect(facts.value.state.previousPersistedRef).toEqual(first.value);
    } finally {
      await fx.platform.close();
    }
  });

  it('replays an omitted-mappings, omitted-previous capture instead of re-resolving it', async () => {
    const projectId = 's8a-l8-capture-mappings-replay';
    const fx = await fixture(backend, projectId);
    try {
      const request = {
        input: { workspace: fx.scope },
        meta: { requestId: projectId + '-capture-replay', expected: [] },
      };
      const first = await fx.platform.architecture.captureSourceChanges(fx.ctx, request);
      expect(first).toMatchObject({ status: 'committed', replayed: false });
      if (first.status !== 'committed') return;
      // Adopt a catalog AFTER the first capture: a replay must not re-resolve
      // the mappings (that would change the fingerprint and start a capture).
      const adopted = await fx.platform.architecture.adoptInitialArchitecture(fx.ctx, {
        meta: { requestId: projectId + '-adopt', expected: expectedScope(projectId) },
        input: { baselineId: projectId + '-baseline', description: 'Module A owns src',
          constraints: [], catalog: catalog(projectId) },
      });
      expect(adopted).toMatchObject({ status: 'committed' });
      // Same caller input with the same requestId: the resolved mappings and the
      // pointer read are NOT caller facts, so the fingerprint replays.
      const replay = await fx.platform.architecture.captureSourceChanges(fx.ctx, request);
      expect(replay).toMatchObject({ status: 'committed', replayed: true, value: first.value });
      if (replay.status !== 'committed') return;
      const state = await fx.platform.architecture.observationState(fx.ctx, { workspace: fx.scope });
      expect(state).toMatchObject({ status: 'ready' });
      if (state.status !== 'ready') return;
      expect(state.value.current?.persistedRef).toEqual(first.value);
      expect(state.value.previous).toBeNull();
    } finally {
      await fx.platform.close();
    }
  });
});
