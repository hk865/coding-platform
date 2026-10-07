/**
 * C3 continuation brief assembly (docs/refactor/STATE-MACHINES-SPEC.md §6.1
 * contract (e); decisions C1, C3; GAP-49).
 *
 * A Run created by a requeue claim starts with a platform-assembled, bounded,
 * factual brief. AgentRuntime assembles it from durable facts only (never a
 * model call): the WorkGraph continuation basis (`readContinuationBasis`), the
 * previous Run's own Kernel Turn read through the Session history owner and
 * reduced with the shared Kernel Turn reader (`kernel-turn-facts.ts`, so
 * "confirmed result" and "pending counts as not started" mean the same as in
 * the observer), and the workspace source checkpoints. Where the records
 * cannot tell, the brief says so and never claims "no change".
 *
 * `readPreviousTurn` does the IO; `assembleContinuationBrief` is pure.
 */
import type { RunState } from '../../../vendor/coding-agent/dist/public-api.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import {
  CONTINUATION_BRIEF_LIMITS, compareSourceCheckpoints,
  type BoundedTextV1, type ContinuationBriefV1, type ContinuationNewInputV1, type ContinuationSourceCheckpointV1,
  type ContinuationToolCallV1,
} from '../../contracts/continuation-brief.js';
import { reworkActorClassOf, type ReworkFailureClass } from '../../contracts/task-requeue.js';
import type { ContinuationBasis, TaskExecutionRecord } from '../work-graph/tasks/execution-read-contracts.js';
import { roundFailureFacts, runFailureOrigin } from '../work-graph/state/no-progress.js';
import { deriveReworkClass, runErrorOf } from '../work-graph/state/task-failure.js';
import { decodeKernelEntry, reduceTurnFromStart, type DecodedKernelRecord } from './kernel-turn-facts.js';
import type { SessionHistoryCursorOwner } from './session-operations.js';

/** One session message part the Kernel accepted into the Turn (`run.input_accepted`), with the accepted text. */
export type AcceptedMessageInput = { messageRef: SessionMessageRef; part: 'message' | 'response'; text: string };

/** The previous Run's Turn as the Kernel records show it (`stoppedAt`, `toolCalls`, `selfChanged`, `acceptedInputs`). */
export type PreviousTurnFacts =
  | { kernel: 'read'; state: RunState; window: { fromPosition: number; throughPosition: number; omittedRecords: number };
      /** The session message parts the Turn accepted, in Kernel order (a saved reply, inbox mail). */
      acceptedMessages: AcceptedMessageInput[] }
  | { kernel: 'not_entered' }
  | { kernel: 'unavailable'; reason: string };

/** The workspace facts of the brief: its own checkpoint taken at prepare, and the uncommitted paths. */
export type BriefWorkspaceFacts = {
  briefCheckpoint: ContinuationSourceCheckpointV1;
  uncommitted: ContinuationBriefV1['workspace']['uncommitted'];
};

export type AssembleBriefInput = {
  basis: ContinuationBasis;
  /** The Run whose Kernel facts the brief reports: the afterRun, or its nearest entered ancestor. */
  factsRecord: TaskExecutionRecord;
  factsHops: number;
  factsTruncated: boolean;
  turn: PreviousTurnFacts;
  workspace: BriefWorkspaceFacts;
  /** The new Run's claim Session. */
  claimSessionRef: SessionRef;
  /**
   * LA-1, contract (e): the original Session whose completed history the new
   * Session is seeded with (`sessionBasis` of the same prepare), through which
   * position; absent or null when nothing is seeded.
   */
  seededFrom?: { sessionRef: SessionRef; throughPosition: number } | null;
};

const PAGE_LIMIT = 200;
/**
 * The accepted steers and messages the brief lists one by one; the rest are
 * counted in `steersOmitted` / `messagesOmitted`. The contract names no count
 * for them, so they share the new-input bound.
 */
const ACCEPTED_INPUTS_LISTED = CONTINUATION_BRIEF_LIMITS.newInputs;

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A complete SessionMessage ref as the mailbox input supply writes it into `sourceRef`, or null. */
function messageRefOf(value: unknown): SessionMessageRef | null {
  if (!isRecordValue(value) || value['aggregateType'] !== 'SessionMessage') return null;
  const { projectId, workspaceId, messageId } = value;
  if (typeof projectId !== 'string' || typeof workspaceId !== 'string' || typeof messageId !== 'string'
    || projectId.length === 0 || workspaceId.length === 0 || messageId.length === 0) return null;
  return { aggregateType: 'SessionMessage', projectId, workspaceId, messageId };
}

