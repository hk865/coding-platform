/**
 * Task E change-stream client — `src/ui/api/live.ts` over a real refresh hub.
 *
 * The page reads `GET /api/real/core/changes` with fetch() so the token stays
 * a header. While the stream is live no read loop runs on a timer; when it
 * fails the old 700/1000 ms polls run again and reconnects back off 1, 2, 4,
 * 8, then 15 s, resuming with `Last-Event-ID`; once it is back the polls stop.
 * A hidden page closes the stream and runs nothing. A stale token (403) or a
 * Host without the stream keeps the old polling for the page's life.
 * Fake fetch, fake timers and a fake visibility: no DOM, no network, no Host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGES_SUFFIX, LAST_EVENT_ID_HEADER, PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import { commitNewer, createLiveConnection, initialConnectionStatus } from '../../src/ui/api/live.js';
import type { ConnectionStatus, LiveConnection } from '../../src/ui/api/live.js';
import { UI_CHANGES_SUFFIX, UI_LAST_EVENT_ID_HEADER } from '../../src/ui/api/protocol.js';
import { createRefreshHub } from '../../src/ui/api/refresh.js';
import type { RefreshHub } from '../../src/ui/api/refresh.js';
import { createWorkbenchStore } from '../../src/ui/state/workbench.js';

const scope = { projectId: 'p', workspaceId: 'w' };

type Step =
  | { kind: 'stream'; status?: number; contentType?: string }
  | { kind: 'network' }
  | { kind: 'hang' };

type Call = {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  send(text: string): void;
  end(): void;
};

/** Let fetch, stream reads and promise callbacks settle without moving the fake clock. */
const settle = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

function eventStream(signal: AbortSignal) {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { open = false; },
  });
  const abort = (): void => {
    if (!open) return;
    open = false;
    controller.error(new DOMException('The operation was aborted.', 'AbortError'));
  };
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort);
  return {
    body,
    send(text: string) { if (open) controller.enqueue(encoder.encode(text)); },
    end() { if (open) { open = false; controller.close(); } },
  };
}

/** `steps` answer the first fetches (the first one is sent while constructing); later
 * ones are pushed onto `plan`. A missing step is a healthy event stream. */
function harness(options: {
  hidden?: boolean; hub?: RefreshHub; steps?: Step[]; onStatus?: (status: ConnectionStatus) => void; loadedAt?: string | null;
} = {}) {
  const hub = options.hub ?? createRefreshHub();
  const plan: Step[] = [...(options.steps ?? [])];
  const calls: Call[] = [];
  const statuses: ConnectionStatus[] = [];
  let hidden = options.hidden ?? false;
  let onVisibility: (() => void) | null = null;
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const signal = init.signal as AbortSignal;
    const headers = { ...(init.headers as Record<string, string>) };
    const step = plan.shift() ?? { kind: 'stream' };
    const stream = eventStream(signal);
    calls.push({ url, headers, signal, send: stream.send, end: stream.end });
    if (step.kind === 'network') throw new TypeError('Failed to fetch');
    if (step.kind === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      });
    }
    const status = step.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': step.contentType ?? 'text/event-stream; charset=utf-8' }),
      body: stream.body,
    } as unknown as Response;
  };
  const connection: LiveConnection = createLiveConnection({
    fetch,
    token: 'page-token',
    visibility: {
      hidden: () => hidden,
      listen: callback => { onVisibility = callback; return () => { onVisibility = null; }; },
    },
    delivery: hub,
    onStatus: status => { statuses.push(status); options.onStatus?.(status); },
    ...(options.loadedAt === undefined ? {} : { loadedAt: options.loadedAt }),
  });
  return {
    hub, plan, calls, statuses, connection,
    last: (): Call => calls[calls.length - 1]!,
    mode: () => connection.status().mode,
    setHidden: (value: boolean): void => { hidden = value; onVisibility?.(); },
  };
}

const ready = (cursor: string | null): string =>
  `event: ready\n${cursor === null ? '' : `id: ${cursor}\n`}data: ${JSON.stringify({ cursor })}\n\n`;
