import type { GoalConfirmDraftReceiptV1 } from '../../../src/contracts/goal-card.js';
import type { GoalRef } from '../../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../../src/contracts/query-job.js';
import type { RequestReadV1 } from '../../../src/core/work-graph/views/main-surface-read-model.js';
import { openS6AHostWorld, type S6AHostWorld } from '../../helpers/S6A-host-fixture.js';
import {
  answeredRound, followUp, initializeProject, newRequest, secretaryAnswer, submitRound, waitForRound, type S6AIdea,
} from '../../helpers/S6A-history-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../../helpers/S6A-request-fixture.js';
import { graphWrite, plain } from '../../helpers/AG2b-collaboration-fixture.js';
import { REVIEW_REQUIRED_POLICY } from '../../helpers/S9-review-fixture.js';
import { committed, ready } from '../../helpers/S7A-fixture.js';
import { s6aCardsWorkspace, type S6ARequest } from '../../helpers/S6A-cards-fixture.js';
import { int2ReadPage } from '../../helpers/INT2-world.js';
import { waitFor as readUntil } from '../../scenarios/harness.js';
import { findButton, findClass, findElement } from './boot-page.js';
import { FakeElement } from './dom.js';
import { bootE3N, callsTo, descendants, hasClass, quietPage, textOf, waitFor, type PageLog } from './E3N-page.js';

/**
 * E3P (Plan page package A, test sheet §1.2): the request worlds the Plan rows
 * open on a real Host with the request driver on and the scripted model. W0 and
 * W3 are E3G's `openE3GW0`/`openE3GW1`, opened by the rows themselves. Every
 * state is reached through public routes; nothing is read from storage.
 */

export const PA_IDEAS: readonly S6AIdea[] = [
  { title: 'PA idea 1', detail: 'PA detail 1' },
  { title: 'PA idea 2', detail: 'PA detail 2' },
];

export type PAWorld = { world: S6AHostWorld; secretary: S6ASession; round: QueryJobRef; requestRoot: QueryJobRef };
export type PACandidate = { ref: Record<string, unknown>; revision: number };
export type PAW2 = PAWorld & { v2: PACandidate; v2Round: QueryJobRef };

type CandidateRead = { head: (PACandidate & { ref: { proposalId: string } }) | null; status: string | null };

