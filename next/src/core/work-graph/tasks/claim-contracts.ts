/** R4c.1: atomic ownership admission, NOT permission to enter the Kernel.
 * Expected pins are exactly Goal, Workspace and the selected Session; immutable
 * accepted Plan is separately read and guarded. No scope reservation is required.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { DispatchOutboxRef, RoleBindingRefV1, RunRef, TaskAttemptRef, TaskBudgetV1, TaskTriple } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { RoleBindingFactsPort } from '../configuration/contracts.js';
import type { GraphWrite } from './contracts.js';

export type ClaimTaskInput = {
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  taskId: string;
  sessionRef: SessionRef;
  roleBinding: RoleBindingRefV1;
  budget: TaskBudgetV1;
};
/** Original accepted result retained in the claim event and pending outbox.
 * generation is the new Session revision, not a resettable occupancy counter. */
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
export type TaskClaimOutbox = {
  ref: DispatchOutboxRef;
  revision: number;
  schemaVersion: 1;
  status: 'pending';
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
