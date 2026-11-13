/**
 * PL-30 (v4 §15-30): a planning round carries a 102,400-byte searchable
 * `assignment.instruction`; the candidate is adopted and its Work Run model
 * input carries the whole instruction, not a 16 KiB cut. The same candidate's
 * `planreview:` preparation keeps the saved question at the request text and
 * its model input carries the whole candidate (the 64 KiB question bound is
 * not the candidate's bound).
 *
 * This row creates the frozen `intervention_planning`
 * `answerShape: 'plan_round'` intent through the public `queries/submit` /
 * `queries/claim` / `queries/prepare` / `queries/start` routes, with the real
 * source message. The model's saved plan answer then goes through the public
 * `plans/propose` route; the candidate read, adoption and Work Run are the
 * public `plans/proposal`, `plans/apply` and `workflow/advance` routes.
 *
 * The review side is the real goal-loop send: the same candidate's
 * `planreview:` system round goes to the reviewer line, the Host consumes it,
 * and the review Query's frozen preparation is the observation (the saved
 * `question` stays the request text).
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { QueryJobIntentV1, QueryJobRef } from '../../src/contracts/query-job.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { systemRoundRequestId } from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow, readQuery } from '../helpers/A2-restart-fixture.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import { plPlanChangeDraft } from '../helpers/PL-workflow-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { awaitProposal, heartbeatUntil, proposalRefOf, readBody, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, S6A_SECRETARY_ROLE,
} from '../helpers/S6A-request-fixture.js';
import {
  consumerOf, PL_REVIEWER_PROFILE_ID, reviewerBinding, reviewerProfile,
} from '../helpers/PL-forms-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { committed, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { claimProfile, claimQuery, prepareAttempt, start } from '../helpers/request-claim-steps.js';

const BIG = `PL30-BEGIN-${'x'.repeat(102_400 - 20)}-PL30-END`;
const BIG_BYTES = 102_400;
const BIG_HASH = createHash('sha256').update(BIG, 'utf8').digest('hex');
const LONG_TASK_ID = 'pl30-long-work';
const STAGE_ID = 'pl30-stage';
const STAGE_TITLE = 'PL-30 stage title';
const STAGE_DESCRIPTION = 'PL-30 stage description';
const PROJECT_REF = { aggregateType: 'Project' as const, projectId: S6A_SCOPE.projectId };
const WORKSPACE_REF = { aggregateType: 'Workspace' as const, projectId: S6A_SCOPE.projectId,
  workspaceId: S6A_SCOPE.workspaceId };

const REVIEWER = platformRoleProfile('reviewer');

type ProfileClaim = {
  roleBinding: RoleBindingRefV1; runtimeBudget: RuntimeBudget;
  budget: QueryJobIntentV1['budget']; consumerId: string;
};

let world: S6AHostWorld | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

/** The active plan plus the 100 KiB task, as the one model form the round takes. */
function planForm(active: PlanRevisionSnapshot): Record<string, unknown> {
  const tasks = active.tasks.map(task => ({
    taskId: task.taskId,
    ...(task.stageId === undefined ? {} : { stageId: task.stageId }),
    title: task.title,
    requirementLevel: task.requirementLevel,
    taskKind: task.taskKind,
    disposition: task.disposition,
    scope: task.scope,
    ...(task.taskKind === 'work' && task.executionIntent !== undefined
      ? { executionIntent: task.executionIntent } : {}),
  }));
  const assignments = (active.assignments ?? []).map(assignment => ({
    taskId: assignment.taskId, role: assignment.role, instruction: assignment.instruction,
  }));
  const obligations = active.obligations.map(obligation => ({
    obligationId: obligation.obligationId, title: obligation.title,
    requirementLevel: obligation.requirementLevel,
    taskIds: [...new Set([...obligation.taskIds, LONG_TASK_ID])],
    verificationRequirements: obligation.verificationRequirements.map(requirement => ({
      requirementId: requirement.requirementId, requirementLevel: requirement.requirementLevel,
      kind: requirement.kind, description: requirement.description,
    })),
  }));
  return {
    stages: [...active.stages.map(stage => ({ stageId: stage.stageId, title: stage.title,
      ...(stage.description === undefined ? {} : { description: stage.description }) })),
    { stageId: STAGE_ID, title: STAGE_TITLE, description: STAGE_DESCRIPTION }],
    tasks: [...tasks, {
      taskId: LONG_TASK_ID, stageId: STAGE_ID, title: 'PL-30 long instruction work',
      requirementLevel: 'required', taskKind: 'work', disposition: 'active',
      scope: { kind: 'stage', stageId: STAGE_ID }, executionIntent: 'request_execution',
    }],
    assignments: [...assignments, { taskId: LONG_TASK_ID, role: S6A_SECRETARY_ROLE.templateId, instruction: BIG }],
    obligations,
    taskHierarchy: active.taskHierarchy,
    executionDag: active.executionDag,
    taskRelations: active.taskRelations ?? [],
    inputRequirements: active.inputRequirements ?? [],
  };
}

