/**
 * PL-16: the `plan_only` placeholder refinement is attached at the common close-out
 * even when a real L46 handoff block and a separate `wait_reply` wait exist (spec
 * §5.1.4, DR-P4-07/DR-P4-14). The public entry is `workflow/advance`; the waiting
 * basis is read through the advance result.
 *
 * The L46 fact comes from the source line's own real Run: that Run writes the
 * Goal's understanding through `record_note`, then calls the real `hand_off` tool
 * under `every_step`, whose accept opens the pending approval card. The second
 * wait is a real Run that yielded on `send_session_message` with `waitAfterSend`.
 *
 * On the committed tree the target-level advance stops at the documented closure
 * seam (`planCandidates is not wired`, workflow.ts:1581, DR-P4-06); the local L
 * probe wires it, so the assertions below run against the real close-out there.
 */
import { afterAll, expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { parkedOnBasis, startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import {
  adoptPLPlanDraft, settlePLGoal, openPLWorkflowWorld, plSkeletonDraft, plStageTwoDraft, requestHeads,
  type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6AExtraBinding, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { createS6BLine, understandingPointer } from '../helpers/S6B1-fixture.js';
import { decisionQueueOf } from '../helpers/S7C-L2-world.js';
import { understandingNote } from '../helpers/S4C2-note-card-fixture.js';
import { checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { lineBinding } from '../helpers/PL-taskbook-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterAll(async () => { await opened?.close().catch(() => undefined); opened = null; });

/** The platform executor line: a resolved `executor` duty is what makes `hand_off` selectable. */
const EXECUTOR_ROLE = platformRoleProfile('executor').template;
const PL16_EXECUTOR: S6AExtraBinding = (() => {
  const base = lineBinding('pl-16-executor-binding', EXECUTOR_ROLE, 'PL-16 executor');
  return { ...base, binding: { ...base.binding,
    grant: { ...base.binding.grant, tools: ['read', 'record_note', 'hand_off', 'send_session_message'],
      platformDuty: 'executor' as const } } };
})();

it('PL-16: plan_only refinement coexists with a real handoff block and a wait_reply wait', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-16', extraBindings: [PL16_EXECUTOR],
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const world = workflow.world;
  const main = workflow.main;
  const goal = workflow.goal;
  const planDraft = plSkeletonDraft(goal, { label: 'pl-16', stageOneTaskIds: ['pl-a', 'pl-b', 'pl-c'] });
  planDraft.assignments = (planDraft.assignments ?? []).map(assignment =>
    ({ ...assignment, role: EXECUTOR_ROLE.templateId }));
  const plan = await adoptPLPlanDraft(main, goal, planDraft, 'pl-16');
  const tasks: TaskTriple[] = plan.tasks.map(task => ({ projectId: goal.projectId, goalId: goal.goalId,
    taskId: task.taskId }));
  await setS7AAutonomy(world, goal, 'every_step');
  const taskOf = (taskId: string) => tasks.find(task => task.taskId === taskId)!;

  const source: S6ASession = await sessionOf(world, await createS6BLine(main, {
    label: 'pl-16-source', role: EXECUTOR_ROLE, tasks: tasks.filter(task =>
      ['pl-a', 'pl-b', 'pl-c'].includes(task.taskId)),
  }));
  const recipient: S6ASession = await sessionOf(world, await createS6BLine(main, {
    label: 'pl-16-recipient', role: S6A_WORK_ROLE,
  }));

  // One real source Run: it writes the Goal's understanding and then calls the real
  // `hand_off` tool from that Run. Under `every_step` the short handoff is a card.
  const anchor = { kind: 'goal' as const, goalId: goal.goalId };
  const pointer = await understandingPointer(world, anchor);
  const draft = understandingNote({ anchor, topic: 'pl-16-understanding',
    conclusion: 'PL-16 source Run understands the handed task', structural: false,
    replaces: pointer.noteId === null ? [] : [pointer.noteId] });
  if (draft.kind !== 'understanding') throw new Error('PL-16: the note is not an understanding');
  await world.scripted.script(source, [
    { kind: 'calls', calls: [{ callId: 'pl-16-note', name: 'record_note', args: {
      op: 'write', kind: draft.kind, topic: draft.topic, conclusion: draft.conclusion, anchor: draft.anchor,
      sections: draft.sections, structural: draft.structural, replaces: draft.replaces,
      expectedPointerRevision: pointer.revision } }] },
    { kind: 'calls', calls: [{ callId: 'pl-16-handoff', name: 'hand_off', args: {
      source: { projectId: source.ref.projectId, sessionId: source.ref.sessionId },
      assignments: [{ target: { kind: 'existing',
        session: { projectId: recipient.ref.projectId, sessionId: recipient.ref.sessionId } },
        tasks: [{ ...taskOf('pl-b') }] }],
      reason: 'PL-16 real handoff block' } }] },
    { kind: 'text', text: 'PL-16 source answer' },
  ]);
  const handoffGate = await world.gates.toolCall(source, 'hand_off');
  const handoffDriving = (async () => {
    const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal,
      flowId: 'pl-16-handoff-run', sessionHint: source.ref, kind: 'select_work', taskId: 'pl-a' }, 'claim_task');
    return await driveWorkflow(world.ag2b, claim, {});
  })();
  try {
    await Promise.race([handoffGate.reached, handoffDriving.then(steps => {
      throw new Error(`PL-16: the source Run settled without calling hand_off: ${JSON.stringify(
        steps.map(step => step.reason))}`);
    })]);
  } finally {
    handoffGate.release();
  }
  await handoffDriving;

  // The real tool call produced the pending `handoff_approval` card; read its key
  // through the public decision queue instead of a hand-built caller.
  const handoffCard = async () => (await decisionQueueOf(world, goal,
    ['waiting_answer', 'answered_pending_application'])).waitingAnswer.find(
    card => card.source.kind === 'handoff_approval');
  await expect.poll(async () => (await handoffCard()) !== undefined,
    { timeout: 20_000, interval: 25 }).toBe(true);
  const card = await handoffCard();
  if (card === undefined) throw new Error('PL-16: the real hand_off produced no approval card');
  const cardKey = card.cardKey;

  // The separate ordinary wait: a real Run yields on its reply after send.
  await world.scripted.script(source, [
    { kind: 'calls', calls: [{ callId: 'pl-16-send', name: 'send_session_message', args: {
      recipient: recipient.ref, text: 'PL-16 please reply', intent: 'inquiry',
      needsReply: true, waitAfterSend: true } }] },
    { kind: 'text', text: 'PL-16 send answer' },
  ]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'pl-16-wait-reply',
    sessionHint: source.ref, kind: 'select_work', taskId: 'pl-c' }, {});
  const sourceFacts = ready<{ latestWork: { runRef: RunRef } | null }>(await world.post(
    'sessions/facts', { scope: { ...S6A_SCOPE }, input: source.ref }), 'sessions/facts');
  if (sourceFacts.latestWork === null) throw new Error('PL-16: the waiting Run has no claim');
  const waitingRun = ready<{ run: { status: string; continuation?: { kind: string } } }>(
    await world.post('executions/read', { scope: { ...S6A_SCOPE }, input: sourceFacts.latestWork.runRef }),
    'executions/read');
  expect(waitingRun.run.status).toBe('ended');
  expect(waitingRun.run.continuation?.kind).toBe('wait_reply');

  // The later stage still carries exactly the required `plan_only` placeholder.
  const graph = ready<{ tasks: Array<Record<string, unknown>> }>(await main.route('tasks/query', {
    goalRef: goal,
  }), 'tasks/query');
  const placeholder = graph.tasks.find(task => (task['ref'] as { taskId?: string }).taskId
    === 'pl-placeholder-pl-stage-2');
  expect(placeholder).toMatchObject({ effectivePhase: 'pending' });
  expect(placeholder?.['definition']).toMatchObject({ executionIntent: 'plan_only' });

  // The refinement has a real adviser line, and a candidate sits on its card: under `every_step`
  // with no review line, the candidate branch of the wait is a card, not an in-flight round.
  const adviser = await createPLAdviserLine(world, 'pl-16-adviser');
  await world.scripted.script(adviser, [{ kind: 'text', text: 'PL-16 refine answer' }]);
  const proposed = (await main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: plan.ref, draft: plStageTwoDraft(plan, goal, 'pl-16'),
    reason: { text: 'PL-16 stage 2 candidate', sources: [], affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
  }, 'pl-16-propose'))) as { status: string };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');

  // The common close-out: the real handoff block, the wait_reply and `plan_only:` all survive.
  const body = await settlePLGoal(world, goal, 'pl-16-goal') as {
    status: string; value?: { state: string; waitBasis?: { reasons: string[]; recordKinds: string[] } };
  };
  expect(body.status, JSON.stringify(body)).toBe('ready');
  const reasons = body.value?.waitBasis?.reasons ?? [];
  expect(reasons).toContain(`handoff_approval:${cardKey}`);
  expect(reasons).toContain('wait_reply');
  expect(reasons).toContain('plan_only:pl-stage-2');
  expect(reasons.some(reason => reason.startsWith('l46_blocked:'))).toBe(false);
  expect(body.value?.waitBasis?.recordKinds).toContain('SessionMessage');

  // The refinement really went out beside the block and the two waits, not only as a wait label.
  expect(await requestHeads(workflow, adviser)).toEqual(
    [`refine:${goal.goalId}:pl-stage-2:${String(plan.planRevision)}`]);

  // The exact sets: the ordinary wait's own reasons and kinds plus the four branches, no new branch or record.
  const exactReasons = ['plan_adoption', 'plan_change', 'task_claimable', 'formal_check', 'evidence',
    `handoff_approval:${cardKey}`, 'wait_reply', 'plan_candidate_waiting', 'plan_only:pl-stage-2'].sort();
  const exactKinds = ['PlanRevision', 'PlanProposal', 'Run', 'TaskLease', 'DispatchOutboxEntry', 'VerificationRound',
    'Evidence', 'TaskEvidenceIndex', 'SessionMessage', 'CoreOperation', 'Goal', 'Session', 'TaskRequeue'].sort();
  expect([...reasons].sort()).toEqual(exactReasons);
  expect([...(body.value?.waitBasis?.recordKinds ?? [])].sort()).toEqual(exactKinds);

  // The registered driver keeps the same merged wake basis: `workflow/driver-read` drops no branch.
  await startGoalDriver(world, goal, 'pl-16-driver');
  const parked = await waitDriver(world, goal, undefined, parkedOnBasis, 'PL-16: the driver parks on the basis');
  expect(parked.state).toBe('waiting_for_reply');
  const driven = parked.last?.status === 'ready' ? parked.last.value.waitBasis : undefined;
  expect([...(driven?.reasons ?? [])].sort()).toEqual(exactReasons);
  expect([...(driven?.recordKinds ?? [])].sort()).toEqual(exactKinds);
});
