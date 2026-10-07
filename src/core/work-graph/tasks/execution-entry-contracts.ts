/**
 * B2 WorkGraph execution-entry contracts (skeleton).
 *
 * Reuses the existing result types. The first version handles TaskClaim only;
 * Query/ReviewWork without a provider are explicitly unsupported and are never
 * coerced into a Run. `KernelExecutionBinding` reuses the Kernel identity shape
 * owned by `contracts/core/execution-history.ts` through an index access, so this
 * lane declares no duplicate structure and does not widen that file's scope.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { RoleConfigurationRef } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type { ControlIntentRef } from '../../../contracts/control-intent.js';
import type {
  ExecutionAuthorizationV2, RunContinuationV1, RunReconciliationBasisV1, RunSnapshot, RuntimeEventV1,
} from '../../../contracts/dispatch.js';
import type { RoleSpecResolutionV1 } from '../../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../../contracts/task-envelope.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RoleBindingFactsPort } from '../configuration/contracts.js';
import type { MaterialPort } from '../materials/contracts.js';
import type { GraphWrite } from './contracts.js';
import type { ExecutionReadPort } from './execution-read-contracts.js';
import type { RecordExecutionHistoryInput } from './execution-history-contracts.js';

/** Existing shared Kernel identity shape; no second declaration. */
export type KernelExecutionBinding = RunExecutionHistoryV1['kernel'];

export type KernelObservationSource = KernelExecutionBinding & { position: number };
export type CompletedHistoryBoundary = { source: KernelObservationSource; cursor: string };

export type TaskEntryPermit = {
  claim: TaskClaim;
  consumerId: string;
  entryGeneration: number;
  authorizationRevision: number;
  inputDigest: string;
};

/** Public projection of the existing Run authorization fact; not a new aggregate. */
export type RuntimeEntryRecord = {
  runRef: RunSnapshot['ref'];
  runRevision: number;
  authorization: ExecutionAuthorizationV2;
};

/** The history fields the Runtime observed for this Run, minus its own runRef. */
export type ObservedExecutionHistory = Omit<RecordExecutionHistoryInput, 'runRef'>;

export type TaskResultObservation = {
  claim: TaskClaim;
  entry: Pick<TaskEntryPermit, 'consumerId' | 'entryGeneration'>;
  event: RuntimeEventV1;
  kernelSource: KernelObservationSource | null;
  completedHistoryBoundary: CompletedHistoryBoundary | null;
  history: ObservedExecutionHistory | null;
  /** Present only for a real yielded terminal; the original wait binding. */
  continuation?: RunContinuationV1;
  /**
   * §6.1 contract (b) (RD-5, A.2 step 5.6): every write with a Kernel terminal
   * goes through `recordRunResult`. Absent is the in-process observer
   * (`live_clean`, RUN-07/08); `host_instance_takeover` is the start-up
   * reconcile of a terminal never booked (RUN-17/18) or of late evidence of an
   * unknown end (RUN-21).
   */
  basis?: RunReconciliationBasisV1;
  /** RUN-08: the calls of the Turn still without a determined result (non-empty ⇒ the end is unknown). */
  unresolvedToolCallIds?: string[];
  /** The Kernel Turn start: required from `Entering` (RUN-17) and by RUN-21 after RUN-20(ii) (L-2). */
  enteredAt?: string;
  /** CTL-08(b) / CTL-07: the queued steers the Kernel accepted, settled `steered` in the same commit. */
  acceptedSteers?: AcceptedSteerV1[];
  /**
   * §10.3, RUN-17/18/21: the Runtime confirmed every `run.input_accepted` of
   * the Turn against its source. Required (`true`) for a reconciled terminal
   * and late evidence; absent is the in-process observer, which confirms them
   * before it submits (RUN-07/08).
   */
  inputsConfirmed?: boolean;
};

/** A queued steer whose `control:<sha(intentRef)>` input the Kernel accepted (CTL-08(b)). */
export type AcceptedSteerV1 = {
  intentRef: ControlIntentRef;
  position: number;
  kernelEventId: string;
  kernelEventSequence: number;
};

/**
 * The Host instance the platform runs under (D-18, L-10): `owned` once this
 * Host holds the instance lease of its storage, `held_by_other` when another
 * live Host holds it or the lock file is unreadable. Every start-up reconcile
 * write and every human attestation needs `owned` (L-1).
 */
export type HostInstanceFacts = { hostInstanceId: string; lease: 'owned' | 'held_by_other' };

export interface ExecutionEntryPort {
  authorizeRuntimeEntry(ctx: CoreCallContext, request: GraphWrite<{
    prepared: PreparedTaskExecution; consumerId: string;
  }>): Promise<WriteResult<TaskEntryPermit>>;
  beginRuntimeEntry(ctx: CoreCallContext, request: GraphWrite<{
    permit: TaskEntryPermit; kernel: KernelExecutionBinding;
  }>): Promise<WriteResult<RuntimeEntryRecord>>;
  recordExecutionEntered(ctx: CoreCallContext, request: GraphWrite<{
    permit: TaskEntryPermit; enteredAt: string;
    kernelSource: KernelObservationSource; history: ObservedExecutionHistory;
  }>): Promise<WriteResult<RunSnapshot>>;
  recordRunResult(ctx: CoreCallContext,
    request: GraphWrite<TaskResultObservation>): Promise<WriteResult<RunSnapshot>>;
}

/**
 * Narrow trusted Host configuration check (B2 §10). The composition root
 * projects the same Runtime Host provider's trusted fields into this function;
 * WorkGraph does not depend on Runtime types. It checks only this role
 * configuration: no Context manager, no policy database, and never an
 * always-true implementation.
 */
export type AuthorizeConfigurationInput = {
  run: RunSnapshot;
  /** The exact current Role resolution the WorkGraph admission recheck already
   * made and checked for this Run; it is trusted internal data, never a
   * model/HTTP submittable field. */
  roleResolution: RoleSpecResolutionV1;
  sessionRole: RoleConfigurationRef;
  configurationRevision: string;
  permissions: TaskEnvelopeV1['permissions'];
  hostTemplate: PreparedTaskManifestV1['hostTemplate'];
};
export type AuthorizeConfigurationResult = {
  configurationRevision: string;
  permissions: TaskEnvelopeV1['permissions'];
  hostTemplate: PreparedTaskManifestV1['hostTemplate'];
};
export type AuthorizeConfiguration = (
  ctx: CoreCallContext,
  input: AuthorizeConfigurationInput,
) => Promise<ReadResult<AuthorizeConfigurationResult>>;

export type ExecutionEntryDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  reads: ExecutionReadPort;
  roles: RoleBindingFactsPort;
  materials: MaterialPort;
  bodies: Pick<RawArtifactStorePort, 'read'>;
  authorizeConfiguration: AuthorizeConfiguration;
  /** The Host instance (D-18): the reconcile terminal and late evidence (RUN-17/18/21) need its lease. */
  hostInstance?: HostInstanceFacts;
  now(): string;
  eventId(): string;
  newId(): string;
};
