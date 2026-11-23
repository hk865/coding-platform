/**
 * P2 T31 (frozen row :345, A13 four entries): the goal-loop entry. `A13` is the
 * one judgement before automatic adoption. Since the user's 11-23 decision
 * (`cp2f7-rulings.md` P-A 1, replacing frozen 2.5a `:209`) only a candidate whose
 * trusted author line is a secretary and that touches an existing Task (changed
 * definition/disposition, or an old-old dependency edge) is carded for the
 * person; the same change from an adviser goes through the goal loop's review
 * and is adopted after `pass`, and an only-new-task candidate is reviewed and
 * adopted too. The intervention/check-close/secretary entries are reported
 * blocked where the base has no public builder.
 */
import { describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { awaitProposal, candidateCards, heartbeat, heartbeatUntil, proposalRefOf } from '../helpers/IV-host-fixture.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import { OPERATOR, P2_COORDINATION_TOOL_NAMES } from '../helpers/S6A-request-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import { checkConfiguration, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, performOne, plPlanChangeDraft, plSupersedeDraft,
  plSystemRoundRef, plToolPlanOf, requestHeads, runPLAutomaticChain, verdictOf, type PLSkeleton, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

/**
 * One change written by the planning round a person's direct intervention opens on a secretary line or on an adviser
 * line: the round's recipient line is the trusted author (frozen `:208`). The project has a reviewer whose real
 * `submit_plan_review` passes, and the Goal adopts automatically after a plan is confirmed.
 */
async function openAuthored(label: string, author: 'secretary' | 'adviser',
  change: (skeleton: PLSkeleton, goal: GoalRef) => { draft: PlanRevisionDraft; affectedTaskIds: string[] }) {
  const workflow = await openPLWorkflowWorld({ label, tools: P2_COORDINATION_TOOL_NAMES,
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal,
    { label, stageOneTaskIds: ['pl-a', 'pl-b'] });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, `${label}-reviewer`);
  await workflow.world.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: `${label}-review`,
    name: 'submit_plan_review', args: { verdict: 'pass', findings: [] } }] }]);
  const line = author === 'adviser' ? await createPLAdviserLine(workflow.world, `${label}-adviser`)
    : await workflow.world.createSecretary(`${label}-secretary`);
  const { draft, affectedTaskIds } = change(skeleton, workflow.goal);
  await workflow.world.scripted.script(line, [{ kind: 'calls', calls: [{ callId: `${label}-plan`,
    name: 'submit_plan_round', args: { answerKind: 'plan', summary: label, plan: plToolPlanOf(draft),
      reason: { text: label, affectedTaskIds } } }] }]);
  const message = await sendS7A2PersonMessage(workflow.world, { label, recipient: line.ref, goal: workflow.goal });
  const candidate = ready<PlanProposal>(await awaitProposal(workflow.world, proposalRefOf(message.ref, workflow.goal)),
    `the ${label} candidate`);
  return { workflow, reviewer, candidate, skeleton };
}

const supersedeA = (label: string) => (skeleton: PLSkeleton, goal: GoalRef) =>
  ({ draft: plSupersedeDraft(skeleton.plan, goal, label), affectedTaskIds: ['pl-a'] });

async function driveOnce(workflow: PLWorkflowWorld): Promise<void> {
  await startGoalDriver(workflow.world, workflow.goal, 'p2-t31-drive');
  await heartbeat(workflow.world, 100);
  await heartbeat(workflow.world, 100);
  await heartbeatUntil(workflow.world, () => driverRead(workflow.world, workflow.goal),
    read => typeof read === 'object' && read !== null && 'status' in read && read.status === 'ready', 16);
}

function planHeads(heads: readonly string[]): string[] {
  return heads.filter(head => head.startsWith('planreview:'));
}

describe('P2 T31: the goal-loop A13 entry', () => {
  it('an only-new-task candidate is reviewed and adopted after pass', async () => {
    const chain = await runPLAutomaticChain('p2-t31-new');
    try {
      expect(planHeads(await requestHeads(chain.workflow, chain.reviewer))).toHaveLength(1);
      expect(chain.candidate.status).toBe('candidate');
      await chain.release();
      const adopted: PlanProposal = ready(await chain.workflow.main.route('plans/proposal', chain.candidate.ref),
        'the adopted candidate');
      expect(adopted.status).toBe('accepted');
    } finally {
      await chain.workflow.close();
    }
  }, 240_000);

  it('a secretary\'s candidate that supersedes an old Task is carded and not reviewed', async () => {
    const { workflow, reviewer, candidate } = await openAuthored('p2-t31-old', 'secretary', supersedeA('p2-t31-old'));
    try {
      await driveOnce(workflow);
      expect(planHeads(await requestHeads(workflow, reviewer)),
        'A13 does not send the review round').toHaveLength(0);
      const cards = await candidateCards(workflow.world, workflow.goal);
      expect(cards.filter(card => card.source.kind === 'candidate'),
        'the candidate waits on the person card').not.toHaveLength(0);
      expect(ready<PlanProposal>(await workflow.main.route('plans/proposal', candidate.ref), 'the candidate').status,
        'the secretary\'s change is not adopted automatically').toBe('candidate');
    } finally {
      await workflow.close();
    }
  }, 240_000);

  it('an adviser\'s candidate that supersedes the same old Task is reviewed and adopted after pass', async () => {
    const { workflow, reviewer, candidate, skeleton } = await openAuthored('p2-t31-adviser', 'adviser',
      supersedeA('p2-t31-adviser'));
    try {
      await performOne(workflow, 'p2-t31-adviser-review', 'send_system_round');
      const review = await plSystemRoundRef(workflow, reviewer, `planreview:${candidate.ref.proposalId}:1`);
      expect(await verdictOf(workflow, review)).toBe('pass');
      await performOne(workflow, 'p2-t31-adviser-adopt', 'adopt_plan');
      const adopted: PlanProposal = ready(await workflow.main.route('plans/proposal', candidate.ref),
        'the adopted candidate');
      expect(adopted.status).toBe('accepted');
      const active = await workflow.main.activePlan(workflow.goal);
      expect(active?.planRevision).toBe(skeleton.plan.planRevision + 1);
      expect(active?.tasks.find(task => task.taskId === 'pl-a'))
        .toMatchObject({ disposition: 'superseded', replacedByTaskId: 'pl-a2' });
    } finally {
      await workflow.close();
    }
  }, 240_000);

  it('a secretary\'s edge-only change between two old Tasks is carded and not reviewed', async () => {
    const { workflow, reviewer } = await openAuthored('p2-t31-edge', 'secretary', (skeleton, goal) => {
      const base = plPlanChangeDraft(skeleton.plan, goal, {
        planId: 'p2-t31-edge-plan', tasks: skeleton.plan.tasks, assignments: skeleton.plan.assignments ?? [],
        obligations: skeleton.plan.obligations,
      });
      return { draft: { ...base, executionDag: { dependsOn: [...base.executionDag.dependsOn, {
        taskId: 'pl-b', dependsOnId: 'pl-a', requires: { kind: 'artifact' as const, label: 'P2 T31 old edge' },
      }] } }, affectedTaskIds: ['pl-b'] };
    });
    try {
      await driveOnce(workflow);
      expect(planHeads(await requestHeads(workflow, reviewer)),
        'A13 does not send the review round').toHaveLength(0);
    } finally {
      await workflow.close();
    }
  }, 240_000);
});
