/**
 * P2 T7 (frozen `p2-frozen.md:322`): the stop request reaches the person through the task
 * card. The frozen entries are `request_stop`/the action tool by the scripted model, the
 * `decisions/queue` card read and `decisions/answer`. 红-setup：G3 的
 * `buildStageTwo`/`readRunningCommands` 装配（`src/app/core-routes.ts:1301`）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { abandonCandidate, readProposal } from '../helpers/IV-host-fixture.js';
import { deliverStop, placeScribeStop } from '../helpers/P1-platform-entry.js';
import {
  holdOf, performClaim, p1Worlds, pointerRef, requestOf, reworkPins, runRecordOf, steersOf,
} from '../helpers/P1-reads.js';
import { plPlanChangeDraft, plToolPlanOf } from '../helpers/PL-workflow-fixture.js';
import type { P1World } from '../helpers/P1-round-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { dexcAnswer } from '../helpers/S7D2-coldstart-world.js';

const worlds = p1Worlds();
afterEach(async () => { await worlds.closeAll(); });
const LONG = 600_000;

async function stopRound(p1: P1World) {
  await p1.world.scripted.script(p1.lines.A, [{ kind: 'calls', calls: [{ callId: 'p2-t7-stop',
    name: 'request_stop', args: { taskRef: p1.task.tB, reason: 'P2 T7 stop' } }] },
  { kind: 'text', text: 'P2 T7 stop round answer' }]);
  const round = await p1.hold(p1.lines.A, 'p2-t7');
  await round.end().catch(() => undefined);
  return round;
}

/** The Task's one waiting `action_release` stop card. */
async function stopCard(p1: P1World, taskId: string) {
  return (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
    .find(card => card.source.kind === 'action_release' && card.state === 'waiting_answer'
      && card.taskRef?.taskId === taskId);
}

describe('T7 stop via the task card', () => {
  it('T7 an every-step request_stop leaves one action_release stop card for the person', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    await stopRound(p1);
    const cards = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(card => String(card.source.kind) === 'action_release');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.runRef).toEqual(p1.runB);
  }, LONG);

  it('T7a pausing the Run before the approval records person_stopped, writes no hold and resends nothing after a restart', async () => {
    const p1 = await worlds.open({ backend: 'sqlite', running: true, autonomy: 'every_step' });
    await stopRound(p1);
    const card = await stopCard(p1, 'p1-tb');
    expect(card, 'the stop card waits').toBeDefined();
    if (card === undefined) throw new Error('T7a: no waiting stop card');
    const request = pointerRef((await holdOf(p1, p1.task.tB))?.pendingStop);
    expect(request, 'the stop card occupies pendingStop').not.toBeNull();
    if (request === null) throw new Error('T7a: no pending stop request');
    const run = p1.runB;
    if (run === null) throw new Error('T7a: tB is not running');

    /* The person pauses the Run after the request froze its control pointer, before answering the card. */
    const runRevision = (await runRecordOf(p1.world, run)).revision;
    const paused = (await p1.world.post('controls/submit', graphWrite(S6A_SCOPE, {
      runRef: run, kind: 'pause', reason: 'P2 T7a pause',
    }, 'p2-t7a-pause', [{ ref: run, revision: runRevision }]))).body;
    expect(paused, 'the person pauses the Run').toMatchObject({ status: 'committed' });
    const answered = await dexcAnswer(p1.world, card, 'approve', '', 'p2-t7-answer');
    expect(answered, 'the stop card answer commits').toMatchObject({ status: 'ready' });

    expect(await requestOf(p1, request), 'a moved control pointer is person_stopped, not a hold').toMatchObject({
      state: 'released', outcome: { kind: 'released', notSent: 'person_stopped' },
    });
    const hold = await holdOf(p1, p1.task.tB);
    expect(hold?.reasons.filter(reason => reason.kind === 'stop'), 'no stop hold is written').toEqual([]);
    expect(await steersOf(p1.world, run), 'no stop is sent').toEqual([]);

    await p1.world.crash();
    expect(await requestOf(p1, request), 'the restart keeps person_stopped').toMatchObject({
      state: 'released', outcome: { notSent: 'person_stopped' },
    });
    expect(await steersOf(p1.world, run), 'the restart does not resend a stop').toEqual([]);
  }, LONG);

  it('T7b ending the Run before the approval records run_ended: one stop hold, no stop sent', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    await stopRound(p1);
    const card = await stopCard(p1, 'p1-tb');
    expect(card, 'the stop card waits').toBeDefined();
    if (card === undefined) throw new Error('T7b: no waiting stop card');
    const request = pointerRef((await holdOf(p1, p1.task.tB))?.pendingStop);
    expect(request).not.toBeNull();
    if (request === null) throw new Error('T7b: no pending stop request');
    const run = p1.runB;
    if (run === null) throw new Error('T7b: tB is not running');
    await p1.endB();

    const answered = await dexcAnswer(p1.world, card, 'approve', '', 'p2-t7-answer');
    expect(answered, 'the stop card answer commits').toMatchObject({ status: 'ready' });
    expect(await requestOf(p1, request), 'the ended Run is run_ended').toMatchObject({
      state: 'released', outcome: { kind: 'released', notSent: 'run_ended' },
    });
    const hold = await holdOf(p1, p1.task.tB);
    expect(hold?.reasons.filter(reason => reason.kind === 'stop' && reason.state === 'held')
      .map(reason => reason.reason)).toEqual(['P2 T7 stop']);
    expect(pointerRef(hold?.pendingStop), 'the card slot is cleared').toBeNull();
    expect(await steersOf(p1.world, run), 'no stop is sent to the ended Run').toEqual([]);
  }, LONG);

  it('T7c a queued, undelivered stop intent stays the one same intent across a restart and settles with the Run, with no new acceptance', async () => {
    const p1 = await worlds.open({ backend: 'sqlite', running: true, autonomy: 'every_step' });
    await stopRound(p1);
    const card = await stopCard(p1, 'p1-tb');
    expect(card, 'the stop card waits').toBeDefined();
    if (card === undefined) throw new Error('T7c: no waiting stop card');
    const request = pointerRef((await holdOf(p1, p1.task.tB))?.pendingStop);
    expect(request).not.toBeNull();
    if (request === null) throw new Error('T7c: no pending stop request');
    const run = p1.runB;
    if (run === null) throw new Error('T7c: tB is not running');
    const answered = await dexcAnswer(p1.world, card, 'approve', '', 'p2-t7-answer');
    expect(answered, 'the stop card answer commits').toMatchObject({ status: 'ready' });
    /* The platform automation delivers the released stop while the Run is still at its held model request. */
    await deliverStop(p1.world, request);
    const queued = await steersOf(p1.world, run);
    expect(queued, 'one queued stop intent').toMatchObject([{ kind: 'steer', status: 'queued' }]);
    const intentRef = queued[0]?.ref;
    const revision = (await requestOf(p1, request))?.revision;

    await p1.world.crash();
    /* lead 11-23, the reading of T7 (`p2-frozen.md:322`): the row assumes the original Run outlives the restart, but this
       platform's Host start-up reconcile ends it first (RUN-16/19/20/24), and its queued intent settles with it
       (CTL-08). What the row guards is "`queued` re-runs the acceptance": after the restart it is still the one same
       intent, the request is not accepted a second time (no new acceptance, no new card), and the intent settles with
       the ended Run. */
    const after = await steersOf(p1.world, run);
    expect(after, 'the restart keeps exactly one intent').toHaveLength(1);
    expect(after[0]?.ref, 'the same intent').toEqual(intentRef);
    expect((await runRecordOf(p1.world, run)).status, 'the restart ended the original Run').toBe('ended');
    expect(after[0]?.status, 'the intent settles with the ended Run').toBe('superseded');
    expect(await requestOf(p1, request), 'the request is not accepted again').toMatchObject({
      state: 'released', revision,
    });
    expect(await stopCard(p1, 'p1-tb'), 'no new stop card').toBeUndefined();
    const hold = await holdOf(p1, p1.task.tB);
    expect(pointerRef(hold?.pendingStop), 'no second stop request takes the slot').toBeNull();
    expect(hold?.reasons.filter(reason => reason.kind === 'stop').map(reason => reason.reason),
      'the one stop reason the approval wrote').toEqual(['P2 T7 stop']);
  }, LONG);

  it('T7d a settled same-source candidate invalidates the stop hold while another source stays held', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    /* Row order (frozen :322) 请求→交候选→批→候选了结: A's one round asks to stop tB and then submits a candidate
       that cancels tB, so the candidate has the stop request's source (design 3.3 :370, 同一来源) and comes after
       the request's cursor. Each Session's replies are a FIFO queue; `hold` appends the closing text answer. */
    const plan = await s6aCardsWorkspace(p1.world, S6A_SCOPE).activePlan(p1.goal);
    if (plan === null) throw new Error('T7d: the Goal has no adopted Plan');
    const draft = plPlanChangeDraft(plan, p1.goal, {
      planId: plan.planId,
      tasks: plan.tasks.map(task => task.taskId === 'p1-tb'
        ? { ...task, disposition: 'cancelled' as const } : task),
      assignments: plan.assignments ?? [], obligations: plan.obligations,
    });
    const beforeCandidates = new Set((await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(entry => entry.source.kind === 'candidate').map(entry => entry.cardKey));
    await p1.world.scripted.script(p1.lines.A, [
      { kind: 'calls', calls: [{ callId: 'p2-t7-stop', name: 'request_stop',
        args: { taskRef: p1.task.tB, reason: 'P2 T7 stop' } }] },
      { kind: 'calls', calls: [{ callId: 'p2-t7d-candidate', name: 'submit_plan_round',
        args: { answerKind: 'plan', summary: 'P2 T7d candidate', plan: plToolPlanOf(draft) } }] },
    ]);
    const round = await p1.hold(p1.lines.A, 'p2-t7d');
    await round.end().catch(() => undefined);
    const card = await stopCard(p1, 'p1-tb');
    expect(card, 'the stop card waits').toBeDefined();
    if (card === undefined) throw new Error('T7d: no waiting stop card');
    const request = pointerRef((await holdOf(p1, p1.task.tB))?.pendingStop);
    expect(request).not.toBeNull();
    if (request === null) throw new Error('T7d: no pending stop request');
    const run = p1.runB;
    if (run === null) throw new Error('T7d: tB is not running');
    const answered = await dexcAnswer(p1.world, card, 'approve', '', 'p2-t7-answer');
    expect(answered, 'the stop card answer commits').toMatchObject({ status: 'ready' });
    expect((await holdOf(p1, p1.task.tB))?.reasons).toMatchObject([
      { kind: 'stop', reason: 'P2 T7 stop', state: 'held' }]);

    /* The other source's reason: the scribe's hard stop, which never lapses with a candidate. */
    expect(await placeScribeStop(p1.world, { taskRef: p1.task.tB, reason: 'P2 T7 scribe stop',
      sourceMessage: round.source, run, operationId: 'p2-t7-scribe' }, 'p2-t7-scribe'))
      .toMatchObject({ status: 'committed' });

    /* The person abandons the round's candidate (settled), after the approval. */
    const created = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(entry => entry.source.kind === 'candidate' && !beforeCandidates.has(entry.cardKey)
        && entry.state === 'waiting_answer');
    const proposals: Awaited<ReturnType<typeof readProposal>>[] = [];
    for (const candidate of created) {
      for (const object of candidate.objects) {
        if (object.kind !== 'aggregate' || object.pin.ref.aggregateType !== 'PlanProposal') continue;
        proposals.push(await readProposal(p1.world, object.pin.ref));
      }
    }
    const sameSource = proposals.filter(proposal => proposal.sourceMessageRef?.messageId === round.source.messageId);
    expect(sameSource, 'the stop round wrote one waiting candidate').toHaveLength(1);
    await abandonCandidate(p1.world, p1.goal, sameSource[0]!, 'p2-t7d-abandon');

    /* The Run ends and the person reworks tB: the claim is where the lapsed stop reason is dropped. */
    await p1.endB();
    const requeued = await p1.world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
      taskRef: p1.task.tB, afterRunRef: run, reason: 'P2 T7d rework',
    }, 'p2-t7d-requeue', await reworkPins(p1, run)));
    expect(requeued.body).toMatchObject({ status: 'committed' });
    const claim = await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tB, 't7d-claim'));
    expect(claim, 'the scribe reason still keeps the Task unclaimable').toMatchObject({
      status: 'rejected', code: 'busy',
    });
    expect(claim.reason).toContain('P2 T7 scribe stop');
    expect(claim.reason, 'the lapsed stop reason no longer blocks').not.toContain('P2 T7 stop)');
    /* The lapse is the claim owner's read-time judgment, never written (frozen :190 不写、不扫库): the stored stop
       reason is the one the approval wrote. */
    const hold = await holdOf(p1, p1.task.tB);
    expect(hold?.reasons.find(reason => reason.reason === 'P2 T7 stop')?.state,
      'the stored stop reason is not rewritten').toBe('held');
    expect(hold?.reasons.find(reason => reason.reason === 'P2 T7 scribe stop')?.state,
      'the other source stays held').toBe('held');
  }, LONG);
});
