/**
 * PL-41's three restart variants on real Host crashes (spec §15 PL-41, §5.5.2, §6.1.6). `tests/app/PL-41-goal-wait-rebuild.test.ts`
 * has the registration half and the person's accepted-candidate replies; this file has the rest:
 * - (a) a crash with the review's model request held;
 * - (b) a settled planning Query whose close-out is missing, for each ending; the settlement comes from the mailbox walk,
 *   with no second Query and no model call;
 * - (c) an accepted candidate whose M is a real executor's yielded `action_request`.
 *
 * The last row is the rule beside (a): a crash in a plain `initial_coordination` Query leaves its line retired (KA-16).
 *
 * Named mutation: make `settlementOfferOf` ask for a Session still occupied by the settled Query; (b) then never closes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld, S6AReply } from '../helpers/S6A-host-fixture.js';
import { listed, readS7BMessage } from '../helpers/S7B-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { refinementPlan } from '../helpers/S7B-V-fixture.js';
import { readActivePlan } from '../scenarios/support/S5-decisions.js';
import {
  awaitProposal, candidateCards, consumeView, heartbeat, heartbeatUntil, heartbeatUntilModel, proposalRefOf, questionCards,
  readBody, readProposal, sessionQueries,
} from '../helpers/IV-host-fixture.js';
import {
  createPLAdviserLine, needsDecisionAnswer, openPLConsumptionWorld, seedPLHistoryQuestion, seedPLSenderPlan,
  sendPLActionWait,
} from '../helpers/PL-consumption-fixture.js';
import { runPLAutomaticChain, type PLWorkflowWorld } from '../helpers/PL-workflow-fixture.js';
import { startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/** Two empty consume passes settle the SQLite Host before the row's own message exists. */
async function settleHost(world: S6AHostWorld): Promise<void> {
  await heartbeat(world, 60_000);
  await heartbeat(world, 60_000);
}

const planRevisionOf = async (world: S6AHostWorld, goal: GoalRef): Promise<number> =>
  (await readActivePlan(world.platform, world.humanContext(), goal)).planRevision;

/** A plan answer that refines the Goal's active Plan with one new Task. */
const planAnswer = async (world: S6AHostWorld, label: string): Promise<S6AReply> => ({ kind: 'text',
  text: await refinementPlan(world, world.goals.first, { label, taskId: `${label}-task`, role: S6A_WORK_ROLE.templateId }) });

/** The one reply is the original Query's: its last saved answer is the sender's answer, and `body` is what it says. */
async function expectReplyFromOriginalQuery(world: S6AHostWorld, messageRef: SessionMessageRef, body: string): Promise<void> {
  const { queryJobRef } = interventionPlanningQueryRefs(messageRef);
  const job = ready<QueryJobRecord>((await world.post('queries/read', plain(S6A_SCOPE, queryJobRef))).body, 'the Query');
  const message = await readS7BMessage(world, messageRef);
  expect(message.response?.sender).toMatchObject({ kind: 'query_run', answerRef: job.job.job.answerRefs.at(-1) });
  expect(await readBody(world, messageRef, 'response')).toBe(body);
}

async function interruptedGoals(world: S6AHostWorld): Promise<string[]> {
  const report = ready<{ report: { interruptedGoals: { goalRef: GoalRef }[] } }>(await world.post(
    'host/reconcile-report', plain(S6A_SCOPE, {})), 'the reconcile report');
  return report.report.interruptedGoals.map(entry => entry.goalRef.goalId);
}

/** The identity prefixes of the close-out's first commit, by ending. */
const NOTICE = 'session-message-send:';
const REPLY = 'session-message-respond_from_query_answer:';
const PROPOSE = 'plan-propose:';

