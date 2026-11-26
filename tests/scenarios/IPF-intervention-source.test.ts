/**
 * IPF 的测试行（lead 2026-11-17 裁定 `ipf-rulings.md`；诊断 `int-diag.md`；G6 第九次“干预”卡死 66 分钟）。
 * 写测试方和施工方同时、独立地从同一份裁定写；只跑 memory（RULES S3：没有存储行）。世界见 `tests/helpers/IPF-world.ts`。
 *
 * - F1（R1）：人照界面的形状给做完的线发“直接干预”，不带 `goalRef`、`taskRef`。Host 按这条线最近的工作选了 G，
 *   开 intervention_planning Query，假模型回一份合法的细化计划。期望：决定队列读得出；回答被读成 G 的候选，
 *   等人采用；人采用时采用复核再证明一次来源，候选变成已采用；G 的下一件工作的 Run 能准备。
 *   守：IPF R1 改坏 → 第二步入口 `source_stale`；R7 没做（text 形状，没有 `submit_plan_round`）→ 第二步入口 `no_answer`。
 * - F2（R2）：用带 `goalRef` 的消息造出同样的候选，另一条线 `asker` 用文字回答两个问题（守 `plan_round` 下文字照旧可读）、出两张规划问题卡。
 *   候选等人采用时，人经 `messages/withdraw` 撤回来源消息。期望：决定队列仍读得出，那两张规划问题卡照常，
 *   G 的下一件工作的 Run 能准备。守：IPF R2 改坏 → 撤回之后读队列 `source_stale`；R7 没做 → 候选那一步 `no_answer`。
 * - F3（INT U3）：消息点名了另一个目标（`goalRef` = 目标 1），没有 `taskRef`；点名的目标优先于线最近的工作，
 *   Query 归目标 1，G 不写候选。守：撤回 U3（又按线最近的工作选 G）→ Query 的目标是 G。原来这一格守的“消息点名的
 *   目标和 Query 的目标不同”，U3 以后 `handleIntervention` 自己造不出，改由 F3b 从公开的 `queries/submit` 造。
 * - F3b（守护）：经公开的 `queries/submit` 给 G 开这条消息的干预规划 Query（确定性身份同 Host），消息点名的是目标 1；
 *   Host 照常推进这一轮。期望：证明不成立，入口返回 `rejected/source_stale`，G 和目标 1 都不写候选。
 *   守：IPF R1 不比较消息的 Goal → 候选写出。
 *
 * 改坏演示（写测试方 11-17，在副本里临时给生产代码写替身，演示后还原，`git diff -- src` 为 0）：
 * R1+R2 三行全绿；只做 R1 → F2 红在撤回之后读队列；只做 R2 → F1 队列读得出，红在第二步（入口 `source_stale`、
 * 候选 `not_found`）；R1 改成不比较消息的 Goal → F3 红（候选写出）；R2 改成遇到 `source_stale` 就让整个来源回空页
 * → F2 红在“两张规划问题卡照常”（读到 0 张）。另外探过：撤回之后队列拒绝时，下一件工作的 Run 进不了模型（0 次请求），
 * 所以第三步本身也能发现 G 的工作停了。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { AG2B_PROJECT_REF, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, AG2B_WORKSPACE_REF, graphWrite, plain }
  from '../helpers/AG2b-collaboration-fixture.js';
import { proposalRefOf, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import {
  createIpfLine, interveneUntilSettled, openIpfWorld, planningQuestionCards, readIpfQueue, sendIntervention,
  startIpfNextWork, type IpfWorld,
} from '../helpers/IPF-world.js';
import { S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING } from '../helpers/S6A-request-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { refinementPlan } from '../helpers/S7B-V-fixture.js';

const worlds: IpfWorld[] = [];
afterEach(async () => { for (const w of worlds.splice(0)) await w.world.close().catch(() => undefined); });

async function openWorld(label: string): Promise<IpfWorld> {
  const w = await openIpfWorld(label);
  worlds.push(w);
  return w;
}

/** 做完的线的模型这一轮调 `submit_plan_round`（R7 T1）交一份合法的细化计划：在 G 的 v1 上加一件新的工作。
 * 内容同 `refinementPlan`；表单 strict，去掉 `filledPlan` 和交表后的归一化会补的字段。 */
