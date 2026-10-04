/**
 * Task E change stream route over a real loopback listener: the token and Host
 * boundary, the event-stream response, commit notices with their cursor,
 * handle notices without an id, the heartbeat, `Last-Event-ID` resume and reset,
 * the stream ceiling, the write-backlog limit, and cleanup (subscription and
 * heartbeat) when the client leaves or the Host closes; and the feed head in
 * the bootstrap reply.
 * The bindings are never called by this route, so an empty stub suffices.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import { createConnection, type Socket } from 'node:net';
import { createChangeFeed, type ChangeFeed } from '../../src/app/change-feed.js';
import {
  BOOTSTRAP_SUFFIX,
  CHANGES_SUFFIX,
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  type BootstrapResponse,
} from '../../src/app/core-http-types.js';
import type { CoreRouteBindings } from '../../src/app/core-routes.js';
import { createWorkbenchServer, type WorkbenchServer, type WorkbenchServerOptions } from '../../src/app/server.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import { openChangeStream, until, type OpenedStream } from '../helpers/change-stream-reader.js';

const TOKEN = 'change-stream-test-token';
const scope = { projectId: 'stream-project', workspaceId: 'stream-workspace' };
const c = (seq: number) => makeCommitCursor(seq);

const servers: WorkbenchServer[] = [];
const streams: OpenedStream[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const stream of streams.splice(0)) stream.abort();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) await server.close();
});

async function start(overrides: Partial<WorkbenchServerOptions> = {}): Promise<{ server: WorkbenchServer; origin: string }> {
  const server = createWorkbenchServer({
    token: TOKEN,
    bindings: {} as CoreRouteBindings,
    actor: { kind: 'human', id: 'change-stream-operator' },
    bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
    allowsScope: () => false,
    ...overrides,
  });
  servers.push(server);
  const address = await server.listen(0);
  return { server, origin: `http://${address.host}:${address.port}` };
}

async function open(origin: string, lastEventId?: string): Promise<OpenedStream> {
  const stream = await openChangeStream(origin, TOKEN, lastEventId);
  streams.push(stream);
  return stream;
}

const changesUrl = (origin: string): string => new URL(CORE_API_PREFIX + CHANGES_SUFFIX, origin).toString();

function seededFeed(head: number | null, bufferSize?: number): ChangeFeed {
  const feed = createChangeFeed(bufferSize === undefined ? {} : { bufferSize });
  feed.started(head === null ? null : c(head));
  return feed;
}

describe('change stream boundary', () => {
  it('rejects a missing or stale token, a non-GET method, a foreign Host and a Host without a feed', async () => {
    const feed = seededFeed(1);
    const { origin } = await start({ changes: feed });
    const missing = await fetch(changesUrl(origin));
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const stale = await fetch(changesUrl(origin), { headers: { [PLATFORM_TOKEN_HEADER]: 'stale-token' } });
    expect(stale.status).toBe(403);
    const posted = await fetch(changesUrl(origin), { method: 'POST', headers: { [PLATFORM_TOKEN_HEADER]: TOKEN } });
    expect(posted.status).toBe(405);
    expect(await posted.json()).toMatchObject({ code: 'invalid', reason: 'use GET for the change stream' });
    const foreign = await new Promise<number>((resolvePromise, reject) => {
      const url = new URL(changesUrl(origin));
      const request = httpRequest({ host: url.hostname, port: url.port, path: url.pathname, method: 'GET',
        headers: { host: `evil.example:${url.port}`, [PLATFORM_TOKEN_HEADER]: TOKEN } }, response => {
        response.resume();
        resolvePromise(response.statusCode ?? 0);
      });
      request.on('error', reject);
      request.end();
    });
    expect(foreign).toBe(403);
    const crossOrigin = await fetch(changesUrl(origin), { headers: { [PLATFORM_TOKEN_HEADER]: TOKEN, origin: 'http://evil.example' } });
    expect(crossOrigin.status).toBe(403);
    expect(feed.subscribers()).toBe(0);

    const withoutFeed = await start();
    const unsupported = await fetch(changesUrl(withoutFeed.origin), { headers: { [PLATFORM_TOKEN_HEADER]: TOKEN } });
    expect(unsupported.status).toBe(501);
    expect(await unsupported.json()).toMatchObject({ status: 'rejected', code: 'unsupported' });
  });

  it('opens an event stream whose first event is ready at the ledger head', async () => {
    const { origin } = await start({ changes: seededFeed(41) });
    const stream = await open(origin);
    expect(stream.response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(stream.response.headers.get('cache-control')).toBe('no-store');
    expect(await stream.nextEvent()).toEqual({ comment: false, event: 'ready', id: 'c0000000041', data: { cursor: 'c0000000041' } });

    const empty = await start({ changes: seededFeed(null) });
    const emptyStream = await open(empty.origin);
    expect(await emptyStream.nextEvent()).toEqual({ comment: false, event: 'ready', id: null, data: { cursor: null } });
  });
});

describe('change stream notices', () => {
  it('pushes commit notices with their cursor and handle notices without an id', async () => {
    const feed = seededFeed(41);
    const { origin } = await start({ changes: feed });
    const stream = await open(origin);
    expect((await stream.nextEvent())?.event).toBe('ready');
    feed.committed({ cursor: c(44), aggregates: [
      { aggregateType: 'Task', projectId: scope.projectId }, { aggregateType: 'Run', projectId: scope.projectId },
    ] });
    expect(await stream.nextEvent()).toEqual({ comment: false, event: 'change', id: 'c0000000044',
      data: { cursor: 'c0000000044', kinds: ['executions', 'tasks'], projects: [scope.projectId] } });
    feed.driverChanged({ scope, goalId: 'stream-goal', taskId: null });
    expect(await stream.nextEvent()).toEqual({ comment: false, event: 'change', id: null,
      data: { cursor: 'c0000000044', kinds: ['driver'], projects: [scope.projectId], scope, goalId: 'stream-goal', taskId: null } });
    feed.commandChanged({ scope, commandId: 'workbench-command-7', state: 'settled' });
    expect(await stream.nextEvent()).toEqual({ comment: false, event: 'change', id: null,
      data: { cursor: 'c0000000044', kinds: ['command'], projects: [scope.projectId], scope,
        commandId: 'workbench-command-7', state: 'settled' } });
    // Nothing else is pushed while nothing changes (the default heartbeat is 15 s).
    expect(await stream.quiet(300)).toBe(true);
  });

  it('writes a heartbeat comment while idle', async () => {
    const { origin } = await start({ changes: seededFeed(1), changesHeartbeatMs: 25 });
    const stream = await open(origin);
    expect((await stream.next())?.event).toBe('ready');
    expect(await stream.next(1_000)).toEqual({ comment: true, event: null, id: null, data: null });
    expect(await stream.next(1_000)).toEqual({ comment: true, event: null, id: null, data: null });
  });
});

describe('change stream Last-Event-ID resume', () => {
  it('replays a kept gap as one change, and resets a cursor that is too old, unknown or malformed', async () => {
    const feed = seededFeed(10, 3);
    feed.committed({ cursor: c(11), aggregates: [{ aggregateType: 'Goal', projectId: 'p1' }] });
    feed.committed({ cursor: c(12), aggregates: [{ aggregateType: 'SessionMessage', projectId: 'p2' }] });
    feed.committed({ cursor: c(13), aggregates: [{ aggregateType: 'Task', projectId: 'p1' }] });
    const { origin } = await start({ changes: feed });
    const first = async (lastEventId: string) => {
      const stream = await open(origin, lastEventId);
      const frame = await stream.nextEvent();
      stream.abort();
      return frame;
    };
    expect(await first('c0000000013')).toEqual({ comment: false, event: 'ready', id: 'c0000000013', data: { cursor: 'c0000000013' } });
    expect(await first('c0000000011')).toEqual({ comment: false, event: 'change', id: 'c0000000013',
      data: { cursor: 'c0000000013', kinds: ['messages', 'tasks'], projects: ['p1', 'p2'] } });
    expect(await first('c0000000010')).toEqual({ comment: false, event: 'change', id: 'c0000000013',
      data: { cursor: 'c0000000013', kinds: ['goals', 'messages', 'tasks'], projects: ['p1', 'p2'] } });
    // A fourth commit evicts c11 from the 3-notice window.
    feed.committed({ cursor: c(14), aggregates: [{ aggregateType: 'Project', projectId: 'p3' }] });
    expect(await first('c0000000010')).toEqual({ comment: false, event: 'reset', id: 'c0000000014',
      data: { cursor: 'c0000000014', reason: 'cursor_too_old' } });
    expect(await first('c0000000099')).toEqual({ comment: false, event: 'reset', id: 'c0000000014',
      data: { cursor: 'c0000000014', reason: 'cursor_unknown' } });
    expect(await first('not-a-cursor')).toEqual({ comment: false, event: 'reset', id: 'c0000000014',
      data: { cursor: 'c0000000014', reason: 'cursor_invalid' } });
  });

  it('continues live after a resume', async () => {
    const feed = seededFeed(20);
    feed.committed({ cursor: c(21), aggregates: [{ aggregateType: 'Session', projectId: 'p1' }] });
    const { origin } = await start({ changes: feed });
    const stream = await open(origin, 'c0000000020');
    expect((await stream.nextEvent())?.data).toEqual({ cursor: 'c0000000021', kinds: ['sessions'], projects: ['p1'] });
    feed.committed({ cursor: c(22), aggregates: [{ aggregateType: 'Session', projectId: 'p1' }] });
    expect((await stream.nextEvent())?.id).toBe('c0000000022');
  });
});

describe('change stream limits and cleanup', () => {
  it('answers 429 above the ceiling and unsubscribes when the client goes away', async () => {
    const feed = seededFeed(5);
    const { origin } = await start({ changes: feed, maxChangeStreams: 1 });
    const stream = await open(origin);
    expect((await stream.nextEvent())?.event).toBe('ready');
    expect(feed.subscribers()).toBe(1);
    const second = await fetch(changesUrl(origin), { headers: { [PLATFORM_TOKEN_HEADER]: TOKEN } });
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ status: 'rejected', code: 'capacity' });
    stream.abort();
    await until(() => feed.subscribers() === 0);
    const again = await open(origin);
    expect((await again.nextEvent())?.event).toBe('ready');
  });

  it('clears the heartbeat of a stream whose client went away', async () => {
    const heartbeatMs = 54_321;
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const feed = seededFeed(5);
    const { origin } = await start({ changes: feed, changesHeartbeatMs: heartbeatMs });
    const stream = await open(origin);
    expect((await stream.nextEvent())?.event).toBe('ready');
    const index = setSpy.mock.calls.findIndex(call => call[1] === heartbeatMs);
    expect(index).toBeGreaterThanOrEqual(0);
    const heartbeat = setSpy.mock.results[index]?.value as unknown;
    expect(clearSpy).not.toHaveBeenCalledWith(heartbeat);
    stream.abort();
    await until(() => feed.subscribers() === 0);
    expect(clearSpy).toHaveBeenCalledWith(heartbeat);
  });

  it('ends a stream whose client stops reading once its unsent backlog passes the limit', async () => {
    const feed = seededFeed(5, 8);
    const { origin } = await start({ changes: feed, maxChangeStreamBacklogBytes: 16 * 1024 });
    const url = new URL(changesUrl(origin));
    // A raw client that sends the GET and then never reads a byte.
    const socket = createConnection({ host: url.hostname, port: Number(url.port) });
    sockets.push(socket);
    await new Promise<void>((resolvePromise, reject) => {
      socket.once('connect', () => resolvePromise());
      socket.once('error', reject);
    });
    socket.pause();
    socket.write(`GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\n${PLATFORM_TOKEN_HEADER}: ${TOKEN}\r\naccept: text/event-stream\r\n\r\n`);
    await until(() => feed.subscribers() === 1);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200));
    expect(feed.subscribers()).toBe(1);
    // Notices of ~40 KB each (200 long project ids) until the socket buffers are
    // full and the response starts to queue.
    const aggregates = Array.from({ length: 200 }, (_, index) =>
      ({ aggregateType: 'Task', projectId: `backlog-project-${index}-${'x'.repeat(180)}` }));
    for (let seq = 6; seq < 406 && feed.subscribers() > 0; seq += 1) {
      feed.committed({ cursor: c(seq), aggregates });
      await new Promise(resolvePromise => setImmediate(resolvePromise));
    }
    await until(() => feed.subscribers() === 0, 5_000);
  });

  it('ends open streams promptly when the Host closes', async () => {
    const feed = seededFeed(5);
    const { server, origin } = await start({ changes: feed });
    const stream = await open(origin);
    expect((await stream.nextEvent())?.event).toBe('ready');
    const started = Date.now();
    await server.close();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await stream.next(1_000)).toBeNull();
    expect(feed.subscribers()).toBe(0);
    const late = await fetch(changesUrl(origin), { headers: { [PLATFORM_TOKEN_HEADER]: TOKEN } }).catch(() => null);
    expect(late === null || late.status === 503).toBe(true);
  });
});

describe('bootstrap head', () => {
  const readBootstrap = async (origin: string): Promise<BootstrapResponse> => {
    const response = await fetch(new URL(CORE_API_PREFIX + BOOTSTRAP_SUFFIX, origin), { headers: { [PLATFORM_TOKEN_HEADER]: TOKEN } });
    expect(response.status).toBe(200);
    return await response.json() as BootstrapResponse;
  };

  it('adds the feed head to the bootstrap reply, and nothing without a feed', async () => {
    const feed = seededFeed(41);
    const { origin } = await start({ changes: feed });
    expect(await readBootstrap(origin)).toEqual({
      workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] }, changesHead: 'c0000000041',
    });
    feed.committed({ cursor: c(42), aggregates: [{ aggregateType: 'Goal', projectId: 'p1' }] });
    expect((await readBootstrap(origin)).changesHead).toBe('c0000000042');
    expect((await readBootstrap((await start({ changes: seededFeed(null) })).origin)).changesHead).toBeNull();
    expect('changesHead' in await readBootstrap((await start()).origin)).toBe(false);
  });
});
