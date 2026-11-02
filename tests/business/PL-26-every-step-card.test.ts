/**
 * PL-04/26: `every_step` on the one real two-stage chain. The stage-1 gate
 * passes, the target loop refines stage 2 through the adviser's real answer,
 * and the reviewer's `pass` does NOT adopt: the candidate stays `candidate`,
 * the person reads `decisions/candidate-card` (exactReview = decided pass) and
 * only their `plans/apply` adopts it; the notice then says 已采用 with 审阅
 * pass, never 人采用/自动采用 (spec §15 PL-04, PL-26, DR-P4-11, P4-19).
 *
 * The named mutation flips `refine_future`'s every-step verdict from
 * `needs_decision` to `automatic`; the "still candidate, revision unchanged
 * before the person applies" assertions must go red.
 */
import { afterEach, expect, it } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { readBody } from '../helpers/IV-host-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  advancePLGoal, runPLEveryStepChain, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-04/26: every_step keeps the reviewed candidate until the person applies it', async () => {
  const chain = await runPLEveryStepChain('pl-26');
  opened = chain.workflow;

  // The stage-1 gate passes before the later placeholder; exactly one `refine:` is sent.
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

  // A second Goal pass (the loop's next wake) still does not adopt on `every_step`: it stops on the candidate card.
  const secondPass = await advancePLGoal(chain.workflow.world, chain.workflow.goal, 'pl-26-second-pass');
  expect(secondPass, JSON.stringify(secondPass)).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null,
    source: { kind: 'candidate' }, waitBasis: { reasons: expect.arrayContaining(['plan_candidate_waiting']) } } });

  // After the pass the candidate is still `candidate`; the active Plan has not moved.
  const still = ready<{ status: string }>(await chain.workflow.main.route('plans/proposal', chain.candidate.ref),
    'plans/proposal');
  expect(still.status).toBe('candidate');
  const goalBefore = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await chain.workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: chain.workflow.goal }), 'goals/read');
  expect(goalBefore.goal.activePlanRevision).toEqual(chain.skeleton.plan.ref);
  expect(goalBefore.goal.activePlanRevision).not.toEqual(chain.candidate.ref);
  const noticesBefore = ready<{ notices: Array<{ category?: string; itemKey?: string }> }>(await chain.workflow.world.post('main/read', {
    scope: { ...S6A_SCOPE }, input: { goalId: chain.workflow.goal.goalId, cursor: null },
  }), 'main/read');
  const candidateNoticeKey = `plan-adoption:${chain.candidate.draft.planId}:${String(chain.candidate.draft.planRevision)}`;
  expect(noticesBefore.notices.some(notice => notice.itemKey === candidateNoticeKey)).toBe(false);

  // The frozen composite read carries this candidate and its exact review (`decided pass`).
  const card = ready<{ card: { source: { kind?: string } };
    exactReview: { status: string; value?: { status: string; verdict?: string } } }>(
    await chain.workflow.world.post('decisions/candidate-card', {
      scope: { ...S6A_SCOPE }, input: { goalRef: chain.workflow.goal, proposalRef: chain.candidate.ref },
    }), 'decisions/candidate-card');
  expect(card.card.source.kind).toBe('candidate');
  expect(card.exactReview).toMatchObject({ status: 'ready', value: { status: 'decided', verdict: 'pass' } });
  // `decisions/card` keeps the bare card of the same source: none of the composite's other three facts.
  const bare = ready<Record<string, unknown>>(await chain.workflow.world.post('decisions/card', {
    scope: { ...S6A_SCOPE }, input: { source: card.card.source },
  }), 'decisions/card');
  expect(bare).toEqual(card.card);
  for (const fact of ['diagnosis', 'exactReview', 'exportRead']) expect(bare).not.toHaveProperty(fact);

  // The person applies the card's proposal: the active Plan moves exactly one revision.
  const applied = (await chain.workflow.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: chain.candidate.ref, expectedProposalRevision: chain.candidate.revision, decisionRefs: [],
  }, 'pl-26-apply'))) as { status: string; value?: { ref: { planId: string } } };
  expect(applied.status, JSON.stringify(applied)).toBe('committed');
  const afterGraph = ready<{ plan: { planRevision: number } }>(
    await chain.workflow.main.route('tasks/query', { goalRef: chain.workflow.goal }), 'tasks/query');
  expect(afterGraph.plan.planRevision).toBe(chain.skeleton.plan.planRevision + 1);
  const goalAfter = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await chain.workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: chain.workflow.goal }), 'goals/read');
  expect(goalAfter.goal.activePlanRevision).toEqual(applied.value?.ref);

  // The adoption summary is the platform's 已采用 line with 审阅 pass, and never a
  // 人采用/自动采用 line.
  const notices = ready<{ notices: Array<{ itemKey?: string; category?: string; summary?: string }> }>(
    await chain.workflow.world.post('main/read', {
      scope: { ...S6A_SCOPE }, input: { goalId: chain.workflow.goal.goalId, cursor: null },
    }), 'main/read');
  const adoption = notices.notices.find(notice => notice.itemKey === candidateNoticeKey);
  // The new revision and the task delta: only the stage-2 placeholder changed, and the candidate declared it.
  expect(adoption?.summary).toContain(`已采用 · 计划 v${String(chain.candidate.draft.planRevision)}`
    + ' · 改 1 个任务（pl-placeholder-pl-stage-2） · 影响 pl-placeholder-pl-stage-2 · 审阅 pass');
  expect(adoption?.summary ?? '').not.toContain('人采用');
  expect(adoption?.summary ?? '').not.toContain('自动采用');
});
