/**
 * The secretary round's answers and ideas (R-11) and the initialization
 * branch of a request round (R-14's request part), reached the way real use
 * reaches them: the Host's own request driver claims, prepares and runs every
 * round, so the test never calls `queries/claim|prepare|start`. A person
 * submits the request through `requests/submit`; the scripted model reply of
 * the owner Session is queued before the submit; the read is the public
 * request read.
 *
 * The rules these rows guard:
 * - A `semantic_query` answer stores its body as the round's answer, keeps 0,
 *   2 or 3 ideas exactly as sent, and stores no goal card drafts when the
 *   request has a goal. One idea, four ideas, an idea detail over 600 code
 *   points and any draft on a goal request are all `invalid_answer` /
 *   `protocol`, and the round reads `ended` with no answer.
 * - The execution kind is frozen at preparation from the two governance
 *   pointers: both present run `semantic_query`; a missing architecture or
 *   completion policy runs `initial_coordination`. A no-goal coordination
 *   answer is the whole v2 JSON (the platform's own parser gives it
 *   `ideas: []`), and its top-level drafts are parsed with `screening: null`.
 *   The model input ends with the answer format of the frozen kind, and only
 *   the coordination input carries the drafts note. A pointer installed after
 *   preparation does not change the branch, and a round answered with drafts
 *   proposes and adopts nothing: the goals and their plan versions read the
 *   same before the pointer change and after the round.
 *
 * Every answer is queued through `world.scripted.script` (the runtime
 * configuration's scripted provider, a Host input) before the submit, and the
 * test installs the commit barrier's two `vi.mock`s because the hold at gate
 * (c) waits on the real start commit. Expected values are literals or come
 * from the frozen `tests/helpers/S6A-prompt-samples.ts`; no record is written
 * by hand and nothing is asserted by reading the store.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobAnswerSnapshot, QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { GoalConflictReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  secretaryAnswer, submitRound, threeIdeas, waitForRound, type S6AIdea,
} from '../helpers/S6A-history-fixture.js';
import { seedS6AMemory, S6A_GOVERNANCE_CASES } from '../helpers/S6A-memory-fixture.js';
import { answerFormatText, SECRETARY_INITIAL_DRAFTS } from '../helpers/S6A-prompt-samples.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier: gate (c) holds a real start commit, so the test
// file owns the two mocks (tests/helpers/S6A-commit-barrier.ts).
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  // Release anything still held before the worlds close (a held commit keeps a
  // tracked call open), then report what was left.
  const left = commitBarrier.reset();
  await Promise.all(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

/** The one world shape these rows use: SQLite, with the Host's own request driver on. */
async function openWorld(): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  return world;
}

/** One round of the request read by its ref; a missing round fails the row. */
function roundOf(view: RequestCoreViewV1, ref: QueryJobRef): RequestCoreViewV1['rounds'][number] {
  const found = view.rounds.find(round => round.ref.queryJobId === ref.queryJobId);
  if (found === undefined) throw new Error(`the request read has no round ${ref.queryJobId}`);
  return found;
}

/** The public answer snapshot of the round's latest stored answer, with the ref the Job names. */
async function answerSnapshot(world: S6AHostWorld, round: QueryJobRef):
Promise<{ answerRef: QueryJobAnswerSnapshot['ref']; value: QueryJobAnswerSnapshot }> {
  const { job } = await readQuery(world.ag2b, round);
  const answerRef = job.job.answerRefs.at(-1);
  if (answerRef === undefined) throw new Error(`the round ${round.queryJobId} stores no answer`);
  const read = (await world.post('queries/answer', body(answerRef))).body as ReadResult<QueryJobAnswerSnapshot>;
  if (read.status !== 'ready') throw new Error(`the answer ${JSON.stringify(answerRef)} is not readable: ${JSON.stringify(read)}`);
  return { answerRef, value: read.value };
}

