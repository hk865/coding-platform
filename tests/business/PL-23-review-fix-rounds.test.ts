/**
 * PL-23: two `fix` verdicts then `pass`, with two `planfix:` rounds each writing
 * a new independent `@1` candidate (`P2@1`, `P3@1`, `basedOn` unchanged,
 * `proposalRevision` 1), three `planreview:` rounds for `P1@1`/`P2@1`/`P3@1`,
 * and `P3` adopted with the active Plan moving one revision (spec §15 PL-23,
 * DR-P4-15).
 *
 * The row does not use candidate revisions as round counts. Rounds are the
 * distinct request heads of the real `planreview:<proposalId>:1` and
 * `planfix:<proposalId>:1` messages read from the two line inboxes, and every
 * verdict comes from `queries/read` + `queries/answer` of the Query the Host
 * really consumed.
 *
 * The two separate worlds stay apart from this world's counts and are recorded
 * here, not mixed in: (a) a terminal `planfix:` with no successor writes a
 * `fix_invalid` card and is never resent; (b) a `planfix:` that asks a question,
 * whose card is answered while the `planresume:` continuation still runs, reads
 * `planFixRead === waiting` (never `terminal`) and sends no second `planfix:`.
 *
 * The named mutation is a `planFixRead` that looks only at the original
 * `planfix:` Query and does not follow the `planresume:` continuation; the
 * in-flight continuation would be read `terminal` and a `fix_invalid` card would
 * appear, so that world must go red.
 *
 * PL-23(e) (slice 9 G3 fix, window 3): a `planfix:` Query ends while the Host's closing notice fails once, then the
 * Goal is cancelled. Named mutation: the terminal settlement moved back after the Goal's new-work admission check in
 * `handleIntervention` (red at the source being settled). On the tree before it: the same red.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S7A_REPLY_TOOLS, cancelS7AGoal, checkConfiguration, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6AExtraBinding } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import {
  answerCard, awaitPlanningAnswer, awaitProposal, heartbeatUntil, proposalRefOf, questionCards, readBody, readPlanningQuery, readProposal, readQueryAnswer,
} from '../helpers/IV-host-fixture.js';
import {
  adoptPLPlanDraft, adoptPLTwoStageSkeleton, advancePLGoal, createPLReviewerLine, openPLWorkflowWorld,
  performOne, plPlanChangeDraft, plSingleStageDraft, plSystemRoundRef, plToolPlanOf, requestHeads, settlePLGoal,
  verdictOf,
  type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { createPLAdviserLine, sendPLActionWait } from '../helpers/PL-consumption-fixture.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import type { CandidateCardFactsV1 } from '../../src/core/work-graph/views/decision-read-model.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { commitBarrier.reset(); await opened?.close(); opened = null; });

const FIX = { verdict: 'fix' as const,
  findings: [{ taskId: 'pl-placeholder-pl-stage-2', text: 'PL-23 add the missing check' }] };
const PASS = { verdict: 'pass' as const, findings: [] };
/** A candidate's own source record: a `planfix:` built on that draft must not take it over. */
const CANDIDATE_ORIGIN: NonNullable<PlanRevisionDraft['origin']> = {
  kind: 'model_coordination', source: { kind: 'plain' },
  answerRef: { aggregateType: 'QueryJobAnswer', ...S6A_SCOPE, queryJobId: 'pl-23-origin', answerId: 'pl-23-origin' },
  answerDigest: 'd'.repeat(64), goalRevision: 1, workspaceRevision: 1, requestId: 'pl-23-origin',
  summary: 'PL-23 the candidate origin', assignments: [],
};

/** The refinement candidate P1: the stage-2 placeholder becomes executable, basedOn unchanged. */
function p1Draft(plan: PlanRevisionSnapshot, label: string): PlanRevisionDraft {
  const placeholder = plan.tasks.find(task => task.taskId === 'pl-placeholder-pl-stage-2');
  if (placeholder === undefined) throw new Error(`PL-23: the stage-2 placeholder is missing for ${label}`);
  return plPlanChangeDraft(plan, plan.goalRef, {
    planId: `pl-plan-${label}`,
    tasks: plan.tasks.map(task => task.taskId === placeholder.taskId
      ? { ...task, executionIntent: 'request_execution' as const, estimatedLines: 20, sizeClass: 'small' as const }
      : task),
    assignments: [...(plan.assignments ?? []), { taskId: placeholder.taskId,
      role: S6A_WORK_ROLE.templateId, instruction: `PL-23 ${label} stage 2 work` }],
    obligations: plan.obligations,
  });
}

