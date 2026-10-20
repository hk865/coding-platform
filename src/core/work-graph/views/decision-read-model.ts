/**
 * Slice 5 §4.1/§4.2/F42: the ONE read-only decision aggregator.
 *
 * It joins the formal sources with the same canonical card identity
 * (`contracts/goal-decisions.ts:decisionSourceKey`), delegates the conflict
 * source to F43 and the notices to the per-category `DecisionNoticeSourcePort`
 * readers (F44 for `automatic_rework`), pages each source continuously and
 * merges them through `views/notice-position.ts`. It only reads: it never
 * creates a Card table, never fabricates a count/watermark and never lets an
 * unshown source item cross the page.
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { UserMessageResponseV1 } from '../../../contracts/core/session-message.js';
import { isUserMessageRecipient } from '../../../contracts/core/session-message.js';
import { isRecord } from '../../../contracts/validation/common.js';
import {
  decisionSourceKey,
  type DecisionSourceIdentityV1,
  type DecisionSourceV1,
  type NoticeCategoryV1,
  type NoticePositionV1,
} from '../../../contracts/goal-decisions.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { EncodedRecord } from '../../record-store/ports.js';
import type {
  DecisionCardSourcePort,
  DecisionCardV1,
  DecisionNoticeSourcePort,
  DecisionQueueReadV1,
  DecisionReadPort,
  DecisionSourceAttempt,
  S5RecordPort,
  GoalConflictReadV1,
  GoalDecisionCauseReadV1,
  NoticeDisplayTokenPort,
  NoticeItemV1,
  NoticePositionComparatorPort,
  NoteDecisionCardFactsV1,
  NoteDecisionSourcePort,
} from '../model/decision-contracts.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import type { UnknownCallReviewReadPort } from '../model/unknown-call-review-contracts.js';
import type { UnknownCallReviewV1 } from '../../../contracts/unknown-call-review.js';
import type { CommandRerunRequestV1 } from '../../../contracts/command-rerun-request.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import {
  commandRerunRequestCardFacts, commandRerunRequestCardIdentity, commandRerunRequestCardWorkspaceOf,
  type CommandRerunRequestCardFactsV1, type CommandRerunRequestCardSourceDependencies,
} from '../tasks/command-rerun-request-card.js';
import type { PlanProposal } from '../model/plan-contracts.js';
import {
  decodePlanProposalOrigin,
  decodePlanProposalRecord,
  S5_PLAN_PROPOSAL_BY_REQUEST,
} from '../persistence/plan-record-codecs.js';
import { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';
import {
  decodeGoalSnapshot,
  decodeWorkspaceSnapshot,
  effectiveWorkspaceDecisionSettings,
} from '../persistence/record-codecs.js';
import {
  decodeSessionMessageRecord,
  S2A_USER_MESSAGES_LOOKUP,
  sessionMessageRefKey,
} from '../sessions/message-record-codecs.js';
import type { GoalDecisionCauseReader } from '../tasks/goal-decision-reader.js';
import type { PlanningQuestionReader } from '../tasks/planning-question-reader.js';
import { enumerateClosedGoalCandidates, enumerateGoalCandidates, readGoalPlanWindow,
  readTaskClosure, terminalProposalOf, type TaskClosureV1 } from '../tasks/plan-readers.js';
import { findAnswerMessage } from '../tasks/decision-answer-lookup.js';
import { UNKNOWN_CALL_REVIEW_FILE_OBJECTS_MAX, unknownCallReviewCardFacts, unknownCallReviewTargetPaths,
  type UnknownCallReviewCardFactsV1 } from '../tasks/unknown-call-review-card.js';
import { readReviewTargetDigests } from '../tasks/unknown-call-review-target-digests.js';
import type { WorkspaceToolsPort } from '../../workspace/ports.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import {
  atLeastCursorResult,
  goalDecisionBasis,
  listWorkspaceGoals,
  lookupAll,
  readGoalTerminalState,
  readWatermark,
  storeFailureToRejection,
  workspaceScopeProblem,
  type DecisionReadRecordsPort,
  type GoalConflictAssemblerPort,
  type GoalTerminalState,
} from './goal-conflicts.js';
import { compareNoticePositions, mergeNoticePages, type NoticeSourceItemsV1 } from './notice-position.js';
import { groupNotices, seenThroughOfNotices } from './notice-grouping.js';

/**
 * The narrow readers, the shared Store seam and the two injected helpers. A
 * missing `kind`/`category` reader is reported as `not_available`; the read
 * model never substitutes an available empty source for it.
 */
export type DecisionReadModelDependencies = {
  records: DecisionReadRecordsPort;
  cardSources: readonly DecisionCardSourcePort[];
  noticeSources: readonly DecisionNoticeSourcePort[];
  conflicts: GoalConflictAssemblerPort;
  positions: NoticePositionComparatorPort;
  displayTokens: NoticeDisplayTokenPort;
};

type CardAction = DecisionCardV1['actions'][number];

const CARD_KINDS: readonly DecisionSourceV1['kind'][] = [
  'message', 'goal_cause', 'candidate', 'note_review', 'planning_question', 'goal_conflict', 'message_release',
  'unknown_call_review', 'command_rerun_request',
];
const NOTICE_CATEGORIES: readonly NoticeCategoryV1[] = [
  'member_notice', 'second_expiry', 'handoff', 'note_review', 'undelivered_reply', 'automatic_rework', 'continuation',
];
const CARD_ACTIONS: readonly CardAction[] = ['answer', 'ask_secretary', 'apply', 'record_application',
  'adopt', 'regenerate', 'abandon', 'adopt_architecture', 'adopt_completion_policy'];

/** §4.1 line 772: one source page is at most 200 items (2A L10 keeps the page size). */
const SOURCE_PAGE_LIMIT = 200;

/** §4.1 line 772 / §3.3: one read window that keeps moving is retried at most 4 times. */
const WINDOW_MAX_ATTEMPTS = 4;
/** Internal sentinel: this attempt did not observe one stable ledger window. */
const WINDOW_MOVED: unique symbol = Symbol('decision-read-model.window-moved');

/**
 * `enumerateGoalCandidates` (§2.4) declares the full write-capable Goal port
 * although it only reads. `views/` holds the read-only slice
 * (`DecisionReadRecordsPort`), so the ONE call is narrowed here instead of
 * widening the read model's dependency with write methods.
 */
const enumerateCandidates = enumerateGoalCandidates as unknown as (
  records: DecisionReadRecordsPort,
  goalRef: GoalRef,
) => ReturnType<typeof enumerateGoalCandidates>;

/**
 * The sibling closed-history enumeration declares the same full write-capable
 * Goal port; the read model narrows it the same way instead of widening its
 * dependency with write methods.
 */
const enumerateClosedCandidates = enumerateClosedGoalCandidates as unknown as (
  records: DecisionReadRecordsPort,
  goalRef: GoalRef,
) => ReturnType<typeof enumerateClosedGoalCandidates>;

/** §4.1/§4.3: a card's stable page point, ordered exactly like the output list. */
type CardSeekV1 = { rank: 0 | 1 | 2; goal: string; kind: string; key: string };

/**
 * §2.5/§4.1: the queue continuation. Cards continue from a stable card point and
 * notices from their per-category positions, so `markNoticesSeen` shrinking the
 * source list can never shift the cursor onto a later, unseen item.
 */
type QueuePageCursorV1 = {
  v: 1;
  card?: CardSeekV1;
  notices?: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
};

/** Builds the read model; the factory itself never throws. */
export function createDecisionReadModel(
  deps: DecisionReadModelDependencies,
): DecisionReadPort {
  return {
    async queryDecisionQueue(ctx, input): Promise<ReadResult<DecisionQueueReadV1>> {
      return queryDecisionQueue(deps, ctx, input);
    },
    async readDecisionCard(ctx, input): Promise<ReadResult<DecisionCardV1>> {
      return readDecisionCard(deps, ctx, input.source);
    },
    async queryGoalConflicts(ctx, input): Promise<ReadResult<GoalConflictReadV1>> {
      return deps.conflicts.queryGoalConflicts(ctx, input);
    },
  };
}

// -------------------------------------------------------------------------- //
// §4.2 source adapters                                                        //
// -------------------------------------------------------------------------- //

/** §4.2 source 2 adapter: wraps `createGoalDecisionCauseReader` into a card source. */
export function createGoalCauseCardSource(reader: GoalDecisionCauseReader): DecisionCardSourcePort {
  return {
    kind: 'goal_cause',
    needsGoal: true,
    async readPage(ctx, input) {
      if (input.goalRef === undefined) {
        return { status: 'ready', value: { availability: 'available', items: [], nextCursor: null, sourceCursor: null } };
      }
      const result = await reader.readGoalDecisionCauses(ctx, { goalRef: input.goalRef,
        ...(input.page.atLeastCursor === undefined ? {} : { atLeastCursor: input.page.atLeastCursor }) });
      if (result.status !== 'ready') return result;
      return { status: 'ready', value: { availability: 'available',
        items: result.value.map(goalCauseCard), nextCursor: null, sourceCursor: null } };
    },
  };
}

/** §4.2 source 5 adapter: wraps `createPlanningQuestionReader` into a card source. */
export function createPlanningQuestionCardSource(reader: PlanningQuestionReader): DecisionCardSourcePort {
  return {
    kind: 'planning_question',
    needsGoal: true,
    async readPage(ctx, input) {
      if (input.goalRef === undefined) {
        return { status: 'ready', value: { availability: 'available', items: [], nextCursor: null, sourceCursor: null } };
      }
      return reader.readPlanningQuestions(ctx, { goalRef: input.goalRef, page: input.page });
    },
  };
}

/**
 * §4.2 U7: the generic adapter for a collection-backed card source. A source
 * registers its collection read, its stable key, its projection, its close
 * check and its direct by-key read; this adapter owns the once-per-attempt
 * assembly (`attempt.cache`), the offset paging and the closed-card shape, so
 * adding the next source is a registration, not a copy of the note source.
 */
export type CardCollectionSourceSpec<T> = {
  kind: DecisionSourceV1['kind'];
  needsGoal: boolean;
  readCollection(ctx: CoreCallContext, input: { workspace: WorkspaceScope; goalRef: GoalRef;
    attempt?: DecisionSourceAttempt }): Promise<ReadResult<readonly T[]>>;
  /** The item's canonical `decisionSourceKey(identity)`. */
  keyOf(item: T): string;
  project(item: T, goalRef: GoalRef, goal: GoalSnapshot | null): DecisionCardV1;
  /** `null` = the item is still open; a reason closes it. */
  closedReasonOf(item: T): DecisionCardV1['closedReason'];
  readByKey(ctx: CoreCallContext, input: { workspace: WorkspaceScope; source: DecisionSourceV1 }):
    Promise<ReadResult<{ item: T } | { closed: DecisionCardV1['closedReason'] } | null>>;
  /** The maximum items one OFFSET page serves (1..200, default SOURCE_PAGE_LIMIT). */
  pageLimit?: number;
};

/**
 * The Goal content basis is optional card content (a missing/damaged Goal has
 * no basis). The adapter takes the read as its own seam so its spec shape stays
 * the verifier's: the note registration passes `readGoalForBasis`, the generic
 * unit needs none.
 */
export type CardCollectionGoalReader = (goalRef: GoalRef) => Promise<GoalSnapshot | null>;