async function scriptRefinement(w: IpfWorld): Promise<void> {
  const text = await refinementPlan(w.world, w.goal,
    { label: `ipf-${w.label}`, taskId: `ipf-${w.label}-new`, role: S6A_WORK_ROLE.templateId });
  const { summary, plan: { schemaVersion: _v, planId: _id, planRevision: _rev, goalId: _goal, tasks, ...plan } } = JSON.parse(text);
  const args = { answerKind: 'plan', summary, plan: { ...plan, tasks: tasks.map(({ phase: _p, ...task }: { phase: unknown }) => task) } };
  await w.world.scripted.script(w.done, [{ kind: 'calls', calls: [{ callId: 'ipf-submit-plan', name: 'submit_plan_round', args }] }]);
}

/** 一句话的结果：拒绝时带码和理由，红的地方直接看到 `source_stale`。 */
function outcome(result: { status: string }): string {
  const refused = result as { status: string; code?: string; reason?: string };
  return refused.status === 'rejected' ? `rejected/${String(refused.code)}: ${String(refused.reason)}` : refused.status;
}

async function readProposal(w: IpfWorld, messageRef: SessionMessage['ref'],
  goal: GoalRef = w.goal): Promise<ReadResult<PlanProposal>> {
  return (await w.world.post('plans/proposal', plain(S6A_SCOPE, proposalRefOf(messageRef, goal))))
    .body as ReadResult<PlanProposal>;
}

