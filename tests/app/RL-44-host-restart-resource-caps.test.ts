/**
 * RL slice row RL-44 (RE3): a real Host restart installs the persisted
 * `resourceCaps` into the holder before the first command, and the settings page
 * publishes the Kernel cache status (spec §5.2 RL-44, L13).
 *
 * Builds: two consecutive real `createLocalWorkbenchHost` instances over one
 * temporary settings directory and workspace; the Kernel `ProcessSandbox` is the
 * RL double, which records the `current()` value at every `execute`.
 * Rows: RL-44.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkbenchHost } from '../../src/app/host.js';
import { SETTINGS_API_PREFIX } from '../../src/app/host-settings-types.js';
import { CORE_API_PREFIX, PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import { UI_PLATFORM_TOKEN_META_NAME } from '../../src/ui/api/protocol.js';
import { defaultRLSandboxResult, rlSandbox } from '../helpers/RL-kernel-sandbox-double.js';

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const { mockRLKernelSandboxModule } = await import('../helpers/RL-kernel-sandbox-double.js');
  return await mockRLKernelSandboxModule(importOriginal as never);
});

const scope = { projectId: 'rl-44-project', workspaceId: 'rl-44-workspace' };
const MIB = 1_048_576;

type Started = { base: string; token: string; close(): Promise<void> };

const cleanup: Array<() => Promise<void>> = [];
const directories: string[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  rlSandbox.reset();
  vi.restoreAllMocks();
});

async function temp(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function readToken(base: string): Promise<string> {
  const response = await fetch(base);
  expect(response.status).toBe(200);
  const html = await response.text();
  const match = new RegExp(`<meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return match[1];
}

async function startHost(settingsDirectory: string, root: string): Promise<Started> {
  const publicDir = await temp('rl-44-public-');
  const database = await temp('rl-44-db-');
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'index.html'),
    `<meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="__PLATFORM_TOKEN__">`);
  const host = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: database },
    actor: { kind: 'human', id: 'rl-44-operator' },
    workspaces: [{ scope, name: 'RL-44 workspace', root, workspaceRevision: 1, readPrefixes: ['.'],
      writePrefixes: ['.'], allowCommands: true }],
    settings: { settingsDirectory },
    publicDir,
    now: () => '2026-10-15T00:00:00.000Z',
  });
  const address = await host.listen();
  const token = await readToken(address.url);
  return { base: address.url, token, close: () => host.close() };
}

async function post(base: string, token: string, prefix: string, suffix: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(prefix + suffix, base), {
    method: 'POST', headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return await response.json() as Record<string, unknown>;
}

it('RL-44 a restarted Host installs the persisted caps and publishes the Kernel machine status', async () => {
  rlSandbox.status = { status: 'unavailable', reason: 'no_user_session', detail: 'rl-44 stub' };
  rlSandbox.next = () => defaultRLSandboxResult();
  const settingsDirectory = await temp('rl-44-settings-');
  const root = await temp('rl-44-ws-');

  const first = await startHost(settingsDirectory, root);
  cleanup.push(() => first.close());
  const saved = await post(first.base, first.token, SETTINGS_API_PREFIX, 'resource-caps/save',
    { memoryMaxMiB: 700, tasksMax: 321 });
  expect(saved['status']).toBe('ready');
  await first.close();

  const restarted = await startHost(settingsDirectory, root);
  cleanup.push(() => restarted.close());

  const snapshot = await post(restarted.base, restarted.token, SETTINGS_API_PREFIX, 'snapshot', {});
  expect(snapshot).toMatchObject({ status: 'ready', value: { resourceCaps: {
    memoryMaxMiB: 700, tasksMax: 321,
    effective: { memoryMaxMiB: 700, tasksMax: 321 },
    machine: { status: 'unavailable', reason: 'no_user_session', text: '没有资源上限：没有 systemd 的用户会话' },
  } } });

  const started = await post(restarted.base, restarted.token, CORE_API_PREFIX, 'commands/start',
    { scope, input: { requestId: 'rl-44-command', command: 'echo rl-44', cwd: '.' } });
  expect(started['status']).toBe('ready');
  const commandId = (started['value'] as { commandId?: string } | undefined)?.commandId;
  if (commandId === undefined) throw new Error('RL-44 the Host did not return a command id');
  await expect.poll(async () => {
    const read = await post(restarted.base, restarted.token, CORE_API_PREFIX, 'commands/read', { scope, input: { commandId } });
    return (read['value'] as { state?: string } | undefined)?.state;
  }, { timeout: 10_000, interval: 25 }).toBe('settled');
  expect(rlSandbox.currentReads.at(-1)).toEqual({ memoryMaxBytes: 700 * MIB, tasksMax: 321 });
});

/** Start one workbench command over the Host HTTP route and await its settle. */
async function runCommand(host: Started, requestId: string, command: string): Promise<void> {
  const started = await post(host.base, host.token, CORE_API_PREFIX, 'commands/start',
    { scope, input: { requestId, command, cwd: '.' } });
  expect(started['status']).toBe('ready');
  const commandId = (started['value'] as { commandId?: string } | undefined)?.commandId;
  if (commandId === undefined) throw new Error('RL-44 the Host did not return a command id');
  await expect.poll(async () => {
    const read = await post(host.base, host.token, CORE_API_PREFIX, 'commands/read', { scope, input: { commandId } });
    return (read['value'] as { state?: string } | undefined)?.state;
  }, { timeout: 10_000, interval: 25 }).toBe('settled');
}

it('RL-44 RL-34 a live save reaches the next workbench command page through the production holder without a restart', async () => {
  rlSandbox.status = { status: 'available' };
  rlSandbox.next = () => defaultRLSandboxResult();
  const settingsDirectory = await temp('rl-44-live-settings-');
  const root = await temp('rl-44-live-ws-');
  const host = await startHost(settingsDirectory, root);
  cleanup.push(() => host.close());

  expect((await post(host.base, host.token, SETTINGS_API_PREFIX, 'resource-caps/save',
    { memoryMaxMiB: 700, tasksMax: 321 }))['status']).toBe('ready');
  await runCommand(host, 'rl-44-live-a', 'echo a');
  expect(rlSandbox.currentReads.at(-1)).toEqual({ memoryMaxBytes: 700 * MIB, tasksMax: 321 });

  expect((await post(host.base, host.token, SETTINGS_API_PREFIX, 'resource-caps/save',
    { memoryMaxMiB: 900, tasksMax: 111 }))['status']).toBe('ready');
  await runCommand(host, 'rl-44-live-b', 'echo b');
  expect(rlSandbox.currentReads.at(-1)).toEqual({ memoryMaxBytes: 900 * MIB, tasksMax: 111 });
});
