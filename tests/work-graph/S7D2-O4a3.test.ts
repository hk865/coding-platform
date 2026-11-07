/**
 * O4a-3 (`7d2-drill-rulings.md` final, o4a ruling 12 Q1–Q3; book `:528–:538`, `:549–:556`; the frozen write-tests
 * brief §1 R1–R7): the platform allocation command `goal-queue:<goalId>` is used once per generation. It is used up
 * when its assignment receipt's link was closed (R1), its enqueue receipt no longer matches the entry's `enqueuedAt`
 * (R2), its wait card's round left the queue (R5), or its drain drop committed (R7); the queue card and the line add
 * then move to `goal-queue-assign#2:<G>` / `goal-line#2:<G>` too (R3, R4). A person's plain assign reads the current
 * generation (R6).
 *
 * World: `openS7D2QueueWorld` (tests/helpers/S7D2-queue-world.ts:123), memory, fixed clock; A and B hold three
 * in-progress `small` goals and one unaccepted inquiry each. Every step is a public route: `q.confirm`, `q.archive`,
 * `q.changeScope`, `q.setOpen`, `q.plan`/`q.pause`/`q.cancel`, the person's `goals/adviser-queue/assign` (a
 * `graphWrite` body), `q.answer`, and the reads `q.queueIds`, `q.linesOf`, `q.goalsOf`, `q.card`, `q.cardsOf`,
 * `q.operations`, `q.operation`. `openTargetsOf` is the existing export
 * (tests/helpers/S7D2-role-line-world.ts:185). No store, record or context is read or built.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { addRowsOf, openS7D2QueueWorld, type S7D2QueueWorld } from '../helpers/S7D2-queue-world.js';
import { openTargetsOf } from '../helpers/S7D2-role-line-world.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: S7D2QueueWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

type RoleLineRow = Extract<RoleLineOperationReadV1, { action: 'role_line' }>;
const pairOf = (line: S6ASession): SessionRef => ({ projectId: line.ref.projectId, sessionId: line.ref.sessionId });
const sessionRefOf = (sessionId: string): SessionRef => ({ projectId: S6A_SCOPE.projectId, sessionId });
const operationIdOf = (card: DecisionCardV1): string | undefined =>
  (JSON.parse(card.source.key) as { operationRef?: { operationId?: string } }).operationRef?.operationId;
const roleLineRowOf = async (q: S7D2QueueWorld, operationId: string): Promise<RoleLineRow | undefined> =>
  (await q.operations()).find((row): row is RoleLineRow => row.action === 'role_line'
    && row.operation.operationId === operationId);
const queueCardOf = async (q: S7D2QueueWorld, operationId: string, state?: DecisionCardV1['state']) =>
  (await q.cardsOf('role_line_change')).find(card => operationIdOf(card) === operationId
    && (state === undefined || card.state === state)) ?? null;
const linkOf = async (q: S7D2QueueWorld, sessionId: string, goal: GoalRef) =>
  (await q.readCard(sessionRefOf(sessionId))).links.filter(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'goal' && link.ref.target.ref.goalId === goal.goalId);
const world = async (drafts: { name: string; autonomy: 'every_step' | 'after_plan_confirmation' }[], advisers: boolean) =>
  { const q = await openS7D2QueueWorld({ backend: 'memory', advisers, drafts }); worlds.push(q); return q; };

describe('O4a-3 R1/R2: an allocation generation is used once', () => {
  /*
   * R1 named mutation: drop `currentAllocationCommandOf`'s "the assignment receipt's link is still open (`until ===
   * null`)" branch (today the replay is unconditional, goal-adviser-queue-service.ts:281–:298) -> the second confirm
   * replays the old receipt and `linesOf` stays empty: red at `toHaveLength(1)`.
   */
  it('R1 (memory): after the first line is archived the same draft allocates a new line', async () => {
    const q = await world([{ name: 'g', autonomy: 'after_plan_confirmation' }], false);
    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    const goal = q.goalOf('g');
    const a = (await q.linesOf(goal))[0]!;
    expect(a).toBe(q.lines.adviser.ref.sessionId);
    await q.archive(q.lines.adviser, 'o4a3-r1');
    expect(await q.linesOf(goal)).toEqual([]);

    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    const lines = await waitFor(() => q.linesOf(goal), on => on.length === 1, 'the re-allocated adviser line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toBe(a);
    expect(await q.queueIds()).toEqual([]);
    expect(await linkOf(q, a, goal)).toMatchObject([{ until: expect.any(String) }]);
    expect(await linkOf(q, lines[0]!, goal)).toMatchObject([{ until: null }]);
  }, 300_000);

  /*
   * R2 named mutation: drop `currentAllocationCommandOf`'s enqueue arm (do not compare the receipt's cursor with the
   * entry's `enqueuedAt`, goal-adviser-queue-service.ts:281–:318) -> the second confirm replays the old append and the
   * queue stays empty: red at `toEqual([goal.goalId])`.
   */
  it('R2 (memory): a queued goal assigned away re-enqueues under the next generation', async () => {
    const q = await world([{ name: 'g', autonomy: 'after_plan_confirmation' }], true);
    const { b, inquiries } = q.advisers!;
    await q.setOpen('adviser', 2, 'o4a3-r2-cap-2');
    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    const goal = q.goalOf('g');
    expect(await q.queueIds()).toEqual([goal.goalId]);
    const firstAt = (await q.queue()).entries[0]!.enqueuedAt;

    const body = graphWrite(S6A_SCOPE, { goalRef: goal, adviser: pairOf(b),
      expectedRevision: (await q.queue()).revision }, 'o4a3-r2-assign');
    expect((await q.world.post('goals/adviser-queue/assign', body)).body).toMatchObject({ status: 'committed' });
    expect(await q.queueIds()).toEqual([]);
    await q.withdraw(inquiries.b, 'o4a3-r2-b');
    await q.archive(b, 'o4a3-r2');
    await q.setOpen('adviser', 1, 'o4a3-r2-cap-1');

    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    const entries = (await q.queue()).entries;
    expect(entries.map(entry => entry.goalRef.goalId)).toEqual([goal.goalId]);
    expect(entries[0]!.enqueuedAt).not.toEqual(firstAt);
    expect(await q.linesOf(goal)).toEqual([]);
  }, 300_000);
});

