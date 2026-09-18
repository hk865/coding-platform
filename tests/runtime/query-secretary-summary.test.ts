import { expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { ReadOnlyQueryRuntime } from '../../src/execution/worker-runtime/read-only-query-runtime.js';
import type { ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';

it.each(['cited', 'uncited', 'uncited-root', 'unknown', 'revoked', 'open'] as const)('secretary publishes traceable summaries without semantic certification: %s', async mode => {
  const directory = await mkdtemp(join(tmpdir(), 'secretary-summary-'));
  const root = join(directory, 'source'); await mkdir(root);
  const value = { ref: { aggregateType: 'GoalPhase', goalId: 'g' }, phase: 'RUNNING' };
  const pointer = mode === 'uncited-root' ? '/material' : '/material/goalPhase';
  const input = JSON.stringify({ material: { goalPhase: value } }), inputDigest = sha256Hex(input);
  let calls = 0, reads = 0;
  const client: ModelClientPort = { async *stream(request) {
    calls++;
    expect(request.runId).not.toMatch(/-answer-review$/);
    expect(request.tools.map(tool => tool.name)).not.toContain('write');
    const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (calls === 1 && mode !== 'open') {
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'phase', name: 'read_query_fact', ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'phase', delta: JSON.stringify({ pointer }) };
      yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
    } else {
      const basis = mode === 'open' || mode === 'uncited' || mode === 'uncited-root' ? [] : [mode === 'unknown' ? 'F99' : 'F1'];
      yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [
        { kind: 'explanation', text: mode === 'open' ? 'Binary search halves a sorted interval.' : 'The goal remains running.', basis },
        { kind: 'suggestion', text: 'If useful, compare the available alternatives.', basis: [] },
      ] }) };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
    }
  } };
  const runtime = new ReadOnlyQueryRuntime(join(directory, 'runtime'), {
    rootFor: () => root, answerReviewPolicy: 'high-risk-v1',
    bind: async () => ({ configuration: { revision: 'fixture', provider: 'deepseek', model: 'deterministic-test', baseUrl: 'http://127.0.0.1' }, client }),
    materials: {
      assemble: async () => ({ status: 'ready', input, kind: 'semantic_query', goalId: 'g', roleBinding: {}, budget: DEFAULT_RUNTIME_BUDGET,
        deadline: null, responseGuide: 'semantic-query-secretary-summary-v11', factReadVersion: 4 }),
      readFact: async (_request, location) => {
        reads++; expect(location).toEqual({ inputDigest, pointer });
        return mode === 'revoked' && reads > 1 ? { status: 'forbidden', message: 'Authorization revoked' } : {
          status: 'ready', ...location, observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) }, value: mode === 'uncited-root' ? { goalPhase: value } : value,
        };
      },
    },
  });
  const request = { runRef: { aggregateType: 'QueryRun' as const, projectId: 'p', workspaceId: 'w', queryJobId: 'q', runId: 'r' },
    bundleRef: { digest: 'b'.repeat(64) } as never, question: 'Please summarize.', budget: { maxTokens: 128000 } };
  try {
    await runtime.init(); const result = await runtime.startQuery(request);
    expect(result.outcome).toBe(['cited', 'open'].includes(mode) ? 'answered' : 'gap');
    expect(runtime.all()[0]!.answerReview).toBeUndefined();
    expect(calls).toBe(mode === 'open' ? 1 : 2);
    if (mode === 'cited') {
      expect(result.answer).toContain('The goal remains running. [F1]');
      const source = result.sources.find(source => source.kind === 'query_fact')!;
      expect(source.version).toBe(inputDigest);
      expect(JSON.parse(source.refKey)).toMatchObject({ pointer: '/material/goalPhase', inputDigest, marker: 'F1' });
      expect(JSON.parse(source.refKey).assertion).toBeUndefined();
    } else if (mode !== 'open') expect(result.answer).toBeNull();
    if (mode === 'uncited' || mode === 'uncited-root') expect(result.message).toContain('citation_required');
    if (mode === 'unknown') expect(result.message).toContain('unknown_marker');
    if (mode === 'revoked') expect(result.message).toContain('read_unavailable');
    await runtime.close();
    const reopened = new ReadOnlyQueryRuntime(join(directory, 'runtime'), { rootFor: () => root,
      materials: { assemble: async () => { throw Error('must not reassemble'); } }, bind: async () => { throw Error('must not regenerate'); } });
    await reopened.init(); try { expect(await reopened.startQuery(request)).toEqual(result); } finally { await reopened.close(); }
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
}, 60000);