it('PL-23: P1 is reviewed fix, two planfix rounds write P2/P3, pass adopts P3 once', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-23',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-23', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-23-reviewer');
  const adviser = await createPLAdviserLine(workflow.world, 'pl-23-adviser');
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-23-review-p1', name: 'submit_plan_review', args: FIX }] },
  ]);
  const p2Segment = plToolPlanOf(p1Draft(skeleton.plan, 'pl-23-p2'));
  const p3Segment = plToolPlanOf(p1Draft(skeleton.plan, 'pl-23-p3'));
  await workflow.world.scripted.script(adviser, [
    { kind: 'calls', calls: [{ callId: 'pl-23-p2', name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'PL-23 P2 stage 2', plan: p2Segment,
      reason: { text: 'PL-23 P2', affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
    } }] },
    { kind: 'calls', calls: [{ callId: 'pl-23-p3', name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'PL-23 P3 stage 2', plan: p3Segment,
      reason: { text: 'PL-23 P3', affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
    } }] },
  ]);

  // P1@1: the adviser's one independent refinement candidate on the active Plan.
  const drafted = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: skeleton.plan.ref,
    draft: { ...p1Draft(skeleton.plan, 'pl-23-p1'), origin: CANDIDATE_ORIGIN },
    reason: { text: 'PL-23 P1 refinement', sources: [] },
  }, 'pl-23-p1-propose'))) as { status: string; value?: PlanProposal };
  expect(drafted.status, JSON.stringify(drafted)).toBe('committed');
  const p1 = drafted.value;
  if (p1 === undefined) throw new Error('PL-23: P1 was not written');
  expect(p1.status).toBe('candidate');
  expect(p1.revision).toBe(1);
  expect(p1.basedOn).toEqual(skeleton.plan.ref);

  // Round 1: one real `planreview:<P1>:1`, the reviewer's `fix`, then `planfix:<P1>:1` and P2.
  await performOne(workflow, 'pl-23-review-p1', 'send_system_round');
  const reviewP1 = await plSystemRoundRef(workflow, reviewer, `planreview:${p1.ref.proposalId}:1`);
  expect(await verdictOf(workflow, reviewP1)).toBe('fix');
  expect((await readProposal(workflow.world, p1.ref)).status).toBe('candidate');
  await performOne(workflow, 'pl-23-fix-p1', 'send_system_round');
  const fixP1 = await plSystemRoundRef(workflow, adviser, `planfix:${p1.ref.proposalId}:1`);
  const p2Read = await awaitProposal(workflow.world, proposalRefOf(fixP1, workflow.goal));
  if (p2Read.status !== 'ready') throw new Error(`PL-23: P2 is ${JSON.stringify(p2Read)}`);
  const p2 = p2Read.value;
  expect(p2.status).toBe('candidate');
  expect(p2.revision).toBe(1);
  expect(p2.basedOn).toEqual(skeleton.plan.ref);
  // PL-21: a fix on a candidate draft base keeps no origin; the candidate's source is not this Plan's adoption source.
  expect(p1.draft.origin).toEqual(CANDIDATE_ORIGIN);
  expect(p2.draft).not.toHaveProperty('origin');

  // Round 2: `planreview:<P2>:1` -> fix -> `planfix:<P2>:1` and P3.
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-23-review-p2', name: 'submit_plan_review', args: FIX }] },
  ]);
  await performOne(workflow, 'pl-23-review-p2', 'send_system_round');
  const reviewP2 = await plSystemRoundRef(workflow, reviewer, `planreview:${p2.ref.proposalId}:1`);
  expect(await verdictOf(workflow, reviewP2)).toBe('fix');
  expect((await readProposal(workflow.world, p2.ref)).status).toBe('candidate');
  await performOne(workflow, 'pl-23-fix-p2', 'send_system_round');
  const fixP2 = await plSystemRoundRef(workflow, adviser, `planfix:${p2.ref.proposalId}:1`);
  const p3Read = await awaitProposal(workflow.world, proposalRefOf(fixP2, workflow.goal));
  if (p3Read.status !== 'ready') throw new Error(`PL-23: P3 is ${JSON.stringify(p3Read)}`);
  const p3 = p3Read.value;
  expect(p3.status).toBe('candidate');
  expect(p3.revision).toBe(1);
  expect(p3.basedOn).toEqual(skeleton.plan.ref);

  // Round 3: `planreview:<P3>:1` -> pass -> exactly one adoption of P3.
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-23-review-p3', name: 'submit_plan_review', args: PASS }] },
  ]);
  await performOne(workflow, 'pl-23-review-p3', 'send_system_round');
  const reviewP3 = await plSystemRoundRef(workflow, reviewer, `planreview:${p3.ref.proposalId}:1`);
  expect(await verdictOf(workflow, reviewP3)).toBe('pass');
  await performOne(workflow, 'pl-23-adopt', 'adopt_plan');

  // Counts are distinct request heads, never candidate revisions.
  const reviewHeads = (await requestHeads(workflow, reviewer)).filter(head => head.startsWith('planreview:'));
  const fixHeads = (await requestHeads(workflow, adviser)).filter(head => head.startsWith('planfix:'));
  expect(new Set(reviewHeads).size).toBe(3);
  expect(reviewHeads).toEqual(expect.arrayContaining([
    `planreview:${p1.ref.proposalId}:1`,
    `planreview:${p2.ref.proposalId}:1`,
    `planreview:${p3.ref.proposalId}:1`,
  ]));
  expect(fixHeads).toHaveLength(2);
  expect(fixHeads).toEqual(expect.arrayContaining([
    `planfix:${p1.ref.proposalId}:1`,
    `planfix:${p2.ref.proposalId}:1`,
  ]));
  expect(fixHeads.some(head => head.startsWith(`planfix:${p3.ref.proposalId}:`))).toBe(false);

  const goalNow = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: workflow.goal }), 'goals/read');
  expect(goalNow.goal.activePlanRevision?.planId).toBe(p3.draft.planId);
  const accepted = await readProposal(workflow.world, p3.ref);
  expect(accepted.status).toBe('accepted');
  // One acceptance, one revision: `P3` is @2, never the round count @3.
  expect(accepted.revision).toBe(2);
  expect((await readProposal(workflow.world, p1.ref)).status).toBe('candidate');
  expect((await readProposal(workflow.world, p2.ref)).status).toBe('candidate');
  const graph = ready<{ plan: { planRevision: number } }>(
    await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
  expect(graph.plan.planRevision).toBe(2);

  // The adoption notice reads the review before acceptance: `planreview:<P3>:1` passed, no such round exists at @2.
  const notices = ready<{ notices: Array<{ itemKey?: string; summary?: string }> }>(await workflow.world.post(
    'main/read', { scope: { ...S6A_SCOPE }, input: { goalId: workflow.goal.goalId, cursor: null } }), 'main/read');
  const adoption = notices.notices.find(notice =>
    notice.itemKey === `plan-adoption:${p3.draft.planId}:${String(p3.draft.planRevision)}`);
  expect(adoption?.summary).toContain('审阅 pass');
  const acceptedCard = ready<CandidateCardFactsV1>(await workflow.world.post('decisions/candidate-card', {
    scope: { ...S6A_SCOPE }, input: { goalRef: workflow.goal, proposalRef: p3.ref },
  }), 'decisions/candidate-card');
  expect(acceptedCard.exactReview).toMatchObject({ status: 'ready', value: { status: 'decided', verdict: 'pass' } });
});


