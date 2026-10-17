import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArchitectureSourceMapping } from '../../src/contracts/architecture-source.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createWorkspaceAccessFactory, type WorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import type { WorkspaceResult } from '../../src/core/workspace/ports.js';
import { TypeScriptSourceAnalyzer } from '../../src/core/workspace/typescript-source-query.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function ready<T>(result: WorkspaceResult<T>): T {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error(`${result.code}: ${result.reason}`);
  return result.value;
}

it('maps the entire graph, including cycles and unresolved imports, with only two source observations and one import analysis', async () => {
  const root = await mkdtemp(join(tmpdir(), 'capture-architecture-compatibility-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  const files = new Map([
    ['tsconfig.json', JSON.stringify({
      compilerOptions: { module: 'esnext', moduleResolution: 'bundler', noLib: true },
      include: ['src/**/*.ts'],
    })],
    ['src/alpha.ts', 'import { beta } from "./beta";\nimport { absent } from "./missing";\nexport function alpha() { return beta() + absent; }\n'],
    ['src/beta.ts', 'import { alpha } from "./alpha";\nexport function beta() { return alpha(); }\n'],
    ['src/unmapped.ts', 'export const unrelated = 1;\n'],
  ]);
  await Promise.all([...files].map(([path, content]) => writeFile(join(root, path), content)));
  const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'graph-compatibility', workspaceId: 'main' };
  const scope = { projectId: workspace.projectId, workspaceId: workspace.workspaceId, workspaceRevision: 3 };
  const mappings: ArchitectureSourceMapping[] = [
    { id: 'Alpha', kind: 'module', paths: ['src/alpha.ts'] },
    { id: 'Beta', kind: 'module', paths: ['src/beta.ts'] },
  ];

  const actor = { kind: 'human' as const, id: 'explicit-graph-test-reader' };
  const context: CoreCallContext = {
    projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor },
    signal: new AbortController().signal,
  };
  // A narrowly granted, trusted test adapter. This does not claim that a production
  // host principal receives permission just because its kind is "host".
  const realAccess = createWorkspaceAccessFactory({
    resolveRoot: async requested => requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
      ? { status: 'ready', value: { root, workspaceRevision: scope.workspaceRevision } }
      : { status: 'rejected', code: 'not_found', reason: 'Unknown test workspace' },
    authorize: async (ctx, requested) => {
      if (requested.projectId !== workspace.projectId || requested.workspaceId !== workspace.workspaceId ||
          ctx.projectId !== workspace.projectId || ctx.workspaceId !== workspace.workspaceId ||
          ctx.principal.kind !== 'host' || ctx.principal.actor.kind !== actor.kind || ctx.principal.actor.id !== actor.id ||
          ctx.materialReader.kind !== 'host' || ctx.materialReader.projectId !== workspace.projectId ||
          ctx.materialReader.workspaceId !== workspace.workspaceId || ctx.materialReader.actor.kind !== actor.kind || ctx.materialReader.actor.id !== actor.id) {
        return { status: 'rejected', code: 'forbidden', reason: 'No matching explicit test grant' };
      }
      return { status: 'ready', value: {
        subjectKey: canonicalJson(['host', actor]), permissionRevision: 'graph-test-read-policy-v1',
        allowsRead: path => files.has(path),
      } };
    },
  });
  const count = { opens: 0, inventories: 0, identities: 0, bytes: 0, releases: 0 };
  const reads = new Map<string, number>();
  // Observe public access operations while delegating all real reads/path handling to
  // the Kernel sandbox. Fresh authorization and release are not counted as source scans.
  const measuredAccess: WorkspaceAccessFactory = {
    async open(ctx, requested) {
      const result = await realAccess.open(ctx, requested);
      if (result.status !== 'ready') return result;
      count.opens++;
      const access = result.value;
      return { status: 'ready', value: {
        ...access,
        async listFiles(limit) { count.inventories++; return access.listFiles(limit); },
        async sourceIdentity() { count.identities++; return access.sourceIdentity(); },
        async read(path, maxBytes) {
          reads.set(path, (reads.get(path) ?? 0) + 1);
          const read = await access.read(path, maxBytes);
          count.bytes += Buffer.byteLength(read.content);
          return read;
        },
        async release() { count.releases++; await access.release(); },
      } };
    },
  };
  const handle = createWorkspaceTools({
    access: measuredAccess, now: () => '2026-09-23T00:00:00.000Z', limits: DEFAULT_WORKSPACE_LIMITS,
  });
  cleanups.push(() => handle.close());
  const analyses = vi.spyOn(TypeScriptSourceAnalyzer.prototype, 'analyze');
  // The platform chain WG10 uses: one TS capture, the mapping over it, then release.
  const captured = ready(await handle.tools.captureSourceChanges(context, {
    workspace, workspaceRevision: scope.workspaceRevision, provider: 'typescript', configPath: 'tsconfig.json',
  }));
  const graph = ready(await handle.tools.captureArchitectureSource(context, { capture: captured.ref, mappings }));
  ready(await handle.tools.releaseCapture(context, captured.ref));

  expect(graph).toMatchObject({ ...scope, configPath: 'tsconfig.json' });
  expect(graph.nodes.map(node => node.nodeId)).toEqual(['module:Alpha', 'module:Beta']);
  expect(graph.edges.map(edge => [edge.fromNode, edge.toNode])).toEqual([
    ['module:Alpha', 'module:Beta'], ['module:Beta', 'module:Alpha'],
  ]);
  expect(graph.unresolved).toEqual([
    'unmapped source: src/unmapped.ts',
    'unresolved import: src/alpha.ts:2 -> ./missing',
  ]);

  expect(count.inventories).toBe(2);
  expect(count.identities).toBe(2);
  expect([...reads].sort()).toEqual([...files.keys()].sort().map(path => [path, 2]));
  expect(count.bytes).toBe(2 * [...files.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0));
  expect(count.releases).toBe(count.opens);
  expect(analyses.mock.calls.map(([, query]) => query.operation)).toEqual(['imports']);
});

