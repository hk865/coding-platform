/**
 * The secretary preparation seam (spec L8): the frozen facts one request
 * round prepares from, and the port the Runtime asks for them.
 *
 * Declarations only. The port is injected by composition; the implementation
 * lives in `views/`, so this module reads no store and publishes no route.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { GoalDesiredState, GoalRef } from '../../../contracts/ledger.js';
import type {
  QueryJobRef, QueryRunRef, SecretaryRoundMaterialV1,
} from '../../../contracts/query-job.js';
import type { RecordGuard } from '../../record-store/ports.js';

/** One earlier round of the same request that ran on another Session. */
export type SecretaryHistoryEntryV1 = {
  round: SecretaryRoundMaterialV1;
  absorbed: SecretaryRoundMaterialV1[];
  session: SessionRef;
  result:
    | { kind: 'answer'; text: string }
    | { kind: 'no_answer'; closeCode: string }
    | { kind: 'not_ended' };
};

/**
 * Every fact one secretary preparation reads, at one watermark with its guards.
 *
 * `briefRef` is the hand-off operation the successor's brief belongs to, and
 * `understandingGrants` is the one still-valid grant set of the frozen material
 * list. Both are computed once in this read and never re-derived by a consumer.
 */
export type SecretaryPreparationFactsV1 = {
  request: {
    requestRoot: QueryJobRef;
    effectiveGoalId: string | null;
    preparationCursor: CommitCursor;
    round: SecretaryRoundMaterialV1;
    batch: SecretaryRoundMaterialV1[];
    earlier: SecretaryHistoryEntryV1[];
    briefRef: OperationRef | null;
    understandingGrants: GoalRef[];
  };
  workspace: { workspaceId: string; revision: number };
  architecture: { baselineId: string; revision: number; catalog: AdoptedArchitecture } | null;
  completionPolicy: { policyId: string; revision: number } | null;
  goals: { goalId: string; desiredState: GoalDesiredState; objective: string }[];
  executionKind: 'semantic_query' | 'initial_coordination';
  guards: RecordGuard[];
  watermark: CommitCursor | null;
};

export interface SecretaryPreparationFactsPort {
  read(ctx: CoreCallContext, input: { queryRunRef: QueryRunRef }): Promise<ReadResult<SecretaryPreparationFactsV1>>;
}
