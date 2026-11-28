/**
 * BK-E2 (forward-line gaps 1–3): the reply hand-over and the notices that must stop after it.
 *
 * Every state comes from a public step: the S7B world's real lines, messages and scripted models, the Host's own
 * `sessions/archive-line`, `messages/forward`, `waits/dispose` and settings routes, the real Kernel-missing retirement
 * (`retireS7BSender`), and the planning Query close-out the Host itself drives. Reads go through public routes or
 * `platform.sessionFacts.readWait`; no store is read. Item keys are the frozen public grammar, hand-computed here.
 *
 * Rows f–j guard the lead's 11-28 rework. f, h and i are green on this tree; g and j are red: the production
 * fixes that keep a formal answer's `answerRef` on the transferred copy and that read the waiting line only for
 * `mode === 'transfer'` are not here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { S6B3World } from '../helpers/S6B3-fixture.js';
import { configureS6B3SecondWorkspace } from '../helpers/S6B3-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_AT, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { settleHost, waitForResponse } from '../helpers/IV-host-fixture.js';
import {
  createPLAdviserLine, openPLConsumptionWorld, seedPLSenderPlan, sendPLActionWait,
} from '../helpers/PL-consumption-fixture.js';
import { committed, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import {
  answerS7BWait, expireS7BWait, listed, openS7BWorld, readS7BMessage, readS7BWaits, retireS7BSender,
  runS7BWait, sendS7BWaitingInquiry,
} from '../helpers/S7B-fixture.js';
import { refinementPlan } from '../helpers/S7B-V-fixture.js';
import { driveSecondWorkflow } from '../helpers/XWS2A-world.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

const queueOf = async (world: S6AHostWorld,
  category: 'disconnect' | 'undelivered_reply'): Promise<DecisionQueueReadV1> => ready<DecisionQueueReadV1>(
  await world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, sections: ['notices'], categories: [category], page: { limit: 100 },
  })), `the ${category} notice queue`);

const operationKeyOf = (session: SessionRef, at: string): string =>
  'disconnect:' + canonicalJson({ sessionRef: { projectId: session.projectId, sessionId: session.sessionId }, at });

const disconnectItemKeyOf = (operationKey: string, messageRef: SessionMessage['ref'],
  side: 'waiting' | 'recipient'): string =>
  'disconnect:' + canonicalJson({ operation: operationKey, messageRef, side });

/**
 * E2-02/E2-06's world: a real wait on a LIVE line, its reply saved, and a fresh line ready to receive the reply.
 * `transfer()` is the person's `waits/dispose { mode: 'transfer_reply' }` command. `spare` is the second live line
 * row f uses for the "another destination" variant.
 */
async function openLiveAnsweredReplyWorld(label: string, options: { spare?: boolean } = {}) {
  const { world } = await openS7BWorld({ backend: 'memory' });
  worlds.push(world);
  world.clock.set(S6A_AT);
  const wait = await runS7BWait(world, { label: `bke-e2-${label}` });
  await answerS7BWait(world, {
    goal: wait.goal, recipient: wait.recipient, message: wait.message, task: wait.tasks[1]!,
    label: `bke-e2-${label}-reply`,
  });
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const transferTo = await sessionOf(world, await createS6BLine(main, {
    label: `bke-e2-${label}-transfer`, role: S6A_WORK_ROLE,
  }));
  const spare = options.spare === true
    ? await sessionOf(world, await createS6BLine(main, { label: `bke-e2-${label}-spare`, role: S6A_WORK_ROLE }))
    : null;
  const commandId = `bke-e2-${label}-transfer-reply`;
  const transfer = async (): Promise<SessionMessage> => committed<SessionMessage>(
    await world.post('waits/dispose', plain(S6A_SCOPE, {
      commandId, messageRef: wait.message, mode: 'transfer_reply', to: transferTo.ref,
    })), 'the reply transfer');
  return { world, wait, transferTo, spare, commandId, transfer };
}

/**
 * E2-03's world: the same wait and saved reply, then the frozen real retirement (Kernel missing + Host restart,
 * SQLite only) so the undelivered-reply notice source lists it. No store and no hand-written health fact.
 */
