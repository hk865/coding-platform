/**
 * The `propose_architecture_revision` Work tool.
 *
 * The adviser's structural proposal is a thin adapter over the proposal owner: the
 * model supplies the pinned base catalog, the ops, the responsibility moves and a
 * reason; the trusted context and the tool call's command id are fixed by the
 * runtime. The owner keeps the trial, the proposal id and the receipt identity, so
 * the tool neither mints an id nor retries under a second one.
 */
import type { ProposeArchitectureRevisionInputV1 } from '../../contracts/architecture-proposal.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import { messageOf } from '../../contracts/error-message.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import type { ArchitectureProposalService } from '../work-graph/architecture/proposal-service.js';
import { failure, success } from './graph-tools.js';
import { noneEffects } from './command-rerun-tools.js';
import {
  toolSchema as z,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';

const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

export const PROPOSE_ARCHITECTURE_TOOL_NAME = 'propose_architecture_revision' as const;
export const ARCHITECTURE_TOOL_NAMES = [PROPOSE_ARCHITECTURE_TOOL_NAME] as const;

export type ArchitectureToolsConfig = {
  /** Trusted, already-bound context. Snapshotted at factory creation. */
  context: CoreCallContext;
  /** The SAME proposal owner the composition registers. */
  propose: Pick<ArchitectureProposalService, 'proposeArchitectureRevision'>;
  /** Trusted command identity: Kernel `ToolCall.callId` + bound Run/operation. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** The platform tool's model-facing text; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
};

export type ArchitectureToolsHandle = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

function outputValue(value: unknown): ToolResult['output'] {
  return [{ kind: 'json', value: value as never }];
}

// --------------------------------------------------------------------------
// Strict model-facing schema. The command id, project/workspace and proposer are
// bound by the adapter, so a model-supplied identity is an unknown key here.
// --------------------------------------------------------------------------

const catalogPinSchema = z.object({
  catalogRef: z.object({
    aggregateType: z.literal('ArchitectureCatalog'), projectId: z.string().min(1),
    baselineId: z.string().min(1), revision: z.number().int().min(1),
  }).strict(),
  baseline: z.object({
    ref: z.object({
      aggregateType: z.literal('ArchitectureBaselineRevision'), projectId: z.string().min(1),
      baselineId: z.string().min(1), revision: z.number().int().min(1),
    }).strict(),
    digest: z.string().min(1),
  }).strict(),
}).strict();

const responsibilityMoveSchema = z.object({
  link: z.record(z.string(), z.unknown()),
  to: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('standby') }).strict(),
    z.object({ kind: z.literal('modules'),
      destinations: z.array(z.record(z.string(), z.unknown())) }).strict(),
  ]),
}).strict();

const operationRefSchema = z.object({
  aggregateType: z.literal('CoreOperation'), projectId: z.string().min(1), operationId: z.string().min(1),
}).strict();

const proposeSchema = z.object({
  baseCatalogPin: catalogPinSchema,
  ops: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
  responsibilityMoves: z.array(responsibilityMoveSchema),
  reason: z.string().min(1),
  operationRef: operationRefSchema.optional(),
}).strict();

export function createArchitectureTools(config: ArchitectureToolsConfig): ArchitectureToolsHandle {
  const description = (config.texts?.[PROPOSE_ARCHITECTURE_TOOL_NAME]
    ?? PLATFORM_TOOL_TEXTS[PROPOSE_ARCHITECTURE_TOOL_NAME]!).description;
  // Freeze the trusted scope/identity before returning the factory.
  const fixedProjectId = config.context.projectId;
  const fixedWorkspaceId = config.context.workspaceId;
  const fixedPrincipal = structuredClone(config.context.principal);
  const fixedMaterialReader = structuredClone(config.context.materialReader);
  const fixedPropose = config.propose;

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
      return failure('', 'invalid_arguments', 'the Kernel tool call has no callId');
    }
    const parsed = proposeSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return failure(callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    }
    let accepted: z.infer<typeof proposeSchema>;
    try {
      accepted = structuredClone(parsed.data);
    } catch {
      return failure(callId, 'invalid_arguments', 'the tool arguments cannot be isolated');
    }
    let commandId: string;
    try {
      commandId = config.requestIdForCall(call);
    } catch {
      return failure(callId, 'execution_failed', 'no trusted command identity is bound for this call');
    }
    if (typeof commandId !== 'string' || commandId.length === 0) {
      return failure(callId, 'execution_failed', 'the trusted command identity is empty');
    }
    const context = snapshotContext(signal);
    if (context.signal.aborted) {
      return {
        schemaVersion: 1, callId, status: 'cancelled',
        reason: 'the proposal call was cancelled before the write',
        output: outputValue({ status: 'rejected', code: 'cancelled',
          reason: 'the proposal call was cancelled before the write' }),
        effects: noneEffects(),
      };
    }
    try {
      const input: ProposeArchitectureRevisionInputV1 & { commandId: string } = {
        baseCatalogPin: accepted.baseCatalogPin,
        ops: accepted.ops as ProposeArchitectureRevisionInputV1['ops'],
        responsibilityMoves: accepted.responsibilityMoves as ProposeArchitectureRevisionInputV1['responsibilityMoves'],
        reason: accepted.reason,
        ...(accepted.operationRef === undefined ? {} : { operationRef: accepted.operationRef }),
        commandId,
      };
      const result = await fixedPropose.proposeArchitectureRevision(context, input);
      return success(callId, result);
    } catch (error) {
      return failure(callId, 'execution_failed',
        `the proposal call did not return a result: ${messageOf(error)}. Its outcome is unconfirmed and it may already be committed.`);
    }
  }

  function definitionFor(): ToolDefinition {
    return {
      name: PROPOSE_ARCHITECTURE_TOOL_NAME,
      description,
      inputSchema: proposeSchema,
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      defaultTimeoutMs: 10000,
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

  return {
    names: ARCHITECTURE_TOOL_NAMES,
    create: () => [definitionFor()],
  };
}
