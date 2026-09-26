/**
 * R2e.2 Git fixed-version read/compare skeleton acceptance (middle-review rework).
 *
 * Every temporary Git repository is built by this test with real `git init/add/commit`; the
 * production path under test is the real trusted Host bindings -> createWorkspaceAccessFactory
 * -> createWorkspaceTools registry and the real `project_source` tool schema. At this skeleton
 * stage every legal Git request reaches the bound capability and stops at its explicit
 * `unsupported` seam, so the target-contract cases are RED exactly there. Cases that need no
 * Git object work (malformed OIDs, path/prefix, mixed pair, capture-pair prefix, local scope
 * mismatch, cancellation before open) are GREEN and prove the fail-closed boundary.
 *
 * The cancellation cases mock `node:child_process` only to throttle the real batch-check
 * child's stdin and spy on the real public `WorkspaceSandbox.acquireRootHandleForProcess`;
 * no child, argv, output or exit is fabricated.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { SourceCaptureRef } from '../../src/contracts/core/source.js';
import {
  createWorkspaceAccessFactory,
  type WorkspaceAccessFactory,
  type WorkspaceHostBindings,
} from '../../src/core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';
import { createProjectSourceTool, projectSourceInputSchema } from '../../src/core/agent-runtime/project-source-tool.js';
import type { GitWorkspaceComparison, WorkspaceComparisonRequest, WorkspaceResult, WorkspaceFile } from '../../src/core/workspace/ports.js';

// --- child/root observation harness -----------------------------------------
// The mock only wraps the real `spawn`; only this operation's `cat-file --batch-check` child
// has its stdin queued. Everything else (argv, stdout/stderr, exit) is the real process.
const gate = vi.hoisted(() => ({
  active: false,
  records: [] as Array<{ child: import('node:child_process').ChildProcess; release: () => void; closed: Promise<void> }>,
  waiters: [] as Array<() => void>,
  observedSpawns: null as Array<{ child: import('node:child_process').ChildProcess; closed: Promise<void>; didClose: boolean }> | null,
}));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const spawn = ((file: string, args: readonly string[], options?: object) => {
    const child = actual.spawn(file, args as string[], options as never);
    if (gate.observedSpawns !== null) {
      const observation = { child, closed: Promise.resolve(), didClose: false };
      observation.closed = new Promise<void>(resolve => child.once('close', () => {
        observation.didClose = true;
        resolve();
      }));
      gate.observedSpawns.push(observation);
    }
    if (gate.active && Array.isArray(args) && args.includes('cat-file') && args.includes('--batch-check') && child.stdin) {
      const stdin = child.stdin;
      const queue: Array<() => void> = [];
      const realWrite = stdin.write.bind(stdin) as (...a: unknown[]) => unknown;
      const realEnd = stdin.end.bind(stdin) as (...a: unknown[]) => unknown;
      let restored = false;
      const release = () => {
        if (restored) return;
        restored = true;
        if (!stdin.destroyed) for (const call of queue.splice(0)) call();
        (stdin as unknown as { write: unknown }).write = realWrite;
        (stdin as unknown as { end: unknown }).end = realEnd;
      };
      (stdin as unknown as { write: (...a: unknown[]) => unknown }).write = (...a: unknown[]) => { queue.push(() => { realWrite(...a); }); return true; };
      (stdin as unknown as { end: (...a: unknown[]) => unknown }).end = (...a: unknown[]) => { queue.push(() => { realEnd(...a); }); return stdin; };
      stdin.on('error', () => {});
      const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
      gate.records.push({ child, release, closed });
      for (const waiter of gate.waiters.splice(0)) waiter();
    }
    return child;
  }) as unknown as typeof actual.spawn;
  return { ...actual, spawn };
});

const exec = promisify(execFile);
const directories: string[] = [];
const handles: ReturnType<typeof createWorkspaceTools>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  // Bound each close: a regressed registry close must not hang the shared teardown.
  await Promise.allSettled(handles.splice(0).map(handle => withWatchdog(handle.close(), 'afterEach registry close', 5000)));
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

const runGit = async (root: string, args: string[]) => (await exec('git', ['-C', root, ...args], { windowsHide: true })).stdout;

function ready<T>(result: WorkspaceResult<T>): T {
  expect(result.status, JSON.stringify(result)).toBe('ready');
  if (result.status !== 'ready') throw Error(`${result.code}: ${result.reason}`);
  return result.value;
}
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'git-project', workspaceId: 'git-workspace' };

type GitFixture = {
  directory: string; root: string;
  git(args: string[]): Promise<string>;
  write(path: string, body: string | Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  commitAll(message: string): Promise<string>;
  lsTree(commit: string, path: string): Promise<{ mode: string; objectId: string }>;
  context(signal?: AbortSignal): CoreCallContext;
  read(ctx: CoreCallContext, commit: string, path: string, maxBytes?: number): Promise<WorkspaceResult<WorkspaceFile>>;
  compare(ctx: CoreCallContext, before: string, after: string, prefix?: string): Promise<WorkspaceResult<GitWorkspaceComparison>>;
  readWorkingTree(ctx: CoreCallContext, path: string): Promise<WorkspaceResult<WorkspaceFile>>;
  handle: ReturnType<typeof createWorkspaceTools>;
  tools: ReturnType<typeof createWorkspaceTools>['tools'];
  state: { granted: boolean; opens: number; releases: number; beforeOpen: ((n: number) => Promise<void> | void) | undefined };
};

/** A real repo plus the real Host-bound registry. `root` may point at an existing linked worktree. */
async function fixture(options: { allowsRead?: (path: string) => boolean; root?: string; objectFormat?: 'sha1' | 'sha256' } = {}): Promise<GitFixture> {
  let directory: string, root: string;
  if (options.root === undefined) {
    directory = await mkdtemp(join(tmpdir(), 'r2e-git-operations-'));
    directories.push(directory);
    root = join(directory, 'workspace');
    await mkdir(root);
    await runGit(root, ['init', '-q', `--object-format=${options.objectFormat ?? 'sha1'}`]);
  } else {
    root = options.root;
    directory = dirname(root);
  }
  await runGit(root, ['config', 'user.name', 'R2e Git test']);
  await runGit(root, ['config', 'user.email', 'r2e@example.invalid']);
  const allowsRead = options.allowsRead ?? (() => true);
  const state: GitFixture['state'] = { granted: true, opens: 0, releases: 0, beforeOpen: undefined };
  const context = (signal = new AbortController().signal): CoreCallContext => {
    const actor = { kind: 'human' as const, id: 'git-reader' };
    return { projectId: workspace.projectId, workspaceId: workspace.workspaceId,
      principal: { kind: 'host', actor },
      materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor }, signal };
  };
  const bindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'not_found', reason: 'Unknown test workspace' };
    },
    async authorize(ctx, requested) {
      if (!state.granted || ctx.projectId !== workspace.projectId || ctx.workspaceId !== workspace.workspaceId
          || requested.projectId !== workspace.projectId || requested.workspaceId !== workspace.workspaceId)
        return { status: 'rejected', code: 'forbidden', reason: 'No current test read grant' };
      return { status: 'ready', value: { subjectKey: 'human:git-reader', permissionRevision: 'r2e-git@1', allowsRead } };
    },
  };
  const real = createWorkspaceAccessFactory(bindings);
  const access: WorkspaceAccessFactory = {
    async open(ctx, requested) {
      state.opens++;
      await state.beforeOpen?.(state.opens);
      const opened = await real.open(ctx, requested);
      if (opened.status !== 'ready') return opened;
      const value = opened.value;
      return { status: 'ready', value: { ...value, async release() { state.releases++; await value.release(); } } };
    },
  };
  const handle = createWorkspaceTools({ access, now: () => '2026-09-26T00:00:00.000Z', limits: DEFAULT_WORKSPACE_LIMITS });
  handles.push(handle);
  const write = async (path: string, body: string | Uint8Array) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  };
  const commitAll = async (message: string) => {
    await runGit(root, ['add', '-A']);
    await runGit(root, ['-c', 'user.name=R2e Git test', '-c', 'user.email=r2e@example.invalid', 'commit', '-q', '-m', message]);
    return (await runGit(root, ['rev-parse', 'HEAD'])).trim();
  };
  const lsTree = async (commit: string, path: string) => {
    const out = (await runGit(root, ['ls-tree', '-z', commit, '--', path])).replace(/\0$/, '');
    const match = /^([0-9]{6}) blob ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(out);
    if (!match) throw Error(`Unexpected ls-tree for ${commit}:${path}: ${JSON.stringify(out)}`);
    return { mode: match[1]!, objectId: match[2]! };
  };
  const read = (ctx: CoreCallContext, commit: string, path: string, maxBytes = 8192) =>
    handle.tools.readWorkspace(ctx, { workspace, path, maxBytes, version: { kind: 'git', commit } });
  const compare = (ctx: CoreCallContext, before: string, after: string, prefix?: string) =>
    handle.tools.compareWorkspace(ctx, { workspace, before: { kind: 'git', commit: before }, after: { kind: 'git', commit: after },
      ...(prefix !== undefined ? { prefix } : {}) }) as Promise<WorkspaceResult<GitWorkspaceComparison>>;
  const readWorkingTree = (ctx: CoreCallContext, path: string) =>
    handle.tools.readWorkspace(ctx, { workspace, path, maxBytes: 8192, version: { kind: 'working_tree' } });
  return { directory, root, git: args => runGit(root, args), write, remove: path => rm(join(root, path)),
    commitAll, lsTree, context, read, compare, readWorkingTree, handle, tools: handle.tools, state };
}

