/**
 * Slice 3 §5.8: the graph read tools `look_graph` / `find_graph` (§4.4).
 *
 * Every case reaches the code under test through the REAL tool factory
 * `createGraphTools(...).create(...)` — never a mock of the adapter. The
 * dependency ports (`graph`, `inputs`, `history`) are recording fakes because
 * the adapter is the unit here; the owner services have their own slice tests.
 *
 * Part 1 ships the failing tests only: `GraphTools.create` is a stub that throws
 * `not implemented: GraphTools.create`, so each case below is RED for exactly
 * that reason and is frozen for the implementation phase.
 */
import { describe, expect, it, vi } from 'vitest';
import { createGraphTools, GRAPH_TOOL_NAMES, type GraphToolsConfig } from '../../src/core/agent-runtime/graph-tools.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type {
  ContextExtensionsV1, GraphNodeRefV1, InputSelectionV1,
  TaskInputPageRequestV1, TaskInputPageV1,
} from '../../src/contracts/graph-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type {
  GraphContextReadPort, GraphFindRequestV1, GraphLookRequestV1, GraphReadPageV1, NodeCardV1,
} from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { InputDeclarationV1 } from '../../src/contracts/graph-context.js';
import type { TaskContextInputPort } from '../../src/core/work-graph/model/context-input-contracts.js';
import type {
  ExecutionHistoryPage, GraphExecutionHistoryReadPort, TaskExecutionHistoryRequest,
} from '../../src/core/agent-runtime/execution-history-contracts.js';
import type {
  MemoryConflictsRequest, MemoryFindRequest, MemoryHistoryRequest, MemoryHistoryResultV1, MemoryLookupRequest,
  MemoryLookupResultV1, MemoryNeighborsRequest, MemoryResultV1, MemoryStaleRequest, NoteMemoryReadPort,
} from '../../src/core/work-graph/model/note-contracts.js';
import type { ToolCall, ToolDefinition, ToolResult, WorkspaceSandbox, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
// Real exact-input owner fixture (§5.1 / §5.3 pattern): the graph tools' input
// row must forward into the REAL `createTaskContextInputService`, not into a
// fake that answers by cursor.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RoleConfigurationRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type {
  RoleBindingRefV1, SourceRefV1, TaskBudgetV1,
} from '../../src/contracts/dispatch.js';
import type { InitialPlanningResponseV2 } from '../../src/contracts/initial-planning.js';
// The real Query runtime seam (R5b pattern) and the driver/RT8 observation seam.
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import type { RecordCommitNotice } from '../../src/composition/commit-observer.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import { createScriptedModel, type ScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_PROJECT_REF, AG2B_QUERY_ROLE, AG2B_QUERY_ROLE_BINDING,
  AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, AG2B_WORKSPACE_REF, AG2B_WORK_TASK_ID, AG2B_RUNTIME_BUDGET,
  ag2bChecksConfiguration, permissionRevision, writeAG2bWorkspace,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  AG2B_WORK_TOOLS, ag2bWorkRuntime, ag2bWorkspaceBindings, hostCtx, performs, seedThroughOwners,
} from '../scenarios/harness.js';

/**
 * The graph tools reach RT8 through the driver's narrow proxy. RT8 is a
 * dependency this row observes, so it is replaced at its module boundary while
 * the graph tool factory, the driver proxy and the runtime stay real.
 */
const gtRt8 = vi.hoisted(() => ({
  calls: [] as Array<{ ctx: CoreCallContext; request: TaskExecutionHistoryRequest }>,
  page: null as ExecutionHistoryPage | null,
}));
vi.mock('../../src/core/agent-runtime/graph-execution-history.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/core/agent-runtime/graph-execution-history.js')>();
  return {
    ...original,
    createGraphExecutionHistoryReader: () => ({
      async readTaskExecutionHistory(ctx: CoreCallContext, request: TaskExecutionHistoryRequest) {
        gtRt8.calls.push({ ctx, request });
        const page = gtRt8.page ?? {
          items: [], nextCursor: null, basis: { kind: 'platform' as const, cursor: cursor('c1') },
          executionIdentity: { runId: 'runB', turnId: 'turn-1' }, scannedCount: 0,
        };
        return { status: 'ready' as const, value: page };
      },
    }),
  };
});

const P = 'p';
const W = 'w';
const G = 'g';
const B = (value: string): number => Buffer.byteLength(value, 'utf8');
const cursor = (value: string): CommitCursor => value as CommitCursor;
const signal = (): AbortSignal => new AbortController().signal;
/** R-19: the converted input rows (GT07/GT08/GT09/GT13) run on both backends. */
const STORAGE_KINDS = ['memory', 'sqlite'] as const;
type StorageKind = typeof STORAGE_KINDS[number];

const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: P, goalId: G };
const PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'p1' };
const RUN_A: RunRef = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'runA' };
const RUN_B: RunRef = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'runB' };
const T_A: TaskTriple = { projectId: P, goalId: G, taskId: 'tA' };
const T_B: TaskTriple = { projectId: P, goalId: G, taskId: 'tB' };
const HUMAN = { kind: 'human' as const, id: 'u' };

// SHA-256 of the UTF-8 bytes of 'old-A' (6f 6c 64 2d 41, 5 bytes), lowercase hex,
// computed outside the product (`printf 'old-A' | sha256sum`).
const OLD_A: ArtifactRef = {
  kind: 'artifact', contentType: 'text/plain',
  digest: 'dd7a346236273d4fd019c7bf806b00a7eea9d992583b6aed9ed2231cf345f4b7', sizeBytes: 5,
  source: { kind: 'workspace', refId: W, revision: '7' },
};

function workContext(signalValue: AbortSignal): CoreCallContext {
  return {
    projectId: P, workspaceId: W,
    principal: {
      kind: 'work_run', runRef: { ...RUN_B },
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 'executor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' },
    },
    materialReader: { kind: 'run', requester: { ...RUN_B } },
    signal: signalValue,
  };
}

function toolCall(name: string, callId: string, args: Record<string, unknown>): ToolCall {
  return { schemaVersion: 1, callId, name, arguments: args as ToolCall['arguments'] };
}

function outputValue(result: ToolResult): unknown {
  const first = result.output[0];
  return first !== undefined && first.kind === 'json' ? first.value : undefined;
}

function emptyIndexes(): ContextExtensionsV1 {
  const empty = { availability: 'not_implemented' as const, rows: [] };
  return {
    notes: { availability: 'not_implemented', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] },
    anomalies: { ...empty }, footprint: { ...empty },
    goalSettings: { availability: 'not_implemented', autonomy: null }, decisions: { ...empty },
  };
}

function nodeCard(node: GraphNodeRefV1, overrides: Partial<NodeCardV1> = {}): NodeCardV1 {
  return {
    node, name: 'B', paths: [], summary: 'Build B',
    task: null, goal: null, stage: null, module: null, session: null, run: null, round: null,
    state: 'ready', children: [], neighbours: [], executions: [], rounds: [],
    inputDeclarations: [], indexes: emptyIndexes(), sources: [],
    ...overrides,
  };
}

function readyPage(cards: NodeCardV1[], nextCursor: string | null = null): ReadResult<GraphReadPageV1<NodeCardV1>> {
  return { status: 'ready', value: { items: cards, nextCursor, readThrough: cursor('c1') } };
}

function declaration(declarationId: string): InputDeclarationV1 {
  return {
    declarationId, consumer: { ...T_B }, planRef: { ...PLAN_REF }, upstream: { ...T_A },
    requires: { kind: 'artifact', label: 'A.out' }, legacyArtifactRef: { ...OLD_A },
  };
}

function selection(source: InputSelectionV1['source']): InputSelectionV1 {
  return {
    declaration: declaration('r1'), state: source === null ? 'missing' : 'selected',
    source, candidates: source === null ? [] : [source], usage: 'historical_explanation',
    reason: null, errorCode: null,
  };
}

function inputPage(body: string | null, nextCursor: string | null, source: InputSelectionV1['source']): TaskInputPageV1 {
  return { selection: selection(source), body, nextCursor, selectedTaskInputs: [] };
}

function historyPage(scannedCount: number): ExecutionHistoryPage {
  return {
    items: [], nextCursor: null, basis: { kind: 'platform', cursor: cursor('c1') },
    executionIdentity: { runId: 'runB', turnId: 'turn-1' }, scannedCount,
  };
}

type RecordedCalls = {
  look: { ctx: CoreCallContext; request: GraphLookRequestV1 }[];
  find: { ctx: CoreCallContext; request: GraphFindRequestV1 }[];
  history: { ctx: CoreCallContext; request: TaskExecutionHistoryRequest }[];
  inputPages: { ctx: CoreCallContext; request: TaskInputPageRequestV1 }[];
  readInputs: { ctx: CoreCallContext; request: unknown }[];
  readContextFacts: { ctx: CoreCallContext; request: unknown }[];
  readAttentionFacts: { ctx: CoreCallContext; request: unknown }[];
};

