/**
 * RL slice row RL-33 (RE2): the workbench command-page snapshot carries the
 * Kernel `resourceCaps` report after a settled command and `null` on a saved
 * launch error (spec §5.2 RL-33, L10).
 *
 * Builds: the real `createWorkbenchTools` port (the binding behind the Host
 * `commands/start` / `commands/read` routes) with the Kernel `ProcessSandbox`
 * swapped by the RL double.
 * Rows: RL-33.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkbenchTools } from '../../src/app/workbench-tools.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { MaterialSourceScope } from '../../src/contracts/material-access.js';
import { ProcessSandboxError, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { defaultRLSandboxResult, rlSandbox } from '../helpers/RL-kernel-sandbox-double.js';

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const { mockRLKernelSandboxModule } = await import('../helpers/RL-kernel-sandbox-double.js');
  return await mockRLKernelSandboxModule(importOriginal as never);
});

const scope: MaterialSourceScope = { projectId: 'rl-33-project', workspaceId: 'rl-33-workspace' };
const actor = { kind: 'human' as const, id: 'rl-33-operator' };
const context = (): CoreCallContext => ({
  projectId: scope.projectId, workspaceId: scope.workspaceId, principal: { kind: 'host', actor: { ...actor } },
  materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...actor } },
  signal: new AbortController().signal,
});

const APPLIED_NONE = { status: 'applied', memoryMaxBytes: 268435456, tasksMax: 64,
  memory: 'none_observed', processes: 'none_observed', observationComplete: true };

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  rlSandbox.reset();
  vi.restoreAllMocks();
});

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rl-33-ws-'));
  roots.push(directory);
  await WorkspaceSandbox.create(directory);
  return directory;
}

it('RL-33 a settled command snapshot carries the same resourceCaps report the double returned', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const handle = createWorkbenchTools({
    workspaces: [{ scope, root: await root(), readPrefixes: ['.'], writePrefixes: ['.'], allowCommands: true }],
    resourceCaps: { current: () => ({ memoryMaxBytes: 268435456, tasksMax: 64 }) },
  });
  try {
    const started = await handle.tools.startCommand(context(), { requestId: 'rl33-ok', command: 'echo rl33', cwd: '.' });
    expect(started.status).toBe('ready');
    if (started.status !== 'ready') throw new Error('RL-33 start failed');
    const commandId = started.value.commandId;
    await expect.poll(async () => {
      const read = await handle.tools.readCommand(context(), { commandId });
      return read.status === 'ready' ? read.value.state : 'missing';
    }, { timeout: 5_000 }).toBe('settled');
    const read = await handle.tools.readCommand(context(), { commandId });
    if (read.status !== 'ready') throw new Error('RL-33 read failed');
    expect(read.value.resourceCaps).toEqual(APPLIED_NONE);
    expect(read.value.error).toBeNull();
  } finally { await handle.close(); }
});

it('RL-33 a saved launch error snapshot has an error and resourceCaps null', async () => {
  rlSandbox.next = () => { throw new ProcessSandboxError('launch_failed', 'launch_failed: rl33 stub'); };
  const handle = createWorkbenchTools({
    workspaces: [{ scope, root: await root(), readPrefixes: ['.'], writePrefixes: ['.'], allowCommands: true }],
    resourceCaps: { current: () => ({ memoryMaxBytes: 268435456, tasksMax: 64 }) },
  });
  try {
    const started = await handle.tools.startCommand(context(), { requestId: 'rl33-fail', command: 'echo rl33', cwd: '.' });
    if (started.status !== 'ready') throw new Error('RL-33 start failed');
    const commandId = started.value.commandId;
    await expect.poll(async () => {
      const read = await handle.tools.readCommand(context(), { commandId });
      return read.status === 'ready' ? (read.value.error === null ? 'running' : 'error') : 'missing';
    }, { timeout: 5_000 }).toBe('error');
    const read = await handle.tools.readCommand(context(), { commandId });
    if (read.status !== 'ready') throw new Error('RL-33 read failed');
    expect(read.value.error?.code).toBe('launch_failed');
    expect(read.value.resourceCaps).toBeNull();
  } finally { await handle.close(); }
});
