/**
 * A.2 step 1 (spec §15.2 第 1 步; C8, LA-6): the Host setting `automation`.
 *
 * A settings file written before A.2 has no `automation`; it must keep loading,
 * the Host-internal snapshot must read `DEFAULT_TASK_AUTOMATION_POLICY`
 * (3 automatic reworks, resume on start-up) and the file must not be rewritten
 * with a default it never stored. A stored policy is validated at start-up and
 * kept across saves. Step 1 publishes nothing new over HTTP, so the public
 * snapshot is unchanged. Real temporary directories, no provider, no model.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  listProjectIds: () => [],
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
async function open(dir: string): Promise<{ settings: HostSettingsPort; pushed: HostSettingsPrivateSnapshot[] }> {
  const pushed: HostSettingsPrivateSnapshot[] = [];
  const settings = await createHostSettings({ settingsDirectory: dir, assembly },
    { onConfigurationChanged(snapshot) { pushed.push(snapshot); } });
  return { settings, pushed };
}
async function storedFile(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, 'host-settings.json'), 'utf8')) as Record<string, unknown>;
}
const saveModel = { label: 'Model A', provider: 'openai' as const, model: 'model-a' };

describe('Host setting automation (C8)', () => {
  it('a settings file without automation reads the defaults and the public snapshot is unchanged', async () => {
    const { settings, pushed } = await open(await settingsDirectory(LEGACY_FILE));
    expect(pushed.at(-1)?.automation).toEqual(DEFAULT_TASK_AUTOMATION_POLICY);
    expect(pushed.at(-1)?.automation).toEqual({ schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: true });
    expect(await settings.call('snapshot', {})).toEqual({ status: 'ready', value: { models: [], workspaces: [] } });
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

  it('a stored policy is read as stored and survives the next save', async () => {
    const automation: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: false };
    const dir = await settingsDirectory({ ...LEGACY_FILE, automation });
    const { settings, pushed } = await open(dir);
    expect(pushed.at(-1)?.automation).toEqual(automation);
    expect((await settings.call('models/save', saveModel)).status).toBe('ready');
    expect((await storedFile(dir))['automation']).toEqual(automation);
    const reopened = await open(dir);
    expect(reopened.pushed.at(-1)?.automation).toEqual(automation);
  });

  it.each([
    ['a limit above 10', { schemaVersion: 1, autoReworkLimit: 11, resumeOnStartup: true }],
    ['a negative limit', { schemaVersion: 1, autoReworkLimit: -1, resumeOnStartup: true }],
    ['a fractional limit', { schemaVersion: 1, autoReworkLimit: 1.5, resumeOnStartup: true }],
    ['another schema version', { schemaVersion: 2, autoReworkLimit: 1, resumeOnStartup: true }],
    ['a missing resumeOnStartup', { schemaVersion: 1, autoReworkLimit: 1 }],
    ['a non-object', 'auto'],
  ])('a stored policy with %s fails start-up instead of reading defaults', async (_label, automation) => {
    await expect(open(await settingsDirectory({ ...LEGACY_FILE, automation }))).rejects.toThrow();
  });

  it('the largest allowed limit (10) is accepted', async () => {
    const automation: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 10, resumeOnStartup: true };
    const { pushed } = await open(await settingsDirectory({ ...LEGACY_FILE, automation }));
    expect(pushed.at(-1)?.automation).toEqual(automation);
  });
});
