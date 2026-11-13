/**
 * NET-B (decision 121-112): the Host side of agents' command networking. The command sandbox keeps
 * `--unshare-net`, so its only way out is the per-Run unix socket this proxy listens on.
 *
 * - `commandNetworkBlocked` is the one address rule: loopback, private, link-local, reserved and this machine's own
 *   addresses are refused, every other address is the public internet and is open.
 * - `createCommandNetworkProxy` gives each Run a route: an HTTP forward proxy on its own socket that accepts
 *   `CONNECT host:port` (any port) and `http://` absolute URLs. It resolves a name once, checks every address,
 *   records the entry through the route's recorder BEFORE it connects, and connects to the checked IP, never to the
 *   name again. It holds no credential and logs no traffic; a recorder sees only host, port and address.
 * - `commandToolchainOf` mounts the Host's own node prefix (`bin`, `lib`) read-only at a fixed place, so `node` and
 *   `npm` run in the sandbox and the PATH is one constant.
 *
 * Every refusal is a safety refusal and says so in its fixed text: the platform's own pages carry this instance's
 * token, and private services and cloud metadata live on the refused ranges.
 */
import { createServer, request as forwardRequest, STATUS_CODES, type IncomingMessage, type Server,
  type ServerResponse } from 'node:http';
import { connect, isIP, type Socket } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Duplex } from 'node:stream';
import { messageOf } from '../contracts/error-message.js';
import type { RunNetworkHostV1 } from '../contracts/run-network.js';

/** Host-wide upstream connections. Safety: each tunnel holds two descriptors of the Host process. */
const COMMAND_NETWORK_MAX_OPEN = 256;

type Bits = { value: bigint; width: number };
type Range = Bits & { prefix: number };

