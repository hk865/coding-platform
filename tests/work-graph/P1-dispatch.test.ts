/**
 * P1 D1–D10 (contract `p1-frozen.md` 2.3, 2.5; section 五) and the review table's C1, AR-1, AR-6 (`cp1-review-rulings.md`):
 * a round's dispatch request (`platform.actionRequests`) and the claim owner settling it. Rounds are `openP1World`'s
 * held planning rounds. A plain claim is the Workflow's own claim step performed through the public `workflow/advance`
 * (`performClaim`); only a claim carrying `servedRequest` is made by the Host through `P1-platform-entry.ts`
 * `hostClaim` (ruling T1). The dispatch sequence is the public `goals/dispatch-basis` read; requests and holds are
 * read through the owners' public reads. Expected values are the contract's and the rework table's.
 *
 * Red before P1: `platform.actionRequests` did not exist. Red until the review's fixes: C1 (the acceptance did not
 * guard the TaskLease), AR-1 (a served claim applied a pending request), AR-6 (a gate Task was accepted).
 *
 * Mutations (lead): D1 each of the first three refusals deleted, and the region adviser's module link counted as
 * responsible; D2 settling also adds to the sequence, or leaves `openDispatch` set; D3 a second request is written;
 * D4 the counter is not written; D5 the basis guards stay out of the serving commit, or a pointer guard joins the
 * plain one (its first commit conflicts and the Workflow re-claims, which the noted re-claim shows); D6 the
 * counter guard stays out of the commit; D7 an absent hold is not guarded as null; D8 the request does not guard
 * `round.guards`; D9 `servedRequest` passes the hold; D10 a pending request blocks the claim; C1, AR-1, AR-6 the
 * review fix removed (the Lease guard; `byRequest` from `open` only; the work-Task check). The M rows follow the
 * named mutations (`cp1-mut-rulings.md`): M1-1 the non-`query_run` refusal deleted; M2-3 the request round's refusal
 * deleted; M2-4 the duty check deleted; M2-9 the basis comparison deleted; M6-5 `TaskClaimed` no longer last; M6-6
 * the served request's pointer check deleted; M6-12 `servedRequest` left out of the fingerprint. M6-7 (the served
 * request's revision) is not written: the request at the pointer can be newer than the revision read only when its
 * card is approved (pending → open) between the read and the claim, which needs P2's real card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionRequestRef } from '../../src/contracts/action-request.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { CommitMatch } from '../helpers/S6A-commit-barrier.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { hostClaim } from '../helpers/P1-platform-entry.js';
import { createPLLine } from '../helpers/PL-consumption-fixture.js';
import { S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import type { P1HeldRound, P1World } from '../helpers/P1-round-fixture.js';
import {
  actionRefOf, dispatchSequence, gateTaskOf, holdOf, p1Worlds, performClaim, pointerRef, reachedBefore, requestOf,
  write,
} from '../helpers/P1-reads.js';
import { holdS7AQueryRound, moveS7APointer } from '../helpers/S7A-fixture.js';
import { readS7A2DispatchBasis } from '../helpers/S7A2-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds = p1Worlds();
afterEach(async () => {
  const unreleased = commitBarrier.reset();
  await worlds.closeAll();
  expect(unreleased).toEqual([]);
});
const LONG = 600_000;

async function dispatch(p1: P1World, round: P1HeldRound, task: TaskTriple, requestId: string) {
  return p1.world.platform.actionRequests.requestDispatch(round.ctx,
    write({ taskRef: task, reason: `P1 ${requestId}` }, requestId));
}
/** The commit that claims `task`: it writes the Task's lease (the claim's own record). */
const claimCommitOf = (task: TaskTriple): CommitMatch => commit => commit.records.some(record =>
  record.refKey.includes('"aggregateType":"TaskLease"') && record.refKey.includes(`"taskId":"${task.taskId}"`));
