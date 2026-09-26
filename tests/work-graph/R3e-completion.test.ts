/**
 * R3e.3 formal Task/Goal completion domain behaviour tests (stage-one skeleton).
 *
 * Every precondition comes from the REAL R3e fixture: a static CompletionPolicy
 * adopted through the public bootstrap writer, an independent Goal/Plan/Session/
 * claim whose subject Run was ended by the formal B2 path, the real RecordStore,
 * the real verification workspace and the real R3e.1 `EvidencePort`.
 *
 * These are FINAL behaviour assertions. Until the completion implementation
 * lands, every legal completion request returns `unsupported`, so each test
 * stops at its first completion assertion and the replay/read-back tails are NOT
 * reached. No Evidence/PASS/TaskReduction is raw-seeded and no gate Run is
 * fabricated: the rounds are produced by the formal begin/record/finalize path
 * and the gate round uses a real same-Goal ended work producer Run.
 *
 * Specification: docs/refactor/tasks/R3e-completion-skeleton.md §9.5.1.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CheckProcessObservation, RoundSnapshot } from '../../src/contracts/verification.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { readBatch, readGoalScope, readRevisionNumber } from '../../src/core/work-graph/tasks/plan-readers.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import {
  createR3eEvidenceFixture, R3E_GATE_TASK_ID, R3E_WORK_TASK_ID, type R3eEvidenceFixture,
} from '../helpers/R3e-evidence-fixture.js';

const fixtures: R3eEvidenceFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

async function openFixture(): Promise<R3eEvidenceFixture> {
  const fixture = await createR3eEvidenceFixture('memory', COMPLETION_RECORD_SCHEMAS);
  fixtures.push(fixture);
  return fixture;
}

/** A real-shaped executed observation for the formal record path; the round's
 * own source is re-captured by the service, so PASS is never fabricated here. */
function executedObservation(text: string): CheckProcessObservation {
  return {
    kind: 'executed', startedAt: B2_AT, finishedAt: B2_AT, exitCode: 0, signal: null,
    timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 'r3e-workspace-revision-1', changedPaths: [] },
    sandboxProfileVersion: 'bwrap-m3-v4',
  };
}

async function latestRound(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref']): Promise<RoundSnapshot> {
  const read = await fixture.evidence.readVerification(fixture.ctx, ref);
  expect(read, 'directed round read').toMatchObject({ status: 'ready' });
  if (read.status !== 'ready') throw Error('round read did not succeed');
  return read.value;
}

/** Formal begin/record for every fixed check, then finalize the whole round. */
async function finishRound(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref']): Promise<RoundSnapshot> {
  let round = await latestRound(fixture, ref);
  for (const check of round.checks) {
    const begin = await fixture.evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, check.checkId));
    expect(begin, `begin ${check.checkId}`).toMatchObject({ status: 'committed' });
    if (begin.status !== 'committed') throw Error(`begin ${check.checkId} did not commit`);
    round = await latestRound(fixture, ref);
    const recorded = await fixture.evidence.recordCheckResult(fixture.ctx,
      fixture.recordRequest(round, check.checkId, begin.value.invocationId, executedObservation(`R3E_OK_${check.checkId}\n`)));
    expect(recorded, `record ${check.checkId}`).toMatchObject({ status: 'committed' });
    if (recorded.status !== 'committed') throw Error(`record ${check.checkId} did not commit`);
    round = recorded.value;
  }
  const finalized = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(round));
  expect(finalized, 'the formal round finalizes into mechanical Evidence')
    .toMatchObject({ status: 'committed', value: { applicable: true, outcome: 'PASS' } });
  if (finalized.status !== 'committed') throw Error('round finalize did not commit');
  return finalized.value.snapshot;
}

async function goalRevision(fixture: R3eEvidenceFixture, goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string }): Promise<number> {
  const read = await fixture.b2.base.plans.queryGoal(fixture.ctx, goalRef);
  expect(read, 'Goal read').toMatchObject({ status: 'ready' });
  if (read.status !== 'ready') throw Error('Goal read did not succeed');
  return read.value.goal.revision;
}

