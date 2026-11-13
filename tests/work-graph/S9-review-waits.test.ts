/**
 * S9 G5 — R5, R6, R7, R9 (slice-9 SPEC §3.7; rulings 9-start §1 G5). Shared S9 world; memory except R9 (SQLite:
 * Host restart). S1: the fold's `reviewer_stale` literal is G2's (tests/work-graph/S9-fold.test.ts); these rows drive
 * the Workflow to the fold and cite it. Named mutations: R5① a missing review folded as an empty-set PASS
 * (`evidence-service.ts` `supplied.length === 0`); R5② the report body-store failure swallowed (the material write
 * retried) so the booking commits; R5③ staleness judged in attribution and rejected there (`reviewFoldFacts` STALE
 * branch); R6 the ended-Run chain-resume gate dropped so a running Run reaches `openWorkChecksStep`/`nextAfterRound`
 * (select_work); R7 the reviewer line snapshotted at startup; R9 cold-start resume re-opens the round instead of
 * continuing it (resend). Today: green today.
 */
import { writeFile } from 'node:fs/promises'; import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { SessionMessageRecord } from '../../src/contracts/mailbox.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import type { NodeCardV1 } from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { RawArtifactPut } from '../../src/core/record-store/body-ports.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js'; import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readBody, sessionQueries } from '../helpers/IV-host-fixture.js'; import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js'; import { listed } from '../helpers/S7B-fixture.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { advanceS9Review, answerS9Review, openS9ReviewLine, openS9ReviewQuery, openS9ReviewRound,
  openS9ReviewWorld, type S9ReviewReply, type S9ReviewWorld } from '../helpers/S9-review-fixture.js';

const worlds: S9ReviewWorld[] = []; const restores: (() => void)[] = [];
afterEach(async () => { for (const restore of restores.splice(0)) restore(); for (const world of worlds.splice(0)) await world.close(); });
const REVIEW_PAIR = { obligationId: 's9-review-obligation', requirementId: 's9-review' }; const page = { afterCursor: null, limit: 20 };
const opOf = (step: WorkflowAdvanceInput | null): string | null => step?.kind === 'perform' ? step.operation.kind : null;
const nextOfS9 = (result: WorkflowAdvanceResult): WorkflowAdvanceInput => {
  if (result.status !== 'ready' || result.value.next === null) throw new Error(`S9: no next step: ${JSON.stringify(result)}`); return result.value.next; };
const committedStep = (kind: string) => ({ status: 'ready', value: { receipt: { kind, result: { status: 'committed' } } } });
const bookedRefOf = (result: WorkflowAdvanceResult): unknown =>
  (result as { value: { receipt: { result: { value: { evidenceRef: unknown } } } } }).value.receipt.result.value.evidenceRef;
const fromPlanRound = (message: SessionMessageRecord): boolean =>
  message.sender.kind === 'host' && message.sender.actor.id === 'host:plan-round';
const displayOf = async (review: S9ReviewWorld) => ready<{ display: unknown }>(await review.world.post('goals/display', plain(S6A_SCOPE, { goalRef: review.goal })), 'goals/display');
async function roundOfS9(review: S9ReviewWorld, ref: VerificationRoundRef) {
  const read = await review.world.platform.evidence.readVerification(review.world.humanContext(), ref);
  if (read.status !== 'ready') throw new Error(`S9: the round is not readable: ${JSON.stringify(read)}`); return read.value; }
async function roundCards(review: S9ReviewWorld) {
  const plan = await review.main.activePlan(review.goal); if (plan === null) throw new Error('S9: no adopted Plan');
  return ready<{ items: NodeCardV1[] }>(await review.world.post('graph/look', plain(S6A_SCOPE, { goalRef: review.goal,
    target: { kind: 'node', node: { kind: 'task', ref: review.task, planRef: plan.ref } }, relation: 'checks', page })), 'the Task round cards'); }
async function taskPhase(review: S9ReviewWorld): Promise<string> {
  const graph = ready<{ tasks: { ref: { taskId: string }; effectivePhase: string }[] }>(await review.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: review.goal })), 'tasks/query');
  const row = graph.tasks.find(task => task.ref.taskId === review.task.taskId);
  if (row === undefined) throw new Error('S9: the subject Task is not in the graph'); return row.effectivePhase; }

