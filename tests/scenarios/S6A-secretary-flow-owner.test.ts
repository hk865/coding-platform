/**
 * The request flow's owner rules, run by the Host's own request-round driver
 * (the world is opened with `requestDriver: 'on'`; no Query route is called):
 *
 * - R-03b: a follow-up submitted while the owner's round is at its model
 *   request queues on that owner without a `routing` round, and after the
 *   answer it runs as its own execution round. That round's current-round
 *   section holds only its own input (no batch, no earlier entry of the
 *   round that already ran on this Session); the Kernel history of the same
 *   Session still carries the earlier round's input and answer.
 * - R-05, owner half: round 1 runs on A, a pending follow-up is routed to B
 *   before round 1 ends; round 1 ends on A, round 2 runs on B and its input
 *   shows round 1 as an earlier round of the request. A drop while round 1
 *   runs lets round 1 finish and keeps its answer, ends the pending follow-up
 *   `cancelled`/`dropped`, and makes no model request for it.
 * - R-06b: the status projection through real rounds: not claimed `queued`,
 *   claimed/running `running`, answered `ended` with the request no longer
 *   processing, and a further follow-up processing again.
 * - M1-04/M1R-13: a secretary waiting on a Work continuation reply is refused
 *   as an `@` recipient and as a manual route target with `unavailable` and
 *   the platform's admission text; the request read does not change and no
 *   round lands on it.
 *
 * Every prior state is a public step of the same world: `requests/submit`,
 * `requests/route`, `requests/read` and the Host's driver. The answers are
 * the Session's scripted model replies. Nothing is read from the store.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  followUp, initializeProject, newRequest, secretaryAnswer, submitRound, waitForRound,
} from '../helpers/S6A-history-fixture.js';
import {
  SECRETARY_STRINGS, SECTION_HEADERS, SECRETARY_ANSWER_FORMAT_V1, taskRoundSlot,
} from '../helpers/S6A-prompt-samples.js';
import type { S6ABackend } from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier the fixture's gates use; the test file owns its two mocks.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const BACKENDS = ['memory', 'sqlite'] as const;

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

async function openWorld(backend: S6ABackend, options: {
  secretaryWork?: boolean;
} = {}): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' },
    ...(options.secretaryWork === true ? { secretaryWork: true } : {}) });
  worlds.push(world);
  return world;
}

/** The last user message of one model request: the rendered input that run was given. */
function currentInput(request: ModelRequest): string {
  const messages = request.messages as unknown as { role: string; content: string }[];
  const last = messages.at(-1);
  if (last === undefined || last.role !== 'user') throw new Error('S6A: the model request carried no current user message');
  return last.content;
}

/** The task section of a rendered input: its three slots are the last section of the platform order. */
function taskSectionOf(input: string): string {
  const at = input.indexOf(SECTION_HEADERS.task);
  if (at < 0) throw new Error('S6A: the rendered input has no task section');
  return input.slice(at);
}

/** The answered round of the request read, or a failed row. */
function roundOf(view: RequestCoreViewV1, round: QueryJobRef): RequestCoreViewV1['rounds'][number] {
  const found = view.rounds.find(candidate => candidate.ref.queryJobId === round.queryJobId);
  if (found === undefined) throw new Error(`S6A: the request does not list the round ${round.queryJobId}`);
  return found;
}

/** Rounds that are not `routing` rounds: the inputs and execution rounds the rows speak about. */
function executionRounds(view: RequestCoreViewV1): RequestCoreViewV1['rounds'] {
  return view.rounds.filter(round => round.kind !== 'routing');
}

