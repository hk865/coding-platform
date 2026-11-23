/**
 * IPF 的世界和步骤（lead 2026-11-17 裁定 `ipf-rulings.md`：干预来源证明和规划问题来源；G6 第九次“干预”卡死）。
 *
 * 一个 S6A host 世界（只开 memory，RULES S3：这里没有存储行），每个状态都来自公开步骤：
 * - 目标 G 的人采用计划 v1 有两件工作（done、next）加目标关口；“做完的线”只负责 done，经 `workflow/advance`
 *   做到 satisfied，于是这条线最近的工作是一件已满足的任务，线上没有未完成任务（G6 的 t3 就是这样）；
 * - “下一件的线”只负责 next，留到最后：它的 Run 能不能准备，就是“G 的后续工作还能不能准备”；
 * - 档位设成 every_step（照 S7B-V、IV-4），干预写出的细化候选停在人的卡上，不被平台自己采用；
 * - 检查配置用 S7B-V `completeS7BGoal` 的同一个做法：memory Host 本身没有检查，注册一份受信配置（A8）。
 *
 * 干预由 Host 发布的 Workflow 入口 `platform.workflow.handleIntervention` 处理（S7B-V 的 `interveneS7B`），一次一步，
 * 直到不再推进；它的返回值就是这一步的完成屏障，不靠等待来证明“没有发生”。
 */
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { HandleInterventionResultV1 } from '../../src/business/workflow/ports.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { ag2bChecksConfiguration, graphWrite } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from './S6B1-fixture.js';
import { assertTaskCompleted, committed, sessionOf, setS7AAutonomy } from './S7A-fixture.js';
import { interveneS7B, s7bVWorkProfile } from './S7B-V-fixture.js';

export type IpfWorld = {
  world: S6AHostWorld;
  /** 干预要落到的目标 G（计划 v1 已由人采用，档位 every_step）。 */
  goal: GoalRef;
  /** 做完的线：最近的工作是已满足的 done，线上没有未完成任务。 */
  done: S6ASession;
  /** 下一件的线：只负责还没做的 next。 */
  next: S6ASession;
  nextTaskId: string;
  label: string;
};

/** 搭起 IPF 世界：目标 G、计划 v1（done、next、关口），done 经真实的 Work Run 和检查做到 satisfied。 */
export async function openIpfWorld(label: string): Promise<IpfWorld> {
  const world = await openS6AHostWorld({ backend: 'memory' });
  try {
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, ws, world.goals);
    const goal = (await ws.createGoal(`ipf-goal-${label}`, `IPF goal ${label}`)).ref;
    const doneId = `ipf-${label}-done`;
    const nextTaskId = `ipf-${label}-next`;
    const { tasks } = await adoptS6BPlan(ws, goal, { label: `ipf-${label}`, taskIds: [doneId, nextTaskId],
      role: S6A_WORK_ROLE.templateId });
    const done = await sessionOf(world, await createS6BLine(ws,
      { label: `ipf-${label}-done-line`, role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const next = await sessionOf(world, await createS6BLine(ws,
      { label: `ipf-${label}-next-line`, role: S6A_WORK_ROLE, tasks: [tasks[1]!] }));
    world.platform.registerCheckConfiguration({ configuration: ag2bChecksConfiguration({
      actor: world.ag2b.actor, command: 'true' }) });
    await world.scripted.script(done, [{ kind: 'text', text: `IPF ${label} done work` }]);
    // 认领 done、跑 Run、过检查、完成；下一次认领（或为别的任务开线）之前停下。
    const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: `ipf-${label}-done`,
      sessionHint: done.ref, kind: 'select_work', taskId: doneId }, 'claim_task');
    await driveWorkflow(world.ag2b, claim,
      { stopBefore: op => op.kind === 'claim_task' || op.kind === 'create_session' });
    await assertTaskCompleted(world, goal, doneId);
    await setS7AAutonomy(world, goal, 'every_step');
    return { world, goal, done, next, nextTaskId, label };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** 再开一条不负责任何任务的 Work 线（`sessions/create`）。 */
export async function createIpfLine(w: IpfWorld, label: string): Promise<S6ASession> {
  return await sessionOf(w.world, await createS6BLine(s6aCardsWorkspace(w.world, S6A_SCOPE),
    { label: `ipf-${w.label}-${label}`, role: S6A_WORK_ROLE }));
}

/**
 * 人的“直接干预”：`messages/send`。不给 `goalRef` 时就是界面的形状（`src/ui/boot.ts` 的
 * `{ recipient, text, entry: 'person_intervention', needsReply: true }`）；给了就是 HTTP 调用方点名目标的形状。
 */
export async function sendIntervention(w: IpfWorld, input: {
  label: string; recipient: S6ASession; goalRef?: GoalRef;
}): Promise<SessionMessage> {
  return committed<SessionMessage>(await w.world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: input.recipient.ref, text: `IPF 干预 ${input.label}：请再安排一件事`,
    entry: 'person_intervention', needsReply: true, ...(input.goalRef === undefined ? {} : { goalRef: input.goalRef }),
  }, `ipf-${w.label}-${input.label}-send`)), `the ${input.label} intervention message`);
}

/**
 * 反复调 Workflow 入口，直到它不再推进（`progressed`，或计划轮被挡住时的 `queued`），返回第一个别的结果。
 * 一次调用至多推进 Query 的一个阶段；12 次足够走完提交、认领、准备、进入、作答和写候选。
 */
export async function interveneUntilSettled(w: IpfWorld, messageRef: SessionMessage['ref']):
Promise<HandleInterventionResultV1> {
  const profile = s7bVWorkProfile();
  let result = await interveneS7B(w.world, messageRef, profile);
  for (let step = 0; step < 12 && (result.status === 'progressed' || result.status === 'queued'); step += 1) {
    result = await interveneS7B(w.world, messageRef, profile);
  }
  return result;
}

/** 目标 G 的决定队列（`decisions/queue`，等人回答的一节），原样返回，好让行看到拒绝码。 */
export async function readIpfQueue(w: IpfWorld): Promise<ReadResult<DecisionQueueReadV1>> {
  return await s6aCardsWorkspace(w.world, S6A_SCOPE).route('decisions/queue', {
    workspace: { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId }, goalRef: w.goal,
    sections: ['waiting_answer'], page: { limit: 100 },
  }) as ReadResult<DecisionQueueReadV1>;
}

/** 队列里等人回答的规划问题卡。 */
export function planningQuestionCards(queue: DecisionQueueReadV1): DecisionCardV1[] {
  return queue.waitingAnswer.filter(card => card.source.kind === 'planning_question');
}

/**
 * G 的后续工作：下一件的线认领 next，Run 经生产的准备（会读 G 的图上下文，其中有 G 的决定队列）进入，
 * 在检查之前停下。返回这条线收到的模型请求数：准备成功、Run 进了模型才是 1。
 */
export async function startIpfNextWork(w: IpfWorld): Promise<number> {
  await w.world.scripted.script(w.next, [{ kind: 'text', text: `IPF ${w.label} next work` }]);
  await driveWorkflow(w.world.ag2b, { schemaVersion: 1, goalRef: w.goal, flowId: `ipf-${w.label}-next`,
    sessionHint: w.next.ref, kind: 'select_work', taskId: w.nextTaskId }, { stopBefore: 'open_checks' });
  return (await w.world.scripted.requests(w.next)).length;
}
