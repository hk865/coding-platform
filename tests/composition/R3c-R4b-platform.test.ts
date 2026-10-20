/** Target composition acceptance: one SQLite platform owns Goal, Plan and
 * Session facts while the Host-selected Kernel store survives a restart. */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { CreateSessionRequest } from '../../src/core/agent-runtime/session-operations.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'composed-project';
const workspaceId = 'composed-workspace';
const scope = { projectId, workspaceId };
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'composition-operator' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const policyContent = { schemaVersion: 1 as const, requirementKinds: ['test'],
  minimumRequiredRequirementsPerObligation: 1 };
const architectureContent = { schemaVersion: 1 as const, description: 'Composition baseline', constraints: [] };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId,
  policyId: 'composition-policy', revision: 1 };
const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId,
  baselineId: 'composition-baseline', revision: 1 };
// Independent content-digest expectations: JCS + SHA-256 over the full fixture
// `{schemaVersion, identity:{...}, revision, content}` (the documented policy and
// baseline digest algorithm), calculated by hand from the fixed content below.
// policy  body = {"schemaVersion":1,"identity":{"policyId":"composition-policy"},"revision":1,
//   "content":{"schemaVersion":1,"requirementKinds":["test"],"minimumRequiredRequirementsPerObligation":1}}
const policyContentDigest = '178436335242427d901d40cd14fb51ed9367555c26c146afc5de7344ef26c23b';
// baseline body = {"schemaVersion":1,"identity":{"baselineId":"composition-baseline"},"revision":1,
//   "content":{"schemaVersion":1,"description":"Composition baseline","constraints":[]}}
const architectureContentDigest = '7d13186f8b7e6e590f28a91ac52ef7a13b8f46490bcf3da80a755ad32658fbb1';

