/**
 * RL slice row RL-30 (RE2): the `shell` result mapping and the frozen
 * dispatcher's overlays (spec §5.2 RL-30, L10, F23a).
 *
 * Builds: a scripted-model Work over the real `createTargetPlatform` with the
 * Kernel `ProcessSandbox` swapped by `tests/helpers/RL-kernel-sandbox-double.ts`.
 * The tool result is read back through the public Runtime Session history.
 * Rows: RL-30.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { createS2BBe1Platform, type S2BBe1PlatformFixture, type Be1Reply } from '../helpers/S2B-be1-platform-fixture.js';
import { defaultRLSandboxResult, rlSandbox } from '../helpers/RL-kernel-sandbox-double.js';
import { cancelRLRun, readRLStoredToolResult, rlJsonPart } from '../helpers/RL-re2-support.js';

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const { mockRLKernelSandboxModule } = await import('../helpers/RL-kernel-sandbox-double.js');
  return await mockRLKernelSandboxModule(importOriginal as never);
});

const APPLIED_NONE = { status: 'applied', memoryMaxBytes: 268435456, tasksMax: 64,
  memory: 'none_observed', processes: 'none_observed', observationComplete: true };
const APPLIED_MEMORY_HIT = { ...APPLIED_NONE, memory: 'cap_hit' };
const APPLIED_PROCESS_HIT = { ...APPLIED_NONE, processes: 'cap_hit' };
const NONE_NO_SESSION = { status: 'none', reason: 'no_user_session', text: '没有资源上限：没有 systemd 的用户会话' };

const opened: S2BBe1PlatformFixture[] = [];
afterEach(async () => {
  // Restore real timers first so a failed fake-timer case never poisons the next.
  vi.useRealTimers();
  for (const fixture of opened.splice(0)) await fixture.close();
  rlSandbox.reset();
  vi.restoreAllMocks();
});

function shellFixture(replies: readonly Be1Reply[]): Promise<S2BBe1PlatformFixture> {
  return createS2BBe1Platform({ toolNames: ['read', 'shell'], writeScope: ['.'], shell: true, scriptedReplies: replies });
}

function shellCall(callId: string, command = 'echo rl-30'): Be1Reply {
  return { kind: 'calls', calls: [{ callId, name: 'shell', args: { command } }] };
}

async function stored(f: S2BBe1PlatformFixture, callId: string) {
  return await readRLStoredToolResult(f.platform.runtime, f.ctx, f.sessionRef, callId);
}

it('RL-30 (a) an applied report with no events copies into the successful JSON verbatim', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const f = await shellFixture([shellCall('rl30-a'), { kind: 'text', text: 'RL-30 a done' }]);
  opened.push(f);
  await f.run('rl30-a');
  const result = await stored(f, 'rl30-a');
  expect(result?.status).toBe('success');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_NONE);
});

it('RL-30 (b) a memory cap hit on a non-zero exit gets the tail note and execution_failed', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({
    exitCode: null, signal: 'SIGKILL', resourceCaps: APPLIED_MEMORY_HIT,
  });
  const f = await shellFixture([shellCall('rl30-b'), { kind: 'text', text: 'RL-30 b done' }]);
  opened.push(f);
  await f.run('rl30-b');
  const result = await stored(f, 'rl30-b');
  expect(result?.status).toBe('error');
  if (result?.status !== 'error') throw new Error('no RL-30 (b) error result');
  expect(result.error.code).toBe('execution_failed');
  expect(result.error.message).toBe('shell 退出码 null（超出内存上限）');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_MEMORY_HIT);
});

it('RL-30 (c) a process cap hit on a zero exit stays a success with no tail note', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 0, resourceCaps: APPLIED_PROCESS_HIT });
  const f = await shellFixture([shellCall('rl30-c'), { kind: 'text', text: 'RL-30 c done' }]);
  opened.push(f);
  await f.run('rl30-c');
  const result = await stored(f, 'rl30-c');
  expect(result?.status).toBe('success');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_PROCESS_HIT);
});

it('RL-30 (d) a none report copies the fixed text into the JSON', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: NONE_NO_SESSION });
  const f = await shellFixture([shellCall('rl30-d'), { kind: 'text', text: 'RL-30 d done' }]);
  opened.push(f);
  await f.run('rl30-d');
  const result = await stored(f, 'rl30-d');
  const report = rlJsonPart(result)?.['resourceCaps'] as { text?: string } | undefined;
  expect(report?.text).toBe('没有资源上限：没有 systemd 的用户会话');
});

it('RL-30 (e) a double result without resourceCaps adds no JSON field', async () => {
  rlSandbox.next = () => defaultRLSandboxResult();
  const f = await shellFixture([shellCall('rl30-e'), { kind: 'text', text: 'RL-30 e done' }]);
  opened.push(f);
  await f.run('rl30-e');
  const result = await stored(f, 'rl30-e');
  expect(rlJsonPart(result)).not.toHaveProperty('resourceCaps');
});

it('RL-30 (f) a real cancellation maps to the dispatcher cancelled overlay with empty output', async () => {
  rlSandbox.settleOnAbort = true;
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const f = await shellFixture([shellCall('rl30-f'), { kind: 'text', text: 'RL-30 f done' }]);
  opened.push(f);
  await cancelRLRun(f, 0, 'rl30-f');
  const result = await stored(f, 'rl30-f');
  expect(result?.status).toBe('cancelled');
  expect(result?.output).toEqual([]);
  expect(rlSandbox.aborted).toBeGreaterThan(0);
});

it('RL-30 (g) the dispatcher timer past the shell default timeout becomes the timeout overlay', async () => {
  rlSandbox.settleOnAbort = true;
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const f = await shellFixture([shellCall('rl30-g'), { kind: 'text', text: 'RL-30 g done' }]);
  opened.push(f);
  // The fake timers must be active BEFORE the dispatch starts (spec §7).
  vi.useFakeTimers();
  const running = f.run('rl30-g');
  // Step the fake clock so the real async preparation can reach the dispatch;
  // only once the handler runs does the dispatcher schedule its 30 s timer.
  for (let step = 0; step < 2_000 && rlSandbox.commands.length === 0; step += 1) {
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(rlSandbox.commands.length).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(30_000);
  await running;
  const result = await stored(f, 'rl30-g');
  expect(result?.status).toBe('error');
  if (result?.status !== 'error') throw new Error('no RL-30 (g) error result');
  expect(result.error.code).toBe('timeout');
  expect(result.error.message).toBe('工具执行超时');
  expect(result.output).toEqual([{ kind: 'text', text: '工具执行超时' }]);
  expect(rlSandbox.aborted).toBeGreaterThan(0);
});

it('RL-30 (h) the handler own subprocess timeout is kept verbatim with its JSON', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({
    exitCode: null, timedOut: true, resourceCaps: APPLIED_NONE,
  });
  const f = await shellFixture([shellCall('rl30-h'), { kind: 'text', text: 'RL-30 h done' }]);
  opened.push(f);
  await f.run('rl30-h');
  const result = await stored(f, 'rl30-h');
  expect(result?.status).toBe('error');
  if (result?.status !== 'error') throw new Error('no RL-30 (h) error result');
  expect(result.error.code).toBe('timeout');
  expect(result.error.message).toBe('shell 执行超时');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_NONE);
});
