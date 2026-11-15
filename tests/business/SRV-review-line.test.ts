/**
 * SRV-1, rows V1–V3 (SRV rulings "测试行" and supplements T1–T3): an exec review the Plan requires (the S9 world's
 * required `kind:'reviewer'` item) in a project with no reviewer line. The Workflow opens one itself on the advance
 * that reaches the review (platform identity, duty reviewer, project scope, one command identity per project) and
 * then sends the review to it; a refused open keeps the old wait, now `no_review_line: <refusal text verbatim>` (T3),
 * and the old `exec-review-no-line:` notice. Shared S9 world (`reviewLine: 'none'`); reads only through
 * `role-lines/read`, `role-lines/operations`, `decisions/queue` and `workflow/advance`.
 * - V1 (memory). Mutation: the automatic open removed (back to waiting only) → red at the one reviewer row.
 * - V2 (memory; T1: the refusal is the executor seat cap — the Work line holds the one seat `open.executor: 1`
 *   leaves, a reviewer takes an executor seat). Mutations: the refusal swallowed (the reason without the text) → red
 *   at `toContain(refusalText)`; a new command identity per call (T2) → red at the one reviewer open operation.
 * - V3 (SQLite only: a Host restart, rule sheet A2's crash fixture). The open is committed and its line is held at
 *   the Session registration commit when the Host stops; the next Host advances and sends. Mutation: the command
 *   identity changes with the Host (a per-start value) → the next Host opens a second operation → red at the one
 *   reviewer open operation.
 * - V5 (memory; review ruling R1): the auto-opened line archived (`sessions/archive`) before the review is sent, the
 *   next advance opens a new line (identity derived from the archived Session) and the review goes to it. Mutation:
 *   the fixed per-project identity kept → the open replays the archived line, no new line → red at the one row.
 * Today (no SRV) all four are red: V1 and V5 at the one reviewer row (`[]`: the drive only waits `no_review_line`);
 * V2 at `toContain(refusalText)` (the reason is the bare `no_review_line`); V3 at `'held'` (no line is registered, the
 * drive returns first). They turn green when the Workflow's review arm opens the line through the composition root's
 * port and carries the refusal into the reason.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RoleLineReadResultV1 } from '../../src/core/work-graph/views/role-line-read.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { archiveS7D1Session, readS7D1Limits, setS7D1Open } from '../helpers/S7D1-allocation-world.js';
import { readS7D2Operations } from '../helpers/S7D2-role-line-world.js';
import {
  advanceS9Review, openS9ReviewRound, openS9ReviewWorld, type S9ReviewRound, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { commitBarrier.reset(); for (const world of worlds.splice(0)) await world.close(); });

/** Hand-worked from the admission's at-cap sentence: 1 holder (the Work line), 0 reservations, open limit 1. */
const refusalText = 'at_cap: executor has 1 holder(s) and 0 reservation(s) against open limit 1';

/** The rows of duty `reviewer` the person's line view (`role-lines/read`) shows in the main workspace. */
const reviewerLines = async (review: S9ReviewWorld): Promise<SessionRef[]> => ready<RoleLineReadResultV1>(
  await review.world.post('role-lines/read', plain(S6A_SCOPE, { workspace: { ...S6A_SCOPE } })), 'role-lines/read')
  .rows.filter(entry => entry.row.duty === 'reviewer').map(entry => entry.row.key);
/** The role-line operations (`role-lines/operations`) whose one step opens a reviewer line. */
const reviewerOpens = async (review: S9ReviewWorld) => (await readS7D2Operations(review.world))
  .filter(row => row.action === 'role_line' && row.steps.some(step => step.key === 'reviewer'));

