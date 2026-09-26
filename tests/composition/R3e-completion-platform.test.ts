/**
 * R3e.3 formal Task/Goal completion composition-root behaviour tests
 * (stage-one skeleton).
 *
 * On a real SQLite ledger the public `createTargetPlatform` publishes the
 * domain Goal/Plan ports, the real R3e.1 `platform.evidence` and the trusted
 * Host `platform.checks.runRegisteredCheck` (real Kernel ProcessSandbox). The
 * subject Goal/Plan/claim/ended Run come from the real R3e SQLite fixture; the
 * work and Goal-gate rounds are executed through the real registered checks and
 * finalized into persistent Evidence.
 *
 * These are FINAL behaviour assertions: until the completion implementation
 * lands, `goals.completeTask` returns `unsupported`, so the test stops at its
 * first completion call and the restart/replay tail is NOT reached. The gate
 * round references the SAME Goal's real ended ordinary work Run and never
 * claims/fabricates a gate Run. No Evidence/PASS/TaskReduction is raw-seeded.
 *
 * Specification: docs/refactor/tasks/R3e-completion-skeleton.md §9.5.2.
 */
import { afterEach, expect, it } from 'vitest';
import { createTargetPlatform, type TargetPlatformOptions } from '../../src/composition/create-platform.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import {
  createR3eEvidenceFixture, R3E_GATE_TASK_ID, R3E_WORK_TASK_ID, type R3eEvidenceFixture,
} from '../helpers/R3e-evidence-fixture.js';

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function prepared(): Promise<{ fixture: R3eEvidenceFixture; options: TargetPlatformOptions; platform: Platform }> {
  const fixture = await createR3eEvidenceFixture('sqlite');
  cleanups.push(() => fixture.close());
  await fixture.b2.base.closeBackend();
  const options: TargetPlatformOptions = {
    storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
    workspace: fixture.workspaceHost,
    checks: fixture.configuration,
    now: () => B2_AT,
  };
  const platform = await createTargetPlatform(options);
  cleanups.push(() => platform.close());
  return { fixture, options, platform };
}

/** Run every compiled fixed check through the real sandbox, then finalize. */
async function executeAndFinalize(platform: Platform, fixture: R3eEvidenceFixture, opened: RoundSnapshot): Promise<RoundSnapshot> {
  let latest = opened;
  for (const check of opened.checks) {
    const run = await platform.checks.runRegisteredCheck(fixture.ctx, {
      input: { roundRef: latest.ref, checkId: check.checkId },
      meta: { requestId: `r3e-completion-run-${latest.ref.roundId}-${check.checkId}`,
        expected: [{ ref: latest.ref, revision: latest.revision }] },
    });
    expect(run, `registered check ${check.checkId} must reach the persisted round view`).toMatchObject({ status: 'ready' });
    if (run.status !== 'ready') throw Error(`registered check ${check.checkId} did not run: ${JSON.stringify(run)}`);
    latest = run.value;
  }
  const finalized = await platform.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(latest));
  expect(finalized, 'the real checks finalize into persistent Evidence')
    .toMatchObject({ status: 'committed', value: { applicable: true, outcome: 'PASS' } });
  if (finalized.status !== 'committed') throw Error('the completion round did not finalize');
  return finalized.value.snapshot;
}