// --- 1. exact historical raw bytes ------------------------------------------
for (const objectFormat of ['sha1', 'sha256'] as const) {
  it(`reads exact historical raw bytes (BOM) in a real ${objectFormat} repository despite later dirty/deleted worktree`, async () => {
    const f = await fixture({ objectFormat });
    const bomText = 'first history\n';
    const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(bomText)]);
    // U+FEFF is data in a filename; unlike a text-body BOM it must never be stripped.
    const bomName = '\ufeffidentity.txt';
    const plainName = 'identity.txt';
    await f.write(bomName, 'BOM-prefixed filename first\n');
    await f.write(plainName, 'plain filename first\n');
    await f.write('docs/history.txt', bomBytes);
    await f.write('docs/deleted.txt', 'historical deleted body\n');
    await f.write('docs/dirty.txt', 'committed base\n');
    const first = await f.commitAll('first');
    await f.write(bomName, 'BOM-prefixed filename second\n');
    await f.write(plainName, 'plain filename second\n');
    await f.write('docs/history.txt', 'second history\n');
    await f.write('docs/dirty.txt', 'committed second\n');
    await f.remove('docs/deleted.txt');
    const second = await f.commitAll('second');
    // After the last commit: an untracked file and a dirty tracked file; deleted.txt is gone at HEAD.
    await f.write('docs/untracked.txt', 'untracked bytes\n');
    await f.write('docs/dirty.txt', 'dirty working tree\n');

    expect(first).toHaveLength(objectFormat === 'sha256' ? 64 : 40);
    const bom = ready(await f.read(f.context(), first, 'docs/history.txt'));
    expect(bom).toEqual({
      path: 'docs/history.txt', content: bomText, digest: sha256(bomBytes), sizeBytes: bomBytes.byteLength,
      digestBasis: 'raw_bytes', version: { kind: 'git', commit: first }, readAt: '2026-09-26T00:00:00.000Z',
    });
    expect(ready(await f.read(f.context(), first, 'docs/deleted.txt')).content).toBe('historical deleted body\n');
    expect(ready(await f.read(f.context(), second, 'docs/history.txt')).content).toBe('second history\n');
    for (const [path, firstBody, secondBody] of [
      [bomName, 'BOM-prefixed filename first\n', 'BOM-prefixed filename second\n'],
      [plainName, 'plain filename first\n', 'plain filename second\n'],
    ] as const) {
      expect(ready(await f.read(f.context(), first, path))).toMatchObject({ path, content: firstBody });
      expect(ready(await f.read(f.context(), second, path))).toMatchObject({ path, content: secondBody });
    }
    const identityChanges = ready(await f.compare(f.context(), first, second)).changes
      .filter(change => change.path.endsWith('identity.txt'));
    expect(identityChanges).toHaveLength(2);
    expect(identityChanges).toEqual(expect.arrayContaining([
      { kind: 'modified', path: bomName, before: await f.lsTree(first, bomName), after: await f.lsTree(second, bomName) },
      { kind: 'modified', path: plainName, before: await f.lsTree(first, plainName), after: await f.lsTree(second, plainName) },
    ]));
    // A full OID in the wrong object format is rejected, not silently accepted or peeled.
    const wrongFormat = objectFormat === 'sha256' ? 'a'.repeat(40) : 'a'.repeat(64);
    expect(await f.read(f.context(), wrongFormat, 'docs/history.txt')).toMatchObject({ status: 'rejected', code: 'invalid' });
    // Working-tree reads keep their current behavior and actual bytes.
    expect(ready(await f.readWorkingTree(f.context(), 'docs/dirty.txt')).content).toBe('dirty working tree\n');
    expect(await f.readWorkingTree(f.context(), 'docs/deleted.txt')).toMatchObject({ status: 'rejected', code: 'not_found' });
  });
}

