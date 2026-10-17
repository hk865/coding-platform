/**
 * Slice 8A acceptance entry AE1 (spec §5.1 line 366; §5.2 A-02 line 378,
 * A-02b line 389): the PUBLIC `platform.architecture.compareFormalObserved`
 * wiring. The catalog is adopted and read through the public entries; the
 * observation is captured from a real temporary workspace. The expected
 * finding arrays are literal and copied from the spec rows. No database read
 * verifies an assertion.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AdoptInitialArchitectureInput, ArchitectureCatalogPinV1,
  ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ObservedCaptureRef } from '../../src/contracts/architecture-inspection.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ModuleRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const at = '2026-10-17T00:00:00.000Z';
const actor = { kind: 'human' as const, id: 's8a-ae1-comparison-operator' };
const mappings = [{ id: 'SRC', kind: 'module' as const, paths: ['src'] }];
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
type Fixture = { platform: Platform; ctx: CoreCallContext; scope: WorkspaceScope; close(): Promise<void> };

/** Both storage backends the book requires; the same fixture and literals run on each. */
const BACKENDS = ['memory', 'sqlite'] as const;
type Backend = (typeof BACKENDS)[number];

async function fixture(backend: Backend, projectId: string, files: Record<string, string>): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 's8a-ae1-comparison-'));
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
        bound.principal.kind === 'host' && bound.principal.actor.id === actor.id &&
        bound.materialReader.kind === 'host' && bound.materialReader.actor.id === actor.id &&
        requested.projectId === projectId && requested.workspaceId === workspaceId;
      return permitted
        ? { status: 'ready', value: { subjectKey: 's8a-ae1-comparison-reader',
            permissionRevision: 's8a-ae1-comparison-v1',
            allowsRead: (path: string) => Object.prototype.hasOwnProperty.call(files, path) } }
        : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' };
    },
  };
  // `configPath: null` is the provider's "no project configuration" value, so no
  // tsconfig.json leaks into the file graph as an extra `other` node.
  const architectureSource = { provider: 'typescript' as const, configPath: null };
  const platform = await createTargetPlatform({
    storage: backend === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory },
    workspace: host, now: () => at, architectureSource,
  });
  const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
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
  return { platform, ctx, scope, async close() { await platform.close(); } };
}

function moduleDef(projectId: string, moduleId: string, paths: string[]): ModuleDefinition {
  return { ref: { projectId, moduleId }, name: moduleId, responsibility: moduleId + ' responsibility',
    paths, interfaces: [] };
}

async function adopt(fx: Fixture, baselineId: string, modules: ModuleDefinition[],
  dependencies: AdoptInitialArchitectureInput['catalog']['dependencies']): Promise<ArchitectureCatalogPinV1> {
  const adopted = await fx.platform.architecture.adoptInitialArchitecture(fx.ctx, {
    meta: { requestId: fx.scope.projectId + '-adopt', expected: [
      { ref: { aggregateType: 'Project', projectId: fx.scope.projectId }, revision: 1 },
      { ref: { aggregateType: 'Workspace', ...fx.scope }, revision: 1 },
    ] },
    input: { baselineId, description: 'A-02 comparison fixture', constraints: [],
      catalog: { requireDag: true, dependencies, modules } },
  });
  expect(adopted).toMatchObject({ status: 'committed' });
  if (adopted.status !== 'committed') throw Error('public adoption failed');
  const read = await fx.platform.architecture.readArchitectureRevision(fx.ctx, { selection: { kind: 'current' } });
  expect(read).toMatchObject({ status: 'ready' });
  if (read.status !== 'ready' || read.value.catalog === null) throw Error('public catalog read failed');
  return { catalogRef: read.value.catalog.ref,
    baseline: { ref: read.value.baseline.ref, digest: read.value.baseline.contentDigest } };
}

async function capture(fx: Fixture, requestId: string): Promise<ObservedCaptureRef> {
  const captured = await fx.platform.architecture.captureSourceChanges(fx.ctx, {
    input: { workspace: fx.scope, mappings, previous: null },
    meta: { requestId, expected: [] },
  });
  expect(captured).toMatchObject({ status: 'committed' });
  if (captured.status !== 'committed') throw Error('public capture failed: ' + requestId);
  return { aggregateType: 'ObservedArchitecture', projectId: fx.scope.projectId,
    workspaceId: fx.scope.workspaceId, captureId: captured.value.capture.captureId };
}