/** The last user message of the Session's last model request: the rendered input of its last round. */
async function lastInput(world: S6AHostWorld, session: S6ASession): Promise<string> {
  const requests: ModelRequest[] = await world.scripted.requests(session);
  const request = requests.at(-1);
  if (request === undefined) throw new Error('the Session served no model request');
  const messages = request.messages as unknown as { role: string; content: string }[];
  const last = messages.at(-1);
  if (last === undefined) throw new Error('the model request carried no message');
  expect(last.role).toBe('user');
  return last.content;
}

/** The two ideas of the two-idea case: hand-written literals, not a builder. */
const IDEAS_TWO: readonly S6AIdea[] = [
  { title: 'Keep one module', detail: 'Add a facade and leave the files where they are.' },
  { title: '先拆读取层', detail: '把读取和写入分开，再逐步迁移调用方。' },
];

type InvalidCase = { label: string; answer: string };

/** Each case breaks exactly one answer rule; the close is `invalid_answer` / `protocol`. */
const INVALID_CASES: readonly InvalidCase[] = [
  { label: 'one idea',
    answer: secretaryAnswer({ body: 'S6A one-idea answer', ideas: [{ title: 'Only idea', detail: 'a single option' }] }) },
  { label: 'four ideas',
    answer: secretaryAnswer({ body: 'S6A four-idea answer', ideas: [...IDEAS_TWO, ...threeIdeas('S6A fourth')].slice(0, 4) }) },
  { label: '601-code-point detail',
    answer: secretaryAnswer({ body: 'S6A long-detail answer',
      ideas: [IDEAS_TWO[0]!, { title: 'One legal title', detail: 'd'.repeat(601) }] }) },
  { label: 'drafts on a goal request',
    answer: secretaryAnswer({ body: 'S6A goal-draft answer', ideas: [],
      goalCardDrafts: [{ objective: 'S6A goal card', completion: ['S6A completion criterion'], autonomy: 'every_step' }] }) },
];

/** The v2 initial-planning answer of a no-goal request, with one top-level draft. */
const V2_DRAFT = { objective: 'S6A initial objective', completion: ['S6A initial criterion'],
  autonomy: 'after_plan_confirmation' } as const;
const V2_ANSWER = JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'S6A initial planning summary',
  questions: ['S6A initial planning question'], goalCardDrafts: [V2_DRAFT] });

describe('R-11: a semantic answer stores its body, its ideas and no draft', () => {
  it('no idea, two ideas and three ideas are stored exactly and read back from the answer snapshot', async () => {
    const world = await openWorld();
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    const cases: readonly { label: string; ideas: readonly S6AIdea[] }[] = [
      { label: 'none', ideas: [] },
      { label: 'two', ideas: IDEAS_TWO },
      { label: 'three', ideas: threeIdeas('S6A row A') },
    ];
    for (const entry of cases) {
      const answerBody = `S6A answer with ${entry.label} ideas`;
      await world.scripted.script(a, [{ kind: 'text', text: secretaryAnswer({ body: answerBody, ideas: entry.ideas }) }]);
      const { requestRoot, round } = await submitRound(world, { commandId: `s6a-context-ideas-${entry.label}`,
        goalId: S6A_GOAL_1.goalId, text: `S6A ideas ${entry.label}`, recipient: a });
      const view = await waitForRound(world, requestRoot, round, 'ended');
      // The round view keeps the body as the answer and exactly the ideas that were sent.
      expect(roundOf(view, round), entry.label).toMatchObject({ ref: round, status: 'ended', answer: answerBody,
        ideas: entry.ideas, goalCardDrafts: [] });

      const { answerRef, value } = await answerSnapshot(world, round);
      expect(value, entry.label).toMatchObject({ ref: answerRef, revision: 1, schemaVersion: 1,
        answer: { answer: answerBody, ideas: entry.ideas, goalCardDrafts: [] } });
    }
  }, 180_000);
});

