/**
 * Slice 8 §10 item 6 (file-layer v2 chunks) and §11.2 (compact module snapshot):
 * the PURE v2 codecs and chunk writer. No workspace, store or platform is built;
 * every input is a hand-written literal and every expected value is hand-computed.
 *
 * The seams are the exported pure functions:
 * - `normalizeFileGraph` / `serializeFileGraphChunks` (architecture-service)
 * - `mapArchitectureSource` (workspace architecture source mapper, observation mode)
 * - `decodeObservedFileGraphChunk`, `mergeObservedFileGraphChunks`,
 *   `decodeObservedArchitectureRecord`, `decodeObservedArchitectureBody`
 *   (architecture-record-codecs)
 */
import { describe, expect, it } from 'vitest';
import type { FileGraphNodeV1 } from '../../src/contracts/architecture-inspection.js';
import {
  decodeObservedArchitectureBody, decodeObservedArchitectureRecord, decodeObservedFileGraphChunk,
  mergeObservedFileGraphChunks, validateObservedFileGraphChunkV2,
} from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import {
  normalizeFileGraph, serializeFileGraphChunks,
} from '../../src/core/work-graph/architecture/architecture-service.js';
import {
  mapArchitectureSource, type ArchitectureSourceMaterial,
} from '../../src/core/workspace/architecture-source.js';
import type { ObservedFileGraphManifestV2 } from '../../src/core/work-graph/architecture/contracts.js';

type ChunkGraph = {
  nodes: FileGraphNodeV1[];
  edges: { from: string; to: string }[];
  unresolved: { from: string; specifier: string; reason: string | null }[];
};

const digest = (char: string): string => char.repeat(64);

const node = (path: string, char: string, overrides: Partial<FileGraphNodeV1> = {}): FileGraphNodeV1 => ({
  path, digest: digest(char), byteSize: 1, language: 'typescript', nonBlankLines: 1, indexed: true, ...overrides,
});

/** Cap selected by hand: one full v2 node (~160 bytes + ~60 bytes of array frame)
 * fits in one body, two do not; edge pairs share a chunk. */
const CAP = 240;

const graph: ChunkGraph = {
  // Deliberately unsorted: the writer must sort the whole node table by path.
  nodes: [node('b.ts', 'b'), node('c.ts', 'c'), node('a.ts', 'a')],
  // c->a crosses the first/last node chunk; the expected global indices are
  // a.ts=0, b.ts=1, c.ts=2, so c->a is [2,0], never a local [2,0] coincidence.
  edges: [{ from: 'c.ts', to: 'a.ts' }, { from: 'a.ts', to: 'b.ts' }],
  unresolved: [],
};

