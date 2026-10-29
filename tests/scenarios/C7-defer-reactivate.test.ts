/**
 * A.2 step 6, scenario C7-defer-reactivate (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * C7-defer-reactivate; C7, §3.3 PLAN-05 point 2 and the TASK-19 guards, §3.6 PLAN-05 (S15, the races,
 * `R3e-evidence-coverage`), §4 TASK-16/TASK-19, TD-3, §2 GOAL-30 `required_task_deferred`, §9 VD-11
 * (L-15), §13.4 #26, §11.18 I-21, §11.19 I-22; the 5.10 items owed to step 6).
 *
 * 1. The row (moved case): T's required obligation is carried by the gate too; the requeued T is deferred →
 *    the Workflow skips it, the Goal is NEEDS_DECISION/`required_task_deferred`; reactivated, the Workflow
 *    claims it with the stored `requeueRef`; the same failure with no new input is refused again (#26).
 * 2. The owed sequential interleavings on the same platform (§3.6 PLAN-05, in both orders):
 *    TASK-19 first → a requeue is `invalid` (task_not_active); a requeue first → TASK-19 commits and leaves
 *    a non-active Task with its TaskRequeue (I-21 allows it); S15: a direct claim with the stored
 *    `requeueRef` while deferred is `invalid`, and succeeds once reactivated; a requeue claim first →
 *    TASK-19 is `busy` (guard 1). R3e-evidence-coverage: the failed round's evidence, and the same evidence
 *    anchored on the deferred version, are APPLICABLE on the reactivated version (a definition change would
 *    not be).
 * 3. The races proper (§3.6 PLAN-05 "竞争", the commit barrier of
 *    tests/composition/W1-future-plan-platform.test.ts:280-341: the interrupted owner over a second record
 *    backend on the same ledger, the other writer through the platform in its read→commit window):
 *    a cancel of the selected Run inside TASK-19's window is refused (`busy`) and TASK-19 commits;
 *    TASK-19 vs a requeue: W16 inside the requeue's window → the requeue `revision_conflict`, retried
 *    `invalid`; the requeue inside W16's window → W16 commits over the TaskRequeue; TASK-19 vs the requeue
 *    claim: TASK-19 inside the claim's window → the claim `revision_conflict`, retried `invalid`; the claim
 *    inside TASK-19's window → TASK-19 `revision_conflict`, retried `busy`.
 * 4. TASK-19 guards 3 and 7 against the selected Run's control (Host): TASK-19 inside the window of the
 *    operator's cancel of a yielded, unconsumed wait reads the wait open and is `busy` (guard 3) for the
 *    operator and the automation alike; once the cancel commits, guard 7 refuses the automation's deferral
 *    (`forbidden`) and the operator's commits.
 * 5. Q10's reachable form: the selected Run's pointer ControlIntent moves inside TASK-19's window (the restart
 *    settles a queued pause left on the ended Run, CTL-08(e)): TASK-19 is refused `revision_conflict` and writes
 *    nothing; retried, guard 7 still fences the automation and the operator defers.
 *
 * Not reachable (NOTES): TASK-19 guard 2b (on clean data every quarantined or unresolved reconciliation and
 * every unknown entry authorization comes with `outcome_unknown`, which guard 2 refuses first), and a
 * `submitControl` committing inside TASK-19's window (Q10: the guards admit only a Run that takes no control).
 *
 * Moved here (A.2 step 6, user decision 31), assertions kept: case 1 is
 * tests/composition/A2-disposition-change-platform.test.ts:386 (the file is deleted); its environment is
 * tests/scenarios/support/plan.ts `c7Case`. Added to it: the §11 invariants after every step and write.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import type { ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { evidenceApplicabilityWithBasis } from '../../src/core/work-graph/tasks/evidence-coverage.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite,
} from '../helpers/AG2b-collaboration-fixture.js';
import { readControl, submitControl } from '../helpers/A2-restart-fixture.js';
import {
  assertInvariants, cleanupScenarios, eventTypesIn, hostCtx, openHostScenario, SCENARIO_OPERATOR, type HostScenario,
  type ScenarioCounts,
} from './harness.js';
import { draftFrom, execution, lockLedgerAfter, openWorkRoot, preparedOf } from './support/common.js';
import { c7Case, cleanupPlan, hostGraph, raceWindow, type RaceWindow, type RaceWriter } from './support/plan.js';

const {
  operator, goalRef, TASK, ctx, openEnvironment, select, performs, drive, graph, taskRow, goalDisplay, readRun, nextDraft, apply,
  proposed, activePlanRef, withDisposition, check,
} = c7Case;

afterEach(async () => {
  await cleanupPlan();
  await cleanupScenarios();
});

// Moved from tests/composition/A2-disposition-change-platform.test.ts:386 (05125db).
it('C7 defer and reactivate (TASK-19 from P4, L-15, GOAL-30, #26): a deferred requeued Task waits, is claimed with its requeueRef once active, and the same failure is still no new basis', async () => {
  const { platform, scripted } = await openEnvironment(2);

  // Run 1 completes and its check FAILs; the operator requeues (P4).
  const first = await drive(platform, select('a2-disposition-run-1', 'work-1'), performs('requeue_task'));
  expect(first.stoppedBefore).toBe(true);
  const failed = await taskRow(platform, 'work-1');
  expect(failed).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' } });
  const run1Ref = failed.execution;
  if (run1Ref === null) throw new Error('work-1 must have a selected Run');
  const requeue = async (requestId: string, afterRunRef: RunRef) => {
    const goal = await platform.plans.queryGoal(ctx(), goalRef);
    if (goal.status !== 'ready') throw new Error('the Goal must be readable');
    const afterRun = await readRun(platform, afterRunRef);
    const result = await platform.claims.requeueTask!(ctx(), { meta: { requestId, expected: [{ ref: goalRef, revision: goal.value.goal.revision },
      { ref: afterRunRef, revision: afterRun.run.revision }] },
      input: { taskRef: TASK, afterRunRef, reason: 'the registered check failed; try again' } });
    // A.2 step 6: the §11 invariants after the owner write (a committed refusal is the refusal step).
    await check(platform, `${requestId} (${result.status})`, result.status !== 'committed' ? undefined
      : { kind: result.value.kind === 'refused' ? 'task_rework_refused' : 'task_requeued', actor: { ...operator } });
    return result;
  };
  const requeued = await requeue('a2-disposition-requeue-1', run1Ref);
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue 1: ${JSON.stringify(requeued)}`);
  const requeueRef = requeued.value.requeue.ref;
  const p1 = (await graph(platform)).plan;

  // The operator defers it (TASK-19 from P4); an adoption that does not list it is refused first (guard 6).
  const defer = await nextDraft(platform, 'a2-disposition-plan-2', draft => ({ ...draft,
    tasks: withDisposition(draft.tasks, 'work-1', { disposition: 'deferred' }) }));
  const unlisted = await proposed(platform, 'a2-disposition-defer-unlisted', defer.source, defer.draft,
    { text: 'not now', sources: [] });
  expect(await apply(platform, 'a2-disposition-defer-unlisted-apply', unlisted)).toMatchObject({ status: 'rejected',
    code: 'invalid', reason: 'reason.affectedTaskIds must list traced task work-1' });
  const deferral = await proposed(platform, 'a2-disposition-defer', defer.source, defer.draft,
    { text: 'not now', sources: [], affectedTaskIds: ['work-1'] });
  const deferred = await apply(platform, 'a2-disposition-defer-apply', deferral);
  if (deferred.status !== 'committed' || deferred.value.schemaVersion !== 2) throw new Error(`defer: ${JSON.stringify(deferred)}`);
  expect(deferred.value.taskStateBasis?.entries).toContainEqual({ taskId: 'work-1', planRef: p1.ref });
  const waiting = await taskRow(platform, 'work-1');
  expect(waiting).toMatchObject({ effectivePhase: 'pending', phaseCause: { code: 'requeued' }, requeueRef,
    disposition: 'deferred', dispositionChange: { taskId: 'work-1', from: 'active', to: 'deferred', traced: true,
      setIn: deferred.value.ref, actor: operator } });
  expect(waiting.eligibility.reasons.map(reason => reason.code)).toContain('task_not_active');
  if (waiting.failure !== undefined) expect(waiting.failure.automation.verdict).toEqual({ kind: 'none' });

  // L-15: the Workflow skips it; the Goal level waits on the deferred required work, the Task handle is not active.
  const goalLevel = await drive(platform, select('a2-disposition-goal-level'));
  expect(goalLevel.state).toBe('waiting');
  expect(goalLevel.reason).toMatch(/^required_task_deferred: required work cannot advance: work-1: deferred/);
  const handle = await drive(platform, select('a2-disposition-handle', 'work-1'));
  expect(handle).toMatchObject({ state: 'waiting', receipts: [] });
  expect(handle.reason).toMatch(/^task_not_active: the selected Task work-1 is deferred/);
  // GOAL-30: required work is deferred and nothing required is left to run.
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'required_task_deferred', taskIds: ['work-1'] } });
  expect(scripted.requests).toHaveLength(1);
  // A.2 step 6 (I-21): the deferred Task keeps its TaskRequeue and ended Run, and holds no Lease.
  await check(platform, 'deferred with a requeue');
  const deferredWorld = c7Case.targetOf(platform).lastWorld;
  expect(deferredWorld?.requeues.map(record => record.ref)).toEqual([requeueRef]);
  expect(deferredWorld?.leases.find(lease => lease.ref.taskId === 'work-1')?.release).toBeDefined();

  // The operator reactivates it: the record keeps the latest change, the basis is still the first Plan.
  const reactivate = await nextDraft(platform, 'a2-disposition-plan-3', draft => ({ ...draft,
    tasks: withDisposition(draft.tasks, 'work-1', { disposition: 'active' }) }));
  const reactivation = await proposed(platform, 'a2-disposition-reactivate', reactivate.source, reactivate.draft,
    { text: 'now', sources: [], affectedTaskIds: ['work-1'] });
  const reactivated = await apply(platform, 'a2-disposition-reactivate-apply', reactivation);
  if (reactivated.status !== 'committed' || reactivated.value.schemaVersion !== 2) throw new Error(`reactivate: ${JSON.stringify(reactivated)}`);
  expect(reactivated.value.taskStateBasis?.entries).toContainEqual({ taskId: 'work-1', planRef: p1.ref });
  expect(reactivated.value.dispositionRecord?.entries).toEqual([expect.objectContaining({ taskId: 'work-1', from: 'deferred',
    to: 'active', setIn: reactivated.value.ref })]);
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'pending', requeueRef, disposition: 'active',
    failure: { automation: { verdict: { kind: 'claim_requeued', requeueRef } } } });

  // The Workflow claims it with the stored requeueRef; Run 2 fails the same way.
  const second = await drive(platform, select('a2-disposition-run-2', 'work-1'), performs('requeue_task'));
  expect(second.stoppedBefore).toBe(true);
  const failedAgain = await taskRow(platform, 'work-1');
  const run2Ref = failedAgain.execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be the selected Run');
  expect((await readRun(platform, run2Ref)).run).toMatchObject({ requeueRef, planRef: reactivated.value.ref, outcome: 'completed' });
  expect(scripted.requests).toHaveLength(2);
  // §13.4 #26: deferring and reactivating changed no basis, so the same failure is no new basis.
  expect(await requeue('a2-disposition-requeue-2', run2Ref)).toMatchObject({ status: 'committed',
    value: { kind: 'refused', refusal: { code: 'no_new_basis' } } });
  expect(c7Case.phasesOf(platform)).not.toContain('FAILED');   // A.2 step 6
});

it('C7 interleavings in both orders (sequential): TASK-19 first → requeue invalid; requeue first → TASK-19 commits; S15 claim while deferred invalid, then claimed; claim first → TASK-19 busy; the failed round\'s evidence stays APPLICABLE across defer and reactivate', async () => {
  const { platform, directory } = await openEnvironment(2);
  const plans: Record<string, PlanRevisionSnapshot> = {};
  const writes = () => eventTypesIn(directory).length;
  const goalRevision = async () => {
    const goal = await platform.plans.queryGoal(ctx(), goalRef);
    if (goal.status !== 'ready') throw new Error('the Goal must be readable');
    return goal.value.goal.revision;
  };
  const requeue = async (requestId: string, afterRunRef: RunRef) => {
    const afterRun = await readRun(platform, afterRunRef);
    return platform.claims.requeueTask!(ctx(), { meta: { requestId, expected: [{ ref: goalRef, revision: await goalRevision() },
      { ref: afterRunRef, revision: afterRun.run.revision }] },
      input: { taskRef: TASK, afterRunRef, reason: 'the registered check failed; try again' } });
  };
  /** The operator's W16 that sets work-1's disposition (listed in affectedTaskIds); any answer. */
  const setDisposition = async (planId: string, disposition: 'active' | 'deferred') => {
    const next = await nextDraft(platform, planId, draft => ({ ...draft, tasks: withDisposition(draft.tasks, 'work-1', { disposition }) }));
    const candidate = await proposed(platform, `${planId}-propose`, next.source, next.draft,
      { text: `work-1 ${disposition}`, sources: [], affectedTaskIds: ['work-1'] });
    const result = await apply(platform, `${planId}-apply`, candidate);
    if (result.status === 'committed') plans[planId] = result.value;
    return result;
  };

  // Run 1 completes, its check FAILs; the Workflow would requeue it next.
  const first = await drive(platform, select('c7-order-run-1', 'work-1'), performs('requeue_task'));
  expect(first.stoppedBefore).toBe(true);
  const run1Ref = (await taskRow(platform, 'work-1')).execution;
  if (run1Ref === null) throw new Error('work-1 must have a selected Run');
  plans['p1'] = (await graph(platform)).plan;

  // TASK-19 first: the deferral commits; then a requeue is invalid (TASK-16), zero writes.
  expect(await setDisposition('c7-order-p2', 'deferred')).toMatchObject({ status: 'committed' });
  let before = writes();
  expect(await requeue('c7-order-requeue-deferred', run1Ref)).toMatchObject({ status: 'rejected', code: 'invalid',
    reason: 'task_not_active: the task disposition is deferred' });
  expect(writes(), 'the refused requeue wrote nothing').toBe(before);
  await check(platform, 'requeue refused while deferred');
  const ended = await readRun(platform, run1Ref);

  // Reactivated, the requeue commits; a requeue first, then TASK-19: the deferral commits over the TaskRequeue.
  expect(await setDisposition('c7-order-p3', 'active')).toMatchObject({ status: 'committed' });
  const requeued = await requeue('c7-order-requeue', run1Ref);
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue: ${JSON.stringify(requeued)}`);
  await check(platform, 'requeued after the reactivation', { kind: 'task_requeued', actor: { ...operator } });
  const requeueRef = requeued.value.requeue.ref;
  expect(await setDisposition('c7-order-p4', 'deferred')).toMatchObject({ status: 'committed' });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ disposition: 'deferred', requeueRef, effectivePhase: 'pending' });
  expect(c7Case.targetOf(platform).lastWorld?.requeues.map(record => record.ref)).toEqual([requeueRef]);

  // S15: a direct claim with the stored requeueRef while deferred is invalid (TASK-03's disposition guard,
  // claim-service.ts:556, as §11.18 cites it), zero writes.
  const session = ended.session;
  const claimInput = async (planRef: PlanRevisionSnapshot['ref']) => ({
    meta: { requestId: 'c7-order-claim-deferred', expected: [{ ref: goalRef, revision: await goalRevision() },
      { ref: { aggregateType: 'Workspace' as const, projectId: goalRef.projectId, workspaceId: ended.run.workspaceSnapshot.workspaceId },
        revision: ended.run.workspaceSnapshot.revision },
      { ref: session.ref, revision: (await readRun(platform, run1Ref)).session.revision }] },
    input: { goalRef, planRef, taskId: 'work-1', sessionRef: { projectId: session.ref.projectId, sessionId: session.ref.sessionId } as SessionRef,
      roleBinding: ended.run.roleBinding, budget: ended.run.budget, requeueRef } });
  before = writes();
  const deferredClaim = await platform.claims.claimTask(ctx(), await claimInput(plans['c7-order-p4']!.ref));
  expect(deferredClaim).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'the Task disposition is not active' });
  expect(writes(), 'the refused claim wrote nothing').toBe(before);
  await check(platform, 'S15 claim refused while deferred');

  // Reactivated, the Workflow claims it with the same requeueRef (S15); then a TASK-19 while the claim holds is busy.
  expect(await setDisposition('c7-order-p5', 'active')).toMatchObject({ status: 'committed' });
  const claimed = await drive(platform, select('c7-order-run-2', 'work-1'), performs('prepare'));
  expect(claimed.stoppedBefore).toBe(true);
  const run2Ref = (await taskRow(platform, 'work-1')).execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be claimed');
  expect((await readRun(platform, run2Ref)).run).toMatchObject({ status: 'starting', requeueRef, planRef: plans['c7-order-p5']!.ref });
  before = writes();
  const busy = await setDisposition('c7-order-p6', 'deferred');
  expect(busy).toMatchObject({ status: 'rejected', code: 'busy',
    reason: `task work-1 still has an unfinished execution: run ${run2Ref.runId} is starting` });
  expect(await activePlanRef(platform)).toEqual(plans['c7-order-p5']!.ref);
  expect(eventTypesIn(directory).slice(before), 'only the candidate was recorded').toEqual(['PlanProposalRecorded']);

  // R3e-evidence-coverage: Run 1's FAIL evidence (anchored on P1) and the same evidence anchored on the deferred
  // version are APPLICABLE on the reactivated version; a changed definition would make it OUT_OF_SCOPE.
  const evidence = c7Case.targetOf(platform).lastWorld?.evidence.find(snapshot => snapshot.evidence.subject.taskId === 'work-1'
    && snapshot.evidence.outcome === 'FAIL')?.evidence;
  if (evidence === undefined) throw new Error('Run 1\'s FAIL evidence must be in the world');
  expect(evidence.anchor.planRef).toEqual(plans['p1']!.ref);
  const decide = (evidencePlan: PlanRevisionSnapshot, adoptedPlan: PlanRevisionSnapshot) => evidenceApplicabilityWithBasis({
    evidence: { ...evidence, anchor: { ...evidence.anchor, planRef: evidencePlan.ref, planRevision: evidencePlan.planRevision } },
    evidencePlan, adoptedPlan, currentAnchor: { ...evidence.anchor, planRef: adoptedPlan.ref, planRevision: adoptedPlan.planRevision } });
  for (const [from, to] of [['p1', 'c7-order-p2'], ['p1', 'c7-order-p5'], ['c7-order-p4', 'c7-order-p5'], ['c7-order-p2', 'c7-order-p3']]) {
    expect(decide(plans[from!]!, plans[to!]!), `${from} → ${to}`).toMatchObject({ applicability: 'APPLICABLE', basis: 'same-basis' });
  }
  const redefined = { ...plans['c7-order-p5']!, tasks: plans['c7-order-p5']!.tasks.map(task => task.taskId === 'work-1'
    ? { ...task, title: 'A changed definition' } : task) } as PlanRevisionSnapshot;
  expect(decide(plans['c7-order-p4']!, redefined)).toMatchObject({ applicability: 'OUT_OF_SCOPE', basis: 'redefined' });
  expect(c7Case.phasesOf(platform)).not.toContain('FAILED');
});

it('C7 races with a commit barrier (§3.6 PLAN-05): a control in TASK-19\'s window is refused and TASK-19 commits; TASK-19 vs a requeue and vs a requeue claim, each in both orders', async () => {
  const { platform, directory, workspace } = await openEnvironment(1);
  const events = () => eventTypesIn(directory).length;
  const goalRevision = async () => {
    const goal = await platform.plans.queryGoal(ctx(), goalRef);
    if (goal.status !== 'ready') throw new Error('the Goal must be readable');
    return goal.value.goal.revision;
  };
  const activePlan = async () => {
    const ref = await activePlanRef(platform);
    if (ref === null) throw new Error('the Goal must have an active Plan');
    return ref;
  };
  /** The operator's requeue of work-1 after `afterRunRef`, pinned to the Goal and the Run as they are now. */
  const requeueRequest = async (requestId: string, afterRunRef: RunRef) => ({
    meta: { requestId, expected: [{ ref: goalRef, revision: await goalRevision() },
      { ref: afterRunRef, revision: (await readRun(platform, afterRunRef)).run.revision }] },
    input: { taskRef: TASK, afterRunRef, reason: 'the registered check failed; try again' } });
  /** The operator's candidate setting work-1's disposition (listed in affectedTaskIds), on the active Plan. */
  const candidate = async (planId: string, disposition: 'active' | 'deferred') => {
    const next = await nextDraft(platform, planId, draft => ({ ...draft, tasks: withDisposition(draft.tasks, 'work-1', { disposition }) }));
    return proposed(platform, `${planId}-propose`, next.source, next.draft,
      { text: `work-1 ${disposition}`, sources: [], affectedTaskIds: ['work-1'] });
  };
  const applyRequest = (requestId: string, proposal: { ref: PlanProposalRef; revision: number }) => ({ meta: { requestId, expected: [] },
    input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] } });
  const reactivate = async (planId: string) => expect(await apply(platform, `${planId}-apply`, await candidate(planId, 'active')))
    .toMatchObject({ status: 'committed' });
  const window = (writer: RaceWriter, inside: () => Promise<void>) => raceWindow(directory, writer, inside, { now: () => c7Case.AT, workspace });

  // Run 1 completes and its check FAILs.
  const first = await drive(platform, select('c7-race-run-1', 'work-1'), performs('requeue_task'));
  expect(first.stoppedBefore).toBe(true);
  const run1Ref = (await taskRow(platform, 'work-1')).execution;
  if (run1Ref === null) throw new Error('work-1 must have a selected Run');

  // 1. submitControl on the selected Run inside TASK-19's read→commit window. TASK-19's guards 1–3 passed because the
  //    Run ended with no open wait, and such a Run takes no new control: the cancel is refused and writes nothing,
  //    and TASK-19 commits (§3.6's `revision_conflict` for this pair is not reachable this way: NOTES Q10).
  const deferral1 = await candidate('c7-race-p2', 'deferred');
  const controlled: { result?: unknown; wrote?: number } = {};
  const controlRace = window('plans', async () => {
    const before = events();
    const run = await readRun(platform, run1Ref);
    controlled.result = await platform.controls.submitControl(ctx(), { input: { runRef: run1Ref, kind: 'cancel', reason: 'stop it now' },
      meta: { requestId: 'c7-race-cancel', expected: [{ ref: run1Ref, revision: run.run.revision }] } });
    controlled.wrote = events() - before;
  });
  expect(await controlRace.plans.applyPlanChange(ctx(), applyRequest('c7-race-p2-apply', deferral1))).toMatchObject({ status: 'committed' });
  expect(controlRace.raced()).toBe(true);
  expect(controlled).toMatchObject({ result: { status: 'rejected', code: 'busy',
    reason: 'the Run already ended; no new control intent is accepted' }, wrote: 0 });
  await check(platform, 'race 1: deferred, the cancel in its window refused', { kind: 'plan_adopted', actor: { ...operator } });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ disposition: 'deferred' });

  // 2a. TASK-19 vs a requeue, W16 inside the requeue's window: the requeue read work-1 active under the Goal it pinned;
  //     the deferral moves the Goal: revision_conflict, nothing written; retried, TASK-16 refuses the deferred Task.
  await reactivate('c7-race-p3');
  const deferral2 = await candidate('c7-race-p4', 'deferred');
  const deferredInRequeue: { result?: unknown; events?: number } = {};
  const requeueRace = window('requeues', async () => {
    deferredInRequeue.result = await apply(platform, 'c7-race-p4-apply', deferral2);
    deferredInRequeue.events = events();
  });
  const lostRequeue = await requeueRace.requeues.requeueTask(ctx(), await requeueRequest('c7-race-requeue-1', run1Ref));
  expect(requeueRace.raced()).toBe(true);
  expect(deferredInRequeue.result).toMatchObject({ status: 'committed' });
  expect(lostRequeue).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(events(), 'the conflicted requeue wrote nothing').toBe(deferredInRequeue.events);
  await check(platform, 'race 2a: the requeue lost to the deferral');
  expect(await platform.claims.requeueTask!(ctx(), await requeueRequest('c7-race-requeue-2', run1Ref)))
    .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'task_not_active: the task disposition is deferred' });

  // 2b. A requeue inside W16's window: W16 pins no TaskRequeue, so it commits over it and leaves a deferred Task with
  //     its TaskRequeue (§3.3 point 2; I-21 allows it).
  await reactivate('c7-race-p5');
  const deferral3 = await candidate('c7-race-p6', 'deferred');
  const requeuedInside: { result?: Awaited<ReturnType<RaceWindow['requeues']['requeueTask']>> } = {};
  const adoptionRace = window('plans', async () => {
    const result = await platform.claims.requeueTask!(ctx(), await requeueRequest('c7-race-requeue-3', run1Ref));
    requeuedInside.result = result;
    await check(platform, 'race 2b: requeued inside the deferral\'s window', result.status === 'committed'
      ? { kind: 'task_requeued', actor: { ...operator } } : undefined);
  });
  expect(await adoptionRace.plans.applyPlanChange(ctx(), applyRequest('c7-race-p6-apply', deferral3))).toMatchObject({ status: 'committed' });
  expect(adoptionRace.raced()).toBe(true);
  const requeued = requeuedInside.result;
  if (requeued?.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue inside: ${JSON.stringify(requeued)}`);
  await check(platform, 'race 2b: deferred over the TaskRequeue', { kind: 'plan_adopted', actor: { ...operator } });
  const requeueRef = requeued.value.requeue.ref;
  expect(await taskRow(platform, 'work-1')).toMatchObject({ disposition: 'deferred', requeueRef, effectivePhase: 'pending' });
  expect(c7Case.targetOf(platform).lastWorld?.requeues.map(record => record.ref)).toEqual([requeueRef]);

  // 3a. TASK-19 vs the requeue claim, TASK-19 inside the claim's window: the claim pinned the Goal and the Plan it
  //     read: revision_conflict, nothing written; retried on the deferred Task, the claim is invalid (TASK-03).
  await reactivate('c7-race-p7');
  const claimRequest = async (requestId: string) => {
    const run1 = await readRun(platform, run1Ref);
    return { meta: { requestId, expected: [{ ref: goalRef, revision: await goalRevision() },
      { ref: { aggregateType: 'Workspace' as const, projectId: goalRef.projectId, workspaceId: run1.run.workspaceSnapshot.workspaceId },
        revision: run1.run.workspaceSnapshot.revision },
      { ref: run1.session.ref, revision: run1.session.revision }] },
    input: { goalRef, planRef: await activePlan(), taskId: 'work-1',
      sessionRef: { projectId: run1.session.ref.projectId, sessionId: run1.session.ref.sessionId } as SessionRef,
      roleBinding: run1.run.roleBinding, budget: run1.run.budget, requeueRef } };
  };
  const deferral4 = await candidate('c7-race-p8', 'deferred');
  const deferredInClaim: { result?: unknown; events?: number } = {};
  const claimRace = window('claims', async () => {
    deferredInClaim.result = await apply(platform, 'c7-race-p8-apply', deferral4);
    deferredInClaim.events = events();
  });
  const lostClaim = await claimRace.claims.claimTask(ctx(), await claimRequest('c7-race-claim-1'));
  expect(claimRace.raced()).toBe(true);
  expect(deferredInClaim.result).toMatchObject({ status: 'committed' });
  expect(lostClaim).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(events(), 'the conflicted claim wrote nothing').toBe(deferredInClaim.events);
  await check(platform, 'race 3a: the claim lost to the deferral');
  expect(await platform.claims.claimTask(ctx(), await claimRequest('c7-race-claim-2')))
    .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'the Task disposition is not active' });

  // 3b. The requeue claim inside TASK-19's window: TASK-19 pinned work-1's released Lease and the claim holds it again:
  //     revision_conflict, the active Plan unchanged, nothing written; retried, guard 1 refuses it (busy).
  await reactivate('c7-race-p9');
  const p9 = await activePlan();
  const deferral5 = await candidate('c7-race-p10', 'deferred');
  const claimedInside: { result?: Awaited<ReturnType<RaceWindow['claims']['claimTask']>>; events?: number } = {};
  const leaseRace = window('plans', async () => {
    const result = await platform.claims.claimTask(ctx(), await claimRequest('c7-race-claim-3'));
    claimedInside.result = result;
    await check(platform, 'race 3b: claimed inside the deferral\'s window', result.status === 'committed'
      ? { kind: 'task_claimed', actor: { ...operator } } : undefined);
    claimedInside.events = events();
  });
  const lostDeferral = await leaseRace.plans.applyPlanChange(ctx(), applyRequest('c7-race-p10-apply', deferral5));
  expect(leaseRace.raced()).toBe(true);
  const claimed = claimedInside.result;
  if (claimed?.status !== 'committed') throw new Error(`claim inside: ${JSON.stringify(claimed)}`);
  expect(lostDeferral).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(await activePlan()).toEqual(p9);
  expect(events(), 'the conflicted deferral wrote nothing').toBe(claimedInside.events);
  await check(platform, 'race 3b: the deferral lost to the claim');
  expect(await apply(platform, 'c7-race-p10-apply-2', deferral5)).toMatchObject({ status: 'rejected', code: 'busy',
    reason: `task work-1 still has an unfinished execution: run ${claimed.value.runRef.runId} is starting` });
  expect((await readRun(platform, claimed.value.runRef)).run).toMatchObject({ status: 'starting', requeueRef, planRef: p9 });
  expect(c7Case.phasesOf(platform)).not.toContain('FAILED');
}, 120_000);

