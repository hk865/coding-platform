/**
 * The `create_member` model adapter.
 *
 * One thin adapter over `MemberRequestPortV1`: the strict model arguments name
 * the duty, the task scope, the reason and (when the model follows a message
 * request) the acknowledgement; the trusted caller, the command id and the
 * context are bound by the factory. The owner keeps every admission rule, the
 * reuse-then-decide order and the one output table; this file adds no second
 * copy of them.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type {
  MemberCallerV1, MemberRequestPortV1, MemberRequestResultV1,
} from '../work-graph/tasks/member-service.js';
import {
  toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult, type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';

/** Typed view: the generated pack's literal `tools` object has no string index signature. */
const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

export const CREATE_MEMBER_TOOL_NAME = 'create_member';

export type CreateMemberToolsConfig = {
  members: Pick<MemberRequestPortV1, 'requestMember'>;
  /** Trusted, already-bound context; snapshotted per call. */
  context: CoreCallContext;
  /** The Work Run, the resolved secretary round or the adviser's planning round. */
  caller: MemberCallerV1;
  /** Trusted command identity: Kernel `ToolCall.callId` + bound Run/operation. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** The platform tool's model-facing text; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
};

export type CreateMemberToolsHandle = {
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
function rejectedResult(callId: string, result: unknown, message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code: 'execution_failed', message, retryable: false }, output: outputValue(result), effects: noneEffects(),
  };
}
function failure(callId: string, code: 'invalid_arguments' | 'execution_failed', message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code, message, retryable: false }, output: [], effects: noneEffects(),
  };
}

const memberCreationArgsSchema = z.object({
  duty: z.literal('executor'),
  scope: z.object({
    kind: z.literal('task'),
    task: z.object({
      projectId: z.string().min(1),
      goalId: z.string().min(1),
      taskId: z.string().min(1),
    }).strict(),
  }).strict(),
  reason: z.string(),
  acknowledgement: z.object({
    aggregateType: z.literal('SessionMessage'),
    projectId: z.string().min(1),
    workspaceId: z.string().min(1),
    messageId: z.string().min(1),
  }).strict().optional(),
}).strict();

export function createMemberTools(config: CreateMemberToolsConfig): CreateMemberToolsHandle {
  const text = config.texts?.[CREATE_MEMBER_TOOL_NAME] ?? PLATFORM_TOOL_TEXTS[CREATE_MEMBER_TOOL_NAME]!;

  function snapshotContext(signal: AbortSignal): CoreCallContext {
    return {
      projectId: config.context.projectId,
      ...(config.context.workspaceId === undefined ? {} : { workspaceId: config.context.workspaceId }),
      principal: structuredClone(config.context.principal),
      materialReader: structuredClone(config.context.materialReader),
      signal,
    };
  }

  async function execute(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const callId = call.callId;
    const parsed = memberCreationArgsSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return failure(callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    }
    const commandId = config.requestIdForCall(call);
    const context = snapshotContext(signal);
    // The owner's own byte rule (`memberCreateInputProblem`), refusal and four
    // result arms; the adapter only maps them.
    const result: MemberRequestResultV1 = await config.members.requestMember(context, {
      commandId,
      caller: config.caller,
      duty: parsed.data.duty,
      scope: { kind: 'task', task: { ...parsed.data.scope.task } },
      reason: parsed.data.reason,
      ...(parsed.data.acknowledgement === undefined ? {} : { acknowledgement: { ...parsed.data.acknowledgement } }),
    });
    if (result.status === 'rejected') return rejectedResult(callId, result, result.reason);
    return success(callId, result);
  }

  function definitionFor(): ToolDefinition {
    return {
      name: CREATE_MEMBER_TOOL_NAME,
      description: text.description,
      inputSchema: memberCreationArgsSchema,
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      defaultTimeoutMs: 60_000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: false,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(call, options.signal);
        },
      },
    };
  }

  return { names: [CREATE_MEMBER_TOOL_NAME], create: () => [definitionFor()] };
}
