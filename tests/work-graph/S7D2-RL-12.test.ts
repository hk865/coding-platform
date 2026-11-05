/**
 * RL-12 (`7d2-start-rulings.v4.md:8850`, read per `later-rows-merged.md:216`; card supplement §2.4 `:135–:145`, wave0
 * 14; book `:1315`, §3.7 item 5 `:549–:556`; write-tests brief `tests-7d2-o4a.txt:58–:79`, o4a rulings 18, 36, 45): an
 * entry whose assignment needs a card keeps its place and reserves no slot, its approval assigns it, a replay assigns
 * nothing twice; and each drain trigger (pause, cancel, completion, archive, Host start) reaches the queue.
 *
 * World: `openS7D2QueueWorld` (tests/helpers/S7D2-queue-world.ts), fixed clock, memory unless named. Common prior
 * (one fresh world per case): advisers A (the opening adviser) and B hold three in-progress `small` goals each and
 * have one unaccepted inquiry each; `open.adviser` is 2; the case's goals are confirmed at that cap.
 *
 * Expected (by hand from the frozen lines): G1 (every-step) is judged a card while the cap is full, so no
 * operation is written and it is queued (revision 11-04 item 15, card supplement §2.1 `:98`); G2 (after-plan) goes
 * through the platform's add, which is refused at the cap and queued; one `role_capacity` card, no `role_line_change`
 * card. After the raise to 3 the drain opens C for G2 and assigns it, then (C a candidate) saves G1's
 * `goal-queue-assign:<G1>` operation as its card (v4 `:4991–:5001`), options card supplement §3.4 `:286–:289`; the
 * approval is that assign (C12 `:85`: `deferred` -> `answered`, closed `source_resolved` `:86`), one `队列分配：` notice
 * (v4 `:4971`); the same `requestId` replays (`B/decision-actions.ts:927–:931`, drill rulings `:1820`).
 * `role-lines/operations` rows carry `action: 'role_line'`; the stored action name is read from `sessions/operation`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { S6A_SCOPE, type S6ABackend } from '../helpers/S6A-request-fixture.js';
import { openS7D2QueueWorld, type S7D2QueueDraft, type S7D2QueueWorld } from '../helpers/S7D2-queue-world.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: S7D2QueueWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

const PROJECT_ID = S6A_SCOPE.projectId;
const queueNotice = (goalId: string, sessionId: string): string =>
  `队列分配：${goalId} → 顾问 ${sessionId}（规则：队列顺序；可重排或调高上限）`;
const sessionOfId = (sessionId: string) => ({ projectId: PROJECT_ID, sessionId });

/** The common prior: the queue world with A, B and the case's drafts, `open.adviser` set to 2. */
async function prior(backend: S6ABackend, label: string, drafts: readonly S7D2QueueDraft[]): Promise<S7D2QueueWorld> {
  const q = await openS7D2QueueWorld({ backend, advisers: true, drafts });
  worlds.push(q);
  await q.setOpen('adviser', 2, `${label}-cap-2`);
  return q;
}

/** The `队列分配：` summaries whose subject is `goal`. */
async function queueNoticesOf(q: S7D2QueueWorld, goal: GoalRef): Promise<string[]> {
  return (await q.notices()).filter(item => item.subject.kind === 'goal' && item.subject.goalRef.goalId === goal.goalId
    && item.summary.startsWith('队列分配：')).map(item => item.summary);
}

async function rowOf(q: S7D2QueueWorld, operationId: string): Promise<RoleLineOperationReadV1 | undefined> {
  return (await q.operations()).find(row => row.operation.operationId === operationId);
}