/**
 * §4.2 U7: build a `DecisionCardSourcePort` from a collection spec. `readPage`
 * answers an empty page without a Goal, assembles the collection and the Goal
 * ONCE per window attempt, applies `closedReasonOf` to every item, and serves
 * numeric-offset pages (SOURCE_PAGE_LIMIT fallback). `readByKey` never pages: it
 * delegates one item read, then projects it with one Goal read.
 */
export function createCollectionCardSource<T>(
  spec: CardCollectionSourceSpec<T>,
  readGoal: CardCollectionGoalReader = async () => null,
): DecisionCardSourcePort {
  const emptyPage = () => ({
    status: 'ready' as const,
    value: { availability: 'available' as const, items: [] as DecisionCardV1[], nextCursor: null, sourceCursor: null },
  });
  return {
    kind: spec.kind,
    needsGoal: spec.needsGoal,
    async readPage(ctx, input) {
      if (input.goalRef === undefined) return emptyPage();
      const goalRef = input.goalRef;
      // L11: assemble the Goal's whole card set once per window attempt.
      const cache = input.page.attempt?.cache;
      const cacheKey = canonicalJson({ kind: spec.kind, projectId: input.workspace.projectId,
        workspaceId: input.workspace.workspaceId, goalId: goalRef.goalId } as unknown as JsonValue);
      let assembled = cache?.get(cacheKey) as DecisionCardV1[] | undefined;
      if (assembled === undefined) {
        const listed = await spec.readCollection(ctx, { workspace: input.workspace, goalRef,
          ...(input.page.attempt === undefined ? {} : { attempt: input.page.attempt }) });
        if (listed.status !== 'ready') return listed;
        const goal = await readGoal(goalRef);
        assembled = listed.value.map((item) => {
          const closedReason = spec.closedReasonOf(item);
          if (closedReason === null) return spec.project(item, goalRef, goal);
          const card = spec.project(item, goalRef, goal);
          return closedCollectionCard({ ...card.source, key: spec.keyOf(item) }, closedReason);
        });
        cache?.set(cacheKey, assembled);
      }
      const offset = input.page.cursor === undefined ? 0 : Number(input.page.cursor);
      const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
      const requested = Number.isSafeInteger(input.page.limit) && input.page.limit > 0 ? input.page.limit : SOURCE_PAGE_LIMIT;
      const configured = spec.pageLimit !== undefined && Number.isSafeInteger(spec.pageLimit)
        && spec.pageLimit >= 1 && spec.pageLimit <= SOURCE_PAGE_LIMIT ? spec.pageLimit : SOURCE_PAGE_LIMIT;
      const limit = spec.pageLimit === undefined ? requested : Math.min(requested, configured);
      const end = Math.min(assembled.length, start + limit);
      return { status: 'ready', value: { availability: 'available', items: assembled.slice(start, end),
        nextCursor: end < assembled.length ? String(end) : null, sourceCursor: null } };
    },
    async readByKey(ctx, input) {
      const read = await spec.readByKey(ctx, { workspace: input.workspace, source: input.source });
      if (read.status !== 'ready') return read;
      if (read.value === null) return { status: 'ready', value: null };
      if ('closed' in read.value) {
        return { status: 'ready', value: closedCollectionCard(input.source, read.value.closed) };
      }
      const goal = await readGoal(input.source.goalRef);
      return { status: 'ready', value: spec.project(read.value.item, input.source.goalRef, goal) };
    },
  };
}

/**
 * §4.2 source 4 adapter: the note-review cards, registered on the generic
 * collection adapter (U7). The injected notes owner returns the
 * already-authorized `NoteDecisionCardFactsV1` set; `project` is the note card
 * and `readNoteDecision` is the direct by-key read, so a card beyond the first
 * source page is never lost and `readDecisionCard` never pages.
 */
export type NoteReviewCardSourceDependencies = {
  records: DecisionReadRecordsPort;
  noteDecisions: NoteDecisionSourcePort;
};

export function createNoteReviewCardSource(deps: NoteReviewCardSourceDependencies): DecisionCardSourcePort {
  return createCollectionCardSource<NoteDecisionCardFactsV1>({
    kind: 'note_review',
    needsGoal: true,
    readCollection: (ctx, { goalRef, attempt }) => deps.noteDecisions.readNoteDecisions(ctx, { goalRef,
      ...(attempt === undefined ? {} : { attempt }) }),
    keyOf: (card) => card.cardId,
    project: noteReviewCard,
    closedReasonOf: () => null,
    async readByKey(ctx, { source }) {
      const identity = parseIdentity(source.key);
      if (identity === null || identity.kind !== 'note_review') {
        return { status: 'rejected', code: 'invalid', reason: 'a note_review source key is not a NoteHead pin' };
      }
      const ref = identity.note.ref as { noteId?: string };
      if (typeof ref.noteId !== 'string') {
        return { status: 'rejected', code: 'invalid', reason: 'a note_review source key carries no NoteHead ref' };
      }
      const read = await deps.noteDecisions.readNoteDecision(ctx, { pin: { noteId: ref.noteId, version: identity.note.revision } });
      if (read.status !== 'ready') return read;
      if (read.value.card === null) {
        return read.value.closedReason === null ? { status: 'ready', value: null }
          : { status: 'ready', value: { closed: read.value.closedReason } };
      }
      // M1: the card's note must belong to the Goal the request names; a note of
      // another Goal in the same Workspace is never that Goal's card.
      if (read.value.card.goalId !== source.goalRef.goalId) return { status: 'ready', value: null };
      return { status: 'ready', value: { item: read.value.card } };
    },
  }, (goalRef) => readGoalForBasis(deps.records, goalRef));
}

function noteReviewCard(card: NoteDecisionCardFactsV1, goalRef: GoalRef, goal: GoalSnapshot | null): DecisionCardV1 {
  return {
    cardKey: card.cardId,
    source: { kind: 'note_review', key: card.cardId, goalRef: { ...goalRef },
      pins: card.pins.map((pin) => structuredClone(pin)),
      goalBases: goal === null ? [] : [goalDecisionBasis(goal)] },
    state: 'waiting_answer', goalRef: { ...goalRef }, senderSessionRef: null, requestRef: null,
    objects: card.objects, options: card.options, answerMessageRef: null, answer: null, application: null,
    candidateStatus: null, staleReason: null, closedReason: null, readOnly: false, actions: ['answer'],
  };
}

/**
 * The ONE canonical Task-closure read the card
 * sources share. `readTaskClosure` derives satisfied/cancelled/superseded from
 * the canonical Task facts (never only the Plan disposition); its rejection is
 * passed through unchanged, so a read failure is `unavailable` and never
 * "still active". The attempt cache is keyed by Task, so several cards of one
 * Task share the same read and no card adds a second read.
 */
async function readTaskClosureCached(
  records: S5RecordPort,
  goalRef: GoalRef,
  taskId: string,
  cache: Map<string, unknown> | undefined,
): Promise<ReadResult<TaskClosureV1>> {
  const key = `task-closure:${canonicalJson(goalRef as unknown as JsonValue)}:${taskId}`;
  const cached = cache?.get(key) as ReadResult<TaskClosureV1> | undefined;
  if (cached !== undefined) return cached;
  const result = await readTaskClosure(records, goalRef, taskId);
  cache?.set(key, result);
  return result;
}

/**
 * The `unknown_call_review` card source, registered on the generic
 * collection adapter. It reads the Goal's `needs_decision`/`awaiting_approval`
 * records to the end, the Goal's current plan window ONCE per attempt (the Goal
 * basis), the ONE canonical Task closure once per Task and each
 * original Run revision ONCE per attempt, then projects the open cards.
 * `readByKey` reads the review by ref directly (no paging), rejects a foreign
 * Goal and serves a closed projection as history.
 */
export type UnknownCallReviewCardSourceDependencies = {
  records: S5RecordPort;
  reviews: Pick<UnknownCallReviewReadPort, 'listReviews' | 'readReview'>;
  /**
   * The workspace owner's read seam for each target path's current
   * digest. Optional so existing constructions keep compiling; absent, every
   * digest is `null`.
   */
  workspace?: Pick<WorkspaceToolsPort, 'readWorkspace'>;
  /** The maximum items one offset page serves (1..200, default SOURCE_PAGE_LIMIT). */
  pageLimit?: number;
};

const UNKNOWN_CALL_REVIEW_CARD_STATUSES = ['needs_decision', 'awaiting_approval'] as const;

export function createUnknownCallReviewCardSource(
  deps: UnknownCallReviewCardSourceDependencies,
): DecisionCardSourcePort {
  const base = createCollectionCardSource<UnknownCallReviewCardFactsV1>({
    kind: 'unknown_call_review',
    needsGoal: true,
    pageLimit: deps.pageLimit ?? SOURCE_PAGE_LIMIT,
    async readCollection(ctx, { workspace, goalRef, attempt }) {
      const cache = attempt?.cache;
      const planKey = `unknown-call-review-plan:${canonicalJson(goalRef as unknown as JsonValue)}`;
      let window = cache?.get(planKey) as Awaited<ReturnType<typeof readGoalPlanWindow>> | undefined;
      if (window === undefined) {
        window = await readGoalPlanWindow(deps.records, goalRef);
        cache?.set(planKey, window);
      }
      if (window.status !== 'ready') {
        return window.status === 'rejected' ? window : { status: 'rejected', code: 'unavailable', reason: 'the review Goal window is not readable' };
      }
      const records: UnknownCallReviewV1[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await deps.reviews.listReviews(ctx, { workspace,
          filter: { goalRef, status: [...UNKNOWN_CALL_REVIEW_CARD_STATUSES] },
          page: { limit: SOURCE_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) } });
        if (page.status !== 'ready') return page;
        records.push(...page.value.items);
        if (page.value.nextCursor === null) break;
        cursor = page.value.nextCursor;
      }
      const targetPaths = [...new Set(records.flatMap(record =>
        unknownCallReviewTargetPaths(record).slice(0, UNKNOWN_CALL_REVIEW_FILE_OBJECTS_MAX)))];
      const fileDigests = await readReviewTargetDigests(ctx, deps.workspace, targetPaths, cache);
      const cards: UnknownCallReviewCardFactsV1[] = [];
      for (const record of records) {
        const runKey = `unknown-call-review-run:${canonicalJson(record.runRef as unknown as JsonValue)}`;
        let run = cache?.get(runKey) as import('../../../contracts/dispatch.js').RunSnapshot | undefined;
        if (run === undefined) {
          let encoded;
          try {
            encoded = await readOne(deps.records, canonicalJson(record.runRef as unknown as JsonValue));
          } catch (error) {
            return storeFailureToRejection(error as { code: string; reason: string });
          }
          if (encoded === null) {
            return { status: 'rejected', code: 'unavailable',
              reason: `the original Run ${JSON.stringify(record.runRef)} of the review is missing` };
          }
          const decoded = decodeRun(encoded);
          if (!decoded.ok) return { status: 'rejected', code: 'unavailable', reason: decoded.reason };
          run = decoded.value;
          cache?.set(runKey, run);
        }
        const closure = await readTaskClosureCached(deps.records, goalRef, record.task.taskId, cache);
        if (closure.status !== 'ready') return closure;
        cards.push(unknownCallReviewCardFacts({ record, goal: window.goal, run,
          taskActive: !closure.value.closed, fileDigests }));
      }
      return { status: 'ready', value: cards };
    },
    keyOf: (facts) => facts.source.key,
    project: (facts, goalRef) => unknownCallReviewCard(facts, goalRef),
    closedReasonOf: (facts) => facts.closedReason,
    async readByKey(ctx, { source }) {
      const identity = parseIdentity(source.key);
      if (identity === null || identity.kind !== 'unknown_call_review') {
        return { status: 'rejected', code: 'invalid', reason: 'an unknown_call_review source key is not a review identity' };
      }
      if (identity.reviewRef.projectId !== source.goalRef.projectId
        || identity.reviewRef.goalId !== source.goalRef.goalId) {
        return { status: 'ready', value: null };
      }
      const read = await deps.reviews.readReview(ctx, { ref: identity.reviewRef });
      if (read.status === 'not_found') return { status: 'ready', value: null };
      if (read.status !== 'ready') return read;
      const record = read.value;
      // A moved record is a stale source key, not the current card.
      if (record.revision !== identity.revision) return { status: 'ready', value: null };
      if (record.task.goalId !== source.goalRef.goalId) return { status: 'ready', value: null };
      const window = await readGoalPlanWindow(deps.records, source.goalRef);
      if (window.status !== 'ready') return window;
      let encoded;
      try {
        encoded = await readOne(deps.records, canonicalJson(record.runRef as unknown as JsonValue));
      } catch (error) {
        return storeFailureToRejection(error as { code: string; reason: string });
      }
      if (encoded === null) return { status: 'ready', value: null };
      const decoded = decodeRun(encoded);
      if (!decoded.ok) return { status: 'rejected', code: 'unavailable', reason: decoded.reason };
      const closure = await readTaskClosureCached(deps.records, source.goalRef, record.task.taskId, undefined);
      if (closure.status !== 'ready') return closure;
      const fileDigests = await readReviewTargetDigests(ctx, deps.workspace,
        unknownCallReviewTargetPaths(record).slice(0, UNKNOWN_CALL_REVIEW_FILE_OBJECTS_MAX));
      const facts = unknownCallReviewCardFacts({ record, goal: window.goal, run: decoded.value,
        taskActive: !closure.value.closed, fileDigests });
      if (facts.closedReason !== null) return { status: 'ready', value: { closed: facts.closedReason } };
      return { status: 'ready', value: { item: facts } };
    },
  }, (goalRef) => readGoalForBasis(deps.records, goalRef));
  return {
    ...base,
    async readPage(ctx, input) {
      const result = await base.readPage(ctx, input);
      if (result.status !== 'ready') return result;
      // B1 ruling 5: a projected waiting card with no answer action keeps the
      // source not available. `awaiting_approval` no longer hits this: B2 gives
      // it approve/decline and `actions: ['answer']`.
      const unavailable = result.value.items.some((card) => card.state === 'waiting_answer' && card.actions.length === 0);
      return unavailable
        ? { ...result, value: { ...result.value, availability: 'not_available' as const } }
        : result;
    },
  };
}

