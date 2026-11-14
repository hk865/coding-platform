import { isDeepStrictEqual } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import { answerTexts, countRoute, mainHeadTitle, textOf, userTexts } from './helpers/E3N-page.js';
import {
  bootMemberAt, callsOf, memberSearch, press, radio, railRowOf, receiptBody, settle, typeDraft, worldSlot,
} from './helpers/E3M-world.js';
import { answerS7BWait, acceptS7BReply, openS7BWorld, readS7BMessage, readS7BWaits, runS7BWait }
  from '../helpers/S7B-fixture.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { claimedRunOf, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { interveneS7B, s7bVWorkProfile } from '../helpers/S7B-V-fixture.js';

/**
 * E3M-8 (clk-current §2, P11-1/P11-2/P11-3/P11-5/P11-6): the Member page on
 * the S7B wait world. The sender line is the line whose Run yielded on
 * `wait_reply`; P11-1/2/3/6 boot on it, P11-5 on the recipient that received
 * the inquiry (the page's message track is the recipient-session index). Every
 * wait fact is read through the public `sessions/facts`/`sessionFacts.readWait`
 * and `messages/read` routes, never through the page.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);

/** One S7B wait world per row (`openS7BWorld` + `runS7BWait`); the slot closes it before the next row. */
async function openWaitWorld(key: string, label: string, backend: 'memory' | 'sqlite' = 'memory') {
  return slot.use(`s7b-${key}`, async () => {
    const { world } = await openS7BWorld({ backend });
    try {
      return { world, wait: await runS7BWait(world, { label }) };
    } catch (error) {
      await world.close().catch(() => undefined);
      throw error;
    }
  }, async ({ world }) => { await world.close(); });
}

