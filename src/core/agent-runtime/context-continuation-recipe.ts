import type { CommandRerunRequestV1 } from '../../contracts/command-rerun-request.js';
import {
  CONTINUATION_BRIEF_LIMITS, continuationBriefShapeProblem,
  type ContinuationBlockedCommandLineV1, type ContinuationBriefV1,
} from '../../contracts/continuation-brief.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../contracts/core/identity.js';
import type { PreparedTaskManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { TaskTriple } from '../../contracts/dispatch.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { SessionAnomalyAnchorRef } from '../../contracts/session-anomaly.js';
import type { UnknownCallReviewV1 } from '../../contracts/unknown-call-review.js';
import type { ContinuationBasis, TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import { orderBlockedCommands } from '../work-graph/tasks/blocked-command-order.js';
import {
  commandRerunRequestDeclaredForms, compareCommandRerunRequestNewestFirst,
} from '../work-graph/tasks/command-rerun-request-card.js';
import { readTaskReviews } from '../work-graph/tasks/task-review-reader.js';
import { unknownCallReviewRefKey } from '../work-graph/tasks/unknown-call-review-codecs.js';
import { assembleAnomalySection, assembleContinuationBrief, readPreviousTurn, type PreviousTurnFacts,
  type PreviousTurnRetry } from './continuation-brief-assembly.js';
import { messageOf } from '../../contracts/error-message.js';
import { rejected } from '../../contracts/core/rejections.js';
import { archiveOriginSkipsHistorySeed, runEnteredKernel, sessionBasisForContext } from './context-history-facts.js';
import { mapRead } from './context-support.js';
import type { ContextAssemblerDependencies } from './context-types.js';
import { briefWorkspaceFactsFor, readReviewCaptureChanges, unknownCallReviewFilesFor } from './context-workspace-facts.js';
import { createSessionHistoryCursorOwner } from './session-operations.js';

/**
 * K3 B3 item 7 / lead answer 5: the Task's blocked commands for the
 * continuation section. The Task's review records are read through the goal
 * index (`{ goalRef, taskId }`, paged to the end); the Task's requests through
 * `k3-crr-by-task` in exactly ceil(R/200) pages of 200. Each blocked alias is
 * joined with the newest request of that alias in that record (`used`/`closed`
 * render nothing) and every declared form across its requests in declaration
 * order, deduplicated. The result is ordered by (record createdAt, alias).
 * A read failure is `unavailable`; the port is optional only so old doubles
 * without blocked commands keep working, and a continuation whose afterRun
 * record itself blocked a command fails `unavailable` instead of dropping it.
 */
export async function readTaskBlockedCommands(
  deps: Pick<ContextAssemblerDependencies, 'unknownCallReviews' | 'commandRerunRequests'>,
  ctx: CoreCallContext,
  input: { task: TaskTriple; workspace: WorkspaceScope; afterRunBlocked: boolean;
    /** Rework 1 item 1: the ONE review-record read `prepare` already made. */
    reviews?: readonly UnknownCallReviewV1[] },
): Promise<ReadResult<ContinuationBlockedCommandLineV1[]>> {
  const reviews = deps.unknownCallReviews;
  const records: UnknownCallReviewV1[] = input.reviews === undefined ? [] : [...input.reviews];
  // A closed Task passes `[]`: it carries no blocked lines at all.
  if (input.reviews !== undefined && records.length === 0) return { status: 'ready', value: [] };
  if (input.reviews === undefined && reviews === undefined) {
    return input.afterRunBlocked
      ? rejected('unavailable', 'the blocked-command record reader is not wired')
      : { status: 'ready', value: [] };
  }
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: input.task.projectId, goalId: input.task.goalId };
  if (input.reviews === undefined) {
    // F-075: the ONE paging read (shared with prepare and the CRR owner).
    const read = await readTaskReviews(ctx, reviews,
      { goalRef, taskId: input.task.taskId, workspace: input.workspace });
    if (read.status !== 'ready') return read;
    records.push(...read.value);
  }
  const requestsRead = deps.commandRerunRequests;
  if (requestsRead === undefined) {
    return rejected('unavailable', 'the command-rerun-request read port is not wired');
  }
  const requests: CommandRerunRequestV1[] = [];
  const seenRequestCursors = new Set<string>();
  let requestCursor: string | undefined;
  for (let page = 0; page < 10_000; page += 1) {
    let read;
    try {
      read = await requestsRead.listRequests(ctx, {
        workspace: input.workspace,
        filter: { goalId: input.task.goalId, taskId: input.task.taskId },
        page: { limit: 200, ...(requestCursor === undefined ? {} : { cursor: requestCursor }) },
      });
    } catch (error) {
      return rejected('unavailable', `the command-rerun-request read failed: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') return mapRead(read);
    for (const request of read.value.items) {
      if (request.task.taskId === input.task.taskId) requests.push(request);
    }
    const next = read.value.nextCursor;
    if (next === null) break;
    if (seenRequestCursors.has(next)) return rejected('unavailable', 'the command-rerun-request pages did not advance');
    seenRequestCursors.add(next);
    requestCursor = next;
    if (page === 9_999) return rejected('unavailable', 'the command-rerun-request pages did not end');
  }
  // F-074: the WHOLE Task's blocked commands follow the ONE global flatten +
  // order (record createdAt, alias, ref-key tie-break), the SAME order the
  // recognizer uses; the per-record alias sort would disagree on a tie.
  const lines: ContinuationBlockedCommandLineV1[] = orderBlockedCommands(records.map(record => ({
    createdAt: record.createdAt,
    refKey: unknownCallReviewRefKey(record.ref),
    commands: record.blockedCommands.map(command => ({ alias: command.alias, value: { record, command } })),
  }))).map(({ record, command }) => {
    const forAlias = requests
      .filter((request) => request.reviewRef.runId === record.ref.runId && request.alias === command.alias);
    // F-098: the card module owns the ONE "newest request" order (createdAt
    // descending, then the request ref code-unit descending); the brief takes
    // the first of it, never a second locale/ascending copy.
    const newest = [...forAlias].sort(compareCommandRerunRequestNewestFirst)[0];
    const state = newest === undefined ? null
      : newest.state === 'pending' || newest.state === 'allowed' || newest.state === 'denied'
        || newest.state === 'denied_final' ? newest.state : null;
    // The card's ONE declaration-order/dedup rule, so the brief and the card
    // cannot disagree on the forms either.
    return { alias: command.alias, reviewRunId: record.ref.runId, requestState: state,
      declaredForms: commandRerunRequestDeclaredForms(forAlias) };
  });
  return { status: 'ready', value: lines };
}

export async function assembleBriefForContext(
  deps: ContextAssemblerDependencies, now: () => string, ctx: CoreCallContext, record: TaskExecutionRecord,
  taskReviews?: readonly UnknownCallReviewV1[],
): Promise<{ ok: true; brief: ContinuationBriefV1; sessionBasis: PreparedTaskManifestV1['sessionBasis'] | null;
    anomalyAnchorRefs: SessionAnomalyAnchorRef[] | null }
  | { ok: false; rejection: CoreRejection }> {
  const readBasis = deps.executions.readContinuationBasis;
  if (readBasis === undefined || deps.kernelStores === undefined) {
    return { ok: false, rejection: rejected('unsupported', 'a requeue Run needs the continuation basis reader and the Kernel stores') };
  }
  let basis: ReadResult<ContinuationBasis>;
  try { basis = await readBasis.call(deps.executions, ctx, { runRef: record.run.ref }); }
  catch (error) {
    if (ctx.signal.aborted) return { ok: false, rejection: rejected('cancelled', 'the preparation was cancelled during the continuation basis read') };
    return { ok: false, rejection: rejected('unavailable', `the continuation basis read failed: ${messageOf(error)}`) };
  }
  if (ctx.signal.aborted) return { ok: false, rejection: rejected('cancelled', 'the preparation was cancelled during the continuation basis read') };
  if (basis.status !== 'ready') return { ok: false, rejection: mapRead(basis) };
  const previous = basis.value.previous;
  const fallbackFacts = basis.value.factsChain.at(-1)?.run ?? previous;
  const owner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores,
    ...(deps.kernel === undefined ? {} : { kernel: deps.kernel }) });
  const sameSessionFor = (candidate: TaskExecutionRecord): boolean =>
    record.outbox.claim.sessionRef.projectId === candidate.outbox.claim.sessionRef.projectId
    && record.outbox.claim.sessionRef.sessionId === candidate.outbox.claim.sessionRef.sessionId;
  // D2/D12 (L9): walk the requeue chain nearest-first (`previous` then its ancestors) and pick the
  // first Run that provably entered the Kernel, instead of jumping to the oldest locator-less
  // ancestor. An entered Run whose read still says `not_entered` does not stop the walk; a `retry`
  // does. `factsHops` is the selected candidate's index (previous → 0, factsChain[0] → 1, ...).
  const candidates: TaskExecutionRecord[] = [previous, ...basis.value.factsChain.map((hop) => hop.run)];
  let facts = fallbackFacts;
  let factsHops = basis.value.factsChain.length;
  let turn: PreviousTurnFacts | PreviousTurnRetry | undefined;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (!runEnteredKernel(candidate.run)) continue;
    const read = await readPreviousTurn(owner, candidate, ctx.signal, { sameSession: sameSessionFor(candidate) });
    if (read.kernel === 'not_entered') continue;
    facts = candidate;
    factsHops = index;
    turn = read;
    break;
  }
  if (turn === undefined) {
    // No candidate proved entry: today's fallback source and hop count.
    turn = await readPreviousTurn(owner, fallbackFacts, ctx.signal, { sameSession: sameSessionFor(fallbackFacts) });
  }
  const truncated = facts !== previous && facts.run.executionHistory === undefined
    && basis.value.factsChain.length >= CONTINUATION_BRIEF_LIMITS.factsFromHops && facts.run.requeueRef !== undefined;
  if (turn.kernel === 'retry') return { ok: false, rejection: rejected(turn.code, `the previous Turn is not readable now: ${turn.reason}`) };
  const workspaceOutcome = await briefWorkspaceFactsFor(deps, now, record, ctx.signal);
  if (workspaceOutcome.status !== 'ready') {
    return { ok: false, rejection: rejected('cancelled', 'the preparation was cancelled during the workspace facts read') };
  }
  const workspace = workspaceOutcome.value;
  // §4.1 T10 (slice 1): an archive-origin ordinary claim is a NEW pickup, never the old line's continuation.
  let sessionBasis: PreparedTaskManifestV1['sessionBasis'] | null;
  if (archiveOriginSkipsHistorySeed(basis.value.requeue)) {
    sessionBasis = null;
  } else {
    const sessionOutcome = await sessionBasisForContext(deps, record, basis.value, ctx.signal);
    if (sessionOutcome.status !== 'ready') {
      return { ok: false, rejection: rejected('cancelled', 'the preparation was cancelled during the session basis read') };
    }
    sessionBasis = sessionOutcome.value;
  }
  const source = basis.value.requeue.historySource;
  const seededFrom = sessionBasis === null || sessionBasis === undefined || sessionBasis.throughPosition === null || source === null
    ? null
    : { sessionRef: { projectId: source.sessionRef.projectId, sessionId: source.sessionRef.sessionId }, throughPosition: sessionBasis.throughPosition };
  // Slice 1 §2.7: this Task's not-yet-picked-up anchors, bounded to the earliest eight.
  const anomalies = assembleAnomalySection(basis.value.pendingAnomalies ?? []);
  // K3 L20/L6: the afterRun's review record and the read-only file sides its diff needs.
  const unknownCallReview = basis.value.unknownCallReview ?? null;
  const unknownCallReviewFiles = await unknownCallReviewFilesFor(deps, record, previous, unknownCallReview, ctx.signal);
  if (unknownCallReviewFiles === 'cancelled') {
    return { ok: false, rejection: rejected('cancelled', 'the preparation was cancelled during the review file read') };
  }
  const unknownCallReviewCaptureChanges = await readReviewCaptureChanges(deps, unknownCallReview);
  // K3 B3 item 7: the Task's blocked commands, including earlier records when the
  // afterRun has none. A read failure is `unavailable`, never a silent drop.
  const blockedRead = await readTaskBlockedCommands(deps, ctx, {
    task: record.run.task,
    workspace: { projectId: record.run.ref.projectId, workspaceId: record.run.workspaceSnapshot.workspaceId },
    afterRunBlocked: (unknownCallReview?.blockedCommands ?? []).length > 0,
    ...(taskReviews === undefined ? {} : { reviews: taskReviews }),
  });
  if (blockedRead.status !== 'ready') return { ok: false, rejection: mapRead(blockedRead) };
  const brief = assembleContinuationBrief({
    basis: basis.value, factsRecord: facts, factsHops, factsTruncated: truncated,
    turn, workspace, claimSessionRef: record.outbox.claim.sessionRef, seededFrom, anomalies,
    unknownCallReview,
    ...(unknownCallReviewFiles === null ? {} : { unknownCallReviewFiles }),
    ...(unknownCallReview === null ? {} : { unknownCallReviewCapture: unknownCallReview.workspace }),
    ...(unknownCallReviewCaptureChanges === null ? {} : { unknownCallReviewCaptureChanges }),
    ...(blockedRead.value.length === 0 ? {} : { blockedCommands: blockedRead.value }),
  });
  const problem = continuationBriefShapeProblem(brief);
  if (problem !== null) return { ok: false, rejection: rejected('unavailable', `the assembled continuation brief is malformed: ${problem}`) };
  const anomalyAnchorRefs = anomalies === null ? null : anomalies.anchors.map((anchor) => anchor.ref);
  return { ok: true, brief, sessionBasis, anomalyAnchorRefs };
}
