/**
 * The Goal interruption record (`GoalInterruption@1`), one per Goal: a Host start writes it (ask/off) for an active
 * Goal with unfinished required work; `pending` is the Goal-level `interrupted_pending_resume` cause and the Goal's
 * driver start moves it to `resumed`. The store never deletes it; a later interruption is a new revision.
 */
import { defineRecord, defineShape, f, type InferRecord } from './data-format.js';
import { RunRefShape, id } from './data-format-refs.js';

/** The record's address; only this ref joins `AggregateRef`. */
export const GoalInterruptionRefShape = defineShape({
  name: 'GoalInterruptionRef',
  fields: { aggregateType: f.literal('GoalInterruption'), projectId: id, goalId: id },
});

export type GoalInterruptionRef = { aggregateType: 'GoalInterruption'; projectId: string; goalId: string };
export type GoalInterruptionClose = 'clean' | 'unclean';

export const GoalInterruptionFields = {
  ref: f.ref(GoalInterruptionRefShape),
  revision: f.revision({ min: 1 }),
  status: f.enumOf(['pending', 'resumed']),
  close: f.enumOf(['clean', 'unclean']),
  detectedAt: f.isoTime(),
  taskIds: f.array(id, { min: 1 }),
  runRefs: f.array(f.ref(RunRefShape)),
};

export type GoalInterruptionV1 = InferRecord<typeof GoalInterruptionFields>;

export const GoalInterruptionFormat = defineRecord({
  name: 'GoalInterruption', schemaId: 'GoalInterruption@1', aggregateType: 'GoalInterruption',
  fields: GoalInterruptionFields,
});