type PortOverrides = {
  look?: (ctx: CoreCallContext, request: GraphLookRequestV1) => Promise<ReadResult<GraphReadPageV1<NodeCardV1>>>;
  find?: (ctx: CoreCallContext, request: GraphFindRequestV1) => Promise<ReadResult<GraphReadPageV1<NodeCardV1>>>;
  history?: (ctx: CoreCallContext, request: TaskExecutionHistoryRequest) => Promise<ReadResult<ExecutionHistoryPage>>;
  inputPage?: (ctx: CoreCallContext, request: TaskInputPageRequestV1) => Promise<ReadResult<TaskInputPageV1>>;
  /** The REAL input owner; when set, the graph tool must forward into it. */
  inputs?: TaskContextInputPort;
};

function recordingPorts(overrides: PortOverrides = {}) {
  const calls: RecordedCalls = {
    look: [], find: [], history: [], inputPages: [], readInputs: [], readContextFacts: [], readAttentionFacts: [],
  };
  const graph: GraphContextReadPort = {
    async readContextFacts(ctx, request) { calls.readContextFacts.push({ ctx, request }); return { status: 'not_found' }; },
    async lookGraph(ctx, request) {
      calls.look.push({ ctx, request });
      return overrides.look === undefined ? readyPage([nodeCard({ kind: 'task', ref: { ...T_B }, planRef: { ...PLAN_REF } })]) : overrides.look(ctx, request);
    },
    async findGraph(ctx, request) {
      calls.find.push({ ctx, request });
      return overrides.find === undefined ? readyPage([nodeCard({ kind: 'task', ref: { ...T_B }, planRef: { ...PLAN_REF } })]) : overrides.find(ctx, request);
    },
    async readAttentionFacts(ctx, request) { calls.readAttentionFacts.push({ ctx, request }); return { status: 'not_found' }; },
  };
  const inputs: TaskContextInputPort = overrides.inputs ?? {
    async readTaskInputs(ctx, request) { calls.readInputs.push({ ctx, request }); return { status: 'ready', value: [selection({ kind: 'artifact', ref: OLD_A, provenance: { kind: 'run', owner: { ...RUN_A } } })] }; },
    async readTaskInputPage(ctx, request) {
      calls.inputPages.push({ ctx, request });
      return overrides.inputPage === undefined
        ? { status: 'ready', value: inputPage('A', null, { kind: 'artifact', ref: OLD_A, provenance: { kind: 'run', owner: { ...RUN_A } } }) }
        : overrides.inputPage(ctx, request);
    },
  };
  const history: GraphExecutionHistoryReadPort = {
    async readTaskExecutionHistory(ctx, request) {
      calls.history.push({ ctx, request });
      return overrides.history === undefined ? { status: 'ready', value: historyPage(7) } : overrides.history(ctx, request);
    },
  };
  return { graph, inputs, history, calls };
}

/** L13: the memory branch's notes-read recording port. */
type NoteRecordedCalls = {
  lookup: { ctx: CoreCallContext; request: MemoryLookupRequest }[];
  neighbors: { ctx: CoreCallContext; request: MemoryNeighborsRequest }[];
  history: { ctx: CoreCallContext; request: MemoryHistoryRequest }[];
  conflicts: { ctx: CoreCallContext; request: MemoryConflictsRequest }[];
  find: { ctx: CoreCallContext; request: MemoryFindRequest }[];
  stale: { ctx: CoreCallContext; request: MemoryStaleRequest }[];
};

function memoryResult(): MemoryResultV1 {
  return { readBasis: { recordCursor: null, ruleVersion: 2, observedFiles: [] }, items: [], warnings: [],
    next: null, complete: true, coverage: { checkedItems: 0, uncheckedItems: 0, filesRead: 0 } };
}

function recordingNotes() {
  const calls: NoteRecordedCalls = { lookup: [], neighbors: [], history: [], conflicts: [], find: [], stale: [] };
  const memory: NoteMemoryReadPort = {
    async memoryLookup(ctx, request): Promise<{ status: 'ready'; value: MemoryLookupResultV1 }> {
      calls.lookup.push({ ctx, request });
      return { status: 'ready', value: { ...memoryResult(), understanding: null, topics: [], topicsComplete: true } };
    },
    async memoryNeighbors(ctx, request) { calls.neighbors.push({ ctx, request }); return { status: 'ready', value: memoryResult() }; },
    async memoryHistory(ctx, request): Promise<{ status: 'ready'; value: MemoryHistoryResultV1 }> {
      calls.history.push({ ctx, request });
      return { status: 'ready', value: { ...memoryResult(), items: [] } };
    },
    async memoryConflicts(ctx, request) { calls.conflicts.push({ ctx, request }); return { status: 'ready', value: memoryResult() }; },
    async memoryFind(ctx, request) { calls.find.push({ ctx, request }); return { status: 'ready', value: memoryResult() }; },
    async memoryStale(ctx, request) { calls.stale.push({ ctx, request }); return { status: 'ready', value: memoryResult() }; },
  };
  return { memory, calls };
}

type BuildOptions = {
  context?: CoreCallContext;
  goalRef?: GoalRef;
  ports?: ReturnType<typeof recordingPorts>;
  notes?: NoteMemoryReadPort;
  mutate?: (config: GraphToolsConfig) => void;
};

/** The REAL adapter over recording ports; `create` is the part-1 stub. */
function buildTools(options: BuildOptions = {}) {
  const ports = options.ports ?? recordingPorts();
  const context = options.context ?? workContext(signal());
  const config: GraphToolsConfig = {
    context, goalRef: options.goalRef ?? GOAL_REF,
    graph: ports.graph, inputs: ports.inputs, history: ports.history,
    ...(options.notes === undefined ? {} : { notes: options.notes }),
  };
  const handle = createGraphTools(config);
  options.mutate?.(config);
  const definitions = handle.create(null as unknown as WorkspaceSandbox);
  const byName = (name: string): ToolDefinition => {
    const definition = definitions.find(candidate => candidate.name === name);
    if (definition === undefined) throw new Error(`missing tool ${name}`);
    return definition;
  };
  return { handle, config, context, definitions, byName, ...ports };
}

