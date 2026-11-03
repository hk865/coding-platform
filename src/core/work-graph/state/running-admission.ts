import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { ExecutionAuthorizationV2 } from '../../../contracts/dispatch.js';
import type { QueryExecutionStateV1 } from '../../../contracts/query-job.js';
import { roleLineDutyOf, type RoleLimitsNumbersV1, type RoleLineDutyV1 } from '../../../contracts/role-lines.js';

export type RunningGroup = RoleLineDutyV1;                 // secretary | adviser | scribe | executor
export type RunningAdmissionPhase =
  | ExecutionAuthorizationV2['phase'] | QueryExecutionStateV1['phase'] | null | undefined;

export type RunningAdmissionVerdict =
  | { status: 'admitted' }
  | { status: 'rejected'; code: 'busy'; reason: 'running_cap' };

/**
 * One map for both records: `reviewer` → executor; a role with no duty basis (`unknown`) counts as executor
 * (A1b-R3 (b1): a role the person named runs as an executor, Slice 3). `roleLineDutyOf` is the only copy of the
 * duty map and answers null for `unknown` only; this count alone reads that null as executor.
 */
export function runningGroupOf(duty: PlatformDutyV1 | 'unknown'): RunningGroup {
  return roleLineDutyOf(duty) ?? 'executor';
}

/** Count-once: `entering`/`entered`/`unknown` only. `authorized` (Run wait) and `prepared` (Query wait) are free. */
export function countsRunningAdmission(phase: RunningAdmissionPhase): boolean {
  return phase === 'entering' || phase === 'entered' || phase === 'unknown';
}

export function emptyRunningCounts(): Record<RunningGroup, number> {
  return { secretary: 0, adviser: 0, scribe: 0, executor: 0 };
}

/**
 * One entry is one Run/Query and it carries its one persisted phase; the count
 * never receives `requests[].admitted`, so the per-request bit cannot be summed.
 */
export function countRunningAdmission(
  entries: readonly { duty: PlatformDutyV1 | 'unknown'; phase: RunningAdmissionPhase }[],
): Record<RunningGroup, number> {
  const counts = emptyRunningCounts();
  for (const entry of entries) {
    if (!countsRunningAdmission(entry.phase)) continue;
    counts[runningGroupOf(entry.duty)] += 1;
  }
  return counts;
}

/** The one decision; the adapter serializes it, the start owners call the adapter. */
export function admitModelCall(input: {
  duty: PlatformDutyV1 | 'unknown';
  limits: Readonly<RoleLimitsNumbersV1>;
  counts: Readonly<Record<RunningGroup, number>>;
}): RunningAdmissionVerdict {
  const group = runningGroupOf(input.duty);
  return input.counts[group] < input.limits[group]
    ? { status: 'admitted' }
    : { status: 'rejected', code: 'busy', reason: 'running_cap' };
}
