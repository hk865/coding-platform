/**
 * The browser side of the local Host boundary (E3-2 ruling item 3): the only
 * UI module that calls `fetch`. It is the same-origin relative route
 * `POST /api/real/core/<route>` with `{scope, input}` and the header token
 * (item 5); the token never enters a URL, a log or the build (item 4). It does
 * not read `document`: `boot` hands the token in from `readPlatformToken`.
 *
 * The Ui module has no dependency on `src/app` (module target `Ui`), so the URL
 * prefix, header name, meta name and reply shapes are literal here.
 */

export const PLATFORM_TOKEN_META_NAME = 'platform-token';

export type CoreScope = { projectId: string; workspaceId: string };

/** Structural reply the route adapter reads; a rejection carries `code`/`reason`. */
export type RouteReply = { status: string; value?: unknown; code?: string; reason?: string };

export type BootstrapReply = {
  workspaces: Array<{
    scope: CoreScope;
    name: string;
    workspaceRevision: number;
    writeAllowed?: boolean;
    commandsAllowed?: boolean;
  }>;
  review: unknown;
  execution: unknown;
  changesHead?: string | null;
};

const CORE_API_PREFIX = '/api/real/core/';
const PLATFORM_TOKEN_HEADER = 'x-platform-token';
const CHANGES_SUFFIX = 'changes';
const LAST_EVENT_ID_HEADER = 'last-event-id';

/** Ruling item 4: the token comes from `<meta name="platform-token" content>`.
 * A missing or empty content is `null`, never an empty token header. */
export function readPlatformToken(source: { querySelector(selector: string): Element | null }): string | null {
  const content = source.querySelector(`meta[name="${PLATFORM_TOKEN_META_NAME}"]`)?.getAttribute('content') ?? null;
  return content === '' ? null : content;
}

/** A restarted Host serves a new token, so a reconnecting page reads it from
 * the page text it fetches again. The same meta name as the document
 * read above; a missing or empty content is `null`, never an empty header. */
export function readPlatformTokenText(pageText: string): string | null {
  for (const match of pageText.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = /\bname\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (name !== PLATFORM_TOKEN_META_NAME) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? null;
    return content === '' ? null : content;
  }
  return null;
}

/** A failed read call, carrying the route and the reply's code (or its status)
 * and reason so `boot` can log the raw facts and map the code to page text. */
export class RouteReadError extends Error {
  constructor(readonly route: string, readonly code: string, readonly reason: string) {
    super(`${route} failed: ${code}${reason === '' ? '' : `: ${reason}`}`);
    this.name = 'RouteReadError';
  }
}

/** Ruling item 5: HTTP status and the body `status` are both checked; a failure
 * is a `RouteReadError` so a rejected `unavailable` reply reaches the page-code
 * table too. A reply is returned only when both checks pass. */
async function request<T>(url: string, init: RequestInit, route: string): Promise<T> {
  const response = await fetch(url, init);
  const reply = await response.json() as RouteReply;
  if (!response.ok || reply.status === 'rejected') {
    const code = reply.code ?? `http-${response.status}`;
    throw new RouteReadError(route, code, reply.reason ?? 'the Host rejected the request');
  }
  return reply as T;
}

/** Ruling item 7: the one place the UI fetches a page's own source text. */
export async function fetchPageText(url: string): Promise<string> {
  return await (await fetch(url)).text();
}

/** Ruling item 1: a read reply is usable only at `status: 'ready'`. The message
 * names the route and carries the reply's code/status and `reason`, never the
 * string `undefined`. Writes keep their own result path. */
export function readyRouteValue<T>(reply: RouteReply, route: string): T {
  if (reply.status !== 'ready') {
    const code = reply.code || reply.status || 'no status';
    throw new RouteReadError(route, code, reply.reason ?? '');
  }
  return reply.value as T;
}

/** Ruling item 7: a graph write carries `{scope, request:{input, meta}}`; the
 * plain `{scope, input}` envelope is rejected by the route parser. The pin is
 * the real registration read, never a guessed revision 1. */
export type GraphWriteRequest = {
  input: unknown;
  meta: { requestId: string; expected: readonly { ref: unknown; revision: number }[] };
};

/** Ruling item 7: a write is successful only at `status: 'committed'`; the
 * read-side `readyRouteValue` would call a rejection a success. */
