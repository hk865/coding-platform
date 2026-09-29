/**
 * MVP UI connection — Host workbench-tools seam.
 *
 * Stage-one contract freeze:
 *   - the permission defaults are REAL: an absent `writePrefixes` denies every
 *     save and an absent `allowCommands` denies every command with an explicit
 *     `forbidden` (a missing capability is never a default allow);
 *   - the save adapter reuses the SAME frozen Kernel `WorkspaceSandbox` the
 *     workspace reads use, including the exclusive-create and empty-file cases;
 *   - a command handle is a real Kernel `ProcessSandbox` execution with its own
 *     running/stopping/settled state, never a mocked executor.
 *
 * The Kernel operations are an explicit `unsupported` gap in stage one, so the
 * CAS/empty-file and real-process assertions are the expected FIRST RED until
 * the reviewed stage-two implementation lands.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkbenchTools } from '../../src/app/workbench-tools.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { MaterialSourceScope } from '../../src/contracts/material-access.js';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';

const scope: MaterialSourceScope = { projectId: 'mvp-tools-project', workspaceId: 'mvp-tools-workspace' };
const actor = { kind: 'human' as const, id: 'mvp-tools-operator' };
const context = (): CoreCallContext => ({
  projectId: scope.projectId,
  workspaceId: scope.workspaceId,
  principal: { kind: 'host', actor: { ...actor } },
  materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...actor } },
  signal: new AbortController().signal,
});

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function realRoot(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mvp-workbench-tools-'));
  temporary.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe('MVP workbench-tools permission defaults (real, stage-one green)', () => {
  it('denies save and command when the workspace grants no write/execute capability', async () => {
    const root = await realRoot({ 'src/app.ts': 'export const answer = 1;\n' });
    const handle = createWorkbenchTools({ workspaces: [{ scope, root, readPrefixes: ['src'] }] });
    try {
      const saved = await handle.tools.saveFile(context(),
        { path: 'src/app.ts', expectedRevision: null, content: 'changed\n' });
      expect(saved).toMatchObject({ status: 'rejected', code: 'forbidden' });
      const started = await handle.tools.startCommand(context(),
        { requestId: 'req-1', command: 'echo should-not-run', cwd: '.' });
      expect(started).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally { await handle.close(); }
  });

  it('refuses a write path that is not ALSO inside the readable scope', async () => {
    const root = await realRoot({ 'docs/readme.md': 'doc\n' });
    const handle = createWorkbenchTools({
      workspaces: [{ scope, root, readPrefixes: ['src'], writePrefixes: ['docs'] }],
    });
    try {
      const saved = await handle.tools.saveFile(context(),
        { path: 'docs/readme.md', expectedRevision: null, content: 'changed\n' });
      expect(saved).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally { await handle.close(); }
  });
});

describe('MVP workbench-tools Kernel CAS save (expected red until stage two)', () => {
  it('performs an exclusive create and an old-revision CAS save with the real WorkspaceSandbox', async () => {
    const root = await realRoot({ 'src/app.ts': 'export const answer = 1;\n' });
    const handle = createWorkbenchTools({
      workspaces: [{ scope, root, readPrefixes: ['src'], writePrefixes: ['src'] }],
    });
    try {
      const sandbox = await WorkspaceSandbox.create(root);
      const before = await sandbox.read('src/app.ts');
      const created = await handle.tools.saveFile(context(),
        { path: 'src/created.ts', expectedRevision: null, content: 'export const created = true;\n' });
      expect(created).toMatchObject({ status: 'ready', value: { oldRevision: null } });
      const saved = await handle.tools.saveFile(context(),
        { path: 'src/app.ts', expectedRevision: before.revision, content: 'export const answer = 2;\n' });
      expect(saved).toMatchObject({ status: 'ready', value: { oldRevision: before.revision } });
      if (saved.status !== 'ready') throw new Error('CAS save did not succeed');
      expect((await sandbox.read('src/app.ts')).revision).toBe(saved.value.revision);
      const stale = await handle.tools.saveFile(context(),
        { path: 'src/app.ts', expectedRevision: before.revision, content: 'stale overwrite\n' });
      expect(stale.status).toBe('rejected');
      // The old draft must not overwrite the saved bytes.
      expect(await readFile(join(root, 'src', 'app.ts'), 'utf8')).toBe('export const answer = 2;\n');
    } finally { await handle.close(); }
  });

  it('legally replaces an EMPTY file at its exact revision', async () => {
    const root = await realRoot({ 'src/empty.ts': '' });
    const handle = createWorkbenchTools({
      workspaces: [{ scope, root, readPrefixes: ['src'], writePrefixes: ['src'] }],
    });
    try {
      const sandbox = await WorkspaceSandbox.create(root);
      const empty = await sandbox.read('src/empty.ts');
      const saved = await handle.tools.saveFile(context(),
        { path: 'src/empty.ts', expectedRevision: empty.revision, content: 'first line\n' });
      expect(saved).toMatchObject({ status: 'ready', value: { oldRevision: empty.revision } });
      expect(await readFile(join(root, 'src', 'empty.ts'), 'utf8')).toBe('first line\n');
    } finally { await handle.close(); }
  });
});

describe('MVP workbench-tools real command handle (expected red until stage two)', () => {
  it('retains real output, replays one command handle and cancels a running command', async () => {
    const root = await realRoot({ 'src/app.ts': 'export const answer = 1;\n' });
    const handle = createWorkbenchTools({
      workspaces: [{ scope, root, readPrefixes: ['src'], allowCommands: true }],
    });
    try {
      const request = { requestId: 'req-echo', command: 'echo mvp-command-ok', cwd: '.' };
      const started = await handle.tools.startCommand(context(), request);
      expect(started).toMatchObject({ status: 'ready', value: { state: 'running' } });
      if (started.status !== 'ready') throw new Error(`command start was not ready: ${JSON.stringify(started)}`);
      const replay = await handle.tools.startCommand(context(), request);
      expect(replay).toMatchObject({ status: 'ready', value: { commandId: started.value.commandId } });
      const conflict = await handle.tools.startCommand(context(), { ...request, command: 'echo different-command' });
      expect(conflict.status).toBe('rejected');
      let read = await handle.tools.readCommand(context(), { commandId: started.value.commandId });
      const deadline = Date.now() + 10_000;
      while (read.status === 'ready' && read.value.state !== 'settled' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
        read = await handle.tools.readCommand(context(), { commandId: started.value.commandId });
      }
      expect(read).toMatchObject({ status: 'ready', value: {
        state: 'settled', stdout: 'mvp-command-ok\n', exitCode: 0, cancelled: false, error: null,
      } });
      const long = await handle.tools.startCommand(context(),
        { requestId: 'req-long', command: 'sleep 30', cwd: '.' });
      expect(long).toMatchObject({ status: 'ready', value: { state: 'running' } });
      if (long.status !== 'ready') throw new Error('long command did not start');
      const stopped = await handle.tools.stopCommand(context(), { commandId: long.value.commandId });
      expect(stopped.status).toBe('ready');
      if (stopped.status === 'ready') expect(['stopping', 'settled']).toContain(stopped.value.state);
      let cancelled = await handle.tools.readCommand(context(), { commandId: long.value.commandId });
      const cancelDeadline = Date.now() + 5_000;
      while (cancelled.status === 'ready' && cancelled.value.state !== 'settled' && Date.now() < cancelDeadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
        cancelled = await handle.tools.readCommand(context(), { commandId: long.value.commandId });
      }
      expect(cancelled).toMatchObject({ status: 'ready', value: { state: 'settled', cancelled: true, error: null } });
    } finally { await handle.close(); }
  }, 20_000);
});

describe('MVP workbench-tools bounded directory inventory', () => {
  it('lists real binary and oversized paths inside the read scope without widening it', async () => {
    const root = await realRoot({ 'src/ok.txt': 'ok\n', 'private/secret.txt': 'secret\n' });
    await writeFile(join(root, 'src', 'raw.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
    await writeFile(join(root, 'src', 'huge.txt'), 'x'.repeat(4096));
    const handle = createWorkbenchTools({
      workspaces: [{ scope, root, readPrefixes: ['src'] }],
      maxFileBytes: 1024,
    });
    try {
      const listed = await handle.tools.listFiles(context(), {});
      expect(listed).toMatchObject({ status: 'ready' });
      if (listed.status !== 'ready') throw new Error(`inventory was not ready: ${JSON.stringify(listed)}`);
      // A binary or oversized member is listed by PATH; the tree must not fail
      // just because one member cannot be read as text.
      expect(listed.value.paths).toEqual(expect.arrayContaining(['src/ok.txt', 'src/raw.bin', 'src/huge.txt']));
      // The trusted read scope holds: a path outside readPrefixes is never enumerated.
      expect(listed.value.paths).not.toContain('private/secret.txt');
      expect(typeof listed.value.partial).toBe('boolean');
      // A prefix outside the trusted read scope is rejected, never widened.
      await expect(handle.tools.listFiles(context(), { prefix: 'private' }))
        .resolves.toMatchObject({ status: 'rejected', code: 'forbidden' });
      // The bodies stay under the ORIGINAL text-capture/read ceiling.
      const sandbox = await WorkspaceSandbox.create(root, { maxFileBytes: 1024 });
      await expect(sandbox.read('src/raw.bin')).rejects.toThrow();
      await expect(sandbox.read('src/huge.txt')).rejects.toThrow();
    } finally { await handle.close(); }
  });
});