describe('PL-41 (b): a settled Query\'s missing close-out is finished from the mailbox', () => {
  /**
   * A Goal with required work, its adviser line, one person message, and the Query ended with no close-out yet: the
   * first close-out commit, the one `closeOut` names, is held, and the crash leaves it unwritten.
   */
  async function settledRound(label: string, closeOut: string,
    reply: (world: S6AHostWorld) => S6AReply | Promise<S6AReply>) {
    const world = await openPLConsumptionWorld({ backend: 'sqlite', label });
    worlds.push(world);
    await settleHost(world);
    const goal = world.goals.first;
    const seeded = await seedPLSenderPlan(world, { goal, label, taskIds: [`${label}-work`] });
    await world.scripted.script(seeded.line, [{ kind: 'text', text: `${label} work` }]);
    const line: S6ASession = await createPLAdviserLine(world, `${label}-adviser`);
    await world.scripted.script(line, [await reply(world)]);
    const { ref: messageRef } = await sendS7A2PersonMessage(world, { label, recipient: line.ref, goal });
    await heartbeatUntilModel(world, commitBarrier.hold(byIdentityPrefix(closeOut)));
    return { world, line, messageRef };
  }

  /**
   * Crash, nothing happens before the person's start, and the start closes the source with no new Query or model call.
   * `closingNotices` is the ending's own Host notice to the line, the only message the settlement may add there.
   */
  async function settleAfterCrash({ world, line, messageRef }: Awaited<ReturnType<typeof settledRound>>, label: string,
    closingNotices = 1) {
    expect((await readS7BMessage(world, messageRef)).response, 'the close-out is still missing').toBeNull();
    const queries = (await sessionQueries(world, line)).length;
    const requests = (await world.scripted.requests(line)).length;
    const inbox = (await listed(world, 'inbox', line)).map(message => message.ref.messageId);
    const revision = await planRevisionOf(world, world.goals.first);
    await world.crash();
    expect(await interruptedGoals(world)).toContain(world.goals.first.goalId);
    await heartbeat(world);
    const before = await readS7BMessage(world, messageRef);
    expect(before.response ?? before.withdrawnAt, 'nothing closes before the person starts').toBeNull();

    await startGoalDriver(world, world.goals.first, `${label}-driver`);
    const closed = await heartbeatUntil(world, () => readS7BMessage(world, messageRef),
      message => message.response !== null || message.withdrawnAt !== null, 24);
    expect(await sessionQueries(world, line), 'no second Query').toHaveLength(queries);
    expect((await world.scripted.requests(line)).length, 'no second model call').toBe(requests);
    // The source was not delivered again, the line has nothing to take, and a further pass changes nothing.
    await heartbeat(world);
    const added = (await listed(world, 'inbox', line)).filter(message => !inbox.includes(message.ref.messageId));
    expect(added.map(message => [message.sender.kind, message.intent]))
      .toEqual(Array.from({ length: closingNotices }, () => ['host', 'notify']));
    expect((await consumeView(world, line))?.nextMessage).toBeNull();
    expect(await readS7BMessage(world, messageRef), 'the one ending stands').toEqual(closed);
    expect(await sessionQueries(world, line), 'still no second Query').toHaveLength(queries);
    expect(await planRevisionOf(world, world.goals.first), 'the settlement adopts nothing').toBe(revision);
    return closed;
  }

  it('a text answer: the reply is the formal Query\'s', async () => {
    const round = await settledRound('pl41-text', NOTICE, () => ({ kind: 'text', text: 'PL-41 a plain answer' }));
    const closed = await settleAfterCrash(round, 'pl41-text');
    expect(closed.response?.sender.kind).toBe('query_run');
    await expectReplyFromOriginalQuery(round.world, round.messageRef, 'PL-41 a plain answer');
  }, 120_000);

  it('a questions answer: the person\'s message closes and the one card stays', async () => {
    const round = await settledRound('pl41-questions', REPLY, () => ({ kind: 'text',
      text: needsDecisionAnswer('PL-41 asks', ['PL-41 which option?']) }));
    const closed = await settleAfterCrash(round, 'pl41-questions', 0);
    expect(closed.response?.sender.kind).toBe('query_run');
    await expectReplyFromOriginalQuery(round.world, round.messageRef, 'PL-41 asks');
    expect(await questionCards(round.world, round.world.goals.first)).toHaveLength(1);
  }, 120_000);

  it('no answer: the fixed ending withdraws the source', async () => {
    const round = await settledRound('pl41-none', NOTICE, () => ({ kind: 'fail', message: 'PL-41 the provider fails' }));
    const closed = await settleAfterCrash(round, 'pl41-none');
    expect(closed.response).toBeNull();
    expect(closed.withdrawnAt).not.toBeNull();
  }, 120_000);

  it('a plan answer with no candidate yet: the same Query writes it, no model call', async () => {
    const round = await settledRound('pl41-plan', PROPOSE, world => planAnswer(world, 'pl41-plan'));
    const closed = await settleAfterCrash(round, 'pl41-plan');
    expect(closed.response?.sender.kind).toBe('query_run');
    await expectReplyFromOriginalQuery(round.world, round.messageRef, 'S7B3 V pl41-plan');
    const proposal = await readProposal(round.world, proposalRefOf(round.messageRef, round.world.goals.first));
    expect(proposal.status).toBe('candidate');
  }, 120_000);

  it('a candidate written but its source not closed: the close-out finishes without a second candidate', async () => {
    const round = await settledRound('pl41-written', NOTICE, world => planAnswer(world, 'pl41-written'));
    const proposalRef = proposalRefOf(round.messageRef, round.world.goals.first);
    expect((await readProposal(round.world, proposalRef)).status, 'held after the candidate').toBe('candidate');
    const closed = await settleAfterCrash(round, 'pl41-written');
    expect(closed.response?.sender.kind).toBe('query_run');
    await expectReplyFromOriginalQuery(round.world, round.messageRef, 'S7B3 V pl41-written');
    expect((await readProposal(round.world, proposalRef)).status).toBe('candidate');
  }, 120_000);

  it('a review answered, its reply missing: the reply is the review Query\'s and the pass adopts once', async () => {
    const chain = await runPLAutomaticChain('pl41-review', { backend: 'sqlite' });
    worlds.push(chain.workflow);
    const { world, goal } = chain.workflow;
    await world.settings('automation/save', { autoReworkLimit: 3, resumeOnStartup: 'ask' });
    const revision = await planRevisionOf(world, goal);
    const reply = commitBarrier.hold(byIdentityPrefix(REPLY));
    chain.releaseReview();
    await reply.reached;
    expect((await readS7BMessage(world, chain.reviewRef)).response, 'the close-out is still missing').toBeNull();
    const queries = (await sessionQueries(world, chain.reviewer)).length;
    const requests = (await world.scripted.requests(chain.reviewer)).length;

    await world.crash();
    expect(await interruptedGoals(world)).toContain(goal.goalId);
    await heartbeat(world);
    expect((await readS7BMessage(world, chain.reviewRef)).response, 'nothing closes before the person starts').toBeNull();
    expect(await planRevisionOf(world, goal), 'nothing is adopted before the person starts').toBe(revision);

    await world.scripted.script(chain.line, [{ kind: 'text', text: 'PL-41 stage two done' }]);
    await startGoalDriver(world, goal, 'pl41-review-driver');
    const closed = await heartbeatUntil(world, () => readS7BMessage(world, chain.reviewRef),
      message => message.response !== null || message.withdrawnAt !== null, 40);
    expect(closed.response?.sender.kind).toBe('query_run');
    await expectReplyFromOriginalQuery(world, chain.reviewRef, '审阅通过');
    await heartbeatUntil(world, () => readProposal(world, chain.candidate.ref), proposal => proposal.status === 'accepted', 40);
    expect((await readProposal(world, chain.candidate.ref)).status, 'the saved pass adopts the candidate').toBe('accepted');
    await heartbeat(world);
    expect(await planRevisionOf(world, goal), 'exactly one revision').toBe(revision + 1);
    expect(await sessionQueries(world, chain.reviewer), 'no second review Query').toHaveLength(queries);
    expect((await world.scripted.requests(chain.reviewer)).length, 'no second model call').toBe(requests);
    expect(await readS7BMessage(world, chain.reviewRef), 'the one reply stands').toEqual(closed);
  }, 120_000);
});

