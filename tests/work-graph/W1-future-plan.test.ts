/**
 * W1 behavior tests — future-task whiteboard revision (memory).
 *
 * These tests exercise the REAL public Plan entry points (`proposePlan` /
 * `applyPlanChange` / `queryTaskGraph` / `queryReadyTasks`) over the real
 * Memory RecordStore. These behavior tests were frozen before implementation;
 * the independent review then strengthened the existing scenarios to cover
 * basis-source integrity and the exact future-only authorization boundary.
 *
 * Fixture note: C's formal `TaskReductionSnapshot` and the later accepted Plan
 * are seeded directly as READ-side fixtures (this batch implements no reduction
 * writer), while actual W1 adoptions use the public service. Other direct
 * Run/Lease seeds are explicitly read-side fixtures, not runtime completion.
 *
 * Specification: docs/refactor/tasks/W1-future-plan-skeleton.md §8.
 */
import { afterEach, expect, it } from 'vitest';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import type {
  EncodedRecord, EncodedRecordSchema, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas,
  RecordGuard, StoreCommitReceipt,
} from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import {
  GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeGoalSnapshot, encodeProjectSnapshot, encodeWorkspaceSnapshot,
} from '../../src/core/work-graph/persistence/record-codecs.js';
import {
  PLAN_RECORD_SCHEMAS, decodePlanRevisionSnapshot, encodePlanRevisionSnapshot,
} from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import { PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { GoalRef, GoalSnapshot, ProjectSnapshot, VersionedRef, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { AcceptanceObligation, PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { RunSnapshot, RunStatus, TaskLeaseRef, TaskLeaseSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskReductionPhase, TaskReductionSnapshot } from '../../src/contracts/reduction.js';
import type { PlanProposal, PlanProposalRef } from '../../src/core/work-graph/tasks/plan-contracts.js';

const AT = '2026-09-25T00:00:00.000Z';
const projectId = 'w1-future-plan';
const workspaceId = 'w1-workspace';
const actor = { kind: 'human' as const, id: 'w1-operator' };
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };

type Records = GoalRecordTransactionPort & RecordLookupPort;
type PlanDraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;
type SnapshotV2 = Extract<PlanRevisionSnapshot, { schemaVersion: 2 }>;

const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'w1-policy', revision: 1 };
const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId, baselineId: 'w1-baseline', revision: 1 };
const policyFixture = { schemaVersion: 1, identity: { policyId: 'w1-policy' }, revision: 1,
  content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } };
const architectureFixture = { schemaVersion: 1, identity: { baselineId: 'w1-baseline' }, revision: 1,
  content: { schemaVersion: 1, description: 'W1 baseline', constraints: [] } };
const governance = [
  { ref: policyRef, revision: 1, schemaVersion: 1, policyId: 'w1-policy', contentRevision: 1,
    contentDigest: digest(policyFixture as unknown as JsonValue), content: policyFixture.content },
  { ref: architectureRef, revision: 1, schemaVersion: 1, baselineId: 'w1-baseline', contentRevision: 1,
    contentDigest: digest(architectureFixture as unknown as JsonValue), content: architectureFixture.content },
  { ref: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId }, projectId, revision: 1, activeRevision: policyRef },
  { ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId }, projectId, revision: 1, activeRevision: architectureRef },
];
const governanceSchemas: EncodedRecordSchema[] = governance.map(snapshot => ({
  aggregateType: snapshot.ref.aggregateType, schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
  validate: record => record.refKey === canonicalJson(snapshot.ref as unknown as JsonValue)
    && record.schemaId === `${snapshot.ref.aggregateType}Snapshot@1`
    ? { status: 'decoded', value: record } : { status: 'invalid', reason: 'wrong test prerequisite' },
}));
const encodedGovernance = (snapshot: (typeof governance)[number]): EncodedRecord => ({
  refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
  schemaId: `${snapshot.ref.aggregateType}Snapshot@1`, revision: snapshot.revision, json: JSON.stringify(snapshot),
});
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...governanceSchemas, ...PLAN_RECORD_SCHEMAS.records,
    ...PLAN_STATE_RECORD_SCHEMAS.records,
    ...materialRecordSchemas().records.filter(record => record.aggregateType === 'Run')],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PLAN_RECORD_SCHEMAS.events,
    { eventType: 'W1Seed', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [...PLAN_RECORD_SCHEMAS.lookups, ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? [])],
};

const work = (taskId: string, title: string): RuntimeTask => ({ taskId, title,
  requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });
const gate = (taskId: string, title: string): RuntimeTask => ({ taskId, title,
  requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });
const check = (requirementId: string) => ({ requirementId, requirementLevel: 'required' as const,
  kind: 'test', description: 'Tests pass' });

/** Source P1 already carries a required obligation (`o-solo`) whose ONLY
 * required carrier is B: a candidate that cancels or optionally replaces B
 * genuinely exercises the coverage rule instead of adding a new obligation. */
function initialDraft(): PlanDraftV2 {
  return { schemaVersion: 2, planId: 'w1-plan-1', planRevision: 1, goalId: 'goal-1', stages: [],
    tasks: [work('A', 'Task A'), work('B', 'Task B'), work('C', 'Task C'), gate('gate-goal', 'Goal gate')],
    assignments: [
      { taskId: 'A', role: 'builder', instruction: 'Run A' },
      { taskId: 'B', role: 'builder', instruction: 'Run B' },
      { taskId: 'C', role: 'builder', instruction: 'Run C' },
    ],
    obligations: [
      { obligationId: 'o-core', title: 'Deliver core', requirementLevel: 'required',
        taskIds: ['A', 'B', 'C', 'gate-goal'], verificationRequirements: [check('check-core')] },
      { obligationId: 'o-solo', title: 'Deliver B only', requirementLevel: 'required',
        taskIds: ['B'], verificationRequirements: [check('check-solo')] },
    ],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    taskRelations: [], inputRequirements: [] };
}