/** An IP address as a number of its width; null for anything that is not an IP literal. A zone id is ignored. */
function bitsOf(address: string): Bits | null {
  const plain = address.replace(/%.*$/, '');
  const family = isIP(plain);
  if (family === 4) return { value: plain.split('.').reduce((sum, part) => (sum << 8n) | BigInt(part), 0n), width: 32 };
  if (family !== 6) return null;
  // A dotted IPv4 tail becomes the last two groups.
  const dotted = /\d+\.\d+\.\d+\.\d+$/.exec(plain);
  let text = plain;
  if (dotted !== null) {
    const v4 = bitsOf(dotted[0])!.value;
    text = `${plain.slice(0, dotted.index)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = rest === undefined || rest === '' ? [] : rest.split(':');
  const groups = rest === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return { value: groups.reduce((sum, group) => (sum << 16n) | BigInt(parseInt(group, 16)), 0n), width: 128 };
}

function cidrOf(cidr: string): Range {
  const [address = '', prefix = ''] = cidr.split('/');
  return { ...bitsOf(address)!, prefix: Number(prefix) };
}

function inCidr(ip: Bits, range: Range): boolean {
  if (ip.width !== range.width) return false;
  const shift = BigInt(range.width - range.prefix);
  return ip.value >> shift === range.value >> shift;
}

/** The IANA special-purpose ranges that are not globally reachable. */
const BLOCKED_RANGES: readonly Range[] = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24',
  '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
  '::/128', '::1/128', '64:ff9b:1::/48', '100::/64', '2001:db8::/32', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8',
].map(cidrOf);
/** IPv6 forms whose last 32 bits are an IPv4 address (mapped, compatible, NAT64): judged as that IPv4 address. */
const EMBEDDED_IPV4: readonly Range[] = ['::ffff:0:0/96', '::/96', '64:ff9b::/96'].map(cidrOf);

function comparable(address: string): Bits | null {
  const ip = bitsOf(address);
  return ip === null || !EMBEDDED_IPV4.some(range => inCidr(ip, range)) ? ip : { value: ip.value & 0xffff_ffffn, width: 32 };
}

/** Whether a command may not connect to this IP: a blocked range, or one of this machine's addresses (read by the
 *  caller each time, since the Host may listen on any of them). Anything that is not an IP is blocked. */
export function commandNetworkBlocked(address: string, localAddresses: readonly string[]): boolean {
  const ip = comparable(address);
  if (ip === null) return true;
  return BLOCKED_RANGES.some(range => inCidr(ip, range)) || localAddresses.some(local => {
    const own = comparable(local);
    return own !== null && own.width === ip.width && own.value === ip.value;
  });
}

/** Host-internal inputs; production uses the defaults (the system resolver, `net.connect`, the live interfaces). */
export type CommandNetworkProvider = {
  lookup?: (host: string) => Promise<readonly { address: string; family: 4 | 6 }[]>;
  dial?: (address: string, port: number) => Socket;
  localAddresses?: () => readonly string[];
  maxOpenConnections?: number;
};
/** One Run's way out: built with `current()` null, `open` before the Run starts, `close` when it ends. */
export type CommandNetworkRoute = {
  readonly source: { current(): { readonly socketPath: string } | null };
  /** Starts listening. A failure leaves `current()` null (the commands run without network) and logs one line. */
  open(): Promise<void>;
  /** Stops listening, ends this route's connections and removes its socket; repeatable. */
  close(): Promise<void>;
};
export type CommandNetworkProxy = {
  /** A null recorder records nothing (the person's own workbench commands). A recorder that rejects: the connection
   *  answers 503 and never opens. */
  route(recorder: ((entry: RunNetworkHostV1) => Promise<void>) | null): CommandNetworkRoute;
  /** Host close: closes the remaining routes and removes the socket directory. */
  close(): Promise<void>;
};

type Target = { host: string; port: number };
type Answer = { status: number; text: string };

const PROTOCOL_ONLY: Answer = { status: 400, text: '代理只收 CONNECT 和 http:// 的完整网址' };
/** Hop-by-hop headers (RFC 9110 §7.6.1) and the proxy's own; a header named in `Connection` goes too. */
const HOP_HEADERS: ReadonlySet<string> = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization',
  'proxy-authenticate', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function checkedTarget(rawHost: string, port: number): Target | null {
  const host = rawHost.toLowerCase();
  return Buffer.byteLength(host) > 253 || !Number.isSafeInteger(port) || port < 1 || port > 65_535 ? null : { host, port };
}

/** `CONNECT host:port` or `CONNECT [v6]:port`; the port is required. */
function connectTargetOf(url: string | undefined): Target | null {
  const match = /^(?:\[([^\]]+)\]|([^:[\]]+)):(\d{1,5})$/.exec(url ?? '');
  return match === null ? null : checkedTarget(match[1] ?? match[2] ?? '', Number(match[3]));
}

/** An `http://` absolute URL; port 80 when it names none. */
function absoluteTargetOf(url: string | undefined): (Target & { hostHeader: string; path: string }) | null {
  if (url === undefined || !/^http:\/\//i.test(url)) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const target = checkedTarget(parsed.hostname.replace(/^\[(.*)\]$/, '$1'), parsed.port === '' ? 80 : Number(parsed.port));
  return target === null ? null : { ...target, hostHeader: parsed.host, path: `${parsed.pathname}${parsed.search}` };
}

function endToEndHeaders(raw: readonly string[], drop: ReadonlySet<string>): string[] {
  const named = new Set(drop);
  for (let index = 0; index < raw.length; index += 2) {
    if (raw[index]!.toLowerCase() !== 'connection') continue;
    for (const token of raw[index + 1]!.split(',')) named.add(token.trim().toLowerCase());
  }
  const kept: string[] = [];
  for (let index = 0; index < raw.length; index += 2) {
    if (!named.has(raw[index]!.toLowerCase())) kept.push(raw[index]!, raw[index + 1]!);
  }
  return kept;
}

function socketAnswer(socket: Duplex, answer: Answer): void {
  socket.end(`HTTP/1.1 ${answer.status} ${STATUS_CODES[answer.status] ?? ''}\r\n`
    + `Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(answer.text)}\r\n`
    + `Connection: close\r\n\r\n${answer.text}`);
}

function responseAnswer(res: ServerResponse, answer: Answer): void {
  res.writeHead(answer.status, { 'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(answer.text), connection: 'close' }).end(answer.text);
}

function connectFailed(target: Target): Answer {
  return { status: 502, text: `网络不通：连不上 ${target.host}:${target.port}` };
}

export function createCommandNetworkProxy(input: CommandNetworkProvider & { now(): string }): CommandNetworkProxy {
  const lookup = input.lookup ?? (host => dnsLookup(host, { all: true, order: 'verbatim' })
    .then(found => found.map(entry => ({ address: entry.address, family: entry.family === 6 ? 6 as const : 4 as const }))));
  const dial = input.dial ?? ((address, port) => connect({ host: address, port }));
  const localAddresses = input.localAddresses
    ?? (() => Object.values(networkInterfaces()).flatMap(list => (list ?? []).map(entry => entry.address)));
  const maxOpen = input.maxOpenConnections ?? COMMAND_NETWORK_MAX_OPEN;
  let directory: Promise<string> | null = null;
  let sequence = 0;
  const routes = new Set<CommandNetworkRoute>();

  /** A Host-wide count up to `cap`: a slot is released once, when its connection closes; null when the Host is full. */
  function slots(cap: number): () => (() => void) | null {
    let open = 0;
    return () => {
      if (open >= cap) return null;
      open += 1;
      let held = true;
      return () => {
        if (held) { held = false; open -= 1; }
      };
    };
  }
  const takeSlot = slots(maxOpen);
  /** Client connections count from the moment they are accepted, before any header, on every route (safety: each
   *  holds a Host descriptor); one more than upstream, so a client past the upstream cap still gets the 503. */
  const takeClientSlot = slots(maxOpen + 1);

  function full(): Answer {
    return { status: 503, text: `网络暂时不可用：平台同时开的连接已满（${maxOpen}）` };
  }

  /** Resolve once, check every address, record, and return the checked IP to connect to; or the answer to send. */
  async function admit(target: Target, note: (entry: RunNetworkHostV1) => Promise<void>): Promise<{ address: string } | Answer> {
    const literal = isIP(target.host);
    let resolved: readonly { address: string; family: number }[];
    if (literal !== 0) resolved = [{ address: target.host, family: literal }];
    else {
      try { resolved = await lookup(target.host); } catch { resolved = []; }
    }
    const first = resolved[0];
    if (first === undefined) return { status: 502, text: `网络不通：解析不出 ${target.host}` };
    const local = localAddresses();
    const allowed = resolved.filter(entry => !commandNetworkBlocked(entry.address, local))
      .sort((left, right) => left.family - right.family)[0];
    const firstAt = input.now();
    if (allowed === undefined) {
      // A refusal that cannot be recorded is still a refusal: nothing went out.
      await note({ host: target.host, port: target.port, address: first.address, verdict: 'refused', firstAt })
        .catch(() => undefined);
      return { status: 403, text: `网络被拦：${target.host} 是本机或内网地址` };
    }
    try {
      await note({ host: target.host, port: target.port, address: allowed.address, verdict: 'allowed', firstAt });
    } catch {
      // Safety: the record replaces an allow-list (decision 121-112), so an unrecorded connection never opens.
      return { status: 503, text: '网络暂时不可用：平台没能记下这次连接' };
    }
    return { address: allowed.address };
  }

  return {
    route(recorder) {
      const written = new Map<string, Promise<void>>();
      let queue: Promise<void> = Promise.resolve();
      /** One write per (host, port, verdict) on this route, one at a time: the record's version guard refuses a write
       *  racing another. Callers at the same time share a write; a failure is retried. */
      const note = (entry: RunNetworkHostV1): Promise<void> => {
        if (recorder === null) return Promise.resolve();
        const key = `${entry.host} ${entry.port} ${entry.verdict}`;
        let write = written.get(key);
        if (write === undefined) {
          write = queue.then(() => recorder(entry));
          queue = write.catch(() => undefined);
          written.set(key, write);
          write.catch(() => written.delete(key));
        }
        return write;
      };
      const sockets = new Set<Socket>();
      const track = (socket: Socket): void => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
      };

      async function onConnect(req: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
        client.on('error', () => client.destroy());
        const target = connectTargetOf(req.url);
        if (target === null) return socketAnswer(client, PROTOCOL_ONLY);
        const release = takeSlot();
        if (release === null) return socketAnswer(client, full());
        client.once('close', release);
        const admitted = await admit(target, note);
        if ('status' in admitted) {
          release();
          return socketAnswer(client, admitted);
        }
        if (client.destroyed) return release();
        const upstream = dial(admitted.address, target.port);
        track(upstream);
        upstream.once('close', release);
        let opened = false;
        upstream.on('error', () => (opened ? client.destroy() : socketAnswer(client, connectFailed(target))));
        client.once('close', () => upstream.destroy());
        upstream.once('connect', () => {
          opened = true;
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length > 0) upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
        });
      }

      async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const target = absoluteTargetOf(req.url);
        if (target === null) return responseAnswer(res, PROTOCOL_ONLY);
        const release = takeSlot();
        if (release === null) return responseAnswer(res, full());
        res.once('close', release);
        const admitted = await admit(target, note);
        if ('status' in admitted) {
          release();
          return responseAnswer(res, admitted);
        }
        if (req.socket.destroyed) return release();
        const headers = endToEndHeaders(req.rawHeaders, new Set([...HOP_HEADERS, 'host']));
        // The incoming chunking is decoded here and Node chunks no DELETE or GET body by itself: frame it again.
        if (req.headers['transfer-encoding'] !== undefined) headers.push('Transfer-Encoding', 'chunked');
        const upstream = forwardRequest({
          method: req.method, path: target.path, headers: [...headers, 'Host', target.hostHeader],
          createConnection: () => {
            const socket = dial(admitted.address, target.port);
            track(socket);
            socket.once('close', release);
            return socket;
          },
        });
        upstream.once('response', answer => {
          answer.on('error', () => res.destroy());
          res.writeHead(answer.statusCode ?? 502, answer.statusMessage, endToEndHeaders(answer.rawHeaders, HOP_HEADERS));
          answer.pipe(res);
        });
        upstream.on('error', () => (res.headersSent ? res.destroy() : responseAnswer(res, connectFailed(target))));
        req.on('error', () => upstream.destroy());
        res.once('close', () => upstream.destroy());
        req.pipe(upstream);
      }

      let server: Server | null = null;
      let current: { readonly socketPath: string } | null = null;
      let closed = false;
      const route: CommandNetworkRoute = {
        source: { current: () => current },
        async open() {
          if (closed || server !== null) return;
          // A route joins the proxy's set when it opens: one that never opens holds nothing to close.
          routes.add(route);
          try {
            directory ??= mkdtemp(join(tmpdir(), 'agent-net-'));
            // The name is taken before the await: routes opened at the same time each get their own socket.
            const routeId = ++sequence;
            const socketPath = join(await directory, `${routeId}.sock`);
            const listening = createServer();
            listening.on('connection', (socket: Socket) => {
              const release = takeClientSlot();
              if (release === null) { socket.destroy(); return; }
              track(socket);
              socket.once('close', release);
            });
            listening.on('connect', (req, client, head) => void onConnect(req, client, head));
            listening.on('request', (req, res) => void onRequest(req, res));
            await new Promise<void>((resolve, reject) => {
              listening.once('error', reject);
              listening.listen(socketPath, () => resolve());
            });
            server = listening;
            current = Object.freeze({ socketPath });
          } catch (error) {
            process.stderr.write(`[platform] the command network proxy did not start, so this Run's commands have no network: ${messageOf(error)}\n`);
          }
        },
        async close() {
          closed = true;
          routes.delete(route);
          const listening = server;
          const socketPath = current?.socketPath ?? null;
          server = null;
          current = null;
          for (const socket of sockets) socket.destroy();
          if (listening === null || socketPath === null) return;
          await new Promise<void>(resolve => listening.close(() => resolve()));
          await rm(socketPath, { force: true });
        },
      };
      return route;
    },
    async close() {
      await Promise.all([...routes].map(route => route.close()));
      const created = directory;
      directory = null;
      // A directory that was never created has nothing to remove.
      if (created !== null) await created.then(path => rm(path, { recursive: true, force: true }), () => undefined);
    },
  };
}

/** The command PATH: the Host's toolchain first, so npm's `#!/usr/bin/env node` finds the node it was installed with. */
export const COMMAND_TOOLCHAIN_PATH = '/opt/agent-toolchain/bin:/usr/bin:/bin';

/**
 * The Host's own node prefix (two levels above the real `execPath`), `bin` and `lib` only, read-only at
 * `/opt/agent-toolchain/{bin,lib}`; a missing one is not mounted. `<prefix>/etc` is never mounted: a global npmrc
 * there may hold a token.
 */
export async function commandToolchainOf(execPath: string): Promise<{
  hostMounts: { readonly source: string; readonly target: string; readonly writable: false }[];
  executablePath: typeof COMMAND_TOOLCHAIN_PATH;
}> {
  const prefix = dirname(dirname(await realpath(execPath)));
  const hostMounts: { readonly source: string; readonly target: string; readonly writable: false }[] = [];
  for (const name of ['bin', 'lib']) {
    const source = join(prefix, name);
    if (await stat(source).then(entry => entry.isDirectory(), () => false)) {
      hostMounts.push({ source, target: `/opt/agent-toolchain/${name}`, writable: false });
    }
  }
  return { hostMounts, executablePath: COMMAND_TOOLCHAIN_PATH };
}
