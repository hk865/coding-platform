/**
 * Slice 2B BE1s acceptance row 2B-09 (spec §5.2, entry BE1s; real `shell`).
 *
 * This sandbox has no bubblewrap, so every real command fails
 * `sandbox_unavailable` here; the row is run once and reported as `sandbox`.
 * The only seam is the real Kernel shell tool; nothing fakes a sandbox.
 *
 * Cases: `touch d.ts e.ts` (edit 1),
 * `ls` (edit 0), `echo x > f.ts; exit 3` (failed, edit 1), a cancelled
 * `echo y > g.ts; sleep 30` (tool.cancelled, edit 1), a cancelled `sleep 30`
 * with no change (tool.cancelled, edit 0), a timed-out `sleep 200`
 * (`timeoutMs: 100`, tool.failed timeout, edit 0), and a read-only Work running
 * `run_readonly_command` (`ls`): one step, zero edits, no changed files.
 *
 * Lead, 2026-10-15 (run with bubblewrap at acceptance): the process sandbox keeps `.git` read-only
 * (vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:91, :377), so a real `git checkout -b`
 * fails and the HEAD-only case (L1 row 6) is not producible through the real `shell`; it is covered by
 * the pure tally (2B-01). A cancelled Run ends its Turn without another model request, so the cancel
 * cases assert the recorded activity, not a follow-up tool message.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { createS2BBe1Platform, S2B_SLOW_TIMEOUT_MS, type S2BBe1PlatformFixture } from '../helpers/S2B-be1-platform-fixture.js';

const opened: S2BBe1PlatformFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

type ShellFixtureOptions = Omit<Parameters<typeof createS2BBe1Platform>[0], 'toolNames' | 'writeScope' | 'shell'>;
function shellFixture(options: ShellFixtureOptions): ReturnType<typeof createS2BBe1Platform> {
  return createS2BBe1Platform({ toolNames: ['read', 'write', 'shell'], writeScope: ['.'], shell: true, ...options });
}

/** The tool result the model saw for one call in the final request. */
function toolResult(record: S2BBe1PlatformFixture, callId: string): unknown {
  const followUp = record.scripted.requests.at(-1);
  return followUp?.messages.find(message => message.role === 'tool' && message.callId === callId);
}

/** Start the Run at `runs[index]`, cancel it while the command runs, then observe. */
async function cancelAt(f: S2BBe1PlatformFixture, index: number, requestId: string): Promise<TaskExecutionRecord> {
  const ref: RunRef = f.runs[index]!.ref;
  const prepared = await f.platform.runtime.prepareExecution(f.ctx, { runRef: ref, requestId: `${requestId}-prepare` });
  if (prepared.status !== 'ready') throw new Error(`2B-09 cancel prepare failed: ${JSON.stringify(prepared)}`);
  const running = f.platform.runtime.startRun(f.ctx, { prepared: prepared.value,
    consumerId: `${requestId}-driver`, requestId: `${requestId}-start` });
  // Give the real command time to start before the cancel signal.
  await new Promise(resolve => { setTimeout(resolve, 400); });
  try {
    const read = await f.platform.executions.readExecution(f.ctx, ref);
    if (read.status === 'ready') {
      const pin = { ref, revision: read.value.run.revision };
      const submitted = await f.platform.controls.submitControl(f.ctx, {
        input: { runRef: ref, kind: 'cancel', reason: '2B-09 operator cancel' },
        meta: { requestId: `${requestId}-cancel`, expected: [pin] },
      });
      if (submitted.status === 'committed') {
        await f.platform.runtime.deliverControl(f.ctx, { intentRef: submitted.value.intent.ref });
      }
    }
  } catch { /* the Run may already have ended (no bubblewrap) */ }
  const started = await running;
  if (started.status !== 'ready') throw new Error(`2B-09 cancel start failed: ${JSON.stringify(started)}`);
  const observed = await f.platform.runtime.observeRun(f.ctx, { runRef: ref });
  if (observed.status !== 'ready') throw new Error(`2B-09 cancel observe failed: ${JSON.stringify(observed)}`);
  return observed.value;
}

function gitWorkspace(directory: string): void {
  const run = (args: readonly string[]) => execFileSync('git', [...args], { cwd: directory, stdio: 'ignore' });
  run(['init', '-q']);
  run(['config', 'user.email', 'be1s@example.invalid']);
  run(['config', 'user.name', 'BE1s']);
  writeFileSync(join(directory, 'seed.txt'), 'seed\n');
  run(['add', '.']);
  run(['commit', '-q', '-m', 'seed']);
}

