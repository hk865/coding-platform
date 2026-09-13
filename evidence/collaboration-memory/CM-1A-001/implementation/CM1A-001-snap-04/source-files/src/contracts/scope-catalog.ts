import type { QueryJobSnapshot } from './query-job.js';

export type CatalogScope = { projectId: string; workspaceId: string; goalId?: string };

/** StateLedger read-only discovery repository. Results are canonical records,
 * not display projections or authority to mutate. It owns incremental event
 * traversal and exact-scope resolution. Missing records are omitted; failed or
 * inconsistent reads reject and can be retried. A fresh instance rebuilds from
 * the durable log, without a separate persisted catalog format. */
export interface ScopeCatalogPort {
  goals(scope: CatalogScope): Promise<string[]>;
  jobs(scope?: CatalogScope): Promise<QueryJobSnapshot[]>;
}