describe('PL-41 (a): a crash inside the review round', () => {
  it('nothing opens before the person starts, and the candidate is adopted at most once after', async () => {
    const chain = await runPLAutomaticChain('pl41a', { backend: 'sqlite' });
    const workflow: PLWorkflowWorld = chain.workflow;
    worlds.push(workflow);
    const { world, goal } = workflow;
    await world.settings('automation/save', { autoReworkLimit: 3, resumeOnStartup: 'ask' });
    const queries = (await sessionQueries(world, chain.reviewer)).length;
    await world.crash();
    expect(await interruptedGoals(world)).toContain(goal.goalId);
    await heartbeat(world);
    await heartbeat(world);
    expect(await sessionQueries(world, chain.reviewer), 'no new review Query before the start').toHaveLength(queries);
    expect((await readProposal(world, chain.candidate.ref)).status).toBe('candidate');
    expect((await workflow.main.activePlan(goal))?.ref).toEqual(chain.skeleton.plan.ref);

    await startGoalDriver(world, goal, 'pl41a-driver');
    await heartbeat(world);
    await heartbeat(world);
    expect(await sessionQueries(world, chain.reviewer), 'no second review round').toHaveLength(queries);
    // The crash lost the review, so the round ends with no conclusion and the candidate waits for the person.
    const closed = await heartbeatUntil(world, () => readS7BMessage(world, chain.reviewRef),
      message => message.withdrawnAt !== null, 80);
    expect(closed.withdrawnAt, 'the review round has its no-answer ending').not.toBeNull();
    const parked = await waitDriver(world, goal, undefined, snapshot => snapshot.last?.status === 'ready'
      && snapshot.last.value.source?.kind === 'candidate', 'PL-41: the candidate card reaches the driver');
    expect(parked.last).toMatchObject({ status: 'ready', value: { state: 'waiting' } });
    expect((await readProposal(world, chain.candidate.ref)).status, 'never adopted without a review').toBe('candidate');
    expect((await workflow.main.activePlan(goal))?.ref, 'the active Plan stays').toEqual(chain.skeleton.plan.ref);

    // The line survived its lost round: the restart closed the open Turn, so a later round runs on it.
    expect(await consumeView(world, chain.reviewer)).toMatchObject({ availability: 'idle', busy: null });
    await world.scripted.script(chain.reviewer, [{ kind: 'text', text: 'PL-41 the reviewer is back' }]);
    const { ref: laterRef } = await sendS7A2PersonMessage(world, { label: 'pl41a-later', recipient: chain.reviewer.ref, goal });
    const later = await heartbeatUntil(world, () => readS7BMessage(world, laterRef),
      message => message.response !== null, 40);
    expect(later.response, 'the later round answers on the same line').not.toBeNull();
  }, 120_000);
});

