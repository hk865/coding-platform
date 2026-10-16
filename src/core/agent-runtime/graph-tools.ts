/**
 * Slice 3 §4.4 graph read tools: `look_graph` and `find_graph`.
 *
 * This is a thin, trusted adapter over the WorkGraph read port
 * (`GraphContextReadPort`), the exact task-input owner (`TaskContextInputPort`)
 * and the graph execution-history port. It owns no graph, no store and no
 * transcript. The factory freezes the trusted scope/Goal at creation time; the
 * model may only supply the strict per-call arguments below, never a principal,
 * workspace, Goal, actor, duty, Host reader or requestId.
 *
 * Every real domain result is reported verbatim in the JSON output: a `ready`
 * read keeps the complete `ReadResult`, and a typed rejection keeps its
 * `code`/`reason`/`current`. A rejection is never rewritten into a success and a
 * `ready` page is never truncated. When the COMPLETE `ToolResult` JSON would
 * exceed the adapter ceiling, the call returns a small explicit
 * `rejected/capacity` domain result so the Kernel can never truncate a ready
 * JSON and have it read as complete facts.
 */
import { Buffer } from 'node:buffer';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { RunRef, TaskTriple } from '../../contracts/dispatch.js';
import type { GraphNodeRefV1, TaskInputPageRequestV1 } from '../../contracts/graph-context.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../contracts/plan.js';
import { MEMORY_PAGE_DEFAULT, TEXT_SEARCH_MAX_TERMS } from '../work-graph/model/note-contracts.js';
import type {
  MemoryConflictsRequest, MemoryFindRequest, MemoryHistoryRequest, MemoryLookupRequest,
  MemoryNeighborsRequest, MemoryStaleRequest, NoteMemoryReadPort,
} from '../work-graph/model/note-contracts.js';
import type { NoteAnchorV1, NoteKind, NoteState } from '../../contracts/note.js';
import {
  toolSchema as z,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import type { TaskContextInputPort } from '../work-graph/model/context-input-contracts.js';
import type {
  GraphContextReadPort, GraphFindRequestV1, GraphLookRequestV1,
} from '../work-graph/model/graph-context-contracts.js';
import type { GraphExecutionHistoryReadPort } from './execution-history-contracts.js';

export const GRAPH_TOOL_NAMES = ['look_graph', 'find_graph'] as const;

export type GraphToolsConfig = {
  context: CoreCallContext; goalRef: GoalRef;
  graph: GraphContextReadPort; inputs: TaskContextInputPort;
  history: GraphExecutionHistoryReadPort;
  /** Slice 4C L13: `platform.notes`' six reads for the `{ memory: ... }` branch.
   * Absent, a memory call fails closed before any note owner is reached. */
  notes?: NoteMemoryReadPort;
};

type LookArgs =
  | { mode: 'node'; target: GraphNodeRefV1; relation?: GraphLookRequestV1['relation'];
      page?: { afterCursor?: string | null; limit?: number } }
  | { mode: 'path'; path: string; relation?: GraphLookRequestV1['relation'];
      page?: { afterCursor?: string | null; limit?: number } }
  | { mode: 'history'; runRef: RunRef; afterCursor?: string | null; limit?: number }
  | { mode: 'input'; consumer: TaskTriple; planRef: PlanRevisionRef;
      declarationId: string; candidateKey?: string;
      afterCursor?: string | null; maxBytes?: number };

type MemoryBodyArgs = { noteId: string; version?: number; cursor?: string | null };
type MemoryLookArgs =
  | { v: 1; op: 'lookup'; anchor: NoteAnchorV1; body?: MemoryBodyArgs; limit?: number; cursor?: string | null }
  | { v: 1; op: 'neighbors'; noteId: string; version?: number; limit?: number; cursor?: string | null }
  | { v: 1; op: 'history'; noteId: string; body?: MemoryBodyArgs; limit?: number; cursor?: string | null }
  | { v: 1; op: 'conflicts'; noteId?: string; anchor?: NoteAnchorV1; limit?: number; cursor?: string | null };
type MemoryFindArgs =
  | { v: 1; op: 'find'; terms?: string[]; match?: 'any' | 'all'; anchor?: NoteAnchorV1; pathPrefix?: string;
      kind?: NoteKind | 'general'; topic?: string; state?: NoteState;
      related?: { kind: 'task'; goalId: string; taskId: string } | { kind: 'module'; moduleId: string } | null;
      limit?: number; cursor?: string | null }
  | { v: 1; op: 'stale'; goalId?: string; anchor?: NoteAnchorV1; limit?: number; cursor?: string | null };

/** The Kernel output limit is 64 KiB; the adapter stops at 48 KiB so the
 * complete `ToolResult` envelope and the Kernel summary still fit. */
const MAX_TOOL_RESULT_BYTES = 48 * 1024;
const DEFAULT_PAGE_LIMIT = 20;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;
const DEFAULT_MAX_BYTES = 2048;
const MAX_INPUT_MAX_BYTES = 4096;

function noneEffects(): ToolResult['effects'] {
  return { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] };
}

