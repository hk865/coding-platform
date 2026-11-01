/**
 * The secretary's one read-only view of the main conversation's requests.
 *
 * The adapter projects a whole page or one request through
 * `MainSurfaceReadPort` and keeps only request fields; each round's answer is
 * cut at the shared 2 KiB bound with the pack's own cut line. It reads no card,
 * notice or seen position and writes nothing.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import { truncateUtf8 } from '../../contracts/utf8.js';
import { success, failure, rejectedResult } from './graph-tools.js';
import {
  SECRETARY_HISTORY_ANSWER_BYTES, type RequestCoreViewV1,
} from '../work-graph/model/request-contracts.js';
import {
  parseMainReadInput, type MainSurfaceReadPort,
} from '../work-graph/views/main-surface-read-model.js';
import {
  toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult, type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';

/** Typed view: the generated pack's literal `tools` object has no string index signature. */
const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

export const READ_REQUESTS_TOOL_NAME = 'read_requests';
export const READ_REQUESTS_TOOL_NAMES = [READ_REQUESTS_TOOL_NAME] as const;

/** The one cut: 2 KiB, with the pack's own cut line. */
function cutAnswer(answer: string | null, cutLine: string): string | null {
  if (answer === null) return null;
  const kept = truncateUtf8(answer, SECRETARY_HISTORY_ANSWER_BYTES);
  return kept.length < answer.length ? `${kept}\n${cutLine}` : kept;
}
function rowOf(view: RequestCoreViewV1, cutLine: string) {
  return {
    requestRoot: view.requestRoot, goalId: view.goalId, effectiveGoalId: view.effectiveGoalId,
    firstRound: view.rounds[0]?.input ?? null, owner: view.owner, ownerState: view.ownerState,
    processing: view.processing, assignment: view.assignment, waitReason: view.waitReason,
    rounds: view.rounds.map(round => ({ ref: round.ref, status: round.status,
      answer: cutAnswer(round.answer, cutLine) })),
  };
}

const requestRootSchema = z.object({
  aggregateType: z.literal('QueryJob'), projectId: z.string().min(1),
  workspaceId: z.string().min(1), queryJobId: z.string().min(1),
}).strict();
const cursorSchema = z.object({
  phase: z.enum(['goal', 'pre']), since: z.string().min(1), rootKey: z.string().min(1),
}).strict();
const readRequestsSchema = z.union([
  z.object({ goalId: z.union([z.string().min(1), z.null()]), cursor: cursorSchema.nullable().optional() }).strict(),
  z.object({ requestRoot: requestRootSchema }).strict(),
]);

export type ReadRequestToolsConfig = {
  view: MainSurfaceReadPort;
  context: CoreCallContext;
  cutLine: string;
  texts?: Readonly<Record<string, ToolTextV1>>;
};
export type ReadRequestToolsHandle = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

export function createReadRequestTools(config: ReadRequestToolsConfig): ReadRequestToolsHandle {
  const text = config.texts?.[READ_REQUESTS_TOOL_NAME] ?? PLATFORM_TOOL_TEXTS[READ_REQUESTS_TOOL_NAME]!;

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
    const parsed = readRequestsSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return failure(callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    }
    const context = snapshotContext(signal);
    try {
      if ('requestRoot' in parsed.data) {
        const view = await config.view.readRequestView(context, { requestRoot: parsed.data.requestRoot });
        if (view.status !== 'ready') return rejectedResult(callId, view, 'the request read failed');
        return success(callId, rowOf(view.value, config.cutLine));
      }
      const input = parseMainReadInput({ goalId: parsed.data.goalId, cursor: parsed.data.cursor ?? null });
      if (typeof input === 'string') return failure(callId, 'invalid_arguments', input);
      const page = await config.view.readMainPage(context, input);
      if (page.status !== 'ready') return rejectedResult(callId, page, 'the request read failed');
      return success(callId, { goalId: page.value.goalId,
        requests: page.value.requests.map(view => rowOf(view, config.cutLine)), next: page.value.next });
    } catch {
      return failure(callId, 'execution_failed', 'the request read did not return a result');
    }
  }

  function definitionFor(): ToolDefinition {
    return {
      name: READ_REQUESTS_TOOL_NAME,
      description: text.description,
      inputSchema: readRequestsSchema,
      effectClass: 'read_only',
      requiredCapabilities: ['workspace_read'],
      defaultTimeoutMs: 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: true,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(call, options.signal);
        },
      },
    };
  }

  return { names: READ_REQUESTS_TOOL_NAMES, create: () => [definitionFor()] };
}
