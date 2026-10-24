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
 * name no request); a page lists the selected Goal's own cards, then each
 * request's, each card once, and its requests name them by `cardKey`. The page's
 * notices are the selected Goal's lines with that Goal's automatic reworks
 * folded, and the seen advance and display token the page allows; the no-goal
 * view shows none. Reading writes nothing.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';

import type { NoticeCategoryV1, NoticePositionV1 } from '../../../contracts/goal-decisions.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { OrderedLookupRequest, RecordOrderedLookupPage, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { DecisionCardV1, NoticeItemV1 } from '../model/decision-contracts.js';
import {
  REQUEST_ROOT_MARK, REQUEST_ROOTS_BY_GOAL_INDEX, requestGoalSlot, type RequestCoreViewV1,
} from '../model/request-contracts.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import { keyOf } from '../queries/request-round-claims.js';
import { readGoalsByWorkspaceCreated } from '../tasks/plan-readers.js';
import type { RequestFactsPort } from '../tasks/request-facts.js';
import { cardInScope, type DecisionWholePageReader } from './decision-read-model.js';

// ------------------------------------------------------------------------ //
// Read shapes                                                               //
// ------------------------------------------------------------------------ //

/** The continuation of a main page: the last shown row's phase, `since` and root key. */
export type MainPageCursorV1 = { phase: 'goal' | 'pre'; since: CommitCursor; rootKey: string };

export type MainPageV1 = { goalId: string | null;
  requests: (RequestCoreViewV1 & { cardKeys: string[] })[];
  cards: DecisionCardV1[];
  notices: (NoticeItemV1 & { memberViews?: NoticeItemV1[] })[];
  seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>; displayToken: string | null;
  next: MainPageCursorV1 | null };

export type RequestReadV1 = RequestCoreViewV1 & { cards: DecisionCardV1[] };

/** `main/read`: one Goal's view (null: the no-goal view) and null or the `next` a previous page returned. */
export type MainReadInputV1 = { goalId: string | null; cursor: MainPageCursorV1 | null };

