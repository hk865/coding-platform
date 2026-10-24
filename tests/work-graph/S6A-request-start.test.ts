/**
 * A request round's claim, start and attempts through the Query routes, with
 * the request driver off (each round waits where its command left it):
 * `requests/submit|route|...` place the round, `queries/claim` (with the
 * secretary profile `bootstrap` publishes), `queries/prepare` and
 * `queries/start` run its attempt, and the Session's scripted model answers.
 * The project has no architecture or policy pointer, so every round runs
 * `initial_coordination` and answers in the v2 initial-planning format.
 *
 * Rows (memory and SQLite unless named):
 * - R-13: the request moved to B after the claim on A: A's start answers
 *   `busy`, the round waits on a new Run, A is free, the intake the round held
 *   on A is released, no model call; a second start of the same request that
 *   read the attempt before the first one committed answers the same `busy`.
 * - Two starts of one request whose commits decide differently (one enters,
 *   the other abandons the attempt): whichever commit reached the store first,
 *   both starts answer its outcome.
 * - The start absorbs the frozen batch: the follow-up ends `absorbedInto` the
 *   executing round, which carries the answer; the intake the executing round
 *   held is released.
 * - The absorbed round releases the intake it holds (the follow-up that took
 *   B's intake after A was archived).
 * - Transfer before the first claim: B's start releases A's intake.
 * - `owner_archived`: the owner is archived while A's passing start commit is
 *   held; the start re-reads and answers `busy`, the request waiting.
 * - `invalid_answer`: too long, empty and a broken v2 answer each close the
 *   round with their detail and reason.
 * - `entered`: the round records the Session it entered on.
 * - A terminal observed twice: the start's terminal commit reaches the store
 *   after an observe of the same Run committed that terminal; the start
 *   answers the record the observe committed.
 * - `rejects:` a second claim of a claimed attempt, a request round and a plain
 *   Query, on another idle Session.
 * - SQLite (crash and restart): a drop over an `entering` round closes it
 *   `cancelled`/`dropped` at the restart; a retry after the restart keeps the
 *   round its first attempt absorbed.
 *
 * Every step is a public route, a fixture gate or the fixture's crash, plus
 * one delegating hold of the start's prompt-text read (rule sheet A3: it waits
 * at a test gate, then calls the real read and returns its result unchanged).
 * Nothing is read from the store and no record is written by hand. Expected
 * values are literals or hand-built from the fixture's configuration and the
 * scripted replies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import * as promptTexts from '../../src/core/agent-runtime/prompt-set-texts.js';
import { deferred, readQuery } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { claimQuery, claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { submitRound } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const openWorlds = worlds.splice(0);
  await Promise.all(openWorlds.map(world => world.close()));
  expect(left).toEqual([]);
});

async function openHostWorld(backend: 'memory' | 'sqlite'): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend });
  worlds.push(world);
  return world;
}

/** `queries/prepare` of the Query's current Run; a refusal fails the row. */
async function prepareAttempt(world: S6AHostWorld, ref: QueryJobRef, requestId: string): Promise<PreparedQueryExecution> {
  const answer = (await world.post('queries/prepare', plain(S6A_SCOPE, {
    queryRunRef: (await readQuery(world.ag2b, ref)).run.ref, requestId,
  }))).body as ReadResult<PreparedQueryExecution>;
  if (answer.status !== 'ready') throw new Error(`S6A: the preparation was refused: ${JSON.stringify(answer)}`);
  return answer.value;
}

/** `queries/start` of a prepared attempt; answers the route's body. */
async function start(world: S6AHostWorld, prepared: PreparedQueryExecution, requestId: string): Promise<Record<string, unknown>> {
  return (await world.post('queries/start', plain(S6A_SCOPE, { prepared, consumerId: 'ag2b-consumer', requestId }))).body as
    Record<string, unknown>;
}

/** Claimed with the profile and prepared on the Session; answers the prepared value. */
async function claimAndPrepare(world: S6AHostWorld, round: QueryJobRef, session: S6ASession, label: string):
Promise<PreparedQueryExecution> {
  expect(await claimWithSecretaryProfile(world, round, session, `${label}-claim`)).toMatchObject({ status: 'committed' });
  return await prepareAttempt(world, round, `${label}-prepare`);
}

