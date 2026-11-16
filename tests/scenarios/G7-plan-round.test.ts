/**
 * G7P (decision 121-133, `g7-rulings.md` "测试行" P2a, P2b, P4). World: the S6C request-candidate world (S6A Host with
 * its request driver, initialized project, `S6C-request-candidate.test.ts:83-89`); scripted secretary; public routes;
 * memory only (S3). A refused call's output is read off the next model request (CPL's way).
 * - P2a (E08): Goal 1 has plan v1; a request is answered with a `submit_plan_round` segment that keeps
 *   `g7-base-obligation`'s id and changes its requirement. P2b (E12): the G6F G3 flow
 *   (`G6F-new-goal-plan-round.test.ts:29-62`); the new Goal's first plan round submits a plan without the goal gate.
 *   Both red today at `expect(refused?.status).toBe('rejected')`: the plan-round form checks only the format
 *   (`answer-tools.ts:601-616`), adoption refuses later (`plan-validation.ts:577-579`; `incomplete`). Green when the
 *   form judges the merged plan with the adoption checks; the fixed answer ends the round (P2b: and is adopted).
 *   Mutation: the plan-round form checks only the format (today's code). Reason: product rule 97-3.
 * - P4 (补充裁定二): a `requests/ask` (`regenerate: false`) about the candidate offers `submit_secretary_answer` beside
 *   `submit_plan_round`; a scripted `submit_secretary_answer` call is the round's saved answer (`requests/read`), the
 *   request candidate stays as it was, and the input says to answer such a question in text. Red today at the tool list: that round is frozen as a plan round with only
 *   `submit_plan_round` (`answer-tools.ts:100`). Green when the ask round offers both (`answer-tools.ts:98`) and the
 *   template carries the sentence. Mutation: the ask round keeps only `submit_plan_round` (today's code).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { adoptPLPlanDraft, plToolPlanOf } from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import {
  answeredRound, initializeProject, newRequest, secretaryAnswer, submitRound, threeIdeas, waitForRound,
} from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { firstPlan } from '../helpers/S7B-V-fixture.js';
import { toolOutputJson } from './support/common.js';
import { workTask } from './support/plan.js';
import { waitFor } from './harness.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

type Refusal = { status: string; problems: { section: string; reason: string }[] };

async function openWorld(): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  await initializeProject(world);
  return world;
}
const planCall = (callId: string, plan: object) => ({ kind: 'calls' as const, calls: [{ callId,
  name: 'submit_plan_round', args: { answerKind: 'plan', summary: `${callId} summary`, plan } }] });
/** The output the model was served for `callId`; undefined when the call ended the round. */
async function outputOf(world: S6AHostWorld, session: S6ASession, callId: string): Promise<Refusal | undefined> {
  const served = (await world.scripted.requests(session)).find(request =>
    request.messages.some(entry => entry.role === 'tool' && entry.callId === callId));
  return toolOutputJson(served, callId) as Refusal | undefined;
}
const obligation = (obligationId: string, taskIds: string[], requirementId: string, description: string) => ({
  obligationId, title: `${obligationId} delivery`, requirementLevel: 'required' as const, taskIds,
  verificationRequirements: [{ requirementId, requirementLevel: 'required' as const, kind: 'static', description }] });
const candidateOf = (world: S6AHostWorld, goalRef: GoalRef, requestRef: QueryJobRef) =>
  waitFor(async () => ready<{ head: PlanProposal | null }>(await world.post('plans/request-candidate',
    plain(S6A_SCOPE, { goalRef, requestRef })), 'plans/request-candidate'), value => value.head !== null, 'a candidate');

