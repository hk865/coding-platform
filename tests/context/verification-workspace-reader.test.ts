import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rename, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VerificationWorkspaceReader } from '../../src/data/workspace-reader/verification-workspace-reader.js';
import { CandidateWorkspaceReader } from '../../src/data/workspace-reader/candidate-workspace-reader.js';

const execute = promisify(execFile), roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const git = (root: string, args: string[]) => execute('git', ['-C', root, ...args], { windowsHide: true });
async function fixture(withGit = false) {
  const root = await mkdtemp(join(tmpdir(), 'verification-source-')); roots.push(root);
  await writeFile(join(root, 'source.txt'), 'source\n');
  if (withGit) {
    await git(root, ['init']); await git(root, ['add', '.']);
    await git(root, ['-c', 'user.name=Context test', '-c', 'user.email=context@example.invalid', 'commit', '-m', 'baseline']);
  }
  return root;
}

it('preserves the original current digest and exposes unknown scope for non-Git workspaces', async () => {
  const root = await fixture(), reader = new VerificationWorkspaceReader();
  const first = await reader.capture(root);
  expect(first).toMatchObject({ status: 'ready', sourceDigest: await new CandidateWorkspaceReader().digest(root),
    sourceProof: { kind: 'current-workspace-only', runBaselineKnown: false },
    changeScope: { changedFiles: [], diffClass: 'unclassified-current-workspace' } });
  await mkdir(join(root, '.cache')); await writeFile(join(root, '.cache', 'check-count'), '1');
  expect(await reader.capture(root)).toEqual(first);
});

it('observes actual tracked/untracked/deleted/renamed paths including files ignored by Git, within the original digest scope', async () => {
  const root = await fixture(true), reader = new VerificationWorkspaceReader();
  await writeFile(join(root, 'deleted.txt'), 'delete\n');
  await writeFile(join(root, '.gitignore'), 'ignored.txt\n');
  await mkdir(join(root, '.cache')); await writeFile(join(root, '.cache', 'tracked'), 'initial\n');
  await git(root, ['add', '.']);
  await git(root, ['-c', 'user.name=Context test', '-c', 'user.email=context@example.invalid', 'commit', '-m', 'extra baseline']);
  await rename(join(root, 'source.txt'), join(root, 'renamed.txt'));
  await unlink(join(root, 'deleted.txt'));
  await writeFile(join(root, 'untracked.txt'), 'untracked\n');
  await writeFile(join(root, 'ignored.txt'), 'still in candidate digest\n');
  await writeFile(join(root, '.cache', 'tracked'), 'check result\n');
  const result = await reader.capture(root);
  expect(result).toMatchObject({ status: 'ready', sourceDigest: await new CandidateWorkspaceReader().digest(root),
    sourceProof: { kind: 'git-head-worktree', comparison: 'current-head-to-worktree', runBaselineKnown: false,
      changedFiles: ['deleted.txt', 'ignored.txt', 'renamed.txt', 'source.txt', 'untracked.txt'] } });
  await writeFile(join(root, '.cache', 'tracked'), 'next check result\n');
  expect(await reader.capture(root)).toEqual(result);
});

it('never uses an enclosing Git repository as the registered workspace comparison', async () => {
  const parent = await fixture(true), child = join(parent, 'nested'); await mkdir(child);
  await writeFile(join(child, 'local.txt'), 'local\n');
  const reader = new VerificationWorkspaceReader(), first = await reader.capture(child);
  expect(first).toMatchObject({ status: 'ready', sourceProof: { kind: 'current-workspace-only' } });
  await writeFile(join(parent, 'source.txt'), 'outer change\n');
  expect(await reader.capture(child)).toEqual(first);
});

it('refuses observed changes during the source capture rather than returning a mixed digest', async () => {
  const root = await fixture(), original = CandidateWorkspaceReader.prototype.snapshot;
  vi.spyOn(CandidateWorkspaceReader.prototype, 'snapshot').mockImplementationOnce(async function (this: CandidateWorkspaceReader, path) {
    const before = await original.call(this, path);
    await writeFile(join(root, 'source.txt'), 'concurrent edit\n');
    return before;
  });
  expect(await new VerificationWorkspaceReader().capture(root)).toMatchObject({ status: 'rejected', code: 'source_changed' });
});

it('does not execute repository clean filters when comparing the worktree', async () => {
  const root = await fixture(true);
  await writeFile(join(root, '.gitattributes'), 'source.txt filter=probe\n');
  await git(root, ['add', '.gitattributes']);
  await git(root, ['-c', 'user.name=Context test', '-c', 'user.email=context@example.invalid', 'commit', '-m', 'declare filter']);
  await git(root, ['config', 'filter.probe.clean', 'touch filter-was-run']);
  await writeFile(join(root, 'source.txt'), 'actual raw change\n');
  expect(await new VerificationWorkspaceReader().capture(root)).toMatchObject({ status: 'ready', sourceProof: { changedFiles: ['source.txt'] } });
  await expect(readFile(join(root, 'filter-was-run'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('detects a changed Git comparison base even when workspace bytes stay the same', async () => {
  const root = await fixture(true), original = CandidateWorkspaceReader.prototype.snapshot;
  vi.spyOn(CandidateWorkspaceReader.prototype, 'snapshot')
    .mockImplementationOnce(function (this: CandidateWorkspaceReader, path) { return original.call(this, path); })
    .mockImplementationOnce(async function (this: CandidateWorkspaceReader, path) {
      const result = await original.call(this, path);
      await git(root, ['-c', 'user.name=Context test', '-c', 'user.email=context@example.invalid', 'commit', '--allow-empty', '-m', 'new baseline']);
      return result;
    });
  expect(await new VerificationWorkspaceReader().capture(root)).toMatchObject({ status: 'rejected', code: 'source_changed' });
});

it('rejects incomplete and oversized comparison scopes without truncation', async () => {
  const root = await fixture(true);
  for (let i = 0; i < 65; i++) await writeFile(join(root, `new-${i}.txt`), 'new');
  expect(await new VerificationWorkspaceReader().capture(root)).toMatchObject({ status: 'incomplete', code: 'source_unavailable' });
  expect(await new VerificationWorkspaceReader().capture(join(root, 'missing'))).toMatchObject({ status: 'incomplete', code: 'source_unavailable' });
});