/** Advances the Host clock in real time until one held model request is reached. */
async function advanceClockUntil(world: PLWorkflowWorld['world'], reached: Promise<unknown>): Promise<void> {
  let done = false;
  void reached.then(() => { done = true; });
  for (let attempt = 0; attempt < 80 && !done; attempt += 1) {
    world.clock.advance(25);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (!done) throw new Error('PL-23: the model request was not reached');
}

async function openFixWorld(label: string, extraBindings: readonly S6AExtraBinding[] = []) {
  const workflow = await openPLWorkflowWorld({ label, extraBindings,
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label, stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, `${label}-reviewer`);
  const adviser = await createPLAdviserLine(workflow.world, `${label}-adviser`);
  return { workflow, skeleton, reviewer, adviser };
}

async function writeP1(workflow: PLWorkflowWorld, skeleton: Awaited<ReturnType<typeof adoptPLTwoStageSkeleton>>,
  label: string): Promise<PlanProposal> {
  const drafted = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: skeleton.plan.ref,
    draft: p1Draft(skeleton.plan, `${label}-p1`),
    reason: { text: `PL-23 ${label} P1`, sources: [] },
  }, `${label}-p1-propose`))) as { status: string; value?: PlanProposal };
  expect(drafted.status, JSON.stringify(drafted)).toBe('committed');
  if (drafted.value === undefined) throw new Error(`PL-23: ${label} P1 was not written`);
  return drafted.value;
}

