/**
 * P2 T28 (frozen `p2-frozen.md:357`; P1 Q4b): a same-source candidate settled after the hold's
 * cursor invalidates that reason at the claim; a scribe cause on another Task keeps that Task
 * unclaimable. The candidate is submitted by the real `submit_plan_round` tool of the same held S
 * round that places the hold (one source message), changes tA, and is settled through
 * `plans/abandon` with the Goal and PlanProposal pins a candidate card carries. The scribe cause is
 * on tB, so "the scribe reason remains" and "tA can be claimed" hold together (lead 11-23: 取甲).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import type { PlanProposal, PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { placeScribeStop } from '../helpers/P1-platform-entry.js';
import { dispatchSequence, holdOf, p1Worlds, performClaim, pointerRef, write } from '../helpers/P1-reads.js';
import { abandonCandidate, readProposal } from '../helpers/IV-host-fixture.js';
import { plPlanChangeDraft, plToolPlanOf } from '../helpers/PL-workflow-fixture.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';

const worlds = p1Worlds();
afterEach(async () => { await worlds.closeAll(); });
const LONG = 600_000;

/**
 * The candidate the held round's own `submit_plan_round` wrote: the waiting candidate card of the Goal whose
 * PlanProposal came from that round's source message. `submit_plan_round` is the planning round's answer tool, so the
 * round ends on it and no later model request carries its receipt; the card is the public read of the candidate.
 */
async function planRoundProposal(world: S6AHostWorld, goal: GoalRef, source: SessionMessageRef): Promise<PlanProposal> {
  const cards = (await s6aCardsWorkspace(world, S6A_SCOPE).readCards(goal))
    .filter(card => card.source.kind === 'candidate' && card.state === 'waiting_answer');
  const proposals: PlanProposal[] = [];
  for (const card of cards) {
    for (const object of card.objects) {
      if (object.kind !== 'aggregate' || object.pin.ref.aggregateType !== 'PlanProposal') continue;
      proposals.push(await readProposal(world, object.pin.ref as PlanProposalRef));
    }
  }
  const mine = proposals.filter(proposal => proposal.sourceMessageRef?.messageId === source.messageId);
  if (mine.length !== 1) {
    throw new Error(`T28: the held round has ${String(mine.length)} waiting candidates: ${JSON.stringify(proposals.map(p => p.ref))}`);
  }
  return mine[0]!;
}

describe('T28 same-source candidate invalidates the hold', () => {
  it('T28 S holds tA and submits a same-round candidate that changes tA; abandoning it lets tA be claimed while tB\'s scribe cause still blocks tB', async () => {
    const p1 = await worlds.open();
    // Both Tasks first get their own real Run: tA's candidate later supersedes tA, tB only gets the scribe cause.
    const runA = await p1.failWork(p1.lines.E, p1.task.tA, 'p2-t28-run-a');
    const runB = await p1.failWork(p1.lines.E, p1.task.tB, 'p2-t28-run-b');
    const plan = await s6aCardsWorkspace(p1.world, S6A_SCOPE).activePlan(p1.goal);
    if (plan === null) throw new Error('T28: the Goal has no adopted Plan');
    // A real change to tA (its title), through the plan-round tool: the candidate really touches tA.
    const draft = plPlanChangeDraft(plan, p1.goal, {
      planId: 'p2-t28-plan',
      tasks: plan.tasks.map(task => task.taskId === p1.task.tA.taskId
        ? { ...task, title: 'P2 T28 changed tA' } : task),
      assignments: plan.assignments ?? [], obligations: plan.obligations,
    });
    // The same S round both places the hold and writes the candidate: its source message is one and the same.
    // S's own reply queue (FIFO per Session, `S6A-host-fixture.ts:329`); `hold` appends the round's closing text
    // answer (`P1-round-fixture.ts:112`), so the call goes first on that queue, not on the world's shared replies.
    await p1.world.scripted.script(p1.lines.S, [{ kind: 'calls', calls: [{ callId: 'p2-t28-plan',
      name: 'submit_plan_round', args: { answerKind: 'plan', summary: 'P2 T28 candidate',
        plan: plToolPlanOf(draft), reason: { text: 'P2 T28 same-source candidate', affectedTaskIds: [p1.task.tA.taskId] } } }] }]);
    const s = await p1.hold(p1.lines.S, 'p2-t28-hold');
    expect(await p1.world.platform.claimHolds.place(s.ctx,
      write({ taskRef: p1.task.tA, reason: 'P2 T28 secretary hold' }, 'p2-t28-hold-s')))
      .toMatchObject({ status: 'committed' });
    await s.end();

    // The candidate is the plan round's own committed tool receipt; abandon it with the Goal + PlanProposal pins.
    const candidate = await planRoundProposal(p1.world, p1.goal, s.source);
    expect(candidate.status).toBe('candidate');
    await abandonCandidate(p1.world, p1.goal, candidate, 'p2-t28-abandon');

    // tB keeps the scribe cause; that reason alone still blocks tB. tB's Run failed its check, so the Workflow's own
    // next step for tB is the automatic rework, and a scribe cause also stops that rework (frozen :189): the Workflow
    // waits on the hold before it ever reaches a claim of tB.
    expect(await placeScribeStop(p1.world, { taskRef: p1.task.tB, reason: 'P2 T28 scribe stop',
      sourceMessage: s.source, run: runB, operationId: 'p2-t28-scribe' }, 'p2-t28-scribe'))
      .toMatchObject({ status: 'committed' });
    const tBSteps = await driveWorkflow(p1.world.ag2b, { schemaVersion: 1, goalRef: p1.goal, flowId: 'p2-t28-claim-b',
      sessionHint: p1.lines.E.ref, kind: 'select_work', taskId: p1.task.tB.taskId }, { stopBefore: 'claim_task' });
    expect(tBSteps.at(-1), 'the scribe cause keeps tB unclaimable').toMatchObject({
      state: 'waiting', next: null, waitBasis: { reasons: ['claim_hold:scribe_stop'] } });
    expect((await holdOf(p1, p1.task.tB))?.reasons).toMatchObject([
      { kind: 'scribe_stop', reason: 'P2 T28 scribe stop', state: 'held' }]);

    // tA: the S reason was invalidated by the same-source candidate, so the claim commits.
    const before = await dispatchSequence(p1);
    const claimed = await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'p2-t28-claim'));
    expect(claimed, `T28 claim: ${JSON.stringify(claimed)}`).toMatchObject({ status: 'committed' });
    // The expiry is the claim owner's read-time judgment: no writer, no scan (frozen :190, row :343 "没有写者/扫描"),
    // so the stored S reason is still the one S placed; only the claim saw it lapse.
    const tA = await holdOf(p1, p1.task.tA);
    expect(tA?.reasons.find(reason => reason.reason === 'P2 T28 secretary hold')?.state).toBe('held');
    expect(tA?.reasons.find(reason => reason.reason === 'P2 T28 scribe stop')).toBeUndefined();
    // No dispatch request here: an ordinary claim moves no counter and no request pointer (frozen :185).
    expect(await dispatchSequence(p1)).toBe(before);
    expect(pointerRef(tA?.openDispatch)).toBeNull();
  }, LONG);
});
