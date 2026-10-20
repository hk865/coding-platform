/**
 * §10 item 1 / §11.6 A-07: a real Git work tree lists tracked + untracked,
 * non-ignored files; the workspace may be a repository subdirectory. Ignored
 * files never reach the file page and `inventory` says `git` with no reason.
 */
import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { BACKENDS, fixture, type Backend, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const gitRun = promisify(execFile);
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'A-07 test',
  GIT_AUTHOR_EMAIL: 'a07@example.invalid',
  GIT_COMMITTER_NAME: 'A-07 test',
  GIT_COMMITTER_EMAIL: 'a07@example.invalid',
};
async function git(cwd: string, ...args: string[]): Promise<void> {
  await gitRun('git', args, { cwd, env: GIT_ENV });
}

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const entries: [string, string][] = [
  ['.gitignore', 'node_modules/\ndist/\n'],
  ['node_modules/ignored.ts', 'export const ignored = 1;\n'],
  ['dist/ignored.ts', 'export const ignored = 1;\n'],
  ['src/tracked.ts', 'export const tracked = 1;\n'],
  // Tracked in the fixture commit, then deleted from disk: Git still lists it.
  ['src/deleted.ts', 'export const deleted = 1;\n'],
];

async function assertGitInventory(backend: Backend, projectId: string, repo: 'workspace' | 'parent') {
  const f = await fixture(backend, projectId, entries, { git: { repo } });
  fixtures.push(f);
  // Grant the tracked symlink's path to the Host before creating it: write()
  // adds the path to the fixture's allow set, remove() keeps that grant, then a
  // real symlink replaces the file, so the path reaches the lstat/isFile skip
  // instead of being refused one step earlier by authorize/deny.
  await f.write('tracked-link.ts', '');
  await f.remove('tracked-link.ts');
  await symlink(join(f.root, 'src/tracked.ts'), join(f.root, 'tracked-link.ts'));
  await git(f.root, 'add', 'tracked-link.ts');
  await git(f.root, 'commit', '-qm', 'tracked symlink');
  if (repo === 'parent') {
    // The repository is one level above the workspace (the fixture's `parent`
    // layout). Commit a file at the repository root, outside the workspace, and a
    // repository-root `.gitignore` that is the only rule ignoring the workspace
    // path `gen/` (the workspace's own `.gitignore` names node_modules/ and dist/).
    const repoRoot = dirname(f.root);
    await writeFile(join(repoRoot, '.gitignore'), 'gen/\n');
    await writeFile(join(repoRoot, 'outside.ts'), 'export const outside = 1;\n');
    await git(repoRoot, 'add', '.gitignore', 'outside.ts');
    await git(repoRoot, 'commit', '-qm', 'repository-root files outside the workspace');
    // Written through the fixture, so the Host grants its read: only the
    // repository-root ignore rule keeps it off the page.
    await f.write('gen/x.ts', 'export const generated = 1;\n');
  }
  // The tracked file is removed from disk only after the commit.
  await f.remove('src/deleted.ts');
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
  // The exact page has neither the tracked-then-deleted file nor the tracked
  // symlink (and, in the parent variant, neither the repository-root file outside
  // the workspace nor the repository-root-ignored `gen/x.ts`); no language reports
  // an issue for any of them.
  expect(page.languages.flatMap(language => language.issues)).toEqual([]);
  // The observed digest still moves when an untracked file's content changes.
  const before = captured.persisted.capture.sourceDigest;
  await f.write('src/untracked.ts', 'export const untracked = 2;\n');
  expect((await f.capture()).persisted.capture.sourceDigest).not.toBe(before);
}

for (const backend of BACKENDS) {
  it(`A-07 lists tracked and untracked non-ignored files at the repo root [${backend}]`, async () => {
    await assertGitInventory(backend, `s8e-a07-${backend}`, 'workspace');
  });
  it(`A-07 lists the same inventory when the workspace is a repository subdirectory [${backend}]`, async () => {
    await assertGitInventory(backend, `s8e-a07-sub-${backend}`, 'parent');
  });
}
