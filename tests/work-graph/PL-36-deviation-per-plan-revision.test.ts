/**
 * PL-36 (spec §15.4, v4 §15-36): the hard stop re-sends per plan revision.
 *
 * The budget variant: a real accumulated-token Run stops in v1; the Goal loop
 * sends `deviation:<goal>:<task>:budget:1`; the same version re-advanced sends
 * nothing new. A v2 that only changes another Task is adopted, then the person's
 * real `tasks/requeue` (a larger budget that the next Run still exhausts) makes
 * the same Task produce a second Run whose claim pins v2. That Run stops again,
 * so the second `deviation:` names revision 2 and has a different message.
 *
 * The cap and `no_new_basis` variants use the approved injectable failing check:
 * each real Run fails the registered check, and the real auto-requeue path either
 * reaches the cap or is refused `no_new_basis`. Both then requeue the Task through
 * the person's public `tasks/requeue` (the `no_new_basis` variant attaches a real
 * new-basis note), so the second Run claims v2, and the loop emits the second
 * `deviation:` with revision 2.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { deviationsOfGoal, deviationRequestId } from '../../src/contracts/plan-deviation.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { advanceUntil, post, readExecution } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { heartbeatUntil, heartbeatUntilModel, readBody, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { installPLFailingCheck } from '../helpers/PL-consumption-fixture.js';
import { usage } from '../helpers/PL-readings-fixture.js';
import {
  drivePLTaskRunsToStop, openPLDeviationConsumptionWorld, runRevisionOf, type PLDeviationConsumptionWorld,
} from '../helpers/PL-deviation-fixture.js';

let opened: PLDeviationConsumptionWorld | null = null;
afterEach(async () => { await opened?.close().catch(() => undefined); opened = null; });

async function sendOne(world: PLDeviationConsumptionWorld, flowId: string): Promise<void> {
  const send = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
    flowId, sessionHint: null, kind: 'select_work' }, 'send_system_round');
  ready(await post(world.world.ag2b, 'workflow/advance', plain(S6A_SCOPE, send)), `the ${flowId} send`);
}

it('PL-36: a budget stop sends one deviation per plan revision from a real new Run', async () => {
  const fixture = opened = await openPLDeviationConsumptionWorld({
    label: 'pl36', taskIds: ['pl36-a', 'pl36-b'] });
  const { world, goal, tasks, line } = fixture;
  const [a, b] = tasks;
  if (a === undefined || b === undefined) throw new Error('PL-36: the Plan needs two Tasks');
  expect(await world.settings('run-budget/save', { workRunTokenBudget: 100_000 }))
    .toMatchObject({ status: 'ready' });
  const ctx = fixture.main.humanContext();

  // v1: A's real Run exhausts the saved budget.
  const first = await fixture.runTask({ line, taskId: a.taskId, flowId: 'pl36-a1',
    replies: [{ kind: 'text', text: 'PL-36 first Run never completes', usage: usage(150_000, 0) }] });
  const firstRead = await readExecution(world.ag2b, first);
  expect(firstRead.run).toMatchObject({ status: 'ended', outcome: 'budget_exhausted',
    budget: { tokenBudget: 100_000 }, planRef: { planId: expect.any(String) } });
  expect(firstRead.plan.planRevision).toBe(1);

  const facts1 = await fixture.readDeviationFacts(ctx);
  const budget1 = deviationsOfGoal(facts1).filter(deviation => deviation.kind === 'budget');
  expect(budget1).toHaveLength(1);
  expect(budget1[0]).toMatchObject({ taskRef: { taskId: a.taskId }, planRevision: 1 });
  const requestId1 = deviationRequestId(budget1[0]!);
  expect(requestId1).toBe(`deviation:${goal.goalId}:${a.taskId}:budget:1`);

  // The Goal loop sends it through the one system-round arm.
  await sendOne(fixture, 'pl36-send-1');
  const ref1 = systemRoundMessageRef(S6A_SCOPE, requestId1);
  if (ref1.status !== 'ready') throw new Error('PL-36: the first request id has no message ref');
  const message1 = ready<SessionMessage>((await world.post('messages/read', plain(S6A_SCOPE, ref1.value))).body,
    'the first deviation message');
  expect(message1.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } });
  const query1 = await heartbeatUntil(world, () => readPlanningQuery(world, ref1.value), value => value !== null);
  expect(query1).not.toBeNull();

  // Re-advancing the same version never selects the same send again.
  const repeat = await post<import('../../src/business/workflow/contracts.js').WorkflowAdvanceResult>(
    world.ag2b, 'workflow/advance', plain(S6A_SCOPE, { schemaVersion: 1, goalRef: goal,
      flowId: 'pl36-repeat', sessionHint: null, kind: 'select_work' }));
  expect(repeat.status).toBe('ready');
  const repeatNext = repeat.status === 'ready' ? repeat.value.next : null;
  expect(repeatNext?.kind === 'perform' && repeatNext.operation.kind === 'send_system_round'
    && repeatNext.operation.request.round.kind === 'deviation'
    && repeatNext.operation.request.round.planRevision === 1).toBe(false);
  const again = ready<SessionMessage>((await world.post('messages/read', plain(S6A_SCOPE, ref1.value))).body,
    'the replayed message');
  expect(again.ref).toEqual(message1.ref);

  // v2 changes only B; A's execution definition stays. A person then raises A's
  // budget through the public requeue, and the next A Run still exhausts it.
  const plan1 = await fixture.main.activePlan(goal);
  if (plan1 === null) throw new Error('PL-36: v1 is not active');
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${plan1.planId}-v2`, planRevision: plan1.planRevision + 1,
    goalId: goal.goalId,
    stages: structuredClone(plan1.stages),
    tasks: structuredClone(plan1.tasks).map(task => task.taskId === b.taskId
      ? { ...task, title: `${task.title} v2 only` } : task),
    assignments: structuredClone(plan1.assignments ?? []),
    obligations: structuredClone(plan1.obligations),
    taskHierarchy: structuredClone(plan1.taskHierarchy),
    executionDag: structuredClone(plan1.executionDag),
    taskRelations: structuredClone(plan1.taskRelations ?? []),
    inputRequirements: structuredClone(plan1.inputRequirements ?? []),
  };
  const proposed = committed<{ ref: { aggregateType: 'PlanProposal'; projectId: string;
    workspaceId: string; proposalId: string }; revision: number }>(await fixture.main.post('plans/propose',
    graphWrite(S6A_SCOPE, {
      goalRef: goal, basedOn: plan1.ref, draft, reason: { text: 'PL-36 v2 only changes B', sources: [] },
    }, 'pl36-v2-propose')), 'the v2 proposal');
  committed(await fixture.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, 'pl36-v2-apply')), 'the v2 adoption');
  const plan2 = await fixture.main.activePlan(goal);
  if (plan2 === null) throw new Error('PL-36: v2 is not active');

  const goalRead = (await world.post('goals/read', plain(S6A_SCOPE, goal))).body as
    { value?: { goal?: { revision?: number } } };
  const goalRevision = goalRead.value?.goal?.revision;
  if (goalRevision === undefined) throw new Error('PL-36: goals/read has no revision');
  const firstRunRevision = await runRevisionOf(world, first);
  const requeued = await world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
    taskRef: a, afterRunRef: first, reason: 'PL-36 a still small budget',
    budget: { tokenBudget: 120_000, deadline: null },
  }, 'pl36-requeue', [{ ref: goal, revision: goalRevision }, { ref: first, revision: firstRunRevision }]));
  expect((requeued.body as { status?: string }).status).toBe('committed');

  const second = await fixture.runTask({ line, taskId: a.taskId, flowId: 'pl36-a2',
    replies: [{ kind: 'text', text: 'PL-36 second Run never completes', usage: usage(150_000, 0) }] });
  const secondRead = await readExecution(world.ag2b, second);
  expect(secondRead.run).toMatchObject({ status: 'ended', outcome: 'budget_exhausted' });
  expect(secondRead.plan.planRevision, 'the second Run claims v2').toBe(2);

  const facts2 = await fixture.readDeviationFacts(ctx);
  const budget2 = deviationsOfGoal(facts2).filter(deviation => deviation.kind === 'budget'
    && deviation.taskRef.taskId === a.taskId);
  expect(budget2).toHaveLength(1);
  expect(budget2[0]).toMatchObject({ planRevision: 2, runRef: { runId: second.runId } });
  const requestId2 = deviationRequestId(budget2[0]!);
  expect(requestId2).toBe(`deviation:${goal.goalId}:${a.taskId}:budget:2`);
  expect(requestId2).not.toBe(requestId1);

  // The adviser answers "no plan change"; the Task stays stopped.
  const gate = await world.gates.modelRequest(fixture.adviser);
  await sendOne(fixture, 'pl36-send-2');
  const ref2 = systemRoundMessageRef(S6A_SCOPE, requestId2);
  if (ref2.status !== 'ready') throw new Error('PL-36: the second request id has no message ref');
  const message2 = ready<SessionMessage>((await world.post('messages/read', plain(S6A_SCOPE, ref2.value))).body,
    'the second deviation message');
  expect(message2.ref.messageId).not.toBe(message1.ref.messageId);
  expect(message2.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } });
  const held = await heartbeatUntilModel(world, gate);
  await world.scripted.script(fixture.adviser, [{ kind: 'text', text: 'PL-36: no plan change' }]);
  gate.release();
  await held.settled;

  const row = (await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal }))).body as
    { value?: { tasks?: Array<{ ref: { taskId: string }; failure?: { automation?: { verdict?: { kind: string } } } }> } };
  expect(row.value?.tasks?.find(task => task.ref.taskId === a.taskId)?.failure?.automation?.verdict?.kind)
    .toBe('stopped');
}, 240_000);

/** Adopt a v2 whose only change is B's title (A's execution definition is untouched). */
async function adoptOnlyB(fixture: PLDeviationConsumptionWorld, b: { taskId: string }): Promise<void> {
  const plan1 = await fixture.main.activePlan(fixture.goal);
  if (plan1 === null) throw new Error('PL-36: v1 is not active');
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${plan1.planId}-v2`, planRevision: plan1.planRevision + 1,
    goalId: fixture.goal.goalId,
    stages: structuredClone(plan1.stages),
    tasks: structuredClone(plan1.tasks).map(task => task.taskId === b.taskId
      ? { ...task, title: `${task.title} v2 only` } : task),
    assignments: structuredClone(plan1.assignments ?? []),
    obligations: structuredClone(plan1.obligations),
    taskHierarchy: structuredClone(plan1.taskHierarchy),
    executionDag: structuredClone(plan1.executionDag),
    taskRelations: structuredClone(plan1.taskRelations ?? []),
    inputRequirements: structuredClone(plan1.inputRequirements ?? []),
  };
  const proposed = committed<{ ref: { aggregateType: 'PlanProposal'; projectId: string;
    workspaceId: string; proposalId: string }; revision: number }>(await fixture.main.post('plans/propose',
    graphWrite(S6A_SCOPE, {
      goalRef: fixture.goal, basedOn: plan1.ref, draft, reason: { text: 'PL-36 v2 only changes B', sources: [] },
    }, 'pl36-v2-propose')), 'the v2 proposal');
  committed(await fixture.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, 'pl36-v2-apply')), 'the v2 adoption');
  const plan2 = await fixture.main.activePlan(fixture.goal);
  if (plan2 === null) throw new Error('PL-36: v2 is not active');
}

/** The person's real requeue on A at the stopped Run, optionally with a real new-basis note. */
async function requeueA(fixture: PLDeviationConsumptionWorld, a: { projectId: string; goalId: string; taskId: string },
  afterRun: Parameters<typeof runRevisionOf>[1], requestId: string, note: string | null): Promise<void> {
  const goalRead = (await fixture.world.post('goals/read', plain(S6A_SCOPE, fixture.goal))).body as
    { value?: { goal?: { revision?: number } } };
  const goalRevision = goalRead.value?.goal?.revision;
  if (goalRevision === undefined) throw new Error('PL-36: goals/read has no revision');
  const firstRunRevision = await runRevisionOf(fixture.world, afterRun);
  const requeued = await fixture.world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
    taskRef: a, afterRunRef: afterRun, reason: `PL-36 ${requestId}`,
    ...(note === null ? {} : { note }),
  }, requestId, [{ ref: fixture.goal, revision: goalRevision }, { ref: afterRun, revision: firstRunRevision }]));
  expect((requeued.body as { status?: string }).status).toBe('committed');
}

type StopVariant = {
  name: string; cap: number; note: string | null; write: boolean;
  stopReason: 'auto_rework_cap_reached' | 'no_new_basis'; v2Runs: number;
};

const stopVariants: StopVariant[] = [
  // C8's cap world changes the source on every Run, so each automatic requeue
  // has a new basis and the count advances to the cap.
  { name: 'cap', cap: 1, note: null, write: true, stopReason: 'auto_rework_cap_reached', v2Runs: 2 },
  // The no-progress world chooses no edit, so the second automatic requeue is
  // refused; the person's note is the new basis that reopens the v2 Run.
  { name: 'no_new_basis', cap: 3, note: 'PL-36 new basis: retry the same method once',
    write: false, stopReason: 'no_new_basis', v2Runs: 1 },
];

/** One failing Run: the cap world edits its own file, the no-progress world changes nothing. */
function failingReplies(variant: StopVariant, label: string, count: number) {
  return Array.from({ length: count }, (_, index) => (variant.write
    ? [
      { kind: 'calls' as const, calls: [{ callId: `pl36-${label}-edit-${String(index + 1)}`, name: 'edit',
        args: { mode: 'create', path: `src/pl36-${label}-${String(index + 1)}.txt`,
          newText: `PL-36 ${label} Run ${String(index + 1)} changes the source\n` } }] },
      { kind: 'text' as const, text: `PL-36 ${label} Run ${String(index + 1)} fails the check` },
    ]
    : [{ kind: 'text' as const, text: `PL-36 ${label} Run ${String(index + 1)} fails the check` }]))
    .flat();
}

it.each(stopVariants)('PL-36: $name sends one deviation per plan revision from a real new v2 Run',
  async variant => {
    const fixture = opened = await openPLDeviationConsumptionWorld({
      label: `pl36-${variant.name}`, taskIds: ['pl36-a', 'pl36-b'],
      checks: installPLFailingCheck(), ...(variant.write ? { write: true } : {}) });
    const { world, goal, tasks, line } = fixture;
    const [a, b] = tasks;
    if (a === undefined || b === undefined) throw new Error('PL-36: the Plan needs two Tasks');
    expect(await world.settings('automation/save', {
      autoReworkLimit: variant.cap, resumeOnStartup: 'auto' })).toMatchObject({ status: 'ready' });
    const ctx = fixture.main.humanContext();

    // v1: every real Run fails the registered check; the real automatic path
    // reaches the cap (2 Runs) or the no-progress refusal (2 Runs).
    const v1 = await drivePLTaskRunsToStop(world, { goal, line, taskId: a.taskId,
      flowId: `pl36-${variant.name}-v1`, replies: failingReplies(variant, 'v1', 2) });
    expect(v1.runs).toHaveLength(2);
    const firstRead = await readExecution(world.ag2b, v1.runs.at(-1)!);
    expect(firstRead.run.status).toBe('ended');
    expect(firstRead.plan.planRevision).toBe(1);
    const row1 = (await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal }))).body as
      { value?: { tasks?: Array<{ ref: { taskId: string };
        failure?: { automation?: { verdict?: { kind: string; reason?: string } } } }> } };
    expect(row1.value?.tasks?.find(task => task.ref.taskId === a.taskId)?.failure?.automation?.verdict)
      .toMatchObject({ kind: 'stopped', reason: variant.stopReason });

    const facts1 = await fixture.readDeviationFacts(ctx);
    const stop1 = deviationsOfGoal(facts1).filter(deviation =>
      deviation.kind === 'stop' && deviation.taskRef.taskId === a.taskId);
    expect(stop1).toHaveLength(1);
    expect(stop1[0]).toMatchObject({ planRevision: 1, stopReason: variant.stopReason,
      runRef: { runId: v1.runs.at(-1)!.runId } });
    const requestId1 = deviationRequestId(stop1[0]!);
    expect(requestId1).toBe(`deviation:${goal.goalId}:${a.taskId}:stop:1`);

    // The Goal loop sends it once; the same version re-advanced sends nothing new.
    await sendOne(fixture, `pl36-${variant.name}-send-1`);
    const ref1 = systemRoundMessageRef(S6A_SCOPE, requestId1);
    if (ref1.status !== 'ready') throw new Error('PL-36: the first request id has no message ref');
    const message1 = ready<SessionMessage>((await world.post('messages/read', plain(S6A_SCOPE, ref1.value))).body,
      'the first stop message');
    expect(message1.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } });
    expect(await readBody(world, ref1.value, 'message')).toContain(`stop cause: ${variant.stopReason}`);
    const query1 = await heartbeatUntil(world, () => readPlanningQuery(world, ref1.value), value => value !== null);
    expect(query1).not.toBeNull();
    const repeat = await post<import('../../src/business/workflow/contracts.js').WorkflowAdvanceResult>(
      world.ag2b, 'workflow/advance', plain(S6A_SCOPE, { schemaVersion: 1, goalRef: goal,
        flowId: `pl36-${variant.name}-repeat`, sessionHint: null, kind: 'select_work' }));
    expect(repeat.status).toBe('ready');
    const repeatNext = repeat.status === 'ready' ? repeat.value.next : null;
    expect(repeatNext?.kind === 'perform' && repeatNext.operation.kind === 'send_system_round'
      && repeatNext.operation.request.round.kind === 'deviation'
      && repeatNext.operation.request.round.planRevision === 1).toBe(false);
    const again = ready<SessionMessage>((await world.post('messages/read', plain(S6A_SCOPE, ref1.value))).body,
      'the replayed message');
    expect(again.ref).toEqual(message1.ref);

    // v2 changes only B; the person requeues A, and for `no_new_basis` supplies a
    // real new-basis note (adopting v2 alone is not a basis).
    await adoptOnlyB(fixture, b);
    await requeueA(fixture, a, v1.runs.at(-1)!, `pl36-${variant.name}-requeue`, variant.note);

    const v2 = await drivePLTaskRunsToStop(world, { goal, line, taskId: a.taskId,
      flowId: `pl36-${variant.name}-v2`, replies: failingReplies(variant, 'v2', variant.v2Runs) });
    expect(v2.runs).toHaveLength(variant.v2Runs);
    const secondRead = await readExecution(world.ag2b, v2.runs.at(-1)!);
    expect(secondRead.run.status).toBe('ended');
    expect(secondRead.plan.planRevision, 'the second Run claims v2').toBe(2);
    const row2 = (await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal }))).body as
      { value?: { tasks?: Array<{ ref: { taskId: string };
        failure?: { automation?: { verdict?: { kind: string; reason?: string } } } }> } };
    expect(row2.value?.tasks?.find(task => task.ref.taskId === a.taskId)?.failure?.automation?.verdict)
      .toMatchObject({ kind: 'stopped', reason: variant.stopReason });

    const facts2 = await fixture.readDeviationFacts(ctx);
    const stop2 = deviationsOfGoal(facts2).filter(deviation =>
      deviation.kind === 'stop' && deviation.taskRef.taskId === a.taskId);
    expect(stop2).toHaveLength(1);
    expect(stop2[0]).toMatchObject({ planRevision: 2, stopReason: variant.stopReason,
      runRef: { runId: v2.runs.at(-1)!.runId } });
    const requestId2 = deviationRequestId(stop2[0]!);
    expect(requestId2).toBe(`deviation:${goal.goalId}:${a.taskId}:stop:2`);
    expect(requestId2).not.toBe(requestId1);

    // The adviser answers "no plan change"; the Task stays stopped.
    const gate = await world.gates.modelRequest(fixture.adviser);
    await sendOne(fixture, `pl36-${variant.name}-send-2`);
    const ref2 = systemRoundMessageRef(S6A_SCOPE, requestId2);
    if (ref2.status !== 'ready') throw new Error('PL-36: the second request id has no message ref');
    const message2 = ready<SessionMessage>((await world.post('messages/read', plain(S6A_SCOPE, ref2.value))).body,
      'the second stop message');
    expect(message2.ref.messageId).not.toBe(message1.ref.messageId);
    expect(message2.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } });
    expect(await readBody(world, ref2.value, 'message')).toContain(`stop cause: ${variant.stopReason}`);
    const held = await heartbeatUntilModel(world, gate);
    await world.scripted.script(fixture.adviser, [{ kind: 'text', text: 'PL-36: no plan change' }]);
    gate.release();
    await held.settled;

    const row = (await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal }))).body as
      { value?: { tasks?: Array<{ ref: { taskId: string };
        failure?: { automation?: { verdict?: { kind: string } } } }> } };
    expect(row.value?.tasks?.find(task => task.ref.taskId === a.taskId)?.failure?.automation?.verdict?.kind)
      .toBe('stopped');
  }, 240_000);