describe('S8D observed v2 chunks', () => {
  it('writes v2 chunks over the global path-sorted node table and round-trips across chunks', () => {
    const bodies = serializeFileGraphChunks(normalizeFileGraph(graph), CAP);
    expect(bodies.length).toBeGreaterThanOrEqual(4); // three node chunks plus at least one edge chunk
    for (const body of bodies) expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(CAP);

    const chunks = bodies.map(body => decodeObservedFileGraphChunk(body, graph.nodes.length));
    for (const chunk of chunks) {
      expect(chunk.status).toBe('decoded');
      if (chunk.status !== 'decoded') return;
      expect(chunk.value.schemaVersion).toBe(2);
    }
    const decoded = chunks.flatMap(chunk => chunk.status === 'decoded' ? [chunk.value] : []);
    const nodes = decoded.flatMap(chunk => chunk.nodes);
    expect(nodes.map(entry => entry.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(nodes.map(entry => [entry.digest, entry.byteSize, entry.language, entry.nonBlankLines, entry.indexed]))
      .toEqual([
        [digest('a'), 1, 'typescript', 1, true],
        [digest('b'), 1, 'typescript', 1, true],
        [digest('c'), 1, 'typescript', 1, true],
      ]);
    // The store maps edges to indices in the CAPTURE's order (it does not sort
    // or dedupe them): c->a is first, then a->b.
    const pairs = decoded.flatMap(chunk => chunk.schemaVersion === 2 ? chunk.edges : []);
    expect(pairs).toEqual([[2, 0], [0, 1]]);
    const paths = nodes.map(entry => entry.path);
    expect(pairs.map(([from, to]) => [paths[from], paths[to]])).toEqual([['c.ts', 'a.ts'], ['a.ts', 'b.ts']]);
  });

  it('writes exactly one empty v2 chunk for an empty graph', () => {
    const bodies = serializeFileGraphChunks(normalizeFileGraph({ nodes: [], edges: [], unresolved: [] }), CAP);
    expect(bodies).toHaveLength(1);
    const decoded = decodeObservedFileGraphChunk(bodies[0]!, 0);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toEqual({ schemaVersion: 2, nodes: [], edges: [], unresolved: [] });
    expect(bodies[0]).toContain('"schemaVersion":2');
  });

  it('refuses an item that starts a later chunk but cannot fit its envelope alone', () => {
    // The first node fits CAP; the 4096-character path node is ~4.3 KB with its
    // envelope, so it cannot start a chunk either and the writer must say capacity.
    const huge = node('b.ts', 'b', { path: 'x'.repeat(4096) });
    expect(() => serializeFileGraphChunks(
      normalizeFileGraph({ nodes: [node('a.ts', 'a'), huge], edges: [], unresolved: [] }), CAP))
      .toThrow(/chunk capacity/);
  });
});

describe('S8D observed v2 chunk validation', () => {
  const literalNode = (path: string, char = 'a') => ({
    path, digest: digest(char), byteSize: 1, language: 'typescript', nonBlankLines: 1, indexed: true,
  });
  const chunkJson = (nodes: unknown[], edges: unknown[]): string =>
    JSON.stringify({ schemaVersion: 2, nodes, edges, unresolved: [] });

  it('rejects an out-of-range edge index, a malformed pair and a bad node digest', () => {
    const nodes = [literalNode('a.ts')];
    // The manifest node count is 1, so [0,1] points outside the global table.
    expect(decodeObservedFileGraphChunk(chunkJson(nodes, [[0, 1]]), 1).status).toBe('invalid');
    expect(decodeObservedFileGraphChunk(chunkJson(nodes, [[0]]), 1).status).toBe('invalid');
    expect(decodeObservedFileGraphChunk(chunkJson(nodes, [[0, 1.5]]), 2).status).toBe('invalid');
    expect(decodeObservedFileGraphChunk(chunkJson(nodes, [[-1, 0]]), 1).status).toBe('invalid');
    // Without the manifest count the same pair is structurally legal; the
    // loader-level merge rejects it against the node table.
    expect(decodeObservedFileGraphChunk(chunkJson(nodes, [[0, 1]])).status).toBe('decoded');
    const badDigest = JSON.stringify({
      schemaVersion: 2, edges: [], unresolved: [],
      nodes: [{ ...literalNode('a.ts'), digest: 'not-a-digest' }],
    });
    expect(decodeObservedFileGraphChunk(badDigest, 1).status).toBe('invalid');
  });

  it('accepts the real empty specifier and enforces the one 4096-character limit', () => {
    const parsedWith = (specifier: string) => ({
      schemaVersion: 2, nodes: [], edges: [], unresolved: [{ from: 'a.ts', specifier, reason: null }],
    });
    // `import "";` is real syntax, so the empty specifier is legal on both sides.
    expect(validateObservedFileGraphChunkV2(parsedWith('')).status).toBe('decoded');
    // The writer and the decoder share this validator, so there is ONE limit.
    expect(validateObservedFileGraphChunkV2(parsedWith('x'.repeat(4096))).status).toBe('decoded');
    expect(validateObservedFileGraphChunkV2(parsedWith('x'.repeat(4097))).status).toBe('invalid');
    expect(decodeObservedFileGraphChunk(JSON.stringify(parsedWith('x'.repeat(4096)))).status).toBe('decoded');
    expect(decodeObservedFileGraphChunk(JSON.stringify(parsedWith('x'.repeat(4097)))).status).toBe('invalid');
  });

  it('rejects a duplicate node in one chunk and across chunks', () => {
    const nodes = [literalNode('a.ts'), literalNode('a.ts', 'b')];
    expect(decodeObservedFileGraphChunk(chunkJson(nodes, []), 2).status).toBe('invalid');
    const first = decodeObservedFileGraphChunk(chunkJson([literalNode('a.ts')], []), 2);
    const second = decodeObservedFileGraphChunk(chunkJson([literalNode('a.ts')], []), 2);
    expect(first.status).toBe('decoded');
    expect(second.status).toBe('decoded');
    if (first.status !== 'decoded' || second.status !== 'decoded') return;
    const manifest: ObservedFileGraphManifestV2 = {
      schemaVersion: 2, chunks: [], nodeCount: 2, edgeCount: 0, unresolvedCount: 0,
    };
    const merged = mergeObservedFileGraphChunks(manifest, [first.value, second.value]);
    expect(merged.status).toBe('invalid');
    if (merged.status !== 'invalid') return;
    expect(merged.reason).toContain('duplicate');
  });

  it('rejects chunk totals that disagree with the manifest (wrong count)', () => {
    const decoded = decodeObservedFileGraphChunk(chunkJson([literalNode('a.ts')], []), 2);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    const manifest: ObservedFileGraphManifestV2 = {
      schemaVersion: 2, chunks: [], nodeCount: 2, edgeCount: 0, unresolvedCount: 0,
    };
    expect(mergeObservedFileGraphChunks(manifest, [decoded.value]).status).toBe('invalid');
    const correct: ObservedFileGraphManifestV2 = { ...manifest, nodeCount: 1 };
    const merged = mergeObservedFileGraphChunks(correct, [decoded.value]);
    expect(merged.status).toBe('decoded');
    if (merged.status !== 'decoded') return;
    expect(merged.value.nodes.map(entry => entry.path)).toEqual(['a.ts']);
    // An index pair that decodes without a manifest count is rejected by the merge.
    const edges = decodeObservedFileGraphChunk(chunkJson([literalNode('a.ts')], [[0, 1]]));
    expect(edges.status).toBe('decoded');
    if (edges.status !== 'decoded') return;
    expect(mergeObservedFileGraphChunks(correct, [edges.value]).status).toBe('invalid');
    // The unresolved count is part of the exact manifest check too.
    const unresolvedManifest: ObservedFileGraphManifestV2 = { ...correct, unresolvedCount: 1 };
    expect(mergeObservedFileGraphChunks(unresolvedManifest, [decoded.value]).status).toBe('invalid');
  });
});

describe('S8D observed v2 unresolved pass-through', () => {
  it('stores the capture-normalized unresolved list unchanged (no dedupe or re-sort in the store)', () => {
    // The capture (`captureFileGraph`) already deduped by (from,specifier),
    // picked the first non-null reason and sorted; the store must not repeat it.
    const unresolved = [
      { from: 'a.ts', specifier: './x', reason: 'aaa' },
      { from: 'a.ts', specifier: './y', reason: null },
      { from: 'b.ts', specifier: './z', reason: null },
    ];
    const bodies = serializeFileGraphChunks(normalizeFileGraph({
      nodes: [node('a.ts', 'a'), node('b.ts', 'b')],
      edges: [],
      unresolved,
    }), CAP);
    const decoded = bodies.map(body => decodeObservedFileGraphChunk(body, 2))
      .flatMap(chunk => chunk.status === 'decoded' && chunk.value.schemaVersion === 2 ? chunk.value.unresolved : []);
    expect(decoded).toEqual(unresolved);
  });
});

describe('S8D compact module snapshot (§11.2)', () => {
  const scope = { projectId: 'p', workspaceId: 'w', workspaceRevision: 1 };
  // Every source is unmapped, so the mapper emits one `unmapped source: <path>`
  // line per source; that is the only unresolved wording this test needs.
  const materialWith = (paths: string[]): ArchitectureSourceMaterial => ({
    sources: paths.map(path => ({ path, digest: digest('a') })),
    imports: [], manifestDigest: digest('d'), commit: null,
    engine: 'typescript', engineVersion: '6.0.3', configPath: null,
  });
  const linesOf = (paths: string[]): string[] => paths.map(path => 'unmapped source: ' + path);

  it('drops indexedSources and keeps everything under 500 lines / 64 KiB', () => {
    const paths = ['a.ts', 'b.ts'];
    const compact = mapArchitectureSource(materialWith(paths), scope, [], 'observation');
    expect('indexedSources' in compact).toBe(false);
    expect(compact.unresolved).toEqual(linesOf(paths));
  });

  it('cuts at 500 lines and appends exactly one line with the removed count', () => {
    const paths = Array.from({ length: 502 }, (_, index) => `line${String(index).padStart(3, '0')}.ts`);
    const lines = linesOf(paths);
    const compact = mapArchitectureSource(materialWith(paths), scope, [], 'observation');
    expect(compact.unresolved).toHaveLength(501);
    expect(compact.unresolved.slice(0, 500)).toEqual(lines.slice(0, 500));
    expect(compact.unresolved[500]).toBe('另有 2 条没列出，逐条见文件层');
  });

  it('cuts at 64 KiB of the kept lines joined by a newline and reports the exact remainder', () => {
    // 400 unique 200-character lines: k kept lines joined by '\n' are 201*k - 1
    // bytes, so k = 326 is 65,525 bytes (the largest k <= 65,536) and 74 are removed.
    // `unmapped source: ` is 17 characters, so each path is 183 characters.
    const paths = Array.from({ length: 400 }, (_, index) => String(index).padStart(4, '0') + 'x'.repeat(179));
    const lines = linesOf(paths);
    expect(new Set(lines.map(line => line.length))).toEqual(new Set([200]));
    const compact = mapArchitectureSource(materialWith(paths), scope, [], 'observation');
    expect(compact.unresolved).toHaveLength(327); // 326 kept lines plus the one summary line
    expect(compact.unresolved.slice(0, 326)).toEqual(lines.slice(0, 326));
    expect(Buffer.byteLength(compact.unresolved.slice(0, 326).join('\n'), 'utf8')).toBe(65_525);
    expect(compact.unresolved[326]).toBe('另有 74 条没列出，逐条见文件层');
  });
});

// --------------------------------------------------------------------------
// v2 body decode uses the chunk node table
// --------------------------------------------------------------------------

import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import {
  FILE_GRAPH_CHUNK_CONTENT_TYPE, OBSERVED_ARCHITECTURE_BODY_CONTENT_TYPE,
} from '../../src/core/work-graph/architecture/architecture-record-codecs.js';

const SOURCE_DIGEST = digest('e');
const CAPTURE = {
  projectId: 'p1', workspaceId: 'w1', captureId: 'c1', workspaceRevision: 1,
  sourceDigest: SOURCE_DIGEST, configDigest: digest('d'),
  indexVersion: 'typescript-language-service@6.0.3',
};
const artifact = (char: string, contentType: string) => ({
  kind: 'artifact', contentType, digest: digest(char), sizeBytes: 10,
  source: { kind: 'workspace', refId: 'w1', revision: '1' },
});
const moduleDigest = sha256Hex(canonicalJson([{ path: 'a.ts', digest: digest('a') }] as unknown as JsonValue));
const baseArchitecture = {
  schemaVersion: 1, projectId: 'p1', workspaceId: 'w1', workspaceRevision: 1,
  sourceDigest: SOURCE_DIGEST, commitHash: null, indexVersion: CAPTURE.indexVersion,
  configPath: null, mappings: [{ id: 'm', kind: 'module', paths: ['.'] }],
  indexedSources: [{ path: 'a.ts', digest: digest('a') }],
  nodes: [{ nodeId: 'module:m', structuralKey: 'module:m', kind: 'module', name: 'm', path: '.', contentDigest: moduleDigest }],
  edges: [], unresolved: [],
};

describe('S8D v2 observation body', () => {
  const nodes: FileGraphNodeV1[] = [node('a.ts', 'a'), node('b.ts', 'b')];
  const v2MemberDigest = sha256Hex(canonicalJson(
    [{ path: 'a.ts', digest: digest('a') }, { path: 'b.ts', digest: digest('b') }] as unknown as JsonValue));
  const { indexedSources: _baseIndexedSources, ...compactArchitecture } = baseArchitecture;
  const v2Architecture = {
    ...compactArchitecture,
    nodes: [{ nodeId: 'module:m', structuralKey: 'module:m', kind: 'module', name: 'm', path: '.', contentDigest: v2MemberDigest }],
  };
  const v2Summary = {
    files: 2, languages: [{ language: 'typescript', files: 2 }],
    changes: { added: 2, modified: 0, deleted: 0 },
  };
  const v2Body = JSON.stringify({
    schemaVersion: 2, capture: CAPTURE, observedAt: '2026-10-17T00:00:00.000Z',
    summary: v2Summary, architecture: v2Architecture,
  });

  it('decodes the compact v2 body with the chunk node table and closed keys', () => {
    const decoded = decodeObservedArchitectureBody(v2Body, nodes);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value.schemaVersion).toBe(2);
    expect(decoded.value.summary).toEqual(v2Summary);
    expect('indexedSources' in decoded.value.architecture).toBe(false);
    // Without the node table a v2 body cannot recheck its members.
    expect(decodeObservedArchitectureBody(v2Body).status).toBe('invalid');
    // The block is closed: `indexedSources` must not reappear in a v2 snapshot.
    const withIndexed = JSON.stringify({
      ...JSON.parse(v2Body), architecture: { ...v2Architecture, indexedSources: [] },
    });
    expect(decodeObservedArchitectureBody(withIndexed, nodes).status).toBe('invalid');
    // A member digest that disagrees with the recorded contentDigest is rejected.
    const changed = [node('a.ts', 'c'), node('b.ts', 'b')];
    expect(decodeObservedArchitectureBody(v2Body, changed).status).toBe('invalid');
    // Safe non-negative summary counts only.
    const negative = JSON.stringify({ ...JSON.parse(v2Body), summary: { ...v2Summary, files: -1 } });
    expect(decodeObservedArchitectureBody(negative, nodes).status).toBe('invalid');
    // v2 no longer has `files` or `changes` path lists.
    const withFiles = JSON.stringify({ ...JSON.parse(v2Body), files: [] });
    expect(decodeObservedArchitectureBody(withFiles, nodes).status).toBe('invalid');
  });

  it('decodes a v2 manifest and inventory, and requires both current fields', () => {
    const base = recordBase();
    const recordV2 = {
      ...base,
      fileGraph: {
        schemaVersion: 2, chunks: [artifact('1', FILE_GRAPH_CHUNK_CONTENT_TYPE)],
        nodeCount: 1, edgeCount: 0, unresolvedCount: 0,
      },
      languages: [],
      inventory: { source: 'skip_list', reason: '不是 git 仓库' },
    };
    const encoded = {
      refKey: canonicalJson(base['ref'] as unknown as JsonValue),
      schemaId: 'ObservedArchitecture@1', revision: 1, json: JSON.stringify(recordV2),
    };
    const decoded = decodeObservedArchitectureRecord(encoded);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value.inventory).toEqual({ source: 'skip_list', reason: '不是 git 仓库' });
    const manifest = decoded.value.fileGraph;
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.unresolvedCount).toBe(0);
    // An unknown inventory source is rejected.
    const bad = JSON.parse(encoded.json) as Record<string, unknown>;
    bad['inventory'] = { source: 'git', reason: 'why' };
    expect(decodeObservedArchitectureRecord({ ...encoded, json: JSON.stringify(bad) }).status).toBe('invalid');
    // The current format requires the inventory key (an explicit null is legal,
    // its absence is not: decision 79 rejects an earlier-shape record).
    const { inventory: _inventory, ...withoutInventory } = recordV2;
    expect(decodeObservedArchitectureRecord({ ...encoded, json: JSON.stringify(withoutInventory) }).status).toBe('invalid');
  });
});

function recordBase(): Record<string, unknown> {
  return {
    ref: { aggregateType: 'ObservedArchitecture', projectId: 'p1', workspaceId: 'w1', captureId: 'c1' },
    revision: 1, schemaVersion: 1,
    source: { capture: CAPTURE, material: artifact('2', OBSERVED_ARCHITECTURE_BODY_CONTENT_TYPE) },
    observedAt: '2026-10-17T00:00:00.000Z',
  };
}
