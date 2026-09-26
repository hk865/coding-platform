/**
 * Single declaration of the immutable TaskClaim result (R4c.1).
 *
 * It lives in the shared contracts layer so the B2 prepared-execution and entry
 * contracts can reference the claim without importing the WorkGraph. The
 * WorkGraph `tasks/claim-contracts.ts` keeps a compatibility type re-export;
 * exactly one declaration of the shape exists in the tree.
 */
import type { DispatchOutboxRef, RunRef, TaskAttemptRef, TaskTriple } from '../dispatch.js';
import type { PlanRevisionRef } from '../plan.js';
import type { SessionRef } from './identity.js';

/** Original accepted claim result retained in the claim event and pending outbox.
 * `generation` is the new Session revision, not a resettable occupancy counter. */
export type TaskClaim = {
  task: TaskTriple;
  planRef: PlanRevisionRef;
  workspaceId: string;
  sessionRef: SessionRef;
  sessionRevision: number;
  generation: number;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  outboxRef: DispatchOutboxRef;
  claimedAt: string;
};
