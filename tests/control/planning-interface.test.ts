import { describe, expect, it } from 'vitest';
import type { PlanCompilerPort } from '../../src/contracts/planning.js';
import { PlanCompilerImpl } from '../../src/control/plan-compiler/plan-compiler.js';
import { CoordinationContextCompiler } from '../../src/data/context-compiler/coordination-context-compiler.js';
import { LedgerScopeCatalog } from '../../src/data/state-ledger/ledger-scope-catalog.js';
import { planningAt, planningScenario, planningScope } from './planning-fixture.js';

describe('PlanCompiler amendment and initial-coordination interfaces', () => {
  it.each([undefined, 'amendment'])('rejects initial requests with kind %s before writing or running', async kind => {
    const s = await planningScenario();
    const input: Record<string, unknown> = { ...s.request };
    if (kind === undefined) delete input['kind']; else input['kind'] = kind;
    const before = await s.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(await s.compiler.requestInitial(input as unknown as Parameters<PlanCompilerPort['requestInitial']>[0]))
      .toMatchObject({ status: 'rejected', code: 'invalid_request' });
    expect(await s.h.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
    expect(await s.catalog.jobs()).toEqual([]);
    expect(s.calls()).toBe(0);
  });

  it('preserves durable request identity, null budgets, exact acceptance and reconstructed discovery', async () => {
    const s = await planningScenario();
    expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted', submission: { queryJobId: 'real-query-initial-work', runId: 'real-work', receipt: { replayed: false } } });
    expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted', submission: { receipt: { replayed: true } } });
    expect(await s.compiler.requestInitial({ ...s.request, input: { ...s.request.input, instruction: 'Different request' } })).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    const [job] = await s.catalog.jobs();
    expect(job!.job.intent.execution!.runtimeBudget).toMatchObject({ inputTokens: null, outputTokens: null, timeoutMs: null, maxRequests: null, maxToolCalls: null });
    expect(job!.job.intent.budget.deadline).toBeNull();
    expect(await s.h.driveQuery({ reason: 'test-planning' })).toMatchObject({ started: 1, answered: 1 });
    const [material] = await s.materials.initialResults();
    const result = await s.compiler.accept({ reason: 'registered-answer', resultRef: material!.resultRef });
    expect(result).toMatchObject({ status: 'processed', issues: [], needsDecision: [] });
    if (result.status !== 'processed') throw Error('accept failed');
    expect(result.accepted).toHaveLength(1);
    const goal = await s.h.ledger.load({ aggregateType: 'Goal', projectId: planningScope.projectId, goalId: planningScope.goalId });
    expect(goal).toMatchObject({ status: 'found', snapshot: { activePlanRevision: result.accepted[0] } });
    s.stale();
    const materials = new CoordinationContextCompiler({ ledger: s.h.ledger, catalog: new LedgerScopeCatalog(s.h.ledger) });
    const reopened: PlanCompilerPort = new PlanCompilerImpl({ materials, control: s.h, now: () => planningAt });
    expect(await reopened.accept({ reason: 'reconstructed-consumer' })).toMatchObject({ status: 'processed', accepted: result.accepted, issues: [] });
    expect(await materials.acceptedInitialPlans()).toHaveLength(1);
    expect(await reopened.requestInitial(s.request)).toMatchObject({ status: 'accepted', submission: { receipt: { replayed: true } } });
    expect(s.calls()).toBe(1);
  });

  it.each([
    ['decision', JSON.stringify({ kind: 'needs_decision', summary: 'Product choice is missing.', questions: ['Choose the required public behavior.'] }), false],
    ['invalid', 'This is not a JSON proposal', false],
    ['stale', undefined, true]
  ] as const)('preserves %s results without admitting a plan', async (kind, body, stale) => {
    const s = await planningScenario(body);
    expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
    await s.h.driveQuery({ reason: 'planning-negative' });
    if (stale) s.stale();
    const report = await s.compiler.accept({ reason: 'answer' });
    expect(report).toMatchObject({ status: 'processed', accepted: [] });
    if (report.status !== 'processed') throw Error('unexpected report');
    if (kind === 'decision') { expect(report.needsDecision).toHaveLength(1); expect(report.issues).toEqual([]); }
    else { expect(report.issues).toHaveLength(1); expect((await s.catalog.jobs())[0]!.job.status).toBe('closed'); }
    expect(await s.materials.acceptedInitialPlans()).toEqual([]);
    expect(await s.h.ledger.load({ aggregateType: 'Goal', projectId: planningScope.projectId, goalId: planningScope.goalId })).toMatchObject({ status: 'found', snapshot: { activePlanRevision: null } });
  });

  it('rejects cross-workspace requests and unregistered result identities', async () => {
    const s = await planningScenario();
    expect(await s.compiler.requestInitial({ ...s.request, scope: { ...planningScope, workspaceId: 'other' } })).toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(await s.compiler.accept({ reason: 'unknown', resultRef: { aggregateType: 'QueryJobAnswer', projectId: planningScope.projectId, workspaceId: planningScope.workspaceId, queryJobId: 'unknown', answerId: 'unknown' } })).toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(s.calls()).toBe(0);
  });
});
