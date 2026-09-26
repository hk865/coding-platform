/** Independent A1 product-path acceptance. Only the trusted Project/Workspace
 * bootstrap is seeded; catalog, Kernel Sessions, links and lifecycle changes
 * must be produced by the public composition. No model call or fake producer. */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, SessionWorkLinkRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeProjectSnapshot,
  encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import type {
  AdoptedArchitecture, AdoptInitialArchitectureInput, ReviseArchitectureCatalogInput,
} from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/sessions/contracts.js';
import type { ArchiveSessionInput, LinkSessionWorkInput } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import type { CreateSessionRequest } from '../../src/core/agent-runtime/session-operations.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const at = '2026-09-25T00:00:00.000Z';
const projectId = 'a1-platform-project';
const workspaceId = 'a1-platform-workspace';
const scope = { projectId, workspaceId };
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'a1-platform-operator' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const target: WorkLinkTarget = { kind: 'module', ref: { projectId, moduleId: 'source-tools' } };
const role = { kind: 'legacy_template' as const, templateId: 'source-investigator', templateRevision: '1' };
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function seedTrustedScope(directory: string): Promise<void> {
  const schemas: RecordBackendSchemas = { ...GOAL_RECORD_SCHEMAS,
    events: [...GOAL_RECORD_SCHEMAS.events, { eventType: 'TrustedScopeSeeded', schemaVersion: 1,
      validate: event => ({ status: 'decoded', value: event }) }] };
  const backend = createSqliteRecordBackend({ path: join(directory, 'ledger.sqlite'), schemas });
  const seed: PreparedCommit = { identityKey: 'a1-platform-scope-seed', fingerprint: 'a1-platform-scope-v1',
    guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
      { refKey: canonicalRefKey(workspace.ref), expectedRevision: null }],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace)],
    events: [{ eventId: 'a1-platform-scope-event', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
      occurredAt: at, json: JSON.stringify({ eventId: 'a1-platform-scope-event',
        eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at }) }],
    claims: [], indexGuards: [], indexChanges: [] };
  try { expect(await backend.records.commit(seed)).toMatchObject({ status: 'committed' }); }
  finally { await backend.close(); }
}