describe('IPF: 干预来源证明和规划问题来源', () => {
  it('F1 界面形状的干预落到做完的线：候选写出、队列读得出、G 的后续 Run 能准备', async () => {
    const w = await openWorld('f1');
    await scriptRefinement(w);
    const sent = await sendIntervention(w, { label: 'f1', recipient: w.done });
    expect(sent, '界面形状：消息不点名目标和任务').toMatchObject({ goalRef: null, taskRef: null });

    const settled = await interveneUntilSettled(w, sent.ref);
    const queue = await readIpfQueue(w);
    // 前两步用 soft：改坏时一次运行就看得到哪一步红。
    expect.soft(outcome(queue), '第一步：G 的决定队列读得出').toBe('ready');
    expect.soft(outcome(settled), '第二步：回答写成候选，停在人的卡上').toBe('awaiting_decision');
    expect(await readProposal(w, sent.ref), '候选的来源是这条消息')
      .toMatchObject({ status: 'ready', value: { status: 'candidate', sourceMessageRef: sent.ref } });
    if (queue.status !== 'ready') return;
    const proposalId = proposalRefOf(sent.ref, w.goal).proposalId;
    expect(queue.value.waitingAnswer.some(card => card.source.kind === 'candidate'
      && card.objects.some(object => JSON.stringify(object).includes(proposalId))), '候选卡在 G 的队列里').toBe(true);
    // 人采用：采用复核再证明一次来源（消息仍不点名目标）。
    const candidate = await readProposal(w, sent.ref);
    if (candidate.status !== 'ready') throw new Error('候选读不到');
    expect((await w.world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposalRefOf(sent.ref, w.goal),
      expectedProposalRevision: candidate.value.revision, decisionRefs: [] }, 'ipf-f1-adopt', []))).body, '人采用')
      .toMatchObject({ status: 'committed' });
    expect(await readProposal(w, sent.ref), '采用复核通过').toMatchObject({ status: 'ready', value: { status: 'accepted' } });
    expect(await startIpfNextWork(w), '第三步：G 的下一件工作的 Run 准备好、进了模型').toBe(1);
  }, 120_000);

  it('F2 候选等人采用时人撤回来源消息：队列仍读得出，其余卡照常，G 的后续 Run 能准备', async () => {
    const w = await openWorld('f2');
    // 其余卡：另一条线上点名 G 的干预，模型回两个问题，G 的队列出两张规划问题卡。
    const asker = await createIpfLine(w, 'asker');
    await w.world.scripted.script(asker, [{ kind: 'text', text: JSON.stringify({ schemaVersion: 2,
      kind: 'needs_decision', summary: 'IPF F2 两个问题', questions: ['先做哪一块？', '用哪个检查证明？'] }) }]);
    const asked = await sendIntervention(w, { label: 'f2-asker', recipient: asker, goalRef: w.goal });
    expect(await interveneUntilSettled(w, asked.ref), '问题回答停在问题卡上')
      .toMatchObject({ status: 'answer_ready', reason: 'questions' });
    // 候选：点名 G 的干预，今天就写得出候选。
    await scriptRefinement(w);
    const sent = await sendIntervention(w, { label: 'f2', recipient: w.done, goalRef: w.goal });
    expect(outcome(await interveneUntilSettled(w, sent.ref)), '候选等人采用').toBe('awaiting_decision');
    const before = await readIpfQueue(w);
    expect(outcome(before), '撤回之前队列读得出').toBe('ready');
    if (before.status !== 'ready') return;
    expect(planningQuestionCards(before.value), '撤回之前有两张规划问题卡').toHaveLength(2);

    const withdrawn = (await w.world.post('messages/withdraw', graphWrite(S6A_SCOPE, { messageRef: sent.ref },
      'ipf-f2-withdraw'))).body;
    expect(withdrawn, '人撤回来源消息').toMatchObject({ status: 'committed', value: { withdrawnAt: expect.any(String) } });

    const after = await readIpfQueue(w);
    expect(outcome(after), '撤回之后 G 的决定队列仍读得出').toBe('ready');
    if (after.status !== 'ready') return;
    expect(planningQuestionCards(after.value), '另一条线的两张规划问题卡照常').toHaveLength(2);
    expect(await startIpfNextWork(w), 'G 的下一件工作的 Run 准备好、进了模型').toBe(1);
  }, 120_000);

  it('F3 U3：消息点名的目标拿到 Query，G 不写候选', async () => {
    const w = await openWorld('f3');
    await scriptRefinement(w);
    const other = w.world.goals.first;
    const sent = await sendIntervention(w, { label: 'f3', recipient: w.done, goalRef: other });
    expect(sent.goalRef, '消息点名的是目标 1').toEqual(other);

    await interveneUntilSettled(w, sent.ref);
    const query = await readPlanningQuery(w.world, sent.ref);
    expect(query?.job.job.status, 'Query 作答了').toBe('answered');
    expect(query?.job.job.goalId, 'Query 的目标是消息点名的目标 1，不是线最近的工作选的 G').toBe(other.goalId);
    expect(await readProposal(w, sent.ref), 'G 不写候选').toMatchObject({ status: 'not_found' });
  }, 120_000);

  it('F3b 守护：queries/submit 给 G 开的 Query，来源消息点名目标 1，证明不成立，候选不写', async () => {
    const w = await openWorld('f3b');
    await scriptRefinement(w);
    const other = w.world.goals.first;
    const sent = await sendIntervention(w, { label: 'f3b', recipient: w.done, goalRef: other });
    const goal = ready<{ goal: { revision: number } }>(
      (await w.world.post('goals/read', plain(S6A_SCOPE, w.goal))).body, 'the goal G');
    const refs = interventionPlanningQueryRefs(sent.ref);
    committed((await w.world.post('queries/submit', graphWrite(S6A_SCOPE, {
      queryJobId: refs.queryJobRef.queryJobId, runId: refs.queryRunRef.runId,
      intent: { schemaVersion: 1, intentId: refs.queryJobRef.queryJobId, projectId: S6A_SCOPE.projectId,
        workspaceId: S6A_SCOPE.workspaceId, goalId: w.goal.goalId, question: 'IPF F3b', focusTaskRefs: [],
        budget: AG2B_QUERY_BUDGET, multiTurn: { maxRounds: 1 }, correlationId: 'ipf-f3b',
        execution: { kind: 'intervention_planning', sourceMessageRef: sent.ref, answerShape: 'plan_round',
          sourceSender: { kind: 'person' }, roleBinding: S6A_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET } },
    }, 'ipf-f3b-submit', [
      { ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 },
      { ref: w.goal, revision: goal.goal.revision },
      { ref: refs.queryJobRef, revision: 0 }, { ref: refs.queryRunRef, revision: 0 },
    ]))).body, 'the planning Query of G');

    const settled = await interveneUntilSettled(w, sent.ref);
    const query = await readPlanningQuery(w.world, sent.ref);
    expect(query?.job.job, 'G 的 Query 作答了').toMatchObject({ status: 'answered', goalId: w.goal.goalId });
    expect(outcome(settled), '来源证明不成立').toMatch(/^rejected\/source_stale: /);
    expect(await readProposal(w, sent.ref), 'G 不写候选').toMatchObject({ status: 'not_found' });
    expect(await readProposal(w, sent.ref, other), '目标 1 也不写候选').toMatchObject({ status: 'not_found' });
  }, 120_000);
});
