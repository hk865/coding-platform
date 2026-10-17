/**
 * §10 item 1 / §11.6 A-07: a real Git work tree lists tracked + untracked,
 * non-ignored files; the workspace may be a repository subdirectory. Ignored
 * files never reach the file page and `inventory` says `git` with no reason.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type Backend, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const entries: [string, string][] = [
  ['.gitignore', 'node_modules/\ndist/\n'],
  ['node_modules/ignored.ts', 'export const ignored = 1;\n'],
  ['dist/ignored.ts', 'export const ignored = 1;\n'],
  ['src/tracked.ts', 'export const tracked = 1;\n'],
];

async function assertGitInventory(backend: Backend, projectId: string, repo: 'workspace' | 'parent') {
  const f = await fixture(backend, projectId, entries, { git: { repo } });
  fixtures.push(f);
  // Written AFTER init/add: a non-ignored file Git still reports as untracked.
  await f.write('src/untracked.ts', 'export const untracked = 1;\n');
  const captured = await f.capture();
  const page = await f.listFiles(captured);
  expect(page.nodes).toEqual([
    { path: '.gitignore', nonBlankLines: 2, language: 'other' },
    { path: 'src/tracked.ts', nonBlankLines: 1, language: 'typescript' },
    { path: 'src/untracked.ts', nonBlankLines: 1, language: 'typescript' },
  ]);
  expect(page.inventory).toEqual({ source: 'git', reason: null });
}

for (const backend of BACKENDS) {
  it(`A-07 lists tracked and untracked non-ignored files at the repo root [${backend}]`, async () => {
    await assertGitInventory(backend, `s8e-a07-${backend}`, 'workspace');
  });
  it(`A-07 lists the same inventory when the workspace is a repository subdirectory [${backend}]`, async () => {
    await assertGitInventory(backend, `s8e-a07-sub-${backend}`, 'parent');
  });
}
