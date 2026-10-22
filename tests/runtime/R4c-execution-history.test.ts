/** R4c.2a behavior acceptance: targeted raw execution history over the real
 * persisted Kernel Session. These cases are deliberately red while
 * createExecutionHistoryReader returns unsupported. Do not replace the real
 * Kernel store with a fake or weaken the assertions to make them pass.
 *
 * The Runs and their Kernel identities come from the shared real-Turn helper
 * (`tests/helpers/R4-history-turn-support.ts`): a real claim in a mapped
 * Session, started and finished by the real Runtime, with the identity read
 * back from the public `readExecution` locator. */
import { unlink } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { frozenPromptInputs } from './PC-frozen-prompt.js';
import type { ExecutionHistoryPort, KernelExecutionIdentity } from '../../src/core/agent-runtime/execution-history-contracts.js';
import type {
  SessionHistoryEntry, SessionHistoryRequest, SessionOperationsPort,
} from '../../src/core/agent-runtime/session-operations.js';
import { createR4HistoryWorld, type R4HistoryRun, type R4HistoryWorld } from '../helpers/R4-history-turn-support.js';

type HistoryOwner = Pick<SessionOperationsPort, 'readSessionHistory'>;

/**
 * T2-025 BLOCKED sub-case: the "best-effort observer is down" row drives the
 * production `runObservedModel` directly because the real Runtime passes a
 * no-op publish sink (`src/core/agent-runtime/execution-driver.ts:1253`), so no
 * public step can expose a failing observer. Its Turn therefore still carries a
 * test-declared identity; do not move this path into the shared helper. The
 * W2b-53 mixed run/turn row keeps its w2-base declared Turns on the same path.
 */
function scriptedClient(): kernel.ModelClientPort {
  const requests: kernel.ModelRequest[] = [];
  return {
    async *stream(request, options) {
      options.signal.throwIfAborted();
      requests.push(structuredClone(request));
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      yield { ...base, sequence: 1, type: 'text_delta', delta: `answer ${requests.length}` };
      yield { ...base, sequence: 2, type: 'completed', reason: 'final_answer' };
    },
  };
}

type TurnInput = {
  directory: string; databasePath: string; sessionId: string; input: string;
  identity: KernelExecutionIdentity; client: kernel.ModelClientPort;
  publish?: ObservedModelRunOptions['publish']; signal?: AbortSignal;
};

let promptInputs: Promise<ObservedModelRunOptions['prompt']> | undefined;
const promptOnce = () => (promptInputs ??= frozenPromptInputs());

async function runTurn(turn: TurnInput) {
  const budget = { ...DEFAULT_RUNTIME_BUDGET, perResponseTokens: 128 };
  return runObservedModel({
    kernel,
    bound: { configuration: { revision: 'local-r4c-history', provider: 'deepseek',
      model: 'local-history-fixture', baseUrl: 'http://127.0.0.1' }, client: turn.client },
    root: turn.directory, databasePath: turn.databasePath, sessionId: turn.sessionId, input: turn.input,
    budget, taskBudget: { tokenBudget: null, deadline: null },
    executionIdentity: turn.identity, signal: turn.signal ?? new AbortController().signal,
    meter: new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 100, method: 'model_tokenizer', tokenizer: 'r4c-history-fixture' }),
    }),
    readOnly: true, allowedTools: [], deniedPrefixes: [], processSandboxOptions: {},
    publish: turn.publish ?? (async () => {}),
    prompt: await promptOnce(),
    bodies: new RawArtifactBodyStore(),
    origin: { kind: 'run', owner: { aggregateType: 'Run', projectId: 'r4c-history-project',
      goalId: 'r4c-history-goal', runId: 'r4c-history-run' } },
    promptFacts: new Map(),
  });
}

/** Reads the Kernel store directly (F7). Only the two BLOCKED parts kept in their
 * old form use it: the observer-down row (T2-025) and the mixed run/turn row
 * (W2b-53, R-20). Every other row takes its evidence from the public history read. */
async function rawRecords(databasePath: string, sessionId: string): Promise<kernel.SessionRecord[]> {
  const store = await kernel.SqliteStores.open(databasePath);
  try {
    const all: kernel.SessionRecord[] = [];
    let after = 0;
    while (true) {
      const page = await store.read(sessionId, after, 256, { signal: new AbortController().signal });
      all.push(...page.records);
      if (page.nextPosition === null) return all;
      after = page.records.at(-1)?.position ?? after;
    }
  } finally { await store.close(); }
}

