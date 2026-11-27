/**
 * The secretary's draft of a pending node's note (121-173). When a node starts waiting for the person under
 * `every_step`, the platform asks the Goal's secretary once for a draft of this step's description; the person reads it
 * beside the node and settles the commit message. `TaskNodeReviewDraft@1` is that one ask per (Goal, Task,
 * TaskReduction revision): the Query it opened, or why it could not ask. The answer text stays the Query's own and is
 * never copied here.
 */
import { defineEvent, defineRecord, defineShape, f, type InferEvent, type InferShape } from './data-format.js';
import { QueryJobRefShape, id } from './data-format-refs.js';

/** The record's address: one ask per (Goal, Task, TaskReduction revision). */
export const TaskNodeReviewDraftRefShape = defineShape({ name: 'TaskNodeReviewDraftRef', fields: {
  aggregateType: f.literal('TaskNodeReviewDraft'), projectId: id, goalId: id, taskId: id,
  reductionRevision: f.integer({ min: 1 }),
} });

const TaskNodeReviewDraftFields = {
  ref: f.ref(TaskNodeReviewDraftRefShape),
  schemaVersion: f.literal(1),
  revision: f.literal(1),
  /** The secretary's Query; null when the platform could not ask. */
  request: f.nullable(f.ref(QueryJobRefShape)),
  requestedAt: f.isoTime(),
  /** Why the platform could not ask; null when `request` is set. */
  failureReason: f.nullable(id),
  /** The Host actor the platform asked as. */
  requestedBy: f.union('kind', {
    human: { kind: f.literal('human'), id }, system: { kind: f.literal('system'), id },
  }),
};
export type TaskNodeReviewDraftV1 = InferShape<typeof TaskNodeReviewDraftFields>;

export const TASK_NODE_REVIEW_DRAFT_BY_GOAL_LOOKUP = 'task-node-review-draft-by-goal';

export const TaskNodeReviewDraftFormat = defineRecord({
  name: 'TaskNodeReviewDraft', schemaId: 'TaskNodeReviewDraft@1', aggregateType: 'TaskNodeReviewDraft',
  fields: TaskNodeReviewDraftFields,
  lookups: [{ name: TASK_NODE_REVIEW_DRAFT_BY_GOAL_LOOKUP, equal: ['ref.projectId', 'ref.goalId'] }],
});

/** The one result event: the whole record, so a replay reads the event alone. */
export const TaskNodeReviewDraftRecordedFormat = defineEvent({
  name: 'TaskNodeReviewDraftRecorded', eventType: 'TaskNodeReviewDraftRecorded', schemaVersion: 1,
  fields: { result: f.object(TaskNodeReviewDraftFields) },
});
export type TaskNodeReviewDraftRecordedEventV1 =
  InferEvent<'TaskNodeReviewDraftRecorded', (typeof TaskNodeReviewDraftRecordedFormat)['fields']>;
