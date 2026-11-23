/**
 * P2 T5 (frozen `p2-frozen.md:320`): the every-step action cards. The frozen public entry is
 * the new action tool called by the scripted model (`dispatch_task`/`request_stop`), the
 * `decisions/queue` card read and `decisions/answer`. 红-setup：G3 的
 * `buildStageTwo`/`readRunningCommands` 装配（`src/app/core-routes.ts:1301`）。
 * No owner seeding or old path is substituted for the card.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { hostClaim } from '../helpers/P1-platform-entry.js';
import {
  dispatchSequence, holdOf, performClaim, p1Worlds, pointerRef, requestOf, reworkPins, steersOf,
} from '../helpers/P1-reads.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { settleHost } from '../helpers/IV-host-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { dexcAnswer } from '../helpers/S7D2-coldstart-world.js';
import type { P1World } from '../helpers/P1-round-fixture.js';

const worlds = p1Worlds();
afterEach(async () => { await worlds.closeAll(); });
const LONG = 600_000;

/** A role's held planning round whose model reply is the named action tool call. */
async function toolRound(p1: P1World, label: string, name: string, args: Record<string, unknown>) {
  await p1.world.scripted.script(p1.lines.A, [{ kind: 'calls',
    calls: [{ callId: `p2-${label}-call`, name, args }] },
  { kind: 'text', text: `P2 T5 ${label} round answer` }]);
  const round = await p1.hold(p1.lines.A, label);
  await round.end().catch(() => undefined);
  await settleHost(p1.world);
}

