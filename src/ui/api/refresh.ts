/// <reference lib="dom" />
/**
 * Refetch scheduling seam: the only place that starts and stops the page's read
 * loops (P1 driver-read, P2 commands/read) and its record-notice refetches.
 * How they are delivered is set by `api/live.ts` from the change-stream state:
 *
 *  - `timers`  the pre-task-E polling: every read loop runs on its own interval.
 *              It is the default and the fallback whenever the stream is not live.
 *  - `notices` the stream is live: no timer runs; a read loop runs only when a
 *              notice for its Host handle arrives, and once after every
 *              (re)connect (`catchUp`).
 *  - `off`     the page is hidden: nothing runs.
 *
 * A notice-driven run is single-flight per read loop with a short trailing
 * debounce, so a burst of notices gives at most two reads and never two
 * overlapping ones.
 */
import type { ChangeNotice, CoreScope } from '../../app/core-http-types.js';

export type DeliveryMode = 'notices' | 'timers' | 'off';

/** The Host handle a read loop follows. Driver notices match any Task of the
 * Goal, because the driver snapshot also carries its sibling handles. */
export type ChangeTopic =
  | { kind: 'driver'; scope: CoreScope; goalId: string }
  | { kind: 'command'; scope: CoreScope; commandId: string };

/** A running read loop. Its owner keeps it (ScopeState.collaborationPoll,
 * CommandTabState.poll) and hands it back to stopPoll. */
export type PollHandle = { readonly id: number };

export type PollOptions = {
  /** Run the read once now, through the same single-flight runner (P1). */
  immediate?: boolean;
  /** A `noticeMark()` taken before the request that produced the handle: a
   * matching notice received after it (before this registration) runs the read
   * once, so a handle that changed before its start/stop reply was processed
   * is not missed. */
  since?: number;
};

export type RefreshHub = {
  /** Register a read loop; under `timers` it is `setInterval(tick, intervalMs)` exactly as before. */
  startPoll(intervalMs: number, tick: () => unknown, topic: ChangeTopic, options?: PollOptions): PollHandle;
  /** Stop a read loop. `null` (none running) or an already stopped handle does nothing. */
  stopPoll(handle: PollHandle | null): void;
  /** Re-run `refetch` (debounced, single-flight) when a notice satisfies `match`,
   * and after a `reset`. Never runs on a timer. Returns the unsubscribe. */
  watchChanges(match: (notice: ChangeNotice) => boolean, refetch: () => unknown, debounceMs?: number): () => void;
  /** Sequence number of the last notice received. */
  noticeMark(): number;
  setDelivery(mode: DeliveryMode): void;
  delivery(): DeliveryMode;
  deliverNotice(notice: ChangeNotice): void;
  /** Run every read loop once (and every watch with `includeWatches`). */
  catchUp(includeWatches: boolean): void;
  counts(): { polls: number; watches: number };
};

const POLL_DEBOUNCE_MS = 50;
const WATCH_DEBOUNCE_MS = 300;
const RECENT_NOTICES = 200;

type Job = {
  readonly run: () => unknown;
  readonly debounceMs: number;
  running: boolean;
  dirty: boolean;
  stopped: boolean;
  debounce: ReturnType<typeof setTimeout> | null;
};

type Poll = { readonly tick: () => unknown; readonly intervalMs: number; readonly topic: ChangeTopic; readonly job: Job;
  timer: ReturnType<typeof setInterval> | null };
type Watch = { readonly match: (notice: ChangeNotice) => boolean; readonly job: Job };

export function topicMatches(topic: ChangeTopic, notice: ChangeNotice): boolean {
  const scope = notice.scope;
  if (scope === undefined || scope.projectId !== topic.scope.projectId || scope.workspaceId !== topic.scope.workspaceId) return false;
  if (topic.kind === 'driver') return notice.kinds.includes('driver') && notice.goalId === topic.goalId;
  return notice.kinds.includes('command') && notice.commandId === topic.commandId;
}

