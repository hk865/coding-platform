/// <reference lib="dom" />
/**
 * Change-stream client (task E). It reads `GET /api/real/core/changes` with
 * fetch() + ReadableStream, so the page keeps sending its token as the
 * `x-platform-token` header (EventSource cannot) and the token never enters a
 * URL. The stream carries change notices only; every resource is still read
 * through its ordinary POST route, scheduled by `refresh.ts`.
 *
 *   mode        delivery  meaning
 *   connecting  timers    an attempt is open but no event has arrived yet
 *   live        notices   an event arrived on this connection
 *   fallback    timers    the attempt failed; reconnect after 1, 2, 4, 8, then every 15 s
 *   paused      off       the page is hidden: stream aborted, nothing runs
 *   closed      timers    HTTP 401/403/404/405/501: the old polling, no reconnect
 *
 * Any failure (network, other HTTP status, not an event stream, stream end or
 * read error, no event within 10 s, no byte within 45 s = three heartbeats)
 * enters `fallback`. Every `ready` runs each read loop once (a reconnect may
 * have missed handle notices, which carry no id); a `reset`, or a `ready`
 * without a resume point after a pause or failure, also runs the watches. So
 * does the page's first `ready` when its head is newer than the head the
 * bootstrap reported (`loadedAt`): a commit landed while the page loaded, and
 * its first reads may have been served before the stream subscribed. A
 * visible page reconnects at once with `Last-Event-ID`.
 */
import type { ChangeNotice } from '../../app/core-http-types.js';
import { token as pageToken } from './auth.js';
import { UI_CHANGES_SUFFIX, UI_CORE_API_PREFIX, UI_LAST_EVENT_ID_HEADER, UI_PLATFORM_TOKEN_HEADER } from './protocol.js';
import { refreshHub } from './refresh.js';
import type { DeliveryMode, RefreshHub } from './refresh.js';
import { createSseParser, readSse } from './sse.js';
import type { SseMessage } from './sse.js';

export type ConnectionMode = 'connecting' | 'live' | 'fallback' | 'paused' | 'closed';

/** `cursor` is the last commit cursor seen (the resume point); `attempt`
 * counts failures since the stream was last live; `reason` names the last one. */
export type ConnectionStatus = { mode: ConnectionMode; cursor: string | null; attempt: number; reason: string | null };

export const initialConnectionStatus = (): ConnectionStatus => ({ mode: 'connecting', cursor: null, attempt: 0, reason: null });

export type PageVisibility = { hidden(): boolean; listen(onChange: () => void): () => void };

export type LiveDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  token: string;
  visibility: PageVisibility;
  delivery: Pick<RefreshHub, 'setDelivery' | 'deliverNotice' | 'catchUp'>;
  onStatus: (status: ConnectionStatus) => void;
  /** `BootstrapResponse.changesHead`: the commit cursor the page's first reads
   * are at least as new as (null = empty ledger). Undefined = unknown: the
   * first `ready` then runs no watch. */
  loadedAt?: string | null;
  readyTimeoutMs?: number;
  silenceTimeoutMs?: number;
  backoffMs?: readonly number[];
};

export type LiveConnection = { status(): ConnectionStatus; stop(): void };

const READY_TIMEOUT_MS = 10_000;
const SILENCE_TIMEOUT_MS = 45_000;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
/** The Host will not serve this page a stream (stale token, no route, no feed). */
const CLOSING_STATUSES = new Set([401, 403, 404, 405, 501]);
const DELIVERY: Record<ConnectionMode, DeliveryMode> = {
  connecting: 'timers', live: 'notices', fallback: 'timers', paused: 'off', closed: 'timers',
};