/**
 * Holds the next read of a start's frozen prompt texts until `release` (rule sheet A3: the real read then runs and
 * its result is returned unchanged). The start reads its attempt before this read and begins its entry after it.
 */
function holdNextPromptTextRead(): { reached: Promise<void>; release(): void; restore(): void } {
  const real = promptTexts.readPromptTexts;
  const reached = deferred();
  const gate = deferred();
  const spy = vi.spyOn(promptTexts, 'readPromptTexts').mockImplementationOnce(async (...args) => {
    reached.resolve();
    await gate.promise;
    return await real(...args);
  });
  return { reached: reached.promise, release: () => gate.resolve(), restore: () => spy.mockRestore() };
}

/** What an abandoned start answers. */
const ABANDONED = { status: 'rejected', code: 'busy',
  reason: 'the request has another owner; this attempt was abandoned and the round waits for a new attempt' };

/** A valid `initial_coordination` answer (the v2 initial-planning format); the formal answer is the whole text. */
const COORDINATION_ANSWER = '{"schemaVersion":2,"kind":"needs_decision","summary":"S6A start summary","questions":["S6A start question"]}';

/** The new-request probe of a secretary's intake: a request addressed to it is taken by it. */
async function intakeTakes(world: S6AHostWorld, session: S6ASession, commandId: string): Promise<RequestSubmitResultV1> {
  return await world.submit({ commandId, goalId: S6A_GOAL_1.goalId, text: `S6A intake probe ${commandId}`, recipient: session });
}

