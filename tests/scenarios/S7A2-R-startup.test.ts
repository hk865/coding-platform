/**
 * R-startup (`book-7a.md:724`; M-04). Deferred form (〔L6〕): the real queue, the real restart and the real arms are
 * written now; the row's first statement that needs L is the candidate read after the restart, so R's copy stops on
 * the fixture's named error and L replaces the last statement with `await exercise();`.
 */
import { afterEach, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { MessageReleaseCandidatesPageV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  openS7AQueryWorld, pauseS7AGoal, ready, resumeS7AGoal, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import { approveS7A2Message, callS7A2PublishedOwner, readS7A2DispatchBasis, sendS7A2Request } from '../helpers/S7A2-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { waitFor } from './harness.js';

const NAMED = 'S7A2: the messageRelease.readReleaseCandidates command is not published yet (7a2-l)';
const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

it('M-04: an approved backlog after a start with recovery off is released only when armed, once', async () => {
  const exercise = async () => {
    const opened = await openS7AQueryWorld({ backend: 'sqlite' });
    worlds.push(opened.world);
    const world = opened.world;
    const { goal } = await seedS7AGoalPlan(world, { pointer: 'startup' });
    // `every_step` is the autonomy at which the secretary's `action_request` and `inquiry` are `awaiting`
    // (book `book-7a.md:321–:322`; `state/decision-policy.ts:51–:53`): at `after_plan_confirmation` both sends
    // release themselves.
    await setS7AAutonomy(world, goal, 'every_step');
    const recipient = opened.session.ref;
    /** `messages/read` of one message, the public release state the waits below poll. */
    const releaseOf = async (ref: SessionMessage['ref']) => ready<SessionMessage>(
      await world.post('messages/read', plain(S6A_SCOPE, ref)), 'the release state').release;
    // 1. the backlog: one `action_request` and one `inquiry`, both awaiting; the counter is 0.
    const approvedBacklog = await sendS7A2Request(world, { label: 'startup-approved', goal, recipient,
      intent: 'action_request' });
    const awaiting = await sendS7A2Request(world, { label: 'startup-awaiting', goal, recipient, intent: 'inquiry' });
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(0);
    // 2. the approval while the Goal is paused (no pass can release it: `busy`, `message-release.ts:68`) and the
    //    autonomy changed while paused (`book-7a.md:724`, `:397` item 5): nothing is released, nothing counted.
    await pauseS7AGoal(world, goal);
    expect((await approveS7A2Message(world, approvedBacklog, 'startup-approved')).release).toBe('approved');
    await setS7AAutonomy(world, goal, 'after_plan_confirmation');
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(0);
    // 3. the same-store restart with the driver on and recovery off (〔R3-5〕): the queues stay unarmed, so not one
    //    message is released and nothing is recounted.
    await world.setResumeOnStartup(false);
    // 〔R3-10 局部〕the driver is turned on at the restart: the held-round sends above need it off
    await world.crash({ extraHostOptions: { requestDriver: 'on' } });
    expect(await releaseOf(approvedBacklog.ref)).toBe('approved');
    // 4. the first statement that needs L (〔L6〕): after that restart the approved message is STILL a candidate.
    expect(ready<MessageReleaseCandidatesPageV1>(await callS7A2PublishedOwner(world, {
      owner: 'messageRelease.readReleaseCandidates', wave: '7a2-l', scope: S6A_SCOPE,
    }, { scope: S6A_SCOPE, goalRef: goal, after: null, limit: 100 }), 'the candidate page after the restart')
      .items.map(item => item.messageRef)).toEqual([approvedBacklog.ref]);
    // 5. the resume arms the queue (`book-7a.md:382`, `:397` item 5) and releases the approved backlog. The wait is
    //    the bounded public poll `tests/RULES.md:175` allows (〔a-14〕; `waitFor`, `tests/scenarios/harness.ts:731`):
    //    the pass runs detached after the committing call returns (`A/wake-loop.ts:16–:18`).
    await resumeS7AGoal(world, goal);
    expect(await waitFor(() => releaseOf(approvedBacklog.ref), release => release === 'released',
      'the release of the approved backlog')).toBe('released');
    // only the approved message is out — the awaiting inquiry is no candidate (`book-7a.md:724`) — and the one
    // `action_request` release counts once (`:365`).
    expect(await releaseOf(awaiting.ref)).toBe('awaiting');
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
    // 6. a real approval after that start arms the queue again and releases only that message. 〔a-09〕 An `inquiry`
    //    release adds no counter (`book-7a.md:365`): the counter stays 1, not 2.
    const approval = await world.post('messages/release', graphWrite(S6A_SCOPE,
      { messageRef: awaiting.ref, allow: true }, 's7a2-release-startup-waiting'));
    expect(approval.body).toMatchObject({ status: 'committed', value: { release: 'approved' } });
    expect(await waitFor(() => releaseOf(awaiting.ref), release => release === 'released',
      'the release of the newly approved message')).toBe('released');
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
    // 7. a replayed approval arms again and there is nothing left to release: the public page is empty and the
    //    counter stays 1 (`book-7a.md:397` item 5, "released never re-counts") — the replay counts once too.
    await approveS7A2Message(world, awaiting, 'startup-waiting');
    expect(ready<MessageReleaseCandidatesPageV1>(await callS7A2PublishedOwner(world, {
      owner: 'messageRelease.readReleaseCandidates', wave: '7a2-l', scope: S6A_SCOPE,
    }, { scope: S6A_SCOPE, goalRef: goal, after: null, limit: 100 }), 'the candidate page at the end').items)
      .toEqual([]);
    expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
  };
  await exercise();
});
