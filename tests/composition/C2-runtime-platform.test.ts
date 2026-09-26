/**
 * C2 production-composition consumers (Stage 1 skeleton).
 *
 * Every fact here comes from the formal producers in the shared C2 fixture
 * (real SQLite ledger, real Goal/Plan/Session/claim services, real Kernel
 * Session). The cases require the production `createTargetPlatform` to feed the
 * Runtime with the M2 material-facts and W2 delegated-writes seams. Those seams
 * are not wired yet, so the target assertions are RED at exactly those points.
 */
import { afterEach, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { createC2RuntimePlatform, type C2RuntimePlatformFixture } from '../helpers/C2-runtime-platform-fixture.js';

const fixtures: C2RuntimePlatformFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
const signal = () => new AbortController().signal;

function workRunContext(fx: C2RuntimePlatformFixture, runRef = fx.claim.runRef): CoreCallContext {
  return { projectId: fx.scope.projectId, workspaceId: fx.scope.workspaceId,
    principal: { kind: 'work_run', runRef, roleBinding: fx.fixture.roleBinding },
    materialReader: { kind: 'run', requester: runRef }, signal: signal() };
}

async function goalPin(fx: C2RuntimePlatformFixture) {
  const read = await fx.platform.plans.queryGoal(fx.ctx, fx.fixture.goalRef);
  expect(read.status, JSON.stringify(read)).toBe('ready');
  if (read.status !== 'ready') throw Error('C2 goal unavailable');
  return { ref: fx.fixture.goalRef, revision: read.value.goal.revision };
}

function toolJson(request: ModelRequest | undefined, callId: string): unknown {
  const message = request?.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  if (message === undefined || message.role !== 'tool' || message.result.status !== 'success') return undefined;
  const block = message.result.output.find(candidate => candidate.kind === 'json');
  return block?.kind === 'json' ? block.value : undefined;
}
function callArgs(reply: ScriptedReply | undefined): Record<string, unknown> | undefined {
  return reply !== undefined && reply.kind === 'calls' ? reply.calls[0]?.args : undefined;
}

/**
 * Real producer -> storeArtifact -> W1 adopt -> consumer claim -> Host grant,
 * using only public platform ports (same flow as C1-M1, no raw store edits).
 */
async function grantMaterialToConsumer(fx: C2RuntimePlatformFixture) {
  const producerCtx = workRunContext(fx);
  const stored = await fx.platform.materials.storeArtifact(producerCtx, {
    body: 'C2 original producer material, retained exactly', contentType: 'text/plain',
    sources: [{ kind: 'workspace', refId: fx.scope.workspaceId, revision: '1' }],
    origin: { kind: 'execution', ref: fx.claim.runRef } });
  expect(stored.status, JSON.stringify(stored)).toBe('stored');
  if (stored.status !== 'stored') throw Error('C2 storeArtifact failed');
  const p = fx.fixture.plan;
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: 'c2-current-input', planRevision: p.planRevision + 1,
    goalId: fx.fixture.goalRef.goalId, stages: structuredClone(p.stages), tasks: structuredClone(p.tasks),
    assignments: structuredClone(p.assignments ?? []), obligations: structuredClone(p.obligations),
    taskHierarchy: structuredClone(p.taskHierarchy), executionDag: structuredClone(p.executionDag), taskRelations: [],
    inputRequirements: [{ requirementId: 'producer-note', consumerTaskId: 'implement-b', kind: 'artifact', artifactRef: stored.ref }] };
  const proposal = await fx.platform.plans.proposePlan(fx.ctx, {
    meta: { requestId: 'c2-material-proposal', expected: [await goalPin(fx)] },
    input: { goalRef: fx.fixture.goalRef, basedOn: fx.fixture.planRef, draft, reason: { text: 'Adopt the producer reference', sources: [] } } });
  expect(proposal.status, JSON.stringify(proposal)).toBe('committed');
  if (proposal.status !== 'committed') throw Error('C2 W1 proposal failed');
  const adopted = await fx.platform.plans.applyPlanChange(fx.ctx, {
    meta: { requestId: 'c2-material-adopt', expected: [await goalPin(fx)] },
    input: { proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, decisionRefs: [] } });
  expect(adopted.status, JSON.stringify(adopted)).toBe('committed');
  if (adopted.status !== 'committed') throw Error('C2 W1 adoption failed');
  const consumerSession = fx.secondSession;
  const sessionCard = await fx.platform.sessions.readSession(fx.ctx, consumerSession);
  expect(sessionCard.status, JSON.stringify(sessionCard)).toBe('ready');
  if (sessionCard.status !== 'ready') throw Error('C2 consumer Session unavailable');
  const consumer = await fx.platform.claims.claimTask(fx.ctx, {
    meta: { requestId: 'c2-material-consumer', expected: [await goalPin(fx), { ref: fx.fixture.workspaceRef, revision: 1 },
      { ref: sessionCard.value.record.ref, revision: sessionCard.value.record.revision }] },
    input: { goalRef: fx.fixture.goalRef, planRef: adopted.value.ref, taskId: 'implement-b', sessionRef: consumerSession,
      roleBinding: fx.fixture.roleBinding, budget: fx.fixture.budget } });
  expect(consumer.status, JSON.stringify(consumer)).toBe('committed');
  if (consumer.status !== 'committed') throw Error('C2 consumer claim failed');
  const granted = await fx.platform.materials.grantMaterialAccess(fx.ctx, {
    meta: { requestId: 'c2-material-grant', expected: [await goalPin(fx), { ref: fx.fixture.workspaceRef, revision: 1 }] },
    input: { goalRef: fx.fixture.goalRef, reader: consumer.value.runRef, materials: [stored.ref],
      sourceSet: { kind: 'workspace_paths', paths: ['c2-read.txt'] }, purpose: 'Read the producer note for the adopted task' } });
  expect(granted.status, JSON.stringify(granted)).toBe('committed');
  if (granted.status !== 'committed') throw Error('C2 material grant failed');
  return { stored, adopted, consumer: consumer.value, granted: granted.value, consumerSession };
}

