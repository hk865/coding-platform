/**
 * L1's picking rows on FX-01 (the shared S7C world).
 *
 * S-01 (`book-7c.md:1371`): a named Task advance returns the pick basis, sends ONE adviser
 * `action_request`, and a repeated pass performs no step while the Task waits on the book's
 * `Session` + `CoreOperation` basis; the Goal-scope pass folds that basis into its summary and
 * continues. The adviser line is the world's real `s7c-adviser` line; the message is read through
 * `messages/read`, never a store.
 *
 * L1-member-replay (item 5): the same world without the adviser reaches M's `host_pick_member`
 * step; the person's real `decisions/answer` rejects the card, and the next pass reads the
 * committed operation instead of performing it again.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { advance } from '../scenarios/support/common.js';
import { createAG2bSession, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type {
  WorkflowAdvanceInput, WorkflowStepReceipt,
} from '../../src/business/workflow/contracts.js';

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

const select = (target: S7C1World, flowId: string, taskId: string | null): WorkflowAdvanceInput => ({
  schemaVersion: 1, goalRef: target.goal, flowId, sessionHint: null, kind: 'select_work',
  ...(taskId === null ? {} : { taskId }),
});

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

async function waitingMemberCard(target: S7C1World): Promise<DecisionCardV1> {
  const cards = await target.main.readCards(target.goal);
  const waiting = cards.filter(card => card.source.kind === 'member_creation' && card.state === 'waiting_answer');
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

async function rejectCard(target: S7C1World, card: DecisionCardV1, requestId: string): Promise<void> {
  const answer = await target.world.post('decisions/answer', graphWrite(S6A_SCOPE, {
    source: card.source, selection: { kind: 'option', optionId: 'reject' },
    text: 'S7C host-pick rejection', annotations: [],
  }, requestId, card.source.pins));
  const body = answer.body as { status: string; value?: { answer?: { status: string } } };
  if (body.status !== 'ready' || body.value?.answer?.status !== 'committed') {
    throw new Error(`the rejection was not answered: ${JSON.stringify({ status: answer.httpStatus, body })}`);
  }
}

async function memberCardThroughAdvance(target: S7C1World, flowId: string): Promise<DecisionCardV1> {
  const input = select(target, flowId, target.tasks[1]!.taskId);
  await driveWorkflow(target.world.ag2b, input);
  return await waitingMemberCard(target);
}

describe('S-01: the pick basis and the adviser suggestion', () => {
  it('returns the basis, sends one action_request and repeats with no step', async () => {
    world = await openS7C1World();
    const adviser = world.lines.adviser;
    if (adviser === null) throw new Error('S-01: the world has no adviser line');
    const beforeMessages = await actionRequests(world);
    const input = select(world, 's7c-l1-s01', world.tasks[1]!.taskId);
    const receipts: WorkflowStepReceipt[] = [];
    const steps = await driveWorkflow(world.world.ag2b, input, { receipts });

    expect(steps[0]?.pick).toEqual({ rank: 'none', incomplete: [], candidates: 0 });
    expect(steps[0]?.next).toMatchObject({ kind: 'perform', taskId: 's7c-m2',
      operation: { kind: 'suggest_member' } });
    const sent = receipts.find(receipt => receipt.kind === 'suggest_member');
    if (sent === undefined || sent.result.status !== 'committed') {
      throw new Error(`the adviser suggestion did not commit: ${JSON.stringify(receipts)}`);
    }
    const messageRef = sent.result.value.ref;
    const read = await world.world.post('messages/read', plain(S6A_SCOPE, messageRef));
    expect(read.body).toMatchObject({ status: 'ready', value: {
      ref: messageRef, intent: 'action_request', status: 'pending',
      recipient: { projectId: adviser.ref.projectId, sessionId: adviser.ref.sessionId },
      goalRef: world.goal,
    } });
    expect(await actionRequests(world)).toBe(beforeMessages + 1);

    const repeated = await advance(world.world.ag2b, input);
    expect(repeated).toMatchObject({ state: 'waiting', next: null, receipt: null,
      reason: 'suggestion_committed: the repeated pass performs no step', pick: null,
      waitBasis: { projectId: world.goal.projectId, goalId: world.goal.goalId,
        reasons: ['suggestion_committed'], recordKinds: ['Session', 'CoreOperation'] } });
    expect(await actionRequests(world)).toBe(beforeMessages + 1);
  });

  it('the responsible module link is the second key on a module Task', async () => {
    world = await openS7C1World();
    const target = world;
    // n1's own create binding (`s7c-create-binding`) carries this executor Role.
    const executor = { kind: 'legacy_template' as const, templateId: 's7c-executor', templateRevision: '1' };
    // A second idle line of the same Role makes key 2 (module) the deciding key.
    await createAG2bSession(target.world.ag2b, 's7c-l1-module-plain', executor);
    const moduleLine = await createAG2bSession(target.world.ag2b, 's7c-l1-module-pick', executor,
      [{ target: { kind: 'module',
        ref: { projectId: target.goal.projectId, moduleId: 's6a-ui' } }, relation: 'responsible' }]);
    const picked = await advance(target.world.ag2b, select(target, 's7c-l1-module-pick', target.tasks[2]!.taskId));
    expect(picked).toMatchObject({ state: 'advance', pick: { rank: 'responsible_module' },
      next: { kind: 'perform', operation: { kind: 'claim_task', request: { input: {
        sessionRef: moduleLine.sessionRef,
      } } } } });
  });

  it('merges the committed suggestion basis in the Goal-scope pass and continues', async () => {
    world = await openS7C1World({ firstRun: 'deferred' });
    const input = select(world, 's7c-l1-s01-named', world.tasks[1]!.taskId);
    await driveWorkflow(world.world.ag2b, input);
    // The Goal-scope pass must skip the running m1; hold it before the merged pass.
    await world.holdFirst();
    const goal = await advance(world.world.ag2b, select(world, 's7c-l1-s01-goal', null));
    expect(goal.next).toMatchObject({ kind: 'perform', operation: { kind: 'suggest_member', request: {
      input: { text: 'Task s7c-n1 has no suitable member; create one executor line for this task.' },
      meta: { requestId: expect.stringMatching(/^pick-suggest:s7c-n1:/) },
    } } });
  });
});

describe('L1-member-replay: the committed member operation is never performed again', () => {
  it('rejects through decisions/answer and a repeated named pass performs no step', async () => {
    world = await openS7C1World({ adviser: false });
    const card = await memberCardThroughAdvance(world, 's7c-l1-replay');
    expect(card.options.map(option => option.id)).toEqual(['approve', 'reject']);
    await rejectCard(world, card, 's7c-l1-replay-reject');

    const repeated = await advance(world.world.ag2b, select(world, 's7c-l1-replay', world.tasks[1]!.taskId));
    expect(repeated).toMatchObject({ state: 'waiting', next: null, receipt: null,
      reason: 'member_creation: no step', pick: null,
      waitBasis: { reasons: ['member_creation_pending'], recordKinds: [
        'Session', 'CoreOperation', 'SessionMessage', 'TaskRequeue', 'PlanRevision', 'Goal',
      ] } });
    expect((await world.main.readCards(world.goal))
      .filter(candidate => candidate.source.kind === 'member_creation' && candidate.state === 'waiting_answer'))
      .toEqual([]);
  });

  it('a Goal-scope pass reads A\'s committed operation and selects B', async () => {
    world = await openS7C1World({ adviser: false, firstRun: 'deferred' });
    const card = await memberCardThroughAdvance(world, 's7c-l1-replay-goal');
    await rejectCard(world, card, 's7c-l1-replay-goal-reject');
    // The Goal-scope pass must skip the running m1; hold it after A's operation committed.
    await world.holdFirst();

    const goal = await advance(world.world.ag2b, select(world, 's7c-l1-replay-goal-pass', null));
    expect(goal.next).toMatchObject({ kind: 'perform', operation: { kind: 'host_pick_member', request: {
      commandId: expect.stringMatching(/^pick-suggest:s7c-n1:/),
      scope: { kind: 'task', task: { taskId: 's7c-n1' } },
    } } });
  });
});