// --- 2. real tree comparison ------------------------------------------------
it('compares two real Git trees by blob OID and mode, including mode-only, binary and prefix exclusion', async () => {
  const f = await fixture();
  await f.write('docs/gone.txt', 'gone\n');
  await f.write('docs/mod.txt', 'old\n');
  await f.write('docs/mode.sh', '#!/bin/sh\necho hi\n');
  await f.write('docs/binary.bin', Buffer.from([0, 1, 2, 3]));
  await f.write('docs/unique-old.txt', 'unique rename body\n');
  await f.write('docs/dup-old.txt', 'duplicate body\n');
  await f.write('docs-old/legacy.txt', 'legacy base\n');
  const before = await f.commitAll('before');
  const beforeIds = {
    gone: await f.lsTree(before, 'docs/gone.txt'), mod: await f.lsTree(before, 'docs/mod.txt'),
    mode: await f.lsTree(before, 'docs/mode.sh'), binary: await f.lsTree(before, 'docs/binary.bin'),
    uniqueOld: await f.lsTree(before, 'docs/unique-old.txt'), dupOld: await f.lsTree(before, 'docs/dup-old.txt'),
  };

  await f.remove('docs/gone.txt');
  await f.write('docs/mod.txt', 'new\n');
  await chmod(join(f.root, 'docs/mode.sh'), 0o755);
  await f.write('docs/binary.bin', Buffer.from([0, 1, 2, 4]));
  await f.remove('docs/unique-old.txt');
  await f.write('docs/unique-new.txt', 'unique rename body\n');
  await f.remove('docs/dup-old.txt');
  await f.write('docs/dup-new.txt', 'duplicate body\n');
  await f.write('docs/added.txt', 'added\n');
  // A real change outside the `docs` prefix that the comparison must not include.
  await f.write('docs-old/legacy.txt', 'legacy changed\n');
  const after = await f.commitAll('after');
  const afterIds = {
    mod: await f.lsTree(after, 'docs/mod.txt'), mode: await f.lsTree(after, 'docs/mode.sh'),
    binary: await f.lsTree(after, 'docs/binary.bin'), uniqueNew: await f.lsTree(after, 'docs/unique-new.txt'),
    dupNew: await f.lsTree(after, 'docs/dup-new.txt'), added: await f.lsTree(after, 'docs/added.txt'),
  };

  const comparison = ready(await f.compare(f.context(), before, after, 'docs'));
  expect(comparison).toMatchObject({
    before: { kind: 'git', commit: before }, after: { kind: 'git', commit: after },
    scope: { kind: 'git_regular_files', selectionVersion: 'authorized-regular-blob-v1', prefix: 'docs' },
    comparison: 'git_tree_content_and_mode', complete: true,
  });
  const expected = [
    { kind: 'added', path: 'docs/added.txt', after: afterIds.added },
    { kind: 'modified', path: 'docs/binary.bin', before: beforeIds.binary, after: afterIds.binary },
    // Identical content under a new name is a plain add/delete, never a Git rename guess.
    { kind: 'added', path: 'docs/dup-new.txt', after: afterIds.dupNew },
    { kind: 'deleted', path: 'docs/dup-old.txt', before: beforeIds.dupOld },
    { kind: 'deleted', path: 'docs/gone.txt', before: beforeIds.gone },
    // Only the mode changed: the blob OID is identical and the mode-only delta must not be lost.
    { kind: 'modified', path: 'docs/mode.sh', before: beforeIds.mode, after: afterIds.mode },
    { kind: 'modified', path: 'docs/mod.txt', before: beforeIds.mod, after: afterIds.mod },
    { kind: 'added', path: 'docs/unique-new.txt', after: afterIds.uniqueNew },
    { kind: 'deleted', path: 'docs/unique-old.txt', before: beforeIds.uniqueOld },
  ];
  expect(comparison.changes).toHaveLength(expected.length);
  expect(comparison.changes).toEqual(expect.arrayContaining(expected));
  expect(comparison.changes.map(change => change.kind as string)).not.toContain('renamed');
  expect(comparison.changes.some(change => change.path.startsWith('docs-old/'))).toBe(false);
  expect(beforeIds.mode.objectId).toBe(afterIds.mode.objectId);
  expect(beforeIds.mode.mode).toBe('100644');
  expect(afterIds.mode.mode).toBe('100755');
});

