/** R4b implementation acceptance. These cases are deliberately red while the
 * SessionDirectory and Runtime bridge return unsupported. Do not replace their
 * real stores with an in-process fake to make them pass. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

describe.each(['memory', 'sqlite'] as const)('R4b real %s RecordStore acceptance', kind => {
  it('creates an empty Kernel Session without model execution and exposes only the mapped directory row', async () => {
    const { backend, sessions, runtime, kernelStores } = await open(kind);
    try {
      const created = await runtime.createSession(ctx, { ...creation('create-real').input,
        meta: creation('create-real').meta });
      expect(created.status).toBe('completed');
      if (created.status !== 'completed') return;
      expect(created.value.historyCursor).toBeNull();
      expect(created.value.occupancy).toBeNull();
      expect(created.value.lastExecutionRef).toBeNull();
      const page = await sessions.findSessions(ctx, { workspace, includeArchived: false, page: { limit: 1 } });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.items.map(item => item.record.ref)).toEqual([created.value.ref]);
      const kernel = await kernelStores.withStore(created.value.kernel.adapterId, store =>
        store.read(created.value.kernel.kernelSessionId, 0, 2, { signal: ctx.signal }));
      expect(kernel.records).toHaveLength(1);
      expect(kernel.records[0]).toMatchObject({ recordType: 'session.created', position: 1 });
    } finally { await backend.close(); }
  });

  it('pages raw Kernel history by original positions without inventing a Run or completed-turn cursor', async () => {
    const { backend, runtime } = await open(kind);
    try {
      const created = await runtime.createSession(ctx, { ...creation('history-real').input,
        meta: creation('history-real').meta });
      expect(created.status).toBe('completed');
      if (created.status !== 'completed') return;
      const page = await runtime.readSessionHistory(ctx, { sessionRef: created.value.ref,
        afterCursor: null, throughCursor: null, limit: 1 });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.items).toHaveLength(1);
      expect(page.value.items[0]).toMatchObject({ kind: 'session_created', source: {
        adapterId: created.value.kernel.adapterId,
        kernelSessionId: created.value.kernel.kernelSessionId, position: 1,
      } });
    } finally { await backend.close(); }
  });

  it('retries the same request with the original Kernel identity and never creates a second empty Session', async () => {
    const { backend, runtime, kernelStores } = await open(kind);
    try {
      const request = { ...creation('lost-create-response').input, meta: creation('lost-create-response').meta };
      const first = await runtime.createSession(ctx, request);
      const retry = await runtime.createSession(ctx, request);
      expect(first.status).toBe('completed');
      expect(retry.status).toBe('completed');
      if (first.status !== 'completed' || retry.status !== 'completed') return;
      expect(retry.value.ref).toEqual(first.value.ref);
      expect(retry.value.kernel).toEqual(first.value.kernel);
      const page = await kernelStores.withStore(first.value.kernel.adapterId,
        store => store.list(null, 10, { signal: ctx.signal }));
      expect(page.sessions.map(item => item.sessionId)).toEqual([first.value.kernel.kernelSessionId]);
    } finally { await backend.close(); }
  });

  it('refuses cross-workspace original history reads before opening a Kernel store', async () => {
    const { backend, runtime } = await open(kind);
    try {
      const created = await runtime.createSession(ctx, { ...creation('scope-history').input,
        meta: creation('scope-history').meta });
      expect(created.status).toBe('completed');
      if (created.status !== 'completed') return;
      const other: CoreCallContext = { ...ctx, workspaceId: 'workspace-b',
        materialReader: { kind: 'host', projectId, workspaceId: 'workspace-b', actor } };
      const result = await runtime.readSessionHistory(other, { sessionRef: created.value.ref,
        afterCursor: null, throughCursor: null, limit: 1 });
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.code).toBe('forbidden');
    } finally { await backend.close(); }
  });

  it('fails closed when the original Kernel session.created record is damaged', async () => {
    const { backend, runtime, kernelStores } = await open(kind);
    try {
      const created = await runtime.createSession(ctx, { ...creation('corrupt-history').input,
        meta: creation('corrupt-history').meta });
      expect(created.status).toBe('completed');
      if (created.status !== 'completed') return;
      const location = kernelStores.byAdapterId(created.value.kernel.adapterId);
      if (!location) throw Error('created Session has no registered Kernel store');
      const database = new DatabaseSync(location.databasePath);
      try { database.prepare('UPDATE session_records SET record_json = ? WHERE session_id = ? AND position = 1')
        .run('{}', created.value.kernel.kernelSessionId); } finally { database.close(); }
      const result = await runtime.readSessionHistory(ctx, { sessionRef: created.value.ref,
        afterCursor: null, throughCursor: null, limit: 1 });
      expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { await backend.close(); }
  });
});
