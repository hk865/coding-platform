/**
 * SHT-2 (§3 W1–W6, start rulings §2 B): the running-command read, the
 * `command_over_line` notice and the Host's review line. The world is
 * `openPLReadingsWorld` (real Host, the Work line's real write/shell grant,
 * `scribeReminderPeriodMs: 25`); `clock.advance` moves only the fake `Date`, and
 * every wait is a bounded public poll, the consume barrier, or the command's own
 * `sht-started` marker file. The marker is written by the command itself, so the
 * test never assumes when the sandbox spawned the shell. W6 uses the Query
 * model's first request instead: the read-only sandbox mounts the workspace
 * read-only, so its command cannot write a host-visible marker.
 *
 * 今天红在哪一步 / 包落地后为什么绿 / 一个具名改坏:
 * W1 red at the 9-minute read (no route); green with the read + registry. Mutations: no 10-minute filter
 *    (9 minutes lists it); no group-after removal (the mid-run read at the next model request lists it).
 * W2 red at the 59-minute read; green with `commandLineMs` + the notice writer. Mutations: only
 *    `expectedMs` (nothing at 61); an operationId with the time (two notices at 125).
 * W3 red at the 9-minute read; green with the 10-minute floor. Mutation: no floor (`lineMs` 120000, notice at 9).
 * W4 red at the first save; green with the route + snapshot field. Mutation: the constant 60 (nothing at 31).
 * W4r red at the first refusal (no route); green when non-positive-integers are refused. Mutation: 0 accepted.
 * W4s red at the first save; green when the value is persisted and read back. Mutation: not written.
 * W5 red at the 11-minute read; green when cancel reaches `end()`. Mutation: no `commandWatch.end()`.
 * W6 red at the 9-minute Query read (no route); green when the Query execution installs the watch.
 *    Mutation: no Query watch (the running read-only command never appears).
 *
 * QSTOP (test writer, 2026-11-13): QS-2 drives the same W6 world, takes the listed item's `run.queryRunRef`,
 * posts `queries/cancel`, polls `queries/read` to `closed`/`cancelled` and reads the registration gone; QS-3
 * posts an empty body and expects `invalid`. RED today at the two `queries/cancel` posts (unpublished route);
 * GREEN after QSTOP: the route binds `runtime.cancelQuery`, the Kernel abort ends the Turn `cancelled` and
 * SHT-2's `commandWatch.end()` clears the entry. Mutations: the switch bound elsewhere (today's 404); no Query
 * `end()` (the cancelled command stays listed); no `isRecord` check in `cancel` (throws instead of `invalid`).
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import { SETTINGS_API_PREFIX } from '../../src/app/host-settings-types.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import { answer, readExecution, readQuery, submitControl } from '../helpers/A2-restart-fixture.js';
import { AG2B_AT, AG2B_SCOPE, claimBusyQuery, createAG2bSession, plain, seedAG2bWorkGraph, startBusyQuery, type AG2bHost } from '../helpers/AG2b-collaboration-fixture.js';
import { startKReadonlyRealHost } from '../helpers/K-readonly-host-support.js';
import { openPLReadingsWorld, type PLReadingsWorld } from '../helpers/PL-readings-fixture.js';
import type { S6AHostWorld, S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { waitFor } from '../scenarios/harness.js';

const shellCommand = 'while [ ! -e sht-go ]; do : > sht-started; sleep 0.05; done; echo go';
const overLinePrefix = '命令跑过了预计时间：';
type PL = PLReadingsWorld;
type PLSession = Awaited<ReturnType<PLReadingsWorld['line']>>;
type RunningRead = { status: string; value?: { items: Array<{ elapsedMs: number; run?: { kind: string; runRef: RunRef; queryRunRef?: QueryRunRef }; [key: string]: unknown }> } };

const openWorld = (options: { backend?: 'memory' | 'sqlite' } = {}): Promise<PL> =>
  openPLReadingsWorld({ unlimitedRunLimits: true, extraHostOptions: { scribeReminderPeriodMs: 25 }, ...options });
const replies = (callId: string, args: Record<string, unknown>): S6AReply[] =>
  [{ kind: 'calls', calls: [{ callId, name: 'shell', args }] }, { kind: 'text', text: 'SHT-2 done' }];
const runningCommands = async (world: S6AHostWorld): Promise<RunningRead> =>
  (await world.post('executions/running-commands', plain(S6A_SCOPE, {}))).body as RunningRead;

/** The goal's project notices whose summary is the command-over-line line. */
async function overLine(fixture: PL) {
  const read = await fixture.main.readNotices({ categories: ['project_notice'], goal: fixture.goal });
  return read.notices.filter(notice => notice.summary.startsWith(overLinePrefix));
}

