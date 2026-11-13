/**
 * S9 G5 — R8's three Host-restart windows (SPEC §3.7 R8, "R8 的三窗口"; rulings 9-start §1 G5). SQLite only (Host
 * restart); public routes, platform methods and refs only, no store/table reads. Named mutations: ① restart reopens /
 * re-sends (`workflow.ts:349-354`); ② `record_review` writes a second Evidence or re-calls the model
 * (`evidence-service.ts:196`); ③ window ③ through the ordinary entry after the COMPLETED branch
 * (`intervention.ts:166-173`, arm `:161`). Today: green; gaps: none. `settle:false` alone links the source in the
 * same pass, so ③ keeps W1's one failed closing-notice commit; W4's closed arm is cited, not repeated.
 * R8①: the fixture cannot hold the review Query at "sent, unanswered"; by `crash()` it is already answered/settled,
 * so this row proves restart keeps one message/Query pair, not the literal unanswered window.
 * R8③: the `settlementOfferOf` exec_review arm is not isolated (removing it stays green); the row proves restart
 * settles the one source with no second Query/Goal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { SessionMessageRecord } from '../../src/contracts/mailbox.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../src/contracts/verification.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil, readPlanningQuery, sessionQueries } from '../helpers/IV-host-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { listed, readS7BMessage } from '../helpers/S7B-fixture.js';
import {
  advanceS9Review, answerS9Review, bookS9Review, openS9ReviewQuery, openS9ReviewWorld, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { commitBarrier.reset(); for (const review of worlds.splice(0)) await review.close(); });

const planRound = (message: SessionMessageRecord): boolean =>
  message.sender.kind === 'host' && message.sender.actor.id === 'host:plan-round';
const nextOfR8 = (result: WorkflowAdvanceResult): WorkflowAdvanceInput => {
  const next = result.status === 'ready' ? result.value.next : null;
  if (next === null) throw new Error(`R8: no next step: ${JSON.stringify(result)}`); return next;
};
const opOf = (step: WorkflowAdvanceInput | null): string | null => step?.kind === 'perform' ? step.operation.kind : null;
const selectOf = (review: S9ReviewWorld, flowId: string): WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef: review.goal, flowId, sessionHint: null, kind: 'select_work', taskId: review.task.taskId });
const displayOf = async (review: S9ReviewWorld) => ready<{ display: { causes: { code: string }[] } }>(await review.world.post('goals/display', plain(S6A_SCOPE, { goalRef: review.goal })), 'goals/display').display;
const driverOf = async (review: S9ReviewWorld) => (await review.world.post('workflow/driver-read', plain(S6A_SCOPE,
  { goalRef: review.goal }))).body as { status: string; value?: { state: string } };
const roundOfR8 = async (review: S9ReviewWorld, ref: VerificationRoundRef): Promise<RoundSnapshot> => {
  const read = await review.world.platform.evidence.readVerification(review.world.humanContext(), ref);
  if (read.status !== 'ready') throw new Error(`R8: the round is not readable: ${JSON.stringify(read)}`); return read.value; };
const saveResume = async (review: S9ReviewWorld, mode: 'ask' | 'auto'): Promise<void> => {
  const snapshot = await review.world.settings('snapshot', {});
  if (snapshot.status !== 'ready') throw new Error(`R8: settings: ${JSON.stringify(snapshot)}`);
  expect((await review.world.settings('automation/save', { autoReworkLimit: snapshot.value.automation.autoReworkLimit,
    resumeOnStartup: mode })).status).toBe('ready'); };
const goalRefs = async (review: S9ReviewWorld): Promise<unknown[]> => ready<{ goals: { ref: unknown }[] }>(
  await review.world.post('goals/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE })), 'goals/list').goals.map(row => row.ref);
const candidates = async (review: S9ReviewWorld): Promise<number> => (await review.main.readCards(review.goal))
  .filter(card => card.source.kind === 'candidate').length;
const failClosingNotice = (): void => { commitBarrier.failCommitOnce(byIdentityPrefix('session-message-send:')); };
const settleDriver = async (review: S9ReviewWorld): Promise<void> => {
  await heartbeatUntil(review.world, () => driverOf(review),
    read => read.status === 'ready' && read.value?.state !== 'running' && read.value?.state !== 'stopping', 24);
};

describe('R8 ①: sent, not answered, restarted', () => {
  it.each([{ mode: 'ask', interrupted: true }, { mode: 'auto', interrupted: false }] as const)(
    '$mode: the one execreview message/Query survives; no second Query or message', async ({ mode, interrupted }) => {
      const review = await openS9ReviewWorld({ backend: 'sqlite' }); worlds.push(review); const { world } = review;
      await world.scripted.script(review.reviewLine!, [{ kind: 'calls', calls: [{ callId: 'r8-1-pass',
        name: 'submit_exec_review', args: { verdict: 'pass', basis: 'R8 window 1 basis', report: 'R8 window 1 report' } }] }]);
      const query = await openS9ReviewQuery({ review });
      await saveResume(review, mode); await world.crash();
      expect((await displayOf(review)).causes.some(cause => cause.code === 'interrupted_pending_resume')).toBe(interrupted);
      if (interrupted) {
        expect((await driverOf(review)).status).toBe('not_found');
        expect((await world.post('workflow/driver-start', plain(S6A_SCOPE, {
          advance: selectOf(review, 'r8-ask-driver'), queryProfileIds: [] }))).body).toMatchObject({ status: 'ready' });
      }
      await settleDriver(review);
      const record = await readPlanningQuery(world, query.messageRef);
      expect(record?.job.ref).toEqual(query.queryJobRef); expect(record?.run.ref).toEqual(query.queryRunRef);
      expect((await sessionQueries(world, review.reviewLine!)).map(entry => entry.ref)).toEqual([query.queryRunRef]);
      expect((await readS7BMessage(world, query.messageRef)).ref).toEqual(query.messageRef);
      expect((await listed(world, 'inbox', review.reviewLine!)).filter(planRound)).toHaveLength(1);
      expect(systemRoundMessageRef(S6A_SCOPE, `execreview:${query.roundRef.roundId}`))
        .toEqual({ status: 'ready', value: query.messageRef });
    }, 180_000);
});
describe('R8 ②: booked, not finalized, restarted', () => {
  it('a goal-wait re-entry replays the receipt; finalize gets the ref once; no model call, same Query', async () => {
    const review = await openS9ReviewWorld({ backend: 'sqlite' }); worlds.push(review); const { world } = review;
    const query = await answerS9Review(review, 'pass');
    const ref = await bookS9Review(review, query.roundRef);
    const before = await readPlanningQuery(world, query.messageRef);
    const calls = (await world.scripted.requests(review.reviewLine!)).length;
    await world.crash();
    const record = nextOfR8(await advanceS9Review(review, selectOf(review, `goal-wait:${review.goal.goalId}`)));
    expect(opOf(record)).toBe('record_review');
    const booked = await advanceS9Review(review, record);
    expect(booked).toMatchObject({ status: 'ready', value: { state: 'advance', receipt: { kind: 'record_review',
      result: { status: 'committed', replayed: true, value: { evidenceRef: ref } } } } });
    const finalize = nextOfR8(booked); expect(opOf(finalize)).toBe('finalize_checks');
    const after = await readPlanningQuery(world, query.messageRef);
    expect(after?.run.run.executionState?.requests.length).toBe(before?.run.run.executionState?.requests.length);
    expect(after?.run.ref).toEqual(before?.run.ref);
    expect(after?.job.job.answerRefs.at(-1)).toEqual(before?.job.job.answerRefs.at(-1));
    expect(await world.scripted.requests(review.reviewLine!)).toHaveLength(calls);
    expect(await advanceS9Review(review, finalize)).toMatchObject({ status: 'ready', value: {
      receipt: { kind: 'finalize_checks', result: { status: 'committed' } } } });
    const round = await roundOfR8(review, query.roundRef);
    expect(round.status).toBe('finalized');
    expect(round.evidenceRefs.filter(candidate => candidate.evidenceId === ref.evidenceId)).toHaveLength(1);
  }, 180_000);
});
describe('R8 ③: answered, source R unlinked, restarted', () => {
  it('the auto restart settles R once by the exec_review arm; record_review still books the stored answer', async () => {
    const review = await openS9ReviewWorld({ backend: 'sqlite' }); worlds.push(review); const { world } = review;
    const query = await answerS9Review(review, 'pass', { settle: false, beforeEnd: failClosingNotice });
    const before = await readPlanningQuery(world, query.messageRef);
    const goals = await goalRefs(review); const cards = await candidates(review);
    const calls = (await world.scripted.requests(review.reviewLine!)).length;
    await saveResume(review, 'auto'); await world.crash();
    const settled = await heartbeatUntil(world, () => readS7BMessage(world, query.messageRef),
      message => message.response !== null || message.withdrawnAt !== null, 48);
    expect(settled.response).not.toBeNull(); expect(settled.withdrawnAt).toBeNull();
    const round = await heartbeatUntil(world, () => roundOfR8(review, query.roundRef),
      value => value.status === 'finalized', 24);
    expect(round).toMatchObject({ status: 'finalized', outcome: 'PASS' });
    expect(round.evidenceRefs).toHaveLength(2);   // the command result + exactly the one booked review
    const after = await readPlanningQuery(world, query.messageRef);
    expect(after?.job.job.answerRefs).toEqual(before?.job.job.answerRefs);
    expect(after?.run.ref).toEqual(query.queryRunRef);
    expect((await sessionQueries(world, review.reviewLine!)).map(entry => entry.ref)).toEqual([query.queryRunRef]);
    expect((await listed(world, 'inbox', review.reviewLine!)).filter(planRound)).toHaveLength(1);
    expect(await goalRefs(review)).toEqual(goals); expect(await candidates(review)).toBe(cards);
    expect(await world.scripted.requests(review.reviewLine!)).toHaveLength(calls);
  }, 180_000);
});
