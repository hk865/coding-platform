/**
 * FLK 返工 2（返工裁定 `flk-rework-rulings.md` 第 2 条；Astra 审查 `flkcr.out.md` 第 6 行）：启动对账第 6c 步只补写
 * 缺的请求候选；秘书小改动的采用、请批、跑改动前的事实交回正常驱动，`resumeOnStartup='off'` 时等下一次有效唤醒。
 *
 * 世界：G8B 秘书小改动的世界（`tests/helpers/G8B-world.ts`：第二个工作区能写能跑命令，参谋线是目标的负责参谋，人采用的
 * 底计划 v1，计划确认后自动；秘书在自己的请求轮里只加 `<tag>-work`，带一条新检查）。只走公开路由。
 *
 * 造“候选已在、批准轮没发出”：Host 自己的计划轮写候选的那次提交落库后扣住回执（RULES A3 闸门，`holdAfter`），Host
 * 就停在候选写完、请批之前；人把 `resumeOnStartup` 存成 off，Host 在那里崩溃（S6A 的 `crash()`，所以开 SQLite，S3 的
 * “崩溃再打开”）。没用“轮结束时每步确认、之后改回自动”的造法：每步确认下秘书轮根本不给 `submit_plan_round`
 * （`S6C-request-candidate.test.ts` 的 SEC-3），写不出候选。
 *
 * 检查命令每跑一次在工作区 `.cache/` 下的文件里加一个记号（同 VD10 的 `.cache/vd10-first-runs`），然后在改动前失败
 * （`flk-r2.txt` 不存在，退出码 1），所以请批会走到跑改动前的事实那一步（G8B B1b 第 5 步）。
 * 期望值（手算）：
 * - 崩溃前记号 0 次；新 Host 启动返回时（启动对账做完）仍是 0 次，参谋收件箱没有 `checkreview:`；
 * - off 下第一条请求命令（`requests/submit`）唤醒以后，新 Host 自己对原来那一轮的计划轮入口返回 done 时：记号 1 次，
 *   参谋收到一条 `checkreview:<候选号>:1`，改动前的事实是 failed、退出码 1（后续交回正常驱动，没有丢）。
 * 在 7f16f333（没改）上红在启动以后那一处：启动对账已经跑了一次检查命令、发出了批准轮。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanRoundEndResultV1, PlanTurnFactsV1 } from '../../src/business/workflow/ports.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { g8Check, g8PlanCall, g8PlanForm } from '../helpers/G8-world.js';
import { G8B_ROLE, G8B_TEMPLATE, g8bCheckReview, g8bSubjectOf, openG8BWorld } from '../helpers/G8B-world.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { waitFor } from './harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const cleanup: (() => Promise<void>)[] = [];
// The crashed Host's candidate receipt stays held; the reset lets it go before the world closes.
afterEach(async () => { commitBarrier.reset(); await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });

const TAG = 'flk-r2';
const CHECK_RUNS = '.cache/flk-r2-check-runs';
const CHECK_COMMAND = 'node -e "const fs=require(\'node:fs\');fs.mkdirSync(\'.cache\',{recursive:true});'
  + `fs.appendFileSync('${CHECK_RUNS}','x');process.exit(fs.existsSync('flk-r2.txt')?0:1)"`;
type PlanTurnEntry = (ctx: CoreCallContext, turn: PlanTurnFactsV1) => Promise<PlanRoundEndResultV1>;

it('R2: with resumeOnStartup off, the start-up reconcile runs no check command for a candidate whose approval round '
  + 'was not sent; the first request command hands it back and the check approval goes on', async () => {
  const w = await openG8BWorld(TAG, 'sqlite');
  cleanup.push(w.close);
  const root = (await w.steps.settingsEntry()).root;
  /** How many times the check command really ran in the workspace (one mark per run). */
  const checkRuns = (): number => {
    const marks = join(root, CHECK_RUNS);
    return existsSync(marks) ? readFileSync(marks, 'utf8').length : 0;
  };
  const adviser = await w.line(`${TAG}-adviser`, G8B_TEMPLATE.adviser);
  const secretary = await w.line(`${TAG}-secretary`, G8B_TEMPLATE.secretary);
  const goal = await w.goal(TAG, 'FLK 返工 2 秘书的小改动', { adviser, base: true });
  const check = g8Check(`${TAG}-check`, [`${TAG}-work`], CHECK_COMMAND);
  await w.world.scripted.script(secretary, [g8PlanCall(`${TAG}-plan`, g8PlanForm(TAG, G8B_ROLE, [check], true))], w.scope);
  // The base plan is already adopted, so the next plan proposal commit is the round's candidate.
  const written = commitBarrier.holdAfter(commit => commit.records.some(record => record.schemaId === 'PlanProposal@2'),
    `${TAG} candidate written`);
  const asked = await w.steps.ask(TAG, secretary, goal);
  await written.reached;
  const head = await w.steps.candidate(goal, asked.requestRoot);
  expect(checkRuns(), 'the check command ran before the crash').toBe(0);
  expect(await w.rounds(adviser, 'checkreview:'), 'the approval round was sent before the crash').toEqual([]);

  // The person saves the Host's resume off; the Host goes down after the candidate write.
  await w.world.setResumeOnStartup(false);
  await w.world.crash();
  // The new Host serves the second workspace, with its command grant.
  expect((await w.steps.settingsEntry()).commandsAllowed, 'the new Host lost the second workspace').toBe(true);
  expect(checkRuns(), 'the start-up reconcile ran the check command').toBe(0);
  expect(await w.rounds(adviser, 'checkreview:'), 'the start-up reconcile sent the approval round').toEqual([]);

  // The first request command wakes the workspace; the new Host's own plan turn of that round goes on from there.
  const workflow = w.world.platform.workflow as unknown as { proposeFromPlanTurn: PlanTurnEntry };
  const turns = new Map<string, PlanRoundEndResultV1>();
  const realTurn = workflow.proposeFromPlanTurn;
  const turnSpy = vi.spyOn(workflow, 'proposeFromPlanTurn').mockImplementation(async (ctx, turn) => {
    const result = await realTurn.call(workflow, ctx, turn);
    turns.set(turn.ref.queryJobId, result);
    return result;
  });
  cleanup.push(async () => { turnSpy.mockRestore(); });
  // The adviser's answer to the approval round (as G8B D2's); the row ends once the round is sent.
  await w.world.scripted.script(adviser, [g8bCheckReview(`${TAG}-to-person`,
    [{ checkId: check.checkId, decision: 'to_person', reason: '交人看' }])], w.scope);
  await w.world.scripted.script(secretary, [{ kind: 'text', text: secretaryAnswer({ body: `${TAG} wake` }) }], w.scope);
  await w.steps.ask(`${TAG}-wake`, secretary);
  expect(await waitFor(async () => turns.get(asked.round.queryJobId), result => result !== undefined,
    `${TAG}: the new Host's own plan turn of ${asked.round.queryJobId} after the wake`)).toEqual({ status: 'done' });
  expect(checkRuns(), 'the check approval did not run the baseline once').toBe(1);
  const sent = await w.rounds(adviser, 'checkreview:');
  expect(sent.map(round => round.text.split('\n')[0]), 'the adviser got no checkreview: round')
    .toEqual([`checkreview:${head.ref.proposalId}:1`]);
  expect(g8bSubjectOf(sent[0]!.text)).toMatchObject({ proposalRef: head.ref, proposalRevision: 1,
    baselines: [{ checkId: check.checkId, outcome: 'failed', exitCode: 1 }] });
}, 240_000);
