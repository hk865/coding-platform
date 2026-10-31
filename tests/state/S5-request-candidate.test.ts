/**
 * Slice 5 unit rows PC01..PC10
 * (docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md §5.2).
 *
 * Exercises `transitionPlanProposal` with the request-slot events,
 * `derivePlanProposalStatus` for the derived stale read and the pure
 * `derivePlanProposalReadVerdict` (A4) for the closed/goal_cancelled read.
 * Pure: no RecordStore, no clock. The part-2 behaviours behind the new
 * `proposal_replaced`/`proposal_adopted`/`proposal_abandoned` events are still
 * stubs in part 1. Request-head setup first exposes the missing requestRef /
 * slot effect in proposal_recorded; after that is implemented the rows reach
 * their named transition. Independent Host recording/read behaviour already exists.
 */
import { describe, expect, it } from 'vitest';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { validatePlanDraft, validatePlanAssignments, planPhaseGuardReasons } from '../../src/core/work-graph/tasks/plan-validation.js';
import {
  derivePlanProposalReadVerdict,
  derivePlanProposalStatus,
  transitionPlanProposal,
  type CandidatePlanProposal,
  type FutureAdoptionFacts,
  type PlanChangeReason,
  type PlanProposalEvent,
  type PlanProposalGuardContext,
  type PlanProposalEffect,
  type PlanCommitGuard,
  type PlanProposalRef,
  type PlanRequestCandidateFacts,
  type PlanSourceFacts,
} from '../../src/core/work-graph/state/plan-machine.js';

// -------------------------------------------------------------------------- //
// §5.1 fixed fixture                                                        //
// -------------------------------------------------------------------------- //

const PROJECT = 'P';
const WORKSPACE = 'W';
const GOAL_B: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'B' };
const OPERATOR = { kind: 'human', id: 'operator' } as const;
const T = '2026-10-08T00:00:00.000Z';

const planRef = (planId: string): PlanRevisionRef => ({ aggregateType: 'PlanRevision', projectId: PROJECT, planId });
const PB0 = planRef('PB0');
const PB1 = planRef('PB1');
const PB2 = planRef('PB2');

const proposalRef = (proposalId: string): PlanProposalRef => ({ aggregateType: 'PlanProposal', projectId: PROJECT, workspaceId: WORKSPACE, proposalId });
const U1 = proposalRef('U1');
const U2 = proposalRef('U2');
const U3 = proposalRef('U3');

const queryJobRef = (queryJobId: string): QueryJobRef => ({ aggregateType: 'QueryJob', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId });
const Q1 = queryJobRef('Q1');
const Q2 = queryJobRef('Q2');

const REASON: PlanChangeReason = { text: 'the first user request candidate', sources: [] };
const PIN: ArchitectureCatalogPinV1 = {
  catalogRef: { aggregateType: 'ArchitectureCatalog', projectId: PROJECT, baselineId: 'baseline-1', revision: 1 },
  baseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: PROJECT, baselineId: 'baseline-1', revision: 1 },
    digest: '0123456789abcdef'.repeat(4) },
};