export function createRefreshHub(): RefreshHub {
  let mode: DeliveryMode = 'timers';
  let nextId = 0;
  let noticeSeq = 0;
  const recent: { seq: number; notice: ChangeNotice }[] = [];
  const polls = new Map<number, Poll>();
  const watches = new Set<Watch>();

  const job = (run: () => unknown, debounceMs: number): Job =>
    ({ run, debounceMs, running: false, dirty: false, stopped: false, debounce: null });

  const cancel = (target: Job): void => {
    target.stopped = true;
    if (target.debounce !== null) { clearTimeout(target.debounce); target.debounce = null; }
  };

  const finish = (target: Job): void => {
    target.running = false;
    if (target.dirty) { target.dirty = false; schedule(target); }
  };

  /** Only `schedule` (which defers while running) and a new loop's immediate read call this. */
  function execute(target: Job): void {
    if (target.stopped) return;
    target.running = true;
    let result: unknown;
    try {
      result = target.run();
    } catch (error) {
      finish(target);
      throw error;
    }
    // A rejected read stays visible as an unhandled rejection, as before.
    void Promise.resolve(result).finally(() => finish(target));
  }

  function schedule(target: Job): void {
    if (target.stopped || mode === 'off') return;
    if (target.running) { target.dirty = true; return; }
    if (target.debounce !== null) return;
    target.debounce = setTimeout(() => { target.debounce = null; execute(target); }, target.debounceMs);
  }

  const arm = (poll: Poll): void => {
    // The old loop: no single-flight, exactly `setInterval(tick, intervalMs)`.
    if (mode === 'timers' && poll.timer === null) poll.timer = setInterval(() => { void poll.tick(); }, poll.intervalMs);
  };
  const disarm = (poll: Poll): void => {
    if (poll.timer !== null) { clearInterval(poll.timer); poll.timer = null; }
  };

  return {
    startPoll(intervalMs, tick, topic, options = {}) {
      const handle: PollHandle = { id: ++nextId };
      const poll: Poll = { tick, intervalMs, topic, job: job(tick, POLL_DEBOUNCE_MS), timer: null };
      polls.set(handle.id, poll);
      if (options.immediate === true) execute(poll.job);
      arm(poll);
      const since = options.since;
      if (since !== undefined && mode === 'notices'
        && recent.some(entry => entry.seq > since && topicMatches(topic, entry.notice))) schedule(poll.job);
      return handle;
    },
    stopPoll(handle) {
      if (handle === null) return;
      const poll = polls.get(handle.id);
      if (poll === undefined) return;
      polls.delete(handle.id);
      disarm(poll);
      cancel(poll.job);
    },
    watchChanges(match, refetch, debounceMs = WATCH_DEBOUNCE_MS) {
      const watch: Watch = { match, job: job(refetch, debounceMs) };
      watches.add(watch);
      return () => { watches.delete(watch); cancel(watch.job); };
    },
    noticeMark: () => noticeSeq,
    setDelivery(next) {
      if (next === mode) return;
      mode = next;
      for (const poll of polls.values()) {
        if (mode === 'timers') arm(poll); else disarm(poll);
        if (mode === 'off' && poll.job.debounce !== null) { clearTimeout(poll.job.debounce); poll.job.debounce = null; }
      }
      if (mode === 'off') {
        for (const watch of watches) {
          if (watch.job.debounce !== null) { clearTimeout(watch.job.debounce); watch.job.debounce = null; }
        }
      }
    },
    delivery: () => mode,
    deliverNotice(notice) {
      noticeSeq += 1;
      recent.push({ seq: noticeSeq, notice });
      if (recent.length > RECENT_NOTICES) recent.shift();
      if (mode !== 'notices') return;
      for (const poll of polls.values()) if (topicMatches(poll.topic, notice)) schedule(poll.job);
      for (const watch of watches) if (watch.match(notice)) schedule(watch.job);
    },
    catchUp(includeWatches) {
      for (const poll of polls.values()) schedule(poll.job);
      if (includeWatches) for (const watch of watches) schedule(watch.job);
    },
    counts: () => ({ polls: polls.size, watches: watches.size }),
  };
}

/** The page's one hub; the view call sites use the bound functions below. */
export const refreshHub = createRefreshHub();
export const startPoll = refreshHub.startPoll;
export const stopPoll = refreshHub.stopPoll;
export const noticeMark = refreshHub.noticeMark;
