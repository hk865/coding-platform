/**
 * Slice 8B L10: the pure Plan module rule (`unknownModuleTasksOf` /
 * `unknownModuleRejection`) and the pure catalog pin shape. Constructed input
 * only; every expected value is written by hand from the frozen fragment and
 * module rules, never copied from a `src` constant or program output.
 */
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { AdoptedArchitecture, ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import { architectureCatalogPinShape } from '../../src/contracts/architecture-catalog.js';
import type { CoreRejection } from '../../src/contracts/core/results.js';
import type { InferShape } from '../../src/contracts/data-format.js';
import type { PlanWriteProvenanceV1 } from '../../src/contracts/delegated-write.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanValidationError, RuntimeTask } from '../../src/contracts/plan.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { checkShape } from '../../src/contracts/validation/data-format.js';
import {
  newCandidateProposal, planProposalProblem, transitionPlanProposal,
  type CandidatePlanProposal, type FutureAdoptionFacts, type InitialAdoptionFacts, type PlanChangeReason,
  type PlanProposalEffect, type PlanProposalEvent, type PlanProposalGuardContext, type PlanProposalMachineState,
  type PlanProposalReadFacts, type PlanProposalRef, type PlanRequestCandidateFacts, type PlanSourceFacts,
} from '../../src/core/work-graph/state/plan-machine.js';
import {
  unknownModuleRejection, unknownModuleTasksOf, type UnknownModuleTaskV1,
} from '../../src/core/work-graph/tasks/plan-validation.js';

const PROJECT = 'p1';

/** A module scope names the module by its `moduleId` string, not by the catalog's ref object. */
const moduleScope = (moduleRef: string): RuntimeTask['scope'] => ({ kind: 'module', stageId: 's1', moduleRef });

const task = (taskId: string, scope: RuntimeTask['scope'], extra: Partial<RuntimeTask> = {}): RuntimeTask => ({
  taskId, title: taskId, requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
  scope, ...extra,
});

const draftWithTasks = (...tasks: RuntimeTask[]): PlanRevisionDraft => ({
  schemaVersion: 2, planId: 'plan-1', planRevision: 1, goalId: 'g1',
  stages: [{ stageId: 's1', title: 'Stage' }], tasks, obligations: [], taskHierarchy: { parentOf: [] },
  executionDag: { dependsOn: [] },
});

const catalogOf = (...modules: { moduleId: string; paths: string[] }[]): AdoptedArchitecture => ({
  requireDag: true, dependencies: [],
  modules: modules.map((module) => ({
    ref: { projectId: PROJECT, moduleId: module.moduleId },
    name: module.moduleId, responsibility: 'Responsibility', paths: module.paths, interfaces: [],
  })),
});

describe('K-unknown-rule: a module-scoped task names a module of the catalog', () => {
  const known = catalogOf({ moduleId: 'm1', paths: ['src'] }, { moduleId: 'm2', paths: ['src/m2'] });
  it.each<[string, PlanRevisionDraft, AdoptedArchitecture, UnknownModuleTaskV1[], string | null]>([
    ['no module-scoped task', draftWithTasks(task('t1', { kind: 'goal' }), task('t2', { kind: 'stage', stageId: 's1' })),
      known, [], null],
    ['every module-scoped task names a known module', draftWithTasks(task('t1', moduleScope('m1')), task('t2', moduleScope('m2'))),
      known, [], null],
    ['unknown modules are listed in draft order, one entry per task, no de-duplication',
      draftWithTasks(task('t4', moduleScope('m1')), task('t2', moduleScope('m9')), task('t9', moduleScope('m3')),
        task('t1', moduleScope('m9'))), known,
      [{ taskId: 't2', moduleId: 'm9' }, { taskId: 't9', moduleId: 'm3' }, { taskId: 't1', moduleId: 'm9' }],
      'unknown_module: t2=m9, t9=m3, t1=m9'],
    ['a module whose only path is the root is known', draftWithTasks(task('t1', moduleScope('root'))),
      catalogOf({ moduleId: 'root', paths: ['.'] }), [], null],
    ['a gate, an optional task and a plan_only intent without acceptance are checked alike', draftWithTasks(
      task('t1', moduleScope('m9'), { taskKind: 'gate' }),
      task('t2', moduleScope('m9'), { requirementLevel: 'optional' }),
      task('t3', moduleScope('m9'), { executionIntent: 'plan_only' })), known,
      [{ taskId: 't1', moduleId: 'm9' }, { taskId: 't2', moduleId: 'm9' }, { taskId: 't3', moduleId: 'm9' }],
      'unknown_module: t1=m9, t2=m9, t3=m9'],
    // A draft no codec has checked yet: the rule never throws.
    ['a null task entry is skipped', { ...draftWithTasks(), tasks: [null] } as unknown as PlanRevisionDraft,
      known, [], null],
    ['a hole in a sparse tasks array is skipped and the task after it is still checked',
      { ...draftWithTasks(), tasks: [, task('t2', moduleScope('m9'))] } as unknown as PlanRevisionDraft, known,
      [{ taskId: 't2', moduleId: 'm9' }], 'unknown_module: t2=m9'],
    ['tasks that are not an array read as no tasks',
      { ...draftWithTasks(), tasks: { t1: task('t1', moduleScope('m9')) } } as unknown as PlanRevisionDraft, known,
      [], null],
  ])('%s', (_label, draft, catalog, expected, reason) => {
    const unknown = unknownModuleTasksOf(draft, catalog);
    expect(unknown).toEqual(expected);
    if (reason !== null) {
      expect(unknownModuleRejection(unknown)).toEqual({ status: 'rejected', code: 'invalid', reason });
    }
  });
});

describe('K-pin-shape: ArchitectureCatalogPinV1 as an R1 fragment', () => {
  const BESIDE_BASELINE = 'ArchitectureCatalogPinV1.catalogRef must name the project, baseline and revision of baseline.ref';
  const pin: ArchitectureCatalogPinV1 = {
    catalogRef: { aggregateType: 'ArchitectureCatalog', projectId: PROJECT, baselineId: 'b1', revision: 2 },
    baseline: {
      ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: PROJECT, baselineId: 'b1', revision: 2 },
      digest: '0123456789abcdef'.repeat(4),
    },
  };
  it.each<[string, unknown, string | null]>([
    ['a complete pin', pin, null],
    ['catalogRef names another revision', { ...pin, catalogRef: { ...pin.catalogRef, revision: 3 } }, BESIDE_BASELINE],
    ['catalogRef names another baselineId', { ...pin, catalogRef: { ...pin.catalogRef, baselineId: 'b2' } }, BESIDE_BASELINE],
    ['catalogRef names another projectId', { ...pin, catalogRef: { ...pin.catalogRef, projectId: 'p2' } }, BESIDE_BASELINE],
    ['catalogRef carries the baseline aggregate tag',
      { ...pin, catalogRef: { ...pin.catalogRef, aggregateType: 'ArchitectureBaselineRevision' } },
      'ArchitectureCatalogPinV1.catalogRef.aggregateType is not recognized'],
    ['the digest is not 64 lowercase hex digits', { ...pin, baseline: { ...pin.baseline, digest: 'A'.repeat(64) } },
      'ArchitectureCatalogPinV1.baseline.digest is invalid'],
    ['an extra key', { ...pin, extra: 1 }, 'ArchitectureCatalogPinV1.extra is not allowed'],
  ])('%s', (_label, value, expected) => {
    expect(checkShape(architectureCatalogPinShape, value, 'stored')).toBe(expected);
  });

  it('the field table infers the hand-written pin type', () => {
    expectTypeOf<InferShape<typeof architectureCatalogPinShape.fields>>().branded.toEqualTypeOf<ArchitectureCatalogPinV1>();
  });
});

