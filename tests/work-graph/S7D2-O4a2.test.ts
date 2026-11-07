/**
 * O4a-2 (`7d2-o4a2` frozen write-tests brief §0 B1–B5 and §2 R1–R4; o5b start ruling 25,
 * `impl/s7d2/o5b-start-rulings.md:40`; card supplement `:78`, `:98–:99`, `:103–:107`, `:137`): a goal assigned to an
 * adviser ends, in the same commit, every line-add operation of it that has not started a line (B1), and every
 * waiting card the assignment displaces (B2); the next platform opening of that goal is a NEW line-add operation
 * (B3), and the displaced card reads `closed`/`source_resolved` (B4). No notice is asserted (B5).
 *
 * World (each describe opens its own): `openS7D2QueueWorld` (tests/helpers/S7D2-queue-world.ts:123), memory, fixed
 * clock; advisers A and B hold three in-progress `small` goals each and one unaccepted person inquiry each. R1/R2
 * share one world; R3 and R4 open their own. Writes: `q.setOpen`, `q.confirm` and the person's
 * `goals/adviser-queue/assign`; reads: `q.queueIds`, `q.linesOf`, `q.operations`, `q.operation`, `q.decisions`,
 * `q.card`, `q.allocation`.
 *
 * Expected (by hand from B1–B4): at cap 2 the after-plan goal G is queued and its add is `accepted`/`waiting` with
 * `result: null` and one pending step (card supplement `:78`, `:98`); the person's assign to B commits, puts G on B
 * and ends that add `failed`/`{failed, goal_assigned}` with its step failed and no child (B1). After B is archived,
 * the retried confirm makes the platform open a NEW add (B3): a second operation id, `completed`/`done` with a child
 * on its done step. An every-step goal waits on its add card (card supplement `:99`, options `:103–:107`); the
 * person's assign ends it `goal_assigned` and closes the card `source_resolved` (B2, B4); after B is archived the
 * platform's next opening is another card on another operation id (B3). A waiting queue-assign card's operation ends
 * the same way, every step failed and nothing else changed (B2, B4).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { addRowsOf, openS7D2QueueWorld, type S7D2QueueWorld } from '../helpers/S7D2-queue-world.js';
import { waitFor } from '../scenarios/harness.js';

const pairOf = (line: S6ASession): SessionRef => ({ projectId: line.ref.projectId, sessionId: line.ref.sessionId });

/** The `role_line` arm of the operations read (a row carries the stored action's `steps`). */
type RoleLineRow = Extract<RoleLineOperationReadV1, { action: 'role_line' }>;

