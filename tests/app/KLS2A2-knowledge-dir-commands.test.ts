/**
 * KLS-2 (lead ruling 11-11 on F6): commands mount `.workbench/` read-only, so a knowledge directory deleted (or
 * removed by a branch switch) while the Host runs is made again before the next command starts; the command then
 * runs, and a write into `.workbench/` is still refused. One row per place a command starts: a workbench command
 * through the real Host route, and a Work Run's shell through the public Runtime steps. Real bubblewrap.
 *
 * Named mutations: drop `ensureKnowledgeDirectory` from `startCommand` (src/app/workbench-tools.ts) → row 1 is red at
 * `error: null` (the command answers `launch_failed`); drop it from the Run start (src/core/agent-runtime/
 * execution-driver.ts) → row 2 is red at the first shell result's `status: 'success'`.
 */
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { corePost, plain, readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import { writeHostPage } from '../helpers/host-page.js';
import { createS2BBe1Platform, type S2BBe1PlatformFixture } from '../helpers/S2B-be1-platform-fixture.js';

const scope: CoreScope = { projectId: 'kls2a2-dir-project', workspaceId: 'kls2a2-dir-workspace' };
const temporary: string[] = [];
const hosts: LocalWorkbenchHost[] = [];
const platforms: S2BBe1PlatformFixture[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  for (const fixture of platforms.splice(0)) await fixture.close();
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

type CommandRead = { status: string; value?: { state: string; exitCode: number | null; stdout: string; stderr: string;
  error: { code: string } | null } };

async function runCommand(base: string, token: string, requestId: string, command: string): Promise<CommandRead> {
  const started = await (await corePost(base, 'commands/start', token,
    plain(scope, { requestId, command, cwd: '.' }))).json() as { status: string; value: { commandId: string } };
  expect(started.status).toBe('ready');
  for (;;) {
    const read = await (await corePost(base, 'commands/read', token,
      plain(scope, { commandId: started.value.commandId }))).json() as CommandRead;
    if (read.value?.state !== 'running' && read.value?.state !== 'stopping') return read;
    await new Promise(resolve => { setTimeout(resolve, 50); });
  }
}

it('KLS2A2-D1 a workbench command remakes a deleted .workbench/ before it starts, runs, and still cannot write it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kls2a2-dir-ws-'));
  const database = await mkdtemp(join(tmpdir(), 'kls2a2-dir-db-'));
  const publicDir = await mkdtemp(join(tmpdir(), 'kls2a2-dir-public-'));
  temporary.push(root, database, publicDir);
  await writeHostPage(publicDir);
  const host = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: database }, actor: { kind: 'human', id: 'kls2a2-dir-operator' }, publicDir,
    workspaces: [{ scope, name: 'KLS2A2 dir workspace', root, workspaceRevision: 1, readPrefixes: ['.'],
      writePrefixes: ['.'], allowCommands: true }],
  });
  hosts.push(host);
  const base = (await host.listen()).url;
  const token = await readPageToken(base);
  await rm(join(root, '.workbench'), { recursive: true, force: true });

  const ran = await runCommand(base, token, 'kls2a2-dir-echo', 'echo kls2a2-dir-ok');
  expect(ran).toMatchObject({ status: 'ready', value: { state: 'settled', error: null, exitCode: 0, stdout: 'kls2a2-dir-ok\n' } });
  expect(statSync(join(root, '.workbench')).isDirectory()).toBe(true);

  const write = await runCommand(base, token, 'kls2a2-dir-touch', 'touch .workbench/blocked');
  expect(write.value?.exitCode).toBe(1);
  expect(write.value?.stderr).toContain('Read-only file system');
  expect(existsSync(join(root, '.workbench', 'blocked'))).toBe(false);
}, 60_000);

/** The tool result the model saw for one call in the final request. */
function toolResult(fixture: S2BBe1PlatformFixture, callId: string): unknown {
  return fixture.scripted.requests.at(-1)?.messages.find(message => message.role === 'tool' && message.callId === callId);
}

it('KLS2A2-D2 a Work Run remakes a .workbench/ deleted after its preparation before its commands, which still cannot write it', async () => {
  const f = await createS2BBe1Platform({ toolNames: ['read', 'write', 'shell'], writeScope: ['.'], shell: true,
    initialAt: '2026-11-11T10:00:00.000Z',
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'd2-echo', name: 'shell', args: { command: 'echo kls2a2-run-ok' } }] },
      { kind: 'calls', calls: [{ callId: 'd2-touch', name: 'shell', args: { command: 'touch .workbench/blocked' } }] },
      { kind: 'text', text: 'KLS2A2-D2 done' },
    ],
  });
  platforms.push(f);
  const prepared = await f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef, requestId: 'kls2a2-d2-prepare' });
  if (prepared.status !== 'ready') throw new Error(`KLS2A2-D2 prepare failed: ${JSON.stringify(prepared)}`);
  await rm(join(f.directory, '.workbench'), { recursive: true, force: true });
  const started = await f.platform.runtime.startRun(f.ctx, { prepared: prepared.value,
    consumerId: 'kls2a2-d2-driver', requestId: 'kls2a2-d2-start' });
  expect(started.status).toBe('ready');

  expect(toolResult(f, 'd2-echo')).toMatchObject({ result: { status: 'success' } });
  expect(statSync(join(f.directory, '.workbench')).isDirectory()).toBe(true);
  expect(toolResult(f, 'd2-touch')).toMatchObject({ result: { status: 'error', error: { code: 'execution_failed' } } });
  expect(existsSync(join(f.directory, '.workbench', 'blocked'))).toBe(false);
}, 120_000);
