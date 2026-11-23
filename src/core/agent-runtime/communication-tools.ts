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
import type { TaskTriple } from '../../contracts/dispatch.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import { decisionSourceKey } from '../../contracts/goal-decisions.js';
import type { DecisionSourceV1 } from '../../contracts/goal-decisions.js';
import type { GoalRef } from '../../contracts/ledger.js';
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
import type {
  SessionMessage, SessionMessageCommandPort,
} from '../work-graph/model/communication-contracts.js';
import type { DecisionMessagePort } from '../work-graph/model/decision-contracts.js';
import type { ActionRequestPort, ClaimHoldPort } from '../work-graph/model/action-request-contracts.js';
import {
  askCopySendRequest, personMessageRequest, recordDecisionApplicationRequest, respondSessionMessageRequest,
  sendSessionMessageRequest, withdrawSessionMessageRequest,
  type SessionMessageSendInput,
} from '../work-graph/model/tool-commit-arguments.js';
import type { RespondMessageV1 } from '../work-graph/model/message-payload.js';

/** Typed view: the generated pack's literal `tools` object has no string index signature. */
const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

/** Fixed production tool names. The Kernel host-authorization list comes from here. */
export const SESSION_MAILBOX_TOOL_NAMES = [
  'send_session_message',
  'read_session_inbox',
  'read_session_message',
  'read_session_message_body',
  'respond_session_message',
  'withdraw_session_message',
] as const;

/**
 * The §2.6 action tools, in the order the §2.6 table names them. They are adapters
 * only: the P1 owners (`platform.actionRequests`, `platform.claimHolds`) own every
 * rule, receipt and rejection, and their receipts are returned unchanged.
 */
export const ACTION_TOOL_NAMES = [
  'dispatch_task',
  'hold_claim',
  'release_hold',
  'request_stop',
] as const;

/**
 * Slice 5 §4.6 user-decision tool names. `send_user_message` was split into
 * `notify_person`/`ask_person` (design 1.2); what stays here is the read of an
 * existing answer and the application record.
 */
export const USER_DECISION_TOOL_NAMES = [
  'read_user_decision',
  'record_decision_application',
] as const;

/**
 * The two person-addressed message tools. They are adapters over the one
 * `sendUserMessage` owner: `notify_person` asks no reply, `ask_person` asks one
 * and carries the card's options/objects. Neither opens a round here.
 */
export const PERSON_MESSAGE_TOOL_NAMES = ['notify_person', 'ask_person'] as const;

/** The read-only copy question: stored through `sendMessage`, never delivered to the original line. */
export const ASK_COPY_TOOL_NAME = 'ask_copy';

export type SessionMailboxToolsConfig = {
  mailbox: SessionMessageCommandPort;
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

/** AGTP-9: the frozen refusal text for a Query round's `waitAfterSend`. */
const QUERY_WAIT_REFUSAL = '问答轮不能选“发完等回复”（waitAfterSend）：回复会在这一轮结束后、之后的轮次里交给你。把 waitAfterSend 设为 false 再发。';

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
// The two user-decision tools reuse the SAME strict model-argument discipline
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

/** A `ProjectScope`: the project a project subject names, and nothing else. */
const decisionProjectScopeSchema = z.object({ projectId: z.string().min(1) }).strict();

/** The subject of a decision source: a Goal or a project, never both and never a second `goalRef` beside it. */
const decisionSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('goal'), goalRef: decisionGoalRefSchema }).strict(),
  z.object({ kind: z.literal('project'), projectRef: decisionProjectScopeSchema }).strict(),
]);

