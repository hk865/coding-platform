/**
 * G8B-1a 写测试方（决定 121-136、121-138；冻结裁定 `g8b-rulings.md` 的 B1，测试行 D4、D7；lead 11-17 晚的补充裁定
 * ①② 加了 D4b，全部只跑内存）。
 * 世界：`G8B-world.ts`（G8A C4 的第二个工作区，能写能跑命令，K2M 模型；参谋、审阅者、执行者都是这个工作区 Host 内置
 * 档案的线，参谋线经 `goals/adviser-queue/assign` 成为目标的负责参谋，审阅者是项目里唯一的审阅线）。档位都是
 * "方案确认后自动"。模型的回答是脚本线写的；只经公开路由和公开读。都是业务行，按 RULES S3 只跑内存。
 *
 * - D4、D4b（一张表）：PL 的目标循环。人采用一份只有目标级 `plan_only` 占位任务 `g8b-d4-work` 的计划 v1
 *   （D4 带一条种子检查，D4b 不带，见 `adoptPlaceholder`），目标推进发 `refine:` 给参谋（`sendRoundOf`，XWR 的步骤），参谋的
 *   细化带检查 `g8b-d4-check`（`test -f g8b-d4.txt`），成了候选 P。目标推进发 `planreview:` 给审阅者，审阅者 pass；
 *   下一步按 B1b 由审阅者批这条检查（作者是参谋 → 批准者是审阅线，B1a），审阅者 approve，B1e 以平台身份采用，B1f 装上
 *   并记下 agent 批准，B1g 写一行请知悉。
 *   期望值：B1a 的表、B1c（退出码 1 算失败）、B1f 记录的字段、B1g 的文字（照模板手写）。P 是参谋这一轮的第一份候选，
 *   版本 1；采用后计划从 v1 到 v2。
 *   今天红在"目标发出批准轮"那一步：今天 pass 之后 PL 直接采用（`workflow.ts:2980-2996`），被采用 owner 拒
 *   （`plan-service.ts:1658-1672`），目标等在 `adoption_rejected` 上，`sendRoundOf` 发不出系统轮（调试时读到的原因是
 *   `adoption_rejected: forbidden: the candidate brings checks that are not installed yet (…)`）。包落地后 PL 的采用分支先
 *   请批（B1b 的 `send` → `send_system_round`），`sendRoundOf` 发出的就是给审阅者的 `checkreview:`。
 *   D4b 今天红在同一步，原因不同：工作区一条检查都没装，PL 的机械诊断读不到覆盖（`decision-read-model.ts:2463-2465`，
 *   已装检查读成 `null`，`create-platform.ts:1895-1901`），pass 之后目标等在 `plan_candidate_waiting: diagnosis`，
 *   连采用都不试。lead 补充裁定 ①：覆盖 = 已装的检查 + 计划自带的检查，没配置时已装的按空清单算；修好后 D4b 和 D4 走
 *   同一条路，绿。
 *   守的改坏：参谋的计划由参谋自己批（参谋收到 `checkreview:`）；PL 不等批准就采用（审阅者收不到 `checkreview:`）；
 *   D4b 另守"没配置时覆盖读成读不到"。
 * - D7：人发消息给目标所在工作区的执行者线，执行者的干预规划带新检查
 *   `g8b-d7-check`，档位自动，走到干预第 11 阶段。作者是执行者，不在 B1a 的表里，交人（Q4 交人）：不发
 *   `checkreview:`（目标有参谋线，所以送去批就会发给它），计划停在 v1，检查没装，候选卡照 G8A 列出检查，不出请知悉
 *   （B1g 最后一条：作者不在批准表里时不出请知悉）。完成屏障：Host 自己对这条消息的干预入口返回 `awaiting_decision`。
 *   今天绿（守护行）：第 11 阶段的采用被 owner 拒，回 `awaiting_decision`（`intervention.ts:656-659`）。包落地后
 *   B1b 选批准者时交人，同样回 `awaiting_decision`。
 *   守的改坏：表外的作者也送去批（要等包落地才有地方改）。今天的树上演示过它守的那一道：临时把 `plan-service.ts:1664`
 *   改成只拦人的采用，第 11 阶段就采用了，D7 红在 "stage 11 did not leave it to the person"；恢复后
 *   `git diff -- src` 为空。
 * P0 守护行的演示（冻结补裁第 3 条）：在共用的读名单 `src/app/host.ts:464` 临时加 `query_task_graph`。审阅者名单
 * 的期望是 15 个读名再加提交工具（16 个），实测变成 16 个读名再加提交工具（17 个）；D4、D4b 的计划审阅和批检查
 * 四条名单断言都红在 `toEqual`，差集只有 `query_task_graph`。恢复后 `git diff -- src` 为空。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { g8Check, g8PlanForm } from '../helpers/G8-world.js';
import {
  expectB15, expectNoteRead, G8B_ROLE, G8B_TEMPLATE, g8bCheckReview, g8bSubjectOf, openG8BWorld, p0History,
  p0Lookup, p0PersonNote, P0_REVIEWER_TOOLS, p0ToolNames, type G8BWorld,
} from '../helpers/G8B-world.js';
import { adviserToolResult } from '../helpers/K3L3-adviser-world.js';
import { proposalRefOf } from '../helpers/IV-host-fixture.js';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { committed } from '../helpers/S7A-fixture.js';
import { refinementPlanFrom } from '../helpers/S7B-V-fixture.js';
import { sendRoundOf } from '../helpers/XWS2A-world.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });

const OBJECTIVE_D4 = 'G8B 参谋细化的计划';
const OBJECTIVE_D7 = 'G8B 执行者改的计划';

/**
 * 人 `plans/propose` + `plans/apply` 的 v1：只有目标级 `plan_only` 占位任务 `g8b-d4-work`（XWR `refineRound` 的计划）。
 * `seed` 时请求上带种子检查 `g8b-d4-seed`（`true`），人采用时装上它（G8A），工作区就有了检查配置；不带时工作区里一条
 * 检查都没有。
 */
