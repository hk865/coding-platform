import { expect, it } from 'vitest';
import { join } from 'node:path';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryJobIntentV1, QueryRunRef } from '../../src/contracts/query-job.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import type { RoleBindingFactsPort } from '../../src/core/work-graph/model/configuration-contracts.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createTaskClaimFixture } from '../helpers/task-claim-fixture.js';

const at = '2026-09-24T00:00:00.000Z';
const actor = { kind: 'human' as const, id: 'trusted-reviewer' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'binding', templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
  maxRequests: 1, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };

const ctxFor = (projectId: string, workspaceId: string): CoreCallContext => ({ projectId, workspaceId,
  principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal });

const queryCtx = (reader: QueryRunRef): CoreCallContext => ({ projectId: reader.projectId, workspaceId: reader.workspaceId,
  principal: { kind: 'query_run', queryRunRef: reader, initiator: actor },
  materialReader: { kind: 'run', requester: reader }, signal: new AbortController().signal });
const workCtx = (reader: RunRef, workspaceId: string): CoreCallContext => ({ projectId: reader.projectId, workspaceId,
  principal: { kind: 'work_run', runRef: reader, roleBinding },
  materialReader: { kind: 'run', requester: reader }, signal: new AbortController().signal });

// Material grants were deleted (decision 34): no recorded grant can share a
// Run's material, so a Run or QueryRun reader opens only its own, never for current use.
it.each(['memory', 'sqlite'] as const)('%s: a Run or QueryRun reader opens only its own material, and not for current use', async kind => {
  const f = await createTaskClaimFixture(kind, QUERY_JOB_RECORD_SCHEMAS, { clock: () => at });
  try {
    // ---- two Workspaces and their Goals through the public owners ----------
    const projectId = f.projectRef.projectId, projectRef = f.projectRef;
    const sourceWorkspace = f.workspaceRef.workspaceId;
    const sourceGoal = f.goalRef, sourcePlan = f.planRef;
    const sourceWorkspaceRef = f.workspaceRef;
    const targetWorkspaceId = 'workspace-target';
    const targetWorkspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId, workspaceId: targetWorkspaceId };
    const targetGoalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'goal-target' };
    const targetPlanRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId, planId: 'plan-target' };
    const targetCtx = ctxFor(projectId, targetWorkspaceId);

    let eventSeq = 0;
    const eventId = () => `r3b-event-${++eventSeq}`;
    const bootstrap = createProjectBootstrapServices({ records: f.records, now: () => at, eventId });
    const registration = await bootstrap.projects.registerWorkspace(targetCtx, {
      input: { workspace: { projectId, workspaceId: targetWorkspaceId } },
      meta: { requestId: 'r3b-register-target', expected: [
        { ref: projectRef, revision: 1 }, { ref: targetWorkspaceRef, revision: 0 }] },
    });
    if (registration.status !== 'committed') throw new Error(`target Workspace registration failed: ${JSON.stringify(registration)}`);
    const targetGoal = await f.goals.createGoal(targetCtx, {
      input: { goalId: targetGoalRef.goalId, workspace: { projectId, workspaceId: targetWorkspaceId },
        objective: 'Preserve material scope' },
      meta: { requestId: 'r3b-target-goal', expected: [
        { ref: projectRef, revision: 1 }, { ref: targetWorkspaceRef, revision: 1 }] },
    });
    if (targetGoal.status !== 'committed') throw new Error(`target Goal creation failed: ${JSON.stringify(targetGoal)}`);

    // A claimable Plan in the target Workspace; the owner Plan came from the
    // fixture's own public bootstrap (governance install/activate and the
    // initial architecture are public steps inside the shared fixture).
    const targetDraft: PlanRevisionDraft = { schemaVersion: 2, planId: targetPlanRef.planId, planRevision: 1,
      goalId: targetGoalRef.goalId, stages: [{ stageId: 's1', title: 'Stage one' }],
      tasks: [
        { taskId: 'implement-a', stageId: 's1', title: 'Implement A', requirementLevel: 'required', taskKind: 'work',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
        { taskId: 'gate-goal', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ],
      assignments: [{ taskId: 'implement-a', role: 'builder', instruction: 'Implement A' }],
      obligations: [{ obligationId: 'obligation-target', title: 'Deliver implementation', requirementLevel: 'required',
        taskIds: ['implement-a', 'gate-goal'],
        verificationRequirements: [{ requirementId: 'check-target', requirementLevel: 'required', kind: 'test',
          description: 'Tests pass' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
    const targetProposal = await f.plans.proposePlan(targetCtx, {
      input: { goalRef: targetGoalRef, basedOn: null, draft: targetDraft,
        reason: { text: 'Target Workspace plan', sources: [] } },
      meta: { requestId: 'r3b-target-propose', expected: [{ ref: targetGoalRef, revision: 1 }] },
    });
    if (targetProposal.status !== 'committed' || targetProposal.value.issues.length > 0) {
      throw new Error(`target Plan proposal failed: ${JSON.stringify(targetProposal)}`);
    }
    const targetApplied = await f.plans.applyPlanChange(targetCtx, {
      input: { proposalRef: targetProposal.value.ref, expectedProposalRevision: targetProposal.value.revision,
        decisionRefs: [] },
      meta: { requestId: 'r3b-target-apply', expected: [{ ref: targetGoalRef, revision: 1 }] },
    });
    if (targetApplied.status !== 'committed') throw new Error(`target Plan adoption failed: ${JSON.stringify(targetApplied)}`);

    // ---- real Sessions through the Runtime, then real claims --------------
    const kernelStores = await createKernelStoreRegistry({ entries: [
      { adapterId: 'r3b-source-kernel', storeKey: 'r3b-source-kernel', workspace: sourceWorkspaceRef,
        databasePath: join(f.directory, 'r3b-source-kernel.sqlite') },
      { adapterId: 'r3b-target-kernel', storeKey: 'r3b-target-kernel', workspace: targetWorkspaceRef,
        databasePath: join(f.directory, 'r3b-target-kernel.sqlite') },
    ] });
    const sessionOperations = createSessionOperations({ sessions: f.sessionsPort, kernelStores });
    async function createSession(ctx: CoreCallContext, workspace: WorkspaceRef,
      requestId: string): Promise<{ sessionRef: { projectId: string; sessionId: string }; revision: number }> {
      const created = await sessionOperations.createSession(ctx, { workspace,
        role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
        recommendedRefs: [], initialLinks: [], meta: { requestId, expected: [] } });
      if (created.status !== 'completed') throw new Error(`Session creation failed: ${JSON.stringify(created)}`);
      const ref = created.value.ref;
      return { sessionRef: { projectId: ref.projectId, sessionId: ref.sessionId }, revision: created.value.revision };
    }
    const sourceSession = await createSession(ctxFor(projectId, sourceWorkspace), sourceWorkspaceRef, 'r3b-source-session');
    const targetSession = await createSession(targetCtx, targetWorkspaceRef, 'r3b-target-session');

    const ids: string[] = [];
    const newId = () => {
      const value = ids.shift();
      if (value === undefined) throw new Error('the claim produced more ids than the test queued');
      return value;
    };
    const claims = createTaskClaimService({ records: f.records, roles: f.roleService as unknown as RoleBindingFactsPort, now: () => at, newId });
    async function claim(input: { ctx: CoreCallContext; goalRef: GoalRef; planRef: PlanRevisionRef;
      workspaceRef: WorkspaceRef; session: { sessionRef: { projectId: string; sessionId: string }; revision: number };
      runId: string; label: string }): Promise<RunRef> {
      ids.push(input.runId, `${input.label}-attempt`, `${input.label}-event`);
      const claimed = await claims.claimTask(input.ctx, {
        input: { goalRef: input.goalRef, planRef: input.planRef, taskId: 'implement-a',
          sessionRef: input.session.sessionRef, roleBinding, budget: { tokenBudget: 100000, deadline: null } },
        meta: { requestId: `r3b-claim-${input.label}`, expected: [
          { ref: input.goalRef, revision: 2 },
          { ref: input.workspaceRef, revision: 1 },
          { ref: { aggregateType: 'Session', projectId: input.session.sessionRef.projectId,
            sessionId: input.session.sessionRef.sessionId }, revision: input.session.revision },
        ] },
      });
      if (claimed.status !== 'committed') throw new Error(`Task claim failed: ${JSON.stringify(claimed)}`);
      return claimed.value.runRef;
    }
    const owner = await claim({ ctx: ctxFor(projectId, sourceWorkspace), goalRef: sourceGoal, planRef: sourcePlan,
      workspaceRef: sourceWorkspaceRef, session: sourceSession, runId: 'source-run', label: 'source' });
    const otherRun = await claim({ ctx: targetCtx, goalRef: targetGoalRef, planRef: targetPlanRef,
      workspaceRef: targetWorkspaceRef, session: targetSession, runId: 'reader-run', label: 'target' });

    // ---- the artifact body is stored through the real owner Run context ---
    const bodies = new RawArtifactBodyStore();
    const reads = createMaterialRecordReaders(f.records);
    const materials = createMaterialService({ bodies, authority: reads.authority, now: () => at });
    const stored = await materials.storeArtifact(workCtx(owner, sourceWorkspace), {
      contentType: 'text/plain', body: 'historical source material',
      sources: [{ kind: 'workspace', refId: sourceWorkspace, revision: '1' }],
      origin: { kind: 'execution', ref: owner },
    });
    if (stored.status !== 'stored') throw new Error(`material store failed: ${JSON.stringify(stored)}`);
    const ref = stored.ref;

    // ---- the QueryRun comes from the public submit ------------------------
    const queryJobId = 'query-1', queryRunId = 'query-run';
    const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId: targetWorkspaceId,
      queryJobId, runId: queryRunId };
    const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: queryJobId, projectId,
      workspaceId: targetWorkspaceId, goalId: targetGoalRef.goalId,
      question: 'Explain the material scope', focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null },
      multiTurn: { maxRounds: 1 }, correlationId: 'r3b-query',
      execution: { kind: 'semantic_query', roleBinding, runtimeBudget } };
    const queries = createQueryJobService({ records: f.records, now: () => at, eventId });
    const submitted = await queries.submitQueryJob(targetCtx, {
      input: { queryJobId, runId: queryRunId, intent },
      meta: { requestId: 'r3b-query-submit', expected: [
        { ref: projectRef, revision: 1 },
        { ref: targetWorkspaceRef, revision: 1 },
        { ref: targetGoalRef, revision: 2 },
        { ref: { aggregateType: 'QueryJob', projectId, workspaceId: targetWorkspaceId, queryJobId }, revision: 0 },
        { ref: queryRunRef, revision: 0 },
      ] },
    });
    if (submitted.status !== 'committed') throw new Error(`Query submit failed: ${JSON.stringify(submitted)}`);

    const historical = { ref, usage: 'historical_explanation' as const };
    expect(await materials.openArtifact(workCtx(owner, sourceWorkspace), historical))
      .toMatchObject({ status: 'ready', value: { body: 'historical source material', applicability: 'historical_explanation' } });
    expect(await materials.openArtifact(workCtx(owner, sourceWorkspace), { ref, usage: 'current' }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await materials.openArtifact(queryCtx(queryRunRef), historical)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await materials.openArtifact(workCtx(otherRun, targetWorkspaceId), historical))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  } finally { await f.close(); }
});
