/**
 * Row 9 (service, memory): every decision source the platform constructs
 * carries its own subject (a Goal's, or the project's for a goal-less note), on the source and on its card, and every
 * comparison of a subject accepts the source's own subject and refuses one that
 * differs from it only in `subject`.
 *
 * One table of constructions and accepted comparisons, one table of refusals.
 * Each entry opens its own world and reaches its source through public steps:
 * - the S5 decision world (`openS5DecisionFixture`): its queue (`decisions/queue`
 *   owner) shows the message, Goal-cause, candidate and conflict cards; a
 *   candidate card is answered through the `decisions/answer` owner and adopted
 *   through the `plans/apply` owner with the answer's own source;
 * - the K3 review world (`openK3ReviewCardWorld`): real review records and
 *   their cards, a real rerun request and its card, the decision coordinator's
 *   `resolveDecision`, and a Workflow composed over the world's real owners
 *   whose Runtime, evidence, check and source ports are never called (a call
 *   throws), so its select step reads only the review record;
 * - the S6A host world (`openS6AHostWorld`): a Goal without a Plan, a real
 *   `initial_coordination` Query through `queries/submit`, `queries/claim`,
 *   `queries/prepare` and `queries/start`, the scripted model answering one
 *   planning question; and the notices world (`openS6ANoticesWorld`): goal 1 set
 *   to `every_step` through `goals/settings/set`, its Run failed by the scripted
 *   provider, the Workflow advanced through `workflow/advance`;
 * - the S6B project world (`openS6BProjectWorld`): the scribe's note, its card,
 *   its answer and its re-read through the core routes.
 * The one injected behaviour besides the scripted model is the K3 world's
 * blocking `shell` stand-in. Expected subjects are the worlds' Goals written
 * out; a conflict card names the pair's second Goal when the two GoalRefs are
 * ordered by their canonical JSON (A before B). Refused sources are bodies a
 * real caller can send: the source the platform returned with only its
 * `subject` changed.
 *
 * Not an entry: the start-up re-drive's source (`answeredCardSource`) is used
 * only for the answer lookup, which matches by source kind and key, so no
 * public read shows its subject.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { DecisionSourceV1, DecisionSubjectV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { WorkflowDependencies } from '../../src/business/workflow/ports.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { AG2B_PROJECT_REF, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, AG2B_WORKSPACE_REF, graphWrite, startBusyQuery,
} from '../helpers/AG2b-collaboration-fixture.js';
import { blockedRecord, CRR_COMMAND, crrCardOf, requestRerunOf, reviewCardOf } from '../helpers/B2-crr-world.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { noteCardKey } from '../helpers/S4C2-note-card-fixture.js';
import { owners } from '../helpers/S5-application-support.js';
import { openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { openS6ANoticesWorld, s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE_BINDING } from '../helpers/S6A-request-fixture.js';
import { openS6BProjectWorld, resolveS6BProjectNote, scribeUnderstanding } from '../helpers/S6B1-fixture.js';

// The host worlds' gates sit on the frozen commit barrier: the test file owns its two mocks (no gate is set here).
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
// The K3 world's blocking `shell` stand-in, hoisted per test file: the record Run's real Kernel Turn holds its first
// call so the review reads a real unresolved call. The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const close of closers.splice(0)) await close();
  commitBarrier.reset();
});

// ---------------------------------------------------------------------------
// The worlds' Goals, written out
// ---------------------------------------------------------------------------

const S5_GOAL_A: GoalRef = { aggregateType: 'Goal', projectId: 'P', goalId: 'A' };
const S5_GOAL_B: GoalRef = { aggregateType: 'Goal', projectId: 'P', goalId: 'B' };
const HOST_PROJECT = 'ag2b-collab-project';
const HOST_GOAL_1: GoalRef = { aggregateType: 'Goal', projectId: HOST_PROJECT, goalId: 'ag2b-goal' };
const PLANNING_GOAL: GoalRef = { aggregateType: 'Goal', projectId: HOST_PROJECT, goalId: 'row9-planning-goal' };
const goal = (goalRef: GoalRef): DecisionSubjectV1 => ({ kind: 'goal', goalRef });
const PROJECT_P: DecisionSubjectV1 = { kind: 'project', projectRef: { projectId: 'P' } };

// ---------------------------------------------------------------------------
// World openers and shared public steps
// ---------------------------------------------------------------------------

async function s5World() {
  const f = await openS5DecisionFixture('memory');
  closers.push(() => f.close());
  return { f, o: owners(f) };
}

async function k3World(options: { realKernelCommandFacts?: boolean } = {}): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld('memory', options);
  closers.push(() => world.close());
  return world;
}

type S5 = Awaited<ReturnType<typeof s5World>>;

async function s5Waiting({ f, o }: S5): Promise<DecisionCardV1[]> {
  const read = await o.reads.queryDecisionQueue(f.ctx, { workspace: f.base.scope, sections: ['waiting_answer'],
    page: { limit: 100 } });
  expect(read.status, JSON.stringify(read)).toBe('ready');
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  return read.value.waitingAnswer;
}

function only(cards: readonly DecisionCardV1[], pick: (card: DecisionCardV1) => boolean): DecisionCardV1 {
  const found = cards.filter(pick);
  expect(found, JSON.stringify(cards.map(card => card.source.key))).toHaveLength(1);
  return found[0]!;
}

const subjects = (card: DecisionCardV1) => ({ card: card.subject, source: card.source.subject });

/** The S5 candidate card of request Q1. */
async function q1Candidate(world: S5): Promise<DecisionCardV1> {
  return only(await s5Waiting(world),
    card => card.source.kind === 'candidate' && card.requestRef?.queryJobId === 'Q1');
}

