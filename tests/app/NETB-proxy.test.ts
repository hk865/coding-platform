/**
 * NET-B NB-03…NB-11 (netb-start-rulings §2.2 items 2–8; lead ruling NET-B Q7): the command proxy driven through a
 * route's own unix socket, the step a sandboxed command really takes; no bubblewrap. `lookup`, `dial`, `localAddresses`
 * are the Host input `networkProvider` (A8): `pkg.example` resolves to 93.184.216.34 unless a row says otherwise, every
 * dial lands on this file's stub upstream. `lookup` is counted (A3); the recorder and `dial` share one log (note, then
 * dial); `maxOpenConnections` is a small cap set by option (A2). Red today: the module import, every cell; green after
 * B1. Mutations: NB-03 dial by name / resolve twice / dial before noting; NB-04 ① absolute URL kept, ② Proxy-
 * Authorization forwarded, ③ client's Host kept; NB-05 no address check / ③ literals skipped / ④ own addresses ignored;
 * NB-06 first address unfiltered / refused on the first; NB-07 ① sent by Host header, ② https:// accepted, ③ port 443
 * assumed, ④ no length check; NB-08 failed lookup as 403; NB-09 dial although the note failed; NB-10 no cap / slot
 * kept after close; NB-11 tunnels survive `close()`.
 * NB-18 (§2.2 item 7): a client connection holds a Host-wide slot from the moment it is accepted. Mutations: slot taken
 * only at the request / counted per route / kept after close. NB-19 (§2.2 item 8): routes opened at the same time each
 * listen on a socket of their own. Mutation: the socket name read after the await. NB-20 (§2.2 item 4): a chunked body
 * reaches the upstream whole whatever the method. Mutation: the outgoing hop without `Transfer-Encoding: chunked`.
 */
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingHttpHeaders } from 'node:http';
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createCommandNetworkProxy, type CommandNetworkProxy } from '../../src/app/command-sandbox.js';
import type { RunNetworkHostV1 } from '../../src/contracts/run-network.js';

type Resolved = { address: string; family: 4 | 6 };
const proxies: CommandNetworkProxy[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const proxy of proxies.splice(0)) await proxy.close();
  for (const server of servers.splice(0)) server.close();
});

/** A fresh proxy and route for each cell (a route notes each host, port and verdict once, §2.2 item 5); `upstream`
 *  defaults to an echo server. */
async function world(over: { lookup?: (host: string) => Promise<Resolved[]>; local?: string[]; max?: number;
  failNote?: boolean; upstream?: Server } = {}) {
  const log: string[] = [];
  let lookups = 0;
  const lookup: (host: string) => Promise<Resolved[]> = over.lookup ?? resolvesTo('93.184.216.34');
  const upstream = over.upstream ?? createServer(socket => { socket.pipe(socket); });
  servers.push(upstream.on('connection', (socket: Socket) => { sockets.push(socket); }));
  await new Promise<void>(resolve => { upstream.listen(0, '127.0.0.1', resolve); });
  const proxy = createCommandNetworkProxy({
    lookup: async host => { lookups += 1; return await lookup(host); },
    dial: (address, port) => {
      log.push(`dial ${address}:${String(port)}`);
      return connect((upstream.address() as AddressInfo).port, '127.0.0.1');
    },
    localAddresses: () => over.local ?? [],
    ...(over.max === undefined ? {} : { maxOpenConnections: over.max }),
    now: () => '2026-11-13T02:00:00.000Z',
  });
  proxies.push(proxy);
  /** A route's recorder noting into `into`; another route of the same proxy gets its own. */
  const recorder = (into: string[]) => async (entry: RunNetworkHostV1): Promise<void> => {
    if (over.failNote === true) throw new Error('the record write failed');
    into.push(`note ${entry.host}:${String(entry.port)} ${entry.address} ${entry.verdict}`);
  };
  const route = proxy.route(recorder(log));
  await route.open();
  const socketPath = route.source.current()?.socketPath;
  if (socketPath === undefined) throw new Error('an opened route must have a socket');
  return { proxy, recorder, route, socketPath, log, lookups: () => lookups };
}

type Answer = { line: string; status: number; body: string; socket: Socket };
/** One raw request on the route's socket: the status line and the body (by its length, chunked, or to the end); a
 *  200 to CONNECT answers at once with the open tunnel. */
