/**
 * Task E view wiring: the two read loops the old views register follow the
 * change notices of THEIR Host handle, and the page entry starts the stream.
 *
 *  - `views/terminal/commands.ts`: a started command reads `commands/read` only
 *    on a notice for its own commandId and workspace (50 ms debounce). A notice
 *    that arrives while `commands/start` (or a loop-starting `commands/stop`) is
 *    still in flight is not lost: the notice mark is taken BEFORE the request.
 *  - `views/execution/collaboration.ts`: the driver loop reads once at once,
 *    then only on a driver notice for its own workspace and Goal.
 *  - While the stream is down (`timers`) both are the old 700/1000 ms polls.
 *  - `main.ts` starts the stream (with the bootstrap head) and the record-notice
 *    refetches.
 * The page's real refresh hub, a stubbed fetch and fake timers: no DOM, no Host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { ChangeNotice, CoreScope, WorkbenchCommandState } from '../../src/app/core-http-types.js';
import { refreshHub, stopPoll } from '../../src/ui/api/refresh.js';
import { createScopeState, type ScopeState } from '../../src/ui/state/scope-state.js';
import { beginCollaborationPoll } from '../../src/ui/views/execution/collaboration.js';
import { startCommand, stopCommand } from '../../src/ui/views/terminal/commands.js';

const target: CoreScope = { projectId: 'wire-project', workspaceId: 'wire-workspace' };
const otherWorkspace: CoreScope = { ...target, workspaceId: 'wire-other-workspace' };
const goalRef = { aggregateType: 'Goal' as const, projectId: target.projectId, goalId: 'wire-goal' };

const commandReply = (commandId: string, state: WorkbenchCommandState) => ({ status: 'ready', value: {
  error: null, commandId, state, stdout: state === 'settled' ? 'done\n' : '', stderr: '', outputTruncated: false,
  exitCode: state === 'settled' ? 0 : null, signal: null, timedOut: false, cancelled: false,
} });
const driverReply = { status: 'ready', value: {
  goalRef, flowId: 'wire-flow', taskId: null, siblings: [], state: 'running', current: null, last: null, messages: [], reason: null,
} };

const commandNotice = (commandId: string, over: Partial<ChangeNotice> = {}): ChangeNotice => ({
  cursor: 'c0000000009', kinds: ['command'], projects: [target.projectId], scope: target, commandId, state: 'settled', ...over,
});
const driverNotice = (goalId: string, over: Partial<ChangeNotice> = {}): ChangeNotice => ({
  cursor: 'c0000000009', kinds: ['driver'], projects: [target.projectId], scope: target, goalId, taskId: null, ...over,
});

type Sent = { route: string; input: unknown };

/** Record every POST the views send; `answer` gives the payload (or a promise of it). */
function stubHost(answer: (route: string) => unknown) {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const route = url.slice('/api/real/core/'.length);
    sent.push({ route, input: (JSON.parse(String(init.body)) as { input: unknown }).input });
    return new Response(JSON.stringify(await answer(route)), { status: 200 });
  }));
  return { sent, count: (route: string): number => sent.filter(entry => entry.route === route).length };
}

