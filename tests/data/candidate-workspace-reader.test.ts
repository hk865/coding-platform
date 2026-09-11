import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { CandidateWorkspaceReader } from '../../src/data/workspace-reader/candidate-workspace-reader.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';

const roots: string[] = [];
const source = new CandidateWorkspaceReader();
const sha = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'candidate-source-')); roots.push(root);
  return root;
}

it('preserves candidate byte identity, sorted paths, file modes and its historical ignore set', async () => {
  const root = await fixture();
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'main.ts'), 'export const value = 1;\n');
  await chmod(join(root, 'src', 'main.ts'), 0o644);
  const binary = Buffer.from([0, 255, 13, 10]);
  await writeFile(join(root, 'a.bin'), binary);
  await chmod(join(root, 'a.bin'), 0o600);
  const expected = sha(canonicalJson(['a.bin', 0o600, sha(binary)]) +
    canonicalJson(['src/main.ts', 0o644, sha('export const value = 1;\n')]));
  expect(await source.digest(root)).toBe(expected);
  for (const name of ['.git', '.platform-runtime', 'node_modules', 'dist', 'coverage', 'test-results', '.cache']) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, 'untracked.bin'), Buffer.from([31, 99]));
    await mkdir(join(root, 'src', name));
    await writeFile(join(root, 'src', name, 'nested.txt'), 'also ignored');
  }
  expect(await source.digest(root)).toBe(expected);
  await chmod(join(root, 'src', 'main.ts'), 0o755);
  expect(await source.digest(root)).not.toBe(expected);
  await chmod(join(root, 'src', 'main.ts'), 0o644);
  await writeFile(join(root, 'a.bin'), Buffer.from([0, 254, 13, 10]));
  expect(await source.digest(root)).not.toBe(expected);
  expect(await readFile(join(root, 'src', 'main.ts'), 'utf8')).toBe('export const value = 1;\n');
});

it('hashes link identity without following it and rejects a linked candidate root', async () => {
  const base = await fixture(), root = join(base, 'workspace');
  await mkdir(root);
  await writeFile(join(base, 'outside.txt'), 'outside content');
  await symlink('../outside.txt', join(root, 'source-link'));
  const before = await source.digest(root);
  expect(before).toBe(sha(canonicalJson(['source-link', 'link', '../outside.txt'])));
  await writeFile(join(base, 'outside.txt'), 'changed outside content');
  expect(await source.digest(root)).toBe(before);
  await unlink(join(root, 'source-link'));
  await symlink('../missing.txt', join(root, 'source-link'));
  expect(await source.digest(root)).not.toBe(before);
  const linkedRoot = join(base, 'linked-root');
  await symlink(root, linkedRoot);
  await expect(source.digest(linkedRoot)).rejects.toThrow('候选工作区不能是链接');
});

it('rejects an oversized candidate before reading its file body', async () => {
  const root = await fixture();
  const file = await open(join(root, 'oversized.bin'), 'w');
  try { await file.truncate(512 * 1024 * 1024 + 1); } finally { await file.close(); }
  await expect(source.digest(root)).rejects.toThrow('工作区超出候选快照上限');
});
