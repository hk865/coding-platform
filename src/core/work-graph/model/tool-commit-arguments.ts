/**
 * K3 L4: the pure "arguments -> owner request" step shared by the Kernel tool
 * handlers and the owners' read-only `lookupToolCommit`. It contains no I/O and
 * no identity/hash logic of its own beyond the trusted requestId derivation
 * (`execution-driver.ts:requestIdForCall`), so the handler and the lookup hand
 * the owner byte-identical input.
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { DecisionApplicationReceiptV1, SessionMessageIntentV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalJson, sha256Hex } from '../../../contracts/fingerprint.js';
import type { DecisionObjectV1, DecisionOptionV1 } from '../../../contracts/goal-decisions.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../../contracts/plan.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { StoreResult } from '../../record-store/ports.js';
import type { StoreCommitReceipt } from '../../record-store/ports.js';
import type { ToolCommitLookupInput, ToolCommitLookupResult } from '../../../contracts/unknown-call-review.js';
import type { GraphWrite } from './task-contracts.js';
import type { PlanChangeReason } from './plan-contracts.js';

export type SessionMessageSendInput = {
  recipient: SessionRef;
  text: string;
  intent?: SessionMessageIntentV1;
  needsReply?: boolean;
  waitAfterSend?: boolean;
  replyMode?: 'wait';
};

export type SessionMessageAckInput = { messageRef: SessionMessageRef };
export type SessionMessageRespondInput = { messageRef: SessionMessageRef; text: string };

export type SendUserMessageInput = {
  goalRef: GoalRef;
  intent: 'notify' | 'decision_request';
  text: string;
  needsReply: boolean;
  waitAfterSend: boolean;
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
 * K3 L4 / decision 72 (U1): the ONE Agent actor id both the plan writer
 * (`plan-write-admission.ts`, from the claim Session) and the plan lookup
 * (`plan-service.ts`, from the rebuilt origin) build. The session id is the
 * formal `'session:' + sha256Hex(canonicalJson({projectId, sessionId}))`; the
 * runRef is carried as its four explicit fields.
 */
export function agentActorOf(sessionRef: SessionRef, runRef: RunRef): Extract<ActorRef, { kind: 'agent' }> {
  return {
    kind: 'agent',
    id: 'session:' + sha256Hex(canonicalJson({ projectId: sessionRef.projectId, sessionId: sessionRef.sessionId })),
    runRef: { aggregateType: 'Run', projectId: runRef.projectId, goalId: runRef.goalId, runId: runRef.runId },
  };
}

/** `send_session_message` arguments -> the exact `mailbox.sendMessage` request. */
export function sendSessionMessageRequest(input: SessionMessageSendInput, requestId: string):
GraphWrite<SessionMessageSendInput> {
  return {
    input: {
      recipient: { ...input.recipient }, text: input.text,
      ...(input.intent === undefined ? {} : { intent: input.intent }),
      ...(input.needsReply === undefined ? {} : { needsReply: input.needsReply }),
      ...(input.waitAfterSend === undefined ? {} : { waitAfterSend: input.waitAfterSend }),
      ...(input.replyMode === undefined ? {} : { replyMode: input.replyMode }),
    },
    meta: { requestId, expected: [] },
  };
}

/** `ack_session_message` arguments -> the exact `mailbox.ackMessage` request. */
export function ackSessionMessageRequest(input: { messageRef: SessionMessageRef; expectedRevision: number }, requestId: string):
GraphWrite<SessionMessageAckInput> {
  return {
    input: { messageRef: { ...input.messageRef } },
    meta: { requestId, expected: [{ ref: { ...input.messageRef }, revision: input.expectedRevision }] },
  };
}

/** `respond_session_message` arguments -> the exact `mailbox.respondMessage` request. */
export function respondSessionMessageRequest(
  input: { messageRef: SessionMessageRef; expectedRevision: number; text: string }, requestId: string,
): GraphWrite<SessionMessageRespondInput> {
  return {
    input: { messageRef: { ...input.messageRef }, text: input.text },
    meta: { requestId, expected: [{ ref: { ...input.messageRef }, revision: input.expectedRevision }] },
  };
}

/** `send_user_message` arguments -> the exact `mailbox.sendUserMessage` request. */
export function sendUserMessageRequest(input: SendUserMessageInput, requestId: string):
GraphWrite<SendUserMessageInput> {
  return {
    input: {
      goalRef: { ...input.goalRef }, intent: input.intent, text: input.text,
      needsReply: input.needsReply, waitAfterSend: input.waitAfterSend,
      options: input.options.map((option) => ({ ...option })),
      objects: input.objects.map((object) => structuredClone(object)),
      ...(input.forwardedFrom === undefined ? {} : { forwardedFrom: { ...input.forwardedFrom } }),
    },
    meta: { requestId, expected: [] },
  };
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

/** Q2: a row-4 name whose owner published no lookup. */
export function toolCommitLookupNotPublished(): ToolCommitLookupResult {
  return { status: 'undetermined', reason: 'lookup_not_published' };
}

/** An owner lookup called with a tool name it does not own. */
export function toolCommitLookupUnknownTool(toolName: string): ToolCommitLookupResult {
  return { status: 'undetermined', reason: `unknown_tool: ${toolName}` };
}
