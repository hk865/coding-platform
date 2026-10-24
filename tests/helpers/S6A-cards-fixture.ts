/**
 * The main conversation's world: requests on goals and without one, the decision cards that belong to them, the
 * automatic-rework notices and their seen positions, goals created in a known order and two goals that share a task
 * id. The rows of the main read, `requests/read`, `ask` and the workspace calendar start from it; this file names
 * none of the routes those rows add and reads nothing they write.
 *
 * Two worlds, because no one Host start can give both: the cards world needs a workspace whose first goal comes after
 * some requests (the request world seeds its two goals at open, so its own workspace never has a request before its
 * first goal), and the notices world needs Work Runs, whose scripted replies only the SE2 world serves. Both run on
 * the memory and the SQLite backend.
 *
 * - `openS6ACardsWorld` (SE1): the frozen request world (tests/helpers/S6A-request-fixture.ts) whose Host also
 *   configures a second workspace of the same project with its own root, Kernel store, secretary runtime binding and
 *   secretary query profile (Host inputs, rule sheet A8). The Host factory is reached through a delegating spy,
 *   installed only while the world opens, that adds those four entries and changes nothing else (the
 *   `openS6ATwoWorkspaceWorld` pattern, which has no secretary profile there); the second workspace is then registered
 *   through `workspaces/register`. The world is not reopened (a reopen would start a Host without the second
 *   workspace); do not open another S6A world while this one opens.
 * - `openS6ANoticesWorld` (SE2): the frozen host world (tests/helpers/S6A-host-fixture.ts) with the project's two
 *   pointers (`ensureProjectPointers`), an adopted Plan on each of its two goals (`plans/propose` + `plans/apply`),
 *   both with the work task `ag2b-work` and goal 1 with a second work task, and one Work Session. `automation/save`
 *   turns `resumeOnStartup` off, so a later restart leaves the parked requeues alone (a test may turn it on again).
 *
 * The steps, and the public step behind each:
 * - A workspace handle (`s6aCardsWorkspace`) over any S6A world and workspace: routes over HTTP as the Host's actor
 *   (the body names the workspace) or in process with the human operator's trusted context (the request world's
 *   `dispatch`); `goals/create` with the project and workspace pins `workspaces/registration` returns; a request
 *   through `requests/submit`; a candidate through `plans/propose` with `requestRef` (the request's root, as the
 *   submit receipt returned it), `basedOn` the goal's adopted Plan (`tasks/query`) or null, and the goal pin
 *   `goals/read` returns; the cards and the notices through `decisions/queue`; the seen write through
 *   `decisions/notices/seen` with the values a read returned; a goal's revision moved through `goals/settings/set`
 *   (the settings it read, unchanged). Every submit and goal creation first moves the world clock one second, so
 *   times agree with the creation order; the main read pages by commit position, not by time.
 * - Cards tied to requests (`seedS6ASharedCards`): two requests on one goal, one candidate for each (the candidate
 *   card is the only card kind with a `requestRef` today, `candidateCard` in
 *   src/core/work-graph/views/decision-read-model.ts, and it names the request's root), an
 *   independent candidate (no request) on another goal, then one queue read: the goal's own cards with
 *   `requestRef: null` (goal causes: missing pointers, a pending plan, an automatic rework) belong to both requests.
 *   Each card's `source.pins` is what an `ask` sends as `cardRefs`.
 * - Goals in a known order (`seedS6AGoalOrder`): on a workspace with no goal yet, no-goal requests, the first goal
 *   (by default never asked about), more no-goal requests, the second goal and requests on it, and optionally
 *   requests on the first goal last. `goals/create` returns the creation commit's cursor; each request's commit
 *   position is the `since` of its round in the request read. Task ids come from the Plan draft a caller proposes and
 *   a task is keyed by its goal, so two goals' Plans may name the same task id (the notices world's `ag2b-work`).
 * - Many requests (`submitMany`): the intake has no rate limit; with no `secretaryOpenCap` and the driver off every
 *   new request finds the earlier secretaries busy with their waiting rounds and opens a new line (21 requests: about
 *   0.6 s on memory, 1.6 s on SQLite); with a cap the rest wait unassigned.
 * - Automatic-rework notices (`seedReworkNotices`): the Workflow (`workflow/advance` of `select_work` on a named
 *   task, the Work Session as hint) runs the task; the Work Session's scripted model calls the real `read` tool once
 *   and then the provider fails, so the Run fails (`run_failed`) and the Workflow itself performs the automatic
 *   requeue (`WORKFLOW_AUTOMATION_ACTOR`), which is the notice. The drive stops before the requeue's claim, so the
 *   task waits. Each task is reworked once: a second automatic requeue of the same task with its source unchanged is
 *   refused (a `TaskReworkRefusal`, no notice), hence goal 1's second task. The order is goal 1, goal 2, goal 1:
 *   notice positions 1, 2, 3, the second on the other goal. Each Run's one tool step is the activity the calendar
 *   counts for its goal's `ag2b-work` (or goal 1's second task).
 * - Requests are submitted with the world's request driver as it was opened (off unless `extraHostOptions` name
 *   `requestDriver: 'on'`); with the driver on, the Host may start a request's round as soon as it is submitted.
 *
 * No record, event or Session field is written by hand and nothing is read from the store: every check here reads a
 * public route, and a setup that does not produce the expected state throws with what the platform answered.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { vi } from 'vitest';
import * as hostModule from '../../src/app/host.js';
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalSettingsV1, NoticeCategoryV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type {
  DecisionCardV1, DecisionQueueReadV1, NoticeItemV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { draftFrom } from '../scenarios/support/common.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { AG2B_WORK_TASK_ID, ag2bPlanDraft, graphWrite, plain, writeAG2bWorkspace } from './AG2b-collaboration-fixture.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld, type S6AHostWorldOptions } from './S6A-host-fixture.js';
import type { S6AGovernance } from './S6A-memory-fixture.js';
import {
  openS6ARequestWorld, S6A_SCOPE, S6A_SECOND_SCOPE, S6A_SECRETARY_PROFILE_ID,
  type S6ARequestWorld, type S6ASession, type S6AWorldOptions,
} from './S6A-request-fixture.js';

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function readyValue<T>(body: unknown, what: string): T {
  if (asRecord(body)['status'] !== 'ready') throw new Error(`S6A cards: ${what} was not ready: ${JSON.stringify(body)}`);
  return asRecord(body)['value'] as T;
}

function committedBody(body: unknown, what: string): Record<string, unknown> {
  if (asRecord(body)['status'] !== 'committed') throw new Error(`S6A cards: ${what} did not commit: ${JSON.stringify(body)}`);
  return asRecord(body);
}

// ---------------------------------------------------------------------------
// The workspace handle
// ---------------------------------------------------------------------------

/** One request as `requests/submit` returned it. */
export type S6ARequest = {
  label: string;
  goalId: string | null;
  text: string;
  requestRoot: QueryJobRef;
  round: QueryJobRef;
  /** The receipt's secretary (picked or created), or null when the request waits unassigned. */
  secretary: SessionRef | null;
  created: boolean;
};

