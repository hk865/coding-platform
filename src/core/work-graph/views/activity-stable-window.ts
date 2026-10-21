/**
 * The 2A L7 stable read window shared by the four activity read loops: the
 * calendar and per-Run activity views (`activity-read-model`), the track bars
 * (`track-read-model`) and the task-state timeline (`task-state-timeline`).
 *
 * One attempt is: a fresh `Budget`, a "before" watermark, the caller's window
 * read, then an "after" watermark. The window is stable when both watermarks
 * are ready and equal. A moving window is retried at most
 * `ACTIVITY_WINDOW_MAX_ATTEMPTS` times; the fourth unstable attempt returns the
 * caller's `exhausted` rejection and there is no fifth read.
 *
 * `read` is a callback on purpose: the calendar evaluates `now()` only after a
 * successful "before" watermark, so the clock is read at exactly the point the
 * window starts. Hoisting `now()` out of the loop would tie the window to the
 * time before the first attempt and make every retry reuse a stale clock.
 *
 * The executor stays policy-free beyond the stable-window control flow. The
 * capacity text, the exhausted text, input validation and record decoding all
 * live in the callers; `mapError` lets each caller keep its own error text and
 * its own exceptional branches (only the track maps `ForbiddenError`). The
 * window result is returned exactly as read: no re-wrapping, no added cursor or
 * current field, no sorting.
 */
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { Budget, readWatermark } from './activity-read-helpers.js';

export const ACTIVITY_WINDOW_MAX_ATTEMPTS = 4;

export async function readStableActivityWindow<T>(input: {
  records: Parameters<typeof readWatermark>[0];
  cap: number;
  read: (budget: Budget) => Promise<ReadResult<T>>;
  mapError: (error: unknown) => CoreRejection;
  exhausted: () => CoreRejection;
}): Promise<ReadResult<T>> {
  for (let attempt = 0; attempt < ACTIVITY_WINDOW_MAX_ATTEMPTS; attempt += 1) {
    // A new Budget per attempt, never hoisted out of the loop: the cap bounds
    // one attempt, and a retry begins a fresh read. Watermark reads themselves
    // are not charged (`readWatermark` spends nothing).
    const budget = new Budget(input.cap);
    try {
      const before = await readWatermark(input.records);
      if (before.status !== 'ready') return before;
      const result = await input.read(budget);
      if (result.status !== 'ready') return result;
      const after = await readWatermark(input.records);
      if (after.status !== 'ready') return after;
      if (before.value === after.value) return result;
    } catch (error) {
      // Any throw (capacity, a store failure, a caller's exceptional branch)
      // stops at once; only the caller knows how to name it.
      return input.mapError(error);
    }
  }
  return input.exhausted();
}
