import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutoRefresh, type RefreshSnapshot } from '../../src/ui/refresh.js';
import { subscribeChanges, type ChangeStream, type ChangeStreamHandlers } from '../../src/ui/host-client.js';

/**
 * E33 rows for the page auto-refresh transport and state machine (E3-3 ruling
 * items 1, 2, 3, 5, 6 and 8). The refresh rows drive a controlled read, publish
 * and subscribe; the host-client rows drive a scripted fetch response. No Host
 * is built here: the protocol bytes are the frozen ones `server.ts` writes.
 */

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

/** One pending read per call, resolved or rejected by the row; counts in flight. */
function controlledRead() {
  const waiting: Array<{ resolve(value: string | null): void; reject(error: unknown): void }> = [];
  const state = { calls: 0, inFlight: 0, maxInFlight: 0 };
  const read = (): Promise<string | null> => new Promise((resolve, reject) => {
    state.calls += 1;
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    waiting.push({
      resolve: (value) => { state.inFlight -= 1; resolve(value); },
      reject: (error) => { state.inFlight -= 1; reject(error); },
    });
  });
  return {
    read, state,
    resolveNext(value: string | null): void { waiting.shift()!.resolve(value); },
    rejectNext(error: unknown): void { waiting.shift()!.reject(error); },
  };
}