/** The commit that writes a new dispatch request. */
const dispatchCommit: CommitMatch = commit => commit.records.some(record =>
  record.refKey.includes('"aggregateType":"ActionRequest"'));
const served = async (p1: P1World, ref: ActionRequestRef) => ({ ref, revision: (await requestOf(p1, ref))!.revision });

describe('rejects: D1, AR-6, what a dispatch or stop request may not take', () => {
  it('A dispatches tB while E runs it: busy (in progress); no hold', async () => {
    const p1 = await worlds.open({ running: true });
    const a = await p1.hold(p1.lines.A, 'd1-run-a');
    const refused = await dispatch(p1, a, p1.task.tB, 'd1-tb');
    expect(refused).toMatchObject({ status: 'rejected', code: 'busy' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('in progress');
    expect(await holdOf(p1, p1.task.tB)).toBeNull();
  }, LONG);

  it('A dispatches tC whose Run ended with no rework: invalid (request a rework or recheck); no hold', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'd1-tc-a');
    const refused = await dispatch(p1, a, p1.task.tC, 'd1-tc');
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('request a rework or recheck');
    expect(await holdOf(p1, p1.task.tC)).toBeNull();
  }, LONG);

  it('A asks to stop tA, which has no Run: invalid (no running Run); no hold', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'd1-stop-a');
    const refused = await p1.world.platform.actionRequests.requestStop(a.ctx,
      write({ taskRef: p1.task.tA, reason: 'P1 D1 stop tA' }, 'd1-stop-ta'));
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('no running Run');
    expect(await holdOf(p1, p1.task.tA)).toBeNull();
  }, LONG);

  it('the region adviser B (only a module link) dispatches tA: forbidden (responsible); no hold', async () => {
    const p1 = await worlds.open();
    const b = await p1.hold(p1.lines.B, 'd1-region-b');
    const refused = await dispatch(p1, b, p1.task.tA, 'd1-region');
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('responsible');
    expect(await holdOf(p1, p1.task.tA)).toBeNull();
  }, LONG);

  it('AR-6: A dispatches the goal gate, which no claim can take: invalid (only a work task can be claimed); no hold', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'ar6-a');
    const gate = await gateTaskOf(p1);
    const refused = await dispatch(p1, a, gate, 'ar6-gate');
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('only a work task can be claimed');
    expect(await holdOf(p1, gate)).toBeNull();
  }, LONG);
});

// After the named mutations (`cp1-mut-rulings.md`, B and C): the admission's first checks and the basis check, one
// caller or one input per row. The request round is 7A's held secretary request round (`holdS7AQueryRound`); the
// executor round is a new executor line's planning round (B20: no Task of its own).
type Within = (p1: P1World, use: (ctx: CoreCallContext) => Promise<unknown>) => Promise<unknown>;
const requestRound: Within = async (p1, use) =>
  await holdS7AQueryRound(p1.world, { label: 'p1-m-request', goalId: p1.goal.goalId }, async ctx => await use(ctx));
const askers: Array<[string, string, 'dispatch' | 'stop', string, Within]> = [
  ['M1-1', 'the operator (no query round)', 'dispatch', 'only a running QueryRun has a query round identity',
    async (p1, use) => await use(p1.world.humanContext())],
  ['M2-4', 'an executor line\'s planning round', 'dispatch', '这一轮没有授予这个动作',
    async (p1, use) => await use((await p1.hold(await createPLLine(p1.world, { label: 'p1-m-x', role: S6A_WORK_ROLE }),
      'm24-x')).ctx)],
];

