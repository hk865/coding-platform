/**
 * A.2 step 1 (spec §15.2 第 1 步; C8, LA-6): the Host setting `automation`.
 *
 * A settings file written before A.2 has no `automation`; it must keep loading,
 * the Host-internal snapshot must read `DEFAULT_TASK_AUTOMATION_POLICY`
 * (3 automatic reworks, ask at start-up) and the file must not be rewritten
 * with a default it never stored. A stored policy is validated at start-up and
 * kept across saves. Since A.2 step 5.8 the public snapshot publishes the
 * stored policy (the defaults when none was saved), and
 * `automation/save` stores the whole policy, rolls back a failed write and
 * pushes the saved policy to the Host. Real temporary directories, no
 * provider, no model.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createHostSettings, type HostSettingsAssembly, type HostSettingsPrivateSnapshot,
} from '../../src/app/host-settings.js';
import type { HostSettingsPort } from '../../src/app/host-settings-types.js';
import type { BootstrapResponse } from '../../src/app/core-http-types.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, type TaskAutomationPolicyV1 } from '../../src/contracts/task-requeue.js';

const assembly: HostSettingsAssembly = {
  listWorkspaces: () => [],
  secretConfigured: () => false,
  bootstrap: () => ({}) as BootstrapResponse, // not consumed by these settings assertions
  async openWorkspace() { return { status: 'rejected', code: 'unsupported', reason: 'not used by these tests' }; },
};
/** The file shape every Host wrote before A.2. */
const LEGACY_FILE = { schemaVersion: 1, models: [], selection: {}, workspaces: [] };

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function settingsDirectory(file: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'a2-settings-automation-'));
  dirs.push(dir);
  if (file !== undefined) await writeFile(join(dir, 'host-settings.json'), JSON.stringify(file));
  return dir;
}
async function open(dir: string, failPush: { next: boolean } = { next: false }): Promise<{
  settings: HostSettingsPort; pushed: HostSettingsPrivateSnapshot[];
}> {
  const pushed: HostSettingsPrivateSnapshot[] = [];
  const settings = await createHostSettings({ settingsDirectory: dir, assembly },
    { onConfigurationChanged(snapshot) {
      if (failPush.next) { failPush.next = false; throw new Error('the Host could not install the configuration'); }
      pushed.push(snapshot);
    } });
  return { settings, pushed };
}
async function storedFile(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, 'host-settings.json'), 'utf8')) as Record<string, unknown>;
}
const saveModel = { label: 'Model A', provider: 'openai' as const, model: 'model-a' };

describe('Host setting automation (C8)', () => {
  it('a settings file without automation reads the defaults and the public snapshot publishes them', async () => {
    const { settings, pushed } = await open(await settingsDirectory(LEGACY_FILE));
    expect(pushed.at(-1)?.automation).toEqual(DEFAULT_TASK_AUTOMATION_POLICY);
    expect(pushed.at(-1)?.automation).toEqual({ schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'ask' });
    // §15.2 5.8: the snapshot carries the stored policy (the defaults here, none was saved).
    // RL L13: resourceCaps is always published; its content is RL-40's.
    expect(await settings.call('snapshot', {})).toEqual({ status: 'ready', value: { models: [], workspaces: [],
      automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'ask' }, resourceCaps:
      expect.objectContaining({ memoryMaxMiB: null, tasksMax: null }) } });
  });

  it('a Host without a settings file reads the defaults', async () => {
    const { pushed } = await open(await settingsDirectory(undefined));
    expect(pushed.at(-1)?.automation).toEqual(DEFAULT_TASK_AUTOMATION_POLICY);
  });

  it('the defaults are a copy: changing a pushed snapshot changes neither the next one nor the constant', async () => {
    const { settings, pushed } = await open(await settingsDirectory(LEGACY_FILE));
    const first = pushed.at(-1);
    if (first === undefined) throw new Error('no configuration was pushed');
    first.automation.autoReworkLimit = 9;
    expect(DEFAULT_TASK_AUTOMATION_POLICY.autoReworkLimit).toBe(3);
    expect((await settings.call('models/save', saveModel)).status).toBe('ready');
    expect(pushed.at(-1)?.automation).toEqual(DEFAULT_TASK_AUTOMATION_POLICY);
  });

  it('a legacy file is not rewritten with automation on the next save', async () => {
    const dir = await settingsDirectory(LEGACY_FILE);
    const { settings } = await open(dir);
    expect((await settings.call('models/save', saveModel)).status).toBe('ready');
    const stored = await storedFile(dir);
    expect(stored['models']).toHaveLength(1);
    expect(stored).not.toHaveProperty('automation');
  });

  it.each([
    ['a limit above 10', { schemaVersion: 1, autoReworkLimit: 11, resumeOnStartup: 'auto' }],
    ['a negative limit', { schemaVersion: 1, autoReworkLimit: -1, resumeOnStartup: 'auto' }],
    ['a fractional limit', { schemaVersion: 1, autoReworkLimit: 1.5, resumeOnStartup: 'auto' }],
    ['another schema version', { schemaVersion: 2, autoReworkLimit: 1, resumeOnStartup: 'auto' }],
    ['a missing resumeOnStartup', { schemaVersion: 1, autoReworkLimit: 1 }],
    ['a non-object', 'auto'],
  ])('a stored policy with %s fails start-up instead of reading defaults', async (_label, automation) => {
    await expect(open(await settingsDirectory({ ...LEGACY_FILE, automation }))).rejects.toThrow();
  });

  it('the largest allowed limit (10) is accepted', async () => {
    const automation: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 10, resumeOnStartup: 'auto' };
    const { pushed } = await open(await settingsDirectory({ ...LEGACY_FILE, automation }));
    expect(pushed.at(-1)?.automation).toEqual(automation);
  });
});

