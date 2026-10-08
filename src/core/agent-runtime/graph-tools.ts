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

const findSchema = z.object({
  needle: z.string().min(1),
  page: pageSchema.optional(),
}).strict();

const lookSchema: z.ZodType = z.discriminatedUnion('mode', [
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

const descriptions = {
  look_graph: 'Read one graph node/path card or page (relation card/children/neighbours/executions/checks), the original execution history of one Run, or the exact declared task input body by page. The Goal and scope are bound by the platform; do not send them.',
  find_graph: 'Search the bound Goal graph by a case-sensitive substring over node names, paths and summaries. The Goal and scope are bound by the platform; do not send them.',
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
      if (name === 'find_graph') {
        const input = accepted as { needle: string; page?: { afterCursor?: string | null; limit?: number } };
        const request: GraphFindRequestV1 = {
          goalRef: fixedGoalRef,
          needle: input.needle,
          page: { afterCursor: input.page?.afterCursor ?? null, limit: input.page?.limit ?? DEFAULT_PAGE_LIMIT },
        };
        const result = await config.graph.findGraph(context, request);
        return finalize(callId, mapRead(callId, result, 'the graph search could not be read'));
      }
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