// --------------------------------------------------------------------------
// K-machine-order: where the module ask sits and what the pin does to records
// --------------------------------------------------------------------------

const GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'g1' };
const PLAN_1: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 'plan-1' };
const PLAN_2: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 'plan-2' };
const PROPOSAL: PlanProposalRef = { aggregateType: 'PlanProposal', projectId: PROJECT, workspaceId: 'w1', proposalId: 'proposal-1' };
const NEW_PROPOSAL: PlanProposalRef = { ...PROPOSAL, proposalId: 'proposal-2' };
const REQUEST: QueryJobRef = { aggregateType: 'QueryJob', projectId: PROJECT, workspaceId: 'w1', queryJobId: 'q1' };
const REASON: PlanChangeReason = { text: 'add the module task', sources: [] };
const OPERATOR = { kind: 'human', id: 'operator' } as const;
const T = '2026-10-08T00:00:00.000Z';

const pin: ArchitectureCatalogPinV1 = {
  catalogRef: { aggregateType: 'ArchitectureCatalog', projectId: PROJECT, baselineId: 'b1', revision: 1 },
  baseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: PROJECT, baselineId: 'b1', revision: 1 },
    digest: '0123456789abcdef'.repeat(4) },
};
const pin2: ArchitectureCatalogPinV1 = { ...pin,
  catalogRef: { ...pin.catalogRef, revision: 2 }, baseline: { ref: { ...pin.baseline.ref, revision: 2 }, digest: 'fedcba9876543210'.repeat(4) } };