it('creates before a baseline, discovers module-linked Sessions, and preserves identity/history through archive and reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-a1-graph-session-platform-'));
  directories.push(directory);
  await seedTrustedScope(directory);
  const workspaceBindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === projectId && requested.workspaceId === workspaceId
        ? { status: 'ready', value: { root: directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
    },
    async authorize() { return { status: 'rejected', code: 'forbidden', reason: 'no source grant is needed' }; },
  };
  const options = { storage: { kind: 'sqlite' as const, directory }, workspace: workspaceBindings,
    now: () => at, kernelStores: { entries: [{ adapterId: 'a1-platform-kernel',
      storeKey: 'a1-platform-kernel-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] } };
  let platform = await createTargetPlatform(options);
  try {
    // Starting an independent working Session does not need a global catalog,
    // accepted Plan, synthetic Task or permanent Agent registration.
    const createRequest: CreateSessionRequest = { workspace: scope, role, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 'a1-before-catalog-session', expected: [] } };
    const created = await platform.runtime.createSession(ctx, createRequest);
    expect(created).toMatchObject({ status: 'completed', replayed: false,
      value: { lifecycle: 'active', health: 'available', occupancy: null, role } });
    if (created.status !== 'completed') throw Error('real Kernel Session creation failed');
    const sessionRef: SessionRef = { projectId, sessionId: created.value.ref.sessionId };
    const originalMapping = created.value.kernel;
    const originalHistory = await platform.runtime.readSessionHistory(ctx, { sessionRef,
      afterCursor: null, throughCursor: null, limit: 10 });
    expect(originalHistory).toMatchObject({ status: 'ready', value: { items: [
      { kind: 'session_created', source: { adapterId: originalMapping.adapterId,
        kernelSessionId: originalMapping.kernelSessionId, position: 1 } },
    ] } });
    if (originalHistory.status !== 'ready') throw Error('original Kernel history is unavailable');
    expect(originalHistory.value.items).toHaveLength(1);

    const adoptRequest: GraphWrite<AdoptInitialArchitectureInput> = { meta: {
      requestId: 'a1-platform-adopt-catalog', expected: [
        { ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 },
      ] }, input: { baselineId: 'a1-platform-baseline', description: 'An adopted source-tools responsibility',
      constraints: [], catalog: { requireDag: true, dependencies: [], modules: [
        { ref: target.ref, name: 'Source tools', responsibility: 'Read and compare project sources',
          paths: ['src/source-tools'], interfaces: [{ id: 'source-read', description: 'Read exact sources',
            paths: ['src/source-tools/index.ts'] }] },
      ] } } };
    const adopted = await platform.architecture.adoptInitialArchitecture(ctx, adoptRequest);
    expect(adopted).toMatchObject({ status: 'committed', replayed: false });
    if (adopted.status !== 'committed') throw Error('formal catalog adoption failed');
    const currentArchitecture = await platform.architecture.readArchitectureRevision(ctx,
      { selection: { kind: 'current' } });
    expect(currentArchitecture).toMatchObject({ status: 'ready', value: adopted.value });

    const linkRef: SessionWorkLinkRef = { ...sessionRef, aggregateType: 'SessionWorkLink',
      target, relation: 'responsible' };
    const linkRequest: GraphWrite<LinkSessionWorkInput> = { meta: {
      requestId: 'a1-platform-link-module', expected: [
        { ref: created.value.ref, revision: created.value.revision },
        { ref: linkRef, revision: 0 }, // Explicit absent pin, not an optimistic default.
      ] }, input: { sessionRef, target, relation: 'responsible', active: true } };
    const linked = await platform.sessions.linkSessionWork(ctx, linkRequest);
    expect(linked).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: linkRef, until: null } });
    if (linked.status !== 'committed') throw Error('public Session link operation failed');
    const discovery = { workspace: scope, target, includeArchived: false, page: { limit: 10 } };
    const found = await platform.sessions.findSessions(ctx, discovery);
    expect(found).toMatchObject({ status: 'ready', value: { items: [
      { availability: 'idle', record: { ref: created.value.ref, kernel: originalMapping }, links: [linked.value] },
    ] } });
    if (found.status !== 'ready') throw Error('module Session discovery failed');
    expect(found.value.items).toHaveLength(1);
    const beforeArchive = found.value.items[0]!;

    // Initial links use the same real catalog validation as a later link write.
    // A module is a discovery relation, not a unique-owner lock.
    const secondRequest: CreateSessionRequest = { workspace: scope, role, recommendedRefs: [],
      initialLinks: [{ target, relation: 'participates' }],
      meta: { requestId: 'a1-created-with-module', expected: [] } };
    const second = await platform.runtime.createSession(ctx, secondRequest);
    expect(second).toMatchObject({ status: 'completed', replayed: false });
    if (second.status !== 'completed') throw Error('Kernel creation with an initial module link failed');
    expect(second.value.ref.sessionId).not.toBe(sessionRef.sessionId);
    expect(second.value.kernel.kernelSessionId).not.toBe(originalMapping.kernelSessionId);
    const two = await platform.sessions.findSessions(ctx, discovery);
    if (two.status !== 'ready') throw Error('parallel Session discovery failed');
    expect(two.value.items.map(card => card.record.ref.sessionId).sort())
      .toEqual([sessionRef.sessionId, second.value.ref.sessionId].sort());
    expect(two.value.items.every(card => card.availability === 'idle')).toBe(true);

    const archiveRequest: GraphWrite<ArchiveSessionInput> = { meta: {
      requestId: 'a1-explicit-archive', expected: [
        { ref: beforeArchive.record.ref, revision: beforeArchive.record.revision },
      ] }, input: { sessionRef, reason: 'Explicitly leave the current consultation set' } };
    const archived = await platform.sessions.archiveSession(ctx, archiveRequest);
    expect(archived).toMatchObject({ status: 'committed', replayed: false,
      value: { lifecycle: 'archived', kernel: originalMapping, occupancy: null,
        health: beforeArchive.record.health, historyCursor: beforeArchive.record.historyCursor } });
    if (archived.status !== 'committed') throw Error('public archive failed');
    const active = await platform.sessions.findSessions(ctx, discovery);
    if (active.status !== 'ready') throw Error('active Session discovery failed');
    expect(active.value.items.map(card => card.record.ref.sessionId)).toEqual([second.value.ref.sessionId]);
    const historical = await platform.sessions.findSessions(ctx, { ...discovery, includeArchived: true });
    if (historical.status !== 'ready') throw Error('historical module associations are unavailable');
    expect(historical.value.items.map(card => card.record.ref.sessionId).sort())
      .toEqual([sessionRef.sessionId, second.value.ref.sessionId].sort());
    expect(historical.value.items.find(card => card.record.ref.sessionId === sessionRef.sessionId)?.links)
      .toEqual(beforeArchive.links);
    expect(await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } }))
      .toMatchObject({ status: 'ready', value: adopted.value });

    await platform.close();
    platform = await createTargetPlatform(options);
    const reopened = await platform.sessions.readSession(ctx, sessionRef);
    expect(reopened).toMatchObject({ status: 'ready', value: {
      record: archived.value, links: beforeArchive.links,
    } });
    const reopenedHistory = await platform.runtime.readSessionHistory(ctx, { sessionRef,
      afterCursor: null, throughCursor: null, limit: 10 });
    if (reopenedHistory.status !== 'ready') throw Error('archived original Session history is unavailable');
    expect(reopenedHistory.value.items).toEqual(originalHistory.value.items);

    // The composed lifecycle operation must drain as one operation before Store
    // close, and new calls after close must not reach a closed backend.
    const pendingReactivation = platform.sessions.reactivateSession(ctx, { meta: {
      requestId: 'a1-explicit-reactivate', expected: [{ ref: archived.value.ref, revision: archived.value.revision }],
    }, input: { sessionRef, reason: 'Consult the existing working context again' } });
    const closing = platform.close();
    const reactivated = await pendingReactivation;
    expect(reactivated).toMatchObject({ status: 'committed', replayed: false, value: {
      lifecycle: 'active', archivedAt: null, kernel: originalMapping, occupancy: null,
      health: beforeArchive.record.health, historyCursor: beforeArchive.record.historyCursor,
    } });
    if (reactivated.status !== 'committed') throw Error('reactivation did not drain before close');
    await closing;
    expect(await platform.sessions.archiveSession(ctx, archiveRequest))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });

    platform = await createTargetPlatform(options);
    // Same original request must replay the ORIGINAL archived result. It must
    // neither read current active as its old receipt nor archive the Session twice.
    expect(await platform.sessions.archiveSession(ctx, archiveRequest)).toEqual({ ...archived, replayed: true });
    expect(await platform.sessions.readSession(ctx, sessionRef)).toMatchObject({ status: 'ready', value: {
      record: reactivated.value, availability: 'idle', links: beforeArchive.links,
    } });
    const finalDiscovery = await platform.sessions.findSessions(ctx, discovery);
    if (finalDiscovery.status !== 'ready') throw Error('reactivated module discovery failed');
    expect(finalDiscovery.value.items.map(card => card.record.ref.sessionId).sort())
      .toEqual([sessionRef.sessionId, second.value.ref.sessionId].sort());
    const finalHistory = await platform.runtime.readSessionHistory(ctx, { sessionRef,
      afterCursor: null, throughCursor: null, limit: 10 });
    if (finalHistory.status !== 'ready') throw Error('reactivated original Session history is unavailable');
    expect(finalHistory.value.items).toEqual(originalHistory.value.items);
    expect(await platform.architecture.readArchitectureRevision(ctx,
      { selection: { kind: 'revision', ref: adopted.value.baseline.ref } }))
      .toMatchObject({ status: 'ready', value: adopted.value });
  } finally { await platform.close(); }
});

