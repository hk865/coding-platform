import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArchitectureSourceMapping } from '../../src/contracts/architecture-source.js';
import { architectureSourceDigest } from '../../src/contracts/architecture-source.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { captureArchitectureSource } from '../../src/core/workspace/architecture-source.js';
import { createWorkspaceAccessFactory, type WorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { ProjectArchitectureSourceReader, workspaceProjectIndex } from '../../src/core/workspace/source-workspace-reader.js';
import { TypeScriptSourceAnalyzer } from '../../src/core/workspace/typescript-source-query.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it('preserves the entire legacy graph, including cycles and unresolved imports, with only two source observations and one import analysis', async () => {
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

  // The real legacy adapter is the compatibility oracle; it uses the same actual files
  // and TypeScript implementation, not a hand-written imitation of the graph mapper.
  const legacyIndex = await workspaceProjectIndex(root);
  cleanups.push(async () => { legacyIndex.dispose(); });
  const legacy = await captureArchitectureSource(legacyIndex, scope, mappings, 'tsconfig.json');
  expect(legacy.nodes.map(node => node.nodeId)).toEqual(['module:Alpha', 'module:Beta']);
  expect(legacy.edges.map(edge => [edge.fromNode, edge.toNode])).toEqual([
    ['module:Alpha', 'module:Beta'], ['module:Beta', 'module:Alpha'],
  ]);
  expect(legacy.unresolved).toEqual([
    'unmapped source: src/unmapped.ts',
    'unresolved import: src/alpha.ts:2 -> ./missing',
  ]);

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
  const reader = new ProjectArchitectureSourceReader({ tools: handle.tools, context });
  const captured = await reader.capture({ ...scope, mappings, configPath: 'tsconfig.json' });

  expect(count.inventories).toBe(2);
  expect(count.identities).toBe(2);
  expect([...reads].sort()).toEqual([...files.keys()].sort().map(path => [path, 2]));
  expect(count.bytes).toBe(2 * [...files.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0));
  expect(count.releases).toBe(count.opens);
  expect(analyses.mock.calls.map(([, query]) => query.operation)).toEqual(['imports']);

  // Compare every field, then the externally consumed canonical bytes/digest. In
  // particular, added capture metadata must not enter the old node content digests.
  expect(captured).toEqual(legacy);
  expect(canonicalJson(captured)).toBe(canonicalJson(legacy));
  expect(architectureSourceDigest(captured)).toBe(architectureSourceDigest(legacy));
});
