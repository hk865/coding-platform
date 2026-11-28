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
import { callPublishedOwnerAsHost, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_AT, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B, holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import {
  cancelS7AGoal, committed, nameS7AReplyHandler, ready, seedS7AGoalPlan, sessionOf, S7A_REPLY_TOOLS,
} from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { openS7BWorld, runS7BWait } from '../helpers/S7B-fixture.js';
import { openConsumeHostWorld } from '../helpers/S7B2-consumable-sessions.js';
import { heartbeatUntil } from '../helpers/IV-host-fixture.js';
import { PLATFORM_NOTICE_ACTOR } from '../../src/contracts/core/session-message.js';
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
      disconnect: {
        operationKey, occurredAt: archivedAt, messageRef: wait.message, side: 'recipient',
        party: wait.recipient.ref, counterparty: wait.sender.ref, successor: null,
        goalRef: wait.goal, copyGoal: null,
      },
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

  it('archiving both sides after the wait moved yields one item, the recipient side', async () => {
    const world = await openWorld('memory');
    const wait = await runS7BWait(world, { label: 'n-source-both' });
    // The helper archives the waiting line while transferring its open wait; the reply handler is now another line,
    // so the original waiting side is no longer a disconnect party (R-F3).
    const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the waiting message');
    const transferTo = await world.createWorkSession('s7b3-n-source-transfer');
    await nameS7AReplyHandler(world, message, transferTo.ref);
    const archivedRecipient = await world.archive(wait.recipient);
    const read = await disconnectQueueOf(world);

    const recipientKey = itemKeyOf(operationKeyOf(wait.recipient.ref, archivedRecipient.record.archivedAt!),
      wait.message, 'recipient');
    expect(read.notices).toHaveLength(1);
    expect(read.notices.map(item => item.itemKey)).toEqual([recipientKey]);
    expect(read.notices[0]).toMatchObject({ disconnect: { side: 'recipient', party: wait.recipient.ref } });
    expect(read.notices.every(item => item.subject.kind === 'goal')).toBe(true);
  });

  it('an undelivered message to an archived line yields a recipient item for that message', async () => {
    const world = await openWorld('memory');
    const wait = await runS7BWait(world, { label: 'n-source-undelivered' });
    const archived = await world.archive(wait.recipient);
    const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: wait.recipient.ref, text: 'S7B3 undelivered after the archive',
      needsReply: false, wake: false, goalRef: wait.goal,
    }, 'n-source-undelivered-send')), 'the undelivered person message');
    const read = await disconnectQueueOf(world);

    const key = itemKeyOf(operationKeyOf(wait.recipient.ref, archived.record.archivedAt!), sent.ref, 'recipient');
    expect(read.notices.map(item => item.itemKey)).toContain(key);
    expect(read.notices.find(item => item.itemKey === key)).toMatchObject({
      category: 'disconnect', subject: { kind: 'goal', goalRef: wait.goal },
      summary: `断开通知 · Session ${wait.recipient.ref.sessionId} · ${archived.record.archivedAt} · 没人接，等你定`,
      disconnect: {
        operationKey: operationKeyOf(wait.recipient.ref, archived.record.archivedAt!),
        occurredAt: archived.record.archivedAt, messageRef: sent.ref, side: 'recipient',
        party: wait.recipient.ref, counterparty: null, successor: null,
        goalRef: wait.goal, copyGoal: null,
      },
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
      recipient: retired.ref, text: 'S7B3 message to the retired line', needsReply: false, wake: false,
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
      disconnect: {
        operationKey: operationKeyOf(retired.ref, unavailableSince!), occurredAt: S6A_AT,
        messageRef: sent.ref, side: 'recipient', party: retired.ref,
        counterparty: null, successor: null, goalRef: null, copyGoal: null,
      },
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
    // p2-frozen:115 / design:245: a cancelled Goal refuses the send, so the intervention is stored while the source
    // Goal is alive and the cancel follows; the cancelled Goal is then the copy source.
    const { goal: sourceGoal } = await seedS7AGoalPlan(world);
    const line = await sessionOf(world, await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE), {
      label: 'n-source-copy-line', role: S6A_WORK_ROLE,
    }));
    const message = await sendS7A2PersonMessage(world, {
      label: 'n-source-copy', recipient: line.ref, goal: sourceGoal,
    });
    await cancelS7AGoal(world, sourceGoal);
    const cancelled = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, sourceGoal)),
      'the cancelled source').goal;
    const copy = committed<GoalCopyConfirmResultV1>(await world.post('goals/copy-confirm', plain(S6A_SCOPE, {
      commandId: 'n-source-copy-confirm', sourceGoalRef: sourceGoal,
      expectedSourceRevision: cancelled.revision, selectedInterventions: [message.ref],
    })), 'the copy Goal');
    const archived = await world.archive(line);
    const read = await disconnectQueueOf(world);

    const key = itemKeyOf(operationKeyOf(line.ref, archived.record.archivedAt!), message.ref, 'recipient');
    expect(read.notices).toHaveLength(1);
    expect(read.notices[0]).toMatchObject({
      itemKey: key, category: 'disconnect',
      disconnect: {
        operationKey: operationKeyOf(line.ref, archived.record.archivedAt!),
        occurredAt: archived.record.archivedAt, messageRef: message.ref, side: 'recipient',
        party: line.ref, counterparty: null, successor: null,
        goalRef: sourceGoal, copyGoal: { ref: copy.goal.ref, revision: copy.goal.revision },
      },
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
      async () => (await inboxOf(world, wait.recipient.ref)).filter(message => message.sender.kind === 'host' && message.needsReply !== true),
      items => items.length === 1, 'the recipient disconnect notify');
    const senderNotices = await waitFor(
      async () => (await inboxOf(world, wait.sender.ref)).filter(message => message.sender.kind === 'host' && message.needsReply !== true),
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
      .filter(message => message.sender.kind === 'host' && message.needsReply !== true), items => items.length === 1, 'the second pass notify');
    expect((await inboxOf(world, wait.recipient.ref)).filter(message => message.sender.kind === 'host' && message.needsReply !== true)
      .map(message => message.ref)).toEqual([archivedMail.ref]);
    expect((await inboxOf(world, wait.sender.ref)).filter(message => message.sender.kind === 'host' && message.needsReply !== true)
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
    // P2 (p2-frozen:100, :142; design:204-209): the wait question wakes its idle recipient by default, so that line's
    // own text round runs and, with no scripted answer, ends `no_answer` with the platform's closing notice
    // (p2-frozen:165, :168). It settles before the person acts, so the turns below and the notices compared are the
    // interruption's alone.
    await heartbeatUntil(world, async () => await inboxOf(world, wait.recipient.ref),
      items => items.some(message => message.sender.kind === 'host' && message.sender.actor.id === PLATFORM_NOTICE_ACTOR.id));
    // The interruption's four-party set, kept for the reopen read below (L-02).
    let parties: SessionRef[] = [];
    let notices: SessionMessage[] = [];
    // Every message a party already holds before the person acts; the interruption's notices are the new ones.
    const earlier = new Set<string>();
    const interruptionNoticesOf = async (ref: SessionRef): Promise<SessionMessage[]> => (await inboxOf(world, ref))
      .filter(message => message.sender.kind === 'host' && message.needsReply !== true
        && !earlier.has(message.ref.messageId));

    await holdS6BRequestRound(world, { label: 'n-interrupt-secretary', goalId: wait.goal.goalId }, async round => {
      const turnsBefore = { recipient: (await world.scripted.requests(wait.recipient)).length,
        sender: (await world.scripted.requests(wait.sender)).length,
        adviser: (await world.scripted.requests(adviserRef)).length,
        secretary: (await world.scripted.requests(round.secretary)).length };
      for (const ref of [wait.sender.ref, wait.recipient.ref, adviserRef.ref, round.secretary.ref]) {
        for (const message of await inboxOf(world, ref)) earlier.add(message.ref.messageId);
      }
      const person = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
        recipient: wait.sender.ref, text: 'S7B3 interrupt the waiting line',
        entry: 'person_intervention', needsReply: true, goalRef: wait.goal, taskRef: wait.tasks[0],
      }, 'n-interrupt-person')), 'the person action_request');
      const settled = world.consumeBarrier();
      world.clock.advance(25);
      await settled;

      parties = [wait.sender.ref, wait.recipient.ref, adviserRef.ref, round.secretary.ref];
      notices = [];
      for (const ref of parties) {
        const inbox = await waitFor(async () => await interruptionNoticesOf(ref), items => items.length === 1,
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
      // 认领的干预先发这四条通知，再交给协作驱动（Host 的 consumeCandidate：先 announceInterruption，再
      // collaborationDriver.start）；驱动的 start 对一个任务只装上看守、启动它的循环就返回（startHandle），
      // 发信线这一轮的模型请求要等看守走完选任务、认领、开 Run 才发，比四条通知晚。先有界轮询到这一轮出现，
      // 再查另外三方没开轮、发信线恰好多一轮。
      await waitFor(async () => (await world.scripted.requests(wait.sender)).length,
        count => count > turnsBefore.sender, 'the claimed intervention\'s turn on the waiting sender');
      expect((await world.scripted.requests(wait.recipient)).length).toBe(turnsBefore.recipient);
      expect((await world.scripted.requests(adviserRef)).length).toBe(turnsBefore.adviser);
      expect((await world.scripted.requests(round.secretary)).length).toBe(turnsBefore.secretary);
      // The claimed intervention's drive (`host.ts:3125-3139`) opens the sender's one turn, not the notice.
      expect((await world.scripted.requests(wait.sender)).length).toBe(turnsBefore.sender + 1);

      // N-02: a wait that is no longer open leaves the line with no interruption party, so the person's message sends
      // no notify. P2: the recipient's wake round above ended `no_answer` and owns this message's reply slot, so no
      // other reply can land (p2-frozen:162, :168; design:262-263); the wait ends at its deadline (24 h default, MP-11).
      world.clock.advance(86_400_000);
      expect(await callPublishedOwnerAsHost(world, 'S7B', {
        owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
        scope: { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId },
      }, { messageRef: wait.message })).toMatchObject({ status: 'committed' });
      // The Host adds no condition (SR10 `:5755`); a second claimed intervention on a verifying Task is refused busy (intervention.ts:120).
      const deps = { messages: world.platform.messages,
        facts: world.platform.sessionFacts, nodeDetail: world.platform.nodeDetail };
      expect(await announceInterruption(world.systemContext(), deps, { scope: S6A_SCOPE,
        sessionRef: wait.sender.ref, personMessageRef: person.ref })).toHaveLength(0);
      for (const [index, ref] of parties.entries()) {
        expect((await interruptionNoticesOf(ref)).map(message => message.ref)).toEqual([notices[index]!.ref]);
      }
    });

    // L-02 (P-12 `7b3-probe-seams-v22.md:552`–`:561`): the reopened SQLite Host shows the same four notices and
    // writes no second copy.
    await world.reopen();
    const reopenedProfileIds = (await world.readProfiles()).map(profile => profile.id).join(',');
    for (const [index, ref] of parties.entries()) {
      expect((await interruptionNoticesOf(ref)).map(message => message.ref), `the profiles after reopen: ${reopenedProfileIds}`)
        .toEqual([notices[index]!.ref]);
    }

    if (publishedDisconnect(world) === undefined) {
      throw new Error('S7B3-DEFERRED: the Host disconnect hook is not wired (7B-3 L)');
    }
  });
});