it('2B-09 real shell changed-file cases: touch, ls, failing write', async () => {
  const f = await shellFixture({
    initialAt: '2026-10-15T10:00:00.000Z',
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'be1s-touch', name: 'shell', args: { command: 'touch d.ts e.ts' } }] },
      { kind: 'calls', calls: [{ callId: 'be1s-ls', name: 'shell', args: { command: 'ls' } }] },
      { kind: 'calls', calls: [{ callId: 'be1s-exit', name: 'shell',
        args: { command: 'echo x > f.ts; exit 3' } }] },
      { kind: 'text', text: '2B-09 run A done' },
    ],
  });
  opened.push(f);
  gitWorkspace(f.directory);

  const recordA = await f.runAt(0, '2b09-a');
  expect(recordA.run.status).toBe('ended');
  // touch: one confirmed edit with both created paths, sorted (F8).
  expect(toolResult(f, 'be1s-touch')).toMatchObject({ result: { status: 'success',
    effects: { sideEffect: 'confirmed', changedPaths: ['d.ts', 'e.ts'] } } });
  // ls: nothing changed; effects possible with an empty path list (F8).
  expect(toolResult(f, 'be1s-ls')).toMatchObject({ result: { status: 'success',
    effects: { sideEffect: 'possible', changedPaths: [] } } });
  // The failing write is a `tool.failed` with the command's own confirmed effects.
  expect(toolResult(f, 'be1s-exit')).toMatchObject({ result: { status: 'error',
    error: { code: 'execution_failed' }, effects: { sideEffect: 'confirmed', changedPaths: ['f.ts'] } } });

  const views = await f.readRuns([f.runs[0]!.ref]);
  const viewA = views.find(view => view.runRef.runId === f.runs[0]!.ref.runId);
  expect(viewA).toMatchObject({ status: 'counted', totals: { steps: 3, edits: 2, editsUnknown: 0 },
    changedFiles: { definite: 3, possible: 0, possiblyIncomplete: true } });
  expect(viewA?.changedFiles?.possiblyIncomplete).toBe(true);

  const conflicts = await f.platform.decisions.queryGoalConflicts(f.ctx, { workspace: f.scope });
  expect(conflicts.status).toBe('ready');
  if (conflicts.status !== 'ready') return;
  const completeness = conflicts.value.footprintCompleteness.find(entry => entry.goalRef.goalId === f.goalRef.goalId);
  expect(completeness).toBeDefined();
  expect([...(completeness?.unmappedFiles ?? [])].sort()).toEqual(['d.ts', 'e.ts', 'f.ts']);
  expect(completeness?.unmappedFiles).not.toContain('.');
}, S2B_SLOW_TIMEOUT_MS);

it('2B-09 a cancelled command that wrote a file is one step and one edit', async () => {
  const f = await shellFixture({
    initialAt: '2026-10-15T10:00:00.000Z',
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'be1s-cancel', name: 'shell', args: { command: 'echo y > g.ts; sleep 30' } }] },
      { kind: 'text', text: '2B-09 cancelled write done' },
    ],
  });
  opened.push(f);

  const record = await cancelAt(f, 0, '2b09-cancel-write');
  expect(record.run.status).toBe('ended');
  const views = await f.readRuns();
  expect(views[0]).toMatchObject({ status: 'counted', totals: { steps: 1, edits: 1, editsUnknown: 0 },
    changedFiles: { definite: 1, possible: 0 } });
  const conflicts = await f.platform.decisions.queryGoalConflicts(f.ctx, { workspace: f.scope });
  expect(conflicts.status).toBe('ready');
  if (conflicts.status !== 'ready') return;
  const completeness = conflicts.value.footprintCompleteness.find(entry => entry.goalRef.goalId === f.goalRef.goalId);
  expect(completeness?.unmappedFiles).toEqual(['g.ts']);
}, S2B_SLOW_TIMEOUT_MS);

it('2B-09 a cancelled command that changed nothing is tool.cancelled with zero edits', async () => {
  const f = await shellFixture({
    initialAt: '2026-10-15T10:00:00.000Z',
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'be1s-cancel-empty', name: 'shell', args: { command: 'sleep 30' } }] },
      { kind: 'text', text: '2B-09 cancel-empty done' },
    ],
  });
  opened.push(f);

  await cancelAt(f, 0, '2b09-cancel-empty');

  const views = await f.readRuns();
  expect(views[0]).toMatchObject({ status: 'counted', totals: { steps: 1, edits: 0, editsUnknown: 0 },
    changedFiles: { definite: 0, possible: 0 } });
}, S2B_SLOW_TIMEOUT_MS);

it('2B-09 a timed-out command that changed nothing is tool.failed timeout with zero edits', async () => {
  const f = await shellFixture({
    initialAt: '2026-10-15T10:00:00.000Z',
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'be1s-timeout', name: 'shell',
        args: { command: 'sleep 200', timeoutMs: 100 } }] },
      { kind: 'text', text: '2B-09 timeout done' },
    ],
  });
  opened.push(f);

  await f.run('2b09-timeout');
  expect(toolResult(f, 'be1s-timeout')).toMatchObject({ result: { status: 'error', error: { code: 'timeout' } } });

  const views = await f.readRuns();
  expect(views[0]).toMatchObject({ status: 'counted', totals: { steps: 1, edits: 0, editsUnknown: 0 },
    changedFiles: { definite: 0, possible: 0 } });
}, S2B_SLOW_TIMEOUT_MS);

it('2B-09 a read-only Work running run_readonly_command is one step, zero edits and no changed files', async () => {
  const f = await createS2BBe1Platform({
    toolNames: ['read', 'run_readonly_command'],
    writeScope: [],
    readonlyCommands: true,
    initialAt: '2026-10-15T10:00:00.000Z',
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'be1s-readonly', name: 'run_readonly_command', args: { command: 'ls' } }] },
      { kind: 'text', text: '2B-09 read-only done' },
    ],
  });
  opened.push(f);

  await f.run('2b09-readonly');
  const views = await f.readRuns();
  expect(views[0]).toMatchObject({ status: 'counted', totals: { steps: 1, edits: 0, editsUnknown: 0 },
    changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false } });

  const conflicts = await f.platform.decisions.queryGoalConflicts(f.ctx, { workspace: f.scope });
  expect(conflicts.status).toBe('ready');
  if (conflicts.status !== 'ready') return;
  const completeness = conflicts.value.footprintCompleteness.find(entry => entry.goalRef.goalId === f.goalRef.goalId);
  expect(completeness?.unmappedFiles ?? []).toEqual([]);
}, S2B_SLOW_TIMEOUT_MS);
