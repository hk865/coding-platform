/**
 * The Host wake loop's own rules (book §3.7 items 3–7): coalesced dirty marks,
 * one pass at a time with exactly one more for a wake that arrives during a
 * pass, `more` after a yield, parking on a wrapped pass that progressed
 * nothing, handler-failure back-off, commit-notice pairing, unarmed workspaces
 * and close.
 *
 * The handler is the loop's injected input: these doubles record calls and
 * return scripted pass results. Time is the loop's own timer under fake
 * timers, so no row sleeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordCommitNotice } from '../../src/composition/commit-observer.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import { createWakeLoop, type WakeLoop } from '../../src/app/wake-loop.js';
import { deferred } from '../helpers/A2-restart-fixture.js';

type DrainInput = { maxItems: number; continuation: string | null; signal: AbortSignal };
type DrainResult = {
  progressed: number; more: boolean; continuation: string | null; wrapped: boolean; blocked: number;
};
type HandlerDouble = {
  rebuilds: WorkspaceScope[];
  drains: { scope: WorkspaceScope; input: DrainInput }[];
  handler: {
    rebuild(scope: WorkspaceScope): Promise<void>;
    drain(scope: WorkspaceScope, input: DrainInput): Promise<DrainResult>;
  };
};

const P1: WorkspaceScope = { projectId: 'p1', workspaceId: 'w1' };
/** A second workspace of the same project: a notice is project-wide, not first-workspace-only. */
const P1B: WorkspaceScope = { projectId: 'p1', workspaceId: 'w1b' };
const P2: WorkspaceScope = { projectId: 'p2', workspaceId: 'w2' };

/** One clean pass: nothing more to do in this pass. */
function progressed(over: Partial<DrainResult> = {}): DrainResult {
  return { progressed: 1, more: false, continuation: null, wrapped: false, blocked: 0, ...over };
}

function handlerDouble(
  drain?: (scope: WorkspaceScope, input: DrainInput) => Promise<DrainResult>,
): HandlerDouble {
  const rebuilds: WorkspaceScope[] = [];
  const drains: HandlerDouble['drains'] = [];
  return {
    rebuilds,
    drains,
    handler: {
      async rebuild(scope: WorkspaceScope): Promise<void> {
        rebuilds.push(scope);
      },
      async drain(scope: WorkspaceScope, input: DrainInput): Promise<DrainResult> {
        drains.push({ scope, input });
        return drain === undefined ? progressed() : drain(scope, input);
      },
    },
  };
}

function noticeOf(
  ...aggregates: { aggregateType: string; projectId: string | null }[]
): RecordCommitNotice {
  return { cursor: makeCommitCursor(1), aggregates };
}

/** Let the loop's own timer (and the event-loop turn it schedules) run. */
const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); };

/** Let pending promise continuations run without running any timer. */
const settleMicrotasks = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

const loops: WakeLoop[] = [];

function wakeLoop(overrides: Partial<Parameters<typeof createWakeLoop>[0]> = {}): WakeLoop {
  const loop = createWakeLoop({ driving: () => true, ...overrides });
  loops.push(loop);
  return loop;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  // Let any queued event-loop turn run while the fake clock can still fire it;
  // close() itself ends a pending back-off through the loop's abort signal.
  for (let turn = 0; turn < 5; turn += 1) await vi.advanceTimersByTimeAsync(1);
  for (const loop of loops.splice(0)) await loop.close();
  vi.useRealTimers();
});

