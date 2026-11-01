/**
 * L1-host-pick (`book-7c.md:379–381` correction; ruling 10-31): the no-adviser suggestion is
 * M's `host_pick` member request, never a send and never a Session. The person's card is shown at
 * both autonomy levels, its approve creates the executor line and the Task runs, its reject
 * replays by the same plan revision without a second card, a new plan revision is a new card,
 * and the Goal-scope pass still selects the next Task after A's operation committed.
 *
 * Every arm opens FX-01 with `adviser: false` (the ruling's "only the automatic mode, in the
 * no-adviser world") and uses real routes: `workflow/advance`, `decisions/card`,
 * `decisions/answer`, `messages/inbox`, `sessions/read`, `sessions/find`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { answer, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { advance } from '../scenarios/support/common.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { openS7C1World, type S7C1FirstRun, type S7C1World } from '../helpers/S7C-member-fixture.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type {
  ResolveDecisionReadV1, WorkflowAdvanceInput, WorkflowStepReceipt,
} from '../../src/business/workflow/contracts.js';

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

const select = (target: S7C1World, flowId: string, taskId: string | null): WorkflowAdvanceInput => ({
  schemaVersion: 1, goalRef: target.goal, flowId, sessionHint: null, kind: 'select_work',
  ...(taskId === null ? {} : { taskId }),
});

async function memberCards(target: S7C1World): Promise<DecisionCardV1[]> {
  return (await target.main.readCards(target.goal))
    .filter(card => card.source.kind === 'member_creation');
}

async function waitingMemberCard(target: S7C1World): Promise<DecisionCardV1> {
  const waiting = (await memberCards(target)).filter(card => card.state === 'waiting_answer');
  if (waiting.length !== 1) {
    throw new Error(`expected exactly one waiting member_creation card, got ${String(waiting.length)}`);
  }
  const read = await target.main.route('decisions/card', { source: waiting[0]!.source });
  const body = read as { status: string; value?: DecisionCardV1 };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`decisions/card did not return the member card: ${JSON.stringify(body)}`);
  }
  return body.value;
}

async function hostPickCard(target: S7C1World, flowId: string): Promise<DecisionCardV1> {
  const input = select(target, flowId, target.tasks[1]!.taskId);
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(target.world.ag2b, input, { receipts });
  const call = receipts.find(receipt => receipt.kind === 'host_pick_member');
  if (call === undefined || call.result.status !== 'needs_decision') {
    throw new Error(`the host_pick_member step did not ask for a decision: ${JSON.stringify(receipts)}`);
  }
  // The committed card returns to the selection: the pending-card task waits on
  // the member block's own source and basis, never on the bare step reason.
  expect(steps[steps.length - 1]).toMatchObject({
    state: 'waiting', next: null,
    source: { kind: 'member_creation', key: call.result.cardKey },
    waitBasis: { reasons: ['member_creation'] },
  });
  return await waitingMemberCard(target);
}

async function answerCardOption(target: S7C1World, card: DecisionCardV1, optionId: 'approve' | 'reject',
  requestId: string): Promise<ResolveDecisionReadV1> {
  const body = await answer(target.world.ag2b, 'decisions/answer', graphWrite(S6A_SCOPE, {
    source: card.source, selection: { kind: 'option', optionId },
    text: `S7C host-pick ${optionId}`, annotations: [],
  }, requestId, card.source.pins)) as { status: string; value?: ResolveDecisionReadV1 };
  if (body.status !== 'ready' || body.value?.answer?.status !== 'committed') {
    throw new Error(`the ${optionId} answer did not commit: ${JSON.stringify(body)}`);
  }
  return body.value;
}

async function actionRequests(target: S7C1World): Promise<number> {
  const sessions = await target.world.listSessions();
  let count = 0;
  for (const session of sessions) {
    const read = await target.world.post('messages/inbox', plain(S6A_SCOPE, {
      recipient: { projectId: session.record.ref.projectId, sessionId: session.record.ref.sessionId },
      page: { limit: 100 },
    }));
    const body = read.body as { status: string; value?: { items: readonly { intent?: string }[] } };
    if (body.status !== 'ready' || body.value === undefined) {
      throw new Error(`the inbox of ${session.record.ref.sessionId} is not readable: ${JSON.stringify(body)}`);
    }
    count += body.value.items.filter(message => message.intent === 'action_request').length;
  }
  return count;
}

async function newPlanRevision(target: S7C1World): Promise<void> {
  const candidate = await target.main.proposeCandidate({ label: 'host-pick-revision', goal: target.goal, request: null });
  const applied = await target.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: candidate.proposal.ref, expectedProposalRevision: candidate.proposal.revision, decisionRefs: [],
  }, 's7c-l1-host-pick-plan-apply'));
  if ((applied as { status?: string }).status !== 'committed') {
    throw new Error(`the new Plan revision did not apply: ${JSON.stringify(applied)}`);
  }
}

type Arm = { name: string; firstRun?: S7C1FirstRun; run: (target: S7C1World) => Promise<void> };

const arms: readonly Arm[] = [
  {
    name: 'no adviser: one member_creation card, no Session and no message',
    async run(target) {
      const beforeSessions = (await target.world.listSessions()).length;
      const beforeMessages = await actionRequests(target);
      const card = await hostPickCard(target, 's7c-l1-host-pick-no-adviser');
      expect(card.state).toBe('waiting_answer');
      expect(card.options.map(option => option.id)).toEqual(['approve', 'reject']);
      expect(await memberCards(target)).toHaveLength(1);
      expect((await target.world.listSessions()).length).toBe(beforeSessions);
      expect(await actionRequests(target)).toBe(beforeMessages);
    },
  },
  {
    name: '方案确认后自动: the host pick still shows a card',
    async run(target) {
      await setS7AAutonomy(target.world, target.goal, 'after_plan_confirmation');
      expect(await hostPickCard(target, 's7c-l1-host-pick-auto')).toMatchObject({
        state: 'waiting_answer', options: [{ id: 'approve' }, { id: 'reject' }],
      });
    },
  },
  {
    name: 'approve: the member exists and the Task runs',
    async run(target) {
      const before = new Set((await target.world.listSessions())
        .map(session => session.record.ref.sessionId));
      const card = await hostPickCard(target, 's7c-l1-host-pick-approve');
      const resolved = await answerCardOption(target, card, 'approve', 's7c-l1-host-pick-approve-answer');
      // The host-pick answer cites the card answer, so its member_created proof records the application.
      expect(resolved.state).toBe('applied');
      expect(resolved.application).toMatchObject({ status: 'committed' });

      const added = (await target.world.listSessions())
        .filter(session => !before.has(session.record.ref.sessionId));
      expect(added).toHaveLength(1);
      const member = await target.world.readSession({ projectId: added[0]!.record.ref.projectId,
        sessionId: added[0]!.record.ref.sessionId });
      // The executor Role is the Task's served binding, never the platform executor template.
      expect(member.record.role).toEqual({ kind: 'legacy_template', templateId: 's7c-executor', templateRevision: '1' });
      expect(member.links.some(link => link.until === null && link.ref.relation === 'responsible'
        && JSON.stringify(link.ref.target) === JSON.stringify({ kind: 'task', ref: target.tasks[1] })))
        .toBe(true);

      const receipts: WorkflowStepReceipt[] = [];
      await driveWorkflow(target.world.ag2b, select(target, 's7c-l1-host-pick-run',
        target.tasks[1]!.taskId), { stopBefore: 'open_checks', receipts });
      const claim = receipts.find(receipt => receipt.kind === 'claim_task');
      if (claim === undefined || claim.result.status !== 'committed') {
        throw new Error(`the approved member's Task was not claimed: ${JSON.stringify(receipts)}`);
      }
      const runRef = claim.result.value.runRef;
      const execution = await target.world.post('executions/read', plain(S6A_SCOPE, runRef));
      expect(execution.body).toMatchObject({ status: 'ready', value: {
        run: { ref: runRef, envelope: { taskId: target.tasks[1]!.taskId } },
      } });
    },
  },
  {
    name: 'reject: no second card under the same plan revision',
    async run(target) {
      const card = await hostPickCard(target, 's7c-l1-host-pick-reject');
      await answerCardOption(target, card, 'reject', 's7c-l1-host-pick-reject-answer');
      expect((await memberCards(target)).filter(candidate => candidate.state === 'waiting_answer')).toEqual([]);

      const repeated = await advance(target.world.ag2b, select(target, 's7c-l1-host-pick-reject',
        target.tasks[1]!.taskId));
      expect(repeated).toMatchObject({ state: 'waiting', next: null, receipt: null,
        reason: 'member_creation: no step' });
      expect((await memberCards(target)).filter(candidate => candidate.state === 'waiting_answer')).toEqual([]);
    },
  },
  {
    name: 'a new plan revision: a new card',
    async run(target) {
      const first = await hostPickCard(target, 's7c-l1-host-pick-new-plan');
      await answerCardOption(target, first, 'reject', 's7c-l1-host-pick-new-plan-reject');
      await newPlanRevision(target);
      const second = await hostPickCard(target, 's7c-l1-host-pick-new-plan');
      expect(second.state).toBe('waiting_answer');
      expect(second.cardKey).not.toBe(first.cardKey);
      expect((await memberCards(target)).filter(candidate => candidate.state === 'waiting_answer'))
        .toHaveLength(1);
    },
  },
  {
    name: 'reject A: the Goal-scope pass still selects B',
    firstRun: 'deferred',
    async run(target) {
      const card = await hostPickCard(target, 's7c-l1-host-pick-a');
      await answerCardOption(target, card, 'reject', 's7c-l1-host-pick-a-reject');
      // The Goal-scope pass must skip the running m1; hold it after A's operation committed.
      await target.holdFirst();
      const goal = await advance(target.world.ag2b, select(target, 's7c-l1-host-pick-b', null));
      expect(goal.next).toMatchObject({ kind: 'perform', operation: { kind: 'host_pick_member', request: {
        commandId: expect.stringMatching(/^pick-suggest:s7c-n1:/),
        scope: { kind: 'task', task: { taskId: 's7c-n1' } },
      } } });
    },
  },
];

describe('L1-host-pick: the no-adviser suggestion in the automatic world', () => {
  it.each(arms)('$name', async ({ firstRun, run }) => {
    world = await openS7C1World({ adviser: false, ...(firstRun === undefined ? {} : { firstRun }) });
    await run(world);
  });
});
