/**
 * The `propose_role_split` model adapter.
 *
 * One thin adapter over the role-split owner's `requestSplit`: the strict model arguments name the scopes to move and
 * the reason; the trusted Work caller, the command id and the context are bound by the factory. The owner validates
 * the move with the same split planner the maintenance page uses and refuses at once; a refusal goes back to the model
 * as the tool result, never a suspended call. A split that waits for a person's card is a success with one sentence,
 * as `hand_off`'s is. This file adds no second validator.
 */
import type { ActorRef } from '../../contracts/command-event.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { OperationRef } from '../../contracts/core/operations.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { RoleScopeV1 } from '../../contracts/role-lines.js';
import {
  toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult, type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import { noneEffects, success as successWithText } from './command-rerun-tools.js';
import { failure, rejectedResult, success } from './graph-tools.js';

/** Typed view: the generated pack's literal `tools` object has no string index signature. */
const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

export const PROPOSE_ROLE_SPLIT_TOOL_NAME = 'propose_role_split';

export type RoleSplitToolOwnerV1 = {
  requestSplit(ctx: CoreCallContext, input: {
    commandId: string;
    caller: { kind: 'work'; actor: Extract<ActorRef, { kind: 'agent' }>; session: SessionRef; run: RunRef };
    move: readonly RoleScopeV1[]; reason: string;
  }): Promise<{ status: 'accepted'; operation: OperationRef; revision: number }
    /** The split waits for a person's `role_line_change` card (card supplement C7). */
    | { status: 'needs_decision'; cardKey: string; operation: OperationRef }
    | CoreRejection>;
};

export type RoleSplitToolsConfig = {
  roleSplit: RoleSplitToolOwnerV1;
  /** Trusted, already-bound context; snapshotted per call. */
  context: CoreCallContext;
  /** The real Work identity of the line asking to split. */
  caller: { kind: 'work'; actor: Extract<ActorRef, { kind: 'agent' }>; session: SessionRef; run: RunRef };
  /** Trusted command identity: Kernel `ToolCall.callId` + bound Run. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** The platform tool's model-facing text; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
};

/** The shape of `RoleScopeV1`: a project, one goal or one region. */
const roleScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project') }).strict(),
  z.object({
    kind: z.literal('goal'),
    goalRef: z.object({
      aggregateType: z.literal('Goal'),
      projectId: z.string().min(1),
      goalId: z.string().min(1),
    }).strict(),
  }).strict(),
  z.object({
    kind: z.literal('region'),
    moduleRef: z.object({
      projectId: z.string().min(1),
      moduleId: z.string().min(1),
    }).strict(),
  }).strict(),
]);

const roleSplitArgsSchema = z.object({
  move: z.array(roleScopeSchema),
  reason: z.string(),
}).strict();

export function createRoleSplitTools(config: RoleSplitToolsConfig):
{ names: readonly string[]; create: (workspace: WorkspaceSandbox) => ToolDefinition[] } {
  const text = config.texts?.[PROPOSE_ROLE_SPLIT_TOOL_NAME] ?? PLATFORM_TOOL_TEXTS[PROPOSE_ROLE_SPLIT_TOOL_NAME]!;

  function snapshotRoleSplitContext(signal: AbortSignal): CoreCallContext {
    return {
      projectId: config.context.projectId,
      ...(config.context.workspaceId === undefined ? {} : { workspaceId: config.context.workspaceId }),
      principal: structuredClone(config.context.principal),
      materialReader: structuredClone(config.context.materialReader),
      signal,
    };
  }

  async function executeRoleSplit(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const callId = call.callId;
    const parsed = roleSplitArgsSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return failure(callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    }
    const commandId = config.requestIdForCall(call);
    const result = await config.roleSplit.requestSplit(snapshotRoleSplitContext(signal), {
      commandId,
      caller: structuredClone(config.caller),
      move: structuredClone(parsed.data.move),
      reason: parsed.data.reason,
    });
    if (result.status === 'rejected') {
      // `cancelled` (e.g. a plan declined on its card, card supplement §2.2) is the tool's own cancelled result; the
      // refusal stays in the output.
      if (result.code === 'cancelled') {
        return { schemaVersion: 1, callId, status: 'cancelled', reason: result.reason,
          output: [{ kind: 'json', value: result as never }], effects: noneEffects() };
      }
      return rejectedResult(callId, result, result.reason);
    }
    if (result.status === 'needs_decision') {
      return successWithText(callId, result, '拆线已登记，等人在卡上决定；这一轮不要重复提交。');
    }
    return success(callId, result);
  }

  function roleSplitDefinition(): ToolDefinition {
    return {
      name: PROPOSE_ROLE_SPLIT_TOOL_NAME,
      description: text.description,
      inputSchema: roleSplitArgsSchema,
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      defaultTimeoutMs: 60_000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: false,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return executeRoleSplit(call, options.signal);
        },
      },
    };
  }

  return { names: [PROPOSE_ROLE_SPLIT_TOOL_NAME], create: () => [roleSplitDefinition()] };
}
