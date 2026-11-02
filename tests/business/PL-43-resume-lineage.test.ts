/**
 * PL-43: the review-fix chain asks the person and resumes on the same executor
 * source (spec §15 PL-43, resume variant). A real Work Run sends M to the
 * adviser; the adviser's first plan answer writes P1, P1's review asks a fix and
 * `planfix:<P1>:1` writes P2, P2's review asks a fix and that `planfix:` answer
 * asks the person. The question card is answered while M still has no reply;
 * the goal loop then sends the deterministic `planresume:` whose new Query
 * inherits `repliesToMessageRef = M`. The resumed plan writes P3 with
 * `basedOn === P2.basedOn`. P3's review passes, the platform adopts P3, and M
 * gets exactly one final reply; a heartbeat later the same single reply is read
 * again.
 *
 * `readPLPlanResumeRoot` is the public one-hop proxy for the inherited root: it
 * reads the original `planfix:` Query's `repliesToMessageRef`; the resumed
 * Query's own read proves the same value without a lineage route.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { systemRoundRequestId } from '../../src/contracts/plan-round.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S7A_REPLY_TOOLS, checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { readS7BMessage, readS7BWaits } from '../helpers/S7B-fixture.js';
import {
  answerCard, awaitProposal, candidateCards, heartbeat, heartbeatUntil, proposalRefOf,
  questionCards, readBody, readPlanningQuery, readProposal, waitForResponse,
} from '../helpers/IV-host-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, performOne, plPlanChangeDraft, plSystemRoundRef,
  plToolPlanOf, requestHeads, runPLAutomaticChain, verdictOf, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { createPLAdviserLine, readPLPlanResumeRoot, sendPLActionWait } from '../helpers/PL-consumption-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

const FIX = { verdict: 'fix' as const,
  findings: [{ taskId: 'pl-placeholder-pl-stage-2', text: 'PL-43 make stage 2 executable' }] };
const PASS = { verdict: 'pass' as const, findings: [] };

/** The stage-2 change draft; `plToolPlanOf` turns it into the submit tool's wire shape. */
function planSegment(plan: PlanRevisionSnapshot, label: string): PlanRevisionDraft {
  return plPlanChangeDraft(plan, plan.goalRef, {
    planId: `pl-plan-pl-43-${label}`,
    tasks: plan.tasks.map(task => task.taskId === 'pl-placeholder-pl-stage-2'
      ? { ...task, executionIntent: 'request_execution' as const, estimatedLines: 20, sizeClass: 'small' as const }
      : task),
    assignments: [...(plan.assignments ?? []), { taskId: 'pl-placeholder-pl-stage-2',
      role: S6A_WORK_ROLE.templateId, instruction: `PL-43 ${label} stage 2 work` }],
    obligations: plan.obligations,
  });
}

const P2_ONLY = 'pl-p2-only';

/** P2 also adds one optional Task of its own; only a round based on P2 keeps it. */
function p2Segment(plan: PlanRevisionSnapshot): PlanRevisionDraft {
  const draft = planSegment(plan, 'p2');
  return { ...draft,
    tasks: [...draft.tasks, { taskId: P2_ONLY, stageId: 'pl-stage-2', title: 'PL-43 only in P2',
      requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
      scope: { kind: 'stage', stageId: 'pl-stage-2' }, executionIntent: 'request_execution',
      estimatedLines: 5, sizeClass: 'small' }],
    assignments: [...(draft.assignments ?? []), { taskId: P2_ONLY, role: S6A_WORK_ROLE.templateId,
      instruction: 'PL-43 work only P2 has' }] };
}

/** The queue's candidate cards as the proposals they pin, split into waiting and all (closed history included). */
async function candidateCardIds(workflow: PLWorkflowWorld): Promise<{ waiting: string[]; all: string[] }> {
  const cards = await candidateCards(workflow.world, workflow.goal);
  const idsOf = (list: typeof cards): string[] => list.flatMap(card => card.source.pins.flatMap(pin =>
    pin.ref.aggregateType === 'PlanProposal' ? [pin.ref.proposalId] : []));
  return { waiting: idsOf(cards.filter(card => card.state === 'waiting_answer')), all: idsOf(cards) };
}