it('W2 delegated future-plan writes run through the real entered Runtime model round (RED)', async () => {
  let proposalRef: unknown;
  let proposalRevision: unknown;
  let basePlanRef: unknown;
  let basePlanRevision: unknown;
  const replies: ScriptedReply[] = [
    { kind: 'calls', calls: [{ callId: 'c2-graph-1', name: 'query_task_graph', args: {} }] },
    { kind: 'calls', calls: [{ callId: 'c2-propose-1', name: 'propose_future_plan',
      args: { basedOn: {}, draft: {}, reason: {}, expected: [] } }] },
    { kind: 'calls', calls: [{ callId: 'c2-apply-1', name: 'apply_future_plan',
      args: { proposalRef: {}, expectedProposalRevision: 1, expected: [] } }] },
    { kind: 'calls', calls: [{ callId: 'c2-graph-2', name: 'query_task_graph', args: {} }] },
    { kind: 'text', text: 'C2 adopted the refined future plan' },
  ];
  const fx = await createC2RuntimePlatform({ toolNames: ['query_task_graph', 'propose_future_plan', 'apply_future_plan'],
    scriptedReplies: replies,
    beforeReply: async (request, index) => {
      if (index === 1) {
        const graph = toolJson(request, 'c2-graph-1') as { status: string; value: { plan: PlanRevisionSnapshot } } | undefined;
        expect(graph).toMatchObject({ status: 'ready', value: { plan: { ref: { aggregateType: 'PlanRevision' } } } });
        if (graph === undefined || graph.status !== 'ready') throw Error('C2 model did not receive the ready task graph');
        const base = graph.value.plan;
        basePlanRef = base.ref; basePlanRevision = base.revision;
        const draft = { schemaVersion: 2, planId: 'c2-future-plan', planRevision: base.planRevision + 1,
          goalId: base.goalRef.goalId, stages: structuredClone(base.stages), tasks: structuredClone(base.tasks),
          assignments: structuredClone(base.assignments ?? []).map(assignment =>
            assignment.taskId === 'implement-b' ? { ...assignment, instruction: 'C2 refined future instruction for implement-b' } : assignment),
          obligations: structuredClone(base.obligations), taskHierarchy: structuredClone(base.taskHierarchy),
          executionDag: structuredClone(base.executionDag),
          taskRelations: structuredClone((base as unknown as { taskRelations?: unknown[] }).taskRelations ?? []),
          inputRequirements: structuredClone((base as unknown as { inputRequirements?: unknown[] }).inputRequirements ?? []) };
        const args = callArgs(replies[1]);
        if (args !== undefined) {
          args['basedOn'] = structuredClone(base.ref);
          args['draft'] = draft;
          args['reason'] = { text: 'Refine the unclaimed future task only', sources: [] };
          args['expected'] = [{ ref: base.ref, revision: base.revision }];
        }
      }
      if (index === 2) {
        const write = toolJson(request, 'c2-propose-1') as { status: string; value?: { ref: unknown; revision: unknown } } | undefined;
        expect(write).toMatchObject({ status: 'committed', value: { ref: { aggregateType: 'PlanProposal' } } });
        proposalRef = write?.value?.ref; proposalRevision = write?.value?.revision;
        const args = callArgs(replies[2]);
        if (args !== undefined) {
          args['proposalRef'] = structuredClone(proposalRef);
          args['expectedProposalRevision'] = proposalRevision;
          args['expected'] = [{ ref: basePlanRef, revision: basePlanRevision }];
        }
      }
    } });
  fixtures.push(fx);
  const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'c2-prepare-w2' });
  expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
  if (prepared.status !== 'ready') return;
  const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-w2' });
  // Phase-2 target: a real entered Run performs the four-tool whiteboard round.
  expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready', value: { run: { status: 'ended' }, session: { occupancy: null } } });
  expect(fx.scripted.calls()).toBe(5);
  // The same production Plan instance now exposes the adopted future revision.
  const graph = await fx.platform.plans.queryTaskGraph(fx.ctx, { goalRef: fx.fixture.goalRef });
  expect(graph.status, JSON.stringify(graph)).toBe('ready');
  if (graph.status !== 'ready') return;
  const goal = await fx.platform.plans.queryGoal(fx.ctx, fx.fixture.goalRef);
  expect(goal).toMatchObject({ status: 'ready' });
  if (goal.status === 'ready') {
    expect(goal.value.goal.activePlanRevision).toMatchObject({ aggregateType: 'PlanRevision', planId: 'c2-future-plan' });
  }
  const refined = graph.value.plan.assignments?.find(assignment => assignment.taskId === 'implement-b');
  expect(refined?.instruction).toBe('C2 refined future instruction for implement-b');
  expect(graph.value.plan.planRevision).toBe(fx.fixture.plan.planRevision + 1);
  expect(graph.value.plan.revision).toBe(1);
  // The adopted proposal keeps the real work_run provenance.
  const proposal = await fx.platform.plans.readPlanProposal(fx.ctx, proposalRef as Parameters<typeof fx.platform.plans.readPlanProposal>[1]);
  expect(proposal).toMatchObject({ status: 'ready', value: { submittedBy: { runRef: fx.claim.runRef } } });
  // The current executing Task is unchanged.
  const currentInstruction = graph.value.plan.assignments?.find(assignment => assignment.taskId === 'implement-a')?.instruction;
  expect(currentInstruction).toBe('Implement A');
});