/** One candidate as `plans/propose` returned it. */
export type S6ACandidate = {
  label: string;
  goal: GoalRef;
  /** The request it belongs to; null for an independent candidate. */
  request: S6ARequest | null;
  proposal: { ref: PlanProposalRef; revision: number };
  basedOn: PlanRevisionSnapshot['ref'] | null;
};

/** One goal as `goals/create` returned it: the ref and the creation commit's cursor. */
export type S6ACreatedGoal = { ref: GoalRef; objective: string; cursor: CommitCursor };

/** One `decisions/queue` notice page: the items in position order and what the read issued for them. */
export type S6ANoticeRead = {
  notices: NoticeItemV1[];
  seenThrough: DecisionQueueReadV1['seenThrough'];
  displayToken: string | null;
};

export type S6ACardsWorkspace = {
  readonly scope: WorkspaceScope;
  /** A fresh trusted context of this workspace for the human operator. */
  humanContext(): CoreCallContext;
  /** A core route of this workspace over HTTP as the Host's actor (`{ scope, input }` or a graph write's body). */
  post(suffix: string, body: unknown): Promise<unknown>;
  /** A plain core route of this workspace over HTTP: `{ scope, input }`. */
  route(suffix: string, input: unknown): Promise<unknown>;
  /** A plain core route in process with `humanContext()` (an unpublished suffix answers `not_found`). */
  dispatch(suffix: string, input: unknown): Promise<unknown>;
  /** `goals/create` in this workspace. */
  createGoal(goalId: string, objective?: string): Promise<S6ACreatedGoal>;
  /** `requests/submit` of a new request (`goalId: null`: no goal); throws unless it is queued. */
  submit(input: { label: string; goalId: string | null; text?: string; recipient?: SessionRef | null }): Promise<S6ARequest>;
  /** `count` new requests, one after the other, labelled `<label>-1` … `<label>-<count>`. */
  submitMany(input: { label: string; goalId: string | null; count: number }): Promise<S6ARequest[]>;
  /** The request read (`requestFacts.readRequest`, the owner read the host world uses) of one root. */
  readRequest(requestRoot: QueryJobRef): Promise<Record<string, unknown>>;
  /** `plans/propose` of a candidate on `goal` for `request` (null: an independent candidate). */
  proposeCandidate(input: { label: string; goal: GoalRef; request: S6ARequest | null }): Promise<S6ACandidate>;
  /** Every card `decisions/queue` shows (waiting, answered, history), all pages; one goal's only when named. */
  readCards(goal?: GoalRef): Promise<DecisionCardV1[]>;
  /** One `decisions/queue` notice page (default: `automatic_rework`, at most `limit` items, default 100). */
  readNotices(input?: { goal?: GoalRef; categories?: NoticeCategoryV1[]; limit?: number }): Promise<S6ANoticeRead>;
  /** `decisions/notices/seen` with the token and positions a read returned; answers the route's body. */
  markSeen(input: { label: string; displayToken: string; seenThrough: DecisionQueueReadV1['seenThrough'] }):
    Promise<Record<string, unknown>>;
  /** `goals/settings/set` with the settings `goals/settings` returned: only the goal's revision moves. */
  moveGoal(goal: GoalRef, label: string): Promise<{ before: number; after: number }>;
  /** The goal's adopted Plan (`tasks/query`), or null when it has none. */
  activePlan(goal: GoalRef): Promise<PlanRevisionSnapshot | null>;
  /** The Run a task holds now (`tasks/query`'s `execution`). */
  taskRun(goal: GoalRef, taskId: string): Promise<RunRef | null>;
};