describe.each(BACKENDS)('R-03b, a follow-up while the owner runs (%s)', (backend: S6ABackend) => {
  it('queues on the owner without a routing round, then runs as its own round with only its own input', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const answerOne = secretaryAnswer({ body: 'S6A flow answer one' });
    const answerTwo = secretaryAnswer({ body: 'S6A flow answer two' });
    await world.scripted.script(a, [
      { kind: 'text', text: answerOne },
      { kind: 'text', text: answerTwo },
    ]);

    // Round 1 enters on A; its model request is held, so the round is live
    // while the follow-up is submitted.
    const model = await world.gates.modelRequest(a);
    const first = await submitRound(world, newRequest('s6a-flow-1', a, 'S6A flow round one'));
    const held = await model.reached;
    const firstInput = currentInput(held);

    const second = await submitRound(world, followUp('s6a-flow-2', first.requestRoot, 'S6A flow round two'));
    // The receipt names the Session the round was assigned to: the owner A.
    expect(second.secretary).toEqual(a.ref);
    const during = await world.readRequest(first.requestRoot);
    expect(during.owner).toEqual(a.ref);
    expect(during.ownerState).toBe('owned');
    expect(during.processing).toBe(true);
    expect(during.rounds.some(round => round.kind === 'routing')).toBe(false);
    expect(executionRounds(during).map(round => [round.ref, round.kind, round.status, round.session, round.answer]))
      .toEqual([
        [first.round, 'request', 'running', a.ref, null],
        [second.round, 'followup', 'queued', null, null],
      ]);

    model.release();
    const ended = await world.waitForRequest(first.requestRoot,
      view => executionRounds(view).every(round => round.status === 'ended' && round.answer !== null),
      'round 1 answers and round 2 runs as its own round');
    expect(executionRounds(ended).map(round => [round.ref, round.status, round.session, round.answer])).toEqual([
      [first.round, 'ended', a.ref, 'S6A flow answer one'],
      [second.round, 'ended', a.ref, 'S6A flow answer two'],
    ]);
    expect(ended.owner).toEqual(a.ref);
    expect(ended.processing).toBe(false);

    // Two execution rounds, not one: the follow-up was submitted after round
    // 1's preparation had frozen its batch, so it never became a batch input.
    const requests = await world.scripted.requests(a);
    expect(requests).toHaveLength(2);
    const secondInput = currentInput(requests[1]!);
    expect(taskSectionOf(secondInput)).toBe(taskRoundSlot(
      { since: roundOf(ended, second.round).since, input: 'S6A flow round two' }, SECRETARY_ANSWER_FORMAT_V1).trimStart());
    // No batch and no earlier entry: round 1's text appears nowhere in the
    // current input (it is history below, not a request slot).
    expect(secondInput).not.toContain('S6A flow round one');

    // P6: this Session's earlier round is its Kernel history, not an earlier
    // entry of the request. The second request's messages carry round 1's
    // input and answer before round 2's input.
    const history = requests[1]!.messages as unknown as { role: string; content: string }[];
    // Round 1's history input is the sample's own text, not only the request
    // seen earlier: the section it holds is the task slot of round one.
    expect(taskSectionOf(history[0]!.content)).toBe(taskRoundSlot(
      { since: roundOf(ended, first.round).since, input: 'S6A flow round one' },
      SECRETARY_ANSWER_FORMAT_V1).trimStart());
    expect(history.map(message => [message.role, message.content])).toEqual([
      ['user', firstInput],
      ['assistant', answerOne],
      ['user', secondInput],
    ]);
    expect(await world.scripted.pending(a)).toBe(0);
  }, 90_000);
});