it('material selected by the accepted Plan reaches the real model request and survives a post-terminal revoke (RED)', async () => {
  const fx = await createC2RuntimePlatform({ toolNames: ['read'], allowSourceRead: true,
    scriptedReplies: [{ kind: 'text', text: 'C2 consumed the selected material' }] });
  fixtures.push(fx);
  const { consumer, granted } = await grantMaterialToConsumer(fx);
  fx.allowRun(consumer.runRef);
  fx.setMaterialBasis(granted.grant.basis);
  const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: consumer.runRef, requestId: 'c2-prepare-material' });
  expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
  if (prepared.status !== 'ready') return;
  expect(prepared.value.envelope.permissions.tools).toContain('read');
  const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-material' });
  // Phase-2 target: the M2 material-facts seam is injected, the provider runs
  // once, and the real original body is in the request.
  expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready', value: { run: { status: 'ended' }, session: { occupancy: null } } });
  expect(fx.scripted.calls()).toBe(1);
  const userMessage = fx.scripted.requests[0]?.messages.find(message => message.role === 'user');
  expect(userMessage?.content).toContain('C2 original producer material, retained exactly');
  expect(await fx.platform.executions.readExecution(fx.ctx, consumer.runRef))
    .toMatchObject({ status: 'ready', value: { run: { status: 'ended' } } });
  // A terminal Run keeps its recorded fact: the original grant may be revoked
  // legally, but replay/observe must not start a second provider call.
  const revoke = await fx.platform.materials.revokeMaterialAccess(fx.ctx, {
    meta: { requestId: 'c2-material-revoke-after', expected: [{ ref: granted.ref, revision: granted.revision }] },
    input: { grantRef: granted.ref, reason: 'Host revokes the original grant after the Run reached its terminal state' } });
  expect(revoke).toMatchObject({ status: 'committed' });
  expect(await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-material' }))
    .toMatchObject({ status: 'ready', value: { run: { status: 'ended' } } });
  expect(await fx.platform.runtime.observeRun(fx.ctx, { runRef: consumer.runRef }))
    .toMatchObject({ status: 'ready', value: { run: { status: 'ended' } } });
  expect(fx.scripted.calls()).toBe(1);
});

it('a revoked material grant is denied at start with zero provider calls (RED)', async () => {
  const fx = await createC2RuntimePlatform({ toolNames: ['read'], allowSourceRead: true,
    scriptedReplies: [{ kind: 'text', text: 'C2 must never run' }] });
  fixtures.push(fx);
  const { consumer, granted } = await grantMaterialToConsumer(fx);
  fx.allowRun(consumer.runRef);
  fx.setMaterialBasis(granted.grant.basis);
  const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: consumer.runRef, requestId: 'c2-prepare-revoked' });
  expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
  if (prepared.status !== 'ready') return;
  const revoked = await fx.platform.materials.revokeMaterialAccess(fx.ctx, {
    meta: { requestId: 'c2-material-revoke', expected: [{ ref: granted.ref, revision: granted.revision }] },
    input: { grantRef: granted.ref, reason: 'Host withdraws this exact sharing grant before start' } });
  expect(revoked).toMatchObject({ status: 'committed' });
  const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-revoked' });
  // Phase-2 target: the fresh admission rejects the revoked grant.
  expect(started, JSON.stringify(started)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(fx.scripted.calls()).toBe(0);
});
