/**
 * AG1 read-only Session discovery Kernel tool adapter.
 *
 * The factory has the SAME `{ names, create }` shape as the frozen
 * `coordinationTools` seam, so the Runtime assembles it without changing any
 * Kernel type. `context` is a trusted, already-bound `CoreCallContext` (the
 * Runtime binds the real work_run Run); the model never supplies an identity or
 * workspace. Both tools are read-only extensions: `find_related_sessions`
 * forwards the bound workspace and a REQUIRED target to the real directory with
 * `includeArchived === false`, and `read_session_card` returns the real card.
 *
 * There is no mailbox write identity, replay run, material/Role check, manager,
 * owner, cache or lock here. A success output keeps the FULL `ReadResult`; a
 * non-ready result keeps its typed value and never claims success.
 */
import type { CommitCursor } from '../../contracts/command-event.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef, WorkLinkTarget } from '../../contracts/core/identity.js';
import type { ReadResult } from '../../contracts/core/results.js';
import {
  toolSchema as z,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import type { SessionDirectoryPort } from '../work-graph/sessions/contracts.js';

/** Fixed production tool names. The Kernel host-authorization list comes from here. */
export const SESSION_DISCOVERY_TOOL_NAMES = ['find_related_sessions', 'read_session_card'] as const;

export type SessionDiscoveryToolName = (typeof SESSION_DISCOVERY_TOOL_NAMES)[number];

export type SessionDiscoveryToolsConfig = {
  sessions: Pick<SessionDirectoryPort, 'findSessions' | 'readSession'>;
  /** Trusted, already-bound context. Snapshotted per call; never model JSON. */
  context: CoreCallContext;
};

export type SessionDiscoveryToolsHandle = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

/** Platform-state reads change no workspace file: never claim a file effect. */
function noneEffects(): ToolResult['effects'] {
  return { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] };
}
function success(callId: string, value: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'success',
    output: [{ kind: 'json', value: value as never }], effects: noneEffects() };
}
function failure(callId: string, code: 'invalid_arguments' | 'execution_failed', message: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'error',
    error: { code, message, retryable: false }, output: [], effects: noneEffects() };
}
function cancelled(callId: string, reason: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'cancelled', reason, output: [], effects: noneEffects() };
}
/** A real domain `not_ready`/`not_found`/rejection keeps its typed JSON so the
 * model sees the actual status/code/reason; success is never claimed. */
function rejectedResult(callId: string, result: unknown, message: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'error',
    error: { code: 'execution_failed', message, retryable: false },
    output: [{ kind: 'json', value: result as never }], effects: noneEffects() };
}
function cancelledResult(callId: string, reason: string, result: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'cancelled', reason,
    output: [{ kind: 'json', value: result as never }], effects: noneEffects() };
}

function mapRead(callId: string, result: ReadResult<unknown>): ToolResult {
  if (result.status === 'ready') return success(callId, result);
  if (result.status === 'not_ready') return rejectedResult(callId, result, 'the requested Session fact is not ready');
  if (result.status === 'not_found') return rejectedResult(callId, result, 'the requested Session record does not exist');
  if (result.code === 'cancelled') return cancelledResult(callId, result.reason, result);
  return rejectedResult(callId, result, result.reason);
}

const identifier = z.string().min(1);
const taskRef = z.object({ projectId: identifier, goalId: identifier, taskId: identifier }).strict();
const moduleRef = z.object({ projectId: identifier, moduleId: identifier }).strict();
const workRef = z.object({
  aggregateType: z.literal('WorkContextBinding'),
  projectId: identifier, workspaceId: identifier, workId: identifier,
}).strict();
const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('task'), ref: taskRef }).strict(),
  z.object({ kind: z.literal('module'), ref: moduleRef }).strict(),
  z.object({ kind: z.literal('work'), ref: workRef }).strict(),
]);
const sessionSchema = z.object({ projectId: identifier, sessionId: identifier }).strict();
const pageSchema = z.object({
  limit: z.number().int().min(1).max(200),
  cursor: z.string().min(1).optional(),
  atLeastCursor: z.string().min(1).optional(),
}).strict();
const schemas: readonly z.ZodType[] = [
  z.object({ target: targetSchema, page: pageSchema }).strict(),
  z.object({ sessionRef: sessionSchema }).strict(),
];

