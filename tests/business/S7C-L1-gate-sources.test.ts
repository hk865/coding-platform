/**
 * L1-gate-sources (`book-7c.md:1374`; §3.3 item 7; DR-15): a pending `member_creation` or `rework_request`
 * card blocks only its Task and dependents. The member card is M's real `requestMember` decision; the rework
 * card is R's real `request_rework` owner reached by a Work Run of the L46 rework-capable line. A named-Task
 * advance returns the pending source itself (`source.kind`) and the block's action in its wait basis; the
 * rework arm never observes a Task start, because the automatic confirmation still blocks A (DR-15).
 *
 * The same file carries L1-option-required: a text-only `decisions/answer` (`selection.kind === 'other'`) is
 * `invalid`, writes nothing and leaves the real card `waiting_answer` for both kinds provable on this tree.
 * `handoff_approval` and `adviser_creation` stay in `OPTION_REQUIRED_SOURCE_KINDS`; their producers are L2's
 * and H's, so their named mutation is not fabricated here (DR-13).
 *
 * Every state comes through the real Host routes, the real owners and FX-01 / FX-02's open-time tool line (the L46
 * arm uses the same grant and real start path); only `requestMember` and the public reads are called, never a store
 * and never a hand-made record, card or context.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as hostModule from '../../src/app/host.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { advance } from '../scenarios/support/common.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { openS7BL46World, requestL46Rework } from '../helpers/S7B-L46-fixture.js';
import { openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

let s7c: S7C1World | undefined;
let l46: S6AHostWorld | undefined;
afterEach(async () => {
  await s7c?.close(); s7c = undefined;
  await l46?.close(); l46 = undefined;
  restoreHostFactory();
});

/** The real Host factory of this file; FX-01's open-time wrapper can be left installed by the S6A start spy. */
const restoreHostFactory = (): void => {
  if (hostModule.createLocalWorkbenchHost !== REAL_HOST_FACTORY) {
    Object.defineProperty(hostModule, 'createLocalWorkbenchHost',
      { value: REAL_HOST_FACTORY, configurable: true, writable: true });
  }
};
beforeEach(restoreHostFactory);

const REAL_HOST_FACTORY = hostModule.createLocalWorkbenchHost;
const select = (goalRef: GoalRef, flowId: string, taskId: string | null): WorkflowAdvanceInput => ({
  schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work',
  ...(taskId === null ? {} : { taskId }),
});

async function gateQueueOf(world: S6AHostWorld, goalRef: GoalRef): Promise<DecisionQueueReadV1> {
  return ready<DecisionQueueReadV1>(await world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef, sections: ['waiting_answer', 'answered_pending_application'],
    page: { limit: 100 },
  })), 'the decision queue');
}

async function cardOfKind(world: S6AHostWorld, goalRef: GoalRef, kind: string): Promise<DecisionCardV1> {
  const card = (await gateQueueOf(world, goalRef)).waitingAnswer.find(entry => entry.source.kind === kind);
  if (card === undefined) throw new Error(`the ${kind} card is not waiting in the queue`);
  return card;
}

