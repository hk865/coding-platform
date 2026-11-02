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

/** Ruling item 4: the token comes from `<meta name="platform-token" content>`.
 * A missing or empty content is `null`, never an empty token header. */
export function readPlatformToken(source: { querySelector(selector: string): Element | null }): string | null {
  const content = source.querySelector(`meta[name="${PLATFORM_TOKEN_META_NAME}"]`)?.getAttribute('content') ?? null;
  return content === '' ? null : content;
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

/** Ruling items 5 and 6: `bootstrap` is where the UI learns the workspace scope;
 * `post` is the plain route shape, with `scope` supplied by the caller. `base` is
 * empty in the browser (same-origin relative); Node tests pass a Host origin
 * without a trailing slash because a Node `fetch` refuses a relative URL. */
export function createHostClient(token: string, base = ''): {
  post(route: string, scope: CoreScope, input: unknown): Promise<RouteReply>;
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
    bootstrap(): Promise<BootstrapReply> {
      return request<BootstrapReply>(`${base}${CORE_API_PREFIX}bootstrap`, {
        method: 'GET',
        headers: { [PLATFORM_TOKEN_HEADER]: token },
      }, 'bootstrap');
    },
  };
}