describe('PL-41 (c): an accepted candidate whose M is a real executor\'s wait', () => {
  it('the restart replies M once and adopts nothing again', async () => {
    const world = await openPLConsumptionWorld({ backend: 'sqlite', label: 'pl41c' });
    worlds.push(world);
    await settleHost(world);
    const goal = world.goals.first;
    const seeded = await seedPLSenderPlan(world, { goal, label: 'pl41c', taskIds: ['pl41c-send'] });
    const adviser = await createPLAdviserLine(world, 'pl41c-adviser');
    await world.scripted.script(adviser, [await planAnswer(world, 'pl41c')]);
    const m = await sendPLActionWait(world, { goal, session: seeded.line, sessionTaskId: 'pl41c-send',
      recipient: adviser.ref, text: 'PL-41 the executor asks for a plan', label: 'pl41c' });
    const proposalRef = proposalRefOf(m.message.ref, goal);
    const proposal = await awaitProposal(world, proposalRef);
    if (proposal.status !== 'ready') throw new Error(`PL-41: the candidate is ${proposal.status}`);
    committed((await world.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef, expectedProposalRevision: proposal.value.revision, decisionRefs: [],
    }, 'pl41c-apply'))).body, 'the PL-41 adoption');
    const revision = await planRevisionOf(world, goal);
    expect((await readS7BMessage(world, m.message.ref)).response, 'M is open at the crash').toBeNull();
    const adopted = await readProposal(world, proposalRef);

    await world.crash();
    expect((await readS7BMessage(world, m.message.ref)).response, 'no reply before the start').toBeNull();
    await startGoalDriver(world, goal, 'pl41c-driver');
    const replied = await heartbeatUntil(world, () => readS7BMessage(world, m.message.ref),
      message => message.response !== null, 24);
    expect(replied.response?.sender.kind, 'the one reply is the formal Query\'s').toBe('query_run');
    await expectReplyFromOriginalQuery(world, m.message.ref, 'S7B3 V pl41c');
    await heartbeat(world);
    expect(await planRevisionOf(world, goal), 'the restart adopts nothing').toBe(revision);
    // It only replies: M has this one reply, the candidate is untouched, and no candidate is added.
    expect(await readS7BMessage(world, m.message.ref)).toEqual(replied);
    expect(await readProposal(world, proposalRef)).toEqual(adopted);
    // Forward work goes on (the new Task's member request is its own message and Query); M gets no second one.
    const inbox = await listed(world, 'inbox', adviser);
    expect(inbox.filter(message => message.sender.kind !== 'host').map(message => message.ref)).toEqual([m.message.ref]);
    expect((await sessionQueries(world, adviser)).map(run => run.ref.queryJobId).sort())
      .toEqual(inbox.map(message => interventionPlanningQueryRefs(message.ref).queryJobRef.queryJobId).sort());
    expect((await candidateCards(world, goal)).filter(card => card.state === 'waiting_answer')).toEqual([]);
  }, 120_000);
});

describe('KA-16: a plain planning Query is no planning round', () => {
  it('a crash during a plain initial_coordination Query leaves its line retired with the open Turn', async () => {
    const world = await openPLConsumptionWorld({ backend: 'sqlite', label: 'pl41d' });
    worlds.push(world);
    const line = await createPLAdviserLine(world, 'pl41d-adviser');
    const held = await world.gates.modelRequest(line);
    const run = seedPLHistoryQuestion(world, { goal: world.goals.first, line, label: 'pl41d', answer: 'never answered' })
      .catch(() => undefined);
    await Promise.race([held.reached, run]);
    await world.crash();
    expect(world.host.reconcile.report?.queries).toEqual([expect.objectContaining({ row: 'Q-04', status: 'reconciled' })]);
    expect((await world.readSession(line)).record, 'KA-16: the Query line is not closed').toMatchObject({
      lifecycle: 'active', occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
  }, 120_000);
});
