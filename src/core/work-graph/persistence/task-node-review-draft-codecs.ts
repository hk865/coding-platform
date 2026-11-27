/**
 * The node review draft record's RecordStore codecs (121-173): `TaskNodeReviewDraft@1`, its one
 * `TaskNodeReviewDraftRecorded` result event (which carries the whole record) and the schemas both backends register.
 * Only `tasks/task-node-commit-service.ts` writes it; `views/delivery-read.ts` reads it by Goal.
 */
import { TaskNodeReviewDraftFormat, TaskNodeReviewDraftRecordedFormat } from '../../../contracts/task-node-review-draft.js';
import { createEventCodec, createRecordCodec, formatSchemas } from './field-table-codec.js';

export const taskNodeReviewDraftCodec = createRecordCodec(TaskNodeReviewDraftFormat);
export const taskNodeReviewDraftRecordedCodec = createEventCodec(TaskNodeReviewDraftRecordedFormat);
export const TASK_NODE_REVIEW_DRAFT_SCHEMAS = formatSchemas([taskNodeReviewDraftCodec, taskNodeReviewDraftRecordedCodec]);
