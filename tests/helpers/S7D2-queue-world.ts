/**
 * O4a's queue world (`7d2-start-rulings.v4.md` §11 `:8875`, re-based by O4a-10 and X-21 of the drill rulings and the
 * write-tests brief `tests-7d2-o4a.txt:27–:40`, o4a rulings 36, 40, 41): RL-04, RL-12, RL-22 and RL-16 (2) run on it.
 * It is O1b's role-line world (`openS7D2RoleLineWorld`, tests/helpers/S7D2-role-line-world.ts; every Host start has
 * `requestDriver: 'on'`, so the lifecycle queue and the three opening lines are there) with
 * `scribeReminderPeriodMs: 25` on every start. Every step is a public route:
 * - The secretary drafts (rulings 40, 41). After the world opened, the opening secretary's scripted model is given ONE
 *   text answer (`secretaryAnswer`) carrying every draft the case needs, then a `requests/submit` names that secretary
 *   as the recipient; the Host's request driver claims and runs the round on its own, and `requests/read` is polled
 *   until the round's `goalCardDrafts` are stored. Each draft is `size: 'small'`, `suggestedPosition: null` (the
 *   screening of `tests/helpers/FA-forms.ts:40–:47` with empty refs); `confirm` is `goals/confirm-draft` of one draft.
 * - Advisers A and B with three in-progress `small` goals each (`advisers: true`; v4 `:8842`, ruling 36): A is the
 *   opening adviser and the only one, so the platform assigns the first three confirmed drafts to it (a line holding
 *   none, then all small, v4 `:4804–:4805`); then B through `role-lines/open {duty:'adviser', scope:[]}` and three more
 *   confirmed drafts (A is full). `sessions/find` of each goal must show its one open responsible link on A, resp. B,
 *   else the step throws naming the read. Each of A and B then gets one unaccepted person `inquiry`
 *   (`sendS7A2PersonMessage`), so neither is idle when the platform's add at the cap reclaims (book `:475–:486`), and
 *   `role-lines/allocation` must still list both as adviser holders. The six goals' notices are not the rows'.
 * - Reads: `goals/adviser-queue` (body `{}`, o4a Q10), `sessions/find`, `sessions/read`, `sessions/operation`,
 *   `role-lines/allocation`, `role-lines/operations`, `decisions/queue` (cards and the `project_notice` notices),
 *   `decisions/card`; writes: `decisions/answer` (the card's own pins), `goals/control` (S7A's pause/resume/cancel,
 *   which need a Plan: `plan` adopts one through `plans/propose` + `plans/apply`), `sessions/archive`,
 *   `messages/withdraw`.
 * - `complete`: each work Task of the goal's Plan gets a Work line (`sessions/create`) with one scripted text reply,
 *   and the Host's check configuration is registered (a Host input, rule sheet A8, as
 *   `tests/helpers/S7B-V-fixture.ts:26–:27`); then `workflow/advance` from `select_work` is driven with no stop
 *   (`driveWorkflow`) until it performs `complete_goal`. No in-process `completeGoal`.
 * No record, context or store is read or written; a step that answers anything but its success throws naming the
 * answer, except the raw reads and writes the rows assert themselves.
 */
