/**
 * RL-04 (`7d2-start-rulings.v4.md:8842`, read per `later-rows-merged.md:197` and card supplement T4 `:353–:355`; book
 * `:1307`, §3.7 `:526–:561`; write-tests brief `tests-7d2-o4a.txt:44–:56`): at the open cap the platform queues two
 * confirmed goals in order and opens one capacity card; raising the cap wakes the lifecycle drain, which opens one
 * new adviser line C and assigns both goals to it.
 *
 * World: `openS7D2QueueWorld` (tests/helpers/S7D2-queue-world.ts), memory, fixed clock. Prior: advisers A (the
 * opening adviser) and B hold three in-progress `small` goals each, each with one unaccepted inquiry; G7, G8 are
 * after-plan drafts with screening `small`, `suggestedPosition: null`; `open.adviser` set to 2 (A and B).
 *
 * Expected (by hand from the frozen lines): `entries` G7 then G8 (null positions append, book `:535`, `:539`); one
 * `role_capacity` card of episode 1 (G7's add at the cap opens it, G8's sees it open, v4 `:3409–:3413`); no
 * `role_line_change` card (after-plan goals are `automatic_notice`); after the raise A/B/C hold 3/3/2 (C is opened for
 * G7 and then takes G8 as a candidate, both small, v4 `:4805`); notices (card supplement T4, C5, C13 `:88–:90`): G7's
 * subject has one `开线：` line (count and subject only) and its `队列分配：` line, G8's subject its `队列分配：` line, the
 * project subject none; the `队列分配：` literal is v4 `:4971`/`:5187`. The six prior goals' notices are not counted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DecisionSubjectV1 } from '../../src/contracts/goal-decisions.js';
import type { NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7D2QueueWorld, type S7D2QueueWorld } from '../helpers/S7D2-queue-world.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: S7D2QueueWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

const PROJECT_ID = S6A_SCOPE.projectId;
const queueNotice = (goalId: string, sessionId: string): string =>
  `队列分配：${goalId} → 顾问 ${sessionId}（规则：队列顺序；可重排或调高上限）`;
const subjectKey = (subject: DecisionSubjectV1): string =>
  subject.kind === 'goal' ? `goal:${subject.goalRef.goalId}` : subject.kind;
/** The `开线：`/`队列分配：` summaries of one subject key, in notice order. */
const lineNotices = (items: readonly NoticeItemV1[], key: string): string[] => items
  .filter(item => subjectKey(item.subject) === key
    && (item.summary.startsWith('开线：') || item.summary.startsWith('队列分配：')))
  .map(item => item.summary);

describe('RL-04: queued at the cap, a cap raise opens a line and assigns in queue order', () => {
  /*
   * Named mutation (O4a-11, draft `:141`; X-20 carried by this row): drop `'ProjectRoleLimits'` from the lifecycle
   * wake list (`src/app/wake-loop.ts:64–:67`) -> the cap raise wakes no drain: step 4's bounded poll of
   * `goals/adviser-queue` times out with `entries` still `[G7, G8]`, red.
   */
  it('RL-04 (memory): G7, G8 queue in order with one capacity card; after the raise C holds both, 3/3/2', async () => {
    const q = await openS7D2QueueWorld({ backend: 'memory', advisers: true, drafts: [
      { name: 'g7', autonomy: 'after_plan_confirmation' }, { name: 'g8', autonomy: 'after_plan_confirmation' }] });
    worlds.push(q);
    const { a, b } = q.advisers!;
    await q.setOpen('adviser', 2, 'rl04-cap-2');
    const before = (await q.allocation()).duties.adviser;
    expect([before.holders.length, before.reservations.length]).toEqual([2, 0]);

    // 1. Both confirmations commit (TS-19: the confirm itself still succeeds, drill rulings :1357; K13).
    expect(await q.confirm('g7')).toMatchObject({ status: 'committed' });
    expect(await q.confirm('g8')).toMatchObject({ status: 'committed' });
    const g7 = q.goalOf('g7');
    const g8 = q.goalOf('g8');

    // 2. The queue, in confirmation order.
    const queued = await q.queue();
    expect(queued.entries.map(entry => entry.goalRef.goalId)).toEqual([g7.goalId, g8.goalId]);
    expect(queued.entries.map(entry => entry.screening?.size)).toEqual(['small', 'small']);

    // 3. One capacity card of episode 1; no role_line_change card.
    const capacity = await q.cardsOf('role_capacity');
    expect(capacity).toHaveLength(1);
    expect(capacity[0]!.subject).toEqual({ kind: 'project', projectRef: { projectId: PROJECT_ID } });
    expect(JSON.parse(capacity[0]!.source.key)).toEqual({ kind: 'role_capacity', duty: 'adviser', capValue: 2,
      episode: 1 });
    expect(await q.cardsOf('role_line_change')).toEqual([]);

    // 4. The cap raise wakes the lifecycle pass, whose drain assigns (v4 :6559–:6563).
    await q.setOpen('adviser', 3, 'rl04-cap-3');
    await waitFor(() => q.queueIds(), ids => ids.length === 0, 'the queue to drain after the cap raise');

    // 5. One new line C holds G7 and G8; A/B/C 3/3/2; three holders, no reservation.
    const onG7 = await q.linesOf(g7);
    expect(onG7).toHaveLength(1);
    expect(await q.linesOf(g8)).toEqual(onG7);
    const c = onG7[0]!;
    expect([a.ref.sessionId, b.ref.sessionId]).not.toContain(c);
    expect([(await q.goalsOf(a)).length, (await q.goalsOf(b)).length,
      (await q.goalsOf({ projectId: PROJECT_ID, sessionId: c })).length]).toEqual([3, 3, 2]);
    const after = (await q.allocation()).duties.adviser;
    expect([after.holders.length, after.reservations.length]).toEqual([3, 0]);

    // 6. The notices by subject (each is written after its own commit, so wait until G8's line is there).
    const notices = await waitFor(() => q.notices(), items => lineNotices(items, `goal:${g8.goalId}`).length > 0
      && lineNotices(items, `goal:${g7.goalId}`).length > 1, 'the G7 and G8 notices');
    const ofG7 = lineNotices(notices, `goal:${g7.goalId}`);
    expect(ofG7).toHaveLength(2);
    expect(ofG7.filter(summary => summary.startsWith('开线：'))).toHaveLength(1);
    expect(ofG7.filter(summary => summary.startsWith('队列分配：'))).toEqual([queueNotice(g7.goalId, c)]);
    expect(lineNotices(notices, `goal:${g8.goalId}`)).toEqual([queueNotice(g8.goalId, c)]);
    expect(lineNotices(notices, 'project')).toEqual([]);
  }, 300_000);
});
