/**
 * INT L8（决定 121-111：只读不护着什么就不拒）：项目级的秘书轮能只读本工作区目标的图。
 *
 * 一条不挂目标的请求出目标卡，`goals/confirm-draft` 确认成新目标 G2。同一请求的下一轮秘书轮里，请求冻结的目标
 * （`effectiveGoalId`）是 G2，图工具按它读；这一轮自己的 QueryJob 照提交时没有目标。秘书脚本调 `look_graph` 读 G2
 * 的目标节点卡，回 ready。
 *
 * 世界：S6A Host 世界（只跑 memory，请求驱动开，秘书授权 `read`/`look_graph`/`find_graph`），`initializeProject`。
 * 具名改坏：`graph-context-reader.ts` 去掉请求轮没有目标时的放行，这一行的工具结果是
 * `forbidden: the QueryJob does not belong to the requested Goal`，`ready` 那句红（起点 `a5a1b9df` 就是这样）。
 */
import { afterEach, expect, it } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  answeredRound, followUp, initializeProject, secretaryAnswer, submitRound, threeIdeas, waitForRound,
} from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed } from '../helpers/S7A-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/** The result the platform returned to the model for `callId`, as the secretary's next model request carries it. */
function toolResultOf(requests: readonly ModelRequest[], callId: string): unknown {
  for (const request of requests) {
    const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
    if (message !== undefined && message.role === 'tool') return message.result;
  }
  return null;
}

it('INT-L8 the next secretary round of a confirmed Goal card reads the new Goal\'s card through look_graph', async () => {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' },
    secretaryTools: ['read', 'look_graph', 'find_graph'] });
  worlds.push(world);
  await initializeProject(world);
  const secretary = await world.createSecretary('a');
  const first = await answeredRound(world, { session: secretary, answer: secretaryAnswer({ body: 'INT L8 ideas',
    ideas: threeIdeas('int-l8'), goalCardDrafts: [{ objective: 'INT L8 new Goal', completion: ['INT L8 done'],
      autonomy: 'after_plan_confirmation', screening: null }] }),
  submit: { commandId: 'int-l8-request', goalId: null, text: 'INT L8 new work', continues: null, recipient: secretary } });
  const answered = (await world.readRequest(first.requestRoot)).rounds
    .find(round => round.ref.queryJobId === first.round.queryJobId);
  expect(answered).toMatchObject({ goalCardDrafts: [expect.anything()] });
  const g2 = committed<GoalConfirmDraftReceiptV1>(await world.post('goals/confirm-draft', plain(S6A_SCOPE, {
    commandId: 'int-l8-confirm', round: first.round, index: answered!.goalCardDrafts[0]!.index })), 'the card').goal.ref;

  await world.scripted.script(secretary, [
    { kind: 'calls', calls: [{ callId: 'int-l8-look', name: 'look_graph',
      args: { mode: 'node', target: { kind: 'goal', ref: g2 }, relation: 'card' } }] },
    { kind: 'text', text: secretaryAnswer({ body: 'INT L8 look answer' }) },
  ]);
  const next = await submitRound(world, followUp('int-l8-next', first.requestRoot, 'INT L8 看看新目标'));
  const view = await waitForRound(world, first.requestRoot, next.round, 'ended');
  // The premise: the request now names G2, while this round's own QueryJob still has no Goal.
  expect(view.effectiveGoalId).toBe(g2.goalId);
  const job = (await world.post('queries/read', plain(S6A_SCOPE, next.round))).body as ReadResult<QueryJobRecord>;
  expect(job.status === 'ready' ? job.value.job.job.goalId : job).toBeNull();

  const result = toolResultOf(await world.scripted.requests(secretary), 'int-l8-look') as
    { output: readonly { kind: string; value?: unknown }[] } | null;
  expect(result).not.toBeNull();
  const read = result!.output.find(block => block.kind === 'json')?.value as { status?: string } | undefined;
  expect(read?.status, JSON.stringify(result)).toBe('ready');
}, 180_000);