/**
 * The session message parts the fixed Turn accepted: its own `run.input_accepted`
 * events whose source is a SessionMessage part (`execution-inputs.ts`). A
 * steer or another source is not a message; the steers come from the Run's
 * control intents.
 */
export function acceptedMessagesOf(records: readonly DecodedKernelRecord[], kernel: { runId: string; turnId: string }): AcceptedMessageInput[] {
  const accepted: AcceptedMessageInput[] = [];
  for (const item of records) {
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.type !== 'run.input_accepted' || event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    const source = event.payload.input.sourceRef;
    if (!isRecordValue(source) || source['kind'] !== 'SessionMessage') continue;
    const messageRef = messageRefOf(source['messageRef']);
    const part = source['part'];
    if (messageRef === null || (part !== 'message' && part !== 'response')) continue;
    accepted.push({ messageRef, part, text: event.payload.input.text });
  }
  return accepted;
}

/**
 * A read that may succeed later (W-25, SD-2): a cancelled read or an
 * unavailable Kernel store (busy, not registered by this Host) is not a fact
 * about the Turn, so the caller does not pin a degraded brief and retries.
 */
export type PreviousTurnRetry = { kernel: 'retry'; code: 'cancelled' | 'unavailable'; reason: string };

/**
 * Reads the Kernel records of one Run's Turn (its execution-history locator,
 * at most `CONTINUATION_BRIEF_LIMITS.kernelRecords`) through the Session's own
 * Kernel mapping and reduces them from `turn.started`. A Run that never
 * entered has no Turn; a missing, damaged or non-contiguous history is the
 * `unavailable` fact; a cancelled read or an unavailable store is `retry`.
 */
