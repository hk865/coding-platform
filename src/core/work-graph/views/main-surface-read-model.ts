/**
 * The main conversation's read and one request's read with its cards
 * (slice-6-SPEC L6).
 *
 * `readMainPage` lists one view of a workspace's requests, newest first, 20 a
 * page. A Goal's view reads that Goal's request roots; the first Goal by
 * creation then goes on with the no-goal roots created before it (the pre-goal
 * section: the oldest part of that Goal's history, inside the same 20). The
 * no-goal view reads the no-goal roots created after the first Goal, or all of
 * them while the workspace has no Goal; the first Goal's creation is the read's
 * exclusive lower bound, so a cursor taken before that Goal existed continues
 * to nothing older than it. Roots come from `s6-request-roots-by-goal` ordered
 * by `since`, the first Goal from `readGoalsByWorkspaceCreated`; the store
 * compares cursors (bounds, keysets), this module never does. A cursor is
 * `(phase, since, rootKey)` of the last row shown. Each request is the request
 * owner's own view (`readRequest`).
 *
 * Cards and notices come from ONE whole-page run of the decision queue's source
 * assembly per read (`readWholePage`). A request's cards are those naming one of
 * its rounds and, with an effective Goal, that Goal's own cards (the ones that
 * name no request); a page lists the page's own cards — the project's, which are
 * the common part of every view, and the selected Goal's — then each request's,
 * each card once, and its requests name them by `cardKey`. The page's notices are
 * the project's lines plus the selected Goal's (the no-goal view: the project's
 * only), with each subject's automatic reworks folded, and the seen advance and
 * display token the page allows. Reading writes nothing.
 *
 * A Goal's view also carries that Goal's node review receipts (121-173): every `TaskNodeCommit` record, read again on
 * each read, so a receipt stays after a refresh or a Host restart.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { canonicalKey as keyOf } from '../../../contracts/fingerprint.js';

import type { ActionRequestRef } from '../../../contracts/action-request.js';
import type { NoticeCategoryV1, NoticePositionV1 } from '../../../contracts/goal-decisions.js';
import { compareCursors, type DispatchBasisV1, type GoalRef, type GoalSnapshot } from '../../../contracts/ledger.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  OrderedLookupRequest, RecordLookupPort, RecordOrderedLookupPage, RecordOrderedLookupPort,
} from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { DecisionCardV1, NoticeItemV1 } from '../model/decision-contracts.js';
import type { PlanProposal } from '../model/plan-contracts.js';
import type { NodeReviewReceiptV1, TaskNodeCommitPort } from '../model/task-node-commit-contracts.js';
import { storedDispatchBasis } from '../model/action-request-contracts.js';
import {
  REQUEST_PAGE_SIZE, REQUEST_ROOT_MARK, REQUEST_ROOTS_BY_GOAL_INDEX, requestGoalSlot, type RequestCoreViewV1,
} from '../model/request-contracts.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import { sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import { planRevisionTargetOf } from '../state/plan-machine.js';
import {
  candidateRequestRef, enumerateClosedGoalCandidates, enumerateGoalCandidates, readGoal, readGoalsByWorkspaceCreated,
  readPlan, readProposal, readProposalOrigin,
} from '../tasks/plan-readers.js';
import { deriveFuturePlanDelta } from '../tasks/plan-validation.js';
import { readTaskClaimHoldsInProject, storedMessageRequestRoot } from '../tasks/claim-holds.js';
import { readOwnerRecord } from '../tasks/owner-record-read.js';
import { readGoalCreationRequest } from '../tasks/goal-origin.js';
import type { PlanSourceRootPort } from '../model/claim-contracts.js';
import { readActionRequestsByRequestRoot } from '../tasks/action-request-codecs.js';
import type { ActionRequestV1 } from '../state/action-request.js';
import type { RequestFactsPort } from '../tasks/request-facts.js';
import { cardInScope, type DecisionWholePageReader } from './decision-read-model.js';

// ------------------------------------------------------------------------ //
// Read shapes                                                               //
// ------------------------------------------------------------------------ //

/** The continuation of a main page: the last shown row's phase, `since` and root key. */
export type MainPageCursorV1 = { phase: 'goal' | 'pre' | 'bound' | 'source'; since: CommitCursor; rootKey: string };

export type MainPageV1 = { goalId: string | null;
  requests: (RequestCoreViewV1 & { cardKeys: string[] })[];
  cards: DecisionCardV1[];
  notices: (NoticeItemV1 & { memberViews?: NoticeItemV1[] })[];
  seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>; displayToken: string | null;
  /** This Goal's source requests still without an effective Goal: the complete count, not the page's. */
  pendingSourceRequests: number;
  next: MainPageCursorV1 | null;
  /** The Goal's node review receipts, oldest first; `[]` in the no-goal view; absent when the platform has no node
   *  review owner (the page then says they cannot be read, not that there are none). */
  nodeReceipts?: NodeReviewReceiptV1[] };

