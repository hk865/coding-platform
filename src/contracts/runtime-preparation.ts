import type { RuntimeBudget } from './runtime-budget.js';
import type { RunRef, RuntimeEventV1 } from './dispatch.js';
import type { ReviewWorkRef } from './reviewer-work.js';
import type { ReviewerProfileV1 } from './reviewer-context.js';

export type RunSpec = {
  mode?: 'explore' | 'review';
  review?: { workRef: ReviewWorkRef; profile: ReviewerProfileV1 };
  projectId: string;
  workspaceId: string;
  goalId: string;
  runId: string;
  taskId: string;
  root: string;
  instruction: string;
  budget: RuntimeBudget;
};

export type PreparedRunStatus = 'prepared' | 'running' | 'completed' | 'failed' | 'cancelled' | 'budget_exhausted' | 'outcome_unknown';
export type PreparedRunFact = { spec: RunSpec; status: PreparedRunStatus; events: RuntimeEventV1[] };

/** WorkerRuntime's public preparation and observation surface. These are adapter
 * facts; only Control can accept them as canonical Task/Run state. */
export interface RuntimePreparationPort {
  all(): PreparedRunFact[];
  preflight(spec: RunSpec): Promise<void>;
  prepare(spec: RunSpec): Promise<void>;
}

export interface RuntimeReconciliationPort {
  all(): PreparedRunFact[];
  markUnknown(ref: RunRef): Promise<void>;
}
