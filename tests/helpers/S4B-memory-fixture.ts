/**
 * Slice 4B G3 support: a second real Goal with an accepted Plan and real
 * Sessions/Runs, built only through the public platform services. It wraps the
 * real `S4B` check fixture (which builds `S4ANoteFixture`); nothing here reads
 * the record store.
 *
 * What it builds and through which public calls:
 *  - a Goal through `platform.goals.createGoal` (guarded on the current
 *    Project/Workspace revisions from `platform.projects.readProject`);
 *  - an accepted Plan through `platform.plans.proposePlan`/`applyPlanChange`
 *    (the same v1-draft path `S4A-note-fixture.ts` uses);
 *  - real Sessions through `platform.sessions.admitSessionCreation` /
 *    `recordSessionCreated` and real Runs through `platform.claims.claimTask`.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { RunRef, RoleBindingRefV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import { S4A_AT } from './S4A-note-fixture.js';
import type { S4BNoteCheckFixture } from './S4B-note-check-fixture.js';

export type S4BExtraGoal = {
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  plan: PlanRevisionSnapshot;
  claimRun(suffix: string, taskId: string, role: 'executor' | 'scribe'): Promise<RunRef>;
  workCtx(runRef: RunRef, role: 'executor' | 'scribe'): CoreCallContext;
};

function roleRef(role: 'executor' | 'scribe'): RoleConfigurationRef {
  return { kind: 'legacy_template', templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor',
    templateRevision: 's3.1' };
}

function bindingFor(role: 'executor' | 'scribe', id: string): RoleBindingRefV1 {
  return { schemaVersion: 1, bindingId: `s4b-${id}-binding`,
    templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor', templateRevision: 's3.1',
    bindingVersion: 1, policyRevision: 'legacy-template' };
}

export async function createS4BExtraGoal(f: S4BNoteCheckFixture, goalId: string): Promise<S4BExtraGoal> {
  const platform = f.inner.platform;
  const ctx = f.ctx();
  const scope = f.inner.scope;
  const projectRef = f.inner.projectRef;
  const workspaceRef: WorkspaceRef = f.inner.workspaceRef;
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId };
  const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: scope.projectId,
    planId: `${goalId}-plan` };
  const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
  const committed = async (label: string, result: { status: string }): Promise<Record<string, unknown>> => {
    if (result.status !== 'committed') throw new Error(`S4B extra goal ${label} failed: ${JSON.stringify(result)}`);
    return (result as unknown as { value: Record<string, unknown> }).value;
  };
  const readProject = platform.projects.readProject;
  if (readProject === undefined) throw new Error('platform.projects.readProject is not published');
  const project = await readProject(ctx, scope.projectId);
  if (project.status !== 'ready') throw new Error(`project read failed: ${JSON.stringify(project)}`);

  await committed('goal', await platform.goals.createGoal(ctx, { meta: { requestId: `${goalId}-create`,
    expected: [{ ref: projectRef, revision: project.value.revision }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId, workspace: scope, objective: `${goalId} objective` } }));
  const draft: PlanRevisionDraft = { schemaVersion: 1, planId: planRef.planId, planRevision: 1, goalId,
    stages: [{ stageId: 's1', title: 'Stage one' }],
    tasks: [
      { taskId: 't1', stageId: 's1', title: 'Work one', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 't3', stageId: 's1', title: 'Scribe review', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'g1', title: 'Gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 't1', role: 'platform-executor', instruction: 'Work one' },
      { taskId: 't3', role: 'platform-scribe', instruction: 'Scribe review' }],
    obligations: [{ obligationId: 'o1', title: 'Deliver', requirementLevel: 'required', taskIds: ['t1', 't3', 'g1'],
      verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const proposed = await committed('plan-propose', await platform.plans.proposePlan(ctx, {
    meta: { requestId: `${goalId}-propose`, expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: `${goalId} plan`, sources: [] } } }));
  const applied = await committed('plan-apply', await platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `${goalId}-apply`, expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed['ref'] as never, expectedProposalRevision: proposed['revision'] as number,
      decisionRefs: [] } }));
  const plan = applied as unknown as PlanRevisionSnapshot;

  let sessionSeq = 0;
  const workCtx = (runRef: RunRef, role: 'executor' | 'scribe'): CoreCallContext =>
    ({ projectId: scope.projectId, workspaceId: scope.workspaceId,
      principal: { kind: 'work_run', runRef, roleBinding: bindingFor(role, runRef.runId) },
      materialReader: { kind: 'run', requester: runRef }, signal: new AbortController().signal });

  async function claimRun(suffix: string, taskId: string, role: 'executor' | 'scribe'): Promise<RunRef> {
    const admitted = await committed(`admit-${suffix}`, await platform.sessions.admitSessionCreation(ctx, {
      meta: { requestId: `${goalId}-admit-${suffix}`, expected: [] },
      input: { workspace: scope, kernelStore: { adapterId: 's4a-kernel', storeKey: 's4a-kernel-store' },
        role: roleRef(role), recommendedRefs: [], initialLinks: [] } }));
    const action = admitted['action'] as { plannedSessionRef: { projectId: string; sessionId: string } };
    const admittedRef = admitted['ref'] as { projectId: string; sessionId: string };
    const kernelSessionId = `${goalId}-kernel-session-${suffix}-${++sessionSeq}`;
    await platform.kernelStores.withStore('s4a-kernel', store => store.create({
      sessionId: kernelSessionId, recordId: `${goalId}-kernel-record-${suffix}`, createdAt: S4A_AT,
    }, { signal: ctx.signal }));
    const registered = await committed(`record-${suffix}`, await platform.sessions.recordSessionCreated(ctx, {
      meta: { requestId: `${goalId}-record-${suffix}`, expected: [] },
      input: { operationRef: admittedRef as never, sessionRef: action.plannedSessionRef, adapterId: 's4a-kernel',
        kernelSessionId, historyCursor: null, observedAt: S4A_AT } }));
    const sessionRef = registered['ref'] as { projectId: string; sessionId: string };
    const roleBinding = bindingFor(role, suffix);
    const goalRead = await platform.plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('S4B extra goal read failed');
    const card = await platform.sessions.readSession(ctx, sessionRef);
    if (card.status !== 'ready') throw new Error('S4B extra session read failed');
    const claimed = await committed(`claim-${suffix}`, await platform.claims.claimTask(ctx, {
      input: { goalRef, planRef, taskId, sessionRef, roleBinding, budget },
      meta: { requestId: `${goalId}-claim-${suffix}`, expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: workspaceRef, revision: 1 },
        { ref: { aggregateType: 'Session', projectId: scope.projectId, sessionId: sessionRef.sessionId },
          revision: card.value.record.revision },
      ] } }));
    return claimed['runRef'] as RunRef;
  }

  return { goalRef, planRef, plan, claimRun, workCtx };
}