// Rule A6: the constructed rejections sit in their own `rejects:` block, apart
// from the stored answers above.
describe('rejects: invalid secretary answers', () => {
  it('one idea, four ideas, a 601-code-point detail and goal drafts close the round invalid_answer/protocol', async () => {
    const world = await openWorld();
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    for (const entry of INVALID_CASES) {
      await world.scripted.script(a, [{ kind: 'text', text: entry.answer }]);
      const { requestRoot, round } = await submitRound(world, { commandId: `s6a-context-invalid-${entry.label}`.replace(/ /g, '-'),
        goalId: S6A_GOAL_1.goalId, text: `S6A invalid ${entry.label}`, recipient: a });
      const view = await waitForRound(world, requestRoot, round, 'ended');
      // The request read shows a closed round with no answer and the protocol detail.
      expect(roundOf(view, round), entry.label).toMatchObject({ ref: round, status: 'ended', answer: null,
        closeCode: 'invalid_answer', closeDetail: 'protocol' });

      const { job } = await readQuery(world.ag2b, round);
      expect(job.job, entry.label).toMatchObject({ status: 'closed', answerRefs: [],
        closeReason: { code: 'invalid_answer', detail: 'protocol' } });
      const closeReason = job.job.closeReason;
      if (closeReason === null) throw new Error(`${entry.label}: the closed round records no close reason`);
      // The message is the platform's own reason; only its shape is checked, never its text.
      expect(typeof closeReason.message, entry.label).toBe('string');
      expect(closeReason.message.length, entry.label).toBeGreaterThan(0);
    }
  }, 180_000);
});