/** Three wake-loop rounds (the fixture pattern): register the barrier, step the fake clock one period, wait. */
async function wakeLoops(world: S6AHostWorld): Promise<void> {
  for (let beat = 0; beat < 3; beat += 1) {
    const settled = world.consumeBarrier(); world.clock.advance(25); await settled;
  }
}

async function snapshot(world: S6AHostWorld) {
  const answer = await world.settings('snapshot', {});
  if (answer.status !== 'ready') throw new Error(`SHT-2: the settings snapshot is ${JSON.stringify(answer)}`);
  return answer.value;
}

/** The command's own first loop turn writes this file in the workspace root, polled host-side (bounded 10 s). */
async function awaitStarted(world: { root: string }, marker = 'sht-started'): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (existsSync(join(world.root, marker))) return;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`SHT-2: the shell command never wrote ${marker}`);
}

/** The busy Query's scripted model has started serving the reply that carries the command; the tool starts next. */
async function awaitQueryCall(host: AG2bHost): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (host.queryScripted.requests.length > 0) return;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  }
  throw new Error('SHT-2: the Query model never received the run_readonly_command call');
}

const queryCommands = async (host: AG2bHost): Promise<RunningRead> =>
  await answer(host, 'executions/running-commands', plain(AG2B_SCOPE, {})) as RunningRead;

/** A real stuck shell on a Work Run; the row runs between the command's marker and its settle. */
async function shellRow(flowId: string, args: Record<string, unknown>,
  body: (fixture: PL, line: PLSession) => Promise<void>): Promise<void> {
  const fixture = await openWorld();
  const task = fixture.tasks[0]!;
  const line = await fixture.line(flowId, [task]);
  const running = fixture.runTask({ line, taskId: task.taskId, flowId, replies: replies(`${flowId}-shell`, args) });
  try {
    await awaitStarted(fixture.world);
    fixture.world.clock.advance(30_000);
    await body(fixture, line);
  } finally {
    await writeFile(join(fixture.world.root, 'sht-go'), 'go').catch(() => undefined);
    await running.catch(() => undefined);
    await fixture.close().catch(() => undefined);
  }
}
it('M12 two sequential long commands in ONE Work Run each get their own notice', async () => {
  const commandA = 'while [ ! -e sht-go-a ]; do : > sht-m12-a; sleep 0.05; done; echo a';
  const commandB = 'while [ ! -e sht-go-b ]; do : > sht-m12-b; sleep 0.05; done; echo b';
  const fixture = await openWorld();
  const task = fixture.tasks[0]!;
  const line = await fixture.line('sht2-m12', [task]);
  const running = fixture.runTask({ line, taskId: task.taskId, flowId: 'sht2-m12', replies: [
    { kind: 'calls', calls: [{ callId: 'm12-a', name: 'shell', args: { command: commandA } }] },
    { kind: 'calls', calls: [{ callId: 'm12-b', name: 'shell', args: { command: commandB } }] },
    { kind: 'text', text: 'SHT-2 M12 done' },
  ] });
  try {
    await awaitStarted(fixture.world, 'sht-m12-a');
    fixture.world.clock.advance(11 * 60_000);
    const first = await waitFor(() => overLine(fixture), items => items.length >= 1, 'the first command notice');
    expect(first).toHaveLength(1);
    expect(first[0]!.summary.slice(0, (overLinePrefix + commandA).length)).toBe(overLinePrefix + commandA);
    await writeFile(join(fixture.world.root, 'sht-go-a'), 'go');
    await awaitStarted(fixture.world, 'sht-m12-b');
    fixture.world.clock.advance(11 * 60_000);
    const both = await waitFor(() => overLine(fixture), items => items.length >= 2, 'the second command notice');
    expect(both).toHaveLength(2);
    const summaries = both.map(notice => notice.summary);
    expect(summaries.some(summary => summary.startsWith(overLinePrefix + commandA))).toBe(true);
    expect(summaries.some(summary => summary.startsWith(overLinePrefix + commandB))).toBe(true);
    // `itemKey` is `project_notice:<noticeId>` and the notice id IS the operation identity
    // (state/project-notice.ts:27), so two keys are two operations, not one replay.
    expect(new Set(both.map(notice => notice.itemKey)).size).toBe(2);
  } finally {
    await writeFile(join(fixture.world.root, 'sht-go-a'), 'go').catch(() => undefined);
    await writeFile(join(fixture.world.root, 'sht-go-b'), 'go').catch(() => undefined);
    await running.catch(() => undefined);
    await fixture.close().catch(() => undefined);
  }
});

