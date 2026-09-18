import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueryAnswerAudits, parseAnswerAudit } from '../../src/execution/worker-runtime/query-answer-audit.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { QueryAnswerAuditRequest } from '../../src/contracts/query-answer-audit.js';
import type { ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';

const request: QueryAnswerAuditRequest = { requestId: 'review-1', runRef: { aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'w', queryJobId: 'q', runId: 'r' }, goalId: 'g', answerId: 'answer', blocks: [0] };
const input = { blocks: [{ index: 0, block: { kind: 'explanation' as const, text: 'The goal is running.', basis: ['F1'] } }], facts: [{ marker: 'F1' }] as any };
const assessment = { blocks: [{ index: 0, verdict: 'supported', claims: [{ quote: 'The goal is running.', verdict: 'supported', markers: ['F1'], reason: 'Recorded running phase' }] }] };
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

it.each(['success', 'revoked', 'cancel-final', 'cancel-before-model', 'duplicate', 'malformed', 'provider-error'] as const)('on-demand assessment keeps bounded execution and durable identity: %s', async mode => {
  const directory = await mkdtemp(join(tmpdir(), 'answer-audit-'));
  const entered = gate(), release = gate(); let calls = 0, preparations = 0, revoked = false;
  const prepared = { input, budget: DEFAULT_RUNTIME_BUDGET, answerDigest: 'original-answer-digest' };
  const client: ModelClientPort = { async *stream(modelRequest) {
    calls++; expect(modelRequest.tools).toEqual([]);
    if (mode === 'duplicate') { entered.resolve(); await release.promise; }
    if (mode === 'revoked') revoked = true;
    const common = { schemaVersion: 1 as const, requestId: modelRequest.requestId };
    if (mode === 'provider-error') throw Error('provider unavailable');
    yield { ...common, sequence: 1, type: 'text_delta', delta: mode === 'malformed' ? '{}' : JSON.stringify(assessment) };
    yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
  } };
  const audits = new QueryAnswerAudits(directory, {
    prepare: async () => {
      preparations++;
      if ((mode === 'cancel-final' && preparations === 3) || (mode === 'cancel-before-model' && preparations === 2)) { entered.resolve(); await release.promise; }
      if (revoked) throw Error('authorization revoked');
      return structuredClone(prepared);
    },
    bind: async () => ({ configuration: { revision: 'fixture', provider: 'deepseek', model: 'deterministic-test', baseUrl: 'http://127.0.0.1' }, client }),
  });
  try {
    await audits.init(); expect(calls).toBe(0);
    await audits.start(request);
    if (mode.startsWith('cancel-')) { await entered.promise; const cancelling = audits.cancel(request); release.resolve(); await cancelling; }
    if (mode === 'duplicate') {
      await entered.promise;
      await audits.start(request); expect(calls).toBe(1);
      await expect(audits.start({ ...request, requestId: 'another' })).rejects.toThrow('正在执行');
      await expect(audits.start({ ...request, blocks: null })).rejects.toThrow('身份冲突');
      release.resolve();
    }
    const expected = ['success', 'duplicate'].includes(mode) ? 'completed' : mode.startsWith('cancel-') ? 'cancelled' : 'failed';
    await vi.waitFor(() => expect(audits.views(request.runRef, request.answerId)[0]?.status).toBe(expected));
    const view = audits.views(request.runRef, request.answerId)[0]!;
    expect(calls).toBe(mode === 'cancel-before-model' ? 0 : 1);
    if (expected !== 'completed') expect(view.assessment).toBeNull();
    await audits.close();
    const reopened = new QueryAnswerAudits(directory, { prepare: async () => structuredClone(prepared), bind: async () => { throw Error('must not rebind'); } });
    await reopened.init(); try { expect(await reopened.start(request)).toEqual(view); } finally { await reopened.close(); }
  } finally { release.resolve(); await audits.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);

it('validates assessment coverage, quotes and per-block citation membership without claiming semantic proof', () => {
  expect(parseAnswerAudit(JSON.stringify(assessment), input)).toEqual(assessment);
  for (const mutate of [
    (result: any) => result.blocks.pop(),
    (result: any) => result.blocks.push(result.blocks[0]),
    (result: any) => result.blocks[0].claims[0].quote = 'invented quote',
    (result: any) => result.blocks[0].claims[0].markers = ['F2'],
    (result: any) => result.blocks[0].claims[0].verdict = 'conflict',
    (result: any) => result.blocks[0].claims = [],
  ]) { const result = structuredClone(assessment); mutate(result); expect(() => parseAnswerAudit(JSON.stringify(result), input)).toThrow(); }
  expect(parseAnswerAudit(JSON.stringify({ blocks: [{ index: 0, verdict: 'unverifiable', claims: [] }] }), input).blocks[0]!.verdict).toBe('unverifiable');
});