async function openRetiredAnsweredReplyWorld(label: string) {
  const { world } = await openS7BWorld({ backend: 'sqlite' });
  worlds.push(world);
  world.clock.set(S6A_AT);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const goal = (await main.createGoal(`bke-e2-${label}`, 'BKE-E2 retired reply goal')).ref;
  const { tasks } = await adoptS6BPlan(main, goal, {
    label: `bke-e2-${label}`, taskIds: [`bke-e2-${label}-send`, `bke-e2-${label}-reply`],
    role: S6A_WORK_ROLE.templateId,
  });
  const sender = await sessionOf(world, await createS6BLine(main, {
    label: `bke-e2-${label}-sender`, role: S6A_WORK_ROLE, tasks: [tasks[0]!],
  }));
  const recipient = await sessionOf(world, await createS6BLine(main, {
    label: `bke-e2-${label}-recipient`, role: S6A_WORK_ROLE,
  }));
  // No trailing text: the retirement's own tool call is the sender line's next model reply.
  const sent = await sendS7BWaitingInquiry(world, {
    goal, session: sender, taskId: tasks[0]!.taskId, label: `bke-e2-${label}`, trailingText: false,
    body: { recipient: recipient.ref, text: `BKE-E2 ${label} question`,
      needsReply: true, waitAfterSend: true },
  });
  await answerS7BWait(world, {
    goal, recipient, message: sent.ref, task: tasks[1]!, label: `bke-e2-${label}-reply`,
  });
  await retireS7BSender(world, { goal, sender, task: tasks[0]!, label: `bke-e2-${label}` });
  const transferTo = await sessionOf(world, await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE), {
    label: `bke-e2-${label}-transfer`, role: S6A_WORK_ROLE,
  }));
  const transfer = async (): Promise<SessionMessage> => committed<SessionMessage>(
    await world.post('waits/dispose', plain(S6A_SCOPE, {
      commandId: `bke-e2-${label}-transfer-reply`, messageRef: sent.ref,
      mode: 'transfer_reply', to: transferTo.ref,
    })), 'the reply transfer');
  return { world, message: sent.ref, sender, transferTo, transfer };
}

/**
 * Rows g and i: a real Work Run's waiting inquiry whose reply is the planning flow's formal Query Answer (sender
 * `query_run` with `answerRef`). The refused-plan answer closes the Query and the Host associates the formal answer
 * with the executor's wait, the same public path `PL-02c` drives (`tests/business/PL-02-needs-decision.test.ts`).
 */
async function openFormalAnswerWait(label: string) {
  const world = await openPLConsumptionWorld({ label: `bke-e2-${label}` });
  worlds.push(world);
  await settleHost(world);
  const goal = world.goals.first;
  const sender = await seedPLSenderPlan(world, {
    goal, label: `bke-e2-${label}`, taskIds: [`bke-e2-${label}-send`],
  });
  const adviser = await createPLAdviserLine(world, `bke-e2-${label}-adviser`);
  const answer = JSON.parse(await refinementPlan(world, goal, {
    label: `bke-e2-${label}`, taskId: `bke-e2-${label}-ghost`, role: S6A_WORK_ROLE.templateId,
  })) as { plan: { tasks: { taskId: string; scope: unknown }[] } };
  const ghost = answer.plan.tasks.find(task => task.taskId === `bke-e2-${label}-ghost`);
  if (ghost === undefined) throw new Error(`BKE-E2: ${label} has no ghost Task to refuse`);
  ghost.scope = { kind: 'module', moduleRef: `bke-e2-${label}-ghost-module` };
  await world.scripted.script(adviser, [{ kind: 'text', text: JSON.stringify(answer) }]);
  const sent = await sendPLActionWait(world, {
    goal, session: sender.line, sessionTaskId: `bke-e2-${label}-send`, recipient: adviser.ref,
    text: `BKE-E2 ${label} asks for a plan the catalog refuses`, label: `bke-e2-${label}`,
  });
  const replied = await waitForResponse(world, sent.message.ref);
  const response = replied.response;
  if (response === null || response.sender.kind !== 'query_run') {
    throw new Error(`BKE-E2: ${label}'s wait has no formal Query answer: ${JSON.stringify(replied)}`);
  }
  return { world, wait: sent.message, response };
}