const UNKNOWN_MODULE: CoreRejection = { status: 'rejected', code: 'invalid', reason: 'unknown_module: t1=m9' };
const ISSUE: PlanValidationError = { path: 'tasks[0]', code: 'missing_task_assignment', message: 'no assignment' };

const SOURCE: PlanSourceFacts = { ref: PLAN_1, goalRef: GOAL, planId: 'plan-1', planRevision: 1 };
const PROVENANCE: PlanWriteProvenanceV1 = {
  schemaVersion: 1, runRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'g1', runId: 'run-1' },
  sessionRef: { projectId: PROJECT, sessionId: 's1' },
  roleBinding: { schemaVersion: 1, bindingId: 'b1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'p1' },
  sessionGeneration: 1, entryGeneration: 1, authorizationRevision: 1, configurationRevision: 'cfg-1' };

const MODULE_DRAFT: PlanRevisionDraft = draftWithTasks(task('t1', moduleScope('m9')));
const FUTURE_DRAFT: PlanRevisionDraft = { ...MODULE_DRAFT, planId: 'plan-2', planRevision: 2 };

type RecordedEvent = Extract<PlanProposalEvent, { type: 'proposal_recorded' }>;
type AcceptedEvent = Extract<PlanProposalEvent, { type: 'proposal_accepted' }>;

function recordedHost(overrides: Partial<RecordedEvent> = {}): RecordedEvent {
  return { type: 'proposal_recorded', writer: 'host', ref: PROPOSAL, goalRef: GOAL, basedOn: null, draft: MODULE_DRAFT,
    reason: REASON, issues: [], catalogPin: pin, submittedBy: null, ...overrides };
}
function recordedAgent(overrides: Partial<RecordedEvent> = {}): RecordedEvent {
  return recordedHost({ writer: 'agent', basedOn: PLAN_1, draft: FUTURE_DRAFT, submittedBy: PROVENANCE, ...overrides });
}
const ACCEPT_HOST: AcceptedEvent = { type: 'proposal_accepted', adopter: 'host', proposalRef: PROPOSAL,
  expectedProposalRevision: 1, decisionRefs: [], agentWriter: null };
const REPLACED: PlanProposalEvent = { type: 'proposal_replaced', writer: 'host', ref: NEW_PROPOSAL, goalRef: GOAL,
  basedOn: null, draft: MODULE_DRAFT, reason: REASON, issues: [], catalogPin: pin2, submittedBy: null,
  expectedHeadRevision: 1, requestedBy: OPERATOR, at: T, head: { proposalRef: PROPOSAL, revision: 1 },
  replaces: { proposalRef: PROPOSAL, revision: 1 }, requestRef: REQUEST };