it('C7 TASK-19 inside the window of the selected Run\'s control (Host, commit barrier): the open wait makes the deferral busy (guard 3); once the operator\'s cancel commits, the automation is forbidden (guard 7) and the operator defers', async () => {
  const T = AG2B_WORK_TASK_ID;
  let recipient: SessionRef | undefined;
  const send = { callId: 'c7-wait-send', name: 'send_session_message',
    args: { recipient: {}, text: 'C7 question: a reply nobody sends', intent: 'inquiry', needsReply: true, waitAfterSend: true } as Record<string, unknown> };
  const h: HostScenario = await openHostScenario({ check: 'pass', script: { replies: [{ kind: 'calls', calls: [send] }],
    duringReply: async (index) => {
      if (index === 0 && recipient !== undefined) send.args['recipient'] = { projectId: recipient.projectId, sessionId: recipient.sessionId };
    } } });
  recipient = (await createAG2bSession(h.host, 'c7-wait-recipient', AG2B_QUERY_ROLE,
    [{ target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: T } }, relation: 'participates' }]))
    .sessionRef;
  await assertInvariants(h, 'seeded');

  // The work Run sends a wait message nobody answers and yields: its continuation is not consumed.
  expect(await h.advance(h.select('c7-wait', T))).toMatchObject({ state: 'waiting' });
  const runRef = (await h.taskRow(T)).execution;
  if (runRef === null) throw new Error('the work Task must have a Run');
  expect((await execution(h, runRef)).run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
  expect(h.modelCalls()).toBe(1);

  // The operator's deferral candidate (the gate also carries the obligation).
  const source = (await hostGraph(h)).plan;
  const draft = draftFrom(source, 'ag2b-plan-c7-wait', next => ({ ...next,
    tasks: next.tasks.map(task => task.taskId === T ? { ...task, disposition: 'deferred' as const } : task) }));
  const proposal = await h.post<{ status: string; value: { ref: PlanProposalRef; revision: number } }>('plans/propose', graphWrite(AG2B_SCOPE,
    { goalRef: AG2B_GOAL_REF, basedOn: source.ref, draft, reason: { text: 'C7: not now', sources: [], affectedTaskIds: [T] } }, 'c7-wait-propose'));
  if (proposal.status !== 'committed') throw new Error(`proposal: ${JSON.stringify(proposal)}`);
  const applyBody = (requestId: string) => graphWrite(AG2B_SCOPE,
    { proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, decisionRefs: [] }, requestId);
  const automationApply = async (requestId: string) => (await h.direct()).plans.applyPlanChange(hostCtx({ ...WORKFLOW_AUTOMATION_ACTOR }),
    applyBody(requestId).request as never);
  const waitBusy = { status: 'rejected', code: 'busy', reason: `task ${T}: cancel or resume the yielded wait of run ${runRef.runId} first` };

  // The selected Run's control first: the operator cancels the wait (P17, a human stop), and TASK-19 runs inside the
  // cancel's read→commit window (the commit barrier on the Host's ledger). It reads the wait still open, so guard 3
  // refuses the deferral for the operator and the automation alike, and nothing is written; then the cancel commits.
  const inside: { operator?: unknown; automation?: unknown; before?: ScenarioCounts; after?: ScenarioCounts; plan?: unknown } = {};
  const cancelRace = raceWindow(h.database, 'controls', async () => {
    inside.before = h.counts();
    inside.operator = await h.answer('plans/apply', applyBody('c7-wait-apply-1'));
    inside.automation = await automationApply('c7-wait-auto-1');
    inside.after = h.counts();
    inside.plan = (await hostGraph(h)).plan.ref;
    await assertInvariants(h, 'deferral refused while the wait is open');
  }, { now: () => '2026-10-06T00:00:00.000Z' });
  const waiting = await execution(h, runRef);
  const cancel = await cancelRace.controls.submitControl(hostCtx(), { input: { runRef, kind: 'cancel', reason: 'C7: no reply is coming' },
    meta: { requestId: 'c7-wait-cancel', expected: [{ ref: runRef, revision: waiting.run.revision }] } });
  expect(cancelRace.raced()).toBe(true);
  expect(inside.operator).toMatchObject(waitBusy);
  expect(inside.automation).toMatchObject(waitBusy);
  expect(inside.after).toEqual(inside.before);
  expect(inside.plan).toEqual(source.ref);
  expect(cancel).toMatchObject({ status: 'committed', value: { intent: { kind: 'cancel', requestedBy: SCENARIO_OPERATOR } } });
  await assertInvariants(h, 'wait cancelled', { kind: 'other', actor: { ...SCENARIO_OPERATOR }, automationPolicy: h.automationPolicy() });

  // Guards re-judged: guard 3 passes (the wait is cancelled), guard 7 refuses the automation; the operator defers.
  const before = h.counts();
  expect(await automationApply('c7-wait-auto-2')).toMatchObject({ status: 'rejected', code: 'forbidden',
    reason: `only an operator may change the disposition of task ${T}: a human paused or cancelled it` });
  expect(h.counts()).toEqual(before);
  const adopted = await h.post<{ status: string; value: PlanRevisionSnapshot }>('plans/apply', applyBody('c7-wait-apply-2'));
  expect(adopted).toMatchObject({ status: 'committed' });
  await assertInvariants(h, 'deferred by the operator', { kind: 'plan_adopted', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: h.automationPolicy() });
  expect(await h.taskRow(T)).toMatchObject({ disposition: 'deferred', execution: runRef,
    dispositionChange: { taskId: T, from: 'active', to: 'deferred', traced: true, actor: SCENARIO_OPERATOR } });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'NEEDS_DECISION', cause: { code: 'required_task_deferred', taskIds: [T] } });
  expect(h.modelCalls()).toBe(1);
}, 120_000);

