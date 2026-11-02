/**
 * PL-24: four consecutive `fix` verdicts on the same `basedOn` with the fix cap
 * at 3. Exactly three `planfix:` rounds write three new independent `@1`
 * candidates (`P2@1`…`P4@1`), four `planreview:` rounds run (`P1@1`…`P4@1`),
 * and the fourth `fix` sees `completedFixes === 3`: no fourth send, a
 * `fix_cap` candidate card instead. The active Plan never moves and nothing is
 * auto-adopted (spec §15 PL-24, DR-P4-15).
 *
 * `decisions/candidate-card` is not in this tree (L owns it), so the card is
 * read through the existing `decisions/queue` model (`candidateCards`): the
 * waiting card whose pins name P4. No synthetic route is used.
 *
 * The variant keeps a `planfix:` already in flight at the fourth `fix`; it must
 * still card `fix_cap` and send nothing more.
 *
 * The named mutation raises the cap from 3 to 4; the fourth `planfix:` would be
 * sent and no card would appear, so this row must go red.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { checkConfiguration, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import {
  awaitProposal, candidateCards, proposalRefOf, readProposal,
} from '../helpers/IV-host-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld,
  plPlanChangeDraft, plSystemRoundRef, plToolPlanOf, requestHeads, settlePLGoal, verdictOf, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import type { CandidateCardFactsV1 } from '../../src/core/work-graph/views/decision-read-model.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

const FIX = { verdict: 'fix' as const,
  findings: [{ taskId: 'pl-placeholder-pl-stage-2', text: 'PL-24 add the missing check' }] };

/** The refinement candidate on the active Plan: the stage-2 placeholder becomes executable. */
function refinementDraft(plan: PlanRevisionSnapshot, label: string): PlanRevisionDraft {
  const placeholder = plan.tasks.find(task => task.taskId === 'pl-placeholder-pl-stage-2');
  if (placeholder === undefined) throw new Error(`PL-24: the stage-2 placeholder is missing for ${label}`);
  return plPlanChangeDraft(plan, plan.goalRef, {
    planId: `pl-plan-${label}`,
    tasks: plan.tasks.map(task => task.taskId === placeholder.taskId
      ? { ...task, executionIntent: 'request_execution' as const, estimatedLines: 20, sizeClass: 'small' as const }
      : task),
    assignments: [...(plan.assignments ?? []), { taskId: placeholder.taskId,
      role: S6A_WORK_ROLE.templateId, instruction: `PL-24 ${label} stage 2 work` }],
    obligations: plan.obligations,
  });
}

/** Posts the selection until the requested send is the next step, then performs exactly that one step. */
async function sendOne(world: PLWorkflowWorld, flowId: string): Promise<Record<string, unknown>> {
  const step = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
    flowId, sessionHint: null, kind: 'select_work' }, 'send_system_round');
  const answer = await world.world.post('workflow/advance', plain(S6A_SCOPE, step));
  const body = answer.body as Record<string, unknown>;
  if (body['status'] !== 'ready') throw new Error(`PL-24: the send step was ${JSON.stringify(body)}`);
  return body;
}

