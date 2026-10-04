/// <reference lib="dom" />
/** Timer ownership seam: the only place that starts and stops the page's polling intervals (P1 driver-read, P2 commands/read). */

/** A running poll. Its owner keeps it (ScopeState.collaborationPoll, CommandTabState.poll) and hands it back to stopPoll. */
export type PollHandle = ReturnType<typeof setInterval>;

/** Call `tick` every `intervalMs`. There is no immediate tick; a caller that needs a first read makes it itself (P1). */
export function startPoll(intervalMs: number, tick: () => void): PollHandle {
  return setInterval(tick, intervalMs);
}

/** Stop a poll started by startPoll. `null` (no poll running) does nothing. */
export function stopPoll(handle: PollHandle | null): void {
  if (handle !== null) clearInterval(handle);
}
