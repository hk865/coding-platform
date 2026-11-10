/**
 * B1-01..05 of the frozen test sheet (`darr-b1-tests.frozen.md` §2.1): the observation's
 * reference counts on the module/interface layer and the file layer, one real request Host.
 *
 * Entries are public: `architecture/query` over HTTP and the published
 * `platform.architecture.listFiles` port. Literals are the sheet's hand computation:
 * the five non-self edges and counts 2/2/2/1/1. B1-04 is SQLite only because it reopens the
 * Host on the same directory.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import {
  edgesOf, nodesOf, openS8B1CountWorld, readS8B1FilePages, readS8B1Neighborhood,
  type S8B1CountWorld, type S8B1Edge, type S8B1FileEdge,
} from '../helpers/S8B1-count-world.js';

const opened: S8B1CountWorld[] = [];
afterEach(async () => {
  for (const handle of opened.splice(0).reverse()) await handle.world.close();
});

async function openCount(backend: 'memory' | 'sqlite' = 'memory'): Promise<S8B1CountWorld> {
  const handle = await openS8B1CountWorld(backend);
  opened.push(handle);
  return handle;
}

const iface = (moduleId: string, interfaceId: string): string =>
  `interface:${canonicalJson([moduleId, interfaceId] as unknown as never)}`;
const A = iface('src', 'a');
const B = iface('src', 'b');
const C = iface('src', 'c');
const ONE_MODEL = iface('one', 'model');
const TWO_MODEL = iface('two', 'model');

const expectedInterfaceEdges = [
  { fromNode: A, toNode: B, kind: 'interface_uses', count: 2 },
  { fromNode: C, toNode: B, kind: 'interface_uses', count: 2 },
];
const expectedModuleEdges = [
  { fromNode: 'module:other', toNode: 'module:lib', kind: 'module_dependency', count: 2 },
  { fromNode: 'module:one', toNode: 'module:two', kind: 'module_dependency', count: 1 },
  { fromNode: 'module:two', toNode: 'module:one', kind: 'module_dependency', count: 1 },
];
const expectedEdges = [...expectedInterfaceEdges, ...expectedModuleEdges];

const edgeRows = (edges: readonly S8B1Edge[]) =>
  edges.filter(edge => edge.fromNode !== edge.toNode)
    .map(edge => ({ fromNode: edge.fromNode, toNode: edge.toNode, kind: edge.kind, count: edge.count }))
    .sort((left, right) => `${left.fromNode}\u0000${left.toNode}`.localeCompare(`${right.fromNode}\u0000${right.toNode}`));

const expectedRows = expectedEdges
  .map(edge => ({ fromNode: edge.fromNode, toNode: edge.toNode, kind: edge.kind, count: edge.count }))
  .sort((left, right) => `${left.fromNode}\u0000${left.toNode}`.localeCompare(`${right.fromNode}\u0000${right.toNode}`));

const pageEdgeRows = (edges: readonly S8B1FileEdge[]) =>
  edges.map(edge => ({ from: edge.from, to: edge.to, count: edge.count }))
    .sort((left, right) => `${left.from}\u0000${left.to}`.localeCompare(`${right.from}\u0000${right.to}`));

const expectedFileRows = [
  { from: 'src/a.ts', to: 'src/b.ts', count: 2 },
  { from: 'src/c/c.ts', to: 'src/b.ts', count: 2 },
  { from: 'src/other/x.ts', to: 'lib/y.ts', count: 2 },
  { from: 'src/one/a.ts', to: 'src/two/b.ts', count: 1 },
  { from: 'src/two/b.ts', to: 'src/one/a.ts', count: 1 },
].sort((left, right) => `${left.from}\u0000${left.to}`.localeCompare(`${right.from}\u0000${right.to}`));

describe('S8B1 observation counts', () => {
  it('B1-01 one query read returns the two interface and three module references with counts 2/2/2/1/1', async () => {
    const handle = await openCount();
    const value = await readS8B1Neighborhood(handle);
    expect(edgeRows(edgesOf(value))).toEqual(expectedRows);
  });

  it('B1-02 the interface nodes exist and every interface endpoint edge is interface_uses', async () => {
    const handle = await openCount();
    const value = await readS8B1Neighborhood(handle);
    const nodeIds = nodesOf(value).map(node => node['nodeId']);
    expect(nodeIds).toEqual(expect.arrayContaining([
      A, B, C, ONE_MODEL, TWO_MODEL,
      'module:other', 'module:lib', 'module:one', 'module:two',
    ]));
    for (const edge of edgesOf(value)) {
      if (edge.fromNode.startsWith('interface:') || edge.toNode.startsWith('interface:')) {
        expect(edge.kind, `${edge.fromNode} -> ${edge.toNode}`).toBe('interface_uses');
      }
    }
  });

  it('B1-03 listFiles pages accumulate the five file references with counts 2/2/2/1/1 and the page node fields only', async () => {
    const handle = await openCount();
    const pages = await readS8B1FilePages(handle);
    expect(pageEdgeRows(pages.edges as unknown as S8B1FileEdge[])).toEqual(expectedFileRows);
    expect(pages.nodes.length).toBeGreaterThan(0);
    for (const node of pages.nodes) {
      expect(Object.keys(node).sort()).toEqual(['language', 'nonBlankLines', 'path']);
    }
  });

  it('B1-04 (SQLite only: reopen) the same capture keeps counts 2/2/2/1/1 after the Host restarts', async () => {
    const handle = await openCount('sqlite');
    const before = await readS8B1FilePages(handle);
    expect(pageEdgeRows(before.edges as unknown as S8B1FileEdge[])).toEqual(expectedFileRows);
    await handle.world.reopen();
    const after = await readS8B1FilePages(handle);
    expect(pageEdgeRows(after.edges as unknown as S8B1FileEdge[])).toEqual(expectedFileRows);
  });

  it('B1-05 one edge per node pair; edgeId is sha256Hex(canonicalJson([from,to])) and count is not in the key', async () => {
    const handle = await openCount();
    const value = await readS8B1Neighborhood(handle);
    const edges = edgesOf(value).filter(edge => edge.fromNode !== edge.toNode);
    expect(new Set(edges.map(edge => `${edge.fromNode}\u0000${edge.toNode}`)).size).toBe(edges.length);
    for (const edge of edges) {
      expect(edge.structuralKey).toBe(canonicalJson([edge.fromNode, edge.toNode] as unknown as never));
      expect(edge.edgeId).toBe(sha256Hex(edge.structuralKey));
      expect(edge.structuralKey).not.toContain('count');
    }
    expect(edges.map(edge => edge.count).sort()).toEqual([1, 1, 2, 2, 2]);
  });
});
