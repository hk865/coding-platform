/**
 * G8B-2（决定 121-141，`g8b-rulings.md` B5 的测试行）手写的起点计划 v1 和候选 P。只有计划数据，不碰平台，纯表和场景共用。
 * - v1：工作任务 W1、W3，目标关口 G1。义务 o-main 列 W1、W3、G1（要求 r-main）；o-sub 只列 G1（要求 r-sub「sub 存在」）。
 *   W3 是裁定 F3 的那个就绪任务：等卡期间普通工作照常领取它。
 * - P：G1 标成 superseded、`replacedByTaskId: 'G2'`，G2 是新的目标关口；新工作任务 W2；新义务 o-nosub 列 W2、G2（要求 r-nosub
 *   「sub 不存在」）；o-main 加 G2；o-sub 不带进来。
 */
import type { AcceptanceObligation, PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';

export const g8b2Work = (taskId: string, title: string): RuntimeTask => ({ taskId, title, requirementLevel: 'required',
  taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
  executionIntent: 'request_execution', sizeClass: 'small' });
export const g8b2Gate = (taskId: string, title: string): RuntimeTask => ({ taskId, title, requirementLevel: 'required',
  taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });
export const g8b2Obligation = (obligationId: string, taskIds: string[], requirementId: string,
  description: string): AcceptanceObligation => ({ obligationId, title: `${obligationId} 验收`, requirementLevel: 'required',
  taskIds, verificationRequirements: [{ requirementId, requirementLevel: 'required', kind: 'static', description }] });
const NO_EDGES = { taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };

/** v1：人采用的首个计划（`role` 是执行 W1、W3 的角色）。 */
export function g8b2V1(goalId: string, role: string): PlanRevisionDraft {
  return { schemaVersion: 2, planId: 'g8b2-plan', planRevision: 1, goalId, stages: [],
    tasks: [g8b2Work('W1', 'W1 主流程'), g8b2Work('W3', 'W3 另一件工作'), g8b2Gate('G1', 'G1 目标验收')],
    assignments: ['W1', 'W3'].map(taskId => ({ taskId, role, instruction: `${taskId} 照做` })),
    obligations: [g8b2Obligation('o-main', ['W1', 'W3', 'G1'], 'r-main', '主流程能用'),
      g8b2Obligation('o-sub', ['G1'], 'r-sub', 'sub 存在')], ...NO_EDGES };
}

/** P：在 v1 上彻底去掉 sub。拒绝行用 `g1` 改写 G1 这一项、用 `keep` 定留下哪些源义务（默认除 o-sub 外都留）。 */
export function g8b2P(v1: PlanRevisionSnapshot, role: string, change: {
  g1?: (task: RuntimeTask) => RuntimeTask; keep?: (obligationId: string) => boolean;
} = {}): PlanRevisionDraft {
  const g1 = change.g1 ?? (task => ({ ...task, disposition: 'superseded', replacedByTaskId: 'G2' }));
  const keep = change.keep ?? (obligationId => obligationId !== 'o-sub');
  return { schemaVersion: 2, planId: `${v1.planId}-p`, planRevision: v1.planRevision + 1, goalId: v1.goalRef.goalId,
    stages: [],
    tasks: [...v1.tasks.map(task => task.taskId === 'G1' ? g1(task) : task),
      g8b2Work('W2', 'W2 去掉 sub'), g8b2Gate('G2', 'G2 目标验收（不含 sub）')],
    assignments: [...(v1.assignments ?? []), { taskId: 'W2', role, instruction: 'W2 去掉 sub' }],
    obligations: [...v1.obligations.filter(entry => keep(entry.obligationId)).map(entry => entry.obligationId === 'o-main'
      ? { ...entry, taskIds: [...entry.taskIds, 'G2'] } : entry),
    g8b2Obligation('o-nosub', ['W2', 'G2'], 'r-nosub', 'sub 不存在')], ...NO_EDGES };
}
