/**
 * The project's two active governance pointers, read and decoded in one place.
 *
 * The Goal decision-cause reader treats an ABSENT pointer as "this project is
 * not initialized" (§4.2/rule 14), and the secretary preparation needs the
 * active revision's id and revision from the same records. A store throw, a
 * non-ready read and a present pointer whose body does not carry a legal
 * active revision are all `unavailable`: only an absent record is `null`.
 *
 * The active revision is parsed by the ONE governance-reference parsers the
 * plan reader already owns; this file only resolves the pointer record and its
 * CAS guard.
 */
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { parseObject } from '../../../contracts/validation/common.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import { architectureRefFromBody, policyRefFromBody } from './plan-readers.js';

/** The active governance revision each project pointer names; null when absent. */
export type InitializationPointersV1 = {
  architecture: { baselineId: string; revision: number } | null;
  completionPolicy: { policyId: string; revision: number } | null;
  /** One guard per pointer: its revision, or `null` when the pointer is absent. */
  guards: RecordGuard[];
};

/** The two physical pointer keys; the active pointer is the project-scoped record. */
function pointerKeys(projectId: string): { policyKey: string; architectureKey: string } {
  return {
    policyKey: canonicalJson({ aggregateType: 'ProjectCompletionPolicyActive', projectId } as unknown as JsonValue),
    architectureKey: canonicalJson({ aggregateType: 'ProjectArchitectureBaselineActive', projectId } as unknown as JsonValue),
  };
}

/** One pointer's active revision through the shared parser for its body shape. */
function activeRevisionOf<T extends { revision: number }>(
  record: EncodedRecord, parse: (value: unknown, projectId: string) => T | null, projectId: string,
): T | null {
  const body = parseObject(record.json);
  if (body === null) return null;
  return parse(body['activeRevision'], projectId);
}

export async function readInitializationPointers(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, projectId: string,
): Promise<ReadResult<InitializationPointersV1>> {
  const { policyKey, architectureKey } = pointerKeys(projectId);
  let read: Awaited<ReturnType<Pick<GoalRecordTransactionPort, 'readMany'>['readMany']>>;
  try {
    read = await records.readMany([policyKey, architectureKey]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return rejected('unavailable', `the governance pointers could not be read: ${reason}`);
  }
  if (read.status !== 'ready') {
    return rejected('unavailable', `the governance pointers are unavailable: ${read.code}`);
  }
  const byKey = new Map(read.value.records.map((record) => [record.refKey, record]));
  const missing = new Set(read.value.missing);
  const guards: RecordGuard[] = [];
  const absentOrDamaged = <T extends { revision: number }>(
    key: string, parse: (value: unknown, projectId: string) => T | null,
  ): { kind: 'absent' } | { kind: 'present'; value: T } | { kind: 'unreported' } => {
    const record = byKey.get(key);
    if (record === undefined) {
      if (!missing.has(key)) return { kind: 'unreported' };
      guards.push({ refKey: key, expectedRevision: null });
      return { kind: 'absent' };
    }
    const value = activeRevisionOf(record, parse, projectId);
    if (value === null) return { kind: 'unreported' };
    guards.push({ refKey: key, expectedRevision: record.revision });
    return { kind: 'present', value };
  };
  const architecture = absentOrDamaged(architectureKey, architectureRefFromBody);
  const completionPolicy = absentOrDamaged(policyKey, policyRefFromBody);
  for (const [key, pointer] of [[architectureKey, architecture], [policyKey, completionPolicy]] as const) {
    if (pointer.kind === 'unreported') {
      return rejected('unavailable', `the governance pointer ${key} is not readable as an active revision`);
    }
  }
  return {
    status: 'ready',
    value: {
      architecture: architecture.kind === 'present'
        ? { baselineId: architecture.value.baselineId, revision: architecture.value.revision } : null,
      completionPolicy: completionPolicy.kind === 'present'
        ? { policyId: completionPolicy.value.policyId, revision: completionPolicy.value.revision } : null,
      guards,
    },
  };
}