it('PL-23(a): a sent planfix is not resent and another Task still performs', async () => {
  const { workflow, skeleton, reviewer, adviser } = await openFixWorld('pl-23-a');
  opened = workflow;
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-23-a-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task =>
      ['pl-a', 'pl-b'].includes(task.taskId)),
  }));
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-23-a-review-p1', name: 'submit_plan_review', args: FIX }] },
  ]);
  const p1 = await writeP1(workflow, skeleton, 'pl-23-a');
  await performOne(workflow, 'pl-23-a-review-p1', 'send_system_round');
  const reviewP1 = await plSystemRoundRef(workflow, reviewer, `planreview:${p1.ref.proposalId}:1`);
  expect(await verdictOf(workflow, reviewP1)).toBe('fix');

  // Hold the planfix model request: the new candidate has not been written yet.
  const fixGate = await workflow.world.gates.modelRequest(adviser);
  await workflow.world.scripted.script(adviser, [{
    kind: 'calls', calls: [{ callId: 'pl-23-a-p2', name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'PL-23(a) P2 stage 2',
      plan: plToolPlanOf(p1Draft(skeleton.plan, 'pl-23-a-p2')),
      reason: { text: 'PL-23(a) P2', affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
    } }],
  }]);
  await performOne(workflow, 'pl-23-a-fix-p1', 'send_system_round');
  await plSystemRoundRef(workflow, adviser, `planfix:${p1.ref.proposalId}:1`);
  await advanceClockUntil(workflow.world, fixGate.reached);

  // No second same-id send; the pass still selects another Task's real perform.
  const body = await advancePLGoal(workflow.world, workflow.goal, 'pl-23-a-other') as {
    status: string; value?: { next: WorkflowAdvanceInput | null };
  };
  expect(body.status, JSON.stringify(body)).toBe('ready');
  expect(body.value?.next).toMatchObject({ kind: 'perform', operation: { kind: 'claim_task' } });
  const step = body.value?.next;
  if (step === null || step === undefined) throw new Error('PL-23(a): no other Task step');
  const performed = await workflow.world.post('workflow/advance', plain(S6A_SCOPE, step));
  expect(performed.body, JSON.stringify(performed.body)).toMatchObject({ status: 'ready',
    value: { receipt: { kind: 'claim_task', result: { status: 'committed' } } } });
  expect(line.ref.sessionId).toBeTruthy();
  expect((await requestHeads(workflow, adviser)).filter(head => head.startsWith('planfix:')))
    .toEqual([`planfix:${p1.ref.proposalId}:1`]);
  fixGate.release();
});

it('PL-23(b): a terminal planfix with no successor cards fix_invalid and is not resent', async () => {
  const { workflow, skeleton, reviewer, adviser } = await openFixWorld('pl-23-b');
  opened = workflow;
  const p1 = await writeP1(workflow, skeleton, 'pl-23-b');
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-23-b-review-p1', name: 'submit_plan_review', args: FIX }] },
  ]);
  await performOne(workflow, 'pl-23-b-review-p1', 'send_system_round');
  const reviewP1 = await plSystemRoundRef(workflow, reviewer, `planreview:${p1.ref.proposalId}:1`);
  expect(await verdictOf(workflow, reviewP1)).toBe('fix');

  // The planfix answers with plain text: it closes without a successor candidate.
  await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'PL-23(b) no successor candidate' }]);
  await performOne(workflow, 'pl-23-b-fix-p1', 'send_system_round');
  await plSystemRoundRef(workflow, adviser, `planfix:${p1.ref.proposalId}:1`);
  const fix = ready(await heartbeatUntil(workflow.world,
    () => workflow.world.platform.planReaders.planFixRead(workflow.goal, p1.ref, p1.revision),
    read => read.status === 'ready' && read.value.status === 'terminal', 32),
  'the terminal planfix read');
  expect(fix).toEqual({ status: 'terminal' });

  // The pass cards the candidate instead of sending another planfix.
  const body = await advancePLGoal(workflow.world, workflow.goal, 'pl-23-b-card') as {
    status: string; value?: { next: WorkflowAdvanceInput | null };
  };
  expect(body.status, JSON.stringify(body)).toBe('ready');
  expect(body.value?.next?.kind === 'perform' && body.value.next.operation.kind === 'send_system_round'
    ? (body.value.next.operation.request as { round?: { kind?: string } }).round?.kind : null)
    .not.toBe('planfix');
  const card = ready<CandidateCardFactsV1>(await workflow.world.post('decisions/candidate-card', {
    scope: { ...S6A_SCOPE }, input: { goalRef: workflow.goal, proposalRef: p1.ref },
  }), 'decisions/candidate-card');
  expect(card.card.source.kind).toBe('candidate');
  expect(card.card.state).toBe('waiting_answer');
  expect(card.exactReview).toMatchObject({ status: 'ready',
    value: { status: 'decided', verdict: 'fix', findings: FIX.findings } });
  expect((await requestHeads(workflow, adviser)).filter(head => head.startsWith('planfix:')))
    .toEqual([`planfix:${p1.ref.proposalId}:1`]);
});

