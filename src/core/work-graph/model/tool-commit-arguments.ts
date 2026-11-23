/**
 * K3 L4: the pure "arguments -> owner request" step shared by the Kernel tool
 * handlers and the owners' read-only `lookupToolCommit`. It contains no I/O and
 * no identity/hash logic of its own beyond the trusted requestId derivation
 * (`execution-driver.ts:requestIdForCall`), so the handler and the lookup hand
 * the owner byte-identical input.
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { DecisionApplicationReceiptV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalJson, sha256Hex } from '../../../contracts/fingerprint.js';
import type { DecisionObjectV1, DecisionOptionV1 } from '../../../contracts/goal-decisions.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../../contracts/plan.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { StoreResult } from '../../record-store/ports.js';
import type { StoreCommitReceipt } from '../../record-store/ports.js';
import type { ToolCommitLookupInput, ToolCommitLookupResult } from '../../../contracts/unknown-call-review.js';
import type { GraphWrite } from './task-contracts.js';
import type { PlanChangeReason } from './plan-contracts.js';
import type { RespondBodyV1, RespondMessageV1 } from './message-payload.js';
import type { SessionMessageSendInputV1 } from './communication-contracts.js';

export type SessionMessageSendInput = {
  recipient: SessionRef;
  text: string;
  needsReply?: boolean;
  waitAfterSend?: boolean;
  /** The sender chooses; the mailbox owner writes `true` when omitted. */
  wake?: boolean;
  taskRef?: TaskTriple;
  followupOf?: SessionMessageRef;
  deadlineMs?: number;
};

export type SessionMessageRespondInput = { messageRef: SessionMessageRef } & RespondBodyV1;

export type SendUserMessageInput = {
  goalRef: GoalRef;
  intent: 'notify' | 'decision_request';
  text: string;
  needsReply: boolean;
  waitAfterSend: boolean;
  /** The sender chooses; the mailbox owner writes `true` when omitted. */
  wake?: boolean;
  /** The Task of the message's Goal, when the sender names one; present-only. */
  taskRef?: TaskTriple;
  options: DecisionOptionV1[];
  objects: DecisionObjectV1[];
  forwardedFrom?: SessionMessageRef;
};

export type RecordDecisionApplicationInput = {
  messageRef: SessionMessageRef;
  receipt: DecisionApplicationReceiptV1;
};

export type ProposePlanToolInput = {
  basedOn: PlanRevisionRef | null;
  draft: PlanRevisionDraft;
  reason: PlanChangeReason;
  expected: VersionPin[];
};

/**
 * K3 L4 / decision 72 (U1): the ONE request id the Kernel execution driver and
 * every owner lookup derive from a resolved call. The fields are picked
 * explicitly — the RunRef's four and the SessionRef's two — so a caller that
 * holds the Session aggregate ref (with `aggregateType`) and the live
 * execution's plain ref hash byte-identically.
 */
export function toolCommitRequestId(input: Pick<ToolCommitLookupInput, 'origin' | 'toolName' | 'kernelCallId'>): string {
  const { runRef, sessionRef } = input.origin;
  return 'c2-tool:' + sha256Hex(canonicalJson({
    runRef: { aggregateType: 'Run', projectId: runRef.projectId, goalId: runRef.goalId, runId: runRef.runId },
    sessionRef: { projectId: sessionRef.projectId, sessionId: sessionRef.sessionId },
    operation: input.toolName,
    callId: input.kernelCallId,
  } as never));
}

/**
 * 一条线的 agent 身份号：做事轮的 `agentActorOf` 和问答轮请求者（动作请求、返工）的 actor 都按线取这一个号，
 * 同一条线在两种轮里是同一个 agent。
 */
export function lineAgentIdOf(sessionRef: SessionRef): string {
  return 'session:' + sha256Hex(canonicalJson({ projectId: sessionRef.projectId, sessionId: sessionRef.sessionId }));
}

/**
 * K3 L4 / decision 72 (U1): the ONE Agent actor id both the plan writer
 * (`plan-write-admission.ts`, from the claim Session) and the plan lookup
 * (`plan-service.ts`, from the rebuilt origin) build. The session id is the
 * formal `'session:' + sha256Hex(canonicalJson({projectId, sessionId}))`; the
 * runRef is carried as its four explicit fields.
 */
