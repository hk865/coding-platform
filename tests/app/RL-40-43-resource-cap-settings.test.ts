/**
 * RL slice rows RL-40 … RL-43 (RE3): the Host setting `resourceCaps` — defaults,
 * the private byte snapshot, the machine status, save/read-back, legacy files,
 * validation bounds and write/push failures (spec §5.2, L13, F16).
 *
 * Builds: the real `createHostSettings` over a temporary settings directory and
 * a fake assembly, exactly like `A2-settings-automation.test.ts`.
 * Rows: RL-40, RL-41, RL-42, RL-43.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import { createHostSettings, type HostSettingsAssembly, type HostSettingsPrivateSnapshot } from '../../src/app/host-settings.js';
import type { HostSettingsPort } from '../../src/app/host-settings-types.js';
import type { BootstrapResponse } from '../../src/app/core-http-types.js';

const MIB = 1_048_576;
const TOTAL_MEMORY_BYTES = totalmem();
const HAND_DEFAULT_MEMORY_MIB = Math.min(Math.floor(TOTAL_MEMORY_BYTES / (2 * MIB)), 6144);
const HAND_TASKS_MAX = 512;
const MACHINE_UPPER_MEMORY_MIB = Math.floor(TOTAL_MEMORY_BYTES / MIB);

const LEGACY_FILE = { schemaVersion: 1, models: [], selection: {}, workspaces: [] };

function assemblyWith(status?: () => unknown): HostSettingsAssembly {
  return {
    listWorkspaces: () => [],
    listProjectIds: () => [],
    secretConfigured: () => false,
    bootstrap: () => ({}) as BootstrapResponse,
    async openWorkspace() { return { status: 'rejected', code: 'unsupported', reason: 'not used by RL-40..43' }; },
    ...(status === undefined ? {} : { resourceCapStatus: status as NonNullable<HostSettingsAssembly['resourceCapStatus']> }),
  };
}

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function settingsDirectory(file: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rl-cap-settings-'));
  dirs.push(dir);
  if (file !== undefined) await writeFile(join(dir, 'host-settings.json'), JSON.stringify(file));
  return dir;
}

async function open(dir: string, status?: () => unknown, failPush: { next: boolean } = { next: false }): Promise<{
  settings: HostSettingsPort; pushed: HostSettingsPrivateSnapshot[];
}> {
  const pushed: HostSettingsPrivateSnapshot[] = [];
  const settings = await createHostSettings({ settingsDirectory: dir, assembly: assemblyWith(status) },
    { onConfigurationChanged(snapshot) {
      if (failPush.next) { failPush.next = false; throw new Error('the Host could not install the configuration'); }
      pushed.push(snapshot);
    } });
  return { settings, pushed };
}

async function storedFile(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, 'host-settings.json'), 'utf8')) as Record<string, unknown>;
}

function capsSnapshot(settings: HostSettingsPort): Promise<unknown> {
  return settings.call('snapshot', {}).then(result => result.status === 'ready' ? result.value.resourceCaps : result);
}

// --------------------------------------------------------------------------- //
// RL-40: defaults, private snapshot and machine status                        //
// --------------------------------------------------------------------------- //

it('RL-40 no settings file publishes the hand-computed defaults and the effective bytes', async () => {
  const { settings, pushed } = await open(await settingsDirectory(undefined));
  expect(await capsSnapshot(settings)).toEqual({
    memoryMaxMiB: null, tasksMax: null,
    defaults: { memoryMaxMiB: HAND_DEFAULT_MEMORY_MIB, tasksMax: HAND_TASKS_MAX },
    effective: { memoryMaxMiB: HAND_DEFAULT_MEMORY_MIB, tasksMax: HAND_TASKS_MAX },
    machine: { status: 'unknown' },
  });
  expect(pushed.at(-1)?.resourceCaps).toEqual({
    memoryMaxBytes: HAND_DEFAULT_MEMORY_MIB * MIB, tasksMax: HAND_TASKS_MAX,
  });
});

it('RL-40 a file without resourceCaps reads the same defaults and keeps the field absent', async () => {
  const dir = await settingsDirectory(LEGACY_FILE);
  const { settings } = await open(dir);
  expect(await capsSnapshot(settings)).toMatchObject({
    memoryMaxMiB: null, tasksMax: null,
    defaults: { memoryMaxMiB: HAND_DEFAULT_MEMORY_MIB, tasksMax: HAND_TASKS_MAX },
    effective: { memoryMaxMiB: HAND_DEFAULT_MEMORY_MIB, tasksMax: HAND_TASKS_MAX },
  });
  expect(await storedFile(dir)).not.toHaveProperty('resourceCaps');
});

it('RL-40 an assembly without resourceCapStatus reports unknown; with one it is copied', async () => {
  const available = await open(await settingsDirectory(undefined), () => ({ status: 'available' }));
  expect(await capsSnapshot(available.settings)).toMatchObject({ machine: { status: 'available' } });

  const unavailable = await open(await settingsDirectory(undefined),
    () => ({ status: 'unavailable', reason: 'no_user_session', detail: 'stub detail' }));
  expect(await capsSnapshot(unavailable.settings)).toEqual({
    memoryMaxMiB: null, tasksMax: null,
    defaults: { memoryMaxMiB: HAND_DEFAULT_MEMORY_MIB, tasksMax: HAND_TASKS_MAX },
    effective: { memoryMaxMiB: HAND_DEFAULT_MEMORY_MIB, tasksMax: HAND_TASKS_MAX },
    machine: { status: 'unavailable', reason: 'no_user_session', text: '没有资源上限：没有 systemd 的用户会话' },
  });
});

// --------------------------------------------------------------------------- //
// RL-41: save, read-back and legacy files                                     //
// --------------------------------------------------------------------------- //

it('RL-41 saves 1024/200, publishes the effective bytes, and a reopened Host reads them back', async () => {
  const dir = await settingsDirectory(LEGACY_FILE);
  const { settings, pushed } = await open(dir);
  const saved = await settings.call('resource-caps/save', { memoryMaxMiB: 1024, tasksMax: 200 });
  expect(saved.status).toBe('ready');
  expect(await capsSnapshot(settings)).toMatchObject({
    memoryMaxMiB: 1024, tasksMax: 200,
    effective: { memoryMaxMiB: 1024, tasksMax: 200 },
  });
  expect(pushed.at(-1)?.resourceCaps).toEqual({ memoryMaxBytes: 1024 * MIB, tasksMax: 200 });
  expect((await storedFile(dir))['resourceCaps']).toEqual({ schemaVersion: 1, memoryMaxMiB: 1024, tasksMax: 200 });

  const reopened = await open(dir);
  expect(await capsSnapshot(reopened.settings)).toMatchObject({ memoryMaxMiB: 1024, tasksMax: 200 });
  expect(reopened.pushed.at(-1)?.resourceCaps).toEqual({ memoryMaxBytes: 1024 * MIB, tasksMax: 200 });
});

it('RL-41 a null memory returns to the default and a legacy file stays without the field on another save', async () => {
  const dir = await settingsDirectory(LEGACY_FILE);
  const { settings } = await open(dir);
  expect((await settings.call('resource-caps/save', { memoryMaxMiB: null, tasksMax: 200 })).status).toBe('ready');
  expect(await capsSnapshot(settings)).toMatchObject({
    memoryMaxMiB: null, tasksMax: 200,
    effective: { memoryMaxMiB: HAND_DEFAULT_MEMORY_MIB, tasksMax: 200 },
  });

  const legacyDir = await settingsDirectory(LEGACY_FILE);
  const legacy = await open(legacyDir);
  expect((await legacy.settings.call('models/save', { label: 'Model A', provider: 'openai', model: 'model-a' })).status).toBe('ready');
  expect(await storedFile(legacyDir)).not.toHaveProperty('resourceCaps');
});

// --------------------------------------------------------------------------- //
// RL-42: validation and inclusive bounds                                      //
// --------------------------------------------------------------------------- //

it.each([
  ['memory 255', { memoryMaxMiB: 255, tasksMax: 200 }],
  ['memory above the machine', { memoryMaxMiB: MACHINE_UPPER_MEMORY_MIB + 1, tasksMax: 200 }],
  ['memory 1.5', { memoryMaxMiB: 1.5, tasksMax: 200 }],
  ['memory "512"', { memoryMaxMiB: '512', tasksMax: 200 }],
  ['tasks 63', { memoryMaxMiB: 512, tasksMax: 63 }],
  ['tasks 65537', { memoryMaxMiB: 512, tasksMax: 65537 }],
  ['tasks true', { memoryMaxMiB: 512, tasksMax: true }],
  ['missing tasks', { memoryMaxMiB: 512 }],
  ['missing memory', { tasksMax: 200 }],
  ['a non-object body', 'caps'],
])('RL-42 refuses %s as invalid, storing and pushing nothing', async (_label, body) => {
  const dir = await settingsDirectory(LEGACY_FILE);
  const { settings, pushed } = await open(dir);
  const before = pushed.length;
  expect(await settings.call('resource-caps/save', body as never)).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(pushed).toHaveLength(before);
  expect(await storedFile(dir)).not.toHaveProperty('resourceCaps');
});

it.each([
  ['memory 256', { memoryMaxMiB: 256, tasksMax: 64 }],
  ['memory at the machine ceiling', { memoryMaxMiB: MACHINE_UPPER_MEMORY_MIB, tasksMax: 65536 }],
  ['null fields', { memoryMaxMiB: null, tasksMax: null }],
])('RL-42 accepts %s', async (_label, body) => {
  const dir = await settingsDirectory(LEGACY_FILE);
  const { settings } = await open(dir);
  expect(await settings.call('resource-caps/save', body as never)).toMatchObject({ status: 'ready' });
});

/** SF-2: the stored private file `resourceCaps` is validated like a saved policy. */
function storedCaps(memoryMaxMiB: number | null, tasksMax: number | null): Record<string, unknown> {
  return { ...LEGACY_FILE, resourceCaps: { schemaVersion: 1, memoryMaxMiB, tasksMax } };
}

