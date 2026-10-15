/**
 * Slice 2C row 2C-39 (LE4, L16, §3.10, §3.2 T0): "继续" is computed per
 * paused-interrupted Task and the listed projection matches the real
 * `tasks/requeue` submission.
 *
 * Case (1): a human pause interrupted by the Host restart (RUN-24) gives exactly
 * one `continue`, its target is the Task and its `afterRunRef`, and the
 * submission is accepted.
 *
 * Entry LE4: `openHostScenario`, `restart({ crash: true })`, `lines/list`,
 * `tasks/requeue`.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, hostCtx, openHostScenario, performs, type HostScenario } from './harness.js';
import {
  AG2B_GOAL_REF, AG2B_PROJECT_REF, AG2B_SCOPE, AG2B_WORKSPACE_REF, AG2B_WORK_ROLE, createAG2bSession, graphWrite,
  listSessions, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import { controlOf, lineList, ready, requireControl, requireLine } from '../helpers/S2C-K-scenario-support.js';
import { PAUSE_ON_SECOND_REPLY } from '../helpers/S2C-K2-scenario-support.js';
import { goalControlled } from './support/control.js';
import { nextPlanDraft, requeueBodyOf } from './support/common.js';
import { NO_REDRIVE } from './support/common.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionWorkLinkRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';

afterEach(cleanupScenarios);

it('2C-39 (1) a RUN-24 line gives one continue pinned to its Task and afterRun, and the submission is accepted', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: [...PAUSE_ON_SECOND_REPLY, { kind: 'text', text: '2C-39: the continuation ends' }],
    duringReply: async (index) => {
      if (index !== 1 || h === undefined) return;
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('the work Run must be selected');
      await submitControl(h.host, runRef, 'pause', '2C-39: the person pauses the Run', 's2c39-pause');
    } } });
  await h.advance(h.select('s2c39-run1', 'ag2b-work'));
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;
  await h.restart({ crash: true });

  const row = requireLine(ready(await lineList(h), 'lines/list after the crash'), head, 'the RUN-24 line');
  expect(row.status.own).toBe('paused');
  expect(row.status.ownReason.code).toBe('paused_interrupted');

  // L16 §3.10: every paused-interrupted Task this line owns gives one `continue`.
  const continues = row.controls.filter(control => control.kind === 'continue');
  expect(continues).toHaveLength(1);
  const cont = requireControl(row, 'continue', 'the RUN-24 continue control');
  expect(cont).toMatchObject({ availability: 'available', route: 'tasks/requeue',
    target: { task: { taskId: 'ag2b-work' }, runRef: { runId: runRef.runId } } });
  expect(controlOf(row, 'pause')).toBeUndefined();
  expect(controlOf(row, 'resume')).toBeUndefined();
  expect(controlOf(row, 'cancel')).toBeUndefined();

  // The listed projection matches the submission: with the state unchanged, it is accepted.
  const body = await requeueBodyOf(h.host, runRef, 's2c39-continue', '继续');
  const continued = await h.post<WriteResult<TaskRequeueOutcomeV1>>('tasks/requeue', body);
  expect(continued).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
}, 240_000);

it('2C-39 (3) after the RUN-24 Task is transferred, the idle Session lists one continue pinned to the Task and the old afterRun, and submitting it continues there', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: [...PAUSE_ON_SECOND_REPLY, { kind: 'text', text: '2C-39 (3): the continuation ends' }],
    duringReply: async (index) => {
      if (index !== 1 || h === undefined) return;
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('the work Run must be selected');
      await submitControl(h.host, runRef, 'pause', '2C-39 (3): the person pauses the Run', 's2c39b-pause');
    } } });
  await h.advance(h.select('s2c39b-run1', 'ag2b-work'));
  const pausedRun = (await h.taskRow()).execution;
  if (pausedRun === null) throw new Error('the work Run must be selected');
  const gSession = (await readExecution(h.host, pausedRun)).session;
  const gRef = { projectId: gSession.ref.projectId, sessionId: gSession.ref.sessionId };
  await h.restart({ crash: true });

  // The person transfers the paused Task to a fresh, idle work Session H.
  const hCreated = await createAG2bSession(h.host, 's2c39b-h', AG2B_WORK_ROLE);
  const hRef = hCreated.sessionRef;
  const gAfter = (await listSessions(h.host)).find(card => card.record.ref.sessionId === gRef.sessionId);
  if (gAfter === undefined) throw new Error('G must be in the Session directory');
  const source = gAfter.links.find(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === 'ag2b-work');
  if (source === undefined) throw new Error('G must still hold the responsible link');
  const destination: SessionWorkLinkRef = { ...hRef, aggregateType: 'SessionWorkLink',
    target: source.ref.target, relation: 'responsible' };
  const transfer = await h.answer('sessions/transfer-responsibility', graphWrite(AG2B_SCOPE,
    { from: gRef, to: hRef, target: source.ref.target }, 's2c39b-transfer', [
      { ref: gAfter.record.ref, revision: gAfter.record.revision },
      { ref: hCreated.sessionAggregateRef, revision: hCreated.revision },
      { ref: source.ref, revision: source.revision },
      { ref: destination, revision: 0 },
    ]));
  expect(transfer.status, JSON.stringify(transfer)).toBe('committed');

  const row = requireLine(ready(await lineList(h), 'lines/list after the transfer'), hRef.sessionId, 'the H line');
  expect(row.status.own).toBe('paused');
  expect(row.status.ownReason.code).toBe('paused_interrupted');
  const continues = row.controls.filter(control => control.kind === 'continue');
  expect(continues).toHaveLength(1);
  expect(requireControl(row, 'continue', 'the transferred continue control')).toMatchObject({
    availability: 'available', route: 'tasks/requeue',
    target: { task: { taskId: 'ag2b-work' }, runRef: { runId: pausedRun.runId } } });

  // The listed projection matches the submission: H continues the Task.
  const body = await requeueBodyOf(h.host, pausedRun, 's2c39b-continue', '继续');
  const continued = await h.post<WriteResult<TaskRequeueOutcomeV1>>('tasks/requeue', body);
  expect(continued).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
  await h.advance(h.select('s2c39b-continue-claim', 'ag2b-work'), { stopBefore: performs('start') });
  const nextRun = (await h.taskRow()).execution;
  expect(nextRun).not.toBeNull();
  expect((await readExecution(h.host, nextRun!)).session.ref.sessionId).toBe(hRef.sessionId);
}, 240_000);

it('2C-39 (2) after the RUN-24 Task is cancelled, the listed continue is unavailable with the guard code and the submission is refused with the same code and reason', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: [...PAUSE_ON_SECOND_REPLY, { kind: 'text', text: '2C-39 (2): the continuation ends' }],
    duringReply: async (index) => {
      if (index !== 1 || h === undefined) return;
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('the work Run must be selected');
      await submitControl(h.host, runRef, 'pause', '2C-39 (2): the person pauses the Run', 's2c39c-pause');
    } } });
  await h.advance(h.select('s2c39c-run1', 'ag2b-work'));
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;
  await h.restart({ crash: true });

  // The operator cancels the Task through a real Plan change (disposition cancelled).
  const platform = await h.direct();
  const next = await nextPlanDraft(platform, 's2c39c-plan', draft => ({ ...draft,
    tasks: draft.tasks.map(task => task.taskId === 'ag2b-work' ? { ...task, disposition: 'cancelled' as const } : task) }));
  const proposed = await platform.plans.proposePlan(hostCtx(), { meta: { requestId: 's2c39c-propose', expected: [] },
    input: { goalRef: AG2B_GOAL_REF, basedOn: next.source.ref, draft: next.draft,
      reason: { text: '2C-39 (2): cancel the paused Task', sources: [], affectedTaskIds: ['ag2b-work'] } } });
  expect(proposed).toMatchObject({ status: 'committed' });
  if (proposed.status !== 'committed') throw new Error(JSON.stringify(proposed));
  const applied = await platform.plans.applyPlanChange(hostCtx(), { meta: { requestId: 's2c39c-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  expect(applied.status, JSON.stringify(applied)).toBe('committed');

  const row = requireLine(ready(await lineList(h), 'lines/list after the cancellation'), head, 'the cancelled-task line');
  const cont = requireControl(row, 'continue', 'the unavailable continue control');
  expect(cont.availability).toBe('unavailable');
  expect(cont.reasonCode).toBe('invalid');
  expect(cont.reason).toMatch(/^task_not_active/);

  // The listed projection matches the submission: the same code and reason come back.
  const body = await requeueBodyOf(h.host, runRef, 's2c39c-continue', '继续');
  const refused = await h.answer('tasks/requeue', body) as Record<string, unknown>;
  expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(String(refused.reason)).toMatch(/^task_not_active/);
}, 240_000);

it('2C-39 (4) one line with two paused-interrupted Tasks in two Goals lists two continues; pausing one Goal makes only that Task unavailable, and each submission matches the listing', async () => {
  const goal2: GoalRef = { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal-2' };
  let h: HostScenario | undefined;
  let xRunRef: RunRef | undefined;
  let yRunRef: RunRef | undefined;

  async function goal2Run(taskId: string): Promise<RunRef | null> {
    if (h === undefined) throw new Error('the Host must be open');
    const graph = await h.post<ReadResult<{ tasks: Array<{ ref: { taskId: string }; execution: RunRef | null }> }>>(
      'tasks/query', plain(AG2B_SCOPE, { goalRef: goal2 }));
    if (graph.status !== 'ready') throw new Error(`the second Goal graph must be readable: ${JSON.stringify(graph)}`);
    return graph.value.tasks.find(task => task.ref.taskId === taskId)?.execution ?? null;
  }

  h = await openHostScenario({ automation: NO_REDRIVE, script: {
    replies: [
      { kind: 'calls', calls: [{ callId: 's2c39d-x1', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'calls', calls: [{ callId: 's2c39d-x2', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'calls', calls: [{ callId: 's2c39d-y1', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'calls', calls: [{ callId: 's2c39d-y2', name: 'read', args: { path: 'src/module.ts' } }] },
    ],
    duringReply: async (index) => {
      if (h === undefined) return;
      if (index === 1) {
        const runRef = (await h.taskRow('ag2b-work')).execution;
        if (runRef === null) throw new Error('X must have a Run');
        xRunRef = runRef;
        await submitControl(h.host, runRef, 'pause', '2C-39 (4): the person pauses X', 's2c39d-x-pause');
      }
      if (index === 3) {
        const runRef = await goal2Run('ag2b-work-2');
        if (runRef === null) throw new Error('Y must have a Run');
        yRunRef = runRef;
        await submitControl(h.host, runRef, 'pause', '2C-39 (4): the person pauses Y', 's2c39d-y-pause');
      }
    },
  } });
  const heldX = h.holdReply(1);
  const heldY = h.holdReply(3);

  // A second Goal and Plan with one work Task Y, through the real owners.
  const platform = await h.direct();
  const created = await platform.goals.createGoal(hostCtx(), {
    meta: { requestId: 's2c39d-goal2', expected: [
      { ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }] },
    input: { goalId: goal2.goalId, workspace: AG2B_SCOPE, objective: '2C-39 (4) second Goal' } });
  expect(created.status, JSON.stringify(created)).toBe('committed');
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 'ag2b-plan-2', planRevision: 1, goalId: goal2.goalId, stages: [],
    tasks: [
      { taskId: 'ag2b-work-2', title: 'Second Goal work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'ag2b-gate', title: 'Second Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'ag2b-work-2', role: 'builder', instruction: 'Do the second Goal work' }],
    obligations: [{ obligationId: 'ag2b-obligation-2', title: 'Deliver the second Goal', requirementLevel: 'required',
      taskIds: ['ag2b-work-2', 'ag2b-gate'],
      verificationRequirements: [{ requirementId: 'ag2b-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
  const proposed = await platform.plans.proposePlan(hostCtx(), { meta: { requestId: 's2c39d-plan2', expected: [] },
    input: { goalRef: goal2, basedOn: null, draft, reason: { text: '2C-39 (4) second plan', sources: [] } } });
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  if (proposed.status !== 'committed') throw new Error(JSON.stringify(proposed));
  const applied = await platform.plans.applyPlanChange(hostCtx(), { meta: { requestId: 's2c39d-apply2', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  expect(applied.status, JSON.stringify(applied)).toBe('committed');

  // 1) Run X on Goal G, pause it and crash: G's line is retired with X paused-interrupted.
  const toStartX = await h.advance(h.select('s2c39d-x', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStartX.next === null) throw new Error('X must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStartX.next)).catch(() => undefined);
  await heldX.reached;
  await h.restart({ crash: true });

  // 2) Run Y on the second Goal, pause it and crash: its line is retired with Y paused-interrupted.
  const yInput: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: goal2, flowId: 's2c39d-y',
    sessionHint: null, kind: 'select_work', taskId: 'ag2b-work-2' };
  const toStartY = await h.advance(yInput, { stopBefore: performs('start') });
  if (toStartY.next === null) throw new Error('Y must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStartY.next)).catch(() => undefined);
  await heldY.reached;
  await h.restart({ crash: true });
  if (xRunRef === undefined || yRunRef === undefined) throw new Error('both Runs must have started');

  // 3) A fresh idle work Session H receives BOTH paused responsibilities through
  // the real `sessions/transfer-responsibility` route. Item 10 lets a
  // reused-Session claim open the Task's link, but a claim never moves an
  // already-claimed Task: the transfer is still the public way to move one Task
  // from its current line to an existing line.
  const hCreated = await createAG2bSession(h.host, 's2c39d-h', AG2B_WORK_ROLE);
  const hRef = hCreated.sessionRef;
  async function transferTask(sourceRun: RunRef, taskId: string, requestId: string): Promise<void> {
    if (h === undefined) throw new Error('the Host must be open');
    const sourceSession = (await readExecution(h.host, sourceRun)).session;
    const sourceRef = { projectId: sourceSession.ref.projectId, sessionId: sourceSession.ref.sessionId };
    const sourceCard = (await listSessions(h.host)).find(card => card.record.ref.sessionId === sourceRef.sessionId);
    if (sourceCard === undefined) throw new Error('the source Session must exist');
    const link = sourceCard.links.find(candidate => candidate.ref.relation === 'responsible'
      && candidate.ref.target.kind === 'task' && candidate.ref.target.ref.taskId === taskId);
    if (link === undefined) throw new Error(`the source must hold the responsible link to ${taskId}`);
    const targetCard = (await listSessions(h.host)).find(card => card.record.ref.sessionId === hRef.sessionId);
    if (targetCard === undefined) throw new Error('H must exist');
    const destination: SessionWorkLinkRef = { ...hRef, aggregateType: 'SessionWorkLink',
      target: link.ref.target, relation: 'responsible' };
    const transfer = await h.post<ReadResult<unknown>>('sessions/transfer-responsibility', graphWrite(AG2B_SCOPE,
      { from: sourceRef, to: hRef, target: link.ref.target }, requestId, [
        { ref: sourceCard.record.ref, revision: sourceCard.record.revision },
        { ref: targetCard.record.ref, revision: targetCard.record.revision },
        { ref: link.ref, revision: link.revision },
        { ref: destination, revision: 0 },
      ]));
    expect(transfer, JSON.stringify(transfer)).toMatchObject({ status: 'committed' });
  }
  await transferTask(xRunRef, 'ag2b-work', 's2c39d-transfer-x');
  await transferTask(yRunRef, 'ag2b-work-2', 's2c39d-transfer-y');

  const row = requireLine(ready(await lineList(h), 'lines/list after both transfers'), hRef.sessionId, 'the H line');
  expect(row.status.own).toBe('paused');
  expect(row.status.ownReason.code).toBe('paused_interrupted');
  const continues = row.controls.filter(control => control.kind === 'continue');
  expect(continues).toHaveLength(2);
  const xBefore = continues.find(control => control.target.task?.taskId === 'ag2b-work');
  const yBefore = continues.find(control => control.target.task?.taskId === 'ag2b-work-2');
  expect(xBefore, 'X has its own continue').toMatchObject({ availability: 'available',
    target: { runRef: { runId: xRunRef.runId } } });
  expect(yBefore, 'Y has its own continue').toMatchObject({ availability: 'available',
    target: { runRef: { runId: yRunRef.runId } } });

  // Pausing Goal G (X's Goal) makes only X's continue unavailable.
  await goalControlled(h.host, 'pause', 's2c39d-goal-pause');
  const pausedRow = requireLine(ready(await lineList(h), 'lines/list after the Goal pause'), hRef.sessionId, 'the H line');
  const xAfter = pausedRow.controls.find(control => control.kind === 'continue' && control.target.task?.taskId === 'ag2b-work');
  const yAfter = pausedRow.controls.find(control => control.kind === 'continue' && control.target.task?.taskId === 'ag2b-work-2');
  expect(xAfter).toMatchObject({ availability: 'unavailable', reasonCode: 'busy' });
  expect(xAfter?.reason).toMatch(/resume the Goal first/);
  expect(yAfter).toMatchObject({ availability: 'available' });

  // Submit each once: the unavailable one is refused with the listed code and
  // reason; the available one is accepted.
  const xBody = await requeueBodyOf(h.host, xRunRef, 's2c39d-x-continue', '继续');
  const xAnswer = await h.answer('tasks/requeue', xBody) as Record<string, unknown>;
  expect(xAnswer).toMatchObject({ status: 'rejected', code: xAfter?.reasonCode });
  expect(xAnswer.reason).toBe(xAfter?.reason);
  // Y is in the second Goal, so its requeue body pins that Goal (the shared
  // `requeueBodyOf` helper is hardwired to the seeded Goal).
  const yGoalRead = await h.post<ReadResult<{ goal: { revision: number } }>>('goals/read', plain(AG2B_SCOPE, goal2));
  if (yGoalRead.status !== 'ready') throw new Error(`Goal 2 must be readable: ${JSON.stringify(yGoalRead)}`);
  const yRun = (await readExecution(h.host, yRunRef)).run;
  const yBody = graphWrite(AG2B_SCOPE, { taskRef: { projectId: AG2B_SCOPE.projectId, goalId: goal2.goalId,
    taskId: 'ag2b-work-2' }, afterRunRef: yRunRef, reason: '继续' }, 's2c39d-y-continue',
  [{ ref: goal2, revision: yGoalRead.value.goal.revision }, { ref: yRunRef, revision: yRun.revision }]);
  const yAnswer = await h.post<WriteResult<TaskRequeueOutcomeV1>>('tasks/requeue', yBody);
  expect(yAnswer).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
}, 240_000);