/** The handle over one workspace of an S6A world (its Host must configure the workspace). */
export function s6aCardsWorkspace(world: S6ARequestWorld, scope: WorkspaceScope): S6ACardsWorkspace {
  const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId: scope.projectId, workspaceId: scope.workspaceId };
  // The world's own human operator (its `humanContext`), bound to this workspace.
  const principal = world.humanContext().principal;
  if (principal.kind !== 'host') throw new Error('S6A cards: the world has no Host human context');
  const operator = principal.actor;
  const humanContext = (): CoreCallContext => createHostCoreCallContext({
    scope: { projectId: scope.projectId, workspaceId: scope.workspaceId }, actor: { ...operator },
    signal: new AbortController().signal,
  });
  const post = async (suffix: string, body: unknown): Promise<unknown> => (await world.post(suffix, body)).body;
  const route = (suffix: string, input: unknown): Promise<unknown> => post(suffix, plain(scope, input));

  async function registration(): Promise<{ project: number; workspace: number }> {
    const value = readyValue<{ project: { revision: number }; workspace: { revision: number } }>(
      await route('workspaces/registration', { projectId: scope.projectId, workspaceId: scope.workspaceId }),
      `the registration of ${scope.workspaceId}`);
    return { project: value.project.revision, workspace: value.workspace.revision };
  }

  async function goalRevision(goal: GoalRef): Promise<number> {
    return readyValue<{ goal: GoalSnapshot }>(await route('goals/read', goal), `the goal ${goal.goalId}`).goal.revision;
  }

  async function taskGraph(goal: GoalRef): Promise<{ plan: PlanRevisionSnapshot; tasks: Array<Record<string, unknown>> } | null> {
    const body = await route('tasks/query', { goalRef: goal });
    if (asRecord(body)['status'] === 'not_found') return null;
    return readyValue(body, `the task graph of ${goal.goalId}`);
  }

  async function submit(input: { label: string; goalId: string | null; text?: string; recipient?: SessionRef | null }):
  Promise<S6ARequest> {
    world.clock.advance(1000);
    const text = input.text ?? `S6A cards request ${input.label}`;
    const result = await route('requests/submit', {
      commandId: `s6a-cards-submit-${scope.workspaceId}-${input.label}`, goalId: input.goalId, text, continues: null,
      recipient: input.recipient ?? null,
    }) as RequestSubmitResultV1;
    if (result.status !== 'queued') throw new Error(`S6A cards: the request ${input.label} was not queued: ${JSON.stringify(result)}`);
    return { label: input.label, goalId: input.goalId, text, requestRoot: result.requestRoot, round: result.round,
      secretary: result.secretary, created: result.created };
  }

  const handle: S6ACardsWorkspace = {
    scope,
    humanContext,
    post,
    route,
    dispatch: (suffix, input) => world.dispatch(suffix, humanContext(), plain(scope, input)),

    async createGoal(goalId, objective = `S6A cards goal ${goalId}`) {
      world.clock.advance(1000);
      const pins = await registration();
      const body = committedBody(await post('goals/create', graphWrite(scope, {
        goalId, workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId }, objective,
      }, `s6a-cards-goal-${scope.workspaceId}-${goalId}`, [
        { ref: projectRef, revision: pins.project }, { ref: workspaceRef, revision: pins.workspace },
      ])), `the goal ${goalId}`);
      const cursor = body['cursor'];
      if (typeof cursor !== 'string') throw new Error(`S6A cards: goals/create returned no cursor: ${JSON.stringify(body)}`);
      return { ref: { aggregateType: 'Goal', projectId: scope.projectId, goalId }, objective, cursor: cursor as CommitCursor };
    },

    submit,

    async submitMany(input) {
      const made: S6ARequest[] = [];
      for (let index = 1; index <= input.count; index += 1) {
        made.push(await submit({ label: `${input.label}-${String(index)}`, goalId: input.goalId }));
      }
      return made;
    },

    async readRequest(requestRoot) {
      const read = await world.platform.requestFacts.readRequest(humanContext(), { requestRoot });
      if (read.status !== 'ready') throw new Error(`S6A cards: the request read is not ready: ${JSON.stringify(read)}`);
      return read.value as unknown as Record<string, unknown>;
    },

    async proposeCandidate(input) {
      const graph = await taskGraph(input.goal);
      const planId = `s6a-cards-plan-${input.label}`;
      const draft: PlanRevisionDraft = graph === null
        ? { ...ag2bPlanDraft(), planId, goalId: input.goal.goalId }
        : draftFrom(graph.plan, planId);
      const basedOn = graph === null ? null : graph.plan.ref;
      const body = committedBody(await post('plans/propose', graphWrite(scope, {
        goalRef: input.goal, basedOn, draft, requestRef: input.request === null ? null : input.request.requestRoot,
        reason: { text: `S6A cards candidate ${input.label}`, sources: [] },
      }, `s6a-cards-propose-${scope.workspaceId}-${input.label}`, [
        { ref: input.goal, revision: await goalRevision(input.goal) },
      ])), `the candidate ${input.label}`);
      const proposal = asRecord(body['value']);
      return { label: input.label, goal: input.goal, request: input.request,
        proposal: { ref: proposal['ref'] as PlanProposalRef, revision: proposal['revision'] as number }, basedOn };
    },

    async readCards(goal) {
      const cards: DecisionCardV1[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 50; page += 1) {
        const read: DecisionQueueReadV1 = readyValue<DecisionQueueReadV1>(await route('decisions/queue', {
          workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId },
          ...(goal === undefined ? {} : { goalRef: goal }),
          sections: ['waiting_answer', 'answered_pending_application', 'history'],
          page: { limit: 100, ...(cursor === null ? {} : { cursor }) },
        }), 'the decision queue');
        cards.push(...read.waitingAnswer, ...read.answeredPendingApplication, ...read.history);
        if (read.nextCursor === null) return cards;
        cursor = read.nextCursor;
      }
      throw new Error('S6A cards: the decision queue did not end within 50 pages');
    },

    async readNotices(input = {}) {
      const read = readyValue<DecisionQueueReadV1>(await route('decisions/queue', {
        workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId },
        ...(input.goal === undefined ? {} : { goalRef: input.goal }),
        sections: ['notices'], categories: input.categories ?? ['automatic_rework'],
        page: { limit: input.limit ?? 100 },
      }), 'the notice page');
      if (input.limit === undefined && read.nextCursor !== null) {
        throw new Error('S6A cards: more than 100 notices; pass a limit to read one page');
      }
      return { notices: read.notices, seenThrough: read.seenThrough, displayToken: read.displayToken };
    },

    async markSeen(input) {
      const pins = await registration();
      return asRecord(await post('decisions/notices/seen', graphWrite(scope, {
        workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId },
        displayToken: input.displayToken, seenThrough: input.seenThrough,
      }, `s6a-cards-seen-${scope.workspaceId}-${input.label}`, [{ ref: workspaceRef, revision: pins.workspace }])));
    },

    async moveGoal(goal, label) {
      const read = readyValue<{ goal: GoalSnapshot; settings: GoalSettingsV1 }>(
        await route('goals/settings', { goalRef: goal }), `the settings of ${goal.goalId}`);
      // A waiting goal's write would also pin its predecessor and that goal's phase; the worlds here never wait.
      if (read.settings.waitForGoalRef !== null) {
        throw new Error(`S6A cards: ${goal.goalId} waits for another goal; moveGoal moves goals without a wait`);
      }
      const expected: VersionPin[] = [{ ref: goal, revision: read.goal.revision }];
      const body = committedBody(await post('goals/settings/set', graphWrite(scope, {
        goalRef: goal, autonomy: read.settings.autonomy, waitForGoalRef: null,
      }, `s6a-cards-move-${scope.workspaceId}-${label}`, expected)), `the settings write of ${goal.goalId}`);
      const after = asRecord(body['value'])['revision'];
      if (typeof after !== 'number' || after <= read.goal.revision) {
        throw new Error(`S6A cards: the settings write did not move ${goal.goalId}: ${JSON.stringify(body)}`);
      }
      return { before: read.goal.revision, after };
    },

    async activePlan(goal) { return (await taskGraph(goal))?.plan ?? null; },

    async taskRun(goal, taskId) {
      const graph = await taskGraph(goal);
      const row = graph?.tasks.find(task => asRecord(task['ref'])['taskId'] === taskId);
      if (row === undefined) throw new Error(`S6A cards: ${goal.goalId} has no task ${taskId}`);
      return (row['execution'] ?? null) as RunRef | null;
    },
  };
  return handle;
}

