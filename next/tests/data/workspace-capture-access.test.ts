import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import {
  createWorkspaceAccessFactory,
  type WorkspaceAccessFactory,
  type WorkspaceHostBindings,
  type WorkspaceReadAccess,
} from '../../src/core/workspace/access.js';

// Independent R2c acceptance: the bindings are trusted Host policy, while all
// actual path handling and reads exercise the real Kernel WorkspaceSandbox.
const workspace: WorkspaceRef = {
  aggregateType: 'Workspace', projectId: 'capture-access-project', workspaceId: 'workspace-main',
};
const roots: string[] = [];
const accesses = new Set<WorkspaceReadAccess>();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled([...accesses].map(access => access.release()));
  accesses.clear();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function context(signal: AbortSignal = new AbortController().signal): CoreCallContext {
  const actor = { kind: 'human' as const, id: 'capture-reader' };
  return {
    projectId: workspace.projectId,
    workspaceId: workspace.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor },
    signal,
  };
}

async function fixture(marker = 'first-root') {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-capture-access-'));
  roots.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'private'), { recursive: true });
  await mkdir(join(root, '.git'), { recursive: true });
  await writeFile(join(root, 'src/visible.ts'), `export const marker = ${JSON.stringify(marker)};\n`);
  await writeFile(join(root, 'src/second.ts'), 'export const second = 2;\n');
  await writeFile(join(root, 'private/hidden.ts'), 'synthetic-private-source\n');
  await writeFile(join(root, '.env'), 'SYNTHETIC_VALUE=not-a-real-secret\n');
  await writeFile(join(root, '.git/config'), '[core]\n');
  await writeFile(join(directory, 'outside.ts'), 'synthetic-outside-source\n');
  return { root, directory };
}

function bindingsFor(root: string, allowsRead: (path: string) => boolean = () => true): WorkspaceHostBindings {
  return {
    resolveRoot: async ref => ref.projectId === workspace.projectId && ref.workspaceId === workspace.workspaceId
      ? { status: 'ready', value: { root, workspaceRevision: 7 } }
      : { status: 'rejected', code: 'not_found', reason: 'Unknown test workspace' },
    authorize: async (ctx, ref) => ctx.projectId === ref.projectId && ctx.workspaceId === ref.workspaceId
      ? { status: 'ready', value: { subjectKey: 'host:capture-reader', permissionRevision: 'read-policy-1', allowsRead } }
      : { status: 'rejected', code: 'forbidden', reason: 'Reader scope does not match workspace' },
  };
}

async function open(factory: WorkspaceAccessFactory, ctx = context()): Promise<WorkspaceReadAccess> {
  const result = await factory.open(ctx, workspace);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(`Expected readable workspace: ${result.code}: ${result.reason}`);
  accesses.add(result.value);
  return result.value;
}

it('rejects an unauthorized open before probing the filesystem or constructing a Sandbox', async () => {
  const { directory } = await fixture();
  const sandboxCreate = vi.spyOn(WorkspaceSandbox, 'create');
  const factory = createWorkspaceAccessFactory({
    // This is trusted metadata, not an instruction to touch the directory.
    // A filesystem probe before authorization would encounter a missing root.
    resolveRoot: async () => ({ status: 'ready', value: { root: join(directory, 'not-created'), workspaceRevision: 7 } }),
    authorize: async () => ({ status: 'rejected', code: 'forbidden', reason: 'Read grant revoked' }),
  });

  const result = await factory.open(context(), workspace);

  expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(sandboxCreate).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('synthetic-private-source');
  // No assertion orders the resolveRoot and authorize metadata callbacks.
});

it('applies the trusted read scope to both inventory and actual file reads', async () => {
  const { root } = await fixture();
  const access = await open(createWorkspaceAccessFactory(bindingsFor(root, path => path === 'src' || path.startsWith('src/'))));

  const inventory = await access.listFiles(100);
  expect([...inventory.paths].sort()).toEqual(['src/second.ts', 'src/visible.ts']);
  expect(inventory.truncated).toBe(false);
  expect(await access.read('src/visible.ts', 4096)).toMatchObject({
    content: 'export const marker = "first-root";\n', revision: expect.any(String),
  });
  await expect(access.read('private/hidden.ts', 4096)).rejects.toThrow();

  const wrongScope = { ...context(), projectId: 'another-project' };
  expect(await createWorkspaceAccessFactory(bindingsFor(root)).open(wrongScope, workspace))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
});

