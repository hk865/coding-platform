/**
 * The Host's wake loop for the request queues.
 *
 * A queue handler is woken when something may have changed (a request command
 * commit, a commit notice, a settled advance, a registered line, Host start)
 * and runs one pass that re-reads the queue. Wakes only cut latency: the
 * persistent records and the read-only rebuild are what make a pass correct, so
 * a wake may be coalesced, dropped while the loop is not driving, or answered
 * with a page of nothing.
 *
 * The rules this file implements:
 *
 * - A wake marks the (workspace, queue) pair dirty; one pass runs per mark.
 *   Wakes that arrive while a pass runs collapse into exactly one more pass
 *   after it, so no wake is lost.
 * - One pass per pair at a time. A pass never starts inside the call that woke
 *   it: the loop leaves the committing call first, then schedules its own
 *   work.
 * - A pass that reports `more` schedules another pass after yielding to the
 *   event loop, so paging never starves the loop. A full wrap that progressed
 *   nothing parks the pair until the next wake.
 * - A handler failure is never read as "nothing to do": it keeps the pair
 *   dirty and backs it off from one second doubling to one minute. A pass that
 *   progresses resets the back-off.
 * - A commit notice is coarse (aggregate types and project only). A queue is
 *   woken by the aggregate types it subscribed to; absent an option that is
 *   QueryJob, QueryRun or Session (the request queues), and the lifecycle
 *   queue names its own blocking basis. Every registered workspace of the
 *   notice's project is woken, because passes re-read anyway; a notice of
 *   another type wakes no queue that did not subscribe to it.
 * - No pass starts, and a running pass schedules nothing more, unless the
 *   caller's lease check says the Host is driving. Losing the lease is a
 *   close.
 * - An unarmed workspace ignores commit notices, settled advances and
 *   registrations until a request command arms it. Without that, nothing runs
 *   after a restart until the person sends a request command.
 * - close() stops scheduling, aborts the loop's one AbortSignal (the signal
 *   every drain receives), and waits for the running pass. It never starts
 *   anything else and is idempotent.
 *
 * The last continuation a pass returned is kept per (workspace, queue) and
 * handed back on the next pass. `maxItems` is the caller's page budget.
 */
import type { RecordCommitNotice } from '../composition/commit-observer.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { WorkspaceScope } from '../contracts/core/identity.js';
import {
  REQUEST_BACKOFF_INITIAL_MS, REQUEST_BACKOFF_MAX_MS,
} from '../core/work-graph/model/request-contracts.js';

export type WakeSource = 'request_command' | 'commit' | 'advance_settled' | 'line_registered' | 'start'
  | 'release_armed';

/** The queue keys the Host registers; the loop itself never names a second queue. */
export const LIFECYCLE_QUEUE = 'lifecycle';

/** Book §3.8 item 3 (`book-7a.md:382–:383`): the release queue's key; the Host registers it inside its driver block. */
export const MESSAGE_RELEASE_QUEUE = 'message_release';

/**
 * The lifecycle queue's own wake types: SessionActivity/CurrentPointer guard the coverage commit; NoteHead/
 * NoteVersion feed the brief; PlanProposal/Goal end a request's processing, which the routing set and the
 * handoff archive condition read. Static, not conditional: a pass without a pending operation costs one
 * indexed read.
 */
export const LIFECYCLE_WAKE_AGGREGATE_TYPES: readonly string[] = Object.freeze([
  'QueryJob', 'QueryRun', 'Session', 'CoreOperation', 'SessionActivity', 'PlanProposal', 'Goal',
  'NoteHead', 'NoteVersion', 'CurrentPointer',
]);

/**
 * The release queue's own wake types — the facts an item waits on (`book-7a.md:387–:389`): its message, its
 * Goal, the plan pointer, the understanding pointer, the counter and its activity record. Static, not conditional: a
 * pass with nothing to do costs one indexed page read.
 */
export const MESSAGE_RELEASE_WAKE_AGGREGATE_TYPES: readonly string[] = Object.freeze([
  'SessionMessage', 'Goal', 'PlanRevision', 'CurrentPointer', 'DispatchCounter', 'SessionActivity',
]);

