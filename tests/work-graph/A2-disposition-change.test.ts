/**
 * A.2 step 5.10 (C7) at the plan owner: the future-only delta split, the `replacedByTaskId` rule and the
 * W16 adoption of disposition-only Tasks over the real plan service and the real Memory RecordStore
 * (docs/refactor/STATE-MACHINES-SPEC.md §3.3 PLAN-05 and point 6, the 任务定义守卫表, §3.4, §4 TASK-18/19,
 * TD-4; the W1-future-plan S11–S19 cases of §3.6, here in their own file).
 *
 * - `deriveFuturePlanDelta`: a disposition-only Task is neither changed nor unchanged; changing anything
 *   else (title, assignment, carried obligations) is a changed Task; `dispositionChanges` lists every
 *   disposition that moves; a Task whose only execution change is leaving an obligation is a
 *   `carrierRemovals` entry (the untraced rule's hint).
 * - `validateFutureObligationCoverage`: `replacedByTaskId` of a Task whose disposition changes.
 * - The plan owner: an untraced disposition-only Task keeps its source definition and basis and is recorded
 *   (`traced:false`); a later unrelated adoption carries the record; a traced superseded Task may name a
 *   new replacement (recorded `from === to`), and an explicit `replacedByTaskId: null` where the source has
 *   none is no change; a traced Task leaving an obligation is refused with the hint; a traced Task whose
 *   lease is held, whose Run is live or ended unknown is `busy`, one with Runs but no Lease record
 *   `unavailable`, a satisfied one `invalid`; a gate cannot change its disposition; deferring the only
 *   carrier of a required obligation is `invalid`. Every refusal writes nothing. A claim committed between
 *   the TASK-19 read and the adoption commit moves the pinned Lease: the adoption is `revision_conflict`,
 *   and read again `busy`. A paused Goal still adopts (W16 is no rework).
 * - Guard 7 and guard 9 by adopter class (§1 `reworkActorClassOf(principal, actor)`): a Host started as
 *   `kind:'system'` is an operator (class `human`) and supersedes a human-stopped Task; the platform
 *   automation actor (class `system`) may not, nor add a parallel carrier beside it. A human stop committed
 *   between the guard 9 read and the commit moves the carrier's pinned Run: `revision_conflict`, and read
 *   again `forbidden` (§3.6 PLAN-05 守卫 9 race).
 * - An Agent (`apply_future_plan`, the W2 fixture's entered Run): cannot change its own running Task
 *   (`busy`); defers a sibling whose Run ended (recorded with the agent actor); may neither change a
 *   human-stopped sibling (guard 7) nor add a carrier beside it (guard 9), while an operator adopts the same
 *   candidate.
 *
 * Fixture note: the Runs, Leases, Reductions and human stops (a queued operator cancel the Run's pointer
 * names) are seeded directly as read-side fixtures (as in
 * W1-future-plan.test.ts); the adoptions use the public plan service. The real platform path (Workflow,
 * Kernel, human stop, requeue) is tests/scenarios/C7-supersede-failed-task.test.ts and C7-defer-reactivate.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import type {
  EncodedRecord, EncodedRecordSchema, PreparedCommit, RecordBackendSchemas, StoreCommitReceipt,
} from '../../src/core/record-store/ports.js';
import {
  GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeProjectSnapshot, encodeWorkspaceSnapshot,
} from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import { PLAN_STATE_RECORD_SCHEMAS, readGoalPhase } from '../../src/core/work-graph/tasks/plan-readers.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { CONTROL_RECORD_SCHEMAS, encodeControlIntentSnapshot } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { deriveFuturePlanDelta, validateFutureObligationCoverage } from '../../src/core/work-graph/tasks/plan-validation.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { GoalRef, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { RunSnapshot, TaskLeaseSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskReductionSnapshot } from '../../src/contracts/reduction.js';
import { createW2WhiteboardFixture, type W2WhiteboardFixture } from '../helpers/W2-whiteboard-fixture.js';

const AT = '2026-10-06T00:00:00.000Z';
const projectId = 'a2-c7-project';
const workspaceId = 'a2-c7-workspace';
const actor = { kind: 'human' as const, id: 'a2-c7-operator' };
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
/** A Host call context acting as `as` (the operator by default). */
const hostCtx = (as: Extract<ActorRef, { kind: 'human' | 'system' }>): CoreCallContext => ({ projectId, workspaceId,
  principal: { kind: 'host', actor: as }, materialReader: { kind: 'host', projectId, workspaceId, actor: as },
  signal: new AbortController().signal });
const ctx = hostCtx(actor);
/** The platform automation actor (rework class `system`) and a Host operator started as `kind:'system'` (class `human`). */
const automation = hostCtx({ ...WORKFLOW_AUTOMATION_ACTOR });
const hostOperator = { kind: 'system' as const, id: 'a2-c7-host-op' };
const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'a2-c7-goal' };
type DraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;
type SnapshotV2 = Extract<PlanRevisionSnapshot, { schemaVersion: 2 }>;

const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'a2-c7-policy', revision: 1 };
const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId, baselineId: 'a2-c7-baseline', revision: 1 };
const policyFixture = { schemaVersion: 1, identity: { policyId: 'a2-c7-policy' }, revision: 1,
  content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } };
const architectureFixture = { schemaVersion: 1, identity: { baselineId: 'a2-c7-baseline' }, revision: 1,
  content: { schemaVersion: 1, description: 'C7 baseline', constraints: [] } };
