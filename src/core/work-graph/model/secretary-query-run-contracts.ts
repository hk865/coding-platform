/**
 * The trusted facts of one running secretary QueryRun. This is the ONE resolver
 * for that identity: the notes owner admits a `query_run` caller through it, and
 * a later sender admission reads the same round, its frozen effective goal and
 * its request root here.
 *
 * `planRef` is the effective goal's Plan frozen into the round's prepared
 * manifest: a secretary's stage anchor takes its version, and a round prepared
 * without one has no stage version to give.
 *
 * `goals` is the live `request_understanding` grant set only, never the
 * round's effective goal; the resolver computes it from the frozen material
 * list and the current operation records.
 */
import type { CoreCallContext, CorePrincipal } from '../../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { QueryJobRef, QueryRunRef } from '../../../contracts/query-job.js';

export type SecretaryQueryRunV1 = {
  principal: Extract<CorePrincipal, { kind: 'query_run' }>;   // contracts/core/call-context.ts:24–30
  session: SessionRef;                // the execution state's sessionRef (contracts/query-job.ts:478)
  duty: 'secretary';
  scope: WorkspaceScope;              // the QueryRun's project and workspace (from its stored ref, never input)
  round: QueryJobRef;                 // the QueryJob the run executes
  run: QueryRunRef;                   // principal.queryRunRef, confirmed by the stored QueryRun
  effectiveGoalId: string | null;     // execution.prepared.requestEffectiveGoalId (contracts/query-job.ts:491), frozen at preparation
  planRef: PlanRevisionRef | null;    // the prepared manifest's focusPlan: the effective goal's Plan at preparation, or none
  requestRoot: QueryJobRef;           // the round's requestRoot (QueryJobSnapshot, contracts/query-job.ts:346) = the manifest's (:36)
  sessionGeneration: number;          // execution.sessionGeneration (contracts/query-job.ts:479)
  goals: GoalRef[];                   // the live request_understanding grant set only; never the effective goal
};
export interface SecretaryQueryRunPort {
  resolveSecretaryQueryRun(ctx: CoreCallContext):
    Promise<{ status: 'ready'; value: SecretaryQueryRunV1 } | CoreRejection>;
}
