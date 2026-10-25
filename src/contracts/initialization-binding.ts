/**
 * The immutable initialization binding: the draft round records the Goal it created, so a later plan read can go from
 * `(answerRef, draftIndex)` to that Goal without re-reading the answer. It is a field-table format
 * (`data-format.ts`) keyed by its own tagged ref (`canonicalJson(ref)`); `revision` and `goalRevision` are fixed at 1.
 *
 * Two pure rules: the ref names the same answer, draft and project as the body, and answer, request and goal are one
 * project with answer and request in one workspace. `answerDigest` is the owner's digest of the stored answer text;
 * this format only checks its shape. The record has no event; the confirm owner writes it inside its own commit.
 */
import { defineRecord, defineShape, f, type InferRecord, type InferShape } from './data-format.js';
import { GoalRefShape, QueryJobAnswerRefShape, QueryJobRefShape, id } from './data-format-refs.js';
import { GoalScreeningShape } from './query-job.js';

/** The ref addresses the answer and draft the binding was made from, in the answer's project. */
function bindingRefProblem(value: unknown): string | null {
  const binding = value as InitializationBindingV1;
  const ref = binding.ref;
  if (ref.answerRef.aggregateType !== binding.answerRef.aggregateType
    || ref.answerRef.projectId !== binding.answerRef.projectId
    || ref.answerRef.workspaceId !== binding.answerRef.workspaceId
    || ref.answerRef.queryJobId !== binding.answerRef.queryJobId
    || ref.answerRef.answerId !== binding.answerRef.answerId) {
    return 'InitializationBinding.ref.answerRef is not the binding answerRef';
  }
  if (ref.draftIndex !== binding.draftIndex) {
    return 'InitializationBinding.ref.draftIndex is not the binding draftIndex';
  }
  return ref.projectId === binding.answerRef.projectId ? null
    : 'InitializationBinding.ref.projectId is not the answer project';
}

/** The answer, request and goal are one project; the answer and request are one workspace. */
function bindingScopeProblem(value: unknown): string | null {
  const binding = value as InitializationBindingV1;
  const { answerRef, requestRef, goalRef } = binding;
  if (answerRef.projectId !== requestRef.projectId) {
    return 'InitializationBinding.answerRef and requestRef are in different projects';
  }
  if (answerRef.projectId !== goalRef.projectId) {
    return 'InitializationBinding.goalRef is in another project than the answer';
  }
  return answerRef.workspaceId === requestRef.workspaceId ? null
    : 'InitializationBinding.answerRef and requestRef are in different workspaces';
}

export const InitializationBindingRefShape = defineShape({ name: 'InitializationBindingRef', fields: {
  aggregateType: f.literal('InitializationBinding'), projectId: id,
  answerRef: f.ref(QueryJobAnswerRefShape), draftIndex: f.integer({ min: 0 }),
} });
export const INITIALIZATION_BINDING_BY_ANSWER_DRAFT_LOOKUP = 'initialization-binding-by-answer-draft';
export const INITIALIZATION_BINDING_BY_GOAL_LOOKUP = 'initialization-binding-by-goal';
export const InitializationBindingFormat = defineRecord({
  name: 'InitializationBinding', schemaId: 'InitializationBinding@1', aggregateType: 'InitializationBinding',
  fields: {
    ref: f.ref(InitializationBindingRefShape), revision: f.literal(1),
    answerRef: f.ref(QueryJobAnswerRefShape), answerDigest: f.sha256(),
    requestRef: f.ref(QueryJobRefShape), draftIndex: f.integer({ min: 0 }),
    goalRef: f.ref(GoalRefShape), goalRevision: f.literal(1),
    screening: f.nullable(f.ref(GoalScreeningShape)),
  },
  rules: [bindingRefProblem, bindingScopeProblem],
  lookups: [
    {
      name: INITIALIZATION_BINDING_BY_ANSWER_DRAFT_LOOKUP,
      equal: ['answerRef.projectId', 'answerRef.workspaceId', 'answerRef.queryJobId', 'answerRef.answerId', 'draftIndex'],
    },
    { name: INITIALIZATION_BINDING_BY_GOAL_LOOKUP, equal: ['goalRef.projectId', 'goalRef.goalId'] },
  ],
});
export type InitializationBindingRef = InferShape<(typeof InitializationBindingRefShape)['fields']>;
export type InitializationBindingV1 = InferRecord<(typeof InitializationBindingFormat)['fields']>;
