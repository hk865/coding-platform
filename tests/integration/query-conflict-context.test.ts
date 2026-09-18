import { expect, it } from 'vitest';
import { architectureServiceScenario } from '../app/architecture-review-service-fixture.js';
import type { ModelClientPort, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { ArchitectureReviewView } from '../../src/contracts/architecture-review.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { StateLedger } from '../../src/contracts/ledger.js';
import { selectQueryCollaborationFacts } from '../../src/data/context-compiler/query-collaboration-facts.js';
import { QuerySourceContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';

it('public Query carries the recorded conflict reason and attributed impact into the actual model request', async () => {
  const requests: ModelRequest[] = [];
  const queryClient: ModelClientPort = { async *stream(request) {
    requests.push(structuredClone(request));
    const common = { schemaVersion: 1 as const, requestId: request.requestId };
    yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'explanation', text: 'Labelled protocol stub: no semantic quality verdict.', basis: [] }] }) };
    yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
  } };
  await architectureServiceScenario('accept', { queryClient, afterRestart: async context => {
    const view = (await context.post('/api/real/architecture-reviews/view', context.scope)).body as ArchitectureReviewView;
    const row = view.rows[0]!;
    expect(row.review.status).toBe('accepted');
    expect(row.reportSummary).not.toBe(row.review.summary);
    expect(await context.post('/api/real/queries', { ...context.scope, requestId: 'original-conflict', focusTaskId: 'reader-a', responsePurpose: 'architecture',
      question: '这次架构冲突原始上报的理由是什么？正式列出的受影响模块、接口与计划有哪些？请依据当前记录回答，缺少材料请明确说明。' })).toMatchObject({ status: 200 });
    let observed: any;
    await expect.poll(async () => {
      observed = (await context.post('/api/real/queries/runs', context.scope)).body.runs.find((r: any) => r.runRef.runId === 'real-query-original-conflict');
      return observed?.status;
    }).toBe('completed');
    expect(requests).toHaveLength(1);
    const actual = requests[0]!.messages.find(message => message.role === 'user' && message.content.includes('"semantic_query"'));
    if (!actual || actual.role !== 'user') throw Error('Actual Query input missing');
    const input = JSON.parse(actual.content);
    expect(input.material.architectureReviews.rows[0]).toMatchObject({
      ref: row.review.ref, revision: row.review.revision, status: 'accepted',
      conflict: { reportSummary: row.reportSummary, impact: row.brief.impact, briefRef: row.review.briefRef,
        planRef: row.brief.planRef, baselinePin: row.brief.baselinePin, matchesCurrentPlan: true },
    });
    expect(input.material.architectureReviews.rows[0].conflict).not.toHaveProperty('options');
    expect(input.material.architectureReviews.rows[0].conflict).not.toHaveProperty('body');
    expect(JSON.stringify(requests[0]!.messages)).toContain(row.reportSummary);
    expect(JSON.parse(observed.input).material.dynamicFactSet).toEqual(input.material.dynamicFactSet);
    // Reuse actual public records to exercise the isolated fact-selection seam.
    // Empty work selection below keeps this check about architecture provenance.
    await checkConflictCurrentness(context.scope, input.material.acceptedPlan, view);
  } });
}, 60000);

async function checkConflictCurrentness(scope: { projectId: string; workspaceId: string; goalId: string }, acceptedPlan: PlanRevisionSnapshot, original: ArchitectureReviewView) {
  const plan = { ...acceptedPlan, tasks: [] }, goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: scope.goalId };
  let view = structuredClone(original);
  const ledger: Pick<StateLedger, 'load'> = { load: async ref => {
    if (ref.aggregateType === 'Goal') return { status: 'found', snapshot: { ref: goalRef, revision: 9, workspaceRef: { workspaceId: scope.workspaceId }, activePlanRevision: plan.ref } as never };
    if (ref.aggregateType === 'Workspace') return { status: 'found', snapshot: { ref, revision: 1 } as never };
    if (ref.aggregateType === 'PlanRevision') return { status: 'found', snapshot: plan };
    const row = view.rows.find(row => row.review.ref.reviewId === (ref as { reviewId?: string }).reviewId);
    return row ? { status: 'found', snapshot: row.review } : { status: 'not_found', ref };
  } };
  const deps = { ledger, architectureReviews: async () => view };
  const facts = await selectQueryCollaborationFacts(deps, scope, plan);
  const runRef = { aggregateType: 'QueryRun' as const, ...scope, queryJobId: 'conflict-freshness', runId: 'query' };
  const input = JSON.stringify({ material: { goalContext: { ref: goalRef, revision: 9, workspaceRevision: 1 }, ...facts } });
  const sources = new QuerySourceContextCompiler({ ledger: () => ledger, architectureReviews: deps.architectureReviews,
    observations: { all: () => [{ runRef, status: 'completed', input, sourceAfter: 'same-source' }] }, source: { sourceRevision: async () => 'same-source' } });
  const current = async () => (await sources.currentness(scope.projectId, scope.workspaceId)).get(runRef.queryJobId);
  expect(await current()).toBe(true);
  view.rows[0]!.reportSummary += ' A newly selected original reason.';
  expect(await current()).toBe(false);
  view = structuredClone(original); view.rows[0]!.brief.impact.affectedInterfaces.push('Additional.contract');
  expect(await current()).toBe(false);
  view = structuredClone(original); view.rows[0]!.brief.workspaceId = 'foreign-workspace';
  await expect(selectQueryCollaborationFacts(deps, scope, plan)).rejects.toThrow();
  view = structuredClone(original); view.rows[0]!.brief.briefId = 'forged-brief';
  await expect(selectQueryCollaborationFacts(deps, scope, plan)).rejects.toThrow();
  view = structuredClone(original); view.rows[0]!.review.proposalRef.projectId = 'foreign-project';
  await expect(selectQueryCollaborationFacts(deps, scope, plan)).rejects.toThrow();
  view = structuredClone(original); view.rows[0]!.proposal.planRef = { ...plan.ref, planId: 'unrelated-plan' };
  await expect(selectQueryCollaborationFacts(deps, scope, plan)).rejects.toThrow();
  view = structuredClone(original); view.rows[0]!.brief.planRef = { ...plan.ref, planId: 'previous-plan' };
  view.rows[0]!.proposal.planRef = { ...view.rows[0]!.brief.planRef };
  const historical = await selectQueryCollaborationFacts(deps, scope, plan);
  expect(historical.architectureReviews.status).toBe('ready');
  if (historical.architectureReviews.status !== 'ready') throw Error('Historical decision unavailable');
  expect(historical.architectureReviews.rows[0]).toMatchObject({ conflict: { matchesCurrentPlan: false, planRef: { planId: 'previous-plan' } } });
  view = structuredClone(original); view.rows[0]!.review.reporterRunRef.goalId = 'another-goal';
  expect((await selectQueryCollaborationFacts(deps, scope, plan)).architectureReviews).toMatchObject({ status: 'ready', rows: [] });
}
