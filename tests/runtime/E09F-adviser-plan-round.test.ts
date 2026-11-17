/**
 * E09F（lead 11-17 18:3x，Codex 审查必须改的一条）：参谋的规划轮（目标循环或执行者发进参谋线的 plan_round）不读秘书的
 * 事实，交表时同样要退回平台满足不了的依赖种类（context-input-service.ts:621-627、:693-697）。世界借 A-05 的 F0 世界
 * （`openPlanOnlyWorld`）：采用的计划只有一个 plan_only 占位任务、没有依赖边；目标驱动走到这个缺口，给参谋线发 refine 轮。
 * 期望值手算：参谋第一次交的段里有一条 `decision` 边，来源计划里没有，是新边 → 交表退回（invalid），恰好一个问题，点名
 * 这条边的任务和种类，并写明用执行先后表达；第二次去掉这条边 → 收下，这一轮写出候选，候选里没有依赖边。
 * 只走公开入口（`workflow/driver-start`、真实 Host、脚本模型的请求、候选的读取）。
 */
import { expect, it } from 'vitest';
import { systemRoundRequestId, type SystemRoundV1 } from '../../src/contracts/plan-round.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { startGoalDriver } from '../helpers/DRV-fixture.js';
import { awaitPlanningAnswer, awaitProposal, heartbeatUntil, proposalRefOf } from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld } from '../helpers/PL-forms-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { toolOutputJson } from '../scenarios/support/common.js';

const WORK_TASK_ID = 'e09f-adv-work';

it('参谋的规划轮交的段里有 decision 边 → 交表退回；去掉后收下，候选里没有这条边', async () => {
  const opened = await openPlanOnlyWorld('e09f-adv');
  try {
    await startGoalDriver(opened.world, opened.goal, 'e09f-adviser-round');
    const round: SystemRoundV1 = { kind: 'refine', goalRef: opened.goal,
      target: { kind: 'stage', stageId: opened.stageId }, planRevision: 1 };
    const requestId = systemRoundRequestId(round);
    if (requestId.status !== 'ready') throw new Error('E09F: the refine round has no request id');
    const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
    if (messageRef.status !== 'ready') throw new Error('E09F: the refine round has no message ref');
    const segment = (dependsOn: unknown[]) => ({
      stages: [{ stageId: opened.stageId, title: 'E09F next segment' }],
      tasks: [{ taskId: WORK_TASK_ID, stageId: opened.stageId, title: 'E09F refine the next segment',
        requirementLevel: 'required', taskKind: 'work', disposition: 'active',
        scope: { kind: 'stage', stageId: opened.stageId }, executionIntent: 'request_execution',
        sizeClass: 'small', replacedByTaskId: opened.taskId }],
      assignments: [{ taskId: WORK_TASK_ID, role: S6A_WORK_ROLE.templateId, instruction: 'E09F do the segment' }],
      obligations: [{ obligationId: 'e09f-adv-delivery', title: 'E09F delivery', requirementLevel: 'required',
        taskIds: [WORK_TASK_ID], verificationRequirements: [{ requirementId: 'e09f-adv-check', requirementLevel: 'required',
          kind: 'test', description: 'E09F checks the segment' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn }, taskRelations: [],
    });
    const answer = (dependsOn: unknown[]) => ({ answerKind: 'plan', summary: 'E09F refines the segment',
      plan: segment(dependsOn), reason: { text: 'E09F refines the next segment', affectedTaskIds: [opened.taskId] } });
    await opened.world.scripted.script(opened.adviser, [
      { kind: 'calls', calls: [{ callId: 'e09f-adv-first', name: 'submit_plan_round', args: answer([{ taskId: WORK_TASK_ID,
        dependsOnId: opened.taskId, requires: { kind: 'decision', label: 'the parseDate return shape' } }]) }] },
      { kind: 'calls', calls: [{ callId: 'e09f-adv-fixed', name: 'submit_plan_round', args: answer([]) }] },
    ]);
    await heartbeatUntil(opened.world, () => listed(opened.world, 'inbox', opened.adviser),
      items => items.some(message => message.ref.messageId === messageRef.value.messageId), 16);
    const planning = await awaitPlanningAnswer(opened.world, messageRef.value);
    expect(planning, 'E09F: the refine round produced no answered planning Query').not.toBeNull();
    const requests = await opened.world.scripted.requests(opened.adviser);
    const served = requests.find(request => request.messages.some(entry => entry.role === 'tool'
      && entry.callId === 'e09f-adv-first'));
    const refused = toolOutputJson(served, 'e09f-adv-first') as { status: string; code: string;
      problems: { section: string; reason: string }[] } | undefined;
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(refused!.problems).toHaveLength(1);
    expect(refused!.problems[0]!.reason).toContain(WORK_TASK_ID);
    expect(refused!.problems[0]!.reason).toContain('"decision"');
    expect(refused!.problems[0]!.reason).toContain('execution order (executionDag.dependsOn)');
    const candidate = ready<PlanProposal>(await awaitProposal(opened.world,
      proposalRefOf(messageRef.value, opened.goal)), 'the E09F candidate');
    expect(candidate.status).toBe('candidate');
    expect(candidate.draft.executionDag.dependsOn).toEqual([]);
  } finally {
    await opened.close();
  }
}, 120_000);
