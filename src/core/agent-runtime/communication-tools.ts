/**
 * C1 SessionMailbox Kernel tool adapter.
 *
 * The factory has the SAME `{ names, create }` shape as the frozen
 * `coordinationTools` seam on `observed-model-run.ts`, so the Host can assemble
 * it without changing any Kernel type. `context` is a trusted, already-bound
 * `CoreCallContext`; `sessionRef` is the trusted Host-bound current Session
 * (used to address the inbox — the service still re-checks it through WG11).
 * `requestIdForCall` receives the Kernel-dispatched `ToolCall.callId` plus the
 * bound Run/operation; the model never supplies a requestId.
 *
 * Every handler parses a STRICT schema, snapshots its arguments and the bound
 * context synchronously before the first await, forwards the Kernel call signal
 * into the real service, and reports success ONLY for a real `committed`
 * mailbox result. It never fabricates a Host actor, invents an expected pin or
 * performs an automatic ack/reply.
 *
 * 2026-09-28 共同机制：`send_session_message` 不再在工具内轮询回复。意图、需要回复与
 * 发送后立即等待是三件独立事实；当 `waitAfterSend` 为真时，消息先被持久保存，然后由
 * Runtime 侧登记真实等待，Kernel 工具组屏障在排空后提交 `run.yielded`。让出是独立的
 * 执行终止事实，后续唤醒在原 Session 建立新 Turn/Run，而不是挂起模型 promise。
 */
import type { CommitCursor } from '../../contracts/command-event.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { SessionMessageIntentV1, SessionMessageRef } from '../../contracts/core/session-message.js';
import type { ReadResult, WriteResult } from '../../contracts/core/results.js';
import {
  toolSchema as z,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import type { SessionMailboxPort, SessionMessage } from '../work-graph/communication/contracts.js';

/** Fixed production tool names. The Kernel host-authorization list comes from here. */
export const SESSION_MAILBOX_TOOL_NAMES = [
  'send_session_message',
  'read_session_inbox',
  'read_session_message',
  'read_session_message_body',
  'ack_session_message',
  'respond_session_message',
] as const;

export type SessionMailboxToolName = (typeof SESSION_MAILBOX_TOOL_NAMES)[number];

export type SessionMailboxToolsConfig = {
  mailbox: SessionMailboxPort;
  /** Trusted, already-bound context. Snapshotted per call; never model JSON. */
  context: CoreCallContext;
  /** Trusted Host-bound Session used to address inbox reads. */
  sessionRef: SessionRef;
  /** Trusted command identity: Kernel `ToolCall.callId` + bound Run/operation. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /**
   * The real registration seam for an explicit waitAfterSend. It is called ONLY
   * after the message is durably committed; the Runtime owns the per-Run wait
   * registry and lets the Kernel tool-group barrier commit the real yield.
   * Absent keeps the message a normal durable send with no wait fact.
   */
  onWaitRegistered?: (message: SessionMessage) => void;
};

/** The Kernel dispatcher timeout for `send_session_message`. The tool never
 * blocks for a reply: it saves the message and returns after the registration,
 * so a bounded ordinary timeout is enough. */
export const SESSION_MESSAGE_SEND_TIMEOUT_MS = 15_000;

export type SessionMailboxToolsHandle = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

/** Platform-state writes change no workspace file: never claim a file effect. */
function noneEffects(): ToolResult['effects'] {
  return { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] };
}

function outputValue(value: unknown): ToolResult['output'] {
  return [{ kind: 'json', value: value as never }];
}
function success(callId: string, value: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'success', output: outputValue(value), effects: noneEffects() };
}
function failure(callId: string, code: 'invalid_arguments' | 'execution_failed', message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code, message, retryable: false }, output: [], effects: noneEffects(),
  };
}
function cancelled(callId: string, reason: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'cancelled', reason, output: [], effects: noneEffects() };
}
/** A real domain rejection keeps `code`/`reason`/`current` in the JSON output so
 * the model can distinguish a retry conflict, a permission denial and a
 * not-ready record instead of only seeing an opaque execution_failed. */
function rejectedResult(callId: string, result: unknown, message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code: 'execution_failed', message, retryable: false }, output: outputValue(result), effects: noneEffects(),
  };
}
/** A domain `cancelled` rejection also keeps the full typed result. */
function cancelledResult(callId: string, reason: string, result: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'cancelled', reason, output: outputValue(result), effects: noneEffects() };
}

