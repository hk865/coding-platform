/**
 * K3 L28 / §3.4 UR7b: the ONE internal reader over
 * `k3-decision-answer-by-source-goal`.
 *
 * It is parameterized by the source kind (`unknown_call_review`,
 * `command_rerun_request` or `message_release`), pages the index to its end (2A
 * L6/L10) and keeps only a synthetic, responded answer whose formal ② commit
 * exists under the answer-derived identity. A read failure is `unavailable`,
 * never an empty list.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type {
  DecisionSelectionV1, DecisionSourceV1,
} from '../../../contracts/goal-decisions.js';
import { rejected as reject } from '../../../contracts/core/rejections.js';
import { isRecord } from '../../../contracts/validation/common.js';
import { canonicalJson, sha256Hex } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { UnknownCallReviewRef } from '../../../contracts/unknown-call-review.js';
import type { CommandRerunRequestRef } from '../../../contracts/command-rerun-request.js';
import {
  commandRerunRequestAnswerIdentity, commandRerunRequestRefOfSource,
} from './command-rerun-request-codecs.js';
import type { EncodedRecord } from '../../record-store/ports.js';
import type { S5RecordPort } from '../model/decision-contracts.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { commandKeys } from '../persistence/command-executor.js';
import { lookupAll, type LookupBatch } from '../persistence/lookup-all.js';
import { messageReleaseAnswerCommand, messageReleaseAnswerFacts } from './message-release-answer.js';
import {
  decodeSessionMessageRecord,
  K3_DECISION_ANSWER_BY_SOURCE_GOAL_LOOKUP,
} from '../sessions/message-record-codecs.js';

/** The exported prefix of the review disposition identity (L19: derived from the answer message). */
export const UCR_DISPOSITION_IDENTITY_PREFIX = 'ucr-disposition:';

export type UnknownCallAnswerPhaseV1 = 'disposition' | 'approval';

export type UnknownCallAnswerHitV1 = {
  kind: 'unknown_call_review';
  answerMessageRef: SessionMessageRef;
  phase: UnknownCallAnswerPhaseV1;
  source: DecisionSourceV1;
  reviewRef: UnknownCallReviewRef;
};

/** K3 L19a: one answered, unapplied `command_rerun_request` card. */
export type CommandRerunAnswerHitV1 = {
  kind: 'command_rerun_request';
  answerMessageRef: SessionMessageRef;
  source: DecisionSourceV1;
  requestRef: CommandRerunRequestRef;
};

/** G.4's first hook shape: one answered, unapplied `message_release` card. */
export type MessageReleaseAnswerHitV1 = {
  kind: 'message_release';
  answerMessageRef: SessionMessageRef;
  source: DecisionSourceV1;
  messageRef: SessionMessageRef;
};
export type RedriveAnswerHitV1 = UnknownCallAnswerHitV1 | CommandRerunAnswerHitV1 | MessageReleaseAnswerHitV1;

export type UnappliedAnswersReadV1 = {
  answers: RedriveAnswerHitV1[];
  readThrough: CommitCursor | null;
};

/** L19: the phase follows the selected option, never the record's status. */
export function unknownCallAnswerPhase(selection: DecisionSelectionV1): UnknownCallAnswerPhaseV1 {
  if (selection.kind === 'option' && (selection.optionId === 'approve' || selection.optionId === 'decline')) {
    return 'approval';
  }
  return 'disposition';
}

/** The review ref four fields, in the canonical order every UCR key uses. */
function reviewRefFour(ref: UnknownCallReviewRef): Record<string, string> {
  return { aggregateType: ref.aggregateType, projectId: ref.projectId, goalId: ref.goalId, runId: ref.runId };
}

/**
 * L19: the ONE answer-derived request identity and fingerprint of a review
 * disposition. It does not contain the caller's request id or operator, so a
 * retry and UR7 use the same identity and the store replays the original receipt.
 */
export function unknownCallReviewDispositionIdentity(
  source: DecisionSourceV1,
  selection: DecisionSelectionV1,
  answerMessageRef: SessionMessageRef,
): { identityKey: string; fingerprint: string; phase: UnknownCallAnswerPhaseV1 } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.key);
  } catch {
    parsed = null;
  }
  const reviewRef = isRecord(parsed) && isRecord(parsed['reviewRef'])
    ? parsed['reviewRef'] as unknown as UnknownCallReviewRef : null;
  if (reviewRef === null) {
    return { identityKey: '', fingerprint: '', phase: unknownCallAnswerPhase(selection) };
  }
  const phase = unknownCallAnswerPhase(selection);
  const identityKey = UCR_DISPOSITION_IDENTITY_PREFIX + sha256Hex(canonicalJson({
    reviewRef: reviewRefFour(reviewRef), answerMessageRef, phase,
  } as never));
  const optionId = selection.kind === 'option' ? selection.optionId : null;
  const fingerprint = sha256Hex(canonicalJson({ sourceKey: source.key, optionId, answerMessageRef } as never));
  return { identityKey, fingerprint, phase };
}

function userDecisionOf(message: SessionMessage): { source: DecisionSourceV1; selection: DecisionSelectionV1 } | null {
  const response: unknown = message.response;
  if (!isRecord(response)) return null;
  const decision = response['decision'];
  if (!isRecord(decision) || !isRecord(decision['source']) || !isRecord(decision['selection'])) return null;
  const source = decision['source'] as unknown as DecisionSourceV1;
  if (typeof source.key !== 'string' || typeof source.kind !== 'string') return null;
  return { source, selection: decision['selection'] as unknown as DecisionSelectionV1 };
}