const driverChange = (goalId = 'g'): string =>
  `event: change\ndata: ${JSON.stringify({ cursor: 'c0000000005', kinds: ['driver'], projects: ['p'], scope, goalId, taskId: null })}\n\n`;
const commandChange = (commandId: string, state = 'settled'): string =>
  `event: change\ndata: ${JSON.stringify({ cursor: 'c0000000005', kinds: ['command'], projects: ['p'], scope, commandId, state })}\n\n`;
const commitChange = (cursor: string, kinds: string[]): string =>
  `event: change\nid: ${cursor}\ndata: ${JSON.stringify({ cursor, kinds, projects: ['p'] })}\n\n`;

/** One driver loop (1000 ms) and one command loop (700 ms), as P1/P2 register them. */
function loops(hub: RefreshHub) {
  const driver = vi.fn(async () => undefined);
  const command = vi.fn(async () => undefined);
  hub.startPoll(1000, driver, { kind: 'driver', scope, goalId: 'g' });
  hub.startPoll(700, command, { kind: 'command', scope, commandId: 'workbench-command-1' });
  return { driver, command, counts: () => [driver.mock.calls.length, command.mock.calls.length] };
}

let open: LiveConnection[] = [];
const track = <T extends { connection: LiveConnection }>(value: T): T => { open.push(value.connection); return value; };

beforeEach(() => {
  // setImmediate stays real: `settle()` uses it to drain stream reads.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  for (const connection of open) connection.stop();
  open = [];
  vi.useRealTimers();
});

describe('protocol and store', () => {
  it('mirrors the Host stream constants and starts the connection slice as connecting', () => {
    expect(UI_CHANGES_SUFFIX).toBe(CHANGES_SUFFIX);
    expect(UI_LAST_EVENT_ID_HEADER).toBe(LAST_EVENT_ID_HEADER);
    const store = createWorkbenchStore();
    expect(store.get('connection')).toStrictEqual(initialConnectionStatus());
    expect(initialConnectionStatus()).toStrictEqual({ mode: 'connecting', cursor: null, attempt: 0, reason: null });
  });

  it('feeds every status change into the store slice', async () => {
    const store = createWorkbenchStore();
    const seen: string[] = [];
    store.subscribe('connection', status => seen.push(status.mode));
    const h = track(harness({ onStatus: status => store.set('connection', status) }));
    await settle();
    h.last().send(ready('c0000000002'));
    await settle();
    expect(store.get('connection')).toStrictEqual({ mode: 'live', cursor: 'c0000000002', attempt: 0, reason: null });
    expect(seen).toEqual(['connecting', 'live']);
  });
});

describe('live stream', () => {
  it('opens one GET with the token header and no resume id, then reads only on matching notices', async () => {
    const h = track(harness());
    const loop = loops(h.hub);
    await settle();
    expect(h.calls).toHaveLength(1);
    expect(h.last().url).toBe('/api/real/core/changes');
    expect(h.last().headers).toStrictEqual({ [PLATFORM_TOKEN_HEADER]: 'page-token', accept: 'text/event-stream' });
    expect(h.mode()).toBe('connecting');
    expect(h.hub.delivery()).toBe('timers');
    h.last().send(ready('c0000000004'));
    await settle();
    expect(h.mode()).toBe('live');
    expect(h.hub.delivery()).toBe('notices');
    expect(h.connection.status().cursor).toBe('c0000000004');
    // The connect catch-up reads each loop once, then nothing runs on a timer.
    await vi.advanceTimersByTimeAsync(50);
    expect(loop.counts()).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(loop.counts()).toEqual([1, 1]);
    h.last().send(driverChange('other') + commandChange('workbench-command-2') + commitChange('c0000000006', ['tasks']));
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(loop.counts()).toEqual([1, 1]);
    expect(h.connection.status().cursor).toBe('c0000000006');
    h.last().send(driverChange() + driverChange() + driverChange());
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(loop.counts()).toEqual([2, 1]);
    h.last().send(commandChange('workbench-command-1', 'stopping'));
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(loop.counts()).toEqual([2, 2]);
    expect(h.calls).toHaveLength(1);
  });

  it('stays live on heartbeats and falls back after 45 s without a byte', async () => {
    const h = track(harness());
    await settle();
    h.last().send(ready('c0000000001'));
    await settle();
    for (let index = 0; index < 8; index += 1) {
      await vi.advanceTimersByTimeAsync(15_000);
      h.last().send(': hb\n\n');
      await settle();
    }
    expect(h.mode()).toBe('live');
    await vi.advanceTimersByTimeAsync(44_999);
    expect(h.mode()).toBe('live');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.connection.status()).toMatchObject({ mode: 'fallback', attempt: 1, reason: 'silent' });
    expect(h.calls[0]!.signal.aborted).toBe(true);
  });

  it('falls back when no event arrives within 10 s of connecting', async () => {
    const h = track(harness());
    await settle();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(h.mode()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.connection.status()).toMatchObject({ mode: 'fallback', reason: 'ready_timeout' });
    expect(h.calls[0]!.signal.aborted).toBe(true);
  });
});