it('completes work and the Goal gate from formal rounds, then reads back satisfied and COMPLETED', async () => {
  const fixture = await openFixture();
  const projectId = fixture.scope.projectId;
  const goalId = fixture.goalRef.goalId;

  // An optional future plan_only intent adopted through the public W1 path: it
  // must stay visible on the graph and must never block a normal completion.
  const futurePlan = await fixture.adoptUnrelatedFutureEdit('r3e-completion-plan-future', 'r3e-completion-future');
  const planRef = futurePlan.ref;

  const workOpened = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest({ planRef }));
  expect(workOpened, 'the work round opens').toMatchObject({ status: 'committed', value: { subject: { taskId: R3E_WORK_TASK_ID } } });
  if (workOpened.status !== 'committed') throw Error('work round open did not commit');
  const workRound = await finishRound(fixture, workOpened.value.ref);

  const gateSubject = { ...fixture.subject, taskId: R3E_GATE_TASK_ID };
  const gateOpened = await fixture.evidence.openVerification(fixture.ctx,
    fixture.openRequest({ subject: gateSubject, planRef, gateSubject: 'goal' }));
  expect(gateOpened, 'the Goal gate round opens on its own subject').toMatchObject({ status: 'committed', value: { subject: { taskId: R3E_GATE_TASK_ID } } });
  if (gateOpened.status !== 'committed') throw Error('gate round open did not commit');
  const gateRound = await finishRound(fixture, gateOpened.value.ref);

  const goalAt = await goalRevision(fixture, fixture.goalRef);
  const workReductionRef = { aggregateType: 'TaskReduction' as const, projectId, goalId, taskId: R3E_WORK_TASK_ID };
  const completeWorkRequest = {
    input: { taskRef: fixture.subject, planRef, roundRef: workRound.ref },
    meta: { requestId: 'r3e-completion-work', expected: [
      { ref: fixture.goalRef, revision: goalAt },
      { ref: workReductionRef, revision: 0 },
    ] },
  };
  const completedWork = await fixture.b2.base.goals.completeTask(fixture.ctx, completeWorkRequest);
  expect(completedWork, 'work completion must commit the formal satisfied reduction')
    .toMatchObject({ status: 'committed', value: { phase: 'satisfied' } });
  if (completedWork.status !== 'committed') throw Error('work completion did not commit');

  const gateReductionRef = { aggregateType: 'TaskReduction' as const, projectId, goalId, taskId: R3E_GATE_TASK_ID };
  const completedGate = await fixture.b2.base.goals.completeTask(fixture.ctx, {
    input: { taskRef: gateSubject, planRef, roundRef: gateRound.ref },
    meta: { requestId: 'r3e-completion-gate', expected: [
      { ref: fixture.goalRef, revision: goalAt },
      { ref: gateReductionRef, revision: 0 },
    ] },
  });
  expect(completedGate, 'the Goal gate completion must commit').toMatchObject({ status: 'committed', value: { phase: 'satisfied' } });
  if (completedGate.status !== 'committed') throw Error('gate completion did not commit');

  const goalBeforeComplete = await goalRevision(fixture, fixture.goalRef);
  const goalPhaseRef = { aggregateType: 'GoalPhase' as const, projectId, goalId };
  const completedGoal = await fixture.b2.base.goals.completeGoal(fixture.ctx, {
    input: { goalRef: fixture.goalRef },
    meta: { requestId: 'r3e-completion-goal', expected: [
      { ref: fixture.goalRef, revision: goalBeforeComplete },
      { ref: goalPhaseRef, revision: 0 },
    ] },
  });
  expect(completedGoal, 'the Goal completion must write the formal COMPLETED phase')
    .toMatchObject({ status: 'committed', value: { phase: 'COMPLETED', planRef } });
  if (completedGoal.status !== 'committed') throw Error('Goal completion did not commit');

  const graph = await fixture.b2.base.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef, planRef });
  expect(graph, 'the graph is readable after completion').toMatchObject({ status: 'ready' });
  if (graph.status !== 'ready') throw Error('graph read did not succeed');
  const workRow = graph.value.tasks.find(row => row.ref.taskId === R3E_WORK_TASK_ID);
  const gateRow = graph.value.tasks.find(row => row.ref.taskId === R3E_GATE_TASK_ID);
  expect(workRow, 'the work task is formally satisfied').toMatchObject({ effectivePhase: 'satisfied' });
  expect(gateRow, 'the Goal gate is formally satisfied').toMatchObject({ effectivePhase: 'satisfied' });
  const optionalFuture = graph.value.tasks.find(row => row.ref.taskId === 'r3e-future-intent');
  expect(optionalFuture, 'the optional future intent stays visible on the graph').toBeDefined();
  expect(optionalFuture?.definition.executionIntent, 'the future intent stays plan_only').toBe('plan_only');
  expect(graph.value.completion, 'the formal Goal completion is projected').toMatchObject({
    status: 'recorded', snapshot: { phase: 'COMPLETED' }, selectedPlanMatches: true,
  });

  // The ORIGINAL completion request replays its original value/cursor.
  const replayedWork = await fixture.b2.base.goals.completeTask(fixture.ctx, completeWorkRequest);
  expect(replayedWork, 'the original work completion request replays').toEqual({ ...completedWork, replayed: true });
});