// --- 3. authorization and comparison scope ----------------------------------
it('applies the trusted read scope to historical paths and to an authorized comparison without leaking denied paths', async () => {
  const f = await fixture({ allowsRead: path => path.startsWith('public/') });
  await f.write('public/open.txt', 'public base\n');
  await f.write('private/hidden.txt', 'PRIVATE_BASE\n');
  const first = await f.commitAll('base');
  await f.write('public/open.txt', 'public changed\n');
  await f.write('private/hidden.txt', 'PRIVATE_CHANGED_MUST_NOT_LEAK\n');
  const second = await f.commitAll('changed');
  const privateOid = (await f.lsTree(second, 'private/hidden.txt')).objectId;

  expect(await f.read(f.context(), first, 'private/hidden.txt')).toMatchObject({ status: 'rejected', code: 'forbidden' });
  // A denied prefix comparison must not disclose the denied names or object ids.
  const deniedJson = JSON.stringify(await f.compare(f.context(), first, second, 'private'));
  expect(deniedJson).not.toContain('PRIVATE_CHANGED_MUST_NOT_LEAK');
  expect(deniedJson).not.toContain('private/hidden.txt');
  expect(deniedJson).not.toContain(privateOid);

  const comparison = ready(await f.compare(f.context(), first, second, 'public'));
  expect(comparison.scope).toMatchObject({ prefix: 'public' });
  expect(comparison.changes).toEqual([{ kind: 'modified', path: 'public/open.txt',
    before: { objectId: expect.any(String), mode: '100644' }, after: { objectId: expect.any(String), mode: '100644' } }]);
  expect(comparison.changes.every(change => change.path.startsWith('public/'))).toBe(true);
  expect(JSON.stringify(comparison)).not.toContain('private/hidden.txt');
  expect(JSON.stringify(comparison)).not.toContain(privateOid);

  f.state.granted = false;
  expect(await f.read(f.context(), first, 'public/open.txt')).toMatchObject({ status: 'rejected', code: 'forbidden' });
});