function mapWrite(callId: string, result: WriteResult<SessionMessage>): ToolResult {
  if (result.status === 'committed') return success(callId, result);
  if (result.status === 'rejected' && result.code === 'cancelled') return cancelledResult(callId, result.reason, result);
  return rejectedResult(callId, result, result.reason);
}

function mapRead(callId: string, result: ReadResult<unknown>): ToolResult {
  if (result.status === 'ready') return success(callId, result.value);
  if (result.status === 'not_ready') return rejectedResult(callId, result, 'the requested mailbox record is not ready');
  if (result.status === 'not_found') return rejectedResult(callId, result, 'the requested mailbox record does not exist');
  if (result.code === 'cancelled') return cancelledResult(callId, result.reason, result);
  return rejectedResult(callId, result, result.reason);
}

export function createSessionMailboxTools(config: SessionMailboxToolsConfig): SessionMailboxToolsHandle {
  const session = z.object({ projectId: z.string().min(1), sessionId: z.string().min(1) }).strict();
  const message = z.object({
    aggregateType: z.literal('SessionMessage'),
    projectId: z.string().min(1),
    workspaceId: z.string().min(1),
    messageId: z.string().min(1),
  }).strict();
  const schemas: readonly z.ZodType[] = [
    z.object({
      recipient: session,
      text: z.string().min(1),
      /** Explicit intent; omitted keeps the historical notify default. */
      intent: z.enum(['notify', 'inquiry', 'action_request']).optional(),
      /** Independent of waitAfterSend: a reply may be requested without waiting. */
      needsReply: z.boolean().optional(),
      /** Independent of needsReply: yield after the message is durably saved. */
      waitAfterSend: z.boolean().optional(),
      /** Legacy equivalent of waitAfterSend=true; normalized, never a second flow. */
      replyMode: z.literal('wait').optional(),
    }).strict(),
    z.object({
      status: z.enum(['pending', 'read', 'responded']).optional(),
      page: z.object({
        limit: z.number().int().min(1).max(100),
        cursor: z.string().min(1).optional(),
        atLeastCursor: z.string().min(1).optional(),
      }).strict(),
    }).strict(),
    z.object({ messageRef: message }).strict(),
    z.object({ messageRef: message, part: z.enum(['message', 'response']) }).strict(),
    z.object({ messageRef: message, expectedRevision: z.number().int().min(1) }).strict(),
    z.object({ messageRef: message, expectedRevision: z.number().int().min(1), text: z.string().min(1) }).strict(),
  ];
  const trustedSessionRef: SessionRef = { projectId: config.sessionRef.projectId, sessionId: config.sessionRef.sessionId };

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
    run: (args: Args, requestId: string, context: CoreCallContext) => Promise<ToolResult>,
  ): Promise<ToolResult> {
    // Isolation happens before the first await: a caller mutating its argument
    // object afterwards cannot change what was accepted.
    const parsed = schema.safeParse(call.arguments);
    if (!parsed.success) return failure(call.callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    let accepted: Args;
    try {
      accepted = structuredClone(parsed.data) as Args;
    } catch {
      return failure(call.callId, 'invalid_arguments', 'the tool arguments cannot be isolated');
    }
    let requestId: string;
    try {
      requestId = config.requestIdForCall(call);
    } catch {
      return failure(call.callId, 'execution_failed', 'no trusted command identity is bound for this call');
    }
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return failure(call.callId, 'execution_failed', 'the trusted command identity is empty');
    }
    const context = snapshotContext(signal);
    if (context.signal.aborted) return cancelled(call.callId, 'the tool call was cancelled before the mailbox call');
    try {
      return await run(accepted, requestId, context);
    } catch {
      return failure(call.callId, 'execution_failed', 'the mailbox call result is unconfirmed; inspect the original request before issuing another action');
    }
  }

  function definitionFor(index: number): ToolDefinition {
    const name = SESSION_MAILBOX_TOOL_NAMES[index]!;
    const schema = schemas[index]!;
    const readOnly = name.startsWith('read_');
    return {
      name,
      description: `Session mailbox: ${name}`,
      inputSchema: schema,
      effectClass: readOnly ? 'read_only' : 'workspace_write',
      // Read-only extension tools register through the Kernel read-only seam; a
      // platform read is not a workspace file read, but `workspace_read` is the
      // existing registration label that lets a legal query reach the handler.
      // Writes stay non-read-only and are authorized through hostAuthorizedTools.
      requiredCapabilities: readOnly ? ['workspace_read'] : [],
      defaultTimeoutMs: name === 'send_session_message' ? SESSION_MESSAGE_SEND_TIMEOUT_MS : 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: readOnly,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(call, options.signal, schema, async (args, requestId, context) => {
            switch (name) {
              case 'send_session_message': {
                const input = args as {
                  recipient: SessionRef; text: string; intent?: SessionMessageIntentV1;
                  needsReply?: boolean; waitAfterSend?: boolean; replyMode?: 'wait';
                };
                const result = await config.mailbox.sendMessage(context, {
                  input: {
                    recipient: { ...input.recipient }, text: input.text,
                    ...(input.intent === undefined ? {} : { intent: input.intent }),
                    ...(input.needsReply === undefined ? {} : { needsReply: input.needsReply }),
                    ...(input.waitAfterSend === undefined ? {} : { waitAfterSend: input.waitAfterSend }),
                    ...(input.replyMode === undefined ? {} : { replyMode: input.replyMode }),
                  },
                  meta: { requestId, expected: [] },
                });
                if (result.status !== 'committed') return mapWrite(call.callId, result);
                // The historical fire-and-forget send keeps the untouched result.
                const waitAfterSend = input.waitAfterSend === true || input.replyMode === 'wait';
                if (!waitAfterSend) return mapWrite(call.callId, result);
                // The message is ALREADY durably saved; registration never changes
                // the send receipt and never starts a model or a poll loop.
                config.onWaitRegistered?.(result.value);
                return success(call.callId, {
                  message: result.value,
                  response: null,
                  waiting: true,
                  reason: 'the message is durably saved; the Run yields and continues on the matching reply',
                });
              }
              case 'read_session_inbox': {
                const input = args as {
                  status?: 'pending' | 'read' | 'responded';
                  page: { limit: number; cursor?: string; atLeastCursor?: string };
                };
                const result = await config.mailbox.readInbox(context, {
                  recipient: { ...trustedSessionRef },
                  ...(input.status === undefined ? {} : { status: input.status }),
                  page: {
                    limit: input.page.limit,
                    ...(input.page.cursor === undefined ? {} : { cursor: input.page.cursor }),
                    ...(input.page.atLeastCursor === undefined ? {} : { atLeastCursor: input.page.atLeastCursor as CommitCursor }),
                  },
                });
                return mapRead(call.callId, result);
              }
              case 'read_session_message': {
                const input = args as { messageRef: SessionMessageRef };
                const result = await config.mailbox.readMessage(context, { ...input.messageRef });
                return mapRead(call.callId, result);
              }
              case 'read_session_message_body': {
                const input = args as { messageRef: SessionMessageRef; part: 'message' | 'response' };
                const result = await config.mailbox.readMessageBody(context, {
                  messageRef: { ...input.messageRef }, part: input.part,
                });
                return mapRead(call.callId, result);
              }
              case 'ack_session_message': {
                const input = args as { messageRef: SessionMessageRef; expectedRevision: number };
                const result = await config.mailbox.ackMessage(context, {
                  input: { messageRef: { ...input.messageRef } },
                  meta: { requestId, expected: [{ ref: { ...input.messageRef }, revision: input.expectedRevision }] },
                });
                return mapWrite(call.callId, result);
              }
              case 'respond_session_message': {
                const input = args as { messageRef: SessionMessageRef; expectedRevision: number; text: string };
                const result = await config.mailbox.respondMessage(context, {
                  input: { messageRef: { ...input.messageRef }, text: input.text },
                  meta: { requestId, expected: [{ ref: { ...input.messageRef }, revision: input.expectedRevision }] },
                });
                return mapWrite(call.callId, result);
              }
              default:
                return failure(call.callId, 'execution_failed', 'the mailbox tool name is not recognized');
            }
          });
        },
      },
    };
  }

  return {
    names: SESSION_MAILBOX_TOOL_NAMES,
    create: () => SESSION_MAILBOX_TOOL_NAMES.map((_name, index) => definitionFor(index)),
  };
}