/** A model message's text; tool messages carry no `content`. */
function contentOf(message: unknown): string {
  const value = (message as { content?: unknown }).content;
  return typeof value === 'string' ? value : '';
}

async function readGoalRevision(world: S6AHostWorld, goalRef: GoalRef): Promise<number> {
  const read = ready<{ goal: { revision: number } }>(
    (await world.post('goals/read', plain(S6A_SCOPE, goalRef))).body, 'the PL-30 Goal');
  return read.goal.revision;
}

function queryPins(goalRef: GoalRef, goalRevision: number, queryJobRef: QueryJobRef,
  queryRunRef: { aggregateType: 'QueryRun'; projectId: string; workspaceId: string; queryJobId: string; runId: string }) {
  return [
    { ref: PROJECT_REF, revision: 1 },
    { ref: WORKSPACE_REF, revision: 1 },
    { ref: goalRef, revision: goalRevision },
    { ref: queryJobRef, revision: 0 },
    { ref: queryRunRef, revision: 0 },
  ];
}

describe('PL-30: a 100 KiB task instruction reaches the Work Run and the review input', () => {
  it('submits the plan round, proposes and adopts the candidate, opens the Work Run, then prepares planreview',
    async () => {
      // A 100 KiB review input needs the 1M window: 200k leaves 100k of input beside its output reserve.
      const reviewBinding = reviewerBinding();
      reviewBinding.grant.budget = { ...reviewBinding.grant.budget, contextWindowTokens: 1_000_000 };
      const reviewProfile = reviewerProfile(reviewBinding);
      reviewProfile.runtimeBudget = { ...reviewProfile.runtimeBudget, contextWindowTokens: 1_000_000 };
      const opened = await openS6AHostWorld({
        backend: 'memory', configuration: 'with_secretary', secretaryWork: true,
        extraBindings: [{ binding: reviewBinding, queryProfile: reviewProfile }],
        // The Host's consume loop must run for the reviewer line that receives `planreview:`.
        extraHostOptions: { inputConsumers: [consumerOf(PL_REVIEWER_PROFILE_ID, 'pl30-review')] },
      });
      world = opened;
      const main = s6aCardsWorkspace(opened, S6A_SCOPE);
      await governS6B(opened, main, opened.goals);
      const goal = opened.goals.first;
      // First plan: its only work task belongs to the reviewer role, so the
      // refined secretary task is the one the Goal loop can claim.
      await adoptS6BPlan(main, goal, { label: 'pl30-base', taskIds: ['pl30-base-work'],
        role: REVIEWER.template.templateId });
      const secretary = await sessionOf(opened,
        await createS6BLine(main, { label: 'pl30-secretary', role: S6A_SECRETARY_ROLE }));
      const reviewer = await sessionOf(opened,
        await createS6BLine(main, { label: 'pl30-reviewer', role: REVIEWER.template }));
      const person = await sendS7A2PersonMessage(opened, {
        label: 'pl30-plan-round', recipient: secretary.ref, goal,
      });
      const body = ready<{ text: string }>((await opened.post('messages/body',
        plain(S6A_SCOPE, { messageRef: person.ref, part: 'message' }))).body, 'the PL-30 person text');

      const planningRefs = interventionPlanningQueryRefs(person.ref);
      const profile = await claimProfile(opened, S6A_SECRETARY_PROFILE_ID) as unknown as ProfileClaim;
      const intent: QueryJobIntentV1 = {
        schemaVersion: 1, intentId: planningRefs.queryJobRef.queryJobId,
        projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId, goalId: goal.goalId,
        question: body.text, focusTaskRefs: [], budget: profile.budget, multiTurn: { maxRounds: 1 },
        correlationId: 'pl30-planning-correlation',
        execution: { kind: 'intervention_planning', sourceMessageRef: person.ref,
          answerShape: 'plan_round', roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget },
      };
      const submitted = await opened.post('queries/submit', graphWrite(S6A_SCOPE, {
        queryJobId: planningRefs.queryJobRef.queryJobId, runId: planningRefs.queryRunRef.runId, intent,
      }, 'pl30-planning-submit',
      queryPins(goal, await readGoalRevision(opened, goal), planningRefs.queryJobRef, planningRefs.queryRunRef)));
      expect(submitted.body).toMatchObject({ status: 'committed' });
      const claimed = await claimQuery(opened, planningRefs.queryJobRef, secretary, null, 'pl30-planning-claim');
      if (claimed['status'] !== 'committed') {
        throw new Error(`PL-30 planning claim rejected: ${JSON.stringify(claimed)}`);
      }
      const prepared = await prepareAttempt(opened, planningRefs.queryJobRef, 'pl30-planning-prepare');

      const active = await main.activePlan(goal);
      if (active === null) throw new Error('PL-30: the base plan is not adopted');
      await opened.scripted.script(secretary, [{ kind: 'calls', calls: [{
        callId: 'pl30-plan-round', name: 'submit_plan_round',
        args: { answerKind: 'plan', summary: 'PL-30 100 KiB plan round', plan: planForm(active) },
      }] }, { kind: 'text', text: 'PL-30 Work Run answer' }]);
      const started = await start(opened, prepared as PreparedQueryExecution, 'pl30-planning-start');
      expect(started).toMatchObject({ status: 'ready' });
      const planning = await readQuery(opened.ag2b, planningRefs.queryJobRef);
      expect(planning.job.job).toMatchObject({ status: 'answered' });
      expect(planning.job.job.answerRefs).toHaveLength(1);
      expect(planning.job.job.intent.execution).toMatchObject({
        kind: 'intervention_planning', answerShape: 'plan_round', sourceMessageRef: person.ref,
      });

      // The Host's close-out writes the candidate from the saved plan answer.
      const candidate = ready<PlanProposal>(await awaitProposal(opened, proposalRefOf(person.ref, goal)),
        'the PL-30 candidate');
      expect(candidate.status).toBe('candidate');
      const assignment = (candidate.draft.assignments ?? []).find(entry => entry.taskId === LONG_TASK_ID);
      expect(assignment?.instruction.length).toBe(102_400);
      expect(Buffer.byteLength(assignment?.instruction ?? '', 'utf8')).toBe(102_400);
      expect(assignment?.instruction).toBe(BIG);

      // A person's message on the secretary line takes the policy's adoption from the Host's close-out.
      const adopted = await heartbeatUntil(opened,
        async () => ready<PlanProposal>((await opened.post('plans/proposal', plain(S6A_SCOPE, candidate.ref))).body,
          'the adopted PL-30 candidate'),
        read => read.status === 'accepted', 16);
      expect(adopted.status).toBe('accepted');

      // The adopted task's real Work Run: the Host claims it after the adoption, and its real model request is the
      // one asserted.
      const requests = await heartbeatUntil(opened, () => opened.scripted.requests(secretary),
        reads => reads.some(request => request.messages.some(message => contentOf(message).includes(`instruction: ${BIG}`))), 32);
      const workRequest = requests.find(request =>
        request.messages.some(message => contentOf(message).includes(`instruction: ${BIG}`)));
      expect(workRequest).toBeDefined();
      const input = workRequest?.messages.map(contentOf).find(content => content.includes(BIG)) ?? '';
      expect(input).toContain(`instruction: ${BIG}\nplan: `);
      const at = input.indexOf('instruction: ') + 'instruction: '.length;
      const embedded = input.slice(at, at + BIG_BYTES);
      expect(embedded).toBe(BIG);
      expect(createHash('sha256').update(embedded, 'utf8').digest('hex')).toBe(BIG_HASH);
      expect(input).toContain(`stage: ${STAGE_TITLE} (${STAGE_ID})`);
      expect(input.indexOf(`stage: ${STAGE_TITLE}`)).toBeGreaterThan(at + BIG_BYTES);

      // The review needs a candidate on the adopted plan; the long task changes, so its instruction is shown.
      const adoptedPlan = await main.activePlan(goal);
      if (adoptedPlan === null) throw new Error('PL-30: no adopted plan to review against');
      const proposed = committed(await opened.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: goal, basedOn: adoptedPlan.ref,
        draft: plPlanChangeDraft(adoptedPlan, goal, {
          planId: 'pl30-candidate', assignments: adoptedPlan.assignments ?? [], obligations: adoptedPlan.obligations,
          tasks: adoptedPlan.tasks.map(task => task.taskId === LONG_TASK_ID
            ? { ...task, estimatedLines: (task.estimatedLines ?? 0) + 1 } : task),
        }),
        reason: { text: 'PL-30 100 KiB candidate', sources: [] },
      }, 'pl30-propose', [])), 'the PL-30 candidate proposal') as { ref: PlanProposal['ref'] };
      const reviewCandidate = ready<PlanProposal>((await opened.post('plans/proposal',
        plain(S6A_SCOPE, proposed['ref']))).body, 'the PL-30 review candidate');

      // The review side is the real goal-loop send: the same candidate's `planreview:` goes to the
      // reviewer line, the Host consumes it and the review Query's preparation carries the candidate.
      const head = systemRoundRequestId({ kind: 'planreview', goalRef: goal,
        proposalId: reviewCandidate.ref.proposalId, proposalRevision: reviewCandidate.revision });
      expect(head.status).toBe('ready');
      if (head.status !== 'ready') throw new Error('PL-30: the planreview head is not ready');
      // The Host's own goal driver runs the candidate decision and the one system-round send; never a
      // hand-built `plan_review` intent.
      await opened.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: 'pl30-review',
        name: 'submit_plan_review', args: { verdict: 'fix', findings: [{ taskId: LONG_TASK_ID, text: 'PL-30 reviewed' }] } }] }]);
      await startGoalDriver(opened, goal, 'pl30-review');
      const reviewMessageRef = systemRoundMessageRef(S6A_SCOPE, head.value);
      expect(reviewMessageRef.status).toBe('ready');
      if (reviewMessageRef.status !== 'ready') throw new Error('PL-30: the planreview message ref is not ready');
      const reviewInbox = await heartbeatUntil(opened, () => listed(opened, 'inbox', reviewer),
        items => items.some(message => message.ref.messageId === reviewMessageRef.value.messageId), 16);
      const reviewSent = reviewInbox.some(message => message.ref.messageId === reviewMessageRef.value.messageId);
      if (!reviewSent) {
        const driver = await driverRead(opened, goal);
        expect(reviewSent, 'the Host goal loop does not send the candidate\'s planreview: system '
          + 'round. Stop point: WorkflowDependencies.planCandidates is not wired (the candidate arm rejects '
          + 'unsupported before the send). Missing owner: L (composition root); the send itself is P4. Driver: '
          + (driver.status === 'ready' ? JSON.stringify(driver.value.last) : JSON.stringify(driver))).toBe(true);
      }
      const reviewQuery = await heartbeatUntil(opened,
        () => readPlanningQuery(opened, reviewMessageRef.value),
        read => (read?.run.run.executionState?.prepared ?? null) !== null, 16);
      expect(reviewQuery, 'the Host does not offer/consume the planreview: system '
        + 'action_request to the reviewer line and prepare its Query. Stop point: offerKindOf / '
        + 'handleIntervention. Missing owner: P2.').not.toBeNull();
      if (reviewQuery === null) throw new Error('PL-30: no review Query');
      const reviewPrepared = reviewQuery.run.run.executionState?.prepared;
      if (reviewPrepared === undefined || reviewPrepared === null) {
        throw new Error('PL-30: the review Query has no frozen manifest');
      }
      expect(reviewQuery.job.job.intent.execution).toMatchObject({
        kind: 'intervention_planning', answerShape: 'plan_review',
        sourceMessageRef: reviewMessageRef.value,
      });
      const manifest = ready<{ body: string }>((await opened.post('materials/open', plain(S6A_SCOPE, {
        ref: reviewPrepared.bundleRef, usage: 'historical_explanation',
      }))).body, 'the PL-30 review manifest');
      const frozen = JSON.parse(manifest.body) as PreparedQueryManifestV1;
      expect(frozen.answerShape).toBe('plan_review');
      expect(frozen.input).toContain(`proposal: ${reviewCandidate.ref.proposalId}@${String(reviewCandidate.revision)}`);
      expect(frozen.input).toContain(`instruction:\n${BIG}`);
      expect(frozen.input.length).toBeGreaterThan(BIG_BYTES);
      // The reviewer's real model request, not only the frozen manifest, carries the whole candidate.
      const reviewRequests = await heartbeatUntil(opened, () => opened.scripted.requests(reviewer),
        reads => reads.some(request => request.messages.some(message => contentOf(message).includes(BIG))), 32);
      const reviewInput = reviewRequests.flatMap(request => request.messages.map(contentOf))
        .find(content => content.includes(BIG)) ?? '';
      expect(reviewInput).toContain(`instruction:\n${BIG}`);
      const reviewAt = reviewInput.indexOf(`instruction:\n${BIG}`) + 'instruction:\n'.length;
      expect(createHash('sha256').update(reviewInput.slice(reviewAt, reviewAt + BIG_BYTES), 'utf8').digest('hex'))
        .toBe(BIG_HASH);
      const reviewQuestion = await readBody(opened, reviewMessageRef.value, 'message');
      expect(reviewQuestion.startsWith(head.value)).toBe(true);
      expect(reviewQuery.job.job.intent.question).toBe(reviewQuestion);
      expect(Buffer.byteLength(reviewQuestion, 'utf8')).toBeLessThanOrEqual(65_536);
      expect(reviewQuestion).not.toContain(BIG);
    }, 120_000);
});
