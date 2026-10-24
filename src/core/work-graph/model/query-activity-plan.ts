/**
 * L16: the pure Query-activity write plan. It applies the ONE activity
 * replacement rule (`state/activity-replacement.ts`) to a QueryRun's tally and
 * builds the next `QueryActivity` snapshot; the caller encodes it and commits it
 * with the closing Query write. No storage read, clock or I/O here.
 */
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { QueryJobSnapshot, QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import { isRequestRound } from '../../../contracts/query-job.js';
import type { QueryActivityRef, QueryActivitySnapshot, RunActivityFactsV1 } from '../../../contracts/run-activity.js';
import { decideActivityOutcome, type ActivityWriteOutcome } from '../state/activity-replacement.js';

/** The record content a Query closing write supplies; `endCommit` is the L4 row-3 switch. */
export type QueryActivityRecordContent = {
  queryRunRef: QueryRunRef;
  sessionRef: SessionRef | null;
  askedSessionRef: SessionRef | null;
  goalId: string | null;
  queryEndedAt: string;
  queryStartedAt: string | null;
  recordedBy: 'query_end' | 'backfill';
  recordedAt: string;
};

/** The QueryActivity ref of one QueryRun; the record is keyed by the full QueryRunRef. */
export function queryActivityRefOf(queryRunRef: QueryRunRef): QueryActivityRef {
  return {
    aggregateType: 'QueryActivity',
    projectId: queryRunRef.projectId,
    workspaceId: queryRunRef.workspaceId,
    queryJobId: queryRunRef.queryJobId,
    runId: queryRunRef.runId,
  };
}

/**
 * Build the record a write would store, and its L4 outcome. The caller writes
 * only when the outcome is not `unchanged`; `unchanged` returns the existing
 * snapshot itself, so a retry never invents a new revision.
 */
export function planQueryActivityWrite(
  existing: QueryActivitySnapshot | null,
  facts: RunActivityFactsV1,
  input: QueryActivityRecordContent & { endCommit: boolean },
): { outcome: ActivityWriteOutcome; snapshot: QueryActivitySnapshot } {
  const outcome = decideActivityOutcome(existing === null ? null : existing.facts, facts, input.endCommit);
  if (existing !== null && outcome === 'unchanged') return { outcome, snapshot: existing };
  const span = facts.status === 'counted'
    ? { firstAt: facts.window.turnStartedAt, lastAt: facts.window.lastRecordAt, basis: 'kernel' as const }
    : { firstAt: input.queryStartedAt, lastAt: input.queryEndedAt, basis: 'run_times' as const };
  const snapshot: QueryActivitySnapshot = {
    ref: queryActivityRefOf(input.queryRunRef),
    revision: (existing?.revision ?? 0) + 1,
    schemaVersion: 1,
    queryRunRef: input.queryRunRef,
    sessionRef: input.sessionRef,
    askedSessionRef: input.askedSessionRef,
    goalId: input.goalId,
    queryEndedAt: input.queryEndedAt,
    recordedAt: input.recordedAt,
    recordedBy: input.recordedBy,
    facts,
    span,
  };
  return { outcome, snapshot };
}

/** The goal and the two Sessions a `QueryActivity` record names. */
export type QueryActivitySource = Pick<QueryActivityRecordContent, 'goalId' | 'sessionRef' | 'askedSessionRef'>;

/**
 * What a Query's activity record names, from the Query's own persisted facts, for every writer of the record: the
 * goal the run executed under (a request round's goal frozen into its prepared manifest, null for a no-goal round;
 * every other Query's intent goal), the Session it ran in and the Session a consultation asked about. Both Sessions
 * are the plain `{ projectId, sessionId }` the record stores: a claim caller may hand the execution state the
 * Session aggregate ref, whose extra key the record format does not accept. An entered request round without its
 * prepared manifest has no goal to name.
 */
export function queryActivitySourceOf(job: QueryJobSnapshot, run: QueryRunSnapshot):
  { ok: true; source: QueryActivitySource } | { ok: false; reason: string } {
  const state = run.run.executionState;
  let goalId: string | null;
  if (isRequestRound(job)) {
    const prepared = state?.prepared ?? null;
    if (prepared === null) return { ok: false, reason: 'an entered request round carries no prepared manifest goal' };
    goalId = prepared.requestEffectiveGoalId;
  } else {
    goalId = job.job.intent.goalId;
  }
  const executing = state?.sessionRef ?? null;
  const asked = job.job.intent.execution.consultation?.derivation?.sourceSessionRef ?? null;
  return { ok: true, source: {
    goalId,
    sessionRef: executing === null ? null : { projectId: executing.projectId, sessionId: executing.sessionId },
    askedSessionRef: asked === null ? null : { projectId: asked.projectId, sessionId: asked.sessionId },
  } };
}