// --- 4. structural / scope rejection before any open ------------------------
it('rejects malformed OIDs, unsafe paths, mixed pairs, capture prefixes and local scope mismatch before any open', async () => {
  const f = await fixture();
  await f.write('docs/a.txt', 'a\n');
  const commit = await f.commitAll('base');
  const capture: SourceCaptureRef = { projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    captureId: 'capture-one', workspaceRevision: 1, sourceDigest: 'a'.repeat(64), configDigest: 'b'.repeat(64), indexVersion: 'workspace-text@1' };

  let opens = f.state.opens;
  for (const bad of ['HEAD', 'main', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), commit + ':docs/a.txt', '']) {
    expect(await f.read(f.context(), bad, 'docs/a.txt'), bad).toMatchObject({ status: 'rejected', code: 'invalid' });
  }
  for (const bad of ['../outside.txt', '/abs.txt', 'docs/./a.txt', 'docs\\a.txt', '']) {
    expect(await f.read(f.context(), commit, bad), bad).toMatchObject({ status: 'rejected', code: 'invalid' });
  }
  for (const maxBytes of [0, -1, 1.5, DEFAULT_WORKSPACE_LIMITS.maxFileBytes + 1]) {
    expect(await f.read(f.context(), commit, 'docs/a.txt', maxBytes), String(maxBytes)).toMatchObject({ status: 'rejected', code: 'invalid' });
  }
  expect(f.state.opens).toBe(opens);
  expect(JSON.stringify(await f.read(f.context(), commit, 'docs/a.txt'))).not.toContain('captureId');

  // Mixed pairs are explicitly unsupported, not silently reinterpreted.
  expect(await f.tools.compareWorkspace(f.context(), { workspace,
    before: { kind: 'git', commit }, after: { kind: 'capture', capture } })).toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(await f.tools.compareWorkspace(f.context(), { workspace,
    before: { kind: 'capture', capture }, after: { kind: 'git', commit } })).toMatchObject({ status: 'rejected', code: 'unsupported' });
  // The old capture/capture shape stays valid; a Git-only prefix on it is invalid; no prefix still reaches the core.
  expect(await f.tools.compareWorkspace(f.context(), { workspace,
    before: { kind: 'capture', capture }, after: { kind: 'capture', capture }, prefix: 'docs' })).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(await f.tools.compareWorkspace(f.context(), { workspace,
    before: { kind: 'capture', capture }, after: { kind: 'capture', capture } })).toMatchObject({ status: 'rejected', code: 'capture_expired' });
  // Two live working_tree versions are not a comparison; malformed Git pairs fail before access.
  expect(await f.tools.compareWorkspace(f.context(), { workspace,
    before: { kind: 'working_tree' }, after: { kind: 'working_tree' } } as unknown as WorkspaceComparisonRequest))
    .toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(await f.tools.compareWorkspace(f.context(), { workspace,
    before: { kind: 'git', commit: 'nope' }, after: { kind: 'git', commit } })).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(await f.tools.compareWorkspace(f.context(), { workspace,
    before: { kind: 'git', commit }, after: { kind: 'git', commit }, prefix: '../escape' })).toMatchObject({ status: 'rejected', code: 'invalid' });

  // A local ctx/scope mismatch is forbidden without opening an access (same memory check as working_tree).
  const scopeOpens = f.state.opens;
  const foreign = { ...f.context(), projectId: 'other-project' };
  expect(await f.read(foreign, commit, 'docs/a.txt')).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(await f.tools.compareWorkspace(foreign, { workspace,
    before: { kind: 'git', commit }, after: { kind: 'git', commit } })).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(f.state.opens).toBe(scopeOpens);
});

// --- 5. tool schema: capture pair + prefix ----------------------------------
it('rejects a capture/capture compare carrying a prefix at the tool schema before the deferred access opens', async () => {
  const capture: SourceCaptureRef = { projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    captureId: 'capture-one', workspaceRevision: 1, sourceDigest: 'a'.repeat(64), configDigest: 'b'.repeat(64), indexVersion: 'workspace-text@1' };
  let opens = 0;
  const tool = createProjectSourceTool({
    access: async () => { opens++; throw Error('deferred access must not open for invalid arguments'); },
    requireVisible: () => {},
  });
  const result = await tool.handler.execute(
    { schemaVersion: 1, callId: 'invalid-prefix', name: 'project_source',
      arguments: { action: 'compare', before: capture, after: capture, prefix: 'docs' } } as never,
    { signal: new AbortController().signal } as never,
  );
  expect(result.status).toBe('error');
  expect(result.status === 'error' ? result.error.code : null).toBe('invalid_arguments');
  expect(opens).toBe(0);
  // The bare old capture pair is still accepted by the same schema.
  expect(projectSourceInputSchema.safeParse({ action: 'compare', before: capture, after: capture }).success).toBe(true);
  expect(projectSourceInputSchema.safeParse({ action: 'compare', before: capture, after: capture, prefix: 'docs' }).success).toBe(false);
});