// ---------------------------------------------------------------------------
// Cards tied to requests
// ---------------------------------------------------------------------------

export type S6ASharedCards = {
  goal: GoalRef;
  otherGoal: GoalRef;
  /** Two requests on `goal`. */
  requests: [S6ARequest, S6ARequest];
  /** One candidate per request, in request order, with the card the queue showed for it. */
  candidates: Array<S6ACandidate & { card: DecisionCardV1 }>;
  /** The independent candidate on `otherGoal` (no request) and its card. */
  otherCandidate: S6ACandidate & { card: DecisionCardV1 };
  /**
   * `goal`'s cards with `requestRef: null`, in any state the queue shows (an adopted Plan's accepted proposal reads as
   * closed history): each belongs to both requests.
   */
  goalCards: DecisionCardV1[];
  /** Every card of `otherGoal`: never a card of either request. */
  otherGoalCards: DecisionCardV1[];
  /** The whole queue read the cards above come from. */
  all: DecisionCardV1[];
};

/** A card's refs as an `ask` sends them (`cardRefs`): its `source.pins`, as the read returned them. */
export function cardRefsOf(card: DecisionCardV1): VersionPin[] {
  return structuredClone(card.source.pins);
}

const sameQueryJob = (left: QueryJobRef | null, right: QueryJobRef): boolean => left !== null
  && left.projectId === right.projectId && left.workspaceId === right.workspaceId && left.queryJobId === right.queryJobId;