/** The selection names the exec review send of `round` to `line`; then the send is performed and lands there. */
async function sendsTo(review: S9ReviewWorld, round: S9ReviewRound, line: SessionRef | undefined): Promise<void> {
  const selected = await advanceS9Review(review);
  expect(selected).toMatchObject({ status: 'ready', value: { state: 'advance', next: { operation: {
    kind: 'send_system_round', request: { round: { kind: 'exec_review', roundRef: round.roundRef },
      recipient: line } } } } });
  const send = (selected as Extract<WorkflowAdvanceResult, { status: 'ready' }>).value.next as WorkflowAdvanceInput;
  expect(await advanceS9Review(review, send)).toMatchObject({ status: 'ready', value: {
    receipt: { kind: 'send_system_round', result: { status: 'committed', value: { recipient: line } } } } });
}

describe('SRV-1: no reviewer line in the project when the exec review is due', () => {
  it('V1: the advance opens one reviewer line, the review goes to it, a re-advance opens no second', async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'none' });
    worlds.push(review);
    const round = await openS9ReviewRound({ review });
    const lines = await reviewerLines(review);
    expect(lines).toHaveLength(1);
    await sendsTo(review, round, lines[0]);
    await advanceS9Review(review);
    expect(await reviewerLines(review)).toEqual(lines);
  }, 120_000);

  it('V2: a refused open waits no_review_line with the refusal text, opens nothing, keeps the notice', async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'none' });
    worlds.push(review);
    await setS7D1Open(review.world, 'executor', 1, (await readS7D1Limits(review.world)).revision, 'srv-v2-cap');
    const round = await openS9ReviewRound({ review });
    for (const pass of [1, 2]) {
      const waited = await advanceS9Review(review);
      expect(waited, `advance ${String(pass)}`).toMatchObject({ status: 'ready', value: { state: 'waiting',
        receipt: null, next: null, waitBasis: { reasons: ['no_review_line'] } } });
      const reason = (waited as Extract<WorkflowAdvanceResult, { status: 'ready' }>).value.reason ?? '';
      expect(reason.startsWith('no_review_line')).toBe(true);
      expect(reason).toContain(refusalText);
    }
    expect(await reviewerLines(review)).toEqual([]);
    expect(await reviewerOpens(review)).toHaveLength(1);
    const queue = ready<DecisionQueueReadV1>(await review.world.post('decisions/queue', plain(S6A_SCOPE, {
      workspace: S6A_SCOPE, sections: ['notices'], categories: ['plan_notice'], page: { limit: 100 } })), 'the queue');
    expect(queue.notices.map(item => item.itemKey).filter(key => key.startsWith('exec-review-no-line:')))
      .toEqual([`exec-review-no-line:${review.goal.goalId}:${round.roundRef.roundId}`]);
  }, 120_000);

  it('V3 (SQLite only, a Host restart): open committed, line unregistered; one line, the review sent', async () => {
    const review = await openS9ReviewWorld({ backend: 'sqlite', reviewLine: 'none' });
    worlds.push(review);
    const round = await openS9ReviewRound({ review, stopBefore: 'run_check' });
    const held = commitBarrier.hold(byIdentityPrefix('session-register:'));
    const running = driveWorkflow(review.world.ag2b, round.next!, { stopBefore: op =>
      op.kind === 'send_system_round' || op.kind === 'finalize_checks' }).catch(() => null);
    expect(await Promise.race([held.reached.then(() => 'held'), running.then(() => 'returned')])).toBe('held');
    await review.world.crash();
    await advanceS9Review(review);
    const lines = await reviewerLines(review);
    expect(lines).toHaveLength(1);
    await sendsTo(review, round, lines[0]);
    expect(await reviewerOpens(review)).toHaveLength(1);
    expect(await reviewerLines(review)).toEqual(lines);
  }, 180_000);

  it('V5 (R1): the auto-opened line archived; the next advance opens a new line that gets the review', async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'none' });
    worlds.push(review);
    const round = await openS9ReviewRound({ review });
    const archived = await reviewerLines(review);
    expect(archived).toHaveLength(1);
    await archiveS7D1Session(review.world, archived[0]!, 'SRV V5: the auto-opened reviewer line retired');
    expect(await reviewerLines(review)).toEqual([]);
    await advanceS9Review(review);
    const lines = await reviewerLines(review);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.sessionId).not.toBe(archived[0]!.sessionId);
    await sendsTo(review, round, lines[0]);
  }, 120_000);
});
