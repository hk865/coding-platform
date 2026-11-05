/**
 * T-02 (book 1390; drill L2-10/12): one passive notice per counted rework, the second counted rework reaches the
 * adviser and the secretary as two messages (the mixed requeue-then-recheck chain), the notice is
 * delivered once across a second heartbeat, and the no-adviser card's approval allocates an adviser through the
 * queue owner (no application receipt; the answered card is history); with an adviser the card is history closed
 * `source_resolved` with the triggering rework's own `requestedAt`.
 *
 * The world is FL-1 (`openS7CSystemWorld`), whose own counted chain is the real check FAIL requeue then the real
 * source-mismatch reverify. Its two rework sources were driven before the row; every read here is public
 * (`messages/inbox`, `messages/body`, `decisions/queue`, `main/read`).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { claimedRunOf, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import { readBody } from '../helpers/IV-host-fixture.js';
import {
  answerDecisionCard, attentionNotices, decisionQueueOf, mainNotices, nextOf, openS7CSystemWorld, reworkNotices,
  S7C_L2_ATTENTION_PATH,
} from '../helpers/S7C-L2-world.js';

const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const wrapped = await barrier.inMemoryBarrierModule(async () => actual);
  const create = wrapped.createInMemoryRecordBackend;
  return { ...wrapped, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    if (shared.backend === undefined) shared.backend = { ...create(options), close: async () => undefined };
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() { shared.bodies ??= new actual.RawArtifactBodyStore(); return shared.bodies as never; }
  } as never };
});

beforeEach(() => { shared.backend = undefined; shared.bodies = undefined; });
const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

describe('T-02', () => {
  it('a counted rework notice is delivered once and stays the same message across a second heartbeat', async () => {
    const opened = await openS7CSystemWorld();
    worlds.push(opened.world);
    await expect.poll(async () => (await reworkNotices(opened.world, opened.secretary.ref)).length,
      { timeout: 20_000, interval: 25 }).toBe(2);
    const first = (await reworkNotices(opened.world, opened.secretary.ref))[0]!;
    // A real later heartbeat: a watched-path change is delivered to the adviser, so the loop ran again.
    const before = (await attentionNotices(opened.world, opened.adviser!.ref)).length;
    await mkdir(join(opened.world.root, 'src'), { recursive: true });
    await writeFile(join(opened.world.root, S7C_L2_ATTENTION_PATH), 'S7C T-02: the second heartbeat\n');
    await expect.poll(async () => (await attentionNotices(opened.world, opened.adviser!.ref)).length,
      { timeout: 20_000, interval: 25 }).toBeGreaterThan(before);
    const after = await reworkNotices(opened.world, opened.secretary.ref);
    expect(after).toHaveLength(2);
    expect(after.filter(item => item.ref.messageId === first.ref.messageId)).toHaveLength(1);
    expect(after[0]!.ref).toEqual(first.ref);
  });

  it('the second counted rework reaches the adviser and the secretary as two distinct messages', async () => {
    const opened = await openS7CSystemWorld();
    worlds.push(opened.world);
    await expect.poll(async () => (await reworkNotices(opened.world, opened.secretary.ref)).length,
      { timeout: 20_000, interval: 25 }).toBe(2);
    await expect.poll(async () => (await reworkNotices(opened.world, opened.adviser!.ref)).length,
      { timeout: 20_000, interval: 25 }).toBe(1);
    const secretary = await reworkNotices(opened.world, opened.secretary.ref);
    const adviser = await reworkNotices(opened.world, opened.adviser!.ref);
    // The later source is the one the adviser arm adds to; the two recipients read the same notice text.
    expect(adviser[0]!.ref.messageId).not.toBe(secretary[1]!.ref.messageId);
    expect(await readBody(opened.world, adviser[0]!.ref, 'message'))
      .toBe(await readBody(opened.world, secretary[1]!.ref, 'message'));
  });

  it('the mixed case (a requeue then a recheck of the same Task) reaches the second counted rework and the adviser',
    async () => {
      const opened = await openS7CSystemWorld();
      worlds.push(opened.world);
      await expect.poll(async () => (await mainNotices(opened.world, opened.goal)).length,
        { timeout: 20_000, interval: 25 }).toBeGreaterThanOrEqual(2);
      const notices = (await mainNotices(opened.world, opened.goal)).filter(notice => notice.rework !== null);
      const second = notices.find(notice => (notice.rework?.taskCount ?? 0) >= 2);
      if (second === undefined) throw new Error('T-02: no second counted rework in the notices');
      expect(second.rework).toMatchObject({ operation: 'reverify', counted: true, taskCount: 2 });
      expect(notices.filter(notice => notice.rework?.operation === 'requeue')
        .some(notice => notice.rework?.taskCount === 1)).toBe(true);
      await expect.poll(async () => (await reworkNotices(opened.world, opened.adviser!.ref)).length,
        { timeout: 20_000, interval: 25 }).toBe(1);

      // L2-19: continue the same Task's open reverify round (`run_check` -> `finalize_checks`); its real FAIL asks
      // for this arm's second automatic requeue. Stop before the next claim, so the world stays where L2-18 starts.
      const toRequeue = await driveWorkflow(opened.world.ag2b, { schemaVersion: 1, goalRef: opened.goal,
        flowId: 's7c-l2-t02-count-3', sessionHint: opened.line.ref, kind: 'select_work',
        taskId: opened.task.taskId }, { stopBefore: 'requeue_task' });
      const requeueInput = toRequeue.at(-1)?.next;
      if (requeueInput === null || requeueInput === undefined) {
        throw new Error(`L2-19: the Workflow settled before the second requeue: ${JSON.stringify(toRequeue.at(-1))}`);
      }
      const requeueReceipts: WorkflowStepReceipt[] = [];
      await driveWorkflow(opened.world.ag2b, requeueInput, { stopBefore: 'claim_task', receipts: requeueReceipts });
      const requeued = requeueReceipts.find(receipt => receipt.kind === 'requeue_task');
      if (requeued === undefined || requeued.result.status !== 'committed'
        || requeued.result.value.kind !== 'requeued') {
        throw new Error(`L2-19: the second automatic requeue did not commit: ${JSON.stringify(requeued)}`);
      }
      expect(requeued.result.value.requeue.automation).toMatchObject({ counted: true, autoCount: 2 });

      // The public read adds this arm's count 2 to the trigger chain head's 1: the new requeue says 3.
      const third = (await mainNotices(opened.world, opened.goal))
        .filter(notice => notice.rework?.taskRef.taskId === opened.task.taskId)
        .find(notice => notice.rework?.operation === 'requeue' && notice.rework.count === 2);
      if (third === undefined) throw new Error('L2-19: no second requeue in the notices');
      expect(third.rework).toMatchObject({ counted: true, count: 2, taskCount: 3 });
    });

  it('a crash recovery keeps the arm count 2, not counted, and notifies only the secretary', async () => {
    const opened = await openS7CSystemWorld({ backend: 'sqlite' });
    worlds.push(opened.world);
    const { world, goal, line, task } = opened;

    // The fixture stops FL-1 at the open reverify round's `run_check`. Finish it with no result file, so the real
    // static check FAILs and the automatic requeue counts 2; stop before the next claim.
    const toRequeue = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal,
      flowId: 's7c-l2-t02-recovery-requeue', sessionHint: line.ref, kind: 'select_work', taskId: task.taskId },
    { stopBefore: 'requeue_task' });
    const requeueInput = toRequeue.at(-1)?.next;
    if (requeueInput === null || requeueInput === undefined) {
      throw new Error(`L2-18: the Workflow settled before the second requeue: ${JSON.stringify(toRequeue.at(-1))}`);
    }
    const requeueReceipts: WorkflowStepReceipt[] = [];
    const stopped = await driveWorkflow(world.ag2b, requeueInput, { stopBefore: 'claim_task',
      receipts: requeueReceipts });
    const requeued = requeueReceipts.find(receipt => receipt.kind === 'requeue_task');
    if (requeued === undefined || requeued.result.status !== 'committed'
      || requeued.result.value.kind !== 'requeued') {
      throw new Error(`L2-18: the second automatic requeue did not commit: ${JSON.stringify(requeued)}`);
    }
    expect(requeued.result.value.requeue.automation).toMatchObject({ counted: true, autoCount: 2 });
    const claimInput = stopped.at(-1)?.next;
    if (claimInput === null || claimInput === undefined) {
      throw new Error(`L2-18: the Workflow settled before the next claim: ${JSON.stringify(stopped.at(-1))}`);
    }

    // The public deliveries are complete before the crash: three automatic-rework messages to the secretary, two
    // to the adviser, and the two `adviser_creation` cards.
    await expect.poll(async () => (await reworkNotices(world, opened.secretary.ref)).length,
      { timeout: 20_000, interval: 25 }).toBe(3);
    await expect.poll(async () => (await reworkNotices(world, opened.adviser!.ref)).length,
      { timeout: 20_000, interval: 25 }).toBe(2);
    const adviserCreationCards = async (): Promise<number> => {
      const queue = await decisionQueueOf(world, goal, ['waiting_answer', 'history']);
      return [...queue.waitingAnswer, ...queue.history]
        .filter(entry => entry.source.kind === 'adviser_creation').length;
    };
    await expect.poll(adviserCreationCards, { timeout: 20_000, interval: 25 }).toBe(2);
    const recoveryNotices = async (recipient: typeof opened.secretary.ref): Promise<string[]> => {
      const found: string[] = [];
      for (const item of await inboxOf(world, recipient)) {
        const body = await readBody(world, item.ref, 'message');
        if (body.startsWith('自动恢复')) found.push(body);
      }
      return found;
    };
    expect(await recoveryNotices(opened.secretary.ref), 'no recovery before the crash').toEqual([]);

    // Hold the next Run's real model request, let the Run enter with no pending tool, then abandon the Host. The
    // rejection handler is attached in the same turn the drive starts; the old request stays held until the
    // restarted Host has been read, so the abandoned drive cannot act between the crash and the recovery.
    const gate = await world.gates.modelRequest(line);
    let running: Promise<unknown> | null = null;
    try {
      running = driveWorkflow(world.ag2b, claimInput, { stopBefore: 'open_checks' });
      running.catch(() => undefined);
      await gate.reached;
      await world.crash();

      // The restarted Host's automatic recovery keeps this arm's saved count 2 and is not counted; stop before claim.
      const recoveryReceipts: WorkflowStepReceipt[] = [];
      const recoverySteps = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal,
        flowId: 's7c-l2-t02-recovery', sessionHint: line.ref, kind: 'select_work', taskId: task.taskId },
      { stopBefore: 'claim_task', receipts: recoveryReceipts });
      const recovery = recoveryReceipts.find(receipt => receipt.kind === 'requeue_task');
      if (recovery === undefined || recovery.result.status !== 'committed'
        || recovery.result.value.kind !== 'requeued') {
        throw new Error(`L2-18: the recovery requeue did not commit: ${JSON.stringify(recovery)}; kinds ${
          JSON.stringify(recoveryReceipts.map(receipt => receipt.kind))}; last ${
          JSON.stringify(recoverySteps.at(-1))}`);
      }
      expect(recovery.result.value.requeue.automation).toMatchObject({ counted: false, autoCount: 2 });

      const recoveryItem = (await mainNotices(world, goal))
        .filter(notice => notice.rework?.taskRef.taskId === task.taskId)
        .find(notice => notice.rework?.operation === 'requeue' && !notice.rework.counted);
      if (recoveryItem === undefined) throw new Error('L2-18: no recovery requeue in the notices');
      expect(recoveryItem.rework).toMatchObject({ operation: 'requeue', counted: false, count: 2, taskCount: 2 });

      // Exactly one "自动恢复" message to the secretary; the adviser and the cards stay at two.
      await expect.poll(async () => (await recoveryNotices(opened.secretary.ref)).length,
        { timeout: 20_000, interval: 25 }).toBe(1);
      expect(await reworkNotices(world, opened.secretary.ref)).toHaveLength(3);
      expect(await reworkNotices(world, opened.adviser!.ref)).toHaveLength(2);
      expect(await recoveryNotices(opened.adviser!.ref)).toEqual([]);
      expect(await adviserCreationCards()).toBe(2);
    } finally {
      gate.release();
      await running?.catch(() => undefined);
    }
  });

  it.each([
    { adviser: false, answer: 'approve' as const },
    { adviser: false, answer: 'reject' as const },
  ])('the no-adviser card answers $answer from decisions/answer ($adviser)', async ({ adviser, answer }) => {
    const opened = await openS7CSystemWorld({ adviser });
    worlds.push(opened.world);
    await expect.poll(async () => (await decisionQueueOf(opened.world, opened.goal, ['waiting_answer']))
      .waitingAnswer.some(card => card.source.kind === 'adviser_creation'),
    { timeout: 20_000, interval: 25 }).toBe(true);
    const waiting = await decisionQueueOf(opened.world, opened.goal, ['waiting_answer']);
    const card = waiting.waitingAnswer.find(entry => entry.source.kind === 'adviser_creation')!;
    const result = await answerDecisionCard(opened.world, card, answer, `s7c-l2-adviser-card-${answer}`);
    expect(result.answer).toMatchObject({ status: 'committed' });
    if (answer === 'approve') {
      // the approval allocates through the queue owner (Q16): no application receipt, the answer is `answered`.
      expect(result.action).toBeNull();
      expect(result.state).toBe('answered');
      // No adviser had room, so the approval opened a line and gave it the Goal: one open responsible adviser link.
      const linked = ready<{ items: SessionCard[] }>(await opened.world.post('sessions/find', plain(S6A_SCOPE, {
        workspace: S6A_SCOPE, target: { kind: 'goal', ref: opened.goal }, includeArchived: false, page: { limit: 100 },
      })), 'the Goal sessions').items.filter(found => found.links.some(link => link.until === null
        && link.ref.relation === 'responsible' && link.ref.target.kind === 'goal'
        && link.ref.target.ref.goalId === opened.goal.goalId));
      expect(linked).toHaveLength(1);
      // The card's source closed with the adviser, so the answered card is history with no application.
      await expect.poll(async () => (await decisionQueueOf(opened.world, opened.goal, ['history'])).history
        .find(entry => entry.source.key === card.source.key)?.state, { timeout: 20_000, interval: 25 })
        .toBe('answered_no_application');
    } else {
      expect(result.action).toBeNull();
      const history = await decisionQueueOf(opened.world, opened.goal, ['waiting_answer', 'history']);
      expect(history.waitingAnswer.some(entry => entry.source.key === card.source.key)).toBe(false);
      expect(history.history.some(entry => entry.source.key === card.source.key)).toBe(true);
    }
  });

  it('with an adviser the card is in history closed as source_resolved, openedAt = the triggering requestedAt',
    async () => {
      const opened = await openS7CSystemWorld();
      worlds.push(opened.world);
      const readCard = async (): Promise<DecisionCardV1 | undefined> =>
        (await decisionQueueOf(opened.world, opened.goal, ['history'])).history
          .find(card => card.source.kind === 'adviser_creation');
      await expect.poll(async () => (await readCard()) !== undefined,
        { timeout: 20_000, interval: 25 }).toBe(true);
      const card = (await readCard())!;
      expect(card.closedReason).toBe('source_resolved');
      const triggered = (await mainNotices(opened.world, opened.goal))
        .find(notice => notice.rework !== null && notice.rework.taskCount >= 2);
      if (triggered === undefined) throw new Error('T-02: no second counted rework notice');
      expect(card.openedAt).toBe(triggered.rework!.requestedAt);
    });

  it('an automatic requeue, a wait reply continuation, then an automatic reverify count 2 and reach the adviser',
    async () => {
      const opened = await openS7CSystemWorld({ grantTools: [
        'read', 'record_note', 'hand_off', 'request_rework', 'request_recheck',
        'withdraw_session_message', 'create_member', 'send_session_message', 'respond_session_message',
      ] });
      worlds.push(opened.world);
      const { world, goal, line, tools } = opened;
      const task = tools.tasks[1]!;
      const main = tools.main;

      // A second executor line answers the wait from its own goal, never touching the reworked Task.
      const executorRole = line.role;
      if (executorRole.kind !== 'legacy_template') throw new Error('L2-17: the executor role is not a legacy template');
      const replyGoal = (await main.createGoal('s7c-l2-17-reply-goal', 'S7C L2-17 reply goal')).ref;
      const replyPlan = await adoptS6BPlan(main, replyGoal, { label: 's7c-l2-17-reply',
        taskIds: ['s7c-l2-17-reply-task'], role: executorRole.templateId });
      const recipient = await sessionOf(world, await createS6BLine(main, { label: 's7c-l2-17-recipient',
        role: executorRole, tasks: replyPlan.tasks }));

      // 1. The first Run's real check FAIL asks for the counted automatic requeue (count 1).
      await world.scripted.script(line, [{ kind: 'text', text: 'S7C L2-17: the first Run answers' }]);
      const requeueReceipts: WorkflowStepReceipt[] = [];
      const toRequeue = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal,
        flowId: 's7c-l2-17-first', sessionHint: line.ref, kind: 'select_work', taskId: task.taskId },
      { stopBefore: 'requeue_task', receipts: requeueReceipts });
      const claimReceipts: WorkflowStepReceipt[] = [];
      const toClaim = await driveWorkflow(world.ag2b, nextOf(toRequeue, 'L2-17: the next step'), { stopBefore: 'claim_task',
        receipts: claimReceipts });
      const requeue = claimReceipts.find(receipt => receipt.kind === 'requeue_task');
      if (requeue === undefined || requeue.result.status !== 'committed' || requeue.result.value.kind !== 'requeued') {
        throw new Error(`L2-17: the automatic requeue did not commit: ${JSON.stringify(requeue)}`);
      }
      expect(requeue.result.value.requeue.automation).toMatchObject({ counted: true, autoCount: 1 });

      // 2. The requeued Run waits on its saved reply: the Run yields with no wait-specific requeue of its own.
      await world.scripted.script(line, [
        { kind: 'calls', calls: [{ callId: 's7c-l2-17-send', name: 'send_session_message',
          args: { recipient: recipient.ref, text: 'S7C L2-17 question', intent: 'inquiry',
            needsReply: true, waitAfterSend: true } }] },
        { kind: 'text', text: 'S7C L2-17: the continuation Run answers' },
      ]);
      const waitReceipts: WorkflowStepReceipt[] = [];
      await driveWorkflow(world.ag2b, nextOf(toClaim, 'L2-17: the next step'), { receipts: waitReceipts });
      const requeued = claimedRunOf(waitReceipts, 'the L2-17 requeued Run').run;
      const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
        plain(S6A_SCOPE, { senderRun: requeued, page: { limit: 20 } })), 'the L2-17 question');
      const question = outbox.items[0]!;

      // 3. The recipient's own real Work Run writes the reply.
      await world.scripted.script(recipient, [
        { kind: 'calls', calls: [{ callId: 's7c-l2-17-reply', name: 'respond_session_message',
          args: { messageRef: question.ref, expectedRevision: question.revision, text: 'S7C L2-17 reply' } }] },
        { kind: 'text', text: 'S7C L2-17: the reply is saved' },
      ]);
      await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: replyGoal, flowId: 's7c-l2-17-reply',
        sessionHint: recipient.ref, kind: 'select_work', taskId: replyPlan.tasks[0]!.taskId },
      { stopBefore: 'open_checks' });

      // 4. The continuation claim creates the successor Run on the same Task/Session, with `previousRun` only.
      const continuationReceipts: WorkflowStepReceipt[] = [];
      const toOpen = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal,
        flowId: 's7c-l2-17-accept', sessionHint: line.ref, kind: 'select_work', taskId: task.taskId },
      { stopBefore: 'open_checks', receipts: continuationReceipts });
      const continuation = claimedRunOf(continuationReceipts, 'the L2-17 continuation').run;
      expect(continuation).not.toEqual(requeued);
      const continuationRecord = ready<TaskExecutionRecord>(await world.post('executions/read',
        plain(S6A_SCOPE, continuation)), 'the L2-17 continuation Run');
      expect(continuationRecord.run.previousRun).toEqual(requeued);
      expect(continuationRecord.run.requeueRef).toBeUndefined();

      // 5. That continuation Run's round is made INCONCLUSIVE by a real source change after it froze its source.
      const openedRound = await driveWorkflow(world.ag2b, nextOf(toOpen, 'L2-17: the next step'), { stopBefore: 'run_check' });
      await mkdir(join(world.root, 'src'), { recursive: true });
      await writeFile(join(world.root, 'src/s7c-l2-source-change.txt'),
        'S7C L2-17: the source changed after the round opened\n');
      const toFinalize = await driveWorkflow(world.ag2b, nextOf(openedRound, 'L2-17: the next step'), { stopBefore: 'finalize_checks' });
      const toReverify = await driveWorkflow(world.ag2b, nextOf(toFinalize, 'L2-17: the next step'), { stopBefore: 'reverify_round' });
      const reverifyReceipts: WorkflowStepReceipt[] = [];
      await driveWorkflow(world.ag2b, nextOf(toReverify, 'L2-17: the next step'), { stopBefore: 'run_check', receipts: reverifyReceipts });
      const reverify = reverifyReceipts.find(receipt => receipt.kind === 'reverify_round');
      if (reverify === undefined || reverify.result.status !== 'committed'
        || reverify.result.value.kind !== 'reverified') {
        throw new Error(`L2-17: the automatic reverify did not commit: ${JSON.stringify(reverify)}`);
      }
      expect(reverify.result.value.round.subjectRunRef).toEqual(continuation);
      expect(reverify.result.value.round.chain.autoCount).toBe(1);

      // 6. The reverify's projection adds the requeue arm through `previousRun`: taskCount 2, so the adviser arm runs.
      const notices = (await mainNotices(world, goal)).filter(notice => notice.rework?.taskRef.taskId === task.taskId);
      expect(notices.find(notice => notice.rework?.operation === 'requeue')?.rework)
        .toMatchObject({ counted: true, taskCount: 1 });
      expect(notices.find(notice => notice.rework?.operation === 'reverify')?.rework)
        .toMatchObject({ counted: true, taskCount: 2 });
      await expect.poll(async () => (await reworkNotices(world, opened.adviser!.ref)).length,
        { timeout: 20_000, interval: 25 }).toBe(2);
      const adviserTexts = await Promise.all((await reworkNotices(world, opened.adviser!.ref))
        .map(item => readBody(world, item.ref, 'message')));
      expect(adviserTexts.filter(text => text.includes(task.taskId)))
        .toEqual([`自动返工 · ${task.taskId} · 第 1 次（1/3）`]);
    });
});
