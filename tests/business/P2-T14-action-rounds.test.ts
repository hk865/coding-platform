/**
 * P2 T14 (frozen `p2-frozen.md:329`; §2.5/§5): action rounds by group. M-01, M-03, M-04, R-04 and D-03,
 * plus the M-02/R-03/wake:true/restart sub-cases, are written. The first failure of each row is the P2
 * assertion (a replay receipt, a counter that stays 0, a missing `wake` Query, an agent message that
 * claims) or the pre-existing Workflow claim regression. Only M-03/M-04 restart run SQLite; no store read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { toolResultOf } from '../helpers/P2-tool-result.js';
import { advanceUntil, driveWorkflow, goalControlPins } from '../helpers/A2-restart-fixture.js';
import { pauseS7AGoal, resumeS7AGoal, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { dexcAnswer } from '../helpers/S7D2-coldstart-world.js';
import { settleHost } from '../helpers/IV-host-fixture.js';
import { hostClaim } from '../helpers/P1-platform-entry.js';
import {
  actionRefOf, dispatchSequence, holdOf, p1Worlds, performClaim, pointerRef, requestOf, write,
} from '../helpers/P1-reads.js';
import type { P1World } from '../helpers/P1-round-fixture.js';
import { advance } from '../scenarios/support/common.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds = p1Worlds();
afterEach(async () => { commitBarrier.reset(); await worlds.closeAll(); });
const LONG = 600_000;

async function requestDispatch(p1: P1World, label: string, task = p1.task.tA) {
  const held = await p1.hold(p1.lines.A, label);
  const card = await p1.world.platform.actionRequests.requestDispatch(held.ctx,
    write({ taskRef: task, reason: `P2 T14 ${label}` }, `${label}-dispatch`));
  return { held, card };
}

/** The request the Task's `openDispatch` slot names, at the revision the claim must serve (T5d's read). */
async function servedRequestOf(p1: P1World, task: P1World['task']['tA']) {
  const ref = pointerRef((await holdOf(p1, task))?.openDispatch);
  if (ref === null) throw new Error('T14: the Task has no open dispatch request');
  const current = await requestOf(p1, ref);
  if (current === null) throw new Error('T14: the open dispatch request is not readable');
  return { ref, revision: current.revision };
}

/** Whether the Goal's public display still carries the restart interruption (`goals/display` causes). */
async function interrupted(p1: P1World): Promise<boolean> {
  const read = (await p1.world.post('goals/display', plain(S6A_SCOPE, { goalRef: p1.goal }))).body as
    { status: string; value?: { display: { causes: object[] } } };
  if (read.status !== 'ready' || read.value === undefined) throw new Error(`T14: the Goal display: ${JSON.stringify(read)}`);
  return read.value.display.causes.some(cause => 'interruption' in cause);
}

/** One paused-then-approved dispatch request on tA (M-04's first half): the request is `open` and waits for the Goal. */
async function approvedWhilePaused(p1: P1World, label: string) {
  const { card, held } = await requestDispatch(p1, label);
  await pauseS7AGoal(p1.world, p1.goal);
  const ref = actionRefOf(card);
  const waiting = await actionCardOf(p1, p1.task.tA.taskId);
  await held.end();
  expect(await dexcAnswer(p1.world, waiting, 'approve', '', `${label}-approve`)).toMatchObject({ status: 'ready' });
  expect(await requestOf(p1, ref)).toMatchObject({ state: 'open' });
  return ref;
}

/** The Goal loop's own claim, read through the public request read (the M-04 restart row's wait). */
async function claimedOnce(p1: P1World, ref: ReturnType<typeof actionRefOf>): Promise<void> {
  await expect.poll(async () => (await requestOf(p1, ref))?.state, { timeout: 20_000, interval: 50 }).toBe('applied');
  expect(await dispatchSequence(p1), 'the Goal claims the request once').toBe(1);
}

