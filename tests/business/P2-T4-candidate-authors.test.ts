/**
 * P2 T4 (frozen `p2-frozen.md:319`; §2.3, §2.5a, M7): an agent ordinary message wakes the secretary in the
 * planning shape; a candidate that changes an existing Task must leave one A13 candidate card and must not
 * auto-adopt. The ordinary-message, card-answer, only-new and incomplete-read halves are written here.
 * The card-answer half really sends the agent's `ask_person` card and answers it as the person; the answer
 * wakes the card's sender line for one candidate-only round (no claim and no adoption). The secretary
 * request-round small change is not this file's entry.
 * First failure of each new row is the P2 assertion or the named entry, never a relaxed setup.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { OPERATOR, P2_COORDINATION_TOOL_NAMES, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { g8PlanCall } from '../helpers/G8-world.js';
import { plPlanChangeDraft, plToolPlanOf } from '../helpers/PL-workflow-fixture.js';
import { p1Worlds } from '../helpers/P1-reads.js';
import type { P1World } from '../helpers/P1-round-fixture.js';
import { candidateCards, heartbeatUntil, heartbeatUntilModel, sessionExecutions, settleHost }
  from '../helpers/IV-host-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { startGoalDriver } from '../helpers/DRV-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, requestHeads, satisfyPLTask,
} from '../helpers/PL-workflow-fixture.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds = p1Worlds();
afterEach(async () => { commitBarrier.reset(); await worlds.closeAll(); });
const LONG = 600_000;

/**
 * The agent sender: E's real Work Run on tA sends S one ordinary message, then ends as `failWork` runs it. (tB's Run in
 * the `running` world is held across the world's own settle, past its 60 s runtime budget, so it ends
 * `budget_exhausted` at its first model reply and never calls a tool.)
 */
async function agentWakesSecretary(p1: P1World, label: string, text: string): Promise<void> {
  await p1.world.scripted.script(p1.lines.E, [{ kind: 'calls', calls: [{ callId: `${label}-send`,
    name: 'send_session_message', args: { recipient: p1.lines.S.ref, text, needsReply: false } }] }]);
  await p1.failWork(p1.lines.E, p1.task.tA, label);
}

/** The A13 card waits for the person; `candidateCards` also lists closed history (the world's adopted plan's card). */
async function waitingCandidateCards(world: P1World['world'], goal: P1World['goal']) {
  return (await candidateCards(world, goal)).filter(card => card.state === 'waiting_answer');
}