const draft: PlanRevisionDraft = { schemaVersion: 2, planId: 'composed-plan', planRevision: 1,
  goalId: 'goal-1', stages: [], tasks: [
    { taskId: 'implement', title: 'Implement', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
  ], assignments: [{ taskId: 'implement', role: 'builder', instruction: 'Implement the composed goal' }],
  obligations: [{ obligationId: 'composition-obligation', title: 'Deliver implementation',
    requirementLevel: 'required', taskIds: ['implement', 'goal-gate'],
    verificationRequirements: [{ requirementId: 'composition-check', requirementLevel: 'required',
      kind: 'test', description: 'Tests pass' }] }],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it('wires one durable Goal/Plan/Session graph and reopens the same Kernel Session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-composed-r3c-r4b-'));
  dirs.push(directory);

  const workspaceBindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === projectId && requested.workspaceId === workspaceId
        ? { status: 'ready', value: { root: directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
    },
    async authorize() { return { status: 'rejected', code: 'forbidden', reason: 'no source read grant' }; },
  };
  const options = { storage: { kind: 'sqlite' as const, directory }, workspace: workspaceBindings,
    now: () => at, kernelStores: { entries: [{ adapterId: 'composed-kernel',
      storeKey: 'composed-kernel-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] } };
  const request: CreateSessionRequest = { workspace: scope, role: { kind: 'legacy_template',
    templateId: 'builder', templateRevision: '1' }, recommendedRefs: [], initialLinks: [{
      target: { kind: 'task', ref: { projectId, goalId: 'goal-1', taskId: 'implement' } }, relation: 'responsible',
    }],
    meta: { requestId: 'create-session-once', expected: [] } };
  const first = await createTargetPlatform(options);
  let sessionRef: { projectId: string; sessionId: string };
  try {
    // Public bootstrap on the same SQLite platform: Project, Workspace, the
    // active CompletionPolicy and the initial ArchitectureBaseline. None of
    // these writers changes the Project/Workspace revision.
    const createdProject = await first.projects.createProject(ctx, { meta: {
      requestId: 'composed-create-project', expected: [{ ref: project.ref, revision: 0 }] },
      input: { projectId } });
    expect(createdProject).toMatchObject({ status: 'committed', replayed: false, value: project });
    const registered = await first.projects.registerWorkspace(ctx, { meta: {
      requestId: 'composed-register-workspace', expected: [
        { ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 0 }] },
      input: { workspace: scope } });
    expect(registered).toMatchObject({ status: 'committed', replayed: false, value: workspace });
    const installed = await first.completionPolicies.installCompletionPolicy(ctx, { meta: {
      requestId: 'composed-install-policy', expected: [
        { ref: project.ref, revision: 1 }, { ref: policyRef, revision: 0 }] },
      input: { policyId: policyRef.policyId, contentRevision: policyRef.revision, content: policyContent } });
    expect(installed).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: policyRef, revision: 1, contentDigest: policyContentDigest } });
    if (installed.status !== 'committed') throw Error('public CompletionPolicy install failed');
    const activated = await first.completionPolicies.activateCompletionPolicy(ctx, { meta: {
      requestId: 'composed-activate-policy', expected: [
        { ref: project.ref, revision: 1 },
        { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId }, revision: 0 }] },
      input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } });
    expect(activated).toMatchObject({ status: 'committed', replayed: false });
    const adoptedInitial = await first.architecture.adoptInitialArchitecture(ctx, { meta: {
      requestId: 'composed-adopt-architecture', expected: [
        { ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { baselineId: architectureRef.baselineId, description: architectureContent.description,
        constraints: architectureContent.constraints,
        catalog: { requireDag: true, dependencies: [], modules: [] } } });
    expect(adoptedInitial).toMatchObject({ status: 'committed', replayed: false,
      value: { baseline: { ref: architectureRef, contentDigest: architectureContentDigest } } });

    const goal = await first.goals.createGoal(ctx, { meta: { requestId: 'create-goal-once',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: 'goal-1', workspace: scope, objective: 'Use one composed graph' } });
    expect(goal).toMatchObject({ status: 'committed', replayed: false });
    if (goal.status !== 'committed') throw Error('Goal creation failed');
    expect(await first.plans.queryGoal(ctx, goal.value.ref)).toMatchObject({ status: 'ready',
      value: { goal: goal.value, pendingPlan: null } });
    const material = await first.materials.storeArtifact(ctx, {
      contentType: 'text/plain', body: 'Exact input for the composed task',
      sources: [{ kind: 'workspace', refId: workspaceId, revision: '1' }],
      origin: { kind: 'platform_operation', projectId, workspaceId, requestId: 'composed-input', actor },
    });
    if (material.status !== 'stored') throw Error('Composed material write failed');
    const withInput: PlanRevisionDraft = { ...draft, schemaVersion: 2,
      taskRelations: [{ fromTaskId: 'implement', toTaskId: 'goal-gate', kind: 'coordination', note: 'Share results' }],
      inputRequirements: [{ requirementId: 'input-1', consumerTaskId: 'implement', kind: 'artifact', artifactRef: material.ref }] };
    const proposed = await first.plans.proposePlan(ctx, { meta: { requestId: 'compose-propose-plan',
      expected: [{ ref: goal.value.ref, revision: 1 }] }, input: {
      goalRef: goal.value.ref, basedOn: null, draft: withInput,
      reason: { text: 'Initial composed plan', sources: [] },
    } });
    expect(proposed).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });
    if (proposed.status !== 'committed') throw Error('Plan proposal failed');
    const applied = await first.plans.applyPlanChange(ctx, { meta: { requestId: 'compose-apply-plan',
      expected: [{ ref: goal.value.ref, revision: 1 }] }, input: {
      proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
    } });
    expect(applied).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: { aggregateType: 'PlanRevision', projectId, planId: 'composed-plan' },
        effectiveCompletionPolicy: { ref: policyRef, digest: policyContentDigest },
        effectiveArchitectureBaseline: { ref: architectureRef, digest: architectureContentDigest } } });
    if (applied.status !== 'committed') throw Error('Initial Plan adoption failed');
    // This must reach the real material reader: missing injection is not success.
    expect(await first.materials.openArtifact(ctx, { ref: material.ref, usage: 'historical_explanation' }))
      .toMatchObject({ status: 'ready', value: { body: 'Exact input for the composed task' } });
    expect(await first.plans.queryTaskGraph(ctx, { goalRef: goal.value.ref,
      atLeastCursor: applied.cursor })).toMatchObject({ status: 'ready', value: {
      plan: applied.value, tasks: [{ ref: { taskId: 'implement' } }, { ref: { taskId: 'goal-gate' } }],
    } });
    expect(await first.plans.queryReadyTasks(ctx, { goalRef: goal.value.ref, includeBlocked: false,
      page: { limit: 10 } })).toMatchObject({ status: 'ready', value: { items: [
      { task: { ref: { taskId: 'implement' }, eligibility: { eligible: true } } },
    ] } });

    // A.2 step 5.2 (spec §7.7, D-15, LA-1): continuation, safe-point pause
    // and cancel are reported supported, each with its own boundary; step 5.7
    // adds the start-up reconciliation, never a fresh resume (D-17), with the
    // §7.7 boundaries LA-7, C4, LA-1 and LA-6 (§7.7 item 3). Slice K (lead decision D9): the continuation of
    // a Work line is in the same Session once its dangling Kernel Turn is closed, otherwise in a new Session.
    expect(await first.runtime.capabilities(ctx, scope)).toMatchObject({ status: 'ready', value: {
      createSession: { supported: true }, readHistory: { supported: true },
      continueHistory: { supported: true, reason: expect.stringContaining('a continuation is a new Run') },
      recoverRun: { supported: true, reason: expect.stringMatching(new RegExp([
        'start-up reconciliation only, never a fresh resume of the original Turn',
        'a queued cancel with a clean Kernel Turn ends the Run cancelled',
        'ends paused-interrupted, which is not a failure', 'only a person continues it',
        'new Run with a continuation brief: for a Work line, after the platform closes its dangling Kernel Turn as interrupted, in the same Session',
        'when that closure is not possible, in a new Session that continues the original Session',
        'follows the Host setting automation\\.resumeOnStartup \\(on by default\\)',
        'When that setting is off, the reconciliation still runs but no driver starts after it',
      ].join('[\\s\\S]*'))) },
      safePointPause: { supported: true, reason: expect.stringContaining('pauses through its live handle') },
      cancel: { supported: true, reason: expect.stringContaining('cancelled by the platform at once') },
      scopedWorkspaceWrites: { supported: false },
    } });
    // The composition wrapper must preserve the underlying port's synchronous
    // input snapshot, even though the operation spans asynchronous stores.
    const submitted = structuredClone(request);
    const pendingCreation = first.runtime.createSession(ctx, submitted);
    submitted.meta.requestId = 'changed-after-call';
    submitted.role = { kind: 'legacy_template', templateId: 'changed-after-call', templateRevision: '9' };
    const created = await pendingCreation;
    expect(created).toMatchObject({ status: 'completed', replayed: false,
      value: { kernel: { adapterId: 'composed-kernel' }, occupancy: null } });
    if (created.status !== 'completed') throw Error('Session creation failed');
    expect(created.value.role).toEqual(request.role);
    sessionRef = created.value.ref;
    const found = await first.sessions.findSessions(ctx, { workspace: scope, includeArchived: false,
      page: { limit: 10 } });
    expect(found).toMatchObject({ status: 'ready', value: { items: [
      { record: { ref: sessionRef }, links: [{ ref: { target: request.initialLinks[0]!.target,
        relation: 'responsible' }, since: created.cursor, until: null }] },
    ] } });
    const history = await first.runtime.readSessionHistory(ctx, { sessionRef, afterCursor: null,
      throughCursor: null, limit: 10 });
    expect(history).toMatchObject({ status: 'ready', value: { items: [
      { kind: 'session_created', source: { adapterId: 'composed-kernel', position: 1 } },
    ] } });
  } finally { await first.close(); }

  const reopened = await createTargetPlatform(options);
  try {
    expect(await reopened.plans.queryGoal(ctx, { aggregateType: 'Goal', projectId, goalId: 'goal-1' }))
      .toMatchObject({ status: 'ready', value: { goal: { objective: 'Use one composed graph',
        activePlanRevision: { aggregateType: 'PlanRevision', planId: 'composed-plan' }, revision: 2 } } });
    expect(await reopened.plans.queryTaskGraph(ctx, { goalRef: { aggregateType: 'Goal', projectId, goalId: 'goal-1' } }))
      .toMatchObject({ status: 'ready', value: { tasks: [
        { ref: { taskId: 'implement' }, inputRequirements: [{ verification: 'not_checked',
          requirement: { requirementId: 'input-1' } }] }, { ref: { taskId: 'goal-gate' } },
      ] } });
    expect(await reopened.plans.queryReadyTasks(ctx, { goalRef: { aggregateType: 'Goal', projectId, goalId: 'goal-1' },
      includeBlocked: false, page: { limit: 10 } })).toMatchObject({ status: 'ready', value: { items: [
      { task: { ref: { taskId: 'implement' }, eligibility: { eligible: true } } },
    ] } });
    const replay = await reopened.runtime.createSession(ctx, request);
    expect(replay).toMatchObject({ status: 'completed', replayed: true,
      value: { ref: sessionRef, kernel: { adapterId: 'composed-kernel' } } });
    const found = await reopened.sessions.findSessions(ctx, { workspace: scope, includeArchived: false,
      page: { limit: 10 } });
    expect(found).toMatchObject({ status: 'ready', value: { items: [
      { record: { ref: sessionRef }, links: [{ ref: { target: request.initialLinks[0]!.target,
        relation: 'responsible' }, until: null }] },
    ] } });
    if (found.status !== 'ready') throw Error('Session directory unavailable');
    expect(found.value.items).toHaveLength(1);
    expect(await reopened.runtime.readSessionHistory(ctx, { sessionRef, afterCursor: null,
      throughCursor: null, limit: 10 })).toMatchObject({ status: 'ready', value: { items: [
      { kind: 'session_created', source: { adapterId: 'composed-kernel', position: 1 } },
    ] } });
    // R4c.1 reuses this real Goal/Plan/Kernel-Session composition. Claim
    // ownership must not consume the source-stale future material or start Kernel.
    const record = found.value.items[0]!.record;
    const pendingClaim = reopened.claims.claimTask(ctx, { meta: {
      requestId: 'composed-first-claim', expected: [
        { ref: { aggregateType: 'Goal', projectId, goalId: 'goal-1' }, revision: 2 },
        { ref: workspace.ref, revision: 1 }, { ref: record.ref, revision: record.revision },
      ],
    }, input: { goalRef: { aggregateType: 'Goal', projectId, goalId: 'goal-1' },
      planRef: { aggregateType: 'PlanRevision', projectId, planId: 'composed-plan' },
      taskId: 'implement', sessionRef: { projectId, sessionId: record.ref.sessionId },
      roleBinding: { schemaVersion: 1, bindingId: 'composed-builder', templateId: 'builder',
        templateRevision: '1', bindingVersion: 1, policyRevision: 'host-1' },
      budget: { tokenBudget: 1000, deadline: null },
    } });
    const closing = reopened.close();
    const claimed = await pendingClaim;
    expect(claimed).toMatchObject({ status: 'committed', replayed: false,
      value: { task: { taskId: 'implement' }, generation: record.revision + 1 } });
    await closing;
    if (claimed.status !== 'committed') throw Error('Composed claim failed');
    expect(await reopened.executions.readExecution(ctx, claimed.value.runRef))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
    const third = await createTargetPlatform(options);
    try {
      const restored = await third.executions.readExecution(ctx, claimed.value.runRef);
      expect(restored.status).toBe('ready');
      if (restored.status !== 'ready') throw Error('the claimed execution must read back');
      expect(restored.value.outbox.claim).toEqual(claimed.value);
      expect(await third.sessions.readSession(ctx, sessionRef)).toMatchObject({ status: 'ready', value: { record: {
        occupancy: { kind: 'execution', executionRef: claimed.value.runRef, generation: claimed.value.generation },
      } } });
      expect(await third.plans.queryReadyTasks(ctx, { goalRef: { aggregateType: 'Goal', projectId, goalId: 'goal-1' },
        includeBlocked: false, page: { limit: 10 } })).toMatchObject({ status: 'ready', value: { items: [] } });
      expect(await third.runtime.readSessionHistory(ctx, { sessionRef, afterCursor: null,
        throughCursor: null, limit: 10 })).toMatchObject({ status: 'ready', value: { items: [
        { kind: 'session_created' },
      ] } });
      // Both new reads span asynchronous owners and must finish before close.
      const pendingExecution = third.executions.readExecution(ctx, claimed.value.runRef,
        { atLeastCursor: claimed.cursor });
      const historyRequest = { sessionRef, executionIdentity: { runId: 'not-started', turnId: 'not-started' },
        afterCursor: null, throughCursor: null, limit: 10 };
      const pendingHistory = third.runtime.readExecutionHistory(ctx, historyRequest);
      const closeReads = third.close();
      expect(await pendingExecution).toMatchObject({ status: 'ready', value: {
        run: { ref: claimed.value.runRef, status: 'starting' }, outbox: { claim: claimed.value },
        session: { ref: { aggregateType: 'Session', ...claimed.value.sessionRef } },
      } });
      expect(await pendingHistory).toMatchObject({ status: 'ready', value: {
        items: [], scannedCount: 1, nextCursor: null,
      } });
      await closeReads;
      expect(await third.executions.readExecution(ctx, claimed.value.runRef))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(await third.runtime.readExecutionHistory(ctx, historyRequest))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { await third.close(); }
  } finally { await reopened.close(); }
  expect(await reopened.plans.queryGoalDisplay(ctx, {
    goalRef: { aggregateType: 'Goal', projectId, goalId: 'goal-1' },
  })).toMatchObject({ status: 'rejected', code: 'unavailable' });
});