it.each([
  ['memory 0', 0, null],
  ['memory 255', 255, null],
  ['tasks 0', null, 0],
  ['tasks 63', null, 63],
  ['tasks 65537', null, 65537],
])('RL-42 (stored) a stored resourceCaps of %s fails start-up instead of reading defaults', async (_label, memoryMaxMiB, tasksMax) => {
  // `createHostSettings` wraps every present-but-corrupt file in the same
  // start-up failure (the A2 automation precedent asserts a bare rejection);
  // the range check supplies the only reason this otherwise-valid file is corrupt.
  await expect(open(await settingsDirectory(storedCaps(memoryMaxMiB, tasksMax))))
    .rejects.toThrow('the private host settings file could not be loaded');
});

it('RL-42 (stored) a stored memory above any test machine loads and pushes the literal bytes', async () => {
  const { settings, pushed } = await open(await settingsDirectory(storedCaps(4_194_304, null)));
  expect(pushed.at(-1)?.resourceCaps).toEqual({ memoryMaxBytes: 4_398_046_511_104, tasksMax: HAND_TASKS_MAX });
  expect(await capsSnapshot(settings)).toMatchObject({ memoryMaxMiB: 4_194_304,
    effective: { memoryMaxMiB: 4_194_304 } });
});

// --------------------------------------------------------------------------- //
// RL-43: write and push failures                                              //
// --------------------------------------------------------------------------- //