it('PL-23(b): with no plan_only to refine, the wait names the fix_invalid row', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-23-b2',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const plan = await adoptPLPlanDraft(workflow.main, workflow.goal,
    plSingleStageDraft(workflow.goal, { label: 'pl-23-b2', taskIds: ['pl-a'], goalGate: true }), 'pl-23-b2');
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-23-b2-reviewer');
  const adviser = await createPLAdviserLine(workflow.world, 'pl-23-b2-adviser');
  const proposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: plan.ref, reason: { text: 'PL-23(b) P1', sources: [] },
    draft: plPlanChangeDraft(plan, workflow.goal, { planId: 'pl-plan-pl-23-b2-p1', obligations: plan.obligations,
      tasks: plan.tasks.map(task => task.taskId === 'pl-a' ? { ...task, title: 'PL-23(b) retitled' } : task),
      assignments: plan.assignments ?? [] }),
  }, 'pl-23-b2-propose'))) as { status: string; value: PlanProposal };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  const p1 = proposed.value;
  await workflow.world.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: 'pl-23-b2-review',
    name: 'submit_plan_review', args: { verdict: 'fix', findings: [{ taskId: 'pl-a', text: 'PL-23(b) retitle' }] } }] }]);
  await performOne(workflow, 'pl-23-b2-review', 'send_system_round');
  expect(await verdictOf(workflow, await plSystemRoundRef(workflow, reviewer,
    `planreview:${p1.ref.proposalId}:1`))).toBe('fix');
  await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'PL-23(b) no successor candidate' }]);
  await performOne(workflow, 'pl-23-b2-fix', 'send_system_round');
  await plSystemRoundRef(workflow, adviser, `planfix:${p1.ref.proposalId}:1`);
  await heartbeatUntil(workflow.world,
    () => workflow.world.platform.planReaders.planFixRead(workflow.goal, p1.ref, p1.revision),
    read => read.status === 'ready' && read.value.status === 'terminal', 32);

  const settled = await settlePLGoal(workflow.world, workflow.goal, 'pl-23-b2-settle') as {
    value: { state: string; reason: string | null; source?: { kind: string } };
  };
  expect(settled.value).toMatchObject({ state: 'waiting', source: { kind: 'candidate' } });
  expect(settled.value.reason).toContain('plan_candidate_waiting: fix_invalid');
});


it('PL-23(b): a refinement round already committed keeps the card row in the wait reason', async () => {
  const { workflow, skeleton, reviewer, adviser } = await openFixWorld('pl-23-b3');
  opened = workflow;
  const p1 = await writeP1(workflow, skeleton, 'pl-23-b3');
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-23-b3-review-p1', name: 'submit_plan_review', args: FIX }] }]);
  await performOne(workflow, 'pl-23-b3-review-p1', 'send_system_round');
  expect(await verdictOf(workflow, await plSystemRoundRef(workflow, reviewer,
    `planreview:${p1.ref.proposalId}:1`))).toBe('fix');
  await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'no successor' }]);
  await performOne(workflow, 'pl-23-b3-fix-p1', 'send_system_round');
  await plSystemRoundRef(workflow, adviser, `planfix:${p1.ref.proposalId}:1`);
  await heartbeatUntil(workflow.world,
    () => workflow.world.platform.planReaders.planFixRead(workflow.goal, p1.ref, p1.revision),
    read => read.status === 'ready' && read.value.status === 'terminal', 32);
  await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'refine answer' }]);
  const settled = await settlePLGoal(workflow.world, workflow.goal, 'pl-23-b3-settle') as
    { value: { state: string; reason: string | null; source?: { kind: string } } };
  expect(settled.value).toMatchObject({ state: 'waiting', source: { kind: 'candidate' } });
  expect(settled.value.reason).toContain('fix_invalid');
});


