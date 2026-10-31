/**
 * The `ReworkRequest` aggregate's reference (record 3's ref, `book-7c` §3.14). Pure data: the record's value type
 * and its one field table are `core/work-graph/persistence/rework-request-codecs.ts`.
 */
export type ReworkRequestRef = {
  aggregateType: 'ReworkRequest';
  projectId: string;
  goalId: string;
  taskId: string;
  requestId: string;
};