describe('fallback and recovery', () => {
  it('polls while the stream is down, backs off 1/2/4/8/15/15 s, resumes with Last-Event-ID and stops polling once back', async () => {
    const h = track(harness());
    const loop = loops(h.hub);
    await settle();
    h.last().send(ready('c0000000004') + commitChange('c0000000005', ['goals']));
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    expect(loop.counts()).toEqual([1, 1]);

    h.last().end();
    await settle();
    expect(h.connection.status()).toMatchObject({ mode: 'fallback', attempt: 1, reason: 'stream_ended', cursor: 'c0000000005' });
    expect(h.hub.delivery()).toBe('timers');
    // The old polls are back: 700 ms command reads, 1000 ms driver reads.
    h.plan.push({ kind: 'network' }, { kind: 'stream' }, { kind: 'hang' }, { kind: 'stream', status: 503 },
      { kind: 'stream', status: 429 });
    await vi.advanceTimersByTimeAsync(700);
    expect(loop.counts()).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(299);
    expect(h.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(loop.counts()).toEqual([2, 2]);
    expect(h.calls).toHaveLength(2);
    expect(h.last().headers[LAST_EVENT_ID_HEADER]).toBe('c0000000005');
    await settle();
    expect(h.connection.status()).toMatchObject({ mode: 'fallback', attempt: 2, reason: 'network' });

    // attempt 3 after 2 s: a stream that ends at once.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls).toHaveLength(3);
    expect(h.mode()).toBe('connecting');
    expect(h.hub.delivery()).toBe('timers');
    h.last().end();
    await settle();
    expect(h.connection.status()).toMatchObject({ mode: 'fallback', attempt: 3, reason: 'stream_ended' });

    // attempt 4 after 4 s: the request hangs until the 10 s ready timeout.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(h.connection.status()).toMatchObject({ mode: 'fallback', attempt: 4, reason: 'ready_timeout' });
    expect(h.calls[3]!.signal.aborted).toBe(true);

    // attempt 5 after 8 s (503), attempt 6 after 15 s (429), attempt 7 after 15 s (the cap).
    await vi.advanceTimersByTimeAsync(8_000);
    await settle();
    expect(h.calls).toHaveLength(5);
    expect(h.connection.status()).toMatchObject({ mode: 'fallback', attempt: 5, reason: 'http_503' });
    await vi.advanceTimersByTimeAsync(15_000);
    await settle();
    expect(h.calls).toHaveLength(6);
    expect(h.connection.status()).toMatchObject({ mode: 'fallback', attempt: 6, reason: 'http_429' });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(h.calls).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls).toHaveLength(7);
    for (const call of h.calls.slice(1)) expect(call.headers[LAST_EVENT_ID_HEADER]).toBe('c0000000005');

    // Recovery: polls stop, each loop catches up once, and the backoff starts over.
    const before = loop.counts();
    h.last().send(ready('c0000000005'));
    await settle();
    expect(h.connection.status()).toStrictEqual({ mode: 'live', cursor: 'c0000000005', attempt: 0, reason: null });
    expect(h.hub.delivery()).toBe('notices');
    await vi.advanceTimersByTimeAsync(50);
    expect(loop.counts()).toEqual([before[0]! + 1, before[1]! + 1]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(loop.counts()).toEqual([before[0]! + 1, before[1]! + 1]);
    h.last().end();
    await settle();
    expect(h.connection.status()).toMatchObject({ mode: 'fallback', attempt: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.calls).toHaveLength(8);
  });

  it('treats a 200 that is not an event stream as a failure', async () => {
    const h = track(harness({ steps: [{ kind: 'stream', contentType: 'application/json' }] }));
    await settle();
    expect(h.connection.status()).toMatchObject({ mode: 'fallback', attempt: 1, reason: 'not_event_stream' });
  });

  it.each([401, 403, 404, 405, 501])('keeps the old polling for good after HTTP %i, also across hide and show', async status => {
    const h = track(harness({ steps: [{ kind: 'stream', status }] }));
    const loop = loops(h.hub);
    await settle();
    expect(h.connection.status()).toMatchObject({ mode: 'closed', reason: `http_${status}` });
    expect(h.hub.delivery()).toBe('timers');
    await vi.advanceTimersByTimeAsync(7_000);
    expect(loop.counts()).toEqual([7, 10]);
    h.setHidden(true);
    expect(h.mode()).toBe('paused');
    await vi.advanceTimersByTimeAsync(7_000);
    expect(loop.counts()).toEqual([7, 10]);
    h.setHidden(false);
    expect(h.mode()).toBe('closed');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.calls).toHaveLength(1);
  });

  it('runs the loops on every ready, and the watches on reset or an unresumable reconnect only', async () => {
    const h = track(harness());
    const loop = loops(h.hub);
    const refetch = vi.fn(async () => undefined);
    h.hub.watchChanges(notice => notice.kinds.includes('tasks'), refetch);
    await settle();
    // The page's first stream, empty ledger: no id. Everything shown was just read.
    h.last().send(ready(null));
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    expect(refetch).not.toHaveBeenCalled();
    expect(loop.counts()).toEqual([1, 1]);

    // Reconnect without a resume point after a failure: the watches run.
    h.last().end();
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.last().headers[LAST_EVENT_ID_HEADER]).toBeUndefined();
    h.last().send(ready('c0000000004'));
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    expect(refetch).toHaveBeenCalledTimes(1);

    // A resumed ready means nothing was missed: loops only.
    h.last().end();
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.last().headers[LAST_EVENT_ID_HEADER]).toBe('c0000000004');
    const beforeResumed = loop.counts();
    h.last().send(ready('c0000000004'));
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(loop.counts()).toEqual([beforeResumed[0]! + 1, beforeResumed[1]! + 1]);
    const afterReady = loop.counts();

    h.last().end();
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    h.last().send('event: reset\nid: c0000000900\ndata: {"cursor":"c0000000900","reason":"cursor_too_old"}\n\n');
    await settle();
    expect(h.connection.status()).toMatchObject({ mode: 'live', cursor: 'c0000000900' });
    await vi.advanceTimersByTimeAsync(400);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(loop.counts()[0]).toBeGreaterThan(afterReady[0]!);

    // A resume inside the kept window opens with one coalesced change instead of ready.
    h.last().end();
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.last().headers[LAST_EVENT_ID_HEADER]).toBe('c0000000900');
    const beforeCoalesced = loop.counts();
    h.last().send(commitChange('c0000000903', ['executions', 'tasks']));
    await settle();
    expect(h.mode()).toBe('live');
    await vi.advanceTimersByTimeAsync(400);
    expect(refetch).toHaveBeenCalledTimes(3);
    expect(loop.counts()).toEqual([beforeCoalesced[0]! + 1, beforeCoalesced[1]! + 1]);
  });
});