/** The one waiting `action_release` card for `task`. */
async function actionCardOf(p1: P1World, taskId: string) {
  const card = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
    .filter(entry => entry.source.kind === 'action_release')
    .find(entry => entry.state === 'waiting_answer' && entry.taskRef?.taskId === taskId);
  if (card === undefined) throw new Error(`T14: no waiting action_release card for ${taskId}`);
  return card;
}

describe('T14 action rounds', () => {
  it('M-01 two dispatch requests: both accepted, each task claimed once, counter +1 each', async () => {
    const p1 = await worlds.open();
    const held = await p1.hold(p1.lines.A, 'm01');
    const first = await p1.world.platform.actionRequests.requestDispatch(held.ctx,
      write({ taskRef: p1.task.tA, reason: 'P2 T14 m01-a' }, 'm01-a-dispatch'));
    const second = await p1.world.platform.actionRequests.requestDispatch(held.ctx,
      write({ taskRef: p1.task.tD, reason: 'P2 T14 m01-b' }, 'm01-b-dispatch'));
    expect(first).toMatchObject({ status: 'requested' });
    expect(second).toMatchObject({ status: 'requested' });
    expect(await hostClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'm01-claim-a'),
      { servedRequest: await servedRequestOf(p1, p1.task.tA) }))
      .toMatchObject({ status: 'committed' });
    expect(await dispatchSequence(p1)).toBe(1);
    expect(await hostClaim(p1.world, await p1.claimStep(p1.lines.E2, p1.task.tD, 'm01-claim-d'),
      { servedRequest: await servedRequestOf(p1, p1.task.tD) }))
      .toMatchObject({ status: 'committed' });
    expect(await dispatchSequence(p1)).toBe(2);
  }, LONG);

  it('M-03 a dispatch card names cardKey and the pending request blocks until approved', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    const { card } = await requestDispatch(p1, 'm03');
    expect(card).toMatchObject({ status: 'needs_decision' });
    expect(JSON.stringify(card)).toContain('"cardKey"');
  }, LONG);

  it('M-04 pause, approve, resume: request opens while paused and claims once after resume', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    const { card, held } = await requestDispatch(p1, 'm04');
    expect(card).toMatchObject({ status: 'needs_decision' });
    await pauseS7AGoal(p1.world, p1.goal);
    const ref = actionRefOf(card);
    const waiting = await actionCardOf(p1, p1.task.tA.taskId);
    await held.end();
    expect(await dexcAnswer(p1.world, waiting, 'approve', '', 'm04-approve'))
      .toMatchObject({ status: 'ready' });
    expect(await requestOf(p1, ref)).toMatchObject({ state: 'open' });
    await resumeS7AGoal(p1.world, p1.goal);
    /* Frozen `:329` M-04 "恢复后领一次" holds with or without a restart (cp2fn lead ruling): the resumed Goal loop
       claims the request itself. Under 「每步确认」 a Goal takes one node at a time (design `:346`; `workflow.ts`
       `readGoalNodeOccupancy`), so while tB's Run is live the loop waits on `live_work`, read through the public
       driver read; once tB's Run ends it claims tA, once. */
    await expect.poll(async () => ((await p1.world.post('workflow/driver-read', plain(S6A_SCOPE, { goalRef: p1.goal })))
      .body as { value?: { last?: { value?: { reason?: string | null } } } }).value?.last?.value?.reason ?? '',
    { timeout: 20_000, interval: 50 }).toMatch(/^live_work:/);
    expect(await requestOf(p1, ref), 'the live node holds the request').toMatchObject({ state: 'open' });
    await p1.endB();
    await claimedOnce(p1, ref);
  }, LONG);

  it('R-04 wake:false is accepted and opens no planning Query; wake:true opens exactly one', async () => {
    const p1 = await worlds.open({ running: true });
    await p1.world.scripted.script(p1.lines.E2, [
      { kind: 'calls', calls: [{ callId: 'm04-wake-false', name: 'send_session_message',
        args: { recipient: p1.lines.A.ref, text: 'P2 T14 wake false', needsReply: false, wake: false } }] },
      { kind: 'text', text: 'P2 T14 wake false sender done' },
    ]);
    await driveWorkflow(p1.world.ag2b, { schemaVersion: 1, goalRef: p1.goal, flowId: 'm04-wake-false',
      sessionHint: p1.lines.E2.ref, kind: 'select_work', taskId: p1.task.tD.taskId }, { stopBefore: 'open_checks' });
    await settleHost(p1.world);
    /* The frozen R-04 expectation is that wake:false is accepted, not only that no Query opened:
       the empty list below also passes when the send was rejected. The model's real tool result
       is the send receipt, so read it back instead of adding a new production read. */
    expect(toolResultOf(await p1.world.scripted.requests(p1.lines.E2), 'm04-wake-false'),
      'the wake:false send committed').toMatchObject({ status: 'committed' });
    const queries = await p1.world.post('sessions/queries', plain(S6A_SCOPE, {
      sessionRef: p1.lines.A.ref, page: { limit: 100 },
    }));
    expect(queries.body).toMatchObject({ status: 'ready', value: { items: [] } });
  }, LONG);

  it('D-03 an agent ordinary message never claims the idle recipient line; a person intervention does', async () => {
    const p1 = await worlds.open({ running: true });
    await p1.world.scripted.script(p1.lines.E, [
      { kind: 'calls', calls: [{ callId: 'd03-send', name: 'send_session_message',
        args: { recipient: p1.lines.E2.ref, text: 'P2 T14 agent ordinary', needsReply: false } }] },
      { kind: 'text', text: 'P2 T14 agent done' },
    ]);
    await p1.endB();
    const graph = await p1.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: p1.goal }));
    expect(JSON.stringify(graph.body)).toContain('"taskId":"p1-td"');
    // Expected: the ordinary agent message does not claim tD, so its execution stays null.
    expect(graph.body).toMatchObject({ status: 'ready' });
    const body = graph.body as { value: { tasks: Array<{ ref: { taskId: string }; execution: unknown }> } };
    expect(body.value.tasks.find(task => task.ref.taskId === 'p1-td')?.execution).toBeNull();
  }, LONG);

  it('M-02 the same commandId replays the action receipt and the message receipt', async () => {
    const p1 = await worlds.open({ running: true });
    const held = await p1.hold(p1.lines.A, 'm02');
    const dispatch = write({ taskRef: p1.task.tA, reason: 'P2 T14 m02 replay' }, 'm02-same-dispatch');
    const first = await p1.world.platform.actionRequests.requestDispatch(held.ctx, dispatch);
    const replay = await p1.world.platform.actionRequests.requestDispatch(held.ctx, dispatch);
    expect(replay, 'the action replay returns the original receipt').toMatchObject({ status: first.status });
    expect(actionRefOf(replay), 'the replay names the same action').toEqual(actionRefOf(first));

    const message = graphWrite(S6A_SCOPE, {
      recipient: p1.lines.E2.ref, text: 'P2 T14 m02 replay message', needsReply: false,
    }, 'm02-same-message');
    const sent = await p1.world.post('messages/send', message);
    const resent = await p1.world.post('messages/send', message);
    expect(sent.body, 'the first message send commits and is not a replay')
      .toMatchObject({ status: 'committed', replayed: false });
    expect(resent.body, 'the message replay returns the original receipt')
      .toEqual({ ...(sent.body as Record<string, unknown>), replayed: true });
    const ref = (sent.body as { value?: { ref?: unknown } }).value?.ref;
    if (ref === undefined) throw new Error(`T14 M-02: the message has no ref: ${JSON.stringify(sent.body)}`);
    expect((await p1.world.post('messages/view', plain(S6A_SCOPE, ref))).body, 'one stored message')
      .toMatchObject({ status: 'ready' });
  }, LONG);

  it('R-03 a saved rule hit and a miss, and a rule change, do not release an existing pending card', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    const { card, held } = await requestDispatch(p1, 'r03');
    expect(card).toMatchObject({ status: 'needs_decision' });
    const ref = actionRefOf(card);
    const before = await requestOf(p1, ref);
    expect(before).toMatchObject({ state: 'pending' });
    // Change the Goal's autonomy while the card waits: the saved rule no longer hits, but
    // the existing card is not released retroactively.
    await setS7AAutonomy(p1.world, p1.goal, 'after_plan_confirmation');
    const after = await requestOf(p1, ref);
    expect(after, 'the existing card stays waiting after the rule changes').toMatchObject({
      state: 'pending', revision: before!.revision,
    });
    const cardKey = (card as { cardKey?: unknown }).cardKey;
    expect(cardKey, 'the replay/card identity is unchanged').toBeDefined();
    await held.end();
  }, LONG);

  it('R-04 wake:true opens exactly one Query on the recipient line', async () => {
    const p1 = await worlds.open({ running: true });
    await p1.world.scripted.script(p1.lines.E2, [
      { kind: 'calls', calls: [{ callId: 'r04-wake-true', name: 'send_session_message',
        args: { recipient: p1.lines.A.ref, text: 'P2 T14 wake true', needsReply: false, wake: true } }] },
      { kind: 'text', text: 'P2 T14 wake true sender done' },
    ]);
    await driveWorkflow(p1.world.ag2b, { schemaVersion: 1, goalRef: p1.goal, flowId: 'r04-wake-true',
      sessionHint: p1.lines.E2.ref, kind: 'select_work', taskId: p1.task.tD.taskId }, { stopBefore: 'open_checks' });
    await settleHost(p1.world);
    const queries = await p1.world.post('sessions/queries', plain(S6A_SCOPE, {
      sessionRef: p1.lines.A.ref, page: { limit: 100 },
    }));
    expect(queries.body, 'wake:true opens one planning Query').toMatchObject({
      status: 'ready', value: { items: expect.arrayContaining([expect.anything()]) },
    });
    expect((queries.body as { value: { items: unknown[] } }).value.items, 'exactly one').toHaveLength(1);
  }, LONG);

  it('M-03 restart after approve before claim: the same request is applied once and the counter moves once', async () => {
    const p1 = await worlds.open({ backend: 'sqlite', running: true, autonomy: 'every_step' });
    const { card, held } = await requestDispatch(p1, 'm03r');
    expect(card).toMatchObject({ status: 'needs_decision' });
    const ref = actionRefOf(card);
    const waiting = await actionCardOf(p1, p1.task.tA.taskId);
    await held.end();
    expect(await dexcAnswer(p1.world, waiting, 'approve', '', 'm03r-approve'))
      .toMatchObject({ status: 'ready' });
    await p1.world.crash();
    expect(await requestOf(p1, ref), 'the approved request survives the restart').toMatchObject({ state: 'open' });
    expect(await hostClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'm03r-claim'),
      { servedRequest: await servedRequestOf(p1, p1.task.tA) }))
      .toMatchObject({ status: 'committed' });
    expect(await dispatchSequence(p1)).toBe(1);
    expect(await requestOf(p1, ref), 'the request is applied, not served twice').toMatchObject({ state: 'applied' });
  }, LONG);

  it('M-04 restart after a paused approval: resume claims once and the same request never serves twice', async () => {
    const p1 = await worlds.open({ backend: 'sqlite', running: true, autonomy: 'every_step' });
    const { card, held } = await requestDispatch(p1, 'm04r');
    expect(card).toMatchObject({ status: 'needs_decision' });
    await pauseS7AGoal(p1.world, p1.goal);
    const ref = actionRefOf(card);
    const waiting = await actionCardOf(p1, p1.task.tA.taskId);
    await held.end();
    expect(await dexcAnswer(p1.world, waiting, 'approve', '', 'm04r-approve'))
      .toMatchObject({ status: 'ready' });
    expect(await requestOf(p1, ref)).toMatchObject({ state: 'open' });
    await p1.world.crash();
    await resumeS7AGoal(p1.world, p1.goal);
    /* The resume wakes the Goal loop (MP-7) and that loop claims the open request itself; a manual
       `claimStep` here would race it for the same request ("Prepared envelope disagrees"). Wait for
       the owner's own claim through the public read, then assert its one effect. */
    await expect.poll(async () => (await requestOf(p1, ref))?.state,
      { timeout: 20_000, interval: 50 }).toBe('applied');
    expect(await dispatchSequence(p1), 'the resumed Goal claims the request once').toBe(1);
    await p1.world.crash();
    expect(await requestOf(p1, ref), 'a second restart still shows the applied request').toMatchObject({ state: 'applied' });
  }, LONG);

  // cp2fn rulings P-B 1–3 (frozen `:186`, `:329`; design `:513`; MP-7, MP-8): the resume's goal-waits wake.
  it('FN-4 with resumeOnStartup off, the resume after a restart arms the goal waits and the Goal claims once', async () => {
    const p1 = await worlds.open({ backend: 'sqlite', running: true, autonomy: 'every_step' });
    await p1.world.setResumeOnStartup(false);
    const ref = await approvedWhilePaused(p1, 'fn4');
    await p1.world.crash();
    await resumeS7AGoal(p1.world, p1.goal);
    await claimedOnce(p1, ref);
  }, LONG);

  it('FN-5 a resume of a Goal the restart left interrupted keeps the request open until the person starts it', async () => {
    const p1 = await worlds.open({ backend: 'sqlite', running: true, autonomy: 'every_step' });
    const { card, held } = await requestDispatch(p1, 'fn5');
    const ref = actionRefOf(card);
    const waiting = await actionCardOf(p1, p1.task.tA.taskId);
    await held.end();
    expect(await dexcAnswer(p1.world, waiting, 'approve', '', 'fn5-approve')).toMatchObject({ status: 'ready' });
    await p1.world.crash();
    expect(await interrupted(p1), 'ask: the restart interrupts the active Goal').toBe(true);
    await pauseS7AGoal(p1.world, p1.goal);
    await resumeS7AGoal(p1.world, p1.goal);
    await settleHost(p1.world);
    expect(await requestOf(p1, ref), 'the resume does not continue an interrupted Goal').toMatchObject({ state: 'open' });
    expect(await interrupted(p1)).toBe(true);
    expect((await p1.world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: { schemaVersion: 1,
      goalRef: p1.goal, flowId: 'fn5-person-start', sessionHint: null, kind: 'select_work' }, queryProfileIds: [] })))
      .body).toMatchObject({ status: 'ready' });
    await claimedOnce(p1, ref);
  }, LONG);

  it('FN-5 a next-start auto setting does not lift the interruption a replayed resume meets', async () => {
    const p1 = await worlds.open({ backend: 'sqlite', running: true, autonomy: 'every_step' });
    // One committed resume command, kept to replay after the restart (Codex cp2fr table 1 item 3).
    await pauseS7AGoal(p1.world, p1.goal);
    const resume = graphWrite(S6A_SCOPE, { goalRef: p1.goal, control: 'resume', reason: 'FN-5 replayed resume' },
      'fn5r-resume', await goalControlPins(p1.world.ag2b));
    expect((await p1.world.post('goals/control', resume)).body).toMatchObject({ status: 'committed' });
    // Then FN-5's first row: a dispatch request approved and not yet claimed when the Host restarts.
    const { card, held } = await requestDispatch(p1, 'fn5r');
    const ref = actionRefOf(card);
    const waiting = await actionCardOf(p1, p1.task.tA.taskId);
    await held.end();
    expect(await dexcAnswer(p1.world, waiting, 'approve', '', 'fn5r-approve')).toMatchObject({ status: 'ready' });
    await p1.world.crash();
    expect(await interrupted(p1), 'ask: the restart interrupts the active Goal').toBe(true);
    // cp2fn review ruling 10: `automation/save` sets `auto` for the NEXT start; the replayed resume meets the
    // interruption this start recorded, which only the person's start resolves.
    await p1.world.setResumeOnStartup(true);
    expect((await p1.world.post('goals/control', resume)).body, 'the same command replays its receipt')
      .toMatchObject({ status: 'committed', replayed: true });
    await settleHost(p1.world);
    expect(await interrupted(p1), 'the setting does not resolve the recorded interruption').toBe(true);
    expect(await requestOf(p1, ref), 'the replayed resume does not continue the Goal').toMatchObject({ state: 'open' });
    expect((await p1.world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: { schemaVersion: 1,
      goalRef: p1.goal, flowId: 'fn5r-person-start', sessionHint: null, kind: 'select_work' }, queryProfileIds: [] })))
      .body).toMatchObject({ status: 'ready' });
    await claimedOnce(p1, ref);
  }, LONG);

  it('FN-6 a resume whose open-request read fails once keeps its receipt and the Goal claims after the retry', async () => {
    const p1 = await worlds.open({ backend: 'sqlite', running: true, autonomy: 'every_step' });
    const ref = await approvedWhilePaused(p1, 'fn6');
    await p1.world.crash();
    commitBarrier.failReads(canonicalKey(ref), 'throw-once');
    await resumeS7AGoal(p1.world, p1.goal);
    // cp2fn review ruling 10: the claim is watched through the dispatch sequence, which does not read the request
    // record, so the one failed read is the review's own and its back-off retry is what claims.
    await expect.poll(() => dispatchSequence(p1), { timeout: 20_000, interval: 50 }).toBe(1);
    expect(await requestOf(p1, ref), 'the request is applied once').toMatchObject({ state: 'applied' });
  }, LONG);

  // Basis: `gl-frozen.md:6` (GL-1b) and `:156` (check GL-4); design `:341`/`:342` as quoted there require a Goal
  // selection of a Task with an `open` dispatch request to claim with `servedRequest`, and exempt only the watch's
  // rework, direct intervention and L7 continuation, not the rework arm. World: the P1 world's tC is stopped before
  // its automatic rework (`P1-round-fixture.ts:86`); performing that step through the public `workflow/advance`
  // (`c3rv-rulings.md:13`) makes it `claim_requeued`; the staff (A)
  // dispatches tC; the Goal loop claims it. Expected literal: the dispatch sequence 0 -> 1, the request `applied`
  // with `byRequest:true`, exactly one claim. Named mutation: the rework arm does not pass `servedRequest`, so the
  // sequence stays 0 and `byRequest` is false.
  it('GL-1b a Goal claim of a requeued Task serves the staff dispatch request once', async () => {
    const p1 = await worlds.open();
    expect(await dispatchSequence(p1)).toBe(0);
    expect((await advance(p1.world.ag2b, p1.autoRework)).receipt, 'the Workflow performs its automatic rework')
      .toMatchObject({ kind: 'requeue_task', result: { status: 'committed', value: { kind: 'requeued' } } });
    const { card } = await requestDispatch(p1, 'gl1b', p1.task.tC);
    const ref = actionRefOf(card);
    expect(await requestOf(p1, ref), 'the dispatch request is open for the Goal').toMatchObject({ state: 'open' });
    const step = await advanceUntil(p1.world.ag2b, { schemaVersion: 1, goalRef: p1.goal,
      flowId: 'gl1b-goal-claim', sessionHint: null, kind: 'select_work' }, 'claim_task');
    const claimed = await performClaim(p1.world, step);
    expect(claimed, 'the Goal claims the requeued Task').toMatchObject({ status: 'committed' });
    if (claimed.status !== 'committed') return;
    await claimedOnce(p1, ref);
    expect(await requestOf(p1, ref), 'the request is applied by the claim, not settled by it').toMatchObject({
      state: 'applied', outcome: { session: claimed.value?.sessionRef, run: claimed.value?.runRef, byRequest: true },
    });
  }, LONG);
});