describe.each(['memory', 'sqlite'] as const)('a request round started through the Query routes (%s)', backend => {
  describe('R-13: the request moved to B after the claim on A', () => {
    it('the start answers busy; the round waits on a new Run; A is free and its intake released; no model call', async () => {
      const world = await openHostWorld(backend);
      const b = await world.createSecretary('b');
      const a = await world.createSecretary('a');
      const request = await submitRound(world, { commandId: 's6a-r13', goalId: S6A_GOAL_1.goalId, text: 'S6A R-13',
        recipient: a });
      const prepared = await claimAndPrepare(world, request.round, a, 's6a-r13');
      const claimed = await readQuery(world.ag2b, request.round);
      expect(claimed.job.job.intakeSession).toEqual(a.ref);
      expect(await world.route({ commandId: 's6a-r13-route', round: request.round, to: b }))
        .toMatchObject({ status: 'routed' });

      expect(await start(world, prepared, 's6a-r13-start')).toEqual(ABANDONED);

      const after = await readQuery(world.ag2b, request.round);
      expect(after.job.job).toMatchObject({ status: 'pending', runRef: after.run.ref, intakeSession: null });
      expect(after.run.ref).toEqual({ ...claimed.run.ref, runId: after.run.ref.runId });
      expect(after.run.ref.runId).not.toBe(claimed.run.ref.runId);
      expect(after.run).toMatchObject({ revision: 1, run: { status: 'pending', outcome: null, startedAt: null, endedAt: null } });
      expect(after.run.run.executionState).toBeUndefined();
      const view = await world.readRequest(request.requestRoot);
      expect(view).toMatchObject({ owner: b.ref, ownerState: 'owned' });
      expect(view.rounds[0]).toMatchObject({ ref: request.round, status: 'queued', session: null, closeCode: null });
      // A holds nothing: its intake takes a new request and a plain Query claims it.
      expect((await world.readSession(a)).record.occupancy).toBeNull();
      expect(await intakeTakes(world, a, 's6a-r13-next')).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: a.ref });
      await world.occupy(a);
      expect(world.model.calls()).toBe(0);
      expect(await world.scripted.requests(a)).toEqual([]);
    });

    it('a second start that read the attempt before the first one committed answers the same busy', async () => {
      const world = await openHostWorld(backend);
      const b = await world.createSecretary('b');
      const a = await world.createSecretary('a');
      const request = await submitRound(world, { commandId: 's6a-r13-twice', goalId: S6A_GOAL_1.goalId,
        text: 'S6A R-13 twice', recipient: a });
      const prepared = await claimAndPrepare(world, request.round, a, 's6a-r13-twice');
      expect(await world.route({ commandId: 's6a-r13-twice-route', round: request.round, to: b }))
        .toMatchObject({ status: 'routed' });

      // The first start's abandoning commit waits before the store; the second start of the same request reads the
      // attempt (still prepared) and waits before its entry; the first commits, then the second begins.
      const firstCommit = commitBarrier.hold(byIdentityPrefix('r5b-query-execution:entering:'), 'the first start commit');
      const first = start(world, prepared, 's6a-r13-twice-start');
      await firstCommit.reached;
      const secondRead = holdNextPromptTextRead();
      try {
        const second = start(world, prepared, 's6a-r13-twice-start');
        await secondRead.reached;
        firstCommit.release();
        expect(await first).toEqual(ABANDONED);
        secondRead.release();
        expect(await second).toEqual(ABANDONED);
      } finally {
        secondRead.release();
        secondRead.restore();
      }
      const after = await readQuery(world.ag2b, request.round);
      expect(after.run).toMatchObject({ revision: 1, run: { status: 'pending' } });
      expect(after.job.job.runRef).toEqual(after.run.ref);
      expect((await world.readSession(a)).record.occupancy).toBeNull();
      expect(world.model.calls()).toBe(0);
    });
  });

  describe('two starts of one request whose commits decide differently: both answer the outcome committed first', () => {
    it("the first start's entry waits; the request moves to B and the second abandons first: both answer busy", async () => {
      const world = await openHostWorld(backend);
      const b = await world.createSecretary('b');
      const a = await world.createSecretary('a');
      const request = await submitRound(world, { commandId: 's6a-begin-abandon', goalId: S6A_GOAL_1.goalId,
        text: 'S6A begin abandon', recipient: a });
      const prepared = await claimAndPrepare(world, request.round, a, 's6a-begin-abandon');
      const claimed = await readQuery(world.ag2b, request.round);

      // The first start read A as the owner and its entry commit waits before the store; the request moves to B and a
      // second start of the same request reads B as the owner and commits the abandoned attempt.
      const entry = commitBarrier.hold(byIdentityPrefix('r5b-query-execution:entering:'), 'the first start entry');
      const first = start(world, prepared, 's6a-begin-abandon-start');
      await entry.reached;
      expect(await world.route({ commandId: 's6a-begin-abandon-route', round: request.round, to: b }))
        .toMatchObject({ status: 'routed' });
      expect(await start(world, prepared, 's6a-begin-abandon-start')).toEqual(ABANDONED);
      entry.release();

      expect(await first).toEqual(ABANDONED);
      const after = await readQuery(world.ag2b, request.round);
      expect(after.job.job).toMatchObject({ status: 'pending', runRef: after.run.ref });
      expect(after.run.ref.runId).not.toBe(claimed.run.ref.runId);
      expect((await world.readSession(a)).record.occupancy).toBeNull();
      expect(world.model.calls()).toBe(0);
      expect(await world.scripted.requests(a)).toEqual([]);
    });

    it("the first start's abandon waits; the request moves back to A and the second enters first: both answer its record", async () => {
      const world = await openHostWorld(backend);
      const b = await world.createSecretary('b');
      const a = await world.createSecretary('a');
      const request = await submitRound(world, { commandId: 's6a-begin-entry', goalId: S6A_GOAL_1.goalId,
        text: 'S6A begin entry', recipient: a });
      const prepared = await claimAndPrepare(world, request.round, a, 's6a-begin-entry');
      expect(await world.route({ commandId: 's6a-begin-entry-route', round: request.round, to: b }))
        .toMatchObject({ status: 'routed' });
      await world.scripted.script(a, [{ kind: 'text', text: COORDINATION_ANSWER }]);

      // The first start read B as the owner and its abandoning commit waits before the store; the request moves back
      // to A and a second start of the same request reads A as the owner, enters and is answered.
      const abandon = commitBarrier.hold(byIdentityPrefix('r5b-query-execution:entering:'), 'the first start abandon');
      const first = start(world, prepared, 's6a-begin-entry-start');
      await abandon.reached;
      expect(await world.route({ commandId: 's6a-begin-entry-back', round: request.round, to: a }))
        .toMatchObject({ status: 'routed' });
      const second = await start(world, prepared, 's6a-begin-entry-start');
      expect(second).toMatchObject({ status: 'ready', value: { answer: { revision: 1, answer: { answer: COORDINATION_ANSWER } } } });
      abandon.release();

      expect(await first).toEqual(second);
      expect((await world.readRequest(request.requestRoot)).rounds[0]).toMatchObject({ ref: request.round, status: 'ended',
        answer: COORDINATION_ANSWER });
      expect(await world.scripted.requests(a)).toHaveLength(1);
    });
  });

  it('the start absorbs the batch round into the executing round, which carries the answer, and releases its intake', async () => {
    const world = await openHostWorld(backend);
    const a = await world.createSecretary('a');
    const first = await submitRound(world, { commandId: 's6a-absorb-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A absorb first', recipient: a });
    const second = await submitRound(world, { commandId: 's6a-absorb-2', goalId: S6A_GOAL_1.goalId,
      text: 'S6A absorb second', continues: first.requestRoot });
    expect((await readQuery(world.ag2b, first.round)).job.job.intakeSession).toEqual(a.ref);
    expect((await readQuery(world.ag2b, second.round)).job.job.intakeSession).toBeNull();
    const prepared = await claimAndPrepare(world, first.round, a, 's6a-absorb');
    await world.scripted.script(a, [{ kind: 'text', text: COORDINATION_ANSWER }]);

    expect(await start(world, prepared, 's6a-absorb-start')).toMatchObject({ status: 'ready' });

    const view = await world.readRequest(first.requestRoot);
    expect(view.rounds.map(round => [round.ref, round.status, round.absorbedInto, round.answer, round.closeCode])).toEqual([
      [first.round, 'ended', null, COORDINATION_ANSWER, null],
      [second.round, 'ended', first.round, null, 'not_entered'],
    ]);
    const executing = await readQuery(world.ag2b, first.round);
    expect(executing.job.job).toMatchObject({ absorbedRounds: [second.round], intakeSession: null, enteredSession: a.ref });
    expect((await readQuery(world.ag2b, second.round)).job.job).toMatchObject({ absorbedInto: first.round, intakeSession: null });
    expect(await intakeTakes(world, a, 's6a-absorb-next')).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: a.ref });
    expect(await world.scripted.requests(a)).toHaveLength(1);
  });

  it("the absorbed round releases the intake it holds: the follow-up that took B's intake after A was archived", async () => {
    const world = await openHostWorld(backend);
    const b = await world.createSecretary('b');
    const a = await world.createSecretary('a');
    const first = await submitRound(world, { commandId: 's6a-held-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A held first', recipient: a });
    await world.archive(a);
    expect(await world.readRequest(first.requestRoot)).toMatchObject({ owner: null, ownerState: 'owner_archived' });
    const second = await submitRound(world, { commandId: 's6a-held-2', goalId: S6A_GOAL_1.goalId,
      text: 'S6A held second', continues: first.requestRoot, recipient: b });
    expect((await readQuery(world.ag2b, first.round)).job.job.intakeSession).toBeNull();
    expect((await readQuery(world.ag2b, second.round)).job.job.intakeSession).toEqual(b.ref);
    const prepared = await claimAndPrepare(world, first.round, b, 's6a-held');
    await world.scripted.script(b, [{ kind: 'text', text: COORDINATION_ANSWER }]);

    expect(await start(world, prepared, 's6a-held-start')).toMatchObject({ status: 'ready' });

    expect((await readQuery(world.ag2b, second.round)).job.job).toMatchObject({ status: 'closed', absorbedInto: first.round,
      intakeSession: null });
    expect(await intakeTakes(world, b, 's6a-held-next')).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: b.ref });
  });

  it("transfer before the first claim: B claims and starts, and B's start releases A's intake", async () => {
    const world = await openHostWorld(backend);
    const b = await world.createSecretary('b');
    const a = await world.createSecretary('a');
    const request = await submitRound(world, { commandId: 's6a-transfer', goalId: S6A_GOAL_1.goalId,
      text: 'S6A transfer', recipient: a });
    expect(await world.route({ commandId: 's6a-transfer-route', round: request.round, to: b }))
      .toMatchObject({ status: 'routed' });
    expect((await readQuery(world.ag2b, request.round)).job.job.intakeSession).toEqual(a.ref);
    const prepared = await claimAndPrepare(world, request.round, b, 's6a-transfer');
    await world.scripted.script(b, [{ kind: 'text', text: COORDINATION_ANSWER }]);

    expect(await start(world, prepared, 's6a-transfer-start')).toMatchObject({ status: 'ready' });

    expect((await readQuery(world.ag2b, request.round)).job.job).toMatchObject({ intakeSession: null, enteredSession: b.ref });
    expect(await intakeTakes(world, a, 's6a-transfer-next')).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: a.ref });
    expect(await world.scripted.requests(b)).toHaveLength(1);
    expect(await world.scripted.requests(a)).toEqual([]);
  });

  it('owner_archived: the owner is archived while the start commit is held; the start re-reads and answers busy', async () => {
    const world = await openHostWorld(backend);
    const b = await world.createSecretary('b');
    const a = await world.createSecretary('a');
    const request = await submitRound(world, { commandId: 's6a-archived', goalId: S6A_GOAL_1.goalId,
      text: 'S6A owner archived', recipient: a });
    const prepared = await claimAndPrepare(world, request.round, a, 's6a-archived');
    const claimed = await readQuery(world.ag2b, request.round);

    // A's start read A as the owner and its commit waits before the store; the request moves to B and B is archived.
    const held = world.gates.beforeStart(a, request.round);
    const started = start(world, prepared, 's6a-archived-start');
    await held.reached;
    expect(await world.route({ commandId: 's6a-archived-route', round: request.round, to: b }))
      .toMatchObject({ status: 'routed' });
    await world.archive(b);
    held.release();

    expect(await started).toEqual(ABANDONED);
    const view = await world.readRequest(request.requestRoot);
    expect(view).toMatchObject({ owner: null, ownerState: 'owner_archived', waitReason: 'owner_archived' });
    expect(view.rounds[0]).toMatchObject({ ref: request.round, status: 'queued', session: null });
    const after = await readQuery(world.ag2b, request.round);
    expect(after.job.job).toMatchObject({ status: 'pending', runRef: after.run.ref, intakeSession: null });
    expect(after.run.ref.runId).not.toBe(claimed.run.ref.runId);
    expect((await world.readSession(a)).record.occupancy).toBeNull();
    expect(world.model.calls()).toBe(0);
  });

  it('invalid_answer: too long, empty and a broken v2 answer each close the round with their detail and reason', async () => {
    const world = await openHostWorld(backend);
    const a = await world.createSecretary('a');
    const cases = [
      { label: 'long', text: 'x'.repeat(16 * 1024 + 1), detail: 'too_long',
        message: 'the secretary answer is over the 16 KiB answer bound' },
      // A whitespace-only reply: the turn ends without answer text (a reply with no text at all fails the Kernel run).
      { label: 'empty', text: ' \n', detail: 'empty', message: 'the secretary turn ended without answer text' },
      { label: 'protocol', text: '{"schemaVersion":2,', detail: 'protocol',
        message: 'the initial-planning answer is not valid JSON' },
    ] as const;
    for (const entry of cases) {
      const request = await submitRound(world, { commandId: `s6a-invalid-${entry.label}`, goalId: S6A_GOAL_1.goalId,
        text: `S6A invalid ${entry.label}`, recipient: a });
      const prepared = await claimAndPrepare(world, request.round, a, `s6a-invalid-${entry.label}`);
      await world.scripted.script(a, [{ kind: 'text', text: entry.text }]);
      await start(world, prepared, `s6a-invalid-${entry.label}-start`);
      const { job } = await readQuery(world.ag2b, request.round);
      expect(job.job, entry.label).toMatchObject({ status: 'closed', answerRefs: [],
        closeReason: { code: 'invalid_answer', detail: entry.detail, message: entry.message } });
      expect((await world.readRequest(request.requestRoot)).rounds[0], entry.label).toMatchObject({
        status: 'ended', answer: null, closeCode: 'invalid_answer', closeDetail: entry.detail });
      expect((await world.readSession(a)).record.occupancy, entry.label).toBeNull();
    }
    expect(await world.scripted.requests(a)).toHaveLength(3);
  });

  it('entered: the round records the Session it entered on before its answer', async () => {
    const world = await openHostWorld(backend);
    const a = await world.createSecretary('a');
    const request = await submitRound(world, { commandId: 's6a-entered', goalId: S6A_GOAL_1.goalId,
      text: 'S6A entered', recipient: a });
    const prepared = await claimAndPrepare(world, request.round, a, 's6a-entered');
    expect((await readQuery(world.ag2b, request.round)).job.job.enteredSession).toBeNull();
    await world.scripted.script(a, [{ kind: 'text', text: COORDINATION_ANSWER }]);
    const model = await world.gates.modelRequest(a);
    const started = start(world, prepared, 's6a-entered-start');
    await model.reached;
    const entered = await readQuery(world.ag2b, request.round);
    expect(entered.run.run.executionState?.phase).toBe('entered');
    expect(entered.job.job.enteredSession).toEqual(a.ref);
    model.release();
    expect(await started).toMatchObject({ status: 'ready' });
    expect((await readQuery(world.ag2b, request.round)).job.job.enteredSession).toEqual(a.ref);
  });

  it('a terminal observed twice: the start, whose terminal commit lands after an observe committed it, answers that record', async () => {
    const world = await openHostWorld(backend);
    const a = await world.createSecretary('a');
    const request = await submitRound(world, { commandId: 's6a-settle-twice', goalId: S6A_GOAL_1.goalId,
      text: 'S6A settle twice', recipient: a });
    const prepared = await claimAndPrepare(world, request.round, a, 's6a-settle-twice');
    await world.scripted.script(a, [{ kind: 'text', text: COORDINATION_ANSWER }]);

    // The start's terminal commit waits before the store; an observe of the same Run commits the same terminal.
    const terminal = commitBarrier.hold(byIdentityPrefix(`r5b-query-execution:observed:${prepared.queryRunRef.runId}:`),
      'the start terminal');
    const started = start(world, prepared, 's6a-settle-twice-start');
    await terminal.reached;
    const observed = (await world.post('queries/observe', plain(S6A_SCOPE, { queryRunRef: prepared.queryRunRef }))).body;
    expect(observed).toMatchObject({ status: 'ready', value: { run: { run: { status: 'answered' } },
      answer: { revision: 1, answer: { answer: COORDINATION_ANSWER } } } });
    terminal.release();

    expect(await started).toEqual(observed);
    expect((await world.readRequest(request.requestRoot)).rounds[0]).toMatchObject({ ref: request.round, status: 'ended',
      answer: COORDINATION_ANSWER });
    expect(await world.scripted.requests(a)).toHaveLength(1);
  });

  describe('rejects: a second claim of a claimed attempt on another idle Session', () => {
    it('a request round claimed on A is busy on B; A keeps the attempt and B stays free', async () => {
      const world = await openHostWorld(backend);
      const b = await world.createSecretary('b');
      const a = await world.createSecretary('a');
      const request = await submitRound(world, { commandId: 's6a-twice', goalId: S6A_GOAL_1.goalId,
        text: 'S6A claimed twice', recipient: a });
      expect(await claimWithSecretaryProfile(world, request.round, a, 's6a-twice-claim-a')).toMatchObject({ status: 'committed' });
      const claimed = await readQuery(world.ag2b, request.round);
      const bBefore = (await world.readSession(b)).record.revision;

      expect(await claimWithSecretaryProfile(world, request.round, b, 's6a-twice-claim-b')).toEqual({ status: 'rejected', code: 'busy',
        reason: 'the QueryRun is not awaiting a first claim' });

      expect(await readQuery(world.ag2b, request.round)).toEqual(claimed);
      expect((await world.readSession(a)).record.occupancy).toMatchObject({ kind: 'execution', executionRef: claimed.run.ref });
      expect((await world.readSession(b)).record).toMatchObject({ revision: bBefore, occupancy: null });
      await world.occupy(b);
    });

    it('a plain Query claimed on A is busy on B; A keeps it and B stays free', async () => {
      const world = await openHostWorld(backend);
      const b = await world.createSecretary('b');
      const a = await world.createSecretary('a');
      const refs = await world.occupy(a);
      const claimed = await readQuery(world.ag2b, refs.queryJobRef);
      const bBefore = (await world.readSession(b)).record.revision;

      expect(await claimQuery(world, refs.queryJobRef, b, null, 's6a-twice-plain-b')).toEqual({ status: 'rejected',
        code: 'busy', reason: 'the QueryRun is not awaiting a first claim' });

      expect(await readQuery(world.ag2b, refs.queryJobRef)).toEqual(claimed);
      expect((await world.readSession(a)).record.occupancy).toMatchObject({ kind: 'execution', executionRef: claimed.run.ref });
      expect((await world.readSession(b)).record).toMatchObject({ revision: bBefore, occupancy: null });
      await world.occupy(b);
    });
  });
});