export function agentActorOf(sessionRef: SessionRef, runRef: RunRef): Extract<ActorRef, { kind: 'agent' }> {
  return {
    kind: 'agent',
    id: lineAgentIdOf(sessionRef),
    runRef: { aggregateType: 'Run', projectId: runRef.projectId, goalId: runRef.goalId, runId: runRef.runId },
  };
}

/** `send_session_message` arguments -> the exact `mailbox.sendMessage` request. */
export function sendSessionMessageRequest(input: SessionMessageSendInput, requestId: string):
GraphWrite<SessionMessageSendInput> {
  return {
    input: {
      recipient: { ...input.recipient }, text: input.text,
      ...(input.needsReply === undefined ? {} : { needsReply: input.needsReply }),
      ...(input.waitAfterSend === undefined ? {} : { waitAfterSend: input.waitAfterSend }),
      ...(input.wake === undefined ? {} : { wake: input.wake }),
      ...(input.taskRef === undefined ? {} : { taskRef: { ...input.taskRef } }),
      ...(input.followupOf === undefined ? {} : { followupOf: { ...input.followupOf } }),
      ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }),
    },
    meta: { requestId, expected: [] },
  };
}

/** `respond_session_message` arguments -> the exact `mailbox.respondMessage` request. */
export function respondSessionMessageRequest(input: RespondMessageV1, requestId: string):
GraphWrite<SessionMessageRespondInput> {
  const { messageRef, expectedRevision, ...body } = input;
  return {
    input: { messageRef: { ...messageRef }, ...body },
    meta: { requestId, expected: [{ ref: { ...messageRef }, revision: expectedRevision }] },
  };
}

/** `notify_person`/`ask_person` arguments -> the exact `mailbox.sendUserMessage` request. */
export function sendUserMessageRequest(input: SendUserMessageInput, requestId: string):
GraphWrite<SendUserMessageInput> {
  return {
    input: {
      goalRef: { ...input.goalRef }, intent: input.intent, text: input.text,
      needsReply: input.needsReply, waitAfterSend: input.waitAfterSend,
      ...(input.wake === undefined ? {} : { wake: input.wake }),
      ...(input.taskRef === undefined ? {} : { taskRef: { ...input.taskRef } }),
      options: input.options.map((option) => ({ ...option })),
      objects: input.objects.map((object) => structuredClone(object)),
      ...(input.forwardedFrom === undefined ? {} : { forwardedFrom: { ...input.forwardedFrom } }),
    },
    meta: { requestId, expected: [] },
  };
}

/** `notify_person`/`ask_person` arguments: notify carries text only; ask carries the card. */
export type PersonMessageToolArguments = {
  text: string;
  options?: DecisionOptionV1[];
  objects?: DecisionObjectV1[];
  taskRef?: TaskTriple;
};

/**
 * `notify_person`/`ask_person` arguments -> the exact `mailbox.sendUserMessage`
 * request. The tool handlers and the owner's read-only lookup both build it
 * here: notify asks no reply and stays quiet, ask carries the card and wakes.
 */
export function personMessageRequest(
  input: PersonMessageToolArguments & { goalRef: GoalRef; intent: 'notify' | 'decision_request' },
  requestId: string,
): GraphWrite<SendUserMessageInput> {
  const ask = input.intent === 'decision_request';
  return sendUserMessageRequest({
    goalRef: input.goalRef, intent: input.intent, text: input.text,
    needsReply: ask, waitAfterSend: false, wake: ask,
    options: ask ? input.options ?? [] : [], objects: ask ? input.objects ?? [] : [],
    ...(input.taskRef === undefined ? {} : { taskRef: input.taskRef }),
  }, requestId);
}

/**
 * The exact payload `mailbox.sendUserMessage` fingerprints. The write and the
 * read-only lookup share it, so `wake` and a present `taskRef` are part of the
 * identity: the same request id with another wake is a conflict, never a replay.
 */
export type SendUserMessageFingerprintV1 = {
  goalRef: GoalRef;
  intent: 'notify' | 'decision_request';
  text: string;
  needsReply: boolean;
  waitAfterSend: boolean;
  wake: boolean;
  options: DecisionOptionV1[];
  objects: DecisionObjectV1[];
  taskRef?: TaskTriple;
  forwardedFrom?: SessionMessageRef;
};