/** One action the request's handling left behind: a claim hold, a dispatch request or a stop request. */
export type RequestFeedbackActionV1 = {
  kind: 'hold' | 'dispatch' | 'stop';
  task: TaskTriple;
  reason: string;
  /** The action request's ref for dispatch/stop; null on a hold reason. */
  actionRef: ActionRequestRef | null;
  holdKind: 'agent' | 'stop' | 'scribe_stop' | null;
  /** An agent hold reason's stored state; null on dispatch/stop requests (they carry `requestState`). */
  holdState: 'held' | 'released' | null;
  /** The Session that placed the hold; null on a dispatch/stop request (its requester is on the record). */
  heldBy: SessionRef | null;
  placedAt: string | null;
  requestState: ActionRequestV1['state'] | null;
  notSent: 'person_stopped' | 'run_ended' | null;
  /** The dispatch request's three values at intake; null on holds and stop requests. */
  planVersion: DispatchBasisV1 | null;
  /** The Session and Run a dispatch request was served by; null while it waits or on holds/stops. */
  claimedBy: { session: SessionRef; run: RunRef } | null;
  /** The Run a stop request froze (the Run it asks to stop); null on holds and dispatches. */
  stopRun: RunRef | null;
};

/**
 * §2.8/T37: the change-request feedback read back from the request's own
 * `requestRoot`. The actions and holds are derived at read time from each
 * Task's fixed claim-hold record (held and released reasons alike) and the
 * ActionRequest records its current slots, last settled slots and stop reasons
 * name. The plan revision is the root's own candidate: its `basedOn` while it
 * waits or went stale, the adopted revision once accepted, whose delta also
 * names the Tasks the plan change touched. No write command and no stored
 * feedback are added.
 */
export type RequestFeedbackV1 = {
  affectedTasks: TaskTriple[];
  actions: RequestFeedbackActionV1[];
  /** The PlanRevision the request's plan change was based on, or the one it produced once adopted; null without one. */
  planRevision: PlanRevisionRef | null;
};

export type RequestReadV1 = RequestCoreViewV1 & { cards: DecisionCardV1[]; feedback: RequestFeedbackV1 };

/** `main/read`: one Goal's view (null: the no-goal view) and null or the `next` a previous page returned. */
export type MainReadInputV1 = { goalId: string | null; cursor: MainPageCursorV1 | null };

