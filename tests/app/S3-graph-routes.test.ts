/**
 * Slice 3 §5.10 `S3-graph-routes` (RT01–RT06).
 *
 * RT01–RT04 reach the frozen route layer through `parseCoreRouteRequest` /
 * `dispatchCoreRoute`, and RT01–RT06 build the bindings through the real
 * `createPlatformCoreRouteBindings` over observed owner doubles, so the
 * port/receipt/model-start counters are the ones the real forwarding
 * increments. RT01/RT02 additionally assert the exact input + trusted ctx
 * forwarding. RT05 uses the real HTTP listener and token boundary
 * (`createWorkbenchServer`). RT06 pins the legacy `tasks/query`,
 * `executions/history` and `executions/brief` suffix, parse and owner
 * forwarding and proves no model starts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type {
  AttentionGraphReadRequestV1, ContextExtensionsV1, GraphAttentionFactsV1,
} from '../../src/contracts/graph-context.js';
import type {
  GraphContextReadPort, GraphLookRequestV1, GraphFindRequestV1, NodeCardV1, GraphReadPageV1,
} from '../../src/core/work-graph/model/graph-context-contracts.js';
import {
  CORE_ROUTE_SPECS, createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest,
  type CoreRoutePlatform,
} from '../../src/app/core-routes.js';
import { CORE_API_PREFIX, PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import { createWorkbenchServer, type WorkbenchServer } from '../../src/app/server.js';
import { EXPECTED_ROUTE_ROWS, LEGACY_READ_ROUTES } from '../helpers/S6B3-route-suffixes.js';

const SCOPE = { projectId: 'p', workspaceId: 'w' };
const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: 'p', goalId: 'g' };
const TOKEN = 's3-graph-routes-token';
const actor = { kind: 'human' as const, id: 's3-route-operator' };
function hostContext(): CoreCallContext {
  return { projectId: SCOPE.projectId, workspaceId: SCOPE.workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: SCOPE.projectId, workspaceId: SCOPE.workspaceId, actor },
    signal: new AbortController().signal };
}

function emptyIndexes(): ContextExtensionsV1 {
  return { notes: { availability: 'not_implemented', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] },
    anomalies: { availability: 'not_implemented', rows: [] },
    footprint: { availability: 'not_implemented', rows: [] },
    goalSettings: { availability: 'not_implemented', autonomy: null },
    decisions: { availability: 'not_implemented', rows: [] } };
}

function goalCard(): NodeCardV1 {
  return { node: { kind: 'goal', ref: GOAL_REF }, name: 'g', paths: [], summary: 'Ship platform',
    task: null, goal: null, dispatchBasis: null, stage: null, module: null, session: null, run: null, round: null, state: null,
    children: [], neighbours: [], executions: [], rounds: [], inputDeclarations: [],
    indexes: emptyIndexes(), sources: [] };
}

const LOOK_REQUEST: GraphLookRequestV1 = {
  goalRef: GOAL_REF, target: { kind: 'node', node: { kind: 'goal', ref: GOAL_REF } }, relation: 'card',
  page: { afterCursor: null, limit: 20 },
};
const FIND_REQUEST: GraphFindRequestV1 = { goalRef: GOAL_REF, needle: 'B', page: { afterCursor: null, limit: 20 } };

type GraphSpy = {
  port: GraphContextReadPort;
  lookCalls: number; findCalls: number;
  lookArgs: { ctx: CoreCallContext; input: GraphLookRequestV1 }[];
  findArgs: { ctx: CoreCallContext; input: GraphFindRequestV1 }[];
};

function graphSpy(): GraphSpy {
  const spy: GraphSpy = { port: null as unknown as GraphContextReadPort, lookCalls: 0, findCalls: 0, lookArgs: [], findArgs: [] };
  const ready = <T>(items: T[]): ReadResult<GraphReadPageV1<T>> => ({ status: 'ready', value: { items, nextCursor: null, readThrough: null } });
  const unsupported = () => Promise.resolve({ status: 'rejected' as const, code: 'unsupported' as const, reason: 'route test double' });
  spy.port = {
    readContextFacts: unsupported as GraphContextReadPort['readContextFacts'],
    readAttentionFacts: unsupported as unknown as (ctx: CoreCallContext, request: AttentionGraphReadRequestV1) => Promise<ReadResult<GraphAttentionFactsV1>>,
    async lookGraph(ctx, input) { spy.lookCalls += 1; spy.lookArgs.push({ ctx, input }); return ready([goalCard()]); },
    async findGraph(ctx, input) { spy.findCalls += 1; spy.findArgs.push({ ctx, input }); return ready([goalCard()]); },
  };
  return spy;
}

/** A trusted platform double: only `graphContext` is read for these routes; every
 * other group answers an explicit unsupported. */