/** Answers the Q1 candidate card with its own source; returns the committed answer. */
async function answerQ1(world: S5) {
  const card = await q1Candidate(world);
  const answered = await world.o.decisions.answerDecision(world.f.ctx, { input: { source: card.source,
    selection: { kind: 'other' }, text: 'adopt it', annotations: [] },
  meta: { requestId: 'row9-q1-answer', expected: card.source.pins } });
  expect(answered.status, JSON.stringify(answered)).toBe('committed');
  if (answered.status !== 'committed') throw new Error(JSON.stringify(answered));
  const response = answered.value.response as { decision: { source: DecisionSourceV1 } };
  return { ref: answered.value.ref, source: response.decision.source };
}

/** `plans/apply` of U1 (Q1's candidate) with the answer as attribution and `decisionSource` as given. */
async function applyU1(world: S5, answer: Awaited<ReturnType<typeof answerQ1>>, decisionSource: DecisionSourceV1) {
  const { f, o } = world;
  const read = await o.plans.queryGoal(f.ctx, S5_GOAL_B);
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  return o.plans.applyPlanChange(f.ctx, { input: { proposalRef: f.candidates.U1.ref,
    expectedProposalRevision: f.candidates.U1.revision, decisionRefs: [], acknowledgementRef: answer.ref, decisionSource },
  meta: { requestId: 'row9-u1-apply', expected: [{ ref: S5_GOAL_B, revision: read.value.goal.revision }] } });
}

async function u1Proposal(world: S5) {
  const read = await world.o.plans.readPlanProposal(world.f.ctx, world.f.candidates.U1.ref);
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  return { status: read.value.status, revision: read.value.revision };
}

/** A port the Workflow must not call: every member throws. */
function notCalled<T extends object>(name: string): T {
  return new Proxy({}, { get: (_target, member) => () => {
    throw new Error(`${name}.${String(member)} must not be called`);
  } }) as T;
}

