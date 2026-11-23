/**
 * G8B-1a 写测试方（决定 121-136、121-138；冻结裁定 `g8b-rulings.md` 的 B1，测试行 D1、D2、D3、D10；lead 11-17 晚的
 * 补充裁定 ②③）。
 * 世界：`G8B-world.ts`（G8A C4 的第二个工作区，能写能跑命令，K2M 模型；秘书线、参谋线都是这个工作区 Host 内置档案的
 * 线，参谋线经 `goals/adviser-queue/assign` 成为目标的负责参谋）。目标有人采用的底计划 v1；秘书在自己的请求轮里交一个
 * 小改动（`g8PlanCall`，只加一个任务 `<tag>-work`），带一条新检查。等 Host 自己的计划轮入口返回（完成屏障，同 C4），
 * 之后只经公开读看结果；参谋的回答是脚本线写的。都是业务行，按 RULES S3 只跑内存（lead 补充裁定 ②）。
 *
 * 期望值的依据（都是裁定原文或手算）：B1a 作者是秘书 → 批准者是目标的参谋线；B1b 请批的顺序（新检查 → `taskIds` 为
 * "all" 交人 → 选批准者 → 改动前的事实 → 发 `checkreview:<proposalId>:<rev>`，第二行 `subject:`）；B1c 只有"跑完、
 * 非零退出码"算失败：`test -f g8b-<行>.txt` 在文件不存在时退出码 1，`true` 退出码 0；B1d 回答表单 `verdicts`；B1e 全部
 * approve → 平台采用，有一条 to_person → 交人；B1f 记录 `checkApprovals[]` 的字段；B1g 请知悉的文字（照模板手写，
 * 目标取 `objective`，这里不到 30 个字）；"all" 交人那一行的文字是 lead 补充裁定 ③ 给的。候选是秘书这一轮的第一份，
 * 版本 1，题头和请知悉的 `objects` 都钉在版本 1（补充裁定 ④）。
 *
 * 今天（起点 212b00cd，包还没落地）红在哪、包落地后为什么绿：
 * - D1、D2 红在"参谋收到 `checkreview:`"那一步。今天 `adoptSmall`（`request-candidate.ts:73-97`）直接以平台身份
 *   采用，被采用 owner 拒（`plan-service.ts:1658-1672`：只有人批新检查），计划轮返回 `done`，没有批准轮。包落地后
 *   B1b 在 `adoptSmall` 里先请批：改动前跑出退出码 1，发给参谋；D1 参谋 approve，B1e 以平台身份采用，B1f 由 Host
 *   查到批准、装上检查、记下 agent 批准，B1g 写 `check_approved` 那一行；D2 参谋 to_person，B1e 不采用，写
 *   `check_to_person` 那一行，候选留给人。
 * - D3、D10 今天"不发 `checkreview:`、计划停在 v1、检查没装、候选卡列出检查"已经成立（同样是 owner 拒），红在请知悉：
 *   今天没有这一行。包落地后 D3 由 B1c 跑出退出码 0、D10 由 B1b 第 2 步交人，各写一行请知悉。
 * 守的改坏（裁定"抓的改坏"一栏）：D1 `adoptSmall` 照 G8A 出卡 / 批准轮发给作者 / 装上了但没记批准者；D2 to_person 也
 * 采用 / 不告诉人；D3 不跑改动前的事实，或跑通了也送去批；D10 "all" 检查也由 agent 批。这些改坏要等包落地才有地方改；
 * 今天的树上演示过它们共同守的那一道：临时把 `plan-service.ts:1664` 改成只拦人的采用（平台带着没装的检查也能采用），
 * D3、D10 都红在"the plan moved without the person"（计划到了 v2），恢复后 `git diff -- src` 为空。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { g8Check, g8PlanCall, g8PlanForm, type G8Check } from '../helpers/G8-world.js';
import {
  expectB15, G8B_ROLE, G8B_TEMPLATE, g8bCheckReview, g8bSubjectOf, openG8BWorld, p0History,
  P0_REVIEWER_TOOLS, p0ToolNames, P2_REVIEW_ROUND_TOOLS,
} from '../helpers/G8B-world.js';
import { adviserToolResult } from '../helpers/K3L3-adviser-world.js';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });

const OBJECTIVE = 'G8B 秘书的小改动';

/**
 * 目标有参谋线、有底计划 v1；秘书交一个小改动（只加 `<tag>-work`），带 `check`。返回 Host 自己的计划轮入口返回之后
 * 的世界、两条线、目标、这份候选，以及行开始前这个目标已有的请知悉。
 */