it('W1 lists a command from 10 minutes on with its own expected duration and the line, and drops it after the Run ends', () =>
  shellRow('sht2-w1', { command: shellCommand }, async (fixture, line) => {
    fixture.world.clock.advance(9 * 60_000);
    expect(await runningCommands(fixture.world)).toEqual({ status: 'ready', value: { items: [] } });
    fixture.world.clock.advance(2 * 60_000);
    const read = await runningCommands(fixture.world);
    expect(read.value?.items).toHaveLength(1);
    expect(read.value?.items[0]).toMatchObject({ tool: 'shell', commandPreview: shellCommand,
      run: { kind: 'run', taskId: fixture.tasks[0]!.taskId }, sessionRef: line.ref, expectedMs: 600_000, overLine: true });
    expect(read.value?.items[0]!.elapsedMs).toBeGreaterThanOrEqual(660_000);
    const next = await fixture.world.gates.modelRequest(line);
    try {
      await writeFile(join(fixture.world.root, 'sht-go'), 'go');
      await next.reached;
      expect(await runningCommands(fixture.world)).toEqual({ status: 'ready', value: { items: [] } });
    } finally { next.release(); }
    await waitFor(() => readExecution(fixture.world.ag2b, read.value!.items[0]!.run!.runRef),
      record => record.run.status === 'ended', 'the W1 Run to end');
    expect(await runningCommands(fixture.world)).toEqual({ status: 'ready', value: { items: [] } });
  }));

it('M16 exactly 10:00', () =>
  shellRow('sht2-m16', { command: shellCommand }, async fixture => {
    fixture.world.clock.advance(569_999);
    expect(await runningCommands(fixture.world)).toEqual({ status: 'ready', value: { items: [] } });
    fixture.world.clock.advance(1);
    const read = await runningCommands(fixture.world);
    expect(read.value?.items).toHaveLength(1);
    expect(read.value?.items[0]).toMatchObject({ elapsedMs: 600_000, overLine: true });
  }));

it('W2 writes one notice at the 60-minute review line and never a second one', () =>
  shellRow('sht2-w2', { command: shellCommand, timeoutMs: 7_200_000 }, async fixture => {
    fixture.world.clock.advance(59 * 60_000);
    const early = await runningCommands(fixture.world);
    expect(early.status).toBe('ready');
    expect(early.value?.items).toHaveLength(1);
    expect(early.value?.items[0]).toMatchObject({ overLine: false, expectedMs: 7_200_000 });
    expect(await overLine(fixture)).toEqual([]);
    fixture.world.clock.advance(2 * 60_000);
    const noticed = await waitFor(() => overLine(fixture), items => items.length >= 1, 'the command_over_line notice');
    expect(noticed).toHaveLength(1);
    expect(noticed[0]!.subject).toMatchObject({ kind: 'goal', goalRef: { goalId: fixture.goal.goalId } });
    expect(noticed[0]!.summary.slice(0, (overLinePrefix + shellCommand).length)).toBe(overLinePrefix + shellCommand);
    fixture.world.clock.advance(64 * 60_000);
    await wakeLoops(fixture.world);
    expect(await overLine(fixture)).toHaveLength(1);
  }));

it('W3 floors a short expected duration at 10 minutes for both the read and the notice', () =>
  shellRow('sht2-w3', { command: shellCommand, timeoutMs: 120_000 }, async fixture => {
    fixture.world.clock.advance(9 * 60_000);
    await wakeLoops(fixture.world);
    expect(await runningCommands(fixture.world)).toEqual({ status: 'ready', value: { items: [] } });
    expect(await overLine(fixture)).toEqual([]);
    fixture.world.clock.advance(2 * 60_000);
    const items = (await runningCommands(fixture.world)).value?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ lineMs: 600_000, overLine: true });
    expect(await waitFor(() => overLine(fixture), notices => notices.length >= 1, 'the command_over_line notice')).toHaveLength(1);
  }));

