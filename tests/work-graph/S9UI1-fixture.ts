/**
 * UI1 architecture-search fixture: the real workspace/bootstrap/catalog/observation
 * owners over the memory or SQLite backend, two workspaces of one project, and the
 * real frozen route table served by `createWorkbenchServer`.
 *
 * Nothing here writes a record by hand. Project and Workspace come from the public
 * bootstrap writers, the catalog from `adoptInitialArchitecture`, and the observed
 * file graph from `captureSourceChanges` over real files in a temporary root. The
 * two rows use only public steps (a route or a public owner) from there.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { CORE_API_PREFIX, PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import {
  createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest,
  type CoreRoutePlatform,
} from '../../src/app/core-routes.js';
import type { CoreRouteSuffix } from '../../src/app/core-http-types.js';
import { createWorkbenchServer, type WorkbenchServer } from '../../src/app/server.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { OBSERVED_ARCHITECTURE_RECORD_SCHEMAS } from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import { createObservedArchitecture } from '../../src/core/work-graph/architecture/architecture-service.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import type { GoalRecordTransactionPort, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';

export const PROJECT_ID = 's9ui1-project';
export const WORKSPACE_A: WorkspaceScope = { projectId: PROJECT_ID, workspaceId: 's9ui1-a' };
export const WORKSPACE_B: WorkspaceScope = { projectId: PROJECT_ID, workspaceId: 's9ui1-b' };
export const ACTOR = { kind: 'human' as const, id: 's9ui1-architecture-reader' };
export const TOKEN = 's9ui1-architecture-search-token';

export type Backend = 'memory' | 'sqlite';
export const BACKENDS: readonly Backend[] = ['memory', 'sqlite'];

const SCHEMAS: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
    ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events,
    ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
    ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: [...(OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.lookups ?? []),
    ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [])],
};

const SOURCE_FILES: Record<string, [string, string]> = {
  'tsconfig.json': ['tsconfig.json', JSON.stringify({
    compilerOptions: { module: 'esnext', moduleResolution: 'bundler', noLib: true }, include: ['src/**/*.ts'],
  })],
  'core/a': ['src/core/a.ts', 'export const a = 1;\n'],
  'core/ab': ['src/core/ab.ts', 'export const ab = 2;\n'],
  'core/abc': ['src/core/abc.ts', 'export const abc = 3;\n'],
  'core/work-graph/b': ['src/core/work-graph/b.ts', 'export const b = 4;\n'],
  'b/b': ['src/core/b.ts', 'export const b = 5;\n'],
};

export type SearchWorld = {
  readonly scopeA: WorkspaceScope;
  readonly scopeB: WorkspaceScope;
  /** Adopt the ONE initial catalog of this project; call at most once per world. */
  adopt(modules: readonly ModuleDefinition[]): Promise<void>;
  /** Capture the named files of one workspace through the real observation owner. */
  capture(scope: WorkspaceScope, paths: readonly string[], requestId: string): Promise<void>;
  /** One core route over HTTP as the Host actor. */
  post(scope: WorkspaceScope, suffix: string, input: unknown): Promise<{ httpStatus: number; body: unknown }>;
  /** One core route in process with a chosen trusted context (the route's scope check). */
  dispatch(ctx: CoreCallContext, scope: WorkspaceScope, suffix: string, input: unknown): Promise<unknown>;
  ctx(scope: WorkspaceScope): CoreCallContext;
  close(): Promise<void>;
};

/** Narrow platform double: only `architecture` is real; every other group refuses explicitly. */
export function routePlatform(architecture: CoreRoutePlatform['architecture']): CoreRoutePlatform {
  const rejection = () => ({ status: 'rejected' as const, code: 'unsupported' as const, reason: 'route test double' });
  const group = (): Record<string, unknown> => new Proxy({}, { get: () => async () => rejection() });
  return new Proxy({}, {
    get: (_target, property) => property === 'architecture' ? architecture : group(),
  }) as unknown as CoreRoutePlatform;
}

