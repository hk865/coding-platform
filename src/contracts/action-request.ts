/**
 * 动作请求（派活、叫停）的记录引用。`requestId` 是受理那条命令身份的摘要，同一命令重放落到同一条记录。
 * 纯数据：记录本身和它的迁移在 `core/work-graph/state/`、`core/work-graph/tasks/`。
 */
export type ActionRequestRef = {
  aggregateType: 'ActionRequest';
  projectId: string;
  goalId: string;
  taskId: string;
  requestId: string;
};
