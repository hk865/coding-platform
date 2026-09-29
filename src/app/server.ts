/**
 * R6.1a HTTP/static shell for the local workbench.
 *
 * The server owns ONLY transport concerns: it binds the fixed local Host and
 * same-origin boundary, checks the temporary instance token, enforces the JSON
 * and request-size boundary, derives a real `AbortSignal` from the socket, and
 * forwards the parsed payload to `core-routes.ts`. It never touches the
 * RecordStore or a domain service directly.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { CoreRouteSuffix } from './core-http-types.js';
import {
  BOOTSTRAP_SUFFIX,
  CORE_API_PREFIX,
  type CoreScope,
  PLATFORM_TOKEN_HEADER,
  PLATFORM_TOKEN_META_NAME,
  PLATFORM_TOKEN_PLACEHOLDER,
  WORKBENCH_PATH,
  type BootstrapResponse,
} from './core-http-types.js';
import { SETTINGS_API_PREFIX, type HostSettingsPort } from './host-settings-types.js';
import { isSettingsRoute } from './host-settings.js';
import type { HostActor } from './core-call-context.js';
import { createHostCoreCallContext } from './core-call-context.js';
import {
  CORE_ROUTE_SPECS,
  CoreRouteRejectionError,
  CoreUnsupportedError,
  dispatchCoreRoute,
  parseCoreRouteRequest,
  type CoreRouteBindings,
} from './core-routes.js';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** The only static asset names the workbench publishes. A path outside this
 * closed set is a 404, so no directory traversal is expressible. */
const STATIC_CONTENT_TYPES: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'main.js': 'text/javascript; charset=utf-8',
  'views.js': 'text/javascript; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8',
};

export type WorkbenchAddress = { host: string; port: number; url: string };

export type WorkbenchServerOptions = {
  /** One random per-Host-instance temporary bearer token. */
  token: string;
  bindings: CoreRouteBindings;
  actor: HostActor;
  /** Trusted LIVE projection; never built by scanning the ledger. It is a
   * function so a newly opened scope is visible without restarting the Host. */
  bootstrap: () => BootstrapResponse;
  /** Trusted Host-local settings port. Absence keeps every settings route an
   * explicit `unsupported` gap; the transport boundary is unchanged. */
  settings?: HostSettingsPort;
  /** The live trusted scope predicate; a request scope outside it is forbidden. */
  allowsScope: (scope: CoreScope) => boolean;
  host?: string;
  publicDir?: string;
  maxBodyBytes?: number;
};

export type WorkbenchServer = {
  listen(port?: number): Promise<WorkbenchAddress>;
  close(): Promise<void>;
  readonly address: WorkbenchAddress | null;
};

class BodyTooLargeError extends Error {}
class BodyParseError extends Error {}

const defaultPublicDir = (): string => fileURLToPath(new URL('./public/workbench/', import.meta.url));

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, contentType: string, body: string, cache: string): void {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': cache,
  });
  response.end(body);
}

/** `Host` must address the exact loopback boundary this instance listens on. */
function hostHeaderMatches(hostHeader: string | undefined, host: string, port: number): boolean {
  if (!hostHeader) return false;
  let parsed: URL;
  try { parsed = new URL(`http://${hostHeader}`); } catch { return false; }
  const name = parsed.hostname;
  const loopback = name === host || name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '::1';
  if (!loopback) return false;
  return parsed.port === String(port);
}

/** A present `Origin` must be same-origin; the page never enables cross-origin reads. */
function originAllowed(origin: string | undefined, host: string, port: number): boolean {
  if (origin === undefined) return true;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  return parsed.protocol === 'http:' && hostHeaderMatches(parsed.host, host, port);
}

function statusForCode(code: string): number {
  switch (code) {
    case 'invalid': return 400;
    case 'forbidden': return 403;
    case 'not_found': return 404;
    case 'revision_conflict':
    case 'idempotency_conflict':
    case 'dependency_blocked':
    case 'cycle':
    case 'busy':
    case 'source_stale':
    case 'incomplete': return 409;
    case 'capacity': return 429;
    case 'unsupported': return 501;
    case 'unavailable': return 503;
    case 'cancelled': return 408;
    default: return 400;
  }
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  return await new Promise<unknown>((resolvePromise, reject) => {
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new BodyTooLargeError('request body exceeds the Host limit')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolvePromise(JSON.parse(text)); } catch { reject(new BodyParseError('request body is not valid JSON')); }
    });
    request.on('error', reject);
  });
}

