import { expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadOnlyQueryRuntime } from '../../src/execution/worker-runtime/read-only-query-runtime.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { checkReviewResult, queryReviewInput, withQueryReviewDefinitions } from '../../src/execution/worker-runtime/query-answer-review.js';
import type { ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';

const input = { blocks: [{ index: 1, block: { kind: 'explanation' as const, text: 'The goal remains running.', basis: ['F1'] } }], facts: [{ marker: 'F1' }] as any };
const supported = { blocks: [{ index: 1, verdict: 'supported', outsideScope: false, claims: [{ quote: 'The goal remains running.', supported: true, markers: ['F1'], reason: 'Recorded phase RUNNING' }] }] };
it('requires complete, uniquely indexed grounded review claims', () => {
  expect(checkReviewResult(JSON.stringify(supported), input)).toBe('supported');
  for (const mutate of [
    (r: any) => r.blocks.pop(),
    (r: any) => r.blocks.push(r.blocks[0]),
    (r: any) => r.blocks[0].claims[0].quote = 'invented quote',
    (r: any) => r.blocks[0].claims[0].markers = ['F2'],
    (r: any) => r.blocks[0].claims[0].supported = false,
    (r: any) => r.blocks[0].claims = [],
  ]) { const r = structuredClone(supported); mutate(r); expect(() => checkReviewResult(JSON.stringify(r), input)).toThrow(); }
});
it('allows an outside-scope open explanation without certifying it as a platform fact', () => {
  const open = { blocks: [{ index: 2, block: { kind: 'explanation' as const, text: 'A binary search compares the midpoint.', basis: [] } }], facts: [] };
  expect(checkReviewResult(JSON.stringify({ blocks: [{ index: 2, verdict: 'supported', outsideScope: true, claims: [] }] }), open)).toBe('supported');
  expect(() => checkReviewResult(JSON.stringify({ blocks: [{ index: 2, verdict: 'supported', outsideScope: false, claims: [] }] }), open)).toThrow();
});
it('does not trigger a review for ordinary open explanation or fixed facts alone', () => {
  const fact: any = { marker: 'F1', assertion: { kind: 'goal_phase', expected: 'RUNNING' } };
  expect(queryReviewInput({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'explanation', text: 'Compare two algorithms.', basis: [] }] }, [fact])).toBeNull();
  expect(queryReviewInput({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'fact', citation: 'F1' }] }, [fact])).toBeNull();
  const selected = queryReviewInput({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'fact', citation: 'F1' }, { kind: 'explanation', text: 'A factual claim with omitted citation.', basis: [] }] }, [fact]);
  expect(selected?.blocks).toHaveLength(1); expect(selected?.facts).toEqual([]);
});

