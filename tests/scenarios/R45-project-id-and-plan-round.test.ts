/**
 * 本包（决定 121-149，冻结稿七 T5、T6、T7）：别的项目的号被拒时，原文写出调用方自己的项目号；改需求的规划轮在任务段开头
 * 列出目标现行的计划。只走公开路由和真实 Host，memory（RULES S3）。
 *
 * 今天三行都红：T5 的 reason 少了“; this project is ag2b-collab-project”，T6 的 reason 仍是“the Goal node is outside the
 * requested goal”，T7 的规划轮输入只有“## This round”、没有 `plan:` 摘要。改坏：T5 拒绝原文不带项目号或 mailbox-send 不传
 * 项目号；T6 原文不写项目号或照旧说 outside the requested goal；T7 规划轮不列现行计划，或秘书的每一轮都列。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { adoptPLPlanDraft, plToolPlanOf } from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { initializeProject, newRequest, secretaryAnswer, submitRound, threeIdeas, waitForRound } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { openS7AWorkSetup } from '../helpers/S7A-fixture.js';
import { waitFor } from './harness.js';
import { workTask } from './support/plan.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

async function s7aWorld() {
  const setup = await openS7AWorkSetup({ backend: 'memory' });
  worlds.push(setup.world);
  return setup;
}

describe('rejects: a cross-project id names the caller project', () => {
  it('messages/send to another project names this project, and the inbox does not grow', async () => {
    const { world, goal, line } = await s7aWorld();
    const inbox = async (): Promise<unknown[]> => ((await world.post('messages/inbox',
      plain(S6A_SCOPE, { recipient: line.ref, page: { limit: 20 } }))).body as { value: { items: unknown[] } }).value.items;
    const before = await inbox();
    const answer = await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: { projectId: 'r45-other-project', sessionId: line.ref.sessionId },
      text: 'R45 cross-project message', needsReply: false, wake: false, goalRef: goal,
    }, 'r45-t5-send'));
    expect(answer.body).toMatchObject({ status: 'rejected', code: 'forbidden',
      reason: 'the recipient Session belongs to another project; this project is ag2b-collab-project' });
    expect(await inbox()).toEqual(before);
  }, 120_000);

  it('graph/look of another project\'s Goal node names this project', async () => {
    const { world, goal } = await s7aWorld();
    const result = await world.dispatch('graph/look', world.humanContext(), plain(S6A_SCOPE, {
      goalRef: goal, target: { kind: 'node', node: { kind: 'goal', ref: { aggregateType: 'Goal',
        projectId: 'r45-other-project', goalId: goal.goalId } } }, relation: 'card', page: { afterCursor: null, limit: 20 },
    }));
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden',
      reason: 'the goal node belongs to another project; this project is ag2b-collab-project' });
  }, 120_000);
});

/** The plan v1 of Goal 1: one work Task and the Goal gate, no stage. */
const BASE_PLAN: PlanRevisionDraft = {
  schemaVersion: 2, planId: 'r45-t7-plan', planRevision: 1, goalId: S6A_GOAL_1.goalId, stages: [],
  tasks: [workTask('r45-t7-work', 'R45 T7 work'), { taskId: 'r45-t7-gate', title: 'R45 T7 goal gate',
    requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
  assignments: [{ taskId: 'r45-t7-work', role: S6A_WORK_ROLE.templateId, instruction: 'R45 T7 work' }],
  obligations: [{ obligationId: 'r45-t7-obligation', title: 'R45 T7 acceptance', requirementLevel: 'required',
    taskIds: ['r45-t7-work', 'r45-t7-gate'], verificationRequirements: [{ requirementId: 'r45-t7-check',
      requirementLevel: 'required', kind: 'static', description: 'R45 T7 check' }] }],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
};

/** The system prompt and the round's own input (the last user message) of `request`. */
const inputText = (request: ModelRequest): string => {
  const shown = request as unknown as { systemPrompt?: string; messages: { role: string; content?: unknown }[] };
  const round = shown.messages.filter(message => message.role === 'user').at(-1)?.content;
  return `${shown.systemPrompt ?? ''}\n${typeof round === 'string' ? round : JSON.stringify(round ?? '')}`;
};

describe('a plan round that changes the request lists the active plan', () => {
  it('the plan round input starts the task section with the active plan; the ideas round does not', async () => {
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
    worlds.push(world);
    await initializeProject(world);
    const plan = await adoptPLPlanDraft(s6aCardsWorkspace(world, S6A_SCOPE), S6A_GOAL_1, BASE_PLAN, 'r45-t7');
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [
      { kind: 'text', text: secretaryAnswer({ body: 'R45 T7 ideas', ideas: threeIdeas('r45-t7') }) },
      { kind: 'calls', calls: [{ callId: 'r45-t7-plan', name: 'submit_plan_round', args: { answerKind: 'plan',
        summary: 'R45 T7 plan', plan: plToolPlanOf(BASE_PLAN) } }] },
    ]);
    const first = await submitRound(world, newRequest('r45-t7-request', a, 'R45 T7 change the request'));
    await waitForRound(world, first.requestRoot, first.round, 'ended');
    const selected = await world.selectIdea({ commandId: 'r45-t7-select', round: first.round, index: 1 });
    if (selected.status !== 'queued') throw new Error(`R45 T7: the selection was refused: ${JSON.stringify(selected)}`);
    const requests = await waitFor(async () => await world.scripted.requests(a), list => list.length >= 2, 'the plan round request');
    expect(inputText(requests[1]!)).toContain(`## Accepted task\nplan: ${plan.planId}@1\nstages: (none)\ntasks: R45 T7 work `
      + '(r45-t7-work), R45 T7 goal gate (r45-t7-gate)\n\n## This round');
    expect(inputText(requests[0]!)).not.toContain(`\nplan: ${plan.planId}@1\n`);
  }, 180_000);
});