describe('commits made while the page loaded', () => {
  it('compares commit cursors by sequence', () => {
    expect(commitNewer('c0000000005', 'c0000000004')).toBe(true);
    expect(commitNewer('c0000000004', 'c0000000004')).toBe(false);
    expect(commitNewer('c0000000003', 'c0000000004')).toBe(false);
    expect(commitNewer('c0000000001', null)).toBe(true);
    expect(commitNewer(null, null)).toBe(false);
    expect(commitNewer(null, 'c0000000004')).toBe(false);
    expect(commitNewer('c0000000001', 'garbage')).toBe(true);
    expect(commitNewer('garbage', 'c0000000001')).toBe(false);
  });

  it('runs the watches on the first ready only when its head is newer than the bootstrap head', async () => {
    const cases: [loadedAt: string | null | undefined, head: string | null, watchRuns: number][] = [
      ['c0000000004', 'c0000000004', 0], // nothing committed between bootstrap and subscription
      ['c0000000004', 'c0000000006', 1], // a commit landed while the page loaded
      [null, null, 0], // still an empty ledger
      [null, 'c0000000001', 1], // the first commit landed while the page loaded
      [undefined, 'c0000000006', 0], // no bootstrap head: as before, no watch run
    ];
    for (const [loadedAt, head, watchRuns] of cases) {
      const h = track(harness(loadedAt === undefined ? {} : { loadedAt }));
      const loop = loops(h.hub);
      const refetch = vi.fn(async () => undefined);
      h.hub.watchChanges(() => false, refetch);
      await settle();
      h.last().send(ready(head));
      await settle();
      await vi.advanceTimersByTimeAsync(400);
      expect(refetch, `bootstrap ${String(loadedAt)}, ready ${String(head)}`).toHaveBeenCalledTimes(watchRuns);
      expect(loop.counts()).toEqual([1, 1]);
      // Compared once: a later resumed ready does not run the watches again. (A
      // reconnect without a resume point runs them anyway, see above.)
      if (head === null) continue;
      h.last().end();
      await settle();
      await vi.advanceTimersByTimeAsync(1_000);
      h.last().send(ready(head));
      await settle();
      await vi.advanceTimersByTimeAsync(400);
      expect(refetch).toHaveBeenCalledTimes(watchRuns);
    }
  });
});

