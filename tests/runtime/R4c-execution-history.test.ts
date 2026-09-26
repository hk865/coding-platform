/** R4c.2a behavior acceptance: targeted raw execution history over the real
 * persisted Kernel Session. These cases are deliberately red while
 * createExecutionHistoryReader returns unsupported. Do not replace the real
 * Kernel store with a fake or weaken the assertions to make them pass. */
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import type { SessionHistoryEntry, SessionHistoryRequest, SessionOperationsPort } from '../../src/core/agent-runtime/session-operations.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import type { KernelExecutionIdentity } from '../../src/core/agent-runtime/execution-history-contracts.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'history-project';
const workspaceId = 'workspace-a';
const actor = { kind: 'human' as const, id: 'history-operator' };
const ctx: CoreCallContext = {
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor },
  signal: new AbortController().signal,
};
const workspace = { projectId, workspaceId };
const role = { kind: 'legacy_template' as const, templateId: 'implementer', templateRevision: '1' };
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    { eventType: 'TrustedScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: SESSION_RECORD_SCHEMAS.lookups ?? [],
};
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

type HistoryOwner = Pick<SessionOperationsPort, 'readSessionHistory'>;

async function open() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'next-r4c-history-'));
  directories.push(root);
  const backend = createSqliteRecordBackend({ schemas, path: path.join(root, 'ledger.sqlite') });
  const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
  const workspaceSnapshot: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
  const seedEvent = { eventId: 'history-scope-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
    occurredAt: at, json: JSON.stringify({ eventId: 'history-scope-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at }) };
  const seed: PreparedCommit = { identityKey: 'history-scope-seed', fingerprint: 'history-scope-seed',
    guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
      { refKey: canonicalRefKey(workspaceSnapshot.ref), expectedRevision: null }],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspaceSnapshot)],
    claims: [], indexGuards: [], indexChanges: [], events: [seedEvent] };
  const seeded = await backend.records.commit(seed);
  if (seeded.status !== 'committed') throw Error(`scope seed failed: ${seeded.reason}`);
  const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const databasePath = path.join(root, 'kernel.sqlite');
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'workspace-kernel', storeKey: 'workspace-key', workspace, databasePath,
  }] });
  const runtime = createSessionOperations({ sessions, kernelStores });
  return { backend, runtime, kernelStores, root, databasePath };
}

async function createMappedSession(runtime: SessionOperationsPort, requestId: string) {
  const created = await runtime.createSession(ctx, {
    workspace, role, recommendedRefs: [], initialLinks: [], meta: { requestId, expected: [] },
  });
  if (created.status !== 'completed') throw Error(`Session creation failed: ${JSON.stringify(created)}`);
  return created.value;
}

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
  root: string; databasePath: string; sessionId: string; input: string;
  identity: KernelExecutionIdentity; client: kernel.ModelClientPort;
  publish?: ObservedModelRunOptions['publish']; signal?: AbortSignal;
};

async function runTurn(turn: TurnInput) {
  const budget = { ...DEFAULT_RUNTIME_BUDGET, perResponseTokens: 128 };
  return runObservedModel({
    kernel,
    bound: { configuration: { revision: 'local-r4c-history', provider: 'deepseek',
      model: 'local-history-fixture', baseUrl: 'http://127.0.0.1' }, client: turn.client },
    root: turn.root, databasePath: turn.databasePath, sessionId: turn.sessionId, input: turn.input,
    budget, executionIdentity: turn.identity, signal: turn.signal ?? new AbortController().signal,
    meter: new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 100, method: 'model_tokenizer', tokenizer: 'r4c-history-fixture' }),
    }),
    readOnly: true, allowedTools: [], deniedPrefixes: [], processSandboxOptions: {},
    publish: turn.publish ?? (async () => {}),
  });
}

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