describe('a request round across a crash and restart (sqlite)', () => {
  it('a drop over an entering round: QRR-02 closes it cancelled/dropped; the new round on B waits', async () => {
    const world = await openHostWorld('sqlite');
    const b = await world.createSecretary('b');
    const a = await world.createSecretary('a');
    const request = await submitRound(world, { commandId: 's6a-drop-entering', goalId: S6A_GOAL_1.goalId,
      text: 'S6A drop over entering', recipient: a });
    const prepared = await claimAndPrepare(world, request.round, a, 's6a-drop-entering');
    const kernel = await world.gates.beforeKernel(a);
    void start(world, prepared, 's6a-drop-entering-start').catch(() => undefined);
    await kernel.reached;
    expect((await readQuery(world.ag2b, request.round)).run.run.executionState?.phase).toBe('entering');
    expect(await world.drop({ commandId: 's6a-drop-entering-drop', round: request.round })).toMatchObject({ status: 'routed' });
    // The drop leaves the entering round to finish; a new round goes to B.
    expect((await world.readRequest(request.requestRoot)).rounds[0]).toMatchObject({ ref: request.round, status: 'running' });
    const next = await submitRound(world, { commandId: 's6a-drop-entering-next', goalId: S6A_GOAL_1.goalId,
      text: 'S6A after the drop', continues: request.requestRoot, recipient: b });

    await world.crash();
    const view = await world.waitForRequest(request.requestRoot, current => current.rounds[0]?.status === 'ended',
      'the restart closes the entering round');
    const rounds = view.rounds.filter(round => round.kind !== 'routing');
    expect(rounds.map(round => [round.ref, round.status, round.closeCode, round.closeDetail, round.assignedSession])).toEqual([
      [request.round, 'ended', 'cancelled', 'dropped', a.ref],
      [next.round, 'queued', null, null, b.ref],
    ]);
    expect(view).toMatchObject({ owner: b.ref, ownerState: 'owned' });
    expect((await readQuery(world.ag2b, request.round)).run.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    expect((await world.readSession(a)).record.occupancy).toBeNull();
    expect(world.model.calls()).toBe(0);
    expect(world.scripted.abandonedCalls()).toEqual([]);
  });

  it('a retry after the restart keeps the round its first attempt absorbed: one model run, the batch still names it', async () => {
    const world = await openHostWorld('sqlite');
    const a = await world.createSecretary('a');
    const first = await submitRound(world, { commandId: 's6a-retry-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A retry first', recipient: a });
    const second = await submitRound(world, { commandId: 's6a-retry-2', goalId: S6A_GOAL_1.goalId,
      text: 'S6A retry second', continues: first.requestRoot });
    const secondSince = (await world.readRequest(first.requestRoot)).rounds[1]!.since;
    const prepared = await claimAndPrepare(world, first.round, a, 's6a-retry');
    const kernel = await world.gates.beforeKernel(a);
    void start(world, prepared, 's6a-retry-start').catch(() => undefined);
    await kernel.reached;
    expect((await readQuery(world.ag2b, second.round)).job.job).toMatchObject({ status: 'closed', absorbedInto: first.round });

    await world.crash();
    await world.waitForRequest(first.requestRoot, current => current.rounds[0]?.status === 'queued',
      'the restart leaves the first round waiting for a new attempt');
    await world.scripted.script(a, [{ kind: 'text', text: COORDINATION_ANSWER }]);
    const retried = await claimAndPrepare(world, first.round, a, 's6a-retry-again');
    expect(await start(world, retried, 's6a-retry-again-start')).toMatchObject({ status: 'ready' });

    const requests = await world.scripted.requests(a);
    expect(requests).toHaveLength(1);
    const input = (requests[0]!.messages[0] as { content: string }).content;
    expect(input).toContain(`## Also queued in this request\n- [${secondSince}] S6A retry second`);
    const view = await world.readRequest(first.requestRoot);
    expect(view.rounds.map(round => [round.ref, round.status, round.absorbedInto, round.answer])).toEqual([
      [first.round, 'ended', null, COORDINATION_ANSWER],
      [second.round, 'ended', first.round, null],
    ]);
    expect(world.scripted.abandonedCalls()).toEqual([]);
    expect(world.model.calls()).toBe(0);
  });
});