describe('L1-gate-sources: one pending card blocks its Task and dependents only', () => {
  it('a pending rework_request card on L46 returns its own source while the Task stays blocked', async () => {
    const opened = await openS7BL46World({ backend: 'memory' });
    l46 = opened.world;
    await requestL46Rework(opened.world, { goalRef: opened.goalRef,
      tasks: { A: opened.tasks.A, B: opened.tasks.B }, afterRun: opened.run, label: 's7c-l1-gate-rework',
      reason: 'L1-gate-sources: request the rework of A', callId: 's7c-l1-gate-rework-rework-call' });
    const card = await cardOfKind(opened.world, opened.goalRef, 'rework_request');

    // DR-15: the returned source, never a Task start; A's automatic confirmation still blocks the start.
    const blocked = await advance(opened.world.ag2b, select(opened.goalRef, 's7c-l1-gate-rework-a', opened.tasks.A.taskId));
    expect(blocked).toMatchObject({
      state: 'waiting', next: null, reason: 'rework_request_pending',
      source: { kind: 'rework_request', key: card.source.key },
    });
    expect(blocked.waitBasis?.reasons).toEqual(['rework_request']);

    // C is a formal dependent of A and waits through the same block root; only the root returns the source itself.
    const dependent = await advance(opened.world.ag2b, select(opened.goalRef, 's7c-l1-gate-rework-c', opened.tasks.C.taskId));
    expect(dependent).toMatchObject({ state: 'waiting',
      reason: 'l46_dependency_blocked: the Task s7b3-c waits on s7b3-a' });
  });
  it('a pending member_creation card blocks its Task, and an independent Task still advances', async () => {
    s7c = await openS7C1World();
    const requested = await s7c.member.request.requestMember(s7c.world.humanContext(), {
      commandId: 's7c-l1-gate-member', caller: { kind: 'host_pick' }, duty: 'executor',
      scope: { kind: 'task', task: s7c.tasks[1]! }, reason: 'L1-gate-sources: the member request waits',
    });
    if (requested.status !== 'needs_decision') {
      throw new Error(`L1-gate-sources: no member card: ${JSON.stringify(requested)}`);
    }
    const blocked = await advance(s7c.world.ag2b, select(s7c.goal, 's7c-l1-gate-member-task', s7c.tasks[1]!.taskId));
    expect(blocked).toMatchObject({
      state: 'waiting', next: null, reason: 'member_creation_pending',
      source: { kind: 'member_creation', key: requested.cardKey },
    });
    expect(blocked.waitBasis?.reasons).toEqual(['member_creation']);

    const other = await advance(s7c.world.ag2b, select(s7c.goal, 's7c-l1-gate-member-other', s7c.tasks[2]!.taskId));
    expect(other.state).toBe('advance');
    expect(other.next).not.toBeNull();
  });

});

describe('L1-option-required: a text-only answer is invalid', () => {
  // The other two names (`handoff_approval`, `adviser_creation`) stay in the set; their real producers are the H
  // and L2 groups, so their mutation is H/L2's, not fabricated here (DR-13).
  it.each(['rework_request', 'member_creation'] as const)(
    '%s: the text-only answer is invalid, writes nothing and leaves the card waiting', async kind => {
      let world: S6AHostWorld;
      let goalRef: GoalRef;
      let card: DecisionCardV1;
      if (kind === 'member_creation') {
        const owned = await openS7C1World();
        s7c = owned;
        world = owned.world; goalRef = owned.goal;
        const requested = await owned.member.request.requestMember(owned.world.humanContext(), {
          commandId: 's7c-l1-option-member', caller: { kind: 'host_pick' }, duty: 'executor',
          scope: { kind: 'task', task: owned.tasks[1]! }, reason: 'L1-option-required: the member card',
        });
        if (requested.status !== 'needs_decision') {
          throw new Error(`L1-option-required: no member card: ${JSON.stringify(requested)}`);
        }
        card = await cardOfKind(owned.world, owned.goal, 'member_creation');
      } else {
        const opened = await openS7BL46World({ backend: 'memory' });
        l46 = opened.world;
        world = opened.world; goalRef = opened.goalRef;
        await requestL46Rework(opened.world, { goalRef: opened.goalRef,
          tasks: { A: opened.tasks.A, B: opened.tasks.B }, afterRun: opened.run, label: 's7c-l1-option-rework',
          reason: 'L1-gate-sources: request the rework of A', callId: 's7c-l1-option-rework-rework-call' });
        card = await cardOfKind(opened.world, opened.goalRef, 'rework_request');
      }

      const answer = await world.post('decisions/answer', graphWrite(S6A_SCOPE,
        { source: card.source, selection: { kind: 'other' }, text: '', annotations: [] },
        `s7c-l1-option-${kind}`, card.source.pins));
      expect(answer.body).toMatchObject({ status: 'rejected', code: 'invalid' });

      const queue = await gateQueueOf(world, goalRef);
      expect(queue.waitingAnswer.find(entry => entry.source.key === card.source.key))
        .toMatchObject({ state: 'waiting_answer' });
      expect(queue.answeredPendingApplication.some(entry => entry.source.key === card.source.key)).toBe(false);
    });
});
