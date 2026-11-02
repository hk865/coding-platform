/**
 * PL-29: the person's `requests/submit` gives the secretary a request slot; the
 * secretary writes a candidate carrying `requestRef`, while a normal agent
 * candidate also exists. The Goal loop leaves the request-slot candidate
 * `candidate` (read as the head through `plans/request-candidate`), keeps the
 * active Plan unchanged, and reviews/adopts only the normal agent candidate
 * (spec §15 PL-29, DR-P4-17, P4-11).
 *
 * This row shares PL-03/22's review gate: the reviewer's `pass` is held while
 * both candidates are read, then released for the normal candidate only.
 *
 * The named mutation treats every `candidate` as adoptable; the request-slot
 * candidate would then stop being `candidate` and the active Plan would move,
 * so this row must go red.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { readBody, readProposal } from '../helpers/IV-host-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import type { S6ACandidate, S6ARequest } from '../helpers/S6A-cards-fixture.js';
import {
  plPlanChangeDraft, runPLAutomaticChain, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-29: the request-slot candidate stays candidate; only the agent candidate is processed', async () => {
  const slot: {
    request?: S6ARequest;
    candidate?: S6ACandidate;
    headBefore?: { ref: { proposalId: string } } | null;
  } = {};

  const chain = await runPLAutomaticChain('pl-29', {
    draft: (skeleton, goal) => {
      const placeholder = skeleton.plan.tasks.find(task => task.taskId === 'pl-placeholder-pl-stage-2');
      if (placeholder === undefined) throw new Error('PL-29: the stage-2 placeholder is missing');
      return plPlanChangeDraft(skeleton.plan, goal, {
        planId: 'pl-plan-pl-29-agent',
        tasks: skeleton.plan.tasks.map(task => task.taskId === placeholder.taskId
          ? { ...task, executionIntent: 'request_execution' as const, estimatedLines: 20, sizeClass: 'small' as const }
          : task),
        assignments: [...(skeleton.plan.assignments ?? []), { taskId: placeholder.taskId,
          role: S6A_WORK_ROLE.templateId, instruction: 'PL-29 agent stage 2 work' }],
        obligations: skeleton.plan.obligations,
      });
    },
    beforeRuns: async ({ workflow }) => {
      slot.request = await workflow.main.submit({ label: 'pl-29', goalId: workflow.goal.goalId,
        text: 'PL-29 person request for a plan' });
      slot.candidate = await workflow.main.proposeCandidate({ label: 'pl-29-request-slot',
        goal: workflow.goal, request: slot.request });
      const head = ready<{ head: { ref: { proposalId: string } } | null }>(
        await workflow.world.post('plans/request-candidate', plain(S6A_SCOPE, {
          goalRef: workflow.goal, requestRef: slot.request.requestRoot,
        })), 'plans/request-candidate');
      slot.headBefore = head.head;
    },
  });
  opened = chain.workflow;
  if (slot.candidate === undefined || slot.request === undefined) {
    throw new Error('PL-29: the request slot was not written');
  }
  const requestCandidate = slot.candidate;
  const request = slot.request;

  const requestProposal: PlanProposal = await readProposal(chain.workflow.world, requestCandidate.proposal.ref);
  expect(requestProposal.status).toBe('candidate');
  expect(requestProposal.requestRef?.queryJobId).toBe(request.requestRoot.queryJobId);
  expect(slot.headBefore?.ref.proposalId).toBe(requestCandidate.proposal.ref.proposalId);
  expect(chain.candidate.requestRef ?? null).toBeNull();
  expect(chain.candidate.status).toBe('candidate');

  // The review gate is held; only the normal agent candidate got a `planreview:`.
  const reviewRounds = (await listed(chain.workflow.world, 'inbox', chain.reviewer)).filter(message =>
    message.sender.kind === 'host' && message.sender.actor.kind === 'system');
  const reviewTexts = await Promise.all(reviewRounds.map(async message =>
    (await readBody(chain.workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
  expect(reviewTexts.filter(text => text.startsWith(
    `planreview:${requestCandidate.proposal.ref.proposalId}:1`))).toHaveLength(0);
  expect(reviewTexts.filter(text => text.startsWith(
    `planreview:${chain.candidate.ref.proposalId}:1`))).toHaveLength(1);
  const goalBefore = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await chain.workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: chain.workflow.goal }), 'goals/read');
  expect(goalBefore.goal.activePlanRevision).toEqual(chain.skeleton.plan.ref);

  // Release `pass`: only the normal agent candidate is adopted.
  await chain.release();
  const agentAccepted: PlanProposal = await readProposal(chain.workflow.world, chain.candidate.ref);
  expect(agentAccepted.status).toBe('accepted');
  expect((await readProposal(chain.workflow.world, requestCandidate.proposal.ref)).status).toBe('candidate');
  const headAfter = ready<{ head: { ref: { proposalId: string } } | null }>(
    await chain.workflow.world.post('plans/request-candidate', plain(S6A_SCOPE, {
      goalRef: chain.workflow.goal, requestRef: request.requestRoot,
    })), 'plans/request-candidate');
  expect(headAfter.head?.ref.proposalId).toBe(requestCandidate.proposal.ref.proposalId);
  const goalAfter = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await chain.workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: chain.workflow.goal }), 'goals/read');
  expect(goalAfter.goal.activePlanRevision?.planId).toBe('pl-plan-pl-29-agent');
});