it('PL-23(c): an answered question card with the planresume still running reads waiting', async () => {
  const { workflow, skeleton, reviewer, adviser } = await openFixWorld('pl-23-c');
  opened = workflow;
  const p1 = await writeP1(workflow, skeleton, 'pl-23-c');
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-23-c-review-p1', name: 'submit_plan_review', args: FIX }] },
  ]);
  await performOne(workflow, 'pl-23-c-review-p1', 'send_system_round');
  const reviewP1 = await plSystemRoundRef(workflow, reviewer, `planreview:${p1.ref.proposalId}:1`);
  expect(await verdictOf(workflow, reviewP1)).toBe('fix');

  // The planfix answer asks the person.
  await workflow.world.scripted.script(adviser, [{
    kind: 'calls', calls: [{ callId: 'pl-23-c-questions', name: 'submit_plan_round', args: {
      answerKind: 'questions', summary: 'PL-23(c) which fix?',
      questions: ['PL-23(c) choose the fix'], reason: { text: 'PL-23(c) ask' },
    } }],
  }]);
  await performOne(workflow, 'pl-23-c-fix-p1', 'send_system_round');
  await plSystemRoundRef(workflow, adviser, `planfix:${p1.ref.proposalId}:1`);
  const cards = await heartbeatUntil(workflow.world, () => questionCards(workflow.world, workflow.goal),
    items => items.length > 0, 24);
  const card = cards[0];
  if (card === undefined) throw new Error('PL-23(c): the question card is missing');

  // Hold the continuation's model request before the card is answered.
  const resumeGate = await workflow.world.gates.modelRequest(adviser);
  await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'PL-23(c) resume answer' }]);
  await answerCard(workflow.world, card, 'pl-23-c-card-answer', 'PL-23(c): use the second option');
  await performOne(workflow, 'pl-23-c-resume', 'send_system_round');
  const resume = await plSystemRoundRef(workflow, adviser, 'planresume:');

  // Advance the Host clock until the continuation Query is live (bounded poll).
  let query = await readPlanningQuery(workflow.world, resume);
  for (let attempt = 0; attempt < 80 && query === null; attempt += 1) {
    workflow.world.clock.advance(25);
    await new Promise(resolve => setTimeout(resolve, 10));
    query = await readPlanningQuery(workflow.world, resume);
  }
  if (query === null) throw new Error('PL-23(c): the planresume Query was not created');
  expect(['pending', 'running', 'answered']).toContain(query.job.job.status);

  // The original planfix Query is terminal, but the resumed Query is in flight: waiting.
  const fixRead = ready(await workflow.world.platform.planReaders.planFixRead(
    workflow.goal, p1.ref, p1.revision), 'the in-flight planfix read');
  expect(fixRead).toEqual({ status: 'waiting' });
  expect((await requestHeads(workflow, adviser)).filter(head => head.startsWith('planfix:')))
    .toEqual([`planfix:${p1.ref.proposalId}:1`]);

  // One more pass while the continuation runs: no second planfix and no card for this candidate.
  const during = await settlePLGoal(workflow.world, workflow.goal, 'pl-23-c-during') as {
    status: string; value?: { state: string; reason: string | null; source?: unknown;
      waitBasis?: { reasons: string[] } };
  };
  expect(during.status, JSON.stringify(during)).toBe('ready');
  expect(during.value?.state).toBe('waiting');
  expect(during.value?.source, 'the candidate is still waiting on its fix, not on a card').toBeUndefined();
  expect(during.value?.waitBasis?.reasons).toContain('plan_fix_sent');
  expect(during.value?.reason ?? '').not.toContain('fix_invalid');
  expect((await requestHeads(workflow, adviser)).filter(head => head.startsWith('planfix:')))
    .toEqual([`planfix:${p1.ref.proposalId}:1`]);

  // The continuation ends with plain text: no candidate, so the last round's end reads terminal.
  resumeGate.release();
  const ended = ready(await heartbeatUntil(workflow.world,
    () => workflow.world.platform.planReaders.planFixRead(workflow.goal, p1.ref, p1.revision),
    read => read.status === 'ready' && read.value.status === 'terminal', 32),
  'the terminal continuation read');
  expect(ended).toEqual({ status: 'terminal' });
});