function outputValue(value: unknown): ToolResult['output'] {
  return [{ kind: 'json', value: value as never }];
}

function success(callId: string, value: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'success', output: outputValue(value), effects: noneEffects() };
}

function failure(callId: string, code: 'invalid_arguments' | 'execution_failed', message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code, message, retryable: false }, output: [], effects: noneEffects(),
  };
}

/** A real domain rejection: keep `code`/`reason`/`current` in the output. */
function rejectedResult(callId: string, result: unknown, message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code: 'execution_failed', message, retryable: false }, output: outputValue(result), effects: noneEffects(),
  };
}

function cancelledResult(callId: string, reason: string, result: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'cancelled', reason, output: outputValue(result), effects: noneEffects() };
}

/** `ready` keeps the whole `ReadResult`; typed rejections keep their own code. */
function mapRead(callId: string, result: ReadResult<unknown>, message: string): ToolResult {
  if (result.status === 'ready') return success(callId, result);
  if (result.status === 'rejected' && result.code === 'cancelled') {
    return cancelledResult(callId, result.reason, result);
  }
  return rejectedResult(callId, result, message);
}

/** The explicit capacity refusal that replaces an over-limit ready JSON. */
function capacityResult(callId: string, message: string): ToolResult {
  return rejectedResult(callId, {
    status: 'rejected', code: 'capacity',
    reason: 'the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node',
  }, message);
}

/**
 * Measure the COMPLETE `ToolResult` JSON, not one field. Over the adapter ceiling
 * the ready value is replaced by the small capacity refusal; it is never cut.
 */
function finalize(callId: string, result: ToolResult): ToolResult {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  } catch {
    return failure(callId, 'execution_failed', 'the graph tool result could not be measured for the Kernel output limit');
  }
  if (bytes <= MAX_TOOL_RESULT_BYTES) return result;
  return capacityResult(callId, 'the complete graph tool result is too large for the Kernel output limit');
}

// --------------------------------------------------------------------------
// Strict model-facing schemas. The scope, Goal and all identities are bound by
// config; a model-supplied principal/workspace/goal/actor/duty/requestId is an
// unknown key and fails the strict schema before any read owner is reached.
// --------------------------------------------------------------------------

const goalRefSchema = z.object({
  aggregateType: z.literal('Goal'),
  projectId: z.string().min(1),
  goalId: z.string().min(1),
}).strict();

const taskTripleSchema = z.object({
  projectId: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1),
}).strict();

const planRevisionRefSchema = z.object({
  aggregateType: z.literal('PlanRevision'),
  projectId: z.string().min(1),
  planId: z.string().min(1),
}).strict();

const runRefSchema = z.object({
  aggregateType: z.literal('Run'),
  projectId: z.string().min(1),
  goalId: z.string().min(1),
  runId: z.string().min(1),
}).strict();

const moduleRefSchema = z.object({
  projectId: z.string().min(1),
  moduleId: z.string().min(1),
}).strict();

const sessionRefSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
}).strict();

const roundRefSchema = z.object({
  aggregateType: z.literal('VerificationRound'),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  roundId: z.string().min(1),
}).strict();

