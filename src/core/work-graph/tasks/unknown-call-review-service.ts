/**
 * K3 (spec §2 L7, §3.2, L14/L15/L16): the `UnknownCallReview` owner.
 *
 * `readReview` reads by record ref or by the original Run; `listReviews` is a
 * read. Each write of the review-round half (`recordConclusion`,
 * `settleReview`) follows the owner order: trusted context → input
 * isolation/shape → request identity/fingerprint → original receipt lookup
 * (replay wins before any record or Run read) → one read of the record (and the
 * round's Run/pointer/manifest) → the pure state machine → M3 admission → ONE
 * RecordStore commit whose guards are the versions read here.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type {
  CrashSuspicionV1, KernelCallRefV1, SaferMethodProposalV1, UnknownCallBlockedCommandV1,
  UnknownCallReviewItemV1, UnknownCallReviewRef, UnknownCallReviewStatusV1, UnknownCallReviewV1,
} from '../../../contracts/unknown-call-review.js';
import { UNKNOWN_CALL_REVIEW_T02_REASON } from '../../../contracts/unknown-call-review.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { DecisionChangeProofV1, DecisionSelectionV1, DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { isPos, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { GoalRecordTransactionPort, EncodedRecord } from '../../record-store/ports.js';
import type { LookupValue, RecordLookupPage, RecordLookupPort } from '../../record-store/lookup-ports.js';
import { compareRefKeys } from '../../record-store/lookup-index.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import type { UnknownCallReviewPort, UnknownCallReviewReadPort } from '../model/unknown-call-review-contracts.js';
import { admitUnknownCallReview, transitionUnknownCallReview, UNKNOWN_CALL_REVIEW_MAX_ITEMS,
  type UnknownCallReviewContextV1 } from '../state/unknown-call-review.js';
import { reworkFenceOf } from '../state/task-failure.js';
import { readUnappliedAnswers, unknownCallReviewDispositionIdentity } from './unknown-call-review-answers.js';
import type { KernelCommandReader, WorkspaceFileReader } from '../model/kernel-command-read-contracts.js';
import { commandActionKey, commandSha256, normalizeCommandText, parseShellActionsDetailed } from '../state/command-normalization.js';
import { BLOCKED_COMMAND_MAX_FILE_BYTES, expandShellScripts } from './command-expansion.js';
import { reviewRoundEndedKnown } from '../state/review-lease.js';
import { readGoal, readPointerIntents, type CanonicalTaskFactRead, type CanonicalTaskFacts } from './plan-readers.js';
import { readGoalSettings } from '../persistence/record-codecs.js';
import { goalDecisionBasisMatches } from '../state/goal-settings-machine.js';
import { pinRevision } from './revision-guard.js';
import { unknownCallReviewOptions } from './unknown-call-review-card.js';
import { decodeSessionMessageRecord, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import { mergeGuards, isolateWrite } from './execution-entry-service.js';
import { replayCommittedReceipt } from './receipt-replay.js';
import { ownerReadStoreFailureToRejection, ownerWriteStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { readOwnerRecord, type OwnerRecordRead } from './owner-record-read.js';
import {
  decodeUnknownCallReview, encodeUnknownCallReview, encodeUnknownCallReviewChangedEvent,
  unknownCallReviewChangedEventFromEvent, unknownCallReviewRefKey,
  K3_UCR_BY_GOAL_STATUS_LOOKUP, K3_UCR_BY_WORKSPACE_OPEN_LOOKUP,
  UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE, UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION,
} from './unknown-call-review-codecs.js';

/**
 * D6: read one review round's prepared manifest once (`readManifestFromEnvelope`)
 * and return the round's `alias → display` map; the composition root wires this
 * to the real manifest body reader. A missing manifest (or a missing alias in
 * it) is a read rejection, never a guessed `full`.
 */
export type UnknownCallReviewDisplayReader = (
  ctx: CoreCallContext,
  input: { roundRunRef: RunRef },
) => Promise<ReadResult<Map<number, 'full' | 'truncated' | 'unexpanded'>>>;

export type UnknownCallReviewServiceDependencies = {
  /** The review records and the two list indexes. */
  records: GoalRecordTransactionPort & Partial<RecordLookupPort>;
  /** The index port when it is not the same object as `records`. */
  lookups?: RecordLookupPort;
  /** L15/L16: read the round's Run (status, outcome and revision). */
  reads?: ExecutionReadPort;
  /** D6: read one round's `alias → display` map from the writing round's manifest. */
  readReviewDisplays?: UnknownCallReviewDisplayReader;
  /**
   * D3/L21 (ruling 2): the canonical Task projection the hold guard pins. The
   * composition wires the SAME `readCanonicalTaskFacts` the claim service uses
   * (its active-plan read included); the owner never copies the projection. The
   * returned `guards`/`reworkGuards` carry the TaskLease and Run/TaskRequeue
   * revisions the hold commit pins. Absent -> `unavailable`.
   */
  taskProjection?: UnknownCallReviewTaskProjectionReader;
  /**
   * K3 L19: read the saved answer's appended text (the disposition's 附言).
   * The answer message record carries only the body ref; the composition wires
   * the SAME decision-message owner's `readDecisionAnswer`. Optional as an
   * owner seam; when absent, applying a disposition is `unavailable`.
   */
  readAnswerText?: UnknownCallReviewAnswerTextReader;
  /** L19a: the original Run's Kernel command/cwd reader (same K L9 window as the brief). */
  readKernelCommandFacts?: KernelCommandReader;
  /** L19a: the platform's workspace read port for `package.json` expansion. */
  readWorkspace?: WorkspaceFileReader;
  now?: () => string;
  eventId?: () => string;
};

export type UnknownCallReviewAnswerTextReader = (
  ctx: CoreCallContext,
  input: { source: DecisionSourceV1; answerMessageRef: SessionMessageRef },
) => Promise<ReadResult<string | null>>;

/** L19a: serialised size of every blocked command's new fields (the record cap). */
export function blockedCommandsBytes(entries: readonly UnknownCallBlockedCommandV1[]): number {
  return Buffer.byteLength(JSON.stringify(entries.map(entry => ({
    reviewRunId: entry.reviewRunId, actions: entry.actions,
    expansions: entry.expansions, truncated: entry.truncated,
  }))), 'utf8');
}

/** L19a caps: 16 actions / 8 expansions per entry, then the record-wide 16 KiB. */
function capBlockedCommands(entries: UnknownCallBlockedCommandV1[]): UnknownCallBlockedCommandV1[] {
  for (const entry of entries) {
    if (entry.actions.length > BLOCKED_ACTIONS_MAX) {
      entry.actions = entry.actions.slice(0, BLOCKED_ACTIONS_MAX);
      entry.truncated = true;
    }
    if (entry.expansions.length > BLOCKED_EXPANSIONS_MAX) {
      entry.expansions = entry.expansions.slice(0, BLOCKED_EXPANSIONS_MAX);
      entry.truncated = true;
    }
  }
  let actionCap = BLOCKED_ACTIONS_MAX;
  while (blockedCommandsBytes(entries) > BLOCKED_COMMANDS_MAX_BYTES) {
    let dropped = false;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]!;
      if (entry.expansions.length > 0) {
        entry.expansions.pop();
        entry.truncated = true;
        dropped = true;
        break;
      }
    }
    if (dropped) continue;
    if (actionCap === 0) break;
    actionCap -= 1;
    for (const entry of entries) {
      if (entry.actions.length > actionCap) {
        entry.actions = entry.actions.slice(0, actionCap);
        entry.truncated = true;
      }
    }
  }
  return entries;
}

/**
 * L19a "拦哪些命令": reads the original Run's Kernel commands for the disposition
 * or approval targets and builds the blocked-command entries. Any required read
 * failure is `unavailable` (nothing written), so UR7 retries it.
 */
