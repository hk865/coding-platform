/**
 * W1 behavior tests — real SQLite public composition and claim race.
 *
 * The first test goes through the REAL `createTargetPlatform` composition root
 * (one durable SQLite ledger) across close/reopen, exercises explicit old Plan
 * reads and a truly-unexecuted future-task edit, then asserts the W1 adoption,
 * same-identity replay and restart replay. The second test uses the real SQLite claim fixture and the
 * real `TaskClaimPort` with a controlled commit barrier: both writers finish
 * their reads on the SAME old source, then commit in both orders. Only one may
 * win; the selected Plan and Lease prove the committed winner. Store rollback
 * and Claim tests cover atomicity of the complete Run/Lease/occupancy batch.
 *
 * Read-side fixture note: the later accepted Plan and its Run are seeded
 * directly into SQLite only to make the explicit old-Plan read observable; the
 * initial plan adoption, claim and every W1 write otherwise go through public
 * ports.
 *
 * Specification: docs/refactor/tasks/W1-future-plan-skeleton.md §8.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { GoalRef, GoalSnapshot, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { PlanProposalRef } from '../../src/core/work-graph/tasks/plan-contracts.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { canonicalRefKey, encodeGoalSnapshot, encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS, encodePlanRevisionSnapshot } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createTaskClaimFixture } from '../helpers/task-claim-fixture.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const AT = '2026-09-25T00:00:00.000Z';
const projectId = 'w1-composed';
const workspaceId = 'w1-composed-workspace';
const scope = { projectId, workspaceId };
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'w1-composed-operator' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'goal-1' };
type Records = GoalRecordTransactionPort & RecordLookupPort;
type PlanDraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;

const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'w1-policy', revision: 1 };
const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId, baselineId: 'w1-baseline', revision: 1 };
const policyFixture = { schemaVersion: 1, identity: { policyId: 'w1-policy' }, revision: 1,
  content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } };
const architectureFixture = { schemaVersion: 1, identity: { baselineId: 'w1-baseline' }, revision: 1,
  content: { schemaVersion: 1, description: 'W1 composed baseline', constraints: [] } };
const governance = [
  { ref: policyRef, revision: 1, schemaVersion: 1, policyId: 'w1-policy', contentRevision: 1,
    contentDigest: digest(policyFixture as unknown as JsonValue), content: policyFixture.content },
  { ref: architectureRef, revision: 1, schemaVersion: 1, baselineId: 'w1-baseline', contentRevision: 1,
    contentDigest: digest(architectureFixture as unknown as JsonValue), content: architectureFixture.content },
  { ref: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId }, projectId, revision: 1, activeRevision: policyRef },
  { ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId }, projectId, revision: 1, activeRevision: architectureRef },
];
const encodeGovernance = (snapshot: (typeof governance)[number]): EncodedRecord => ({
  refKey: canonicalJson(snapshot.ref as unknown as JsonValue), schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
  revision: snapshot.revision, json: JSON.stringify(snapshot),
});
const materialSchemas = materialRecordSchemas();
const fullSchemas: RecordBackendSchemas = {
  records: [...materialSchemas.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records, ...PLAN_RECORD_SCHEMAS.records,
    ...PLAN_STATE_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records, ...TASK_CLAIM_RECORD_SCHEMAS.records],
  events: [...materialSchemas.events, ...PLAN_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    ...TASK_CLAIM_RECORD_SCHEMAS.events,
    { eventType: 'TrustedScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [...(materialSchemas.lookups ?? []), ...(PLAN_RECORD_SCHEMAS.lookups ?? []),
    ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_RECORD_SCHEMAS.lookups ?? []),
    ...(TASK_CLAIM_RECORD_SCHEMAS.lookups ?? [])],
};
const seed: PreparedCommit = { identityKey: 'w1-composed-scope-seed', fingerprint: 'w1-composed-scope-seed-v1',
  guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
    { refKey: canonicalRefKey(workspace.ref), expectedRevision: null },
    ...governance.map(snapshot => ({ refKey: canonicalJson(snapshot.ref as unknown as JsonValue), expectedRevision: null }))],
  records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace), ...governance.map(encodeGovernance)],
  events: [{ eventId: 'w1-composed-scope-event', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: AT,
    json: JSON.stringify({ eventId: 'w1-composed-scope-event', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: AT }) }],
  claims: [], indexGuards: [], indexChanges: [] };

const composedDraft: PlanDraftV2 = { schemaVersion: 2, planId: 'w1-composed-plan', planRevision: 1,
  goalId: 'goal-1', stages: [],
  tasks: [
    { taskId: 'implement', title: 'Implement', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    { taskId: 'refine', title: 'Refine', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    { taskId: 'polish', title: 'Polish', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
  ],
  assignments: [{ taskId: 'implement', role: 'builder', instruction: 'Implement the composed goal' },
    { taskId: 'refine', role: 'builder', instruction: 'Refine the composed goal' },
    { taskId: 'polish', role: 'builder', instruction: 'Polish the composed goal' }],
  obligations: [{ obligationId: 'composed-obligation', title: 'Deliver implementation', requirementLevel: 'required',
    taskIds: ['implement', 'refine', 'polish', 'goal-gate'],
    verificationRequirements: [{ requirementId: 'composed-check', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };

/** Edit only the truly-unexecuted `polish`; target revision must be source+1. */
function changePolishDraft(planId: string, planRevision: number): PlanDraftV2 {
  return { ...composedDraft, planId, planRevision,
    tasks: composedDraft.tasks.map(task => task.taskId === 'polish' ? { ...task, title: 'Polish v2' } : task),
    assignments: (composedDraft.assignments ?? []).map(assignment => assignment.taskId === 'polish'
      ? { ...assignment, instruction: 'Polish the composed goal v2' } : assignment),
    taskRelations: [{ fromTaskId: 'implement', toTaskId: 'polish', kind: 'coordination', note: 'advisory' }] };
}