describe('RL-12 A: the card entry keeps its place and reserves no slot; the approval assigns it once', () => {
  /*
   * Named mutation (v4 `:8850`): the drain assigns an entry that needs a card (G1 leaves the queue for C while its
   * card is open) -> step 1's bounded wait for `entries` exactly `[G1]` with G1's card open never holds and times out;
   * step 2's `entries[0]` G1 and "C holds only G2" would be red.
   */
  it('RL-12 A (memory): cap raise -> G2 assigned, G1 carded -> approve -> replay', async () => {
    const q = await prior('memory', 'rl12-a', [{ name: 'g1', autonomy: 'every_step' },
      { name: 'g2', autonomy: 'after_plan_confirmation' }]);
    const { a, b } = q.advisers!;
    const operationsBefore = (await q.operations()).map(row => row.operation.operationId);
    expect(await q.confirm('g1')).toMatchObject({ status: 'committed' });
    const operationsAfterG1 = (await q.operations()).map(row => row.operation.operationId);
    expect(await q.confirm('g2')).toMatchObject({ status: 'committed' });
    const g1 = q.goalOf('g1');
    const g2 = q.goalOf('g2');
    expect(await q.queueIds()).toEqual([g1.goalId, g2.goalId]);
    expect(await q.cardsOf('role_line_change')).toEqual([]);
    expect(await q.cardsOf('role_capacity')).toHaveLength(1);
    expect(operationsAfterG1).toEqual(operationsBefore);   // G1: carded at the full cap, so no add operation

    // 1. The raise; wait until the queue is [G1], G1's card is there and G2 is on a line that is not A or B (ruling 45).
    const assignId = `goal-queue-assign:${g1.goalId}`;
    const assignCard = async (): Promise<DecisionCardV1 | null> => (await q.cardsOf('role_line_change'))
      .find(card => (JSON.parse(card.source.key) as { operationRef?: { operationId?: string } })
        .operationRef?.operationId === assignId) ?? null;
    await q.setOpen('adviser', 3, 'rl12-a-cap-3');
    const settled = await waitFor(async () => ({ ids: await q.queueIds(), card: await assignCard(),
      onG2: await q.linesOf(g2) }), state => state.ids.length === 1 && state.ids[0] === g1.goalId && state.card !== null
      && state.onG2.length === 1 && state.onG2[0] !== a.ref.sessionId && state.onG2[0] !== b.ref.sessionId,
    'the queue [G1] with its card and G2 on a new line');

    // 2. G2 on C; one role_line_change card, subject G1; the waiting operation; C holds only G2; no reservation.
    const c = settled.onG2[0]!;
    const cards = await q.cardsOf('role_line_change');
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.subject).toEqual({ kind: 'goal', goalRef: g1 });
    const operationRef = { aggregateType: 'CoreOperation' as const, projectId: PROJECT_ID, operationId: assignId };
    expect(JSON.parse(card.source.key)).toEqual({ kind: 'role_line_change', operationRef });
    expect(card.options).toEqual([
      { id: 'approve', label: '执行：分给现在有空的参谋', effect: 'apply' },
      { id: 'reject', label: '不执行：留在队里，等你手动分配', effect: 'apply' },
    ]);
    expect(await rowOf(q, assignId)).toMatchObject({ phase: 'accepted', actionPhase: 'waiting',
      result: { status: 'waiting', reason: null } });
    expect(await q.operation(operationRef)).toMatchObject({ action: { action: 'goal_queue_assign' } });
    expect(await q.goalsOf(sessionOfId(c))).toEqual([g2.goalId]);
    expect((await q.allocation()).duties.adviser.reservations).toEqual([]);
    expect((await q.queueIds())[0]).toBe(g1.goalId);

    // 3. The approval is the assign.
    expect(await q.answer(card, 'approve', 'rl12-approve')).toMatchObject({ status: 'ready',
      value: { state: 'answered', action: null, application: null } });
    expect(await q.queueIds()).toEqual([]);
    expect(await q.goalsOf(sessionOfId(c))).toEqual([g1.goalId, g2.goalId].sort());
    expect(await rowOf(q, assignId)).toMatchObject({ phase: 'completed', actionPhase: 'done',
      result: { status: 'done', reason: null } });
    expect(await q.card(card.source)).toMatchObject({ state: 'answered_no_application',
      closedReason: 'source_resolved' });
    expect(await waitFor(() => queueNoticesOf(q, g1), notices => notices.length > 0, 'G1\'s queue notice'))
      .toEqual([queueNotice(g1.goalId, c)]);

    // 4. The same requestId and body again: the answer replays and nothing is assigned twice.
    const revision = (await q.queue()).revision;
    expect(await q.answer(card, 'approve', 'rl12-approve')).toMatchObject({ status: 'ready',
      value: { state: 'answered', action: null, application: null, answer: { status: 'committed', replayed: true } } });
    expect(await q.goalsOf(sessionOfId(c))).toEqual([g1.goalId, g2.goalId].sort());
    expect(await waitFor(() => queueNoticesOf(q, g1), notices => notices.length > 0,
      'G1\'s queue notice after the replay')).toEqual([queueNotice(g1.goalId, c)]);
    expect((await q.queue()).revision).toBe(revision);
  }, 300_000);
});

/** One trigger cell (o4a rulings 18, 36): its own preparation, trigger and result on the common prior plus Gx. */
type Cell = {
  name: string;
  backend: S6ABackend;
  /* The named mutation of the cell is written beside its row below. */
  run(q: S7D2QueueWorld, gx: GoalRef): Promise<void>;
};

const untilOn = (q: S7D2QueueWorld, gx: GoalRef, holds: (lines: string[]) => boolean, what: string) =>
  waitFor(() => q.linesOf(gx), holds, what);