async function guarded<T>(world: S6AHostWorld, build: () => Promise<T>): Promise<T> {
  try {
    const built = await build();
    await world.settleDetached();
    return built;
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/**
 * W1: two seeded Goals, both pointers, one secretary; goal 1's request `PA question` answered with two ideas.
 * `reviewer: true` activates a policy that also admits the `reviewer` requirement kind (the S9 world's policy),
 * so a plan round can carry a required independent-review obligation; `planCall` adds that obligation.
 */
export async function openPAW1(options: { reviewer?: boolean } = {}): Promise<PAWorld> {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
  return await guarded(world, async () => {
    const governance = await initializeProject(world);
    if (options.reviewer === true) {
      await governance.activatePolicy({ content: REVIEW_REQUIRED_POLICY });
    }
    const secretary = await world.createSecretary('pa-secretary');
    const first = await answeredRound(world, { session: secretary,
      answer: secretaryAnswer({ body: 'PA body', ideas: PA_IDEAS }), submit: newRequest('pa-ask', secretary, 'PA question') });
    return { world, secretary, round: first.round, requestRoot: first.requestRoot };
  });
}

/** One complete plan through the real `submit_plan_round` tool (the 6C sample's shape, S6C:123-153). */
function planCall(callId: string, summary: string, workTitle: string, reviewer = false) {
  const plan = {
    stages: [],
    tasks: [
      { taskId: 'pa-work', title: workTitle, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
        scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'pa-gate', title: 'PA gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active',
        scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'pa-work', role: S6A_WORK_ROLE.templateId, instruction: 'PA instruction' }],
    obligations: [{ obligationId: 'pa-obligation', title: 'PA delivery', requirementLevel: 'required',
      taskIds: ['pa-work', 'pa-gate'], verificationRequirements: [{ requirementId: 'pa-check', requirementLevel: 'required',
        kind: 'static', description: 'PA static check' }] }, ...(reviewer ? [{ obligationId: 'pa-review-obligation',
      title: 'PA independent review', requirementLevel: 'required', taskIds: ['pa-work'],
      verificationRequirements: [{ requirementId: 'pa-review', requirementLevel: 'required', kind: 'reviewer',
        description: 'PA review check' }] }] : [])],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
  return { kind: 'calls' as const, calls: [{ callId, name: 'submit_plan_round', args: { answerKind: 'plan', summary, plan } }] };
}

async function candidateOf(world: S6AHostWorld, requestRoot: QueryJobRef): Promise<CandidateRead> {
  return ready<CandidateRead>(await world.post('plans/request-candidate', plain(S6A_SCOPE, {
    goalRef: S6A_GOAL_1, requestRef: requestRoot })), 'plans/request-candidate');
}

/**
 * W2: W1, idea 2 selected; the plan turn's candidate v1 (`PA version one`) adopted
 * through `plans/apply`; a follow-up's plan turn (`PA version two`, `PA work v2`)
 * leaves the live candidate v2.
 */
export async function openPAW2(options: { reviewer?: boolean } = {}): Promise<PAW2> {
  const w1 = await openPAW1(options);
  const { world, secretary, requestRoot } = w1;
  return await guarded(world, async () => {
    await world.scripted.script(secretary, [planCall('pa-plan-1', 'PA version one', 'PA work',
      options.reviewer === true)]);
    const selected = await world.selectIdea({ commandId: 'pa-select', round: w1.round, index: 1 });
    if (selected.status !== 'queued') throw new Error(`E3P: the selection was refused: ${JSON.stringify(selected)}`);
    await waitForRound(world, requestRoot, selected.followupRound, 'ended');
    const v1 = (await readUntil(() => candidateOf(world, requestRoot), (read) => read.head !== null, 'E3P candidate v1')).head!;
    const goal = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, S6A_GOAL_1)), 'goals/read');
    const applied = await world.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: v1.ref, expectedProposalRevision: v1.revision, decisionRefs: [],
    }, 'pa-apply-v1', [{ ref: S6A_GOAL_1, revision: goal.goal.revision }]));
    if ((applied.body as { status?: string }).status !== 'committed') {
      throw new Error(`E3P: plans/apply v1 was not committed: ${JSON.stringify(applied.body)}`);
    }
    /* Two adoptions never share one instant: `plans/versions` lists by `acceptedAt`
       (newest first), so v2's adoption must come later on the world clock. */
    world.clock.advance(1000);
    await world.scripted.script(secretary, [planCall('pa-plan-2', 'PA version two', 'PA work v2',
      options.reviewer === true)]);
    const again = await submitRound(world, followUp('pa-again', requestRoot, 'PA change it'));
    await waitForRound(world, requestRoot, again.round, 'ended');
    const v2 = (await readUntil(() => candidateOf(world, requestRoot),
      (read) => read.head !== null && read.head.ref.proposalId !== v1.ref.proposalId, 'E3P candidate v2')).head!;
    return { ...w1, v2: { ref: v2.ref, revision: v2.revision }, v2Round: again.round };
  });
}

/**
 * W6 (RD-8): one request root confirmed into two Goals through two cards of the same answer, so both Goals reach the
 * same root through their initialization bindings while only one is the request's effective Goal; a request candidate
 * (`plans/propose`, `requestRef: root`) on that effective Goal is the candidate the Plan page reads. This is RD-1's
 * 双绑定 world with the Plan page's candidate facts; no store is read.
 */
export type PAW6 = { world: S6AHostWorld; validGoal: GoalRef; invalidGoal: GoalRef; root: QueryJobRef };

