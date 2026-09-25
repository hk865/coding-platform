/** R4b implementation acceptance. These cases are deliberately red while the
 * SessionDirectory and Runtime bridge return unsupported. Do not replace their
 * real stores with an in-process fake to make them pass. */
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildRawTurn, rawInsertRecords } from '../kernel/R4a-legacy-fixtures.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'session-project';
const workspaceId = 'workspace-a';
const actor = { kind: 'human' as const, id: 'session-operator' };
const ctx: CoreCallContext = {
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
};
const workspace = { projectId, workspaceId };
const role = { kind: 'legacy_template' as const, templateId: 'implementer', templateRevision: '1' };
const creation = (requestId: string) => ({
  input: { workspace, role, recommendedRefs: [], initialLinks: [] },
  meta: { requestId, expected: [] },
});
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    { eventType: 'TrustedScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: SESSION_RECORD_SCHEMAS.lookups ?? [],
};
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function open(kind: 'memory' | 'sqlite') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'next-r4b-acceptance-'));
  directories.push(directory);
  const ledgerPath = path.join(directory, 'ledger.sqlite');
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ schemas, path: ledgerPath });
  const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
  const workspaceSnapshot: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
  const seedEvent = { eventId: 'session-scope-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
    occurredAt: at, json: JSON.stringify({ eventId: 'session-scope-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at }) };
  const seed: PreparedCommit = { identityKey: 'session-scope-seed', fingerprint: 'session-scope-seed',
    guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
      { refKey: canonicalRefKey(workspaceSnapshot.ref), expectedRevision: null }],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspaceSnapshot)],
    claims: [], indexGuards: [], indexChanges: [], events: [seedEvent] };
  const seeded = await backend.records.commit(seed);
  if (seeded.status !== 'committed') throw new Error(`scope seed failed: ${seeded.reason}`);
  const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'workspace-kernel', storeKey: 'workspace-key', workspace,
    databasePath: path.join(directory, 'kernel.sqlite'),
  }] });
  const runtime = createSessionOperations({ sessions, kernelStores });
  return { backend, sessions, runtime, kernelStores, ledgerPath };
}

