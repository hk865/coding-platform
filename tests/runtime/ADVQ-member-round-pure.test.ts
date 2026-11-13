/**
 * ADVQ-P (121-114; advq-start-rulings-draft.md §2.1): besides the secretary's request round, only the adviser's
 * intervention planning round in the `plan_round` or Host-system text (null) shape keeps `create_member`; the
 * preparation, the start and the WorkGraph Query authorisation all reach this rule through `projectQueryConfiguration`.
 * Red today (fa5bc8e0): `query-preparation.ts` exports no `adviserMemberRound` (typecheck red, the SBX-09 precedent);
 * green when ADVQ lands. Mutations: no duty condition reds the secretary and executor cells; a reversed shape list
 * (`!== 'exec_review'`) reds `plan_review`; no execution-kind condition reds `role_exploration` and `semantic_query`.
 */
import { describe, expect, it } from 'vitest';
import { adviserMemberRound } from '../../src/core/agent-runtime/query-preparation.js';

describe('ADVQ-P: which Query round keeps create_member for the adviser', () => {
  it.each([
    ['intervention_planning', null, 'adviser', true],
    ['intervention_planning', 'plan_round', 'adviser', true],
    ['intervention_planning', null, 'secretary', false],
    ['intervention_planning', 'plan_round', 'secretary', false],
    ['intervention_planning', null, 'executor', false],
    ['intervention_planning', 'exec_review', 'adviser', false],
    ['intervention_planning', 'plan_review', 'adviser', false],
    ['intervention_planning', 'unknown_call_advice', 'adviser', false],
    ['role_exploration', null, 'adviser', false],
    ['semantic_query', null, 'adviser', false],
  ] as const)('%s, shape %s, duty %s -> %s', (executionKind, shape, duty, expected) => {
    expect(adviserMemberRound({ executionKind, shape, duty })).toBe(expected);
  });
});