describe('rejects: M1-1, M2-3, M2-4, M2-9, a caller or a basis a dispatch or stop request may not take', () => {
  it.each(askers)('%s: %s asks a %s: forbidden (%s); no hold', async (_id, _who, kind, reason, within) => {
    const p1 = await worlds.open({ running: kind === 'stop' });
    const task = kind === 'dispatch' ? p1.task.tA : p1.task.tB;
    const ask = { taskRef: task, reason: 'P1 M ask' };
    const refused = await within(p1, async ctx => kind === 'dispatch'
      ? await p1.world.platform.actionRequests.requestDispatch(ctx, write(ask, 'm-ask'))
      : await p1.world.platform.actionRequests.requestStop(ctx, write(ask, 'm-ask')));
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: expect.stringContaining(reason) });
    expect(await holdOf(p1, task)).toBeNull();
  }, LONG);

  it('M2-9: A dispatches tA with the basis it read before the pointer moved: revision_conflict with the current basis; no hold', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'm29-a');
    const read = await readS7A2DispatchBasis(p1.world, p1.goal);
    await moveS7APointer(p1.world, p1.goal);
    const now = await readS7A2DispatchBasis(p1.world, p1.goal);
    const refused = await p1.world.platform.actionRequests.requestDispatch(a.ctx, write({ taskRef: p1.task.tA,
      reason: 'P1 M2-9', expected: { planRevision: read.planRevision, pointerRevision: read.pointerRevision,
        dispatchSequence: read.dispatchSequence } }, 'm29-dispatch'));
    expect(refused).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      reason: 'the dispatch basis moved since it was read', dispatchCurrent: { planRevision: now.planRevision,
        pointerRevision: now.pointerRevision, dispatchSequence: now.dispatchSequence } });
    expect(await holdOf(p1, p1.task.tA)).toBeNull();
  }, LONG);
});

describe('D2–D4, D9, D10, AR-1: the claim settles or serves the request', () => {
  it('D2, D3: A dispatches tA (requested); a second request id answers already_requested; a plain claim settles it, the sequence stays 0', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'd2-a');
    expect(await dispatchSequence(p1)).toBe(0);
    const requested = await dispatch(p1, a, p1.task.tA, 'd2-dispatch');
    expect(requested).toMatchObject({ status: 'requested' });
    // D3: the same Task, another request id, before any claim.
    expect(await dispatch(p1, a, p1.task.tA, 'd3-dispatch-again'))
      .toMatchObject({ status: 'already_requested', actionRef: actionRefOf(requested) });

    const claimed = await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'd2'));
    expect(claimed).toMatchObject({ status: 'committed' });
    expect(await requestOf(p1, actionRefOf(requested))).toMatchObject({ state: 'applied',
      outcome: { session: claimed.value?.sessionRef, run: claimed.value?.runRef, byRequest: false } });
    // AR-03's pointer clear (lead ruling at stacking: guarded here, not in U1).
    expect((await holdOf(p1, p1.task.tA))?.openDispatch).toBeNull();
    expect(await dispatchSequence(p1)).toBe(0);
  }, LONG);

  it('D4: a claim serving tA\'s open request applies it by request; the sequence moves 0 → 1', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'd4-a');
    const requested = await dispatch(p1, a, p1.task.tA, 'd4-dispatch');
    expect(await dispatchSequence(p1)).toBe(0);
    const claimed = await hostClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'd4'),
      { servedRequest: await served(p1, actionRefOf(requested)) });
    expect(claimed).toMatchObject({ status: 'committed' });
    if (claimed.status !== 'committed') return;
    expect(await requestOf(p1, actionRefOf(requested))).toMatchObject({ state: 'applied',
      outcome: { session: claimed.value.sessionRef, run: claimed.value.runRef, byRequest: true } });
    expect(await dispatchSequence(p1)).toBe(1);
  }, LONG);

  it('D9: tA holds S\'s reason and an open request; the serving claim is busy (claim hold) and changes nothing', async () => {
    const p1 = await worlds.open();
    const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'd9');
    expect(await p1.world.platform.claimHolds.place(s.ctx, write({ taskRef: p1.task.tA, reason: 'P1 D9 secretary hold' },
      'd9-place-s'))).toMatchObject({ status: 'committed' });
    const requested = await dispatch(p1, a, p1.task.tA, 'd9-dispatch');
    expect(requested).toMatchObject({ status: 'requested' });
    const claimed = await hostClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'd9'),
      { servedRequest: await served(p1, actionRefOf(requested)) });
    expect(claimed).toMatchObject({ status: 'rejected', code: 'busy' });
    if (claimed.status === 'rejected') expect(claimed.reason).toContain('claim hold');
    expect(await requestOf(p1, actionRefOf(requested))).toMatchObject({ state: 'open' });
    expect((await holdOf(p1, p1.task.tA))?.reasons).toMatchObject([{ reason: 'P1 D9 secretary hold', state: 'held' }]);
    expect(await dispatchSequence(p1)).toBe(0);
  }, LONG);

  it('D10: every step; A\'s dispatch needs a decision; a plain claim still claims and applies the pending request', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    const a = await p1.hold(p1.lines.A, 'd10-a');
    const requested = await dispatch(p1, a, p1.task.tA, 'd10-dispatch');
    expect(requested).toMatchObject({ status: 'needs_decision' });
    expect(await requestOf(p1, actionRefOf(requested))).toMatchObject({ state: 'pending' });
    expect(await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'd10')))
      .toMatchObject({ status: 'committed' });
    expect(await requestOf(p1, actionRefOf(requested))).toMatchObject({ state: 'applied', outcome: { byRequest: false } });
  }, LONG);

  it('AR-1: every step; a claim serving A\'s pending request: revision_conflict; the request stays pending, the sequence 0', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    const a = await p1.hold(p1.lines.A, 'ar1-a');
    const requested = await dispatch(p1, a, p1.task.tA, 'ar1-dispatch');
    expect(requested).toMatchObject({ status: 'needs_decision' });
    expect(await hostClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'ar1'),
      { servedRequest: await served(p1, actionRefOf(requested)) })).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await requestOf(p1, actionRefOf(requested))).toMatchObject({ state: 'pending' });
    expect(await dispatchSequence(p1)).toBe(0);
  }, LONG);
});