it.each(['supported', 'unsupported', 'uncertain', 'malformed', 'incomplete', 'revoked', 'source-changed', 'cancelled', 'budget', 'ordinary', 'disabled', 'definitions'] as const)('candidate review has bounded publication semantics: %s', async mode => {
  const dir = await mkdtemp(join(tmpdir(), 'query-answer-review-')), root = join(dir, 'source'); await mkdir(root);
  let requests = 0, reviewCalls = 0, revoked = false;
  const capturedInput = mode === 'definitions' ? JSON.stringify({ contextLabels: { schemaVersion: 1, records: { goalPhase: { object: 'GoalPhase', relation: 'recorded-phase', coverage: 'last-recorded-goal-phase', authority: 'Independent GoalPhase reduction' }, unused: { object: 'PRIVATE_UNUSED_CONTEXT' } } }, privateData: 'PRIVATE_UNUSED_CONTEXT' }) : 'PRIVATE_UNUSED_CONTEXT';
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { reached = resolve; });
  const client: ModelClientPort = { async *stream(request, options) {
    requests++; const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (request.runId.endsWith('-answer-review')) {
      reviewCalls++; expect(request.tools).toEqual([]);
      expect(request.messages).toHaveLength(1);
      expect(JSON.stringify(request.messages)).not.toContain('PRIVATE_UNUSED_CONTEXT');
      const captured = JSON.parse(request.messages[0]!.role === 'user' ? request.messages[0]!.content : (() => { throw Error('Review input must be a user message'); })());
      expect(captured.blocks[0].block.basis).toEqual(['F1']);
      if (mode === 'definitions') expect(captured.definitions).toEqual([{ marker: 'F1', inputDigest: sha256Hex(capturedInput), collectionPointer: '/material/goalPhase', label: { object: 'GoalPhase', relation: 'recorded-phase', coverage: 'last-recorded-goal-phase', authority: 'Independent GoalPhase reduction' } }]);
      if (mode === 'revoked') revoked = true;
      if (mode === 'source-changed') await writeFile(join(root, 'changed.txt'), 'changed');
      if (mode === 'cancelled') { reached(); await gate; expect(options.signal?.aborted).toBe(true); return; }
      const result = structuredClone(supported);
      if (mode === 'unsupported' || mode === 'uncertain') { result.blocks[0]!.verdict = mode; result.blocks[0]!.claims[0]!.supported = false; }
      yield { ...common, sequence: 1, type: 'text_delta', delta: mode === 'malformed' ? '{}' : JSON.stringify(result) };
      if (mode !== 'incomplete') yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
      return;
    }
    if (requests === 1 && mode !== 'ordinary') {
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'phase', name: 'read_query_fact', ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'phase', delta: JSON.stringify({ pointer: '/material/goalPhase', assertion: { kind: 'goal_phase', expected: 'RUNNING' } }) };
      yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
    } else {
      const blocks = mode === 'ordinary' ? [{ kind: 'explanation', text: 'Compare two algorithms.', basis: [] }] : [{ kind: 'fact', citation: 'F1' }, input.blocks[0]!.block];
      yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks }) };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
    }
  } };
  const runtime = new ReadOnlyQueryRuntime(join(dir, 'runtime'), { rootFor: () => root, ...(mode === 'disabled' ? {} : { answerReviewPolicy: 'high-risk-v1' as const }),
    bind: async () => ({ configuration: { revision: 'fixture', provider: 'deepseek', model: 'deterministic-test', baseUrl: 'http://127.0.0.1' }, client }),
    materials: { assemble: async () => ({ status: 'ready', input: capturedInput, kind: 'semantic_query', goalId: 'g', roleBinding: {}, budget: mode === 'budget' ? { ...DEFAULT_RUNTIME_BUDGET, maxRequests: 2 } : DEFAULT_RUNTIME_BUDGET, deadline: null, factReadVersion: 3 }),
      readFact: async () => revoked ? { status: 'stale', message: 'revoked' } : { status: 'ready', pointer: '/material/goalPhase', inputDigest: sha256Hex(capturedInput), observation: 'captured_query_input', sourceBundle: { digest: 'bundle' }, value: { ref: { aggregateType: 'GoalPhase', goalId: 'g' }, phase: 'RUNNING' } } } });
  const request = { runRef: { aggregateType: 'QueryRun' as const, projectId: 'p', workspaceId: 'w', queryJobId: 'q', runId: 'r' }, bundleRef: { digest: 'b'.repeat(64) } as never, question: 'Current progress?', budget: { maxTokens: 128000 } };
  try {
    await runtime.init(); const pending = runtime.startQuery(request);
    if (mode === 'cancelled') { await entered; const cancellation = runtime.cancelQuery(request.runRef); release(); await cancellation; }
    const result = await pending;
    expect(result.outcome).toBe(['supported', 'ordinary', 'disabled', 'definitions'].includes(mode) ? 'answered' : mode === 'cancelled' ? 'failed' : 'gap');
    expect(reviewCalls).toBe(['ordinary', 'disabled', 'budget'].includes(mode) ? 0 : 1);
    if (!['supported', 'ordinary', 'disabled', 'definitions'].includes(mode)) expect(result.answer).toBeNull();
    const record = runtime.all()[0]!;
    expect(record.usage).toHaveLength(requests);
    if (mode === 'budget') { expect(requests).toBe(2); expect(record.answerReview?.status).toBe('failed'); }
    if (reviewCalls) { expect(record.answerReview?.request.tools).toEqual([]); expect(record.answerReview?.inputDigest).toMatch(/^[0-9a-f]{64}$/); }
    await runtime.close();
    const reopened = new ReadOnlyQueryRuntime(join(dir, 'runtime'), { rootFor: () => root, materials: { assemble: async () => { throw Error('no reassembly'); } }, bind: async () => { throw Error('no retry'); } });
    await reopened.init(); try { expect(await reopened.startQuery(request)).toEqual(result); } finally { await reopened.close(); }
  } finally { release(); await runtime.close(); await rm(dir, { recursive: true, force: true }); }
}, 60000);