describe('automation/save (C8, LA-6; A.2 step 5.8)', () => {
  it.each([
    ['no stored policy', undefined],
    ['a stored zero/off policy', { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: 'off' } as TaskAutomationPolicyV1],
  ] as [string, TaskAutomationPolicyV1 | undefined][])(
    'stores the whole policy, pushes it to the Host and publishes it; a reopened Host reads it back (%s)',
    async (_label, stored) => {
      const dir = await settingsDirectory(stored === undefined ? LEGACY_FILE : { ...LEGACY_FILE, automation: stored });
      let opened = await open(dir);
      let expectedModels: unknown[] = [];
      if (stored !== undefined) {
        // T3-004 (was "a stored policy is read as stored and survives the next save", w2-base :95-104):
        // the stored zero/off policy is read at start-up, another setting's save (models/save)
        // leaves it in the file, and a reopened Host reads it back.
        expect(opened.pushed.at(-1)?.automation).toEqual(stored);
        const modelSaved = await opened.settings.call('models/save', saveModel);
        expect(modelSaved.status).toBe('ready');
        expect((await storedFile(dir))['automation']).toEqual(stored);
        opened = await open(dir);
        expect(opened.pushed.at(-1)?.automation).toEqual(stored);
        // The saved model is published from now on (publicModel): saveModel's fields, baseUrl ''
        // (none given), credentialConfigured false (no apiKey, no secret env). Its id is issued by
        // the save, so it is taken as the models/save result returned it.
        const issuedId = modelSaved.status === 'ready' ? modelSaved.value.models[0]?.id : undefined;
        expect(issuedId).toEqual(expect.any(String));
        expectedModels = [{ id: issuedId, label: 'Model A', provider: 'openai', model: 'model-a', baseUrl: '',
          credentialConfigured: false }];
      }
      const { settings, pushed } = opened;
      const before = pushed.length;
      const saved = await settings.call('automation/save', { autoReworkLimit: 5, resumeOnStartup: 'off' });
      const policy: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 5, resumeOnStartup: 'off' };
      // RL L13: resourceCaps is always published; its content is RL-40's.
      expect(saved).toEqual({ status: 'ready', value: { models: expectedModels, workspaces: [], automation: policy,
        resourceCaps: expect.objectContaining({ memoryMaxMiB: null, tasksMax: null }) } });
      expect(pushed).toHaveLength(before + 1);
      expect(pushed.at(-1)?.automation).toEqual(policy);
      expect((await storedFile(dir))['automation']).toEqual(policy);
      // Another setting's save keeps the stored policy.
      expect((await settings.call('models/save', saveModel)).status).toBe('ready');
      expect((await storedFile(dir))['automation']).toEqual(policy);
      expect(pushed.at(-1)?.automation).toEqual(policy);
      const reopened = await open(dir);
      expect(reopened.pushed.at(-1)?.automation).toEqual(policy);
      expect(await reopened.settings.call('snapshot', {})).toMatchObject({ status: 'ready', value: { automation: policy } });
      // The bounds are inclusive: 0 (no counted automatic requeue) and 10.
      for (const autoReworkLimit of [0, 10]) {
        expect(await settings.call('automation/save', { autoReworkLimit, resumeOnStartup: 'auto' }))
          .toMatchObject({ status: 'ready', value: { automation: { schemaVersion: 1, autoReworkLimit, resumeOnStartup: 'auto' } } });
      }
  });

  it.each([
    ['a non-object body', 'auto'],
    ['a limit above 10', { autoReworkLimit: 11, resumeOnStartup: 'auto' }],
    ['a negative limit', { autoReworkLimit: -1, resumeOnStartup: 'auto' }],
    ['a fractional limit', { autoReworkLimit: 1.5, resumeOnStartup: 'auto' }],
    ['a string limit', { autoReworkLimit: '3', resumeOnStartup: 'auto' }],
    ['a missing limit', { resumeOnStartup: 'auto' }],
    ['a missing resumeOnStartup', { autoReworkLimit: 3 }],
    ['a string resumeOnStartup', { autoReworkLimit: 3, resumeOnStartup: 'yes' }],
    ['a boolean resumeOnStartup', { autoReworkLimit: 3, resumeOnStartup: false },
      { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' }],
  ] as [string, unknown, TaskAutomationPolicyV1?][])('refuses %s as invalid: nothing is stored or pushed',
    async (_label, body, stored) => {
      const dir = await settingsDirectory(stored === undefined ? LEGACY_FILE : { ...LEGACY_FILE, automation: stored });
      const { settings, pushed } = await open(dir);
      const before = pushed.length;
      expect(await settings.call('automation/save', body as never)).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(pushed).toHaveLength(before);
      if (stored === undefined) expect(await storedFile(dir)).not.toHaveProperty('automation');
      else expect((await storedFile(dir))['automation']).toEqual(stored);
      expect(await settings.call('snapshot', {})).toMatchObject({ status: 'ready',
        value: { automation: stored ?? DEFAULT_TASK_AUTOMATION_POLICY } });
    });

  it('a failed write keeps the previous policy and pushes nothing', async () => {
    const stored: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 2, resumeOnStartup: 'auto' };
    const dir = await settingsDirectory({ ...LEGACY_FILE, automation: stored });
    const { settings, pushed } = await open(dir);
    const before = pushed.length;
    // The settings file is replaced by a non-empty directory: the atomic rename of the next write fails.
    await rm(join(dir, 'host-settings.json'));
    await mkdir(join(dir, 'host-settings.json', 'blocked'), { recursive: true });
    expect(await settings.call('automation/save', { autoReworkLimit: 7, resumeOnStartup: 'off' }))
      .toEqual({ status: 'rejected', code: 'unavailable', reason: 'the settings file could not be written' });
    expect(pushed).toHaveLength(before);
    expect(await settings.call('snapshot', {})).toMatchObject({ status: 'ready', value: { automation: stored } });
  });

  it('a save the Host does not confirm is still stored and answers unavailable, to be retried', async () => {
    const dir = await settingsDirectory(LEGACY_FILE);
    const failPush = { next: false };
    const { settings, pushed } = await open(dir, failPush);
    const before = pushed.length;
    failPush.next = true;
    const policy: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 4, resumeOnStartup: 'auto' };
    expect(await settings.call('automation/save', { autoReworkLimit: 4, resumeOnStartup: 'auto' })).toEqual({ status: 'rejected',
      code: 'unavailable', reason: 'the automation policy was saved but the Host configuration was not confirmed; retry the same save' });
    expect(pushed).toHaveLength(before);
    expect((await storedFile(dir))['automation']).toEqual(policy);
    // The snapshot is the stored policy, not a confirmation that the Host applies it.
    expect(await settings.call('snapshot', {})).toMatchObject({ status: 'ready', value: { automation: policy } });
    // The retry of the same save pushes it.
    expect(await settings.call('automation/save', { autoReworkLimit: 4, resumeOnStartup: 'auto' }))
      .toMatchObject({ status: 'ready', value: { automation: policy } });
    expect(pushed.at(-1)?.automation).toEqual(policy);
  });

  it.each(['auto', 'ask', 'off'] as const)(
    'SMK3B-5: the save takes resumeOnStartup %s and a reopened Host reads the saved mode back',
    async (resumeOnStartup) => {
      const dir = await settingsDirectory(LEGACY_FILE);
      const { settings, pushed } = await open(dir);
      expect(await settings.call('automation/save', { autoReworkLimit: 3, resumeOnStartup }))
        .toMatchObject({ status: 'ready', value: { automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup } } });
      expect(pushed.at(-1)?.automation).toEqual({ schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup });
      const reopened = await open(dir);
      expect(reopened.pushed.at(-1)?.automation).toEqual({ schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup });
      expect(await reopened.settings.call('snapshot', {})).toMatchObject({ status: 'ready',
        value: { automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup } } });
    });
});
