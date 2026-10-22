/**
 * PC-1b group S, ruling 21 (PC-15's "the reserve follows the output").
 *
 * `ModelBudget` is a pure accounting object here: constructed limits in,
 * accounting out. The preview must measure the complete final request without
 * reserving, persisting or marking the meter exhausted; `wrap` keeps the real
 * reservation and persist and shares the same measurement.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ModelClientPort, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { ContextCapacityExceeded, ModelBudget, type RuntimeBudget } from '../../src/core/agent-runtime/model-budget.js';
import { openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';

const budget = (over: Partial<RuntimeBudget> = {}): RuntimeBudget => ({
  contextWindowTokens: 1000,
  inputTokens: null,
  outputTokens: 400,
  maxRequests: null,
  maxToolCalls: null,
  timeoutMs: null,
  perResponseTokens: 256,
  ...over,
});

const request = (requestId: string, maxOutputTokens: number | null = null): ModelRequest => ({
  schemaVersion: 1,
  requestId,
  runId: 'pc15-run',
  systemPrompt: 'pc15 system',
  messages: [{ role: 'user', messageId: 'pc15-user', content: 'pc15 input' }],
  tools: [],
  maxOutputTokens,
});

const fixedCounter = (tokens: number) => ({ count: () => ({ tokens, method: 'model_tokenizer' as const, tokenizer: 'pc15-fixed' }) });

async function drain(meter: ModelBudget, events: ModelClientPort, next: ModelRequest): Promise<void> {
  for await (const _event of meter.wrap(events).stream(next, { signal: new AbortController().signal })) {
    // Exhaust the real reservation path.
  }
}

describe('PC-15 the reserve follows cumulative output', () => {
  it('reads the same totals() through a real tool call: 700 + 256 = 956, then 700 + 200 = 900', async () => {
    const fixture = await openPCWorkFixture({
      model: scriptedModel([
        {
          toolCalls: [{ callId: 'pc15-read-call', name: 'read', arguments: { path: 'wp2-read.txt' } }],
          usage: { inputTokens: 700, outputTokens: 200 },
        },
        { text: 'PC15 final answer' },
      ]),
      inputCounter: { count: () => ({ tokens: 700, method: 'model_tokenizer' as const, tokenizer: 'pc15-fixed' }) },
      budget: { contextWindowTokens: 1000, perResponseTokens: 256, outputTokens: 400 },
    });
    try {
      await fixture.work.prepare();
      const started = await fixture.work.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      // The first reply is a real tool call; the Kernel executed it and sent a
      // second model request through the same run meter.
      expect(fixture.model.calls()).toBe(2);

      const caps = fixture.model.requests.map(request => request.maxOutputTokens);
      expect(caps).toEqual([256, 200]);
      const requestCosts = fixture.model.requests.map(request => 700 + (request.maxOutputTokens ?? -1));
      expect(requestCosts).toEqual([956, 900]);

      const read = await fixture.work.readPromptRecord();
      expect(read.status, JSON.stringify(read)).toBe('ready');
      if (read.status !== 'ready') return;
      const recordedCaps = read.value.requests.map(request =>
        request.kind === 'work' ? request.maxOutputTokens : -1);
      expect(recordedCaps).toEqual([256, 200]);
      const recordedCosts = read.value.requests.map(request =>
        request.selection.inputTokens + (request.kind === 'work' ? request.maxOutputTokens : 0));
      expect(recordedCosts).toEqual([956, 900]);
      // Hand-computed from the case: window 1000, fixed counter 700 each. The
      // first cap is 256, so budget 1000 - 256 = 744; the second is 200, so
      // budget 1000 - 200 = 800. A preview that resets its own account would
      // keep reserving 256 there and record 744 twice.
      expect(read.value.requests.map(request => request.selection.inputTokens)).toEqual([700, 700]);
      expect(read.value.requests.map(request => request.selection.budget)).toEqual([744, 800]);
    } finally {
      await fixture.close();
    }
  });

  it('keeps wrap as the only reservation and persist while sharing the preview measurement', async () => {
    const persist = vi.fn(async () => {});
    const meter = new ModelBudget(budget(), persist, fixedCounter(700));
    let providerCalls = 0;
    const client: ModelClientPort = {
      async *stream(next) {
        providerCalls += 1;
        yield { schemaVersion: 1, requestId: next.requestId, sequence: 1, type: 'usage_snapshot',
          usage: { inputTokens: 700, outputTokens: 10, cachedInputTokens: 0, costUsdMicros: null } };
        yield { schemaVersion: 1, requestId: next.requestId, sequence: 2, type: 'completed', reason: 'final_answer' };
      },
    };
    await meter.preview(request('pc15-real'));
    await drain(meter, client, request('pc15-real'));
    expect(providerCalls).toBe(1);
    expect(meter.entries).toHaveLength(1);
    expect(meter.entries[0]!.reservedInput).toBe(700);
    expect(meter.entries[0]!.reservedOutput).toBe(256);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('awaits an asynchronous counter and clamps the output to the smallest cap', async () => {
    const meter = new ModelBudget(budget({ contextWindowTokens: 2000, outputTokens: 400 }), async () => {},
      { count: async () => ({ tokens: 700, method: 'model_tokenizer', tokenizer: 'pc15-async' }) });
    const measured = await meter.preview(request('pc15-cap', 100));
    expect(measured.inputTokens).toBe(700);
    expect(measured.outputReserve).toBe(100);
    expect(measured.outgoing.maxOutputTokens).toBe(100);
    expect(measured.fits).toBe(true);
  });

  it('keeps the UTF-8 + 4096 estimate when no counter is supplied', async () => {
    const meter = new ModelBudget(budget({ contextWindowTokens: 100_000, perResponseTokens: 128 }), async () => {});
    const next = request('pc15-estimate', 64);
    const measured = await meter.preview(next);
    // The spec's estimate counts the complete final request, cap included.
    const finalRequest = { ...next, maxOutputTokens: 64 };
    expect(measured.inputTokens).toBe(Buffer.byteLength(JSON.stringify(finalRequest), 'utf8') + 4096);
    expect(measured.outputReserve).toBe(64);
    expect(measured.fits).toBe(true);
  });
});

describe('PC-1b ruling 21 the preview is side-effect-free', () => {
  it('reports fits=false without reserving, persisting, exhausting or calling the provider', async () => {
    const persist = vi.fn(async () => {});
    const meter = new ModelBudget(budget({ contextWindowTokens: 900 }), persist, fixedCounter(700));
    const measured = await meter.preview(request('pc15-tight'));
    expect(measured.inputTokens).toBe(700);
    expect(measured.outputReserve).toBe(256);
    expect(measured.fits).toBe(false);
    expect(meter.entries).toEqual([]);
    expect(meter.exhausted).toBe(false);
    expect(persist).not.toHaveBeenCalled();

    let providerCalls = 0;
    const client: ModelClientPort = {
      async *stream() {
        providerCalls += 1;
        yield { schemaVersion: 1, requestId: 'pc15-tight', sequence: 1, type: 'completed', reason: 'final_answer' };
      },
    };
    await expect(drain(meter, client, request('pc15-tight'))).rejects.toBeInstanceOf(ContextCapacityExceeded);
    expect(providerCalls).toBe(0);
    expect(meter.entries).toEqual([]);
    expect(persist).not.toHaveBeenCalled();
  });
});
