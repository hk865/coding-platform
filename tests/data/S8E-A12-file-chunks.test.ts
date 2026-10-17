/**
 * §10 item 8 A-12: one observation split into several file-graph chunks still
 * reads back as the exact hand-computed file graph through the three public
 * pages. The chunk size is injected; nodes are one-per-chunk at this cap, so
 * several edges have endpoints in different chunk bodies. Literals are computed
 * from the fixture contents, never compared with an unsplit capture.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

/** Path order a..g: `a.ts` imports the far-away `g.ts`, so its edge endpoints
 * sit in different node chunks; `c.ts` imports two adjacent targets. */
const entries: [string, string][] = [
  ['a.ts', 'import "./g";\nimport "./f";\nimport "missing-one";\n'],
  ['b.ts', 'import "./a";\n'],
  ['c.ts', 'import "./a";\nimport "./b";\n'],
  ['d.ts', 'import "./c";\n'],
  ['e.ts', 'import "./d";\n'],
  ['f.ts', 'import "./e";\n'],
  ['g.ts', 'import "./f";\nimport "missing-two";\n'],
];

const TYPESCRIPT = { path: '', nonBlankLines: 0, language: 'typescript' };
const node = (path: string, nonBlankLines: number) => ({ ...TYPESCRIPT, path, nonBlankLines });

// One full v2 node fits this size, two do not (hand-computed from the literal
// fields, not from codec output). Every fixture path is 4 characters (`a.ts`),
// every digest is 64 hex characters, every byteSize below 100 (2 digits), every
// `nonBlankLines` is 1 digit and `indexed` is `true`:
//   `{"path":` 8 + `"a.ts"` 6 + `,"digest":` 10 + quoted 64-hex digest 66
//   + `,"byteSize":` 12 + 2 digits + `,"language":` 12 + `"typescript"` 12
//   + `,"nonBlankLines":` 17 + 1 digit + `,"indexed":` 11 + `true` 4 + `}` 1
//   = 162 bytes per node.
//   Node envelope: `{"schemaVersion":2,"nodes":[` 28 + `],"edges":[],"unresolved":[]}` 29 = 57.
//   One node body = 57 + 162 = 219 <= 240; two = 57 + 162 + 1 + 162 = 382 > 240.
const CHUNK_BYTES = 240;

const NODES = [
  node('a.ts', 3), node('b.ts', 1), node('c.ts', 2), node('d.ts', 1),
  node('e.ts', 1), node('f.ts', 1), node('g.ts', 2),
];
const EDGES = [
  { from: 'a.ts', to: 'f.ts' }, { from: 'a.ts', to: 'g.ts' },
  { from: 'b.ts', to: 'a.ts' }, { from: 'c.ts', to: 'a.ts' }, { from: 'c.ts', to: 'b.ts' },
  { from: 'd.ts', to: 'c.ts' }, { from: 'e.ts', to: 'd.ts' },
  { from: 'f.ts', to: 'e.ts' }, { from: 'g.ts', to: 'f.ts' },
];

for (const backend of BACKENDS) {
  it(`A-12 reads split nodes, edges and unresolved entries through every file page [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a12-chunks-${backend}`, entries, {
      fileGraph: { maxNodes: 20000, maxEdges: 100000, chunkBytes: CHUNK_BYTES },
    });
    fixtures.push(f);
    const captured = await f.capture();

    const list = await f.listFiles(captured);
    expect(list.nodes).toEqual(NODES);
    expect(list.edges).toEqual(EDGES);
    expect(list.nextCursor).toBeNull();
    expect(list.complete).toBe(true);
    expect(list.inventory).toEqual({ source: 'skip_list', reason: '不是 git 仓库' });

    const neighbors = await f.platform.architecture.neighbors(f.ctx,
      { captureRef: captured, file: 'c.ts', direction: 'out', limit: 200, cursor: null });
    expect(neighbors.status).toBe('ready');
    if (neighbors.status === 'ready') {
      expect(neighbors.value.nodes).toEqual([node('a.ts', 3), node('b.ts', 1)]);
      expect(neighbors.value.edges).toEqual([{ from: 'b.ts', to: 'a.ts' }]);
      expect(neighbors.value.inventory).toEqual({ source: 'skip_list', reason: '不是 git 仓库' });
    }

    const impact = await f.platform.architecture.impact(f.ctx,
      { captureRef: captured, file: 'a.ts', depth: 3, limit: 200, cursor: null });
    expect(impact.status).toBe('ready');
    if (impact.status === 'ready') {
      expect(impact.value.nodes).toEqual([
        node('b.ts', 1), node('c.ts', 2), node('d.ts', 1), node('e.ts', 1),
      ]);
      expect(impact.value.edges).toEqual([
        { from: 'c.ts', to: 'b.ts' }, { from: 'd.ts', to: 'c.ts' }, { from: 'e.ts', to: 'd.ts' },
      ]);
      expect(impact.value.inventory).toEqual({ source: 'skip_list', reason: '不是 git 仓库' });
    }
  });

  it(`A-12 rejects an observation whose node, edge and unresolved chunks exceed 64 [${backend}]`, async () => {
    // Same CHUNK_BYTES = 240 and 57-byte envelope. 59 nodes are 164 bytes: each
    // `nNN.ts` path is 2 bytes longer than the 162-byte `a.ts` shape above. n00
    // has 100 bytes of source (5x20-byte import lines), so its byteSize is 3
    // digits and its node is 165 bytes. Either fits alone
    // (57+165 = 222 <= 240) and no two fit (57+165+1+164 = 387 > 240), so
    // 60 nodes n00..n59 are 60 node chunks. n01..n59 each import n00, so 59
    // index pairs `[i,0]`: 9 are 5 bytes (i=1..9) and 50 are 6 bytes (i=10..59).
    // With an edge envelope of 39 + 18 = 57 bytes the greedy packer fits
    // 9*5 + 18*6 + 26 commas = 179 bytes (57 + 179 = 236 <= 240, the next
    // 6-byte item would make 243), then 26*6 + 25 commas = 181 (57 + 181 = 238),
    // then 6*6 + 5 commas = 41 => 3 edge chunks. The 5 missing imports of n00
    // are 55-byte entries: 3 + 2 commas = 167 (57 + 167 = 224) then 2 + 1 = 111
    // (57 + 111 = 168) => 2 unresolved chunks. Total 60 + 3 + 2 = 65 > 64.
    const many: [string, string][] = [];
    for (let index = 0; index < 60; index += 1) {
      const name = `n${String(index).padStart(2, '0')}.ts`;
      many.push([name, index === 0
        ? 'import "missing-0";\nimport "missing-1";\nimport "missing-2";\nimport "missing-3";\nimport "missing-4";\n'
        : 'import "./n00";\n']);
    }
    const f = await fixture(backend, `s8e-a12-cap-${backend}`, many, {
      fileGraph: { maxNodes: 20000, maxEdges: 100000, chunkBytes: CHUNK_BYTES },
    });
    fixtures.push(f);
    const result = await f.captureResult();
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw Error('expected a rejected capture');
    expect(result.code).toBe('capacity');
    // The real count from the hand arithmetic above, not just "over 64".
    expect(result.reason).toContain('needs 65 chunks; the limit is 64');
  });
}
