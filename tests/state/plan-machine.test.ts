/**
 * §3 PlanProposal / PlanRevision machines (docs/refactor/STATE-MACHINES-SPEC.md):
 * every (state, event) pair of PLAN-01..PLAN-09, the §3.4 forbidden rows, each
 * guard of the propose/apply rows in today's order, `planProposalProblem` (the
 * same guards over the facts the owner read so far), the record constructors
 * (§14.1), the derived statuses, and the W16 pure guards (untraced rule,
 * TASK-19 `tracedDispositionChangeProblem`, LA-3 `parallelCarrierFenceProblem`).
 * Rows that step 5 flips are pinned at today's result and marked "step 5".
 * Pure: no RecordStore, no Kernel.
 */
import { describe, expect, it } from 'vitest';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { CoreError, CoreRejection } from '../../src/contracts/core/results.js';
import type { PlanWriteProvenanceV1 } from '../../src/contracts/delegated-write.js';
import type {
  RoleBindingRefV1, RunRef, RunSnapshot, RuntimeEventV1, TaskLeaseSnapshot,
} from '../../src/contracts/dispatch.js';
import type { InitialPlanOrigin } from '../../src/contracts/initial-planning.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanValidationError, RuntimeTask } from '../../src/contracts/plan.js';
import type { TaskReductionSnapshot } from '../../src/contracts/reduction.js';
import { GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import {
  acceptProposalRecord,
  derivePlanProposalStatus,
  derivePlanRevisionStatus,
  futureChangeTraceProblem,
  newCandidateProposal,
  parallelCarrierFactTaskIds,
  parallelCarrierFenceProblem,
  planProposalProblem,
  planRevisionTargetOf,
  tracedDispositionChangeProblem,
  transitionPlanProposal,
  type AgentPlanWriterIdentity,
  type CandidatePlanProposal,
  type FutureAdoptionFacts,
  type FutureChangeTaskFactsV1,
  type FuturePlanDeltaVerdict,
  type InitialAdoptionFacts,
  type PlanCarrierViewV1,
  type PlanChangeReason,
  type PlanCommitGuard,
  type PlanProposalEffect,
  type PlanProposalEvent,
  type PlanProposalGuardContext,
  type PlanProposalMachineState,
  type PlanProposalReadFacts,
  type PlanProposalRecord,
  type PlanProposalRef,
  type PlanProposalTransition,
  type PlanSourceFacts,
  type TracedTaskFactsV1,
} from '../../src/core/work-graph/state/plan-machine.js';
import type { TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const PROJECT = 'p-plan';
const WORKSPACE = 'w-plan';
const GOAL_ID = 'g-1';
const T0 = '2026-10-04T08:00:00.000Z';
const T1 = '2026-10-04T08:05:00.000Z';
const GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: GOAL_ID };
const planRef = (planId: string): PlanRevisionRef => ({ aggregateType: 'PlanRevision', projectId: PROJECT, planId });
const P0 = planRef('plan-0');
const P1 = planRef('plan-1');
const P2 = planRef('plan-2');
const PROPOSAL_REF: PlanProposalRef = { aggregateType: 'PlanProposal', projectId: PROJECT, workspaceId: WORKSPACE, proposalId: 'proposal-1' };
const PIN: ArchitectureCatalogPinV1 = {
  catalogRef: { aggregateType: 'ArchitectureCatalog', projectId: PROJECT, baselineId: 'baseline-1', revision: 1 },
  baseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: PROJECT, baselineId: 'baseline-1', revision: 1 },
    digest: '0123456789abcdef'.repeat(4) },
};
const REASON: PlanChangeReason = { text: 'add the docs task', sources: [] };
const ROLE: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1',
};
const SESSION: SessionRef = { projectId: PROJECT, sessionId: 's-writer' };
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: PROJECT, goalId: GOAL_ID, runId });
const WRITER_RUN = runRef('run-writer');
const WRITER: AgentPlanWriterIdentity = { runRef: WRITER_RUN, sessionRef: SESSION, roleBinding: ROLE, goalRef: GOAL };
const PROVENANCE: PlanWriteProvenanceV1 = {
  schemaVersion: 1, runRef: WRITER_RUN, sessionRef: SESSION, roleBinding: ROLE, sessionGeneration: 1, entryGeneration: 1,
  authorizationRevision: 2, configurationRevision: 'cfg-1',
};
const HUMAN: Extract<ActorRef, { kind: 'human' | 'system' }> = { kind: 'human', id: 'operator' };

function runtimeTask(taskId: string, overrides: Partial<RuntimeTask> = {}): RuntimeTask {
  return { taskId, title: `task ${taskId}`, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
    phase: 'pending', scope: { kind: 'goal' }, ...overrides };
}

