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
import type { ExecutionAuthorizationV2, RunContinuationV1, RunSnapshot, RuntimeEventV1 } from '../../../contracts/dispatch.js';
import type { RoleSpecResolutionV1 } from '../../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../../contracts/task-envelope.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RoleBindingFactsPort } from '../configuration/contracts.js';
import type { MaterialPort, MaterialReadFactsPort } from '../materials/contracts.js';
import type { GraphWrite } from './contracts.js';
import type { ExecutionReadPort } from './execution-read-contracts.js';
import type { RecordExecutionHistoryInput } from './execution-history-contracts.js';
import type { PlanTaskPort } from './plan-contracts.js';

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
};

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
  plans: Pick<PlanTaskPort, 'readTaskInput'>;
  materials: MaterialPort;
  /**
   * Optional fresh material read-facts seam (M2). It is absent in the current
   * production composition until the next reviewed seam injects it. A manifest
   * with external selected/additional material must fail closed as `unsupported`
   * when this dependency is missing; it is never replaced by a bare
   * `openArtifact` that commits without grant CAS guards.
   */
  materialFacts?: MaterialReadFactsPort;
  bodies: Pick<RawArtifactStorePort, 'read'>;
  authorizeConfiguration: AuthorizeConfiguration;
  now(): string;
  eventId(): string;
  newId(): string;
};
