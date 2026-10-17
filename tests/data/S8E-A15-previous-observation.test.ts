/**
 * §10 item 8 A-15: a second observation compares against the first persisted
 * capture. The workspace changes through real file writes: one file gains two
 * non-blank lines, one file is added, one is deleted and one is untouched.
 * `listFiles` carries the literal second node table; the change counts have no
 * public reader and are not asserted.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const entries: [string, string][] = [
  ['a.ts', 'export const a = 1;\n'],
  ['b.ts', 'export const b = 1;\n'],
  ['c.ts', 'export const c = 1;\n'],
  ['d.ts', 'export const d = 1;\n'],
];

for (const backend of BACKENDS) {
  it(`A-15 a second capture against the first one reads added, changed and deleted files [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a15-${backend}`, entries);
    fixtures.push(f);
    const first = await f.capture();
    const firstPage = await f.listFiles(first);
    expect(firstPage.nodes).toEqual([
      { path: 'a.ts', nonBlankLines: 1, language: 'typescript' },
      { path: 'b.ts', nonBlankLines: 1, language: 'typescript' },
      { path: 'c.ts', nonBlankLines: 1, language: 'typescript' },
      { path: 'd.ts', nonBlankLines: 1, language: 'typescript' },
    ]);
    const untouched = firstPage.nodes.find(node => node.path === 'b.ts');

    // Real filesystem writes after the first capture.
    await f.write('a.ts', 'export const a = 1;\nexport const a2 = 2;\nexport const a3 = 3;\n');
    await f.write('e.ts', 'export const e = 1;\n');
    await f.remove('c.ts');

    const second = await f.capture([], undefined, first.persisted);
    const page = await f.listFiles(second);
    expect(page.nodes).toEqual([
      { path: 'a.ts', nonBlankLines: 3, language: 'typescript' },
      { path: 'b.ts', nonBlankLines: 1, language: 'typescript' },
      { path: 'd.ts', nonBlankLines: 1, language: 'typescript' },
      { path: 'e.ts', nonBlankLines: 1, language: 'typescript' },
    ]);
    expect(page.nodes.find(node => node.path === 'b.ts')).toEqual(untouched);
    expect(page.inventory).toEqual({ source: 'skip_list', reason: '不是 git 仓库' });
  });
}
