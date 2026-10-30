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
 * Read-side note: the Project/Workspace/CompletionPolicy/ArchitectureBootstrap,
 * the later accepted Plan and its Run are produced by the same public owners as
 * the initial plan adoption, so the explicit old-Plan read observes real writes.
 *
 * Specification: docs/refactor/tasks/W1-future-plan-skeleton.md §8.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createInitializationBindingReader } from '../../src/core/work-graph/tasks/goal-confirm-service.js';
import { createTaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { withBackendOrderedLookup } from '../helpers/ordered-lookup-forward.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { CreateSessionRequest } from '../../src/core/agent-runtime/session-operations.js';
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

const policyContent = { schemaVersion: 1 as const, requirementKinds: ['test'],
  minimumRequiredRequirementsPerObligation: 1 };
const architectureContent = { schemaVersion: 1 as const, description: 'W1 composed baseline', constraints: [] };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'w1-policy', revision: 1 };
const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId, baselineId: 'w1-baseline', revision: 1 };

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
  return createPlanService({ records, bindings: createInitializationBindingReader({ records }),
    now: () => AT, eventId: () => `w1-${tag}-${++n}` });
}

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it('scenario 6/restart + W1 success: real SQLite adopt -> replay -> later revision -> reopen replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-w1-composed-'));
  dirs.push(directory);

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
  try {
    // Public bootstrap on the same SQLite platform: Project, Workspace, the
    // active CompletionPolicy and the initial ArchitectureBaseline.
    const createdProject = await first.projects.createProject(ctx, { meta: {
      requestId: 'w1-composed-create-project', expected: [{ ref: project.ref, revision: 0 }] },
      input: { projectId } });
    expect(createdProject).toMatchObject({ status: 'committed', replayed: false, value: project });
    const registered = await first.projects.registerWorkspace(ctx, { meta: {
      requestId: 'w1-composed-register-workspace', expected: [
        { ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 0 }] },
      input: { workspace: scope } });
    expect(registered).toMatchObject({ status: 'committed', replayed: false, value: workspace });
    const installed = await first.completionPolicies.installCompletionPolicy(ctx, { meta: {
      requestId: 'w1-composed-install-policy', expected: [
        { ref: project.ref, revision: 1 }, { ref: policyRef, revision: 0 }] },
      input: { policyId: policyRef.policyId, contentRevision: policyRef.revision, content: policyContent } });
    expect(installed).toMatchObject({ status: 'committed', replayed: false });
    if (installed.status !== 'committed') throw new Error('public CompletionPolicy install failed');
    expect(await first.completionPolicies.activateCompletionPolicy(ctx, { meta: {
      requestId: 'w1-composed-activate-policy', expected: [
        { ref: project.ref, revision: 1 },
        { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId }, revision: 0 }] },
      input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } }))
      .toMatchObject({ status: 'committed', replayed: false });
    expect(await first.architecture.adoptInitialArchitecture(ctx, { meta: {
      requestId: 'w1-composed-adopt-architecture', expected: [
        { ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { baselineId: architectureRef.baselineId, description: architectureContent.description,
        constraints: architectureContent.constraints,
        catalog: { requireDag: true, dependencies: [], modules: [] } } }))
      .toMatchObject({ status: 'committed', replayed: false });

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
  } finally { await first.close(); }

  // The later accepted Plan and the `refine` Run are produced by the same
  // public owners on a reopened SQLite platform: plan revision 2 is pinned by
  // the Goal, and a real claim writes the Run (status `starting`) that projects
  // `refine` as running while `polish` stays truly unexecuted for the W1 edit.
  // Goal writes: createGoal revision 1, initial apply revision 2, later apply
  // revision 3.
  // The ref the later Plan's own draft names (planId 'w1-composed-later').
  const plan2Ref: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId, planId: 'w1-composed-later' };
  const writer = await createTargetPlatform(options);
  try {
    const plan2Proposal = await writer.plans.proposePlan(ctx, { meta: {
      requestId: 'w1-composed-plan2-propose', expected: [] },
      input: { goalRef, basedOn: plan1.ref,
        draft: { ...composedDraft, planId: 'w1-composed-later', planRevision: 2 },
        reason: { text: 'Later composed plan pinned by the Goal', sources: [] } } });
    expect(plan2Proposal).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });
    if (plan2Proposal.status !== 'committed') throw new Error('later Plan proposal failed');
    const plan2Applied = await writer.plans.applyPlanChange(ctx, { meta: {
      requestId: 'w1-composed-plan2-apply', expected: [] },
      input: { proposalRef: plan2Proposal.value.ref,
        expectedProposalRevision: plan2Proposal.value.revision, decisionRefs: [] } });
    expect(plan2Applied).toMatchObject({ status: 'committed', replayed: false });
    if (plan2Applied.status !== 'committed') throw new Error('later Plan adoption failed');
    expect(plan2Applied.value.ref).toEqual(plan2Ref);
    expect(await writer.plans.queryGoal(ctx, goalRef)).toMatchObject({ status: 'ready',
      value: { goal: { activePlanRevision: plan2Ref, revision: 3 } } });

    const sessionRequest: CreateSessionRequest = { workspace: scope,
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      recommendedRefs: [], initialLinks: [],
      meta: { requestId: 'w1-composed-refine-session', expected: [] } };
    const createdSession = await writer.runtime.createSession(ctx, sessionRequest);
    expect(createdSession).toMatchObject({ status: 'completed', replayed: false });
    if (createdSession.status !== 'completed') throw new Error('refine Session creation failed');
    const claimed = await writer.claims.claimTask(ctx, { meta: {
      requestId: 'w1-composed-refine-claim', expected: [
        { ref: { aggregateType: 'Goal', projectId, goalId: goalRef.goalId }, revision: 3 },
        { ref: workspace.ref, revision: 1 },
        { ref: createdSession.value.ref, revision: createdSession.value.revision },
      ] }, input: { goalRef, planRef: plan2Ref, taskId: 'refine',
      sessionRef: { projectId, sessionId: createdSession.value.ref.sessionId },
      roleBinding: { schemaVersion: 1, bindingId: 'w1-composed-binding', templateId: 'builder',
        templateRevision: '1', bindingVersion: 1, policyRevision: 'host-1' },
      budget: { tokenBudget: 1000, deadline: null } } });
    expect(claimed).toMatchObject({ status: 'committed', replayed: false,
      value: { task: { taskId: 'refine' } } });
    if (claimed.status !== 'committed') throw new Error('refine Run claim failed');
  } finally { await writer.close(); }

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
      f.makeService(f.records);
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
      const claimPromise = f.makeService(withBackendOrderedLookup(wrapped, f.records)).claimTask(f.ctx, request).finally(resolveClaimSettled);
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