export async function openPAW6(): Promise<PAW6> {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
  return await guarded(world, async () => {
    await initializeProject(world);
    const secretary = await world.createSecretary('paw6-secretary');
    const draft = (index: number) => ({ objective: `PAW6 Goal ${String(index)}`,
      completion: [`PAW6 done ${String(index)}`], autonomy: 'after_plan_confirmation', screening: null });
    const first = await answeredRound(world, { session: secretary,
      answer: secretaryAnswer({ body: 'PAW6 body', ideas: PA_IDEAS, goalCardDrafts: [draft(0), draft(1)] }),
      submit: { commandId: 'paw6-request', goalId: null, text: 'PAW6 question', continues: null,
        recipient: secretary.ref } });
    const view = ready<RequestReadV1>(await world.post('requests/read',
      plain(S6A_SCOPE, { requestRoot: first.requestRoot })), 'requests/read');
    const drafts = view.rounds.find(round => round.ref.queryJobId === first.round.queryJobId)?.goalCardDrafts ?? [];
    if (drafts.length !== 2) throw new Error(`PAW6: the answer saved ${String(drafts.length)} Goal cards`);
    const confirm = async (index: number) => committed<GoalConfirmDraftReceiptV1>(await world.post(
      'goals/confirm-draft', plain(S6A_SCOPE, { commandId: `paw6-confirm-${String(index)}`,
        round: first.round, index })), `the PAW6 card ${String(index)}`);
    const firstGoal = (await confirm(0)).goal.ref;
    const secondGoal = (await confirm(1)).goal.ref;
    const page = await int2ReadPage(world, { goalId: firstGoal.goalId });
    const row = page.requests.find(entry => entry.requestRoot.queryJobId === first.requestRoot.queryJobId);
    const effective = row?.effectiveGoalId;
    if (effective === null || effective === undefined) throw new Error('PAW6: the request has no effective Goal');
    const validGoal = effective === firstGoal.goalId ? firstGoal : secondGoal;
    const invalidGoal = validGoal.goalId === firstGoal.goalId ? secondGoal : firstGoal;
    const request: S6ARequest = { label: 'paw6', goalId: null, text: 'PAW6 question',
      requestRoot: first.requestRoot, round: first.round, secretary: first.secretary, created: false };
    await s6aCardsWorkspace(world, S6A_SCOPE).proposeCandidate({
      label: 'paw6-candidate', goal: validGoal, request,
    });
    return { world, validGoal, invalidGoal, root: first.requestRoot };
  });
}

/** The W5 answer (ruling 4, 甲): the `initial_coordination` v2 `needs_decision` with one goal card draft. */
export const PA_DRAFT_ANSWER = JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'PA body',
  questions: ['PA question one'], goalCardDrafts: [{ objective: 'PA goal card', completion: ['PA check one'],
    autonomy: 'every_step', screening: null }] });

/** W5 (TESTS-1, its own builder): no Goal, no pointers; one secretary; a request without a Goal answered with one draft. */
export async function openPAW5(): Promise<PAWorld> {
  const world = await openS6AHostWorld({ backend: 'memory', defaultGoals: false, extraHostOptions: { requestDriver: 'on' } });
  return await guarded(world, async () => {
    const secretary = await world.createSecretary('pa-secretary');
    await world.scripted.script(secretary, [{ kind: 'text', text: PA_DRAFT_ANSWER }]);
    const first = await submitRound(world, { commandId: 'pa-ask', goalId: null, text: 'PA question', continues: null,
      recipient: secretary });
    await waitForRound(world, first.requestRoot, first.round, 'ended');
    return { world, secretary, round: first.round, requestRoot: first.requestRoot };
  });
}

/* ------------------------------------------------------------- Plan page reads */

/** The page's first read landed (`main/read` answered) and no request is open or starting. */
export async function planReady(log: PageLog): Promise<void> {
  await waitFor(() => callsTo(log, 'main/read').some((call) => call.reply !== undefined));
  await quietPage(log);
}

/** W2's Plan page, first read settled; `controlled` holds the change stream (P09-3's stale page). */
export async function bootPlanW2(w: PAW2, options: { controlled?: boolean } = {}):
Promise<Awaited<ReturnType<typeof bootE3N>>> {
  const booted = await bootE3N(w.world, 'Plan', { search: '?goal=ag2b-goal',
    ...(options.controlled === true ? { mode: 'controlled' as const } : {}) });
  await planReady(booted.log);
  return booted;
}

