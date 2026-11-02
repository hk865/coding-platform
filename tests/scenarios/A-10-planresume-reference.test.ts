/**
 * A-10 (DR-P2-12, which overrides the spec's 16 KiB cards): `planresume:` carries only the request head and the
 * original Query reference, the five 14 KiB card answers are assembled into the model input at preparation, the
 * continuation's final text answers the original executor M once, and M continues on a new Run.
 *
 * The reachable half sends the real `planresume:` through P1's `sendSystemRound` after the five cards are answered
 * (recipient: the real adviser line; `followupOf`: the lineage root read through the public `queries/read`), lets the
 * existing Host consume it, and reads the message body, the Query question/`answerShape`/`repliesToMessageRef`, the
 * replay identity and `plans/proposal`. The automatic half is the row's business red: the goal driver must send the
 * same round by itself (P4's send, P5's read, L's wiring), so that test waits for the automatic system round exactly
 * as before and stops there on this tree.
 *
 * PL-33 cannot reach a reply whose source is not its own M, so the reply-target row here proves PL P2-01: the
 * `needs_decision` round keeps M open, the real `planresume:` freezes M as `repliesToMessageRef`, and the
 * continuation's short text lands on M's one reply slot. The SQLite-only row saves the same round, reopens before preparation, and stops
 * at the missing pre-start assembly (`query-preparation.ts:379`).
 *
 * The five cards are each 14 KiB of printable ASCII (70 KiB total, over 64 KiB), reusing `questionCards`/
 * `answerCard`; the goal driver is the DRV `startGoalDriver`/`waitDriver`; the model input comes from the S6A
 * `scripted.requests`; the saved body comes from `readBody`. The continuation's answer is a saved plain non-v2
 * text, so §5.3.5's plan_round text-fallback reply is compared verbatim.
 *
 * The lead-ruled sub-items are in this file: a no-source historical `initial_coordination` question on the same
 * Goal (P5's driver read), and an A2 wrapper around the real `platform.messages.readMessage` that fails once during
 * planresume preparation (P3's preparation). Both run as far as this tree allows and stop at their named seam.
 */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { systemRoundRequestId, systemRoundMessageRef } from '../../src/contracts/plan-round.js';
