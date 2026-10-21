/**
 * K3 L19a: the `request_command_rerun` tool.
 *
 * The factory has the SAME `{ names, create }` shape as the frozen
 * `coordinationTools` seam, `whiteboard-tools.ts` and
 * `unknown-call-review-tools.ts`, so the driver can assemble it without changing
 * any Kernel type. The request Run is the trusted `work_run` principal; the
 * model supplies only the command, the reason and the optional `rewriteOf`.
 *
 * The SAME `CommandRerunRequestPort` owner the routes publish discovers the
 * record, recognises the command, applies the alias/declared-form rules and
 * writes. This adapter adds no validation, recognition or state rule of its own;
 * it only maps the owner's outcome to the model-facing tool text L19a fixes.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { TaskTriple } from '../../contracts/dispatch.js';
import type {
  CommandRerunRequestPort, CommandRerunRequestReplyV1,
} from '../work-graph/model/command-rerun-request-contracts.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import {
  toolSchema as z,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';

export const REQUEST_COMMAND_RERUN_TOOL_NAME = 'request_command_rerun';
export const REQUEST_COMMAND_RERUN_TOOL_NAMES = [REQUEST_COMMAND_RERUN_TOOL_NAME] as const;

/**
 * §2: `{ command: string; reason: string; rewriteOf?: { review: string; alias: number } }`.
 * The schema only freezes the SHAPE: the owner re-checks the command/reason
 * byte and code-point limits, the alias range and the record identity. `.strict`
 * rejects any extra key (and a literal `null` rewriteOf).
 */
const inputSchema = z
  .object({
    command: z.string().describe(PLATFORM_PROMPT_PACK_V1.tools['request_command_rerun'].parameters['command']),
    reason: z.string().describe(PLATFORM_PROMPT_PACK_V1.tools['request_command_rerun'].parameters['reason']),
    rewriteOf: z.object({
      review: z.string().describe(PLATFORM_PROMPT_PACK_V1.tools['request_command_rerun'].parameters['rewriteOf.review']),
      alias: z.number().describe(PLATFORM_PROMPT_PACK_V1.tools['request_command_rerun'].parameters['rewriteOf.alias']),
    }).strict().optional().describe(PLATFORM_PROMPT_PACK_V1.tools['request_command_rerun'].parameters['rewriteOf']),
  })
  .strict();
type RequestCommandRerunArguments = z.infer<typeof inputSchema>;

