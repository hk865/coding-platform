// The hand_off adapter. It adds no state rule, no approval and no understanding check:
// requestHandoff (B/handoff-tool-entry.ts, H) owns all of them; this file only maps
// the model's arguments onto the trusted caller and the owner's result onto the Kernel.
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ActorRef } from '../../contracts/command-event.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { TaskTriple, RunRef } from '../../contracts/dispatch.js';
import type { OperationRef } from '../../contracts/core/operations.js';
import { HAND_OFF_TOOL_NAME } from '../../contracts/handoff.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import {
  toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult, type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import { failed, noneEffects, success } from './command-rerun-tools.js';
import { agentActorOf } from '../work-graph/model/tool-commit-arguments.js';

export const HANDOFF_TOOL_NAMES = [HAND_OFF_TOOL_NAME] as const;

const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

/** The narrow port H's requestHandoff structurally satisfies; T declares it so T compiles
 *  before H's file merges, and L2 passes the real function at composition. */
export type HandoffRequestPort = (ctx: CoreCallContext, input: {
  commandId: string;
  /** The book's caller shape (book-7c.md:994): T fills `actor` from the trusted Run with
   *  `agentActorOf` (tool-commit-arguments.ts:85), the derivation decision-service.ts:313 uses. */
  caller: { actor: Extract<ActorRef, { kind: 'agent' }>; session: SessionRef; run: RunRef;
    duty: 'executor' | 'adviser' };
  source: SessionRef;
  assignments: {
    target: { kind: 'create'; duty: 'executor' | 'adviser' } | { kind: 'existing'; session: SessionRef };
    tasks: TaskTriple[];
  }[];
  reason: string;
}) => Promise<
  | { status: 'incomplete'; text: string }
  | { status: 'accepted'; operation: OperationRef }
  | { status: 'needs_decision'; cardKey: string; operation: OperationRef }
  | CoreRejection>;

export type HandoffToolsConfig = {
  handoffs: HandoffRequestPort;
  context: CoreCallContext;          // trusted work_run principal; never model JSON
  sessionRef: SessionRef;            // the trusted caller Session
  /** The caller line's formal Session duty; executor or adviser only. */
  duty: 'executor' | 'adviser';
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  texts?: Readonly<Record<string, ToolTextV1>>;
};

export type HandoffToolsHandle = { names: readonly string[]; create: (workspace: WorkspaceSandbox) => ToolDefinition[] };

/** The book's one input shape (book-7c.md:553-557): source, a non-empty assignments array,
 *  each target create|existing and its tasks, and a reason. The owner re-checks every
 *  business fact (open responsible link, same workspace, same duty, secretary refusal). */
function buildInputSchema(text: ToolTextV1) {
  const parameters = text.parameters;
  const session = z.object({ projectId: z.string().min(1), sessionId: z.string().min(1) }).strict();
  const taskTriple = z.object({
    projectId: z.string().min(1), goalId: z.string().min(1), taskId: z.string().min(1),
  }).strict();
  return z.object({
    source: session.describe(parameters['source']!),
    assignments: z.array(z.object({
      target: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('create'), duty: z.enum(['executor', 'adviser']) }).strict(),
        z.object({ kind: z.literal('existing'), session }).strict(),
      ]),
      tasks: z.array(taskTriple),
    }).strict()).min(1).describe(parameters['assignments']!),
    reason: z.string().min(1).describe(parameters['reason']!),
  }).strict();
}

type HandoffArguments = z.infer<ReturnType<typeof buildInputSchema>>;

export function createHandoffTools(config: HandoffToolsConfig): HandoffToolsHandle {
  const text = config.texts?.[HAND_OFF_TOOL_NAME] ?? PLATFORM_TOOL_TEXTS[HAND_OFF_TOOL_NAME]!;
  const inputSchema = buildInputSchema(text);
  const principal = structuredClone(config.context.principal);

  async function execute(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const parsed = inputSchema.safeParse(call.arguments);
    if (!parsed.success) return failed(call.callId, 'invalid_arguments', 'hand_off 参数非法');
    const args: HandoffArguments = parsed.data;
    if (principal.kind !== 'work_run') {
      return failed(call.callId, 'execution_failed', 'hand_off requires a work_run principal');
    }
    const caller = {
      actor: agentActorOf(config.sessionRef, principal.runRef),
      session: { ...config.sessionRef }, run: principal.runRef, duty: config.duty,
    };
    let requestId: string;
    try { requestId = config.requestIdForCall(call); } catch { return failed(call.callId, 'execution_failed', 'no trusted command identity'); }
    const context: CoreCallContext = { projectId: config.context.projectId,
      ...(config.context.workspaceId === undefined ? {} : { workspaceId: config.context.workspaceId }),
      principal: structuredClone(principal), materialReader: structuredClone(config.context.materialReader), signal };
    if (signal.aborted) return { schemaVersion: 1, callId: call.callId, status: 'cancelled',
      reason: 'the handoff request was cancelled before the owner call', output: [], effects: noneEffects() };
    let result: Awaited<ReturnType<HandoffRequestPort>>;
    try {
      result = await config.handoffs(context, { commandId: requestId, caller,
        source: { ...args.source }, assignments: args.assignments, reason: args.reason });
    } catch {
      return failed(call.callId, 'execution_failed', 'the handoff request result is unconfirmed; do not retry under a new callId');
    }
    if (!('status' in result) || result.status !== 'incomplete' && result.status !== 'accepted'
      && result.status !== 'needs_decision') {
      const r = result as CoreRejection;
      if (r.code === 'cancelled') return { schemaVersion: 1, callId: call.callId, status: 'cancelled',
        reason: r.reason, output: [], effects: noneEffects() };
      return failed(call.callId, 'execution_failed', r.reason);
    }
    if (result.status === 'incomplete') return success(call.callId, result, result.text);
    if (result.status === 'needs_decision') {
      return success(call.callId, result, '交接已登记，等人批准后再开始接手；这一轮不能继续交接，也不要重复提交。');
    }
    return success(call.callId, result, '交接已接受，接手会在批准后按阶段进行。');
  }

  return {
    names: HANDOFF_TOOL_NAMES,
    create: (): ToolDefinition[] => [{
      name: HAND_OFF_TOOL_NAME, description: text.description, inputSchema,
      effectClass: 'workspace_write', requiredCapabilities: [], independentReadOnly: false,
      defaultTimeoutMs: 10_000, outputLimitBytes: 64 * 1024,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: { execute: (call, options) => execute(call, options.signal) },
    }],
  };
}
