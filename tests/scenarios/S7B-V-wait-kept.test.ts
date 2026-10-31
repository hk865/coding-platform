/** V-D04 (book-7b.md §5 `:1225`; SR5 §5.4, §5.13): a person's intervention on a line that is already waiting claims
 * the unfinished Task under `intervention`, and the line still reads 「在等」 on wait A. Only the real reply consumes
 * it, through the existing continuation. Memory only: a business row (`tests/RULES.md:193`-`:195` S3).
 *
 * Composition (probe P-15): P-01's real wait A on the sender's Task, the person's `messages/send` on the same Task and
 * line (Part B 8's own composition), the published `workflow.handleIntervention` with the line's Work profile (the one
 * call the Host makes), then `answerS7BWait` and `acceptS7BReply`. The row calls the handler itself because the landed
 * Part B step hides its result behind the claim. The intervention execution yields on its own wait, so the original
 * Task stays dispatchable (§3.4 item 4: the reply's `previousRun` is the intervention Run). Every fact is read
 * through `sessions/facts`, `sessionFacts.readWait`, `messages/read` and `executions/read`; no store or record is built.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { claimedRunOf, committed, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { acceptS7BReply, answerS7BWait, openS7BWorld, readS7BWaits }
  from '../helpers/S7B-fixture.js';
import { interveneS7B, s7bVWorkProfile } from '../helpers/S7B-V-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

describe('V-D04: the intervention claim keeps the line\'s wait', () => {
  it('claims under intervention, reads wait A open, and only the reply consumes it', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal('s7b3-v-d04-goal', 'S7B3 V-D04 goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 'v-d04',
      taskIds: ['s7b3-v-d04-send', 's7b3-v-d04-reply'], role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world, await createS6BLine(main, { label: 'v-d04-sender',
      role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const recipient = await sessionOf(world, await createS6BLine(main, { label: 'v-d04-recipient',
      role: S6A_WORK_ROLE }));
    const inquiry = (callId: string, text: string) => ({ kind: 'calls' as const, calls: [{ callId,
      name: 'send_session_message', args: { recipient: recipient.ref, text, intent: 'inquiry' as const,
        needsReply: true, waitAfterSend: true } }] });
    // The first Run yields on wait A; the intervention Run (after the claim) yields on its own inquiry, so the
    // sender's Task stays dispatchable for A's reply and no Work is completed here.
    await world.scripted.script(sender, [inquiry('v-d04-a', 'S7B3 V-D04 wait A'),
      inquiry('v-d04-beside', 'S7B3 V-D04 beside the wait')]);
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'v-d04-wait',
      sessionHint: sender.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { receipts });
    const { run } = claimedRunOf(receipts, 'the V-D04 wait');
    const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
      plain(S6A_SCOPE, { senderRun: run, page: { limit: 20 } })), 'the V-D04 outbox');
    const waitMessage = outbox.items.find(message => message.waitAfterSend === true);
    if (waitMessage === undefined) throw new Error('V-D04: wait A is not in the sender outbox');

    // The person's message on the waiting Task and line (Part B 8's `messages/send` step).
    const person = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: sender.ref, text: 'S7B3 V-D04 person intervention', intent: 'action_request',
      goalRef: goal, taskRef: tasks[0],
    }, 's7b3-v-d04-person')), 'the V-D04 person message');

    // The one Host call: the unfinished Task is claimed with the `intervention` arm, not a reply-wait continuation.
    const claim = await interveneS7B(world, person.ref, s7bVWorkProfile());
    expect(claim).toMatchObject({ status: 'claimed', branch: 'existing_task' });
    if (claim.status !== 'claimed') throw new Error(`V-D04: ${JSON.stringify(claim)}`);
    expect(claim.claim.task).toEqual(tasks[0]);
    const intervention = ready<{ run: { consumedWait?: { kind: string; messageRef: SessionMessage['ref'] } } }>(
      await world.post('executions/read', plain(S6A_SCOPE, claim.claim.runRef)), 'the intervention Run').run;
    expect(intervention.consumedWait).toMatchObject({ kind: 'intervention', messageRef: person.ref });
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal,
      flowId: `intervention:${claim.claim.runRef.runId}`, sessionHint: claim.claim.sessionRef,
      kind: 'select_work', taskId: claim.claim.task.taskId });

    // The claim and its own execution leave wait A untouched: the line still reads 「在等」 on A.
    const kept = await readS7BWaits(world, { session: sender, messageRef: waitMessage.ref });
    expect(kept.waits).toContainEqual(expect.objectContaining({ messageRef: waitMessage.ref,
      waitingSession: sender.ref, state: { state: 'open', reason: null } }));
    expect(kept.waitByRef).toMatchObject({ messageRef: waitMessage.ref, originalRun: run,
      waitingSession: sender.ref, state: { state: 'open', reason: null } });
    expect(kept.wait).toMatchObject({ messageRef: waitMessage.ref, runRef: run });

    // The real reply from B and the original line's continuation accept the response; only that consumes wait A.
    await answerS7BWait(world, { goal, recipient, message: waitMessage.ref, task: tasks[1]!,
      label: 'v-d04-reply' });
    const accepted = await acceptS7BReply(world, { goal, sender, task: tasks[0]!, run,
      message: waitMessage.ref, label: 'v-d04-accept' });
    expect(accepted.message.status).toBe('responded');
    expect(accepted.message.acceptedInputs?.find(entry => entry.part === 'response'))
      .toMatchObject({ consumesWait: true, executionRef: accepted.run });
    const consumed = await readS7BWaits(world, { session: sender, messageRef: waitMessage.ref });
    expect(consumed.waitByRef.state.state).toBe('consumed');
    expect(consumed.waits.some(wait => wait.messageRef.messageId === waitMessage.ref.messageId)).toBe(false);
  }, 120_000);
});