describe.each(BACKENDS)('R-05, the owner half (%s)', (backend: S6ABackend) => {
  it('a pending follow-up routed to B before round 1 ends runs on B, which sees round 1 as an earlier round', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const answerOne = secretaryAnswer({ body: 'S6A owner answer one' });
    const answerTwo = secretaryAnswer({ body: 'S6A owner answer two' });
    await world.scripted.script(a, [{ kind: 'text', text: answerOne }]);
    await world.scripted.script(b, [{ kind: 'text', text: answerTwo }]);

    const model = await world.gates.modelRequest(a);
    const first = await submitRound(world, newRequest('s6a-owner-1', a, 'S6A owner round one'));
    await model.reached;
    const second = await submitRound(world, followUp('s6a-owner-2', first.requestRoot, 'S6A owner round two'));

    expect(await world.route({ commandId: 's6a-owner-route', round: first.round, to: b }))
      .toMatchObject({ status: 'routed' });
    const routed = await world.readRequest(first.requestRoot);
    expect(routed.owner).toEqual(b.ref);
    expect(executionRounds(routed).map(round => [round.ref, round.status, round.session]))
      .toEqual([
        [first.round, 'running', a.ref],
        [second.round, 'queued', null],
      ]);

    model.release();
    const ended = await world.waitForRequest(first.requestRoot,
      view => executionRounds(view).every(round => round.status === 'ended'),
      'round 1 ends on A and round 2 runs on B');
    expect(ended.owner).toEqual(b.ref);
    expect(executionRounds(ended).map(round => [round.ref, round.status, round.session, round.answer])).toEqual([
      [first.round, 'ended', a.ref, 'S6A owner answer one'],
      [second.round, 'ended', b.ref, 'S6A owner answer two'],
    ]);
    expect(await world.scripted.requests(a)).toHaveLength(1);
    const onB = await world.scripted.requests(b);
    expect(onB).toHaveLength(1);

    // Round 1 ran on another Session, so B's input shows it as an earlier
    // entry with its own input and its answer.
    const bInput = currentInput(onB[0]!);
    expect(bInput).toContain(SECRETARY_STRINGS['secretary.earlierHeading']);
    expect(bInput).toContain(`- [${roundOf(ended, first.round).since}] S6A owner round one`);
    expect(bInput).toContain('S6A owner answer one');
  }, 90_000);

  it('a drop while round 1 runs lets it finish and keeps its answer; the pending follow-up ends cancelled/dropped', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const answerOne = secretaryAnswer({ body: 'S6A drop finish answer' });
    await world.scripted.script(a, [{ kind: 'text', text: answerOne }]);

    const model = await world.gates.modelRequest(a);
    const first = await submitRound(world, newRequest('s6a-drop-1', a, 'S6A drop round one'));
    await model.reached;
    const second = await submitRound(world, followUp('s6a-drop-2', first.requestRoot, 'S6A drop round two'));
    expect(await world.drop({ commandId: 's6a-drop-command', round: first.round }))
      .toMatchObject({ status: 'routed' });

    // The drop ends the pending follow-up at once; the running round keeps
    // running and is not the drop's to close.
    const dropped = await world.waitForRequest(first.requestRoot,
      view => roundOf(view, second.round).status === 'ended', 'the pending follow-up ends at the drop');
    expect(roundOf(dropped, second.round)).toMatchObject({
      status: 'ended', closeCode: 'cancelled', closeDetail: 'dropped', answer: null, session: null,
    });
    expect(roundOf(dropped, first.round)).toMatchObject({ status: 'running', answer: null });

    model.release();
    const ended = await world.waitForRequest(first.requestRoot,
      view => roundOf(view, first.round).status === 'ended', 'round 1 finishes after the drop');
    expect(roundOf(ended, first.round)).toMatchObject({
      status: 'ended', answer: 'S6A drop finish answer', closeCode: null, closeDetail: null, session: a.ref,
    });
    expect(roundOf(ended, second.round)).toMatchObject({
      status: 'ended', closeCode: 'cancelled', closeDetail: 'dropped', answer: null,
    });
    // No model request was made for the ended follow-up.
    expect(await world.scripted.requests(a)).toHaveLength(1);
    expect(await world.scripted.pending(a)).toBe(0);
  }, 90_000);
});