const governance = [
  { ref: policyRef, revision: 1, schemaVersion: 1, policyId: 'a2-c7-policy', contentRevision: 1,
    contentDigest: digest(policyFixture as unknown as JsonValue), content: policyFixture.content },
  { ref: architectureRef, revision: 1, schemaVersion: 1, baselineId: 'a2-c7-baseline', contentRevision: 1,
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
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...governanceSchemas, ...PLAN_RECORD_SCHEMAS.records,
    ...PLAN_STATE_RECORD_SCHEMAS.records, ...materialRecordSchemas().records.filter(record => record.aggregateType === 'Run'),
    ...CONTROL_RECORD_SCHEMAS.records, ...COMPLETION_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PLAN_RECORD_SCHEMAS.events,
    { eventType: 'C7Seed', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [...PLAN_RECORD_SCHEMAS.lookups, ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? [])],
};

const work = (taskId: string, title = `Task ${taskId}`): RuntimeTask => ({ taskId, title, requirementLevel: 'required',
  taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });
const check = (requirementId: string) => ({ requirementId, requirementLevel: 'required' as const, kind: 'test', description: 'Tests pass' });

/** A and B are work, the gate carries o-core with them; B alone carries o-solo. */
function initialDraft(): DraftV2 {
  return { schemaVersion: 2, planId: 'c7-plan-1', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [work('A'), work('B'), { ...work('gate'), title: 'Goal gate', taskKind: 'gate' }],
    assignments: [{ taskId: 'A', role: 'builder', instruction: 'Run A' }, { taskId: 'B', role: 'builder', instruction: 'Run B' }],
    obligations: [
      { obligationId: 'o-core', title: 'Deliver core', requirementLevel: 'required', taskIds: ['A', 'B', 'gate'],
        verificationRequirements: [check('check-core')] },
      { obligationId: 'o-solo', title: 'Deliver B only', requirementLevel: 'required', taskIds: ['B'],
        verificationRequirements: [check('check-solo')] },
    ],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
}
/** The future revision of `source` with `edit` applied. */
function futureDraft(source: PlanRevisionSnapshot, planId: string, edit: (draft: DraftV2) => DraftV2): DraftV2 {
  const base = initialDraft();
  return edit({ ...base, planId, planRevision: source.planRevision + 1, tasks: structuredClone(source.tasks),
    assignments: structuredClone(source.assignments ?? []), obligations: structuredClone(source.obligations) });
}
const disposed = (draft: DraftV2, taskId: string, patch: Partial<RuntimeTask>): DraftV2 =>
  ({ ...draft, tasks: draft.tasks.map(task => task.taskId === taskId ? { ...task, ...patch } : task) });

async function setup() {
  const backend = createInMemoryRecordBackend({ schemas });
  let sequence = 0;
  const seedCommit = async (records: readonly EncodedRecord[]): Promise<StoreCommitReceipt> => {
    const n = ++sequence;
    const event = { eventId: `c7-seed-${n}`, eventType: 'C7Seed', schemaVersion: 1, occurredAt: AT };
    return backend.records.commit({ identityKey: `c7-seed-identity-${n}`, fingerprint: `c7-seed-fingerprint-${n}`,
      guards: records.map(record => ({ refKey: record.refKey, expectedRevision: null })), records: [...records],
      events: [{ ...event, json: JSON.stringify(event) }], claims: [], indexGuards: [], indexChanges: [] });
  };
  const scopeSeed: PreparedCommit = { identityKey: 'c7-scope-seed', fingerprint: 'c7-scope-seed-v1',
    guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null }, { refKey: canonicalRefKey(workspace.ref), expectedRevision: null },
      ...governance.map(snapshot => ({ refKey: canonicalJson(snapshot.ref as unknown as JsonValue), expectedRevision: null }))],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace), ...governance.map(snapshot => ({
      refKey: canonicalJson(snapshot.ref as unknown as JsonValue), schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
      revision: snapshot.revision, json: JSON.stringify(snapshot) }))],
    events: [{ eventId: 'c7-scope-seed-event', eventType: 'C7Seed', schemaVersion: 1, occurredAt: AT,
      json: JSON.stringify({ eventId: 'c7-scope-seed-event', eventType: 'C7Seed', schemaVersion: 1, occurredAt: AT }) }],
    claims: [], indexGuards: [], indexChanges: [] };
  if ((await backend.records.commit(scopeSeed)).status !== 'committed') throw new Error('C7 scope seed failed');
  const goals = createGoalService({ records: backend.records, now: () => AT, eventId: () => `c7-goal-${++sequence}` }).tasks;
  const plans = createPlanService({ records: backend.records, now: () => AT, eventId: () => `c7-plan-${++sequence}` });
  const created = await goals.createGoal(ctx, { meta: { requestId: 'c7-create-goal',
    expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: { projectId, workspaceId }, objective: 'C7 disposition changes' } });
  if (created.status !== 'committed') throw new Error(`C7 Goal creation failed: ${JSON.stringify(created)}`);
  let requests = 0;
  /** Proposes `draft` on the active Plan as `caller` (the operator by default). */
  async function propose(draft: PlanRevisionDraft, basedOn: PlanRevisionSnapshot | null, affectedTaskIds?: string[],
    caller: CoreCallContext = ctx) {
    const n = ++requests;
    const proposed = await plans.proposePlan(caller, { meta: { requestId: `c7-propose-${n}`, expected: [] },
      input: { goalRef, basedOn: basedOn?.ref ?? null, draft,
        reason: { text: `C7 change ${n}`, sources: [], ...(affectedTaskIds === undefined ? {} : { affectedTaskIds }) } } });
    if (proposed.status !== 'committed') throw new Error(`C7 proposal ${n} failed: ${JSON.stringify(proposed)}`);
    return { n, ref: proposed.value.ref, revision: proposed.value.revision };
  }
  /** Applies a proposed candidate as `caller` (the operator by default). */
  const apply = (proposal: { ref: { aggregateType: 'PlanProposal'; projectId: string; workspaceId: string; proposalId: string };
    revision: number }, requestId: string, caller: CoreCallContext = ctx, over = plans) =>
    over.applyPlanChange(caller, { meta: { requestId, expected: [] },
      input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] } });
  /** Proposes `draft` on the active Plan and applies it, both as `caller` (the operator by default). */
  async function adopt(draft: PlanRevisionDraft, basedOn: PlanRevisionSnapshot | null, affectedTaskIds?: string[],
    caller: CoreCallContext = ctx) {
    const proposed = await propose(draft, basedOn, affectedTaskIds, caller);
    return apply(proposed, `c7-apply-${proposed.n}`, caller);
  }
  const initial = await adopt(initialDraft(), null);
  if (initial.status !== 'committed') throw new Error(`C7 initial adoption failed: ${JSON.stringify(initial)}`);
  const plan = initial.value;
  const key = (ref: object) => canonicalJson(ref as JsonValue);

  async function seedRun(taskId: string, overrides: Partial<RunSnapshot> = {}): Promise<RunSnapshot> {
    const run: RunSnapshot = { ref: { aggregateType: 'Run', projectId, goalId: goalRef.goalId, runId: `c7-run-${taskId}` },
      revision: 1, schemaVersion: 1, task: { projectId, goalId: goalRef.goalId, taskId }, attemptId: `c7-attempt-${taskId}`,
      planRef: plan.ref, roleBinding: { schemaVersion: 1, bindingId: 'c7-binding', templateId: 'builder', templateRevision: '1',
        bindingVersion: 1, policyRevision: '1' },
      budget: { tokenBudget: 100, deadline: null }, workspaceSnapshot: { workspaceId, revision: 1 },
      status: 'ended', outcome: 'failed', exitCode: 1, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null,
      startedAt: AT, endedAt: AT, ...overrides };
    const result = await seedCommit([{ refKey: key(run.ref), schemaId: 'RunSnapshot@1', revision: 1, json: JSON.stringify(run) }]);
    if (result.status !== 'committed') throw new Error(`C7 Run seed failed: ${JSON.stringify(result)}`);
    return run;
  }
  async function seedLease(taskId: string, released: boolean): Promise<void> {
    const ref = { aggregateType: 'TaskLease' as const, projectId, goalId: goalRef.goalId, taskId };
    const runRef = { aggregateType: 'Run' as const, projectId, goalId: goalRef.goalId, runId: `c7-run-${taskId}` };
    const lease: TaskLeaseSnapshot = { ref, revision: 1, schemaVersion: 1, holderRunId: runRef.runId, attemptId: `c7-attempt-${taskId}`,
      grantedAt: AT, expiresAt: null, ...(released ? { release: { schemaVersion: 1, runRef,
        attemptRef: { aggregateType: 'TaskAttempt', projectId, goalId: goalRef.goalId, taskId, attemptId: `c7-attempt-${taskId}` },
        sessionRef: { projectId, sessionId: 'c7-session' }, generation: 1, releasedAt: AT, eventId: `c7-release-${taskId}` } } : {}) };
    const result = await seedCommit([{ refKey: key(ref), schemaId: 'TaskLeaseSnapshot@1', revision: 1, json: JSON.stringify(lease) }]);
    if (result.status !== 'committed') throw new Error(`C7 Lease seed failed: ${JSON.stringify(result)}`);
  }
  async function seedReduction(taskId: string): Promise<void> {
    const reduction: TaskReductionSnapshot = {
      ref: { aggregateType: 'TaskReduction', projectId, goalId: goalRef.goalId, taskId }, revision: 1, schemaVersion: 1,
      planRef: plan.ref, planRevision: plan.planRevision, taskKind: 'work', requirementLevel: 'required', disposition: 'active',
      phase: 'satisfied', currentAnchor: { schemaVersion: 1, planRef: plan.ref, planRevision: plan.planRevision, workspaceRevision: 1,
        pinnedCompletionPolicy: plan.effectiveCompletionPolicy, pinnedArchitectureBaseline: plan.effectiveArchitectureBaseline },
      effectiveEvidenceIds: ['c7-evidence'], blockingEvidenceIds: [], staleEvidenceIds: [], outOfScopeEvidenceIds: [],
      satisfiedObligationIds: ['o-core', 'o-solo'], causes: [], reducedAt: AT };
    const result = await seedCommit([{ refKey: key(reduction.ref), schemaId: 'TaskReductionSnapshot@1', revision: 1,
      json: JSON.stringify(reduction) }]);
    if (result.status !== 'committed') throw new Error(`C7 Reduction seed failed: ${JSON.stringify(result)}`);
  }
  async function activePlan(): Promise<PlanRevisionSnapshot['ref'] | null> {
    const read = await plans.queryGoal(ctx, goalRef);
    if (read.status !== 'ready') throw new Error('the Goal must be readable');
    return read.value.goal.activePlanRevision;
  }
  async function row(taskId: string) {
    const graph = await plans.queryTaskGraph(ctx, { goalRef });
    if (graph.status !== 'ready') throw new Error(`the graph must be readable: ${JSON.stringify(graph)}`);
    return graph.value.tasks.find(candidate => candidate.ref.taskId === taskId);
  }
  /** A claim's lease row in place of the released one (@1 → @2, held again): what a concurrent claim writes. */
  async function reholdLease(taskId: string): Promise<void> {
    const ref = { aggregateType: 'TaskLease' as const, projectId, goalId: goalRef.goalId, taskId };
    const lease: TaskLeaseSnapshot = { ref, revision: 2, schemaVersion: 1, holderRunId: `c7-run-${taskId}-2`,
      attemptId: `c7-attempt-${taskId}-2`, grantedAt: AT, expiresAt: null };
    const n = ++sequence;
    const event = { eventId: `c7-seed-${n}`, eventType: 'C7Seed', schemaVersion: 1, occurredAt: AT };
    const result = await backend.records.commit({ identityKey: `c7-seed-identity-${n}`, fingerprint: `c7-seed-fingerprint-${n}`,
      guards: [{ refKey: key(ref), expectedRevision: 1 }],
      records: [{ refKey: key(ref), schemaId: 'TaskLeaseSnapshot@1', revision: 2, json: JSON.stringify(lease) }],
      events: [{ ...event, json: JSON.stringify(event) }], claims: [], indexGuards: [], indexChanges: [] });
    if (result.status !== 'committed') throw new Error(`C7 Lease re-hold failed: ${JSON.stringify(result)}`);
  }
  /**
   * An operator's cancel of `run` (a human stop, `reworkFenceOf = human_only`): a queued cancel intent and the
   * Run's pointer to it (Run @k → @k+1) in one commit, as `submitControl` writes them.
   */
  async function humanStop(run: RunSnapshot): Promise<void> {
    const intent: ControlIntentSnapshotV1 = { schemaVersion: 1,
      ref: { aggregateType: 'ControlIntent', projectId, workspaceId, intentId: `c7-cancel-${run.ref.runId}` }, runRef: run.ref,
      kind: 'cancel', desiredState: 'cancelled', reason: 'an operator stopped it', requestedAt: AT, requestedBy: actor,
      revision: 1, status: 'queued' };
    const stopped: RunSnapshot = { ...run, revision: run.revision + 1,
      controlState: { intentRef: intent.ref, desiredState: 'cancelled' } };
    const encoded = encodeControlIntentSnapshot(intent);
    const n = ++sequence;
    const event = { eventId: `c7-seed-${n}`, eventType: 'C7Seed', schemaVersion: 1, occurredAt: AT };
    const result = await backend.records.commit({ identityKey: `c7-seed-identity-${n}`, fingerprint: `c7-seed-fingerprint-${n}`,
      guards: [{ refKey: encoded.refKey, expectedRevision: null }, { refKey: key(run.ref), expectedRevision: run.revision }],
      records: [encoded, { refKey: key(run.ref), schemaId: 'RunSnapshot@1', revision: stopped.revision, json: JSON.stringify(stopped) }],
      events: [{ ...event, json: JSON.stringify(event) }], claims: [], indexGuards: [], indexChanges: [] });
    if (result.status !== 'committed') throw new Error(`C7 human stop failed: ${JSON.stringify(result)}`);
  }
  /** GOAL-04: the operator pauses the Goal, pinning the Goal and its GoalPhase as read (decision 29). */
  async function pauseGoal(): Promise<void> {
    const read = await plans.queryGoal(ctx, goalRef);
    if (read.status !== 'ready') throw new Error('the Goal must be readable');
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: goalRef.projectId, goalId: goalRef.goalId };
    const phase = await readGoalPhase(backend.records, phaseRef);
    if (phase.status !== 'ready') throw new Error('the GoalPhase must be readable');
    const paused = await goals.setGoalControl(ctx, { meta: { requestId: 'c7-pause-goal',
      expected: [{ ref: goalRef, revision: read.value.goal.revision }, { ref: phaseRef, revision: phase.snapshot?.revision ?? 0 }] },
      input: { goalRef, control: 'pause', reason: null } });
    if (paused.status !== 'committed' || paused.value.desiredState !== 'paused') throw new Error(`C7 pause failed: ${JSON.stringify(paused)}`);
  }
  const planServiceOver = (records: typeof backend.records) =>
    createPlanService({ records, now: () => AT, eventId: () => `c7-plan-${++sequence}` });
  return { plans, plan, adopt, propose, apply, seedRun, seedLease, seedReduction, reholdLease, humanStop, pauseGoal, activePlan,
    row, records: backend.records, planServiceOver };
}

