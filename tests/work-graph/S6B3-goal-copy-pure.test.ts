/**
 * Copying a cancelled Goal: the pure decision.
 *
 * A pure file: the facts are hand-built literals because this is the rule
 * itself; nothing is committed, and every expected value comes from the copy
 * rules or a hand-computed example.
 */
import { describe, expect, it } from 'vitest';
import type {
  GoalCopyConfirmInputV1, GoalCopyDraftInputV1, GoalCopyFactsV1, GoalUnderstandingPinV1,
} from '../../src/contracts/goal-card.js';
import type { GoalSettingsV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { decideGoalCopy, planReanchorHook } from '../../src/core/work-graph/state/goal-copy.js';
import { isLegalSettings } from '../../src/core/work-graph/state/goal-settings-machine.js';

const GOAL: GoalRef = { aggregateType: 'Goal', projectId: 'p1', goalId: 'g-source' };
const SOURCE: GoalSnapshot = {
  ref: GOAL, workspaceRef: { aggregateType: 'Workspace', projectId: 'p1', workspaceId: 'w1' },
  objective: 'Ship the reader.', desiredState: 'cancelled', desiredStateRevision: 2,
  desiredStateRequestedBy: null, activePlanRevision: null, revision: 7,
  settings: {
    schemaVersion: 1, autonomy: 'every_step', order: 3,
    waitForGoalRef: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g-wait' },
    parallelRisks: [{
      otherGoalRef: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g-risk' }, selfPlanRef: null, otherPlanRef: null,
    }],
  },
  continuedFrom: null, copiedInterventions: [], since: 'c0000000007' as GoalSnapshot['since'],
};

const NOTE_PIN: GoalUnderstandingPinV1 = {
  pointer: { refKey: 'pointer-1', revision: 9, noteId: 'note-1' }, head: { refKey: 'head-1', version: 4 },
  note: { noteId: 'note-1', version: 4 },
};
const PINS: { name: string; pin: GoalUnderstandingPinV1 }[] = [
  { name: 'a missing pointer',
    pin: { pointer: { refKey: 'pointer-1', revision: null, noteId: null }, head: null, note: null } },
  { name: 'an existing but empty pointer',
    pin: { pointer: { refKey: 'pointer-1', revision: 9, noteId: null }, head: null, note: null } },
];

const MESSAGE: SessionMessageRef = {
  aggregateType: 'SessionMessage', projectId: 'p1', workspaceId: 'w1', messageId: 'msg-1',
};
/** The same ref written in another key order: only canonical JSON equality may accept it. */
const MESSAGE_REORDERED: SessionMessageRef = {
  messageId: 'msg-1', workspaceId: 'w1', projectId: 'p1', aggregateType: 'SessionMessage',
};

function facts(overrides: Partial<GoalCopyFactsV1> = {}): GoalCopyFactsV1 {
  return { source: SOURCE, understanding: NOTE_PIN, selected: [], intervened: [], ...overrides };
}

function confirm(overrides: Partial<GoalCopyConfirmInputV1> = {}): GoalCopyConfirmInputV1 {
  return { commandId: 'cmd-copy', sourceGoalRef: GOAL, expectedSourceRevision: SOURCE.revision,
    selectedInterventions: [], ...overrides };
}

/** The one create decision both the draft and confirm paths must produce for an empty selection. */
const CREATED = {
  outcome: 'create' as const, objective: 'Ship the reader.',
  settings: { schemaVersion: 1 as const, autonomy: 'every_step' as const, order: 3, waitForGoalRef: null, parallelRisks: [] },
  continuedFrom: { goal: GOAL, sourceRevision: 7, understanding: { noteId: 'note-1', version: 4 } },
  copiedInterventions: [],
};

describe('rejects: the copy source is not cancelled', () => {
  it.each(['active', 'paused'] as const)('refuses a %s source', (desiredState) => {
    expect(decideGoalCopy(facts({ source: { ...SOURCE, desiredState } }), { goalRef: GOAL })).toMatchObject({
      outcome: 'refuse', code: 'invalid', reason: expect.stringContaining('cancelled'),
    });
  });
});

describe('rejects: the source revision moved', () => {
  it('refuses a confirm whose expected source revision is stale and creates nothing', () => {
    expect(decideGoalCopy(facts(), confirm({ expectedSourceRevision: 8 }))).toEqual({
      outcome: 'refuse',
      code: 'revision_conflict',
      reason: 'the source Goal revision changed since it was read',
    });
  });
});

describe('create: a cancelled source with an empty verified selection', () => {
  it.each([
    { name: 'confirm', input: () => confirm() },
    { name: 'draft', input: (): GoalCopyDraftInputV1 => ({ goalRef: GOAL }) },
  ])('creates a selection_only Goal from a $name input', ({ input }) => {
    expect(decideGoalCopy(facts(), input())).toEqual({ ...CREATED, selection: 'selection_only' });
  });
});

describe('continuedFrom: understanding is null without a note', () => {
  it.each(PINS)('creates with understanding null for $name', ({ pin }) => {
    expect(decideGoalCopy(facts({ understanding: pin }), confirm())).toEqual({
      ...CREATED,
      continuedFrom: { goal: GOAL, sourceRevision: 7, understanding: null },
      selection: 'selection_only',
    });
  });
});

const UNVERIFIABLE: { name: string; facts: GoalCopyFactsV1; selection: SessionMessageRef[] }[] = [
  { name: 'a non-empty selection with no candidate facts', facts: facts({ selected: [] }), selection: [MESSAGE] },
  { name: 'a candidate that is not selectable', selection: [MESSAGE],
    facts: facts({
      selected: [{ messageRef: MESSAGE, version: 2, selectable: false, reason: 'already copied' }],
    }) },
  { name: 'a ref already in the intervened set', selection: [MESSAGE_REORDERED],
    facts: facts({ selected: [{ messageRef: MESSAGE, version: 2, selectable: true, reason: null }],
      intervened: [MESSAGE_REORDERED] }) },
];

describe('rejects: a selection the owner cannot verify', () => {
  it.each(UNVERIFIABLE)('refuses $name', ({ facts: caseFacts, selection }) => {
    expect(decideGoalCopy(caseFacts, confirm({ selectedInterventions: selection }))).toMatchObject({
      outcome: 'refuse', code: 'invalid', reason: expect.stringContaining('cannot verify'),
    });
  });
});

describe('create: a verified non-empty selection is retraction_pending', () => {
  it('accepts a selectable, not-yet-intervened candidate by canonical ref equality', () => {
    const decision = decideGoalCopy(
      facts({ selected: [{ messageRef: MESSAGE, version: 2, selectable: true, reason: null }] }),
      confirm({ selectedInterventions: [MESSAGE_REORDERED] }),
    );
    expect(decision).toEqual({ ...CREATED, selection: 'retraction_pending' });
  });
});

describe('planReanchorHook', () => {
  it('returns the named 7D1 stub, no receipt and no fact', () => {
    expect(planReanchorHook()).toEqual({ status: 'not_implemented', reason: 'planReanchor is 7D1' });
  });
});

describe('isLegalSettings: the exported Goal settings check', () => {
  const LEGAL: GoalSettingsV1 = {
    schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 0, waitForGoalRef: null, parallelRisks: [],
  };

  it('accepts a legal literal', () => {
    expect(isLegalSettings(LEGAL)).toBe(true);
  });

  it.each([
    { name: 'a wrong schemaVersion', value: { ...LEGAL, schemaVersion: 2 } },
    { name: 'a wrong autonomy', value: { ...LEGAL, autonomy: 'always' } },
    { name: 'a negative order', value: { ...LEGAL, order: -1 } },
    { name: 'a non-integer order', value: { ...LEGAL, order: 1.5 } },
    { name: 'a malformed parallelRisks entry',
      value: { ...LEGAL, parallelRisks: [{ otherGoalRef: null, selfPlanRef: null, otherPlanRef: null }] } },
  ])('refuses $name', ({ value }) => {
    expect(isLegalSettings(value)).toBe(false);
  });
});
