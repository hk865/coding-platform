/** Runtime input isolation and history cursor boundaries over real stores. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildRawTurn, rawInsertRecords } from '../kernel/R4a-legacy-fixtures.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/sessions/contracts.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations, type CreateSessionRequest } from '../../src/core/agent-runtime/session-operations.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'session-boundary-project';
const workspaceId = 'workspace-a';
const actor = { kind: 'human' as const, id: 'original-operator' };
const ctx: CoreCallContext = {
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
};
const workspace = { projectId, workspaceId };
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    { eventType: 'TrustedScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: SESSION_RECORD_SCHEMAS.lookups ?? [],
};
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

function request(requestId: string): CreateSessionRequest {
  return { workspace, role: { kind: 'legacy_template', templateId: 'implementer', templateRevision: '1' },
    recommendedRefs: [], initialLinks: [], meta: { requestId, expected: [] } };
}

async function open() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'next-r4b-input-boundaries-'));
  directories.push(directory);
  const backend = createSqliteRecordBackend({ schemas, path: path.join(directory, 'ledger.sqlite') });
  const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
  const workspaceSnapshot: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
  const event = { eventId: 'boundary-scope-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at };
  const seed: PreparedCommit = { identityKey: 'boundary-scope-seed', fingerprint: 'boundary-scope-seed',
    guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
      { refKey: canonicalRefKey(workspaceSnapshot.ref), expectedRevision: null }],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspaceSnapshot)],
    claims: [], indexGuards: [], indexChanges: [], events: [{ ...event, json: JSON.stringify(event) }] };
  const seeded = await backend.records.commit(seed);
  if (seeded.status !== 'committed') throw Error(`scope seed failed: ${seeded.reason}`);
  const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'workspace-kernel', storeKey: 'workspace-key', workspace,
    databasePath: path.join(directory, 'kernel.sqlite'),
  }] });
  return { backend, sessions, kernelStores };
}

it('keeps the original request identity and role when the caller mutates input after durable admission', async () => {
  const { backend, sessions, kernelStores } = await open();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  let originalOperation: string | null = null;
  const guarded: SessionDirectoryPort = {
    ...sessions,
    async admitSessionCreation(context, command) {
      const result = await sessions.admitSessionCreation(context, command);
      if (result.status === 'committed') {
        originalOperation = result.value.ref.operationId;
        entered();
        await gate;
      }
      return result;
    },
  };
  const runtime = createSessionOperations({ sessions: guarded, kernelStores });
  const input = request('original-request');
  const original = structuredClone(input);
  try {
    const pending = runtime.createSession(ctx, input);
    // If the current skeleton returns unsupported, fail immediately instead of
    // waiting forever for an admission callback it never invoked.
    await Promise.race([admitted, pending.then(() => { throw Error('createSession returned before durable admission'); })]);
    input.meta.requestId = 'mutated-request';
    input.role = { kind: 'legacy_template', templateId: 'mutated-role', templateRevision: '9' };
    release();
    const created = await pending;
    expect(created.status).toBe('completed');
    if (created.status !== 'completed') return;
    expect(created.operationRef.operationId).toBe(originalOperation);
    expect(created.value.role).toEqual(original.role);
    const retry = await createSessionOperations({ sessions, kernelStores }).createSession(ctx, original);
    expect(retry).toMatchObject({ status: 'completed', value: { ref: created.value.ref, kernel: created.value.kernel } });
    const kernel = await kernelStores.withStore(created.value.kernel.adapterId,
      store => store.list(null, 10, { signal: ctx.signal }));
    expect(kernel.sessions.map(item => item.sessionId)).toEqual([created.value.kernel.kernelSessionId]);
  } finally { release(); await backend.close(); }
});

it('rejects history limit outside 1..200 and a continuation cursor from another principal', async () => {
  const { backend, sessions, kernelStores } = await open();
  const runtime = createSessionOperations({ sessions, kernelStores });
  try {
    const created = await runtime.createSession(ctx, request('history-boundaries'));
    expect(created.status).toBe('completed');
    if (created.status !== 'completed') return;
    for (const limit of [0, -1, 201]) {
      expect(await runtime.readSessionHistory(ctx, { sessionRef: created.value.ref,
        afterCursor: null, throughCursor: null, limit })).toMatchObject({ status: 'rejected', code: 'invalid' });
    }
    const location = kernelStores.byAdapterId(created.value.kernel.adapterId);
    if (!location) throw Error('missing Kernel store location');
    rawInsertRecords(location.databasePath, buildRawTurn({ sessionId: created.value.kernel.kernelSessionId,
      startPosition: 2, runId: 'fixture-run', turnId: 'fixture-turn', input: 'history input' }).records);
    const first = await runtime.readSessionHistory(ctx, { sessionRef: created.value.ref,
      afterCursor: null, throughCursor: null, limit: 1 });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.value.nextCursor).not.toBeNull();
    const otherActor = { kind: 'human' as const, id: 'other-operator' };
    const other: CoreCallContext = { ...ctx, principal: { kind: 'host', actor: otherActor },
      materialReader: { kind: 'host', projectId, workspaceId, actor: otherActor } };
    expect(await runtime.readSessionHistory(other, { sessionRef: created.value.ref,
      afterCursor: first.value.nextCursor, throughCursor: null, limit: 1 }))
      .toMatchObject({ status: 'rejected' });
  } finally { await backend.close(); }
});