function editBDraft(): PlanDraftV2 {
  const base = initialDraft();
  return { ...base, planId: 'w1-plan-2', planRevision: 2,
    tasks: base.tasks.map(task => task.taskId === 'B' ? { ...task, title: 'Task B v2' } : task),
    assignments: (base.assignments ?? []).map(assignment => assignment.taskId === 'B'
      ? { ...assignment, instruction: 'Run B v2' } : assignment),
    taskRelations: [{ fromTaskId: 'A', toTaskId: 'B', kind: 'coordination', note: 'advisory follow-up' }] };
}

/** Only an advisory prompt edge to the running A: no execution definition of A
 * (or any Task) changes, so every basis must stay on the source Plan. */
function pureEdgeDraft(): PlanDraftV2 {
  const base = initialDraft();
  return { ...base, planId: 'w1-plan-edge', planRevision: 2,
    taskRelations: [{ fromTaskId: 'A', toTaskId: 'B', kind: 'coordination', note: 'advisory only' }] };
}

/** Split future B into B1/B2, superseding B without deleting it; the required
 * carrier of o-solo moves to B1, o-core membership is recomputed. */
function splitBDraft(): PlanDraftV2 {
  const base = initialDraft();
  const supersededB: RuntimeTask = { ...base.tasks[1]!, disposition: 'superseded', replacedByTaskId: 'B1' };
  return { ...base, planId: 'w1-plan-split', planRevision: 2,
    tasks: [base.tasks[0]!, supersededB, work('B1', 'Task B1'), work('B2', 'Task B2'), base.tasks[2]!, base.tasks[3]!],
    assignments: [
      { taskId: 'A', role: 'builder', instruction: 'Run A' },
      { taskId: 'B', role: 'builder', instruction: 'Run B (superseded)' },
      { taskId: 'B1', role: 'builder', instruction: 'Run B1' },
      { taskId: 'B2', role: 'builder', instruction: 'Run B2' },
      { taskId: 'C', role: 'builder', instruction: 'Run C' },
    ],
    obligations: [
      { obligationId: 'o-core', title: 'Deliver core', requirementLevel: 'required',
        taskIds: ['A', 'B1', 'B2', 'C', 'gate-goal'], verificationRequirements: [check('check-core')] },
      { obligationId: 'o-solo', title: 'Deliver B only', requirementLevel: 'required',
        taskIds: ['B1'], verificationRequirements: [check('check-solo')] },
    ] };
}

/** o-solo exists in the source and is carried by B alone; cancelling B leaves
 * that required obligation without any valid required carrier. */
function cancelSoleCarrierDraft(): PlanDraftV2 {
  const base = initialDraft();
  return { ...base, planId: 'w1-plan-cancel', planRevision: 2,
    tasks: base.tasks.map(task => task.taskId === 'B' ? { ...task, disposition: 'cancelled' } : task) };
}

/** Replace the required o-solo carrier with an OPTIONAL task. */
function optionalReplacementDraft(): PlanDraftV2 {
  const base = cancelSoleCarrierDraft();
  return { ...base, planId: 'w1-plan-optional', planRevision: 2,
    tasks: [...base.tasks, { ...work('B1', 'Optional replacement'), requirementLevel: 'optional' }],
    assignments: [...(base.assignments ?? []), { taskId: 'B1', role: 'builder', instruction: 'Optional B1' }],
    obligations: base.obligations.map(obligation => obligation.obligationId === 'o-core'
      ? { ...obligation, taskIds: ['A', 'C', 'gate-goal'] }
      : { ...obligation, taskIds: ['B1'] }) };
}

/** Silently rewrite o-solo's compiled verification body. */
function changedVerificationDraft(): PlanDraftV2 {
  const base = editBDraft();
  return { ...base, planId: 'w1-plan-verify', planRevision: 2,
    obligations: base.obligations.map(obligation => ({
      ...obligation,
      verificationRequirements: obligation.verificationRequirements.map(requirement => ({
        ...requirement, description: 'Weakened check' })),
    })) };
}

/** Introduce a new role/authorization through the whiteboard. */
function roleEscalationDraft(): PlanDraftV2 {
  const base = editBDraft();
  return { ...base, planId: 'w1-plan-role', planRevision: 2,
    assignments: (base.assignments ?? []).map(assignment => assignment.taskId === 'B'
      ? { ...assignment, role: 'privileged-admin' } : assignment) };
}

/** A new Task starts pending; a caller cannot invent a blocked execution state. */
function blockedNewTaskDraft(): PlanDraftV2 {
  const base = initialDraft();
  return { ...base, planId: 'w1-plan-blocked-new', planRevision: 2,
    tasks: [...base.tasks, { ...work('B1', 'Task B1'), phase: 'blocked' }],
    assignments: [...(base.assignments ?? []), { taskId: 'B1', role: 'builder', instruction: 'Run B1' }],
    obligations: base.obligations.map(obligation => obligation.obligationId === 'o-core'
      ? { ...obligation, taskIds: [...obligation.taskIds, 'B1'] } : obligation) };
}

/** A whiteboard edit cannot change the source's review-admission protocol. */
function changedReviewProtocolDraft(): PlanDraftV2 {
  return { ...editBDraft(), planId: 'w1-plan-review-protocol', reviewAdmissionProtocol: 'independent-review-v1' };
}