describe('O4a-2 R1/R2: a queued line add ends on the person\'s assign; the next opening is a new operation', () => {
  let q: S7D2QueueWorld | null = null;
  afterAll(async () => { await q?.close(); });
  const world = (): S7D2QueueWorld => {
    if (q === null) throw new Error('O4a-2 R1/R2: the first row did not open the world');
    return q;
  };

  /*
   * Named mutation M1 (brief §2 R1): the person's assign closes a line add only while
   * `result.status === 'waiting'` (`src/core/work-graph/tasks/goal-adviser-queue-service.ts:401`, O4a's shape) -> the
   * queued add (`result: null`) stays `accepted`/`waiting`: step 5's first `toMatchObject` (`phase: 'failed'`) is
   * red, and so is the operation read after it.
   */
  it('R1 (memory): the queued add ends failed goal_assigned in the assign commit', async () => {
    q = await openS7D2QueueWorld({ backend: 'memory', advisers: true,
      drafts: [{ name: 'g', autonomy: 'after_plan_confirmation' }] });

    // 1. The cap is A and B.
    await q.setOpen('adviser', 2, 'o4a2-r1-cap-2');
    expect((await q.allocation()).duties.adviser.holders.length).toBe(2);

    // 2. G is confirmed and waits in the queue.
    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    const goal = q.goalOf('g');
    expect(await q.queueIds()).toEqual([goal.goalId]);

    // 3. Its one add is accepted, waiting, with no result and one pending step (card supplement `:78`, `:98`).
    const rows = await addRowsOf(q, goal);
    expect(rows).toHaveLength(1);
    const add1 = rows[0]!;
    expect(add1).toMatchObject({ action: 'role_line', phase: 'accepted', actionPhase: 'waiting', result: null,
      steps: [{ key: 'line', duty: 'adviser', childOperation: null, state: 'pending' }] });

    // 4. The person assigns G to B (the queue leaves, the link opens).
    const b = q.advisers!.b;
    const body = graphWrite(S6A_SCOPE, { goalRef: goal, adviser: pairOf(b),
      expectedRevision: (await q.queue()).revision }, 'o4a2-r1-assign');
    expect((await q.world.post('goals/adviser-queue/assign', body)).body)
      .toMatchObject({ status: 'committed' });
    expect(await q.linesOf(goal)).toEqual([b.ref.sessionId]);
    expect(await q.queueIds()).toEqual([]);

    // 5. B1: that same commit ended the add failed `goal_assigned`, every step failed and no child.
    const ended = (await q.operations()).find((row): row is RoleLineRow => row.action === 'role_line'
      && row.operation.operationId === add1.operation.operationId);
    expect(ended).toMatchObject({ phase: 'failed', actionPhase: 'failed',
      result: { status: 'failed', reason: 'goal_assigned' },
      steps: [{ key: 'line', duty: 'adviser', childOperation: null, state: 'failed' }] });
    expect(await q.operation(add1.operation)).toMatchObject({ phase: 'failed',
      failure: { code: 'cancelled', reason: 'goal_assigned' } });
  }, 300_000);

  /*
   * Named mutation M2 (brief §2 R2): the platform reuses the goal's first add operation when it opens the goal again
   * (its fixed `goal-line:<goalId>` command, `src/core/work-graph/tasks/goal-adviser-queue-service.ts:617`). With
   * B1's failed end stored, the retried confirm's allocation replays it, so step 7's `toMatchObject({status:
   * 'committed'})` is red (`{rejected, cancelled, goal_assigned}`) and step 8 waits for a line that never comes. On
   * the start point (B1 not landed yet) the same reuse completes the still-waiting add: step 9 finds one completed
   * row instead of two, red.
   */
  it('R2 (memory): after the archive the platform opens a new add and assigns it', async () => {
    const w = world();
    const { a, b, inquiries } = w.advisers!;
    // The goal and its first add from R1 (the row fails above at step 5 but the world is still usable).
    const goal = w.goalOf('g');
    const first = (await addRowsOf(w, goal))[0]!;

    // 6. B's inquiry is withdrawn and B archived: its responsible links close, so G has no line.
    await w.withdraw(inquiries.b, 'o4a2-r2-b');
    await w.archive(b, 'o4a2-r2');
    expect(await w.linesOf(goal)).toEqual([]);

    // 7. The same confirm replays; its success exit is the platform's next assignment.
    expect(await w.confirm('g')).toMatchObject({ status: 'committed' });

    // 8. The platform opens a line C that is neither A nor B.
    const lines = await waitFor(() => w.linesOf(goal), on => on.length === 1, 'G to get its new adviser line');
    const c = lines[0]!;
    expect([a.ref.sessionId, b.ref.sessionId]).not.toContain(c);

    // 9. B3: two add operations; the first stays failed, the second completed with a child on its done step.
    const rows = await addRowsOf(w, goal);
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.operation.operationId === first.operation.operationId)).toMatchObject({
      phase: 'failed', result: { status: 'failed', reason: 'goal_assigned' } });
    const add2 = rows.find(row => row.operation.operationId !== first.operation.operationId)!;
    expect(add2).toMatchObject({ phase: 'completed', actionPhase: 'done',
      result: { status: 'done', reason: null } });
    expect(add2.steps).toHaveLength(1);
    expect(add2.steps[0]).toMatchObject({ key: 'line', duty: 'adviser', state: 'done' });
    expect(add2.steps[0]!.childOperation).not.toBeNull();
  }, 300_000);
});

