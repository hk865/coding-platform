/**
 * 6C S1 (book §2.1, `7d2-drill-rulings.md` binding): the plan round a request runs after a person selects
 * an idea becomes that request's candidate.
 *
 * The world is the frozen 6A request world with its real Host and request-round driver. Every step is a public
 * one: `requests/submit`, `requests/select-idea`, the Host's own round-end + lifecycle traversal, and
 * `plans/request-candidate` / `plans/proposal` / `decisions/candidate-card`. The secretary round is the real
 * `submit_plan_round` tool call, scripted, never a second answer writer.
 *
 * Expected values come from the frozen 6C book §1.1, §1.3, §1.7.2 and the S1 rows of §2.1; nothing is read from
 * the store.
 */
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { QueryJobAnswerRef, QueryJobRef } from '../../src/contracts/query-job.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { PlanProposal, PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { planProposalIdFor } from '../../src/core/work-graph/tasks/plan-service.js';
import { graphWrite, permissionRevision, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  followUp, initializeProject, newRequest, secretaryAnswer, submitRound, threeIdeas, waitForRound,
} from '../helpers/S6A-history-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, OPERATOR, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { committedValue } from '../helpers/S6A-memory-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { ready, sessionOf } from '../helpers/S7A-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

// ---------------------------------------------------------------------------
// The 6C S1 shapes (book §1.1): the new entry's result and its one input.
// ---------------------------------------------------------------------------

type PlanTurnFactsV1 = {
  ref: QueryJobRef;
  answerRef: QueryJobAnswerRef;
  requestRoot: QueryJobRef;
  goalId: string;
};
type PlanRoundEndResultV1 =
  | { status: 'done' }
  | { status: 'skipped'; reason: string; transient: boolean }
  | { status: 'failed'; reason: string; transient: boolean };
type PlanTurnEntry = (ctx: CoreCallContext, turn: PlanTurnFactsV1) => Promise<PlanRoundEndResultV1>;

/** The 6C read value: the old three fields plus §1.7.2's `previous` and §1.6's `impact`. */
type CandidateRead = {
  head: PlanProposal | null;
  status: 'candidate' | 'stale' | 'closed' | null;
  closedReason: 'goal_cancelled' | null;
  impact: { marks: unknown[] };
  previous: { proposalRef: PlanProposalRef; revision: number } | null;
};

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

async function openWorld(extraHostOptions: Record<string, unknown> = {}): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend: 'memory',
    extraHostOptions: { requestDriver: 'on', ...extraHostOptions } });
  worlds.push(world);
  await initializeProject(world);
  return world;
}

const candidateOf = async (world: S6AHostWorld, requestRoot: QueryJobRef): Promise<CandidateRead> =>
  ready<CandidateRead>(await world.post('plans/request-candidate', plain(S6A_SCOPE, {
    goalRef: S6A_GOAL_1, requestRef: requestRoot,
  })), 'plans/request-candidate');

/** The lifecycle creates the candidate after the round ends; bounded polling is the public wait. */
const waitForCandidate = async (world: S6AHostWorld, requestRoot: QueryJobRef): Promise<CandidateRead> =>
  await waitFor(async () => await candidateOf(world, requestRoot),
    value => value.head !== null, `the request ${requestRoot.queryJobId} to get a candidate`);

/** The follow-up the selection queued, from the public receipt. */
function followupOf(result: Awaited<ReturnType<S6AHostWorld['selectIdea']>>): QueryJobRef {
  if (result.status !== 'queued') throw new Error(`the selection was refused: ${JSON.stringify(result)}`);
  return result.followupRound;
}

/** The round reaches a terminal public status; a failed attempt is still a terminal for this wait. */
async function waitForTerminal(world: S6AHostWorld, requestRoot: QueryJobRef, round: QueryJobRef): Promise<void> {
  await waitFor(async () => await world.readRequest(requestRoot),
    view => {
      const entry = view.rounds.find(candidate => candidate.ref.queryJobId === round.queryJobId);
      return entry !== undefined && entry.status !== 'queued' && entry.status !== 'running';
    }, `the round ${round.queryJobId} to reach a terminal status`);
}

