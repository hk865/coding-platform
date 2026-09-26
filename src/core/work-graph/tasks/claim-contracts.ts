/** R4c.1: atomic ownership admission, NOT permission to enter the Kernel.
 * Expected pins are exactly Goal, Workspace and the selected Session; immutable
 * accepted Plan is separately read and guarded. No scope reservation is required.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { DispatchOutboxRef, RoleBindingRefV1, TaskAttemptRef, TaskBudgetV1 } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { RoleBindingFactsPort } from '../configuration/contracts.js';
import type { GraphWrite } from './contracts.js';

/** Compatibility re-export: the single declaration lives in contracts/core. */
export type { TaskClaim } from '../../../contracts/core/task-claim.js';

export type ClaimTaskInput = {
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  taskId: string;
  sessionRef: SessionRef;
  roleBinding: RoleBindingRefV1;
  budget: TaskBudgetV1;
};
/**
 * Versioned dispatch phase nested in the @1 outbox body. `entered`/`settled`
 * must agree with the outer `status`; the codec that admits them is an
 * implementation-phase change, so the existing decoder still accepts only the
 * legacy `pending` shape.
 */
export type TaskDispatchStateV1 = {
  schemaVersion: 1;
  phase: 'entered' | 'settled';
  consumerId: string;
  entryGeneration: number;
  sessionGeneration: number;
  eventId: string;
};
export type TaskClaimOutbox = {
  ref: DispatchOutboxRef;
  revision: number;
  schemaVersion: 1;
  status: 'pending' | 'entered' | 'settled';
  /** Present only for the versioned entered/settled phases. */
  dispatchState?: TaskDispatchStateV1;
  claim: TaskClaim;
};
export interface TaskClaimPort {
  claimTask(ctx: CoreCallContext, request: GraphWrite<ClaimTaskInput>): Promise<WriteResult<TaskClaim>>;
  readTaskClaim(ctx: CoreCallContext, ref: DispatchOutboxRef): Promise<ReadResult<TaskClaim>>;
}
export type TaskClaimDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  roles: RoleBindingFactsPort;
  now(): string;
  newId(): string;
};
