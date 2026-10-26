/** A5: the moved grant branch, one pure table over the scope rule; expected values are the rule's refusal details. */
import { describe, expect, it } from 'vitest';
import {
  secretaryNoteScope, type SecretaryNoteScopeFactsV1,
} from '../../src/core/work-graph/state/note-machine.js';

const EFFECTIVE = 'goal-effective';
const GRANTED = 'goal-granted';
const OUTSIDE = 'goal-outside';

type Expected = { storedGoalId: string | null }
  | { ok: false; reason: 'guard_failed'; code: 'forbidden'; detail: string };

const refusedScope = (): Expected => ({ ok: false, reason: 'guard_failed', code: 'forbidden', detail: 'anchor_out_of_goal' });
const stored = (storedGoalId: string): Expected => ({ storedGoalId });

const understanding = (over: Partial<SecretaryNoteScopeFactsV1> = {}): SecretaryNoteScopeFactsV1 => ({
  kind: 'understanding', target: 'goal', anchorGoalIds: [], mainAnchorGoalId: null, effectiveGoalId: EFFECTIVE,
  grantedGoalIds: [], ...over,
});

const cases: { name: string; facts: SecretaryNoteScopeFactsV1; expected: Expected }[] = [
  { name: 'a live grant on another goal admits exactly that goal', expected: stored(GRANTED),
    facts: understanding({ anchorGoalIds: [GRANTED], mainAnchorGoalId: GRANTED, grantedGoalIds: [GRANTED] }) },
  { name: 'the same goal without the live grant is refused', expected: refusedScope(),
    facts: understanding({ anchorGoalIds: [GRANTED], mainAnchorGoalId: GRANTED, grantedGoalIds: [] }) },
  { name: 'a stage anchor on the granted but not effective goal is refused', expected: refusedScope(),
    facts: understanding({ target: 'stage', anchorGoalIds: [GRANTED], mainAnchorGoalId: GRANTED,
      grantedGoalIds: [GRANTED] }) },
  { name: 'a stage anchor on the effective goal stores the effective goal', expected: stored(EFFECTIVE),
    facts: understanding({ target: 'stage', anchorGoalIds: [EFFECTIVE], mainAnchorGoalId: EFFECTIVE,
      grantedGoalIds: [GRANTED] }) },
  { name: 'a granted goal with an anchor outside it is refused', expected: refusedScope(),
    facts: understanding({ anchorGoalIds: [GRANTED, OUTSIDE], mainAnchorGoalId: GRANTED,
      grantedGoalIds: [GRANTED] }) },
];

describe('the moved secretary grant branch (pure)', () => {
  it.each(cases)('$name', ({ facts, expected }) => {
    expect(secretaryNoteScope(facts)).toEqual(expected);
  });
});
