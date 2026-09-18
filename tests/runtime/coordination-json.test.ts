import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ModelRequest, ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';
import { QueryExecutionContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';
import { ReadOnlyQueryRuntime } from '../../src/execution/worker-runtime/read-only-query-runtime.js';
import { COORDINATION_JSON_RESPONSE_GUIDE } from '../../src/contracts/query-execution-context.js';
import { planningScenario } from '../control/planning-fixture.js';

it('keeps the coordination JSON contract through actual source-tool rounds, metering and durable replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coordination-json-'));
  const root = join(directory, 'source'); await mkdir(root); await writeFile(join(root, 'README.md'), 'Actual coordination source.');
  const s = await planningScenario();
  const materials = new QueryExecutionContextCompiler({ ledger: () => s.h.ledger, vault: () => s.h.vault });
  const requests: ModelRequest[] = [], measured: ModelRequest[] = [];
  const answer = JSON.stringify({ kind: 'needs_decision', summary: 'Two incompatible public behaviors remain.', questions: ['Which documented behavior should be selected?'] });
  const client: ModelClientPort = { async *stream(request) {
    requests.push(structuredClone(request));
    const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (requests.length === 1) {
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'read-source', name: 'read', ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'read-source', delta: '{"path":"README.md"}' };
      yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
    } else {
      yield { ...common, sequence: 1, type: 'text_delta', delta: answer };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
    }
  } };
  const deps = { materials, rootFor: () => root, bind: async () => ({ client,
    configuration: { revision: 'protocol-test', provider: 'deepseek', model: 'labelled-coordination-json', baseUrl: 'http://127.0.0.1' },
    inputCounter: { count: (request: ModelRequest) => { measured.push(structuredClone(request)); return { tokens: 100, method: 'model_tokenizer' as const, tokenizer: 'labelled-counter' }; } }
  }) };
  let runtime = new ReadOnlyQueryRuntime(join(directory, 'runtime'), deps); await runtime.init();
  try {
    s.onRequest(async request => {
      const result = await runtime.startQuery(request);
      expect(result).toMatchObject({ outcome: 'answered', answer });
      expect(requests).toHaveLength(2); expect(measured).toEqual(requests);
      expect(JSON.stringify(requests[1]!.messages)).toContain('Actual coordination source.');
      for (const outgoing of requests) {
        expect(outgoing.responseFormat).toEqual({ type: 'json_object' });
        expect(outgoing.systemPrompt).toContain(COORDINATION_JSON_RESPONSE_GUIDE.instruction);
        expect(outgoing.tools.some(tool => ['edit', 'write', 'shell'].includes(tool.name))).toBe(false);
      }
      expect(runtime.all()[0]?.responseGuide).toBe(COORDINATION_JSON_RESPONSE_GUIDE.id);
      await runtime.close(); runtime = new ReadOnlyQueryRuntime(join(directory, 'runtime'), deps); await runtime.init();
      expect(await runtime.inspectQuery(request)).toEqual({ status: 'result', result });
      expect(await runtime.startQuery(request)).toEqual(result);
      expect(requests).toHaveLength(2);
    });
    expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
    expect(await s.h.driveQuery({ reason: 'actual-coordination-json' })).toMatchObject({ started: 1, answered: 1 });
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
}, 60000);