/** The opened 方案细节 list named `name` (`div.xl[aria-label]`), under `root` (a card or the page). */
export function planList(root: FakeElement, name: string): FakeElement | undefined {
  return findElement(root, (element) => hasClass(element, 'xl') && element.getAttribute('aria-label') === name);
}

/** The goal bar's button whose text contains `text` (暂停/继续/取消/重新入队). */
export function goalbarButton(root: FakeElement, text: string): FakeElement | undefined {
  return findButton(findClass(root, 'goalbar') ?? root, text);
}

/** The Host's answer body of a route's `n`-th call, once it arrived. */
export async function answerOf(log: PageLog, route: string, n = 1): Promise<Record<string, unknown>> {
  await waitFor(() => callsTo(log, route).filter((call) => call.reply !== undefined).length >= n);
  return callsTo(log, route)[n - 1]!.reply as Record<string, unknown>;
}

const isTag = (element: FakeElement, tag: string): boolean => element.tagName.toLowerCase() === tag;
const children = (element: FakeElement): FakeElement[] =>
  element.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);

/** The thread's `section.plan` cards: the conflict card is named by its `aria-label` (… 冲突). */
export function conflictCard(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => isTag(element, 'section') && hasClass(element, 'plan')
    && (element.getAttribute('aria-label') ?? '').includes('冲突'));
}

/** The 方案卡: the plan section holding the `选一个方案` radio group. */
export function planCard(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => isTag(element, 'section') && hasClass(element, 'plan')
    && descendants(element).some((inner) => inner.getAttribute('aria-label') === '选一个方案'));
}

/** The 目标卡: the plan section holding the `dl.gc` rows. */
export function goalCard(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => isTag(element, 'section') && hasClass(element, 'plan')
    && descendants(element).some((inner) => isTag(inner, 'dl') && hasClass(inner, 'gc')));
}

/** A card's `.plan-head` part (`ttl`, `scope`, `st`). */
export function headOf(card: FakeElement | undefined, part: string): string {
  const head = card === undefined ? undefined : descendants(card).find((element) => hasClass(element, 'plan-head'));
  return textOf(head === undefined ? undefined : descendants(head).find((element) => hasClass(element, part)));
}

/** The `button.opt-top` options of a card, in document order. */
export function options(card: FakeElement): FakeElement[] {
  return descendants(card).filter((element) => isTag(element, 'button') && hasClass(element, 'opt-top'));
}

/** The `dd` after the `dt` named `name` in a goal card's `dl.gc`. */
export function goalCardValue(card: FakeElement, name: string): FakeElement | undefined {
  const list = descendants(card).find((element) => isTag(element, 'dl') && hasClass(element, 'gc'));
  const items = list === undefined ? [] : children(list);
  const at = items.findIndex((item) => isTag(item, 'dt') && textOf(item) === name);
  return at < 0 ? undefined : items.slice(at + 1).find((item) => isTag(item, 'dd'));
}

/** A dd's value: its own text parts, without its buttons, opened lists, menus and notes. */
export function valueText(dd: FakeElement | undefined): string {
  if (dd === undefined) return '';
  return children(dd).filter((node) => !isTag(node, 'button') && !hasClass(node, 'gc-list') && !hasClass(node, 'gc-note')
    && !hasClass(node, 'menu-wrap')).map((node) => textOf(node)).join('');
}

/** The `.plan-line` quiet rows of the thread, in document order. */
export function planLines(root: FakeElement): FakeElement[] {
  const holder = findElement(root, (element) => hasClass(element, 'thread'));
  return holder === undefined ? [] : descendants(holder).filter((element) => hasClass(element, 'plan-line'));
}

/** A quiet row's words (its first `span`; the 展开 button is not part of them). */
export function lineText(line: FakeElement): string {
  return textOf(children(line).find((element) => isTag(element, 'span')));
}