describe('page visibility', () => {
  it('closes the stream and runs nothing while hidden, then reconnects at once with Last-Event-ID', async () => {
    const h = track(harness());
    const loop = loops(h.hub);
    await settle();
    h.last().send(ready('c0000000007'));
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    expect(loop.counts()).toEqual([1, 1]);

    h.setHidden(true);
    await settle();
    expect(h.connection.status()).toMatchObject({ mode: 'paused', cursor: 'c0000000007' });
    expect(h.hub.delivery()).toBe('off');
    expect(h.calls[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(loop.counts()).toEqual([1, 1]);
    expect(h.calls).toHaveLength(1);

    h.setHidden(false);
    expect(h.calls).toHaveLength(2);
    expect(h.last().headers[LAST_EVENT_ID_HEADER]).toBe('c0000000007');
    expect(h.mode()).toBe('connecting');
    await settle();
    h.last().send(ready('c0000000007'));
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    expect(loop.counts()).toEqual([2, 2]);
    expect(h.mode()).toBe('live');
  });

  it('pauses a pending reconnect and does not connect while the page starts hidden', async () => {
    const h = track(harness({ hidden: true }));
    const refetch = vi.fn(async () => undefined);
    h.hub.watchChanges(() => true, refetch);
    await settle();
    expect(h.mode()).toBe('paused');
    expect(h.hub.delivery()).toBe('off');
    expect(h.calls).toHaveLength(0);
    h.setHidden(false);
    await settle();
    expect(h.calls).toHaveLength(1);
    // What was read while hidden may be stale: the first ready runs the watches.
    h.last().send(ready('c0000000003'));
    await settle();
    await vi.advanceTimersByTimeAsync(300);
    expect(refetch).toHaveBeenCalledTimes(1);
    h.last().end();
    await settle();
    expect(h.mode()).toBe('fallback');
    h.setHidden(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls).toHaveLength(1);
    expect(h.mode()).toBe('paused');
  });

  it('stop() aborts the stream and never reconnects', async () => {
    const h = harness();
    await settle();
    h.connection.stop();
    expect(h.calls[0]!.signal.aborted).toBe(true);
    expect(h.connection.status()).toMatchObject({ mode: 'closed', reason: 'stopped' });
    h.setHidden(true);
    h.setHidden(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls).toHaveLength(1);
  });
});