const sameGoal = (left: GoalRef, right: GoalRef): boolean =>
  left.projectId === right.projectId && left.goalId === right.goalId;

/**
 * Two requests on `goal`, a candidate for each, an independent candidate on `otherGoal`, then one card read. Throws
 * unless the read holds both request cards, at least one `requestRef: null` card on `goal` and the other goal's
 * candidate card.
 */
export async function seedS6ASharedCards(workspace: S6ACardsWorkspace, input: {
  label: string; goal: GoalRef; otherGoal: GoalRef;
}): Promise<S6ASharedCards> {
  const first = await workspace.submit({ label: `${input.label}-r1`, goalId: input.goal.goalId });
  const second = await workspace.submit({ label: `${input.label}-r2`, goalId: input.goal.goalId });
  const proposed = [
    await workspace.proposeCandidate({ label: `${input.label}-c1`, goal: input.goal, request: first }),
    await workspace.proposeCandidate({ label: `${input.label}-c2`, goal: input.goal, request: second }),
  ];
  const independent = await workspace.proposeCandidate({ label: `${input.label}-other`, goal: input.otherGoal, request: null });
  const all = await workspace.readCards();
  const cardOf = (candidate: S6ACandidate): DecisionCardV1 => {
    const card = all.find(entry => entry.source.kind === 'candidate' && sameGoal(entry.goalRef, candidate.goal)
      && entry.source.pins.some(pin => asRecord(pin.ref)['proposalId'] === candidate.proposal.ref.proposalId));
    if (card === undefined) throw new Error(`S6A cards: no card for the candidate ${candidate.label}: ${JSON.stringify(all)}`);
    return card;
  };
  const candidates = proposed.map(candidate => ({ ...candidate, card: cardOf(candidate) }));
  candidates.forEach((candidate, index) => {
    const request = index === 0 ? first : second;
    if (!sameQueryJob(candidate.card.requestRef, request.requestRoot)) {
      throw new Error(`S6A cards: the candidate card of ${request.label} names another request: ${JSON.stringify(candidate.card)}`);
    }
  });
  const goalCards = all.filter(card => sameGoal(card.goalRef, input.goal) && card.requestRef === null);
  if (goalCards.length === 0) throw new Error(`S6A cards: ${input.goal.goalId} has no card without a request: ${JSON.stringify(all)}`);
  const otherGoalCards = all.filter(card => sameGoal(card.goalRef, input.otherGoal));
  return { goal: input.goal, otherGoal: input.otherGoal, requests: [first, second], candidates,
    otherCandidate: { ...independent, card: cardOf(independent) }, goalCards, otherGoalCards, all };
}

