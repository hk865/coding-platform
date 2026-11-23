/**
 * FR (`cp2fn-rulings.md` review ruling 9; p2-frozen:150, design-frozen:260, :552): a platform system round's source is
 * told apart by one trusted read. The fixed `host:plan-round` sender only proposes it; the Host's send receipt naming
 * this very message decides. A person's `messages/forward` copy keeps the original sender but is not the receipt's
 * message, so for the line that gets it, it is ordinary mail: a working line takes it at its next safe point and answers
 * it with the generic reply tool. Nothing takes the original, whose line was archived before it was read.
 * Every step is public: `plans/*`, `sessions/create`, P1's `sendSystemRound`, the archive and `messages/forward`
 * routes, `workflow/advance` with the scripted model calling the real tools, and the `messages/read` read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { ForwardMessageResultV1 } from '../../src/core/work-graph/model/communication-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { settleHost } from '../helpers/IV-host-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import {
  adoptPLMixedPlan, createPLLine, openPLConsumptionWorld, sendPLRefine,
} from '../helpers/PL-consumption-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('FR: a forwarded system-round message is ordinary mail for the line that gets it', () => {
  it('the working line takes the forward at a safe point and replies to it; nothing takes the original', async () => {
    const world = await openPLConsumptionWorld({ label: 'fr' });
    worlds.push(world);
    await settleHost(world);
    const goal = world.goals.first;
    const { plan, tasks } = await adoptPLMixedPlan(world, { goal, label: 'fr',
      tasks: [{ taskId: 'fr-y', role: S6A_WORK_ROLE.templateId }] });
    const x = await createPLLine(world, { label: 'fr-x', role: S6A_WORK_ROLE });
    const y = await createPLLine(world, { label: 'fr-y', role: S6A_WORK_ROLE, tasks: [tasks[0]!] });
    const z = await createPLLine(world, { label: 'fr-z', role: S6A_WORK_ROLE });
    // The refine is X's own round; X is archived before anything reads it, so it is undelivered.
    const refine = await sendPLRefine(world, { goal, line: x, taskId: 'fr-y', planRevision: plan.planRevision });
    await world.archive(x);

    // Y is working: its Run's first model request is held while the person forwards the refine to Y.
    await world.scripted.script(y, [{ kind: 'calls', calls: [{ callId: 'fr-busy', name: 'send_session_message',
      args: { recipient: z.ref, text: 'fr: Y is working' } }] }]);
    const held = await world.gates.modelRequest(y);
    const receipts: WorkflowStepReceipt[] = [];
    const driving = driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'fr-y', sessionHint: y.ref,
      kind: 'select_work', taskId: 'fr-y' }, { stopBefore: 'open_checks', receipts });
    await held.reached;
    const forwarded = (await world.post('messages/forward', plain(S6A_SCOPE, {
      commandId: 'fr-forward', messageRef: refine.messageRef, to: y.ref,
    }))).body as ForwardMessageResultV1;
    if (forwarded.status !== 'forwarded') throw new Error(`FR: the forward did not commit: ${JSON.stringify(forwarded)}`);
    const copy = forwarded.message;
    await world.scripted.script(y, [
      { kind: 'calls', calls: [{ callId: 'fr-reply', name: 'respond_session_message',
        args: { messageRef: copy.ref, expectedRevision: copy.revision, text: 'fr: Y answers the forward' } }] },
      { kind: 'text', text: 'fr: Y done' },
    ]);
    held.release();
    await driving;
    const claim = receipts.find(receipt => receipt.kind === 'claim_task');
    if (claim?.kind !== 'claim_task' || claim.result.status !== 'committed') throw new Error('FR: Y was not claimed');
    const run = claim.result.value.runRef;

    const answered = await readS7BMessage(world, copy.ref);
    expect((answered.acceptedInputs ?? []).map(entry => ({ part: entry.part, executionRef: entry.executionRef })),
      'Y\'s Run took the forward at a safe point').toEqual([{ part: 'message', executionRef: run }]);
    expect(answered.response?.sender, 'Y\'s generic reply filled the forward\'s slot')
      .toMatchObject({ kind: 'work_run', runRef: run });
    const original = await readS7BMessage(world, refine.messageRef);
    expect({ accepted: original.acceptedInputs ?? [], response: original.response, transferredTo: original.transferredTo })
      .toEqual({ accepted: [], response: null, transferredTo: copy.ref });
  }, 120_000);
});
