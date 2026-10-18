/**
 * K3-40 (L5, D5): the new git change capture over a start baseline that saw a
 * tracked file already deleted.
 *
 * The row is written at its public capture seam: the same traversal the start
 * baseline and the settlement capture use. A git workspace fixture is created
 * in a throwaway temp directory; expected change labels are hand-computed from
 * the L5 classification order.
 */
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import {
  captureWorkspaceChange, readWorkspaceBaseline,
} from '../../src/core/workspace/workspace-change-capture.js';
import {
  readWorkspaceBaselineFromBundle, type WorkspaceArtifactReader,
} from '../../src/core/workspace/workspace-baseline-artifact.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

/** A fresh git work tree with `gone.txt` and `kept.txt` committed. */
async function gitWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'k3-40-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'k3-40@example.invalid');
  git('config', 'user.name', 'K3 40');
  await writeFile(join(root, 'gone.txt'), 'gone\n');
  await writeFile(join(root, 'kept.txt'), 'kept\n');
  await writeFile(join(root, 'flip.txt'), 'original\n');
  await writeFile(join(root, 'exec.txt'), 'exec content\n');
  await writeFile(join(root, 'content.txt'), 'content before\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return root;
}

describe('K3-40 git change capture from the start baseline', () => {
  it('K3-40 (i) a tracked file deleted before the Run stays out of the capture when it stays deleted', async () => {
    const root = await gitWorkspace();
    await unlink(join(root, 'gone.txt'));
    const baseline = await readWorkspaceBaseline({ root, deniedPrefixes: [] });
    if (baseline.status !== 'captured') throw new Error(`baseline: ${baseline.status}`);
    expect(baseline.baseline.dirty).toEqual([{ path: 'gone.txt', state: 'deleted' }]);

    const captured = await captureWorkspaceChange({ root, deniedPrefixes: [], baseline: baseline.baseline });
    if (captured.status !== 'captured') throw new Error(`capture: ${captured.status}`);
    expect(captured.capture.changed).toEqual([]);
    expect(captured.baselineKnown).toBe(true);
  });

  it('K3-40 (ii) a tracked file deleted before the Run is added when recreated in the Run', async () => {
    const root = await gitWorkspace();
    await unlink(join(root, 'gone.txt'));
    const baseline = await readWorkspaceBaseline({ root, deniedPrefixes: [] });
    if (baseline.status !== 'captured') throw new Error(`baseline: ${baseline.status}`);

    await writeFile(join(root, 'gone.txt'), 'recreated\n');
    const captured = await captureWorkspaceChange({ root, deniedPrefixes: [], baseline: baseline.baseline });
    if (captured.status !== 'captured') throw new Error(`capture: ${captured.status}`);
    expect(captured.capture.changed).toEqual([{ path: 'gone.txt', change: 'added' }]);
  });

  it('K3-40 (iii) a file changed before the Run and replaced by a symlink in the Run is mode_changed', async () => {
    const root = await gitWorkspace();
    await writeFile(join(root, 'flip.txt'), 'changed before the run\n');
    await unlink(join(root, 'gone.txt'));
    const baseline = await readWorkspaceBaseline({ root, deniedPrefixes: [] });
    if (baseline.status !== 'captured') throw new Error(`baseline: ${baseline.status}`);
    expect(baseline.baseline.dirty).toContainEqual(expect.objectContaining({ path: 'flip.txt', state: 'present', mode: '100644' }));

    await unlink(join(root, 'flip.txt'));
    await symlink('target-elsewhere', join(root, 'flip.txt'));
    const captured = await captureWorkspaceChange({ root, deniedPrefixes: [], baseline: baseline.baseline });
    if (captured.status !== 'captured') throw new Error(`capture: ${captured.status}`);
    expect(captured.capture.changed).toEqual([{ path: 'flip.txt', change: 'mode_changed' }]);
  });

  it('K3-40 (iv) a file whose executable bit changed in the Run is mode_changed', async () => {
    const root = await gitWorkspace();
    await unlink(join(root, 'gone.txt'));
    const baseline = await readWorkspaceBaseline({ root, deniedPrefixes: [] });
    if (baseline.status !== 'captured') throw new Error(`baseline: ${baseline.status}`);
    expect(baseline.baseline.dirty).toEqual([{ path: 'gone.txt', state: 'deleted' }]);

    await chmod(join(root, 'exec.txt'), 0o755);
    const captured = await captureWorkspaceChange({ root, deniedPrefixes: [], baseline: baseline.baseline });
    if (captured.status !== 'captured') throw new Error(`capture: ${captured.status}`);
    expect(captured.capture.changed).toEqual([{ path: 'exec.txt', change: 'mode_changed' }]);
  });

  it('K3-40 (v) a file whose content changed in the Run is modified', async () => {
    const root = await gitWorkspace();
    await unlink(join(root, 'gone.txt'));
    const baseline = await readWorkspaceBaseline({ root, deniedPrefixes: [] });
    if (baseline.status !== 'captured') throw new Error(`baseline: ${baseline.status}`);
    expect(baseline.baseline.dirty).toEqual([{ path: 'gone.txt', state: 'deleted' }]);

    await writeFile(join(root, 'content.txt'), 'content after\n');
    const captured = await captureWorkspaceChange({ root, deniedPrefixes: [], baseline: baseline.baseline });
    if (captured.status !== 'captured') throw new Error(`capture: ${captured.status}`);
    expect(captured.capture.changed).toEqual([{ path: 'content.txt', change: 'modified' }]);
  });

  it('K3-40 (vi) a throwing baseline read keeps the manifest and the capture reports no run baseline', async () => {
    const root = await gitWorkspace();
    const source = { kind: 'plan-revision' as const, refId: 'plan-1', revision: 'r1' };
    const baselineRef: ArtifactRef = { kind: 'artifact', contentType: 'application/vnd.platform.workspace-baseline+json',
      digest: 'a'.repeat(64), sizeBytes: 10, source };
    const bundleRef: ArtifactRef = { kind: 'artifact', contentType: 'application/vnd.platform.prepared-execution+json',
      digest: 'b'.repeat(64), sizeBytes: 20, source };
    const runRef = { aggregateType: 'Run' as const, projectId: 'p', goalId: 'g', runId: 'run-1' };
    const reader: WorkspaceArtifactReader = { read: async (ref) => {
      if (ref.digest === bundleRef.digest) {
        return { status: 'ready', value: { body: JSON.stringify({ claim: { runRef }, sourceRefs: [source],
          workspaceBaseline: { status: 'captured', ref: baselineRef } }) } };
      }
      // The outer decoder must not drop the valid manifest when only the baseline read fails.
      throw new Error('the artifact store is closed');
    } };

    const read = await readWorkspaceBaselineFromBundle(reader, bundleRef);
    expect(read, 'a damaged baseline must not discard the manifest').not.toBeNull();
    expect(read?.manifest['claim']).toEqual({ runRef });
    expect(read?.baseline, 'a damaged baseline degrades to null').toBeNull();

    // What the composition root's `captureWorkspace` does with that read: it keeps the
    // manifest's runRef/sourceRefs, captures against a null baseline and reports
    // `runBaselineKnown: false` (never the "names no owning Run" read_failed).
    const captured = await captureWorkspaceChange({ root, deniedPrefixes: [], baseline: read?.baseline ?? null });
    if (captured.status !== 'captured') throw new Error(`capture: ${captured.status}`);
    expect(captured).toMatchObject({ status: 'captured', baselineKnown: false,
      capture: { runBaselineKnown: false } });
  });
});