describe('R4b SQLite recovery and raw history acceptance', () => {
  it('reuses the committed Kernel create after its response is lost', async () => {
    const { backend, sessions, kernelStores } = await open('sqlite');
    let loseCreateResponse = true;
    const faulty = { ...kernelStores, withStore: async <T>(adapterId: string,
      use: Parameters<typeof kernelStores.withStore<T>>[1]): Promise<T> => kernelStores.withStore(adapterId, async store => {
        if (!loseCreateResponse) return use(store);
        const proxy = new Proxy(store, { get(target, property) {
          if (property === 'create') return async (...args: Parameters<typeof store.create>) => {
            await target.create(...args);
            loseCreateResponse = false;
            throw new Error('create response lost after SQLite commit');
          };
          const member: unknown = Reflect.get(target, property);
          return typeof member === 'function' ? member.bind(target) : member;
        } });
        return use(proxy);
      }) };
    const runtime = createSessionOperations({ sessions, kernelStores: faulty });
    try {
      const request = { ...creation('lost-kernel-response').input, meta: creation('lost-kernel-response').meta };
      const first = await runtime.createSession(ctx, request);
      expect(first.status).toMatch(/accepted|rejected/);
      const recovered = await runtime.createSession(ctx, request);
      expect(recovered.status).toBe('completed');
      if (recovered.status !== 'completed') return;
      const page = await kernelStores.withStore(recovered.value.kernel.adapterId,
        store => store.list(null, 10, { signal: ctx.signal }));
      expect(page.sessions.map(item => item.sessionId)).toEqual([recovered.value.kernel.kernelSessionId]);
    } finally { await backend.close(); }
  });

  it('repairs a failed platform mapping after reopening the real SQLite Store', async () => {
    const first = await open('sqlite');
    let rejectRegistration = true;
    const faulty = { ...first.sessions, recordSessionCreated: async (...args: Parameters<typeof first.sessions.recordSessionCreated>) => {
      if (rejectRegistration) { rejectRegistration = false; return { status: 'rejected' as const,
        code: 'unavailable' as const, reason: 'injected post-Kernel WG outage' }; }
      return first.sessions.recordSessionCreated(...args);
    } };
    const request = { ...creation('lost-wg-registration').input, meta: creation('lost-wg-registration').meta };
    try {
      const interrupted = await createSessionOperations({ sessions: faulty, kernelStores: first.kernelStores }).createSession(ctx, request);
      expect(interrupted.status).toMatch(/accepted|rejected/);
    } finally { await first.backend.close(); }
    const backend = createSqliteRecordBackend({ schemas, path: first.ledgerPath });
    try {
      const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
      const recovered = await createSessionOperations({ sessions, kernelStores: first.kernelStores }).createSession(ctx, request);
      expect(recovered.status).toBe('completed');
      if (recovered.status !== 'completed') return;
      const page = await first.kernelStores.withStore(recovered.value.kernel.adapterId,
        store => store.list(null, 10, { signal: ctx.signal }));
      expect(page.sessions.map(item => item.sessionId)).toEqual([recovered.value.kernel.kernelSessionId]);
    } finally { await backend.close(); }
  });

  it('never moves an accepted create to a new default Kernel store after registration is interrupted', async () => {
    const first = await open('sqlite');
    const request = { ...creation('pinned-kernel-route').input, meta: creation('pinned-kernel-route').meta };
    const originalLocation = first.kernelStores.byAdapterId('workspace-kernel');
    if (!originalLocation) throw Error('missing initial Kernel route');
    const replacementPath = path.join(path.dirname(first.ledgerPath), 'replacement-kernel.sqlite');
    const interruptedDirectory = {
      ...first.sessions,
      recordSessionCreated: async () => ({ status: 'rejected' as const, code: 'unavailable' as const,
        reason: 'injected outage after Kernel create' }),
    };
    let originalKernelSessionId: string;
    try {
      const interrupted = await createSessionOperations({ sessions: interruptedDirectory,
        kernelStores: first.kernelStores }).createSession(ctx, request);
      expect(interrupted.status).toBe('accepted');
      const original = await first.kernelStores.withStore('workspace-kernel',
        store => store.list(null, 10, { signal: ctx.signal }));
      expect(original.sessions).toHaveLength(1);
      originalKernelSessionId = original.sessions[0]!.sessionId;
    } finally { await first.backend.close(); }

    const backend = createSqliteRecordBackend({ schemas, path: first.ledgerPath });
    try {
      const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
      const changedDefault = await createKernelStoreRegistry({ entries: [{
        adapterId: 'replacement-kernel', storeKey: 'replacement-key', workspace, databasePath: replacementPath,
      }] });
      const refused = await createSessionOperations({ sessions, kernelStores: changedDefault }).createSession(ctx, request);
      expect(refused).toMatchObject({ status: 'rejected', code: 'unsupported' });
      await expect(access(replacementPath)).rejects.toMatchObject({ code: 'ENOENT' });

      const restored = await createKernelStoreRegistry({ entries: [{
        adapterId: originalLocation.adapterId, storeKey: originalLocation.storeKey,
        workspace, databasePath: originalLocation.databasePath,
      }] });
      const recovered = await createSessionOperations({ sessions, kernelStores: restored }).createSession(ctx, request);
      expect(recovered.status).toBe('completed');
      if (recovered.status !== 'completed') return;
      expect(recovered.value.kernel).toMatchObject({ adapterId: 'workspace-kernel',
        kernelSessionId: originalKernelSessionId });
      const original = await restored.withStore('workspace-kernel', store => store.list(null, 10, { signal: ctx.signal }));
      expect(original.sessions.map(item => item.sessionId)).toEqual([originalKernelSessionId]);
    } finally { await backend.close(); }
  });

  it('binds raw history continuation to its original adapter, Session and upper record position', async () => {
    const { backend, runtime, kernelStores } = await open('sqlite');
    try {
      const a = await runtime.createSession(ctx, { ...creation('page-history-a').input, meta: creation('page-history-a').meta });
      const b = await runtime.createSession(ctx, { ...creation('page-history-b').input, meta: creation('page-history-b').meta });
      expect(a.status).toBe('completed');
      expect(b.status).toBe('completed');
      if (a.status !== 'completed' || b.status !== 'completed') return;
      const location = kernelStores.byAdapterId(a.value.kernel.adapterId);
      if (!location) throw Error('missing Kernel location');
      rawInsertRecords(location.databasePath, buildRawTurn({ sessionId: a.value.kernel.kernelSessionId,
        startPosition: 2, runId: 'fixture-run-1', turnId: 'fixture-turn-1', input: 'first' }).records);
      const first = await runtime.readSessionHistory(ctx, { sessionRef: a.value.ref,
        afterCursor: null, throughCursor: null, limit: 2 });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.items).toHaveLength(2);
      expect(first.value.nextCursor).not.toBeNull();
      rawInsertRecords(location.databasePath, buildRawTurn({ sessionId: a.value.kernel.kernelSessionId,
        startPosition: 7, runId: 'fixture-run-2', turnId: 'fixture-turn-2', input: 'later' }).records);
      const continued = await runtime.readSessionHistory(ctx, { sessionRef: a.value.ref,
        afterCursor: first.value.nextCursor, throughCursor: null, limit: 20 });
      expect(continued.status).toBe('ready');
      if (continued.status === 'ready') expect(continued.value.items.every(item => item.source.position <= 6)).toBe(true);
      const wrongSession = await runtime.readSessionHistory(ctx, { sessionRef: b.value.ref,
        afterCursor: first.value.nextCursor, throughCursor: null, limit: 2 });
      expect(wrongSession.status).toBe('rejected');
    } finally { await backend.close(); }
  });

  it('rejects missing original Kernel history without returning an empty success page', async () => {
    const { backend, runtime, kernelStores } = await open('sqlite');
    try {
      const created = await runtime.createSession(ctx, { ...creation('missing-history').input,
        meta: creation('missing-history').meta });
      expect(created.status).toBe('completed');
      if (created.status !== 'completed') return;
      const location = kernelStores.byAdapterId(created.value.kernel.adapterId);
      if (!location) throw Error('missing Kernel location');
      const database = new DatabaseSync(location.databasePath);
      try { database.prepare('DELETE FROM session_records WHERE session_id = ? AND position = 1')
        .run(created.value.kernel.kernelSessionId); } finally { database.close(); }
      const missing = await runtime.readSessionHistory(ctx, { sessionRef: created.value.ref,
        afterCursor: null, throughCursor: null, limit: 10 });
      expect(missing.status).not.toBe('ready');
    } finally { await backend.close(); }
  });
});
