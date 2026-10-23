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
import { decisionSourceKey } from '../../contracts/goal-decisions.js';
import type { DecisionSourceV1 } from '../../contracts/goal-decisions.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import type { ReadResult, WriteResult } from '../../contracts/core/results.js';
import {
  toolSchema as z,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import type { SessionMailboxPort, SessionMessage } from '../work-graph/model/communication-contracts.js';
import type { DecisionMessagePort } from '../work-graph/model/decision-contracts.js';
import {
  ackSessionMessageRequest, recordDecisionApplicationRequest, respondSessionMessageRequest,
  sendSessionMessageRequest, sendUserMessageRequest,
} from '../work-graph/model/tool-commit-arguments.js';

/** Typed view: the generated pack's literal `tools` object has no string index signature. */
const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

/** Fixed production tool names. The Kernel host-authorization list comes from here. */
export const SESSION_MAILBOX_TOOL_NAMES = [
  'send_session_message',
  'read_session_inbox',
  'read_session_message',
  'read_session_message_body',
  'ack_session_message',
  'respond_session_message',
] as const;

/**
 * Slice 5 §4.6 user-decision tool names. They are registered ONLY when the
 * mailbox tool config carries a real `decisionMessages` dependency; an old
 * composition keeps exactly the original six `SESSION_MAILBOX_TOOL_NAMES`.
 */
export const USER_DECISION_TOOL_NAMES = [
  'send_user_message',
  'read_user_decision',
  'record_decision_application',
] as const;

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
  /**
   * Slice 5 §4.6: the user-decision owner. Optional so an old composition keeps
   * exactly the original six tools and starts as before; when present the three
   * `USER_DECISION_TOOL_NAMES` are added. The model supplies no actor/duties/
   * operator/requestId field for any of them.
   */
  decisionMessages?: Pick<DecisionMessagePort,
    'sendUserMessage' | 'recordDecisionApplication' | 'readDecisionAnswer'>;
  /** The platform tools' model-facing texts; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
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

// -------------------------------------------------------------------------- //
// Slice 5 user-decision tool schemas (spec §4.6).                             //
// -------------------------------------------------------------------------- //
//
// The three user-decision tools reuse the SAME strict model-argument discipline
// as the mailbox tools: every object is `.strict()`, so an actor/duties/
// operator/requestId field supplied by the model is an unknown key and fails as
// `invalid_arguments`. The nested refs are the canonical decision-source refs
// (spec §3.3); they are strict too and never carry an authority field.

const decisionGoalRefSchema = z.object({
  aggregateType: z.literal('Goal'),
  projectId: z.string().min(1),
  goalId: z.string().min(1),
}).strict();

const decisionWorkspaceRefSchema = z.object({
  aggregateType: z.literal('Workspace'),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
}).strict();

const decisionWorkspaceScopeSchema = z.object({
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
}).strict();

const decisionMessageRefSchema = z.object({
  aggregateType: z.literal('SessionMessage'),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  messageId: z.string().min(1),
}).strict();

const decisionPlanRevisionRefSchema = z.object({
  aggregateType: z.literal('PlanRevision'),
  projectId: z.string().min(1),
  planId: z.string().min(1),
}).strict();

const decisionPlanProposalRefSchema = z.object({
  aggregateType: z.literal('PlanProposal'),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  proposalId: z.string().min(1),
}).strict();

const decisionQueryJobRefSchema = z.object({
  aggregateType: z.literal('QueryJob'),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  queryJobId: z.string().min(1),
}).strict();

const decisionQueryRunRefSchema = z.object({
  aggregateType: z.literal('QueryRun'),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  queryJobId: z.string().min(1),
  runId: z.string().min(1),
}).strict();

const decisionQueryJobAnswerRefSchema = z.object({
  aggregateType: z.literal('QueryJobAnswer'),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  queryJobId: z.string().min(1),
  answerId: z.string().min(1),
}).strict();

/** One `VersionPin` of a decision source (spec §2.3, §3.3). */
const decisionVersionPinSchema = z.object({
  ref: z.discriminatedUnion('aggregateType', [
    decisionGoalRefSchema, decisionWorkspaceRefSchema, decisionMessageRefSchema,
    decisionPlanRevisionRefSchema, decisionPlanProposalRefSchema,
    decisionQueryJobRefSchema, decisionQueryRunRefSchema, decisionQueryJobAnswerRefSchema,
  ]),
  revision: z.number().int().min(0),
}).strict();

const decisionParallelRiskSchema = z.object({
  otherGoalRef: decisionGoalRefSchema,
  selfPlanRef: decisionPlanRevisionRefSchema.nullable(),
  otherPlanRef: decisionPlanRevisionRefSchema.nullable(),
}).strict();

const decisionGoalSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  autonomy: z.enum(['every_step', 'after_plan_confirmation']),
  order: z.number().int(),
  waitForGoalRef: decisionGoalRefSchema.nullable(),
  parallelRisks: z.array(decisionParallelRiskSchema),
}).strict();