async function secretaryChange(tag: string, check: G8Check, adviserReplies: S6AReply[], historyCallId?: string) {
  const w = await openG8BWorld(tag);
  cleanup.push(w.close);
  const adviser = await w.line(`${tag}-adviser`, G8B_TEMPLATE.adviser);
  const secretary = await w.line(`${tag}-secretary`, G8B_TEMPLATE.secretary);
  const goal = await w.goal(tag, OBJECTIVE, { adviser, base: true });
  const before = await w.noticeKeys(goal);
  if (adviserReplies.length > 0 || historyCallId !== undefined) await w.world.scripted.script(adviser, [
    ...(historyCallId === undefined ? [] : [{ kind: 'calls' as const, calls: [p0History(historyCallId, goal)] }]),
    ...adviserReplies], w.scope);
  const adviserRequests = (await w.world.scripted.requests(adviser, w.scope)).length;
  await w.world.scripted.script(secretary, [g8PlanCall(`${tag}-plan`, g8PlanForm(tag, G8B_ROLE, [check], true))],
    w.scope);
  const asked = await w.steps.ask(tag, secretary, goal);
  expect(await w.turnEnded(asked.round), 'the Host\'s own plan turn').toEqual({ status: 'done' });
  /** 这一份请求候选（`plans/request-candidate` 的 head）；采用以后 head 就不在了，所以要用的行在采用之前读。 */
  const head = () => w.steps.candidate(goal, asked.requestRoot);
  /** 等人回答的这一份候选卡（G8A 的 `proposedChecks`）。 */
  const card = async () => JSON.stringify((await w.steps.read<DecisionQueueReadV1>('decisions/queue', {
    workspace: w.scope, goalRef: goal, sections: ['waiting_answer'], page: { limit: 100 } })).waitingAnswer
    .find(item => item.source.kind === 'candidate' && item.requestRef?.queryJobId === asked.requestRoot.queryJobId) ?? null);
  return { w, adviser, secretary, goal, head, before, card, adviserRequests };
}
type Change = Awaited<ReturnType<typeof secretaryChange>>;

/** 没有装上 `checkId`，计划停在 v1，候选卡列出这条检查（G8A C4 的同一组事实）。 */
async function leftToPerson(r: Change, check: G8Check) {
  expect(await r.w.planRevision(r.goal), 'the plan moved without the person').toBe(1);
  expect(JSON.stringify(await r.w.steps.settingsEntry()), 'the check was installed').not.toContain(check.checkId);
  const card = await r.card();
  for (const fact of [check.checkId, check.command, ...(check.taskIds === 'all' ? [] : check.taskIds)]) {
    expect(card, `the candidate card lists ${fact}`).toContain(fact);
  }
}

