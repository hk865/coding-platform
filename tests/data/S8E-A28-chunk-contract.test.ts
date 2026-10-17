/**
 * §10 item 8 / review item 4: the chunk body has ONE write/read contract.
 *
 * Every case goes through the shared platform fixture's public
 * `captureSourceChanges` / `listFiles` / `graph` path on both backends. The
 * injected file-graph options are the platform's own knobs, never a hand-built
 * record: the platform produces the chunk, rejects it, or reads it back.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const PAGE_NODE = { path: 'a.ts', nonBlankLines: 1, language: 'typescript' };

for (const backend of BACKENDS) {
  it(`A-28 keeps the real empty specifier through commit and the page path [${backend}]`, async () => {
    // `import "";` is real syntax and produces `specifier: ''`; the writer and
    // the decoder must both accept it. Before the shared validator change the
    // capture committed but every file page decoded as damaged.
    const f = await fixture(backend, `s8e-a28-empty-${backend}`, [['a.ts', 'import "";\n']]);
    fixtures.push(f);
    const captured = await f.capture();
    const list = await f.listFiles(captured);
    expect(list.nodes).toEqual([PAGE_NODE]);
    expect(list.edges).toEqual([]);
    expect(list.complete).toBe(true);
    // The fixture's `graph()` reaches the same unresolved entry through the
    // public comparison path; its `detail` is the bare empty specifier.
    const graph = await f.graph();
    expect(graph.unresolved).toEqual([{ from: 'a.ts', specifier: '', reason: null }]);
  });

  it(`A-28 rejects a specifier over the one 4096 limit before commit [${backend}]`, async () => {
    // The chunk writer calls the decoder's validator before the first put, so a
    // 5,000-character specifier cannot be committed as a chunk no page can read.
    const f = await fixture(backend, `s8e-a28-long-${backend}`,
      [['a.ts', 'import "' + 'x'.repeat(5000) + '";\n']]);
    fixtures.push(f);
    const result = await f.captureResult();
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw Error('expected a rejected capture');
    // Outcome UNSPECIFIED in the book: `invalid` is the smallest consistent with
    // the current invalid/capacity mapping (the chunk body itself is not large).
    expect(result.code).toBe('invalid');
  });

  it(`A-28 maps an item that cannot fit its chunk envelope to capacity [${backend}]`, async () => {
    // A full node body is ~219 bytes including the envelope, so a 10-byte chunk
    // cannot hold it. The packer must say capacity for the FIRST item instead of
    // committing a chunk body larger than the injected size.
    const f = await fixture(backend, `s8e-a28-small-${backend}`, [['a.ts', 'export {};\n']],
      { fileGraph: { maxNodes: 20000, maxEdges: 100000, chunkBytes: 10 } });
    fixtures.push(f);
    const result = await f.captureResult();
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw Error('expected a rejected capture');
    expect(result.code).toBe('capacity');
  });
}