const decisionGoalBasisSchema = z.object({
  goalRef: decisionGoalRefSchema,
  workspaceRef: decisionWorkspaceRefSchema,
  objective: z.string(),
  activePlanRef: decisionPlanRevisionRefSchema.nullable(),
  settings: decisionGoalSettingsSchema,
}).strict();

/** Canonical `DecisionSourceV1` the model names for a read/record call. */
const decisionSourceSchema = z.object({
  kind: z.enum(['message', 'goal_cause', 'candidate', 'note_review',
    'planning_question', 'goal_conflict', 'message_release']),
  key: z.string().min(1),
  goalRef: decisionGoalRefSchema,
  pins: z.array(decisionVersionPinSchema),
  goalBases: z.array(decisionGoalBasisSchema).optional(),
}).strict();

const decisionOptionSchema = z.object({
  id: z.string().min(1), label: z.string(),
  effect: z.enum(['apply', 'reject', 'defer']),
}).strict();

const decisionObjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('aggregate'), pin: decisionVersionPinSchema, label: z.string() }).strict(),
  z.object({ kind: z.literal('file'), workspace: decisionWorkspaceScopeSchema,
    path: z.string().min(1), digest: z.string().nullable(), label: z.string() }).strict(),
]);

const decisionApplicationReceiptSchema = z.object({
  identityKey: z.string().min(1),
  fingerprint: z.string().min(1),
  cursor: z.string().min(1),
}).strict();

/** Strict args of the three tools, index-aligned with `USER_DECISION_TOOL_NAMES`. */
const USER_DECISION_TOOL_SCHEMAS: readonly z.ZodType[] = [
  // send_user_message = the §3.3 `sendUserMessage` input, never its meta.
  z.object({
    goalRef: decisionGoalRefSchema,
    intent: z.enum(['notify', 'decision_request']),
    text: z.string(),
    needsReply: z.boolean(),
    waitAfterSend: z.boolean(),
    options: z.array(decisionOptionSchema),
    objects: z.array(decisionObjectSchema),
    forwardedFrom: decisionMessageRefSchema.optional(),
  }).strict(),
  // read_user_decision = { source: DecisionSourceV1 }
  z.object({ source: decisionSourceSchema }).strict(),
  // record_decision_application = { messageRef, receipt }
  z.object({
    messageRef: decisionMessageRefSchema,
    receipt: decisionApplicationReceiptSchema,
  }).strict(),
];