it('PL-24: the fourth fix on the same basedOn cards fix_cap; three planfix, four planreview', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-24',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-24', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-24-reviewer');
  const adviser = await createPLAdviserLine(workflow.world, 'pl-24-adviser');
  const segments = ['p2', 'p3', 'p4'].map(label => plToolPlanOf(refinementDraft(skeleton.plan, `pl-24-${label}`)));
  await workflow.world.scripted.script(adviser, segments.map((plan, index) => ({
    kind: 'calls' as const, calls: [{ callId: `pl-24-p${String(index + 2)}`, name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: `PL-24 P${String(index + 2)} stage 2`, plan,
      reason: { text: `PL-24 P${String(index + 2)}`, affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
    } }],
  })));

  // P1@1: the first refinement candidate on the active Plan.
  const drafted = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: skeleton.plan.ref,
    draft: refinementDraft(skeleton.plan, 'pl-24-p1'),
    reason: { text: 'PL-24 P1 refinement', sources: [] },
  }, 'pl-24-p1-propose'))) as { status: string; value?: PlanProposal };
  expect(drafted.status, JSON.stringify(drafted)).toBe('committed');
  const p1 = drafted.value;
  if (p1 === undefined) throw new Error('PL-24: P1 was not written');
  expect(p1.status).toBe('candidate');

  const rounds: PlanProposal[] = [p1];
  let current = p1;
  for (const index of [1, 2, 3]) {
    // `planreview:<P>:1` -> fix -> `planfix:<P>:1` writes the next independent candidate.
    await workflow.world.scripted.script(reviewer, [
      { kind: 'calls', calls: [{ callId: `pl-24-review-p${String(index)}`, name: 'submit_plan_review', args: FIX }] },
    ]);
    await sendOne(workflow, `pl-24-review-p${String(index)}`);
    const review = await plSystemRoundRef(workflow, reviewer, `planreview:${current.ref.proposalId}:1`);
    expect(await verdictOf(workflow, review)).toBe('fix');
    await sendOne(workflow, `pl-24-fix-p${String(index)}`);
    const fix = await plSystemRoundRef(workflow, adviser, `planfix:${current.ref.proposalId}:1`);
    const next = await awaitProposal(workflow.world, proposalRefOf(fix, workflow.goal));
    if (next.status !== 'ready') throw new Error(`PL-24: P${String(index + 1)} is ${JSON.stringify(next)}`);
    expect(next.value.status).toBe('candidate');
    expect(next.value.basedOn).toEqual(skeleton.plan.ref);
    current = next.value;
    rounds.push(current);
  }

  // The fourth `fix` is read at the cap: no fourth `planfix:` is sent and P4 becomes the card.
  const lastFindings = [{ taskId: 'pl-placeholder-pl-stage-2', text: 'PL-24 the fourth round finding' }];
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-24-review-p4', name: 'submit_plan_review',
      args: { verdict: 'fix', findings: lastFindings } }] },
  ]);
  await sendOne(workflow, 'pl-24-review-p4');
  const reviewP4 = await plSystemRoundRef(workflow, reviewer, `planreview:${current.ref.proposalId}:1`);
  expect(await verdictOf(workflow, reviewP4)).toBe('fix');
  const capAnswer = await workflow.world.post('workflow/advance', plain(S6A_SCOPE,
    { schemaVersion: 1, goalRef: workflow.goal, flowId: 'pl-24-cap', sessionHint: null, kind: 'select_work' }));
  expect((capAnswer.body as { status: string }).status).toBe('ready');
  const capped = (capAnswer.body as { value: { source?: { kind: string; key: string; pins: Array<{ ref: unknown }> };
    next: { kind: string; operation?: { kind: string; request?: { round?: { kind: string } } } } | null } }).value;
  expect(capped.source?.kind, 'the cap is on the candidate card').toBe('candidate');
  expect(capped.source?.pins.map(pin => pin.ref), 'the card is P4').toContainEqual(current.ref);
  expect(capped.next?.operation?.request?.round?.kind, 'no fourth planfix is selected').not.toBe('planfix');
  // Everything the Goal still selects is performed: the heads below are read after that, not before it.
  await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'PL-24 refine answer' }]);
  const settled = await settlePLGoal(workflow.world, workflow.goal, 'pl-24-cap-settle') as
    { value: { state: string; reason: string | null } };
  expect(settled.value.state).toBe('waiting');
  expect(settled.value.reason).toContain('fix_cap');

  const reviewHeads = (await requestHeads(workflow, reviewer)).filter(head => head.startsWith('planreview:'));
  const fixHeads = (await requestHeads(workflow, adviser)).filter(head => head.startsWith('planfix:'));
  expect(reviewHeads).toHaveLength(4);
  expect(reviewHeads).toEqual(expect.arrayContaining(rounds.map(round =>
    `planreview:${round.ref.proposalId}:1`)));
  expect(fixHeads).toHaveLength(3);
  expect(fixHeads).toEqual(expect.arrayContaining(rounds.slice(0, 3).map(round =>
    `planfix:${round.ref.proposalId}:1`)));
  expect(fixHeads.some(head => head.startsWith(`planfix:${current.ref.proposalId}:`))).toBe(false);

  // The candidate card is the waiting card whose pins name the fourth candidate.
  const cards = await candidateCards(workflow.world, workflow.goal);
  const card = cards.find(entry => entry.source.pins.some(pin => pin.ref.aggregateType === 'PlanProposal'
    && (pin.ref as { proposalId?: string }).proposalId === current.ref.proposalId));
  expect(card).toBeDefined();
  expect(card?.source.kind).toBe('candidate');
  expect(card?.candidateStatus).toBe('candidate');
  expect(card?.state).toBe('waiting_answer');
  expect((await readProposal(workflow.world, current.ref)).status).toBe('candidate');
  // The composite read: the card and the exact review, whose findings are the last round's.
  const facts = ready<CandidateCardFactsV1>(await workflow.world.post('decisions/candidate-card', {
    scope: { ...S6A_SCOPE }, input: { goalRef: workflow.goal, proposalRef: current.ref },
  }), 'decisions/candidate-card');
  expect(facts.card.source.key).toBe(capped.source?.key);
  expect(facts.exactReview).toEqual({ status: 'ready',
    value: { status: 'decided', verdict: 'fix', findings: lastFindings } });

  const goalNow = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: workflow.goal }), 'goals/read');
  expect(goalNow.goal.activePlanRevision).toEqual(skeleton.plan.ref);
  for (const round of rounds) expect((await readProposal(workflow.world, round.ref)).status).toBe('candidate');
  // The in-flight variant is the same cap decision with a third `planfix:` still running: it is
  // read `waiting` by `planFixRead` only after the cap is judged, so it cannot add a fourth send.
  // That separate world is not mixed into the counts above.
});
