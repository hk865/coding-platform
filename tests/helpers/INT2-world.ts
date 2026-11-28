/**
 * The INT2 R2 rows' shared public steps (int2-rulings §3.1): the ordinary input-box submit on an ended Goal, one
 * `requests/read`, the `goals/display` phase and the `tasks/query` completion. Every step is a published route
 * through the real Host; no store is read and no record is built here.
 */
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { TaskGraph } from '../../src/contracts/task-graph.js';
import type { GoalDisplayPhase } from '../../src/core/work-graph/state/goal-machine.js';
import type { MainPageCursorV1, MainPageV1, RequestReadV1 } from '../../src/core/work-graph/views/main-surface-read-model.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { heartbeatUntil } from './IV-host-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { roundStatus, secretaryAnswer } from './S6A-history-fixture.js';
import { S6A_SCOPE, type S6AHttpAnswer, type S6ASession } from './S6A-request-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from './request-claim-steps.js';
import { committed, ready } from './S7A-fixture.js';

/**
 * `requests/submit` of R2's ordinary input: an ended Goal, `continues: null`, `recipient: null`, no references. It wraps
 * the Host's own `submit` (`S6A-host-fixture.ts:897`); that step omits `references`, which the route defaults to `[]`
 * (`request-service.ts:376`), so the frozen body is the same.
 */
export async function int2SubmitEndedGoalRequest(world: Pick<S6AHostWorld, 'submit'>,
  input: { commandId: string; goal: GoalRef; text: string }):
Promise<Extract<RequestSubmitResultV1, { status: 'queued' }>> {
  const answer = await world.submit({ commandId: input.commandId, goalId: input.goal.goalId,
    text: input.text, continues: null, recipient: null });
  if (answer.status !== 'queued') {
    throw new Error(`INT2: the submit ${input.commandId} was refused: ${JSON.stringify(answer)}`);
  }
  return answer;
}

/** One request root through the `requests/read` route. */
export const int2RequestView = async (world: Pick<S6AHostWorld, 'post'>, requestRoot: QueryJobRef):
Promise<RequestReadV1> => ready<RequestReadV1>(
  await world.post('requests/read', plain(S6A_SCOPE, { requestRoot })), 'requests/read');

/** The Goal's display phase through `goals/display`. */
export const int2GoalPhase = async (world: Pick<S6AHostWorld, 'post'>, goal: GoalRef): Promise<GoalDisplayPhase> =>
  ready<{ display: { phase: GoalDisplayPhase } }>(
    await world.post('goals/display', plain(S6A_SCOPE, { goalRef: goal })), 'goals/display').display.phase;

/** The Goal's recorded completion through `tasks/query` (absent when it has none). */
export const int2GoalCompletion = async (world: Pick<S6AHostWorld, 'post'>, goal: GoalRef):
Promise<TaskGraph['completion']> =>
  ready<TaskGraph>(await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal })), 'tasks/query').completion;

// ---------------------------------------------------------------------------
// The read rows' steps (int2-rulings §3.2)
// ---------------------------------------------------------------------------

/** The page shape §I-2 freezes: the four-phase continuation and the complete count of the Goal's source requests. */
export type Int2PageCursor = Omit<MainPageCursorV1, 'phase'> & { phase: 'goal' | 'pre' | 'bound' | 'source' };
export type Int2Page = Omit<MainPageV1, 'next'> & { next: Int2PageCursor | null; pendingSourceRequests: number };

/**
 * `main/read` of a named Goal's page (or the no-goal page) and of the page its `next` names. The existing
 * `intAwaitNoGoalRequest` (`INT-world.ts:53`) polls only the no-goal view, and the local `readMain`
 * (`tests/app/S6A-main-read.test.ts:76`) belongs to the cards fixture, not a Host; neither reads a Goal page.
 */
export const int2ReadPage = async (world: Pick<S6AHostWorld, 'post'>,
  input: { goalId: string | null; cursor?: Int2PageCursor | null }): Promise<Int2Page> =>
  ready<Int2Page>(await world.post('main/read', plain(S6A_SCOPE,
    { goalId: input.goalId, cursor: input.cursor ?? null })), 'main/read');

/**
 * The public secretary steps of the RD rows: script one answer (two ideas when asked, one Goal card unless `card: false`),
 * claim and start its round, wait for its end, and optionally confirm the card. The `INT2-r2.test.ts:100-110` sequence
 * is inline and answers ideas only; `intStartNewGoalFromLine` (`INT-world.ts:126`) also sends a line message, routes the
 * request and adopts a plan; `holdS6B3DraftAnswer` (`S6B3-fixture.ts:491`) holds an ungoverned round for a release.
 */
