/**
 * KLS-2a-2 after the code review (level 1): the settings route `knowledge-local` on a real Host (the AG2b scenario
 * on a git root) keeps git's exclude file and the saved setting in step. D3: a settings file that cannot be written
 * leaves both as they were, turning the setting on or off. D6: the exclude file is changed as bytes, so a line that
 * is not UTF-8 survives turning the setting on and off. The checks are the bytes of `<root>/.git/info/exclude` and
 * the workspace's `knowledgeLocalOnly` in `settings/snapshot`.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import { SETTINGS_API_PREFIX } from '../../src/app/host-settings-types.js';
import { AG2B_SCOPE } from '../helpers/AG2b-collaboration-fixture.js';
import { openHostScenario, type HostScenario } from '../scenarios/harness.js';

const MARKER = '# dsh: architecture and notes stay local';
const opened: HostScenario[] = [];
afterEach(async () => { for (const scenario of opened.splice(0)) await scenario.dispose(); });

async function openScenario(): Promise<HostScenario> {
  const scenario = await openHostScenario({ gitWorkspace: true, workIds: null });
  opened.push(scenario);
  return scenario;
}

async function settings(scenario: HostScenario, route: string, body: unknown): Promise<any> {
  const response = await fetch(new URL(`${SETTINGS_API_PREFIX}${route}`, scenario.host.base), { method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: scenario.host.token },
    body: JSON.stringify(body) });
  return await response.json();
}

const setLocalOnly = (scenario: HostScenario, localOnly: boolean): Promise<any> =>
  settings(scenario, 'knowledge-local', { ...AG2B_SCOPE, localOnly });

async function snapshotLocalOnly(scenario: HostScenario): Promise<unknown> {
  const snapshot = await settings(scenario, 'snapshot', {});
  return snapshot.value?.workspaces?.map((entry: { knowledgeLocalOnly: unknown }) => entry.knowledgeLocalOnly);
}

/** The exclude file with the person's own lines in it before the setting is touched. */
async function excludeWith(scenario: HostScenario, bytes: Buffer): Promise<string> {
  const exclude = join(scenario.root, '.git', 'info', 'exclude');
  await mkdir(dirname(exclude), { recursive: true });
  await writeFile(exclude, bytes);
  return exclude;
}

it('KLS2A2-D3 a settings file that cannot be written leaves the exclude file and the setting as they were, turning on or off', async () => {
  const scenario = await openScenario();
  const exclude = await excludeWith(scenario, Buffer.from('# the person\'s own lines\n*.log\n'));
  const settingsFile = join(scenario.database, 'host-settings', 'host-settings.json');
  // The settings file's place turns into a directory, so the next save cannot replace it.
  const breakSettings = async (): Promise<void> => { await rm(settingsFile, { force: true }); await mkdir(settingsFile); };
  expect(await setLocalOnly(scenario, true)).toMatchObject({ status: 'ready' });
  expect(existsSync(settingsFile)).toBe(true);
  const on = await readFile(exclude);
  await breakSettings();
  expect(await setLocalOnly(scenario, false)).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(await readFile(exclude)).toEqual(on);
  expect(await snapshotLocalOnly(scenario)).toEqual([true]);
  await rm(settingsFile, { recursive: true });
  expect(await setLocalOnly(scenario, false)).toMatchObject({ status: 'ready' });
  const off = await readFile(exclude);
  expect(off.toString('latin1')).not.toContain(MARKER);
  await breakSettings();
  expect(await setLocalOnly(scenario, true)).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(await readFile(exclude)).toEqual(off);
  expect(await snapshotLocalOnly(scenario)).toEqual([false]);
  await rm(settingsFile, { recursive: true });
}, 120_000);

it('KLS2A2-D6 a line that is not UTF-8 in the exclude file keeps its bytes when the setting is turned on and off', async () => {
  const scenario = await openScenario();
  // `caf\xe9/` is a Latin-1 line: 0xe9 alone is not UTF-8.
  const original = Buffer.concat([Buffer.from('# the person\'s own lines\r\n'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x2f, 0x0a]),
    Buffer.from('*.log\n')]);
  const exclude = await excludeWith(scenario, original);
  expect(await setLocalOnly(scenario, true)).toMatchObject({ status: 'ready' });
  expect(await readFile(exclude)).toEqual(Buffer.concat([original, Buffer.from(`${MARKER}\n.workbench/\n`)]));
  expect(await setLocalOnly(scenario, false)).toMatchObject({ status: 'ready' });
  expect(await readFile(exclude)).toEqual(original);
}, 120_000);