// --- 6. boundary classification ---------------------------------------------
it('classifies a non-commit object, binary/symlink reads, oversized blobs and a genuinely missing object', async () => {
  const f = await fixture();
  await f.write('docs/text.txt', 'plain text\n');
  await f.write('docs/binary.bin', Buffer.from([0, 1, 2, 3]));
  await symlink('text.txt', join(f.root, 'docs/link.txt'));
  await f.write('docs/large.txt', 'x'.repeat(9000));
  const commit = await f.commitAll('base');
  const tree = (await runGit(f.root, ['rev-parse', commit + '^{tree}'])).trim();

  // Binary and symlink historical entries are unsupported for a text read; never follow the link.
  expect(await f.read(f.context(), commit, 'docs/binary.bin')).toMatchObject({ status: 'rejected', code: 'unsupported' });
  const link = await f.read(f.context(), commit, 'docs/link.txt');
  expect(link).toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(JSON.stringify(link)).not.toContain('plain text');
  // A blob above the requested maxBytes is capacity, never a truncated body.
  expect(await f.read(f.context(), commit, 'docs/large.txt', 100)).toMatchObject({ status: 'rejected', code: 'capacity' });
  // A tree OID is not a commit and must not be peeled into one.
  expect(await f.read(f.context(), tree, 'docs/text.txt')).toMatchObject({ status: 'rejected', code: 'invalid' });
  // A real full OID that is genuinely absent from this repository is not_found (never stderr guessing).
  expect(await f.read(f.context(), 'f'.repeat(40), 'docs/text.txt')).toMatchObject({ status: 'rejected', code: 'not_found' });
});

it('keeps a symlink-containing domain unsupported and compares a pure-regular binary domain', async () => {
  const f = await fixture();
  await f.write('docs/text.txt', 'plain text\n');
  await f.write('docs/binary.bin', Buffer.from([0, 1, 2, 3]));
  await symlink('text.txt', join(f.root, 'docs/link.txt'));
  await f.write('bin/binary.bin', Buffer.from([0, 1, 2, 3]));
  const first = await f.commitAll('base');
  await f.write('docs/text.txt', 'plain text changed\n');
  await f.write('docs/binary.bin', Buffer.from([0, 1, 2, 4]));
  await f.write('bin/binary.bin', Buffer.from([0, 1, 2, 4]));
  const second = await f.commitAll('changed');

  // A domain containing a symlink is unsupported as a whole, never silently skipped.
  expect(await f.compare(f.context(), first, second, 'docs')).toMatchObject({ status: 'rejected', code: 'unsupported' });
  // A pure regular-file domain compares binary blobs by OID and mode without needing UTF-8.
  const binary = ready(await f.compare(f.context(), first, second, 'bin'));
  expect(binary.changes).toEqual([{ kind: 'modified', path: 'bin/binary.bin',
    before: { objectId: expect.any(String), mode: '100644' }, after: { objectId: expect.any(String), mode: '100644' } }]);
});

// --- 7. no configurable execution -------------------------------------------
it('never runs clean filters, textconv or external diff, and ignores a redirected GIT_DIR', async () => {
  const f = await fixture();
  await f.write('.gitattributes', 'docs/filtered.txt filter=probe diff=probe\n');
  await f.write('docs/filtered.txt', 'original raw body\n');
  await f.write('docs/other.txt', 'other base\n');
  const first = await f.commitAll('filter base');
  await f.write('docs/other.txt', 'other changed\n');
  const second = await f.commitAll('filter change');
  // Sentinels are configured only after both real commits; the fixture never adds after this.
  await f.git(['config', 'filter.probe.clean', 'touch filter-was-run.txt']);
  await f.git(['config', 'diff.external', 'touch external-diff-was-run.txt']);
  await f.git(['config', 'diff.probe.textconv', 'touch textconv-was-run.txt']);

  const other = await mkdtemp(join(tmpdir(), 'r2e-git-other-'));
  directories.push(other);
  await runGit(other, ['init', '-q']);
  await runGit(other, ['config', 'user.name', 'Other']);
  await runGit(other, ['config', 'user.email', 'other@example.invalid']);
  await mkdir(join(other, 'docs'), { recursive: true });
  await writeFile(join(other, 'docs/filtered.txt'), 'redirected repository body\n');
  await runGit(other, ['add', '-A']);
  await runGit(other, ['-c', 'user.name=Other', '-c', 'user.email=other@example.invalid', 'commit', '-q', '-m', 'other']);

  const previousGitDir = process.env['GIT_DIR'];
  process.env['GIT_DIR'] = join(other, '.git');
  try {
    const file = ready(await f.read(f.context(), first, 'docs/filtered.txt'));
    expect(file).toMatchObject({ content: 'original raw body\n', digest: sha256('original raw body\n'), digestBasis: 'raw_bytes' });
    const comparison = ready(await f.compare(f.context(), first, second, 'docs'));
    expect(comparison.changes).toEqual([{ kind: 'modified', path: 'docs/other.txt',
      before: { objectId: expect.any(String), mode: '100644' }, after: { objectId: expect.any(String), mode: '100644' } }]);
  } finally {
    if (previousGitDir === undefined) delete process.env['GIT_DIR']; else process.env['GIT_DIR'] = previousGitDir;
  }
  for (const sentinel of ['filter-was-run.txt', 'external-diff-was-run.txt', 'textconv-was-run.txt']) {
    await expect(rm(join(f.root, sentinel), { force: false }), sentinel).rejects.toMatchObject({ code: 'ENOENT' });
  }
});

