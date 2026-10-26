import { defineRecord, f, type InferRecord } from './data-format.js';
import { DispatchCounterRefShape, SessionMessageRefShape, id } from './data-format-refs.js';

/** The field table of `DispatchCounter@1`; D adds the rule and the `defineRecord` format (SR5). */
export const DispatchCounterFields = {
  ref: f.ref(DispatchCounterRefShape),
  schemaVersion: f.literal(1),
  revision: f.revision({ min: 1 }),
  goalId: id,
  sequence: f.integer({ min: 1 }),
  lastMessageRef: f.nullable(f.ref(SessionMessageRefShape)),
};

export type DispatchCounterV1 = InferRecord<typeof DispatchCounterFields>;

/** The visible structure: a positive sequence, one project, one goal. Never a body in `7a1-ports`. */
export function dispatchCounterProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as {
    ref?: { projectId?: unknown; goalId?: unknown };
    goalId?: unknown;
    sequence?: unknown;
    lastMessageRef?: unknown;
  };
  if (typeof record.sequence === 'number'
    && (!Number.isSafeInteger(record.sequence) || record.sequence < 1)) {
    return 'DispatchCounter.sequence must be a positive safe integer';
  }
  if (typeof record.goalId === 'string' && record.ref?.goalId !== record.goalId) {
    return 'DispatchCounter.goalId must equal its ref.goalId';
  }
  const last = record.lastMessageRef;
  if (last !== null && typeof last === 'object') {
    const ref = last as { projectId?: unknown };
    if (ref.projectId !== record.ref?.projectId) {
      return 'DispatchCounter.lastMessageRef must belong to the same project';
    }
  }
  return null;
}

export const DispatchCounterFormat = defineRecord({
  name: 'DispatchCounter', schemaId: 'DispatchCounter@1', aggregateType: 'DispatchCounter',
  fields: DispatchCounterFields,
  rules: [dispatchCounterProblem],
});
