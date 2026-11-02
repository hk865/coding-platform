/**
 * MR: the model retry loop itself (lead ruling 2026-11-02, MR-3/4/6).
 *
 * The real public Kernel RuntimeRunner is used with a scripted model; the retry
 * wait is the Runner's optional dependency, so these rows inject it and never
 * wait on the wall clock. MR-3 drives the real DeepSeek model client, so the
 * 401 classification and the no-retry rule are exercised together.
 */
import { expect, it } from 'vitest';
import { DeepSeekModelClient, RuntimeRunner, type ModelClientPort, type ModelEvent } from '../../vendor/coding-agent/dist/public-api.js';
import { ControlledExecutor, RecordingSink, baseRun, runnerInput } from '../helpers/orchestration-fixture.js';

function runner(model: ModelClientPort, retryDelay?: (delayMs: number, signal: AbortSignal) => Promise<void>) {
  return new RuntimeRunner({
    modelClient: model,
    toolExecutor: new ControlledExecutor({}),
    eventSinks: [new RecordingSink('mr-runner')],
    maxModelRetries: 4,
    ...(retryDelay === undefined ? {} : { retryDelay }),
  });
}

it('MR-6: a status-less connection failure is retryable and waits 2, 4, 8 and 16 seconds in order', async () => {
  let requests = 0;
  const client = new DeepSeekModelClient({
    model: 'mr-6',
    transport: {
      async create() {
        requests += 1;
        throw new Error('network unreachable');
      },
    },
  });
  const waits: number[] = [];
  const state = await runner(client, async delayMs => { waits.push(delayMs); })
    .run(runnerInput(baseRun('mr-6', 'turn-mr-6'), []), { signal: new AbortController().signal });
  expect(requests, 'the first request plus four retries').toBe(5);
  expect(waits).toEqual([2_000, 4_000, 8_000, 16_000]);
  expect(state.status).toBe('failed');
  expect(state.outcome).toMatchObject({ kind: 'failed', failure: { code: 'provider_request_failed' } });
}, 30_000);

it('MR-4: a cancel during the second wait stops before a third request and ends cancelled', async () => {
  let calls = 0;
  const model: ModelClientPort = {
    async *stream(request, options): AsyncIterable<ModelEvent> {
      options.signal.throwIfAborted();
      calls += 1;
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      yield { ...base, sequence: 1, type: 'error',
        error: { code: 'provider_request_failed', message: 'network unreachable', retryable: true } };
    },
  };
  const controller = new AbortController();
  const waits: number[] = [];
  const state = await runner(model, async (delayMs, signal) => {
    waits.push(delayMs);
    if (waits.length === 2) controller.abort('the operator stopped the Run');
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }).run(runnerInput(baseRun('mr-4', 'turn-mr-4'), []), { signal: controller.signal });
  expect(calls).toBe(2);
  expect(waits).toEqual([2_000, 4_000]);
  expect(state.status).toBe('cancelled');
  expect(state.outcome).toMatchObject({ kind: 'cancelled' });
}, 30_000);

it('MR-3: a 401 is not retried, one request is made and the failure class is unchanged', async () => {
  let requests = 0;
  const client = new DeepSeekModelClient({
    model: 'mr-3',
    transport: {
      async create() {
        requests += 1;
        throw { status: 401 };
      },
    },
  });
  const waits: number[] = [];
  const state = await runner(client, async delayMs => { waits.push(delayMs); })
    .run(runnerInput(baseRun('mr-3', 'turn-mr-3'), []), { signal: new AbortController().signal });
  expect(requests).toBe(1);
  expect(waits).toEqual([]);
  expect(state.status).toBe('failed');
  expect(state.outcome).toMatchObject({ kind: 'failed', failure: { category: 'model', code: 'authentication_failed' } });
}, 30_000);
