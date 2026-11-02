/**
 * PL-03/22: the one automatic two-stage chain. The stage-1 gate is satisfied
 * before the later placeholder, exactly one `refine:` is sent, the reviewer's
 * held `pass` is released, the platform adopts, the active PlanRevision becomes
 * the candidate's revision, stage 2 starts, and `main/read` carries the
 * adoption/impact notice (spec §15 PL-03, PL-22, DR-P4-10, P4-19).
 *
 * This row keeps the notice and card facts PL-03 does not: exactly one
 * `planreview:`, the candidate `accepted`, the `plan_adoption.summary` with
 * 已采用 + 审阅 pass, and the card's `exactReview` = `decided pass` read at the
 * accepted candidate's `revision - 1`.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { listed } from '../helpers/S7B-fixture.js';
import { readBody, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { ready } from '../helpers/S7A-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  advancePLGoal, runPLAutomaticChain, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

// The read faults sit on the real record-store boundary (A2/A4), the same way as PL-14.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });
afterEach(() => { expect(commitBarrier.reset()).toEqual([]); });

it('PL-03/22: pass is adopted automatically; one refine, one planreview, stage 2 runs', async () => {
  const chain = await runPLAutomaticChain('pl-22');
  opened = chain.workflow;

  const graph = ready<{ plan: { planRevision: number }; tasks: Array<Record<string, unknown>> }>(
    await chain.workflow.main.route('tasks/query', { goalRef: chain.workflow.goal }), 'tasks/query');
  expect(graph.plan.planRevision).toBe(1);
  expect(graph.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-gate-pl-stage-1'))
    .toMatchObject({ effectivePhase: 'satisfied' });
  expect(graph.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-placeholder-pl-stage-2'))
    .toMatchObject({ effectivePhase: 'pending', definition: { executionIntent: 'plan_only', sizeClass: 'small' } });

  const lineRounds = (await listed(chain.workflow.world, 'inbox', chain.adviser)).filter(message =>
    message.sender.kind === 'host' && message.sender.actor.kind === 'system');
  const lineTexts = await Promise.all(lineRounds.map(async message =>
    (await readBody(chain.workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
  expect(lineTexts.filter(text => text.startsWith(`refine:${chain.workflow.goal.goalId}:pl-stage-2:`))).toHaveLength(1);

  // Held before `pass`: the candidate is still `candidate` and the Plan has not moved.
  const pending = ready<PlanProposal>(await chain.workflow.main.route('plans/proposal', chain.candidate.ref),
    'plans/proposal');
  expect(pending.status).toBe('candidate');
  const before = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await chain.workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: chain.workflow.goal }), 'goals/read');
  expect(before.goal.activePlanRevision).toEqual(chain.skeleton.plan.ref);

  // The Goal judges the candidate again while the review is unanswered: it waits, it selects no adoption.
  const heldPass = await advancePLGoal(chain.workflow.world, chain.workflow.goal, 'pl-22-held-pass');
  expect(heldPass, JSON.stringify(heldPass)).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null,
    waitBasis: { reasons: expect.arrayContaining(['plan_review_pending']) } } });
  expect(ready<PlanProposal>(await chain.workflow.main.route('plans/proposal', chain.candidate.ref),
    'plans/proposal').status, 'the held pass adopted nothing').toBe('candidate');

  await chain.release();

  // Exactly one planreview was sent; the candidate is accepted and the active revision is its target.
  const afterRounds = (await listed(chain.workflow.world, 'inbox', chain.reviewer)).filter(message =>
    message.sender.kind === 'host' && message.sender.actor.kind === 'system');
  const afterTexts = await Promise.all(afterRounds.map(async message =>
    (await readBody(chain.workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
  expect(afterTexts.filter(text => text.startsWith('planreview:'))).toHaveLength(1);
  const accepted = ready<PlanProposal>(await chain.workflow.main.route('plans/proposal', chain.candidate.ref),
    'plans/proposal');
  expect(accepted.status).toBe('accepted');
  const after = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await chain.workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: chain.workflow.goal }), 'goals/read');
  expect(after.goal.activePlanRevision?.planId).toBe(accepted.draft.planId);

  const runs = ready<{ items: Array<Record<string, unknown>> }>(await chain.workflow.world.post('executions/list', {
    scope: { ...S6A_SCOPE }, input: { goalRef: chain.workflow.goal, taskId: 'pl-placeholder-pl-stage-2',
      page: { afterCursor: null, limit: 10 } },
  }), 'executions/list');
  expect(runs.items.length).toBeGreaterThan(0);

  // The adoption notice carries 已采用 + 审阅 pass, and its candidate pin's exactReview
  // is the accepted candidate's `revision - 1` read (`decided pass`).
  await chain.workflow.world.settleDetached();
  const main = ready<{ notices: Array<{ itemKey?: string; category?: string; summary?: string;
    objects?: Array<{ pin: { ref: { aggregateType?: string; proposalId?: string } } }> }> }>(
    await chain.workflow.world.post('main/read', {
      scope: { ...S6A_SCOPE }, input: { goalId: chain.workflow.goal.goalId, cursor: null },
    }), 'main/read');
  // The candidate's own adoption, not the skeleton's earlier v1 notice.
  const adoption = main.notices.find(notice => notice.category === 'plan_adoption'
    && notice.summary?.includes(`计划 v${String(accepted.draft.planRevision)}`));
  // The delta and the impact list: only the stage-2 placeholder changes, and the candidate declared it.
  expect(adoption?.summary).toContain(`已采用 · 计划 v${String(accepted.draft.planRevision)}`
    + ' · 改 1 个任务（pl-placeholder-pl-stage-2） · 影响 pl-placeholder-pl-stage-2 · 审阅 pass');
  const candidatePin = adoption?.objects?.find(object =>
    object.pin.ref.aggregateType === 'PlanProposal')?.pin.ref;
  expect(candidatePin).toBeDefined();
  const card = ready<{ exactReview: { status: string; value?: { status: string; verdict?: string } } }>(
    await chain.workflow.world.post('decisions/candidate-card', {
      scope: { ...S6A_SCOPE }, input: { goalRef: chain.workflow.goal, proposalRef: candidatePin },
    }), 'decisions/candidate-card');
  expect(card.exactReview).toMatchObject({ status: 'ready', value: { status: 'decided', verdict: 'pass' } });

  // An unreadable review is never written as pass, and the failed read does not take `main/read` down.
  // The fault sits on the review's answer record: `readPlanningQuestions` skips a review round's answer (it is a
  // verdict), so only the review read reaches it, while a fault on the QueryJob fails that enumeration first.
  const reviewQuery = await readPlanningQuery(chain.workflow.world, chain.reviewRef);
  const reviewAnswer = reviewQuery?.job.job.answerRefs.at(-1);
  if (reviewAnswer === undefined) throw new Error('PL-22: the review answer is missing');
  const fault = commitBarrier.failReads(canonicalRefKey(reviewAnswer), 'throw-always');
  try {
    const answer = await chain.workflow.world.post('main/read', {
      scope: { ...S6A_SCOPE }, input: { goalId: chain.workflow.goal.goalId, cursor: null },
    });
    // The fault really hit the review read, not an unrelated one.
    expect(fault.calls()).toBeGreaterThan(0);
    expect(answer.httpStatus, JSON.stringify(answer.body)).toBe(200);
    const unreadable = ready<{ notices: Array<{ itemKey?: string; summary?: string }> }>(answer, 'main/read');
    const notice = unreadable.notices.find(item => item.itemKey === adoption?.itemKey);
    expect(notice?.summary).toContain('审阅结论读不到');
    expect(notice?.summary).not.toContain('审阅 pass');
  } finally {
    fault.release();
  }
});