it('keeps a Goal with a required future intent and a missing required reviewer incomplete', async () => {
  const fixture = await openFixture();
  const projectId = fixture.scope.projectId;
  const now = () => B2_AT;
  let eventSeq = 0;
  const eventId = () => `r3e-completion-event-${++eventSeq}`;
  const bootstrap = createProjectBootstrapServices({ records: fixture.records, now, eventId });
  const projectRef = { aggregateType: 'Project' as const, projectId };
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };

  // A policy that really requires independent review, installed/activated
  // through the public bootstrap writers (the shared fixture policy does not).
  const policyId = 'r3e-reviewer-policy';
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId, revision: 1 };
  const scopeNow = await readGoalScope(fixture.records, fixture.goalRef);
  if (scopeNow.status !== 'ready') throw Error('project scope read failed');
  const installed = await bootstrap.completionPolicies.installCompletionPolicy(fixture.ctx, {
    meta: { requestId: 'r3e-completion-install-reviewer', expected: [
      { ref: projectRef, revision: scopeNow.projectRevision },
      { ref: policyRef, revision: 0 },
    ] },
    input: { policyId, contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static', 'reviewer'], minimumRequiredRequirementsPerObligation: 1 } },
  });
  if (installed.status !== 'committed') throw Error(`reviewer policy install failed: ${JSON.stringify(installed)}`);
  const scopeAfter = await readGoalScope(fixture.records, fixture.goalRef);
  if (scopeAfter.status !== 'ready') throw Error('project scope re-read failed');
  const activeKey = canonicalJson(activeRef as unknown as JsonValue);
  const activeRead = await readBatch(fixture.records, [activeKey]);
  if (activeRead.status !== 'ready') throw Error('active completion policy pointer read failed');
  const activeRevision = readRevisionNumber(activeRead.batch, activeKey);
  const activated = await bootstrap.completionPolicies.activateCompletionPolicy(fixture.ctx, {
    meta: { requestId: 'r3e-completion-activate-reviewer', expected: [
      { ref: projectRef, revision: scopeAfter.projectRevision },
      { ref: activeRef, revision: activeRevision ?? 1 },
    ] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
  });
  if (activated.status !== 'committed') throw Error(`reviewer policy activation failed: ${JSON.stringify(activated)}`);

  const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'r3e-reviewer-goal' };
  const created = await fixture.b2.base.goals.createGoal(fixture.ctx, {
    meta: { requestId: 'r3e-completion-reviewer-goal', expected: [] },
    input: { goalId: goalRef.goalId, workspace: fixture.scope, objective: 'R3e required-future and reviewer subject' },
  });
  if (created.status !== 'committed') throw Error(`reviewer Goal creation failed: ${JSON.stringify(created)}`);

  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 'r3e-reviewer-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [
      { taskId: 'r3e-reviewer-work', title: 'Required work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'r3e-reviewer-gate', title: 'Required Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'r3e-reviewer-future', title: 'Required future intent', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' },
    ],
    assignments: [{ taskId: 'r3e-reviewer-work', role: 'builder', instruction: 'Do the required work' }],
    obligations: [{ obligationId: 'r3e-reviewer-obligation', title: 'Required acceptance', requirementLevel: 'required',
      taskIds: ['r3e-reviewer-work', 'r3e-reviewer-gate'],
      verificationRequirements: [
        { requirementId: 'r3e-reviewer-static', requirementLevel: 'required', kind: 'static', description: 'Registered static command check' },
        { requirementId: 'r3e-reviewer-human', requirementLevel: 'required', kind: 'reviewer', description: 'Independent review' },
      ] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
  const proposed = await fixture.b2.base.plans.proposePlan(fixture.ctx, {
    meta: { requestId: 'r3e-completion-reviewer-propose', expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: 'R3e required future/reviewer subject', sources: [] } },
  });
  expect(proposed, 'the reviewer Plan proposal is admissible').toMatchObject({ status: 'committed' });
  if (proposed.status !== 'committed') throw Error('reviewer Plan proposal did not commit');
  const applied = await fixture.b2.base.plans.applyPlanChange(fixture.ctx, {
    meta: { requestId: 'r3e-completion-reviewer-apply', expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
  });
  expect(applied, 'the reviewer Plan is adopted').toMatchObject({ status: 'committed' });
  if (applied.status !== 'committed') throw Error('reviewer Plan adoption did not commit');

  const graph = await fixture.b2.base.plans.queryTaskGraph(fixture.ctx, { goalRef });
  expect(graph, 'the reviewer graph is readable').toMatchObject({ status: 'ready' });
  if (graph.status !== 'ready') throw Error('reviewer graph read did not succeed');
  const futureRow = graph.value.tasks.find(row => row.ref.taskId === 'r3e-reviewer-future');
  expect(futureRow, 'the required future intent stays visible and is not deleted').toBeDefined();
  expect(futureRow?.definition.executionIntent).toBe('plan_only');

  const goalAt = await goalRevision(fixture, goalRef);
  const goalPhaseRef = { aggregateType: 'GoalPhase' as const, projectId, goalId: goalRef.goalId };
  const completed = await fixture.b2.base.goals.completeGoal(fixture.ctx, {
    input: { goalRef },
    meta: { requestId: 'r3e-completion-reviewer-goal-complete', expected: [
      { ref: goalRef, revision: goalAt },
      { ref: goalPhaseRef, revision: 0 },
    ] },
  });
  expect(completed, 'a required future intent / missing required reviewer keeps the Goal incomplete')
    .toMatchObject({ status: 'rejected', code: 'incomplete' });
});