describe('O4a-3 R3/R4: the card and the line add move to the next generation', () => {
  /*
   * R3 named mutation: keep the drain's card identity at generation 1 (goal-adviser-queue-service.ts:815–:832) -> the
   * completed generation-1 card makes the drain skip the entry forever and the wait for `goal-queue-assign#2:<G>`
   * times out: red at `operationIdOf(card2)`.
   */
  it('R3 (memory): after the card round ends, a re-enqueued goal gets a second-generation card', async () => {
    const q = await world([{ name: 'g', autonomy: 'every_step' },
      { name: 'h', autonomy: 'after_plan_confirmation' }], true);
    const { a, b } = q.advisers!;
    await q.setOpen('adviser', 2, 'o4a3-r3-cap-2');
    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    expect(await q.confirm('h')).toMatchObject({ status: 'committed' });
    const g = q.goalOf('g');
    const h = q.goalOf('h');
    expect(await q.queueIds()).toEqual([g.goalId, h.goalId]);

    await q.setOpen('adviser', 3, 'o4a3-r3-cap-3');
    const settled = await waitFor(async () => ({ ids: await q.queueIds(),
      card: await queueCardOf(q, `goal-queue-assign:${g.goalId}`), onH: await q.linesOf(h) }),
    read => read.ids.length === 1 && read.ids[0] === g.goalId && read.card !== null && read.onH.length === 1
      && read.onH[0] !== a.ref.sessionId && read.onH[0] !== b.ref.sessionId,
    'the queue [G] with its generation-1 card and H on a new line');
    const c = settled.onH[0]!;
    expect(operationIdOf(settled.card!)).toBe(`goal-queue-assign:${g.goalId}`);
    expect(await q.answer(settled.card!, 'approve', 'o4a3-r3-approve')).toMatchObject({ status: 'ready' });
    expect(await q.queueIds()).toEqual([]);
    expect(await roleLineRowOf(q, `goal-queue-assign:${g.goalId}`)).toMatchObject({ phase: 'completed', actionPhase: 'done' });
    await q.archive(sessionRefOf(c), 'o4a3-r3');
    expect(await q.linesOf(g)).toEqual([]);
    await q.setOpen('adviser', 2, 'o4a3-r3-cap-2');

    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    expect(await q.queueIds()).toContain(g.goalId);
    await q.plan(q.advisers!.goals.a[0]!, 'o4a3-r3-free');
    await q.pause(q.advisers!.goals.a[0]!);
    const card2 = await waitFor(() => queueCardOf(q, `goal-queue-assign#2:${g.goalId}`, 'waiting_answer'),
      card => card !== null, 'the generation-2 queue card');
    expect(operationIdOf(card2!)).toBe(`goal-queue-assign#2:${g.goalId}`);
    expect(await roleLineRowOf(q, `goal-queue-assign:${g.goalId}`)).toMatchObject({ phase: 'completed', actionPhase: 'done' });
    expect(await q.answer(card2!, 'approve', 'o4a3-r3-approve-2')).toMatchObject({ status: 'ready' });
    expect(await q.linesOf(g)).toEqual([a.ref.sessionId]);
    expect(await q.queueIds()).toEqual([]);
  }, 300_000);

  /*
   * R4 named mutation: `currentLineAddOf` stops at a `completed` add instead of checking that the line it built is
   * archived (goal-adviser-queue-service.ts:221–:238) -> the second confirm replays the archived line and is refused
   * or writes no second add: red at the second confirm / the two `role_line_add` rows.
   */
  it('R4 (memory): a completed add whose line was archived opens a new add', async () => {
    const q = await world([{ name: 'g', autonomy: 'after_plan_confirmation' }], true);
    const { a, b } = q.advisers!;
    await q.setOpen('adviser', 3, 'o4a3-r4-cap-3');
    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    const goal = q.goalOf('g');
    const c = await waitFor(async () => (await q.linesOf(goal))[0] ?? null, line => line !== null,
      'G on a new adviser line');
    expect([a.ref.sessionId, b.ref.sessionId]).not.toContain(c!);
    const adds = await waitFor(() => addRowsOf(q, goal), rows => rows.length === 1, 'the first line add');
    expect(adds[0]).toMatchObject({ phase: 'completed', actionPhase: 'done' });
    expect(adds[0]!.steps[0]!.childOperation).not.toBeNull();

    await q.archive(sessionRefOf(c!), 'o4a3-r4');
    expect(await q.linesOf(goal)).toEqual([]);
    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    const lines = await waitFor(() => q.linesOf(goal), on => on.length === 1, 'the second opening of G');
    expect(lines[0]).not.toBe(c);
    const both = await waitFor(() => addRowsOf(q, goal), rows => rows.length === 2, 'the second line add');
    expect(both.filter(row => row.operation.operationId === adds[0]!.operation.operationId))
      .toMatchObject([{ phase: 'completed', actionPhase: 'done' }]);
    const second = both.find(row => row.operation.operationId !== adds[0]!.operation.operationId)!;
    expect(second.operation.operationId).not.toBe(adds[0]!.operation.operationId);
    expect(second).toMatchObject({ phase: 'completed', actionPhase: 'done' });
    expect(second.steps[0]!.childOperation).not.toBeNull();
  }, 300_000);
});