function requestFacts(overrides: Partial<PlanRequestCandidateFacts> = {}): PlanRequestCandidateFacts {
  return { requestRootSameGoal: true, replacesIsNull: true, slotExpectedOwnerIsNull: true, headMatches: true,
    headRevisionMatches: true, requestGoalMatches: true, replacesComplete: true, firstPlanUserOnly: true,
    slotOwnerMatches: true, basedOnIsActivePointer: true, operatorMatches: true, headPinMatches: true,
    goalNotCancelled: true, storedTerminalStatus: false, goalCancelled: false, basedOnDerivesStale: false,
    adoptionPolicy: null, ...overrides };
}
function machineContext(overrides: Partial<PlanProposalGuardContext> = {}): PlanProposalGuardContext {
  return { goal: { activePlanRevision: null, desiredState: 'active' }, goalInWorkspace: true, pinsAgree: true,
    agentAdmission: null, source: null, initial: null, future: null, modules: 'ok', ...overrides };
}
function initialFacts(overrides: Partial<InitialAdoptionFacts> = {}): InitialAdoptionFacts {
  return { origin: 'ok', governance: 'ok', modules: 'ok', draftIssues: [], assignmentReasons: [], phaseReasons: [], ...overrides };
}
function futureFacts(overrides: Partial<FutureAdoptionFacts> = {}): FutureAdoptionFacts {
  return { modules: 'ok', targetExists: false,
    delta: { status: 'supported', changedTaskIds: [], addedTaskIds: [], dispositionOnlyTaskIds: [],
      dispositionChanges: [], carrierRemovals: [] },
    coverage: { status: 'supported' }, pinnedPolicy: 'not_needed', draftIssues: [], assignmentReasons: [],
    phaseReasons: [], touchedTaskFacts: [], adopterClass: 'human', dispositionTaskFacts: [],
    sourceCarriers: { tasks: [], obligations: [] }, carrierFacts: [], ...overrides };
}
function candidateOf(draft: PlanRevisionDraft, basedOn: PlanRevisionRef | null): CandidatePlanProposal {
  return newCandidateProposal({ ref: PROPOSAL, goalRef: GOAL, basedOn, draft, reason: REASON, issues: [],
    catalogPin: pin, submittedBy: null });
}

