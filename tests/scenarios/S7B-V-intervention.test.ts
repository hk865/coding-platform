/** V-intervention (book-7b.md §5 `:1223`; SR5 §5.4, §5.2.4): no-task planning, the narrow source refusal, the
 * completed Goal's goal-less request and the cancelled Goal's pending UCR card. The UCR row uses the scenario Host
 * that produces a real pending review card. The one in-process call is the published handler. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { GoalDetail, GoalDisplayRead, PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { HandleInterventionResultV1 } from '../../src/business/workflow/ports.js';
import { interventionPlanningQueryRefs, type QueryJobRef } from '../../src/contracts/query-job.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { advanceUntil, driveWorkflow, readQuery } from '../helpers/A2-restart-fixture.js';
import type { DispatchBasisV1 } from '../../src/contracts/ledger.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { cancelS7AGoal, committed, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { approveS7A2Message, sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { openS7BWorld } from '../helpers/S7B-fixture.js';
import { openS7BPlanningWorld, type S7BPlanningWorld } from '../helpers/S7B3-planning-world.js';
import { completeS7BGoal, driveS7BIntervention, firstPlan, interveneS7B, refinementPlan, s7bVWorkProfile }
  from '../helpers/S7B-V-fixture.js';
import { planProposalIdFor } from '../../src/core/work-graph/tasks/plan-service.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import { readActivePlan } from './support/S5-decisions.js';
import { cleanupScenarios, HostScenario, hostCtx, waitFor } from './harness.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { queueOf, cardOf } from './support/review-card-round.js';
import { createNeedsDecisionRecord } from './support/review-work-root.js';
import { display } from './support/control.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_ROLE } from '../helpers/AG2b-collaboration-fixture.js';

const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  shellSeam.release();
  await cleanupScenarios();
  await cleanupRestart();
});
const card = (r: HandleInterventionResultV1) => r.status === 'awaiting_decision';
const proposal = (r: HandleInterventionResultV1) => r.status === 'progressed' && r.stage === 'proposal';
const claimed = (r: HandleInterventionResultV1) => r.status === 'claimed';
describe('V-intervention: no task + an active Goal', () => {
  it('runs the Query and proposes its draft, then adopts the refinement and claims a ready task', async () => {
    const planning = await openS7BPlanningWorld();
    worlds.push(planning.world);
    const { world, messageRef, sessionRef, goalRef } = planning;
    const profile = s7bVWorkProfile();
    const text = ready<{ text: string }>(await world.post('messages/body',
      plain(S6A_SCOPE, { messageRef, part: 'message' })), 'the body').text;
    await world.scripted.script(sessionRef, [{ kind: 'text', text:
      await refinementPlan(world, goalRef, { label: 'auto', taskId: 'aaa-s7b3-v-auto', role: S6A_WORK_ROLE.templateId }) }]);
    expect(await interveneS7B(world, messageRef, profile))
      .toEqual({ status: 'progressed', branch: 'no_task', stage: 'query' });
    const refs = interventionPlanningQueryRefs(messageRef);
    const query = await readQuery(world.ag2b, refs.queryJobRef);
    expect(query.job.job.intent).toMatchObject({ intentId: refs.queryJobRef.queryJobId, question: text,
      focusTaskRefs: [], multiTurn: { maxRounds: 1 }, correlationId: `intervention:${refs.queryRunRef.runId}`,
      execution: { kind: 'intervention_planning', sourceMessageRef: messageRef } });
    await driveS7BIntervention(world, messageRef, profile, proposal);
    const adopted = await driveS7BIntervention(world, messageRef, profile, claimed);
    expect(adopted).toMatchObject({ status: 'claimed', branch: 'no_task' });
    const taskId = (adopted as { claim: { task: { taskId: string } } }).claim.task.taskId;
    expect(taskId).toBe('aaa-s7b3-v-auto');
    const graph = ready<{ tasks: Array<{ ref: { taskId: string }; disposition: string }>; pendingProposal: unknown }>(
      await world.post('tasks/query', plain(S6A_SCOPE, { goalRef })), 'the graph');
    expect(graph.pendingProposal).toBeUndefined();
  });

  it.each([
    { name: 'cards a first plan at after_plan_confirmation', kind: 'first' as const,
      autonomy: 'after_plan_confirmation' as const },
    { name: 'cards a first plan at every_step', kind: 'first' as const, autonomy: 'every_step' as const },
    { name: 'cards an every_step refinement', kind: 'refinement' as const, autonomy: 'every_step' as const },
  ])('$name', async ({ kind, autonomy }) => {
    const planning = await openS7BPlanningWorld();
    worlds.push(planning.world);
    const { world, goalRef, noPlanGoalRef, noPlanSessionRef } = planning;
    const profile = s7bVWorkProfile();
    const [target, session, label] = kind === 'first'
      ? [noPlanGoalRef, noPlanSessionRef, `first-${autonomy}`] as const
      : [goalRef, planning.sessionRef, 'refine'] as const;
    await setS7AAutonomy(world, target, autonomy);
    const message = await sendS7A2PersonMessage(world, { label: `v-${label}`, recipient: session.ref, goal: target });
    await world.scripted.script(session, [{ kind: 'text', text: kind === 'first'
      ? firstPlan({ label, taskId: `s7b3-${label}`, role: S6A_WORK_ROLE.templateId })
      : await refinementPlan(world, target, { label, taskId: 's7b3-v-refine', role: S6A_WORK_ROLE.templateId }) }]);
    const result = await driveS7BIntervention(world, message.ref, profile, card);
    expect(ready(await world.platform.plans.readPlanProposal(world.humanContext(),
      (result as { proposalRef: PlanProposalRef }).proposalRef), 'the proposal'))
      .toMatchObject({ status: 'candidate', sourceMessageRef: message.ref });
  });
});
describe('V-intervention: the accepted proposal read', () => {
  it.each([
    { role: S6A_WORK_ROLE.templateId, claim: 's7b3-v-person' },
    { role: 'advisor', claim: null },
  ])('claims the person-adopted first plan\'s ready task for $role or queues when none', async ({ role, claim }) => {
    const planning = await openS7BPlanningWorld();
    worlds.push(planning.world);
    const { world, noPlanGoalRef, noPlanSessionRef } = planning;
    const profile = s7bVWorkProfile();
    await setS7AAutonomy(world, noPlanGoalRef, 'every_step');
    const message = await sendS7A2PersonMessage(world, { label: `v-accept-${role}`,
      recipient: noPlanSessionRef.ref, goal: noPlanGoalRef });
    await world.scripted.script(noPlanSessionRef, [{ kind: 'text',
      text: firstPlan({ label: 'accept', taskId: claim ?? 's7b3-v-none', role }) }]);
    const result = await driveS7BIntervention(world, message.ref, profile, card);
    const proposalRef = (result as { proposalRef: PlanProposalRef }).proposalRef;
    const before = ready<{ status: string; revision: number; sourceMessageRef: SessionMessage['ref'] | null }>(
      await world.platform.plans.readPlanProposal(world.humanContext(), proposalRef), 'the proposal');
    expect((await world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef,
      expectedProposalRevision: before.revision, decisionRefs: [] }, `s7b3-v-apply-${role}`, []))).body)
      .toMatchObject({ status: 'committed' });
    const first = await interveneS7B(world, message.ref, profile);
    if (claim === null) expect(first).toEqual({ status: 'queued', reason: 'no_task' });
    else expect(first).toMatchObject({ status: 'claimed', branch: 'no_task', claim: { task: { taskId: claim } } });
    expect(ready(await world.platform.plans.readPlanProposal(world.humanContext(), proposalRef), 'the proposal'))
      .toMatchObject({ status: 'accepted' });
    expect(ready<{ pendingProposal: unknown }>(await world.post('tasks/query',
      plain(S6A_SCOPE, { goalRef: noPlanGoalRef })), 'the graph').pendingProposal).toBeUndefined();
  });
});
describe('V-intervention: the narrow source guard', () => {
  it('refuses a proposal whose source is not the intervention Query\'s source', async () => {
    const planning = await openS7BPlanningWorld();
    worlds.push(planning.world);
    const { world, messageRef, goalRef, sessionRef } = planning;
    expect(await interveneS7B(world, messageRef, s7bVWorkProfile()))
      .toEqual({ status: 'progressed', branch: 'no_task', stage: 'query' });
    const refs = interventionPlanningQueryRefs(messageRef);
    expect((await world.post('messages/withdraw', graphWrite(S6A_SCOPE, { messageRef },
      's7b3-v-withdraw'))).body).toMatchObject({ status: 'committed' });
    expect(await interveneS7B(world, messageRef, s7bVWorkProfile()))
      .toMatchObject({ status: 'rejected', code: 'source_stale' });
    const other = await sendS7A2PersonMessage(world, { label: 'v-other-source',
      recipient: sessionRef.ref, goal: goalRef });
    const goalRead = ready<{ goal: { revision: number } }>(await world.post('goals/read',
      plain(S6A_SCOPE, goalRef)), 'the Goal');
    const draft = { ...JSON.parse(firstPlan({ label: 'mismatch', taskId: 's7b3-v-mismatch',
      role: S6A_WORK_ROLE.templateId })).plan, planId: 's7b3-v-mismatch', goalId: goalRef.goalId };
    const answer = await world.post('plans/propose', graphWrite(S6A_SCOPE, { goalRef, basedOn: null, draft,
      reason: { text: 'S7B3 V mismatch', sources: [] }, requestRef: refs.queryJobRef, sourceMessageRef: other.ref },
    's7b3-v-mismatch', [{ ref: goalRef, revision: goalRead.goal.revision }]));
    expect(answer.body).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'the proposal sourceMessageRef is not this intervention Query source message' });
    const second = await sendS7A2PersonMessage(world, { label: 'v-cross-goal', recipient: planning.noPlanSessionRef.ref, goal: planning.noPlanGoalRef }); expect(await interveneS7B(world, second.ref, s7bVWorkProfile())).toEqual({ status: 'progressed', branch: 'no_task', stage: 'query' });
    expect((await world.post('plans/propose', graphWrite(S6A_SCOPE, { goalRef,
      basedOn: (await readActivePlan(world.platform, world.humanContext(), goalRef)).ref,
      draft: JSON.parse(await refinementPlan(world, goalRef, { label: 'cross', taskId: 's7b3-v-cross', role: S6A_WORK_ROLE.templateId })).plan,
      reason: { text: 'S7B3 V cross-goal', sources: [] }, requestRef: interventionPlanningQueryRefs(second.ref).queryJobRef,
      sourceMessageRef: second.ref }, 's7b3-v-cross-goal', [{ ref: goalRef, revision: goalRead.goal.revision }]))).body)
      .toMatchObject({ status: 'rejected' });
    // V-01 (a): a non-null source with no request is refused at the shared proposal entry, before the Host/Agent split.
    const noRequest = await world.post('plans/propose', graphWrite(S6A_SCOPE, { goalRef, basedOn: null,
      draft: { ...JSON.parse(firstPlan({ label: 'no-request', taskId: 's7b3-v-no-request', role: S6A_WORK_ROLE.templateId })).plan, goalId: goalRef.goalId },
      reason: { text: 'S7B3 V source without request', sources: [] }, requestRef: null, sourceMessageRef: other.ref }, 's7b3-v-no-request'));
    expect.soft(noRequest.body).toMatchObject({ status: 'rejected', code: 'invalid' });
    // V-01 (b): a first plan without `origin` still proves its withdrawn source at initial adoption.
    const initialProposal = committed<{ ref: PlanProposalRef; revision: number }>(await world.post('plans/propose',
      graphWrite(S6A_SCOPE, { goalRef: planning.noPlanGoalRef, basedOn: null,
        draft: { ...JSON.parse(firstPlan({ label: 'initial-adoption', taskId: 's7b3-v-initial-adoption', role: S6A_WORK_ROLE.templateId })).plan, goalId: planning.noPlanGoalRef.goalId },
        reason: { text: 'S7B3 V initial adoption', sources: [] }, requestRef: interventionPlanningQueryRefs(second.ref).queryJobRef, sourceMessageRef: second.ref },
      's7b3-v-initial-adoption')), 'the initial proposal');
    committed(await world.post('messages/withdraw', graphWrite(S6A_SCOPE, { messageRef: second.ref }, 's7b3-v-initial-withdraw')), 'the initial source withdrawal');
    expect.soft((await world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: initialProposal.ref, expectedProposalRevision: initialProposal.revision, decisionRefs: [] }, 's7b3-v-initial-adopt', []))).body).toMatchObject({ status: 'rejected', code: 'source_stale' });
    const late = await sendS7A2PersonMessage(world, { label: 'v-late', recipient: sessionRef.ref, goal: goalRef }); await world.scripted.script(sessionRef, [{ kind: 'text', text: await refinementPlan(world, goalRef, { label: 'late', taskId: 's7b3-v-late', role: S6A_WORK_ROLE.templateId }) }]);
    await driveS7BIntervention(world, late.ref, s7bVWorkProfile(), proposal);
    const lateProposal = ready<{ ref: PlanProposalRef; revision: number }>(await world.platform.plans.readPlanProposal(world.humanContext(),
      { aggregateType: 'PlanProposal', projectId: goalRef.projectId, workspaceId: S6A_SCOPE.workspaceId, proposalId: planProposalIdFor({ projectId: goalRef.projectId, workspaceId: S6A_SCOPE.workspaceId, goalId: goalRef.goalId, requestId: `intervention:${sessionMessageRefKey(late.ref)}:propose` }) }), 'the proposal');
    expect((await world.post('messages/withdraw', graphWrite(S6A_SCOPE, { messageRef: late.ref }, 's7b3-v-late-withdraw'))).body).toMatchObject({ status: 'committed' });
    expect((await world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: lateProposal.ref, expectedProposalRevision: lateProposal.revision, decisionRefs: [] }, 's7b3-v-late-adopt', []))).body)
      .toMatchObject({ status: 'rejected', code: 'source_stale' });
  });
});

describe('V-intervention: a completed Goal', () => {
  it('requests one goal-less new request, replays it and leaves the old facts untouched', async () => {
    const planning = await openS7BPlanningWorld();
    worlds.push(planning.world);
    const { world, goalRef, sessionRef } = planning;
    const profile = s7bVWorkProfile();
    await completeS7BGoal(planning);
    const oldGoal = ready<GoalDetail>(await world.post('goals/read',
      plain(S6A_SCOPE, goalRef)), 'the completed Goal');
    expect(ready<GoalDisplayRead>(await world.post('goals/display', plain(S6A_SCOPE, { goalRef })),
      'the completed Goal display').display.phase).toBe('COMPLETED');
    const completion = ready<{ completion: unknown }>(await world.post('tasks/query',
      plain(S6A_SCOPE, { goalRef })), 'the completed graph').completion;

    const message = await sendS7A2PersonMessage(world, { label: 'v-completed',
      recipient: sessionRef.ref, goal: goalRef });
    const original = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message.ref)),
      'the original message');
    const first = await interveneS7B(world, message.ref, profile);
    expect(first).toMatchObject({ status: 'requested', branch: 'goal_completed' });
    const requestRef = (first as { requestRef: QueryJobRef }).requestRef;
    expect(await interveneS7B(world, message.ref, profile)).toMatchObject({ status: 'requested',
      branch: 'goal_completed', requestRef });

    const round = await readQuery(world.ag2b, requestRef);
    expect(round.job.job).toMatchObject({ goalId: null, requestGoalId: null, assignedSession: null,
      intent: { goalId: null, correlationId: `intervention:${sessionMessageRefKey(message.ref)}:new_goal` },
      receipt: { kind: 'submit', assignment: 'unassigned', secretary: null, created: false } });
    expect(round.job.job.requestRoot).toEqual(requestRef);
    expect(await world.readRequest(requestRef))
      .toMatchObject({ goalId: null, assignment: 'unassigned', owner: null, rounds: [expect.anything()] });

    expect(ready<GoalDetail>(await world.post('goals/read',
      plain(S6A_SCOPE, goalRef)), 'the completed Goal')).toEqual(oldGoal);
    expect(ready<{ completion: unknown }>(await world.post('tasks/query',
      plain(S6A_SCOPE, { goalRef })), 'the completed graph').completion).toEqual(completion);
    const saved = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message.ref)),
      'the original message');
    expect({ goalRef: saved.goalRef, sender: saved.sender, acceptedInputs: saved.acceptedInputs ?? [],
      status: saved.status }).toEqual({ goalRef: original.goalRef, sender: original.sender,
      acceptedInputs: original.acceptedInputs ?? [], status: original.status });

    const secretary = await world.createSecretary('s7b3-v-completed-round');
    expect(await world.route({ commandId: 's7b3-v-completed-route', round: requestRef, to: secretary }))
      .toMatchObject({ status: 'routed' });
    expect(await claimWithSecretaryProfile(world, requestRef, secretary, 's7b3-v-completed-round-claim'))
      .toMatchObject({ status: 'committed' });
    const prepared = await prepareAttempt(world, requestRef, 's7b3-v-completed-round-prepare');
    await world.scripted.script(secretary, [{ kind: 'text', text: JSON.stringify({ schemaVersion: 1,
      body: 'S7B3 V completed-goal answer', ideas: [], goalCardDrafts: [{ objective: 'S7B3 V new Goal',
        completion: ['S7B3 V new Goal done'], autonomy: 'after_plan_confirmation', screening: null }] }) }]);
    expect(await start(world, prepared, 's7b3-v-completed-round-start')).toMatchObject({ status: 'ready' });
    const roundView = (await world.readRequest(requestRef)).rounds
      .find(entry => entry.ref.queryJobId === requestRef.queryJobId);
    if (roundView === undefined) throw new Error('V: the new request did not list its round');
    expect(roundView.goalCardDrafts).toHaveLength(1);
    const confirmed = await world.post('goals/confirm-draft', plain(S6A_SCOPE, { commandId:
      's7b3-v-completed-confirm', round: requestRef, index: roundView.goalCardDrafts[0]!.index }));
    expect(confirmed.body).toMatchObject({ status: 'committed' });
    const newGoal = (confirmed.body as { value: GoalConfirmDraftReceiptV1 }).value.goal.ref;
    expect(newGoal.goalId).not.toBe(goalRef.goalId);

    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const newLine = await sessionOf(world, await createS6BLine(ws, { label: 's7b3-v-completed-new-line',
      role: S6A_WORK_ROLE }));
    const newMessage = await sendS7A2PersonMessage(world, { label: 's7b3-v-completed-new-message',
      recipient: newLine.ref, goal: newGoal });
    await world.scripted.script(newLine, [{ kind: 'text', text: firstPlan({ label: 'completed-new',
      taskId: 's7b3-v-completed-new-task', role: S6A_WORK_ROLE.templateId }) }]);
    const planCard = await driveS7BIntervention(world, newMessage.ref, profile, card);
    const planProposalRef = (planCard as { proposalRef: PlanProposalRef }).proposalRef;
    const planProposal = ready<{ ref: unknown; revision: number }>(await world.platform.plans.readPlanProposal(
      world.humanContext(), planProposalRef), 'the new Goal plan proposal');
    expect((await world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: planProposal.ref,
      expectedProposalRevision: planProposal.revision, decisionRefs: [] }, 's7b3-v-completed-new-apply', []))).body)
      .toMatchObject({ status: 'committed' });
    await readActivePlan(world.platform, world.humanContext(), newGoal);

    expect(ready<GoalDetail>(await world.post('goals/read', plain(S6A_SCOPE, goalRef)),
      'the completed Goal')).toEqual(oldGoal);
    expect(ready<{ completion: unknown }>(await world.post('tasks/query', plain(S6A_SCOPE, { goalRef })),
      'the completed graph').completion).toEqual(completion);
    const after = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message.ref)),
      'the original message');
    expect({ goalRef: after.goalRef, sender: after.sender, acceptedInputs: after.acceptedInputs ?? [],
      status: after.status }).toEqual({ goalRef: original.goalRef, sender: original.sender,
      acceptedInputs: original.acceptedInputs ?? [], status: original.status });
  });
});

describe('V-intervention: an authorized agent message', () => {
  it('takes the same no-task branch without a person check', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await ws.createGoal('s7b3-v-agent-goal', 'S7B3 V agent goal')).ref;
    const { tasks } = await adoptS6BPlan(ws, goal, { label: 'v-agent', role: S6A_WORK_ROLE.templateId,
      taskIds: ['s7b3-v-agent-send', 's7b3-v-agent-reply'] });
    const sender = await sessionOf(world, await createS6BLine(ws, { label: 'v-agent-sender',
      role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const recipient = await sessionOf(world, await createS6BLine(ws, { label: 'v-agent-recipient',
      role: S6A_WORK_ROLE }));
    const basis = ready<DispatchBasisV1>(await world.post('goals/dispatch-basis',
      plain(S6A_SCOPE, { goalRef: goal })), 'the dispatch basis');
    await world.scripted.script(sender, [{ kind: 'calls', calls: [{ callId: 's7b3-v-agent',
      name: 'send_session_message', args: { recipient: recipient.ref, text: 'S7B3 V agent action',
        intent: 'action_request', needsReply: true, expected: basis } }] },
    { kind: 'text', text: 'S7B3 V agent sent' }]);
    const next = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's7b3-v-agent',
      sessionHint: sender.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, 'claim_task');
    await driveWorkflow(world.ag2b, next, { stopBefore: 'open_checks' });
    const saved = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
      plain(S6A_SCOPE, { senderSession: sender.ref, page: { limit: 20 } })), 'the agent outbox').items
      .find(item => item.sender.kind === 'work_run' && item.intent === 'action_request');
    if (saved === undefined) throw new Error('V: the agent action_request is not in its outbox');
    const message = saved.release === 'awaiting' ? await approveS7A2Message(world, saved, 'v-agent') : saved;
    expect(message.sender.kind).toBe('work_run');
    expect(message.intent).toBe('action_request');
    expect(await interveneS7B(world, message.ref, s7bVWorkProfile()))
      .toMatchObject({ status: 'progressed', branch: 'no_task', stage: 'query' });
  });
});



describe('V-intervention: a cancelled Goal with a pending UCR card', () => {
  it('answers queued/no_task and records the UCR card closed by the Goal cancel', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, check: 'pass' });
    const record = await createNeedsDecisionRecord(h, 's7b3-v-cancelled', 's7b3-v-cancelled-host');
    try {
      const card = cardOf(await queueOf(h));
      expect(await h.post('workflow/driver-start', plain(AG2B_SCOPE, { advance: { schemaVersion: 1,
        goalRef: AG2B_GOAL_REF, flowId: 's7b3-v-cancelled-driver', sessionHint: null, kind: 'select_work' },
        queryProfileIds: [] }))).toMatchObject({ status: 'ready' });
      await waitFor(() => display(h.host), value => value.display.causes
        .every(cause => cause.code !== 'interrupted_pending_resume'), 'the pending interruption to be cleared');
      await h.post('workflow/driver-stop', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));

      const line = await h.post('sessions/create', plain(AG2B_SCOPE, { workspace: AG2B_SCOPE,
        role: AG2B_WORK_ROLE, recommendedRefs: [], initialLinks: [], meta: { requestId: 's7b3-v-cancelled-line',
          expected: [] } })) as { status: string; value?: { ref: { projectId: string; sessionId: string } } };
      if (line.status !== 'completed' || line.value === undefined) throw new Error('V-07: the line did not open');
      const sessionRef = { projectId: line.value.ref.projectId, sessionId: line.value.ref.sessionId };
      const message = committed<SessionMessage>(await h.post('messages/send', graphWrite(AG2B_SCOPE, {
        recipient: sessionRef, text: 'S7B3 V-07 cancelled intervention', intent: 'action_request',
        goalRef: AG2B_GOAL_REF,
      }, 's7b3-v-cancelled-message')), 'the V-07 message');

      // `cancelS7AGoal` reads only the world's public `post`; the scenario Host supplies that real route.
      await cancelS7AGoal(h as unknown as S6AHostWorld, AG2B_GOAL_REF);
      const readCard = async () => ready<{ state: string; closedReason: string | null; answer: unknown }>(
        await h.post('decisions/card', plain(AG2B_SCOPE, { source: card.source })), 'the V-07 card');
      expect(await readCard()).toMatchObject({ state: 'closed', closedReason: 'goal_cancelled', answer: null });
      const platform = await h.direct();
      expect(await platform.workflow.handleIntervention!(hostCtx(), { messageRef: message.ref,
        ...s7bVWorkProfile() })).toEqual({ status: 'queued', reason: 'no_task' });

      expect(await h.answer('decisions/answer', graphWrite(AG2B_SCOPE, { source: card.source,
        selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '', annotations: [],
      }, 's7b3-v-cancelled-answer', card.source.pins))).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await readCard()).toMatchObject({ state: 'closed', closedReason: 'goal_cancelled', answer: null });
    } finally {
      await record.release();
    }
  }, 240_000);
});
