/** R4b implementation acceptance. These cases are deliberately red while the
 * SessionDirectory and Runtime bridge return unsupported. Do not replace their
 * real stores with an in-process fake to make them pass. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { EncodedRecord, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';

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
  input: { workspace, kernelStore: { adapterId: 'workspace-kernel', storeKey: 'workspace-key' },
    role, recommendedRefs: [], initialLinks: [] },
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
  const otherWorkspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId: 'workspace-b' }, revision: 1 };
  const seedEvent = { eventId: 'session-scope-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
    occurredAt: at, json: JSON.stringify({ eventId: 'session-scope-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at }) };
  const seed: PreparedCommit = { identityKey: 'session-scope-seed', fingerprint: 'session-scope-seed',
    guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
      { refKey: canonicalRefKey(workspaceSnapshot.ref), expectedRevision: null },
      { refKey: canonicalRefKey(otherWorkspace.ref), expectedRevision: null }],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspaceSnapshot), encodeWorkspaceSnapshot(otherWorkspace)],
    claims: [], indexGuards: [], indexChanges: [], events: [seedEvent] };
  const seeded = await backend.records.commit(seed);
  if (seeded.status !== 'committed') throw new Error(`scope seed failed: ${seeded.reason}`);
  const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'workspace-kernel', storeKey: 'workspace-key', workspace,
    databasePath: path.join(directory, 'kernel.sqlite'),
  }] });
  return { backend, sessions, kernelStores, ledgerPath };
}

describe.each(['memory', 'sqlite'] as const)('R4b %s scope and identity boundaries', kind => {
  it('does not disclose a workspace A operation or registration receipt to workspace B', async () => {
    const { backend, sessions } = await open(kind);
    try {
      const admitted = await sessions.admitSessionCreation(ctx, creation('scope-private'));
      expect(admitted.status).toBe('committed');
      if (admitted.status !== 'committed') return;
      const inB: CoreCallContext = { ...ctx, workspaceId: 'workspace-b',
        materialReader: { kind: 'host', projectId, workspaceId: 'workspace-b', actor } };
      expect(await sessions.getSessionOperation(inB, admitted.value.ref)).toMatchObject({ status: 'not_found' });
      const registration = { meta: { requestId: 'scope-register', expected: [] }, input: {
        operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 'workspace-kernel', kernelSessionId: 'scope-kernel', historyCursor: null, observedAt: at,
      } };
      const first = await sessions.recordSessionCreated(ctx, registration);
      expect(first.status).toBe('committed');
      const replayFromB = await sessions.recordSessionCreated(inB, registration);
      expect(replayFromB.status).toBe('rejected');
      if (replayFromB.status === 'rejected') expect(replayFromB.code).toBe('forbidden');
    } finally { await backend.close(); }
  });

  it('does not share the same request identity between two distinct Host actors', async () => {
    const { backend, sessions } = await open(kind);
    try {
      const first = await sessions.admitSessionCreation(ctx, creation('actor-collision'));
      expect(first.status).toBe('committed');
      if (first.status !== 'committed') return;
      const otherActor = { kind: 'human' as const, id: 'another-operator' };
      const other: CoreCallContext = { ...ctx, principal: { kind: 'host', actor: otherActor },
        materialReader: { kind: 'host', projectId, workspaceId, actor: otherActor } };
      const second = await sessions.admitSessionCreation(other, creation('actor-collision'));
      expect(second.status).toBe('committed');
      if (second.status !== 'committed') return;
      expect(second.replayed).toBe(false);
      expect(second.value.ref).not.toEqual(first.value.ref);
      expect(second.value.action.plannedSessionRef).not.toEqual(first.value.action.plannedSessionRef);
    } finally { await backend.close(); }
  });

  it('finds a role_spec Session by the digest on its pin', async () => {
    const { backend, sessions } = await open(kind);
    try {
      const specRole = { kind: 'role_spec' as const, pin: { ref: {
        aggregateType: 'RoleSpecRevision' as const, projectId, roleId: 'implementer', revision: 1,
      }, digest: 'sha256:matching-role-spec' } };
      const otherRole = { ...specRole, pin: { ...specRole.pin, digest: 'sha256:other-role-spec' } };
      const records: EncodedRecord[] = [
        { refKey: canonicalJson({ aggregateType: 'Session', projectId, sessionId: 'matching-role' }),
          schemaId: 'SessionRecord@1', revision: 1, json: JSON.stringify({
            ref: { aggregateType: 'Session', projectId, sessionId: 'matching-role' }, revision: 1,
            kernel: { adapterId: 'workspace-kernel', kernelSessionId: 'matching-role' },
            lifecycle: 'active', health: 'available', role: specRole, workspaceId,
            lastExecutionRef: null, occupancy: null, historyCursor: null, createdAt: at, archivedAt: null,
          }) },
        { refKey: canonicalJson({ aggregateType: 'Session', projectId, sessionId: 'other-role' }),
          schemaId: 'SessionRecord@1', revision: 1, json: JSON.stringify({
            ref: { aggregateType: 'Session', projectId, sessionId: 'other-role' }, revision: 1,
            kernel: { adapterId: 'workspace-kernel', kernelSessionId: 'other-role' },
            lifecycle: 'active', health: 'available', role: otherRole, workspaceId,
            lastExecutionRef: null, occupancy: null, historyCursor: null, createdAt: at, archivedAt: null,
          }) },
      ];
      const event = { eventId: 'seed-role-spec-sessions', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
        occurredAt: at, json: JSON.stringify({ eventId: 'seed-role-spec-sessions', eventType: 'TrustedScopeSeeded',
          schemaVersion: 1, occurredAt: at }) };
      const seeded = await backend.records.commit({ identityKey: 'seed-role-spec-sessions',
        fingerprint: 'seed-role-spec-sessions', guards: records.map(record => ({ refKey: record.refKey, expectedRevision: null })),
        records, events: [event], claims: [], indexGuards: [], indexChanges: [] });
      expect(seeded.status).toBe('committed');
      const found = await sessions.findSessions(ctx, { workspace, role: specRole, includeArchived: false,
        page: { limit: 10 } });
      expect(found.status).toBe('ready');
      if (found.status === 'ready') expect(found.value.items.map(item => item.record.ref.sessionId)).toEqual(['matching-role']);
    } finally { await backend.close(); }
  });

  it('rejects cross-project Operation and WorkLink records through the registered schema', async () => {
    const { backend } = await open(kind);
    try {
      const source = {
        ref: { aggregateType: 'CoreOperation', projectId, operationId: 'schema-scope-source' },
        revision: 1, action: { kind: 'create', plannedSessionRef: { projectId, sessionId: 'schema-source-session' },
          workspace, kernelStore: { adapterId: 'workspace-kernel', storeKey: 'workspace-key' }, role,
          recommendedRefs: [], initialLinks: [] },
        phase: 'accepted', requestedAt: at, updatedAt: at, observation: null, failure: null,
      };
      const mismatches = [
        { name: 'operation-project', schemaId: 'CoreOperation@1', body: {
          ...source, ref: { ...source.ref, operationId: 'schema-wrong-operation', projectId: 'another-project' },
        } },
        { name: 'planned-session-project', schemaId: 'CoreOperation@1', body: {
          ...source, ref: { ...source.ref, operationId: 'schema-wrong-planned-session' },
          action: { ...source.action, plannedSessionRef: { ...source.action.plannedSessionRef, projectId: 'another-project' } },
        } },
        { name: 'link-target-project', schemaId: 'SessionWorkLink@1', body: {
          ref: { aggregateType: 'SessionWorkLink', projectId, sessionId: 'schema-wrong-link',
            target: { kind: 'task', ref: { projectId: 'another-project', goalId: 'goal', taskId: 'task' } },
            relation: 'responsible' }, revision: 1, since: makeCommitCursor(1), until: null,
        } },
      ];
      for (const mismatch of mismatches) {
        const body = mismatch.body;
        const refKey = canonicalJson(body.ref as JsonValue);
        const eventId = `schema-reject-${mismatch.name}`;
        const event = { eventId, eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at,
          json: JSON.stringify({ eventId, eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at }) };
        const result = await backend.records.commit({ identityKey: eventId, fingerprint: eventId,
          guards: [{ refKey, expectedRevision: null }],
          records: [{ refKey, schemaId: mismatch.schemaId, revision: 1, json: JSON.stringify(body) }],
          events: [event], claims: [], indexGuards: [], indexChanges: [] });
        expect(result, mismatch.name).toMatchObject({ status: 'rejected', code: 'invalid' });
      }
    } finally { await backend.close(); }
  });
});

it('keeps the matching Session at candidate 1001 visible after a bounded directory scan', async () => {
  const { backend, sessions } = await open('memory');
  try {
    const target = { kind: 'module' as const, ref: { projectId, moduleId: 'needle-module' } };
    const records: EncodedRecord[] = [];
    const guards: PreparedCommit['guards'][number][] = [];
    for (let n = 0; n <= 1000; n++) {
      const sessionId = `scan-${String(n).padStart(4, '0')}`;
      const session: SessionRecord = {
        ref: { aggregateType: 'Session', projectId, sessionId }, revision: 1,
        kernel: { adapterId: 'workspace-kernel', kernelSessionId: `kernel-${sessionId}` },
        lifecycle: 'active', health: 'available', role, workspaceId, lastExecutionRef: null,
        occupancy: null, historyCursor: null, createdAt: at, archivedAt: null,
      };
      const refKey = canonicalJson(session.ref as JsonValue);
      records.push({ refKey, schemaId: 'SessionRecord@1', revision: 1, json: JSON.stringify(session) });
      guards.push({ refKey, expectedRevision: null });
    }
    const link = { ref: { aggregateType: 'SessionWorkLink' as const, projectId,
      sessionId: 'scan-1000', target, relation: 'responsible' as const },
      revision: 1, since: makeCommitCursor(1), until: null };
    const linkKey = canonicalJson(link.ref as JsonValue);
    records.push({ refKey: linkKey, schemaId: 'SessionWorkLink@1', revision: 1, json: JSON.stringify(link) });
    guards.push({ refKey: linkKey, expectedRevision: null });
    const event = { eventId: 'seed-1001-sessions', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
      occurredAt: at, json: JSON.stringify({ eventId: 'seed-1001-sessions', eventType: 'TrustedScopeSeeded',
        schemaVersion: 1, occurredAt: at }) };
    const seeded = await backend.records.commit({ identityKey: 'seed-1001-sessions', fingerprint: 'seed-1001-sessions',
      guards, records, events: [event], claims: [], indexGuards: [], indexChanges: [] });
    expect(seeded.status).toBe('committed');
    let cursor: string | undefined;
    const found: string[] = [];
    for (let page = 0; page < 3; page++) {
      const result = await sessions.findSessions(ctx, { workspace, target, includeArchived: false,
        page: { limit: 1, ...(cursor === undefined ? {} : { cursor }) } });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      found.push(...result.value.items.map(item => item.record.ref.sessionId));
      if (result.value.nextCursor === null) break;
      cursor = result.value.nextCursor;
    }
    expect(found).toContain('scan-1000');
  } finally { await backend.close(); }
});

it('never presents a Session card with a silently truncated set of 601 persisted links', async () => {
  const { backend, sessions } = await open('memory');
  try {
    const sessionId = 'many-links';
    const session: SessionRecord = { ref: { aggregateType: 'Session', projectId, sessionId }, revision: 1,
      kernel: { adapterId: 'workspace-kernel', kernelSessionId: 'kernel-many-links' },
      lifecycle: 'active', health: 'available', role, workspaceId, lastExecutionRef: null,
      occupancy: null, historyCursor: null, createdAt: at, archivedAt: null };
    const records: EncodedRecord[] = [{ refKey: canonicalJson(session.ref as JsonValue),
      schemaId: 'SessionRecord@1', revision: 1, json: JSON.stringify(session) }];
    for (let n = 0; n < 601; n++) {
      const link = { ref: { aggregateType: 'SessionWorkLink' as const, projectId, sessionId,
        target: { kind: 'module' as const, ref: { projectId, moduleId: `module-${String(n).padStart(4, '0')}` } },
        relation: 'responsible' as const }, revision: 1, since: makeCommitCursor(1), until: null };
      records.push({ refKey: canonicalJson(link.ref as JsonValue), schemaId: 'SessionWorkLink@1',
        revision: 1, json: JSON.stringify(link) });
    }
    const event = { eventId: 'seed-many-links', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
      occurredAt: at, json: JSON.stringify({ eventId: 'seed-many-links', eventType: 'TrustedScopeSeeded',
        schemaVersion: 1, occurredAt: at }) };
    const seeded = await backend.records.commit({ identityKey: 'seed-many-links', fingerprint: 'seed-many-links',
      guards: records.map(record => ({ refKey: record.refKey, expectedRevision: null })), records,
      events: [event], claims: [], indexGuards: [], indexChanges: [] });
    expect(seeded.status).toBe('committed');
    const card = await sessions.readSession(ctx, { projectId, sessionId });
    if (card.status === 'ready') expect(card.value.links).toHaveLength(601);
    else expect(card).toMatchObject({ status: 'rejected', code: 'capacity' });
  } finally { await backend.close(); }
});