function positionsOf(records: readonly kernel.SessionRecord[], identity: KernelExecutionIdentity): number[] {
  return records.filter(record => record.recordType === 'turn.started'
    ? record.payload.run.runId === identity.runId && record.payload.run.turn.turnId === identity.turnId
    : record.recordType === 'agent.event'
      ? record.payload.event.meta.runId === identity.runId && record.payload.event.meta.turnId === identity.turnId
      : false).map(record => record.position);
}

function spyOn(real: HistoryOwner) {
  const requests: SessionHistoryRequest[] = [];
  const history: HistoryOwner = {
    async readSessionHistory(context, request) {
      requests.push(structuredClone(request));
      return real.readSessionHistory(context, request);
    },
  };
  return { history, requests };
}

/** Positions of the public raw history entries that belong to one execution, read
 * from the inline Kernel record each public entry carries. Positions stay as the
 * public read returned them and are only compared between public reads (R-16). */
function entryPositionsOf(entries: readonly SessionHistoryEntry[], identity: KernelExecutionIdentity): number[] {
  return entries.filter(entry => {
    if (!('text' in entry.body)) return false;
    const record = JSON.parse(entry.body.text) as {
      recordType: string;
      payload: { run?: { runId?: string; turn?: { turnId?: string } };
        event?: { meta?: { runId?: string; turnId?: string } } };
    };
    return record.recordType === 'turn.started'
      ? record.payload.run?.runId === identity.runId && record.payload.run?.turn?.turnId === identity.turnId
      : record.recordType === 'agent.event'
        ? record.payload.event?.meta?.runId === identity.runId && record.payload.event?.meta?.turnId === identity.turnId
        : false;
  }).map(entry => entry.source.position);
}

type RefusalPrior = { world: R4HistoryWorld; run: R4HistoryRun; reader: ExecutionHistoryPort; cursor: string };

/**
 * R-18 frame for one refused execution history read. Prior state (A1): one real
 * Run in Session a (`world.sessions.first`, shared real-Turn helper) and the reader
 * cursor of a public one-record reader page. The row sends ONE refused input; the
 * public raw history reads of both mapped Sessions, before and after, show that the
 * refusal changed nothing.
 *
 * W2c-03: the Session history owner below refuses some of these inputs as well, so
 * the code alone does not show that the reader's own check refused them. A row that
 * passes `noLowerRequest` gives the reader the real history through `spyOn`; once the
 * cursor is set up the recorded requests are cleared, and the refused call must make
 * 0 lower requests.
 */
async function expectRefusedWithoutChange(code: 'invalid' | 'forbidden',
  refuse: (prior: RefusalPrior) => Promise<unknown>,
  options: { noLowerRequest?: true } = {}): Promise<void> {
  const world = await createR4HistoryWorld();
  try {
    const run = await world.run({ text: 'cursor' });
    const spy = options.noLowerRequest === true ? spyOn(world.history) : null;
    const reader = createExecutionHistoryReader({ history: spy?.history ?? world.history });
    const opened = await reader.readExecutionHistory(world.ctx, { sessionRef: run.sessionRef,
      executionIdentity: run.identity, afterCursor: null, throughCursor: null, limit: 1 });
    expect(opened.status).toBe('ready');
    if (opened.status !== 'ready') return;
    const cursor = opened.value.nextCursor;
    expect(cursor).not.toBeNull();
    if (cursor === null) return;
    spy?.requests.splice(0);
    const histories = () => Promise.all([world.sessions.first, world.sessions.second].map(sessionRef =>
      world.history.readSessionHistory(world.ctx, { sessionRef, afterCursor: null, throughCursor: null, limit: 200 })));
    const before = await histories();
    expect(before.map(read => read.status)).toEqual(['ready', 'ready']);
    expect(await refuse({ world, run, reader, cursor })).toMatchObject({ status: 'rejected', code });
    if (spy !== null) expect(spy.requests).toHaveLength(0);
    expect(await histories()).toEqual(before);
  } finally { await world.close(); }
}

