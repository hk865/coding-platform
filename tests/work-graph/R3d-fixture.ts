/** Real R3d Memory/SQLite + WorkspaceTools acceptance fixture. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { GoalRecordTransactionPort, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { OBSERVED_ARCHITECTURE_RECORD_SCHEMAS } from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';

export const projectId = 'observed-project';
export const workspaceId = 'main';
export const workspace: WorkspaceScope = { projectId, workspaceId };
export const actor = { kind: 'human' as const, id: 'architecture-reader' };
export const context: CoreCallContext = {
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
};
export const mappings = [
  { id: 'Alpha', kind: 'module' as const, paths: ['src/alpha.ts'] },
  { id: 'Beta', kind: 'module' as const, paths: ['src/beta.ts'] },
];
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
    ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events,
    ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
    ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events,
    // R3d-observed-boundaries injects this unrelated ledger event to prove the
    // capture's exact scope guards do not stale on an unrelated append.
    { eventType: 'TrustedArchitectureScopeSeeded', schemaVersion: 1,
      validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [...(OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.lookups ?? []),
    ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [])],
};

export async function fixture(kind: 'memory' | 'sqlite') {
  const root = await mkdtemp(join(tmpdir(), 'next-r3d-observed-'));
  await mkdir(join(root, 'src'));
  const sourceFiles = new Map<string, string>([
    ['tsconfig.json', JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', noLib: true }, include: ['src/**/*.ts'] })],
    ['src/alpha.ts', 'import { beta } from "./beta";\nimport { absent } from "./missing";\nexport function alpha() { return beta() + absent; }\n'],
    ['src/beta.ts', 'import { alpha } from "./alpha";\nexport function beta() { return alpha(); }\n'],
  ]);
  await Promise.all([...sourceFiles].map(([name, body]) => writeFile(join(root, name), body)));
  const workspaceRef = { aggregateType: 'Workspace' as const, ...workspace };
  let allowRead = true;
  let allowedPaths: Set<string> | null = null;
  let permissionRevision = 1;
  const access = createWorkspaceAccessFactory({
    resolveRoot: async requested => requested.projectId === projectId && requested.workspaceId === workspaceId
      ? { status: 'ready', value: { root, workspaceRevision: 1 } }
      : { status: 'rejected', code: 'not_found', reason: 'unknown workspace' },
    authorize: async (ctx, requested) => ctx.projectId === projectId && ctx.workspaceId === workspaceId &&
      requested.projectId === projectId && requested.workspaceId === workspaceId &&
      ctx.principal.kind === 'host' && ctx.principal.actor.id === actor.id &&
      ctx.materialReader.kind === 'host' && ctx.materialReader.actor.id === actor.id && allowRead
      ? { status: 'ready', value: { subjectKey: canonicalJson(['host', actor]),
        permissionRevision: `read-v${permissionRevision}`, allowsRead: (name: string) => sourceFiles.has(name) && (allowedPaths === null || allowedPaths.has(name)) } }
      : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' },
  });
  const handle = createWorkspaceTools({ access, now: () => '2026-09-24T00:00:00.000Z',
    limits: DEFAULT_WORKSPACE_LIMITS });
  const ledgerPath = join(root, 'ledger.sqlite');
  const bodyPath = join(root, 'bodies.sqlite');
  let backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas }) :
    createSqliteRecordBackend({ path: ledgerPath, schemas });
  let bodies: RawArtifactStorePort & { close?: () => Promise<void> } = kind === 'memory'
    ? new RawArtifactBodyStore() : createSqliteRawArtifactStore(bodyPath);
  // Scope facts through the real public bootstrap writers, never a raw
  // PreparedCommit: createProject writes Project@1, registerWorkspace writes
  // Workspace@1 after reading that exact Project.
  let bootstrapSequence = 0;
  const bootstrap = createProjectBootstrapServices({ records: backend.records,
    now: () => '2026-09-24T00:00:00.000Z', eventId: () => `r3d-bootstrap-${++bootstrapSequence}` });
  const created = await bootstrap.projects.createProject(context, {
    input: { projectId },
    meta: { requestId: 'r3d-create-project', expected: [
      { ref: { aggregateType: 'Project', projectId }, revision: 0 },
    ] } });
  if (created.status !== 'committed') throw new Error(`Project creation failed: ${JSON.stringify(created)}`);
  const registered = await bootstrap.projects.registerWorkspace(context, {
    input: { workspace },
    meta: { requestId: 'r3d-register-workspace', expected: [
      { ref: created.value.ref, revision: created.value.revision },
      { ref: workspaceRef, revision: 0 },
    ] } });
  if (registered.status !== 'committed') throw new Error(`Workspace registration failed: ${JSON.stringify(registered)}`);
  const deps = () => ({ workspace: handle.tools, access, bodies,
    records: backend.records as GoalRecordTransactionPort & RecordLookupPort,
    source: { provider: 'typescript' as const, configPath: 'tsconfig.json' } });
  return {
    root, sourceFiles, handle, workspaceTools: handle.tools, deps,
    revoke() { allowRead = false; },
    allowOnly(paths: readonly string[]) { allowedPaths = new Set(paths); permissionRevision++; },
    async edit(name: string, body: string) { sourceFiles.set(name, body); await writeFile(join(root, name), body); },
    async reopen() {
      if (kind !== 'sqlite') return;
      await backend.close();
      await bodies.close?.();
      backend = createSqliteRecordBackend({ path: ledgerPath, schemas });
      bodies = createSqliteRawArtifactStore(bodyPath);
    },
    async readRecord(ref: object) { return backend.records.readMany([canonicalJson(ref as JsonValue)]); },
    async close() { await handle.close(); await backend.close(); await bodies.close?.(); await rm(root, { recursive: true, force: true }); },
  };
}

export const capture = (requestId: string, previous: null = null) => ({
  input: { workspace, mappings, previous }, meta: { requestId, expected: [] },
});