it('revises the adopted catalog with explicit containment, links the new module, and replays across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-a1-catalog-revise-'));
  directories.push(directory);
  const workspaceBindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === projectId && requested.workspaceId === workspaceId
        ? { status: 'ready', value: { root: directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
    },
    // Pure directory maintenance must not need a source grant.
    async authorize() { return { status: 'rejected', code: 'forbidden', reason: 'no source grant is needed' }; },
  };
  const options = { storage: { kind: 'sqlite' as const, directory }, workspace: workspaceBindings,
    now: () => at, kernelStores: { entries: [{ adapterId: 'a1-revise-kernel',
      storeKey: 'a1-revise-kernel-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] } };
  let platform = await createTargetPlatform(options);
  try {
    // 1. The real public Host writers create the scope: no raw Store seed.
    const createdProject = await platform.projects.createProject(ctx, { meta: {
      requestId: 'a1-revise-create-project', expected: [{ ref: project.ref, revision: 0 }],
    }, input: { projectId } });
    expect(createdProject).toMatchObject({ status: 'committed', replayed: false, value: project });
    const registeredWorkspace = await platform.projects.registerWorkspace(ctx, { meta: {
      requestId: 'a1-revise-register-workspace',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 0 }],
    }, input: { workspace: scope } });
    expect(registeredWorkspace).toMatchObject({ status: 'committed', replayed: false, value: workspace });

    // 2. The initial adoption uses the legacy three-field catalog: the
    // containment key is absent and must stay absent, never a guessed tree.
    const parentModule = { ref: target.ref, name: 'Source tools',
      responsibility: 'Read and compare project sources', paths: ['src/source-tools'],
      interfaces: [{ id: 'source-read', description: 'Read exact sources', paths: ['src/source-tools/index.ts'] }] };
    const adoptRequest: GraphWrite<AdoptInitialArchitectureInput> = { meta: {
      requestId: 'a1-revise-adopt', expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }],
    }, input: { baselineId: 'a1-revise-baseline', description: 'An adopted source-tools responsibility',
      constraints: [{ name: 'formal DAG', scope: 'project' }],
      catalog: { requireDag: true, dependencies: [], modules: [parentModule] } } };
    const adopted = await platform.architecture.adoptInitialArchitecture(ctx, adoptRequest);
    expect(adopted).toMatchObject({ status: 'committed', replayed: false });
    if (adopted.status !== 'committed') throw Error('formal catalog adoption failed');
    expect(adopted.value.catalog?.catalog).toEqual({ requireDag: true, dependencies: [], modules: [parentModule] });
    expect(adopted.value.catalog?.catalog.containment).toBeUndefined();

    // 3. Revise the same catalog: keep the original module, add one child, and
    // declare containment explicitly. The paths do not nest and the dependency
    // edge is independent, so the result must carry the declared parent edge
    // instead of a tree guessed from paths or dependencies.
    const childModule = { ref: { projectId, moduleId: 'source-index' }, name: 'Source index',
      responsibility: 'Index the mapped sources', paths: ['src/other-index'],
      interfaces: [{ id: 'index-read', description: 'Read the index', paths: ['src/other-index/index.ts'] }] };
    const revisedCatalog: AdoptedArchitecture = {
      requireDag: true,
      dependencies: [{ from: childModule.ref, to: parentModule.ref, reason: 'the index builds on the shared reader' }],
      modules: [parentModule, childModule],
      containment: { parentOf: [{ parent: parentModule.ref, child: childModule.ref }] },
    };
    const reviseRequest: GraphWrite<ReviseArchitectureCatalogInput> = { meta: {
      requestId: 'a1-revise-catalog', expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }],
    }, input: { basedOn: { ref: adopted.value.baseline.ref, digest: adopted.value.baseline.contentDigest },
      catalog: revisedCatalog, reason: 'Declare the source index under the source tools parent' } };
    const revised = await platform.architecture.reviseArchitectureCatalog(ctx, reviseRequest);
    expect(revised).toMatchObject({ status: 'committed', replayed: false });
    if (revised.status !== 'committed') throw Error('formal catalog revision failed');
    expect(revised.value.baseline.ref).toEqual({ ...adopted.value.baseline.ref, revision: 2 });
    expect(revised.value.baseline.contentRevision).toBe(2);
    expect(revised.value.baseline.content).toEqual(adopted.value.baseline.content);
    expect(revised.value.catalog?.catalog.containment)
      .toEqual({ parentOf: [{ parent: parentModule.ref, child: childModule.ref }] });

    // 4. The new current revision carries the declaration; the old revision
    // still has no containment and no added module, and its baseline content is
    // unchanged. History is not rewritten by the revision.
    const current = await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    expect(current).toMatchObject({ status: 'ready', value: revised.value });
    if (current.status !== 'ready') throw Error('current revised catalog is unavailable');
    expect(current.value.catalog?.catalog.modules.map(module => module.ref.moduleId))
      .toEqual([parentModule.ref.moduleId, childModule.ref.moduleId]);
    const historical = await platform.architecture.readArchitectureRevision(ctx,
      { selection: { kind: 'revision', ref: adopted.value.baseline.ref } });
    expect(historical).toMatchObject({ status: 'ready', value: adopted.value });
    if (historical.status !== 'ready') throw Error('historical adopted catalog is unavailable');
    expect(historical.value.catalog?.catalog.containment).toBeUndefined();
    expect(historical.value.catalog?.catalog.modules.map(module => module.ref.moduleId))
      .toEqual([parentModule.ref.moduleId]);

    // 5. A real Kernel Session links the NEW module and is discovered by that
    // target; the directory revision does not rewrite its role or occupancy.
    const createRequest: CreateSessionRequest = { workspace: scope, role, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 'a1-revise-session', expected: [] } };
    const created = await platform.runtime.createSession(ctx, createRequest);
    expect(created).toMatchObject({ status: 'completed', replayed: false,
      value: { lifecycle: 'active', occupancy: null, role } });
    if (created.status !== 'completed') throw Error('real Kernel Session creation failed');
    const sessionRef: SessionRef = { projectId, sessionId: created.value.ref.sessionId };
    const revisedTarget: WorkLinkTarget = { kind: 'module', ref: childModule.ref };
    const linkRef: SessionWorkLinkRef = { ...sessionRef, aggregateType: 'SessionWorkLink',
      target: revisedTarget, relation: 'responsible' };
    const linkRequest: GraphWrite<LinkSessionWorkInput> = { meta: {
      requestId: 'a1-revise-link', expected: [
        { ref: created.value.ref, revision: created.value.revision },
        { ref: linkRef, revision: 0 },
      ] }, input: { sessionRef, target: revisedTarget, relation: 'responsible', active: true } };
    const linked = await platform.sessions.linkSessionWork(ctx, linkRequest);
    expect(linked).toMatchObject({ status: 'committed', replayed: false, value: { ref: linkRef, until: null } });
    if (linked.status !== 'committed') throw Error('public Session link to the revised module failed');
    const found = await platform.sessions.findSessions(ctx,
      { workspace: scope, target: revisedTarget, includeArchived: false, page: { limit: 10 } });
    expect(found).toMatchObject({ status: 'ready', value: { items: [
      { availability: 'idle', record: { ref: created.value.ref, occupancy: null }, links: [linked.value] },
    ] } });
    if (found.status !== 'ready') throw Error('revised-module Session discovery failed');
    expect(found.value.items).toHaveLength(1);

    // 6. Reopen the same database and replay the original revise request: the
    // original event restores the exact revision, not a new version and not a
    // receipt recomputed from the later active pointer.
    await platform.close();
    platform = await createTargetPlatform(options);
    expect(await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } }))
      .toMatchObject({ status: 'ready', value: revised.value });
    expect(await platform.architecture.readArchitectureRevision(ctx,
      { selection: { kind: 'revision', ref: adopted.value.baseline.ref } }))
      .toMatchObject({ status: 'ready', value: adopted.value });
    const replayed = await platform.architecture.reviseArchitectureCatalog(ctx, reviseRequest);
    expect(replayed).toEqual({ ...revised, replayed: true });
  } finally { await platform.close(); }
});
