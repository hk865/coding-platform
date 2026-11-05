// W/state/goal-adviser-queue.ts — pure; no I/O, no clock; the two types are imported, never re-declared
import type { ProjectScope } from '../../../contracts/core/identity.js';
import type { InferPending } from '../../../contracts/data-format.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { GoalScreeningV1 } from '../../../contracts/query-job.js';
import type {
  GoalAdviserQueueEntryV1, GoalAdviserQueueFormat, GoalAdviserQueueV1,
} from '../../../contracts/role-lines.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';

export const QUEUE_DRAIN_BATCH = 16;

/** The queue before its commit: a new entry's `enqueuedAt` is `null` until the Store binds the commit cursor. A stored
 *  queue is one (a stored entry is a pending entry whose cursor is already bound); the re-read after the commit is
 *  stored again. */
export type GoalAdviserQueuePendingV1 = InferPending<(typeof GoalAdviserQueueFormat)['fields']>;

/** The read value of "no queue record": revision 0 is never stored; the first commit writes revision 1. */
export function emptyGoalAdviserQueue(projectRef: ProjectScope): GoalAdviserQueueV1 {
  return { ref: { aggregateType: 'GoalAdviserQueue', projectId: projectRef.projectId }, revision: 0,
    projectRef, entries: [] };
}

/** L33 item 3: 1-based, clamped to 1..length+1; null appends. The shape admits 0 (C/query-job.ts:247), clamped to 1. */
export function queueRankOf(screening: GoalScreeningV1 | null, length: number): number {
  const suggested = screening?.suggestedPosition ?? null;
  return suggested === null ? length + 1 : Math.min(Math.max(suggested, 1), length + 1);
}

export function enqueueGoal(queue: GoalAdviserQueuePendingV1, entry: GoalAdviserQueuePendingV1['entries'][number]):
  GoalAdviserQueuePendingV1 {
  const entries = [...queue.entries];
  const rank = queueRankOf(entry.screening, entries.length);
  // Equal requested rank inserts AFTER the last equal-rank entry in the array: G1(1), G2(2), G3(1), G4(2)
  // -> [G1, G3, G2, G4]; a run-only scan lets a later equal-rank entry jump an earlier different rank.
  let lastEqualIndex = -1;
  for (let index = 0; index < entries.length; index += 1) {
    if (queueRankOf(entries[index]!.screening, entries.length) === rank) lastEqualIndex = index;
  }
  entries.splice(Math.max(rank - 1, lastEqualIndex + 1), 0, entry);
  return { ...queue, revision: queue.revision + 1, entries };
}

/** A person's reorder is a permutation of the current goal refs; anything else is `invalid` (null here). */
export function reorderGoals(queue: GoalAdviserQueueV1, order: readonly GoalRef[]): GoalAdviserQueueV1 | null {
  if (order.length !== queue.entries.length) return null;
  const byKey = new Map(queue.entries.map((entry) => [canonicalKey(entry.goalRef), entry]));
  const seen = new Set<string>();
  const entries: GoalAdviserQueueEntryV1[] = [];
  for (const goalRef of order) {
    const key = canonicalKey(goalRef);
    const entry = byKey.get(key);
    if (entry === undefined || seen.has(key)) return null;
    seen.add(key);
    entries.push(entry);
  }
  return { ...queue, revision: queue.revision + 1, entries };
}

export function dropGoal(queue: GoalAdviserQueueV1, goalRef: GoalRef): GoalAdviserQueueV1 {
  const key = canonicalKey(goalRef);
  return { ...queue, revision: queue.revision + 1,
    entries: queue.entries.filter((entry) => canonicalKey(entry.goalRef) !== key) };
}
