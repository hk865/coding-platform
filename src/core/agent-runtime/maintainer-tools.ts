/**
 * The `assign_module_maintainer` model adapter.
 *
 * One thin adapter over the module maintainer owner's `requestAssignment`: the
 * strict model arguments name the module, the target line and the reason; the
 * trusted Work caller, the command id and the context are bound by the factory.
 * The owner keeps every admission rule (the stored operation, the confirmation
 * mode and the command's proof); this file adds no second copy of them.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type {
  MaintainerAssignmentToolResultV1, ModuleMaintainerPort,
} from '../work-graph/model/module-maintainer-contracts.js';
import type { MaintainerAssignmentCallerV1 } from '../work-graph/state/module-maintainer-assignment.js';
import {
  toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult, type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import { failure, rejectedResult, success } from './graph-tools.js';

/** Typed view: the generated pack's literal `tools` object has no string index signature. */
const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

export const ASSIGN_MODULE_MAINTAINER_TOOL_NAME = 'assign_module_maintainer';

export type AssignMaintainerToolsConfig = {
  maintainers: Pick<ModuleMaintainerPort, 'requestAssignment'>;
  /** Trusted, already-bound context; snapshotted per call. */
  context: CoreCallContext;
  /** The real Work identity the stored operation records (no proof). */
  caller: MaintainerAssignmentCallerV1;
  /** Trusted command identity: Kernel `ToolCall.callId` + bound Run/operation. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** The platform tool's model-facing text; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
};

export type AssignMaintainerToolsHandle = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

const assignMaintainerArgsSchema = z.object({
  moduleRef: z.object({
    projectId: z.string().min(1),
    moduleId: z.string().min(1),
  }).strict(),
  sessionRef: z.object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
  }).strict(),
  reason: z.string(),
}).strict();

export function createAssignMaintainerTools(config: AssignMaintainerToolsConfig): AssignMaintainerToolsHandle {
  const text = config.texts?.[ASSIGN_MODULE_MAINTAINER_TOOL_NAME]
    ?? PLATFORM_TOOL_TEXTS[ASSIGN_MODULE_MAINTAINER_TOOL_NAME]!;

  function snapshotMaintainerContext(signal: AbortSignal): CoreCallContext {
    return {
      projectId: config.context.projectId,
      ...(config.context.workspaceId === undefined ? {} : { workspaceId: config.context.workspaceId }),
      principal: structuredClone(config.context.principal),
      materialReader: structuredClone(config.context.materialReader),
      signal,
    };
  }

  async function executeAssignMaintainer(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const callId = call.callId;
    const parsed = assignMaintainerArgsSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return failure(callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    }
    const commandId = config.requestIdForCall(call);
    const context = snapshotMaintainerContext(signal);
    // The owner's one entry: it creates the stored operation and either waits
    // for the person's answer or applies the automatic branch itself.
    const result: MaintainerAssignmentToolResultV1 = await config.maintainers.requestAssignment(context, {
      commandId,
      caller: structuredClone(config.caller),
      moduleRef: { ...parsed.data.moduleRef },
      line: { ...parsed.data.sessionRef },
      reason: parsed.data.reason,
    });
    if (result.status === 'rejected') return rejectedResult(callId, result, result.reason);
    return success(callId, result);
  }

  function maintainerDefinitionFor(): ToolDefinition {
    return {
      name: ASSIGN_MODULE_MAINTAINER_TOOL_NAME,
      description: text.description,
      inputSchema: assignMaintainerArgsSchema,
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      defaultTimeoutMs: 60_000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: false,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return executeAssignMaintainer(call, options.signal);
        },
      },
    };
  }

  return { names: [ASSIGN_MODULE_MAINTAINER_TOOL_NAME], create: () => [maintainerDefinitionFor()] };
}