describe('T4 candidate authors', () => {
  it('an agent ordinary message wakes the secretary; a candidate that changes an old Task leaves one A13 card', async () => {
    const p1 = await worlds.open();
    const main = s6aCardsWorkspace(p1.world, S6A_SCOPE);
    const plan = await main.activePlan(p1.goal);
    expect(plan).not.toBeNull();
    const draft = plPlanChangeDraft(plan!, p1.goal, {
      planId: 'p4-plan', tasks: plan!.tasks.map(task => task.taskId === 'p1-ta'
        ? { ...task, title: 'P2 T4 changed old task' } : task),
      assignments: plan!.assignments ?? [], obligations: plan!.obligations ?? [],
    });
    await p1.world.scripted.script(p1.lines.S, [g8PlanCall('p4-plan', plToolPlanOf(draft)),
      { kind: 'text', text: 'P2 T4 secretary done' }]);
    await agentWakesSecretary(p1, 'p4', 'P2 T4 ordinary wake');
    await settleHost(p1.world);
    await waitFor(async () => (await main.activePlan(p1.goal))?.planRevision ?? 0, revision => revision >= 1, 'p4 plan');
    // The A13 card is the Goal loop's own read, not the candidate write: give it one real pass.
    await startGoalDriver(p1.world, p1.goal, 'p4-drive');
    await heartbeatUntil(p1.world, () => waitingCandidateCards(p1.world, p1.goal), cards => cards.length > 0, 24);
    const queue = await p1.world.post('decisions/queue', plain(S6A_SCOPE, {
      workspace: S6A_SCOPE, goalRef: p1.goal, sections: ['waiting_answer'], page: { limit: 100 },
    }));
    expect(queue.body).toMatchObject({ status: 'ready' });
    const body = queue.body as { value: { waitingAnswer: Array<{ candidateStatus: string | null }> } };
    expect(body.value.waitingAnswer.filter(card => card.candidateStatus === 'candidate')).toHaveLength(1);
  }, LONG);

  it('T4 card answer: an answered `ask_person` card wakes the card sender line; the candidate is only written', async () => {
    const p1 = await worlds.open();
    const main = s6aCardsWorkspace(p1.world, S6A_SCOPE);
    const gate = await p1.world.gates.modelRequest(p1.lines.S);
    await agentWakesSecretary(p1, 'p4-ask', 'P2 T4 ask the secretary');
    const held = await heartbeatUntilModel(p1.world, gate);
    try {
      // The frozen entry: the secretary's planning round really sends the person a card.
      await p1.world.scripted.script(p1.lines.S, [
        { kind: 'calls', calls: [{ callId: 'p4-ask-card', name: 'ask_person', args: {
          text: 'P2 T4 which change should this take?',
          options: [
            { id: 'p4-option-read', label: 'read only', effect: 'apply' },
            { id: 'p4-option-change', label: 'change the old task', effect: 'defer' },
          ],
          objects: [],
        } }] },
        { kind: 'text', text: 'P2 T4 asked the person' },
      ]);
    } finally {
      gate.release();
      await held.settled;
    }
    const waiting = await heartbeatUntil(p1.world, () => main.readCards(p1.goal),
      cards => cards.some(card => card.senderSessionRef?.sessionId === p1.lines.S.ref.sessionId
        && card.state === 'waiting_answer'), 24);
    const card = waiting.find(candidate => candidate.senderSessionRef?.sessionId === p1.lines.S.ref.sessionId
      && candidate.state === 'waiting_answer');
    if (card === undefined) throw new Error('T4: the ask_person card is not waiting');
    expect(card.senderSessionRef, 'the card sender line').toMatchObject(p1.lines.S.ref);
    // Let the asking round finish before arming the gate for the card-answer round.
    await settleHost(p1.world);

    // The person answers; the card's sender line must open the next round and read the answer.
    const nextGate = await p1.world.gates.modelRequest(p1.lines.S);
    const asked = (await listed(p1.world, 'outbox', p1.lines.S)).find(message => message.decision !== undefined);
    if (asked === undefined) throw new Error('T4: the ask_person card message is not in the secretary outbox');
    ready((await p1.world.post('decisions/answer', graphWrite(S6A_SCOPE, {
      source: card.source, selection: { kind: 'other' }, text: 'P2 T4 the person answered the card', annotations: [],
    }, 'p4-card-answer', [{ ref: asked.ref, revision: asked.revision }, ...card.source.pins]))).body, 'the card answer');
    const nextHeld = await heartbeatUntilModel(p1.world, nextGate);
    const nextRequest = await nextGate.reached;
    expect(nextRequest.messages.some(message => message.role === 'user'
      && message.content.includes('P2 T4 the person answered the card')),
    'the card answer reaches the sender line round').toBe(true);

    const plan = await main.activePlan(p1.goal);
    expect(plan).not.toBeNull();
    const draft = plPlanChangeDraft(plan!, p1.goal, {
      planId: 'p4-card-plan', tasks: plan!.tasks.map(task => task.taskId === 'p1-ta'
        ? { ...task, title: 'P2 T4 card-answer changed old task' } : task),
      assignments: plan!.assignments ?? [], obligations: plan!.obligations ?? [],
    });
    await p1.world.scripted.script(p1.lines.S, [g8PlanCall('p4-card-plan', plToolPlanOf(draft)),
      { kind: 'text', text: 'P2 T4 card-answer candidate done' }]);
    nextGate.release();
    await nextHeld.settled;
    await settleHost(p1.world);
    await startGoalDriver(p1.world, p1.goal, 'p4-card-drive');
    const cards = await heartbeatUntil(p1.world, () => waitingCandidateCards(p1.world, p1.goal),
      entries => entries.length === 1, 24);
    expect(cards, 'the card answer writes only one A13 candidate').toHaveLength(1);
    expect((await main.activePlan(p1.goal))?.planRevision, 'the candidate is not adopted')
      .toBe(plan!.planRevision);
    expect(await sessionExecutions(p1.world, p1.lines.S), 'the candidate claims nothing').toHaveLength(0);
  }, LONG);

  it('T4 only-new tasks: a secretary candidate that adds a task is reviewed and adopted by the goal loop', async () => {
    // The P1 world has no reviewer binding or consumer, so its review round is never served: this half runs in the PL
    // workflow world (the reviewer line's own consumer), with the same agent sender, secretary and only-new candidate.
    const workflow = await openPLWorkflowWorld({ label: 'p4-only-new', tools: P2_COORDINATION_TOOL_NAMES,
      extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
    try {
      const { world, main, goal } = workflow;
      const skeleton = await adoptPLTwoStageSkeleton(main, goal, { label: 'p4-only-new', stageOneTaskIds: ['pl-a', 'pl-b'] });
      await setS7AAutonomy(world, goal, 'after_plan_confirmation');
      const reviewer = await createPLReviewerLine(world, main, 'p4-only-new-reviewer');
      await world.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: 'p4-only-new-review',
        name: 'submit_plan_review', args: { verdict: 'pass', findings: [] } }] }]);
      const secretary = await world.createSecretary('p4-only-new');
      const sender = await sessionOf(world, await createS6BLine(main, { label: 'p4-only-new-sender', role: S6A_WORK_ROLE,
        tasks: skeleton.tasks.filter(task => task.taskId === 'pl-a') }));
      const plan = skeleton.plan;
      const added = { ...plan.tasks.find(task => task.taskId === 'pl-a')!, taskId: 'p4-only-new-task',
        title: 'P2 T4 only-new task', phase: 'pending' as const };
      const draft = plPlanChangeDraft(plan, goal, {
        planId: 'p4-only-new-plan', tasks: [...plan.tasks, added],
        assignments: [...(plan.assignments ?? []),
          { taskId: added.taskId, role: S6A_WORK_ROLE.templateId, instruction: 'P2 T4 only-new task instruction' }],
        obligations: plan.obligations.map(obligation => obligation.taskIds.includes('pl-a')
          ? { ...obligation, taskIds: [...obligation.taskIds, added.taskId] } : obligation),
      });
      await world.scripted.script(secretary, [g8PlanCall('p4-only-new', plToolPlanOf(draft)),
        { kind: 'text', text: 'P2 T4 secretary only-new done' }]);
      // The agent sender: the Work Run on pl-a sends the secretary one ordinary message, then the Run ends satisfied.
      await world.scripted.script(sender, [{ kind: 'calls', calls: [{ callId: 'p4-only-new-send',
        name: 'send_session_message', args: { recipient: secretary.ref, text: 'P2 T4 only-new ordinary wake',
          needsReply: false } }] }]);
      await satisfyPLTask(world, goal, 'pl-a', sender, 'p4-only-new');
      await settleHost(world);
      await startGoalDriver(world, goal, 'p4-only-new-drive');
      const adopted = await heartbeatUntil(world, async () => (await main.activePlan(goal))?.planRevision ?? 0,
        revision => revision > plan.planRevision, 48);
      expect(adopted, 'the only-new candidate is adopted by the goal loop').toBe(plan.planRevision + 1);
      expect((await main.activePlan(goal))?.tasks.some(task => task.taskId === added.taskId)).toBe(true);
      expect((await requestHeads(workflow, reviewer)).filter(head => head.startsWith('planreview:')),
        'the goal loop reviewed it').toHaveLength(1);
      expect(await waitingCandidateCards(world, goal), 'an only-new candidate leaves no A13 card').toHaveLength(0);
    } finally {
      await workflow.close();
    }
  }, LONG);

  it('T4 incomplete source read: a candidate whose author cannot be read leaves one A13 card', async () => {
    const workflow = await openPLWorkflowWorld({ label: 'p4-incomplete', tools: P2_COORDINATION_TOOL_NAMES });
    try {
      const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal,
        { label: 'p4-incomplete', stageOneTaskIds: ['pl-a', 'pl-b'] });
      const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'p4-incomplete-reviewer');
      await workflow.world.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: 'p4-incomplete-review',
        name: 'submit_plan_review', args: { verdict: 'pass', findings: [] } }] }]);
      const draft = plPlanChangeDraft(skeleton.plan, workflow.goal, {
        planId: 'p4-incomplete-plan',
        tasks: skeleton.plan.tasks.map(task => task.taskId === 'pl-a'
          ? { ...task, title: 'P2 T4 incomplete-read change' } : task),
        assignments: skeleton.plan.assignments ?? [], obligations: skeleton.plan.obligations ?? [],
      });
      // A public Host proposal with `basedOn` but no source message/request/submittedBy:
      // `candidateSourceLineOf` can only answer `via:'unknown'`, so A13 must card it.
      await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft,
        reason: { text: 'P2 T4 incomplete source read', sources: [], affectedTaskIds: ['pl-a'] },
      }, 'p4-incomplete-propose'));
      await startGoalDriver(workflow.world, workflow.goal, 'p4-incomplete-drive');
      const cards = await heartbeatUntil(workflow.world, () => waitingCandidateCards(workflow.world, workflow.goal),
        entries => entries.length > 0, 8);
      const heads = (await requestHeads(workflow, reviewer)).filter(head => head.startsWith('planreview:'));
      expect(cards, 'the incomplete-read candidate waits on one card').toHaveLength(1);
      expect(heads, 'A13 must not send a review round for a candidate it cannot attribute').toHaveLength(0);
    } finally {
      await workflow.close();
    }
  }, LONG);
});
