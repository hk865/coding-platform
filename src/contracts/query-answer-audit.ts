import type { QueryRunRef } from './query-job.js';

/** A human-requested assessment of an immutable answer, never an acceptance. */
export type QueryAnswerAuditRequest = {
  requestId: string; runRef: QueryRunRef; goalId: string; answerId: string;
  /** null selects the whole answer; indexes refer to its persisted presentation. */
  blocks: number[] | null;
};
export type QueryAnswerAuditVerdict = 'supported' | 'citation_insufficient' | 'conflict' | 'unverifiable';
export type QueryAnswerAuditAssessment = { blocks: Array<{ index: number; verdict: QueryAnswerAuditVerdict;
  claims: Array<{ quote: string; verdict: QueryAnswerAuditVerdict; markers: string[]; reason: string }> }> };
export type QueryAnswerAuditView = {
  request: QueryAnswerAuditRequest;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'outcome_unknown' | 'stale';
  assessment: QueryAnswerAuditAssessment | null; message: string | null;
  startedAt: string; endedAt: string | null;
};