describe('R4c.2a targeted raw execution history', () => {
  it('returns only the requested execution identity and preserves the original evidence and basis', async () => {
    const world = await createR4HistoryWorld();
    try {
      const firstRun = await world.run({ text: 'first question' });
      const secondRun = await world.run({ text: 'second question' });
      const first = firstRun.identity;
      const second = secondRun.identity;
      const sessionRef = firstRun.sessionRef;
      // The evidence is the public raw Session history, read whole (W2b-52).
      const raw = await world.history.readSessionHistory(world.ctx, { sessionRef, afterCursor: null,
        throughCursor: null, limit: 200 });
      expect(raw.status).toBe('ready');
      if (raw.status !== 'ready') return;
      // Hand count. A real Run with one scripted text reply (no usage, no tool call)
      // appends 5 Kernel records: turn.started, then the agent.events run.started,
      // model.request_started, assistant.message_completed and run.completed. The
      // Session holds session.created + 2 Runs x 5 = 1 + 10 = 11 records.
      expect(raw.value.items).toHaveLength(11);
      expect(raw.value.nextCursor).toBeNull();
      const firstPositions = entryPositionsOf(raw.value.items, first);
      const secondPositions = entryPositionsOf(raw.value.items, second);
      expect(firstPositions).toHaveLength(5);
      expect(secondPositions).toHaveLength(5);

      const reader = createExecutionHistoryReader({ history: world.history });
      const page = await reader.readExecutionHistory(world.ctx, { sessionRef, executionIdentity: first,
        afterCursor: null, throughCursor: null, limit: 200 });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.executionIdentity).toEqual(first);
      expect(page.value.items.map(item => item.source.position)).toEqual(firstPositions);
      expect(page.value.items.some(item => item.kind === 'session_created')).toBe(false);
      expect(page.value.items.some(item => secondPositions.includes(item.source.position))).toBe(false);
      // One page of limit 200 scans the whole Session: the 11 records counted above.
      expect(page.value.scannedCount).toBe(11);
      expect(page.value.basis).toMatchObject({ kind: 'session',
        ref: { projectId: world.projectId, sessionId: sessionRef.sessionId } });
      expect(page.value.basis).toEqual(raw.value.basis);
      const rawByPosition = new Map(raw.value.items.map(item => [item.source.position, item] as const));
      for (const item of page.value.items) {
        const original: SessionHistoryEntry | undefined = rawByPosition.get(item.source.position);
        expect(original).toBeDefined();
        expect(item).toEqual(original);
      }
    } finally { await world.close(); }
  });

  /**
   * W2b-53 BLOCKED sub-part (R-20, unreachable), kept in its w2-base form
   * (`w2-base:tests/runtime/R4c-execution-history.test.ts:155-160`, `:176-181`): a
   * run/turn pair that mixes two executions. No public step returns such a pair, and
   * the reader answers it with an empty ready page, not a refusal (it matches both
   * fields, `src/core/agent-runtime/observation-recovery.ts:235-240`), so it is
   * neither a returned identity nor an A6 row. As at w2-base, its two Turns carry
   * test-declared identities (the observer-down path) and the count is read from the
   * Kernel store. T2-025 stays partial.
   */
  it('answers a run/turn pair that mixes two executions with an empty ready page (BLOCKED, w2-base form)', async () => {
    const world = await createR4HistoryWorld();
    try {
      const sessionRef = world.sessions.first;
      const client = scriptedClient();
      const first: KernelExecutionIdentity = { runId: 'run-first', turnId: 'turn-first' };
      const second: KernelExecutionIdentity = { runId: 'run-second', turnId: 'turn-second' };
      const sessionId = (await world.sessionKernel(sessionRef)).kernelSessionId;
      await runTurn({ directory: world.directory, databasePath: world.databasePath, sessionId,
        input: 'first question', identity: first, client });
      await runTurn({ directory: world.directory, databasePath: world.databasePath, sessionId,
        input: 'second question', identity: second, client });
      const records = await rawRecords(world.databasePath, sessionId);
      const reader = createExecutionHistoryReader({ history: world.history });
      for (const mismatched of [{ runId: first.runId, turnId: second.turnId },
        { runId: second.runId, turnId: first.turnId }]) {
        expect(await reader.readExecutionHistory(world.ctx, { sessionRef,
          executionIdentity: mismatched, afterCursor: null, throughCursor: null, limit: 200 }))
          .toMatchObject({ status: 'ready', value: { items: [], scannedCount: records.length } });
      }
    } finally { await world.close(); }
  });

  it('freezes the raw upper bound and advances by the underlying raw cursor, not the last match cursor', async () => {
    const world = await createR4HistoryWorld();
    try {
      const firstRun = await world.run({ text: 'a' });
      const first = firstRun.identity;
      const sessionRef = firstRun.sessionRef;
      // The evidence is the public raw Session history after the first Run (W2b-52).
      const before = await world.history.readSessionHistory(world.ctx, { sessionRef, afterCursor: null,
        throughCursor: null, limit: 200 });
      expect(before.status).toBe('ready');
      if (before.status !== 'ready') return;
      // Hand count: session.created + the first Run's 5 records (turn.started,
      // run.started, model.request_started, assistant.message_completed,
      // run.completed) = 1 + 5 = 6.
      expect(before.value.items).toHaveLength(6);
      const firstPositions = entryPositionsOf(before.value.items, first);
      expect(firstPositions).toHaveLength(5);
      const lastFirst = firstPositions.at(-1);
      expect(lastFirst).toBeDefined();
      if (lastFirst === undefined) return;

      const { history, requests } = spyOn(world.history);
      const reader = createExecutionHistoryReader({ history });
      const partial = await reader.readExecutionHistory(world.ctx, { sessionRef, executionIdentity: first,
        afterCursor: null, throughCursor: null, limit: 1 });
      expect(partial.status).toBe('ready');
      if (partial.status !== 'ready') return;
      expect(partial.value.items).toEqual([]);
      expect(partial.value.nextCursor).not.toBeNull();
      expect(requests).toHaveLength(1);

      await world.run({ text: 'b' });
      const continued = await reader.readExecutionHistory(world.ctx, { sessionRef, executionIdentity: first,
        afterCursor: partial.value.nextCursor, throughCursor: null, limit: 200 });
      expect(continued.status).toBe('ready');
      if (continued.status !== 'ready') return;
      expect(continued.value.items.map(item => item.source.position)).toEqual(firstPositions);
      // The one-record page scanned session.created and froze the upper bound at the
      // Session tail it saw (6 records), so the continuation scans 6 - 1 = 5 records,
      // all of them the first Run's; the second Run's 5 lie above the bound.
      expect(continued.value.scannedCount).toBe(5);
      expect(continued.value.items.every(item => item.source.position <= lastFirst)).toBe(true);
      expect(requests).toHaveLength(2);

      // A raw page of 7 records: session.created, the first Run's 5 and the first
      // record of the second Run (1 + 5 + 1 = 7). The Session now holds 1 + 5 + 5 = 11,
      // so the page has a raw continuation and its last record is not a match.
      const throughFirstRunAndOne = 7;
      const underlying = await world.history.readSessionHistory(world.ctx, { sessionRef, afterCursor: null,
        throughCursor: null, limit: throughFirstRunAndOne });
      expect(underlying.status).toBe('ready');
      if (underlying.status !== 'ready') return;
      expect(underlying.value.nextCursor).not.toBeNull();
      const rawTail = await reader.readExecutionHistory(world.ctx, { sessionRef, executionIdentity: first,
        afterCursor: null, throughCursor: null, limit: throughFirstRunAndOne });
      expect(rawTail.status).toBe('ready');
      if (rawTail.status !== 'ready') return;
      expect(rawTail.value.nextCursor).not.toBeNull();
      expect(rawTail.value.items.map(item => item.source.position)).toEqual(firstPositions);
      await reader.readExecutionHistory(world.ctx, { sessionRef, executionIdentity: first,
        afterCursor: rawTail.value.nextCursor, throughCursor: null, limit: 200 });
      expect(requests.at(-1)?.afterCursor).toBe(underlying.value.nextCursor);
    } finally { await world.close(); }
  });

  describe('rejects: cursors that change the Session or execution target, malformed cursors and invalid limits', () => {
    it('rejects the cursor when another authorized Host principal reads it', () =>
      expectRefusedWithoutChange('invalid', ({ world, run, reader, cursor }) => {
        const changedActor = { kind: 'human' as const, id: 'another-authorized-host' };
        const otherHost: CoreCallContext = { ...world.ctx, principal: { kind: 'host', actor: changedActor },
          materialReader: { kind: 'host', projectId: world.projectId, workspaceId: world.workspaceId, actor: changedActor } };
        return reader.readExecutionHistory(otherHost, { sessionRef: run.sessionRef, executionIdentity: run.identity,
          afterCursor: cursor, throughCursor: null, limit: 200 });
      }));

    it('rejects the cursor for another runId', () =>
      expectRefusedWithoutChange('invalid', ({ world, run, reader, cursor }) =>
        reader.readExecutionHistory(world.ctx, { sessionRef: run.sessionRef,
          executionIdentity: { runId: 'run-other', turnId: run.identity.turnId }, afterCursor: cursor, throughCursor: null, limit: 200 })));

    it('rejects the cursor for another turnId', () =>
      expectRefusedWithoutChange('invalid', ({ world, run, reader, cursor }) =>
        reader.readExecutionHistory(world.ctx, { sessionRef: run.sessionRef,
          executionIdentity: { runId: run.identity.runId, turnId: 'turn-other' }, afterCursor: cursor, throughCursor: null, limit: 200 })));

    it('rejects the cursor on another Session', () =>
      expectRefusedWithoutChange('invalid', ({ world, run, reader, cursor }) =>
        reader.readExecutionHistory(world.ctx, { sessionRef: world.sessions.second, executionIdentity: run.identity,
          afterCursor: cursor, throughCursor: null, limit: 200 }), { noLowerRequest: true }));

    it('rejects a malformed cursor', () =>
      expectRefusedWithoutChange('invalid', ({ world, run, reader }) =>
        reader.readExecutionHistory(world.ctx, { sessionRef: run.sessionRef, executionIdentity: run.identity,
          afterCursor: 'not-a-reader-cursor', throughCursor: null, limit: 200 })));

    it('rejects a raw Session history cursor in place of a reader cursor', () =>
      expectRefusedWithoutChange('invalid', async ({ world, run, reader }) => {
        const bottom = await world.history.readSessionHistory(world.ctx, { sessionRef: run.sessionRef, afterCursor: null,
          throughCursor: null, limit: 1 });
        expect(bottom.status).toBe('ready');
        if (bottom.status !== 'ready') return bottom;
        expect(bottom.value.nextCursor).not.toBeNull();
        return reader.readExecutionHistory(world.ctx, { sessionRef: run.sessionRef, executionIdentity: run.identity,
          afterCursor: bottom.value.nextCursor, throughCursor: null, limit: 200 });
      }));

    it.each([0, 201, 1.5])('rejects limit %s', limit =>
      expectRefusedWithoutChange('invalid', ({ world, run, reader }) =>
        reader.readExecutionHistory(world.ctx, { sessionRef: run.sessionRef, executionIdentity: run.identity,
          afterCursor: null, throughCursor: null, limit }), { noLowerRequest: true }));
  });

  it('passes the original boundary through and propagates owner rejections instead of an empty page', async () => {
    const world = await createR4HistoryWorld();
    try {
      const run = await world.run({ text: 'boundary' });
      const identity = run.identity;
      const full = await world.history.readSessionHistory(world.ctx, { sessionRef: run.sessionRef,
        afterCursor: null, throughCursor: null, limit: 200 });
      expect(full.status).toBe('ready');
      if (full.status !== 'ready') return;
      expect(full.value.basis.kind).toBe('session');
      if (full.value.basis.kind !== 'session') return;
      const through = full.value.basis.cursor;

      const { history, requests } = spyOn(world.history);
      const reader = createExecutionHistoryReader({ history });
      const read = await reader.readExecutionHistory(world.ctx, { sessionRef: run.sessionRef, executionIdentity: identity,
        afterCursor: null, throughCursor: through, limit: 200 });
      expect(read.status).toBe('ready');
      expect(requests).toHaveLength(1);
      expect(requests[0]?.afterCursor).toBeNull();
      expect(requests[0]?.throughCursor).toBe(through);

      // Another workspace's forbidden refusal is the R-18 row below.
      await unlink(world.databasePath);
      expect(await reader.readExecutionHistory(world.ctx, { sessionRef: run.sessionRef, executionIdentity: identity,
        afterCursor: null, throughCursor: null, limit: 200 })).toMatchObject({ status: 'rejected', code: 'not_found' });

      const notReady = createExecutionHistoryReader({ history: {
        async readSessionHistory() {
          return { status: 'not_ready' as const, observed: null,
            required: { kind: 'session' as const, ref: run.sessionRef, cursor: 'owner-watermark' } };
        },
      } });
      expect(await notReady.readExecutionHistory(world.ctx, { sessionRef: run.sessionRef, executionIdentity: identity,
        afterCursor: null, throughCursor: null, limit: 200 })).toMatchObject({ status: 'not_ready' });
    } finally { await world.close(); }
  });

  describe('rejects: an owner refusal is propagated instead of an empty page', () => {
    it('rejects a read from another workspace as forbidden', () =>
      expectRefusedWithoutChange('forbidden', ({ world, run, reader }) => {
        const otherCtx: CoreCallContext = { ...world.ctx, workspaceId: 'workspace-b',
          materialReader: { kind: 'host', projectId: world.projectId, workspaceId: 'workspace-b', actor: world.actor } };
        return reader.readExecutionHistory(otherCtx, { sessionRef: run.sessionRef, executionIdentity: run.identity,
          afterCursor: null, throughCursor: null, limit: 200 });
      }));
  });

  it('keeps the original signal and rejects a page cancelled before or while awaiting the owner', async () => {
    const world = await createR4HistoryWorld();
    try {
      const run = await world.run({ text: 'cancel' });
      const identity = run.identity;

      const before = new AbortController();
      before.abort();
      const reader = createExecutionHistoryReader({ history: world.history });
      expect(await reader.readExecutionHistory({ ...world.ctx, signal: before.signal },
        { sessionRef: run.sessionRef, executionIdentity: identity, afterCursor: null, throughCursor: null, limit: 200 }))
        .toMatchObject({ status: 'rejected', code: 'cancelled' });

      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let ownerRead!: () => void;
      const reachedOwner = new Promise<void>(resolve => { ownerRead = resolve; });
      const delayed: HistoryOwner = {
        async readSessionHistory(context, request) {
          const page = await world.history.readSessionHistory(context, request);
          ownerRead();
          await gate;
          return page;
        },
      };
      const gated = createExecutionHistoryReader({ history: delayed });
      const controller = new AbortController();
      const pending = gated.readExecutionHistory({ ...world.ctx, signal: controller.signal },
        { sessionRef: run.sessionRef, executionIdentity: identity, afterCursor: null, throughCursor: null, limit: 200 });
      const firstResult = await Promise.race([reachedOwner.then(() => 'owner' as const), pending]);
      if (firstResult !== 'owner') {
        release();
        expect(firstResult).toMatchObject({ status: 'rejected', code: 'cancelled' });
        return;
      }
      controller.abort();
      release();
      expect(await pending).toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await world.close(); }
  });

  it('owns the request before the first await so caller mutation cannot retarget the execution read', async () => {
    const world = await createR4HistoryWorld();
    try {
      const a = await world.run({ text: 'a' });
      const b = world.sessions.second;
      const identityA = a.identity;

      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const seen: SessionHistoryRequest[] = [];
      const delayed: HistoryOwner = {
        async readSessionHistory(context, request) {
          seen.push(structuredClone(request));
          await gate;
          expect(context.principal).toEqual(world.ctx.principal);
          expect(context.materialReader).toEqual(world.ctx.materialReader);
          expect(context.signal).toBe(world.ctx.signal);
          return world.history.readSessionHistory(context, request);
        },
      };
      const reader = createExecutionHistoryReader({ history: delayed });
      const request = { sessionRef: { projectId: world.projectId, sessionId: a.sessionRef.sessionId },
        executionIdentity: { ...identityA }, afterCursor: null, throughCursor: null, limit: 200 };
      const ownedCtx: CoreCallContext = { ...world.ctx, principal: structuredClone(world.ctx.principal),
        materialReader: structuredClone(world.ctx.materialReader) };
      const pending = reader.readExecutionHistory(ownedCtx, request);
      if (ownedCtx.principal.kind === 'host') ownedCtx.principal.actor.id = 'mutated-actor';
      ownedCtx.workspaceId = 'mutated-workspace';
      request.executionIdentity.runId = 'run-b';
      request.executionIdentity.turnId = 'turn-b';
      request.sessionRef.sessionId = b.sessionId;
      request.limit = 1;
      release();
      const result = await pending;
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.value.executionIdentity).toEqual(identityA);
      expect(result.value.items.length).toBeGreaterThan(0);
      expect(result.value.items.every(item => item.source.kernelSessionId === a.kernel.kernelSessionId)).toBe(true);
      expect(seen[0]).toMatchObject({ limit: 200, afterCursor: null, throughCursor: null });
      expect(seen[0]?.sessionRef.sessionId).toBe(a.sessionRef.sessionId);
    } finally { await world.close(); }
  });

  it('rejects damaged inline evidence, inconsistent envelopes and unsupported external bodies', async () => {
    const world = await createR4HistoryWorld();
    try {
      const session = world.sessions.first;
      const identity = { runId: 'absent', turnId: 'absent' };
      const request = { sessionRef: session, executionIdentity: identity,
        afterCursor: null, throughCursor: null, limit: 10 };
      for (const [code, mutate] of [
        ['unavailable', (_entry: SessionHistoryEntry) => null as unknown as SessionHistoryEntry],
        ['unavailable', (entry: SessionHistoryEntry) => ({ ...entry, source: undefined } as unknown as SessionHistoryEntry)],
        ['unavailable', (entry: SessionHistoryEntry) => ({ ...entry, body: null } as unknown as SessionHistoryEntry)],
        ['unavailable', (entry: SessionHistoryEntry) => ({ ...entry,
          body: { encoding: 'kernel_session_record_json', text: 1 } } as unknown as SessionHistoryEntry)],
        ['unavailable', (entry: SessionHistoryEntry) => ({ ...entry,
          body: { encoding: 'kernel_session_record_json' as const, text: '{' } })],
        ['unavailable', (entry: SessionHistoryEntry) => ({ ...entry, recordId: 'wrong-record' })],
        ['unavailable', (entry: SessionHistoryEntry) => ({ ...entry,
          source: { ...entry.source, position: entry.source.position + 1 } })],
        ['unavailable', (entry: SessionHistoryEntry) => ({ ...entry,
          source: { ...entry.source, kernelSessionId: 'wrong-kernel-session' } })],
        ['unsupported', (entry: SessionHistoryEntry) => ({ ...entry,
          body: { kind: 'artifact' as const, contentType: 'application/json', digest: 'a'.repeat(64), sizeBytes: 10,
            source: { kind: 'workspace' as const, refId: world.workspaceId, revision: '1' } } })],
      ] as const) {
        const reader = createExecutionHistoryReader({ history: {
          async readSessionHistory(context, input) {
            const result = await world.history.readSessionHistory(context, input);
            if (result.status !== 'ready') return result;
            return { ...result, value: { ...result.value, items: result.value.items.map(mutate) } };
          },
        } });
        expect(await reader.readExecutionHistory(world.ctx, request)).toMatchObject({ status: 'rejected', code });
      }
    } finally { await world.close(); }
  });

  it('still reads persisted Kernel evidence when the best-effort observer is down', async () => {
    const world = await createR4HistoryWorld();
    try {
      const sessionId = (await world.sessionKernel(world.sessions.first)).kernelSessionId;
      const client = scriptedClient();
      const identity: KernelExecutionIdentity = { runId: 'run-observed', turnId: 'turn-observed' };
      let failures = 0;
      const result = await runTurn({ directory: world.directory, databasePath: world.databasePath, sessionId,
        input: 'observed', identity, client,
        publish: async () => { failures += 1; throw new Error('observer sink down'); } });
      expect(result.state.status).toBe('completed');
      expect(failures).toBeGreaterThan(0);

      const persisted = positionsOf(await rawRecords(world.databasePath, sessionId), identity);
      expect(persisted.length).toBeGreaterThanOrEqual(2);

      const reader = createExecutionHistoryReader({ history: world.history });
      const page = await reader.readExecutionHistory(world.ctx, { sessionRef: world.sessions.first, executionIdentity: identity,
        afterCursor: null, throughCursor: null, limit: 200 });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.items.map(item => item.source.position)).toEqual(persisted);
    } finally { await world.close(); }
  });
});