describe('R-14: the initialization branch of a no-goal request round', () => {
  it('the frozen branch of each governance case answers, parses its drafts and ends with its own answer format', async () => {
    for (const governanceCase of S6A_GOVERNANCE_CASES) {
      const world = await openWorld();
      await seedS6AMemory(world, { architecture: governanceCase.architecture, policy: governanceCase.policy });
      const a = await world.createSecretary('a');
      const executionKind = governanceCase.architecture && governanceCase.policy
        ? 'semantic_query' : 'initial_coordination';
      const semanticBody = 'S6A semantic no-goal answer';
      const answer = executionKind === 'semantic_query' ? secretaryAnswer({ body: semanticBody }) : V2_ANSWER;
      await world.scripted.script(a, [{ kind: 'text', text: answer }]);
      const { requestRoot, round } = await submitRound(world, {
        commandId: `s6a-context-gov-${governanceCase.name}`.replace(/ /g, '-'),
        goalId: null, text: `S6A no-goal request (${governanceCase.name})`, recipient: a });
      const view = await waitForRound(world, requestRoot, round, 'ended');
      const roundView = roundOf(view, round);
      expect(roundView.status, governanceCase.name).toBe('ended');
      if (executionKind === 'initial_coordination') {
        // The v2 answer's body is the whole JSON text; the platform parses its drafts.
        expect(roundView.answer, governanceCase.name).toBe(V2_ANSWER);
        expect(roundView.ideas, governanceCase.name).toEqual([]);
        expect(roundView.goalCardDrafts, governanceCase.name).toEqual([{ index: 0, draft: {
          objective: V2_DRAFT.objective, completion: [...V2_DRAFT.completion],
          autonomy: V2_DRAFT.autonomy, screening: null } }]);
      } else {
        // The semantic answer stores its body, not the JSON text, and carries no draft.
        expect(roundView.answer, governanceCase.name).toBe(semanticBody);
        expect(roundView.ideas, governanceCase.name).toEqual([]);
        expect(roundView.goalCardDrafts, governanceCase.name).toEqual([]);
      }

      const input = await lastInput(world, a);
      expect(input.endsWith(answerFormatText({ executionKind, noGoal: true })), governanceCase.name).toBe(true);
      expect(input.includes(SECRETARY_INITIAL_DRAFTS), governanceCase.name)
        .toBe(executionKind === 'initial_coordination');
    }
  }, 180_000);

  it('a pointer change while the round is held before its start keeps the frozen branch and changes no goal or plan', async () => {
    const world = await openWorld();
    const memory = await seedS6AMemory(world, { architecture: false, policy: false, notes: false });
    const a = await world.createSecretary('a');
    const goalRefs = [world.goals.first, world.goals.second];
    const readGoals = async (): Promise<unknown[]> =>
      await Promise.all(goalRefs.map(async goal => {
        const answer = await world.post('goals/read', body(goal));
        expect(answer.body, `goals/read of ${goal.goalId}`).toMatchObject({ status: 'ready' });
        return answer.body;
      }));
    const readPlans = async (): Promise<unknown[]> =>
      await Promise.all(goalRefs.map(async goal => {
        const answer = await world.post('plans/versions',
          body({ goalId: goal.goalId, limit: 50, cursor: null }));
        expect(answer.body, `plans/versions of ${goal.goalId}`).toMatchObject({ status: 'ready' });
        return answer.body;
      }));
    /**
     * The workspace's goal ids, as `goals/conflicts` enumerates every goal of the
     * workspace (goal-conflicts.ts:242, :270). The two fixed reads above name two
     * goals; this read would also show a third one created behind them.
     */
    const readConflictGoalIds = async (): Promise<string[]> => {
      const answer = await world.post('goals/conflicts', body({ workspace: S6A_SCOPE }));
      expect(answer.body, 'goals/conflicts').toMatchObject({ status: 'ready' });
      const read = answer.body as ReadResult<GoalConflictReadV1>;
      if (read.status !== 'ready') throw new Error(`goals/conflicts is not ready: ${JSON.stringify(answer.body)}`);
      return read.value.footprintCompleteness.map(entry => entry.goalRef.goalId).sort();
    };
    const goalsBefore = await readGoals();
    const plansBefore = await readPlans();
    const conflictsBefore = await readConflictGoalIds();

    // Prepared, not started: the start commit is held, so the frozen manifest
    // names `initial_coordination` before either pointer exists.
    const gate = world.gates.beforeStart(a);
    await world.scripted.script(a, [{ kind: 'text', text: V2_ANSWER }]);
    const { requestRoot, round } = await submitRound(world, { commandId: 's6a-context-frozen-branch', goalId: null,
      text: 'S6A no-goal request before the pointers', recipient: a });
    await gate.reached;

    // The two pointers arrive through the fixture's public routes while the
    // round waits; the prepared round keeps the branch it froze.
    await memory.governance.adoptArchitecture({ settle: false });
    await memory.governance.activatePolicy();
    gate.release();

    const view = await waitForRound(world, requestRoot, round, 'ended');
    const roundView = roundOf(view, round);
    expect(roundView.answer).toBe(V2_ANSWER);
    expect(roundView.ideas).toEqual([]);
    expect(roundView.goalCardDrafts).toEqual([{ index: 0, draft: { objective: V2_DRAFT.objective,
      completion: [...V2_DRAFT.completion], autonomy: V2_DRAFT.autonomy, screening: null } }]);
    // The draft is a proposal only: the round left no pending plan candidate behind.
    expect(view.candidate).toBeNull();
    expect(view.processing).toBe(false);

    const input = await lastInput(world, a);
    expect(input.endsWith(answerFormatText({ executionKind: 'initial_coordination', noGoal: true }))).toBe(true);
    expect(input.includes(SECRETARY_INITIAL_DRAFTS)).toBe(true);

    // Nothing was proposed or adopted: the same goals at the same revisions and
    // the same plan versions, before the pointer change and after the round.
    expect(await readGoals()).toEqual(goalsBefore);
    expect(await readPlans()).toEqual(plansBefore);
    const goalIds = (reads: readonly unknown[]): unknown[] => reads.map(read => {
      const result = read as ReadResult<{ goal: { ref: { goalId: string } } }>;
      if (result.status !== 'ready') throw new Error('the goal read is not ready');
      return result.value.goal.ref.goalId;
    });
    expect(goalIds(await readGoals())).toEqual(goalIds(goalsBefore));
    expect(goalIds(goalsBefore)).toEqual([world.goals.first.goalId, world.goals.second.goalId]);
    // The workspace holds exactly those two goals, before the pointer change and
    // after the round: a goal the draft would have created would show here.
    expect(await readConflictGoalIds()).toEqual(conflictsBefore);
    expect(conflictsBefore).toEqual([world.goals.first.goalId, world.goals.second.goalId].sort());
  }, 180_000);
});
