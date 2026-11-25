/**
 * P6G G3 (lead start ruling `p6g-rulings.md` §G3 and its test line, supplementary ruling 2 item 3, code-review ruling
 * `p6gcr-rulings.md` T3 and the last round's Q1/Q3; P6 diagnosis 2 rows 26–27, "waiting"): a member's wait outlives a crash. The requeue after
 * the crash continues the Task with the Task's last yielded wait: a reply already saved for it (or its recorded expiry)
 * is consumed once by the continuation as the wait's input (`consumesWait`), not handed over as a new question. When
 * the waiting line L is healthy and only that wait excludes it from the pick, the requeue reuses L with the wait
 * ("先复用合适的成员", B19), never an idle line of the same Role.
 * An earlier open wait of the Task on the source line holds a later answered one back (G3-5), and a withdrawn wait
 * is never carried, even after its expiry (G3-6).
 *
 * The E2E order (diagnosis "waiting" timeline 03:25:50–03:28:53), every step public: line L's real Run sends wait A
 * with `waitAfterSend` and yields; the person writes to L on that Task and the Host's one intervention call
 * (`interveneS7B`, the published `workflow.handleIntervention`) claims the Task; that Run is held at its model request;
 * A gets its outcome (the recipient's real Run answers it and asks L back, or the published expiry owner records it on
 * the injected clock); the Host crashes (`world.crash`, a same-directory reopen; L reads healthy afterwards); the named
 * `workflow/advance` requeues the crashed Run and claims it. Facts are read through `messages/outbox`,
 * `messages/read`, `sessions/read` and the Runs' own tool results. SQLite only: a Host crash and reopen (RULES S3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { callPublishedOwnerAsHost, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { S7A_REPLY_TOOLS, claimedRunOf, committed, ready, sameRun, sessionOf } from '../helpers/S7A-fixture.js';
import { interveneS7B, s7bVWorkProfile } from '../helpers/S7B-V-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

type WaitWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly goal: GoalRef;
  readonly tasks: readonly TaskTriple[];
  /** L: the line that sends the waits. */
  readonly waiting: S6ASession;
  readonly recipient: S6ASession;
};

type CrashedWait = WaitWorld & {
  /** An idle line of L's Role, when the row asks for one. */
  readonly idle: S6ASession | null;
  readonly waitA: SessionMessage['ref'];
};

/**
 * SQLite S6A world (`openS7BWorld`'s Work binding plus `read_session_message` and `withdraw_session_message`), a Goal,
 * two Tasks, L and a recipient.
 */