export function createWorkbenchServer(options: WorkbenchServerOptions): WorkbenchServer {
  const host = options.host ?? '127.0.0.1';
  const publicDir = options.publicDir ?? defaultPublicDir();
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const inFlight = new Set<Promise<void>>();
  let boundPort = 0;
  let closing: Promise<void> | undefined;

  async function serveIndex(response: ServerResponse): Promise<void> {
    let html: string;
    try { html = await readFile(`${publicDir}/index.html`, 'utf8'); }
    catch { sendJson(response, 503, { status: 'rejected', code: 'unavailable', reason: 'workbench static build is missing' }); return; }
    const withToken = html.split(PLATFORM_TOKEN_PLACEHOLDER).join(options.token);
    sendText(response, 200, STATIC_CONTENT_TYPES['index.html']!, withToken, 'no-store');
  }

  async function serveStatic(name: string, response: ServerResponse): Promise<void> {
    const contentType = STATIC_CONTENT_TYPES[name];
    if (contentType === undefined || name === 'index.html') { sendJson(response, 404, { status: 'rejected', code: 'not_found', reason: 'unknown workbench asset' }); return; }
    try {
      const body = await readFile(`${publicDir}/${name}`);
      sendText(response, 200, contentType, body.toString('utf8'), 'no-cache');
    } catch {
      sendJson(response, 404, { status: 'rejected', code: 'not_found', reason: 'workbench asset is missing' });
    }
  }

  function handleToken(request: IncomingMessage): boolean {
    return request.headers[PLATFORM_TOKEN_HEADER] === options.token;
  }

  async function handleCore(suffix: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (!(suffix in CORE_ROUTE_SPECS)) return false;
    if (!handleToken(request)) { sendJson(response, 403, { status: 'rejected', code: 'forbidden', reason: 'the local platform token is missing or stale' }); return true; }
    const controller = new AbortController();
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    request.setTimeout(120_000, () => controller.abort());
    let raw: unknown;
    try { raw = await readJsonBody(request, maxBodyBytes); }
    catch (error) {
      if (error instanceof BodyTooLargeError) sendJson(response, 413, { status: 'rejected', code: 'capacity', reason: error.message });
      else sendJson(response, 400, { status: 'rejected', code: 'invalid', reason: error instanceof Error ? error.message : 'invalid request body' });
      return true;
    }
    if (controller.signal.aborted) { sendJson(response, 408, { status: 'rejected', code: 'cancelled', reason: 'the client cancelled the request' }); return true; }
    const parsed = parseCoreRouteRequest(suffix as CoreRouteSuffix, raw);
    try {
      if (!parsed.ok) throw new CoreRouteRejectionError(parsed.rejection);
      if (!options.allowsScope(parsed.scope)) {
        throw new CoreRouteRejectionError({
          status: 'rejected', code: 'forbidden',
          reason: 'the requested scope is not part of the trusted Host configuration',
        });
      }
      const ctx = createHostCoreCallContext({ scope: parsed.scope, actor: options.actor, signal: controller.signal });
      const result = await dispatchCoreRoute(options.bindings, suffix as CoreRouteSuffix, ctx, parsed);
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof CoreUnsupportedError) sendJson(response, statusForCode('unsupported'), error.rejection);
      else if (error instanceof CoreRouteRejectionError) sendJson(response, statusForCode(error.rejection.code), error.rejection);
      else sendJson(response, 500, { status: 'rejected', code: 'unavailable', reason: 'the Host failed to execute the route' });
    }
    return true;
  }

  /**
   * Every settings suffix is POST with the corresponding DTO input as the JSON
   * body. The transport keeps the same token/same-origin boundary as the core
   * routes and never lets a settings request reach a domain owner directly: an
   * absent port is an explicit `unsupported` gap and a port failure is a bounded
   * `unavailable` response.
   */
  async function handleSettings(suffix: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (!isSettingsRoute(suffix)) return false;
    if (!handleToken(request)) { sendJson(response, 403, { status: 'rejected', code: 'forbidden', reason: 'the local platform token is missing or stale' }); return true; }
    const controller = new AbortController();
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    request.setTimeout(120_000, () => controller.abort());
    let raw: unknown;
    try { raw = await readJsonBody(request, maxBodyBytes); }
    catch (error) {
      if (error instanceof BodyTooLargeError) sendJson(response, 413, { status: 'rejected', code: 'capacity', reason: error.message });
      else sendJson(response, 400, { status: 'rejected', code: 'invalid', reason: error instanceof Error ? error.message : 'invalid request body' });
      return true;
    }
    if (controller.signal.aborted) { sendJson(response, 408, { status: 'rejected', code: 'cancelled', reason: 'the client cancelled the request' }); return true; }
    if (options.settings === undefined) {
      sendJson(response, statusForCode('unsupported'), { status: 'rejected', code: 'unsupported', reason: 'the Host has no settings configuration' });
      return true;
    }
    try {
      const result = await options.settings.call(suffix, raw as never);
      if (result.status === 'ready') sendJson(response, 200, result);
      else sendJson(response, statusForCode(result.code), result);
    } catch {
      sendJson(response, 500, { status: 'rejected', code: 'unavailable', reason: 'the Host failed to execute the settings route' });
    }
    return true;
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (closing !== undefined) { sendJson(response, 503, { status: 'rejected', code: 'unavailable', reason: 'the workbench Host is closing' }); return; }
    if (!hostHeaderMatches(request.headers.host, host, boundPort)) {
      sendJson(response, 403, { status: 'rejected', code: 'forbidden', reason: 'the request Host does not match this workbench listener' });
      return;
    }
    if (!originAllowed(request.headers.origin, host, boundPort)) {
      sendJson(response, 403, { status: 'rejected', code: 'forbidden', reason: 'cross-origin workbench reads are not enabled' });
      return;
    }
    const url = new URL(request.url ?? '/', `http://${host}:${boundPort}`);
    const pathname = url.pathname;
    const method = request.method ?? 'GET';
    if (pathname === '/workbench' || pathname === WORKBENCH_PATH) {
      if (method !== 'GET' && method !== 'HEAD') { sendJson(response, 405, { status: 'rejected', code: 'invalid', reason: 'use GET for the workbench page' }); return; }
      await serveIndex(response);
      return;
    }
    if (pathname.startsWith(WORKBENCH_PATH)) {
      const asset = pathname.slice(WORKBENCH_PATH.length);
      if (asset.length === 0 || asset.includes('/')) { sendJson(response, 404, { status: 'rejected', code: 'not_found', reason: 'unknown workbench asset' }); return; }
      if (method !== 'GET' && method !== 'HEAD') { sendJson(response, 405, { status: 'rejected', code: 'invalid', reason: 'use GET for static assets' }); return; }
      await serveStatic(asset, response);
      return;
    }
    if (pathname === `${CORE_API_PREFIX}${BOOTSTRAP_SUFFIX}`) {
      if (method !== 'GET') { sendJson(response, 405, { status: 'rejected', code: 'invalid', reason: 'use GET for bootstrap' }); return; }
      if (!handleToken(request)) { sendJson(response, 403, { status: 'rejected', code: 'forbidden', reason: 'the local platform token is missing or stale' }); return; }
      sendJson(response, 200, options.bootstrap());
      return;
    }
    if (pathname.startsWith(SETTINGS_API_PREFIX)) {
      if (method !== 'POST') { sendJson(response, 405, { status: 'rejected', code: 'invalid', reason: 'use POST for settings routes' }); return; }
      const suffix = pathname.slice(SETTINGS_API_PREFIX.length);
      if (await handleSettings(suffix, request, response)) return;
      sendJson(response, 404, { status: 'rejected', code: 'not_found', reason: `unpublished settings route ${suffix}` });
      return;
    }
    if (pathname.startsWith(CORE_API_PREFIX)) {
      if (method !== 'POST') { sendJson(response, 405, { status: 'rejected', code: 'invalid', reason: 'use POST for core routes' }); return; }
      const suffix = pathname.slice(CORE_API_PREFIX.length);
      if (await handleCore(suffix, request, response)) return;
      sendJson(response, 404, { status: 'rejected', code: 'not_found', reason: `unpublished core route ${suffix}` });
      return;
    }
    sendJson(response, 404, { status: 'rejected', code: 'not_found', reason: 'unknown workbench path' });
  }

  const server: Server = createServer((request, response) => {
    const run = handle(request, response).catch(() => {
      if (!response.writableEnded) sendJson(response, 500, { status: 'rejected', code: 'unavailable', reason: 'the Host failed to handle the request' });
    }).finally(() => { inFlight.delete(run); });
    inFlight.add(run);
  });
  let bound: WorkbenchAddress | null = null;

  return {
    get address(): WorkbenchAddress | null { return bound; },
    listen(port = 0): Promise<WorkbenchAddress> {
      return new Promise<WorkbenchAddress>((resolvePromise, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.removeListener('error', onError);
          const address = server.address();
          boundPort = typeof address === 'object' && address !== null ? address.port : port;
          bound = { host, port: boundPort, url: `http://${host}:${boundPort}${WORKBENCH_PATH}` };
          resolvePromise(bound);
        });
      });
    },
    close(): Promise<void> {
      closing ??= (async () => {
        await new Promise<void>((resolvePromise) => {
          server.close(() => resolvePromise());
          server.closeIdleConnections?.();
        });
        await Promise.allSettled([...inFlight]);
      })();
      return closing;
    },
  };
}