describe('T5 every-step action cards', () => {
  it('T5a a dispatch_task request produces one action_release card', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    await toolRound(p1, 't5a', 'dispatch_task', { taskRef: p1.task.tA, reason: 'P2 T5 dispatch' });
    expect((await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(card => card.source.kind === 'action_release')).toHaveLength(1);
  }, LONG);

  it('T5b a request_stop request on a running Task produces one action_release card', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    await toolRound(p1, 't5b', 'request_stop', { taskRef: p1.task.tB, reason: 'P2 T5 stop' });
    expect((await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(card => card.source.kind === 'action_release')).toHaveLength(1);
  }, LONG);

  it('T5c a waiting dispatch card still lets the Task be claimed, and that claim closes the card', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    await toolRound(p1, 't5c', 'dispatch_task', { taskRef: p1.task.tA, reason: 'P2 T5 pending dispatch' });
    const card = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(entry => entry.source.kind === 'action_release')
      .find(entry => entry.state === 'waiting_answer'
      && entry.taskRef?.taskId === 'p1-ta');
    expect(card, 'the dispatch card waits').toBeDefined();
    if (card === undefined) throw new Error('T5 T5c: no waiting dispatch card');
    /* The card is pending and does not block the Task: the Workflow's own ordinary claim commits. */
    expect(await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 't5c-claim')))
      .toMatchObject({ status: 'committed' });
    /* 设计 4.2: the closed card keeps its request details; the queue lists only waiting action cards (no request
       index, `views/decision-read-model.ts`), so the card is read back by its own source. */
    const closed = (await p1.world.post('decisions/card', plain(S6A_SCOPE, { source: card.source }))).body;
    expect(closed, 'the claim closes the waiting card').toMatchObject({ status: 'ready', value: {
      state: 'closed', closedReason: 'source_resolved',
      actionRelease: { state: 'applied', outcome: { kind: 'applied', byRequest: false } } } });
    expect((await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(entry => entry.source.kind === 'action_release')
      .find(entry => entry.state === 'waiting_answer'
      && entry.taskRef?.taskId === 'p1-ta'), 'no dispatch card waits after the claim').toBeUndefined();
    /* An ordinary (not served) claim settles the request without moving the counter. */
    expect(await dispatchSequence(p1)).toBe(0);
  }, LONG);

  it('T5d approving a waiting dispatch request lets the Goal loop claim the Task exactly once', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    await toolRound(p1, 't5d', 'dispatch_task', { taskRef: p1.task.tD, reason: 'P2 T5 approved dispatch' });
    const card = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(entry => entry.source.kind === 'action_release')
      .find(entry => entry.state === 'waiting_answer'
      && entry.taskRef?.taskId === 'p1-td');
    expect(card, 'the dispatch card waits').toBeDefined();
    if (card === undefined) throw new Error('T5 T5d: no waiting dispatch card');
    const request = pointerRef((await holdOf(p1, p1.task.tD))?.openDispatch);
    expect(request, 'the request holds the Task openDispatch slot').not.toBeNull();
    if (request === null) throw new Error('T5 T5d: no open dispatch request');
    expect(await requestOf(p1, request)).toMatchObject({ state: 'pending' });

    const answered = await dexcAnswer(p1.world, card, 'approve', '', 'p2-t5-t5d-answer');
    expect(answered, 'the card answer commits').toMatchObject({ status: 'ready' });
    const opened = await requestOf(p1, request);
    expect(opened, 'the approved request is open').toMatchObject({ state: 'open' });
    if (opened === null) throw new Error('T5 T5d: the approved request is gone');

    const claimed = await hostClaim(p1.world, await p1.claimStep(p1.lines.E2, p1.task.tD, 't5d-claim'),
      { servedRequest: { ref: request, revision: opened.revision } });
    expect(claimed, 'the Goal loop claims the approved request once').toMatchObject({ status: 'committed' });
    expect(await dispatchSequence(p1), 'a served claim moves the counter once').toBe(1);
    const applied = await requestOf(p1, request);
    expect(applied, 'the request is applied').toMatchObject({ state: 'applied' });
    /* MP-8 (lead 11-23): the person's approval armed the workspace, so the Host runs the claimed Run on. The Goal
       loop's next step for tD is no second claim, and the request and the counter stay where the one claim left them. */
    await settleHost(p1.world);
    const again = (await p1.world.post('workflow/advance', plain(S6A_SCOPE, { schemaVersion: 1, goalRef: p1.goal,
      flowId: 'p1-claim-t5d-again', sessionHint: p1.lines.E2.ref, kind: 'select_work', taskId: p1.task.tD.taskId,
    }))).body as { status: string; value?: { next: { kind: string; operation?: { kind: string } } | null } };
    expect(again.status).toBe('ready');
    expect(again.value?.next?.operation?.kind, 'no second claim of tD').not.toBe('claim_task');
    expect(await dispatchSequence(p1), 'still one served claim').toBe(1);
    expect(await requestOf(p1, request)).toMatchObject({ state: 'applied', revision: applied?.revision });
  }, LONG);

  it('T5e a stop card still waiting when the Run ends approves into a stop hold and run_ended, still unclaimable', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    await toolRound(p1, 't5e', 'request_stop', { taskRef: p1.task.tB, reason: 'P2 T5 stop' });
    const card = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(entry => entry.source.kind === 'action_release')
      .find(entry => entry.state === 'waiting_answer'
      && entry.taskRef?.taskId === 'p1-tb');
    expect(card, 'the stop card waits').toBeDefined();
    if (card === undefined) throw new Error('T5 T5e: no waiting stop card');
    const request = pointerRef((await holdOf(p1, p1.task.tB))?.pendingStop);
    expect(request, 'the stop card occupies pendingStop').not.toBeNull();
    if (request === null) throw new Error('T5 T5e: no pending stop request');
    const run = p1.runB;
    if (run === null) throw new Error('T5 T5e: tB is not running');
    /* The original Run ends before the person answers the card. */
    await p1.endB();

    const answered = await dexcAnswer(p1.world, card, 'approve', '', 'p2-t5-t5e-answer');
    expect(answered, 'the stop card answer commits').toMatchObject({ status: 'ready' });
    expect(await requestOf(p1, request), 'the stop is released with run_ended and no steer').toMatchObject({
      state: 'released', outcome: { kind: 'released', notSent: 'run_ended' },
    });
    const hold = await holdOf(p1, p1.task.tB);
    expect(hold?.reasons.filter(reason => reason.kind === 'stop' && reason.state === 'held')
      .map(reason => reason.reason)).toEqual(['P2 T5 stop']);
    expect(pointerRef(hold?.pendingStop), 'the card slot is cleared').toBeNull();
    expect(await steersOf(p1.world, run), 'no stop is sent to the ended Run').toEqual([]);

    /* The person reworks the ended Run; the stop hold still keeps the Task unclaimable. */
    const requeued = await p1.world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
      taskRef: p1.task.tB, afterRunRef: run, reason: 'P2 T5 rework',
    }, 'p2-t5-t5e-requeue', await reworkPins(p1, run)));
    expect(requeued.body).toMatchObject({ status: 'committed' });
    const claim = await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tB, 't5e-claim'));
    expect(claim, 'the Task still cannot be claimed').toMatchObject({ status: 'rejected', code: 'busy' });
    expect(claim.reason).toContain('P2 T5 stop');
  }, LONG);

  it('T5f an agent inquiry message under every_step makes no action_release card', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    await toolRound(p1, 't5f', 'dispatch_task', { taskRef: p1.task.tA, reason: 'P2 T5 control dispatch' });
    /* The P1 world's tC already waits on its every-step rework cards (`P1-round-fixture.ts:103`); only the action
       cards count here. */
    expect((await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(card => card.state === 'waiting_answer' && card.source.kind === 'action_release'),
    'the dispatch control card').toHaveLength(1);
    /* A real Work Run's `send_session_message` asks the adviser a question: a message, not an action. */
    await p1.world.scripted.script(p1.lines.E2, [
      { kind: 'calls', calls: [{ callId: 'p2-t5f-inquiry', name: 'send_session_message', args: {
        recipient: p1.lines.A.ref, text: 'P2 T5 inquiry', needsReply: true,
      } }] },
      { kind: 'text', text: 'P2 T5 inquiry done' },
    ]);
    await driveWorkflow(p1.world.ag2b, await p1.claimStep(p1.lines.E2, p1.task.tD, 't5f-send'),
      { stopBefore: 'open_checks' });
    const outbox = (await p1.world.post('messages/outbox', plain(S6A_SCOPE, {
      senderSession: p1.lines.E2.ref, page: { limit: 20 },
    }))).body as { status: string; value?: { items: unknown[] } };
    expect(outbox, 'the inquiry is sent').toMatchObject({ status: 'ready' });
    expect(outbox.value?.items, 'one inquiry message').toHaveLength(1);
    expect((await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(card => card.state === 'waiting_answer' && card.source.kind === 'action_release'),
    'an inquiry adds no card').toHaveLength(1);
  }, LONG);
});