describe('S3 graph tools', () => {
  it('GT01 publishes exactly look_graph and find_graph with read_only effect classes', () => {
    const ports = recordingPorts();
    const handle = createGraphTools({ context: workContext(signal()), goalRef: GOAL_REF, graph: ports.graph, inputs: ports.inputs, history: ports.history });
    expect(handle.names).toEqual(['look_graph', 'find_graph']);
    expect(handle.names).toEqual([...GRAPH_TOOL_NAMES]);
    const definitions = handle.create(null as unknown as WorkspaceSandbox);
    expect(definitions.map(definition => definition.name)).toEqual([...GRAPH_TOOL_NAMES]);
    for (const definition of definitions) {
      expect(definition.effectClass).toBe('read_only');
      expect(definition.independentReadOnly).toBe(true);
      expect(definition.defaultTimeoutMs).toBe(10000);
      expect(definition.outputLimitBytes).toBe(64 * 1024);
      expect(definition.requiredCapabilities).toEqual(['workspace_read']);
    }
  });

  it('GT02 rejects model-supplied principal/workspace/goalId with invalid_arguments before any port call', async () => {
    const { byName, calls } = buildTools();
    const forbidden: Record<string, unknown>[] = [
      { principal: { kind: 'host', actor: HUMAN } },
      { workspaceId: W },
      { goalId: G },
      { goalRef: GOAL_REF },
      { projectId: P },
      { requestId: 'forged' },
      { actor: HUMAN },
      { duty: 'executor' },
    ];
    for (const name of GRAPH_TOOL_NAMES) {
      const base = name === 'find_graph' ? { needle: 'B' } : { mode: 'node', target: { kind: 'task', ref: { ...T_B }, planRef: { ...PLAN_REF } } };
      for (const extra of forbidden) {
        const result = await byName(name).handler.execute(toolCall(name, `call-${name}`, { ...base, ...extra }), { signal: signal() });
        expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
      }
    }
    // Every lower port call that this file records must still be zero: a
    // rejected argument list is never authorized to reach any read owner.
    for (const [port, recorded] of Object.entries(calls)) {
      expect(recorded, `${port} must not be called for invalid arguments`).toHaveLength(0);
    }
  });

  it('GT03 freezes the caller goal/scope and the original signal even when the config is mutated after creation', async () => {
    const original = new AbortController();
    const ports = recordingPorts();
    const context = workContext(original.signal);
    const config: GraphToolsConfig = { context, goalRef: { ...GOAL_REF }, graph: ports.graph, inputs: ports.inputs, history: ports.history };
    const handle = createGraphTools(config);
    context.projectId = 'mutated-project';
    context.workspaceId = 'mutated-workspace';
    config.goalRef!.goalId = 'mutated-goal';
    const definitions = handle.create(null as unknown as WorkspaceSandbox);
    const look = definitions.find(definition => definition.name === 'look_graph')!;
    const result = await look.handler.execute(
      toolCall('look_graph', 'gt03', { mode: 'node', target: { kind: 'task', ref: { ...T_B }, planRef: { ...PLAN_REF } } }),
      { signal: original.signal },
    );
    expect(result.status).toBe('success');
    expect(calls(ports).look[0]?.ctx.projectId).toBe(P);
    expect(calls(ports).look[0]?.ctx.workspaceId).toBe(W);
    expect(calls(ports).look[0]?.ctx.signal).toBe(original.signal);
    expect(calls(ports).look[0]?.request.goalRef?.goalId).toBe(G);
  });

  it('GT04 defaults node/path/find pages to limit 20, afterCursor null and relation card', async () => {
    const ports = recordingPorts();
    const { byName } = buildTools({ ports });
    await byName('look_graph').handler.execute(
      toolCall('look_graph', 'gt04-node', { mode: 'node', target: { kind: 'task', ref: { ...T_B }, planRef: { ...PLAN_REF } } }),
      { signal: signal() });
    await byName('look_graph').handler.execute(
      toolCall('look_graph', 'gt04-path', { mode: 'path', path: 'src/b' }), { signal: signal() });
    await byName('find_graph').handler.execute(
      toolCall('find_graph', 'gt04-find', { needle: 'B' }), { signal: signal() });
    expect(ports.calls.look[0]?.request.page).toEqual({ afterCursor: null, limit: 20 });
    expect(ports.calls.look[0]?.request.relation).toBe('card');
    expect(ports.calls.look[1]?.request.page).toEqual({ afterCursor: null, limit: 20 });
    expect(ports.calls.look[1]?.request.relation).toBe('card');
    expect(ports.calls.find[0]?.request.page).toEqual({ afterCursor: null, limit: 20 });
  });

  it('GT05 keeps the RT8 page/scannedCount and forwards the trusted Query scope and this tool signal to history', async () => {
    const historyArgs: Record<string, unknown> = { mode: 'history',
      runRef: { aggregateType: 'Run', projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, runId: 'pending' } };
    const p = await openGtPlatform({
      queryReplies: [
        { kind: 'calls', calls: [{ callId: 'gt05-history', name: 'look_graph', args: historyArgs }] },
        { kind: 'text', text: 'gt05 answered' },
      ],
    });
    try {
      // The canonical Work Run is claimed/prepared in a busy Session; the Query
      // then reads its history through the driver's narrow proxy.
      const { runRef } = await p.advanceToPrepare('gt05');
      historyArgs['runRef'] = { ...runRef };
      gtRt8.calls.length = 0;
      gtRt8.page = historyPage(9);
      const run = await startGtQuery(p, 'gt05');
      expect(gtRt8.calls).toHaveLength(1);
      const received = gtRt8.calls[0]!;
      expect(received.ctx.projectId).toBe(AG2B_SCOPE.projectId);
      expect(received.ctx.workspaceId).toBe(AG2B_SCOPE.workspaceId);
      expect(received.ctx.principal).toEqual({ kind: 'host', actor: GT_ACTOR });
      expect(received.ctx.materialReader).toEqual({ kind: 'host', ...AG2B_SCOPE, actor: GT_ACTOR });
      expect(received.ctx.signal).toBeInstanceOf(AbortSignal);
      expect(received.request).toMatchObject({ runRef: { ...runRef }, afterCursor: null, limit: 50 });
      expect(providerToolJson(run.requests[1], 'gt05-history'))
        .toMatchObject({ status: 'ready', value: { scannedCount: 9 } });
      // The history read opens no second Query and no extra model call.
      expect(p.queryModel.requests).toHaveLength(2);
    } finally { await p.close(); }
  });

  it('GT06 rejects a history Run whose canonical workspace is w2 and returns no body', async () => {
    // Known part-1 limitation: the driver's narrow proxy performs the w2 card
    // check before RT8, and that proxy is not exported yet. This pins the
    // adapter's pass-through of the domain `forbidden` (GT05 covers the proxy).
    const forbidden = { status: 'rejected', code: 'forbidden', reason: 'the Run belongs to workspace w2' } as const;
    const ports = recordingPorts({ history: async () => forbidden });
    const { byName } = buildTools({ ports });
    const result = await byName('look_graph').handler.execute(
      toolCall('look_graph', 'gt06', { mode: 'history', runRef: { ...RUN_A } }), { signal: signal() });
    expect(result).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });
    expect(outputValue(result)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(JSON.stringify(outputValue(result))).not.toContain('doc-');
  });

  it.each(STORAGE_KINDS)('GT07 reports the input page fixed at this look version while using historical usage (%s)', async storage => {
    // Known part-1 limitation: the §5.3 fixture only carries legacy exact
    // declarations, and part 1 exposes no assembled manifest; this reaches the
    // REAL owner and pins the fixed historical source/usage immutability.
    const f = await openInputFixture(storage);
    try {
      const { byName } = buildTools({ context: f.workContext(signal()), ports: recordingPorts({ inputs: f.service }) });
      // The first look fixes r1's exact historical source.
      const prepared = await lookInputPage(byName, f.planRef, f.legacyDeclarationId, null, 2048);
      expect(prepared.status).toBe('success');
      const fixed = (outputValue(prepared) as { status: 'ready'; value: TaskInputPageV1 }).value;
      expect(fixed.selection.usage).toBe('historical_explanation');
      expect(fixed.selection.source).toMatchObject({ kind: 'artifact', ref: { digest: FX_LEGACY_DIGEST } });
      expect(fixed.body).toBe(FX_LEGACY_BODY);
      // A later formal source (r2) is reported for its own look, and never moves
      // the already-fixed r1 version.
      const later = await lookInputPage(byName, f.planRef, f.secondLegacyDeclarationId, null, 2048);
      expect(later.status).toBe('success');
      const newer = (outputValue(later) as { status: 'ready'; value: TaskInputPageV1 }).value;
      expect(newer.selection.usage).toBe('historical_explanation');
      expect(newer.selection.source).toMatchObject({ kind: 'artifact', ref: { digest: FX_NEW_DIGEST } });
      expect(fixed.selection.source).toMatchObject({ kind: 'artifact', ref: { digest: FX_LEGACY_DIGEST } });
      expect(fixed.body).toBe(FX_LEGACY_BODY);
    } finally { await f.close(); }
  });

  it.each(STORAGE_KINDS)('GT08 pages A / 中 / B by maxBytes=3 and keeps every page digest at H(A中B) (%s)', async storage => {
    const f = await openInputFixture(storage);
    try {
      // The REAL input owner is the `inputs` dependency; the adapter must only
      // forward the request and preserve the owner's real cursors and digests.
      const { byName } = buildTools({ context: f.workContext(signal()), ports: recordingPorts({ inputs: f.service }) });
      const read = async (afterCursor: string | null): Promise<TaskInputPageV1> => {
        const result = await lookInputPage(byName, f.planRef, f.legacyDeclarationId, afterCursor, 3);
        expect(result.status).toBe('success');
        return (outputValue(result) as { status: 'ready'; value: TaskInputPageV1 }).value;
      };
      const first = await read(null);
      const second = await read(first.nextCursor);
      const third = await read(second.nextCursor);
      expect(first.body).toBe('A');
      expect(second.body).toBe('中');
      expect(third.body).toBe('B');
      expect(third.nextCursor).toBeNull();
      expect(`${first.body}${second.body}${third.body}`).toBe(FX_LEGACY_BODY);
      for (const page of [first, second, third]) {
        expect(page.selection.source).toMatchObject({ kind: 'artifact', ref: { digest: FX_LEGACY_DIGEST } });
      }
    } finally { await f.close(); }
  });

  it.each(STORAGE_KINDS)('GT09 rejects continuing r1 with a cursor minted for the r2 declaration and returns no body (%s)', async storage => {
    const f = await openInputFixture(storage);
    try {
      const { byName } = buildTools({ context: f.workContext(signal()), ports: recordingPorts({ inputs: f.service }) });
      // A real cursor produced by the owner while reading r1 ...
      const first = await lookInputPage(byName, f.planRef, f.legacyDeclarationId, null, 1);
      expect(first.status).toBe('success');
      const firstPage = (outputValue(first) as { status: 'ready'; value: TaskInputPageV1 }).value;
      expect(firstPage.body).toBe('A');
      expect(firstPage.nextCursor).not.toBeNull();
      // ... cannot be moved to the r2 declaration.
      const crossed = await lookInputPage(byName, f.planRef, f.secondLegacyDeclarationId, firstPage.nextCursor, 2048);
      expect(crossed).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });
      expect(outputValue(crossed)).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(JSON.stringify(outputValue(crossed))).not.toContain(FX_NEW_BODY);
    } finally { await f.close(); }
  });

  it('GT10 sends find then look through the real Query Kernel seam and reports no workspace change and no write tool', async () => {
    const p = await openGtPlatform({
      queryReplies: [
        // Lead fix after the freeze: find and look are one reply, so the next
        // provider request (requests[1]) carries both real tool results.
        { kind: 'calls', calls: [
          { callId: 'gt10-find', name: 'find_graph', args: { needle: AG2B_WORK_TASK_ID } },
          { callId: 'gt10-look', name: 'look_graph', args: { mode: 'node', target: GT_TASK_NODE } },
        ] },
        { kind: 'text', text: 'gt10 answered' },
      ],
    });
    try {
      const run = await startGtQuery(p, 'gt10');
      expect(run.requests.length).toBeGreaterThanOrEqual(2);
      // The next provider request carries the two REAL tool results.
      const findResult = providerToolResult(run.requests[1], 'gt10-find');
      const lookResult = providerToolResult(run.requests[1], 'gt10-look');
      expect(findResult?.status).toBe('success');
      expect(lookResult?.status).toBe('success');
      expect(providerToolJson(run.requests[1], 'gt10-look')).toMatchObject({ status: 'ready' });
      // A read changes no workspace path and a Query carries no writable tool.
      expect(lookResult?.effects).toEqual({ sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] });
      for (const hidden of ['write', 'edit', 'shell']) {
        expect(requestToolNames(run.requests[0])).not.toContain(hidden);
      }
    } finally { await p.close(); }
  });

  it('GT11 does not let send/note/shell into the Query grant; only explicitly granted look/find appear', async () => {
    // The real writer names the Host grant carries: the mailbox `send`, a write,
    // and the command `shell`. They must never reach the real Query request.
    const writers = ['send_session_message', 'write', 'shell'];
    const grant = ['read', 'look_graph', 'find_graph', ...writers];
    const p = await openGtPlatform({ queryTools: grant, queryReplies: [{ kind: 'text', text: 'gt11 answered' }] });
    try {
      const run = await startGtQuery(p, 'gt11');
      const names = requestToolNames(run.requests[0]);
      // The real Host grant explicitly carried the writers ...
      expect(grant).toEqual(expect.arrayContaining(writers));
      // ... but the Query read ceiling filtered them out; only look/find stay.
      expect(names).toEqual(expect.arrayContaining(['look_graph', 'find_graph']));
      for (const absent of writers) expect(names).not.toContain(absent);
    } finally { await p.close(); }
  });

  it('GT12 the graph read itself writes no message ack, no acceptedInputs, no record and calls no Workflow', async () => {
    const commits: RecordCommitNotice[] = [];
    const p = await openGtPlatform({
      onCommit: notice => commits.push(notice),
      queryReplies: [
        { kind: 'calls', calls: [{ callId: 'gt12-look', name: 'look_graph', args: { mode: 'node', target: GT_TASK_NODE } }] },
        { kind: 'text', text: 'gt12 answered' },
      ],
    });
    try {
      const advance = vi.spyOn(p.platform.workflow, 'advanceWork');
      const run = await startGtQuery(p, 'gt12');
      // The graph read advances no Workflow and commits no ack/input/message
      // record; the only ledger commits are the Query lifecycle itself.
      expect(advance).not.toHaveBeenCalled();
      const graphCommitted = commits.flatMap(notice => notice.aggregates)
        .filter(aggregate => /Message|RunInput|Task|Workflow/.test(aggregate.aggregateType));
      expect(graphCommitted).toEqual([]);
      const look = providerToolResult(run.requests[1], 'gt12-look');
      expect(look?.status).toBe('success');
      expect(providerToolJson(run.requests[1], 'gt12-look')).toMatchObject({ status: 'ready' });
      expect(look?.effects).toEqual({ sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] });
    } finally { vi.restoreAllMocks(); await p.close(); }
  });

  it.each(STORAGE_KINDS)('GT13 rejects a zero-progress maxBytes=1 continuation as capacity, and still reads 中 with the original cursor (%s)', async storage => {
    const f = await openInputFixture(storage);
    try {
      const { byName } = buildTools({ context: f.workContext(signal()), ports: recordingPorts({ inputs: f.service }) });
      const first = await lookInputPage(byName, f.planRef, f.legacyDeclarationId, null, 3);
      expect(first.status).toBe('success');
      const firstPage = (outputValue(first) as { status: 'ready'; value: TaskInputPageV1 }).value;
      expect(firstPage.body).toBe('A');
      const cursor = firstPage.nextCursor;
      expect(cursor).not.toBeNull();
      // The next character is 中 (3 UTF-8 bytes); maxBytes=1 cannot make progress,
      // so the owner must report capacity instead of an empty page.
      const capacity = await lookInputPage(byName, f.planRef, f.legacyDeclarationId, cursor, 1);
      expect(capacity).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });
      expect(outputValue(capacity)).toMatchObject({ status: 'rejected', code: 'capacity' });
      // The ORIGINAL cursor is still usable with the original maxBytes=3.
      const resumed = await lookInputPage(byName, f.planRef, f.legacyDeclarationId, cursor, 3);
      expect(resumed.status).toBe('success');
      expect((outputValue(resumed) as { status: 'ready'; value: TaskInputPageV1 }).value.body).toBe('中');
    } finally { await f.close(); }
  });

  it('GT14 rejects an 80KiB ready ToolResult as execution_failed/capacity and never returns a truncated ready object', async () => {
    // The row measures the COMPLETE ready ToolResult JSON, not one oversized
    // field: spread the 80 KiB across the whole card so a size check that only
    // looked at `summary` could not accidentally pass.
    const chunk = 'x';
    const hugePage = readyPage([nodeCard(
      { kind: 'task', ref: { ...T_B }, planRef: { ...PLAN_REF } },
      {
        name: chunk.repeat(16 * 1024),
        summary: chunk.repeat(32 * 1024),
        paths: [chunk.repeat(16 * 1024)],
        inputDeclarations: [declaration(chunk.repeat(16 * 1024))],
      },
    )]);
    expect(B(JSON.stringify(hugePage))).toBeGreaterThanOrEqual(80 * 1024);
    const ports = recordingPorts({ look: async () => hugePage });
    const { byName } = buildTools({ ports });
    const result = await byName('look_graph').handler.execute(
      toolCall('look_graph', 'gt14', { mode: 'node', target: { kind: 'task', ref: { ...T_B }, planRef: { ...PLAN_REF } } }), { signal: signal() });
    expect(result).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });
    expect(result.effects).toEqual({ sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] });
    expect(B(JSON.stringify(result))).toBeLessThan(48 * 1024);
    expect(outputValue(result)).toMatchObject({ status: 'rejected', code: 'capacity' });
    expect(JSON.stringify(outputValue(result))).not.toContain('xxxx');
  });

  it('GT15 G-02 rejects a memory op mixed with old graph parameters and a model-supplied goalId before any read', async () => {
    const notes = recordingNotes();
    const { byName, calls } = buildTools({ notes: notes.memory });
    // `memory` together with the old look/find fields is not the strict union.
    const mixedLook = await byName('look_graph').handler.execute(toolCall('look_graph', 'gt15-look', {
      memory: { v: 1, op: 'lookup', anchor: { kind: 'project' } },
      mode: 'node', target: { kind: 'task', ref: { ...T_B }, planRef: { ...PLAN_REF } },
    }), { signal: signal() });
    expect(mixedLook).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    const mixedFind = await byName('find_graph').handler.execute(toolCall('find_graph', 'gt15-find', {
      memory: { v: 1, op: 'find' }, needle: 'B',
    }), { signal: signal() });
    expect(mixedFind).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    // A model-supplied identity/scope key is an unknown strict key, inside the
    // memory object and at the top level.
    for (const args of [
      { memory: { v: 1, op: 'find', terms: ['jwt'], goalId: G } },
      { memory: { v: 1, op: 'find', terms: ['jwt'], goalRef: GOAL_REF } },
      { memory: { v: 1, op: 'find', terms: ['jwt'], principal: { kind: 'host', actor: HUMAN } } },
      { memory: { v: 1, op: 'lookup', anchor: { kind: 'project' } }, projectId: P },
    ]) {
      const result = await byName('find_graph').handler.execute(toolCall('find_graph', 'gt15-forged', args), { signal: signal() });
      // `lookup` is not a find_graph op; the shape is rejected either way.
      expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    }
    for (const recorded of Object.values(notes.calls)) expect(recorded).toHaveLength(0);
    for (const [port, recorded] of Object.entries(calls)) expect(recorded, `${port} must stay unread`).toHaveLength(0);
  });

  it('GT16 look_graph memory forwards the trusted frozen context, defaults limit 20/cursor null and keeps the original signal', async () => {
    const original = new AbortController();
    const notes = recordingNotes();
    const context = workContext(original.signal);
    const { byName } = buildTools({ context, notes: notes.memory });
    const lookup = await byName('look_graph').handler.execute(toolCall('look_graph', 'gt16-lookup', {
      memory: { v: 1, op: 'lookup', anchor: { kind: 'task', goalId: G, taskId: 'tB' },
        body: { noteId: 'n1', version: 2 } },
    }), { signal: original.signal });
    expect(lookup).toMatchObject({ status: 'success' });
    expect(outputValue(lookup)).toMatchObject({ status: 'ready' });
    expect(notes.calls.lookup[0]?.ctx.projectId).toBe(P);
    expect(notes.calls.lookup[0]?.ctx.workspaceId).toBe(W);
    expect(notes.calls.lookup[0]?.ctx.principal).toEqual(context.principal);
    expect(notes.calls.lookup[0]?.ctx.signal).toBe(original.signal);
    expect(notes.calls.lookup[0]?.request).toEqual({ v: 1, op: 'lookup',
      anchor: { kind: 'task', goalId: G, taskId: 'tB' }, body: { noteId: 'n1', version: 2, cursor: null },
      limit: 20, cursor: null });
    await byName('look_graph').handler.execute(toolCall('look_graph', 'gt16-neighbors', {
      memory: { v: 1, op: 'neighbors', noteId: 'n1' } }), { signal: signal() });
    expect(notes.calls.neighbors[0]?.request).toEqual({ v: 1, op: 'neighbors', noteId: 'n1', limit: 20, cursor: null });
    await byName('look_graph').handler.execute(toolCall('look_graph', 'gt16-history', {
      memory: { v: 1, op: 'history', noteId: 'n1', limit: 5, cursor: 'c1' } }), { signal: signal() });
    expect(notes.calls.history[0]?.request).toEqual({ v: 1, op: 'history', noteId: 'n1', limit: 5, cursor: 'c1' });
    await byName('look_graph').handler.execute(toolCall('look_graph', 'gt16-conflicts', {
      memory: { v: 1, op: 'conflicts', anchor: { kind: 'module', moduleId: 'M1' } } }), { signal: signal() });
    expect(notes.calls.conflicts[0]?.request).toEqual({ v: 1, op: 'conflicts',
      anchor: { kind: 'module', moduleId: 'M1' }, limit: 20, cursor: null });
  });

  it('GT17 find_graph memory forwards related (including null) and stale requests', async () => {
    const notes = recordingNotes();
    const { byName } = buildTools({ notes: notes.memory });
    await byName('find_graph').handler.execute(toolCall('find_graph', 'gt17-null', {
      memory: { v: 1, op: 'find', terms: ['jwt', 'token'], match: 'any', related: null } }), { signal: signal() });
    expect(notes.calls.find[0]?.request).toEqual({ v: 1, op: 'find', terms: ['jwt', 'token'], match: 'any',
      related: null, limit: 20, cursor: null });
    await byName('find_graph').handler.execute(toolCall('find_graph', 'gt17-task', {
      memory: { v: 1, op: 'find', related: { kind: 'task', goalId: G, taskId: 't1' }, limit: 4, cursor: 'c0' } }), { signal: signal() });
    expect(notes.calls.find[1]?.request).toMatchObject({ related: { kind: 'task', goalId: G, taskId: 't1' }, limit: 4, cursor: 'c0' });
    await byName('find_graph').handler.execute(toolCall('find_graph', 'gt17-stale', {
      memory: { v: 1, op: 'stale', goalId: G, limit: 3, cursor: 'c1' } }), { signal: signal() });
    expect(notes.calls.stale[0]?.request).toEqual({ v: 1, op: 'stale', goalId: G, limit: 3, cursor: 'c1' });
  });

  it('GT18 a memory call with no notes port fails closed and reaches no note owner', async () => {
    const { byName, calls } = buildTools();
    const result = await byName('look_graph').handler.execute(toolCall('look_graph', 'gt18', {
      memory: { v: 1, op: 'lookup', anchor: { kind: 'project' } } }), { signal: signal() });
    expect(result).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });
    for (const [port, recorded] of Object.entries(calls)) expect(recorded, `${port} must stay unread`).toHaveLength(0);
  });

  it('GT19 C1.3 a real work Run is granted the registered record_note tool', async () => {
    const p = await openGtPlatform({
      workTools: [...GT_WORK_TOOLS, 'record_note'],
      workReplies: [
        { kind: 'calls', calls: [{ callId: 'gt19-write', name: 'record_note', args: {
          op: 'write', kind: 'convention', topic: 'naming', conclusion: 'use kebab-case',
          anchor: { kind: 'goal', goalId: AG2B_GOAL_REF.goalId },
        } }] },
        { kind: 'text', text: 'gt19 wrote the note' },
      ],
    });
    try {
      const prepared = await p.advanceToPrepare('gt19');
      const started = await p.advanceStart(prepared.next);
      // The driver accepted the selected name (a missing note port would have
      // failed closed with `unsupported`) and the Kernel provider request carries
      // the real registration.
      expect(started.status).toBe('ready');
      expect(requestToolNames(p.workModel.requests[0])).toContain('record_note');
    } finally { await p.close(); }
  }, 120_000);

  it('GT20 G-03 a read-only Query granted record_note never receives it', async () => {
    const p = await openGtPlatform({
      queryTools: [...GT_QUERY_TOOLS, 'record_note'],
      queryReplies: [{ kind: 'text', text: 'gt20 answered' }],
    });
    try {
      const run = await startGtQuery(p, 'gt20');
      const names = requestToolNames(run.requests[0]);
      expect(names).not.toContain('record_note');
    } finally { await p.close(); }
  }, 120_000);
});

