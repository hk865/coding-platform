import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { WorkspaceSourceApplicability, materialSourcePinIsCurrent } from '../../src/data/workspace-reader/source-applicability.js';
import type { MaterialSourcePinV1 } from '../../src/contracts/material-access.js';
import { filesystemSourceAccess } from './source-applicability-fixture.js';

const scope = { projectId: 'project-source', workspaceId: 'workspace-source' };
const sourceSet = { kind: 'workspace_paths' as const, paths: ['src'] };
const git = promisify(execFile);
const pinOf = (result: Awaited<ReturnType<WorkspaceSourceApplicability['capture']>>): MaterialSourcePinV1 => {
  if (result.status !== 'sourced') throw Error(JSON.stringify(result));
  return result.pin;
};

it('pins real selected files and detects edits, additions, deletion, rename and Git identity changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'material-source-files-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/main.ts'), 'export const value = 1;\n');
    await writeFile(join(root, 'README.md'), 'outside selected source set');
    const access = filesystemSourceAccess(root);
    const source = new WorkspaceSourceApplicability(s => s.projectId === scope.projectId && s.workspaceId === scope.workspaceId ? access : null);
    const original = pinOf(await source.capture({ ...scope, sourceSet }));
    expect(original.identity.commit).toBeNull();
    expect(await materialSourcePinIsCurrent(source, original, scope)).toBe(true);
    await writeFile(join(root, 'README.md'), 'unrelated source outside selected set changed');
    expect(await materialSourcePinIsCurrent(source, original, scope)).toBe(true);
    await writeFile(join(root, 'src/main.ts'), 'export const value = 2;\n');
    expect(await materialSourcePinIsCurrent(source, original, scope)).toBe(false);
    await writeFile(join(root, 'src/main.ts'), 'export const value = 1;\n');
    expect(await materialSourcePinIsCurrent(source, original, scope)).toBe(true);
    await writeFile(join(root, 'src/new.ts'), 'new source');
    expect(await materialSourcePinIsCurrent(source, original, scope)).toBe(false);
    const beforeRename = pinOf(await source.capture({ ...scope, sourceSet }));
    await rename(join(root, 'src/new.ts'), join(root, 'src/renamed.ts'));
    expect(await materialSourcePinIsCurrent(source, beforeRename, scope)).toBe(false);
    await rm(join(root, 'src/renamed.ts'));
    expect(await materialSourcePinIsCurrent(source, original, scope)).toBe(true);
    await git('git', ['init', root]);
    await git('git', ['-C', root, 'add', 'src/main.ts']);
    await git('git', ['-C', root, '-c', 'user.name=Source Test', '-c', 'user.email=source@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'test source identity']);
    expect(await materialSourcePinIsCurrent(source, original, scope)).toBe(false);
    const committed = pinOf(await source.capture({ ...scope, sourceSet }));
    expect(committed.identity.commit).toMatch(/^[a-f0-9]{40,64}$/);
    await git('git', ['-C', root, '-c', 'user.name=Source Test', '-c', 'user.email=source@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'new source baseline']);
    expect(await materialSourcePinIsCurrent(source, committed, scope)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);

it('fails closed for unavailable capabilities, wrong scope, unsafe selections, incomplete inventory and changing reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'material-source-denial-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/main.py'), 'value = 1\n');
    const access = filesystemSourceAccess(root);
    const source = new WorkspaceSourceApplicability(s => s.projectId === scope.projectId && s.workspaceId === scope.workspaceId ? access : null);
    const original = pinOf(await source.capture({ ...scope, sourceSet }));
    expect(await materialSourcePinIsCurrent(undefined, original, scope)).toBe(false);
    expect(await materialSourcePinIsCurrent(source, original, { ...scope, workspaceId: 'elsewhere' })).toBe(false);
    expect(await materialSourcePinIsCurrent(source, { ...original, identity: { ...original.identity, workspace: 'different-physical-workspace' } }, scope)).toBe(false);
    expect(await materialSourcePinIsCurrent(source, { ...original, projectId: 'elsewhere' }, { ...scope, projectId: 'elsewhere' })).toBe(false);
    expect(await source.capture({ ...scope, sourceSet: { ...sourceSet, paths: ['../other'] } })).toMatchObject({ status: 'rejected' });
    expect(await source.capture({ ...scope, sourceSet: { ...sourceSet, paths: ['src', 'src'] } })).toMatchObject({ status: 'rejected' });
    expect(await source.capture({ ...scope, sourceSet: { ...sourceSet, paths: ['missing'] } })).toMatchObject({ status: 'unavailable' });
    expect(await new WorkspaceSourceApplicability(() => ({ ...access, inventory: async () => ({ paths: ['src/main.py'], truncated: true }) })).capture({ ...scope, sourceSet })).toMatchObject({ status: 'unavailable' });
    expect(await new WorkspaceSourceApplicability(() => ({ ...access, allowed: () => false })).capture({ ...scope, sourceSet })).toMatchObject({ status: 'unavailable' });
    let reads = 0;
    const changing = new WorkspaceSourceApplicability(() => ({ ...access, read: async (path, max) => { const result = await access.read(path, max); if (++reads === 1) await writeFile(join(root, path), 'value = 2\n'); return result; } }));
    expect(await changing.capture({ ...scope, sourceSet })).toMatchObject({ status: 'stale' });
    expect(await materialSourcePinIsCurrent({ capture: async () => { throw Error('provider offline'); } }, original, scope)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);
