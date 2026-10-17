/**
 * Slice 8A root path `.` (spec L7 last bullets; lead answer 3): only MODULE
 * PREFIXES and MAPPING NODES accept `.` (match length 0, the lowest priority),
 * a concrete longer prefix always wins, and two `.` candidates tie (not an
 * owner). FILE and CONFIGURATION path checks stay strict. Every module-prefix
 * matcher goes through the one pure longest-prefix owner.
 */
import { describe, expect, it } from 'vitest';
import type { ArchitectureSourceMapping } from '../../src/contracts/architecture-source.js';
import { architectureSourceIssues } from '../../src/contracts/architecture-source.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { mapArchitectureSource, type ArchitectureSourceMaterial } from '../../src/core/workspace/architecture-source.js';
import { buildObservedNeighborhood } from '../../src/core/work-graph/architecture/graph-index.js';
import type { ObservedArchitectureSelection } from '../../src/core/work-graph/architecture/contracts.js';
import { createObservedArchitecture } from '../../src/core/work-graph/architecture/architecture-service.js';
import { capture, context, fixture, workspace } from './R3d-fixture.js';

const hex = (c: string): string => c.repeat(64);

// --------------------------------------------------------------------------
// The contract validator: mapping/node paths accept `.`; file/config stay strict
// --------------------------------------------------------------------------

function sourceSnapshot(overrides: Record<string, unknown>): unknown {
  return {
    schemaVersion: 1, projectId: 'p', workspaceId: 'w', workspaceRevision: 1,
    sourceDigest: hex('a'), commitHash: null, indexVersion: 'typescript@1',
    configPath: null,
    mappings: [{ id: 'Root', kind: 'module', paths: ['.'] }],
    indexedSources: [{ path: 'src/loose.ts', digest: hex('b') }],
    nodes: [], edges: [], unresolved: [],
    ...overrides,
  };
}

describe('S8A-01 `.` in the architecture-source contract', () => {
  it('S8A-01a accepts a mapping path `.`, but rejects a `.` configuration or file path', () => {
    expect(architectureSourceIssues(sourceSnapshot({}))).toEqual([]);
    expect(architectureSourceIssues(sourceSnapshot({ configPath: '.' })))
      .toEqual(['invalid configuration path']);
    expect(architectureSourceIssues(sourceSnapshot({ indexedSources: [{ path: '.', digest: hex('b') }] })))
      .toEqual(['invalid indexed sources']);
  });
});

// --------------------------------------------------------------------------
// mapArchitectureSource: one ownership decision per file, longest prefix wins
// --------------------------------------------------------------------------

const MATERIAL_SOURCES = [
  { path: 'src/a/one.ts', digest: hex('1') },
  { path: 'src/b/two.ts', digest: hex('2') },
  { path: 'src/loose.ts', digest: hex('3') },
];

function material(overrides: Partial<ArchitectureSourceMaterial> = {}): ArchitectureSourceMaterial {
  return {
    sources: MATERIAL_SOURCES, imports: [], manifestDigest: hex('f'), commit: null,
    engine: 'typescript', engineVersion: '1', configPath: 'tsconfig.json',
    ...overrides,
  };
}

const SCOPE = { projectId: 'p', workspaceId: 'w', workspaceRevision: 1 };
const digestOf = (members: { path: string; digest: string }[]): string =>
  sha256Hex(canonicalJson(members as unknown as JsonValue));

describe('S8A-02 mapArchitectureSource root ownership', () => {
  it('S8A-02a the longest prefix owns the file; `.` owns only what no concrete prefix claims', () => {
    const mappings: ArchitectureSourceMapping[] = [
      { id: 'Root', kind: 'module', paths: ['.'] },
      { id: 'A', kind: 'module', paths: ['src/a'] },
    ];
    const graph = mapArchitectureSource(material(), SCOPE, mappings);
    expect(graph.nodes.map(node => node.nodeId)).toEqual(['module:A', 'module:Root']);
    expect(graph.nodes.map(node => node.path)).toEqual(['src/a', '.']);
    const root = graph.nodes.find(node => node.nodeId === 'module:Root')!;
    const a = graph.nodes.find(node => node.nodeId === 'module:A')!;
    expect(a.contentDigest).toBe(digestOf([{ path: 'src/a/one.ts', digest: hex('1') }]));
    // `.` does NOT claim the file under src/a; it claims only the two fallbacks.
    expect(root.contentDigest).toBe(digestOf([
      { path: 'src/b/two.ts', digest: hex('2') },
      { path: 'src/loose.ts', digest: hex('3') },
    ]));
    expect(graph.unresolved).toEqual([]);
  });

  it('S8A-02b two modules both on `.` tie and own nothing; the file is unresolved', () => {
    const mappings: ArchitectureSourceMapping[] = [
      { id: 'R1', kind: 'module', paths: ['.'] },
      { id: 'R2', kind: 'module', paths: ['.'] },
    ];
    const graph = mapArchitectureSource(material(), SCOPE, mappings);
    expect(graph.nodes).toEqual([]);
    expect(graph.unresolved).toEqual([
      'mapping has no indexed TS/JS source: module:R1',
      'mapping has no indexed TS/JS source: module:R2',
      'unmapped source: src/a/one.ts',
      'unmapped source: src/b/two.ts',
      'unmapped source: src/loose.ts',
    ]);
  });
});