/** Small accessor so GT03 can read the recording port's calls by name. */
function calls(ports: ReturnType<typeof recordingPorts>): RecordedCalls {
  return ports.calls;
}

/** `look_graph {mode:'input'}` through the real tool definition. */
async function lookInputPage(
  byName: (name: string) => ToolDefinition,
  planRef: PlanRevisionRef,
  declarationId: string,
  afterCursor: string | null,
  maxBytes: number,
): Promise<ToolResult> {
  return byName('look_graph').handler.execute(
    toolCall('look_graph', `input-${declarationId}-${afterCursor ?? 'start'}-${String(maxBytes)}`, {
      mode: 'input', consumer: { ...T_B }, planRef: { ...planRef }, declarationId, afterCursor, maxBytes,
    }),
    { signal: signal() },
  );
}

// --------------------------------------------------------------------------
// Real exact-input owner fixture (the §5.3 `S3-context-inputs` pattern)
// --------------------------------------------------------------------------

/** The declared legacy body of GT08/GT09/GT13: `A中B` (UTF-8 5 bytes, 3 chars). */
const FX_LEGACY_BODY = 'A中B';
const FX_NEW_BODY = 'new-A';
/** Both Workspaces are registered by the public owner, whose first write is revision 1. */
const FX_WORKSPACE_REVISION = 1;
const FX_STAGE_ID = 's';
const FX_GATE_TASK = 'gate';
const FX_OBLIGATION_ID = 'oB';
const FX_CHECK_ID = 'vB';
const FX_AT = '2026-09-24T00:00:00.000Z';
const FX_ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 's3-input-binding', templateId: 'builder', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'legacy-template',
};
const FX_QUERY_ROLE: RoleConfigurationRef = {
  kind: 'legacy_template', templateId: 'advisor', templateRevision: '1',
};
const FX_QUERY_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 's3-graph-query-binding', templateId: 'advisor', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'legacy-template',
};
const FX_BUDGET: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
const FX_SOURCE: SourceRefV1 = { kind: 'workspace', refId: W, revision: String(FX_WORKSPACE_REVISION) };
/**
 * The fixed bodies' digests and sizes, worked outside the product: SHA-256 over
 * the UTF-8 bytes, lowercase hex (`printf '<bytes>' | sha256sum`).
 * - FX_LEGACY_BODY 'A中B' = 41 e4 b8 ad 42: 1 + 3 + 1 = 5 bytes;
 * - FX_NEW_BODY 'new-A' = 6e 65 77 2d 41: 5 bytes.
 */