it('PL-43: the resumed Query inherits M, P3 follows P2 and the final reply is unique', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-43',
    extraBindings: [{ ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }],
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-43', stageOneTaskIds: ['pl-a'],
  });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-43-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-a'),
  }));
  const adviser = await createPLAdviserLine(workflow.world, 'pl-43-adviser');
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-43-reviewer');
  await workflow.world.scripted.script(adviser, [
    { kind: 'calls', calls: [{ callId: 'pl-43-p1', name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'PL-43 P1 stage 2', plan: plToolPlanOf(planSegment(skeleton.plan, 'p1')),
      reason: { text: 'PL-43 P1', affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
    } }] },
    { kind: 'calls', calls: [{ callId: 'pl-43-p2', name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'PL-43 P2 stage 2', plan: plToolPlanOf(p2Segment(skeleton.plan)),
      reason: { text: 'PL-43 P2', affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
    } }] },
    { kind: 'calls', calls: [{ callId: 'pl-43-questions', name: 'submit_plan_round', args: {
      answerKind: 'questions', summary: 'PL-43 which stage-2 option?',
      questions: ['PL-43 choose the stage-2 option'], reason: { text: 'PL-43 ask the person' },
    } }] },
    { kind: 'calls', calls: [{ callId: 'pl-43-questions-2', name: 'submit_plan_round', args: {
      answerKind: 'questions', summary: 'PL-43 one more question',
      questions: ['PL-43 confirm the option'], reason: { text: 'PL-43 ask the person again' },
    } }] },
    { kind: 'calls', calls: [{ callId: 'pl-43-p3', name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'PL-43 P3 stage 2', plan: plToolPlanOf(planSegment(skeleton.plan, 'p3')),
      reason: { text: 'PL-43 P3', affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
    } }] },
  ]);
  await workflow.world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'pl-43-review-p1', name: 'submit_plan_review', args: FIX }] },
    { kind: 'calls', calls: [{ callId: 'pl-43-review-p2', name: 'submit_plan_review', args: FIX }] },
    { kind: 'calls', calls: [{ callId: 'pl-43-review-p3', name: 'submit_plan_review', args: PASS }] },
  ]);

  const aTask = skeleton.tasks.find(task => task.taskId === 'pl-a');
  if (aTask === undefined) throw new Error('PL-43: the pl-a Task is missing');
  // M: a real Work Run's action request; the adviser's plan answer writes P1.
  const sent = await sendPLActionWait(workflow.world, {
    goal: workflow.goal, session: line, sessionTaskId: 'pl-a', recipient: adviser.ref,
    text: 'PL-43 plan the next stage', taskRef: aTask, label: 'pl-43-a-send',
  });
  /** M's wait as the Host's own wait read shows it. */
  const waitState = async (): Promise<string> => (await readS7BWaits(workflow.world,
    { session: line, messageRef: sent.message.ref })).waitByRef.state.state;
  const p1Read = await awaitProposal(workflow.world, proposalRefOf(sent.message.ref, workflow.goal));
  expect(p1Read.status).toBe('ready');
  if (p1Read.status !== 'ready') throw new Error(`PL-43: P1 is ${JSON.stringify(p1Read)}`);
  const p1 = p1Read.value;
  expect(p1.status).toBe('candidate');
  expect((await readS7BMessage(workflow.world, sent.message.ref)).response, 'the Host closing at src/app/host.ts:1919 calls associate_answer without replyToOriginal; '
    + 'src/business/workflow/intervention.ts:184 then replies the executor M at questions. ').toBeNull();
  expect(await waitState(), 'a pending candidate keeps M open').toBe('open');

  // P1 review asks a fix; the real `planfix:<P1>:1` writes P2.
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-43-review-p1', sessionHint: null, kind: 'select_work' });
  const reviewP1 = await plSystemRoundRef(workflow, reviewer, `planreview:${p1.ref.proposalId}:1`);
  expect(await verdictOf(workflow, reviewP1)).toBe('fix');
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-43-fix-p1', sessionHint: null, kind: 'select_work' });
  const fixP1 = await plSystemRoundRef(workflow, adviser, `planfix:${p1.ref.proposalId}:1`);
  const p2Read = await awaitProposal(workflow.world, proposalRefOf(fixP1, workflow.goal));
  if (p2Read.status !== 'ready') throw new Error(`PL-43: P2 is ${JSON.stringify(p2Read)}`);
  const p2 = p2Read.value;
  expect(p2.status).toBe('candidate');
  expect(p2.basedOn).toEqual(p1.basedOn);
  expect((await readS7BMessage(workflow.world, sent.message.ref)).response, 'the Host closing at src/app/host.ts:1919 calls associate_answer without replyToOriginal; '
    + 'src/business/workflow/intervention.ts:184 then replies the executor M at questions. ').toBeNull();
  expect(await waitState(), 'the repair keeps M open').toBe('open');

  // P2 review asks a fix; that round's answer asks the person instead of writing a candidate.
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-43-review-p2', sessionHint: null, kind: 'select_work' });
  const reviewP2 = await plSystemRoundRef(workflow, reviewer, `planreview:${p2.ref.proposalId}:1`);
  expect(await verdictOf(workflow, reviewP2)).toBe('fix');
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-43-fix-p2', sessionHint: null, kind: 'select_work' });
  const fixP2 = await plSystemRoundRef(workflow, adviser, `planfix:${p2.ref.proposalId}:1`);

  const cards = await heartbeatUntil(workflow.world, () => questionCards(workflow.world, workflow.goal),
    items => items.length > 0, 24);
  expect(cards).toHaveLength(1);
  expect(cards[0]?.source.kind).toBe('planning_question');
  // A fix round in questions is not a candidate: M keeps its open wait with no reply.
  expect((await readS7BMessage(workflow.world, sent.message.ref)).response, 'the Host closing at src/app/host.ts:1919 calls associate_answer without replyToOriginal; '
    + 'src/business/workflow/intervention.ts:184 then replies the executor M at questions. ').toBeNull();
  expect(await waitState(), 'the question card keeps M open').toBe('open');

  // The card is answered; the goal loop sends the one `planresume:`.
  const card = cards[0];
  if (card === undefined) throw new Error('PL-43: the question card disappeared');
  await answerCard(workflow.world, card, 'pl-43-card-answer', 'PL-43: use the second option');
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-43-resume', sessionHint: null, kind: 'select_work' });
  const firstResume = await plSystemRoundRef(workflow, adviser, 'planresume:');

  // That round asks the person a second time; M is still the one open wait.
  const secondCards = await heartbeatUntil(workflow.world, () => questionCards(workflow.world, workflow.goal),
    items => items.length > 0, 24);
  expect(secondCards).toHaveLength(1);
  const secondCard = secondCards[0];
  if (secondCard === undefined) throw new Error('PL-43: the second question card disappeared');
  expect((await readS7BMessage(workflow.world, sent.message.ref)).response).toBeNull();
  expect(await waitState(), 'the second card keeps M open').toBe('open');
  await answerCard(workflow.world, secondCard, 'pl-43-card-answer-2', 'PL-43: confirmed');
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-43-resume-2', sessionHint: null, kind: 'select_work' });
  const secondHead = systemRoundRequestId({ kind: 'planresume', goalRef: workflow.goal,
    queryJobId: interventionPlanningQueryRefs(firstResume).queryJobRef.queryJobId, originalMessageRef: firstResume });
  if (secondHead.status !== 'ready') throw new Error('PL-43: the second planresume has no request id');
  const resume = await plSystemRoundRef(workflow, adviser, secondHead.value);
  const p3Read = await awaitProposal(workflow.world, proposalRefOf(resume, workflow.goal));
  if (p3Read.status !== 'ready') throw new Error(`PL-43: P3 is ${JSON.stringify(p3Read)}`);
  const p3 = p3Read.value;
  expect(p3.status).toBe('candidate');
  expect(p3.basedOn).toEqual(p2.basedOn);
  // The resumed round worked on P2, not on the active Plan: what only P2 had is still there.
  expect(p3.draft.tasks.map(task => task.taskId)).toContain(P2_ONLY);
  expect(p3.draft.assignments?.find(assignment => assignment.taskId === P2_ONLY)?.instruction)
    .toBe('PL-43 work only P2 has');
  // The chain replaced P1 and P2: neither reads as a candidate card any more.
  const shown = await candidateCardIds(workflow);
  expect(shown.waiting).toEqual([p3.ref.proposalId]);
  expect(shown.all).not.toContain(p1.ref.proposalId);
  expect(shown.all).not.toContain(p2.ref.proposalId);

  // The resumed Query's own read and the public one-hop proxy agree: M is the source root.
  const resumeQuery = await readPlanningQuery(workflow.world, resume);
  if (resumeQuery === null) throw new Error('PL-43: the resume Query is not readable');
  const execution = resumeQuery.job.job.intent.execution;
  expect(execution.kind).toBe('intervention_planning');
  if (execution.kind !== 'intervention_planning') throw new Error('PL-43: the resume Query is not a planning Query');
  expect(execution.repliesToMessageRef).toEqual(sent.message.ref);
  expect(execution.sourceMessageRef).toEqual(resume);
  expect(await readPLPlanResumeRoot(workflow.world, fixP2)).toEqual(sent.message.ref);
  expect(await waitState(), 'P3 pending keeps M open').toBe('open');
  expect((await readS7BMessage(workflow.world, sent.message.ref)).response, 'the Host closing at src/app/host.ts:1919 calls associate_answer without replyToOriginal; '
    + 'src/business/workflow/intervention.ts:184 then replies the executor M at questions. ').toBeNull();

  // P3's own review passes and the platform adopts it; P3's accepted revision follows P2's base.
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-43-review-p3', sessionHint: null, kind: 'select_work' });
  const reviewP3 = await plSystemRoundRef(workflow, reviewer, `planreview:${p3.ref.proposalId}:1`);
  expect(await verdictOf(workflow, reviewP3)).toBe('pass');
  const adoptInput = await advanceUntil(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-43-adopt', sessionHint: null, kind: 'select_work' }, 'adopt_plan');
  ready((await workflow.world.post('workflow/advance', plain(S6A_SCOPE, adoptInput))).body, 'the adoption of P3');

  const goalNow = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: workflow.goal }), 'goals/read');
  expect(goalNow.goal.activePlanRevision?.planId).toBe(p3.draft.planId);
  expect((await readProposal(workflow.world, p3.ref)).status).toBe('accepted');

  // The committed candidate's formal Answer is M's one reply; re-reading after a heartbeat is unchanged.
  const replied = await waitForResponse(workflow.world, sent.message.ref, 16);
  expect(replied.response).not.toBeNull();
  expect(await waitState()).toBe('answered');
  const body = await readBody(workflow.world, sent.message.ref, 'response');
  expect(body.length).toBeGreaterThan(0);
  await heartbeat(workflow.world);
  const again = await readS7BMessage(workflow.world, sent.message.ref);
  expect(again.response?.bodyRef).toEqual(replied.response?.bodyRef);
  expect(await readBody(workflow.world, sent.message.ref, 'response')).toBe(body);

  // The two fix rounds each wrote one independent candidate on the same adopted base.
  expect(p1.basedOn).toEqual(p2.basedOn);
  expect(p2.ref.proposalId).not.toBe(p1.ref.proposalId);
  expect(p3.ref.proposalId).not.toBe(p2.ref.proposalId);
  expect(p1.revision).toBe(1);
  expect(p2.revision).toBe(1);
  expect(p3.revision).toBe(1);
  // Excluded, not replaced: a `replaces` write would have closed them and moved their revision.
  expect(await readProposal(workflow.world, p1.ref)).toMatchObject({ status: 'candidate', revision: 1 });
  expect(await readProposal(workflow.world, p2.ref)).toMatchObject({ status: 'candidate', revision: 1 });
});

