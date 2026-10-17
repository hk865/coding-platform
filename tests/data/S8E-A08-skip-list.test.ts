/**
 * §10 item 1 / §11.6 A-08: outside a Git work tree the fixed skip list prunes
 * `node_modules` and a nested `.venv`, keeps `dist`, and records the inventory
 * source + reason.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type Backend, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const entries: [string, string][] = [
  ['node_modules/x.ts', 'export const x = 1;\n'],
  ['a/b/.venv/y.py', 'y = 1\n'],
  ['dist/z.ts', 'export const z = 1;\n'],
];

for (const backend of BACKENDS) {
  it(`A-08 skip list excludes node_modules and nested .venv, keeps dist [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a08-${backend}`, entries);
    fixtures.push(f);
    const captured = await f.capture();
    const page = await f.listFiles(captured);
    expect(page.nodes).toEqual([{ path: 'dist/z.ts', nonBlankLines: 1, language: 'typescript' }]);
    expect(page.inventory).toEqual({ source: 'skip_list', reason: '不是 git 仓库' });
  });
}