export type CommandRerunToolsConfig = {
  /**
   * The SAME owner the routes publish; the adapter adds no request rules.
   * Rework 2 item 3: a no-write pending/allowed outcome carries the WAITING
   * request's command, so there is no point read here at all.
   */
  requests: CommandRerunRequestPort;
  /** Trusted, already-bound context (a `work_run` principal). Never model JSON. */
  context: CoreCallContext;
  /** The trusted prepared Task (`manifest.claim.task`); never model JSON. */
  task: TaskTriple;
  /** Trusted command identity: Kernel `ToolCall.callId` + the bound Run. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
};

export type CommandRerunToolsHandle = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

function noneEffects(): ToolResult['effects'] {
  return { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] };
}

function success(callId: string, value: unknown, text: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'success',
    output: [{ kind: 'json', value: value as never }, { kind: 'text', text }],
    effects: noneEffects() };
}

function failed(callId: string, code: 'invalid_arguments' | 'execution_failed', message: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'error',
    error: { code, message, retryable: false }, output: [], effects: noneEffects() };
}

function cancelled(callId: string, reason: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'cancelled', reason, output: [], effects: noneEffects() };
}

/**
 * L19a fixed Chinese texts. Both owner return forms (the no-write union and the
 * committed write) map to the SAME tool result; `requestId` is the owner's,
 * never minted here.
 */
type NotWrittenReply = Extract<CommandRerunRequestReplyV1, { status: 'not_written' }>;
type WrittenReply = Extract<CommandRerunRequestReplyV1, { status: 'committed' }>;
type ReplyOutcome = NotWrittenReply['outcome'] | WrittenReply['value']['outcome'];

function outcomeResult(callId: string, reply: NotWrittenReply | WrittenReply): ToolResult {
  return outcomeText(callId,
    reply.status === 'not_written' ? reply.outcome : reply.value.outcome,
    // The committed branches carry the waiting form on the returned request;
    // the no-write pending/allowed branches carry their own `command`.
    reply.status === 'committed' ? reply.value.request.command : '');
}

function outcomeText(callId: string, outcome: ReplyOutcome, committedCommand: string): ToolResult {
  switch (outcome.status) {
    case 'requested':
      return success(callId, { status: 'requested', requestId: outcome.requestId },
        '已请求，等人答复。这一轮不能跑这条命令；可以先做别的，或者结束这一轮并写明在等允许。');
    case 'pending': {
      const waitingCommand = 'command' in outcome ? outcome.command : committedCommand;
      return success(callId, { status: 'pending', requestId: outcome.requestId },
        `这个别名已经有一个等答复的请求：\`${waitingCommand}\`。还在等答复，`
        + '不出第二张卡；允许用掉、被拒或作废以后才能再请求别的写法。');
    }
    case 'allowed': {
      const waitingCommand = 'command' in outcome ? outcome.command : committedCommand;
      return success(callId, { status: 'allowed', requestId: outcome.requestId },
        `人已允许 \`${waitingCommand}\` 一次，还没用；`
        + '先用它，用掉或作废以后才能再请求别的写法');
    }
    case 'refused':
      return success(callId, { status: 'refused', reason: outcome.reason },
        outcome.reason === 'denied_final'
          ? '人已经不允许再问这个别名。'
          : '这一轮已经问过这个别名并被拒绝了；同一轮不能再问，下一轮可以带新的原因再请求。');
    case 'not_blocked':
      return success(callId, { status: 'not_blocked' },
        '平台没认出它和被拦的命令相同。如果它其实是被拦命令的改写，用 `rewriteOf` 注明再请求；'
        + '否则可以直接跑。');
  }
}

export function createCommandRerunTools(config: CommandRerunToolsConfig): CommandRerunToolsHandle {
  // Freeze the trusted principal before returning the factory: the model cannot
  // rebind the request Run or the request identity.
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

  async function execute(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const callId = call.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      return failed('', 'invalid_arguments', 'the Kernel tool call has no callId');
    }
    const parsed = inputSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return failed(callId, 'invalid_arguments', 'request_command_rerun 参数非法');
    }
    let args: RequestCommandRerunArguments;
    try { args = structuredClone(parsed.data); }
    catch { return failed(callId, 'invalid_arguments', 'the tool arguments cannot be isolated'); }
    if (fixedPrincipal.kind !== 'work_run') {
      return failed(callId, 'execution_failed', 'request_command_rerun requires a work_run principal');
    }
    let requestId: string;
    try { requestId = config.requestIdForCall(call); }
    catch { return failed(callId, 'execution_failed', 'no trusted command identity is bound for this call'); }
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return failed(callId, 'execution_failed', 'the trusted command identity is empty');
    }
    const context = snapshotContext(signal);
    if (context.signal.aborted) return cancelled(callId, 'the rerun request was cancelled before the write');
    let written;
    try {
      written = await config.requests.requestRerun(context, {
        input: { task: structuredClone(config.task), runRef: fixedPrincipal.runRef,
          command: args.command, reason: args.reason,
          ...(args.rewriteOf === undefined ? {} : { rewriteOf: args.rewriteOf }) },
        meta: { requestId, expected: [] },
      });
    } catch {
      return failed(callId, 'execution_failed',
        'the rerun request did not return a result; its outcome is unconfirmed and it may already be committed. '
        + 'Do not report it as not written and do not retry under a new callId.');
    }
    if (written.status === 'committed') {
      return outcomeResult(callId, written);
    }
    if (written.status !== 'rejected') {
      // L19a's fixed text names the form ALREADY waiting, which the owner's
      // no-write outcome carries; the new request's command is never used here.
      return outcomeResult(callId, written);
    }
    if (written.code === 'cancelled') return cancelled(callId, written.reason);
    // The owner's `invalid`/`capacity` are real domain outcomes. The Kernel's
    // tool-error vocabulary has no `capacity` code, so it maps to
    // `execution_failed` with the owner's own message (UNSPECIFIED in the reply).
    return failed(callId, written.code === 'invalid' ? 'invalid_arguments' : 'execution_failed', written.reason);
  }

  function definition(): ToolDefinition {
    return {
      name: REQUEST_COMMAND_RERUN_TOOL_NAME,
      description: PLATFORM_PROMPT_PACK_V1.tools['request_command_rerun'].description,
      inputSchema,
      // A platform-state write: the Kernel permission policy and the Host
      // authorization list apply, but no workspace write or process capability
      // is granted and no file change is reported.
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      independentReadOnly: false,
      defaultTimeoutMs: 10_000,
      outputLimitBytes: 64 * 1024,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(call, options.signal);
        },
      },
    };
  }

  return { names: REQUEST_COMMAND_RERUN_TOOL_NAMES, create: () => [definition()] };
}
