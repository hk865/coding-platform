/**
 * A-18 (slice 8 §11.6): per-file faults, cancellation, the explicit queue on a
 * 300-file cycle, and the raw-reference cap. Every case runs through the shared
 * platform fixture's public capture and pages on both backends.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BACKENDS, fixture, type Entry, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const byPath = (paths: string[]) => [...paths].sort();

describe.each(BACKENDS)('A-18 TS failures [%s]', backend => {
  it('A-18 a file-phase fault fails only that file and keeps the other parsed files and edges', async () => {
    const f = await fixture(backend, `s8d-a18-fault-${backend}`, [
      ['src/a.ts', 'import "./b";\nimport "./c";\n'],
      ['src/b.ts', 'import "./c";\n'],
      ['src/c.ts', 'export {};\n'],
    ], {
      lightScan: { fault: event => { if (event.phase === 'file' && event.path === 'src/b.ts') throw new RangeError('injected'); } },
    });
    fixtures.push(f);
    const graph = await f.graph();

    expect(graph.languages.find(entry => entry.language === 'typescript')).toEqual({
      language: 'typescript', files: 3, parsed: 2, edges: 'supported', reason: null,
      notes: [], issues: [{ path: 'src/b.ts', kind: 'failed', reason: 'RangeError: injected' }],
      issueCount: 1, complete: false,
    });
    expect(byPath(graph.edges.map(edge => `${edge.from} -> ${edge.to}`))).toEqual(byPath([
      'src/a.ts -> src/b.ts',
      'src/a.ts -> src/c.ts',
    ]));
    expect(graph.nodes.map(node => node.path)).toEqual(byPath(['src/a.ts', 'src/b.ts', 'src/c.ts']));
  });

  it('A-18 a file-phase fault that aborts the request cancels the observation, not just the file', async () => {
    const controller = new AbortController();
    const f = await fixture(backend, `s8d-a18-cancel-${backend}`, [
      ['src/a.ts', 'import "./b";\n'],
      ['src/b.ts', 'import "./c";\n'],
      ['src/c.ts', 'export {};\n'],
    ], {
      signal: controller.signal,
      lightScan: { fault: event => {
        if (event.phase === 'file' && event.path === 'src/c.ts') { controller.abort(); throw Error('x'); }
      } },
    });
    fixtures.push(f);
    const result = await f.graphResult();

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.code).toBe('cancelled');
  });

  it('A-18 walks a 300-file import cycle exactly once per file and yields exactly 300 edges', async () => {
    const entries: Entry[] = Array.from({ length: 300 }, (_value, index) =>
      [`m${index}.ts`, `import "./m${(index + 1) % 300}";\n`] as const);
    const modules = entries.map(([path]) => ({ id: path, kind: 'module' as const, paths: [path] }));
    const f = await fixture(backend, `s8d-a18-cycle-${backend}`, entries);
    fixtures.push(f);
    const captured = await f.capture(modules);

    const page = await f.listFiles(captured);
    expect(page.languages.find(entry => entry.language === 'typescript')).toEqual({
      language: 'typescript', files: 300, parsed: 300, edges: 'supported', reason: null,
      notes: [], issues: [], issueCount: 0, complete: true,
    });

    // `listFiles` shows 200 nodes per page and only edges whose two endpoints are
    // on that page, so the cycle's cross-page edges are on no page. The module
    // layer is built from the same one scan (§10 item 3) and carries every edge.
    const query = await f.platform.architecture.queryArchitecture(f.ctx, {
      selection: { kind: 'observed', capture: captured.persisted },
      depth: 1, relations: ['dependency'], page: { limit: 500 },
    });
    expect(query.status).toBe('ready');
    if (query.status !== 'ready') throw Error(`queryArchitecture ${JSON.stringify(query)}`);
    expect(query.value.nodes).toHaveLength(300);
    expect(query.value.edges).toHaveLength(300);
    expect(new Set(query.value.edges.map(edge => edge.fromNode)).size).toBe(300);
    expect(query.value.unresolved).toEqual([]);

    // The same capture on the file layer: each file has exactly one outgoing
    // neighbour, the next file of the cycle. The page only returns edges whose
    // two endpoints are both page nodes (§8A read rule) and the queried file is
    // never a page node, so the one-edge-per-file literal is the single node
    // `direction: 'out'` reaches — exactly `to`, which is the proof of the edge.
    for (let index = 0; index < 300; index += 1) {
      const from = `m${index}.ts`;
      const to = `m${(index + 1) % 300}.ts`;
      const neighbors = await f.platform.architecture.neighbors(f.ctx,
        { captureRef: captured, file: from, direction: 'out', limit: 10, cursor: null });
      expect(neighbors.status).toBe('ready');
      if (neighbors.status !== 'ready') throw Error(`neighbors ${from} ${JSON.stringify(neighbors)}`);
      expect(neighbors.value.nodes.map(node => node.path)).toEqual([to]);
    }
  }, 180_000);

  it('A-18 fails the language once the raw-reference cap is crossed', async () => {
    const f = await fixture(backend, `s8d-a18-raw-${backend}`, [
      ['a.ts', 'import "./x1";\nimport "./x2";\nimport "./x3";\n'],
      ['b.ts', 'import "./y1";\nimport "./y2";\nimport "./y3";\n'],
    ], { lightScan: { maxRawReferences: 5 } });
    fixtures.push(f);
    const graph = await f.graph();

    expect(graph.languages.find(entry => entry.language === 'typescript')).toEqual({
      language: 'typescript', files: 2, parsed: 0, edges: 'failed', reason: '原始引用超过 5 条',
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });
});