// ---------------------------------------------------------------------------
// Goals in a known order
// ---------------------------------------------------------------------------

export type S6AGoalOrder = {
  /** No-goal requests made before any goal of the workspace existed. */
  before: S6ARequest[];
  /** The first goal by creation; asked about only when `onFirst` is not empty, and then after `asked` was. */
  first: S6ACreatedGoal;
  /** No-goal requests made after the first goal. */
  after: S6ARequest[];
  /** The goal created second; the requests in `onAsked` name it. */
  asked: S6ACreatedGoal;
  onAsked: S6ARequest[];
  /** Requests on the first goal, made last (default none). */
  onFirst: S6ARequest[];
};

/**
 * On a workspace with no goal yet (the cards world's `second`; the workspace's first goal is fixed by its first
 * `goals/create`, so one workspace carries one such story): `before` no-goal requests, the first goal, `after` no-goal
 * requests, the second goal, `onAsked` requests on it, then `onFirst` requests on the first goal. Defaults 1, 1, 3, 0.
 */
export async function seedS6AGoalOrder(workspace: S6ACardsWorkspace, options: {
  label?: string; before?: number; after?: number; onAsked?: number; onFirst?: number;
} = {}): Promise<S6AGoalOrder> {
  const label = options.label ?? 'order';
  const before = await workspace.submitMany({ label: `${label}-before`, goalId: null, count: options.before ?? 1 });
  const first = await workspace.createGoal(`s6a-cards-${label}-first`, `S6A cards ${label}: the first goal by creation`);
  const after = await workspace.submitMany({ label: `${label}-after`, goalId: null, count: options.after ?? 1 });
  const asked = await workspace.createGoal(`s6a-cards-${label}-asked`, `S6A cards ${label}: the goal asked about`);
  const onAsked = await workspace.submitMany({ label: `${label}-asked`, goalId: asked.ref.goalId, count: options.onAsked ?? 3 });
  const onFirst = await workspace.submitMany({ label: `${label}-first`, goalId: first.ref.goalId, count: options.onFirst ?? 0 });
  return { before, first, after, asked, onAsked, onFirst };
}

// ---------------------------------------------------------------------------
// The cards world (SE1): the request world plus a second workspace with a secretary profile
// ---------------------------------------------------------------------------

/** The second workspace's secretary binding and profile ids. */
export const S6A_CARDS_SECOND_BINDING_ID = 's6a-cards-second-secretary-binding';
export const S6A_CARDS_SECOND_PROFILE_ID = 's6a-cards-second-secretary-profile';

export type S6ACardsWorld = {
  readonly world: S6ARequestWorld;
  /** The request world's own workspace: its two goals exist from the open, goal 1 first. */
  readonly main: S6ACardsWorkspace;
  /** The second workspace (`S6A_SECOND_SCOPE`): no goal until a test creates one. */
  readonly second: S6ACardsWorkspace;
  /** Closes the world and removes the second root. */
  close(): Promise<void>;
};