function harness() {
  const read = controlledRead();
  const published: Array<RefreshSnapshot<string>> = [];
  const state = {
    connects: 0, handlers: null as ChangeStreamHandlers | null,
    readCursor: 'c0000000003', subscribedWith: undefined as string | null | undefined,
  };
  const refresh = createAutoRefresh<string>({
    read: async () => ({ data: await read.read(), cursor: state.readCursor }),
    publish: (snapshot) => { published.push(snapshot); },
    subscribe: (handlers, cursor): ChangeStream => {
      state.handlers = handlers;
      state.subscribedWith = cursor;
      return { connect: () => { state.connects += 1; } };
    },
  });
  const handlers = (): ChangeStreamHandlers => {
    if (state.handlers === null) throw new Error('the refresh did not subscribe');
    return state.handlers;
  };
  return { refresh, read, published, state, handlers };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('E33-3 coalesced reread', () => {
  it('E33-3 two notices during one read cause exactly one later read and one publish each', async () => {
    const { refresh, read, published, handlers } = harness();
    const started = refresh.start();
    read.resolveNext('A');
    await started;

    handlers().onNotice();
    handlers().onNotice();
    expect(read.state.calls).toBe(2);
    read.resolveNext('A');
    await flush();

    expect(read.state.calls).toBe(3);
    expect(read.state.maxInFlight).toBe(1);
    read.resolveNext('A');
    await flush();

    expect(read.state.maxInFlight).toBe(1);
    expect(published.map((snapshot) => [snapshot.data, snapshot.dataVersion])).toEqual([
      ['A', 1], ['A', 2], ['A', 3],
    ]);
  });
});

describe('E33-4 stream end and reconnect', () => {
  it('E33-4 stream end keeps the data and marks stale, then a 2 s reconnect rereads and clears it', async () => {
    vi.useFakeTimers();
    const { refresh, read, published, state, handlers } = harness();
    const started = refresh.start();
    read.resolveNext('A');
    await started;
    expect(state.connects).toBe(1);
    expect(state.subscribedWith).toBe('c0000000003');

    handlers().onEnd();
    expect(published.at(-1)).toEqual({ data: 'A', dataVersion: 1, stale: true, error: null });
    vi.advanceTimersByTime(1_999);
    expect(state.connects).toBe(1);
    vi.advanceTimersByTime(1);
    expect(state.connects).toBe(2);

    handlers().onOpen();
    expect(read.state.calls).toBe(2);
    expect(published.at(-1)).toEqual({ data: 'A', dataVersion: 1, stale: true, error: null });
    read.resolveNext('B');
    await flush();
    expect(published.at(-1)).toEqual({ data: 'B', dataVersion: 2, stale: false, error: null });
  });
});

describe('E33-5 failed reads', () => {
  it('E33-5 a reread failure keeps the data, marks stale and publishes the error', async () => {
    const { refresh, read, published, handlers } = harness();
    const started = refresh.start();
    read.resolveNext('A');
    await started;

    const failure = new Error('reread failed');
    handlers().onNotice();
    read.rejectNext(failure);
    await flush();

    expect(published.at(-1)).toEqual({ data: 'A', dataVersion: 1, stale: true, error: failure });
  });

  it('E33-5 a first-read failure does not subscribe; a successful retry subscribes', async () => {
    const { refresh, read, published, state } = harness();
    const failed = refresh.start();
    read.rejectNext(new Error('first read failed'));
    await failed;

    expect(state.connects).toBe(0);
    expect(published.at(-1)).toMatchObject({ data: null, dataVersion: 0, stale: false });
    expect(published.at(-1)?.error).toBeInstanceOf(Error);

    const retried = refresh.start();
    read.resolveNext('A');
    await retried;
    expect(state.connects).toBe(1);
    expect(published.at(-1)).toEqual({ data: 'A', dataVersion: 1, stale: false, error: null });
  });

  it('E33-5 a successful null read still subscribes', async () => {
    const { refresh, read, published, state } = harness();
    const started = refresh.start();
    read.resolveNext(null);
    await started;

    expect(state.connects).toBe(1);
    expect(published.at(-1)).toEqual({ data: null, dataVersion: 1, stale: false, error: null });
  });
});

const SSE = ': hb\n\n'
  + 'event: ready\nid: c0000000004\ndata: {"cursor":"c0000000004"}\n\n'
  + 'event: change\nid: c0000000005\ndata: {"cursor":"c0000000005","kinds":["goals"],"projects":["p"]}\n\n'
  + 'event: reset\ndata: {"cursor":null,"reason":"cursor_unknown"}\n\n';

function streamHarness() {
  const events: string[] = [];
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  return { events, requests };
}

function handlersFor(events: string[]): ChangeStreamHandlers {
  return {
    onOpen: () => { events.push('open'); },
    onNotice: () => { events.push('notice'); },
    onEnd: () => { events.push('end'); },
  };
}

describe('E33-8 change stream client', () => {
  it('E33-8 sends the token only in the header, parses the frames and resumes from the last id', async () => {
    const { events, requests } = streamHarness();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }));
    const stream = subscribeChanges(async () => 'e33-token', handlersFor(events), null, 'http://host');
    stream.connect();
    await vi.waitFor(() => expect(events).toEqual(['open', 'notice', 'notice', 'end']));

    expect(new URL(requests[0]!.url).pathname).toBe('/api/real/core/changes');
    expect(requests[0]!.url).not.toContain('e33-token');
    expect(requests[0]!.init?.method).toBe('GET');
    expect(requests[0]!.init?.headers).toEqual({ 'x-platform-token': 'e33-token' });

    stream.connect();
    await vi.waitFor(() => expect(requests.length).toBe(2));
    expect(requests[1]!.init?.headers).toEqual({
      'x-platform-token': 'e33-token', 'last-event-id': 'c0000000005',
    });
  });

  it('E33-8 the first connect resumes from the bootstrap changesHead cursor', async () => {
    const { events, requests } = streamHarness();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response('', { status: 200 });
    }));
    subscribeChanges(async () => 'e33-token', handlersFor(events), 'c0000000003', 'http://host').connect();
    await vi.waitFor(() => expect(requests.length).toBe(1));
    expect(requests[0]!.init?.headers).toEqual({
      'x-platform-token': 'e33-token', 'last-event-id': 'c0000000003',
    });
  });

  it('E33-8 an HTTP rejection ends the stream without opening it', async () => {
    const { events } = streamHarness();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ status: 'rejected', code: 'forbidden', reason: 'the local platform token is missing' }),
      { status: 403 },
    )));
    subscribeChanges(async () => 'stale-token', handlersFor(events), null).connect();
    await vi.waitFor(() => expect(events).toEqual(['end']));
  });
});