it('C7 TASK-19 against the selected Run\'s pointer ControlIntent moving in its window (§3.6 PLAN-05, Q10\'s reachable form): the restart settles a queued pause left on the ended Run (CTL-08(e)) inside TASK-19\'s read→commit window; TASK-19 is refused revision_conflict and writes nothing; retried, guards 3 and 7 are judged again: the automation is forbidden, the operator defers', async () => {
  const T = AG2B_WORK_TASK_ID;
  const h: HostScenario = await openHostScenario({ check: 'pass', automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' } });
  await assertInvariants(h, 'seeded');
  // The selected Run ends completed with a person's pause still queued as its pointer (A8-3h's crash point: a composition
  // root runs the Run, the pause is submitted during the final model call, which no safe point follows, and the ledger is
  // locked right after the terminal commit, so the pause is never settled in process).
  const toStart = await h.advance(h.select('c7-pointer', T), { stopBefore: (input) => input.kind === 'perform' && input.operation.kind === 'start' });
  const prepared = preparedOf(toStart.next);
  const lock = lockLedgerAfter(h.database, 'ExecutionRunResultRecorded');
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  const model = createScriptedModel([{ kind: 'text', text: 'C7 pointer: done' }], async () => {
    const runRef = (await h.taskRow(T)).execution;
    if (runRef === null) throw new Error('the work Task must have a Run');
    pauseRef = (await submitControl(h.host, runRef, 'pause', 'C7: a person pauses too late', 'c7-pointer-pause')).intent.ref;
  });
  const root = await openWorkRoot(h, model, lock.observer);
  try {
    expect(await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'c7-pointer-start' }))
      .toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'completed' } } });
  } finally {
    lock.release();
    await root.close();
  }
  const runRef = (await h.taskRow(T)).execution;
  if (runRef === null || pauseRef === undefined) throw new Error('the ended Run and its queued pause must exist');
  expect((await execution(h, runRef)).run).toMatchObject({ status: 'ended', outcome: 'completed',
    controlState: { intentRef: pauseRef, desiredState: 'paused' } });
  expect(await readControl(h.host, pauseRef)).toMatchObject({ status: 'queued', revision: 1 });
  await assertInvariants(h, 'ended with a queued pointer pause');

  // The operator's deferral candidate (the gate also carries the obligation, as in the Host case above).
  const source = (await hostGraph(h)).plan;
  const draft = draftFrom(source, 'ag2b-plan-c7-pointer', next => ({ ...next,
    tasks: next.tasks.map(task => task.taskId === T ? { ...task, disposition: 'deferred' as const } : task) }));
  const proposal = await h.post<{ status: string; value: { ref: PlanProposalRef; revision: number } }>('plans/propose', graphWrite(AG2B_SCOPE,
    { goalRef: AG2B_GOAL_REF, basedOn: source.ref, draft, reason: { text: 'C7: not now', sources: [], affectedTaskIds: [T] } }, 'c7-pointer-propose'));
  if (proposal.status !== 'committed') throw new Error(`proposal: ${JSON.stringify(proposal)}`);
  const applyRequest = (requestId: string) => graphWrite(AG2B_SCOPE,
    { proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, decisionRefs: [] }, requestId).request;

  // TASK-19 through the commit barrier; inside its read→commit window the Host restarts and step 5 settles the queued
  // pause on the ended Run (CTL-08(e), no Kernel event: superseded), so the pointer intent TASK-19 read moved.
  const inside: { report?: unknown; events?: number } = {};
  const race = raceWindow(h.database, 'plans', async () => {
    inside.report = (await h.restart({ crash: true })).report;
    inside.events = h.ledgerEventTypes().length;
  }, { now: () => '2026-10-06T00:00:00.000Z' });
  const lost = await race.plans.applyPlanChange(hostCtx(), applyRequest('c7-pointer-apply-1') as never);
  expect(race.raced()).toBe(true);
  expect(inside.report).toMatchObject({ controls: [{ ref: JSON.stringify(runRef), row: 'W-16', status: 'reconciled' }], problems: [] });
  expect(await readControl(h.host, pauseRef)).toMatchObject({ status: 'superseded', observation: { kind: 'terminal_without_cancel' } });
  expect(lost).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(h.ledgerEventTypes(), 'the conflicted deferral wrote nothing').toHaveLength(inside.events!);
  expect((await hostGraph(h)).plan.ref, 'the active Plan is unchanged').toEqual(source.ref);
  await assertInvariants(h, 'TASK-19 lost to the intent observation');

  // Retried on the facts as they are now: guard 3 passes (no wait), guard 7 still fences the automation (the pointer is
  // a person's pause, superseded by the terminal: AV-4 keeps the fence); the operator's deferral commits.
  const before = h.counts();
  expect(await (await h.direct()).plans.applyPlanChange(hostCtx({ ...WORKFLOW_AUTOMATION_ACTOR }), applyRequest('c7-pointer-auto') as never))
    .toMatchObject({ status: 'rejected', code: 'forbidden', reason: `only an operator may change the disposition of task ${T}: a human paused or cancelled it` });
  expect(h.counts()).toEqual(before);
  expect(await h.post('plans/apply', graphWrite(AG2B_SCOPE, { proposalRef: proposal.value.ref,
    expectedProposalRevision: proposal.value.revision, decisionRefs: [] }, 'c7-pointer-apply-2'))).toMatchObject({ status: 'committed' });
  await assertInvariants(h, 'deferred by the operator', { kind: 'plan_adopted', actor: { ...SCENARIO_OPERATOR },
    automationPolicy: h.automationPolicy() });
  expect(await h.taskRow(T)).toMatchObject({ disposition: 'deferred', execution: runRef });
  await h.drainAbandoned();
}, 120_000);