const FX_LEGACY_DIGEST = '6ca8210506b8751de837bfafb4afa21616657eafb51d18826d45b9facd7c8471';
const FX_NEW_DIGEST = '06133157a11c76d127cd99286b598dab5c491e7177641b2fab06c0e5b5eea0cd';
const FX_OLD_REF: ArtifactRef = {
  kind: 'artifact', contentType: 'text/plain', digest: FX_LEGACY_DIGEST, sizeBytes: 5, source: FX_SOURCE,
};
const FX_NEW_REF: ArtifactRef = {
  kind: 'artifact', contentType: 'text/plain', digest: FX_NEW_DIGEST, sizeBytes: 5, source: FX_SOURCE,
};
const FX_SCOPE: WorkspaceScope = { projectId: P, workspaceId: W };
const FX_PROJECT_REF = { aggregateType: 'Project' as const, projectId: P };
const FX_WORKSPACE_REF: WorkspaceRef = { aggregateType: 'Workspace', projectId: P, workspaceId: W };
const FX_OTHER_WORKSPACE_REF: WorkspaceRef = { aggregateType: 'Workspace', projectId: P, workspaceId: 'w2' };

/** The v2 answer the scripted `initial_coordination` Query returns; the Plan
 * owner derives the identity from the SAVED Job intent and the plan body keeps
 * the fixed input requirements r1/r2. */