export function committedRouteValue<T>(reply: RouteReply, route: string): T {
  if (reply.status !== 'committed') {
    const code = reply.code || reply.status || 'no status';
    throw new RouteReadError(route, code, reply.reason ?? '');
  }
  return reply.value as T;
}

/** Ruling items 5 and 6: `bootstrap` is where the UI learns the workspace scope;
 * `post` is the plain route shape, with `scope` supplied by the caller. `base` is
 * empty in the browser (same-origin relative); Node tests pass a Host origin
 * without a trailing slash because a Node `fetch` refuses a relative URL. */
export function createHostClient(token: string, base = ''): {
  post(route: string, scope: CoreScope, input: unknown): Promise<RouteReply>;
  write(route: string, scope: CoreScope, request: GraphWriteRequest): Promise<RouteReply>;
  bootstrap(): Promise<BootstrapReply>;
} {
  return {
    post(route: string, scope: CoreScope, input: unknown): Promise<RouteReply> {
      return request<RouteReply>(`${base}${CORE_API_PREFIX}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
        body: JSON.stringify({ scope, input }),
      }, route);
    },
    write(route: string, scope: CoreScope, writeRequest: GraphWriteRequest): Promise<RouteReply> {
      return request<RouteReply>(`${base}${CORE_API_PREFIX}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
        body: JSON.stringify({ scope, request: writeRequest }),
      }, route);
    },
    bootstrap(): Promise<BootstrapReply> {
      return request<BootstrapReply>(`${base}${CORE_API_PREFIX}bootstrap`, {
        method: 'GET',
        headers: { [PLATFORM_TOKEN_HEADER]: token },
      }, 'bootstrap');
    },
  };
}

/** Ruling item 1: the change stream is notifications only. `ready` opens a
 * connection; `change` and `reset` both mean "reread what the page shows". */
export type ChangeStreamHandlers = {
  onOpen(): void;
  onNotice(): void;
  /** This connection ended: Host close, a rejected request or a stream error. */
  onEnd(): void;
};

/** One page's change-stream client. The cursor survives a reconnect, so a
 * later `connect()` asks the Host to replay from the last SSE `id` it saw. */
export type ChangeStream = {
  connect(): void;
};

type ChangeFrame = { name: string; id: string | null };

/** The `event` and `id` fields of one SSE block; heartbeats and field values
 * this stream never needs are ignored. `server.ts` writes `\n\n` blocks. */
function parseChangeFrame(block: string): ChangeFrame | null {
  let name = '';
  let id: string | null = null;
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const raw = colon < 0 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') name = value;
    else if (field === 'id') id = value;
  }
  return name === '' ? null : { name, id };
}

/**
 * Ruling item 1: `GET /api/real/core/changes` read with `fetch`, because
 * `EventSource` cannot carry the `x-platform-token` header. The URL stays
 * token-free; `cursor` is the bootstrap `changesHead` the first connect resumes
 * from, and every reconnect carries the last SSE `id` exactly as `server.ts`
 * reads `Last-Event-ID`. `tokenOf` is read on every connect, so a reconnecting
 * page can pick up the token a restarted Host serves. The stream ends when the
 * Host ends the response or the read fails; a 2xx response opens the connection
 * before any frame, and the `ready` frame only carries the event id.
 */
export function subscribeChanges(
  tokenOf: () => Promise<string>, handlers: ChangeStreamHandlers, cursor: string | null, base = '',
): ChangeStream {
  let lastEventId = cursor;

  function send(frame: ChangeFrame): void {
    if (frame.id !== null) lastEventId = frame.id;
    if (frame.name === 'change' || frame.name === 'reset') handlers.onNotice();
  }

  async function pumpChanges(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true });
      for (let at = buffer.indexOf('\n\n'); at >= 0; at = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const frame = parseChangeFrame(block);
        if (frame !== null) send(frame);
      }
    }
  }

  return {
    connect(): void {
      void (async () => {
        try {
          const token = await tokenOf();
          const headers: Record<string, string> = { [PLATFORM_TOKEN_HEADER]: token };
          if (lastEventId !== null) headers[LAST_EVENT_ID_HEADER] = lastEventId;
          const response = await fetch(`${base}${CORE_API_PREFIX}${CHANGES_SUFFIX}`, {
            method: 'GET', headers,
          });
          if (response.ok && response.body !== null) {
            handlers.onOpen();
            await pumpChanges(response.body);
          }
        } catch {
          // A read error is the same page condition as the Host closing.
        } finally {
          handlers.onEnd();
        }
      })();
    },
  };
}
