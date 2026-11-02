/**
 * PL-27: a real candidate carries one required obligation whose verification
 * requirement kind (`dynamic`) is valid policy but has no registered check, so
 * the mechanical diagnosis must hit `no_registered_check`; the review
 * request/input shows it, the candidate is never `accepted`, and
 * `decisions/candidate-card` carries the four facts (`card`, diagnosis finding,
 * `exactReview`, `exportRead`), each readable on its own (spec §15 PL-27,
 * DR-P4-16). Coverage is by `coversKinds`, not by a check's `taskIds`
 * (`src/contracts/verification.ts:334`), so the policy names both kinds while
 * the registered check covers only `static`.
 *
 * The entry is the real `plans/propose` path and the fixture's reviewer line.
 * The named mutation is making `diagnosePlanCandidate` return empty for an
 * uncovered requirement; the finding and the "no automatic adoption" assertions
 * must go red.
 *
 * The review body is read in full: the diagnosis's obligation/requirement ids
 * and its `no_registered_check` message must actually enter the review input,
 * not only the card's own diagnosis read.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { AcceptanceObligation, PlanRevisionDraft, RuntimeTask } from '../../src/contracts/plan.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { readBody, waitForResponse } from '../helpers/IV-host-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { checkConfiguration, committed, ready } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, plPlanChangeDraft, settlePLGoal,
  type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

// The read faults sit on the real record-store boundary (A2/A4), the same way as PL-14.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });
afterEach(() => { expect(commitBarrier.reset()).toEqual([]); });

const PASS = '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}';

it('PL-27: an uncovered required obligation is diagnosed, never auto-adopted, and read on the card', async () => {
  // The registered static check covers only `static`; `dynamic` is a valid policy
  // kind with no registered capability, so the diagnosis must hit.
  const baseChecks = checkConfiguration({ kind: 'human', id: OPERATOR.id });
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-27', extraHostOptions: {
    checks: { ...baseChecks, configurationRevision: 'pl-27-checks@1', checks: [baseChecks.checks[0]!] },
  } });
  // The Plan's pinned policy must name both kinds, or plan validation rejects the
  // dynamic requirement before diagnosis can see it.
  const registration = ready<{ project: { revision: number } }>(
    await workflow.main.route('workspaces/registration', {
      projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId,
    }), 'PL-27 workspace registration');
  const activePolicy = ready<{ active: { revision: number } }>(
    await workflow.main.route('completion-policies/read', { projectId: S6A_SCOPE.projectId }),
    'PL-27 active policy');
  const projectPin = { ref: { aggregateType: 'Project' as const, projectId: S6A_SCOPE.projectId },
    revision: registration.project.revision };
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: S6A_SCOPE.projectId,
    policyId: 'pl-27-policy', revision: 1 };
  const installed = committed<{ ref: unknown; contentDigest: string }>(
    await workflow.main.post('completion-policies/install', graphWrite(S6A_SCOPE, {
      policyId: policyRef.policyId, contentRevision: policyRef.revision,
      content: { schemaVersion: 1, requirementKinds: ['static', 'dynamic'],
        minimumRequiredRequirementsPerObligation: 1 },
    }, 'pl-27-policy-install', [projectPin, { ref: policyRef, revision: 0 }])), 'PL-27 policy install');
  committed(await workflow.main.post('completion-policies/activate', graphWrite(S6A_SCOPE, {
    target: { ref: installed.ref, digest: installed.contentDigest },
  }, 'pl-27-policy-activate', [projectPin, {
    ref: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: S6A_SCOPE.projectId },
    revision: activePolicy.active.revision,
  }])), 'PL-27 policy activation');
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-27', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-27-reviewer');
  await workflow.world.scripted.script(reviewer, [{ kind: 'text', text: PASS }]);
  await workflow.world.scripted.script(reviewer, [{ kind: 'text', text: PASS }]);

  // The candidate adds one required executable Task with a new required obligation
  // whose `dynamic` requirement no registered check covers.
  const target: RuntimeTask = {
    taskId: 'pl-review-target', stageId: 'pl-stage-2', title: 'PL-27 uncovered target',
    requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'stage', stageId: 'pl-stage-2' }, executionIntent: 'request_execution',
    estimatedLines: 10, sizeClass: 'small',
  };
  const obligation: AcceptanceObligation = {
    obligationId: 'pl-obligation-review', title: 'PL-27 uncovered acceptance',
    requirementLevel: 'required', taskIds: [target.taskId],
    verificationRequirements: [{ requirementId: 'pl-requirement-review', requirementLevel: 'required',
      kind: 'dynamic', description: 'PL-27 has no registered check for this requirement' }],
  };
  const draft: PlanRevisionDraft = plPlanChangeDraft(skeleton.plan, workflow.goal, {
    planId: 'pl-plan-pl-27',
    tasks: [...skeleton.plan.tasks, target],
    assignments: [...(skeleton.plan.assignments ?? []), { taskId: target.taskId,
      role: S6A_WORK_ROLE.templateId, instruction: 'PL-27 uncovered executable work' }],
    obligations: [...skeleton.plan.obligations, obligation],
  });
  const proposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft,
    reason: { text: 'PL-27 uncovered candidate', sources: [], affectedTaskIds: [target.taskId] },
  }, 'pl-27-propose'))) as { status: string; value?: PlanProposal };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  const candidate = proposed.value;
  if (candidate === undefined) throw new Error('PL-27: the candidate was not written');

  // The candidate is a real `candidate` on the active Plan's next revision.
  expect(candidate.status).toBe('candidate');
  expect(candidate.revision).toBe(1);
  expect(candidate.draft.planRevision).toBe(skeleton.plan.planRevision + 1);

  // The target-level pass computes the diagnosis and sends the review request.
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-27-pass', sessionHint: null, kind: 'select_work' });

  // The review request exists and carries this candidate's identity; the candidate
  // is still not accepted.
  const reviewRounds = (await listed(workflow.world, 'inbox', reviewer)).filter(message =>
    message.sender.kind === 'host' && message.sender.actor.kind === 'system');
  const reviewBodies = await Promise.all(reviewRounds.map(async message =>
    await readBody(workflow.world, message.ref, 'message')));
  const reviewIndexes = reviewBodies
    .map((text, index) => (text.split('\n')[0] ?? '').startsWith(`planreview:${candidate.ref.proposalId}:1`)
      ? index : -1)
    .filter(index => index >= 0);
  expect(reviewIndexes).toHaveLength(1);
  const reviewRound = reviewRounds[reviewIndexes[0]!]!;
  await waitForResponse(workflow.world, reviewRound.ref);
  // The complete input carries this diagnosis: its obligation/requirement ids and
  // the `no_registered_check` message, never the empty "机械诊断：无" line.
  const reviewInput = await readBody(workflow.world, reviewRound.ref, 'message');
  expect(reviewInput).toContain('pl-obligation-review/pl-requirement-review');
  expect(reviewInput).toContain('没有已注册的检查能覆盖这条必需验证要求');
  expect(reviewInput).not.toContain('机械诊断：无');
  const still = ready<PlanProposal>(await workflow.main.route('plans/proposal', candidate.ref),
    'plans/proposal');
  expect(still.status).toBe('candidate');

  // The compound card: each sub-read has its own fact, and the diagnosis finding is
  // visible; a failed sub-read writes its own explicit line and is never folded to empty.
  type Facts = { card: { source: { kind?: string } };
    diagnosis: Array<{ obligationId: string; requirementId: string; code: string }> | null;
    exactReview: { status: string; value?: { status: string; verdict?: string } };
    exportRead: { status: string } };
  const readCard = async () => ready<Facts>(await workflow.world.post('decisions/candidate-card', {
    scope: { ...S6A_SCOPE }, input: { goalRef: workflow.goal, proposalRef: candidate.ref },
  }), 'decisions/candidate-card');
  const card = await readCard();
  expect(card.card.source.kind).toBe('candidate');
  expect(card.diagnosis).toContainEqual(expect.objectContaining({ obligationId: 'pl-obligation-review',
    requirementId: 'pl-requirement-review', kind: 'dynamic', code: 'no_registered_check' }));
  expect(card.exactReview).toMatchObject({ status: 'ready', value: { status: 'decided', verdict: 'pass' } });
  expect(['ready', 'not_configured', 'unavailable']).toContain(card.exportRead.status);
  // The export read's own line: each stage's §5.3.4 path, and nothing exported before the card row is reached.
  const taskbook = (stageId: string) => `/taskbooks/${S6A_SCOPE.projectId}/${S6A_SCOPE.workspaceId}/`
    + `${workflow.goal.goalId}/goal-${workflow.goal.goalId}__plan-pl-plan-pl-27__stage-${stageId}__rev-2.md`;
  expect(card.exportRead).toMatchObject({ status: 'ready', stages: ['pl-stage-1', 'pl-stage-2'].map(stageId => ({
    state: 'missing', stageId, path: expect.stringContaining(taskbook(stageId)) })) });

  // The Goal judges the candidate after the `pass`: the diagnosis stops adoption and the card names that row.
  const settled = await settlePLGoal(workflow.world, workflow.goal, 'pl-27-after-pass') as {
    value: { state: string; next: unknown; reason: string | null; source?: { kind: string } };
  };
  expect(settled.value).toMatchObject({ state: 'waiting', next: null, source: { kind: 'candidate' } });
  expect(settled.value.reason).toContain('plan_candidate_waiting: diagnosis');
  expect(ready<PlanProposal>(await workflow.main.route('plans/proposal', candidate.ref), 'plans/proposal').status)
    .toBe('candidate');
  expect((await workflow.main.activePlan(workflow.goal))?.ref).toEqual(skeleton.plan.ref);

  // The card row exported the candidate's taskbooks: the read now gives the written files.
  const carded = await readCard();
  expect(carded.exportRead).toMatchObject({ status: 'ready', stages: ['pl-stage-1', 'pl-stage-2'].map(stageId => ({
    state: 'written', stageId, path: expect.stringContaining(taskbook(stageId)) })) });

  // PL-25/27: a Store read that throws stays inside its own member; the route answers and the other three are read.
  const readUnderFault = async (refKey: string) => {
    const fault = commitBarrier.failReads(refKey, 'throw-always');
    try {
      const answer = await workflow.world.post('decisions/candidate-card', {
        scope: { ...S6A_SCOPE }, input: { goalRef: workflow.goal, proposalRef: candidate.ref },
      });
      // The fault really hit this read, not an unrelated one.
      expect(fault.calls()).toBeGreaterThan(0);
      expect(answer.httpStatus, JSON.stringify(answer.body)).toBe(200);
      return ready<Facts>(answer, 'decisions/candidate-card');
    } finally {
      fault.release();
    }
  };
  const noReview = await readUnderFault(canonicalRefKey(interventionPlanningQueryRefs(reviewRound.ref).queryJobRef));
  expect(noReview.exactReview).toMatchObject({ status: 'rejected', code: 'unavailable',
    reason: expect.stringContaining('injected readMany I/O failure') });
  expect(noReview.card).toEqual(carded.card);
  expect(noReview.diagnosis).toEqual(carded.diagnosis);
  expect(noReview.exportRead).toEqual(carded.exportRead);

  const noDiagnosis = await readUnderFault(canonicalRefKey(skeleton.plan.effectiveCompletionPolicy.ref));
  expect(noDiagnosis.diagnosis).toBeNull();
  expect(noDiagnosis.card).toEqual(carded.card);
  expect(noDiagnosis.exactReview).toEqual(carded.exactReview);
  expect(noDiagnosis.exportRead).toEqual(carded.exportRead);
});
