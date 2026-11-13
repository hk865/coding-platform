/**
 * RL slice row RL-30 (RE2): the `shell` result mapping and the frozen
 * dispatcher's overlays (spec §5.2 RL-30, L10, F23a).
 *
 * Builds: a scripted-model Work over the real `createTargetPlatform` with the
 * Kernel `ProcessSandbox` swapped by `tests/helpers/RL-kernel-sandbox-double.ts`.
 * The tool result is read back through the public Runtime Session history.
 * Rows: RL-30.
 *
 * SHT-1 (test writer, 2026-11-13): (g) becomes S2 (a command past its filled
 * duration is not stopped) and (h) is deleted (the handler's `timedOut` branch
 * goes with the sandbox timer; §4); S3/S3b are new. RED today: the shell
 * definition still says `defaultTimeoutMs: 30_000`, so the 2 h advance aborts
 * the command, and the handler has no `fitOutput`, so two full 64 KiB streams
 * serialize past 128 KiB and the dispatcher rejects the result as
 * `invalid_result`. GREEN after SHT-1: `SHELL_NO_STOP_MS` and
 * `fitOutput(output, SHELL_OUTPUT_LIMIT_BYTES)`.
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

/** SHT-1 S2: the dispatcher timer never reaches a command filled at 100 ms; 2 h later it is still running. */
it('SHT-1 (S2) a shell past its filled duration is not aborted by the dispatcher timer', async () => {
  rlSandbox.settleOnAbort = true;
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: APPLIED_NONE });
  const f = await shellFixture([shellCall('rl30-g'), { kind: 'text', text: 'RL-30 g done' }]);
  opened.push(f);
  // The fake timers must be active BEFORE the dispatch starts (spec §7).
  vi.useFakeTimers();
  const running = f.run('rl30-g');
  // Step the fake clock so the real async preparation can reach the dispatch.
  for (let step = 0; step < 2_000 && rlSandbox.commands.length === 0; step += 1) {
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(rlSandbox.commands.length).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(7_200_000);
  expect(rlSandbox.aborted).toBe(0);
  expect(rlSandbox.releases).toHaveLength(1);
  rlSandbox.releases[0]!();
  await running;
  const result = await stored(f, 'rl30-g');
  expect(result?.status).toBe('success');
  expect(rlJsonPart(result)?.['resourceCaps']).toEqual(APPLIED_NONE);
});

/** SHT-1 S3: two full 64 KiB streams must be shrunk into the 128 KiB definition limit, not rejected. */
it('SHT-1 (S3) two full 64 KiB streams are shrunk into the 128 KiB limit and the Run continues', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({
    stdout: { text: 'a'.repeat(64 * 1024), totalBytes: 64 * 1024, truncated: false },
    stderr: { text: 'b'.repeat(64 * 1024), totalBytes: 64 * 1024, truncated: false },
    resourceCaps: APPLIED_NONE,
  });
  const f = await shellFixture([shellCall('rl30-s3'), { kind: 'text', text: 'SHT-1 S3 done' }]);
  opened.push(f);
  await f.run('rl30-s3');
  const result = await stored(f, 'rl30-s3');
  expect(result?.status).toBe('success');
  // Lead 11-13: the draft's §2 order cuts stderr first and stdout only if it still does not fit; here stderr alone is enough.
  expect(rlJsonPart(result)?.['stderr']).toMatchObject({ truncated: true });
  expect(Buffer.byteLength(JSON.stringify(result?.output), 'utf8')).toBeLessThanOrEqual(128 * 1024);
  // The Run used the follow-up scripted reply, so the shrunk result was accepted.
  expect(f.scripted.requests).toHaveLength(2);
});

/** SHT-1 S3b: one stream alone can serialize far past the limit (each control byte is 6 bytes). */
it('SHT-1 (S3b) one full 64 KiB control-byte stream is shrunk on the stdout side', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({
    stdout: { text: '\u0001'.repeat(64 * 1024), totalBytes: 64 * 1024, truncated: false },
    resourceCaps: APPLIED_NONE,
  });
  const f = await shellFixture([shellCall('rl30-s3b'), { kind: 'text', text: 'SHT-1 S3b done' }]);
  opened.push(f);
  await f.run('rl30-s3b');
  const result = await stored(f, 'rl30-s3b');
  expect(result?.status).toBe('success');
  expect(rlJsonPart(result)?.['stdout']).toMatchObject({ truncated: true });
  expect(Buffer.byteLength(JSON.stringify(result?.output), 'utf8')).toBeLessThanOrEqual(128 * 1024);
  expect(f.scripted.requests).toHaveLength(2);
});

/** SHT-1 S3c: the non-zero exit branch must also carry the shrunk output, not the pre-fit streams. */
it('SHT-1 (S3c) two full 64 KiB streams on a non-zero exit are shrunk and the Run continues', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({
    exitCode: 1,
    stdout: { text: 'a'.repeat(64 * 1024), totalBytes: 64 * 1024, truncated: false },
    stderr: { text: 'b'.repeat(64 * 1024), totalBytes: 64 * 1024, truncated: false },
    resourceCaps: APPLIED_NONE,
  });
  const f = await shellFixture([shellCall('rl30-s3c'), { kind: 'text', text: 'SHT-1 S3c done' }]);
  opened.push(f);
  await f.run('rl30-s3c');
  const result = await stored(f, 'rl30-s3c');
  expect(result).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });
  expect(Buffer.byteLength(JSON.stringify(result?.output), 'utf8')).toBeLessThanOrEqual(128 * 1024);
  expect(f.scripted.requests).toHaveLength(2);
});

/**
 * SHT-1 S3d: the cancelled branch gets the same two full streams from the double's
 * abort settlement. The dispatcher's aborted overlay persists an empty output, so the
 * observable is the cancelled record itself: an unfitted result is rejected by the
 * 128 KiB check before that overlay and no `tool.cancelled` event is written.
 */
it('SHT-1 (S3d) a cancellation with two full 64 KiB streams still records the cancelled result', async () => {
  rlSandbox.settleOnAbort = true;
  rlSandbox.next = () => defaultRLSandboxResult({
    stdout: { text: 'a'.repeat(64 * 1024), totalBytes: 64 * 1024, truncated: false },
    stderr: { text: 'b'.repeat(64 * 1024), totalBytes: 64 * 1024, truncated: false },
  });
  const f = await shellFixture([shellCall('rl30-s3d'), { kind: 'text', text: 'SHT-1 S3d done' }]);
  opened.push(f);
  await cancelRLRun(f, 0, 'rl30-s3d');
  const result = await stored(f, 'rl30-s3d');
  expect(result?.status).toBe('cancelled');
  expect(result?.output).toEqual([]);
});
