/**
 * L4: the ONE activity replacement rule, shared by the backfill write and the
 * end commit. Pure: it reads the two facts values it is given and returns a
 * verdict; it never reads storage, calls a clock or writes anything.
 */
import type { RunActivityFactsV1 } from '../../../contracts/run-activity.js';

export type ActivityWriteOutcome = 'created' | 'replaced' | 'unchanged';

/**
 * L4, applied top-down. `endCommit` is true only for the RUN-21 path inside a
 * Run-ending commit; the backfill never replaces a current-rule `counted`
 * record (row 4). Rows:
 * 1. absent → created;
 * 2. the old rule version is older → replaced;
 * 3. old `counted`, this is the RUN-21 end, the new window is a terminal
 *    extension of an unfinished old one → replaced;
 * 4. old `counted`, anything else → unchanged;
 * 5. old `unknown`, new `counted` → replaced;
 * 6. old `unknown`, new `unknown` with a different reason → replaced;
 * 7. old `unknown`, new `unknown` with the same reason → unchanged.
 */
export function decideActivityOutcome(
  existing: RunActivityFactsV1 | null,
  incoming: RunActivityFactsV1,
  endCommit: boolean,
): ActivityWriteOutcome {
  if (existing === null) return 'created';
  const old = existing;
  if (old.ruleVersion < incoming.ruleVersion) return 'replaced';
  if (old.status === 'counted') {
    if (!endCommit || incoming.status !== 'counted') return 'unchanged';
    const unfinished = !old.window.turnTerminal || old.window.unresolvedCalls > 0;
    return incoming.window.turnTerminal && incoming.window.throughPosition > old.window.throughPosition && unfinished
      ? 'replaced' : 'unchanged';
  }
  if (incoming.status === 'counted') return 'replaced';
  return old.reason === incoming.reason ? 'unchanged' : 'replaced';
}