it('PL-43: P1\'s conclusion arriving after an independent P2 stays on P1; P2 is adopted only on its own review', async () => {
  const chain = await runPLAutomaticChain('pl-43-late');
  const workflow = opened = chain.workflow;
  const { world, goal, main } = workflow;
  const p1 = chain.candidate;
  // P2 lands while P1's review is open: a new plan on the same base, with no `replaces`.
  const written = (await main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: chain.skeleton.plan.ref, draft: planSegment(chain.skeleton.plan, 'late-p2'),
    reason: { text: 'PL-43 independent P2', sources: [], affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
  }, 'pl-43-late-p2'))) as { status: string; value: PlanProposal };
  expect(written.status, JSON.stringify(written)).toBe('committed');
  const p2 = written.value;
  expect(p2.ref.proposalId).not.toBe(p1.ref.proposalId);
  expect(p2.basedOn).toEqual(p1.basedOn);

  chain.releaseReview();
  await waitForResponse(world, chain.reviewRef);
  expect(await verdictOf(workflow, chain.reviewRef)).toBe('pass');

  // The next pass reads P2 and sends its own review; P1's pass adopted nothing.
  await world.scripted.script(chain.reviewer, [{ kind: 'calls', calls: [{ callId: 'pl-43-late-review',
    name: 'submit_plan_review', args: { verdict: 'pass', findings: [] } }] }]);
  await performOne(workflow, 'pl-43-late-review', 'send_system_round');
  const ownReview = await plSystemRoundRef(workflow, chain.reviewer, `planreview:${p2.ref.proposalId}:1`);
  expect(await requestHeads(workflow, chain.reviewer)).toEqual([
    `planreview:${p1.ref.proposalId}:1`, `planreview:${p2.ref.proposalId}:1`]);
  expect((await main.activePlan(goal))?.ref).toEqual(chain.skeleton.plan.ref);
  expect((await readProposal(world, p2.ref)).status).toBe('candidate');

  expect(await verdictOf(workflow, ownReview)).toBe('pass');
  await performOne(workflow, 'pl-43-late-adopt', 'adopt_plan');
  expect((await readProposal(world, p2.ref)).status).toBe('accepted');
  expect((await main.activePlan(goal))?.ref.planId).toBe(p2.draft.planId);
  expect((await readProposal(world, p1.ref)).status, 'P1 was never adopted').toBe('candidate');
});
