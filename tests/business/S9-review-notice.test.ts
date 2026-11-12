/**
 * W3-notice, W8 (an interrupted check, no line; SQLite only, the interruption is a Host restart) — slice 9 G3.
 * Named mutations: W3 `position` taken from the open-round commit in the command-check variant (red at
 * `position.cursor === C`); W8 the interrupted check's position read failing the whole read (red at the `plan_notice`
 * capability / the notice).
 * Today (no G3) red at: the notice list is `[]` (W3 both variants, W8); W3's fault row keeps `plan_notice` `available`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import { compareCursors } from '../../src/contracts/ledger.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../src/contracts/verification.js';
import type { DecisionQueueReadV1, NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import {
  SESSION_BY_PROJECT_LOOKUP, SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil } from '../helpers/IV-host-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  advanceS9Review, openS9ReviewLine, openS9ReviewRound, openS9ReviewWorld, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryLookupBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { commitBarrier.reset(); for (const world of worlds.splice(0)) await world.close(); });

const noticeQueue = async (review: S9ReviewWorld): Promise<DecisionQueueReadV1> => ready<DecisionQueueReadV1>(
  await review.world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE, sections: ['notices'],
    categories: ['plan_notice'], page: { limit: 100 } })), 'the decision queue');
const noLine = (read: DecisionQueueReadV1): NoticeItemV1[] =>
  read.notices.filter(item => item.itemKey.startsWith('exec-review-no-line:'));
/** The round card page (`graph/look`); its `readThrough` is the ledger cursor it was read at. */
const roundCard = async (review: S9ReviewWorld, ref: VerificationRoundRef) =>
  ready<{ readThrough: CommitCursor; items: { round: RoundSnapshot }[] }>(await review.world.post('graph/look',
    plain(S6A_SCOPE, { goalRef: review.goal, target: { kind: 'node', node: { kind: 'round', ref } }, relation: 'card',
      page: { afterCursor: null, limit: 1 } })), 'the round card');

describe('W3-notice: exec-review-no-line', () => {
  it.each(['command', 'none'] as const)('one item at the right commit (%s checks), no duplicate, gone with a line',
    async (checks) => {
      const review = await openS9ReviewWorld({ reviewLine: 'none', checks });
      worlds.push(review);
      const { world, goal } = review;
      const opened = await openS9ReviewRound({ review, stopBefore: 'run_check' });
      const atOpen = await noticeQueue(review);
      if (opened.next?.kind === 'perform' && opened.next.operation.kind === 'run_check') {
        await driveWorkflow(world.ag2b, opened.next, { stopBefore: op =>
          op.kind === 'finalize_checks' || op.kind === 'send_system_round' });
      }
      const cursor = (await roundCard(review, opened.roundRef)).readThrough;
      if (checks === 'command') expect(compareCursors(cursor, atOpen.sourceCursor)).toBeGreaterThan(0);
      const itemKey = `exec-review-no-line:${goal.goalId}:${opened.roundRef.roundId}`;
      for (const read of [await noticeQueue(review), await noticeQueue(review)]) {
        expect(noLine(read)).toEqual([expect.objectContaining({ itemKey, category: 'plan_notice',
          subject: { kind: 'goal', goalRef: goal }, position: { kind: 'commit', cursor, itemKey }, objects: [],
          rework: null })]);
        for (const part of ['s9-work', 'S9 reviewed work', '没有审阅线', 'role-lines/open']) {
          expect(noLine(read)[0]?.summary).toContain(part);
        }
      }
      const main = ready<{ notices: { itemKey: string }[] }>(await world.post('main/read', {
        scope: { ...S6A_SCOPE }, input: { goalId: goal.goalId, cursor: null } }), 'main/read');
      expect(main.notices.filter(item => item.itemKey === itemKey)).toHaveLength(1);
      await openS9ReviewLine(world);
      expect(noLine(await noticeQueue(review))).toEqual([]);
      const selected = await advanceS9Review(review);
      expect(selected).toMatchObject({ status: 'ready', value: { next: { operation: { kind: 'send_system_round',
        request: { round: { kind: 'exec_review', roundRef: opened.roundRef } } } } } });
    }, 120_000);

  it('a failed line read makes plan_notice unavailable, never "no line"', async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'none' });
    worlds.push(review);
    await openS9ReviewRound({ review });
    const faults = [commitBarrier.failReads(SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP, 'throw-always'),
      commitBarrier.failReads(SESSION_BY_PROJECT_LOOKUP, 'throw-always')];
    const read = await noticeQueue(review);
    for (const fault of faults) fault.release();
    expect(read.capabilities.find(entry => entry.source === 'plan_notice')?.availability).toBe('not_available');
    expect(noLine(read)).toEqual([]);
  }, 120_000);

  it('W8: the only check interrupted by a restart → one item at the open-round commit; the queue reads', async () => {
    const review = await openS9ReviewWorld({ backend: 'sqlite', reviewLine: 'none' });
    worlds.push(review);
    const { world, goal } = review;
    const opened = await openS9ReviewRound({ review, stopBefore: 'run_check' });
    const since = (await roundCard(review, opened.roundRef)).readThrough;
    const held = commitBarrier.hold(byIdentityPrefix('r3e-record:'));
    const running = advanceS9Review(review, opened.next!).catch(() => null);
    await held.reached;
    await world.crash();
    const interrupted = await heartbeatUntil(world, () => roundCard(review, opened.roundRef),
      card => card.items[0]?.round.checks.every(check => check.phase === 'interrupted') === true, 16);
    expect(interrupted.items[0]?.round.checks.map(check => check.phase)).toEqual(['interrupted']);
    const read = await noticeQueue(review);
    expect(read.capabilities.find(entry => entry.source === 'plan_notice')?.availability).toBe('available');
    const itemKey = `exec-review-no-line:${goal.goalId}:${opened.roundRef.roundId}`;
    expect(noLine(read)).toEqual([expect.objectContaining({ itemKey,
      position: { kind: 'commit', cursor: since, itemKey } })]);
    void running;
  }, 180_000);
});
