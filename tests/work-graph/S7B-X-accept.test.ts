/**
 * X-accept (SR5 §5.5; spec S7-MSG-03/05A/05B, D-05, R-02, A-21). Service level, both backends: the acceptance is the
 * only delivery write (`delivered` plus the accepted proof), the bound reply takes the one wait-consumed claim, an
 * offer held while the Goal is paused still writes that acceptance, and the same Kernel identity replays its receipt
 * without a second input.
 *
 * Every precondition is the frozen Part A chain: one Host world, one real inquiry that yields on its reply, the
 * recipient's real reply Run and the sender's real continuation Run. Every acceptance is the Kernel's real
 * `run.input_accepted`, decoded from the public `executions/history` with the canonical `decodeKernelEntry`; the
 * replay goes through the published `messages.recordInputAccepted` with the entry the accepting Run saved. The
 * sub-rows that need Part B step 5 (`expireS7BWait`, a second real expiry for the loser), a late reply, or Part B
 * step 9 (`reopenS7BHost`) are not fabricated here and stay unproven until Part B and L (SR5 §5.5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as kernelModule from '../../vendor/coding-agent/dist/public-api.js';
import type { RunAppInput } from '../../vendor/coding-agent/dist/public-api.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { decodeKernelEntry } from '../../src/core/agent-runtime/kernel-turn-facts.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import {
  deriveSessionInputId, type SessionMessage,
} from '../../src/core/work-graph/model/communication-contracts.js';
import type { KernelObservationSource } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { callPublishedOwnerAsHost, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed, pauseS7AGoal, ready, replyS7AMessage } from '../helpers/S7A-fixture.js';
import { acceptS7BReply, answerS7BWait, openS7BWorld, readS7BMessage, runS7BWait } from '../helpers/S7B-fixture.js';

type AcceptedInput = NonNullable<SessionMessage['acceptedInputs']>[number];

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

async function readSessionFacts(world: S6AHostWorld, session: SessionRef): Promise<SessionFactsV1> {
  return ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, session)),
    'the X-accept Session facts');
}

/**
 * The real `run.input_accepted` fact the Kernel history carries for one source part, decoded with the canonical
 * reader. The public history read returns the same entries `confirmMailboxInputs` decodes; this invents no identity.
 */
async function kernelInputFact(world: S6AHostWorld, runRef: AcceptedInput['executionRef'],
  messageRef: SessionMessage['ref'], part: AcceptedInput['part']): Promise<KernelObservationSource> {
  const history = ready<{ items: SessionHistoryEntry[] }>(await world.post('executions/history',
    plain(S6A_SCOPE, { runRef, limit: 200 })), 'the accepting execution history');
  for (const entry of history.items) {
    const decoded = decodeKernelEntry(entry);
    if (decoded === null) throw new Error('X-accept: the Kernel history did not decode');
    const record = decoded.record;
    if (record.recordType !== 'agent.event') continue;
    const event = record.payload.event;
    if (event.type !== 'run.input_accepted') continue;
    const source = event.payload.input.sourceRef as
      { kind?: string; messageRef?: SessionMessage['ref']; part?: string } | null;
    if (source?.kind !== 'SessionMessage' || source.messageRef?.messageId !== messageRef.messageId
      || source.part !== part) continue;
    return { adapterId: entry.source.adapterId, kernelSessionId: entry.source.kernelSessionId,
      runId: event.meta.runId, turnId: event.meta.turnId, position: entry.source.position };
  }
  throw new Error(`X-accept: the ${part} input is not in the accepting Run's Kernel history`);
}

function acceptedOf(message: SessionMessage, part: AcceptedInput['part']): AcceptedInput {
  const accepted = message.acceptedInputs?.find(entry => entry.part === part);
  if (accepted === undefined) throw new Error(`X-accept: the ${part} input is not recorded: ${JSON.stringify(message)}`);
  return accepted;
}

