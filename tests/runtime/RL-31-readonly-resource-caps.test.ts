/**
 * RL slice row RL-31 (RE2): `run_readonly_command` result mapping, tail notes,
 * the M10 fixed external-change message, the 128 KiB bound and the frozen
 * dispatcher overlays (spec §5.2 RL-31, L10, L14).
 *
 * Builds: a real Query chain (RL-query-fixture) and an empty-write Work
 * (S2B-be1-platform-fixture), both with the Kernel `ProcessSandbox` swapped by
 * the RL double. Results are read back through the public Runtime history.
 * Rows: RL-31.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { createS2BBe1Platform, type S2BBe1PlatformFixture, type Be1Reply } from '../helpers/S2B-be1-platform-fixture.js';
import { createRLQueryFixture, rlQueryHostCtx, type RLQueryFixture } from '../helpers/RL-query-fixture.js';
import { defaultRLSandboxResult, rlSandbox } from '../helpers/RL-kernel-sandbox-double.js';
import { readRLStoredToolResult, rlJsonPart } from '../helpers/RL-re2-support.js';

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const { mockRLKernelSandboxModule } = await import('../helpers/RL-kernel-sandbox-double.js');
  return await mockRLKernelSandboxModule(importOriginal as never);
});

const WORKSPACE_CHANGED_MESSAGE = 'workspace_changed_during_readonly_command: the workspace was changed by another '
  + 'writer during the command; the changed paths are in the output';
const LONGEST_NONE = { status: 'none', reason: 'controllers_not_delegated',
  text: '没有资源上限：内存和进程数的控制没有下放给当前用户' };
const APPLIED_NONE = { status: 'applied', memoryMaxBytes: 268435456, tasksMax: 64,
  memory: 'none_observed', processes: 'none_observed', observationComplete: true };
const APPLIED_MEMORY_HIT = { ...APPLIED_NONE, memory: 'cap_hit' };
const APPLIED_PROCESS_HIT = { ...APPLIED_NONE, processes: 'cap_hit' };

const queryFixtures: RLQueryFixture[] = [];
const workFixtures: S2BBe1PlatformFixture[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const fixture of queryFixtures.splice(0)) await fixture.close();
  for (const fixture of workFixtures.splice(0)) await fixture.close();
  rlSandbox.reset();
  vi.restoreAllMocks();
});

function readonlyCall(callId: string, args: Record<string, unknown> = { command: 'ls' }): { kind: 'calls'; calls: Array<{ callId: string; name: string; args: Record<string, unknown> }> } {
  return { kind: 'calls', calls: [{ callId, name: 'run_readonly_command', args }] };
}

const text = (value: string): { kind: 'text'; text: string } => ({ kind: 'text', text: value });

function toolPayloadBytes(result: unknown): number {
  return Buffer.byteLength(JSON.stringify({ ...(result as Record<string, unknown>), callId: '' }), 'utf8');
}

async function queryStored(fixture: RLQueryFixture, sessionRef: SessionRef, callId: string) {
  return await readRLStoredToolResult(fixture.platform.runtime, rlQueryHostCtx(), sessionRef, callId);
}

async function runQueryAndRead(fixture: RLQueryFixture, callId: string) {
  const { observed } = await fixture.run();
  return await queryStored(fixture, observed.session.ref as SessionRef, callId);
}

// --------------------------------------------------------------------------- //
// Query arm                                                                   //
// --------------------------------------------------------------------------- //

it('RL-31 (a) an applied report copies into the successful Query JSON verbatim', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-a'), text('RL-31 a done')] });
  queryFixtures.push(f);
  const result = await runQueryAndRead(f, 'rl31-a');
  expect(result?.status).toBe('success');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_NONE);
});

it('RL-31 (b) a memory cap hit on a non-zero exit gets the tail note and execution_failed', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 7, resourceCaps: APPLIED_MEMORY_HIT });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-b', { command: 'false' }), text('RL-31 b done')] });
  queryFixtures.push(f);
  const result = await runQueryAndRead(f, 'rl31-b');
  expect(result?.status).toBe('error');
  if (result?.status !== 'error') throw new Error('no RL-31 (b) error result');
  expect(result.error.code).toBe('execution_failed');
  expect(result.error.message).toBe('命令退出码 7（超出内存上限）');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_MEMORY_HIT);
});

it('RL-31 (c) a process cap hit on a zero exit stays a success with no tail note', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 0, resourceCaps: APPLIED_PROCESS_HIT });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-c'), text('RL-31 c done')] });
  queryFixtures.push(f);
  const result = await runQueryAndRead(f, 'rl31-c');
  expect(result?.status).toBe('success');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_PROCESS_HIT);
});

it('RL-31 (d) a none report copies the fixed text into the JSON', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: LONGEST_NONE });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-d'), text('RL-31 d done')] });
  queryFixtures.push(f);
  const result = await runQueryAndRead(f, 'rl31-d');
  expect((rlJsonPart(result)?.['resourceCaps'] as { text?: string } | undefined)?.text)
    .toBe('没有资源上限：内存和进程数的控制没有下放给当前用户');
});

it('RL-31 (e) a double result without resourceCaps adds no JSON field', async () => {
  rlSandbox.next = () => defaultRLSandboxResult();
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-e'), text('RL-31 e done')] });
  queryFixtures.push(f);
  const result = await runQueryAndRead(f, 'rl31-e');
  expect(rlJsonPart(result)).not.toHaveProperty('resourceCaps');
});

it('RL-31 an external change with a memory cap hit keeps the fixed M10 message without a tail note', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({
    exitCode: 0, resourceCaps: APPLIED_MEMORY_HIT,
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [],
      externalChangedPaths: ['src/racy.txt'], externalChangedPathsOmitted: 0 },
  });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-racy'), text('RL-31 racy done')] });
  queryFixtures.push(f);
  const result = await runQueryAndRead(f, 'rl31-racy');
  expect(result?.status).toBe('error');
  if (result?.status !== 'error') throw new Error('no RL-31 external change result');
  expect(result.error.message).toBe(WORKSPACE_CHANGED_MESSAGE);
  const json = rlJsonPart(result);
  expect(json?.['reason']).toBe('workspace_changed_during_readonly_command');
  expect(json?.['externalChangedPaths']).toEqual(['src/racy.txt']);
  expect(json?.['resourceCaps']).toEqual(APPLIED_MEMORY_HIT);
});

it('RL-31 two 32 KiB streams and 100 long paths bound the complete result at 128 KiB and keep resourceCaps', async () => {
  const longPath = (index: number): string => `changed/file-${String(index).padStart(3, '0')}/${'x'.repeat(1400)}.txt`;
  const paths = Array.from({ length: 100 }, (_, index) => longPath(index));
  rlSandbox.next = () => defaultRLSandboxResult({
    exitCode: 0,
    stdout: { text: 'A'.repeat(32 * 1024), totalBytes: 32 * 1024, truncated: false },
    stderr: { text: 'B'.repeat(32 * 1024), totalBytes: 32 * 1024, truncated: false },
    resourceCaps: LONGEST_NONE,
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [], externalChangedPaths: paths },
  });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-bound', { command: 'touch many' }), text('RL-31 bound done')] });
  queryFixtures.push(f);
  const result = await runQueryAndRead(f, 'rl31-bound');
  expect(result?.status).toBe('error');
  expect(toolPayloadBytes(result)).toBeLessThanOrEqual(128 * 1024);
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(LONGEST_NONE);
});

it('RL-31 an invalid argument refusal never starts a command and carries no resourceCaps', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-invalid', { command: 'echo never', timeoutMs: 500 }), text('RL-31 invalid done')] });
  queryFixtures.push(f);
  const result = await runQueryAndRead(f, 'rl31-invalid');
  expect(result?.status).toBe('error');
  if (result?.status !== 'error') throw new Error('no RL-31 invalid result');
  expect(result.error.code).toBe('invalid_arguments');
  expect(rlJsonPart(result)).toBeUndefined();
  expect(rlSandbox.commands).toEqual([]);
});

it('RL-31 a permission change before launch carries no resourceCaps and starts nothing', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-forbidden'), text('RL-31 forbidden done')],
    tools: ['run_readonly_command'], revisionFor: read => read === 1 ? 'rl-read-1' : 'rl-read-2' });
  queryFixtures.push(f);
  const result = await runQueryAndRead(f, 'rl31-forbidden');
  expect(result?.status).toBe('error');
  if (result?.status !== 'error') throw new Error('no RL-31 forbidden result');
  expect(result.error.code).toBe('permission_denied');
  expect(rlJsonPart(result)).toBeUndefined();
  expect(rlSandbox.commands).toEqual([]);
});

it('RL-31 a real Query cancellation maps to the dispatcher cancelled overlay with empty output', async () => {
  const controller = new AbortController();
  rlSandbox.settleOnAbort = true;
  rlSandbox.onExecute = () => { controller.abort(); };
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-cancel'), text('RL-31 cancel done')] });
  queryFixtures.push(f);
  const { observed } = await f.run(controller.signal);
  const result = await queryStored(f, observed.session.ref as SessionRef, 'rl31-cancel');
  expect(rlSandbox.commands).toEqual(['ls']);
  expect(result?.status).toBe('cancelled');
  expect(result?.output).toEqual([]);
  expect(rlSandbox.aborted).toBeGreaterThan(0);
});

it('RL-31 the dispatcher timer past 130 s becomes the timeout overlay', async () => {
  rlSandbox.settleOnAbort = true;
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-dispatcher'), text('RL-31 dispatcher done')] });
  queryFixtures.push(f);
  vi.useFakeTimers();
  const running = f.run();
  for (let step = 0; step < 5_000 && rlSandbox.commands.length === 0; step += 1) {
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(rlSandbox.commands.length).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(130_000);
  const { observed } = await running;
  const result = await queryStored(f, observed.session.ref as SessionRef, 'rl31-dispatcher');
  expect(result?.status).toBe('error');
  if (result?.status !== 'error') throw new Error('no RL-31 dispatcher result');
  expect(result.error.code).toBe('timeout');
  expect(result.error.message).toBe('工具执行超时');
  expect(result.output).toEqual([{ kind: 'text', text: '工具执行超时' }]);
});

it('RL-31 the handler own subprocess timeout is kept verbatim with its JSON', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: null, timedOut: true, resourceCaps: APPLIED_NONE });
  const f = await createRLQueryFixture({ replies: [readonlyCall('rl31-timeout', { command: 'sleep 999', timeoutMs: 1000 }), text('RL-31 timeout done')] });
  queryFixtures.push(f);
  const result = await runQueryAndRead(f, 'rl31-timeout');
  expect(result?.status).toBe('error');
  if (result?.status !== 'error') throw new Error('no RL-31 timeout result');
  expect(result.error.code).toBe('timeout');
  expect(result.error.message).toBe('run_readonly_command 执行超时');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_NONE);
});

// --------------------------------------------------------------------------- //
// Empty-write Work arm (same mapping)                                         //
// --------------------------------------------------------------------------- //

function workReadonlyFixture(replies: readonly Be1Reply[]): Promise<S2BBe1PlatformFixture> {
  return createS2BBe1Platform({ toolNames: ['read', 'run_readonly_command'], writeScope: [], readonlyCommands: true, scriptedReplies: replies });
}

it('RL-31 (a) the empty-write Work maps the same applied report into its JSON', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const f = await workReadonlyFixture([readonlyCall('rl31-work-a', { command: 'echo work' }), text('RL-31 work done')]);
  workFixtures.push(f);
  await f.run('rl31-work-a');
  const result = await readRLStoredToolResult(f.platform.runtime, f.ctx, f.sessionRef, 'rl31-work-a');
  expect(result?.status).toBe('success');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_NONE);
});

it('RL-31 (b) the empty-write Work adds the same tail note on a memory cap hit', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 3, resourceCaps: APPLIED_MEMORY_HIT });
  const f = await workReadonlyFixture([readonlyCall('rl31-work-b', { command: 'false' }), text('RL-31 work b done')]);
  workFixtures.push(f);
  await f.run('rl31-work-b');
  const result = await readRLStoredToolResult(f.platform.runtime, f.ctx, f.sessionRef, 'rl31-work-b');
  expect(result?.status).toBe('error');
  if (result?.status !== 'error') throw new Error('no RL-31 work (b) result');
  expect(result.error.message).toBe('命令退出码 3（超出内存上限）');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_MEMORY_HIT);
});

it('RL-31 (c) the empty-write Work keeps a process cap hit on a zero exit as a success with no tail note', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 0, resourceCaps: APPLIED_PROCESS_HIT });
  const f = await workReadonlyFixture([readonlyCall('rl31-work-c', { command: 'echo work' }), text('RL-31 work c done')]);
  workFixtures.push(f);
  await f.run('rl31-work-c');
  const result = await readRLStoredToolResult(f.platform.runtime, f.ctx, f.sessionRef, 'rl31-work-c');
  expect(result?.status).toBe('success');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_PROCESS_HIT);
});

it('RL-31 (d) the empty-write Work copies the none report text into its JSON', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: LONGEST_NONE });
  const f = await workReadonlyFixture([readonlyCall('rl31-work-d', { command: 'echo work' }), text('RL-31 work d done')]);
  workFixtures.push(f);
  await f.run('rl31-work-d');
  const result = await readRLStoredToolResult(f.platform.runtime, f.ctx, f.sessionRef, 'rl31-work-d');
  expect((rlJsonPart(result)?.['resourceCaps'] as { text?: string } | undefined)?.text)
    .toBe('没有资源上限：内存和进程数的控制没有下放给当前用户');
});