/** A Workflow over the K3 world's real owners; only its review step runs here. */
function k3Workflow(world: K3ReviewCardWorld) {
  const base = world.fixture.b2.base;
  return createWorkflow({
    tasks: base.goals, plans: base.plans, sessions: base.sessionsPort, claims: base.service,
    executions: createRunStateReader({ records: world.records }),
    runtime: notCalled('runtime'), evidence: notCalled('evidence'), checks: notCalled('checks'),
    sourceAuthority: notCalled('sourceAuthority'),
    configuration: { consumerId: 'row9-workflow', bindings: [{ workspace: world.fixture.base.scope,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: base.roleBinding, budget: base.budget }] },
    unknownCallReviews: world.reviews, goalSettings: world.goalSettings,
    decisionMessages: world.decisions as unknown as NonNullable<WorkflowDependencies['decisionMessages']>,
    messages: world.mailbox,
  });
}

/** A real `needs_decision` review of k3-20-a, its card answered with its own source; returns the captured source. */
async function answeredReview(world: K3ReviewCardWorld) {
  const record = await world.createRecord('k3-20-a');
  const card = await reviewCardOf(world, record);
  const answered = await world.decisions.answerDecision(world.fixture.ctx, { input: { source: card.source,
    selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '', annotations: [] },
  meta: { requestId: 'row9-review-answer', expected: card.source.pins } });
  expect(answered.status, JSON.stringify(answered)).toBe('committed');
  if (answered.status !== 'committed') throw new Error(JSON.stringify(answered));
  const response = answered.value.response as { decision: { source: DecisionSourceV1 } };
  return { record, answerRef: answered.value.ref, source: response.decision.source };
}

async function reviewStatus(world: K3ReviewCardWorld, ref: Awaited<ReturnType<typeof answeredReview>>['record']['ref']) {
  const read = await world.reviews.readReview(world.fixture.ctx, { ref });
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  return { status: read.value.status, disposition: read.value.disposition };
}

// ---------------------------------------------------------------------------
// Constructions and accepted comparisons
// ---------------------------------------------------------------------------

async function messageCard() {
  return subjects(only(await s5Waiting(await s5World()), card => card.source.kind === 'message'));
}

async function goalCauseCard() {
  return subjects(only(await s5Waiting(await s5World()), card => card.source.kind === 'goal_cause'));
}

async function candidateCard() {
  return subjects(await q1Candidate(await s5World()));
}

async function conflictCard() {
  return subjects(only(await s5Waiting(await s5World()), card => card.source.kind === 'goal_conflict'));
}

