/**
 * §10 item 1 / §11.6 A-08: outside a Git work tree the fixed skip list prunes
 * `node_modules` and a nested `.venv`, keeps `dist`, and records the inventory
 * source + reason.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const entries: [string, string][] = [
  ['node_modules/x.ts', 'export const x = 1;\n'],
  ['a/b/.venv/y.py', 'y = 1\n'],
  ['dist/z.ts', 'export const z = 1;\n'],
  // The skip list's first entry: `.git` is pruned even outside a work tree.
  ['.git/config', '[core]\n'],
  ['a/keep.ts', 'export const keep = 1;\n'],
  // Same content as the source inventory entry: `build/` stays, not only `dist/`.
  ['build/compile_commands.json', '[{"directory":".","file":"z.cpp","arguments":["cc","-c","z.cpp"]}]\n'],
];

for (const backend of BACKENDS) {
  it(`A-08 skip list excludes node_modules and nested .venv, keeps dist [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a08-${backend}`, entries);
    fixtures.push(f);
    const captured = await f.capture();
    const page = await f.listFiles(captured);
    expect(page.nodes).toEqual([
      { path: 'a/keep.ts', nonBlankLines: 1, language: 'typescript' },
      { path: 'build/compile_commands.json', nonBlankLines: 1, language: 'other' },
      { path: 'dist/z.ts', nonBlankLines: 1, language: 'typescript' },
    ]);
    expect(page.inventory).toEqual({ source: 'skip_list', reason: '不是 git 仓库' });
    // `.git`, `node_modules` and the nested `.venv` are pruned before the
    // inventory and the ordinary compile database is kept as a file, so none of
    // them is an issue. The one issue is `dist/z.ts`: it stays in the inventory,
    // but the TS analysis does not reach it, so it is a TS file left out of the
    // analysis. Its kind and reason are the literal of slice-8-SPEC.md:608
    // ("归 TS 但没走到的文件记 `skipped`，原因 `不在 TS 分析的范围里`").
    expect(page.languages.flatMap(language => language.issues)).toEqual([
      { path: 'dist/z.ts', kind: 'skipped', reason: '不在 TS 分析的范围里' },
    ]);
  });
}