/**
 * The `command_rerun_request` card source, registered on the generic
 * collection adapter. It pages the Goal's `pending` requests to the end
 * (`k3-crr-by-goal-state`), then re-derives each card from the request, its
 * review record, the original Run and the Goal's current plan window. The card
 * is NEVER filtered by autonomy: the human must know and allow the rerun
 * (B2-07). `readByKey` reads the request directly, rejects a moved revision
 * (a stale source key) and serves `closed` for a non-pending request or an
 * ended Task (B2-08).
 */
export function createCommandRerunRequestCardSource(
  deps: CommandRerunRequestCardSourceDependencies,
): DecisionCardSourcePort {
  const goalRefOf = (request: CommandRerunRequestV1): GoalRef => ({
    aggregateType: 'Goal', projectId: request.ref.projectId, goalId: request.ref.goalId,
  });

  /** Every request of one Task (all states) through the per-task index, paged to the end. */
  async function aliasRequestsOf(
    ctx: CoreCallContext, request: CommandRerunRequestV1,
    cache: Map<string, unknown> | undefined,
  ): Promise<ReadResult<CommandRerunRequestV1[]>> {
    const key = `crr-task-requests:${request.ref.projectId}:${request.ref.goalId}:${request.ref.taskId}`;
    const cached = cache?.get(key) as CommandRerunRequestV1[] | undefined;
    if (cached !== undefined) return { status: 'ready', value: cached };
    const requests: CommandRerunRequestV1[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await deps.requests.listRequests(ctx, {
        workspace: commandRerunRequestCardWorkspaceOf(request),
        filter: { goalId: request.ref.goalId, taskId: request.ref.taskId },
        page: { limit: SOURCE_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
      });
      // F-076/F-101: the page result keeps a cancellation/rejection; only a
      // non-ready read with no rejection (today none reach this call) keeps the
      // old `unavailable` answer.
      if (page.status !== 'ready') {
        return page.status === 'rejected' ? page
          : { status: 'rejected', code: 'unavailable', reason: 'the alias requests are not readable' };
      }
      requests.push(...page.value.items);
      if (page.value.nextCursor === null) break;
      cursor = page.value.nextCursor;
    }
    cache?.set(key, requests);
    return { status: 'ready', value: requests };
  }

  /** The whole card, from the real request/review/run/window/Kernel facts. */
  async function cardOf(
    ctx: CoreCallContext, request: CommandRerunRequestV1,
    cache: Map<string, unknown> | undefined,
  ): Promise<ReadResult<CommandRerunRequestCardFactsV1>> {
    const goalRef = goalRefOf(request);
    const windowKey = `crr-plan:${canonicalJson(goalRef as unknown as JsonValue)}`;
    let window = cache?.get(windowKey) as Awaited<ReturnType<typeof readGoalPlanWindow>> | undefined;
    if (window === undefined) {
      window = await readGoalPlanWindow(deps.records, goalRef);
      cache?.set(windowKey, window);
    }
    if (window.status !== 'ready') {
      return window.status === 'rejected' ? window
        : { status: 'rejected', code: 'unavailable', reason: 'the request Goal window is not readable' };
    }
    const closure = await readTaskClosureCached(deps.records, goalRef, request.ref.taskId, cache);
    if (closure.status !== 'ready') return closure;
    const taskActive = !closure.value.closed;
    const reviewKey = `crr-review:${canonicalJson(request.reviewRef as unknown as JsonValue)}`;
    let review = cache?.get(reviewKey) as UnknownCallReviewV1 | undefined;
    if (review === undefined) {
      const read = await deps.reviews.readReview(ctx, { ref: request.reviewRef });
      if (read.status !== 'ready') {
        return read.status === 'rejected' ? read
          : { status: 'rejected', code: 'unavailable', reason: 'the request review record is not readable' };
      }
      review = read.value;
      cache?.set(reviewKey, review);
    }
    if (review.revision !== undefined && review.revision < 1) {
      return { status: 'rejected', code: 'unavailable', reason: 'the request review record is damaged' };
    }
    const blocked = review.blockedCommands.find(entry =>
      entry.reviewRunId === request.reviewRef.runId && entry.alias === request.alias);
    if (blocked === undefined) {
      return { status: 'rejected', code: 'unavailable',
        reason: `the blocked command #${String(request.alias)} of ${request.reviewRef.runId} is not recorded` };
    }
    const executionKey = `crr-execution:${canonicalJson(review.runRef as unknown as JsonValue)}`;
    let execution = cache?.get(executionKey) as Awaited<ReturnType<ExecutionReadPort['readExecution']>> | undefined;
    if (execution === undefined) {
      execution = await deps.executions.readExecution(ctx, review.runRef);
      cache?.set(executionKey, execution);
    }
    if (execution.status !== 'ready') {
      return execution.status === 'rejected' ? execution
        : { status: 'rejected', code: 'unavailable', reason: 'the original Run is not readable' };
    }
    const factsRead = await deps.readKernelCommandFacts(ctx, {
      session: execution.value.session, calls: [blocked.kernelCallRef],
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    });
    if (factsRead.status !== 'ready') {
      return factsRead.status === 'rejected' ? factsRead
        : { status: 'rejected', code: 'unavailable',
          reason: 'the blocked command text is not readable from the Kernel' };
    }
    const blockedText = factsRead.value.get(blocked.kernelCallRef.callId)?.command ?? null;
    if (blockedText === null) {
      return { status: 'rejected', code: 'unavailable',
        reason: 'the blocked command text is not readable from the Kernel' };
    }
    const siblings = await aliasRequestsOf(ctx, request, cache);
    if (siblings.status !== 'ready') return siblings;
    return { status: 'ready', value: commandRerunRequestCardFacts({
      request, review, goal: window.goal, blockedCommandText: blockedText,
      aliasRequests: siblings.value, taskActive,
    }) };
  }

  const base = createCollectionCardSource<CommandRerunRequestCardFactsV1>({
    kind: 'command_rerun_request',
    needsGoal: true,
    pageLimit: deps.pageLimit ?? SOURCE_PAGE_LIMIT,
    async readCollection(ctx, { workspace, goalRef, attempt }) {
      const requests: CommandRerunRequestV1[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await deps.requests.listRequests(ctx, { workspace,
          filter: { goalRef, state: 'pending' },
          page: { limit: SOURCE_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) } });
        if (page.status !== 'ready') return page;
        requests.push(...page.value.items);
        if (page.value.nextCursor === null) break;
        cursor = page.value.nextCursor;
      }
      const cards: CommandRerunRequestCardFactsV1[] = [];
      for (const request of requests) {
        const built = await cardOf(ctx, request, attempt?.cache);
        if (built.status !== 'ready') return built;
        cards.push(built.value);
      }
      return { status: 'ready', value: cards };
    },
    keyOf: (facts) => facts.source.key,
    project: (facts, goalRef) => commandRerunRequestCard(facts, goalRef),
    closedReasonOf: (facts) => facts.closedReason,
    async readByKey(ctx, { source }) {
      const identity = commandRerunRequestCardIdentity(source);
      if (identity === null) {
        return { status: 'rejected', code: 'invalid', reason: 'a command_rerun_request source key is not a request identity' };
      }
      if (identity.requestRef.projectId !== source.goalRef.projectId
        || identity.requestRef.goalId !== source.goalRef.goalId) {
        return { status: 'ready', value: null };
      }
      const read = await deps.requests.readRequest(ctx, { ref: identity.requestRef });
      if (read.status === 'not_found') return { status: 'ready', value: null };
      if (read.status !== 'ready') return read;
      const request = read.value;
      // A moved request is a stale source key, not the current card.
      if (request.revision !== identity.revision) return { status: 'ready', value: null };
      if (request.state !== 'pending') return { status: 'ready', value: { closed: 'source_resolved' } };
      const built = await cardOf(ctx, request, undefined);
      if (built.status !== 'ready') return built;
      if (built.value.closedReason !== null) return { status: 'ready', value: { closed: built.value.closedReason } };
      return { status: 'ready', value: { item: built.value } };
    },
  }, (goalRef) => readGoalForBasis(deps.records, goalRef));
  return base;
}

function commandRerunRequestCard(facts: CommandRerunRequestCardFactsV1, goalRef: GoalRef): DecisionCardV1 {
  return {
    cardKey: facts.source.key, source: facts.source,
    state: 'waiting_answer', goalRef: { ...goalRef }, senderSessionRef: null, requestRef: null,
    objects: facts.objects, options: facts.options, answerMessageRef: null, answer: null, application: null,
    candidateStatus: null, staleReason: null, closedReason: null,
    readOnly: false, actions: ['answer'],
  };
}