async function openWaitWorld(label: string): Promise<WaitWorld> {
  const world = await openS6AHostWorld({ backend: 'sqlite', extraBindings: [S7A_REPLY_TOOLS,
    { ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message', 'read_session_message', 'withdraw_session_message'] }] });
  worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);
  const goal = (await main.createGoal(`${label}-goal`, 'P6G G3 goal')).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label, taskIds: [`${label}-send`, `${label}-reply`],
    role: S6A_WORK_ROLE.templateId });
  const waiting = await sessionOf(world, await createS6BLine(main, { label: `${label}-l`, role: S6A_WORK_ROLE,
    tasks: [tasks[0]!] }));
  const recipient = await sessionOf(world, await createS6BLine(main, { label: `${label}-recipient`,
    role: S6A_WORK_ROLE }));
  return { world, main, goal, tasks, waiting, recipient };
}

const askCall = (callId: string, to: S6ASession, text: string) => ({ kind: 'calls' as const, calls: [{ callId,
  name: 'send_session_message', args: { recipient: to.ref, text, needsReply: true, waitAfterSend: true } }] });

/** The wait message a yielded Run sent (`messages/outbox` of that Run). */
async function waitOf(scene: WaitWorld, run: RunRef, what: string): Promise<SessionMessage['ref']> {
  const outbox = ready<{ items: SessionMessage[] }>(await scene.world.post('messages/outbox',
    plain(S6A_SCOPE, { senderRun: run, page: { limit: 20 } })), `the ${what} outbox`);
  const wait = outbox.items.find(message => message.waitAfterSend === true)?.ref;
  if (wait === undefined) throw new Error(`${what}: no wait in the Run's outbox`);
  return wait;
}

/** The person writes to L on its Task and the Host's one intervention call claims it; returns the drive and its Run. */
async function intervene(scene: WaitWorld, label: string): Promise<{ drive: WorkflowAdvanceInput; run: RunRef }> {
  const task = scene.tasks[0]!;
  const person = committed<SessionMessage>(await scene.world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: scene.waiting.ref, text: `${label}: the person writes while L waits`, entry: 'person_intervention',
    needsReply: true, goalRef: scene.goal, taskRef: task,
  }, `${label}-person`)), 'the person message');
  const intervention = await interveneS7B(scene.world, person.ref, s7bVWorkProfile());
  if (intervention.status !== 'claimed') {
    throw new Error(`${label}: no intervention claim: ${JSON.stringify(intervention)}`);
  }
  const { runRef, sessionRef } = intervention.claim;
  return { run: runRef, drive: { schemaVersion: 1, goalRef: scene.goal, flowId: `intervention:${runRef.runId}`,
    sessionHint: sessionRef, kind: 'select_work', taskId: task.taskId } };
}

/**
 * The intervention Run is held at its model request (before the scripted model, so L's script keeps no reply for it)
 * and dies with the crash. With `afterTool`, the Run first makes that tool call (its result commits) and the model
 * request after it is the held one.
 */
async function holdThenCrash(scene: WaitWorld, drive: WorkflowAdvanceInput, beforeCrash: () => Promise<void>,
  afterTool?: string): Promise<void> {
  const tool = afterTool === undefined ? null : await scene.world.gates.toolCall(scene.waiting, afterTool);
  if (tool === null) {
    const held = await scene.world.gates.modelRequest(scene.waiting);
    void driveWorkflow(scene.world.ag2b, drive).catch(() => undefined);
    await held.reached;
  } else {
    void driveWorkflow(scene.world.ag2b, drive).catch(() => undefined);
    await tool.reached;
    const held = await scene.world.gates.modelRequest(scene.waiting);
    tool.release();
    await held.reached;
  }
  await beforeCrash();
  await scene.world.crash();
}

/** The recipient's own Run answers `message` (`replyS7AMessage`'s link and call) and then `after` (its last reply). */
async function answerAs(scene: WaitWorld, message: SessionMessage['ref'], label: string,
  after: Parameters<S6AHostWorld['scripted']['script']>[1][number]): Promise<void> {
  const { world, recipient } = scene;
  const before = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message)), 'the asked message');
  const card = await world.readSession(recipient);
  const target = { kind: 'task' as const, ref: scene.tasks[1]! };
  committed(await world.post('sessions/link', graphWrite(S6A_SCOPE, { sessionRef: recipient.ref, target,
    relation: 'responsible', active: true }, `${label}-reply-link`, [
    { ref: card.record.ref, revision: card.record.revision },
    { ref: { ...recipient.ref, aggregateType: 'SessionWorkLink', target, relation: 'responsible' }, revision: 0 }])),
  'the reply link');
  await world.scripted.script(recipient, [
    { kind: 'calls', calls: [{ callId: `${label}-reply`, name: 'respond_session_message', args: {
      messageRef: message, expectedRevision: before.revision, text: `${label}: the reply` } }] },
    after,
  ]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: scene.goal, flowId: `${label}-reply`,
    sessionHint: recipient.ref, kind: 'select_work', taskId: scene.tasks[1]!.taskId });
  expect(ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message)), 'the answered message')
    .status).toBe('responded');
}