type W1Fixture = {
  records: Records;
  plans: ReturnType<typeof createPlanService>;
  goals: ReturnType<typeof createGoalService>['tasks'];
  goalRef: GoalRef;
  plan: PlanRevisionSnapshot;
  planRef: PlanRevisionRef;
  initialProposalRef: PlanProposalRef;
  initialProposalRevision: number;
  commitRaw(records: readonly EncodedRecord[], guards?: readonly RecordGuard[]): Promise<StoreCommitReceipt>;
  readJsons(refs: readonly object[]): Promise<Record<string, string>>;
  currentGoal(): Promise<GoalSnapshot>;
  seedAcceptedPlan(planId: string, planRevision: number): Promise<PlanRevisionSnapshot>;
  seedRun(taskId: string, status: RunStatus, onPlan?: PlanRevisionRef, suffix?: string): Promise<RunSnapshot>;
  seedLease(taskId: string, holderRunId: string): Promise<TaskLeaseSnapshot>;
  seedReduction(taskId: string, phase: TaskReductionPhase): Promise<TaskReductionSnapshot>;
  proposeChange(draft: PlanRevisionDraft, requestId: string): Promise<WriteResult<PlanProposal>>;
  applyChange(proposalRef: PlanProposal['ref'], revision: number, requestId: string,
    decisionRefs?: VersionedRef[]): Promise<WriteResult<PlanRevisionSnapshot>>;
};