it('runs the real registered checks, completes work and goal, and replays the original receipt after reopen', async () => {
  const { fixture, options, platform } = await prepared();
  const projectId = fixture.scope.projectId;
  const goalId = fixture.goalRef.goalId;

  const workOpened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  expect(workOpened, 'the work round opens on the real platform').toMatchObject({ status: 'committed' });
  if (workOpened.status !== 'committed') throw Error('work round open did not commit');
  const workRound = await executeAndFinalize(platform, fixture, workOpened.value);

  const gateSubject = { ...fixture.subject, taskId: R3E_GATE_TASK_ID };
  const gateOpened = await platform.evidence.openVerification(fixture.ctx,
    fixture.openRequest({ subject: gateSubject, gateSubject: 'goal' }));
  expect(gateOpened, 'the Goal gate round opens on its own subject').toMatchObject({ status: 'committed' });
  if (gateOpened.status !== 'committed') throw Error('gate round open did not commit');
  expect(gateOpened.value.subject.taskId, 'the gate round keeps its own gate subject').toBe(R3E_GATE_TASK_ID);
  expect(gateOpened.value.subjectRunRef, 'the gate round references the same-Goal ended ordinary producer Run')
    .toEqual(fixture.subjectRunRef);
  const gateRound = await executeAndFinalize(platform, fixture, gateOpened.value);

  const goalRead = await platform.plans.queryGoal(fixture.ctx, fixture.goalRef);
  expect(goalRead, 'the Goal is readable').toMatchObject({ status: 'ready' });
  if (goalRead.status !== 'ready') throw Error('Goal read did not succeed');
  const goalAt = goalRead.value.goal.revision;

  const workReductionRef = { aggregateType: 'TaskReduction' as const, projectId, goalId, taskId: R3E_WORK_TASK_ID };
  const completeWorkRequest = {
    input: { taskRef: fixture.subject, planRef: fixture.planRef, roundRef: workRound.ref },
    meta: { requestId: 'r3e-completion-platform-work', expected: [
      { ref: fixture.goalRef, revision: goalAt },
      { ref: workReductionRef, revision: 0 },
    ] },
  };
  const completedWork = await platform.goals.completeTask(fixture.ctx, completeWorkRequest);
  expect(completedWork, 'work completion must commit from the real Evidence')
    .toMatchObject({ status: 'committed', value: { phase: 'satisfied' } });
  if (completedWork.status !== 'committed') throw Error('work completion did not commit');

  const gateReductionRef = { aggregateType: 'TaskReduction' as const, projectId, goalId, taskId: R3E_GATE_TASK_ID };
  const completedGate = await platform.goals.completeTask(fixture.ctx, {
    input: { taskRef: gateSubject, planRef: fixture.planRef, roundRef: gateRound.ref },
    meta: { requestId: 'r3e-completion-platform-gate', expected: [
      { ref: fixture.goalRef, revision: goalAt },
      { ref: gateReductionRef, revision: 0 },
    ] },
  });
  expect(completedGate, 'the Goal gate completion must commit').toMatchObject({ status: 'committed', value: { phase: 'satisfied' } });
  if (completedGate.status !== 'committed') throw Error('gate completion did not commit');

  const goalPhaseRef = { aggregateType: 'GoalPhase' as const, projectId, goalId };
  const completedGoal = await platform.goals.completeGoal(fixture.ctx, {
    input: { goalRef: fixture.goalRef },
    meta: { requestId: 'r3e-completion-platform-goal', expected: [
      { ref: fixture.goalRef, revision: goalAt },
      { ref: goalPhaseRef, revision: 0 },
    ] },
  });
  expect(completedGoal, 'the Goal completion must write the formal COMPLETED phase')
    .toMatchObject({ status: 'committed', value: { phase: 'COMPLETED' } });
  if (completedGoal.status !== 'committed') throw Error('Goal completion did not commit');

  const graph = await platform.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef });
  expect(graph, 'the graph reads back').toMatchObject({ status: 'ready' });
  if (graph.status !== 'ready') throw Error('graph read did not succeed');
  expect(graph.value.tasks.find(row => row.ref.taskId === R3E_WORK_TASK_ID)).toMatchObject({ effectivePhase: 'satisfied' });
  expect(graph.value.tasks.find(row => row.ref.taskId === R3E_GATE_TASK_ID)).toMatchObject({ effectivePhase: 'satisfied' });
  expect(graph.value.completion, 'the formal Goal completion is projected').toMatchObject({
    status: 'recorded', snapshot: { phase: 'COMPLETED' }, selectedPlanMatches: true,
  });

  // Close and reopen the same SQLite and read the completed facts plus the
  // ORIGINAL completion receipt.
  await platform.close();
  const reopened = await createTargetPlatform(options);
  cleanups.push(() => reopened.close());
  const reopenedGraph = await reopened.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef });
  expect(reopenedGraph, 'the completed Goal survives a close/reopen').toMatchObject({
    status: 'ready', value: { completion: { status: 'recorded', snapshot: { phase: 'COMPLETED' } } },
  });
  const replayedWork = await reopened.goals.completeTask(fixture.ctx, completeWorkRequest);
  expect(replayedWork, 'the original completion request replays after reopen').toEqual({ ...completedWork, replayed: true });
});