it('rejects traversal, absolute paths, denied prefixes and both internal and escaping symlinks', async () => {
  const { root, directory } = await fixture();
  await symlink(join(directory, 'outside.ts'), join(root, 'src/escape.ts'));
  await symlink(join(root, 'src/visible.ts'), join(root, 'src/alias.ts'));
  const access = await open(createWorkspaceAccessFactory(bindingsFor(root)));

  for (const path of ['../outside.ts', join(root, 'src/visible.ts'), '.env', '.git/config', 'src/escape.ts', 'src/alias.ts']) {
    await expect(access.read(path, 4096), `must not read ${path}`).rejects.toThrow();
  }
  const inventory = await access.listFiles(100);
  expect(inventory.paths).toContain('src/visible.ts');
  for (const path of ['.env', '.git/config', 'src/escape.ts', 'src/alias.ts']) {
    expect(inventory.paths, `must not list ${path}`).not.toContain(path);
  }
});

it('binds cancellation to one request without disabling another request or a later open', async () => {
  const { root } = await fixture();
  const factory = createWorkspaceAccessFactory(bindingsFor(root));
  const firstRequest = new AbortController();
  const secondRequest = new AbortController();
  const first = await open(factory, context(firstRequest.signal));
  const second = await open(factory, context(secondRequest.signal));

  firstRequest.abort(new Error('First reader disconnected'));

  await expect(first.read('src/visible.ts', 4096)).rejects.toThrow();
  await expect(first.listFiles(100)).rejects.toThrow();
  expect((await second.read('src/visible.ts', 4096)).content).toContain('first-root');
  expect((await second.listFiles(100)).paths).toContain('src/visible.ts');
  expect(await factory.open(context(firstRequest.signal), workspace))
    .toMatchObject({ status: 'rejected', code: 'cancelled' });

  const later = await open(factory);
  expect((await later.read('src/visible.ts', 4096)).content).toContain('first-root');
});

it('obtains a fresh root, trusted revision and authorization for each new request', async () => {
  const a = await fixture('root-a');
  const b = await fixture('root-b');
  let currentRoot = a.root;
  let workspaceRevision = 7;
  let permissionRevision = 'policy-a';
  let granted = true;
  const factory = createWorkspaceAccessFactory({
    resolveRoot: async () => ({ status: 'ready', value: { root: currentRoot, workspaceRevision } }),
    authorize: async () => granted
      ? { status: 'ready', value: { subjectKey: 'host:capture-reader', permissionRevision, allowsRead: () => true } }
      : { status: 'rejected', code: 'forbidden', reason: 'Read grant revoked' },
  });

  const first = await open(factory);
  expect(first.workspace).toEqual(workspace);
  expect(first.workspaceRevision).toBe(7);
  expect(first.authorization.permissionRevision).toBe('policy-a');
  expect((await first.read('src/visible.ts', 4096)).content).toContain('root-a');

  currentRoot = b.root;
  workspaceRevision = 29;
  permissionRevision = 'policy-b';
  const second = await open(factory);
  expect(second.workspaceRevision).toBe(29);
  expect(second.authorization.permissionRevision).toBe('policy-b');
  expect(second.workspaceIdentity).not.toBe(first.workspaceIdentity);
  expect((await second.read('src/visible.ts', 4096)).content).toContain('root-b');
  // An earlier request's version is not silently rewritten by a later open.
  expect(first.workspaceRevision).toBe(7);
  expect(first.authorization.permissionRevision).toBe('policy-a');

  granted = false;
  expect(await factory.open(context(), workspace)).toMatchObject({ status: 'rejected', code: 'forbidden' });
});

it('revokes a released access without closing a different access to the same workspace', async () => {
  const { root } = await fixture();
  const factory = createWorkspaceAccessFactory(bindingsFor(root));
  const released = await open(factory);
  const retained = await open(factory);

  await released.release();
  accesses.delete(released);

  await expect(released.read('src/visible.ts', 4096)).rejects.toThrow();
  await expect(released.listFiles(100)).rejects.toThrow();
  await expect(released.sourceIdentity()).rejects.toThrow();
  expect((await retained.read('src/visible.ts', 4096)).content).toContain('first-root');
});
