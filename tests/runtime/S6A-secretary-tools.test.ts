/**
 * The plain Query's real tool path and its Query principal, on the frozen
 * request world and the scripted-model Host world.
 *
 * Every row runs a real Query through its public steps (`queries/submit` with
 * its claim, then the public prepare/start that run the Runtime's own model
 * loop), with the model replies the Host's scripted provider serves. The graph
 * reader and the workspace-access factory are wrapped with forwarding spies
 * (rule sheet A3): the call is the production one, and the wrapper only records
 * the principal, the trusted goal and the authorization result it returned.
 *
 * The expected role binding and budgets are the request world's own literals;
 * the source identity hash is hand-computed from the public actor, scope, read
 * prefixes, role binding and execution kind.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type {
  GraphContextReadPort, GraphLookRequestV1,
} from '../../src/core/work-graph/model/graph-context-contracts.js';
import { queryExecutionBindingOf } from '../../src/contracts/query-job.js';
import * as readerModule from '../../src/core/work-graph/views/graph-context-reader.js';
import * as accessModule from '../../src/core/workspace/access.js';
import {
  openS6ARequestWorld, S6A_SCOPE, type S6ABackend, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { seedS6AMemory } from '../helpers/S6A-memory-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];
const HUMAN = { kind: 'human' as const, id: 's6a-operator' };

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

function remember<T extends S6ARequestWorld>(world: T): T {
  worlds.push(world);
  return world;
}

function readValue<T>(answer: unknown): T {
  const result = answer as { status?: string; value?: T; code?: string; reason?: string };
  expect(result.status, JSON.stringify(answer)).toBe('ready');
  if (result.status !== 'ready') throw new Error(`not ready: ${JSON.stringify(answer)}`);
  return result.value as T;
}

describe.each(BACKENDS)('the Query tools and the Query principal on the %s backend', backend => {
  it('a plain Query keeps its read-only tool list and its Job intent binding', async () => {
    const world = remember(await openS6ARequestWorld({ backend }));
    const session = await world.createSecretary('plain-tools');
    const refs = await world.occupy(session);
    await world.finishQuery(refs);

    // The frozen tool list is the prepared set's own list; the model ran once.
    expect(world.model.requests).toHaveLength(1);
    const readPromptRecord = world.platform.runtime.readPromptRecord;
    expect(readPromptRecord).toBeDefined();
    if (readPromptRecord === undefined) return;
    const prompt = await readPromptRecord.call(world.platform.runtime, world.humanContext(), refs.queryRunRef);
    expect(prompt.status).toBe('ready');
    if (prompt.status !== 'ready') return;
    // Today's Query kernel list: the granted builtin read plus the conditional
    // exploration subset, in its declared order, never sorted.
    expect(prompt.value.set.toolNames).toEqual(['read', 'list_files', 'search', 'symbols', 'code_index',
      'project_source', 'python_index', 'cpp_index', 'source_excerpt']);

    const read = await world.post('queries/read', plain(S6A_SCOPE, refs.queryJobRef));
    expect(read.httpStatus).toBe(200);
    const record = read.body as ReadResult<QueryJobRecord>;
    expect(record.status).toBe('ready');
    if (record.status !== 'ready') return;
    // The entry froze exactly the granted tool list of the plain profile.
    expect(record.value.run.run.executionState?.entry?.permissions.tools).toEqual(['read']);
    const intent = record.value.job.job.intent;
    // The intent is the claim's own literal: the secretary binding and the
    // fixture's budgets.
    expect(intent.execution.roleBinding).toEqual({
      schemaVersion: 1, bindingId: 's6a-secretary-binding', templateId: 'platform-secretary',
      templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template',
    });
    expect(intent.execution.runtimeBudget).toEqual({
      contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 16,
      maxToolCalls: 16, timeoutMs: 60000, perResponseTokens: 512,
    });
    expect(intent.budget).toEqual({ maxTokens: 200000, deadline: null });

    // A plain Query reads exactly its Job intent through the ONE reader.
    const binding = queryExecutionBindingOf(record.value.job, record.value.run);
    expect(binding).toEqual({
      roleBinding: {
        schemaVersion: 1, bindingId: 's6a-secretary-binding', templateId: 'platform-secretary',
        templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template',
      },
      runtimeBudget: {
        contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 16,
        maxToolCalls: 16, timeoutMs: 60000, perResponseTokens: 512,
      },
      budget: { maxTokens: 200000, deadline: null },
    });
  });

  it('runs a real look_graph with the plain Query principal and its trusted goal', async () => {
    const looks: { principal: unknown; goalRef: unknown }[] = [];
    const original = readerModule.createGraphContextReader;
    const spy = vi.spyOn(readerModule, 'createGraphContextReader').mockImplementation(deps => {
      const real: GraphContextReadPort = original(deps);
      return {
        ...real,
        async lookGraph(ctx: CoreCallContext, request: GraphLookRequestV1) {
          looks.push({ principal: structuredClone(ctx.principal), goalRef: structuredClone(request.goalRef) });
          return real.lookGraph(ctx, request);
        },
      };
    });
    let world: S6AHostWorld;
    try {
      world = await openS6AHostWorld({ backend, secretaryTools: ['read', 'look_graph', 'find_graph'] });
    } finally {
      spy.mockRestore();
    }
    remember(world);
    await seedS6AMemory(world, { architecture: true, policy: true });
    const session = await world.createSecretary('plain-principal');
    await world.scripted.script(session, [
      { kind: 'calls', calls: [{ callId: 's6a-plain-look', name: 'look_graph', args: { mode: 'path', path: '.' } }] },
      { kind: 'text', text: 'S6A plain principal answer' },
    ]);
    const refs = await world.occupy(session);
    await world.finishQuery(refs);

    // The scripted model called the real tool, and the real reader answered it.
    expect(await world.scripted.requests(session)).toHaveLength(2);
    expect(looks).toHaveLength(1);
    expect(looks[0]?.goalRef).toEqual(world.goals.first);
    // A plain Query's principal names no goal; the Runtime must not add the key.
    expect(Object.prototype.hasOwnProperty.call(looks[0]?.principal, 'goalId')).toBe(false);
    expect(looks[0]?.principal).toEqual({
      kind: 'query_run',
      queryRunRef: { aggregateType: 'QueryRun', ...S6A_SCOPE,
        queryJobId: refs.queryJobRef.queryJobId, runId: refs.queryRunRef.runId },
      initiator: HUMAN,
    });
  });

  it('authorizes a real project_source call with the Query intent role binding', async () => {
    const opened: { subjectKey: string; permissionRevision: string }[] = [];
    const world: S6AHostWorld = await openS6AHostWorld({ backend, secretaryTools: ['read', 'project_source'] });
    remember(world);
    await seedS6AMemory(world, { architecture: true, policy: true });
    const session = await world.createSecretary('plain-source');
    await world.scripted.script(session, [
      { kind: 'calls', calls: [{ callId: 's6a-plain-source', name: 'project_source', args: { action: 'capture' } }] },
      { kind: 'text', text: 'S6A plain source answer' },
    ]);
    const refs = await world.occupy(session);
    // A3: the real access factory, wrapped to observe its real authorization
    // result unchanged; installed before the Query start that opens it.
    const original = accessModule.createWorkspaceAccessFactory;
    const spy = vi.spyOn(accessModule, 'createWorkspaceAccessFactory').mockImplementation(bindings => {
      const real = original(bindings);
      return {
        async open(ctx, workspace) {
          const openedRead = await real.open(ctx, workspace);
          if (openedRead.status === 'ready') {
            opened.push({
              subjectKey: openedRead.value.authorization.subjectKey,
              permissionRevision: openedRead.value.authorization.permissionRevision,
            });
          }
          return openedRead;
        },
      };
    });
    try {
      await world.finishQuery(refs);
    } finally {
      spy.mockRestore();
    }

    // The scripted model's tool call reached the Runtime's own source factory.
    expect(await world.scripted.requests(session)).toHaveLength(2);
    const queryOpens = opened.filter(entry => entry.subjectKey.startsWith('query_run:'));
    expect(queryOpens.length).toBeGreaterThan(0);
    expect(new Set(queryOpens.map(entry => entry.subjectKey)).size).toBe(1);
    // sha256 of the JCS form of { policy: 'query-source-live-v1', role: <the
    // secretary role binding>, kind: 'semantic_query', mount:
    // 'host-permission-v1:c5ad229803586a4e90c394002dda237f0e935f40d834778e2780fa4f49961a13' },
    // where the mount is the Host's own permission for { human: s6a-operator }
    // on this scope with readPrefixes ['.']; computed outside the product.
    expect(queryOpens.every(entry => entry.permissionRevision
      === '131cbc79bdb004cfd06ee985f46fba6cc4fede84925de350b516f31b71d4a5f7')).toBe(true);
    expect(queryOpens[0]?.subjectKey).toMatch(/^query_run:[0-9a-f]{64}$/);
  });
});
