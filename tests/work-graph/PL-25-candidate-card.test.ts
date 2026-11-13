/**
 * PL-25 / §6.4.1, §6.7.1: the platform's `readCandidateCard` composite.
 *
 * The candidate is a real `plans/propose` result on a real adopted Plan and all
 * four facts are read through the platform's own public `readCandidateCard`,
 * which closes over the composition root's published plan readers (the raw
 * mailbox's real receipt lookup) and the real taskbook export probe.
 *
 * `held` (a Goal held by an unresolved `GoalInterruption`, spec §5.5.2/97-9)
 * is a Goal-wait property, not one of the four card facts: the public card read
 * does not expose it, so this row does not add it here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { systemRoundRequestId } from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { PlanProposal, PlanProposalWithAdoption } from '../../src/core/work-graph/model/plan-contracts.js';
import { ag2bChecksConfiguration, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { startGoalDriver } from '../helpers/DRV-fixture.js';
import { readPlanningQuery, readProposal } from '../helpers/IV-host-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, plStageTwoDraft, requestHeads, settlePLGoal,
  type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, governS6B } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, committed, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { proposeCandidate } from '../scenarios/support/S5-decisions.js';

const worlds: S6AHostWorld[] = [];
const workflows: PLWorkflowWorld[] = [];
afterEach(async () => {
  for (const workflow of workflows.splice(0)) await workflow.close().catch(() => undefined);
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/** One real candidate on this world's adopted Plan, proposed through the shared S5 helper. */
async function seedCandidate(world: S6AHostWorld, goal: GoalRef,
  options: { govern?: boolean; label?: string; workspace?: S6ACardsWorkspace } = {}): Promise<PlanProposal> {
  const ws = options.workspace ?? s6aCardsWorkspace(world, S6A_SCOPE);
  if (options.govern !== false) await governS6B(world, ws, world.goals);
  const label = options.label ?? 'pl25-card';
  const adopted = await adoptS6BPlan(ws, goal, {
    label: `${label}-base`, taskIds: [`${label}-base-task`], role: 'builder',
  });
  const base = adopted.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2,
    planId: `${options.label ?? 'pl25-card'}-candidate`,
    planRevision: base.planRevision + 1,
    goalId: goal.goalId,
    stages: structuredClone(base.stages),
    tasks: structuredClone(base.tasks),
    assignments: structuredClone(base.assignments ?? []),
    obligations: structuredClone(base.obligations),
    taskHierarchy: structuredClone(base.taskHierarchy),
    executionDag: structuredClone(base.executionDag),
    taskRelations: structuredClone(base.taskRelations ?? []),
    inputRequirements: structuredClone(base.inputRequirements ?? []),
  };
  const proposed = await proposeCandidate(world.platform, world.humanContext(), {
    goalRef: goal, basedOn: adopted.plan.ref, draft, requestRef: null, requestId: `${label}-propose`,
  });
  return proposed;
}