describe('O4a-2 R3: the waiting add card is displaced by the person\'s assign; the next opening cards again', () => {
  let q: S7D2QueueWorld | null = null;
  afterEach(async () => { await q?.close(); q = null; });

  /*
   * Named mutation M3 (brief §2 R3): an assign displaces the waiting add card by O4a's close
   * (`closedOperationOf`, `src/core/work-graph/tasks/goal-adviser-queue-service.ts:165–:167`, reached at `:409`) ->
   * the operation reads `completed`/`done`: step 5's first `toMatchObject` (`phase: 'failed'`) is red, and step 7's
   * new card never appears because the first add still replays as done.
   */
  it('R3 (memory): the waiting add card ends goal_assigned; after the archive a new card waits', async () => {
    q = await openS7D2QueueWorld({ backend: 'memory', advisers: true,
      drafts: [{ name: 'ge', autonomy: 'every_step' }] });
    const w = q;

    // 1. Two free seats under a cap of 4, and no candidate (A and B are full): the add waits on its card.
    await w.setOpen('adviser', 4, 'o4a2-r3-cap-4');

    // 2. G is confirmed.
    expect(await w.confirm('ge')).toMatchObject({ status: 'committed' });
    const goal = w.goalOf('ge');

    // 3. One waiting add card for G, its frozen options, its operation accepted/waiting, and no queue entry.
    const cards = (await w.decisions(['waiting_answer'])).waitingAnswer.filter(card =>
      card.source.kind === 'role_line_change' && card.subject.kind === 'goal'
      && card.subject.goalRef.goalId === goal.goalId);
    expect(cards).toHaveLength(1);
    const card1 = cards[0]!;
    expect(card1.options).toEqual([
      { id: 'approve', label: '执行：给这个目标新开一条参谋线', effect: 'apply' },
      { id: 'reject', label: '不执行：目标排队，等现有参谋', effect: 'apply' },
    ]);
    const op1 = (JSON.parse(card1.source.key) as { operationRef: OperationRef }).operationRef;
    expect((await w.operations()).find(row => row.operation.operationId === op1.operationId)).toMatchObject({
      phase: 'accepted', actionPhase: 'waiting', result: { status: 'waiting', reason: null } });
    expect(await w.queueIds()).toEqual([]);

    // 4. The person assigns G to B.
    const b = w.advisers!.b;
    const body = graphWrite(S6A_SCOPE, { goalRef: goal, adviser: pairOf(b),
      expectedRevision: (await w.queue()).revision }, 'o4a2-r3-assign');
    expect((await w.world.post('goals/adviser-queue/assign', body)).body)
      .toMatchObject({ status: 'committed' });
    expect(await w.linesOf(goal)).toEqual([b.ref.sessionId]);

    // 5. B2/B4: the operation failed `goal_assigned`, the card closed `source_resolved`, no waiting card left.
    expect((await w.operations()).find(row => row.operation.operationId === op1.operationId)).toMatchObject({
      phase: 'failed', actionPhase: 'failed', result: { status: 'failed', reason: 'goal_assigned' },
      steps: [{ key: 'line', duty: 'adviser', childOperation: null, state: 'failed' }] });
    expect(await w.card(card1.source)).toMatchObject({ state: 'closed', closedReason: 'source_resolved' });
    expect((await w.decisions(['waiting_answer'])).waitingAnswer.filter(card =>
      card.source.kind === 'role_line_change' && card.subject.kind === 'goal'
      && card.subject.goalRef.goalId === goal.goalId)).toEqual([]);

    // 6. B is withdrawn and archived; the same confirm replays and the platform opens the goal again.
    await w.withdraw(w.advisers!.inquiries.b, 'o4a2-r3-b');
    await w.archive(b, 'o4a2-r3');
    expect(await w.confirm('ge')).toMatchObject({ status: 'committed' });

    // 7. B3/B4: one new card on another operation id; it waits, so there is still no line and no queue entry.
    const cards2 = (await w.decisions(['waiting_answer'])).waitingAnswer.filter(card =>
      card.source.kind === 'role_line_change' && card.subject.kind === 'goal'
      && card.subject.goalRef.goalId === goal.goalId);
    expect(cards2).toHaveLength(1);
    const card2 = cards2[0]!;
    expect((JSON.parse(card2.source.key) as { operationRef: OperationRef }).operationRef.operationId)
      .not.toBe(op1.operationId);
    expect(card2.options).toEqual([
      { id: 'approve', label: '执行：给这个目标新开一条参谋线', effect: 'apply' },
      { id: 'reject', label: '不执行：目标排队，等现有参谋', effect: 'apply' },
    ]);
    expect(await w.linesOf(goal)).toEqual([]);
    expect(await w.queueIds()).toEqual([]);
  }, 300_000);
});