describe('deriveFuturePlanDelta and the replacedByTaskId rule (pure, §3.3)', () => {
  const source = { ...initialDraft(), ref: { aggregateType: 'PlanRevision', projectId, planId: 'c7-plan-1' }, revision: 1,
    goalRef, acceptedAt: AT, effectiveCompletionPolicy: { ref: policyRef, digest: 'a'.repeat(64) },
    effectiveArchitectureBaseline: { ref: architectureRef, digest: 'b'.repeat(64) } } as unknown as SnapshotV2;
  const draft = (edit: (draft: DraftV2) => DraftV2) => futureDraft(source, 'c7-plan-2', edit);
  const deltaOf = (target: DraftV2) => {
    const result = deriveFuturePlanDelta(source, target);
    if (result.status !== 'supported') throw new Error(result.reason);
    return result.delta;
  };

  it('only the disposition (or replacedByTaskId) differs → disposition-only, with the change listed', () => {
    expect(deltaOf(draft(target => disposed(target, 'A', { disposition: 'deferred' })))).toMatchObject({
      changedTaskIds: [], addedTaskIds: [], dispositionOnlyTaskIds: ['A'],
      dispositionChanges: [{ taskId: 'A', from: 'active', to: 'deferred', replacedByTaskId: null }], carrierRemovals: [] });
    // An explicit null where the source has no replacement is no change.
    expect(deltaOf(draft(target => disposed(target, 'A', { replacedByTaskId: null })))).toMatchObject({
      changedTaskIds: [], dispositionOnlyTaskIds: [], dispositionChanges: [] });
    // A superseded Task naming a new replacement is a disposition change from superseded to superseded (§3.3).
    const supersededA = { ...source, tasks: source.tasks.map(task => task.taskId === 'A'
      ? { ...task, disposition: 'superseded' as const, replacedByTaskId: 'B' } : task) } as SnapshotV2;
    const repointed = futureDraft(supersededA, 'c7-plan-2', target => disposed(target, 'A', { replacedByTaskId: null }));
    expect(deriveFuturePlanDelta(supersededA, repointed)).toMatchObject({ status: 'supported', delta: { changedTaskIds: [],
      dispositionOnlyTaskIds: ['A'], dispositionChanges: [{ taskId: 'A', from: 'superseded', to: 'superseded', replacedByTaskId: null }] } });
  });

  it('anything else changed (title, assignment, carried obligation) is a changed Task, its disposition change listed too', () => {
    expect(deltaOf(draft(target => disposed(target, 'A', { disposition: 'cancelled', title: 'Task A v2' })))).toMatchObject({
      changedTaskIds: ['A'], dispositionOnlyTaskIds: [], dispositionChanges: [{ taskId: 'A', from: 'active', to: 'cancelled' }],
      carrierRemovals: [] });
    expect(deltaOf(draft(target => ({ ...target, assignments: target.assignments!.map(assignment => assignment.taskId === 'A'
      ? { ...assignment, instruction: 'Run A differently' } : assignment) })))).toMatchObject({ changedTaskIds: ['A'], dispositionOnlyTaskIds: [] });
  });

  it('a Task that leaves an obligation is changed and named for the hint', () => {
    const left = draft(target => ({ ...disposed(target, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }),
      tasks: [...disposed(target, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }).tasks, work('B2')],
      obligations: target.obligations.map(obligation => obligation.obligationId === 'o-solo' ? { ...obligation, taskIds: ['B2'] } : obligation) }));
    expect(deltaOf(left)).toMatchObject({ changedTaskIds: ['B'], addedTaskIds: ['B2'], dispositionOnlyTaskIds: [],
      carrierRemovals: [{ taskId: 'B', obligationIds: ['o-solo'] }] });
    // Leaving an obligation AND changing the title: still named (§3.3 无痕规则: leaving an obligation is refused with the hint).
    const more = draft(() => ({ ...left, tasks: left.tasks.map(task => task.taskId === 'B' ? { ...task, title: 'Task B v2' } : task) }));
    expect(deltaOf(more)).toMatchObject({ changedTaskIds: ['B'], carrierRemovals: [{ taskId: 'B', obligationIds: ['o-solo'] }] });
    // A title change alone leaves no obligation.
    expect(deltaOf(draft(target => disposed(target, 'B', { title: 'Task B v2' }))).carrierRemovals).toEqual([]);
  });

  it.each<[string, Partial<RuntimeTask>, RegExp | null]>([
    ['superseded naming itself', { disposition: 'superseded', replacedByTaskId: 'A' }, /must name another work task of the target plan, not A/],
    ['superseded naming no task of the target', { disposition: 'superseded', replacedByTaskId: 'nope' }, /not nope/],
    ['superseded naming a gate (another kind)', { disposition: 'superseded', replacedByTaskId: 'gate' }, /not gate/],
    ['deferred naming a replacement', { disposition: 'deferred', replacedByTaskId: 'B' }, /only a superseded task names a replacement/],
    ['superseded naming another work task', { disposition: 'superseded', replacedByTaskId: 'B' }, null],
    ['superseded without a replacement', { disposition: 'superseded', replacedByTaskId: null }, null],
  ])('replacedByTaskId: %s', (_name, patch, problem) => {
    const target = draft(base => disposed(base, 'A', patch));
    const coverage = validateFutureObligationCoverage({ source, target, delta: deltaOf(target) });
    if (problem === null) {
      expect(coverage).toEqual({ status: 'supported' });
      return;
    }
    expect(coverage).toMatchObject({ status: 'rejected', issues: [expect.objectContaining({ path: 'tasks[A].replacedByTaskId',
      code: 'unsupported_execution_change', message: expect.stringMatching(problem) })] });
  });
});