describe('wake coalescing', () => {
  it('runs one pass for coalesced wakes and never inside the waking call', async () => {
    const double = handlerDouble();
    const loop = wakeLoop();
    loop.register('request-rounds', double.handler);
    await loop.start([P1], { resumeOnStartup: false });

    // A read-only rebuild, no pass.
    expect(double.rebuilds).toEqual([P1]);
    expect(double.drains).toEqual([]);

    loop.wake(P1, 'request-rounds', 'request_command');
    loop.wake(P1, 'request-rounds', 'request_command');
    loop.wake(P1, 'request-rounds', 'request_command');

    // The wake runs inside a command's or observer's call: no pass starts there.
    expect(double.drains).toEqual([]);
    await flush();
    expect(double.drains).toHaveLength(1);
    expect(double.drains[0]?.input).toEqual({
      maxItems: 1, continuation: null, signal: expect.any(AbortSignal),
    });
    await flush();
    expect(double.drains).toHaveLength(1);
  });

  it('runs exactly one more pass for wakes that arrive during a pass', async () => {
    const gate = deferred();
    let call = 0;
    const double = handlerDouble(async () => {
      call += 1;
      if (call === 1) {
        await gate.promise;
        return progressed({ continuation: 'after-first' });
      }
      return progressed({ continuation: 'after-second' });
    });
    const loop = wakeLoop();
    loop.register('request-rounds', double.handler);
    await loop.start([P1], { resumeOnStartup: false });
    loop.wake(P1, 'request-rounds', 'request_command');
    await flush();
    expect(double.drains).toHaveLength(1);

    loop.wake(P1, 'request-rounds', 'commit');
    loop.wake(P1, 'request-rounds', 'line_registered');
    loop.wake(P1, 'request-rounds', 'advance_settled');
    expect(double.drains).toHaveLength(1);

    gate.resolve();
    await flush();
    expect(double.drains).toHaveLength(2);
    // The next pass gets the continuation the previous pass returned.
    expect(double.drains[1]?.input.continuation).toBe('after-first');
    // Every pass gets the loop's one signal.
    expect(double.drains[1]?.input.signal).toBe(double.drains[0]?.input.signal);
    await flush();
    expect(double.drains).toHaveLength(2);
  });
});

describe('pass scheduling', () => {
  it('runs another pass after yielding when the handler reports more', async () => {
    const first = deferred();
    const double = handlerDouble(async (_scope, input) => {
      if (input.continuation === null) {
        await first.promise;
        return progressed({ progressed: 2, more: true, continuation: 'page-2' });
      }
      return progressed({ continuation: 'page-3' });
    });
    const loop = wakeLoop();
    loop.register('request-rounds', double.handler);
    await loop.start([P1], { resumeOnStartup: false });
    loop.wake(P1, 'request-rounds', 'request_command');
    await flush();
    expect(double.drains).toHaveLength(1);

    first.resolve();
    await settleMicrotasks();
    // `more` waits for an event-loop turn, not just a promise continuation.
    expect(double.drains).toHaveLength(1);
    await flush();
    expect(double.drains).toHaveLength(2);
    expect(double.drains[1]?.input.continuation).toBe('page-2');
  });

  it('parks a wrapped pass that progressed nothing until the next wake', async () => {
    let call = 0;
    const double = handlerDouble(async () => {
      call += 1;
      if (call === 1) return progressed({ progressed: 0, more: true, wrapped: true, continuation: 'wrapped-1' });
      return progressed({ progressed: 0, more: false, wrapped: true, continuation: 'wrapped-2' });
    });
    const loop = wakeLoop();
    loop.register('request-rounds', double.handler);
    await loop.start([P1], { resumeOnStartup: false });
    loop.wake(P1, 'request-rounds', 'request_command');
    await flush();
    expect(double.drains).toHaveLength(1);

    await flush();
    await flush();
    expect(double.drains).toHaveLength(1);

    loop.wake(P1, 'request-rounds', 'line_registered');
    await flush();
    expect(double.drains).toHaveLength(2);
    // The parked page's continuation is what the next wake resumes from.
    expect(double.drains[1]?.input.continuation).toBe('wrapped-1');
  });
});

describe('handler failure', () => {
  it('backs off 1, 2, 4, 8, 16, 32 and 60 seconds and resets on a progressing pass', async () => {
    let failing = true;
    let calls = 0;
    const double = handlerDouble(async () => {
      calls += 1;
      if (failing) throw new Error('the queue read failed');
      return progressed({ progressed: 1 });
    });
    const loop = wakeLoop();
    loop.register('request-rounds', double.handler);
    await loop.start([P1], { resumeOnStartup: false });
    loop.wake(P1, 'request-rounds', 'request_command');
    await flush();
    expect(calls).toBe(1);

    const backoffsInSeconds = [1, 2, 4, 8, 16, 32, 60, 60];
    let seen = calls;
    for (const seconds of backoffsInSeconds) {
      await vi.advanceTimersByTimeAsync(seconds * 1_000 - 1);
      expect(calls).toBe(seen);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(seen + 1);
      seen += 1;
    }

    // A progressing pass resets the back-off to its first step.
    failing = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(10);

    failing = true;
    loop.wake(P1, 'request-rounds', 'request_command');
    await flush();
    expect(calls).toBe(11);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(11);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(12);
  });
});

