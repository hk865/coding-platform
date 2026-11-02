/**
 * PL-28: a Work Run authorized with `propose_future_plan` submits the v2 future
 * revision through the real tool; the receipt is `committed`, and the Goal loop
 * picks that agent candidate up (no `sourceMessageRef`), holds the reviewer's
 * `pass`, keeps the person's request slot untouched, then releases the normal
 * candidate, adopts it and lets the second stage start (spec §15 PL-28,
 * DR-P4-17, P4-11).
 *
 * The named mutation filters the Goal loop's candidates to those carrying a
 * `sourceMessageRef`; this tool proposal has `sourceMessageRef === null`, so it
 * would never be reviewed or adopted and this row must go red.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { readBody, readProposal } from '../helpers/IV-host-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import type { S6ACandidate, S6ARequest } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import {
  PL_PROPOSE_FUTURE_TOOLS, plPlanChangeDraft, runPLAutomaticChain, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-28: the Work Run tool proposal is read, reviewed, adopted and stage 2 starts', async () => {
  // The person's request slot must stay untouched; the v2 draft the Run's real
  // tool call submits is built from the skeleton the chain opens.
  const slot: {
    request?: S6ARequest;
    candidate?: S6ACandidate;
    headBefore?: { ref: { proposalId: string } } | null;
  } = {};

  const chain = await runPLAutomaticChain('pl-28', {
    extraBindings: [PL_PROPOSE_FUTURE_TOOLS],
    propose: (skeleton, goal) => {
      const placeholder = skeleton.plan.tasks.find(task => task.taskId === 'pl-placeholder-pl-stage-2');
      if (placeholder === undefined) throw new Error('PL-28: the stage-2 placeholder is missing');
      return { draft: plPlanChangeDraft(skeleton.plan, goal, {
        planId: 'pl-plan-pl-28-future',
        tasks: skeleton.plan.tasks.map(task => task.taskId === placeholder.taskId
          ? { ...task, executionIntent: 'request_execution' as const, estimatedLines: 20, sizeClass: 'small' as const }
          : task),
        assignments: [...(skeleton.plan.assignments ?? []), { taskId: placeholder.taskId,
          role: S6A_WORK_ROLE.templateId, instruction: 'PL-28 stage 2 work' }],
        obligations: skeleton.plan.obligations,
      }), reasonText: 'PL-28 future stage-2 revision' };
    },
    beforeRuns: async ({ workflow }) => {
      slot.request = await workflow.main.submit({ label: 'pl-28', goalId: workflow.goal.goalId,
        text: 'PL-28 person request that must stay in its slot' });
      slot.candidate = await workflow.main.proposeCandidate({ label: 'pl-28-request-slot',
        goal: workflow.goal, request: slot.request });
      const head = ready<{ head: { ref: { proposalId: string } } | null }>(
        await workflow.world.post('plans/request-candidate', plain(S6A_SCOPE, {
          goalRef: workflow.goal, requestRef: slot.request.requestRoot,
        })), 'plans/request-candidate');
      slot.headBefore = head.head;
      expect(slot.headBefore?.ref.proposalId).toBe(slot.candidate.proposal.ref.proposalId);
    },
  });
  opened = chain.workflow;
  if (chain.toolProposal === undefined) throw new Error('PL-28: the Work Run wrote no tool proposal');

  // The tool's real receipt is the candidate: same ref/revision, sourceMessageRef
  // null and no request slot (the mutation's trap).
  const candidate: PlanProposal = await readProposal(chain.workflow.world, chain.toolProposal.ref);
  expect(candidate.ref).toEqual(chain.toolProposal.ref);
  expect(candidate.revision).toBe(chain.toolProposal.revision);
  expect(candidate.revision).toBe(1);
  expect(candidate.status).toBe('candidate');
  expect(candidate.sourceMessageRef).toBeNull();
  expect(candidate.requestRef ?? null).toBeNull();

  if (slot.candidate === undefined || slot.request === undefined) {
    throw new Error('PL-28: the request slot was not written');
  }
  const requestCandidate = slot.candidate;
  const request = slot.request;

  // The chain has sent and held the one `planreview:`; the request slot is unchanged.
  const requestStill = await readProposal(chain.workflow.world, requestCandidate.proposal.ref);
  expect(requestStill.status).toBe('candidate');
  const headAfter = ready<{ head: { ref: { proposalId: string } } | null }>(
    await chain.workflow.world.post('plans/request-candidate', plain(S6A_SCOPE, {
      goalRef: chain.workflow.goal, requestRef: request.requestRoot,
    })), 'plans/request-candidate');
  expect(headAfter.head?.ref.proposalId).toBe(requestCandidate.proposal.ref.proposalId);
  const before = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await chain.workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: chain.workflow.goal }), 'goals/read');
  expect(before.goal.activePlanRevision).toEqual(chain.skeleton.plan.ref);
  const reviewRounds = (await listed(chain.workflow.world, 'inbox', chain.reviewer)).filter(message =>
    message.sender.kind === 'host' && message.sender.actor.kind === 'system');
  const reviewTexts = await Promise.all(reviewRounds.map(async message =>
    (await readBody(chain.workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
  expect(reviewTexts.filter(text => text.startsWith(`planreview:${candidate.ref.proposalId}:1`))).toHaveLength(1);

  // Release `pass`: only the tool candidate is adopted; the request slot is still untouched.
  await chain.release();
  const accepted: PlanProposal = await readProposal(chain.workflow.world, candidate.ref);
  expect(accepted.status).toBe('accepted');
  expect((await readProposal(chain.workflow.world, requestCandidate.proposal.ref)).status).toBe('candidate');
  const after = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await chain.workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: chain.workflow.goal }), 'goals/read');
  expect(after.goal.activePlanRevision?.planId).toBe('pl-plan-pl-28-future');
  const runs = ready<{ items: Array<Record<string, unknown>> }>(await chain.workflow.world.post('executions/list', {
    scope: { ...S6A_SCOPE }, input: { goalRef: chain.workflow.goal, taskId: 'pl-placeholder-pl-stage-2',
      page: { afterCursor: null, limit: 10 } },
  }), 'executions/list');
  expect(runs.items.length).toBeGreaterThan(0);
  const main = ready<{ notices: Array<{ category?: string; summary?: string }> }>(
    await chain.workflow.world.post('main/read', {
      scope: { ...S6A_SCOPE }, input: { goalId: chain.workflow.goal.goalId, cursor: null },
    }), 'main/read');
  const adoption = main.notices.find(notice => notice.category === 'plan_adoption'
    && notice.summary?.includes('计划 v2') === true);
  expect(adoption?.summary).toContain('已采用');
  expect(adoption?.summary).toContain('审阅 pass');
});