export function createSessionMailboxTools(config: SessionMailboxToolsConfig): SessionMailboxToolsHandle {
  const textOf = (name: string): ToolTextV1 =>
    config.texts?.[name] ?? PLATFORM_TOOL_TEXTS[name]!;
  const toolDescriptions: Readonly<Record<string, string>> = {
    send_session_message: textOf('send_session_message').description,
    read_session_inbox: textOf('read_session_inbox').description,
    read_session_message: textOf('read_session_message').description,
    read_session_message_body: textOf('read_session_message_body').description,
    ack_session_message: textOf('ack_session_message').description,
    respond_session_message: textOf('respond_session_message').description,
    send_user_message: textOf('send_user_message').description,
    read_user_decision: textOf('read_user_decision').description,
    record_decision_application: textOf('record_decision_application').description,
  };
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

  /**
   * Slice 5 §4.6: the user-decision read keeps the caller's REAL principal.
   * The owner checks the bound scope and the formal allowed-reader Session
   * itself, so an agent can only read a card whose canonical source names its
   * own Run/Query Session; a synthesized Host principal would silently bypass
   * that gate. The model still supplies no actor.
   */
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
      description: toolDescriptions[name]!,
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
                  needsReply?: boolean; waitAfterSend?: boolean;
                };
                const result = await config.mailbox.sendMessage(context, sendSessionMessageRequest(input, requestId));
                if (result.status !== 'committed') return mapWrite(call.callId, result);
                // The historical fire-and-forget send keeps the untouched result.
                const waitAfterSend = input.waitAfterSend === true;
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
                const result = await config.mailbox.ackMessage(context, ackSessionMessageRequest(input, requestId));
                return mapWrite(call.callId, result);
              }
              case 'respond_session_message': {
                const input = args as { messageRef: SessionMessageRef; expectedRevision: number; text: string };
                const result = await config.mailbox.respondMessage(context, respondSessionMessageRequest(input, requestId));
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

  /**
   * The three user-decision tools. Part 1 registers their strict schemas and
   * stub handlers only; Part 2 replaces the handlers with the real
   * `decisionMessages` calls. None of them carries an actor/duties/operator/
   * requestId model field.
   */
  function decisionDefinitionFor(index: number): ToolDefinition {
    const name = USER_DECISION_TOOL_NAMES[index]!;
    const schema = USER_DECISION_TOOL_SCHEMAS[index]!;
    const readOnly = name === 'read_user_decision';
    return {
      name,
      description: toolDescriptions[name]!,
      inputSchema: schema,
      effectClass: readOnly ? 'read_only' : 'workspace_write',
      requiredCapabilities: readOnly ? ['workspace_read'] : [],
      defaultTimeoutMs: name === 'send_user_message' ? SESSION_MESSAGE_SEND_TIMEOUT_MS : 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: readOnly,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(call, options.signal, schema, async (args, requestId, context) => {
            const decisions = config.decisionMessages;
            if (decisions === undefined) {
              return failure(call.callId, 'execution_failed', 'no user decision owner is bound for this tool');
            }
            switch (name) {
              case 'send_user_message': {
                const input = args as Parameters<DecisionMessagePort['sendUserMessage']>[1]['input'];
                const result = await decisions.sendUserMessage(context, sendUserMessageRequest(input, requestId));
                if (result.status !== 'committed') return mapWrite(call.callId, result);
                // The message is already durably saved; registration never changes
                // the send receipt and never starts a model or a poll loop.
                if (input.waitAfterSend) config.onWaitRegistered?.(result.value);
                return success(call.callId, { message: result.value, waiting: input.waitAfterSend });
              }
              case 'read_user_decision': {
                const input = args as Parameters<DecisionMessagePort['readDecisionAnswer']>[1];
                const result = await decisions.readDecisionAnswer(context, { source: input.source });
                return mapRead(call.callId, result);
              }
              case 'record_decision_application': {
                const input = args as Parameters<DecisionMessagePort['recordDecisionApplication']>[1]['input'];
                const messageRef: SessionMessageRef = { ...input.messageRef };
                // §4.6/N7: the message pin is read through the decision-authorised
                // read, never the Session inbox admission — a synthetic Host→User
                // answer is not addressed to the asking Session, so the mailbox
                // reader would refuse it. The stored message is resolved by this
                // canonical message key, so only the key is an input here.
                const messageSource = {
                  kind: 'message' as const,
                  key: decisionSourceKey({ kind: 'message', messageRef }),
                  pins: [],
                } as unknown as DecisionSourceV1;
                // §4.6/DEFECT 4: prefer the additive pin-only read so a missing
                // answer BODY artifact cannot fail an otherwise valid application
                // record. `readDecisionAnswer` (frozen port) stays the fallback
                // when the bound owner does not expose the additive read.
                const pinReader = (decisions as unknown as {
                  readDecisionMessagePin?: (ctx: CoreCallContext, value: { source: DecisionSourceV1 }) =>
                    Promise<ReadResult<{ message: SessionMessage | null }>>;
                }).readDecisionMessagePin;
                const preRead = () => (pinReader === undefined
                  ? decisions.readDecisionAnswer(context, { source: messageSource })
                  : pinReader.call(decisions, context, { source: messageSource }));
                let read: Awaited<ReturnType<typeof preRead>>;
                try {
                  read = await preRead();
                } catch (error) {
                  // Lead LR3 (§8.2 line 1366): a pre-read that throws is a read
                  // failure too; it must not hide the original receipt below.
                  read = { status: 'rejected', code: 'unavailable',
                    reason: `the decision answer pre-read failed: ${error instanceof Error ? error.message : String(error)}` };
                }
                if (read.status !== 'ready') {
                  // F2 (blocker 3, runtime half) / §8.2 line 1366: the pin
                  // pre-read is a NEW business read, so a failure here must not
                  // hide the ORIGINAL receipt of an identical retried call. Ask
                  // the owner's read-only replay entry — which uses the SAME
                  // identity and fingerprint as recordDecisionApplication and
                  // never writes — for the replayed committed result before
                  // returning the read failure. A fresh, never-committed call
                  // gets the unchanged read failure back. When the bound owner
                  // has no replay entry (old composition) today's path stays.
                  const replayReader = (decisions as unknown as {
                    replayDecisionApplication?: (ctx: CoreCallContext, request: {
                      input: { messageRef: SessionMessageRef; receipt: typeof input.receipt };
                      meta: { requestId: string };
                    }) => Promise<ReadResult<{
                      replayed: Extract<WriteResult<SessionMessage>, { status: 'committed' }> | null;
                    }>>;
                  }).replayDecisionApplication;
                  if (replayReader !== undefined) {
                    const replay = await replayReader.call(decisions, context, {
                      input: { messageRef, receipt: input.receipt }, meta: { requestId },
                    });
                    if (replay.status === 'ready') {
                      if (replay.value.replayed !== null) return mapWrite(call.callId, replay.value.replayed);
                    } else {
                      // The replay lookup itself failed; return that read
                      // failure rather than masking it with the pre-read one.
                      return mapRead(call.callId, replay);
                    }
                  }
                  return mapRead(call.callId, read);
                }
                const saved = read.value.message;
                if (saved === null) {
                  return rejectedResult(call.callId,
                    { status: 'not_found', reason: 'the decision answer message does not exist' },
                    'the decision answer message does not exist');
                }
                const result = await decisions.recordDecisionApplication(context,
                  recordDecisionApplicationRequest({ messageRef: saved.ref, receipt: input.receipt }, requestId,
                    [{ ref: saved.ref, revision: saved.revision }]));
                return mapWrite(call.callId, result);
              }
              default:
                return failure(call.callId, 'execution_failed', 'the user decision tool name is not recognized');
            }
          });
        },
      },
    };
  }

  // The three user-decision names exist only when the real decision owner is
  // bound. Without it the factory still returns exactly the original six.
  const decisionNames: readonly string[] = config.decisionMessages === undefined ? [] : USER_DECISION_TOOL_NAMES;

  return {
    names: [...SESSION_MAILBOX_TOOL_NAMES, ...decisionNames],
    create: () => [
      ...SESSION_MAILBOX_TOOL_NAMES.map((_name, index) => definitionFor(index)),
      ...decisionNames.map((_name, index) => decisionDefinitionFor(index)),
    ],
  };
}
