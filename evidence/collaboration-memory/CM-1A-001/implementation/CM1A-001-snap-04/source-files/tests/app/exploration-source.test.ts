import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explorationSourceDigest } from '../../src/app/exploration-source.js';

const directories: string[] = [];
afterEach(async () => { for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true }); });
async function workspace() { const root = await mkdtemp(join(tmpdir(), 'exploration-source-')); directories.push(root); return root; }
it('binds all regular files, including generated, dependency, hidden and nested ignored-name directories', async () => {
  const root = await workspace();
  for (const path of ['dist', 'node_modules/pkg', 'coverage', 'test-results', '.cache', 'nested/dist', 'nested/.git']) {
    const dir = join(root, path); await mkdir(dir, { recursive: true }); const before = await explorationSourceDigest(root);
    await writeFile(join(dir, 'readable.txt'), 'first'); const added = await explorationSourceDigest(root); expect(added).not.toBe(before);
    await writeFile(join(dir, 'readable.txt'), 'other'); expect(await explorationSourceDigest(root)).not.toBe(added);
  }
});
it('explicitly rejects entry, byte and nesting bounds instead of omitting content', async () => {
  const root = await workspace(); await writeFile(join(root, 'a.txt'), 'abc'); await writeFile(join(root, 'b.txt'), 'def');
  await expect(explorationSourceDigest(root, { maxEntries: 1, maxBytes: 100, maxDepth: 10 })).rejects.toThrow('条目超出');
  await expect(explorationSourceDigest(root, { maxEntries: 10, maxBytes: 5, maxDepth: 10 })).rejects.toThrow('字节上限');
  await mkdir(join(root, 'deep/nested'), { recursive: true }); await expect(explorationSourceDigest(root, { maxEntries: 10, maxBytes: 100, maxDepth: 1 })).rejects.toThrow('深度超出');
});
it('binds symlink entries without following content outside the workspace', async () => {
  const root = await workspace(), outside = await workspace(); await writeFile(join(outside, 'secret'), 'one'); await symlink(outside, join(root, 'link'));
  const before = await explorationSourceDigest(root); await writeFile(join(outside, 'secret'), 'two'); expect(await explorationSourceDigest(root)).toBe(before);
  await rm(join(root, 'link')); await symlink(outside + '/secret', join(root, 'link')); expect(await explorationSourceDigest(root)).not.toBe(before);
  await expect(explorationSourceDigest(join(root, 'link'))).rejects.toThrow();
});
