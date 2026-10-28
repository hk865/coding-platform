/**
 * R-candidates, read part (7a:722; SR-R R.5): the release-candidate page's approval order, paging, cursors and the
 * owner's three rules. Deferred form: the owner is published by the later wiring, so every case ends on the fixture's exact
 * named error and the business assertions first run at L; the preparation steps are real and run now.
 */
import { afterEach, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  MessageReleaseCandidateV1, MessageReleaseCandidatesPageV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  committed, moveS7APlan, openS7AQueryWorld, pauseS7AGoal, ready, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import {
  approveS7A2Message, callS7A2PublishedOwner, readS7A2DispatchBasis, sendS7A2Request, withdrawS7A2Message,
} from '../helpers/S7A2-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';

const NAMED = 'S7A2: the messageRelease.readReleaseCandidates command is not published yet (7a2-l)';
const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

type Opened = Awaited<ReturnType<typeof openS7AQueryWorld>>;
type RuleCase = {
  rule: string;
  drive: (opened: Opened, goal: GoalRef) => Promise<MessageReleaseCandidateV1[]>;
};

// One world per case; each approval is one minute after the previous one, so the page order is the approval order.
it.each(['memory', 'sqlite'] as const)('order-and-paging: the workspace and Goal pages follow approval order (%s)',
  async backend => {
    const exercise = async () => {
      const opened = await openS7AQueryWorld({ backend });
      worlds.push(opened.world);
      const { goal: firstGoal } = await seedS7AGoalPlan(opened.world, { pointer: 'cand-one' });
      const { goal: secondGoal } = await seedS7AGoalPlan(opened.world, { pointer: 'cand-two' });
      await setS7AAutonomy(opened.world, firstGoal, 'every_step');
      // `setS7AAutonomy` hard-codes `s7a-autonomy-${autonomy}` (S7A-fixture.ts:275), so the same autonomy on the
      // second Goal replays that identity with a different body and conflicts. The same public route, at this row's
      // own request id, sets it.
      const secondRevision = ready<{ goal: { revision: number } }>(
        await opened.world.post('goals/read', plain(S6A_SCOPE, secondGoal)), `the revision of ${secondGoal.goalId}`);
      committed(await opened.world.post('goals/settings/set', graphWrite(S6A_SCOPE, {
        goalRef: secondGoal, autonomy: 'every_step', waitForGoalRef: null,
      }, 's7a2-cand-autonomy-two', [{ ref: secondGoal, revision: secondRevision.goal.revision }])),
      'the second Goal autonomy');
      const send = (label: string, goal: GoalRef) => sendS7A2Request(opened.world, {
        label, goal, recipient: opened.session.ref, intent: 'inquiry',
      });
      // Creation order is a1, b1, a2; the approvals are b1, a2, a1.
      const a1 = await send('cand-a1', firstGoal);
      const b1 = await send('cand-b1', secondGoal);
      const a2 = await send('cand-a2', firstGoal);
      const b1Approved = await approveS7A2Message(opened.world, b1, 'cand-b1');
      opened.world.clock.advance(60_000);
      const a2Approved = await approveS7A2Message(opened.world, a2, 'cand-a2');
      opened.world.clock.advance(60_000);
      const a1Approved = await approveS7A2Message(opened.world, a1, 'cand-a1');

      const first = ready<MessageReleaseCandidatesPageV1>(await callS7A2PublishedOwner(opened.world, {
        owner: 'messageRelease.readReleaseCandidates', wave: '7a2-l', scope: S6A_SCOPE,
      }, { scope: S6A_SCOPE, goalRef: null, after: null, limit: 2 }), 'the workspace page');
      expect(first.items).toEqual([
        { messageRef: b1Approved.ref, revision: b1Approved.revision, creationRevision: 1, pins: null, deadline: null,
          blockedReason: null },
        { messageRef: a2Approved.ref, revision: a2Approved.revision, creationRevision: 1, pins: null, deadline: null,
          blockedReason: null },
      ]);
      expect(typeof first.nextCursor).toBe('string');

      const second = ready<MessageReleaseCandidatesPageV1>(await callS7A2PublishedOwner(opened.world, {
        owner: 'messageRelease.readReleaseCandidates', wave: '7a2-l', scope: S6A_SCOPE,
      }, { scope: S6A_SCOPE, goalRef: null, after: first.nextCursor, limit: 2 }), 'the second page');
      expect(second.items).toEqual([
        { messageRef: a1Approved.ref, revision: a1Approved.revision, creationRevision: 1, pins: null, deadline: null,
          blockedReason: null },
      ]);
      expect(second.nextCursor).toBeNull();

      const narrowed = ready<MessageReleaseCandidatesPageV1>(await callS7A2PublishedOwner(opened.world, {
        owner: 'messageRelease.readReleaseCandidates', wave: '7a2-l', scope: S6A_SCOPE,
      }, { scope: S6A_SCOPE, goalRef: firstGoal, after: null, limit: 2 }), 'the Goal page');
      expect(narrowed.items).toEqual([
        { messageRef: a2Approved.ref, revision: a2Approved.revision, creationRevision: 1, pins: null, deadline: null,
          blockedReason: null },
        { messageRef: a1Approved.ref, revision: a1Approved.revision, creationRevision: 1, pins: null, deadline: null,
          blockedReason: null },
      ]);
    };
    await exercise();
  });

const ownerRules: readonly RuleCase[] = [
  {
    rule: 'a paused Goal blocks its approved items',
    drive: async (opened, goal) => {
      const message = await sendS7A2Request(opened.world, { label: 'cand-paused', goal,
        recipient: opened.session.ref, intent: 'inquiry' });
      const approved = await approveS7A2Message(opened.world, message, 'cand-paused');
      await pauseS7AGoal(opened.world, goal);
      return [{ messageRef: approved.ref, revision: approved.revision, creationRevision: 1, pins: null,
        deadline: null, blockedReason: 'goal_not_active' }];
    },
  },
  {
    rule: 'after a real plan move only the action_request is stale',
    drive: async (opened, goal) => {
      const pins = await readS7A2DispatchBasis(opened.world, goal);
      const request = await sendS7A2Request(opened.world, { label: 'cand-stale-request', goal,
        recipient: opened.session.ref, intent: 'action_request' });
      const inquiry = await sendS7A2Request(opened.world, { label: 'cand-stale-inquiry', goal,
        recipient: opened.session.ref, intent: 'inquiry' });
      const requestApproved = await approveS7A2Message(opened.world, request, 'cand-stale-request');
      opened.world.clock.advance(60_000);
      const inquiryApproved = await approveS7A2Message(opened.world, inquiry, 'cand-stale-inquiry');
      await moveS7APlan(opened.world, goal);
      return [
        { messageRef: requestApproved.ref, revision: requestApproved.revision, creationRevision: 1, pins,
          deadline: null, blockedReason: 'stale_pins' },
        { messageRef: inquiryApproved.ref, revision: inquiryApproved.revision, creationRevision: 1, pins: null,
          deadline: null, blockedReason: null },
      ];
    },
  },
  {
    rule: 'a withdrawn approved message is absent and the page continues',
    drive: async (opened, goal) => {
      const withdrawn = await sendS7A2Request(opened.world, { label: 'cand-withdrawn', goal,
        recipient: opened.session.ref, intent: 'inquiry' });
      const kept = await sendS7A2Request(opened.world, { label: 'cand-kept', goal,
        recipient: opened.session.ref, intent: 'inquiry' });
      await approveS7A2Message(opened.world, withdrawn, 'cand-withdrawn');
      const keptApproved = await approveS7A2Message(opened.world, kept, 'cand-kept');
      await withdrawS7A2Message(opened.world, withdrawn, 'cand-withdrawn');
      return [{ messageRef: keptApproved.ref, revision: keptApproved.revision, creationRevision: 1, pins: null,
        deadline: null, blockedReason: null }];
    },
  },
];

// Memory only (S3): the owner's rules, not the index's storage.
it.each(ownerRules)('owner-rules: $rule (memory)', async rule => {
  const exercise = async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const { goal } = await seedS7AGoalPlan(opened.world, { pointer: 'cand-rules' });
    await setS7AAutonomy(opened.world, goal, 'every_step');
    const expected = await rule.drive(opened, goal);
    const page = ready<MessageReleaseCandidatesPageV1>(await callS7A2PublishedOwner(opened.world, {
      owner: 'messageRelease.readReleaseCandidates', wave: '7a2-l', scope: S6A_SCOPE,
    }, { scope: S6A_SCOPE, goalRef: goal, after: null, limit: 2 }), 'the Goal page');
    expect(page.items).toEqual(expected);
  };
  await exercise();
});
