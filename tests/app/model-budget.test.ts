import { expect, it } from 'vitest';
import { ModelBudget, ContextCapacityExceeded, DEFAULT_RUNTIME_BUDGET, validateRuntimeBudget } from '../../src/execution/worker-runtime/model-budget.js';
import { createHash } from 'node:crypto';
import { kernelRunLimits } from '../../src/execution/worker-runtime/run-limits.js';
import type { ModelClientPort, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
const request: ModelRequest = { schemaVersion: 1, requestId: 'request', runId: 'run', systemPrompt: 'test', messages: [{ role: 'user', messageId: 'm', content: 'test' }], tools: [], maxOutputTokens: 100 };

it('rejects a full model request exceeding its single-call window before invoking the provider', async () => {
  let calls = 0;
  const client: ModelClientPort = { async *stream() { calls++; } };
  const meter = new ModelBudget({ ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 1000 }, async () => {}, { count: () => ({ tokens: 901, method: 'model_tokenizer', tokenizer: 'test-counter' }) });
  await expect(async () => { for await (const _ of meter.wrap(client).stream(request, { signal: new AbortController().signal })) { /* drain */ } }).rejects.toBeInstanceOf(ContextCapacityExceeded);
  expect(calls).toBe(0); expect(meter.entries).toHaveLength(0); expect(meter.exhausted).toBe(false);
});

it('binds measurement to the exact outgoing request and keeps estimates distinct from reported usage', async () => {
  let counted: ModelRequest | undefined, sent: ModelRequest | undefined;
  const meter = new ModelBudget(DEFAULT_RUNTIME_BUDGET, async () => {}, { count: r => { counted = structuredClone(r); return { tokens: 30, method: 'model_tokenizer', tokenizer: 'test-counter' }; } });
  const client: ModelClientPort = { async *stream(r) { sent = structuredClone(r); yield { type: 'usage_snapshot', schemaVersion: 1, requestId: r.requestId, sequence: 1, usage: { inputTokens: 28, outputTokens: 2, cachedInputTokens: 0, costUsdMicros: null } }; } };
  for await (const _ of meter.wrap(client).stream(request, { signal: new AbortController().signal })) { /* drain */ }
  expect(counted).toEqual(sent);
  expect(meter.entries[0]).toMatchObject({ inputMeasurement: { tokens: 30, method: 'model_tokenizer' }, inputTokens: 28,
    inputBytes: Buffer.byteLength(JSON.stringify(sent)), inputDigest: createHash('sha256').update(JSON.stringify(sent)).digest('hex') });
});
it('shares reservations across clients and caps the next output to the remaining allowance', async () => {
  const seen: number[] = [], saved: unknown[] = [];
  const client: ModelClientPort = { async *stream(r) { seen.push(r.maxOutputTokens!); yield { type: 'usage_snapshot', schemaVersion: 1, requestId: r.requestId, sequence: 1, usage: { inputTokens: 10, outputTokens: r.maxOutputTokens!, cachedInputTokens: 5, costUsdMicros: null } }; yield { type: 'completed', schemaVersion: 1, requestId: r.requestId, sequence: 2, reason: 'final_answer' }; } };
  const budget = new ModelBudget({ ...DEFAULT_RUNTIME_BUDGET, outputTokens: 150 }, async entries => { saved.push(structuredClone(entries)); });
  for await (const _ of budget.wrap(client).stream(request, { signal: new AbortController().signal })) { /* drain */ }
  for await (const _ of budget.wrap(client).stream({ ...request, requestId: 'two' }, { signal: new AbortController().signal })) { /* drain */ }
  expect(seen).toEqual([100, 50]); expect(budget.totals()).toEqual({ input: 20, output: 150 }); expect(saved.length).toBe(4);
  await expect(async () => { for await (const _ of budget.wrap(client).stream(request, { signal: new AbortController().signal })) { /* drain */ } }).rejects.toThrow('预算');
});

it('leaves every cumulative limit unset unless the operator configures it', () => {
  const limits = { inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null };
  // The product default is "no cumulative cap", not a hidden token/call/time budget.
  expect(DEFAULT_RUNTIME_BUDGET).toMatchObject({ inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null });
  expect(validateRuntimeBudget(undefined)).toEqual(DEFAULT_RUNTIME_BUDGET);
  // Explicit nulls survive at any layer (the old code only accepted them for one scoped task).
  expect(validateRuntimeBudget(limits)).toMatchObject({ ...limits, contextWindowTokens: DEFAULT_RUNTIME_BUDGET.contextWindowTokens });
  expect(validateRuntimeBudget(limits, true)).toMatchObject(limits);
  // Declared capacities stay bounded and unknown keys are still rejected.
  for (const value of [{ contextWindowTokens: null }, { inputTokens: -1 }, { unknown: null }, { perResponseTokens: 999999 }, { timeoutMs: 0 }]) expect(() => validateRuntimeBudget(value)).toThrow();
  // The explicitly scoped task only widens the single-response capacity, never a cumulative one.
  expect(() => validateRuntimeBudget({ perResponseTokens: 32768 })).toThrow();
  expect(validateRuntimeBudget({ perResponseTokens: 32768 }, true).perResponseTokens).toBe(32768);
});

it('passes an unconfigured budget to the kernel as null limits instead of a default cap', () => {
  expect(kernelRunLimits(validateRuntimeBudget(undefined))).toEqual({
    maxModelRequests: null, maxToolCalls: null, maxInputTokens: null, maxOutputTokens: null,
    maxTotalTokens: null, maxCostUsdMicros: null, deadlineMs: null,
  });
  expect(kernelRunLimits(validateRuntimeBudget({ inputTokens: 200000, maxRequests: 16, timeoutMs: 120000 }))).toMatchObject({ maxInputTokens: 200000, maxModelRequests: 16, deadlineMs: 120000, maxToolCalls: null, maxOutputTokens: null });
});

it('records usage beyond ordinary cumulative limits without enforcing a substitute cap', async () => {
  const limits = validateRuntimeBudget(undefined);
  const budget = new ModelBudget(limits, async () => {});
  const client: ModelClientPort = { async *stream(r) {
    yield { type: 'usage_snapshot', schemaVersion: 1, requestId: r.requestId, sequence: 1, usage: { inputTokens: 30000000, outputTokens: 200000, cachedInputTokens: 10, costUsdMicros: null } };
    yield { type: 'completed', schemaVersion: 1, requestId: r.requestId, sequence: 2, reason: 'final_answer' };
  }};
  for (let i = 0; i < 40; i++) for await (const _ of budget.wrap(client).stream({ ...request, requestId: String(i) }, { signal: new AbortController().signal })) { /* drain */ }
  expect(budget.totals()).toEqual({ input: 1200000000, output: 8000000 });
  expect(budget.exhausted).toBe(false);
  expect(budget.entries).toHaveLength(40);
});
