/** R4c Runtime bridge acceptance: real Kernel SQLite and a local scripted model.
 * WorkGraph admission is outside this narrow pass-through slice. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { ModelBudget, DEFAULT_RUNTIME_BUDGET } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';

const SESSION_ID = 'r4c-continuous-session';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'next-r4c-continuity-'));
  const databasePath = join(root, 'kernel.sqlite');
  await writeFile(join(root, 'note.txt'), 'A real workspace file.\n');
  const requests: kernel.ModelRequest[] = [];
  const client: kernel.ModelClientPort = {
    async *stream(request, options) {
      options.signal.throwIfAborted();
      requests.push(structuredClone(request));
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      yield { ...base, sequence: 1, type: 'text_delta', delta: `answer ${requests.length}` };
      yield { ...base, sequence: 2, type: 'completed', reason: 'final_answer' };
    },
  };
  const budget = { ...DEFAULT_RUNTIME_BUDGET, perResponseTokens: 128 };
  const options = (input: string): ObservedModelRunOptions => ({
    kernel, bound: { configuration: { revision: 'local-r4c', provider: 'deepseek',
      model: 'local-continuity-fixture', baseUrl: 'http://127.0.0.1' }, client },
    root, databasePath, sessionId: SESSION_ID, input, budget,
    meter: new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 100, method: 'model_tokenizer', tokenizer: 'labelled-r4c-fixture' }),
    }),
    readOnly: true, allowedTools: [], signal: new AbortController().signal,
    deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
  });
  const records = async () => {
    const store = await kernel.SqliteStores.open(databasePath);
    try {
      const all: kernel.SessionRecord[] = [];
      let after = 0;
      while (true) {
        const page = await store.read(SESSION_ID, after, 256, { signal: new AbortController().signal });
        all.push(...page.records);
        if (page.nextPosition === null) return all;
        after = page.records.at(-1)?.position ?? after;
      }
    } finally { await store.close(); }
  };
  return { options, requests, records, close: () => rm(root, { recursive: true, force: true }) };
}

function completedBoundary(records: readonly kernel.SessionRecord[]): number {
  const last = records.at(-1);
  expect(last).toMatchObject({ recordType: 'agent.event', payload: { event: { type: 'run.completed' } } });
  if (!last) throw Error('completed Kernel boundary was not recorded');
  return last.position;
}

describe('R4c Runtime forwards frozen public Kernel Session options', () => {
  it('continues from a fixed completed boundary and replays one execution identity without another model call or Turn', async () => {
    const fx = await fixture();
    try {
      const first = await runObservedModel(fx.options('first question'));
      expect(first.state.status).toBe('completed');
      const boundary = completedBoundary(await fx.records());
      const secondOptions = { ...fx.options('second question'),
        sessionContext: { version: 1 as const, mode: 'session_history' as const, throughPosition: boundary },
        executionIdentity: { runId: 'second-run', turnId: 'second-turn' } };
      const second = await runObservedModel(secondOptions);
      expect(second.state.status).toBe('completed');
      expect(fx.requests).toHaveLength(2);
      const users = fx.requests[1]!.messages.filter(message => message.role === 'user').map(message => message.content);
      expect(users).toEqual(['first question', 'second question']);
      expect(fx.requests[1]!.messages.some(message => message.role === 'assistant' && message.content === 'answer 1')).toBe(true);
      const beforeReplay = await fx.records();
      const replayed = await runObservedModel({ ...fx.options('second question'),
        sessionContext: { version: 1, mode: 'session_history', throughPosition: boundary },
        executionIdentity: { runId: 'second-run', turnId: 'second-turn' } });
      expect(replayed.state.status).toBe('completed');
      expect(fx.requests).toHaveLength(2);
      expect(await fx.records()).toEqual(beforeReplay);
      expect((await fx.records()).filter(record => record.recordType === 'turn.started')).toHaveLength(
        beforeReplay.filter(record => record.recordType === 'turn.started').length);
      await expect(runObservedModel({ ...fx.options('changed second question'),
        sessionContext: { version: 1, mode: 'session_history', throughPosition: boundary },
        executionIdentity: { runId: 'second-run', turnId: 'second-turn' } })).rejects.toMatchObject({ code: 'idempotency_conflict' });
      expect(fx.requests).toHaveLength(2);
    } finally { await fx.close(); }
  });

  it('uses the selected earlier boundary and keeps omitted options in current-turn mode', async () => {
    const fx = await fixture();
    try {
      await runObservedModel(fx.options('first question'));
      const firstBoundary = completedBoundary(await fx.records());
      await runObservedModel(fx.options('independent second question'));
      expect(fx.requests[1]!.messages.filter(message => message.role === 'user').map(message => message.content))
        .toEqual(['independent second question']);
      await runObservedModel({ ...fx.options('third question'),
        sessionContext: { version: 1, mode: 'session_history', throughPosition: firstBoundary },
        executionIdentity: { runId: 'third-run', turnId: 'third-turn' } });
      expect(fx.requests[2]!.messages.filter(message => message.role === 'user').map(message => message.content))
        .toEqual(['first question', 'third question']);
      expect(fx.requests[2]!.messages.filter(message => message.role === 'assistant').map(message => message.content))
        .toEqual(['answer 1']);
    } finally { await fx.close(); }
  });

  it('lets Kernel reject missing and unfinished history boundaries before a new model call', async () => {
    const fx = await fixture();
    try {
      const first = await runObservedModel(fx.options('first question'));
      expect(first.state.status).toBe('completed');
      const records = await fx.records();
      const turnStart = records.find(record => record.recordType === 'turn.started')?.position;
      expect(turnStart).toBeDefined();
      const originalCount = records.filter(record => record.recordType === 'turn.started').length;
      for (const [position, code] of [[turnStart!, 'conflict'], [completedBoundary(records) + 100, 'invalid_record']] as const) {
        await expect(runObservedModel({ ...fx.options('invalid history'),
          sessionContext: { version: 1, mode: 'session_history', throughPosition: position },
          executionIdentity: { runId: `invalid-run-${position}`, turnId: `invalid-turn-${position}` },
        })).rejects.toMatchObject({ code });
      }
      expect(fx.requests).toHaveLength(1);
      expect((await fx.records()).filter(record => record.recordType === 'turn.started')).toHaveLength(originalCount);
    } finally { await fx.close(); }
  });

  it('snapshots caller-owned option objects before any asynchronous work', async () => {
    const fx = await fixture();
    try {
      await runObservedModel(fx.options('first question'));
      const boundary = completedBoundary(await fx.records());
      const sessionContext: kernel.SessionContextMode = { version: 1, mode: 'session_history', throughPosition: boundary };
      const executionIdentity: kernel.ExecutionIdentity = { runId: 'snapshot-run', turnId: 'snapshot-turn' };
      const pending = runObservedModel({ ...fx.options('snapshot question'), sessionContext, executionIdentity });
      sessionContext.throughPosition = 9_999;
      executionIdentity.runId = 'mutated-run';
      const result = await pending;
      expect(result.state.status).toBe('completed');
      expect(fx.requests[1]!.messages.filter(message => message.role === 'user').map(message => message.content))
        .toEqual(['first question', 'snapshot question']);
      const records = await fx.records();
      expect(records.some(record => record.recordType === 'turn.started' && record.payload.run.runId === 'snapshot-run')).toBe(true);
    } finally { await fx.close(); }
  });
});