describe('W16 disposition-only adoptions at the plan owner (C7, TASK-18/19)', () => {
  it('an untraced Task changes only its disposition: source definition and basis kept, recorded traced:false, carried on', async () => {
    const f = await setup();
    const deferred = await f.adopt(futureDraft(f.plan, 'c7-plan-2', draft => disposed(draft, 'A', { disposition: 'deferred', title: 'Task A v2' })),
      f.plan);
    // A title change too makes A a changed (untraced) Task: it takes the candidate definition and a new basis, and is recorded.
    if (deferred.status !== 'committed' || deferred.value.schemaVersion !== 2) throw new Error(JSON.stringify(deferred));
    expect(deferred.value.tasks.find(task => task.taskId === 'A')).toMatchObject({ disposition: 'deferred', title: 'Task A v2' });
    expect(deferred.value.taskStateBasis?.entries).toContainEqual({ taskId: 'A', planRef: deferred.value.ref });
    expect(deferred.value.dispositionRecord?.entries).toEqual([expect.objectContaining({ taskId: 'A', from: 'active', to: 'deferred',
      traced: false, setIn: deferred.value.ref, actor, reason: { text: 'C7 change 2', sources: [], affectedTaskIds: [] } })]);

    // Disposition only: the source definition with the new disposition, the basis inherited.
    const restored = await f.adopt(futureDraft(deferred.value, 'c7-plan-3', draft => disposed(draft, 'A', { disposition: 'active' })),
      deferred.value);
    if (restored.status !== 'committed' || restored.value.schemaVersion !== 2) throw new Error(JSON.stringify(restored));
    expect(restored.value.tasks.find(task => task.taskId === 'A')).toEqual({ ...deferred.value.tasks.find(task => task.taskId === 'A'),
      disposition: 'active' });
    expect(restored.value.taskStateBasis?.entries).toContainEqual({ taskId: 'A', planRef: deferred.value.ref });
    const latest = expect.objectContaining({ taskId: 'A', from: 'deferred', to: 'active', traced: false, setIn: restored.value.ref });
    expect(restored.value.dispositionRecord?.entries).toEqual([latest]);
    expect(await f.row('A')).toMatchObject({ disposition: 'active', dispositionChange: { from: 'deferred', to: 'active' } });

    // An unrelated adoption (a new Task) carries the record unchanged.
    const unrelated = await f.adopt(futureDraft(restored.value, 'c7-plan-4', draft => ({ ...draft, tasks: [...draft.tasks, work('C')],
      assignments: [...(draft.assignments ?? []), { taskId: 'C', role: 'builder', instruction: 'Run C' }],
      obligations: draft.obligations.map(obligation => obligation.obligationId === 'o-core'
        ? { ...obligation, taskIds: [...obligation.taskIds, 'C'] } : obligation) })), restored.value);
    if (unrelated.status !== 'committed' || unrelated.value.schemaVersion !== 2) throw new Error(JSON.stringify(unrelated));
    expect(unrelated.value.dispositionRecord).toEqual(restored.value.dispositionRecord);
    expect(await f.row('B')).not.toHaveProperty('dispositionChange');
  });

  it('a traced Task (ended Run, released lease) is superseded through TASK-19; listed, its basis and records stay', async () => {
    const f = await setup();
    const run = await f.seedRun('B');
    await f.seedLease('B', true);
    const replace = futureDraft(f.plan, 'c7-plan-2', draft => ({ ...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }),
      tasks: [...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }).tasks, work('B2')],
      assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
      obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B2'] })) }));
    expect(await f.adopt(replace, f.plan)).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'reason.affectedTaskIds must list traced task B' });
    const adopted = await f.adopt(replace, f.plan, ['B']);
    if (adopted.status !== 'committed' || adopted.value.schemaVersion !== 2) throw new Error(JSON.stringify(adopted));
    expect(adopted.value.taskStateBasis?.entries).toContainEqual({ taskId: 'B', planRef: f.plan.ref });
    expect(adopted.value.dispositionRecord?.entries).toEqual([expect.objectContaining({ taskId: 'B', from: 'active',
      to: 'superseded', replacedByTaskId: 'B2', traced: true })]);
    expect(await f.row('B')).toMatchObject({ disposition: 'superseded', execution: run.ref,
      dispositionChange: { traced: true, replacedByTaskId: 'B2' } });

    // An explicit `replacedByTaskId: null` on the traced, unlisted A (the source has none) is no change.
    await f.seedRun('A');
    await f.seedLease('A', true);
    const noop = await f.adopt(futureDraft(adopted.value, 'c7-plan-3', draft => disposed(draft, 'A', { replacedByTaskId: null })),
      adopted.value);
    if (noop.status !== 'committed' || noop.value.schemaVersion !== 2) throw new Error(JSON.stringify(noop));
    expect(noop.value.tasks.find(task => task.taskId === 'A')).toEqual(adopted.value.tasks.find(task => task.taskId === 'A'));
    expect(noop.value.dispositionRecord).toEqual(adopted.value.dispositionRecord);

    // Naming a new replacement is a disposition change of a traced Task (TASK-19, listed), recorded superseded → superseded.
    const repoint = futureDraft(noop.value, 'c7-plan-4', draft => ({ ...disposed(draft, 'B', { replacedByTaskId: 'B3' }),
      tasks: [...disposed(draft, 'B', { replacedByTaskId: 'B3' }).tasks, work('B3')],
      assignments: [...(draft.assignments ?? []), { taskId: 'B3', role: 'builder', instruction: 'Run B3' }],
      obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B3'] })) }));
    expect(await f.adopt(repoint, noop.value)).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'reason.affectedTaskIds must list traced task B' });
    const repointed = await f.adopt(repoint, noop.value, ['B']);
    if (repointed.status !== 'committed' || repointed.value.schemaVersion !== 2) throw new Error(JSON.stringify(repointed));
    expect(repointed.value.tasks.find(task => task.taskId === 'B')).toEqual({ ...f.plan.tasks.find(task => task.taskId === 'B'),
      disposition: 'superseded', replacedByTaskId: 'B3' });
    expect(repointed.value.taskStateBasis?.entries).toContainEqual({ taskId: 'B', planRef: f.plan.ref });
    const latest = expect.objectContaining({ taskId: 'B', from: 'superseded', to: 'superseded', replacedByTaskId: 'B3', traced: true,
      setIn: repointed.value.ref });
    expect(repointed.value.dispositionRecord?.entries).toEqual([latest]);
    expect(await f.row('B')).toMatchObject({ disposition: 'superseded', dispositionChange: latest });
  });

  it('a paused Goal still adopts a traced disposition change (W16 is a plan adoption, not a rework; S17)', async () => {
    const f = await setup();
    await f.seedRun('B');
    await f.seedLease('B', true);
    await f.pauseGoal();
    const deferB = futureDraft(f.plan, 'c7-plan-2', draft => ({ ...disposed(draft, 'B', { disposition: 'deferred' }),
      tasks: [...disposed(draft, 'B', { disposition: 'deferred' }).tasks, work('B2')],
      assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
      obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B2'] })) }));
    expect(await f.adopt(deferB, f.plan, ['B'])).toMatchObject({ status: 'committed',
      value: { dispositionRecord: { entries: [expect.objectContaining({ taskId: 'B', from: 'active', to: 'deferred', traced: true })] } } });
  });

  it.each<[string, (f: Awaited<ReturnType<typeof setup>>) => Promise<unknown>, object]>([
    ['a running Run (guard 1)', async f => { await f.seedRun('B', { status: 'running', outcome: null, exitCode: null, endedAt: null }); },
      { code: 'busy', reason: 'task B still has an unfinished execution: run c7-run-B is running' }],
    ['an unknown outcome (guard 2)', async f => { await f.seedRun('B', { outcome: 'outcome_unknown', exitCode: null });
      await f.seedLease('B', true); }, { code: 'busy', reason: 'task B: resolve the unknown outcome of run c7-run-B first' }],
    ['a lease still held (guard 4)', async f => { await f.seedRun('B'); await f.seedLease('B', false); },
      { code: 'busy', reason: 'task B still holds its TaskLease' }],
    ['Runs without a Lease record (guard 4, legacy data)', async f => { await f.seedRun('B'); },
      { code: 'unavailable', reason: 'task B has Runs but no TaskLease record; its execution facts are inconsistent (legacy data)' }],
    ['a satisfied Task (guard 5)', async f => { await f.seedRun('B', { outcome: 'completed', exitCode: 0 }); await f.seedLease('B', true);
      await f.seedReduction('B'); }, { code: 'invalid', reason: 'task B is satisfied; the disposition of a satisfied task is final' }],
  ])('TASK-19 refuses %s, zero writes', async (_name, seed, refusal) => {
    const f = await setup();
    await seed(f);
    const cancelB = futureDraft(f.plan, 'c7-plan-2', draft => ({ ...disposed(draft, 'B', { disposition: 'cancelled' }),
      tasks: [...disposed(draft, 'B', { disposition: 'cancelled' }).tasks, work('B2')],
      assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
      obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B2'] })) }));
    expect(await f.adopt(cancelB, f.plan, ['B'])).toMatchObject({ status: 'rejected', ...refusal });
    expect(await f.activePlan()).toEqual(f.plan.ref);
  });

  it('a traced Task that leaves an obligation is changed: the untraced rule refuses it and says how to keep it', async () => {
    const f = await setup();
    await f.seedRun('B');
    await f.seedLease('B', true);
    const moved = futureDraft(f.plan, 'c7-plan-2', draft => ({ ...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }),
      tasks: [...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }).tasks, work('B2')],
      assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
      obligations: draft.obligations.map(obligation => obligation.obligationId === 'o-solo' ? { ...obligation, taskIds: ['B2'] }
        : { ...obligation, taskIds: [...obligation.taskIds, 'B2'] }) }));
    expect(await f.adopt(moved, f.plan, ['B'])).toEqual({ status: 'rejected', code: 'revision_conflict',
      reason: 'task B already has a Run and is no longer a future task; a traced task may change only its disposition or '
        + 'replacedByTaskId: keep it in obligations[o-solo].taskIds and add the replacement task as another carrier' });
    expect(await f.activePlan()).toEqual(f.plan.ref);
  });

  it('a claim between the TASK-19 read and the adoption commit moves the Lease: revision_conflict, zero writes; a re-read is busy', async () => {
    const f = await setup();
    await f.seedRun('B');
    await f.seedLease('B', true);
    const cancelB = futureDraft(f.plan, 'c7-plan-2', draft => ({ ...disposed(draft, 'B', { disposition: 'cancelled' }),
      tasks: [...disposed(draft, 'B', { disposition: 'cancelled' }).tasks, work('B2')],
      assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
      obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B2'] })) }));
    const proposed = await f.plans.proposePlan(ctx, { meta: { requestId: 'c7-race-propose', expected: [] },
      input: { goalRef, basedOn: f.plan.ref, draft: cancelB, reason: { text: 'cancel B', sources: [], affectedTaskIds: ['B'] } } });
    if (proposed.status !== 'committed') throw new Error(JSON.stringify(proposed));
    let raced = false;
    const racing: typeof f.records = { ...f.records, async commit(prepared) {
      if (!raced && prepared.identityKey.startsWith('plan-apply:')) {
        raced = true;
        await f.reholdLease('B');
      }
      return f.records.commit(prepared);
    } };
    const applyRequest = (requestId: string) => ({ meta: { requestId, expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    // The adoption pinned B's Lease@1 (TASK-19 guard 4 read it released): the claim's Lease@2 makes it stale.
    expect(await f.planServiceOver(racing).applyPlanChange(ctx, applyRequest('c7-race-apply-1')))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(raced).toBe(true);
    expect(await f.activePlan()).toEqual(f.plan.ref);
    // Read again, the Lease is held: TASK-19 guard 4.
    expect(await f.plans.applyPlanChange(ctx, applyRequest('c7-race-apply-2')))
      .toMatchObject({ status: 'rejected', code: 'busy', reason: 'task B still holds its TaskLease' });
  });

  it('a gate never changes its disposition; deferring the only carrier of a required obligation is invalid', async () => {
    const f = await setup();
    expect(await f.adopt(futureDraft(f.plan, 'c7-plan-2', draft => disposed(draft, 'gate', { disposition: 'cancelled' })), f.plan))
      .toMatchObject({ status: 'rejected', code: 'invalid', reason: expect.stringContaining('source gate task gate changed its definition') });
    expect(await f.adopt(futureDraft(f.plan, 'c7-plan-2b', draft => disposed(draft, 'B', { disposition: 'deferred' })), f.plan))
      .toMatchObject({ status: 'rejected', code: 'invalid',
        reason: expect.stringContaining('required obligation o-solo no longer has a valid active required carrier') });
    expect(await f.activePlan()).toEqual(f.plan.ref);
  });
});

describe('guards 7 and 9 by the adopter class (§1 reworkActorClassOf(principal, actor); LA-3)', () => {
  /** B superseded by a new B2 that joins every obligation. */
  const supersedeB = (source: PlanRevisionSnapshot, planId: string) => futureDraft(source, planId, draft => ({
    ...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }),
    tasks: [...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }).tasks, work('B2')],
    assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
    obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B2'] })) }));
  /** B kept and a parallel carrier B2 added to o-solo, whose only active work carrier is B. */
  const parallelToB = (source: PlanRevisionSnapshot, planId: string) => futureDraft(source, planId, draft => ({ ...draft,
    tasks: [...draft.tasks, work('B2')],
    assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
    obligations: draft.obligations.map(obligation => obligation.obligationId === 'o-solo'
      ? { ...obligation, taskIds: [...obligation.taskIds, 'B2'] } : obligation) }));

  it('a human-stopped Task: the automation actor may not supersede it (guard 7); a Host started as kind:system is an operator (S21)', async () => {
    const f = await setup();
    const run = await f.seedRun('B');
    await f.seedLease('B', true);
    await f.humanStop(run);
    const candidate = await f.propose(supersedeB(f.plan, 'c7-plan-2'), f.plan, ['B'], automation);
    expect(await f.apply(candidate, 'c7-s21-auto', automation)).toEqual({ status: 'rejected', code: 'forbidden',
      reason: 'only an operator may change the disposition of task B: a human paused or cancelled it' });
    expect(await f.activePlan()).toEqual(f.plan.ref);
    // The same candidate adopted by a Host operator whose actor is kind:'system' (not an automation actor): class human.
    const adopted = await f.apply(candidate, 'c7-s21-host-op', hostCtx(hostOperator));
    if (adopted.status !== 'committed' || adopted.value.schemaVersion !== 2) throw new Error(JSON.stringify(adopted));
    expect(adopted.value.dispositionRecord?.entries).toEqual([expect.objectContaining({ taskId: 'B', to: 'superseded', traced: true,
      actor: hostOperator })]);
  });

  it('guard 9: the automation actor may not add a carrier beside a human-stopped one; an unstopped one is no limit', async () => {
    const f = await setup();
    await f.seedRun('B');
    await f.seedLease('B', true);
    // B ended unfenced: the automation actor adds B2 beside it.
    const unfenced = await f.adopt(parallelToB(f.plan, 'c7-plan-2'), f.plan, undefined, automation);
    expect(unfenced).toMatchObject({ status: 'committed' });
    const g = await setup();
    const stoppedRun = await g.seedRun('B');
    await g.seedLease('B', true);
    await g.humanStop(stoppedRun);
    expect(await g.adopt(parallelToB(g.plan, 'c7-plan-2'), g.plan, undefined, automation)).toEqual({ status: 'rejected',
      code: 'forbidden', reason: 'obligation o-solo: a human stopped this work; only an operator may add the parallel carrier B2' });
    // The operator is never limited by guard 9.
    expect(await g.adopt(parallelToB(g.plan, 'c7-plan-2'), g.plan)).toMatchObject({ status: 'committed' });
  });

  it('a human stop between the guard 9 read and the adoption commit moves the carrier\'s pinned Run: revision_conflict, zero writes; a re-read is forbidden', async () => {
    const f = await setup();
    const run = await f.seedRun('B');
    await f.seedLease('B', true);
    const candidate = await f.propose(parallelToB(f.plan, 'c7-plan-2'), f.plan, undefined, automation);
    let raced = false;
    const racing: typeof f.records = { ...f.records, async commit(prepared) {
      if (!raced && prepared.identityKey.startsWith('plan-apply:')) {
        raced = true;
        await f.humanStop(run);
      }
      return f.records.commit(prepared);
    } };
    // Guard 9 read B (its only active work carrier) unfenced and pinned its Run@1: the stop's Run@2 makes it stale.
    expect(await f.apply(candidate, 'c7-g9-race-1', automation, f.planServiceOver(racing)))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(raced).toBe(true);
    expect(await f.activePlan()).toEqual(f.plan.ref);
    // Read again, B is fenced: guard 9.
    expect(await f.apply(candidate, 'c7-g9-race-2', automation)).toEqual({ status: 'rejected', code: 'forbidden',
      reason: 'obligation o-solo: a human stopped this work; only an operator may add the parallel carrier B2' });
    expect(await f.activePlan()).toEqual(f.plan.ref);
  });
});

describe('an Agent adoption (W2 apply_future_plan, adopter class agent)', () => {
  it('cannot change the disposition of its own running Task (TASK-19 guard 1: busy), zero writes', async () => {
    const f = await createW2WhiteboardFixture('memory');
    try {
      const draft = f.futureDraft('c7-w2-defer-own', base => ({ ...base,
        tasks: base.tasks.map(task => task.taskId === 'implement-a' ? { ...task, disposition: 'deferred' as const } : task) }));
      const candidate = await f.seedAgentCandidate({ draft, basedOn: f.planRef, proposalId: 'c7-w2-defer-own' });
      const before = await f.goalPin();
      expect(await f.applyAsWorkRun(candidate.ref, candidate.revision, { requestId: 'c7-w2-defer-own-apply' })).toMatchObject({
        status: 'rejected', code: 'busy', reason: expect.stringMatching(/^task implement-a still has an unfinished execution: run .* is running$/) });
      expect(await f.goalPin()).toEqual(before);
    } finally {
      await f.close();
    }
  });

  /** The W2 fixture with the ControlIntent schema, so a sibling's Run can carry an operator's cancel. */
  const W2_CONTROL_SCHEMAS = { records: CONTROL_RECORD_SCHEMAS.records, events: [] };
  const implementC: RuntimeTask = { taskId: 'implement-c', title: 'Implement C', requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' };
  /**
   * A sibling Task's ended (failed) Run on `planRef` (the Plan its basis is in) in the W2 Goal with its released
   * Lease; when `stopped`, the Run's pointer names an operator's queued cancel (`reworkFenceOf = human_only`).
   */
  async function seedEndedSibling(f: W2WhiteboardFixture, taskId: string, planRef: PlanRevisionSnapshot['ref'],
    stopped: boolean): Promise<void> {
    const { projectId: p, goalId } = f.goalRef;
    const ws = f.base.scope.workspaceId;
    const runRef = { aggregateType: 'Run' as const, projectId: p, goalId, runId: `c7-w2-run-${taskId}` };
    const intentRef = { aggregateType: 'ControlIntent' as const, projectId: p, workspaceId: ws, intentId: `c7-w2-cancel-${taskId}` };
    const run: RunSnapshot = { ref: runRef, revision: 1, schemaVersion: 1, task: { projectId: p, goalId, taskId },
      attemptId: `c7-w2-attempt-${taskId}`, planRef, roleBinding: f.roleBinding, budget: f.base.budget,
      workspaceSnapshot: { workspaceId: ws, revision: 1 }, status: 'ended', outcome: 'failed', exitCode: 1, lastEventSeq: 0,
      lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: AT, endedAt: AT,
      ...(stopped ? { controlState: { intentRef, desiredState: 'cancelled' as const } } : {}) };
    const leaseRef = { aggregateType: 'TaskLease' as const, projectId: p, goalId, taskId };
    const lease: TaskLeaseSnapshot = { ref: leaseRef, revision: 1, schemaVersion: 1, holderRunId: runRef.runId,
      attemptId: run.attemptId, grantedAt: AT, expiresAt: null, release: { schemaVersion: 1, runRef,
        attemptRef: { aggregateType: 'TaskAttempt', projectId: p, goalId, taskId, attemptId: run.attemptId },
        sessionRef: { projectId: p, sessionId: 'c7-w2-session' }, generation: 1, releasedAt: AT, eventId: `c7-w2-release-${taskId}` } };
    const records: EncodedRecord[] = [
      { refKey: canonicalJson(runRef as unknown as JsonValue), schemaId: 'RunSnapshot@1', revision: 1, json: JSON.stringify(run) },
      { refKey: canonicalJson(leaseRef as unknown as JsonValue), schemaId: 'TaskLeaseSnapshot@1', revision: 1, json: JSON.stringify(lease) },
    ];
    if (stopped) {
      records.push(encodeControlIntentSnapshot({ schemaVersion: 1, ref: intentRef, runRef, kind: 'cancel', desiredState: 'cancelled',
        reason: 'an operator stopped it', requestedAt: AT, requestedBy: actor, revision: 1, status: 'queued' }));
    }
    const committed = await f.base.commitRaw(records);
    if (committed.status !== 'committed') throw new Error(`C7 W2 sibling seed failed: ${JSON.stringify(committed)}`);
  }
  /** The Agent's own `propose_future_plan` on `basedOn`, with `reason.affectedTaskIds` when given. */
  async function proposeAsAgent(f: W2WhiteboardFixture, draft: PlanRevisionDraft, basedOn: PlanRevisionSnapshot, requestId: string,
    affectedTaskIds?: string[]) {
    const request = await f.buildAgentProposeRequest(f.goalRef, basedOn.ref, draft, basedOn.ref, { requestId });
    const proposed = await f.plans.proposePlan(f.ctxWork, { meta: request.meta, input: { ...request.input,
      reason: { text: 'C7 Agent change', sources: [], ...(affectedTaskIds === undefined ? {} : { affectedTaskIds }) } } });
    if (proposed.status !== 'committed') throw new Error(`C7 Agent proposal ${requestId} failed: ${JSON.stringify(proposed)}`);
    return proposed.value;
  }

  it('defers a sibling whose Run ended (TASK-19, class agent): committed, recorded with the agent actor, shown on the row', async () => {
    const f = await createW2WhiteboardFixture('memory', W2_CONTROL_SCHEMAS);
    try {
      await seedEndedSibling(f, 'implement-b', f.planRef, false);
      const draft = f.futureDraft('c7-w2-defer-b', base => ({ ...base,
        tasks: base.tasks.map(task => task.taskId === 'implement-b' ? { ...task, disposition: 'deferred' as const } : task) }));
      const candidate = await proposeAsAgent(f, draft, f.plan, 'c7-w2-defer-b', ['implement-b']);
      const applied = await f.applyAsWorkRun(candidate.ref, candidate.revision, { requestId: 'c7-w2-defer-b-apply' });
      if (applied.status !== 'committed' || applied.value.schemaVersion !== 2) throw new Error(JSON.stringify(applied));
      const entry = expect.objectContaining({ taskId: 'implement-b', from: 'active', to: 'deferred', traced: true,
        actor: expect.objectContaining({ kind: 'agent', runRef: f.claim.runRef }) });
      expect(applied.value.dispositionRecord?.entries).toEqual([entry]);
      const graph = await f.plans.queryTaskGraph(f.ctxHost, { goalRef: f.goalRef });
      if (graph.status !== 'ready') throw new Error(JSON.stringify(graph));
      expect(graph.value.tasks.find(row => row.ref.taskId === 'implement-b')).toMatchObject({ disposition: 'deferred',
        dispositionChange: entry });
    } finally {
      await f.close();
    }
  });

  it('may neither change a human-stopped sibling (guard 7) nor add a carrier beside it (guard 9); an operator adopts the same candidate', async () => {
    const f = await createW2WhiteboardFixture('memory', W2_CONTROL_SCHEMAS);
    try {
      // The operator first gives implement-b (still untraced) an obligation it alone carries.
      const own = f.futureDraft('c7-w2-own-b', base => ({ ...base, obligations: [...base.obligations,
        { obligationId: 'obligation-b', title: 'Deliver B', requirementLevel: 'required', taskIds: ['implement-b'],
          verificationRequirements: [{ requirementId: 'check-b', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }] }));
      const ownProposal = await f.proposeAsHost(own, f.planRef, { requestId: 'c7-w2-own-b' });
      if (ownProposal.status !== 'committed') throw new Error(JSON.stringify(ownProposal));
      const p2 = await f.applyAsHost(ownProposal.value.ref, ownProposal.value.revision, { requestId: 'c7-w2-own-b-apply' });
      if (p2.status !== 'committed') throw new Error(JSON.stringify(p2));
      // Its Run is on P2, where its execution definition (now carrying obligation-b) has its basis.
      await seedEndedSibling(f, 'implement-b', p2.value.ref, true);
      const pins = await f.callerPins(f.goalRef, p2.value.ref);
      const before = await f.goalPin();

      // Guard 7: an Agent may not supersede what a human stopped.
      const supersede = f.futureDraftFor(p2.value, 'c7-w2-supersede-b', base => ({ ...base,
        tasks: [...base.tasks.map(task => task.taskId === 'implement-b'
          ? { ...task, disposition: 'superseded' as const, replacedByTaskId: 'implement-c' } : task), implementC],
        assignments: [...(base.assignments ?? []), { taskId: 'implement-c', role: 'builder', instruction: 'Implement C' }],
        obligations: base.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'implement-c'] })) }));
      const superseding = await proposeAsAgent(f, supersede, p2.value, 'c7-w2-supersede-b', ['implement-b']);
      expect(await f.applyAsWorkRun(superseding.ref, superseding.revision, { requestId: 'c7-w2-supersede-b-apply', expected: pins }))
        .toEqual({ status: 'rejected', code: 'forbidden',
          reason: 'only an operator may change the disposition of task implement-b: a human paused or cancelled it' });

      // Guard 9: nor keep it and add a parallel carrier to the obligation it alone carries.
      const parallel = f.futureDraftFor(p2.value, 'c7-w2-parallel-b', base => ({ ...base, tasks: [...base.tasks, implementC],
        assignments: [...(base.assignments ?? []), { taskId: 'implement-c', role: 'builder', instruction: 'Implement C' }],
        obligations: base.obligations.map(obligation => obligation.obligationId === 'obligation-b'
          ? { ...obligation, taskIds: [...obligation.taskIds, 'implement-c'] } : obligation) }));
      const adding = await proposeAsAgent(f, parallel, p2.value, 'c7-w2-parallel-b');
      expect(await f.applyAsWorkRun(adding.ref, adding.revision, { requestId: 'c7-w2-parallel-b-apply', expected: pins }))
        .toEqual({ status: 'rejected', code: 'forbidden',
          reason: 'obligation obligation-b: a human stopped this work; only an operator may add the parallel carrier implement-c' });
      expect(await f.goalPin()).toEqual(before);

      // The operator adopts the same candidate through plans/apply (class human: guard 9 does not apply).
      expect(await f.applyAsHost(adding.ref, adding.revision, { requestId: 'c7-w2-parallel-b-host', expected: pins }))
        .toMatchObject({ status: 'committed' });
    } finally {
      await f.close();
    }
  });
});