// --- 8. linked worktree and parent-subdirectory root ------------------------
it('keeps a legitimate linked worktree readable and rejects a parent-repository subdirectory root', async () => {
  const main = await fixture();
  await main.write('docs/a.txt', 'main branch body\n');
  const mainCommit = await main.commitAll('main base');
  const worktreePath = join(main.directory, 'linked-worktree');
  await main.git(['worktree', 'add', '-q', '-b', 'linked-branch', worktreePath, mainCommit]);
  const linked = await fixture({ root: worktreePath });
  await linked.write('docs/a.txt', 'linked worktree body\n');
  const linkedCommit = await linked.commitAll('worktree change');

  // A plain subdirectory of the parent repository is not a registered Git root.
  await main.write('plain/inside.txt', 'inside parent repo\n');
  const parentCommit = await main.commitAll('plain subdir');
  const nested = await fixture({ root: join(main.root, 'plain') });
  expect(await nested.read(nested.context(), parentCommit, 'inside.txt')).toMatchObject({ status: 'rejected', code: 'unsupported' });

  expect(ready(await linked.read(linked.context(), mainCommit, 'docs/a.txt')).content).toBe('main branch body\n');
  expect(ready(await linked.read(linked.context(), linkedCommit, 'docs/a.txt')).content).toBe('linked worktree body\n');
});

// --- 9. real child / root handle observation on abort and close -------------
/** Bounded test-local wait: it only prevents a hung test, never replaces the real order assertions. */
async function withWatchdog<T>(promise: Promise<T>, label: string, ms = 5000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`test watchdog: ${label} did not settle`)), ms);
    timer.unref?.();
  });
  try { return await Promise.race([promise, timeout]); } finally { if (timer) clearTimeout(timer); }
}

type SettleSnapshot = { childClosed: boolean; handleFds: number[]; handleClosedAfterChild: boolean };