function send(socketPath: string, request: string): Promise<Answer> {
  const socket = connect(socketPath);
  sockets.push(socket);
  let data = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const settle = (ended: boolean): void => {
      const end = data.indexOf('\r\n\r\n');
      if (end < 0) { if (ended) reject(new Error(`no answer: ${data.toString()}`)); return; }
      const head = data.subarray(0, end).toString().toLowerCase().split('\r\n');
      const header = (name: string) => head.find(line => line.startsWith(`${name}:`))?.slice(name.length + 1).trim();
      const line = data.subarray(0, data.indexOf('\r\n')).toString();
      const status = Number(line.split(' ')[1]);
      let body = data.subarray(end + 4);
      if (request.startsWith('CONNECT') && status === 200) body = Buffer.alloc(0);
      else if (header('transfer-encoding') === 'chunked') {
        if (!body.includes('0\r\n\r\n') && !ended) return;
        const parts: Buffer[] = [];
        for (let at = 0; ;) {
          const eol = body.indexOf('\r\n', at);
          const size = parseInt(body.subarray(at, eol).toString(), 16) || 0;
          if (size === 0) break;
          parts.push(body.subarray(eol + 2, eol + 2 + size));
          at = eol + 4 + size;
        }
        body = Buffer.concat(parts);
      } else if (!ended && (header('content-length') === undefined || body.length < Number(header('content-length')))) return;
      socket.removeAllListeners('data');
      resolve({ line, status, body: body.toString(), socket });
    };
    socket.on('data', (chunk: Buffer) => { data = Buffer.concat([data, chunk]); settle(false); });
    socket.once('end', () => { settle(true); });
    socket.on('error', reject);
    socket.write(request);
  });
}

const connectTo = (target: string): string => `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`;
const pkg = connectTo('pkg.example:443');
function resolvesTo(...addresses: string[]): () => Promise<Resolved[]> {
  return async () => addresses.map(address => ({ address, family: 4 as const }));
}

it('NB-03 CONNECT resolves once, notes the host before it dials the checked IP, then tunnels both ways', async () => {
  const w = await world();
  const tunnel = await send(w.socketPath, pkg);
  expect(tunnel.line).toBe('HTTP/1.1 200 Connection Established');
  tunnel.socket.write('ping');
  expect(String((await once(tunnel.socket, 'data'))[0])).toBe('ping');
  expect(w.lookups()).toBe(1);
  expect(w.log).toEqual(['note pkg.example:443 93.184.216.34 allowed', 'dial 93.184.216.34:443']);
});

type Seen = { line: string; headers: IncomingHttpHeaders };
it.each<[string, (seen: Seen) => unknown, unknown]>([
  ['① the request line carries only the path and query', seen => seen.line, 'GET /a?t=s HTTP/1.1'],
  ['② Proxy-Authorization is not forwarded', seen => seen.headers['proxy-authorization'], undefined],
  ['③ Host is the host of the URL', seen => seen.headers.host, 'pkg.example'],
])('NB-04 an http:// absolute URL reaches the upstream as an origin request: %s', async (_, pick, expected) => {
  const seen: Seen[] = [];
  const w = await world({ upstream: createHttpServer((request, response) => {
    seen.push({ line: `${String(request.method)} ${String(request.url)} HTTP/${request.httpVersion}`, headers: request.headers });
    response.end('ok');
  }) });
  expect(await send(w.socketPath, 'GET http://pkg.example/a?t=s HTTP/1.1\r\nHost: 127.0.0.1\r\n'
    + 'Proxy-Authorization: Basic eA==\r\nProxy-Connection: keep-alive\r\n\r\n')).toMatchObject({ status: 200, body: 'ok' });
  expect(seen.map(pick)).toEqual([expected]);
});

describe('rejects: NB-05 a loopback, private or own address is refused before any dial (safety: the platform page carries its token; internal services and cloud metadata)', () => {
  it.each<[string, string, Parameters<typeof world>[0], string]>([
    ['① a name resolving to loopback', 'pkg.example:443', { lookup: resolvesTo('127.0.0.1') }, 'pkg.example'],
    ['② a name resolving to a private address', 'pkg.example:443', { lookup: resolvesTo('10.0.0.5') }, 'pkg.example'],
    ['③ an IPv6 literal mapping loopback, not resolved', '[::ffff:7f00:1]:80', {}, '::ffff:7f00:1'],
    ['④ a name resolving to an address of this machine', 'pkg.example:443',
      { lookup: resolvesTo('93.184.216.40'), local: ['93.184.216.40'] }, 'pkg.example'],
  ])('%s', async (_, target, over, host) => {
    const w = await world(over);
    expect(await send(w.socketPath, connectTo(target))).toMatchObject({ status: 403, body: `网络被拦：${host} 是本机或内网地址` });
    expect(w.log).toEqual([expect.stringMatching(/^note .* refused$/)]);
  });
});

it('NB-06 of several resolved addresses the refused one is skipped and the first allowed one is noted and dialled', async () => {
  const w = await world({ lookup: resolvesTo('10.0.0.5', '93.184.216.34') });
  expect((await send(w.socketPath, pkg)).status).toBe(200);
  expect(w.log).toEqual(['note pkg.example:443 93.184.216.34 allowed', 'dial 93.184.216.34:443']);
});