it('W4 saves a 30-minute review line, the Host uses it for the notice, and null restores 60', () =>
  shellRow('sht2-w4', { command: shellCommand, timeoutMs: 7_200_000 }, async fixture => {
    expect(await fixture.world.settings('command-review/save', { commandReviewLineMinutes: 30 })).toMatchObject({ status: 'ready' });
    expect(await snapshot(fixture.world)).toMatchObject({ commandReviewLine: { saved: 30, effective: 30, default: 60 } });
    fixture.world.clock.advance(29 * 60_000);
    expect(await overLine(fixture)).toEqual([]);
    fixture.world.clock.advance(2 * 60_000);
    expect(await waitFor(() => overLine(fixture), notices => notices.length >= 1, 'the 30-minute notice')).toHaveLength(1);
    expect(await fixture.world.settings('command-review/save', { commandReviewLineMinutes: null })).toMatchObject({ status: 'ready' });
    expect(await snapshot(fixture.world)).toMatchObject({ commandReviewLine: { saved: null, effective: 60, default: 60 } });
  }));

describe('rejects: the command review line', () => {
  it.each([0, -5, 1.5, '30'])('refuses %s as the review line and keeps the default', async value => {
    const fixture = await openWorld();
    try {
      // A string is refused at runtime too, but the typed input is `number | null`; this one cell keeps the page's POST.
      const response = await fetch(new URL(`${SETTINGS_API_PREFIX}command-review/save`, fixture.world.base), {
        method: 'POST', headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: fixture.world.token },
        body: JSON.stringify({ commandReviewLineMinutes: value }) });
      expect(await response.json()).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await snapshot(fixture.world)).toMatchObject({ commandReviewLine: { saved: null, effective: 60, default: 60 } });
    } finally { await fixture.close().catch(() => undefined); }
  });
});
it('W4s (SQLite only) keeps the saved review line across a Host reopen', async () => {
  const fixture = await openWorld({ backend: 'sqlite' });
  try {
    expect(await fixture.world.settings('command-review/save', { commandReviewLineMinutes: 45 })).toMatchObject({ status: 'ready' });
    await fixture.world.reopen();
    expect(await snapshot(fixture.world)).toMatchObject({ commandReviewLine: { saved: 45, effective: 45, default: 60 } });
  } finally { await fixture.close().catch(() => undefined); }
});

it('W5 cancelling the Run removes its command from the read', () =>
  shellRow('sht2-w5', { command: shellCommand }, async (fixture, _line) => {
    fixture.world.clock.advance(11 * 60_000);
    const before = await runningCommands(fixture.world);
    expect(before.status).toBe('ready');
    expect(before.value?.items).toHaveLength(1);
    const runRef = before.value!.items[0]!.run!.runRef;
    const submitted = await submitControl(fixture.world.ag2b, runRef, 'cancel', 'SHT-2 W5 cancel', 'sht2-w5-cancel');
    expect((await fixture.world.post('controls/deliver', plain(S6A_SCOPE, { intentRef: submitted.intent.ref }))).body)
      .toMatchObject({ status: 'ready' });
    await waitFor(() => readExecution(fixture.world.ag2b, runRef),
      record => record.run.status === 'ended' && record.run.outcome === 'cancelled', 'the Run to finish cancellation');
    expect(await runningCommands(fixture.world)).toEqual({ status: 'ready', value: { items: [] } });
  }));

it('W6 lists a Query run_readonly_command after 10 minutes with run.kind query', async () => {
  let at = AG2B_AT;
  const host = await startKReadonlyRealHost({ replies: [], allowReadonlyCommands: true,
    queryReplies: [{ kind: 'calls', calls: [{ callId: 'sht2-w6', name: 'run_readonly_command',
      args: { command: shellCommand } }] }, { kind: 'text', text: 'SHT-2 W6 done' }],
    queryTools: ['read', 'run_readonly_command'], queryReadonlyCommandAccess: true, now: () => at });
  let running: Promise<unknown> | undefined;
  try {
    await seedAG2bWorkGraph(host);
    const session = await createAG2bSession(host, 'sht2-w6-line');
    const refs = await claimBusyQuery(host, session, 'sht2-w6');
    running = startBusyQuery(host, refs, 'sht2-w6');
    await awaitQueryCall(host);
    const moveClock = (ms: number): void => { at = new Date(Date.parse(at) + ms).toISOString(); };
    moveClock(30_000);
    moveClock(9 * 60_000);
    expect(await queryCommands(host)).toEqual({ status: 'ready', value: { items: [] } });
    moveClock(2 * 60_000);
    const read = await queryCommands(host);
    expect(read.value?.items).toHaveLength(1);
    expect(read.value?.items[0]).toMatchObject({ tool: 'run_readonly_command', run: { kind: 'query' },
      commandPreview: shellCommand, overLine: true });
  } finally {
    await writeFile(join(host.root, 'sht-go'), 'go').catch(() => undefined);
    await running?.catch(() => undefined);
    await host.close().catch(() => undefined);
  }
});

