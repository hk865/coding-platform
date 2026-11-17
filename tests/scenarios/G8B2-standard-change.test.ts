/**
 * G8B-2 B5 的场景行（决定 121-141，`g8b-rulings.md` 测试行 F1、F2、F3、F5，加上 lead 11-17 要的“人的原话（消息路径）”和照 E08
 * 的端到端）。世界是 PL 的
 * `openPLWorkflowWorld`（只跑内存，RULES S3）；起点 v1 和候选 P 见 `tests/helpers/G8B2-plans.ts`。只走公开路由、Workflow
 * 入口和真实工具调用，模型的回答用脚本线写；卡上的事实照裁定的 `StandardChangeFactsV1`，按 v1、P 手写。
 *
 * - F5 今天绿（守护）：平台的自动化身份经 `plans/apply` 直接采用 P，`invalid`，拒绝点名 G1，计划仍是 v1。
 *   改坏：放宽不看采用者，agent 或平台也能降标。今天在树上演示过：把计划校验和任务状态机里的关口冻结、“源义务不能少”都去掉，
 *   平台的采用就提交了，这一行变红。
 * - F1 今天红在人 `plans/apply` P：`invalid`（G1 的定义变了、o-sub 少了）。包落地后：计划 v2，G1 superseded、指向 G2，
 *   义务正好 o-main、o-nosub，G2 是活动的必需关口。改坏：冻结没放宽。除了计划校验，任务状态机的 `disposition_changed`
 *   也对关口一律拒（`state/task-machine.ts:1396-1398`）；lead 11-17 裁定由施工方照 R1 一起放宽（①），做完才绿。
 *   在树上把两处都临时去掉，这一行是绿的，说明期望值本身对。
 * - F2（参谋的修正轮）、人的原话（消息路径）：P 由参谋线写出。前者是审阅者对普通候选 P0（只改 W3 的指令）答 fix、平台发
 *   `planfix:`，后者是人给参谋发「彻底移除 sub」、参谋的干预规划作答；档位“方案确认后自动”，有审阅线。
 *   包落地后：这一次推进不送审、不采用，照常领取普通工作；卡上 `proposedBy` 是参谋线，`personWords` 前者 null、后者是原话。
 *   今天红在推进那一步（先送计划审阅）。**只落 B5 本身仍红在卡上的事实**：参谋这一段并进底计划时 o-sub 被带回来，只挂在
 *   已取代的 G1 上（今天写出的候选正是这样），`droppedObligations` 是空的；施工方照 R2 改完合并（②）后变绿。
 *   改坏：PL 先送审或尝试自动采用；卡上缺事实；不引用人的原话。
 * - F2、F3（整份草稿的守护）今天红在第一步：这一次推进先送计划审阅（`send_system_round` planreview）。P 由执行者 Run 经真实的
 *   `propose_future_plan` 写出（不经合并，作者线是 `candidateSourceLineOf` 的 `agent_write`）。包落地后：出卡、不送审、
 *   不采用，同一次推进照常领取就绪的 W3，并有 Run（F3）；卡上的事实齐全，`personWords` 是 null。
 *   改坏：PL 先送审或尝试自动采用；降标的卡挡住普通工作；卡上缺事实。
 * - 端到端（照 E08）：人采用 v1 → 人在主对话说「彻底移除 sub」→ 秘书在这一轮用 `submit_plan_round` 交 P → 自动档不送审、
 *   不采用，卡上列出事实和人的原话 → 人采用后新任务 W2 能被领取。改坏：同 F2，加上卡上不引用人的原话。
 *   今天红在第 3 步：秘书交的计划被拒（G1 的定义变了；o-sub 没有活动的必需载体）。请求轮的计划是一段，并进 v1 时 o-sub
 *   被带回来（`mergeStageRefinement` 从不删义务），所以要等施工方做完②才过第 3 步、做完①才过第 5 步。在树上临时放开
 *   校验、状态机、合并三处，拿掉卡上事实那一句，其余各步都走通。
 */