describe.each(['memory', 'sqlite'] as const)('X-accept (%s)', backend => {
  it('a real Kernel acceptance of the delivered message writes delivered and its accepted proof', async () => {
    const { world } = await openS7BWorld({ backend });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'x-accept-delivered' });
    const person = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: wait.recipient.ref, text: 'S7B X-accept delivered', intent: 'notify', goalRef: wait.goal,
    }, 'x-accept-delivered-send')), 'the X-accept person message');
    await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient, message: wait.message,
      task: wait.tasks[1]!, label: 'x-accept-delivered' });

    // The recipient reply Run's own observation confirms the Kernel's `run.input_accepted`; wait for that write,
    // then read it back through the public message read.
    await expect.poll(async () => (await readS7BMessage(world, person.ref)).acceptedInputs?.length ?? 0,
      { timeout: 10_000, interval: 20 }).toBe(1);
    const delivered = await readS7BMessage(world, person.ref);
    const accepted = acceptedOf(delivered, 'message');
    expect(accepted).toMatchObject({ part: 'message', evidence: 'input_accepted', consumesWait: false });
    expect(accepted.kernel).toEqual(await kernelInputFact(world, accepted.executionRef, person.ref, 'message'));
    expect(delivered.delivery).toBe('delivered');
    expect(delivered.deliveryEvidence).toEqual({
      executionRef: accepted.executionRef, acceptedAt: accepted.acceptedAt,
    });

    // The same delivered acceptance replays its receipt and appends no second input.
    const replay = await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messages.recordInputAccepted', wave: '7B-1 X',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, {
      input: { messageRef: person.ref, part: accepted.part, executionRef: accepted.executionRef, kernel: accepted.kernel },
      meta: { requestId: 'x-accept-delivered-replay', expected: [] },
    });
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    expect(await readS7BMessage(world, person.ref)).toEqual(delivered);
  });

  it('the real continuation Run accepts the reply and takes the same claim', async () => {
    const { world } = await openS7BWorld({ backend });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'x-accept-continuation' });
    await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient, message: wait.message,
      task: wait.tasks[1]!, label: 'x-accept-continuation' });
    // The frozen Part A step 4: the sender's yielded Run is re-driven and its successor accepts the reply. This is
    // the real continuation path; on this tree the claim bridge in `claim-service.ts` still refuses it.
    const continued = await acceptS7BReply(world, { goal: wait.goal, sender: wait.sender, task: wait.tasks[0]!,
      run: wait.run, message: wait.message, label: 'x-accept-continuation' });
    expect(continued.run.runId).not.toBe(wait.run.runId);
    const accepted = acceptedOf(continued.message, 'response');
    expect(accepted).toMatchObject({ part: 'response', evidence: 'input_accepted', consumesWait: true });
    expect(accepted.executionRef).toEqual(continued.run);
    expect(accepted.kernel).toEqual(await kernelInputFact(world, accepted.executionRef, wait.message, 'response'));
    const facts = await readSessionFacts(world, wait.sender.ref);
    expect(facts.wait).toBeNull();
    expect(facts.waits).toEqual([]);

    // The entry the successor saved replays its receipt; the record keeps exactly one consuming input.
    const replay = await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messages.recordInputAccepted', wave: '7B-1 X',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, {
      input: { messageRef: wait.message, part: accepted.part, executionRef: accepted.executionRef, kernel: accepted.kernel },
      meta: { requestId: 'x-accept-continuation-replay', expected: [] },
    });
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    const replayed = await readS7BMessage(world, wait.message);
    expect(replayed).toEqual(continued.message);
    expect(replayed.acceptedInputs?.filter(entry => entry.consumesWait === true)).toHaveLength(1);
  });

  it('an offer held while the Goal is paused still writes the acceptance, and a replay adds nothing', async () => {
    const { world } = await openS7BWorld({ backend });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'x-accept-pause' });
    const person = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: wait.recipient.ref, text: 'S7B X-accept pause', intent: 'notify', goalRef: wait.goal,
    }, 'x-accept-pause-send')), 'the X-accept pause person message');
    const inputId = deriveSessionInputId(person.ref, 'message');

    // The real supply delegate gate: the real supply is called unchanged; its first offer carrying this message is
    // held after it returned, so the public Goal pause lands between the offer and the Kernel's acceptance.
    const reached = deferred();
    const release = deferred();
    let held = false;
    const kernelSpy = vi.mocked(kernelModule.runCodingAgent);
    const existing = kernelSpy.getMockImplementation();
    if (existing === undefined) throw new Error('the existing Kernel spy is not installed');
    kernelSpy.mockImplementation((input: Readonly<RunAppInput>) => {
      const actual = input.inputSupply;
      if (actual === undefined) return existing(input);
      return existing({ ...input, inputSupply: async (point, options) => {
        const offered = await actual(point, options);
        if (!held && offered.some(item => item.inputId === inputId)) {
          held = true;
          reached.resolve();
          await release.promise;
        }
        return offered;
      } });
    });

    const driving = replyS7AMessage(world, { goal: wait.goal, recipient: wait.recipient, messageRef: wait.message,
      taskId: wait.tasks[1]!.taskId, label: 'x-accept-pause', text: 'S7B x-accept-pause reply' });
    await reached.promise;
    await pauseS7AGoal(world, wait.goal);
    release.resolve();
    await driving;

    // The pause landed before the Run's model call: the inquiry has no reply, so the acceptance below is the
    // Kernel's own and not a side effect of the reply.
    const unanswered = await readS7BMessage(world, wait.message);
    expect(unanswered.response).toBeNull();
    expect(unanswered.status).toBe('pending');

    // The paused Goal stops the Run at its before-model safe point, after the Kernel accepted the offered input:
    // the platform confirm still wrote delivered and its proof.
    await expect.poll(async () => (await readS7BMessage(world, person.ref)).acceptedInputs?.length ?? 0,
      { timeout: 10_000, interval: 20 }).toBe(1);
    const delivered = await readS7BMessage(world, person.ref);
    const accepted = acceptedOf(delivered, 'message');
    expect(accepted).toMatchObject({ part: 'message', evidence: 'input_accepted', consumesWait: false });
    expect(accepted.kernel).toEqual(await kernelInputFact(world, accepted.executionRef, person.ref, 'message'));
    expect(delivered.delivery).toBe('delivered');
    expect(delivered.deliveryEvidence).toEqual({
      executionRef: accepted.executionRef, acceptedAt: accepted.acceptedAt,
    });

    // The same real accepted entry replays its receipt and appends no second input.
    const replay = await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messages.recordInputAccepted', wave: '7B-1 X',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, {
      input: { messageRef: person.ref, part: accepted.part, executionRef: accepted.executionRef, kernel: accepted.kernel },
      meta: { requestId: 'x-accept-pause-replay', expected: [] },
    });
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    expect(await readS7BMessage(world, person.ref)).toEqual(delivered);
  });
});
