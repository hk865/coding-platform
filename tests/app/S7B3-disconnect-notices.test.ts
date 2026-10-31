/** N-disconnect/N-notify/N-interrupt (7b3-n): SR4 §4.1–§4.5; entries: sessions/archive-line, decisions/queue, messages/send, messages/inbox, queries/start (held round). */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { GoalCopyConfirmResultV1 } from '../../src/contracts/goal-card.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_AT, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B, holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import { committed, nameS7AReplyHandler, ready, sessionOf, S7A_REPLY_TOOLS } from '../helpers/S7A-fixture.js';
import { createCancelledS7A2Goal, sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { answerS7BWait, openS7BWorld, runS7BWait } from '../helpers/S7B-fixture.js';
import { openConsumeHostWorld } from '../helpers/S7B2-consumable-sessions.js';
import { waitFor } from '../scenarios/harness.js';
import { announceInterruption, systemNotifyRequest } from '../../src/app/host-notices.js';
import { HOST_RECONCILE_ACTOR } from '../../src/app/startup-reconcile.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

const openWorld = async (backend: 'memory' | 'sqlite'): Promise<S6AHostWorld> => {
  const { world } = await openS7BWorld({ backend });
  worlds.push(world);
  world.clock.set(S6A_AT);
  return world;
};

const disconnectQueueOf = async (world: S6AHostWorld): Promise<DecisionQueueReadV1> => ready<DecisionQueueReadV1>(
  await world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, sections: ['notices'], categories: ['disconnect'], page: { limit: 100 },
  })), 'the disconnect queue');

/** The literal item key: identity, message and side, hand-computed from the production key's frozen grammar. */
const itemKeyOf = (operationKey: string, messageRef: SessionMessage['ref'], side: 'waiting' | 'recipient'): string =>
  'disconnect:' + canonicalJson({ operation: operationKey, messageRef, side });

const operationKeyOf = (sessionRef: SessionRef, at: string): string =>
  'disconnect:' + canonicalJson({ sessionRef: { projectId: sessionRef.projectId, sessionId: sessionRef.sessionId }, at });

describe('N-source (memory): the disconnect person notice is a pure projection', () => {
  it('archiving the waiting line\'s recipient yields one item naming the recipient side, its Goal and summary', async () => {
    const world = await openWorld('memory');
    const wait = await runS7BWait(world, { label: 'n-source-recipient' });
    const archived = await world.archive(wait.recipient);
    const archivedAt = archived.record.archivedAt;
    const read = await disconnectQueueOf(world);

    const operationKey = operationKeyOf(wait.recipient.ref, archivedAt!);
    const itemKey = itemKeyOf(operationKey, wait.message, 'recipient');
    expect(read.notices).toHaveLength(1);
    expect(read.notices[0]).toMatchObject({
      itemKey, category: 'disconnect', subject: { kind: 'goal', goalRef: wait.goal },
      summary: `断开通知 · Session ${wait.recipient.ref.sessionId} · ${archivedAt} · 没人接，等你定`,
      objects: [], rework: null,
    });
    expect(read.counts.notices.disconnect).toBe(1);
    // A Host system-level `notify` to the gone line asks for nothing, so it is not a second fact.
    await world.platform.messages.sendMessage(world.systemContext(), systemNotifyRequest({
      recipient: wait.recipient.ref, text: 'S7B3 host notify after the archive', requestId: 'n-source-host-system-notify',
    }));
    const cascaded = await disconnectQueueOf(world);
    expect(cascaded.notices).toHaveLength(1);
  });

  it('archiving both sides yields two items (waiting and recipient) with different keys', async () => {
    const world = await openWorld('memory');
    const wait = await runS7BWait(world, { label: 'n-source-both' });
    // The waiting line can be archived only with its open wait transferred; the original sender stays the message's
    // `waiting` party, so both communication sides of the same unconsumed wait are gone.
    const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the waiting message');
    const transferTo = await world.createWorkSession('s7b3-n-source-transfer');
    await nameS7AReplyHandler(world, message, transferTo.ref);
    const archivedSender = await world.readSession(wait.sender);
    const archivedRecipient = await world.archive(wait.recipient);
    const read = await disconnectQueueOf(world);

    const recipientKey = itemKeyOf(operationKeyOf(wait.recipient.ref, archivedRecipient.record.archivedAt!),
      wait.message, 'recipient');
    const waitingKey = itemKeyOf(operationKeyOf(wait.sender.ref, archivedSender.record.archivedAt!),
      wait.message, 'waiting');
    expect(read.notices).toHaveLength(2);
    expect(read.notices.map(item => item.itemKey).sort()).toEqual([recipientKey, waitingKey].sort());
    expect(recipientKey).not.toBe(waitingKey);
    expect(read.notices.every(item => item.subject.kind === 'goal')).toBe(true);
  });

  it('an undelivered message to an archived line yields a recipient item for that message', async () => {
    const world = await openWorld('memory');
    const wait = await runS7BWait(world, { label: 'n-source-undelivered' });
    const archived = await world.archive(wait.recipient);
    const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: wait.recipient.ref, text: 'S7B3 undelivered after the archive', intent: 'notify',
      goalRef: wait.goal,
    }, 'n-source-undelivered-send')), 'the undelivered person message');
    const read = await disconnectQueueOf(world);

    const key = itemKeyOf(operationKeyOf(wait.recipient.ref, archived.record.archivedAt!), sent.ref, 'recipient');
    expect(read.notices.map(item => item.itemKey)).toContain(key);
    expect(read.notices.find(item => item.itemKey === key)).toMatchObject({
      category: 'disconnect', subject: { kind: 'goal', goalRef: wait.goal },
      summary: `断开通知 · Session ${wait.recipient.ref.sessionId} · ${archived.record.archivedAt} · 没人接，等你定`,
    });
  });
});