function parseData(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function asNotice(data: Record<string, unknown> | null): ChangeNotice | null {
  if (data === null || !Array.isArray(data.kinds) || !Array.isArray(data.projects)) return null;
  return data as ChangeNotice;
}

const COMMIT_CURSOR = /^c(\d+)$/;

/** Whether commit cursor `cursor` is newer than `than` (null = empty ledger).
 * An unreadable `than` counts as older, so the doubt costs one re-read. */
export function commitNewer(cursor: string | null, than: string | null): boolean {
  const seq = cursor === null ? null : COMMIT_CURSOR.exec(cursor);
  if (seq === null) return false;
  const base = than === null ? null : COMMIT_CURSOR.exec(than);
  return base === null || Number(seq[1]) > Number(base[1]);
}

export function createLiveConnection(deps: LiveDeps): LiveConnection {
  const readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const silenceTimeoutMs = deps.silenceTimeoutMs ?? SILENCE_TIMEOUT_MS;
  const backoff = deps.backoffMs ?? BACKOFF_MS;
  let status = initialConnectionStatus();
  let lastEventId: string | null = null;
  /** Identity of the current attempt; any callback of an older one is ignored. */
  let generation = 0;
  let controller: AbortController | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closedReason: string | null = null;
  let stopped = false;
  /** Set by the first pause or failure: notices may have been missed since. */
  let interrupted = false;
  /** The bootstrap's head; compared once, at the first `ready`/`reset`. */
  let loadedAt = deps.loadedAt;

  const publish = (next: Partial<ConnectionStatus>): void => {
    status = { ...status, ...next, cursor: lastEventId };
    deps.delivery.setDelivery(DELIVERY[status.mode]);
    deps.onStatus(status);
  };

  const clearTimers = (): void => {
    if (watchdog !== null) { clearTimeout(watchdog); watchdog = null; }
    if (retry !== null) { clearTimeout(retry); retry = null; }
  };

  /** End the current attempt; its late callbacks become no-ops. */
  const teardown = (): void => {
    generation += 1;
    clearTimers();
    const current = controller;
    controller = null;
    current?.abort();
  };

  const armWatchdog = (attempt: number, ms: number, reason: string): void => {
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = setTimeout(() => { watchdog = null; fail(attempt, reason); }, ms);
  };

  const discard = (response: Response): void => {
    void response.body?.cancel().catch(() => undefined);
  };

  function fail(attempt: number, reason: string): void {
    if (attempt !== generation || stopped) return;
    teardown();
    interrupted = true;
    const failures = status.attempt + 1;
    publish({ mode: 'fallback', attempt: failures, reason });
    const delay = backoff[Math.min(failures, backoff.length) - 1] ?? 15_000;
    retry = setTimeout(() => { retry = null; connect(); }, delay);
  }

  function close(attempt: number, reason: string): void {
    if (attempt !== generation || stopped) return;
    teardown();
    closedReason = reason;
    publish({ mode: 'closed', reason });
  }

  function becomeLive(attempt: number): void {
    armWatchdog(attempt, silenceTimeoutMs, 'silent');
    publish({ mode: 'live', attempt: 0, reason: null });
  }

  function receive(attempt: number, resumed: boolean, message: SseMessage): void {
    if (attempt !== generation) return;
    lastEventId = message.lastEventId === '' ? null : message.lastEventId;
    const data = parseData(message.data);
    if (message.event === 'ready' || message.event === 'reset') {
      // After a pause or failure, a stream without a resume point cannot say
      // which commits it missed. The page's first stream runs the watches only
      // when a commit landed between the bootstrap and this subscription; else
      // everything shown was read at or after this head.
      const loadGap = loadedAt !== undefined && commitNewer(lastEventId, loadedAt);
      loadedAt = undefined;
      const includeWatches = message.event === 'reset' || (!resumed && interrupted) || loadGap;
      becomeLive(attempt);
      deps.delivery.catchUp(includeWatches);
      return;
    }
    if (message.event !== 'change') return;
    const notice = asNotice(data);
    if (notice === null) return;
    if (status.mode !== 'live') {
      // A resumed stream may open with one coalesced change instead of `ready`.
      becomeLive(attempt);
      deps.delivery.catchUp(false);
    }
    deps.delivery.deliverNotice(notice);
    if (status.cursor !== lastEventId) publish({});
  }

  function activity(attempt: number): void {
    if (attempt === generation && status.mode === 'live') armWatchdog(attempt, silenceTimeoutMs, 'silent');
  }

  async function open(attempt: number, signal: AbortSignal): Promise<void> {
    const resumeFrom = lastEventId;
    const headers: Record<string, string> = { [UI_PLATFORM_TOKEN_HEADER]: deps.token, accept: 'text/event-stream' };
    if (resumeFrom !== null) headers[UI_LAST_EVENT_ID_HEADER] = resumeFrom;
    let response: Response;
    try {
      response = await deps.fetch(UI_CORE_API_PREFIX + UI_CHANGES_SUFFIX, { method: 'GET', headers, cache: 'no-store', signal });
    } catch {
      fail(attempt, 'network');
      return;
    }
    if (attempt !== generation) { discard(response); return; }
    if (CLOSING_STATUSES.has(response.status)) { discard(response); close(attempt, `http_${response.status}`); return; }
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || response.body === null || !type.startsWith('text/event-stream')) {
      discard(response);
      fail(attempt, response.ok ? 'not_event_stream' : `http_${response.status}`);
      return;
    }
    const parser = createSseParser(message => receive(attempt, resumeFrom !== null, message), resumeFrom ?? '');
    try {
      await readSse(response.body, parser, () => activity(attempt));
      fail(attempt, 'stream_ended');
    } catch {
      fail(attempt, 'stream_error');
    }
  }

  function connect(): void {
    teardown();
    const attempt = generation;
    const abort = new AbortController();
    controller = abort;
    publish({ mode: 'connecting' });
    armWatchdog(attempt, readyTimeoutMs, 'ready_timeout');
    void open(attempt, abort.signal);
  }

  function pause(): void {
    teardown();
    interrupted = true;
    publish({ mode: 'paused' });
  }

  function resume(): void {
    if (closedReason !== null) publish({ mode: 'closed', reason: closedReason });
    else connect();
  }

  const unlisten = deps.visibility.listen(() => {
    if (stopped) return;
    if (deps.visibility.hidden()) { if (status.mode !== 'paused') pause(); }
    else if (status.mode === 'paused') resume();
  });
  if (deps.visibility.hidden()) pause(); else connect();

  return {
    status: () => status,
    stop(): void {
      if (stopped) return;
      teardown();
      stopped = true;
      unlisten();
      closedReason = 'stopped';
      publish({ mode: 'closed', reason: 'stopped' });
    },
  };
}

/** Boot the page's stream: the real fetch, token, document visibility and the
 * page's refresh hub. `onStatus` receives every status change; `loadedAt` is
 * the bootstrap's `changesHead`. */
export function startLiveUpdates(onStatus: (status: ConnectionStatus) => void, loadedAt?: string | null): LiveConnection {
  return createLiveConnection({
    ...(loadedAt === undefined ? {} : { loadedAt }),
    // Called as a plain function: `window.fetch` must not be invoked with another `this`.
    fetch: (url, init) => fetch(url, init),
    token: pageToken,
    visibility: {
      hidden: () => document.visibilityState === 'hidden',
      listen: onChange => {
        document.addEventListener('visibilitychange', onChange);
        return () => document.removeEventListener('visibilitychange', onChange);
      },
    },
    delivery: refreshHub,
    onStatus,
  });
}