describe('O4a-2 R4: the waiting queue-assign card is displaced by the person\'s assign', () => {
  let q: S7D2QueueWorld | null = null;
  afterEach(async () => { await q?.close(); q = null; });

  /*
   * Named mutation M4 (brief §2 R4): an assign displaces the waiting queue-assign card by O4a's close
   * (`closedOperationOf`, `src/core/work-graph/tasks/goal-adviser-queue-service.ts:165–:167`, reached at `:409`) ->
   * the operation reads `completed`/`done`: step 5's first `toMatchObject` (`phase: 'failed'`) is red, and so is the
   * step-by-step `toEqual`.
   */
  it('R4 (memory): the waiting queue-assign operation ends goal_assigned, every step failed', async () => {
    q = await openS7D2QueueWorld({ backend: 'memory', advisers: true, drafts: [
      { name: 'g1', autonomy: 'every_step' }, { name: 'g2', autonomy: 'after_plan_confirmation' }] });
    const w = q;

    // 1. At cap 2 both goals queue in confirmation order (RL-12 A's prior).
    await w.setOpen('adviser', 2, 'o4a2-r4-cap-2');
    expect(await w.confirm('g1')).toMatchObject({ status: 'committed' });
    expect(await w.confirm('g2')).toMatchObject({ status: 'committed' });
    const g1 = w.goalOf('g1');
    const g2 = w.goalOf('g2');
    expect(await w.queueIds()).toEqual([g1.goalId, g2.goalId]);

    // 2. The raise: G2 is assigned to a new line, G1 keeps its place with its queue-assign card.
    await w.setOpen('adviser', 3, 'o4a2-r4-cap-3');
    const assignId = `goal-queue-assign:${g1.goalId}`;
    const settled = await waitFor(async () => ({ ids: await w.queueIds(),
      cards: await w.cardsOf('role_line_change'), onG2: await w.linesOf(g2) }),
    state => state.ids.length === 1 && state.ids[0] === g1.goalId && state.cards.some(card =>
      (JSON.parse(card.source.key) as { operationRef: OperationRef }).operationRef.operationId === assignId)
      && state.onG2.length === 1 && state.onG2[0] !== w.advisers!.a.ref.sessionId
      && state.onG2[0] !== w.advisers!.b.ref.sessionId, 'the queue [G1] with its card and G2 on a new line');
    const card = settled.cards.find(candidate =>
      (JSON.parse(candidate.source.key) as { operationRef: OperationRef }).operationRef.operationId === assignId)!;

    // 3. Its operation waits; save the steps the assign must fail.
    const before = (await w.operations()).find((row): row is RoleLineRow => row.action === 'role_line'
      && row.operation.operationId === assignId);
    expect(before).toMatchObject({ phase: 'accepted', actionPhase: 'waiting',
      result: { status: 'waiting', reason: null } });

    // 4. The person assigns G1 to A (a person may exceed 3; the queue empties).
    const a = w.advisers!.a;
    const body = graphWrite(S6A_SCOPE, { goalRef: g1, adviser: pairOf(a),
      expectedRevision: (await w.queue()).revision }, 'o4a2-r4-assign');
    expect((await w.world.post('goals/adviser-queue/assign', body)).body)
      .toMatchObject({ status: 'committed' });
    expect(await w.queueIds()).toEqual([]);
    expect(await w.linesOf(g1)).toEqual([a.ref.sessionId]);

    // 5. B2/B4: failed `goal_assigned`, every step failed with nothing else changed, the card closed.
    const ended = (await w.operations()).find((row): row is RoleLineRow => row.action === 'role_line'
      && row.operation.operationId === assignId);
    expect(ended).toMatchObject({ phase: 'failed', actionPhase: 'failed',
      result: { status: 'failed', reason: 'goal_assigned' } });
    expect(ended!.steps).toEqual(before!.steps.map(step => ({ ...step, state: 'failed' })));
    expect(await w.card(card.source)).toMatchObject({ state: 'closed', closedReason: 'source_resolved' });
  }, 300_000);
});