describe('rejects: NB-07 a request that does not name where to connect is 400 before any lookup (protocol: only CONNECT and http:// name a host; https goes through CONNECT)', () => {
  const longHost = [63, 63, 63, 62].map((length, index) => 'abcd'.charAt(index).repeat(length)).join('.');
  it.each<[string, string]>([
    ['① a relative path', 'GET /x HTTP/1.1\r\nHost: pkg.example\r\n\r\n'],
    ['② an https:// absolute URL', 'GET https://pkg.example/ HTTP/1.1\r\nHost: pkg.example\r\n\r\n'],
    ['③ CONNECT without a port', connectTo('pkg.example')],
    ['④ CONNECT to a host of 254 bytes', connectTo(`${longHost}:443`)],
  ])('%s', async (_, request) => {
    const w = await world();
    expect(await send(w.socketPath, request)).toMatchObject({ status: 400, body: '代理只收 CONNECT 和 http:// 的完整网址' });
    expect([w.lookups(), w.log]).toEqual([0, []]);
  });
});

it('NB-08 a name that does not resolve is 502 and is not noted', async () => {
  const w = await world({ lookup: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND nx.example'), { code: 'ENOTFOUND' }); } });
  expect(await send(w.socketPath, connectTo('nx.example:443'))).toMatchObject({ status: 502, body: '网络不通：解析不出 nx.example' });
  expect(w.log).toEqual([]);
});

it('NB-09 a connection the platform could not note is not made (safety: the record stands in for an allow list)', async () => {
  const w = await world({ failNote: true });
  expect(await send(w.socketPath, pkg)).toMatchObject({ status: 503, body: '网络暂时不可用：平台没能记下这次连接' });
  expect(w.log).toEqual([]);
});

it('NB-10 a full Host-wide connection cap answers 503 and a closed tunnel gives its slot back (safety: Host file handles)', async () => {
  const w = await world({ max: 2 });
  const first = await send(w.socketPath, pkg);
  expect([first.status, (await send(w.socketPath, pkg)).status]).toEqual([200, 200]);
  expect(await send(w.socketPath, pkg)).toMatchObject({ status: 503, body: '网络暂时不可用：平台同时开的连接已满（2）' });
  first.socket.destroy();
  await expect.poll(async () => (await send(w.socketPath, pkg)).status, { timeout: 4_000, interval: 20 }).toBe(200);
});

it('NB-11 closing a route stops its socket and cuts its open tunnels', async () => {
  const w = await world();
  const tunnel = await send(w.socketPath, pkg);
  expect(tunnel.status).toBe(200);
  const closed = once(tunnel.socket, 'close');
  await w.route.close();
  expect(w.route.source.current()).toBeNull();
  expect(existsSync(w.socketPath)).toBe(false);
  await closed;
});

it('NB-18 connections that never send a header hold Host-wide slots on every route and give them back on close (safety: Host file handles)', async () => {
  const w = await world({ max: 2 });
  const other = w.proxy.route(null);
  await other.open();
  const otherPath = other.source.current()?.socketPath ?? '';
  // Clients may hold one more than the upstream cap (2 + 1): a tunnel on the first route and two idle connections on
  // the other fill it, and one route's socket accepts in order.
  expect((await send(w.socketPath, pkg)).status).toBe(200);
  const idle = [connect(otherPath), connect(otherPath)];
  sockets.push(...idle);
  await expect(send(otherPath, pkg)).rejects.toThrow();
  idle[0]?.destroy();
  await expect.poll(async () => (await send(otherPath, pkg)).status, { timeout: 4_000, interval: 20 }).toBe(200);
});

it('NB-19 two routes of one proxy opened at the same time both listen, each on its own socket, and note into their own records', async () => {
  const w = await world();
  const logA: string[] = [];
  const logB: string[] = [];
  const [a, b] = [w.proxy.route(w.recorder(logA)), w.proxy.route(w.recorder(logB))];
  await Promise.all([a.open(), b.open()]);
  expect([a.source.current(), b.source.current()]).toEqual([{ socketPath: expect.any(String) }, { socketPath: expect.any(String) }]);
  expect((await send(a.source.current()?.socketPath ?? '', connectTo('a.example:443'))).status).toBe(200);
  expect((await send(b.source.current()?.socketPath ?? '', connectTo('b.example:443'))).status).toBe(200);
  expect([logA, logB]).toEqual([['note a.example:443 93.184.216.34 allowed'], ['note b.example:443 93.184.216.34 allowed']]);
});

it('NB-20 a chunked DELETE through an http:// absolute URL reaches the upstream with its whole body', async () => {
  const w = await world({ upstream: createHttpServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (part: Buffer) => { parts.push(part); });
    request.on('end', () => { response.end(`${String(request.method)} ${Buffer.concat(parts).toString()}`); });
  }) });
  expect(await send(w.socketPath, 'DELETE http://pkg.example/item HTTP/1.1\r\nHost: pkg.example\r\n'
    + 'Transfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n')).toMatchObject({ status: 200, body: 'DELETE hello world' });
});
