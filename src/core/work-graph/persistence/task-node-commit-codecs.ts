/**
 * The node review record's RecordStore codecs: `TaskNodeCommit@1`, its one `TaskNodeCommitted` result event (which
 * carries the whole record) and the schemas both backends register. Only `tasks/task-node-commit-service.ts` writes it.
 */
import { TaskNodeCommitFormat, TaskNodeCommittedFormat } from '../../../contracts/task-node-commit.js';
import { createEventCodec, createRecordCodec, formatSchemas } from './field-table-codec.js';

export const taskNodeCommitCodec = createRecordCodec(TaskNodeCommitFormat);
export const taskNodeCommittedCodec = createEventCodec(TaskNodeCommittedFormat);
export const TASK_NODE_COMMIT_SCHEMAS = formatSchemas([taskNodeCommitCodec, taskNodeCommittedCodec]);
