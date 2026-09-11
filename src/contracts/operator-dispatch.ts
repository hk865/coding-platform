import type { RunSpec } from './runtime-preparation.js';
import type { ExplorationScope } from './exploration.js';

export interface OperatorDispatchPort {
  dispatch(request: { spec: RunSpec; requestId: string }): Promise<{ runId: string; status: string; executor?: 'coding-agent' }>;
  cancel(scope: ExplorationScope, runId: string): Promise<{ status: string }>;
}
