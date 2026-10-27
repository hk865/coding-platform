/**
 * Slice 8A §2 (spec line 319): the three NEW plain architecture read routes
 * `architecture/compare` (observed vs observed), `architecture/compare-formal`
 * (formal catalog vs observed file graph) and `architecture/impact`, each like
 * the existing `architecture/query`.
 *
 * The routes are driven through the same HTTP harness the existing
 * `architecture/query` route test uses (`R6-host.test.ts`): a real
 * `createWorkbenchServer` over the real frozen route table and
 * `createPlatformCoreRouteBindings`. The architecture owner is the REAL
 * `createObservedArchitecture` service built on the existing `R3d-fixture`
 * helper, so a dispatched bad/empty input runs the real service method's own
 * validation (its `invalid` reason names the method) instead of the route
 * layer's unpublished-route `not_found`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CORE_ROUTE_SPECS, createPlatformCoreRouteBindings, type CoreRoutePlatform,
} from '../../src/app/core-routes.js';
import { CORE_API_PREFIX, PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import { createWorkbenchServer, type WorkbenchServer } from '../../src/app/server.js';
import { createObservedArchitecture } from '../../src/core/work-graph/architecture/architecture-service.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { actor, context, fixture, projectId, workspaceId } from '../work-graph/R3d-fixture.js';
import { ARCHITECTURE_READ_ROUTES, EXPECTED_ROUTE_ROWS } from '../helpers/S6B3-route-suffixes.js';

const scope = { projectId, workspaceId };
const TOKEN = 's8a-architecture-routes-token';

/** The S3-style narrow platform double: only `architecture` is real; every other
 * group answers an explicit `unsupported`. */
function routePlatform(architecture: CoreRoutePlatform['architecture']): CoreRoutePlatform {
  const rejection = () => ({ status: 'rejected' as const, code: 'unsupported' as const, reason: 'route test double' });
  const group = (): Record<string, unknown> => new Proxy({}, { get: () => async () => rejection() });
  return new Proxy({}, {
    get: (_target, property) => property === 'architecture' ? architecture : group(),
  }) as unknown as CoreRoutePlatform;
}

const servers: WorkbenchServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); });

async function corePost(base: string, suffix: string, input: unknown): Promise<Response> {
  return fetch(new URL(CORE_API_PREFIX + suffix, base).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: TOKEN },
    body: JSON.stringify({ scope, input }),
  });
}

