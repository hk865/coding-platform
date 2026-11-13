/**
 * PL planning note admission (slice-PL-SPEC §5.2.8; ruling C.3): a planning
 * Query gets the six general write kinds, while the secretary arm is unchanged.
 * The planning shape is `plan_round`/`plan_review`, or a `null` manifest shape
 * only for a Host system source round with an effective Goal.
 */
import { describe, expect, it } from 'vitest';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryNoteAdmissionV1 } from '../../src/core/work-graph/model/secretary-note-contracts.js';
import { planningNoteAdmission } from '../../src/core/work-graph/state/secretary-note.js';

// Hand-written from the frozen contract; the test does not import the implementation constant.
const GENERAL_KINDS = ['convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision'] as const;
const PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: 'project-1', planId: 'plan-1' };

const PLANNING: QueryNoteAdmissionV1 = {
  class: 'planning', kinds: GENERAL_KINDS, withdraw: true, grantedGoalIds: [],
};
const NONE: QueryNoteAdmissionV1 = { class: 'none' };

type PlanningCase = {
  name: string;
  input: Parameters<typeof planningNoteAdmission>[0];
  expected: QueryNoteAdmissionV1;
};

const rows: PlanningCase[] = [
  {
    name: 'plan_round is planning',
    input: { answerShape: 'plan_round', effectiveGoalId: 'goal-1', planRef: PLAN_REF, hostSystemPlanningSource: false },
    expected: PLANNING,
  },
  {
    name: 'plan_review is planning',
    input: { answerShape: 'plan_review', effectiveGoalId: 'goal-1', planRef: PLAN_REF, hostSystemPlanningSource: false },
    expected: PLANNING,
  },
  {
    name: 'null shape with a Host system source and a goal is planning',
    input: { answerShape: null, effectiveGoalId: 'goal-1', planRef: PLAN_REF, hostSystemPlanningSource: true },
    expected: PLANNING,
  },
  {
    name: 'null shape without a Host system source is none',
    input: { answerShape: null, effectiveGoalId: 'goal-1', planRef: PLAN_REF, hostSystemPlanningSource: false },
    expected: NONE,
  },
  {
    name: 'null shape with a Host system source but no goal is none',
    input: { answerShape: null, effectiveGoalId: null, planRef: PLAN_REF, hostSystemPlanningSource: true },
    expected: NONE,
  },
  // SCRV S8 (start rulings draft §2.7; lead rulings Q3): the scribe's review round writes its general note in the round,
  // also when the round is project-level (a Query round's command has no Goal). RED today: `scribe_review` is no shape
  // yet, so both read `none` (today is the named mutation "scribe_review left out of the admission").
  {
    name: 'scribe_review is planning',
    input: { answerShape: 'scribe_review', effectiveGoalId: 'goal-1', planRef: PLAN_REF, hostSystemPlanningSource: true },
    expected: PLANNING,
  },
  {
    name: 'scribe_review without a goal (a project-level round) is planning',
    input: { answerShape: 'scribe_review', effectiveGoalId: null, planRef: null, hostSystemPlanningSource: true },
    expected: PLANNING,
  },
];

describe('planningNoteAdmission', () => {
  it.each(rows)('$name', ({ input, expected }) => {
    expect(planningNoteAdmission(input)).toEqual(expected);
  });
});