export interface MainSurfaceReadPort {
  readMainPage(ctx: CoreCallContext, input: MainReadInputV1): Promise<ReadResult<MainPageV1>>;
  readRequestView(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<RequestReadV1>>;
}

export type MainSurfaceReadDependencies = {
  records: RecordOrderedLookupPort;
  requests: Pick<RequestFactsPort, 'readRequest'>;
  decisions: DecisionWholePageReader;
};

/** slice-6-SPEC L6: one page holds 20 requests. */
const MAIN_PAGE_SIZE = 20;

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
export type MainReadRowV1 = { phase: 'goal' | 'pre'; since: CommitCursor; rootKey: string };

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
 * A request's cards (slice-6-SPEC L6): the cards whose `requestRef` names one of
 * its rounds and, when it has an effective Goal, that Goal's own cards. A
 * no-goal request matches by `requestRef` only. The order is the assembly's.
 */
export function requestCards(
  cards: readonly DecisionCardV1[],
  request: { rounds: readonly { ref: QueryJobRef }[]; effectiveGoalId: string | null },
  projectId: string,
): DecisionCardV1[] {
  const rounds = new Set(request.rounds.map((round) => keyOf(round.ref)));
  const goal: GoalRef | null = request.effectiveGoalId === null ? null
    : { aggregateType: 'Goal', projectId, goalId: request.effectiveGoalId };
  return cards.filter((card) => (card.requestRef !== null && rounds.has(keyOf(card.requestRef)))
    || (goal !== null && goalSourceCard(card, goal)));
}

/**
 * A page's cards: the selected Goal's own cards, then each request's, each card
 * once by `cardKey` (the first occurrence keeps its place); every request names
 * its own cards by key.
 */
export function pageCards(
  cards: readonly DecisionCardV1[],
  requests: readonly { rounds: readonly { ref: QueryJobRef }[]; effectiveGoalId: string | null }[],
  goal: GoalRef | null,
  projectId: string,
): { cards: DecisionCardV1[]; cardKeys: string[][] } {
  const perRequest = requests.map((request) => requestCards(cards, request, projectId));
  const listed: DecisionCardV1[] = [];
  const keys = new Set<string>();
  const listOnce = (card: DecisionCardV1): void => {
    if (keys.has(card.cardKey)) return;
    keys.add(card.cardKey);
    listed.push(card);
  };
  if (goal !== null) for (const card of cards) if (goalSourceCard(card, goal)) listOnce(card);
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
  if (!isRecord(cursor) || (cursor['phase'] !== 'goal' && cursor['phase'] !== 'pre')
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

type MainRootRowV1 = MainReadRowV1 & { requestRoot: QueryJobRef };

/**
 * Up to `wanted` roots from the start phase on, newest first: one descending
 * read per phase, its creation bounds both exclusive (the upper one as the
 * read's `bound`, the lower one as its `lowerBound`), the cursor's keyset only
 * in the phase it names.
 */
async function readRows(
  records: RecordOrderedLookupPort,
  workspace: WorkspaceScope,
  phases: readonly MainReadPhaseV1[],
  start: number,
  cursor: MainPageCursorV1 | null,
  wanted: number,
): Promise<ReadResult<MainRootRowV1[]>> {
  const rows: MainRootRowV1[] = [];
  for (let index = start; index < phases.length && rows.length < wanted; index += 1) {
    const phase = phases[index]!;
    const page = await readRootPage(records, {
      index: REQUEST_ROOTS_BY_GOAL_INDEX, direction: 'desc', limit: wanted - rows.length,
      values: [workspace.projectId, workspace.workspaceId, REQUEST_ROOT_MARK, phase.goalSlot],
      ...(phase.createdBefore === null ? {} : { bound: { value: phase.createdBefore, inclusive: false } }),
      ...(phase.createdAfter === null ? {} : { lowerBound: { value: phase.createdAfter, inclusive: false } }),
      ...(index === start && cursor !== null ? { after: { order: cursor.since, refKey: cursor.rootKey } } : {}),
    });
    if (page.status !== 'ready') return page;
    for (const record of page.value.records) {
      const decoded = decodeQueryJobSnapshot(record);
      if (decoded.status !== 'decoded') return rejected('unavailable', `a request root is damaged: ${decoded.reason}`);
      rows.push({ phase: phase.phase, since: decoded.value.since, rootKey: record.refKey, requestRoot: decoded.value.ref });
    }
  }
  return { status: 'ready', value: rows };
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
  if (parsed.goalId !== null && !goals.goals.some((goal) => goal.ref.goalId === parsed.goalId)) return { status: 'not_found' };
  const first = goals.goals[0];
  const phases = mainReadPhases({ goalId: parsed.goalId,
    firstGoal: first === undefined ? null : { goalId: first.ref.goalId, since: first.since } });
  const start = mainReadStart(phases, parsed.cursor);
  if (start === null) return rejected('invalid', 'the cursor names a part of the page this view does not have');

  const rows = await readRows(deps.records, workspace, phases, start, parsed.cursor, MAIN_PAGE_SIZE + 1);
  if (rows.status !== 'ready') return rows;
  const step = mainPageStep(rows.value, MAIN_PAGE_SIZE);
  const views: RequestCoreViewV1[] = [];
  for (const row of step.shown) {
    const view = await deps.requests.readRequest(ctx, { requestRoot: row.requestRoot });
    if (view.status === 'not_found') return rejected('unavailable', `the indexed request root ${row.rootKey} reads as no request`);
    if (view.status !== 'ready') return view;
    views.push(view.value);
  }

  const goalRef: GoalRef | null = parsed.goalId === null ? null
    : { aggregateType: 'Goal', projectId: ctx.projectId, goalId: parsed.goalId };
  const whole = await deps.decisions.readWholePage(ctx, { workspace, notices: goalRef === null ? null : { goalRef } });
  if (whole.status !== 'ready') return whole;
  const listed = pageCards(whole.value.cards, views, goalRef, ctx.projectId);
  return { status: 'ready', value: {
    goalId: parsed.goalId,
    requests: views.map((view, index) => ({ ...view, cardKeys: listed.cardKeys[index]! })),
    cards: listed.cards,
    notices: whole.value.notices,
    seenThrough: whole.value.seenThrough,
    displayToken: whole.value.displayToken,
    next: step.next,
  } };
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
  return { status: 'ready', value: { ...view.value, cards: requestCards(whole.value.cards, view.value, ctx.projectId) } };
}