async function planningQuestionCard() {
  const world = await openS6AHostWorld({ backend: 'memory' });
  closers.push(() => world.close());
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const created = await main.createGoal(PLANNING_GOAL.goalId);
  const session = await world.createWorkSession('row9-planning');
  const card = await world.readSession(session);
  const read = await main.route('goals/read', created.ref) as { value: { goal: { revision: number } } };
  const queryJobRef = { aggregateType: 'QueryJob' as const, ...S6A_SCOPE, queryJobId: 'row9-planning-job' };
  const queryRunRef = { aggregateType: 'QueryRun' as const, ...S6A_SCOPE, queryJobId: queryJobRef.queryJobId,
    runId: 'row9-planning-run' };
  const intent = { schemaVersion: 1, intentId: queryJobRef.queryJobId, ...S6A_SCOPE, goalId: PLANNING_GOAL.goalId,
    question: 'Which acceptance tradeoff should the first plan use?', focusTaskRefs: [], budget: AG2B_QUERY_BUDGET,
    multiTurn: { maxRounds: 1 }, correlationId: 'row9-planning',
    execution: { kind: 'initial_coordination', roleBinding: S6A_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET } };
  const submitted = await world.post('queries/submit', graphWrite(S6A_SCOPE, { queryJobId: queryJobRef.queryJobId,
    runId: queryRunRef.runId, intent }, 'row9-planning-submit', [{ ref: AG2B_PROJECT_REF, revision: 1 },
    { ref: AG2B_WORKSPACE_REF, revision: 1 }, { ref: PLANNING_GOAL, revision: read.value.goal.revision },
    { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }]));
  expect(submitted.body).toMatchObject({ status: 'committed' });
  const claimed = await world.post('queries/claim', graphWrite(S6A_SCOPE, { queryRunRef, sessionRef: card.record.ref },
    'row9-planning-claim', [{ ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
      { ref: card.record.ref, revision: card.record.revision }]));
  expect(claimed.body).toMatchObject({ status: 'committed' });
  await world.scripted.script(session, [{ kind: 'text', text: JSON.stringify({ schemaVersion: 2,
    kind: 'needs_decision', summary: 'One acceptance choice remains.',
    questions: ['Should acceptance favour latency or throughput?'] }) }]);
  const ended = await startBusyQuery(world.ag2b, { queryJobRef, queryRunRef }, 'row9-planning');
  expect(ended.job.job.status).toBe('answered');
  return subjects(only(await main.readCards(PLANNING_GOAL), entry => entry.source.kind === 'planning_question'));
}

async function reviewCard() {
  const world = await k3World();
  return subjects(await reviewCardOf(world, await world.createRecord('k3-20-a')));
}

async function rerunRequestCard() {
  const world = await k3World({ realKernelCommandFacts: true });
  const record = await blockedRecord(world, 'k3-20-b', 'row9-crr', [{ callId: 'row9-crr-call', command: CRR_COMMAND }]);
  await requestRerunOf(world, record, 'row9-crr-request');
  return subjects(await crrCardOf(world));
}

/** The Workflow's select step on a Task whose review waits for the person: it waits with the card's source. */
async function workflowReviewSource() {
  const world = await k3World();
  await world.createRecord('k3-20-a');
  const waited = await k3Workflow(world).advanceWork(world.fixture.ctx, { schemaVersion: 1, goalRef: S5_GOAL_B,
    flowId: 'row9-review-wait', sessionHint: null, taskId: 'k3-20-a', kind: 'select_work' });
  expect(waited).toMatchObject({ status: 'ready', value: { state: 'waiting',
    reason: 'unknown_call_review_needs_decision: the selected Run\'s review record blocks this Task' } });
  return { source: (waited as { value: { source: DecisionSourceV1 } }).value.source.subject };
}

/** goal 1 on `every_step`, a Run the provider fails: the Workflow waits with a Goal-cause source. */
async function workflowGoalCauseSource() {
  const notices = await openS6ANoticesWorld({ backend: 'memory' });
  closers.push(() => notices.close());
  const { world, main, worker } = notices;
  const read = await main.route('goals/read', HOST_GOAL_1) as { value: { goal: { revision: number } } };
  expect(await main.post('goals/settings/set', graphWrite(S6A_SCOPE, { goalRef: HOST_GOAL_1, autonomy: 'every_step',
    waitForGoalRef: null }, 'row9-every-step', [{ ref: HOST_GOAL_1, revision: read.value.goal.revision }])))
    .toMatchObject({ status: 'committed' });
  await world.scripted.script(worker, [
    { kind: 'calls', calls: [{ callId: 'row9-read', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'fail', message: 'row9: the provider fails' },
  ]);
  const steps = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: HOST_GOAL_1, flowId: 'row9-every-step',
    sessionHint: worker.ref, kind: 'select_work', taskId: 'ag2b-work' });
  const last = steps.at(-1);
  expect(last).toMatchObject({ state: 'waiting', reason: 'automation_confirmation_required:system_requeue' });
  return { source: (last as { decisionCause: { source: DecisionSourceV1 } }).decisionCause.source.subject };
}

/**
 * The scribe's goal note: its card, the answer through the card's own source (the source facts read the goal
 * branch and compare the subject), and the card read again. The key is the hand-written `note_review` literal.
 */
async function noteReviewCard() {
  const opened = await openS6BProjectWorld({ backend: 'memory' });
  closers.push(() => opened.close());
  const { main, scribe } = opened;
  const goalRef: GoalRef = { ...scribe.goal };
  const subject = goal(goalRef);
  const written = await scribeUnderstanding(opened.world, scribe, { label: 'row9-goal', structural: true,
    anchor: { kind: 'goal', goalId: goalRef.goalId } });
  expect(written.note.storedState).toBe('pending_review');
  const key = noteCardKey(main.scope.projectId, written.note.noteId, written.note.version);
  const waiting = (await main.readCards(goalRef)).filter(
    (card) => card.source.kind === 'note_review' && card.source.key === key);
  expect(waiting).toHaveLength(1);
  const card = waiting[0]!;
  expect(card.state).toBe('waiting_answer');
  expect(card.source.subject).toEqual(subject);
  expect(card.subject).toEqual(subject);
  expect(card.source.key).toBe(key);
  const { card: read, resolution } = await resolveS6BProjectNote(main, {
    noteId: written.note.noteId, optionId: 'accept', label: 'row9-goal' });
  expect(read.source.key).toBe(key);
  expect(read.source.subject).toEqual(subject);
  expect(resolution).toMatchObject({ status: 'ready', value: {
    answer: { status: 'committed' },
    state: 'applied',
    action: { status: 'done', noteId: written.note.noteId,
      version: written.note.version + 1, state: 'accepted' },
  } });
  const answered = (await main.readCards(goalRef)).find(
    (entry) => entry.source.kind === 'note_review' && entry.source.key === key);
  expect(answered).toBeDefined();
  expect(answered!.state).toBe('applied');
  expect(answered!.source.key).toBe(key);
  const reread = await main.route('decisions/card', { source: answered!.source });
  expect(reread).toMatchObject({ status: 'ready', value: { state: 'applied', source: { key, subject }, subject } });
  return { card: answered!.subject, source: answered!.source.subject };
}

/**
 * The scribe's project note (no goal): its card read and answered in the main workspace through the card's own source
 * (`resolveS6BProjectNote`; the source facts take the project branch), then the note and both workspaces' queues read
 * again. The answer message belongs to the main workspace and the accepted note has left the pending bucket, so the
 * second workspace's queue no longer holds the card.
 */
async function projectNoteCard() {
  const opened = await openS6BProjectWorld({ backend: 'memory' });
  closers.push(() => opened.close());
  const { main, goalless, scribe } = opened;
  const written = await scribeUnderstanding(opened.world, scribe, { label: 'row9-project', structural: true });
  const note = written.note;
  expect(note.storedState).toBe('pending_review');
  expect(note.goalId).toBeNull();
  const key = noteCardKey(main.scope.projectId, note.noteId, note.version);
  const { card, resolution } = await resolveS6BProjectNote(main, {
    noteId: note.noteId, optionId: 'accept', label: 'row9-project' });
  expect(card.source.key).toBe(key);
  const answered = resolution as { status: string; value?: { answer?: { status?: string }; state?: string } };
  const listed = await main.route('notes/list', { anchor: { kind: 'project' },
    state: 'accepted', limit: 100, cursor: null });
  const cardsOf = async (workspace: typeof main) => (await workspace.readCards())
    .filter((entry) => entry.source.key === key).map((entry) => ({ state: entry.state, ...subjects(entry) }));
  return {
    read: subjects(card),
    answer: { status: answered.status, answer: answered.value?.answer?.status, state: answered.value?.state },
    note: (listed as { value: { items: NoteItemV1[] } }).value.items.filter((item) => item.noteId === note.noteId)
      .map((item) => ({ goalId: item.goalId, version: item.version, storedState: item.storedState })),
    main: await cardsOf(main),
    goalless: await cardsOf(goalless),
  };
}

/** Source facts read a goal subject: the answer commits and captures the goal subject. */
async function sourceFactsGoal() {
  const answer = await answerQ1(await s5World());
  return { source: answer.source.subject };
}

/**
 * Source facts rebuild a goal subject from the Goal the branch read: the Q1 candidate card (its identity names Goal B)
 * answered with its own key and pins but Goal A's subject, a body a real caller can send. The saved answer, its
 * message and the card read again all name Goal B.
 */
async function sourceFactsOtherGoalSubject() {
  const world = await s5World();
  const card = await q1Candidate(world);
  const answered = await world.o.decisions.answerDecision(world.f.ctx, { input: {
    source: { ...card.source, subject: goal(S5_GOAL_A) }, selection: { kind: 'other' }, text: 'adopt it',
    annotations: [] }, meta: { requestId: 'row9-q1-other-goal', expected: card.source.pins } });
  if (answered.status !== 'committed') throw new Error(JSON.stringify(answered));
  const response = answered.value.response as { decision: { source: DecisionSourceV1 } };
  const reread = await world.o.reads.readDecisionCard(world.f.ctx, { source: card.source });
  if (reread.status !== 'ready') throw new Error(JSON.stringify(reread));
  return { source: response.decision.source.subject, message: answered.value.goalRef, card: subjects(reread.value) };
}

/** The plan decoder takes the answer's own goal-subject source: the adoption commits. */
async function planDecoderGoal() {
  const world = await s5World();
  const answer = await answerQ1(world);
  const applied = await applyU1(world, answer, answer.source);
  return { source: answer.source.subject, status: applied.status, proposal: await u1Proposal(world) };
}

/** The disposition's source is the answer's captured source: the coordinator applies it. */
async function reviewDispositionSameSubject() {
  const world = await k3World();
  const record = await world.createRecord('k3-20-a');
  const card = await reviewCardOf(world, record);
  const resolved = await world.decisionActions.resolveDecision(world.fixture.ctx, { input: { source: card.source,
    selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '', annotations: [] },
  meta: { requestId: 'row9-review-resolve', expected: card.source.pins } });
  if (resolved.status !== 'ready') throw new Error(JSON.stringify(resolved));
  return { source: card.source.subject, state: resolved.value.state, review: (await reviewStatus(world, record.ref)).status };
}

const S5_B = goal(S5_GOAL_B);
const HOST_1 = goal(HOST_GOAL_1);
const HOST_PROJECT_SUBJECT: DecisionSubjectV1 = { kind: 'project', projectRef: { projectId: HOST_PROJECT } };

describe('row 9: every source construction and subject comparison keeps its subject', () => {
  it.each([
    { entry: 'message source (mailbox)', observe: messageCard, expected: { card: S5_B, source: S5_B } },
    { entry: 'Goal-cause reader', observe: goalCauseCard, expected: { card: S5_B, source: S5_B } },
    { entry: 'candidate card', observe: candidateCard, expected: { card: S5_B, source: S5_B } },
    { entry: 'Goal conflict (the pair\'s second Goal)', observe: conflictCard, expected: { card: S5_B, source: S5_B } },
    { entry: 'planning question', observe: planningQuestionCard,
      expected: { card: goal(PLANNING_GOAL), source: goal(PLANNING_GOAL) } },
    { entry: 'review card', observe: reviewCard, expected: { card: S5_B, source: S5_B } },
    { entry: 'rerun request card', observe: rerunRequestCard, expected: { card: S5_B, source: S5_B } },
    { entry: 'Workflow review wait', observe: workflowReviewSource, expected: { source: S5_B } },
    { entry: 'Workflow Goal cause', observe: workflowGoalCauseSource, expected: { source: HOST_1 } },
    { entry: 'note review card, answered and re-read', observe: noteReviewCard,
      expected: { card: HOST_1, source: HOST_1 } },
    // `goalless: []` is hand-derived from the code's rules, not a spec line: the answer history is per workspace (the
    // answer message belongs to the main workspace) and the accepted note has left the pending bucket.
    { entry: 'project note card, answered in the main workspace and re-read in both', observe: projectNoteCard,
      expected: { read: { card: HOST_PROJECT_SUBJECT, source: HOST_PROJECT_SUBJECT },
        answer: { status: 'ready', answer: 'committed', state: 'applied' },
        note: [{ goalId: null, version: 2, storedState: 'accepted' }],
        main: [{ state: 'applied', card: HOST_PROJECT_SUBJECT, source: HOST_PROJECT_SUBJECT }],
        goalless: [] } },
    { entry: 'source facts read a goal subject', observe: sourceFactsGoal, expected: { source: S5_B } },
    { entry: 'source facts rebuild a goal subject from the Goal read', observe: sourceFactsOtherGoalSubject,
      expected: { source: S5_B, message: S5_GOAL_B, card: { card: S5_B, source: S5_B } } },
    { entry: 'plan decoder takes a goal subject', observe: planDecoderGoal,
      expected: { source: S5_B, status: 'committed', proposal: { status: 'accepted', revision: 2 } } },
    { entry: 'review disposition with the captured subject', observe: reviewDispositionSameSubject,
      expected: { source: S5_B, state: 'applied', review: 'resolved' } },
  ])('$entry', async ({ observe, expected }) => {
    expect(await observe()).toEqual(expected);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Refusals: a source that differs from the platform's only in `subject`
// ---------------------------------------------------------------------------

/** Source facts: the Q1 candidate card's own source with a project subject. */
async function sourceFactsProject() {
  const world = await s5World();
  const card = await q1Candidate(world);
  const refused = await world.o.decisions.answerDecision(world.f.ctx, { input: {
    source: { ...card.source, subject: PROJECT_P }, selection: { kind: 'other' }, text: 'adopt it', annotations: [] },
  meta: { requestId: 'row9-q1-project', expected: card.source.pins } });
  const after = (await s5Waiting(world)).filter(entry => entry.source.key === card.source.key);
  return { refused, after: after.map(entry => ({ state: entry.state, answer: entry.answerMessageRef })) };
}

/** The plan decoder: the answer's own source with a project subject. */
async function planDecoderProject() {
  const world = await s5World();
  const answer = await answerQ1(world);
  const refused = await applyU1(world, answer, { ...answer.source, subject: PROJECT_P });
  return { refused, after: await u1Proposal(world) };
}

/** The review disposition: the answer's captured source naming Goal A. */
async function reviewDispositionOtherGoal() {
  const world = await k3World();
  const answer = await answeredReview(world);
  const refused = await world.reviews.applyDisposition(world.fixture.ctx, { input: {
    source: { ...answer.source, subject: goal(S5_GOAL_A) }, selection: { kind: 'option', optionId: 'rerun_as_is' },
    decisionMessageRef: answer.answerRef }, meta: { requestId: 'row9-review-other-goal', expected: answer.source.pins } });
  return { refused, after: await reviewStatus(world, answer.record.ref) };
}

describe('rejects: a source that differs from the platform\'s only in its subject', () => {
  it.each([
    { entry: 'source facts: a project subject on a goal card', observe: sourceFactsProject,
      refused: { status: 'rejected', code: 'invalid', reason: 'a project subject serves only a note_review source' },
      after: [{ state: 'waiting_answer', answer: null }] },
    { entry: 'plan decoder: a project subject', observe: planDecoderProject,
      refused: { status: 'rejected', code: 'invalid', reason: 'decisionSource must be a DecisionSourceV1 shape' },
      after: { status: 'candidate', revision: 1 } },
    { entry: 'review disposition: the captured source naming another Goal', observe: reviewDispositionOtherGoal,
      refused: { status: 'rejected', code: 'invalid', reason: 'the disposition source disagrees with the answer\'s captured pins' },
      after: { status: 'needs_decision', disposition: null } },
  ])('$entry', async ({ observe, refused, after }) => {
    const result = await observe();
    expect(result.refused).toMatchObject(refused);
    expect(result.after).toEqual(after);
  }, 120_000);
});
