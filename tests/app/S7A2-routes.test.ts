/**
 * L-routes (7a:733; TE2; D8-26 (i)): the HTTP entry this slice adds and the chain the person drives through routes.
 * `messages/apply` over the real Host route table with a real committed effect's own receipt and `{kind, ref}`;
 * the replay repeats the request id; `messages/read` and `messages/inbox` show `appliedAt`. The second row is TE2:
 * a secretary send, the `message_release` card answered through `decisions/answer`, then the mailbox read.
 *
 * L-routes-1's `messages/release`/`messages/withdraw`/view rows and its no-route block live in
 * `tests/app/S7A-routes.test.ts:149–:157`; this file does not repeat that block (one rule, one place). Every
 * prior state comes from the frozen earlier-slice fixture steps; no store read and no hand-built fact. The effect is
 * P-apply's acknowledged proposal (`tests/work-graph/S7A2-P-apply.test.ts:225–:240`), which commits from public
 * steps without a real Run, so the row's first failure is the route table's answer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { EffectWriteResultV1 } from '../../src/contracts/core/session-message.js';
import type { SessionMessage, SessionMessagePage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import {
  answerS7A2Card, readS7A2Card, sendS7A2PersonMessage, sendS7A2Request,
} from '../helpers/S7A2-fixture.js';
import {
  committed, openS7AQueryWorld, ready, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe('L-routes: messages/apply over HTTP', () => {
  it('applies a real proposal effect, replays the same request id and reads the message back', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, main, world.goals);
    const goal = (await main.createGoal('s7a2-routes-apply-goal', 'S7A2 routes apply goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-routes-apply',
      taskIds: ['s7a2-routes-apply-1'], role: S6A_WORK_ROLE.templateId });
    const created = await createS6BLine(main, { label: 's7a2-routes-apply-line', role: S6A_WORK_ROLE, tasks });
    const current = await main.activePlan(goal);
    if (current === null) throw new Error('S7A2_PRECONDITION: the Goal has no adopted Plan');
    const message = await sendS7A2PersonMessage(world, { label: 'routes-apply', recipient: created.ref });
    const workIds = current.tasks.filter(task => task.taskKind === 'work').map(task => task.taskId);
    const draft = { ...ag2bPlanDraft(workIds), planId: 's7a2-routes-plan', goalId: goal.goalId,
      planRevision: current.planRevision + 1 };
    const proposedAt = world.clock.now();
    const shell = await world.post('plans/propose', graphWrite(S6A_SCOPE, { goalRef: goal,
      basedOn: current.ref, draft, reason: { text: 'S7A2 routes proposal', sources: [] },
      acknowledgement: message.ref }, 's7a2-routes-propose', []));
    const written = shell.body as EffectWriteResultV1<PlanProposal>;
    if (written.status !== 'committed') throw new Error(`the proposal is ${written.status}`);
    const receipt = written.proofReceipt!;
    const effect = { kind: 'proposal_created' as const, ref: written.value.ref };
    const body = graphWrite(S6A_SCOPE, { messageRef: message.ref, proof: { receipt, effect } }, 's7a2-routes-apply');

    const applied = committed<SessionMessage>(await world.post('messages/apply', body), 'the HTTP apply');
    expect(applied).toMatchObject({ ref: message.ref, revision: message.revision + 1,
      appliedAt: proposedAt, applicationProof: { receipt, effect } });
    const replay = committed<SessionMessage>(await world.post('messages/apply', body), 'the HTTP replay');
    expect(replay).toEqual(applied);

    const read = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message.ref)),
      'the applied message');
    expect(read.appliedAt).toBe(applied.appliedAt);
    const inbox = ready<SessionMessagePage>(await world.post('messages/inbox', plain(S6A_SCOPE,
      { recipient: created.ref, page: { limit: 20 } })), 'the recipient inbox');
    expect(inbox.items.find(item => item.ref.messageId === message.ref.messageId)?.appliedAt)
      .toBe(applied.appliedAt);
  });
});

describe('L-routes: TE2 send -> decision answer -> mailbox read', () => {
  it('lists the release card, answers it over the route and reads the approval back', async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    await setS7AAutonomy(opened.world, opened.goal, 'every_step');
    const sent = await sendS7A2Request(opened.world, { label: 'routes-te2', goal: opened.goal,
      recipient: opened.session.ref, intent: 'inquiry' });
    expect(sent.release).toBe('awaiting');
    const card = await readS7A2Card(opened.world, opened.goal);
    expect(card.card.source.kind).toBe('message_release');

    await answerS7A2Card(opened.world, { source: card.source, optionId: 'approve', label: 'routes-te2' });
    const read = ready<SessionMessage>(await opened.world.post('messages/read', plain(S6A_SCOPE, sent.ref)),
      'the answered message');
    expect(read.release).toBe('approved');
    expect(read.approvedAt).not.toBeNull();
    const inbox = ready<SessionMessagePage>(await opened.world.post('messages/inbox', plain(S6A_SCOPE,
      { recipient: opened.session.ref, page: { limit: 20 } })), 'the recipient inbox');
    expect(inbox.items.find(item => item.ref.messageId === sent.ref.messageId)).toMatchObject({
      release: 'approved', approvedAt: read.approvedAt });
  });
});