export async function int2AnswerWithGoalCard(world: S6AHostWorld, input: {
  label: string;
  submitted: { requestRoot: QueryJobRef; round: QueryJobRef };
  secretary: S6ASession;
  /** The round this answer serves; the submitted round unless a selected idea opened a follow-up. */
  round?: QueryJobRef;
  ideas?: boolean;
  /** `false`: the ideas-only round the lead requires (no Goal card); the next round offers the card. */
  card?: boolean;
  confirm?: { commandId: string };
}): Promise<{ cardIndex: number | null; newGoal: GoalRef | null }> {
  const answeredRound = input.round ?? input.submitted.round;
  await world.scripted.script(input.secretary, [{ kind: 'text', text: secretaryAnswer({
    body: `INT2 ${input.label} answer`,
    ideas: input.ideas === true
      ? [{ title: `INT2 ${input.label} idea 1`, detail: `INT2 ${input.label} detail 1` },
        { title: `INT2 ${input.label} idea 2`, detail: `INT2 ${input.label} detail 2` }]
      : [],
    goalCardDrafts: input.card === false ? []
      : [{ objective: `INT2 ${input.label} Goal`, completion: [`INT2 ${input.label} done`],
        autonomy: 'after_plan_confirmation', screening: null }],
  }) }]);
  const claimed = await claimWithSecretaryProfile(world, answeredRound, input.secretary, `${input.label}-claim`);
  if (claimed['status'] !== 'committed') {
    throw new Error(`INT2: ${input.label} did not claim its round: ${JSON.stringify(claimed)}`);
  }
  const prepared = await prepareAttempt(world, answeredRound, `${input.label}-prepare`);
  const started = await start(world, prepared, `${input.label}-start`);
  if (started['status'] !== 'ready') {
    throw new Error(`INT2: ${input.label} did not start its round: ${JSON.stringify(started)}`);
  }
  await heartbeatUntil(world, () => int2RequestView(world, input.submitted.requestRoot),
    view => roundStatus(view, answeredRound) === 'ended');
  const view = await int2RequestView(world, input.submitted.requestRoot);
  const drafts = view.rounds.find(round => round.ref.queryJobId === answeredRound.queryJobId)
    ?.goalCardDrafts ?? [];
  const cardIndex = drafts[0]?.index ?? null;
  if (input.confirm === undefined) return { cardIndex, newGoal: null };
  // A Goal card only lands on a goal-less request (`answer-tools.ts:332`); before R2 exists the round on the ended
  // Goal answers no card, and the confirm rows say so instead of fabricating one.
  if (drafts.length !== 1) {
    throw new Error(`INT2: ${input.label} answered ${String(drafts.length)} Goal cards, so there is no card to confirm`);
  }
  const receipt = committed<GoalConfirmDraftReceiptV1>(await world.post('goals/confirm-draft', plain(S6A_SCOPE, {
    commandId: input.confirm.commandId, round: answeredRound, index: cardIndex!,
  })), `${input.label} Goal card`);
  return { cardIndex, newGoal: receipt.goal.ref };
}

// ---------------------------------------------------------------------------
// The L8 rows' step (int2-rulings §3.3)
// ---------------------------------------------------------------------------

/**
 * One `goals/binding` answer, raw: its body is the `GoalRef` itself (`int2-rulings.md:235`), and today no such route is
 * published, so the row reads the Host's 404 body itself instead of a `ready` helper throwing. No existing helper posts
 * this route: `int2RequestView` (`:38`) and `int2GoalPhase` (`:43`) read `requests/read` and `goals/display`, and
 * `readS6B3BindingPort` (`S6B3-fixture.ts:1143`) is the platform's owner property, not the route.
 */
export const int2GoalBinding = (world: Pick<S6AHostWorld, 'post'>, goal: GoalRef): Promise<S6AHttpAnswer> =>
  world.post('goals/binding', plain(S6A_SCOPE, goal));

/**
 * The Goal each card of `page` belongs to, in page order: its subject's Goal, else the `effectiveGoalId` of the page
 * request whose round the card names; `null` for a project card or an unassigned request. `requestCards`/`pageCards`
 * (`main-surface-read-model.ts:200-253`) build the page but publish no ownership, and RD-3/RD-4 must check every card.
 */
export function int2CardGoalIds(page: Int2Page): (string | null)[] {
  const effective = new Map<string, string | null>();
  for (const request of page.requests) {
    for (const round of request.rounds) effective.set(canonicalKey(round.ref), request.effectiveGoalId);
  }
  return page.cards.map(card => {
    if (card.subject.kind === 'goal') return card.subject.goalRef.goalId;
    if (card.requestRef !== null && effective.has(canonicalKey(card.requestRef))) {
      return effective.get(canonicalKey(card.requestRef)) ?? null;
    }
    return null;
  });
}