describe('N-source (SQLite only: the unavailable-line restart)', () => {
  it('a retired line\'s item uses the unavailableSince cursor and that event\'s occurredAt', async () => {
    const world = await openWorld('sqlite');
    const retired = await world.makeUnavailableSecretary('s7b3-n-source-retired');
    const card = await world.readSession(retired);
    const unavailableSince = card.record.unavailableSince;
    expect(unavailableSince).not.toBeNull();
    const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: retired.ref, text: 'S7B3 message to the retired line', intent: 'notify',
    }, 'n-source-retired-send')), 'the message to the retired line');
    const read = await disconnectQueueOf(world);

    const itemKey = itemKeyOf(operationKeyOf(retired.ref, unavailableSince!), sent.ref, 'recipient');
    // The one item names the retired line and the health event's own time (the frozen clock instant).
    const item = read.notices.find(notice => notice.itemKey === itemKey);
    expect(read.notices).toHaveLength(1);
    expect(item).toMatchObject({
      itemKey, category: 'disconnect',
      summary: `断开通知 · Session ${retired.ref.sessionId} · ${S6A_AT} · 没人接，等你定`,
      position: { kind: 'commit', cursor: unavailableSince },
      objects: [], rework: null,
    });
  });

  it('the same archive survives reopen with the same itemKey and no stored notice', async () => {
    const world = await openWorld('sqlite');
    const wait = await runS7BWait(world, { label: 'n-source-reopen' });
    const archived = await world.archive(wait.recipient);
    const first = await disconnectQueueOf(world);
    const key = itemKeyOf(operationKeyOf(wait.recipient.ref, archived.record.archivedAt!), wait.message, 'recipient');
    expect(first.notices.map(item => item.itemKey)).toEqual([key]);

    await world.reopen();
    const after = await disconnectQueueOf(world);
    expect(after.notices).toHaveLength(1);
    expect(after.notices[0]!.itemKey).toBe(key);
  });
});

describe('N-source case 3: the copy-forward gone recipient carries the copy Goal pin', () => {
  it('archives the copied intervention recipient and reads the pending item with its copy Goal pin', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    world.clock.set(S6A_AT);
    const source = await createCancelledS7A2Goal(world);
    const line = await sessionOf(world, await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE), {
      label: 'n-source-copy-line', role: S6A_WORK_ROLE,
    }));
    const message = await sendS7A2PersonMessage(world, {
      label: 'n-source-copy', recipient: line.ref, goal: source.goal.ref,
    });
    const copy = committed<GoalCopyConfirmResultV1>(await world.post('goals/copy-confirm', plain(S6A_SCOPE, {
      commandId: 'n-source-copy-confirm', sourceGoalRef: source.goal.ref,
      expectedSourceRevision: source.revision, selectedInterventions: [message.ref],
    })), 'the copy Goal');
    const archived = await world.archive(line);
    const read = await disconnectQueueOf(world);

    const key = itemKeyOf(operationKeyOf(line.ref, archived.record.archivedAt!), message.ref, 'recipient');
    expect(read.notices).toHaveLength(1);
    expect(read.notices[0]).toMatchObject({
      itemKey: key, category: 'disconnect',
      objects: [{ kind: 'aggregate', pin: { ref: copy.goal.ref, revision: copy.goal.revision }, label: 'copy Goal' }],
    });
  });
});

type HostDeps = Parameters<(typeof import('../../src/app/host-notices.js'))['announceDisconnect']>[1];
const publishedDisconnect = (world: S6AHostWorld): HostDeps['disconnect'] | undefined =>
  (world.platform as unknown as { disconnect?: HostDeps['disconnect'] }).disconnect;