// --------------------------------------------------------------------------
// graph-index file anchors go through the same ownership decision
// --------------------------------------------------------------------------

const selection = { kind: 'observed' as const, capture: {
  capture: { projectId: 'p', workspaceId: 'w', captureId: 'c', workspaceRevision: 1,
    sourceDigest: hex('a'), configDigest: hex('b'), indexVersion: 'typescript@1' },
  material: { kind: 'artifact' as const, contentType: 'application/json', digest: hex('c'), sizeBytes: 1,
    source: { kind: 'workspace' as const, refId: 'w', revision: '1' } },
} } satisfies ObservedArchitectureSelection;

describe('S8A-04 graph-index resolves a file anchor through `.`', () => {
  it('S8A-04a a `.` mapping resolves src/loose.ts to the root module node', () => {
    const graph = mapArchitectureSource(
      material({ sources: [{ path: 'src/loose.ts', digest: hex('3') }] }), SCOPE,
      [{ id: 'Root', kind: 'module', paths: ['.'] }]);
    const page = buildObservedNeighborhood(graph, selection, {
      anchor: { kind: 'file', workspace: { projectId: 'p', workspaceId: 'w' }, path: 'src/loose.ts' },
      depth: 0, relations: ['dependency'], page: { limit: 10 }, sourceCursor: 'c1' as CommitCursor,
    });
    expect(page.nodes.map(node => node.nodeId)).toEqual(['module:Root']);
  });
});

// --------------------------------------------------------------------------
// A persisted body with a `.` mapping decodes and reads back (R3d style)
// --------------------------------------------------------------------------

describe('S8A-05 persisted `.` mapping round-trips', () => {
  it.each(['memory', 'sqlite'] as const)('S8A-05 %s: capture then decode a `.` mapping body', async kind => {
    const fx = await fixture(kind);
    try {
      const request = capture('s8a-root-path');
      const captured = await createObservedArchitecture(fx.deps()).captureSourceChanges(context, {
        ...request,
        input: { ...request.input, mappings: [{ id: 'Root', kind: 'module', paths: ['.'] }] },
      });
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      await fx.reopen();
      const page = await createObservedArchitecture(fx.deps()).queryArchitecture(context, {
        selection: { kind: 'observed', capture: captured.value },
        depth: 0, relations: ['dependency'], page: { limit: 20 },
      });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.nodes.map(node => node.nodeId)).toEqual(['module:Root']);
      expect(page.value.nodes.map(node => node.path)).toEqual(['.']);
    } finally { await fx.close(); }
  });
});

// --------------------------------------------------------------------------
// S8A-04b ownership is decided over ALL mappings, then node-less winners drop
// --------------------------------------------------------------------------

describe('S8A-04b graph-index decides ownership before dropping node-less mappings', () => {
  it('S8A-04b a tied longer prefix that owns no node does not fall back to a shorter owner', () => {
    const graph = mapArchitectureSource(
      material({ sources: [{ path: 'src/a/a.ts', digest: hex('1') }, { path: 'src/b/x.ts', digest: hex('2') }] }),
      SCOPE,
      [{ id: 'A', kind: 'module', paths: ['src'] }, { id: 'B', kind: 'module', paths: ['src/b'] },
        { id: 'C', kind: 'module', paths: ['src/b'] }]);
    expect(graph.nodes.map(n => n.nodeId)).toEqual(['module:A']);
    const page = buildObservedNeighborhood(graph, selection, {
      anchor: { kind: 'file', workspace: { projectId: 'p', workspaceId: 'w' }, path: 'src/b/x.ts' },
      depth: 0, relations: ['dependency'], page: { limit: 10 }, sourceCursor: 'c1' as CommitCursor,
    });
    expect(page.nodes).toEqual([]);
  });
});