// The one plan body this file submits through the real `submit_plan_round` tool.
type PlanForm = {
  stages: unknown[];
  tasks: Record<string, unknown>[];
  assignments: { taskId: string; role: string; instruction: string }[];
  obligations: Record<string, unknown>[];
  taskHierarchy: { parentOf: unknown[] };
  executionDag: { dependsOn: unknown[] };
  taskRelations: unknown[];
  inputRequirements: unknown[];
};

/** A complete v2 plan: one required work Task and the required goal gate carry one acceptance obligation. */
function planForm(tag: string, instruction: string): PlanForm {
  const work = `${tag}-work`;
  const gate = `${tag}-gate`;
  return {
    stages: [],
    tasks: [
      { taskId: work, title: `${tag} work`, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
        scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: gate, title: `${tag} goal gate`, requirementLevel: 'required', taskKind: 'gate', disposition: 'active',
        scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: work, role: S6A_WORK_ROLE.templateId, instruction }],
    obligations: [{
      obligationId: `${tag}-obligation`, title: `${tag} delivery`, requirementLevel: 'required',
      taskIds: [work, gate],
      verificationRequirements: [{ requirementId: `${tag}-check`, requirementLevel: 'required', kind: 'static',
        description: `${tag} static check` }],
    }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
    taskRelations: [],
    inputRequirements: [],
  };
}

/** The scripted model reply that calls the real plan-round tool with one plan. */
function planCall(callId: string, summary: string, plan: PlanForm, reason?: Record<string, unknown>) {
  return { kind: 'calls' as const, calls: [{ callId, name: 'submit_plan_round', args: {
    answerKind: 'plan', summary, plan, ...(reason === undefined ? {} : { reason }),
  } }] };
}

/** One request with three ideas and the selection of idea 1 that queues its follow-up. */
async function requestedWithSelection(world: S6AHostWorld, session: S6ASession, tag: string) {
  const ideas = threeIdeas(tag);
  await world.scripted.script(session, [
    { kind: 'text', text: secretaryAnswer({ body: `${tag} ideas`, ideas }) },
    planCall(`${tag}-plan`, `${tag} summary`, planForm(tag, `${tag} instruction`)),
  ]);
  const first = await submitRound(world, newRequest(`${tag}-request`, session, `${tag} question`));
  await waitForRound(world, first.requestRoot, first.round, 'ended');
  const selected = await world.selectIdea({ commandId: `${tag}-select`, round: first.round, index: 1 });
  const followup = followupOf(selected);
  await waitForTerminal(world, first.requestRoot, followup);
  return { first, followup, ideas };
}

/** The same request's first version, then "change it" as its second version. */
async function secondVersion(world: S6AHostWorld, session: S6ASession, tag: string) {
  const { first } = await requestedWithSelection(world, session, tag);
  const firstRead = await waitForCandidate(world, first.requestRoot);
  const firstCandidate = firstRead.head!;
  await world.scripted.script(session, [planCall(`${tag}-plan-2`, `${tag} summary 2`,
    planForm(`${tag}-b`, `${tag} instruction 2`))]);
  const second = await submitRound(world, followUp(`${tag}-again`, first.requestRoot, '改一下'));
  await waitForTerminal(world, first.requestRoot, second.round);
  const secondRead = await waitFor(async () => await candidateOf(world, first.requestRoot),
    value => value.head !== null && value.head.ref.proposalId !== firstCandidate.ref.proposalId,
    'the second candidate of the request');
  return { first, firstRead, firstCandidate, second, secondRead, secondCandidate: secondRead.head! };
}

/** `queries/read` of one round: the public Job snapshot the round-end entry consumes. */
async function jobOf(world: S6AHostWorld, round: QueryJobRef): Promise<QueryJobRecord> {
  return ready<QueryJobRecord>(await world.post('queries/read', plain(S6A_SCOPE, round)), 'queries/read');
}

/** The turn facts the Host hands the entry: this round, its last answer, its root and the Goal id. */
function turnOf(job: QueryJobRecord, requestRoot: QueryJobRef): PlanTurnFactsV1 {
  const answerRef = job.job.job.answerRefs.at(-1);
  if (answerRef === undefined) throw new Error(`the round ${job.job.ref.queryJobId} has no answer`);
  return { ref: { ...job.job.ref }, answerRef: { ...answerRef }, requestRoot: { ...requestRoot },
    goalId: S6A_GOAL_1.goalId };
}

/** The published entry, if the platform has it (the S1 wiring). */
function planTurnEntry(world: S6AHostWorld): PlanTurnEntry | undefined {
  const workflow = world.platform.workflow as unknown as { proposeFromPlanTurn?: PlanTurnEntry };
  return workflow.proposeFromPlanTurn;
}

// ---------------------------------------------------------------------------

describe('S6C S1: a plan round becomes the request candidate', () => {
  it('S1-1: selecting idea 1 and answering the follow-up with `submit_plan_round` yields one candidate whose reason is the summary, the answer body and the model\'s task list', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    const { first, followup } = await requestedWithSelection(world, a, 's6c-s1');
    expect(planTurnEntry(world)).toBeTypeOf('function');
    const head = await waitForCandidate(world, first.requestRoot);
    expect(head.head).not.toBeNull();
    const candidate = head.head!;
    expect(candidate).toMatchObject({
      requestRef: first.requestRoot,
      basedOn: null,
      reason: { text: 's6c-s1 summary', sources: [expect.objectContaining({ digest: expect.any(String) })],
        affectedTaskIds: [] },
    });
    expect(candidate.reason.sources).toHaveLength(1);
    expect(head).toMatchObject({ status: 'candidate', closedReason: null, previous: null });
    // The candidate card is readable through the real candidate-card read.
    const card = await world.post('decisions/candidate-card', plain(S6A_SCOPE, {
      goalRef: S6A_GOAL_1, proposalRef: candidate.ref,
    }));
    expect(card.body).toMatchObject({ status: 'ready' });
    // The round's own answer is the plan round's: it carries the tool's one form, not a secretary answer.
    expect(head.head!.draft.origin?.source).toMatchObject({ kind: 'request_followup' });
    expect(followup.queryJobId).not.toBe(first.round.queryJobId);
  }, 120_000);

  it('S1-2: the entry replayed on the same answer reads the same proposal and writes no second candidate', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    const { first, followup } = await requestedWithSelection(world, a, 's6c-s1-replay');
    const entry = planTurnEntry(world);
    expect(entry).toBeTypeOf('function');
    const turn = turnOf(await jobOf(world, followup), first.requestRoot);
    expect(await entry!.call(world.platform.workflow, world.humanContext(), turn)).toMatchObject({ status: 'done' });
    const before = await waitForCandidate(world, first.requestRoot);
    expect(await entry!.call(world.platform.workflow, world.humanContext(), turn)).toMatchObject({ status: 'done' });
    expect(await candidateOf(world, first.requestRoot)).toEqual(before);
    expect(before.previous).toBeNull();
  }, 120_000);

  it('S1-3: a second version replaces the first, keeps its own request-followup origin, and `previous` reloads the old draft; another request stays apart', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    expect(planTurnEntry(world)).toBeTypeOf('function');
    const { first, firstCandidate, secondRead, secondCandidate } = await secondVersion(world, a, 's6c-s1-two');
    expect(firstCandidate).not.toBeNull();
    expect(secondCandidate).toMatchObject({ requestRef: first.requestRoot, basedOn: null });
    expect(secondCandidate.draft.origin?.source).toMatchObject({ kind: 'request_followup' });
    expect(secondRead.previous).toEqual({ proposalRef: firstCandidate.ref, revision: 2 });
    const old = ready<PlanProposal>(await world.post('plans/proposal',
      plain(S6A_SCOPE, firstCandidate.ref)), 'plans/proposal of the replaced candidate');
    expect(old).toMatchObject({ ref: firstCandidate.ref, revision: 2, status: 'not_adopted',
      notAdopted: { replacedBy: secondCandidate.ref } });
    expect(old.draft.planId).toBe(firstCandidate.draft.planId);

    // A candidate of another request: the same Goal, another request root, a real plans/propose write.
    const b = await world.createSecretary('b');
    const other = await submitRound(world, newRequest('s6c-s1-other', b, 'another request'));
    const goal = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, S6A_GOAL_1)), 'goals/read');
    const otherForm = planForm('s6c-s1-other', 'other instruction');
    const otherProposal = await world.platform.plans.proposePlan(world.humanContext(), {
      input: { goalRef: S6A_GOAL_1, basedOn: null, draft: {
        ...otherForm, schemaVersion: 2, planId: 's6c-s1-other-plan', planRevision: 1,
        goalId: S6A_GOAL_1.goalId,
        tasks: otherForm.tasks.map(task => ({ ...task, phase: 'pending' })),
      } as never, requestRef: other.requestRoot, reason: { text: 'other request candidate', sources: [] } },
      meta: { requestId: 's6c-s1-other-propose',
        expected: [{ ref: S6A_GOAL_1, revision: goal.goal.revision }] },
    });
    if (otherProposal.status !== 'committed') throw new Error(`the other proposal failed: ${JSON.stringify(otherProposal)}`);
    const otherRead = await candidateOf(world, other.requestRoot);
    expect(otherRead.head?.ref).toEqual(otherProposal.value.ref);
    expect(otherRead.previous).toBeNull();
    // This request's head and predecessor do not mix in the other request's candidate.
    expect((await candidateOf(world, first.requestRoot)).head?.ref).toEqual(secondCandidate.ref);
  }, 180_000);

  it('S1-4: a non-follow-up, a follow-up with no Goal and a follow-up with no selected idea are skipped and write nothing', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    const { first, followup } = await requestedWithSelection(world, a, 's6c-s1-skip');
    const entry = planTurnEntry(world);
    expect(entry).toBeTypeOf('function');

    // The request round itself is not a follow-up.
    expect(await entry!.call(world.platform.workflow, world.humanContext(),
      turnOf(await jobOf(world, first.round), first.requestRoot))).toMatchObject({ status: 'skipped', reason: 'not_followup' });
    // A follow-up of a request with no selected idea is not a plan round.
    await world.scripted.script(a, [
      { kind: 'text', text: secretaryAnswer({ body: 's6c-s1-skip plain answer' }) },
      { kind: 'text', text: secretaryAnswer({ body: 's6c-s1-skip plain follow-up' }) },
    ]);
    const plainRequest = await submitRound(world, newRequest('s6c-s1-skip-plain-request', a, 'a request without ideas'));
    await waitForRound(world, plainRequest.requestRoot, plainRequest.round, 'ended');
    const plainFollow = await submitRound(world, followUp('s6c-s1-skip-again', plainRequest.requestRoot, '改一下'));
    await waitForTerminal(world, plainRequest.requestRoot, plainFollow.round);
    const skipped = await entry!.call(world.platform.workflow, world.humanContext(),
      turnOf(await jobOf(world, plainFollow.round), plainRequest.requestRoot));
    expect(skipped).toMatchObject({ status: 'skipped', reason: 'no_plan' });
    // No Goal: the same answered follow-up read with a null goal id.
    const noGoal = await entry!.call(world.platform.workflow, world.humanContext(), {
      ...turnOf(await jobOf(world, followup), first.requestRoot), goalId: null as unknown as string,
    });
    expect(noGoal).toMatchObject({ status: 'skipped', reason: 'no_goal' });
    expect(await candidateOf(world, plainRequest.requestRoot)).toMatchObject({ head: null, previous: null });
  }, 180_000);

  it('S1-5: the follow-up round carries `submit_plan_round` (256 KiB, `reason.objective`) and the accepted 17 KiB answer keeps the objective on the candidate', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    const ideaPrefix = 's6c-s1-tool';
    const ideas = threeIdeas(ideaPrefix);
    const instruction = `s6c-${'i'.repeat(17 * 1024)}`;
    await world.scripted.script(a, [
      { kind: 'text', text: secretaryAnswer({ body: `${ideaPrefix} ideas`, ideas }) },
      planCall(`${ideaPrefix}-plan`, `${ideaPrefix} summary`, planForm(ideaPrefix, instruction), {
        text: 'tool reason text', affectedTaskIds: [], objective: 'the new objective',
      }),
    ]);
    const first = await submitRound(world, newRequest(`${ideaPrefix}-request`, a, `${ideaPrefix} question`));
    await waitForRound(world, first.requestRoot, first.round, 'ended');
    const selected = await world.selectIdea({ commandId: `${ideaPrefix}-select`, round: first.round, index: 1 });
    const followup = followupOf(selected);
    await waitForTerminal(world, first.requestRoot, followup);

    const requests = await world.scripted.requests(a);
    const tools = requests[1]?.tools.map(tool => tool.name) ?? [];
    expect(tools).toContain('submit_plan_round');
    expect(tools).not.toContain('submit_secretary_answer');
    const planTool = requests[1]!.tools.find(tool => tool.name === 'submit_plan_round')!;
    expect(JSON.stringify(planTool.inputSchema)).toContain('objective');
    expect(planTurnEntry(world)).toBeTypeOf('function');

    const head = await waitForCandidate(world, first.requestRoot);
    expect((head.head!.reason as unknown as { objective?: string }).objective).toBe('the new objective');
    expect(head.head!.reason.text).toBe(`${ideaPrefix} summary`);
    expect(head.head!.draft.assignments?.find(entry => entry.taskId === `${ideaPrefix}-work`)?.instruction)
      .toHaveLength(instruction.length);
  }, 180_000);

  it('S1-6: the first version (basedOn null) is adopted by a person; the origin re-read succeeds and the request head becomes empty', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    const { first } = await requestedWithSelection(world, a, 's6c-s1-adopt');
    expect(planTurnEntry(world)).toBeTypeOf('function');
    const head = await waitForCandidate(world, first.requestRoot);
    const candidate = head.head!;
    expect(candidate.basedOn).toBeNull();
    expect(candidate.draft.origin?.source).toMatchObject({ kind: 'request_followup' });
    const goal = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, S6A_GOAL_1)), 'goals/read');
    const adopted = await world.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [],
    }, 's6c-s1-adopt-apply', [{ ref: S6A_GOAL_1, revision: goal.goal.revision }]));
    expect(adopted.body).toMatchObject({ status: 'committed', value: { planRevision: 1 } });
    expect(await candidateOf(world, first.requestRoot)).toMatchObject({
      head: null, status: 'closed', previous: null,
    });
  }, 180_000);

  it('S1-7: the selection round is not in the other-session `earlier` window, yet the next follow-up is still a plan round', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    expect(planTurnEntry(world)).toBeTypeOf('function');
    // The selection round ran on this request's owner itself, so the earlier window (rounds of another
    // Session) never names it. The next follow-up still has to be judged by the whole request read.
    const { firstRead, secondRead } = await secondVersion(world, a, 's6c-s1-earlier');
    expect(secondRead.previous).toMatchObject({ proposalRef: firstRead.head!.ref, revision: 2 });
    const requests = await world.scripted.requests(a);
    expect(requests.at(-1)?.tools.map(tool => tool.name)).toContain('submit_plan_round');
  }, 180_000);

  it('S1-8: retrying an earlier round after a later candidate commits is skipped as superseded_by_later_round and keeps the later head', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    const tag = 's6c-s1-retry';
    const ideas = threeIdeas(tag);
    await world.scripted.script(a, [
      { kind: 'text', text: secretaryAnswer({ body: `${tag} ideas`, ideas }) },
      planCall(`${tag}-plan`, `${tag} summary`, planForm(tag, `${tag} instruction`)),
    ]);
    const first = await submitRound(world, newRequest(`${tag}-request`, a, `${tag} question`));
    await waitForRound(world, first.requestRoot, first.round, 'ended');
    const selected = await world.selectIdea({ commandId: `${tag}-select`, round: first.round, index: 1 });
    const earlier = followupOf(selected);
    // A fails at its own proposal read, so the Host keeps it for a retry.
    const earlierProposalId = planProposalIdFor({ projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId,
      goalId: S6A_GOAL_1.goalId, requestId: `request-candidate:${earlier.queryJobId}` });
    const earlierKey = canonicalJson({ aggregateType: 'PlanProposal', projectId: S6A_SCOPE.projectId,
      workspaceId: S6A_SCOPE.workspaceId, proposalId: earlierProposalId } as never);
    const fault = commitBarrier.failReads(earlierKey, 'throw-always');
    try {
      await waitForTerminal(world, first.requestRoot, earlier);
      expect(await candidateOf(world, first.requestRoot)).toMatchObject({ head: null, previous: null });
      // B is a later round of the same request; its candidate becomes the head.
      await world.scripted.script(a, [planCall(`${tag}-plan-2`, `${tag} summary 2`, planForm(`${tag}-b`, `${tag} instruction 2`))]);
      const later = await submitRound(world, followUp(`${tag}-again`, first.requestRoot, '改一下'));
      await waitForTerminal(world, first.requestRoot, later.round);
      const laterHead = await waitForCandidate(world, first.requestRoot);
      expect(laterHead.head).not.toBeNull();
      expect(laterHead.previous).toBeNull();
      // Releasing A's fault lets the retry read the request head; it must not replace the later candidate.
      fault.release();
      const retry = await planTurnEntry(world)!.call(world.platform.workflow, world.humanContext(),
        turnOf(await jobOf(world, earlier), first.requestRoot));
      expect(retry).toEqual({ status: 'skipped', reason: 'superseded_by_later_round', transient: false });
      expect((await candidateOf(world, first.requestRoot)).head?.ref).toEqual(laterHead.head!.ref);
    } finally {
      fault.release();
    }
  }, 180_000);
});