describe('R4c.2a targeted raw execution history', () => {
  it('returns only the requested execution identity and preserves the original evidence and basis', async () => {
    const fx = await open();
    try {
      const created = await createMappedSession(fx.runtime, 'history-chain');
      const client = scriptedClient();
      const first: KernelExecutionIdentity = { runId: 'run-first', turnId: 'turn-first' };
      const second: KernelExecutionIdentity = { runId: 'run-second', turnId: 'turn-second' };
      const sessionId = created.kernel.kernelSessionId;
      await runTurn({ ...fx, sessionId, input: 'first question', identity: first, client });
      await runTurn({ ...fx, sessionId, input: 'second question', identity: second, client });
      const records = await rawRecords(fx.databasePath, sessionId);
      const firstPositions = positionsOf(records, first);
      const secondPositions = positionsOf(records, second);
      expect(firstPositions.length).toBeGreaterThanOrEqual(2);
      expect(secondPositions.length).toBeGreaterThanOrEqual(2);

      const reader = createExecutionHistoryReader({ history: fx.runtime });
      const page = await reader.readExecutionHistory(ctx, { sessionRef: created.ref, executionIdentity: first,
        afterCursor: null, throughCursor: null, limit: 200 });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.executionIdentity).toEqual(first);
      expect(page.value.items.map(item => item.source.position)).toEqual(firstPositions);
      expect(page.value.items.some(item => item.kind === 'session_created')).toBe(false);
      expect(page.value.items.some(item => secondPositions.includes(item.source.position))).toBe(false);
      expect(page.value.scannedCount).toBe(records.length);
      for (const mismatched of [{ runId: first.runId, turnId: second.turnId },
        { runId: second.runId, turnId: first.turnId }]) {
        expect(await reader.readExecutionHistory(ctx, { sessionRef: created.ref,
          executionIdentity: mismatched, afterCursor: null, throughCursor: null, limit: 200 }))
          .toMatchObject({ status: 'ready', value: { items: [], scannedCount: records.length } });
      }
      expect(page.value.basis).toMatchObject({ kind: 'session', ref: { projectId, sessionId: created.ref.sessionId } });

      const raw = await fx.runtime.readSessionHistory(ctx, { sessionRef: created.ref, afterCursor: null,
        throughCursor: null, limit: 200 });
      expect(raw.status).toBe('ready');
      if (raw.status !== 'ready') return;
      expect(page.value.basis).toEqual(raw.value.basis);
      const rawByPosition = new Map(raw.value.items.map(item => [item.source.position, item] as const));
      for (const item of page.value.items) {
        const original: SessionHistoryEntry | undefined = rawByPosition.get(item.source.position);
        expect(original).toBeDefined();
        expect(item).toEqual(original);
      }
    } finally { await fx.backend.close(); }
  });

  it('freezes the raw upper bound and advances by the underlying raw cursor, not the last match cursor', async () => {
    const fx = await open();
    try {
      const created = await createMappedSession(fx.runtime, 'history-upper');
      const client = scriptedClient();
      const first: KernelExecutionIdentity = { runId: 'run-a', turnId: 'turn-a' };
      const sessionId = created.kernel.kernelSessionId;
      await runTurn({ ...fx, sessionId, input: 'a', identity: first, client });
      const firstPositions = positionsOf(await rawRecords(fx.databasePath, sessionId), first);
      const lastFirst = firstPositions.at(-1);
      expect(lastFirst).toBeDefined();
      if (lastFirst === undefined) return;

      const { history, requests } = spyOn(fx.runtime);
      const reader = createExecutionHistoryReader({ history });
      const partial = await reader.readExecutionHistory(ctx, { sessionRef: created.ref, executionIdentity: first,
        afterCursor: null, throughCursor: null, limit: 1 });
      expect(partial.status).toBe('ready');
      if (partial.status !== 'ready') return;
      expect(partial.value.items).toEqual([]);
      expect(partial.value.nextCursor).not.toBeNull();
      expect(requests).toHaveLength(1);

      await runTurn({ ...fx, sessionId, input: 'b', identity: { runId: 'run-b', turnId: 'turn-b' }, client });
      const continued = await reader.readExecutionHistory(ctx, { sessionRef: created.ref, executionIdentity: first,
        afterCursor: partial.value.nextCursor, throughCursor: null, limit: 200 });
      expect(continued.status).toBe('ready');
      if (continued.status !== 'ready') return;
      expect(continued.value.items.map(item => item.source.position)).toEqual(firstPositions);
      expect(continued.value.scannedCount).toBe(firstPositions.length);
      expect(continued.value.items.every(item => item.source.position <= lastFirst)).toBe(true);
      expect(requests).toHaveLength(2);

      const underlying = await fx.runtime.readSessionHistory(ctx, { sessionRef: created.ref, afterCursor: null,
        throughCursor: null, limit: lastFirst + 1 });
      expect(underlying.status).toBe('ready');
      if (underlying.status !== 'ready') return;
      expect(underlying.value.nextCursor).not.toBeNull();
      const rawTail = await reader.readExecutionHistory(ctx, { sessionRef: created.ref, executionIdentity: first,
        afterCursor: null, throughCursor: null, limit: lastFirst + 1 });
      expect(rawTail.status).toBe('ready');
      if (rawTail.status !== 'ready') return;
      expect(rawTail.value.nextCursor).not.toBeNull();
      expect(rawTail.value.items.map(item => item.source.position)).toEqual(firstPositions);
      await reader.readExecutionHistory(ctx, { sessionRef: created.ref, executionIdentity: first,
        afterCursor: rawTail.value.nextCursor, throughCursor: null, limit: 200 });
      expect(requests.at(-1)?.afterCursor).toBe(underlying.value.nextCursor);
    } finally { await fx.backend.close(); }
  });

  it('rejects cursors that change the Session or execution target, malformed cursors and invalid limits', async () => {
    const fx = await open();
    try {
      const a = await createMappedSession(fx.runtime, 'cursor-a');
      const b = await createMappedSession(fx.runtime, 'cursor-b');
      const client = scriptedClient();
      const first: KernelExecutionIdentity = { runId: 'run-cursor', turnId: 'turn-cursor' };
      await runTurn({ ...fx, sessionId: a.kernel.kernelSessionId, input: 'cursor', identity: first, client });
      const reader = createExecutionHistoryReader({ history: fx.runtime });
      const opened = await reader.readExecutionHistory(ctx, { sessionRef: a.ref, executionIdentity: first,
        afterCursor: null, throughCursor: null, limit: 1 });
      expect(opened.status).toBe('ready');
      if (opened.status !== 'ready') return;
      const changedActor = { kind: 'human' as const, id: 'another-authorized-host' };
      const otherHost: CoreCallContext = { ...ctx, principal: { kind: 'host', actor: changedActor },
        materialReader: { kind: 'host', projectId, workspaceId, actor: changedActor } };
      expect(await reader.readExecutionHistory(otherHost, { sessionRef: a.ref, executionIdentity: first,
        afterCursor: opened.value.nextCursor, throughCursor: null, limit: 200 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
      const cursor = opened.value.nextCursor;
      expect(cursor).not.toBeNull();

      expect(await reader.readExecutionHistory(ctx, { sessionRef: a.ref,
        executionIdentity: { runId: 'run-other', turnId: first.turnId }, afterCursor: cursor, throughCursor: null, limit: 200 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await reader.readExecutionHistory(ctx, { sessionRef: a.ref,
        executionIdentity: { runId: first.runId, turnId: 'turn-other' }, afterCursor: cursor, throughCursor: null, limit: 200 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await reader.readExecutionHistory(ctx, { sessionRef: b.ref, executionIdentity: first,
        afterCursor: cursor, throughCursor: null, limit: 200 })).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await reader.readExecutionHistory(ctx, { sessionRef: a.ref, executionIdentity: first,
        afterCursor: 'not-a-reader-cursor', throughCursor: null, limit: 200 })).toMatchObject({ status: 'rejected', code: 'invalid' });

      const bottom = await fx.runtime.readSessionHistory(ctx, { sessionRef: a.ref, afterCursor: null, throughCursor: null, limit: 1 });
      expect(bottom.status).toBe('ready');
      if (bottom.status !== 'ready') return;
      expect(bottom.value.nextCursor).not.toBeNull();
      expect(await reader.readExecutionHistory(ctx, { sessionRef: a.ref, executionIdentity: first,
        afterCursor: bottom.value.nextCursor, throughCursor: null, limit: 200 })).toMatchObject({ status: 'rejected', code: 'invalid' });

      for (const limit of [0, 201, 1.5]) {
        expect(await reader.readExecutionHistory(ctx, { sessionRef: a.ref, executionIdentity: first,
          afterCursor: null, throughCursor: null, limit })).toMatchObject({ status: 'rejected', code: 'invalid' });
      }
    } finally { await fx.backend.close(); }
  });

  it('passes the original boundary through and propagates owner rejections instead of an empty page', async () => {
    const fx = await open();
    try {
      const created = await createMappedSession(fx.runtime, 'owner-boundary');
      const client = scriptedClient();
      const identity: KernelExecutionIdentity = { runId: 'run-boundary', turnId: 'turn-boundary' };
      await runTurn({ ...fx, sessionId: created.kernel.kernelSessionId, input: 'boundary', identity, client });
      const full = await fx.runtime.readSessionHistory(ctx, { sessionRef: created.ref, afterCursor: null, throughCursor: null, limit: 200 });
      expect(full.status).toBe('ready');
      if (full.status !== 'ready') return;
      expect(full.value.basis.kind).toBe('session');
      if (full.value.basis.kind !== 'session') return;
      const through = full.value.basis.cursor;

      const { history, requests } = spyOn(fx.runtime);
      const reader = createExecutionHistoryReader({ history });
      const read = await reader.readExecutionHistory(ctx, { sessionRef: created.ref, executionIdentity: identity,
        afterCursor: null, throughCursor: through, limit: 200 });
      expect(read.status).toBe('ready');
      expect(requests).toHaveLength(1);
      expect(requests[0]?.afterCursor).toBeNull();
      expect(requests[0]?.throughCursor).toBe(through);

      const otherCtx: CoreCallContext = { ...ctx, workspaceId: 'workspace-b',
        materialReader: { kind: 'host', projectId, workspaceId: 'workspace-b', actor } };
      expect(await reader.readExecutionHistory(otherCtx, { sessionRef: created.ref, executionIdentity: identity,
        afterCursor: null, throughCursor: null, limit: 200 })).toMatchObject({ status: 'rejected', code: 'forbidden' });

      const database = new DatabaseSync(fx.databasePath);
      try {
        database.prepare('UPDATE session_records SET record_json = ? WHERE session_id = ? AND position = 1')
          .run('{}', created.kernel.kernelSessionId);
      } finally { database.close(); }
      expect(await reader.readExecutionHistory(ctx, { sessionRef: created.ref, executionIdentity: identity,
        afterCursor: null, throughCursor: null, limit: 200 })).toMatchObject({ status: 'rejected', code: 'unavailable' });

      await unlink(fx.databasePath);
      expect(await reader.readExecutionHistory(ctx, { sessionRef: created.ref, executionIdentity: identity,
        afterCursor: null, throughCursor: null, limit: 200 })).toMatchObject({ status: 'rejected', code: 'not_found' });

      const notReady = createExecutionHistoryReader({ history: {
        async readSessionHistory() {
          return { status: 'not_ready' as const, observed: null,
            required: { kind: 'session' as const, ref: created.ref, cursor: 'owner-watermark' } };
        },
      } });
      expect(await notReady.readExecutionHistory(ctx, { sessionRef: created.ref, executionIdentity: identity,
        afterCursor: null, throughCursor: null, limit: 200 })).toMatchObject({ status: 'not_ready' });
    } finally { await fx.backend.close(); }
  });

  it('keeps the original signal and rejects a page cancelled before or while awaiting the owner', async () => {
    const fx = await open();
    try {
      const created = await createMappedSession(fx.runtime, 'cancel');
      const client = scriptedClient();
      const identity: KernelExecutionIdentity = { runId: 'run-cancel', turnId: 'turn-cancel' };
      await runTurn({ ...fx, sessionId: created.kernel.kernelSessionId, input: 'cancel', identity, client });

      const before = new AbortController();
      before.abort();
      const reader = createExecutionHistoryReader({ history: fx.runtime });
      expect(await reader.readExecutionHistory({ ...ctx, signal: before.signal },
        { sessionRef: created.ref, executionIdentity: identity, afterCursor: null, throughCursor: null, limit: 200 }))
        .toMatchObject({ status: 'rejected', code: 'cancelled' });

      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let ownerRead!: () => void;
      const reachedOwner = new Promise<void>(resolve => { ownerRead = resolve; });
      const delayed: HistoryOwner = {
        async readSessionHistory(context, request) {
          const page = await fx.runtime.readSessionHistory(context, request);
          ownerRead();
          await gate;
          return page;
        },
      };
      const gated = createExecutionHistoryReader({ history: delayed });
      const controller = new AbortController();
      const pending = gated.readExecutionHistory({ ...ctx, signal: controller.signal },
        { sessionRef: created.ref, executionIdentity: identity, afterCursor: null, throughCursor: null, limit: 200 });
      const firstResult = await Promise.race([reachedOwner.then(() => 'owner' as const), pending]);
      if (firstResult !== 'owner') {
        release();
        expect(firstResult).toMatchObject({ status: 'rejected', code: 'cancelled' });
        return;
      }
      controller.abort();
      release();
      expect(await pending).toMatchObject({ status: 'rejected', code: 'cancelled' });
    } finally { await fx.backend.close(); }
  });

  it('owns the request before the first await so caller mutation cannot retarget the execution read', async () => {
    const fx = await open();
    try {
      const a = await createMappedSession(fx.runtime, 'mutate-a');
      const b = await createMappedSession(fx.runtime, 'mutate-b');
      const client = scriptedClient();
      const identityA: KernelExecutionIdentity = { runId: 'run-a', turnId: 'turn-a' };
      await runTurn({ ...fx, sessionId: a.kernel.kernelSessionId, input: 'a', identity: identityA, client });

      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const seen: SessionHistoryRequest[] = [];
      const delayed: HistoryOwner = {
        async readSessionHistory(context, request) {
          seen.push(structuredClone(request));
          await gate;
          expect(context.principal).toEqual(ctx.principal);
          expect(context.materialReader).toEqual(ctx.materialReader);
          expect(context.signal).toBe(ctx.signal);
          return fx.runtime.readSessionHistory(context, request);
        },
      };
      const reader = createExecutionHistoryReader({ history: delayed });
      const request = { sessionRef: { projectId, sessionId: a.ref.sessionId }, executionIdentity: { runId: 'run-a', turnId: 'turn-a' },
        afterCursor: null, throughCursor: null, limit: 200 };
      const ownedCtx: CoreCallContext = { ...ctx, principal: structuredClone(ctx.principal),
        materialReader: structuredClone(ctx.materialReader) };
      const pending = reader.readExecutionHistory(ownedCtx, request);
      if (ownedCtx.principal.kind === 'host') ownedCtx.principal.actor.id = 'mutated-actor';
      ownedCtx.workspaceId = 'mutated-workspace';
      request.executionIdentity.runId = 'run-b';
      request.executionIdentity.turnId = 'turn-b';
      request.sessionRef.sessionId = b.ref.sessionId;
      request.limit = 1;
      release();
      const result = await pending;
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.value.executionIdentity).toEqual(identityA);
      expect(result.value.items.length).toBeGreaterThan(0);
      expect(result.value.items.every(item => item.source.kernelSessionId === a.kernel.kernelSessionId)).toBe(true);
      expect(seen[0]).toMatchObject({ limit: 200, afterCursor: null, throughCursor: null });
      expect(seen[0]?.sessionRef.sessionId).toBe(a.ref.sessionId);
    } finally { await fx.backend.close(); }
  });

  it('rejects damaged inline evidence, inconsistent envelopes and unsupported external bodies', async () => {
    const fx = await open();
    try {
      const session = await createMappedSession(fx.runtime, 'damaged-page');
      const identity = { runId: 'absent', turnId: 'absent' };
      const request = { sessionRef: session.ref, executionIdentity: identity,
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
            source: { kind: 'workspace' as const, refId: workspaceId, revision: '1' } } })],
      ] as const) {
        const reader = createExecutionHistoryReader({ history: {
          async readSessionHistory(context, input) {
            const result = await fx.runtime.readSessionHistory(context, input);
            if (result.status !== 'ready') return result;
            return { ...result, value: { ...result.value, items: result.value.items.map(mutate) } };
          },
        } });
        expect(await reader.readExecutionHistory(ctx, request)).toMatchObject({ status: 'rejected', code });
      }
    } finally { await fx.backend.close(); }
  });

  it('still reads persisted Kernel evidence when the best-effort observer is down', async () => {
    const fx = await open();
    try {
      const created = await createMappedSession(fx.runtime, 'observer-down');
      const client = scriptedClient();
      const identity: KernelExecutionIdentity = { runId: 'run-observed', turnId: 'turn-observed' };
      let failures = 0;
      const result = await runTurn({ ...fx, sessionId: created.kernel.kernelSessionId, input: 'observed', identity, client,
        publish: async () => { failures += 1; throw new Error('observer sink down'); } });
      expect(result.state.status).toBe('completed');
      expect(failures).toBeGreaterThan(0);

      const persisted = positionsOf(await rawRecords(fx.databasePath, created.kernel.kernelSessionId), identity);
      expect(persisted.length).toBeGreaterThanOrEqual(2);

      const reader = createExecutionHistoryReader({ history: fx.runtime });
      const page = await reader.readExecutionHistory(ctx, { sessionRef: created.ref, executionIdentity: identity,
        afterCursor: null, throughCursor: null, limit: 200 });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.items.map(item => item.source.position)).toEqual(persisted);
    } finally { await fx.backend.close(); }
  });
});