function planServiceOver(records: Records, tag: string): ReturnType<typeof createPlanService> {
  let n = 0;
  return createPlanService({ records, now: () => AT, eventId: () => `w1-${tag}-${++n}` });
}

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it('scenario 6/restart + W1 success: real SQLite adopt -> replay -> later revision -> reopen replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-w1-composed-'));
  dirs.push(directory);
  const ledgerPath = join(directory, 'ledger.sqlite');
  const seedBackend = createSqliteRecordBackend({ path: ledgerPath, schemas: fullSchemas });
  try { expect(await seedBackend.records.commit(seed)).toMatchObject({ status: 'committed' }); }
  finally { await seedBackend.close(); }

  const workspaceBindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === projectId && requested.workspaceId === workspaceId
        ? { status: 'ready', value: { root: directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
    },
    async authorize() { return { status: 'rejected', code: 'forbidden', reason: 'no source read grant' }; },
  };
  const options = { storage: { kind: 'sqlite' as const, directory }, workspace: workspaceBindings, now: () => AT,
    kernelStores: { entries: [{ adapterId: 'w1-kernel', storeKey: 'w1-kernel-store', workspace: scope,
      databasePath: join(directory, 'kernel.sqlite') }] } };

  const first = await createTargetPlatform(options);
  let plan1: PlanRevisionSnapshot;
  let goalAfter: GoalSnapshot;
  try {
    const goal = await first.goals.createGoal(ctx, { meta: { requestId: 'w1-composed-goal',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: goalRef.goalId, workspace: scope, objective: 'W1 composed future whiteboard' } });
    expect(goal).toMatchObject({ status: 'committed' });
    if (goal.status !== 'committed') throw new Error('composed Goal creation failed');
    const proposed = await first.plans.proposePlan(ctx, { meta: { requestId: 'w1-composed-propose', expected: [] },
      input: { goalRef, basedOn: null, draft: composedDraft, reason: { text: 'Initial composed plan', sources: [] } } });
    expect(proposed).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });
    if (proposed.status !== 'committed') throw new Error('composed proposal failed');
    const applied = await first.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-composed-apply', expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    expect(applied).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw new Error('composed initial adoption failed');
    plan1 = applied.value;
    const read = await first.plans.queryGoal(ctx, goalRef);
    if (read.status !== 'ready') throw new Error('composed Goal read failed');
    goalAfter = read.value.goal;
  } finally { await first.close(); }

  // Read-side fixture: a later accepted Plan pinned by the Goal with a Run for
  // `refine`, so `polish` stays truly unexecuted for the W1 edit.
  const plan2Ref: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId, planId: 'w1-composed-later' };
  const plan2: PlanRevisionSnapshot = { ...plan1, ref: plan2Ref, planId: plan2Ref.planId, planRevision: 2 };
  const nextGoal: GoalSnapshot = { ...goalAfter, activePlanRevision: plan2Ref, revision: goalAfter.revision + 1 };
  const runRef: RunRef = { aggregateType: 'Run', projectId, goalId: goalRef.goalId, runId: 'w1-composed-refine-run' };
  const run: RunSnapshot = { ref: runRef, revision: 1, schemaVersion: 1,
    task: { projectId, goalId: goalRef.goalId, taskId: 'refine' }, attemptId: 'w1-composed-refine-attempt',
    planRef: plan2Ref, roleBinding: { schemaVersion: 1, bindingId: 'w1-binding', templateId: 'builder',
      templateRevision: '1', bindingVersion: 1, policyRevision: '1' },
    budget: { tokenBudget: 100, deadline: null }, workspaceSnapshot: { workspaceId, revision: 1 },
    status: 'running', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '',
    envelope: null, startedAt: AT, endedAt: null };
  const raw = createSqliteRecordBackend({ path: ledgerPath, schemas: fullSchemas });
  try {
    const fixtureEvent = { eventId: 'w1-composed-fixture', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: AT };
    const committed = await raw.records.commit({ identityKey: 'w1-composed-fixture', fingerprint: 'w1-composed-fixture-v1',
      guards: [{ refKey: canonicalJson(goalRef as unknown as JsonValue), expectedRevision: goalAfter.revision },
        { refKey: canonicalJson(plan2Ref as unknown as JsonValue), expectedRevision: null },
        { refKey: canonicalJson(runRef as unknown as JsonValue), expectedRevision: null }],
      records: [encodePlanRevisionSnapshot(plan2), encodeGoalSnapshot(nextGoal),
        { refKey: canonicalJson(runRef as unknown as JsonValue), schemaId: 'RunSnapshot@1', revision: 1, json: JSON.stringify(run) }],
      events: [{ ...fixtureEvent, json: JSON.stringify(fixtureEvent) }], claims: [], indexGuards: [], indexChanges: [] });
    expect(committed).toMatchObject({ status: 'committed' });
  } finally { await raw.close(); }

  let committedChange: { ref: PlanProposalRef; revision: number; snapshot: PlanRevisionSnapshot } | null = null;
  const reopened = await createTargetPlatform(options);
  try {
    expect(await reopened.plans.queryGoal(ctx, goalRef)).toMatchObject({ status: 'ready',
      value: { goal: { activePlanRevision: plan2Ref, revision: 3 } } });
    const active = await reopened.plans.queryTaskGraph(ctx, { goalRef });
    expect(active).toMatchObject({ status: 'ready', value: { plan: { ref: plan2Ref } } });
    if (active.status === 'ready') {
      expect(active.value.tasks.find(task => task.ref.taskId === 'refine')).toMatchObject({ effectivePhase: 'running' });
      expect(active.value.tasks.find(task => task.ref.taskId === 'polish')).toMatchObject({ effectivePhase: 'pending' });
    }
    // An explicit old Plan keeps its own definition and does not absorb the later Run.
    const old = await reopened.plans.queryTaskGraph(ctx, { goalRef, planRef: plan1.ref });
    expect(old).toMatchObject({ status: 'ready', value: { plan: { ref: plan1.ref } } });
    if (old.status === 'ready') {
      expect(old.value.tasks.find(task => task.ref.taskId === 'refine')).toMatchObject({ execution: null });
    }
    const ready = await reopened.plans.queryReadyTasks(ctx, { goalRef, includeBlocked: false, page: { limit: 20 } });
    expect(ready).toMatchObject({ status: 'ready' });
    if (ready.status === 'ready') expect(ready.value.items.map(item => item.task.ref.taskId)).not.toContain('refine');

    // W1: a truly-unexecuted future task, target revision = source + 1.
    const change = await reopened.plans.proposePlan(ctx, { meta: { requestId: 'w1-composed-change', expected: [] },
      input: { goalRef, basedOn: plan2Ref, draft: changePolishDraft('w1-composed-change', 3),
        reason: { text: 'Future-only polish edit', sources: [] } } });
    expect(change).toMatchObject({ status: 'committed' });
    if (change.status !== 'committed') throw new Error('composed future candidate failed to persist');
    const applied = await reopened.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-composed-change-apply', expected: [] },
      input: { proposalRef: change.value.ref, expectedProposalRevision: change.value.revision, decisionRefs: [] } });
    expect.soft(applied).toMatchObject({ status: 'committed' });
    if (applied.status === 'committed') {
      committedChange = { ref: change.value.ref, revision: change.value.revision, snapshot: applied.value };
      const goal = await reopened.plans.queryGoal(ctx, goalRef);
      expect.soft(goal).toMatchObject({ status: 'ready', value: { goal: { activePlanRevision: applied.value.ref } } });
      const replay = await reopened.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-composed-change-apply', expected: [] },
        input: { proposalRef: change.value.ref, expectedProposalRevision: change.value.revision, decisionRefs: [] } });
      expect(replay).toMatchObject({ status: 'committed', replayed: true, value: applied.value });
      // A later legal revision must not change the original request's receipt.
      const later = await reopened.plans.proposePlan(ctx, { meta: { requestId: 'w1-composed-later-change', expected: [] },
        input: { goalRef, basedOn: applied.value.ref, draft: changePolishDraft('w1-composed-edge', 4),
          reason: { text: 'Later legal revision', sources: [] } } });
      expect(later).toMatchObject({ status: 'committed' });
      if (later.status === 'committed') {
        expect(await reopened.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-composed-later-apply', expected: [] },
          input: { proposalRef: later.value.ref, expectedProposalRevision: later.value.revision, decisionRefs: [] } }))
          .toMatchObject({ status: 'committed' });
      }
      const replayAfterLater = await reopened.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-composed-change-apply', expected: [] },
        input: { proposalRef: change.value.ref, expectedProposalRevision: change.value.revision, decisionRefs: [] } });
      expect(replayAfterLater).toMatchObject({ status: 'committed', replayed: true, value: applied.value });
    }
    // Zero write on the unsupported fold: the goal read above still succeeds.
    expect((await reopened.plans.queryGoal(ctx, goalRef)).status).toBe('ready');
  } finally { await reopened.close(); }

  // The original request still returns its original receipt after a restart.
  if (committedChange !== null) {
    const restarted = await createTargetPlatform(options);
    try {
      const replay = await restarted.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-composed-change-apply', expected: [] },
        input: { proposalRef: committedChange.ref, expectedProposalRevision: committedChange.revision, decisionRefs: [] } });
      expect(replay).toMatchObject({ status: 'committed', replayed: true, value: committedChange.snapshot });
    } finally { await restarted.close(); }
  }
});

