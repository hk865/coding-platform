import { afterEach, expect, it } from 'vitest';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as ts from 'typescript';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import {
  createWorkspaceAccessFactory,
  type WorkspaceHostBindings,
  type WorkspaceReadAccess,
} from '../../src/core/workspace/access.js';
import {
  captureObservationSource,
  sha256Text,
  type ProjectSourceAccess,
} from '../../src/core/workspace/project-source-snapshot.js';

// §10 items 1–2 through the real public seam: real temporary directories, real git
// commands (temp dirs only, never this repository) and the real WorkspaceSandbox.
const run = promisify(execFile);
const roots: string[] = [];
const accesses = new Set<WorkspaceReadAccess>();
const signal = () => new AbortController().signal;

afterEach(async () => {
  await Promise.allSettled([...accesses].map(access => access.release()));
  accesses.clear();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function tempRoot(prefix = 's8d-observation-inventory-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
async function git(cwd: string, ...args: string[]): Promise<void> {
  await run('git', args, { cwd, env: gitEnv });
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}

const workspace: WorkspaceRef = {
  aggregateType: 'Workspace', projectId: 's8d-observation-project', workspaceId: 'workspace-main',
};

function context(): CoreCallContext {
  const actor = { kind: 'human' as const, id: 'observation-reader' };
  return {
    projectId: workspace.projectId,
    workspaceId: workspace.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor },
    signal: signal(),
  };
}

function bindingsFor(root: string, allowsRead: (path: string) => boolean = () => true): WorkspaceHostBindings {
  return {
    resolveRoot: async ref => ref.projectId === workspace.projectId && ref.workspaceId === workspace.workspaceId
      ? { status: 'ready', value: { root, workspaceRevision: 7 } }
      : { status: 'rejected', code: 'not_found', reason: 'Unknown test workspace' },
    authorize: async (ctx, ref) => ctx.projectId === ref.projectId && ctx.workspaceId === ref.workspaceId
      ? { status: 'ready', value: { subjectKey: 'host:observation-reader', permissionRevision: 'read-policy-1', allowsRead } }
      : { status: 'rejected', code: 'forbidden', reason: 'Reader scope does not match workspace' },
  };
}

async function open(root: string, allowsRead?: (path: string) => boolean): Promise<WorkspaceReadAccess> {
  const factory = createWorkspaceAccessFactory(bindingsFor(root, allowsRead));
  const opened = await factory.open(context(), workspace);
  if (opened.status !== 'ready') throw new Error(`Expected readable workspace: ${opened.code}: ${opened.reason}`);
  accesses.add(opened.value);
  return opened.value;
}

/** The production adapter shape (`capture.ts` `projectAccess`) plus the two new optional seams. */
function projectAccessOf(access: WorkspaceReadAccess): ProjectSourceAccess {
  return {
    allowed: path => access.authorization.allowsRead(path),
    read: (path, maxBytes) => access.read(path, maxBytes),
    inventory: () => access.listFiles(60000),
    sourceIdentity: () => access.sourceIdentity(),
    ...(access.hostRoot === undefined ? {} : { hostRoot: access.hostRoot }),
    listObservationFiles: listed => access.listObservationFiles!(listed),
    listIgnoredCompileDatabases: listed => access.listIgnoredCompileDatabases!(listed),
  };
}

async function observe(root: string, allowsRead?: (path: string) => boolean) {
  const access = await open(root, allowsRead);
  try { return await captureObservationSource(projectAccessOf(access), signal()); }
  finally { await access.release(); }
}

it('A-07 inventories git non-ignored files only: no ignored, deleted or symlink paths', async () => {
  const root = await tempRoot();
  await write(join(root, '.gitignore'), 'node_modules/\ndist/\n');
  await write(join(root, 'src/tracked.ts'), 'export const tracked = 1;\n');
  await write(join(root, 'src/deleted.ts'), 'export const deleted = 1;\n');
  await write(join(root, 'src/untracked.ts'), 'export const untracked = 1;\n');
  await write(join(root, 'node_modules/x.ts'), 'export const ignored = 1;\n');
  await write(join(root, 'dist/z.ts'), 'export const built = 1;\n');
  await symlink(join(root, 'src/tracked.ts'), join(root, 'tracked-link.ts'));
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'observation@example.test');
  await git(root, 'config', 'user.name', 'Observation Test');
  await git(root, 'add', '.gitignore', 'src/tracked.ts', 'src/deleted.ts', 'tracked-link.ts');
  await git(root, 'commit', '-qm', 'fixture');
  await rm(join(root, 'src/deleted.ts'));

  const observed = await observe(root);
  expect(observed.inventory).toEqual({ source: 'git', reason: null });
  expect([...observed.files.values()].map(file => file.path)).toEqual(['.gitignore', 'src/tracked.ts', 'src/untracked.ts']);
  expect(observed.skipped).toEqual([]);
  expect([...observed.configOnly.keys()]).toEqual([]);
  expect(observed.configSkipped).toEqual([]);

  const before = observed.snapshot;
  await write(join(root, 'src/untracked.ts'), 'export const untracked = 2;\n');
  expect((await observe(root)).snapshot).not.toBe(before);
});

it('A-07 keeps paths relative to a workspace root that is a subdirectory of the repository', async () => {
  const repo = await tempRoot();
  await write(join(repo, '.gitignore'), 'dist/\n');
  await write(join(repo, 'top.ts'), 'export const top = 1;\n');
  await write(join(repo, 'sub/a.ts'), 'export const a = 1;\n');
  await write(join(repo, 'sub/dist/z.ts'), 'export const built = 1;\n');
  await write(join(repo, 'sub/b.ts'), 'export const b = 1;\n');
  await git(repo, 'init', '-q');
  await git(repo, 'config', 'user.email', 'observation@example.test');
  await git(repo, 'config', 'user.name', 'Observation Test');
  await git(repo, 'add', '.gitignore', 'top.ts', 'sub/a.ts');
  await git(repo, 'commit', '-qm', 'fixture');

  const observed = await observe(join(repo, 'sub'));
  expect(observed.inventory).toEqual({ source: 'git', reason: null });
  expect([...observed.files.values()].map(file => file.path)).toEqual(['a.ts', 'b.ts']);
  expect([...observed.files.keys()].every(path => path.startsWith('/workspace/'))).toBe(true);
});

it('A-08 falls back to the fixed skip list outside git: node_modules and nested .venv are pruned, dist stays', async () => {
  const root = await tempRoot();
  await write(join(root, 'node_modules/x.ts'), 'export const ignored = 1;\n');
  await write(join(root, 'a/b/.venv/y.py'), 'ignored = 1\n');
  await write(join(root, 'dist/z.ts'), 'export const built = 1;\n');
  await write(join(root, 'build/compile_commands.json'), '[{"directory":".","file":"z.cpp","arguments":["cc","-c","z.cpp"]}]\n');
  await write(join(root, 'a/keep.ts'), 'export const keep = 1;\n');
  await write(join(root, '.git/config'), '[core]\n');

  const observed = await observe(root);
  expect(observed.inventory).toEqual({ source: 'skip_list', reason: '不是 git 仓库' });
  expect([...observed.files.values()].map(file => file.path))
    .toEqual(['a/keep.ts', 'build/compile_commands.json', 'dist/z.ts']);
  expect(observed.skipped).toEqual([]);
  expect([...observed.configOnly.keys()]).toEqual([]);
});

it('§11.4 freezes ignored compile databases as config only and keeps their bytes in the digest', async () => {
  const root = await tempRoot();
  const database = '[{"directory":".","file":"a.cpp","arguments":["cc","-c","a.cpp"]}]\n';
  const second = '[{"directory":".","file":"b.cpp","arguments":["cc","-c","b.cpp"]}]\n';
  await write(join(root, '.gitignore'), 'build/\nnode_modules/\n');
  await write(join(root, 'README.md'), 'project\n');
  await write(join(root, 'a.cpp'), 'int main() { return 0; }\n');
  await write(join(root, 'build/compile_commands.json'), database);
  await write(join(root, 'build/p1/compile_commands.json'), second);
  await write(join(root, 'build/bin/compile_commands.json'), 'binary\0database\n');
  await write(join(root, 'node_modules/pkg/compile_commands.json'), database);
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'observation@example.test');
  await git(root, 'config', 'user.name', 'Observation Test');
  await git(root, 'add', '.gitignore', 'README.md', 'a.cpp');
  await git(root, 'commit', '-qm', 'fixture');

  const observed = await observe(root);
  expect(observed.inventory).toEqual({ source: 'git', reason: null });
  expect([...observed.files.values()].map(file => file.path)).toEqual(['.gitignore', 'README.md', 'a.cpp']);
  expect(observed.skipped).toEqual([]);
  expect([...observed.configOnly.keys()]).toEqual(['build/compile_commands.json', 'build/p1/compile_commands.json']);
  expect(observed.configOnly.get('build/compile_commands.json')).toEqual({
    content: database, digest: createHash('sha256').update(database).digest('hex'),
  });
  expect(observed.configOnly.get('build/p1/compile_commands.json')).toEqual({
    content: second, digest: createHash('sha256').update(second).digest('hex'),
  });
  expect(observed.configSkipped).toEqual([{ path: 'build/bin/compile_commands.json', reason: 'binary source' }]);

  const baseline = observed.snapshot;
  await write(join(root, 'README.md'), 'project changed\n');
  expect((await observe(root)).snapshot).not.toBe(baseline);
  await write(join(root, 'README.md'), 'project\n');
  await write(join(root, 'build/p1/compile_commands.json'), second.replace('b.cpp', 'c.cpp'));
  expect((await observe(root)).snapshot).not.toBe(baseline);
});

