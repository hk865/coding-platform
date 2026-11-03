/**
 * The one pure rule behind `QueryNoteAdmissionV1`: a Query may write notes only
 * when this round is a secretary request round or a non-request planning round.
 * A plain Query and a copy have no request root, so they get no note tool and no
 * note declaration. A secretary round admits the six general kinds plus
 * `understanding`: `review` is not a write kind at all, and `repair` is refused
 * for a secretary's write. A planning round admits only the six general kinds.
 *
 * This file holds the value's one declaration; consumers import it through
 * `model/secretary-note-contracts.ts`, which re-exports it.
 */
import { NOTE_GENERAL_KINDS, type NoteKind } from '../../../contracts/note.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { QueryAnswerShapeV1, QueryJobRef } from '../../../contracts/query-job.js';

export type QueryNoteAdmissionV1 =
  | { class: 'none' }
  | { class: 'secretary';
      /** The admitted write kinds, in the declaration's order: the six general kinds then `understanding`. */
      kinds: readonly NoteKind[];
      withdraw: true;
      /** The still-valid request_understanding grant set (goal ids), read from the round's frozen batch. */
      grantedGoalIds: readonly string[] }
  | { class: 'planning';
      /** A planning round writes only the six general kinds; no understanding/repair. */
      kinds: readonly NoteKind[];
      withdraw: true;
      /** A planning round carries no request_understanding grants. */
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
    kinds: [...NOTE_GENERAL_KINDS, 'understanding', 'link'],
    withdraw: true,
    grantedGoalIds: input.grantedGoalIds.map(goal => goal.goalId),
  };
}

/**
 * A non-request planning Query may write the six general note kinds (slice-PL-SPEC
 * §5.2.8). A round whose submit-tool shape is `plan_round`/`plan_review` is a
 * planning round; a `text`-shaped overlap note is stored as `null` in the
 * manifest and enters only when its frozen source message is a Host system
 * `action_request` and the round has an effective Goal. `planRef` is part of the
 * frozen input but does not decide the class.
 */
export function planningNoteAdmission(input: {
  answerShape: QueryAnswerShapeV1 | null;
  effectiveGoalId: string | null;
  planRef: PlanRevisionRef | null;
  hostSystemPlanningSource: boolean;
}): QueryNoteAdmissionV1 {
  const planningShape = input.answerShape === 'plan_round' || input.answerShape === 'plan_review';
  const hostTextRound = input.answerShape === null && input.hostSystemPlanningSource
    && input.effectiveGoalId !== null;
  if (!planningShape && !hostTextRound) return { class: 'none' };
  return { class: 'planning', kinds: NOTE_GENERAL_KINDS, withdraw: true, grantedGoalIds: [] };
}
