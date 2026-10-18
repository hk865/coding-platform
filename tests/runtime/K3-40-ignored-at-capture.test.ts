/**
 * K3 section 3 item 7 (L5, spec line 201/218): a path ignored by the rules in
 * force at capture time is not compared on either side. It appears only in
 * `notVisible`; the rule file's own change is what the comparison reports.
 *
 * The case runs on the real git workspace seam: `readWorkspaceBaseline` records
 * the untracked path while it is still visible, then a committed `.gitignore`
 * starts ignoring it before `captureWorkspaceChange` runs.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureWorkspaceChange, readWorkspaceBaseline,
} from '../../src/core/workspace/workspace-change-capture.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

/** A fresh git work tree with a committed `.gitignore` and `keep.txt`. */
async function gitWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'k3-40-ignored-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'k3-40-ignored@example.invalid');
  git('config', 'user.name', 'K3 40 ignored');
  await writeFile(join(root, '.gitignore'), '# rules before the capture\n');
  await writeFile(join(root, 'keep.txt'), 'keep\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return root;
}

describe('K3-40 L5 ignored-at-capture paths', () => {
  it('K3-04 (L5): a path ignored by the rules in force at capture is not compared on either side', async () => {
    const root = await gitWorkspace();
    // Visible (untracked, not yet ignored) when the start baseline runs.
    await mkdir(join(root, 'ignored-later'));
    await writeFile(join(root, 'ignored-later', 'note.txt'), 'written before the capture\n');
    const baseline = await readWorkspaceBaseline({ root, deniedPrefixes: [] });
    if (baseline.status !== 'captured') throw new Error(`baseline: ${baseline.status}`);
    expect(baseline.baseline.dirty).toContainEqual(
      expect.objectContaining({ path: 'ignored-later/note.txt', state: 'present' }));

    // The rule changes before the capture: the path is now ignored.
    await writeFile(join(root, '.gitignore'), '# rules before the capture\nignored-later/\n');
    const captured = await captureWorkspaceChange({ root, deniedPrefixes: [], baseline: baseline.baseline });
    if (captured.status !== 'captured') throw new Error(`capture: ${captured.status}`);

    // The rule file's own change is reported; the ignored path is not compared.
    expect(captured.capture.changed).toEqual([{ path: '.gitignore', change: 'modified' }]);
    expect(captured.capture.changed.map(entry => entry.path)).not.toContain('ignored-later/note.txt');
    expect(captured.capture.notVisible).toContain('ignored-later/');
  });
});