export function createSessionDiscoveryTools(config: SessionDiscoveryToolsConfig): SessionDiscoveryToolsHandle {
  function snapshotContext(signal: AbortSignal): CoreCallContext {
    return {
      projectId: config.context.projectId,
      ...(config.context.workspaceId === undefined ? {} : { workspaceId: config.context.workspaceId }),
      principal: structuredClone(config.context.principal),
      materialReader: structuredClone(config.context.materialReader),
      signal,
    };
  }

  async function execute<Args>(
    call: Readonly<ToolCall>,
    signal: AbortSignal,
    schema: z.ZodType,
    run: (args: Args, context: CoreCallContext) => Promise<ToolResult>,
  ): Promise<ToolResult> {
    // Isolation happens before the first await: a later caller mutation cannot
    // change what was accepted.
    const parsed = schema.safeParse(call.arguments);
    if (!parsed.success) return failure(call.callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    let accepted: Args;
    try {
      accepted = structuredClone(parsed.data) as Args;
    } catch {
      return failure(call.callId, 'invalid_arguments', 'the tool arguments cannot be isolated');
    }
    const context = snapshotContext(signal);
    if (context.signal.aborted) return cancelled(call.callId, 'the tool call was cancelled before the directory read');
    try {
      return await run(accepted, context);
    } catch {
      return failure(call.callId, 'execution_failed', 'the directory read did not return a result');
    }
  }

  function definitionFor(index: number): ToolDefinition {
    const name = SESSION_DISCOVERY_TOOL_NAMES[index]!;
    const schema = schemas[index]!;
    return {
      name,
      description: name === 'find_related_sessions'
        ? 'List the current Session cards linked to a required Task/Module/WorkContext target. Only open links and active Sessions are returned; archived Sessions are excluded. Read-only discovery: it starts no Run, loads no history and wakes no Session.'
        : 'Read the current Session card (record, availability and work links) for one exact SessionRef. Read-only: it does not wake the Session, change occupancy, start a Run or load history.',
      inputSchema: schema,
      effectClass: 'read_only',
      // A platform directory read is not a workspace file read, but
      // `workspace_read` is the existing registration label that lets a legal
      // query reach the handler.
      requiredCapabilities: ['workspace_read'],
      defaultTimeoutMs: 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: true,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(call, options.signal, schema, async (args, context) => {
            switch (name) {
              case 'find_related_sessions': {
                const input = args as {
                  target: WorkLinkTarget;
                  page: { limit: number; cursor?: string; atLeastCursor?: string };
                };
                const result = await config.sessions.findSessions(context, {
                  // The workspace is ALWAYS the bound context; the model cannot
                  // name another workspace or ask for archived Sessions.
                  workspace: { projectId: context.projectId, workspaceId: context.workspaceId ?? '' },
                  target: input.target,
                  includeArchived: false,
                  page: {
                    limit: input.page.limit,
                    ...(input.page.cursor === undefined ? {} : { cursor: input.page.cursor }),
                    ...(input.page.atLeastCursor === undefined ? {}
                      : { atLeastCursor: input.page.atLeastCursor as CommitCursor }),
                  },
                });
                return mapRead(call.callId, result);
              }
              case 'read_session_card': {
                const input = args as { sessionRef: SessionRef };
                const result = await config.sessions.readSession(context, { ...input.sessionRef });
                return mapRead(call.callId, result);
              }
              default:
                return failure(call.callId, 'execution_failed', 'the discovery tool name is not recognized');
            }
          });
        },
      },
    };
  }

  return {
    names: SESSION_DISCOVERY_TOOL_NAMES,
    create: () => SESSION_DISCOVERY_TOOL_NAMES.map((_name, index) => definitionFor(index)),
  };
}