function unknownCallReviewCard(facts: UnknownCallReviewCardFactsV1, goalRef: GoalRef): DecisionCardV1 {
  return {
    cardKey: facts.source.key, source: facts.source,
    state: 'waiting_answer', goalRef: { ...goalRef }, senderSessionRef: null, requestRef: null,
    objects: facts.objects, options: facts.options, answerMessageRef: null, answer: null, application: null,
    candidateStatus: null, staleReason: null, closedReason: null,
    readOnly: false, actions: ['answer'],
  };
}

/** The one closed-card shape of a collection source (no live options/actions). */
function closedCollectionCard(source: DecisionSourceV1, closedReason: DecisionCardV1['closedReason']): DecisionCardV1 {
  return {
    cardKey: source.key,
    source: { ...source, pins: source.pins.map((pin) => structuredClone(pin)) },
    state: 'closed', goalRef: { ...source.goalRef }, senderSessionRef: null, requestRef: null,
    objects: [], options: [], answerMessageRef: null, answer: null, application: null,
    candidateStatus: null, staleReason: null, closedReason, readOnly: true, actions: [],
  };
}

/** The Goal basis is optional content; a missing/damaged Goal simply has no basis. */
async function readGoalForBasis(records: DecisionReadRecordsPort, goalRef: GoalRef): Promise<GoalSnapshot | null> {
  try {
    const record = await readOne(records, canonicalJson(goalRef as unknown as JsonValue));
    if (record === null) return null;
    const decoded = decodeGoalSnapshot(record);
    return decoded.status === 'decoded' ? decoded.value : null;
  } catch {
    return null;
  }
}

/**
 * Maps one formal `GoalDecisionCauseReadV1` onto the card `actions` vocabulary.
 * The reader's `action` is the §3.2 autonomy vocabulary; the adoption entries
 * of the missing formal pointers surface by the concrete cause code.
 */
function goalCauseActions(cause: GoalDecisionCauseReadV1): DecisionCardV1['actions'] {
  const actions: CardAction[] = ['answer'];
  const runtime = cause.action as string | null;
  if (runtime !== null) {
    if (CARD_ACTIONS.includes(runtime as CardAction)) actions.push(runtime as CardAction);
    else if (runtime === 'adopt_first_plan') actions.push('adopt');
  }
  if (cause.code.includes('architecture')) actions.push('adopt_architecture');
  if (cause.code.includes('completion') || cause.code.includes('policy')) actions.push('adopt_completion_policy');
  return [...new Set(actions)];
}

function goalCauseCard(cause: GoalDecisionCauseReadV1): DecisionCardV1 {
  return {
    cardKey: cause.source.key, source: cause.source, state: 'waiting_answer', goalRef: cause.source.goalRef,
    senderSessionRef: null, requestRef: null, objects: cause.objects, options: [],
    answerMessageRef: null, answer: null, application: null, candidateStatus: null, staleReason: null,
    closedReason: null, readOnly: false, actions: goalCauseActions(cause),
  };
}

// -------------------------------------------------------------------------- //
// The queue                                                                   //
// -------------------------------------------------------------------------- //

type QueueInput = Parameters<DecisionReadPort['queryDecisionQueue']>[1];

async function queryDecisionQueue(
  deps: DecisionReadModelDependencies,
  ctx: CoreCallContext,
  input: QueueInput,
): Promise<ReadResult<DecisionQueueReadV1>> {
  // §4.1 line 772 / §3.3: one stable window, at most 4 attempts. A window that
  // keeps moving is `unavailable`, never stamped with a later watermark.
  for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
    const result = await readDecisionQueueWindow(deps, ctx, input);
    if (result !== WINDOW_MOVED) return result;
  }
  return { status: 'rejected', code: 'unavailable',
    reason: `the decision queue did not yield one stable read window within ${String(WINDOW_MAX_ATTEMPTS)} attempts` };
}

