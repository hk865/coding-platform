/** R4b implementation acceptance. These cases are deliberately red while the
 * SessionDirectory and Runtime bridge return unsupported. Do not replace their
 * real stores with an in-process fake to make them pass. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations, type CreateSessionRequest } from '../../src/core/agent-runtime/session-operations.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';

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
/** The public Runtime `createSession` request; the Kernel store pin and the
 * Session identity are issued by the platform, never by the test. */
const sessionCreation = (requestId: string, sessionRole: RoleConfigurationRef = role,
  initialLinks: CreateSessionRequest['initialLinks'] = []): CreateSessionRequest => ({
  workspace, role: sessionRole, recommendedRefs: [], initialLinks,
  meta: { requestId, expected: [] },
});
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
    ...SESSION_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
    { eventType: 'TrustedScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [...(SESSION_RECORD_SCHEMAS.lookups ?? []), ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [])],
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
  // Public Project/Workspace registration and architecture adoption. The
  // Session Runtime is created only after this real scope exists.
  let eventSeq = 0;
  const bootstrap = createProjectBootstrapServices({ records: backend.records,
    now: () => at, eventId: () => `r4b-scope-event-${++eventSeq}` });
  const projectRef = { aggregateType: 'Project' as const, projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
  const created = await bootstrap.projects.createProject(ctx, {
    input: { projectId },
    meta: { requestId: 'r4b-scope-project', expected: [{ ref: projectRef, revision: 0 }] },
  });
  if (created.status !== 'committed') throw new Error(`Project registration failed: ${JSON.stringify(created)}`);
  const registered = await bootstrap.projects.registerWorkspace(ctx, {
    input: { workspace },
    meta: { requestId: 'r4b-scope-workspace-a', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 },
    ] },
  });
  if (registered.status !== 'committed') throw new Error(`Workspace registration failed: ${JSON.stringify(registered)}`);
  const otherWorkspace = { projectId, workspaceId: 'workspace-b' };
  const ctxB: CoreCallContext = { projectId, workspaceId: otherWorkspace.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId: otherWorkspace.workspaceId, actor },
    signal: new AbortController().signal };
  const registeredB = await bootstrap.projects.registerWorkspace(ctxB, {
    input: { workspace: otherWorkspace },
    meta: { requestId: 'r4b-scope-workspace-b', expected: [
      { ref: projectRef, revision: 1 },
      { ref: { aggregateType: 'Workspace' as const, ...otherWorkspace }, revision: 0 },
    ] },
  });
  if (registeredB.status !== 'committed') throw new Error(`workspace B registration failed: ${JSON.stringify(registeredB)}`);
  const modules = [
    { ref: { projectId, moduleId: 'needle-module' }, name: 'needle-module',
      responsibility: 'The bounded directory query target', paths: ['src/needle-module'], interfaces: [] },
    ...Array.from({ length: 601 }, (_, n) => {
      const moduleId = `module-${String(n).padStart(4, '0')}`;
      return { ref: { projectId, moduleId }, name: moduleId,
        responsibility: `Work link target ${moduleId}`, paths: [`src/${moduleId}`], interfaces: [] };
    }),
  ];
  const catalog = createArchitectureCatalogService({ records: backend.records });
  const adopted = await catalog.adoptInitialArchitecture(ctx, {
    input: { baselineId: 'r4b-baseline', description: 'R4b Session boundary modules', constraints: [],
      catalog: { requireDag: true, dependencies: [], modules } },
    meta: { requestId: 'r4b-scope-architecture', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 },
    ] },
  });
  if (adopted.status !== 'committed') throw new Error(`architecture adoption failed: ${JSON.stringify(adopted)}`);
  const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'workspace-kernel', storeKey: 'workspace-key', workspace,
    databasePath: path.join(directory, 'kernel.sqlite'),
  }] });
  const operations = createSessionOperations({ sessions, kernelStores });
  return { backend, sessions, kernelStores, operations, ledgerPath };
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
    const { backend, sessions, operations } = await open(kind);
    try {
      const specRole = { kind: 'role_spec' as const, pin: { ref: {
        aggregateType: 'RoleSpecRevision' as const, projectId, roleId: 'implementer', revision: 1,
      }, digest: 'sha256:matching-role-spec' } };
      const otherRole = { ...specRole, pin: { ...specRole.pin, digest: 'sha256:other-role-spec' } };
      const first = await operations.createSession(ctx, sessionCreation('role-spec-matching', specRole));
      expect(first.status).toBe('completed');
      if (first.status !== 'completed') return;
      const second = await operations.createSession(ctx, sessionCreation('role-spec-other', otherRole));
      expect(second.status).toBe('completed');
      if (second.status !== 'completed') return;
      const found = await sessions.findSessions(ctx, { workspace, role: specRole, includeArchived: false,
        page: { limit: 10 } });
      expect(found.status).toBe('ready');
      if (found.status === 'ready') {
        expect(found.value.items.map(item => item.record.ref.sessionId)).toEqual([first.value.ref.sessionId]);
      }
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

it('finds the matching Session by its target without a directory scan', async () => {
  const { backend, sessions, operations } = await open('memory');
  try {
    const target = { kind: 'module' as const, ref: { projectId, moduleId: 'needle-module' } };
    const created = await operations.createSession(ctx,
      sessionCreation('scan-target-session', role, [{ target, relation: 'responsible' }]));
    expect(created.status).toBe('completed');
    if (created.status !== 'completed') return;
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
    expect(found).toContain(created.value.ref.sessionId);
  } finally { await backend.close(); }
});

it('never presents a Session card with a silently truncated set of 601 persisted links', async () => {
  const { backend, sessions, operations } = await open('memory');
  try {
    const initialLinks = Array.from({ length: 601 }, (_, n) => ({
      target: { kind: 'module' as const, ref: { projectId, moduleId: `module-${String(n).padStart(4, '0')}` } },
      relation: 'responsible' as const,
    }));
    const created = await operations.createSession(ctx, sessionCreation('many-links', role, initialLinks));
    expect(created.status).toBe('completed');
    if (created.status !== 'completed') return;
    const card = await sessions.readSession(ctx, { projectId, sessionId: created.value.ref.sessionId });
    if (card.status === 'ready') expect(card.value.links).toHaveLength(601);
    else expect(card).toMatchObject({ status: 'rejected', code: 'capacity' });
  } finally { await backend.close(); }
});
