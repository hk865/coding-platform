/**
 * IV acceptance rows: a person intervenes on an idle line while the REAL Host consume loop (not a direct
 * `handleIntervention` call) selects the message. Every row drives the Host's own `consumeIdle` pass through
 * `heartbeat` (`tests/helpers/IV-host-fixture.ts`), and every state is reached through public routes and reads.
 *
 * Expected after the fix (`src/core/work-graph/views/consumable-sessions.ts`): a line occupied by its own
 * `intervention_planning` Query at `claimed`/`prepared` still reads `busy: 'query'`, but its `sourceMessageRef` is
 * offered as `nextMessage` through `offerOf` only when that message is addressed to this line (a paused Goal offers
 * nothing). `offersOf` is not used for that offer, so a newer message cannot displace the claimed planning. Once the
 * Query is terminal the ordinary `offersOf` order selects the message and the handler continues from its first
 * missing stage (book-7b §3.10 item 7).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { AG2B_PROJECT_REF, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, AG2B_WORKSPACE_REF,
  graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan } from '../helpers/S6B1-fixture.js';
import { committed, pauseS7AGoal, ready, resumeS7AGoal, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { approveS7A2Message, driveS7A2Release, sendS7A2PersonMessage, sendS7A2Request } from '../helpers/S7A2-fixture.js';
import { firstPlan, refinementPlan } from '../helpers/S7B-V-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import { claimQuery } from '../helpers/request-claim-steps.js';
import {
  abandonCandidate, answerCard, awaitCandidate, awaitClaimedPlanning, awaitPlanningAnswer, awaitProposal,
  candidateCards, consumeView, createLine, heartbeat, heartbeatUntil,
  heartbeatUntilModel, lineFacts, notices, openConsumeWorld, openIdleLine, openLine, proposalRefOf, proposeReplacement,
  questionCards, readBody, readPlanningQuery, readProposal,
  readQueryAnswer, sessionExecutions,
  sessionQueries, settleHost, systemWithdraw, waitForResponse, waitForWithdrawn,
} from '../helpers/IV-host-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';

// The SQLite commit barrier is the S6A fixture's (tests/RULES.md A3): the IV-END-3 row holds one prepared Query
// commit across a real crash and one notice send across the system-withdraw guard arm. Memory rows never reach it.
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

// The lead's fixed closing sentences, verbatim: one notice per reason, `questions` sends none.
const INVALID_PLAN_NOTICE = '这次规划没有形成可采用的计划，模型的原回答在回复里。可以补充要求后重新发送。';
const DECLINED_NOTICE = '这次规划的方案没有采用，原回答在回复里。可以补充要求后重新发送。';
const NO_ANSWER_NOTICE = '这次规划已结束，没有留下可用的回答，这条消息已撤回。请补充要求后重新发送。';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  // Release every held commit first: a held commit keeps a tracked call open, and one of them belongs to a Host
  // that the crash row abandoned.
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('IV: intervention on an idle line through the real Host consume loop', () => {
  it('IV-1 主路径与采用后开工: the first plan is answered, proposed, carded, adopted and started', async () => {
    const world = await openConsumeWorld({ label: 'iv1' });
    worlds.push(world);
    await settleHost(world);
    const { line, messageRef } = await openIdleLine(world,
      firstPlan({ label: 'iv1', taskId: 'iv1-task', role: S6A_WORK_ROLE.templateId }), 'iv1-line');

    const query = await awaitPlanningAnswer(world, messageRef);
    const proposalRef = proposalRefOf(messageRef, world.goals.second);
    const proposalRead = await awaitProposal(world, proposalRef);
    const view = await consumeView(world, line);

    expect(query?.job.job.status, 'the planning Query is answered').toBe('answered');
    expect(query?.run.run.status, 'the planning QueryRun is terminal').toBe('answered');
    expect(await world.scripted.requests(line), 'the planning Query made exactly one model request').toHaveLength(1);
    expect(view?.busy, 'the line is not parked on its own planning Query').toBeNull();
    expect(proposalRead.status, 'the person can read the plan proposal').toBe('ready');
    if (proposalRead.status !== 'ready') return;
    expect(proposalRead.value).toMatchObject({ status: 'candidate', sourceMessageRef: messageRef });

    const cards = await candidateCards(world, world.goals.second);
    const card = cards.find(candidate => candidate.source.subject.kind === 'goal'
      && candidate.source.subject.goalRef.goalId === world.goals.second.goalId
      && candidate.candidateStatus === 'candidate');
    expect(card, 'the person\'s decision queue contains this adoption card').toBeDefined();
    expect(card?.actions, 'the card offers the person\'s adoption').toContain('adopt');
    expect(card?.objects, 'the card pins the intervention proposal').toContainEqual(expect.objectContaining({
      kind: 'aggregate', label: 'candidate',
      pin: expect.objectContaining({ ref: expect.objectContaining({
        aggregateType: 'PlanProposal', proposalId: proposalRef.proposalId }) }),
    }));

    // IV-2 continues in IV-1's world: the same proposal is adopted, the line claims the first ready task and starts
    // a Run. The held model request is the started Run's, awaited after the gate is released.
    const gate = await world.gates.modelRequest(line);
    let pending: Promise<void> | null = null;
    try {
      committed((await world.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef, expectedProposalRevision: proposalRead.value.revision, decisionRefs: [],
      }, 'iv1-adopt'))).body, 'the proposal adoption');
      pending = (await heartbeatUntilModel(world, gate)).settled;

      const claims = await sessionExecutions(world, line);
      expect(claims, 'the line claims the first ready task').toHaveLength(1);
      expect(claims[0]?.task.taskId, 'the claim is the proposal\'s first ready task').toBe('iv1-task');
      const run = await readExecution(world.ag2b, claims[0]!.runRef);
      expect(run.run.startedAt, 'a Run starts').not.toBeNull();
      expect(await sessionQueries(world, line), 'there is exactly one planning Query').toHaveLength(1);
      expect(await candidateCards(world, world.goals.second), 'there is exactly one proposal').toHaveLength(1);
      const started = await consumeView(world, line);
      expect(started?.busy, 'the line is busy on the started Run').toBe('run');
      expect(started?.nextMessage, 'the intervention message is no longer selected').toBeNull();
    } finally {
      gate.release();
      if (pending !== null) await pending.catch(() => undefined);
    }
  }, 120_000);

  it('IV-4 插队: a newer message does not displace the claimed planning', async () => {
    const world = await openConsumeWorld({ label: 'iv4' });
    worlds.push(world);
    await settleHost(world);
    const { line } = await openLine(world, 'iv4-line');
    // `sendS7A2Request` sends a released `action_request` only on a Goal with an active Plan; the line itself has
    // no Task link, so the handler's no-task branch still runs. Every-step keeps the refinement a person card so
    // the line stays free after the answer.
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await adoptS6BPlan(ws, world.goals.second, { label: 'iv4-base', taskIds: ['iv4-base-task'],
      role: S6A_WORK_ROLE.templateId });
    await setS7AAutonomy(world, world.goals.second, 'every_step');
    const source = await sendS7A2Request(world, { label: 'iv4-source', goal: world.goals.second,
      recipient: line.ref, intent: 'action_request' });
    const approved = await approveS7A2Message(world, source, 'iv4-source');
    const released = await driveS7A2Release(world, { goal: world.goals.second, messageRef: approved.ref,
      label: 'iv4-source' });
    await world.scripted.script(line, [
      { kind: 'text', text: await refinementPlan(world, world.goals.second,
        { label: 'iv4-source', taskId: 'iv4-source-task', role: S6A_WORK_ROLE.templateId }) },
      { kind: 'text', text: await refinementPlan(world, world.goals.second,
        { label: 'iv4-newer', taskId: 'iv4-newer-task', role: S6A_WORK_ROLE.templateId }) },
    ]);

    const claimed = await awaitClaimedPlanning(world, released.message.ref);
    expect(claimed?.run.run.executionState?.phase, 'the source planning Query is claimed').toBe('claimed');
    const newer = await sendS7A2PersonMessage(world, { label: 'iv4-newer', recipient: line.ref,
      goal: world.goals.second });
    const held = await consumeView(world, line);
    expect(held?.nextMessage?.messageRef, 'the claimed planning keeps its source ahead of the newer message')
      .toEqual(released.message.ref);

    const answered = await awaitPlanningAnswer(world, released.message.ref);
    expect(answered?.job.job.status, 'the current planning finishes first').toBe('answered');
    const after = await consumeView(world, line);
    expect(after?.nextMessage?.messageRef, 'the newer message stays queued').toEqual(newer.ref);
    expect(await readPlanningQuery(world, newer.ref), 'the newer message is not planned before the source finishes')
      .toBeNull();

    const newerQuery = await awaitPlanningAnswer(world, newer.ref);
    expect(newerQuery?.job.job.status, 'the queued newer message is processed, not a permanent busy rejection')
      .toBe('answered');
  }, 120_000);

  it('IV-5 暂停: a paused Goal offers nothing and resumes to the answer', async () => {
    const world = await openConsumeWorld({ label: 'iv5' });
    worlds.push(world);
    await settleHost(world);
    const { line } = await openLine(world, 'iv5-line');
    // A pause pins the Goal's `tasks/query`, which needs an adopted Plan. The line has no Task link, so the
    // handler still takes its no-task planning branch; every-step keeps the refinement a card.
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await adoptS6BPlan(ws, world.goals.second, { label: 'iv5-base', taskIds: ['iv5-base-task'],
      role: S6A_WORK_ROLE.templateId });
    await setS7AAutonomy(world, world.goals.second, 'every_step');
    const message = await sendS7A2PersonMessage(world, { label: 'iv5', recipient: line.ref,
      goal: world.goals.second });
    const messageRef = message.ref;
    await world.scripted.script(line, [{ kind: 'text', text: await refinementPlan(world, world.goals.second,
      { label: 'iv5', taskId: 'iv5-task', role: S6A_WORK_ROLE.templateId }) }]);

    const claimed = await awaitClaimedPlanning(world, messageRef);
    expect(claimed?.run.run.executionState?.phase, 'the planning Query is claimed before the pause').toBe('claimed');
    await pauseS7AGoal(world, world.goals.second);
    const before = (await world.scripted.requests(line)).length;
    for (let pass = 0; pass < 3; pass += 1) await heartbeat(world);

    const paused = await consumeView(world, line);
    expect(paused?.nextMessage, 'no message is offered while the Goal is paused').toBeNull();
    expect(await world.scripted.requests(line), 'no model request is made while the Goal is paused')
      .toHaveLength(before);

    await resumeS7AGoal(world, world.goals.second);
    const answered = await awaitPlanningAnswer(world, messageRef);
    expect(answered?.job.job.status, 'after the resume the planning Query is answered').toBe('answered');
  }, 120_000);

  it('IV-6 收件人: a claimed planning on another line does not offer that line the source message', async () => {
    const world = await openConsumeWorld({ label: 'iv6' });
    worlds.push(world);
    await settleHost(world);
    const { line: recipient } = await openLine(world, 'iv6-recipient');
    const message = await sendS7A2PersonMessage(world, { label: 'iv6', recipient: recipient.ref,
      goal: world.goals.second });
    const other = await createLine(world, 'iv6-other');
    const goal = ready<{ goal: { revision: number } }>(
      (await world.post('goals/read', plain(S6A_SCOPE, world.goals.second))).body, 'the intervention Goal');
    const refs = interventionPlanningQueryRefs(message.ref);
    committed((await world.post('queries/submit', graphWrite(S6A_SCOPE, {
      queryJobId: refs.queryJobRef.queryJobId, runId: refs.queryRunRef.runId,
      intent: { schemaVersion: 1, intentId: refs.queryJobRef.queryJobId, projectId: S6A_SCOPE.projectId,
        workspaceId: S6A_SCOPE.workspaceId, goalId: world.goals.second.goalId,
        question: 'IV cross-line planning', focusTaskRefs: [], budget: AG2B_QUERY_BUDGET,
        multiTurn: { maxRounds: 1 }, correlationId: 'iv6-correlation',
        execution: { kind: 'intervention_planning', sourceMessageRef: message.ref,
          roleBinding: S6A_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET } },
    }, 'iv6-submit', [
      { ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 },
      { ref: world.goals.second, revision: goal.goal.revision },
      { ref: refs.queryJobRef, revision: 0 }, { ref: refs.queryRunRef, revision: 0 },
    ]))).body, 'the cross-line planning Query');
    committed(await claimQuery(world, refs.queryJobRef, other, null, 'iv6-claim'), 'the cross-line claim');

    const view = await consumeView(world, other);
    expect(view?.busy, 'the other line is parked on the claimed planning').toBe('query');
    expect(view?.nextMessage, 'the other line does not offer the recipient line\'s message').toBeNull();
  }, 120_000);
});

/** One legal v2 needs_decision answer with a non-empty question list. */
const questionsAnswer = (summary: string, questions: readonly string[]): string =>
  JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary, questions: [...questions] });