function routePlatform(graph: GraphContextReadPort): CoreRoutePlatform {
  const group = (): Record<string, unknown> => new Proxy({}, {
    get: () => () => Promise.resolve({ status: 'rejected', code: 'unsupported', reason: 'route test double' }),
  });
  return new Proxy({}, {
    get: (_target, property) => property === 'graphContext' ? graph : group(),
  }) as unknown as CoreRoutePlatform;
}

type ObservedOwner = (...args: never[]) => Promise<unknown>;

/**
 * A trusted platform double whose named groups forward to the SAME observed
 * owner functions the real `createPlatformCoreRouteBindings` binds, so a
 * port/receipt/model-start counter is incremented by the real route forwarding
 * instead of sitting on a spy nothing calls. An unobserved owner (or a group
 * without one) answers an explicit unsupported; `onUnobservedOwner` observes
 * that no such fallback owner was reached.
 */
function observingPlatform(input: {
  graph: GraphContextReadPort;
  groups?: Record<string, Record<string, ObservedOwner>>;
  onUnobservedOwner?: (owner: string) => void;
}): CoreRoutePlatform {
  const rejection = (): { status: 'rejected'; code: 'unsupported'; reason: string } =>
    ({ status: 'rejected', code: 'unsupported', reason: 'route test double' });
  const group = (name: string): Record<string, unknown> => new Proxy(input.groups?.[name] ?? {}, {
    get: (target, property) => {
      if (typeof property === 'string' && property in target) return target[property];
      // A top-level optional owner (`platform.resolveUnknownRun`) is itself read
      // then `.bind`-probed by the factory; that probe is not an owner call.
      if (property === 'bind') return async () => rejection();
      return async () => { input.onUnobservedOwner?.(`${name}.${String(property)}`); return rejection(); };
    },
  });
  return new Proxy({}, {
    get: (_target, property) => property === 'graphContext' ? input.graph : group(String(property)),
  }) as unknown as CoreRoutePlatform;
}

const servers: WorkbenchServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); });