export async function readPreviousTurn(
  owner: SessionHistoryCursorOwner, record: TaskExecutionRecord, signal: AbortSignal,
): Promise<PreviousTurnFacts | PreviousTurnRetry> {
  const locator = record.run.executionHistory;
  if (locator === undefined) return { kernel: 'not_entered' };
  if (locator.kernel.adapterId !== record.session.kernel.adapterId
    || locator.kernel.kernelSessionId !== record.session.kernel.kernelSessionId) {
    return { kernel: 'unavailable', reason: 'the Run history locator disagrees with its claim Session mapping' };
  }
  const fromPosition = Math.max(0, locator.startPosition - 1);
  const through = locator.endPosition ?? locator.observedThroughPosition;
  const decoded: DecodedKernelRecord[] = [];
  let cursor = fromPosition;
  let expected = fromPosition + 1;
  while (cursor < through && decoded.length < CONTINUATION_BRIEF_LIMITS.kernelRecords) {
    let window;
    try {
      window = await owner.readPositionWindow({ session: record.session, afterPosition: cursor, throughPosition: through,
        limit: Math.min(PAGE_LIMIT, CONTINUATION_BRIEF_LIMITS.kernelRecords - decoded.length), signal });
    } catch (error) {
      return { kernel: 'retry', code: 'unavailable',
        reason: `the Turn history read failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (window.status !== 'ready') {
      const reason = window.status === 'rejected' ? window.reason : `the Turn history is ${window.status}`;
      if (window.status === 'rejected' && (window.code === 'cancelled' || window.code === 'unavailable')) {
        return { kernel: 'retry', code: window.code, reason };
      }
      return { kernel: 'unavailable', reason };
    }
    for (const entry of window.value.entries) {
      const item = decodeKernelEntry(entry);
      if (item === null || item.position !== expected) return { kernel: 'unavailable', reason: 'the Turn history is damaged or not contiguous' };
      expected += 1;
      decoded.push(item);
    }
    cursor = window.value.nextPosition;
    if (!window.value.hasMore) break;
  }
  const state = reduceTurnFromStart(decoded, locator.kernel);
  if (state === null) return { kernel: 'unavailable', reason: 'the Turn start record is not in the history window' };
  const last = decoded.at(-1)?.position ?? fromPosition;
  return { kernel: 'read', state, window: { fromPosition: fromPosition + 1, throughPosition: Math.max(fromPosition + 1, last),
    omittedRecords: Math.max(0, through - last) }, acceptedMessages: acceptedMessagesOf(decoded, locator.kernel) };
}

function bounded(text: string): BoundedTextV1 {
  const cap = CONTINUATION_BRIEF_LIMITS.textChars;
  return text.length > cap ? { text: text.slice(0, cap), truncated: true } : { text, truncated: false };
}

/** A body the basis reader already bounded: cut there, it stays marked cut (contract (e) "…Omitted / truncated"). */
function boundedBody(entry: { body: string | null; truncated: boolean } | undefined): BoundedTextV1 | null {
  if (entry === undefined || entry.body === null) return null;
  const text = bounded(entry.body);
  return entry.truncated ? { text: text.text, truncated: true } : text;
}

/** A tool call's target: its path, file or command argument, when it has one. */
function targetOf(args: Record<string, unknown>): BoundedTextV1 | null {
  for (const key of ['path', 'file', 'filePath', 'command']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return bounded(value);
  }
  return null;
}

type ToolFacts = { calls: ContinuationBriefV1['toolCalls']; confirmedPaths: string[]; possiblePaths: string[]; unknownCount: number };

/**
 * The Turn's tool calls in three groups (C3): a call with a recorded result is
 * confirmed (an `outcome_unknown` error is unknown); a batch call still
 * `pending` or `abandoned` never ran; `running`/`outcome_unknown` is unknown.
 */
function toolFactsOf(state: RunState): ToolFacts {
  const requested = new Map<string, { name: string; args: Record<string, unknown> }>();
  for (const entry of state.transcript) {
    if (entry.kind !== 'assistant_message') continue;
    for (const call of entry.toolCalls) requested.set(call.callId, { name: call.name, args: call.arguments as Record<string, unknown> });
  }
  const confirmed: ContinuationToolCallV1[] = [];
  const unknown: ContinuationToolCallV1[] = [];
  const notExecuted: ContinuationToolCallV1[] = [];
  const confirmedPaths: string[] = [];
  const possiblePaths: string[] = [];
  const seen = new Set<string>();
  const callOf = (callId: string, result: ContinuationToolCallV1['result'], sideEffect: ContinuationToolCallV1['sideEffect'],
    paths: readonly string[], error: string | null): ContinuationToolCallV1 => {
    const call = requested.get(callId);
    return { callId, name: call?.name ?? 'unknown', target: call === undefined ? null : targetOf(call.args), result, sideEffect,
      changedPaths: paths.slice(0, CONTINUATION_BRIEF_LIMITS.pathsPerCall),
      changedPathsOmitted: Math.max(0, paths.length - CONTINUATION_BRIEF_LIMITS.pathsPerCall),
      error: error === null ? null : bounded(error) };
  };
  for (const entry of state.transcript) {
    if (entry.kind !== 'tool_result') continue;
    seen.add(entry.callId);
    const result = entry.result;
    switch (result.status) {
      case 'success':
      case 'cancelled': {
        const paths = [...result.effects.changedPaths];
        (result.effects.sideEffect === 'confirmed' ? confirmedPaths : result.effects.sideEffect === 'possible' ? possiblePaths : [])
          .push(...paths);
        confirmed.push(callOf(entry.callId, result.status, result.effects.sideEffect, paths, null));
        break;
      }
      case 'error': {
        const paths = [...result.effects.changedPaths];
        if (result.error.code === 'outcome_unknown') {
          possiblePaths.push(...paths);
          unknown.push(callOf(entry.callId, 'outcome_unknown', result.effects.sideEffect, paths, result.error.message));
        } else {
          (result.effects.sideEffect === 'confirmed' ? confirmedPaths : result.effects.sideEffect === 'possible' ? possiblePaths : [])
            .push(...paths);
          confirmed.push(callOf(entry.callId, 'error', result.effects.sideEffect, paths, result.error.message));
        }
        break;
      }
      default: break;
    }
  }
  for (const call of state.toolBatch?.calls ?? []) {
    const callId = call.requestedCall.callId;
    if (seen.has(callId)) continue;
    if (!requested.has(callId)) requested.set(callId, { name: call.requestedCall.name, args: call.requestedCall.arguments as Record<string, unknown> });
    if (call.status === 'pending' || call.status === 'abandoned') notExecuted.push(callOf(callId, 'not_started', null, [], null));
    else if (call.status === 'running' || call.status === 'outcome_unknown') unknown.push(callOf(callId, 'outcome_unknown', 'possible', [], null));
  }
  const cut = (list: ContinuationToolCallV1[], cap: number) => ({ listed: list.slice(0, cap), omitted: Math.max(0, list.length - cap) });
  const c = cut(confirmed, CONTINUATION_BRIEF_LIMITS.confirmedToolCalls);
  const n = cut(notExecuted, CONTINUATION_BRIEF_LIMITS.notExecutedToolCalls);
  const u = cut(unknown, CONTINUATION_BRIEF_LIMITS.unknownToolCalls);
  return { calls: { confirmed: c.listed, notExecuted: n.listed, unknown: u.listed, confirmedOmitted: c.omitted,
    notExecutedOmitted: n.omitted, unknownOmitted: u.omitted },
    confirmedPaths: [...new Set(confirmedPaths)], possiblePaths: [...new Set(possiblePaths)], unknownCount: unknown.length };
}

const TURN_STATUSES = ['completed', 'failed', 'cancelled', 'limit_exceeded', 'yielded', 'paused', 'running'] as const;

function stoppedAtOf(turn: PreviousTurnFacts, reason: string | null): ContinuationBriefV1['stoppedAt'] {
  if (turn.kernel !== 'read') {
    return { kernel: turn.kernel, reason: turn.kernel === 'unavailable' ? turn.reason : reason, turnStatus: null, lastPosition: null,
      lastToolGroup: null, lastAssistant: null, window: null };
  }
  const state = turn.state;
  const status = (TURN_STATUSES as readonly string[]).includes(state.status) ? state.status as typeof TURN_STATUSES[number] : 'running';
  let lastAssistant: BoundedTextV1 | null = null;
  let lastToolGroup: ContinuationBriefV1['stoppedAt']['lastToolGroup'] = null;
  for (const entry of state.transcript) {
    if (entry.kind !== 'assistant_message') continue;
    if (entry.message.content.length > 0) lastAssistant = bounded(entry.message.content);
    if (entry.toolCalls.length > 0) lastToolGroup = { sourceMessageId: entry.message.messageId, calls: entry.toolCalls.length };
  }
  if (state.toolBatch !== null) lastToolGroup = { sourceMessageId: state.toolBatch.sourceMessageId, calls: state.toolBatch.calls.length };
  return { kernel: 'read', reason, turnStatus: status, lastPosition: turn.window.throughPosition, lastToolGroup, lastAssistant,
    window: turn.window };
}

/** The Kernel `run.failed` text of a reduced Turn (the third source of `runErrorOf`). */
function kernelFailedText(turn: PreviousTurnFacts): string | null {
  if (turn.kernel !== 'read') return null;
  const outcome = turn.state.outcome;
  return outcome !== null && outcome.kind === 'failed' ? `${outcome.failure.code}: ${outcome.failure.message}` : null;
}

/** The synthesized terminal reason RUN-23 leaves in the payload (rendered differently from an observed cancel). */
function stopReasonOf(record: TaskExecutionRecord): string | null {
  const payload = record.run.terminalPayload;
  return payload !== undefined && payload.kind === 'cancelled' ? payload.reason : null;
}

/**
 * The brief (spec §6.1 contract (e)) from the basis and the facts read beside
 * it. Pure; every list and text is bounded by `CONTINUATION_BRIEF_LIMITS`.
 */
export function assembleContinuationBrief(input: AssembleBriefInput): ContinuationBriefV1 {
  const { basis, turn } = input;
  const requeue = basis.requeue;
  const previous = basis.previous;
  const head = basis.round;
  // Contract (e) `factsFrom`: an afterRun that never entered the Kernel has no round of its own; the failed checks
  // listed are the facts Run's, the round its own TaskRequeue covered (§15.2 C3-not-entered-chain "来自更早的 Run").
  const factsHop = head === null ? basis.factsChain.at(-1) ?? null : null;
  const checksRound = head ?? factsHop?.round ?? null;
  // TD-8: the class is re-derived from the facts the requeue covered (the stored one is the audit copy).
  const derivation = deriveReworkClass(previous.run, basis.previousIntents.pointer,
    head === null ? { kind: 'none' } : { kind: 'head', head, chain: [head] });
  const failureClass: ReworkFailureClass = derivation.kind === 'class' ? derivation.failureClass : requeue.failureClass;
  const actorClass = reworkActorClassOf(null, requeue.requestedBy) ?? 'human';
  // The reader returns them in Run-chain order (oldest first), as `TaskRow.rework.entries`.
  const ordered = basis.allRequeues;
  const position = ordered.findIndex((candidate) => candidate.ref.afterRunId === requeue.ref.afterRunId);
  const earlier = (position < 0 ? ordered : ordered.slice(0, position)).filter((candidate) => candidate.ref.afterRunId !== requeue.ref.afterRunId);
  const outcome = requeue.afterOutcome;
  const observation = previous.run.reconciliation?.observation;
  const error = runErrorOf(previous.run, kernelFailedText(turn));
  const limitOutcome = turn.kernel === 'read' && turn.state.outcome !== null && turn.state.outcome.kind === 'limit_exceeded'
    ? turn.state.outcome : null;
  const sameSession = input.claimSessionRef.sessionId === previous.outbox.claim.sessionRef.sessionId;
  const previousEnd = previous.run.executionHistory?.endPosition ?? null;
  // A seeded claim Session (it has no completed history of its own) continues the ORIGINAL Session's history,
  // also when it is the never-entered afterRun's Session (A8-3r).
  const seededFrom = input.seededFrom ?? null;
  const continuity: ContinuationBriefV1['session']['continuity'] = seededFrom !== null ? 'other_session_seeded'
    : sameSession ? previousEnd !== null ? 'same_session_history' : 'same_session_without_previous_turn'
      : 'other_session';
  const tools = turn.kernel === 'read' ? toolFactsOf(turn.state) : null;
  const steersApplied = basis.previousIntents.steers.filter((steer) => steer.kind === 'steer' && steer.status === 'applied');
  const steersOpen = basis.previousIntents.steers.filter((steer) => steer.kind === 'steer' && steer.status !== 'applied');
  // Contract (e): the accepted steers and messages are listed unless the new Run's history already holds them.
  const acceptedSteers = continuity === 'same_session_history' ? [] : steersApplied;
  const acceptedMessages = continuity === 'same_session_history' || turn.kernel !== 'read' ? [] : turn.acceptedMessages;
  const newInputs: ContinuationNewInputV1[] = requeue.newInputRefs.slice(0, CONTINUATION_BRIEF_LIMITS.newInputs).map((ref) => {
    if (ref.kind === 'artifact') {
      return { kind: 'artifact', ref: ref.ref,
        body: boundedBody(basis.newInputBodies.find((entry) => entry.ref.digest === ref.ref.digest)) };
    }
    return { kind: 'session_message', ref: ref.ref,
      replyBody: boundedBody(basis.replyBodies.find((entry) => entry.messageRef.messageId === ref.ref.messageId)) };
  });
  const checkpoints: ContinuationSourceCheckpointV1[] = [];
  if (checksRound !== null) {
    // LA-10: the workspace timeline starts at the round the listed checks come from (the facts Run's when the afterRun
    // never entered). The round record keeps no instant; its capture is after the end of the Run it checked.
    const checkedRun = factsHop === null ? previous.run : factsHop.run.run;
    checkpoints.push({ kind: 'round_open', at: checkedRun.endedAt ?? requeue.requestedAt,
      workspaceRevision: checksRound.identity.workspaceRevision, sourceDigest: checksRound.identity.sourceDigest,
      unavailableReason: null });
  }
  checkpoints.push({ kind: 'requeue', at: requeue.requestedAt, workspaceRevision: requeue.basis.source.workspaceRevision,
    sourceDigest: requeue.basis.source.sourceDigest, unavailableReason: null });
  checkpoints.push(input.workspace.briefCheckpoint);
  const segments = checkpoints.slice(1).map((checkpoint, index) => {
    const compared = compareSourceCheckpoints(checkpoints[index] ?? null, checkpoint);
    return { from: index, to: index + 1, verdict: compared.verdict, reason: compared.reason };
  });
  const selfChanged: ContinuationBriefV1['workspace']['selfChanged'] = turn.kernel === 'not_entered'
    ? { status: 'not_entered', confirmed: [], possible: [], omitted: 0 }
    : turn.kernel === 'unavailable' || tools === null
      ? { status: 'unavailable', confirmed: [], possible: [], omitted: 0 }
      : (() => {
        const confirmed = tools.confirmedPaths.slice(0, CONTINUATION_BRIEF_LIMITS.paths);
        const possible = tools.possiblePaths.filter((path) => !confirmed.includes(path))
          .slice(0, CONTINUATION_BRIEF_LIMITS.paths - confirmed.length);
        const omitted = tools.confirmedPaths.length + tools.possiblePaths.length - confirmed.length - possible.length;
        return { status: tools.unknownCount > 0 || turn.window.omittedRecords > 0 ? 'partial' as const : 'known' as const,
          confirmed, possible, omitted: Math.max(0, omitted) };
      })();
  return {
    schemaVersion: 1,
    runRef: { ...basis.run.ref },
    task: { ...requeue.task },
    requeueRef: { ...requeue.ref },
    mode: failureClass === 'interrupted' ? 'resume_after_interruption' : 'rework',
    failureClass,
    trigger: {
      actorClass,
      goalResume: requeue.trigger !== undefined,
      requeueNumber: position < 0 ? ordered.length + 1 : position + 1,
      autoRework: requeue.automation.automatic && requeue.automation.cap !== null
        ? { count: requeue.automation.autoCount, cap: requeue.automation.cap } : null,
      earlierRequeues: earlier.slice(-CONTINUATION_BRIEF_LIMITS.earlierRequeues)
        .map((candidate) => ({ afterRunId: candidate.ref.afterRunId, failureClass: candidate.failureClass })),
    },
    previous: {
      runRef: { ...previous.run.ref },
      attemptRef: { ...previous.attempt.ref },
      sessionRef: { projectId: previous.outbox.claim.sessionRef.projectId, sessionId: previous.outbox.claim.sessionRef.sessionId },
      outcome,
      origin: runFailureOrigin(previous.run),
      interruption: failureClass === 'interrupted' && observation !== undefined && observation.kind === 'interrupted_clean'
        ? { kind: requeue.interruption ?? 'executing', kernelPaused: observation.kernelPaused,
          pausedBy: requeue.interruption === 'paused' ? requeue.stopRequester : null }
        : null,
      cancelledBy: failureClass === 'cancelled' && requeue.stopRequester !== 'none' ? requeue.stopRequester : null,
      error: error.error === null ? null : bounded(error.error),
      limit: limitOutcome === null ? null : { kind: limitOutcome.limit, observed: limitOutcome.observed, allowed: limitOutcome.allowed },
      budget: outcome === 'budget_exhausted'
        ? { previousTokenBudget: previous.run.budget.tokenBudget, currentTokenBudget: basis.run.budget.tokenBudget } : null,
      wait: basis.previousWait === null ? null : { messageRef: { ...basis.previousWait.ref }, status: basis.previousWait.status },
      unacceptedSteers: steersOpen.map((steer) => ({ intentRef: { ...steer.ref }, text: bounded(steer.reason ?? '') })),
      endedAt: previous.run.endedAt,
    },
    factsFrom: { runRef: { ...input.factsRecord.run.ref }, hops: input.factsHops, truncated: input.factsTruncated },
    stoppedAt: stoppedAtOf(turn, stopReasonOf(input.factsRecord)),
    toolCalls: tools === null
      ? { confirmed: [], notExecuted: [], unknown: [], confirmedOmitted: 0, notExecutedOmitted: 0, unknownOmitted: 0 }
      : tools.calls,
    acceptedInputs: {
      steers: acceptedSteers.slice(0, ACCEPTED_INPUTS_LISTED)
        .map((steer) => ({ intentRef: { ...steer.ref }, text: bounded(steer.reason ?? '') })),
      steersOmitted: Math.max(0, acceptedSteers.length - ACCEPTED_INPUTS_LISTED),
      messages: acceptedMessages.slice(0, ACCEPTED_INPUTS_LISTED)
        .map((message) => ({ messageRef: { ...message.messageRef }, part: message.part, excerpt: bounded(message.text) })),
      messagesOmitted: Math.max(0, acceptedMessages.length - ACCEPTED_INPUTS_LISTED),
    },
    checks: checksRound === null ? null : { roundRef: { ...checksRound.ref }, roundOrdinal: checksRound.chain?.ordinal ?? 1,
      failing: roundFailureFacts(checksRound).checks, gapCodes: roundFailureFacts(checksRound).gapCodes },
    requeue: { reason: bounded(requeue.reason), reasonAuthor: actorClass, newInputs },
    workspace: {
      selfChanged,
      checkpoints,
      segments,
      unobserved: { from: 'previous_run_end', to: checkpoints.length > 0 ? 0 : null, previousEndedAt: previous.run.endedAt },
      uncommitted: input.workspace.uncommitted,
    },
    session: {
      continuity,
      sessionRef: { projectId: input.claimSessionRef.projectId, sessionId: input.claimSessionRef.sessionId },
      seededFrom: seededFrom === null ? null : { sessionRef: { projectId: seededFrom.sessionRef.projectId,
        sessionId: seededFrom.sessionRef.sessionId }, throughPosition: seededFrom.throughPosition },
      boundaryPosition: continuity === 'same_session_history' ? previousEnd : null,
    },
    standingInstructionVersion: 1,
  };
}