/** The aggregate types whose commit wakes a queue that gave no option. */
export type WakeQueueOptionsV1 = {
  /** The aggregate types whose commit wakes this queue; absent → the loop's default set (QueryJob, QueryRun, Session). */
  aggregateTypes?: readonly string[];
};

/** The loop's one handler shape; the Host's queues implement it. */
export type QueueHandler = {
  rebuild(scope: WorkspaceScope): Promise<void>;
  drain(scope: WorkspaceScope, input: { maxItems: number; continuation: string | null; signal: AbortSignal }):
    Promise<{ progressed: number; more: boolean; continuation: string | null; wrapped: boolean; blocked: number }>;
};

type DrainResult = Awaited<ReturnType<QueueHandler['drain']>>;

export interface WakeLoop {
  register(queueKey: string, handler: QueueHandler, options?: WakeQueueOptionsV1): void;
  wake(scope: WorkspaceScope, queueKey: string, source: WakeSource): void;
  committed(notice: RecordCommitNotice): void;
  start(workspaces: WorkspaceScope[], input: { resumeOnStartup: boolean }): Promise<void>;
  addWorkspace(scope: WorkspaceScope): Promise<void>;
  close(): Promise<void>;
}

export type WakeLoopDependencies = {
  /** True while this Host holds its instance lease; no pass starts otherwise. */
  driving: () => boolean;
  /** The wait a failing queue uses; a test with fake timers may inject one. */
  delay?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The clock the back-off deadline is measured against. */
  now?: () => number;
  /** The page budget a pass hands its handler. */
  maxItems?: number;
};

/** The lifecycle queue's port: one handler call runs one whole traversal. */
export interface HandoffQueuePort {
  /** The whole traversal: pending round ends, then every unfinished operation once. */
  run(ctx: CoreCallContext): Promise<{ continued: number; blocked: number }>;
  /** Waits for every started call under the loop's close rule. */
  close(): Promise<void>;
}

/**
 * The lifecycle queue's dependencies. The traversal reads the saved facts
 * through the composition's ports: the operation index, the basis read and the
 * Workflow's handoff owners live there, so this queue owns the loop bookkeeping
 * and the composition owns the reads.
 */
export type HandoffQueueDependencies = {
  /** One whole traversal; a transient item failure is recorded and stepped past. */
  pass: (ctx: CoreCallContext) => Promise<{ continued: number; blocked: number }>;
};

export function createHandoffQueue(deps: HandoffQueueDependencies): HandoffQueuePort {
  const started = new Set<Promise<void>>();
  let closed = false;

  /** Close waits for a started call; the tracked promise settles on both paths, so a failure leaves no unhandled one. */
  function trackStarted(call: Promise<unknown>): void {
    const settled: Promise<void> = call.then(() => undefined, () => undefined);
    started.add(settled);
    void settled.then(() => { started.delete(settled); });
  }

  return {
    async run(ctx) {
      if (closed) return { continued: 0, blocked: 0 };
      const call = deps.pass(ctx);
      trackStarted(call);
      return await call;
    },

    async close() {
      closed = true;
      while (started.size > 0) await Promise.allSettled([...started]);
    },
  };
}


type WorkspaceState = { scope: WorkspaceScope; armed: boolean };

type QueueState = {
  workspaceKey: string;
  queueKey: string;
  continuation: string | null;
  /** A wake arrived and no pass has consumed it yet. */
  dirty: boolean;
  /** The one scheduling chain for this pair; null when nothing is scheduled. */
  chain: Promise<void> | null;
  /** Consecutive failures; reset by a pass that progresses. */
  failures: number;
  /** When the pending back-off ends; 0 when no back-off is pending. */
  retryAt: number;
};

/** The aggregate types that may carry a request or a Session into a pass. */
const WAKE_AGGREGATE_TYPES: ReadonlySet<string> = new Set(['QueryJob', 'QueryRun', 'Session']);

function workspaceKeyOf(scope: WorkspaceScope): string {
  return `${scope.projectId}\u0000${scope.workspaceId}`;
}

function queueKeyOf(workspaceKey: string, queueKey: string): string {
  return `${workspaceKey}\u0000${queueKey}`;
}

/**
 * The pair's wait: a plain timer that also ends when the loop closes, so close
 * never waits on a back-off that has not elapsed.
 */
function defaultDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    if (signal.aborted) { resolvePromise(); return; }
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolvePromise();
    };
    const onAbort = (): void => finish();
    const timer = setTimeout(finish, Math.max(0, ms));
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** A read that answered anything but `ready` is not an empty result: the caller's own back-off retries it. */
export function notReady(what: string, result: { status: string; code?: string; reason?: string }): Error {
  return new Error(`${what} is not ready: ${result.code === undefined ? result.status : `${result.code}: ${result.reason}`}`);
}

/** One event-loop turn, so a pass never runs inside the call that woke it. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolvePromise) => { setImmediate(resolvePromise); });
}

/** The back-off after `failures` consecutive failures: 1 s, 2 s, 4 s, … 60 s. */
function backoffMsFor(failures: number): number {
  return Math.min(REQUEST_BACKOFF_INITIAL_MS * 2 ** (failures - 1), REQUEST_BACKOFF_MAX_MS);
}

export function createWakeLoop(deps: WakeLoopDependencies): WakeLoop {
  const delay = deps.delay ?? defaultDelay;
  const now = deps.now ?? ((): number => Date.now());
  const maxItems = deps.maxItems ?? 1;
  const controller = new AbortController();
  /** Each queue's handler and the aggregate types it subscribes to. */
  const handlers = new Map<string, { handler: QueueHandler; aggregateTypes: ReadonlySet<string> }>();
  const workspaces = new Map<string, WorkspaceState>();
  const queues = new Map<string, QueueState>();
  const chains = new Set<Promise<void>>();
  let resumeOnStartup = false;
  let closed = false;
  let closing: Promise<void> | null = null;

  function ensureWorkspace(scope: WorkspaceScope): WorkspaceState {
    const key = workspaceKeyOf(scope);
    const existing = workspaces.get(key);
    if (existing !== undefined) return existing;
    const created: WorkspaceState = { scope, armed: false };
    workspaces.set(key, created);
    for (const queueKey of handlers.keys()) ensureQueue(key, queueKey);
    return created;
  }

  function ensureQueue(workspaceKey: string, queueKey: string): QueueState {
    const key = queueKeyOf(workspaceKey, queueKey);
    const existing = queues.get(key);
    if (existing !== undefined) return existing;
    const created: QueueState = {
      workspaceKey, queueKey, continuation: null, dirty: false, chain: null, failures: 0, retryAt: 0,
    };
    queues.set(key, created);
    return created;
  }

  function queueScope(entry: QueueState): WorkspaceScope | null {
    return workspaces.get(entry.workspaceKey)?.scope ?? null;
  }

  /** Keep the pair dirty and set the next back-off; the chain waits it out. */
  function recordFailure(entry: QueueState): void {
    entry.failures += 1;
    entry.dirty = true;
    entry.retryAt = now() + backoffMsFor(entry.failures);
  }

  /**
   * One scheduling chain per pair: it takes the dirty mark, runs one pass,
   * and repeats while a wake or a `more` page left the mark. A wake during the
   * pass therefore produces exactly one more pass, never two.
   */
  function schedule(entry: QueueState): void {
    entry.dirty = true;
    if (closed || entry.chain !== null || !deps.driving()) return;
    const chain: Promise<void> = runChain(entry).finally(() => {
      chains.delete(chain);
      entry.chain = null;
      if (entry.dirty && !closed && deps.driving()) schedule(entry);
    });
    entry.chain = chain;
    chains.add(chain);
  }

  async function runChain(entry: QueueState): Promise<void> {
    try {
      // Leave the call that woke the loop (a commit path) before any work.
      await yieldToEventLoop();
      while (!closed && deps.driving() && entry.dirty) {
        if (entry.retryAt > 0) {
          const waitMs = entry.retryAt - now();
          entry.retryAt = 0;
          if (waitMs > 0) await delay(waitMs, controller.signal);
          if (closed || !deps.driving()) return;
        }
        entry.dirty = false;
        const scope = queueScope(entry);
        const registration = handlers.get(entry.queueKey);
        if (scope === null || registration === undefined) return;
        let result: DrainResult;
        try {
          result = await registration.handler.drain(scope, {
            maxItems, continuation: entry.continuation, signal: controller.signal,
          });
        } catch {
          // A read failure is not "nothing to do": stay dirty and back off.
          recordFailure(entry);
          continue;
        }
        entry.continuation = result.continuation;
        if (result.progressed > 0) {
          entry.failures = 0;
          entry.retryAt = 0;
        }
        // A full wrap that found nothing parks until the next wake; a partial
        // page runs again only after the loop has had a turn.
        if (result.wrapped && result.progressed === 0) continue;
        if (result.more) {
          entry.dirty = true;
          await yieldToEventLoop();
        }
      }
    } catch {
      // Scheduling stops, the platform does not: a later wake or start retries.
    }
  }

  /** A queue joined late: rebuild it read-only for every known workspace. */
  function registerLater(queueKey: string): void {
    for (const workspaceKey of workspaces.keys()) {
      const entry = ensureQueue(workspaceKey, queueKey);
      if (entry.dirty) schedule(entry);
    }
  }

  async function rebuildQueue(entry: QueueState, handler: QueueHandler): Promise<void> {
    const scope = queueScope(entry);
    if (scope === null) return;
    try {
      await handler.rebuild(scope);
      entry.failures = 0;
      entry.retryAt = 0;
    } catch {
      // A failed rebuild leaves the queue dirty; the retry pass re-reads it.
      recordFailure(entry);
      schedule(entry);
    }
  }

  async function rebuildWorkspace(state: WorkspaceState): Promise<void> {
    const workspaceKey = workspaceKeyOf(state.scope);
    const rebuilds: Promise<void>[] = [];
    for (const [queueKey, registration] of handlers) {
      rebuilds.push(rebuildQueue(ensureQueue(workspaceKey, queueKey), registration.handler));
    }
    await Promise.all(rebuilds);
  }

  function wake(scope: WorkspaceScope, queueKey: string, source: WakeSource): void {
    if (closed) return;
    // A workspace the loop has not seen cannot be ignored: registering it here
    // keeps its first command's wake, and a pass re-reads everything anyway.
    const workspace = ensureWorkspace(scope);
    if (source === 'request_command' || source === 'release_armed') workspace.armed = true;
    if (!workspace.armed) return;
    schedule(ensureQueue(workspaceKeyOf(scope), queueKey));
  }

  return {
    register(queueKey, handler, options) {
      if (closed) return;
      const subscribed = options?.aggregateTypes ?? WAKE_AGGREGATE_TYPES;
      handlers.set(queueKey, { handler, aggregateTypes: new Set(subscribed) });
      registerLater(queueKey);
    },

    wake,

    committed(notice) {
      try {
        if (closed) return;
        for (const workspace of workspaces.values()) {
          for (const [queueKey, registration] of handlers) {
            // Each queue judges the notice against its OWN set; an optionless
            // queue keeps the loop's default set (QueryJob, QueryRun, Session).
            const touched = notice.aggregates.some(aggregate =>
              aggregate.projectId === workspace.scope.projectId
              && registration.aggregateTypes.has(aggregate.aggregateType));
            if (touched) wake(workspace.scope, queueKey, 'commit');
          }
        }
      } catch { /* an observer never affects the commit */ }
    },

    async start(started, input) {
      if (closed) return;
      resumeOnStartup = input.resumeOnStartup;
      const rebuilds: Promise<void>[] = [];
      for (const scope of started) {
        const workspace = ensureWorkspace(scope);
        workspace.armed = input.resumeOnStartup;
        rebuilds.push(rebuildWorkspace(workspace));
      }
      await Promise.all(rebuilds);
      if (!input.resumeOnStartup) return;
      for (const scope of started) {
        for (const queueKey of handlers.keys()) wake(scope, queueKey, 'start');
      }
    },

    async addWorkspace(scope) {
      if (closed) return;
      const workspace = ensureWorkspace(scope);
      // A workspace added to a running Host follows the mode start chose.
      workspace.armed = resumeOnStartup;
      await rebuildWorkspace(workspace);
      if (!workspace.armed) return;
      for (const queueKey of handlers.keys()) wake(scope, queueKey, 'start');
    },

    async close() {
      if (closing !== null) return closing;
      closed = true;
      controller.abort();
      closing = (async () => {
        while (chains.size > 0) await Promise.allSettled([...chains]);
      })();
      return closing;
    },
  };
}
