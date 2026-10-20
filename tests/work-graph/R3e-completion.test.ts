/**
 * R3e.3 formal Task/Goal completion domain behaviour tests (stage-one skeleton).
 *
 * Every precondition comes from the REAL R3e fixture: a static CompletionPolicy
 * adopted through the public bootstrap writer, an independent Goal/Plan/Session/
 * claim, the real RecordStore and the real verification workspace. No Evidence/
 * PASS/TaskReduction is raw-seeded and no gate Run is fabricated.
 *
 * Specification: docs/refactor/tasks/R3e-completion-skeleton.md §9.5.1.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { readBatch, readGoalScope, readRevisionNumber } from '../../src/core/work-graph/tasks/plan-readers.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import { createR3eEvidenceFixture, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';

const fixtures: R3eEvidenceFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

async function openFixture(): Promise<R3eEvidenceFixture> {
  const fixture = await createR3eEvidenceFixture('memory', COMPLETION_RECORD_SCHEMAS);
  fixtures.push(fixture);
  return fixture;
}

async function goalRevision(fixture: R3eEvidenceFixture, goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string }): Promise<number> {
  const read = await fixture.b2.base.plans.queryGoal(fixture.ctx, goalRef);
  expect(read, 'Goal read').toMatchObject({ status: 'ready' });
  if (read.status !== 'ready') throw Error('Goal read did not succeed');
  return read.value.goal.revision;
}

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