describe('S3 graph routes', () => {
  it('RT01: graph/look plain envelope forwards the original input and the trusted ctx to graphContext.lookGraph and returns a ready card', async () => {
    const spy = graphSpy();
    const bindings = createPlatformCoreRouteBindings(routePlatform(spy.port));
    const ctx = hostContext();
    const parsed = parseCoreRouteRequest('graph/look', { scope: SCOPE, input: LOOK_REQUEST });
    expect(parsed).toMatchObject({ ok: true, kind: 'plain' });
    const result = await dispatchCoreRoute(bindings, 'graph/look', ctx, parsed);
    expect(result).toMatchObject({ status: 'ready', value: { items: [expect.objectContaining({ name: 'g' })], nextCursor: null } });
    expect(spy.lookCalls).toBe(1);
    expect(spy.lookArgs[0]?.ctx).toBe(ctx);
    expect(spy.lookArgs[0]?.input).toEqual(LOOK_REQUEST);
  });

  it('RT02: graph/find plain envelope uses the same findGraph instance and the scope comes from the trusted ctx, not the input', async () => {
    const spy = graphSpy();
    const bindings = createPlatformCoreRouteBindings(routePlatform(spy.port));
    const ctx = hostContext();
    const parsed = parseCoreRouteRequest('graph/find', { scope: SCOPE, input: FIND_REQUEST });
    expect(parsed).toMatchObject({ ok: true, kind: 'plain' });
    const result = await dispatchCoreRoute(bindings, 'graph/find', ctx, parsed);
    expect(result).toMatchObject({ status: 'ready' });
    expect(spy.findCalls).toBe(1);
    expect(spy.findArgs[0]?.ctx.projectId).toBe(SCOPE.projectId);
    expect(spy.findArgs[0]?.ctx.workspaceId).toBe(SCOPE.workspaceId);
    expect(spy.findArgs[0]?.input).toEqual(FIND_REQUEST);
    expect(Object.keys(spy.findArgs[0]?.input as object)).not.toContain('scope');
  });

  it('RT03: an envelope that also carries principal/actor is invalid and calls no port', async () => {
    const spy = graphSpy();
    const bindings = createPlatformCoreRouteBindings(routePlatform(spy.port));
    const ctx = hostContext();
    const parsed = parseCoreRouteRequest('graph/look', {
      scope: SCOPE, input: LOOK_REQUEST,
      principal: { kind: 'host', actor }, actor: { kind: 'human', id: 'attacker' },
    });
    expect(parsed).toMatchObject({ ok: false, rejection: { code: 'invalid' } });
    // The rejected envelope goes through the REAL dispatch: the port counter is
    // observed on the exact bindings the route table would forward to.
    await expect(dispatchCoreRoute(bindings, 'graph/look', ctx, parsed)).rejects.toMatchObject({
      rejection: { status: 'rejected', code: 'invalid' },
    });
    expect(spy.lookCalls).toBe(0);
  });

  it('RT04: a graph_write request package on a read route is invalid and creates no receipt', async () => {
    const spy = graphSpy();
    let receipts = 0;
    const bindings = createPlatformCoreRouteBindings(observingPlatform({
      graph: spy.port,
      onUnobservedOwner: () => { receipts += 1; },
    }));
    const ctx = hostContext();
    const parsed = parseCoreRouteRequest('graph/find', {
      scope: SCOPE,
      request: { input: FIND_REQUEST, meta: { requestId: 'rt04', expected: [] } },
    });
    expect(parsed).toMatchObject({ ok: false, rejection: { code: 'invalid' } });
    expect(CORE_ROUTE_SPECS['graph/find']).toEqual(EXPECTED_ROUTE_ROWS['graph/find']);
    // The write package is dispatched for real: the read port is never called
    // and no receipt-minting write owner is reached.
    await expect(dispatchCoreRoute(bindings, 'graph/find', ctx, parsed)).rejects.toMatchObject({
      rejection: { status: 'rejected', code: 'invalid' },
    });
    expect(spy.findCalls).toBe(0);
    expect(receipts).toBe(0);
  });

  it('RT05: an HTTP graph/look without the platform token is a 403 forbidden and calls no port or model', async () => {
    const spy = graphSpy();
    let modelStarts = 0;
    // The real factory binds the real graph port and the runtime model-entry
    // seams, so both counters are observed, not constants.
    const bindings = createPlatformCoreRouteBindings(observingPlatform({
      graph: spy.port,
      groups: {
        runtime: {
          startRun: async () => { modelStarts += 1; return { status: 'ready', value: {} }; },
          startQuery: async () => { modelStarts += 1; return { status: 'ready', value: {} }; },
        },
      },
    }));
    const server = createWorkbenchServer({ token: TOKEN, bindings, actor,
      bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
      allowsScope: () => true });
    servers.push(server);
    const address = await server.listen(0);
    const response = await fetch(`http://${address.host}:${address.port}${CORE_API_PREFIX}graph/look`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: SCOPE, input: LOOK_REQUEST }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ status: 'rejected', code: 'forbidden',
      reason: 'the local platform token is missing or stale' });
    expect(spy.lookCalls).toBe(0);
    expect(modelStarts).toBe(0);
    // The same body with the token does reach the port.
    const authorized = await fetch(`http://${address.host}:${address.port}${CORE_API_PREFIX}graph/look`, {
      method: 'POST', headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: TOKEN },
      body: JSON.stringify({ scope: SCOPE, input: LOOK_REQUEST }),
    });
    expect(authorized.status).toBe(200);
    expect(spy.lookCalls).toBe(1);
    expect(modelStarts).toBe(0);
  });

  it('RT06: the legacy tasks/query, executions/history and executions/brief suffixes, parsing and owner forwarding are unchanged and start no model', async () => {
    for (const suffix of LEGACY_READ_ROUTES) {
      expect(CORE_ROUTE_SPECS[suffix], suffix).toEqual(EXPECTED_ROUTE_ROWS[suffix]);
    }
    const seen: string[] = [];
    let ownerCalls = 0;
    let modelStarts = 0;
    // The real factory forwards each legacy suffix to its observed owner; the
    // runtime model-entry seams make `modelStarts` an observed counter.
    const bindings = createPlatformCoreRouteBindings(observingPlatform({
      graph: graphSpy().port,
      groups: {
        plans: {
          queryTaskGraph: async () => { seen.push('tasks/query'); ownerCalls += 1;
            return { status: 'ready', value: { graph: null } }; },
        },
        runtime: {
          readTaskExecutionHistory: async () => { seen.push('executions/history'); ownerCalls += 1;
            return { status: 'ready', value: { items: [], nextCursor: null } }; },
          readContinuationBrief: async () => { seen.push('executions/brief'); ownerCalls += 1;
            return { status: 'ready', value: null }; },
          startRun: async () => { modelStarts += 1; return { status: 'ready', value: {} }; },
          startQuery: async () => { modelStarts += 1; return { status: 'ready', value: {} }; },
        },
      },
    }));
    const ctx = hostContext();
    for (const [suffix, input] of [
      ['tasks/query', { goalRef: GOAL_REF }],
      ['executions/history', { runRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r1' } }],
      ['executions/brief', { runRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r1' } }],
    ] as const) {
      const parsed = parseCoreRouteRequest(suffix, { scope: SCOPE, input });
      expect(parsed).toMatchObject({ ok: true, kind: 'plain' });
      const result = await dispatchCoreRoute(bindings, suffix, ctx, parsed);
      expect(result).toMatchObject({ status: 'ready' });
    }
    expect(seen).toEqual(['tasks/query', 'executions/history', 'executions/brief']);
    expect(ownerCalls).toBe(3);
    // The route layer never reaches a model loop; no model request is started.
    expect(modelStarts).toBe(0);
  });
});