/**
 * The same-project second workspace both cross-workspace rows open: the S6B3 fixture's `workspaces/open` on the
 * world's own Host and settings directory, with the fixture's two goals. No second Host and no new project.
 */
async function openE2SecondWorkspace(world: S6AHostWorld, name: string) {
  const s6b3: S6B3World = {
    host: world, mainScope: S6A_SCOPE, settingsDirectory: world.settingsDirectoryOf(),
    instanceSeq: { current: 1 }, held: [], close: async () => undefined,
  };
  return await configureS6B3SecondWorkspace(s6b3, { name, goals: 2 });
}

describe('BK-E2 reply hand-over (R-F2/R-F3)', () => {
  it('E2-03 drops the transferred reply from the notices and from messages/undelivered-replies', async () => {
    // Green after production: R-F2/R-F3 make both reads skip `responseTransferredTo` (E2-03).
    // Named mutation: remove the `responseTransferredTo` skip in `mailbox-pages.ts` and the item returns.
    const { world, message, sender, transfer } = await openRetiredAnsweredReplyWorld('03');
    const original = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message)),
      'the original answered wait');
    const response = original.response;
    if (response === null) throw new Error('BKE-E2: E2-03 expected the saved reply');
    const expectedKey = 'undelivered_reply:'
      + canonicalJson({ messageRef: message, responseRef: response.bodyRef });

    const queueBefore = await queueOf(world, 'undelivered_reply');
    expect(queueBefore.notices.map(item => item.itemKey)).toEqual([expectedKey]);
    const undeliveredBefore = ready<{ items: { messageRef: SessionMessage['ref'] }[] }>(
      await world.post('messages/undelivered-replies',
        plain(S6A_SCOPE, { sessionRef: sender.ref, page: { limit: 20 } })), 'the undelivered replies');
    expect(undeliveredBefore.items.map(item => item.messageRef)).toEqual([message]);

    await transfer();

    const queueAfter = await queueOf(world, 'undelivered_reply');
    expect(queueAfter.notices).toEqual([]);
    const undeliveredAfter = ready<{ items: { messageRef: SessionMessage['ref'] }[] }>(
      await world.post('messages/undelivered-replies',
        plain(S6A_SCOPE, { sessionRef: sender.ref, page: { limit: 20 } })), 'the undelivered replies');
    expect(undeliveredAfter.items).toEqual([]);
  });

  it('E2-02 commits transfer_reply as one new message carrying the saved reply without a new wait, '
    + 'and E2-06 keeps it out of the Kernel-accepted facts with the wait answered', async () => {
    // Green after production: R-F2 adds the branch and writes only `responseTransferredTo`, never
    // acceptedInputs/waitCancelledAt; the wait stays `answered` (E2-02, E2-06).
    // Named mutation: build the copy from `before.bodyRef` instead of `response.bodyRef` and E2-02 fails.
    const { world, wait, transferTo, transfer } = await openLiveAnsweredReplyWorld('02');
    const original = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the original answered wait');
    const response = original.response;
    if (response === null) throw new Error('BKE-E2: E2-02 expected the saved reply');
    const acceptedBefore = original.acceptedInputs ?? [];
    expect(acceptedBefore.map(entry => entry.part)).not.toContain('response');
    const inboxBefore = await listed(world, 'inbox', transferTo);

    const copy = await transfer();

    const inboxAfter = await listed(world, 'inbox', transferTo);
    expect(inboxAfter).toHaveLength(inboxBefore.length + 1);
    const newMessage = inboxAfter.find(message => message.ref.projectId === copy.ref.projectId
      && message.ref.workspaceId === copy.ref.workspaceId && message.ref.messageId === copy.ref.messageId);
    expect(newMessage).toMatchObject({
      ref: copy.ref,
      recipient: transferTo.ref,
      bodyRef: response.bodyRef,
      sourceRef: response.sourceRef,
      originalRef: wait.message,
      deadline: null,
      deadlineMs: null,
    });
    expect(newMessage?.needsReply === true).toBe(false);
    expect(newMessage?.waitAfterSend === true).toBe(false);

    const after = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the original after the transfer');
    expect(after.responseTransferredTo).toEqual(copy.ref);
    expect(after.acceptedInputs ?? []).toEqual(acceptedBefore);
    expect(after.waitCancelledAt).toBeNull();
    expect(after.status).toBe('responded');
    const waits = await readS7BWaits(world, { session: wait.sender, messageRef: wait.message });
    expect(waits.waitByRef.state.state).toBe('answered');
  });
});