function draftOf(planId: string, planRevision: number): PlanRevisionDraft {
  return {
    schemaVersion: 2,
    planId,
    planRevision,
    goalId: GOAL_B.goalId,
    stages: [],
    tasks: [{ taskId: 'future-B', title: 'Future work for B', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' }],
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  };
}

type RecordedEvent = Extract<PlanProposalEvent, { type: 'proposal_recorded' }>;
type ReplacedEvent = Extract<PlanProposalEvent, { type: 'proposal_replaced' }>;
type AdoptedEvent = Extract<PlanProposalEvent, { type: 'proposal_adopted' }>;
type AbandonedEvent = Extract<PlanProposalEvent, { type: 'proposal_abandoned' }>;
type ReadEvent = Extract<PlanProposalEvent, { type: 'proposal_read' }>;

/** Expected snapshot, used only on the assertion side. */
function expectedCandidate(
  ref: PlanProposalRef, basedOn: PlanRevisionRef | null, planId: string, planRevision: number,
  requestRef: QueryJobRef | null = null,
): CandidatePlanProposal {
  return { kind: 'candidate_v2', schemaVersion: 2, ref, revision: 1,
    goalRef: GOAL_B, basedOn, draft: draftOf(planId, planRevision), reason: REASON,
    issues: [], catalogPin: PIN, status: 'candidate', sourceMessageRef: null,
    ...(requestRef === null ? {} : { requestRef }) };
}

const guard = (value: PlanCommitGuard): PlanProposalEffect => ({ kind: 'guard', guard: value });
const SCOPE_GUARDS = [guard({ target: 'project' }), guard({ target: 'workspace' }), guard({ target: 'goal' })];
const RECORDED_EFFECTS: PlanProposalEffect[] = [
  { kind: 'write_proposal' }, { kind: 'append_event', eventType: 'PlanProposalRecorded' },
  ...SCOPE_GUARDS, guard({ target: 'proposal', expectedRevision: null }),
];

/** Order is not specified for the new effects; compare the complete multiset, including duplicates. */
function expectEffects(actual: readonly PlanProposalEffect[], expected: readonly PlanProposalEffect[]) {
  const sorted = (effects: readonly PlanProposalEffect[]) => [...effects].sort((a, b) =>
    canonicalJson(a as JsonValue).localeCompare(canonicalJson(b as JsonValue)));
  expect(sorted(actual)).toEqual(sorted(expected));
}

/** S5's new replace/abandon rows specify writes/events/claims, not an exact read-guard list. */
function expectRequestWriteEffects(actual: readonly PlanProposalEffect[], writes: readonly PlanProposalEffect[],
  requiredGuards: readonly PlanProposalEffect[]) {
  expectEffects(actual.filter((effect) => effect.kind !== 'guard'), writes);
  expect(actual.filter((effect) => effect.kind === 'guard')).toEqual(expect.arrayContaining([...requiredGuards]));
}

function slot(requestRef: QueryJobRef, expectedOwner: PlanProposalRef | null, nextOwner: PlanProposalRef | null): PlanProposalEffect {
  return { kind: 'request_slot', goalRef: GOAL_B, requestRef, expectedOwner, nextOwner };
}

/** Produce each request head through S5-PLAN-01; never graft requestRef onto a record. */
function candidate(
  ref: PlanProposalRef, basedOn: PlanRevisionRef | null, planId: string, planRevision: number,
  requestRef: QueryJobRef | null = null,
): CandidatePlanProposal {
  const result = transitionPlanProposal(null, recordedEvent(ref, basedOn, planId, planRevision,
    requestRef === null ? {} : { requestRef, replaces: null }), context({
      requestCandidate: requestRef === null ? null : requestFacts({ basedOnIsActivePointer: basedOn?.planId === PB1.planId }),
    }));
  expect(result).toMatchObject({ ok: true });
  if (!result.ok || result.next === null || result.next.kind !== 'candidate_v2') throw new Error('candidate recording must succeed');
  expect(result.next).toEqual(expectedCandidate(ref, basedOn, planId, planRevision, requestRef));
  expectEffects(result.effects, [...RECORDED_EFFECTS, ...(requestRef === null ? [] : [slot(requestRef, null, ref)])]);
  return result.next;
}

function requestFacts(overrides: Partial<PlanRequestCandidateFacts> = {}): PlanRequestCandidateFacts {
  return {
    requestRootSameGoal: true,
    replacesIsNull: true,
    slotExpectedOwnerIsNull: true,
    headMatches: true,
    headRevisionMatches: true,
    requestGoalMatches: true,
    replacesComplete: true,
    firstPlanUserOnly: true,
    slotOwnerMatches: true,
    basedOnIsActivePointer: true,
    operatorMatches: true,
    headPinMatches: true,
    goalNotCancelled: true,
    storedTerminalStatus: false,
    goalCancelled: false,
    basedOnDerivesStale: false,
    adoptionPolicy: null,
    ...overrides,
  };
}

function context(overrides: Partial<PlanProposalGuardContext> = {}): PlanProposalGuardContext {
  return {
    goal: { activePlanRevision: PB1, desiredState: 'active' },
    goalInWorkspace: true,
    pinsAgree: true,
    agentAdmission: null,
    source: null,
    modules: 'ok',
    initial: null,
    future: null,
    requestCandidate: requestFacts(),
    ...overrides,
  };
}

function recordedEvent(
  ref: PlanProposalRef, basedOn: PlanRevisionRef | null, planId: string, planRevision: number,
  association: { requestRef?: QueryJobRef | null; replaces?: { proposalRef: PlanProposalRef; revision: number } | null } = {},
): RecordedEvent {
  const draft = draftOf(planId, planRevision);
  const issues = validatePlanDraft(draft, null);
  expect(issues).toEqual([]);
  return {
    type: 'proposal_recorded', writer: 'host', ref, goalRef: GOAL_B, basedOn,
    draft, reason: REASON, issues, catalogPin: PIN, submittedBy: null, sourceMessageRef: null,
    ...association,
  };
}

const SOURCE_B1: PlanSourceFacts = { ref: PB1, goalRef: GOAL_B, planId: 'PB1', planRevision: 1 };

/** PLAN-05: PB1 and the candidate retain the same legal plan_only task; only the Plan identity changes. */
const FUTURE_OK: FutureAdoptionFacts = {
  modules: 'ok',
  draftIssues: validatePlanDraft(draftOf('PB2', 2), null),
  assignmentReasons: validatePlanAssignments(draftOf('PB2', 2)),
  phaseReasons: planPhaseGuardReasons(draftOf('PB2', 2).tasks),
  targetExists: false,
  delta: {
    status: 'supported', changedTaskIds: [], addedTaskIds: [], dispositionOnlyTaskIds: [],
    dispositionChanges: [], carrierRemovals: [],
  },
  coverage: { status: 'supported' },
  pinnedPolicy: 'not_needed',
  touchedTaskFacts: [],
  adopterClass: 'human',
  dispositionTaskFacts: [],
  sourceCarriers: { tasks: draftOf('PB1', 1).tasks, obligations: [] },
  carrierFacts: [],
};

// -------------------------------------------------------------------------- //
// PC01..PC10                                                                 //
// -------------------------------------------------------------------------- //

describe('S5 request candidate unit rows (§5.2 PC01..PC10)', () => {
  it('PC01 a new U1 on an empty Q1 slot records candidate@1 and claims the slot', () => {
    const result = transitionPlanProposal(null, recordedEvent(U1, PB1, 'u1-plan', 2, { requestRef: Q1, replaces: null }), context());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('the empty Q1 slot must accept U1');
    expect(result.next).toEqual(expectedCandidate(U1, PB1, 'u1-plan', 2, Q1));
    expectEffects(result.effects, [...RECORDED_EFFECTS, slot(Q1, null, U1)]);
  });

  it('PC02 replacing the Q1 head marks U1 not_adopted and records U3 candidate@1', () => {
    const head = candidate(U1, PB1, 'u1-plan', 2, Q1);
    const event: ReplacedEvent = {
      type: 'proposal_replaced', writer: 'host', ref: U3, goalRef: GOAL_B, basedOn: PB1,
      draft: draftOf('u3-plan', 2), reason: REASON, issues: [], catalogPin: PIN, submittedBy: null,
      sourceMessageRef: null, expectedHeadRevision: 1, head: { proposalRef: U1, revision: 1 },
      replaces: { proposalRef: U1, revision: 1 }, requestRef: Q1,
      requestedBy: OPERATOR, at: T,
    };
    const before = structuredClone(head);
    const result = transitionPlanProposal(head, event, context({ requestCandidate: requestFacts({
      replacesIsNull: false, slotExpectedOwnerIsNull: false,
    }) }));
    // The request slot moves to U3: the new head owns Q1 (the old head's
    // not_adopted@2 write is named to the owner by this same transition).
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('Q1 replacement must succeed');
    expect(result.next).toEqual(expectedCandidate(U3, PB1, 'u3-plan', 2, Q1));
    expectRequestWriteEffects(result.effects, [
      { kind: 'write_proposal' }, { kind: 'append_event', eventType: 'PlanProposalRecorded' },
      { kind: 'write_replaced_proposal', record: { ...before, revision: 2, status: 'not_adopted',
        notAdopted: { reason: 'replaced', requestedBy: OPERATOR, at: T, replacedBy: U3 } } },
      { kind: 'append_event', eventType: 'PlanProposalRecorded' },
      slot(Q1, U1, U3),
    ], [guard({ target: 'goal' }), guard({ target: 'proposal', expectedRevision: 1 }),
      guard({ target: 'proposal', expectedRevision: null })]);
    expect(head).toEqual(before);
  });

  it('PC03 replacing at head revision 0 is a revision_conflict and constructs no U3', () => {
    const head = candidate(U1, PB1, 'u1-plan', 2, Q1);
    const event: ReplacedEvent = {
      type: 'proposal_replaced', writer: 'host', ref: U3, goalRef: GOAL_B, basedOn: PB1,
      draft: draftOf('u3-plan', 2), reason: REASON, issues: [], catalogPin: PIN, submittedBy: null,
      sourceMessageRef: null, expectedHeadRevision: 0, head: { proposalRef: U1, revision: 1 },
      replaces: { proposalRef: U1, revision: 1 }, requestRef: Q1,
      requestedBy: OPERATOR, at: T,
    };
    const before = structuredClone(head);
    const result = transitionPlanProposal(head, event, context({ requestCandidate: requestFacts({
      headRevisionMatches: false, replacesIsNull: false, slotExpectedOwnerIsNull: false,
    }) }));
    expect(result).toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict' });
    expect('next' in result).toBe(false);
    expect(result).not.toHaveProperty('effects');
    expect(head).toEqual(before);
  });

  it('PC04 a replaces pointing at the Q2 U2 candidate is invalid', () => {
    const head = candidate(U1, PB1, 'u1-plan', 2, Q1);
    const other = candidate(U2, PB1, 'u2-plan', 2, Q2);
    const event: ReplacedEvent = {
      type: 'proposal_replaced', writer: 'host', ref: U3, goalRef: GOAL_B, basedOn: PB1,
      draft: draftOf('u3-plan', 2), reason: REASON, issues: [], catalogPin: PIN, submittedBy: null,
      sourceMessageRef: null, expectedHeadRevision: 1, head: { proposalRef: U1, revision: 1 },
      replaces: { proposalRef: other.ref, revision: other.revision }, requestRef: Q1,
      requestedBy: OPERATOR, at: T,
    };
    const before = structuredClone([head, other]);
    const result = transitionPlanProposal(head, event, context({ requestCandidate: requestFacts({
      replacesIsNull: false, slotExpectedOwnerIsNull: false,
      requestGoalMatches: false, replacesComplete: true,
    }) }));
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect(result).not.toHaveProperty('next');
    expect(result).not.toHaveProperty('effects');
    expect([head, other]).toEqual(before);
  });

  it('PC05 a Host draft based on an old plan is recordable and then reads stale', () => {
    const result = transitionPlanProposal(null, recordedEvent(U1, PB0, 'u1-plan', 2), context({ requestCandidate: null }));
    expect(result).toEqual({ ok: true, next: expectedCandidate(U1, PB0, 'u1-plan', 2), effects: RECORDED_EFFECTS });
    if (!result.ok || result.next === null) throw new Error('a stale Host draft must remain recordable');
    expect(derivePlanProposalStatus(result.next, PB1)).toBe('stale');
  });

  it('PC06 adopting U1 onto PB2 accepts it and derives a PB1-based U2 stale', () => {
    const u1 = candidate(U1, PB1, PB2.planId, 2, Q1);
    const u2 = candidate(U2, PB1, 'u2-plan', 2, Q2);
    const u2Before = structuredClone(u2);
    const event: AdoptedEvent = {
      type: 'proposal_adopted', adopter: 'host', proposalRef: U1, expectedProposalRevision: 1,
      decisionRefs: [], agentWriter: null, requestRef: Q1,
    };
    const result = transitionPlanProposal(u1, event, context({ source: SOURCE_B1, future: FUTURE_OK,
      requestCandidate: requestFacts({ slotExpectedOwnerIsNull: false }) }));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('U1 adoption must succeed');
    expect(result.next).toEqual({ ...expectedCandidate(U1, PB1, PB2.planId, 2, Q1), revision: 2, status: 'accepted' });
    expectEffects(result.effects, [
      { kind: 'write_proposal' },
      { kind: 'write_plan_revision', ref: PB2, build: { from: 'future_delta', source: PB1,
        changedTaskIds: [], addedTaskIds: [], dispositionOnlyTaskIds: [] } },
      { kind: 'move_goal_pointer', from: PB1, to: PB2 },
      { kind: 'append_event', eventType: 'PlanRevisionAccepted' },
      ...SCOPE_GUARDS, guard({ target: 'proposal', expectedRevision: 1 }),
      guard({ target: 'plan_revision', ref: PB1, expectedRevision: 1 }),
      guard({ target: 'plan_revision', ref: PB2, expectedRevision: null }), slot(Q1, U1, null),
    ]);
    const moved = result.effects.find((effect) => effect.kind === 'move_goal_pointer');
    if (moved?.kind !== 'move_goal_pointer') throw new Error('adoption must name the new Goal pointer');
    expect(derivePlanProposalStatus(u2, moved.to)).toBe('stale');
    expect(u2).toEqual(u2Before);
    expect(u2).toEqual(expectedCandidate(U2, PB1, 'u2-plan', 2, Q2));
  });

  it('PC07 adopting the stale U2 candidate is a revision_conflict', () => {
    const u2 = candidate(U2, PB1, 'u2-plan', 2, Q2);
    const before = structuredClone(u2);
    const event: AdoptedEvent = {
      type: 'proposal_adopted', adopter: 'host', proposalRef: U2, expectedProposalRevision: 1,
      decisionRefs: [], agentWriter: null, requestRef: Q2,
    };
    const result = transitionPlanProposal(u2, event, context({
      goal: { activePlanRevision: PB2, desiredState: 'active' },
      source: SOURCE_B1,
      future: FUTURE_OK,
      requestCandidate: requestFacts({ basedOnIsActivePointer: false, basedOnDerivesStale: true, slotExpectedOwnerIsNull: false }),
    }));
    expect(result).toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict' });
    expect(result).not.toHaveProperty('next');
    expect(result).not.toHaveProperty('effects');
    expect(u2).toEqual(before);
  });

  it('PC08 abandoning the stale U2 marks not_adopted@2 abandoned without an abandoned status', () => {
    const u2 = candidate(U2, PB1, 'u2-plan', 2, Q2);
    expect(derivePlanProposalStatus(u2, PB2)).toBe('stale');
    const event: AbandonedEvent = { type: 'proposal_abandoned', proposalRef: U2, expectedProposalRevision: 1, requestRef: Q2,
      requestedBy: OPERATOR, at: T };
    const before = structuredClone(u2);
    const result = transitionPlanProposal(u2, event, context({ goal: { activePlanRevision: PB2, desiredState: 'active' },
      requestCandidate: requestFacts({ basedOnIsActivePointer: false, basedOnDerivesStale: true, slotExpectedOwnerIsNull: false }) }));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('a stale head may be abandoned');
    expect(result.next).toEqual({ ...before, revision: 2, status: 'not_adopted',
      notAdopted: { reason: 'abandoned', requestedBy: OPERATOR, at: T, replacedBy: null } });
    expectRequestWriteEffects(result.effects, [
      { kind: 'write_proposal' }, { kind: 'append_event', eventType: 'PlanProposalRecorded' },
      slot(Q2, U2, null),
    ], [guard({ target: 'goal' }), guard({ target: 'proposal', expectedRevision: 1 })]);
    expect(u2).toEqual(before);
  });

  it('PC09 two candidates with a null requestRef are independent and take no request slot', () => {
    const first = transitionPlanProposal(null, recordedEvent(U1, null, 'u1-plan', 1), context({ requestCandidate: null }));
    const second = transitionPlanProposal(null, recordedEvent(U2, null, 'u2-plan', 1), context({ requestCandidate: null }));
    expect(first).toEqual({ ok: true, next: expectedCandidate(U1, null, 'u1-plan', 1), effects: RECORDED_EFFECTS });
    expect(second).toEqual({ ok: true, next: expectedCandidate(U2, null, 'u2-plan', 1), effects: RECORDED_EFFECTS });
    if (!first.ok || !second.ok) throw new Error('independent candidates must both record');
    expect(first.effects.filter((effect) => effect.kind === 'request_slot')).toEqual([]);
    expect(second.effects.filter((effect) => effect.kind === 'request_slot')).toEqual([]);
  });

  it('PC10 reading a candidate of a cancelled Goal closes it as goal_cancelled without rewriting it', () => {
    const u2 = candidate(U2, PB1, 'u2-plan', 2, Q2);
    const before = structuredClone(u2);
    const event: ReadEvent = { type: 'proposal_read', proposalRef: U2, requestRef: Q2 };
    const result = transitionPlanProposal(u2, event, context({
      goal: { activePlanRevision: PB1, desiredState: 'cancelled' },
      requestCandidate: requestFacts({ storedTerminalStatus: false, goalCancelled: true, basedOnDerivesStale: false }),
    }));
    // The stored candidate is only read; the closed/goal_cancelled verdict lives in the reader (A4).
    expect(result).toEqual({ ok: true, next: before, effects: [] });
    expect(u2).toEqual(before);
    if (!result.ok || result.next === null) throw new Error('reading a cancelled Goal candidate must succeed');
    expect(derivePlanProposalReadVerdict(result.next, PB1, 'cancelled')).toEqual({ status: 'closed', closedReason: 'goal_cancelled' });
  });
});