async function buildBlockedCommands(
  ctx: CoreCallContext,
  deps: UnknownCallReviewServiceDependencies,
  current: UnknownCallReviewV1,
  phase: 'disposition' | 'approval',
  optionId: string,
): Promise<{ ok: true; commands: UnknownCallBlockedCommandV1[] } | { ok: false; rejection: CoreRejection }> {
  const targetCallIds = phase === 'approval'
    ? (optionId === 'approve' ? [...(current.proposalTargets ?? [])] : [])
    : (optionId === 'skip_as_done'
      ? [...(current.dispositionTargets ?? [])].filter(callId =>
        current.items.some(item => item.callId === callId && item.kind === 'process'))
      : []);
  if (targetCallIds.length === 0) return { ok: true, commands: [] };
  const items: UnknownCallReviewItemV1[] = [];
  for (const callId of targetCallIds) {
    const item = current.items.find(entry => entry.callId === callId);
    if (item === undefined || item.kind !== 'process') {
      return { ok: false, rejection: rejected('unavailable', 'a blocked command target is not a process item') };
    }
    items.push(item);
  }
  const reads = deps.reads;
  const readKernel = deps.readKernelCommandFacts;
  const readWorkspace = deps.readWorkspace;
  if (reads === undefined || readKernel === undefined || readWorkspace === undefined) {
    return { ok: false, rejection: rejected('unavailable', 'the blocked-command readers are not wired') };
  }
  let execution;
  try {
    execution = await reads.readExecution(ctx, current.runRef);
  } catch (error) {
    if (isRecord(error) && error['status'] === 'rejected' && typeof error['code'] === 'string') {
      return { ok: false, rejection: error as unknown as CoreRejection };
    }
    return { ok: false, rejection: rejected('unavailable',
      `the original Run could not be read: ${error instanceof Error ? error.message : String(error)}`) };
  }
  if (execution.status !== 'ready') {
    return { ok: false, rejection: execution.status === 'rejected' ? execution
      : rejected('unavailable', 'the original Run could not be read') };
  }
  const calls: readonly KernelCallRefV1[] = items.map(item => item.kernel);
  let facts;
  try {
    facts = await readKernel(ctx, { session: execution.value.session, calls,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }) });
  } catch (error) {
    if (isRecord(error) && error['status'] === 'rejected' && typeof error['code'] === 'string') {
      return { ok: false, rejection: error as unknown as CoreRejection };
    }
    return { ok: false, rejection: rejected('unavailable',
      `the original command facts could not be read: ${error instanceof Error ? error.message : String(error)}`) };
  }
  if (facts.status !== 'ready') {
    return { ok: false, rejection: facts.status === 'rejected' ? facts
      : rejected('unavailable', 'the original command facts could not be read') };
  }
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId: ctx.projectId,
    workspaceId: current.workspaceId };
  const readFile = async (path: string):
  Promise<{ content: string; digest: string } | { status: 'unavailable'; reason: string }> => {
    try {
      const read = await readWorkspace.readWorkspace(ctx, { workspace: workspaceRef, path,
        maxBytes: BLOCKED_COMMAND_MAX_FILE_BYTES, version: { kind: 'working_tree' } });
      return read.status === 'ready'
        ? { content: read.value.content, digest: read.value.digest }
        : { status: 'unavailable', reason: read.reason };
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
    }
  };
  const entries: UnknownCallBlockedCommandV1[] = [];
  for (const item of items) {
    const fact = facts.value.get(item.kernel.callId);
    if (fact === undefined || fact.command === null) {
      return { ok: false, rejection: rejected('unavailable',
        `the original command of #${String(item.alias)} is not readable`) };
    }
    const command = fact.command;
    const detailed = parseShellActionsDetailed(command);
    const actions = detailed.status === 'unparsed' || detailed.actions.length === 0
      ? (() => {
        const text = normalizeCommandText(command);
        return [{ text, sha256: commandActionKey(text.split(' ')) }];
      })()
      : detailed.actions.map(action => ({ text: action.text, sha256: commandActionKey(action.words) }));
    const expansion = await expandShellScripts({
      actions: detailed.status === 'parsed' ? detailed.actions : [],
      cwd: fact.cwd ?? '.',
      maxFiles: BLOCKED_COMMAND_MAX_PACKAGE_FILES,
      readFile,
    });
    entries.push({
      reviewRunId: current.runRef.runId,
      alias: item.alias,
      commandSha256: commandSha256(command),
      kernelCallRef: item.kernel,
      actions,
      expansions: expansion.expansions,
      truncated: expansion.truncated,
    });
  }
  return { ok: true, commands: capBlockedCommands(entries) };
}

/**
 * D3/L21: reads one Task's canonical projection (the same
 * `readCanonicalTaskFacts` window the claim service guards with). Required as a
 * dependency because the owner's own `records` port is only a partial lookup
 * port; the reader is never re-implemented here.
 */
export type UnknownCallReviewTaskProjectionReader = (
  ctx: CoreCallContext,
  task: TaskTriple,
) => Promise<CanonicalTaskFactRead>;

const MAX_PAGE_LIMIT = 200;
/** How many times one keyset page is re-read until every tuple reads at one watermark. */
const LOOKUP_WATERMARK_ATTEMPTS = 3;
const STATUSES: readonly UnknownCallReviewStatusV1[] = [
  'pending_review', 'needs_decision', 'awaiting_proposal', 'awaiting_approval', 'resolved',
];
const CONCLUSION_IDENTITY_PREFIX = 'ucr-conclusion:';
const PROPOSAL_IDENTITY_PREFIX = 'ucr-proposal:';
/** L20/lead answer 7: command and cwd are UTF-8 byte bounds, rationale is UTF-16 code units. */
const PROPOSAL_COMMAND_MAX_BYTES = 4_000;
const PROPOSAL_CWD_MAX_BYTES = 512;
const PROPOSAL_RATIONALE_MAX_UNITS = 2_000;
const SETTLEMENT_IDENTITY_PREFIX = 'ucr-settlement:';
const HOLD_IDENTITY_PREFIX = 'ucr-hold:';
const RELEASE_HOLD_IDENTITY_PREFIX = 'ucr-release-hold:';
/** L19a: per blocked command at most 16 actions and 8 expansions. */
const BLOCKED_ACTIONS_MAX = 16;
const BLOCKED_EXPANSIONS_MAX = 8;
/** L19a: the new blocked-command fields of one record serialise to at most 16 KiB. */
const BLOCKED_COMMANDS_MAX_BYTES = 16 * 1024;
/** L19a: at most 4 distinct package.json reads per blocked command. */
const BLOCKED_COMMAND_MAX_PACKAGE_FILES = 4;
/** L21: a new hold request on an already-held record. */
const ALREADY_HELD_TEXT = '已经在等你处理';
/** UCR-14/D3: release-hold while a round is still active. */
const ROUND_NOT_SETTLED_TEXT = '核对轮还没收尾';

const rejected = rejectedWithCurrent;
/**
 * The newest watermark among a mixed per-tuple read, used as the `not_ready`
 * requirement. At least one tuple read at a concrete cursor, so this always
 * returns one; a malformed cursor falls back to the first non-null one.
 */
function maxCommitCursor(watermarks: readonly (CommitCursor | null)[]): CommitCursor {
  let chosen: CommitCursor | null = null;
  let chosenSeq = 0;
  for (const watermark of watermarks) {
    if (watermark === null) continue;
    let seq = 0;
    try { seq = seqOfCommitCursor(watermark); } catch { seq = 0; }
    if (chosen === null) { chosen = watermark; chosenSeq = seq; continue; }
    if (seq >= chosenSeq) { chosen = watermark; chosenSeq = seq; }
  }
  if (chosen === null) throw new Error('no review-list watermark was observed');
  return chosen;
}
function refKeyOf(value: unknown): string {
  return canonicalJson(value as JsonValue);
}
function fourRunFields(runRef: RunRef): Record<string, string> {
  return { aggregateType: 'Run', projectId: runRef.projectId, goalId: runRef.goalId, runId: runRef.runId };
}
function fourReviewFields(ref: UnknownCallReviewRef): Record<string, string> {
  return { aggregateType: 'UnknownCallReview', projectId: ref.projectId, goalId: ref.goalId, runId: ref.runId };
}
/**
 * K3 L18/§2: one captured answer annotation in the disposition's form. The
 * answer's `objectKey` IS the card object's canonical JSON (the answer owner
 * checks it against the card's objects at ①), so a `file` object yields its
 * path and the record's `aggregate` object yields `null`. No path is invented.
 */
function dispositionAnnotations(
  annotations: readonly { objectKey: string; text: string }[],
): Array<{ path: string | null; text: string }> {
  return annotations.map((annotation) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(annotation.objectKey);
    } catch {
      parsed = null;
    }
    const path = isRecord(parsed) && parsed['kind'] === 'file' && typeof parsed['path'] === 'string'
      && parsed['path'].length > 0 ? parsed['path'] : null;
    return { path, text: annotation.text };
  });
}
function runRefProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'Run'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'requires a complete RunRef';
  }
  return null;
}
function refProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'UnknownCallReview'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'requires a complete UnknownCallReviewRef';
  }
  return null;
}
/** Both spellings name the same aggregate key; a `{runRef}` is normalized to the record ref. */
function reviewRefOf(input: { ref: UnknownCallReviewRef } | { runRef: RunRef }): UnknownCallReviewRef | null {
  const raw = input as unknown as Record<string, unknown>;
  if (raw['ref'] !== undefined && raw['runRef'] !== undefined) return null;
  if (raw['ref'] !== undefined) {
    if (refProblem(raw['ref']) !== null) return null;
    const ref = raw['ref'] as UnknownCallReviewRef;
    return { aggregateType: 'UnknownCallReview', projectId: ref.projectId, goalId: ref.goalId, runId: ref.runId };
  }
  if (raw['runRef'] !== undefined) {
    if (runRefProblem(raw['runRef']) !== null) return null;
    const run = raw['runRef'] as RunRef;
    return { aggregateType: 'UnknownCallReview', projectId: run.projectId, goalId: run.goalId, runId: run.runId };
  }
  return null;
}
const VERDICTS = ['done', 'not_done', 'partial', 'undetermined'] as const;
const CRASH_VERDICTS = ['unlikely', 'possible', 'undetermined'] as const;

/** L19: the canonical review card identity (record ref + revision) from a source key. */
function reviewCardIdentityOf(source: DecisionSourceV1):
{ reviewRef: UnknownCallReviewRef; revision: number } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(source.key); } catch { return null; }
  if (!isRecord(parsed) || parsed['kind'] !== 'unknown_call_review' || !isRecord(parsed['reviewRef'])) return null;
  const rawRef = parsed['reviewRef'];
  if (refProblem(rawRef) !== null) return null;
  const revision = parsed['revision'];
  if (!isPos(revision)) return null;
  return { reviewRef: reviewRefOf({ ref: rawRef as UnknownCallReviewRef })!, revision };
}

/** A complete `SessionMessageRef`, or false. */
function sessionMessageRefComplete(value: unknown): value is SessionMessageRef {
  return isRecord(value) && value['aggregateType'] === 'SessionMessage'
    && nonEmpty(value['projectId']) && nonEmpty(value['workspaceId']) && nonEmpty(value['messageId']);
}

/** A trusted host context for the owner's own internal Run/Goal/manifest reads. */
function internalReadContext(ctx: CoreCallContext, projectId: string, workspaceId: string): CoreCallContext {
  const actor = { kind: 'system' as const, id: 'unknown-call-review-owner' };
  return {
    projectId, workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: ctx.signal,
  } as CoreCallContext;
}