/** The plan body of `firstPlan`, as the draft `plans/propose` takes (a replacement arm). */
function replacementDraft(world: S6AHostWorld, label: string): Record<string, unknown> {
  const text = firstPlan({ label, taskId: `iv-${label}-task`, role: S6A_WORK_ROLE.templateId });
  const plan = (JSON.parse(text) as { plan: Record<string, unknown> }).plan;
  return { ...plan, goalId: world.goals.second.goalId, planId: `iv-${label}`, planRevision: 1 };
}

describe('IV-END-1 questions: the answer replies verbatim and the question card opens no planning round', () => {
  it('IV-END-1: the formal query_run reply, the Goal card, and a card answer without a new model round', async () => {
    const world = await openConsumeWorld({ label: 'iv-end-1' });
    worlds.push(world);
    await settleHost(world);
    const answer = questionsAnswer('IV questions', ['Which module owns the line?', 'Which check proves it?']);
    const { line, messageRef } = await openIdleLine(world, answer, 'iv-end-1-line');

    const replied = await waitForResponse(world, messageRef);
    const queries = await sessionQueries(world, line);
    expect(queries, 'the planning Query exists').toHaveLength(1);
    expect(replied.response?.sender.kind, 'the reply comes from the formal query_run').toBe('query_run');
    expect(replied.response?.sender, 'the reply names the formal QueryRun')
      .toMatchObject({ queryRunRef: queries[0]!.ref });
    expect(await readBody(world, messageRef, 'response'), 'the reply body is the original answer').toBe(answer);
    expect(await notices(world, line, INVALID_PLAN_NOTICE), 'a questions answer sends no invalid_plan notice').toEqual([]);
    expect(await notices(world, line, NO_ANSWER_NOTICE), 'a questions answer sends no no_answer notice').toEqual([]);

    const cards = await heartbeatUntil(world, () => questionCards(world, world.goals.second),
      items => items.length === 2);
    expect(cards, 'each model question has one card for the Goal').toHaveLength(2);
    expect(cards[0]!.subject, 'the card subject is the intervened Goal')
      .toMatchObject({ kind: 'goal', goalRef: world.goals.second });
    expect(cards[0]!.source.pins.some(pin => (pin.ref as { aggregateType?: string }).aggregateType === 'QueryJobAnswer'),
      'the card pins the formal answer').toBe(true);

    const callsBefore = (await world.scripted.requests(line)).length;
    const queriesBefore = (await sessionQueries(world, line)).length;
    const resolved = await answerCard(world, cards[0]!, 'iv-end-1-answer', 'The coordinator module owns it');
    expect(resolved.answer.status, 'the card answer commits').toBe('committed');
    expect(resolved.state, 'the card is answered').toBe('answered');
    const after = (await s6aCardsWorkspace(world, S6A_SCOPE).readCards(world.goals.second))
      .find(card => card.cardKey === cards[0]!.cardKey);
    expect(after?.answerMessageRef, 'the card records its answer message').not.toBeNull();
    expect(await readBody(world, after!.answerMessageRef!, 'response'),
      'the saved card answer text').toBe('The coordinator module owns it');
    // Answering a card only saves the answer: no new planning round and no new QueryJob.
    await heartbeat(world);
    await heartbeat(world);
    expect((await world.scripted.requests(line)).length, 'no model round follows the card answer').toBe(callsBefore);
    expect((await sessionQueries(world, line)).length, 'no QueryJob follows the card answer').toBe(queriesBefore);

    // A NEW person message is the only way to continue; it takes its own Query.
    await world.scripted.script(line, [{ kind: 'text', text: questionsAnswer('IV questions two', ['One more?']) }]);
    const second = await sendS7A2PersonMessage(world, { label: 'iv-end-1-second', recipient: line.ref,
      goal: world.goals.second });
    await waitForResponse(world, second.ref);
    const all = await sessionQueries(world, line);
    expect(all, 'the second message has its own Query').toHaveLength(2);
    expect(new Set(all.map(query => query.run.queryJobRef.queryJobId)).size, 'the two Queries differ').toBe(2);
  }, 120_000);
});

