/**
 * C2 production-composition consumers (Stage 1 skeleton).
 *
 * Every fact here comes from the formal producers in the shared C2 fixture
 * (real SQLite ledger, real Goal/Plan/Session/claim services, real Kernel
 * Session). The case requires the production `createTargetPlatform` to feed the
 * Runtime with the W2 delegated-writes seam. That seam was not wired when the
 * case was written, so its target assertions were RED at exactly that point.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { createC2RuntimePlatform, type C2RuntimePlatformFixture } from '../helpers/C2-runtime-platform-fixture.js';

const fixtures: C2RuntimePlatformFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

function toolJson(request: ModelRequest | undefined, callId: string): unknown {
  const message = request?.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  if (message === undefined || message.role !== 'tool' || message.result.status !== 'success') return undefined;
  const block = message.result.output.find(candidate => candidate.kind === 'json');
  return block?.kind === 'json' ? block.value : undefined;
}
function callArgs(reply: ScriptedReply | undefined): Record<string, unknown> | undefined {
  return reply !== undefined && reply.kind === 'calls' ? reply.calls[0]?.args : undefined;
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