async function setup(sourceDraft: PlanDraftV2 = initialDraft()): Promise<W1Fixture> {
  const backend = createInMemoryRecordBackend({ schemas });
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'goal-1' };
  let sequence = 0;
  const seedCommit = async (recordsToWrite: readonly EncodedRecord[],
    guards: readonly RecordGuard[] = []): Promise<StoreCommitReceipt> => {
    const n = ++sequence;
    const event = { eventId: `w1-seed-${n}`, eventType: 'W1Seed', schemaVersion: 1, occurredAt: AT };
    const guarded = new Set(guards.map(guard => guard.refKey));
    return backend.records.commit({ identityKey: `w1-seed-identity-${n}`, fingerprint: `w1-seed-fingerprint-${n}`,
      guards: [...guards, ...recordsToWrite.filter(record => !guarded.has(record.refKey))
        .map(record => ({ refKey: record.refKey, expectedRevision: null }))],
      records: [...recordsToWrite], events: [{ ...event, json: JSON.stringify(event) }],
      claims: [], indexGuards: [], indexChanges: [] });
  };
  const scopeSeed: PreparedCommit = { identityKey: 'w1-scope-seed', fingerprint: 'w1-scope-seed-v1',
    guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
      { refKey: canonicalRefKey(workspace.ref), expectedRevision: null },
      ...governance.map(snapshot => ({ refKey: canonicalJson(snapshot.ref as unknown as JsonValue), expectedRevision: null }))],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace), ...governance.map(encodedGovernance)],
    events: [{ eventId: 'w1-scope-seed-event', eventType: 'W1Seed', schemaVersion: 1, occurredAt: AT,
      json: JSON.stringify({ eventId: 'w1-scope-seed-event', eventType: 'W1Seed', schemaVersion: 1, occurredAt: AT }) }],
    claims: [], indexGuards: [], indexChanges: [] };
  const seeded = await backend.records.commit(scopeSeed);
  if (seeded.status !== 'committed') throw new Error(`W1 fixture scope seed failed: ${JSON.stringify(seeded)}`);

  const goals = createGoalService({ records: backend.records, now: () => AT, eventId: () => `w1-goal-${++sequence}` }).tasks;
  const plans = createPlanService({ records: backend.records, now: () => AT, eventId: () => `w1-plan-${++sequence}` });
  const created = await goals.createGoal(ctx, { meta: { requestId: 'w1-create-goal',
    expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: { projectId, workspaceId }, objective: 'W1 future whiteboard' } });
  if (created.status !== 'committed') throw new Error(`W1 fixture Goal creation failed: ${JSON.stringify(created)}`);
  const proposed = await plans.proposePlan(ctx, { meta: { requestId: 'w1-initial-propose', expected: [] },
    input: { goalRef, basedOn: null, draft: sourceDraft, reason: { text: 'Initial W1 plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error(`W1 fixture initial proposal failed: ${JSON.stringify(proposed)}`);
  const adopted = await plans.applyPlanChange(ctx, { meta: { requestId: 'w1-initial-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (adopted.status !== 'committed') throw new Error(`W1 fixture initial adoption failed: ${JSON.stringify(adopted)}`);
  const plan = adopted.value;

  async function currentGoal(): Promise<GoalSnapshot> {
    const read = await plans.queryGoal(ctx, goalRef);
    if (read.status !== 'ready') throw new Error(`W1 fixture Goal read failed: ${JSON.stringify(read)}`);
    return read.value.goal;
  }
  async function seedAcceptedPlan(planId: string, planRevision: number): Promise<PlanRevisionSnapshot> {
    const ref: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId, planId };
    const variant: PlanRevisionSnapshot = { ...plan, ref, planId, planRevision };
    const goal = await currentGoal();
    const nextGoal: GoalSnapshot = { ...goal, activePlanRevision: ref, revision: goal.revision + 1 };
    const result = await seedCommit([encodePlanRevisionSnapshot(variant), encodeGoalSnapshot(nextGoal)], [
      { refKey: canonicalJson(goalRef as unknown as JsonValue), expectedRevision: goal.revision },
      { refKey: canonicalJson(ref as unknown as JsonValue), expectedRevision: null }]);
    if (result.status !== 'committed') throw new Error(`W1 fixture later Plan seed failed: ${JSON.stringify(result)}`);
    return variant;
  }
  async function seedRun(taskId: string, status: RunStatus, onPlan: PlanRevisionRef = plan.ref,
    suffix = ''): Promise<RunSnapshot> {
    const run: RunSnapshot = { ref: { aggregateType: 'Run', projectId, goalId: goalRef.goalId, runId: `w1-run-${taskId}${suffix}` },
      revision: 1, schemaVersion: 1, task: { projectId, goalId: goalRef.goalId, taskId },
      attemptId: `w1-attempt-${taskId}${suffix}`, planRef: onPlan,
      roleBinding: { schemaVersion: 1, bindingId: 'w1-binding', templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: '1' },
      budget: { tokenBudget: 100, deadline: null }, workspaceSnapshot: { workspaceId, revision: 1 },
      status, outcome: status === 'ended' ? 'outcome_unknown' : null, exitCode: null,
      lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null,
      startedAt: status === 'starting' ? null : AT, endedAt: status === 'ended' ? AT : null };
    const result = await seedCommit([{ refKey: canonicalJson(run.ref as unknown as JsonValue), schemaId: 'RunSnapshot@1',
      revision: 1, json: JSON.stringify(run) }]);
    if (result.status !== 'committed') throw new Error(`W1 fixture Run seed failed: ${JSON.stringify(result)}`);
    return run;
  }
  async function seedLease(taskId: string, holderRunId: string): Promise<TaskLeaseSnapshot> {
    const ref: TaskLeaseRef = { aggregateType: 'TaskLease', projectId, goalId: goalRef.goalId, taskId };
    const lease: TaskLeaseSnapshot = { ref, revision: 1, schemaVersion: 1, holderRunId,
      attemptId: `w1-attempt-${taskId}`, grantedAt: AT, expiresAt: null };
    const result = await seedCommit([{ refKey: canonicalJson(ref as unknown as JsonValue),
      schemaId: 'TaskLeaseSnapshot@1', revision: 1, json: JSON.stringify(lease) }]);
    if (result.status !== 'committed') throw new Error(`W1 fixture Lease seed failed: ${JSON.stringify(result)}`);
    return lease;
  }
  async function seedReduction(taskId: string, phase: TaskReductionPhase): Promise<TaskReductionSnapshot> {
    const reduction: TaskReductionSnapshot = {
      ref: { aggregateType: 'TaskReduction', projectId, goalId: goalRef.goalId, taskId }, revision: 1, schemaVersion: 1,
      planRef: plan.ref, planRevision: plan.planRevision, taskKind: 'work', requirementLevel: 'required',
      disposition: 'active', phase,
      currentAnchor: { schemaVersion: 1, planRef: plan.ref, planRevision: plan.planRevision, workspaceRevision: 1,
        pinnedCompletionPolicy: plan.effectiveCompletionPolicy, pinnedArchitectureBaseline: plan.effectiveArchitectureBaseline },
      effectiveEvidenceIds: phase === 'satisfied' ? ['w1-evidence'] : [], blockingEvidenceIds: [], staleEvidenceIds: [],
      outOfScopeEvidenceIds: [], satisfiedObligationIds: phase === 'satisfied' ? ['o-core'] : [], causes: [], reducedAt: AT };
    const result = await seedCommit([{ refKey: canonicalJson(reduction.ref as unknown as JsonValue),
      schemaId: 'TaskReductionSnapshot@1', revision: 1, json: JSON.stringify(reduction) }]);
    if (result.status !== 'committed') throw new Error(`W1 fixture Reduction seed failed: ${JSON.stringify(result)}`);
    return reduction;
  }

  return {
    records: backend.records, plans, goals, goalRef, plan, planRef: plan.ref,
    initialProposalRef: proposed.value.ref, initialProposalRevision: proposed.value.revision,
    commitRaw: seedCommit,
    async readJsons(refs) {
      const keys = refs.map(ref => canonicalJson(ref as unknown as JsonValue));
      const read = await backend.records.readMany(keys);
      if (read.status !== 'ready') throw new Error(`W1 fixture read failed: ${JSON.stringify(read)}`);
      const out: Record<string, string> = {};
      for (const record of read.value.records) out[record.refKey] = record.json;
      return out;
    },
    currentGoal, seedAcceptedPlan, seedRun, seedLease, seedReduction,
    proposeChange(draft, requestId) {
      return plans.proposePlan(ctx, { meta: { requestId, expected: [] },
        input: { goalRef, basedOn: plan.ref, draft, reason: { text: 'W1 future-only change', sources: [] } } });
    },
    applyChange(proposalRef, revision, requestId, decisionRefs: VersionedRef[] = []) {
      return plans.applyPlanChange(ctx, { meta: { requestId, expected: [] },
        input: { proposalRef: proposalRef as PlanProposal['ref'], expectedProposalRevision: revision, decisionRefs } });
    },
  };
}

function planServiceOver(records: Records, tag: string): ReturnType<typeof createPlanService> {
  let n = 0;
  return createPlanService({ records, now: () => AT, eventId: () => `w1-${tag}-${++n}` });
}

/** Soft-assert an adoption happened and return the snapshot for follow-ups.
 * A soft assertion lets every target invariant of a test run while the Stage 1
 * unsupported gap keeps the adoption red. */
function adoptedSnapshot(result: WriteResult<PlanRevisionSnapshot>): PlanRevisionSnapshot | null {
  expect.soft(result).toMatchObject({ status: 'committed' });
  return result.status === 'committed' ? result.value : null;
}

it('scenario 1/2: future-only B edit + prompt edge keep A running and C satisfied after real adoption', async () => {
  const f = await setup();
  const runA = await f.seedRun('A', 'running');
  const leaseA = await f.seedLease('A', runA.ref.runId);
  const reductionC = await f.seedReduction('C', 'satisfied');
  const before = await f.readJsons([runA.ref, leaseA.ref, reductionC.ref]);

  const proposed = await f.proposeChange(editBDraft(), 'w1-s1-propose');
  expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });
  if (proposed.status !== 'committed') throw new Error('W1 scenario 1 candidate failed to persist');

  // Real records wrapper: append an unrelated event AFTER the apply
  // has finished all reads and immediately BEFORE the adoption commit. The W1 write must not
  // be globally blocked by that append (it does not commit ledgerHorizon).
  let injected = false;
  let injectedCommit: StoreCommitReceipt | null = null;
  const wrapped: Records = { ...f.records, async commit(prepared) {
    if (!injected && prepared.identityKey.startsWith('plan-apply:')) {
      injected = true;
      injectedCommit = await f.commitRaw([]); // Real event commit advances the global cursor only.
    }
    return f.records.commit(prepared);
  } };
  const wrappedPlans = planServiceOver(wrapped, 's1');
  const applied = await wrappedPlans.applyPlanChange(ctx, { meta: { requestId: 'w1-s1-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  expect(injected).toBe(true);
  expect(injectedCommit).toMatchObject({ status: 'committed' });

  // A's latest facts are read from the current accepted Plan; C stays satisfied.
  const graph = await f.plans.queryTaskGraph(ctx, { goalRef: f.goalRef });
  expect(graph, JSON.stringify(graph)).toMatchObject({ status: 'ready' });
  if (graph.status === 'ready') {
    expect(graph.value.tasks.find(task => task.ref.taskId === 'A')).toMatchObject({ effectivePhase: 'running', execution: runA.ref });
    expect(graph.value.tasks.find(task => task.ref.taskId === 'C')).toMatchObject({ effectivePhase: 'satisfied' });
  }
  const ready = await f.plans.queryReadyTasks(ctx, { goalRef: f.goalRef, includeBlocked: false, page: { limit: 20 } });
  expect(ready).toMatchObject({ status: 'ready' });
  if (ready.status === 'ready') expect(ready.value.items.map(item => item.task.ref.taskId)).not.toContain('A');

  const snapshot = adoptedSnapshot(applied);
  if (snapshot !== null) {
    expect(graph.status === 'ready' ? graph.value.plan.ref : null).toEqual(snapshot.ref);
    expect.soft(snapshot.planRevision).toBe(2);
    expect.soft(snapshot.tasks.find(task => task.taskId === 'B')?.title).toBe('Task B v2');
    expect.soft(snapshot.tasks.find(task => task.taskId === 'A')).toEqual(f.plan.tasks.find(task => task.taskId === 'A'));
    expect.soft(snapshot.tasks.find(task => task.taskId === 'C')).toEqual(f.plan.tasks.find(task => task.taskId === 'C'));
    expect.soft(snapshot.schemaVersion === 2 ? snapshot.taskRelations : [])
      .toContainEqual(expect.objectContaining({ fromTaskId: 'A', toTaskId: 'B' }));
    expect.soft(snapshot.schemaVersion === 2 ? snapshot.taskStateBasis : undefined)
      .toMatchObject({ schemaVersion: 1, entries: expect.arrayContaining([
        { taskId: 'A', planRef: f.planRef }, { taskId: 'B', planRef: snapshot.ref },
        { taskId: 'C', planRef: f.planRef }, { taskId: 'gate-goal', planRef: f.planRef }]) });

    // Shape-valid source corruption must be rejected by the actual graph reader,
    // not only by a helper that a faulty reader could forget to call.
    for (const mutation of ['title', 'strength', 'verification'] as const) {
      let originRead = false;
      const originKey = canonicalJson(f.planRef as unknown as JsonValue);
      const corruptReads: Records = { ...f.records, async readMany(keys) {
        const read = await f.records.readMany(keys);
        if (read.status !== 'ready') return read;
        return { ...read, value: { ...read.value, records: read.value.records.map(record => {
          if (record.refKey !== originKey) return record;
          originRead = true;
          const corrupted = JSON.parse(record.json) as PlanRevisionSnapshot;
          const obligation = corrupted.obligations.find(item => item.taskIds.includes('A'))!;
          if (mutation === 'title') obligation.title = 'Changed origin meaning';
          else if (mutation === 'strength') obligation.requirementLevel = 'optional';
          else obligation.verificationRequirements[0]!.description = 'Changed check';
          const changed = { ...record, json: JSON.stringify(corrupted) };
          expect(decodePlanRevisionSnapshot(changed)).toMatchObject({ status: 'decoded' });
          return changed;
        }) } };
      } };
      expect(await planServiceOver(corruptReads, `origin-${mutation}`).queryTaskGraph(ctx,
        { goalRef: f.goalRef })).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(originRead).toBe(true);
    }
  }
  expect(await f.readJsons([runA.ref, leaseA.ref, reductionC.ref])).toEqual(before);

  // A pure advisory edge to the running A must adopt and must NOT reset any
  // task's basis (independent fixture so the source is still the active one).
  const g = await setup();
  const runGA = await g.seedRun('A', 'running');
  const gProposed = await g.proposeChange(pureEdgeDraft(), 'w1-s1-edge-propose');
  expect(gProposed).toMatchObject({ status: 'committed' });
  if (gProposed.status !== 'committed') throw new Error('W1 pure-edge candidate failed to persist');
  const gSnapshot = adoptedSnapshot(await g.applyChange(gProposed.value.ref, gProposed.value.revision, 'w1-s1-edge-apply'));
  if (gSnapshot !== null) {
    expect.soft(gSnapshot.schemaVersion === 2 ? gSnapshot.taskStateBasis : undefined).toMatchObject({ schemaVersion: 1,
      entries: expect.arrayContaining(gSnapshot.tasks.map(task => ({ taskId: task.taskId, planRef: g.planRef }))) });
    expect.soft(gSnapshot.tasks.find(task => task.taskId === 'A')).toEqual(g.plan.tasks.find(task => task.taskId === 'A'));
  }
  // The pre-existing A Run is untouched by either attempt.
  expect((await g.readJsons([runGA.ref]))[canonicalJson(runGA.ref as unknown as JsonValue)]).toBe(JSON.stringify(runGA));
});

it('scenario 4: a stale proposal revision or an inactive source is rejected with zero writes', async () => {
  const f = await setup();
  const proposed = await f.proposeChange(editBDraft(), 'w1-s4-propose');
  expect(proposed).toMatchObject({ status: 'committed' });
  if (proposed.status !== 'committed') throw new Error('W1 scenario 4 candidate failed to persist');
  expect(await f.applyChange(proposed.value.ref, proposed.value.revision + 1, 'w1-s4-rev'))
    .toMatchObject({ status: 'rejected', code: 'revision_conflict' });

  // A later accepted Plan moves the active pointer; the old basedOn is stale.
  const later = await f.seedAcceptedPlan('w1-plan-later', 2);
  const stale = await f.proposeChange(editBDraft(), 'w1-s4-stale');
  expect(stale).toMatchObject({ status: 'committed' });
  if (stale.status !== 'committed') throw new Error('W1 scenario 4 stale candidate failed to persist');
  const applied = await f.applyChange(stale.value.ref, stale.value.revision, 'w1-s4-apply');
  // The failure MUST be the stale-source conflict; the stale candidate is never
  // auto-rebased and adopted.
  expect.soft(applied).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  const goal = await f.currentGoal();
  expect(goal.activePlanRevision).toEqual(later.ref);
  const stored = await f.readJsons([{ aggregateType: 'PlanRevision', projectId, planId: 'w1-plan-2' }, f.planRef]);
  expect(Object.keys(stored)).toHaveLength(1);
});

it('scenario 5: same-identity replay returns the original adoption, including a lookup-miss peer window', async () => {
  const f = await setup();
  // Existing initial-adoption replay is preserved and green.
  const initialReplay = await f.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-initial-apply', expected: [] },
    input: { proposalRef: f.initialProposalRef, expectedProposalRevision: f.initialProposalRevision, decisionRefs: [] } });
  expect.soft(initialReplay).toMatchObject({ status: 'committed', replayed: true, value: f.plan });

  const proposed = await f.proposeChange(editBDraft(), 'w1-s5-propose');
  expect(proposed).toMatchObject({ status: 'committed' });
  if (proposed.status !== 'committed') throw new Error('W1 scenario 5 candidate failed to persist');
  const first = await f.applyChange(proposed.value.ref, proposed.value.revision, 'w1-s5-apply');
  const snapshot = adoptedSnapshot(first);
  const replay = await f.applyChange(proposed.value.ref, proposed.value.revision, 'w1-s5-apply');
  expect.soft(replay).toMatchObject({ status: 'committed', replayed: true });
  if (snapshot !== null) expect.soft(replay).toMatchObject({ value: snapshot });
  const conflict = await f.applyChange(proposed.value.ref, proposed.value.revision, 'w1-s5-apply',
    [{ ref: f.goalRef, revision: 1 }]);
  expect.soft(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });

  // Controlled window: the original apply's idempotency lookup misses, a peer
  // with the SAME identity commits, then the original call must re-query the
  // exact receipt and restore that commit (not re-read the current Plan).
  const g = await setup();
  const candidate = await g.proposeChange(editBDraft(), 'w1-s5-window');
  expect(candidate).toMatchObject({ status: 'committed' });
  if (candidate.status !== 'committed') throw new Error('W1 scenario 5 window candidate failed to persist');
  const peer: { result: WriteResult<PlanRevisionSnapshot> | null } = { result: null };
  let windowEntered = false;
  const wrappedG: Records = { ...g.records, async lookupCommit(input) {
    const result = await g.records.lookupCommit(input);
    if (!windowEntered && result.status === 'rejected' && result.code === 'not_found'
      && input.identityKey.startsWith('plan-apply:')) {
      windowEntered = true;
      peer.result = await g.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-s5-window-apply', expected: [] },
        input: { proposalRef: candidate.value.ref, expectedProposalRevision: candidate.value.revision, decisionRefs: [] } });
    }
    return result;
  } };
  const original = await planServiceOver(wrappedG, 's5').applyPlanChange(ctx,
    { meta: { requestId: 'w1-s5-window-apply', expected: [] },
      input: { proposalRef: candidate.value.ref, expectedProposalRevision: candidate.value.revision, decisionRefs: [] } });
  expect(windowEntered).toBe(true);
  expect.soft(peer.result).toMatchObject({ status: 'committed' });
  expect.soft(original).toMatchObject({ status: 'committed', replayed: true });
  if (peer.result !== null && peer.result.status === 'committed') {
    expect.soft(original).toMatchObject({ value: peer.result.value });
  }
});

it('scenario 7: authorized split adopts from the source; coverage/role weakening is zero-write rejected', async () => {
  const split = await setup();
  await split.seedRun('A', 'running');
  await split.seedLease('A', 'w1-run-A');
  const candidate = await split.proposeChange(splitBDraft(), 'w1-s7-split');
  expect(candidate).toMatchObject({ status: 'committed' });
  if (candidate.status !== 'committed') throw new Error('W1 scenario 7 split candidate failed to persist');
  const snapshot = adoptedSnapshot(await split.applyChange(candidate.value.ref, candidate.value.revision, 'w1-s7-split-apply'));
  if (snapshot !== null) {
    // The adopted source is the NEW split Plan, never the old P1.
    const goal = await split.currentGoal();
    expect.soft(goal.activePlanRevision).toEqual(snapshot.ref);
    expect.soft(snapshot.tasks.find(task => task.taskId === 'B')?.disposition).toBe('superseded');
    expect.soft(snapshot.tasks.find(task => task.taskId === 'B')?.replacedByTaskId).toBe('B1');
    expect.soft(snapshot.obligations).toContainEqual(expect.objectContaining({ obligationId: 'o-core',
      taskIds: expect.arrayContaining(['A', 'B1', 'B2', 'C', 'gate-goal']) }));
    expect.soft(snapshot.obligations).toContainEqual(expect.objectContaining({ obligationId: 'o-solo',
      taskIds: ['B1'] }));
  }

  // Each weakening candidate is based on its OWN fresh active source that
  // already carries the required B-only obligation, so it genuinely exercises
  // the coverage/authorization rule rather than being stale or unsupported-input.
  for (const [label, makeDraft, planId] of [
    ['cancel sole required carrier', cancelSoleCarrierDraft, 'w1-plan-cancel'],
    ['optional replacement', optionalReplacementDraft, 'w1-plan-optional'],
    ['rewritten verification body', changedVerificationDraft, 'w1-plan-verify'],
    ['new role/authorization', roleEscalationDraft, 'w1-plan-role'],
    ['new Task with fabricated blocked phase', blockedNewTaskDraft, 'w1-plan-blocked-new'],
    ['changed review-admission protocol', changedReviewProtocolDraft, 'w1-plan-review-protocol'],
  ] as const) {
    const f = await setup();
    const weakening = await f.proposeChange(makeDraft(), `w1-s7-${planId}`);
    expect(weakening, label).toMatchObject({ status: 'committed' });
    if (weakening.status !== 'committed') throw new Error(`W1 scenario 7 ${label} candidate failed to persist`);
    const rejected = await f.applyChange(weakening.value.ref, weakening.value.revision, `w1-s7-${planId}-apply`);
    expect(rejected, label).toMatchObject({ status: 'rejected' });
    // A stale-source rejection is NOT an acceptable way to pass this case.
    expect(rejected.status === 'rejected' ? rejected.code : 'committed', label).not.toBe('revision_conflict');
    // Zero write: the source active pointer is unchanged and no target Plan exists.
    expect((await f.currentGoal()).activePlanRevision, label).toEqual(f.planRef);
    const stored = await f.readJsons([{ aggregateType: 'PlanRevision', projectId, planId }]);
    expect(Object.keys(stored), label).toEqual([]);
  }

  // An existing role somewhere in the source does not authorize reassigning B.
  // Both roles are already admitted; the ONLY delta here is B's role.
  const twoRoles = initialDraft();
  twoRoles.assignments = twoRoles.assignments!.map(assignment => assignment.taskId === 'A'
    ? { ...assignment, role: 'reviewer' } : assignment);
  const reassignment = await setup(twoRoles);
  const roleDraft: PlanDraftV2 = { ...twoRoles, planId: 'w1-existing-role-reassignment', planRevision: 2,
    assignments: twoRoles.assignments.map(assignment => assignment.taskId === 'B'
      ? { ...assignment, role: 'reviewer' } : assignment) };
  const roleCandidate = await reassignment.proposeChange(roleDraft, 'w1-s7-existing-role');
  expect(roleCandidate).toMatchObject({ status: 'committed', value: { issues: [] } });
  if (roleCandidate.status !== 'committed') throw new Error('existing-role candidate failed to persist');
  const roleResult = await reassignment.applyChange(roleCandidate.value.ref, roleCandidate.value.revision,
    'w1-s7-existing-role-apply');
  expect.soft(roleResult).toMatchObject({ status: 'rejected' });
  expect.soft(roleResult.status === 'rejected' ? roleResult.code : 'committed').not.toBe('revision_conflict');
  expect.soft((await reassignment.currentGoal()).activePlanRevision).toEqual(reassignment.planRef);
  expect.soft(await reassignment.readJsons([{ aggregateType: 'PlanRevision', projectId, planId: roleDraft.planId }]))
    .toEqual({});
});

it('scenario 8: codec rejects broken shapes and graph reads verify the actual basis source', async () => {
  const f = await setup();
  const callerBasis = { ...editBDraft(), taskStateBasis: { schemaVersion: 1,
    entries: [{ taskId: 'A', planRef: f.planRef }] } } as unknown as PlanRevisionDraft;
  expect(await f.proposeChange(callerBasis, 'w1-s8-caller')).toMatchObject({ status: 'rejected', code: 'invalid' });
  const unknownVersion = { ...editBDraft(), schemaVersion: 3 } as unknown as PlanRevisionDraft;
  expect(await f.proposeChange(unknownVersion, 'w1-s8-version')).toMatchObject({ status: 'rejected', code: 'invalid' });
  const base = f.plan;
  const recordFor = (taskStateBasis: unknown): EncodedRecord => ({
    refKey: canonicalJson(base.ref as unknown as JsonValue), schemaId: 'PlanRevisionSnapshot@1', revision: 1,
    json: JSON.stringify({ ...base, taskStateBasis }),
  });
  expect(decodePlanRevisionSnapshot(recordFor({ schemaVersion: 1, entries: [{ taskId: 'A', planRef: base.ref }] })))
    .toMatchObject({ status: 'invalid' });
  expect(decodePlanRevisionSnapshot(recordFor({ schemaVersion: 2, entries: [] }))).toMatchObject({ status: 'invalid' });
  expect(decodePlanRevisionSnapshot(recordFor({ schemaVersion: 1, entries: [
    { taskId: 'A', planRef: base.ref }, { taskId: 'A', planRef: base.ref }] }))).toMatchObject({ status: 'invalid' });
  expect(decodePlanRevisionSnapshot(recordFor({ schemaVersion: 1, entries: [
    { taskId: 'A', planRef: { ...base.ref, projectId: 'another-project' } }] }))).toMatchObject({ status: 'invalid' });

  // First adopt a real P2 with inherited P1 basis. P1 must be verified even
  // before any Run exists, and when a Run belongs to P2 itself (self-origin).
  // The wrapper corrupts only the precise P1 record; no parser/helper is mocked.
  const proposed = await f.proposeChange(pureEdgeDraft(), 'w1-s8-real-basis');
  expect(proposed).toMatchObject({ status: 'committed', value: { issues: [] } });
  if (proposed.status !== 'committed') throw new Error('basis-source candidate failed to persist');
  const accepted = adoptedSnapshot(await f.applyChange(proposed.value.ref, proposed.value.revision,
    'w1-s8-real-basis-apply'));
  if (accepted !== null) {
    const basisKey = canonicalJson(f.planRef as unknown as JsonValue);
    for (const runMode of ['no-run', 'self-origin-run'] as const) {
      if (runMode === 'self-origin-run') await f.seedRun('A', 'running', accepted.ref);
      expect(await f.plans.queryTaskGraph(ctx, { goalRef: f.goalRef }))
        .toMatchObject({ status: 'ready', value: { plan: { ref: accepted.ref } } });
      for (const fault of ['cross-goal', 'missing', 'definition'] as const) {
        let basisRead = false;
        const broken: Records = { ...f.records, async readMany(keys) {
          const read = await f.records.readMany(keys);
          if (read.status !== 'ready' || !keys.includes(basisKey)) return read;
          basisRead = true;
          if (fault === 'missing') return { ...read, value: { ...read.value,
            records: read.value.records.filter(record => record.refKey !== basisKey),
            missing: [...read.value.missing, basisKey] } };
          return { ...read, value: { ...read.value, records: read.value.records.map(record => {
            if (record.refKey !== basisKey) return record;
            const source = JSON.parse(record.json) as PlanRevisionSnapshot;
            if (fault === 'cross-goal') source.goalRef = { ...source.goalRef, goalId: 'other-goal' };
            else source.tasks = source.tasks.map(task => task.taskId === 'A'
              ? { ...task, title: 'A different execution definition' } : task);
            const corrupted = { ...record, json: JSON.stringify(source) };
            expect(decodePlanRevisionSnapshot(corrupted)).toMatchObject({ status: 'decoded' });
            return corrupted;
          }) } };
        } };
        const graph = await planServiceOver(broken, `s8-${runMode}-${fault}`)
          .queryTaskGraph(ctx, { goalRef: f.goalRef });
        expect.soft(graph, `${runMode}: ${fault}`).toMatchObject({ status: 'rejected', code: 'unavailable' });
        expect.soft(basisRead, `${runMode}: ${fault} must inspect the real basis`).toBe(true);
      }
    }
  }
});

it('scenario 6 (memory): explicit old Plan excludes later Run + global Lease; active reads stay authoritative', async () => {
  const f = await setup();
  const plan1 = f.plan;
  const plan2 = await f.seedAcceptedPlan('w1-plan-2', 2);
  const runB2 = await f.seedRun('B', 'running', plan2.ref);
  await f.seedLease('B', runB2.ref.runId);

  const oldGraph = await f.plans.queryTaskGraph(ctx, { goalRef: f.goalRef, planRef: plan1.ref });
  expect(oldGraph, JSON.stringify(oldGraph)).toMatchObject({ status: 'ready' });
  if (oldGraph.status === 'ready') {
    expect(oldGraph.value.plan.ref).toEqual(plan1.ref);
    const oldB = oldGraph.value.tasks.find(task => task.ref.taskId === 'B');
    expect.soft(oldB?.execution).toBeNull();
    // The later Run's GLOBAL TaskLease must not leak as plan1's runId/leased
    // reason: a historical projection is not a current claim permission.
    expect.soft(oldB).toMatchObject({ eligibility: { eligible: true, reasons: [] } });
  }
  const activeGraph = await f.plans.queryTaskGraph(ctx, { goalRef: f.goalRef });
  expect(activeGraph).toMatchObject({ status: 'ready' });
  if (activeGraph.status === 'ready') {
    expect(activeGraph.value.plan.ref).toEqual(plan2.ref);
    expect(activeGraph.value.tasks.find(task => task.ref.taskId === 'B')).toMatchObject({
      effectivePhase: 'running', execution: runB2.ref, eligibility: { eligible: false } });
  }
  // ready still consults the ACTIVE plan: the running B is never a candidate.
  const ready = await f.plans.queryReadyTasks(ctx, { goalRef: f.goalRef, includeBlocked: false, page: { limit: 20 } });
  expect(ready).toMatchObject({ status: 'ready' });
  if (ready.status === 'ready') expect(ready.value.items.map(item => item.task.ref.taskId)).not.toContain('B');

  // Old records WITHOUT the basis field stay readable (both v2 and v1).
  expect((plan1 as SnapshotV2).taskStateBasis).toBeUndefined();
  const v2 = plan1 as SnapshotV2;
  const { taskRelations, inputRequirements, taskStateBasis, ...v1rest } = v2;
  void taskRelations; void inputRequirements; void taskStateBasis;
  const v1: PlanRevisionSnapshot = { ...v1rest, schemaVersion: 1 };
  expect(decodePlanRevisionSnapshot({ refKey: canonicalJson(v1.ref as unknown as JsonValue),
    schemaId: 'PlanRevisionSnapshot@1', revision: 1, json: JSON.stringify(v1) })).toMatchObject({ status: 'decoded' });
});
