import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import { canonicalOf } from '../../../../contracts/fingerprint.js';
import { DEFAULT_GOAL_SETTINGS_V1 } from '../../../../contracts/goal-decisions.js';
import { isRecord } from '../../../../contracts/validation/common.js';
import type { VersionPin } from '../../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../../contracts/core/results.js';
import type { GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import type { DecodeResult, EncodedRecord, StoreFailure } from '../../../record-store/ports.js';
import type { S5RecordPort } from '../../model/decision-contracts.js';
import { decodeGoalSnapshot } from '../../persistence/record-codecs.js';
import type { EncodedRecordOutcome, SourceReadSupport } from './types.js';

export { sameJson } from '../../../../contracts/fingerprint.js';

/**
 * §2.1/§3.3 line 629: a virtual/absence pin is not a stored aggregate. The
 * canonical `goal-decision-reader` emits `{aggregateType:'Task',…,revision:0}`
 * Task focus pins (a Task has no record schema); such a pin is satisfied by its
 * revision 0 and must never be read as a stored record. A non-zero revision, or
 * a revision-0 pin for a genuinely stored aggregate, is still read/CASed.
 */
const STORED_PIN_AGGREGATES: ReadonlySet<string> = new Set([
  'Goal', 'GoalPhase', 'Workspace', 'PlanRevision', 'PlanProposal', 'Run',
  'TaskAttempt', 'TaskLease', 'SessionMessage', 'QueryJob', 'QueryRun', 'QueryJobAnswer',
]);

export function isAbsencePin(pin: VersionPin): boolean {
  if (!isRecord(pin.ref) || pin.revision !== 0) return false;
  const aggregateType = (pin.ref as { aggregateType?: unknown })['aggregateType'];
  if (typeof aggregateType !== 'string') return false;
  return aggregateType === 'Task' || !STORED_PIN_AGGREGATES.has(aggregateType);
}

/** §2.8: only the Goal aggregate has the named control-rebase exception. */
export function isGoalPin(pin: VersionPin): boolean {
  return isRecord(pin.ref) && (pin.ref as { aggregateType?: unknown })['aggregateType'] === 'Goal';
}

export type Scope = { projectId: string; workspaceId: string };

export function isUserRecipient(recipient: unknown): boolean {
  return isRecord(recipient) && recipient['kind'] === 'user';
}

export function clonePins(pins: readonly VersionPin[]): VersionPin[] {
  return pins.map((pin) => structuredClone(pin));
}

/** One order-insensitive set comparison over complete pins. */
export function samePinSet(left: readonly VersionPin[], right: readonly VersionPin[]): boolean {
  if (left.length !== right.length) return false;
  const remaining = new Set<string>();
  for (const pin of left) {
    const key = canonicalOf(pin);
    if (key === null) return false;
    remaining.add(key);
  }
  for (const pin of right) {
    const key = canonicalOf(pin);
    if (key === null || !remaining.delete(key)) return false;
  }
  return remaining.size === 0;
}

export function goalBasis(goal: GoalSnapshot): GoalDecisionBasisV1 {
  return {
    goalRef: structuredClone(goal.ref),
    workspaceRef: structuredClone(goal.workspaceRef),
    objective: goal.objective,
    activePlanRef: structuredClone(goal.activePlanRevision),
    settings: structuredClone(goal.settings ?? DEFAULT_GOAL_SETTINGS_V1),
  };
}

/**
 * The one stored-record read protocol shared by the current-source reads and the
 * saved answer's historical reads: canonical key -> exactly one `readMany` ->
 * distinguish the Store's own `missing` report from an unaccounted omission ->
 * decode. The two callers keep their own exact error texts.
 */
export type ReadRecordTemplates = {
  notCanonical: string;
  couldNotRead: string;
  doesNotExist: string;
  unaccounted: string;
  damaged: (label: string, reason: string) => string;
};

const DECISION_SOURCE_READ_TEMPLATES: ReadRecordTemplates = {
  notCanonical: 'the decision source ref is not canonicalizable JSON',
  couldNotRead: 'the decision source record could not be read',
  doesNotExist: 'the decision source record does not exist',
  unaccounted: 'the decision source read neither returned nor reported missing the record',
  damaged: (label, reason) => `the ${label} record is damaged: ${reason}`,
};

export const SAVED_ANSWER_READ_TEMPLATES: ReadRecordTemplates = {
  notCanonical: 'a saved answer source ref is not canonicalizable JSON',
  couldNotRead: 'the saved answer source record could not be read',
  doesNotExist: 'the saved answer source record does not exist',
  unaccounted: 'the saved answer source read neither returned nor reported missing the record',
  damaged: (label, reason) => `the saved answer ${label} record is damaged: ${reason}`,
};

/** This owner's own store-failure mapping: reason unchanged, never a shared map. */
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'not_found': return rejectedWithCurrent('not_found', failure.reason);
    case 'revision_conflict': return rejectedWithCurrent('revision_conflict', failure.reason);
    case 'unsupported': return rejectedWithCurrent('unsupported', failure.reason);
    default: return rejectedWithCurrent('unavailable', failure.reason);
  }
}

