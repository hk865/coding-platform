/**
 * RL slice rows RL-35 and RL-36 (RE2): an unavailable sandbox is refused exactly
 * as today (rule 1) and a `launch_failed` startup failure is reported, never
 * retried (spec §5.2 RL-35/RL-36, L11).
 *
 * Builds: the scripted Work/Query chains, a registered-check platform and the
 * workbench command port, all with the RL Kernel double.
 * Rows: RL-35, RL-36.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createWorkbenchTools } from '../../src/app/workbench-tools.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { MaterialSourceScope } from '../../src/contracts/material-access.js';
import { ProcessSandboxError } from '../../vendor/coding-agent/dist/public-api.js';
import { createS2BBe1Platform, type S2BBe1PlatformFixture } from '../helpers/S2B-be1-platform-fixture.js';
import { createRLQueryFixture, rlQueryHostCtx, type RLQueryFixture } from '../helpers/RL-query-fixture.js';
import { createR3eEvidenceFixture, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import { rlSandbox } from '../helpers/RL-kernel-sandbox-double.js';
import { readRLStoredToolResult } from '../helpers/RL-re2-support.js';
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const { mockRLKernelSandboxModule } = await import('../helpers/RL-kernel-sandbox-double.js');
  return await mockRLKernelSandboxModule(importOriginal as never);
});

const fixtures: Array<{ close(): Promise<void> }> = [];
const directories: string[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) await fixture.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  rlSandbox.reset();
  vi.restoreAllMocks();
});

function shellWork(callId = 'rl35-shell'): Promise<S2BBe1PlatformFixture> {
  return createS2BBe1Platform({ toolNames: ['read', 'shell'], writeScope: ['.'], shell: true, scriptedReplies: [
    { kind: 'calls', calls: [{ callId, name: 'shell', args: { command: 'echo never' } }] },
    { kind: 'text', text: 'RL-35 shell done' }] });
}

function readonlyWork(callId = 'rl35-readonly'): Promise<S2BBe1PlatformFixture> {
  return createS2BBe1Platform({ toolNames: ['read', 'run_readonly_command'], writeScope: [], readonlyCommands: true, scriptedReplies: [
    { kind: 'calls', calls: [{ callId, name: 'run_readonly_command', args: { command: 'ls' } }] },
    { kind: 'text', text: 'RL-35 readonly done' }] });
}

function queryReadonly(callId = 'rl35-query'): Promise<RLQueryFixture> {
  return createRLQueryFixture({ replies: [
    { kind: 'calls', calls: [{ callId, name: 'run_readonly_command', args: { command: 'ls' } }] },
    { kind: 'text', text: 'RL-35 query done' }] });
}

async function checkPlatform(): Promise<{ fixture: R3eEvidenceFixture; platform: Awaited<ReturnType<typeof createTargetPlatform>> }> {
  const fixture = await createR3eEvidenceFixture('sqlite');
  fixtures.push(fixture);
  await fixture.b2.base.closeBackend();
  const platform = await createTargetPlatform({ storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
    workspace: fixture.workspaceHost, checks: fixture.configuration, now: () => B2_AT });
  fixtures.push({ close: () => platform.close() });
  return { fixture, platform };
}

async function workbenchHandle(scope: MaterialSourceScope) {
  const root = await mkdtemp(join(tmpdir(), 'rl-35-36-wb-'));
  directories.push(root);
  const handle = createWorkbenchTools({ workspaces: [{ scope, root, readPrefixes: ['.'], writePrefixes: ['.'], allowCommands: true }] });
  fixtures.push({ close: () => handle.close() });
  return handle;
}

const wbScope: MaterialSourceScope = { projectId: 'rl-35-project', workspaceId: 'rl-35-workspace' };
const wbContext = (): CoreCallContext => ({ projectId: wbScope.projectId, workspaceId: wbScope.workspaceId,
  principal: { kind: 'host', actor: { kind: 'human', id: 'rl-35-operator' } },
  materialReader: { kind: 'host', projectId: wbScope.projectId, workspaceId: wbScope.workspaceId,
    actor: { kind: 'human', id: 'rl-35-operator' } }, signal: new AbortController().signal });

// --------------------------------------------------------------------------- //
// RL-35: sandbox unavailable is refused as today, never started               //
// --------------------------------------------------------------------------- //

it('RL-35 an unavailable sandbox rejects the Work shell before the handler', async () => {
  rlSandbox.available = false;
  const f = await shellWork(); fixtures.push(f);
  await f.run('rl35-shell');
  const result = await readRLStoredToolResult(f.platform.runtime, f.ctx, f.sessionRef, 'rl35-shell');
  expect(result?.status === 'error' ? result.error.code : undefined).toBe('sandbox_unavailable');
  expect(rlSandbox.commands).toEqual([]);
});

it('RL-35 an unavailable sandbox rejects the Query read-only command before the handler', async () => {
  rlSandbox.available = false;
  const f = await queryReadonly(); fixtures.push(f);
  const { observed } = await f.run();
  const result = await readRLStoredToolResult(f.platform.runtime, rlQueryHostCtx(), observed.session.ref as never, 'rl35-query');
  expect(result?.status === 'error' ? result.error.code : undefined).toBe('sandbox_unavailable');
  expect(rlSandbox.commands).toEqual([]);
});

it('RL-35 an unavailable sandbox rejects the empty-write Work read-only command before the handler', async () => {
  rlSandbox.available = false;
  const f = await readonlyWork(); fixtures.push(f);
  await f.run('rl35-readonly');
  const result = await readRLStoredToolResult(f.platform.runtime, f.ctx, f.sessionRef, 'rl35-readonly');
  expect(result?.status === 'error' ? result.error.code : undefined).toBe('sandbox_unavailable');
  expect(rlSandbox.commands).toEqual([]);
});

it('RL-35 an unavailable sandbox refuses the registered check before any execute', async () => {
  rlSandbox.available = false;
  const { fixture, platform } = await checkPlatform();
  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error('RL-35 open did not commit');
  const run = await platform.checks.runRegisteredCheck(fixture.ctx, { input: { roundRef: opened.value.ref,
    checkId: fixture.passCheck.checkId }, meta: { requestId: 'rl35-check', expected: [{ ref: opened.value.ref, revision: opened.value.revision }] } });
  expect(run).toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(rlSandbox.commands).toEqual([]);
});

it('RL-35 an unavailable sandbox rejects the workbench command page as unsupported', async () => {
  rlSandbox.available = false;
  const handle = await workbenchHandle(wbScope);
  const started = await handle.tools.startCommand(wbContext(), { requestId: 'rl35-wb', command: 'echo never', cwd: '.' });
  expect(started).toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(rlSandbox.commands).toEqual([]);
});

// --------------------------------------------------------------------------- //
// RL-36: a launch failure is reported once, never retried                     //
// --------------------------------------------------------------------------- //

const launchFailed = (): never => { throw new ProcessSandboxError('launch_failed', 'launch_failed: rl-36 stub'); };

it('RL-36 a launch failure maps the Work shell to execution_failed with one execute', async () => {
  rlSandbox.next = launchFailed;
  const f = await shellWork('rl36-shell'); fixtures.push(f);
  await f.run('rl36-shell');
  const result = await readRLStoredToolResult(f.platform.runtime, f.ctx, f.sessionRef, 'rl36-shell');
  expect(result?.status === 'error' ? result.error.code : undefined).toBe('execution_failed');
  expect(rlSandbox.commands).toEqual(['echo never']);
});

it('RL-36 a launch failure maps the Query read-only command to execution_failed with one execute', async () => {
  rlSandbox.next = launchFailed;
  const f = await queryReadonly('rl36-query'); fixtures.push(f);
  const { observed } = await f.run();
  const result = await readRLStoredToolResult(f.platform.runtime, rlQueryHostCtx(), observed.session.ref as never, 'rl36-query');
  expect(result?.status === 'error' ? result.error.code : undefined).toBe('execution_failed');
  expect(rlSandbox.commands).toEqual(['ls']);
});

it('RL-36 a launch failure records the check as not_started with one execute', async () => {
  rlSandbox.next = launchFailed;
  const { fixture, platform } = await checkPlatform();
  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error('RL-36 open did not commit');
  const run = await platform.checks.runRegisteredCheck(fixture.ctx, { input: { roundRef: opened.value.ref,
    checkId: fixture.passCheck.checkId }, meta: { requestId: 'rl36-check', expected: [{ ref: opened.value.ref, revision: opened.value.revision }] } });
  if (run.status !== 'ready') throw new Error('RL-36 check did not return a persisted round');
  const check = run.value.checks.find(candidate => candidate.checkId === fixture.passCheck.checkId);
  const reportRef = check?.reportRef ?? null;
  if (reportRef === null || reportRef === undefined) throw new Error('RL-36 check must persist a report');
  const report = await platform.materials.openArtifact(fixture.ctx, { ref: reportRef, usage: 'historical_explanation' });
  if (report.status !== 'ready') throw new Error('RL-36 report read failed');
  expect(JSON.parse(report.value.body)).toMatchObject({ observation: { kind: 'not_started', reason: 'launch_failed' } });
  expect(rlSandbox.commands).toEqual([fixture.passCheck.command]);
});

it('RL-36 a launch failure saves a workbench error with one execute', async () => {
  rlSandbox.next = launchFailed;
  const handle = await workbenchHandle(wbScope);
  const started = await handle.tools.startCommand(wbContext(), { requestId: 'rl36-wb', command: 'echo rl36', cwd: '.' });
  if (started.status !== 'ready') throw new Error('RL-36 workbench start failed');
  await expect.poll(async () => {
    const read = await handle.tools.readCommand(wbContext(), { commandId: started.value.commandId });
    return read.status === 'ready' && read.value.error !== null ? 'error' : 'running';
  }, { timeout: 5_000 }).toBe('error');
  const read = await handle.tools.readCommand(wbContext(), { commandId: started.value.commandId });
  if (read.status !== 'ready') throw new Error('RL-36 workbench read failed');
  expect(read.value.error?.code).toBe('launch_failed');
  expect(rlSandbox.commands).toEqual(['echo rl36']);
});

