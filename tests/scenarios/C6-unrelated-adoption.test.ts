/**
 * A.2 step 6, scenario C6-unrelated-adoption (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * C6-unrelated-adoption; C6 (U-11 → (b)), §3.3 point 5, §6 RUN-02/RUN-03/RUN-04 and contract (g),
 * §9 VD-7, §12.2 W-01, §13.1 `plan` (L-4), §11.19 I-22).
 *
 * 1. Main path: the Workflow claims T1 (`ag2b-work`); another Task's running Run (`ag2b-other`, an Agent
 *    with the W2 plan-write tools) proposes and adopts P2, which adds the unrelated intent T3. T1 keeps
 *    its Session and Lease; it is authorized (the audit names P2), enters, completes; its round opens
 *    under P2 (VD-7) and PASS satisfies it. The Goal is never FAILED, no TaskRequeue is written, T1's
 *    no-progress key is the same against P1 and P2 (L-4), and the §11 invariants hold after every step.
 * 2. (Merged into the main path, case 1: the moved Host `plans/apply` variant, where the operator adopted
 *    the unrelated P2 after the claim, no longer has a case of its own.)
 * 3. Variant W-01 note (moved case): an adoption before the prepare and a fresh selection continue the claim.
 * 4. Variant W-01: the Host is restarted (a crash) between the claim and the authorization, after the
 *    adoption: the reconcile leaves the claimed Run as it is (W-01, no transition), the next 推进 continues
 *    the same claim and RUN-02's relaxed guard passes (C6).
 * 5. (Deleted 2026-10-07, decision 34: the LA-2 variant needed a material grant, and the grant writer was
 *    deleted as unreachable code.)
 * 6. Variant RUN-03 (§12.10 A8-1c supplement): an Entering Run revoked at a restart (W-05 → W-03) is re-authorized
 *    after an unrelated adoption: the relaxed guard passes under P2 (generation 2) and the same claim completes.
 *
 * Moved here (A.2 step 6, user decision 31), assertions kept: cases 2, 3 and 5 were the three cases of
 * tests/composition/A2-entry-plan-platform.test.ts (that file is deleted; case 5 is deleted too, and case 2 was
 * later merged into the main path); their environment is tests/scenarios/support/plan.ts `c6Case`. Added to
 * them: the §11 invariants after every step and write.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { AG2B_GOAL_REF, AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { assertInvariants, cleanupScenarios, eventTypesIn, openHostScenario, performs } from './harness.js';
import {
  PlanBoard, cleanupCommon, execution, putKernelBack, startWithKernelAside, toolOutputJson, type PhaseLog,
} from './support/common.js';
import {
  advanceLogged, agentActorOf, authorizedEventsIn, c6Case, cleanupPlan, committedOf, futureIntent, hostAdopt, hostGraph,
  noProgressKeyAgainst, planAcceptedEventsIn,
} from './support/plan.js';

const { goalRef, ctx, openEnvironment, adoptUnrelatedFuture, select, drive, taskRow, claimOf, authorizedEvents } = c6Case;

afterEach(async () => {
  await cleanupPlan();
  await cleanupCommon();
  await cleanupScenarios();
});

const T1 = AG2B_WORK_TASK_ID;
const OTHER = 'ag2b-other';
const T3 = 'ag2b-future';

it('C6 main path: another Task\'s running Run adopts P2 after the Workflow claimed T1; T1 keeps its Session and Lease, runs under P2 and is satisfied; no FAILED, no TaskRequeue, the same no-progress key', async () => {
  const propose = { callId: 'c6-propose', name: 'propose_future_plan', args: {} as Record<string, unknown> };
  const apply = { callId: 'c6-apply', name: 'apply_future_plan', args: {} as Record<string, unknown> };
  const seen: { propose?: unknown; apply?: unknown; adopter?: RunRef; adopterStatus?: string } = {};
  let board!: PlanBoard;
  board = await PlanBoard.open({ workIds: [T1, OTHER], check: 'pass', replies: [
    { kind: 'calls', calls: [propose] }, { kind: 'calls', calls: [apply] },
    { kind: 'text', text: 'C6: the other Task adopted P2' }, { kind: 'text', text: 'C6: T1 finished its work' }],
  duringReply: async (index, request) => {
    if (index === 0) {
      // The other Task's Run is in the Kernel: it proposes P2 = P1 + the unrelated intent T3.
      const adopter = (await board.taskRow(OTHER)).execution;
      if (adopter !== null) seen.adopter = adopter;
      const next = await board.nextDraft('ag2b-plan-c6-p2', draft => ({ ...draft, tasks: [...draft.tasks, futureIntent(T3)] }));
      Object.assign(propose.args, { basedOn: next.source.ref, draft: next.draft,
        reason: { text: 'C6: an unrelated future intent', sources: [] }, expected: [] });
    }
    if (index === 1) {
      await board.check('candidate proposed by the other Task\'s Run');
      seen.propose = toolOutputJson(request, 'c6-propose');
      const proposal = seen.propose as { status?: string; value?: { ref: PlanProposalRef; revision: number } };
      if (proposal.status !== 'committed' || proposal.value === undefined) throw new Error(`propose: ${JSON.stringify(proposal)}`);
      Object.assign(apply.args, { proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, expected: [] });
      // The apply is sent in this call's reply: the adopting Run's status as it sends it.
      if (seen.adopter !== undefined) seen.adopterStatus = (await board.readRun(seen.adopter)).run.status;
    }
    if (index === 2) {
      seen.apply = toolOutputJson(request, 'c6-apply');
      if (seen.adopter === undefined) throw new Error('the adopting Run must be known');
      await board.check('P2 adopted by the other Task\'s Run', { kind: 'plan_adopted', actor: agentActorOf(seen.adopter) });
    }
  } });
  const p1 = (await board.graph()).plan;

  // The Workflow claims T1 on P1 and prepares it; it stops before the start (claimed, not authorized).
  const toStart = await board.advance(board.select('c6-t1', T1), performs('start'));
  if (toStart.next === null) throw new Error('the Workflow must stop before T1\'s start');
  const claim = committedOf(toStart.receipts, 'claim_task');
  expect(claim).toMatchObject({ task: { taskId: T1 }, planRef: p1.ref });
  const held = await board.readRun(claim.runRef);
  expect(held.run).toMatchObject({ status: 'starting', planRef: p1.ref });
  expect(held.session.occupancy).toMatchObject({ kind: 'execution', executionRef: claim.runRef, generation: claim.generation });
  expect(held.lease).toMatchObject({ holderRunId: claim.runRef.runId, attemptId: claim.attemptRef.attemptId });
  expect(held.lease?.release).toBeUndefined();

  // The other Task runs: its Agent proposes and adopts P2 through apply_future_plan, then its own round passes.
  const other = await board.advance(board.select('c6-other', OTHER));
  expect(other.state).toBe('completed');
  expect(seen.propose).toMatchObject({ status: 'committed', value: { ref: { aggregateType: 'PlanProposal' } } });
  expect(seen.apply).toMatchObject({ status: 'committed', value: { planRevision: p1.planRevision + 1 } });
  const p2 = (await board.graph()).plan;
  expect((seen.apply as { value: PlanRevisionSnapshot }).value.ref).toEqual(p2.ref);
  // The adopter was the other Task's running Run, and production recorded it as P2's actor
  // (`PlanRevisionAccepted.actor`, plan-commit-compiler.ts:182).
  expect(seen.adopterStatus, 'the adopting Run was running when it sent apply_future_plan').toBe('running');
  expect(planAcceptedEventsIn(board.database).filter(event => event.aggregateId === p2.ref.planId))
    .toEqual([{ aggregateId: p2.ref.planId, actor: expect.objectContaining({ kind: 'agent', runRef: seen.adopter }) }]);
  expect(p2.tasks.map(task => task.taskId)).toEqual([...p1.tasks.map(task => task.taskId), T3]);
  // P2 carries T1 unchanged: the same definition, the basis inherited from P1.
  expect(p2.tasks.find(task => task.taskId === T1)).toEqual(p1.tasks.find(task => task.taskId === T1));
  expect(p2.schemaVersion === 2 ? p2.taskStateBasis?.entries : null).toContainEqual({ taskId: T1, planRef: p1.ref });
  expect(await board.taskRow(OTHER)).toMatchObject({ effectivePhase: 'satisfied' });

  // T1 keeps its Session and Lease through the adoption: neither record changed.
  const afterAdoption = await board.readRun(claim.runRef);
  expect({ run: afterAdoption.run, session: afterAdoption.session, lease: afterAdoption.lease })
    .toEqual({ run: held.run, session: held.session, lease: held.lease });
  // No TaskRequeue covers T1's claimed Run: the adoption asked for no rework.
  expect((await board.taskRow(T1)).requeueRef).toBeUndefined();

  // The same claim goes on: authorized under the active P2 (RUN-02, C6), entered, completed; the round opens under P2.
  const t1 = await board.advance(toStart.next);
  expect(t1.state).toBe('completed');
  expect(t1.receipts.map(receipt => receipt.kind)).not.toContain('claim_task');
  expect(t1.receipts.map(receipt => receipt.kind)).not.toContain('create_session');
  expect(t1.receipts.find(receipt => receipt.kind === 'start')).toMatchObject({ result: { status: 'ready',
    value: { run: { ref: claim.runRef, planRef: p1.ref, status: 'ended', outcome: 'completed' }, session: { occupancy: null } } } });
  expect(committedOf(t1.receipts, 'open_checks')).toMatchObject({ adoptedPlanRef: p2.ref });
  expect(committedOf(t1.receipts, 'finalize_checks')).toMatchObject({ outcome: 'PASS' });
  const done = await board.taskRow(T1);
  expect(done).toMatchObject({ effectivePhase: 'satisfied', execution: claim.runRef });
  expect(done.requeueRef).toBeUndefined();
  expect(authorizedEventsIn(board.database).filter(event => event.permit.claim.runRef.runId === claim.runRef.runId))
    .toEqual([expect.objectContaining({ activePlanRef: p2.ref, permit: expect.objectContaining({ claim }) })]);
  // The Run ran in its claim Session and released its own Lease at its terminal.
  const ended = await board.readRun(claim.runRef);
  expect(ended.session.ref).toMatchObject({ sessionId: claim.sessionRef.sessionId });
  expect(ended.lease).toMatchObject({ holderRunId: claim.runRef.runId, release: { runRef: claim.runRef } });

  // The gate and the Goal complete.
  expect(await board.advance(board.select('c6-goal'))).toMatchObject({ state: 'completed' });
  expect(await board.goalDisplay()).toMatchObject({ phase: 'COMPLETED' });

  // Never FAILED (every step and write was sampled); no TaskRequeue; T1 claimed once; four model calls.
  expect(board.phases).not.toContain('FAILED');
  expect(board.phases).toContain('RUNNING');
  expect(board.target.lastWorld?.requeues).toEqual([]);
  expect(eventTypesIn(board.database)).not.toContain('TaskRequeued');
  expect(board.target.lastWorld?.events.filter(event => event.eventType === 'TaskClaimed' && event.taskId === T1)).toHaveLength(1);
  expect(board.scripted.calls(), 'the other Task\'s three calls and T1\'s one').toBe(4);
  // §13.1 (L-4): T1's key is the same whether P1 or P2 is the active Plan.
  const head = board.target.lastWorld?.rounds.find(round => round.subject.taskId === T1) ?? null;
  const keyP1 = noProgressKeyAgainst(p1, ended.run, head);
  const keyP2 = noProgressKeyAgainst(p2, ended.run, head);
  expect(keyP2.plan).toEqual(p1.ref);
  expect(keyP2).toEqual(keyP1);
}, 120_000);

// Moved from tests/composition/A2-entry-plan-platform.test.ts:293 (05125db): the in-process half of the W-01 variant.
it('C6 (W-01 note): an adoption before the prepare and a fresh selection continue the same claim', async () => {
  const { platform, scripted, directory, p1 } = await openEnvironment();
  const toPrepare = await drive(platform, select('a2-c6-flow-a', 'work-1'), performs('prepare'));
  if (toPrepare.stopped === null) throw new Error('the Workflow must reach the prepare');
  const claim = claimOf(toPrepare.receipts);
  const p2 = await adoptUnrelatedFuture(platform.plans, ctx(), goalRef, 'p2');
  // The claimed Run is visible under P2 and the Workflow resumes it: no second claim, no new Session.
  const resumed = await drive(platform, select('a2-c6-flow-b', 'work-1'));
  expect(resumed.receipts.map(receipt => receipt.kind)).not.toContain('claim_task');
  expect(resumed.receipts.map(receipt => receipt.kind)).not.toContain('create_session');
  expect(resumed.receipts.find(receipt => receipt.kind === 'start')).toMatchObject({ result: { status: 'ready',
    value: { run: { ref: claim.runRef, planRef: p1, outcome: 'completed' } } } });
  expect(resumed.receipts.find(receipt => receipt.kind === 'open_checks'))
    .toMatchObject({ result: { status: 'committed', value: { adoptedPlanRef: p2.ref } } });
  expect(resumed).toMatchObject({ state: 'completed' });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'satisfied' });
  expect(scripted.calls()).toBe(1);
  expect(c6Case.phasesOf(platform)).not.toContain('FAILED');   // A.2 step 6
  await platform.close();
  expect(authorizedEvents(directory)).toEqual([expect.objectContaining({ activePlanRef: p2.ref })]);
});

it('C6 variant W-01: the Host restarts between the claim and the authorization, after an unrelated adoption; the reconcile leaves the claim, and 推进 continues it under P2', async () => {
  const h = await openHostScenario({ check: 'pass', automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' },
    script: { replies: [{ kind: 'text', text: 'C6 W-01: the claimed work is done' }] } });
  const phases: PhaseLog = [];
  await assertInvariants(h, 'seeded');
  const p1 = (await hostGraph(h)).plan;

  // Claimed and prepared on P1; the operator adopts the unrelated P2 (Host `plans/apply`) before the start.
  const toStart = await advanceLogged(h, h.select('c6-w01', T1), phases, performs('start'));
  expect(toStart.state).toBe('stopped');
  const claim = committedOf(toStart.receipts, 'claim_task');
  expect(claim.planRef).toEqual(p1.ref);
  const p2 = await hostAdopt(h, 'ag2b-plan-c6-w01', draft => ({ ...draft, tasks: [...draft.tasks, futureIntent(T3)] }),
    { text: 'C6 W-01: an unrelated future intent', sources: [] }, 'c6-w01-p2');
  phases.push((await h.goalDisplay()).phase);
  const beforeRestart = await execution(h, claim.runRef);
  expect(beforeRestart.run).toMatchObject({ status: 'starting', planRef: p1.ref });
  expect(beforeRestart.lease?.release).toBeUndefined();

  // The crash: the reconcile writes nothing for a claimed, never-authorized Run (W-01) and step 6b selects its Goal.
  const report = await h.restart({ crash: true });
  expect(report).toMatchObject({ lease: 'owned', report: { runs: [], problems: [],
    redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [T1] }] } });
  const afterRestart = await execution(h, claim.runRef);
  expect({ run: afterRestart.run, attempt: afterRestart.attempt, outbox: afterRestart.outbox, session: afterRestart.session,
    lease: afterRestart.lease }).toEqual({ run: beforeRestart.run, attempt: beforeRestart.attempt, outbox: beforeRestart.outbox,
    session: beforeRestart.session, lease: beforeRestart.lease });
  expect(h.modelCalls()).toBe(0);
  phases.push((await h.goalDisplay()).phase);

  // A fresh 推进 after the restart continues the same claim: re-prepared (W-01), authorized under P2, entered, completed.
  const resumed = await advanceLogged(h, h.select('c6-w01-after', T1), phases);
  expect(resumed.state).toBe('completed');
  const kinds = resumed.receipts.map(receipt => receipt.kind);
  expect(kinds).not.toContain('claim_task');
  expect(kinds).not.toContain('create_session');
  expect(resumed.receipts.find(receipt => receipt.kind === 'start')).toMatchObject({ result: { status: 'ready',
    value: { run: { ref: claim.runRef, planRef: p1.ref, status: 'ended', outcome: 'completed' } } } });
  expect(committedOf(resumed.receipts, 'open_checks')).toMatchObject({ adoptedPlanRef: p2.ref });
  expect(await h.taskRow(T1)).toMatchObject({ effectivePhase: 'satisfied', execution: claim.runRef });
  expect(authorizedEventsIn(h.database)).toEqual([expect.objectContaining({ activePlanRef: p2.ref,
    permit: expect.objectContaining({ claim }) })]);
  const ended = await execution(h, claim.runRef);
  expect(ended.session.ref).toMatchObject({ sessionId: claim.sessionRef.sessionId });
  expect(ended.lease).toMatchObject({ holderRunId: claim.runRef.runId, release: { runRef: claim.runRef } });

  expect((await advanceLogged(h, h.select('c6-w01-goal'), phases)).state).toBe('completed');
  expect(phases.at(-1)).toBe('COMPLETED');
  expect(phases).not.toContain('FAILED');
  expect(h.lastWorld?.requeues).toEqual([]);
  expect(h.lastWorld?.events.filter(event => event.eventType === 'TaskClaimed' && event.taskId === T1)).toHaveLength(1);
  expect(h.modelCalls()).toBe(1);
  const head = h.lastWorld?.rounds.find(round => round.subject.taskId === T1) ?? null;
  expect(noProgressKeyAgainst(p2, ended.run, head)).toEqual(noProgressKeyAgainst(p1, ended.run, head));
}, 120_000);

it('C6 variant RUN-03 (W-05 → W-03, §12.10 A8-1c supplement): an Entering Run revoked at a restart is re-authorized after an unrelated adoption; the relaxed guard passes under P2 (generation 2), the same claim completes', async () => {
  const RUN0 = 'ag2b-work-0';
  const h = await openHostScenario({ check: 'pass', workIds: [RUN0, T1],
    automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' },
    script: { replies: [{ kind: 'text', text: 'C6 RUN-03: Run0 completed its Turn in S1' }, { kind: 'text', text: 'C6 RUN-03: T1 is done' }] } });
  const phases: PhaseLog = [];
  await assertInvariants(h, 'seeded');
  const p1 = (await hostGraph(h)).plan;
  // Run0 completes in S1, so S1 has completed history (the A8-2 crash point below reads its boundary).
  await advanceLogged(h, h.select('c6-run03-run0', RUN0), phases);
  const run0Ref = (await h.taskRow(RUN0)).execution;
  if (run0Ref === null) throw new Error('Run0 must exist');
  const s1 = (await execution(h, run0Ref)).session.ref;
  // T1 is claimed in S1 and prepared under P1. With the Kernel store aside the start commits RUN-02 and the begin, then
  // stops before the Kernel (tests/scenarios/support/common.ts `startWithKernelAside`): Entering, no Turn.
  const toStart = await advanceLogged(h, { ...h.select('c6-run03', T1), sessionHint: { projectId: s1.projectId, sessionId: s1.sessionId } },
    phases, performs('start'));
  expect(toStart.state).toBe('stopped');
  const claim = committedOf(toStart.receipts, 'claim_task');
  expect(claim.planRef).toEqual(p1.ref);
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  const aside = await startWithKernelAside(h, toStart.next);
  await putKernelBack(h.database, aside);
  expect((await execution(h, claim.runRef)).run).toMatchObject({ executionAuthorization: { phase: 'entering', generation: 1 } });

  // The crash: no Turn of the fixed identity, the probe is `ready`: RUN-16 revokes the entry (W-05; W-03 from now on).
  const report = await h.restart({ crash: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(claim.runRef), row: 'W-05', status: 'reconciled',
    reason: 'not_entered' }], problems: [] });
  expect((await execution(h, claim.runRef)).run).toMatchObject({ status: 'starting', executionAuthorization: { phase: 'revoked', generation: 1 } });
  phases.push((await h.goalDisplay()).phase);

  // The operator adopts the unrelated P2 (Host `plans/apply`): the claim's Plan is now older than the active Plan.
  const p2 = await hostAdopt(h, 'ag2b-plan-c6-run03', draft => ({ ...draft, tasks: [...draft.tasks, futureIntent(T3)] }),
    { text: 'C6 RUN-03: an unrelated future intent', sources: [] }, 'c6-run03-p2');
  phases.push((await h.goalDisplay()).phase);

  // RUN-03: the next 推进 re-authorizes the same claim at generation 2; the entry-plan guard finds T1 carried unchanged
  // into P2 (C6) and names P2; T1 enters with the claim's Plan and completes; no new claim, no TaskRequeue.
  const resumed = await advanceLogged(h, h.select('c6-run03-after', T1), phases);
  const kinds = resumed.receipts.map(receipt => receipt.kind);
  expect(kinds).not.toContain('claim_task');
  expect(kinds).toContain('start');
  const ended = await execution(h, claim.runRef);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed', planRef: p1.ref,
    executionAuthorization: { schemaVersion: 2, generation: 2 } });
  expect(ended.session.ref).toMatchObject({ sessionId: s1.sessionId });
  const authorized = authorizedEventsIn(h.database).filter(event => event.permit.claim.runRef.runId === claim.runRef.runId);
  expect(authorized, 'RUN-02 under P1, then RUN-03 under P2').toHaveLength(2);
  expect(authorized[0]?.activePlanRef).toBeUndefined();
  expect(authorized[1]).toMatchObject({ activePlanRef: p2.ref, permit: expect.objectContaining({ claim }) });
  expect(await h.taskRow(T1)).toMatchObject({ execution: claim.runRef });
  expect((await advanceLogged(h, h.select('c6-run03-goal'), phases)).state).toBe('completed');
  expect(phases).not.toContain('FAILED');
  expect(h.lastWorld?.requeues).toEqual([]);
  expect(h.modelCalls()).toBe(2);
  await h.drainAbandoned();
}, 120_000);