export function createUnknownCallReviewService(
  deps: UnknownCallReviewServiceDependencies,
): UnknownCallReviewReadPort & UnknownCallReviewPort {
  const records = deps.records;
  const lookups: RecordLookupPort | null = deps.lookups
    ?? (typeof (records as Partial<RecordLookupPort>).lookup === 'function' ? records as RecordLookupPort : null);
  const now = deps.now ?? (() => new Date().toISOString());
  let eventSeq = 0;
  const newEventId = deps.eventId ?? (() => `ucr-event-${String(++eventSeq)}`);

  async function loadReview(refKey: string): Promise<OwnerRecordRead<UnknownCallReviewV1>> {
    return readOwnerRecord({
      store: records, refKey, decode: decodeUnknownCallReview,
      readError: message => rejected('unavailable', `the review could not be read: ${message}`),
      decodeError: reason => rejected('invalid', `the stored review is not decodable: ${reason}`),
    });
  }

  /** The ONE committed-receipt replay helper. */
  async function replayReview(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>, { status: 'ready' }>['value'],
    identityKey: string, fingerprint: string,
  ): Promise<WriteResult<UnknownCallReviewV1>> {
    return replayCommittedReceipt({
      receipt,
      eventAt: cursor => records.eventAt(cursor),
      expectedEventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      decode: unknownCallReviewChangedEventFromEvent,
      expected: { identityKey, fingerprint },
      identityKey: decoded => decoded.identityKey,
      fingerprint: decoded => decoded.fingerprint,
      project: decoded => decoded.review,
    });
  }

  /** The single review-record commit: one `UnknownCallReviewChanged` event, guarded at the read revisions. */
  async function commitReview(input: {
    identityKey: string; fingerprint: string; requestId: string;
    guards: readonly { refKey: string; expectedRevision: number | null }[];
    next: UnknownCallReviewV1; change: Parameters<typeof encodeUnknownCallReviewChangedEvent>[0]['change'];
    actor: { kind: 'human' | 'system'; id: string }; signal: AbortSignal;
    proof?: DecisionChangeProofV1;
  }): Promise<WriteResult<UnknownCallReviewV1>> {
    const merged = mergeGuards(input.guards);
    if (!merged.ok) return merged.rejection;
    if (input.signal.aborted) return rejected('cancelled', 'the review write was cancelled before commit');
    const occurredAt = now();
    const prepared = {
      identityKey: input.identityKey, fingerprint: input.fingerprint,
      guards: merged.guards, records: [encodeUnknownCallReview(input.next)], claims: [],
      indexGuards: [] as const, indexChanges: [] as const,
      events: [encodeUnknownCallReviewChangedEvent({
        eventId: newEventId(), eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
        schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt,
        identityKey: input.identityKey, fingerprint: input.fingerprint, actor: input.actor,
        requestId: input.requestId, change: input.change, review: input.next,
        ...(input.proof === undefined ? {} : { proof: input.proof }),
      })],
    };
    let receipt;
    try {
      receipt = await records.commit(prepared);
    } catch (error) {
      return rejected('unavailable', `the review could not be committed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (receipt.status !== 'committed') return ownerWriteStoreFailureToRejection(receipt);
    if (receipt.replayed) return replayReview(receipt, input.identityKey, input.fingerprint);
    return { status: 'committed', value: input.next, replayed: false, cursor: receipt.cursor };
  }

  // ---- recordConclusion (UCR-04, L14) -------------------------------------

  async function recordConclusion(
    ctx: CoreCallContext,
    request: Parameters<UnknownCallReviewPort['recordConclusion']>[1],
  ): Promise<WriteResult<UnknownCallReviewV1>> {
    const principal = ctx.principal;
    if (principal.kind !== 'work_run') {
      return rejected('forbidden', 'recordConclusion is written by the review round tool (a work_run principal)');
    }
    const roundRef = principal.runRef;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input as unknown as Record<string, unknown>;
    const refProblemText = refProblem(input['reviewRef']);
    if (refProblemText !== null) return rejected('invalid', `recordConclusion ${refProblemText}`);
    const reviewRef = reviewRefOf({ ref: input['reviewRef'] as UnknownCallReviewRef })!;
    if (!isPos(input['item']) || (input['item'] as number) > UNKNOWN_CALL_REVIEW_MAX_ITEMS) {
      return rejected('invalid', 'recordConclusion requires an item alias');
    }
    const verdict = input['verdict'];
    if (typeof verdict !== 'string' || !VERDICTS.includes(verdict as never)) {
      return rejected('invalid', 'recordConclusion requires a verdict');
    }
    const rawEvidence = input['evidence'];
    if (typeof rawEvidence !== 'string') return rejected('invalid', 'recordConclusion requires evidence text');
    const evidence = rawEvidence;
    const crash = input['crashSuspicion'];
    if (!isRecord(crash) || !CRASH_VERDICTS.includes(crash['verdict'] as never)
      || typeof crash['evidence'] !== 'string') {
      return rejected('invalid', 'recordConclusion requires a crash self-check');
    }
    if (ctx.projectId !== reviewRef.projectId) return rejected('forbidden', 'the review belongs to another project');
    const reviewRefFour = fourReviewFields(reviewRef);
    // L14: the request number is the Kernel call id's `requestIdForCall` value
    // (the tool adapter builds it with `toolCommitRequestId`); the owner sees it
    // as `meta.requestId`. The spec also names the reviewed item's callId; the
    // owner cannot resolve alias->callId before reading the record and replay
    // must precede that read, so the alias (immutable 1..n in Kernel order) is
    // the stable item identity here.
    const requestId = owned.requestId;
    const identityKey = CONCLUSION_IDENTITY_PREFIX + sha256Hex(canonicalJson({
      round: fourRunFields(roundRef), item: input['item'], requestId,
    } as never));
    const fingerprint = sha256Hex(canonicalJson({
      reviewRef: reviewRefFour, item: input['item'], verdict,
      evidence, crashSuspicion: crash,
    } as never));
    let existing;
    try {
      existing = await records.lookupCommit({ identityKey, fingerprint });
    } catch (error) {
      return rejected('unavailable', `the review receipt could not be looked up: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (existing.status === 'ready') return replayReview(existing.value, identityKey, fingerprint);
    if (existing.code !== 'not_found') return ownerWriteStoreFailureToRejection(existing);

    const refKey = unknownCallReviewRefKey(reviewRef);
    // L14: a record pin is optional. The round tool sends none, so the owner
    // reads the record itself AFTER the receipt/identity replay check above and
    // guards the revision it read. A malformed non-empty `expected` is invalid.
    const hasExpected = owned.expected.length > 0;
    const pinnedRevision = hasExpected ? pinRevision(owned.expected, reviewRef) : null;
    if (hasExpected && pinnedRevision === null) {
      return rejected('invalid', 'meta.expected must pin the review ref exactly once');
    }

    async function attemptConclusion(): Promise<WriteResult<UnknownCallReviewV1>> {
      const loaded = await loadReview(refKey);
      if ('rejection' in loaded) return loaded.rejection;
      if ('notFound' in loaded) return rejected('not_found', 'the review record does not exist');
      const current = loaded.value;
      if (ctx.workspaceId !== undefined && ctx.workspaceId !== current.workspaceId) {
        return rejected('forbidden', 'the review belongs to another workspace');
      }
      const ctxRevision = pinnedRevision ?? current.revision;

      let run: RunSnapshot | null = null;
      let activeRunEnded = false;
      if (current.activeRound !== null) {
        if (refKeyOf(current.activeRound.runRef) !== refKeyOf(roundRef)) {
          return rejected('source_stale', 'the record\'s active round is not this review Run');
        }
        if (deps.reads === undefined) return rejected('unavailable', 'the review round Run reader is not wired');
        const read = await deps.reads.readExecution(
          internalReadContext(ctx, current.ref.projectId, current.workspaceId), roundRef);
        if (read.status === 'not_found') return rejected('source_stale', 'the review round Run does not exist');
        if (read.status === 'not_ready') return rejected('incomplete', 'the review round Run is not readable at the required watermark');
        if (read.status === 'rejected') return read;
        run = read.value.run;
        if (run.status === 'ended') return rejected('source_stale', 'the review round already ended; its conclusion is late');
        if (run.status !== 'running') return rejected('busy', 'the review round Run is not running');
      }

      const transitionCtx: UnknownCallReviewContextV1 = {
        expectedRevision: ctxRevision, updatedAt: now(), actor: { kind: 'system', id: 'unknown-call-review-round' },
        activeRunEnded, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
        autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
        originalRunSelected: false,
      };
      const decided = transitionUnknownCallReview(current, {
        kind: 'conclusion_recorded', alias: input['item'] as number, verdict: verdict as never,
        evidence, roundRunRef: fourRunFields(roundRef) as unknown as RunRef,
        crashSuspicion: crash as unknown as CrashSuspicionV1,
      }, transitionCtx);
      if (!decided.ok) return rejected(decided.code, decided.detail);
      const writeEffect = decided.effects.find(effect => effect.kind === 'write_review');
      if (writeEffect === undefined || writeEffect.kind !== 'write_review') {
        return rejected('unavailable', 'the review machine produced no record');
      }
      const admission = admitUnknownCallReview(writeEffect.review, { required: false });
      if (admission !== null) {
        return admission.ok ? rejected('unavailable', 'the review admission refused unexpectedly')
          : rejected(admission.code, admission.detail);
      }

      const guards = [{ refKey, expectedRevision: current.revision }];
      if (run !== null) guards.push({ refKey: refKeyOf(roundRef), expectedRevision: run.revision });
      return commitReview({
        identityKey, fingerprint, requestId, guards, next: writeEffect.review,
        change: 'conclusion_recorded', actor: { kind: 'system', id: `unknown-call-review:${reviewRef.runId}` },
        signal: ctx.signal,
      });
    }

    // L14: exactly one retry on a real revision conflict (a concurrent writer
    // moved the record after this read): re-read and re-guard, then return.
    const conclusion = await attemptConclusion();
    if (conclusion.status === 'rejected' && conclusion.code === 'revision_conflict') {
      return await attemptConclusion();
    }
    return conclusion;
  }

  // ---- recordProposal (UCR-05, L20/section 2 `propose_safer_method`) ------

  /**
   * L14/L20: the same owner order as `recordConclusion`. The request identity is
   * the proposal-round Run + item + request number; the fingerprint is the
   * canonical input. The receipt lookup happens before the record read, so a
   * replay returns the original receipt (and a changed input is the store's
   * `idempotency_conflict`). The proposal id IS the write identity. Units
   * (lead answer 7): command 1..4,000 UTF-8 bytes, cwd null or 1..512 UTF-8
   * bytes, rationale 1..2,000 UTF-16 code units. The state machine owns the
   * alias/proposalTargets check and the 5,120-byte approved-method budget; M3
   * admission owns the 512 KiB ceiling.
   */
  async function recordProposal(
    ctx: CoreCallContext,
    request: Parameters<UnknownCallReviewPort['recordProposal']>[1],
  ): Promise<WriteResult<UnknownCallReviewV1>> {
    const principal = ctx.principal;
    if (principal.kind !== 'work_run') {
      return rejected('forbidden', 'recordProposal is written by the proposal round tool (a work_run principal)');
    }
    const roundRef = principal.runRef;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input as unknown as Record<string, unknown>;
    const refProblemText = refProblem(input['reviewRef']);
    if (refProblemText !== null) return rejected('invalid', `recordProposal ${refProblemText}`);
    const reviewRef = reviewRefOf({ ref: input['reviewRef'] as UnknownCallReviewRef })!;
    const item = input['item'];
    if (!isPos(item) || item > UNKNOWN_CALL_REVIEW_MAX_ITEMS) {
      return rejected('invalid', 'recordProposal requires an item alias');
    }
    const command = input['command'];
    if (typeof command !== 'string') return rejected('invalid', 'recordProposal requires a command string');
    const commandBytes = Buffer.byteLength(command, 'utf8');
    if (commandBytes < 1 || commandBytes > PROPOSAL_COMMAND_MAX_BYTES) {
      return rejected('invalid',
        `recordProposal requires a command of 1..${String(PROPOSAL_COMMAND_MAX_BYTES)} UTF-8 bytes`);
    }
    const rawCwd = input['cwd'];
    let cwd: string | null;
    if (rawCwd === null) {
      cwd = null;
    } else if (typeof rawCwd === 'string') {
      const cwdBytes = Buffer.byteLength(rawCwd, 'utf8');
      if (cwdBytes < 1 || cwdBytes > PROPOSAL_CWD_MAX_BYTES) {
        return rejected('invalid',
          `recordProposal requires a cwd of 1..${String(PROPOSAL_CWD_MAX_BYTES)} UTF-8 bytes or null`);
      }
      cwd = rawCwd;
    } else {
      return rejected('invalid', 'recordProposal requires a cwd string or null');
    }
    const rationale = input['rationale'];
    if (typeof rationale !== 'string') return rejected('invalid', 'recordProposal requires a rationale string');
    if (rationale.length < 1 || rationale.length > PROPOSAL_RATIONALE_MAX_UNITS) {
      return rejected('invalid',
        `recordProposal requires a rationale of 1..${String(PROPOSAL_RATIONALE_MAX_UNITS)} characters`);
    }
    // Typed copies so the nested attempt closure sees the validated values.
    const commandText: string = command;
    const cwdText: string | null = cwd;
    const rationaleText: string = rationale;
    if (ctx.projectId !== reviewRef.projectId) return rejected('forbidden', 'the review belongs to another project');
    const reviewRefFour = fourReviewFields(reviewRef);
    const requestId = owned.requestId;
    const identityKey = PROPOSAL_IDENTITY_PREFIX + sha256Hex(canonicalJson({
      round: fourRunFields(roundRef), item, requestId,
    } as never));
    const fingerprint = sha256Hex(canonicalJson({
      reviewRef: reviewRefFour, item, command: commandText, cwd: cwdText, rationale: rationaleText,
    } as never));
    let existing;
    try {
      existing = await records.lookupCommit({ identityKey, fingerprint });
    } catch (error) {
      return rejected('unavailable', `the review receipt could not be looked up: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (existing.status === 'ready') return replayReview(existing.value, identityKey, fingerprint);
    if (existing.code !== 'not_found') return ownerWriteStoreFailureToRejection(existing);

    const refKey = unknownCallReviewRefKey(reviewRef);
    const hasExpected = owned.expected.length > 0;
    const pinnedRevision = hasExpected ? pinRevision(owned.expected, reviewRef) : null;
    if (hasExpected && pinnedRevision === null) {
      return rejected('invalid', 'meta.expected must pin the review ref exactly once');
    }

    async function attemptProposal(): Promise<WriteResult<UnknownCallReviewV1>> {
      const loaded = await loadReview(refKey);
      if ('rejection' in loaded) return loaded.rejection;
      if ('notFound' in loaded) return rejected('not_found', 'the review record does not exist');
      const current = loaded.value;
      if (ctx.workspaceId !== undefined && ctx.workspaceId !== current.workspaceId) {
        return rejected('forbidden', 'the review belongs to another workspace');
      }
      const ctxRevision = pinnedRevision ?? current.revision;

      let run: RunSnapshot | null = null;
      if (current.activeRound !== null) {
        if (refKeyOf(current.activeRound.runRef) !== refKeyOf(roundRef)) {
          return rejected('source_stale', 'the record\'s active round is not this proposal Run');
        }
        if (deps.reads === undefined) return rejected('unavailable', 'the proposal round Run reader is not wired');
        const read = await deps.reads.readExecution(
          internalReadContext(ctx, current.ref.projectId, current.workspaceId), roundRef);
        if (read.status === 'not_found') return rejected('source_stale', 'the proposal round Run does not exist');
        if (read.status === 'not_ready') return rejected('incomplete', 'the proposal round Run is not readable at the required watermark');
        if (read.status === 'rejected') return read;
        run = read.value.run;
        if (run.status === 'ended') return rejected('source_stale', 'the proposal round already ended; its proposal is late');
        if (run.status !== 'running') return rejected('busy', 'the proposal round Run is not running');
      }

      // L20: the alias is resolved against the record AFTER the replay check;
      // an unknown or non-process alias is caught by the state machine's
      // `proposalTargets` check (its callId cannot be in that set).
      const target = current.items.find(entry => entry.alias === item);
      const proposal: SaferMethodProposalV1 = {
        proposalId: identityKey,
        callId: target?.callId ?? '',
        alias: item as number,
        command: commandText, cwd: cwdText, rationale: rationaleText,
        roundRunRef: fourRunFields(roundRef) as unknown as RunRef,
      };
      const transitionCtx: UnknownCallReviewContextV1 = {
        expectedRevision: ctxRevision, updatedAt: now(), actor: { kind: 'system', id: 'unknown-call-review-round' },
        activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
        autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
        originalRunSelected: false,
      };
      const decided = transitionUnknownCallReview(current, {
        kind: 'proposal_recorded', proposal,
      }, transitionCtx);
      if (!decided.ok) return rejected(decided.code, decided.detail);
      const writeEffect = decided.effects.find(effect => effect.kind === 'write_review');
      if (writeEffect === undefined || writeEffect.kind !== 'write_review') {
        return rejected('unavailable', 'the review machine produced no record');
      }
      const admission = admitUnknownCallReview(writeEffect.review, { required: false });
      if (admission !== null) {
        return admission.ok ? rejected('unavailable', 'the review admission refused unexpectedly')
          : rejected(admission.code, admission.detail);
      }

      const guards = [{ refKey, expectedRevision: current.revision }];
      if (run !== null) guards.push({ refKey: refKeyOf(roundRef), expectedRevision: run.revision });
      return commitReview({
        identityKey, fingerprint, requestId, guards, next: writeEffect.review,
        change: 'proposal_recorded', actor: { kind: 'system', id: `unknown-call-review:${reviewRef.runId}` },
        signal: ctx.signal,
      });
    }

    // L14: exactly one retry on a real revision conflict, as `recordConclusion`.
    const proposal = await attemptProposal();
    if (proposal.status === 'rejected' && proposal.code === 'revision_conflict') {
      return await attemptProposal();
    }
    return proposal;
  }

  // ---- settleReview (UCR-06/06b/07/08b/08c, L15/L16) ----------------------

  /**
   * D6: the process aliases whose written conclusion read a truncated or
   * unexpanded command. Decision 75: the writing round's prepared manifest is
   * read once per round as an `alias → display` map; an unreadable manifest (or
   * an alias missing from it) is `unavailable` and nothing is written (L16).
   */
  async function incompleteCommandAliases(
    ctx: CoreCallContext, current: UnknownCallReviewV1,
  ): Promise<{ ok: true; value: number[] } | { ok: false; rejection: CoreRejection }> {
    const aliases: number[] = [];
    const readCtx = internalReadContext(ctx, current.ref.projectId, current.workspaceId);
    // Decision 75: one manifest read per round, reused by every item of that round.
    const displaysByRound = new Map<string, ReadResult<Map<number, 'full' | 'truncated' | 'unexpanded'>>>();
    for (const item of current.items) {
      const observed = item.observed;
      if (item.kind !== 'process' || observed.by !== 'review_round' || observed.roundRunRef === null) continue;
      if (deps.readReviewDisplays === undefined) {
        return { ok: false, rejection: rejected('unavailable', 'the review display reader is not wired') };
      }
      const roundKey = refKeyOf(observed.roundRunRef);
      let read = displaysByRound.get(roundKey);
      if (read === undefined) {
        read = await deps.readReviewDisplays(readCtx, { roundRunRef: observed.roundRunRef });
        displaysByRound.set(roundKey, read);
      }
      if (read.status === 'not_found') {
        return { ok: false, rejection: rejected('unavailable',
          `the preparing manifest of round ${observed.roundRunRef.runId} is not readable`) };
      }
      if (read.status === 'not_ready') {
        return { ok: false, rejection: rejected('incomplete', 'the preparing manifest is not readable at the required watermark') };
      }
      if (read.status === 'rejected') return { ok: false, rejection: read };
      const display = read.value.get(item.alias);
      if (display === undefined) {
        return { ok: false, rejection: rejected('unavailable',
          `the preparing manifest of round ${observed.roundRunRef.runId} is not readable`) };
      }
      if (display === 'truncated' || display === 'unexpanded') aliases.push(item.alias);
    }
    return { ok: true, value: aliases };
  }

  async function settleReview(
    ctx: CoreCallContext,
    request: Parameters<UnknownCallReviewPort['settleReview']>[1],
  ): Promise<WriteResult<UnknownCallReviewV1>> {
    if (ctx.principal.kind !== 'host') {
      return rejected('forbidden', 'settleReview is written by the Workflow (a host principal)');
    }
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input as unknown as Record<string, unknown>;
    const refProblemText = refProblem(input['reviewRef']);
    if (refProblemText !== null) return rejected('invalid', `settleReview ${refProblemText}`);
    const cause = input['cause'];
    if (cause !== 'round_ended' && cause !== 'review_unavailable') {
      return rejected('invalid', 'settleReview requires cause round_ended or review_unavailable');
    }
    const reviewRef = reviewRefOf({ ref: input['reviewRef'] as UnknownCallReviewRef })!;
    if (ctx.projectId !== reviewRef.projectId) return rejected('forbidden', 'the review belongs to another project');
    const identityKey = SETTLEMENT_IDENTITY_PREFIX + sha256Hex(canonicalJson({
      ref: fourReviewFields(reviewRef), cause, requestId: owned.requestId,
    } as never));
    const fingerprint = sha256Hex(canonicalJson({ ref: fourReviewFields(reviewRef), cause } as never));
    let existing;
    try {
      existing = await records.lookupCommit({ identityKey, fingerprint });
    } catch (error) {
      return rejected('unavailable', `the review receipt could not be looked up: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (existing.status === 'ready') return replayReview(existing.value, identityKey, fingerprint);
    if (existing.code !== 'not_found') return ownerWriteStoreFailureToRejection(existing);

    const refKey = unknownCallReviewRefKey(reviewRef);
    const loaded = await loadReview(refKey);
    if ('rejection' in loaded) return loaded.rejection;
    if ('notFound' in loaded) return rejected('not_found', 'the review record does not exist');
    const current = loaded.value;
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== current.workspaceId) {
      return rejected('forbidden', 'the review belongs to another workspace');
    }
    const ctxRevision = pinRevision(owned.expected, reviewRef);
    if (ctxRevision === null) return rejected('invalid', 'meta.expected must pin the review ref exactly once');

    let run: RunSnapshot | null = null;
    let fenceHumanOnly = false;
    if (current.activeRound !== null) {
      if (deps.reads === undefined) return rejected('unavailable', 'the review round Run reader is not wired');
      const read = await deps.reads.readExecution(
        internalReadContext(ctx, current.ref.projectId, current.workspaceId), current.activeRound.runRef);
      if (read.status === 'not_found') return rejected('source_stale', 'the review round Run does not exist');
      if (read.status === 'not_ready') return rejected('incomplete', 'the review round Run is not readable at the required watermark');
      if (read.status === 'rejected') return read;
      run = read.value.run;
      const intents = await readPointerIntents(records, [run]);
      if (intents.status !== 'ready') return rejected(intents.code, intents.reason);
      fenceHumanOnly = reworkFenceOf(run, intents.intents.get(run.ref.runId) ?? null) === 'human_only';
    }
    const activeRunEnded = run !== null && reviewRoundEndedKnown(run);
    const activeRunCompleted = activeRunEnded && run!.outcome === 'completed';
    if (current.activeRound !== null && !activeRunEnded) {
      return rejected('busy', 'the review round Run has not ended with a known result');
    }
    if (current.activeRound === null && cause !== 'review_unavailable') {
      return rejected('invalid', 'settleReview without an active round is the review_unavailable trigger (L16 3)');
    }

    const incomplete = await incompleteCommandAliases(ctx, current);
    if (!incomplete.ok) return incomplete.rejection;

    const goalRef = { aggregateType: 'Goal' as const, projectId: current.ref.projectId, goalId: current.ref.goalId };
    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') {
      return rejected('unavailable', `the review Goal is not readable: ${goalRead.reason}`);
    }
    const autonomy = readGoalSettings(goalRead.goal).autonomy;

    const firstUnfinished = !current.rounds.some(round =>
      round.stateEntry === current.stateEntry && round.result === 'unfinished');
    // UCR-06 only from the states that can take a first unfinished round;
    // `resolved`+held (UCR-08b) and any other status route to `settled`.
    const unfinishedEligible = current.status === 'pending_review' || current.status === 'awaiting_proposal';
    const event: Parameters<typeof transitionUnknownCallReview>[1] = current.activeRound === null
      ? { kind: 'settled' }
      : (unfinishedEligible && !activeRunCompleted && !fenceHumanOnly && firstUnfinished
        ? { kind: 'round_unfinished' } : { kind: 'settled' });

    const transitionCtx: UnknownCallReviewContextV1 = {
      expectedRevision: ctxRevision, updatedAt: now(), actor: { kind: 'system', id: 'unknown-call-review-settlement' },
      activeRunEnded, activeRunCompleted, fenceHumanOnly,
      reviewUnavailable: cause === 'review_unavailable',
      autonomy, incompleteCommandAliases: incomplete.value, missingSelfCheckAliases: [],
      originalRunSelected: false,
    };
    const decided = transitionUnknownCallReview(current, event, transitionCtx);
    if (!decided.ok) return rejected(decided.code, decided.detail);
    const writeEffect = decided.effects.find(effect => effect.kind === 'write_review');
    if (writeEffect === undefined || writeEffect.kind !== 'write_review') {
      return rejected('unavailable', 'the review machine produced no record');
    }
    // L7/M3: settlement is a must-write class and is always admitted.
    const admission = admitUnknownCallReview(writeEffect.review, { required: true });
    if (admission !== null) {
      return admission.ok ? rejected('unavailable', 'the settlement admission refused unexpectedly')
        : rejected(admission.code, admission.detail);
    }

    const guards = [{ refKey, expectedRevision: current.revision }];
    if (run !== null) guards.push({ refKey: refKeyOf(run.ref), expectedRevision: run.revision });
    // L16: the Goal is guarded at the revision whose autonomy was read.
    guards.push({ refKey: refKeyOf(goalRef), expectedRevision: goalRead.goal.revision });
    return commitReview({
      identityKey, fingerprint, requestId: owned.requestId, guards, next: writeEffect.review,
      change: event.kind === 'round_unfinished' ? 'round_unfinished' : 'settled',
      actor: { kind: 'system', id: `unknown-call-review:${reviewRef.runId}` }, signal: ctx.signal,
    });
  }

  // ---- holdReview / releaseHold (UCR-15 / UCR-14, L21) --------------------

  /**
   * D3/L21: reads the canonical Task projection and derives both the
   * "original Run is still the selected Run" fact and the guard set from the
   * SAME window (the TaskLease revision and the Run/TaskRequeue revisions ride
   * `guards`/`reworkGuards`). Never from the request.
   */
  async function readHoldFacts(
    ctx: CoreCallContext, current: UnknownCallReviewV1,
  ): Promise<{ ok: true; originalRunSelected: boolean; guards: { refKey: string; expectedRevision: number | null }[] }
    | { ok: false; rejection: CoreRejection }> {
    if (deps.taskProjection === undefined) {
      return { ok: false, rejection: rejected('unavailable',
        'the task projection reader for the hold guards is not wired') };
    }
    const projection = await deps.taskProjection(ctx, current.task);
    if (projection.status !== 'ready') {
      return { ok: false, rejection: rejected(projection.code, projection.reason) };
    }
    const facts: CanonicalTaskFacts = projection.value;
    const state = facts.byTaskId.get(current.task.taskId);
    if (state === undefined) {
      return { ok: false, rejection: rejected('unavailable', 'the hold projection did not read this Task') };
    }
    const runs = facts.runsByTaskId.get(current.task.taskId) ?? [];
    const selected = state.execution;
    const selectedIsOriginal = selected !== null && refKeyOf(selected) === refKeyOf(current.runRef);
    // L21: an existing TaskRequeue covering the origin Run still counts as
    // "the original Run is the selection" while no Run has consumed it.
    const coveringUnclaimed = (facts.requeuesByTaskId.get(current.task.taskId) ?? []).some(requeue =>
      requeue.ref.afterRunId === current.runRef.runId
      && !runs.some(run => run.requeueRef !== undefined && refKeyOf(run.requeueRef) === refKeyOf(requeue.ref)));
    return {
      ok: true,
      originalRunSelected: selectedIsOriginal || coveringUnclaimed,
      guards: [...facts.guards, ...facts.reworkGuards],
    };
  }

  async function holdReview(
    ctx: CoreCallContext,
    request: Parameters<UnknownCallReviewPort['holdReview']>[1],
  ): Promise<WriteResult<UnknownCallReviewV1>> {
    const principal = ctx.principal;
    if (principal.kind !== 'host' || principal.actor.kind !== 'human') {
      return rejected('forbidden', 'holdReview is a human operator action');
    }
    const operator = principal.actor;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input as unknown as Record<string, unknown>;
    const refProblemText = refProblem(input['reviewRef']);
    if (refProblemText !== null) return rejected('invalid', `holdReview ${refProblemText}`);
    const rawText = input['text'] === undefined ? null : input['text'];
    if (!(rawText === null || typeof rawText === 'string')) {
      return rejected('invalid', 'holdReview text must be a string or null');
    }
    const text = rawText as string | null;
    const reviewRef = reviewRefOf({ ref: input['reviewRef'] as UnknownCallReviewRef })!;
    if (ctx.projectId !== reviewRef.projectId) return rejected('forbidden', 'the review belongs to another project');
    const requestId = owned.requestId;
    const identityKey = HOLD_IDENTITY_PREFIX + sha256Hex(canonicalJson({
      ref: fourReviewFields(reviewRef), requestId,
    } as never));
    const fingerprint = sha256Hex(canonicalJson({ ref: fourReviewFields(reviewRef), text } as never));
    let existing;
    try {
      existing = await records.lookupCommit({ identityKey, fingerprint });
    } catch (error) {
      return rejected('unavailable', `the review receipt could not be looked up: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (existing.status === 'ready') return replayReview(existing.value, identityKey, fingerprint);
    if (existing.code !== 'not_found') return ownerWriteStoreFailureToRejection(existing);

    const refKey = unknownCallReviewRefKey(reviewRef);
    const loaded = await loadReview(refKey);
    if ('rejection' in loaded) return loaded.rejection;
    if ('notFound' in loaded) return rejected('not_found', 'the review record does not exist');
    const current = loaded.value;
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== current.workspaceId) {
      return rejected('forbidden', 'the review belongs to another workspace');
    }
    // UCR-15: the record@revision the caller read; the commit re-guards the
    // revision the owner actually read.
    const ctxRevision = pinRevision(owned.expected, reviewRef);
    if (ctxRevision === null) return rejected('invalid', 'meta.expected must pin the review ref exactly once');
    // L21: the same request replayed above; a NEW request on an already-held
    // record is `busy`, never a second disposition.
    if (current.status === 'resolved' && (current.disposition?.hold ?? null) === 'held'
      && ctxRevision === current.revision) {
      return rejected('busy', ALREADY_HELD_TEXT);
    }

    const projected = await readHoldFacts(ctx, current);
    if (!projected.ok) return projected.rejection;

    const transitionCtx: UnknownCallReviewContextV1 = {
      expectedRevision: ctxRevision, updatedAt: now(), actor: operator,
      activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
      autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
      originalRunSelected: projected.originalRunSelected,
    };
    const decided = transitionUnknownCallReview(current, {
      kind: 'hold_applied', answeredRevision: current.revision, text,
    }, transitionCtx);
    if (!decided.ok) return rejected(decided.code, decided.detail);
    const writeEffect = decided.effects.find(effect => effect.kind === 'write_review');
    if (writeEffect === undefined || writeEffect.kind !== 'write_review') {
      return rejected('unavailable', 'the review machine produced no record');
    }
    const admission = admitUnknownCallReview(writeEffect.review, { required: true });
    if (admission !== null) {
      return admission.ok ? rejected('unavailable', 'the hold admission refused unexpectedly')
        : rejected(admission.code, admission.detail);
    }
    return commitReview({
      identityKey, fingerprint, requestId,
      guards: [{ refKey, expectedRevision: current.revision }, ...projected.guards],
      next: writeEffect.review, change: 'hold_applied', actor: operator, signal: ctx.signal,
    });
  }

  async function releaseHold(
    ctx: CoreCallContext,
    request: Parameters<UnknownCallReviewPort['releaseHold']>[1],
  ): Promise<WriteResult<UnknownCallReviewV1>> {
    const principal = ctx.principal;
    if (principal.kind !== 'host' || principal.actor.kind !== 'human') {
      return rejected('forbidden', 'releaseHold is a human operator action');
    }
    const operator = principal.actor;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input as unknown as Record<string, unknown>;
    const refProblemText = refProblem(input['reviewRef']);
    if (refProblemText !== null) return rejected('invalid', `releaseHold ${refProblemText}`);
    const reviewRef = reviewRefOf({ ref: input['reviewRef'] as UnknownCallReviewRef })!;
    if (ctx.projectId !== reviewRef.projectId) return rejected('forbidden', 'the review belongs to another project');
    const requestId = owned.requestId;
    const identityKey = RELEASE_HOLD_IDENTITY_PREFIX + sha256Hex(canonicalJson({
      ref: fourReviewFields(reviewRef), requestId,
    } as never));
    const fingerprint = sha256Hex(canonicalJson({ ref: fourReviewFields(reviewRef) } as never));
    let existing;
    try {
      existing = await records.lookupCommit({ identityKey, fingerprint });
    } catch (error) {
      return rejected('unavailable', `the review receipt could not be looked up: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (existing.status === 'ready') return replayReview(existing.value, identityKey, fingerprint);
    if (existing.code !== 'not_found') return ownerWriteStoreFailureToRejection(existing);

    const refKey = unknownCallReviewRefKey(reviewRef);
    const loaded = await loadReview(refKey);
    if ('rejection' in loaded) return loaded.rejection;
    if ('notFound' in loaded) return rejected('not_found', 'the review record does not exist');
    const current = loaded.value;
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== current.workspaceId) {
      return rejected('forbidden', 'the review belongs to another workspace');
    }
    const ctxRevision = pinRevision(owned.expected, reviewRef);
    if (ctxRevision === null) return rejected('invalid', 'meta.expected must pin the review ref exactly once');
    // UCR-14/D3: release only once the round is settled.
    if (current.activeRound !== null && ctxRevision === current.revision) {
      return rejected('busy', ROUND_NOT_SETTLED_TEXT);
    }
    const transitionCtx: UnknownCallReviewContextV1 = {
      expectedRevision: ctxRevision, updatedAt: now(), actor: operator,
      activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
      autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
      originalRunSelected: false,
    };
    const decided = transitionUnknownCallReview(current, { kind: 'hold_released' }, transitionCtx);
    if (!decided.ok) return rejected(decided.code, decided.detail);
    const writeEffect = decided.effects.find(effect => effect.kind === 'write_review');
    if (writeEffect === undefined || writeEffect.kind !== 'write_review') {
      return rejected('unavailable', 'the review machine produced no record');
    }
    const admission = admitUnknownCallReview(writeEffect.review, { required: true });
    if (admission !== null) {
      return admission.ok ? rejected('unavailable', 'the release admission refused unexpectedly')
        : rejected(admission.code, admission.detail);
    }
    return commitReview({
      identityKey, fingerprint, requestId,
      guards: [{ refKey, expectedRevision: current.revision }],
      next: writeEffect.review, change: 'hold_released', actor: operator, signal: ctx.signal,
    });
  }

  // ---- applyDisposition (UCR-09..UCR-13, L19/L20) -------------------------

  /** One trusted answer-message read by ref (the synthetic answer the card's ① committed). */
  async function loadAnswerMessage(ref: SessionMessageRef):
  Promise<{ ok: true; value: SessionMessage } | { ok: false; rejection: CoreRejection }> {
    let batch;
    try {
      batch = await records.readMany([sessionMessageRefKey(ref)]);
    } catch (error) {
      return { ok: false, rejection: rejected('unavailable',
        `the answer message could not be read: ${error instanceof Error ? error.message : String(error)}`) };
    }
    if (batch.status !== 'ready') return { ok: false, rejection: ownerReadStoreFailureToRejection(batch) };
    const encoded = batch.value.records.find(record => record.refKey === sessionMessageRefKey(ref));
    if (encoded === undefined) return { ok: false, rejection: rejected('not_found', 'the answer message does not exist') };
    const decoded = decodeSessionMessageRecord(encoded);
    if (decoded.status !== 'decoded') {
      return { ok: false, rejection: rejected('invalid', `the answer message is not decodable: ${decoded.reason}`) };
    }
    return { ok: true, value: decoded.value };
  }

  async function applyDisposition(
    ctx: CoreCallContext,
    request: Parameters<UnknownCallReviewPort['applyDisposition']>[1],
  ): Promise<WriteResult<UnknownCallReviewV1>> {
    const principal = ctx.principal;
    if (principal.kind !== 'host') {
      return rejected('forbidden',
        'applyDisposition is written by the Host (the human operator or the Workflow automation)');
    }
    const operator = principal.actor;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input as unknown as Record<string, unknown>;
    const rawSource = input['source'];
    if (!isRecord(rawSource) || rawSource['kind'] !== 'unknown_call_review' || !nonEmpty(rawSource['key'])) {
      return rejected('invalid', 'applyDisposition requires an unknown_call_review decision source');
    }
    const source = rawSource as unknown as DecisionSourceV1;
    const identity = reviewCardIdentityOf(source);
    if (identity === null) {
      return rejected('invalid', 'the unknown_call_review source key is not a review card identity');
    }
    const rawSelection = input['selection'];
    if (!isRecord(rawSelection) || rawSelection['kind'] !== 'option' || !nonEmpty(rawSelection['optionId'])) {
      return rejected('invalid', 'a review disposition requires one of the card options');
    }
    const selection = rawSelection as unknown as DecisionSelectionV1;
    const answerRef = input['decisionMessageRef'];
    if (!sessionMessageRefComplete(answerRef)) {
      return rejected('invalid', 'applyDisposition requires the answer decisionMessageRef');
    }
    if (ctx.projectId !== identity.reviewRef.projectId) {
      return rejected('forbidden', 'the review belongs to another project');
    }
    if (answerRef.projectId !== ctx.projectId || (ctx.workspaceId !== undefined && answerRef.workspaceId !== ctx.workspaceId)) {
      return rejected('forbidden', 'the answer message belongs to another workspace');
    }
    const { identityKey, fingerprint, phase } =
      unknownCallReviewDispositionIdentity(source, selection, answerRef);
    if (identityKey.length === 0) {
      return rejected('invalid', 'the unknown_call_review source key is not a review card identity');
    }
    // L19: the reply is keyed by the answer message; replay wins before any
    // record, answer or Goal read, so a retry never re-judges the current state.
    let existing;
    try {
      existing = await records.lookupCommit({ identityKey, fingerprint });
    } catch (error) {
      return rejected('unavailable',
        `the disposition receipt could not be looked up: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (existing.status === 'ready') return replayReview(existing.value, identityKey, fingerprint);
    if (existing.code !== 'not_found') return ownerWriteStoreFailureToRejection(existing);

    // The answer is the saved synthetic response whose captured source is THIS
    // card at THIS revision (L19 guards).
    const answer = await loadAnswerMessage(answerRef);
    if (!answer.ok) return answer.rejection;
    const message = answer.value;
    if (message.decision?.syntheticAnswer !== true || message.status !== 'responded') {
      return rejected('invalid', 'the decisionMessageRef is not a synthetic responded answer');
    }
    if (message.response === null || !('decision' in message.response)) {
      return rejected('invalid', 'the answer message carries no user decision response');
    }
    const captured = message.response.decision;
    if (captured.source.key !== source.key) {
      return rejected('revision_conflict', 'the answer was taken against another review card', [
        { ref: identity.reviewRef, revision: identity.revision },
      ]);
    }
    // L19: the ANSWER's captured pins and content basis are the untrusted
    // caller's reference, never a replacement for the caller's copy. The two
    // must agree; the proof and the T02 check below use the CAPTURED copy.
    if (!Array.isArray(source.pins) || !isRecord(source.goalRef)
      || !Array.isArray(captured.source.pins) || !isRecord(captured.source.goalRef)
      || canonicalJson(captured.source.pins as unknown as JsonValue) !== canonicalJson(source.pins as unknown as JsonValue)
      || canonicalJson(captured.source.goalRef as unknown as JsonValue) !== canonicalJson(source.goalRef as unknown as JsonValue)) {
      return rejected('invalid', 'the disposition source disagrees with the answer\'s captured pins');
    }
    if (canonicalJson(captured.selection as unknown as JsonValue) !== canonicalJson(selection as unknown as JsonValue)) {
      return rejected('invalid', 'the answer selection disagrees with the disposition selection');
    }
    const capturedSource = captured.source;

    const refKey = unknownCallReviewRefKey(identity.reviewRef);
    const loaded = await loadReview(refKey);
    if ('rejection' in loaded) return loaded.rejection;
    if ('notFound' in loaded) return rejected('not_found', 'the review record does not exist');
    const current = loaded.value;
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== current.workspaceId) {
      return rejected('forbidden', 'the review belongs to another workspace');
    }
    // L19: the source revision and the caller pin must both be the CURRENT
    // record revision; the receipt lookup above already answered a replay.
    const pinnedRevision = pinRevision(owned.expected, identity.reviewRef);
    if (identity.revision !== current.revision || pinnedRevision !== identity.revision) {
      return rejected('revision_conflict', 'the review record moved since the card was answered', [
        { ref: structuredClone(current.ref), revision: current.revision },
      ]);
    }
    // L19: the phase is fixed by the selected option (approve/decline); each
    // phase has exactly one legal record status and its own card options.
    if (phase === 'approval') {
      if (current.status !== 'awaiting_approval') {
        return rejected('invalid', `a review approval is not legal from ${current.status}`);
      }
    } else if (current.status !== 'needs_decision') {
      return rejected('invalid', `a review disposition is not legal from ${current.status}`);
    }
    const optionId = rawSelection['optionId'] as string;
    if (!unknownCallReviewOptions(current).some(option => option.id === optionId)) {
      return rejected('invalid', 'the chosen option is not on the review card');
    }

    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: identity.reviewRef.projectId,
      goalId: identity.reviewRef.goalId };
    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') {
      return rejected(goalRead.code, goalRead.reason);
    }
    const goal = goalRead.goal;
    if (goal.desiredState !== 'active') {
      return rejected('busy', goal.desiredState === 'paused'
        ? 'the Goal is paused; the disposition waits for resume'
        : 'the Goal is not active; the disposition waits for resume');
    }
    // T02: the answer's captured content basis must still equal the Goal's
    // current content, otherwise the disposition is a revision conflict.
    const basis = (capturedSource.goalBases ?? [])[0];
    if (basis === undefined || !goalDecisionBasisMatches(basis, goal)) {
      return rejected('revision_conflict', UNKNOWN_CALL_REVIEW_T02_REASON);
    }

    // K3 L19/lead answer 6: the saved answer text is the ONLY source of the
    // disposition's 附言. An approval answer does NOT read or replace it: the
    // safer_method answer's text/annotations stay, and the approval answer's
    // own text stays in its Session message.
    let text: string | null = null;
    if (phase === 'disposition') {
      if (deps.readAnswerText === undefined) {
        return rejected('unavailable', 'the answer text reader is not wired');
      }
      const textRead = await deps.readAnswerText(ctx, { source: capturedSource, answerMessageRef: answerRef });
      if (textRead.status !== 'ready') {
        return textRead.status === 'rejected' ? textRead
          : rejected('unavailable', 'the saved answer text is not readable');
      }
      text = textRead.value;
    }

    // L19a: AFTER the replay lookup and the record/guards reads, compute the
    // real blocked commands. Any required read failure is `unavailable` and
    // writes nothing (UR7 retries); the write still happens when only the
    // static script expansion is unavailable.
    const blocked = await buildBlockedCommands(ctx, deps, current, phase, optionId);
    if (!blocked.ok) return blocked.rejection;

    const projected = await readGoalSettings(goal).autonomy;
    const transitionCtx: UnknownCallReviewContextV1 = {
      expectedRevision: identity.revision, updatedAt: now(), actor: operator,
      activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
      autonomy: projected, incompleteCommandAliases: [], missingSelfCheckAliases: [],
      blockedCommands: blocked.commands, originalRunSelected: false,
    };
    const approvalEvent = (): Extract<Parameters<typeof transitionUnknownCallReview>[1],
      { kind: 'approval_applied' }> => {
      const decision = optionId as 'approve' | 'decline';
      const approvedMethods = decision === 'approve'
        ? [...current.proposals].sort((left, right) => left.alias - right.alias)
          .map(proposal => ({ proposalId: proposal.proposalId, callId: proposal.callId,
            alias: proposal.alias, command: proposal.command, cwd: proposal.cwd }))
        : null;
      return { kind: 'approval_applied', decision, answerMessageRef: answerRef,
        answeredRevision: identity.revision, text: null, approvedMethods };
    };
    const decided = transitionUnknownCallReview(current, phase === 'approval' ? approvalEvent() : {
      kind: 'disposition_applied',
      choice: optionId as 'rerun_as_is' | 'safer_method' | 'skip_as_done' | 'handle_myself',
      answerMessageRef: answerRef, answeredRevision: identity.revision, text,
    }, transitionCtx);
    if (!decided.ok) return rejected(decided.code, decided.detail);
    const writeEffect = decided.effects.find(effect => effect.kind === 'write_review');
    if (writeEffect === undefined || writeEffect.kind !== 'write_review') {
      return rejected('unavailable', 'the review machine produced no record');
    }
    // L18/§2: a disposition's answer annotations ride into the disposition in
    // its order. An approval keeps the existing safer-method disposition, so it
    // must not replace them (lead answer 6).
    if (phase === 'disposition' && writeEffect.review.disposition !== null) {
      writeEffect.review.disposition = {
        ...writeEffect.review.disposition,
        annotations: dispositionAnnotations(captured.annotations),
      };
    }
    // L7/M3: the disposition is a must-write class and is always admitted.
    const admission = admitUnknownCallReview(writeEffect.review, { required: true });
    if (admission !== null) {
      return admission.ok ? rejected('unavailable', 'the disposition admission refused unexpectedly')
        : rejected(admission.code, admission.detail);
    }
    const proof: DecisionChangeProofV1 = {
      acknowledgementRef: structuredClone(answerRef),
      capturedPins: capturedSource.pins.map(pin => structuredClone(pin)),
      changes: [
        { before: { ref: structuredClone(current.ref), revision: current.revision },
          after: { ref: structuredClone(writeEffect.review.ref), revision: writeEffect.review.revision } },
      ],
      basisRebases: [],
    };
    return commitReview({
      identityKey, fingerprint, requestId: owned.requestId,
      // L19/§2: guard the record AND the Goal read in THIS call. The captured
      // Goal pin is not compared here: answer-while-paused/resume still applies.
      guards: [
        { refKey, expectedRevision: current.revision },
        { refKey: refKeyOf(goalRef), expectedRevision: goal.revision },
      ],
      next: writeEffect.review,
      change: phase === 'approval' ? 'approval_applied' : 'disposition_applied', actor: operator,
      signal: ctx.signal, proof,
    });
  }

  // ---- read port ----------------------------------------------------------

  async function readReview(
    ctx: CoreCallContext,
    input: { ref: UnknownCallReviewRef } | { runRef: RunRef },
  ): Promise<ReadResult<UnknownCallReviewV1>> {
    if (!isRecord(input)) return rejected('invalid', 'readReview requires { ref } or { runRef }');
    const ref = reviewRefOf(input);
    if (ref === null) return rejected('invalid', 'readReview requires exactly one complete ref or runRef');
    const bound = ctx as unknown as { projectId?: unknown };
    if (nonEmpty(bound.projectId) && bound.projectId !== ref.projectId) {
      return rejected('forbidden', 'the review belongs to another project');
    }
    const refKey = unknownCallReviewRefKey(ref);
    let batch;
    try {
      batch = await records.readMany([refKey]);
    } catch (error) {
      return rejected('unavailable', `the review could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (batch.status !== 'ready') return ownerReadStoreFailureToRejection(batch);
    const encoded = batch.value.records.find(record => record.refKey === refKey);
    if (encoded === undefined) return { status: 'not_found' };
    const decoded = decodeUnknownCallReview(encoded);
    if (decoded.status !== 'decoded') {
      return rejected('invalid', `the stored review is not decodable: ${decoded.reason}`);
    }
    return { status: 'ready', value: decoded.value };
  }

  return {
    readReview,
    async listReviews(
      ctx: CoreCallContext,
      input: {
        workspace: WorkspaceScope;
        filter: { goalRef: GoalRef; status: UnknownCallReviewStatusV1[] } | { open: 'yes' };
        page: { limit: number; cursor?: string };
      },
    ): Promise<ReadResult<{ items: UnknownCallReviewV1[]; nextCursor: string | null; readThrough: CommitCursor | null }>> {
      const raw = input as unknown as Record<string, unknown> | null | undefined;
      if (!isRecord(raw) || !isRecord(raw['workspace'])) return rejected('invalid', 'listReviews requires a workspace');
      const workspace = raw['workspace'];
      if (!nonEmpty(workspace['projectId']) || !nonEmpty(workspace['workspaceId'])) {
        return rejected('invalid', 'listReviews requires a complete WorkspaceScope');
      }
      if (nonEmpty(ctx.projectId) && ctx.projectId !== workspace['projectId']) {
        return rejected('forbidden', 'the review list belongs to another project');
      }
      if (ctx.workspaceId !== undefined && ctx.workspaceId !== workspace['workspaceId']) {
        return rejected('forbidden', 'the review list belongs to another workspace');
      }
      if (!isRecord(raw['page'])) return rejected('invalid', 'listReviews requires a page');
      const limit = raw['page']['limit'];
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
        return rejected('invalid', `page.limit must be an integer between 1 and ${String(MAX_PAGE_LIMIT)}`);
      }
      const cursor = raw['page']['cursor'];
      if (!(cursor === undefined || cursor === null || typeof cursor === 'string')) {
        return rejected('invalid', 'page.cursor must be a string or null');
      }
      if (lookups === null) return rejected('unavailable', 'the review indexes are not wired');
      const filter = raw['filter'];
      if (!isRecord(filter)) return rejected('invalid', 'listReviews requires a filter');
      const workspaceValues: LookupValue[] = [workspace['projectId'] as string, workspace['workspaceId'] as string];
      let index: string;
      let valueTuples: LookupValue[][];
      let taskId: string | null = null;
      if (isRecord(filter['goalRef'])) {
        const goalRef = filter['goalRef'];
        if (goalRef['aggregateType'] !== 'Goal' || !nonEmpty(goalRef['projectId']) || !nonEmpty(goalRef['goalId'])) {
          return rejected('invalid', 'listReviews requires a complete GoalRef');
        }
        if (goalRef['projectId'] !== workspace['projectId']) {
          return rejected('forbidden', 'the Goal belongs to another project');
        }
        if (filter['taskId'] !== undefined) {
          // K3 L19a (lead answer 4): one task's records over the goal index,
          // paged to the end; no new index.
          if (!nonEmpty(filter['taskId'])) return rejected('invalid', 'listReviews requires a non-empty taskId');
          taskId = filter['taskId'];
          index = K3_UCR_BY_GOAL_STATUS_LOOKUP;
          valueTuples = STATUSES.map(status => [...workspaceValues, goalRef['goalId'] as string, status]);
        } else {
          const statuses = filter['status'];
          if (!Array.isArray(statuses) || statuses.length === 0
            || !statuses.every(status => STATUSES.includes(status as UnknownCallReviewStatusV1))) {
            return rejected('invalid', 'listReviews requires a non-empty status list');
          }
          index = K3_UCR_BY_GOAL_STATUS_LOOKUP;
          // `status` is the index's last equality path, so one query per requested status.
          valueTuples = [...new Set(statuses as UnknownCallReviewStatusV1[])]
            .map(status => [...workspaceValues, goalRef['goalId'] as string, status]);
        }
      } else if (filter['open'] === 'yes') {
        index = K3_UCR_BY_WORKSPACE_OPEN_LOOKUP;
        valueTuples = [[...workspaceValues, 'yes']];
      } else {
        return rejected('invalid', 'listReviews filter is not recognized');
      }
      // One bounded keyset page per tuple after the refKey cursor, then merge
      // (newest revision per refKey), sort and take `limit`. The old full scan -
      // and with it the total cap and the "cursor outside this query" check - is
      // gone: L7 has no total cap. Every tuple must read at the same watermark,
      // or the page is retried; a mixed page is never returned.
      const cursorValue = typeof cursor === 'string' ? cursor : undefined;
      let pages: RecordLookupPage[] | null = null;
      let readThrough: CommitCursor | null = null;
      let unstable: CommitCursor | null = null;
      for (let attempt = 0; attempt < LOOKUP_WATERMARK_ATTEMPTS; attempt += 1) {
        const read: RecordLookupPage[] = [];
        for (const values of valueTuples) {
          let result;
          try {
            result = await lookups.lookup({ index, values, limit,
              ...(cursorValue === undefined ? {} : { after: cursorValue }) });
          } catch (error) {
            return rejected('unavailable', `the review list could not be read: ${error instanceof Error ? error.message : String(error)}`);
          }
          if (result.status !== 'ready') {
            return result.code === 'invalid'
              ? rejected('invalid', result.reason) : rejected('unavailable', `${result.code}: ${result.reason}`);
          }
          read.push(result.value);
        }
        const watermarks = read.map(page => page.readThrough ?? null);
        if (watermarks.every(watermark => watermark === watermarks[0])) {
          pages = read;
          readThrough = watermarks[0] ?? null;
          break;
        }
        unstable = maxCommitCursor(watermarks);
      }
      if (pages === null) {
        return { status: 'not_ready', observed: null,
          required: { kind: 'platform', cursor: unstable! } };
      }
      const newest = new Map<string, EncodedRecord>();
      for (const page of pages) {
        for (const record of page.records) {
          const existing = newest.get(record.refKey);
          if (existing === undefined || record.revision > existing.revision) newest.set(record.refKey, record);
        }
      }
      const merged = [...newest.values()].sort((left, right) => compareRefKeys(left.refKey, right.refKey));
      const decoded: UnknownCallReviewV1[] = [];
      for (const record of merged) {
        const value = decodeUnknownCallReview(record);
        if (value.status !== 'decoded') {
          return rejected('unavailable', `a stored review is not decodable: ${value.reason}`);
        }
        decoded.push(value.value);
      }
      // Fix the merged raw page WINDOW and its cursor BEFORE filtering by task.
      // Filtering first would let a cursor jump to another task's record outside
      // the window and skip a later target record. The window advances every page
      // even when it holds no target record (items may be empty with a non-null
      // cursor).
      const window = decoded.slice(0, limit);
      const items = taskId === null ? window : window.filter(record => record.task.taskId === taskId);
      const hasMore = decoded.length > limit || pages.some(page => page.next !== null);
      const lastWindow = window[window.length - 1];
      const nextCursor = hasMore && lastWindow !== undefined
        ? unknownCallReviewRefKey(lastWindow.ref) : null;
      return { status: 'ready', value: { items, nextCursor, readThrough } };
    },
    async listUnappliedAnswers(
      ctx: CoreCallContext,
      input: { reviewRef: UnknownCallReviewRef } | { goalRef: GoalRef },
    ): Promise<ReadResult<{
      answers: Array<{
        answerMessageRef: SessionMessageRef;
        phase: 'disposition' | 'approval';
        source: DecisionSourceV1;
        reviewRef: UnknownCallReviewRef;
      }>;
      readThrough: CommitCursor | null;
    }>> {
      const raw = input as unknown as Record<string, unknown> | null | undefined;
      if (!isRecord(raw) || (raw['reviewRef'] === undefined) === (raw['goalRef'] === undefined)) {
        return rejected('invalid', 'listUnappliedAnswers requires exactly one reviewRef or goalRef');
      }
      if (lookups === null) return rejected('unavailable', 'the decision answer indexes are not wired');
      let goalRef: GoalRef;
      let reviewRef: UnknownCallReviewRef | undefined;
      if (raw['reviewRef'] !== undefined) {
        if (refProblem(raw['reviewRef']) !== null) return rejected('invalid', 'listUnappliedAnswers requires a complete reviewRef');
        reviewRef = reviewRefOf({ ref: raw['reviewRef'] as UnknownCallReviewRef })!;
        if (nonEmpty(ctx.projectId) && ctx.projectId !== reviewRef.projectId) {
          return rejected('forbidden', 'the review belongs to another project');
        }
        goalRef = { aggregateType: 'Goal', projectId: reviewRef.projectId, goalId: reviewRef.goalId };
      } else {
        const ref = raw['goalRef'];
        if (!isRecord(ref) || ref['aggregateType'] !== 'Goal' || !nonEmpty(ref['projectId']) || !nonEmpty(ref['goalId'])) {
          return rejected('invalid', 'listUnappliedAnswers requires a complete GoalRef');
        }
        if (nonEmpty(ctx.projectId) && ctx.projectId !== ref['projectId']) {
          return rejected('forbidden', 'the Goal belongs to another project');
        }
        goalRef = { aggregateType: 'Goal', projectId: ref['projectId'] as string, goalId: ref['goalId'] as string };
      }
      const read = await readUnappliedAnswers({
        records: {
          lookup: (request) => lookups.lookup(request),
          lookupCommit: (request) => records.lookupCommit(request),
        },
      }, ctx, { kind: 'unknown_call_review', goalRef, ...(reviewRef === undefined ? {} : { reviewRef }) });
      if (read.status !== 'ready') return read;
      return { status: 'ready', value: {
        answers: read.value.answers.flatMap(answer => answer.kind === 'unknown_call_review'
          ? [{ answerMessageRef: answer.answerMessageRef, phase: answer.phase,
            source: answer.source, reviewRef: answer.reviewRef }]
          : []),
        readThrough: read.value.readThrough,
      } };
    },
    recordConclusion,
    recordProposal,
    settleReview,
    applyDisposition,
    async holdReview(
      ctx: CoreCallContext,
      request: Parameters<UnknownCallReviewPort['holdReview']>[1],
    ): Promise<WriteResult<UnknownCallReviewV1>> {
      return holdReview(ctx, request);
    },
    async releaseHold(
      ctx: CoreCallContext,
      request: Parameters<UnknownCallReviewPort['releaseHold']>[1],
    ): Promise<WriteResult<UnknownCallReviewV1>> {
      return releaseHold(ctx, request);
    },
  };
}