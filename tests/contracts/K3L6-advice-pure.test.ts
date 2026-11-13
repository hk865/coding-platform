/**
 * K3L-6, the draft's R-rows 12, 6 and 7 (§2.1, §2.2; decision 121-110; rulings Q1, Q3; the user's 11-13 answer 丙),
 * pure (A5).
 * ① `commandRerunAdviceProblem`, the one shape check of an adviser's rerun advice: three choices (`deny_final` is the
 * person's alone), `escalationKind` exactly with `escalate`, `rationale` and `plain`, no other member. ②
 * `commandRerunAdviserStageOf`: every step confirmed or the review record's streak (the second consecutive time) goes
 * to the person, a request with no adviser line goes to the person as `no_adviser` (the coordinator's ruling 1: decided
 * at creation), otherwise the adviser decides first; no network arm (丙).
 * Red today (7c862a02): neither export exists; green when K3L-6 §2.1/§2.2 lands. Named mutations (none shown today):
 * ① a check left out -> its refused cell reads null; ② autonomy (R6) or the streak (R7) not read -> 'adviser'; the
 * adviser fact not read -> 'adviser' for the no-adviser cell.
 */
import { describe, expect, it } from 'vitest';
import { commandRerunAdviceProblem } from '../../src/contracts/command-rerun-advice.js';
import { commandRerunAdviserStageOf } from '../../src/core/work-graph/state/command-rerun-request.js';

const allow = { choice: 'allow_rerun', escalationKind: null, rationale: 'r', plain: 'p' } as const;

describe('R12 the adviser\'s rerun advice: one closed shape', () => {
  it.each([
    ['allow_rerun', allow, true],
    ['deny', { ...allow, choice: 'deny' }, true],
    ['escalate with its kind', { ...allow, choice: 'escalate', escalationKind: 'requirement' }, true],
    ['deny_final', { ...allow, choice: 'deny_final' }, false],
    ['safer_method', { ...allow, choice: 'safer_method' }, false],
    ['escalate without its kind', { ...allow, choice: 'escalate' }, false],
    ['no plain', { choice: 'allow_rerun', escalationKind: null, rationale: 'r' }, false],
    ['an extra member', { ...allow, phase: 'disposition' }, false],
  ] as const)('%s', (_case, value, accepted) => {
    expect(commandRerunAdviceProblem(value) === null).toBe(accepted);
  });
});

describe('R6/R7 commandRerunAdviserStageOf: who decides a rerun first', () => {
  const streak = { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null };
  it.each([
    ['after plan confirmation, the first time', 'after_plan_confirmation', streak, true, 'adviser'],
    ['ruling 1 no adviser line', 'after_plan_confirmation', streak, false, 'no_adviser'],
    ['R6 every step confirmed', 'every_step', streak, true, 'person'],
    ['R7 the second consecutive unknown process', 'after_plan_confirmation', { ...streak, priorUnknownProcess: true }, true,
      'person'],
    ['R7 the adviser\'s disposition interrupted again', 'after_plan_confirmation', { ...streak, priorAdvised: true }, true,
      'person'],
  ] as const)('%s', (_case, autonomy, value, adviserAvailable, stage) => {
    expect(commandRerunAdviserStageOf({ autonomy, streak: value, adviserAvailable })).toBe(stage);
  });
});