import type { SessionRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { DecisionSourceV1, GoalAutonomyV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { GoalScreeningV1, QueryJobRef } from '../../src/contracts/query-job.js';
import type { GoalAdviserQueueV1 } from '../../src/contracts/role-lines.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type {
  DecisionCardV1, DecisionQueueReadV1, NoticeItemV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { RequestReadV1 } from '../../src/core/work-graph/views/main-surface-read-model.js';
import { waitFor } from '../scenarios/harness.js';
import { driveWorkflow, type AdvanceValue } from './A2-restart-fixture.js';
import { ag2bChecksConfiguration, graphWrite } from './AG2b-collaboration-fixture.js';
import { secretaryAnswer } from './S6A-history-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6ASession } from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from './S6B1-fixture.js';
import { valueOf } from './S6B3-fixture.js';
import { cancelS7AGoal, pauseS7AGoal, resumeS7AGoal, sessionOf } from './S7A-fixture.js';
import { sendS7A2PersonMessage, withdrawS7A2Message } from './S7A2-fixture.js';
import { openS7D2Line, openS7D2RoleLineWorld, openTargetsOf, type S7D2RoleLineWorld } from './S7D2-role-line-world.js';

export type S7D2QueueDraft = { name: string; autonomy: GoalAutonomyV1 };
export type S7D2QueueSection = 'waiting_answer' | 'answered_pending_application' | 'history';

export type S7D2QueueWorldOptions = {
  backend: S6ABackend;
  /** The case's own drafts (after A's and B's six when `advisers`); each `small`, `suggestedPosition: null`. */
  drafts?: readonly S7D2QueueDraft[];
  /** Build advisers A and B with three in-progress `small` goals each (see the header). */
  advisers?: boolean;
};

export type S7D2Advisers = {
  readonly a: S6ASession;
  readonly b: S6ASession;
  readonly goals: { readonly a: readonly GoalRef[]; readonly b: readonly GoalRef[] };
  /** The one unaccepted person inquiry each got (RL-12 E withdraws B's before archiving it). */
  readonly inquiries: { readonly a: SessionMessage; readonly b: SessionMessage };
};

export type S7D2QueueWorld = S7D2RoleLineWorld & {
  /** The request round whose answer stores the drafts (null when the world was opened without drafts). */
  readonly round: QueryJobRef | null;
  readonly advisers: S7D2Advisers | null;
  /** `goals/confirm-draft` of the draft `name`; the route's body as returned (a commit remembers the goal). */
  confirm(name: string): Promise<unknown>;
  /** The goal a committed `confirm(name)` created. */
  goalOf(name: string): GoalRef;
  /** `goals/adviser-queue` with `{}`; the route's body as returned. */
  queueBody(): Promise<unknown>;
  /** The ready queue (anything else throws naming the body). */
  queue(): Promise<GoalAdviserQueueV1>;
  /** The goal ids of the queue's entries, in position order. */
  queueIds(): Promise<string[]>;
  /** `sessions/find` of the goal: the session ids holding an open responsible link to it, sorted. */
  linesOf(goal: GoalRef): Promise<string[]>;
  /** `sessions/read` of a line: the goal ids of its open responsible goal links, sorted. */
  goalsOf(line: S6ASession | SessionRef): Promise<string[]>;
  /** `decisions/queue` of the main workspace with the card sections named (default all three; one page of 100). */
  decisions(sections?: readonly S7D2QueueSection[]): Promise<DecisionQueueReadV1>;
  /** The cards of source `kind` in every card section of `decisions/queue`. */
  cardsOf(kind: string): Promise<DecisionCardV1[]>;
  card(source: DecisionSourceV1): Promise<DecisionCardV1>;
  /** `decisions/answer` of one option on `card` with its own pins; the route's body as returned. */
  answer(card: DecisionCardV1, optionId: string, requestId: string): Promise<unknown>;
  /** The `project_notice` notices of the main workspace (one page of 100). */
  notices(): Promise<NoticeItemV1[]>;
  /** `sessions/operation` of one operation (the stored record as the route returns it). */
  operation(ref: OperationRef): Promise<Record<string, unknown>>;
  /** One real Host idle pass (`scribeReminderPeriodMs: 25`): an idle consume, never a proof of a drain (ruling 40). */
  idle(): Promise<void>;
  /** One adopted Plan on `goal` (two work Tasks of the world's Work role; `plans/propose` + `plans/apply`). */
  plan(goal: GoalRef, label: string): Promise<void>;
  pause(goal: GoalRef): Promise<void>;
  resume(goal: GoalRef): Promise<void>;
  cancel(goal: GoalRef): Promise<void>;
  /** The goal's planned work done and `complete_goal` performed through `workflow/advance` (see the header). */
  complete(goal: GoalRef, label: string): Promise<AdvanceValue[]>;
  withdraw(message: SessionMessage, label: string): Promise<void>;
};

const screeningOf = (name: string): GoalScreeningV1 => ({ modules: [], size: 'small', conflictsWith: [],
  dependsOn: [], urgency: 'normal', suggestedPosition: null, note: `S7D2 queue ${name}` });
const draftOf = (draft: S7D2QueueDraft) => ({ objective: `S7D2 queue ${draft.name}`,
  completion: [`S7D2 queue ${draft.name} done`], autonomy: draft.autonomy, screening: screeningOf(draft.name) });

/** The six drafts of A's and B's goals (after-plan, small). */
const ADVISER_DRAFTS: readonly S7D2QueueDraft[] = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']
  .map(name => ({ name, autonomy: 'after_plan_confirmation' }));

/** Open the world (see the header). Memory or SQLite. */
export async function openS7D2QueueWorld(options: S7D2QueueWorldOptions): Promise<S7D2QueueWorld> {
  const role = await openS7D2RoleLineWorld({ backend: options.backend,
    extraHostOptions: { scribeReminderPeriodMs: 25 } });
  const host = role.world;
  const main = role.main;
  try {
    const drafts = [...(options.advisers === true ? ADVISER_DRAFTS : []), ...(options.drafts ?? [])];
    const route = async <T>(suffix: string, input: unknown, what: string): Promise<T> =>
      valueOf<T>(await main.route(suffix, input), 'ready', what);
    const goals = new Map<string, GoalRef>();
    let checks = false;

    // The drafts: the script first, then the directed submit; the Host's driver runs the round (rulings 40, 41).
    let round: QueryJobRef | null = null;
    if (drafts.length > 0) {
      await host.scripted.script(role.lines.secretary, [{ kind: 'text', text: secretaryAnswer({
        body: 'S7D2 queue drafts', goalCardDrafts: drafts.map(draftOf) }) }]);
      const submitted = await main.route('requests/submit', { commandId: 's7d2-queue-drafts', goalId: null,
        text: 'S7D2 queue: the goals to confirm', continues: null, recipient: role.lines.secretary.ref }) as
        { status?: string; requestRoot: QueryJobRef; round: QueryJobRef };
      if (submitted.status !== 'queued') {
        throw new Error(`S7D2 queue: the drafts request was not queued: ${JSON.stringify(submitted)}`);
      }
      const stored = (view: RequestReadV1): number => view.rounds
        .find(entry => entry.ref.queryJobId === submitted.round.queryJobId)?.goalCardDrafts.length ?? 0;
      await waitFor(() => route<RequestReadV1>('requests/read', { requestRoot: submitted.requestRoot },
        'the drafts request'), view => stored(view) === drafts.length, 'the secretary round to store the drafts');
      round = submitted.round;
    }

    const confirm = async (name: string): Promise<unknown> => {
      const index = drafts.findIndex(draft => draft.name === name);
      if (round === null || index < 0) throw new Error(`S7D2 queue: no draft named ${name}`);
      const body = await main.route('goals/confirm-draft', { commandId: `s7d2-queue-confirm-${name}`, round, index });
      const answer = body as { status?: string; value?: { goal: { ref: GoalRef } } };
      if (answer.status === 'committed' && answer.value !== undefined) goals.set(name, answer.value.goal.ref);
      return body;
    };
    const goalOf = (name: string): GoalRef => {
      const ref = goals.get(name);
      if (ref === undefined) throw new Error(`S7D2 queue: the draft ${name} was not confirmed`);
      return ref;
    };
    const confirmed = async (name: string): Promise<GoalRef> => {
      valueOf(await confirm(name), 'committed', `the confirmation of ${name}`);
      return goalOf(name);
    };
    const linesOf = async (target: GoalRef): Promise<string[]> => {
      const wanted: WorkLinkTarget = { kind: 'goal', ref: target };
      return (await role.findByTarget(wanted)).filter(card => openTargetsOf(card)
        .some(entry => entry.kind === 'goal' && entry.ref.goalId === target.goalId))
        .map(card => card.record.ref.sessionId).sort();
    };
    const goalsOf = async (line: S6ASession | SessionRef): Promise<string[]> =>
      openTargetsOf(await role.readCard(line)).flatMap(entry => entry.kind === 'goal' ? [entry.ref.goalId] : []).sort();
    const decisions = (sections: readonly S7D2QueueSection[] = ['waiting_answer', 'answered_pending_application',
      'history']) => route<DecisionQueueReadV1>('decisions/queue', { workspace: { ...S6A_SCOPE },
      sections: [...sections], page: { limit: 100 } }, 'the decision queue');

    // A and B, three in-progress small goals each (ruling 36).
    let advisers: S7D2Advisers | null = null;
    if (options.advisers === true) {
      const a = role.lines.adviser;
      const aGoals = [await confirmed('a1'), await confirmed('a2'), await confirmed('a3')];
      const b = await role.lineOf('s7d2-queue-b', (await openS7D2Line(host, { duty: 'adviser', scope: [],
        requestId: 's7d2-queue-b' })).result);
      const bGoals = [await confirmed('b1'), await confirmed('b2'), await confirmed('b3')];
      for (const [line, held] of [[a, aGoals], [b, bGoals]] as const) {
        for (const ref of held) {
          const on = await linesOf(ref);
          if (on.length !== 1 || on[0] !== line.ref.sessionId) {
            throw new Error(`S7D2 queue: ${ref.goalId} is not held by ${line.label} alone (sessions/find): ${JSON.stringify(on)}`);
          }
        }
      }
      const inquiries = {
        a: await sendS7A2PersonMessage(host, { label: 's7d2-queue-a-busy', recipient: a.ref }),
        b: await sendS7A2PersonMessage(host, { label: 's7d2-queue-b-busy', recipient: b.ref }),
      };
      advisers = { a, b, goals: { a: aGoals, b: bGoals }, inquiries };
      const holders = (await role.allocation()).duties.adviser.holders.map(holder => holder.session.sessionId);
      if (!holders.includes(a.ref.sessionId) || !holders.includes(b.ref.sessionId)) {
        throw new Error(`S7D2 queue: A or B is not an adviser holder after the prior: ${JSON.stringify(holders)}`);
      }
    }

    const queueBody = () => main.route('goals/adviser-queue', {});
    const queue = async () => valueOf<GoalAdviserQueueV1>(await queueBody(), 'ready', 'the adviser queue');
    return {
      ...role, round, advisers, confirm, goalOf, queueBody, queue,
      async queueIds() { return (await queue()).entries.map(entry => entry.goalRef.goalId); },
      linesOf, goalsOf, decisions,
      async cardsOf(kind) {
        const read = await decisions();
        return [...read.waitingAnswer, ...read.answeredPendingApplication, ...read.history]
          .filter(card => card.source.kind === kind);
      },
      card: source => route<DecisionCardV1>('decisions/card', { source }, `the ${source.kind} card`),
      async answer(card, optionId, requestId) {
        return await main.post('decisions/answer', graphWrite(S6A_SCOPE, { source: card.source,
          selection: { kind: 'option', optionId }, text: '', annotations: [] }, requestId, card.source.pins));
      },
      async notices() {
        const read = await route<DecisionQueueReadV1>('decisions/queue', { workspace: { ...S6A_SCOPE },
          sections: ['notices'], categories: ['project_notice'], page: { limit: 100 } }, 'the project notices');
        if (read.nextCursor !== null) throw new Error('S7D2 queue: more than 100 notices');
        return read.notices;
      },
      operation: ref => route<Record<string, unknown>>('sessions/operation', ref, `the operation ${ref.operationId}`),
      async idle() {
        const settled = host.consumeBarrier();
        host.clock.advance(25);
        await settled;
      },
      async plan(ref, label) {
        await adoptS6BPlan(main, ref, { label, taskIds: [`${label}-1`, `${label}-2`], role: S6A_WORK_ROLE.templateId });
      },
      async pause(ref) { await pauseS7AGoal(host, ref); },
      async resume(ref) { await resumeS7AGoal(host, ref); },
      async cancel(ref) { await cancelS7AGoal(host, ref); },
      async complete(ref, label) {
        if (!checks) {
          host.platform.registerCheckConfiguration({ configuration: ag2bChecksConfiguration({
            actor: host.ag2b.actor, command: 'true' }) });
          checks = true;
        }
        const graph = await route<{ tasks: { ref: { projectId: string; goalId: string; taskId: string };
          definition: { taskKind: string } }[] }>('tasks/query', { goalRef: ref }, `the task graph of ${ref.goalId}`);
        for (const row of graph.tasks.filter(entry => entry.definition.taskKind === 'work')) {
          const line = await createS6BLine(main, { label: `${label}-${row.ref.taskId}`, role: S6A_WORK_ROLE,
            tasks: [row.ref] });
          await host.scripted.script(await sessionOf(host, line), [{ kind: 'text', text: `S7D2 queue ${label} work` }]);
        }
        const steps = await driveWorkflow(host.ag2b, { schemaVersion: 1, goalRef: ref, flowId: `s7d2-queue-${label}`,
          sessionHint: null, kind: 'select_work' });
        if (!steps.some(step => step.receipt?.kind === 'complete_goal')) {
          throw new Error(`S7D2 queue: the Workflow did not perform complete_goal for ${ref.goalId}: ${JSON.stringify(steps.at(-1))}`);
        }
        return steps;
      },
      async withdraw(message, label) { await withdrawS7A2Message(host, message, label); },
    };
  } catch (error) {
    await role.close().catch(() => undefined);
    throw error;
  }
}