/** The E2E order up to the reopen: wait A sent, A answered or expired, the intervention Run on L crashed. */
async function crashWhileWaiting(label: string, options: { idle: boolean; outcome: 'answer' | 'expire' }):
Promise<CrashedWait> {
  const scene = await openWaitWorld(label);
  const { world, main, waiting } = scene;
  // L's Run asks A and yields on it.
  await world.scripted.script(waiting, [askCall(`${label}-a`, scene.recipient,
    'P6G G3 wait A: which exports does num.js have?')]);
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: scene.goal, flowId: `${label}-wait`,
    sessionHint: waiting.ref, kind: 'select_work', taskId: scene.tasks[0]!.taskId }, { receipts });
  const waitA = await waitOf(scene, claimedRunOf(receipts, 'the G3 wait').run, 'A');
  const { drive } = await intervene(scene, label);
  await holdThenCrash(scene, drive, async () => {
    if (options.outcome === 'answer') {
      // The recipient answers A and then asks L back and waits on it, so it is no idle line of the Role.
      await answerAs(scene, waitA, label, askCall(`${label}-back`, waiting, 'P6G G3: and which tests cover double?'));
    } else {
      // A's deadline passes on the injected clock and the published expiry owner records it (the Host's call).
      world.clock.advance(86_400_000);
      expect(await callPublishedOwnerAsHost(world, 'P6G', { owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
        scope: S6A_SCOPE }, { messageRef: waitA })).toMatchObject({ status: 'committed' });
      expect(ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, waitA)), 'wait A'))
        .toMatchObject({ response: null, expiredAt: expect.any(String) });
    }
  });
  const idle = options.idle
    ? await sessionOf(world, await createS6BLine(main, { label: `${label}-y`, role: S6A_WORK_ROLE }))
    : null;
  return { ...scene, idle, waitA };
}

/** After the reopen: the named advance requeues the crashed Run and claims it; stops before its start. */
async function requeueClaim(scene: WaitWorld, label: string): Promise<{ line: SessionRef; run: RunRef;
  start: WorkflowAdvanceInput }> {
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(scene.world.ag2b, { schemaVersion: 1, goalRef: scene.goal, flowId: `${label}-after`,
    sessionHint: null, kind: 'select_work', taskId: scene.tasks[0]!.taskId }, { stopBefore: 'start', receipts });
  const claim = receipts.find(receipt => receipt.kind === 'claim_task' && receipt.result.status === 'committed');
  const start = steps.at(-1)?.next;
  if (claim === undefined || claim.kind !== 'claim_task' || claim.result.status !== 'committed'
    || start === null || start === undefined) {
    throw new Error(`${label}: the requeue made no claim: ${JSON.stringify(receipts.map(receipt => receipt.kind))}`);
  }
  return { line: { projectId: claim.result.value.sessionRef.projectId, sessionId: claim.result.value.sessionRef.sessionId },
    run: claim.result.value.runRef, start };
}

/**
 * The claimed line's model (optionally) reads `read` once and answers; the Run runs to its end. Returns the read
 * tool's result.
 */
async function runContinuation(scene: WaitWorld, claimed: { line: SessionRef; start: WorkflowAdvanceInput },
  label: string, read: SessionMessage['ref'] | null): Promise<{ status?: string;
  output?: { kind: string; value?: { ref?: SessionMessage['ref'] } }[] } | undefined> {
  const card = ready<SessionCard>(await scene.world.post('sessions/read', plain(S6A_SCOPE, claimed.line)),
    'the claimed line');
  const line: S6ASession = { label: `${label}-continuation`, ref: claimed.line, aggregateRef: card.record.ref,
    role: card.record.role, createdAt: card.record.createdAt };
  if (await scene.world.scripted.pending(line) !== 0) throw new Error(`${label}: the claimed line has unused replies`);
  await scene.world.scripted.script(line, [
    ...(read === null ? [] : [{ kind: 'calls' as const, calls: [{ callId: `${label}-read`, name: 'read_session_message',
      args: { messageRef: read } }] }]),
    { kind: 'text', text: 'P6G G3: the continuation has its wait\'s outcome' },
  ]);
  await driveWorkflow(scene.world.ag2b, claimed.start, { stopBefore: 'open_checks' });
  const requests = await scene.world.scripted.requests(line);
  return requests.flatMap(request => request.messages.flatMap(message =>
    message.role === 'tool' && message.callId === `${label}-read` ? [message.result] : []))[0] as
    { status?: string; output?: { kind: string; value?: { ref?: SessionMessage['ref'] } }[] } | undefined;
}

