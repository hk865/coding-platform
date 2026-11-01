/**
 * The `request_rework` and `request_recheck` model adapters.
 *
 * Each adapter is a thin wrapper over the existing owner (`requeueTask`,
 * `reverifyRound`). The same `{ names, create }` seam as `command-rerun-tools.ts`
 * keeps the driver and the Kernel callbacks unchanged. The trusted Run context
 * and command identity are fixed by the factory; the model supplies only the
 * named refs, reason, optional acknowledgement and the exact version pins it
 * read from `look_graph`.
 *
 * The pins are opaque here: this adapter never reads, checks or completes them.
 * It passes the declared `expected` payload unchanged to the owner, whose own
 * identity/fingerprint algorithm is what the read-only commit lookup later
 * rebuilds from the same arguments.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { VersionPin } from '../../contracts/core/identity.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { TaskClaimPort, RequeueTaskInput } from '../work-graph/model/claim-contracts.js';
import type { EvidencePort, ReverifyRoundInput } from '../work-graph/model/evidence-contracts.js';
import {
  toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult, type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';

/** Typed view: the generated pack's literal `tools` object has no string index signature. */
const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

export const REQUEST_REWORK_TOOL_NAME = 'request_rework';
export const REQUEST_RECHECK_TOOL_NAME = 'request_recheck';
export const REWORK_TOOL_NAMES = [REQUEST_REWORK_TOOL_NAME, REQUEST_RECHECK_TOOL_NAME] as const;

/**
 * The three refs a rework pin may name: the Goal, the afterRun and the current
 * requeue refusal. The owner's `expectedPinsOf` is the rule; this schema only
 * freezes the wire shape so a mistyped pin never reaches it.
 */
function pinRefSchema(operation: 'requeue' | 'reverify') {
  const goal = z.object({
    aggregateType: z.literal('Goal'),
    projectId: z.string().min(1),
    goalId: z.string().min(1),
  }).strict();
  const refusal = z.object({
    aggregateType: z.literal('TaskReworkRefusal'),
    projectId: z.string().min(1),
    goalId: z.string().min(1),
    taskId: z.string().min(1),
    operation: z.literal(operation),
    subjectId: z.string().min(1),
  }).strict();
  return operation === 'requeue'
    ? z.union([goal, runRefSchema, refusal])
    : z.union([roundRefSchema, refusal]);
}
function expectedSchema(operation: 'requeue' | 'reverify', text: ToolTextV1) {
  return z.array(z.object({
    ref: pinRefSchema(operation).describe(text.parameters['expected[].ref']!),
    revision: z.number().int().min(0).describe(text.parameters['expected[].revision']!),
  }).strict()).describe(text.parameters['expected']!);
}