async function readStoredRecord(records: S5RecordPort, ref: unknown,
  templates: ReadRecordTemplates): Promise<EncodedRecordOutcome> {
  const key = canonicalOf(ref);
  if (key === null) return { ok: false, rejection: rejectedWithCurrent('invalid', templates.notCanonical) };
  let read: Awaited<ReturnType<S5RecordPort['readMany']>>;
  try {
    read = await records.readMany([key]);
  } catch {
    return { ok: false, rejection: rejectedWithCurrent('unavailable', templates.couldNotRead) };
  }
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    // §4.2 line 821/§8.2 line 1367: only the Store's own missing report is
    // `not_found`; an unaccounted omission is an unavailable read.
    return read.value.missing.includes(key)
      ? { ok: false, rejection: rejectedWithCurrent('not_found', templates.doesNotExist) }
      : { ok: false, rejection: rejectedWithCurrent('unavailable', templates.unaccounted) };
  }
  return { ok: true, record };
}

export async function readStoredDecoded<T>(records: S5RecordPort, ref: unknown, templates: ReadRecordTemplates,
  decode: (record: EncodedRecord) => DecodeResult<T>, label: string): Promise<ReadResult<T>> {
  const loaded = await readStoredRecord(records, ref, templates);
  if (!loaded.ok) return loaded.rejection;
  const decoded = decode(loaded.record);
  if (decoded.status !== 'decoded') {
    return rejectedWithCurrent('unavailable', templates.damaged(label, decoded.reason));
  }
  return { status: 'ready', value: decoded.value };
}

/**
 * Builds the shared read support one decision-source handler uses: the scope
 * checks, the record read/decode protocol and the pin helpers, all bound to the
 * one Store seam and the caller's bound project/workspace scope.
 */
export function createSourceReadSupport(
  records: S5RecordPort,
  scope: Scope,
): SourceReadSupport {
  /** §3.3 line 625 / §8.2: a foreign Workspace is refused before any foreign object is read. */
  function scopeProblem(ref: unknown): ReadResult<never> | null {
    if (!isRecord(ref)) return rejectedWithCurrent('invalid', 'the decision source object ref is not a JSON object');
    const projectId = ref['projectId'];
    if (typeof projectId === 'string' && projectId.length > 0 && projectId !== scope.projectId) {
      return rejectedWithCurrent('forbidden', 'a decision source object belongs to another project');
    }
    const workspaceId = ref['workspaceId'];
    if (typeof workspaceId === 'string' && workspaceId.length > 0 && workspaceId !== scope.workspaceId) {
      return rejectedWithCurrent('forbidden', 'a decision source object belongs to another workspace');
    }
    return null;
  }

  async function readEncoded(ref: unknown): Promise<EncodedRecordOutcome> {
    return readStoredRecord(records, ref, DECISION_SOURCE_READ_TEMPLATES);
  }

  async function readDecoded<T>(
    ref: unknown,
    decode: (record: EncodedRecord) => DecodeResult<T>,
    label: string,
  ): Promise<ReadResult<T>> {
    return readStoredDecoded(records, ref, DECISION_SOURCE_READ_TEMPLATES, decode, label);
  }

  async function readGoal(ref: GoalRef): Promise<ReadResult<GoalSnapshot>> {
    return readDecoded(ref, decodeGoalSnapshot, 'Goal');
  }

  /**
   * §2.8 / §3.3 line 625 / S5-MSG-03: only the Goal aggregate's CONTROL
   * revision may be refreshed (the named control-rebase exception). Every other
   * source object keeps its captured revision; `verifyPins` then proves it
   * still reads at that version, so a moved object is `revision_conflict`.
   */
  async function refreshPins(pins: readonly VersionPin[]): Promise<ReadResult<VersionPin[]>> {
    const refreshed: VersionPin[] = [];
    for (const pin of pins) {
      const problem = scopeProblem(pin.ref);
      if (problem !== null) return problem;
      if (!isGoalPin(pin)) {
        refreshed.push(structuredClone(pin));
        continue;
      }
      const loaded = await readEncoded(pin.ref);
      if (!loaded.ok) return loaded.rejection;
      refreshed.push({ ref: structuredClone(pin.ref), revision: loaded.record.revision });
    }
    return { status: 'ready', value: refreshed };
  }

  /** §3.3 line 625: every pinned object must still read at the captured version. */
  async function verifyPins(pins: readonly VersionPin[]): Promise<ReadResult<never> | null> {
    for (const pin of pins) {
      const key = canonicalOf(pin.ref);
      if (key === null) return rejectedWithCurrent('invalid', 'a decision source pin ref is not canonicalizable JSON');
      // A virtual Task/absence pin has no record schema: revision 0 is its fact.
      if (isAbsencePin(pin)) continue;
      const loaded = await readEncoded(pin.ref);
      if (!loaded.ok) return loaded.rejection;
      if (loaded.record.revision !== pin.revision) {
        return rejectedWithCurrent('revision_conflict', 'a decision source pin no longer reads at its captured version',
          [{ ref: structuredClone(pin.ref), revision: loaded.record.revision }]);
      }
    }
    return null;
  }

  return { records, scope, scopeProblem, readEncoded, readDecoded, readGoal, refreshPins, verifyPins };
}