describe('IV-END-2 invalid answers: the fixed notice and the verbatim answer, with no proposal', () => {
  it.each([
    { label: 'iv-end-2', answer: 'this is not a plan, it is the model writing prose' },
    { label: 'iv-end-2b',
      answer: JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'IV empty', questions: [] }) },
  ])('$label: the rejected answer replies verbatim, one fixed notice, no proposal, and the next message is consumable',
    async ({ label, answer }) => {
      const world = await openConsumeWorld({ label });
      worlds.push(world);
      await settleHost(world);
      const { line, messageRef } = await openIdleLine(world, answer, `${label}-line`);

      const replied = await waitForResponse(world, messageRef);
      expect(replied.response?.sender.kind, 'the reply comes from the formal query_run').toBe('query_run');
      expect(await readBody(world, messageRef, 'response'), 'the reply is the original rejected text').toBe(answer);
      await heartbeatUntil(world, () => notices(world, line, INVALID_PLAN_NOTICE), items => items.length === 1);
      expect(await notices(world, line, INVALID_PLAN_NOTICE), 'exactly one fixed invalid_plan notice').toHaveLength(1);
      expect(await candidateCards(world, world.goals.second), 'the rejected answer writes no proposal').toEqual([]);
      expect(await readQueryAnswer(world, interventionPlanningQueryRefs(messageRef).queryJobRef),
        'the formal Answer itself is the rejected text, unchanged').toBe(answer);
      if (label === 'iv-end-2b') {
        expect(await questionCards(world, world.goals.second), 'no question cards come from the rejected answer')
          .toEqual([]);
      }

      const callsBefore = label === 'iv-end-2' ? (await world.scripted.requests(line)).length : 0;
      await world.scripted.script(line, [{ kind: 'text', text: questionsAnswer(`IV after ${label}`, ['The next?']) }]);
      const second = await sendS7A2PersonMessage(world, { label: `${label}-second`, recipient: line.ref,
        goal: world.goals.second });
      await waitForResponse(world, second.ref);
      const all = await sessionQueries(world, line);
      expect(all, 'the new message is not blocked by the old one').toHaveLength(2);
      expect(new Set(all.map(query => query.run.queryJobRef.queryJobId)).size).toBe(2);
      if (label === 'iv-end-2') {
        expect((await world.scripted.requests(line)).length, 'the model did not re-run for the old message')
          .toBe(callsBefore + 1);
        expect((await readS7BMessage(world, messageRef)).response?.sender.kind,
          'the old reply is still the formal query_run reply').toBe('query_run');
      }
    }, 120_000);
});