/** W6's world: a real Host whose Query binding lists `run_readonly_command`.
 * A command call is its own group, so the 17th tool call lands on the command's `before_group`: the watch registers
 * it, then the frozen Kernel's `maxToolCalls` (16) stops the run with `run.limit_exceeded` before `after_group`.
 * `mapOutcome` reports that non-cancelled terminal as the Query's `timeout`, and only the `finally`'s `end()`
 * removes the registration. */
it('M13 a failed (not cancelled) Query round clears the running-command registration', async () => {
  let at = AG2B_AT;
  const reads = Array.from({ length: 16 }, (_unused, index) => ({ callId: `sht2-m13-read-${index}`,
    name: 'read', args: { path: 'src/module.ts' } }));
  const host = await startKReadonlyRealHost({ replies: [], allowReadonlyCommands: true,
    queryReplies: [{ kind: 'calls', calls: [
      ...reads,
      { callId: 'sht2-m13', name: 'run_readonly_command', args: { command: shellCommand } },
    ] }],
    queryTools: ['read', 'run_readonly_command'], queryReadonlyCommandAccess: true, now: () => at });
  try {
    await seedAG2bWorkGraph(host);
    const session = await createAG2bSession(host, 'sht2-m13-line');
    const refs = await claimBusyQuery(host, session, 'sht2-m13');
    const started = await startBusyQuery(host, refs, 'sht2-m13');
    expect(started.run.run).toMatchObject({ status: 'closed', outcome: 'timeout' });
    at = new Date(Date.parse(at) + 11 * 60_000).toISOString();
    expect(await queryCommands(host)).toEqual({ status: 'ready', value: { items: [] } });
  } finally {
    await host.close().catch(() => undefined);
  }
});

/** QSTOP QS-2: the listed Query command's own ref stops the Turn and clears the registration. */
it('QS-2 queries/cancel stops the listed Query command and clears its registration', async () => {
  let at = AG2B_AT;
  const host = await startKReadonlyRealHost({ replies: [], allowReadonlyCommands: true,
    queryReplies: [{ kind: 'calls', calls: [{ callId: 'qs2', name: 'run_readonly_command',
      args: { command: shellCommand } }] }, { kind: 'text', text: 'QS-2 never sent' }],
    queryTools: ['read', 'run_readonly_command'], queryReadonlyCommandAccess: true, now: () => at });
  let running: Promise<unknown> | undefined;
  try {
    await seedAG2bWorkGraph(host);
    const session = await createAG2bSession(host, 'qs2-line');
    const refs = await claimBusyQuery(host, session, 'qs2');
    running = startBusyQuery(host, refs, 'qs2');
    await awaitQueryCall(host);
    const moveClock = (ms: number): void => { at = new Date(Date.parse(at) + ms).toISOString(); };
    moveClock(30_000);
    moveClock(9 * 60_000);
    // Let the command's group barrier record its start before the last clock jump.
    await queryCommands(host);
    moveClock(2 * 60_000);
    const before = await waitFor(() => queryCommands(host), read => (read.value?.items.length ?? 0) === 1,
      'the QS-2 Query command');
    const item = before.value!.items[0]!;
    expect(item).toMatchObject({ tool: 'run_readonly_command', run: { kind: 'query' } });
    expect(await answer(host, 'queries/cancel', plain(AG2B_SCOPE, { queryRunRef: item.run!.queryRunRef })))
      .toMatchObject({ status: 'ready', value: { stop: 'stopping' } });
    const job = await waitFor(() => readQuery(host, refs.queryJobRef),
      read => read.job.job.status === 'closed', 'the cancelled Query to close');
    expect(job).toMatchObject({ job: { job: { status: 'closed', closeReason: { code: 'cancelled' } } },
      run: { run: { outcome: 'cancelled' } } });
    expect(await queryCommands(host)).toEqual({ status: 'ready', value: { items: [] } });
  } finally {
    await writeFile(join(host.root, 'sht-go'), 'go').catch(() => undefined);
    await running?.catch(() => undefined);
    await host.close().catch(() => undefined);
  }
});

describe('rejects: queries/cancel', () => {
  it('refuses an input without queryRunRef', async () => {
    const host = await startKReadonlyRealHost({ replies: [], allowReadonlyCommands: false });
    try {
      expect(await answer(host, 'queries/cancel', plain(AG2B_SCOPE, {})))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally { await host.close().catch(() => undefined); }
  });
});