export function sendUserMessageFingerprintPayload(input: SendUserMessageInput): SendUserMessageFingerprintV1 {
  return {
    goalRef: { ...input.goalRef }, intent: input.intent, text: input.text,
    needsReply: input.needsReply, waitAfterSend: input.waitAfterSend,
    wake: input.wake ?? true,
    options: input.options.map((option) => ({ ...option })),
    objects: input.objects.map((object) => structuredClone(object)),
    ...(input.taskRef === undefined ? {} : { taskRef: { ...input.taskRef } }),
    ...(input.forwardedFrom === undefined ? {} : { forwardedFrom: { ...input.forwardedFrom } }),
  };
}

/** `ask_copy` arguments -> the exact `mailbox.sendMessage` request; the stored question is `answeredBy:'copy'`. */
export function askCopySendRequest(
  input: { line: SessionRef; question: string; taskRef?: TaskTriple },
  requestId: string,
): SessionMessageSendInputV1 {
  const base = sendSessionMessageRequest({
    recipient: input.line, text: input.question, needsReply: true, wake: false,
    ...(input.taskRef === undefined ? {} : { taskRef: input.taskRef }),
  }, requestId);
  return { input: { ...base.input, answeredBy: 'copy' }, meta: base.meta };
}

/** The exact payload `decision-service.applicationIdentity` fingerprints (LB-2: no message pin). */
export function recordDecisionApplicationInput(input: RecordDecisionApplicationInput): RecordDecisionApplicationInput {
  // Decision 72 (U1)(d): pick the messageRef's canonical four fields explicitly,
  // so the live writer's resolved ref and the Kernel-recorded arguments
  // fingerprint byte-identically for the same call.
  return {
    messageRef: {
      aggregateType: 'SessionMessage',
      projectId: input.messageRef.projectId,
      workspaceId: input.messageRef.workspaceId,
      messageId: input.messageRef.messageId,
    },
    receipt: { ...input.receipt },
  };
}

/** `record_decision_application` arguments -> the exact `recordDecisionApplication` request. */
export function recordDecisionApplicationRequest(input: RecordDecisionApplicationInput, requestId: string,
  expected: readonly VersionPin[] = []): GraphWrite<RecordDecisionApplicationInput> {
  return { input: recordDecisionApplicationInput(input), meta: { requestId, expected: [...expected] } };
}

/** `propose_future_plan` arguments -> the exact `plans.proposePlan` request. */
export function proposeFuturePlanRequest(input: ProposePlanToolInput, requestId: string, goalRef: GoalRef):
GraphWrite<{ goalRef: GoalRef; basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft; reason: PlanChangeReason }> {
  return {
    input: { goalRef: { ...goalRef }, basedOn: input.basedOn, draft: input.draft, reason: input.reason },
    meta: { requestId, expected: [...input.expected] },
  };
}

/** The single `RecordStore.lookupCommit` result mapping every owner lookup shares. */
export function toolCommitLookupResult(
  result: StoreResult<Extract<StoreCommitReceipt, { status: 'committed' }>>,
): ToolCommitLookupResult {
  if (result.status === 'ready') {
    return { status: 'committed', cursor: result.value.cursor as CommitCursor, eventIds: [...result.value.eventIds] };
  }
  if (result.code === 'not_found') return { status: 'not_committed' };
  return { status: 'undetermined', reason: result.reason.length === 0 ? result.code : `${result.code}: ${result.reason}` };
}

/** An owner lookup called with a tool name it does not own. */
export function toolCommitLookupUnknownTool(toolName: string): ToolCommitLookupResult {
  return { status: 'undetermined', reason: `unknown_tool: ${toolName}` };
}

/** `withdraw_session_message` arguments -> the exact `mailbox.withdrawMessage` request. */
export function withdrawSessionMessageRequest(input: { messageRef: SessionMessageRef }, requestId: string):
GraphWrite<{ messageRef: SessionMessageRef }> {
  return { input: { messageRef: { ...input.messageRef } }, meta: { requestId, expected: [] } };
}