async function readDecisionQueueWindow(
  deps: DecisionReadModelDependencies,
  ctx: CoreCallContext,
  input: QueueInput,
): Promise<ReadResult<DecisionQueueReadV1> | typeof WINDOW_MOVED> {
  const workspace = input.workspace;
  // §8.2 scope row: the explicit Workspace (and GoalRef) are compared with the
  // bound scope BEFORE any read; a foreign request is `forbidden`.
  const scopeProblem = workspaceScopeProblem(ctx, workspace);
  if (scopeProblem !== null) return scopeProblem;
  if (input.goalRef !== undefined && input.goalRef.projectId !== ctx.projectId) {
    return { status: 'rejected', code: 'forbidden', reason: 'the requested goal is outside the bound call scope' };
  }
  const wantsCards = input.sections.some((section) => section !== 'notices');
  const wantsNotices = input.sections.includes('notices');
  const wantsGoals = wantsCards || input.goalRef !== undefined;
  const limit = Number.isSafeInteger(input.page.limit) && input.page.limit >= 1 && input.page.limit <= 100
    ? input.page.limit : 50;

  const injectedCards = new Map(deps.cardSources.map((source) => [source.kind, source]));
  const injectedNotices = new Map(deps.noticeSources.map((source) => [source.category, source]));
  // 2A L11/P1: one attempt-scoped cache, shared by every source this attempt
  // reads. A source assembles its whole collection once and serves its pages
  // from it; the object is dropped when this window attempt ends.
  const attempt: DecisionSourceAttempt = { cache: new Map() };
  // §2.6/§4.2: the advertised capability starts from the wired adapter and is
  // then DOWNGRADED by what a real read reports. An injected adapter whose
  // provider answers `not_available` must never be advertised as available.
  const capabilities = new Map<string, 'available' | 'not_available'>();
  for (const kind of CARD_KINDS) capabilities.set(kind, cardSourceAvailability(kind, injectedCards));
  for (const category of NOTICE_CATEGORIES) capabilities.set(category, noticeSourceAvailability(category, injectedNotices));

  // §4.1 line 772 / §3.3: the read window is fixed FIRST, at the first Goal
  // listing's horizon; `sourceCursor` is that window, never a later watermark.
  // `watermark` keeps the max horizon OBSERVED by the individual source reads
  // so a read that crossed the window is detected too.
  let fixedWindow: CommitCursor | null = null;
  let watermark: CommitCursor | null = null;

  // ---- goals (the real workspace set) --------------------------------------
  let goals: GoalSnapshot[] = [];
  if (wantsGoals) {
    try {
      const listed = await listWorkspaceGoals(deps.records, workspace);
      // 2A L3: the Goal listing is paged to the end; no Goal count and no
      // truncation can reject the whole queue any more.
      goals = listed.goals;
      fixedWindow = later(fixedWindow, listed.watermark);
      watermark = later(watermark, listed.watermark);
    } catch (error) {
      return storeFailureToRejection(error as { code: string; reason: string });
    }
  }
  const goalByKey = new Map(goals.map((goal) => [canonicalJson(goal.ref as unknown as JsonValue), goal]));
  let scopedGoals: GoalSnapshot[];
  if (input.goalRef === undefined) {
    scopedGoals = goals;
  } else {
    // §8.2 scope row / §4.1: an explicit `goalRef` is resolved by reading the
    // Goal itself, exactly like `readDecisionCard`. A Goal of another
    // Workspace in the SAME project is `forbidden`; only a real absence is
    // `not_found` (a foreign project was already rejected above). The bound
    // Workspace's listing alone must never decide this.
    const explicit = await resolveExplicitGoal(deps.records, ctx, input.goalRef);
    if (explicit.status !== 'ready') return explicit;
    scopedGoals = [explicit.value];
    goalByKey.set(canonicalJson(explicit.value.ref as unknown as JsonValue), explicit.value);
  }

  // A notices-only query has no Goal listing, so its window is the current
  // ledger horizon; a card-bearing query already fixed it at the listing.
  if (fixedWindow === null && !wantsGoals) {
    const windowRead = await readWatermark(deps.records);
    if (windowRead.status !== 'ready') return windowRead;
    fixedWindow = windowRead.value;
  }

  // ---- messages (source 1 and the built-in member notifications) ------------
  let messages: SessionMessage[] = [];
  if (wantsCards || wantsNotices) {
    try {
      const loaded = await loadWorkspaceMessages(deps.records, workspace);
      messages = loaded.messages;
      watermark = later(watermark, loaded.watermark);
    } catch (error) {
      return storeFailureToRejection(error as { code: string; reason: string });
    }
  }

  const collected = new Map<string, DecisionCardV1>();
  const add = (card: DecisionCardV1): void => {
    if (input.goalRef !== undefined && !cardInScope(card, input.goalRef)) return;
    const existing = collected.get(card.source.key);
    collected.set(card.source.key, existing === undefined ? card : mergeCards(existing, card));
  };

  // ---- source 1 message + the synthetic answers of the other cards ----------
  if (wantsCards) {
    for (const message of messages) {
      if (!isUserMessageRecipient(message.recipient) || message.decision === undefined) continue;
      if (message.decision.syntheticAnswer) {
        if (message.status !== 'responded' || !isUserDecisionResponse(message.response)) continue;
        add(syntheticAnswerCard(message));
      } else if (message.intent === 'decision_request') {
        add(messageCard(message.decision.source, message));
      }
    }
  }

  // ---- source 3 candidate --------------------------------------------------
  if (wantsCards) {
    for (const goal of scopedGoals) {
      // §2.4/§4.2: the reader-backed enumeration of one Goal's live candidates
      // (a discarded window/truncation is a real failure, never an empty page).
      let candidateRead: Awaited<ReturnType<typeof enumerateGoalCandidates>>;
      try {
        candidateRead = await enumerateCandidates(deps.records, goal.ref);
      } catch (error) {
        return storeFailureToRejection(error as { code: string; reason: string });
      }
      if (candidateRead.status !== 'ready') return candidateRead;
      watermark = later(watermark, candidateRead.readThrough);
      for (const proposal of candidateRead.proposals) {
        const card = candidateCard(proposal, goal);
        if (card !== null) add(card);
      }
    }
    // §4.2 source 3 CLOSED history: `accepted`/`not_adopted` request candidates
    // keep the same per-request card identity as their live card, so an answered
    // card merges with its closure instead of vanishing from `history`.
    for (const goal of scopedGoals) {
      let closedRead: Awaited<ReturnType<typeof enumerateClosedGoalCandidates>>;
      try {
        closedRead = await enumerateClosedCandidates(deps.records, goal.ref);
      } catch (error) {
        return storeFailureToRejection(error as { code: string; reason: string });
      }
      if (closedRead.status !== 'ready') return closedRead;
      watermark = later(watermark, closedRead.readThrough);
      for (const proposal of closedRead.proposals) {
        const card = candidateCard(proposal, goal);
        if (card !== null) add(card);
      }
    }
  }

  // ---- injected card sources (goal_cause, planning_question, future ones) --
  if (wantsCards) {
    for (const source of deps.cardSources) {
      if (source.kind === 'message' || source.kind === 'candidate' || source.kind === 'goal_conflict') continue;
      const targets: (GoalRef | undefined)[] = source.needsGoal
        ? (scopedGoals.length > 0 ? scopedGoals.map((goal) => goal.ref) : (input.goalRef === undefined ? [] : [input.goalRef]))
        : [input.goalRef];
      for (const goalRef of targets) {
        // §4.1 line 772 / §4.2 line 821: every adapter receives the same
        // `atLeastCursor` and is paged to the end (2A L6/L8); a discarded
        // `nextCursor` would silently drop real items.
        let cursor: string | undefined;
        for (;;) {
          const result = await source.readPage(ctx, { workspace,
            ...(goalRef === undefined ? {} : { goalRef }),
            page: { limit: SOURCE_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }),
              ...(input.page.atLeastCursor === undefined ? {} : { atLeastCursor: input.page.atLeastCursor }),
              attempt } });
          if (result.status !== 'ready') return result;
          observeAvailability(capabilities, source.kind, result.value.availability);
          if (result.value.availability !== 'available') break;
          for (const card of result.value.items) add(card);
          const next = result.value.nextCursor;
          if (next === null) break;
          cursor = next;
        }
      }
    }
  }

  // ---- source 6 goal_conflict ----------------------------------------------
  if (wantsCards && !injectedCards.has('goal_conflict')) {
    const conflicts = await deps.conflicts.queryGoalConflicts(ctx, { workspace,
      ...(input.page.atLeastCursor === undefined ? {} : { atLeastCursor: input.page.atLeastCursor }) });
    if (conflicts.status !== 'ready') return conflicts;
    for (const card of conflicts.value.cards) add(card);
  }

  // ---- finalize cards against each Goal's current control state ------------
  // §4.3 line 829: a conflict card must be judged against BOTH Goals of the
  // unordered pair, not only the larger-key one it is attributed to.
  const terminalByGoalKey = new Map<string, GoalTerminalState>();
  for (const goal of goals) {
    const terminalRead = await readGoalTerminalState(deps.records, goal);
    if (terminalRead.status !== 'ready') return terminalRead;
    terminalByGoalKey.set(canonicalJson(goal.ref as unknown as JsonValue), terminalRead.value);
  }
  const finalized: DecisionCardV1[] = [];
  for (const raw of collected.values()) {
    const goal = goalByKey.get(canonicalJson(raw.goalRef as unknown as JsonValue)) ?? null;
    let source: DecisionSourceV1;
    try {
      source = await refreshSourcePins(deps.records, raw.source);
    } catch (error) {
      return storeFailureToRejection(error as { code: string; reason: string });
    }
    finalized.push(finalizeCard({ ...raw, source }, goal, cardTerminalState(raw, goal, terminalByGoalKey)));
  }
  const waiting = sortCards(finalized.filter((card) => card.state === 'waiting_answer'));
  const answered = sortCards(finalized.filter((card) => card.state === 'answered_pending_application'));
  const history = sortCards(finalized.filter((card) => card.state === 'applied'
    || card.state === 'answered_no_application' || card.state === 'closed'));

  // ---- notices -------------------------------------------------------------
  const allNotices: NoticeItemV1[] = [];
  const noticeCounts: Partial<Record<NoticeCategoryV1, number>> = {};
  if (wantsNotices) {
    try {
      const savedSeen = await readSavedNoticeSeen(deps.records, workspace);
      if (savedSeen.status !== 'ready') return savedSeen;
      const requested = input.categories !== undefined && input.categories.length > 0 ? input.categories : NOTICE_CATEGORIES;
      const pages: NoticeSourceItemsV1[] = [];
      for (const category of requested) {
        const provider = injectedNotices.get(category) ?? (category === 'member_notice'
          ? builtInMemberNoticeSource(deps.records, messages) : undefined);
        if (provider === undefined) continue;
        // Same §4.1/§4.2 read as the card sources: continuous pages to the end
        // (2A L6/L8), the shared `atLeastCursor`, and no discarded `nextCursor`.
        let cursor: string | undefined;
        let count = 0;
        for (;;) {
          const result = await provider.readPage(ctx, { workspace,
            ...(input.goalRef === undefined ? {} : { goalRef: input.goalRef }),
            ...(savedSeen.value[category] === undefined ? {} : { after: savedSeen.value[category] }),
            page: { limit: SOURCE_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }),
              ...(input.page.atLeastCursor === undefined ? {} : { atLeastCursor: input.page.atLeastCursor }),
              attempt } });
          if (result.status !== 'ready') return result;
          observeAvailability(capabilities, category, result.value.availability);
          if (result.value.availability !== 'available') break;
          pages.push({ category, items: result.value.items });
          count += result.value.items.length;
          const next = result.value.nextCursor;
          if (next === null) break;
          cursor = next;
        }
        noticeCounts[category] = (noticeCounts[category] ?? 0) + count;
      }
      // L11: append without an unbounded argument spread.
      for (const item of mergeNoticePages(pages, Number.MAX_SAFE_INTEGER).items) allNotices.push(item);
    } catch (error) {
      return storeFailureToRejection(error as { code: string; reason: string });
    }
  }
  // U9: the ONE grouping. Only `note_review` scribe results fold (per Goal);
  // every other category and own-line note passes through unchanged.
  const groupedAll = groupNotices(allNotices, 'user_affected_per_goal');

  // ---- one stable global page ----------------------------------------------
  // §4.1: the requested sections are selected BEFORE paging; a page of 50
  // waiting cards must never hide the one requested pending application.
  const orderedCards: DecisionCardV1[] = [];
  // L11: append without an unbounded argument spread.
  if (input.sections.includes('waiting_answer')) for (const card of waiting) orderedCards.push(card);
  if (input.sections.includes('answered_pending_application')) for (const card of answered) orderedCards.push(card);
  if (input.sections.includes('history')) for (const card of history) orderedCards.push(card);

  const cursor = parseQueueCursor(input.page.cursor);
  if (cursor === 'invalid') return { status: 'rejected', code: 'invalid', reason: 'the queue cursor is not a real page point' };
  // §2.5/§4.1: a continuation is tied to stable card/notice positions. Once the
  // cards are exhausted the page resumes at the notices; a notice that was
  // acknowledged meanwhile cannot move the cursor onto a later, unseen item.
  const noticesStarted = cursor !== null && cursor.notices !== undefined;
  const remainingCards = noticesStarted ? []
    : cursor === null || cursor.card === undefined ? orderedCards
      : orderedCards.filter((card) => compareCardSeek(cardSeek(card), cursor.card!) > 0);
  const noticeAfter = cursor?.notices ?? {};
  const remainingNotices = groupedAll.filter((item) => {
    const after = noticeAfter[item.category];
    return after === undefined || compareNoticePositions(item.position, after) > 0;
  });
  const combined = [...remainingCards, ...remainingNotices];
  const pageItems = combined.slice(0, limit);
  const displayedCards = pageItems.filter((item): item is DecisionCardV1 => 'cardKey' in item);
  const displayedNotices = pageItems.filter((item): item is NoticeItemV1 => 'itemKey' in item);
  // Lead ruling 8: advance `seenThrough` only over the lines this query already
  // delivered. A folded line shows all its members, and the previous pages of
  // this same query (at or below the cursor's position) count as delivered.
  const previousLines = groupedAll.filter((item) => {
    const after = noticeAfter[item.category];
    return after !== undefined && compareNoticePositions(item.position, after) <= 0;
  });
  const seenThrough = seenThroughOfNotices(groupedAll, [...displayedNotices, ...previousLines]);
  const nextCursor = nextQueueCursor(combined.slice(limit), displayedCards, displayedNotices, cursor);

  let displayToken: string | null = null;
  // §4.1 line 772 / §3.3: every source above was read inside the window fixed by
  // the first listing (or the first horizon read). A horizon observed later than
  // that window proves the reads did NOT share it: retry the whole window and
  // only ever report the fixed window as `sourceCursor`.
  const watermarkRead = await readWatermark(deps.records);
  if (watermarkRead.status !== 'ready') return watermarkRead;
  const observed = later(watermark, watermarkRead.value);
  if (observed !== null && (fixedWindow === null || observed > fixedWindow)) return WINDOW_MOVED;
  if (fixedWindow === null) return { status: 'rejected', code: 'unavailable', reason: 'the workspace has no readable ledger watermark' };
  const readiness = atLeastCursorResult<DecisionQueueReadV1>(fixedWindow, input.page.atLeastCursor);
  if (readiness !== null) return readiness;
  if (displayedNotices.length > 0) {
    displayToken = deps.displayTokens.issue({
      schemaVersion: 1,
      workspace: { projectId: workspace.projectId, workspaceId: workspace.workspaceId },
      operator: operatorOf(ctx),
      goalRef: input.goalRef ?? null,
      categories: [...(input.categories ?? NOTICE_CATEGORIES)],
      sourceCursor: fixedWindow,
      queryCursor: input.page.cursor ?? null,
      returnedKeys: displayedNotices.map((item) => item.itemKey),
      seenThrough,
    });
  }

  const capabilityList: DecisionQueueReadV1['capabilities'] = [...capabilities]
    .map(([source, availability]) => ({ source: source as DecisionSourceV1['kind'] | NoticeCategoryV1, availability }));
  return { status: 'ready', value: {
    waitingAnswer: displayedCards.filter((card) => card.state === 'waiting_answer'),
    answeredPendingApplication: displayedCards.filter((card) => card.state === 'answered_pending_application'),
    history: displayedCards.filter((card) => card.state === 'applied'
      || card.state === 'answered_no_application' || card.state === 'closed'),
    notices: displayedNotices,
    counts: { waitingAnswer: waiting.length, answeredPendingApplication: answered.length, notices: noticeCounts },
    countsComplete: capabilityList.every((entry) => entry.availability === 'available'),
    nextCursor,
    sourceCursor: fixedWindow,
    seenThrough: { ...seenThrough },
    displayToken,
    capabilities: capabilityList,
  } };
}

// -------------------------------------------------------------------------- //
// readDecisionCard                                                             //
// -------------------------------------------------------------------------- //

async function readDecisionCard(
  deps: DecisionReadModelDependencies,
  ctx: CoreCallContext,
  source: DecisionSourceV1,
): Promise<ReadResult<DecisionCardV1>> {
  // §8.2 scope row: the explicit Goal/message refs are compared with the bound
  // scope before any foreign record is read; only a same-scope absence is
  // `not_found`. A read failure stays `unavailable`, never `not_found`.
  const scopeProblem = decisionSourceScopeProblem(ctx, source);
  if (scopeProblem !== null) return scopeProblem;
  try {
    const goalKey = canonicalJson(source.goalRef as unknown as JsonValue);
    const goalRecord = await readOne(deps.records, goalKey);
    if (goalRecord === null) return { status: 'not_found' };
    const goalDecoded = decodeGoalSnapshot(goalRecord);
    if (goalDecoded.status !== 'decoded') {
      return { status: 'rejected', code: 'unavailable', reason: goalDecoded.reason };
    }
    const goal = goalDecoded.value;
    if (goal.workspaceRef.workspaceId !== ctx.workspaceId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the goal belongs to another workspace' };
    }

    let card: DecisionCardV1 | null = null;
    if (source.kind === 'message') {
      const identity = parseIdentity(source.key);
      if (identity === null || identity.kind !== 'message') {
        return { status: 'rejected', code: 'invalid', reason: 'a message source key is not a SessionMessageRef' };
      }
      const record = await readOne(deps.records, sessionMessageRefKey(identity.messageRef));
      if (record === null) return { status: 'not_found' };
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return { status: 'rejected', code: 'unavailable', reason: decoded.reason };
      // The same eligibility as the queue's source-1 loop.
      const message = decoded.value;
      if (!isUserMessageRecipient(message.recipient) || message.decision === undefined
        || message.decision.syntheticAnswer || message.intent !== 'decision_request') {
        return { status: 'not_found' };
      }
      card = messageCard(source, message);
    } else {
      // §4.1 line 776 / §2.8: the answer index is keyed by the source identity
      // in the Workspace this CALL is bound to (already checked against the
      // source's Goal). A legal old source may carry no `goalBases`; deriving
      // the workspace from `goalBases[0]` would read it as "no answer".
      const boundWorkspace: WorkspaceScope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId };
      const answerMessage = await findAnswerMessage(deps.records, boundWorkspace, source);
      card = answerMessage !== null ? syntheticAnswerCard(answerMessage) : await deriveOpenCard(deps, ctx, source, goal);
    }
    if (card === null) return { status: 'not_found' };
    const refreshed = await refreshSourcePins(deps.records, card.source);
    return { status: 'ready', value: finalizeCard({ ...card, source: refreshed }, goal,
      await readCardTerminalState(deps, card, goal)) };
  } catch (error) {
    return readFailureToResult<DecisionCardV1>(error);
  }
}

