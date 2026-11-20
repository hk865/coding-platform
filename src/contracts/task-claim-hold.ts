/**
 * 一个任务的暂缓领取记录的引用：每个任务一条，固定键（不带工作区和号码）。纯数据：记录本身和它的构造器在
 * `core/work-graph/state/task-claim-hold.ts`，owner 在 `core/work-graph/tasks/claim-holds.ts`。
 */
export type TaskClaimHoldRef = {
  aggregateType: 'TaskClaimHold';
  projectId: string;
  goalId: string;
  taskId: string;
};