describe.each(BACKENDS)('AE1 A-02 public formal-vs-observed comparison [%s]', backend => {
  it('wires the five exact A-02 findings and noVerdict through the platform', async () => {
    const projectId = 's8a-ae1-a02';
    const ref = (moduleId: string): ModuleRef => ({ projectId, moduleId });
    const files = {
      'src/a/one.ts': 'export const one = 1;\n',
      'src/b/lib.ts': 'export const lib = 1;\n',
      'src/c/one.ts': 'import { d } from "../d/one";\nexport const c = d;\n',
      'src/d/one.ts': 'export const d = 1;\n',
      'src/a/broken.ts': 'import { x } from "src/nowhere.ts";\nexport const broken = x;\n',
      'src/loose.ts': 'export const loose = 1;\n',
      'src/dup/one.ts': 'export const dup = 1;\n',
    };
    const fx = await fixture(backend, projectId, files);
    try {
      const modules = [
        moduleDef(projectId, 'A', ['src/a']),
        moduleDef(projectId, 'B', ['src/b']),
        moduleDef(projectId, 'C', ['src/c']),
        moduleDef(projectId, 'D', ['src/d']),
        moduleDef(projectId, 'P1', ['src/dup']),
        moduleDef(projectId, 'P2', ['src/dup']),
      ];
      const pin = await adopt(fx, 'a02-baseline', modules, [{ from: ref('A'), to: ref('B'), reason: 'A uses B' }]);
      const captureRef = await capture(fx, 'a02-public-capture');

      const comparison = await fx.platform.architecture.compareFormalObserved(fx.ctx, { catalog: pin, captureRef });
      expect(comparison).toMatchObject({ status: 'ready', value: { noVerdict: true, catalog: pin, captureRef } });
      if (comparison.status !== 'ready') return;
      expect(comparison.value.findings).toEqual([
        { kind: 'dependency_missing', moduleRef: ref('A'), path: 'src/a', detail: 'A→B', certainty: 'unknown' },
        { kind: 'unresolved', moduleRef: ref('A'), path: 'src/a/broken.ts', detail: 'src/nowhere.ts', certainty: 'unknown' },
        { kind: 'import_undeclared', moduleRef: ref('C'), path: 'src/c/one.ts', detail: 'src/d/one.ts', certainty: 'proven' },
        { kind: 'ambiguous', moduleRef: null, path: 'src/dup/one.ts', detail: 'src/dup 命中 P1、P2', certainty: 'unknown' },
        { kind: 'ungrouped', moduleRef: null, path: 'src/loose.ts', detail: '不在任何模块 path 下', certainty: 'unknown' },
      ]);
    } finally { await fx.close(); }
  });
});

describe.each(BACKENDS)('AE1 A-02b public cycle comparison [%s]', backend => {
  it('wires the file cycle and the undeclared reverse import, not the observed A→B', async () => {
    const projectId = 's8a-ae1-a02b';
    const ref = (moduleId: string): ModuleRef => ({ projectId, moduleId });
    const files = {
      'src/a/one.ts': 'import { lib } from "../b/lib";\nexport const one = lib;\n',
      'src/b/lib.ts': 'import { one } from "../a/one";\nexport const lib = one;\n',
    };
    const fx = await fixture(backend, projectId, files);
    try {
      const modules = [moduleDef(projectId, 'A', ['src/a']), moduleDef(projectId, 'B', ['src/b'])];
      const pin = await adopt(fx, 'a02b-baseline', modules, [{ from: ref('A'), to: ref('B'), reason: 'A uses B' }]);
      const captureRef = await capture(fx, 'a02b-public-capture');

      const comparison = await fx.platform.architecture.compareFormalObserved(fx.ctx, { catalog: pin, captureRef });
      expect(comparison).toMatchObject({ status: 'ready', value: { noVerdict: true, catalog: pin, captureRef } });
      if (comparison.status !== 'ready') return;
      expect(comparison.value.findings).toEqual([
        { kind: 'cycle', moduleRef: null, path: 'src/a/one.ts', detail: 'src/a/one.ts ⇄ src/b/lib.ts', certainty: 'proven' },
        { kind: 'import_undeclared', moduleRef: ref('B'), path: 'src/b/lib.ts', detail: 'src/a/one.ts', certainty: 'proven' },
      ]);
    } finally { await fx.close(); }
  });
});