describe('R5: the review that cannot be accepted', () => {
  it.each([
    { name: 'no legal answer', reply: 'none' },
    { name: 'answer schema bad (no verdict)', reply: [{ kind: 'calls', calls: [{ callId: 's9-r5-schema',
      name: 'submit_exec_review', args: { basis: 'S9 basis', report: 'S9 report' } }] }] },
  ] as const)('① $name → INCONCLUSIVE + reviewer_missing, no booking, no ref in the finalize', async ({ reply }) => {
    const review = await openS9ReviewWorld(); worlds.push(review); const { world } = review;
    const query = await answerS9Review(review, reply as S9ReviewReply);
    const before = await roundOfS9(review, query.roundRef); const book = world.platform.evidence.recordReviewEvidence!;
    expect(await book(world.humanContext(), { input: { roundRef: query.roundRef }, meta: { requestId: 's9-r5-missing', expected: [] } })).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await roundOfS9(review, query.roundRef)).toEqual(before);
    const finalize = nextOfS9(await advanceS9Review(review)); expect(opOf(finalize)).toBe('finalize_checks');
    if (finalize.kind !== 'perform' || finalize.operation.kind !== 'finalize_checks') {
      throw new Error(`S9: the next step is not finalize_checks: ${JSON.stringify(finalize)}`);
    }
    expect(finalize.operation.request.input.reviewerEvidence).toBeUndefined();
    expect(await advanceS9Review(review, finalize)).toMatchObject(committedStep('finalize_checks'));
    const round = await roundOfS9(review, query.roundRef);
    expect(round).toMatchObject({ status: 'finalized', outcome: 'INCONCLUSIVE' });
    expect(round.gaps).toEqual([expect.objectContaining({ code: 'reviewer_missing', coverage: REVIEW_PAIR })]);
    expect(await sessionQueries(world, review.reviewLine!)).toHaveLength(1);
    expect((await listed(world, 'inbox', review.reviewLine!)).filter(fromPlanRound)).toHaveLength(1);
  }, 120_000);

  it('② the report body write fails once at record_review: unavailable + waiting, zero booking, the retry returns', async () => {
    const review = await openS9ReviewWorld(); worlds.push(review); const { world } = review;
    const query = await answerS9Review(review, 'pass'); let attempts = 0;
    const original = RawArtifactBodyStore.prototype.put;
    restores.push(vi.spyOn(RawArtifactBodyStore.prototype, 'put').mockImplementation(async function (this: RawArtifactBodyStore, input: RawArtifactPut) {
      if (input.body !== 'S9 pass report') return await original.call(this, input);
      if (++attempts > 1) return await original.call(this, input);
      throw new Error('the S9 review report body store is unavailable');
    }).mockRestore);
    const before = await roundOfS9(review, query.roundRef); const record = nextOfS9(await advanceS9Review(review));
    expect(opOf(record)).toBe('record_review');
    expect(await advanceS9Review(review, record)).toMatchObject({ status: 'ready', value: { state: 'waiting', receipt: { kind: 'record_review', result: { status: 'rejected', code: 'unavailable' } } } });
    expect(await roundOfS9(review, query.roundRef)).toEqual(before); expect(attempts).toBe(1);
    const retry = nextOfS9(await advanceS9Review(review)); expect(opOf(retry)).toBe('record_review');
    const booked = await advanceS9Review(review, retry);
    expect(booked).toMatchObject({ status: 'ready', value: { state: 'advance', receipt: { kind: 'record_review', result: { status: 'committed' } } } });
    expect(attempts).toBe(2); expect(await roundOfS9(review, query.roundRef)).toMatchObject({ status: 'open', outcome: null });
    expect(await advanceS9Review(review, nextOfS9(booked))).toMatchObject(committedStep('finalize_checks'));
    const refs = (await roundOfS9(review, query.roundRef)).evidenceRefs;
    expect(refs).toHaveLength(2); expect(refs).toContainEqual(bookedRefOf(booked));
  }, 120_000);

  it('③ booked first, then a stale source: the fold gives INCONCLUSIVE + reviewer_stale, not a rejection', async () => {
    const review = await openS9ReviewWorld(); worlds.push(review); const { world } = review;
    const query = await answerS9Review(review, 'pass'); const record = nextOfS9(await advanceS9Review(review));
    expect(opOf(record)).toBe('record_review'); const booked = await advanceS9Review(review, record);
    expect(opOf(nextOfS9(booked))).toBe('finalize_checks');
    await writeFile(join(world.root, 'src', 's9-r5-stale.txt'), 'changed after the review was booked');
    expect(await advanceS9Review(review, nextOfS9(booked))).toMatchObject(committedStep('finalize_checks'));
    const round = await roundOfS9(review, query.roundRef); expect(round).toMatchObject({ status: 'finalized', outcome: 'INCONCLUSIVE' });
    expect(round.gaps.filter(gap => gap.code === 'reviewer_stale')).toEqual([expect.objectContaining({ coverage: REVIEW_PAIR })]);
    expect(round.evidenceRefs).toContainEqual(bookedRefOf(booked));
  }, 120_000);
});