function draftOf(input: { planId: string; planRevision: number; goalId?: string }): PlanRevisionDraft {
  const base = { planId: input.planId, planRevision: input.planRevision, goalId: input.goalId ?? GOAL_ID, stages: [],
    tasks: [runtimeTask('t-build')], obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  return { ...base, schemaVersion: 2 };
}

const INITIAL_DRAFT = draftOf({ planId: 'plan-1', planRevision: 1 });
const FUTURE_DRAFT = draftOf({ planId: 'plan-2', planRevision: 2 });
const SOURCE: PlanSourceFacts = { ref: P1, goalRef: GOAL, planId: 'plan-1', planRevision: 1 };

function candidate(input: { basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft;
  catalogPin: ArchitectureCatalogPinV1 | null; submittedBy?: PlanWriteProvenanceV1 | null; reason?: PlanChangeReason }): CandidatePlanProposal {
  return newCandidateProposal({ ref: PROPOSAL_REF, goalRef: GOAL, basedOn: input.basedOn, draft: input.draft,
    reason: input.reason ?? REASON, issues: [], catalogPin: input.catalogPin, submittedBy: input.submittedBy ?? null,
    sourceMessageRef: null });
}

const CANDIDATE_INITIAL = candidate({ basedOn: null, draft: INITIAL_DRAFT, catalogPin: PIN });
/** An Agent-submitted future candidate: both adopters can take it. */
const CANDIDATE_FUTURE = candidate({ basedOn: P1, draft: FUTURE_DRAFT, catalogPin: PIN, submittedBy: PROVENANCE });
const ACCEPTED = acceptProposalRecord(CANDIDATE_FUTURE);
const REJECTED: CandidatePlanProposal = { ...CANDIDATE_FUTURE, revision: 2, status: 'rejected' };

const INITIAL_FACTS: InitialAdoptionFacts = {
  modules: 'ok', origin: 'ok', governance: 'ok', draftIssues: [], assignmentReasons: [], phaseReasons: [],
};
const DOCS_FACTS: FutureChangeTaskFactsV1 = { taskId: 't-docs', runs: [], lease: null, reduction: null };
/** A supported delta (C7, 5.10: without disposition-only Tasks unless the test names them). */
const delta = (changedTaskIds: string[], addedTaskIds: string[], c7: Partial<Pick<Extract<FuturePlanDeltaVerdict,
  { status: 'supported' }>, 'dispositionOnlyTaskIds' | 'dispositionChanges' | 'carrierRemovals'>> = {}): FuturePlanDeltaVerdict =>
  ({ status: 'supported', changedTaskIds, addedTaskIds, dispositionOnlyTaskIds: [], dispositionChanges: [], carrierRemovals: [], ...c7 });
const FUTURE_FACTS: FutureAdoptionFacts = {
  modules: 'ok', targetExists: false, delta: delta([], ['t-docs']),
  coverage: { status: 'supported' }, pinnedPolicy: 'not_needed', draftIssues: [], assignmentReasons: [], phaseReasons: [],
  touchedTaskFacts: [DOCS_FACTS],
  // C7 (5.10): an operator adoption without disposition-only Tasks reads no carrier.
  adopterClass: 'human', dispositionTaskFacts: [], sourceCarriers: { tasks: [], obligations: [] }, carrierFacts: [],
};
/** The same facts adopted by the Agent writer (its rework class is `agent`, §1). */
const AGENT_FUTURE_FACTS: FutureAdoptionFacts = { ...FUTURE_FACTS, adopterClass: 'agent' };

function context(overrides: Partial<PlanProposalGuardContext> = {}): PlanProposalGuardContext {
  return { goal: { activePlanRevision: P1, desiredState: 'active' }, goalInWorkspace: true, pinsAgree: true,
    agentAdmission: null, source: SOURCE, modules: 'ok', initial: INITIAL_FACTS, future: FUTURE_FACTS, ...overrides };
}
const pointer = (activePlanRevision: PlanRevisionRef | null, desiredState: 'active' | 'paused' | 'cancelled' = 'active') =>
  ({ goal: { activePlanRevision, desiredState } });
const rejection = (code: CoreError, reason: string): CoreRejection => ({ status: 'rejected', code, reason });

type RecordedEvent = Extract<PlanProposalEvent, { type: 'proposal_recorded' }>;
type AcceptedEvent = Extract<PlanProposalEvent, { type: 'proposal_accepted' }>;

const RECORD_HOST: RecordedEvent = { type: 'proposal_recorded', writer: 'host', ref: PROPOSAL_REF, goalRef: GOAL,
  basedOn: null, draft: INITIAL_DRAFT, reason: REASON, issues: [], catalogPin: PIN, submittedBy: null,
  sourceMessageRef: null };
const RECORD_ANSWER: RecordedEvent = { ...RECORD_HOST, writer: 'initial_answer' };
const RECORD_AGENT: RecordedEvent = { ...RECORD_HOST, writer: 'agent', basedOn: P1, draft: FUTURE_DRAFT, submittedBy: PROVENANCE };
const ACCEPT_HOST: AcceptedEvent = { type: 'proposal_accepted', adopter: 'host', proposalRef: PROPOSAL_REF,
  expectedProposalRevision: 1, decisionRefs: [], agentWriter: null };
const ACCEPT_AGENT: AcceptedEvent = { ...ACCEPT_HOST, adopter: 'agent', agentWriter: WRITER };
const STALE: PlanProposalEvent = { type: 'proposal_stale' };
const REJECT: PlanProposalEvent = { type: 'proposal_rejected' };

const g = (guard: PlanCommitGuard): PlanProposalEffect => ({ kind: 'guard', guard });
const SCOPE_GUARDS = [g({ target: 'project' }), g({ target: 'workspace' }), g({ target: 'goal' })];
const RECORDED_HOST_EFFECTS: PlanProposalEffect[] = [
  { kind: 'write_proposal' }, { kind: 'append_event', eventType: 'PlanProposalRecorded' },
  ...SCOPE_GUARDS, g({ target: 'proposal', expectedRevision: null }),
];
const RECORDED_ANSWER_EFFECTS: PlanProposalEffect[] = [
  { kind: 'write_proposal' }, { kind: 'append_event', eventType: 'PlanProposalRecorded' },
  g({ target: 'answer_facts' }), ...SCOPE_GUARDS, g({ target: 'proposal', expectedRevision: null }),
];
const RECORDED_AGENT_EFFECTS: PlanProposalEffect[] = [
  { kind: 'write_proposal' }, { kind: 'append_event', eventType: 'PlanProposalRecorded' },
  g({ target: 'agent_admission' }), ...SCOPE_GUARDS, g({ target: 'plan_revision', ref: P1, expectedRevision: 1 }),
  g({ target: 'proposal', expectedRevision: null }),
];
const INITIAL_ADOPTION_EFFECTS: PlanProposalEffect[] = [
  { kind: 'write_proposal' },
  { kind: 'write_plan_revision', ref: P1, build: { from: 'initial_draft' } },
  { kind: 'move_goal_pointer', from: null, to: P1 },
  { kind: 'append_event', eventType: 'PlanRevisionAccepted' },
  ...SCOPE_GUARDS, g({ target: 'proposal', expectedRevision: 1 }), g({ target: 'governance' }),
  g({ target: 'plan_revision', ref: P1, expectedRevision: null }),
];
function futureAdoptionEffects(input: { agent: boolean; pinnedPolicy?: boolean; changed?: string[]; added?: string[] }): PlanProposalEffect[] {
  const changed = input.changed ?? [];
  const added = input.added ?? ['t-docs'];
  return [
    { kind: 'write_proposal' },
    { kind: 'write_plan_revision', ref: P2, build: { from: 'future_delta', source: P1, changedTaskIds: changed, addedTaskIds: added,
      dispositionOnlyTaskIds: [] } },
    { kind: 'move_goal_pointer', from: P1, to: P2 },
    { kind: 'append_event', eventType: 'PlanRevisionAccepted' },
    ...(input.agent ? [g({ target: 'agent_admission' })] : []),
    ...(input.pinnedPolicy === true ? [g({ target: 'pinned_policy' })] : []),
    ...SCOPE_GUARDS, g({ target: 'proposal', expectedRevision: 1 }), g({ target: 'plan_revision', ref: P1, expectedRevision: 1 }),
    ...[...changed, ...added].flatMap((taskId) => [
      g({ target: 'task_record_absent', record: 'TaskLease', taskId }),
      g({ target: 'task_record_absent', record: 'TaskReduction', taskId }),
    ]),
    g({ target: 'plan_revision', ref: P2, expectedRevision: null }),
  ];
}

type Expected =
  | { ok: true; next: PlanProposalMachineState; effects: PlanProposalEffect[] }
  | { ok: false; reason: TransitionRejectReason; code: CoreError; detail?: string };
const ok = (next: PlanProposalMachineState, effects: PlanProposalEffect[] = []): Expected => ({ ok: true, next, effects });
const no = (reason: TransitionRejectReason, code: CoreError, detail?: string): Expected =>
  detail === undefined ? { ok: false, reason, code } : { ok: false, reason, code, detail };

function expectResult(result: PlanProposalTransition, expected: Expected): void {
  if (expected.ok) {
    expect(result).toEqual({ ok: true, next: expected.next, effects: expected.effects });
    return;
  }
  if (result.ok) throw new Error(`expected a ${expected.reason}/${expected.code} rejection, got ${JSON.stringify(result)}`);
  expect({ reason: result.reason, code: result.code }).toEqual({ reason: expected.reason, code: expected.code });
  if (expected.detail !== undefined) expect(result.detail).toBe(expected.detail);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

// Run / Lease / Reduction / ControlIntent facts for the W16 guards.
const crashedEvent = (run: RunRef): RuntimeEventV1 => ({ eventType: 'run_crashed', schemaVersion: 1, eventId: `rt-${run.runId}`,
  runRef: run, sequence: 3, occurredAt: T1, payload: { kind: 'crashed', error: 'host restarted' } });

function runOf(runId: string, taskId: string, overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    ref: runRef(runId), revision: 3, schemaVersion: 1, task: { projectId: PROJECT, goalId: GOAL_ID, taskId },
    attemptId: `${runId}-attempt`, planRef: P1, roleBinding: ROLE, budget: { tokenBudget: 1000, deadline: null },
    workspaceSnapshot: { workspaceId: WORKSPACE, revision: 1 }, status: 'ended', outcome: 'failed', exitCode: 1,
    lastEventSeq: 2, lastRuntimeEventId: `rt-${runId}`, lastFactEventId: `ev-${runId}`, envelope: null,
    startedAt: T0, endedAt: T1, previousRun: null, ...overrides,
  };
}

function leaseOf(taskId: string, released: boolean): TaskLeaseSnapshot {
  const lease: TaskLeaseSnapshot = { ref: { aggregateType: 'TaskLease', projectId: PROJECT, goalId: GOAL_ID, taskId },
    revision: 1, schemaVersion: 1, holderRunId: `run-${taskId}`, attemptId: `run-${taskId}-attempt`, grantedAt: T0, expiresAt: null };
  if (!released) return lease;
  return { ...lease, revision: 2, release: { schemaVersion: 1, runRef: runRef(`run-${taskId}`),
    attemptRef: { aggregateType: 'TaskAttempt', projectId: PROJECT, goalId: GOAL_ID, taskId, attemptId: `run-${taskId}-attempt` },
    sessionRef: SESSION, generation: 1, releasedAt: T1, eventId: `ev-release-${taskId}` } };
}

/** Only presence matters to the guards; the Reduction is only ever `satisfied` (`completion.ts:392-395`). */
const reductionOf = (taskId: string): TaskReductionSnapshot => ({
  ref: { aggregateType: 'TaskReduction', projectId: PROJECT, goalId: GOAL_ID, taskId }, revision: 1, schemaVersion: 1,
  planRef: P1, planRevision: 1, taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'satisfied',
}) as unknown as TaskReductionSnapshot;

function intentOf(intentId: string, kind: 'pause' | 'cancel', requestedBy: Extract<ActorRef, { kind: 'human' | 'system' }>,
  run: RunRef): ControlIntentSnapshotV1 {
  return { schemaVersion: 1, ref: { aggregateType: 'ControlIntent', projectId: PROJECT, workspaceId: WORKSPACE, intentId },
    runRef: run, kind, desiredState: kind === 'pause' ? 'paused' : 'cancelled', reason: null, requestedAt: T0, requestedBy,
    revision: 1, status: 'queued' };
}

/** A traced Task whose last Run failed and released the lease: every TASK-19 guard passes. */
function tracedFacts(taskId: string, overrides: Partial<TracedTaskFactsV1> = {}): TracedTaskFactsV1 {
  const run = runOf(`run-${taskId}`, taskId);
  return { taskId, runs: [run], selectedRun: run, lease: leaseOf(taskId, true), reduction: null, pointerIntent: null, ...overrides };
}

/** Selected Run cancelled through a human ControlIntent pointer (`reworkFenceOf = 'human_only'`). */
function humanCancelledFacts(taskId: string): TracedTaskFactsV1 {
  const ref = runRef(`run-${taskId}`);
  const intent = intentOf(`ci-cancel-${taskId}`, 'cancel', HUMAN, ref);
  const run = runOf(ref.runId, taskId, { outcome: 'cancelled', exitCode: null,
    controlState: { intentRef: intent.ref, desiredState: 'cancelled' } });
  return tracedFacts(taskId, { runs: [run], selectedRun: run, pointerIntent: intent });
}

/** Paused (by `requestedBy`), then interrupted by a Host restart: RUN-24 paused-interrupted (C4). */
function pausedInterruptedFacts(taskId: string, requestedBy: Extract<ActorRef, { kind: 'human' | 'system' }>): TracedTaskFactsV1 {
  const ref = runRef(`run-${taskId}`);
  const intent = intentOf(`ci-pause-${taskId}`, 'pause', requestedBy, ref);
  const run = runOf(ref.runId, taskId, { outcome: 'crashed', exitCode: null,
    controlState: { intentRef: intent.ref, desiredState: 'paused' },
    reconciliation: { status: 'done', observation: { kind: 'interrupted_clean', event: crashedEvent(ref), lastPosition: 4,
      kernelPaused: true, pausedIntentRef: intent.ref }, basis: { kind: 'live_clean' }, recordedAt: T1 } });
  return tracedFacts(taskId, { runs: [run], selectedRun: run, pointerIntent: intent });
}

// --------------------------------------------------------------------------
// Records and constructors (§14.1)
// --------------------------------------------------------------------------

describe('§14.1 PlanProposal record constructors', () => {
  it('PlanProposalRecord is the same type as model/plan-contracts.ts PlanProposal', () => {
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
    const same: Equal<PlanProposalRecord, PlanProposal> = true;
    expect(same).toBe(true);
  });

  it('newCandidateProposal writes candidate@1 with today\'s key order (plan-service.ts:965-967)', () => {
    const host = newCandidateProposal({ ref: PROPOSAL_REF, goalRef: GOAL, basedOn: null, draft: INITIAL_DRAFT, reason: REASON,
      issues: [], catalogPin: PIN, submittedBy: null, sourceMessageRef: null });
    expect(JSON.stringify(host)).toBe(JSON.stringify({ kind: 'candidate_v2', ref: PROPOSAL_REF, revision: 1, schemaVersion: 2,
      goalRef: GOAL, basedOn: null, draft: INITIAL_DRAFT, reason: REASON, status: 'candidate', issues: [], catalogPin: PIN,
      sourceMessageRef: null }));
    expect('submittedBy' in host).toBe(false);
  });

  it('an Agent candidate carries submittedBy last (plan-service.ts:1974-1977)', () => {
    const issues: PlanValidationError[] = [{ path: 'tasks[0]', code: 'missing_task_assignment', message: 'no assignment' }];
    const agent = newCandidateProposal({ ref: PROPOSAL_REF, goalRef: GOAL, basedOn: P1, draft: FUTURE_DRAFT, reason: REASON,
      issues, catalogPin: PIN, submittedBy: PROVENANCE, sourceMessageRef: null });
    expect(JSON.stringify(agent)).toBe(JSON.stringify({ kind: 'candidate_v2', ref: PROPOSAL_REF, revision: 1, schemaVersion: 2,
      goalRef: GOAL, basedOn: P1, draft: FUTURE_DRAFT, reason: REASON, status: 'candidate', issues, catalogPin: PIN,
      sourceMessageRef: null, submittedBy: PROVENANCE }));
  });

  it('acceptProposalRecord bumps the revision and sets accepted without touching the input (plan-commit-compiler.ts:145-149)', () => {
    const input = deepFreeze(candidate({ basedOn: P1, draft: FUTURE_DRAFT, catalogPin: PIN, submittedBy: PROVENANCE }));
    const accepted = acceptProposalRecord(input);
    expect(accepted).toEqual({ ...input, revision: 2, status: 'accepted' });
    expect(Object.keys(accepted)).toEqual(Object.keys(input));
    expect(input.status).toBe('candidate');
  });
});

// --------------------------------------------------------------------------
// Every (state, event) pair
// --------------------------------------------------------------------------

const STATES = {
  absent: null,
  candidateInitial: CANDIDATE_INITIAL,
  candidateFuture: CANDIDATE_FUTURE,
  accepted: ACCEPTED,
  rejected: REJECTED,
} satisfies Record<string, PlanProposalMachineState>;
type StateName = keyof typeof STATES;

const EVENTS = {
  recordHost: RECORD_HOST,
  recordAgent: RECORD_AGENT,
  recordAnswer: RECORD_ANSWER,
  acceptHost: ACCEPT_HOST,
  acceptAgent: ACCEPT_AGENT,
  stale: STALE,
  reject: REJECT,
} satisfies Record<string, PlanProposalEvent>;
type EventName = keyof typeof EVENTS;

/** The world each pair is evaluated in: an initial candidate is adopted while the pointer is still null. */
function worldFor(state: StateName, event: EventName): PlanProposalGuardContext {
  const agent = event === 'recordAgent' || event === 'acceptAgent';
  const initialAdoption = state === 'candidateInitial' && (event === 'acceptHost' || event === 'acceptAgent');
  return context({ agentAdmission: agent ? 'ok' : null, ...(event === 'acceptAgent' ? { future: AGENT_FUTURE_FACTS } : {}),
    ...(initialAdoption ? pointer(null) : {}) });
}

const EXISTS = no('illegal', 'revision_conflict', 'proposal proposal-1 already exists; only the original receipt replays');
/** The record is already this event's candidate@1 (§1.2): the service re-queries the receipt. */
const DUPLICATE = no('duplicate', 'revision_conflict',
  'proposal proposal-1 is already recorded with the same content; only its original receipt replays');
const NOT_PENDING = no('illegal', 'invalid', 'proposal proposal-1 is not a pending candidate');
const MISSING = no('illegal', 'not_found', 'proposal proposal-1 does not exist');

const TABLE: Record<StateName, Record<EventName, Expected>> = {
  absent: {
    recordHost: ok(CANDIDATE_INITIAL, RECORDED_HOST_EFFECTS),
    recordAgent: ok(CANDIDATE_FUTURE, RECORDED_AGENT_EFFECTS),
    recordAnswer: ok(CANDIDATE_INITIAL, RECORDED_ANSWER_EFFECTS),
    acceptHost: MISSING,
    acceptAgent: MISSING,
    stale: no('illegal', 'not_found'),
    reject: no('illegal', 'not_found'),
  },
  candidateInitial: {
    // RECORD_HOST and RECORD_ANSWER build exactly CANDIDATE_INITIAL (the writer is not stored).
    recordHost: DUPLICATE,
    recordAgent: EXISTS,
    recordAnswer: DUPLICATE,
    acceptHost: ok(acceptProposalRecord(CANDIDATE_INITIAL), INITIAL_ADOPTION_EFFECTS),
    acceptAgent: no('guard_failed', 'forbidden', 'a candidate without an Agent submission source cannot be adopted by an Agent'),
    // PLAN-06: basedOn null while the pointer is P1 — stale for good.
    stale: ok(CANDIDATE_INITIAL),
    reject: no('illegal', 'unsupported', 'rejecting a plan candidate has no writer in this batch (D-17)'),
  },
  candidateFuture: {
    recordHost: EXISTS,
    // RECORD_AGENT builds exactly CANDIDATE_FUTURE.
    recordAgent: DUPLICATE,
    recordAnswer: EXISTS,
    acceptHost: ok(acceptProposalRecord(CANDIDATE_FUTURE), futureAdoptionEffects({ agent: false })),
    acceptAgent: ok(acceptProposalRecord(CANDIDATE_FUTURE), futureAdoptionEffects({ agent: true })),
    stale: no('guard_failed', 'invalid'),
    reject: no('illegal', 'unsupported'),
  },
  accepted: {
    recordHost: EXISTS,
    recordAgent: EXISTS,
    recordAnswer: EXISTS,
    acceptHost: NOT_PENDING,
    acceptAgent: NOT_PENDING,
    stale: no('illegal', 'invalid'),
    reject: no('illegal', 'invalid', 'an accepted proposal is final; it cannot be rejected'),
  },
  rejected: {
    recordHost: EXISTS,
    recordAgent: EXISTS,
    recordAnswer: EXISTS,
    acceptHost: NOT_PENDING,
    acceptAgent: NOT_PENDING,
    stale: no('illegal', 'invalid'),
    reject: no('illegal', 'invalid'),
  },
};

describe('§3 transitionPlanProposal: every (state, event) pair', () => {
  const stateNames = Object.keys(STATES) as StateName[];
  const eventNames = Object.keys(EVENTS) as EventName[];

  it('the table covers every state and every event', () => {
    expect(Object.keys(TABLE)).toEqual(stateNames);
    for (const name of stateNames) expect(Object.keys(TABLE[name])).toEqual(eventNames);
    expect([...new Set(eventNames.map((name) => EVENTS[name].type))].sort())
      .toEqual(['proposal_accepted', 'proposal_recorded', 'proposal_rejected', 'proposal_stale']);
  });

  for (const stateName of stateNames) {
    for (const eventName of eventNames) {
      it(`${stateName} × ${eventName}`, () => {
        const state = deepFreeze(structuredClone(STATES[stateName]));
        const event = deepFreeze(structuredClone(EVENTS[eventName]));
        const ctx = deepFreeze(worldFor(stateName, eventName));
        expectResult(transitionPlanProposal(state, event, ctx), TABLE[stateName][eventName]);
      });
    }
  }

  it('a no-change legal event (PLAN-06 stale read) returns ok:true and no effects (SD-1)', () => {
    const result = transitionPlanProposal(CANDIDATE_INITIAL, STALE, context());
    expect(result).toEqual({ ok: true, next: CANDIDATE_INITIAL, effects: [] });
  });
});

// --------------------------------------------------------------------------
// PLAN-01..03: recording a candidate
// --------------------------------------------------------------------------

describe('PLAN-01 Host proposal_recorded (plan-service.ts:923-1055)', () => {
  const run = (event: RecordedEvent, ctx: PlanProposalGuardContext = context()) => transitionPlanProposal(null, event, ctx);

  it.each<[string, RecordedEvent, Partial<PlanProposalGuardContext>, Expected]>([
    ['the draft names another Goal (:1029)', { ...RECORD_HOST, draft: draftOf({ planId: 'plan-1', planRevision: 1, goalId: 'g-other' }) },
      {}, no('illegal', 'invalid', 'the draft goalId does not match the GoalRef')],
    ['a Host candidate never carries a submission provenance', { ...RECORD_HOST, submittedBy: PROVENANCE }, {},
      no('illegal', 'invalid')],
    ['the Goal is outside the bound workspace (:955)', RECORD_HOST, { goalInWorkspace: false },
      no('guard_failed', 'forbidden', 'the goal does not belong to the requested workspace')],
    ['the caller pins disagree with the versions read (:956-961)', RECORD_HOST, { pinsAgree: false },
      no('stale', 'revision_conflict', 'the supplied version pins do not match the versions read in this call')],
  ])('%s', (_name, event, overrides, expected) => {
    expectResult(run(event, context(overrides)), expected);
  });

  it('checks the workspace before the pins', () => {
    expectResult(run(RECORD_HOST, context({ goalInWorkspace: false, pinsAgree: false })), no('guard_failed', 'forbidden'));
  });

  it('records validatePlanDraft issues without blocking (diagnostics only)', () => {
    const issues: PlanValidationError[] = [{ path: 'obligations', code: 'missing_required_obligation', message: 'none yet' }];
    const result = run({ ...RECORD_HOST, issues });
    expect(result.ok && result.next?.issues).toEqual(issues);
  });

  it.each<[string, PlanRevisionRef | null, PlanRevisionRef | null]>([
    ['basedOn null after the pointer moved (born stale, W1-future-plan.test.ts:471-473)', null, P1],
    ['basedOn an older existing plan', P0, P1],
    ['basedOn a planId that does not exist yet (GAP-14: no basedOn guard)', planRef('plan-future'), P1],
    ['basedOn the active plan', P1, P1],
  ])('never refuses for its basedOn: %s', (_name, basedOn, active) => {
    const result = run({ ...RECORD_HOST, basedOn }, context(pointer(active)));
    expect(result.ok).toBe(true);
  });
});

describe('PLAN-03 initial answer proposal_recorded (plan-service.ts:1244-1333)', () => {
  it('records an initial candidate with the Answer/Job/QueryRun guards in the same commit (:1325-1329)', () => {
    expectResult(transitionPlanProposal(null, RECORD_ANSWER, context(pointer(null))), ok(CANDIDATE_INITIAL, RECORDED_ANSWER_EFFECTS));
  });

  it('is never based on a plan', () => {
    expectResult(transitionPlanProposal(null, { ...RECORD_ANSWER, basedOn: P1 }, context()), no('illegal', 'invalid'));
  });

  it('shares the Host scope guards', () => {
    expectResult(transitionPlanProposal(null, RECORD_ANSWER, context({ pinsAgree: false })), no('stale', 'revision_conflict'));
  });
});

describe('PLAN-02 Agent proposal_recorded (plan-service.ts:1886-2011)', () => {
  const agentCtx = (overrides: Partial<PlanProposalGuardContext> = {}) => context({ agentAdmission: 'ok', ...overrides });

  it.each<[string, RecordedEvent, Partial<PlanProposalGuardContext>, Expected]>([
    ['the draft names another Goal (:1029)', { ...RECORD_AGENT, draft: draftOf({ planId: 'plan-2', planRevision: 2, goalId: 'g-other' }) },
      {}, no('illegal', 'invalid', 'the draft goalId does not match the GoalRef')],
    ['no admitted provenance', { ...RECORD_AGENT, submittedBy: null }, {}, no('illegal', 'invalid')],
    ['no fresh admission verdict', RECORD_AGENT, { agentAdmission: null }, no('illegal', 'invalid')],
    ['admission: no V2 authorization or generation mismatch (plan-write-admission.ts:287-288,298-304)', RECORD_AGENT,
      { agentAdmission: rejection('forbidden', 'the Run is not entered') }, no('guard_failed', 'forbidden', 'the Run is not entered')],
    ['admission: Run not running, lease or Session lost (plan-write-admission.ts:289,295-297,307-323)', RECORD_AGENT,
      { agentAdmission: rejection('busy', 'the Run is not running') }, no('guard_failed', 'busy', 'the Run is not running')],
    ['the Goal is outside the bound workspace (:1941-1943)', RECORD_AGENT, { goalInWorkspace: false },
      no('guard_failed', 'forbidden', 'the goal does not belong to the requested workspace')],
    ['the caller pins disagree (:1944-1950)', RECORD_AGENT, { pinsAgree: false }, no('stale', 'revision_conflict')],
    ['basedOn null (:1957-1958)', { ...RECORD_AGENT, basedOn: null }, {},
      no('guard_failed', 'forbidden', 'an Agent proposal must be based on an accepted source plan')],
    ['the source was not read', RECORD_AGENT, { source: null }, no('illegal', 'invalid')],
    ['the source belongs to another Goal (:1963-1965)', RECORD_AGENT, { source: { ...SOURCE, goalRef: { ...GOAL, goalId: 'g-other' } } },
      no('illegal', 'not_found', 'the source plan does not belong to the proposal goal')],
    ['the source belongs to another project', RECORD_AGENT, { source: { ...SOURCE, ref: { ...P1, projectId: 'p-other' } } },
      no('illegal', 'not_found')],
    ['the source is no longer the active plan (:1966-1970)', RECORD_AGENT, pointer(P2),
      no('stale', 'revision_conflict', 'the source plan is not the Goal current active plan')],
    ['the Goal has no active plan', RECORD_AGENT, pointer(null), no('stale', 'revision_conflict')],
  ])('%s', (_name, event, overrides, expected) => {
    expectResult(transitionPlanProposal(null, event, agentCtx(overrides)), expected);
  });

  it('runs the fresh admission before the Goal scope', () => {
    expectResult(transitionPlanProposal(null, RECORD_AGENT, agentCtx({ agentAdmission: rejection('busy', 'busy'), pinsAgree: false })),
      no('guard_failed', 'busy'));
    expectResult(transitionPlanProposal(null, { ...RECORD_AGENT, basedOn: null }, agentCtx({ goalInWorkspace: false })),
      no('guard_failed', 'forbidden', 'the goal does not belong to the requested workspace'));
  });

  it('checks every guard before the create CAS of an existing proposal', () => {
    expectResult(transitionPlanProposal(CANDIDATE_FUTURE, RECORD_AGENT, agentCtx(pointer(P2))), no('stale', 'revision_conflict',
      'the source plan is not the Goal current active plan'));
  });
});

describe('proposal_recorded on an existing record (create CAS ∅, §1.2 duplicate)', () => {
  // Committed between the receipt lookup and the read: today the store replays a
  // same-identity commit before its guards (in-memory-record-store.ts:256-265).
  const record = (state: PlanProposalMachineState, event: RecordedEvent, ctx: PlanProposalGuardContext = context()) =>
    transitionPlanProposal(deepFreeze(state), deepFreeze(event), ctx);
  const issues: PlanValidationError[] = [{ path: 'obligations', code: 'missing_required_obligation', message: 'none yet' }];

  it('the same content in another key order and with other diagnostics is a duplicate (Host)', () => {
    const decoded = Object.fromEntries(Object.entries({ ...CANDIDATE_INITIAL, issues }).reverse()) as unknown as CandidatePlanProposal;
    expectResult(record(decoded, RECORD_HOST), DUPLICATE);
  });

  it('the same Agent content with the same provenance is a duplicate', () => {
    expectResult(record(CANDIDATE_FUTURE, RECORD_AGENT, context({ agentAdmission: 'ok' })), DUPLICATE);
  });

  it.each<[string, PlanProposalMachineState, RecordedEvent]>([
    ['another reason', CANDIDATE_INITIAL, { ...RECORD_HOST, reason: { ...REASON, text: 'another reason' } }],
    ['another basedOn', CANDIDATE_INITIAL, { ...RECORD_HOST, basedOn: P1 }],
    ['the same Agent content under another provenance', CANDIDATE_FUTURE,
      { ...RECORD_AGENT, submittedBy: { ...PROVENANCE, authorizationRevision: 3 } }],
    ['a Host request for an Agent candidate (no provenance)', CANDIDATE_FUTURE, { ...RECORD_HOST, basedOn: P1, draft: FUTURE_DRAFT }],
    ['the same content already accepted (past the target state)', acceptProposalRecord(CANDIDATE_INITIAL), RECORD_HOST],
    ['the same content at another revision', { ...CANDIDATE_INITIAL, revision: 2 }, RECORD_HOST],
  ])('other content keeps today\'s create CAS result: %s', (_name, state, event) => {
    const ctx = context({ agentAdmission: event.writer === 'agent' ? 'ok' : null });
    expectResult(record(state, event, ctx), EXISTS);
  });

  it('the write guards still run first', () => {
    expectResult(record(CANDIDATE_INITIAL, RECORD_HOST, context({ pinsAgree: false })), no('stale', 'revision_conflict',
      'the supplied version pins do not match the versions read in this call'));
  });
});

// --------------------------------------------------------------------------
// PLAN-04: initial adoption
// --------------------------------------------------------------------------

describe('PLAN-04 initial proposal_accepted (plan-service.ts:1140-1215)', () => {
  const initialCtx = (overrides: Partial<PlanProposalGuardContext> = {}) => context({ ...pointer(null), ...overrides });
  const adopt = (event: AcceptedEvent, ctx: PlanProposalGuardContext, state: PlanProposalMachineState = CANDIDATE_INITIAL) =>
    transitionPlanProposal(state, event, ctx);
  const facts = (overrides: Partial<InitialAdoptionFacts>): Partial<PlanProposalGuardContext> => ({ initial: { ...INITIAL_FACTS, ...overrides } });
  const issue = (code: PlanValidationError['code']): PlanValidationError => ({ path: 'tasks', code, message: code });

  it.each<[string, AcceptedEvent, Partial<PlanProposalGuardContext>, Expected]>([
    ['the expected revision is old (:1146-1149)', { ...ACCEPT_HOST, expectedProposalRevision: 2 }, {},
      no('stale', 'revision_conflict', 'the proposal revision changed')],
    ['the Goal is outside the proposal workspace (:1656)', ACCEPT_HOST, { goalInWorkspace: false },
      no('guard_failed', 'forbidden', 'the goal does not belong to the proposal workspace')],
    ['the caller pins disagree (:1660-1664)', ACCEPT_HOST, { pinsAgree: false }, no('stale', 'revision_conflict')],
    ['decisionRefs are not empty (:1165)', { ...ACCEPT_HOST, decisionRefs: [{ ref: GOAL, revision: 1 }] }, {},
      no('guard_failed', 'invalid', 'an initial plan adoption does not accept decision references')],
    ['the pointer is no longer null (:1166-1170)', ACCEPT_HOST, pointer(P0),
      no('stale', 'revision_conflict', 'the goal already has an active plan; an initial adoption cannot replace it')],
    ['the facts were not read', ACCEPT_HOST, { initial: null }, no('illegal', 'invalid')],
    ['the model origin does not verify (:1171-1176)', ACCEPT_HOST, facts({ origin: rejection('invalid', 'not the unique normalization') }),
      no('guard_failed', 'invalid', 'not the unique normalization')],
    ['governance is not resolvable (:1178-1179)', ACCEPT_HOST, facts({ governance: rejection('unavailable', 'policy corrupt') }),
      no('guard_failed', 'unavailable', 'policy corrupt')],
    ['a structural draft issue → invalid (:1181, :215-223)', ACCEPT_HOST, facts({ draftIssues: [issue('dag_cycle')] }),
      no('guard_failed', 'invalid', 'the initial plan is not admissible: tasks: dag_cycle')],
    ['a completeness draft issue → incomplete', ACCEPT_HOST, facts({ draftIssues: [issue('missing_required_obligation')] }),
      no('guard_failed', 'incomplete')],
    ['an execution-intent seam issue → unsupported', ACCEPT_HOST,
      facts({ draftIssues: [issue('missing_required_obligation'), issue('unsupported_execution_change')] }),
      no('guard_failed', 'unsupported')],
    ['an assignment gap (:1182-1183)', ACCEPT_HOST, facts({ assignmentReasons: ['task t-build has no assignment'] }),
      no('guard_failed', 'incomplete', 'the initial plan is not admissible: task t-build has no assignment')],
    ['a stored phase claims progress (planPhaseGuardReasons, :1184-1185; R5b-initial-plan.test.ts:316)', ACCEPT_HOST,
      facts({ phaseReasons: ["task t-build declares phase 'satisfied' before any completion evidence"] }),
      no('guard_failed', 'incomplete')],
  ])('%s', (_name, event, overrides, expected) => {
    expectResult(adopt(event, initialCtx(overrides)), expected);
  });

  it('keeps today\'s order: revision, scope, decisionRefs, pointer, origin, governance, draft, assignments, phase', () => {
    const all = initialCtx({ ...pointer(P0), initial: { modules: 'ok', origin: rejection('invalid', 'o'), governance: rejection('unavailable', 'g'),
      draftIssues: [issue('dag_cycle')], assignmentReasons: ['a'], phaseReasons: ['p'] } });
    expectResult(adopt({ ...ACCEPT_HOST, expectedProposalRevision: 3 }, { ...all, pinsAgree: false }),
      no('stale', 'revision_conflict', 'the proposal revision changed'));
    expectResult(adopt(ACCEPT_HOST, { ...all, goalInWorkspace: false, pinsAgree: false }), no('guard_failed', 'forbidden'));
    expectResult(adopt({ ...ACCEPT_HOST, decisionRefs: [{ ref: GOAL, revision: 1 }] }, all), no('guard_failed', 'invalid',
      'an initial plan adoption does not accept decision references'));
    expectResult(adopt(ACCEPT_HOST, all), no('stale', 'revision_conflict'));
    expectResult(adopt(ACCEPT_HOST, { ...all, goal: { activePlanRevision: null, desiredState: 'active' } }), no('guard_failed', 'invalid', 'o'));
  });

  it('a model-origin draft joins the origin guards first (plan-service.ts:1174-1176, :1188)', () => {
    const draft = { ...INITIAL_DRAFT, origin: { kind: 'initial_coordination' } as unknown as InitialPlanOrigin } as PlanRevisionDraft;
    const proposal = candidate({ basedOn: null, draft, catalogPin: PIN });
    const result = adopt(ACCEPT_HOST, initialCtx(), proposal);
    expectResult(result, ok(acceptProposalRecord(proposal), [...INITIAL_ADOPTION_EFFECTS.slice(0, 4), g({ target: 'origin_sources' }),
      ...INITIAL_ADOPTION_EFFECTS.slice(4)]));
  });

  it('an Agent can never take the initial path', () => {
    const agentInitial = candidate({ basedOn: null, draft: INITIAL_DRAFT, catalogPin: PIN, submittedBy: PROVENANCE });
    expectResult(adopt(ACCEPT_AGENT, initialCtx({ agentAdmission: 'ok' }), agentInitial),
      no('guard_failed', 'forbidden', 'an Agent apply requires a future revision with a source plan'));
  });
});

// --------------------------------------------------------------------------
// PLAN-05: future-only adoption (W16)
// --------------------------------------------------------------------------

describe('PLAN-05 future-only proposal_accepted (applyFutureRevision, plan-service.ts:1676-1816)', () => {
  const adopt = (event: AcceptedEvent, overrides: Partial<PlanProposalGuardContext> = {},
    state: PlanProposalMachineState = CANDIDATE_FUTURE) => transitionPlanProposal(state, event, context(overrides));
  const facts = (overrides: Partial<FutureAdoptionFacts>): Partial<PlanProposalGuardContext> => ({ future: { ...FUTURE_FACTS, ...overrides } });
  const withDraft = (draft: PlanRevisionDraft) => candidate({ basedOn: P1, draft, catalogPin: PIN, submittedBy: PROVENANCE });
  const issue = (code: PlanValidationError['code']): PlanValidationError => ({ path: 'tasks', code, message: code });

  it.each<[string, AcceptedEvent, Partial<PlanProposalGuardContext>, PlanProposalMachineState, Expected]>([
    ['decisionRefs are not empty (:1703-1705)', { ...ACCEPT_HOST, decisionRefs: [{ ref: GOAL, revision: 1 }] }, {}, CANDIDATE_FUTURE,
      no('guard_failed', 'unsupported', 'a W1 future-only revision does not accept decision references')],
    ['the source was not read', ACCEPT_HOST, { source: null }, CANDIDATE_FUTURE, no('illegal', 'invalid')],
    ['the source belongs to another Goal (:1709-1711)', ACCEPT_HOST, { source: { ...SOURCE, goalRef: { ...GOAL, goalId: 'g-other' } } },
      CANDIDATE_FUTURE, no('illegal', 'not_found', 'the source plan does not belong to the proposal goal')],
    ['basedOn is no longer the active plan (:1712-1717; W1-future-plan.test.ts:462)', ACCEPT_HOST, pointer(P2), CANDIDATE_FUTURE,
      no('stale', 'revision_conflict', 'the source plan is not the Goal current active plan')],
    ['the Goal pointer is null', ACCEPT_HOST, pointer(null), CANDIDATE_FUTURE, no('stale', 'revision_conflict')],
    ['the draft names another Goal (:1718-1720)', ACCEPT_HOST, {},
      withDraft(draftOf({ planId: 'plan-2', planRevision: 2, goalId: 'g-other' })),
      no('illegal', 'invalid', 'the draft goalId does not match the proposal goal')],
    ['planRevision is not source+1 (:1721-1723)', ACCEPT_HOST, {}, withDraft(draftOf({ planId: 'plan-2', planRevision: 3 })),
      no('stale', 'revision_conflict', 'the target planRevision must be exactly source+1')],
    ['the target planId is the source planId (:1724-1726)', ACCEPT_HOST, {}, withDraft(draftOf({ planId: 'plan-1', planRevision: 2 })),
      no('illegal', 'invalid', 'the target planId must be a new, unused reference')],
    ['the facts were not read', ACCEPT_HOST, { future: null }, CANDIDATE_FUTURE, no('illegal', 'invalid')],
    ['the target already exists (:1727-1733)', ACCEPT_HOST, facts({ targetExists: true }), CANDIDATE_FUTURE,
      no('stale', 'revision_conflict', 'the target plan already exists')],
    ['a Task was physically removed (plan-validation.ts:318-321 → :1737-1738)', ACCEPT_HOST,
      facts({ delta: { status: 'unsupported', reason: 'W1 cannot physically remove task t-build; record a disposition instead' } }),
      CANDIDATE_FUTURE, no('guard_failed', 'unsupported', 'W1 cannot physically remove task t-build; record a disposition instead')],
    ['coverage cannot be extracted (:1741)', ACCEPT_HOST, facts({ coverage: { status: 'unsupported', reason: 'gate g cannot be extracted' } }),
      CANDIDATE_FUTURE, no('guard_failed', 'unsupported', 'gate g cannot be extracted')],
    ['a source gate definition changed (plan-validation.ts:415-434 → :1742-1744)', ACCEPT_HOST,
      facts({ coverage: { status: 'rejected', issues: [{ path: 'tasks[1]', code: 'gate_definition_changed', message: 'gate frozen' }] } }),
      CANDIDATE_FUTURE, no('guard_failed', 'invalid', 'the future plan is not admissible: tasks[1]: gate frozen')],
    ['an added Task does not start pending (plan-validation.ts:472-477)', ACCEPT_HOST,
      facts({ coverage: { status: 'rejected', issues: [{ path: 'tasks[2]', code: 'unsupported_execution_change', message: 'not pending' }] } }),
      CANDIDATE_FUTURE, no('guard_failed', 'invalid')],
    ['the pinned policy is not readable (:1755-1761)', ACCEPT_HOST, facts({ pinnedPolicy: rejection('unavailable', 'pin unreadable') }),
      CANDIDATE_FUTURE, no('guard_failed', 'unavailable', 'pin unreadable')],
    ['a structural draft issue (:1762-1763)', ACCEPT_HOST, facts({ draftIssues: [issue('hierarchy_cycle')] }), CANDIDATE_FUTURE,
      no('guard_failed', 'invalid', 'the future plan is not admissible: tasks: hierarchy_cycle')],
    ['an assignment gap (:1764-1765)', ACCEPT_HOST, facts({ assignmentReasons: ['x'] }), CANDIDATE_FUTURE,
      no('guard_failed', 'incomplete', 'the future plan is not admissible: x')],
    ['a stored phase claims progress (:1766-1767)', ACCEPT_HOST, facts({ phaseReasons: ['y'] }), CANDIDATE_FUTURE,
      no('guard_failed', 'incomplete', 'the future plan is not admissible: y')],
    ['an added Task already has a Run (untraced rule, plan-readers.ts:1276)', ACCEPT_HOST,
      facts({ touchedTaskFacts: [{ ...DOCS_FACTS, runs: [runOf('run-docs', 't-docs')] }] }), CANDIDATE_FUTURE,
      no('guard_failed', 'revision_conflict', 'task t-docs already has a Run and is no longer a future task')],
    ['a changed Task holds a TaskLease (plan-readers.ts:1286)', ACCEPT_HOST,
      facts({ delta: delta(['t-build'], []),
        touchedTaskFacts: [{ taskId: 't-build', runs: [], lease: leaseOf('t-build', true), reduction: null }] }), CANDIDATE_FUTURE,
      no('guard_failed', 'revision_conflict', 'task t-build already holds a TaskLease and is no longer a future task')],
    ['a changed Task has a Reduction (plan-readers.ts:1294)', ACCEPT_HOST,
      facts({ delta: delta(['t-build'], []),
        touchedTaskFacts: [{ taskId: 't-build', runs: [], lease: null, reduction: reductionOf('t-build') }] }), CANDIDATE_FUTURE,
      no('guard_failed', 'revision_conflict', 'task t-build already has a formal reduction and is no longer a future task')],
    ['the facts of a touched Task were not read', ACCEPT_HOST, facts({ touchedTaskFacts: [] }), CANDIDATE_FUTURE,
      no('illegal', 'invalid', 'the future-change facts of task t-docs were not read')],
  ])('%s', (_name, event, overrides, state, expected) => {
    expectResult(adopt(event, overrides, state), expected);
  });

  it('a Goal that is paused does not stop a plan adoption (PLAN-05)', () => {
    expectResult(adopt(ACCEPT_HOST, pointer(P1, 'paused')),
      ok(acceptProposalRecord(CANDIDATE_FUTURE), futureAdoptionEffects({ agent: false })));
  });

  it('a new obligation joins the pinned policy guards (:1748-1761)', () => {
    expectResult(adopt(ACCEPT_HOST, facts({ pinnedPolicy: 'ok' })),
      ok(acceptProposalRecord(CANDIDATE_FUTURE), futureAdoptionEffects({ agent: false, pinnedPolicy: true })));
  });

  it('guards the Lease ∅ / Reduction ∅ of every changed and added Task (:1773-1782)', () => {
    const touched = facts({ delta: delta(['t-build'], ['t-docs']),
      touchedTaskFacts: [DOCS_FACTS, { taskId: 't-build', runs: [], lease: null, reduction: null }] });
    expectResult(adopt(ACCEPT_HOST, touched),
      ok(acceptProposalRecord(CANDIDATE_FUTURE), futureAdoptionEffects({ agent: false, changed: ['t-build'], added: ['t-docs'] })));
  });

  it('keeps today\'s order: schema, decisions, source, pointer, draft goal, revision, planId, target, delta, coverage, policy, draft, trace', () => {
    const everything = facts({ targetExists: true, delta: { status: 'unsupported', reason: 'removed' },
      coverage: { status: 'unsupported', reason: 'c' }, pinnedPolicy: rejection('unavailable', 'p'),
      draftIssues: [issue('dag_cycle')], touchedTaskFacts: [] });
    expectResult(adopt(ACCEPT_HOST, { ...everything, ...pointer(P2) }), no('stale', 'revision_conflict',
      'the source plan is not the Goal current active plan'));
    // Target identity (:1718-1726): draft goal, then planRevision, then planId.
    expectResult(adopt(ACCEPT_HOST, everything, withDraft(draftOf({ planId: 'plan-1', planRevision: 3, goalId: 'g-other' }))),
      no('illegal', 'invalid', 'the draft goalId does not match the proposal goal'));
    expectResult(adopt(ACCEPT_HOST, everything, withDraft(draftOf({ planId: 'plan-1', planRevision: 3 }))),
      no('stale', 'revision_conflict', 'the target planRevision must be exactly source+1'));
    expectResult(adopt(ACCEPT_HOST, everything, withDraft(draftOf({ planId: 'plan-2', planRevision: 5 }))),
      no('stale', 'revision_conflict', 'the target planRevision must be exactly source+1'));
    expectResult(adopt(ACCEPT_HOST, everything), no('stale', 'revision_conflict', 'the target plan already exists'));
    expectResult(adopt(ACCEPT_HOST, facts({ delta: { status: 'unsupported', reason: 'removed' }, coverage: { status: 'unsupported', reason: 'c' } })),
      no('guard_failed', 'unsupported', 'removed'));
    expectResult(adopt(ACCEPT_HOST, facts({ pinnedPolicy: rejection('unavailable', 'p'), draftIssues: [issue('dag_cycle')] })),
      no('guard_failed', 'unavailable', 'p'));
    expectResult(adopt(ACCEPT_HOST, facts({ phaseReasons: ['phase'],
      touchedTaskFacts: [{ ...DOCS_FACTS, runs: [runOf('run-docs', 't-docs')] }] })),
      no('guard_failed', 'incomplete', 'the future plan is not admissible: phase'));
  });

  it('the untraced rule reports every Run before any Lease or Reduction (plan-readers.ts:1268-1297)', () => {
    const touched = facts({ delta: delta(['t-build'], ['t-docs']),
      touchedTaskFacts: [{ taskId: 't-build', runs: [], lease: leaseOf('t-build', false), reduction: null },
        { ...DOCS_FACTS, runs: [runOf('run-docs', 't-docs')] }] });
    expectResult(adopt(ACCEPT_HOST, touched), no('guard_failed', 'revision_conflict',
      'task t-docs already has a Run and is no longer a future task'));
  });
});

describe('PLAN-05 Agent proposal_accepted (applyPlanChangeAsAgent, plan-service.ts:2019-2106)', () => {
  const agentCtx = (overrides: Partial<PlanProposalGuardContext> = {}) =>
    context({ agentAdmission: 'ok', future: AGENT_FUTURE_FACTS, ...overrides });
  const otherWriter = (patch: Partial<AgentPlanWriterIdentity>): AcceptedEvent => ({ ...ACCEPT_AGENT, agentWriter: { ...WRITER, ...patch } });

  it.each<[string, PlanProposalMachineState, AcceptedEvent, Partial<PlanProposalGuardContext>, Expected]>([
    ['decisionRefs are not empty, before any read (:2034-2036)', null, { ...ACCEPT_AGENT, decisionRefs: [{ ref: GOAL, revision: 1 }] }, {},
      no('guard_failed', 'forbidden', 'an Agent future-plan apply does not accept decision references')],
    ['no fresh admission verdict', CANDIDATE_FUTURE, ACCEPT_AGENT, { agentAdmission: null }, no('illegal', 'invalid')],
    ['the admission fails, before the proposal read (:2057-2062)', null, ACCEPT_AGENT,
      { agentAdmission: rejection('forbidden', 'the Run has ended') }, no('guard_failed', 'forbidden', 'the Run has ended')],
    ['the admission sees a newer version', CANDIDATE_FUTURE, ACCEPT_AGENT,
      { agentAdmission: rejection('revision_conflict', 'changed') }, no('stale', 'revision_conflict')],
    ['the writer was not identified', CANDIDATE_FUTURE, { ...ACCEPT_AGENT, agentWriter: null }, {}, no('illegal', 'invalid')],
    ['a Host candidate without submittedBy (:2075-2078)', candidate({ basedOn: P1, draft: FUTURE_DRAFT, catalogPin: PIN }), ACCEPT_AGENT, {},
      no('guard_failed', 'forbidden', 'a candidate without an Agent submission source cannot be adopted by an Agent')],
    ['submitted by another Run (:2079-2082)', CANDIDATE_FUTURE, otherWriter({ runRef: runRef('run-other') }), {},
      no('guard_failed', 'forbidden', 'the candidate was submitted by another Agent Run')],
    ['submitted through another Session', CANDIDATE_FUTURE, otherWriter({ sessionRef: { ...SESSION, sessionId: 's-other' } }), {},
      no('guard_failed', 'forbidden', 'the candidate was submitted by another Agent Run')],
    ['submitted under another role binding', CANDIDATE_FUTURE, otherWriter({ roleBinding: { ...ROLE, bindingVersion: 2 } }), {},
      no('guard_failed', 'forbidden', 'the candidate was submitted by another Agent Run')],
    ['the candidate Goal is not the writer Goal (:2083-2086)', CANDIDATE_FUTURE, otherWriter({ goalRef: { ...GOAL, goalId: 'g-other' } }), {},
      no('guard_failed', 'forbidden', 'the candidate goal is not the Agent Run goal')],
    ['the Goal is outside the proposal workspace (:2088-2089 → :1656)', CANDIDATE_FUTURE, ACCEPT_AGENT, { goalInWorkspace: false },
      no('guard_failed', 'forbidden', 'the goal does not belong to the proposal workspace')],
  ])('%s', (_name, state, event, overrides, expected) => {
    expectResult(transitionPlanProposal(state, event, agentCtx(overrides)), expected);
  });

  it('checks decisionRefs before the fresh admission (:2034-2036 runs before :2057-2062)', () => {
    const withDecisions: AcceptedEvent = { ...ACCEPT_AGENT, decisionRefs: [{ ref: GOAL, revision: 1 }] };
    for (const state of [null, CANDIDATE_FUTURE]) {
      expectResult(transitionPlanProposal(state, withDecisions, agentCtx({ agentAdmission: rejection('busy', 'busy') })),
        no('guard_failed', 'forbidden', 'an Agent future-plan apply does not accept decision references'));
    }
  });

  it('reads the state after the Agent pre-checks: not pending and old revisions keep their codes', () => {
    expectResult(transitionPlanProposal(ACCEPTED, ACCEPT_AGENT, agentCtx()), no('illegal', 'invalid'));
    expectResult(transitionPlanProposal(CANDIDATE_FUTURE, { ...ACCEPT_AGENT, expectedProposalRevision: 2 }, agentCtx()),
      no('stale', 'revision_conflict', 'the proposal revision changed'));
  });

  it('then runs the same future path as the Host', () => {
    expectResult(transitionPlanProposal(CANDIDATE_FUTURE, ACCEPT_AGENT, agentCtx(pointer(P2))), no('stale', 'revision_conflict'));
  });
});

// --------------------------------------------------------------------------
// planProposalProblem: the same guards over the facts read so far (A.2 step 3)
// --------------------------------------------------------------------------

describe('planProposalProblem (the owner asks after each read)', () => {
  const refusalOf = (result: PlanProposalTransition) => (result.ok ? null
    : { ok: false, reason: result.reason, detail: result.detail, code: result.code });

  it('agrees with transitionPlanProposal on every propose/apply pair once every fact is read', () => {
    for (const stateName of Object.keys(STATES) as StateName[]) {
      for (const eventName of ['recordHost', 'recordAgent', 'recordAnswer', 'acceptHost', 'acceptAgent'] as const) {
        const event = EVENTS[eventName] as RecordedEvent | AcceptedEvent;
        const ctx = worldFor(stateName, eventName);
        expect(planProposalProblem(STATES[stateName], event, ctx), `${stateName} × ${eventName}`)
          .toEqual(refusalOf(transitionPlanProposal(STATES[stateName], event, ctx)));
      }
    }
  });

  it('agrees on every refusal of the guard tables above', () => {
    const cases: Array<[PlanProposalMachineState, RecordedEvent | AcceptedEvent, PlanProposalGuardContext]> = [
      [null, { ...RECORD_HOST, submittedBy: PROVENANCE }, context()],
      [null, RECORD_HOST, context({ goalInWorkspace: false, pinsAgree: false })],
      [null, RECORD_AGENT, context({ agentAdmission: rejection('busy', 'the Run is not running') })],
      [null, { ...RECORD_AGENT, basedOn: null }, context({ agentAdmission: 'ok' })],
      [null, RECORD_AGENT, context({ agentAdmission: 'ok', ...pointer(P2) })],
      [CANDIDATE_INITIAL, ACCEPT_HOST, context({ ...pointer(null), initial: { ...INITIAL_FACTS, phaseReasons: ['p'] } })],
      [CANDIDATE_FUTURE, ACCEPT_HOST, context({ future: { ...FUTURE_FACTS, targetExists: true } })],
      [CANDIDATE_FUTURE, ACCEPT_HOST, context({ future: { ...FUTURE_FACTS,
        touchedTaskFacts: [{ ...DOCS_FACTS, runs: [runOf('run-docs', 't-docs')] }] } })],
      [CANDIDATE_FUTURE, { ...ACCEPT_AGENT, agentWriter: { ...WRITER, runRef: runRef('run-other') } }, context({ agentAdmission: 'ok' })],
    ];
    for (const [state, event, ctx] of cases) {
      const expected = refusalOf(transitionPlanProposal(state, event, ctx));
      expect(expected).not.toBeNull();
      expect(planProposalProblem(state, event, ctx)).toEqual(expected);
    }
  });

  it('an unread fact holds: the guards after it wait for the read (Host adoption)', () => {
    const initialWithDecisions: AcceptedEvent = { ...ACCEPT_HOST, decisionRefs: [{ ref: GOAL, revision: 1 }] };
    // The proposal is read, the scope is not: the initial decisionRefs check comes after the scope.
    expect(planProposalProblem(CANDIDATE_INITIAL, initialWithDecisions, {})).toBeNull();
    expectResult(planProposalProblem(CANDIDATE_INITIAL, { ...ACCEPT_HOST, expectedProposalRevision: 2 }, {})!,
      no('stale', 'revision_conflict', 'the proposal revision changed'));
    const scope: PlanProposalReadFacts = { goal: { activePlanRevision: null, desiredState: 'active' }, goalInWorkspace: true, pinsAgree: true };
    expectResult(planProposalProblem(CANDIDATE_INITIAL, initialWithDecisions, scope)!, no('guard_failed', 'invalid'));
    // Origin read and holding; governance not read yet: nothing after it is judged.
    expect(planProposalProblem(CANDIDATE_INITIAL, ACCEPT_HOST, { ...scope, initial: { origin: 'ok' } })).toBeNull();
    expectResult(planProposalProblem(CANDIDATE_INITIAL, ACCEPT_HOST,
      { ...scope, initial: { origin: rejection('invalid', 'not the unique normalization') } })!,
    no('guard_failed', 'invalid', 'not the unique normalization'));
    // The draft validators run one after the other.
    expect(planProposalProblem(CANDIDATE_INITIAL, ACCEPT_HOST,
      { ...scope, initial: { modules: 'ok', origin: 'ok', governance: 'ok', draftIssues: [] } })).toBeNull();
    expectResult(planProposalProblem(CANDIDATE_INITIAL, ACCEPT_HOST,
      { ...scope, initial: { modules: 'ok', origin: 'ok', governance: 'ok', draftIssues: [], assignmentReasons: ['a'] } })!,
    no('guard_failed', 'incomplete', 'the initial plan is not admissible: a'));
  });

  it('an unread fact holds: the guards after it wait for the read (future adoption)', () => {
    const scope: PlanProposalReadFacts = { goal: { activePlanRevision: P1, desiredState: 'active' }, goalInWorkspace: true, pinsAgree: true };
    const badTarget = candidate({ basedOn: P1, draft: draftOf({ planId: 'plan-2', planRevision: 5 }), catalogPin: PIN, submittedBy: PROVENANCE });
    // Source not read: the draft schema and decisionRefs are judged, the source-relative rules wait.
    expect(planProposalProblem(badTarget, ACCEPT_HOST, scope)).toBeNull();
    expectResult(planProposalProblem(badTarget, { ...ACCEPT_HOST, decisionRefs: [{ ref: GOAL, revision: 1 }] }, scope)!,
      no('guard_failed', 'unsupported', 'a W1 future-only revision does not accept decision references'));
    expectResult(planProposalProblem(badTarget, ACCEPT_HOST, { ...scope, source: SOURCE })!,
      no('stale', 'revision_conflict', 'the target planRevision must be exactly source+1'));
    const read = { ...scope, source: SOURCE };
    expect(planProposalProblem(CANDIDATE_FUTURE, ACCEPT_HOST, { ...read, future: { targetExists: false } })).toBeNull();
    expectResult(planProposalProblem(CANDIDATE_FUTURE, ACCEPT_HOST, { ...read, future: { targetExists: true } })!,
      no('stale', 'revision_conflict', 'the target plan already exists'));
    // Every validator holds, the touched Task facts are not read yet.
    const { touchedTaskFacts: _unread, ...validated } = FUTURE_FACTS;
    void _unread;
    expect(planProposalProblem(CANDIDATE_FUTURE, ACCEPT_HOST, { ...read, future: validated })).toBeNull();
    expectResult(planProposalProblem(CANDIDATE_FUTURE, ACCEPT_HOST, { ...read, future: { ...validated,
      touchedTaskFacts: [{ ...DOCS_FACTS, lease: leaseOf('t-docs', true) }] } })!,
    no('guard_failed', 'revision_conflict', 'task t-docs already holds a TaskLease and is no longer a future task'));
  });

  it('an Agent adoption judges decisionRefs and the fresh admission before the proposal is read', () => {
    expectResult(planProposalProblem(undefined, { ...ACCEPT_AGENT, decisionRefs: [{ ref: GOAL, revision: 1 }] }, {})!,
      no('guard_failed', 'forbidden', 'an Agent future-plan apply does not accept decision references'));
    expect(planProposalProblem(undefined, ACCEPT_AGENT, {})).toBeNull();
    expectResult(planProposalProblem(undefined, ACCEPT_AGENT, { agentAdmission: rejection('forbidden', 'the Run has ended') })!,
      no('guard_failed', 'forbidden', 'the Run has ended'));
    expect(planProposalProblem(undefined, ACCEPT_AGENT, { agentAdmission: 'ok' })).toBeNull();
  });

  it('an Agent proposal judges the fresh admission first: a refused admission has no provenance yet', () => {
    const noProvenance: RecordedEvent = { ...RECORD_AGENT, submittedBy: null };
    expectResult(planProposalProblem(null, noProvenance, { agentAdmission: rejection('busy', 'the lease is held by another Run') })!,
      no('guard_failed', 'busy', 'the lease is held by another Run'));
    expectResult(transitionPlanProposal(null, { ...noProvenance }, context({ agentAdmission: rejection('busy', 'lease lost') })),
      no('guard_failed', 'busy', 'lease lost'));
    // Admitted, the scope not read yet: nothing after the admission is judged.
    expect(planProposalProblem(null, RECORD_AGENT, { agentAdmission: 'ok' })).toBeNull();
    expectResult(planProposalProblem(null, RECORD_AGENT, { agentAdmission: 'ok', goalInWorkspace: true, pinsAgree: false })!,
      no('stale', 'revision_conflict'));
  });

  it('a proposal write is not refused for the unread proposal record (its absence is the commit CAS ∅)', () => {
    expect(planProposalProblem(undefined, RECORD_HOST, context())).toBeNull();
    expect(planProposalProblem(null, RECORD_HOST, context())).toBeNull();
    expectResult(planProposalProblem(CANDIDATE_INITIAL, RECORD_HOST, context())!, DUPLICATE);
  });
});

// --------------------------------------------------------------------------
// Today's results that step 5 flips (§15.2: implemented as today, flipped in place)
// --------------------------------------------------------------------------

describe('today\'s results pinned for the step 5 flips', () => {
  it('step 5.5 (D-9, §3.4): a cancelled Goal records and adopts no Plan, after the scope pins; a paused Goal does', () => {
    const cancelled = no('illegal', 'invalid', 'the Goal is cancelled; its plan can no longer change');
    expectResult(transitionPlanProposal(null, RECORD_HOST, context(pointer(P1, 'cancelled'))), cancelled);
    expectResult(transitionPlanProposal(null, RECORD_AGENT, context({ agentAdmission: 'ok', ...pointer(P1, 'cancelled') })), cancelled);
    expectResult(transitionPlanProposal(CANDIDATE_INITIAL, ACCEPT_HOST, context(pointer(null, 'cancelled'))), cancelled);
    expectResult(transitionPlanProposal(CANDIDATE_FUTURE, ACCEPT_HOST, context(pointer(P1, 'cancelled'))), cancelled);
    expectResult(transitionPlanProposal(CANDIDATE_FUTURE, ACCEPT_AGENT, context({ agentAdmission: 'ok', ...pointer(P1, 'cancelled') })),
      cancelled);
    // The workspace and the caller pins answer first (they are read with the Goal).
    expectResult(transitionPlanProposal(null, RECORD_HOST, context({ ...pointer(P1, 'cancelled'), goalInWorkspace: false })),
      no('guard_failed', 'forbidden'));
    expectResult(transitionPlanProposal(null, RECORD_HOST, context({ ...pointer(P1, 'cancelled'), pinsAgree: false })),
      no('stale', 'revision_conflict'));
    expect(planProposalProblem(null, RECORD_HOST, { goal: pointer(P1, 'cancelled').goal, goalInWorkspace: true, pinsAgree: true }))
      .toMatchObject({ code: 'invalid' });
    for (const [state, event] of [[null, RECORD_HOST], [CANDIDATE_INITIAL, ACCEPT_HOST], [CANDIDATE_FUTURE, ACCEPT_HOST]] as const) {
      const ctx = context(pointer(state === CANDIDATE_INITIAL ? null : P1, 'paused'));
      expect(transitionPlanProposal(state, event, ctx).ok).toBe(true);
    }
  });

  it('step 5.10 (C7, §3.4, flipped): the machine refuses an affectedTaskIds shape and a draft dispositionRecord (zero writes)', () => {
    const reason = { ...REASON, affectedTaskIds: ['t-missing', 't-missing'] };
    expectResult(transitionPlanProposal(null, { ...RECORD_HOST, reason }, context()),
      no('guard_failed', 'invalid', 'reason.affectedTaskIds names t-missing, which is not a task of the draft'));
    const draft = { ...INITIAL_DRAFT, dispositionRecord: { schemaVersion: 1, entries: [] } } as unknown as PlanRevisionDraft;
    expectResult(transitionPlanProposal(null, { ...RECORD_HOST, draft }, context()),
      no('guard_failed', 'invalid', 'the draft carries dispositionRecord, which only the adoption compiler writes'));
  });

  it('step 5.10 (C7, PLAN-05, flipped): a traced Task whose disposition alone changes goes through TASK-19, not the untraced rule', () => {
    const tracedChange = { future: { ...FUTURE_FACTS,
      delta: delta([], [], { dispositionOnlyTaskIds: ['t-build'],
        dispositionChanges: [{ taskId: 't-build', from: 'active', to: 'deferred', replacedByTaskId: null }] }),
      touchedTaskFacts: [], dispositionTaskFacts: [tracedFacts('t-build')] } };
    // TASK-19 guard 6: the candidate's reason does not list the traced Task.
    expectResult(transitionPlanProposal(CANDIDATE_FUTURE, ACCEPT_HOST, context(tracedChange)),
      no('guard_failed', 'invalid', 'reason.affectedTaskIds must list traced task t-build'));
  });
});

// --------------------------------------------------------------------------
// Derived statuses (PLAN-06, PLAN-08/09)
// --------------------------------------------------------------------------

describe('derivePlanProposalStatus (PLAN-06)', () => {
  it.each<[string, PlanProposalRecord, PlanRevisionRef | null, string]>([
    ['initial candidate before any adoption', CANDIDATE_INITIAL, null, 'candidate'],
    ['initial candidate after the pointer moved (irreversible)', CANDIDATE_INITIAL, P1, 'stale'],
    ['future candidate on the active plan', CANDIDATE_FUTURE, P1, 'candidate'],
    ['future candidate after the pointer moved past basedOn (irreversible)', CANDIDATE_FUTURE, P2, 'stale'],
    ['candidate on a planId that does not exist yet', candidate({ basedOn: planRef('plan-x'), draft: FUTURE_DRAFT, catalogPin: PIN }), P1, 'stale'],
    ['the same candidate once that planId is adopted (reversible, GAP-14)', candidate({ basedOn: planRef('plan-x'), draft: FUTURE_DRAFT, catalogPin: PIN }),
      planRef('plan-x'), 'candidate'],
    ['accepted', ACCEPTED, P2, 'accepted'],
    ['rejected', REJECTED, P1, 'rejected'],
  ])('%s', (_name, proposal, active, expected) => {
    expect(derivePlanProposalStatus(proposal, active)).toBe(expected);
  });
});

describe('derivePlanRevisionStatus (PLAN-08/09)', () => {
  it('the Goal pointer decides adopted vs superseded; the record never changes', () => {
    expect(derivePlanRevisionStatus(P1, P1)).toBe('adopted');
    expect(derivePlanRevisionStatus(P1, P2)).toBe('superseded');
    expect(derivePlanRevisionStatus(P1, { ...P1 })).toBe('adopted');
  });
});

describe('planRevisionTargetOf (PLAN-08)', () => {
  it('names the draft planId in the proposal project, with the ref bytes the adoption writes and the owner reads', () => {
    expect(JSON.stringify(planRevisionTargetOf(PROPOSAL_REF, INITIAL_DRAFT))).toBe(JSON.stringify(P1));
    expect(JSON.stringify(planRevisionTargetOf(PROPOSAL_REF, FUTURE_DRAFT))).toBe(JSON.stringify(P2));
  });
});

// --------------------------------------------------------------------------
// W16 pure guards
// --------------------------------------------------------------------------

describe('futureChangeTraceProblem (untraced rule, plan-readers.ts:1238-1301)', () => {
  const clean = (taskId: string): FutureChangeTaskFactsV1 => ({ taskId, runs: [], lease: null, reduction: null });

  it('passes untraced Tasks', () => {
    expect(futureChangeTraceProblem([clean('a'), clean('b')])).toBeNull();
    expect(futureChangeTraceProblem([])).toBeNull();
  });

  it('reports a Run of any Task before a Lease or Reduction of an earlier Task', () => {
    expect(futureChangeTraceProblem([{ ...clean('a'), reduction: reductionOf('a') }, { ...clean('b'), runs: [runOf('r-b', 'b')] }]))
      .toEqual({ code: 'revision_conflict', detail: 'task b already has a Run and is no longer a future task' });
  });

  it('then each Task\'s Lease before its Reduction, in input order', () => {
    expect(futureChangeTraceProblem([{ ...clean('a'), lease: leaseOf('a', true), reduction: reductionOf('a') }, { ...clean('b'), lease: leaseOf('b', false) }]))
      .toEqual({ code: 'revision_conflict', detail: 'task a already holds a TaskLease and is no longer a future task' });
    expect(futureChangeTraceProblem([{ ...clean('a'), reduction: reductionOf('a') }, { ...clean('b'), lease: leaseOf('b', false) }]))
      .toEqual({ code: 'revision_conflict', detail: 'task a already has a formal reduction and is no longer a future task' });
  });
});

describe('tracedDispositionChangeProblem (TASK-19 guards 8, 1, 2, 2b, 3–7; C7)', () => {
  const check = (tasks: TracedTaskFactsV1[], overrides: Partial<Parameters<typeof tracedDispositionChangeProblem>[0]> = {}) =>
    tracedDispositionChangeProblem({ goalDesiredState: 'active', tasks, affectedTaskIds: tasks.map((task) => task.taskId),
      adopterClass: 'agent', ...overrides });
  const codeOf = (problem: ReturnType<typeof tracedDispositionChangeProblem>) => problem?.code ?? null;
  const yielded = (desiredState?: 'running' | 'paused' | 'cancelled'): TracedTaskFactsV1 => {
    const ref = runRef('run-y');
    const intent = desiredState === 'cancelled' ? intentOf('ci-y', 'cancel', HUMAN, ref) : null;
    const run = runOf('run-y', 't-y', { outcome: 'yielded', exitCode: null,
      continuation: { schemaVersion: 1, kind: 'wait_reply', task: { projectId: PROJECT, goalId: GOAL_ID, taskId: 't-y' }, sessionRef: SESSION,
        messageRef: { aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'm-wait' } },
      ...(desiredState === undefined ? {} : { controlState: { intentRef: intent?.ref ?? { aggregateType: 'ControlIntent', projectId: PROJECT,
        workspaceId: WORKSPACE, intentId: 'ci-y' }, desiredState } }) });
    return tracedFacts('t-y', { runs: [run], selectedRun: run, pointerIntent: intent });
  };

  it('passes a traced, ended, released, unsatisfied, listed and unfenced Task', () => {
    expect(check([tracedFacts('t-a')])).toBeNull();
  });

  it.each<[string, TracedTaskFactsV1, CoreError]>([
    ['a starting Run (guard 1)', tracedFacts('t-a', { runs: [runOf('r1', 't-a', { status: 'starting', outcome: null, endedAt: null })] }), 'busy'],
    ['a running Run (guard 1)', tracedFacts('t-a', { runs: [runOf('r0', 't-a'), runOf('r1', 't-a', { status: 'running', outcome: null, endedAt: null })] }), 'busy'],
    ['an outcome_unknown Run (guard 2)', tracedFacts('t-a', { runs: [runOf('r1', 't-a', { outcome: 'outcome_unknown' })] }), 'busy'],
    ['an ended Run quarantined by reconciliation (guard 2b)', tracedFacts('t-a', { runs: [runOf('r1', 't-a', {
      reconciliation: { status: 'quarantined', observation: { kind: 'unresolved', reason: 'x', observedThroughPosition: null,
        unresolvedToolCallIds: ['tc-1'] }, basis: { kind: 'live_clean' }, recordedAt: T1 } })] }), 'busy'],
    ['an ended Run with an unresolved observation (guard 2b)', tracedFacts('t-a', { runs: [runOf('r1', 't-a', {
      reconciliation: { status: 'done', observation: { kind: 'unresolved', reason: 'x', observedThroughPosition: 3,
        unresolvedToolCallIds: [] }, basis: { kind: 'live_clean' }, recordedAt: T1 } })] }), 'busy'],
    ['an ended Run with an unknown V2 entry authorization (guard 2b)', tracedFacts('t-a', { runs: [runOf('r1', 't-a', {
      executionAuthorization: { schemaVersion: 2, generation: 1, sessionGeneration: 1, revision: 2, consumerId: 'driver',
        inputDigest: 'sha256:input', phase: 'unknown', kernel: null } })] }), 'busy'],
    ['a yielded wait with no pointer (guard 3)', yielded(), 'busy'],
    ['a yielded wait whose pointer is running (guard 3)', yielded('running'), 'busy'],
    ['a yielded wait whose pointer is paused (guard 3)', yielded('paused'), 'busy'],
    ['a Lease not released (guard 4)', tracedFacts('t-a', { lease: leaseOf('t-a', false) }), 'busy'],
    ['Runs without a Lease record (guard 4, legacy data)', tracedFacts('t-a', { lease: null }), 'unavailable'],
    ['a Reduction (guard 5: satisfied is final)', tracedFacts('t-a', { reduction: reductionOf('t-a') }), 'invalid'],
  ])('%s', (_name, facts, code) => {
    expect(codeOf(check([facts]))).toBe(code);
  });

  it('a cancelled yielded wait (P17) passes guard 3', () => {
    expect(check([yielded('cancelled')], { adopterClass: 'human' })).toBeNull();
  });

  it('a Reduction without Run or Lease is still traced and final (guard 5)', () => {
    expect(codeOf(check([{ taskId: 't-a', runs: [], selectedRun: null, lease: null, reduction: reductionOf('t-a'), pointerIntent: null }])))
      .toBe('invalid');
  });

  it('guard 6: reason.affectedTaskIds must list the traced Task', () => {
    expect(check([tracedFacts('t-a')], { affectedTaskIds: undefined }))
      .toEqual({ code: 'invalid', detail: 'reason.affectedTaskIds must list traced task t-a' });
    expect(codeOf(check([tracedFacts('t-a')], { affectedTaskIds: ['t-b'] }))).toBe('invalid');
  });

  it.each<[string, () => TracedTaskFactsV1]>([
    ['human cancel pointer (human_only)', () => humanCancelledFacts('t-a')],
    ['human pause, then a Host restart (human_only)', () => pausedInterruptedFacts('t-a', HUMAN)],
    ['Goal fan-out pause, then a Host restart (human_or_goal_resume)', () => pausedInterruptedFacts('t-a', { ...GOAL_FAN_OUT_ACTOR })],
  ])('guard 7: %s → forbidden for agent and system, allowed for human', (_name, facts) => {
    expect(codeOf(check([facts()], { adopterClass: 'agent' }))).toBe('forbidden');
    expect(codeOf(check([facts()], { adopterClass: 'system' }))).toBe('forbidden');
    expect(check([facts()], { adopterClass: 'human' })).toBeNull();
  });

  it('a cancel requested by the Workflow automation actor does not fence (stopRequester system)', () => {
    const ref = runRef('run-t-a');
    const intent = intentOf('ci-auto', 'cancel', { ...WORKFLOW_AUTOMATION_ACTOR }, ref);
    const run = runOf(ref.runId, 't-a', { outcome: 'cancelled', controlState: { intentRef: intent.ref, desiredState: 'cancelled' } });
    expect(check([tracedFacts('t-a', { runs: [run], selectedRun: run, pointerIntent: intent })], { adopterClass: 'system' })).toBeNull();
  });

  it('guard 8: a cancelled Goal is refused first; a paused Goal is not a reason', () => {
    const busy = tracedFacts('t-a', { runs: [runOf('r1', 't-a', { status: 'running', outcome: null, endedAt: null })] });
    expect(check([busy], { goalDesiredState: 'cancelled' })).toEqual({ code: 'invalid', detail: 'the Goal is cancelled; its plan can no longer change' });
    expect(codeOf(check([], { goalDesiredState: 'cancelled' }))).toBe('invalid');
    expect(check([tracedFacts('t-a')], { goalDesiredState: 'paused' })).toBeNull();
    expect(codeOf(check([busy], { goalDesiredState: 'paused' }))).toBe('busy');
  });

  it('checks guards 1..7 per Task in taskId order and skips untraced Tasks', () => {
    const untraced: TracedTaskFactsV1 = { taskId: 't-0', runs: [], selectedRun: null, lease: null, reduction: null, pointerIntent: null };
    const problems = check([tracedFacts('t-b', { reduction: reductionOf('t-b') }), untraced,
      tracedFacts('t-a', { lease: leaseOf('t-a', false) })], { affectedTaskIds: ['t-a', 't-b'] });
    // t-a sorts before t-b although it was listed last; the untraced t-0 is never checked.
    expect(problems).toEqual({ code: 'busy', detail: 'task t-a still holds its TaskLease' });
  });

  it('within one Task the guards run in order 1 → 2 → 2b → 3 → 4 → 5 → 6 → 7', () => {
    const quarantined = runOf('r-q', 't-a', { reconciliation: { status: 'quarantined', observation: { kind: 'unresolved', reason: 'x',
      observedThroughPosition: null, unresolvedToolCallIds: [] }, basis: { kind: 'live_clean' }, recordedAt: T1 } });
    const unknown = runOf('r-u', 't-a', { outcome: 'outcome_unknown' });
    const running = runOf('r9', 't-a', { status: 'running', outcome: null, endedAt: null });
    const wait = yielded();
    const all = { ...wait, taskId: 't-a', lease: leaseOf('t-a', false), reduction: reductionOf('t-a') };
    const detail = (facts: TracedTaskFactsV1) => check([facts], { affectedTaskIds: [] })?.detail;
    expect(detail({ ...all, runs: [quarantined, unknown, running, ...wait.runs] }))
      .toBe('task t-a still has an unfinished execution: run r9 is running');
    expect(detail({ ...all, runs: [quarantined, unknown, ...wait.runs] })).toBe('task t-a: resolve the unknown outcome of run r-u first');
    expect(detail({ ...all, runs: [quarantined, ...wait.runs] })).toMatch(/^task t-a: reconcile run r-q first: /);
    expect(detail(all)).toBe('task t-a: cancel or resume the yielded wait of run run-y first');
    const fenced = humanCancelledFacts('t-a');
    expect(check([{ ...fenced, lease: leaseOf('t-a', false), reduction: reductionOf('t-a') }], { affectedTaskIds: [] })?.detail)
      .toBe('task t-a still holds its TaskLease');
    const satisfied = { ...fenced, reduction: reductionOf('t-a') };
    expect(check([satisfied], { affectedTaskIds: [] })?.detail).toBe('task t-a is satisfied; the disposition of a satisfied task is final');
    expect(check([{ ...fenced }], { affectedTaskIds: [] })?.detail).toBe('reason.affectedTaskIds must list traced task t-a');
    expect(codeOf(check([{ ...fenced }]))).toBe('forbidden');
  });
});

describe('parallelCarrierFenceProblem (W16 guard 9, lead decision LA-3)', () => {
  const work = (taskId: string, disposition: RuntimeTask['disposition'] = 'active') => ({ taskId, taskKind: 'work' as const, disposition });
  const gate = (taskId: string) => ({ taskId, taskKind: 'gate' as const, disposition: 'active' as const });
  const view = (tasks: PlanCarrierViewV1['tasks'], obligations: Record<string, string[]>): PlanCarrierViewV1 => ({
    tasks, obligations: Object.entries(obligations).map(([obligationId, taskIds]) => ({ obligationId, taskIds })),
  });
  const SOURCE_VIEW = view([work('T'), gate('G'), work('D', 'deferred'), work('X')], { O: ['T', 'G', 'D'], O2: ['X'] });
  const ADD_T2 = view([work('T'), gate('G'), work('D', 'deferred'), work('X'), work('T2')], { O: ['T', 'G', 'D', 'T2'], O2: ['X'] });
  const fenced = humanCancelledFacts('T');
  const check = (input: { adopterClass?: 'human' | 'system' | 'agent'; source?: PlanCarrierViewV1; target?: PlanCarrierViewV1;
    carrierFacts?: Pick<TracedTaskFactsV1, 'taskId' | 'selectedRun' | 'pointerIntent'>[] }) =>
    parallelCarrierFenceProblem({ adopterClass: input.adopterClass ?? 'agent', source: input.source ?? SOURCE_VIEW,
      target: input.target ?? ADD_T2, carrierFacts: input.carrierFacts ?? [fenced] });

  it('only an obligation that gains a carrier reads its existing active work carriers', () => {
    expect(parallelCarrierFactTaskIds({ source: SOURCE_VIEW, target: ADD_T2 })).toEqual(['T']);
    expect(parallelCarrierFactTaskIds({ source: SOURCE_VIEW, target: SOURCE_VIEW })).toEqual([]);
    const both = view([work('T'), work('U'), gate('G'), work('T2')], { O: ['U', 'T', 'G', 'T2'] });
    expect(parallelCarrierFactTaskIds({ source: view([work('T'), work('U'), gate('G')], { O: ['U', 'T', 'G'] }), target: both }))
      .toEqual(['T', 'U']);
  });

  it('the only active work carrier was cancelled by a human: agent and system → forbidden, human → allowed', () => {
    expect(check({ adopterClass: 'agent' })).toEqual({ code: 'forbidden',
      detail: 'obligation O: a human stopped this work; only an operator may add the parallel carrier T2' });
    expect(check({ adopterClass: 'system' })?.code).toBe('forbidden');
    expect(check({ adopterClass: 'human' })).toBeNull();
  });

  it('another unfenced active work carrier of O → allowed', () => {
    const source = view([work('T'), work('U'), gate('G')], { O: ['T', 'U', 'G'] });
    const target = view([work('T'), work('U'), gate('G'), work('T2')], { O: ['T', 'U', 'G', 'T2'] });
    expect(check({ source, target, carrierFacts: [fenced, tracedFacts('U')] })).toBeNull();
  });

  it('a Goal fan-out pause interrupted by a restart (human_or_goal_resume) still fences an agent', () => {
    expect(check({ carrierFacts: [pausedInterruptedFacts('T', { ...GOAL_FAN_OUT_ACTOR })] })?.code).toBe('forbidden');
  });

  it('restoring a deferred carrier of O to active is a new carrier', () => {
    const target = view([work('T'), gate('G'), work('D', 'active'), work('X')], { O: ['T', 'G', 'D'], O2: ['X'] });
    expect(check({ target })).toEqual({ code: 'forbidden',
      detail: 'obligation O: a human stopped this work; only an operator may add the parallel carrier D' });
  });

  it('listing an existing Task in O.taskIds is a new carrier', () => {
    const target = view([work('T'), gate('G'), work('D', 'deferred'), work('X')], { O: ['T', 'G', 'D', 'X'], O2: ['X'] });
    expect(check({ target })?.code).toBe('forbidden');
  });

  it('an unfenced gate does not count: O is still fenced', () => {
    expect(check({})?.code).toBe('forbidden');
  });

  it('a new carrier of another obligation → allowed', () => {
    const target = view([work('T'), gate('G'), work('D', 'deferred'), work('X'), work('X2')], { O: ['T', 'G', 'D'], O2: ['X', 'X2'] });
    expect(check({ target, carrierFacts: [fenced, tracedFacts('X')] })).toBeNull();
  });

  it('an obligation without an active work carrier → allowed', () => {
    const source = view([gate('G'), work('D', 'deferred')], { O: ['G', 'D'] });
    const target = view([gate('G'), work('D', 'deferred'), work('T2')], { O: ['G', 'D', 'T2'] });
    expect(check({ source, target, carrierFacts: [] })).toBeNull();
  });

  it('a carrier that never ran has no pointer and does not fence', () => {
    expect(check({ carrierFacts: [{ taskId: 'T', selectedRun: null, pointerIntent: null }] })).toBeNull();
  });

  it('a missing carrier fact is reported, never assumed unfenced', () => {
    expect(check({ carrierFacts: [] })?.code).toBe('unavailable');
  });
});

// --------------------------------------------------------------------------
// C7 / LA-3 in the machine (A.2 step 5.10): PLAN-01/02 shape, PLAN-05 split
// --------------------------------------------------------------------------

describe('C7 PLAN-01/02 (§3.4): the reason.affectedTaskIds shape and a draft dispositionRecord', () => {
  const recordWith = (affectedTaskIds: unknown, writer: 'host' | 'agent' = 'host') => {
    const base = writer === 'host' ? RECORD_HOST : RECORD_AGENT;
    return transitionPlanProposal(null, { ...base, reason: { ...REASON, affectedTaskIds } as PlanChangeReason },
      context({ agentAdmission: writer === 'agent' ? 'ok' : null }));
  };

  it.each<[string, unknown, string]>([
    ['not an array', 't-build', 'reason.affectedTaskIds must be an array when present'],
    ['an empty id', [''], 'reason.affectedTaskIds must hold non-empty task ids'],
    ['a repeated id', ['t-build', 't-build'], 'reason.affectedTaskIds repeats task t-build'],
    ['a task outside the draft', ['t-other'], 'reason.affectedTaskIds names t-other, which is not a task of the draft'],
    ['more than 200 ids', Array.from({ length: 201 }, (_, index) => `t-${index}`), 'reason.affectedTaskIds must hold at most 200 task ids'],
  ])('%s → guard_failed/invalid for the Host and the Agent writer', (_name, affectedTaskIds, detail) => {
    expectResult(recordWith(affectedTaskIds), no('guard_failed', 'invalid', detail));
    expectResult(recordWith(affectedTaskIds, 'agent'), no('guard_failed', 'invalid', detail));
  });

  it('absent or a listed draft task is recorded as before', () => {
    expect(recordWith(undefined).ok).toBe(true);
    expect(recordWith(['t-build']).ok).toBe(true);
    expect(recordWith([], 'agent').ok).toBe(true);
  });

  it('the shape is judged after the scope, so the scope refusal answers first', () => {
    expectResult(transitionPlanProposal(null, { ...RECORD_HOST, reason: { ...REASON, affectedTaskIds: ['t-other'] } },
      context({ goalInWorkspace: false })), no('guard_failed', 'forbidden'));
  });
});

describe('C7 PLAN-05 (5.10): disposition-only Tasks (TASK-19) and the parallel carrier fence (guard 9)', () => {
  const DEFER = { taskId: 't-build', from: 'active' as const, to: 'deferred' as const, replacedByTaskId: null };
  const listed = candidate({ basedOn: P1, draft: FUTURE_DRAFT, catalogPin: PIN, submittedBy: PROVENANCE,
    reason: { ...REASON, affectedTaskIds: ['t-build'] } });
  const adopt = (future: Partial<FutureAdoptionFacts>, state: PlanProposalMachineState = listed, event: AcceptedEvent = ACCEPT_HOST,
    overrides: Partial<PlanProposalGuardContext> = {}) =>
    transitionPlanProposal(state, event, context({ agentAdmission: event.adopter === 'agent' ? 'ok' : null,
      future: { ...FUTURE_FACTS, delta: delta([], []), touchedTaskFacts: [], ...future }, ...overrides }));
  const deferBuild = (facts: TracedTaskFactsV1, adopterClass: FutureAdoptionFacts['adopterClass'] = 'human') =>
    ({ delta: delta([], [], { dispositionOnlyTaskIds: ['t-build'], dispositionChanges: [DEFER] }),
      dispositionTaskFacts: [facts], adopterClass });
  const UNTRACED: TracedTaskFactsV1 = { taskId: 't-build', runs: [], selectedRun: null, lease: null, reduction: null, pointerIntent: null };

  function effects(input: { traced: boolean; agent?: boolean; carriers?: string[]; target?: PlanRevisionRef }): PlanProposalEffect[] {
    const target = input.target ?? P2;
    return [
      { kind: 'write_proposal' },
      { kind: 'write_plan_revision', ref: target, build: { from: 'future_delta', source: P1, changedTaskIds: [], addedTaskIds: [],
        dispositionOnlyTaskIds: ['t-build'] } },
      { kind: 'move_goal_pointer', from: P1, to: target },
      { kind: 'change_task_disposition', change: { ...DEFER, traced: input.traced } },
      { kind: 'append_event', eventType: 'PlanRevisionAccepted' },
      ...(input.agent === true ? [g({ target: 'agent_admission' })] : []),
      ...SCOPE_GUARDS, g({ target: 'proposal', expectedRevision: 1 }), g({ target: 'plan_revision', ref: P1, expectedRevision: 1 }),
      ...(input.traced ? [g({ target: 'task_facts', taskId: 't-build' })]
        : [g({ target: 'task_record_absent', record: 'TaskLease', taskId: 't-build' }),
          g({ target: 'task_record_absent', record: 'TaskReduction', taskId: 't-build' })]),
      ...(input.carriers ?? []).map((taskId) => g({ target: 'carrier_facts', taskId })),
      g({ target: 'plan_revision', ref: target, expectedRevision: null }),
    ];
  }

  it('a traced, ended, released and listed Task: TASK-19 passes; the change, its trace and the Task facts join the commit', () => {
    expectResult(adopt(deferBuild(tracedFacts('t-build'))), ok(acceptProposalRecord(listed), effects({ traced: true })));
  });

  it('an untraced disposition-only Task keeps the Lease ∅ / Reduction ∅ guards and needs no affectedTaskIds', () => {
    expectResult(adopt(deferBuild(UNTRACED), CANDIDATE_FUTURE),
      ok(acceptProposalRecord(CANDIDATE_FUTURE), effects({ traced: false })));
  });

  it.each<[string, TracedTaskFactsV1, Expected]>([
    ['a running Run (guard 1)', tracedFacts('t-build', { runs: [runOf('r9', 't-build', { status: 'running', outcome: null, endedAt: null })] }),
      no('guard_failed', 'busy', 'task t-build still has an unfinished execution: run r9 is running')],
    ['a lease not released (guard 4)', tracedFacts('t-build', { lease: leaseOf('t-build', false) }),
      no('guard_failed', 'busy', 'task t-build still holds its TaskLease')],
    ['Runs without a lease record (guard 4, legacy)', tracedFacts('t-build', { lease: null }), no('guard_failed', 'unavailable')],
    ['a satisfied Task (guard 5: final, §3.4 illegal)', tracedFacts('t-build', { reduction: reductionOf('t-build') }),
      no('illegal', 'invalid', 'task t-build is satisfied; the disposition of a satisfied task is final')],
  ])('TASK-19 refuses %s, zero writes', (_name, facts, expected) => {
    expectResult(adopt(deferBuild(facts)), expected);
  });

  it('TASK-19 guard 7: a human-stopped Task changes disposition only by an operator', () => {
    expectResult(adopt(deferBuild(humanCancelledFacts('t-build'), 'system')), no('guard_failed', 'forbidden',
      'only an operator may change the disposition of task t-build: a human paused or cancelled it'));
    expectResult(adopt(deferBuild(humanCancelledFacts('t-build'), 'agent'), listed, ACCEPT_AGENT), no('guard_failed', 'forbidden'));
    expect(adopt(deferBuild(humanCancelledFacts('t-build'))).ok).toBe(true);
  });

  it('the untraced rule judges the changed and added Tasks before TASK-19', () => {
    expectResult(adopt({ ...deferBuild(tracedFacts('t-build', { lease: leaseOf('t-build', false) })),
      delta: delta([], ['t-docs'], { dispositionOnlyTaskIds: ['t-build'], dispositionChanges: [DEFER] }),
      touchedTaskFacts: [{ ...DOCS_FACTS, runs: [runOf('run-docs', 't-docs')] }] }),
    no('guard_failed', 'revision_conflict', 'task t-docs already has a Run and is no longer a future task'));
  });

  it('the untraced rule tells how to keep a traced Task that left an obligation (§3.3)', () => {
    expectResult(adopt({ delta: delta(['t-build'], [], { carrierRemovals: [{ taskId: 't-build', obligationIds: ['o-1', 'o-2'] }] }),
      touchedTaskFacts: [{ taskId: 't-build', runs: [runOf('run-build', 't-build')], lease: leaseOf('t-build', true), reduction: null }] }),
    no('guard_failed', 'revision_conflict', 'task t-build already has a Run and is no longer a future task; a traced task may change '
      + 'only its disposition or replacedByTaskId: keep it in obligations[o-1].taskIds, obligations[o-2].taskIds and add the '
      + 'replacement task as another carrier'));
  });

  it('a disposition-only Task whose facts were not read is a broken owner', () => {
    expectResult(adopt({ ...deferBuild(UNTRACED), dispositionTaskFacts: [] }), no('illegal', 'invalid',
      'the disposition-change facts of task t-build were not read'));
  });

  describe('guard 9 (LA-3)', () => {
    const SOURCE_CARRIERS: PlanCarrierViewV1 = { tasks: [{ taskId: 't-build', taskKind: 'work', disposition: 'active' }],
      obligations: [{ obligationId: 'o-1', taskIds: ['t-build'] }] };
    const PARALLEL_DRAFT: PlanRevisionDraft = { ...FUTURE_DRAFT, tasks: [runtimeTask('t-build'), runtimeTask('t-fix')],
      obligations: [{ obligationId: 'o-1', title: 'Deliver', requirementLevel: 'required', taskIds: ['t-build', 't-fix'],
        verificationRequirements: [{ requirementId: 'r-1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }] };
    const parallel = candidate({ basedOn: P1, draft: PARALLEL_DRAFT, catalogPin: PIN, submittedBy: PROVENANCE });
    const addCarrier = (adopterClass: FutureAdoptionFacts['adopterClass'], carrierFacts: TracedTaskFactsV1[] | undefined) => ({
      delta: delta([], ['t-fix']), touchedTaskFacts: [{ taskId: 't-fix', runs: [], lease: null, reduction: null }],
      adopterClass, sourceCarriers: SOURCE_CARRIERS, ...(carrierFacts === undefined ? {} : { carrierFacts }) });

    it('an automation (system) or Agent adoption adding a carrier to an obligation a human stopped → forbidden', () => {
      const forbidden = no('guard_failed', 'forbidden',
        'obligation o-1: a human stopped this work; only an operator may add the parallel carrier t-fix');
      expectResult(adopt(addCarrier('system', [humanCancelledFacts('t-build')]), parallel), forbidden);
      expectResult(adopt(addCarrier('agent', [humanCancelledFacts('t-build')]), parallel, ACCEPT_AGENT), forbidden);
    });

    it('an operator adoption is not limited and reads no carrier; an unfenced carrier lets automation add one', () => {
      const operator = adopt(addCarrier('human', []), parallel);
      expect(operator.ok).toBe(true);
      if (operator.ok) expect(operator.effects.some((effect) => effect.kind === 'guard' && effect.guard.target === 'carrier_facts')).toBe(false);
      const unfenced = adopt(addCarrier('system', [tracedFacts('t-build')]), parallel);
      expect(unfenced.ok).toBe(true);
      // The carrier read joins the commit: a concurrent human stop makes the adoption stale.
      if (unfenced.ok) expect(unfenced.effects).toContainEqual(g({ target: 'carrier_facts', taskId: 't-build' }));
    });

    it('the carrier facts are read after TASK-19, and only for an automation or Agent adopter', () => {
      const { carrierFacts: _unread, ...noCarriers } = { ...FUTURE_FACTS, ...addCarrier('system', undefined) };
      void _unread;
      const read = { ...pointer(P1), goalInWorkspace: true, pinsAgree: true, agentAdmission: null, source: SOURCE };
      expect(planProposalProblem(parallel, ACCEPT_HOST, { ...read, future: noCarriers })).toBeNull();
      expectResult(planProposalProblem(parallel, ACCEPT_HOST, { ...read, future: { ...noCarriers,
        carrierFacts: [humanCancelledFacts('t-build')] } })!, no('guard_failed', 'forbidden'));
      const { dispositionTaskFacts: _later, ...beforeTask19 } = noCarriers;
      void _later;
      expect(planProposalProblem(listed, ACCEPT_HOST, { ...read, future: { ...beforeTask19,
        delta: delta([], [], { dispositionOnlyTaskIds: ['t-build'], dispositionChanges: [DEFER] }) } })).toBeNull();
    });
  });
});

describe('exhaustive event variants (§1.1)', () => {
  // A writer or adopter the machine does not know must reach the `never`
  // branch, never silently take the Host path.
  it.each<[string, () => unknown, string]>([
    ['writer', () => transitionPlanProposal(null, { ...RECORD_HOST, writer: 'workflow' } as unknown as PlanProposalEvent, context()),
      'unreachable plan proposal writer'],
    ['adopter', () => transitionPlanProposal(CANDIDATE_FUTURE,
      { ...ACCEPT_HOST, adopter: 'workflow' } as unknown as PlanProposalEvent, context()), 'unreachable plan adopter'],
  ])('an unknown %s throws', (_name, run, message) => {
    expect(run).toThrow(message);
  });
});

describe('purity', () => {
  it('never mutates the state, the event or the context', () => {
    const state = deepFreeze(structuredClone(CANDIDATE_FUTURE));
    const ctx = deepFreeze(context({ agentAdmission: 'ok', future: AGENT_FUTURE_FACTS }));
    const event = deepFreeze(structuredClone(ACCEPT_AGENT));
    const before = JSON.stringify({ state, ctx, event });
    expect(transitionPlanProposal(state, event, ctx).ok).toBe(true);
    expect(JSON.stringify({ state, ctx, event })).toBe(before);
  });
});