describe.each(BACKENDS)('R-06b, the status projection through real rounds (%s)', (backend: S6ABackend) => {
  it('reads queued, running, ended and processing again for a further follow-up', async () => {
    const world = await openWorld(backend);
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const answerOne = secretaryAnswer({ body: 'S6A status answer one' });
    const answerTwo = secretaryAnswer({ body: 'S6A status answer two' });
    await world.scripted.script(a, [
      { kind: 'text', text: answerOne },
      { kind: 'text', text: answerTwo },
    ]);

    // Not claimed: the claim commit is held.
    const claim = await world.gates.beforeClaim(a);
    const first = await submitRound(world, newRequest('s6a-status-1', a, 'S6A status round one'));
    await claim.reached;
    const queued = await world.readRequest(first.requestRoot);
    expect(queued.rounds).toHaveLength(1);
    expect(roundOf(queued, first.round)).toMatchObject({ status: 'queued', answer: null, session: null });
    expect(queued).toMatchObject({ processing: true, reasons: ['round'] });

    // Claimed and running: the model request is held.
    const model = await world.gates.modelRequest(a);
    claim.release();
    await model.reached;
    const running = await world.readRequest(first.requestRoot);
    expect(roundOf(running, first.round)).toMatchObject({ status: 'running', answer: null });
    expect(running).toMatchObject({ processing: true, reasons: ['round'] });

    model.release();
    const ended = await world.waitForRequest(first.requestRoot,
      view => roundOf(view, first.round).answer !== null, 'round 1 answers');
    expect(roundOf(ended, first.round)).toMatchObject({ status: 'ended', answer: 'S6A status answer one' });
    expect(ended).toMatchObject({ processing: false, reasons: [] });

    // A further follow-up makes the request processing again; its own round
    // reaches the same ended projection.
    const claimAgain = await world.gates.beforeClaim(a);
    const second = await submitRound(world, followUp('s6a-status-2', first.requestRoot, 'S6A status round two'));
    await claimAgain.reached;
    const again = await world.readRequest(first.requestRoot);
    expect(again).toMatchObject({ processing: true, reasons: ['round'] });
    expect(executionRounds(again).map(round => [round.ref, round.status]))
      .toEqual([[first.round, 'ended'], [second.round, 'queued']]);
    claimAgain.release();
    const secondEnded = await world.waitForRequest(first.requestRoot,
      view => roundOf(view, second.round).status === 'ended', 'round 2 answers');
    expect(roundOf(secondEnded, second.round)).toMatchObject({ status: 'ended', answer: 'S6A status answer two' });
    expect(secondEnded).toMatchObject({ processing: false, reasons: [] });
    expect(await world.scripted.requests(a)).toHaveLength(2);
  }, 90_000);
});

describe.each(BACKENDS)('M1-04/M1R-13, a secretary waiting on a Work reply (%s)', (backend: S6ABackend) => {
  it('is refused as an @ recipient and as a manual route target; the request does not change', async () => {
    const world = await openWorld(backend, { secretaryWork: true });
    const waiting = await world.makeWorkWaitingSecretary('waiting');
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [{ kind: 'text', text: secretaryAnswer({ body: 'S6A wait answer' }) }]);
    const first = await submitRound(world, newRequest('s6a-wait-1', a, 'S6A wait request'));
    const answered = await waitForRound(world, first.requestRoot, first.round, 'ended');
    expect(roundOf(answered, first.round).answer).toBe('S6A wait answer');

    const reason = 'archive_wait_disposal_required: the Session is waiting for a continuation reply';
    const before = await world.readRequest(first.requestRoot);

    // The `@` recipient path: a follow-up addressed to the waiting Session.
    expect(await world.submit({ ...followUp('s6a-wait-2', first.requestRoot, 'S6A wait follow-up'),
      recipient: waiting.session })).toEqual({ status: 'rejected', code: 'unavailable', reason });
    expect(await world.readRequest(first.requestRoot)).toEqual(before);

    // The manual route path: the route answers the same refusal in its own shape.
    expect(await world.route({ commandId: 's6a-wait-route', round: first.round, to: waiting.session }))
      .toEqual({ status: 'rejected', code: 'unavailable', reason });
    const after = await world.readRequest(first.requestRoot);
    expect(after).toEqual(before);
    expect(after.owner).toEqual(a.ref);
    expect(after.rounds.every(round =>
      round.session?.sessionId !== waiting.session.ref.sessionId
      && round.assignedSession?.sessionId !== waiting.session.ref.sessionId)).toBe(true);
    // The waiting line ran only the Work run's model request, never a request round.
    expect(after.rounds).toHaveLength(1);
  }, 90_000);
});
