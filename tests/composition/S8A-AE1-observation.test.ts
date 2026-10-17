/**
 * Slice 8A acceptance entry AE1 (spec §5.1 line 366; §5.2 A-01 line 377):
 * the PUBLIC `platform.architecture` capture/query path over a real temporary
 * workspace. Only the trusted Project/Workspace bootstrap is created through
 * the public Project writers; the catalog and every observation are produced
 * by the public composition. No database read verifies an assertion.
 *
 * Expected values are literal and hand-computed from the fixture contents.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { ObservedCaptureRef } from '../../src/contracts/architecture-inspection.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const at = '2026-10-17T00:00:00.000Z';
const actor = { kind: 'human' as const, id: 's8a-ae1-observation-operator' };
const mappings = [{ id: 'SRC', kind: 'module' as const, paths: ['src'] }];
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
type Fixture = {
  platform: Platform;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  close(): Promise<void>;
};

/** Both storage backends the book requires; the same fixture and literals run on each. */
const BACKENDS = ['memory', 'sqlite'] as const;
type Backend = (typeof BACKENDS)[number];

async function fixture(backend: Backend, projectId: string, files: Record<string, string>,
  options: { fileGraph?: { maxNodes: number; maxEdges: number } } = {}): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 's8a-ae1-observation-'));
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
        ? { status: 'ready', value: { subjectKey: 's8a-ae1-observer',
            permissionRevision: 's8a-ae1-observation-v1',
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
    ...(options.fileGraph === undefined ? {} : { fileGraph: options.fileGraph }),
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

async function adoptRootCatalog(fx: Fixture): Promise<ArchitectureCatalogPinV1> {
  const adopted = await fx.platform.architecture.adoptInitialArchitecture(fx.ctx, {
    meta: { requestId: fx.scope.projectId + '-adopt', expected: [
      { ref: { aggregateType: 'Project', projectId: fx.scope.projectId }, revision: 1 },
      { ref: { aggregateType: 'Workspace', ...fx.scope }, revision: 1 },
    ] },
    input: { baselineId: fx.scope.projectId + '-baseline', description: 'A root module plus src/a',
      constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: [
        { ref: { projectId: fx.scope.projectId, moduleId: 'root' }, name: 'root',
          responsibility: 'Everything not claimed by a deeper module', paths: ['.'], interfaces: [] },
        { ref: { projectId: fx.scope.projectId, moduleId: 'a' }, name: 'a',
          responsibility: 'The src/a subtree', paths: ['src/a'], interfaces: [] },
      ] } },
  });
  expect(adopted).toMatchObject({ status: 'committed' });
  if (adopted.status !== 'committed') throw Error('public adoption failed');
  const read = await fx.platform.architecture.readArchitectureRevision(fx.ctx, { selection: { kind: 'current' } });
  expect(read).toMatchObject({ status: 'ready' });
  if (read.status !== 'ready' || read.value.catalog === null) throw Error('public catalog read failed');
  return { catalogRef: read.value.catalog.ref,
    baseline: { ref: read.value.baseline.ref, digest: read.value.baseline.contentDigest } };
}

/** src/a.ts, src/b.ts, src/c.ts, src/d.ts plus src/f001.ts .. src/f201.ts = 205 files. */
function a01Files(): Record<string, string> {
  const files: Record<string, string> = {
    'src/a.ts': 'import { b } from "./b";\n\nexport const a = b;\n',
    'src/b.ts': 'export const b = 1;\n',
    'src/c.ts': 'import { d } from "./d";\n',
    'src/d.ts': 'export const d = 1;\n',
  };
  for (let index = 1; index <= 201; index += 1) {
    const id = String(index).padStart(3, '0');
    files[`src/f${id}.ts`] = `export const f${id} = 1;\n`;
  }
  return files;
}

/** Hand-computed literal node list, already in workspace-relative sort order. */
function a01ExpectedNodes(): { path: string; nonBlankLines: number; language: string }[] {
  return [
    { path: 'src/a.ts', nonBlankLines: 2, language: 'typescript' },
    { path: 'src/b.ts', nonBlankLines: 1, language: 'typescript' },
    { path: 'src/c.ts', nonBlankLines: 1, language: 'typescript' },
    { path: 'src/d.ts', nonBlankLines: 1, language: 'typescript' },
    ...Array.from({ length: 201 }, (_unused, index) =>
      ({ path: `src/f${String(index + 1).padStart(3, '0')}.ts`, nonBlankLines: 1, language: 'typescript' })),
  ];
}

const A01_EDGES = [
  { from: 'src/a.ts', to: 'src/b.ts' },
  { from: 'src/c.ts', to: 'src/d.ts' },
];

describe.each(BACKENDS)('AE1 A-01 public observation over 205 real TS files [%s]', backend => {
  it('captures 205 literal file nodes, exactly two import edges, 200+5 pages, neighbours and impact', async () => {
    const fx = await fixture(backend, 's8a-ae1-a01', a01Files());
    try {
      const captureRef = await capture(fx, 'a01-public-capture');

      const first = await fx.platform.architecture.listFiles(fx.ctx, { captureRef, cursor: null });
      expect(first).toMatchObject({ status: 'ready' });
      if (first.status !== 'ready') return;
      expect(first.value.nodes).toHaveLength(200);
      expect(first.value.nextCursor).not.toBeNull();
      expect(first.value.complete).toBe(false);
      expect(first.value.edges).toEqual(A01_EDGES);

      expect(first.value.nextCursor).not.toBeNull();
      const second = await fx.platform.architecture.listFiles(fx.ctx,
        { captureRef, cursor: first.value.nextCursor });
      expect(second).toMatchObject({ status: 'ready' });
      if (second.status !== 'ready') return;
      expect(second.value.nodes).toHaveLength(5);
      expect(second.value.nextCursor).toBeNull();
      expect(second.value.complete).toBe(true);
      expect(second.value.edges).toEqual([]);

      const allNodes = [...first.value.nodes, ...second.value.nodes];
      expect(allNodes).toHaveLength(205);
      expect(allNodes).toEqual(a01ExpectedNodes());

      const outA = await fx.platform.architecture.neighbors(fx.ctx,
        { captureRef, file: 'src/a.ts', direction: 'out', limit: 200, cursor: null });
      expect(outA).toMatchObject({ status: 'ready' });
      if (outA.status === 'ready') {
        expect(outA.value.nodes.map(node => node.path)).toEqual(['src/b.ts']);
        expect(outA.value.edges).toEqual([]);
      }
      const outC = await fx.platform.architecture.neighbors(fx.ctx,
        { captureRef, file: 'src/c.ts', direction: 'out', limit: 200, cursor: null });
      expect(outC).toMatchObject({ status: 'ready' });
      if (outC.status === 'ready') expect(outC.value.nodes.map(node => node.path)).toEqual(['src/d.ts']);
      for (const path of ['src/d.ts', 'src/f001.ts', 'src/f201.ts']) {
        const none = await fx.platform.architecture.neighbors(fx.ctx,
          { captureRef, file: path, direction: 'out', limit: 200, cursor: null });
        expect(none).toMatchObject({ status: 'ready' });
        if (none.status === 'ready') expect(none.value.nodes).toEqual([]);
      }

      const impactB = await fx.platform.architecture.impact(fx.ctx,
        { captureRef, file: 'src/b.ts', depth: 1, limit: 200, cursor: null });
      expect(impactB).toMatchObject({ status: 'ready' });
      if (impactB.status === 'ready') expect(impactB.value.nodes.map(node => node.path)).toEqual(['src/a.ts']);
      const impactD = await fx.platform.architecture.impact(fx.ctx,
        { captureRef, file: 'src/d.ts', depth: 3, limit: 200, cursor: null });
      expect(impactD).toMatchObject({ status: 'ready' });
      if (impactD.status === 'ready') expect(impactD.value.nodes.map(node => node.path)).toEqual(['src/c.ts']);

      // A cursor is bound to (captureRef, query): the same string against a
      // different capture is `invalid`/`cursor_mismatch`.
      const otherRef = await capture(fx, 'a01-public-capture-other');
      expect(await fx.platform.architecture.listFiles(fx.ctx,
        { captureRef: otherRef, cursor: first.value.nextCursor }))
        .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });
    } finally { await fx.close(); }
  });

  it('rejects the capture with capacity when the injected file cap is 2 over more real files', async () => {
    const fx = await fixture(backend, 's8a-ae1-a01-capacity', {
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 1;\n',
      'src/c.ts': 'export const c = 1;\n',
    }, { fileGraph: { maxNodes: 2, maxEdges: 100000 } });
    try {
      const captured = await fx.platform.architecture.captureSourceChanges(fx.ctx, {
        input: { workspace: fx.scope, mappings, previous: null },
        meta: { requestId: 'a01-platform-capacity', expected: [] },
      });
      expect(captured).toMatchObject({ status: 'rejected', code: 'capacity' });
      if (captured.status === 'rejected') expect(captured.reason).toMatch(/\b2\b/);
    } finally { await fx.close(); }
  });
});

