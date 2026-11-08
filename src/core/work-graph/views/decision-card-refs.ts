/**
 * The one Task/Run pin narrowing the decision reads and the work-line reads share.
 *
 * A Task is a designation, not a stored aggregate: production only writes the
 * stored-absent `{aggregateType:'Task', projectId, goalId, taskId}` pin
 * (`tasks/goal-decision-reader.ts:taskPin`). A Run pin is the formal
 * `{aggregateType:'Run', projectId, goalId, runId}` ref. `taskRefOfPins` and
 * `runRefOfPins` answer the card `taskRef`/`runRef`: exactly one distinct
 * designation is that one, zero or several are `null`.
 */
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';

/** The formal Task designation `{aggregateType:'Task',projectId,goalId,taskId}`, or null. */
export type TaskPinRef = TaskTriple & { aggregateType: 'Task' };

/** The formal Task designation, or null. */
export function taskPinRefOf(ref: unknown): TaskPinRef | null {
  if (typeof ref !== 'object' || ref === null) return null;
  const value = ref as { aggregateType?: unknown; projectId?: unknown; goalId?: unknown; taskId?: unknown };
  if (value.aggregateType !== 'Task' || typeof value.projectId !== 'string'
    || typeof value.goalId !== 'string' || typeof value.taskId !== 'string') return null;
  return { aggregateType: 'Task', projectId: value.projectId, goalId: value.goalId, taskId: value.taskId };
}

/** The plain TaskTriple of a formal Task designation, or null. */
export function taskTripleOfPin(ref: unknown): TaskTriple | null {
  const task = taskPinRefOf(ref);
  return task === null ? null : { projectId: task.projectId, goalId: task.goalId, taskId: task.taskId };
}

/** The formal Run ref `{aggregateType:'Run',projectId,goalId,runId}`, or null. */
function runRefOf(ref: unknown): RunRef | null {
  if (typeof ref !== 'object' || ref === null) return null;
  const value = ref as { aggregateType?: unknown; projectId?: unknown; goalId?: unknown; runId?: unknown };
  if (value.aggregateType !== 'Run' || typeof value.projectId !== 'string'
    || typeof value.goalId !== 'string' || typeof value.runId !== 'string') return null;
  return { aggregateType: 'Run', projectId: value.projectId, goalId: value.goalId, runId: value.runId };
}

function exactlyOne<T>(values: Iterable<T>): T | null {
  const byKey = new Map<string, T>();
  for (const value of values) byKey.set(canonicalJson(value as unknown as JsonValue), value);
  return byKey.size === 1 ? [...byKey.values()][0]! : null;
}

/** The one Task designation of the card's source pins; none or several read as null. */
export function taskRefOfPins(pins: readonly VersionPin[]): TaskTriple | null {
  return exactlyOne(pins.flatMap((pin) => {
    const task = taskTripleOfPin(pin.ref);
    return task === null ? [] : [task];
  }));
}

/** The one Run of the card's source pins; none or several read as null. */
export function runRefOfPins(pins: readonly VersionPin[]): RunRef | null {
  return exactlyOne(pins.flatMap((pin) => {
    const run = runRefOf(pin.ref);
    return run === null ? [] : [run];
  }));
}