describe('rejects: M6-6, a served claim names a request that is not the Task\'s open one', () => {
  // Another Task's request is refused before any read (invalid, names another Task), so this names tA's own first
  // request, at the very revision the open one has: only the pointer differs.
  it('M6-6: A\'s first request of tA is withdrawn and A asks again; a claim of tA serving the first at its open revision: revision_conflict (not the open dispatch request); the pointer keeps the second', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'm66-a');
    const first = await served(p1, actionRefOf(await dispatch(p1, a, p1.task.tA, 'm66-first')));
    expect(await p1.world.platform.actionRequests.withdraw(a.ctx, write({ request: first.ref }, 'm66-withdraw')))
      .toMatchObject({ status: 'committed' });
    const open = actionRefOf(await dispatch(p1, a, p1.task.tA, 'm66-again'));
    expect((await requestOf(p1, open))!.revision).toBe(first.revision);
    expect(await hostClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'm66'), { servedRequest: first }))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict',
        reason: expect.stringContaining('is not the open dispatch request of the Task') });
    expect(await requestOf(p1, open)).toMatchObject({ state: 'open' });
    expect(pointerRef((await holdOf(p1, p1.task.tA))?.openDispatch)).toEqual(open);
    expect(await dispatchSequence(p1)).toBe(0);
  }, LONG);
});

describe('M6-5 (storage, both backends): a serving claim\'s receipt names its TaskClaimed event', () => {
  // The contract puts the new events before `TaskClaimed`, so the receipt cursor is the claim event a replay re-reads.
  it.each(['memory', 'sqlite'] as const)('M6-5 %s: a claim serving A\'s request of tA, sent again: the original receipt, marked as a replay', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 'm65-a');
    const servedRequest = await served(p1, actionRefOf(await dispatch(p1, a, p1.task.tA, 'm65-dispatch')));
    const step = await p1.claimStep(p1.lines.E, p1.task.tA, 'm65');
    const first = await hostClaim(p1.world, step, { servedRequest });
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    expect(await hostClaim(p1.world, step, { servedRequest })).toEqual({ ...first, replayed: true });
  }, LONG);
});