import { afterEach, expect, it } from 'vitest';
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { PlanProposal, PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { g8b2P, g8b2V1 } from '../helpers/G8B2-plans.js';
import { awaitProposal, proposalRefOf } from '../helpers/IV-host-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import {
  adoptPLPlanDraft, advancePLGoal, createPLReviewerLine, openPLWorkflowWorld, performOne, PL_PROPOSE_FUTURE_TOOLS,
  plPlanChangeDraft, plSystemRoundRef, plToolPlanOf, satisfyPLTaskWithPropose, verdictOf, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, committed, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { waitFor } from './harness.js';

const ROLE = S6A_WORK_ROLE.templateId;
const PERSON_WORDS = '彻底移除 sub';
const worlds: PLWorkflowWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

/** PL 世界加人采用的 v1，档位“方案确认后自动”，项目里有一条审阅线。 */
async function openG8B2(label: string, options: Parameters<typeof openPLWorkflowWorld>[0] = {}) {
  const workflow = await openPLWorkflowWorld({ label, ...options });
  worlds.push(workflow);
  const v1 = await adoptPLPlanDraft(workflow.main, workflow.goal, g8b2V1(workflow.goal.goalId, ROLE), label);
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, `${label}-reviewer`);
  return { workflow, v1, reviewer };
}
/** 同一个世界里经 `plans/propose` 写下的 P（F1、F5）。 */
async function proposedP(label: string) {
  const { workflow, v1 } = await openG8B2(label);
  const p = committed<{ ref: PlanProposalRef; revision: number }>(await workflow.main.post('plans/propose',
    graphWrite(S6A_SCOPE, { goalRef: workflow.goal, basedOn: v1.ref, draft: g8b2P(v1, ROLE),
      reason: { text: PERSON_WORDS, sources: [], affectedTaskIds: ['G1'] } }, `${label}-propose`)), 'P');
  return { workflow, p };
}
const lineFor = async (workflow: PLWorkflowWorld, label: string, taskIds: string[]) => await sessionOf(workflow.world,
  await createS6BLine(workflow.main, { label, role: S6A_WORK_ROLE, tasks: taskIds.map(taskId =>
    ({ projectId: workflow.goal.projectId, goalId: workflow.goal.goalId, taskId })) }));
const applyBody = (proposalRef: PlanProposalRef, revision: number, requestId: string) =>
  graphWrite(S6A_SCOPE, { proposalRef, expectedProposalRevision: revision, decisionRefs: [] }, requestId);
const cardFactsOf = async (workflow: PLWorkflowWorld, proposalRef: PlanProposalRef) => ready<{ standardChange?: unknown }>(
  await workflow.world.post('decisions/candidate-card', { scope: { ...S6A_SCOPE },
    input: { goalRef: workflow.goal, proposalRef } }), 'decisions/candidate-card');
/** 卡上的事实（裁定 `StandardChangeFactsV1`；Astra 审查第 3 条后读到了包在 `ready` 里），按 v1、P 手写。 */
const standardChange = (reason: string, session: SessionRef, personWords: string | null) => ({ status: 'ready', value: {
  supersededGates: [{ taskId: 'G1', title: 'G1 目标验收', replacedByTaskId: 'G2' }],
  droppedObligations: [{ obligationId: 'o-sub', title: 'o-sub 验收',
    requirements: [{ requirementId: 'r-sub', description: 'sub 存在' }] }],
  newObligations: [{ obligationId: 'o-nosub', title: 'o-nosub 验收', taskIds: ['W2', 'G2'],
    requirements: [{ requirementId: 'r-nosub', description: 'sub 不存在' }] }],
  reason, proposedBy: { session }, personWords } });
const ADVISER_REASON = '按人的话去掉 sub：G1 由 G2 取代';
/** 参谋这一轮的回答：用真实的 `submit_plan_round` 交 P。 */
const adviserPlan = (callId: string, v1: PlanRevisionSnapshot) => ({ kind: 'calls' as const, calls: [{ callId,
  name: 'submit_plan_round', args: { answerKind: 'plan', summary: ADVISER_REASON, plan: plToolPlanOf(g8b2P(v1, ROLE)),
    reason: { text: ADVISER_REASON, affectedTaskIds: ['G1'] } } }] });
/** 参谋收到 `source` 这一轮写出的候选：自动档下这一次推进不送审、不采用，照常领取普通工作；卡上的事实照 `expected`。 */
async function expectAdviserCard(workflow: PLWorkflowWorld, source: SessionMessageRef, expected: unknown) {
  const read = await awaitProposal(workflow.world, proposalRefOf(source, workflow.goal));
  if (read.status !== 'ready') throw new Error(`参谋这一轮没写出候选：${JSON.stringify(read)}`);
  await lineFor(workflow, 'g8b2-adviser-work', ['W1', 'W3']);
  const pass = await advancePLGoal(workflow.world, workflow.goal, 'g8b2-adviser-pass') as
    { value?: { next: WorkflowAdvanceInput | null } };
  expect(pass.value?.next, JSON.stringify(pass)).toMatchObject({ kind: 'perform', operation: { kind: 'claim_task' } });
  expect((await cardFactsOf(workflow, read.value.ref)).standardChange).toEqual(expected);
}

