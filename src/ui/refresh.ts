import type { ChangeStream, ChangeStreamHandlers } from './host-client.js';

/**
 * E3-3 ruling items 2, 3, 5 and 6: the page's auto-refresh loop. `boot` hands
 * it one "read once" function, one "publish result" function and the change
 * stream factory; this module owns when to read, when to subscribe and how
 * notifications coalesce. It knows no DOM, board name or route.
 */

/** What the page publishes after every read, notification or stream change.
 * `dataVersion` counts successful reads only; `stale` is the disconnect and
 * reread-failure presentation; `error` is the latest read failure for the
 * page's E3-2 code table (null after a success or a stream loss). */
export type RefreshSnapshot<T> = {
  data: T | null;
  dataVersion: number;
  stale: boolean;
  error: unknown;
};

/** One read result: the board data plus the `changesHead` cursor that read's
 * bootstrap returned. `data: null` is a valid page and still subscribes. */
export type RefreshRead<T> = { data: T | null; cursor: string | null };

export type RefreshSources<T> = {
  read(): Promise<RefreshRead<T>>;
  publish(snapshot: RefreshSnapshot<T>): void;
  /** `cursor` is what `subscribeChanges` sends as the first `Last-Event-ID`, so
   * a commit in the read→subscribe gap is replayed instead of lost. */
  subscribe(handlers: ChangeStreamHandlers, cursor: string | null): ChangeStream;
};

/** Ruling item 5: every 2 s, with no cap and no backoff. */
const RECONNECT_DELAY_MS = 2_000;

export function createAutoRefresh<T>(sources: RefreshSources<T>): { start(): Promise<void>; reread(): Promise<void> } {
  let data: T | null = null;
  let cursor: string | null = null;
  let dataVersion = 0;
  let stale = false;
  /** Ruling item 5: only a successful reconnect clears a stream-loss `stale`;
   * a read that finishes after the disconnect must not hide that banner. */
  let disconnected = false;
  let error: unknown = null;
  let stream: ChangeStream | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reading = false;
  let pending = false;
  let current: Promise<void> = Promise.resolve();

  /** Ruling item 7: a successful `null` read counts as data for subscribing. */
  const hasData = (): boolean => dataVersion > 0;

  function publish(): void {
    sources.publish({ data, dataVersion, stale, error });
  }

  /** Ruling item 5: every successful connection rereads once. A `ready` frame
   * is not the connection signal, because a replay may start with `change` or
   * `reset`; `readOnce` is what clears the stale mark. */
  function connect(): void {
    if (!hasData()) return;
    stream ??= sources.subscribe({
      onOpen(): void {
        disconnected = false;
        void requestRead();
      },
      onNotice(): void { void requestRead(); },
      onEnd(): void {
        disconnected = true;
        stale = true;
        publish();
        reconnectTimer ??= setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, RECONNECT_DELAY_MS);
      },
    }, cursor);
    stream.connect();
  }

  /** Ruling item 3: every successful read publishes, even when the value is
   * equal to the last one; the version is what invalidates the board's cache. */
  async function readOnce(): Promise<void> {
    try {
      const result = await sources.read();
      data = result.data;
      cursor = result.cursor;
      dataVersion += 1;
      if (!disconnected) stale = false;
      error = null;
    } catch (caught) {
      error = caught;
      if (hasData()) stale = true;
    }
    publish();
  }

  /** Ruling item 3: notifications arriving during a read collapse into one
   * more read after it; the `reading` flag keeps exactly one read in flight. */
  function requestRead(): Promise<void> {
    if (reading) {
      pending = true;
      return current;
    }
    reading = true;
    current = (async () => {
      try {
        do {
          pending = false;
          await readOnce();
        } while (pending);
      } finally {
        reading = false;
        if (pending) void requestRead();
      }
    })();
    return current;
  }

  return {
    /** Ruling item 6: a first read that fails publishes the error and leaves
     * the stream unstarted; a successful retry is what subscribes it. */
    async start(): Promise<void> {
      await requestRead();
      if (stream === null) connect();
    },
    /** Ruling 4: the one read request `props.actions.readMore` uses; it joins
     * the same loop and never opens a second polling path. */
    reread(): Promise<void> {
      return requestRead();
    },
  };
}