describe.each(BACKENDS)('AE1 A-05 root module `.` ownership through the public comparison [%s]', backend => {
  it('assigns src/a/one.ts to src/a, src/b/two.ts and src/loose.ts to the root, and reports no ungrouped finding', async () => {
    const projectId = 's8a-ae1-a05';
    const files = {
      'src/a/one.ts': 'import { two } from "../b/two";\nexport const one = two;\n',
      'src/b/two.ts': 'export const two = 1;\n',
      'src/loose.ts': 'export const loose = 1;\n',
    };
    const fx = await fixture(backend, projectId, files);
    try {
      const pin = await adoptRootCatalog(fx);
      const captureRef = await capture(fx, 'a05-public-capture');

      const nodes = await fx.platform.architecture.listFiles(fx.ctx, { captureRef, cursor: null });
      expect(nodes).toMatchObject({ status: 'ready' });
      if (nodes.status === 'ready') {
        expect(nodes.value.nodes).toEqual([
          { path: 'src/a/one.ts', nonBlankLines: 2, language: 'typescript' },
          { path: 'src/b/two.ts', nonBlankLines: 1, language: 'typescript' },
          { path: 'src/loose.ts', nonBlankLines: 1, language: 'typescript' },
        ]);
      }

      const comparison = await fx.platform.architecture.compareFormalObserved(fx.ctx, { catalog: pin, captureRef });
      expect(comparison).toMatchObject({ status: 'ready', value: { noVerdict: true } });
      if (comparison.status !== 'ready') return;
      // `src/a/one.ts` imports `src/b/two.ts`; the importer's owner is `src/a`
      // because the concrete prefix beats the `.` root. If ownership were the
      // root the moduleRef would be `root`. A tie or no-owner would instead be
      // an `ambiguous`/`ungrouped` finding, so both root-owned files absent
      // from the findings also prove the `.` module covers them.
      expect(comparison.value.findings).toEqual([
        { kind: 'import_undeclared', moduleRef: { projectId, moduleId: 'a' },
          path: 'src/a/one.ts', detail: 'src/b/two.ts', certainty: 'proven' },
      ]);
      expect(comparison.value.findings.some(finding => finding.kind === 'ungrouped')).toBe(false);
    } finally { await fx.close(); }
  });
});