it('F5：平台的自动化身份直接采用降标的 P，被拒，计划仍是 v1', async () => {
  const { workflow, p } = await proposedP('g8b2-f5');
  const automation = createHostCoreCallContext({ scope: S6A_SCOPE, actor: { ...WORKFLOW_AUTOMATION_ACTOR },
    signal: new AbortController().signal });
  expect(await workflow.world.dispatch('plans/apply', automation, applyBody(p.ref, p.revision, 'g8b2-f5-apply')))
    .toMatchObject({ status: 'rejected', code: 'invalid', reason: expect.stringMatching(/G1/) });
  expect((await workflow.main.activePlan(workflow.goal))?.planRevision).toBe(1);
}, 120_000);

it('F1：人采用 P，计划到 v2：G1 由 G2 取代，义务正好 o-main、o-nosub，G2 是活动的必需关口', async () => {
  const { workflow, p } = await proposedP('g8b2-f1');
  expect(await workflow.main.post('plans/apply', applyBody(p.ref, p.revision, 'g8b2-f1-apply')))
    .toMatchObject({ status: 'committed' });
  const v2 = await workflow.main.activePlan(workflow.goal);
  const task = (taskId: string) => v2?.tasks.find(entry => entry.taskId === taskId);
  expect({ revision: v2?.planRevision, g1: [task('G1')?.disposition, task('G1')?.replacedByTaskId],
    g2: [task('G2')?.disposition, task('G2')?.requirementLevel],
    obligations: v2?.obligations.map(entry => entry.obligationId).sort() })
    .toEqual({ revision: 2, g1: ['superseded', 'G2'], g2: ['active', 'required'], obligations: ['o-main', 'o-nosub'] });
}, 120_000);

it('F2（参谋的修正轮）：审阅者对普通候选答 fix，参谋在 planfix 轮交 P；自动档出人的卡，不送审、不采用', async () => {
  const { workflow, v1, reviewer } = await openG8B2('g8b2-fix');
  const adviser = await createPLAdviserLine(workflow.world, 'g8b2-fix-adviser');
  const p0 = committed<PlanProposal>(await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: v1.ref, reason: { text: 'W3 换个做法', sources: [], affectedTaskIds: ['W3'] },
    draft: plPlanChangeDraft(v1, workflow.goal, { planId: 'g8b2-plan-p0', tasks: v1.tasks, obligations: v1.obligations,
      assignments: (v1.assignments ?? []).map(entry => entry.taskId === 'W3' ? { ...entry, instruction: 'W3 换个做法' } : entry) }),
  }, 'g8b2-fix-p0')), 'P0');
  await workflow.world.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: 'g8b2-fix-review',
    name: 'submit_plan_review', args: { verdict: 'fix', findings: [{ taskId: 'W3', text: '人要彻底去掉 sub' }] } }] }]);
  await performOne(workflow, 'g8b2-fix-review', 'send_system_round');
  expect(await verdictOf(workflow, await plSystemRoundRef(workflow, reviewer, `planreview:${p0.ref.proposalId}:1`)))
    .toBe('fix');
  await workflow.world.scripted.script(adviser, [adviserPlan('g8b2-fix-plan', v1)]);
  await performOne(workflow, 'g8b2-fix-send', 'send_system_round');
  const fix = await plSystemRoundRef(workflow, adviser, `planfix:${p0.ref.proposalId}:1`);
  await expectAdviserCard(workflow, fix, standardChange(ADVISER_REASON, adviser.ref, null));
}, 240_000);

it('人的原话（消息路径）：人给参谋发「彻底移除 sub」，参谋的干预规划交 P；卡上引用原话', async () => {
  const { workflow, v1 } = await openG8B2('g8b2-msg');
  const adviser = await createPLAdviserLine(workflow.world, 'g8b2-msg-adviser');
  await workflow.world.scripted.script(adviser, [adviserPlan('g8b2-msg-plan', v1)]);
  const message = committed<SessionMessage>(await workflow.world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: adviser.ref, text: PERSON_WORDS, intent: 'action_request', needsReply: true, goalRef: workflow.goal,
  }, 'g8b2-msg-send')), '人的消息');
  await expectAdviserCard(workflow, message.ref, standardChange(ADVISER_REASON, adviser.ref, PERSON_WORDS));
}, 240_000);

