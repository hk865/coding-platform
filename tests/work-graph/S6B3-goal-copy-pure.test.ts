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
import type { GoalRef, GoalSnapshot, PendingGoalSnapshot } from '../../src/contracts/ledger.js';
import type { CopyInterventionCandidateV1 } from '../../src/contracts/goal-copy-retraction.js';
import type { SessionWorkLinkRef } from '../../src/contracts/core/identity.js';
import type { SessionRecord, SessionWorkLink } from '../../src/contracts/core/session.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import {
  decideGoalCopy, planReanchorHook, type PlanReanchorHookInputV1,
} from '../../src/core/work-graph/state/goal-copy.js';
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
const MESSAGE_B: SessionMessageRef = {
  aggregateType: 'SessionMessage', projectId: 'p1', workspaceId: 'w1', messageId: 'msg-2',
};

/** A not-delivered candidate: selectable and retractable, with neither reason set. */
const notDelivered = (messageRef: SessionMessageRef): CopyInterventionCandidateV1 => ({
  messageRef, version: 2, state: 'not_delivered', selectable: true, reason: null,
  retractable: true, retractReason: null });
const CANDIDATE_A = notDelivered(MESSAGE);
const CANDIDATE_B = notDelivered(MESSAGE_B);

function facts(overrides: Partial<GoalCopyFactsV1> = {}): GoalCopyFactsV1 {
  return { source: SOURCE, understanding: NOTE_PIN, selected: [], ...overrides };
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
  retract: [],
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
    facts: facts({ selected: [{ messageRef: MESSAGE, version: 2, state: 'copied', selectable: false,
      reason: 'copied', retractable: false, retractReason: 'copied' }] }) },
];

describe('rejects: a selection the owner cannot verify', () => {
  it.each(UNVERIFIABLE)('refuses $name', ({ facts: caseFacts, selection }) => {
    expect(decideGoalCopy(caseFacts, confirm({ selectedInterventions: selection }))).toMatchObject({
      outcome: 'refuse', code: 'invalid', reason: expect.stringContaining('cannot verify'),
    });
  });
});

const INVALID: { name: string; facts: GoalCopyFactsV1; selection: SessionMessageRef[]; reason: string }[] = [
  { name: 'the same ref selected twice in another key order', selection: [MESSAGE, MESSAGE_REORDERED],
    facts: facts({ selected: [CANDIDATE_A, CANDIDATE_B] }), reason: 'a selected intervention is listed twice' },
];

describe('rejects: an invalid selection', () => {
  it.each(INVALID)('refuses $name', ({ facts: caseFacts, selection, reason }) => {
    expect(decideGoalCopy(caseFacts, confirm({ selectedInterventions: selection })))
      .toEqual({ outcome: 'refuse', code: 'invalid', reason });
  });
});

const VERIFIED: { name: string; selection: SessionMessageRef[]; copied: SessionMessageRef[];
  retract: SessionMessageRef[]; selectionState: 'selection_only' | 'retraction_pending' }[] = [
  { name: 'A, written in another key order', selection: [MESSAGE_REORDERED],
    copied: [MESSAGE], retract: [MESSAGE_B], selectionState: 'retraction_pending' },
  { name: 'A and B', selection: [MESSAGE, MESSAGE_B],
    copied: [MESSAGE, MESSAGE_B], retract: [], selectionState: 'selection_only' },
];

describe('create: a verified selection decides the copied and retracted sets', () => {
  it.each(VERIFIED)('creates from $name', ({ selection, copied, retract, selectionState }) => {
    expect(decideGoalCopy(facts({ selected: [CANDIDATE_A, CANDIDATE_B] }),
      confirm({ selectedInterventions: selection })))
      .toEqual({ ...CREATED, copiedInterventions: copied, retract, selection: selectionState });
  });
});

describe('planReanchorHook', () => {
  // One adviser line s1 holds the cancelled source; the copy moves its responsible link onto the new Goal, which
  // exists only as the birth commit's pending snapshot.
  const NEW_GOAL: GoalRef = { aggregateType: 'Goal', projectId: 'p1', goalId: 'g-copy' };
  const BIRTH: PendingGoalSnapshot = {
    ...SOURCE, ref: NEW_GOAL, desiredState: 'active', desiredStateRevision: 1, revision: 1, since: null,
  };
  const ADVISER: SessionRecord = {
    ref: { aggregateType: 'Session', projectId: 'p1', sessionId: 's1' }, revision: 4,
    kernel: { adapterId: 'coding-agent', kernelSessionId: 'k-1' }, lifecycle: 'active', health: 'available',
    healthConclusion: null, role: { kind: 'legacy_template', templateId: 'tpl', templateRevision: 'r1' },
    workspaceId: 'w1', lastExecutionRef: null, occupancy: null, historyCursor: null,
    createdAt: '2026-11-01T00:00:00.000Z', archivedAt: null, provenance: { schemaVersion: 1, kind: 'new' },
    archiveRequest: null, unavailableSince: null,
  };
  const SOURCE_LINK: SessionWorkLink = {
    ref: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1',
      target: { kind: 'goal', ref: GOAL }, relation: 'responsible' },
    revision: 2, since: 'c0000000003' as SessionWorkLink['since'], until: null,
  };
  const DESTINATION: SessionWorkLinkRef = {
    aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1',
    target: { kind: 'goal', ref: NEW_GOAL }, relation: 'responsible',
  };
  const INPUT: PlanReanchorHookInputV1 = {
    projectRef: { projectId: 'p1' }, duty: 'adviser',
    moves: [{ duty: 'adviser', source: SOURCE_LINK.ref,
      destinations: [{ link: DESTINATION, target: { kind: 'goal', ref: NEW_GOAL } }] }],
    facts: {
      sessions: new Map([['s1', ADVISER]]),
      links: new Map([[canonicalKey(SOURCE_LINK.ref), SOURCE_LINK]]),
      goals: new Map([['g-source', { state: 'present', ref: GOAL, snapshot: SOURCE, version: { ref: GOAL, revision: 7 } }]]),
      catalog: { state: 'none', revision: 0 },
    },
    authorization: { actor: { kind: 'human', id: 'person-1' }, scope: [{ kind: 'project' }] },
    proposed: { goal: { ref: NEW_GOAL, snapshot: BIRTH, version: { ref: NEW_GOAL, revision: 1 } } },
  };

  it('moves the one adviser link onto the proposed new Goal: no receipt, every piece of the plan', () => {
    expect(planReanchorHook(INPUT)).toEqual({ ok: true, plan: {
      // The one Session is written once, one revision up.
      sessions: [{ ...ADVISER, revision: 5 }],
      // The source link closes one revision up with its `until` left to bind; the absent destination opens at 1.
      links: [
        { link: SOURCE_LINK.ref, next: { ref: SOURCE_LINK.ref, revision: 3, since: 'c0000000003', until: null } },
        { link: DESTINATION, next: { ref: DESTINATION, revision: 1, since: null, until: null } },
      ],
      claimChanges: [
        { duty: 'adviser', target: { kind: 'goal', goalRef: GOAL }, expectedOwner: SOURCE_LINK.ref, nextOwner: null },
        { duty: 'adviser', target: { kind: 'goal', goalRef: NEW_GOAL }, expectedOwner: null, nextOwner: DESTINATION },
      ],
      bindings: [{ link: SOURCE_LINK.ref, field: 'until' }, { link: DESTINATION, field: 'since' }],
      events: [{ closed: SOURCE_LINK.ref, opened: DESTINATION, openedBound: 'since' }],
    } });
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