const nodeRefSchema: z.ZodType = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('goal'), ref: goalRefSchema }).strict(),
  z.object({ kind: z.literal('stage'), planRef: planRevisionRefSchema, stageId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('task'), ref: taskTripleSchema, planRef: planRevisionRefSchema }).strict(),
  z.object({ kind: z.literal('module'), ref: moduleRefSchema }).strict(),
  z.object({ kind: z.literal('session'), ref: sessionRefSchema }).strict(),
  z.object({ kind: z.literal('run'), ref: runRefSchema }).strict(),
  z.object({ kind: z.literal('round'), ref: roundRefSchema }).strict(),
]);

const relationSchema = z.enum(['card', 'children', 'neighbours', 'executions', 'checks']);
const pageSchema = z.object({
  afterCursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

const findGraphSchema = z.object({
  needle: z.string().min(1),
  page: pageSchema.optional(),
}).strict();

const lookGraphSchema: z.ZodType = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('node'),
    target: nodeRefSchema,
    relation: relationSchema.optional(),
    page: pageSchema.optional(),
  }).strict(),
  z.object({
    mode: z.literal('path'),
    path: z.string().min(1),
    relation: relationSchema.optional(),
    page: pageSchema.optional(),
  }).strict(),
  z.object({
    mode: z.literal('history'),
    runRef: runRefSchema,
    afterCursor: z.string().min(1).nullable().optional(),
    limit: z.number().int().min(1).max(MAX_HISTORY_LIMIT).optional(),
  }).strict(),
  z.object({
    mode: z.literal('input'),
    consumer: taskTripleSchema,
    planRef: planRevisionRefSchema,
    declarationId: z.string().min(1),
    candidateKey: z.string().min(1).optional(),
    afterCursor: z.string().min(1).nullable().optional(),
    maxBytes: z.number().int().min(1).max(MAX_INPUT_MAX_BYTES).optional(),
  }).strict(),
]);

// --------------------------------------------------------------------------
// L13 memory branch schemas. `look_graph`/`find_graph` are the STRICT UNION of
// the old graph arguments above and exactly one `{ memory: { v: 1, ... } }`
// object. The union rejects both branches mixed together, and every branch is
// strict, so a model-supplied principal/scope/goalRef/workspace is an unknown
// key and fails before any note owner is reached.
// --------------------------------------------------------------------------

const memoryLimitSchema = z.number().int().min(1).max(100).optional();
const memoryCursorSchema = z.string().min(1).nullable().optional();
const symbolLocatorSchema = z.object({
  language: z.string().min(1),
  qualifiedName: z.string().min(1),
  signatureDigest: z.string().min(1),
  range: z.object({ startLine: z.number().int().min(0), endLine: z.number().int().min(0) }).strict(),
  fileDigest: z.string().min(1),
}).strict();
const noteAnchorSchema: z.ZodType = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('module'), moduleId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('interface'), moduleId: z.string().min(1), interfaceId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('file'), path: z.string().min(1), symbol: symbolLocatorSchema.optional(),
    deleted: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('goal'), goalId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('stage'), goalId: z.string().min(1), planRevision: z.number().int(),
    stageId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('task'), goalId: z.string().min(1), taskId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('project') }).strict(),
]);
const noteKindSchema = z.enum(['convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision',
  'understanding', 'repair', 'general']);