describe('BK-E2 refusals and forward skip (R-F2/R-F3)', () => {
  it('E2-04 refuses transfer_reply for a wait with no saved reply and writes nothing', async () => {
    // Green after production: R-F2 adds the response===null step (E2-04).
    // Named mutation: delete the `response === null` rejection and the command commits.
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    world.clock.set(S6A_AT);
    const wait = await runS7BWait(world, { label: 'bke-e2-04' });
    const transferTo = await sessionOf(world, await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE), {
      label: 'bke-e2-04-transfer', role: S6A_WORK_ROLE,
    }));
    const originalBefore = await readS7BMessage(world, wait.message);
    const inboxBefore = await listed(world, 'inbox', transferTo);

    const result = (await world.post('waits/dispose', plain(S6A_SCOPE, {
      commandId: 'bke-e2-04-transfer-reply', messageRef: wait.message, mode: 'transfer_reply', to: transferTo.ref,
    }))).body as { status?: string; code?: string; reason?: string };

    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(result.reason).toContain('wait has no reply to transfer');
    expect(await readS7BMessage(world, wait.message)).toEqual(originalBefore);
    expect(await listed(world, 'inbox', transferTo)).toEqual(inboxBefore);
  });

  it('E2-05 drops the forwarded undelivered message from the disconnect notices (R-F3 message half)', async () => {
    // Green after production: R-F3 skips a message whose `transferredTo` is set.
    // Named mutation: remove the `message.transferredTo !== null` skip in the disconnect fact and the item returns.
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    world.clock.set(S6A_AT);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const archivedRecipient = await sessionOf(world, await createS6BLine(main, {
      label: 'bke-e2-05-archived', role: S6A_WORK_ROLE,
    }));
    const live = await sessionOf(world, await createS6BLine(main, { label: 'bke-e2-05-live', role: S6A_WORK_ROLE }));
    const original = await sendS7A2PersonMessage(world, { label: 'bke-e2-05', recipient: archivedRecipient.ref });
    const archived = await world.archive(archivedRecipient);
    const itemKey = disconnectItemKeyOf(operationKeyOf(archivedRecipient.ref, archived.record.archivedAt!),
      original.ref, 'recipient');
    const before = await queueOf(world, 'disconnect');
    expect(before.notices.map(item => item.itemKey)).toContain(itemKey);

    const forwarded = (await world.post('messages/forward', plain(S6A_SCOPE, {
      commandId: 'bke-e2-05-forward', messageRef: original.ref, to: live.ref,
    }))).body as { status?: string };
    expect(forwarded.status).toBe('forwarded');

    const after = await queueOf(world, 'disconnect');
    expect(after.notices.map(item => item.itemKey)).not.toContain(itemKey);
  });
});