it('binds child-record definitions to the captured digest without importing uncited records or memory labels', () => {
  const label = { object: 'TaskObservation', relation: 'observed-task', coverage: 'bounded-accepted-plan-task-selection', authority: 'TaskReduction for acceptance; TaskLease-held Run for ordinary execution only' };
  const capturedInput = JSON.stringify({ contextLabels: { schemaVersion: 1, records: { collaborationWork: label, acceptedPlan: { ...label, authority: 'PRIVATE_UNCITED_PLAN' } } }, material: { secret: 'PRIVATE_MATERIAL' } });
  const original: any = { blocks: [{ index: 0, block: { kind: 'inference', text: 'Only ordinary task runs are observed.', basis: ['F1'] } }], facts: [
    { marker: 'F1', pointer: '/material/collaborationWork/4', inputDigest: sha256Hex(capturedInput) },
    { marker: 'F2', pointer: '/maintainedPreferences/collaborationWork', inputDigest: sha256Hex(capturedInput) },
    { marker: 'F3', pointer: '/material/collaborationWork/1', inputDigest: 'different-input' },
  ] };
  const result = withQueryReviewDefinitions(original, capturedInput);
  expect(result.definitions).toEqual([{ marker: 'F1', inputDigest: sha256Hex(capturedInput), collectionPointer: '/material/collaborationWork', label }]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  expect(result.blocks[0]!.block.basis).toEqual(['F1']);
  expect(original.definitions).toBeUndefined();
  expect(withQueryReviewDefinitions(original, '{}')).toEqual(original);
  expect(withQueryReviewDefinitions(original, 'legacy input')).toEqual(original);
});


it.each(['invalid_json', 'invalid_structure', 'unknown_marker'] as const)('reports the actual cited-answer rejection: %s', async mode => {
  const dir = await mkdtemp(join(tmpdir(), 'query-format-')), root = join(dir, 'source'); await mkdir(root);
  const raw = mode === 'invalid_json' ? '{"schemaVersion":1,"language":"zh","blocks":[{"kind":"explanation","text":"已决定"},"{"kind":"explanation"}]}'
    : JSON.stringify({ schemaVersion: 1, language: 'en', blocks: mode === 'invalid_structure' ? [{ kind: 'explanation', text: 'Missing basis' }] : [{ kind: 'explanation', text: 'Unobserved', basis: ['F1'] }] });
  let calls = 0;
  const client: ModelClientPort = { async *stream(request) {
    calls++; expect(request.responseFormat).toEqual({ type: 'json_object' });
    yield { schemaVersion: 1, requestId: request.requestId, sequence: 1, type: 'text_delta', delta: raw };
    yield { schemaVersion: 1, requestId: request.requestId, sequence: 2, type: 'completed', reason: 'final_answer' };
  } };
  const runtime = new ReadOnlyQueryRuntime(join(dir, 'runtime'), { rootFor: () => root,
    bind: async () => ({ configuration: { revision: 'fixture', provider: 'deepseek', model: 'fixture', baseUrl: 'http://127.0.0.1' }, client }),
    materials: { assemble: async () => ({ status: 'ready', input: '{}', kind: 'semantic_query', goalId: 'g', roleBinding: {}, budget: DEFAULT_RUNTIME_BUDGET, deadline: null, factReadVersion: 4 }),
      readFact: async () => { throw Error('No fact was read'); } } });
  const request = { runRef: { aggregateType: 'QueryRun' as const, projectId: 'p', workspaceId: 'w', queryJobId: 'q', runId: 'r' }, bundleRef: { digest: 'b'.repeat(64) } as never, question: 'Progress?', budget: { maxTokens: 128000 } };
  try {
    await runtime.init(); const result = await runtime.startQuery(request);
    expect(result.outcome).toBe('gap'); expect(result.answer).toBeNull(); expect(result.sources).toEqual([]);
    expect(result.message).toContain(mode); expect(calls).toBe(1);
    expect(await runtime.startQuery(request)).toEqual(result); expect(calls).toBe(1);
  } finally { await runtime.close(); await rm(dir, { recursive: true, force: true }); }
});