/** `message`'s `part` input is `run`'s wait input: accepted exactly once, consuming the wait. */
async function expectConsumedOnceBy(scene: WaitWorld, message: SessionMessage['ref'], part: 'response' | 'expiry',
  run: RunRef): Promise<void> {
  const after = ready<SessionMessage>(await scene.world.post('messages/read', plain(S6A_SCOPE, message)), 'the wait');
  const inputs = (after.acceptedInputs ?? []).filter(entry => entry.part === part);
  expect(inputs).toHaveLength(1);
  expect(inputs[0]).toMatchObject({ consumesWait: true });
  expect(sameRun(inputs[0]!.executionRef as RunRef, run)).toBe(true);
}

describe('G3: a wait outlives the crash on its continuation (SQLite: Host crash)', () => {
  it('G3-1: the requeue reuses the healthy waiting line L, reads wait A and consumes A\'s saved reply as the wait\'s '
    + 'reply', async () => {
    const scene = await crashWhileWaiting('p6g-g3-1', { idle: false, outcome: 'answer' });
    const claimed = await requeueClaim(scene, 'p6g-g3-1');
    // L is healthy and only its wait keeps it from the pick: the requeue continues on L (supplementary ruling 2 item 3).
    expect(claimed.line.sessionId).toBe(scene.waiting.ref.sessionId);
    const read = await runContinuation(scene, claimed, 'p6g-g3-1', scene.waitA);
    expect(read?.status).toBe('success');
    expect(read?.output?.find(entry => entry.kind === 'json')?.value?.ref).toEqual(scene.waitA);
    await expectConsumedOnceBy(scene, scene.waitA, 'response', claimed.run);
  }, 240_000);

  it('G3-2: with an idle line Y of the same Role in the pool, the requeue still continues on L and consumes the wait '
    + 'once', async () => {
    const scene = await crashWhileWaiting('p6g-g3-2', { idle: true, outcome: 'answer' });
    const claimed = await requeueClaim(scene, 'p6g-g3-2');
    expect(claimed.line.sessionId).not.toBe(scene.idle!.ref.sessionId);
    expect(claimed.line.sessionId).toBe(scene.waiting.ref.sessionId);
    await runContinuation(scene, claimed, 'p6g-g3-2', scene.waitA);
    await expectConsumedOnceBy(scene, scene.waitA, 'response', claimed.run);
  }, 240_000);

  it('G3-3: A expired before the requeue: the continuation on L consumes A\'s expiry once and no reply', async () => {
    const scene = await crashWhileWaiting('p6g-g3-3', { idle: false, outcome: 'expire' });
    const claimed = await requeueClaim(scene, 'p6g-g3-3');
    expect(claimed.line.sessionId).toBe(scene.waiting.ref.sessionId);
    await runContinuation(scene, claimed, 'p6g-g3-3', null);
    await expectConsumedOnceBy(scene, scene.waitA, 'expiry', claimed.run);
    const after = ready<SessionMessage>(await scene.world.post('messages/read', plain(S6A_SCOPE, scene.waitA)), 'wait A');
    expect((after.acceptedInputs ?? []).filter(entry => entry.part === 'response')).toEqual([]);
  }, 240_000);

  // `p6gcr-rulings.md` "快核 p6gqc 后的最后一轮" Q1 (甲): an earlier open wait of the Task on the source line holds the
  // later answered one back on every path, the new line included.
  it('G3-5: L waits on A, then on B for the same Task; A is open, B answered, no idle line: the requeue\'s new line '
    + 'carries no wait and B is not consumed', async () => {
    const label = 'p6g-g3-5';
    const scene = await openWaitWorld(label);
    const { world, waiting, recipient } = scene;
    // L's first Run asks A and yields; the person's first intervention Run asks B and yields on it.
    await world.scripted.script(waiting, [
      askCall(`${label}-a`, recipient, 'P6G G3-5 wait A: which exports does num.js have?'),
      askCall(`${label}-b`, recipient, 'P6G G3-5 wait B: which tests cover double?'),
    ]);
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: scene.goal, flowId: `${label}-wait-a`,
      sessionHint: waiting.ref, kind: 'select_work', taskId: scene.tasks[0]!.taskId }, { receipts });
    const waitA = await waitOf(scene, claimedRunOf(receipts, 'the wait A Run').run, 'A');
    const second = await intervene(scene, `${label}-1`);
    await driveWorkflow(world.ag2b, second.drive);
    const waitB = await waitOf(scene, second.run, 'B');
    // The recipient answers B and asks L back, so it is no idle line; the person writes again; the Host crashes.
    await answerAs(scene, waitB, label, askCall(`${label}-back`, waiting, 'P6G G3-5: and which file holds them?'));
    await holdThenCrash(scene, (await intervene(scene, `${label}-2`)).drive, async () => undefined);

    const claimed = await requeueClaim(scene, label);
    expect([waiting.ref.sessionId, recipient.ref.sessionId]).not.toContain(claimed.line.sessionId);
    await runContinuation(scene, claimed, label, null);
    const b = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, waitB)), 'wait B');
    expect((b.acceptedInputs ?? []).filter(entry => entry.part === 'response')).toEqual([]);
    const a = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, waitA)), 'wait A');
    expect(a.response ?? null).toBeNull();
  }, 240_000);

  // Q3 (丙): only an answered or expired wait is carried; a withdrawn one is not, even after its expiry.
  it('G3-6: A expired and was then withdrawn: the requeue carries no wait and claims a line', async () => {
    const label = 'p6g-g3-6';
    const scene = await openWaitWorld(label);
    const { world, waiting } = scene;
    await world.scripted.script(waiting, [askCall(`${label}-a`, scene.recipient,
      'P6G G3-6 wait A: which exports does num.js have?')]);
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: scene.goal, flowId: `${label}-wait-a`,
      sessionHint: waiting.ref, kind: 'select_work', taskId: scene.tasks[0]!.taskId }, { receipts });
    const waitA = await waitOf(scene, claimedRunOf(receipts, 'the wait A Run').run, 'A');
    // A's deadline passes and the published expiry owner records it; then the person's intervention Run on L
    // withdraws A (unread, unanswered, undelivered) and dies with the crash.
    world.clock.advance(86_400_000);
    expect(await callPublishedOwnerAsHost(world, 'P6G', { owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: S6A_SCOPE }, { messageRef: waitA })).toMatchObject({ status: 'committed' });
    await world.scripted.script(waiting, [{ kind: 'calls', calls: [{ callId: `${label}-withdraw`,
      name: 'withdraw_session_message', args: { messageRef: waitA } }] }]);
    await holdThenCrash(scene, (await intervene(scene, label)).drive, async () => {
      expect(ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, waitA)), 'wait A'))
        .toMatchObject({ response: null, expiredAt: expect.any(String), withdrawnAt: expect.any(String) });
    }, 'withdraw_session_message');

    // The ordinary requeue claims a line (no `waiting`), and nothing of A is consumed.
    const claimed = await requeueClaim(scene, label);
    await runContinuation(scene, claimed, label, null);
    const after = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, waitA)), 'wait A');
    expect((after.acceptedInputs ?? []).filter(entry => entry.part !== 'message')).toEqual([]);
  }, 240_000);
});