/** Canonical `DecisionSourceV1` the model names for a read/record call. */
const decisionSourceSchema = z.object({
  kind: z.enum(['message', 'goal_cause', 'candidate', 'note_review',
    'planning_question', 'goal_conflict', 'action_release']),
  key: z.string().min(1),
  subject: decisionSubjectSchema,
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

/** Strict args of the two user-decision tools, index-aligned with `USER_DECISION_TOOL_NAMES`. */
const USER_DECISION_TOOL_SCHEMAS: readonly z.ZodType[] = [
  // read_user_decision = { source: DecisionSourceV1 }
  z.object({ source: decisionSourceSchema }).strict(),
  // record_decision_application = { messageRef, receipt }
  z.object({
    messageRef: decisionMessageRefSchema,
    receipt: decisionApplicationReceiptSchema,
  }).strict(),
];

const sessionRefSchema = z.object({ projectId: z.string().min(1), sessionId: z.string().min(1) }).strict();
const messageRefSchema = z.object({
  aggregateType: z.literal('SessionMessage'),
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  messageId: z.string().min(1),
}).strict();
const taskTripleSchema = z.object({
  projectId: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1),
}).strict();
/** The exact `DispatchBasisV1` shape: `planRevision` may be null and `pointerRevision` may be 'none'. */
const dispatchBasisSchema = z.object({
  planRevision: z.number().int().min(0).nullable(),
  pointerRevision: z.union([z.number().int().min(0), z.literal('none')]),
  dispatchSequence: z.number().int().min(0),
}).strict();

/**
 * The one strict-argument executor every coordination tool factory here shares:
 * isolation happens before the first await, the request identity is the trusted
 * Kernel call identity plus the bound Run, and the caller's real principal is
 * snapshotted (the user-decision read and the action owners must see it).
 */
function createToolExecutor(context: CoreCallContext, requestIdForCall: (call: Readonly<ToolCall>) => string) {
  function mailboxSnapshotContext(signal: AbortSignal): CoreCallContext {
    return {
      projectId: context.projectId,
      ...(context.workspaceId === undefined ? {} : { workspaceId: context.workspaceId }),
      principal: structuredClone(context.principal),
      materialReader: structuredClone(context.materialReader),
      signal,
    };
  }
  return async function execute<Args>(
    call: Readonly<ToolCall>,
    signal: AbortSignal,
    schema: z.ZodType,
    run: (args: Args, requestId: string, context: CoreCallContext) => Promise<ToolResult>,
  ): Promise<ToolResult> {
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
      requestId = requestIdForCall(call);
    } catch {
      return failure(call.callId, 'execution_failed', 'no trusted command identity is bound for this call');
    }
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return failure(call.callId, 'execution_failed', 'the trusted command identity is empty');
    }
    const owned = mailboxSnapshotContext(signal);
    if (owned.signal.aborted) return cancelled(call.callId, 'the tool call was cancelled before the mailbox call');
    try {
      return await run(accepted, requestId, owned);
    } catch {
      return failure(call.callId, 'execution_failed', 'the mailbox call result is unconfirmed; inspect the original request before issuing another action');
    }
  };
}

/** An owner receipt keeps its own status: a refusal is an error result with the owner's full JSON output. */
function mapActionReceipt(callId: string, result: { status: string; code?: string; reason?: string }): ToolResult {
  if (result.status !== 'rejected') return success(callId, result);
  return result.code === 'cancelled'
    ? cancelledResult(callId, result.reason ?? 'cancelled', result)
    : rejectedResult(callId, result, result.reason ?? 'the action request was rejected');
}

/** The action tools' strict schemas, index-aligned with `ACTION_TOOL_NAMES`. */
const ACTION_TOOL_SCHEMAS: readonly z.ZodType[] = [
  z.object({
    taskRef: taskTripleSchema,
    reason: z.string().min(1),
    expected: dispatchBasisSchema.optional(),
    preferredLine: sessionRefSchema.optional(),
  }).strict(),
  z.object({ taskRef: taskTripleSchema, reason: z.string().min(1) }).strict(),
  z.object({ taskRef: taskTripleSchema, reasonId: z.string().min(1), note: z.string().min(1).optional() }).strict(),
  z.object({ taskRef: taskTripleSchema, reason: z.string().min(1) }).strict(),
];


