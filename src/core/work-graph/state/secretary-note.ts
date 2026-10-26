/**
 * The one pure rule behind `QueryNoteAdmissionV1`: a Query may write notes only
 * when this round is a secretary request round. A plain Query and a copy have
 * no request root, so they get no note tool and no note declaration. The
 * admitted kinds are the six general kinds plus `understanding`: `review` is
 * not a write kind at all, and `repair` is refused for a secretary's write.
 *
 * This file holds the value's one declaration; consumers import it through
 * `model/secretary-note-contracts.ts`, which re-exports it.
 */
import { NOTE_GENERAL_KINDS, type NoteKind } from '../../../contracts/note.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';

export type QueryNoteAdmissionV1 =
  | { class: 'none' }
  | { class: 'secretary';
      /** The admitted write kinds, in the declaration's order: the six general kinds then `understanding`. */
      kinds: readonly NoteKind[];
      withdraw: true;
      /** The still-valid request_understanding grant set (goal ids), read from the round's frozen batch. */
      grantedGoalIds: readonly string[] };

/**
 * A request root is the trusted mark of a secretary request round; without one
 * the round is a plain Query or a copy and cannot write notes. `effectiveGoalId`
 * is part of the frozen request facts but does not decide the class, and a
 * no-goal secretary round is still a secretary round. A secretary's granted
 * goals are carried by id only, in the order the grant set was read.
 */
export function secretaryNoteAdmission(input: {
  requestRoot: QueryJobRef | null;
  effectiveGoalId: string | null;
  grantedGoalIds: readonly GoalRef[];
}): QueryNoteAdmissionV1 {
  if (input.requestRoot === null) return { class: 'none' };
  return {
    class: 'secretary',
    kinds: [...NOTE_GENERAL_KINDS, 'understanding'],
    withdraw: true,
    grantedGoalIds: input.grantedGoalIds.map(goal => goal.goalId),
  };
}