describe('commit notices and arming', () => {
  it('wakes both queues of every workspace of the notice project for QueryJob, QueryRun and Session aggregates only', async () => {
    const rounds = handlerDouble();
    const unassigned = handlerDouble();
    const loop = wakeLoop();
    loop.register('request-rounds', rounds.handler);
    loop.register('unassigned', unassigned.handler);
    await loop.start([P1, P1B, P2], { resumeOnStartup: false });

    // Arm each workspace; the arming wake runs a pass for that queue only.
    loop.wake(P1, 'request-rounds', 'request_command');
    loop.wake(P1B, 'request-rounds', 'request_command');
    loop.wake(P2, 'request-rounds', 'request_command');
    await flush();
    expect(rounds.drains).toHaveLength(3);
    expect(unassigned.drains).toHaveLength(0);

    const reset = (): void => { rounds.drains.length = 0; unassigned.drains.length = 0; };
    reset();
    loop.committed(noticeOf({ aggregateType: 'Goal', projectId: 'p1' }));
    await flush();
    expect(rounds.drains).toHaveLength(0);
    expect(unassigned.drains).toHaveLength(0);

    for (const aggregateType of ['QueryJob', 'QueryRun', 'Session']) {
      reset();
      loop.committed(noticeOf({ aggregateType, projectId: 'p1' }));
      await flush();
      // Every workspace of the project, not just the first one registered.
      expect(rounds.drains.map((pass) => pass.scope)).toEqual([P1, P1B]);
      expect(unassigned.drains.map((pass) => pass.scope)).toEqual([P1, P1B]);
    }

    // The notice names one project; the other project's workspace stays idle.
    reset();
    loop.committed(noticeOf({ aggregateType: 'Session', projectId: 'p2' }));
    await flush();
    expect(rounds.drains.map((pass) => pass.scope)).toEqual([P2]);
    expect(unassigned.drains.map((pass) => pass.scope)).toEqual([P2]);
  });

  it('keeps an unarmed workspace idle until a request_command wake arms it', async () => {
    const rounds = handlerDouble();
    const unassigned = handlerDouble();
    const loop = wakeLoop();
    loop.register('request-rounds', rounds.handler);
    loop.register('unassigned', unassigned.handler);
    await loop.start([P1], { resumeOnStartup: false });
    expect(rounds.rebuilds).toEqual([P1]);
    expect(unassigned.rebuilds).toEqual([P1]);

    loop.committed(noticeOf({ aggregateType: 'QueryJob', projectId: 'p1' }));
    loop.wake(P1, 'request-rounds', 'line_registered');
    loop.wake(P1, 'unassigned', 'advance_settled');
    await flush();
    expect(rounds.drains).toHaveLength(0);
    expect(unassigned.drains).toHaveLength(0);

    // The arming wake is also the first pass for that queue.
    loop.wake(P1, 'request-rounds', 'request_command');
    await flush();
    expect(rounds.drains).toHaveLength(1);
    expect(unassigned.drains).toHaveLength(0);

    // armed now means every wake source reaches both queues.
    loop.committed(noticeOf({ aggregateType: 'QueryJob', projectId: 'p1' }));
    await flush();
    expect(rounds.drains).toHaveLength(2);
    expect(unassigned.drains).toHaveLength(1);
  });
});

describe('close', () => {
  it('aborts the signal, waits for the running pass and starts nothing afterwards', async () => {
    const gate = deferred();
    const double = handlerDouble(async () => {
      await gate.promise;
      return progressed();
    });
    const loop = wakeLoop();
    loop.register('request-rounds', double.handler);
    await loop.start([P1], { resumeOnStartup: true });
    await flush();
    expect(double.drains).toHaveLength(1);
    const signal = double.drains[0]?.input.signal;

    let settled = false;
    const closing = loop.close().then(() => { settled = true; });
    const second = loop.close();
    expect(signal?.aborted).toBe(true);

    loop.wake(P1, 'request-rounds', 'request_command');
    loop.committed(noticeOf({ aggregateType: 'QueryJob', projectId: 'p1' }));
    await flush();
    // The running pass still has to settle before close resolves.
    expect(settled).toBe(false);
    expect(double.drains).toHaveLength(1);

    gate.resolve();
    await closing;
    await second;
    expect(settled).toBe(true);
    await flush();
    expect(double.drains).toHaveLength(1);
  });
});