const FX_PLAN_ANSWER: InitialPlanningResponseV2 = {
  schemaVersion: 2, kind: 'plan', summary: 'S3 graph-tools input fixture plan',
  plan: {
    schemaVersion: 2,
    stages: [{ stageId: FX_STAGE_ID, title: 'Main' }],
    tasks: [
      { taskId: 'tA', stageId: FX_STAGE_ID, title: 'A', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: FX_STAGE_ID } },
      { taskId: 'tB', stageId: FX_STAGE_ID, title: 'B', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: FX_STAGE_ID } },
      { taskId: FX_GATE_TASK, title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [
      { taskId: 'tA', role: 'builder', instruction: 'Implement A' },
      { taskId: 'tB', role: 'builder', instruction: 'Implement B' },
    ],
    obligations: [{ obligationId: FX_OBLIGATION_ID, title: 'Deliver B', requirementLevel: 'required',
      taskIds: ['tA', 'tB', FX_GATE_TASK],
      verificationRequirements: [{ requirementId: FX_CHECK_ID, requirementLevel: 'required', kind: 'static',
        description: 'node check-b.js' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [{ taskId: 'tB', dependsOnId: 'tA', requires: { kind: 'artifact', label: 'A.out' } }] },
    taskRelations: [],
    inputRequirements: [
      { requirementId: 'r1', consumerTaskId: 'tB', kind: 'artifact', artifactRef: FX_OLD_REF },
      { requirementId: 'r2', consumerTaskId: 'tB', kind: 'artifact', artifactRef: FX_NEW_REF },
    ],
  },
};
const FX_PLAN_ANSWER_TEXT = JSON.stringify(FX_PLAN_ANSWER);

type InputFixture = {
  service: TaskContextInputPort;
  planRef: PlanRevisionRef;
  runB: RunRef;
  workContext(signalValue: AbortSignal): CoreCallContext;
  legacyDeclarationId: string;
  secondLegacyDeclarationId: string;
  close(): Promise<void>;
};

function fxWorkContext(runRef: RunRef, roleBinding: RoleBindingRefV1, signalValue: AbortSignal): CoreCallContext {
  return { projectId: P, workspaceId: W,
    principal: { kind: 'work_run', runRef: { ...runRef }, roleBinding: { ...roleBinding } },
    materialReader: { kind: 'run', requester: { ...runRef } }, signal: signalValue };
}

/**
 * The real p/g world of GT07/GT08/GT09/GT13: the public Project/Workspace/
 * policy/baseline/Goal/Plan owners, a real scripted `initial_coordination`
 * Query whose SAVED Answer becomes the one adopted Plan, two Runtime Sessions,
 * two real claims (tA then tB) and the fixed bodies stored by Run A through
 * `materials.storeArtifact`. The input owner is the composition root's real
 * `taskInputs`; declaration ids are taken from its real `readTaskInputs`.
 * The composition root itself registers PROJECT_BOOTSTRAP_RECORD_SCHEMAS and
 * ARCHITECTURE_CATALOG_SCHEMAS, so this fixture has no hand-written schema seed
 * and no fake TrustedScopeSeeded event. The platform runs on the memory or the
 * SQLite backend it is given (R-19).
 */
async function openInputFixture(storage: StorageKind): Promise<InputFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'next-s3-graph-inputs-'));
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  const skillsRoot = join(directory, 'skills');
  await mkdir(skillsRoot, { recursive: true });
  const hostActor = { kind: 'human' as const, id: 's3-graph-operator' };
  const hostCtx = (workspaceId = W): CoreCallContext => ({ projectId: P, workspaceId,
    principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId: P, workspaceId, actor: hostActor },
    signal: new AbortController().signal });
  const workspaceBindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === P && (requested.workspaceId === W || requested.workspaceId === 'w2')
        ? { status: 'ready', value: { root, workspaceRevision: FX_WORKSPACE_REVISION } }
        : { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 's3-graph-host',
        permissionRevision: 's3-graph-grant-1', allowsRead: () => true } };
    },
  };
  const queryModel = createScriptedModel([{ kind: 'text', text: FX_PLAN_ANSWER_TEXT }]);
  const runtime: RuntimeHostBindings = {
    async resolveConfiguration() {
      return { status: 'rejected', code: 'unsupported', reason: 'this fixture runs no Work execution' };
    },
    async resolveQueryConfiguration() {
      return { status: 'ready', value: {
        configurationRevision: 's3-graph-host@1',
        model: {
          configuration: { revision: 's3-graph-host@1', provider: 'deepseek',
            model: 's3-graph-scripted', baseUrl: 'http://127.0.0.1' },
          client: queryModel.client,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
            tokenizer: 's3-graph-fixture-counter' }) },
        },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
          maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 },
        tools: ['read', 'project_source'],
        writeScope: [],
        skills: { resourceRoot: skillsRoot, enabledIds: [] },
        systemInstruction: 'S3 graph-tools input fixture read-only guidance',
        hostTemplate: { templateId: 'advisor', revision: '1',
          digest: sha256Hex('S3 graph-tools input fixture read-only guidance') },
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
  const platform = await createTargetPlatform({
    storage: storage === 'memory' ? { kind: 'memory' as const }
      : { kind: 'sqlite' as const, directory: join(directory, 'storage') },
    workspace: workspaceBindings,
    sourcePolicyFor: async (projectId, workspaceId) => projectId === P && workspaceId === W
      ? { root, permissionRevision: 's3-graph-grant-1', allowsRead: () => true } : null,
    runtime,
    kernelStores: { entries: [{ adapterId: 's3-graph-kernel', storeKey: 's3-graph-kernel-store',
      workspace: FX_SCOPE, databasePath: join(directory, 'kernel.sqlite') }] },
    now: () => FX_AT,
  });
  try {
    // ---- public Project/Workspace/policy/baseline chain (revisions are 1) ----
    const createdProject = await platform.projects.createProject(hostCtx(), {
      meta: { requestId: 's3-graph-create-project', expected: [{ ref: FX_PROJECT_REF, revision: 0 }] },
      input: { projectId: P } });
    if (createdProject.status !== 'committed') throw new Error(`S3 graph input project failed: ${JSON.stringify(createdProject)}`);
    const registeredWorkspace = await platform.projects.registerWorkspace(hostCtx(), {
      meta: { requestId: 's3-graph-register-workspace', expected: [
        { ref: FX_PROJECT_REF, revision: 1 }, { ref: FX_WORKSPACE_REF, revision: 0 }] },
      input: { workspace: FX_SCOPE } });
    if (registeredWorkspace.status !== 'committed') throw new Error(`S3 graph input workspace failed: ${JSON.stringify(registeredWorkspace)}`);
    const registeredOther = await platform.projects.registerWorkspace(hostCtx('w2'), {
      meta: { requestId: 's3-graph-register-other-workspace', expected: [
        { ref: FX_PROJECT_REF, revision: 1 }, { ref: FX_OTHER_WORKSPACE_REF, revision: 0 }] },
      input: { workspace: { projectId: P, workspaceId: 'w2' } } });
    if (registeredOther.status !== 'committed') throw new Error(`S3 graph input other workspace failed: ${JSON.stringify(registeredOther)}`);

    const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: P,
      policyId: 's3-graph-policy', revision: 1 };
    const installed = await platform.completionPolicies.installCompletionPolicy(hostCtx(), {
      meta: { requestId: 's3-graph-install-policy', expected: [
        { ref: FX_PROJECT_REF, revision: 1 }, { ref: policyRef, revision: 0 }] },
      input: { policyId: policyRef.policyId, contentRevision: 1,
        content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
    if (installed.status !== 'committed') throw new Error(`S3 graph input policy install failed: ${JSON.stringify(installed)}`);
    const activated = await platform.completionPolicies.activateCompletionPolicy(hostCtx(), {
      meta: { requestId: 's3-graph-activate-policy', expected: [
        { ref: FX_PROJECT_REF, revision: 1 },
        { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: P }, revision: 0 }] },
      input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } });
    if (activated.status !== 'committed') throw new Error(`S3 graph input policy activation failed: ${JSON.stringify(activated)}`);
    const architecture = await platform.architecture.adoptInitialArchitecture(hostCtx(), {
      meta: { requestId: 's3-graph-adopt-architecture', expected: [
        { ref: FX_PROJECT_REF, revision: 1 }, { ref: FX_WORKSPACE_REF, revision: FX_WORKSPACE_REVISION }] },
      input: { baselineId: 's3-graph-baseline', description: 'S3 graph-tools input fixture baseline',
        constraints: [], catalog: { requireDag: true, dependencies: [], modules: [{
          ref: { projectId: P, moduleId: 's3-graph-module' }, name: 'S3 graph input',
          responsibility: 'S3 graph-tools input fixture workspace', paths: ['src'], interfaces: [] }] } } });
    if (architecture.status !== 'committed') throw new Error(`S3 graph input architecture failed: ${JSON.stringify(architecture)}`);

    const createdGoal = await platform.goals.createGoal(hostCtx(), {
      meta: { requestId: 's3-graph-create-goal', expected: [
        { ref: FX_PROJECT_REF, revision: 1 }, { ref: FX_WORKSPACE_REF, revision: FX_WORKSPACE_REVISION }] },
      input: { goalId: G, workspace: FX_SCOPE, objective: 'Ship platform' } });
    if (createdGoal.status !== 'committed') throw new Error(`S3 graph input Goal creation failed: ${JSON.stringify(createdGoal)}`);

    // ---- one real scripted Query Answer -> proposeInitialPlanFromAnswer -> adopt ----
    const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: P, workspaceId: W,
      queryJobId: 's3-graph-plan-job' };
    const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: P, workspaceId: W,
      queryJobId: queryJobRef.queryJobId, runId: 's3-graph-plan-run' };
    const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: queryJobRef.queryJobId,
      projectId: P, workspaceId: W, goalId: G, question: 'Propose the initial plan for this Goal',
      focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
      correlationId: 's3-graph-plan-correlation',
      execution: { kind: 'initial_coordination', roleBinding: FX_QUERY_BINDING,
        runtimeBudget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
          maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 } } };
    const submitted = await platform.queries.submitQueryJob(hostCtx(), {
      meta: { requestId: 's3-graph-query-submit', expected: [
        { ref: FX_PROJECT_REF, revision: 1 }, { ref: FX_WORKSPACE_REF, revision: FX_WORKSPACE_REVISION },
        { ref: GOAL_REF, revision: 1 }, { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] },
      input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent } });
    if (submitted.status !== 'committed') throw new Error(`S3 graph query submit failed: ${JSON.stringify(submitted)}`);
    const querySession = await platform.runtime.createSession(hostCtx(), {
      workspace: FX_SCOPE, role: FX_QUERY_ROLE, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 's3-graph-query-session', expected: [] } });
    if (querySession.status !== 'completed') throw new Error(`S3 graph query Session failed: ${JSON.stringify(querySession)}`);
    const claimQuery = await platform.queries.claimQuery(hostCtx(), {
      meta: { requestId: 's3-graph-query-claim', expected: [
        { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
        { ref: querySession.value.ref, revision: querySession.value.revision }] },
      input: { queryRunRef, sessionRef: querySession.value.ref } });
    if (claimQuery.status !== 'committed') throw new Error(`S3 graph query claim failed: ${JSON.stringify(claimQuery)}`);
    const preparedQuery = await platform.runtime.prepareQuery(hostCtx(), {
      queryRunRef, requestId: 's3-graph-query-prepare' });
    if (preparedQuery.status !== 'ready') throw new Error(`S3 graph query prepare failed: ${JSON.stringify(preparedQuery)}`);
    const startedQuery = await platform.runtime.startQuery(hostCtx(), {
      prepared: preparedQuery.value, consumerId: 's3-graph-query-consumer',
      requestId: 's3-graph-query-start' });
    if (startedQuery.status !== 'ready') throw new Error(`S3 graph query start failed: ${JSON.stringify(startedQuery)}`);
    const answerRef = startedQuery.value.answer?.ref;
    if (answerRef === undefined) throw new Error('the S3 graph query recorded no formal answer');
    const proposed = await platform.plans.proposeInitialPlanFromAnswer(hostCtx(), {
      meta: { requestId: 's3-graph-initial-propose', expected: [] },
      input: { answerRef,
        reason: { text: 'S3 graph-tools initial plan from the real coordination answer', sources: [] } } });
    if (proposed.status !== 'committed' || proposed.value.kind !== 'candidate_v2') {
      throw new Error(`S3 graph initial plan proposal failed: ${JSON.stringify(proposed)}`);
    }
    const applied = await platform.plans.applyPlanChange(hostCtx(), {
      meta: { requestId: 's3-graph-initial-apply', expected: [{ ref: GOAL_REF, revision: 1 }] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision,
        decisionRefs: [] } });
    if (applied.status !== 'committed') throw new Error(`S3 graph initial plan adoption failed: ${JSON.stringify(applied)}`);
    const planRef = applied.value.ref;

    // ---- two real Runtime Sessions and the two real claims (tA then tB) ----
    const workRole: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
    const createSession = async (requestId: string): Promise<{ ref: SessionRef; revision: number }> => {
      const created = await platform.runtime.createSession(hostCtx(), {
        workspace: FX_SCOPE, role: workRole, recommendedRefs: [], initialLinks: [],
        meta: { requestId, expected: [] } });
      if (created.status !== 'completed') throw new Error(`S3 graph input Session failed: ${JSON.stringify(created)}`);
      return { ref: created.value.ref, revision: created.value.revision };
    };
    const sessionA = await createSession('s3-graph-session-a');
    const sessionB = await createSession('s3-graph-session-b');
    const goalRevision = async (): Promise<number> => {
      const read = await platform.plans.queryGoal(hostCtx(), GOAL_REF);
      if (read.status !== 'ready') throw new Error(`S3 graph input Goal read failed: ${JSON.stringify(read)}`);
      return read.value.goal.revision;
    };
    const claim = async (taskId: string, session: { ref: SessionRef; revision: number },
      requestId: string): Promise<RunRef> => {
      const claimed = await platform.claims.claimTask(hostCtx(), {
        meta: { requestId, expected: [
          { ref: GOAL_REF, revision: await goalRevision() },
          { ref: FX_WORKSPACE_REF, revision: FX_WORKSPACE_REVISION },
          { ref: plainSessionRefToAggregate(session.ref), revision: session.revision }] },
        input: { goalRef: GOAL_REF, planRef, taskId, sessionRef: session.ref,
          roleBinding: FX_ROLE_BINDING, budget: FX_BUDGET } });
      if (claimed.status !== 'committed') throw new Error(`S3 graph input claim ${taskId} failed: ${JSON.stringify(claimed)}`);
      return claimed.value.runRef;
    };
    const runA = await claim('tA', sessionA, 's3-graph-claim-a');
    const runB = await claim('tB', sessionB, 's3-graph-claim-b');

    // ---- the fixed bodies are stored by the real Run A material owner ----
    const runACtx = fxWorkContext(runA, FX_ROLE_BINDING, new AbortController().signal);
    for (const body of [FX_LEGACY_BODY, FX_NEW_BODY]) {
      const stored = await platform.materials.storeArtifact(runACtx, {
        contentType: 'text/plain', body, sources: [FX_SOURCE],
        origin: { kind: 'execution', ref: runA } });
      if (stored.status !== 'stored') throw new Error(`S3 graph input body store failed: ${JSON.stringify(stored)}`);
    }

    // ---- the two declaration ids come from the REAL input owner read ----
    const readInputs = await platform.taskInputs.readTaskInputs(
      fxWorkContext(runB, FX_ROLE_BINDING, new AbortController().signal), { consumer: T_B, planRef });
    if (readInputs.status !== 'ready') throw new Error(`S3 graph input declaration read failed: ${JSON.stringify(readInputs)}`);
    const declarationIdOf = (label: string): string => {
      const selected = readInputs.value.find(item => item.declaration.requires.label === label);
      if (selected === undefined) throw new Error(`the real input owner did not declare ${label}`);
      return selected.declaration.declarationId;
    };
    const legacyDeclarationId = declarationIdOf('r1');
    const secondLegacyDeclarationId = declarationIdOf('r2');

    return {
      service: platform.taskInputs,
      planRef,
      runB,
      workContext: (signalValue: AbortSignal) => fxWorkContext(runB, FX_ROLE_BINDING, signalValue),
      legacyDeclarationId,
      secondLegacyDeclarationId,
      async close() {
        await platform.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await platform.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

// --------------------------------------------------------------------------
// Real Query runtime seam (GT05/GT06/GT10/GT11/GT12) over the AG2b seed
// --------------------------------------------------------------------------

const GT_AT = '2026-10-06T00:00:00.000Z';
const GT_ACTOR = { kind: 'human' as const, id: 'u' };
/** The work/query grants this file uses: look/find are explicitly granted. */
const GT_WORK_TOOLS: readonly string[] = [...AG2B_WORK_TOOLS, 'look_graph', 'find_graph'];
const GT_QUERY_TOOLS: readonly string[] = ['read', 'project_source', 'look_graph', 'find_graph'];
const GT_PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: AG2B_SCOPE.projectId, planId: 'ag2b-plan' };
/** Lead fix after the freeze: the Query runs on the Work Goal g itself (spec §5.1, §5.8 GT05). */
const GT_QUERY_GOAL_REF: GoalRef = { ...AG2B_GOAL_REF };
const GT_TASK_NODE: GraphNodeRefV1 = { kind: 'task',
  ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: AG2B_WORK_TASK_ID },
  planRef: { ...GT_PLAN_REF } };

type GtPlatform = {
  platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  workModel: ScriptedModel;
  queryModel: ScriptedModel;
  actor: { kind: 'human'; id: string };
  root: string;
  database: string;
  /** Drives `select_work`/`claim_task`/`prepare` and stops before `start`. */
  advanceToPrepare(flowId: string): Promise<{ runRef: RunRef; next: WorkflowAdvanceInput }>;
  advanceStart(next: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult>;
  close(): Promise<void>;
};

function gtSelect(flowId: string): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId, sessionHint: null,
    kind: 'select_work', taskId: AG2B_WORK_TASK_ID };
}