let created: ScopeState[] = [];
function scope(): ScopeState {
  const value = createScopeState({ scope: target, name: 'wire', workspaceRevision: 1, commandsAllowed: true }, () => ({}) as never);
  created.push(value);
  return value;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  // The stream is live: the page's hub runs no timer.
  refreshHub.setDelivery('notices');
});
afterEach(() => {
  for (const value of created) {
    stopPoll(value.collaborationPoll);
    for (const command of value.commands.values()) stopPoll(command.poll);
  }
  created = [];
  expect(refreshHub.counts().polls).toBe(0);
  refreshHub.setDelivery('timers');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('command loop', () => {
  it('reads a started command only on a notice for that command, 50 ms after it', async () => {
    const host = stubHost(route => commandReply('workbench-command-1', route === 'commands/start' ? 'running' : 'settled'));
    const s = scope();
    await startCommand(s, 'sleep 8', '.');
    const command = s.commands.get('workbench-command-1');
    expect(command?.poll).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(host.count('commands/read')).toBe(0);
    refreshHub.deliverNotice(commandNotice('workbench-command-2'));
    refreshHub.deliverNotice(commandNotice('workbench-command-1', { scope: otherWorkspace }));
    refreshHub.deliverNotice(driverNotice(goalRef.goalId));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(host.count('commands/read')).toBe(0);
    refreshHub.deliverNotice(commandNotice('workbench-command-1'));
    await vi.advanceTimersByTimeAsync(49);
    expect(host.count('commands/read')).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.sent.filter(entry => entry.route === 'commands/read'))
      .toEqual([{ route: 'commands/read', input: { commandId: 'workbench-command-1' } }]);
    // The settled read ends the loop; a late notice reads nothing more.
    await vi.waitFor(() => { expect(command?.state).toBe('settled'); });
    expect(command?.poll).toBeNull();
    refreshHub.deliverNotice(commandNotice('workbench-command-1'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(host.count('commands/read')).toBe(1);
  });

  it('keeps following a stopped command: one read on the stopping notice, one on the settled notice', async () => {
    const replies: Record<string, WorkbenchCommandState> = { 'commands/start': 'running', 'commands/stop': 'stopping', 'commands/read': 'stopping' };
    const host = stubHost(route => commandReply('workbench-command-5', replies[route]!));
    const s = scope();
    await startCommand(s, 'sleep 30', '.');
    await stopCommand(s, 'workbench-command-5');
    expect(host.count('commands/stop')).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(host.count('commands/read')).toBe(0);
    const command = s.commands.get('workbench-command-5');
    const stopResult = command?.result;
    refreshHub.deliverNotice(commandNotice('workbench-command-5', { state: 'stopping' }));
    await vi.advanceTimersByTimeAsync(50);
    expect(host.count('commands/read')).toBe(1);
    await vi.waitFor(() => { expect(command?.result).not.toBe(stopResult); });
    replies['commands/read'] = 'settled';
    refreshHub.deliverNotice(commandNotice('workbench-command-5'));
    await vi.advanceTimersByTimeAsync(50);
    expect(host.count('commands/read')).toBe(2);
    await vi.waitFor(() => { expect(command?.state).toBe('settled'); });
    expect(command?.poll).toBeNull();
  });

  it('does not lose a settled notice that arrives while commands/start is still in flight', async () => {
    let reply: () => void = () => undefined;
    const host = stubHost(route => (route === 'commands/start'
      ? new Promise(resolve => { reply = () => resolve(commandReply('workbench-command-3', 'running')); })
      : commandReply('workbench-command-3', 'settled')));
    const s = scope();
    const started = startCommand(s, 'echo fast', '.');
    // The command settles, and its notice arrives, before the page has the start reply.
    refreshHub.deliverNotice(commandNotice('workbench-command-3'));
    reply();
    await started;
    expect(s.commands.get('workbench-command-3')?.state).toBe('running');
    await vi.advanceTimersByTimeAsync(50);
    expect(host.count('commands/read')).toBe(1);
    await vi.waitFor(() => { expect(s.commands.get('workbench-command-3')?.state).toBe('settled'); });
  });

  it('does not lose a notice that arrives while a loop-starting commands/stop is in flight', async () => {
    // A start reply that is already settled starts no loop; the stop then starts one.
    let reply: () => void = () => undefined;
    const host = stubHost(route => (route === 'commands/stop'
      ? new Promise(resolve => { reply = () => resolve(commandReply('workbench-command-4', 'settled')); })
      : commandReply('workbench-command-4', 'settled')));
    const s = scope();
    await startCommand(s, 'true', '.');
    expect(s.commands.get('workbench-command-4')?.poll).toBeNull();
    const stopped = stopCommand(s, 'workbench-command-4');
    refreshHub.deliverNotice(commandNotice('workbench-command-4'));
    reply();
    await stopped;
    await vi.advanceTimersByTimeAsync(50);
    expect(host.count('commands/read')).toBe(1);
  });
});

describe('driver loop', () => {
  it('reads at once, then only on a driver notice for its own workspace and Goal', async () => {
    const host = stubHost(() => driverReply);
    const s = scope();
    beginCollaborationPoll(s, target, goalRef);
    expect(host.sent).toEqual([{ route: 'workflow/driver-read', input: { goalRef } }]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(host.count('workflow/driver-read')).toBe(1);
    expect(s.collaborationPoll).not.toBeNull();
    refreshHub.deliverNotice(driverNotice('wire-other-goal'));
    refreshHub.deliverNotice(driverNotice(goalRef.goalId, { scope: otherWorkspace }));
    refreshHub.deliverNotice(commandNotice('workbench-command-1'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(host.count('workflow/driver-read')).toBe(1);
    // Any Task of the Goal: the snapshot also carries the sibling handles.
    refreshHub.deliverNotice(driverNotice(goalRef.goalId, { taskId: 'wire-task' }));
    await vi.advanceTimersByTimeAsync(49);
    expect(host.count('workflow/driver-read')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.count('workflow/driver-read')).toBe(2);
  });
});

describe('fallback', () => {
  it('runs the old 700 ms command and 1000 ms driver polls while the stream is down, and stops them when it is back', async () => {
    const host = stubHost(route => (route === 'workflow/driver-read' ? driverReply : commandReply('workbench-command-6', 'running')));
    const s = scope();
    await startCommand(s, 'sleep 30', '.');
    beginCollaborationPoll(s, target, goalRef);
    expect([host.count('commands/read'), host.count('workflow/driver-read')]).toEqual([0, 1]);
    refreshHub.setDelivery('timers');
    await vi.advanceTimersByTimeAsync(2_100);
    expect([host.count('commands/read'), host.count('workflow/driver-read')]).toEqual([3, 3]);
    refreshHub.setDelivery('notices');
    await vi.advanceTimersByTimeAsync(10_000);
    expect([host.count('commands/read'), host.count('workflow/driver-read')]).toEqual([3, 3]);
  });
});

describe('page entry', () => {
  it('starts the change stream with the bootstrap head and the record-notice refetches before any early return', async () => {
    const source = await readFile(new URL('../../src/ui/main.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const body = code.slice(code.indexOf('async function main()'));
    expect(body).toMatch(/\bstartLiveUpdates\(status => store\.set\('connection', status\), bootstrap\.changesHead\);/);
    expect(body).toMatch(/\bwatchRecordChanges\(\);/);
    // An empty bootstrap returns early; scopes opened later still need notices.
    const emptyReturn = body.indexOf('if (first === undefined)');
    expect(emptyReturn).toBeGreaterThan(0);
    expect(body.indexOf('startLiveUpdates(')).toBeLessThan(emptyReturn);
    expect(body.indexOf('watchRecordChanges(')).toBeLessThan(emptyReturn);
  });
});
