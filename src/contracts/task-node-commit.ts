/**
 * Node-level review (decision 121-45): under a Goal set to `every_step`, each completed work node that changed files
 * waits for the person; the platform then commits that node's files for them (`committed`, one git commit, the
 * person's message, never pushed) or, when the files no longer differ from HEAD, records that they saw it
 * (`acknowledged`, no commit). `TaskNodeCommit@1` is that one review fact per completed node, keyed by the
 * TaskReduction revision it covers, so a node reworked and completed again is a new delivery, not an overwrite.
 */
import { defineEvent, defineRecord, defineShape, f, type InferEvent, type InferShape } from './data-format.js';
import { GoalRefShape, PlanRevisionRefShape, RunRefShape, TaskTripleShape, id } from './data-format-refs.js';

/** The record's address: one review fact per (Goal, Task, TaskReduction revision). */
export const TaskNodeCommitRefShape = defineShape({ name: 'TaskNodeCommitRef', fields: {
  aggregateType: f.literal('TaskNodeCommit'), projectId: id, goalId: id, taskId: id,
  reductionRevision: f.integer({ min: 1 }),
} });
export type TaskNodeCommitRef = InferShape<(typeof TaskNodeCommitRefShape)['fields']>;

/** One reviewed path: its executed-file certainty and the working-tree blob the person saw (null: absent then). */
const TaskNodeReviewFileField = f.object({
  path: id, certainty: f.enumOf(['definite', 'possible']), blob: f.nullable(id),
});
export type TaskNodeReviewFileV1 = InferShape<{ file: typeof TaskNodeReviewFileField }>['file'];

const TaskNodeCommitFields = {
  ref: f.ref(TaskNodeCommitRefShape),
  schemaVersion: f.literal(1),
  revision: f.literal(1),
  goalRef: f.ref(GoalRefShape),
  planRef: f.ref(PlanRevisionRefShape),
  planRevision: f.integer({ min: 1 }),
  taskRef: f.ref(TaskTripleShape),
  runRefs: f.array(f.ref(RunRefShape), { min: 1 }),
  /** The reviewed pathspec, not the whole work tree; which other Goal shares a path is a read-time mark, not stored. */
  files: f.array(TaskNodeReviewFileField, { min: 1 }),
  /** `committed` carries the commit and the person's message (without the platform's trailers); `acknowledged`, the
   *  files no longer differed from HEAD, carries no commit. */
  review: f.union('kind', {
    committed: { kind: f.literal('committed'), sha: id, message: id },
    acknowledged: { kind: f.literal('acknowledged') },
  }),
  /** The configured operator; a Host may run as a `system` actor that is not a platform automation. */
  reviewedBy: f.union('kind', {
    human: { kind: f.literal('human'), id }, system: { kind: f.literal('system'), id },
  }),
  reviewedAt: f.isoTime(),
  requestId: id,
};
export type TaskNodeCommitV1 = InferShape<typeof TaskNodeCommitFields>;

export const TASK_NODE_COMMIT_BY_GOAL_LOOKUP = 'task-node-commit-by-goal';

export const TaskNodeCommitFormat = defineRecord({
  name: 'TaskNodeCommit', schemaId: 'TaskNodeCommit@1', aggregateType: 'TaskNodeCommit',
  fields: TaskNodeCommitFields,
  lookups: [{ name: TASK_NODE_COMMIT_BY_GOAL_LOOKUP, equal: ['ref.projectId', 'ref.goalId'] }],
});

/** The one result event: the whole record, so a replay reads the event alone. */
export const TaskNodeCommittedFormat = defineEvent({
  name: 'TaskNodeCommitted', eventType: 'TaskNodeCommitted', schemaVersion: 1,
  fields: { result: f.object(TaskNodeCommitFields) },
});
export type TaskNodeCommittedEventV1 = InferEvent<'TaskNodeCommitted', (typeof TaskNodeCommittedFormat)['fields']>;