async function gtWorkRun(platform: GtPlatform['platform'], actor: GtPlatform['actor']): Promise<RunRef> {
  const read = await platform.plans.queryTaskGraph(hostCtx(actor), { goalRef: AG2B_GOAL_REF });
  if (read.status !== 'ready') throw new Error(`the AG2b Task graph must be readable: ${JSON.stringify(read)}`);
  const row = read.value.tasks.find(task => task.ref.taskId === AG2B_WORK_TASK_ID);
  if (row?.execution == null) throw new Error('the AG2b work Task selected no Run after prepare');
  return row.execution;
}

/** The current Goal revision for the QueryJob submit's exact version pins. */
async function gtGoalRevision(platform: GtPlatform['platform'], ctx: CoreCallContext, ref: GoalRef): Promise<number> {
  const read = await platform.plans.queryGoal(ctx, ref);
  if (read.status !== 'ready') throw new Error(`the AG2b Goal must be readable: ${JSON.stringify(read)}`);
  return read.value.goal.revision;
}

/**
 * One real `createTargetPlatform` over SQLite with the AG2b Goal/Plan seeded,
 * a Host that grants `look_graph`/`find_graph` to both the Work and the Query
 * binding, and two scripted providers. It never calls a real model.
 */
async function openGtPlatform(options: {
  workReplies?: readonly ScriptedReply[];
  queryReplies?: readonly ScriptedReply[];
  workTools?: readonly string[];
  queryTools?: readonly string[];
  onCommit?: (notice: RecordCommitNotice) => void;
} = {}): Promise<GtPlatform> {
  const root = await mkdtemp(join(tmpdir(), 'gt-s3-ws-'));
  const database = await mkdtemp(join(tmpdir(), 'gt-s3-db-'));
  await writeAG2bWorkspace(root);
  const workModel = createScriptedModel([...(options.workReplies ?? [{ kind: 'text', text: 'gt work answer' }])]);
  const queryModel = createScriptedModel([...(options.queryReplies ?? [{ kind: 'text', text: 'gt query answer' }])]);
  const actor = GT_ACTOR;
  const base = ag2bWorkRuntime(() => workModel, { queryModel });
  const host: RuntimeHostBindings = {
    async resolveConfiguration(ctx, request) {
      const result = await base.resolveConfiguration(ctx, request);
      return result.status === 'ready'
        ? { ...result, value: { ...result.value, tools: [...(options.workTools ?? GT_WORK_TOOLS)] } }
        : result;
    },
    async resolveQueryConfiguration(ctx, request) {
      const result = await base.resolveQueryConfiguration!(ctx, request);
      return result.status === 'ready'
        ? { ...result, value: { ...result.value, tools: [...(options.queryTools ?? GT_QUERY_TOOLS)] } }
        : result;
    },
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory: database },
    workspace: ag2bWorkspaceBindings(root, { value: 1 }, permissionRevision(actor, AG2B_SCOPE, ['.'])),
    now: () => GT_AT,
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(database, 'kernel.sqlite') }] },
    runtime: host,
    checks: ag2bChecksConfiguration({ actor, command: 'node -e "process.exit(0)"' }),
    workflow: { consumerId: AG2B_CONSUMER_ID, bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE,
      roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null } }] },
    ...(options.onCommit === undefined ? {}
      : { commitObserver: { started: () => undefined, committed: options.onCommit } }),
  });
  await seedThroughOwners(platform, actor, [AG2B_WORK_TASK_ID]);
  // Lead fix after the freeze (spec §5.1, §5.8 GT05 "canonical Query p/g/w"):
  // the Query is a semantic Query on the SAME Goal g as the Work Task, so the
  // graph tools bound to the QueryJob Goal may read g's nodes and Runs.

  return {
    platform, workModel, queryModel, actor, root, database,
    async advanceToPrepare(flowId) {
      let current = gtSelect(flowId);
      for (let step = 0; step < 64; step += 1) {
        if (performs('start')(current)) {
          return { runRef: await gtWorkRun(platform, actor), next: current };
        }
        const result = await platform.workflow.advanceWork(hostCtx(actor), current);
        if (result.status !== 'ready') throw new Error(`workflow advanceWork was not ready: ${JSON.stringify(result)}`);
        if (result.value.state === 'completed' || result.value.next === null) {
          throw new Error(`the Workflow settled before ${flowId} reached prepare/start`);
        }
        current = result.value.next;
      }
      throw new Error('the Workflow did not settle within 64 steps');
    },
    advanceStart(next) { return platform.workflow.advanceWork(hostCtx(actor), next); },
    async close() {
      await platform.close();
      await rm(root, { recursive: true, force: true });
      await rm(database, { recursive: true, force: true });
    },
  };
}

