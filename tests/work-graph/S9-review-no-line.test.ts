/**
 * S9 G5 — the no-review-line notice row (slice-9 SPEC §3.7; rulings 9-start §1 G5). Shared S9 world; SQLite only (Host restart).
 * S1: W3/W8 (tests/business/S9-review-notice.test.ts:46-110) already pin the one `exec-review-no-line` item at the
 * finished check's commit, the second read and the interrupted-check position; this row adds the read-watermark
 * timing (no item before the check ends), the position after that watermark, the retry/reread/Host-restart dedupe and
 * the same-round send after `role-lines/open`. It does not check whether the item is retained once the line exists.
 * Named mutations: the notice kept out of the queue (a Session notify/new record) → red at the one-item read; a
 * second item on the retry/re-read → red at the same read; `position` taken from `since` → red at the cursor; a new
 * round after the line is created → red at the waiting/same-round send. Today: green today; gap: none.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import { compareCursors } from '../../src/contracts/ledger.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../src/contracts/verification.js';
import type { DecisionQueueReadV1, NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  advanceS9Review, openS9ReviewLine, openS9ReviewRound, openS9ReviewWorld, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

const noticeQueue = async (review: S9ReviewWorld): Promise<DecisionQueueReadV1> => ready<DecisionQueueReadV1>(
  await review.world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE, sections: ['notices'],
    categories: ['plan_notice'], page: { limit: 100 } })), 'the decision queue');
const noLine = (read: DecisionQueueReadV1): NoticeItemV1[] =>
  read.notices.filter(item => item.itemKey.startsWith('exec-review-no-line:'));
const mainNoticesOfS9 = async (review: S9ReviewWorld) => ready<{ notices: { itemKey: string }[] }>(
  await review.world.post('main/read', { scope: { ...S6A_SCOPE }, input: { goalId: review.goal.goalId, cursor: null } }),
  'main/read');
const roundCard = async (review: S9ReviewWorld, ref: VerificationRoundRef) =>
  ready<{ readThrough: CommitCursor; items: { round: RoundSnapshot }[] }>(await review.world.post('graph/look',
    plain(S6A_SCOPE, { goalRef: review.goal, target: { kind: 'node', node: { kind: 'round', ref } }, relation: 'card',
      page: { afterCursor: null, limit: 1 } })), 'the round card');

describe('R11: no review line, the check-cursor notice and its dedupe', () => {
  it('one plan_notice after the check cursor, no duplicate across a retry/restart, then the same round continues', async () => {
    const review = await openS9ReviewWorld({ backend: 'sqlite', reviewLine: 'none', checks: 'command' });
    worlds.push(review);
    const { world, goal } = review;
    const opened = await openS9ReviewRound({ review, stopBefore: 'run_check' });
    const atOpen = await noticeQueue(review);
    expect(noLine(atOpen)).toEqual([]);
    if (opened.next?.kind !== 'perform' || opened.next.operation.kind !== 'run_check') {
      throw new Error(`R11: the round did not stop before the command check: ${JSON.stringify(opened.next)}`);
    }
    await driveWorkflow(world.ag2b, opened.next,
      { stopBefore: op => op.kind === 'finalize_checks' || op.kind === 'send_system_round' });
    const cursor = (await roundCard(review, opened.roundRef)).readThrough;
    expect(compareCursors(cursor, atOpen.sourceCursor)).toBeGreaterThan(0);
    const waiting = { status: 'ready', value: { state: 'waiting', reason: 'no_review_line', receipt: null } };
    expect(await advanceS9Review(review)).toMatchObject(waiting);
    const itemKey = `exec-review-no-line:${goal.goalId}:${opened.roundRef.roundId}`;
    const first = await noticeQueue(review);
    expect(noLine(first)).toEqual([expect.objectContaining({ itemKey, category: 'plan_notice',
      subject: { kind: 'goal', goalRef: goal }, position: { kind: 'commit', cursor, itemKey }, objects: [], rework: null })]);
    for (const part of ['s9-work', 'S9 reviewed work', '没有审阅线', 'role-lines/open']) {
      expect(noLine(first)[0]?.summary).toContain(part);
    }
    expect((await mainNoticesOfS9(review)).notices.filter(item => item.itemKey === itemKey)).toHaveLength(1);
    expect(await advanceS9Review(review)).toMatchObject(waiting);
    expect(noLine(await noticeQueue(review))).toEqual(noLine(first));
    await world.reopen();
    expect(noLine(await noticeQueue(review))).toEqual(noLine(first));
    expect((await mainNoticesOfS9(review)).notices.filter(item => item.itemKey === itemKey)).toHaveLength(1);
    expect(await advanceS9Review(review)).toMatchObject(waiting);
    expect((await roundCard(review, opened.roundRef)).items.map(item => item.round.ref)).toEqual([opened.roundRef]);
    await openS9ReviewLine(world);
    expect(await advanceS9Review(review)).toMatchObject({ status: 'ready', value: { next: { operation: {
      kind: 'send_system_round', request: { round: { kind: 'exec_review', roundRef: opened.roundRef } } } } } });
    expect((await roundCard(review, opened.roundRef)).items.map(item => item.round.ref)).toEqual([opened.roundRef]);
  }, 120_000);
});
