import { describe, expect, it } from 'vitest';
import { QueryExecutionContextCompiler, QuerySourceContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';
import type { QueryExecutionMaterial, QuerySourceObservationPort } from '../../src/contracts/query-execution-context.js';
import { planningScenario, planningScope } from '../control/planning-fixture.js';
import { ReadOnlyQueryRuntime } from '../../src/execution/worker-runtime/read-only-query-runtime.js';
import { createQueryFactTool } from '../../src/execution/worker-runtime/query-fact-tool.js';
import type { QueryVerificationFacts } from '../../src/contracts/query-quality-facts.js';
import { createHash } from 'node:crypto';

it.each([['rounds', 'stale'], ['rounds', 'unavailable'], ['rounds', 'failed'], ['reviews', 'stale'], ['reviews', 'unavailable']] as const)('binds actual captured Verification %s records before citing %s applicability', async (kind, status) => {
  // Verification public read-port fixture; actual Ledger, Vault, Context and
  // fact tool are used. This does not claim a real command or model review ran.
  const recordedAt = '2026-09-16T00:00:00Z', version = '8'.repeat(64);
  const facts: QueryVerificationFacts = { schemaVersion: 1, object: 'verification-stages', scope: planningScope,
    status: 'ready', observedAt: recordedAt, version, coverage: 'recorded-tool-rounds-and-independent-reviews', issues: [],
    rounds: [{ scope: { ...planningScope, runId: 'work-run', taskId: 'task' }, requestId: 'verify', roundId: 'round',
      version, recordedAt, finishedAt: recordedAt, status: 'completed', outcome: 'INCONCLUSIVE', coverage: [], evidence: [],
      applicability: { status, identity: null, issues: ['Source observation unavailable in fixture'] } }], reviews: [] };
  if (kind === 'reviews') {
    facts.rounds = [];
    facts.reviews = [{ scope: { ...planningScope, runId: 'work-run', taskId: 'task' }, requestId: 'verify', reviewId: 'review',
      version, recordedAt, phase: 'settled', execution: null,
      formal: { resultRef: { aggregateType: 'ReviewResult', ...planningScope, reviewId: 'review' }, evidenceRefs: [], taskPhase: 'satisfied', goalPhase: 'RUNNING' },
      applicability: { status, issues: ['Reviewer source applicability unavailable in fixture'] } }];
  }
  const s = await planningScenario(undefined, { verificationFacts: async () => structuredClone(facts) });
  const context = new QueryExecutionContextCompiler({ ledger: () => s.h.ledger, vault: () => s.h.vault });
  s.onRequest(async request => {
    const material = await context.assemble(request);
    if (material.status !== 'ready') throw Error(material.message);
    const inputDigest = createHash('sha256').update(material.input).digest('hex');
    for (const pointer of [`/material/verificationStages/${kind}/0`, `/material/verificationStages/${kind}/0/applicability`]) {
      const port = createQueryFactTool(p => context.readFact(request, { inputDigest, pointer: p }), { requireAssertions: true });
      const result = await port.tool.handler.execute({ callId: 'fact', arguments: { pointer, assertion: { kind: 'source_applicability', expected: status } } } as never, { signal: new AbortController().signal } as never);
      expect(result.status).toBe('success');
      const sources = await port.sources('Recorded applicability [F1]');
      expect(JSON.parse(sources[0]!.refKey)).toMatchObject({ pointer, applicabilityAuthority: {
        family: 'verification-applicability', scope: planningScope, recordId: kind === 'rounds' ? 'round' : 'review', recordKind: kind === 'rounds' ? 'tool-round' : 'independent-review',
        recordPointer: `/material/verificationStages/${kind}/0`, observationVersion: version, recordVersion: version, observedAt: recordedAt, recordedAt,
      }, assertion: { kind: 'source_applicability', expected: status } });
    }
  });
  expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
  expect(await s.h.driveQuery({ reason: 'verification-fact-family' })).toMatchObject({ started: 1, answered: 1, failures: [] });
});

describe('query role execution and source Context', () => {
  it('compiles the actual claimed coordination input with its role contract and unchanged null limits', async () => {
    const s = await planningScenario();
    const context = new QueryExecutionContextCompiler({ ledger: () => s.h.ledger, vault: () => s.h.vault });
    const results: QueryExecutionMaterial[] = [];
    s.onRequest(async request => {
      results.push(await context.assemble(request));
      expect(await context.assemble({ ...request, question: 'A different role intent' })).toMatchObject({ status: 'rejected', message: 'query runtime requires exact real role intent' });
      for (const code of ['invalid_claim', 'unavailable'] as const) {
        const runtime = new ReadOnlyQueryRuntime('unused-query-runtime', {
          materials: { assemble: async () => ({ status: 'rejected', code, message: 'material refused' }) },
          rootFor: () => { throw Error('must not resolve workspace'); }, bind: async () => { throw Error('must not bind model'); }
        });
        if (code === 'invalid_claim') await expect(runtime.startQuery(request)).rejects.toThrow('material refused');
        else expect(await runtime.startQuery(request)).toMatchObject({ outcome: 'gap', message: 'material refused' });
        expect(runtime.all()).toEqual([]);
      }
    });
    expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
    expect(await s.h.driveQuery({ reason: 'context-input' })).toMatchObject({ started: 1, answered: 1, failures: [] });
    expect(results).toHaveLength(1);
    const result = results[0]!;
    if (result.status !== 'ready') throw Error(result.message);
    expect(result.budget).toMatchObject({ inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null });
    expect(result.deadline).toBeNull();
    expect(result.responseGuide).toBe('coordination-json-response-v1');
    const input = JSON.parse(result.input);
    expect(input).toMatchObject({ kind: 'initial_coordination', responsibilities: ['clarify_user_intent', 'propose_acceptance_and_dependency_plan', 'explain_tradeoffs'],
      permissions: { tools: ['read'], writeScope: [] }, question: s.request.input.instruction,
      material: { goalContext: { ref: { goalId: planningScope.goalId }, revision: 1, workspaceRevision: 1 } } });
    expect(input.responseContract).toContain('needs_decision');
    expect(input.rules).toContain('Stored history is explanatory unless current applicability is separately verified.');
  });

  it('compares persisted public records against current source and scope without runtime business logic', async () => {
    const s = await planningScenario();
    const runRef = { aggregateType: 'QueryRun' as const, projectId: planningScope.projectId, workspaceId: planningScope.workspaceId, queryJobId: 'old-query', runId: 'old-run' };
    const context = { ref: { aggregateType: 'Goal', projectId: planningScope.projectId, goalId: planningScope.goalId }, revision: 1, workspaceRevision: 1 };
    let input = JSON.stringify({ material: { goalContext: context } }), source = 'source-before';
    const observations: QuerySourceObservationPort = { all: () => [{ runRef, status: 'completed', input, sourceAfter: 'source-before' }] };
    const compiler = new QuerySourceContextCompiler({ ledger: () => s.h.ledger, observations, source: { sourceRevision: async () => source } });
    const current = () => compiler.currentness(planningScope.projectId, planningScope.workspaceId);
    expect((await current()).get('old-query')).toBe(true);
    source = 'source-after'; expect((await current()).get('old-query')).toBe(false);
    source = 'source-before';
    input = JSON.stringify({ material: { goalContext: { ...context, revision: 99 } } }); expect((await current()).get('old-query')).toBe(false);
    input = JSON.stringify({ material: { goalContext: { ...context, ref: { ...context.ref, projectId: 'other-project' } } } }); expect((await current()).get('old-query')).toBe(false);
    input = 'corrupt legacy input'; expect((await current()).get('old-query')).toBe(false);
    expect(await compiler.currentness(planningScope.projectId, 'other-workspace')).toEqual(new Map());
  });
});

it('checks the selected answer run without substituting another run of the same query', async () => {
  const s = await planningScenario();
  const runRef = { aggregateType: 'QueryRun' as const, projectId: planningScope.projectId, workspaceId: planningScope.workspaceId, queryJobId: 'same-query', runId: 'old-run' };
  const input = JSON.stringify({ material: { goalContext: { ref: { aggregateType: 'Goal', projectId: planningScope.projectId, goalId: planningScope.goalId }, revision: 1, workspaceRevision: 1 } } });
  const records = [{ runRef, status: 'completed', input, sourceAfter: 'old-source' }, { runRef: { ...runRef, runId: 'new-run' }, status: 'completed', input, sourceAfter: 'current-source' }];
  let reads = 0;
  const compiler = new QuerySourceContextCompiler({ ledger: () => s.h.ledger, observations: { all: () => records }, source: { sourceRevision: async () => { reads++; return 'current-source'; } } });
  expect((await compiler.currentness(planningScope.projectId, planningScope.workspaceId, { queryJobId: 'same-query', runId: 'old-run' })).get('same-query')).toBe(false);
  expect((await compiler.currentness(planningScope.projectId, planningScope.workspaceId, { queryJobId: 'same-query', runId: 'new-run' })).get('same-query')).toBe(true);
  const previous = reads;
  expect(await compiler.currentness(planningScope.projectId, planningScope.workspaceId, { queryJobId: 'missing' })).toEqual(new Map());
  expect(reads).toBe(previous);
});

it('reads cited facts only from the exact still-authorized query input and rejects revoked material', async () => {
  const { createHash } = await import('node:crypto');
  const s = await planningScenario();
  let deny = false, memoryRevision = 0;
  const context = new QueryExecutionContextCompiler({ memory: { select: async () => ({ status: 'ready', profileScope: { kind: 'profile', profileId: 'fixture-profile' }, projectScope: { kind: 'project', projectId: planningScope.projectId }, profileRevision: memoryRevision, projectRevision: 0, entries: [], excluded: [] }) }, ledger: () => s.h.ledger, vault: () => ({ ...s.h.vault, open: async (...args: Parameters<typeof s.h.vault.open>) => deny ? { status: 'unavailable', reason: 'revoked' } as never : s.h.vault.open(...args) }) });
  s.onRequest(async request => {
    const material = await context.assemble(request);
    if (material.status !== 'ready') throw Error(material.message);
    const inputDigest = createHash('sha256').update(material.input).digest('hex');
    const read = (pointer: string, digest = inputDigest) => context.readFact(request, { inputDigest: digest, pointer });
    expect(await read('/material/goalContext')).toMatchObject({ status: 'ready', inputDigest, pointer: '/material/goalContext', value: { ref: { goalId: 'goal' }, revision: 1 }, observation: 'captured_query_input' });
    expect(await read('/material/architectureReviews')).toMatchObject({ status: 'ready', value: { status: 'ready', rows: [] } });
    expect(await read('/material/nonexistent')).toMatchObject({ status: 'not_found', inputDigest });
    expect(await read('/material/focus/length')).toMatchObject({ status: 'not_found' });
    expect(await read('/permissions')).toMatchObject({ status: 'forbidden' });
    expect(await read('/material/~bad')).toMatchObject({ status: 'forbidden' });
    expect(await read('/material/goalContext', '0'.repeat(64))).toMatchObject({ status: 'stale' });
    memoryRevision = 1;
    expect(await read('/material/goalContext')).toMatchObject({ status: 'stale' });
    memoryRevision = 0;
    deny = true;
    expect(await read('/material/goalContext')).toMatchObject({ status: 'unavailable' });
    expect(await context.readFact({ ...request, question: 'wrong identity' }, { inputDigest, pointer: '/material/goalContext' })).toMatchObject({ status: 'unavailable' });
  });
  expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
  expect(await s.h.driveQuery({ reason: 'fact-reader' })).toMatchObject({ started: 1, answered: 1, failures: [] });
});

it('does not truncate a large fact or collapse explicit null/false/empty values into not_found', async () => {
  const { createHash } = await import('node:crypto');
  const context = new QueryExecutionContextCompiler({ ledger: () => { throw Error('captured-fixture-only'); }, vault: () => { throw Error('captured-fixture-only'); } });
  const input = JSON.stringify({ sourceBundle: { digest: 'fixture' }, material: { report: { large: '中'.repeat(6000), missingDecision: null, allowed: false, rows: [], unavailable: { status: 'unavailable', reason: 'Fixture reader unavailable' } } } });
  const inputDigest = createHash('sha256').update(input).digest('hex');
  context.assemble = async () => ({ status: 'ready', input, kind: 'semantic_query', goalId: 'g', roleBinding: {}, budget: {} as never, deadline: null });
  const read = (pointer: string) => context.readFact({} as never, { inputDigest, pointer });
  expect(await read('/material/report')).toMatchObject({ status: 'too_large' });
  expect(await read('/material/report/missingDecision')).toMatchObject({ status: 'ready', value: null });
  expect(await read('/material/report/allowed')).toMatchObject({ status: 'ready', value: false });
  expect(await read('/material/report/rows')).toMatchObject({ status: 'ready', value: [] });
  expect(await read('/material/report/unavailable')).toMatchObject({ status: 'ready', value: { status: 'unavailable', reason: 'Fixture reader unavailable' } });
  expect(await read('/material/report/absent')).toMatchObject({ status: 'not_found' });
});