describe('G8B-1a: a secretary\'s small change brings a new check; the adviser approves it', () => {
  it('D1: the adviser gets checkreview:, approves; the plan is adopted, the check installed with the agent approval, '
    + 'one notice', async () => {
    const check = g8Check('g8b-d1-check', ['g8b-d1-work'], 'test -f g8b-d1.txt');
    const r = await secretaryChange('g8b-d1', check, [g8bCheckReview('g8b-d1-approve',
      [{ checkId: 'g8b-d1-check', decision: 'approve', reason: '改动前确实失败，查的正是新任务' }])],
    'g8b-d1-approval-history');
    const head = await r.head();
    // ① 批准轮发给目标的参谋线，作者（秘书线）没收到；第二行是平台写的事实。
    const sent = await r.w.roundsAfter(r.adviser, 'checkreview:');
    expect(sent.map(round => round.text.split('\n')[0]), 'D1: the adviser got no checkreview: round')
      .toEqual([`checkreview:${head.ref.proposalId}:1`]);
    expect(await r.w.rounds(r.secretary, 'checkreview:'), 'D1: the author got the approval round').toEqual([]);
    expect(g8bSubjectOf(sent[0]!.text)).toMatchObject({ proposalRef: head.ref, proposalRevision: 1,
      goalRef: r.goal, authorDuty: 'secretary', approverDuty: 'adviser',
      baselines: [{ checkId: 'g8b-d1-check', outcome: 'failed', exitCode: 1 }] });
    // ② 参谋答完、平台收尾：计划到 v2，检查装上，记下是参谋（agent）批的、秘书写的、改动前失败的事实。
    expect((await r.w.settled(sent[0]!.message.ref)).response, 'D1: the round was not replied').not.toBeNull();
    const history = await adviserToolResult({ world: r.w.world, adviser: r.adviser }, 'g8b-d1-approval-history',
      r.adviser, r.w.scope);
    expectB15(history, 'D1: the check review');
    // 批检查轮参谋和审阅者同一范围（S7；设计 §6 第 610 行，`p2-frozen.md:224`）：P0 的读名单加任、发、撤、告。
    expect([...(await p0ToolNames(r.w, r.adviser, r.adviserRequests))].sort(), 'D1: the check review tool list')
      .toEqual([...P0_REVIEWER_TOOLS, ...P2_REVIEW_ROUND_TOOLS, 'submit_check_review'].sort());
    expect(await r.w.planRevision(r.goal)).toBe(2);
    const entry = await r.w.steps.settingsEntry();
    expect(entry.checks?.find(item => item.checkId === 'g8b-d1-check')).toMatchObject(check);
    expect(entry.checkApprovals?.find(item => item.checkId === 'g8b-d1-check'), JSON.stringify(entry.checkApprovals))
      .toMatchObject({ plan: { proposalRef: head.ref },
        approvedBy: { kind: 'agent', duty: 'adviser', session: r.adviser.ref }, author: { duty: 'secretary' },
        baseline: { checkId: 'g8b-d1-check', outcome: 'failed', exitCode: 1 } });
    // ③ 主对话里正好一行请知悉，指向这份候选。
    const notices = await r.w.newNotices(r.goal, r.before);
    expect(notices.map(item => item.summary)).toEqual([
      `来自 秘书 · 目标 ${OBJECTIVE}：加了检查「g8b-d1-check」，改动前跑会失败（已核实），参谋已批，已生效`]);
    expect(notices[0]).toMatchObject({ noticeKind: 'check_approved',
      objects: [{ kind: 'aggregate', pin: { ref: head.ref, revision: 1 }, label: 'candidate' }] });
  }, 180_000);

  it('D2: the adviser answers to_person; the plan stays v1, nothing installed, the person is told why', async () => {
    const check = g8Check('g8b-d2-check', ['g8b-d2-work'], 'test -f g8b-d2.txt');
    const r = await secretaryChange('g8b-d2', check, [g8bCheckReview('g8b-d2-to-person',
      [{ checkId: 'g8b-d2-check', decision: 'to_person', reason: '要联网才能跑' }])]);
    const head = await r.head();
    const sent = await r.w.roundsAfter(r.adviser, 'checkreview:');
    expect(sent.map(round => round.text.split('\n')[0]), 'D2: the adviser got no checkreview: round')
      .toEqual([`checkreview:${head.ref.proposalId}:1`]);
    expect((await r.w.settled(sent[0]!.message.ref)).response, 'D2: the round was not replied').not.toBeNull();
    await leftToPerson(r, check);
    const notices = await r.w.newNotices(r.goal, r.before);
    expect(notices.map(item => item.summary)).toEqual([
      `来自 秘书 · 目标 ${OBJECTIVE}：参谋没批检查「g8b-d2-check」（要联网才能跑），这份计划交你决定`]);
    expect(notices[0]).toMatchObject({ noticeKind: 'check_to_person' });
  }, 180_000);

  // 请批在 Host 的计划轮入口里做完（B1b）：入口返回时参谋线上没有批准轮，就是没发。
  it.each([
    { row: 'D3', why: 'the check already passes before the change', check: g8Check('g8b-d3-check', ['g8b-d3-work'], 'true'),
      notice: `来自 秘书 · 目标 ${OBJECTIVE}：检查「g8b-d3-check」改动前跑就通过了，查不出这次的改动，交你决定` },
    { row: 'D10', why: 'the check is for every Task of the workspace (Q3)',
      check: g8Check('g8b-d10-check', 'all', 'test -f g8b-d10.txt'),
      notice: `来自 秘书 · 目标 ${OBJECTIVE}：检查「g8b-d10-check」适用于整个工作区（taskIds: all），会影响其他目标，交你决定` },
  ])('$row: $why: no checkreview:, the person decides and is told why', async ({ row, check, notice }) => {
    const r = await secretaryChange(`g8b-${row.toLowerCase()}`, check, []);
    expect(await r.w.rounds(r.adviser, 'checkreview:'), `${row}: the check was sent for approval`).toEqual([]);
    await leftToPerson(r, check);
    const notices = await r.w.newNotices(r.goal, r.before);
    expect(notices.map(item => item.summary)).toEqual([notice]);
    expect(notices[0]).toMatchObject({ noticeKind: 'check_to_person' });
  }, 180_000);
});