const CELLS: Cell[] = [
  /*
   * B. Named mutation: the candidate comparison counts B's paused goals toward 3 -> Gx is never B's: the bounded wait
   * for `linesOf(Gx)` = [B] times out, red.
   */
  { name: 'B pause/resume', backend: 'memory', async run(q, gx) {
    const { b, goals } = q.advisers!;
    for (const [index, goal] of goals.b.entries()) await q.plan(goal, `rl12-b-${String(index)}`);
    for (const goal of goals.b) await q.pause(goal);
    // Paused goals neither count nor compare (v4 :4773–:4774): B holds no active goal, so Gx is B's (:4804).
    await untilOn(q, gx, lines => lines.length === 1 && lines[0] === b.ref.sessionId, 'Gx to be assigned to B');
    for (const goal of goals.b) await q.resume(goal);
    // Resumed goals stay with B (book :555–:556), which may exceed 3: four open links, the old three never closed.
    expect(await q.goalsOf(b)).toEqual([...goals.b.map(goal => goal.goalId), gx.goalId].sort());
    const old = new Set(goals.b.map(goal => goal.goalId));
    expect((await q.readCard(b)).links.filter(link => link.ref.relation === 'responsible'
      && link.ref.target.kind === 'goal' && old.has(link.ref.target.ref.goalId)).map(link => link.until))
      .toEqual([null, null, null]);
  } },
  /*
   * C. Named mutation: the drain still allocates a cancelled goal -> with no room Gx stays queued, so the bounded wait
   * for Gx to leave `entries` times out (with room it would get a link: the `linesOf(Gx)` = [] assertion), red.
   */
  { name: 'C cancel', backend: 'memory', async run(q, gx) {
    await q.plan(gx, 'rl12-c');
    const rows = (await q.operations()).length;
    await q.cancel(gx);
    await waitFor(() => q.queueIds(), ids => !ids.includes(gx.goalId), 'the cancelled Gx to leave the queue');
    expect(await q.linesOf(gx)).toEqual([]);
    expect(await q.operations()).toHaveLength(rows);   // a queue-only commit (v4 :4976)
  } },
  /*
   * D. Named mutation: `'GoalPhase'` is not on the lifecycle wake list -> the completion wakes no drain and Gx stays
   * queued: the bounded wait for `linesOf(Gx)` = [A] times out, red.
   */
  { name: 'D formal completion', backend: 'memory', async run(q, gx) {
    const { a, goals } = q.advisers!;
    const done = goals.a[0]!;
    await q.plan(done, 'rl12-d');
    await q.complete(done, 'rl12-d');
    // A keeps two in-progress small goals and Gx is small (v4 :4805; a completed goal no longer counts, O4a-08).
    await untilOn(q, gx, lines => lines.length === 1 && lines[0] === a.ref.sessionId, 'Gx to be assigned to A');
  } },
  /*
   * E. Named mutation: the drain only tries candidates and no longer adds a line -> Gx stays queued: the bounded wait
   * for a new line on Gx times out, red.
   */
  { name: 'E archive', backend: 'memory', async run(q, gx) {
    const { a, b, inquiries } = q.advisers!;
    await q.withdraw(inquiries.b, 'rl12-e-b');
    await q.archive(b, 'rl12-e');
    // B's seat is free, A is full: the platform adds a line and assigns Gx to it.
    const lines = await untilOn(q, gx, on => on.length === 1, 'Gx to get a line');
    expect([a.ref.sessionId, b.ref.sessionId]).not.toContain(lines[0]);
  } },
  /*
   * F. Named mutation: Host start runs no lifecycle pass (only a later commit would wake it) -> Gx stays queued: the
   * bounded wait for Gx's link times out, red.
   */
  { name: 'F Host start', backend: 'sqlite', async run(q, gx) {
    await q.world.reopen({ extraHostOptions: { requestDriver: 'off', scribeReminderPeriodMs: 25 } });
    await q.setOpen('adviser', 3, 'rl12-f-cap-3');
    expect(await q.queueIds()).toContain(gx.goalId);
    await q.world.reopen({ extraHostOptions: { requestDriver: 'on', scribeReminderPeriodMs: 25 } });
    const lines = await untilOn(q, gx, on => on.length === 1, 'the start-up drain to assign Gx');
    expect(await q.queueIds()).not.toContain(gx.goalId);
    expect(await waitFor(() => queueNoticesOf(q, gx), notices => notices.length > 0, 'Gx\'s notice'))
      .toEqual([queueNotice(gx.goalId, lines[0]!)]);
  } },
];

describe('RL-12 B–F: each drain trigger reaches the queue', () => {
  it.each(CELLS)('RL-12 $name ($backend): Gx queued at the cap, then the trigger assigns or drops it',
    async ({ name, backend, run }) => {
      const label = `rl12-${name.split(' ')[0]!.toLowerCase()}`;
      const q = await prior(backend, label, [{ name: 'gx', autonomy: 'after_plan_confirmation' }]);
      expect(await q.confirm('gx')).toMatchObject({ status: 'committed' });
      const gx = q.goalOf('gx');
      expect(await q.queueIds()).toContain(gx.goalId);
      await run(q, gx);
    }, 300_000);
});
