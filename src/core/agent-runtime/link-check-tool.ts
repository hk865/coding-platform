/**
 * The read-only semantic-link check tool `check_links`.
 *
 * This is a thin, trusted adapter over the note check port's second tier. It
 * owns no note, no store and no transcript, and it writes nothing: a call
 * re-checks the named link notes and reports each one's read-time link
 * verification. The factory freezes the trusted call context at creation time;
 * the model may only supply the strict per-call `items` below, never a
 * principal, workspace, priority or identity.
 *
 * The platform re-checks doubtful links by itself when the Host is idle, so
 * the model normally does not call this tool. A real domain rejection (for
 * example an unknown note id) is reported verbatim as a domain result, never
 * rewritten into a success.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type {
  ToolCall, ToolDefinition, ToolResult, WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import { toolSchema as z } from '../../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import { NOTE_LINK_VERIFY_MAX } from '../work-graph/model/note-contracts.js';
import type { NoteCheckPort } from '../work-graph/model/note-contracts.js';
import { linkChecksOf } from '../work-graph/notes/semantic-layer-read.js';
import { failure, rejectedResult, success } from './graph-tools.js';

/** The generated pack's literal `tools` object has no string index signature. */
const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

export const LINK_CHECK_TOOL_NAMES = ['check_links'] as const;

type LinkCheckToolsConfig = {
  /** The trusted current call context; the factory freezes it before returning. */
  context: CoreCallContext;
  check: Pick<NoteCheckPort, 'checkNotes'>;
  /** The platform tools' model-facing texts; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
};

type CheckLinkItem = { noteId: string; version: number };
type CheckLinksArgs = { items: CheckLinkItem[] };

const checkLinksSchema: z.ZodType = z.object({
  items: z.array(z.object({
    noteId: z.string().min(1),
    version: z.number().int(),
  }).strict()).min(1).max(NOTE_LINK_VERIFY_MAX),
}).strict();

export function createLinkCheckTools(config: LinkCheckToolsConfig): {
  names: readonly string[];
  create(workspace: WorkspaceSandbox): ToolDefinition[];
} {
  const textOf = (name: string): ToolTextV1 =>
    config.texts?.[name] ?? PLATFORM_TOOL_TEXTS[name]!;
  // Freeze the trusted scope/principal before returning the factory: a caller
  // that mutates its config object afterwards can never retarget a handler.
  const fixedProjectId = config.context.projectId;
  const fixedWorkspaceId = config.context.workspaceId;
  const fixedPrincipal = structuredClone(config.context.principal);
  const fixedMaterialReader = structuredClone(config.context.materialReader);

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

  async function execute(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const callId = call.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      return failure('', 'invalid_arguments', 'the Kernel tool call has no callId');
    }
    // Isolation happens before the first await; the strict schema rejects every
    // model-supplied identity/scope/priority field before the check is reached.
    const parsed = checkLinksSchema.safeParse(call.arguments);
    if (!parsed.success) return failure(callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    const accepted = structuredClone(parsed.data) as CheckLinksArgs;
    const context = snapshotContext(signal);
    try {
      const result = await config.check.checkNotes(context, {
        items: accepted.items,
        verifyLinks: { priority: 'agent' },
      });
      if (result.status === 'ready') return success(callId, linkChecksOf(result.value));
      return rejectedResult(callId, result, 'the link check could not be read');
    } catch {
      return failure(callId, 'execution_failed', 'the link check did not return a result; its outcome is unconfirmed');
    }
  }

  function definitionFor(name: (typeof LINK_CHECK_TOOL_NAMES)[number]): ToolDefinition {
    return {
      name,
      description: textOf('check_links').description,
      inputSchema: checkLinksSchema,
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

  return {
    names: LINK_CHECK_TOOL_NAMES,
    create: () => LINK_CHECK_TOOL_NAMES.map(name => definitionFor(name)),
  };
}
