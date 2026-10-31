/**
 * The `ModuleOverlapGate` aggregate's reference (record 4's ref, `book-7c` §3.14). Pure data: the record's value
 * type and its one field table are `core/work-graph/persistence/module-overlap-gate-codecs.ts`.
 */
export type ModuleOverlapGateRef = {
  aggregateType: 'ModuleOverlapGate';
  projectId: string;
  goalId: string;
  taskId: string;
  moduleId: string;
};