describe('N-notify (SQLite only; deferred to 7B-3 L)', () => {
  it('one deterministic notify per side, the archived side still reads its mail, and a crash replays', async () => {
    // The lifecycle queue exists only with the request driver on; its Session-commit wake runs the disconnect pass.
    const { world } = await openS7BWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } });
    worlds.push(world);
    world.clock.set(S6A_AT);
    if (publishedDisconnect(world) === undefined) throw new Error('S7B3-DEFERRED: the Host disconnect hook is not wired (7B-3 L)');

    const wait = await runS7BWait(world, { label: 'n-notify' });
    const archived = await world.archive(wait.recipient);
    const before = { recipient: (await world.scripted.requests(wait.recipient)).length,
      sender: (await world.scripted.requests(wait.sender)).length };

    // The archive's Session commit wakes LIFECYCLE_QUEUE; the Host's own drain makes the two sends.
    const recipientNotices = await waitFor(
      async () => (await inboxOf(world, wait.recipient.ref)).filter(message => message.intent === 'notify'),
      items => items.length === 1, 'the recipient disconnect notify');
    const senderNotices = await waitFor(
      async () => (await inboxOf(world, wait.sender.ref)).filter(message => message.intent === 'notify'),
      items => items.length === 1, 'the sender disconnect notify');
    const archivedMail = recipientNotices[0]!;
    const senderMail = senderNotices[0]!;

    const operationKey = operationKeyOf(wait.recipient.ref, archived.record.archivedAt!);
    const messageKey = canonicalJson(wait.message);
    const requestIds = [
      `disconnect:${operationKey}:${messageKey}:recipient`,
      `disconnect:${operationKey}:${messageKey}:waiting`,
    ];
    // The record has no send metadata, so the deterministic requestId is checked through the messageId its one
    // sender (the Host) derives from it.
    expect([archivedMail.ref.messageId, senderMail.ref.messageId]).toEqual(requestIds.map((requestId, index) => {
      const notice = index === 0 ? archivedMail : senderMail;
      return 'session-message-' + sha256Hex(canonicalJson({ projectId: S6A_SCOPE.projectId,
        workspaceId: S6A_SCOPE.workspaceId, sender: notice.sender, requestId }));
    }));
    const expectedText = `断开通知 · Session ${wait.recipient.ref.sessionId} · ${archived.record.archivedAt} · 没人接，等你定`;
    expect(ready<{ text: string }>(await world.post('messages/body',
      plain(S6A_SCOPE, { messageRef: archivedMail.ref, part: 'message' })), 'the archived side\'s mail body').text)
      .toBe(expectedText);
    expect(ready<{ text: string }>(await world.post('messages/body',
      plain(S6A_SCOPE, { messageRef: senderMail.ref, part: 'message' })), 'the sender\'s mail body').text)
      .toBe(expectedText);

    const saved = ready<SessionMessage>(await world.post('messages/read',
      plain(S6A_SCOPE, archivedMail.ref)), 'the archived side\'s saved mail');
    expect(saved.ref).toEqual(archivedMail.ref);
    expect((await world.scripted.requests(wait.recipient)).length).toBe(before.recipient);
    expect((await world.scripted.requests(wait.sender)).length).toBe(before.sender);

    // Crash, restart, then a fresh Session commit runs the pass again: the original two sends replay, no third.
    await world.crash();
    await world.reopen();
    const secondPass = await runS7BWait(world, { label: 'n-notify-second-pass' });
    await world.archive(secondPass.recipient);
    await waitFor(async () => (await inboxOf(world, secondPass.recipient.ref))
      .filter(message => message.intent === 'notify'), items => items.length === 1, 'the second pass notify');
    expect((await inboxOf(world, wait.recipient.ref)).filter(message => message.intent === 'notify')
      .map(message => message.ref)).toEqual([archivedMail.ref]);
    expect((await inboxOf(world, wait.sender.ref)).filter(message => message.intent === 'notify')
      .map(message => message.ref)).toEqual([senderMail.ref]);
  });
});