describe('K-machine-order: the module ask follows the earlier refusals and the pin follows the record', () => {
  /** The machine's refusal of UNKNOWN_MODULE: a forwarded `invalid` verdict is a guard failure. */
  const MODULE_REFUSED = { ok: false, reason: 'guard_failed', code: 'invalid', detail: 'unknown_module: t1=m9' } as const;
  /** Every other propose fact holds, so whatever the entry does not refuse reaches the module ask. */
  const proposeFacts: PlanProposalReadFacts = { goal: { activePlanRevision: null, desiredState: 'active' },
    goalInWorkspace: true, pinsAgree: true, modules: UNKNOWN_MODULE };
  const agentFacts: PlanProposalReadFacts = { ...proposeFacts, goal: { activePlanRevision: PLAN_1, desiredState: 'active' },
    agentAdmission: 'ok', source: SOURCE };

  it.each<[string, PlanProposalMachineState | undefined, RecordedEvent, PlanProposalReadFacts,
    ReturnType<typeof planProposalProblem>]>([
    ['the state is not read yet: the module ask waits', undefined, recordedHost(), proposeFacts, null],
    ['every earlier check holds: the module ask refuses', null, recordedHost(), proposeFacts, MODULE_REFUSED],
    ['a foreign workspace wins', null, recordedHost(), { ...proposeFacts, goalInWorkspace: false },
      { ok: false, reason: 'guard_failed', code: 'forbidden', detail: 'the goal does not belong to the requested workspace' }],
    ['the reason shape wins', null, recordedHost({ reason: { text: 't', sources: [], affectedTaskIds: ['t-other'] } }),
      proposeFacts, { ok: false, reason: 'guard_failed', code: 'invalid',
        detail: 'reason.affectedTaskIds names t-other, which is not a task of the draft' }],
    ['the Agent admission wins', null, recordedAgent(),
      { ...agentFacts, agentAdmission: { status: 'rejected', code: 'busy', reason: 'the Run is not running' } },
      { ok: false, reason: 'guard_failed', code: 'busy', detail: 'the Run is not running' }],
    ['a stale source wins', null, recordedAgent(), { ...agentFacts, goal: { activePlanRevision: PLAN_2, desiredState: 'active' } },
      { ok: false, reason: 'stale', code: 'revision_conflict', detail: 'the source plan is not the Goal current active plan' }],
  ])('propose: %s', (_label, state, event, facts, expected) => {
    expect(planProposalProblem(state, event, facts)).toEqual(expected);
  });

  const pendingHead = candidateOf(MODULE_DRAFT, null);
  it.each<[string, CandidatePlanProposal, Partial<PlanRequestCandidateFacts>, ReturnType<typeof transitionPlanProposal>]>([
    ['the head record moved to revision 2', { ...pendingHead, revision: 2 }, {},
      { ok: false, reason: 'stale', code: 'revision_conflict', detail: 'the replaced head revision changed' }],
    ['the head is no longer a candidate', { ...pendingHead, status: 'not_adopted' }, {},
      { ok: false, reason: 'illegal', code: 'invalid', detail: 'proposal proposal-2 is not a pending candidate' }],
    ['the request says the head is not the current candidate', pendingHead, { headMatches: false },
      { ok: false, reason: 'guard_failed', code: 'invalid', detail: 'the replaced head is not the current candidate' }],
    ['the request says the head revision changed', pendingHead, { headRevisionMatches: false },
      { ok: false, reason: 'stale', code: 'revision_conflict', detail: 'the replaced head revision changed' }],
    ['the replacement belongs to another request Goal', pendingHead, { requestGoalMatches: false },
      { ok: false, reason: 'guard_failed', code: 'invalid', detail: 'the replacement does not belong to the request Goal' }],
    ['the replacement does not name the complete head', pendingHead, { replacesComplete: false },
      { ok: false, reason: 'guard_failed', code: 'invalid', detail: 'the replacement does not name the complete current head' }],
  ])('replacement: %s wins over the module ask', (_label, state, request, expected) => {
    expect(transitionPlanProposal(state, REPLACED, machineContext({ modules: UNKNOWN_MODULE,
      requestCandidate: requestFacts(request) }))).toEqual(expected);
  });

  it('a recorded candidate carries the event pin after issues, before submittedBy and requestRef', () => {
    const result = transitionPlanProposal(null, recordedAgent({ requestRef: REQUEST, replaces: null }),
      machineContext({ goal: { activePlanRevision: PLAN_1, desiredState: 'active' }, agentAdmission: 'ok', source: SOURCE,
        requestCandidate: requestFacts() }));
    expect(result.ok).toBe(true);
    if (!result.ok || result.next === null) throw new Error(`the Agent proposal must record: ${JSON.stringify(result)}`);
    expect(result.next.catalogPin).toBe(pin);
    const wire = JSON.stringify({ kind: 'candidate_v2', ref: PROPOSAL, revision: 1,
      schemaVersion: 2, goalRef: GOAL, basedOn: PLAN_1, draft: FUTURE_DRAFT, reason: REASON, status: 'candidate',
      issues: [], catalogPin: pin, submittedBy: PROVENANCE, requestRef: REQUEST });
    expect(JSON.stringify(result.next)).toBe(wire);
  });

  it('a replaced candidate takes the new pin and the old head record keeps its own', () => {
    const head = transitionPlanProposal(null, recordedHost(), machineContext());
    if (!head.ok) throw new Error(`the old head must record: ${JSON.stringify(head)}`);
    const result = transitionPlanProposal(head.next, REPLACED, machineContext({ requestCandidate: requestFacts() }));
    expect(result.ok).toBe(true);
    if (!result.ok || result.next === null) throw new Error(`the replacement must record: ${JSON.stringify(result)}`);
    expect(result.next.catalogPin).toBe(pin2);
    const written = result.effects.find((effect) => effect.kind === 'write_replaced_proposal');
    if (written?.kind !== 'write_replaced_proposal') throw new Error('the replacement must write the old head');
    expect(written.record.catalogPin).toBe(pin);
  });

  it('the duplicate check compares the pin: the same pin duplicates, another pin already exists', () => {
    const result = transitionPlanProposal(null, recordedHost(), machineContext());
    if (!result.ok) throw new Error(`the head must record: ${JSON.stringify(result)}`);
    expect(planProposalProblem(result.next, recordedHost(), machineContext()))
      .toMatchObject({ ok: false, reason: 'duplicate', code: 'revision_conflict' });
    expect(planProposalProblem(result.next, recordedHost({ catalogPin: pin2 }), machineContext()))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'revision_conflict' });
    // The ask comes before the duplicate check: an unknown module refuses even a same-content retry.
    expect(planProposalProblem(result.next, recordedHost(), machineContext({ modules: UNKNOWN_MODULE })))
      .toMatchObject({ ok: false, code: 'invalid', detail: 'unknown_module: t1=m9' });
  });

  it.each<[string, Partial<InitialAdoptionFacts>, ReturnType<typeof planProposalProblem>]>([
    ['governance wins over modules', { governance: { status: 'rejected', code: 'unavailable',
      reason: 'the governance baseline moved' }, modules: UNKNOWN_MODULE, draftIssues: [ISSUE] },
    { ok: false, reason: 'guard_failed', code: 'unavailable', detail: 'the governance baseline moved' }],
    ['modules win over draft issues', { modules: UNKNOWN_MODULE, draftIssues: [ISSUE] }, MODULE_REFUSED],
  ])('initial adoption: %s', (_label, overrides, expected) => {
    expect(planProposalProblem(candidateOf(MODULE_DRAFT, null), ACCEPT_HOST, { goal: { activePlanRevision: null,
      desiredState: 'active' }, goalInWorkspace: true, pinsAgree: true, initial: initialFacts(overrides) })).toEqual(expected);
  });

  it.each<[string, Partial<FutureAdoptionFacts>, ReturnType<typeof planProposalProblem>]>([
    ['pinnedPolicy wins over modules', { pinnedPolicy: { status: 'rejected', code: 'unavailable',
      reason: 'the pinned policy is unreadable' }, modules: UNKNOWN_MODULE, draftIssues: [ISSUE] },
    { ok: false, reason: 'guard_failed', code: 'unavailable', detail: 'the pinned policy is unreadable' }],
    ['modules win over draft issues', { pinnedPolicy: 'ok', modules: UNKNOWN_MODULE, draftIssues: [ISSUE] }, MODULE_REFUSED],
  ])('future adoption: %s', (_label, overrides, expected) => {
    expect(planProposalProblem(candidateOf(FUTURE_DRAFT, PLAN_1), ACCEPT_HOST, { goal: { activePlanRevision: PLAN_1,
      desiredState: 'active' }, goalInWorkspace: true, pinsAgree: true, source: SOURCE, future: futureFacts(overrides) }))
      .toEqual(expected);
  });

  it('only the future effects carry the catalog guard, before the target Plan does-not-exist guard', () => {
    const initial = transitionPlanProposal(candidateOf(MODULE_DRAFT, null), ACCEPT_HOST, machineContext({
      initial: initialFacts() }));
    if (!initial.ok) throw new Error(`the initial adoption must pass: ${JSON.stringify(initial)}`);
    expect(initial.effects.some((effect) => effect.kind === 'guard' && effect.guard.target === 'catalog')).toBe(false);
    const future = transitionPlanProposal(candidateOf(FUTURE_DRAFT, PLAN_1), ACCEPT_HOST, machineContext({
      goal: { activePlanRevision: PLAN_1, desiredState: 'active' }, source: SOURCE, future: futureFacts() }));
    if (!future.ok) throw new Error(`the future adoption must pass: ${JSON.stringify(future)}`);
    expect(future.effects).toContainEqual({ kind: 'guard', guard: { target: 'catalog' } } as PlanProposalEffect);
    const catalogAt = future.effects.findIndex((effect) => effect.kind === 'guard' && effect.guard.target === 'catalog');
    const targetAt = future.effects.findIndex((effect) => effect.kind === 'guard'
      && effect.guard.target === 'plan_revision' && effect.guard.expectedRevision === null);
    expect(catalogAt).toBeGreaterThanOrEqual(0);
    expect(catalogAt).toBeLessThan(targetAt);
  });
});