async function adoptPlaceholder(w: G8BWorld, goal: GoalRef, seed: boolean): Promise<void> {
  const draft = { schemaVersion: 2, planId: 'g8b-d4-plan', planRevision: 1, goalId: goal.goalId, stages: [], tasks: [{
    taskId: 'g8b-d4-work', title: 'g8b-d4-work', requirementLevel: 'required', taskKind: 'work', disposition: 'active',
    phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only', sizeClass: 'small' }], assignments: [],
  obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [],
  inputRequirements: [] };
  const proposed = committed<{ ref: unknown; revision: number }>(await w.world.post('plans/propose', graphWrite(w.scope, {
    goalRef: goal, basedOn: null, draft, ...(seed ? { checks: [g8Check('g8b-d4-seed', ['g8b-d4-work'])] } : {}),
    reason: { text: 'G8B D4 占位', sources: [] } }, 'g8b-d4-propose')), 'D4: the placeholder plan');
  committed(await w.world.post('plans/apply', graphWrite(w.scope, { proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision, decisionRefs: [] }, 'g8b-d4-apply')), 'D4: the person adopts v1');
}

/** 参谋的细化：占位任务 `g8b-d4-work` 变成要执行的工作，加目标关口和一条义务（G8A 的计划表单），带 `checks`。 */
function refinement(checks: object[]): S6AReply {
  const form = g8PlanForm('g8b-d4', G8B_ROLE) as { tasks: Record<string, unknown>[] };
  const tasks = form.tasks.map(task => task['taskId'] === 'g8b-d4-work'
    ? { ...task, sizeClass: 'small', estimatedLines: 10 } : task);
  return { kind: 'calls', calls: [{ callId: 'g8b-d4-refine', name: 'submit_plan_round', args: {
    answerKind: 'plan', summary: 'G8B D4 细化', reason: { text: 'G8B D4 细化', affectedTaskIds: ['g8b-d4-work'] },
    plan: { ...form, tasks }, checks } }] };
}

describe('G8B-1a: an adviser\'s plan that the platform adopts by itself brings a check; the review line approves it', () => {
  it.each([
    { row: 'D4', seed: true, workspace: 'a check is installed' },
    { row: 'D4b', seed: false, workspace: 'no check is installed yet' },
  ])('$row ($workspace): planreview pass, then checkreview: to the reviewer (not the adviser), approve; adopted with '
    + 'the agent approval', async ({ row, seed }) => {
      const w = await openG8BWorld(`g8b-${row.toLowerCase()}`);
      cleanup.push(w.close);
      const adviser = await w.line('g8b-d4-adviser', G8B_TEMPLATE.adviser);
      const reviewer = await w.line('g8b-d4-reviewer', G8B_TEMPLATE.reviewer);
      const goal = await w.goal('g8b-d4', OBJECTIVE_D4, { adviser });
      const before = await w.noticeKeys(goal);
      const check = g8Check('g8b-d4-check', ['g8b-d4-work', 'g8b-d4-gate'], 'test -f g8b-d4.txt');
      const note = await p0PersonNote(w, `g8b-${row.toLowerCase()}-note`);
      await w.world.scripted.script(adviser, [{ kind: 'calls', calls: [p0Lookup('g8b-d4-mem')] }, refinement([check])],
        w.scope);
      await w.world.scripted.script(reviewer, [
        { kind: 'calls', calls: [p0Lookup('g8b-d4-review-mem'), p0History('g8b-d4-review-history', goal)] },
        { kind: 'calls', calls: [{ callId: 'g8b-d4-review', name: 'submit_plan_review',
          args: { verdict: 'pass', findings: [] } }] },
        { kind: 'calls', calls: [p0History('g8b-d4-approval-history', goal)] },
        g8bCheckReview('g8b-d4-approve', [{ checkId: 'g8b-d4-check', decision: 'approve',
          reason: '改动前确实失败，查的是关口要的东西' }])], w.scope);

      // 人采用 v1：只有占位任务；D4 带一条改动前就通过的种子检查，D4b 不带（工作区里一条检查都没有）。
      await adoptPlaceholder(w, goal, seed);
      // 细化轮：发给目标的参谋线，参谋的回答成了候选 P（版本 1）。
      expect(await sendRoundOf(w.ws, goal, 'g8b-d4-refine')).toMatchObject({ round: { kind: 'refine' },
        recipient: adviser.ref });
      const refine = (await w.rounds(adviser, 'refine:'))[0]!;
      expect((await w.settled(refine.message.ref)).response, `${row}: the refine round was not replied`).not.toBeNull();
      const memo = await adviserToolResult({ world: w.world, adviser }, 'g8b-d4-mem', adviser, w.scope);
      expectNoteRead(memo, note, `${row}: the refine round`);
      const p = await w.steps.read<PlanProposal>('plans/proposal', proposalRefOf(refine.message.ref, goal));
      expect({ status: p.status, revision: p.revision }).toEqual({ status: 'candidate', revision: 1 });
      // 计划审阅：审阅者 pass。
      const beforeReview = (await w.world.scripted.requests(reviewer, w.scope)).length;
      expect(await sendRoundOf(w.ws, goal, 'g8b-d4-review')).toMatchObject({ round: { kind: 'planreview' },
        recipient: reviewer.ref });
      const review = (await w.rounds(reviewer, 'planreview:'))[0]!;
      expect((await w.settled(review.message.ref)).response, `${row}: the plan review was not replied`).not.toBeNull();
      const reviewMemo = await adviserToolResult({ world: w.world, adviser: reviewer }, 'g8b-d4-review-mem',
        reviewer, w.scope);
      expectNoteRead(reviewMemo, note, `${row}: the plan review`);
      const reviewHistory = await adviserToolResult({ world: w.world, adviser: reviewer },
        'g8b-d4-review-history', reviewer, w.scope);
      expectB15(reviewHistory, `${row}: the plan review`);
      expect.soft([...(await p0ToolNames(w, reviewer, beforeReview))].sort(), `${row}: the plan review tool list`)
        .toEqual([...P0_REVIEWER_TOOLS, 'submit_plan_review'].sort());

      // 采用之前请批：下一个系统轮是给审阅线的 `checkreview:`，参谋（作者）收不到。
      const beforeCheck = (await w.world.scripted.requests(reviewer, w.scope)).length;
      expect(await sendRoundOf(w.ws, goal, 'g8b-d4-approval'), `${row}: the Goal sent no approval round`)
        .toMatchObject({ recipient: reviewer.ref });
      const sent = await w.roundsAfter(reviewer, 'checkreview:');
      expect(sent.map(round => round.text.split('\n')[0])).toEqual([`checkreview:${p.ref.proposalId}:1`]);
      expect(await w.rounds(adviser, 'checkreview:'), `${row}: the author got the approval round`).toEqual([]);
      expect(g8bSubjectOf(sent[0]!.text)).toMatchObject({ proposalRef: p.ref, proposalRevision: 1,
        authorDuty: 'adviser', approverDuty: 'reviewer',
        baselines: [{ checkId: 'g8b-d4-check', outcome: 'failed', exitCode: 1 }] });

      // 审阅者批了：平台采用到 v2，检查装上，记下审阅者（agent）批、参谋写、改动前失败；一行请知悉。
      expect((await w.settled(sent[0]!.message.ref)).response, `${row}: the approval round was not replied`).not.toBeNull();
      const checkHistory = await adviserToolResult({ world: w.world, adviser: reviewer },
        'g8b-d4-approval-history', reviewer, w.scope);
      expectB15(checkHistory, `${row}: the check review`);
      expect.soft([...(await p0ToolNames(w, reviewer, beforeCheck))].sort(), `${row}: the check review tool list`)
        .toEqual([...P0_REVIEWER_TOOLS, 'submit_check_review'].sort());
      expect(await w.planRevision(goal)).toBe(2);
      const entry = await w.steps.settingsEntry();
      expect(entry.checks?.find(item => item.checkId === 'g8b-d4-check')).toMatchObject(check);
      expect(entry.checkApprovals?.find(item => item.checkId === 'g8b-d4-check'), JSON.stringify(entry.checkApprovals))
        .toMatchObject({ plan: { proposalRef: p.ref },
          approvedBy: { kind: 'agent', duty: 'reviewer', session: reviewer.ref }, author: { duty: 'adviser' },
          baseline: { checkId: 'g8b-d4-check', outcome: 'failed', exitCode: 1 } });
      const notices = await w.newNotices(goal, before);
      expect(notices.map(item => item.summary)).toEqual([
        `来自 参谋 · 目标 ${OBJECTIVE_D4}：加了检查「g8b-d4-check」，改动前跑会失败（已核实），审阅者已批，已生效`]);
      expect(notices[0]).toMatchObject({ noticeKind: 'check_approved',
        objects: [{ kind: 'aggregate', pin: { ref: p.ref, revision: 1 }, label: 'candidate' }] });
    }, 240_000);
});

describe('G8B-1a: an author outside the approval table (Q4)', () => {
  it('D7: an executor line\'s intervention plan brings a check: no checkreview:, the person\'s card, no notice',
    async () => {
      const w = await openG8BWorld('g8b-d7');
      cleanup.push(w.close);
      const adviser = await w.line('g8b-d7-adviser', G8B_TEMPLATE.adviser);
      const executor = await w.line('g8b-d7-executor', G8B_TEMPLATE.executor);
      const goal = await w.goal('g8b-d7', OBJECTIVE_D7, { adviser, base: true });
      const note = await p0PersonNote(w, 'g8b-d7-note');
      const before = await w.noticeKeys(goal);
      const check = g8Check('g8b-d7-check', ['g8b-d7-work'], 'test -f g8b-d7.txt');
      const active = (await w.ws.activePlan(goal))!;
      // 执行者的回答是文字计划（R5 的写法），计划自带的检查放在 `checks`（`InitialPlanningResponseV2`）。
      const plan = JSON.parse(refinementPlanFrom(active, goal, { label: 'g8b-d7', taskId: 'g8b-d7-work',
        role: G8B_ROLE, planId: active.planId })) as Record<string, unknown>;
      await w.world.scripted.script(executor, [{ kind: 'calls', calls: [p0Lookup('g8b-d7-mem')] },
        { kind: 'text', text: JSON.stringify({ ...plan, checks: [check] }) }], w.scope);
      const person = committed<{ ref: SessionMessageRef }>(await w.world.post('messages/send', graphWrite(w.scope, {
        recipient: executor.ref, text: 'G8B D7：再加一项工作', intent: 'action_request', needsReply: true, goalRef: goal,
      }, 'g8b-d7-person')), 'the D7 person message').ref;
      expect(await w.interventionReached(person, 'awaiting_decision'), 'D7: stage 11 did not leave it to the person')
        .toContain('awaiting_decision');
      const memo = await adviserToolResult({ world: w.world, adviser: executor }, 'g8b-d7-mem', executor, w.scope);
      expectNoteRead(memo, note, 'D7: the plan round');
      expect((await w.steps.read<PlanProposal>('plans/proposal', proposalRefOf(person, goal))).status).toBe('candidate');
      expect(await w.rounds(adviser, 'checkreview:'), 'D7: an executor\'s check was sent for approval').toEqual([]);
      expect(await w.rounds(executor, 'checkreview:')).toEqual([]);
      expect(await w.planRevision(goal), 'D7: the plan moved without the person').toBe(1);
      expect(JSON.stringify(await w.steps.settingsEntry()), 'D7: the check was installed').not.toContain('g8b-d7-check');
      const cards = JSON.stringify(await w.candidateCards(goal));
      for (const fact of ['g8b-d7-check', 'test -f g8b-d7.txt', 'g8b-d7-work']) {
        expect(cards, `D7: the candidate card lists ${fact}`).toContain(fact);
      }
      expect(await w.newNotices(goal, before), 'D7: a notice for an author outside the table').toEqual([]);
    }, 180_000);
});