type GtQueryRun = {
  queryJobRef: QueryJobRef;
  queryRunRef: QueryRunRef;
  session: SessionRef;
  requests: ModelRequest[];
};

/** Submits, claims, prepares and starts one real read-only Query on `p`. */
async function startGtQuery(p: GtPlatform, label: string): Promise<GtQueryRun> {
  const ctx = hostCtx(p.actor);
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...AG2B_SCOPE, queryJobId: `${label}-job` };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...AG2B_SCOPE,
    queryJobId: queryJobRef.queryJobId, runId: `${label}-run` };
  const created = await p.platform.runtime.createSession(ctx, { workspace: AG2B_SCOPE, role: AG2B_QUERY_ROLE,
    recommendedRefs: [], initialLinks: [], meta: { requestId: `${label}-session`, expected: [] } });
  if (created.status !== 'completed') throw new Error(`gt query Session creation failed: ${JSON.stringify(created)}`);
  const session = created.value.ref;
  const intent: QueryJobIntentV1 = {
    schemaVersion: 1, intentId: queryJobRef.queryJobId,
    projectId: AG2B_SCOPE.projectId, workspaceId: AG2B_SCOPE.workspaceId, goalId: GT_QUERY_GOAL_REF.goalId,
    question: 'S3 graph-tools Query', focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null },
    multiTurn: { maxRounds: 1 }, correlationId: label,
    execution: { kind: 'semantic_query', roleBinding: AG2B_QUERY_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET },
  };
  const submitted = await p.platform.queries.submitQueryJob(ctx, { meta: { requestId: `${label}-submit`, expected: [
    { ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 },
    { ref: GT_QUERY_GOAL_REF, revision: await gtGoalRevision(p.platform, ctx, GT_QUERY_GOAL_REF) },
    { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] },
    input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent } });
  if (submitted.status !== 'committed') throw new Error(`gt query submit failed: ${JSON.stringify(submitted)}`);
  const claimed = await p.platform.queries.claimQuery(ctx, { meta: { requestId: `${label}-claim`, expected: [
    { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
    { ref: session, revision: created.value.revision }] },
    input: { queryRunRef, sessionRef: session } });
  if (claimed.status !== 'committed') throw new Error(`gt query claim failed: ${JSON.stringify(claimed)}`);
  const prepared = await p.platform.runtime.prepareQuery(ctx, { queryRunRef, requestId: `${label}-prepare` });
  if (prepared.status !== 'ready') throw new Error(`gt query prepare failed: ${JSON.stringify(prepared)}`);
  const started = await p.platform.runtime.startQuery(ctx, { prepared: prepared.value,
    consumerId: AG2B_CONSUMER_ID, requestId: `${label}-start` });
  if (started.status !== 'ready') throw new Error(`gt query start failed: ${JSON.stringify(started)}`);
  return { queryJobRef, queryRunRef, session, requests: p.queryModel.requests };
}

/** The JSON block a provider request carries for one tool call id. */
function providerToolJson(request: ModelRequest | undefined, callId: string): unknown {
  const message = request?.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  if (message === undefined || message.role !== 'tool') return undefined;
  const output = (message.result as { output?: ReadonlyArray<{ kind: string; value?: unknown }> }).output ?? [];
  return output.find(block => block.kind === 'json')?.value;
}

/** The complete ToolResult the Kernel delivered for one tool call id. */
function providerToolResult(request: ModelRequest | undefined, callId: string): ToolResult | undefined {
  const message = request?.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  return message !== undefined && message.role === 'tool' ? message.result as ToolResult : undefined;
}

function requestToolNames(request: ModelRequest | undefined): string[] {
  return (request?.tools ?? []).map(tool => tool.name);
}