it('PL-23(d): the P2 fix round asks the person; planresume continues from P2 and answers M', async () => {
  const { workflow, skeleton, reviewer, adviser } = await openFixWorld('pl-23-d',
    [{ ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }]);
  opened = workflow;
  const aTask = skeleton.tasks.find(task => task.taskId === 'pl-a');
  if (aTask === undefined) throw new Error('PL-23(d): the pl-a Task is missing');
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-23-d-line', role: S6A_WORK_ROLE, tasks: [aTask],
  }));
  // P2 alone carries this optional Task: a continuation based on the active Plan would lose it.
  const p2Only: RuntimeTask = { taskId: 'pl-p2-only', stageId: 'pl-stage-2', title: 'PL-23(d) only in P2',
    requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'stage', stageId: 'pl-stage-2' }, executionIntent: 'request_execution', sizeClass: 'small' };
  const p2Draft = p1Draft(skeleton.plan, 'pl-23-d-p2');
  p2Draft.tasks = [...p2Draft.tasks, p2Only];
  p2Draft.assignments = [...(p2Draft.assignments ?? []), { taskId: p2Only.taskId,
    role: S6A_WORK_ROLE.templateId, instruction: 'PL-23(d) the P2-only task' }];
  const planAnswer = (id: string, draft: PlanRevisionDraft) => ({ kind: 'calls' as const, calls: [{
    callId: `pl-23-d-${id}`, name: 'submit_plan_round', args: { answerKind: 'plan', summary: `PL-23(d) ${id}`,
      plan: plToolPlanOf(draft), reason: { text: `PL-23(d) ${id}`, affectedTaskIds: ['pl-placeholder-pl-stage-2'] } },
  }] });
  await workflow.world.scripted.script(adviser, [
    planAnswer('p1', p1Draft(skeleton.plan, 'pl-23-d-p1')),
    planAnswer('p2', p2Draft),
    { kind: 'calls', calls: [{ callId: 'pl-23-d-questions', name: 'submit_plan_round', args: {
      answerKind: 'questions', summary: 'PL-23(d) which option?',
      questions: ['PL-23(d) choose the option'], reason: { text: 'PL-23(d) ask' },
    } }] },
    planAnswer('p3', p1Draft(skeleton.plan, 'pl-23-d-p3')),
  ]);
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-23-d-review-p1', name: 'submit_plan_review', args: FIX }] },
    { kind: 'calls', calls: [{ callId: 'pl-23-d-review-p2', name: 'submit_plan_review', args: FIX }] },
    { kind: 'calls', calls: [{ callId: 'pl-23-d-review-p3', name: 'submit_plan_review', args: PASS }] },
  ]);

  // M: a real Work Run's action request; its plan answer writes P1, and the first fix round writes P2.
  const sent = await sendPLActionWait(workflow.world, { goal: workflow.goal, session: line, sessionTaskId: 'pl-a',
    recipient: adviser.ref, text: 'PL-23(d) plan the next stage', taskRef: aTask, label: 'pl-23-d-send' });
  const p1 = ready<PlanProposal>(await awaitProposal(workflow.world, proposalRefOf(sent.message.ref, workflow.goal)), 'P1');
  await performOne(workflow, 'pl-23-d-review-p1', 'send_system_round');
  expect(await verdictOf(workflow, await plSystemRoundRef(workflow, reviewer,
    `planreview:${p1.ref.proposalId}:1`))).toBe('fix');
  await performOne(workflow, 'pl-23-d-fix-p1', 'send_system_round');
  const fixP1 = await plSystemRoundRef(workflow, adviser, `planfix:${p1.ref.proposalId}:1`);
  const p2 = ready<PlanProposal>(await awaitProposal(workflow.world, proposalRefOf(fixP1, workflow.goal)), 'P2');

  // P2's fix round asks the person; the answered card sends the one `planresume:` of that Query.
  await performOne(workflow, 'pl-23-d-review-p2', 'send_system_round');
  expect(await verdictOf(workflow, await plSystemRoundRef(workflow, reviewer,
    `planreview:${p2.ref.proposalId}:1`))).toBe('fix');
  await performOne(workflow, 'pl-23-d-fix-p2', 'send_system_round');
  const fixP2 = await plSystemRoundRef(workflow, adviser, `planfix:${p2.ref.proposalId}:1`);
  const cards = await heartbeatUntil(workflow.world, () => questionCards(workflow.world, workflow.goal),
    items => items.length > 0, 24);
  const card = cards[0];
  if (card === undefined) throw new Error('PL-23(d): the question card is missing');
  await answerCard(workflow.world, card, 'pl-23-d-card-answer', 'PL-23(d): use the second option');
  await performOne(workflow, 'pl-23-d-resume', 'send_system_round');
  const resumeHead = `planresume:${workflow.goal.goalId}:${interventionPlanningQueryRefs(fixP2).queryJobRef.queryJobId}`;
  const resume = await plSystemRoundRef(workflow, adviser, resumeHead);
  const p3 = ready<PlanProposal>(await awaitProposal(workflow.world, proposalRefOf(resume, workflow.goal)), 'P3');

  // The continuation's base is the candidate under repair, its `basedOn` stays, and its reply source is M.
  expect(p3.draft.tasks.map(task => task.taskId), 'the base is P2, not the active Plan').toContain(p2Only.taskId);
  expect(p3.basedOn).toEqual(p2.basedOn);
  const resumeQuery = await readPlanningQuery(workflow.world, resume);
  expect(resumeQuery?.job.job.intent.execution).toMatchObject({ repliesToMessageRef: sent.message.ref });

  // P3 gets its own review and adoption; the lineage through the continuation retires P2.
  await performOne(workflow, 'pl-23-d-review-p3', 'send_system_round');
  expect(await verdictOf(workflow, await plSystemRoundRef(workflow, reviewer,
    `planreview:${p3.ref.proposalId}:1`))).toBe('pass');
  await performOne(workflow, 'pl-23-d-adopt', 'adopt_plan');
  expect((await readProposal(workflow.world, p3.ref)).status).toBe('accepted');
  expect(ready(await workflow.world.platform.planReaders.latestAgentCandidate(workflow.goal), 'the latest candidate'),
    'P2 stays a candidate record but left the pending selection').toBeNull();
  expect((await readProposal(workflow.world, p2.ref)).status).toBe('candidate');
  expect((await requestHeads(workflow, reviewer)).sort()).toEqual([p1, p2, p3].map(round =>
    `planreview:${round.ref.proposalId}:1`).sort());
  expect((await requestHeads(workflow, adviser)).sort()).toEqual([`planfix:${p1.ref.proposalId}:1`,
    `planfix:${p2.ref.proposalId}:1`, resumeHead].sort());
});