// ---------------------------------------------------------------------------
// S7: the impact marks on the real request (lead T1: S7-1 moved here from the
// C7 world, which has no request; only the public `plans/request-candidate`
// read is used, never the `plan-impact` module)
// ---------------------------------------------------------------------------

const S7_O1 = 'a2-disposition-obligation';
const S7_R1 = 'a2-disposition-static';
const S7_O2 = 'a2-disposition-acceptance-2';
const S7_R2 = 'a2-disposition-static-2';
const S7_WORK_1 = 'work-1';
const S7_WORK_2 = 'work-2';
const S7_WORK_3 = 'work-3';
const S7_WORK_4 = 'work-4';
const S7_WORK_5 = 'work-5';
const S7_GATE = 'goal-gate';

type ImpactMark = {
  taskId: string;
  change: 'changed' | 'cancelled' | 'superseded';
  note: string;
  before: { task: Record<string, unknown>; assignment: unknown; inputRequirements: unknown[];
    carriedObligations: unknown[] };
  after: { task: Record<string, unknown>; assignment: unknown; inputRequirements: unknown[];
    carriedObligations: unknown[] };
  lines: { runRef: { runId: string }; sessionRef: { sessionId: string } | null }[];
  evidence: { evidenceId: string; obligationId: string; requirementId: string }[];
};
type TaskRowView = { ref: { taskId: string }; effectivePhase: string; execution: { runId: string } | null };

