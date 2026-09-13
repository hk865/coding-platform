import type { ReadOnlyQueryPort, QueryRunRef } from './query-job.js';
import type { RuntimeBudget } from './runtime-budget.js';
import type { RuntimeObservationSource } from './runtime-observations.js';

export type QueryExecutionRequest = Parameters<ReadOnlyQueryPort['startQuery']>[0];
export type QueryExecutionMaterial = {
  status: 'ready'; input: string; kind: string; goalId: string | null;
  roleBinding: unknown; budget: RuntimeBudget; deadline: string | null;
} | { status: 'rejected'; code: 'invalid_claim' | 'invalid_material' | 'unavailable'; message: string };
export interface QueryExecutionMaterialPort {
  assemble(request: QueryExecutionRequest): Promise<QueryExecutionMaterial>;
}

/** Public persisted observations only. No hidden execution context is queried. */
export interface QuerySourceObservationPort extends RuntimeObservationSource<{ runRef: QueryRunRef; status: string; input: string; sourceAfter: string | null }> {}

/** WorkspaceReader owns native current-source capture, separately from stored observations. */
export interface QuerySourceRevisionPort {
  sourceRevision(projectId: string, workspaceId: string): Promise<string | null>;
}