describe('IV-END-3 restart-no-answer (SQLite only): the saved Query pair continues and ends by notice plus withdrawal', () => {
  it('IV-END-3: the same Job/Run survives the crash, ends without an Answer, and the system Host may withdraw only such a source', async () => {
    const world = await openConsumeWorld({ backend: 'sqlite', label: 'iv-end-3' });
    worlds.push(world);
    await settleHost(world);
    const { line } = await openLine(world, 'iv-end-3-line');
    // > 16 KiB: a real gap, no formal Answer. The claim is held before its prepared commit so the crash lands
    // with the QueryRun still `claimed`.
    await world.scripted.script(line, [{ kind: 'text', text: 'x'.repeat(17 * 1024) }]);
    const prepared = world.gates.beforePrepared(line);
    const sent = await sendS7A2PersonMessage(world, { label: 'iv-end-3', recipient: line.ref,
      goal: world.goals.second });
    const pair = await awaitClaimedPlanning(world, sent.ref);
    expect(pair?.run.run.executionState?.phase, 'the planning Query is claimed').toBe('claimed');
    // The consumer runs on the injected clock: keep passing until the prepared commit is held, then crash.
    await heartbeatUntilModel(world, prepared, 12);

    await world.crash();
    // Still the original Job/Run pair: the restart continues the saved claim, never a new Query.
    const afterCrash = await sessionQueries(world, line);
    const same = afterCrash.find(query => query.run.queryJobRef.queryJobId === pair!.run.run.queryJobRef.queryJobId);
    expect(same?.ref, 'the restart keeps the same QueryRun').toEqual(pair!.run.ref);
    expect(same?.run.executionState?.phase, 'the restart continues the saved pair instead of closing it')
      .not.toBe('settled');
    expect(same?.run.status, 'the restart does not close the saved QueryRun').not.toBe('closed');

    // Hold the one fixed notice before its commit: the source is formally ended but still unwithdrawn.
    const noticeHold = commitBarrier.hold(byIdentityPrefix('session-message-send:'));
    const held = await heartbeatUntilModel(world, noticeHold, 24);
    expect(await readQueryAnswer(world, pair!.run.run.queryJobRef), 'the resumed Query has no Answer').toBeNull();
    const ended = await readPlanningQuery(world, sent.ref);
    expect(ended?.run.run.status === 'closed'
      || ended?.run.run.executionState?.phase === 'settled', 'the QueryRun is formally ended').toBe(true);
    expect((await readS7BMessage(world, sent.ref)).withdrawnAt,
      'the source is not withdrawn before the notice commits').toBeNull();
    noticeHold.release();
    await held.settled;

    const withdrawn = await waitForWithdrawn(world, sent.ref);
    expect(withdrawn.response, 'no reply was associated').toBeNull();
    expect(await notices(world, line, NO_ANSWER_NOTICE), 'exactly one fixed no_answer notice').toHaveLength(1);
    expect(await readQueryAnswer(world, pair!.run.run.queryJobRef), 'the public read sees no formal Answer').toBeNull();

    // A new message is consumed although the first is withdrawn.
    await world.scripted.script(line, [{ kind: 'text', text: questionsAnswer('IV after no answer', ['One?']) }]);
    const second = await sendS7A2PersonMessage(world, { label: 'iv-end-3-second', recipient: line.ref,
      goal: world.goals.second });
    await waitForResponse(world, second.ref);
    expect(new Set((await sessionQueries(world, line))
      .map(query => query.run.queryJobRef.queryJobId)).size, 'the next message takes a new Query').toBe(2);
  }, 180_000);
});