describe('PL-25 candidate card facts', () => {
  it('returns the card together with the diagnosis, exact review and export result', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const goal = world.goals.first;
    const proposalRef = (await seedCandidate(world, goal)).ref;
    // A real installed check configuration so the pinned policy's `static`
    // requirement is covered: the diagnosis is a real array, not `null`.
    world.platform.registerCheckConfiguration({
      configuration: ag2bChecksConfiguration({ actor: world.ag2b.actor, command: 'true' }),
    });
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const ctx = ws.humanContext();
    const facts = await world.platform.readCandidateCard(ctx, { goalRef: goal, proposalRef });
    expect(facts.status).toBe('ready');
    if (facts.status !== 'ready') return;
    expect(facts.value.card.source.kind).toBe('candidate');
    expect(facts.value.card.state).toBe('waiting_answer');
    expect(Array.isArray(facts.value.diagnosis)).toBe(true);
    expect(facts.value.diagnosis).toEqual([]);
    // No reviewer line and no `planreview:` was ever sent: the real receipt
    // read answers the four-state `not_sent` (尚未审阅), never a folded empty.
    expect(facts.value.exactReview).toEqual({ status: 'ready', value: { status: 'not_sent' } });
    // The Host's rooted taskbook probe is wired; the candidate draft's stages
    // are empty, so it has no per-stage status to report.
    expect(facts.value.exportRead).toEqual({ status: 'ready', stages: [] });

    // Adopt the candidate: its record revision becomes 2. The card's own read
    // applies the same proposal ref and reads the pre-acceptance version
    // (`revision - 1`), which is still the un-reviewed `not_sent`.
    committed(await ws.post('plans/apply', graphWrite(ws.scope, {
      proposalRef, expectedProposalRevision: 1, decisionRefs: [],
    }, 'pl25-card-apply')), 'the candidate adoption');
    const accepted = await world.platform.readCandidateCard(ctx, { goalRef: goal, proposalRef });
    expect(accepted.status).toBe('ready');
    if (accepted.status !== 'ready') return;
    expect(accepted.value.card.state).toBe('closed');
    expect(accepted.value.exactReview).toEqual({ status: 'ready', value: { status: 'not_sent' } });
  });

  it('no review line: the Goal cards the candidate, sends no review, adopts nothing, the person still can', async () => {
    const workflow = await openPLWorkflowWorld({ label: 'pl25-no-review',
      extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
    workflows.push(workflow);
    const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
      label: 'pl25-no-review', stageOneTaskIds: ['pl-a'],
    });
    await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
    const adviser = await createPLAdviserLine(workflow.world, 'pl25-no-review-adviser');
    await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'PL-25 refine answer' }]);
    const candidate = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: workflow.goal, basedOn: skeleton.plan.ref,
      draft: { ...plStageTwoDraft(skeleton.plan, workflow.goal, 'pl25'), planId: 'pl-plan-pl25-no-review-v2' },
      reason: { text: 'PL-25 stage 2 candidate', sources: [], affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
    }, 'pl25-no-review-propose'))) as { status: string; value: PlanProposal };
    expect(candidate.status, JSON.stringify(candidate)).toBe('committed');

    // The automatic band with no review line: the Goal stops on the card.
    const settled = await settlePLGoal(workflow.world, workflow.goal, 'pl25-no-review-pass');
    expect(settled).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null,
      source: { kind: 'candidate' }, waitBasis: { reasons: expect.arrayContaining(['plan_candidate_waiting']) } } });
    expect((await requestHeads(workflow, adviser)).filter(head => head.startsWith('planreview:'))).toEqual([]);
    expect((await workflow.main.activePlan(workflow.goal))?.ref).toEqual(skeleton.plan.ref);
    expect((await readProposal(workflow.world, candidate.value.ref)).status).toBe('candidate');

    // The four facts over the route, then the card's proposal ref still applies by the person.
    const facts = ready<{ card: { source: { kind: string }; state: string }; diagnosis: unknown;
      exactReview: unknown; exportRead: { status: string } }>(await workflow.world.post('decisions/candidate-card', {
      scope: { ...S6A_SCOPE }, input: { goalRef: workflow.goal, proposalRef: candidate.value.ref },
    }), 'decisions/candidate-card');
    expect(facts.card).toMatchObject({ source: { kind: 'candidate' }, state: 'waiting_answer' });
    expect(facts.diagnosis).toEqual([]);
    expect(facts.exactReview).toEqual({ status: 'ready', value: { status: 'not_sent' } });
    expect(facts.exportRead.status).toBe('ready');
    committed(await workflow.main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: candidate.value.ref, expectedProposalRevision: candidate.value.revision, decisionRefs: [],
    }, 'pl25-no-review-apply')), 'the person adopting the card');
    expect((await workflow.main.activePlan(workflow.goal))?.planRevision).toBe(skeleton.plan.planRevision + 1);
  });

  it('unknown coverage and no settings directory are each their own fact, never an empty result', async () => {
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { settings: {} } });
    worlds.push(world);
    const goal = world.goals.first;
    const proposalRef = (await seedCandidate(world, goal)).ref;
    // No check configuration is installed: coverage is unknown, not "no finding".
    const facts = ready<{ diagnosis: unknown; exactReview: unknown; exportRead: unknown }>(
      await world.post('decisions/candidate-card', { scope: { ...S6A_SCOPE }, input: { goalRef: goal, proposalRef } }),
      'decisions/candidate-card');
    expect(facts.diagnosis).toBeNull();
    expect(facts.exportRead).toEqual({ status: 'not_configured' });
    expect(facts.exactReview).toEqual({ status: 'ready', value: { status: 'not_sent' } });
  });
});