describe('R6: a running subject Run opens nothing', () => {
  it('while the reviewed Run is running, workflow/advance opens no round, starts no review and moves no phase', async () => {
    const review = await openS9ReviewWorld(); worlds.push(review); const { world } = review;
    await world.scripted.script(review.workLine, [{ kind: 'text', text: 'S9 R6 running work' }]);
    const hold = await world.gates.modelRequest(review.workLine);
    const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: review.goal, flowId: 's9-r6-running', sessionHint: review.workLine.ref, kind: 'select_work', taskId: review.task.taskId }, 'claim_task');
    const drive = driveWorkflow(world.ag2b, claim); await hold.reached;
    const before = await roundCards(review); expect(before.items).toEqual([]); expect(await taskPhase(review)).toBe('running');
    const display = await displayOf(review);
    expect(await advanceS9Review(review)).toMatchObject({ status: 'ready', value: { state: 'waiting', receipt: null, next: null } });
    expect(await roundCards(review)).toEqual(before); expect(await taskPhase(review)).toBe('running');
    expect(await displayOf(review)).toEqual(display); hold.release(); await drive;
  }, 120_000);
});

describe('R7: the review line opens after the Host and the round', () => {
  it('the next advance sends execreview:<roundId> on the same open round; no second round, the old round unchanged', async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'none' }); worlds.push(review);
    const round = await openS9ReviewRound({ review }); const before = (await roundCards(review)).items;
    expect(before).toHaveLength(1);
    expect(await advanceS9Review(review)).toMatchObject({ status: 'ready', value: { state: 'waiting', reason: 'no_review_line', receipt: null } });
    await openS9ReviewLine(review.world); const send = nextOfS9(await advanceS9Review(review));
    expect(opOf(send)).toBe('send_system_round');
    if (send.kind !== 'perform' || send.operation.kind !== 'send_system_round'
      || send.operation.request.round.kind !== 'exec_review') {
      throw new Error(`S9: the next step is not an exec_review send: ${JSON.stringify(send)}`);
    }
    expect(send.operation.request.round.roundRef).toEqual(round.roundRef);
    const sent = await advanceS9Review(review, send);
    const messageRef = (sent as { value: { receipt: { result: { value: { ref: SessionMessageRef } } } } }).value.receipt.result.value.ref;
    expect((await readBody(review.world, messageRef, 'message')).split('\n')[0]).toBe(`execreview:${round.roundRef.roundId}`);
    const after = (await roundCards(review)).items;
    expect(after).toHaveLength(1); expect(after[0]!.round).toEqual(before[0]!.round);
  }, 120_000);
});

describe('R9: cold start keeps the sent review round and its Query', () => {
  it('a clean Host restart continues the same round/Query: the original message ref and Query pair, no resend', async () => {
    const review = await openS9ReviewWorld({ backend: 'sqlite' }); worlds.push(review); const { world } = review;
    const query = await answerS9Review(review, 'pass'); const roundRef = query.roundRef;
    const original = systemRoundMessageRef(S6A_SCOPE, `execreview:${roundRef.roundId}`);
    if (original.status !== 'ready') throw new Error('R9: no system round message ref');
    expect(original.value).toEqual(query.messageRef);
    expect(interventionPlanningQueryRefs(query.messageRef)).toEqual({ queryJobRef: query.queryJobRef, queryRunRef: query.queryRunRef });
    await world.reopen(); const kept = systemRoundMessageRef(S6A_SCOPE, `execreview:${roundRef.roundId}`);
    if (kept.status !== 'ready') throw new Error('R9: the system round message ref is gone after the restart');
    expect(kept.value).toEqual(query.messageRef);
    expect(interventionPlanningQueryRefs(kept.value)).toEqual({ queryJobRef: query.queryJobRef, queryRunRef: query.queryRunRef });
    expect((await sessionQueries(world, review.reviewLine!)).map(entry => entry.ref)).toEqual([query.queryRunRef]);
    expect((await roundCards(review)).items.map(item => item.round?.ref)).toEqual([roundRef]);
    const record = nextOfS9(await advanceS9Review(review)); expect(opOf(record)).toBe('record_review');
    if (record.kind !== 'perform' || record.operation.kind !== 'record_review') {
      throw new Error(`S9: the next step is not record_review: ${JSON.stringify(record)}`);
    }
    expect(record.operation.request.input.roundRef).toEqual(roundRef);
    expect(await advanceS9Review(review, record)).toMatchObject(committedStep('record_review'));
    expect((await sessionQueries(world, review.reviewLine!)).map(entry => entry.ref)).toEqual([query.queryRunRef]);
    expect((await listed(world, 'inbox', review.reviewLine!)).filter(fromPlanRound).map(message => message.ref)).toEqual([query.messageRef]);
    expect((await roundCards(review)).items.map(item => item.round?.ref)).toEqual([roundRef]);
  }, 180_000);
});