function answerSource(message: SessionMessage): DecisionSourceV1 | null {
  return userDecisionOf(message)?.source ?? null;
}

function answerSelection(message: SessionMessage): DecisionSelectionV1 | null {
  return userDecisionOf(message)?.selection ?? null;
}

/** Parse the record ref out of an answer's captured source key; null when it is not a UCR source. */
function reviewRefOfSource(source: DecisionSourceV1): UnknownCallReviewRef | null {
  if (source.kind !== 'unknown_call_review') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.key);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['kind'] !== 'unknown_call_review' || !isRecord(parsed['reviewRef'])) return null;
  const ref = parsed['reviewRef'];
  if (ref['aggregateType'] !== 'UnknownCallReview' || typeof ref['projectId'] !== 'string'
    || typeof ref['goalId'] !== 'string' || typeof ref['runId'] !== 'string') return null;
  return ref as unknown as UnknownCallReviewRef;
}

/**
 * The ② commit of one answer-derived identity: `null` = not committed yet (the
 * answer is still unapplied), a rejection = the receipt is not readable.
 */
async function receiptExists(
  deps: { records: Pick<S5RecordPort, 'lookup' | 'lookupCommit'> },
  identity: { identityKey: string; fingerprint: string },
): Promise<null | CoreRejection | { status: 'committed' }> {
  let lookup: Awaited<ReturnType<S5RecordPort['lookupCommit']>>;
  try {
    lookup = await deps.records.lookupCommit(identity);
  } catch {
    return reject('unavailable', 'the disposition receipt could not be looked up');
  }
  if (lookup.status === 'rejected' && lookup.code === 'not_found') return null;
  if (lookup.status !== 'ready') {
    return lookup.status === 'rejected'
      ? reject(lookup.code === 'invalid' ? 'invalid' : 'unavailable', lookup.reason)
      : reject('unavailable', 'the disposition receipt is not readable');
  }
  return { status: 'committed' };
}

/**
 * The internal reader for the three kinds (`unknown_call_review`,
 * `command_rerun_request`, `message_release`): (project, workspace, kind, goal)
 * over the new index to the end, keeping the answers whose ② commit exists
 * (L28, D4).
 */
export async function readUnappliedAnswers(
  deps: { records: Pick<S5RecordPort, 'lookup' | 'lookupCommit'> },
  ctx: CoreCallContext,
  input: { kind: DecisionSourceV1['kind']; goalRef: GoalRef; reviewRef?: UnknownCallReviewRef },
): Promise<ReadResult<UnappliedAnswersReadV1>> {
  if (typeof ctx.projectId !== 'string' || typeof ctx.workspaceId !== 'string') {
    return reject('forbidden', 'the answer reader requires a trusted bound project/workspace scope');
  }
  const values = [ctx.projectId, ctx.workspaceId, input.kind, input.goalRef.goalId];
  let page: LookupBatch<EncodedRecord>;
  try {
    page = await lookupAll(deps.records, K3_DECISION_ANSWER_BY_SOURCE_GOAL_LOOKUP, values);
  } catch (error) {
    if (isRecord(error) && error['status'] === 'rejected') return error as unknown as CoreRejection;
    return reject('unavailable', error instanceof Error ? error.message : 'the answer index could not be read');
  }
  const answers: RedriveAnswerHitV1[] = [];
  for (const record of page.items) {
    const decoded = decodeSessionMessageRecord(record);
    if (decoded.status !== 'decoded') {
      return reject('unavailable', `the answer message is damaged: ${decoded.reason}`);
    }
    const message = decoded.value;
    if (message.decision?.syntheticAnswer !== true || message.status !== 'responded') continue;
    if (message.application !== undefined && message.application !== null) continue;
    const source = answerSource(message);
    const selection = answerSelection(message);
    if (source === null || selection === null) continue;
    if (input.kind === 'message_release') {
      const command = messageReleaseAnswerCommand(message);
      if (command === null) continue;
      const applied = await receiptExists(deps, commandKeys(command));
      if (applied !== null && applied.status === 'rejected') return applied;
      const target = messageReleaseAnswerFacts(message);
      if (target === null) continue;
      answers.push({ kind: 'message_release', answerMessageRef: message.ref, source,
        messageRef: target.messageRef });
      continue;
    }
    if (input.kind === 'command_rerun_request') {
      const requestRef = commandRerunRequestRefOfSource(source);
      if (requestRef === null) continue;
      const identity = commandRerunRequestAnswerIdentity(source, selection, message.ref);
      if (identity === null) continue;
      const applied = await receiptExists(deps, identity);
      // F-073: an answer saved at ① with ② unfinished is exactly the one the
      // restart/ordinary advance must replay, so it is enumerated too (not only
      // already-applied candidates). A receipt read failure is still a failure.
      if (applied !== null && applied.status === 'rejected') return applied;
      answers.push({ kind: 'command_rerun_request', answerMessageRef: message.ref, source, requestRef });
      continue;
    }
    const reviewRef = reviewRefOfSource(source);
    if (reviewRef === null) continue;
    if (input.reviewRef !== undefined
      && canonicalJson(reviewRefFour(reviewRef)) !== canonicalJson(reviewRefFour(input.reviewRef))) continue;
    const { identityKey, fingerprint, phase } = unknownCallReviewDispositionIdentity(source, selection, message.ref);
    if (identityKey.length === 0) continue;
    const applied = await receiptExists(deps, { identityKey, fingerprint });
    if (applied === null) continue;
    if (applied.status === 'rejected') return applied;
    answers.push({ kind: 'unknown_call_review', answerMessageRef: message.ref, phase, source, reviewRef });
  }
  return { status: 'ready', value: { answers, readThrough: page.watermark } };
}