describe('rejects (storage, both backends): M6-12, a claim id taken again with another mark', () => {
  it.each(['memory', 'sqlite'] as const)('M6-12 %s: the Workflow\'s plain claim of tA applied A\'s request; the same claim id serving it: idempotency_conflict', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 'm612-a');
    const requested = actionRefOf(await dispatch(p1, a, p1.task.tA, 'm612-dispatch'));
    const servedRequest = await served(p1, requested);
    const step = await p1.claimStep(p1.lines.E, p1.task.tA, 'm612');
    expect(await performClaim(p1.world, step)).toMatchObject({ status: 'committed' });
    expect(await hostClaim(p1.world, step, { servedRequest }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await requestOf(p1, requested)).toMatchObject({ state: 'applied', outcome: { byRequest: false } });
    expect(await dispatchSequence(p1)).toBe(0);
  }, LONG);
});

describe('D5–D8, C1 (storage, both backends): the guards each commit carries', () => {
  it.each(['memory', 'sqlite'] as const)('D5 %s: the pointer moves under a held serving claim and a held plain claim: the first conflicts, the second commits', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 'd5-a');
    const requested = await dispatch(p1, a, p1.task.tA, 'd5-dispatch');
    const servingStep = await p1.claimStep(p1.lines.E, p1.task.tA, 'd5-served');
    const plainStep = await p1.claimStep(p1.lines.E2, p1.task.tD, 'd5-plain');
    const pointerBefore = (await readS7A2DispatchBasis(p1.world, p1.goal)).pointerRevision;
    const heldServing = commitBarrier.hold(claimCommitOf(p1.task.tA), 'D5 serving claim');
    const heldPlain = commitBarrier.hold(claimCommitOf(p1.task.tD), 'D5 plain claim');
    // Not held, only noted: a second tD claim commit is the Workflow re-claiming after a conflict of the first, which
    // would hide a pointer guard on the plain claim behind a final `committed` (ruling X2). The first tD commit is
    // `heldPlain`'s (holds match in creation order), so this match only ever sees a second one; it is noted in the
    // match itself, since on the right code `reached` never resolves.
    const isTdClaim = claimCommitOf(p1.task.tD);
    let reclaimed = false;
    const plainAgain = commitBarrier.hold(commit => {
      if (!isTdClaim(commit)) return false;
      reclaimed = true;
      return true;
    }, 'D5 plain re-claim');
    plainAgain.release();
    const serving = hostClaim(p1.world, servingStep, { servedRequest: await served(p1, actionRefOf(requested)) });
    const plain = performClaim(p1.world, plainStep);
    let servingResult: unknown;
    try {
      // Both claims have read; one pointer move lands between their reads and their commits (ruling S1).
      await reachedBefore(heldServing.reached, serving);
      await reachedBefore(heldPlain.reached, plain);
      await moveS7APointer(p1.world, p1.goal);
      heldServing.release();
      servingResult = await serving;
    } finally {
      heldServing.release();
      heldPlain.release();
    }
    expect((await readS7A2DispatchBasis(p1.world, p1.goal)).pointerRevision).not.toEqual(pointerBefore);
    expect(servingResult).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await plain).toMatchObject({ status: 'committed' });
    expect(reclaimed).toBe(false);
    expect(await dispatchSequence(p1)).toBe(0);
    expect(await requestOf(p1, actionRefOf(requested))).toMatchObject({ state: 'open' });
  }, LONG);

  it.each(['memory', 'sqlite'] as const)('D6 %s: two serving claims read the same counter: exactly one commits', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 'd6-a');
    const forA = await dispatch(p1, a, p1.task.tA, 'd6-dispatch-ta');
    const forD = await dispatch(p1, a, p1.task.tD, 'd6-dispatch-td');
    const stepA = await p1.claimStep(p1.lines.E, p1.task.tA, 'd6-ta');
    const stepD = await p1.claimStep(p1.lines.E2, p1.task.tD, 'd6-td');
    const heldA = commitBarrier.hold(claimCommitOf(p1.task.tA), 'D6 tA claim');
    const heldD = commitBarrier.hold(claimCommitOf(p1.task.tD), 'D6 tD claim');
    const claimA = hostClaim(p1.world, stepA, { servedRequest: await served(p1, actionRefOf(forA)) });
    const claimD = hostClaim(p1.world, stepD, { servedRequest: await served(p1, actionRefOf(forD)) });
    try {
      await reachedBefore(heldA.reached, claimA);
      await reachedBefore(heldD.reached, claimD);
    } finally {
      heldA.release();
    }
    const first = await claimA;
    heldD.release();
    const second = await claimD;
    expect(first).toMatchObject({ status: 'committed' });
    expect(second).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await dispatchSequence(p1)).toBe(1);
    expect(await requestOf(p1, actionRefOf(forD))).toMatchObject({ state: 'open' });
  }, LONG);

  it.each(['memory', 'sqlite'] as const)('D7 %s: a dispatch lands under a held plain claim: the claim conflicts, and its retry applies the request', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 'd7-a');
    const held = commitBarrier.hold(claimCommitOf(p1.task.tA), 'D7 plain claim');
    const first = performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'd7'));
    const requesting = (async () => {
      await reachedBefore(held.reached, first);
      return await dispatch(p1, a, p1.task.tA, 'd7-dispatch');
    })();
    const requested = await requesting.finally(() => held.release());
    expect(requested).toMatchObject({ status: 'requested' });
    // Through `workflow/advance` the Workflow retries its own conflicted claim with a fresh read; only that conflict
    // and re-read can see the request written after the held reads, so only they apply it (a claim that does not
    // guard the absent hold commits on its first read and leaves the request open).
    const claimed = await first;
    expect(claimed).toMatchObject({ status: 'committed' });
    expect(await requestOf(p1, actionRefOf(requested))).toMatchObject({ state: 'applied',
      outcome: { session: claimed.value?.sessionRef, run: claimed.value?.runRef, byRequest: false } });
  }, LONG);

  it.each(['memory', 'sqlite'] as const)('D8 %s: A\'s round ends under its held dispatch commit: conflict, nothing written', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 'd8-a');
    const held = commitBarrier.hold(dispatchCommit, 'D8 dispatch');
    const requesting = dispatch(p1, a, p1.task.tA, 'd8-dispatch');
    try {
      await reachedBefore(held.reached, requesting);
      await a.end();
    } finally {
      held.release();
    }
    expect(await requesting).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    // No public step returned a request ref, so "the request reads nothing" shows as the Task's empty pointer.
    expect((await holdOf(p1, p1.task.tA))?.openDispatch ?? null).toBeNull();
  }, LONG);

  it.each(['memory', 'sqlite'] as const)('C1 %s: a plain claim of tA commits while A\'s dispatch of tA waits after its reads: the dispatch conflicts', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 'c1-a');
    const step = await p1.claimStep(p1.lines.E, p1.task.tA, 'c1');
    const held = commitBarrier.hold(dispatchCommit, 'C1 dispatch');
    const requesting = dispatch(p1, a, p1.task.tA, 'c1-dispatch');
    let claimed: unknown;
    try {
      await reachedBefore(held.reached, requesting);
      claimed = await performClaim(p1.world, step);
    } finally {
      held.release();
    }
    expect(claimed).toMatchObject({ status: 'committed' });
    expect(await requesting).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect((await holdOf(p1, p1.task.tA))?.openDispatch ?? null).toBeNull();
  }, LONG);
});