describe('O4a-3 R5/R6/R7: the wait card, the person\'s assign and the drop read the current generation', () => {
  /** R5/R6/R7's shared prior: an every-step goal cards its add, the card's reject queues it (U1). */
  async function rejectedAddPrior(q: S7D2QueueWorld, requestId: string):
  Promise<{ goal: GoalRef; card1: DecisionCardV1 }> {
    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    const goal = q.goalOf('g');
    const card1 = (await q.cardsOf('role_line_change')).find(card => card.subject.kind === 'goal'
      && card.subject.goalRef.goalId === goal.goalId);
    if (card1 === undefined) throw new Error('O4a-3: the line-add card is missing');
    expect(await q.queueIds()).toEqual([]);
    expect(await q.answer(card1, 'reject', requestId)).toMatchObject({ status: 'ready' });
    expect(await q.queueIds()).toEqual([goal.goalId]);
    return { goal, card1 };
  }
  /** R5/R6's prior after the reject: a queue card assigns G to A; A is archived; the next confirm re-enqueues;
   *  pausing B's goal makes B a candidate, so the generation-2 card waits. */
  async function queueCardPrior(q: S7D2QueueWorld): Promise<{ goal: GoalRef; card1: DecisionCardV1;
    card2: DecisionCardV1; card3: DecisionCardV1; at4: { lines: string[]; queue: string[] } }> {
    const { goal, card1 } = await rejectedAddPrior(q, 'o4a3-r5-reject');

    await q.plan(q.advisers!.goals.a[0]!, 'o4a3-r5-a0');
    await q.pause(q.advisers!.goals.a[0]!);
    const card2 = await waitFor(() => queueCardOf(q, `goal-queue-assign:${goal.goalId}`, 'waiting_answer'),
      card => card !== null, 'the generation-1 queue card');
    expect(await q.queueIds()).toEqual([goal.goalId]);
    expect(await q.answer(card2!, 'approve', 'o4a3-r5-approve')).toMatchObject({ status: 'ready' });
    const at4 = { lines: await q.linesOf(goal), queue: await q.queueIds() };
    await q.withdraw(q.advisers!.inquiries.a, 'o4a3-r5-a');
    await q.archive(q.advisers!.a, 'o4a3-r5-archive');
    expect(await q.linesOf(goal)).toEqual([]);

    await q.setOpen('adviser', 1, 'o4a3-r5-cap-1');
    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    expect(await q.queueIds()).toEqual([goal.goalId]);
    await q.plan(q.advisers!.goals.b[0]!, 'o4a3-r5-b0');
    await q.pause(q.advisers!.goals.b[0]!);
    const card3 = await waitFor(() => queueCardOf(q, `goal-queue-assign#2:${goal.goalId}`, 'waiting_answer'),
      card => card !== null, 'the generation-2 queue card');
    return { goal, card1, card2: card2!, card3: card3!, at4 };
  }

  /*
   * R5 named mutation: delete `currentAllocationCommandOf`'s wait-card arm (the branch that reads this generation's
   * wait card and compares its `wait` receipt cursor with the entry's `enqueuedAt`; today goal-adviser-queue-service.ts
   * :815–:832 writes the card) -> the re-enqueue stays at generation 1, the drain sees the completed generation-1 card
   * and the wait for `goal-queue-assign#2:<G>` times out: red at `operationIdOf(card3)`.
   */
  it('R5 (memory): a rejected add, its card round, an archive and a re-enqueue get a second-generation card', async () => {
    const q = await world([{ name: 'g', autonomy: 'every_step' }], true);
    const { a } = q.advisers!;
    await q.setOpen('adviser', 4, 'o4a3-r5-cap-4');
    const { goal, card1, card2, card3, at4 } = await queueCardPrior(q);
    const add1 = await roleLineRowOf(q, operationIdOf(card1)!);
    expect(add1).toMatchObject({ phase: 'failed', actionPhase: 'failed',
      result: { status: 'failed', reason: 'decision_rejected' } });
    expect(await q.operation(add1!.operation)).toMatchObject({ action: { action: 'role_line_add' } });
    expect((await q.card(card1.source)).state).not.toBe('waiting_answer');
    expect(await q.queueIds()).toEqual([goal.goalId]);
    expect(at4).toEqual({ lines: [a.ref.sessionId], queue: [] });
    expect(await roleLineRowOf(q, `goal-queue-assign:${goal.goalId}`)).toMatchObject({ phase: 'completed', actionPhase: 'done' });
    expect(await q.linesOf(goal)).toEqual([]);
    expect(operationIdOf(card3)).toBe(`goal-queue-assign#2:${goal.goalId}`);
    expect(await roleLineRowOf(q, `goal-queue-assign#2:${goal.goalId}`)).toMatchObject({ phase: 'accepted',
      actionPhase: 'waiting', result: { status: 'waiting', reason: null } });
    expect(await roleLineRowOf(q, `goal-queue-assign:${goal.goalId}`)).toMatchObject({ phase: 'completed', actionPhase: 'done' });
    expect((await q.card(card2.source)).state).toBe('answered_no_application');
  }, 300_000);

  /*
   * R6 named mutation: `write`'s plain assign reads the card with `goalContextOf(goal.goal, ctx)` (the person's
   * principal) instead of `{ ...ctx, principal: platformPrincipal() }` (today goal-adviser-queue-service.ts:151 and
   * :461–:464) -> it finds the completed generation-1 card (`goalAssignedCloseOf` returns null), so the generation-2
   * card stays waiting: red at the `goal-queue-assign#2:<G>` row / `card3` `closed`.
   */
  it('R6 (memory): the person\'s assign closes the generation-2 card, not the completed generation-1 one', async () => {
    const q = await world([{ name: 'g', autonomy: 'every_step' }], true);
    const { b } = q.advisers!;
    await q.setOpen('adviser', 4, 'o4a3-r6-cap-4');
    const { goal, card3 } = await queueCardPrior(q);
    const body = graphWrite(S6A_SCOPE, { goalRef: goal, adviser: pairOf(b),
      expectedRevision: (await q.queue()).revision }, 'o4a3-r6-assign');
    expect((await q.world.post('goals/adviser-queue/assign', body)).body).toMatchObject({ status: 'committed' });
    expect(await q.queueIds()).toEqual([]);
    expect(await q.linesOf(goal)).toEqual([b.ref.sessionId]);
    expect(await roleLineRowOf(q, `goal-queue-assign#2:${goal.goalId}`)).toMatchObject({ phase: 'failed',
      actionPhase: 'failed', result: { status: 'failed', reason: 'goal_assigned' },
      steps: [{ key: 'adviser', duty: 'adviser', state: 'failed' }] });
    expect(await q.card(card3.source)).toMatchObject({ state: 'closed', closedReason: 'source_resolved' });
    expect(await roleLineRowOf(q, `goal-queue-assign:${goal.goalId}`)).toMatchObject({ phase: 'completed', actionPhase: 'done' });
  }, 300_000);

  /*
   * R7 named mutation: delete `currentAllocationCommandOf`'s drop-receipt branch (a committed drop uses the generation
   * up; today goal-adviser-queue-service.ts:801 commits `goal-queue:<goalId>`) -> the next enqueue stays at generation
   * 1, the second drop replays the first one and G stays queued: red at `toEqual([])` after the bounded wait.
   */
  it('R7 (memory): the drop uses the current generation, so the second drop really drops', async () => {
    const q = await world([{ name: 'g', autonomy: 'every_step' }], true);
    const { a } = q.advisers!;
    await q.setOpen('adviser', 4, 'o4a3-r7-cap-4');
    const { goal } = await rejectedAddPrior(q, 'o4a3-r7-reject');

    const scope = openTargetsOf(await q.readCard(a))
      .filter((target): target is { kind: 'goal'; ref: GoalRef } => target.kind === 'goal')
      .map(target => ({ kind: 'goal' as const, goalRef: target.ref }));
    scope.push({ kind: 'goal', goalRef: goal });
    expect((await q.changeScope({ session: a, scope, requestId: 'o4a3-r7-scope' })).result)
      .toMatchObject({ status: 'committed' });
    await q.setOpen('adviser', 5, 'o4a3-r7-nudge');
    await waitFor(async () => ({ ids: await q.queueIds(), onA: await q.goalsOf(a) }),
      read => !read.ids.includes(goal.goalId) && read.onA.includes(goal.goalId),
      'G to leave the queue with A as its adviser');

    await q.withdraw(q.advisers!.inquiries.a, 'o4a3-r7-a');
    await q.archive(a, 'o4a3-r7-archive');
    expect(await q.linesOf(goal)).toEqual([]);
    await q.setOpen('adviser', 1, 'o4a3-r7-cap-1');
    expect(await q.confirm('g')).toMatchObject({ status: 'committed' });
    expect(await q.queueIds()).toEqual([goal.goalId]);
    await q.plan(goal, 'o4a3-r7-plan');
    await q.cancel(goal);
    await waitFor(() => q.queueIds(), ids => !ids.includes(goal.goalId), 'the second drop to remove G');
    expect(await q.queueIds()).toEqual([]);
  }, 300_000);
});
