/**
 * G6R2 T1（R2 冻结稿第三节；121-111、121-141；只跑内存）。G8A 的 `openG8Project` 初始化装两条已批准检查 `g6r2-ok`（`true`）
 * 和 `g6r2-bad`（`false`），都查 `"all"`；目标照 `g8NewGoal` 建，人采用的计划不带检查。执行者两段文字什么都不改，两次 Run 后
 * 返工的键相同，停在 `no_new_basis`（E05 的 t-users，598 → 706）。种子目标的关口也会被坏检查判 FAIL，所以卡按 Task 过滤。
 * (a) 这张 `goal_cause` 卡点名 `['g6r2-bad']`；(b) `checks/withdraw` 回 `ready`，清单只剩 `g6r2-ok`，留痕带 `seedAnswer`、
 * 没有 `plan`；(c) 人对链头轮 `verification/reverify`（pin 取 Task 行 `failure.round`），后继轮 `PASS`、没有 `g6r2-bad`。
 * Host 的提醒周期调成 25 毫秒，`heartbeat` 一趟就是一轮消费，(a)(c) 的等待都有趟数上界。
 * 这一行守什么改坏：停止卡不给 `withdrawableChecks`（a 红）；已批准清单照旧拒（b 红）；撤回没推给 Host（c 后继轮跑了坏检查，FAIL）。
 */
import { afterEach, expect, it } from 'vitest';
import { LOCAL_WORKBENCH_ROLE } from '../../src/app/runtime-configuration.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { TaskRow } from '../../src/contracts/task-graph.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ReverifyOutcomeV1 } from '../../src/core/work-graph/model/evidence-contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { g8Check, g8NewGoal, g8PlanCall, g8PlanForm, openG8Project } from '../helpers/G8-world.js';
import { G8B_ROLE } from '../helpers/G8B-world.js';
import { heartbeatUntil } from '../helpers/IV-host-fixture.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });

const TASK = 'g6r2-work';
/** (a)(c) 等待的上界按时间给：心跳屏障不分工作区（`IV-host-fixture.ts:76`），底座工作区的空趟也算一趟，目标工作区有任务在跑时
 *  那一趟会被跳过。Host 每轮至少真实睡一个 25 毫秒周期（`host.ts:4060`），600 趟约 15 秒；条件一满足就提前结束，平时不变慢。 */
const PASSES = 600;
/** 卡来源键里的原因码（PL-38 的 `parsedCode` 同形）。 */
const parsedCode = (card: DecisionCardV1): unknown => {
  try { return (JSON.parse(card.source.key) as { code?: unknown }).code; } catch { return undefined; }
};
const stopCardOf = (queue: DecisionQueueReadV1) => queue.waitingAnswer.find(card => card.source.kind === 'goal_cause'
  && parsedCode(card) === 'no_new_basis' && card.taskRef?.taskId === TASK);

it('T1: the approved list\'s failing check is named on the stop card; the person withdraws it and re-verifies', async () => {
  const project = await openG8Project('g6r2', [g8Check('g6r2-ok', 'all'), g8Check('g6r2-bad', 'all', 'false')], 25);
  cleanup.push(project.close);
  const flow = await g8NewGoal(project, 'g6r2', [g8PlanCall('g6r2-plan', g8PlanForm('g6r2', G8B_ROLE))]);
  const head = await project.candidate(flow.goal, flow.requestRoot);
  expect(await project.apply(flow.goal, head, 'g6r2-apply')).toMatchObject({ status: 'committed' });
  const executor = await project.line('g6r2-executor', LOCAL_WORKBENCH_ROLE);
  await project.world.scripted.script(executor, [{ kind: 'text', text: 'G6R2 T1 第一次，什么都不改' },
    { kind: 'text', text: 'G6R2 T1 第二次，还是什么都不改' }], project.scope);
  await project.read('workflow/driver-start', { advance: { schemaVersion: 1, goalRef: flow.goal,
    flowId: 'g6r2-driver', sessionHint: null, kind: 'select_work', taskId: TASK }, queryProfileIds: [] });

  const readStopQueue = () => project.read<DecisionQueueReadV1>('decisions/queue', { workspace: project.scope,
    goalRef: flow.goal, sections: ['waiting_answer'], page: { limit: 100 } });
  const stopCard = stopCardOf(await heartbeatUntil(project.world, readStopQueue, queue => stopCardOf(queue) !== undefined, PASSES));
  expect(stopCard, 'T1(a): no no_new_basis goal_cause card for g6r2-work').toBeDefined();
  expect(stopCard!.withdrawableChecks, 'T1(a): the card names the failing approved check').toEqual(['g6r2-bad']);

  const withdrawn = await project.world.settings('checks/withdraw', { scope: project.scope, checkId: 'g6r2-bad' });
  expect(withdrawn.status, JSON.stringify(withdrawn)).toBe('ready');
  const entry = await project.settingsEntry();
  expect(entry.checks?.map(item => item.checkId), 'T1(b): the approved list keeps the other check').toEqual(['g6r2-ok']);
  expect(entry.withdrawnChecks, 'T1(b): one trace, the seed answer only (no plan, no digest)')
    .toEqual([{ checkId: 'g6r2-bad', withdrawnAt: expect.any(String), answerRef: project.seedAnswer }]);

  const pin = (await project.read<{ tasks: TaskRow[] }>('tasks/query', { goalRef: flow.goal })).tasks
    .find(candidate => candidate.ref.taskId === TASK)?.failure?.round ?? null;
  expect(pin, 'T1(c): the Task row carries failure.round').not.toBeNull();
  const body = (await project.world.post('verification/reverify', graphWrite(project.scope,
    { predecessorRoundRef: pin!.roundRef }, 'g6r2-reverify', [{ ref: pin!.roundRef, revision: pin!.revision }])))
    .body as WriteResult<ReverifyOutcomeV1>;
  expect(body.status, 'T1(c): the person\'s re-verify is a committed write').toBe('committed');
  if (body.status !== 'committed' || body.value.kind !== 'reverified') {
    throw new Error(`T1(c): the re-verify was not accepted: ${JSON.stringify(body)}`);
  }
  const successor = body.value.round.ref;
  const done = await heartbeatUntil(project.world, () => project.read<RoundSnapshot>('verification/round',
    { roundRef: successor }), round => round.status === 'finalized', PASSES);
  expect(done.outcome, 'T1(c): the successor round').toBe('PASS');
  expect(done.checks.map(check => check.checkId)).not.toContain('g6r2-bad');
}, 300_000);