it('§11.4 records a Host-denied ignored database as configSkipped, not as a language issue', async () => {
  const root = await tempRoot();
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

  const observed = await observe(root, path => path !== 'build/p1/compile_commands.json');
  expect([...observed.configOnly.keys()]).toEqual(['build/compile_commands.json']);
  expect(observed.configSkipped).toEqual([
    { path: 'build/p1/compile_commands.json', reason: 'source unavailable, denied or exceeds file capacity' },
  ]);
  expect(observed.skipped).toEqual([]);
});

it('§11.4 leaves the digest byte-identical to today when no ignored database exists', async () => {
  const root = await tempRoot();
  await write(join(root, 'README.md'), 'project\n');
  await write(join(root, 'src/a.ts'), 'export const a = 1;\n');
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'observation@example.test');
  await git(root, 'config', 'user.name', 'Observation Test');
  await git(root, 'add', 'README.md', 'src/a.ts');
  await git(root, 'commit', '-qm', 'fixture');

  const observed = await observe(root);
  expect(observed.configOnly.size).toBe(0);
  expect(observed.configSkipped).toEqual([]);
  expect(observed.snapshot).toBe(todaySnapshot(observed.identity,
    [...observed.files.values()].map(file => [file.path, file.digest]),
    observed.skipped.map(skip => [skip.path, skip.reason])));
});