/**
 * §4.1/§8.2: a thrown read failure keeps its real shape. A source's `not_ready`
 * stamp is published as such (never flattened to `unavailable`); a Store
 * rejection maps through the domain vocabulary.
 */
function readFailureToResult<T>(error: unknown): ReadResult<T> {
  if (isRecord(error)) {
    if (error['status'] === 'not_found') return { status: 'not_found' };
    if (error['status'] === 'not_ready') {
      return error as unknown as Extract<ReadResult<T>, { status: 'not_ready' }>;
    }
  }
  return storeFailureToRejection(error as { code: string; reason: string });
}

/**
 * §8.2 scope row / §4.1: resolve an explicit queue `goalRef` exactly like
 * `readDecisionCard`. The Goal record is read first, then its scope is decided:
 * a Goal of another Workspace in the SAME project is `forbidden`; only a real
 * absence is `not_found`; a damaged Goal is `unavailable`. The bound
 * Workspace's Goal listing alone must never decide this.
 */
async function resolveExplicitGoal(
  records: DecisionReadRecordsPort,
  ctx: CoreCallContext,
  goalRef: GoalRef,
): Promise<ReadResult<GoalSnapshot>> {
  try {
    const goalKey = canonicalJson(goalRef as unknown as JsonValue);
    const record = await readOne(records, goalKey);
    if (record === null) return { status: 'not_found' };
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') {
      return { status: 'rejected', code: 'unavailable', reason: `Goal ${goalKey}: ${decoded.reason}` };
    }
    if (decoded.value.workspaceRef.workspaceId !== ctx.workspaceId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the goal belongs to another workspace' };
    }
    return { status: 'ready', value: decoded.value };
  } catch (error) {
    return readFailureToResult<GoalSnapshot>(error);
  }
}

/** §8.2: project/workspace scope of an explicit decision source, decided before any read. */
function decisionSourceScopeProblem(ctx: CoreCallContext, source: DecisionSourceV1): CoreRejection | null {
  if (source.goalRef.projectId !== ctx.projectId) {
    return { status: 'rejected', code: 'forbidden', reason: 'the goal is outside the bound call scope' };
  }
  const identity = parseIdentity(source.key);
  if (identity !== null) {
    const problem = identityScopeProblem(ctx, identity);
    if (problem !== null) return problem;
  }
  // §8.2 line 1354: `goalBases` carries explicit Goal and Workspace refs too.
  // The answer lookup uses the CALL's bound Workspace (already checked against
  // the source's Goal); a foreign basis must still be forbidden BEFORE it can
  // drive a foreign `records.lookup`.
  for (const basis of source.goalBases ?? []) {
    if (basis.goalRef.projectId !== ctx.projectId
      || basis.workspaceRef.projectId !== ctx.projectId
      || basis.workspaceRef.workspaceId !== ctx.workspaceId) {
      return { status: 'rejected', code: 'forbidden', reason: 'a captured goal basis is outside the bound call scope' };
    }
  }
  return null;
}

/** The workspace-bearing refs each natural source identity carries (per kind). */
function identityScopeProblem(ctx: CoreCallContext, identity: DecisionSourceIdentityV1): CoreRejection | null {
  const forbidden: CoreRejection = { status: 'rejected', code: 'forbidden',
    reason: 'the decision source is outside the bound call scope' };
  const foreignRef = (ref: { projectId: string; workspaceId?: string }): boolean =>
    ref.projectId !== ctx.projectId || (ref.workspaceId !== undefined && ref.workspaceId !== ctx.workspaceId);
  switch (identity.kind) {
    case 'message':
    case 'message_release':
      return foreignRef(identity.messageRef) ? forbidden : null;
    case 'candidate':
      return foreignRef('requestRef' in identity ? identity.requestRef : identity.proposalRef) ? forbidden : null;
    case 'planning_question':
      return foreignRef(identity.answerRef) ? forbidden : null;
    case 'goal_conflict':
      return identity.pair.some((entry) => entry.goalRef.projectId !== ctx.projectId) ? forbidden : null;
    case 'goal_cause':
      return identity.goalRef.projectId !== ctx.projectId ? forbidden : null;
    case 'note_review':
      return null;
    // These sources' refs carry their own project/workspace ids.
    case 'unknown_call_review':
      return identity.reviewRef.projectId !== ctx.projectId ? forbidden : null;
    case 'command_rerun_request':
      return identity.requestRef.projectId !== ctx.projectId ? forbidden : null;
    default: {
      const unknown: never = identity;
      void unknown;
      return null;
    }
  }
}

/**
 * The direct-card entrance resolves the same terminal fact as the queue: a
 * goal_conflict card must consult both Goals of its unordered pair, so the
 * smaller-key Goal's cancellation/completion closes it here too.
 */
async function readCardTerminalState(
  deps: DecisionReadModelDependencies,
  card: DecisionCardV1,
  goal: GoalSnapshot | null,
): Promise<GoalTerminalState> {
  const goals: GoalSnapshot[] = goal === null ? [] : [goal];
  if (card.source.kind === 'goal_conflict') {
    const identity = parseIdentity(card.source.key);
    if (identity !== null && identity.kind === 'goal_conflict') {
      for (const entry of identity.pair) {
        if (goal !== null && sameGoal(entry.goalRef, goal.ref)) continue;
        const record = await readOne(deps.records, canonicalJson(entry.goalRef as unknown as JsonValue));
        if (record === null) continue;
        const decoded = decodeGoalSnapshot(record);
        if (decoded.status === 'decoded') goals.push(decoded.value);
      }
    }
  }
  let cancelled = false;
  let completed = false;
  for (const candidate of goals) {
    const state = await readGoalTerminalState(deps.records, candidate);
    // A failed/corrupt GoalPhase read is thrown so `readDecisionCard` reports
    // it (through `readFailureToResult`), never a false "not terminal".
    if (state.status !== 'ready') throw state;
    cancelled = cancelled || state.value.cancelled;
    completed = completed || state.value.completed;
  }
  return { cancelled, completed };
}

async function deriveOpenCard(
  deps: DecisionReadModelDependencies,
  ctx: CoreCallContext,
  source: DecisionSourceV1,
  goal: GoalSnapshot | null,
): Promise<DecisionCardV1 | null> {
  if (source.kind === 'candidate') {
    const identity = parseIdentity(source.key);
    if (identity === null || identity.kind !== 'candidate' || goal === null) return null;
    const proposal = await findCandidateProposal(deps.records, identity, goal);
    return proposal === null ? null : candidateCard(proposal, goal);
  }
  if (source.kind === 'goal_conflict') {
    const workspace = goal === null ? null : { projectId: goal.workspaceRef.projectId, workspaceId: goal.workspaceRef.workspaceId };
    if (workspace === null) return null;
    const conflicts = await deps.conflicts.queryGoalConflicts(ctx, { workspace });
    // §4.1/§8.2: a source that could not be read is NOT an absent card; the
    // failure propagates so `readDecisionCard` reports it honestly.
    if (conflicts.status === 'not_found') return null;
    if (conflicts.status !== 'ready') throw conflicts;
    return conflicts.value.cards.find((card) => card.source.key === source.key) ?? null;
  }
  const provider = deps.cardSources.find((candidate) => candidate.kind === source.kind);
  if (goal === null) return null;
  if (provider === undefined) {
    throw { status: 'rejected', code: 'unavailable',
      reason: `decision source ${source.kind} is not connected on this Host` } as CoreRejection;
  }
  const workspace = { projectId: goal.workspaceRef.projectId, workspaceId: goal.workspaceRef.workspaceId };
  // §4.2: a source with a real by-key read is resolved directly — no paging, so
  // a card beyond the first page is never missed. `not_found` is an absent card;
  // any other non-`ready` answer is a read failure, never "no such card".
  if (provider.readByKey !== undefined) {
    const result = await provider.readByKey(ctx, { workspace, source });
    if (result.status === 'not_found') return null;
    if (result.status !== 'ready') throw result;
    return result.value;
  }
  // §4.1/§4.2: read the source to its very end (2A L6), following `nextCursor`.
  // A card beyond the first page is NOT an absent card, and an unavailable
  // source is a read failure, never "no such card"; only a source that really
  // ends on `nextCursor: null` proves this card absent. One attempt-scoped
  // cache (L11) makes a multi-page source assemble its set only once.
  const attempt: DecisionSourceAttempt = { cache: new Map() };
  let cursor: string | undefined;
  for (;;) {
    const result = await provider.readPage(ctx, { workspace, goalRef: goal.ref,
      page: { limit: SOURCE_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }), attempt } });
    if (result.status === 'not_found') return null;
    if (result.status !== 'ready') throw result;
    if (result.value.availability !== 'available') {
      throw { status: 'rejected', code: 'unavailable',
        reason: `decision source ${source.kind} is not available` } as CoreRejection;
    }
    const found = result.value.items.find((card) => card.source.key === source.key);
    if (found !== undefined) return found;
    const next = result.value.nextCursor;
    if (next === null) return null;
    cursor = next;
  }
}

// -------------------------------------------------------------------------- //
// Cards                                                                       //
// -------------------------------------------------------------------------- //

function messageCard(source: DecisionSourceV1, message: SessionMessage): DecisionCardV1 {
  const answered = message.status === 'responded' && isUserDecisionResponse(message.response);
  return {
    cardKey: source.key, source, state: answered ? 'answered_pending_application' : 'waiting_answer',
    goalRef: message.goalRef ?? source.goalRef,
    senderSessionRef: message.sender.kind === 'work_run' ? message.sender.sessionRef : null,
    requestRef: null,
    objects: message.decision?.objects ?? [], options: message.decision?.options ?? [],
    answerMessageRef: answered ? message.ref : null,
    answer: answered ? message.response as UserMessageResponseV1 : null,
    application: message.application ?? null,
    candidateStatus: null, staleReason: null, closedReason: null, readOnly: false,
    actions: answered ? [] : ['answer'],
  };
}

function syntheticAnswerCard(message: SessionMessage): DecisionCardV1 {
  const response = message.response as UserMessageResponseV1;
  const source = response.decision.source;
  return {
    cardKey: source.key, source, state: 'answered_pending_application',
    goalRef: message.goalRef ?? source.goalRef,
    senderSessionRef: message.sender.kind === 'work_run' ? message.sender.sessionRef : null,
    requestRef: null,
    objects: message.decision?.objects ?? [], options: message.decision?.options ?? [],
    answerMessageRef: message.ref, answer: response, application: message.application ?? null,
    candidateStatus: null, staleReason: null, closedReason: null, readOnly: false, actions: [],
  };
}