describe('IV-END-3 guard: the system Host withdraw exception does not cover other intervention sources', () => {
  it('IV-END-3 guard: the system Host may not withdraw an open intervention source', async () => {
    const world = await openConsumeWorld({ label: 'iv-end-3-guard' });
    worlds.push(world);
    await settleHost(world);
    const { line } = await openLine(world, 'iv-end-3-guard-line');
    const openGate = await world.gates.modelRequest(line);
    await world.scripted.script(line, [{ kind: 'text', text: firstPlan({ label: 'iv-end-3-guard',
      taskId: 'iv-end-3-guard-task', role: S6A_WORK_ROLE.templateId }) }]);
    const open = await sendS7A2PersonMessage(world, { label: 'iv-end-3-guard', recipient: line.ref,
      goal: world.goals.second });
    const opened = await heartbeatUntilModel(world, openGate);
    const refused = await systemWithdraw(world, open.ref, 'iv-end-3-guard-withdraw');
    expect(refused, 'the system Host may not withdraw an open intervention source')
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect((await readS7BMessage(world, open.ref)).withdrawnAt, 'the guarded message stays').toBeNull();
    openGate.release();
    await opened.settled;
  }, 120_000);
});

describe('IV-END-4 not_adopted: the candidate waits, then the ending answers the original reply', () => {
  it.each([
    { ending: 'abandoned', label: 'iv-end-4' },
    { ending: 'replaced', label: 'iv-end-4r' },
  ])('IV-END-4 $ending: the candidate keeps the message, then not_adopted replies the original answer',
    async ({ ending, label }) => {
      const world = await openConsumeWorld({ label });
      worlds.push(world);
      await settleHost(world);
      const answer = firstPlan({ label: `${label}-a`, taskId: `${label}-a-task`, role: S6A_WORK_ROLE.templateId });
      const { line, messageRef } = await openIdleLine(world, answer, `${label}-line`);
      // The handler's real candidate at the deterministic intervention proposal address keeps the message parked.
      const candidate = await awaitCandidate(world, messageRef, world.goals.second);
      const waiting = await readS7BMessage(world, messageRef);
      expect(waiting.response, 'the message is not yet replied while the candidate waits').toBeNull();
      expect(waiting.withdrawnAt).toBeNull();
      expect((await consumeView(world, line))?.nextMessage?.messageRef, 'the offered message is the source')
        .toEqual(messageRef);
      expect(candidate.proposal.status).toBe('candidate');

      if (ending === 'abandoned') {
        const abandoned = await abandonCandidate(world, world.goals.second, candidate.proposal, `${label}-abandon`);
        expect(abandoned, 'the public abandon writes not_adopted/abandoned')
          .toMatchObject({ status: 'not_adopted', notAdopted: { reason: 'abandoned' } });
      } else {
        const replacement = await proposeReplacement(world, {
          goal: world.goals.second, requestId: `${label}-replace`, queryRef: candidate.query.run.queryJobRef,
          proposal: candidate.proposal, sourceMessageRef: messageRef, draft: replacementDraft(world, `${label}-b`),
        });
        const replaced = await readProposal(world, candidate.proposal.ref);
        expect(replaced, 'the first proposal is not_adopted/replaced')
          .toMatchObject({ status: 'not_adopted', notAdopted: { reason: 'replaced' } });
        expect((replaced as { notAdopted?: { replacedBy?: unknown } }).notAdopted?.replacedBy,
          'the first proposal names its replacement').toEqual(replacement.ref);
        expect(replacement.status, 'the replacement is a real candidate').toBe('candidate');
      }

      const replied = await waitForResponse(world, messageRef);
      expect(replied.response?.sender.kind, 'the formal answer becomes the reply').toBe('query_run');
      expect(await readBody(world, messageRef, 'response'),
        'the reply is the ORIGINAL answer; replacedBy is not followed').toBe(answer);
      expect(await notices(world, line, DECLINED_NOTICE), 'exactly one fixed declined notice').toHaveLength(1);

      if (ending === 'abandoned') {
        expect(await sessionExecutions(world, line), 'the abandonment claims no Task').toEqual([]);
        expect((await lineFacts(world, line)).latestWork, 'the line has no Work from the abandonment').toBeNull();
        // The replied source stops being offered; a new message gets its own Query.
        expect((await consumeView(world, line))?.nextMessage, 'the replied source is no longer offered').toBeNull();
        await world.scripted.script(line, [{ kind: 'text', text: questionsAnswer('IV after declined', ['What next?']) }]);
        const second = await sendS7A2PersonMessage(world, { label: `${label}-second`, recipient: line.ref,
          goal: world.goals.second });
        await waitForResponse(world, second.ref);
        const ids = (await sessionQueries(world, line)).map(query => query.run.queryJobRef.queryJobId);
        expect(ids, 'the new message has a different Query').toHaveLength(2);
        expect(ids[1]).not.toBe(ids[0]);
      }
    }, 120_000);
});