export async function openSearchWorld(kind: Backend): Promise<SearchWorld> {
  const rootA = await mkdtemp(join(tmpdir(), 's9ui1-search-a-'));
  const rootB = await mkdtemp(join(tmpdir(), 's9ui1-search-b-'));
  const files = new Map<string, Map<string, string>>([
    [WORKSPACE_A.workspaceId, new Map()],
    [WORKSPACE_B.workspaceId, new Map()],
  ]);
  const roots = new Map<string, string>([
    [WORKSPACE_A.workspaceId, rootA],
    [WORKSPACE_B.workspaceId, rootB],
  ]);
  const allowed = new Map<string, Set<string> | null>([
    [WORKSPACE_A.workspaceId, null],
    [WORKSPACE_B.workspaceId, null],
  ]);
  for (const key of ['tsconfig.json', 'core/a', 'core/ab', 'core/abc', 'core/work-graph/b']) {
    const [path, body] = SOURCE_FILES[key]!;
    files.get(WORKSPACE_A.workspaceId)!.set(path, body);
    await mkdir(dirname(join(rootA, path)), { recursive: true });
    await writeFile(join(rootA, path), body);
  }
  for (const key of ['tsconfig.json', 'b/b']) {
    const [path, body] = SOURCE_FILES[key]!;
    files.get(WORKSPACE_B.workspaceId)!.set(path, body);
    await mkdir(dirname(join(rootB, path)), { recursive: true });
    await writeFile(join(rootB, path), body);
  }

  const access = createWorkspaceAccessFactory({
    resolveRoot: async requested => {
      const root = roots.get(requested.workspaceId);
      return requested.projectId === PROJECT_ID && root !== undefined
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'not_found', reason: 'unknown workspace' };
    },
    authorize: async (ctx, requested) => {
      const source = files.get(requested.workspaceId);
      const permits = ctx.projectId === PROJECT_ID && ctx.workspaceId === requested.workspaceId
        && requested.projectId === PROJECT_ID && requested.workspaceId === ctx.workspaceId
        && ctx.principal.kind === 'host' && ctx.principal.actor.id === ACTOR.id
        && ctx.materialReader.kind === 'host' && ctx.materialReader.actor.id === ACTOR.id
        && source !== undefined;
      const allow = allowed.get(requested.workspaceId) ?? null;
      return permits
        ? { status: 'ready', value: { subjectKey: canonicalJson(['host', ACTOR]),
          permissionRevision: 's9ui1-read-v1', allowsRead: (path: string) => source.has(path) && (allow === null || allow.has(path)) } }
        : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' };
    },
  });
  const handle = createWorkspaceTools({ access, now: () => '2026-11-06T00:00:00.000Z', limits: DEFAULT_WORKSPACE_LIMITS });

  const ledgerPath = join(rootA, 'ledger.sqlite');
  const bodyPath = join(rootA, 'bodies.sqlite');
  let backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas: SCHEMAS })
    : createSqliteRecordBackend({ path: ledgerPath, schemas: SCHEMAS });
  let bodies: RawArtifactStorePort & { close?: () => Promise<void> } = kind === 'memory'
    ? new RawArtifactBodyStore() : createSqliteRawArtifactStore(bodyPath);
  const deps = () => ({ workspace: handle.tools, access, bodies,
    records: backend.records as GoalRecordTransactionPort & RecordLookupPort,
    source: { provider: 'typescript' as const, configPath: null }, catalog });

  let sequence = 0;
  const ctxOf = (scope: WorkspaceScope): CoreCallContext => ({
    projectId: PROJECT_ID, workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: ACTOR },
    materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId: scope.workspaceId, actor: ACTOR },
    signal: new AbortController().signal,
  });
  const bootstrap = createProjectBootstrapServices({ records: backend.records,
    now: () => '2026-11-06T00:00:00.000Z', eventId: () => `s9ui1-bootstrap-${++sequence}` });
  const projectRef = { aggregateType: 'Project' as const, projectId: PROJECT_ID };
  const created = await bootstrap.projects.createProject(ctxOf(WORKSPACE_A),
    { input: { projectId: PROJECT_ID }, meta: { requestId: 's9ui1-project', expected: [{ ref: projectRef, revision: 0 }] } });
  if (created.status !== 'committed') throw new Error(`S9UI1: Project creation failed: ${JSON.stringify(created)}`);
  for (const scope of [WORKSPACE_A, WORKSPACE_B]) {
    const registered = await bootstrap.projects.registerWorkspace(ctxOf(scope),
      { input: { workspace: scope }, meta: { requestId: `s9ui1-workspace-${scope.workspaceId}`,
        expected: [{ ref: projectRef, revision: 1 },
          { ref: { aggregateType: 'Workspace' as const, ...scope }, revision: 0 }] } });
    if (registered.status !== 'committed') throw new Error(`S9UI1: Workspace registration failed: ${JSON.stringify(registered)}`);
  }

  const catalog = createArchitectureCatalogService({ records: backend.records });
  const observed = createObservedArchitecture(deps());
  let adopted = false;
  const architecture = { ...catalog, ...observed } as unknown as CoreRoutePlatform['architecture'];
  const server: WorkbenchServer = createWorkbenchServer({
    token: TOKEN, bindings: () => createPlatformCoreRouteBindings(routePlatform(architecture)), actor: ACTOR,
    bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
    allowsScope: () => true,
  });
  const address = await server.listen(0);

  return {
    scopeA: WORKSPACE_A, scopeB: WORKSPACE_B,
    async adopt(modules) {
      if (adopted) throw new Error('S9UI1: the one initial catalog was already adopted');
      const pinned = await catalog.adoptInitialArchitecture(ctxOf(WORKSPACE_A), {
        meta: { requestId: 's9ui1-adopt', expected: [
          { ref: projectRef, revision: 1 },
          { ref: { aggregateType: 'Workspace' as const, ...WORKSPACE_A }, revision: 1 },
        ] },
        input: { baselineId: 's9ui1-baseline', description: 'UI1 architecture-search fixture',
          constraints: [], catalog: { requireDag: true, dependencies: [], modules: [...modules] } },
      });
      if (pinned.status !== 'committed') throw new Error(`S9UI1: catalog adoption failed: ${JSON.stringify(pinned)}`);
      adopted = true;
    },
    async capture(scope, paths, requestId) {
      allowed.set(scope.workspaceId, new Set(paths));
      const captured = await observed.captureSourceChanges(ctxOf(scope), {
        input: { workspace: scope, mappings: [{ id: 'SRC', kind: 'module', paths: ['src'] }], previous: null },
        meta: { requestId, expected: [] },
      });
      if (captured.status !== 'committed') throw new Error(`S9UI1: capture failed: ${JSON.stringify(captured)}`);
    },
    async post(scope, suffix, input) {
      const response = await fetch(new URL(CORE_API_PREFIX + suffix, address.url).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: TOKEN },
        body: JSON.stringify({ scope, input }),
      });
      return { httpStatus: response.status, body: await response.json() as unknown };
    },
    async dispatch(ctx, scope, suffix, input) {
      return await dispatchCoreRoute(createPlatformCoreRouteBindings(routePlatform(architecture)),
        suffix as CoreRouteSuffix, ctx, parseCoreRouteRequest(suffix as CoreRouteSuffix, { scope, input }));
    },
    ctx: ctxOf,
    async close() {
      await server.close();
      await handle.close();
      await backend.close();
      await bodies.close?.();
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    },
  };
}
