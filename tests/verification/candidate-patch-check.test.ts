import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitCandidatePatchCheck } from '../../src/control/verification-engine/candidate-patch-check.js';
import { VerificationContextCompiler } from '../../src/data/context-compiler/verification-context.js';
import type { StateLedger } from '../../src/contracts/ledger.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it('checks the already-applied patch with real Git without changing the source, and preserves rejection errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'candidate-patch-')); roots.push(directory);
  const root = join(directory, 'workspace'); await mkdir(root);
  const path = join(root, 'source.txt'), patchFile = join(directory, 'candidate.diff');
  await writeFile(path, 'after\n');
  await writeFile(patchFile, 'diff --git a/source.txt b/source.txt\n--- a/source.txt\n+++ b/source.txt\n@@ -1 +1 @@\n-before\n+after\n');
  const provider = new GitCandidatePatchCheck();
  await expect(provider.check({ root, patchFile })).resolves.toBeUndefined();
  expect(await readFile(path, 'utf8')).toBe('after\n');
  await writeFile(path, 'unrelated\n');
  await expect(provider.check({ root, patchFile })).rejects.toThrow('候选补丁与当前工作区不匹配（反向检查失败）');
  expect(await readFile(path, 'utf8')).toBe('unrelated\n');
  await expect(provider.check({ root, patchFile: join(directory, 'missing.diff') })).rejects.toThrow('候选补丁与当前工作区不匹配（反向检查失败）');
});

it('selects the registered scope root for source material through the injected WorkspaceReader', async () => {
  const unavailable = vi.fn(async (): Promise<never> => { throw Error('unexpected canonical/artifact access'); });
  const digest = vi.fn(async () => 'a'.repeat(64));
  const rootFor = vi.fn((project: string, workspace: string) => '/registered/' + project + '/' + workspace);
  const context = new VerificationContextCompiler({ ledger: { load: unavailable } as unknown as StateLedger,
    vault: { open: unavailable }, workspaceSource: { digest }, rootFor });
  expect(await context.workspaceDigest({ projectId: 'project', workspaceId: 'workspace', goalId: 'goal', runId: 'run' })).toBe('a'.repeat(64));
  expect(rootFor).toHaveBeenCalledWith('project', 'workspace');
  expect(digest).toHaveBeenCalledWith('/registered/project/workspace');
  expect(unavailable).not.toHaveBeenCalled();
});
