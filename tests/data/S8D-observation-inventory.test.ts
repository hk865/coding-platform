/**
 * §10 items 1–2 through the real public seam: real temporary directories, real git
 * commands (temp dirs only, never this repository) and the real WorkspaceSandbox.
 */
import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as ts from 'typescript';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import { captureObservationSource, sha256Text } from '../../src/core/workspace/project-source-snapshot.js';
import {
  git,
  gitEnv,
  observe,
  open,
  projectAccessOf,
  tempRoot,
  write,
  type ObservationWorld,
} from '../helpers/observation-source-fixture.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const workspace: WorkspaceRef = {
  aggregateType: 'Workspace', projectId: 's8d-observation-project', workspaceId: 'workspace-main',
};

const world: ObservationWorld = {
  workspace,
  actor: { kind: 'human', id: 'observation-reader' },
  workspaceRevision: 7,
  subjectKey: 'host:observation-reader',
  permissionRevision: 'read-policy-1',
};

it('§11.4 records a Host-denied ignored database as configSkipped, not as a language issue', async () => {
  const root = await tempRoot('s8d-observation-inventory-', roots);
  const database = '[{"directory":".","file":"a.cpp","arguments":["cc","-c","a.cpp"]}]\n';
  await write(join(root, '.gitignore'), 'build/\n');
  await write(join(root, 'a.cpp'), 'int main() { return 0; }\n');
  await write(join(root, 'build/compile_commands.json'), database);
  await write(join(root, 'build/p1/compile_commands.json'), database);
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'observation@example.test');
  await git(root, 'config', 'user.name', 'Observation Test');
  await git(root, 'add', '.gitignore', 'a.cpp');
  await git(root, 'commit', '-qm', 'fixture');

  const observed = await observe(world, root, path => path !== 'build/p1/compile_commands.json');
  expect([...observed.configOnly.keys()]).toEqual(['build/compile_commands.json']);
  expect(observed.configSkipped).toEqual([
    { path: 'build/p1/compile_commands.json', reason: 'source unavailable, denied or exceeds file capacity' },
  ]);
  expect(observed.skipped).toEqual([]);
});

it('§11.4 leaves the digest byte-identical to today when no ignored database exists', async () => {
  const root = await tempRoot('s8d-observation-inventory-', roots);
  await write(join(root, 'README.md'), 'project\n');
  await write(join(root, 'src/a.ts'), 'export const a = 1;\n');
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'observation@example.test');
  await git(root, 'config', 'user.name', 'Observation Test');
  await git(root, 'add', 'README.md', 'src/a.ts');
  await git(root, 'commit', '-qm', 'fixture');

  const observed = await observe(world, root);
  expect(observed.configOnly.size).toBe(0);
  expect(observed.configSkipped).toEqual([]);
  expect(observed.snapshot).toBe(todaySnapshot(observed.identity,
    [...observed.files.values()].map(file => [file.path, file.digest]),
    observed.skipped.map(skip => [skip.path, skip.reason])));
});

it('§11.4 gives an ordinary compile_commands.json the separate 32 MiB limit, then skips it as over capacity', async () => {
  const root = await tempRoot('s8d-observation-inventory-', roots);
  await write(join(root, 'a.ts'), 'export const a = 1;\n');
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'observation@example.test');
  await git(root, 'config', 'user.name', 'Observation Test');
  await git(root, 'add', 'a.ts');
  await git(root, 'commit', '-qm', 'fixture');

  // 3 MiB is above the ordinary 2 MiB per-file limit but below the database limit: it is read.
  await writeFile(join(root, 'compile_commands.json'), Buffer.alloc(3 * 1024 * 1024, 0x61));
  const readable = await observe(world, root);
  expect([...readable.files.values()].map(file => file.path)).toEqual(['a.ts', 'compile_commands.json']);
  expect(readable.skipped).toEqual([]);

  // 33 MiB is over the database limit; the sandbox rejects by stat before reading the body.
  await writeFile(join(root, 'compile_commands.json'), Buffer.alloc(33 * 1024 * 1024, 0x61));
  const observed = await observe(world, root);
  expect([...observed.files.values()].map(file => file.path)).toEqual(['a.ts']);
  expect(observed.skipped).toEqual([{ path: 'compile_commands.json', reason: 'source exceeds file capacity' }]);
  expect(observed.configOnly.size).toBe(0);
});

it('§10 item 1 fails the whole observation as capacity past 60,000 Git records, reporting the count', async () => {
  const root = await tempRoot('s8d-observation-inventory-', roots);
  await git(root, 'init', '-q');
  const emptyBlob = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
  const indexInfo = Array.from({ length: 60001 }, (_, index) =>
    `100644 ${emptyBlob}\tfile${String(index).padStart(5, '0')}\n`).join('');
  const indexed = spawnSync('git', ['update-index', '--add', '--index-info'], { cwd: root, env: gitEnv, input: indexInfo });
  expect(indexed.status).toBe(0);

  const access = await open(world, root);
  try {
    await expect(captureObservationSource(projectAccessOf(access), new AbortController().signal)).rejects.toMatchObject({
      status: 'capacity', message: expect.stringContaining('(reached 60001)'),
    });
  } finally { await access.release(); }
});

// Keep the locally recomputed formula import honest: today's digest implementation hashes the
// TypeScript engine version, so a test that recomputes the formula uses the same source.
const todaySnapshot = (
  identity: { workspace: string; commit: string | null },
  sources: [string, string][],
  skipped: [string, string][],
) => sha256Text(JSON.stringify({ engine: ts.version, identity, sources, skipped }));