it('F2、F3（整份草稿的守护）：执行者写的降标候选在自动档出人的卡，不送审、不采用，就绪的 W3 照常领取', async () => {
  const { workflow, v1 } = await openG8B2('g8b2-pl', { extraBindings: [PL_PROPOSE_FUTURE_TOOLS],
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const line = await lineFor(workflow, 'g8b2-pl-line', ['W1', 'W3']);
  // 执行者在 W1 的 Run 里经真实工具写出 P，W1 随后满足。
  const reason = '去掉 sub，G1 由 G2 取代';
  const p = await satisfyPLTaskWithPropose(workflow.world, workflow.goal, 'W1', line, 'g8b2-pl',
    { basedOn: v1.ref, draft: g8b2P(v1, ROLE), reasonText: reason });
  // F2：这一次推进不送审、不采用；F3：照常领取就绪的 W3。
  const pass = await advancePLGoal(workflow.world, workflow.goal, 'g8b2-pl-pass') as
    { value?: { next: WorkflowAdvanceInput | null } };
  expect(pass.value?.next, JSON.stringify(pass)).toMatchObject({ kind: 'perform',
    operation: { kind: 'claim_task', request: { input: { taskId: 'W3' } } } });
  expect((await cardFactsOf(workflow, p.proposalRef)).standardChange).toEqual(standardChange(reason, line.ref, null));
  expect((await workflow.world.post('workflow/advance', plain(S6A_SCOPE, pass.value?.next))).body).toMatchObject({
    status: 'ready', value: { receipt: { kind: 'claim_task', result: { status: 'committed' } } } });
  expect((await workflow.main.activePlan(workflow.goal))?.planRevision).toBe(1);
}, 240_000);

it('端到端（照 E08）：人说彻底移除 sub，秘书出的降标计划在自动档交人的卡，人采用后新任务 W2 能被领取', async () => {
  // 1. 人采用的 v1 里，目标关口 G1 带着 o-sub「sub 存在」。
  const { workflow, v1 } = await openG8B2('g8b2-e2e', { extraHostOptions: { requestDriver: 'on' } });
  const secretary = await workflow.world.createSecretary('g8b2-e2e');
  const summary = '按你的话去掉 sub：G1 由 G2 取代';
  await workflow.world.scripted.script(secretary, [{ kind: 'calls', calls: [{ callId: 'g8b2-e2e-plan',
    name: 'submit_plan_round', args: { answerKind: 'plan', summary, plan: plToolPlanOf(g8b2P(v1, ROLE)),
      reason: { text: summary, affectedTaskIds: ['G1'] } } }] }]);
  // 2. 人在主对话里说的话。
  const request = await workflow.main.submit({ label: 'g8b2-e2e', goalId: workflow.goal.goalId, text: PERSON_WORDS,
    recipient: secretary.ref });
  // 3. 秘书这一轮交的计划被收下；拒了就把工具的回执带出来。
  type Round = { status: string; closeCode: string | null };
  const view = await waitFor(() => workflow.main.readRequest(request.requestRoot), value =>
    (value['rounds'] as Round[]).every(round => round.status !== 'queued' && round.status !== 'running'), 'the round');
  const round = (view['rounds'] as Round[])[0];
  const replies = (await workflow.world.scripted.requests(secretary)).flatMap(entry => entry.messages)
    .filter(message => message.role === 'tool');
  expect({ status: round?.status, closeCode: round?.closeCode }, JSON.stringify(replies))
    .toEqual({ status: 'ended', closeCode: null });
  const head = (await waitFor(async () => ready<{ head: PlanProposal | null }>(await workflow.world.post(
    'plans/request-candidate', plain(S6A_SCOPE, { goalRef: workflow.goal, requestRef: request.requestRoot })),
  'plans/request-candidate'), value => value.head !== null, 'the request candidate')).head!;
  // 4. 自动档：不送审、不采用；卡上列出去掉的、换成的、理由、谁提的和人的原话。
  expect(JSON.stringify(await advancePLGoal(workflow.world, workflow.goal, 'g8b2-e2e-pass'))).not.toContain('planreview:');
  expect({ status: head.status, revision: (await workflow.main.activePlan(workflow.goal))?.planRevision })
    .toEqual({ status: 'candidate', revision: 1 });
  expect((await cardFactsOf(workflow, head.ref)).standardChange)
    .toEqual(standardChange(summary, secretary.ref, PERSON_WORDS));
  // 5. 人采用，目标接着走：新任务 W2 能被领取。
  expect(await workflow.main.post('plans/apply', applyBody(head.ref, head.revision, 'g8b2-e2e-apply')))
    .toMatchObject({ status: 'committed' });
  const line = await lineFor(workflow, 'g8b2-e2e-line', ['W2']);
  await advanceUntil(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal, flowId: 'g8b2-e2e-w2',
    sessionHint: line.ref, kind: 'select_work', taskId: 'W2' }, 'claim_task');
}, 240_000);