export function createSessionMailboxTools(config: SessionMailboxToolsConfig): SessionMailboxToolsHandle {
  const textOf = (name: string): ToolTextV1 =>
    config.texts?.[name] ?? PLATFORM_TOOL_TEXTS[name]!;
  const toolDescriptions: Readonly<Record<string, string>> = {
    send_session_message: textOf('send_session_message').description,
    read_session_inbox: textOf('read_session_inbox').description,
    read_session_message: textOf('read_session_message').description,
    read_session_message_body: textOf('read_session_message_body').description,
    respond_session_message: textOf('respond_session_message').description,
    withdraw_session_message: textOf('withdraw_session_message').description,
    read_user_decision: textOf('read_user_decision').description,
    record_decision_application: textOf('record_decision_application').description,
  };
  const message = messageRefSchema;
  const schemas: readonly z.ZodType[] = [
    z.object({
      recipient: sessionRefSchema,
      text: z.string().min(1),
      /** Independent of waitAfterSend: a reply may be requested without waiting. */
      needsReply: z.boolean().optional(),
      /** Independent of needsReply: yield after the message is durably saved. */
      waitAfterSend: z.boolean().optional(),
      /** The wake bit the sender chooses; omitted keeps the owner's true default. */
      wake: z.boolean().optional(),
      /** The Task this message belongs to; omitted means no task pin. */
      taskRef: taskTripleSchema.optional(),
      /** The message this one follows up; it does NOT start a new request root by itself. */
      followupOf: message.optional(),
      /** Inquiry only: a finite budget greater than 0; overflow belongs to the write. */
      deadlineMs: z.number().finite().gt(0).optional(),
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
    z.union([
      z.object({ messageRef: message, expectedRevision: z.number().int().min(1), text: z.string().min(1) }).strict(),
      z.object({
        messageRef: message, expectedRevision: z.number().int().min(1),
        reject: z.literal(true), reason: z.string().min(1),
      }).strict(),
    ]),
    z.object({ messageRef: message }).strict(),
  ];
  const trustedSessionRef: SessionRef = { projectId: config.sessionRef.projectId, sessionId: config.sessionRef.sessionId };
  const execute = createToolExecutor(config.context, config.requestIdForCall);

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
                const input = args as SessionMessageSendInput;
                // A Query round's `waitAfterSend` is refused by the mailbox owner
                // (`mailbox-send.ts`), not by this adapter: the owner holds the rule.
                const result = await config.mailbox.sendMessage(context, sendSessionMessageRequest(input, requestId));
                if (result.status === 'rejected' && result.code === 'invalid'
                  && result.reason.startsWith('a query round cannot set waitAfterSend'))
                  return failure(call.callId, 'invalid_arguments', QUERY_WAIT_REFUSAL);
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
              case 'respond_session_message': {
                const input = args as RespondMessageV1;
                // The payload is flat; its body arm is spread into the owner's
                // input. The full command port is the one that carries both arms.
                const result = await config.mailbox.respondMessage(context, respondSessionMessageRequest(input, requestId));
                return mapWrite(call.callId, result);
              }
              case 'withdraw_session_message': {
                const input = args as { messageRef: SessionMessageRef };
                const result = await config.mailbox.withdrawMessage(context,
                  withdrawSessionMessageRequest(input, requestId));
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
   * The two user-decision tools. Part 1 registers their strict schemas and
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
      defaultTimeoutMs: 10000,
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

  // The two user-decision names exist only when the real decision owner is
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

export type PersonMessageToolsConfig = {
  /** The one `sendUserMessage` owner behind both person tools; it owns the card metadata and receivers. */
  decisionMessages: Pick<DecisionMessagePort, 'sendUserMessage'>;
  /** The trusted Goal of this round; every person message is scoped to it, never a model argument. */
  goalRef: GoalRef;
  /** Trusted, already-bound call context. Snapshotted per call; never model JSON. */
  context: CoreCallContext;
  /** Trusted command identity: Kernel `ToolCall.callId` + bound Run/operation. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** The person tools' model-facing texts; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
};

/** Strict args, index-aligned with `PERSON_MESSAGE_TOOL_NAMES`. */
const PERSON_MESSAGE_TOOL_SCHEMAS: readonly z.ZodType[] = [
  // notify_person: tell the person, ask nothing.
  z.object({ text: z.string().min(1), taskRef: taskTripleSchema.optional() }).strict(),
  // ask_person: one card with its options and object version pins.
  z.object({
    text: z.string().min(1),
    options: z.array(decisionOptionSchema),
    objects: z.array(decisionObjectSchema),
    taskRef: taskTripleSchema.optional(),
  }).strict(),
];

/**
 * The two person-addressed message adapters. They only hand the model's text
 * and card content to the one `sendUserMessage` owner; that owner decides the
 * recipient, the card metadata, the Goal scope, refusals and the receipt. The
 * reply tool never answers a card: the card's formal answer is the person's,
 * and the owner refuses a reply to a card.
 */
export function createPersonMessageTools(config: PersonMessageToolsConfig): SessionMailboxToolsHandle {
  const mailboxTextOf = (name: string): ToolTextV1 =>
    config.texts?.[name] ?? PLATFORM_TOOL_TEXTS[name]!;
  const descriptions: Readonly<Record<string, string>> = {
    notify_person: mailboxTextOf('notify_person').description,
    ask_person: mailboxTextOf('ask_person').description,
  };
  const execute = createToolExecutor(config.context, config.requestIdForCall);

  function mailboxDefinitionFor(index: number): ToolDefinition {
    const name = PERSON_MESSAGE_TOOL_NAMES[index]!;
    const schema = PERSON_MESSAGE_TOOL_SCHEMAS[index]!;
    return {
      name,
      description: descriptions[name]!,
      inputSchema: schema,
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      defaultTimeoutMs: 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: false,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(call, options.signal, schema, async (args, requestId, context) => {
            switch (name) {
              case 'notify_person': {
                const input = args as { text: string; taskRef?: TaskTriple };
                const request = personMessageRequest({
                  goalRef: config.goalRef, intent: 'notify', text: input.text,
                  ...(input.taskRef === undefined ? {} : { taskRef: input.taskRef }),
                }, requestId);
                const result = await config.decisionMessages.sendUserMessage(context, request);
                return mapWrite(call.callId, result);
              }
              case 'ask_person': {
                const input = args as { text: string;
                  options: Parameters<DecisionMessagePort['sendUserMessage']>[1]['input']['options'];
                  objects: Parameters<DecisionMessagePort['sendUserMessage']>[1]['input']['objects'];
                  taskRef?: TaskTriple };
                const request = personMessageRequest({
                  goalRef: config.goalRef, intent: 'decision_request', text: input.text,
                  options: input.options, objects: input.objects,
                  ...(input.taskRef === undefined ? {} : { taskRef: input.taskRef }),
                }, requestId);
                const result = await config.decisionMessages.sendUserMessage(context, request);
                return mapWrite(call.callId, result);
              }
              default:
                return failure(call.callId, 'execution_failed', 'the person message tool name is not recognized');
            }
          });
        },
      },
    };
  }

  return {
    names: PERSON_MESSAGE_TOOL_NAMES,
    create: () => PERSON_MESSAGE_TOOL_NAMES.map((_name, index) => mailboxDefinitionFor(index)),
  };
}

export type AskCopyToolConfig = {
  /** The mailbox owner: the question is an ordinary stored message with `answeredBy:'copy'`. */
  mailbox: SessionMessageCommandPort;
  /** Trusted, already-bound call context. Snapshotted per call; never model JSON. */
  context: CoreCallContext;
  /** Trusted command identity: Kernel `ToolCall.callId` + bound Run/operation. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** The tool's model-facing text; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
};

/**
 * The read-only copy question. The adapter only stores the question with the
 * copy marker; it never derives the copy, waits for it or opens a round. The
 * Host consumes the stored question by its message identity.
 */
export function createAskCopyTool(config: AskCopyToolConfig): SessionMailboxToolsHandle {
  const mailboxTextOf = (name: string): ToolTextV1 =>
    config.texts?.[name] ?? PLATFORM_TOOL_TEXTS[name]!;
  const schema = z.object({
    line: sessionRefSchema,
    question: z.string().min(1),
    taskRef: taskTripleSchema.optional(),
  }).strict();
  const execute = createToolExecutor(config.context, config.requestIdForCall);
  return {
    names: [ASK_COPY_TOOL_NAME],
    create: () => [{
      name: ASK_COPY_TOOL_NAME,
      description: mailboxTextOf(ASK_COPY_TOOL_NAME).description,
      inputSchema: schema,
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      defaultTimeoutMs: 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: false,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(call, options.signal, schema, async (args, requestId, context) => {
            const input = args as {
              line: SessionRef; question: string;
              taskRef?: { projectId: string; goalId: string; taskId: string };
            };
            const request = askCopySendRequest(input, requestId);
            const result = await config.mailbox.sendMessage(context, request);
            return mapWrite(call.callId, result);
          });
        },
      },
    }],
  };
}

export type ActionToolsConfig = {
  /** The P1 action-request owner (`platform.actionRequests`); its receipts are returned unchanged. */
  actionRequests: Pick<ActionRequestPort, 'requestDispatch' | 'requestStop'>;
  /** The P1 claim-hold owner (`platform.claimHolds`); its receipts are returned unchanged. */
  claimHolds: Pick<ClaimHoldPort, 'place' | 'release'>;
  /** Trusted, already-bound Query call context. Snapshotted per call; never model JSON. */
  context: CoreCallContext;
  /** Trusted command identity: Kernel `ToolCall.callId` + bound Run/operation. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** The action tools' model-facing texts; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
};

/**
 * The §2.6 action tools. They are adapters: round admission, blockers, the
 * request/hold records and every receipt belong to the P1 owners. The model
 * supplies no actor, duty, goal, request id or permission; the caller, the
 * Goal and every missing dispatch-basis value are filled by the owner.
 */
export function createActionTools(config: ActionToolsConfig): SessionMailboxToolsHandle {
  const mailboxTextOf = (name: string): ToolTextV1 =>
    config.texts?.[name] ?? PLATFORM_TOOL_TEXTS[name]!;
  const descriptions: Readonly<Record<string, string>> = {
    dispatch_task: mailboxTextOf('dispatch_task').description,
    hold_claim: mailboxTextOf('hold_claim').description,
    release_hold: mailboxTextOf('release_hold').description,
    request_stop: mailboxTextOf('request_stop').description,
  };
  const execute = createToolExecutor(config.context, config.requestIdForCall);

  function mailboxDefinitionFor(index: number): ToolDefinition {
    const name = ACTION_TOOL_NAMES[index]!;
    const schema = ACTION_TOOL_SCHEMAS[index]!;
    return {
      name,
      description: descriptions[name]!,
      inputSchema: schema,
      effectClass: 'workspace_write',
      // A platform record write is not a workspace capability; it is authorized
      // through the Host grant's tool list, like every other action adapter.
      requiredCapabilities: [],
      defaultTimeoutMs: 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: false,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(call, options.signal, schema, async (args, requestId, context) => {
            switch (name) {
              case 'dispatch_task': {
                const input = args as Parameters<ActionRequestPort['requestDispatch']
                >[1]['input'];
                const result = await config.actionRequests.requestDispatch(context, {
                  input, meta: { requestId, expected: [] },
                });
                return mapActionReceipt(call.callId, result);
              }
              case 'hold_claim': {
                const input = args as Parameters<ClaimHoldPort['place']>[1]['input'];
                const result = await config.claimHolds.place(context, { input, meta: { requestId, expected: [] } });
                return mapActionReceipt(call.callId, result);
              }
              case 'release_hold': {
                const input = args as Parameters<ClaimHoldPort['release']>[1]['input'];
                const result = await config.claimHolds.release(context, { input, meta: { requestId, expected: [] } });
                return mapActionReceipt(call.callId, result);
              }
              case 'request_stop': {
                const input = args as Parameters<ActionRequestPort['requestStop']>[1]['input'];
                const result = await config.actionRequests.requestStop(context, { input, meta: { requestId, expected: [] } });
                return mapActionReceipt(call.callId, result);
              }
              default:
                return failure(call.callId, 'execution_failed', 'the action tool name is not recognized');
            }
          });
        },
      },
    };
  }

  return {
    names: ACTION_TOOL_NAMES,
    create: () => ACTION_TOOL_NAMES.map((_name, index) => mailboxDefinitionFor(index)),
  };
}