import {
  answerCard, heartbeat, heartbeatUntil, proposalRefOf, questionCards, readBody, readPlanningQuery,
  sessionQueries, settleHost, waitForResponse,
} from '../helpers/IV-host-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import { claimQuery } from '../helpers/request-claim-steps.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import {
  createPLAdviserLine, needsDecisionAnswer, asciiAnswerText, openPLConsumptionWorld, originalQueryRefLine,
  plPlanResumeRound, readPLPlanResumeRoot, readSystemRound, seedPLHistoryQuestion,
  seedPLSenderPlan, sendPLActionWait, sendPLPlanResume, sendPLSystemRound, installPLDecisionReadFault,
} from '../helpers/PL-consumption-fixture.js';
import { runsOf, startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';
import { waitFor } from './harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

const QUESTIONS = ['q1: which module owns the boundary?', 'q2: which check proves it?',
  'q3: which task stays untouched?', 'q4: which line answers the card?', 'q5: what is out of scope?'];

/**
 * The real answered round of A-10: one adopted Plan, one Work line's `action_request` M to the real adviser line,
 * the adviser's `needs_decision` answer, and the five 14 KiB cards answered by the person. Every step is a public
 * route or the scripted model; no record is written by hand.
 */
async function answeredReferenceRound(world: S6AHostWorld, label: string): Promise<{
  goal: S6AHostWorld['goals']['first']; adviser: Awaited<ReturnType<typeof createPLAdviserLine>>;
  m: Awaited<ReturnType<typeof sendPLActionWait>>; originalQuestion: string; answers: string[];
}> {
  const goal = world.goals.first;
  const seeded = await seedPLSenderPlan(world, { goal, label, taskIds: [`${label}-send`] });
  const adviser = await createPLAdviserLine(world, `${label}-adviser`);
  const originalQuestion = `PL ${label} original question: which boundary owns the adviser query?`;
  const m = await sendPLActionWait(world, { goal, session: seeded.line, sessionTaskId: `${label}-send`,
    recipient: adviser.ref, text: originalQuestion, label });
  await world.scripted.script(adviser, [{ kind: 'text', text: needsDecisionAnswer(`PL ${label} questions`, QUESTIONS) }]);
  const cards = await heartbeatUntil(world, () => questionCards(world, goal), items => items.length === 5, 20);
  expect(cards, 'the needs_decision answer opens five question cards').toHaveLength(5);
  const answers = cards.map((_card, index) => asciiAnswerText(`PL ${label} answer ${String(index)}`));
  for (const [index, card] of cards.entries()) {
    expect(Buffer.byteLength(answers[index]!, 'utf8'), 'each card answer is 14 KiB of UTF-8').toBe(14 * 1024);
    await answerCard(world, card, `${label}-card-${String(index)}`, answers[index]!);
  }
  expect(answers.reduce((total, answer) => total + Buffer.byteLength(answer, 'utf8'), 0),
    'the five card answers total 70 KiB').toBe(70 * 1024);
  return { goal, adviser, m, originalQuestion, answers };
}

describe('A-10: planresume carries a reference; the assembled input carries the five answers', () => {
  it('A-10 reachable: the real planresume body and Query carry only the reference, and the replay is the same', async () => {
    const world = await openPLConsumptionWorld({ contextWindowTokens: 1_000_000, label: 'a10-reach' });
    worlds.push(world);
    await settleHost(world);
    const { goal, adviser, m, originalQuestion, answers } = await answeredReferenceRound(world, 'a10-reach');

    // The lineage root is the original executor M, read through the public QueryJob, not hand-made.
    const root = await readPLPlanResumeRoot(world, m.message.ref);
    expect(root.messageId, 'the lineage root is the original executor M').toBe(m.message.ref.messageId);

    const originalQuery = interventionPlanningQueryRefs(m.message.ref);
    const round = plPlanResumeRound({ goal, originalQueryJobId: originalQuery.queryJobRef.queryJobId,
      originalMessageRef: m.message.ref });
    const requestId = systemRoundRequestId(round);
    expect(requestId.status).toBe('ready');
    if (requestId.status !== 'ready') return;
    const resumeRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
    expect(resumeRef.status).toBe('ready');
    if (resumeRef.status !== 'ready') return;

    // The candidate read of the original executor is what the row keeps unchanged across the continuation.
    const proposalOf = async (): Promise<unknown> =>
      (await world.post('plans/proposal', { scope: S6A_SCOPE, input: proposalRefOf(m.message.ref, goal) })).body;
    const proposalBefore = await proposalOf();

    const sent = await sendPLPlanResume(world, { line: adviser, goal,
      originalQueryJobId: originalQuery.queryJobRef.queryJobId, originalMessageRef: m.message.ref, followupOf: root });
    expect(sent.result.status, 'the real Host send commits the planresume').toBe('committed');
    expect(sent.messageRef.messageId, 'the message identity is deterministic').toBe(resumeRef.value.messageId);

    const resume = await heartbeatUntil(world, () => readSystemRound(world, round),
      read => read.status === 'ready', 40);
    expect(resume.status, 'the real Host saved the planresume message').toBe('ready');
    if (resume.status !== 'ready') return;
    const resumeMessage = resume.value;

    const body = await readBody(world, resumeMessage.ref, 'message');
    const lines = body.split('\n');
    expect(lines[0], 'the body starts with the request id').toBe(requestId.value);
    expect(lines[1], 'the body carries only the original Query reference').toBe(originalQueryRefLine(m.message.ref));
    expect(lines[2], 'the body carries the fixed request sentence').toBe(
      '人已答完这一轮的问题卡；接着原规划轮写下一步：只输出这一段/这一版，平台会合并');
    expect(lines, 'the body is exactly the head, the reference and the sentence').toHaveLength(3);
    expect(body, 'the saved body has no original question').not.toContain(originalQuestion);
    for (const answer of answers) expect(body, 'no card answer is saved in the body').not.toContain(answer);
    expect(Buffer.byteLength(body, 'utf8'), 'the saved body is small').toBeLessThan(1024);

    // The existing Host consumes the system round into the deterministic intervention planning Query.
    const query = await heartbeatUntil(world, () => readPlanningQuery(world, resumeMessage.ref),
      record => record !== null, 40);
    expect(query, 'the planresume opened its planning Query').not.toBeNull();
    if (query === null) return;
    expect(query.job.job.intent.question, 'the Query question is the same small body').toBe(body);
    const execution = query.job.job.intent.execution;
    expect(execution.kind, 'the continuation stays an intervention planning Query').toBe('intervention_planning');
    if (execution.kind !== 'intervention_planning') return;
    expect(execution.answerShape, 'the Query freezes the plan_round answer shape').toBe('plan_round');
    expect(execution.repliesToMessageRef, 'the Query inherits the lineage root M as its reply target')
      .toEqual(root);

    // The prepared model input is P3's half: observe it when this tree records a continuation request.
    const requests = await world.scripted.requests(adviser);
    const continuation = requests.find(request => JSON.stringify(request).includes(requestId.value));
    if (continuation !== undefined) {
      const modelInput = JSON.stringify(continuation);
      expect(modelInput, 'the original question is assembled into the model input').toContain(originalQuestion);
      for (const [index, answer] of answers.entries()) {
        expect(modelInput, `the saved answer ${String(index)} is assembled into the model input`).toContain(answer);
      }
    }

    expect(await proposalOf(), 'the original executor proposal read is unchanged').toEqual(proposalBefore);

    // The same request id replays the same message and Query, never a second round. Let the Host attach the
    // continuation Query to the line first, then replay and compare the same public lists.
    await heartbeat(world);
    await heartbeat(world);
    const beforeQueries = (await sessionQueries(world, adviser)).length;
    const beforeInbox = (await inboxOf(world, adviser.ref)).length;
    const replay = await sendPLSystemRound(world, { line: adviser, round, text: requestId.value,
      followupOf: root, allowReplay: true });
    expect(['committed', 'skipped']).toContain(replay.result.status);
    if (replay.result.status === 'committed') {
      expect(replay.result.value.ref.messageId, 'the repeat send names the committed message')
        .toBe(sent.messageRef.messageId);
    }
    await heartbeat(world);
    expect((await sessionQueries(world, adviser)).length, 'the replay opens no second Query').toBe(beforeQueries);
    expect((await inboxOf(world, adviser.ref)).length, 'the replay writes no second message').toBe(beforeInbox);
  }, 120_000);

  it('A-10 SQLite only: an unprepared planresume reassembles the original Q&A input after reopen', async () => {
    const world = await openPLConsumptionWorld({ contextWindowTokens: 1_000_000, backend: 'sqlite', label: 'a10-restart' });
    worlds.push(world);
    await settleHost(world);
    const { goal, adviser, m, originalQuestion, answers } = await answeredReferenceRound(world, 'a10-restart');

    const root = await readPLPlanResumeRoot(world, m.message.ref);
    const originalQuery = interventionPlanningQueryRefs(m.message.ref);
    const round = plPlanResumeRound({ goal, originalQueryJobId: originalQuery.queryJobRef.queryJobId,
      originalMessageRef: m.message.ref });
    const requestId = systemRoundRequestId(round);
    expect(requestId.status).toBe('ready');
    if (requestId.status !== 'ready') return;
    const sent = await sendPLPlanResume(world, { line: adviser, goal,
      originalQueryJobId: originalQuery.queryJobRef.queryJobId, originalMessageRef: m.message.ref,
      followupOf: root });
    expect(sent.result.status, 'the real Host send commits the planresume').toBe('committed');

    // The message is saved but no consume pass ran after it: the continuation is not prepared before the restart.
    const before = await readPlanningQuery(world, sent.messageRef);
    expect(before, 'the continuation Query is not prepared before the restart').toBeNull();

    await world.reopen();
    const savedBody = await readBody(world, sent.messageRef, 'message');
    expect(savedBody.split('\n')[1], 'the saved planresume still names the same originalQueryRef')
      .toBe(originalQueryRefLine(m.message.ref));
    // The restart leaves a pending GoalInterruption: a person starts the Goal before the Host consumes again.
    await startGoalDriver(world, goal, 'a10-restart-goal');
    await world.scripted.script(adviser, [{ kind: 'text', text: 'PL A10 restart final text' }]);
    const requests = await heartbeatUntil(world, () => world.scripted.requests(adviser),
      items => items.some(request => JSON.stringify(request).includes(requestId.value)), 40);
    const continuation = requests.find(request => JSON.stringify(request).includes(requestId.value));
    expect(continuation, 'the restarted Host made the continuation model request').toBeDefined();
    if (continuation === undefined) return;
    // The same `originalQueryRef` must reassemble the original question and the five saved Q&A groups.
    const modelInput = JSON.stringify(continuation);
    const missing = [originalQuestion, ...QUESTIONS, ...answers].filter(text => !modelInput.includes(text));
    if (missing.length > 0) {
      expect.fail(`${String(missing.length)} of the 11 expected texts `
        + '(original question, five questions, five answers) are missing');
    }
    for (const [index, question] of QUESTIONS.entries()) {
      expect(modelInput, `the question ${String(index)} is assembled into the model input`).toContain(question);
    }
    for (const [index, answer] of answers.entries()) {
      expect(modelInput, `the saved answer ${String(index)} is assembled into the model input`).toContain(answer);
    }
    expect(continuation.tools.map(tool => tool.name), 'the tool table carries the plan-round tool')
      .toContain('submit_plan_round');
  });

  it('A-10 reply target: the continuation final text answers the original executor M once', async () => {
    const world = await openPLConsumptionWorld({ contextWindowTokens: 1_000_000, label: 'a10-reply-target' });
    worlds.push(world);
    await settleHost(world);
    const { goal, adviser, m } = await answeredReferenceRound(world, 'a10-reply-target');

    // The real planresume is sent by the Host system sender; its Query freezes M as `repliesToMessageRef`.
    const root = await readPLPlanResumeRoot(world, m.message.ref);
    const originalQuery = interventionPlanningQueryRefs(m.message.ref);
    expect(root.messageId, 'the lineage root is the original executor M').toBe(m.message.ref.messageId);
    const finalText = 'PL A10 reply-target final text after the original round';
    await world.scripted.script(adviser, [{ kind: 'text', text: finalText }]);
    const sent = await sendPLPlanResume(world, { line: adviser, goal,
      originalQueryJobId: originalQuery.queryJobRef.queryJobId, originalMessageRef: m.message.ref,
      followupOf: root });
    expect(sent.result.status, 'the real Host send commits the planresume').toBe('committed');

    const query = await heartbeatUntil(world, () => readPlanningQuery(world, sent.messageRef),
      record => record !== null, 40);
    expect(query, 'the planresume opened its continuation Query').not.toBeNull();
    if (query === null) return;
    const execution = query.job.job.intent.execution;
    expect(execution.kind, 'the continuation stays an intervention planning Query').toBe('intervention_planning');
    if (execution.kind !== 'intervention_planning') return;
    expect(execution.sourceMessageRef, 'the Query source is the planresume R').toEqual(sent.messageRef);
    expect(execution.repliesToMessageRef, 'the continuation freezes the original M as its reply target')
      .toEqual(m.message.ref);

    const replied = await waitForResponse(world, m.message.ref, 40);
    expect(replied.response, 'the original executor M gets its one reply').not.toBeNull();
    expect(await readBody(world, m.message.ref, 'response'), 'the reply is the continuation text')
      .toBe(finalText);
    await heartbeat(world);
    expect(await readBody(world, m.message.ref, 'response'), 'the one reply slot is not overwritten')
      .toBe(finalText);
  });

  it('A-10 automatic: the goal driver sends planresume by itself, M gets the final text once and A continues', async () => {
    const world = await openPLConsumptionWorld({ contextWindowTokens: 1_000_000, label: 'a10-auto' });
    worlds.push(world);
    await settleHost(world);
    const { goal, adviser, m, originalQuestion, answers } = await answeredReferenceRound(world, 'a10-auto');

    const finalText = 'PL A10 final text answer after the five questions';
    await world.scripted.script(adviser, [{ kind: 'text', text: finalText }]);
    await startGoalDriver(world, goal, 'a10-goal');
    await waitDriver(world, goal, undefined, snapshot => snapshot.last !== null, 'the A-10 goal pass');

    // The goal loop's own planresume; the row computes the same deterministic identity and waits for it. No automatic
    // send exists on this tree, so this test stops here (P4's send / P5's read / L's wiring).
    const originalQuery = interventionPlanningQueryRefs(m.message.ref);
    const round = plPlanResumeRound({ goal, originalQueryJobId: originalQuery.queryJobRef.queryJobId,
      originalMessageRef: m.message.ref });
    const requestId = systemRoundRequestId(round);
    expect(requestId.status).toBe('ready');
    if (requestId.status !== 'ready') return;
    const resume = await waitFor(async () => await readSystemRound(world, round),
      read => read.status === 'ready', 'the automatic planresume system round');
    if (resume.status !== 'ready') return;
    const resumeMessage = resume.value;

    const body = await readBody(world, resumeMessage.ref, 'message');
    expect(body.split('\n')[0], 'the body starts with the request id').toBe(requestId.value);
    expect(body.split('\n')[1], 'the body carries only the original Query reference')
      .toBe(originalQueryRefLine(m.message.ref));
    expect(body, 'the saved body has the head and the reference only').not.toContain(originalQuestion);
    for (const answer of answers) expect(body, 'no card answer is saved in the body').not.toContain(answer);
    expect(Buffer.byteLength(body, 'utf8'), 'the saved body is small').toBeLessThan(1024);

    const query = await heartbeatUntil(world, () => readPlanningQuery(world, resumeMessage.ref),
      record => record !== null, 40);
    expect(query, 'the planresume opened its planning Query').not.toBeNull();
    if (query === null) return;
    expect(query.job.job.intent.question, 'the Query question is the same small body').toBe(body);
    const execution = query.job.job.intent.execution;
    expect(execution.kind, 'the continuation stays an intervention planning Query').toBe('intervention_planning');
    expect(execution.kind === 'intervention_planning' ? execution.answerShape : undefined,
      'the Query freezes the plan_round answer shape').toBe('plan_round');

    // The prepared model input carries the original question and the five saved Q&A groups.
    const requests = await heartbeatUntil(world, () => world.scripted.requests(adviser),
      items => items.some(request => JSON.stringify(request).includes(requestId.value)), 40);
    const continuation = requests.find(request => JSON.stringify(request).includes(requestId.value));
    expect(continuation, 'the continuation made a model request').toBeDefined();
    if (continuation === undefined) return;
    const modelInput = JSON.stringify(continuation);
    expect(modelInput, 'the original question is assembled into the model input').toContain(originalQuestion);
    for (const [index, question] of QUESTIONS.entries()) {
      expect(modelInput, `the question ${String(index)} is assembled into the model input`).toContain(question);
    }
    for (const [index, answer] of answers.entries()) {
      expect(modelInput, `the saved answer ${String(index)} is assembled into the model input`).toContain(answer);
    }
    expect(continuation.tools.map(tool => tool.name), 'the tool table carries the plan-round tool')
      .toContain('submit_plan_round');

    // The final saved text answers the original executor M exactly once, and M continues on a new Run.
    const replied = await waitForResponse(world, m.message.ref, 40);
    expect(replied.response, 'the original executor M gets its one reply').not.toBeNull();
    expect(await readBody(world, m.message.ref, 'response'), 'the reply is the final text verbatim').toBe(finalText);
    await heartbeat(world);
    expect(await readBody(world, m.message.ref, 'response'), 'the one reply slot is not overwritten').toBe(finalText);

    const runs = await waitFor(async () => await runsOf(world, goal, 'a10-auto-send'),
      items => items.length >= 2, 'the executor continuation Run');
    expect(runs.some(run => run.run.ref.runId !== m.run.runId), 'the executor continues on a new Run').toBe(true);

    // The same request id replays the same message and Query, never a second round.
    const beforeQueries = (await sessionQueries(world, adviser)).length;
    await sendPLSystemRound(world, { line: adviser, round, text: body,
      followupOf: await readPLPlanResumeRoot(world, m.message.ref), allowReplay: true });
    await heartbeat(world);
    expect((await sessionQueries(world, adviser)).length, 'the replay opens no second Query').toBe(beforeQueries);
  }, 120_000);

  it('A-10 history: a no-source initial_coordination question on the same Goal is read, answered and not rejected', async () => {
    const world = await openPLConsumptionWorld({ contextWindowTokens: 1_000_000, label: 'a10-history' });
    worlds.push(world);
    await settleHost(world);
    const goal = world.goals.first;
    const line = await createPLAdviserLine(world, 'a10-history-adviser');
    const answer = needsDecisionAnswer('PL A10 history questions', ['h1: which historical decision is open?']);
    const history = await seedPLHistoryQuestion(world, { goal, line, label: 'a10-history', answer });

    // The real QueryJob and its saved needs_decision answer are readable through the public routes.
    const job = (await world.post('queries/read', { scope: S6A_SCOPE, input: history.queryJobRef })).body as {
      status: string; value?: { job: { job: { status: string; intent: { execution: { kind: string;
        sourceMessageRef?: unknown } } } } };
    };
    expect(job.status, 'the historical planning Query is readable').toBe('ready');
    expect(job.value?.job.job.status, 'the historical planning Query is answered').toBe('answered');
    expect(job.value?.job.job.intent.execution.kind, 'it is an initial_coordination Query').toBe('initial_coordination');
    expect(job.value?.job.job.intent.execution.sourceMessageRef, 'it has no source from this loop').toBeUndefined();

    const saved = (await world.post('queries/answer', { scope: S6A_SCOPE, input: history.answer.ref })).body as {
      status: string; value?: { answer: { answer: string } };
    };
    expect(saved.status, 'the saved answer is readable').toBe('ready');
    expect(saved.value?.answer.answer, 'the saved needs_decision answer is the Query answer').toBe(answer);

    // The Goal-level driver read still answers beside the historical question: the whole read is never unsupported.
    await seedPLSenderPlan(world, { goal, label: 'a10-history-plan', taskIds: ['a10-history-send'] });
    await startGoalDriver(world, goal, 'a10-history-goal');
    const driver = await waitDriver(world, goal, undefined,
      snapshot => snapshot.last?.status === 'ready', 'the A-10 historical Goal pass');
    expect(driver.last?.status, 'the actual Workflow result is ready beside the historical question (P5 reads)')
      .toBe('ready');
  }, 120_000);

  it('A-10 read failure: a failed planresume preparation read passes through and writes no reply', async () => {
    const fault = installPLDecisionReadFault();
    onTestFinished(() => fault.restore());
    const world = await openPLConsumptionWorld({ contextWindowTokens: 1_000_000, label: 'a10-read' });
    worlds.push(world);
    await settleHost(world);
    const goal = world.goals.first;
    const seeded = await seedPLSenderPlan(world, { goal, label: 'a10-read', taskIds: ['a10-read-send'] });
    const adviser = await createPLAdviserLine(world, 'a10-read-adviser');
    const question = 'PL A10 read-failure question: which boundary owns the adviser query?';
    const m = await sendPLActionWait(world, { goal, session: seeded.line, sessionTaskId: 'a10-read-send',
      recipient: adviser.ref, text: question, label: 'a10-read' });
    await world.scripted.script(adviser, [{ kind: 'text', text: needsDecisionAnswer('PL A10 read questions',
      ['r1: which read must fail once?']) }]);
    const cards = await heartbeatUntil(world, () => questionCards(world, goal), items => items.length === 1, 20);
    expect(cards, 'the needs_decision answer opens its question card').toHaveLength(1);
    await answerCard(world, cards[0]!, 'a10-read-card', asciiAnswerText('PL A10 read answer'));

    const root = await readPLPlanResumeRoot(world, m.message.ref);
    const originalQuery = interventionPlanningQueryRefs(m.message.ref);
    const round = plPlanResumeRound({ goal, originalQueryJobId: originalQuery.queryJobRef.queryJobId,
      originalMessageRef: m.message.ref });
    const requestId = systemRoundRequestId(round);
    expect(requestId.status).toBe('ready');
    if (requestId.status !== 'ready') return;
    const resumeRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
    expect(resumeRef.status).toBe('ready');
    if (resumeRef.status !== 'ready') return;
    const refs = interventionPlanningQueryRefs(resumeRef.value);

    await sendPLPlanResume(world, { line: adviser, goal,
      originalQueryJobId: originalQuery.queryJobRef.queryJobId, originalMessageRef: m.message.ref,
      followupOf: root });
    const query = await heartbeatUntil(world, () => readPlanningQuery(world, resumeRef.value),
      record => record !== null, 40);
    expect(query, 'the planresume Query exists before preparation').not.toBeNull();
    if (query === null) return;

    // Claim the round ourselves before the next Host pass so this preparation is the one observed.
    const claimed = await claimQuery(world, query.job.ref, adviser, null, 'a10-read-claim');
    expect(claimed.status, 'the planresume Query is claimed for this preparation').toBe('committed');

    fault.arm();
    const prepared = (await world.post('queries/prepare', { scope: S6A_SCOPE,
      input: { queryRunRef: query.run.ref, requestId: 'a10-read-prepare' } })).body;
    expect(fault.fired, 'the preparation reached the real decision read').toBe(true);
    expect(prepared, 'the failed read passes through unchanged')
      .toMatchObject({ status: 'rejected', code: 'unavailable', reason: 'A10_fault' });

    const message = (await world.post('messages/read', { scope: S6A_SCOPE, input: m.message.ref })).body as {
      status: string; value?: { response: unknown } };
    expect(message.value?.response, 'no reply is written to the original executor').toBeNull();
    const reread = (await world.post('queries/read', { scope: S6A_SCOPE, input: refs.queryJobRef })).body as {
      status: string; value?: { job: { job: { status: string; answerRefs: unknown[] } } } };
    expect(reread.value?.job.job.status, 'the Query is not marked answered').not.toBe('answered');
    expect(reread.value?.job.job.answerRefs, 'no answered fact is written').toEqual([]);
  }, 120_000);

  // §6.1.6: a failed read inside the Goal's candidate read is that read's own answer. It is never
  // "no card answered" or "already resumed": no planresume goes out, and the next pass reads again.
  it.each([
    { read: 'the card answer', fails: 'decision' },
    { read: 'the question enumeration', fails: 'questions' },
    { read: 'the planresume Query', fails: 'query' },
    { read: 'the original message', fails: 'message' },
  ] as const)('A-10 candidate read: $read fails and passes through workflow/advance', async ({ fails }) => {
    const decisionFault = installPLDecisionReadFault();
    onTestFinished(() => decisionFault.restore());
    const world = await openPLConsumptionWorld({ contextWindowTokens: 1_000_000, label: 'a10-candidates' });
    worlds.push(world);
    await settleHost(world);
    const { goal, m } = await answeredReferenceRound(world, 'a10-candidates');
    const round = plPlanResumeRound({ goal, originalQueryJobId: interventionPlanningQueryRefs(m.message.ref)
      .queryJobRef.queryJobId, originalMessageRef: m.message.ref });
    const requestId = systemRoundRequestId(round);
    if (requestId.status !== 'ready') throw new Error('A-10: the planresume has no request id');
    const resumeRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
    if (resumeRef.status !== 'ready') throw new Error('A-10: the planresume has no message ref');

    if (fails === 'decision') decisionFault.arm();
    const key = fails === 'questions' ? canonicalRefKey(interventionPlanningQueryRefs(m.message.ref).queryJobRef)
      : fails === 'query' ? canonicalRefKey(interventionPlanningQueryRefs(resumeRef.value).queryJobRef)
        : canonicalRefKey(m.message.ref);
    const storeFault = fails === 'decision' ? null : commitBarrier.failReads(key, 'throw-always');
    const select = { schemaVersion: 1 as const, goalRef: goal, flowId: `a10-candidates-${fails}`,
      sessionHint: null, kind: 'select_work' as const };
    const refused = (await world.post('workflow/advance', plain(S6A_SCOPE, select))).body;
    if (storeFault === null) expect(decisionFault.fired, 'the read reached the armed decision answer').toBe(true);
    else expect(storeFault.calls(), 'the read reached the armed store key').toBeGreaterThan(0);
    expect(refused, 'the failed read is the pass result').toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect((await readSystemRound(world, round)).status, 'the failure sends no planresume').toBe('not_found');

    storeFault?.release();
    const send = await advanceUntil(world.ag2b, select, 'send_system_round');
    expect(send).toMatchObject({ kind: 'perform', operation: { request: { round: { kind: 'planresume' } } } });
  }, 120_000);
});