/** The book's P1: one required work Task per run, an unrelated optional one, and the goal gate under O1. */
function impactPlan(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 's6c-s7-impact-plan', planRevision: 1, goalId: S6A_GOAL_1.goalId, stages: [],
    tasks: [
      { taskId: S7_WORK_1, title: 'The ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: S7_WORK_2, title: 'The second work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: S7_WORK_3, title: 'The unrelated work', requirementLevel: 'optional', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' },
      { taskId: S7_GATE, title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [
      { taskId: S7_WORK_1, role: S6A_WORK_ROLE.templateId, instruction: 'Do the ordinary work' },
      { taskId: S7_WORK_2, role: S6A_WORK_ROLE.templateId, instruction: 'Do the second work' },
    ],
    obligations: [{ obligationId: S7_O1, title: 'Deliver the work', requirementLevel: 'required',
      taskIds: [S7_WORK_1, S7_WORK_2, S7_GATE],
      verificationRequirements: [{ requirementId: S7_R1, requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

/** The trusted static check the Host registers: `fixed.txt` exists in the verification workspace. */
function impactChecks(): TrustedCheckConfiguration {
  const actor = { kind: 'human' as const, id: OPERATOR.id };
  return {
    configurationRevision: 's6c-s7-checks@1',
    workspace: { aggregateType: 'Workspace', projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId },
    executor: { ...actor }, permissionRevision: permissionRevision(actor, S6A_SCOPE, ['.']),
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 's6c-s7-check', kind: 'static', command: 'test -f fixed.txt', cwd: '.',
      timeoutMs: 60_000, taskIds: 'all' }],
  };
}

/** `tasks/query`: the active Plan snapshot and its Task rows. */
async function taskGraphOf(world: S6AHostWorld): Promise<{ plan: PlanRevisionSnapshot; tasks: TaskRowView[] }> {
  return ready<{ plan: PlanRevisionSnapshot; tasks: TaskRowView[] }>(
    await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: S6A_GOAL_1 })), 'tasks/query');
}

async function goalRevisionOf(world: S6AHostWorld): Promise<number> {
  return (await ready<{ goal: { revision: number } }>(
    await world.post('goals/read', plain(S6A_SCOPE, S6A_GOAL_1)), 'goals/read')).goal.revision;
}

/**
 * Drive the real `workflow/advance` until its next request is another selection. `driveWorkflow`
 * (tests/helpers/A2-restart-fixture.ts:130) stops only at a named `perform`, so the one step this row needs —
 * stop after a completed Task and before the next selection — is written here, on the same public route.
 */
async function driveToNextSelection(world: S6AHostWorld, first: Record<string, unknown>): Promise<void> {
  let current: Record<string, unknown> = first;
  for (let guard = 0; guard < 32; guard += 1) {
    const answer = await world.post('workflow/advance', plain(S6A_SCOPE, current));
    const body = answer.body as { status: string; value?: { state: string; next: Record<string, unknown> | null }; reason?: string };
    if (body.status !== 'ready' || body.value === undefined) {
      throw new Error(`S7: the Workflow call was not ready: ${JSON.stringify(answer.body)}`);
    }
    const next = body.value.next;
    if (body.value.state === 'completed' || next === null || next.kind === 'select_work') return;
    current = next;
  }
  throw new Error('S7: the Workflow did not settle within the step guard');
}

describe('S6C S7: the request-candidate impact marks', () => {
  it('S7-1: before adoption, the P1 → P2 change marks work-1 and work-2 (superseded, full definitions, the running line and subject/coverage evidence) and nothing else', async () => {
    const world = await openWorld({ checks: impactChecks() });
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [{ kind: 'text', text: secretaryAnswer({ body: 's6c-s7 request answer' }) }]);
    const request = await submitRound(world, newRequest('s6c-s7-request', a, 's6c-s7 question'));
    await waitForRound(world, request.requestRoot, request.round, 'ended');

    // P1: a real proposal and adoption, no request candidate yet.
    const p1Proposal = committedValue<{ ref: PlanProposalRef; revision: number }>(
      (await world.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: S6A_GOAL_1, basedOn: null, draft: impactPlan(), reason: { text: 'S7 P1', sources: [] },
      }, 's6c-s7-propose-1', [{ ref: S6A_GOAL_1, revision: await goalRevisionOf(world) }]))).body, 'the P1 proposal');
    committedValue((await world.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: p1Proposal.ref, expectedProposalRevision: p1Proposal.revision, decisionRefs: [],
    }, 's6c-s7-apply-1', [{ ref: S6A_GOAL_1, revision: await goalRevisionOf(world) }]))).body, 'the P1 adoption');

    // The registered static check passes for work-1.
    await writeFile(join(world.root, 'fixed.txt'), '6C S7 acceptance\n');
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const line1 = await sessionOf(world, await createS6BLine(main, { label: 's6c-s7-line-1', role: S6A_WORK_ROLE,
      tasks: [{ projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId, taskId: S7_WORK_1 }] }));
    await world.scripted.script(line1, [{ kind: 'text', text: 'S7 first work answer' }]);
    await driveToNextSelection(world, { schemaVersion: 1, goalRef: S6A_GOAL_1, flowId: 's6c-s7-work-1',
      sessionHint: line1.ref, kind: 'select_work', taskId: S7_WORK_1 });
    expect((await taskGraphOf(world)).tasks.find(task => task.ref.taskId === S7_WORK_1))
      .toMatchObject({ effectivePhase: 'satisfied' });

    // work-2 starts and is held at its model call, so its Run stays `running` with a Session.
    const line2 = await sessionOf(world, await createS6BLine(main, { label: 's6c-s7-line-2', role: S6A_WORK_ROLE,
      tasks: [{ projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId, taskId: S7_WORK_2 }] }));
    await world.scripted.script(line2, [{ kind: 'text', text: 'S7 second work answer' }]);
    const hold = await world.gates.modelRequest(line2);
    const driving = driveToNextSelection(world, { schemaVersion: 1, goalRef: S6A_GOAL_1, flowId: 's6c-s7-work-2',
      sessionHint: line2.ref, kind: 'select_work', taskId: S7_WORK_2 });
    await hold.reached;
    const beforeP2 = await taskGraphOf(world);
    const work2Row = beforeP2.tasks.find(task => task.ref.taskId === S7_WORK_2)!;
    expect(work2Row.execution).not.toBeNull();

    // P2: the request's first candidate, based on the adopted P1.
    const draft = draftFrom(beforeP2.plan, 's6c-s7-impact-plan-2', current => ({
      ...current,
      tasks: [
        ...current.tasks.map(task => task.taskId === S7_WORK_1
          ? { ...task, disposition: 'superseded' as const, replacedByTaskId: S7_WORK_4 }
          : task.taskId === S7_WORK_2
            ? { ...task, disposition: 'superseded' as const, replacedByTaskId: S7_WORK_5 }
            : task),
        { taskId: S7_WORK_4, title: 'Do the new acceptance', requirementLevel: 'required' as const, taskKind: 'work' as const,
          disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const },
          executionIntent: 'request_execution' as const },
        { taskId: S7_WORK_5, title: 'Replace the second work', requirementLevel: 'required' as const, taskKind: 'work' as const,
          disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const },
          executionIntent: 'request_execution' as const },
      ],
      assignments: [...(current.assignments ?? []),
        { taskId: S7_WORK_4, role: S6A_WORK_ROLE.templateId, instruction: 'Do the new acceptance' },
        { taskId: S7_WORK_5, role: S6A_WORK_ROLE.templateId, instruction: 'Replace the second work' }],
      obligations: [
        ...current.obligations.map(obligation => obligation.obligationId === S7_O1
          ? { ...obligation, taskIds: [...obligation.taskIds, S7_WORK_4, S7_WORK_5] } : obligation),
        { obligationId: S7_O2, title: 'Deliver the new acceptance', requirementLevel: 'required' as const,
          taskIds: [S7_WORK_4],
          verificationRequirements: [{ requirementId: S7_R2, requirementLevel: 'required' as const, kind: 'static' as const,
            description: 'Registered static command check 2' }] },
      ],
    }));
    committedValue((await world.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: S6A_GOAL_1, basedOn: beforeP2.plan.ref, draft, requestRef: request.requestRoot,
      reason: { text: 'S7 P2', sources: [], affectedTaskIds: [S7_WORK_1, S7_WORK_2] },
    }, 's6c-s7-propose-2', [{ ref: S6A_GOAL_1, revision: await goalRevisionOf(world) }]))).body, 'the P2 proposal');

    // The public request-candidate read carries the impact; the module itself is never imported.
    const read = await candidateOf(world, request.requestRoot);
    expect(read).toMatchObject({ status: 'candidate', impact: { marks: expect.any(Array) } });
    const marks = (read.impact as { marks: ImpactMark[] }).marks;
    expect(marks.map(mark => mark.taskId).sort()).toEqual([S7_WORK_1, S7_WORK_2]);
    for (const mark of marks) {
      expect(mark).toMatchObject({ change: 'superseded', note: '有变化，要复查' });
      expect(mark).not.toHaveProperty('applicability');
      for (const side of [mark.before, mark.after]) {
        expect(side).toEqual(expect.objectContaining({
          task: expect.objectContaining({ taskId: mark.taskId }),
          assignment: expect.anything(),
          inputRequirements: expect.any(Array),
          carriedObligations: expect.any(Array),
        }));
      }
    }
    const work1 = marks.find(mark => mark.taskId === S7_WORK_1)!;
    expect(work1.before.task).toMatchObject({ disposition: 'active' });
    expect(work1.after.task).toMatchObject({ disposition: 'superseded', replacedByTaskId: S7_WORK_4 });
    expect(work1.after.carriedObligations).toEqual(work1.before.carriedObligations);
    expect(work1.lines).toEqual([]);
    expect(work1.evidence).toEqual(expect.arrayContaining([expect.objectContaining({
      evidenceId: expect.any(String), obligationId: S7_O1, requirementId: S7_R1,
    })]));

    const work2 = marks.find(mark => mark.taskId === S7_WORK_2)!;
    expect(work2.after.task).toMatchObject({ disposition: 'superseded', replacedByTaskId: S7_WORK_5 });
    const line = work2.lines.find(entry => entry.runRef.runId === work2Row.execution!.runId);
    expect(line).toBeDefined();
    expect(line!.sessionRef?.sessionId).toEqual(line2.ref.sessionId);

    hold.release();
    await driving;
  }, 240_000);
});