/** Plan v1 of Goal 1: one work Task and the Goal gate under `g7-base-obligation`. */
const BASE_PLAN: PlanRevisionDraft = {
  schemaVersion: 2, planId: 'g7-base-plan', planRevision: 1, goalId: S6A_GOAL_1.goalId, stages: [],
  tasks: [workTask('g7-base-work', 'G7 base work'), { taskId: 'g7-base-gate', title: 'G7 Goal gate',
    requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
  assignments: [{ taskId: 'g7-base-work', role: S6A_WORK_ROLE.templateId, instruction: 'G7 base work' }],
  obligations: [obligation('g7-base-obligation', ['g7-base-work', 'g7-base-gate'], 'g7-base-check', 'G7 base check')],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
};
/** A segment: the new work Task `g7-users` and the obligations given. */
const usersSegment = (obligations: PlanRevisionDraft['obligations']) => plToolPlanOf({ ...BASE_PLAN,
  tasks: [workTask('g7-users', 'G7 users list')], obligations,
  assignments: [{ taskId: 'g7-users', role: S6A_WORK_ROLE.templateId, instruction: 'G7 users list' }] });

describe('G7P P2: a plan_round answer is judged with the adoption rules at the form', () => {
  it('P2a: a segment changing g7-base-obligation\'s requirement under its old id is refused; a new id ends the round', async () => {
    const world = await openWorld();
    await adoptPLPlanDraft(s6aCardsWorkspace(world, S6A_SCOPE), S6A_GOAL_1, BASE_PLAN, 'g7-p2a');
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [planCall('g7-p2a-first', usersSegment([obligation('g7-base-obligation',
      ['g7-base-work', 'g7-base-gate', 'g7-users'], 'g7-base-check', 'G7 base check, now with the users list')])),
    planCall('g7-p2a-fixed', usersSegment([obligation('g7-users-obligation', ['g7-users'], 'g7-users-check', 'G7 users')]))]);
    const request = await submitRound(world, newRequest('g7-p2a-request', a, '验收也要检查用户列表'));
    await waitForRound(world, request.requestRoot, request.round, 'ended');
    const refused = await outputOf(world, a, 'g7-p2a-first');
    expect(refused?.status, 'the first submit was accepted').toBe('rejected');
    const named = refused!.problems.find(problem => problem.reason.includes('g7-base-obligation'));
    expect(named?.reason, JSON.stringify(refused!.problems)).toMatch(/\bnew\b[^.]*\b(id|obligationId)\b/i);
    expect(await outputOf(world, a, 'g7-p2a-fixed')).toBeUndefined();
  }, 180_000);

  it('P2b: the new Goal\'s first plan round without the goal gate is refused; the plan with it is adopted', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    const first = await answeredRound(world, { session: a, answer: secretaryAnswer({ body: 'G7 P2b ideas',
      ideas: threeIdeas('g7-p2b'), goalCardDrafts: [{ objective: 'G7 P2b new Goal', completion: ['G7 P2b done'],
        autonomy: 'after_plan_confirmation', screening: null }] }),
    submit: { commandId: 'g7-p2b-request', goalId: null, text: 'G7 P2b new work', continues: null, recipient: a } });
    const card = (await world.readRequest(first.requestRoot)).rounds
      .find(round => round.ref.queryJobId === first.round.queryJobId)!.goalCardDrafts[0]!;
    const goal = committed<GoalConfirmDraftReceiptV1>(await world.post('goals/confirm-draft', plain(S6A_SCOPE, {
      commandId: 'g7-p2b-confirm', round: first.round, index: card.index })), 'the card').goal.ref;
    const plan = (JSON.parse(firstPlan({ label: 'g7-p2b', taskId: 'g7-p2b-work', role: S6A_WORK_ROLE.templateId })) as
      { plan: PlanRevisionDraft }).plan;
    await world.scripted.script(a, [planCall('g7-p2b-first', plToolPlanOf({ ...plan,
      tasks: plan.tasks.filter(task => task.taskKind !== 'gate'),
      obligations: plan.obligations.map(entry => ({ ...entry, taskIds: ['g7-p2b-work'] })) })),
    planCall('g7-p2b-fixed', plToolPlanOf(plan))]);
    const selected = await world.selectIdea({ commandId: 'g7-p2b-select', round: first.round, index: 0 });
    if (selected.status !== 'queued') throw new Error(`P2b: the selection was refused: ${JSON.stringify(selected)}`);
    await waitForRound(world, first.requestRoot, selected.followupRound, 'ended');
    const refused = await outputOf(world, a, 'g7-p2b-first');
    expect(refused?.status, 'the first submit was accepted').toBe('rejected');
    expect(refused!.problems.some(problem => /goal/i.test(problem.reason) && /gate/i.test(problem.reason)),
      JSON.stringify(refused!.problems)).toBe(true);
    const head = (await candidateOf(world, goal, first.requestRoot)).head!;
    const goalRead = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, goal)), 'goal');
    expect((await world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: head.ref,
      expectedProposalRevision: head.revision, decisionRefs: [] }, 'g7-p2b-apply',
    [{ ref: goal, revision: goalRead.goal.revision }]))).body).toMatchObject({ status: 'committed', value: { planRevision: 1 } });
  }, 180_000);
});