async function observeCancellation(
  trigger: (controller: AbortController, closeRegistry: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const f = await fixture();
  await f.write('docs/a.txt', 'a\n');
  const commit = await f.commitAll('base');

  gate.active = true;
  gate.records.length = 0;
  gate.waiters.length = 0;
  const closedChildren = new Set<ChildProcess>();
  const acquiredHandles: FileHandle[] = [];
  let record: (typeof gate.records)[number] | undefined;
  let handleClosedAfterChild = false;
  // Observation only: each snapshot captures the real state at the instant a public promise
  // settles, so a later cleanup state can never stand in for the settle-time state.
  const snapshot = (): SettleSnapshot => ({
    childClosed: record !== undefined && closedChildren.has(record.child),
    handleFds: acquiredHandles.map(handle => handle.fd),
    handleClosedAfterChild,
  });
  let operationSnapshot: SettleSnapshot | undefined;
  let closeSnapshot: SettleSnapshot | undefined;

  const original = WorkspaceSandbox.prototype.acquireRootHandleForProcess;
  const spy = vi.spyOn(WorkspaceSandbox.prototype, 'acquireRootHandleForProcess').mockImplementation(async function (this: WorkspaceSandbox) {
    const handle = await original.call(this);
    acquiredHandles.push(handle);
    const realClose = handle.close.bind(handle);
    (handle as unknown as { close: () => Promise<void> }).close = async () => {
      handleClosedAfterChild = record !== undefined && closedChildren.has(record.child);
      return realClose();
    };
    return handle;
  });

  const controller = new AbortController();
  const childEntered = new Promise<void>(resolve => gate.waiters.push(resolve));
  const operation = f.read(f.context(controller.signal), commit, 'docs/a.txt');
  // Forward the exact result/rejection while snapshotting at the real settle moment.
  const observedOperation = operation.then(
    value => { operationSnapshot = snapshot(); return value; },
    error => { operationSnapshot = snapshot(); throw error; },
  );
  const closeRegistry = async () => {
    try { return await f.handle.close(); }
    finally { closeSnapshot = snapshot(); }
  };

  try {
    const first = await withWatchdog(Promise.race([
      childEntered.then(() => 'child' as const),
      observedOperation.then(() => 'result' as const),
    ]), 'Git read outcome');
    expect(first, 'Git read must reach a real cat-file --batch-check child before returning').toBe('child');
    const entered = gate.records[0];
    if (!entered) throw Error('gated real child was not recorded');
    record = entered;
    void entered.closed.then(() => closedChildren.add(entered.child));

    // A regressed trigger/close must still enter cleanup: bound it instead of awaiting forever.
    await withWatchdog(trigger(controller, closeRegistry), 'cancellation trigger');
    const result = await withWatchdog(observedOperation, 'public result');
    expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });

    expect(operationSnapshot, 'the operation must have settled').toBeDefined();
    expect(operationSnapshot!.childClosed, 'the real child must exit before the public result settles').toBe(true);
    expect(operationSnapshot!.handleFds.length).toBeGreaterThan(0);
    expect(operationSnapshot!.handleFds.every(fd => fd === -1), 'the root handle must be closed at operation settle').toBe(true);
    expect(operationSnapshot!.handleClosedAfterChild, 'the real child close must precede the root handle close').toBe(true);
    if (closeSnapshot) {
      expect(closeSnapshot.childClosed, 'the real child must exit before registry.close settles').toBe(true);
      expect(closeSnapshot.handleFds.length).toBeGreaterThan(0);
      expect(closeSnapshot.handleFds.every(fd => fd === -1), 'the root handle must be closed at registry.close settle').toBe(true);
      expect(closeSnapshot.handleClosedAfterChild).toBe(true);
    }
  } finally {
    // Cleanup order: stop gating, release queued stdin, cancel, terminate any real child that has
    // not actually closed and await its real close, drain the original operation, restore spies.
    gate.active = false;
    const records = gate.records.splice(0);
    gate.waiters.length = 0;
    for (const entry of records) entry.release();
    controller.abort(new Error('test cleanup'));
    for (const entry of records) {
      if (!closedChildren.has(entry.child)) {
        try { entry.child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    }
    await Promise.allSettled(records.map(entry => withWatchdog(entry.closed, 'real child close')));
    await Promise.allSettled([withWatchdog(observedOperation, 'operation drain')]);
    spy.mockRestore();
  }
}

it('observes the real Git child exit and root handle close when the caller aborts', async () => {
  await observeCancellation(async controller => { controller.abort(new Error('caller aborted the read')); });
}, 15000);

it('observes the real Git child exit and root handle close when the registry closes', async () => {
  await observeCancellation(async (_controller, closeRegistry) => { await closeRegistry(); });
}, 15000);

it('closes an acquired real root handle without spawning Git when cancelled before the handle returns', async () => {
  const f = await fixture();
  await f.write('docs/a.txt', 'a\n');
  const commit = await f.commitAll('base');
  const acquired = deferred();
  const proceed = deferred();
  const controller = new AbortController();
  const state: { handle: FileHandle | null; closeComplete: boolean; resultClosed: boolean; resultFd: number | null } = {
    handle: null, closeComplete: false, resultClosed: false, resultFd: null,
  };
  const observed: NonNullable<typeof gate.observedSpawns> = [];
  gate.observedSpawns = observed;
  const original = WorkspaceSandbox.prototype.acquireRootHandleForProcess;
  const spy = vi.spyOn(WorkspaceSandbox.prototype, 'acquireRootHandleForProcess').mockImplementation(async function (this: WorkspaceSandbox) {
    const handle = await original.call(this);
    state.handle = handle;
    const close = handle.close.bind(handle);
    handle.close = async () => { await close(); state.closeComplete = true; };
    acquired.resolve();
    await proceed.promise;
    return handle;
  });
  const snapshot = () => {
    state.resultClosed = state.closeComplete;
    state.resultFd = state.handle?.fd ?? null;
  };
  const operation = f.read(f.context(controller.signal), commit, 'docs/a.txt').then(
    result => { snapshot(); return result; },
    error => { snapshot(); throw error; },
  );
  try {
    expect(await withWatchdog(Promise.race([
      acquired.promise.then(() => 'handle'), operation.then(() => 'result'),
    ]), 'real root handle acquisition')).toBe('handle');
    expect(state.handle?.fd).toBeGreaterThanOrEqual(0);
    expect(observed).toHaveLength(0);
    controller.abort(new Error('cancelled while the acquired root handle was pending'));
    proceed.resolve();
    expect(await withWatchdog(operation, 'cancelled root acquisition result'))
      .toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(observed, 'cancellation after acquisition must be checked before any Git spawn').toHaveLength(0);
    expect(state.resultClosed, 'the actual handle close must finish before the public result').toBe(true);
    expect(state.resultFd).toBe(-1);
  } finally {
    controller.abort(new Error('test cleanup'));
    proceed.resolve();
    const closeChildren = async () => {
      for (const entry of observed) if (!entry.didClose) {
        try { entry.child.kill('SIGKILL'); } catch { /* already gone */ }
      }
      await Promise.allSettled(observed.map(entry => withWatchdog(entry.closed, 'acquisition test child close')));
    };
    try {
      await closeChildren();
      await Promise.allSettled([withWatchdog(operation, 'acquisition test operation drain')]);
      // Include a child started by a broken path after the first cleanup pass.
      await closeChildren();
      if (state.handle !== null && state.handle.fd >= 0) {
        await withWatchdog(state.handle.close(), 'acquisition test handle cleanup');
      }
    } finally {
      gate.observedSpawns = null;
      spy.mockRestore();
    }
  }
}, 30000);