const noteStateSchema = z.enum(['staged', 'accepted', 'reviewed', 'pending_review', 'rejected', 'superseded', 'withdrawn']);
const memoryBodySchema = z.object({
  noteId: z.string().min(1),
  version: z.number().int().min(1).optional(),
  cursor: z.string().min(1).nullable().optional(),
}).strict();
const memoryLookSchema: z.ZodType = z.discriminatedUnion('op', [
  z.object({ v: z.literal(1), op: z.literal('lookup'), anchor: noteAnchorSchema,
    body: memoryBodySchema.optional(), limit: memoryLimitSchema, cursor: memoryCursorSchema }).strict(),
  z.object({ v: z.literal(1), op: z.literal('neighbors'), noteId: z.string().min(1),
    version: z.number().int().min(1).optional(), limit: memoryLimitSchema, cursor: memoryCursorSchema }).strict(),
  z.object({ v: z.literal(1), op: z.literal('history'), noteId: z.string().min(1),
    body: memoryBodySchema.optional(), limit: memoryLimitSchema, cursor: memoryCursorSchema }).strict(),
  z.object({ v: z.literal(1), op: z.literal('conflicts'), noteId: z.string().min(1).optional(),
    anchor: noteAnchorSchema.optional(), limit: memoryLimitSchema, cursor: memoryCursorSchema }).strict(),
]);
const lookMemorySchema = z.object({ memory: memoryLookSchema }).strict();
const memoryRelatedSchema = z.union([
  z.object({ kind: z.literal('task'), goalId: z.string().min(1), taskId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('module'), moduleId: z.string().min(1) }).strict(),
]).nullable();
const memoryFindSchema = z.object({
  v: z.literal(1), op: z.literal('find'),
  terms: z.array(z.string().min(1)).max(TEXT_SEARCH_MAX_TERMS).optional(),
  match: z.enum(['any', 'all']).optional(),
  anchor: noteAnchorSchema.optional(),
  pathPrefix: z.string().min(1).optional(),
  kind: noteKindSchema.optional(),
  topic: z.string().min(1).optional(),
  state: noteStateSchema.optional(),
  related: memoryRelatedSchema.optional(),
  limit: memoryLimitSchema, cursor: memoryCursorSchema,
}).strict();
const memoryStaleSchema = z.object({
  v: z.literal(1), op: z.literal('stale'),
  goalId: z.string().min(1).optional(),
  anchor: noteAnchorSchema.optional(),
  limit: memoryLimitSchema, cursor: memoryCursorSchema,
}).strict();
const findMemorySchema = z.object({ memory: z.discriminatedUnion('op', [memoryFindSchema, memoryStaleSchema]) }).strict();
const findSchema: z.ZodType = z.union([findGraphSchema, findMemorySchema]);
const lookSchema: z.ZodType = z.union([lookGraphSchema, lookMemorySchema]);

const descriptions = {
  look_graph: 'Read one graph node/path card or page (relation card/children/neighbours/executions/checks), the original execution history of one Run, or the exact declared task input body by page. Or read notes: `{ memory: { v: 1, op: lookup|neighbors|history|conflicts, ... } }`. The Goal, scope and identity are bound by the platform; do not send them.',
  find_graph: 'Search the bound Goal graph case-insensitively (NFC + ASCII-lowercased): node names and summaries by substring; module paths when the path equals the query, is the query\'s longest directory-boundary owner, or lies under `query + \'/\'`. Or search notes: `{ memory: { v: 1, op: find|stale, ... } }`. The Goal, scope and identity are bound by the platform; do not send them.',
} as const;

