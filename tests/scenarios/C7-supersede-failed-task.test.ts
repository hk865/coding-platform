/**
 * A.2 step 6, scenario C7-supersede-failed-task (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * C7-supersede-failed-task; C7 (U-12), §3.3 PLAN-05 with TASK-19 guards 1–8 and guard 9 (LA-3), §4 TASK-19,
 * AV-1, AV-8, §2 GOAL-25/GOAL-27/GOAL-30, §9 VD-11 (L-15), §11.3 I-3, §11.18 I-21, §11.19 I-22).
 *
 * 1. Main path, twice (the adopter is the coordinator's Agent, or the operator over `plans/apply` with the
 *    Agent's candidate: the Host's route layer, `createWorkbenchServer` with `createPlatformCoreRouteBindings`,
 *    served on the PlanBoard root, whose grant holds the Agent's W2 tools; the AG2b Host's grant has none, so
 *    its Agent could not propose): T's registered check FAILs, the Workflow requeues it automatically up to the cap
 *    (1 here) and stops it (`stopped/auto_rework_cap_reached`), the Goal is NEEDS_DECISION. A coordinator
 *    Task's running Run proposes P2 (T superseded → T2; T2 a new required carrier of T's obligation; T kept
 *    in its taskIds; `affectedTaskIds: [T]`). Once adopted the Goal leaves NEEDS_DECISION, the Workflow
 *    selects T2 (never T), T2 passes, the gate passes and the Goal completes. T's Runs and rounds are still
 *    listed; T's row shows `failed/check_failed` beside `superseded → T2`; I-3, I-21 and I-22 hold.
 * 2. The human-stopped variant (moved case): only the operator supersedes a Task a person cancelled
 *    (guards 6, 7, 9), and the Workflow completes the Goal with the replacement.
 *
 * Moved here (A.2 step 6, user decision 31), assertions kept: case 2 is
 * tests/composition/A2-disposition-change-platform.test.ts:283 (that file's other case moved to
 * C7-defer-reactivate; the file is deleted); its environment is tests/scenarios/support/plan.ts `c7Case`.
 * Added to it: the §11 invariants after every Workflow step and every owner write.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_GATE_TASK_ID, AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite,
} from '../helpers/AG2b-collaboration-fixture.js';
import { checkI21NonActiveTaskQuiescent, checkI22TracedBasisFrozen, checkI3GoalCompletionBacked } from '../state/invariants.js';
import { cleanupScenarios, SCENARIO_OPERATOR } from './harness.js';
import { PlanBoard, cleanupCommon, toolOutputJson } from './support/common.js';
import { agentActorOf, c7Case, cleanupPlan, committedOf, planAcceptedEventsIn, workTask } from './support/plan.js';

const {
  operator, goalRef, GATE, TASK, OBLIGATION, ctx, automation, work, openEnvironment, select, performs, drive, taskRow, goalDisplay, readRun, nextDraft, propose, apply, proposed, activePlanRef, withDisposition, check,
} = c7Case;

afterEach(async () => {
  await cleanupPlan();
  await cleanupCommon();
  await cleanupScenarios();
});

const T = AG2B_WORK_TASK_ID;
const COORDINATOR = 'ag2b-coordinator';
const T2 = 'ag2b-work-2';
const CAP_ONE = { schemaVersion: 1 as const, autoReworkLimit: 1, resumeOnStartup: true };

it.each([['agent'], ['operator']] as const)('C7 main path (adopter: %s): T fails to the cap, a coordinator\'s Run proposes T superseded by T2, the Workflow runs T2 and the Goal completes; T keeps its history; I-3, I-21, I-22 hold', async (adopter) => {
  const proposeCall = { callId: 'c7-propose', name: 'propose_future_plan', args: {} as Record<string, unknown> };
  const applyCall = { callId: 'c7-apply', name: 'apply_future_plan', args: {} as Record<string, unknown> };
  const coordinatorReplies: ScriptedReply[] = adopter === 'agent'
    ? [{ kind: 'calls', calls: [proposeCall] }, { kind: 'calls', calls: [applyCall] }, { kind: 'text', text: 'C7: T is replaced by T2' }]
    : [{ kind: 'calls', calls: [proposeCall] }, { kind: 'text', text: 'C7: a replacement of T is proposed' }];
  const replies: ScriptedReply[] = [
    { kind: 'text', text: 'C7: attempt 1 leaves the result file missing' },
    { kind: 'text', text: 'C7: attempt 2 leaves it missing again' },
    ...coordinatorReplies,
    { kind: 'calls', calls: [{ callId: 'c7-t2-edit', name: 'edit', args: { mode: 'create', path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
    { kind: 'text', text: 'C7: T2 wrote the result' },
  ];
  const seen: { propose?: unknown; apply?: unknown; coordinatorRun?: RunRef } = {};
  let board!: PlanBoard;
  board = await PlanBoard.open({ workIds: [T, COORDINATOR], check: 'result_file', automation: CAP_ONE, replies,
    duringReply: async (index, request) => {
      if (index === 2) {
        // The coordinator's Run is in the Kernel: it proposes P2 (T superseded by T2, a new carrier of T's obligation).
        const run = (await board.taskRow(COORDINATOR)).execution;
        if (run !== null) seen.coordinatorRun = run;
        const next = await board.nextDraft('ag2b-plan-c7-p2', draft => ({ ...draft,
          tasks: draft.tasks.flatMap(task => task.taskId === T
            ? [{ ...task, disposition: 'superseded' as const, replacedByTaskId: T2 }, workTask(T2, 'Replace the failing work')] : [task]),
          assignments: [...(draft.assignments ?? []), { taskId: T2, role: 'builder', instruction: 'Write the AG2b result another way' }],
          obligations: draft.obligations.map(obligation => obligation.taskIds.includes(T)
            ? { ...obligation, taskIds: [...obligation.taskIds, T2] } : obligation) }));
        Object.assign(proposeCall.args, { basedOn: next.source.ref, draft: next.draft,
          reason: { text: 'C7: T keeps failing; T2 replaces it', sources: [], affectedTaskIds: [T] }, expected: [] });
      }
      if (index === 3) {
        await board.check('candidate proposed by the coordinator\'s Run');
        seen.propose = toolOutputJson(request, 'c7-propose');
        const proposal = seen.propose as { status?: string; value?: { ref: PlanProposalRef; revision: number } };
        if (proposal.status !== 'committed' || proposal.value === undefined) throw new Error(`propose: ${JSON.stringify(proposal)}`);
        if (adopter === 'agent') {
          Object.assign(applyCall.args, { proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, expected: [] });
        }
      }
      if (index === 4 && adopter === 'agent') {
        seen.apply = toolOutputJson(request, 'c7-apply');
        if (seen.coordinatorRun === undefined) throw new Error('the coordinator Run must be known');
        await board.check('P2 adopted by the coordinator\'s Run', { kind: 'plan_adopted', actor: agentActorOf(seen.coordinatorRun) });
      }
    } });
  const p1 = (await board.graph()).plan;

  // T's check FAILs twice: one automatic requeue (cap 1), then the verdict stops it and the Goal needs a decision.
  const failing = await board.advance(board.select('c7-t', T));
  expect(failing).toMatchObject({ state: 'waiting', reason: `the selected Task ${T} is not executable right now` });
  expect(failing.performed.filter(step => step.receipt.kind === 'finalize_checks')
    .map(step => step.receipt.result.status === 'committed' ? (step.receipt.result.value as { outcome: string }).outcome : null))
    .toEqual(['FAIL', 'FAIL']);
  expect(committedOf(failing.receipts, 'requeue_task')).toMatchObject({ kind: 'requeued', requeue: { failureClass: 'check_failed',
    requestedBy: WORKFLOW_AUTOMATION_ACTOR, automation: { automatic: true, counted: true, autoCount: 1 } } });
  const stopped = await board.taskRow(T);
  expect(stopped).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' }, disposition: 'active',
    failure: { automation: { verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached' } } } });
  const run2Ref = stopped.execution;
  if (run2Ref === null) throw new Error('T must have a selected Run');
  expect(await board.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'auto_rework_cap_reached', taskId: T } });
  expect(board.scripted.calls()).toBe(2);
  expect(board.target.lastWorld?.requeues).toHaveLength(1);

  // The coordinator's Run proposes P2 (and, as the Agent, adopts it); it stops before its own round opens.
  const coordinated = await board.advance(board.select('c7-coordinator', COORDINATOR), performs('open_checks'));
  expect(coordinated.next).not.toBeNull();
  expect(seen.propose).toMatchObject({ status: 'committed', value: { ref: { aggregateType: 'PlanProposal' } } });
  const candidate = (seen.propose as { value: { ref: PlanProposalRef; revision: number } }).value;
  if (adopter === 'agent') {
    expect(seen.apply, 'the Agent adopts its own candidate (TASK-19 as class agent: T is not fenced)')
      .toMatchObject({ status: 'committed', value: { planRevision: p1.planRevision + 1 } });
  } else {
    // The candidate waits for a person; T's stop still decides the Goal (GOAL-30 before CHANGE_PENDING).
    expect(await board.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', cause: { code: 'auto_rework_cap_reached', taskId: T } });
    // A person adopts it over `plans/apply`: the Host's route layer on this root builds the operator's call context.
    const applied = await board.route('plans/apply', graphWrite(AG2B_SCOPE,
      { proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [] }, 'c7-operator-apply'));
    expect(applied).toMatchObject({ status: 'committed', value: { planRevision: p1.planRevision + 1 } });
    await board.check('P2 adopted by the operator over plans/apply', { kind: 'plan_adopted', actor: { ...SCENARIO_OPERATOR } });
  }
  const p2 = (await board.graph()).plan;
  if (p2.schemaVersion !== 2) throw new Error('P2 is a v2 Plan');
  expect(p2.planRevision).toBe(p1.planRevision + 1);
  // TASK-19: T keeps its source definition; only the disposition and the replacement change; the basis is inherited.
  const sourceT = p1.tasks.find(task => task.taskId === T);
  expect(p2.tasks.find(task => task.taskId === T)).toEqual({ ...sourceT, disposition: 'superseded', replacedByTaskId: T2 });
  expect(p2.obligations.find(obligation => obligation.obligationId === 'ag2b-obligation')?.taskIds)
    .toEqual(expect.arrayContaining([T, T2, COORDINATOR, AG2B_GATE_TASK_ID]));
  expect(p2.taskStateBasis?.entries).toEqual(expect.arrayContaining([{ taskId: T, planRef: p1.ref }, { taskId: T2, planRef: p2.ref }]));
  const actor = adopter === 'agent' ? { kind: 'agent', runRef: seen.coordinatorRun } : SCENARIO_OPERATOR;
  expect(p2.dispositionRecord?.entries).toEqual([expect.objectContaining({ taskId: T, from: 'active', to: 'superseded',
    replacedByTaskId: T2, traced: true, setIn: p2.ref, proposalRef: candidate.ref, reason: expect.objectContaining({ affectedTaskIds: [T] }),
    actor: expect.objectContaining(actor) })]);
  // The adoption event carries the same adopter (`PlanRevisionAccepted.actor`, plan-commit-compiler.ts:182).
  expect(planAcceptedEventsIn(board.database).filter(event => event.aggregateId === p2.ref.planId))
    .toEqual([{ aggregateId: p2.ref.planId, actor: expect.objectContaining(actor) }]);
  // The Goal leaves NEEDS_DECISION: no Run is running, T carries no work any more (AV-1), T2 can be claimed.
  const leaving = await board.goalDisplay();
  expect(leaving.phase).toBe('RUNNING');
  expect(leaving.causes.map(cause => cause.code)).not.toContain('auto_rework_cap_reached');
  expect(await board.taskRow(T)).toMatchObject({ disposition: 'superseded', failure: { automation: { verdict: { kind: 'none' } } } });

  // The Workflow selects T2 (never T), T2 writes the result and passes; the coordinator's round and the gate pass.
  const finished = await board.advance(board.select('c7-goal'));
  expect(finished.state).toBe('completed');
  const claimed = finished.performed.filter(step => step.operation.kind === 'claim_task')
    .map(step => step.operation.kind === 'claim_task' ? step.operation.request.input.taskId : null);
  expect(claimed).toEqual([T2]);
  expect(finished.receipts.map(receipt => receipt.kind)).not.toContain('requeue_task');
  expect(await board.taskRow(T2)).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await board.taskRow(COORDINATOR)).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await board.taskRow(AG2B_GATE_TASK_ID)).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await board.goalDisplay()).toMatchObject({ phase: 'COMPLETED' });
  expect(board.phases).not.toContain('FAILED');
  expect(board.target.lastWorld?.requeues, 'T was never requeued again').toHaveLength(1);
  expect(board.scripted.calls()).toBe(adopter === 'agent' ? 7 : 6);

  // T's Runs and rounds are still there; its row shows its failure beside the new disposition.
  const listed = await board.platform.executions.listExecutions!(board.ctx(), { goalRef: AG2B_GOAL_REF, taskId: T,
    page: { afterCursor: null, limit: 10 } });
  if (listed.status !== 'ready') throw new Error(`T's Runs must be listed: ${JSON.stringify(listed)}`);
  expect(listed.value.items.map(item => item.run)).toEqual([
    expect.objectContaining({ status: 'ended', outcome: 'completed', planRef: p1.ref }),
    expect.objectContaining({ status: 'ended', outcome: 'completed', planRef: p1.ref })]);
  expect(listed.value.items.map(item => item.run.ref.runId)).toContain(run2Ref.runId);
  for (const item of listed.value.items) {
    const head = await board.platform.evidence.queryRoundChainHead!(board.ctx(), { subject: item.run.task, subjectRunRef: item.run.ref });
    expect(head, `the round of ${item.run.ref.runId}`).toMatchObject({ status: 'ready', value: { status: 'finalized', outcome: 'FAIL' } });
  }
  expect(await board.taskRow(T)).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' }, execution: run2Ref,
    disposition: 'superseded', definition: { replacedByTaskId: T2 },
    dispositionChange: { taskId: T, from: 'active', to: 'superseded', replacedByTaskId: T2, setIn: p2.ref } });

  // I-3, I-21 and I-22 on the final world, each with its subject present (not vacuously true).
  const world = board.target.lastWorld;
  if (world === undefined) throw new Error('the invariants must have read the world');
  expect(world.goalPhases).toEqual([expect.objectContaining({ phase: 'COMPLETED', planRef: p2.ref })]);
  expect(world.runs.filter(run => run.task.taskId === T).map(run => run.planRef)).toEqual([p1.ref, p1.ref]);
  expect(world.leases.find(lease => lease.ref.taskId === T)?.release).toBeDefined();
  expect(checkI3GoalCompletionBacked(world)).toEqual([]);
  expect(checkI21NonActiveTaskQuiescent(world)).toEqual([]);
  expect(checkI22TracedBasisFrozen(world)).toEqual([]);
}, 150_000);

// Moved from tests/composition/A2-disposition-change-platform.test.ts:283 (05125db).
it('C7 supersede (TASK-19, guards 6, 7, 9): only the operator supersedes a human-stopped Task; the Workflow skips it and completes the Goal with its replacement', async () => {
  const { platform, scripted, workspaceRoot } = await openEnvironment(1);

  // work-1 is claimed, then the operator cancels its Run before it enters (D-7): a human stop.
  const claimed = await drive(platform, select('a2-disposition-claim'), performs('prepare'));
  expect(claimed.stoppedBefore).toBe(true);
  const claim = claimed.receipts.find(receipt => receipt.kind === 'claim_task');
  if (claim?.kind !== 'claim_task' || claim.result.status !== 'committed') throw new Error('work-1 must be claimed');
  const run1Ref = claim.result.value.runRef;
  const claimedRun = await readRun(platform, run1Ref);
  const cancelled = await platform.controls.submitControl(ctx(), { input: { runRef: run1Ref, kind: 'cancel', reason: 'not this way' },
    meta: { requestId: 'a2-disposition-cancel', expected: [{ ref: run1Ref, revision: claimedRun.run.revision }] } });
  expect(cancelled).toMatchObject({ status: 'committed', value: { intent: { status: 'applied' } } });
  await check(platform, 'work-1 cancelled before it entered', { kind: 'other', actor: { ...operator } });   // A.2 step 6
  const stopped = await taskRow(platform, 'work-1');
  expect(stopped).toMatchObject({ effectivePhase: 'failed', disposition: 'active', execution: run1Ref,
    failure: { failureClass: 'cancelled', automation: { verdict: { kind: 'stopped', reason: 'task_cancelled' } } } });
  const runBefore = await readRun(platform, run1Ref);

  // Recording refuses a compiler-owned dispositionRecord and a malformed affectedTaskIds (§3.4), zero writes.
  const supersede = await nextDraft(platform, 'a2-disposition-plan-2', draft => ({ ...draft,
    tasks: [...withDisposition(draft.tasks, 'work-1', { disposition: 'superseded', replacedByTaskId: 'work-2' }),
      work('work-2', 'The replacement work')],
    assignments: [...(draft.assignments ?? []), { taskId: 'work-2', role: 'builder', instruction: 'Do the work another way' }],
    obligations: [{ ...OBLIGATION, taskIds: ['work-1', GATE, 'work-2'] }] }));
  const why = { text: 'work-1 was stopped; work-2 replaces it', sources: [] };
  expect(await propose(platform, 'a2-disposition-record', supersede.source,
    { ...supersede.draft, dispositionRecord: { schemaVersion: 1, entries: [] } } as unknown as PlanRevisionDraft, why))
    .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'the draft carries dispositionRecord, which only the adoption compiler writes' });
  expect(await propose(platform, 'a2-disposition-unknown-id', supersede.source, supersede.draft, { ...why, affectedTaskIds: ['work-9'] }))
    .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'reason.affectedTaskIds names work-9, which is not a task of the draft' });

  // TASK-19 guard 7: the platform automation may not supersede what a human stopped.
  const listed = await proposed(platform, 'a2-disposition-supersede', supersede.source, supersede.draft,
    { ...why, affectedTaskIds: ['work-1'] }, automation());
  expect(await apply(platform, 'a2-disposition-supersede-auto', listed, automation())).toMatchObject({ status: 'rejected',
    code: 'forbidden', reason: 'only an operator may change the disposition of task work-1: a human paused or cancelled it' });
  // Guard 9 (LA-3): nor keep it and add a parallel carrier to its obligation.
  const parallel = await nextDraft(platform, 'a2-disposition-plan-2p', draft => ({ ...draft,
    tasks: [...draft.tasks, work('work-2', 'A parallel carrier')],
    assignments: [...(draft.assignments ?? []), { taskId: 'work-2', role: 'builder', instruction: 'Do the work in parallel' }],
    obligations: [{ ...OBLIGATION, taskIds: ['work-1', GATE, 'work-2'] }] }));
  const parallelCandidate = await proposed(platform, 'a2-disposition-parallel', parallel.source, parallel.draft,
    { text: 'add a parallel carrier', sources: [] }, automation());
  expect(await apply(platform, 'a2-disposition-parallel-auto', parallelCandidate, automation())).toMatchObject({ status: 'rejected',
    code: 'forbidden', reason: 'obligation a2-disposition-obligation: a human stopped this work; only an operator may add the parallel carrier work-2' });
  // TASK-19 guard 6: an operator adoption still needs the traced Task in reason.affectedTaskIds.
  const unlisted = await proposed(platform, 'a2-disposition-unlisted', supersede.source, supersede.draft, why);
  expect(await apply(platform, 'a2-disposition-unlisted-apply', unlisted)).toMatchObject({ status: 'rejected', code: 'invalid',
    reason: 'reason.affectedTaskIds must list traced task work-1' });
  expect(await activePlanRef(platform)).toEqual(supersede.source.ref);

  // The operator adopts the listed candidate (an operator is not fenced, LA-3, hard limit 3).
  const adopted = await apply(platform, 'a2-disposition-supersede-apply', listed);
  if (adopted.status !== 'committed') throw new Error(`the operator adoption must commit: ${JSON.stringify(adopted)}`);
  const p2 = adopted.value;
  if (p2.schemaVersion !== 2) throw new Error('the adopted Plan is a v2 Plan');
  const sourceWork1 = supersede.source.tasks.find(task => task.taskId === 'work-1')!;
  expect(p2.tasks.find(task => task.taskId === 'work-1')).toEqual({ ...sourceWork1, disposition: 'superseded', replacedByTaskId: 'work-2' });
  // The basis is inherited (only the disposition changed); the new Task points at the new Plan.
  expect(p2.taskStateBasis?.entries).toEqual(expect.arrayContaining([{ taskId: 'work-1', planRef: supersede.source.ref },
    { taskId: 'work-2', planRef: p2.ref }]));
  const entry = { taskId: 'work-1', from: 'active', to: 'superseded', replacedByTaskId: 'work-2', traced: true, setIn: p2.ref,
    proposalRef: listed.ref, reason: { ...why, affectedTaskIds: ['work-1'] }, actor: operator };
  expect(p2.dispositionRecord).toEqual({ schemaVersion: 1, entries: [entry] });
  // The Task row: the same phase and Run, the new disposition beside it; the automation verdict is none (AV-1).
  const superseded = await taskRow(platform, 'work-1');
  expect(superseded).toMatchObject({ effectivePhase: 'failed', phaseCause: stopped.phaseCause, execution: run1Ref,
    disposition: 'superseded', dispositionChange: entry, failure: { automation: { verdict: { kind: 'none' } } } });
  expect(superseded.eligibility.reasons.map(reason => reason.code)).toContain('task_not_active');
  // The old execution records are untouched; the previous Plan still reads work-1 active.
  const recordsOf = ({ run, attempt, outbox, session, lease }: Awaited<ReturnType<typeof readRun>>) => ({ run, attempt, outbox, session, lease });
  expect(recordsOf(await readRun(platform, run1Ref))).toEqual(recordsOf(runBefore));
  const p1Graph = await platform.plans.queryTaskGraph(ctx(), { goalRef, planRef: supersede.source.ref });
  expect(p1Graph.status === 'ready' ? p1Graph.value.tasks.find(row => row.ref.taskId === 'work-1') : null)
    .toMatchObject({ disposition: 'active' });
  // §3.3 point 2, W16 first: a requeue after the adoption reads work-1 superseded: TASK-16 refuses it
  // (`invalid`, task_not_active) and nothing is written.
  const goalAfterAdoption = await platform.plans.queryGoal(ctx(), goalRef);
  if (goalAfterAdoption.status !== 'ready') throw new Error('the Goal must be readable');
  expect(await platform.claims.requeueTask!(ctx(), { meta: { requestId: 'a2-disposition-requeue-superseded',
    expected: [{ ref: goalRef, revision: goalAfterAdoption.value.goal.revision }, { ref: run1Ref, revision: runBefore.run.revision }] },
    input: { taskRef: TASK, afterRunRef: run1Ref, reason: 'try it again' } }))
    .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'task_not_active: the task disposition is superseded' });
  await check(platform, 'requeue of the superseded Task refused');   // A.2 step 6
  expect(recordsOf(await readRun(platform, run1Ref))).toEqual(recordsOf(runBefore));
  // A stopped, superseded Task gives the Goal no reason: it is RUNNING with work-2 to do.
  const running = await goalDisplay(platform);
  expect(running.phase).toBe('RUNNING');
  expect(running.causes.map(cause => cause.code)).not.toContain('task_cancelled');

  // The Workflow skips work-1 (no run, no wait), runs work-2 and completes the Goal.
  await writeFile(join(workspaceRoot, 'fixed.txt'), 'fixed\n');
  const finished = await drive(platform, select('a2-disposition-finish'));
  expect(finished.state).toBe('completed');
  const claims = finished.receipts.filter(receipt => receipt.kind === 'claim_task');
  expect(claims.map(receipt => receipt.kind === 'claim_task' && receipt.result.status === 'committed'
    ? receipt.result.value.runRef.runId : null)).toHaveLength(1);
  expect(await taskRow(platform, 'work-2')).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'failed', disposition: 'superseded' });
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'COMPLETED' });
  // One model call: work-1's Run never entered.
  expect(scripted.requests).toHaveLength(1);
});
