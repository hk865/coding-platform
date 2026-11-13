/**
 * The Host's one cap on platform-run commands (read-only commands, registered
 * checks) running at once (121-112 ruling 3: every role runs commands; up to 18
 * lines run at once, each command alone may use 6 GiB). A command that finds no
 * free slot waits; waiting is not a failure.
 */
export const PLATFORM_COMMAND_SLOTS = 4;

export type CommandSlots = {
  /** Takes one slot; resolves with a once-only release, or `null` when the signal
   *  aborts before the slot is granted (or was already aborted). */
  acquire(signal: AbortSignal): Promise<(() => void) | null>;
};

export function createCommandSlots(limit: number): CommandSlots {
  let running = 0;
  const waiting: Array<{ grant: () => void }> = [];

  function slotRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiting.shift();
      // The next waiter takes over the still-running slot; otherwise the count drops.
      if (next !== undefined) next.grant();
      else running -= 1;
    };
  }

  return {
    acquire(signal) {
      if (signal.aborted) return Promise.resolve(null);
      if (running < limit) {
        running += 1;
        return Promise.resolve(slotRelease());
      }
      return new Promise(resolve => {
        const dropWaiter = (): void => {
          const index = waiting.indexOf(waiter);
          if (index >= 0) waiting.splice(index, 1);
          resolve(null);
        };
        // Granting first removes the abort listener, so `dropWaiter` can no
        // longer run after a grant.
        const waiter = { grant: () => { signal.removeEventListener('abort', dropWaiter); resolve(slotRelease()); } };
        signal.addEventListener('abort', dropWaiter, { once: true });
        waiting.push(waiter);
      });
    },
  };
}