describe('E3M-8 the Member page on a waiting line', () => {
  it('P11-1 the waiting composer sends one action_request and leaves the wait open', async () => {
    const { world, wait } = await openWaitWorld('p11-1', 'e3m-p11-1');
    const booted = await bootMemberAt(world, memberSearch(wait.goal.goalId, wait.sender.ref));
    const { page, log } = booted;
    try {
      press(radio(page.root, '直接干预'), '直接干预');
      await settle(() => radio(page.root, '直接干预')?.getAttribute('aria-checked') === 'true');
      typeDraft(page.root, 'E3M wait intervention');
      press(findClass(page.root, 'send'), 'send');
      await settle(() => callsOf(log, 'messages/send').length > 0
        && userTexts(page.root).includes('E3M wait intervention'), 5_000);
      const calls = callsOf(log, 'messages/send');
      /* 具名改坏: `interveneLine` 把 `intent` 改成 `notify`；本行的 `input` 红。 */
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toEqual({
        recipient: wait.sender.ref, text: 'E3M wait intervention', intent: 'action_request', needsReply: true,
      });
      expect(receiptBody(booted, 'messages/send')?.['status']).toBe('committed');
      expect(receiptBody(booted, 'messages/send')?.['sendStatus']).toBe('sent');
      expect(userTexts(page.root)).toContain('E3M wait intervention');
      /* The page itself never posts `sessions/facts` (`readMember` has no such read); count before the world's own
         read, which the booted page's forwarder would log as a page call (E3M-3 R23's lead 11-10 note). */
      expect(callsOf(log, 'sessions/facts')).toHaveLength(0);
      const kept = await readS7BWaits(world, { session: wait.sender, messageRef: wait.message });
      expect(kept.waitByRef).toMatchObject({
        messageRef: wait.message, originalRun: wait.run, waitingSession: wait.sender.ref,
        state: { state: 'open' },
      });
      expect(kept.wait?.messageRef).toEqual(wait.message);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('P11-2 the waiting sender’s rail row reads 等回复 and the boot writes nothing', async () => {
    const { world, wait } = await openWaitWorld('p11-2', 'e3m-p11-2');
    const { page, log } = await bootMemberAt(world, memberSearch(wait.goal.goalId, wait.sender.ref));
    try {
      const row = await railRowOf(page.root, world, wait.sender.ref);
      expect(row, 'the rail row').toBeDefined();
      /* 具名改坏: `nav.ts` 的 `OWN_WORD` 不把 `waiting_reply` 写成 等回复；本行的 `row-sub` 红。 */
      expect(textOf(findClass(row!, 'row-sub'))).toBe('等回复');
      for (const route of ['messages/send', 'messages/apply', 'queries/ask', 'controls/submit', 'tasks/requeue']) {
        expect(countRoute(log, route), route).toBe(0);
      }
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('P11-3 the wait survives a real SQLite reopen: same refs and deadline, the rail keeps its line', async () => {
    const { world, wait } = await openWaitWorld('p11-3', 'e3m-p11-3', 'sqlite');
    const before = await readS7BWaits(world, { session: wait.sender, messageRef: wait.message });
    await world.reopen();
    const after = await readS7BWaits(world, { session: wait.sender, messageRef: wait.message });
    /* 具名改坏: the wait record is not persisted (read back `null` after the reopen); 本行的 `after` 红. */
    expect(after.waitByRef).toEqual(before.waitByRef);
    expect(after.waitByRef.messageRef).toEqual(wait.message);
    expect(after.waitByRef.originalRun).toEqual(wait.run);
    expect(after.waitByRef.deadline).toBe(before.waitByRef.deadline);
    const { page, log } = await bootMemberAt(world, memberSearch(wait.goal.goalId, wait.sender.ref));
    try {
      const row = await railRowOf(page.root, world, wait.sender.ref);
      expect(row, 'the rail row').toBeDefined();
      const list = (await world.post('lines/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body as {
        value?: { rows?: Array<{ key?: { sessionId?: string }; status?: { own?: string } }> };
      };
      expect(list.value?.rows?.find((entry) => entry.key?.sessionId === wait.sender.ref.sessionId)?.status?.own)
        .toBe('waiting_reply');
      /* The frozen row (`clk-current.md:221`) expects the rail to keep 等回复 after the
         reopen: the line's own `waiting_reply` wins over the Goal interruption's
         `decide` (`src/ui/adapters/nav.ts:158-162`); the wait and `deadline` above are
         the public facts. */
      expect(textOf(findClass(row!, 'row-sub'))).toBe('等回复');
      expect(mainHeadTitle(page.root)).toBe('执行者');
      const reads = callsOf(log, 'lines/read');
      expect(reads).toHaveLength(1);
      expect((reads[0]!.input as { key?: unknown }).key).toEqual(wait.sender.ref);
      const value = (reads[0]!.reply as { value?: { kind?: string; row?: { key?: unknown } } } | undefined)?.value;
      expect(value?.kind).toBe('line');
      expect(value?.row?.key).toEqual(wait.sender.ref);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('P11-5 a late reply shows under its message as the agent prose, read through messages/view', async () => {
    const { world, wait } = await openWaitWorld('p11-5', 'e3m-p11-5');
    await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient, message: wait.message,
      task: wait.tasks[1]!, label: 'e3m-p11-5' });
    /* The message arrived on the recipient's line: `lines/page messages` is the recipient-session index
       (`src/core/work-graph/views/work-line-reader.ts:2827-2833`), so the bubble and its reply are that line's. */
    const { page, log } = await bootMemberAt(world, memberSearch(wait.goal.goalId, wait.recipient.ref));
    try {
      /* 具名改坏: the adapter ignores `bodies[response]` and draws the reply as a new user row; 本行的
         `userTexts`/`answerTexts` 红. */
      expect(userTexts(page.root)).toEqual(['S7B message from e3m-p11-5']);
      expect(answerTexts(page.root)).toEqual(['S7B e3m-p11-5 reply']);
      const views = callsOf(log, 'messages/view').filter((call) => isDeepStrictEqual(call.input, wait.message));
      expect(views).toHaveLength(1);
      /* The reply is the read `messages/body` `response` part, never a `messages/read`. */
      expect(callsOf(log, 'messages/read')).toHaveLength(0);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('P11-6 a page intervention keeps wait A open; only the real reply consumes it', async () => {
    /* One row's own S7B wait world (S7B-V:37-58's composition): two scripted inquiries, no trailing text, so the
       claimed intervention Run takes the second one and yields on its own wait (V-D04). Not a fixture step. */
    const { world, wait } = await slot.use('s7b-p11-6-public', async () => {
      const { world } = await openS7BWorld({ backend: 'memory' });
      try {
        const main = s6aCardsWorkspace(world, S6A_SCOPE);
        const goal = (await main.createGoal('e3m-p11-6-goal', 'E3M P11-6 goal')).ref;
        const { tasks } = await adoptS6BPlan(main, goal, { label: 'e3m-p11-6',
          taskIds: ['e3m-p11-6-send', 'e3m-p11-6-reply'], role: S6A_WORK_ROLE.templateId });
        const sender = await sessionOf(world, await createS6BLine(main, { label: 'e3m-p11-6-sender',
          role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
        const recipient = await sessionOf(world, await createS6BLine(main, { label: 'e3m-p11-6-recipient',
          role: S6A_WORK_ROLE }));
        const inquiry = (callId: string, text: string) => ({ kind: 'calls' as const, calls: [{ callId,
          name: 'send_session_message', args: { recipient: recipient.ref, text, intent: 'inquiry' as const,
            needsReply: true, waitAfterSend: true } }] });
        await world.scripted.script(sender, [inquiry('e3m-p11-6-a', 'S7B message from e3m-p11-6'),
          inquiry('e3m-p11-6-beside', 'E3M p11-6 beside the wait')]);
        const receipts: WorkflowStepReceipt[] = [];
        await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'e3m-p11-6-wait',
          sessionHint: sender.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { receipts });
        const { run } = claimedRunOf(receipts, 'the P11-6 wait');
        const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
          plain(S6A_SCOPE, { senderRun: run, page: { limit: 20 } })), 'the P11-6 outbox');
        const message = outbox.items.find((item) => item.waitAfterSend === true);
        if (message === undefined) throw new Error('E3M P11-6: wait A is not in the sender outbox');
        const record = ready<{ run: { status: string; outcome: string; continuation?: { kind: string } } }>(
          await world.post('executions/read', plain(S6A_SCOPE, run)), 'the P11-6 sender Run');
        if (record.run.status !== 'ended' || record.run.outcome !== 'yielded'
          || record.run.continuation?.kind !== 'wait_reply') {
          throw new Error(`E3M P11-6: the sender Run did not yield on its reply: ${JSON.stringify(record.run)}`);
        }
        return { world, wait: { sender, recipient, goal, tasks, run, message: message.ref } };
      } catch (error) {
        await world.close().catch(() => undefined);
        throw error;
      }
    }, async ({ world }) => { await world.close(); });
    const booted = await bootMemberAt(world, memberSearch(wait.goal.goalId, wait.sender.ref));
    const { page, log } = booted;
    try {
      press(radio(page.root, '直接干预'), '直接干预');
      await settle(() => radio(page.root, '直接干预')?.getAttribute('aria-checked') === 'true');
      typeDraft(page.root, 'E3M wait intervention');
      press(findClass(page.root, 'send'), 'send');
      await settle(() => callsOf(log, 'messages/send').length > 0
        && userTexts(page.root).includes('E3M wait intervention'), 5_000);
      expect(callsOf(log, 'messages/send')).toHaveLength(1);
      /* The page's body carries no pins (the row's premise); P11-1 pins the exact four fields. */
      expect(callsOf(log, 'messages/send')[0]!.input).not.toHaveProperty('goalRef');
      expect(callsOf(log, 'messages/send')[0]!.input).not.toHaveProperty('taskRef');
      const person = receiptBody(booted, 'messages/send')?.['value'] as SessionMessage | undefined;
      expect(person, 'the committed person message').toBeDefined();
      /* The claim is by the line's recent Work Task (`existing_task`), the V-D04 branch. */
      const claimed = await interveneS7B(world, person!.ref, s7bVWorkProfile());
      expect(claimed).toMatchObject({ status: 'claimed', branch: 'existing_task' });
      if (claimed.status !== 'claimed') throw new Error(`P11-6: the intervention was not claimed: ${JSON.stringify(claimed)}`);
      expect(claimed.claim.task).toEqual(wait.tasks[0]);
      /* 具名改坏: the intervention claim consumes or cancels wait A; 本行的 `kept` 红. */
      const kept = await readS7BWaits(world, { session: wait.sender, messageRef: wait.message });
      expect(kept.waitByRef).toMatchObject({
        messageRef: wait.message, originalRun: wait.run, state: { state: 'open' },
      });
      expect(kept.wait?.messageRef).toEqual(wait.message);
      /* The intervention Run takes the second inquiry and yields on its own wait, so the Task stays dispatchable. */
      await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: wait.goal,
        flowId: `intervention:${claimed.claim.runRef.runId}`, sessionHint: claimed.claim.sessionRef,
        kind: 'select_work', taskId: claimed.claim.task.taskId });
      await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient, message: wait.message,
        task: wait.tasks[1]!, label: 'e3m-p11-6' });
      await acceptS7BReply(world, { goal: wait.goal, sender: wait.sender, task: wait.tasks[0]!,
        run: wait.run, message: wait.message, label: 'e3m-p11-6' });
      /* 具名改坏: the continuation accepts the response without its wait pin (`consumesWait` false); 本行的
         `accepted` 红. */
      const consumed = await readS7BWaits(world, { session: wait.sender, messageRef: wait.message });
      expect(consumed.waitByRef.state.state).toBe('consumed');
      expect(consumed.waits.some((entry) => entry.messageRef.messageId === wait.message.messageId)).toBe(false);
      const accepted = await readS7BMessage(world, wait.message);
      expect(accepted.acceptedInputs?.find((entry) => entry.part === 'response'))
        .toMatchObject({ consumesWait: true });
    } finally {
      await page.restore();
    }
  }, 180_000);
});
