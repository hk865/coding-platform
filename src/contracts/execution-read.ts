/**
 * Execution read DTOs (the single declaration): the final atomic read window
 * `executions/read` returns, and the dispatch outbox record it carries.
 * WorkGraph re-exports them (`model/execution-read-contracts.ts`,
 * `state/attempt-machine.ts`); the UI reads them here.
 */
import type { CommitCursor } from './command-event.js';
import type { TaskClaim } from './core/task-claim.js';
import type { SessionRecord } from './core/session.js';
import type {
  DispatchOutboxRef, RunSnapshot, TaskAttemptSnapshot, TaskDispatchStateV2, TaskLeaseSnapshot,
} from './dispatch.js';
import type { PlanRevisionSnapshot } from './plan.js';

/**
 * V1 entered/settled dispatch phase. `entered`/`settled` must agree with the
 * outer `TaskClaimOutbox.status`.
 */
export type DispatchStateV1 = {
  schemaVersion: 1;
  phase: 'entered' | 'settled';
  consumerId: string;
  entryGeneration: number;
  sessionGeneration: number;
  eventId: string;
};

/** The DispatchOutboxEntry record; WorkGraph's `model/claim-contracts.ts` names it `TaskClaimOutbox`. */
export type DispatchOutboxRecord = {
  ref: DispatchOutboxRef;
  revision: number;
  schemaVersion: 1;
  status: 'pending' | 'entered' | 'settled';
  dispatchState?: DispatchStateV1 | TaskDispatchStateV2;
  claim: TaskClaim;
};

/** One final atomic readMany window. Mutable Session/Lease describe the current
 * facts and may no longer belong to this historical claim; no authorization is
 * inferred. Missing required claim-linked records is incomplete, not absence. */
export type TaskExecutionRecord = {
  run: RunSnapshot;
  attempt: TaskAttemptSnapshot;
  outbox: DispatchOutboxRecord;
  plan: PlanRevisionSnapshot;
  session: SessionRecord;
  lease: TaskLeaseSnapshot | null;
  readThrough: CommitCursor | null;
};