describe('N-interrupt (SQLite): the person interruption notifies each party of the open wait once', () => {
  it('a person action_request notifies the waiting sender, the wait recipient, the adviser and the goal secretary', async () => {
    const world = await openConsumeHostWorld({ backend: 'sqlite',
      extraBindings: [S7A_REPLY_TOOLS, { ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }],
      extraHostOptions: { inputConsumers: [{ scope: S6A_SCOPE,
        sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: 's7b3-n-interrupt-period' },
        goalRef: { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: 's7b3-n-interrupt-period' },
        queryProfileId: S6A_SECRETARY_PROFILE_ID, heartbeatMs: 25 }] } });
    worlds.push(world);
    world.clock.set(S6A_AT);
    await governS6B(world, s6aCardsWorkspace(world, S6A_SCOPE), world.goals);

    const wait = await runS7BWait(world, { label: 'n-interrupt' });
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const adviser = await createS6BLine(main, { label: 's7b3-n-interrupt-adviser',
      role: platformRoleProfile('adviser').template, tasks: [wait.tasks[0]!] });
    const adviserRef = await sessionOf(world, adviser);
    // The interruption's four-party set, kept for the reopen read below (L-02).
    let parties: SessionRef[] = [];
    let notices: SessionMessage[] = [];

    await holdS6BRequestRound(world, { label: 'n-interrupt-secretary', goalId: wait.goal.goalId }, async round => {
      const turnsBefore = { recipient: (await world.scripted.requests(wait.recipient)).length,
        sender: (await world.scripted.requests(wait.sender)).length,
        adviser: (await world.scripted.requests(adviserRef)).length,
        secretary: (await world.scripted.requests(round.secretary)).length };
      const person = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
        recipient: wait.sender.ref, text: 'S7B3 interrupt the waiting line', intent: 'action_request',
        goalRef: wait.goal, taskRef: wait.tasks[0],
      }, 'n-interrupt-person')), 'the person action_request');
      const settled = world.consumeBarrier();
      world.clock.advance(25);
      await settled;

      parties = [wait.sender.ref, wait.recipient.ref, adviserRef.ref, round.secretary.ref];
      notices = [];
      for (const ref of parties) {
        const inbox = await waitFor(async () => (await inboxOf(world, ref))
          .filter(message => message.intent === 'notify'), items => items.length === 1,
          `the interruption notice of ${ref.sessionId}`);
        notices.push(inbox[0]!);
      }
      // L-09: the four interruption notices carry the Host's system actor, not the configured operator (book-7b §3.11 item 4).
      expect(notices.map(notice => notice.sender)).toEqual(parties.map(() => ({
        kind: 'host', actor: { ...HOST_RECONCILE_ACTOR },
      })));
      const personKey = canonicalJson(person.ref);
      const partyKey = (ref: SessionRef) => canonicalJson({ projectId: ref.projectId, sessionId: ref.sessionId });
      const expectedIds = parties.map(ref => `interrupt:${personKey}:${partyKey(ref)}`);
      expect(notices.map(notice => notice.ref.messageId)).toEqual(expectedIds.map((requestId, index) =>
        'session-message-' + sha256Hex(canonicalJson({ projectId: S6A_SCOPE.projectId,
          workspaceId: S6A_SCOPE.workspaceId, sender: notices[index]!.sender, requestId }))));
      expect((await world.scripted.requests(wait.recipient)).length).toBe(turnsBefore.recipient);
      expect((await world.scripted.requests(adviserRef)).length).toBe(turnsBefore.adviser);
      expect((await world.scripted.requests(round.secretary)).length).toBe(turnsBefore.secretary);
      // The claimed intervention's drive (`host.ts:1824-1830`) opens the sender's one turn, not the notice.
      expect((await world.scripted.requests(wait.sender)).length).toBe(turnsBefore.sender + 1);

      // N-02: the reply leaves the line with no open wait, so the person's message sends no notify.
      await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient, message: wait.message,
        task: wait.tasks[1]!, label: 'n-interrupt-answered' });
      // The Host adds no condition (SR10 `:5755`); a second claimed intervention on a verifying Task is refused busy (intervention.ts:120).
      const deps = { messages: world.platform.messages,
        facts: world.platform.sessionFacts, nodeDetail: world.platform.nodeDetail };
      expect(await announceInterruption(world.systemContext(), deps, { scope: S6A_SCOPE,
        sessionRef: wait.sender.ref, personMessageRef: person.ref })).toHaveLength(0);
      for (const [index, ref] of parties.entries()) {
        expect((await inboxOf(world, ref)).filter(message => message.intent === 'notify').map(message => message.ref))
          .toEqual([notices[index]!.ref]);
      }
    });

    // L-02 (P-12 `7b3-probe-seams-v22.md:552`–`:561`): the reopened SQLite Host shows the same four notices and
    // writes no second copy.
    await world.reopen();
    const reopenedProfileIds = (await world.readProfiles()).map(profile => profile.id).join(',');
    for (const [index, ref] of parties.entries()) {
      expect((await inboxOf(world, ref)).filter(message => message.intent === 'notify')
        .map(message => message.ref), `the profiles after reopen: ${reopenedProfileIds}`)
        .toEqual([notices[index]!.ref]);
    }

    if (publishedDisconnect(world) === undefined) {
      throw new Error('S7B3-DEFERRED: the Host disconnect hook is not wired (7B-3 L)');
    }
  });
});