it('RL-43 a failed write answers unavailable, keeps the previous value and pushes nothing', async () => {
  const dir = await settingsDirectory({ ...LEGACY_FILE,
    resourceCaps: { schemaVersion: 1, memoryMaxMiB: 700, tasksMax: 321 } });
  const { settings, pushed } = await open(dir);
  const before = pushed.length;
  await rm(join(dir, 'host-settings.json'));
  await mkdir(join(dir, 'host-settings.json', 'blocked'), { recursive: true });
  expect(await settings.call('resource-caps/save', { memoryMaxMiB: 300, tasksMax: 100 }))
    .toEqual({ status: 'rejected', code: 'unavailable', reason: 'the settings file could not be written' });
  expect(pushed).toHaveLength(before);
  expect(await capsSnapshot(settings)).toMatchObject({ memoryMaxMiB: 700, tasksMax: 321 });
});

it('RL-43 a save the Host does not confirm is stored and answers unavailable, to be retried', async () => {
  const dir = await settingsDirectory(LEGACY_FILE);
  const failPush = { next: false };
  const { settings, pushed } = await open(dir, undefined, failPush);
  const before = pushed.length;
  failPush.next = true;
  expect(await settings.call('resource-caps/save', { memoryMaxMiB: 300, tasksMax: 100 })).toEqual({ status: 'rejected',
    code: 'unavailable', reason: 'the resource caps were saved but the Host configuration was not confirmed; retry the same save' });
  expect(pushed).toHaveLength(before);
  expect((await storedFile(dir))['resourceCaps']).toEqual({ schemaVersion: 1, memoryMaxMiB: 300, tasksMax: 100 });
  expect(await settings.call('resource-caps/save', { memoryMaxMiB: 300, tasksMax: 100 })).toMatchObject({ status: 'ready' });
  expect(pushed.at(-1)?.resourceCaps).toEqual({ memoryMaxBytes: 300 * MIB, tasksMax: 100 });
});