/** Open the cards world (see the header). Memory or SQLite; never reopened. */
export async function openS6ACardsWorld(options: S6AWorldOptions): Promise<S6ACardsWorld> {
  const root = await mkdtemp(join(tmpdir(), 's6a-cards-ws2-'));
  let world: S6ARequestWorld;
  try {
    await writeAG2bWorkspace(root);
    const real = hostModule.createLocalWorkbenchHost;
    const spy = vi.spyOn(hostModule, 'createLocalWorkbenchHost').mockImplementation(async hostOptions => {
      const entries = hostOptions.kernelStores?.entries ?? [];
      const first = entries[0];
      const runtime = hostOptions.runtimeConfiguration;
      if (first === undefined || runtime === undefined) throw new Error('S6A cards: the world configures no Kernel store or runtime');
      const next = structuredClone(runtime);
      const profile = next.queryProfiles.find(entry => entry.id === S6A_SECRETARY_PROFILE_ID);
      const binding = profile === undefined ? undefined : next.bindings.find(entry => entry.id === profile.runtimeBindingId);
      if (profile === undefined || binding === undefined) {
        throw new Error('S6A cards: the cards world needs the request world with its secretary profile');
      }
      // The secretary binding and profile copied to the second workspace: same role, model and budgets.
      next.bindings.push({ ...structuredClone(binding), id: S6A_CARDS_SECOND_BINDING_ID, scope: { ...S6A_SECOND_SCOPE },
        configurationRevision: `${S6A_CARDS_SECOND_BINDING_ID}@1` });
      next.queryProfiles.push({ ...structuredClone(profile), id: S6A_CARDS_SECOND_PROFILE_ID, scope: { ...S6A_SECOND_SCOPE },
        runtimeBindingId: S6A_CARDS_SECOND_BINDING_ID,
        roleBinding: { ...structuredClone(profile.roleBinding), bindingId: S6A_CARDS_SECOND_BINDING_ID } });
      return real({
        ...hostOptions,
        runtimeConfiguration: next,
        workspaces: [...hostOptions.workspaces, { scope: { ...S6A_SECOND_SCOPE }, name: 'S6A cards second workspace', root,
          workspaceRevision: 1, readPrefixes: ['.'] }],
        kernelStores: { entries: [...entries, { adapterId: 's6a-cards-kernel-2', storeKey: 's6a-cards-kernel-store-2',
          workspace: { ...S6A_SECOND_SCOPE }, databasePath: join(dirname(first.databasePath), 'kernel-cards-2.sqlite') }] },
      });
    });
    try {
      world = await openS6ARequestWorld(options);
    } finally {
      spy.mockRestore();
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const close = async (): Promise<void> => {
    try { await world.close(); } finally { await rm(root, { recursive: true, force: true }); }
  };
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const second = s6aCardsWorkspace(world, S6A_SECOND_SCOPE);
  try {
    committedBody(await second.post('workspaces/register', graphWrite(S6A_SECOND_SCOPE,
      { workspace: { ...S6A_SECOND_SCOPE } }, 's6a-cards-second-workspace', [
        { ref: { aggregateType: 'Project', projectId: S6A_SECOND_SCOPE.projectId }, revision: 1 },
        { ref: { aggregateType: 'Workspace', ...S6A_SECOND_SCOPE }, revision: 0 },
      ])), 'the second workspace registration');
    // The registration starts the automatic capture of the second root; wait for it.
    await world.settleDetached();
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
  return { world, main, second, close };
}

// ---------------------------------------------------------------------------
// The notices world (SE2): pointers, two Plans sharing a task id, a Work Session, automatic reworks
// ---------------------------------------------------------------------------

/** Goal 1's second work task (goal 2 has `ag2b-work` only). */
export const S6A_CARDS_SECOND_TASK_ID = 's6a-cards-work-2';

/** One automatic rework: the failed Run, the requeue the Workflow committed and (after a read) its notice. */
export type S6ARework = {
  label: string;
  goal: GoalRef;
  taskId: string;
  /** The Run that failed (it made one `read` call first). */
  runRef: RunRef;
  /** The TaskRequeue the Workflow wrote as the automation actor. */
  requeueRef: TaskRequeueRef;
};

export type S6AReworkNotices = {
  /** The reworks in the order they ran: goal 1, goal 2, goal 1. */
  reworks: [S6ARework, S6ARework, S6ARework];
  /**
   * The notices in position order (positions 1, 2, 3), each with its rework; the second belongs to the other goal.
   * `read` is the one queue read (all three shown, so its `seenThrough` is position 3).
   */
  notices: Array<{ index: 1 | 2 | 3; notice: NoticeItemV1; rework: S6ARework }>;
  read: S6ANoticeRead;
};

export type S6ANoticesWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly governance: S6AGovernance;
  /** The adopted Plans: goal 1 with `ag2b-work` and `S6A_CARDS_SECOND_TASK_ID`, goal 2 with `ag2b-work`. */
  readonly plans: { first: PlanRevisionSnapshot; second: PlanRevisionSnapshot };
  /** The Work Session every rework runs on. */
  readonly worker: S6ASession;
  /** One automatic rework of a task that was never reworked (see the header). */
  rework(input: { label: string; goal: GoalRef; taskId: string }): Promise<S6ARework>;
  /** The three reworks (goal 1 `ag2b-work`, goal 2 `ag2b-work`, goal 1 second task) and their notices. */
  seedReworkNotices(): Promise<S6AReworkNotices>;
  close(): Promise<void>;
};

const sameRequeue = (left: unknown, right: TaskRequeueRef): boolean => {
  const ref = asRecord(left);
  return ref['aggregateType'] === 'TaskRequeue' && ref['projectId'] === right.projectId && ref['goalId'] === right.goalId
    && ref['taskId'] === right.taskId && ref['afterRunId'] === right.afterRunId;
};

/** Open the notices world (see the header). Memory or SQLite. */
export async function openS6ANoticesWorld(options: S6AHostWorldOptions): Promise<S6ANoticesWorld> {
  const world = await openS6AHostWorld(options);
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const governance = await ensureProjectPointers(world);
    const adopt = async (goal: GoalRef, workIds: readonly string[], planId: string): Promise<PlanRevisionSnapshot> => {
      const proposed = asRecord(committedBody(await main.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: goal, basedOn: null, draft: { ...ag2bPlanDraft(workIds), planId, goalId: goal.goalId },
        reason: { text: `S6A cards plan ${planId}`, sources: [] },
      }, `s6a-cards-${planId}-propose`, [])), `the Plan ${planId}`)['value']);
      committedBody(await main.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef: proposed['ref'], expectedProposalRevision: proposed['revision'], decisionRefs: [],
      }, `s6a-cards-${planId}-apply`, [])), `the adoption of ${planId}`);
      const plan = await main.activePlan(goal);
      if (plan === null) throw new Error(`S6A cards: ${goal.goalId} has no adopted Plan after ${planId}`);
      return plan;
    };
    const plans = {
      first: await adopt(world.goals.first, [AG2B_WORK_TASK_ID, S6A_CARDS_SECOND_TASK_ID], 's6a-cards-plan-goal-1'),
      second: await adopt(world.goals.second, [AG2B_WORK_TASK_ID], 's6a-cards-plan-goal-2'),
    };
    await world.settleDetached();
    await world.setResumeOnStartup(false);
    const worker = await world.createWorkSession('s6a-cards-worker');

    async function rework(input: { label: string; goal: GoalRef; taskId: string }): Promise<S6ARework> {
      await world.scripted.script(worker, [
        { kind: 'calls', calls: [{ callId: `s6a-cards-${input.label}-read`, name: 'read', args: { path: 'src/module.ts' } }] },
        { kind: 'fail', message: `S6A cards: the provider fails the ${input.label} Run` },
      ]);
      const select: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: input.goal, flowId: `s6a-cards-${input.label}`,
        sessionHint: worker.ref, kind: 'select_work', taskId: input.taskId };
      const toRequeue = await driveWorkflow(world.ag2b, select, { stopBefore: 'requeue_task' });
      const next = toRequeue.at(-1)?.next ?? null;
      if (next === null || next.kind !== 'perform' || next.operation.kind !== 'requeue_task') {
        throw new Error(`S6A cards: ${input.label} did not reach the automatic requeue: ${JSON.stringify(toRequeue.at(-1))}`);
      }
      const runRef = await main.taskRun(input.goal, input.taskId);
      if (runRef === null) throw new Error(`S6A cards: ${input.label} left no Run on ${input.taskId}`);
      // The requeue itself, then the selection that would claim it: the drive stops before that claim.
      const requeued = await driveWorkflow(world.ag2b, next, { stopBefore: 'claim_task' });
      const receipt = requeued.find(step => step.receipt?.kind === 'requeue_task')?.receipt ?? null;
      const value = asRecord(asRecord(asRecord(receipt)['result'])['value']);
      const requeue = asRecord(value['requeue']);
      if (asRecord(asRecord(receipt)['result'])['status'] !== 'committed' || value['kind'] !== 'requeued') {
        throw new Error(`S6A cards: ${input.label}'s automatic requeue did not commit: ${JSON.stringify(receipt)}`);
      }
      return { label: input.label, goal: input.goal, taskId: input.taskId, runRef, requeueRef: requeue['ref'] as TaskRequeueRef };
    }

    let seeded = false;
    const notices: S6ANoticesWorld = {
      world, main, governance, plans, worker, rework,
      async seedReworkNotices() {
        if (seeded) throw new Error('S6A cards: the rework notices are seeded once per world');
        seeded = true;
        const reworks: [S6ARework, S6ARework, S6ARework] = [
          await rework({ label: 'rework-1', goal: world.goals.first, taskId: AG2B_WORK_TASK_ID }),
          await rework({ label: 'rework-2', goal: world.goals.second, taskId: AG2B_WORK_TASK_ID }),
          await rework({ label: 'rework-3', goal: world.goals.first, taskId: S6A_CARDS_SECOND_TASK_ID }),
        ];
        const read = await main.readNotices();
        const ordered = read.notices.map(notice => {
          const match = reworks.find(entry => notice.rework !== null && sameRequeue(notice.rework.sourceRef, entry.requeueRef));
          if (match === undefined) throw new Error(`S6A cards: a notice of no seeded rework: ${JSON.stringify(notice)}`);
          return { notice, rework: match };
        });
        if (ordered.length !== 3 || ordered.some((entry, index) => entry.rework !== reworks[index])) {
          throw new Error(`S6A cards: the notices are not the three reworks in order: ${JSON.stringify(read.notices)}`);
        }
        return { reworks, read,
          notices: ordered.map((entry, index) => ({ index: (index + 1) as 1 | 2 | 3, ...entry })) };
      },
      close: () => world.close(),
    };
    return notices;
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}
