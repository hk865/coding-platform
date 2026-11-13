/**
 * NET-B builder row (netb-start-rulings §6 list B item 4: a route writes its Run's host record one entry at a time,
 * because the RunNetwork owner's version guard refuses a write racing another, and an unrecorded connection answers
 * 503). Two CONNECTs to different hosts reach one route together; the recorder holds the first write on a gate and
 * counts the writes in flight (A3); `lookup` is counted, so both requests are known to be past it before the gate
 * opens. Mutation: notes not queued (the second write starts while the first is held: two in flight).
 */
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { createCommandNetworkProxy, type CommandNetworkProxy } from '../../src/app/command-sandbox.js';

const proxies: CommandNetworkProxy[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const proxy of proxies.splice(0)) await proxy.close();
  for (const server of servers.splice(0)) server.close();
});

/** The status code of the proxy's answer to one raw request on the route's socket. */
function statusOf(socketPath: string, request: string): Promise<number> {
  const socket = connect(socketPath);
  sockets.push(socket);
  let data = '';
  return new Promise((resolve, reject) => {
    socket.on('data', chunk => {
      data += chunk.toString('latin1');
      if (data.includes('\r\n\r\n')) resolve(Number(data.split(' ')[1]));
    });
    socket.on('close', () => reject(new Error(`no answer: ${data}`)));
    socket.write(request);
  });
}

it('NB-impl-1 two hosts reached at once on one route are written one after the other, and both open', async () => {
  const upstream = createServer(socket => { socket.pipe(socket); });
  servers.push(upstream);
  await new Promise<void>(resolve => { upstream.listen(0, '127.0.0.1', resolve); });
  let lookups = 0;
  let inFlight = 0;
  let most = 0;
  let release = (): void => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const proxy = createCommandNetworkProxy({
    lookup: async () => { lookups += 1; return [{ address: '93.184.216.34', family: 4 }]; },
    dial: () => connect((upstream.address() as AddressInfo).port, '127.0.0.1'),
    localAddresses: () => [],
    now: () => '2026-11-13T02:00:00.000Z',
  });
  proxies.push(proxy);
  let writes = 0;
  const route = proxy.route(async () => {
    writes += 1;
    inFlight += 1;
    most = Math.max(most, inFlight);
    if (writes === 1) await gate;
    inFlight -= 1;
  });
  await route.open();
  const socketPath = route.source.current()?.socketPath;
  if (socketPath === undefined) throw new Error('an opened route must have a socket');
  const answers = ['a.example', 'b.example'].map(host =>
    statusOf(socketPath, `CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`));
  await expect.poll(() => lookups, { timeout: 10_000, interval: 10 }).toBe(2);
  release();
  expect(await Promise.all(answers)).toEqual([200, 200]);
  expect({ writes, most }).toEqual({ writes: 2, most: 1 });
});
