
// Completed-capability migration: selected original declarations, no legacy service port.
/** WorkspaceReader owns native current-source capture, separately from stored observations. */
export interface QuerySourceRevisionPort {
    sourceRevision(projectId: string, workspaceId: string, signal?: AbortSignal): Promise<string | null>;
}

// Completed-capability migration: selected original declarations, no legacy service port.
import type { QueryExecutionBindingV1 } from './query-job.js';
/** Same persisted request shape; does not import the retired execution service. */
export type QueryExecutionRequest = QueryExecutionBindingV1['request'];