it('accepts a root `.` mapping that a concrete prefix beats, through the whole capture chain', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'capture-architecture-root-'));
  cleanups.push(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(join(rootDir, 'src', 'a'), { recursive: true });
  const files = new Map([
    ['tsconfig.json', JSON.stringify({
      compilerOptions: { module: 'esnext', moduleResolution: 'bundler', noLib: true },
      include: ['src/**/*.ts'],
    })],
    ['src/a/one.ts', 'export const one = 1;\n'],
    ['src/loose.ts', 'export const loose = 1;\n'],
  ]);
  await Promise.all([...files].map(([path, content]) => writeFile(join(rootDir, path), content)));
  const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'root-path', workspaceId: 'main' };
  const scope = { projectId: workspace.projectId, workspaceId: workspace.workspaceId, workspaceRevision: 1 };
  const actor = { kind: 'human' as const, id: 'root-path-test-reader' };
  const context: CoreCallContext = {
    projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor },
    signal: new AbortController().signal,
  };
  const access = createWorkspaceAccessFactory({
    resolveRoot: async requested => requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
      ? { status: 'ready', value: { root: rootDir, workspaceRevision: scope.workspaceRevision } }
      : { status: 'rejected', code: 'not_found', reason: 'Unknown test workspace' },
    authorize: async () => ({ status: 'ready', value: { subjectKey: 'root-path', permissionRevision: 'root-path-v1',
      allowsRead: path => files.has(path) } }),
  });
  const handle = createWorkspaceTools({ access, now: () => '2026-09-23T00:00:00.000Z', limits: DEFAULT_WORKSPACE_LIMITS });
  cleanups.push(() => handle.close());
  const captured = ready(await handle.tools.captureSourceChanges(context, {
    workspace, workspaceRevision: scope.workspaceRevision, provider: 'typescript', configPath: 'tsconfig.json',
  }));
  const mappings: ArchitectureSourceMapping[] = [
    { id: 'Root', kind: 'module', paths: ['.'] },
    { id: 'A', kind: 'module', paths: ['src/a'] },
  ];
  const graph = ready(await handle.tools.captureArchitectureSource(context, { capture: captured.ref, mappings }));
  ready(await handle.tools.releaseCapture(context, captured.ref));

  expect(graph.nodes.map(node => node.nodeId)).toEqual(['module:A', 'module:Root']);
  expect(graph.nodes.map(node => node.nodeId + '@' + node.path)).toEqual(['module:A@src/a', 'module:Root@.']);
  expect(graph.unresolved).toEqual([]);
  // The root node owns exactly the files no concrete prefix claims: src/loose.ts
  // is in and src/a/one.ts (owned by A) is out of its member digest.
  const root = graph.nodes.find(node => node.nodeId === 'module:Root')!;
  const nonA = graph.indexedSources!.filter(source => !source.path.startsWith('src/a/'));
  expect(nonA.map(source => source.path)).toContain('src/loose.ts');
  expect(nonA.map(source => source.path)).not.toContain('src/a/one.ts');
  expect(root.contentDigest).toBe(sha256Hex(canonicalJson(
    nonA.map(source => ({ path: source.path, digest: source.digest })) as unknown as JsonValue)));
});