it('§11.4 gives an ordinary compile_commands.json the separate 32 MiB limit, then skips it as over capacity', async () => {
  const root = await tempRoot();
  await write(join(root, 'a.ts'), 'export const a = 1;\n');
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'observation@example.test');
  await git(root, 'config', 'user.name', 'Observation Test');
  await git(root, 'add', 'a.ts');
  await git(root, 'commit', '-qm', 'fixture');

  // 3 MiB is above the ordinary 2 MiB per-file limit but below the database limit: it is read.
  await writeFile(join(root, 'compile_commands.json'), Buffer.alloc(3 * 1024 * 1024, 0x61));
  const readable = await observe(root);
  expect([...readable.files.values()].map(file => file.path)).toEqual(['a.ts', 'compile_commands.json']);
  expect(readable.skipped).toEqual([]);

  // 33 MiB is over the database limit; the sandbox rejects by stat before reading the body.
  await writeFile(join(root, 'compile_commands.json'), Buffer.alloc(33 * 1024 * 1024, 0x61));
  const observed = await observe(root);
  expect([...observed.files.values()].map(file => file.path)).toEqual(['a.ts']);
  expect(observed.skipped).toEqual([{ path: 'compile_commands.json', reason: 'source exceeds file capacity' }]);
  expect(observed.configOnly.size).toBe(0);
});

it('§10 item 1 fails the whole observation as capacity past 60,000 Git records, reporting the count', async () => {
  const root = await tempRoot();
  await git(root, 'init', '-q');
  const emptyBlob = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
  const indexInfo = Array.from({ length: 60001 }, (_, index) =>
    `100644 ${emptyBlob}\tfile${String(index).padStart(5, '0')}\n`).join('');
  const indexed = spawnSync('git', ['update-index', '--add', '--index-info'], { cwd: root, env: gitEnv, input: indexInfo });
  expect(indexed.status).toBe(0);

  const access = await open(root);
  try {
    await expect(captureObservationSource(projectAccessOf(access), signal())).rejects.toMatchObject({
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
