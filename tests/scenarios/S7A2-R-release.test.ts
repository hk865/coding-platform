/**
 * R-release (`book-7a.md:722`; M-03, R2-B-15). Deferred form (〔L6〕): every public step and business assertion is
 * written here now; only L's release owner and Workflow injection are missing, so the row passes in R's copy by the
 * fixture's named error and L replaces its last statement with `await exercise();`.
 */
import { afterEach, expect, it } from 'vitest';
import type {
  DecisionQueueReadV1, MessageReleaseCandidatesPageV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  moveS7APlan, openS7AQueryWorld, pauseS7AGoal, ready, resumeS7AGoal, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import {
  approveS7A2Message, callS7A2PublishedOwner, driveS7A2Release, readS7A2DispatchBasis, sendS7A2Request,
} from '../helpers/S7A2-fixture.js';
import { advanceUntil, type AdvanceValue } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';

const NAMED = 'S7A2: the messageRelease.readReleaseCandidates command is not published yet (7a2-l)';
const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

it('M-03: awaiting, the card and no count; approve while paused, the plan moves, resume → stale, re-send', async () => {
  const exercise = async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const world = opened.world;
    const { goal } = await seedS7AGoalPlan(world, { pointer: 'release' });
    // `every_step` is the autonomy at which an agent's `action_request` is `awaiting` (book `book-7a.md:321–:322`;
    // `state/decision-policy.ts:51–:53`): at `after_plan_confirmation` the send releases it directly, and this row
    // would have no awaiting message to approve.
    await setS7AAutonomy(world, goal, 'every_step');
    const recipient = opened.session.ref;
    // 1. the real secretary send: the message awaits the person, the counter is 0.
    const sent = await sendS7A2Request(world, { label: 'release-send', goal, recipient, intent: 'action_request' });
    expect(sent.release).toBe('awaiting');
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(0);
    // 2. the card (M-03's "card", rd7a2a-12): the person's queue is READ here, while the message is still awaiting —
    //    G-card keeps the identity assertions; this row reads the queue's own item and builds no key. 〔a-07, R3-1〕
    //    The two card ASSERTIONS sit below, after the row's first statement that needs L: the `message_release` card
    //    source is registered by L (G's source, L's wiring), so in R's copy the queue carries no such card.
    const queue = ready<DecisionQueueReadV1>(await world.post('decisions/queue', plain(S6A_SCOPE, {
      workspace: S6A_SCOPE, goalRef: goal, sections: ['waiting_answer'], page: { limit: 10 },
    })), 'the decision queue');
    const cards = queue.waitingAnswer.filter(card => card.source.kind === 'message_release');
    // 3. the person approves; nothing is counted yet (the release counts, not the approval).
    const approved = await approveS7A2Message(world, sent, 'release-approve');
    expect(approved.release).toBe('approved');
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(0);
    // 4. the first statement that needs L: the approved message is a candidate before the advance, gone after it.
    expect(ready<MessageReleaseCandidatesPageV1>(await callS7A2PublishedOwner(world, {
      owner: 'messageRelease.readReleaseCandidates', wave: '7a2-l', scope: S6A_SCOPE,
    }, { scope: S6A_SCOPE, goalRef: goal, after: null, limit: 100 }), 'the candidate page before the release')
      .items.map(item => item.messageRef)).toEqual([approved.ref]);
    // 〔a-07, R3-1〕 M-03's card: exactly one open `message_release` card in the queue read at step 2.
    expect(cards).toHaveLength(1);
    expect(cards[0]?.state).toBe('waiting_answer');
    // 〔a-08〕 ONE perform, POSTed twice: the second POST is the same command (its identity is the message ref plus
    // `approvalRevision`, `book-7a.md:368–:370`), so it answers the original receipt. A second
    // `driveS7A2Release` would search again from `select_work`, and after the release the message is no longer in
    // the approved index (`message-release.ts:208–:214`), so no perform would come back.
    const perform = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
      flowId: 's7a2-release-run', sessionHint: null, kind: 'select_work' as const }, 'release_message');
    const ran = ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, perform)),
      'the release step');
    expect(ran.state).toBe('advance');
    expect(ready<MessageReleaseCandidatesPageV1>(await callS7A2PublishedOwner(world, {
      owner: 'messageRelease.readReleaseCandidates', wave: '7a2-l', scope: S6A_SCOPE,
    }, { scope: S6A_SCOPE, goalRef: goal, after: null, limit: 100 }), 'the candidate page after the release')
      .items).toEqual([]);
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
    const replayed = ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, perform)),
      'the replayed release step');
    expect(replayed.state).toBe('advance');
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
    // 5. approve while the Goal is paused; the plan moves; the resume arms the queue (`book-7a.md:382`) and the item is
    //    stale: it stays `approved` and only a re-send releases.
    const paused = await sendS7A2Request(world, { label: 'release-paused', goal, recipient, intent: 'action_request' });
    await pauseS7AGoal(world, goal);
    expect((await approveS7A2Message(world, paused, 'release-paused')).release).toBe('approved');
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
    await moveS7APlan(world, goal);
    await resumeS7AGoal(world, goal);
    expect(ready<MessageReleaseCandidatesPageV1>(await callS7A2PublishedOwner(world, {
      owner: 'messageRelease.readReleaseCandidates', wave: '7a2-l', scope: S6A_SCOPE,
    }, { scope: S6A_SCOPE, goalRef: goal, after: null, limit: 100 }), 'the stale candidate page')
      .items.map(item => item.blockedReason)).toEqual(['stale_pins']);
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
    const resent = await sendS7A2Request(world, { label: 'release-resend', goal, recipient, intent: 'action_request' });
    await approveS7A2Message(world, resent, 'release-resend');
    await driveS7A2Release(world, { goal, messageRef: resent.ref, label: 'release-resend' });
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(2);
  };
  await exercise();
});

it('R2-B-15: the secretary sender with the three values moved before the approval', async () => {
  const exercise = async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const world = opened.world;
    const { goal } = await seedS7AGoalPlan(world, { pointer: 'release-moved' });
    await setS7AAutonomy(world, goal, 'every_step');
    const sent = await sendS7A2Request(world, { label: 'release-moved', goal, recipient: opened.session.ref,
      intent: 'action_request' });
    await moveS7APlan(world, goal);
    // the approval has no version check and still succeeds, without a count (`book-7a.md:355–:356`); the item then
    // reads stale and is not released.
    expect((await approveS7A2Message(world, sent, 'release-moved')).release).toBe('approved');
    expect(ready<MessageReleaseCandidatesPageV1>(await callS7A2PublishedOwner(world, {
      owner: 'messageRelease.readReleaseCandidates', wave: '7a2-l', scope: S6A_SCOPE,
    }, { scope: S6A_SCOPE, goalRef: goal, after: null, limit: 100 }), 'the moved candidate page')
      .items.map(item => item.blockedReason)).toEqual(['stale_pins']);
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(0);
    // the sender's re-send is approved at the current values and released with one count.
    const resent = await sendS7A2Request(world, { label: 'release-moved-resend', goal,
      recipient: opened.session.ref, intent: 'action_request' });
    await approveS7A2Message(world, resent, 'release-moved-resend');
    await driveS7A2Release(world, { goal, messageRef: resent.ref, label: 'release-moved' });
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
  };
  await exercise();
});