export function createGraphTools(config: GraphToolsConfig): {
  names: readonly string[];
  create(workspace: WorkspaceSandbox): ToolDefinition[];
} {
  // Freeze the trusted scope/Goal before returning the factory: a caller that
  // mutates its config object afterwards can never retarget a handler.
  const fixedProjectId = config.context.projectId;
  const fixedWorkspaceId = config.context.workspaceId;
  const fixedPrincipal = structuredClone(config.context.principal);
  const fixedMaterialReader = structuredClone(config.context.materialReader);
  const fixedGoalRef: GoalRef = {
    aggregateType: 'Goal', projectId: config.goalRef.projectId, goalId: config.goalRef.goalId,
  };

  /** Snapshot the trusted context and keep this call's ORIGINAL signal. */
  function snapshotContext(signal: AbortSignal): CoreCallContext {
    return {
      projectId: fixedProjectId,
      ...(fixedWorkspaceId === undefined ? {} : { workspaceId: fixedWorkspaceId }),
      principal: structuredClone(fixedPrincipal),
      materialReader: structuredClone(fixedMaterialReader),
      signal,
    };
  }

  async function dispatchLook(callId: string, args: LookArgs, context: CoreCallContext): Promise<ToolResult> {
    if (args.mode === 'history') {
      const result = await config.history.readTaskExecutionHistory(context, {
        runRef: args.runRef,
        afterCursor: args.afterCursor ?? null,
        limit: args.limit ?? DEFAULT_HISTORY_LIMIT,
      });
      return mapRead(callId, result, 'the original execution history could not be read');
    }
    if (args.mode === 'input') {
      const request: TaskInputPageRequestV1 = {
        consumer: args.consumer,
        planRef: args.planRef,
        declarationId: args.declarationId,
        ...(args.candidateKey === undefined ? {} : { candidateKey: args.candidateKey }),
        afterCursor: args.afterCursor ?? null,
        maxBytes: args.maxBytes ?? DEFAULT_MAX_BYTES,
      };
      const result = await config.inputs.readTaskInputPage(context, request);
      return mapRead(callId, result, 'the exact task input page could not be read');
    }
    const target: GraphLookRequestV1['target'] = args.mode === 'node'
      ? { kind: 'node', node: args.target }
      : { kind: 'path', path: args.path };
    const result = await config.graph.lookGraph(context, {
      goalRef: fixedGoalRef,
      target,
      relation: args.relation ?? 'card',
      page: { afterCursor: args.page?.afterCursor ?? null, limit: args.page?.limit ?? DEFAULT_PAGE_LIMIT },
    });
    return mapRead(callId, result, 'the graph look could not be read');
  }

  /**
   * L13 memory branch. The six note reads all receive the SAME snapshotted
   * trusted context as the old graph reads (never a model-supplied identity or
   * scope). `config.notes` absent fails closed before the note owner is reached.
   */
  async function dispatchLookMemory(callId: string, memory: MemoryLookArgs, context: CoreCallContext): Promise<ToolResult> {
    const notes = config.notes;
    if (notes === undefined) return failure(callId, 'execution_failed', 'the note memory read port is not bound for this Run');
    const limit = memory.limit ?? MEMORY_PAGE_DEFAULT;
    const cursor = memory.cursor ?? null;
    if (memory.op === 'lookup') {
      const request: MemoryLookupRequest = { v: 1, op: 'lookup', anchor: memory.anchor, limit, cursor,
        ...(memory.body === undefined ? {} : { body: { noteId: memory.body.noteId,
          ...(memory.body.version === undefined ? {} : { version: memory.body.version }),
          cursor: memory.body.cursor ?? null } }) };
      const result = await notes.memoryLookup(context, request);
      return finalize(callId, mapRead(callId, result, 'the note lookup could not be read'));
    }
    if (memory.op === 'neighbors') {
      const request: MemoryNeighborsRequest = { v: 1, op: 'neighbors', noteId: memory.noteId, limit, cursor,
        ...(memory.version === undefined ? {} : { version: memory.version }) };
      const result = await notes.memoryNeighbors(context, request);
      return finalize(callId, mapRead(callId, result, 'the note neighbors could not be read'));
    }
    if (memory.op === 'history') {
      const request: MemoryHistoryRequest = { v: 1, op: 'history', noteId: memory.noteId, limit, cursor,
        ...(memory.body === undefined ? {} : { body: { noteId: memory.body.noteId,
          ...(memory.body.version === undefined ? {} : { version: memory.body.version }),
          cursor: memory.body.cursor ?? null } }) };
      const result = await notes.memoryHistory(context, request);
      return finalize(callId, mapRead(callId, result, 'the note history could not be read'));
    }
    const request: MemoryConflictsRequest = { v: 1, op: 'conflicts', limit, cursor,
      ...(memory.noteId === undefined ? {} : { noteId: memory.noteId }),
      ...(memory.anchor === undefined ? {} : { anchor: memory.anchor }) };
    const result = await notes.memoryConflicts(context, request);
    return finalize(callId, mapRead(callId, result, 'the note conflicts could not be read'));
  }

  async function dispatchFindMemory(callId: string, memory: MemoryFindArgs, context: CoreCallContext): Promise<ToolResult> {
    const notes = config.notes;
    if (notes === undefined) return failure(callId, 'execution_failed', 'the note memory read port is not bound for this Run');
    const limit = memory.limit ?? MEMORY_PAGE_DEFAULT;
    const cursor = memory.cursor ?? null;
    if (memory.op === 'stale') {
      const request: MemoryStaleRequest = { v: 1, op: 'stale', limit, cursor,
        ...(memory.goalId === undefined ? {} : { goalId: memory.goalId }),
        ...(memory.anchor === undefined ? {} : { anchor: memory.anchor }) };
      const result = await notes.memoryStale(context, request);
      return finalize(callId, mapRead(callId, result, 'the note stale read could not be read'));
    }
    const request: MemoryFindRequest = { v: 1, op: 'find', limit, cursor,
      ...(memory.terms === undefined ? {} : { terms: [...memory.terms] }),
      ...(memory.match === undefined ? {} : { match: memory.match }),
      ...(memory.anchor === undefined ? {} : { anchor: memory.anchor }),
      ...(memory.pathPrefix === undefined ? {} : { pathPrefix: memory.pathPrefix }),
      ...(memory.kind === undefined ? {} : { kind: memory.kind }),
      ...(memory.topic === undefined ? {} : { topic: memory.topic }),
      ...(memory.state === undefined ? {} : { state: memory.state }),
      ...(memory.related === undefined ? {} : { related: memory.related }) };
    const result = await notes.memoryFind(context, request);
    return finalize(callId, mapRead(callId, result, 'the note find could not be read'));
  }

  async function execute(
    name: (typeof GRAPH_TOOL_NAMES)[number],
    call: Readonly<ToolCall>,
    signal: AbortSignal,
    schema: z.ZodType,
  ): Promise<ToolResult> {
    const callId = call.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      return failure('', 'invalid_arguments', 'the Kernel tool call has no callId');
    }
    // Isolation happens before the first await; the strict schema rejects every
    // model-supplied identity/scope field before any read owner is reached.
    const parsed = schema.safeParse(call.arguments);
    if (!parsed.success) return failure(callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    let accepted: unknown;
    try {
      accepted = structuredClone(parsed.data);
    } catch {
      return failure(callId, 'invalid_arguments', 'the tool arguments cannot be isolated');
    }
    const context = snapshotContext(signal);
    if (context.signal.aborted) {
      return cancelledResult(callId, 'the graph call was cancelled before the read',
        { status: 'rejected', code: 'cancelled', reason: 'the graph call was cancelled before the read' });
    }
    try {
      const hasMemory = (accepted as { memory?: unknown }).memory !== undefined;
      if (name === 'find_graph') {
        if (hasMemory) return dispatchFindMemory(callId, (accepted as { memory: MemoryFindArgs }).memory, context);
        const input = accepted as { needle: string; page?: { afterCursor?: string | null; limit?: number } };
        const request: GraphFindRequestV1 = {
          goalRef: fixedGoalRef,
          needle: input.needle,
          page: { afterCursor: input.page?.afterCursor ?? null, limit: input.page?.limit ?? DEFAULT_PAGE_LIMIT },
        };
        const result = await config.graph.findGraph(context, request);
        return finalize(callId, mapRead(callId, result, 'the graph search could not be read'));
      }
      if (hasMemory) return dispatchLookMemory(callId, (accepted as { memory: MemoryLookArgs }).memory, context);
      const result = await dispatchLook(callId, accepted as LookArgs, context);
      return finalize(callId, result);
    } catch {
      return failure(callId, 'execution_failed', 'the graph read did not return a result; its outcome is unconfirmed');
    }
  }

  function definitionFor(name: (typeof GRAPH_TOOL_NAMES)[number]): ToolDefinition {
    const schema = name === 'find_graph' ? findSchema : lookSchema;
    return {
      name,
      description: descriptions[name],
      inputSchema: schema,
      effectClass: 'read_only',
      requiredCapabilities: ['workspace_read'],
      defaultTimeoutMs: 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: true,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(name, call, options.signal, schema);
        },
      },
    };
  }

  return {
    names: GRAPH_TOOL_NAMES,
    create: () => GRAPH_TOOL_NAMES.map(name => definitionFor(name)),
  };
}