describe('BK-E2 R-F2 rework rows (f–j)', () => {
  it.each([
    { key: 'to-b', name: 'another commandId to the same line', to: 'B' as const, archive: false },
    { key: 'to-c', name: 'another commandId to a third line', to: 'C' as const, archive: false },
    { key: 'archived-b', name: 'another commandId to the archived line', to: 'B' as const, archive: true },
  ])('f: R-F2 refuses a later transfer with a new commandId ($name) and replays the first receipt',
    async variant => {
      // Green after production: an already-transferred reply answers `invalid` with "the reply was already
      // transferred" before the destination read, including the archived-line variant; the same commandId still
      // replays the original receipt (R-F2 step 2 and the lead's 11-27 23:1x supplement).
      // Named mutation: move the `responseTransferredTo` check after the destination read (or make it `busy`).
      const { world, wait, transferTo, spare, commandId, transfer } = await openLiveAnsweredReplyWorld('f', {
        spare: true,
      });
      if (spare === null) throw new Error('BKE-E2: f needs its second live line');
      const first = await transfer();
      if (variant.archive) await world.archive(transferTo);
      const originalBefore = await readS7BMessage(world, wait.message);
      const targetInboxBefore = await listed(world, 'inbox', transferTo);
      const spareInboxBefore = await listed(world, 'inbox', spare);
      const to = variant.to === 'B' ? transferTo.ref : spare.ref;

      const result = (await world.post('waits/dispose', plain(S6A_SCOPE, {
        commandId: `${commandId}-${variant.key}`, messageRef: wait.message,
        mode: 'transfer_reply', to,
      }))).body as { status?: string; code?: string; reason?: string };
      expect(result.status).toBe('rejected');
      expect(result.code).toBe('invalid');
      expect(result.reason).toContain('the reply was already transferred');

      expect(await readS7BMessage(world, wait.message)).toEqual(originalBefore);
      expect(await listed(world, 'inbox', transferTo)).toEqual(targetInboxBefore);
      expect(await listed(world, 'inbox', spare)).toEqual(spareInboxBefore);

      const replay = await transfer();
      expect(replay.ref).toEqual(first.ref);
    });

  it('g: R-F2 transfers a formal Query answer reply: the original keeps its answerRef, the copy carries the plain Query-round sender', async () => {
    // Ruling item 10, read as answered to the test writer (11-28): "still keeps the formal answer reference" is the
    // original reply's. The copy's sender is the Query-round identity only (round-1 review: the message format does not
    // take a formal sender); the copy keeps the reply's body and source and names the original message.
    // Named mutation: drop `answerRef` from the original reply on transfer, or swap the copy's `bodyRef`: this row reds.
    const { world, wait, response } = await openFormalAnswerWait('g');
    const sender = response.sender;
    expect('answerRef' in sender).toBe(true);
    if (!('answerRef' in sender)) {
      throw new Error(`BKE-E2: g's reply is not a formal Query answer: ${JSON.stringify(sender)}`);
    }
    const transferTo = await sessionOf(world, await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE), {
      label: 'bke-e2-g-transfer', role: S6A_WORK_ROLE,
    }));

    const result = (await world.post('waits/dispose', plain(S6A_SCOPE, {
      commandId: 'bke-e2-g-transfer-reply', messageRef: wait.ref, mode: 'transfer_reply', to: transferTo.ref,
    }))).body as { status?: string; code?: string; reason?: string; value?: SessionMessage };
    expect(result.status).toBe('committed');
    const copy = result.value;
    if (copy === undefined) throw new Error('BKE-E2: g committed without a copied message');
    const copied = await readS7BMessage(world, copy.ref);
    const { answerRef: _answerRef, ...identity } = sender;
    expect('answerRef' in copied.sender).toBe(false);
    expect(copied.sender).toEqual(identity);
    expect(copied.originalRef).toEqual(wait.ref);
    expect(copied.bodyRef).toEqual(response.bodyRef);
    expect(copied.sourceRef).toEqual(response.sourceRef);
    const after = await readS7BMessage(world, wait.ref);
    expect(after.response).toEqual(response);
  });

  it('h: R-F2 refuses a reply saved after the wait expired and writes nothing', async () => {
    // Green after production: the reply's own `expiredAt`/`withdrawnAt` is read first, so a reply saved after the
    // wait expired answers `invalid`/`wait_not_open` and writes nothing (R-F2 step 2).
    // Named mutation: judge only `wait.state` and drop the actual `expiredAt`/`withdrawnAt` check.
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    world.clock.set(S6A_AT);
    const wait = await runS7BWait(world, { label: 'bke-e2-h' });
    world.clock.advance(86_400_000);
    const expired = await expireS7BWait(world, { messageRef: wait.message });
    expect(expired.message.expiredAt).not.toBeNull();
    expect(expired.message.response).toBeNull();
    await answerS7BWait(world, {
      goal: wait.goal, recipient: wait.recipient, message: wait.message, task: wait.tasks[1]!,
      label: 'bke-e2-h-reply',
    });
    const waits = await readS7BWaits(world, { session: wait.sender, messageRef: wait.message });
    expect(waits.waitByRef.state.state).toBe('answered');

    const transferTo = await sessionOf(world, await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE), {
      label: 'bke-e2-h-transfer', role: S6A_WORK_ROLE,
    }));
    const originalBefore = await readS7BMessage(world, wait.message);
    const inboxBefore = await listed(world, 'inbox', transferTo);

    const result = (await world.post('waits/dispose', plain(S6A_SCOPE, {
      commandId: 'bke-e2-h-transfer-reply', messageRef: wait.message, mode: 'transfer_reply', to: transferTo.ref,
    }))).body as { status?: string; code?: string; reason?: string };
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('invalid');
    expect(result.reason).toBe('wait_not_open');
    expect(await readS7BMessage(world, wait.message)).toEqual(originalBefore);
    expect(await listed(world, 'inbox', transferTo)).toEqual(inboxBefore);
  });

  it('i: R-F2 transfers into another workspace of the same project', async () => {
    // Green after production: `transfer_reply` reads its destination with the forward rule, so a line in another
    // workspace of the same project is eligible; the copy is received there (lead's 18:0x ruling).
    // Named mutation: read the transfer_reply destination with `'dispose'` again (the `transfer` arm keeps it).
    const { world, wait } = await openFormalAnswerWait('i');
    const second = await openE2SecondWorkspace(world, 'bke-e2-i-second');
    const transferTo = await createS6BLine(s6aCardsWorkspace(world, second.scope), {
      label: 'bke-e2-i-transfer', role: S6A_WORK_ROLE,
    });

    const result = (await world.post('waits/dispose', plain(S6A_SCOPE, {
      commandId: 'bke-e2-i-transfer-reply', messageRef: wait.ref, mode: 'transfer_reply', to: transferTo.ref,
    }))).body as { status?: string; code?: string; reason?: string; value?: SessionMessage };
    expect(result.status).toBe('committed');
    const copy = result.value;
    if (copy === undefined) throw new Error('BKE-E2: i committed without a copied message');
    expect(copy.recipient).toEqual(transferTo.ref);

    const inbox = ready<{ items: SessionMessage[] }>(await world.post('messages/inbox',
      plain(second.scope, { recipient: transferTo.ref, page: { limit: 20 } })), `the ${transferTo.label} inbox`).items;
    expect(inbox.map(message => message.ref)).toContainEqual(copy.ref);
  });

  it('j: R-F2 transfers a reply answered in the second workspace after the wait was forwarded there', async () => {
    // Today RED: expected `committed`, actual `rejected` with `not_found` — with B's context the read of A's
    // sender line stops before the original message's own table — 施工方生产返工今天不在这棵树上.
    // Named mutation: 只在 mode === 'transfer' 时读等待线（未执行）.
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    world.clock.set(S6A_AT);
    const sent = await runS7BWait(world, { label: 'bke-e2-j' });
    const original = await readS7BMessage(world, sent.message);
    await world.archive(sent.recipient);
    expect((await readS7BMessage(world, sent.message)).transferredTo).toBeNull();

    const second = await openE2SecondWorkspace(world, 'bke-e2-j-second');
    const bMain = s6aCardsWorkspace(world, second.scope);
    const bGoal = second.goals[0]!.ref;
    const bWorkRole = (await world.readProfiles()).find(profile =>
      profile.scope.workspaceId === second.scope.workspaceId && profile.sessionRole.kind === 'legacy_template'
      && profile.sessionRole.templateId === 'local-workbench')?.sessionRole;
    if (bWorkRole === undefined || bWorkRole.kind !== 'legacy_template') {
      throw new Error('BKE-E2: j the second workspace publishes no Work profile');
    }
    const { tasks } = await adoptS6BPlan(bMain, bGoal, {
      label: 'bke-e2-j-b', taskIds: ['bke-e2-j-b-work'], role: bWorkRole.templateId,
    });
    const bLine = await createS6BLine(bMain, {
      label: 'bke-e2-j-b-recipient', role: bWorkRole, tasks: [tasks[0]!],
    });
    const bCard = ready<{ record: { ref: S6ASession['aggregateRef']; role: S6ASession['role']; createdAt: string } }>(
      await world.post('sessions/read', plain(second.scope, bLine.ref)), `the second-workspace Session ${bLine.label}`);
    const bRecipient: S6ASession = { label: bLine.label, ref: bLine.ref, aggregateRef: bCard.record.ref,
      role: structuredClone(bCard.record.role), createdAt: bCard.record.createdAt };
    const bTarget = await createS6BLine(bMain, { label: 'bke-e2-j-b-target', role: S6A_WORK_ROLE });

    // A's undelivered wait is forwarded to B: the copy keeps A's sender and the waiting fields, in B's workspace.
    const forwarded = (await world.post('messages/forward', plain(S6A_SCOPE, {
      commandId: 'bke-e2-j-forward', messageRef: sent.message, to: bRecipient.ref,
    }))).body as { status?: string; message?: SessionMessage };
    expect(forwarded.status).toBe('forwarded');
    const copy = forwarded.message;
    if (copy === undefined) throw new Error('BKE-E2: j forwarded without a copied message');
    expect(copy.ref.workspaceId).toBe(second.scope.workspaceId);
    expect(copy.sender).toEqual(original.sender);
    expect(copy).toMatchObject({
      recipient: bRecipient.ref, needsReply: true, waitAfterSend: true,
      deadline: original.deadline, deadlineMs: original.deadlineMs, originalRef: sent.message,
    });

    // B's recipient answers the copy through its own real Work Run.
    await world.scripted.script(bRecipient, [
      { kind: 'calls', calls: [{ callId: 'bke-e2-j-b-reply', name: 'respond_session_message',
        args: { messageRef: copy.ref, expectedRevision: copy.revision, text: 'BKE-E2 j: B answers the copy' } }] },
      { kind: 'text', text: 'BKE-E2 j: B replied' },
    ], second.scope);
    await driveSecondWorkflow(bMain, { schemaVersion: 1, goalRef: bGoal,
      flowId: 'bke-e2-j-b-reply', sessionHint: bRecipient.ref, kind: 'select_work',
      taskId: tasks[0]!.taskId }, 'open_checks');
    const answered = ready<SessionMessage>(await world.post('messages/read', plain(second.scope, copy.ref)),
      `the second-workspace message ${copy.ref.messageId}`);
    const reply = answered.response;
    if (reply === null) throw new Error('BKE-E2: j the B recipient did not answer the copy');

    // On B, the saved reply is handed to a qualified B line; the receipt is committed and the copy points at it.
    const targetBefore = ready<{ items: SessionMessage[] }>(await world.post('messages/inbox',
      plain(second.scope, { recipient: bTarget.ref, page: { limit: 20 } })), `the ${bTarget.label} inbox`).items;
    const result = (await world.post('waits/dispose', plain(second.scope, {
      commandId: 'bke-e2-j-transfer-reply', messageRef: copy.ref, mode: 'transfer_reply', to: bTarget.ref,
    }))).body as { status?: string; code?: string; reason?: string; value?: SessionMessage };
    expect(result.status).toBe('committed');
    const transferred = result.value;
    if (transferred === undefined) throw new Error('BKE-E2: j committed without a copied reply');
    expect(transferred.recipient).toEqual(bTarget.ref);
    expect(transferred.sender).toEqual(reply.sender);

    const targetAfter = ready<{ items: SessionMessage[] }>(await world.post('messages/inbox',
      plain(second.scope, { recipient: bTarget.ref, page: { limit: 20 } })), `the ${bTarget.label} inbox`).items;
    expect(targetAfter).toHaveLength(targetBefore.length + 1);
    expect(targetAfter.map(message => message.ref)).toContainEqual(transferred.ref);
    const copyAfter = ready<SessionMessage>(await world.post('messages/read', plain(second.scope, copy.ref)),
      `the second-workspace message ${copy.ref.messageId}`);
    expect(copyAfter.responseTransferredTo).toEqual(transferred.ref);
  });
});