function candidateCard(proposal: PlanProposal, goal: GoalSnapshot): DecisionCardV1 | null {
  if (proposal.kind !== 'candidate_v2') return null;
  // §4.2 source 3: a live `candidate` is waiting (possibly stale); `accepted` and
  // `not_adopted` are the stored terminal statuses and read as closed history.
  if (proposal.status !== 'candidate' && proposal.status !== 'accepted' && proposal.status !== 'not_adopted') return null;
  const requestRef = proposal.requestRef ?? null;
  const identity = requestRef === null
    ? ({ kind: 'candidate', goalRef: goal.ref, proposalRef: proposal.ref } as const)
    : ({ kind: 'candidate', goalRef: goal.ref, requestRef } as const);
  const key = decisionSourceKey(identity);
  const active = goal.activePlanRevision;
  const stale = proposal.status === 'candidate' && proposal.basedOn !== null
    && (active === null || canonicalJson(proposal.basedOn as unknown as JsonValue) !== canonicalJson(active as unknown as JsonValue));
  const closed = proposal.status !== 'candidate';
  const pins = [
    { ref: goal.ref, revision: goal.revision },
    { ref: proposal.ref, revision: proposal.revision },
    ...(proposal.basedOn === null ? [] : [{ ref: proposal.basedOn, revision: 1 }]),
  ];
  const actions: DecisionCardV1['actions'] = closed ? []
    : stale ? ['answer', 'regenerate', 'abandon']
      : ['answer', 'adopt', 'abandon'];
  return {
    cardKey: key,
    source: { kind: 'candidate', key, goalRef: goal.ref, pins, goalBases: [goalDecisionBasis(goal)] },
    state: closed ? 'closed' : 'waiting_answer',
    goalRef: goal.ref, senderSessionRef: null, requestRef,
    objects: pins.map(pin => ({ kind: 'aggregate' as const, pin: structuredClone(pin), label: 'candidate' })), options: [],
    answerMessageRef: null, answer: null, application: null,
    candidateStatus: closed ? null : stale ? 'stale' : 'candidate', staleReason: stale ? 'basedOn is not the active Plan pointer' : null,
    closedReason: closed ? 'source_resolved' : null, readOnly: closed, actions,
  };
}

function finalizeCard(card: DecisionCardV1, goal: GoalSnapshot | null, terminal: GoalTerminalState): DecisionCardV1 {
  // §2.8: the card's content basis is the FORMAL Goal, never the question-time
  // metadata copy. A message card is normalized here so an answer taken from it
  // carries exactly the canonical `goalBases` the owner will re-derive.
  if (goal !== null && card.source.kind === 'message') {
    card = { ...card, source: { ...card.source, goalBases: [goalDecisionBasis(goal)] } };
  }
  if (terminal.cancelled) {
    return { ...card, state: 'closed', closedReason: 'goal_cancelled', readOnly: true, actions: [] };
  }
  // §4.3 line 829: a formally COMPLETED Goal also stops a still-open conflict
  // card from being a new waiting card; an already answered card keeps its slot.
  if (terminal.completed && card.source.kind === 'goal_conflict' && card.answer === null) {
    return { ...card, state: 'closed', closedReason: 'source_resolved', readOnly: true, actions: [] };
  }
  if (card.answer !== null) {
    if (card.application !== null) return { ...card, state: 'applied', readOnly: false, actions: [] };
    if (card.answer.decision.requiresApplication) {
      return { ...card, state: 'answered_pending_application', readOnly: false, actions: ['apply', 'record_application'] };
    }
    return { ...card, state: 'answered_no_application', readOnly: false, actions: [] };
  }
  return card;
}

/**
 * §4.3 line 829: the terminal state a card must be judged against. A normal
 * card uses its own Goal; a goal_conflict card uses BOTH Goals of the pair, so
 * cancelling (or completing) the smaller-key Goal closes it too.
 */
function cardTerminalState(
  card: DecisionCardV1,
  goal: GoalSnapshot | null,
  terminalByGoalKey: ReadonlyMap<string, GoalTerminalState>,
): GoalTerminalState {
  let cancelled = false;
  let completed = false;
  const merge = (state: GoalTerminalState | undefined): void => {
    if (state === undefined) return;
    cancelled = cancelled || state.cancelled;
    completed = completed || state.completed;
  };
  if (goal !== null) merge(terminalByGoalKey.get(canonicalJson(goal.ref as unknown as JsonValue)));
  if (card.source.kind === 'goal_conflict') {
    const identity = parseIdentity(card.source.key);
    if (identity !== null && identity.kind === 'goal_conflict') {
      for (const entry of identity.pair) {
        merge(terminalByGoalKey.get(canonicalJson(entry.goalRef as unknown as JsonValue)));
      }
    }
  }
  return { cancelled, completed };
}

function mergeCards(existing: DecisionCardV1, incoming: DecisionCardV1): DecisionCardV1 {
  return {
    ...existing,
    source: existing.source.pins.length >= incoming.source.pins.length ? existing.source : incoming.source,
    answerMessageRef: existing.answerMessageRef ?? incoming.answerMessageRef,
    answer: existing.answer ?? incoming.answer,
    application: existing.application ?? incoming.application,
    objects: existing.objects.length >= incoming.objects.length ? existing.objects : incoming.objects,
    options: existing.options.length >= incoming.options.length ? existing.options : incoming.options,
    candidateStatus: existing.candidateStatus ?? incoming.candidateStatus,
    staleReason: existing.staleReason ?? incoming.staleReason,
    closedReason: existing.closedReason ?? incoming.closedReason,
  };
}

function sortCards(cards: readonly DecisionCardV1[]): DecisionCardV1[] {
  return [...cards].sort((left, right) => {
    const byGoal = compareText(canonicalJson(left.goalRef as unknown as JsonValue), canonicalJson(right.goalRef as unknown as JsonValue));
    if (byGoal !== 0) return byGoal;
    const byKind = compareText(left.source.kind, right.source.kind);
    return byKind !== 0 ? byKind : compareText(left.source.key, right.source.key);
  });
}

// -------------------------------------------------------------------------- //
// Built-in member notification source                                         //
// -------------------------------------------------------------------------- //

function builtInMemberNoticeSource(records: DecisionReadRecordsPort, messages: readonly SessionMessage[]): DecisionNoticeSourcePort {
  // L11: this source object lives for exactly one window attempt, so the
  // assembled set is built once and every internal page reuses it.
  const assembled = new Map<string, NoticeItemV1[]>();
  return {
    category: 'member_notice',
    async readPage(_ctx, input) {
      const goalKey = input.goalRef === undefined ? '' : canonicalJson(input.goalRef as unknown as JsonValue);
      let items = assembled.get(goalKey);
      if (items === undefined) {
        items = [];
        for (const message of messages) {
          if (!isUserMessageRecipient(message.recipient)) continue;
          if (message.intent !== 'notify') continue;
          if (message.decision?.syntheticAnswer === true) continue;
          if (input.goalRef !== undefined
            && (message.goalRef === null || message.goalRef === undefined || !sameGoal(message.goalRef, input.goalRef))) continue;
          const record = await readOne(records, sessionMessageRefKey(message.ref));
          if (record === null) continue;
          const origin = decodeNoticeOrigin(record);
          // §2.5 line 291: a persisted `since:null` (or any undecodable origin) is
          // `unavailable`, never silently skipped into an "available empty" page.
          if (origin.status !== 'decoded') {
            return { status: 'rejected', code: 'unavailable', reason: `member notice origin: ${origin.reason}` };
          }
          const since = origin.value.since;
          // §2.5 line 291: a notice is positioned only by its bound commit
          // cursor; an absent position is unavailable, never a legacy fallback.
          if (since === undefined || since === null) {
            return { status: 'rejected', code: 'unavailable', reason: 'member notice origin has no commit position' };
          }
          const itemKey = `member_notice:${sessionMessageRefKey(message.ref)}`;
          items.push({
            itemKey, category: 'member_notice',
            goalRef: message.goalRef ?? { aggregateType: 'Goal', projectId: message.ref.projectId, goalId: '' },
            position: { kind: 'commit', cursor: since, itemKey },
            summary: '你有一条新通知', objects: [], rework: null,
          });
        }
        items.sort((left, right) => compareNoticePositions(left.position, right.position));
        assembled.set(goalKey, items);
      }
      const after = input.after;
      const remaining = after === undefined ? items : items.filter((item) => compareNoticePositions(item.position, after) > 0);
      const offset = input.page.cursor === undefined ? 0 : Number(input.page.cursor);
      const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
      const end = Math.min(remaining.length, start + input.page.limit);
      return { status: 'ready', value: { availability: 'available', items: remaining.slice(start, end),
        nextCursor: end < remaining.length ? String(end) : null, sourceCursor: null } };
    },
  };
}

// -------------------------------------------------------------------------- //
// Shared read helpers                                                          //
// -------------------------------------------------------------------------- //

async function loadWorkspaceMessages(
  records: DecisionReadRecordsPort,
  workspace: WorkspaceScope,
): Promise<{ messages: SessionMessage[]; watermark: CommitCursor | null }> {
  // 2A L2: read only the messages addressed to the user through the dedicated
  // index; member-to-member traffic is never read. The source is paged to the
  // end (L10), so its whole user-message set is available with no cap.
  const messages: SessionMessage[] = [];
  const batch = await lookupAll(records, S2A_USER_MESSAGES_LOOKUP,
    [workspace.projectId, workspace.workspaceId, 'user']);
  for (const record of batch.items) {
    const decoded = decodeSessionMessageRecord(record);
    if (decoded.status !== 'decoded') {
      // §4.1/§4.2: a damaged stored message is a read failure, never a silent
      // truncation that would hide a real decision card.
      throw { status: 'rejected', code: 'unavailable',
        reason: `workspace message ${record.refKey}: ${decoded.reason}` } as CoreRejection;
    }
    messages.push(decoded.value);
  }
  return { messages, watermark: batch.watermark };
}


