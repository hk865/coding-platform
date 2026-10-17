/**
 * Slice 8 §10 item 2 rework: the module layer is decided by the language status
 * and the sources the scan actually walked, never by the parsed count. A single
 * TS file that fails through the scan's per-file fault hook is still walked and
 * indexed: the module that owns it keeps its sources, the file page reports the
 * failure, and the module layer is NOT the explicit empty snapshot.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const entries: [string, string][] = [['main.ts', 'export const main = 1;\n']];
const mapping = [{ id: 'M', kind: 'module' as const, paths: ['.'] }];

for (const backend of BACKENDS) {
  it(`keeps the module layer of a walked TS source whose parse failed [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-file-fault-module-${backend}`, entries, {
      lightScan: {
        fault: event => {
          if (event.phase === 'file' && event.path === 'main.ts') throw new RangeError('injected');
        },
      },
    });
    fixtures.push(f);

    const captured = await f.capture(mapping);
    // Through the public query entry: the module keeps the walked source.
    const queried = await f.platform.architecture.queryArchitecture(f.ctx, {
      selection: { kind: 'observed', capture: captured.persisted },
      depth: 1, relations: ['dependency'], page: { limit: 20 },
    });
    expect(queried.status).toBe('ready');
    if (queried.status !== 'ready') throw Error('queryArchitecture failed');
    expect(queried.value.nodes.map(node => node.nodeId)).toEqual(['module:M']);

    // The file page reports the walked-but-failed parse, not a successful one.
    const page = await f.listFiles(captured);
    expect(page.languages).toEqual([{
      language: 'typescript', files: 1, parsed: 0, edges: 'supported', reason: null,
      notes: [], issues: [{ path: 'main.ts', kind: 'failed', reason: 'RangeError: injected' }],
      issueCount: 1, complete: false,
    }]);
  });
}