export interface MainSurfaceReadPort {
  readMainPage(ctx: CoreCallContext, input: MainReadInputV1): Promise<ReadResult<MainPageV1>>;
  readRequestView(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<RequestReadV1>>;
}

export type MainSurfaceReadDependencies = {
  /** The same backend the composition root already passes; every read here uses `readMany`, `lookup` or `lookupOrdered`. */
  records: RecordOrderedLookupPort & RecordLookupPort & Pick<GoalRecordTransactionPort, 'readMany'>;
  requests: Pick<RequestFactsPort, 'readRequest'>;
  decisions: DecisionWholePageReader;
  /** The claim owner's source-chain root (design 3.3): a hand-off's `planfix`/`planresume` successor's request. */
  planSourceRoot: PlanSourceRootPort;
  /** 121-173: the node review owner, for the Goal view's receipts. */
  nodeCommits?: Pick<TaskNodeCommitPort, 'readNodeReceipts'>;
};

/** slice-6-SPEC L6: one page holds 20 requests. */
const MAIN_PAGE_SIZE = 20;

/** The most no-goal roots one source scan may read from the Goal's creation on. */
const MAIN_SOURCE_SCAN_MAX = 400;

// ------------------------------------------------------------------------ //
// Pure rules                                                                //
// ------------------------------------------------------------------------ //

/** One phase of a view: the goal slot it reads and its creation bounds (both exclusive). */
export type MainReadPhaseV1 = {
  phase: 'goal' | 'pre';
  goalSlot: string;
  createdBefore: CommitCursor | null;
  createdAfter: CommitCursor | null;
};

/** One request root read for a page, in page order. */
export type MainReadRowV1 = { phase: 'goal' | 'pre' | 'bound' | 'source'; since: CommitCursor; rootKey: string };

/**
 * A view's phases in page order (newest first): a Goal's own roots; for the
 * first Goal by creation, then the no-goal roots created before it; for the
 * no-goal view, the no-goal roots created after the first Goal.
 */
export function mainReadPhases(view: {
  goalId: string | null; firstGoal: { goalId: string; since: CommitCursor } | null;
}): MainReadPhaseV1[] {
  const first = view.firstGoal;
  if (view.goalId === null) {
    return [{ phase: 'goal', goalSlot: requestGoalSlot(null), createdBefore: null, createdAfter: first === null ? null : first.since }];
  }
  const own: MainReadPhaseV1 = { phase: 'goal', goalSlot: requestGoalSlot(view.goalId), createdBefore: null, createdAfter: null };
  if (first === null || first.goalId !== view.goalId) return [own];
  return [own, { phase: 'pre', goalSlot: requestGoalSlot(null), createdBefore: first.since, createdAfter: null }];
}

/** The phase a page starts in: the one its cursor names, the first without one; null when the view has no such phase. */
export function mainReadStart(phases: readonly MainReadPhaseV1[], cursor: MainPageCursorV1 | null): number | null {
  if (cursor === null) return 0;
  if (cursor.phase === 'bound' || cursor.phase === 'source') {
    /* The two added routes only exist on a Goal's view; the no-goal view has one `no-goal` slot. */
    const goalView = phases.some((entry) => entry.phase === 'goal' && entry.goalSlot !== requestGoalSlot(null));
    return goalView ? 0 : null;
  }
  const index = phases.findIndex((entry) => entry.phase === cursor.phase);
  return index < 0 ? null : index;
}

/** One page out of the rows read for it: `size` shown; when more follow, the continuation names the last one shown. */
export function mainPageStep<T extends MainReadRowV1>(rows: readonly T[], size: number): {
  shown: T[]; next: MainPageCursorV1 | null;
} {
  const shown = rows.slice(0, size);
  const last = shown.at(-1);
  return { shown,
    next: rows.length > size && last !== undefined ? { phase: last.phase, since: last.since, rootKey: last.rootKey } : null };
}


/**
 * A Goal's own card: one in that Goal's scope (the queue's own Goal scope,
 * `cardInScope`) that names no request. Another request's card on the same
 * Goal is not one.
 */
function goalSourceCard(card: DecisionCardV1, goal: GoalRef): boolean {
  return card.requestRef === null && cardInScope(card, goal);
}

/**
 * The project's own card: the project subject's card that names no request. It
 * belongs to the page's common part, so every view lists it and no request claims
 * it (a no-goal request matches by `requestRef` only, and this one names none).
 */
function projectSourceCard(card: DecisionCardV1): boolean {
  return card.requestRef === null && card.subject.kind === 'project';
}

/**
 * A request's cards (slice-6-SPEC L6): the cards whose `requestRef` names one of
 * its rounds and, when it has an effective Goal, that Goal's own cards. A
 * no-goal request matches by `requestRef` only. The order is the assembly's.
 *
 * `pageGoalId` narrows the Goal-owned half to a page's selected Goal: a request
 * the page carries only as the request that CREATED another Goal must not bring
 * that other Goal's own cards onto this page. Left out, the older rule stands
 * (the request's own effective Goal), which `requests/read` keeps using.
 */
export function requestCards(
  cards: readonly DecisionCardV1[],
  request: { rounds: readonly { ref: QueryJobRef }[]; effectiveGoalId: string | null },
  projectId: string,
  pageGoalId?: string | null,
): DecisionCardV1[] {
  const rounds = new Set(request.rounds.map((round) => keyOf(round.ref)));
  const goalId = pageGoalId === undefined ? request.effectiveGoalId
    : request.effectiveGoalId !== null && request.effectiveGoalId === pageGoalId ? request.effectiveGoalId : null;
  const goal: GoalRef | null = goalId === null ? null : { aggregateType: 'Goal', projectId, goalId };
  return cards.filter((card) => (card.requestRef !== null && rounds.has(keyOf(card.requestRef)))
    || (goal !== null && goalSourceCard(card, goal)));
}

/**
 * A page's cards: the page's own cards (the project's and the selected Goal's),
 * then each request's, each card once by `cardKey` (the first occurrence keeps its
 * place); every request names its own cards by key. The project's cards are the
 * common part of every view, including the no-goal one.
 */
export function pageCards(
  cards: readonly DecisionCardV1[],
  requests: readonly { rounds: readonly { ref: QueryJobRef }[]; effectiveGoalId: string | null }[],
  goal: GoalRef | null,
  projectId: string,
): { cards: DecisionCardV1[]; cardKeys: string[][] } {
  const perRequest = requests.map((request) => requestCards(cards, request, projectId, goal?.goalId ?? null));
  const listed: DecisionCardV1[] = [];
  const keys = new Set<string>();
  const listOnce = (card: DecisionCardV1): void => {
    if (keys.has(card.cardKey)) return;
    keys.add(card.cardKey);
    listed.push(card);
  };
  for (const card of cards) if (projectSourceCard(card) || (goal !== null && goalSourceCard(card, goal))) listOnce(card);
  for (const own of perRequest) for (const card of own) listOnce(card);
  return { cards: listed, cardKeys: perRequest.map((own) => own.map((card) => card.cardKey)) };
}

// ------------------------------------------------------------------------ //
// The reads                                                                 //
// ------------------------------------------------------------------------ //

export function createMainSurfaceReadModel(deps: MainSurfaceReadDependencies): MainSurfaceReadPort {
  return {
    readMainPage: (ctx, input) => readMainPage(deps, ctx, input),
    readRequestView: (ctx, input) => readRequestWithCards(deps, ctx, input),
  };
}

/** Both reads list one workspace: the one the call context is bound to. */
function boundWorkspace(ctx: CoreCallContext): WorkspaceScope | null {
  return ctx.workspaceId === undefined ? null : { projectId: ctx.projectId, workspaceId: ctx.workspaceId };
}

const UNBOUND = 'the main read and requests/read need a call context bound to a workspace';

/**
 * The `main/read` input, or why it is refused: `goalId` a goal id or null, and
 * `cursor` null or a cursor of the shape a page returns (both fields present).
 */
export function parseMainReadInput(input: unknown): MainReadInputV1 | string {
  if (!isRecord(input)) return 'main/read requires an input object';
  const goalId = input['goalId'];
  if (goalId !== null && !nonEmpty(goalId)) return 'main/read requires goalId: a goal id, or null for the no-goal view';
  const cursor = input['cursor'];
  if (cursor === null) return { goalId, cursor: null };
  if (!isRecord(cursor) || (cursor['phase'] !== 'goal' && cursor['phase'] !== 'pre'
    && cursor['phase'] !== 'bound' && cursor['phase'] !== 'source')
    || !nonEmpty(cursor['since']) || !nonEmpty(cursor['rootKey'])) {
    return 'main/read requires cursor: null or the next cursor a page returned';
  }
  return { goalId, cursor: { phase: cursor['phase'], since: cursor['since'] as CommitCursor, rootKey: cursor['rootKey'] } };
}

async function readRootPage(records: RecordOrderedLookupPort, request: OrderedLookupRequest):
Promise<{ status: 'ready'; value: RecordOrderedLookupPage } | CoreRejection> {
  try {
    const page = await records.lookupOrdered(request);
    return page.status === 'ready' ? page : storeFailureToRejection(page);
  } catch (error) {
    return rejected('unavailable', `the request roots could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `view` is the one read the source route already made for this row; it is the row's page projection too. */
type MainRootRowV1 = MainReadRowV1 & { requestRoot: QueryJobRef; view?: RequestCoreViewV1 };
type MainPhaseRowsV1 = { phase: MainReadRowV1['phase']; rows: readonly MainRootRowV1[] };

/** Same `rootKey` from several routes: the earlier phase keeps its row (`goal`, then `pre`, `bound`, `source`). */
const MAIN_PHASE_RANK: Record<MainReadRowV1['phase'], number> = { goal: 0, pre: 1, bound: 2, source: 3 };

/** One route's order: `since` descending, then `rootKey` descending. */
function compareMainRows(left: MainReadRowV1, right: MainReadRowV1): number {
  const bySince = compareCursors(left.since, right.since);
  if (bySince !== 0) return -bySince;
  if (left.rootKey !== right.rootKey) return left.rootKey > right.rootKey ? -1 : 1;
  return MAIN_PHASE_RANK[left.phase] - MAIN_PHASE_RANK[right.phase];
}

/**
 * The four routes of a Goal's page merged into the one page order: `(since desc, rootKey desc)`, each `rootKey` once
 * (the earlier phase wins: `goal`, `pre`, `bound`, `source`). Rows are already read with the same cursor, or filtered
 * by it; this only orders and deduplicates.
 */
export function mergeMainRows(routes: readonly MainPhaseRowsV1[]): MainRootRowV1[] {
  const all = routes.flatMap((route) => route.rows);
  const ordered = [...all].sort(compareMainRows);
  const seen = new Set<string>();
  return ordered.filter((row) => {
    if (seen.has(row.rootKey)) return false;
    seen.add(row.rootKey);
    return true;
  });
}

/** True when the row sorts strictly after `cursor` in page order (older, or the same `since` and a smaller key). */
function belowCursor(row: { since: CommitCursor; rootKey: string }, cursor: MainPageCursorV1): boolean {
  const bySince = compareCursors(row.since, cursor.since);
  return bySince !== 0 ? bySince < 0 : row.rootKey < cursor.rootKey;
}

/**
 * Up to `wanted` roots of one phase, newest first: its creation bounds both
 * exclusive (the upper one as the read's `bound`, the lower one as its
 * `lowerBound`). The page cursor is the same keyset for every route, so a page
 * continues in ONE order instead of skipping a route.
 */
async function readPhaseRows(
  records: RecordOrderedLookupPort,
  workspace: WorkspaceScope,
  phase: MainReadPhaseV1,
  cursor: MainPageCursorV1 | null,
  wanted: number,
): Promise<ReadResult<MainRootRowV1[]>> {
  const page = await readRootPage(records, {
    index: REQUEST_ROOTS_BY_GOAL_INDEX, direction: 'desc', limit: wanted,
    values: [workspace.projectId, workspace.workspaceId, REQUEST_ROOT_MARK, phase.goalSlot],
    ...(phase.createdBefore === null ? {} : { bound: { value: phase.createdBefore, inclusive: false } }),
    ...(phase.createdAfter === null ? {} : { lowerBound: { value: phase.createdAfter, inclusive: false } }),
    ...(cursor === null ? {} : { after: { order: cursor.since, refKey: cursor.rootKey } }),
  });
  if (page.status !== 'ready') return page;
  const rows: MainRootRowV1[] = [];
  for (const record of page.value.records) {
    const decoded = decodeQueryJobSnapshot(record);
    if (decoded.status !== 'decoded') return rejected('unavailable', `a request root is damaged: ${decoded.reason}`);
    rows.push({ phase: phase.phase, since: decoded.value.since, rootKey: record.refKey, requestRoot: decoded.value.ref });
  }
  return { status: 'ready', value: rows };
}

/**
 * The `bound` route: the request this Goal's one initialization binding names. A `goals/create` Goal has no binding;
 * a binding whose request root cannot be read, or cannot be decoded, is the read's failure. At most one row, and only
 * when it sorts after the page cursor.
 */
async function readBoundRows(
  deps: MainSurfaceReadDependencies, ctx: CoreCallContext, goalRef: GoalRef, cursor: MainPageCursorV1 | null,
): Promise<ReadResult<MainRootRowV1[]>> {
  const creation = await readGoalCreationRequest(deps.records, ctx, goalRef);
  if (creation.status !== 'ready') return creation;
  if (creation.value === null) return { status: 'ready', value: [] };
  const requestRef = creation.value.requestRef;
  const root = await readOwnerRecord({ store: deps.records, refKey: keyOf(requestRef),
    decode: decodeQueryJobSnapshot,
    readError: message => rejected('unavailable', `the Goal's request could not be read: ${message}`) });
  if (!root.ok) {
    return 'rejection' in root ? root.rejection
      : rejected('unavailable', `the Goal's request ${requestRef.queryJobId} is missing`);
  }
  const row: MainRootRowV1 = { phase: 'bound', since: root.value.since,
    rootKey: keyOf(requestRef), requestRoot: root.value.ref };
  return { status: 'ready', value: cursor === null || belowCursor(row, cursor) ? [row] : [] };
}

/**
 * The `source` route: no-goal roots created after this Goal that name it in `interventionSource` and still have no
 * effective Goal. The scan counts EVERY no-goal root from the Goal's creation on, matched or not; more than
 * `MAIN_SOURCE_SCAN_MAX` fails the read instead of truncating. `pending` is the complete matched count.
 */
async function readSourceRows(
  deps: MainSurfaceReadDependencies, ctx: CoreCallContext, workspace: WorkspaceScope,
  goal: GoalSnapshot, cursor: MainPageCursorV1 | null,
): Promise<ReadResult<{ rows: MainRootRowV1[]; pending: number }>> {
  /* The store pages an ordered read at 200 records; keep reading keysets until the scan bound or the end. */
  const roots: RecordOrderedLookupPage['records'] = [];
  let scanAfter: { order: string | number; refKey: string } | undefined;
  for (;;) {
    const page = await readRootPage(deps.records, {
      index: REQUEST_ROOTS_BY_GOAL_INDEX, direction: 'desc',
      limit: Math.min(REQUEST_PAGE_SIZE, MAIN_SOURCE_SCAN_MAX + 1 - roots.length),
      values: [workspace.projectId, workspace.workspaceId, REQUEST_ROOT_MARK, requestGoalSlot(null)],
      lowerBound: { value: goal.since, inclusive: false },
      ...(scanAfter === undefined ? {} : { after: scanAfter }),
    });
    if (page.status !== 'ready') return page;
    roots.push(...page.value.records);
    if (roots.length > MAIN_SOURCE_SCAN_MAX) {
      return rejected('unavailable',
        `超过 ${String(MAIN_SOURCE_SCAN_MAX)} 个 no-goal 根：主对话读不能给出这个 Goal 的完整来源请求计数`);
    }
    const next = page.value.next;
    if (next === null) break;
    scanAfter = next;
  }
  const rows: MainRootRowV1[] = [];
  let pending = 0;
  for (const record of roots) {
    const decoded = decodeQueryJobSnapshot(record);
    if (decoded.status !== 'decoded') return rejected('unavailable', `a request root is damaged: ${decoded.reason}`);
    const source = decoded.value.job.interventionSource;
    if (source === undefined || source.goalRef.goalId !== goal.ref.goalId) continue;
    const view = await deps.requests.readRequest(ctx, { requestRoot: decoded.value.ref });
    if (view.status === 'not_found') {
      return rejected('unavailable', `the indexed request root ${record.refKey} reads as no request`);
    }
    if (view.status !== 'ready') return view;
    if (view.value.effectiveGoalId !== null) continue;
    pending += 1;
    const row: MainRootRowV1 = { phase: 'source', since: decoded.value.since,
      rootKey: record.refKey, requestRoot: decoded.value.ref, view: view.value };
    if (cursor === null || belowCursor(row, cursor)) rows.push(row);
  }
  return { status: 'ready', value: { rows, pending } };
}

async function readMainPage(
  deps: MainSurfaceReadDependencies,
  ctx: CoreCallContext,
  input: MainReadInputV1,
): Promise<ReadResult<MainPageV1>> {
  const workspace = boundWorkspace(ctx);
  if (workspace === null) return rejected('forbidden', UNBOUND);
  const parsed = parseMainReadInput(input);
  if (typeof parsed === 'string') return rejected('invalid', parsed);
  const goals = await readGoalsByWorkspaceCreated(deps.records, workspace);
  if (goals.status !== 'ready') return goals;
  const selected = parsed.goalId === null ? null
    : goals.goals.find((goal) => goal.ref.goalId === parsed.goalId) ?? null;
  if (parsed.goalId !== null && selected === null) return { status: 'not_found' };
  const first = goals.goals[0];
  const phases = mainReadPhases({ goalId: parsed.goalId,
    firstGoal: first === undefined ? null : { goalId: first.ref.goalId, since: first.since } });
  const start = mainReadStart(phases, parsed.cursor);
  if (start === null) return rejected('invalid', 'the cursor names a part of the page this view does not have');

  const routes: MainPhaseRowsV1[] = [];
  for (const phase of phases) {
    const rows = await readPhaseRows(deps.records, workspace, phase, parsed.cursor, MAIN_PAGE_SIZE + 1);
    if (rows.status !== 'ready') return rows;
    routes.push({ phase: phase.phase, rows: rows.value });
  }
  let pendingSourceRequests = 0;
  if (selected !== null) {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId: selected.ref.goalId };
    const bound = await readBoundRows(deps, ctx, goalRef, parsed.cursor);
    if (bound.status !== 'ready') return bound;
    routes.push({ phase: 'bound', rows: bound.value });
    const source = await readSourceRows(deps, ctx, workspace, selected, parsed.cursor);
    if (source.status !== 'ready') return source;
    routes.push({ phase: 'source', rows: source.value.rows });
    pendingSourceRequests = source.value.pending;
  }
  const step = mainPageStep(mergeMainRows(routes), MAIN_PAGE_SIZE);
  const views: RequestCoreViewV1[] = [];
  for (const row of step.shown) {
    // The source route already read its own view for the attribution test; the page counts, sorts and projects that
    // one read, never a second read of the same root between which the card could be confirmed.
    if (row.view !== undefined) {
      views.push(row.view);
      continue;
    }
    const view = await deps.requests.readRequest(ctx, { requestRoot: row.requestRoot });
    if (view.status === 'not_found') return rejected('unavailable', `the indexed request root ${row.rootKey} reads as no request`);
    if (view.status !== 'ready') return view;
    views.push(view.value);
  }

  const goalRef: GoalRef | null = parsed.goalId === null ? null
    : { aggregateType: 'Goal', projectId: ctx.projectId, goalId: parsed.goalId };
  // The no-goal view still reads notices: the project's lines are the page's common part (`goalRef: null`).
  const whole = await deps.decisions.readWholePage(ctx, { workspace, notices: { goalRef } });
  if (whole.status !== 'ready') return whole;
  const listed = pageCards(whole.value.cards, views, goalRef, ctx.projectId);
  // The no-goal view has no receipts; a Goal view reads them, and omits them only when no node review owner is wired.
  let nodeReceipts: NodeReviewReceiptV1[] | undefined = goalRef === null ? [] : undefined;
  if (goalRef !== null && deps.nodeCommits !== undefined) {
    const read = await deps.nodeCommits.readNodeReceipts(ctx, { goalRef });
    if (read.status !== 'ready') return read;
    nodeReceipts = read.value.receipts;
  }
  return { status: 'ready', value: {
    goalId: parsed.goalId,
    requests: views.map((view, index) => ({ ...view, cardKeys: listed.cardKeys[index]! })),
    cards: listed.cards,
    notices: whole.value.notices,
    seenThrough: whole.value.seenThrough,
    displayToken: whole.value.displayToken,
    pendingSourceRequests,
    next: step.next,
    ...(nodeReceipts === undefined ? {} : { nodeReceipts }),
  } };
}

/**
 * §2.8/T37: the one read-time feedback projection. Actions are read by their
 * stored intake `basis.requestRoot` (the action lookup), so a later dispatch on
 * the same Task cannot hide an earlier one and no current-plan slot decides the
 * answer. Holds are the workspace's `TaskClaimHold` records, filtered by the
 * FULL request root on the reason itself. A request with no Goal still reads
 * both, and a Goal's plan change adds the plan revision and the Tasks its delta
 * touched. No write command and no stored feedback are added.
 */
async function readRequestFeedback(
  deps: MainSurfaceReadDependencies,
  ctx: CoreCallContext,
  requestRoot: QueryJobRef,
  view: RequestCoreViewV1,
): Promise<ReadResult<RequestFeedbackV1>> {
  const workspace = boundWorkspace(ctx);
  if (workspace === null) return rejected('forbidden', UNBOUND);
  const rootKey = keyOf(requestRoot);
  const affectedTasks: TaskTriple[] = [];
  const actions: RequestFeedbackActionV1[] = [];
  const taskKeys = new Set<string>();
  const actionKeys = new Set<string>();
  const addTask = (task: TaskTriple): void => {
    const key = keyOf(task);
    if (taskKeys.has(key)) return;
    taskKeys.add(key);
    affectedTasks.push(structuredClone(task));
  };
  const addFeedbackAction = (action: RequestFeedbackActionV1, key: string): void => {
    if (actionKeys.has(key)) return;
    actionKeys.add(key);
    actions.push(action);
  };

  // S-2: the request's holds may sit on another workspace's Goal of the project; the root filter below selects them.
  const holds = await readTaskClaimHoldsInProject(deps.records, workspace.projectId);
  if (holds.status !== 'ready') return holds;
  for (const hold of holds.holds) {
    const task: TaskTriple = { projectId: hold.ref.projectId, goalId: hold.ref.goalId, taskId: hold.ref.taskId };
    for (const reason of hold.reasons) {
      if (reason.basis.kind !== 'round' || reason.basis.requestRoot === null
        || keyOf(reason.basis.requestRoot) !== rootKey) continue;
      // A stop reason is the same action as its request: the request row below carries its outcome.
      if (reason.placedBy.kind === 'action') continue;
      const placedBy = reason.placedBy;
      addTask(task);
      addFeedbackAction({
        kind: 'hold', task: structuredClone(task), reason: reason.reason, actionRef: null,
        holdKind: reason.kind, holdState: reason.state,
        heldBy: placedBy.kind === 'agent' ? structuredClone(placedBy.session) : null,
        placedAt: reason.placedAt, requestState: null, notSent: null, planVersion: null,
        claimedBy: null, stopRun: null,
      }, `hold:${keyOf(task)}:${reason.id}`);
    }
  }

  const requests = await readActionRequestsByRequestRoot(deps.records, requestRoot);
  if (requests.status !== 'ready') return requests;
  for (const request of requests.records) {
    const outcome = request.outcome;
    addTask(request.task);
    // One decode of the stored three values per request: the row carries them, the list does not repeat them.
    addFeedbackAction({
      kind: request.kind, task: structuredClone(request.task), reason: request.reason,
      actionRef: structuredClone(request.ref), holdKind: null, holdState: null, heldBy: null, placedAt: null,
      requestState: request.state,
      notSent: outcome?.kind === 'released' ? outcome.notSent : null,
      planVersion: storedDispatchBasis(request.expected),
      claimedBy: outcome?.kind === 'applied'
        ? { session: structuredClone(outcome.session), run: structuredClone(outcome.run) } : null,
      stopRun: request.frozen === null ? null : structuredClone(request.frozen.run),
    }, `action:${keyOf(request.ref)}`);
  }

  const goalId = view.effectiveGoalId ?? view.goalId;
  if (goalId === null) return { status: 'ready', value: { affectedTasks, actions, planRevision: null } };
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
  const goalRead = await readGoal(deps.records, goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  const planChange = await requestPlanChangeOf(deps, ctx, goalRead.goal, view, requestRoot);
  if (planChange.status !== 'ready') return planChange;
  for (const taskId of planChange.value?.affectedTaskIds ?? []) {
    addTask({ projectId: goalRef.projectId, goalId: goalRef.goalId, taskId });
  }
  return { status: 'ready', value: {
    affectedTasks, actions, planRevision: planChange.value?.planRevision ?? null } };
}

type RequestPlanChangeV1 = {
  /** Absent while the candidate waits or went stale; the adopted target once accepted. */
  planRevision: PlanRevisionRef | null;
  /**
   * The Tasks the adopted plan change added, changed, or actually moved to another disposition (all of a first
   * plan); empty for a candidate that was not adopted. A Task already terminal in the base plan is not "touched".
   */
  affectedTaskIds: string[];
};

/**
 * §2.8: the plan change this request contributed. The request view's live head
 * stays the first choice; a closed (`accepted`/`not_adopted`) head is the Goal's
 * closed-candidate history keyed by the official request root. A candidate the
 * secretary forwarded to an adviser keeps this request's root on the SOURCE
 * message while its `requestRef` is the adviser's planning Query, so the
 * remaining candidates are attributed by EITHER root. A root with no candidate
 * has no plan evidence to report.
 */
async function requestPlanChangeOf(
  deps: MainSurfaceReadDependencies,
  ctx: CoreCallContext,
  goal: GoalSnapshot,
  view: RequestCoreViewV1,
  requestRoot: QueryJobRef,
): Promise<ReadResult<RequestPlanChangeV1 | null>> {
  const rootKey = keyOf(requestRoot);
  let proposal: PlanProposal | null = null;
  if (view.candidate !== null) {
    const liveRead = await readProposal(deps.records, view.candidate.proposalRef);
    if (liveRead.status !== 'ready') return liveRead;
    const owned = await candidateIsOfRequest(deps, ctx, goal, liveRead.proposal, rootKey);
    if (owned.status !== 'ready') return owned;
    if (owned.value) proposal = liveRead.proposal;
  }
  if (proposal === null) {
    const closed = await enumerateClosedGoalCandidates(deps.records, goal.ref);
    if (closed.status !== 'ready') return closed;
    proposal = closed.proposals.find((entry) => {
      const candidateRoot = candidateRequestRef(entry);
      return candidateRoot !== null && keyOf(candidateRoot) === rootKey;
    }) ?? null;
  }
  if (proposal === null) {
    const forwarded = await candidateFromSourceRequestRoot(deps, ctx, goal, rootKey);
    if (forwarded.status !== 'ready') return forwarded;
    proposal = forwarded.value;
  }
  if (proposal === null) return { status: 'ready', value: null };
  const adopted = proposal.status === 'accepted';
  const planRevision = adopted ? planRevisionTargetOf(proposal.ref, proposal.draft) : proposal.basedOn;
  if (!adopted) return { status: 'ready', value: { planRevision, affectedTaskIds: [] } };
  if (proposal.basedOn === null) {
    return { status: 'ready', value: { planRevision,
      affectedTaskIds: proposal.draft.tasks.map((task) => task.taskId) } };
  }
  const source = await readPlan(deps.records, proposal.basedOn);
  if (source.status !== 'ready') return source;
  const delta = deriveFuturePlanDelta(source.plan, proposal.draft);
  if (delta.status !== 'supported') {
    return rejected('unavailable', `the candidate plan change cannot be derived: ${delta.reason}`);
  }
  const affectedTaskIds = new Set<string>([
    ...delta.delta.changedTaskIds, ...delta.delta.addedTaskIds, ...delta.delta.dispositionOnlyTaskIds,
  ]);
  return { status: 'ready', value: { planRevision, affectedTaskIds: [...affectedTaskIds] } };
}

/**
 * A candidate belongs to this request by its official root, or by the root stored on the message it came from (a
 * different root there is a different request). A successor through `planfix`/`planresume` after a hand-off comes from
 * a system round that stores no root, so the trusted source chain (`planSourceRoot`, the claim owner's one instance)
 * leads back to the first message, whose root decides (design 3.3), looked up in the Goal's workspace (design :554:
 * the system round's send receipt lives there; the caller's Goal read gives it). Every read failure is the failure.
 */
async function candidateIsOfRequest(
  deps: MainSurfaceReadDependencies, ctx: CoreCallContext, goal: GoalSnapshot, proposal: PlanProposal, rootKey: string,
): Promise<ReadResult<boolean>> {
  const official = candidateRequestRef(proposal);
  if (official !== null && keyOf(official) === rootKey) return { status: 'ready', value: true };
  const source = proposal.sourceMessageRef;
  if (source === null) return { status: 'ready', value: false };
  const direct = await messageRequestRoot(deps.records, source);
  if (direct.status !== 'ready') return direct;
  if (direct.value !== null) return { status: 'ready', value: keyOf(direct.value) === rootKey };
  const first = await deps.planSourceRoot.messageRoot(ctx, source, goal.workspaceRef.workspaceId);
  if (first.status !== 'ready') return first;
  if (sessionMessageRefKey(first.value) === sessionMessageRefKey(source)) return { status: 'ready', value: false };
  const firstRoot = await messageRequestRoot(deps.records, first.value);
  if (firstRoot.status !== 'ready') return firstRoot;
  return { status: 'ready', value: firstRoot.value !== null && keyOf(firstRoot.value) === rootKey };
}

/** The root stored on one message, through the one read (`storedMessageRequestRoot`); a missing message fails. */
async function messageRequestRoot(
  records: MainSurfaceReadDependencies['records'], message: SessionMessageRef,
): Promise<ReadResult<QueryJobRef | null>> {
  const read = await storedMessageRequestRoot(records, message);
  if (read.ok) return { status: 'ready', value: read.value };
  return 'rejection' in read ? read.rejection
    : rejected('unavailable', `the source message ${message.messageId} of the candidate was not found`);
}

/**
 * The leftover case after the request's own live/closed heads: a forwarded candidate whose `requestRef` names the
 * adviser's planning Query. A replaced predecessor is skipped (its successor carries the change). A live candidate
 * wins over the closed ones; within a tier the latest by the candidate's OWN creation (`createdSince`) wins, and an
 * old record without it ranks last. The closed history and the advancing order keep the chain's first `since`.
 */
async function candidateFromSourceRequestRoot(
  deps: MainSurfaceReadDependencies, ctx: CoreCallContext, goal: GoalSnapshot, rootKey: string,
): Promise<ReadResult<PlanProposal | null>> {
  const all = await enumerateGoalCandidates(deps.records, goal.ref, { status: 'any' });
  if (all.status !== 'ready') return all;
  let best: ForwardedCandidate | null = null;
  for (const candidate of all.proposals) {
    if (candidate.status === 'not_adopted' && candidate.notAdopted?.reason === 'replaced') continue;
    const owned = await candidateIsOfRequest(deps, ctx, goal, candidate, rootKey);
    if (owned.status !== 'ready') return owned;
    if (!owned.value) continue;
    const origin = await readProposalOrigin(deps.records, candidate.ref);
    if (origin.status !== 'ready') return origin;
    const entry: ForwardedCandidate = {
      proposal: candidate, live: candidate.status === 'candidate', createdSince: origin.origin.createdSince };
    if (best === null || outranks(entry, best)) best = entry;
  }
  return { status: 'ready', value: best === null ? null : best.proposal };
}

type ForwardedCandidate = { proposal: PlanProposal; live: boolean; createdSince: CommitCursor | undefined };

/** The live tier first; within a tier the later own creation; a missing `createdSince` ranks last. */
function outranks(entry: ForwardedCandidate, best: ForwardedCandidate): boolean {
  if (entry.live !== best.live) return entry.live;
  if (entry.createdSince === undefined) return false;
  return best.createdSince === undefined || compareCursors(entry.createdSince, best.createdSince) > 0;
}

async function readRequestWithCards(
  deps: MainSurfaceReadDependencies,
  ctx: CoreCallContext,
  input: { requestRoot: QueryJobRef },
): Promise<ReadResult<RequestReadV1>> {
  const workspace = boundWorkspace(ctx);
  if (workspace === null) return rejected('forbidden', UNBOUND);
  const raw = input as unknown;
  if (!isRecord(raw) || !isRecord(raw['requestRoot'])) return rejected('invalid', 'requests/read requires a requestRoot');
  const view = await deps.requests.readRequest(ctx, { requestRoot: input.requestRoot });
  if (view.status !== 'ready') return view;
  const whole = await deps.decisions.readWholePage(ctx, { workspace, notices: null });
  if (whole.status !== 'ready') return whole;
  const feedback = await readRequestFeedback(deps, ctx, input.requestRoot, view.value);
  if (feedback.status !== 'ready') return feedback;
  return { status: 'ready', value: { ...view.value, cards: requestCards(whole.value.cards, view.value, ctx.projectId),
    feedback: feedback.value } };
}