/**
 * A direct-read poll: the Host's consume pass may be held at the reviewer's
 * model request, so this advances the fake clock and reads the public route
 * without waiting on the consume barrier (which would be held too).
 */
async function waitDirect<T>(world: S6AHostWorld, read: () => Promise<T>,
  done: (value: T) => boolean, what: string, attempts = 120): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    world.clock.advance(25);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`PL-25: ${what} was not reached`);
}

describe('PL-25 candidate card review states', () => {
  it('reads waiting, decided and the pre-acceptance version through the public card path', async () => {
    const workflow = await openPLWorkflowWorld({ label: 'pl25-review' });
    workflows.push(workflow);
    const world = workflow.world;
    const goal = workflow.goal;
    const ws = workflow.main;
    const candidate = await seedCandidate(world, goal, {
      govern: false, label: 'pl25-review', workspace: ws,
    });
    world.platform.registerCheckConfiguration({
      configuration: ag2bChecksConfiguration({ actor: world.ag2b.actor, command: 'true' }),
    });
    const reviewer = await createPLReviewerLine(world, ws, 'pl25-reviewer');
    await world.scripted.script(reviewer, [{ kind: 'calls', calls: [{
      callId: 'pl25-review', name: 'submit_plan_review', args: { verdict: 'pass', findings: [] },
    }] }]);
    // Hold the reviewer's answer: the review Query is running, not decided.
    const hold = await world.gates.modelRequest(reviewer);
    await startGoalDriver(world, goal, 'pl25-review-driver');
    const head = systemRoundRequestId({ kind: 'planreview', goalRef: goal,
      proposalId: candidate.ref.proposalId, proposalRevision: candidate.revision });
    if (head.status !== 'ready') throw new Error(`PL-25: ${head.reason}`);
    const message = systemRoundMessageRef(S6A_SCOPE, head.value);
    if (message.status !== 'ready') throw new Error(`PL-25: ${message.reason}`);

    const running = await waitDirect(world, () => readPlanningQuery(world, message.value),
      query => query !== null && query.job.job.status === 'running', 'the running review Query');
    expect(running?.job.job.intent.execution).toMatchObject({ answerShape: 'plan_review' });

    const waiting = await world.platform.readCandidateCard(world.humanContext(),
      { goalRef: goal, proposalRef: candidate.ref });
    expect(waiting.status).toBe('ready');
    if (waiting.status !== 'ready') return;
    expect(waiting.value.card.source.kind).toBe('candidate');
    expect(waiting.value.diagnosis).toEqual([]);
    expect(waiting.value.exactReview).toEqual({ status: 'ready', value: { status: 'waiting' } });

    // Release the reviewer's real `pass`; the Query answers and the card reads
    // the decided verdict.
    hold.release();
    await waitDirect(world, () => readPlanningQuery(world, message.value),
      query => query?.job.job.status === 'answered', 'the answered review Query');
    const decided = await world.platform.readCandidateCard(world.humanContext(),
      { goalRef: goal, proposalRef: candidate.ref });
    expect(decided.status).toBe('ready');
    if (decided.status !== 'ready') return;
    expect(decided.value.exactReview).toEqual({ status: 'ready', value: {
      status: 'decided', verdict: 'pass', findings: [],
    } });

    // This world's autonomy lets the Goal loop adopt a passed candidate itself, so the row waits for that adoption
    // (a person's apply here raced the loop). The accepted record bumps its revision, so the card's review read is
    // the pre-acceptance version (`revision - 1`).
    const accepted = await waitDirect(world, async () =>
      ready<PlanProposalWithAdoption>(await ws.route('plans/proposal', candidate.ref), 'plans/proposal'),
    proposal => proposal.status === 'accepted', 'the accepted review candidate');
    expect(accepted.revision).toBe(candidate.revision + 1);
    expect(accepted.adoptedBy).toEqual(WORKFLOW_AUTOMATION_ACTOR);
    const after = await world.platform.readCandidateCard(world.humanContext(),
      { goalRef: goal, proposalRef: candidate.ref });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') return;
    expect(after.value.card.state).toBe('closed');
    expect(after.value.exactReview).toEqual({ status: 'ready', value: {
      status: 'decided', verdict: 'pass', findings: [],
    } });
  });

  it('reads terminal_invalid when the review Query answer is not a review', async () => {
    const workflow = await openPLWorkflowWorld({ label: 'pl25-invalid' });
    workflows.push(workflow);
    const world = workflow.world;
    const goal = workflow.goal;
    const ws = workflow.main;
    const candidate = await seedCandidate(world, goal, {
      govern: false, label: 'pl25-invalid', workspace: ws,
    });
    world.platform.registerCheckConfiguration({
      configuration: ag2bChecksConfiguration({ actor: world.ag2b.actor, command: 'true' }),
    });
    const reviewer = await createPLReviewerLine(world, ws, 'pl25-invalid-reviewer');
    // A plain text reply is not the `submit_plan_review` answer: the strict
    // parser refuses it, which is the fourth state, not `not_sent`.
    await world.scripted.script(reviewer, [{ kind: 'text', text: 'not a plan review' }]);
    await startGoalDriver(world, goal, 'pl25-invalid-driver');
    const head = systemRoundRequestId({ kind: 'planreview', goalRef: goal,
      proposalId: candidate.ref.proposalId, proposalRevision: candidate.revision });
    if (head.status !== 'ready') throw new Error(`PL-25: ${head.reason}`);
    const message = systemRoundMessageRef(S6A_SCOPE, head.value);
    if (message.status !== 'ready') throw new Error(`PL-25: ${message.reason}`);
    await waitDirect(world, () => readPlanningQuery(world, message.value),
      query => query?.job.job.status === 'answered', 'the invalid review Query');

    const facts = await world.platform.readCandidateCard(world.humanContext(),
      { goalRef: goal, proposalRef: candidate.ref });
    expect(facts.status).toBe('ready');
    if (facts.status !== 'ready') return;
    expect(facts.value.card.source.kind).toBe('candidate');
    expect(facts.value.diagnosis).toEqual([]);
    expect(facts.value.exactReview).toEqual({ status: 'ready', value: {
      status: 'terminal_invalid', reason: 'the plan review answer is not one JSON object',
    } });
    // The card's proposal ref still applies: the person can adopt it.
    committed(await ws.post('plans/apply', graphWrite(ws.scope, {
      proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [],
    }, 'pl25-invalid-apply')), 'the invalid-review candidate adoption');
    // PL-22: the adoption notice writes the exact fourth state, never `审阅 pass`.
    const notices = ready<{ notices: Array<{ itemKey?: string; summary?: string }> }>(await world.post('main/read', {
      scope: { ...S6A_SCOPE }, input: { goalId: goal.goalId, cursor: null },
    }), 'main/read');
    const adoption = notices.notices.find(notice => notice.itemKey
      === `plan-adoption:${candidate.draft.planId}:${String(candidate.draft.planRevision)}`);
    expect(adoption?.summary).toContain('审阅结论无效：the plan review answer is not one JSON object');
    expect(adoption?.summary).not.toContain('审阅 pass');
  }, 120_000);
});