async function findCandidateProposal(
  records: DecisionReadRecordsPort,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'candidate' }>,
  goal: GoalSnapshot,
): Promise<PlanProposal | null> {
  if ('proposalRef' in identity) {
    const record = await readOne(records, canonicalJson(identity.proposalRef as unknown as JsonValue));
    if (record === null) return null;
    const decoded = decodePlanProposalRecord(record);
    if (decoded.status !== 'decoded') {
      // §8.2 data row: a damaged proposal record is `unavailable`, never a
      // silent "no such candidate".
      throw { status: 'rejected', code: 'unavailable',
        reason: `plan proposal ${record.refKey}: ${decoded.reason}` } as CoreRejection;
    }
    // An explicit proposal of another Goal is not this Goal's candidate.
    if (canonicalJson(decoded.value.goalRef as unknown as JsonValue) !== canonicalJson(goal.ref as unknown as JsonValue)) {
      return null;
    }
    return decoded.value;
  }
  const batch = await lookupAll(records, S5_PLAN_PROPOSAL_BY_REQUEST,
    [goal.ref.projectId, goal.workspaceRef.workspaceId, goal.ref.goalId, identity.requestRef.queryJobId]);
  const candidates: PlanProposal[] = [];
  // §2.5/T-R2-2: each chain's creation position is its first candidate's
  // wire-only `since`, read beside the public DTO.
  const positions = new Map<string, CommitCursor | null>();
  for (const record of batch.items) {
    const decoded = decodePlanProposalRecord(record);
    if (decoded.status !== 'decoded') {
      // §8.2 data row: a damaged proposal record is `unavailable`, never
      // silently skipped out of the request's candidate set.
      throw { status: 'rejected', code: 'unavailable',
        reason: `plan proposal ${record.refKey}: ${decoded.reason}` } as CoreRejection;
    }
    if (decoded.value.kind !== 'candidate_v2') continue;
    const candidate = decoded.value;
    if (candidate.requestRef === null || candidate.requestRef === undefined
      || canonicalJson(candidate.requestRef as unknown as JsonValue) !== canonicalJson(identity.requestRef as unknown as JsonValue)) continue;
    const origin = decodePlanProposalOrigin(record);
    if (origin.status !== 'decoded') {
      throw { status: 'rejected', code: 'unavailable',
        reason: `plan proposal ${record.refKey} origin: ${origin.reason}` } as CoreRejection;
    }
    positions.set(canonicalJson(candidate.ref as unknown as JsonValue), origin.value.since ?? null);
    candidates.push(candidate);
  }
  // 2A L6/L10: the request candidate index is read to its end, so the head
  // selection below sees the whole candidate set with no capacity refusal.
  // §4.2 source 3: the live head wins; otherwise the terminal of the LAST
  // created chain (its first candidate's creation commit), so the direct-card
  // entrance reads the same closed card as the queue. The comparison is the
  // shared `compareProposalChainPositions`: never the last in refKey order and
  // never "accepted first"; `notAdopted.at` is deliberately NOT used.
  const live = candidates.find((candidate) => candidate.kind === 'candidate_v2' && candidate.status === 'candidate');
  if (live !== undefined) return live;
  const superseded = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.kind !== 'candidate_v2' || candidate.status !== 'not_adopted') continue;
    if ((candidate.notAdopted?.replacedBy ?? null) === null) continue;
    superseded.add(canonicalJson(candidate.ref as unknown as JsonValue));
  }
  const head: PlanProposal | null = terminalProposalOf(
    candidates.filter((candidate) => !superseded.has(canonicalJson(candidate.ref as unknown as JsonValue))),
    positions);
  if (head !== null) return head;
  return candidates.find((candidate) => candidate.status !== 'candidate') ?? null;
}

/**
 * §2.8: only the Goal aggregate's CONTROL revision may be refreshed into the
 * displayed source (the named control-rebase exception). Plan/candidate/message
 * pins stay exactly as captured; refreshing every object would silently
 * authorize an old Plan against a newer Goal. A read failure is thrown, never
 * turned into "unchanged".
 */
async function refreshSourcePins(records: DecisionReadRecordsPort, source: DecisionSourceV1): Promise<DecisionSourceV1> {
  const goalPins = source.pins.filter(isGoalPin);
  if (goalPins.length === 0) return source;
  const keys = goalPins.map((pin) => canonicalJson(pin.ref as unknown as JsonValue));
  const read = await records.readMany(keys);
  if (read.status !== 'ready') throw read;
  const revisions = new Map(read.value.records.map((record) => [record.refKey, record.revision]));
  return { ...source, pins: source.pins.map((pin) => {
    if (!isGoalPin(pin)) return pin;
    const revision = revisions.get(canonicalJson(pin.ref as unknown as JsonValue));
    return revision === undefined ? pin : { ref: pin.ref, revision };
  }) };
}

function isGoalPin(pin: VersionPin): boolean {
  return (pin.ref as { aggregateType?: string }).aggregateType === 'Goal';
}

/** A read failure is thrown so the caller reports it; only a real absence is null. */
async function readOne(records: DecisionReadRecordsPort, refKey: string): Promise<EncodedRecord | null> {
  const read = await records.readMany([refKey]);
  if (read.status !== 'ready') throw read;
  const found = read.value.records.find((record) => record.refKey === refKey);
  if (found === undefined && !read.value.missing.includes(refKey)) {
    throw { status: 'rejected', code: 'unavailable',
      reason: `record ${refKey} was neither returned nor reported missing` } as CoreRejection;
  }
  return found ?? null;
}

async function readSavedNoticeSeen(
  records: DecisionReadRecordsPort,
  workspace: WorkspaceScope,
): Promise<ReadResult<Partial<Record<NoticeCategoryV1, NoticePositionV1>>>> {
  const refKey = canonicalJson({ aggregateType: 'Workspace', projectId: workspace.projectId,
    workspaceId: workspace.workspaceId } as unknown as JsonValue);
  let record: EncodedRecord | null;
  try {
    record = await readOne(records, refKey);
  } catch (error) {
    return storeFailureToRejection(error as { code: string; reason: string });
  }
  if (record === null) return { status: 'ready', value: {} };
  const decoded = decodeWorkspaceSnapshot(record);
  if (decoded.status !== 'decoded') return { status: 'rejected', code: 'unavailable', reason: decoded.reason };
  // §2.2: the default-applying helper, never an inline `?? {}`.
  return { status: 'ready', value: effectiveWorkspaceDecisionSettings(decoded.value).noticeSeen };
}

function parseIdentity(key: string): DecisionSourceIdentityV1 | null {
  try {
    const parsed = JSON.parse(key) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as DecisionSourceIdentityV1 : null;
  } catch {
    return null;
  }
}

function isUserDecisionResponse(response: SessionMessage['response']): response is UserMessageResponseV1 {
  return response !== null && typeof response === 'object' && 'decision' in response;
}

/**
 * §2.6/§4.2: fold a real source read back into the advertised capability. A
 * `not_available` answer is sticky for the whole query; an adapter presence
 * default is only ever downgraded, never upgraded to a lie.
 */
function observeAvailability(
  capabilities: Map<string, 'available' | 'not_available'>,
  source: string,
  availability: 'available' | 'not_available',
): void {
  if (availability === 'not_available') capabilities.set(source, 'not_available');
  else if (!capabilities.has(source)) capabilities.set(source, 'available');
}

function cardSourceAvailability(kind: DecisionSourceV1['kind'], injected: ReadonlyMap<string, DecisionCardSourcePort>): 'available' | 'not_available' {
  if (kind === 'message' || kind === 'candidate' || kind === 'goal_conflict') return 'available';
  return injected.has(kind) ? 'available' : 'not_available';
}

function noticeSourceAvailability(category: NoticeCategoryV1, injected: ReadonlyMap<string, DecisionNoticeSourcePort>): 'available' | 'not_available' {
  if (category === 'member_notice') return 'available';
  return injected.has(category) ? 'available' : 'not_available';
}

function operatorOf(ctx: CoreCallContext): ActorRef {
  return ctx.principal.kind === 'host' ? ctx.principal.actor : { kind: 'system', id: 'decision-read-model' };
}

/**
 * §2.5/§4.1: decode the opaque queue continuation. A malformed cursor is
 * `invalid` (never silently treated as the first page); an absent one is null.
 */
function parseQueueCursor(cursor: string | undefined): QueuePageCursorV1 | 'invalid' | null {
  if (cursor === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor) as unknown;
  } catch {
    return 'invalid';
  }
  if (!isRecord(parsed) || parsed['v'] !== 1) return 'invalid';
  const result: QueuePageCursorV1 = { v: 1 };
  const card = parsed['card'];
  if (card !== undefined) {
    if (!isCardSeek(card)) return 'invalid';
    result.card = card;
  }
  const notices = parsed['notices'];
  if (notices !== undefined) {
    if (!isRecord(notices)) return 'invalid';
    const positions: Partial<Record<NoticeCategoryV1, NoticePositionV1>> = {};
    for (const [category, position] of Object.entries(notices)) {
      if (!NOTICE_CATEGORIES.includes(category as NoticeCategoryV1) || !isNoticePosition(position)) return 'invalid';
      positions[category as NoticeCategoryV1] = position;
    }
    result.notices = positions;
  }
  return result;
}

function isCardSeek(value: unknown): value is CardSeekV1 {
  return isRecord(value) && (value['rank'] === 0 || value['rank'] === 1 || value['rank'] === 2)
    && typeof value['goal'] === 'string' && typeof value['kind'] === 'string' && typeof value['key'] === 'string';
}

function isNoticePosition(value: unknown): value is NoticePositionV1 {
  if (!isRecord(value) || typeof value['itemKey'] !== 'string') return false;
  return value['kind'] === 'commit' && typeof value['cursor'] === 'string';
}

/** The stable page point of one card, ordered exactly like the output sections. */
function cardSeek(card: DecisionCardV1): CardSeekV1 {
  return { rank: cardRank(card.state), goal: canonicalJson(card.goalRef as unknown as JsonValue),
    kind: card.source.kind, key: card.source.key };
}

function cardRank(state: DecisionCardV1['state']): 0 | 1 | 2 {
  return state === 'waiting_answer' ? 0 : state === 'answered_pending_application' ? 1 : 2;
}

function compareCardSeek(left: CardSeekV1, right: CardSeekV1): number {
  if (left.rank !== right.rank) return left.rank < right.rank ? -1 : 1;
  const byGoal = compareText(left.goal, right.goal);
  if (byGoal !== 0) return byGoal;
  const byKind = compareText(left.kind, right.kind);
  return byKind !== 0 ? byKind : compareText(left.key, right.key);
}

/**
 * §2.5: build the continuation from the positions of the items actually
 * displayed. `null` means there is nothing after this page. Cards resume from
 * their last displayed point; notices resume from each displayed category's
 * position, so a later `markNoticesSeen` can never make the next page skip an
 * undelivered item.
 */
function nextQueueCursor(
  rest: readonly (DecisionCardV1 | NoticeItemV1)[],
  displayedCards: readonly DecisionCardV1[],
  displayedNotices: readonly NoticeItemV1[],
  cursor: QueuePageCursorV1 | null,
): string | null {
  if (rest.length === 0) return null;
  const next: QueuePageCursorV1 = { v: 1 };
  const lastCard = displayedCards.at(-1);
  if (lastCard !== undefined) next.card = cardSeek(lastCard);
  else if (cursor !== null && cursor.card !== undefined) next.card = cursor.card;
  // N1 (lead): keep the earlier per-category positions; only the categories
  // displayed on this page advance, so interleaved categories never repeat.
  const notices: Partial<Record<NoticeCategoryV1, NoticePositionV1>> = { ...(cursor?.notices ?? {}) };
  for (const item of displayedNotices) notices[item.category] = item.position;
  if (Object.keys(notices).length > 0) next.notices = notices;
  return next.card === undefined && next.notices === undefined ? null : canonicalJson(next as unknown as JsonValue);
}

function sameGoal(left: GoalRef, right: GoalRef): boolean {
  return left.projectId === right.projectId && left.goalId === right.goalId;
}

/**
 * A card belongs to a Goal-filtered read when its own Goal matches, or — for an
 * unordered conflict pair — when either Goal of the pair matches.
 */
function cardInScope(card: DecisionCardV1, goalRef: GoalRef): boolean {
  if (sameGoal(card.goalRef, goalRef)) return true;
  if (card.source.kind !== 'goal_conflict') return false;
  const identity = parseIdentity(card.source.key);
  return identity !== null && identity.kind === 'goal_conflict'
    && identity.pair.some((entry) => sameGoal(entry.goalRef, goalRef));
}

function later(left: CommitCursor | null, right: CommitCursor | null): CommitCursor | null {
  if (left === null) return right;
  if (right === null) return left;
  return left >= right ? left : right;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
