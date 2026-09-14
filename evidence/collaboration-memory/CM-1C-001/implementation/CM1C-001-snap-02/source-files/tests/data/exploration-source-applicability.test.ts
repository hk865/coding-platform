import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExplorationSourceApplicability, explorationSourceDigest } from '../../src/data/workspace-reader/exploration-source.js';
import { materialSourcePinIsCurrent } from '../../src/data/workspace-reader/source-applicability.js';

it('re-reads the complete exploration tree and detects changes outside ordinary code fingerprint roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-pin-'));
  try {
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist', 'source.bin'), Buffer.from([0, 1, 2]));
    const scope = { projectId: 'project', workspaceId: 'workspace' };
    const source = new ExplorationSourceApplicability((p, w) => { if (p !== scope.projectId || w !== scope.workspaceId) throw Error('wrong scope'); return root; });
    const captured = await source.capture({ ...scope, sourceSet: { kind: 'workspace_paths', paths: ['.'] } });
    expect(captured.status).toBe('sourced');
    if (captured.status !== 'sourced') throw Error('missing pin');
    expect(captured.pin.manifestDigest).toBe(await explorationSourceDigest(root));
    expect(await materialSourcePinIsCurrent(source, captured.pin, scope)).toBe(true);
    await writeFile(join(root, 'dist', 'source.bin'), Buffer.from([0, 1, 3]));
    expect(await materialSourcePinIsCurrent(source, captured.pin, scope)).toBe(false);
    expect(await source.capture({ ...scope, sourceSet: { kind: 'workspace_paths', paths: ['dist'] } })).toMatchObject({ status: 'rejected' });
    expect(await materialSourcePinIsCurrent(source, captured.pin, { ...scope, workspaceId: 'other' })).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