describe('S8A architecture read routes', () => {
  it('registers the three routes as plain reads bound to their one architecture owner method', () => {
    for (const suffix of ARCHITECTURE_READ_ROUTES) {
      expect(CORE_ROUTE_SPECS[suffix], suffix).toEqual(EXPECTED_ROUTE_ROWS[suffix]);
    }
  });

  it('dispatches a bad/empty input to the real owner method, not an unpublished-route not_found', async () => {
    const fx = await fixture('memory');
    const seen: string[] = [];
    type OwnerName = 'compareArchitecture' | 'compareFormalObserved' | 'queryImpact';
    type OwnerMethod = (ctx: unknown, input: unknown) => Promise<unknown>;
    try {
      const real = createObservedArchitecture(fx.deps());
      const spy = (name: OwnerName): OwnerMethod =>
        async (ctx, input) => {
          seen.push(name);
          return (real[name] as unknown as OwnerMethod)(ctx, input);
        };
      const architecture = {
        ...real,
        // The other two architecture routes are not under test here; their
        // catalog owners stay explicit `unsupported` gaps.
        adoptInitialArchitecture: async () => ({ status: 'rejected', code: 'unsupported', reason: 'route test double' }),
        readArchitectureRevision: async () => ({ status: 'rejected', code: 'unsupported', reason: 'route test double' }),
        compareArchitecture: spy('compareArchitecture'),
        compareFormalObserved: spy('compareFormalObserved'),
        queryImpact: spy('queryImpact'),
      } as unknown as CoreRoutePlatform['architecture'];
      const bindings = createPlatformCoreRouteBindings(routePlatform(architecture));
      const server = createWorkbenchServer({ token: TOKEN, bindings, actor,
        bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
        allowsScope: () => true });
      servers.push(server);
      const address = await server.listen(0);

      for (const [suffix, owner] of [
        ['architecture/compare', 'compareArchitecture'],
        ['architecture/compare-formal', 'compareFormalObserved'],
        ['architecture/impact', 'queryImpact'],
      ] as const) {
        const response = await corePost(address.url, suffix, {});
        expect(response.status).toBe(200);
        const body = await response.json() as { status: string; code?: string; reason?: string };
        // The real service rejects the empty input with its own `invalid`
        // reason; an unpublished route would be a 404 `not_found` instead.
        expect(body).toMatchObject({ status: 'rejected', code: 'invalid' });
        expect(body.reason).toContain(owner);
      }
      // `compare-formal` (and its two siblings) reached the real owner method.
      expect(seen).toEqual(['compareArchitecture', 'compareFormalObserved', 'queryImpact']);
    } finally {
      await fx.close();
    }
  });

  it('A-02b: one successful compare-formal request returns the two exact findings', async () => {
    const fx = await fixture('memory');
    try {
      // The real A-02b cycle fixture: two files, two imports. The fixture's own
      // alpha/beta and tsconfig are permission-filtered out, so the observed
      // graph holds exactly the pair and no extra issue.
      await mkdir(join(fx.root, 'src/a'), { recursive: true });
      await mkdir(join(fx.root, 'src/b'), { recursive: true });
      await fx.edit('src/a/one.ts', 'import { lib } from "../b/lib";\nexport const one = lib;\n');
      await fx.edit('src/b/lib.ts', 'import { one } from "../a/one";\nexport const lib = one;\n');
      fx.allowOnly(['src/a/one.ts', 'src/b/lib.ts']);
      const catalog = createArchitectureCatalogService({ records: fx.deps().records });
      const observed = createObservedArchitecture({ ...fx.deps(),
        source: { provider: 'typescript', configPath: null } });
      const architecture = { ...catalog, ...observed } as unknown as CoreRoutePlatform['architecture'];

      const adopted = await catalog.adoptInitialArchitecture(context, {
        meta: { requestId: 'a02b-route-adopt', expected: [
          { ref: { aggregateType: 'Project', projectId }, revision: 1 },
          { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 },
        ] },
        input: { baselineId: 'a02b-route-baseline', description: 'A-02b route fixture', constraints: [],
          catalog: { requireDag: true, dependencies: [{ from: { projectId, moduleId: 'A' },
            to: { projectId, moduleId: 'B' }, reason: 'A uses B' }], modules: [
            { ref: { projectId, moduleId: 'A' }, name: 'A', responsibility: 'A', paths: ['src/a'], interfaces: [] },
            { ref: { projectId, moduleId: 'B' }, name: 'B', responsibility: 'B', paths: ['src/b'], interfaces: [] },
          ] } },
      });
      expect(adopted).toMatchObject({ status: 'committed' });
      const read = await catalog.readArchitectureRevision(context, { selection: { kind: 'current' } });
      expect(read).toMatchObject({ status: 'ready' });
      if (read.status !== 'ready' || read.value.catalog === null) throw Error('route catalog read failed');
      const pin = { catalogRef: read.value.catalog.ref,
        baseline: { ref: read.value.baseline.ref, digest: read.value.baseline.contentDigest } };

      const captured = await observed.captureSourceChanges(context, {
        input: { workspace: { projectId, workspaceId },
          mappings: [{ id: 'SRC', kind: 'module' as const, paths: ['src'] }], previous: null },
        meta: { requestId: 'a02b-route-capture', expected: [] },
      });
      expect(captured).toMatchObject({ status: 'committed' });
      if (captured.status !== 'committed') throw Error('route capture failed');
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };

      const bindings = createPlatformCoreRouteBindings(routePlatform(architecture));
      const server = createWorkbenchServer({ token: TOKEN, bindings, actor,
        bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
        allowsScope: () => true });
      servers.push(server);
      const address = await server.listen(0);

      const response = await corePost(address.url, 'architecture/compare-formal', { catalog: pin, captureRef });
      expect(response.status).toBe(200);
      const body = await response.json() as { status: string; value?: { noVerdict: boolean; findings: unknown[] } };
      expect(body).toMatchObject({ status: 'ready', value: { noVerdict: true } });
      expect(body.value?.findings).toEqual([
        { kind: 'cycle', moduleRef: null, path: 'src/a/one.ts',
          detail: 'src/a/one.ts ⇄ src/b/lib.ts', certainty: 'proven' },
        { kind: 'import_undeclared', moduleRef: { projectId, moduleId: 'B' },
          path: 'src/b/lib.ts', detail: 'src/a/one.ts', certainty: 'proven' },
      ]);
    } finally {
      await fx.close();
    }
  });
});
