/**
 * The Goal interruption record's RecordStore codecs: the record, its single `GoalInterruptionChanged` result event
 * (which carries that record's Goal and written status), and the schemas both backends register. Only
 * `state/goal-interruption.ts` writes the record.
 */
import type { InferEvent } from '../../../contracts/data-format.js';
import { defineEvent, f } from '../../../contracts/data-format.js';
import { id } from '../../../contracts/data-format-refs.js';
import { GoalInterruptionFormat } from '../../../contracts/goal-interruption.js';
import { createEventCodec, createRecordCodec, formatSchemas } from './field-table-codec.js';

export const goalInterruptionCodec = createRecordCodec(GoalInterruptionFormat);

const GOAL_INTERRUPTION_CHANGED_FORMAT = defineEvent({
  name: 'GoalInterruptionChanged', eventType: 'GoalInterruptionChanged', schemaVersion: 1,
  fields: { projectId: id, goalId: id, status: f.enumOf(['pending', 'resumed']) },
});

export type GoalInterruptionChangedEventV1 =
  InferEvent<'GoalInterruptionChanged', typeof GOAL_INTERRUPTION_CHANGED_FORMAT.fields>;

export const goalInterruptionChangedCodec = createEventCodec(GOAL_INTERRUPTION_CHANGED_FORMAT);

export const GOAL_INTERRUPTION_SCHEMAS = formatSchemas([goalInterruptionCodec, goalInterruptionChangedCodec]);
