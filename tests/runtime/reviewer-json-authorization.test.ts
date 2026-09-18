import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { ModelRequest } from '../../vendor/coding-agent/src/core/ports/model_client/model-client-port.js';
import { runObservedModel } from '../../src/execution/worker-runtime/observed-model-run.js';
import { ModelBudget, DEFAULT_RUNTIME_BUDGET } from '../../src/execution/worker-runtime/model-budget.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

it.each([true, false])('real kernel loop: JSON=%s is selected before capacity and authorization on every tool round', async json => {
  const root = await mkdtemp(join(tmpdir(), 'review-json-source-')), storage = await mkdtemp(join(tmpdir(), 'review-json-storage-'));
  roots.push(root, storage); await writeFile(join(root, 'source.txt'), 'independent source evidence\n');
  const requests: ModelRequest[] = [], measured: ModelRequest[] = [];
  const authorized: Array<{ requestId: string; requestDigest: string }> = [];
  const budget = { ...DEFAULT_RUNTIME_BUDGET, perResponseTokens: 128 };
  const meter = new ModelBudget(budget, async () => {}, { count: outgoing => {
    measured.push(structuredClone(outgoing)); return { tokens: 100, method: 'model_tokenizer', tokenizer: 'labelled-test-counter' };
  } });
  const client: kernel.ModelClientPort = { async *stream(request) {
    requests.push(structuredClone(request));
    expect(authorized.at(-1)).toMatchObject({ requestId: request.requestId, requestDigest: digest(request) });
    let sequence = 0; const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (requests.length === 1) {
      yield { ...common, sequence: ++sequence, type: 'tool_call_started', callId: 'source-call', name: 'read_source', ordinal: 0 };
      yield { ...common, sequence: ++sequence, type: 'tool_arguments_delta', callId: 'source-call', delta: JSON.stringify({ path: 'source.txt' }) };
    } else yield { ...common, sequence: ++sequence, type: 'text_delta', delta: '{"decision":"INCONCLUSIVE"}' };
    yield { ...common, sequence: ++sequence, type: 'usage_snapshot', usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, costUsdMicros: null } };
    yield { ...common, sequence: ++sequence, type: 'completed', reason: requests.length === 1 ? 'tool_calls' : 'final_answer' };
  } };
  const result = await runObservedModel({ kernel, bound: { configuration: { revision: 'json-test', provider: 'deepseek', model: 'labelled-json-protocol-stub', baseUrl: 'http://127.0.0.1' }, client },
    root, databasePath: join(storage, 'kernel.sqlite'), sessionId: 'json-review-session', input: 'Read source.txt, then return JSON only: {"decision":"INCONCLUSIVE"}.',
    budget, meter, readOnly: true, signal: new AbortController().signal, deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
    ...(json ? { responseFormat: { type: 'json_object' as const } } : {}),
    sourceTools: { includeReadSource: true }, manifestDigest: 'manifest-test',
    modelCalls: { bind: async () => {}, beforeCall: async fact => { authorized.push(fact); } },
  });
  expect(result.state.status).toBe('completed');
  expect(requests).toHaveLength(2); expect(meter.entries).toHaveLength(2); expect(authorized).toHaveLength(2);
  expect(JSON.stringify(requests[1]!.messages)).toContain('independent source evidence');
  for (const [index, request] of requests.entries()) {
    expect(request.responseFormat).toEqual(json ? { type: 'json_object' } : undefined);
    expect(Object.hasOwn(request, 'responseFormat')).toBe(json);
    expect(request.maxOutputTokens).toBe(128);
    expect(measured[index]).toEqual(request);
    expect(meter.entries[index]!.inputDigest).toBe(digest(request));
    expect(authorized[index]!.requestDigest).toBe(digest(request));
    if (json) { const { responseFormat: _format, ...without } = request; expect(digest(without)).not.toBe(digest(request)); }
  }
}, 60000);
