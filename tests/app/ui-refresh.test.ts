/**
 * Task E refetch scheduling — `src/ui/api/refresh.ts`, the one seam that runs
 * the page's read loops (P1 driver-read every 1000 ms, P2 commands/read every
 * 700 ms) and the record-notice watches.
 *
 * Under `timers` (the default, and the fallback while the change stream is
 * down) a read loop is exactly the old `setInterval(tick, intervalMs)`. Under
 * `notices` no timer runs: only a notice for the loop's own Host handle runs
 * it, debounced and single-flight. `off` (hidden page) runs nothing.
 * Pure Node test with fake timers: no DOM, no network, no Host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeNotice } from '../../src/app/core-http-types.js';
import { createRefreshHub, topicMatches } from '../../src/ui/api/refresh.js';
import type { ChangeTopic } from '../../src/ui/api/refresh.js';

const scope = { projectId: 'p', workspaceId: 'w' };
const driverTopic: ChangeTopic = { kind: 'driver', scope, goalId: 'g' };
const commandTopic: ChangeTopic = { kind: 'command', scope, commandId: 'workbench-command-1' };

const driverNotice = (over: Partial<ChangeNotice> = {}): ChangeNotice =>
  ({ cursor: 'c0000000003', kinds: ['driver'], projects: ['p'], scope, goalId: 'g', taskId: null, ...over });
const commandNotice = (over: Partial<ChangeNotice> = {}): ChangeNotice =>
  ({ cursor: 'c0000000003', kinds: ['command'], projects: ['p'], scope, commandId: 'workbench-command-1', state: 'settled', ...over });
const recordNotice = (over: Partial<ChangeNotice> = {}): ChangeNotice =>
  ({ cursor: 'c0000000004', kinds: ['tasks'], projects: ['p'], ...over });

/** Settle promise callbacks without moving the fake clock. */
const flush = async (): Promise<void> => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); };