/** The system prompt and the round's own input (the last user message) of `request`. */
const inputText = (request: ModelRequest): string => {
  const shown = request as unknown as { systemPrompt?: string; messages: { role: string; content?: unknown }[] };
  const round = shown.messages.filter(message => message.role === 'user').at(-1)?.content;
  return `${shown.systemPrompt ?? ''}\n${typeof round === 'string' ? round : JSON.stringify(round ?? '')}`;
};
/** 补充裁定二 P4's sentence by its parts on one line: a question about the candidate, a text answer, a plan only on a change. */
const answersInText = (text: string): boolean => text.split('\n').some(line => /candidate/i.test(line)
  && /\b(asks?|question)/i.test(line) && /\btext\b|submit_secretary_answer/i.test(line)
  && /\bplan\b|submit_plan_round/i.test(line) && /\b(not|never|no|only)\b/i.test(line));

describe('G7P P4: a question about a candidate is answered in text', () => {
  it('P4: the ask round offers the text answer, says when to use it, and a text answer keeps the candidate', async () => {
    const world = await openWorld();
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [{ kind: 'text', text: secretaryAnswer({ body: 'g7-p4 ideas',
      ideas: threeIdeas('g7-p4') }) }, planCall('g7-p4-plan', plToolPlanOf(BASE_PLAN))]);
    const first = await submitRound(world, newRequest('g7-p4-request', a, 'g7-p4 question'));
    await waitForRound(world, first.requestRoot, first.round, 'ended');
    const selected = await world.selectIdea({ commandId: 'g7-p4-select', round: first.round, index: 1 });
    if (selected.status !== 'queued') throw new Error(`P4: the selection was refused: ${JSON.stringify(selected)}`);
    const head = (await candidateOf(world, S6A_GOAL_1, first.requestRoot)).head!;
    await world.scripted.script(a, [{ kind: 'calls', calls: [{ callId: 'g7-p4-text', name: 'submit_secretary_answer',
      args: { body: 'g7-p4 because', ideas: [] } }] }]);
    const asked = (await world.post('requests/ask', plain(S6A_SCOPE, { commandId: 'g7-p4-ask',
      round: selected.followupRound, cardRefs: [{ ref: head.ref, revision: head.revision }],
      regenerate: false, text: '为什么先做这一步？' }))).body as { status: string; followupRound: QueryJobRef };
    expect(asked.status).toBe('queued');
    const view = await waitFor(async () => ready<{ rounds: { ref: QueryJobRef; status: string; answer: string | null }[] }>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: first.requestRoot })), 'requests/read'),
    read => !['queued', 'running'].includes(read.rounds.find(round =>
      round.ref.queryJobId === asked.followupRound.queryJobId)?.status ?? 'queued'), 'the ask round to finish');
    const served = (await world.scripted.requests(a)).at(-1)!;
    expect(served.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['submit_secretary_answer', 'submit_plan_round']));
    expect(view.rounds.find(round => round.ref.queryJobId === asked.followupRound.queryJobId))
      .toMatchObject({ status: 'ended', answer: 'g7-p4 because' });
    const after = (await candidateOf(world, S6A_GOAL_1, first.requestRoot)).head!;
    expect({ ref: after.ref, revision: after.revision }).toEqual({ ref: head.ref, revision: head.revision });
    expect(inputText(served)).toContain('为什么先做这一步？');
    expect(answersInText(inputText(served))).toBe(true);
  }, 180_000);
});