it('scenario 3: with a commit barrier, a future edit of B and claim(B) are mutually exclusive', async () => {
  async function changeB(fixture: Awaited<ReturnType<typeof createTaskClaimFixture>>) {
    const draft: PlanDraftV2 = { schemaVersion: 2, planId: 'w1-race-plan-2', planRevision: 2,
      goalId: fixture.goalRef.goalId, stages: fixture.plan.stages,
      tasks: fixture.plan.tasks.map(task => task.taskId === 'implement-b' ? { ...task, title: 'Implement B v2' } : task),
      assignments: fixture.plan.assignments ?? [], obligations: fixture.plan.obligations,
      taskHierarchy: fixture.plan.taskHierarchy, executionDag: fixture.plan.executionDag,
      taskRelations: [{ fromTaskId: 'implement-a', toTaskId: 'implement-b', kind: 'coordination', note: 'race' }],
      inputRequirements: [] };
    const proposed = await fixture.plans.proposePlan(fixture.ctx, { meta: { requestId: 'w1-race-propose', expected: [] },
      input: { goalRef: fixture.goalRef, basedOn: fixture.planRef, draft, reason: { text: 'Race edit B', sources: [] } } });
    if (proposed.status !== 'committed') throw new Error(`race candidate failed: ${JSON.stringify(proposed)}`);
    return proposed.value;
  }

  async function race(order: 'edit-first' | 'claim-first') {
    const f = await createTaskClaimFixture('sqlite');
    try {
      const candidate = await changeB(f);
      const request = await f.buildRequest({ input: { taskId: f.tasks.second.taskId } });
      const claimService = f.makeService(f.records);
      // Barrier: gate both writers at commit until both have finished reading.
      let editArrived = false;
      let claimArrived = false;
      let resolveBoth!: () => void;
      const bothArrived = new Promise<void>(resolve => { resolveBoth = resolve; });
      let releaseClaim!: () => void;
      const claimCommitted = new Promise<void>(resolve => { releaseClaim = resolve; });
      let releaseEdit!: () => void;
      const editCommitted = new Promise<void>(resolve => { releaseEdit = resolve; });
      let resolveEditSettled!: () => void;
      const editSettled = new Promise<void>(resolve => { resolveEditSettled = resolve; });
      let resolveClaimSettled!: () => void;
      const claimSettled = new Promise<void>(resolve => { resolveClaimSettled = resolve; });
      const wrapped: Records = { ...f.records, async commit(prepared) {
        const tag = prepared.identityKey.startsWith('plan-apply:') ? 'edit'
          : prepared.identityKey.startsWith('task-claim:') ? 'claim' : null;
        if (tag === null) return f.records.commit(prepared);
        if (tag === 'edit') editArrived = true; else claimArrived = true;
        if (editArrived && claimArrived) resolveBoth();
        // Both sides must have finished their reads (or the other side settles
        // without committing in this Stage 1 skeleton) before either commits.
        await Promise.race([bothArrived, editSettled, claimSettled]);
        if (order === 'edit-first' && tag === 'claim') await Promise.race([editCommitted, editSettled]);
        if (order === 'claim-first' && tag === 'edit') await Promise.race([claimCommitted, claimSettled]);
        const result = await f.records.commit(prepared);
        if (tag === 'edit') releaseEdit(); else releaseClaim();
        return result;
      } };
      const editPlans = planServiceOver(wrapped, `race-${order}`);
      const editPromise = editPlans.applyPlanChange(f.ctx, { meta: { requestId: 'w1-race-edit', expected: [] },
        input: { proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [] } })
        .finally(resolveEditSettled);
      const claimPromise = f.makeService(wrapped).claimTask(f.ctx, request).finally(resolveClaimSettled);
      const [editResult, claimResult] = await Promise.all([editPromise, claimPromise]);
      expect.soft(editArrived).toBe(true);
      expect.soft(claimArrived).toBe(true);

      const leaseKey = canonicalJson({ aggregateType: 'TaskLease', projectId: f.scope.projectId,
        goalId: f.goalRef.goalId, taskId: f.tasks.second.taskId } as unknown as JsonValue);
      const newPlanRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: f.scope.projectId, planId: 'w1-race-plan-2' };
      if (order === 'edit-first') {
        expect.soft(editResult).toMatchObject({ status: 'committed' });
        expect.soft(claimResult).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
        const goal = await f.plans.queryGoal(f.ctx, f.goalRef);
        expect.soft(goal).toMatchObject({ status: 'ready', value: { goal: { activePlanRevision: newPlanRef } } });
        expect.soft(await f.records.readMany([leaseKey])).toMatchObject({ status: 'ready', value: { missing: [leaseKey] } });
      } else {
        expect.soft(claimResult).toMatchObject({ status: 'committed' });
        expect.soft(editResult).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
        const goal = await f.plans.queryGoal(f.ctx, f.goalRef);
        expect.soft(goal).toMatchObject({ status: 'ready', value: { goal: { activePlanRevision: f.planRef } } });
        expect.soft(await f.records.readMany([canonicalJson(newPlanRef as unknown as JsonValue)]))
          .toMatchObject({ status: 'ready', value: { missing: [canonicalJson(newPlanRef as unknown as JsonValue)] } });
      }
    } finally { await f.close(); }
  }

  await race('edit-first');
  await race('claim-first');
});