/** A tick whose reads stay open until released, to observe overlap. */
function gatedTick() {
  const releases: (() => void)[] = [];
  const tick = vi.fn(() => new Promise<void>(resolve => { releases.push(resolve); }));
  return { tick, release: async () => { releases.shift()?.(); await flush(); }, open: () => releases.length };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('topic matching', () => {
  it('matches a driver notice by exact scope and Goal (any Task) and a command notice by scope and handle', () => {
    expect(topicMatches(driverTopic, driverNotice())).toBe(true);
    expect(topicMatches(driverTopic, driverNotice({ taskId: 'task-2' }))).toBe(true);
    expect(topicMatches(driverTopic, driverNotice({ goalId: 'other' }))).toBe(false);
    expect(topicMatches(driverTopic, driverNotice({ scope: { projectId: 'p', workspaceId: 'w2' } }))).toBe(false);
    expect(topicMatches(driverTopic, driverNotice({ scope: { projectId: 'p2', workspaceId: 'w' } }))).toBe(false);
    expect(topicMatches(driverTopic, commandNotice())).toBe(false);
    expect(topicMatches(driverTopic, recordNotice({ kinds: ['goals', 'tasks'] }))).toBe(false);
    expect(topicMatches(commandTopic, commandNotice())).toBe(true);
    expect(topicMatches(commandTopic, commandNotice({ commandId: 'workbench-command-2' }))).toBe(false);
    expect(topicMatches(commandTopic, driverNotice())).toBe(false);
  });
});

describe('timers delivery: the pre-task-E polling', () => {
  it('is the default and runs each loop on its own interval, overlapping as before, until stopped', async () => {
    const hub = createRefreshHub();
    expect(hub.delivery()).toBe('timers');
    const command = gatedTick();
    const driver = vi.fn(async () => undefined);
    const commandHandle = hub.startPoll(700, command.tick, commandTopic);
    hub.startPoll(1000, driver, driverTopic);
    expect(command.tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2100);
    expect(command.tick).toHaveBeenCalledTimes(3);
    expect(command.open()).toBe(3);
    expect(driver).toHaveBeenCalledTimes(2);
    hub.stopPoll(commandHandle);
    hub.stopPoll(commandHandle);
    hub.stopPoll(null);
    await vi.advanceTimersByTimeAsync(2100);
    expect(command.tick).toHaveBeenCalledTimes(3);
    expect(driver).toHaveBeenCalledTimes(4);
    expect(hub.counts()).toEqual({ polls: 1, watches: 0 });
  });

  it('runs the immediate first read only when asked', async () => {
    const hub = createRefreshHub();
    const tick = vi.fn(async () => undefined);
    hub.startPoll(1000, tick, driverTopic, { immediate: true });
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});

describe('notices delivery', () => {
  it('runs no timer and reads only on a notice for the loop\'s own handle, after a 50 ms debounce', async () => {
    const hub = createRefreshHub();
    hub.setDelivery('notices');
    const driver = vi.fn(async () => undefined);
    const command = vi.fn(async () => undefined);
    hub.startPoll(1000, driver, driverTopic);
    hub.startPoll(700, command, commandTopic);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(driver).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    hub.deliverNotice(driverNotice({ goalId: 'other' }));
    hub.deliverNotice(commandNotice({ commandId: 'workbench-command-9' }));
    hub.deliverNotice(recordNotice({ kinds: ['tasks', 'executions'] }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(driver).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    hub.deliverNotice(driverNotice({ taskId: 'task-1' }));
    await vi.advanceTimersByTimeAsync(49);
    expect(driver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(driver).toHaveBeenCalledTimes(1);
    expect(command).not.toHaveBeenCalled();
    hub.deliverNotice(commandNotice());
    await vi.advanceTimersByTimeAsync(50);
    expect(command).toHaveBeenCalledTimes(1);
    expect(driver).toHaveBeenCalledTimes(1);
  });

  it('turns a burst into at most two reads that never overlap', async () => {
    const hub = createRefreshHub();
    hub.setDelivery('notices');
    const read = gatedTick();
    hub.startPoll(1000, read.tick, driverTopic);
    for (let index = 0; index < 5; index += 1) hub.deliverNotice(driverNotice());
    await vi.advanceTimersByTimeAsync(50);
    expect(read.tick).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 3; index += 1) hub.deliverNotice(driverNotice());
    await vi.advanceTimersByTimeAsync(500);
    expect(read.tick).toHaveBeenCalledTimes(1);
    await read.release();
    await vi.advanceTimersByTimeAsync(50);
    expect(read.tick).toHaveBeenCalledTimes(2);
    expect(read.open()).toBe(1);
    await read.release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(read.tick).toHaveBeenCalledTimes(2);
  });

  it('routes the immediate first read through the same runner, so a notice during it waits for it', async () => {
    const hub = createRefreshHub();
    hub.setDelivery('notices');
    const read = gatedTick();
    hub.startPoll(1000, read.tick, driverTopic, { immediate: true });
    expect(read.tick).toHaveBeenCalledTimes(1);
    hub.deliverNotice(driverNotice());
    await vi.advanceTimersByTimeAsync(200);
    expect(read.tick).toHaveBeenCalledTimes(1);
    await read.release();
    await vi.advanceTimersByTimeAsync(50);
    expect(read.tick).toHaveBeenCalledTimes(2);
  });

  it('drops a pending run when the loop is stopped', async () => {
    const hub = createRefreshHub();
    hub.setDelivery('notices');
    const tick = vi.fn(async () => undefined);
    const handle = hub.startPoll(700, tick, commandTopic);
    hub.deliverNotice(commandNotice());
    hub.stopPoll(handle);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).not.toHaveBeenCalled();
    expect(hub.counts()).toEqual({ polls: 0, watches: 0 });
  });

  it('reads once when a matching notice arrived after the `since` mark but before the loop existed', async () => {
    const hub = createRefreshHub();
    hub.setDelivery('notices');
    const early = hub.noticeMark();
    hub.deliverNotice(commandNotice({ commandId: 'workbench-command-2' }));
    hub.deliverNotice(commandNotice());
    const late = hub.noticeMark();
    expect(late).toBe(early + 2);
    const caught = vi.fn(async () => undefined);
    const missed = vi.fn(async () => undefined);
    const unrelated = vi.fn(async () => undefined);
    hub.startPoll(700, caught, commandTopic, { since: early });
    hub.startPoll(700, missed, commandTopic, { since: late });
    hub.startPoll(700, unrelated, { kind: 'command', scope, commandId: 'workbench-command-3' }, { since: early });
    await vi.advanceTimersByTimeAsync(1000);
    expect(caught).toHaveBeenCalledTimes(1);
    expect(missed).not.toHaveBeenCalled();
    expect(unrelated).not.toHaveBeenCalled();
  });

  it('catches up every loop once, and the watches only when asked', async () => {
    const hub = createRefreshHub();
    hub.setDelivery('notices');
    const driver = vi.fn(async () => undefined);
    const command = vi.fn(async () => undefined);
    const refetch = vi.fn(async () => undefined);
    hub.startPoll(1000, driver, driverTopic);
    hub.startPoll(700, command, commandTopic);
    hub.watchChanges(() => true, refetch);
    hub.catchUp(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect([driver.mock.calls.length, command.mock.calls.length, refetch.mock.calls.length]).toEqual([1, 1, 0]);
    hub.catchUp(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect([driver.mock.calls.length, command.mock.calls.length, refetch.mock.calls.length]).toEqual([2, 2, 1]);
  });
});

describe('switching delivery', () => {
  it('moves the same loops between timers and notices and runs nothing while off', async () => {
    const hub = createRefreshHub();
    const tick = vi.fn(async () => undefined);
    const refetch = vi.fn(async () => undefined);
    hub.startPoll(700, tick, commandTopic);
    hub.watchChanges(() => true, refetch);
    await vi.advanceTimersByTimeAsync(1400);
    expect(tick).toHaveBeenCalledTimes(2);
    hub.setDelivery('notices');
    await vi.advanceTimersByTimeAsync(7000);
    expect(tick).toHaveBeenCalledTimes(2);
    // A pending notice run is dropped when the page hides.
    hub.deliverNotice(commandNotice());
    hub.deliverNotice(recordNotice());
    hub.setDelivery('off');
    await vi.advanceTimersByTimeAsync(7000);
    hub.deliverNotice(commandNotice());
    hub.catchUp(true);
    await vi.advanceTimersByTimeAsync(7000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(refetch).not.toHaveBeenCalled();
    hub.setDelivery('timers');
    await vi.advanceTimersByTimeAsync(700);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('watches', () => {
  it('re-run a refetch 300 ms after a matching notice, single-flight, and stop when unsubscribed', async () => {
    const hub = createRefreshHub();
    hub.setDelivery('notices');
    const read = gatedTick();
    const seen: ChangeNotice[] = [];
    const unsubscribe = hub.watchChanges(notice => { seen.push(notice); return notice.kinds.includes('tasks'); }, read.tick);
    hub.deliverNotice(recordNotice({ kinds: ['sessions'] }));
    hub.deliverNotice(driverNotice());
    await vi.advanceTimersByTimeAsync(1000);
    expect(read.tick).not.toHaveBeenCalled();
    hub.deliverNotice(recordNotice());
    await vi.advanceTimersByTimeAsync(299);
    expect(read.tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(read.tick).toHaveBeenCalledTimes(1);
    hub.deliverNotice(recordNotice());
    await vi.advanceTimersByTimeAsync(1000);
    expect(read.tick).toHaveBeenCalledTimes(1);
    await read.release();
    await vi.advanceTimersByTimeAsync(300);
    expect(read.tick).toHaveBeenCalledTimes(2);
    await read.release();
    expect(seen).toHaveLength(4);
    unsubscribe();
    hub.deliverNotice(recordNotice());
    await vi.advanceTimersByTimeAsync(1000);
    expect(read.tick).toHaveBeenCalledTimes(2);
    expect(hub.counts()).toEqual({ polls: 0, watches: 0 });
  });
});