const taskTripleSchema = z.object({
  projectId: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1),
}).strict();
const runRefSchema = z.object({
  aggregateType: z.literal('Run'),
  projectId: z.string().min(1),
  goalId: z.string().min(1),
  runId: z.string().min(1),
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
const acknowledgementSchema = z.object({
  aggregateType: z.literal('SessionMessage'),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  messageId: z.string().min(1),
}).strict();

function requeueSchema(text: ToolTextV1) {
  const parameters = text.parameters;
  return z.object({
    taskRef: taskTripleSchema.describe(parameters['taskRef']!),
    afterRunRef: runRefSchema.describe(parameters['afterRunRef']!),
    reason: z.string().min(1).describe(parameters['reason']!),
    acknowledgement: acknowledgementSchema.optional().describe(parameters['acknowledgement']!),
    expected: expectedSchema('requeue', text),
  }).strict();
}

function recheckSchema(text: ToolTextV1) {
  const parameters = text.parameters;
  return z.object({
    predecessorRoundRef: roundRefSchema.describe(parameters['predecessorRoundRef']!),
    onlyIfSourceChanged: z.boolean().optional().describe(parameters['onlyIfSourceChanged']!),
    reason: z.string().min(1).optional().describe(parameters['reason']!),
    acknowledgement: acknowledgementSchema.optional().describe(parameters['acknowledgement']!),
    expected: expectedSchema('reverify', text),
  }).strict();
}

type RequeueArguments = z.infer<ReturnType<typeof requeueSchema>>;
type RecheckArguments = z.infer<ReturnType<typeof recheckSchema>>;

export type ReworkToolsConfig = {
  /** The R owner behind `request_rework`; the same instance the routes publish. */
  claims: Required<Pick<TaskClaimPort, 'requeueTask'>>;
  /** The R owner behind `request_recheck`. */
  evidence: Required<Pick<EvidencePort, 'reverifyRound'>>;
  /** Trusted, already-bound Work Run context; snapshotted per call. */
  context: CoreCallContext;
  /** Trusted command identity: Kernel `ToolCall.callId` + the bound Run. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** The platform tools' model-facing texts; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
};

export type ReworkToolsHandle = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

function noneEffects(): ToolResult['effects'] {
  return { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] };
}
function outputValue(value: unknown): ToolResult['output'] {
  return [{ kind: 'json', value: value as never }];
}
function success(callId: string, value: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'success', output: outputValue(value), effects: noneEffects() };
}
function failed(callId: string, code: 'invalid_arguments' | 'execution_failed', message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error', error: { code, message, retryable: false },
    output: [], effects: noneEffects(),
  };
}
function rejectedResult(callId: string, result: unknown, message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code: 'execution_failed', message, retryable: false }, output: outputValue(result), effects: noneEffects(),
  };
}

export function createReworkTools(config: ReworkToolsConfig): ReworkToolsHandle {
  const requeueText = config.texts?.[REQUEST_REWORK_TOOL_NAME] ?? PLATFORM_TOOL_TEXTS[REQUEST_REWORK_TOOL_NAME]!;
  const recheckText = config.texts?.[REQUEST_RECHECK_TOOL_NAME] ?? PLATFORM_TOOL_TEXTS[REQUEST_RECHECK_TOOL_NAME]!;
  const requeueInputSchema = requeueSchema(requeueText);
  const recheckInputSchema = recheckSchema(recheckText);
  const fixedPrincipal = structuredClone(config.context.principal);
  const fixedProjectId = config.context.projectId;
  const fixedWorkspaceId = config.context.workspaceId;
  const fixedMaterialReader = structuredClone(config.context.materialReader);

  function snapshotContext(signal: AbortSignal): CoreCallContext {
    return {
      projectId: fixedProjectId,
      ...(fixedWorkspaceId === undefined ? {} : { workspaceId: fixedWorkspaceId }),
      principal: structuredClone(fixedPrincipal),
      materialReader: structuredClone(fixedMaterialReader),
      signal,
    };
  }

  async function executeRequeue(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const callId = call.callId;
    const parsed = requeueInputSchema.safeParse(call.arguments);
    if (!parsed.success) return failed(callId, 'invalid_arguments', 'request_rework 参数非法');
    const requestId = config.requestIdForCall(call);
    const args: RequeueArguments = parsed.data;
    const input: RequeueTaskInput = {
      taskRef: { ...args.taskRef },
      afterRunRef: { ...args.afterRunRef },
      reason: args.reason,
      ...(args.acknowledgement === undefined ? {} : { acknowledgement: { ...args.acknowledgement } }),
    };
    const context = snapshotContext(signal);
    let result;
    try {
      result = await config.claims.requeueTask(context, {
        input,
        meta: { requestId, expected: args.expected as VersionPin[] },
      });
    } catch {
      return failed(callId, 'execution_failed',
        'the rework request did not return a result; its outcome is unconfirmed and it may already be committed. '
        + 'Do not report it as not written and do not retry under a new callId.');
    }
    if (result.status === 'rejected') {
      if (result.code === 'cancelled') {
        return { schemaVersion: 1, callId, status: 'cancelled', reason: result.reason, output: [], effects: noneEffects() };
      }
      return rejectedResult(callId, result, result.reason);
    }
    return success(callId, result);
  }

  async function executeRecheck(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const callId = call.callId;
    const parsed = recheckInputSchema.safeParse(call.arguments);
    if (!parsed.success) return failed(callId, 'invalid_arguments', 'request_recheck 参数非法');
    const requestId = config.requestIdForCall(call);
    const args: RecheckArguments = parsed.data;
    const input: ReverifyRoundInput = {
      predecessorRoundRef: { ...args.predecessorRoundRef },
      ...(args.onlyIfSourceChanged === undefined ? {} : { onlyIfSourceChanged: args.onlyIfSourceChanged }),
      ...(args.reason === undefined ? {} : { reason: args.reason }),
      ...(args.acknowledgement === undefined ? {} : { acknowledgement: { ...args.acknowledgement } }),
    };
    const context = snapshotContext(signal);
    let result;
    try {
      result = await config.evidence.reverifyRound(context, {
        input,
        meta: { requestId, expected: args.expected as VersionPin[] },
      });
    } catch {
      return failed(callId, 'execution_failed',
        'the recheck request did not return a result; its outcome is unconfirmed and it may already be committed. '
        + 'Do not report it as not written and do not retry under a new callId.');
    }
    if (result.status === 'rejected') {
      if (result.code === 'cancelled') {
        return { schemaVersion: 1, callId, status: 'cancelled', reason: result.reason, output: [], effects: noneEffects() };
      }
      return rejectedResult(callId, result, result.reason);
    }
    return success(callId, result);
  }

  function definition(name: typeof REQUEST_REWORK_TOOL_NAME | typeof REQUEST_RECHECK_TOOL_NAME): ToolDefinition {
    const text = name === REQUEST_REWORK_TOOL_NAME ? requeueText : recheckText;
    const inputSchema = name === REQUEST_REWORK_TOOL_NAME ? requeueInputSchema : recheckInputSchema;
    return {
      name,
      description: text.description,
      inputSchema,
      // A platform-state write: the Kernel permission policy and the Host
      // authorization list apply, but no workspace write or process capability
      // is granted and no file change is reported.
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      independentReadOnly: false,
      defaultTimeoutMs: 30_000,
      outputLimitBytes: 64 * 1024,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return name === REQUEST_REWORK_TOOL_NAME
            ? executeRequeue(call, options.signal)
            : executeRecheck(call, options.signal);
        },
      },
    };
  }

  return { names: REWORK_TOOL_NAMES, create: () => [definition(REQUEST_REWORK_TOOL_NAME), definition(REQUEST_RECHECK_TOOL_NAME)] };
}