it('PL-23(e): a planfix ended unsettled, the Goal cancelled: the adviser line archives once the Host settles it', async () => {
  const { workflow, skeleton, reviewer, adviser } = await openFixWorld('pl-23-c');
  opened = workflow;
  const { world } = workflow;
  await world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-23-c-review-p1', name: 'submit_plan_review', args: FIX }] }]);
  await world.scripted.script(adviser, [{ kind: 'text', text: 'PL-23(c) no plan this time' }]);
  const p1 = await writeP1(workflow, skeleton, 'pl-23-c');
  await performOne(workflow, 'pl-23-c-review-p1', 'send_system_round');
  expect(await verdictOf(workflow, await plSystemRoundRef(workflow, reviewer, `planreview:${p1.ref.proposalId}:1`)))
    .toBe('fix');
  await performOne(workflow, 'pl-23-c-fix-p1', 'send_system_round');
  const fix = await plSystemRoundRef(workflow, adviser, `planfix:${p1.ref.proposalId}:1`);
  await heartbeatUntil(world, () => readPlanningQuery(world, fix), query => (query?.run.run.executionState ?? null) !== null);
  commitBarrier.failCommitOnce(byIdentityPrefix('session-message-send:'));   // the Host's closing notice
  await heartbeatUntil(world, () => readPlanningQuery(world, fix), query => query?.job.job.status === 'answered'
    || query?.run.run.status === 'closed' || query?.run.run.executionState?.phase === 'settled');
  await cancelS7AGoal(world, workflow.goal);
  const archive = async (requestId: string) => {
    const card = await world.readSession(adviser);
    return (await world.post('sessions/archive', graphWrite(S6A_SCOPE, { sessionRef: adviser.ref, reason: 'PL-23(c)' },
      requestId, [{ ref: card.record.ref, revision: card.record.revision }]))).body;
  };
  expect(await archive('pl-23-c-early')).toMatchObject({ status: 'rejected', code: 'busy',
    reason: expect.stringContaining('archive_settlement_pending') });
  const source = await heartbeatUntil(world, () => readS7BMessage(world, fix),
    message => message.response !== null || message.withdrawnAt !== null);
  expect(source.response !== null || source.withdrawnAt !== null).toBe(true);
  expect(await archive('pl-23-c-late')).toMatchObject({ status: 'committed', value: { lifecycle: 'archived' } });
});
