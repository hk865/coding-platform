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
import { createR3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createRegisteredCheckRunner, type RegisteredCheckKernel } from '../../src/core/agent-runtime/check-execution.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';

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

/* AGTP-7 (AGT+ ruling §3; §1 item 4): every place a command starts mounts `.workbench/` read-only, and the check
 * runner remakes the directory before it starts. A registered check whose command tries to write into a deleted
 * `.workbench/` therefore runs (not `not_started`), fails with a non-zero exit, leaves the remade directory in place
 * and creates no file. Real bubblewrap. Today red at the `.workbench` assertion: check-execution neither remakes the
 * directory nor passes `readOnlyPaths`, so the parent is missing and `touch` fails for the wrong reason. The package
 * remakes it first (execution-driver.ts:527's pattern) and mounts it read-only for the probe and the execute. */
it('AGTP-7 a check remakes a deleted .workbench/ read-only, runs and cannot write it', async () => {
  const fixture = await createR3eEvidenceFixture('sqlite');
  const check = { ...fixture.passCheck, checkId: 'agtp-7-check', command: 'touch .workbench/agtp-check' };
  await fixture.b2.base.closeBackend();
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory: fixture.b2.base.storeDirectory },
    workspace: fixture.workspaceHost,
    checks: { ...fixture.configuration, checks: [check] },
    now: () => B2_AT,
  });
  try {
    const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
    if (opened.status !== 'committed') throw new Error(`AGTP-7 open failed: ${JSON.stringify(opened)}`);
    await rm(join(fixture.workspaceRoot, '.workbench'), { recursive: true, force: true });
    expect(existsSync(join(fixture.workspaceRoot, '.workbench'))).toBe(false);
    const ran = await platform.checks.runRegisteredCheck(fixture.ctx, {
      input: { roundRef: opened.value.ref, checkId: check.checkId },
      meta: { requestId: 'agtp-7-check', expected: [{ ref: opened.value.ref, revision: opened.value.revision }] },
    });
    if (ran.status !== 'ready') throw new Error(`AGTP-7 run failed: ${JSON.stringify(ran)}`);
    const snapshot = ran.value.checks.find(candidate => candidate.checkId === check.checkId);
    if (snapshot === undefined) throw new Error('AGTP-7 the round has no check result');
    // Executed and failed: `not_started` would be INCONCLUSIVE, not FAIL.
    expect(snapshot).toMatchObject({ phase: 'finished', outcome: 'FAIL' });
    expect(statSync(join(fixture.workspaceRoot, '.workbench')).isDirectory()).toBe(true);
    expect(existsSync(join(fixture.workspaceRoot, '.workbench', 'agtp-check'))).toBe(false);
    if (snapshot.reportRef === null) throw new Error('AGTP-7 the check has no report');
    const report = await platform.materials.openArtifact(fixture.ctx,
      { ref: snapshot.reportRef, usage: 'historical_explanation' });
    if (report.status !== 'ready') throw new Error('AGTP-7 the check report was not readable');
    const body = JSON.parse(report.value.body) as { observation?: { kind?: string; exitCode?: number | null } };
    expect(body.observation?.kind).toBe('executed');
    expect(body.observation?.exitCode).not.toBe(0);
  } finally {
    await platform.close();
    await fixture.close();
  }
});

/* AGTP-6 (AGT+ ruling §3; §2 item 17): the check runner's capability probe and
 * the process it launches share ONE options object, so the probe proves the
 * real `.workbench/` read-only mount. A probe passed `{}` starts a sandbox the
 * check never proved. Named mutation: `probe(root, workspace, {})` → red. */
it('AGTP-6 a registered check probes with the exact options it executes with', async () => {
  const fixture = await createR3eEvidenceFixture('memory');
  try {
    const probes: Array<Record<string, unknown>> = [];
    const executions: Array<Record<string, unknown>> = [];
    class RecordingSandbox {
      constructor(_profile: unknown, _root: string, _workspace: unknown, options?: Record<string, unknown>) {
        executions.push(options ?? {});
      }
      async execute() {
        return { exitCode: 0, signal: null, timedOut: false, cancelled: false,
          stdout: { text: '', totalBytes: 0, truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
          effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
          sandboxProfileVersion: 'agtp-6', timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
          resourceCaps: { status: 'none', reason: 'not_configured', text: 'x' } };
      }
      static async probe(_root: unknown, _workspace: unknown, options?: Record<string, unknown>) {
        probes.push(options ?? {});
        return { available: true, version: 'agtp-6', bwrapPath: null, reason: null };
      }
    }
    const runner = createRegisteredCheckRunner({
      evidence: fixture.evidence, workspaceHost: fixture.workspaceHost,
      kernel: { WorkspaceSandbox: kernel.WorkspaceSandbox, ProcessSandbox: RecordingSandbox,
        ProcessSandboxError: kernel.ProcessSandboxError } as unknown as RegisteredCheckKernel,
      now: () => B2_AT,
    });
    const opened = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest());
    if (opened.status !== 'committed') throw new Error(`AGTP-6 open failed: ${JSON.stringify(opened)}`);
    const ran = await runner.runRegisteredCheck(fixture.ctx, { input: { roundRef: opened.value.ref,
      checkId: fixture.passCheck.checkId }, meta: { requestId: 'agtp-6-probe-options',
      expected: [{ ref: opened.value.ref, revision: opened.value.revision }] } });
    if (ran.status !== 'ready') throw new Error(`AGTP-6 run failed: ${JSON.stringify(ran)}`);
    const expected = [{ readOnlyPaths: ['.workbench'] }];
    expect(probes).toEqual(expected);
    expect(executions).toEqual(expected);
  } finally { await fixture.close(); }
});

